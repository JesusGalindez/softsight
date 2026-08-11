# Plan: los pesos se declaran, no se adivinan

Estado: **cerrado** (2026-08-10). Los seis pasos hechos, y una de las ideas de §9
—más de una banda por regla— también, porque el paso 5 le encontró el caso. Lo que
queda ahí son ideas sin caso todavía. El paso que podía
matar el plan salió a favor: los pesos declarados deforman en Three.js exactamente
igual que aquí. Nace de la nota que
[`plan-movimiento.md`](plan-movimiento.md) §8 dejó anotada y que §2.4 del mismo
documento mandó a un plan propio, por una razón que sigue siendo la buena: quitar
el atado rígido es el desbloqueo grande **y** toca la única línea que este
repositorio trazó a propósito. Un plan que no empiece por dónde queda esa línea
acabaría cruzándola sin darse cuenta.

Hoy un agente puede construir un personaje entero en JSON —huesos, vínculo,
clips— y recibir hechos comprobables sobre su movimiento. Lo que no puede es que
ese personaje **se doble**. Cada vértice pesa 1 sobre un solo hueso, así que un
codo es una bisagra con grieta y una malla continua no tiene forma de entrar.

---

## 1. El hueco, medido

`bindModelToSkeleton` en [`skinBinding.ts`](../src/soft/agent/skinBinding.ts)
escribe hoy, para cada vértice, un solo hueso con peso 1. La consecuencia se lee
mejor por lo que se puede y no se puede declarar:

| Lo que se quiere decir | Lo que hay hoy |
|---|---|
| «el rotor gira con el brazo» | exacto: la pieza es rígida de verdad |
| «el codo se dobla» | dos piezas y una grieta, o una sola pieza que gira entera |
| «esta malla continua es un brazo» | no entra: no hay forma de repartir un vértice |
| «la piel cede alrededor de la articulación» | lo trae quien lo tenga, por `JOINTS_0`/`WEIGHTS_0` |

**El paso 0 era medir la grieta**, porque nadie había puesto el número y este
documento no iba a estimarlo. Ya está: **0,106066 unidades a 90°, 39,6 px sobre un
tile de 320**, y resulta ser exactamente la cuerda `2·r·sin(θ/2)`. El detalle y el
veredicto, en §5.

Lo que sí está medido es el otro lado, y cambia el tamaño del plan: **la mitad de
lectura ya existe y ya está certificada**. `applySkin`
([`animation.ts:1060`](../src/soft/agent/animation.ts)) hace mezcla lineal de
**cuatro** influencias, normaliza el total y reproduce el redondeo de
`GLTFLoader` con `Math.fround` para que la suma cuadre con el renderizador de
referencia. La puerta `animation-contract` lo cierra contra el evaluador del
editor. Es decir: softsight **ya sabe verificar pesos suaves que no sabe
escribir**, que es exactamente la asimetría con la que nació E1 y que se cerró
escribiendo el lado que faltaba. Aquí pasa lo mismo, y por eso el instrumento de
verificación no hay que construirlo.

---

## 2. La línea, y dónde queda exactamente

El aviso de alcance del mapa §5 dice: «en cuanto la herramienta decida por su
cuenta a qué hueso va un vértice, deja de poder afirmar que el resultado es
exacto, y con ello se va el valor de todo lo demás».

La distinción que hace posible este plan, y que conviene poder decir en una
frase:

> **Adivinar** es que la herramienta mire la malla y deduzca la intención.
> **Declarar** es que el agente diga la región y la curva, y la herramienta
> evalúe una función determinista sobre datos que él escribió.

Y el matiz que la hace utilizable, porque es donde se confunde: **leer la
posición de un vértice no es adivinar**. Es aritmética sobre una región que el
agente declaró. Lo que sería adivinar es *elegir* la región —qué hueso, hasta
dónde, con qué curva—, y eso se queda entero de su lado.

Tres pruebas para saber si un paso de este plan cruzó la línea:

1. **Dos agentes que declaran lo mismo obtienen los mismos pesos**, bit a bit.
2. **Un resultado que sorprende se explica leyendo el documento**, no el código.
3. **Quitar la declaración no deja un valor por defecto plausible**: deja un
   error, igual que hoy una pieza sin regla no se ata a la raíz por si acaso.

Si un paso necesita una constante que no está en el documento del agente, ese
paso está mal planteado.

---

## 3. Lo que este plan no hace

### 3.1 Pesos automáticos — no

Nada de *bone heat*, envolturas por proximidad ni «átalo tú». Es justo la
funcionalidad que convertiría el banco en un Blender para agentes, y la que
haría imposible afirmar que la salida es exacta.

### 3.2 IK y retargeting — siguen fuera

No los toca este plan ni ningún otro por ahora. La línea de E4 se mantiene.

### 3.3 Cambiar el método de mezcla — no se puede, y está bien

glTF especifica **mezcla lineal**, y es la que hacen Three.js y todo lo demás.
Cambiarla por cuaterniones duales daría mejores codos y **rompería la única
afirmación que sostiene el producto**: que nuestro resultado coincide con el del
reproductor. La pérdida de volumen al flexionar y el retorcido del «envoltorio de
caramelo» en torsión son del método, no un defecto nuestro; se pueden **avisar**,
no arreglar.

### 3.4 Más de cuatro influencias por vértice — no

`JOINTS_0`/`WEIGHTS_0` son cuatro. Un quinto juego existe en el formato y no lo
escribimos: cuatro cubre todo lo que este plan permite declarar, y el aviso de
§5.4 lo dice cuando no cubre.

### 3.5 Pintar pesos — no hay interfaz aquí

Esto es un banco headless. Lo que se vea, se ve en el editor.

---

## 4. La mecánica: una regla dice una función

Hoy una regla del vínculo es `{ part, joint }`. La propuesta es un campo más, y
**solo uno**:

```json
{
  "part": "brazo",
  "joint": "codo",
  "blend": { "with": "hombro", "from": 0.35, "to": 0.65, "ease": "smooth" }
}
```

Se lee: los vértices de `brazo` van a `codo`, salvo en la banda que va del 35 %
al 65 % del segmento `hombro→codo`, donde el peso pasa de uno a otro con la curva
`smooth`.

Cómo se evalúa, sin nada que no esté ya escrito en el repositorio:

1. **El parámetro.** Cada vértice se lleva a espacio de modelo —donde ya lo lleva
   `bindModelToSkeleton` hoy— y se proyecta sobre el segmento que une las
   posiciones de reposo de los dos huesos, que salen de `restWorldMatrices`. El
   resultado, sujeto a `[0, 1]`, es `t`.
2. **La curva.** `ease` es la tabla que ya existe: `linear`, `smooth`, `power:k`,
   evaluada por `evaluateVariation`. **Una fuente por dato**: la misma curva que
   describe una forma y un movimiento describe un reparto de peso, y no hay una
   interpolación nueva que mantener.
3. **El reparto.** Fuera de la banda, peso 1 al hueso que toque; dentro,
   `w` y `1 − w`. Dos influencias como mucho por regla.
4. **La normalización.** La suma se ajusta a uno **al final y una sola vez**, con
   el mismo `Math.fround` que aplica el lector, para que lo que escribimos y lo
   que se lee no se separen en el último bit.

**El atado rígido es el caso degenerado**: una regla sin `blend` da peso 1, y el
GLB tiene que salir **byte a byte igual** al de hoy. Es la propiedad de seguridad
del plan entero —lo que ya funciona no se entera—, y ya está cobrada: el paso 1
la dejó comprobada sobre tres escenas atadas.

---

## 5. Los pasos

### Paso 0 — La medida que faltaba — hecho el 2026-08-10

Un codo declarado como dos cilindros de radio 0,075 que se tocan en el plano de la
articulación, atados a `hombro` y `codo`, doblando 90° en 30 fotogramas. La
costura son **66 pares de vértices que en reposo ocupan la misma posición**, que
es la definición que usará `COSTURA_ROTA`. Evaluado con `evaluatePose`, el mismo
camino que recorre la auditoría:

