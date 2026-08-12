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
   para procesos: JSON limpio a stdout, progreso a stderr, salida 1 si hay un
   defecto —un aviso de severidad `certeza`—.
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
| Encuadre del pliego (cámaras y cajas) | `views[].camera` y `partScreenBoxes` del informe | el editor los consume y fija el control `artifacts/agent/encuadre-control.json`; la cámara se usa con aspecto 1 sobre un tile cuadrado |
| Decisiones de la frontera con VideoMesh | [`contrato-videomesh.md`](contrato-videomesh.md) | una decisión que no está ahí no existe; los documentos de intercambio son historial, no contrato |
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
| `test:bridge` | El puente contra el CLI real —sample, inspect, render, patch y schema— y, en tercera columna, el modo residente contra el puente por proceso byte a byte, más veinte peticiones iguales seguidas al mismo proceso | `npm run test:bridge` (softsight), también dentro de `test:animation` |
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
| `test:agents-md` | El `AGENTS.md` commiteado contra el regenerado de `package.json` y `--help`, y su techo de 120 líneas | `npm run test:agents-md` (softsight), también dentro de `test:animation` |
| `test:framing` | Que el informe basta para reproducir el encuadre: las 84 cajas de `partScreenBoxes` de cuatro fixtures, recalculadas con la cámara publicada tras pasar el informe por JSON, más el control congelado que fija el editor | `npm run test:framing` (softsight), también dentro de `test:animation` |
| `test:screen` | La auditoría 2D del movimiento contra fotogramas calculados a mano: fuera de cuadro, entrada a ciegas, oclusión prolongada, el umbral que manda y lo que ya se tapaba en reposo; más el ejemplar animado por el CLI | `npm run test:screen` (softsight), también dentro de `test:animation` |
| `test:incremental` | El informe con contrato de topología, con la caché de auditoría fría, caliente y sin caché, y tras un parche que cambia la malla | `npm run test:incremental` (softsight), también dentro de `test:animation` |
| `test:mcp` | Cada una de las siete herramientas MCP contra el CLI directo —informe, pliego y GLB byte a byte—, y que los esquemas de parámetros son la traducción de `SCENE_SCHEMA` y `PATCH_SCHEMA` | `npm run test:mcp` (softsight), también dentro de `test:animation` |
| `test:summary` | El informe recortado contra el completo: cada clave del resumen es la misma, el resumen del dron cabe en 2.000 B, una ruta de `--fields` que no existe sale 2 con sugerencia, y la unión de las siete partes de `--schema` es el `--schema` completo | `npm run test:summary` (softsight), también dentro de `test:animation` |
| `test:text-plan` | El plan de cartel: normalización de la copia, geometría de la caja, la escala que cabe, los colores por rol y la integración con el render | `npm run test:text-plan` (softsight), también dentro de `test:animation` |
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
motivo impreso. El verde de CI son tipos, determinismo en dos sistemas y **17 de
las 22 puertas, con 97 de las 104 comprobaciones**; las cinco restantes solo las
cierra una ejecución local con los dos repositorios al lado. La ruta se resuelve en `tools/fixtures.mjs` y
`SOFTSIGHT_FIXTURES` la sustituye.

Estado hoy, verificado el 2026-08-10: **ambas puertas en `accepted`; las 104
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
    plan del motor, no de este. **A5 hecho el 2026-08-05**: el dron entra en la
    puerta y pasa, y los tres fixtures corren en seis segundos contra los treinta
    de presupuesto. **E2 hecha el 2026-08-10**: `screenAudit.ts` audita lo que se
    ve —fuera de cuadro, entrada a ciegas, oclusión prolongada— proyectando la
    caja de cada pieza con la cámara del pliego, sin rasterizar; puerta
    `test:screen`. **E1 hecha por la mitad el 2026-08-10**: la de softsight —el
    informe basta para reproducir el encuadre, 84 cajas con cero diferencias, y
    el control congelado en `artifacts/agent/encuadre-control.json` que el editor
    fija—; la del editor, comparar sus cajas contra las nuestras, sigue allí.
