# Encargo 01 — orden de trabajo para un agente auxiliar

Documento de **encargo**, no de estado. El estado del proyecto lo lleva
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5 y nadie más; las decisiones de
la frontera con VideoMesh las lleva [`contrato-videomesh.md`](contrato-videomesh.md)
§1.6. Aquí solo está **el orden, el criterio de aceptación de cada tarea y las
reglas de trabajo**. Si algo de aquí contradice a esos dos, mandan ellos.

Escrito el 2026-09-13, sobre `main` en `bae4463`, con la suite en verde:
28 puertas, 143 comprobaciones, 65,3 s, 5 declaradas NOT_RUN con motivo.

**Este encargo está terminado.** El bloque A se cerró el 2026-09-13, y con él
cayeron además el bloque D en sus dos primeros escalones —R4 y R5— y la costura
del suavizado que el bloque A destapó. Qué quedó de cada tarea lo lleva
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5 y el registro de decisiones
lleva su cuenta; aquí no se repite.

**Lo que queda no es trabajo de este repositorio**, y está en el §5.20 del mapa
con su dueño al lado: mandar el envío 02, decidir el idioma de los códigos y
conseguir un COLMAP real son del dueño; R0-B y los 28 identificadores son de
VideoMesh; E1, Ω6.4 y F1 viven en el editor.

El documento se queda **como plantilla**: las reglas de §1 y la forma de §2 valen
para el encargo siguiente, que empezará por donde el §5.20 diga que se ha
desbloqueado.

---

## 0. Antes del primer comando

Leer, en este orden, y no saltarse ninguno:

1. [`AGENTS.md`](../AGENTS.md) en la raíz — 120 líneas. Las cuatro identidades,
   las tres invariantes que rompen el producto, las órdenes y las puertas.
2. [`mapa-del-proyecto.md`](mapa-del-proyecto.md) §3 (de quién es cada dato) y
   §5 (qué toca ahora).
3. [`contrato-videomesh.md`](contrato-videomesh.md) §1 entero — cómo se mueve una
   decisión de ACORDADA a IMPLEMENTADA.
4. De [`plan-reconstruccion.md`](plan-reconstruccion.md), solo §86 (las
   correcciones al plan tras contrastarlo con el código real) y §71 (el roadmap
   R0–R16). Los §0–83 los escribió el agente de VideoMesh y **§84–86 mandan donde
   se contradigan**.

Después:

```bash
npm run verify
```

Si sale rojo, **para y dilo**. No se empieza una tarea sobre un árbol en rojo.

---

## 1. Reglas de trabajo — no negociables

**R1. Una tarea se cierra cuando existe una prueba que falla sin ella.**
Es la regla de §1.2 del contrato, y aplica también a las tareas que no tocan
ninguna decisión. «Lo escribí y parece que va» no cierra nada.

**R2. Ningún dato se escribe en dos sitios.** Antes de escribir un número, un
estado o un recuento, mirar de quién es. Si ya vive en otro sitio, **generarlo,
importarlo o apuntar**: `tools/agents-md.mjs` regenera las secciones de
`AGENTS.md`, `tools/contracts.mjs` genera `contracts/*.schema.json` de los
esquemas en ejecución, `tools/run-tests.mjs` imprime el recuento de
comprobaciones. Escribirlos a mano es el error que ya se ha cometido dos veces en
este repositorio.

**R3. El estado del trabajo se actualiza en `mapa-del-proyecto.md` §5, y solo
ahí.** Al cerrar una tarea, se edita §5. No se abre una sección nueva en otro
documento para contar lo mismo.

**R4. Cambiar la aritmética o un hash obliga a subir `contractVersion`**
(`tools/agent3d.mjs`). Si una tarea mueve un `renderHash` sin que su enunciado lo
pidiera, **para y dilo**: es un defecto, no un efecto secundario.

**R5. Cambio quirúrgico.** Cada línea tocada se rastrea hasta el enunciado de la
tarea. No se mejora redacción, formato ni comentarios adyacentes. Código muerto
no relacionado: se menciona, no se borra.

**R6. Dónde va cada cosa.** `reconstruction/` y `production/` bajo
`src/soft/agent/` (D27). Nada de `src/soft/io/`: `glbLoader.ts` y `objLoader.ts`
ya viven en `agent/`, y moverlos no sería aditivo.

