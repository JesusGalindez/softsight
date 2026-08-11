# softsight

**Software 3D rasterizer with an agent workbench. No GPU, no dependencies.**
Loads GLB/OBJ, renders contact sheets, audits topology, applies patches — headless,
deterministic, JSON in and out.

---

Rasterizador 3D por software —sin GPU y sin dependencias— con un banco de trabajo
headless para agentes de IA: carga GLB y OBJ, renderiza pliegos de contactos, audita
topología y aplica parches. Entra y sale JSON.

## Por qué existe

Un agente de IA que modifica geometría 3D trabaja a ciegas. Ve una imagen bonita y no
puede saber si la malla está cerrada, si una normal apunta al revés, si una pieza flota
en el aire o si el pivote quedará descentrado al rotar. Nada de eso se ve mirando.

softsight le da las dos cosas que le faltan: **una imagen que puede pedir barata y
repetible**, y **números exactos sobre lo que la imagen no muestra**. Y como el
renderizado es por software, el mismo código corre en el navegador, en Node y en una
tubería de integración continua sin GPU, sin drivers y sin sorpresas entre máquinas.

El dron de los ejemplos es el **espécimen de pruebas**: un modelo de 296 piezas con
nombres semánticos, generado proceduralmente, excepcionalmente bueno para ejercitar la
carga jerárquica, la selección por patrón y las auditorías.

## Arrancar

```bash
npm install
npm run dev
```

| Página | Qué es |
|---|---|
| `/soft.html` | **Rasterizador software**: pipeline completo en CPU |
| `/soft.html?bench=24` | Banco determinista, imprime el informe en pantalla |
| `/soft.html?workers=8` | Fuerza N hilos para medir el paralelo por bandas |

En `/soft.html` puedes **soltar un `.glb` o un `.obj`** sobre el visor, o usar los
botones para cargar los del repositorio.

## Crear un objeto desde cero

No hace falta un fichero de partida. La escena es JSON: primitivas con parámetros, o
mallas crudas con sus posiciones e índices, que es lo que produce cualquier generador
de geometría. El mismo informe —auditoría, contrato, pliego— juzga lo que acabas de
inventar.

```json
{
  "objects": [
    { "name": "fuste", "geometry": { "primitive": "box", "parameters": [1.1, 1.6, 1.1] },
      "position": [0, 1.05, 0] },
    { "name": "cubierta",
      "geometry": { "positions": [-0.7,0,-0.7, 0.7,0,-0.7, 0.7,0,0.7, -0.7,0,0.7, 0,0.85,0],
                    "indices": [0,4,1, 1,4,2, 2,4,3, 3,4,0, 0,1,2, 0,2,3] },
      "position": [0, 2.4, 0] }
  ],
  "budget": { "watertight": true }
}
```

Si la pirámide se deja sin base, el informe no se lo calla: `BORDE_ABIERTO: 4 aristas de
borde` y el contrato `watertight` incumplido, con salida 1. Y si se bobina del revés
—que no se ve en la imagen más que como una pieza oscura— salta `MALLA_INVERTIDA`, por
el signo del volumen.

Primitivas: `box`, `sphere`, `torus`, `plane`, `cylinder` y `cone`. Y dos formas que
no caben en una primitiva —extrusión de un polígono, que puede ser cóncavo, y
revolucionado de un perfil alrededor de Y—:

```json
{ "geometry": { "extrude": [0,0, 1.6,0, 1.6,0.4, 0.4,0.4, 0.4,1.6, 0,1.6], "height": 0.35 } }
{ "geometry": { "revolve": [0,0, 0.42,0, 0.5,0.25, 0.34,0.7, 0.26,1.25], "segments": 40 } }
```

Da igual en qué sentido escribas el polígono o el perfil: se normalizan, porque
escribirlos al revés produciría un sólido con las caras hacia dentro y ese es el error
más fácil de cometer.

Con eso no se describe un ala ni un fuselaje, así que hay **cinco cosas más**. Los
perfiles se declaran una vez y se usan por nombre —cuatro familias de fórmulas, entre
ellas el perfil aerodinámico NACA de cuatro dígitos—:

```json
{ "profiles": [{ "name": "ala", "naca": "2412", "points": 48 }] }
```

`loft` cose secciones colocadas, y **dos secciones iguales son una extrusión**: mismo
volumen, misma caja y los mismos triángulos. `sweep` barre un perfil por un recorrido, y
**un círculo alrededor de un eje es un revolucionado**: da el mismo número que el toro.

```json
{ "geometry": { "loft": [
    { "at": [0,0,0],   "profile": "ala", "scale": 0.34, "twist": 8 },
    { "at": [0,0.8,0], "profile": "ala", "scale": 0.09, "twist": 1 }] } }

{ "geometry": { "sweep": "ala",
    "path": { "through": [[0,0,0], [0.3,0.2,0], [0.4,0,0]] },
    "radius": { "at": [[0, 0.02], [1, 0.013]] } } }
```

