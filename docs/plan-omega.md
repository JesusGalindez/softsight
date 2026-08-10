# Plan Ω — el banco que un agente opera solo

Los planes anteriores contestaron **qué puede ver y tocar un agente**. Este contesta
otra pregunta, que ya es la que limita: **cuánto le cuesta cada turno y cuánto sabe
antes del primero.**

Un banco puede tener las auditorías perfectas y seguir siendo inoperable para un agente
autónomo si cada consulta cuesta cuatro mil tokens, si descubrir el contrato cuesta diez
mil, si el bucle de veinte turnos son treinta segundos de arranque de procesos, y si
nada de lo verificado lo comprueba una máquina cuando nadie mira. Ninguno de esos cuatro
problemas es de funcionalidad, y por eso ningún plan anterior los ve.

No repite lo que ya está medido en otro sitio. La deuda de eficiencia del núcleo vive en
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5 y aquí solo se le asigna fase; el
reparto de territorios entre procesos vive en [`plan-convergencia.md`](plan-convergencia.md)
§0 y manda.

---

## 0. Lo medido

Todo lo que sigue son medidas de esta máquina —4 núcleos, Node fijado por `.nvmrc`—,
tomadas el 2026-08-09 con el modelo del dron (296 piezas, 37.950 triángulos) y la caché
del CLI caliente. Ningún número de este documento es una estimación.

| Medida | Valor | Cómo se sacó |
|---|---|---|
| Arranque de Node vacío | 0,25 s | `time node -e '0'` |
| Arranque + `import dist-node/agent3d.mjs` | 0,38 s | `time node -e 'import(...)'` |
| `--inspect-only`, caché caliente | **0,23 s** | `/usr/bin/time -p`, mejor de dos |
| `--inspect-only --require-watertight` | **1,62 s** | idem |
| Render completo, seis vistas | 1,53 s | `time`, con `--out` |
| Puente, una petición `schema` | 0,68 s | `node tools/bridge.mjs < req.json` |
| `npm run test:animation` completo | **47,3 s** | 13 ficheros en serie, un núcleo |
| Informe completo (render) | **16.537 B** | `wc -c` sobre stdout |
| Informe `--inspect-only` | 11.358 B | idem |
| `--schema` | **39.657 B** | idem |
| `--help` | 7.388 B | idem |
| `.cache/` en disco | **130 MB**, 59 ficheros | `du -sh .cache` |

Y el desglose del informe completo por clave, que es el dato que decide la Fase Ω1:

| Clave | Bytes | % del cuerpo |
|---|---|---|
| `families` | 4.797 | **45 %** |
| `views` | 2.433 | 23 % |
| `spatial` | 1.094 | 10 % |
| `warnings` | 608 | 6 % |
| resto (23 claves) | 1.693 | 16 % |
| **total** | 10.625 | |

Tres lecturas que no son obvias:

1. **El 86 % de una llamada con contrato de topología es la auditoría, no el proceso.**
   1,62 s menos 0,23 s son 1,39 s de auditar 296 piezas. El coste está donde se decía y
   se paga solo si se pide; correcto. Pero se paga **entero cada vez**, aunque el parche
   haya tocado una pieza.
2. **El 43 % de una llamada barata es arranque de proceso.** 0,10 s de los 0,23 s son
   Node y el módulo. En un bucle de veinte turnos de consulta son dos segundos de nada.
3. **El agente paga `families` en cada turno y casi nunca lo usa.** Es el bloque más
   grande del informe, es prácticamente constante entre turnos —las familias de piezas no
   cambian porque muevas un rotor— y sirve para orientarse la primera vez, no en la
   decimoquinta.

En tokens, que es la moneda del agente: un bucle de veinte turnos sobre el dron son
~330 KB de informes, del orden de **80.000 tokens**, más ~10.000 del `--schema` inicial.
Casi la mitad de eso es el mismo bloque `families` repetido veinte veces.

---

## 1. Lo que está en nivel de referencia y no se toca

Antes de proponer nada conviene decir qué no tiene mejora pendiente, porque el riesgo de
un plan de optimización es romper lo que ya es bueno.

- **El esquema es el validador.** `--schema` imprime el mismo objeto con el que se valida
  la entrada. No puede divergir de la implementación, y una errata sale con sugerencia.
  Esto es más de lo que hace casi cualquier herramienta comparable.
- **La verificación cruzada.** Ninguna fase se cierra por revisión visual: se cierra
  cuando dos implementaciones independientes dan el mismo hash. `test:bvh` compara la
  cinemática contra el evaluador certificado por dos caminos escritos aparte.
- **`contractVersion` atado a la aritmética.** Cambiar un hash obliga a subir la versión,
  así que el olvido se convierte en fallo de puerta.
- **El aviso trae su arreglo.** `fix` como fragmento de parche aplicable tal cual.
- **Cero dependencias en el núcleo.**
- **Los descartes documentados con su medida.** `plan-renderizador.md` guarda las ideas
  que no funcionaron y por qué. Eso es más valioso que las que funcionaron y casi nadie
  lo escribe.