**R7. Las medidas.** Esta máquina es un i5-5350U de dos núcleos físicos que se
degrada por temperatura: el mismo trabajo dio 61 s al empezar la sesión y 84 s al
acabarla. Medir con `/usr/bin/time -p` y comparar **`user` + `sys`**, nunca
`real` entre medidas lejanas. Ruido de ±25 %: **no se afirma una mejora menor
del 30 %**.

**R8. Una puerta que no puede correr se declara NOT_RUN con su motivo y sale 0.**
Nunca se salta en silencio, y el motivo dice **qué falta**, no «pendiente».

**R9. Puerta nueva = tres sitios.** El fichero en `tools/*.test.mjs`, la entrada
en `GATES` de `tools/run-tests.mjs` con su tiempo medido en el comentario, y el
script en `package.json`. Después `node tools/agents-md.mjs --write` regenera los
bloques de `AGENTS.md`, y `npm run test:agents-md` lo comprueba.

**R10. Si cambia un esquema, se anota en
[`coordinacion.md`](coordinacion.md).** Con qué cambió, si es aditivo, y qué tiene
que mirar el otro lado. Es lo que dispara un envío.

**R11. Lo que no se toca.** La lista de §86.5 de `plan-reconstruccion.md` no se
renegocia: la tabla de ownership, `RECONSTRUCTED != INFERRED`, SAFE/REVIEW/UNSAFE,
evidencia en todo aviso importante, `renderSource` publicado, caché por hash de
contenido y nunca por `mtime`, y nunca transformar el sistema de coordenadas en
silencio.

**R12. Cuándo parar y preguntar.** Solo tres casos: la acción es difícil de
deshacer (borrar, sobrescribir, refijar un control congelado, publicar hacia
fuera); dos lecturas razonables del enunciado dan trabajos distintos; o la
decisión es de criterio y no de hecho. Todo lo demás: construir y decir qué se
supuso.

**R13. Commits.** Uno por tarea, en español, minúscula tras el tipo, frase
descriptiva de lo que cambia — el estilo del `git log` actual:
`fix: un número no finito deja de ser un número válido, y D13 y D16 se cierran`.
No commitear si `npm run verify` no pasa.

---

## 2. El orden

Tres bloques. **El bloque A entero antes del B**; el C no depende del agente.

Cada tarea trae: por qué existe, qué ficheros toca, **cómo se sabe que está
hecha**, y si mueve `contractVersion`.

---

### Bloque A — lo que no depende de nadie · **cerrado el 2026-09-13**

Las doce tareas están hechas. Se dejan escritas porque el **criterio de
aceptación** de cada una es lo que la puerta correspondiente sigue exigiendo, y
porque tres de ellas descubrieron algo que su enunciado no preveía: A1 encontró
que lo que ataja una cabecera mentirosa es contar filas y no el tope, A9 destapó
la costura del suavizado, y A10 tuvo que medir el predicado antes de poder
decidir su severidad.

#### A0 · El mapa §5.19 dice que faltan tres cosas y faltan dos

**Por qué.** `mapa-del-proyecto.md` §5.19 dice «no se escribe código hasta cerrar
tres cosas»: por dónde viaja el paquete, uno o dos repositorios, y el idioma de
los códigos nuevos. **Las dos primeras están cerradas** y el mapa no se enteró:
D1 fija filesystem y rutas, D27 fija un repositorio con frontera modular. Queda
solo la tercera. Es exactamente el fallo que la regla R2 existe para impedir, en
el documento que es la fuente única.

**Ficheros.** `docs/mapa-del-proyecto.md`, punto 19 de §5.

**Hecho cuando.** El párrafo nombra **una** cosa pendiente —el idioma de los
códigos, §86.2 (g)— y apunta a D1 y D27 para las otras dos en vez de repetirlas.

**Contrato.** No se mueve nada. Es prosa.

**Aviso.** El idioma de los códigos **es una decisión de criterio y afecta a
VideoMesh**: no la toma el agente. Se deja anotada como pendiente del dueño, con
el coste escrito: `test:codes` compara la tabla contra `src/` en las dos
direcciones, así que mezclar `RECON_LOW_COVERAGE` con `BORDE_ABIERTO` se paga en
cada código nuevo.

