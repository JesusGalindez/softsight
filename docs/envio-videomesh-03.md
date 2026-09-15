# Envío 03 a VideoMesh — 2026-09-14

Disparado por §1.4 del contrato, que obliga a avisar **cuando cambia cualquier
esquema**. Ha cambiado uno —el informe que leéis— y sube de versión por primera
vez. Y ha aparecido lo que os faltaba para entregarnos un paquete de verdad: el
transporte.

Este documento es la carta, no el contenido. Lo que rige sigue siendo
[`contrato-videomesh.md`](contrato-videomesh.md); aquí solo está qué mirar, en qué
orden, y **qué rompe si no lo miráis**.

Commits: de `656692c` a `63b05b4`, sobre `main` de
[`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público).
Treinta y siete, con R9 a R16 dentro.

**Los envíos 01 y 02 siguen sin respuesta.** Lo que pedían no ha cambiado de sitio
y se repite abajo, en §4, sin volver a argumentarlo. Mientras no lleguen, los
identificadores no se fijan — y ahora son 32.

---

## 1. Lo que os rompe hoy

### `reconstructionReport` pasa de `0.1` a `0.2`

Es la primera vez que sube, y el motivo es incómodo de escribir: **el documento
había cambiado seis veces y el número se había quedado quieto**. Eso es
exactamente lo que D12 existe para impedir. Quien comparase la combinación creía
estar leyendo el informe de agosto.

La combinación vigente es la que hay que declarar:

```text
animationAudit 1 · bridge 2 · reconstructionPackage 0.1 · reconstructionReport 0.2
report 3 · stagingAudit 1 · storyAudit 1
```

**El paquete de entrada no sube**: su esquema no ha cambiado. Subirlo por
acompañar os obligaría a regenerar modelos que están bien.

### `measurementClass` deja de aceptar cualquier cadena

En tres campos del informe —`coverage`, `confidence`, `captureAdvice`— el tipo
publicado era `string` **sin enum**. Su descripción decía `APPROXIMATE` y el
esquema no lo exigía, así que `measurementClass: "cualquier cosa"` validaba. Una
descripción no valida nada.

Los cinco campos publican ahora el mismo vocabulario:

```text
EXACT | APPROXIMATE | EXTERNAL_MEASUREMENT
```

Dos avisos concretos:

- **`DETERMINISTIC_APPROXIMATION` se retira.** Estaba en el enum de
  `measurements[]` y en ningún otro sitio, y se contradecía con la propia D28: el
  «DETERMINISTIC_» mete el segundo eje dentro del primero, que es lo que esa
  decisión existe para deshacer. Con los dos ejes publicados hay una fila que con
  el nombre viejo no se puede escribir — `APPROXIMATE + TOLERANCE`.
- **`HEURISTIC` sale de la lista.** No lo emite nadie ni lo emitió nunca. Un valor
  publicado que ninguna medida usa promete una clase de medida que no existe.

Si vuestro modelo derivado tenía `str` en esos tres campos, ahora es un enum. Si
tenía el enum viejo en `measurements[]`, le sobra un valor y le falta otro.

### `coverage.maskedCameras` es un campo requerido nuevo

Cuántas de las cámaras traían silueta. Se publica porque **un ratio medido con
máscaras y otro sin ellas no son comparables**, y desde el número solo no se
distinguen.

### `bridgeContractVersion` pasa a `2` — solo si usáis el puente

La 1 sigue valiendo entera para sus diez comandos y la respuesta hace eco de la
versión que se pidió, así que un cliente de la 1 no cambia. Lo que la 2 añade es
una forma de petición nueva, y es lo de la sección siguiente.

---

## 2. Lo que os deja hacer cosas nuevas

### El paquete viaja por ruta — §84 resuelto

Esto es lo que os faltaba para entregarnos un `turret.vmesh` de verdad, y conviene
decir por qué no se podía antes: 150 MB de `dense.ply` son ~200 en base64, el tope
por fichero son 256 **ya codificados**, y el timeout son 120 s. No era estrecho:
era imposible.

```json
{ "bridgeContractVersion": 2,
  "command": "reconstructionInspect",
  "package": { "root": "/ruta/declarada/turret.vmesh" } }
```

Cuatro comandos: `reconstructionInspect`, `reconstructionCoverage`,
`reconstructionCompare` y `productionValidate`. Los mismos por MCP.

**Qué rutas se pueden leer lo decide la configuración del proceso, nunca la
petición.** `SOFTSIGHT_PACKAGE_ROOTS` declara las raíces permitidas; sin ella, no
se lee nada y el error lo dice con su propio código —`package-root-not-configured`,
distinto de «no existe»—. Si la raíz viniera en la petición, cualquiera declararía
`/` y las otras cuatro reglas serían decorado.

```text
realpath en los dos lados antes de comparar
prefijo por COMPONENTES — /datos/x no es prefijo de /datos/x-otro
ningún `..`, aunque resolviera dentro
lectura solamente
```

El manifest se llama `manifest.json` y lo nombramos nosotros: dejar que el cliente
eligiera el fichero convertiría la raíz declarada en permiso de lectura sobre
cualquier JSON que hubiera dentro.

**Lo que no promete:** la apertura es solo para **lectura**. Los artefactos siguen
saliendo por el canal de siempre, así que un paquete que produjera 150 MB de
salida todavía no tiene por dónde devolverlos.

### PLY binario little-endian

`ply-binary` es una capability nueva, **aparte de `ply-ascii`** y no
sustituyéndola: son dos cosas que se saben hacer. Podéis escribir el denso en
binario.

`binary_big_endian` se rechaza por su nombre. Soportarlo cuesta un booleano y no
lo hacemos: no tenemos ningún fichero así con el que comprobarlo, y código que
nadie ha ejecutado es peor que una ausencia declarada.

Un dato del camino, por si os sirve al decidir: el ahorro **no está en los
ficheros pequeños**. Un cubo de juguete crece en binario, porque `-0.5` ocupa lo
mismo escrito que codificado. Con decimales de verdad baja al 44 %.

### Capabilities nuevas que podéis pedir

```text
coverage               ya estaba
confidence-geometric   desde dónde se miró: paralaje, oblicuidad, muestreo
capture-advice         desde dónde disparar la próxima foto, con la ganancia medida
repair-boundary        qué arriesga quien repare cada agujero
ply-binary             lo de arriba
```

Los nombres son deliberadamente modestos y conviene saber por qué, porque afecta a
qué pedís: **`confidence-geometric` y no `confidence`**. Lo que existe dice desde
dónde se miró; lo que pide quien escribe `confidence` a secas es si la superficie
**coincide con lo que las fotos muestran**, que son residuales y piden profundidad
y máscaras. Pedir `confidence` sale `UNSUPPORTED`, y es la respuesta correcta.
Igual con `capture-advice` y no `capture-plan`, y `repair-boundary` y no `repair`.

---

## 3. Lo que cambia en el informe que leéis

Cinco bloques nuevos, todos **ausentes cuando la pregunta no se puede hacer** —
nunca a cero, que diría otra cosa:

```text
coverage         qué fracción de la superficie vio alguien, con su intervalo
confidence       con cuánta autoridad está sostenida: paralaje, oblicuidad, GSD
captureAdvice    hasta ocho tomas sugeridas, con la ganancia de cada una
budgets          los presupuestos declarados, evaluados contra lo medido
repairBoundary   cada agujero clasificado en SAFE, REVIEW o UNSAFE
```

Tres cosas que conviene saber antes de leerlos:

**Ninguno da una nota.** `confidence` no sale como un número entre 0 y 1: salen
fracciones de área por clase y la distribución de los ángulos. Un `0.87` invita a
leerse como «87 % de posibilidades de estar bien», que es una afirmación que nadie
aquí puede sostener.

**Los umbrales no son nuestros.** El suelo de paralaje va como defecto declarado y
sustituible, igual que el presupuesto de D9: una pieza pequeña vista de cerca y un
edificio visto de lejos no toleran lo mismo. Media superficie sin ver **avisa y no
suspende**.

**`repairBoundary` no repara.** Dice qué arriesga quien repare, y dónde. Calcular
un casco o cerrar un agujero es modelar, y ésa es vuestra línea, no la nuestra.

Y un documento entero nuevo que **no es el informe de reconstrucción**:
`production-asset`, con su propio esquema y su propio veredicto,
`PRODUCTION_READY`. No os afecta hoy; está por si algún día entregáis assets y no
paquetes.

---

## 4. Lo que necesita vuestra respuesta

### 4.1 Treinta y dos identificadores sin número

Eran cinco en el envío 01 y 28 en el 02. Siguen sin contestar y ahora son 32, en
seis espacios:

```text
SS-PKG   10   esquema, sellado, integridad, contrato, extensión y capability
SS-IO     7   topes de recurso y lectura
SS-CAM    7   imagen, espacio, pose, rejilla, profundidad, silueta
SS-RECON  5   presupuesto contra escala, FrameGraph
SS-COV    2   superficie sin ver, superficie sin triangular
SS-CONF   1   paralaje corto
```

**Ninguno está fijado**, y su estado vive en la tabla —
`src/soft/agent/reconstruction/codes.ts`—, no en una nota. `test:codes` comprueba
que ninguno se cuele como fijado sin decir qué decisión le falta.

**No los grabéis todavía en ninguna prueba vuestra.** Confirmadlos o cambiadlos:
aquí cambiarlos cuesta un sitio; después de que los grabéis, dos repositorios.

### 4.2 R0-B, y qué le falta exactamente

Conviene ser preciso, porque la respuesta cambió desde el envío 02: **ya no falta
un segundo productor**. `producers/colmap/` lo es desde el 2026-09-13 — escrito
solo desde el JSON Schema publicado, sin importar una línea del verificador, y
coincidiendo con nuestro adaptador **exacta a 0 en los dieciséis números de las
ocho poses**.

Lo que falta son **las tres comparaciones de D23**, que necesitan valores dorados
de una implementación de fuera. Eso no lo puede producir este repositorio sin
dejar de ser la prueba.

### 4.3 El idioma de los códigos — ya decidido, para que conste

Se decidió el 2026-09-13: **todo en español**, también el motivo canónico. Entran
los motivos de frontera y los del veredicto; **no entran** los nombres de campo ni
los valores de enum que escribís —`SEALED`, `TRIANGLE_MESH`, `ABSOLUTE`, `PASS`—,
porque eso es el vocabulario del paquete y traducirlo rompería todo manifest
existente.

Que esto no os rompa es mérito de D2: se parsea el identificador. `SS-CAM-001`
sigue siendo `SS-CAM-001`.

### 4.4 Una propuesta pequeña: `contractVersion` se lee al revés

En el informe, `contractVersion` es la versión del **paquete que se evaluó**, no la
de este documento. El nombre invita a lo contrario, y un consumidor que lo confunda
comparará la versión equivocada — la de este informe vive en `versions.contracts`,
con las otras seis.

De momento solo hemos afinado la descripción publicada, que no rompe a nadie. Si
preferís renombrarlo, decidlo antes de que vuestros modelos lo graben.

---

## 5. Qué no se movió

```text
contractVersion del paquete            0.1
contractVersion del informe de escena  3
pliego del dron                        46228b7c
```

El contrato sigue en **DRAFT**. Se promueve a `1.0` cuando dos productores reales
distintos hayan producido paquetes válidos, y a `producers/colmap/` le falta
entregar superficie: un SfM disperso no tiene malla que cubrir.

---

## 6. Dónde está el registro de decisiones

Veintisiete de las treinta y cuatro están IMPLEMENTADAS, y siete siguen abiertas:

```text
D2   los identificadores de arriba
D5   EXR — no tenemos ninguno con el que probar el lector
D23  los valores dorados
D26  la promoción a 1.0
D28  media prueba: pide macOS y Linux, y aquí solo hay Darwin x86_64
D29  la mitad que escribe el paquete, que es vuestra
D34  su R0-B, que cuelga de D23
```

**Ninguna de las siete depende de escribir código aquí.** Seis dependen de
vosotros o de una máquina que no tenemos, y la séptima —D28— está a medias con su
mitad declarada en voz alta en vez de contarse como hecha.
