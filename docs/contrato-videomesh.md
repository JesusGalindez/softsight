# Contrato SoftSight ↔ VideoMesh

Registro de decisiones de la frontera entre los dos proyectos.

**Regla dura: una decisión que no está aquí no existe.** Ni en un plan, ni en un
documento de intercambio, ni en un mensaje. Los documentos que los dos agentes se
han enviado son el historial de cómo se llegó; este fichero es lo que rige.

**Qué no lleva.** El orden de trabajo está en
[`plan-reconstruccion.md`](plan-reconstruccion.md). El estado del proyecto, en
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5.

Última ronda incorporada: respuesta de VideoMesh del 2026-08-12 (D13–D33, P9–P11).

---

## 1. Cómo funciona el registro

### 1.1 Los cuatro estados

```text
PROPUESTA     escrita, sin acuerdo de los dos lados
ACORDADA      los dos lados dijeron que sí — y no basta con eso
IMPLEMENTADA  existe la prueba que falla si la decisión se incumple
REVERTIDA     con fecha y motivo, nunca borrada
```

### 1.2 El criterio de cierre

> Una decisión pasa a IMPLEMENTADA cuando existe una prueba que **falla si la
> decisión se incumple**. No cuando el código está escrito.

**Corolario:** una ACORDADA que lleva semanas sin prueba es deuda y se anota. Un
registro que solo enseña verdes no es el estado, es una foto favorecedora.

### 1.3 El ciclo de una decisión

```text
propuesta → decisión → esquema → fixture → prueba del consumidor → IMPLEMENTADA
```

Nunca se acuerda un campo que solo exista en la documentación.

### 1.4 Los envíos se disparan por evento, no por calendario

**SoftSight publica:** esquemas regenerados y su hash al cambiar cualquiera; un
informe de ejemplo real al cambiar el informe; qué cambió y por qué al mover una
versión; el nombre de cada puerta nueva y qué compara.

**VideoMesh publica:** `cube-v1` al salir de R0; un paquete pequeño que ejerza
una convención **antes** de cambiarla; `colmap-small-v1` al salir de R2; un
paquete que use cada modelo de cámara nuevo.

### 1.5 Desempates

**Números:** si hay puerta cruzada, decide la puerta. Si no la hay, nadie tiene
razón todavía: es deuda certificada y ese número no puede sostener una
certificación.

**Decisiones:** manda la tabla de ownership. Sobre un dato que es de SoftSight
decide SoftSight; sobre uno de VideoMesh decide VideoMesh; sobre un dato de
frontera compartida **no hay cambio hasta que los dos digan sí**, y el estado por
defecto —«no decidido»— bloquea.

### 1.6 Congelación del registro hasta que pase `cube-v1`

Dos rondas han añadido **21 decisiones**. Una tercera podría añadir otras veinte,
y el registro se convertiría en el trabajo en vez de en la herramienta.

**Regla, desde ahora:** no se admiten números de decisión nuevos hasta que
`cube-v1` pase de punta a punta, **salvo los que bloqueen `cube-v1`**. Todo lo
demás se anota como pendiente sin número y espera.

Esto no es burocracia al revés: es la única defensa contra gastar en diseñar el
tiempo que estamos intentando ahorrar.

### 1.7 Lo que no se hace

```text
un tercer repositorio de contratos   todavía no; el hash del esquema basta
un canal en tiempo real              el intercambio son ficheros
reuniones de sincronización          las sustituye este registro
«lo hablamos cuando llegue»          es como se pierde el tiempo
```

---

## 2. Estado del registro

Al 2026-08-12, tras la segunda ronda:

```text
ACORDADAS       30   D1–D27, D30, D31, D33
PROPUESTAS       4   D28, D29, D32, D34 — condicionadas, esperan confirmación
IMPLEMENTADAS    0
```

**Cero implementadas sigue siendo el dato importante.** Treinta y cuatro
decisiones y ninguna prueba. La siguiente ronda no debe añadir decisiones: debe
producir la primera IMPLEMENTADA.

