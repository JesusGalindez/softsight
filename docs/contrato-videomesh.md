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

Tres rondas añadieron 34 decisiones y once principios. La cuarta debía producir la
primera IMPLEMENTADA, no la número treinta y cinco: la trajo D25.

### 1.7 Lo que no se hace

```text
un tercer repositorio de contratos   todavía no; el hash del esquema basta
un canal en tiempo real              el intercambio son ficheros
reuniones periódicas                 las sustituye el aviso por evento
«lo hablamos cuando llegue»          es como se pierde el tiempo
```

---

## 2. Estado del registro

Al 2026-09-14:

```text
ACORDADAS       10   D2, D5, D18, D22, D23, D26, D28, D29, D32, D34
PROPUESTAS       0
IMPLEMENTADAS   24   D1, D3, D4, D6, D7, D8, D9, D10, D11, D12, D13, D14, D15,
                     D16, D17, D19, D20, D21, D24, D25, D27, D30, D31, D33
PENDIENTE sin número   qué certifica R0 (§6, criterio aplicado y en uso)
```

**D1 y D27 pasaron el 2026-09-14**, y las dos por el mismo motivo aunque por
caminos opuestos: D1 describía un transporte que no existía hasta R16, y D27
describía una frontera que se cumplía **sin que nadie la comprobara**. Una
decisión no es IMPLEMENTADA porque su regla sea cierta hoy, sino porque hay una
puerta que se pone roja si deja de serlo — y en los dos casos se comprobó
rompiéndola a propósito.

**D15 pasó el mismo día**, y por el mismo patrón que D1: su nota decía que le
faltaban dos fixtures porque «piden capabilities y sellado, que no existen», y los
dos existían desde el 2026-09-13. La nota describía un repositorio que ya no era
éste.

**El único movimiento admisible ahora es de ACORDADA a IMPLEMENTADA.** La primera
la trajo D25 el 2026-08-12: la puerta de recursos existe y falla si `auditMesh`
vuelve a las estructuras que tenía.

S4 trajo las otras dos el 2026-08-12: **D6**, con el sandbox probado sobre un
paquete real y sobre uno simulado, y **D21**, cuyos cuatro casos exigieron
extender el esquema en ejecución con formas discriminadas por el literal del
tipo. D7 y D29 se quedaron a medias, cada una con su mitad anotada.

D30 se quedó a un tercio el 2026-08-12 —su fixture existía y su primera fila
estaba probada, pero las otras dos hablaban de un espacio `extensions` que ningún
esquema declaraba— y **se cerró entera el 2026-09-13**. Fue la regla funcionando,
no un fallo: durante un mes la prueba no fallaba si se incumplían dos de las tres
filas, así que la decisión no contaba.

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

### D1 — Transporte del paquete — IMPLEMENTADA (2026-09-14)
Filesystem y rutas. VideoMesh escribe el paquete en disco y pasa la ruta del
manifest. Nada de base64 en el JSON, nada de streaming, y los límites del puente
no se suben como parche. El puente se queda para el editor y peticiones pequeñas.
**Prueba:** `test:package-transport`.

**Hecho con R16 el 2026-09-14.** La decisión decía «prueba: sin escribir» desde
el principio y lo que faltaba era el transporte, no la prueba: hasta R16 el
puente solo sabía recibir base64, así que la decisión describía algo que no
existía.

Lo que la cierra es `bridgeContractVersion: 2` con `package: { root }`, y las
cinco reglas del §84 comprobadas en la puerta:

```text
1  raíz por SOFTSIGHT_PACKAGE_ROOTS, no por la petición
2  realpath en los dos lados antes de comparar
3  prefijo por COMPONENTES — /datos/x no es prefijo de /datos/x-otro
4  ningún `..`, aunque resolviera dentro
5  lectura solamente
```

La 1 es la que sostiene a las otras cuatro, y es la que se comprobó **rompiéndola
a propósito**: añadir `/` a las raíces declaradas pone la puerta roja. Sin esa
comprobación, una regla que aceptara todo habría pasado igual.

Y la segunda mitad de la decisión también se cumple: «el puente se queda para el
editor». La versión 1 sigue valiendo entera para sus diez comandos y la respuesta
hace eco de la versión pedida, así que el editor no cambia.

**Lo que no promete:** la ruta se abre solo para **lectura**. Los artefactos
siguen saliendo por el canal de siempre, así que un paquete que produjera 150 MB
de salida todavía no tiene por dónde devolverlos.

### D2 — Códigos de aviso
Código legible en español, más un **identificador neutro y estable**
(`SS-RECON-001`). VideoMesh parsea el identificador, nunca el mensaje. Espacios:
`SS-PKG`, `SS-IO`, `SS-GEO`, `SS-RECON`, `SS-CAM`, `SS-COV`, `SS-CONF`,
`SS-PROD`, `SS-LOD`, `SS-UV`, `SS-PBR`, `SS-COLL`.
**Prueba:** `test:codes` extendida a identificadores únicos y estables.

**Pendiente de VideoMesh, del 2026-08-12.** La ingesta necesitó cinco
identificadores que el contrato no asigna: el espacio nombra los motivos
—`ESQUEMA_NO_COINCIDE`, `PAQUETE_SIN_SELLAR`— pero no los números, y el
número es lo que se parsea.

```text
FIJADO por D6
SS-PKG-001  la ruta sale de la raíz con ..
SS-PKG-002  la ruta es absoluta
SS-PKG-003  la ruta es legal y su enlace resuelve fuera
SS-PKG-004  el artifact no existe, no se lee, o el enlace está roto

PROPUESTO, a la espera de respuesta
SS-PKG-010  el manifest no encaja con el esquema
SS-PKG-011  el paquete no está sellado
SS-PKG-012  el tamaño declarado no es el del fichero
SS-PKG-013  el contenido no coincide con el sha256 declarado
SS-PKG-014  el sha256 declarado no es un sha256
```

El estado **es un dato de la tabla**, no una nota: vive en
`src/soft/agent/reconstruction/codes.ts` junto al motivo canónico y a qué decisión
lo fija, y `test:codes` comprueba que los identificadores sean únicos, tengan el
formato del espacio, coincidan con lo que se emite en las dos direcciones, que los
cuatro de D6 estén FIJADO, y que ningún PROPUESTO se cuele como fijado sin decir
qué decisión le falta. Cambiar un número cuesta un sitio.

**Idioma decidido el 2026-09-13: todo en español**, también el motivo canónico.
Lo pedía el §86.2 (g) del plan de reconstrucción, que avisaba de que una tabla en
dos idiomas se vuelve ilegible. Entran los 32 motivos de frontera y los cuatro
del veredicto; **no entran** los nombres de campo ni los valores de enum que
VideoMesh escribe —`SEALED`, `TRIANGLE_MESH`, `ABSOLUTE`, `PASS`—, porque eso no
es un código sino el vocabulario del paquete, y traducirlo rompería todo manifest
existente.

Que esto **no os rompa** es mérito de esta misma decisión: se parsea el
identificador. `SS-CAM-001` sigue siendo `SS-CAM-001` y solo cambia el texto que
lo acompaña.

`SS-PKG-014` es nuevo respecto al envío: «el hash no cuadra» y «el hash no es un
hash» se arreglan en sitios distintos —el contenido y el escritor del manifest— y
quien automatice sobre el identificador quiere poder distinguirlos.

**Un motivo puede repetirse y un identificador no.** `SS-PKG-001` y `SS-PKG-003`
comparten `RUTA_FUERA_DE_LA_RAIZ` porque el resultado es el mismo y la causa
no. Es la razón de que el contrato mande parsear el identificador.

### D3 — Ejecución y certificación son dos ejes — IMPLEMENTADA (2026-08-12)
```text
ExecutionStatus        COMPLETE | PARTIAL | ERROR | UNSUPPORTED
CertificationVerdict   PASS | FAIL | INCONCLUSIVE
```
Motivos aparte: `EVIDENCIA_INSUFICIENTE`, `UNCERTAINTY_OVERLAPS_THRESHOLD`,
`METRICA_REQUERIDA_NO_DISPONIBLE`.
**Prueba:** `test:reconstruction`, con los dos ejes moviéndose por separado:

```text
paquete íntegro, malla sana        COMPLETE   PASS
paquete íntegro, malla sin caras   COMPLETE   FAIL
falta evidencia requerida          COMPLETE   INCONCLUSIVE
paquete sin sellar                 ERROR      INCONCLUSIVE
```

La última fila es la que sostiene la decisión: un paquete que no se puede leer
**no es un veredicto sobre la geometría de nadie**. Colapsar los dos ejes
convertiría un error de transporte en un FAIL de VideoMesh.

### D4 — ColmapAdapter produce los fixtures reales — IMPLEMENTADA (2026-09-13)
Cámaras, `points3D` y convenciones reales. `colmap-small-v1` sigue siendo
imprescindible: el cubo no ejerce modelos de cámara reales, ni datos en coma
flotante reales, ni el comportamiento real de la escala.
**Prueba:** `test:colmap`.

**El adaptador existe**: `colmap.ts` lee `cameras.txt`, `images.txt` y
`points3D.txt`, convierte los intrínsecos posicionales a campos con nombre,
invierte la pose de COLMAP —`cameraFromWorld` en cuaternión y traslación— a la
única que el contrato lleva, `worldFromCamera` (D32), y **no toca el marco**: lo
declara con `cameraAxes: X_RIGHT_Y_DOWN_Z_FORWARD`. Rotar aquí para «dejarlo en
nuestro marco» sería una conversión invisible; declararla la hace comprobable con
un punto y un píxel.

La escala sale `UNKNOWN` con fuente `NONE`, que es lo que una reconstrucción sin
restricción externa sabe de sí misma.

**Cerrada el 2026-09-13 con datos reales.** El fixture es `colmap-real-v1`:
`south-building` y `gerrard-hall`, los dos datasets de ejemplo de COLMAP, con su
modelo disperso en texto. Vive **fuera del repositorio** con su sha256 en
`contracts/fixtures/colmap-real-v1.json`, como manda D22 — son 58 MB de terceros
sin licencia explícita, así que se apunta en vez de redistribuirse. Sin él,
`test:colmap` se declara no ejecutada.

**La comprobación que la cierra son dos caminos independientes hacia el mismo
número.** COLMAP guarda en `points3D.txt` el error de reproyección medio de cada
punto, calculado por su código; nosotros lo recalculamos con el nuestro sobre el
CameraSet canónico:

```text
south-building   0,49697 px   COLMAP declara   0,49703 px
gerrard-hall     0,61220 px   COLMAP declara   0,61217 px
```

Sobre 61.514 y 43.188 puntos. La mediana de la diferencia punto a punto es
1,2e-3 px y el p99 8,4e-3; el 0,7 % se separa más y la puerta **no mide el
máximo** por eso, sino mediana, p99 y la media del conjunto.

**Y el contraste que lo hace significar algo**: con la distorsión quitada, los
mismos números se van a 2,57 y **30,58 px**. Sin él, una proyección que ignorase
la distorsión también pasaría si los coeficientes fueran pequeños.

**Lo que el sintético no podía dar, y ahora está:**

```text
SIMPLE_RADIAL y OPENCV      dos de los cinco modelos, no dos veces el mismo
fx 3838,27 / fy 3837,22     focales distintas, que ningún fixture había ejercido
1.094.145 de 1.420.660      observaciones sin triangular: el 77 %
```

Lo último es la diferencia de fondo: `colmap-small-v1` lo escribimos nosotros y
triangula todo, así que no puede tener sorpresas que no previéramos.

**El juez son las observaciones del propio fichero.** COLMAP guarda dónde cayó
cada punto 3D en píxeles, así que el camino se cierra sobre sí mismo sin inventar
valores dorados: 36 observaciones reproyectadas por el CameraSet convertido, con
un error máximo de 6,1·10⁻⁹ píxeles. Si el cuaternión se leyera como `(x,y,z,w)`,
si la pose no se invirtiera, si el marco se confundiera o si el orden de los
parámetros de un modelo estuviera cambiado, no cuadraría —y las cuatro cosas
producen números plausibles—.

**Un hallazgo del camino:** un cuaternión escrito con cinco decimales **no es
unitario**, y su matriz de rotación no es ortogonal, así que su traspuesta deja de
ser su inversa. Como la pose se invierte justo después, el error entra en la
posición de la cámara: una décima de milésima de píxel al reproyectar, que es
exactamente el tamaño que se acepta como «redondeo» sin mirarlo. Se normaliza al
leer.

### D5 — EXR
Scanline sin comprimir o ZIP, HALF o FLOAT. PIZ, DWA y B44 se rechazan por
código. Cada canal declara semántica, espacio, rango, unidad e inválido.
**Prueba:** sin escribir.

### D6 — Sandbox del paquete — IMPLEMENTADA (2026-08-12)
`PACKAGE_ROOT`; todo artifact resuelve dentro. Se rechaza `../`, ruta absoluta
fuera, escape por symlink, symlink anidado y symlink roto. `SS-PKG-001..004`.
**Prueba:** `package-integrity-v1` —que absorbe `invalid-path-v1`— con puerta
`test:reconstruction`, y los cinco casos además contra un paquete de verdad en
disco.

El escape por symlink se prueba con un enlace a un fichero **de contenido
idéntico**: mismo tamaño y mismo hash, y lo único que lo distingue es dónde vive.
Un sandbox que solo normaliza cadenas lo deja pasar entero.

La ruta se juzga por lo que dice antes de tocar el disco —absoluta o con `..` se
rechaza aunque apunte dentro—, y solo después por dónde resuelve. Una regla que
depende de a dónde apunte hoy cambia de resultado mañana.

### D7 — Integridad de artifacts — IMPLEMENTADA (2026-08-12)
Cada artifact declara `path`, `bytes` y `sha256`. SoftSight valida raíz, tamaño y
hash **antes** de analizar. El informe publica `packageId`, `manifestSha256` y los
hashes de los artifacts.

**Cerrada el 2026-08-12, las dos mitades.** La validación previa —raíz, tamaño y
hash antes de abrir nada— con `package-integrity-v1`, que cubre también
`hash-mismatch-v1`. Y la publicación: el informe lleva `packageId`,
`inputManifestSha256` y el sha256 de cada artifact medido, con cada medida atada
a su `appliesTo { artifactId, sha256 }`. El hash del manifest lo calcula quien lo
lee, porque el manifest no puede contener el suyo. `packageId` sale del manifest
y nunca del nombre del directorio.

**Del cierre de la tercera ronda:** el manifest **no puede contener su propio
sha256** sin trucos recursivos. Lo calcula SoftSight después de la publicación y
lo ata al informe. Y `packageId` es la identidad canónica: **SoftSight nunca
infiere identidad del nombre del directorio**, que es comodidad humana.
**Prueba:** `hash-mismatch-v1`.

### D8 — `requiredEvidence` por contrato — IMPLEMENTADA (2026-09-13)
```text
falta evidencia requerida por el contrato  → INCONCLUSIVE
falta evidencia que el contrato no usa     → irrelevante
```
**Prueba:** casos A y B.


**Cerrada el 2026-09-13, y lo que faltaba era la segunda fila.** La primera
—falta evidencia requerida → INCONCLUSIVE— llevaba tiempo hecha. La segunda
—falta evidencia que el contrato no usa → irrelevante— **estaba incumplida sin
que nadie lo notara**: el informe daba INCONCLUSIVE en cuanto no había medidas,
sin mirar si el paquete había declarado una malla.

Una reconstrucción de SfM entrega **nube de puntos y cámaras y no promete
superficie**. Declararla inconclusa por no traer malla es reprocharle algo que
nunca dijo, y es exactamente lo que la decisión separa.

```text
declara malla y no se puede medir    INCONCLUSIVE, salida 11
no declara malla y nadie la pidió    PASS, salida 0
```

