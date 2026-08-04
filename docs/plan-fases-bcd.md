# Plan: animación certificada (B), superficie animada (C) y puente local (D)

Estado: **B está hecha y verificada** —el gate del editor la acepta con 4/4 poses
de control—; de B solo queda la deuda estructural aparcada (B-R2): **B-R1 está
hecho** (el evaluador es API pública) y **B-R3 está hecho** (robustez ante datos
defectuosos). De C están hechas **C1–C5**: referencias, muestreo y evaluador de
muestras con el CLI `--sample` (C1–C3), la certificación cruzada en el editor
(C4, `sample-gate`, verificado bit a bit contra Three.js) y la integración del
attach en el renderer (C5, deforma solo los vértices que las partículas leen).
**D está hecha**: el puente local (`tools/bridge.mjs`) habla JSON con el editor,
el import de un paso (`softsight-import.mjs`) regenera el paquete idéntico al
manual, y el smoke test e2e pasa por el puente cada caso del gate con el mismo
resultado que el CLI directo. Escrito el
2026-08-03 tras verificar B de extremo a extremo:
nuestro `agent3d` contra `jumping-jacks.glb` produce el contrato
(`animation.contractVersion=1`, `skinning.status=accepted`, 4 hashes de pose
coincidentes) y el gate del editor responde `accepted` con `--strict`.

## Principio rector

Lo que el editor calcula por su cuenta pero no está certificado es deuda. La
excepción local de `getVertexPosition()` en `renderer-spike.ts` ya no existe:
desde C5 el renderer usa `evaluateVertexPosition` del módulo compartido, que es
lo que el sample-gate compara con SoftSight. Cada fase se cierra con un **hash
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

### B-R1. Publicar el evaluador como API del núcleo — hecho

El evaluador está publicado en `src/soft/agent/animation.ts` (re-exportado por
`src/soft/agent/index.ts` → `dist-node/agent3d.mjs`):

- `parseGlbAnimation(buffer, decoder?) → ParsedGlb` — el parser del árbol de
  nodos con las vistas meshopt decodificadas. Se llama `parseGlbAnimation` (no
  `parseGlb`) porque `glbLoader` ya exporta un `parseGlb` con otra forma: ese
  aplasta el árbol a piezas de modelo, este lo conserva para el skinning.
- `evaluatePose(document, binary, decodedViews, time, meshIndex, clipIndex = 0)
  → Float32Array` — posiciones deformadas de la malla en un tiempo dado (segundos),
  una por instancia en orden de escena. `clipIndex` elige el clip; fuera de rango
  devuelve la pose estática.
- `evaluatePoseWithNormals(...)` — la misma cadena para normales: base → morph →
  skinning como dirección (sin traslación) → normalización, la semántica de los
  sombreadores de Three.js. **Pendiente de certificación cruzada: esa es la puerta
  de la Fase C.**
- Piezas componibles exportadas: `buildNodeStates`, `applyAnimation` (resolución
  de `NodeState` por clip y tiempo), `applyMorphTargets`, `applySkin`.

El CLI no cambió: `inspectGlbAnimation` sigue saliendo del mismo sitio y
`hashSkinnedVertices` comparte ahora `evaluateMeshAtNode` con la API pública, así
que la certificación y `evaluatePose` son literalmente el mismo código.

**Criterio de salida:** `test:animation` pasa sin cambios en el fixture (los 4
frames de control evaluados con `evaluatePose` dan los mismos hashes que la
referencia, y el morfo da los suyos por la misma API).

### B-R2. Unificar el árbol de nodos en `glbLoader.ts` — decidido: no hacer aún

El cambio estructural que el plan anterior anotaba (la animación necesita el
árbol; el cargador aplana) sigue siendo real, pero ya no bloquea nada: el parser
de `animation.ts` funciona y está certificado. Refactorizar el cargador ahora
arriesgaría las 296 piezas del dron sin que ningún consumidor lo exija. **Regla:
solo cuando C necesite una pieza concreta que hoy no tenga (múltiples mallas por
nodo, instancias con skin, UVs deformados), se unifica, y siempre con el banco
de no regresión por delante.**

### B-R3. Robustez del evaluador — hecho

Cada caso es un error de datos con su mensaje (y salida 2 por el CLI, que
traduce las excepciones), no un aviso:

- Canales con nodo objetivo inexistente, sampler ausente y path desconocido:
  `applyAnimation` los rechaza con el canal y el clip en el mensaje.
- Joints fuera de rango: a nivel de vértice (`JOINTS_0` apunta fuera de la skin)
  y a nivel de skin (un joint que no es un nodo del documento), en
  `totalInfluenceWeight` y `buildJointMatrices`.
- Pesos negativos o no finitos: `totalInfluenceWeight` los rechaza.
- `inverseBindMatrices` ausentes, incompletas (menos de `joints × 16`
  componentes) o que no son `MAT4`: `buildJointMatrices`.
- `JOINTS_1`/`WEIGHTS_1` presentes: solo se soportan 4 influencias por vértice.
- Accesors sparse: `readAccessor` los rechaza.
- Múltiples escenas y GLB malformados: `parseGlbAnimation`.

El fichero `tools/glb-loader.test.mjs` construye un GLB mínimo por caso (un
vértice, un joint, un clip), comprueba el mensaje de cada defecto y verifica que
un GLB sano evalúa igual dos veces y sigue pasando la certificación completa.

**Criterio de salida:** cada caso produce un error con el nombre del defecto, y
un GLB sano no cambia su hash de pose (`test:animation` lo comprueba).

---

## Fase C — Superficie animada

Objetivo: que una partícula adherida se evalúe en cualquier frame con la misma
semántica que SoftSight certifica, y que el editor la use en vez de
`getVertexPosition()` sin certificar.

### C1. Referencia serializable — hecho

Esquema `SAMPLE_REFERENCE_SCHEMA` en `schema.ts` (publicado, como el de escena
y parche):

```json
{ "mesh": "Skinned Mesh 0", "primitive": 0, "triangle": 1234,
  "barycentric": [0.2, 0.3, 0.5] }
```

- `mesh` se resuelve por nombre de malla, por nombre del primer nodo que la
  instancia (el exportador del fixture deja la malla anónima), o por `malla N`.
- `triangle` es el índice del triángulo en el búfer de índices de la primitiva
  (secuencial si no hay búfer); `barycentric` suma 1 (el tercer peso se puede
  omitir).
- La forma la valida el esquema publicado (con sugerencias para campos
  inventados); la semántica —malla existente, primitiva y triángulo en rango,
  pesos no negativos que sumen ~1 (tolerancia 1e-3)— la valida
  `validateSampleReference` contra el documento. Una referencia escrita a mano
  que no apunta a ningún sitio se caza con el error y la corrección dentro.

### C2. Muestreo por triángulo con baricéntricas estables — hecho

`sampleSurface(document, binary, decodedViews, { count, seed })` formaliza el
`findWeightedTriangle` del editor. El orden y el algoritmo son contrato:

- Una sola lista global de triángulos: mallas distintas en orden de escena
  (primer nodo que las instancia), primitivas en orden, pesos de raíz de área
  (dobles áreas por producto vectorial, en doble precisión); los triángulos
  degenerados nunca se sortean.
- PRNG mulberry32 con la semilla, en este orden de consumo: sorteo del
  triángulo y luego dos uniformes para la baricéntrica uniforme en el
  triángulo (`[1-√u, √u·(1-v), √u·v]`). Misma semilla y mismo GLB → misma lista.
- El CLI gana `--sample refs.json --frames "0,15,30,37" [--fps 30]`
  (repetible) que valida las referencias y emite `sample.frames` con
  `positionsHash`/`normalsHash` por fotograma.

### C3. Evaluador de muestra en cualquier frame — hecho

`evaluateSample(document, binary, decodedViews, time, reference, clipIndex)`
aplica la misma cadena que las poses de control —base → morph → skinning →
normal deformada— y luego interpola la baricéntrica **en doble precisión**,
`b0·P0 + b1·P1 + b2·P2` de izquierda a derecha, redondeando a float32 solo al
devolver: redondear antes de interpolar cambiaría el resultado respecto al
renderer, que interpola sus propios vértices en doble precisión. Los UV se
interpolan sin deformar (son por vértice y estáticos). Una muestra sobre un
vértice (`barycentric [1,0,0]`) coincide bit a bit con la pose de control de ese
vértice, porque las dos salen del mismo código; lo comprueba `test:animation`.
`normalsHash` es nulo si alguna referencia apunta a una primitiva sin NORMAL:
no se inventan normales.