---

## 3. Principios congelados

P1–P8 los escribió VideoMesh en la primera ronda; P9–P11, en la segunda. No se
renegocian sin un cambio registrado aquí.

```text
P1   VideoMesh reconstruye; SoftSight no. SoftSight mide y certifica;
     VideoMesh no duplica su lógica de verdad geométrica.
P2   ausencia de evidencia != evidencia positiva
P3   RECONSTRUCTED != INFERRED, de la malla cruda al asset final
P4   AUDIT_GEOMETRY != PREVIEW_GEOMETRY
P5   todo informe apunta criptográficamente al artifact que evaluó
P6   una aproximación nunca se convierte en silencio en una certeza
P7   handoff V1 = filesystem + rutas + CLI/API
P8   SoftSight no modifica la evidencia original
P9   los adaptadores absorben la ambigüedad de cada backend;
     el contrato canónico la elimina
P10  un paquete sellado es inmutable; cualquier cambio crea una identidad nueva
P11  la paridad cruzada aplica solo a hechos de frontera compartida;
     lo que tiene dueño no se duplica solo para obtener paridad
```

**P11 corrige una formulación nuestra.** Escribimos que una decisión se cierra
cuando «el mismo cálculo hecho por los dos lados da el mismo número», y
generalizarlo obligaría a VideoMesh a reimplementar la cobertura, que es lo
contrario de P1. Las tres categorías de VideoMesh son la formulación correcta:

```text
A  frontera compartida     paridad cruzada obligatoria
   recuentos, caja, cámaras, proyección de puntos, hash de esquema,
   composición de transformaciones

B  propiedad de SoftSight  se valida con fixtures analíticos y valores dorados,
   non-manifold, bordes,   NO reimplementando el motor dos veces
   cobertura, confianza,
   diff, certificación

C  propiedad de VideoMesh  igual, en su lado
   selección de frames, ranking de candidatos, política de torneo
```

---

## 4. Decisiones acordadas

### D1 — Transporte del paquete · ACORDADA
Filesystem y rutas. VideoMesh escribe el paquete en disco y pasa la ruta del
manifest. Nada de base64 en el JSON, nada de streaming, y los límites del puente
no se suben como parche. El puente se queda para el editor y peticiones pequeñas.
**Prueba:** sin escribir.

### D2 — Códigos de aviso · ACORDADA
Código legible en español, como los 40 que ya existen, más un **identificador
neutro y estable** (`SS-RECON-001`). VideoMesh parsea el identificador, nunca el
mensaje. Espacios: `SS-PKG`, `SS-IO`, `SS-GEO`, `SS-RECON`, `SS-CAM`, `SS-COV`,
`SS-CONF`, `SS-PROD`, `SS-LOD`, `SS-UV`, `SS-PBR`, `SS-COLL`.
**Prueba:** `test:codes` extendida a identificadores únicos y estables. Sin escribir.

### D3 — Ejecución y certificación son dos ejes · ACORDADA
```text
ExecutionStatus        COMPLETE | PARTIAL | ERROR | UNSUPPORTED
CertificationVerdict   PASS | FAIL | INCONCLUSIVE
```
Con motivo aparte: `INSUFFICIENT_EVIDENCE`, `UNCERTAINTY_OVERLAPS_THRESHOLD`,
`REQUIRED_METRIC_UNAVAILABLE`. Un fallo de la herramienta nunca se presenta como
veredicto, ni al revés.
**Prueba:** sin escribir.

### D4 — ColmapAdapter produce los fixtures reales · ACORDADA
Deja de ser adaptador opcional futuro. Cámaras, `points3D` y convenciones reales.
**Prueba:** sin escribir.

### D5 — EXR · ACORDADA
V1 admite scanline sin comprimir o ZIP, HALF o FLOAT. PIZ, DWA y B44 se rechazan
por código —`EXR_UNSUPPORTED_COMPRESSION`—, nunca en silencio. Cada canal declara
semántica, espacio, rango, unidad e inválido.
**Prueba:** sin escribir.