La conclusión de este plan **no** es que falte funcionalidad. Es que la funcionalidad
está envuelta en una superficie cara de consultar, cara de descubrir y no ejecutada por
ninguna máquina.

---

## 2. Los seis huecos

| # | Hueco | Evidencia |
|---|---|---|
| **H1** | El informe no tiene control de verbosidad | 16,5 KB por turno; `families` es el 45 % y es constante |
| **H2** | El contrato cuesta 10.000 tokens descubrirlo | `--schema` son 39.657 B en un solo bloque indivisible |
| **H3** | Proceso por llamada | 0,10 s fijos; el puente lanza un `bridge.mjs` por petición |
| **H4** | **Nada de esto lo ejecuta una máquina** | no existe `.github/`; las 71 comprobaciones corren cuando alguien se acuerda |
| **H5** | No hay entrada para un agente frío | no hay `AGENTS.md` en el repo; la orientación son 5.391 líneas en 12 documentos |
| **H6** | La suite es serial en una máquina de 4 núcleos | 47,3 s encadenados con `&&`, sin tiempos por puerta |

H4 es el más caro de los seis y el más barato de arreglar. Un proyecto cuyo argumento
central es «esto es determinista y se verifica con números» y que no ejecuta esos
números en cada empujón está haciendo una promesa, no una afirmación.

---

## Fase Ω1 — El coste por turno

Objetivo medible: **el turno típico de un agente en bucle baja de 16,5 KB a menos de
2 KB**, sin perder ni un dato que el agente use.

### Ω1.1 `--summary` — el informe que un agente lee en bucle

**Ω1.1 y Ω1.2 hechas el 2026-08-09.** El informe del dron con pliego pasa de **16.493 B a
1.108 B**, un **93 % menos**, con sus dos avisos dentro: por debajo del techo de 2.000 B y
muy por encima del objetivo de la fase. Cinco claves de treinta.

`src/soft/agent/reportView.ts` tiene las dos proyecciones y ninguna aritmética. El CLI
emite el informe por un solo sitio, `emitReport`: con seis ramas escribiendo lo suyo,
`--summary` habría funcionado en cuatro y nadie se habría enterado hasta que un agente
pagara los 16 KB en la quinta.

Dos claves de la lista de este plan **no van dentro, y es correcto**: `exitCode` ya lo
lleva el código de salida del proceso y el sobre de la respuesta del puente, y `budget` lo
declaró el propio agente en la llamada. Meterlas sería un segundo original de cada una.
Se quedan en `SUMMARY_KEYS` por si algún día un informe las trae.

`--fields` valida contra **el informe producido**, no contra una forma declarada: el
informe no tiene esquema propio —lo que publica `--schema` es un ejemplo— y sus claves
dependen de lo que se pidiera. Así que el mensaje distingue la errata de la clave que esta
llamada no produce. `--fields` manda sobre `--summary`.

Puerta `test:summary`: cada clave del resumen `deepEqual` a la del completo, el techo de
2.000 B con `assert`, la proyección con anidamiento, y la ruta inexistente saliendo 2 con
sugerencia en la raíz y dentro. La suite pasa a 15 puertas y 79 comprobaciones.

Una bandera que recorta el informe a lo que cambia entre turnos y a lo que decide el
siguiente paso:

```
contractVersion, exitCode, renderHash, warnings[], warningsDelta, diff, budget
```

Fuera: `families`, `views[].camera`, `partScreenBoxes`, `objects[]`, `spatial` completo
—de `spatial` queda solo lo que ya está resumido en `warnings`—.

No es una vista distinta del informe: es **el mismo informe con un subconjunto de
claves**, para que el consumidor no tenga que aprender dos formas. `contractVersion`
sigue siendo el mismo, porque quitar claves opcionales no rompe a quien lee por versión.

Verificación: una prueba que ejecute la misma entrada con y sin `--summary` y compruebe
que **cada clave presente en el resumen es idéntica —`deepEqual`— a la del informe
completo**. Un resumen que recalcule algo por su cuenta sería un segundo origen del mismo
dato, que es exactamente lo que prohíbe la regla de una fuente por dato.

Presupuesto: `--summary` sobre el dron con dos avisos debe caber en **menos de 2.000 B**.
La prueba lo comprueba con un número, no con un criterio.

### Ω1.2 `--fields` — proyección declarada por el consumidor

`--summary` es una opinión sobre qué necesita el agente. `--fields "warnings,renderHash,spatial.floating"`
deja que el agente lo declare. Se implementa como proyección sobre el objeto ya
construido, con rutas separadas por puntos, y una ruta que no existe en el esquema del
informe es **un error de datos con sugerencia**, igual que hoy `positon` en una escena.

Esto es lo que convierte el banco en algo operable por un agente con presupuesto de
contexto: el agente pide lo que va a leer y no paga lo demás.

### Ω1.3 Registro de códigos de aviso

**Hecha el 2026-08-09.** `src/soft/agent/warningCodes.ts` con los **33 códigos** que
emite el banco, y `Warning.code`, `StoryWarning.code` y `StagingWarning.code` pasan de
`string` a `WarningCode`: emitir un código que no esté en la tabla **no compila**, que es
más fuerte que fallar en ejecución. Sale por `--schema` en `warningCodes`, con `cause`,
`hasFix` y `fixOp` —cuatro códigos traen arreglo: `align`, `delete`, `scale` y
`setPivot`—.

