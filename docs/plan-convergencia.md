# Plan: convergencia

Cómo se conecta lo que ya existe, cómo se demuestra que encaja y cómo se
optimiza sin dejar de poder afirmarlo. Cruza los dos repos, como
[`plan-historias.md`](plan-historias.md); el estado sigue llevándose en
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5 y en ningún otro sitio.

No toca el plan del motor del editor (`docs/PLAN_MOTOR.md`): F4 —API de agentes y
MCP— y F5 —scopes— son suyos y siguen su orden. Aquí solo está lo que ninguno de
los dos planes cubre porque cae **entre** los dos repos.

---

## 0. Reparto del trabajo — antes que cualquier código

Dos procesos escriben hoy el mismo repositorio del editor sin ninguna regla. El
2026-08-04 se salvó comprobando a mano que los cambios de cada uno no se pisaban.
Eso no es un método: es que salió bien. Y es lo único de este documento que puede
**destruir trabajo ya hecho**, así que va primero y no en las precondiciones.

Lo correcto sería un árbol de trabajo por plan (`git worktree`), con su propio
`HEAD`. No se hace hoy por una razón concreta: cada árbol necesita su
`node_modules` —217 MB en el editor— y la máquina llegó al 100 % de disco el
2026-08-04. Queda como el arreglo bueno para cuando haya sitio.

Mientras tanto, **reparto por directorios, escrito**. Cada fichero tiene un plan
dueño; quien no es el dueño no escribe, aunque le venga de paso:

| Territorio | Dueño | Notas |
|---|---|---|
| `src/engine/**`, `src/export/**`, `docs/PLAN_MOTOR.md`, `THIRD_PARTY.md` | plan del motor | Incluye el rasterizador CPU y los backends |
| `src/core/**`, `src/ui/**`, `src/assets/softsight-*`, `public/fixtures/softsight-*` y los del contrato, `scripts/softsight-import.mjs`, `scripts/create-story-*`, `scripts/*parity*`, `SOFTSIGHT_*.md` | este plan | Guion, roles, interfaz, el pin y las puertas de paridad |
| `package.json` | compartido | Solo se añaden líneas de `scripts` o dependencias; nadie reordena ni reformatea |
| `src/styles.css` | compartido | Todo el estilo del editor vive en un fichero. Se **añaden bloques al final de su sección**; no se toca una regla ajena |
| `AGENTS.md`, `README.md` | compartido | Se añade sección, no se reescribe la ajena |
| Todo softsight | este plan | El otro plan no entra en el otro repo |

Tres reglas que hacen que el reparto sirva de algo:

1. **`git status` antes de tocar nada**, y lo que no sea tuyo no se toca ni para
   arreglarlo. Se dice.
2. **Un commit no mezcla territorios.** Si un cambio los cruza, es señal de que
   la frontera está mal puesta: se discute, no se commitea.
3. **Nadie hace `git switch` ni crea ramas en un árbol compartido.** Mover `HEAD`
   arrastra el trabajo sin commitear del otro proceso a una rama que no es suya.

---

## 1. El problema que este plan resuelve

Las dos mitades han crecido a la vez y han llegado a solaparse. Hoy hay **dos
rasterizadores por software**: `src/soft/` en softsight, y `src/engine/cpu/` en
el editor —raster de Pineda, MSAA 4x, IBL pre-horneada, kernel en Rust a WASM
SIMD, con su contrato de determinismo—. El editor compara su CPU contra su GPU;
la palabra `softsight` no aparece en ese directorio.

Por la regla del [mapa](mapa-del-proyecto.md) §1 eso es **deuda certificada**: el
editor calcula algo que softsight sabe calcular y nadie ha comparado los dos
números. Y es la deuda más cara que se puede contraer aquí, porque el producto se
sostiene sobre una sola afirmación —el resultado es exacto y comprobable— y esa
afirmación es justo la que dos rasterizadores sin comparar ponen en duda.

Lo mismo, en pequeño, pasa con el guion: el contrato, la auditoría y los roles ya
existen, pero nadie encadena las piezas, así que el bucle autónomo del
[plan de historias](plan-historias.md) §6 sigue siendo un dibujo.

Este plan hace tres cosas, en este orden: **conectar**, **cerrar el bucle** y
**optimizar con número**. La optimización va la última a propósito: optimizar
antes de tener la puerta que dice si el resultado sigue siendo el mismo es cómo
se rompe un motor determinista sin enterarse.

---

## 2. Lo que no se hace

- **No se escribe un tercer rasterizador**, ni se reescribe ninguno de los dos.
- **No se unifican** los dos rasterizadores en este plan. Unificar sin una puerta
  que compare sus salidas sería mover código a ciegas. Primero la puerta; si
  después de tenerla la unificación sigue mereciendo la pena, será otro plan y
  con datos.