14. **Geometría compleja declarativa** (hecha). El agente ya no está limitado a
    colocar primitivas: perfiles con nombre —círculo, superelipse, Gielis y NACA—,
    `loft` de secciones **con recorrido opcional**, `sweep` de un perfil por un
    recorrido, cuatro deformadores en cadena y `repeat` radial y espejo. Todo con su número exacto:
    dos secciones iguales dan lo mismo que una extrusión, un barrido cerrado da lo
    mismo que el toro, y la torsión conserva el volumen firmado. Plan cerrado en
    [`plan-geometria.md`](plan-geometria.md), puerta `test:geometry` con 46
    comprobaciones, ejemplar en `artifacts/agent/pieza-geometria.json`. El
    recorrido del `loft` llegó el 2026-08-11 desde la §9 de su plan y sin
    maquinaria nueva: `createSweep` se abrió a llevar **el perfil por estación**,
    así que un loft de dos secciones iguales por una curva da la misma malla que
    barrer ese perfil por ella —2,2e-16, el epsilon del doble—.
15. **El informe separa defecto de observación** (hecho el 2026-08-10). Cada aviso
    publica su `severity` —tomada de `warningCodes.ts` en el sitio donde se emite,
    no escrita a mano— y el código de salida cuenta **certezas**, no avisos. Lo que
    lo forzó fue una medida: el ejemplar `artifacts/agent/pieza-geometria.json`
    daba 14 avisos, los 14 de `SIMETRIA_ROTA` y `PIVOTE_DESCENTRADO`, cero
    defectos, y **salía 1**; la pieza que un agente copia lo primero fallaba la
    orden. `PIVOTE_DESCENTRADO` pasa a `candidato` porque la medida es exacta pero
    la conclusión supone que la pieza va a rotar, que es intención. Ningún aviso
    desaparece —los 14 siguen en el informe y el ejemplar sale 0— y ningún hash se
    movió: el pliego del dron sigue en `46228b7c` y `contractVersion` en 3. La
    puerta `test:geometry` deja de excusar dos códigos y exige cero avisos de
    `certeza` sobre el ejemplar. Queda anotado en
    [`plan-geometria.md`](plan-geometria.md) §9.
16. **Pesos declarados por fórmula** (hecho el 2026-08-10; plan cerrado). Ver [`plan-pesos.md`](plan-pesos.md). Es
    el desbloqueo que sigue al atado rígido de E4 —piel suave, mallas continuas—
    sin cruzar la línea que E4 trazó: el agente declara la región y la curva, la
    herramienta evalúa una función determinista, y nadie adivina a qué hueso va
    un vértice. `blend` en la regla del vínculo reparte el peso entre dos huesos
    a lo largo del segmento que los une en reposo, con la misma tabla de
    variación que describe una forma o un movimiento. **La costura del codo pasa
    de 0,106066 a 6,7e-8** —el suelo de ruido de `Float32`, que ya trae 3,0e-8 en
    reposo— y el atado rígido sale **byte a byte** igual que antes. El paso que
    podía matar el plan, el cierre cruzado, salió a favor: los cuatro hashes de
    control del GLB con pesos declarados **coinciden con Three.js**, con el
    control congelado en `artifacts/agent/codo-banda-poses.json` y la puerta
    `test:blend-contract`, que corre también en CI porque compara un número y no
    ejecuta nada del editor. `skinAudit.ts` añade los cuatro invariantes
    —`VERTICE_SIN_HUESO`, `PESOS_SIN_SUMAR`, `COSTURA_ROTA` y
    `TORSION_APLASTADA`—, con lo que la tabla de códigos pasa de 36 a 40. La
    costura solo se reprocha **donde hay banda**: dos piezas rígidas atadas a
    huesos distintos que comparten vértices tienen pesos distintos por
    definición, y avisar ahí sería repetir el ruido de `SIMETRIA_ROTA`. El
    ejemplar es `artifacts/agent/codo-banda.json`, limpio de defectos y
    certificado por la misma puerta. Límite conocido: una regla lleva **una**
    banda, así que una pieza intermedia solo suelda uno de sus dos extremos.
    Se alcanza por los cuatro caminos —API, `--scene`, `--bind` y el puente—, y la
    puerta comprueba que los tres primeros dan **el mismo GLB byte a byte**. El
    informe publica `mode` y `blendedParts`, que antes eran el literal `"rigid"`.
    `contractVersion` sigue en 3 y `bridgeContractVersion` en 1: todo es aditivo.
    Una regla admite **una banda o una lista** —tres como mucho, porque la cuarta
    influencia de glTF se la lleva siempre su hueso—, con lo que una pieza con
    costura por los dos extremos suelda las dos: el ejemplar
    `artifacts/agent/brazo-articulado.json` pasa de abrirse 9,6e-2 y 4,5e-2 a
    7,0e-8 y cero. Solapar bandas vale; que entre todas se lleven más de 1 es un
    error del atado, porque dejaría al hueso de la regla en negativo.