`severity` no se inventó: son las dos palabras que los propios mensajes ya usaban —«Es
certeza, no candidato», «Candidato, no certeza»—. **25 de certeza y 8 candidatos.** La
distinción importa porque un agente que las trata igual acaba «arreglando» piezas que
estaban bien: una malla asimétrica solo está mal si tenía que ser simétrica.

Puerta `test:codes`: el tipo cubre una dirección, pero no ve las entradas que sobran ni
lo que se emita desde un `.mjs`, así que la puerta recorre `src/soft/` con una expresión
regular sobre las dos formas de emitir —`code: "X"` y `add("X"`— y compara los dos
conjuntos en ambos sentidos; y comprueba que lo que publica `--schema` es la misma tabla
y no una copia recortada.

Hoy los códigos —`PIEZA_FLOTANTE`, `MALLA_INVERTIDA`, `ESCALA_HERMANOS`,
`BARRIDO_AUTOINTERSECADO`, `GIRO_AMBIGUO`, `TEXTO_ILEGIBLE`, `ROL_AUSENTE`,
`ROLES_CONSECUTIVOS`, `BORDE_ABIERTO`…— están repartidos por los módulos que los emiten y
no hay un sitio que los liste. Un agente no puede saber qué le puede pasar sin leerse el
código o provocarlo.

Un módulo `warningCodes.ts` con una tabla única: código, severidad, qué lo causa, si trae
`fix` y qué operación. Se publica en `--schema` y **la emisión pasa por él**: emitir un
código que no esté en la tabla es un error de programación, no un aviso raro. Con eso el
agente carga la tabla una vez y sabe interpretar cualquier informe futuro.

Verificación: una prueba que recorra los módulos con `grep` del propio repositorio
buscando literales de código y compruebe que todos están en la tabla. Una tabla que se
mantiene a mano diverge; una tabla comprobada contra el código, no.

### Ω1.4 `--schema` por partes

**Hecha el 2026-08-09.** Y con el orden invertido respecto a lo que decía este plan: en vez
de recortar el completo en partes, **el completo se construye uniendo las partes**. Con un
recorte, la parte se puede quedar atrás del todo sin que nadie lo note; construyéndolo al
revés, meter una clave por fuera de las partes es imposible y la puerta solo tiene que
comprobar que sigue siendo así.

Tamaños medidos, sobre un completo que hoy son **46.226 B** —creció desde los 39.657 de
este documento porque ahora lleva el registro de códigos—:

| Parte | Bytes | Lo que era antes |
|---|---|---|
| `sample` | 940 | 46.226 |
| `story` | 2.161 | 46.226 |
| `staging` | 3.384 | 46.226 |
| `report` | 5.193 | 46.226 |
| `codes` | 6.707 | 46.226 |
| `patch` | 12.321 | 46.226 |
| `scene` | 16.948 | 46.226 |

El agente que solo va a escribir un parche paga **12.321 B en vez de 46.226**, y el que
solo quiere saber qué avisos existen, 6.707. `reportExample` además solo se calcula si se
pide su parte, así que `--schema codes` ya no paga una revisión de la escena de
demostración. Sin argumento sigue devolviendo todo, así que `tools/bridge.mjs` y el editor
no se enteran. Una parte que no existe sale 2 con la lista de las que hay.

39.657 B en un bloque son 10.000 tokens que el agente paga aunque solo vaya a escribir un
parche. `--schema scene|patch|story|staging|sample|report|codes` devuelve la parte, y
`--schema` sin argumento sigue devolviendo todo, para no romper a quien ya lo consume.

Verificación: la concatenación de las partes es `deepEqual` al todo.

---

## Fase Ω2 — Modo residente

**Hecha el 2026-08-09.** `agent3d --serve` atiende peticiones NDJSON con el contrato del
puente sin inventar un campo, y para que no haya dos contratos **importa `handleRequest`
de `bridge.mjs`**: lo único que cambia es `execute`, que en vez de lanzar un proceso llama
al CLI dentro del suyo. Para eso `main` pasa a recibir su `argv` y a **devolver** el código
de salida, y `runAgent(argv)` devuelve los tres datos que devolvía el proceso.

Medido con el dron, mejor de dos vueltas: **0,454 s por petición lanzando proceso contra
0,143 s residente**, un **69 % menos**. No los 0,05 s de este plan, y el motivo es que la
aritmética de aquí no salía: de los 0,23 s de la llamada barata solo 0,10 eran arranque,
así que quitarlo entero deja 0,13 s de trabajo real. Bajar de ahí no es transporte, es
Ω6.

Sobre «el puente pasa a ser cliente del residente»: `bridge.mjs` es de un disparo —lee
stdin una vez y muere—, y con NDJSON por stdin/stdout un proceso así no se puede enganchar
al de otro. Enchufarlo pedía un socket que este plan no pide, así que **el cliente del
residente es quien mantenga la tubería**, que es el servidor MCP de Ω3. `bridge.mjs` se
comporta exactamente como hoy.

