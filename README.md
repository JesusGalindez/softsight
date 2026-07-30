# softsight

Rasterizador 3D por software —sin GPU y sin dependencias— con un banco de trabajo
headless para agentes de IA: carga GLB y OBJ, renderiza pliegos de contactos, audita
topología y aplica parches. Entra y sale JSON.

El dron que aparece en los ejemplos es el **espécimen de pruebas**: un modelo de 296
piezas con nombres semánticos, generado proceduralmente, que resulta excepcionalmente
bueno para ejercitar la carga jerárquica, la selección por patrón y las auditorías.

## Arrancar

```bash
npm install
npm run dev
```

| Página | Qué es |
|---|---|
| `/soft.html` | **Rasterizador software**: pipeline completo en CPU |
| `/soft.html?bench=24` | Banco determinista, imprime el informe en pantalla |
| `/soft.html?workers=8` | Fuerza N hilos para medir el paralelo por bandas |

En `/soft.html` puedes **soltar un `.glb` o un `.obj`** sobre el visor, o usar los
botones para cargar los del repositorio.

## Banco de trabajo para agentes

Escena o modelo dentro, pliego de contactos PNG y diagnóstico JSON fuera. Sin GPU,
sin navegador, sin servidor.

```bash
# Escena declarativa
npm run agent3d -- --scene artifacts/agent/ejemplo-dron.json --out revision.png

# Modelo real, con selección por patrón, parche y exportación
npm run agent3d -- --model artifacts/export/drone.glb \
  --select "rotor-*,propeller-*" \
  --patch artifacts/agent/patch-rotores.json \
  --export salida.obj --out revision.png
```

`stdout` es JSON puro y el código de salida es 1 si hay avisos, así que encadena en
CI sin interpretar nada. Opciones: `--tile N`, `--isolate true`, `--audit-limit N`,
`--ground false`, `--debug`.

El informe trae, además del pliego: auditoría topológica por pieza —aristas de borde,
no manifold, triángulos degenerados, normales invertidas, desviación del pivote,
error de simetría—, resumen por familias de piezas y avisos redactados como
diagnóstico, no como métricas.

## Qué hay dentro

| Módulo | Contenido |
|---|---|
| `math.ts` | 4×4 row-major, matriz de normales, inversa afín |
| `projection.ts` | Perspectiva y ortográfica con profundidad invertida, planos del frustum |
| `clip.ts` | Recorte del plano cercano en espacio homogéneo |
| `raster.ts` | Span exacto, gradientes incrementales, regla top-left, curva ACES, dither |
| `shading.ts` | Blinn-Phong, ambiente hemisférico, filtrado analítico de textura |
| `shadowMap.ts` | Mapa de sombras direccional con profundidad lineal |
| `renderer.ts` | Orquestación: visibilidad, vértices, recorte, rasterizado, postproceso |
| `present.ts` | Buffer interno desacoplado del canvas visible |
| `resolutionController.ts` | Resolución adaptativa con modelo de coste ajustado en vivo |
| `parallel.ts`, `renderWorker.ts` | Paralelo por bandas con reparto adaptativo |
| `agent/` | Lectores GLB/OBJ, modelo direccionable, auditoría, pliego de contactos |

Dependencias: **ninguna** en el núcleo. `meshoptimizer` es opcional y se carga bajo
demanda, solo si abres un GLB comprimido con `EXT_meshopt_compression`.

## Documentación

- [`docs/software-renderer.md`](docs/software-renderer.md) — cómo funciona y por qué:
  la matemática de la proyección, cada optimización con su medida, el banco de
  agentes, y qué formato conviene importar.
- [`docs/plan-renderizador.md`](docs/plan-renderizador.md) — el plan por fases con lo
  hecho, lo medido y lo pendiente. Incluye las ideas que se **descartaron por
  medida**, que suelen ser más útiles que las que funcionaron.
- [`docs/plan-agentes.md`](docs/plan-agentes.md) — plan para que un agente verifique
  sus cambios en vez de mirarlos: comparación de renders, auditorías espaciales entre
  piezas, consultas baratas y memoria entre llamadas.

## Cómo medir antes de optimizar

Tres herramientas, y conviene usarlas en este orden:

1. **Contadores deterministas** (`__softBench`): triángulos rasterizados, píxeles
   recorridos y sombreados. Son exactos y comparables entre sesiones. Si un cambio
   pretende ser exacto, estos números no deben moverse.
2. **Micro-banco aislado** en la consola, para atribuir un cambio concreto. El ruido
   del entorno es de ±25 % y se come cualquier mejora menor del 30 %.
3. **Barrido de resolución** con ajuste de `ms = fijo + porPíxel · píxeles`, para
   saber si lo que estorba es la geometría o el relleno. Las dos veces que me salté
   este paso, optimicé el término equivocado.

## Licencia

Apache-2.0. Copyright 2026 Jesús Galindez. Ver [`LICENSE`](LICENSE).

Sin dependencias en el núcleo. La única opcional, `meshoptimizer`, es MIT y solo se
carga si abres un GLB comprimido con `EXT_meshopt_compression`.