17. **B-R2 — deuda estructural aparcada.** Unificar los dos parsers de GLB. No se
   toca hasta que haya un consumidor que lo pague. **Ya lo hay, desde el
   2026-08-12**: D32 del contrato con VideoMesh exige que la conversión entre la
   convención canónica de matrices y la de glTF ocurra **exactamente una vez**, en
   el adaptador de frontera. Dos parsers son dos sitios donde podría ocurrir, y
   dos transposiciones sin dueño se cancelan o se duplican sin que nada salte. No
   bloquea `cube-v1`, que no exporta glTF; bloquea la primera exportación de
   producción.
18. **Plan Ω — el coste por turno del agente** (hecho, salvo Ω6.4, que vive en el
    editor). Ver [`plan-omega.md`](plan-omega.md), que lleva la tabla de antes y
    ahora. No añadió funcionalidad: atacaba lo que hacía caro operar el banco
    —16,5 KB por turno, 10.000 tokens de descubrimiento, 0,10 s de arranque por
    llamada y 47,3 s de suite— y el hueco de que nada de esto lo ejecutaba una
    máquina. **Ω4 hecha el 2026-08-09**: CI en tres
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
    construido y no recalculan nada. **Ω1.4 hecha**: `--schema <parte>` baja el
    descubrimiento de 46.226 B a 12.321 el parche o 940 la muestra, y el completo
    se construye uniendo las partes. **Ω5 hecha**: `AGENTS.md` en la raíz, 110
    líneas, con las secciones de comandos, puertas y banderas generadas por
    `tools/agents-md.mjs`. **Ω2 hecha**: `agent3d --serve` atiende las peticiones
    del puente sin morirse entre una y otra —0,454 s por proceso contra 0,143 s
    residente, un 69 % menos—, importando `handleRequest` de `bridge.mjs` para no
    tener dos contratos; y `tools/lru.mjs` deja el criterio de expulsión escrito
    una vez para las tres cachés, con lo que `.cache/` deja de crecer sin tope.
    **Ω3 hecha**: `tools/mcp-server.mjs` publica siete herramientas tipadas por
    JSON-RPC sobre el modo residente, con los esquemas de parámetros generados de
    `SCENE_SCHEMA` y compañía; el servidor traduce a una petición del puente y no
    decide nada. **Ω6 hecha salvo Ω6.4**, que vive en el editor: `sample-surface`
    de 50,4 s a 0,8 s, la suite de 61 s a 34,5, y el contrato de topología de
    0,46 s de CPU a 0,02 gracias a una caché de auditoría con clave en la huella
    de la malla. Ningún hash se movió: el pliego del dron sigue en `46228b7c`.
