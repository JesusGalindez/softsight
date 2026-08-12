# Contrato SoftSight ↔ VideoMesh

Registro de decisiones de la frontera entre los dos proyectos.

**Regla dura: una decisión que no está aquí no existe.** Ni en un plan, ni en un
documento de intercambio, ni en un mensaje. Los documentos que los dos agentes se
han enviado son el historial de cómo se llegó; este fichero es lo que rige.

**Qué no lleva.** El orden de trabajo está en
[`plan-reconstruccion.md`](plan-reconstruccion.md). El estado del proyecto, en
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5.

**La ronda de diseño está cerrada** desde el 2026-08-12, tras tres rondas. Lo que
sigue es código y medidas.

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

**Corolario:** una ACORDADA que lleva semanas sin prueba es deuda y se anota.

### 1.3 El ciclo

```text
propuesta → decisión → esquema → fixture → prueba del consumidor → IMPLEMENTADA
```

### 1.4 Los envíos se disparan por evento, no por calendario

**SoftSight avisa cuando:** implementa D30, mide la línea base de `auditMesh`,
pasa R0-A, o cambia cualquier esquema.

**VideoMesh avisa cuando:** implementa `allow_nan=False`, genera `cube-v1`,
congela `expected.json`, o está listo como productor de R0-B.

Regla que evita la mitad de los problemas: **una convención se cambia enviando
antes un fixture que la ejerce.** No después.

### 1.5 Desempates

**Números:** si hay puerta cruzada, decide la puerta. Si no la hay, nadie tiene
razón todavía: es deuda certificada y ese número no puede sostener una
certificación.

**Decisiones:** manda la tabla de ownership. Sobre un dato de frontera compartida
no hay cambio hasta que los dos digan sí, y «no decidido» bloquea.

### 1.6 El registro está congelado hasta que pase `cube-v1`

Aceptado por los dos lados.

> No se admiten números de decisión nuevos hasta que `cube-v1` pase de punta a
> punta, **salvo los que bloqueen `cube-v1`**. Todo lo demás se anota como
> PENDIENTE sin número y espera.

Califica como bloqueo solo lo que haga `cube-v1` imposible, ambiguo o inseguro.
No califican: formatos futuros, LOD, MechanicalGraph, códecs EXR nuevos,
ejecución en la nube.

Tres rondas añadieron 34 decisiones y once principios. La cuarta debe producir la
primera IMPLEMENTADA, no la número treinta y cinco.

### 1.7 Lo que no se hace

```text
un tercer repositorio de contratos   todavía no; el hash del esquema basta
un canal en tiempo real              el intercambio son ficheros
reuniones periódicas                 las sustituye el aviso por evento
«lo hablamos cuando llegue»          es como se pierde el tiempo
```

---

## 2. Estado del registro

Al 2026-08-12, cerrada la tercera ronda:

```text
ACORDADAS       34   D1–D34
PROPUESTAS       0
IMPLEMENTADAS    0
```

**El único movimiento admisible ahora es de ACORDADA a IMPLEMENTADA.** La
candidata más barata es D30: ya es el comportamiento del código y solo le falta
el fixture que falle si deja de serlo.

---

## 3. Principios congelados

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
P10  un paquete sellado es inmutable; cualquier cambio crea identidad nueva
P11  la paridad cruzada aplica solo a hechos de frontera compartida;
     lo que tiene dueño no se duplica solo para obtener paridad
P12  una medida y una prueba que falla tienen más autoridad que más prosa
     de arquitectura
```

**P11** corrige una formulación nuestra: generalizar «los dos lados dan el mismo
número» obligaría a VideoMesh a reimplementar la cobertura, que es lo contrario
de P1. Tres categorías:

```text
A  frontera compartida    paridad cruzada obligatoria
                          recuentos, caja, cámaras, proyección de puntos,
                          hash de esquema, composición de transformaciones
B  de SoftSight           fixtures analíticos y valores dorados;
                          NO se reimplementa el motor dos veces