### D6 — Sandbox del paquete · ACORDADA
Cada paquete tiene `PACKAGE_ROOT`; todo artifact resuelve a una ruta canónica
dentro de ella. Se rechaza `../`, ruta absoluta fuera, escape por symlink,
symlink anidado y symlink roto. `SS-PKG-001..004`.
**Prueba:** fixture `invalid-path-v1`. Sin escribir.

### D7 — Integridad de artifacts · ACORDADA
Cada artifact declara `path`, `bytes` y `sha256`. SoftSight valida raíz, tamaño y
hash **antes** de analizar. El informe publica `appliesTo: { artifactId, sha256 }`
y, por el refinamiento de la segunda ronda, también los hashes de manifest,
malla, conjunto de cámaras y esquema. Un informe cacheado no se reutiliza para
otro hash.
**Prueba:** fixture `hash-mismatch-v1`. Sin escribir.

### D8 — `requiredEvidence` por contrato · ACORDADA
```text
falta evidencia que el contrato declara requerida  → INCONCLUSIVE
falta evidencia que el contrato no usa             → irrelevante
```
Corrige a SoftSight: `TOPOLOGY_ONLY` certifica sin una sola cámara.
**Prueba:** casos A y B de la batería. Sin escribir.

### D9 — Modelo de escala · ACORDADA
`status` (UNKNOWN | RELATIVE | ABSOLUTE), `source` (NONE | KNOWN_DISTANCE |
MARKER | CAMERA_PRIOR | EXTERNAL_MEASUREMENT | MANUAL) e **incertidumbre** con su
modelo y valor. Con `status != ABSOLUTE` se rechazan presupuestos absolutos;
fallback relativo a la diagonal de la caja. No se reporta precisión física más
fina de la que la incertidumbre justifica.
**Prueba:** `unknown-scale-v1`, caso C. Sin escribir.

### D10 — Convenciones de espacio de imagen · ACORDADA
`imageSpace` DISTORTED|UNDISTORTED, `pixelOrigin` TOP_LEFT, `pixelCenter`
INTEGER|HALF_INTEGER, `transformConvention`, handedness y ejes.

**Refinamiento de la segunda ronda, aceptado:** todo esto viaja como **una sola
unidad**, `CameraImageSpace`, con `imageArtifactHash`, `width`, `height`,
`imageSpace`, `intrinsics`, `distortion`, `pixelOrigin`, `pixelCenter` y
`orientation`. Impide combinar intrínsecos sin distorsionar con imagen
distorsionada, o una máscara del frame original con una profundidad del frame
rectificado.
**Prueba:** fixtures analíticos de cámara + fila 4 de D23. Sin escribir.

### D11 — FrameGraph · ACORDADA
CAMERA, RECONSTRUCTION, ASSET_CANONICAL, PRODUCTION, con las transformaciones
entre ellos guardadas: marco origen, marco destino, matriz, motivo y productor.
Ninguna transformación se hornea sin registrarla.
**Prueba:** sin escribir.

### D12 — Versiones y capabilities · ACORDADA
Bloque `versions` por contrato, bloque `models` por modelo, lista `capabilities`.
El consumidor comprueba el bloque, no un campo. La semántica de negociación la
fija D31.
**Prueba:** sin escribir.

### D13 — Códigos de salida nuevos, solo en subcomandos nuevos · ACORDADA
```text
comandos existentes   0/1/2 sin tocar

reconstruction/production
  0   COMPLETE + PASS
  1   COMPLETE + FAIL
  11  COMPLETE + INCONCLUSIVE
  2   error de datos o de uso (paraguas heredado)
  20  paquete inválido      21 contrato no soportado
  22  formato no soportado  23 límite de recursos     24 error interno
```
**Añadido de VideoMesh, aceptado:** el código de salida es una **proyección para
shell y CI**. La autoridad semántica completa es el JSON —`execution` y
`certification`—. No se intenta representar toda combinación con un entero.
**Prueba:** sin escribir.