**Ω2.2**: `tools/lru.mjs` con el criterio de expulsión escrito una vez —`MemoryLru` por
bytes y `trimDirectory` por mtime—, y los tres consumidores importándolo: la caché del
motor (`SOFTSIGHT_CACHE_MAX_MB`, 256 MB, que **no tenía ninguna política** y llegó a
130 MB en 59 ficheros), la del modelo del puente y la del worker.

Dos cosas de esta fase **no se hacen, con su motivo**:

- **Caché del modelo en memoria en el residente.** Sería lo obvio, pero `applyPatch` muta
  el modelo que devuelve `loadModelCached` y las vistas de `deserialize` apuntan al búfer
  leído: compartirlo entre peticiones significa que el parche de la primera se ve en la
  segunda, un fallo de determinismo silencioso. Devolver una copia cuesta el memcpy de los
  ~5 MB de mallas, más o menos lo que cuesta leer el fichero de la caché de páginas, así
  que no compra nada.
- **Caché de las muestras de superficie con clave `(GLB, semilla)`.** **No hay consumidor
  en este repositorio**: `sampleSurface` con semilla lo llaman el editor y la puerta, y el
  `--sample` del CLI evalúa referencias que ya vienen dadas, no las genera. Se queda donde
  estaba en el mapa §5, sin fase, hasta que alguien lo pague.

Y de paso, la caché del motor escribe y renombra en vez de escribir encima: con la suite
en paralelo hay varios procesos analizando el mismo GLB a la vez.

Objetivo medible: **la llamada barata baja de 0,23 s a menos de 0,05 s**, y el puente
deja de lanzar un proceso por petición.

### Ω2.1 `agent3d --serve` — el CLI que no se muere

Un modo que lee peticiones NDJSON por stdin y escribe respuestas NDJSON por stdout, con
el **mismo contrato que el puente** —que ya existe y ya está probado contra el CLI—. El
módulo se carga una vez, la caché del modelo vive en memoria entre peticiones, y el
proceso se queda.

Lo que **no** cambia: la forma de la petición, la forma de la respuesta, el sandbox. Es
transporte, no contrato. `tools/bridge.mjs` pasa a ser un cliente de este modo cuando
está disponible y sigue funcionando como hoy cuando no.

Verificación: la puerta `test:bridge` ya compara el puente contra el CLI directo caso por
caso. Se extiende con una tercera columna: **CLI directo, puente por proceso y puente
residente producen el mismo informe byte a byte**. Igual que se hizo con la conversión de
BVH por API, CLI y puente.

Riesgo real y cómo se acota: un proceso residente acumula estado, y el estado es enemigo
del determinismo. La prueba que lo cierra es lanzar la misma petición **veinte veces
seguidas** contra el mismo proceso residente y comprobar que las veinte respuestas son
idénticas y que el `renderHash` no se mueve. Si el estado se filtra, se ve ahí.

### Ω2.2 La caché acotada

`.cache/` son 130 MB en 59 ficheros sin política de expulsión. `workerServer.mjs` ya
tiene un LRU acotado por bytes; la caché del CLI no. Se le pone el mismo criterio —LRU
por mtime con techo en MB, configurable por variable de entorno, por defecto 256 MB— y se
reutiliza el código del worker en vez de escribir un segundo.

Y se amplía a lo que hoy no cachea, que ya está identificado en el mapa §5: las muestras
de superficie, con clave `(GLB, semilla)`.

---

## Fase Ω3 — MCP: la superficie nativa

**Hecha el 2026-08-09.** `tools/mcp-server.mjs`, JSON-RPC 2.0 por stdio y sin dependencias,
con las siete herramientas sobre el modo residente: llama a `handleRequest` con el ejecutor
en proceso, así que no lanza un proceso por herramienta.

Las tres reglas se cumplen y se comprueban:

1. El servidor traduce y no decide. `softsight_inspect` trae `summary: true` por defecto
   —que es una elección de la herramienta, no un cálculo—, y lo demás pasa tal cual.
2. `toJsonSchema` en `schema.ts` traduce `SCENE_SCHEMA`, `PATCH_SCHEMA` y `STORY_SCHEMA` a
   JSON Schema. Vive **al lado de `typeMatches`** a propósito: traduce exactamente el
   vocabulario de `type` que esa función reconoce, y separarlos sería garantizar que se
   despeguen.
3. `test:mcp` compara cada herramienta contra el CLI directo —informe, pliego y GLB byte a
   byte— y comprueba que el esquema publicado es la traducción de `SCENE_SCHEMA`, no una
   copia.

Dos cosas que la fase necesitaba y no estaban: `summary` y `fields` como opciones del
puente, y `part` en su comando `schema`. Añadir opciones no rompe a nadie, así que
`bridgeContractVersion` sigue en 1, igual que cuando entraron los comandos `scene` y
`story`.

La única traducción que hace el servidor es leer del disco los ficheros que el puente
quiere en base64: un agente que llama por MCP tiene rutas, y obligarle a codificar 2 MB de
GLB en el argumento haría la herramienta inutilizable. El sandbox del puente sigue entero
detrás.