C  de VideoMesh           igual, en su lado
```

---

## 4. Las decisiones

### D1 — Transporte del paquete
Filesystem y rutas. VideoMesh escribe el paquete en disco y pasa la ruta del
manifest. Nada de base64 en el JSON, nada de streaming, y los límites del puente
no se suben como parche. El puente se queda para el editor y peticiones pequeñas.
**Prueba:** sin escribir.

### D2 — Códigos de aviso
Código legible en español, más un **identificador neutro y estable**
(`SS-RECON-001`). VideoMesh parsea el identificador, nunca el mensaje. Espacios:
`SS-PKG`, `SS-IO`, `SS-GEO`, `SS-RECON`, `SS-CAM`, `SS-COV`, `SS-CONF`,
`SS-PROD`, `SS-LOD`, `SS-UV`, `SS-PBR`, `SS-COLL`.
**Prueba:** `test:codes` extendida a identificadores únicos y estables.

### D3 — Ejecución y certificación son dos ejes
```text
ExecutionStatus        COMPLETE | PARTIAL | ERROR | UNSUPPORTED
CertificationVerdict   PASS | FAIL | INCONCLUSIVE
```
Motivos aparte: `INSUFFICIENT_EVIDENCE`, `UNCERTAINTY_OVERLAPS_THRESHOLD`,
`REQUIRED_METRIC_UNAVAILABLE`.
**Prueba:** sin escribir.

### D4 — ColmapAdapter produce los fixtures reales
Cámaras, `points3D` y convenciones reales. `colmap-small-v1` sigue siendo
imprescindible: el cubo no ejerce modelos de cámara reales, ni datos en coma
flotante reales, ni el comportamiento real de la escala.
**Prueba:** sin escribir.

### D5 — EXR
Scanline sin comprimir o ZIP, HALF o FLOAT. PIZ, DWA y B44 se rechazan por
código. Cada canal declara semántica, espacio, rango, unidad e inválido.
**Prueba:** sin escribir.

### D6 — Sandbox del paquete
`PACKAGE_ROOT`; todo artifact resuelve dentro. Se rechaza `../`, ruta absoluta
fuera, escape por symlink, symlink anidado y symlink roto. `SS-PKG-001..004`.
**Prueba:** `invalid-path-v1`.

### D7 — Integridad de artifacts
Cada artifact declara `path`, `bytes` y `sha256`. SoftSight valida raíz, tamaño y
hash **antes** de analizar. El informe publica `packageId`, `manifestSha256` y los
hashes de los artifacts.

**Del cierre de la tercera ronda:** el manifest **no puede contener su propio
sha256** sin trucos recursivos. Lo calcula SoftSight después de la publicación y
lo ata al informe. Y `packageId` es la identidad canónica: **SoftSight nunca
infiere identidad del nombre del directorio**, que es comodidad humana.
**Prueba:** `hash-mismatch-v1`.

### D8 — `requiredEvidence` por contrato
```text
falta evidencia requerida por el contrato  → INCONCLUSIVE
falta evidencia que el contrato no usa     → irrelevante
```
**Prueba:** casos A y B.

### D9 — Modelo de escala
`status` (UNKNOWN | RELATIVE | ABSOLUTE), `source` (NONE | KNOWN_DISTANCE |
MARKER | CAMERA_PRIOR | EXTERNAL_MEASUREMENT | MANUAL) e incertidumbre con su
modelo y valor. Con `status != ABSOLUTE` se rechazan presupuestos absolutos;
fallback relativo a la diagonal. No se reporta precisión más fina de la que la
incertidumbre justifica.
**Prueba:** `unknown-scale-v1`, caso C.

### D10 — Convenciones de espacio de imagen
`imageSpace`, `pixelOrigin`, `pixelCenter`, `transformConvention`, handedness y
ejes, viajando como **una sola unidad** `CameraImageSpace` con
`imageArtifactHash`, dimensiones, intrínsecos, distorsión y orientación. Impide
combinar intrínsecos rectificados con imagen distorsionada, o una máscara del
frame original con profundidad del rectificado.
**Prueba:** fixtures analíticos de cámara + fila 4 de D23.

### D11 — FrameGraph
CAMERA, RECONSTRUCTION, ASSET_CANONICAL, PRODUCTION, con cada transformación
guardando marco origen, marco destino, matriz, motivo y productor. Ninguna se
hornea sin registrarla.
**Prueba:** sin escribir.

### D12 — Versiones y capabilities
Bloque `versions`, bloque `models`, lista `capabilities`. El consumidor comprueba
el bloque, no un campo.
**Prueba:** sin escribir.

### D13 — Códigos de salida nuevos, solo en subcomandos nuevos
```text
comandos existentes   0/1/2 sin tocar
reconstruction/production
  0 COMPLETE+PASS   1 COMPLETE+FAIL   11 COMPLETE+INCONCLUSIVE
  2 error de datos o de uso (paraguas heredado)
  20 paquete inválido  21 contrato no soportado  22 formato no soportado
  23 límite de recursos  24 error interno
