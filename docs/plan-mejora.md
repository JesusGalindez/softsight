# Plan de mejora — el banco que no se contradice, y el agente que no paga por recordar

Escrito el 2026-11-17 sobre `main` en `aa2e09f`, con el encargo 05-A sin commitear
encima, tras revisar entero el repositorio: código, puertas, CLI, puente, MCP y
documentos.

`plan-agentes.md` contestó **qué puede ver y tocar un agente**; `plan-omega.md`,
**cuánto le cuesta cada turno**. Este plan sale de volver a medir hoy lo que aquellos
dejaron medido en agosto: **tres de esos números han vuelto a crecer**, la superficie
pensada para agentes —MCP— es **la única desde la que no se cierra el bucle
principal**, y **el estado escrito en prosa se contradice de un documento a otro**.

**Estado, 2026-11-17 (noche): fases 0 a 5 hechas, salvo 0.4.** Las 0 a 3
están en `main` (PR #1 y #2); la 4 y la 5, en `mejora/fases-4-5`; R8 (5.3), en
`mejora/r8`, apilada sobre ella. Los recuentos ya no
se escriben aquí: los da `node tools/agent3d.mjs --status`. Lo que se movió:

| Medida | Antes | Ahora |
|---|---|---|
| `verify` | rojo, 57 de 58 | **verde, 60 de 60** |
| «no ejecutadas» en el resumen | 32 | **2** de verdad, y 31 límites declarados aparte |
| Puerta muda (sale 0 sin comprobar nada) | verde | **roja** |
| MCP `tools/list` | 41.204 B, 11 herramientas | **11.084 B, 14** — no llega a los 6 KB del plan: las opciones tipadas son la mayor parte |
| Comandos del puente sin herramienta | 3, sin que nadie lo viera | **0**, y la puerta lo comprueba |
| Error de datos por MCP | error JSON-RPC | resultado con `isError` y su sugerencia |
| Patch por MCP con raíz de salida | sin baseline posible | baseline por ruta; 39.794 B contra 102.297 en línea |
| Compilación vieja | servida en silencio | aviso en CLI, puente y residente; `isError` en MCP |
| Bucle interno | la suite entera | `verify:rapido`: 1 puerta para `meshPartition.ts`, ninguna para la demo |
| Reparto en dos procesos (2.2) | descartado con 17 puertas | **descartado otra vez**: 7–12 % con 60, por debajo del 30 % |
| Bucle editar-mirar por MCP (3.1) | el agente guarda pliego e informe y se los pasa | `softsight_open/apply/undo/export`: turno 0 en 0,84 s, cada turno siguiente en ~0,33 s con el dron |
| Equivalencia de la sesión | — | N turnos ≡ el CLI lanzado aparte con su propia cadena, pliego byte a byte |
| K variantes (3.2) | K llamadas y K informes | `softsight_sweep`: una llamada, una tabla, la frontera; base y 4 variantes del dron sin pliego en 0,22–0,39 s, sin dejar entradas en `.cache/` |
| MCP `tools/list` | 11.084 B, 14 herramientas | 16.632 B, 19: el techo sube a 17.500 a propósito |
| Entrada de un agente frío (4.1) | ~134 KB de documentos | `--status`: 2.375 B, generado de sus fuentes |
| Recuentos escritos a mano (4.2) | se contradecían entre documentos | generados; uno a mano en lo vigilado pone `test:estado` rojo |
| Mapa §5 (4.3) | 55 KB de diario | 4,6 KB de lo abierto; el diario, íntegro, en `historial.md` |
| Medidas de reconstrucción en CI (5.1) | solo el pliego del dron | también `cube-v1`: medidas, cobertura y confianza, en los dos sistemas |
| Reparto de piezas (5.2) | solo una función exportada | `--partition`, `partition`, `softsight_partition`, `--schema partition` y barrido de repartos |

0.4 no se hizo: el encargo 05-A no se puede escribir sin quien lo encargó, y
inventar sus §2.1 y §2.2 sería falsificarlo.

No repite lo que está en otro sitio. El estado lo sigue llevando el §5 de
[`mapa-del-proyecto.md`](mapa-del-proyecto.md); aquí van el orden, el criterio y cómo
se verifica cada cosa. Y aplica por primera vez la regla del §86.4 (r) de
[`plan-reconstruccion.md`](plan-reconstruccion.md), que seguía sin aplicarse: cada
ítem dice si mueve `contractVersion`, `bridgeContractVersion` o el pin del editor.

---

## 0. Lo medido hoy

Esta máquina —i5-5350U, dos núcleos físicos, Node 24.13.0—, el 2026-11-17. Al lado de
cada cifra va la orden que la reproduce; ninguna es una estimación.

| Medida | En agosto (plan Ω) | Hoy | Cómo |
|---|---|---|---|
| `npm run verify` | verde | **rojo: 57 de 58 puertas** | `npm run verify` |
| Suite | 34,5 s, 19 puertas | **111,6 s, 58 puertas, 339 comprobaciones** | idem, última línea |
| `--schema` completo | 46.226 B | **64.026 B** (+38 %) | `node tools/agent3d.mjs --schema \| wc -c` |
| `--schema patch` | 12.321 B | **18.881 B** (+53 %) | idem con `patch` |
| `--help` | 7.388 B | **10.745 B** | `node tools/agent3d.mjs --help 2>&1 \| wc -c` |
| MCP `tools/list` | — | **41.204 B**: `scene` 20.427, `patch` 14.237 | `tools/list` por stdio a `tools/mcp-server.mjs` |
| Una llamada a `softsight_render` | — | 1.560 B de informe **+ 220.196 B de PNG en base64**, siempre | `tools/call` sobre el dron |
| Lectura previa que manda el encargo 01 §0 | — | **~134 KB**, de los que el mapa §5 son 55 KB | `wc -c` por sección |
| Documentación | — | 744 KB en 22 ficheros | `du -ch docs/*.md README.md` |
| Disco libre | 100 % lleno el 2026-08-04 | **2,2 GB, 98 % usado** | `df -h ~` |
| `.cache/` | 130 MB | 279 MB, 429 ficheros (topes: 256 + 256 + 64 MB) | `du -sh .cache` |

Lo que **no** se movió, y va primero porque es lo que no hay que romper: ningún hash.
El núcleo, la verificación cruzada por dos caminos, el esquema que es el validador y
el registro de decisiones siguen siendo lo mejor del proyecto. El §1 de
`plan-omega.md` sigue valiendo entero y nada de este plan lo toca.

---

## 1. Los hallazgos

### H1 — El árbol está en rojo, y el arreglo dejaría una puerta muda

`tools/mesh-partition.test.mjs:218` espera 8 aristas de costura y mide 14. **El fallo
es del fixture, no de `meshPartition.ts`.** En `bodyWithRing`,
`ring.push(base / 3 + q * 2, …)` usa `base`, que cuenta **vértices** emitidos
(`base += fp.length / 3`), como si contara **triángulos**. Sale 135 donde tocaba 640:
el anillo cae en la cara 1, y con desfase impar, así que cada par junta medio cuadrado
con medio del vecino y no forma un bloque. De ahí 14 y no 8. Con el desplazamiento en
triángulos —`triBase += fi.length / 3`—, probado sobre una copia fuera del
repositorio, los seis bloques pasan.

Pero la puerta **no imprime ninguna línea `: ok`**, y `run-tests.mjs` cuenta
comprobaciones por esas líneas sin exigir ninguna. Arreglada, saldría
`✓ mesh-partition.test.mjs 0 comprobaciones`, en verde. Es el hueco que describe D22:
una puerta que sale verde sin decir qué comprobó.

Y el código cita los §2.1 y §2.2 del encargo 05-A, **que no está escrito en ningún
sitio** —ni en el repositorio ni en `~/Documents`—. Con la regla de
`contrato-videomesh.md`, lo que no está escrito no existe.

### H2 — «No ejecutada» significa dos cosas, y el resumen las suma

La suite termina diciendo «32 no ejecutadas». Esas 32 puertas **corrieron enteras**.
De sus 32 líneas `no ejecutada —`, **dos** son saltos de verdad —los escalones que
piden `SOFTSIGHT_HEAVY=1` en `bounds-tree` y `resources`— y las otras treinta declaran
un límite de alcance: «no repara nada, y no va a hacerlo», «no propone un proxy».
`run-tests.mjs:157` las junta con un `includes`.

Un agente que lea el resumen concluirá que medio banco no corrió. Uno que aprenda a
ignorarlo lo ignorará también el día que una puerta deje de correr de verdad.

### H3 — El coste de descubrir ha vuelto, por la puerta de MCP

El plan Ω abarató el descubrimiento partiendo `--schema`. El servidor MCP lo deshace:
`tools/list` incrusta `SCENE_SCHEMA` y `PATCH_SCHEMA` enteros en dos herramientas y
pesa **41 KB**, que el cliente carga en el contexto **al abrir cada sesión**, se usen
o no. Es el H2 de `plan-omega.md` otra vez, y peor: antes se pagaba al pedir el
esquema; ahora se paga al conectar.

Y `--schema` creció un 38 % desde que se partió. El problema no era solo el troceo:
nada impide que crezca.

### H4 — El bucle A1 no se cierra por MCP

El bucle del banco es renderizar, parchear y comparar con el pliego anterior. Por MCP:

- `softsight_render` devuelve el PNG **como imagen en línea** —220 KB en base64 en
  cada llamada, se quiera mirar o no— y **no deja ningún fichero**;
- `softsight_patch` pide `baseline` como **ruta en disco**.

Un agente que solo tenga MCP no puede pasarle a `patch` el pliego que le devolvió
`render`. Con `baselineReport` pasa lo mismo. La superficie diseñada para agentes es
justo la única desde la que el bucle principal no se cierra.

### H5 — MCP no cubre el puente, y no sigue el protocolo en los errores

- **Faltan tres comandos del puente**: `diff` —el que contesta «¿este pase mejoró o
  derivó?»—, `sample` y `staging`. Además `softsight_scene` no acepta `patches`,
  aunque el puente sí. Nada lo comprueba: `test:mcp` cuenta «once herramientas, ni
  una más», pero no las compara con `COMMANDS`.
- **Los errores de datos salen como error JSON-RPC** (`-32000`). Un guion con
  `titulo` en vez de `title` vuelve como fallo de protocolo, no como resultado. El
  protocolo pide que los errores de ejecución vayan dentro del resultado con
  `isError: true`, que es lo que el modelo lee para corregirse; hay clientes que no
  le enseñan los errores de protocolo. El comentario de `callTool` habla de
  `isError`, pero el código no lo pone nunca.
- **Protocolo `2024-11-05`**: no hay `structuredContent` ni `outputSchema` —el informe
  tiene forma fija y se entrega como texto—, no hay `annotations` —`readOnlyHint`,
  `idempotentHint`, y la idempotencia es literalmente el producto— y no hay recursos
  ni prompts.
- **La lista de partes de `softsight_schema` está escrita a mano**, a pocas líneas de
  un comentario que dice «ni una tabla a mano».

### H6 — El estado escrito en prosa se contradice

La regla de la casa es una fuente por dato, y los números de estado escritos en prosa
la incumplen. Hoy:

| Afirmación | Dónde | Lo que hay |
|---|---|---|
| CI cubre «16 de 21 puertas» | `AGENTS.md:97` | 58 puertas |
| «23 de las 28 puertas», «28 puertas» | mapa §4 | 58 |
| «siete herramientas» MCP | `README.md:288`, mapa §4 y §5.18 | 11 |
| «De VideoMesh, que no existe» | mapa §5.21 | contrato §2: «VideoMesh construyó su mitad» (`f63b668`, `016e413`) |
| D12 «IMPLEMENTADA a medias» | título de D12 | la tabla del §2 la cuenta entre las 31 IMPLEMENTADAS |

`test:agents-md` comprueba los bloques generados y el techo de líneas; la prosa de al
lado no la mira nadie. Y `AGENTS.md` va por 119 de 120 líneas: no cabe ni un puntero
más.

Luego está el coste. El encargo 01 manda leer ~134 KB antes del primer comando, y casi
la mitad es el mapa §5, que es un diario y no un estado: un agente frío lee 55 KB para
enterarse de que «del dueño no queda nada».

### H7 — El CLI sirve lo último que se compiló, no lo último que se escribió

`tools/agent3d.mjs`, el puente y el servidor MCP importan `dist-node/agent3d.mjs` sin
comprobar que sale de los `src/` actuales. `AGENTS.md` recomienda llamar a
`node tools/agent3d.mjs` sin más. Un agente que edita `src/` y llama así recibe el
comportamiento de antes, sin aviso. Para un banco cuyo valor está en que sus números
son ciertos, es el peor fallo posible: un número plausible y falso.

### H8 — La suite tarda el triple, y el agente la paga entera

Ha pasado de 34,5 s a 111,6 s con el triple de puertas. Las más caras son `bridge`
(16,4 s) y `producer-superficie` (11,8 s), y cada `test:*` suelto recompila (3,6 s).
El descarte del reparto en paralelo de Ω7 se midió con 17 puertas y una que dominaba;
hoy hay 58 y casi todas tardan 1–2 s, que es justo la forma en que dos procesos sí
ganan. **El descarte describe una suite que ya no existe.**

### H9 — D28 dice que no hay segunda plataforma, y CI la tiene

D28 sigue ACORDADA porque «esta máquina es Darwin x86_64 y no hay docker». Pero el
trabajo `determinism` de CI corre desde el 2026-08-09 en `ubuntu-latest` (x86_64) y
`macos-latest` (arm64): **dos sistemas y dos arquitecturas**. Solo compara el pliego
del dron y nada de reconstrucción. La mitad de D28 que «no tiene dónde» tiene dónde.

### H11 — El veredicto de R9 no es dominancia con tres candidatos o más

Encontrado el 2026-11-17 al mover la regla de decisión a `src/soft/agent/dominance.ts`
para que el barrido no la copiara. `compareCandidates` corona al que es el mejor de
**cada criterio decidido**, y un criterio cuyo mejor valor comparten dos candidatos se
declara EMPATE y se cae. Con dos candidatos eso es dominancia; con tres, no: puede
ganar uno que en el criterio caído es **peor** que los otros dos. Con los números del
dron —la base y «movido» empatan a 296 piezas, «sin-bujes» tiene 292—, la regla
coronaría a «sin-bujes». Contradice la cabecera del propio módulo: «gana quien es mejor
o igual en todos».

**No se cambió**: es el veredicto del cruce de candidatos y tiene consumidor fuera, así
que alinearlo es decisión de quien lo consume. El barrido, que es de muchos, decide por
la frontera de Pareto, y `test:sweep` deja escrito el caso: si R9 se alinea, la puerta
avisa para reescribir la nota.

### H12 — El consejo de captura no es reproducible al bit dentro de un mismo proceso

Encontrado el 2026-11-17 porque `test:recon-cache` salió rojo en una `verify` y verde
al repetirla. La puerta mide el mismo paquete dos veces —en frío y con la caché de
visibilidad caliente— y exige el mismo informe byte a byte. A veces no lo es:
`captureAdvice.suggestions[k].distance` sale con los dos últimos bits distintos,
`1.5758941936865705` frente a `1.57589419368657`. El informe declara ese bloque
`BITWISE_EXACT`.

Lo medido, en procesos nuevos:

| Árbol | Fallos |
|---|---|
| `main` en `aa2e09f`, antes de este plan | 2 de 100 |
| Fases 0–2, intercalado con la 3 | 1 de 80 |
| Fase 3, intercalado | 2 de 80 |
| Fase 3, con `--no-maglev` | 0 de 40 |
| Fase 3, con `--no-turbofan` | 0 de 40 |

**No lo trae este plan**: está en `main` y sale con la misma frecuencia en los tres
árboles. Las series sueltas llegaron a dar un 13 %, pero no son comparables entre sí:
la frecuencia sube con la carga de la máquina. Solo aparece cuando conviven los dos
optimizadores de V8, así que depende de en qué nivel esté compilado el código cuando
corre cada medida.

**Lo que se descartó, y lo que no se encontró.** `Math.hypot` da lo mismo en los
tres niveles: 0 diferencias en 300.000 casos, la mitad con una componente a cero, y
los valores concretos del fallo también coinciden. En una ejecución que falló,
`distancia`, centroides y normales salieron idénticos bit a bit. Cualquier
instrumentación lo esconde: con una traza puesta, 0 fallos en 80. **La operación
exacta sigue sin aislar.**

Por qué importa más de lo que parece: `test:recon-cache` corre en CI, y ahí este
fallo es un rojo intermitente sin relación con el cambio que se esté probando. Y el
informe promete reproducibilidad al bit en un campo que no la tiene. Lo siguiente es
reproducirlo en una función aislada de `captureAdvice.ts` con su entrada real, y no
tocar la aritmética antes de saber qué operación es: cambiarla movería números del
informe, que es decisión de contrato.

### H13 — `test:model-cache` está rojo en `main` desde agosto, y no lo ve nadie

Cinco aserciones esperan que el dron salga con código 1 porque «trae avisos». Desde el
2026-08-10 el código de salida cuenta solo `certeza`, y los avisos del dron son
`candidato`: sale 0. La puerta no está ni en `verify` ni en CI, así que el rojo no
lo ve nadie, y con él se apagan las comprobaciones de la caché que vienen detrás.
Con solo esas cinco expectativas a 0, en una copia fuera del repositorio, la puerta
pasa entera. **No se tocó**: la expectativa es de quien escribió la puerta, y el
arreglo es cambiar «trae avisos» por «trae solo candidatos».

### H10 — Higiene

- `.claude/worktrees/gallant-napier-dd56d4`: un árbol de trabajo vivo en la rama
  `claude/gallant-napier-dd56d4`, en `a768025`, **126 commits por detrás de `main`**.
- `error/dist-node/agent3d.mjs`: 230 KB del 2026-08-03. No lo usa ningún script.
- **Disco al 98 %.** El escalón de 10M del banco nocturno pide ~1 GB de pico, y
  `.cache/` puede llegar a 576 MB entre sus tres topes.
- El directorio padre, `~/Documents/Dron`, es otro repositorio y ve `softsight/` como
  fichero sin seguir. Es la trampa del mapa §8: un `git add -A` lanzado ahí metería
  este repositorio como gitlink.
- No hay `.mcp.json`, así que un agente que abre el repositorio no recibe el servidor
  MCP. Y como `.gitignore` ignora `.claude/` entero, tampoco se puede versionar ahí
  ninguna configuración de proyecto.

---

## 2. Las fases

Cada ítem lleva qué cambia, la prueba que falla sin él y qué versiones mueve.
**Ninguno mueve un `renderHash`.**

### Fase 0 — Volver a verde, y que el verde no mienta

**0.1 El fixture de `mesh-partition`.** `triBase` en lugar de `base / 3`, y una línea
`partición: ok (…)` por bloque.
*Prueba:* con el fixture actual da 14 ≠ 8 (medido). *Versiones:* ninguna.

**0.2 Una puerta muda es una puerta roja.** `run-tests.mjs` marca `✗` toda puerta que
sale 0 sin ninguna comprobación.
*Prueba:* `mesh-partition` arreglada, pero sin sus `console.log`, sale roja.
*Versiones:* ninguna.

**0.3 Dos palabras para dos cosas.** `: no ejecutada —` se queda para lo que de verdad
no se midió —falta un fixture, falta `SOFTSIGHT_HEAVY`—, y los límites declarados
pasan a `: fuera de alcance —`. El resumen da los dos recuentos por separado, y en CI
la lista de no ejecutadas vuelve a ser la que hay que leer.
*Prueba:* una puerta de control que imprime una línea de cada forma, y cada una cae
en su recuento. Cambia el texto de unas treinta puertas, no su lógica.
*Versiones:* ninguna.

**0.4 El encargo 05-A, escrito.** O `docs/encargo-05.md` con el §2.1 y el §2.2 que
cita el código, o el código deja de citarlos.

### Fase 1 — MCP como superficie de primera

Es la fase que más cambia la vida de un agente, y casi toda ocurre en el servidor, que
no decide nada: **no mueve ningún contrato**.

**1.1 Un catálogo ligero: `tools/list` de 41 KB a menos de 6 KB.** `scene` y `patches`
se declaran `type: object`, con una descripción que remite a `softsight_schema` y su
parte. **No se pierde validación**, porque el esquema es el validador y `validate`
sigue corriendo en el servidor con su sugerencia. Solo se pierde la prevalidación del
cliente, que además nunca rechazó claves desconocidas como sí hace `validate`.
*Prueba:* `test:mcp` comprueba los bytes de `tools/list` con un `assert`, y una
escena con `positon` devuelve la misma sugerencia que el CLI.
*Versiones:* ninguna.

**1.2 Los errores, dentro del resultado.** Un error de datos (salida 2) vuelve como
`result` con `isError: true` y el texto del puente. JSON-RPC se queda para lo que es
de protocolo: método desconocido, JSON roto.
*Prueba:* el guion mal escrito, que hoy sale `-32000`. *Versiones:* ninguna.

**1.3 Paridad con el puente, comprobada.** `softsight_diff`, `softsight_sample`,
`softsight_staging`, `patches` en `softsight_scene`, y la lista de partes de
`softsight_schema` generada de `SCHEMA_PARTS`. `test:mcp` recorre los `COMMANDS` del
puente y exige una herramienta por comando o una exclusión escrita con su motivo.
*Prueba:* si se quita una herramienta, la puerta se pone roja con el nombre del
comando. *Versiones:* ninguna; el puente no cambia.

**1.4 Los artefactos, por ruta.** Una variable `SOFTSIGHT_OUTPUT_ROOT`, que fija la
configuración y nunca la petición —la misma regla que R16 puso para la lectura—:
`render`, `patch` y `scene` dejan ahí el pliego, el GLB y el parche inverso, y
devuelven sus rutas (`resource_link`). La imagen en línea pasa a ser opcional
(`image: true`). Esto cierra H4, porque el pliego de un turno es el `baseline` del
siguiente. Y cubre lo que el §84 dejó escrito como no ejecutado: los artefactos de
salida tampoco tenían por dónde volver.
*Prueba:* render, y luego patch con `baseline` igual a la ruta devuelta, da el mismo
`changedPixels` que el CLI, byte a byte; el peso de la respuesta de render va en un
`assert`.
*Versiones:* `bridgeContractVersion` se queda en 2 si la opción es aditiva.

**1.5 El protocolo al día.** Negociar `2025-06-18` o una revisión posterior.
`structuredContent` con el informe y `outputSchema` con el resumen. `annotations`:
`readOnlyHint` en inspect, schema, story, staging y los cuatro de paquete;
`idempotentHint: true` en todas. Y recursos —`softsight://schema/{parte}`,
`softsight://codes`, los ejemplares de `artifacts/agent/*.json`—, que hoy un agente
solo encuentra listando el directorio.
*Prueba:* `test:mcp` contra las dos versiones del protocolo; un cliente que pide
`2024-11-05` sigue recibiendo lo de hoy.

**1.6 `.mcp.json` en la raíz**, con `node tools/mcp-server.mjs`. Depende de 2.1: sin
ella, el servidor serviría lo que se compiló ayer. A la vez, `.gitignore` pasa de
ignorar `.claude/` entero a ignorar solo los ficheros locales que justificaban la
regla: `launch.json`, `settings.local.json` y `worktrees/`. **Es decisión tuya**
(§5), porque abre la puerta a versionar configuración de agente en un repositorio
público.

### Fase 2 — Lo que el agente programa, y cuánto espera

**2.1 Huella de compilación.** El build escribe en `dist-node/` la huella de los
fuentes que lo produjeron, y CLI, puente y MCP la comparan al arrancar. Si no
coincide: aviso en stderr desde el CLI, e `isError` con «npm run build:agent3d»
desde MCP.
*Prueba:* tocar un `.ts` hace aparecer el aviso; sin el ítem, no aparece nada. El
coste que añade al arranque se mide y se declara; el residente lo paga una sola vez.

**2.2 Volver a medir el reparto de la suite.** El descarte de Ω7 se mantiene si la
medida lo sostiene: dos vueltas en serie contra dos con `SOFTSIGHT_TEST_JOBS=2`, con
el mismo umbral del 30 % que se fijó entonces. Si gana, se enciende por defecto.
*Prueba:* la propia medida, anotada como los descartes de `plan-renderizador.md`.

**2.3 `verify:rapido` para el bucle interno.** Todas las puertas importan el mismo
paquete, así que el grafo de imports no dice qué puerta toca qué fuente. Lo dice la
cobertura: una pasada nocturna con `NODE_V8_COVERAGE` y los mapas de fuente produce
la tabla `puerta → ficheros de src/ que ejecuta`, y `verify:rapido` elige puertas a
partir de `git diff`. **Nunca cierra una fase**, solo acorta la iteración: `verify`
sigue siendo la única orden que vale, y CI la corre entera.
*Prueba:* una mutación en `meshPartition.ts` selecciona `mesh-partition` y la pone
roja; una en `coverage.ts` no la selecciona.

### Fase 3 — Sesiones: que el agente no tenga que recordar

El principio 3 de `plan-agentes.md` —«no recuerda entre llamadas»— se resolvió
metiendo la memoria en la respuesta: `--baseline`, `--baseline-report`, `--undo`.
Funciona, pero deja al agente llevando la cuenta de los ficheros, y esa cuenta el
banco la lleva mejor.

**3.1 La sesión residente.** `softsight_open(model | scene)` devuelve
`{ session, summary }`. `softsight_apply(session, patches)` aplica sobre el estado de
la sesión, compara contra el turno anterior **con el encuadre fijado** —el mecanismo
de A1—, devuelve `warningsDelta` sin que nadie pase informes y apila el parche
inverso. Además, `softsight_undo` y `softsight_export`. El estado de una sesión es
`(huella del modelo, lista ordenada de parches)` y viaja en cada respuesta como
`stateHash`: si el residente la expulsa, el agente la rehace con esa lista, y
cualquiera la reproduce por el CLI.
*Prueba, por dos caminos:* N turnos por sesión dan lo mismo que el CLI con los N
parches desde cero, byte a byte, en informe y pliego.
*Versiones:* comandos nuevos en el puente; `bridgeContractVersion` no se mueve si son
aditivos, como pasó con `scene` y `story`.

~~Obliga a algo que hoy no existe: que el residente llame a la revisión por API y no
por `argv`.~~ **Corregido al hacerlo: no hacía falta, y la medida ya estaba escrita.**
Lo que un turno repite es cargar el modelo, y Ω2 midió que copiar un modelo en memoria
cuesta lo mismo que leerlo de la caché de disco, que la sesión acierta en cada turno
porque su fichero no cambia de ruta ni de `mtime`. Por `argv`, en cambio, un turno
**es** el CLI —`--model M --patch p1 … --patch pk --baseline S(k-1) --baseline-report
R(k-1)`—, así que la equivalencia no hay que mantenerla. `reviewModelFile` no se tocó.

**Hecho el 2026-11-17** en `tools/session.mjs`. Lo que la prueba destapó por el camino:
la proyección de la respuesta tiene que hacerse **antes** de confirmar el turno, o una
errata en `fields` deja la sesión un turno por delante de lo que el agente cree. Y
deshacer quita lo de la última llamada entera, no el último parche suelto. Puerta
`test:session`, ocho bloques, contra el CLI lanzado aparte.

**3.2 Barrido: K variantes en una llamada.** `softsight_sweep(base, variantes,
fields)` evalúa K parches, escenas o repartos cargando el modelo una sola vez, y
devuelve una tabla con las medidas pedidas. No la ordena por una nota; como
`compare`, da dominancia y criterios cruzados. Es lo que pide la cabecera del propio
`meshPartition.ts` —«probar cien combinaciones de parámetros y quedarse con la mejor,
sin ver ninguna»— y lo que necesita la geometría declarativa para buscar parámetros.
*Prueba:* cada fila de la tabla es `deepEqual` a su llamada suelta.

**Hecho el 2026-11-17**, con dos diferencias sobre lo escrito arriba. El veredicto sale
de la frontera y no de la regla de R9, por H11. Y **los repartos no entran todavía**:
`auditPartition` no se alcanza desde el CLI hasta el 5.2, y un barrido solo varía lo
que el CLI sabe revisar. El núcleo es `src/soft/agent/sweep.ts`; la puerta, `test:sweep`,
recalcula el cruce con informes del CLI lanzado aparte.

### Fase 4 — El estado como dato

**4.1 `docs/estado.json`, generado.** Cada campo sale de su dueño y no se copia nada:
los estados de decisión, de los títulos de `contrato-videomesh.md`
(`### Dn — … — ESTADO`); puertas y comprobaciones, de la última ejecución de
`run-tests.mjs`; las versiones, de `versions.ts`; las herramientas MCP, de `TOOLS`;
los comandos, de `COMMANDS`. Sale por `--status` y por `softsight_status`, con lo que
la entrada de un agente frío baja de ~134 KB a unos 2 KB.

**4.2 La prosa deja de llevar números de estado.** En `AGENTS.md`, `README.md`, el
mapa §4 y el §2 del contrato, los recuentos pasan a ser bloques generados, como los
de `agents-md.mjs`. Y una puerta comprueba que el título de cada decisión y la tabla
del §2 dicen lo mismo, que hoy no pasa con D12.
*Prueba:* volver a escribir «siete herramientas» en el README pone la puerta roja.

**4.1 y 4.2, hechas el 2026-11-17** en `tools/estado.mjs` y su puerta `test:estado`.
El estado de cada decisión sale del sufijo de su título, que es la convención que el
registro ya seguía; sin sufijo, ACORDADA. Con eso la tabla del §2 del contrato se
genera, y D12 aparece en ella «a medias», como dice su título. La regla de la prosa
vigila el README, `AGENTS.md`, el mapa §4 y el contrato §2: una cifra, o un número de
siete en adelante con letra, delante de `herramientas`, `puertas` o `comprobaciones`
fuera de un bloque generado es rojo. Del uno al seis con letra se deja pasar, porque
«las dos puertas cruzadas» nombra cosas que se cuentan leyendo.

**4.3 El mapa §5, en dos.** Un estado vigente, corto —lo abierto y su dueño—, y un
`docs/historial.md` con el diario tal cual, sin reescribirlo, porque es registro.
**Es decisión tuya** (§5): el documento es tuyo. La regla de que nadie más lleva la
cuenta se mantiene; solo cambia la forma.

**Hecha el 2026-11-17**, con el «ejecuta las fases 4 y 5» como respuesta. El diario
—los puntos 1 a 22 y el párrafo del riesgo de la Fase D— se movió a `historial.md`
sin cambiar una letra (comprobado: las 52.578 letras del diario están enteras, y el
resto del mapa sale idéntico). Se quedan en el §5 lo abierto con su dueño y los avisos
que siguen valiendo: el alcance de E4, medir fluidez y el trabajo de eficiencia sin
fase. Las citas a «mapa §5.N» de documentos anteriores siguen sirviendo: el punto N
del historial.

### Fase 5 — El programa: lo que el registro deja abierto

**5.1 La mitad de plataforma de D28, en CI.** El trabajo `determinism` fija también el
informe de `cube-v1` y sus fracciones de cobertura en un fichero como
`render-hashes.json`, y los compara en los dos sistemas. Si coinciden, la mitad
«macOS y Linux» de D28 queda probada en dos arquitecturas. La de las reducciones
paralelas sigue abierta, porque esas reducciones siguen sin existir.
*Versiones:* ninguna; es una puerta nueva sobre números que ya existen.

**Hecho el 2026-11-17**, en `tools/render-hashes.mjs`, que es lo que CI corre en los
dos sistemas: `cube-v1` se genera de nuevo, se mide dos veces sin caché y se compara
contra `artifacts/agent/reconstruction-hashes.json`. **El consejo de captura no
entra**, por H12. D28 no cambia de estado: es decisión del registro, y la mitad de
plataforma pide que el trabajo de macOS llegue a correr —hoy GitHub lo deja en cola—.

**5.2 El encargo 05-A, alcanzable.** Hoy `auditPartition` solo existe como función
exportada. Le faltan `--partition` en el CLI, `partition` en el puente, su
herramienta MCP y su parte de esquema. Con 3.2 se convierte en el primer consumidor
real del barrido.

**Hecho el 2026-11-17.** `--model malla --partition reparto.json` —PLY, GLB u OBJ—,
`partition` en el puente, `softsight_partition`, `--schema partition`, y el barrido
acepta variantes de reparto. Para el barrido hacía falta un número por variante, y
`auditPartition` publica ahora `cut`: el total del corte con cada arista una vez,
porque la que separa dos piezas está en las dos. Sin veredicto, como el módulo:
sale 0. Con tres repartos del cubo, una cara abre 4 aristas, la mitad 8 y alternar
triángulos 14, y gana el corte más corto.

**5.3 La confianza que pide residuales (R8).** Es el paso grande que le queda a la
reconstrucción: «¿coincide con lo que muestran las fotos?». Lo bloqueaba la
superficie densa, que pide CUDA, y desde `ee6e8e0` el cuaderno de Colab la produce.
Es una fase entera, y **es decisión tuya** si va antes o después de las anteriores.

**Hecho el 2026-11-17, en `mejora/r8`.** Las cuatro piezas del R8 de
`plan-reconstruccion.md`, en un bloque `residuals` del informe (versión 0.3):

```text
máscaras      IoU, falsos positivos y negativos, distancia entre bordes
EXR           lector de D5, sin IO: zlib la pasa quien llama
profundidad   error medio, mediano, p95, máximo, sesgo y relativo
normales      la de la malla contra la derivada del mapa de profundidad
```

Cada muestra de la imagen lanza su rayo con `pixelRay` —la inversa exacta de
`projectPoint`, distorsión incluida— y lo cruza con el árbol de triángulos. La
verdad de la puerta es una caja analítica cruzada por planos, no la malla.

Lo que sigue sin datos reales es lo que ya se sabía: ningún productor entrega
mapas de profundidad, y el cuaderno de Colab saca malla densa. La puerta prueba la
aritmética y la convención de cámara sobre evidencia fabricada.

**5.4 D5 (EXR).** El lector existe y la decisión **no** cambia de estado: ver la
nota de D5 en el contrato. Es un lector que todavía no usa nadie, y por eso lo
dice el registro en vez de darlo por implementado.

---

## 3. Orden recomendado

| Paso | Por qué en este orden | Estimación |
|---|---|---|
| Fase 0 | Nada se empieza sobre rojo, y el verde tiene que significar algo | ~1 h |
| 2.1 | Sin la huella, todo lo de MCP serviría código viejo | ~2 h |
| 1.2 → 1.4 → 1.1 → 1.3 | Primero el bucle principal por MCP, luego su coste, luego la cobertura | 1–2 días |
| 4.1, 4.2 | Barato, y deja de producir contradicciones | ~1 día |
| 3.1, 3.2 y 5.2 | Lo más caro, y lo que más multiplica | ~1 semana |
| 1.5, 1.6, 2.2, 2.3, 5.1 | Independientes entre sí | sueltas |
| 4.3, 5.3 | Tuyas | — |

**Las estimaciones son estimaciones**; los números del §0 son medidas.

---

## 4. Lo que no se hace, y por qué

- **Tocar el núcleo de render.** No hay medida que lo pida, y
  `plan-renderizador.md` guarda los descartes con su cifra.
- **Partir `index.ts` (1.621 líneas) o `agent3d.mjs` (1.486) por su tamaño.** Solo
  se extrae lo que necesita 3.1, y porque lo necesita.
- **Validar en el cliente MCP lo que ya valida `validate`.** Dos validadores serían
  dos fuentes del mismo dato.
- **Ordenar las variantes del barrido por una nota.** El mismo motivo que en
  `compare`: los pesos no los conoce quien mide.

---

## 5. Lo que decides tú

1. **La higiene que borra**: el árbol de trabajo `gallant-napier-dd56d4`, `error/` y
   el recorte de `.cache/`. Con el disco al 98 % es urgente, pero no tiene vuelta
   atrás.
2. **`.mcp.json` y el `.gitignore` de `.claude/`** (1.6).
3. **El mapa §5 partido en estado e historial** (4.3).
4. ~~**Si R8 va antes o después que las sesiones** (5.3).~~ Decidido: R8 ahora.
