"use client";

// A página: canvas fixo atrás, história em 5 seções na frente. A rolagem
// diz ao motor em que marcação de câmera estamos; os textos aparecem pela
// posição da rolagem (observers pulam quadros quando a GPU está pesada).
import { useEffect, useRef, useState } from "react";
import { Motor } from "@/lente/motor";

// Plano B: se o navegador não abrir o 3D (sem WebGL2, aceleração desligada),
// a página mostra imagens das cenas em vez de quebrar
function criarMotor(...args: ConstructorParameters<typeof Motor>): Motor | null {
  try {
    return new Motor(...args);
  } catch (e) {
    console.warn("O 3D não abriu neste navegador:", e);
    return null;
  }
}

const SECOES = [
  {
    id: "abertura",
    kicker: "SR Optics · 50mm f/1.4",
    titulo: "Uma lente feita só de código.",
    texto: "Nada de vídeo, nada de modelo baixado. Cada anel, cada vidro e cada friso é geometria desenhada ao vivo no seu navegador.",
  },
  {
    id: "foco",
    kicker: "01 · Close",
    titulo: "Segure para focar.",
    texto: "O anel gira, a helicoide estende a frente e você ouve cada dente. O som também é gerado na hora.",
  },
  {
    id: "desmontada",
    kicker: "02 · Desmontada",
    titulo: "Doze peças. Nenhuma mentira.",
    texto: "As peças de fora saem primeiro e voltam por último. Ligue o modo planta e veja só as arestas: é geometria, não um vídeo.",
  },
  {
    id: "volta",
    kicker: "03 · Volta ao redor",
    titulo: "Metal é espelho.",
    texto: "O que você vê no alumínio é um estúdio fotográfico montado dentro da cena. Mexa o cursor e as luzes giram.",
  },
  {
    id: "montada",
    kicker: "04 · Montada de novo",
    titulo: "Leve como uma página.",
    texto: "Um canvas, nenhum arquivo de vídeo. Projeto de estudo de Samuel Rogério, em Next.js e three.js.",
  },
];