### D14 — Un documento, una versión en la raíz · ACORDADA
Opción (a): el informe de reconstrucción y el de producción son **documentos
distintos**, no un bloque dentro del informe histórico.
```json
{ "documentType": "softsight.reconstruction-report", "contractVersion": 1 }
```
`reportVersion` y `contractVersion` no conviven como dos versiones raíz.

**Refinamiento aceptado:** `documentType` en **todos** los documentos canónicos,
con el prefijo del productor —`videomesh.reconstruction-package`,
`softsight.reconstruction-report`—, para que no haya ambigüedad cuando existan
paquete, informe, manifest de producción y los futuros de apariencia y mecánica.
**Prueba:** sin escribir.

### D15 — Una sola fuente ejecutable; JSON Schema es la frontera pública · ACORDADA
```text
esquema en ejecución de SoftSight   (fuente única, la que valida de verdad)
        ↓ generado
contracts/*.schema.json             (frontera pública, commiteado)
        ↓ generado
modelos Pydantic de VideoMesh       (derivados, nunca a mano)
```

VideoMesh objetó que una `interface` de TypeScript no expresa required, min/max,
enum, patrón, longitud, `additionalProperties` ni `oneOf`. **La objeción es
correcta para una interface pasiva y no aplica aquí**: SoftSight no usa
interfaces como esquema. Usa esquemas en ejecución —`SCENE_SCHEMA`,
`PATCH_SCHEMA`, `STORY_SCHEMA`— y **ya tiene el generador**: `toJsonSchema()` en
`src/soft/agent/schema.ts:721`, que emite `additionalProperties: false`. Es
exactamente el «schema runtime TypeScript, no una interface pasiva» que VideoMesh
pone como condición.

Aceptamos sus cinco condiciones y su formulación: **la frontera pública entre
repositorios es el JSON Schema, no el lenguaje interno de SoftSight.**

Dos razones para que la generación siga saliendo del esquema en ejecución y no al
revés: el núcleo no lleva dependencias, y validar JSON Schema en ejecución
significaría traer un validador o escribirlo; y el consumidor que ya existe
—el editor— consume `--schema` y lo tiene fijado con su propia puerta.

**Condición nuestra:** si el esquema en ejecución no sabe expresar algo que la
frontera necesita, **se extiende el esquema**, nunca se escribe el JSON Schema a
mano. Un JSON Schema escrito a mano sería el segundo original que este contrato
existe para evitar.

**Riesgo asumido y su cierre:** habrá dos validadores —el nuestro y el Pydantic
generado— y pueden discrepar. Se cierra con fixtures de conformidad que **los dos
lados deben rechazar**: `unknown-field-v1`, `unknown-capability-v1`,
`unsealed-package-v1`. Un documento que un lado acepta y el otro rechaza es un
fallo de puerta, no una diferencia de criterio.
**Prueba:** `test:contracts --check`, con el patrón de `tools/agents-md.mjs
--check` —sale 1 si el fichero commiteado no es idéntico al regenerado—, más los
fixtures de conformidad. Sin escribir.

### D16 — El hash del esquema se comprueba · ACORDADA
SoftSight lo verifica en la ingesta. Discrepancia:
```text
execution: ERROR
reason:    CONTRACT_SCHEMA_MISMATCH
```
No un aviso: un paquete producido contra otro esquema no es uno degradado, es uno
que no sabemos leer.

**Refinamiento aceptado, con condición:** mientras el contrato esté en DRAFT una
versión puede admitir más de un hash, **si están registrados explícitamente**. La
condición es que la lista de hashes admitidos vive **en este fichero**, no en un
comentario del código. Un hash nunca desconocido se acepta automáticamente.
**Prueba:** sin escribir.