**Criterio de salida (resto de la fase):** `npm run softsight:gate --strict` y el
`sample-gate` responden `accepted`; un cambio de un vértice en cualquiera de los
dos lados cambia el hash correspondiente.

### C4. Certificación cruzada — la puerta de la fase — hecho

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

Notas de la implementación:
- `scripts/create-sample-contract.mjs` genera el contrato con Three.js:
  `SkinnedMesh#getVertexPosition` para posiciones, y para normales la cadena
  documentada (base → morph → dirección por `bone.matrixWorld · boneInverse` →
  normalización con `Math.hypot` y división directa), porque Three.js no expone
  normales skinnadas por CPU. Los pesos se toman del atributo tal cual:
  `GLTFLoader` ya los normaliza en la carga, exactamente como el `Math.fround`
  de SoftSight.
- Bugs encontrados al cruzar: `BufferAttribute.getComponent(index, component)`
  invierte los argumentos (causaba `totalWeight = 2` con pesos `[0.5, 0.5]`);
  GLTFLoader renombra los nodos con espacio a guion bajo (`Skinned Mesh 0` →
  `Skinned_Mesh_0`), así que el contrato compara nombres normalizados.
- Verificado bit a bit: `sample-gate` y `animation-gate` responden `accepted`
  (4 checks cada uno) contra el mismo `jumping-jacks.softsight-native.json`
  regenerado con `--control-poses` + `--sample`.
- `check-softsight-sample-gate.test.mjs` (vitest): acepta el fixture publicado y
  mantiene `pending` ante informe sin bloque `sample`, hash de posiciones o de
  normales distinto, frame faltante y contrato inválido.

### C5. Integración en el editor — hecho

El attach ya guardaba la referencia completa en cada muestra
(`ParticleModelSample`: triángulo + barycentric + jitter, verificado en C2); lo
que faltaba era deformar **solo** esos vértices por frame. Hoy:

- `src/engine/sample-evaluation.ts` (editor) centraliza el evaluador certificado:
  `evaluateVertexPosition`, `evaluateVertexNormal`, `sampleBarycentric`
  (b0·P0+b1·P1+b2·P2 en doble precisión), `resolveReferenceTriangles`,
  `referencedVerticesByMesh` y `referencedVerticesFromSamples`.
- `create-sample-contract.mjs` importa ese módulo (sin duplicar la cadena de
  normales) y regenera el contrato idéntico byte a byte: verificado con
  `--frames 0,15,30,37` tras el refactor.
- `updateSkinnedParticlePositions()` en `renderer-spike.ts` usa
  `referencedVerticesFromSamples` (unión de first/second/thirdIndex de
  source+target samples) + `referencedVerticesByMesh` (índices globales →
  locales por malla) y deforma solo esos vértices; si no hay muestras de modelo
  (ninguna forma es `model`), cae al barrido completo anterior. El resto del
  buffer conserva la pose estática, que `updateParticleMorphModelPositions` no
  consulta.
- `sample-evaluation.test.ts` (vitest) cubre la premisa: deformar solo los
  vértices referenciados produce exactamente el mismo morph que deformarlos
  todos (mesh de 3 triángulos con vértices sin referencia que los distinguen).

La excepción local de `getVertexPosition()` del principio de este plan ya no
existe: el renderer usa `evaluateVertexPosition` del módulo compartido, que es
lo que el sample-gate compara con SoftSight.

---

## Fase D — Puente local — hecho

Objetivo cumplido: el navegador no ejecuta el CLI; `tools/bridge.mjs` recibe
JSON por stdin, invoca a SoftSight, limita rutas y devuelve informe +
artefactos. La forma del puente sale del contrato publicado (`--schema`) y no
puede divergir.

### D1. El proceso — hecho

`tools/bridge.mjs` en SoftSight: JSON por stdin, JSON por stdout. El puente
**es** el CLI (`tools/agent3d.mjs`), no un wrapper que lo invoca por shell:
recibe la petición y la ejecuta en el mismo proceso.

```json
{ "command": "inspect", "model": "drone.glb", "controlPoses": "poses.json",
  "options": { "inspectOnly": true } }
→ { "bridgeContractVersion": 1, "command": "inspect", "exitCode": 0,
    "report": { ... }, "artifacts": [...] }
```

