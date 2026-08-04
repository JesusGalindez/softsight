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
| Ruta local | `~/Documents/Dron/softsight` | `~/Documents/Codex/After effect ThreeJS` |
| Remoto | [`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público) | ninguno todavía |
| Qué es | Núcleo verificador: rasterizador por software + banco headless para agentes | Editor de motion graphics 3D, local-first, React + Three.js |
| Motor | CPU, cero dependencias en el núcleo | Three.js (WebGL/WebGPU) |
| Salida | JSON determinista + PNG | Composición `.morphfx`, JSON, WebM |
| Papel | **Produce verdad**: mide, audita y certifica | **Consume verdad**: importa lo ya certificado |
| Plan propio | [`plan-fases-bcd.md`](plan-fases-bcd.md), [`plan-agentes.md`](plan-agentes.md), [`plan-renderizador.md`](plan-renderizador.md) | `PLAN.md` en su repo |

**Regla de la frontera:** el editor nunca importa módulos internos de softsight.
Se comunica solo por el contrato público —CLI, JSON, `--schema`, fixtures— y lo
hace por un único fichero, `src/assets/softsight-adapter.ts`.

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
| Contrato de integración | `SOFTSIGHT_CONTRACT.md` (editor) | fija el commit de softsight que consume |
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
| `softsight:gate` | Poses de control: SoftSight contra Three.js | `npm run softsight:gate` (editor) |
| `softsight:sample-gate` | Muestras de superficie: posiciones y normales | `npm run softsight:sample-gate` (editor) |
| `softsight:gates` | Las dos anteriores, en cadena | `npm run softsight:gates` (editor) |
| `check` | Tipos, pruebas y build del editor | `npm run check` (editor) |

Las dos puertas llevan los fixtures y `--strict` en el propio script, así que se
ejecutan sin argumentos; pasar los tuyos después de `--` los sustituye.

Estado hoy, verificado el 2026-08-03: **ambas puertas en `accepted`, 4 compro-
baciones cada una; 135 pruebas del editor y las nueve de softsight en verde**
(tres del evaluador y seis del puente).

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
3. **UI de estudio.** El editor tiene todas las piezas de un editor profesional
   pero las presenta como una página centrada. Detalle en §6.
4. **B-R2 — deuda estructural aparcada.** Unificar los dos parsers de GLB. No se
   toca hasta que haya un consumidor que lo pague.

Riesgo declarado: D era el mayor cuello de botella, porque el editor dependía
del CLI por proceso. El puente lo cierra: el editor habla con un proceso local
por JSON, y la forma del contrato sale de `--schema`, que no puede divergir.

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

## 7. Higiene del entorno

Cosas que ya estaban rotas y conviene no volver a romper:

- **El editor vivía sin repositorio.** `git` lo resolvía contra el `~/.git` de la
  carpeta personal, donde no había ni un fichero suyo seguido: una única copia en
  disco, sin historial. Ya tiene repositorio propio. **Le falta remoto**: hasta
  que lo tenga, sigue existiendo en una sola máquina.
- **El `~/.git` de la carpeta personal sigue ahí**, con `origin` apuntando a
  `JesusGalindez/3Dcards` y tres commits que solo contienen un README. Cualquier
  `git` ejecutado desde `~` sin repositorio más cercano cae en él. No se toca
  desde aquí porque borrarlo no es reversible; conviene revisarlo aparte.
- **Nombres divergentes del editor**: el directorio se llama `After effect
  ThreeJS`, el paquete `softsight-motion-editor` y el remoto heredado era
  `3Dcards`. Tres nombres para una cosa. Renombrar el directorio rompe rutas
  absolutas (`.claude/launch.json`, scripts), así que es un cambio a hacer a
  propósito, no de paso.
- `.claude/launch.json` no se versiona en ninguno de los dos repos: lleva rutas
  absolutas de esta máquina.
