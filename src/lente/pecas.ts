// Peças da lente, todas feitas em código (nada de modelo baixado).
// Unidade: milímetro. Eixo óptico = Z (traseira em z=0, frente em z≈72).
// Cada peça redonda nasce de um perfil 2D (raio, z) girado em torno do eixo
// (LatheGeometry). Perfis desenhados no sentido anti-horário, com chanfros
// pequenos: "bordas são onde a luz mora".
import * as THREE from "three";

export type Peca = {
  nome: string;
  obj: THREE.Object3D;
  base: THREE.Vector3; // posição montada
  lift: THREE.Vector3; // deslocamento na vista explodida
  ordem: number; // 1 = sai primeiro e volta por último
  rotulo?: string; // texto da etiqueta na vista explodida
  foco?: boolean; // anda junto com o foco (helicoide)
};

type Perfil = [number, number][];

function torno(perfil: Perfil, segmentos = 160) {
  const g = new THREE.LatheGeometry(
    perfil.map(([r, z]) => new THREE.Vector2(r, z)),
    segmentos
  );
  g.rotateX(Math.PI / 2); // eixo Y do torno vira o eixo Z da lente
  return g;
}

// Anel oco com chanfro nos quatro cantos
function anel(rIn: number, rOut: number, z0: number, z1: number, ch = 0.4): Perfil {
  return [
    [rIn, z0 + ch], [rIn + ch, z0], [rOut - ch, z0], [rOut, z0 + ch],
    [rOut, z1 - ch], [rOut - ch, z1], [rIn + ch, z1], [rIn, z1 - ch], [rIn, z0 + ch],
  ];
}

// Anel com sulcos circulares na face externa (pegada do anel de abertura)
function anelSulcado(rIn: number, rOut: number, z0: number, z1: number, sulcos: number, prof = 0.6): Perfil {
  const p: Perfil = [[rIn, z0 + 0.4], [rIn + 0.4, z0], [rOut - 0.4, z0], [rOut, z0 + 0.4]];
  const passo = (z1 - z0 - 2) / sulcos;
  for (let i = 0; i < sulcos; i++) {
    const a = z0 + 1 + i * passo;
    p.push([rOut, a + passo * 0.2], [rOut - prof, a + passo * 0.35], [rOut - prof, a + passo * 0.65], [rOut, a + passo * 0.8]);
  }
  p.push([rOut, z1 - 0.4], [rOut - 0.4, z1], [rIn + 0.4, z1], [rIn, z1 - 0.4], [rIn, z0 + 0.4]);
  return p;
}

// Elemento de vidro biconvexo: superfícies esféricas aproximadas por parábola
function vidro(R: number, zTras: number, zFrente: number, flechaT: number, flechaF: number): Perfil {
  const p: Perfil = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const r = (R * i) / n;
    p.push([r, zTras + flechaT * (r / R) ** 2]);
  }
  for (let i = n; i >= 0; i--) {
    const r = (R * i) / n;
    p.push([r, zFrente - flechaF * (r / R) ** 2]);
  }
  return p;
}

// Textura de metal escovado gerada em código (riscos finos em ruído)
function texturaEscovada() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7a7a7a";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const v = 100 + Math.random() * 60;
    g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    g.lineWidth = Math.random() * 1.2;
    const y = Math.random() * 512;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 6);
  return t;
}

export function criarMateriais() {
  const escovado = texturaEscovada();
  return {
    cromo: new THREE.MeshPhysicalMaterial({
      color: 0xe9e9ec, metalness: 1, roughness: 0.14, roughnessMap: escovado,
      clearcoat: 0.4, side: THREE.DoubleSide,
    }),
    acetinado: new THREE.MeshPhysicalMaterial({
      color: 0x2a2b2f, metalness: 1, roughness: 0.38, roughnessMap: escovado,
      clearcoat: 0.25, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
    }),
    bordaPolida: new THREE.MeshPhysicalMaterial({
      color: 0xbfc1c6, metalness: 1, roughness: 0.08, side: THREE.DoubleSide,
    }),
    borracha: new THREE.MeshPhysicalMaterial({
      color: 0x101011, metalness: 0, roughness: 0.82, side: THREE.DoubleSide,
    }),
    vermelho: new THREE.MeshPhysicalMaterial({
      color: 0xc2161f, metalness: 0.6, roughness: 0.3, emissive: 0x3a0306, side: THREE.DoubleSide,
    }),
    // Vidro: só reflete o estúdio, somado por cima (sem luz direta), com
    // reflexo colorido do tratamento antirreflexo (iridescência)
    vidro: new THREE.MeshPhysicalMaterial({
      color: 0x0d1a24, metalness: 0, roughness: 0, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 0.9,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
      side: THREE.DoubleSide,
    }),
  };
}