---

#### A1 · Límites de recurso en la ingesta

**Por qué.** SoftSight va a leer ficheros producidos por terceros y hoy no tiene
un solo tope. `src/soft/agent/reconstruction/ply.ts:150` hace
`new Float32Array(element.count * 3)` con el `count` que declara la cabecera: un
PLY que diga `element vertex 4000000000` reserva memoria antes de leer un byte de
datos. §86.3 (o). **El código de salida ya existe y no lo usa nadie**: D13 reserva
el **23 — límite de recursos** y `exitCodeForReport` en `tools/reconstruction.mjs`
no lo devuelve nunca.

Es, con A2, uno de los dos únicos sitios donde el fallo es silencioso.

**Ficheros.** `src/soft/agent/reconstruction/ply.ts`,
`src/soft/agent/reconstruction/ingest.ts`,
`src/soft/agent/reconstruction/codes.ts` (identificadores nuevos del espacio
`SS-IO`), `tools/reconstruction.mjs` (devolver 23), `tools/reconstruction.test.mjs`.

**Qué escribir.** Topes declarados en un solo sitio y publicados por `--schema`,
no repartidos por el código: tamaño de fichero, número de vértices, número de
elementos, longitud de la cabecera, número de artifacts del paquete. Se
comprueban **antes de reservar**, no después.

**Hecho cuando.** `test:reconstruction` tiene un caso por tope que **falla si se
quita el tope**: un PLY con cabecera mentirosa sale con código **23** y su
identificador, sin haber reservado la memoria. El fixture es sintético y de
bytes contados; no entra un fichero grande en git (D22).

**Contrato.** Aditivo. `contractVersion` no se mueve. Los identificadores nuevos
nacen **FIJADO** si los fija D6 o el propio espacio `SS-IO`, y **PROPUESTO** con
su decisión pendiente si no.

---

#### A2 · El espacio `extensions`, y D30 deja de estar a medias

**Por qué.** D30 —campo desconocido es error— tiene una de sus tres filas
probada; las otras dos hablan de un espacio `extensions` que **ningún esquema
declara**, así que `test:contracts` las deja NOT_RUN y **D30 sigue ACORDADA**.
Es la ACORDADA más barata de cerrar del registro, y desbloquea una de las cinco
puertas que hoy no corren.

**Ficheros.** `src/soft/agent/reconstruction/packageSchema.ts` y los demás
esquemas en ejecución, `tools/contracts.mjs`, `contracts/*.schema.json`
(**generados, nunca escritos a mano** — D15), `tools/contracts.test.mjs`,
fixtures en `contracts/fixtures/`.

**Qué escribir.** El espacio explícito para lo experimental, y las dos reglas que
faltan: **capability requerida desconocida → UNSUPPORTED**; **opcional
desconocida → política declarada**, no silencio.

**Hecho cuando.** Las tres filas de D30 tienen fixture y ninguna queda NOT_RUN.
`test:contracts` corre entera. D30 pasa a IMPLEMENTADA en `contrato-videomesh.md`
con su fecha, y el recuento de §1.6 se actualiza — **§1.6 es el dueño de ese
recuento**, no el mapa.

**Contrato.** Los dos objetos que hoy admiten campos desconocidos a propósito —la
tabla de una pista y el `data` de una escena— **siguen admitiéndolos**. Si el
cambio los cierra, está mal.

---

#### A3 · Un solo bloque de versiones, y una puerta que rechaza lo no declarado

**Por qué.** §86.2 (h): ya conviven `contractVersion` (3), `bridgeContractVersion`
(1), `STORY_AUDIT_CONTRACT_VERSION`, `STAGING_AUDIT_CONTRACT_VERSION` y las del
paquete de reconstrucción, **sin tabla de compatibilidad**. El consumidor
comprueba campos sueltos en vez de un bloque. Es D12.

**Ficheros.** El informe (`src/soft/agent/reconstruction/report.ts` y el informe
de escena), `tools/contracts.mjs`, puerta nueva o extensión de `test:contracts`.

**Hecho cuando.** El informe declara **en un solo bloque** todas las versiones que
usó, el bloque sale por `--schema`, y una puerta **rechaza una combinación no
declarada**. D12 pasa a IMPLEMENTADA.