Aquí está el salto de nivel, y conviene decir por qué no es una moda.

Softsight está **diseñado** para agentes —lo dice el README en la primera línea— y se
expone por una CLI con 30 banderas y un puente JSON. Un agente que se encuentra el
repositorio tiene que: leer 7.388 B de `--help`, decidir qué banderas combina, construir
una línea de órdenes, ejecutarla, y parsear 16 KB de JSON. Cada uno de esos pasos es una
oportunidad de equivocarse, y ninguno de esos errores lo caza el esquema, porque el
esquema valida la **entrada**, no la **invocación**.

Un servidor MCP convierte cada comando en una herramienta con su esquema de parámetros,
que el agente descubre y que el runtime valida antes de llamar. Las banderas dejan de ser
prosa y pasan a ser tipos.

Diseño mínimo, `tools/mcp-server.mjs`, sobre el modo residente de Ω2:

| Herramienta | Envuelve | Devuelve |
|---|---|---|
| `softsight_inspect` | `--model --inspect-only` | informe (`--summary` por defecto) |
| `softsight_render` | `--model/--scene --out` | informe + PNG |
| `softsight_patch` | `--patch --baseline --undo` | informe + diff |
| `softsight_scene` | `--scene` | informe + pliego + GLB |
| `softsight_story` | `--story` | hechos |
| `softsight_bvh` | `--bvh --export` | GLB |
| `softsight_schema` | `--schema <parte>` | la parte pedida |

Tres reglas que evitan que esto se convierta en un tercer contrato:

1. **El servidor MCP no decide nada.** Traduce la llamada a una petición del puente y
   devuelve lo que el puente devuelve. Igual que el puente respecto al CLI.
2. **Los esquemas de parámetros se generan** de `SCENE_SCHEMA`, `PATCH_SCHEMA` y compañía.
   No se escriben a mano. Una tabla escrita a mano divergiría en la primera bandera nueva.
3. **La puerta lo comprueba.** `test:mcp` ejecuta cada herramienta y compara contra el
   CLI directo, igual que `test:bridge`.

El agente que llega por MCP no lee `--help`, no construye líneas de órdenes y no paga el
`--schema` completo: recibe siete herramientas tipadas y un resumen de 2 KB por llamada.
Ese es el nivel del que habla el encargo.

---

## Fase Ω4 — CI: que la afirmación la ejecute una máquina

**Hecha el 2026-08-09.** `.github/workflows/verify.yml` con los tres trabajos, la
versión de Node por `node-version-file: .nvmrc`, y `npm run verify` encadenando lo mismo
en local. El pliego del dron da `renderHash.sheet` **`46228b7c`** con `contractVersion` 3,
fijado en `artifacts/agent/render-hashes.json` desde una ejecución real; la puerta
`test:determinism` lo renderiza dos veces, compara las dos ejecuciones entre sí y después
contra el fichero.

Lo que destapó, y es el hallazgo de la fase: **cinco de las trece puertas no pueden correr
en CI**. `animation-contract`, `glb-loader`, `sample-surface`, `glb-writer` y `bridge` leen
`jumping-jacks.glb` y sus referencias de `public/fixtures/` del editor, que es
`softsight-motion-editor` y es **privado**, mientras que `softsight` es público. Las tres
salidas eran: un token en secreto —que rompe cualquier PR de un tercero y ata el fixture a
algo que caduca—, copiar los fixtures aquí —un segundo original de un dato cuyo dueño
declara el mapa §3— o decirlo. Se dice: `tools/fixtures.mjs` resuelve la ruta en un solo
sitio (`SOFTSIGHT_FIXTURES` la sustituye; antes estaba copiada en los cinco ficheros) y,
si el fixture falta, la puerta imprime `no ejecutada — falta el fixture certificado …` y
sale 0. **El verde de CI cubre tipos, determinismo en dos sistemas y 8 de 13 puertas**, y
el registro de la ejecución enseña las cinco que faltaron. Un cero silencioso habría sido
peor que el rojo.

Pendiente de medir: si `ubuntu-latest` y `macos-latest` dan el mismo `46228b7c`. Si
divergen se anota aquí con los dos hashes y se para, que es justo el riesgo que `.nvmrc`
intenta cubrir.

**Es el hueco más caro y el más barato de cerrar.** Existe toda la infraestructura de
verificación —71 comprobaciones, gates cruzados, hashes de control— y no la ejecuta nada
automáticamente.

`.github/workflows/verify.yml`, con la versión de Node tomada de `.nvmrc` —que ya existe y
ya está fijada por la razón correcta, `Math.sin` no está especificado al último bit— y
tres trabajos:

1. **`types`** — `tsc --noEmit`. Es el más rápido y falla primero.
2. **`gates`** — `npm run test:animation` entero, con los tiempos por puerta de Ω6.
3. **`determinism`** — el trabajo que justifica el proyecto: ejecutar el pliego del dron
   **dos veces en la misma máquina** y comprobar que el `renderHash` es idéntico; y
   comparar contra un `renderHash` **fijado en el repositorio** para detectar la deriva
   entre versiones de Node, que es exactamente el riesgo que `.nvmrc` intenta cubrir y que
   hoy no comprueba nadie.