Y las dos cosas se combinan: un `loft` acepta el mismo `path` que un barrido, y entonces
la curva pone la posición —las secciones se reparten por índice y cada estación lleva el
perfil interpolado entre las dos que la rodean—. **Un loft de dos secciones iguales por
una curva es exactamente barrer ese perfil por ella**: las mismas caras y 2,2e-16 de
diferencia, que es el epsilon del doble.

```json
{ "geometry": { "loft": [{ "profile": "boca" }, { "profile": "cuello" }, { "profile": "punta" }],
    "path": { "through": [[0,0,0], [0.4,0.7,0.1], [1.1,1,0.5]] }, "stations": 32 } }
```

`deform` es una lista **ordenada** —torcer y luego doblar no es doblar y luego torcer— y
se aplica a cualquier geometría. `repeat` produce copias: radial a ángulos exactos, o
espejo.

```json
{ "deform": [{ "twist": { "axis": "y", "degrees": 120 } },
             { "taper": { "axis": "y", "scale": { "at": [[0,1],[1,0.4]] } } }] }

{ "repeat": { "radial": { "count": 4, "axis": "y" } } }
```

Todo se verifica con el volumen exacto, no con la imagen: la torsión lo conserva, el
afinado lo multiplica por `(1+k+k²)/3`, y un barrido que se corta a sí mismo salta como
`BARRIDO_AUTOINTERSECADO` antes de generar nada. Hay un ejemplar con una pieza de cada
mecánica en `artifacts/agent/pieza-geometria.json`.

Y el movimiento se declara con **el mismo vocabulario que la forma**: una pista de un
clip acepta la misma tabla —`linear`, `smooth`, `power:k`— en vez de doscientas claves
escritas a mano, y `turns` gira las vueltas que le digas.

```json
{ "joint": "rotor", "property": "rotation", "axis": "y", "turns": 3, "frames": 60 }
{ "joint": "cuerpo", "property": "translation",
  "value": { "at": [[0,[0,0,0]], [0.5,[0,0.06,0]], [1,[0,0,0]]], "ease": "smooth" },
  "frames": 20, "cycle": 3 }
```

`turns` no es azúcar: un muestreador de glTF interpola cuaterniones por el arco más
corto, así que una vuelta entera escrita con dos claves **no gira nada**. Por eso hornea
a 90° por clave, y `GIRO_AMBIGUO` avisa de las pistas escritas a mano que caen en la
trampa.

Para mirar el movimiento sin salir del repositorio, una tira de fotogramas:

```bash
npm run filmstrip -- --scene artifacts/agent/pieza-geometria.json --frames "0,1,2,3,4,5"
```

Crear es **incremental**: un parche puede añadir piezas, y aplicado a una escena edita
el documento, no la geometría. Lo que sale vuelve a ser una escena.

```bash
npm run agent3d -- --scene torre.json --patch anade-chimenea.json \
  --save-scene torre-v2.json --out torre-v2.png
```

```json
{ "edits": [
  { "op": "add", "object": { "name": "chimenea",
      "geometry": { "primitive": "cylinder", "parameters": [0.16, 0.9] },
      "position": [0.38, 2.1, 0] } },
  { "op": "translate", "target": "linterna", "delta": [0, 0.05, 0] }
] }
```

Y sale en el formato que lee el resto del mundo:

```bash
npm run agent3d -- --scene torre.json --export torre.glb
```

El GLB lleva **una malla por geometría** y un nodo por pieza, con su nombre, su color y
su colocación: las piezas repetidas comparten los vértices en vez de copiarlos. El dron
de pruebas exportado pesa 1,24 MB frente a los 2,07 MB del original comprimido, y
cargado de vuelta da las mismas 296 piezas, los mismos triángulos y **la misma imagen**.

## Banco de trabajo para agentes

Escena o modelo dentro, pliego de contactos PNG y diagnóstico JSON fuera. Sin GPU,
sin navegador, sin servidor.

```bash
# Escena declarativa
npm run agent3d -- --scene artifacts/agent/ejemplo-dron.json --out revision.png

# Modelo real, con selección por patrón, parche y exportación
npm run agent3d -- --model artifacts/export/drone.glb \
  --select "rotor-*,propeller-*" \
  --patch artifacts/agent/patch-rotores.json \
  --export salida.obj --out revision.png
```

![Selección resaltada](docs/selection.png)

*`--select "rotor-*,propeller-*"` resalta en naranja las 24 piezas que encajan y apaga
el resto. El encuadre sigue a la selección. Cada tile lleva quemado su nombre y la
altura de mundo que abarca, para comparar escalas entre vistas sin volver al JSON.*

```bash
# Solo diagnóstico: piezas, familias y auditoría, sin renderizar nada
npm run agent3d -- --model artifacts/export/drone.glb --inspect-only

# Verificar un cambio: qué se movió en la imagen, cuánto y de qué pieza
npm run agent3d -- --model artifacts/export/drone.glb \
  --patch cambio.json --baseline anterior.png --out despues.png
```

