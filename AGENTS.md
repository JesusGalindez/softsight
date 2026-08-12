# AGENTS.md

Softsight: rasterizador 3D por software —sin GPU, sin dependencias en el núcleo— y banco
headless para agentes. JSON dentro, JSON y PNG deterministas fuera. Esto es lo que hay que
saber antes del primer comando; corto a propósito —el techo son 120 líneas y una prueba lo
comprueba— y todo lo demás son punteros, no copias.

## Lo primero

```bash
npm run verify
```

Tipos y las puertas, la misma orden que ejecuta CI. Si esto está en rojo, no sigas.

## Dónde va un cambio

Cuatro identidades, de dentro hacia fuera. Confundirlas es la causa habitual de que un
cambio rompa lo que no tocaba.

1. **Núcleo de render** — `src/soft/*.ts` sin `agent/`. Rasterizado puro. No sabe qué es
   un GLB ni qué es un aviso.
2. **Banco de agentes** — `src/soft/agent/`. Carga, auditoría, parches, pliego,
   animación. Es la biblioteca que produce el JSON.
3. **CLI** — `tools/agent3d.mjs`. JSON a stdout, progreso a stderr, salida 1 si hay
   un defecto —un aviso de severidad `certeza`— y 2 si el error es de datos.
4. **Demo de navegador** — `soft.html` + `src/soft/softMain.ts`. Prueba que el mismo
   código corre sin Node. **No es el producto.**

**La regla:** si necesita saber qué es un fichero, no va en la capa 1; si necesita saber
qué es un argumento de línea de órdenes, no va en la capa 2.

## Las tres invariantes que rompen el producto

1. **`Mat4` es row-major**, `m[fila * 4 + columna]`, y los vectores se multiplican por la
   derecha (`src/soft/math.ts`). Media biblioteca de 3D usa la otra convención; mezclarlas
   da matrices transpuestas que a veces parecen funcionar.
2. **`validate` rechaza las claves desconocidas** (`src/soft/agent/schema.ts`). No es
   estrictez decorativa: `positon` en vez de `position` tiene que salir con sugerencia, no
   ignorarse en silencio. El esquema **es** el validador, así que no puede divergir.
3. **Cambiar la aritmética o un hash obliga a subir `contractVersion`.** Está en
   `tools/agent3d.mjs`. Las puertas rechazan versiones viejas, así que el olvido se
   convierte en fallo de puerta y no en un número silenciosamente distinto. Si una
   optimización mueve un `renderHash`, para y dilo.

## Descubrir el contrato sin leerse el repositorio

```bash
node tools/agent3d.mjs --schema patch     # solo esa parte, 12 KB en vez de 46
node tools/agent3d.mjs --schema codes     # qué avisos existen y cuáles traen arreglo
node tools/agent3d.mjs --model x.glb --inspect-only --summary
```

`--schema` sin argumento devuelve todo; las partes son
`scene|patch|story|staging|sample|report|codes`, y el completo se construye uniéndolas.
`--summary` y `--fields "warnings,spatial.floating"` recortan el informe: son proyecciones
sobre el objeto ya construido y **no recalculan nada**.

El registro de códigos vive en `src/soft/agent/warningCodes.ts` y es el tipo del campo
`code`: emitir uno que no esté en la tabla no compila. `severity` distingue **certeza**
—aritmética que no depende de la intención— de **candidato** —medida firme, conclusión
abierta—; tratarlos igual lleva a «arreglar» piezas que estaban bien.

## Órdenes

<!-- generado: comandos -->
| Orden | Para qué |
|---|---|
| `npm run verify` | **Lo primero y lo último.** Tipos y las puertas, la misma orden que ejecuta CI |
| `npm run agent3d` | `vite build --config vite.node.config.ts --logLevel error 1>&2 && node tools/agent3d.mjs` |
| `npm run bridge` | `node tools/bridge.mjs` |
| `npm run colmap-small-v1` | `node tools/colmapSmall.mjs` |
| `npm run cube-v1` | `npm run build:agent3d && node tools/cubeV1.mjs` |
| `npm run filmstrip` | `npm run build:agent3d --silent && node tools/filmstrip.mjs` |
| `npm run reconstruction` | `npm run build:agent3d && node tools/reconstruction.mjs` |
| `npm run worker` | `node tools/workerServer.mjs` |
<!-- /generado: comandos -->

## Puertas

Ninguna fase se cierra por revisión visual: se cierra cuando dos caminos independientes
dan el mismo número. `npm run test:animation` las corre todas menos `test:determinism`,
`test:worker` y `test:model-cache`; sueltas sirven para iterar sobre una.

<!-- generado: puertas -->
`npm run test:agents-md` · `npm run test:bind` · `npm run test:blend-contract` · `npm run test:bounds-tree` · `npm run test:bridge` · `npm run test:bvh` · `npm run test:codes` · `npm run test:colmap` · `npm run test:contracts` · `npm run test:determinism` · `npm run test:framing` · `npm run test:geometry` · `npm run test:glb-writer` · `npm run test:gltf-frame` · `npm run test:incremental` · `npm run test:mcp` · `npm run test:model-cache` · `npm run test:reconstruction` · `npm run test:resources` · `npm run test:rig` · `npm run test:screen` · `npm run test:story` · `npm run test:summary` · `npm run test:text` · `npm run test:text-plan` · `npm run test:worker`
<!-- /generado: puertas -->

Cinco de ellas leen el fixture certificado del editor, que vive en un repositorio privado.
Sin él se declaran «no ejecutada» con su motivo y salen 0; `SOFTSIGHT_FIXTURES` cambia la
ruta. En CI eso significa que el verde cubre tipos, determinismo y 16 de 21 puertas.

## Banderas del CLI

La explicación de cada una está en `--help`, que es donde vive.

<!-- generado: banderas -->
`--model` · `--scene` · `--bvh` · `--patch` · `--dry-run` · `--undo` · `--control-poses` · `--sample` · `--frames` · `--fps` · `--skeleton` · `--bind` · `--audit-frames` · `--bvh-scale` · `--bvh-clip` · `--story` · `--reading-rate` · `--staging` · `--contrast-ratio` · `--out` · `--export` · `--save-scene` · `--inspect-only` · `--summary` · `--fields` · `--select` · `--select-where` · `--isolate` · `--audit-limit` · `--tile` · `--ground` · `--material-colors` · `--baseline` · `--baseline-report` · `--expect-size` · `--max-triangles` · `--max-parts` · `--require-watertight` · `--max-boundary-edges` · `--max-degenerate` · `--max-symmetry-error` · `--parity` · `--no-cache` · `--schema` · `--serve` · `--debug` · `--help`
<!-- /generado: banderas -->

## A dónde ir después

- [`docs/mapa-del-proyecto.md`](docs/mapa-del-proyecto.md) — de quién es cada dato, las
  puertas y **qué toca ahora** (§5). Ningún otro sitio lleva la cuenta.
- [`README.md`](README.md) — qué hace y cómo se usa, con las medidas al lado.
- [`docs/plan-omega.md`](docs/plan-omega.md) — el plan en curso: coste por turno, modo
  residente, MCP.
- [`docs/plan-renderizador.md`](docs/plan-renderizador.md) — los descartes con su medida;
  se lee antes de proponer una optimización, no después.

Nota de frontera: un `~/AGENTS.md` global y este son cosas distintas. Este habla del
repositorio, no del estilo de trabajo.