19. **Reconstrucción y certificación de producción** (sin empezar; el registro de
    decisiones abierto). El orden de trabajo está en
    [`plan-reconstruccion.md`](plan-reconstruccion.md) y **las decisiones de la
    frontera en [`contrato-videomesh.md`](contrato-videomesh.md)**, que es lo que
    rige. **Ronda de diseño cerrada el 2026-08-12 tras tres vueltas: 34 decisiones
    acordadas, 12 principios, ninguna en PROPUESTA y ninguna implementada**,
    porque ninguna tiene todavía una prueba que falle sin ella. El registro queda
    congelado —solo se admiten decisiones que bloqueen `cube-v1`— y el único
    movimiento admisible es de acordada a implementada. La primera es D30: ya es
    el comportamiento del código, solo le falta el fixture. Una tercera mitad
    entra en escena: VideoMesh reconstruye desde vídeo y SoftSight mide, verifica y
    certifica lo que salga, sin convertirse en un motor de fotogrametría. Las
    secciones 0–83 las escribió el agente de VideoMesh; las 84–86 son la respuesta
    de este lado tras contrastarlas contra el código, y mandan donde se
    contradigan. **No se escribe código hasta cerrar tres cosas**: por dónde viaja
    el paquete —el puente lleva los ficheros en base64 dentro del JSON, con topes
    de 256 MB y 120 s, y un paquete de reconstrucción no cabe por ahí—; si
    `reconstruction/` y `production/` viven aquí o en un tercer repositorio que
    consuma el contrato público, porque doblan las 19.565 líneas de `src/soft/`;
    y en qué idioma van los códigos nuevos, porque la tabla de `warningCodes.ts`
    es una y la comparan las dos direcciones de `test:codes`. De lo ya contrastado,
    lo que cambia el orden de trabajo es que el techo de tamaño no está donde el
    plan creía: `mesh.ts` ya es de arrays tipados, y quien no escala es
    `auditMesh` —`Map` con clave de texto por vértice en `inspect.ts:69` y otro
    de aristas en `inspect.ts:118`—, así que reescribirlo sin `Map` va antes que
    cualquier árbol de triángulos. Ese árbol, además, **no se llama `bvh.ts`**:
    ese nombre ya es de la captura de movimiento.

**Aviso de alcance sobre E4.** El plan excluye a propósito el rigging, la IK y
el retargeting. E4 **no los introduce**: no calcula ni un solo peso. Aplica un
vínculo declarado y verifica que es completo y coherente, que es trabajo de
banco de verificación. La línea queda donde estaba, y conviene no cruzarla: en
cuanto la herramienta decida por su cuenta a qué hueso va un vértice, deja de
poder afirmar que el resultado es exacto, y con ello se va el valor de todo lo
demás. Lo que falte de pesos suaves lo trae quien los tenga, por `JOINTS_0` y
`WEIGHTS_0` —o lo declara el agente, si algún día se hace
[`plan-pesos.md`](plan-pesos.md), que existe para dejar esta línea donde está—.

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

- Precomputar áreas y pesos √área en `Float64` una vez por GLB. **Hecho** (Ω6.2).
- Reutilizar `decodedViews` entre frames consecutivos. **Hecho** (Ω6.3): con las
  dos, `sample-surface` pasa de 50,4 s a 0,8 s y la suite de 61 s a 34,5.
- Un solo `AnimationMixer` por lote de frames en `create-sample-contract.mjs`;
  hoy se crea uno por frame. **Ese fichero vive en el editor**, no aquí.
- Ampliar la caché del CLI a las muestras, con clave `(GLB, semilla)`. **Sigue
  sin fase y ahora se sabe por qué**: no hay consumidor aquí. `sampleSurface` con
  semilla lo llaman el editor y la puerta; el `--sample` del CLI evalúa
  referencias que ya vienen dadas.
- Modo `--summary`/`--quiet` en `agent3d`: **hecho**, Ω1.1 y Ω1.2.

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