```
El código de salida es una **proyección para shell y CI**. La autoridad semántica
es el JSON: `execution` y `certification`.
**Prueba:** sin escribir.

### D14 — Un documento, una versión en la raíz
Informe de reconstrucción y de producción son **documentos distintos**.
`documentType` en todos los documentos canónicos, con la forma
`<productor>.<tipo>`:
```text
videomesh.reconstruction-package   softsight.reconstruction-report
videomesh.production-package       softsight.production-report
```
Nunca nombres ambiguos sueltos —`reconstruction`, `report`—. `reportVersion` y
`contractVersion` no conviven como dos versiones raíz.
**Prueba:** sin escribir.

### D15 — Una sola fuente ejecutable; JSON Schema es la frontera pública
```text
esquema en ejecución de SoftSight   (fuente única, la que valida de verdad)
        ↓ generado
contracts/*.schema.json             (frontera pública, commiteado)
        ↓ generado
modelos Pydantic de VideoMesh       (derivados, nunca a mano)
```
La objeción de VideoMesh —una `interface` de TypeScript no expresa required,
enum, patrón ni `oneOf`— es correcta para una interface pasiva y no aplica:
SoftSight usa esquemas en ejecución y **ya tiene el generador**, `toJsonSchema()`
en `src/soft/agent/schema.ts:721`, que emite `additionalProperties: false`.

**Condición:** si el esquema en ejecución no sabe expresar algo que la frontera
necesita, se extiende el esquema; el JSON Schema nunca se escribe a mano.

**Riesgo asumido:** dos validadores pueden discrepar. Se cierra con fixtures que
**los dos lados deben rechazar**.
**Prueba:** `test:contracts --check` con el patrón de `tools/agents-md.mjs
--check`, más `unknown-field-v1`, `unknown-capability-v1`, `unsealed-package-v1`.

### D16 — El hash del esquema se comprueba
Hash desconocido:
```text
execution: ERROR   reason: CONTRACT_SCHEMA_MISMATCH
```
Nunca aviso y continuar. En DRAFT una versión puede admitir más de un hash si
están registrados.

**Del cierre de la tercera ronda:** los hashes concretos **se generan** del
artefacto de esquema soportado, no se copian a mano en tres sitios. Reparto de
autoridad:
```text
este fichero              qué versiones de esquema se aceptan (decisión)
contracts/*.schema.json   el contrato legible por máquina
registro generado         la búsqueda de compatibilidad por hash
```
**Prueba:** sin escribir.

### D17 — NaN, infinitos y redondeo
```text
en Python   json.dumps(..., allow_nan=False), que lanza en vez de emitir inválido
en EXR      +INF como profundidad inválida sigue siendo correcto
redondeo    el determinismo se consigue en el cálculo, no en la serialización;
            ningún redondeo cosmético antes de evaluar un umbral;
            el informe humano puede presentar 96,7 % sin tocar la métrica
```
Un `null` desnudo es ambiguo. Para métricas de QA:
```json
{ "meanError": { "value": null, "status": "UNDEFINED", "reason": "EMPTY_SAMPLE_SET" } }
```
VideoMesh lo rechaza **en origen**; no se confía en que Node lo rechace después.
**Prueba:** `test_json_rejects_non_finite_numbers`, con NaN, +Infinity y
-Infinity, antes de producir paquete.

### D18 — R0 termina con `cube-v1` pasando
```bash
softsight reconstruction inspect fixtures/cube-v1/reconstruction.json
```
con `execution: COMPLETE` y `certification: PASS`, recorriendo esquema, sandbox,
hashes, PLY, CameraSet, escala, FrameGraph, auditoría mínima y sobre del informe.
El criterio se parte según D34.

**R0 se queda pequeño a propósito:** sin cobertura, sin confianza, sin LOD, UV,
PBR ni collision. La cobertura depende del árbol de triángulos, la visibilidad y
el muestreo, y llega después.
**Prueba:** es la prueba.

### D19 — Parámetros de distorsión con nombre, sin vector posicional
Mejora de VideoMesh sobre nuestra propuesta: **eliminar el vector** en vez de
documentar su orden. Es P9.
```json
{ "model": "OPENCV",
  "intrinsics": { "fx": 2811.2, "fy": 2809.9, "cx": 1920.0, "cy": 1080.0 },
  "distortion": { "k1": 0.12, "k2": -0.08, "p1": 0.001, "p2": 0.002 } }
```
El `ColmapAdapter` convierte el vector nativo. Modelo desconocido:
`CAMERA_MODEL_UNSUPPORTED`.
**Prueba:** `distortion-opencv-v1`.

### D20 — `depthKind` obligatorio
`OPTICAL_AXIS | RAY_LENGTH`, sin valor por defecto y sin inferirlo por proveedor.
Confundirlos mete un error que crece con el ángulo respecto al centro: cero en el
centro, máximo en las esquinas. `INVERSE_DEPTH` y `DISPARITY` llegarán por
capability, nunca reinterpretando depth V1.
**Prueba:** `depth-optical-axis-v1`, `depth-ray-length-v1`.

### D21 — Coverage v1 sin provenance, y qué puede certificar
Coverage v1 publica `provenanceAware: false`. Solo puede **certificar** sobre
superficie puramente reconstruida; sobre malla mezclada se reporta pero no
certifica el área observada.

La bandera **cuelga del artifact, no del paquete**. Corrección de VideoMesh sobre
nuestra propuesta, y es la correcta: un paquete lleva `sparse.ply`, `dense.ply`,
`mesh_raw.ply` y `mesh_refined.ply`, y una malla reparada y su cruda tienen
provenance distinta. Una bandera global sería falsa en cuanto el paquete lleve
las dos.

```text
purelyReconstructed, requerida en cada artifact TRIANGLE_MESH

true    → coverage v1 puede certificar el área observada de ESA malla
false   → se reporta, no certifica
```

VideoMesh admite implementarla de forma temporal en el artifact de auditoría
mientras R0 garantice una sola malla. **No lo hacemos:** la lista de artifacts ya
existe por D7 —cada uno declara `path`, `bytes` y `sha256`—, así que añadir un
campo a la entrada de la malla cuesta lo mismo hoy que colgarla del paquete, y
una implementación provisional que no coincide con la semántica es exactamente
como empieza la deriva. Va atada al artifact desde el primer commit.

Encaja además con D7 sin maquinaria nueva: el informe ya declara `appliesTo:
{ artifactId, sha256 }`, así que la comprobación de certificación es leer la
bandera del artifact sobre el que corrió la auditoría.

**Es el primer caso real que exige formas discriminadas por tipo de artifact**
—requerida en `TRIANGLE_MESH`, ausente en una nube de puntos, que no tiene
superficie—, que es justo lo que VideoMesh temía que el esquema en ejecución no
supiera expresar (D15). Comprobado: sí sabe. `FieldSchema` admite `anyOf` con
formas alternativas del mismo campo y `toJsonSchema` las traduce
(`schema.ts:762`), y el literal del tipo discrimina. La condición de D15
—extender el esquema si no llega— no se dispara.
**Semántica congelada.** `true` significa: *cada región de superficie deriva
exclusivamente de evidencia de reconstrucción, y ninguna operación posterior ha
introducido superficie nueva sin soporte reconstructivo.* **No** significa «la
malla no se ha tocado nunca».

```text
mantienen true    recálculo de normales, soldadura de vértices, optimización
                  de índices, simplificación determinista, conversión de
                  formato, transformación de coordenadas
fuerzan false     relleno de agujeros, completado por IA, región modelada a
                  mano, trasera sintética, extrapolación de superficie,
                  geometría no observada
```
Cuando VideoMesh no pueda demostrar `true`, emite `false`.

Cuando una métrica no pueda certificar, el informe dice por qué:
```json
{ "coverage": { "value": 0.96, "certificationEligible": false,
                "reason": "MESH_NOT_PURELY_RECONSTRUCTED" } }
```

**Cerrado el 2026-08-12.** El campo es **requerido**; faltar es un error de
esquema en la ingesta, no una rama de «no certifica». Se descartó el caso de
ausencia porque chocaba con D30: la misma entrada tenía dos resultados según por
dónde se mirara.
**Prueba:** malla pura, malla mezclada, campo ausente —que debe salir por el
camino de error de esquema, no por el de cobertura—.

### D22 — Dónde viven los fixtures
```text
ligeros (< 1 MB, sintéticos)  →  en el repositorio, versionados
pesados (COLMAP real, 5M)     →  fuera, por variable de entorno, con sha256
                                 en un manifiesto versionado que sí está en git
sin fixture                   →  la puerta se declara NOT_RUN con su motivo;
                                 nunca PASS
```
**Prueba:** sin escribir.

### D23 — Puerta de paridad, contra valores dorados
Cuatro filas sobre `cube-v1` y `colmap-small-v1`: recuentos, caja tras normalizar
el marco, cámaras registradas, y proyección de puntos 3D conocidos.

No basta `SoftSight == VideoMesh`: los dos pueden implementar el mismo error.
Tres comparaciones, y las tres deben pasar:
```text
SoftSight ↔ expected.json      VideoMesh ↔ expected.json      SoftSight ↔ VideoMesh
```
Los puntos de proyección se eligen para cubrir centro, esquina, fuera de eje y
cerca del borde: valida intrínsecos, centro de píxel, orientación y álgebra de
transformaciones a la vez.

`expected.json` es el oráculo de prueba, **no parte del paquete**: SoftSight no lo
consume en producción. La lógica vive en `tests/contracts/parity/`.
**Prueba:** es la prueba.

### D24 — El árbol de triángulos se llama `boundsTree.ts`
Tipo `TriangleBoundsTree`. `bvhLoader.ts` ya existe y es Biovision Hierarchy.

### D25 — `auditMesh` antes que cualquier árbol
Medir el techo actual, perfilar, reescribir las estructuras calientes, puerta de
recursos, y solo entonces el árbol. La puerta mide tiempo, RSS máximo, heap,
buffers externos y caché: «terminó» no es una medida. Se registra también
plataforma, arquitectura, versión de Node, CPU, RAM y número de workers, para que
la medida sea reproducible.

Orden, no negociable: **línea base → perfil → cambio → medida.** No reescribir y
esperar.

Motivo: `mesh.ts` ya es de arrays tipados; quien no escala es `auditMesh`, con un
`Map` de clave de texto por vértice (`inspect.ts:69`) y otro de aristas
(`inspect.ts:118`).
**Prueba:** puerta de alto poligonaje sobre el fixture de 5M.

### D26 — El contrato está en DRAFT
`0.x` mientras `contractMaturity = DRAFT`. Promoción a `1.0` cuando **dos
productores reales distintos** produzcan paquetes válidos.

**`cube-v1` no promueve el contrato:** es sintético. Sigue en DRAFT después de
R0-B. La promoción la traen COLMAP y VideoMesh sobre datos reales.

### D27 — Un repositorio, con frontera modular estricta
`reconstruction/` y `production/` bajo `src/soft/agent/`. Esos módulos consumen
las APIs públicas o del núcleo, no importan a discreción de todo el repositorio.
Se extrae a un repositorio aparte solo si la cadencia diverge, aparecen
consumidores independientes, la legibilidad sufre de forma medible o el tamaño
del paquete se vuelve un problema real.
**Prueba:** comprobación de importaciones permitidas.

### D28 — NumericDeterminism: dos ejes, no uno
**Refinamiento de VideoMesh, aceptado y correcto.** Un solo enum colapsaba dos
propiedades distintas: si la cantidad medida es exacta, y si la implementación
produce los mismos bits. Una cobertura por muestreo es una **aproximación** de la
cobertura real y a la vez puede ser **bit a bit reproducible**.

```text
MeasurementClass    EXACT | DETERMINISTIC_APPROXIMATION | HEURISTIC
                    | EXTERNAL_MEASUREMENT
ReproducibilityMode BITWISE_EXACT | QUANTIZED | TOLERANCE
```

```text
triangleCount     EXACT                        + BITWISE_EXACT
coverage          DETERMINISTIC_APPROXIMATION  + BITWISE_EXACT
surfaceDistance   DETERMINISTIC_APPROXIMATION  + BITWISE_EXACT
validador externo EXTERNAL_MEASUREMENT
```

**La carga de la prueba.** `ReproducibilityMode` nace `BITWISE_EXACT`. Moverla a
`TOLERANCE` exige fixture, ejecución en dos plataformas, diferencia observada,
número medido, causa caracterizada, tolerancia derivada de la medida y anotación
aquí. «La coma flotante podría variar» no es justificación.

Ni la cobertura ni la distancia de superficie nacen con tolerancia; las dos
aspiran a identidad de bits con semilla, estratificación, orden de muestras,
fronteras de bloque y orden de reducción fijos.

**Las reducciones paralelas — el refinamiento que nos faltaba.** Fijar el orden
de reducción no basta si la **partición** depende del número de workers: cuatro
workers dan cuatro trozos y ocho dan ocho, así que los sumandos se agrupan
distinto y la suma cambia aunque cada ejecución reduzca ordenada.

```text
los bloques se definen por índices de entrada y un tamaño de bloque fijo,
nunca por el número de workers

los workers los procesan en cualquier orden
la reducción final va por índice de bloque ascendente
```

Nota nuestra: esto no afecta al rasterizado por bandas de `parallel.ts` —cada
banda escribe píxeles distintos y no hay reducción—, pero sí a toda suma sobre
muestras. **El tamaño de bloque es parte del contrato** en cuanto un número de
frontera compartida dependa de una suma; hoy ninguna de las cuatro filas de D23
lo hace.

**Cómo convive con los tres vocabularios.** Ahora hay tres enums y hay que decir
a qué se pega cada uno, o se contaminan:
```text
WarningSeverity      certeza | candidato          va en AVISOS
MeasurementClass     EXACT | ...                  va en MÉTRICAS
ReproducibilityMode  BITWISE_EXACT | ...          va en MÉTRICAS
```
Ninguna métrica lleva severidad; ningún aviso lleva clase de medida.

Son **ortogonales**, y el repositorio ya lo demuestra: `PIVOTE_DESCENTRADO` sale
de una medida exacta —el desplazamiento del centro de la caja— y es `candidato`,
porque la conclusión supone que la pieza va a rotar, y eso es intención. Métrica
`EXACT`, aviso `candidato`.

Rechazamos en la primera ronda las «exactness classes» por duplicar
`WarningSeverity`. Con los dos ejes separados ya no duplican: aquello iba sobre
avisos y esto va sobre métricas.
**Prueba:** recuentos exactos en macOS y Linux; cobertura con la misma semilla,
mismos bloques y misma entrada, comparada bit a bit.

### D29 — Sellado atómico del paquete
```text
escribir artifacts → cerrarlos → calcular bytes y sha256 → construir manifest
con los hashes → state: SEALED → escribir el manifest EL ÚLTIMO → cerrarlo
→ rename atómico del directorio
```

**El mismo sistema de ficheros, como contrato y no como recomendación.** El
directorio temporal y el destino final deben resolver al mismo volumen. VideoMesh
lo verifica **antes** de empezar una build que pretenda publicación atómica; si
no puede garantizarlo, falla con `PACKAGE_ATOMIC_PUBLISH_UNAVAILABLE`. Nunca cae
en silencio a copiar y borrar manteniendo la etiqueta de atómico.

**Qué es un paquete sellado**, las dos condiciones a la vez:
```text
existe el manifest en el paquete final     y     manifest.state == "SEALED"

falta el manifest        → PACKAGE_NOT_SEALED
state != SEALED          → PACKAGE_NOT_SEALED
```

**`CONSUMED` no es un estado del paquete.** Corrección de VideoMesh sobre su
propia propuesta, y es correcta: si SoftSight cambiara `manifest.state` a
`CONSUMED` tras leerlo, estaría modificando el paquete, contra P8 y P10.
```text
ciclo del paquete   WRITING → SEALED, y SEALED para siempre
ciclo del consumo   pertenece al run: PENDING | RUNNING | COMPLETE
                    | ERROR | UNSUPPORTED, con runId, inputPackageId
                    e inputManifestSha256
```

**El destino final no puede existir ya** con un paquete sellado de la misma
identidad. No se reescribe `turret-recon-0004`: se publica `0005`.

**Alcance de la garantía.** V1 promete **visibilidad atómica** —el consumidor ve
el estado anterior o el paquete sellado completo—, no durabilidad ante caída.
`fsync` de ficheros, manifest y directorio, y las semánticas de sistemas de
ficheros en red, quedan fuera del contrato y **no bloquean `cube-v1`**. El
informe no debe afirmar durabilidad.
**Prueba:** paquete sin sellar, sellado, manifest ausente, estado incorrecto,
destino ya existente, y temporal en otro volumen si se puede probar.

### D30 — Campo desconocido es error
`additionalProperties: false` en el núcleo, y un espacio explícito para lo
experimental:
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
primitiva se rechaza en vez de ignorarse»— es esta decisión, tomada antes de que
existiera este contrato. **Le falta solo el fixture que falle si desaparece**, y
por eso es la primera candidata a IMPLEMENTADA.
**Prueba:** `unknown-field-v1`.

### D31 — Negociación de capabilities
El paquete declara `requires` y `provides`; SoftSight publica `supports`.
```text
capability requerida desconocida         → UNSUPPORTED
capability opcional provista desconocida → continuar si el contrato lo permite
```
**Prueba:** `unknown-capability-v1`.

### D32 — Álgebra canónica de transformaciones
```text
matriz          4×4 homogénea
serialización   por filas, 16 números, traslación en 3, 7, 11
matemática      vectores columna
composición     p_destino = T_destino_desde_origen × p_origen
cámaras         en el paquete canónico solo worldFromCamera
```
Coincide con `math.ts`, que guarda por filas con la traslación en 3, 7 y 11.

**No es la convención de glTF**, que serializa con la suya. No son
intercambiables.

**La conversión ocurre exactamente una vez, en el adaptador de frontera glTF.**
La regla es semántica y no «el cargador transpone y el exportador transpone»:
una librería de glTF puede normalizar la matriz antes de exponerla, y dos
transposiciones sin dueño se cancelan o se duplican sin que nada salte. Nunca
dentro del dominio, ni en varios cargadores, ni en el núcleo.

**Coste que esto tiene en SoftSight, y hay que decirlo:** el repositorio tiene
**dos parsers de GLB**, anotados como deuda estructural aparcada en el mapa §5
punto 17 —«no se toca hasta que haya un consumidor que lo pague»—. Dos parsers
son dos sitios donde la conversión podría ocurrir, que es exactamente el fallo
que esta decisión previene. **D32 es ese consumidor.** Unificarlos deja de ser
deuda opcional; no bloquea `cube-v1`, que no exporta glTF, pero sí bloquea la
primera exportación de producción.
**Prueba:** fixture `transform-gltf-v1` con traslación, rotación, escala uniforme
y una composición no trivial: ida y vuelta canónico → glTF → canónico, más un
punto conocido a su punto transformado conocido.

### D33 — Orientación canónica de imagen
Toda imagen referenciada por el CameraSet entra con la **orientación horneada en
los píxeles**. Las dimensiones de cámara describen la rejilla real, no una
rotación EXIF pendiente. `sourceOrientation` puede guardarse como provenance,
pero nada aguas abajo interpreta píxeles a partir de esa metadata.
**Prueba:** `image-orientation-v1`.

### D34 — El criterio de salida de R0, en dos
```text
R0-A   cierra SoftSight solo
       un cube-v1 generado por un script de nuestro repositorio recorre
       esquema → sandbox → hashes → PLY → CameraSet → escala → FrameGraph
       → auditoría mínima → sobre del informe, y sale COMPLETE + PASS

R0-B   cierra con los dos
       el cube-v1 de VideoMesh recorre lo mismo y pasan las tres
       comparaciones de D23
```
**Precisión de VideoMesh, aceptada:** R0-B es obligatorio antes de cualquier fase
que **dependa del contrato compartido**, no antes de todo R1. El trabajo interno
que no consume ni cambia la frontera —D25, la reescritura de `auditMesh`— avanza
en paralelo.

**Condición de parada:** si R0-B falla por proyección de cámara, transformación
de matrices, interpretación del esquema o identidad de artifacts, **no se avanza
nada que dependa del contrato**. Se arregla la frontera primero.
**Prueba:** es la prueba.

---

## 5. Riesgos con dueño

```text
R1  escape de ruta                             D6
R2  informe obsoleto respecto al artifact      D7 + D29
R3  falta de evidencia convertida en PASS      D3 + D8
R4  error del proveedor leído como fallo
    de certificación                           D3 + D13
R5  tolerancia en milímetros sobre escala
    desconocida                                D9
R6  cobertura falsa por convención de cámara   D10 + D19 + D23 + D33
R7  malla de producción en otro marco          D11 + D32
R8  confianza tratada como exacta              P6 + D12 + D28
R9  no determinismo de coma flotante paralela  D28
R10 deriva de contrato entre repositorios      D15 + D16
R11 superficie inferida contada como observada D21 + P3
R12 el registro crece más rápido que el código §1.6 + P12
R13 doble transposición entre los dos parsers
    de GLB del repositorio                     D32 + mapa §5.17
```

---

## 6. Lo que toca ahora

**SoftSight**, en orden:

```text
S1  línea base de auditMesh, medida y publicada
S2  perfil de weldPositions y edgeUse
S3  fixture unknown-field-v1 → D30 pasa a IMPLEMENTADA
S4  esqueleto de esquema e ingesta de R0-A
S5  generador local de cube-v1
S6  informe mínimo de reconstrucción
```

**VideoMesh**, en orden:

```text
V1  allow_nan=False        V2  prueba de serialización no finita
V3  generador de cube-v1   V4  expected.json
V5  escritor con temporal y final en el mismo volumen
V6  packageId              V7  manifest SEALED
V8  sha256 por artifact    V9  CameraSet canónico
V10 arnés de paridad
```

**Hitos compartidos:**

```text
1  R0-A PASS               no requiere a VideoMesh
2  cube-v1 generado        no requiere a SoftSight
3  R0-B PASS               las tres comparaciones
4  se desbloquea el trabajo dependiente del contrato
```

**Lo primero que este intercambio debe producir que no sea un documento** es un
número: el techo actual de `auditMesh` sobre 1M triángulos —RSS máximo, tiempo,
bytes de la estructura de aristas y de la de soldadura— y el mismo número después
de quitar los `Map`. Con su entorno declarado para que sea reproducible.