**Contrato.** Aditivo si el bloque se añade sin quitar los campos sueltos de hoy.
Quitarlos es otra tarea y no es esta.

---

#### A4 · Negociación de capabilities

**Por qué.** D31. El paquete declara `requires` y `provides`; SoftSight publica
`supports`. Sin esto, un paquete que pide algo que no sabemos hacer se procesa a
medias en vez de salir UNSUPPORTED.

**Depende de A3** (el bloque de versiones es donde vive `supports`) y **de A2**
(la regla de capability desconocida es una de las dos filas de D30).

**Hecho cuando.** Los tres desenlaces tienen fixture: requerida desconocida →
UNSUPPORTED con código 21; opcional desconocida → la política declarada;
requerida conocida → se usa. D31 pasa a IMPLEMENTADA.

---

#### A5 · Escala, y los presupuestos absolutos que la contradicen

**Por qué.** D9 más §86.3 (l). Hoy conviven «nunca asumir metros» y presupuestos
escritos en metros. Falta la regla: **con `status != ABSOLUTE` un presupuesto
absoluto se rechaza**, y el fallback es relativo a la diagonal de la caja
envolvente. Nota adjunta ya medida: `auditMesh` redondea `signedVolume` con
`.toFixed(6)`, y con escala desconocida eso puede ser el número entero.

**Hecho cuando.** `status` (UNKNOWN | RELATIVE | ABSOLUTE), `source` y la
incertidumbre con su modelo viajan en el paquete; un fixture con
`status: UNKNOWN` y un presupuesto en metros **sale rechazado con su motivo**, y
el mismo paquete con `ABSOLUTE` pasa. D9 pasa a IMPLEMENTADA.

---

#### A6 · `CameraImageSpace` como una sola unidad

**Por qué.** D10 y D33. `imageSpace`, `pixelOrigin`, `pixelCenter`,
`transformConvention`, handedness y ejes tienen que viajar **juntos** con
`imageArtifactHash`, dimensiones, intrínsecos, distorsión y orientación. Repartidos
se combinan mal y nadie lo nota: el riesgo R6 del contrato es exactamente
«cobertura falsa por convención de cámara».

Ya hay precedente medido de que esto muerde: las imágenes de `cube-v1` salían
ortográficas mientras el manifest declaraba `PINHOLE`, y lo destapó una puerta,
no una revisión.

**Hecho cuando.** La unidad existe en el esquema, `cube-v1` y `colmap-small-v1`
la llenan, y la proyección de puntos conocidos se comprueba contra valores
dorados **y** contra la silueta que pintó el rasterizador. D10 y D33 pasan a
IMPLEMENTADAS.

**Contrato.** Si mueve los `renderHash` de `cube-v1`, sube `contractVersion` y se
dice en `coordinacion.md`. El pliego del dron (`46228b7c`) **no se toca**.

---

#### A7 · FrameGraph

**Por qué.** D11. Cuatro marcos —CAMERA, RECONSTRUCTION, ASSET_CANONICAL,
PRODUCTION— y cada transformación guardando marco origen, marco destino, matriz,
motivo y productor. **Ninguna se hornea sin registrarla.** Es el riesgo R7,
«malla de producción en otro marco».

**Depende de A6.**

**Hecho cuando.** Una transformación aplicada sin entrada en el grafo **falla una
puerta**. Ése es el único criterio que vale aquí: si el grafo es un campo que se
rellena por educación, no sirve.

**Precedente que hay que respetar.** D32 ya obligó a que la conversión con glTF
ocurra en un sitio, `agent/gltfFrame.ts`, y `test:gltf-frame` prohíbe que
`column * 4 + row` aparezca en `src/` fuera de ese fichero. El FrameGraph se
construye **sobre** eso, no al lado.

---

#### A8 · `depthKind` obligatorio

**Por qué.** D20. `OPTICAL_AXIS | RAY_LENGTH`, sin valor por defecto y sin
inferirlo por proveedor. Confundirlos mete un error que crece con el ángulo:
cero en el centro, máximo en las esquinas.

**Hecho cuando.** Un artifact de profundidad sin `depthKind` **es error de
esquema**, no un aviso. Hay fixture con depth —hoy no existe ninguno— y la prueba
mide la diferencia entre las dos interpretaciones en una esquina, para que el
número diga por qué importa. D20 pasa a IMPLEMENTADA.

