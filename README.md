# Lente 3D · uma lente de câmera feita só de código

Site de produto com uma lente 50mm f/1.4 (marca fictícia "SR Optics") **desenhada ao vivo no navegador**: nenhum vídeo, nenhum modelo 3D baixado. Cada anel, vidro e friso é geometria criada em código com three.js, em milímetros reais.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · three.js

## O que tem
- **Peças em código:** cada peça redonda nasce de um perfil 2D girado em torno do eixo (como num torno), com chanfros finos para pegar luz. Anel de foco com 90 frisos numa única `InstancedMesh`.
- **Materiais físicos:** `MeshPhysicalMaterial` com textura de metal escovado gerada em código; vidros que só refletem o ambiente, com o reflexo colorido do tratamento antirreflexo (iridescência).
- **Estúdio fotográfico dentro da cena:** softbox e luzes em faixa viram o ambiente refletido (PMREM); o cursor (ou a inclinação do celular) gira as luzes.
- **Câmera guiada pela rolagem:** 5 marcações presas às seções da página, enquadradas por tamanho, não por distância (funciona igual no celular e no monitor).
- **Vista explodida** escalonada (as peças de fora saem primeiro e voltam por último), com etiquetas em duas colunas e linhas-guia que não se cruzam.
- **Modo planta:** um botão troca as superfícies só pelas arestas.
- **"Segure para focar":** o anel gira, a helicoide avança e cada dente faz um clique sintetizado com Web Audio (sem arquivo de áudio).
- **Um relógio só** para todo movimento, com câmera lenta no close.
- **Pós-processamento:** MSAA, HDR, bloom só nos brilhos, granulação e tom ACES.
- **Leve e estável:** shaders compilados antes de mostrar; qualidade adaptativa (abaixo de 40 fps baixa a resolução e depois desliga o bloom).

## Como rodar
```bash
npm install
npm run dev
```
Abra http://localhost:3000 e role a página.

**Modo foto** (para conferir uma seção parada): `?p=0` a `?p=4` vai direto para cada seção; `&planta=1` liga o modo planta; `&foco=0.6` fixa o foco; `&bloom=0` desliga o bloom.

## Estrutura
- `src/lente/pecas.ts`: geometria e materiais de cada peça
- `src/lente/motor.ts`: cena, estúdio, câmera, vista explodida, som, pós-processamento
- `src/components/Experiencia.tsx`: página, seções e rolagem

Baseado no guia "Build 3D Websites That Run Live" (@uijonah, Parallel Studios), adaptado para uma lente.

---
Feito por [Samuel Rogério](https://srcs-portifolio.vercel.app) · [LinkedIn](https://www.linkedin.com/in/samuel-rogerio/)
