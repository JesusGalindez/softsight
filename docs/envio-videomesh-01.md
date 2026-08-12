# Envío 01 a VideoMesh — 2026-08-12

Disparado por §1.4 del contrato: SoftSight avisa cuando **mide la línea base de
`auditMesh`** y cuando **cambia cualquier esquema**. Han pasado las dos.

Este documento es la carta, no el contenido. Lo que rige sigue siendo
[`contrato-videomesh.md`](contrato-videomesh.md); aquí solo está qué mirar, en qué
orden, y **las dos cosas que necesitan vuestra respuesta**.

Commits: `6840970`, `0929852`, `dd2938e`, sobre `main` de
[`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público).

---

## 1. Lo que necesita respuesta

### 1.1 Cuatro identificadores sin número

La ingesta necesitó cuatro códigos que el contrato **no asigna**. D2 nombra sus
motivos —`CONTRACT_SCHEMA_MISMATCH`, `PACKAGE_NOT_SEALED`— pero el número es lo
que vosotros parseáis, y eso no lo decide un lado solo.

```text
SS-PKG-010  el manifest no encaja con el esquema
SS-PKG-011  el paquete no está sellado
SS-PKG-012  el tamaño declarado no es el del fichero
SS-PKG-013  el contenido no coincide con el sha256 declarado
SS-PKG-014  el sha256 declarado no es un sha256
```

El quinto lo separamos del cuarto a propósito: «el hash no cuadra» lo arregla el
contenido y «el hash no es un hash» lo arregla vuestro escritor de manifests, y
quien automatice sobre el identificador quiere poder distinguirlos. Si os parece
ruido, se funden en uno.

El estado vive en la tabla —`src/soft/agent/reconstruction/codes.ts`— y no en un
comentario: cada entrada dice su motivo canónico, qué decisión la fija y si está
`FIJADO` o `PROPUESTO`, y `test:codes` comprueba que los cuatro de D6 estén
fijados y que ningún propuesto se cuele como tal. **No los grabéis todavía en
ninguna prueba vuestra.** Confirmadlos o cambiadlos: aquí cambiarlos cuesta un
sitio.

Un detalle que conviene que veáis antes de escribir vuestro parser:
**`SS-PKG-001` y `SS-PKG-003` comparten motivo** —`ARTIFACT_PATH_ESCAPES_ROOT`—
porque el resultado es el mismo y la causa no. Un motivo puede repetirse; un
identificador, nunca. Es justo por lo que el contrato manda parsear el
identificador.

Los cuatro del sandbox (`SS-PKG-001..004`) sí los fija D6 y están tal cual.

### 1.2 Qué certifica R0, que no está en ninguna decisión

D18 exige que `cube-v1` salga `COMPLETE + PASS`, y sin criterio no hay veredicto.
Está aplicado y publicado en cada informe como `certificationPolicy`, y anotado
como **pendiente sin número** según §1.6:

```text
PASS           el paquete está íntegro, la evidencia requerida está,
               y toda malla declarada se lee y tiene superficie
INCONCLUSIVE   falta evidencia que el contrato pide, o no había nada que medir
FAIL           lo que se midió contradice lo que el paquete declara
```

**La calidad geométrica no decide el veredicto**, y esto es lo que más nos
interesa que discutáis: una malla reconstruida con agujeros es lo normal. Se
reporta —`boundaryEdges`, `nonManifoldEdges`— y el umbral lo pondrá producción,
que es otro documento. Si certificáramos «cerrada o FAIL», casi toda
reconstrucción real fallaría y el incentivo sería rellenar agujeros para pasar la
puerta, que es justo lo que `purelyReconstructed` existe para poder distinguir.

Lo único que sí es FAIL hoy: que la malla contradiga al manifest. Un
`TRIANGLE_MESH` con cero triángulos es eso.

### 1.3 Un campo del paquete que puede que os falte

`producer { name, version }` es **requerido** en el manifest. No sale de ninguna
decisión: lo puse porque el informe tiene que poder decir quién escribió el
paquete. Si vuestro escritor no lo emite hoy, decidlo y lo bajo a opcional antes
de que `cube-v1` choque contra ello.

---

## 2. La frontera, ya publicada

`contracts/*.schema.json`, generados de los esquemas que validan de verdad y
commiteados, como reparte D15. Nunca escritos a mano: hay una puerta que se pone
roja si el commiteado y el generado divergen.

```text
fichero                              sha256 (16)        bytes
scene.schema.json                    1d0c38a2e0cd2e5a   41124
patch.schema.json                    e677c59c5048a4cc   33541
story.schema.json                    f90771f3d20e29de    1951
staging.schema.json                  2057546b2f5be99d    4148
sample-reference.schema.json         29bc83e9e7766b44     975
reconstruction-package.schema.json   1a0f241746504f78   15555
reconstruction-report.schema.json    f0b0d4e48692e60b   10722
```

`scene` y `patch` crecieron un tercio: es la forma que antes estaba en las
descripciones y ahora está en el esquema.

Los dos últimos son los de esta frontera: el paquete que escribís y el informe
que os devolvemos. El sexto, `videomesh.reconstruction-package`. Es el **esqueleto de
R0-A**, no el contrato entero — identidad, sellado, artifacts, CameraSet, escala,
FrameGraph y `requiredEvidence`. Sin cobertura ni confianza: R0 se las prohíbe, y
el esquema las rechaza como campo desconocido.

Estos hashes **no son todavía los de D16**: son de los ficheros, para que sepáis
que miramos el mismo texto. El registro de compatibilidad por hash sigue sin
escribir.

### Fixtures

```text
fixtures/unknown-field-v1.json           5ec0eb310fae6438   D30, fila 1
fixtures/reconstruction-package-v1.json  ef8b9e44df8fa67a   D21, D20, D19, D14
fixtures/package-integrity-v1.json       909aa706f84dcdcd   D6, D7, D29, D13
```

`package-integrity-v1` absorbe `invalid-path-v1`, `hash-mismatch-v1` y
`unsealed-package-v1`: los tres preguntan lo mismo —qué paquetes entran— y
partirlos en tres ficheros era partir una tabla.

Los tres llevan casos que **deben aceptarse** además de los que deben rechazarse.
Sin ellos, un validador que rechace todo pasa la prueba.

---

## 3. D21: vuestra apuesta era correcta, y por poco

D21 daba por hecho que nuestro esquema en ejecución sabía expresar formas por tipo
de artifact. **No sabía.** `anyOf` se aplica al campo entero y no a cada elemento
de una lista, que es lo que son los artifacts.

Se disparó la condición de D15 —si el esquema no llega, se extiende el esquema— y
entró `variants`: discriminante **declarado**, no adivinado, y el literal se mira
antes que la forma, que es exactamente lo que pedía vuestra nota. Los cuatro casos
dan el mensaje que la decisión quería:

```text
TRIANGLE_MESH con true    válido
TRIANGLE_MESH con false   válido
TRIANGLE_MESH sin campo   falta artifacts[0].purelyReconstructed
POINT_CLOUD con campo     artifacts[0].purelyReconstructed no existe
```

Y uno que no habíamos escrito y hacía falta: un tipo inexistente enumera los que
hay, en vez de fallar por forma.

```text
type: "MESH"   →   no admite "MESH"; admitidos: TRIANGLE_MESH, POINT_CLOUD, IMAGE, DEPTH_MAP
```

**D6 y D21 pasan a IMPLEMENTADAS.** D7 y D29 se quedan a medias: a D7 le falta que
el informe publique los hashes, y a D29 todo lo que garantiza quien escribe
—rename atómico, mismo volumen, destino que ya existe—, que es prueba vuestra.

### 3.1 Un agujero en la frontera que publicamos, ya tapado

Si habéis leído `contracts/scene.schema.json` de antes del 2026-08-12, el campo
`geometry` os mentía: emitía la forma genérica `{ "type": "object" }` **al lado**
de sus seis alternativas, así que cualquier objeto casaba y las alternativas no
decidían nada. Un modelo derivado de ahí aceptaría geometrías que SoftSight
rechaza.

Está corregido, junto con otros diecisiete campos que tenían su forma escrita en
la descripción y no en el esquema: las cuatro deformaciones, los puntos de un
recorrido —ahora `number[3][]` de verdad— y las tablas de variación. De veinte
objetos que admitían campos desconocidos quedan dos, y los dos son datos libres a
propósito.

**Regeneradlos.** Los hashes de §2 son los de después del arreglo.

---

## 3.5 Las convenciones de cámara, y un error que encontramos en las nuestras

`camera-projection-v1` publica nuestra mitad de la fila 4 de D23: cuatro cámaras
por seis puntos —centro, dos esquinas, fuera de eje, cerca del borde, y uno
detrás de la cámara— con el píxel esperado y **la fórmula escrita en el propio
fixture**, para que podáis derivar los mismos números sin leer nuestro código.

El CameraSet gana dos campos requeridos, y los dos hacen falta para que la fila 4
sea posible:

```text
worldFromCamera   4×4 por filas, traslación en 3, 7 y 11 (D32). Solo esta;
                  la inversa se calcula
cameraAxes        X_RIGHT_Y_DOWN_Z_FORWARD  (COLMAP, OpenCV)
                  X_RIGHT_Y_UP_Z_BACKWARD   (gráficos; el nuestro)
```

**`cameraAxes` no tiene valor por defecto a propósito.** Confundir los dos marcos
no produce una imagen torcida: produce una especular en Y con la profundidad
invertida, y sobre un objeto simétrico las dos parecen igual de correctas. Si
vuestro escritor emite COLMAP puro, es la primera de las dos y no hay conversión
que hacer en el paquete.

**Y encontramos un error nuestro escribiéndolo**, que es la razón de que os lo
contemos con detalle: las imágenes de `cube-v1` salían **ortográficas** mientras
el manifest declaraba `PINHOLE` con una focal sacada del campo de visión. El
encuadre de un cubo alineado sale igual con las dos proyecciones, así que las
imágenes parecían correctas y los hashes cuadraban; solo la vista de tres cuartos
lo delató, por treinta píxeles. Era el manifest describiendo unos píxeles que no
eran los suyos, y ninguna comprobación de integridad puede ver eso.

Es exactamente el fallo contra el que sirve la fila 4, y por eso conviene que
vuestra mitad no sea «proyectamos con la misma librería que generó las imágenes».

---

## 4. El número que este intercambio debía producir

D25, medido y publicado. Entorno: `darwin/x64`, Node v24.13.0, Intel i5-5350U
(2 físicos / 4 lógicos), 8 GiB de RAM, heap viejo por defecto 2240 MiB, 1 worker.

```text
5M triángulos      antes (dos Map)   después
CPU                11,41 s           0,93 s
RSS máximo         888,7 MiB         314,8 MiB
heap de V8         460,4 MiB           6,2 MiB
heap mínimo        entre 384 y        64 MiB o menos
para no reventar   416 MiB
```

Antes moría abortando en `OrderedHashMap`, que es la representación de `Map` en
V8. La soldadura es ahora una tabla de dispersión abierta en dos `Int32Array` y
las aristas se cuentan agrupando por conteo y prefijos.

**Para vosotros esto importa por una cosa:** `auditMesh` ya no es el techo de 5M,
así que la puerta de alto poligonaje no bloquea nada de `cube-v1`. La malla de
prueba la genera un script sin dependencias —cero bytes en git, D22— y el escalón
de 5M solo corre con `SOFTSIGHT_HEAVY=1`.

---

## 5. Dónde estamos, y qué esperamos de vosotros

```text
SoftSight   S1..S6 hechos           R0-A CERRADO
VideoMesh   V1..V10                 sin noticias por este canal
```

**R0-A pasa.** `cube-v1` recorre esquema, sandbox, hashes, PLY, CameraSet,
escala, FrameGraph, auditoría y sobre del informe, y sale `COMPLETE + PASS` con
código 0. El informe valida contra su propio esquema publicado y es **idéntico
byte a byte entre dos ejecuciones**: no lleva reloj, y el `runId` sale del hash
del manifest. Si vuestro informe lleva marca de tiempo, no se podrá comparar bit
a bit, que es lo que D28 pide de la frontera.

Seis decisiones implementadas: **D3, D6, D7, D14, D21, D25**.

Lo que desbloquea lo siguiente, por orden de lo que nos frena:

1. **Los cuatro códigos de §1.1**, que es lo único que os pedimos de verdad hoy.
2. **`allow_nan=False` y su prueba** (V1, V2): un `NaN` que llegue serializado ya
   es un paquete inválido que nadie puede rechazar bien desde este lado.
3. **Vuestro `cube-v1` y `expected.json`** (V3, V4), que es lo que convierte R0-A
   en R0-B.

R0-A lo cerramos solos, como dice D34: no os esperamos para eso.