- **No se compara color contra color y se llama a eso paridad.** Dos modelos de
  sombreado distintos nunca coinciden pixel a pixel, y una puerta que exige lo
  imposible se acaba desactivando. Lo que se compara está en §3.
- **No se convierten heurísticas en errores**, igual que en el plan de historias.
- **No se toca F4 ni F5** del plan del motor.

---

## 3. Qué se compara, con qué número y en qué condiciones

### 3.1 Qué se compara

| Qué | Cómo se juzga | Por qué se puede afirmar |
|---|---|---|
| **Silueta** — máscara de cobertura por píxel | **Duro.** Cero píxeles discrepantes fuera del borde; el borde tolera **un píxel** por el antialiasing | Depende de proyección, recorte y regla de relleno, no del sombreado |
| **Cajas de pantalla por pieza** (`partScreenBoxes`, ya existe) | **Duro.** Iguales al píxel | Aritmética de cámara pura |
| **Orden de oclusión** — qué pieza tapa a cuál | **Duro.** Idéntico | Orden, no valor. Un solape invertido es un fallo de geometría |
| **Color** | **Aviso**, con tolerancia por canal, mediana y media | Dos sombreados distintos no tienen por qué coincidir |

La tolerancia de color **viaja en el informe**, como el ritmo de lectura del
guion: es una suposición declarada, no una medida. Y el umbral se fija **antes**
de implementar la puerta, no después de ver el resultado: un umbral elegido
mirando el fallo es un umbral que siempre pasa.

### 3.2 Configuración canónica

Sin esta lista, cada divergencia legítima parece un fallo y el paso A3 no termina
nunca. Para comparar, las dos vías se ponen así:

- Antialiasing **apagado** en ambas (el MSAA 4x del editor y el suavizado de
  softsight).
- Sin postproceso, sin sombras, sin IBL: **sombreado plano** con una sola luz
  direccional declarada.
- Misma resolución, misma relación de aspecto, misma cámara —la de softsight,
  que es la que ya está certificada—.
- Mismo espacio de color declarado en el informe; si difieren, es hallazgo del
  paso A0, no ruido.

### 3.3 Cuándo se abandona

Cada paso duro lleva su condición de rendición, y el A4 la lleva por escrito: si
tras **dos intentos acotados** la paridad de color no baja del umbral, se declara
que **el color no se compara** y se documenta por qué. La silueta, las cajas y el
orden no se negocian; el color sí. Un plan sin condición de rendición produce
trabajo infinito justo en su punto más difícil.

---

## 4. Orden de construcción

Cada paso deja **los dos repos verdes** y se puede parar ahí.

### Fase A — Los dos rasterizadores dejan de ignorarse

**A0. Sonda exploratoria** (hecha el 2026-08-05, desechable, sin puerta).
Rasterizar el mismo GLB por las dos vías y **mirar cuánto divergen**, antes de
escribir ninguna puerta. Un plan que no admite que su primer paso es averiguar
algo está fingiendo saberlo.

Resultado: **cero píxeles de desviación** en 12 cajas de pantalla, seis vistas y
las dos proyecciones —perspectiva y ortográfica—, comparando la aritmética de
cámara de SoftSight contra la de Three.js con la misma cámara. La sonda vive en
`scripts/parity-probe.mjs` del editor y pide la escena por el puente.

Dos hallazgos, y los dos cambian el plan:

1. **El informe no publicaba la cámara.** `RenderedView` la tenía, pero el
   informe la tiraba al serializar, así que nadie de fuera podía reproducir el
   encuadre sin copiar internos de SoftSight —y entonces no compararía dos
   renders, sino dos copias del mismo código—. Arreglado: `ViewReport.camera`
   viaja en el informe. El `contractVersion` sigue en 2: añadir un campo no
   rompe a ningún consumidor, mismo criterio que el comando nuevo del puente.
2. **La primera medida daba 2 px de desviación constante, y no era geometría.**
   SoftSight ensancha su caja de pantalla un píxel por el anillo del
   antialiasing y usa `floor`/`ceil`; la sonda redondeaba. Con la misma
   convención, cero. Es exactamente el error que §3.2 existe para evitar:
   **medir la convención y creer que mides la proyección.**

Consecuencia para la fase: la proyección **no es el problema**, así que A4 es
pequeño y A3 puede exigir cajas exactas al píxel desde el primer día. Lo que
queda por medir es la silueta rasterizada, que es donde pueden aparecer la regla
de relleno y el recorte.

