// Motor da cena: um canvas fixo, um relógio só, câmera guiada por marcações
// presas às seções da página. Tudo que se move lê o mesmo relógio.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { criarMateriais, criarPecas, type Peca } from "./pecas";

// Marcação de câmera: ângulo horizontal e vertical (graus), tamanho que
// precisa caber na tela (mm), ponto olhado (z) e quanto a lente está explodida
export type Marcacao = { az: number; el: number; tam: number; alvoZ: number; e: number };

export const MARCACOES: Marcacao[] = [
  { az: 38, el: 14, tam: 120, alvoZ: 36, e: 0 }, // abertura
  { az: 78, el: 6, tam: 62, alvoZ: 41, e: 0 }, // close no anel de foco
  { az: 90, el: 8, tam: 300, alvoZ: 36, e: 1 }, // desmontada
  { az: 205, el: 22, tam: 140, alvoZ: 36, e: 0.3 }, // volta ao redor
  { az: 375, el: 10, tam: 112, alvoZ: 36, e: 0 }, // montada de novo
];

const suave = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const misturar = (a: number, b: number, t: number) => a + (b - a) * t;

// Som feito na hora com Web Audio: rajada curta de ruído filtrado = clique
class Som {
  ctx: AudioContext | null = null;
  ruido: AudioBuffer | null = null;
  ligar() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    this.ruido = b;
  }
  clique(intensidade = 1) {
    if (!this.ctx || !this.ruido) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.ruido;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2600 + Math.random() * 900;
    f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.value = 0.35 * intensidade;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start();
  }
}

type Eventos = {
  aoSegurar?: (p: number) => void; // progresso do foco 0..1 (anel na tela)
  aoFicarPronto?: () => void;
};