| Ángulo | Separación (unidades) |
|---|---|
| 0° | 0 |
| 30° | 0,038823 |
| 60° | 0,075000 |
| 90° | **0,106066** |

**La grieta es la cuerda.** La separación medida coincide con `2·r·sin(θ/2)` con
una diferencia máxima de **5e-7** —el redondeo a `Float32` de las posiciones—, así
que los dos caminos independientes que exige la casa ya están: el evaluador y la
trigonometría. Y con eso el número deja de ser de este fixture: **la grieta es
proporcional al radio de la pieza**, no a su longitud ni a la resolución de la
malla. A 90° vale 1,41 radios. Un miembro más grueso se abre más.

En pantalla, proyectando los dos extremos con la cámara que publica
`views[].camera` sobre tiles de 320: **39,6 px en la vista frontal**, que es el
12 % del lado del tile. La vista superior da 123,1 px, y no es que allí sea peor:
es que desde arriba el modelo es un disco de 0,15 y el encuadre se acerca —su
escala es de 163 px por 0,1 unidades contra los 37 px de la frontal—. El número
que hay que citar es el de la frontal.

**Veredicto: el plan sigue.** Una grieta de 40 px sobre 320 no se discute.

Y un hallazgo que cambia el paso 5: **el muñeco versionado no sirve de ejemplar**.
Sus siete piezas dan **cero costuras exactas** —ningún vértice compartido entre
piezas atadas a huesos distintos—; o se cruzan por la caja (`torso` con los dos
brazos) o ni se tocan (`cadera` y `torso` se quedan a 0,056). Es una figura de
piezas sueltas, no un cuerpo articulado, así que ahí una banda no tiene dónde
agarrarse. El ejemplar del paso 5 hay que construirlo con costura de verdad, y el
codo de esta medida es el candidato natural.

### Paso 1 — El sitio del peso, con el rígido intacto — hecho el 2026-08-10

Los pesos dejan de escribirse en el bucle de primitivas y pasan a `weightsFor` en
[`skinBinding.ts`](../src/soft/agent/skinBinding.ts), función pura y **único sitio
donde se decide un peso**. Es lo que este plan va a ir llenando: el paso 2 le
añade la banda y nadie más tiene que enterarse.

Byte a byte, comprobado sobre tres escenas atadas —el muñeco versionado, el
ejemplar de geometría y el codo del paso 0—: **los tres GLB son idénticos**.
`npm run verify` en verde, 21 puertas y 103 comprobaciones, **sin tocar una sola
prueba**: `test:bind`, `test:rig` y `test:determinism` ya comparaban GLB y hashes,
así que la propiedad la verifica lo que ya existía.

Dos cosas salieron distintas de como las escribía este documento, y el documento
se corrige antes que el código:

- **`blend` no entra todavía en `SkinBindingRule`.** Un campo declarado que la
  herramienta ignora es justo lo que `validate` existe para impedir —`positon` sale
  con sugerencia, no en silencio—, y uno que siempre da error es prometer algo que
  no está. El campo entra en el paso 2, el día que hace algo, con su esquema y su
  rechazo.
- **La firma es `weightsFor(vertexCount, joint)`**, no la de tres argumentos que
  proponía el borrador: `noUnusedParameters` está encendido y aquí no se declara
  un parámetro para el paso siguiente. El paso 2 la ensancha cuando tenga qué
  meter dentro.

### Paso 2 — La banda entre dos huesos — hecho el 2026-08-10

`blend` en la regla del vínculo, con su esquema —así que una escena lo acepta y
`--schema` lo publica— y sus rechazos: `with` que no existe, `with` igual al hueso
de la regla, `from ≥ to`, y `ease` desconocido. El de la curva no se comprueba con
una lista propia: se evalúa la banda una vez al resolverla, y quien dice qué curvas
existen sigue siendo `evaluateVariation`.