Lo destapó intentar empaquetar un COLMAP real: el primer paquete de
`producers/colmap/` salía INCONCLUSIVE por no tener una malla que nunca prometió.

### D9 — Modelo de escala — IMPLEMENTADA (2026-09-13)
`status` (UNKNOWN | RELATIVE | ABSOLUTE), `source` (NONE | KNOWN_DISTANCE |
MARKER | CAMERA_PRIOR | EXTERNAL_MEASUREMENT | MANUAL) e incertidumbre con su
modelo y valor. Con `status != ABSOLUTE` se rechazan presupuestos absolutos;
fallback relativo a la diagonal. No se reporta precisión más fina de la que la
incertidumbre justifica.
**Prueba:** `test:reconstruction`, con el manifest base y tres listas en vez del
`unknown-scale-v1` que la decisión preveía.

**Los tres campos ya viajaban; lo que faltaba era qué rechazan.** Sin un sitio
donde declarar un presupuesto, la regla no tenía qué rechazar y la contradicción
que la decisión ataja —metros sobre una escala que nadie ha fijado— se colaba
entera. Así que el paquete gana `budgets`, con `units` de `ABSOLUTE` o
`RELATIVE_TO_DIAGONAL`. **R0 solo comprueba que sean coherentes con la escala;
evaluarlos contra lo medido es R9**, y decirlo así evita que alguien lea un
paquete aceptado como un paquete aprobado.

```text
ABSOLUTE + scale.status != ABSOLUTE     SS-RECON-001, salida 20
ABSOLUTE sin unidad                     SS-RECON-002
RELATIVE_TO_DIAGONAL con unidad         SS-RECON-002
```

**La primera fila se afinó el 2026-09-14, cuando R9 los evaluó de verdad.** La
regla ata a lo que **lleva escala dentro**: medio metro de desviación sobre una
reconstrucción sin escala no significa nada, pero mil triángulos son mil en
cualquier escala. Aplicarla a un recuento obligaba a fijar la escala para poder
presupuestar algo que no la usa — y dejaba sin presupuestos a **todo paquete de
SfM**, que nunca sabe a qué escala reconstruyó. Ahora la magnitud la declara el
vocabulario de R9, y la fila se lee «ABSOLUTE de una magnitud con escala».

Lo **desconocido sigue rechazándose**, y se intentó al revés: un nombre fuera del
vocabulario se trata como si llevara escala, porque no sabemos qué es y suponer
que no la lleva sería suponer a favor. Quien lo probó permisivo se topó con la
prueba de esta misma decisión —`desviación` en metros sobre escala RELATIVE—, que
es una contradicción de verdad con un nombre que el vocabulario no tiene.

La tercera fila no es simetría decorativa: **una fracción de diagonal no tiene
unidad**, y ponerle una es declarar una escala por la puerta de atrás — el
consumidor leería «0,01 m» donde el productor quiso decir «el 1 % de la pieza».

El mensaje trae el número, la unidad y el estado, porque sin los tres el productor
no sabe si arreglar la escala o el presupuesto. Y es **salida 20**: el fichero
está bien y el hash cuadra; lo que falla es que dos campos suyos no pueden ser
ciertos a la vez. De ahí el espacio `SS-RECON`, que es nuevo.

**Las dos mitades que el informe tenía que decir, y no decía:**

- `scale.boundingBoxDiagonal`, **el denominador del fallback**, de la unión de
  todo lo medido y no de la primera malla. Publicarlo es lo que permite al otro
  lado reproducir un presupuesto relativo en vez de recalcular una caja que
  podría no ser la misma. En `cube-v1` sale √3, la del cubo unidad.
- `scale.claimsAbsolutePrecision`, y es **de dos cosas a la vez**: escala
  `ABSOLUTE` **y** un modelo de incertidumbre que no sea `NONE`. Con escala
  fijada a mano y sin modelo, el informe no promete nada, que es exactamente lo
  que la última frase de la decisión pide.

### D10 — Convenciones de espacio de imagen — IMPLEMENTADA (2026-09-13)
`imageSpace`, `pixelOrigin`, `pixelCenter`, `transformConvention`, handedness y
ejes, viajando como **una sola unidad** `CameraImageSpace` con
`imageArtifactHash`, dimensiones, intrínsecos, distorsión y orientación. Impide
combinar intrínsecos rectificados con imagen distorsionada, o una máscara del
frame original con profundidad del rectificado.
**Prueba:** `camera-projection-v1` + fila 4 de D23.

**Medio hecha el 2026-08-12.** El CameraSet viaja como una unidad y **declara
hacia dónde mira**: `cameraAxes` con `X_RIGHT_Y_DOWN_Z_FORWARD` —COLMAP, OpenCV—
o `X_RIGHT_Y_UP_Z_BACKWARD` —gráficos, y el rasterizador de este repositorio—,
sin valor por defecto. Confundirlos no da una imagen torcida: da una especular en
Y con la profundidad invertida, y sobre un objeto simétrico las dos parecen
correctas.

**Cerrada el 2026-09-13 con los dos campos que faltaban.**

`imageArtifactHash` ata la cámara a **los píxeles y no a un nombre**. Un
`imageArtifactId` se reapunta a otro fichero sin que nada chille, y entonces los
intrínsecos describen una imagen que no es la suya; la puerta lo ejerce cambiando
el hash de una cámara por el de otra imagen del mismo paquete —mismo tamaño,
misma cámara, todo plausible— y sale rechazado.

`imageSpace` —`ORIGINAL` o `RECTIFIED`— es lo que impide el caso que la decisión
nombra: unos intrínsecos rectificados con coeficientes de distorsión se
contradicen, porque si la imagen ya está rectificada no queda nada que corregir.
Y `RECTIFIED` **sin** distorsión pasa, que es lo que separa una regla de un
rechazo indiscriminado.

`transformConvention` no se declara por cámara a propósito: **D32 ya la fija para
todo el repositorio** y `test:gltf-frame` la vigila. Repetirla aquí sería un
segundo original de la misma decisión.

El adaptador de COLMAP recibe los hashes **por parámetro**: sus ficheros nombran
la imagen y no la hashean, y calcularlo dentro exigiría leer el disco desde un
módulo que a propósito no lo toca. Sin el mapa, la entrada sale sin hash y el
paquete se rechaza por esquema, que es mejor que inventarlo. Y declara
`ORIGINAL`, porque los coeficientes que trae describen precisamente lo que hay
que corregir.

### D11 — FrameGraph — IMPLEMENTADA (2026-09-13)
CAMERA, RECONSTRUCTION, ASSET_CANONICAL, PRODUCTION, con cada transformación
guardando marco origen, marco destino, matriz, motivo y productor. Ninguna se
hornea sin registrarla.

**El grafo estaba en el esquema desde R0-A y nadie lo miraba.** Un paquete podía
declarar cero aristas y salir `COMPLETE + PASS`: el campo se rellenaba por
educación, que es la forma que tiene una decisión de parecer cumplida.

Lo que la convierte en registro no es «hay transformaciones declaradas» —eso se
cumple rellenando una lista— sino **que un marco al que no hay camino se
rechaza**:

```text
arista con la última fila distinta de [0,0,0,1]    TRANSFORMACION_NO_RIGIDA
arista de un marco a sí mismo, o duplicada         TRANSFORMACION_MAL_FORMADA
marco declarado sin camino desde RECONSTRUCTION    MARCO_INALCANZABLE
```

**Desde `RECONSTRUCTION` porque es donde están los números**: las cajas y los
volúmenes salen del PLY, que viene en él. El informe lo publica —`frames.measuredIn`
y `measurements[].frame`— para que el consumidor sepa que una caja de aquí y una
de producción no se pueden comparar sin pasar por el grafo.

**`resolveFrame` no devuelve la identidad cuando no hay camino.** Suponer que dos
marcos sin arista son el mismo es el error que la decisión describe, no su
arreglo. Recorre las aristas en los dos sentidos, porque una transformación rígida
tiene inversa exacta y declarar las dos direcciones sería el mismo dato dos veces
esperando a dejar de cuadrar; la puerta comprueba que ida y vuelta dan la
identidad **exacta**.