---

#### A9 · Reducción determinista en paralelo

**Por qué.** §86.3 (m). `src/soft/parallel.ts` ya rasteriza por bandas y el
determinismo está medido en dos sistemas, pero **nadie ha escrito la regla de la
reducción**: sumar distancias sobre millones de muestras según van llegando los
workers da resultados distintos por orden de terminación. Es el riesgo R9, y es
la clase de fallo que aparece cuando la cobertura empiece a muestrear de verdad
—o sea, justo después de este bloque—.

**Qué escribir.** **Reducción en orden fijo por índice de bloque**, nunca sobre
resultados según llegan.

**Hecho cuando.** Una prueba que reparte el mismo trabajo con 1, 2 y 4 procesos
da **el mismo bit**, y falla si la reducción se hace por orden de llegada.
Sujeta al presupuesto: si tarda más de unos segundos, va tras
`SOFTSIGHT_HEAVY=1` con su NOT_RUN declarado, como `test:resources`.

**Cuidado con R7.** Esta máquina tiene dos núcleos físicos. El reparto viene
apagado (`SOFTSIGHT_TEST_JOBS`) por una medida, no por olvido: no se enciende de
paso.

---

#### A10 · `SELF_INTERSECTION` no es una certeza

**Por qué.** §86.3 (n). En coma flotante no existe el confirmado. La lección ya
está escrita en `src/soft/agent/geometryAudit.ts`: `segmentsCross` es estricto a
propósito, porque admitir el caso colineal convertiría en aviso el borde de fuga
de cualquier perfil aerodinámico.

**Qué escribir.** O predicados exactos, o el estado se llama `LIKELY` y
**publica su epsilon**. La segunda es la barata y la coherente con cómo ya
funciona `severity`: medida firme, conclusión abierta = `candidato`.

**Hecho cuando.** El código emitido es `candidato`, el informe publica el epsilon
usado, y el perfil aerodinámico del ejemplar de geometría **sigue sin dar aviso**.
La tabla de `warningCodes.ts` crece y `test:codes` lo comprueba en las dos
direcciones.

---

#### A11 · R1.5 — la rebanada vertical, declarada

**Por qué.** §86.4 (p): el roadmap §71 es horizontal y la integración solo se
demuestra en R9/R15, tras unos cincuenta items. Si el contrato está mal, se
descubre al final. **`cube-v1` ya es casi esa rebanada** —malla, nube, cuatro
imágenes renderizadas, CameraSet, informe COMPLETE + PASS con salida 0—; lo que
falta es **declararlo como escalón** y cerrarle los dos huecos que le quedan
tras A6 y A8.

**Hecho cuando.** `plan-reconstruccion.md` §71 tiene R1.5 entre R1 y R2, con su
gate escrito, y `mapa-del-proyecto.md` §5 dice que está hecho. Cero código nuevo
si A1–A10 fueron bien: es la tarea que **comprueba que el bloque A sirvió para
algo**.

---

### Bloque B — necesita datos que hoy no existen · **sigue abierto**

#### B1 · Un COLMAP real, fuera del repositorio

**Por qué.** D4 está **MEDIO HECHA**: el adaptador lee los tres ficheros y las
propias observaciones lo juzgan —36 reproyecciones con error máximo de
6,1·10⁻⁹ píxeles—, pero `colmap-small-v1` es sintético: ejerce la conversión, no
los datos. Faltan modelos de cámara reales, coma flotante real y el
comportamiento real de la escala. Y §86.4 (q) sube el adaptador de «opcional» a
**fuente de fixtures de R0**, porque COLMAP produce datos reales hoy, gratis, sin
esperar a VideoMesh.

**Cómo, sin romper D22.** Fixture pesado **fuera del repositorio**, por variable
de entorno, **con su sha256 en un manifiesto versionado**. Sin el dataset, la
puerta se declara NOT_RUN con su motivo — que es lo que `test:colmap` ya hace
hoy.

**Hecho cuando.** `test:colmap` corre contra un COLMAP real cuando la variable
apunta a él, el sha256 cuadra, y **D4 pasa a IMPLEMENTADA**. Si el dataset no
aparece, la tarea **no se cierra**: se dice que sigue abierta y por qué. No se
inventa un fixture «casi real».

