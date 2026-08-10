# Plan: los pesos se declaran, no se adivinan

Estado: **paso 0 hecho, el resto sin empezar** (2026-08-10). Nace de la nota que
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
del plan entero —lo que ya funciona no se entera— y es la primera comprobación
del paso 1.

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

### Paso 1 — El sitio del peso, con el rígido intacto

`SkinBindingRule` acepta `blend`; el camino sin `blend` produce el mismo GLB byte
a byte. Los pesos dejan de escribirse en el bucle de primitivas y pasan a una
función pura `weightsFor(part, rule, restJoints)`, que es lo único que este plan
va a ir llenando.

*Cierra: `test:bind` y `test:rig` pasan sin tocar una prueba, y el GLB del dron es
el mismo fichero.*

### Paso 2 — La banda entre dos huesos

`blend` como la describe §4, con sus rechazos: hueso `with` que no existe, banda
invertida (`from ≥ to`), banda fuera de `[0, 1]`, `ease` desconocido. Los mismos
errores con el mismo tono que ya dan `rigSpec` y el vínculo: qué está mal, y qué
se esperaba.

*Cierra: un codo doblado 90° sin grieta, con la separación del paso 0 en cero.*

### Paso 3 — Los invariantes, como avisos con código

Tres, y los tres son aritmética sobre el resultado, así que son **certeza**:

| Código propuesto | Qué mide |
|---|---|
| `PESOS_SIN_SUMAR` | algún vértice no suma 1 tras normalizar, o suma 0 |
| `VERTICE_SIN_HUESO` | algún vértice queda sin ninguna influencia |
| `COSTURA_ROTA` | dos vértices en la misma posición de reposo, en piezas distintas, reciben pesos distintos |

El tercero es el que de verdad se rompe al usarlo: con reglas por pieza, dos
piezas vecinas pueden recibir bandas distintas y abrirse justo por donde se
tocan. Se mide con la maquinaria de posiciones repetidas que ya existe para la
auditoría de topología.

Y uno más, `candidato`, porque su conclusión depende de la intención:
`TORSION_APLASTADA`, cuando la banda cruza una articulación que gira más de 90°
sobre su propio eje —el envoltorio de caramelo de §3.3—. Se dice, no se arregla.

*Cierra: los cuatro saltan sobre un caso construido a propósito, y ninguno sobre
el ejemplar.*

### Paso 4 — El cierre cruzado, que es el paso que decide

Un GLB con pesos declarados, evaluado por `evaluatePose` y por el evaluador
certificado del editor, fotograma a fotograma: **mismos hashes**. Es el mismo
cierre que hizo E1 con el esqueleto (4/4) y E2 con el BVH sobre tres órdenes de
rotación.

Sin esto, los tres pasos anteriores son una animación bonita que nadie puede
afirmar. Con esto, softsight escribe pesos suaves que Three.js reproduce igual.

**Aviso de alcance honesto:** esta puerta lee el fixture certificado, que vive en
el repositorio privado del editor. Como las otras cinco, en CI se declarará «no
ejecutada» y solo cierra en una ejecución local con los dos repositorios al lado.

*Cierra: el plan. Si aquí no hay coincidencia exacta, §8 dice qué se hace.*

### Paso 5 — Ejemplar versionado y puerta

Una pieza con banda en `artifacts/agent/`, limpia de defectos —cero avisos de
`certeza`, como exige ya el ejemplar de geometría—, y la puerta que la audita. Es
lo primero que copia un agente que llega nuevo.

**No vale reutilizar `muneco.json`**: el paso 0 midió que sus piezas no comparten
un solo vértice, así que no hay costura que repartir. El ejemplar se construye con
una, y el codo del paso 0 ya tiene la forma.

### Paso 6 — Que se alcance por los tres caminos

`--bind` con `blend`, `bindings` de la escena con `blend`, y el comando `scene`
del puente. La puerta comprueba que **API, CLI y puente producen el mismo GLB
byte a byte**, que es lo que ya hace E3: los dos últimos son envoltorios y no
deben decidir nada. `--schema patch|scene` publica el campo nuevo, así que el
descubrimiento no exige leerse el repositorio.

`bridgeContractVersion` sigue en 1: añadir un campo opcional no rompe a nadie.

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
| Banda con `ease: linear` | peso en el punto medio | 0,5 exacto |
| Banda con `ease: smooth` | punto medio y cuarto | media exacta; el cuarto por debajo |
| Banda fuera de la región | pesos | 1 y 0, sin banda intermedia |
| Suma de pesos | todos los vértices | 1 tras `Math.fround`, sin excepción |
| Codo a 90° | separación entre piezas | 0,106066 en el paso 0, ahora en cero |
| Dos piezas con la misma costura | `COSTURA_ROTA` | salta si difieren, callado si no |
| Pesos declarados | evaluador certificado contra `evaluatePose` | mismos hashes, fotograma a fotograma |
| API, CLI y puente | el GLB de cada uno | **byte a byte** |
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

- **Bandas sobre más de dos huesos.** Un hombro real reparte entre tres. Cuatro
  influencias caben en el formato; lo que falta es una forma de declararlo que no
  se convierta en un lenguaje de expresiones. Espera a un caso que lo pida.
- **Pesos traídos por mapa.** Un fichero aparte con un peso por vértice, para
  quien los tenga calculados fuera. Hoy esa vía ya existe cruda por
  `JOINTS_0`/`WEIGHTS_0`; lo que no hay es una forma declarada de referenciarla.
- **Cuaterniones duales**, si algún día el consumidor deja de ser glTF. Ver §3.3
  para por qué hoy no.
- **El volumen bajo flexión como métrica.** La mezcla lineal lo pierde y se puede
  medir; convertirlo en aviso exige decidir cuánta pérdida es normal, y eso pide
  una medida antes que una constante.