Todo informe con pliego trae un `renderHash` —FNV-1a del búfer de color, uno por vista y
uno del pliego—, que responde «¿cambió algo?» comparando ocho caracteres, sin guardar
imágenes. Es reproducible desde el PNG, así que sirve de prueba de no regresión en CI.

Para eso el proyecto **fija la versión de Node** en `.nvmrc` y en `engines`. El render
es determinista dentro del mismo motor, pero `Math.sin`, `cos`, `tan` y `hypot` no están
especificados al último bit por el estándar —`+ - * / sqrt` sí—, así que comparar
imágenes exige el mismo aritmético a los dos lados.

Con `--baseline`, el informe trae además un `diff`: fracción del pliego que cambió,
desglose por vista, y las regiones con las piezas responsables. Dos renders sin cambios
dan **cero exacto**. Para que eso valga, con `--baseline` el encuadre y el volumen de la
sombra quedan fijados a los del modelo *antes* del parche: si no, mover una pieza
mueve la cámara y el pliego entero se desplaza un píxel.

`stdout` es JSON puro y el código de salida es 1 si hay un **defecto** —un aviso de
severidad `certeza`—, así que encadena en CI sin interpretar nada. Un `candidato` sale
entero en el informe y no rompe la orden: su medida es firme y su conclusión no.

### Pagar solo lo que se va a leer

El informe completo del dron son **16.493 B**, y el 45 % es `families`, que no cambia
porque muevas un rotor. Un agente en bucle de veinte turnos paga veinte veces el mismo
bloque.

```bash
# lo que cambia entre turnos: contractVersion, renderHash, warnings, warningsDelta, diff
npm run agent3d -- --model dron.glb --out revision.png --summary

# o dilo tú, con rutas separadas por puntos
npm run agent3d -- --model dron.glb --inspect-only --fields "warnings,spatial.floating"
```

`--summary` deja el informe del dron en **1.108 B**, un 93 % menos, con sus dos avisos
dentro. Es el mismo informe con menos claves, no otra forma: es una proyección sobre el
objeto ya construido y **no recalcula nada**, porque un resumen que calculara por su
cuenta sería un segundo origen del mismo dato. `exitCode` no va dentro —ya lo lleva el
código de salida— ni `budget` —lo declaraste tú—.

`--fields` proyecta las rutas que pidas conservando nombres y anidamiento, y manda sobre
`--summary`. Una ruta que no existe es error de datos con sugerencia, no un hueco en
silencio: recibir un objeto vacío por `spatial.floting` es indistinguible de que no haya
piezas flotantes.

`--schema` imprime la forma aceptada de la escena y del parche, más un informe de
ejemplo. No es documentación aparte: el esquema **es** lo que valida la entrada, así que
no puede divergir del código, y una errata se caza con sugerencia en vez de ignorarse.

Entero son 46.226 B. `--schema <parte>` —`scene|patch|story|staging|sample|report|codes`—
devuelve solo la que pidas: el parche son 12.321 B y el registro de códigos, 6.707. El
completo **se construye uniendo las partes**, así que una parte no se puede quedar atrás
del todo.

```
la escena no encaja con el esquema:
  - objects[0].positon no existe; ¿querías decir position?
```

`--help` lista todas las opciones: `--inspect-only`, `--summary`, `--fields`,
`--baseline pliego.png`, `--baseline-report informe.json`, `--select-where "expr"`,
`--patch` (repetible), `--undo`, `--dry-run`, `--save-scene`, `--no-cache`, `--tile N`,
`--isolate true`, `--audit-limit N`, `--ground false`, las de presupuesto y `--debug`.

El modelo analizado se guarda en `.cache/` con clave `(ruta, mtime, tamaño)`: analizar
el GLB del dron son 56 ms y leer la caché, 5 ms. El informe dice en `cached` de dónde
salió, `--no-cache` la salta, y el directorio se recorta por mtime con
`SOFTSIGHT_CACHE_MAX_MB` (256 por defecto), el mismo criterio que usan el puente y el
worker.

### Por MCP: las banderas dejan de ser prosa y pasan a ser tipos

Un agente que llega a la CLI tiene que leerse 7,4 KB de `--help`, decidir qué banderas
combina, construir una línea de órdenes y parsear el informe. Ninguno de esos errores lo
caza el esquema, porque el esquema valida la **entrada**, no la **invocación**.

`tools/mcp-server.mjs` publica siete herramientas tipadas —`softsight_inspect`,
`_render`, `_patch`, `_scene`, `_story`, `_bvh` y `_schema`— por JSON-RPC sobre stdio, sin
dependencias. `softsight_inspect` devuelve el resumen por defecto. Para registrarlo en un
cliente MCP:

```json
{
  "mcpServers": {
    "softsight": {
      "command": "node",
      "args": ["/ruta/a/softsight/tools/mcp-server.mjs"]
    }
  }
}
```

