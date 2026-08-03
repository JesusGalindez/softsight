# Plan: animación certificada (B), superficie animada (C) y puente local (D)

Estado: **B está hecha y verificada** —el gate del editor la acepta con 4/4 poses
de control—; lo que queda de B es deuda estructural y robustez. C y D están por
hacer, en este orden. Escrito el 2026-08-03 tras verificar B de extremo a extremo:
nuestro `agent3d` contra `jumping-jacks.glb` produce el contrato
(`animation.contractVersion=1`, `skinning.status=accepted`, 4 hashes de pose
coincidentes) y el gate del editor responde `accepted` con `--strict`.

## Principio rector

Lo que el editor calcula por su cuenta pero no está certificado es deuda. La
excepción local de hoy es `getVertexPosition()` en `renderer-spike.ts:676` —el
`SkinnedMesh` de Three.js aplica morph + skinning con su propia semántica, sin
que nadie la haya comparado con la nuestra—. Cada fase se cierra con un **hash
cruzado**: las mismas referencias, evaluadas por SoftSight y por Three.js, dan
el mismo número. Sin ese número, la fase no está cerrada.

---

## Fase B — Contrato de animación

### B1. Leer animations y skins — hecho

`src/soft/agent/animation.ts` (739 líneas) implementa un parser GLB completo:
árbol de nodos, TRS, `inverseBindMatrices`, skinning a 4 influencias, morph
targets de posición, interpolación STEP/LINEAR/CUBICSPLINE con slerp de
cuaterniones, evaluación por tiempo absoluto y decodificador `meshopt` bajo
demanda. No comparte código con `glbLoader.ts`: reimplementa el parser porque el
cargador aplana la jerarquía al cargar.

### B2. Poses de control — hecho

`--control-poses` valida la referencia (`schemaVersion 1`, `fps`, `clips` con
`{frame, positionsHash}`), evalúa las poses y escribe `positionsHash` SHA-256 de
las posiciones deformadas, `Float32` little-endian, orden original de vértices.
El informe trae los bloques `animation`, `skinning`, `morphTargets`,
`controlPoses` y `animationErrors`.

### B3. Verificación — hecho

- `npm run test:animation` pasa (`animation contract: ok`).
- Gate del editor: `status: accepted`, `geometry: accepted`, `animation:
  accepted`, `controlPoseChecks: 4/4`, `reasons: []`.
- Fixture `jumping-jacks` regenerado: informe nativo con `contractVersion: 2`,
  manifiesto con commit `73b4158` y `animationStatus: accepted`.

### B-R1. Publicar el evaluador como API del núcleo — pendiente (antes de C)

Hoy el evaluador vive privado dentro de `animation.ts` y su `parseGlb` es una
reimplementación. C y D necesitan «evaluar una muestra en cualquier frame» sin
reparsear el GLB cada vez.

- Exportar del núcleo: `parseGlb` (o su resultado `ParsedGlb`), y las piezas de
  evaluación `buildNodeStates`, `applyMorphTargets`, `applySkin` y la resolución
  de `NodeState` por clip en un tiempo dado.
- Una sola entrada pública del tipo `evaluatePose(document, binary, views,
  time, meshIndex) → Float32Array` que devuelva las posiciones deformadas, y su
  variante con normales (`evaluatePoseWithNormals`).
- El CLI no cambia: los bloques del informe siguen saliendo del mismo sitio.

**Criterio de salida:** `test:animation` pasa sin cambios en el fixture, y el
mismo `evaluatePose` que usa el CLI lo usa un test nuevo que evalúa los 4 frames
de control y da los mismos hashes.

### B-R2. Unificar el árbol de nodos en `glbLoader.ts` — decidido: no hacer aún

El cambio estructural que el plan anterior anotaba (la animación necesita el
árbol; el cargador aplana) sigue siendo real, pero ya no bloquea nada: el parser
de `animation.ts` funciona y está certificado. Refactorizar el cargador ahora
arriesgaría las 296 piezas del dron sin que ningún consumidor lo exija. **Regla:
solo cuando C necesite una pieza concreta que hoy no tenga (múltiples mallas por
nodo, instancias con skin, UVs deformados), se unifica, y siempre con el banco
de no regresión por delante.**

### B-R3. Robustez del evaluador — pendiente

Cada caso es un error de datos con su mensaje y salida 2, no un aviso:
canales con nodos inexistentes, samplers ausentes, paths desconocidos, joints
fuera de rango, pesos negativos, `inverseBindMatrices` incompletas,
`JOINTS_1`/`WEIGHTS_1`, accessors sparse, múltiples escenas y GLB malformados.
Algunos ya se detectan (morph targets no certificables, IBM ausentes); el resto
está por escribir. Un fichero `glb-loader.test.ts` con un GLB mínimo por caso.

**Criterio de salida:** cada caso produce un error con el nombre del defecto, y
un GLB sano no cambia su hash de pose.

---

## Fase C — Superficie animada

Objetivo: que una partícula adherida se evalúe en cualquier frame con la misma
semántica que SoftSight certifica, y que el editor la use en vez de
`getVertexPosition()` sin certificar.

