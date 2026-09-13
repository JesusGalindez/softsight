# Envío 02 a VideoMesh — 2026-09-13

Disparado por §1.4 del contrato, que obliga a avisar **cuando cambia cualquier
esquema**. Han cambiado dos, y el paquete que escribís ya no valida sin tocarlo.

Este documento es la carta, no el contenido. Lo que rige sigue siendo
[`contrato-videomesh.md`](contrato-videomesh.md); aquí solo está qué mirar, en qué
orden, y **qué rompe si no lo miráis**.

Commits: de `88f8b90` a `20b0a9a`, sobre `main` de
[`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público).

**El envío 01 sigue sin respuesta.** Lo que pedía allí no ha cambiado de sitio y
se repite abajo, en §4, sin volver a argumentarlo. Mientras no llegue, los
identificadores no se fijan.

---

## 1. Lo que os rompe hoy

Cuatro campos nuevos **obligatorios** en el paquete. Un manifest escrito contra el
esquema de hace un mes ya no valida, y el error que devuelve dice exactamente cuál
falta.

```text
cameras[].imageArtifactHash   sha256 de la imagen a la que pertenecen los intrínsecos
cameras[].imageSpace          "ORIGINAL" | "RECTIFIED"
artifacts[].cameraId          en DEPTH_MAP: desde qué cámara se midió
```

Y uno opcional que conviene conocer antes de necesitarlo:

```text
cameras[].sourceOrientation   provenance EXIF, en grados. Nada lo interpreta
```

**Por qué el hash y no basta el id.** Un `imageArtifactId` se reapunta a otro
fichero sin que nada chille, y entonces los intrínsecos describen píxeles que no
son los suyos. Lo ejercemos cambiando el hash de una cámara por el de otra imagen
del mismo paquete —mismo tamaño, misma cámara, todo plausible— y el paquete sale
rechazado. Con el id solo, pasaba entero.

**Por qué `imageSpace`.** Es lo que impide el caso que D10 nombra: unos
intrínsecos declarados sobre imagen rectificada que traen coeficientes de
distorsión. Si la imagen ya está rectificada, no queda distorsión que corregir.
`RECTIFIED` **sin** distorsión pasa; con ella, no.

**Por qué la profundidad declara su cámara.** El número de cada píxel no significa
nada sin una pose y unos intrínsecos detrás, y `depthKind` decide cuál de las dos
cosas es ese número. Medido sobre nuestra cámara de prueba, confundir la
coordenada sobre el eje óptico con la longitud del rayo cuesta **0 % exacto en el
centro y 12,5 % en la esquina**.

---

## 2. Lo que os deja hacer cosas nuevas

Todo opcional. Nada de esto rompe un paquete que no lo use.

```text
extensions        espacio experimental con clave de espacio de nombres  (D30)
requires          capabilities sin las que el paquete no se consume     (D31)
provides          capabilities que el paquete trae                      (D31)
budgets           presupuestos, con units ABSOLUTE o RELATIVE_TO_DIAGONAL (D9)
```

**`extensions`** cierra D30. La clave tiene que ser un espacio de nombres invertido
de tres tramos o más —`org.videomesh.experimental.foo`—; `foo` a secas se rechaza.
El envoltorio es `{ required, data }` y nada más: `required` es obligatorio y sin
valor por defecto, porque suponerlo `false` convertiría en silencio una extensión
que cambia el sentido de los datos. `data` es vuestro y no lo miramos.

- **requerida que no entendemos** → UNSUPPORTED, salida 21.
- **opcional que no entendemos** → **se preserva y se declara en el informe**.
  Ésa es la política que la decisión dejaba abierta, y elegimos preservar:
  ignorar en silencio deja al productor creyendo que mandó algo que se usó.

**`requires` / `provides`** cierran D31. Lo que sabemos hacer hoy —y va publicado
en el informe como `capabilities.supports`, aunque no pidáis nada— es:

```text
mesh-audit   camera-projection   ply-ascii
```

**`coverage` y `confidence` no están, a propósito**, y una puerta lo comprueba.
Siguen bloqueadas por D34, así que un paquete que las requiera sale UNSUPPORTED
diciendo qué sí sabemos hacer. Es justo el caso que la negociación existe para
contestar bien en vez de devolveros un informe sobre otra cosa.

**`budgets`** cierra D9. R0 solo comprueba que sean **coherentes con la escala**;
evaluarlos contra lo medido es R9, y lo decimos para que un paquete aceptado no se
lea como un paquete aprobado. Tres reglas:

```text
ABSOLUTE con scale.status != ABSOLUTE     rechazado, salida 20
ABSOLUTE sin unidad                       rechazado
RELATIVE_TO_DIAGONAL con unidad           rechazado
```

La tercera no es simetría decorativa: **una fracción de diagonal no tiene unidad**,
y ponerle una es declarar una escala por la puerta de atrás — leeríamos «0,01 m»
donde quisisteis decir «el 1 % de la pieza».

---

## 3. Lo que cambia en el informe que leéis

```text
versions.report          SUSTITUIDO por versions.contracts
frames                   NUEVO: dónde se midió y a qué marcos hay camino
measurements[].frame     NUEVO: el marco de cada número
scale                    AMPLIADO: boundingBoxDiagonal, claimsAbsolutePrecision
limits                   NUEVO: los topes de recurso que rigieron
extensions               NUEVO: policy, honoured, ignored
capabilities             NUEVO: policy, supports, required, provided, unknownProvided
```

**`versions.report` desaparece** y en su sitio va `versions.contracts`, la lista
entera. Es la única sustitución del envío, y la hacemos ahora porque el documento
está en DRAFT y sois el único consumidor: el mismo número estaba en dos sitios.
D12 lo pide así —«el consumidor comprueba el bloque, no un campo»— porque quien
mirase `reconstructionReport === "0.1"` no se enteraría de que otra versión cambió
debajo. La combinación vigente vive en `contracts/versions.json`, generada y
commiteada; **una versión que se suba sin regenerarla pone nuestra puerta roja**.

**`frames`** es D11, y la decisión estaba en el esquema desde R0-A sin que nadie la
mirase: un paquete con cero aristas salía `COMPLETE + PASS`. Ahora **un marco
declarado al que no hay camino desde `RECONSTRUCTION` se rechaza**, y desde ahí
porque es donde están los números. Lo que esto os pide: si vuestro grafo nombra
`PRODUCTION`, tiene que haber camino declarado hasta él. Las aristas se recorren
en los dos sentidos, así que **no declaréis la inversa**: una transformación
rígida la tiene exacta y dos declaraciones del mismo dato acaban divergiendo.

Y una pose de cámara pasa por la misma auditoría que una arista del grafo: con la
última fila distinta de `[0,0,0,1]` lleva proyección dentro y no es una pose.

**`scale.boundingBoxDiagonal`** es el denominador de un presupuesto relativo. Lo
publicamos para que lo reproduzcáis en vez de recalcular una caja que podría no
ser la misma. **`claimsAbsolutePrecision`** exige las dos cosas a la vez: escala
`ABSOLUTE` **y** un modelo de incertidumbre que no sea `NONE`.

---

## 4. Lo que necesita vuestra respuesta

### 4.1 Veintiocho identificadores sin número

Eran cinco en el envío 01 y siguen sin contestar. Ahora son 28, en cuatro
espacios. **Ninguno está fijado**: su estado vive en la tabla
—`src/soft/agent/reconstruction/codes.ts`— y `test:codes` comprueba que ninguno se
cuele como fijado sin decir qué decisión le falta.

```text
SS-PKG  010–014  esquema, sellado e integridad          (del envío 01)
SS-PKG  020–022  contrato, hash de esquema, formato     (del envío 01)
SS-PKG  023      extensión requerida no soportada
SS-PKG  024      capability requerida no soportada
SS-IO   001–007  topes de recurso y lectura
SS-RECON 001–002 presupuesto contra escala
SS-RECON 003–005 FrameGraph
SS-CAM  001–006  imagen, espacio, pose, rejilla, profundidad
```

**No los grabéis todavía en ninguna prueba vuestra.** Confirmadlos o cambiadlos:
aquí cambiarlos cuesta un sitio; después de que los grabéis, dos repositorios.

### 4.2 El idioma de los códigos

Sigue sin decidir y ya duele: conviven `FRAME_UNREACHABLE` y `BORDE_ABIERTO` en
tablas que `test:codes` compara contra `src/` en las dos direcciones. Cada código
nuevo lo paga. **Lo decide quien los va a leer**, y ésos sois vosotros.

### 4.3 R0-B sigue esperando

El `cube-v1` de VideoMesh y su `expected.json`. D34 es explícita: mientras R0-B no
pase, **no avanza nada que dependa del contrato compartido**. De nuestro lado
R1.5 está declarado y hecho —`cube-v1` recorre el camino entero y sale `COMPLETE +
PASS` con salida 0, informe válido contra su esquema e idéntico byte a byte entre
dos ejecuciones—, así que lo único que falta es el segundo productor.

---

## 5. Un aviso que no es del contrato

`WarningSeverity` pasa de dos valores a tres. El nuevo es
`aproximacion-determinista`, y afecta al **informe de escena**, no al de
reconstrucción — lo decimos por si algún día lo leéis.

Lo forzó una medida: el determinante que sostiene el predicado de
autointersección da un valor **no nulo en 884 de 2.200 puntos que están sobre la
recta**. La aritmética es cierta; la exactitud no. Una entrada con esa severidad
está obligada a declarar su epsilon.

**Sigue contando como defecto**: el eje es medida contra intención, no exacto
contra aproximado.

---

## 6. Qué no se movió

```text
contractVersion del informe de escena     3
bridgeContractVersion                     1
pliego del dron                           46228b7c
contractVersion del paquete               0.1
```

Nada de lo de arriba mueve un hash. Y el contrato sigue en **DRAFT**: se promueve
a `1.0` cuando **dos productores reales distintos** hayan producido paquetes
válidos, que es precisamente lo que R0-B demuestra.