El servidor **no decide nada**: traduce la llamada a una petición del puente y devuelve lo
que el puente devuelve. Los esquemas de parámetros se generan de `SCENE_SCHEMA`,
`PATCH_SCHEMA` y `STORY_SCHEMA`, no se escriben a mano, y `npm run test:mcp` compara cada
herramienta contra el CLI directo. La única traducción que hace es leer del disco los
ficheros que el puente quiere en base64.

### El CLI que no se muere

```bash
node tools/agent3d.mjs --serve      # peticiones NDJSON dentro, respuestas NDJSON fuera
```

El 43 % de una llamada barata era arranque de proceso. `--serve` atiende **las mismas
peticiones que `tools/bridge.mjs`** —el mismo contrato, sin un campo nuevo— sobre un
proceso que se queda: **0,454 s por petición lanzando proceso contra 0,143 s residente**,
mejor de dos vueltas con el dron. Un proceso vivo acumula estado, así que la puerta manda
veinte peticiones idénticas seguidas y comprueba que las veinte respuestas lo son y que
el `renderHash` no se mueve.

El informe trae, además del pliego: auditoría topológica por pieza —aristas de borde,
no manifold, triángulos degenerados, normales invertidas, desviación del pivote,
error de simetría—, resumen por familias de piezas, la caja en píxeles que ocupa cada
pieza auditada en cada vista, y avisos redactados como diagnóstico, no como métricas.
Cada aviso es `{ code, part, message }`: el texto lleva las cifras dentro y cambia en
cada ejecución, así que lo que se compara es el código.

### Auditoría del movimiento: lo que pasa, y lo que se ve

La auditoría de animación mira **el espacio**: qué piezas se cruzan en el fotograma 42,
cuáles atraviesan el suelo en el 18. Son las preguntas correctas para «¿está bien
montado?» y las equivocadas para **«¿se ve?»**.

Un rotor puede girar perfectamente y salirse del encuadre en el fotograma 30; una pieza
puede empezar a moverse cuando todavía está fuera de cuadro, y entonces no se ve la
entrada, se ve algo que ya venía en marcha; y dos piezas pueden pasarse veinte fotogramas
una delante de la otra sin cruzarse en el espacio ni un milímetro. `animationAudit.screen`
las caza: `SALE_DE_CUADRO`, `ENTRADA_A_CIEGAS` y `OCLUSION_PROLONGADA`.

Se mide proyectando la caja de cada pieza con la cámara del pliego, **no rasterizando**:
es exacto, determinista y cuesta una multiplicación de matrices en vez de un render por
fotograma. El precio está declarado y es el mismo que paga la auditoría espacial —es la
caja, no la silueta—, así que los tres avisos son `candidato`. Y solo se reporta lo que el
movimiento rompió: en un muñeco el torso tapa a la cadera en reposo y lo seguirá haciendo
en los sesenta fotogramas, así que eso no avisa.

### Auditoría entre piezas

Lo que ninguna imagen revela y ninguna auditoría de malla puede ver, porque el fallo no
está en una malla sino en la relación entre dos: piezas que se cruzan, piezas sueltas en
el aire, duplicados invisibles y hermanos fuera de escala. Va en `spatial` y en los
avisos, siempre, sin bandera.

En el dron de pruebas encontró esto, que llevaba ahí sin que nadie lo viera mirando
renders:

> `camera-front-element: no toca ninguna otra pieza. Está 0.3467 por encima del suelo
> del modelo, sin nada debajo, y a 0.0907 de camera-catchlight, que es la pieza más
> próxima.`

Todas son de caja envolvente, y los avisos lo dicen: son **candidatos**, no hechos
comprobados malla contra malla. El trabajo está en no avisar de lo legítimo: un solape
en el que una caja contiene entera a la otra es un alojamiento y calla; una pieza mucho
mayor que sus hermanos que además los contiene es la que los aloja y calla; una hélice
en el aire pero unida a su eje no flota, porque el criterio es **no tocar nada**, no
estar elevada; y la misma malla en distinta posición es una instancia, no un duplicado.

### El aviso trae su arreglo

Cuando existe una corrección que la herramienta pueda defender, el aviso la lleva
dentro como fragmento de parche. El agente lo aplica tal cual, sin deducir nada:

```json
{ "code": "PIEZA_FLOTANTE", "part": "volando",
  "message": "volando: no toca ninguna otra pieza…",
  "fix": { "op": "align", "target": "volando", "to": "base" } }
```

Los avisos **sin** `fix` no son un olvido: una malla abierta se cierra de muchas
maneras y ninguna es automática. Operaciones de arreglo: `align`, `setPivot`, `mirror`,
además de mover, girar, escalar, colorear, ocultar, borrar, renombrar y añadir.