**El codo del paso 0 pasa de 0,106066 a 6,7e-8.** No se afirma cero exacto, y el
porqué es un hallazgo del propio paso: la costura ya trae **3,0e-8 en reposo**,
antes de doblar nada, porque las dos tapas se generan por caminos distintos
—`0,2 + 0,2` y `0,6 − 0,2`— y `Float32` no los redondea igual. Lo que la puerta
afirma es que doblar 90° no separa la costura más allá de ese ruido: contra la
grieta de antes, un factor de **1,6 millones**.

La banda que lo consigue, y que enseña la mecánica mejor que §4:

```json
{ "part": "antebrazo", "joint": "codo",  "blend": { "with": "hombro", "from": -0.15, "to": 0.15 } }
{ "part": "brazo",     "joint": "hombro", "blend": { "with": "codo",   "from":  0.85, "to": 1.15 } }
```

La misma costura desde cada lado. Las bandas son distintas porque la costura cae a
distinta altura del hueso de cada pieza —en `t = 0` para el antebrazo y en `t = 1`
para el brazo—, y las dos están centradas en ella, así que el vértice compartido
sale 0,5 y 0,5 por los dos caminos.

Entra en `test:bind`, que ahora afirma las dos mitades: **sin banda la costura se
abre exactamente la cuerda medida en el paso 0**, y con banda no se abre. Más los
268 vértices sumando 1 y los 132 de la costura repartiendo mitad y mitad. Cinco
rechazos con su mensaje.

Un intento que no entró, por si a alguien le tienta: escribir las dos influencias
ordenadas por índice de hueso, para que los dos lados de la costura acumulen en el
mismo orden. **No cambia ni un bit** —la suma de dos flotantes es conmutativa, y
este plan no pasa de dos influencias por §3.4—, así que sobra.

*Cerrado: el codo doblado 90° sin grieta, y el rígido byte a byte por tercera vez.*

### Paso 3 — Los invariantes, como avisos con código — hecho el 2026-08-10

`skinAudit.ts`, sobre los pesos ya escritos. Cuatro códigos, y la tabla pasa de
36 a **40**:

| Código | Severidad | Qué mide |
|---|---|---|
| `VERTICE_SIN_HUESO` | certeza | los cuatro pesos de un vértice son cero: se queda clavado en reposo |
| `PESOS_SIN_SUMAR` | certeza | no suman 1, así que se deforma con una mezcla distinta de la declarada |
| `COSTURA_ROTA` | certeza | dos piezas comparten un vértice en reposo y lo reparten distinto |
| `TORSION_APLASTADA` | candidato | la banda reparte donde el hueso gira más de 90° sobre su propio eje |

**`COSTURA_ROTA` solo mira donde hay banda**, y esa es la decisión que evita
repetir el error de `SIMETRIA_ROTA`. Dos piezas rígidas atadas a huesos distintos
que comparten vértices **tienen** pesos distintos: es la definición del atado
rígido, y en un ensamblaje mecánico pasa en cada junta. La banda es lo que declara
la intención de soldar; sin ella no hay nada que reprochar. Comprobado: el muñeco
y el propio codo rígido no sacan ni un aviso.

Nadie declara qué piezas llevan banda: **lo dice el resultado**. Una primitiva con
banda tiene vértices con dos influencias de peso no nulo. Pasarle además el
vínculo a la auditoría sería pasar dos veces el mismo hecho, y el día que
discreparan habría que decidir cuál manda.

`TORSION_APLASTADA` mide el giro **sobre el eje del hueso**, separado del resto
con la descomposición clásica: se proyecta la parte vectorial del cuaternión sobre
el eje y lo que queda, con la escalar, es la torsión. Doblar no lo dispara —la
mezcla lineal se porta bien flexionando—; retorcer 120° sí.