**Parar y preguntar.** De dónde sale el dataset y dónde vive es decisión del
dueño, no del agente.

---

### Bloque C — bloqueado fuera · **sigue bloqueado, y ha crecido**

Esto **no se trabaja**. Está aquí para que nadie lo empiece por error.

- **El envío 01 lleva un mes sin respuesta.** `docs/envio-videomesh-01.md` salió
  el 2026-08-12 pidiendo dos cosas y no hay entrada de respuesta en
  `coordinacion.md`. De ahí cuelga todo lo siguiente. **El envío 02 está
  redactado y sin mandar** —`docs/envio-videomesh-02.md`—, con dos esquemas
  cambiados y cuatro campos obligatorios nuevos.
- **Los identificadores en PROPUESTO han pasado de cinco a 28**, en cuatro
  espacios —`SS-PKG`, `SS-IO`, `SS-RECON` y `SS-CAM`—, y siguen sin
  número acordado. Están marcados en `codes.ts` con su estado, y `test:codes`
  comprueba que ninguno se cuele como fijado. **No se fijan por nuestra cuenta**:
  cambiarlos aquí cuesta un sitio, cambiarlos después de que VideoMesh los grabe
  en sus pruebas cuesta dos repositorios.
- **R0-B** espera el `cube-v1` de VideoMesh y su `expected.json`. D34 es explícita:
  mientras R0-B no pase, **no avanza nada que dependa del contrato compartido**.
  El bloque A no depende de él — por eso es el bloque A.
- **La mitad del editor de E1** —comparar sus cajas contra
  `artifacts/agent/encuadre-control.json`— vive en el otro repositorio.
- **Ω6.4** y el plan del motor **F1** viven en el editor.

---

### Bloque D — R4 y R5 hechos; el resto choca con D34

**R4 y R5 se cerraron el 2026-09-13**, y los dos por el mismo motivo: no
dependían del contrato compartido, que es lo que D34 deja avanzar en paralelo.
R5 estaba desbloqueado desde R3 sin que nadie lo hubiera anotado —el
`nearestPoint` del árbol es la primitiva que un diff de superficie necesita—.

**R6 en adelante no se puede empezar.** Cobertura y confianza son exactamente lo
que D34 bloquea hasta que R0-B pase, y `SUPPORTED_CAPABILITIES` lo dice en código:
un paquete que las pida sale UNSUPPORTED.

Lo que sigue anotado para cuando se desbloquee:

**R6 (inteligencia de reconstrucción), R7 (informe), R8 (residuales
multivista)** y el resto hasta R16, tal como los describe
`plan-reconstruccion.md` §71 — con dos avisos que se aplican desde el primer día:

- **§86.3 (k):** una cobertura muestreada publica **N, si está ponderada por área
  y su varianza**. Un PASS/FAIL contra un estimador de varianza desconocida cerca
  del umbral es una moneda al aire. Si el intervalo cruza el umbral, el veredicto
  es inconcluso. Lo primero ya está hecho en `meshDiff.ts`, que publica sus
  `samples`: R6 lo hereda en vez de inventarse otra forma de decirlo.
- **§86.2 (f):** las «exactness classes» del §27 **no se implementan**; se extiende
  el enum de `warningCodes.ts`. `aproximacion-determinista` entró con A10.
  **`externo` sigue sin entrar** y es deliberado: no hay un solo proveedor externo
  —el validador de Khronos no está integrado— y un valor que nadie emite es una
  promesa vacía. Entra con el primero que lo use.

---

## 3. Qué reportar, y cómo

Al acabar **cada** tarea:

1. `npm run verify` en verde, con el recuento que imprime la suite.
2. Qué decisión se movió y a qué estado, con la fecha, en
   `contrato-videomesh.md` §1.6 — **que es el dueño de ese recuento**.
3. Una línea en `mapa-del-proyecto.md` §5 diciendo qué quedó hecho.
4. Si cambió un esquema, una entrada en `coordinacion.md` con qué mirar del otro
   lado y si es aditivo.
5. Un commit, con el estilo de R13.

Al acabar **el bloque**: qué quedó abierto y por qué, con la medida real. Si una
tarea no se cerró, se dice; no se cierra a medias y se anota como hecha.