### D17 — NaN, infinitos y redondeo · ACORDADA
NaN e Infinity no existen en JSON; el `json` de Python los emite por defecto y
`JSON.parse` de Node los rechaza. Regla:
```text
en Python   json.dumps(..., allow_nan=False), que lanza en vez de emitir inválido
en EXR      +INF como profundidad inválida sigue siendo correcto (es binario)
redondeo    el determinismo se consigue en el cálculo, no en la serialización;
            ningún redondeo cosmético antes de evaluar un umbral;
            el informe humano puede presentar 96,7 % sin tocar la métrica
```
**Refinamiento aceptado:** un `null` desnudo es ambiguo. Para métricas de QA:
```json
{ "meanError": { "value": null, "status": "UNDEFINED", "reason": "EMPTY_SAMPLE_SET" } }
```
La forma corta —`meanError` más `meanErrorReason`— se admite en campos simples,
no en métricas que puedan alimentar un umbral.
**Prueba:** sin escribir.

### D18 — R0 termina con `cube-v1` pasando · ACORDADA
R0 no cierra con documentos. Cierra cuando esto funciona:
```bash
softsight reconstruction inspect fixtures/cube-v1/reconstruction.json
```
con `execution: COMPLETE` y `certification: PASS`, recorriendo esquema, sandbox,
hashes, PLY, CameraSet, escala, FrameGraph, auditoría mínima y sobre del informe.
El antiguo R1.5 se integra en R0. La partición del criterio de salida la fija D34.
**Prueba:** es la prueba.

### D19 — Parámetros de distorsión con nombre, sin vector posicional · ACORDADA
**Mejora de VideoMesh sobre nuestra propuesta.** Proponíamos declarar el orden del
vector por modelo; ellos proponen **eliminar el vector** del contrato canónico y
usar parámetros con nombre. Elimina la ambigüedad en vez de documentarla, que es
P9.
```json
{ "model": "OPENCV",
  "intrinsics": { "fx": 2811.2, "fy": 2809.9, "cx": 1920.0, "cy": 1080.0 },
  "distortion": { "k1": 0.12, "k2": -0.08, "p1": 0.001, "p2": 0.002 } }
```
El `ColmapAdapter` convierte el vector nativo a parámetros con nombre. Modelo
desconocido: `CAMERA_MODEL_UNSUPPORTED`, nunca interpretación automática.
**Prueba:** fixture `distortion-opencv-v1`. Sin escribir.

### D20 — `depthKind` obligatorio · ACORDADA
`OPTICAL_AXIS | RAY_LENGTH`, sin valor por defecto y sin inferirlo por proveedor.
Confundirlos mete un error que crece con el ángulo respecto al centro de la
imagen: cero en el centro, máximo en las esquinas. `INVERSE_DEPTH` y `DISPARITY`
llegarán por capability, nunca reinterpretando depth V1.
**Prueba:** `depth-optical-axis-v1`, `depth-ray-length-v1`. Sin escribir.

### D21 — Coverage v1 sin provenance, y qué puede certificar · ACORDADA
Coverage v1 publica `provenanceAware: false`. Cuando exista provenance por
región, sube `coverageModelVersion` y pasa a `true`. El número nunca cambia de
significado en silencio.

**Restricción de VideoMesh, aceptada y necesaria:** una cobertura sin conciencia
de provenance solo puede **certificar** sobre superficie puramente reconstruida.
Sobre una malla mezclada se reporta pero no certifica el área observada, y el
contrato que la exija sale INCONCLUSIVE. Cierra el agujero de que una superficie
completada por IA se convierta indirectamente en superficie observada.

**Condición nuestra, para que sea aplicable en V1:** la restricción exige saber
si la malla es pura, y la provenance por triángulo no existe todavía. El manifest
declara un **booleano a nivel de paquete** —`meshPurelyReconstructed`— que
VideoMesh sabe hoy sin trabajo extra. Sin ese campo, coverage no certifica.
**Prueba:** caso de malla mezclada. Sin escribir.