*Cerrado: los cuatro saltan sobre su caso y ninguno sobre el ejemplar. Los dos
primeros no se pueden provocar por la vía pública —el atado escribe pesos válidos
siempre—, así que la puerta le da a la auditoría un resultado roto a mano, que es
la única forma de comprobar que lo caza.*

### Paso 4 — El cierre cruzado — hecho el 2026-08-10, y sale a favor

**Los cuatro hashes coinciden.** Un GLB con pesos declarados por softsight —el
codo con banda, 268 vértices— evaluado por `evaluatePose` y por Three.js con su
`GLTFLoader`, en los fotogramas 0, 10, 20 y 30: **la misma huella SHA-256 de las
posiciones deformadas, bit a bit**. Es el mismo cierre que hizo E1 con el
esqueleto y E2 con el BVH, y significa que softsight escribe pesos suaves que el
reproductor del mundo real reproduce igual.

Con esto **el plan deja de poder morir por §8**, que era lo que este paso venía a
resolver.

Dos decisiones sobre cómo quedó montado, y las dos se apartan de lo que decía
este documento:

- **La puerta corre también en CI.** El borrador daba por hecho una sexta «no
  ejecutada», y no hace falta: lo que se compara es un número, no una ejecución.
  El control vive en `artifacts/agent/codo-banda-poses.json`, lo produce el editor
  con `create-control-pose-fixture.mjs`, y tiene el mismo papel que
  `render-hashes.json` —valor de control, no segunda fuente—. Refijarlo sin mirar
  qué movió los pesos es justo lo que la puerta impide.
- **La comparación es explícita.** `--control-poses` **no verifica nada**: dice
  qué fotogramas evaluar, y publicar los hashes es todo lo que hace. Se comprobó
  falseando un hash de la referencia y el informe siguió saliendo `accepted`, así
  que apoyarse en ese `status` habría sido una puerta de mentira.

`test:blend-contract`, y con dientes comprobados: mover la banda de `0.15` a
`0.16` la pone roja en el fotograma 10. La suite pasa a **22 puertas y 104
comprobaciones**.

*Cerrado a favor. Sigue el paso 3.*

### Paso 5 — Ejemplar versionado y puerta — hecho el 2026-08-10

`artifacts/agent/codo-banda.json` es el ejemplar, y `test:blend-contract` le exige
lo mismo que el ejemplar de geometría: **cero avisos de `certeza`** entre la
escena y la piel. Es lo primero que copia un agente que quiere una piel que no se
abra, y uno con defectos enseñaría justo lo que el banco rechaza.

No hizo falta un fichero nuevo: el paso 4 ya lo había versionado como fixture de
su puerta, y ser las dos cosas es lo correcto —el artefacto que se enseña es el
que está certificado contra Three.js, no uno parecido—.

Y no se reutilizó `muneco.json`, como avisaba este paso: el paso 0 midió que sus
piezas no comparten un solo vértice, así que no hay costura que repartir.

**El ejemplar se quedó en dos piezas por un límite que descubrió este paso.** El
plan inicial pedía un brazo de tres —hombro, codo, muñeca—, y no se puede declarar
limpio: una regla lleva **una** banda, así que la pieza del medio suelda el codo o
la muñeca, pero no las dos. Está anotado en §9, que era donde ya vivía la idea de
repartir entre más de dos huesos; ahora tiene un caso concreto que la pide.

### Paso 6 — Que se alcance por los tres caminos — hecho el 2026-08-10

**API, CLI y puente producen el mismo GLB byte a byte** sobre el ejemplar, y la
puerta lo comprueba. Es lo que ya hacía E3 con el BVH, y aquí importa más: un
reparto resuelto distinto por una vía se vería igual de bien en la imagen.

El campo se publica por `--schema scene` desde el paso 2, así que el
descubrimiento no exige leerse el repositorio, y `--help` lo cuenta en `--bind`.
`bridgeContractVersion` sigue en 1: añadir un campo opcional no rompe a nadie.

Tres huecos que este paso encontró en la ruta `--model --skeleton --bind`, que es
la cuarta vía y la que se estaba quedando atrás:

1. **No auditaba la piel.** El defecto no depende de por dónde entró el vínculo,
   así que el aviso tampoco: `auditSkin` se llama ahora también ahí. Comprobado
   con una banda descentrada a propósito, que saca `COSTURA_ROTA` y salida 1.
2. **`binding.mode` decía siempre `"rigid"`.** Con banda era mentira. Ahora sale
   de lo que se escribió —`blended` si alguna pieza reparte— y `blendedParts` dice
   cuáles, así que nadie tiene que deducirlo del GLB. Lo mismo en `rig.mode` de la
   ruta de escena, que tenía el literal igual de fijo.
3. **`--help` no mencionaba `blend`.** Un campo que solo se descubre leyendo el
   esquema es medio campo.

*Cerrado. Con esto el plan queda cerrado entero salvo lo anotado en §9.*

---

## 6. Hallazgos que ya se conocen y condicionan el diseño

- **La mitad de lectura está hecha y certificada** (§1). Este plan escribe, no
  interpreta.
- **`applySkin` normaliza como `GLTFLoader`**, con `Math.fround`. Si escribimos
  pesos que suman 0,999999, el lector los normaliza y nosotros también: hay que
  normalizar en el mismo sitio y del mismo modo, o el último bit no cuadra.
- **El espacio importa.** Los vértices se llevan a espacio de modelo antes de
  atarse, y las posiciones de reposo de los huesos salen de `restWorldMatrices`.
  Calcular la banda en espacio local de la pieza daría bandas distintas para la
  misma declaración según dónde estuviera colocada la pieza.
- **`Mat4` es row-major** y los vectores se multiplican por la derecha. Es la
  primera invariante de `AGENTS.md` y la causa habitual de que una proyección
  «casi» funcione.
- **«La pieza lleva banda» no vale como filtro de `COSTURA_ROTA`** (paso 5).
  Medido: un brazo de tres piezas con banda en el codo y muñeca rígida sacaba el
  aviso **en la muñeca**, donde las dos piezas son rígidas y se tocan como siempre.
  La banda estaba en el otro extremo de la misma pieza. Lo que decide es si **el
  vértice compartido cae dentro de una banda** —dos influencias con peso no nulo—,
  que es la pregunta que se quería hacer. Cualquier filtro futuro que se plantee
  por pieza tiene el mismo agujero.
- ~~**Una regla lleva una banda**~~ — dejó de ser cierto el mismo día: `blend`
  acepta una lista, y un brazo de tres piezas se declara entero. Lo que sigue en
  pie es el techo: **tres bandas por regla**, porque la cuarta influencia de glTF
  se la lleva siempre el hueso de la regla.
- **Hay un suelo de ruido de 3,0e-8, y no lo pone el reparto** (paso 2). La
  costura del codo ya lo trae en reposo, porque las dos tapas se generan por
  caminos distintos y `Float32` no los redondea igual. Nada de lo que venga
  después —`COSTURA_ROTA` en el paso 3, los hashes del paso 4— puede exigir
  igualdad exacta entre dos vértices que *deberían* coincidir: el umbral se
  declara, y este es el número contra el que se declara.
- **La grieta es la cuerda `2·r·sin(θ/2)`** (paso 0). Depende del radio de la
  pieza y del ángulo, y de nada más: ni de la longitud, ni de la resolución de la
  malla, ni de la escala del modelo. Sirve como valor esperado en cualquier caso
  nuevo sin volver a medirlo.
- **Ningún hash debería moverse.** El camino rígido sale byte a byte igual, así
  que `contractVersion` se queda en 3. **Si un `renderHash` se mueve, hay que
  parar y decirlo** antes de seguir: es la tercera invariante.

---

## 7. Tabla de verificación