**A1. Declarar la frontera** (softsight, documentación). El mapa §1 dice qué
rasterizador manda para qué: el de softsight certifica assets y produce verdad;
el del editor da paridad de export y funciona sin GPU. Sin esa línea escrita, el
próximo agente escribe el tercero.

**A2. Fixtures de paridad** (softsight). Dos, y los dos declarados desde ahora:

- **fácil** — escena declarativa mínima: dos primitivas, una luz, cámara fija.
- **difícil** — el dron atado, que ya existe y ya tiene hashes de control:
  skinning, 296 piezas, normales y degenerados de verdad.

El fácil entra en la puerta primero; el difícil entra después, pero se declara
ahora porque lo que no se declara al principio no lo añade nadie luego. Una
puerta que solo mira dos cubos no protege nada.

**A3. Puerta de paridad** (hecha el 2026-08-05; `npm run softsight:parity-gate`).
Enfrenta softsight con el rasterizador CPU del editor sobre el fixture fácil, con
los criterios de §3.1 y la configuración de §3.2.

**La GPU del editor no entra**, y no por olvido: una puerta en Node no tiene
contexto WebGL. El editor ya compara su CPU contra su GPU en `cpu-parity.ts`, así
que la cadena se cierra por transitividad —softsight ↔ CPU ↔ GPU— y lo que
faltaba era el primer eslabón, que es este.

Estado: **rejected**, y con motivo medido. La vista en perspectiva da **paridad
exacta: 0 píxeles de diferencia sobre 9.251 cubiertos**. Las tres ortográficas
dejan un resto pequeño —4, 78 y 188 píxeles sobre 13.422, 13.484 y 44.250— y el
mapa de discrepancias dibuja **el arco de la esfera**: es la regla de inclusión
de borde en siluetas curvas, no geometría. La máscara del editor sale
sistemáticamente un píxel más gorda, y donde la arista queda casi tangente a la
rejilla la banda llega a dos píxeles, que es más de lo que §3.1 tolera.

Por el camino la puerta cazó dos cosas que no eran del rasterizador, que es
exactamente para lo que sirve:

- **El suelo de referencia.** softsight lo añade como contexto y no entra en el
  GLB exportado; compararlo era comparar dos escenas distintas. Se pide sin él.
- **La profundidad del rasterizador del editor.** `drawTriangle` interpola
  `clipZ` **sin dividir por w** y lo compara contra `depthClear`, así que con una
  perspectiva de verdad la prueba de profundidad ocurre en el espacio equivocado
  y descarta fragmentos: la vista 3/4 perdía la mitad de su cobertura. La puerta
  entrega las coordenadas ya divididas, único régimen donde ese contrato se
  sostiene. **Arreglarlo cae en `src/engine/cpu/`, territorio del plan del
  motor**, y no se toca desde aquí.

**A4. Arreglar lo que la puerta encuentre** (donde toque). Su alcance **es** lo
que A0 y A3 descubran; detallarlo antes sería inventarlo. Cada arreglo sube la
versión del contrato de paridad, y la rendición del color está en §3.3.

**A5. El fixture difícil entra en la puerta.** Con skinning y 296 piezas es donde
la paridad significa algo.

### Fase B — El bucle de historias se cierra

**B1. Informe de puesta en escena** (editor). Por escena y por frame de muestra:
caja de cada capa de texto, color medio del fondo bajo esa caja, y qué capas son
visibles.

Ojo con de dónde sale cada dato, porque es lo que hace este paso pequeño:
**la caja no se mide rasterizando**. `createTextTexture` ya sabe el tamaño en
píxeles de la textura y de ahí, con la proyección de la cámara, la caja en
pantalla sale por aritmética exacta. Solo el **color de fondo** necesita un frame
ya rasterizado, y para eso vale la lectura del framebuffer que ya existe. El
rasterizador CPU recibe vértices e interpolantes: no tiene ruta de sprite ni de
texto, y apoyarse en él aquí sería empezar por el sitio equivocado.

**B2. Auditoría de puesta en escena** (softsight). Consume ese informe y devuelve
las tres comprobaciones que el plan de historias dejó pendientes por imposibles:
`ESCENA_VACIA`, `CAJA_FUERA_DE_CUADRO` y `CONTRASTE_INSUFICIENTE` —ratio WCAG,
que es aritmética—. Se publica por `--schema` y llega por el puente como comando
`staging`. *Cierra: `test:story` ampliada, API == CLI == puente.*

**B3. El bucle, encadenado** (editor). `brief → guion → puesta en escena →
render`, con la puerta entre paso y paso y parada en la primera que avise. Es el
§6 del plan de historias, que hoy existe en piezas sueltas. *Cierra: una pieza
que entra como guion y sale como WebM, sin manos.*

### Fase C — Que una persona pueda usarlo