El tercero se puede extender a matriz de sistemas operativos —`ubuntu-latest` y
`macos-latest`— y ahí la afirmación de determinismo deja de ser una política y pasa a ser
un hecho medido en dos aritméticas distintas. Si divergen, eso **es** información valiosa
y hay que saberlo, no evitarlo: se documenta el resultado como se documentaron los
descartes por medida.

Añadir además un `npm run verify` que encadene lo mismo en local, para que el desarrollo y
CI ejecuten literalmente la misma orden y no dos listas que se desincronizan.

---

## Fase Ω5 — La entrada del agente frío

**Hecha el 2026-08-09.** `AGENTS.md` en la raíz, **110 líneas de las 120** de techo, con
las cuatro identidades y la regla de dónde va un cambio, las tres invariantes, cómo
descubrir el contrato por partes, y punteros —no copias— al mapa, al README y a los planes.

Se generan **tres** bloques, no dos: comandos y puertas de `package.json`, y además las
**banderas del CLI de la salida de `--help`**, que es el sitio donde una lista escrita a
mano envejece más rápido. `tools/agents-md.mjs` los reescribe y `--check` sale 1 si el
fichero commiteado no es idéntico al regenerado **o si pasa de 120 líneas**: un techo que
nadie comprueba no es un techo.

La lista de puertas va en una línea y no en tabla. Con tabla eran 17 líneas para decir lo
que ya está en `package.json`, y el techo se lo comía la propia tabla.

Un agente que abre este repositorio hoy tiene delante 609 líneas de README y 12
documentos con 5.391 líneas. Todo bueno, todo denso, y nada de ello dice en veinte líneas
**qué orden ejecutar primero**.

`AGENTS.md` en la raíz, corto a propósito —el techo es 120 líneas—, con exactamente esto:

- La orden que verifica todo: `npm run verify`.
- Las cuatro identidades del repositorio (mapa §2) en cuatro líneas, con la regla de dónde
  va un cambio.
- La orden de descubrimiento: `--schema <parte>`, y el registro de códigos.
- Las tres invariantes que rompen el producto si se tocan sin querer: matrices por filas
  en `math.ts`, `validate` rechaza claves desconocidas, y cambiar la aritmética obliga a
  subir `contractVersion`.
- Punteros al mapa y a los planes. **Punteros, no copias.**

Y el punto que lo hace mantenible: **la lista de puertas y la de comandos se generan**.
Un script `tools/agents-md.mjs` lee `package.json` y la salida de `--help`, y regenera las
dos secciones marcadas entre delimitadores. Una prueba comprueba que el fichero
commiteado es igual al generado. Un `AGENTS.md` escrito a mano es un documento que miente
tres commits después; es el mismo error que el esquema evita y aquí se evita igual.

Nota de frontera: `~/AGENTS.md` global del usuario y este son cosas distintas. Este habla
del repositorio, no del estilo de trabajo.

---

## Fase Ω6 — El núcleo: la deuda de eficiencia, con fase asignada

**Ω6.2 y Ω6.3 hechas el 2026-08-09**, y son el resultado más grande de todo el plan:

| Medida | Antes | Después |
|---|---|---|
| `sample-surface` (pared) | **50,4 s** | **0,8 s** |
| `sample-surface` (CPU) | **26,2 s** | **0,88 s** |
| Suite entera (pared) | 61 s con 13 puertas | **34,5 s con 17** |

**Ω6.3** —los accesores leídos una vez por GLB en vez de una por llamada— es la que trae
casi todo. Evaluar la pose, las normales y una muestra del mismo fotograma releía las
mismas matrices inversas de atado tres veces, y cuatro fotogramas eran doce lecturas de lo
mismo: 128 evaluaciones completas de la malla con skin. La caché es un `WeakMap` sobre
`decodedViews`, que es el objeto que identifica un GLB analizado.

**Ω6.2** —áreas y pesos √área en `Float64Array` una vez por GLB— baja de 2,3 s a 0,8 s lo
que quedaba: tres muestreos del mismo GLB eran tres recorridos idénticos de todos los
triángulos.

Ninguna de las dos podía mover un número, y no lo movió: `renderHash.sheet` del dron sigue
en `46228b7c`, las 86 comprobaciones en verde y las huellas de muestreo iguales. La razón
por la que se podía afirmar antes de medir: los arrays de `readAccessor` ya se compartían
dentro de una llamada, así que nadie los escribe; y `Math.sqrt(area)` guardado en un
`Float64Array` es el mismo bit que el número de JS. Y se dejó **a propósito** el recorrido
lineal del muestreo en vez de una suma acumulada con búsqueda binaria: sería más rápido y
cambiaría el triángulo elegido en el borde.

**Ω6.4 no está en este repositorio.** `create-sample-contract.mjs` vive en el editor; aquí
no hay ningún `AnimationMixer`. Se queda para quien tenga ese árbol.