**Una pose de cámara es una transformación entre marcos**, así que se le aplica
`auditTransforms` en vez de una segunda regla parecida: una matriz con la última
fila distinta de `[0,0,0,1]` lleva proyección dentro y no es una pose, aunque los
dieciséis números sigan ahí.
**Prueba:** sin escribir.

### D12 — Versiones y capabilities — IMPLEMENTADA a medias (2026-09-13)
Bloque `versions`, bloque `models`, lista `capabilities`. El consumidor comprueba
el bloque, no un campo.

**El bloque de versiones está hecho el 2026-09-13.** Eran **siete números
repartidos por cinco ficheros** —`REPORT_CONTRACT_VERSION` en el CLI,
`BRIDGE_CONTRACT_VERSION` en el puente, las dos auditorías, la animación y las dos
de reconstrucción— y ninguna tabla que dijera cuáles van juntos. Ahora viven en
`src/soft/agent/versions.ts` con qué versionan y quién los lee, el informe de
reconstrucción los publica **todos en `versions.contracts`**, y
`contracts/versions.json` se genera de ahí y se commitea.

Lo que la puerta comprueba, y por lo que esto cuenta como prueba:

```text
la combinación vigente está declarada
una versión subida sin regenerar el fichero          se rechaza
un bloque al que le falta un contrato                se rechaza
el número del puente coincide con el del registro
```

El puente es la excepción declarada: `agent3d --serve` importa `handleRequest` de
`bridge.mjs`, así que importar allí el artefacto construido cerraría un ciclo. El
número se queda escrito y **la puerta lo compara**, que da la misma garantía sin
el ciclo.

Hoy hay **una** combinación declarada, y decirlo así es lo honesto: nunca ha
habido dos en circulación. Lo que el fichero hace no es enumerar historia, es
obligar a declarar — subir un número sin regenerar pone la puerta roja.

**Lo que falta para IMPLEMENTADA entera:** el bloque `models` y la lista
`capabilities`, que van con D31 y no antes.
**Prueba:** sin escribir.

### D13 — Códigos de salida nuevos, solo en subcomandos nuevos — IMPLEMENTADA (2026-08-12)
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
**Prueba:** `test:reconstruction`, con los seis desenlaces que hoy existen:

```text
0   cube-v1 entero                         COMPLETE   PASS
1   malla declarada sin superficie         COMPLETE   FAIL
11  falta evidencia requerida              COMPLETE   INCONCLUSIVE
20  paquete sin sellar, hash que no cuadra ERROR      INCONCLUSIVE
21  contractVersion que no leemos          UNSUPPORTED
22  PLY binario                            UNSUPPORTED
```

**21 y 22 son cosas distintas y por eso son dos códigos**: uno dice «este contrato
no lo leo» y el otro «este fichero no lo leo». Quien automatiza reacciona
distinto —actualizar el consumidor, o convertir el artifact— y un código único las
mezclaría. Los comandos existentes siguen con 0/1/2 sin tocar.

### D14 — Un documento, una versión en la raíz — IMPLEMENTADA (2026-08-12)
Informe de reconstrucción y de producción son **documentos distintos**.
`documentType` en todos los documentos canónicos, con la forma
`<productor>.<tipo>`:
```text
videomesh.reconstruction-package   softsight.reconstruction-report
videomesh.production-package       softsight.production-report
```
Nunca nombres ambiguos sueltos —`reconstruction`, `report`—. `reportVersion` y
`contractVersion` no conviven como dos versiones raíz.
**Prueba:** `reconstruction-package-v1` rechaza `documentType: "reconstruction"`,
y el informe declara el suyo y valida contra `contracts/reconstruction-report.schema.json`.
La versión del documento vive dentro de `versions`, no en la raíz al lado de
`contractVersion`.

### D15 — Una sola fuente ejecutable; JSON Schema es la frontera pública — IMPLEMENTADA (2026-09-14)
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

**Hecho el 2026-08-12, la mitad:** `tools/contracts.mjs` genera
`contracts/*.schema.json` de los ocho esquemas que hoy son frontera —escena,
parche, guion, puesta en escena, referencia de muestreo, el paquete de
reconstrucción, su informe y el asset de producción— y `--check` pone la
puerta roja si el commiteado y el generado divergen, o si sobra un esquema que ya
no se publica. `unknown-field-v1` está; `unknown-capability-v1` y
`unsealed-package-v1` piden capabilities y sellado, que no existen.

**Completada el 2026-09-14.** Los dos fixtures que faltaban existen, y escribirlos
destapó algo que la nota de arriba no podía ver: **el esquema acepta los dos
documentos**.

No es un agujero. `state: WRITING` es el estado legítimo que VideoMesh escribe
mientras construye el paquete, y un esquema que lo prohibiera impediría escribir
el manifest en curso. Y qué capacidades sabe hacer este binario cambia con cada
escalón —`coverage` el 13, `capture-advice` y `repair-boundary` el 14—, así que
meterlas en el JSON Schema publicado obligaría a regenerar vuestros modelos en
cada una.

Así que el rechazo va en la capa de **consumo**, y cada lado rechaza una cosa
distinta en un momento distinto:

```text
VideoMesh   no puede PUBLICAR un paquete que no haya sellado
SoftSight   no puede CONSUMIR un paquete que no esté sellado
```

El fallo que esto evita no es un error de lectura: un paquete sin sellar **se
puede leer**, los ficheros están ahí. Lo que sale es una medida sobre un paquete
que todavía estaba creciendo, y sale bien y es mentira.

Y las dos capas conviven dentro del mismo fixture, que es el mapa de la frontera:

```text
state: WRITING    el esquema lo acepta   → lo para el consumo, SS-PKG-011
state ausente     el esquema lo rechaza  → SS-PKG-010, y aquí sí hay simetría
```

Los dos acaban en ERROR con salida 20 **por motivos distintos a propósito**: quien
automatice sobre el identificador quiere poder distinguir «tu escritor de
manifests está roto» de «publicaste antes de sellar».

**Un hallazgo del camino, y es un sobreanuncio al revés.** Escribiendo el caso que
debe pasar de `unknown-capability-v1` salió que `SUPPORTED_CAPABILITIES` no
declaraba `ply-binary`, construido el día antes: un productor que la pidiera
recibía UNSUPPORTED sobre algo que este binario **sabe leer**. Declarar de menos
también es mentir, solo que en la otra dirección. Entra el mismo día, **aparte de
`ply-ascii`** y no sustituyéndola: son dos cosas que se saben hacer.

**Prueba:** `test:contracts`, bloque 7.