export class Motor {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);
  private pecas: Peca[];
  private som = new Som();
  private raf = 0;
  private ultimo = performance.now();
  private tempo = 0;
  private escalaTempo = 1;

  // estado alvo (vem da página) e estado atual (suavizado a cada quadro)
  private progresso = 0;
  private atual: Marcacao = { ...MARCACOES[0] };
  private mouse = new THREE.Vector2();
  private mouseSuave = new THREE.Vector2();
  private segurando = false;
  private foco = 0;
  private ultimoDente = 0;
  private planta = false;
  private fixo = false;
  private plantaValor = 0;

  // qualidade adaptativa
  private pixelRatio: number;
  private quadros = 0;
  private janelaFps = 0;

  private materiais: THREE.Material[] = [];
  private linhaMat = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0, visible: false });
  // pós-processamento curto, "como se fosse filmado": MSAA + HDR, bloom só nos
  // brilhos fortes, granulação e, no fim, tom ACES e sRGB (OutputPass)
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private inclinacao = false;
  private rotulos: { peca: Peca; el: HTMLDivElement }[] = [];
  private linhas: SVGLineElement | null = null;
  private svg: SVGSVGElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camadaRotulos: HTMLElement,
    private eventos: Eventos = {}
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.pixelRatio = Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.75 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.cena.background = new THREE.Color(0x0a0a0b);

    this.montarEstudio();
    const mats = criarMateriais();
    this.materiais = Object.values(mats);
    this.pecas = criarPecas(mats);
    const lente = new THREE.Group();
    this.pecas.forEach((p) => {
      lente.add(p.obj);
      this.criarArestas(p.obj);
    });
    this.cena.add(lente);
    this.criarRotulos();
    this.montarPos();

    this.redimensionar();
    window.addEventListener("resize", this.redimensionar);
    window.addEventListener("pointermove", this.aoMover);

    // Compila os shaders antes de mostrar (sem travadas na primeira rolagem)
    this.renderer.compileAsync(this.cena, this.camera).then(() => {
      this.eventos.aoFicarPronto?.();
    });
    this.raf = requestAnimationFrame(this.quadro);
  }

  // Estúdio fotográfico dentro da cena: sala escura, um softbox fora do eixo e
  // duas luzes em faixa. Vira o ambiente refletido (PMREM); o metal só é tão
  // bonito quanto o que ele reflete.
  private montarEstudio() {
    const estudio = new THREE.Scene();
    estudio.background = new THREE.Color(0x050506);
    const luz = (w: number, h: number, intensidade: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      mat.color.multiplyScalar(intensidade);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    };
    const softbox = luz(6, 4, 6);
    softbox.position.set(-5, 4, 4);
    softbox.lookAt(0, 0, 0);
    const faixa1 = luz(0.6, 9, 7);
    faixa1.position.set(6, 0, -2);
    faixa1.lookAt(0, 0, 0);
    const faixa2 = luz(0.5, 8, 5);
    faixa2.position.set(-2, -1, -7);
    faixa2.lookAt(0, 0, 0);
    const teto = luz(10, 10, 0.6);
    teto.position.set(0, 9, 0);
    teto.lookAt(0, 0, 0);
    estudio.add(softbox, faixa1, faixa2, teto);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.cena.environment = pmrem.fromScene(estudio, 0.02).texture;
    pmrem.dispose();
  }

  private montarPos() {
    const alvo = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, alvo);
    this.composer.addPass(new RenderPass(this.cena, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.05, 5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new FilmPass(0.22, false));
    this.composer.addPass(new OutputPass());
  }

  // Modo planta: cada peça ganha as arestas (só os cantos do perfil)
  private criarArestas(obj: THREE.Object3D) {
    const linhaMat = this.linhaMat;
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
        const arestas = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 20), linhaMat);
        arestas.userData.aresta = true;
        o.add(arestas);
      }
    });
  }

  private criarRotulos() {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "absolute inset-0 w-full h-full");
    this.camadaRotulos.appendChild(this.svg);
    this.pecas.filter((p) => p.rotulo).forEach((peca) => {
      const el = document.createElement("div");
      el.className = "rotulo";
      el.textContent = peca.rotulo!;
      this.camadaRotulos.appendChild(el);
      const linha = document.createElementNS("http://www.w3.org/2000/svg", "line");
      linha.setAttribute("class", "rotulo-linha");
      this.svg!.appendChild(linha);
      el.dataset.linha = String(this.rotulos.length);
      this.rotulos.push({ peca, el });
    });
  }

  // ---- API usada pela página ----
  setProgresso(p: number) {
    this.progresso = Math.min(MARCACOES.length - 1, Math.max(0, p));
  }
  // Modo foto (para conferir com print): vai direto para a marcação, sem suavizar
  semBloom() {
    this.bloom.enabled = false;
  }
  foto(p: number, foco = 0) {
    this.setProgresso(p);
    this.atual = this.alvoDaMarcacao();
    this.foco = foco;
    this.fixo = true;
  }
  setSegurando(s: boolean) {
    if (s) {
      this.som.ligar(); // o navegador só libera áudio depois de um gesto
      this.ligarInclinacao(); // e a inclinação do celular também
    }
    this.segurando = s;
  }
  setPlanta(v: boolean) {
    this.planta = v;
  }
  destruir() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.redimensionar);
    window.removeEventListener("pointermove", this.aoMover);
    window.removeEventListener("deviceorientation", this.aoInclinar);
    this.composer.dispose();
    this.renderer.dispose();
    this.camadaRotulos.innerHTML = "";
  }

  // No celular, inclinar o aparelho faz o papel do cursor
  private ligarInclinacao() {
    if (this.inclinacao || typeof DeviceOrientationEvent === "undefined") return;
    this.inclinacao = true;
    const ouvir = () => window.addEventListener("deviceorientation", this.aoInclinar);
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === "function") {
      D.requestPermission().then((r) => r === "granted" && ouvir()).catch(() => {});
    } else ouvir();
  }

  private aoInclinar = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    this.mouse.set(Math.max(-1, Math.min(1, e.gamma / 35)), Math.max(-1, Math.min(1, (e.beta - 45) / 35)));
  };

  private aoMover = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };

  private redimensionar = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  };

  private alvoDaMarcacao(): Marcacao {
    const i = Math.min(MARCACOES.length - 2, Math.floor(this.progresso));
    const t = suave(this.progresso - i);
    const a = MARCACOES[i];
    const b = MARCACOES[i + 1];
    return {
      az: misturar(a.az, b.az, t),
      el: misturar(a.el, b.el, t),
      tam: misturar(a.tam, b.tam, t),
      alvoZ: misturar(a.alvoZ, b.alvoZ, t),
      e: misturar(a.e, b.e, t),
    };
  }

  private quadro = (agora: number) => {
    this.raf = requestAnimationFrame(this.quadro);
    const dt = Math.min(0.05, (agora - this.ultimo) / 1000);
    this.ultimo = agora;

    // câmera lenta no close (é só uma multiplicação)
    const noClose = 1 - Math.min(1, Math.abs(this.progresso - 1));
    this.escalaTempo = misturar(1, 1 / 12, noClose * (this.segurando ? 0 : 1));
    this.tempo += dt * this.escalaTempo;

    // suavização de tudo que vem da página
    const k = this.fixo ? 1 : 1 - Math.exp(-dt * 4);
    const alvo = this.alvoDaMarcacao();
    (Object.keys(alvo) as (keyof Marcacao)[]).forEach((c) => {
      this.atual[c] = misturar(this.atual[c], alvo[c], k);
    });
    this.mouseSuave.lerp(this.mouse, 1 - Math.exp(-dt * 3));

    // foco: segurar gira o anel e estende a parte da frente
    const antes = this.foco;
    if (!this.fixo) this.foco = Math.min(1, Math.max(0, this.foco + (this.segurando ? dt / 1.6 : -dt / 2.4)));
    const dente = Math.floor(this.foco * 40);
    if (dente !== this.ultimoDente) {
      this.som.clique(this.foco > antes ? 1 : 0.5);
      this.ultimoDente = dente;
    }
    this.eventos.aoSegurar?.(this.foco);

    this.posar();
    this.posicionarCamera();
    this.plantaValor = misturar(this.plantaValor, this.planta ? 1 : 0, this.fixo ? 1 : 1 - Math.exp(-dt * 6));
    this.aplicarPlanta();

    // o cursor gira o estúdio refletido
    this.cena.environmentRotation.set(this.mouseSuave.y * 0.35, this.mouseSuave.x * 0.9 + this.tempo * 0.05, 0);

    this.composer.render(dt);
    this.atualizarRotulos();
    this.medirFps(dt);
  };

  // Pose de cada peça: vista explodida escalonada + foco
  private posar() {
    const e = this.atual.e;
    const avanco = this.foco * 6; // mm que a frente anda ao focar
    for (const p of this.pecas) {
      const atraso = (1 - p.ordem) * 0.42;
      const t = suave((e - atraso) / 0.58);
      p.obj.position.copy(p.base).addScaledVector(p.lift, t);
      if (p.foco) p.obj.position.z += avanco;
      if (p.nome === "anelFoco") p.obj.rotation.z = this.foco * Math.PI * 0.66;
    }
  }

  // Enquadrar por tamanho, não por distância: "caber X mm na tela" funciona
  // igual no celular (em pé) e no monitor
  private posicionarCamera() {
    const { az, el, tam, alvoZ } = this.atual;
    const meiaFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = tam / 2 / (Math.tan(meiaFov) * Math.min(1, this.camera.aspect));
    const a = THREE.MathUtils.degToRad(az);
    const b = THREE.MathUtils.degToRad(el);
    const alvo = new THREE.Vector3(0, 0, alvoZ);
    this.camera.position.set(
      Math.sin(a) * Math.cos(b) * dist,
      Math.sin(b) * dist,
      alvoZ + Math.cos(a) * Math.cos(b) * dist
    );
    this.camera.lookAt(alvo);
  }

  private aplicarPlanta() {
    const v = this.plantaValor;
    // superfícies somem de uma vez (material.visible não esconde as arestas,
    // que são filhas da malha); as arestas aparecem suavemente
    this.materiais.forEach((m) => (m.visible = v < 0.5));
    this.linhaMat.opacity = v;
    this.linhaMat.visible = v > 0.01;
  }

  // Etiquetas: projeta o ponto 3D de cada peça na tela e empilha em duas
  // colunas limpas, com linha-guia
  private atualizarRotulos() {
    const op = suave((this.atual.e - 0.6) / 0.4);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const esquerda: { el: HTMLDivElement; x: number; y: number }[] = [];
    const direita: typeof esquerda = [];
    const v = new THREE.Vector3();
    this.rotulos.forEach(({ peca, el }) => {
      new THREE.Box3().setFromObject(peca.obj).getCenter(v);
      v.y += 26;
      v.project(this.camera);
      const item = { el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
      (item.x < w / 2 ? esquerda : direita).push(item);
    });
    const linhas = this.svg ? Array.from(this.svg.querySelectorAll("line")) : [];
    const colocar = (lista: typeof esquerda, lado: "e" | "d") => {
      // etiqueta de cima liga na peça mais distante: as linhas não se cruzam
      lista.sort((a, b) => (lado === "e" ? b.x - a.x : a.x - b.x));
      const largura = Math.max(0, ...lista.map((it) => it.el.offsetWidth));
      const topo = h * 0.2;
      const passo = Math.min(56, (h * 0.6) / Math.max(1, lista.length));
      lista.forEach((it, i) => {
        const y = topo + i * passo;
        const x = lado === "e" ? w * 0.04 : w * 0.96;
        it.el.style.opacity = String(op);
        it.el.style.transform = `translate(${lado === "e" ? x : x - it.el.offsetWidth}px, ${y - 10}px)`;
        const l = linhas[Number(it.el.dataset.linha)];
        if (l) {
          const xl = lado === "e" ? x + largura + 10 : x - largura - 10;
          l.setAttribute("x1", String(xl));
          l.setAttribute("y1", String(y));
          l.setAttribute("x2", String(it.x));
          l.setAttribute("y2", String(it.y));
          l.style.opacity = String(op * 0.6);
        }
      });
    };
    colocar(esquerda, "e");
    colocar(direita, "d");
  }

  // Qualidade adaptativa: se ficar abaixo de 40 fps, baixa a resolução
  private medirFps(dt: number) {
    this.quadros++;
    this.janelaFps += dt;
    if (this.janelaFps >= 2) {
      const fps = this.quadros / this.janelaFps;
      if (fps < 40 && this.pixelRatio > 1) {
        // primeiro baixa a resolução...
        this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.redimensionar();
      } else if (fps < 40 && this.bloom.enabled) {
        // ...depois desliga o bloom
        this.bloom.enabled = false;
      }
      this.quadros = 0;
      this.janelaFps = 0;
    }
  }
}