Los códigos no hay que descubrirlos provocándolos: `--schema` publica el registro
completo en `warningCodes` —qué provoca cada uno, si trae arreglo y con qué operación, y
si es **certeza** —aritmética que no depende de la intención— o **candidato** —medida
firme y conclusión abierta—. La tabla vive en `src/soft/agent/warningCodes.ts` y es la
que manda: emitir un código que no esté en ella no compila, y `npm run test:codes`
comprueba las dos direcciones contra `src/`.

Cada aviso trae su `severity` dentro, puesta desde esa tabla, así que no hay que cruzar
el informe con el registro para saber si se mira un hecho o una sospecha. Y es lo que
decide el código de salida: **1 solo si hay una certeza**. Antes lo decidía el número de
avisos, y con eso el ejemplar limpio del repositorio —`artifacts/agent/pieza-geometria.json`,
catorce avisos y los catorce candidatos— salía 1, que es la manera más rápida de enseñar
a ignorar el código de salida.

### Probar, mirar, deshacer

```bash
npm run agent3d -- --model dron.glb --patch a.json --patch b.json \
  --undo deshacer.json --out revision.png
```

`--patch` es repetible y se aplica en orden. `--undo` escribe el parche inverso, que
devuelve el modelo a su estado exacto —misma huella de render—. `--dry-run` informa de
coincidencias y errores sin renderizar ni escribir nada.

### Escala absoluta

glTF mide en metros, así que un dron de 4,5 unidades **son 4,5 metros**, que es absurdo
para un cuadricóptero. `--expect-size 0.35` compara el lado mayor de la caja contra lo
que el objeto debería medir y nombra la unidad si el factor la delata:

> `la caja mide 350.000 m en su lado mayor y esperabas ~0.35 m (factor 1000.0); el
> modelo parece estar en milímetros.`

Sin la bandera solo se avisa fuera del rango 1 cm – 100 m, y el aviso dice siempre la
suposición de la que parte.

### Presupuesto como contrato

```bash
npm run agent3d -- --model artifacts/export/drone.glb --inspect-only \
  --max-parts 400 --require-watertight --max-symmetry-error 0.02
```

Cada bandera es una cláusula; incumplirla es un aviso con código propio y salida 1, así
que el agente sabe si su cambio cumple sin interpretar el JSON. Hay `--max-triangles`,
`--max-parts`, `--require-watertight`, `--max-boundary-edges`, `--max-degenerate` y
`--max-symmetry-error`; una escena declarativa lleva los mismos campos en `budget`. Las
cláusulas de topología auditan las 296 piezas —1,2 s frente a 0,16 s— y solo se pagan si
se piden.

Con `--baseline-report informe-anterior.json`, el informe trae `warningsDelta` con lo
nuevo, lo resuelto y cuántos avisos persisten. El agente solo mira `new`.

### Contrato del informe

El informe declara `contractVersion: 2` en su raíz. Quien consume el informe lo
comprueba primero: una versión distinta significa que la forma ha cambiado y que
los campos se leen bajo otro contrato. En `contractVersion: 2` los avisos dejaron
de ser `string[]` y son objetos `{ code, part, message, fix? }`, con la clave
estable `code|part` para comparar entre informes —el texto del mensaje cambia en
cada ejecución porque lleva las cifras dentro. La auditoría de animación añade los
bloques `animation` (con `contractVersion: 1` propio), `skinning`, `morphTargets`
y `controlPoses`, todos documentados en el contrato de animación del editor.

### Evaluar una pose

El evaluador de animación es API pública del núcleo. `parseGlbAnimation` parsa el
GLB conservando el árbol de nodos (a diferencia de `parseGlb`, que aplasta la
jerarquía a piezas de modelo), y `evaluatePose` devuelve las posiciones
deformadas de una malla en un tiempo dado con la misma cadena que certifica las
poses de control —base, morph targets y skinning con el mismo redondeo de
pesos—. Los 4 frames del fixture dan los mismos hashes por la API que por el CLI
(`test:animation` lo comprueba). `evaluatePoseWithNormals` hace lo mismo para
normales, pendiente de certificación cruzada.

### Muestrear la superficie

Una referencia de superficie identifica un punto del modelo sin depender de un
vértice: malla, primitiva, triángulo y pesos baricéntricos
(`SAMPLE_REFERENCE_SCHEMA` en el esquema publicado). `sampleSurface` genera
referencias uniformes por área con semilla fija —misma semilla y mismo GLB,
misma lista—, y `evaluateSample` evalúa una referencia en cualquier frame con la
misma cadena que las poses de control, interpolando la baricéntrica en doble
precisión. El CLI certifica listas de referencias con
`--sample refs.json --frames "0,15,30,37"`: por frame, un `positionsHash` y un
`normalsHash` (nulo si alguna primitiva no declara NORMAL), con los mismos
fotogramas y huellas que usará el `sample-gate` del editor para certificar su
propio evaluador.

### Escribir un GLB con esqueleto