### D22 — Dónde viven los fixtures · ACORDADA
```text
ligeros (< 1 MB, sintéticos o generados)  →  en el repositorio, versionados
pesados (COLMAP real, high-poly)          →  fuera, por variable de entorno,
                                             con sha256 en un manifiesto
                                             versionado que sí está en git
sin fixture                               →  la puerta se declara NOT_RUN
                                             con su motivo; nunca PASS
```
Cinco de las veintidós puertas de SoftSight ya funcionan así.
**Prueba:** sin escribir.

### D23 — Puerta de paridad, contra valores dorados · ACORDADA
Cuatro filas sobre `cube-v1` y `colmap-small-v1`: recuentos, caja tras
normalizar el marco, cámaras registradas, y proyección de puntos 3D conocidos.

**Refinamiento de VideoMesh, aceptado y importante:** no basta con
`SoftSight == VideoMesh`, porque los dos pueden implementar el mismo error. Tres
comparaciones, y las tres deben pasar:
```text
SoftSight  ↔ expected.json
VideoMesh  ↔ expected.json
SoftSight  ↔ VideoMesh
```
Es el mismo patrón que `test:geometry` ya usa contra volúmenes analíticos.
La lógica vive en `tests/contracts/parity/`, nunca en el runtime de producción.
La cobertura queda fuera de la paridad por P11.
**Prueba:** es la prueba. Sin escribir.

### D24 — El árbol de triángulos se llama `boundsTree.ts` · ACORDADA
Tipo `TriangleBoundsTree`. `bvhLoader.ts` ya existe y es Biovision Hierarchy.
*Corrección de estado:* estaba mal marcada como PROPUESTA. Los dos lados dijeron
que sí, así que es ACORDADA; que no exista el fichero es lo que le falta para ser
IMPLEMENTADA. Aplicamos mal nuestra propia regla; VideoMesh tiene razón.

### D25 — `auditMesh` antes que cualquier árbol · ACORDADA
Orden congelado: medir el techo actual, perfilar, reescribir las estructuras
calientes, puerta de recursos, y solo entonces el árbol. La puerta mide tiempo,
RSS máximo, heap, buffers externos y caché: «terminó» no es una medida.
Motivo: `mesh.ts` ya es de arrays tipados; quien no escala es `auditMesh`, con un
`Map` de clave de texto por vértice (`inspect.ts:69`) y otro de aristas
(`inspect.ts:118`).
*Corrección de estado igual que D24.*

### D26 — El contrato está en DRAFT · ACORDADA
Versión `0.x` mientras `contractMaturity = DRAFT`. Promoción a `1.0` cuando **dos
productores reales distintos** produzcan paquetes válidos: COLMAP y VideoMesh, o
COLMAP y OpenMVS.
*Corrección de estado igual que D24.*

### D27 — Un repositorio, con frontera modular estricta · ACORDADA
Resuelta. `reconstruction/` y `production/` viven dentro de softsight, bajo
`src/soft/agent/`. **Condición que la hace comprobable:** esos módulos consumen
las APIs públicas o del núcleo, no importan a discreción de todo el repositorio.
El precedente existe: el editor nunca importa módulos internos y se comunica solo
por el contrato público.

Se extrae a un repositorio aparte solo si la cadencia de publicación diverge,
aparecen consumidores independientes, la legibilidad sufre de forma medible o el
tamaño del paquete se vuelve un problema real. No antes.
**Prueba:** comprobación de importaciones permitidas en `agent/reconstruction/` y
`agent/production/`. Sin escribir.

### D30 — Campo desconocido es error · ACORDADA
`additionalProperties: false` en el esquema del núcleo, y un espacio explícito
para lo experimental:
```json
{ "extensions": { "org.videomesh.experimental.foo": {} } }
```
```text
campo desconocido del núcleo      → ERROR
extensión requerida desconocida   → UNSUPPORTED
extensión opcional desconocida    → se preserva o se ignora, según política
```
**Ya es el comportamiento de SoftSight**: `toJsonSchema` emite
`additionalProperties: false`, y el commit `7d15332` —«un parámetro de más en una
primitiva se rechaza en vez de ignorarse»— es exactamente esta decisión, tomada
antes de que existiera este contrato.
**Prueba:** fixture `unknown-field-v1`. Sin escribir.