export default function Experiencia() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotulosRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<Motor | null>(null);
  const anelRef = useRef<SVGCircleElement>(null);
  const secoesRef = useRef<(HTMLElement | null)[]>([]);
  const [pronto, setPronto] = useState(false);
  const [planta, setPlanta] = useState(false);
  const [sem3d, setSem3d] = useState(false);
  const fundosRef = useRef<(HTMLImageElement | null)[]>([]);
  const [modoFoto, setModoFoto] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !rotulosRef.current) return;
    const motor = criarMotor(canvasRef.current, rotulosRef.current, {
      aoFicarPronto: () => setPronto(true),
      aoSegurar: (p) => {
        if (anelRef.current) anelRef.current.style.strokeDashoffset = String(126 * (1 - p));
      },
    });
    motorRef.current = motor;
    if (!motor) {
      setSem3d(true);
      setPronto(true);
    }

    const aoRolar = () => {
      const meio = window.scrollY + window.innerHeight / 2;
      const centros = secoesRef.current.map((s) => (s ? s.offsetTop + s.offsetHeight / 2 : 0));
      let p = 0;
      for (let i = 0; i < centros.length - 1; i++) {
        if (meio >= centros[i]) p = i + Math.min(1, (meio - centros[i]) / (centros[i + 1] - centros[i]));
      }
      motor?.setProgresso(p);
      // plano B sem 3D: as imagens das cenas trocam com a rolagem
      fundosRef.current.forEach((img, i) => {
        if (img) img.style.opacity = String(Math.max(0, 1 - Math.abs(p - i)));
      });
      // revelar textos pela rolagem
      secoesRef.current.forEach((s, i) => {
        const bloco = s?.querySelector<HTMLElement>(".revelar");
        if (!bloco) return;
        const d = Math.abs(p - i);
        const v = Math.max(0, 1 - d * 1.6);
        bloco.style.opacity = String(v);
        bloco.style.transform = `translateY(${(1 - v) * 24}px)`;
      });
    };
    const foto = new URLSearchParams(window.location.search);
    if (motor && foto.has("p")) {
      // ?p=2&planta=1&foco=0.5 : modo foto para conferir cada seção num print
      setPronto(true);
      setModoFoto(true);
      motor.foto(Number(foto.get("p")), Number(foto.get("foco") ?? 0));
      if (foto.get("planta") === "1") setPlanta(true);
      if (foto.get("bloom") === "0") motor.semBloom();
      return () => motor.destruir();
    }
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    window.addEventListener("resize", aoRolar);
    return () => {
      window.removeEventListener("scroll", aoRolar);
      window.removeEventListener("resize", aoRolar);
      motor?.destruir();
    };
  }, []);

  useEffect(() => {
    motorRef.current?.setPlanta(planta);
  }, [planta]);

  const segurar = (s: boolean) => motorRef.current?.setSegurando(s);

  return (
    <div className="pagina relative">
      <canvas ref={canvasRef} className="fixed inset-0 h-screen w-screen" />
      <div ref={rotulosRef} className="pointer-events-none fixed inset-0" />
      {sem3d && (
        <>
          <div className="fixed inset-0">
            {SECOES.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                ref={(el) => {
                  fundosRef.current[i] = el;
                }}
                src={`/fallback/cena-${i}.jpg`}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                style={{ opacity: i === 0 ? 1 : 0 }}
              />
            ))}
          </div>
          <p className="fixed right-4 bottom-4 z-20 max-w-xs rounded-lg bg-black/55 px-3 py-2 text-right text-xs text-neutral-300 backdrop-blur">
            Versão em imagens: seu navegador não abriu o 3D. Para a experiência completa, ative a aceleração de hardware.
          </p>
        </>
      )}

      <div
        className={`fixed inset-0 z-30 flex items-center justify-center bg-[#0a0a0b] transition-opacity duration-700 ${pronto ? "pointer-events-none opacity-0" : "opacity-100"} ${modoFoto ? "hidden" : ""}`}
      >
        <span className="font-mono text-xs tracking-[0.3em] text-neutral-400">MONTANDO A LENTE…</span>
      </div>

      <main className="relative z-10">
        {SECOES.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            ref={(el) => {
              secoesRef.current[i] = el;
            }}
            className={`flex items-center px-6 md:px-16 ${i === 2 || i === 3 ? "min-h-[160vh]" : "min-h-screen"} ${i % 2 ? "justify-end" : "justify-start"}`}
          >
            <div className="revelar sticky top-1/3 max-w-sm">
              <p className="mb-3 font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">{s.kicker}</p>
              <h2 className="mb-4 text-4xl font-semibold leading-tight md:text-5xl">{s.titulo}</h2>
              <p className="text-base leading-relaxed text-neutral-300">{s.texto}</p>

              {s.id === "foco" && (
                <button
                  onPointerDown={() => segurar(true)}
                  onPointerUp={() => segurar(false)}
                  onPointerLeave={() => segurar(false)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="mt-8 flex select-none items-center gap-4 rounded-full border border-white/20 bg-white/5 py-3 pr-6 pl-3 backdrop-blur touch-none"
                >
                  <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                    <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="2" />
                    <circle
                      ref={anelRef}
                      cx="22" cy="22" r="20" fill="none" stroke="#e8e8ea" strokeWidth="2"
                      strokeDasharray="126" strokeDashoffset="126" strokeLinecap="round"
                    />
                  </svg>
                  <span className="font-mono text-xs tracking-[0.2em] uppercase">Segure para focar</span>
                </button>
              )}

              {s.id === "desmontada" && (
                <button
                  onClick={() => setPlanta((v) => !v)}
                  className="mt-8 rounded-full border border-white/20 bg-white/5 px-6 py-3 font-mono text-xs tracking-[0.2em] uppercase backdrop-blur"
                >
                  {planta ? "Ver o metal" : "Modo planta"}
                </button>
              )}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