`serializeGlb` escribe el modelo interno, que está aplanado y no guarda ni
esqueleto ni clips: no puede escribir lo que no tiene. `serializeSkinnedGlb`
parte de una descripción declarativa —`SkinnedGlbScene`: árbol de nodos, mallas
con `JOINTS_0`/`WEIGHTS_0`, morph targets, pieles con sus matrices de enlace y
clips con sus muestreadores— porque quien produce esos datos no es el modelo
interno sino lo que venga de fuera: un GLB releído, un BVH, o un generador de
movimiento. `readAccessorValues` publica el lector de accesores que usan por
dentro el evaluador y el muestreo, para que reescribir un GLB no obligue a
reimplementar `byteStride`, los tipos normalizados y las vistas de meshopt.

Las matrices de enlace inversas entran y salen **por columnas**, como las guarda
glTF, sin transponer en ningún punto del viaje: transponerlas dos veces es el
error clásico y no se ve hasta que el modelo se retuerce al animar. Por eso la
puerta no mira el fichero, mira el número: `npm run test:glb-writer` lee el
fixture, lo levanta a `SkinnedGlbScene`, lo vuelve a escribir y comprueba que
`evaluatePose` da **los mismos cuatro hashes de control**. El fichero reescrito
pasa además el gate del editor con `accepted` y 4/4, así que Three.js deforma
con su propia implementación un GLB que escribimos nosotros y llega al mismo
número.

El escritor rechaza antes de escribir lo que produciría un fichero que abre y
anima mal: `JOINTS_0` sin `WEIGHTS_0`, pesos desalineados con los vértices,
matrices de enlace incompletas, joints o nodos fuera de la escena, `matrix`
declarada junto a la terna TRS, y un muestreador compartido entre rutas de
distinto tipo. El CLI todavía no lo usa —no hay productor de esqueletos que
alimentarlo—; es API del núcleo, como el evaluador.

### Leer un BVH

BVH es texto plano con un esqueleto y una tabla de números —sin malla, sin pesos,
sin materiales— y es el formato en el que sale la captura de movimiento y lo que
exportan los generadores de movimiento actuales. `parseBvh` lo lee sin ninguna
dependencia y `bvhToSkinnedScene` lo pasa a la escena que traga
`serializeSkinnedGlb`, así que **BVH dentro, GLB con esqueleto y clip fuera**:

```bash
npm run agent3d -- --bvh artifacts/agent/captura-ejemplo.bvh \
  --export esqueleto.glb --bvh-scale 0.01 --bvh-clip Salto
```

`--bvh` **convierte, no revisa**, y por eso no admite `--out` ni auditorías: un
BVH no tiene malla, así que no hay nada que encuadrar, rasterizar ni auditar. El
informe dice lo convertido —articulaciones, fotogramas, canales, y **los órdenes
de rotación que encontró**, que suelen ser varios en el mismo esqueleto— y el
GLB que sale tampoco tiene malla, porque aquí no se inventa lo que no venía.

Consecuencia que conviene decir antes de que sorprenda: ese GLB **todavía no se
puede certificar**. `--model` lo rechaza con «el modelo no tiene geometría
visible» y las poses de control tampoco aplican, porque evalúan vértices y no
hay ninguno. Se certifica cuando alguien le ata una piel; desde ese momento es un
GLB normal y entra por el camino de siempre. El propio informe de conversión lo
avisa en `notes`.

El puente lo expone como el comando `bvh`: recibe el fichero, devuelve el mismo
informe y el GLB como artefacto `model/gltf-binary`. Es el único comando que no
recibe `model`, por lo mismo. La puerta comprueba que **la API, el CLI y el
puente producen el mismo fichero byte a byte**: los dos últimos son envoltorios y
no deben decidir nada por su cuenta.

Tres detalles del formato que no están escritos en ningún sitio y son la causa
habitual de que un esqueleto salga retorcido:

- **El orden de rotación lo declara cada articulación**, en el orden en que lista
  sus canales, y las matrices se componen en ese orden:
  `R = R_primero · R_segundo · R_tercero`. `Zrotation Xrotation Yrotation` no es
  lo mismo que `Xrotation Yrotation Zrotation`, y dos ficheros con los mismos
  números y distinto orden describen poses distintas.
- **Los ángulos van en grados**, aunque el formato no lo declare.
- **Las distancias suelen ir en centímetros**, tampoco declarado: un esqueleto
  humano sale midiendo 170 unidades. No se convierte a escondidas —hay una opción
  `scale`— porque el proyecto ya tiene quien avise: la auditoría de escala
  absoluta salta fuera del rango de 1 cm a 100 m y dice de qué suposición parte.

Un BVH no trae malla, así que la puerta le ata una **sonda**: un vértice por
articulación, con peso 1 sobre su joint y colocado en su pose de reposo. Con la
matriz de enlace inversa siendo la inversa de esa pose, el vértice deformado *es*
la posición mundial de la articulación, y el evaluador de skinning acaba
respondiendo a una pregunta de cinemática. `npm run test:bvh` compara esas
posiciones contra una cinemática directa escrita aparte con matrices 4×4: dos
caminos independientes que solo coinciden si el orden de rotación, los grados y
la acumulación de desplazamientos son correctos.