### D31 — Negociación de capabilities · ACORDADA
Tres verbos, no uno. El paquete declara `requires` y `provides`; SoftSight publica
`supports`.
```text
capability requerida desconocida         → UNSUPPORTED
capability opcional provista desconocida → continuar si el contrato lo permite
```
Las capabilities sirven para negociar, no para decorar.
**Prueba:** fixture `unknown-capability-v1`. Sin escribir.

### D33 — Orientación canónica de imagen · ACORDADA
Toda imagen referenciada por el CameraSet entra al paquete con la **orientación
horneada en los píxeles**. Las dimensiones de cámara describen la rejilla real, no
una rotación EXIF pendiente. `sourceOrientation` puede guardarse como provenance,
pero nada aguas abajo interpreta píxeles a partir de esa metadata.
**Prueba:** fixture `image-orientation-v1`. Sin escribir.

---

## 5. Decisiones propuestas — esperan confirmación de VideoMesh

Las tres primeras son de VideoMesh y las aceptamos **con una condición cada una**.
Quedan en PROPUESTA hasta que confirmen la condición, porque la versión
condicionada no es la que ellos propusieron.

### D28 — NumericDeterminism · PROPUESTA
```text
EXACT | QUANTIZED | TOLERANCE
```
Cada métrica que pueda sostener certificación declara el suyo, y con `TOLERANCE`
declara también sus tolerancias absoluta y relativa. Las reducciones paralelas
mantienen orden fijo de bloque y de reducción. Numera el riesgo R9, que estaba
sin dueño.

**Condición nuestra — la dirección de la carga de la prueba.** El planteamiento
—«no fingir determinismo absoluto donde la plataforma no lo garantiza»— es
correcto en general y **no debe debilitar lo que hoy ya es exacto**: el
`renderHash` del pliego del dron es idéntico en `ubuntu-latest` y en
`macos-latest`, medido en CI, no supuesto.

```text
toda métrica nace EXACT
pasar a TOLERANCE exige una diferencia medida entre plataformas,
anotada aquí con su número
```

Sin esa carga, `TOLERANCE` se convierte en el sitio donde se esconden los bugs.
En concreto **no aceptamos de entrada que coverage sea TOLERANCE**: con semilla
fija, muestreo fijo y orden de reducción fijo debería ser exacta, y si no lo es
queremos ver el número antes de conceder la tolerancia.

### D29 — Sellado atómico del paquete · PROPUESTA
Cierra el TOCTOU que D7 deja abierto: verificar el hash y analizar no son
atómicos.
```text
WRITING → SEALED → CONSUMED
```
VideoMesh escribe en un directorio temporal, vuelca y cierra, calcula los hashes,
escribe el manifest, marca el sellado y **renombra atómicamente** al nombre final.
SoftSight solo acepta paquetes SEALED. Un paquete sellado no se modifica: cualquier
cambio es un `packageId` nuevo (P10). Añade `packageId`, y opcionalmente
`generation`.

**Condiciones nuestras, las dos operativas:**

1. **`rename` solo es atómico dentro del mismo sistema de ficheros.** El
   directorio temporal tiene que vivir en el mismo volumen que el paquete final.
   Si no, `rename` cae a copiar y borrar, y la garantía desaparece justo cuando
   más importa —paquetes de varios GB—. Debe estar escrito en el contrato, no
   quedar como práctica.
2. **Qué constituye el sello, exactamente.** Dos cosas a la vez, para que no
   dependa de una sola: el manifest es **el último fichero escrito** y lleva
   `state: "SEALED"`, y el renombrado atómico del directorio es lo que confirma.
   Un directorio en la ruta final sin manifest, o con `state != SEALED`, es
   `PACKAGE_NOT_SEALED`.