export type Materiais = ReturnType<typeof criarMateriais>;

export function criarPecas(m: Materiais): Peca[] {
  const pecas: Peca[] = [];
  const add = (nome: string, obj: THREE.Object3D, ext: Partial<Peca> = {}) => {
    pecas.push({ nome, obj, base: obj.position.clone(), lift: new THREE.Vector3(), ordem: 0, ...ext });
  };
  const malha = (perfil: Perfil, mat: THREE.Material) => new THREE.Mesh(torno(perfil), mat);

  // Baioneta (encaixe na câmera): anel cromado + 3 abas
  const baioneta = new THREE.Group();
  baioneta.add(malha(anel(20, 25.5, 0, 4.5, 0.3), m.cromo));
  for (let i = 0; i < 3; i++) {
    const aba = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 2.2), m.cromo);
    const a = (i / 3) * Math.PI * 2;
    aba.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 1.4);
    aba.rotation.z = a + Math.PI / 2;
    baioneta.add(aba);
  }
  add("baioneta", baioneta, { rotulo: "Baioneta cromada" });

  add("vidroTraseiro", malha(vidro(17, 7, 13, 1.6, 2.2), m.vidro), { rotulo: "Elemento traseiro" });
  add("corpoTraseiro", malha(anel(22, 29.5, 4.5, 18, 0.6), m.acetinado), { rotulo: "Corpo em alumínio anodizado" });
  const abertura = new THREE.Group();
  abertura.add(malha(anelSulcado(23, 31, 18, 27, 7), m.acetinado));
  const linha = new THREE.Mesh(new THREE.TorusGeometry(31.15, 0.32, 12, 160), m.vermelho);
  linha.position.z = 28.3;
  abertura.add(linha);
  add("anelAbertura", abertura, { rotulo: "Anel de abertura f/1.4 a f/16" });

  add("diafragma", malha(anel(7.5, 22, 37.6, 38.2, 0.1), m.bordaPolida), { rotulo: "Diafragma de 9 lâminas" });
  add("vidroMeio", malha(vidro(20, 42, 50, 2.5, 2.8), m.vidro), { rotulo: "Grupo central" });

  // Anel de foco: borracha com 90 frisos (uma InstancedMesh só)
  const foco = new THREE.Group();
  foco.add(malha(anel(28, 31.6, 30, 52, 0.8), m.borracha));
  const friso = new THREE.BoxGeometry(1.1, 1.3, 19);
  const frisos = new THREE.InstancedMesh(friso, m.borracha, 90);
  const d = new THREE.Object3D();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    d.position.set(Math.cos(a) * 32.1, Math.sin(a) * 32.1, 41);
    d.rotation.set(0, 0, a);
    d.updateMatrix();
    frisos.setMatrixAt(i, d.matrix);
  }
  foco.add(frisos);
  add("anelFoco", foco, { rotulo: "Anel de foco emborrachado" });

  add("corpoFrontal", malha(anel(26, 31.4, 52, 66, 1), m.acetinado), { foco: true, rotulo: "Helicoide de foco" });
  add("anelFiltro", malha(anelSulcado(27.5, 31.9, 66, 72, 4, 0.35), m.cromo), { foco: true, rotulo: "Rosca de filtro 62 mm" });
  add("vidroFrontal", malha(vidro(25, 60, 70, 2, 5.5), m.vidro), { foco: true, rotulo: "Elemento frontal com tratamento" });

  // Vista explodida: as peças se espalham ao longo do eixo em vagas iguais
  // (na ordem em que estão montadas), centradas no meio da lente. Quem fica
  // mais longe do centro tem ordem maior: sai primeiro e volta por último.
  const centro = 36;
  const vaga = 24;
  const zs = pecas.map((p) => {
    const b = new THREE.Box3().setFromObject(p.obj);
    return (b.min.z + b.max.z) / 2;
  });
  const ordemZ = pecas.map((_, i) => i).sort((a, b) => zs[a] - zs[b]);
  const meio = (pecas.length - 1) / 2;
  ordemZ.forEach((idx, pos) => {
    const destino = centro + (pos - meio) * vaga;
    pecas[idx].lift.set(0, 0, destino - zs[idx]);
    pecas[idx].ordem = Math.abs(pos - meio) / meio;
  });
  return pecas;
}