### D16 — El hash del esquema se comprueba — IMPLEMENTADA (2026-08-12)
Hash desconocido:
```text
execution: ERROR   reason: ESQUEMA_NO_COINCIDE
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
**Prueba:** `contracts/registry.json`, generado por `tools/contracts.mjs` del
propio artefacto y comprobado por `test:contracts` contra los ficheros: mismos
esquemas, mismo hash, mismo tamaño. En la ingesta, un `contractSchemaSha256` que
no esté registrado da `UNSUPPORTED` con `ESQUEMA_NO_COINCIDE` y nunca un
aviso, y una `contractVersion` fuera de las aceptadas para antes de mirar el
contenido.

El campo es **opcional mientras el contrato esté en DRAFT**: sin él no se
comprueba nada y se dice. Callar sobre un registro que falta convertiría un
fichero ausente en una comprobación que parece hecha.

### D17 — NaN, infinitos y redondeo — IMPLEMENTADA (2026-08-12)
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
**Prueba:** `test_json_rejects_non_finite_numbers` en VideoMesh, y de este lado
`package-integrity-v1` con el caso que lo hace necesario.

**El agujero, medido el 2026-08-12.** «JSON no tiene NaN» es cierto y no basta:

```text
JSON.parse('{"bytes": 1e999}')  →  Infinity
```

Nadie escribe la palabra y el infinito entra igual. El validador aceptaba eso como
`number` —una focal infinita, una matriz con un infinito dentro— y ahora un número
no finito se rechaza **en todo el repositorio**, no solo en el paquete, con su
propio mensaje: «es Infinity y tiene que ser un número finito», que dice qué
buscar en vez de mandar a mirar el tipo.

### D18 — R0 termina con `cube-v1` pasando
```bash
softsight reconstruction inspect fixtures/cube-v1/reconstruction.json
```
con `execution: COMPLETE` y `certification: PASS`, recorriendo esquema, sandbox,
hashes, PLY, CameraSet, escala, FrameGraph, auditoría mínima y sobre del informe.
El criterio se parte según D34.

**`cube-v1` local, del 2026-08-12.** `tools/cubeV1.mjs` lo fabrica —no lo
reconstruye, que es de VideoMesh (P1)— con la geometría del propio motor: el cubo
sale de `resolveScene`, así que el PLY lleva sus 24 vértices partidos por cara y
la auditoría tiene que soldarlos para ver que está cerrado. Las cuatro imágenes
son renders del rasterizador que certifica y **los intrínsecos del manifest son
los de la cámara que las produjo**; la puerta mira los píxeles para que ninguna
sea un lienzo del color de fondo, que pasaría los hashes igual de bien y sería
evidencia falsa. 12,7 KB, determinista, y no se commitea: lo escribe el generador.

Lo que el paquete atraviesa hoy: esquema, sandbox, hashes, PLY, CameraSet
declarado, escala, FrameGraph y auditoría de la malla —12 triángulos, 24
vértices, 16 duplicados soldados, cerrada, volumen 1—. **Falta el sobre del
informe**, que es S6, y con él R0-A.

**R0 se queda pequeño a propósito:** sin cobertura, sin confianza, sin LOD, UV,
PBR ni collision. La cobertura depende del árbol de triángulos, la visibilidad y
el muestreo, y llega después.
**Prueba:** es la prueba.

### D19 — Parámetros de distorsión con nombre, sin vector posicional — IMPLEMENTADA (2026-08-12)
Mejora de VideoMesh sobre nuestra propuesta: **eliminar el vector** en vez de
documentar su orden. Es P9.
```json
{ "model": "OPENCV",
  "intrinsics": { "fx": 2811.2, "fy": 2809.9, "cx": 1920.0, "cy": 1080.0 },
  "distortion": { "k1": 0.12, "k2": -0.08, "p1": 0.001, "p2": 0.002 } }