**Efecto sobre Ω7**: con la puerta gorda abaratada, dos procesos ya ganan —44,5 s contra
35,9, y 41,5 contra 32,1 en la vuelta siguiente—, pero es un **20 %, por debajo del 30 %
que el ruido de esta máquina permite afirmar**. El reparto sigue apagado por defecto.

Las cuatro que el mapa §5 tiene identificadas sin fase, ordenadas por lo que devuelven:

| # | Trabajo | Medida objetivo |
|---|---|---|
| Ω6.1 | Auditoría de topología **incremental**: audita solo las piezas que el parche tocó y hereda el resto del informe anterior | 1,39 s → proporcional a las piezas tocadas |
| Ω6.2 | Precomputar áreas y pesos √área en `Float64` una vez por GLB | hoy se recalculan en cada llamada a `sampleSurface` |
| Ω6.3 | Reutilizar `decodedViews` entre frames; hoy los skins leen las mismas IBM cuatro veces | pose, normales y muestra comparten lectura |
| Ω6.4 | Un solo `AnimationMixer` por lote en `create-sample-contract.mjs` | hoy uno por frame |

Ω6.1 es la que cambia el bucle del agente y la que hay que hacer con cuidado, porque
introduce un camino que puede dar un resultado distinto al completo. La regla: **solo se
activa con `--baseline-report`**, que es donde el agente ya declara que hay un estado
anterior, y la puerta compara el informe incremental contra el completo sobre el mismo
par de escenas —tienen que ser `deepEqual`—. Si no se puede afirmar eso, no se hace: una
auditoría más rápida que a veces miente vale menos que ninguna.

Regla de las tres herramientas de `README.md` («cómo medir antes de optimizar»): aquí
manda igual. Ninguna de estas cuatro se da por buena sin el contador determinista antes y
después. El ruido del entorno es de ±25 %.

---

## Fase Ω7 — La suite

**Hecha el 2026-08-09, y con las tres premisas refutadas por la medida.**
`tools/run-tests.mjs` da los dos números que no había —tiempo por puerta y recuento de
comprobaciones, **72**, contando las líneas `: ok` que emiten las propias puertas— y
`test:animation` pasa a invocarlo. Los `test:*` sueltos se quedan.

Lo que salió al medir, que es lo que valía la fase:

1. **No había doce compilaciones redundantes.** `test:animation` ya compilaba **una vez**
   y encadenaba trece `node`. Las que compilan por su cuenta son los `test:*` sueltos, que
   existen justo para eso. El «1,6 s × 13» de este plan estaba mal leído.
2. **Una puerta es la suite.** `sample-surface` cuesta **26,2 s de CPU de los ~44 s** del
   total —el 62 %—, `bridge` otros 9,5 s, y las once restantes juntas menos de 8 s. Son
   128 evaluaciones completas de la malla con skin releyendo las mismas IBM: exactamente
   lo que persiguen Ω6.2 y Ω6.3.
3. **La máquina tiene dos núcleos físicos**, no cuatro. `availableParallelism()` cuenta los
   cuatro lógicos de un i5-5350U. Con la puerta gorda ya limitada por memoria, repartir no
   da nada y desde tres procesos resta: **61 s en serie contra 89 s y 109 s con cuatro
   procesos**, dos vueltas. Muy por encima del ±25 % de ruido, así que la regresión se
   puede afirmar.

Conclusión, y queda como descarte con su medida igual que los de `plan-renderizador.md`:
el reparto **viene apagado**, `SOFTSIGHT_TEST_JOBS` lo enciende, y **el objetivo de bajar
de 20 s no lo desbloquea el paralelismo sino abaratar `sample-surface`**. Se revisa cuando
Ω6.2 y Ω6.3 estén hechas, que es cuando las once puertas pequeñas pasan a mandar.

Medido hoy con el reparto apagado: **84,1 s** en local —esta máquina se degrada por
temperatura a lo largo de la sesión, el mismo trabajo dio 61 s al empezar y 84 s al
acabar, así que el número de pared de esta máquina no sirve para afirmar nada y el que
manda es el de CPU—; y **22,2 s en CI**, donde las cinco puertas que dependen del fixture
del editor no corren.

47,3 s en serie, 13 ficheros, 4 núcleos, y **una sola compilación repetida trece veces**:
cada script `test:*` empieza por `npm run build:agent3d`, que son 1,6 s.

1. Un `tools/run-tests.mjs` que compila **una vez**, reparte los 13 ficheros entre
   `min(4, núcleos)` procesos y agrupa la salida por fichero.
2. **Tiempo por puerta** en la salida. Hoy no se sabe cuál de las trece cuesta la mitad
   del total, y sin ese dato no se puede optimizar la suite.
3. **Recuento de comprobaciones automático.** El mapa §5 dice «71 comprobaciones» con la
   nota de que el número sale de contar líneas `ok` a mano. La suite debe imprimir el
   recuento y CI publicarlo, para que el mapa deje de llevar un número que envejece.

Objetivo: **por debajo de 20 s**. No es una cifra inventada: 47,3 s menos las doce
compilaciones redundantes son ~28 s, repartidos entre 4 núcleos con el reparto más
desfavorable dan por debajo de 20.

---

## Orden