El cierre cruzado se hizo sobre un esqueleto con **tres órdenes de rotación
distintos** y giros en los tres ejes: el editor generó la referencia de poses con
Three.js sobre el GLB derivado del BVH y SoftSight reprodujo los cuatro hashes
exactos, con el gate en `accepted` y `reasons: []`.

### Atar una malla a un esqueleto

El eslabón entre leer movimiento y escribirlo. Hasta aquí lo que salía eran
esqueletos, que no se pueden mirar.

```bash
npm run agent3d -- --bvh captura.bvh --export esqueleto.glb --bvh-scale 0.01
npm run agent3d -- --model dron.glb --skeleton esqueleto.glb \
  --bind vinculo.json --export dron-animado.glb
```

```json
{ "schemaVersion": 1,
  "bindings": [
    { "part": "propeller-*", "joint": "Brazo" },
    { "part": "rotor-*",     "joint": "Pecho" },
    { "part": "*",           "joint": "Cadera" }
  ] }
```

**Esto no es rigging automático, y la diferencia es la razón de que exista.** El
plan excluye a propósito el rigging, la IK y el retargeting: convierten un banco
de verificación en un Blender para agentes. Aquí **no se calcula ni un solo
peso**. El vínculo lo declaras tú —qué pieza a qué hueso, con la misma sintaxis
de patrón que `--select`— y la herramienta hace las tres cosas que sí son suyas:
comprobar que el vínculo cubre todas las piezas y que todos los huesos existen,
llevar los vértices a espacio de modelo y calcular las matrices de enlace desde
la pose de reposo, y ensamblar el resultado.

Gana la primera regla que encaja, así que lo específico va antes que lo general.
Una pieza sin regla es un **error**, no se ata a la raíz por si acaso: un modelo
mal atado se ve bien quieto y se rompe al animar. Si de verdad quieres un cajón
de sastre, `{ "part": "*" }` al final lo dice a propósito.

El atado es **rígido**: cada vértice pesa 1 sobre un solo hueso, y el informe lo
declara en `binding.mode`. No es una simplificación de algo mejor, es lo único
que se puede afirmar sin inventar. Un modelo mecánico —el dron, con sus 296
piezas con nombre— se ata así y queda exacto, porque sus piezas son rígidas de
verdad. Una malla orgánica continua necesita pesos suaves, y esos los trae quien
los tenga: `serializeSkinnedGlb` acepta `JOINTS_0` y `WEIGHTS_0` directamente.

La prueba de que no deforma nada por su cuenta es la más corta del repositorio:
el pliego del dron atado y el del dron original dan **el mismo `renderHash`,
`bd2d0e3d`**, con las mismas 296 piezas y los mismos 37.950 triángulos. Y la
puerta `test:bind` compara posición a posición en reposo y con el hueso movido,
donde el resultado del atado rígido es exacto y se puede afirmar en cerrado.

### Auditar un guion

El paso previo a cualquier render. Un guion es texto y tiempo, no geometría:
quién pone la pieza en escena es el editor, y aquí lo único que se hace es
medir si el guion funciona —con números, no con opiniones—.

```bash
npm run agent3d -- --story guion.json
```

```json
{ "storyVersion": 1, "title": "Tawantinsuyu", "fps": 30,
  "scenes": [
    { "name": "origen", "role": "apertura", "durationFrames": 210,
      "data": { "headline": "h. 1200", "subject": "Manku Qhapaq",
                "line": "En el valle del Qosqo nace un señorío pequeño." } },
    { "name": "final", "role": "cierre", "durationFrames": 150,
      "data": { "line": "En 1532 el imperio entero cabe en una emboscada." } }
  ] }
```

`role` es el vocabulario narrativo —`apertura`, `desarrollo`, `giro`, `cierre`—
y decide qué campos de `data` necesita la escena: esa tabla también se publica
en `--schema` como `storyRoles`, para que quien ponga el guion en escena no la
copie sin comparar. `data` son los datos, no la maqueta: campos de más se
admiten, y un rol que exige `headline` sin que el agente lo ponga es un error
de validación, no un hueco en el render.

La duración de la pieza **se deriva de la suma** y cada escena sabe dónde
empieza; nadie declara el total, así que el descuadre no es posible. `--story`
no escribe nada y no toca geometría: devuelve hechos medidos y sale con 1 si
hay avisos, como la auditoría espacial. Los avisos son tres, todos exactos:

- `TEXTO_ILEGIBLE` — el texto de la escena no se puede leer en su duración, y
  el aviso dice cuántos frames harían falta.
- `ROL_AUSENTE` — la pieza no tiene los roles que necesita (una historia sin
  cierre).
- `ROLES_CONSECUTIVOS` — dos escenas seguidas con el mismo papel.