```
El `ColmapAdapter` convierte el vector nativo. Modelo desconocido:
`CAMERA_MODEL_UNSUPPORTED`.
**Prueba:** `colmap-small-v1` con tres modelos a la vez —`PINHOLE`,
`SIMPLE_RADIAL` y `OPENCV`—, que es lo que hace falta para que un orden de
parámetros cambiado no cuele: con un solo modelo, cualquier orden coincide
consigo mismo.

Tres cosas que la prueba fija:

```text
SIMPLE_RADIAL     una focal para los dos ejes, no una focal y un cero
PINHOLE           sin distorsión es ausente, nunca ceros implícitos
OPENCV_FISHEYE    se declara no soportado, no se aproxima a OPENCV
```

La tercera es la que importa: aproximar un ojo de pez ignorando los coeficientes
que sobran da una proyección que se equivoca poco en el centro y mucho en el
borde, que es justo donde la distorsión decide.

### D20 — `depthKind` obligatorio — IMPLEMENTADA (2026-09-13)
`OPTICAL_AXIS | RAY_LENGTH`, sin valor por defecto y sin inferirlo por proveedor.
Confundirlos mete un error que crece con el ángulo respecto al centro: cero en el
centro, máximo en las esquinas. `INVERSE_DEPTH` y `DISPARITY` llegarán por
capability, nunca reinterpretando depth V1.
**Prueba:** `depth-optical-axis-v1`, `depth-ray-length-v1`.

**El campo estaba desde R0-A; lo que faltaba era la prueba y el número.** La
decisión se explicaba sola en una frase —confundir la coordenada sobre el eje
óptico con la longitud del rayo mete un error que crece con el ángulo— y una
frase no es una prueba. Medido sobre la cámara de `cube-v1`: **0 % exacto en el
centro y 12,5 % en la esquina**. Ése es el tamaño del error que un valor por
defecto metería en silencio.

Y un mapa de profundidad **declara ahora su cámara**. Sin ella el número de cada
píxel no significa nada: hace falta una pose y unos intrínsecos detrás, y
`depthKind` decide cuál de las dos cosas es ese número, una distinción que solo
existe respecto a una cámara concreta. Es el mismo argumento que ata la imagen a
su calibración en D10.

**Leer los píxeles de profundidad sigue sin poder hacerse**, porque D5 —EXR— no
está escrita. Lo que R0 comprueba es que el paquete sea interpretable, no que la
profundidad cuadre; eso es R8.

### D21 — Coverage v1 sin provenance, y qué puede certificar — IMPLEMENTADA (2026-08-12)
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
**Prueba**, los cuatro casos, fijados con VideoMesh el 2026-08-12:
```text
TRIANGLE_MESH con true    → válido
TRIANGLE_MESH con false   → válido
TRIANGLE_MESH sin campo   → inválido, por error de esquema, no por cobertura
POINT_CLOUD con campo     → inválido
```
El cuarto es más estricto de lo que habíamos escrito: en una nube de puntos el
campo no es que falte, es que **está prohibido**. Sale gratis con la forma
discriminada —cada alternativa emite `additionalProperties: false` y el literal
del tipo no deja que un `POINT_CLOUD` case con la forma de malla—.

**Nota de implementación, para cuando se escriba** (no es contrato): un `anyOf`
sin discriminar da un error pobre —«no coincide con ninguna forma»— y este
repositorio devuelve errores con sugerencia. El validador debe mirar primero el
literal del tipo y comprobar solo esa alternativa, o el cuarto caso pasará por el
motivo correcto con un mensaje inútil.

**Escrito el 2026-08-12, y la nota resultó ser el trabajo.** Aquí falló la
comprobación de D15: `anyOf` **no llegaba**. Se aplica al campo entero y no a cada
elemento de una lista —el propio `schema.ts` ya lo decía en dos comentarios, por
lo que los generadores de perfil y las deformaciones van planos—, y los artifacts
son una lista heterogénea. Se disparó la condición de D15 y se extendió el esquema
en ejecución con `variants`: discriminante **declarado**, no adivinado, y el
literal se mira antes que la forma. Los cuatro casos pasan con su mensaje:

```text
TRIANGLE_MESH con true    → válido
TRIANGLE_MESH con false   → válido
TRIANGLE_MESH sin campo   → «falta artifacts[0].purelyReconstructed»
POINT_CLOUD con campo     → «artifacts[0].purelyReconstructed no existe»
```

Y un quinto que sale gratis y hacía falta: un tipo que no existe dice cuáles hay
—«artifacts[0].type no admite "MESH"; admitidos: TRIANGLE_MESH, POINT_CLOUD,
IMAGE, DEPTH_MAP»— en vez de un fallo de forma.

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

**Nuestra mitad, hecha el 2026-08-12.** `camera-projection-v1`: cuatro cámaras
por seis puntos contra valores dorados, con la fórmula escrita en el propio
fixture para que el otro lado pueda derivarlos sin leer nuestro código. Dos
comprobaciones más que no dependen de ninguna fórmula nuestra: la caja de los
ocho vértices proyectados contra **la silueta que el rasterizador pintó de
verdad**, y que cambiar cualquiera de las tres convenciones mueva el píxel
—`pixelCenter` medio, `pixelOrigin` refleja la fila, `cameraAxes` invierte la
profundidad—.

**Escribirla encontró un error real.** Las imágenes de `cube-v1` salían
ortográficas mientras el manifest declaraba `PINHOLE` con una focal sacada del
campo de visión: `frameCameraFromAabb` deja `projection` en `undefined` si la
vista no lo pide, y el rasterizador cae a la rama ortográfica. Con un cubo
alineado las cajas coinciden y no se nota; la vista de tres cuartos lo delató por
treinta píxeles. El CameraSet describía unos píxeles que no eran los suyos, y
ningún hash lo habría visto nunca.

**Las otras tres filas, el 2026-09-14.** `package-parity-v1` trae los valores
dorados de recuentos, caja tras normalizar el marco y cámaras registradas, sobre
los dos paquetes, con la fórmula escrita al lado para que se rehagan sin leer
nuestro código. Lo que llevaban esperando no era una puerta sino **superficie**:
hasta que `producers/superficie` existió, un SfM disperso no tenía malla que
medir.

La fila 2 era la que más engañaba. Sobre `cube-v1` la normalización es la
identidad, así que **una implementación que ignore el grafo entero acierta**. Por
eso los casos de `normalizacion` no la usan: rotan treinta grados y trasladan, y
uno exige componer dos aristas en orden. Dos mutaciones lo comprueban —ignorar la
matriz, y componer al revés— y las dos ponen la puerta roja donde no la ponía
nada.

Y el tercer caso es el hallazgo de D11 hecho dorado: **sin camino, `null` y no la
identidad**. Un grafo incompleto no se arregla suponiendo que seguramente son el
mismo marco.

De las tres columnas hay dos. `colmap-small-v1` tiene la del productor —
`producers/colmap` trae su propio lector, escrito desde la documentación del
formato— y las dos lecturas caen **exactas a 0** en los tres centros de cámara,
con el dorado en medio a 4,1e-7, que es la cota de redondear a seis decimales.
**De `cube-v1` no hay segunda implementación**: lo escribimos nosotros y nadie
más lo ha vuelto a escribir, así que la decisión sigue ACORDADA y lo que le falta
está dicho en vez de supuesto.

`expected.json` es el oráculo de prueba, **no parte del paquete**: SoftSight no lo
consume en producción. La lógica vive en `tests/contracts/parity/`.
**Prueba:** es la prueba, y desde el 2026-09-14 se llama `test:parity`.

### D24 — El árbol de triángulos se llama `boundsTree.ts` — IMPLEMENTADA (2026-08-12)
Tipo `TriangleBoundsTree`. `bvhLoader.ts` ya existe y es Biovision Hierarchy.

**Prueba:** `test:bounds-tree`, con **la fuerza bruta de juez**: mil rayos y cien
cajas deterministas comparados contra recorrer la malla entera, triángulo a
triángulo. Un árbol solo sirve si contesta exactamente lo mismo que mirarlo todo,
y eso no se comprueba leyendo el código.

`buildTriangleBoundsTree`, `raycast`, `nearestPoint` y `queryAabb`, la API que el
plan pedía. Determinista: partición por el punto medio del eje mayor —no por
mediana, que depende de cómo el motor ordena los empates—, partición **estable**
en dos pasadas, y empates de distancia resueltos por índice de triángulo
ascendente. Dos construcciones dan los mismos arrays byte a byte, que es el
criterio del plan: misma malla y misma versión, mismo recorrido.

```text
triángulos   CPU      nodos       árbol      RSS máx
100k         0,16 s      34.879     1,7 MiB    71 MiB
1M           0,60 s     342.463    16,9 MiB   154 MiB
5M           2,56 s   1.742.943    85,6 MiB   478 MiB
```

Medido con el arnés de D25 —proceso aparte, tiempo de CPU, RSS muestreado— para
que las dos estructuras se puedan comparar. 5M cabe de sobra.

**Dos fallos que solo la comparación con fuerza bruta habría encontrado**, y los
dos daban respuestas plausibles:

1. El truco clásico de los BVH —«el hijo izquierdo es el nodo siguiente»— **no
   vale cuando se construye con una pila**: entre un nodo y sus hijos se crean los
   de otra rama. Los dos hijos van explícitos.
2. La cota de nodos `2·ceil(n/L) − 1` **no es una cota**: es la del árbol
   equilibrado, y una partición que deja un triángulo a un lado la supera.
   Escribir fuera de un `Int32Array` **no lanza, se ignora**, así que el árbol
   salía con nodos a cero y las consultas contestaban. Los arrays crecen.

Lo que este árbol desbloquea —cobertura, distancia de superficie, visibilidad,
oclusión— sigue bloqueado por D34 hasta R0-B. Esto es la estructura, no la
métrica.

### D25 — `auditMesh` antes que cualquier árbol — IMPLEMENTADA (2026-08-12)
Medir el techo actual, perfilar, reescribir las estructuras calientes, puerta de
recursos, y solo entonces el árbol. La puerta mide tiempo, RSS máximo, heap,
buffers externos y caché: «terminó» no es una medida. Se registra también
plataforma, arquitectura, versión de Node, CPU, RAM y número de workers, para que
la medida sea reproducible.

Orden, no negociable: **línea base → perfil → cambio → medida.** No reescribir y
esperar.

Motivo: `mesh.ts` ya es de arrays tipados; quien no escalaba era `auditMesh`, con
un `Map` de clave de texto por vértice y otro de aristas.

**Prueba:** `tools/resources.test.mjs`, puerta de recursos con la malla generada
por `tools/scaleMesh.mjs` —un toro determinista, sin fixture en git, D22—. El
escalón de 5M pide `SOFTSIGHT_HEAVY=1` y sin él la puerta se declara NOT_RUN con
su motivo, nunca verde. Falla si el consumo se dispara: techos de 0,5 s de CPU y
140 MiB de RSS en 100k, 3 s y 640 MiB en 5M.

**Recorrido, en el orden que la decisión fija.** Entorno: `darwin/x64`, Node
v24.13.0, Intel i5-5350U (2 físicos / 4 lógicos), 8 GiB de RAM, heap viejo por
defecto 2240 MiB, 1 worker.

```text
5M triángulos      línea base   sin el Map de     sin ninguno
                   (dos Map)    soldadura