Cada punto deja el repositorio verde antes de pasar al siguiente. El orden no es por
tamaño: es por lo que desbloquea a lo siguiente.

1. **Ω4 (CI)** — primero, siempre. Sin esto, todo lo demás se verifica a mano y el plan
   entero se apoya en que alguien se acuerde. Es medio día.
2. **Ω7 (suite)** — porque CI ejecuta la suite y 47 s por empujón se paga en cada uno.
3. **Ω1 (coste por turno)** — el retorno más directo para el agente. Ω1.3 (registro de
   códigos) antes que Ω1.1, porque el resumen se define en términos de códigos.
4. **Ω5 (`AGENTS.md`)** — cuando Ω4 y Ω7 existen, porque la sección generada los cita.
5. **Ω2 (residente)** — necesita el contrato del puente estable, que ya lo está.
6. **Ω3 (MCP)** — se apoya en Ω2 y en Ω1.4. Hacerlo antes obligaría a rehacerlo.
7. **Ω6 (núcleo)** — al final, y con la regla de siempre: medir antes de optimizar. Es lo
   único de este plan que puede cambiar un número, y por eso va cuando la red de
   seguridad está entera.

---

## Cómo se verifica cada cosa

Ninguna fase se cierra por revisión visual. Igual que las anteriores.

| Fase | Puerta | Qué compara |
|---|---|---|
| Ω1.1 | `test:summary` | cada clave del resumen `deepEqual` a la del informe completo; resumen del dron < 2.000 B |
| Ω1.2 | `test:summary` | proyección de rutas válidas; ruta inexistente rechazada con sugerencia |
| Ω1.3 | `test:codes` | todo código emitido en `src/` está en la tabla, y al revés |
| Ω1.4 | `test:schema` | la concatenación de partes es `deepEqual` al `--schema` completo |
| Ω2.1 | `test:bridge` (extendida) | CLI, puente por proceso y puente residente, byte a byte; 20 peticiones iguales dan 20 respuestas iguales |
| Ω2.2 | `test:model-cache` (extendida) | el LRU expulsa por techo y la invalidación manda sobre la caché |
| Ω3 | `test:mcp` | cada herramienta contra el CLI directo |
| Ω4 | el propio CI | dos ejecuciones dan el mismo `renderHash`; y coincide con el fijado en el repositorio |
| Ω5 | `test:agents-md` | el fichero commiteado es igual al generado |
| Ω6.1 | `test:incremental` | informe incremental `deepEqual` al completo sobre el mismo par |
| Ω6.2–4 | contadores de `__softBench` | los contadores deterministas **no se mueven**; solo el tiempo |
| Ω7 | la propia suite | mismo conjunto de comprobaciones, recuento impreso, < 20 s |

---

## Lo que no se hace, y por qué

Tan importante como la lista de arriba, y por la misma razón que
`plan-renderizador.md` guarda los descartes.

- **No se reescribe el rasterizador en WASM ni en Rust.** El argumento del producto es
  «sin GPU y sin dependencias, el mismo código en navegador y en Node». Un núcleo en WASM
  mete una cadena de compilación y rompe la portabilidad que es el producto. Si algún día
  el relleno es el cuello de botella medido, se mide primero con el barrido de resolución.
- **No se paraleliza el render del CLI por defecto.** `parallel.ts` existe para el
  navegador. Meter hilos en la ruta que produce los hashes es la forma más rápida de
  perder el determinismo, que es el activo.
- **No se unifican los dos parsers de GLB** (B-R2 del mapa §5). Sigue aparcado: no hay
  consumidor que lo pague.
- **No se añade caché entre peticiones al modo residente más allá del modelo.** Cachear
  informes en un proceso vivo es la vía más corta a devolver un informe de una escena que
  ya cambió. El worker HTTP ya cachea por hash de la petición completa, que es la única
  clave defendible.
- **No se traduce el proyecto al inglés.** El README ya tiene su cabecera en inglés y el
  resto es coherente. Traducir 5.391 líneas crea dos originales, que es la avería que la
  regla de una fuente por dato existe para evitar.
- **No se añade telemetría ni analítica.** Un banco de verificación que llama a casa deja
  de ser un banco de verificación.

---

## Qué queda fuera de este plan y hay que decidir aparte

Trabajo sin commitear en la rama `fase-f-puesta-en-escena` en el momento de escribir
esto: `src/soft/text-plan.ts` y `tools/text-plan.test.mjs` sin seguir, y modificaciones
en `package.json`, `src/soft/agent/index.ts` y `src/soft/renderer.ts`. El primer efecto de
Ω4 será que CI falle o pase sobre un árbol que no está cerrado. **Se cierra ese trabajo
antes de empezar Ω4**, no durante.

**Cerrado el 2026-08-09** en el commit `54f1eae`, con `test:text-plan` y `test:animation`
en verde. Queda una cosa dicha y no hecha a propósito: `test:text-plan` **no entra en
`test:animation`**, así que la puerta del cartel existe y CI no la ejecuta. Meterla ahí
habría cambiado el recuento de comprobaciones justo antes de que Ω7 lo fije, que es la
forma más rápida de que la puerta de Ω7 no signifique nada. Se decide después de Ω7.