La legibilidad parte de un ritmo de lectura **declarado, no medido** —15
caracteres por segundo— y el aviso lo dice; `--reading-rate` lo sube o baja.
El puente lo expone como el comando `story`: entra el guion, salen los hechos,
y nunca artefactos.

### Puente local

El navegador no ejecuta el CLI: `tools/bridge.mjs` recibe una petición JSON por
stdin y devuelve JSON por stdout —informe + artefactos— con un sandbox por
petición (rutas planas, límites de tamaño y timeout, sin shell). Comandos:
`inspect`, `render`, `patch`, `sample`, `scene`, `bvh`, `story` y `schema` (el
contrato en vivo). `scene` recibe una escena declarativa —la misma que valida
`--schema`— y devuelve informe, pliego y GLB; `bvh` recibe una captura y
devuelve el GLB con esqueleto y clip; `story` recibe un guion y devuelve
hechos, sin artefactos. La respuesta declara `bridgeContractVersion: 1`; los
errores de datos salen como JSON con `code` y salida 2. El editor lo consume
con `softsight-import.mjs` para regenerar en un paso el paquete de importación.
`npm run test:bridge` verifica que cada caso por el puente da el mismo
resultado que el CLI directo.

## Qué hay dentro

| Módulo | Contenido |
|---|---|
| `math.ts` | 4×4 row-major, matriz de normales, inversa afín |
| `projection.ts` | Perspectiva y ortográfica con profundidad invertida, planos del frustum |
| `clip.ts` | Recorte del plano cercano en espacio homogéneo |
| `raster.ts` | Span exacto, gradientes incrementales, regla top-left, curva ACES, dither |
| `shading.ts` | Blinn-Phong, ambiente hemisférico, filtrado analítico de textura |
| `shadowMap.ts` | Mapa de sombras direccional con profundidad lineal |
| `renderer.ts` | Orquestación: visibilidad, vértices, recorte, rasterizado, postproceso, título SDF |
| `font.ts` | Tabla de glifos 5×7 en cadena hexadecimal, compartida por rótulo y texto |
| `text.ts` | Texto SDF: campos de distancias por glifo, aristas suaves a cualquier escala |
| `present.ts` | Buffer interno desacoplado del canvas visible |
| `resolutionController.ts` | Resolución adaptativa con modelo de coste ajustado en vivo |
| `parallel.ts`, `renderWorker.ts` | Paralelo por bandas con reparto adaptativo |
| `agent/` | Lectores GLB/OBJ/BVH, escritor GLB con esqueleto, modelo direccionable, auditoría, pliego con rótulos, diff de renders |

Dependencias: **ninguna** en el núcleo. `meshoptimizer` es opcional y se carga bajo
demanda, solo si abres un GLB comprimido con `EXT_meshopt_compression`.

## Documentación

- [`docs/mapa-del-proyecto.md`](docs/mapa-del-proyecto.md) — **empieza aquí**: las dos
  mitades del producto, dónde vive cada dato, las puertas de verificación cruzada y
  qué toca ahora.
- [`docs/software-renderer.md`](docs/software-renderer.md) — cómo funciona y por qué:
  la matemática de la proyección, cada optimización con su medida, el banco de
  agentes, y qué formato conviene importar.
- [`docs/plan-renderizador.md`](docs/plan-renderizador.md) — el plan por fases con lo
  hecho, lo medido y lo pendiente. Incluye las ideas que se **descartaron por
  medida**, que suelen ser más útiles que las que funcionaron.
- [`docs/plan-agentes.md`](docs/plan-agentes.md) — plan para que un agente verifique
  sus cambios en vez de mirarlos: comparación de renders, auditorías espaciales entre
  piezas, consultas baratas y memoria entre llamadas.
- [`docs/plan-fases-bcd.md`](docs/plan-fases-bcd.md) — animación certificada (hecha),
  superficie animada para partículas adheridas (hecha) y puente local entre el editor
  y el CLI (hecho).

## Cómo medir antes de optimizar

Tres herramientas, y conviene usarlas en este orden:

1. **Contadores deterministas** (`__softBench`): triángulos rasterizados, píxeles
   recorridos y sombreados. Son exactos y comparables entre sesiones. Si un cambio
   pretende ser exacto, estos números no deben moverse.
2. **Micro-banco aislado** en la consola, para atribuir un cambio concreto. El ruido
   del entorno es de ±25 % y se come cualquier mejora menor del 30 %.
3. **Barrido de resolución** con ajuste de `ms = fijo + porPíxel · píxeles`, para
   saber si lo que estorba es la geometría o el relleno. Las dos veces que me salté
   este paso, optimicé el término equivocado.

## Licencia

Apache-2.0. Copyright 2026 Jesús Galindez. Ver [`LICENSE`](LICENSE).

Sin dependencias en el núcleo. La única opcional, `meshoptimizer`, es MIT y solo se
carga si abres un GLB comprimido con `EXT_meshopt_compression`.