| Qué | Comprobación | Valor esperado |
|---|---|---|
| Regla sin `blend` | GLB antes y después | **byte a byte** |
| Banda con `ease: linear` | peso en el punto medio | **0,5 a menos de 1e-6**: el `t` sale de posiciones ya en `Float32` |
| Banda con `ease: smooth` | punto medio y cuarto | media exacta; el cuarto por debajo |
| Banda fuera de la región | pesos | 1 y 0, sin banda intermedia |
| Suma de pesos | todos los vértices | 1 tras `Math.fround`, sin excepción; `PESOS_SIN_SUMAR` si no |
| Codo a 90° | separación entre piezas | 0,106066 en el paso 0, **6,7e-8 con banda** |
| Dos piezas con la misma costura | `COSTURA_ROTA` | salta con bandas descentradas, callado con el atado rígido |
| Pesos declarados | evaluador certificado contra `evaluatePose` | **4/4 hashes idénticos**, fotogramas 0, 10, 20 y 30 |
| API, CLI y puente | el GLB de cada uno | **byte a byte**, comprobado sobre el ejemplar |
| Dos bandas en una regla | las dos costuras del brazo de tres | 9,6e-2 y 4,5e-2 sin ellas; **7,0e-8 y 0** con ellas |
| Bandas que se pasan de 1 | el atado | error con la pieza, el vértice y el total |
| El dron entero | `render-hashes.json` | `46228b7c`, sin mover |

---

## 8. Orden, coste y cuándo se abandona

Orden: **0 → 1 → 2 → 4 → 3 → 5 → 6**. El cierre cruzado va antes que los avisos a
propósito: es el paso que puede matar el plan, y descubrirlo después de escribir
cuatro códigos de aviso sería pagar por nada.

Presupuesto de puertas, con el criterio de
[`plan-convergencia.md`](plan-convergencia.md) §5: lo que entra en `npm run
verify` es aritmética sin render y no debería pasar de **+3 s**; el cierre cruzado
del paso 4 es local y se le admite lo que cueste.

**Cuándo se abandona.** Si en el paso 4 los hashes no coinciden y la diferencia no
se explica por el redondeo del lector, este plan se para y el atado se queda
rígido. Una mezcla que no se puede afirmar exacta no vale más que no tenerla:
sería justo el tipo de cosa que este banco existe para no producir.

---

## 9. Anotado, sin fase asignada

- ~~**Más de una banda por regla**~~ — **hecho** el 2026-08-10, en cuanto el paso 5
  enseñó el caso: una pieza intermedia tiene costura por los dos extremos y con una
  sola banda solo podía soldar una. `blend` acepta ahora una banda **o una lista**,
  con tres como mucho —glTF escribe cuatro influencias y una es siempre `joint`—.

  Y la pregunta que esta nota dejaba abierta —qué pasa si dos bandas se solapan—
  tiene respuesta: **solaparse vale y pasarse no**. Un hombro reparte hacia tres
  huesos a la vez y eso es legítimo; lo que no puede es que entre todas se lleven
  más de 1, porque entonces el hueso de la regla se queda con peso negativo y no
  hay reproductor que sepa qué hacer con eso. Se comprueba vértice a vértice y sale
  como error del atado, con la pieza, el vértice y el total.

  El ejemplar que lo enseña es `artifacts/agent/brazo-articulado.json`: tres piezas,
  dos costuras, y el antebrazo con las dos bandas. Sin ellas se abre 9,64e-2 en el
  codo y 4,51e-2 en la muñeca; con ellas, **7,0e-8 y cero exacto**. Certificado
  contra Three.js, 4/4 hashes.
- **Pesos traídos por mapa.** Un fichero aparte con un peso por vértice, para
  quien los tenga calculados fuera. Hoy esa vía ya existe cruda por
  `JOINTS_0`/`WEIGHTS_0`; lo que no hay es una forma declarada de referenciarla.
- **Cuaterniones duales**, si algún día el consumidor deja de ser glTF. Ver §3.3
  para por qué hoy no.
- **El volumen bajo flexión como métrica.** La mezcla lineal lo pierde y se puede
  medir; convertirlo en aviso exige decidir cuánta pérdida es normal, y eso pide
  una medida antes que una constante.