Ordenada por valor entregado y no por comodidad de implementación.

**C1. Marcas de escena en la línea de tiempo** (editor): cortes en la regla,
nombre de la escena activa en la barra de estado, saltar a la siguiente y a la
anterior con teclado. Solo lee el `activeScene` que ya calcula el evaluador.

**C2. Renderizar una pieza desde su guion** (editor): `guion.json → WebM` con el
perfil determinista de F2.3. Va antes que el panel de edición porque convierte
todo el plan de historias en un fichero que se puede enseñar, y cuesta menos.

**C3. Panel de guion** (editor): nombre, rol y duración por escena, con
`createSetScenesCommand`, que ya existe y ya tiene undo. La duración de la
composición se muestra derivada y no editable, como manda el esquema 12.

### Fase D — Optimizar, con número antes y después

**D1. El instrumento, antes que la optimización** (editor). Banco reproducible:
Chrome propio en primer plano, `mediana` y `p1` de la barra de estado, escena y
duración fijas, resultado en un fichero versionado. Medir desde el panel
integrado no vale —estrangula `requestAnimationFrame` a cero fuera de primer
plano—, y ya está avisado en el mapa §5.

**D2. Volver a medir antes de priorizar.** El 6,16 ms de `evaluateParticleMorph`
con 50.000 partículas es **anterior a F0–F3**: caché de frames, gestor de calidad
y LOD con meshopt han entrado desde entonces. Puede que el cuello ya sea otro.
Optimizar contra un número caducado es trabajar para nadie.

**D3. El cuello que confirme D2, primero en CPU.** Si sigue siendo el morph:
estructura de arrays, búferes reutilizados entre frames, cero asignaciones en el
bucle. *Cierra: el banco de D1 y la paridad de A3 —mismo resultado, menos
tiempo—.*

**D4. Compute**, solo si D3 no basta. WebGPU sobre `renderer-backend`, aceptado
únicamente si la paridad respalda que el resultado no cambió. Un cambio de
rendimiento que no se puede afirmar exacto no entra.

**D5. Las cinco de la lista** (softsight), ya identificadas en el mapa §5: áreas
y pesos √área precomputados por GLB, `decodedViews` reutilizados entre frames, un
solo `AnimationMixer` por lote, caché de muestras con clave `(GLB, semilla)`, y
`--summary`/`--quiet` para CI. Son independientes: entran de una en una, cada una
con su medida, y las puertas byte a byte que ya existen dicen si algo cambió.

### Fase E — Verificación de lo que se ve

**E1. Paridad de encuadre** (los dos). Las cajas de pantalla de softsight contra
las del editor para la misma cámara. Detecta un FOV o un aspect desalineados en
un frame en vez de después de novecientos.

**E2. Auditoría 2D del movimiento** (softsight). La de hoy es 3D —cruces entre
piezas, suelo atravesado—. Con `renderDiff` y los pliegos por frame se audita lo
que de verdad se ve: un elemento que sale de cuadro, una entrada que ocurre fuera
del encuadre, dos piezas que se tapan durante veinte frames.

---

## 5. El coste de las puertas

Una puerta lenta se acaba saltando, así que se presupuesta desde el principio.
Hoy `npm run check` del editor son 344 pruebas y la suite de softsight, 19
comprobaciones con dos builds.

| Cuándo corre | Qué | Presupuesto |
|---|---|---|
| En cada `npm run check` | Lo que ya hay, más el contrato de roles y la auditoría de puesta en escena —todo aritmética, sin render— | +5 s como mucho |
| Bajo demanda y antes de commitear | `softsight:parity-gate` con el fixture fácil | 30 s |
| Antes de cerrar una fase | Paridad con el fixture difícil, y el banco de D1 | minutos, y está bien |

Una puerta que pasa de su presupuesto se parte en dos o se saca de `check`. Lo
que no se hace es dejarla lenta y esperar que nadie la desactive.

---

## 6. Qué queda fuera y hay que arreglar igual

- **El editor sigue sin remoto.** Todo esto existe en una sola máquina. Es la
  primera línea de la higiene del mapa §8 y sigue ahí.
- **El disco llegó al 100 %** el 2026-08-04. Mientras siga así, no hay árboles de
  trabajo separados y el reparto de §0 es lo único que protege el trabajo.

---

## 7. En qué orden importa de verdad

Si solo se hacen tres cosas de este documento: **A0, B2 y C1**.

A0 porque decide el tamaño de todo lo demás y hoy nadie sabe la respuesta. B2
porque cierra el plan que se acaba de terminar y convierte el bucle en algo que
corre solo. C1 porque es lo que hace que una persona vea lo que un agente lleva
semanas pudiendo hacer.