### D32 — Álgebra canónica de transformaciones · PROPUESTA
```text
matriz          4×4 homogénea
serialización   por filas, 16 números
matemática      vectores columna
composición     p_destino = T_destino_desde_origen × p_origen
nombres         T_asset_from_reconstruction significa literalmente
                coordenadas en reconstruction → coordenadas en asset
cámaras         en el paquete canónico solo worldFromCamera;
                el adapter convierte cameraFromWorld antes de producirlo
```

**Coincide con SoftSight, y no por casualidad:** `math.ts` guarda por filas con
la traslación en los índices 3, 7 y 11, que es exactamente almacenamiento por
filas con vectores columna. Nada que convertir.

**Condición nuestra:** hay que escribir en el contrato que **esta convención no
es la de glTF**. glTF serializa por columnas, con la traslación en 12, 13 y 14.
La transposición ocurre en el exportador y en el cargador, y tiene su propia
prueba. Sin decirlo, alguien pasará una matriz del paquete directamente a un GLB
y saldrá plausible y falsa —el mapa del proyecto ya registra este error exacto
como causa de fallos que se cancelan entre sí sin que nada salte—.

### D34 — El criterio de salida de R0 se parte en dos · PROPUESTA · SoftSight
La secuencia R0.0–R0.19 propuesta por VideoMesh termina en la puerta de paridad,
que necesita que VideoMesh sepa producir `cube-v1` y calcular las cuatro filas.
Tal como está, **la salida de R0 de SoftSight depende del calendario de
VideoMesh**, que es la clase de acoplamiento que este contrato existe para
evitar.

```text
R0-A  cierra SoftSight solo
      cube-v1 generado por un script de nuestro repositorio recorre
      esquema, sandbox, hashes, PLY, CameraSet, escala, FrameGraph,
      auditoría mínima y sobre del informe, y sale COMPLETE + PASS

R0-B  cierra con los dos
      el cube-v1 de VideoMesh recorre lo mismo y la puerta de paridad
      pasa las tres comparaciones de D23
```

R0-A no espera a nadie y demuestra la mitad nuestra. R0-B es el handoff de
verdad. Los dos siguen siendo requisito antes de R1; lo único que cambia es que
un retraso de un lado no congela al otro.

---

## 6. Riesgos con dueño

Un riesgo sin decisión detrás es una preocupación, no una mitigación.

```text
R1  escape de ruta                                D6
R2  informe obsoleto respecto al artifact         D7 + D29
R3  falta de evidencia convertida en PASS         D3 + D8
R4  error del proveedor leído como fallo
    de certificación                              D3 + D13
R5  tolerancia en milímetros sobre escala
    desconocida                                   D9
R6  cobertura falsa por convención de cámara      D10 + D19 + D23 + D33
R7  malla de producción en otro marco             D11 + D32
R8  confianza tratada como exacta                 P6 + D12 + D28
R9  no determinismo de coma flotante paralela     D28
R10 deriva de contrato entre repositorios         D15 + D16
R11 superficie inferida contada como observada    D21 + P3
R12 el registro crece más rápido que el código    §1.6
```

R11 y R12 son nuevos de esta ronda. R12 es de este documento sobre sí mismo.

---

## 7. Lo siguiente

**De VideoMesh**, en orden de lo que bloquea:

```text
1  confirmar las condiciones de D28, D29 y D32 — son tres frases, no rediseños
2  confirmar D34, la partición del criterio de salida de R0
3  confirmar el booleano meshPurelyReconstructed de D21, que es lo que hace
   aplicable su propia restricción en V1
4  poner allow_nan=False hoy, antes del primer paquete
5  el generador de cube-v1 con su expected.json
```

**De SoftSight**, sin esperar respuesta, porque no depende de ninguna decisión
pendiente y es el camino crítico:

```text
D25  medir el techo de auditMesh y reescribirlo sin Map
```

**Y la primera IMPLEMENTADA.** Treinta y cuatro decisiones sin una sola prueba es
el número que hay que mover en la próxima ronda. La candidata más barata es D30:
ya es el comportamiento del código; solo le falta el fixture que falle si deja de
serlo.