### C1. Referencia serializable

Esquema en `schema.ts` (publicado, como el de escena y parche):

```json
{ "mesh": "Skinned_Mesh_0", "primitive": 0, "triangle": 1234,
  "barycentric": [0.2, 0.3, 0.5] }
```

- `triangle` es el índice del triángulo en el búfer de índices de la primitiva;
  `barycentric` suma 1 (el tercer peso se puede omitir).
- El validador rechaza triángulos fuera de rango y pesos negativos o que no
  sumen ~1. Sin esto, una referencia escrita a mano se caza con sugerencia.

### C2. Muestreo por triángulo con baricéntricas estables

El editor ya tiene la semilla de la técnica en `particle-morph.ts` (`findWeightedTriangle`
con áreas acumuladas y pesos `sqrt` para uniformidad): se formaliza en SoftSight.

- `sampleSurface(model, { count, seed }) → Referencia[]`: distribución uniforme
  por área, semilla fija para que el mismo modelo dé siempre las mismas
  referencias. El orden de salida y el algoritmo van al contrato (como las
  poses de control).
- El CLI gana `--sample refs.json --frames "0,15,30,37"` (repetible) que evalúa
  cada referencia en cada frame y emite `positionsHash`/`normalsHash`.

### C3. Evaluador de muestra en cualquier frame

Base → morph → skinning → normal deformada → UV, con la misma cadena y el mismo
orden que las poses de control (B-R1). El editor recorre la cadena en el mismo
orden; el documento que la define es este plan, no una función privada.

### C4. Certificación cruzada — la puerta de la fase

- Nuevo gate en el editor (`sample-gate`): evalúa las mismas referencias con
  `SkinnedMesh#getVertexPosition` (morph + skinning) y compara
  `positionsHash`/`normalsHash` contra el informe de SoftSight.
- Fixture versionado `jumping-jacks-sample-contract.json` con las referencias,
  los frames y los hashes, generado como las poses de control.
- `renderer-spike.ts:676` deja de ser una excepción: o pasa por el evaluador
  certificado, o se compara contra él en CI en cada cambio.

**Criterio de salida:** `npm run softsight:gate --strict` y el `sample-gate`
responden `accepted`; un cambio de un vértice en cualquiera de los dos lados
cambia el hash correspondiente.

### C5. Integración en el editor

- El attach de partículas guarda la referencia completa (hoy calcula el
  triángulo en el momento del spawn y lo pierde).
- El update por frame usa `renderAt(frame/fps)` ya existente en
  `model-animation.ts` y la referencia, no un lookup por vértice.

---

## Fase D — Puente local

Objetivo: el navegador no ejecuta el CLI; un proceso local que reciba JSON,
invoque a SoftSight, limite rutas y devuelva informe + artefactos. Con el
contrato publicado (`--schema`), la forma del puente sale de SoftSight y no
puede divergir.

### D1. El proceso

`tools/bridge.mjs` en SoftSight (o `scripts/softsight-bridge.mjs` en el editor):
JSON por stdin, JSON por stdout.

```json
{ "command": "inspect", "model": "drone.glb", "controlPoses": "poses.json",
  "options": { "inspectOnly": true } }
→ { "report": { ... }, "artifacts": [] }
```

Comandos mínimos: `inspect` (informe), `render` (pliego + informe + hashes),
`patch` (parches + baseline → diff + `--undo`), `sample` (referencias → hashes).
Los errores de datos son JSON con `code` y salida 2, nunca volcados de pila.

### D2. Sandbox

- Directorio de trabajo dedicado por petición; rutas relativas confinadas a su
  raíz (`..` fuera de ella se rechaza).
- Tamaño máximo de GLB y de artefactos; timeout por petición.
- Sin shell: solo `execFile` con argumentos fijos; el puente no expande
  variables ni patrones.

### D3. Contrato del puente desde `--schema`

El adaptador del editor valida la petición y la respuesta contra el esquema
publicado, no contra tipos escritos a mano —que es exactamente como divergieron
los `warnings` de `string[]` a objetos.

### D4. Cliente en el editor

Al importar un GLB, el puente regenera en un paso informe nativo + poses +
pliego (sustituye el flujo manual de `create-softsight-package.mjs`). La
generación de fixtures pasa por el puente: una sola ruta de importación.

### D5. Smoke test end-to-end

`bridge.test.mjs`: `inspect` → accepted; `patch` + `baseline` → diff coherente;
`sample` → hashes. **Criterio de salida:** cada caso del gate por el puente da
los mismos resultados que el CLI directo, con el mismo código de salida.

---

## Orden y qué no hacer todavía

Orden: **B-R1 → B-R3 → C1–C5 → D1–D5** (B-R2 queda aparcado salvo que C lo
exija). Cada paso deja el repo verde y el fixture sin cambios de hashes salvo
que el paso lo declare.

No hacer: rigging, IK, retargeting, cloth, fluidos, LOD, atlas de texturas.
Convierten SoftSight en un Blender para agentes; hoy es un banco de verificación
y ese es su valor diferencial. Tampoco unificar el cargador (B-R2) mientras no
haya un consumidor que lo pague.