Comandos: `inspect` (informe), `render` (pliego + informe + hashes), `patch`
(parches + baseline → diff + undo), `sample` (referencias → hashes), `schema`
(contrato en vivo). Los errores de datos son JSON con `code` y salida 2, nunca
volcados de pila; los fallos de SoftSight se reflejan con su mismo `exitCode`
(1) y `message`. Códigos `BridgeError`: `invalid-request`, `invalid-file-name`,
`file-too-large`, `data-error`, `bridge-timeout`, `bridge-spawn-error`,
`artifact-too-large`, `bridge-internal`. El puente no usa el binario intermedio
del proceso hijo: `render` y `sample` devuelven el artefacto directamente en
JSON (base64) y el proceso hijo de node solo existe para el timeout real.

### D2. Sandbox — hecho

- Directorio de trabajo dedicado por petición (`mkdtemp`); nombres planos
  `^[A-Za-z0-9][A-Za-z0-9._-]*$` — `..`, rutas absolutas y separadores se
  rechazan con `invalid-file-name`.
- Límites configurables por env: `SOFTSIGHT_BRIDGE_MAX_REQUEST_MB` (32),
  `SOFTSIGHT_BRIDGE_MAX_FILE_MB` (256), `SOFTSIGHT_BRIDGE_MAX_ARTIFACT_MB`
  (64), `SOFTSIGHT_BRIDGE_TIMEOUT_MS` (120000).
- Sin shell: solo `execFile` con argumentos fijos; el puente no expande
  variables ni patrones.

### D3. Contrato del puente desde `--schema` — hecho

`--schema` de `agent3d.mjs` publica ahora también `sampleReference` junto a
`scene`, `patch` y `reportExample`. El cliente del editor (`fetchBridgeSchema`
en `src/assets/softsight-bridge.ts`) descarga el esquema en vivo y valida la
respuesta contra él (`validateAgainstSchema`/`assertValidAgainstSchema`) en
lugar de fiar solo de tipos escritos a mano —que es como divergieron los
`warnings` de `string[]` a objetos.

### D4. Cliente en el editor — hecho

- `src/assets/softsight-bridge.ts`: `runBridge` (spawn + parse + validación de
  `bridgeContractVersion`), `resolveBridgePath` (`--bridge` → env
  `SOFTSIGHT_BRIDGE` → `../../Dron/softsight/tools/bridge.mjs`), `BridgeError`.
- `scripts/softsight-import.mjs`: importación en un paso (sustituye el flujo
  manual de `create-softsight-package.mjs`): poses de control
  (`create-control-pose-fixture.mjs`) → `inspect` + `render` por el puente →
  `animationStatus` por la puerta → manifiesto + informe en `public/softsight/`.
  Rechaza la licencia placeholder. Con `--patch` aplica parches; `--force`
  y `--accept-warning` para sobrescribir y pasar de avisos.
- El paquete generado por el import es idéntico al manual: reportHash
  `86ba5026…` y assetHash `7b6d0442…` con el commit `73b41588` del contrato.

### D5. Smoke test end-to-end — hecho

Dos niveles:

- `tools/bridge.test.mjs` (softsight): cada caso del gate por el puente da los
  mismos resultados que el CLI directo, con el mismo código de salida —
  `schema` publicado, `inspect` == informe nativo, `render` == pliego y
  renderHash, `patch` + `baseline` → diff y undo, `sample` == hashes, y errores
  de petición y de datos. Se normaliza `source`, `totalMilliseconds` y
  `view.milliseconds` en las comparaciones.
- `src/assets/softsight-bridge.test.ts` + `scripts/softsight-import.test.mjs`
  (editor): resolución de ruta, esquema, `inspect`, conversión de errores a
  `BridgeError`, validación de esquema, y el import de extremo a extremo contra
  el puente real (rechazo de licencia y coherencia del paquete con el fixture).
  Las pruebas de puente se saltan con `describeBridge` si el puente no existe
  en la máquina.

---

## Orden y qué no hacer todavía

Orden: **B-R3 → C1–C5 → D1–D5** (B-R2 queda aparcado salvo que C lo
exija). Cada paso deja el repo verde y el fixture sin cambios de hashes salvo
que el paso lo declare.

No hacer: rigging, IK, retargeting, cloth, fluidos, LOD, atlas de texturas.
Convierten SoftSight en un Blender para agentes; hoy es un banco de verificación
y ese es su valor diferencial. Tampoco unificar el cargador (B-R2) mientras no
haya un consumidor que lo pague.