CPU                11,41 s      8,69 s            0,93 s
RSS máximo         888,7 MiB    731,7 MiB         314,8 MiB
heap de V8         460,4 MiB    461,5 MiB         6,2 MiB
heap mínimo para   entre 384    entre 384         64 MiB o menos
que no reviente    y 416 MiB    y 416 MiB
```

Respuesta a la pregunta que era una suposición: **5M pasaba**, con 889 MiB de RSS,
y moría por debajo de ~400 MiB de heap viejo abortando en `OrderedHashMap`, que es
la representación de `Map` en V8. Hoy pasa con 64 MiB de heap: lo que queda vive
en arrays tipados y el límite ya no es el heap sino la RAM de los buffers.

Las estructuras que lo sustituyen: tabla de dispersión abierta en dos
`Int32Array` para la soldadura, y agrupación por conteo y prefijos —la forma de
`buildPositionGrid`— para las aristas. `edgeKey` desaparece: la nueva estructura
indexa por vértice y no empaqueta nada.

### D26 — El contrato está en DRAFT — el segundo productor ya existe (2026-09-13)
`0.x` mientras `contractMaturity = DRAFT`. Promoción a `1.0` cuando **dos
productores reales distintos** produzcan paquetes válidos.

**`cube-v1` no promueve el contrato:** es sintético. Sigue en DRAFT después de
R0-B. La promoción la traen COLMAP y VideoMesh sobre datos reales.


**`producers/colmap/` es el segundo productor**, desde el 2026-09-13. Escribe un
paquete de reconstrucción a partir de la salida de COLMAP y **no importa ni una
línea de `src/`, `tools/` ni `dist-node/`** — una puerta lo comprueba por
ausencia, que es la única forma: un import de más no rompe nada, solo convierte al
segundo productor en el primero disfrazado.

Lo que eso prueba, y `tools/cubeV1.mjs` no podía probar: **que el contrato es
escribible por quien solo leyó el JSON Schema publicado**. La conversión de
COLMAP —cuaternión a matriz, inversión rígida de la pose, intrínsecos
posicionales a campos con nombre— está reescrita allí desde la documentación del
formato, y coincide con la del adaptador **exacta a 0 en los dieciséis números de
las ocho poses**. Compartir código habría anulado la prueba.

`colmap-v1` sale `COMPLETE + PASS` con salida 0: ocho vistas, 16.210 puntos, nueve
artifacts, escala `UNKNOWN`. Y sus poses reproyectan 21.425 observaciones con un
error peor de 3,96 px sobre una rejilla de 3072×2304.

**Lo que aún no promueve el contrato a 1.0**: este productor entrega nube de
puntos, no superficie, así que las comparaciones de recuentos y caja de D23 no
tienen qué comparar. Llegan con un productor que entregue malla — Meshroom o el
denso de COLMAP—, y entonces sí.

### D27 — Un repositorio, con frontera modular estricta — IMPLEMENTADA (2026-09-14)
`reconstruction/` y `production/` bajo `src/soft/agent/`. Esos módulos consumen
las APIs públicas o del núcleo, no importan a discreción de todo el repositorio.
Se extrae a un repositorio aparte solo si la cadencia diverge, aparecen
consumidores independientes, la legibilidad sufre de forma medible o el tamaño
del paquete se vuelve un problema real.
**Prueba:** `test:boundaries`.

**Hecho el 2026-09-14.** Las cuatro fronteras que la puerta comprueba **ya se
cumplían todas**, y eso no es que sobrara: es lo que las hacía frágiles. Una
frontera que solo vive en la cabecera de un fichero no es una frontera, es una
costumbre, y una costumbre se rompe sin que nadie se entere.

```text
1  src/soft/** no importa node:*        79 ficheros, ninguno
2  el núcleo no importa las dos capas   solo `index.ts`, que es su trabajo
3  reconstruction/ no importa           y producción sí lee de reconstrucción,
   production/                           en 3 sitios
4  producers/ no importa de src/,       D34: es lo que los hace productores y no
   tools/ ni dist-node/                  extensiones del verificador
```

La 1 me la salté yo mismo construyendo R16 y lo resolví a mano —la caché de
visibilidad vive en `tools/` justo por eso—. Salió bien porque me acordé; la
puerta existe para las veces que no.

La 2 es la que da sentido a la palabra «frontera»: si el núcleo pudiera importar
de la capa que lo usa, la dependencia iría en los dos sentidos y no habría nada
que separar. Por eso la regla exceptúa al barril y la puerta comprueba **también
la excepción**: `index.ts` sigue pudiendo, o no habría forma de publicar las
capas.

Y la 3 lleva su recíproca a propósito. Comprobar solo que reconstrucción no mira
a producción se cumpliría igual si no hubiera ninguna relación entre las dos, así
que la puerta exige que el sentido bueno exista.

**Cómo se comprobó que la puerta puede ponerse roja.** Nació verde —las cuatro
reglas ya se cumplían—, y una puerta que nunca ha fallado no ha demostrado que
mire nada: una que devolviera siempre la lista vacía habría pasado igual. Así que
las cuatro reciben una violación inventada y tienen que cazarla.

**Lo que queda abierto, y se dice:** qué módulos del núcleo pueden consumir las
dos capas. Hoy son cinco —`mesh`, `boundsTree`, `inspect`, `schema` y
`versions`— y fijar esa lista sería convertir el estado actual en regla sin que
nadie lo haya decidido.

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

falta el manifest        → PAQUETE_SIN_SELLAR
state != SEALED          → PAQUETE_SIN_SELLAR
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

**Medio hecha el 2026-08-12, por el lado del consumidor.** `package-integrity-v1`
prueba las dos condiciones de sellado que SoftSight puede comprobar: sellado entra,
`WRITING` se rechaza con `PAQUETE_SIN_SELLAR`. El resto —rename atómico, mismo
volumen, destino que ya existe— lo garantiza quien escribe, y su prueba es de
VideoMesh.

### D30 — Campo desconocido es error — IMPLEMENTADA (2026-09-13)
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
existiera este contrato.
**Prueba:** `unknown-field-v1`, en `contracts/fixtures/`, con puerta
`test:contracts`.

**Estado al 2026-08-12: seguía ACORDADA, y el fixture decía por qué.** La primera
fila estaba probada —siete documentos rechazados por su campo y tres aceptados,
más `additionalProperties: false` comprobado en los objetos de la frontera
publicada—, y dos mutaciones del validador la ponían roja. Las otras dos no se
podían ejercer: `extensions` no existía en ningún esquema, así que la puerta las
declaraba NOT_RUN. Una decisión con un tercio de prueba no era IMPLEMENTADA.

**Cerrada el 2026-09-13, y costó vocabulario nuevo.** `fields` no servía: exige
conocer los nombres de antemano, que es justo lo contrario de un espacio de
extensiones, donde la clave la elige el productor. Declarar el campo `object` sin
`fields` habría abierto la puerta a cualquier cosa, o sea deshacer D30 en el mismo
sitio donde se pretendía cumplirla. Así que el esquema en ejecución gana `entries`
—un mapa de claves libres a una forma común, con **patrón para la clave**—, igual
que D21 le hizo ganar `variants`, y `toJsonSchema` lo emite como
`patternProperties` con `additionalProperties: false`: el otro lado rechaza una
clave fuera del espacio igual que la rechaza `validate`.

```text
extensions["foo"]                          clave sin espacio de nombres → error
{ required: false, niveles: 3 }            campo de más en el envoltorio → error
{}                                         `required` sin valor por defecto → error
{ required: true }   desconocida           UNSUPPORTED, salida 21
{ required: false }  desconocida           preservada y declarada en el informe
{ required: true }   entendida             COMPLETE, en `honoured`
```

**La política que la decisión dejaba abierta se elige: preservar y declarar.**
Ignorar en silencio tiene el mismo problema que aceptar un campo desconocido —el
productor cree que mandó algo que se usó—, así que el informe publica `policy`,
`honoured` e `ignored`. `SUPPORTED_EXTENSIONS` se sustituye por parámetro, igual
que `schemaHashes`, porque quién entiende qué es cosa de cada despliegue. El
último caso de la puerta existe por eso: sin él, un binario que declarase todo
desconocido también la aprobaría.

**Y el 2026-09-14 el espacio dejó de estar vacío.** `org.softsight.mascaras`
—las siluetas: qué píxeles de cada foto son la pieza— es la primera extensión que
este binario honra, y entró por aquí y no por el contrato a propósito: añadir un
tipo de artifact `MASK` al esquema publicado sería declarar frontera algo que
nadie de fuera ha confirmado. Por el espacio experimental un productor puede
mandarlas hoy, y el día que se acuerden suben al contrato sin que nadie haya
tenido que adivinar su forma mientras tanto. Eso es exactamente para lo que D30
abrió el espacio, y hasta hoy no lo usaba nadie.

Un tercer objeto opaco entra en la lista de la puerta, y **su opacidad es la
decisión**: la carga de una extensión es del productor. Lo que no es libre es su
envoltorio ni su clave.

Dos hallazgos del camino, que son deuda de esta decisión y no de otra:

1. **Veinte objetos de la frontera no cerraban la puerta.** Un campo declarado
   `object` sin `fields` no lo recorría `validate` ni lo cerraba `toJsonSchema`.
   **Cerrados el 2026-08-12, dieciocho de veinte** (ver abajo); los dos que
   quedan son datos libres a propósito y están enumerados en la puerta, así que
   uno nuevo la pone roja.
2. **La sugerencia tiene alcance dos**, por diseño: `duration` contra
   `durationFrames` no sugiere, enumera. Traer una sugerencia de más lejos manda
   al agente a otro campo.

**Los dieciocho, cerrados.** Uno de ellos no era deuda sino un agujero en la
frontera publicada: un campo con `anyOf` emitía **además** la forma genérica
`{ type: "object" }`, así que el JSON Schema de `geometry` aceptaba cualquier
objeto y las seis alternativas no pintaban nada. Un validador del otro lado
casaba contra la genérica.

```text
antes                                       ahora
geometry.anyOf[0] = cualquier objeto        solo las seis formas reales
deform.twist/taper/bend/wave = object       { axis, degrees|scale|… } declarado
path.through = object[]                     number[3][], con qué punto falla
radius / twist / degrees / amplitude        number|object con la tabla declarada
```

Las tablas de variación no se podían declarar mientras `validate` aplicaba la
forma del objeto también al número —admiten las dos cosas—, así que ahora recorre
`fields` **solo sobre lo que es objeto**. Con eso `at` y `ease` quedan cerrados y
lo que sigue comprobando `evaluateVariation` es lo que un esquema no ve: que los
pares vengan en orden, sin repetir, y **cuál** rompe el orden.

Dos mensajes mejoraron de paso, y los dos son la misma idea que la nota de D21:
una unión de literales dice ahora `axis no admite "w"; admitidos: x, y, z` en vez
de `axis debe ser "x"|"y"|"z"`, y una lista de puntos dice cuál punto falla.

### D31 — Negociación de capabilities — IMPLEMENTADA (2026-09-13)
El paquete declara `requires` y `provides`; SoftSight publica `supports`.
```text
capability requerida desconocida         → UNSUPPORTED
capability opcional provista desconocida → continuar si el contrato lo permite
```
**Prueba:** la puerta `test:contracts`, en vez del `unknown-capability-v1` que la
decisión preveía. El fixture habría sido un tercer fichero para lo que el propio
manifest ya dice en dos campos; lo que la prueba necesita es ejercer las tres
ramas, y eso se hace con el manifest base y tres listas.

**Comparte la función que decide con D30**, y eso es deliberado: la negociación
tiene la misma forma —lo requerido desconocido para, lo provisto desconocido se
preserva— y escribirla dos veces garantiza que la segunda copia se quede sin el
arreglo de la primera. Lo que cambia es qué se negocia: una extensión es forma de
los datos, una capability es comportamiento.

**`supports` no está vacía**, al revés que la lista de extensiones: `mesh-audit`,
`camera-projection` y `ply-ascii` son nombres para trabajo que una puerta ejerce
hoy. Poner uno que no se hace sería prometerlo, y un productor que lo pidiera
recibiría un PASS sobre algo que nadie midió.

**`coverage` y `confidence` no están, y la puerta lo comprueba.** Siguen
bloqueadas por D34, y es exactamente el caso que la negociación existe para
contestar bien: un paquete que las requiera sale UNSUPPORTED con el mensaje
diciendo qué sí se sabe hacer, en vez de un informe sobre otra cosa.

La política de la provista desconocida se elige igual que en D30: **preservar y
declarar**. «Continuar si el contrato lo permite» deja al productor sin saber si
su capability se usó o se tiró.

`supports` viaja en el informe aunque el paquete no pida nada: es lo que le dice
al productor qué puede pedir la próxima vez sin tener que probarlo.

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
que esta decisión previene. **D32 es ese consumidor.**

**Pagado el 2026-08-12, y no eran dos sitios: eran tres.** `glbLoader.ts`,
`animation.ts` y `skinBinding.ts` —este último en las dos direcciones, porque
también escribe glTF—. Las cuatro copias están ahora en `agent/gltfFrame.ts`, con
la lectura del contenedor GLB al lado, y la ida y la vuelta **juntas a
propósito**: es lo que la decisión quiere decir con «la regla es semántica y no
“el cargador transpone y el exportador transpone”».

La puerta `test:gltf-frame` comprueba que las dos rutas dan la misma matriz para
el mismo nodo, y que `column * 4 + row` no aparece en `src/` fuera de ese fichero.
Lo segundo es lo que impide que la deuda vuelva: **dos transposiciones se
cancelan**, la geometría sale bien colocada por casualidad y ningún hash lo
delata. `46228b7c` no se movió, que es justo lo que no bastaba como prueba.

Sigue aparcado unificar el árbol de nodos de los dos lectores, que es otra cosa:
existen por motivos distintos y su fusión arriesga las 296 piezas del dron sin
que nadie la pida.
**Prueba:** fixture `transform-gltf-v1` con traslación, rotación, escala uniforme
y una composición no trivial: ida y vuelta canónico → glTF → canónico, más un
punto conocido a su punto transformado conocido.

### D33 — Orientación canónica de imagen — IMPLEMENTADA (2026-09-13)
Toda imagen referenciada por el CameraSet entra con la **orientación horneada en
los píxeles**. Las dimensiones de cámara describen la rejilla real, no una
rotación EXIF pendiente. `sourceOrientation` puede guardarse como provenance,
pero nada aguas abajo interpreta píxeles a partir de esa metadata.
**Prueba:** `test:reconstruction`, con dos mitades.

**La primera abre la imagen.** Las dimensiones de la cámara se comparan con la
rejilla real del PNG, y una cámara que declare la rejilla girada se rechaza con
`SS-CAM-004`. Vive en el CLI y no en `ingest.ts` porque decodificar es IO, y allí
no hay. Es el único sitio desde el que la afirmación se puede desmentir: una foto
con los intrínsecos girados **se ve bien en miniatura**.

**La segunda comprueba una ausencia.** `sourceOrientation` solo aparece donde se
declara y donde se prueba, igual que D32 vigila que `column * 4 + row` no salga de
su fichero, y por el mismo motivo: **un uso de este campo no rompe ninguna
prueba**. Da una imagen girada que sigue siendo una imagen, así que ningún hash lo
delata. Declararlo no mueve el veredicto, y eso también se ejerce.

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
S1  línea base de auditMesh, medida y publicada    HECHO 2026-08-12
S2  perfil de weldPositions y edgeUse              HECHO — las dos reescritas,
                                                   D25 IMPLEMENTADA
S3  fixture unknown-field-v1                        HECHO — la fila 1 de D30
                                                   probada; las dos de
                                                   extensiones, NOT_RUN sin
                                                   `extensions`. D30 sigue
                                                   ACORDADA
S4  esqueleto de esquema e ingesta de R0-A       HECHO — esquema del paquete,
                                                sandbox e integridad. D6 y D21
                                                pasan a IMPLEMENTADAS
S5  generador local de cube-v1                   HECHO — `npm run cube-v1`:
                                                malla, nube, cuatro imágenes
                                                renderizadas y su CameraSet,
                                                sellado con rename
S6  informe mínimo de reconstrucción             HECHO — R0-A cierra:
                                                COMPLETE + PASS con salida 0
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

### PENDIENTE sin número — qué certifica R0

Se aplica ya, porque D18 exige que `cube-v1` salga `COMPLETE + PASS` y sin
criterio no hay veredicto. Va aquí como pendiente según §1.6, en el código que lo
aplica (`CERTIFICATION_POLICY`, `report.ts`) y en el envío 01, para que VideoMesh
lo confirme o lo cambie.

```text
PASS           el paquete está íntegro, la evidencia requerida está,
               y toda malla declarada se lee y tiene superficie
INCONCLUSIVE   falta evidencia que el contrato pide, o no había nada que medir
FAIL           lo que se midió contradice lo que el paquete declara
```

**La calidad geométrica no decide el veredicto.** Una malla reconstruida con
agujeros es lo normal, no un fallo del paquete: se reporta y quien fije un umbral
lo hará en producción, que es otro documento. Certificar aquí «cerrada o FAIL»
haría fallar a casi toda reconstrucción real y empujaría a rellenar agujeros para
pasar la puerta —que es exactamente lo que `purelyReconstructed` existe para poder
distinguir—.

El informe publica qué criterio aplicó en `certificationPolicy`, para que un PASS
de hoy y uno de mañana se puedan comparar.

---

**Lo primero que este intercambio debía producir que no fuera un documento** era
un número: el techo de `auditMesh` sobre 1M triángulos y el mismo número después
de quitar los `Map`. Está, con el entorno declarado en D25:

```text
1M triángulos    con los dos Map    sin ninguno
CPU              2,26 s             0,24 s
RSS máximo       408,8 MiB          110,6 MiB
soldadura        500.000 entradas,  dos Int32Array
                 76,4 MiB de heap   (8 B/vértice)
aristas          1.500.000 entradas, conteo y prefijos
                 160,5 MiB de heap   (~75 MiB en 5M)
```

El escalón de 5M y el límite de heap, en D25.
