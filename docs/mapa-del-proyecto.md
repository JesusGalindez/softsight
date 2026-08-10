# Mapa del proyecto

Documento único de orientación. Responde tres preguntas antes de tocar nada:
**qué pieza estoy tocando**, **de quién es el dato** y **qué toca ahora**.

No repite lo que ya está en otro sitio: cuando algo tiene su documento, aquí solo
está el puntero.

---

## 1. Las dos mitades

El producto son **dos repositorios**, con una frontera que no se cruza.

| | **softsight** | **softsight-motion-editor** |
|---|---|---|
| Remoto | [`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público) | [`JesusGalindez/softsight-motion-editor`](https://github.com/JesusGalindez/softsight-motion-editor) (privado) |
| Qué es | Núcleo verificador: rasterizador por software + banco headless para agentes | Editor de motion graphics 3D, local-first, React + Three.js |
| Motor | CPU, cero dependencias en el núcleo | Three.js (WebGL/WebGPU) |
| Salida | JSON determinista + PNG | Composición `.morphfx`, JSON, WebM |
| Papel | **Produce verdad**: mide, audita y certifica | **Consume verdad**: importa lo ya certificado |
| Plan propio | [`plan-fases-bcd.md`](plan-fases-bcd.md), [`plan-agentes.md`](plan-agentes.md), [`plan-renderizador.md`](plan-renderizador.md) | `PLAN.md` y `docs/PLAN_MOTOR.md` en su repo |

Lo que cae **entre** los dos repos —y por eso no cabe en ninguno de esos planes—
va en [`plan-historias.md`](plan-historias.md) y [`plan-convergencia.md`](plan-convergencia.md).

Y como hay **tres actores escribiendo a la vez y no todos pueden hablarse**, lo
que va de uno a otro —peticiones, bloqueos, quién ve qué árbol— se registra en
[`coordinacion.md`](coordinacion.md).

Lo que viene después de que la pieza se monte sola —tipografía animada, ritmo,
que el movimiento cuente la historia en vez de decorarla— está en
[`plan-animacion.md`](plan-animacion.md).

Y lo que hace falta para que un agente **describa** una pieza compleja —un ala, un
fuselaje, una pata— en vez de solo colocar primitivas, está en
[`plan-geometria.md`](plan-geometria.md). Que el **movimiento** se declare con el
mismo vocabulario que la forma, en [`plan-movimiento.md`](plan-movimiento.md).

**Regla de la frontera:** el editor nunca importa módulos internos de softsight.
Se comunica solo por el contrato público —CLI, JSON, `--schema`, fixtures— y lo
hace por un único fichero, `src/assets/softsight-adapter.ts`.

**Y hay dos rasterizadores por software, a propósito.** El de softsight
(`src/soft/`) **certifica**: produce la verdad contra la que se mide, y su salida
es la que llevan los hashes. El del editor (`src/engine/cpu/`) da **paridad de
export** y funciona sin GPU, para renderizar igual donde no hay contexto WebGL.
Ninguno sustituye al otro y **no se escribe un tercero**. Que no diverjan no es
una promesa: lo comprueba `npm run softsight:parity-gate` en el editor,
comparando silueta y cajas de pantalla sobre los fixtures de paridad.

Corolario: si el editor calcula algo por su cuenta que softsight también sabe
calcular, y nadie ha comparado los dos números, eso es **deuda certificada**, no
una funcionalidad. El principio rector completo está en
[`plan-fases-bcd.md`](plan-fases-bcd.md).

---

## 2. Las cuatro identidades de softsight

El repositorio cumple cuatro funciones y confundirlas es la causa habitual de que
un cambio rompa lo que no tocaba. Ordenadas de dentro hacia fuera:

1. **Núcleo de render** — `src/soft/*.ts` sin `agent/`. Rasterizador puro: mate-
   mática, recorte, rasterizado, sombreado, postproceso, paralelo por bandas.
   No sabe qué es un GLB ni qué es un aviso.
2. **Banco de agentes** — `src/soft/agent/`. Carga, modelo direccionable,
   auditoría, parches, pliego de contactos, evaluador de animación, muestreo de
   superficie. Es la biblioteca que produce el JSON.
3. **CLI** — `tools/agent3d.mjs` sobre `dist-node/agent3d.mjs`. La cara del banco
   para procesos: JSON limpio a stdout, progreso a stderr, salida 1 si hay avisos.
4. **Demo de navegador** — `soft.html` + `src/soft/softMain.ts`. Prueba que el
   mismo código corre sin Node. **No es el producto**; es la demostración de que
   el núcleo es portable.

Cuando dudes de dónde va un cambio: si necesita saber qué es un fichero, no va en
la capa 1; si necesita saber qué es un argumento de línea de órdenes, no va en la
capa 2.

---

## 3. De quién es cada dato

La regla es una fuente por dato. Estas son las fuentes:

| Dato | Dueño | Los demás |
|---|---|---|
| Forma de la escena y del parche | `--schema` de softsight (el código que valida) | se derivan de él, nunca se escriben a mano |
| Forma del puente (petición/respuesta) | `tools/bridge.mjs` (el código que valida) | el cliente del editor la comprueba por `bridgeContractVersion` y esquema |
| Forma del informe | `contractVersion` en la raíz del informe | el consumidor comprueba la versión antes de leer campos |
| Semántica de animación certificada | `src/soft/agent/animation.ts` | el editor la verifica, no la reimplementa |
| Commit de softsight que consume el editor | `src/assets/softsight-pin.ts` (editor) | los documentos de contrato apuntan ahí; el puente publica su versión y el pin se comprueba solo |
| Contrato de integración | `SOFTSIGHT_CONTRACT.md` (editor) | describe la integración; el commit no lo repite |
| Contrato de animación | `SOFTSIGHT_ANIMATION_CONTRACT.md` (editor) | el README de softsight apunta aquí |
| Fixtures certificados | `public/fixtures/` (editor) | se regeneran con los scripts `softsight:*` |
| Estado y orden del trabajo | **este fichero** (§5) y `plan-fases-bcd.md` | ningún otro sitio lleva la cuenta |

Los contratos viven en el editor a propósito: **el consumidor pincha la versión
del productor**, no al revés. Así softsight puede avanzar sin romper al editor
hasta que el editor decida subir el commit fijado.

---

## 4. Verificación cruzada: las puertas

Ninguna fase se cierra por revisión visual. Se cierra cuando el mismo cálculo,
hecho por los dos lados, da el mismo hash.

| Puerta | Qué compara | Cómo se ejecuta |
|---|---|---|
| `test:animation` | El evaluador contra sus propios fixtures y contra GLB defectuosos | `npm run test:animation` (softsight) |
| `test:bridge` | El puente contra el CLI real: sample, inspect, render, patch y schema | `npm run test:bridge` (softsight), también dentro de `test:animation` |
| `test:glb-writer` | Un GLB reescrito por nosotros contra los hashes de control del original | `npm run test:glb-writer` (softsight), también dentro de `test:animation` |
| `test:bind` | El atado en reposo y con el hueso movido, exacto, y las 296 piezas del dron sin deformar | `npm run test:bind` (softsight), también dentro de `test:animation` |
| `test:rig` | Esqueleto y clips declarados, la auditoría de animación, y la escena por el puente byte a byte | `npm run test:rig` (softsight), también dentro de `test:animation` |
| `test:bvh` | La cinemática de un BVH contra el evaluador certificado por dos caminos, y la conversión por API, CLI y puente byte a byte | `npm run test:bvh` (softsight), también dentro de `test:animation` |
| `test:staging` | La puesta en escena: los tres avisos, informes malos rechazados por su motivo, que cada obligatorio del esquema se compruebe quitándolo, y que API, CLI y puente digan lo mismo sin dejar artefactos | dentro de `npm run test:animation` (softsight) |
| `test:geometry` | La geometría declarativa contra sus volúmenes analíticos: perfiles, loft, barrido, deformadores y repetición, más el ejemplar montado sin solape parcial ni piezas sueltas | `npm run test:geometry` (softsight), también dentro de `test:animation` |
| `softsight:parity-gate` | Los dos rasterizadores sobre los tres fixtures: silueta contenida en una dilatación de un píxel, y cajas de pantalla exactas | `npm run softsight:parity-gate` (editor), bajo demanda |
| `test:story` | El guion: duración derivada de la suma, guiones malos rechazados por su motivo, que `--schema` publique el mismo esquema que valida, la auditoría con sus tres avisos, que API, CLI y puente digan lo mismo, y que los dos ejemplares estén limpios y no compartan forma | `npm run test:story` (softsight), también dentro de `test:animation` |
| `scene-roles.contract` | El vocabulario de roles y los campos que exige cada uno, del editor contra el contrato que publica softsight | dentro de `npm run check` (editor); el fixture se regenera con `npm run softsight:story-schema` |
| `softsight:gate` | Poses de control: SoftSight contra Three.js | `npm run softsight:gate` (editor) |
| `softsight:sample-gate` | Muestras de superficie: posiciones y normales | `npm run softsight:sample-gate` (editor) |
| `softsight:gates` | Las dos anteriores, en cadena | `npm run softsight:gates` (editor) |
| `test:summary` | El informe recortado contra el completo: cada clave del resumen es la misma, el resumen del dron cabe en 2.000 B, una ruta de `--fields` que no existe sale 2 con sugerencia, y la unión de las siete partes de `--schema` es el `--schema` completo | `npm run test:summary` (softsight), también dentro de `test:animation` |
| `test:codes` | El registro de códigos de aviso contra `src/soft/`, en las dos direcciones, y contra lo que publica `--schema` | `npm run test:codes` (softsight), también dentro de `test:animation` |
| `test:determinism` | El pliego del dron dos veces en la misma máquina, y contra el `renderHash` fijado en `artifacts/agent/render-hashes.json` | `npm run test:determinism` (softsight), y en CI sobre `ubuntu-latest` y `macos-latest` |
| `check` | Tipos, pruebas y build del editor | `npm run check` (editor) |

Las dos puertas llevan los fixtures y `--strict` en el propio script, así que se
ejecutan sin argumentos; pasar los tuyos después de `--` los sustituye.

**Quién las ejecuta, desde el 2026-08-09.** `.github/workflows/verify.yml` corre
tipos, las puertas y el determinismo en cada empujón, con la versión de Node
tomada de `.nvmrc`. `npm run verify` es la misma orden en local. Aviso de
alcance: cinco puertas —`animation-contract`, `glb-loader`, `sample-surface`,
`glb-writer` y `bridge`— leen el fixture certificado del editor, que es un
repositorio privado, y **en CI no corren**: se declaran «no ejecutada» con su
motivo impreso. El verde de CI son tipos, determinismo en dos sistemas y 8 de 13
puertas; las cinco restantes solo las cierra una ejecución local con los dos
repositorios al lado. La ruta se resuelve en `tools/fixtures.mjs` y
`SOFTSIGHT_FIXTURES` la sustituye.

Estado hoy, verificado el 2026-08-09: **ambas puertas en `accepted`; las 80
comprobaciones de softsight en verde**. El número ya no se lleva a mano: lo
imprime `npm run test:animation` al terminar, contando las líneas `: ok` que
emiten las propias puertas, junto con el tiempo de cada una.

En el editor, **410 pruebas en verde y 6 en rojo**: las seis son de `mcp/`, el
sidecar del paso F4.4 del plan del motor, que está a medio escribir y sin
commitear. Todo lo demás —tipos, build y las dos puertas cruzadas— pasa. Se
anota en rojo a propósito: un número que esconde el trabajo a medias de otro
proceso no es el estado, es una foto favorecedora.

Política de versionado: cambiar la aritmética o el hash **obliga** a subir
`contractVersion`. Las puertas rechazan versiones viejas, así que el olvido se
convierte en fallo de puerta y no en un número silenciosamente distinto.

---

## 5. Qué toca ahora

Orden vigente. Cada punto deja los dos repos verdes antes de pasar al siguiente.

1. **C5 — integración del attach** (hecho). Guarda la referencia completa de
   superficie en el spawn de partículas, actualiza por frame con el evaluador
   certificado y cerró la última excepción local de `renderer-spike.ts`.
   Detalle en [`plan-fases-bcd.md`](plan-fases-bcd.md).
2. **Fase D — puente local** (hecho). `tools/bridge.mjs` recibe JSON por stdin y
   devuelve JSON por stdout con sandbox sin shell; el editor lo consume con
   `softsight-import.mjs`, una sola ruta de importación. Detalle en
   [`plan-fases-bcd.md`](plan-fases-bcd.md).
3. **E1 — escritura de esqueleto y clips** (hecho). `serializeSkinnedGlb` en
   `glbWriter.ts` cierra la asimetría de la que se partía: softsight sabía
   verificar animación con skinning que no sabía escribir. La puerta
   `test:glb-writer` reescribe el fixture y comprueba los cuatro hashes de
   control; el fichero resultante pasa además el gate del editor con `accepted`
   4/4, así que Three.js valida un GLB nuestro. Detalle en §7.
4. **E2 — lector de BVH** (hecho). `bvhLoader.ts`: `parseBvh` lee `HIERARCHY` y
   `MOTION` sin dependencias, y `bvhToSkinnedScene` alimenta directamente al
   escritor de E1. La tubería `BVH → GLB con esqueleto` está cerrada, así que
   entra en el pipeline certificado toda la biblioteca de captura de movimiento
   que existe, incluida la salida de generadores como Kimodo. La puerta
   `test:bvh` compara la cinemática directa contra el evaluador certificado por
   dos caminos independientes; el cierre cruzado con Three.js se hizo sobre un
   esqueleto con tres órdenes de rotación distintos, 4/4 hashes. Detalle en §7.
5. **E3 — la tubería en la superficie** (hecho). `--bvh captura.bvh --export
   esqueleto.glb`, con `--bvh-scale` y `--bvh-clip`; comando `bvh` en el puente,
   el único que no recibe `model`; y un fixture versionado en
   `artifacts/agent/captura-ejemplo.bvh` con tres órdenes de rotación distintos.
   La puerta comprueba que **API, CLI y puente producen el mismo GLB byte a
   byte**: los dos últimos son envoltorios y no deben decidir nada. El
   `bridgeContractVersion` sigue en 1 porque añadir un comando no rompe a nadie.
6. **E4 — atado de malla a esqueleto** (hecho). `bindModelToSkeleton` en
   `skinBinding.ts`, y `--skeleton` + `--bind` en el CLI. Cierra la tubería:
   BVH → esqueleto → modelo animado que **se puede mirar**. Ver el aviso de
   alcance más abajo.
7. **E5 — esqueleto, clips y auditoría de animación declarativos** (hecho).
   `skeleton`, `bindings` y `clips` en la escena; `rigSpec.ts` los comprueba y
   traduce, `animationAudit.ts` audita el movimiento. Un agente construye un
   personaje animado entero en JSON y recibe hechos comprobables sobre él.
8. **E6 — la escena por el puente** (hecho). Comando `scene` en `bridge.mjs`:
   antes todo lo declarativo solo se alcanzaba llamando al CLI a mano, y por la
   vía con sandbox —la que usa el editor— no se llegaba.
9. **UI de estudio** (hecha, F0–F5 en el repo del editor). Detalle en §6.
10. **Vida del movimiento** (hecha, en el editor, commit `5217497`). `wiggle.ts`
    con ruido suave y determinista —puro en `(semilla, tiempo)`, no el PRNG con
    estado—, `timeOffsetFrames` por capa para el desfase en cascada, e
    interpolación `spring` en forma cerrada. Pestaña **Vida** en el inspector.
    Esquema del proyecto 10 → 11.
11. **Plan del motor** (en curso, otro proceso, en el repo del editor).
    `docs/PLAN_MOTOR.md` y `AGENTS.md` mandan allí. F0 —gestor de calidad GPU
    con tiers, presupuesto, muestreo y caché de frames— es el commit `1184cba`.
    F1 —grafo de escena, registro de recursos y puente con Three— está hecho
    localmente y sin commitear.
12. **Historias por agentes** (en curso). Ver
    [`plan-historias.md`](plan-historias.md), §9 para el orden. Hechos en el
    editor y sin commitear los pasos 1 y 2: `activeSceneAt` en
    `src/core/evaluator.ts` —qué escena está activa en un frame y su progreso
    local, que empieza en 0 y nunca llega a 1 porque el 1 es el primer frame de
    la siguiente— y `scenes` en el documento, con `composition.durationFrames`
    derivada de la suma en la validación, que es por donde pasan todas las
    mutaciones. Esquema del proyecto 11 → 12. Hecho también el paso 3, en
    softsight y sin commitear: `storySpec.ts` resuelve el guion —roles,
    duraciones, campos que cada rol exige— y `STORY_SCHEMA` sale por `--schema`
    con el vocabulario de roles generado de una sola lista. La duración de la
    pieza se deriva en los dos lados y ninguno la declara. Y el paso 4:
    `storyAudit.ts` mide texto ilegible por tiempo, rol obligatorio ausente y
    dos escenas seguidas con el mismo papel, con el ritmo de lectura declarado
    en el propio informe. Sin heurísticas: los candidatos entran después y
    marcados. Y el paso 5, en el editor: `scene-roles.ts` convierte los datos de
    cada escena en capas de texto colocadas en su rango, con el vocabulario
    congelado en `public/fixtures/softsight-story-schema.json` —traído por el
    puente con `npm run softsight:story-schema`— y comparado por una prueba, así
    que los roles del editor no son una copia sin comparar. Y el paso 6: `story`
    en el puente y `--story` en el CLI —el puente solo ejecuta el CLI, así que
    sin la bandera no había comando—, con `--reading-rate` para mover la
    suposición. Sin `model` y sin artefactos: una historia no produce fichero.
    `bridgeContractVersion` sigue en 1. Y el paso 7, con lo que se cierra el
    plan: dos ejemplares versionados en `artifacts/agent/guion-*.json`, limpios
    de avisos y **con formas distintas**, porque dos piezas con la misma
    secuencia de roles enseñarían una plantilla. La puerta los audita: un
    ejemplar con avisos enseñaría justo lo que la puerta rechaza.
13. **Convergencia** (en curso). Ver
    [`plan-convergencia.md`](plan-convergencia.md). Con F3 del plan del motor, el
    editor tiene su propio rasterizador por software —`src/engine/cpu/`, raster
    de Pineda, MSAA 4x, kernel WASM SIMD— y **nadie lo compara con el de
    softsight**: deuda certificada en el sitio más caro, porque toca la
    afirmación de exactitud que sostiene el producto. El plan la cierra con una
    puerta de paridad que compara silueta, cajas y orden en duro y el color con
    tolerancia declarada; después cierra el bucle de historias con la auditoría
    de puesta en escena, y solo entonces optimiza. **A0 hecho el 2026-08-05: las
    dos proyecciones coinciden al píxel** —cero de desviación en 12 cajas y seis
    vistas—, y para lograrlo el informe publica ahora la cámara de cada vista
    (`ViewReport.camera`), que antes se tiraba al serializar. **A3 hecho el
    2026-08-05**: `npm run softsight:parity-gate` en el editor enfrenta los dos
    rasterizadores. La vista en perspectiva da paridad exacta —0 píxeles sobre
    9.251—; **A3 y A4 cerrados el mismo día**: la puerta destapó que
    softsight descartaba caras visibles a incidencia rasante en proyección
    ortográfica —usaba el test de perspectiva—, y con el arreglo las ocho vistas
    de los dos fixtures dan **cero píxeles de diferencia**. `contractVersion`
    sube a 3 porque se mueven los `renderHash`. De paso destapó que la prueba de profundidad
    del rasterizador del editor compara `clipZ` sin dividir por w — arreglo del
    plan del motor, no de este. **A4 medido el 2026-08-05 y abierto**: con la
    tolerancia implementada como dilatación de un píxel, las bandas llegan a
    cinco, así que la divergencia es real y no del medidor. Un fixture de solo
    caras planas separa dos causas: las aristas curvas casi tangentes, y algo
    propio de la vista superior que no es recorte ni rotación.
14. **Geometría compleja declarativa** (hecha). El agente ya no está limitado a
    colocar primitivas: perfiles con nombre —círculo, superelipse, Gielis y NACA—,
    `loft` de secciones, `sweep` de un perfil por un recorrido, cuatro
    deformadores en cadena y `repeat` radial y espejo. Todo con su número exacto:
    dos secciones iguales dan lo mismo que una extrusión, un barrido cerrado da lo
    mismo que el toro, y la torsión conserva el volumen firmado. Plan cerrado en
    [`plan-geometria.md`](plan-geometria.md), puerta `test:geometry` con 43
    comprobaciones, ejemplar en `artifacts/agent/pieza-geometria.json`.
15. **B-R2 — deuda estructural aparcada.** Unificar los dos parsers de GLB. No se
   toca hasta que haya un consumidor que lo pague.
16. **Plan Ω — el coste por turno del agente** (en curso). Ver
    [`plan-omega.md`](plan-omega.md). No añade funcionalidad: ataca lo que hace
    caro operar el banco —16,5 KB por turno, 10.000 tokens de descubrimiento,
    0,10 s de arranque por llamada y 47,3 s de suite— y el hueco de que nada de
    esto lo ejecutaba una máquina. **Ω4 hecha el 2026-08-09**: CI en tres
    trabajos, `npm run verify` como orden única, y el pliego del dron fijado en
    `artifacts/agent/render-hashes.json` (`46228b7c`, contrato 3, **el mismo en
    `ubuntu-latest` y en `macos-latest`**: el determinismo deja de ser política y
    pasa a ser un hecho medido en dos aritméticas). Destapó que cinco puertas
    dependen del fixture privado del editor y en CI no corren; ver el aviso de
    alcance en §4. **Ω7 hecha el mismo día**: `tools/run-tests.mjs` imprime el
    tiempo de cada puerta y el recuento de comprobaciones, y con eso se vio que
    `sample-surface` es el 62 % de la CPU de la suite y que esta máquina tiene dos
    núcleos físicos —repartir entre cuatro procesos la empeoraba de 61 s a 89 s—.
    El reparto queda apagado tras `SOFTSIGHT_TEST_JOBS` y el objetivo de bajar de
    20 s pasa a depender de Ω6.2 y Ω6.3, no del paralelismo. **Ω1.3 hecha**: los
    33 códigos de aviso viven en `warningCodes.ts` y son el tipo del campo
    `code`, así que emitir uno que no esté en la tabla no compila; salen por
    `--schema` con su causa, su severidad —certeza o candidato— y su arreglo.
    **Ω1.1 y Ω1.2 hechas**: `--summary` deja el informe del dron en 1.108 B
    frente a 16.493 B —un 93 % menos, con sus dos avisos dentro— y `--fields`
    proyecta rutas con punto; las dos son proyecciones sobre el informe ya
    construido y no recalculan nada.

**Aviso de alcance sobre E4.** El plan excluye a propósito el rigging, la IK y
el retargeting. E4 **no los introduce**: no calcula ni un solo peso. Aplica un
vínculo declarado y verifica que es completo y coherente, que es trabajo de
banco de verificación. La línea queda donde estaba, y conviene no cruzarla: en
cuanto la herramienta decida por su cuenta a qué hueso va un vértice, deja de
poder afirmar que el resultado es exacto, y con ello se va el valor de todo lo
demás. Lo que falte de pesos suaves lo trae quien los tenga, por `JOINTS_0` y
`WEIGHTS_0`.

Riesgo declarado: D era el mayor cuello de botella, porque el editor dependía
del CLI por proceso. El puente lo cierra: el editor habla con un proceso local
por JSON, y la forma del contrato sale de `--schema`, que no puede divergir.

**Sobre medir fluidez.** No se puede desde el panel del navegador integrado:
estrangula `requestAnimationFrame` a cero cuando no está en primer plano, lo que
congela también los bucles de la aplicación. Cualquier percentil de fotograma
medido así mide el panel, no el editor. Lo que sí es fiable son los bucles
síncronos: medido así, `evaluateAt` cuesta 0,005 ms y ~0 KB por fotograma —no es
el cuello de botella— y `evaluateParticleMorph` con 50.000 partículas cuesta
**6,16 ms**, el 37 % del presupuesto de un fotograma. Ese es el número que manda,
y el mando que lo mueve es `setParticleCap` del gestor de calidad. Para medir de
verdad: Chrome propio, en primer plano, leyendo `mediana` y `p1` de la barra de
estado, que es el instrumento del propio renderer.

Trabajo de eficiencia identificado, sin fase asignada todavía:

- Precomputar áreas y pesos √área en `Float64` una vez por GLB; hoy el muestreo
  los recalcula en cada llamada.
- Reutilizar `decodedViews` entre frames consecutivos: hoy los skins leen las
  mismas IBM cuatro veces (pose, normales, muestra).
- Un solo `AnimationMixer` por lote de frames en `create-sample-contract.mjs`;
  hoy se crea uno por frame.
- Ampliar la caché del CLI a las muestras, con clave `(GLB, semilla)`.
- Modo `--summary`/`--quiet` en `agent3d`: el informe completo es verboso para CI.

---

## 6. Dirección de la interfaz

El editor ya tiene jerarquía, viewport, inspector, línea de tiempo, transporte,
biblioteca de assets, plantillas y métricas. Lo que le falta no son funciones:
es **el continente**. Hoy son paneles sueltos dentro de una columna de 1200 px
con márgenes de página, tipografía de titular y botones de texto que se envuelven
en filas.

Un estudio profesional —Adobe, Unreal— se reconoce por cinco cosas, y ninguna es
decorativa:

1. **A sangre.** Ocupa la ventana entera, sin scroll de página. El área de trabajo
   es el documento, no un bloque dentro de una web.
2. **Regiones acopladas y redimensionables.** El usuario reparte el espacio; el
   diseño no lo decide por él.
3. **Densidad.** Tipografía de 11–12 px, controles de 22–24 px, espaciado en
   rejilla de 4 px. Cabe más contexto en pantalla y la vista no salta.
4. **Fichas, no botones sueltos.** Las órdenes se agrupan por dominio en una barra
   fina y en menús, no en una fila que se desborda.
5. **Un solo sistema de color.** Superficies por nivel de profundidad, un acento,
   estados semánticos. Hoy hay decenas de hexadecimales sueltos en `styles.css`.

Cómo se ejecuta, sin romper nada: primero las **fichas de diseño** y el **armazón
a sangre** (solo CSS y el contenedor raíz, sin tocar la lógica); después la
densidad y los grupos de controles; al final, el acoplado redimensionable. La
funcionalidad no se toca en ningún paso y `npm run check` pasa entre paso y paso.

---

## 7. Fuentes de movimiento externas

Analizados el 2026-08-03: [nv-tlabs/kimodo](https://github.com/nv-tlabs/kimodo)
—generación de movimiento humanoide desde texto y restricciones— y
[NVlabs/SOMA-X](https://github.com/NVlabs/SOMA-X) —topología y rig canónico de
cuerpo humano, y el esqueleto sobre el que Kimodo genera—.

**Como biblioteca dentro de cualquiera de las dos mitades: no.** Son Python con
PyTorch, CUDA y Warp. El núcleo vende «sin GPU y sin dependencias»; meter torch
dentro borraría el producto.

**Como fuente de assets aguas arriba: sí**, y en el sitio que ya existe. Kimodo
produce un fichero; el fichero se congela y se le calcula el hash; entra por el
puente como cualquier otro asset. Esto **no es negociable**: un modelo de
difusión da el mismo resultado con la misma semilla solo sobre la misma GPU, el
mismo driver y la misma versión de torch. La generación queda **fuera** de la
línea determinista, igual que un GLB descargado de internet.

Ninguno de los dos se instala en la máquina actual, y conviene no volver a
comprobarlo: la última rueda de PyTorch para macOS x86_64 es la 2.2.2 y SOMA
pide la 2.10.0; `warp-lang` no publica rueda de macOS x86_64, solo arm64; y
Kimodo pide GPU NVIDIA. Cuando haya una caja con GPU, el Python vive en un
tercer directorio que no es ninguna de las dos mitades, y lo único que cruza la
frontera son ficheros.

Licencias: el código de los dos es Apache-2.0. Los pesos `Kimodo-SOMA-*` son
NVIDIA Open Model —comercialmente usables, sin reclamación sobre las salidas—,
pero `Kimodo-SMPLX-RP-v1` es licencia de investigación y los cuerpos SMPL/SMPL-X
exigen registro aparte y no se redistribuyen. **La rama SOMA es la limpia.**

Lo que sacamos de ahí sin instalar nada es el orden de trabajo de §5: E1
(escribir esqueleto y clips, hecho) y E2 (leer BVH, siguiente). BVH es la salida
estándar de Kimodo y de casi todo el mocap del mundo; `kimodo/exports/bvh.py` es
Apache-2.0 y sirve de referencia para no equivocarse con el orden de rotación y
la convención de ejes, que es donde todo el mundo se equivoca.

Lo que **no** se hace: los correctivos por pose de SOMA. Son deformación
dependiente de la pose por encima del LBS y el evaluador certificado no los
contempla; certificarlos sería una fase entera, no un añadido.

---

## 8. Higiene del entorno

Cosas que ya estaban rotas y conviene no volver a romper:

- **Dos procesos escriben el repositorio del editor a la vez**, uno por el plan
  del motor y otro por este. El reparto por directorios —quién escribe qué— está
  en [`plan-convergencia.md`](plan-convergencia.md) §0, y ahí se explica por qué
  todavía no hay un árbol de trabajo por plan. Nadie crea ramas ni hace `git
  switch` en un árbol compartido: mover `HEAD` arrastra el trabajo sin commitear
  del otro proceso.
- **El editor estuvo sin repositorio propio durante meses**, y mientras lo
  estuvo, `git` resolvía sus órdenes contra un repositorio ancestro del sistema
  de ficheros donde no había ni un fichero suyo seguido: una única copia en
  disco, sin historial. Ya tiene repositorio y remoto propios. La lección vale
  para cualquier directorio nuevo: **comprueba `git rev-parse --show-toplevel`
  antes de dar por hecho que estás donde crees.**
- **Trabajar desde el directorio personal es una trampa.** Si un ancestro tiene
  un `.git`, cualquier `git` lanzado desde una carpeta sin repositorio más
  cercano cae en él y commitea donde no debe. Conviene comprobarlo una vez, y no
  borrar nada a la ligera: borrar un repositorio no es reversible.
- **Nombres divergentes del editor**: el directorio, el paquete
  (`softsight-motion-editor`) y su primer remoto se llamaron cosas distintas.
  Tres nombres para una cosa. Renombrar el directorio rompe las rutas absolutas
  que guardan la configuración local y algunos scripts, así que es un cambio a
  hacer a propósito, no de paso.
- `.claude/launch.json` no se versiona en ninguno de los dos repos: lleva rutas
  absolutas de la máquina donde se creó.
- **`math.ts` guarda las matrices por filas**, no por columnas: `translation` deja
  la traslación en los índices 3, 7 y 11. Leerlas por columnas produce resultados
  plausibles y falsos, y dos errores así se cancelan entre sí sin que nada salte.
  Lo destapó una prueba que comparaba contra un número absoluto —una caja que
  medía 1,200 cuando tenía que medir 2,800—; comparar solo contra otra ejecución
  del mismo código no lo habría visto.
- **`validate` de `schema.ts` rechaza toda clave que no esté en el esquema**, así
  que un diccionario de claves libres es imposible: lo que se declara por nombre va
  como lista con `name`. Y **`anyOf` se aplica a un campo, no a los elementos de
  una lista**: cuando hacen falta alternativas dentro de un `object[]`, van planas
  y opcionales y quien exige que haya exactamente una es el resolutor.
- **`assert.equal` distingue `-0` de `0`.** Usa `Math.abs` cuando el cero pueda
  venir con signo.
- **Una prueba que pasa no siempre prueba algo.** Un lazo cerrado plano tiene
  holonomía nula, y uno simétrico también: la primera versión de la prueba del
  residuo del barrido pasaba con `-9e-16` sin comprobar nada. Conviene que el caso
  de control y el caso a medir sean distintos **a propósito**.
