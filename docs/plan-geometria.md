# Plan: geometría compleja declarativa

Estado: **cerrado**. Escrito el 2026-08-05, terminado el 2026-08-06. La puerta es
`npm run test:geometry`, con 44 comprobaciones, y va dentro de
`npm run test:animation`. El ejemplar es `artifacts/agent/pieza-geometria.json`.

Lo de después del cierre queda en §9, tachado y fechado, en vez de en un plan
nuevo: el primer uso real encontró que la repetición radial no servía para un
rotor fuera del eje del mundo, y esa historia se lee mejor donde está la decisión
que la causó.

Cada paso queda marcado abajo con el número que dio, no con «hecho»: dentro de
seis meses, «hecho» no permite comprobar nada y un número sí.

Nace de una pregunta concreta: si una pieza compleja —un ala, un fuselaje, una
pata, una pala de hélice— se puede describir con fórmulas en vez de con una masa
de triángulos, ¿qué le falta a este repositorio para que un agente la escriba
rápido y **correcta**?

La respuesta corta es que la arquitectura ya es la buena y faltan dos generadores,
una familia de deformadores y tres avisos. La larga es este documento.

---

## 1. El hueco, medido

Hoy `GeometrySpec` en [`sceneSpec.ts`](../src/soft/agent/sceneSpec.ts) acepta
cuatro formas: primitiva con parámetros —caja, esfera, toro, plano, cilindro,
cono—, malla cruda en arrays, extrusión de un polígono y revolucionado de un
perfil.

Con eso se describe una torre, un jarrón y una escuadra. **No** se describe:

| Pieza | Por qué no cabe hoy |
|---|---|
| Ala | sección variable a lo largo del tramo, con torsión y perfil aerodinámico |
| Fuselaje, carrocería | secciones distintas cosidas a lo largo de un eje |
| Pata, antena, cable, latiguillo | sección constante siguiendo un recorrido curvo en 3D |
| Brazo de rotor | lo mismo, y además con radio variable |
| Pala de hélice | sección variable **más** torsión progresiva |
| Abdomen, caparazón, cuerpo orgánico | radio como función de la posición, no como constante |

Todas esas piezas son el mismo objeto matemático visto desde ángulos distintos:
**un perfil que se mueve por un recorrido cambiando de tamaño y de giro**. Eso es
lo que falta.

Lo que **no** falta es la idea de guardar la receta en vez del resultado: la
escena declarativa ya lo hace, `extrude` y `revolve` ya son fórmulas con
parámetros, y la malla solo existe al rasterizar o al exportar GLB.

---

## 2. Lo que este plan no hace, y por qué

Cuatro tentaciones razonables que se descartan con motivo, no por gusto. Quedan
escritas para no volver a discutirlas cada seis meses.

### 2.1 Un formato binario para la geometría — no

La propuesta habitual es compilar la escena a *bytecode* geométrico: opcodes,
`Float64`, `Uint16`, y un evaluador que reconstruye la pieza al abrir.

No, por cuatro razones y ninguna es de rendimiento:

- **La superficie del agente es JSON validado por `--schema`.** Un formato binario
  mata el diff, mata [`scenePatch.ts`](../src/soft/agent/scenePatch.ts) —que edita
  el documento, no la geometría resuelta— y mata que el agente lea lo que escribió
  en el turno anterior.
- **El binario compacto ya existe y es el GLB de `--export`.** Es la salida
  horneada, a propósito, y quien la consume —el editor— no quiere la receta: quiere
  la malla certificada.
- **Dos representaciones de la misma pieza son dos originales**, y la regla del
  repositorio es una fuente por dato. Divergirían en el primer campo que se añada.
- **El ahorro es imaginario.** La escena de la torre son dos kilobytes de JSON. El
  agente paga por turno, no por byte; comprimir la entrada no le devuelve nada.

### 2.2 Campos de distancia con signo (SDF) y unión suave — no, y menos aún

La propuesta es tentadora porque resuelve de un plumazo las uniones orgánicas: se
suman funciones, se mezclan con `smoothUnion`, y lo que eran piezas separadas
parece una sola.

El problema es el juez. En este repositorio la verdad la dicen `signedVolume`
exacto, `watertight`, `NO_MANIFOLD` y `TRIANGULOS_DEGENERADOS` —ver
[`inspect.ts`](../src/soft/agent/inspect.ts)—. Un SDF hay que poligonizarlo, y
*marching cubes* produce una malla **aproximada**, con volumen aproximado, con
estanqueidad que depende de la rejilla y con recuentos de triángulos que se
disparan. En el momento en que entra, el informe deja de poder afirmar exactitud,
y esa afirmación **es el producto**. Consistente con lo que ya está escrito en
[`plan-agentes.md`](plan-agentes.md) sobre las booleanas: quedan lejos y
probablemente no compensen.

Dicho de otro modo: la unión suave es exactamente la operación cuyo resultado no
se puede comprobar con los instrumentos que tenemos. Añadirla sería añadir la
única cosa que no sabemos certificar.

### 2.3 NURBS — todavía no

Un evaluador de B-splines racionales son unas doscientas líneas y no es difícil.
Lo difícil es el otro lado: el agente tiene que escribir vector de nudos, grado y
pesos, y **los escribe mal**. Una curva de Bézier cúbica o una Catmull-Rom da el
noventa por ciento de la capacidad a coste de ergonomía casi nulo, y Catmull-Rom
tiene una ventaja decisiva para quien escribe JSON: **el agente declara los puntos
por los que la curva pasa**, no puntos de control sobre los que hay que razonar.

Se anota como candidato para cuando exista un consumidor que pague la precisión
de CAD. Hoy no lo hay.

### 2.4 Un lenguaje de expresiones dentro del JSON — no

«Que el agente escriba `w(u) = w0·(1-u)^0.4 + w1·u`» exige un evaluador de
expresiones. Eso trae análisis sintáctico, mensajes de error nuevos, un modo de
fallo que no es un campo mal escrito, y la duda perpetua sobre si dos máquinas
evalúan igual. La alternativa está en §4 y no pierde nada.

---

## 3. La mecánica: cinco ranuras

Toda pieza compleja se declara con el mismo patrón. Un agente que lo aprende una
vez lo reproduce sin volver a pensar:

```
perfil  ×  recorrido  ×  variación  ×  deformadores  ×  repetición
```

| Ranura | Qué es | En un dron |
|---|---|---|
| **perfil** | polígono cerrado 2D | NACA 2412, círculo, rectángulo redondeado |
| **recorrido** | curva 3D, o lista de estaciones colocadas | eje del ala, brazo del rotor |
| **variación** | cuerda, radio, torsión y grosor **según la posición** | cuerda de 0,72 en la raíz a 0,18 en la punta |
| **deformadores** | torsión, afinado, curvado, ondulación sobre la malla ya hecha | pala helicoidal |
| **repetición** | matriz radial, espejo | cuatro palas a noventa grados |

Un ala es un `loft` de perfiles NACA por estación. Una pata es un `sweep` de
círculo por una Catmull-Rom con radio variable. Una pala es `loft` más `twist`.
Un fuselaje es `loft` de secciones. Un abdomen es `revolve` —que ya existe— más
`wave`. **Todo lo que hay que describir sale de estas cinco ranuras**, sin SDF y
sin NURBS.

---

## 4. La variación, sin lenguaje de expresiones

Una función escalar sobre el recorrido se declara como **tabla de estaciones más
interpolación declarada**:

```json
{ "at": [[0, 0.72], [0.6, 0.40], [1, 0.18]], "ease": "smooth" }
```

`at` son pares `(u, valor)` con `u` de 0 a 1, ordenados. `ease` es uno de
`linear` —por defecto—, `smooth` —Hermite con tangentes nulas— o `power:k`, que
interpola en `t^k` y da las curvas de raíz que aparecen en los perfiles
aerodinámicos.

Un número suelto donde va una tabla significa constante. Es la mayoría de los
casos y no debe costar seis caracteres:

```json
{ "radius": 0.05 }
```

Por qué así y no con fórmulas: **es el mismo modismo que ya usan los clips de
animación** —claves más interpolación—, así que el agente que sabe una sabe la
otra; es determinista sin discusión; y el modo de fallo es un campo mal escrito,
que es el único que `assertValid` sabe cazar bien.

Lo que se pierde es escribir una función arbitraria en una línea. Lo que se gana
es que cuatro puntos describen cualquier variación que un ala necesita, y que se
pueden leer de un vistazo.

---

## 5. Los pasos

Ordenados por rendimiento: cada uno deja el repositorio verde y aporta capacidad
por sí solo.

### Paso 1 — Perfiles con nombre y generadores de perfil — hecho

**Medido:** el círculo de 32 puntos y radio 1 extruido a altura 2 da **6,24289** frente
a los 6,242890 del polígono inscrito —no 6,2832, que sería el círculo ideal—, y cuadra
también con 7 y con 128 puntos. La superelipse de exponente 2 es el círculo **número a
número**. Gielis con m=4 y los tres exponentes a 2 cae en la circunferencia con error
por debajo de 1e-12. El NACA 2412 da 64 pares exactos, con el borde de fuga una sola vez
en x=0,72, y extruido sale estanco. Ocho escrituras malas rechazadas por su motivo.

Dos correcciones a la forma que traía este plan, las dos porque `validate` rechaza toda
clave que no esté en el esquema: `profiles` es una **lista** con `name` obligatorio y no
un diccionario de claves libres, y los cuatro generadores van planos y opcionales porque
`anyOf` se aplica a un campo y no a los elementos de una lista.

Un bloque `profiles` en la raíz de la escena, y perfiles generados por fórmula.

```json
{
  "profiles": {
    "ala": { "naca": "2412", "points": 64 },
    "brazo": { "circle": 1, "points": 24 },
    "chasis": { "superellipse": [1, 0.4, 4], "points": 48 }
  },
  "objects": [ … ]
}
```

Generadores: `circle`, `naca` —cuatro dígitos—, `superellipse` con exponente, y
`gielis` con sus parámetros. Todos devuelven un polígono cerrado en el mismo
formato que ya acepta `extrude`: pares en el plano, antihorario, cóncavo
admitido.

Dos decisiones con motivo:

- **Familias fijas con parámetros, no fórmulas libres.** Es donde encajan las
  matemáticas interesantes —superelipse, superfórmula de Gielis, perfil NACA— sin
  abrir la puerta de §2.4.
- **NACA con borde de fuga cerrado.** La fórmula clásica de cuatro dígitos deja el
  borde de fuga abierto por unas milésimas de cuerda, y eso produce exactamente lo
  que la auditoría rechaza: aristas de borde, o triángulos casi degenerados si se
  cierra a lo bruto. Se usa el último coeficiente en su variante cerrada
  (`−0,1036` en vez de `−0,1015`), que hace que el punto de fuga sea uno solo.

Los perfiles con nombre existen por el coste de turno: un ala con ocho estaciones
que repite el mismo polígono de 64 puntos ocho veces son cuatro mil números en el
documento que el agente tiene que volver a leer en cada llamada.

**Verificación.** El círculo de `n` puntos y radio `r` extruido a altura `h` debe
dar volumen `½·n·r²·sin(2π/n)·h` **exacto** —el área del polígono inscrito, no la
del círculo—, que es la misma disciplina con la que se verificó la esfera
revolucionada contra `createSphere`. La superelipse con exponente 2 debe coincidir
con el círculo hasta el error de coma flotante.

### Paso 2 — `loft`: secciones cosidas — hecho

**Medido:** dos secciones iguales dan **1,764 y 12 triángulos**, exactamente lo mismo
que la extrusión, con la misma caja. El tronco cuadra con h·A·(1+k+k²)/3 en tres `k`
distintos. El loft de círculos da **2,996587**, el mismo número que el cilindro. Las
tapas dan 0, 24, 12 y 12 aristas de borde según lo que se deje abierto. El polígono
escrito en sentido horario con la lista de secciones invertida da la misma malla y
volumen positivo. Y 24 puntos cosidos con 64 a 48 muestras salen estancos.

**Sin `stations`**, apartándose de lo que decía este apartado: ver §9.

Y un fallo cazado al escribirlo: normalizar el sentido con `reversePolygon` habría roto
la igualdad, porque esa función empieza por el **último** vértice y movería el origen del
remuestreo. Se escribió `flipPolygonKeepingStart`, que invierte conservando el vértice
cero.

```json
{
  "geometry": {
    "loft": [
      { "at": [0, 0, 0],    "profile": "ala", "scale": 0.72, "twist": 18 },
      { "at": [0, 0.05, 1.2], "profile": "ala", "scale": 0.40, "twist": 11 },
      { "at": [0, 0.09, 2.4], "profile": "ala", "scale": 0.18, "twist": 4 }
    ],
    "samples": 64,
    "stations": 24,
    "caps": "both"
  }
}
```

Generaliza `extrude`: dos secciones iguales a distinta altura **son** una
extrusión, y deben dar el mismo número.

Tres decisiones que quitan de en medio los tres fallos clásicos del *loft*:

1. **Correspondencia por remuestreo.** El fallo número uno del *loft* es que dos
   secciones tengan distinto número de puntos, o el mismo número mal emparejado.
   Se elimina de raíz remuestreando **toda** sección a `samples` puntos repartidos
   por longitud de arco, empezando en el punto más cercano a un eje declarado. Es
   determinista y le quita al agente la forma de equivocarse, que es la misma
   política con la que la extrusión ordena el polígono en vez de confiar en él.
2. **Orientación normalizada.** Igual que `createExtrusion` reordena el polígono y
   `createRevolution` ordena el perfil de forma ascendente: aquí se normaliza el
   sentido de giro de cada sección y el sentido del recorrido, y el agente escribe
   como quiera.
3. **Tapas explícitas.** `caps` vale `both`, `none`, `start` o `end`, por defecto
   `both`. La política de fondo es la que ya tomó el revolucionado: **no se cierra
   nada por iniciativa propia**, porque cerrar sin permiso es cambiar el diseño; se
   deja el borde abierto y `BORDE_ABIERTO` lo dice.

**Verificación.** Dos secciones cuadradas iguales a distancia `h` deben dar el
mismo volumen, la misma caja y el mismo recuento de triángulos que la extrusión
equivalente. Un tronco de pirámide de secciones `A` y `k²A` a altura `h` da
`h·A·(1+k+k²)/3`, exacto. Y un `loft` de secciones circulares reproduciendo un
cilindro debe coincidir con `createCylinder` a la misma teselación.

### Paso 3 — `sweep`: perfil por un recorrido — hecho

**Medido:** el barrido recto da el área del polígono inscrito por la longitud, en dos
resoluciones. El cerrado da **2,383705 y 2.304 triángulos**, exactamente lo mismo que
`createTorus` a esa teselación. **29 estaciones seguidas de tramo recto sin un grado de
torsión**, a 1e-12. El cono de radio variable da 2,080963, la suma exacta de sus troncos.
Seis tablas de variación malas y cinco barridos mal escritos rechazados por su motivo.

La holonomía se comprueba contra una verdad conocida: un lazo **plano** tiene holonomía
nula y da **cero exacto**, mientras que uno torcido acumula **26,78°** que se reparten
lineal en `u`. La primera versión de esa prueba usaba un zigzag simétrico, que también da
cero por simetría: pasaba sin comprobar nada.

```json
{
  "geometry": {
    "sweep": "brazo",
    "path": { "through": [[0,0,0], [0.4,0.10,0], [0.8,0.05,0.30]], "kind": "catmull-rom" },
    "radius": { "at": [[0, 0.05], [1, 0.02]], "ease": "power:0.4" },
    "twist": { "at": [[0, 0], [1, 90]] },
    "stations": 48,
    "caps": "both"
  }
}
```

Generaliza `revolve`: un círculo barrido alrededor de un eje **es** un
revolucionado.

Tres detalles que deciden si esto funciona o produce basura:

1. **Marcos por transporte paralelo, no Frenet.** El marco de Frenet se calcula
   desde la derivada segunda, y hace dos cosas malas: gira de golpe media vuelta al
   pasar por un punto de inflexión, y se vuelve indefinido donde la curvatura tiende
   a cero —es decir, en cualquier tramo recto—. Un brazo recto con una curva al
   final saldría retorcido por la mitad. El transporte paralelo arrastra el marco
   anterior girándolo lo mínimo, es estable en los tramos rectos y **no depende de
   la derivada segunda**.
2. **El recorrido cerrado no cierra solo.** Al dar la vuelta completa, el
   transporte paralelo vuelve con un giro residual que casi nunca es cero: la
   costura queda desalineada. Se mide el residuo y se reparte a lo largo del
   recorrido, restando `residuo·u` en cada estación. Sin esto, un toro barrido
   tiene una arista visible por donde se cierra.
3. **Auto-intersección.** Si el radio en un punto supera el radio de curvatura del
   recorrido, el tubo se come a sí mismo: la malla sale con volumen firmado
   plausible y geometría basura. Es analítico y barato —`radius(u)·curvatura(u) ≥ 1`
   evaluado en cada estación— y da el aviso nuevo `BARRIDO_AUTOINTERSECADO` con la
   estación culpable y el radio máximo que sí cabe. Es el tipo de comprobación que
   este repositorio prefiere: exacta, barata, y dice de qué es prueba.

**Verificación.** Un círculo de `n` puntos y radio `r` barrido por un recorrido
recto de longitud `L` da `½·n·r²·sin(2π/n)·L`, exacto. Barrido por un recorrido
circular de radio `R` cerrado debe coincidir con `createTorus` a la misma
teselación, que es el teorema de Pappus discretizado. Y con `caps: "both"` sobre
un recorrido recto debe salir estanco, sin aristas de borde.

### Paso 4 — Deformadores — hecho

**Medido:** la torsión conserva el volumen firmado **exacto** —0,998862 con 30°, 120° y
−270°, el mismo número que sin torcer—, que es la prueba que más vale del paso. El
afinado multiplica el volumen por (1+k+k²)/3 con dos `k`. El doblado deja los 134
vértices dentro de la corona **[1,128, 1,928]**, la que dicta el radio de doblado, exacto
y por vértice. La ida y vuelta de torsión se desvía 3,0e-8 y la de ondulación 1,8e-24
—ver §9—, y el parámetro neutro sí es la identidad bit a bit en los tres.

`deform` va en el **objeto** y no dentro de `geometry`: la geometría es una unión de seis
formas, y meterlo dentro obligaría a repetir el campo seis veces.

Una lista **ordenada** aplicada a la malla ya generada, sea cual sea su origen:

```json
{
  "geometry": { "primitive": "cylinder", "parameters": [0.1, 2] },
  "deform": [
    { "twist": { "axis": "y", "degrees": 120 } },
    { "taper": { "axis": "y", "at": [[0, 1], [1, 0.4]] } },
    { "bend":  { "axis": "y", "into": "x", "degrees": 30 } },
    { "wave":  { "axis": "y", "along": "z", "amplitude": 0.02, "cycles": 3 } }
  ]
}
```

Es el paso de mayor rendimiento por línea escrita: cuatro deformadores de unas
diez líneas cada uno multiplican por cuatro todo lo que los generadores saben
hacer, incluidos los que ya existían.

Cuatro cosas que hay que hacer bien o produce fallos silenciosos:

- **El orden importa y por eso es una lista, no un objeto.** Torcer y luego doblar
  no es doblar y luego torcer. Un objeto con claves lo dejaría al azar del orden de
  serialización.
- **Deformar invalida lo que la malla tenía cacheado.** `Mesh` guarda
  `faceNormals` y `boundingRadius`; mover las posiciones sin borrar el primero deja
  al rasterizador descartando caras con las normales de antes —error que se ve como
  agujeros que aparecen y desaparecen al girar la cámara— y sin recalcular el
  segundo, el descarte por frustum recorta piezas que sí se ven. Después de cada
  cadena de deformadores: `computeNormals`, borrar `faceNormals`, recalcular
  `boundingRadius`.
- **Las normales se recalculan, no se transforman.** La transformación correcta de
  una normal bajo una deformación no lineal es la traspuesta de la inversa del
  jacobiano en cada punto, y para cuatro deformadores es más código y más frágil
  que promediar las caras otra vez.
- **La conectividad no cambia**, así que una malla estanca sigue estanca después
  de deformarla. Es la propiedad que hace que estos sean baratos de certificar.

**Verificación, y aquí hay una prueba exacta gratis.** La torsión alrededor de un
eje es una rotación rígida de cada rebanada, así que **conserva el volumen firmado
exactamente**: un cilindro torcido 120° debe dar el mismo `signedVolume` que sin
torcer, hasta el error de coma flotante. El afinado por una función `s(y)` escala
el volumen por la integral de `s²`, que para una rampa lineal de 1 a `k` da
`(1+k+k²)/3` —el mismo número del tronco del paso 2, y no es casualidad—. Curvado
y ondulación no tienen forma cerrada general, así que se verifican por **ida y
vuelta**: aplicar y aplicar el inverso debe devolver las posiciones originales
dentro de tolerancia declarada.

### Paso 5 — `repeat`: matriz radial y espejo — hecho

**Medido:** las cuatro matrices radiales coinciden con `rotationY(2πi/4)·M` **a 1e-15**, y
las cuatro copias comparten el mismo objeto `Mesh` por identidad. El espejo refleja con
desviación **0,0 exacta**, su copia da volumen **0,048 positivo** y los dos determinantes
quedan por encima de cero. La escena con `repeat` coincide vértice a vértice con las
cuatro piezas escritas una a una, y las copias ensanchan la caja a 2,800 en X frente a
los 0,1 de una pala.

**El espejo se resuelve conjugando**, `S·M·S`, con el espejo horneado en la malla. Con la
matriz reflejada a secas el determinante sería negativo: el rasterizador apagaría su
descarte en espacio de objeto (`renderer.ts:504`) y la copia daría volumen firmado
negativo, o sea un `MALLA_INVERTIDA` falso sobre una pieza correcta.

En el objeto, no en la geometría, porque produce piezas y no forma:

```json
{
  "name": "pala",
  "geometry": { "loft": [ … ] },
  "repeat": { "radial": { "count": 4, "axis": "y" } }
}
```

```json
{ "name": "ala", "geometry": { "loft": [ … ] }, "repeat": { "mirror": "x" } }
```

Produce `pala-1` … `pala-4`, que encajan con los patrones de selección que ya
existen (`pala-*`).

Existe por una razón que no es comodidad: hoy el agente copia el objeto a mano
con cuatro ángulos escritos a mano, y `SIMETRIA_ROTA` se lo dice **después**.
Mejor que no pueda romperla.

**El espejo invierte el bobinado.** Reflejar cambia la orientación del espacio, y
una malla reflejada sin invertir el orden de los índices sale con todas las caras
del revés: renderiza oscura y `MALLA_INVERTIDA` la caza, pero es un fallo que no
hay que llegar a cometer. El espejo invierte los índices de cada triángulo.

**Verificación.** Cuatro copias radiales dan cuatro veces el volumen de una, y el
error de simetría en X de un espejo es cero exacto —con el matiz del hallazgo 6.3,
que hay que arreglar antes o esta comprobación se apaga sola—.

### Paso 6 — Los avisos nuevos — hecho

`BARRIDO_AUTOINTERSECADO` entró con el paso 3, y estrenó `geometryAudit.ts`, que audita
el **documento** y no la malla: cuando el radio supera el radio de curvatura, el tubo se
come a sí mismo y sale cerrado, con volumen plausible, sin nada a lo que la auditoría de
malla pueda agarrarse.

`PERFIL_AUTOINTERSECADO` mide el cruce **propio y estricto**. Admitir el caso colineal o
el contacto en un extremo convertiría en aviso lo que produce cualquier generador con
puntos casi alineados —el borde de fuga de un perfil, sin ir más lejos—. **Medido: los
siete perfiles de los cuatro generadores, de 24 a 200 puntos, salen limpios.**

`SECCIONES_INCOMPATIBLES` **no** avisa de secciones escritas en sentidos opuestos, aunque
este plan lo decía: el paso 2 las normaliza a propósito y hay una prueba que exige que den
la misma malla. Queda solo el retorcido del emparejamiento, con el umbral —un cuarto de
vuelta— **dicho en el propio mensaje**: un candidato con el criterio a la vista se puede
discutir; uno sin él, no.

Tres, en la línea de los que ya hay:

| Código | Cuándo | De qué es prueba |
|---|---|---|
| `BARRIDO_AUTOINTERSECADO` | `radius(u)·curvatura(u) ≥ 1` en alguna estación | certeza, es analítico |
| `PERFIL_AUTOINTERSECADO` | dos segmentos del polígono se cruzan | certeza; el recorte de orejas produce basura o no termina |
| `SECCIONES_INCOMPATIBLES` | dos secciones consecutivas de un `loft` giran en sentidos opuestos, o su emparejamiento retuerce la superficie más de media vuelta | candidato, no certeza |

`PERFIL_AUTOINTERSECADO` importa más de lo que parece: `earClip` en
[`mesh.ts`](../src/soft/mesh.ts) supone polígono simple, y un perfil escrito a
mano que se cruza produce hoy tapas basura sin decir nada. Es O(n²) sobre
decenas de puntos, es decir, gratis.

### Paso 7 — Ejemplar versionado y puerta — hecho

La puerta se creó con el paso 1, no al final: un paso que añade capacidad sin puerta
propia no está verificado, solo escrito.

`artifacts/agent/pieza-geometria.json` son cinco objetos que la escena expande a **diez
piezas**, con una mecánica por pieza: cuerpo por revolucionado con `wave`, alas por `loft`
de perfiles NACA, patas por barrido de círculo, buje por revolucionado y palas por
extrusión torcida repetida en radial. **2.672 triángulos, volumen 0,091438, 1,940 de lado
mayor**, todas las mallas cerradas y `auditGeometry` limpio.

**Y responde medida la pregunta de §6.2: el ensamblaje por solape aguanta.** Cero solapes
parciales y cero piezas sueltas. Las dos condiciones tiran en direcciones opuestas —hay
que tocarse, pero sin pasar del diez por ciento del volumen de la caja menor— y el margen
existe: la pata daba 11,4 % con la raíz a 0,185, y moverla a 0,20 —justo el radio máximo
del fuselaje— la dejó por debajo del umbral sin separar las cajas.

Lo que el ejemplar **no** puede ser es «limpio de avisos» en el informe completo, y no por
un defecto suyo: ver §9.

Un fixture en `artifacts/agent/` con **una pieza de cada mecánica** —un ala por
`loft`, un brazo por `sweep`, una hélice de cuatro palas por `repeat` radial, y un
cuerpo por `revolve` más `wave`—, limpio de avisos.

Y una puerta `test:geometry` con la tabla de volúmenes analíticos de los pasos
1 a 5. El criterio es el que ya usa el repositorio: **el volumen es el juez
exacto**, y se compara contra el valor de la geometría discretizada, no contra el
del sólido ideal.

Ejemplar limpio, además, por lo mismo que en el plan de historias: un ejemplar con
avisos enseña justo lo que la puerta rechaza.

---

## 6. Hallazgos: lo que se rompe al escalar, y no estaba anotado

Salieron leyendo la auditoría con estos generadores en la cabeza. Dos de ellos
cambian el plan y uno corrige algo que se dijo antes.

### 6.1 El soldado por posición hace que las costuras funcionen — con techo

`weldPositions` en [`inspect.ts`](../src/soft/agent/inspect.ts) cuantiza a `1e-5`
**absolutos** antes de comparar. Por eso el revolucionado sale estanco aunque
duplique la columna de la costura: `sin(2π)` vale `−2,4·10⁻¹⁶` y no cero, pero
cuantizado coincide. Los barridos y los *lofts* heredan esa suerte y **no hay que
hacer nada**.

Pero fija un techo de resolución que conviene tener escrito: **dos estaciones a
menos de 10 µm se sueldan la una a la otra** y la arista compartida pasa a tener
más de dos usos, es decir, `NO_MANIFOLD` falso sobre una malla correcta. Con las
resoluciones por defecto de aquí no se llega ni de lejos; con `stations: 4096`
sobre una pieza de un centímetro, sí. Se limita el número de estaciones para que
el espaciado mínimo quede por encima de `1e-4`, y se dice en el mensaje de error.

### 6.2 El ensamblaje por solape sobrevive, y por poco

Sin booleanas, una pieza compleja son varios sólidos cerrados que se **solapan**
en las uniones: el ala se mete unos centímetros dentro del fuselaje. Eso es
exactamente lo que mira `INTERPENETRACION`.

Leído el código en [`index.ts`](../src/soft/agent/index.ts): el aviso perdona los
solapes donde una caja contiene a la otra —los alojamientos— y solo salta cuando
el cruce parcial supera **el diez por ciento del volumen de la caja menor**. Una
raíz de ala insertada un cinco por ciento de su longitud queda por debajo, así que
el modismo funciona.

Pero es un margen, no una garantía, y conviene medirlo con el ejemplar del paso 7
antes de dar por bueno el modismo. Si resulta que salta, la salida **no** es subir
el umbral —eso apagaría el aviso donde sí sirve—: es declarar la unión, y eso es
una fase entera que hoy no toca.

**Medido con el ejemplar, y el modismo aguanta.** Diez sólidos cerrados, sin una
sola booleana: cero solapes parciales y cero piezas sueltas. Las dos condiciones
tiran en direcciones opuestas —hay que tocarse, pero sin pasar de ese diez por
ciento— y el margen es estrecho pero existe: la pata daba **11,4 %** con la raíz a
0,185, y moverla a 0,20 —justo el radio máximo del fuselaje— la dejó por debajo del
umbral **sin separar las cajas**, así que sigue tocando.

La regla práctica que sale de ahí: lo que manda no es cuánto se inserta la pieza,
sino cuánto es esa inserción **de su propia caja envolvente**. Una pata de cuarenta
centímetros metida dos en el fuselaje pasa el umbral si va en diagonal, porque su
caja en ese eje mide mucho menos que su longitud.

### 6.3 La comprobación de simetría se apaga sola justo con estas piezas

`symmetryErrorX` es O(n²) y **devuelve `null` por encima de 4.000 vértices**.

Un ala en *loft* con 64 muestras y 24 estaciones son más de 1.500 vértices; una
hélice de cuatro palas, seis mil; un fuselaje decente, más. Es decir: **los
generadores de este plan son precisamente los que hacen que la comprobación de
simetría deje de existir**, en silencio, devolviendo `null` en el sitio donde el
agente esperaba un número. Y la simetría es lo que el paso 5 promete garantizar.

No es un detalle del plan: es un requisito previo. Se arregla metiendo los
vértices reflejados en una rejilla espacial con celda del tamaño de la tolerancia
—búsqueda del vecino más próximo en tiempo casi lineal— y subiendo el techo a algo
del orden de 200.000 vértices. Va **antes** del paso 5, o el paso 5 promete algo
que nadie mide.

### 6.4 La esfera envolvente se vuelve floja, sin dejar de ser correcta

`Mesh.boundingRadius` es la distancia máxima al **origen del objeto**, y el
comentario de [`mesh.ts`](../src/soft/mesh.ts) dice por qué basta: «todas las
mallas de aquí son simétricas respecto a su origen».

Un barrido por un recorrido que se aleja del origen rompe esa suposición. El
descarte por frustum **sigue siendo correcto** —la esfera contiene la malla— pero
se hace mucho más floja: un brazo de dos metros que empieza en el origen tiene
radio dos y descarta casi nada. Coste de rendimiento, no de exactitud, y con
piezas de este tamaño no se nota. Se anota, no se arregla: arreglarlo bien es
centrar la malla generada y meter el desplazamiento en la matriz, y eso cambia lo
que el agente ve al depurar coordenadas, que hoy coinciden con las que escribió.

### 6.5 `contractVersion` **no** sube — corrección

En la conversación que originó este plan se dijo que subiría. Es falso, y la
política del repositorio es la que lo dice: sube cuando cambia la aritmética o el
hash. Añadir generadores nuevos **no mueve ni un `renderHash` existente**, porque
ninguna escena escrita hasta hoy los usa.

Lo que sí cambia es la salida de `--schema`, así que hay que regenerar el fixture
del editor que la congela. Y `bridgeContractVersion` tampoco sube: no se añade
ningún comando.

Subirla sin motivo no sería inocuo: obligaría al editor a mover su pin por nada.

### 6.6 La frontera aguanta sin tocar nada

El editor consume GLB, no escenas. Los generadores viven **solo** en softsight y
la malla que cruza va horneada. Es decir, este plan entero no le pide al editor
que aprenda ni una palabra nueva, y la puerta de paridad de rasterizadores no se
entera. Vale la pena decirlo porque es lo que hace que el plan sea barato.

---

## 7. Tabla de verificación, con lo que dio

Nada de esto se cerró mirando el render. Cada fila es un bloque de
`npm run test:geometry`.

| Qué | Valor esperado | Medido |
|---|---|---|
| Perfil círculo `n`, radio `r`, extruido `h` | `½·n·r²·sin(2π/n)·h` | 6,24289 con n=32, r=1, h=2; cuadra con 7 y 128 |
| Superelipse exponente 2 | idéntica al círculo | idéntica **número a número**, tres resoluciones |
| Gielis m=4, exponentes 2 | circunferencia | error < 1e-12 |
| NACA de cuatro dígitos | polígono cerrado, borde de fuga único | 64 pares, borde de fuga en x=cuerda, extruido estanco |
| `loft` de dos secciones iguales | igual que `extrude` | 1,764 y 12 triángulos, misma caja |
| `loft` tronco `A` y `k²A` | `h·A·(1+k+k²)/3` | cuadra con tres `k` |
| `loft` circular | igual que `createCylinder` | 2,996587 por los dos caminos |
| `sweep` recto | `½·n·r²·sin(2π/n)·L` | cuadra con dos `n` |
| `sweep` cerrado circular | igual que `createTorus` | 2,383705 y 2.304 triángulos por los dos caminos |
| `sweep`, tramo recto | sin torsión | 29 estaciones a 1e-12 |
| `sweep` cerrado, holonomía | 0 en un lazo plano | 0 exacto; 26,78° en uno torcido, repartidos lineal en `u` |
| `sweep` con tapas | `boundaryEdges` 0 | 0; sin tapas, 2·puntos |
| `twist` | volumen **invariante** | 0,998862 con 30°, 120° y −270° |
| `taper` rampa 1 a `k` | factor `(1+k+k²)/3` | cuadra con dos `k` |
| `bend` | eje sobre un arco | 134 vértices en la corona [1,128, 1,928] |
| `twist`, `wave` | ida y vuelta | 3,0e-8 y 1,8e-24 — ver §9 |
| Parámetro neutro | identidad | bit a bit en los tres |
| `repeat` radial `n` | ángulos exactos `2πi/n` | matrices a 1e-15, y una sola malla compartida |
| `repeat` espejo | reflejo exacto, sin aviso falso | desviación 0,0; volumen 0,048 positivo; determinantes > 0 |
| `PERFIL_AUTOINTERSECADO` | caza el cruce, no los propios | caza el ocho; 7 perfiles propios limpios |
| `SECCIONES_INCOMPATIBLES` | candidato, umbral declarado | círculo→ala avisa; ala→ala y círculo→círculo no |
| Ejemplar | limpio y montado | 10 piezas, 2.672 triángulos, 0,091438; sin solape parcial ni piezas sueltas |
| Todos | `TRIANGULOS_DEGENERADOS` cero | cero |
| Todos con tapas | `inverted` falso | falso, volumen positivo |

Dos filas de la versión original no se implementaron tal cual, y merece la pena
que se vea:

- **`repeat` espejo contra `symmetryErrorX`** no vale: esa métrica es **por
  pieza**, y un ala no es simétrica respecto a su propio origen. Se comprueba lo
  que sí significa algo —que la copia sea el reflejo exacto, vértice a vértice—.
- **`bend` por ida y vuelta** tampoco: el doblado **cambia** la extensión del eje
  que define `u`, así que la segunda pasada vería otra caja. Se comprueba por
  invariante geométrico, que además es exacto y por vértice.

---

## 8. Orden

1. Hallazgo 6.3 —rejilla espacial en `symmetryErrorX`—, porque el paso 5 depende.
2. Paso 1, perfiles.
3. Paso 2, `loft`.
4. Paso 3, `sweep`, con `BARRIDO_AUTOINTERSECADO`.
5. Paso 4, deformadores.
6. Paso 5, `repeat`.
7. Paso 6, los otros dos avisos.
8. Paso 7, ejemplar y puerta.

Coste estimado: unas 600 líneas en `mesh.ts`, unas 120 entre `sceneSpec.ts` y
`schema.ts`, y la puerta.

---

## 9. Anotado, sin fase asignada

Ideas que esperan a que una medida las justifique, en el sitio donde se
recordarán:

- ~~**`repeat.radial` gira alrededor del eje del mundo**~~ — **hecho** el
  2026-08-06, en cuanto se intentó pasar del ejemplar a una pieza de verdad: un
  dron de cuatro brazos con rotor en cada punta no se podía describir, porque las
  palas orbitaban el centro de la escena. `repeat.about` declara el punto por el
  que pasa el eje de giro o el plano del espejo, y se aplica conjugando por la
  traslación —`T(a)·t·T(−a)`—, la misma idea que ya usaba el espejo con la
  reflexión. Con el punto en el origen devuelve la transformación intacta, así que
  lo escrito antes no se mueve un bit, y eso se comprueba.
- ~~**`SIMETRIA_ROTA` y `PIVOTE_DESCENTRADO` saltan sobre piezas legítimas**~~ —
  **hecho** el 2026-08-10, y la medida que faltaba resultó ser peor de lo que decía
  esta nota: sobre el ejemplar salían **14 avisos y los 14 eran estos dos códigos**,
  cero defectos, y aun así el CLI **salía 1**. La pieza que un agente copia lo
  primero fallaba la orden, que es la manera más rápida de enseñar a ignorar el
  código de salida.

  No se arregló subiendo umbrales —eso pierde los casos verdaderos—, sino separando
  observación de defecto donde ya estaba escrita la distinción: `PIVOTE_DESCENTRADO`
  pasa a `candidato`, porque la medida es exacta pero la conclusión «quedará
  descentrado al rotar» supone que la pieza va a rotar, y eso es intención; cada
  aviso publica su `severity`, tomada de la tabla en el sitio donde se emite; y el
  código de salida cuenta certezas, no avisos. Los 14 siguen enteros en el informe y
  el ejemplar sale 0. La puerta ya no tiene que excusarse: exige **cero avisos de
  `certeza`**, que es más fuerte que excluir dos códigos a mano.
- **Reparametrizar el `sweep` por longitud de arco.** Hoy las estaciones se
  reparten uniformemente en el parámetro de la curva y `u` solo las *etiqueta* con
  la fracción de longitud recorrida. Hacerlo de verdad exigiría invertir la tabla
  numéricamente y traer una tolerancia nueva.
- **Las idas y vueltas no vuelven bit a bit**, y no por el deformador: las
  posiciones viven en un `Float32Array` y el estado intermedio se redondea a 32
  bits. Medido: 3,0e-8 en la torsión. Lo que sí sale bit a bit es el parámetro
  neutro. Si algún día hiciera falta exactitud ahí, el cambio es el tipo de dato,
  no la aritmética.
- **`createCylinder` deja dos vértices que no referencia ningún triángulo**, con
  normal cero. No afecta ni a la topología ni a la imagen, pero obliga a filtrar
  huérfanos en cualquier comprobación de coherencia de normales —lo hace el bloque
  31 de la puerta, con su comentario—.
- ~~**Un recorrido opcional en `loft`**~~ — **hecho** el 2026-08-11, y salió como
  decía esta nota: sin duplicar nada. `loft` acepta el mismo `path` que un barrido;
  con él las secciones se reparten uniformemente por índice a lo largo de la curva
  y cada estación lleva el perfil **interpolado entre las dos que la rodean**,
  orientado con el triedro del recorrido. Sin `path` no cambia nada.

  Lo que evitó el segundo generador de recorridos fue sacar el cuerpo de
  `createSweep` a un `sweepMesh` con **el perfil por estación**: enhebrar anillos,
  orientarlos, cerrar el bucle y tapar los extremos es el mismo trabajo lleve el
  perfil constante o no. `createSweep` queda en dos líneas sobre él.

  Lo cierran dos caminos independientes: **un loft de dos secciones iguales por una
  curva ≡ barrer ese perfil por la misma curva**, con las mismas 956 caras y
  **2,2e-16** de diferencia máxima, el epsilon del doble. Y para que eso no lo
  cumpla también un loft que ignorase las secciones, afilar la segunda baja el
  volumen de 1,1043 a 0,5058. Por documento, un recorrido recto da el mismo volumen
  que apilar —0,993865—, que es justo lo que esta nota predecía.

  `at` y `path` juntos se rechazan: con recorrido la posición la pone la curva.
- **`APOYO_INESTABLE`: medido el 2026-08-11, y no entra.** La idea viene de fuera
  —el artículo de WorldClaw (arXiv 2608.05248) lista *floating, excessive
  penetration y unstable support* como lo que su agente corrige mirando renders, y
  las dos primeras ya las medimos—. La medida propuesta era, sobre cajas: qué
  fracción de la huella de una pieza descansa sobre suelo u otra pieza, y si su
  centro cae dentro del apoyo.

  El resultado con una holgura sana —1 mm sobre un dron de 4,5— es **silencio
  absoluto**: de las 296 piezas del dron solo 6 se apoyan en algo y **ninguna**
  dispara a ningún umbral; en el ejemplar, el muñeco y el brazo articulado, las
  piezas apoyadas cubren el 100 %. Cero falsos positivos.

  Y no entra justamente por eso: **cero ruido, pero también cero señal**. No hay en
  el repositorio un solo modelo donde diría algo. Es un aviso para escenas montadas
  por gravedad —cosas repartidas sobre un terreno—, no para un ensamblaje mecánico,
  donde el contacto es soldadura y apoyarse poco no significa nada. Espera a que
  exista ese consumidor.

  Lo que sí conviene guardar es **de qué depende su ruido**, que no es obvio: de la
  holgura y de nada más. A 1 cm sobre el mismo dron, las piezas «apoyadas» pasan de
  6 a 37 y **11 disparan por debajo del 5 %** —y son los largueros de los brazos,
  que no se apoyan en nada: solo pasan a la misma altura—. A 5 cm son 105. Quien lo
  implemente algún día tiene que fijar la holgura antes que el umbral.
- **NURBS**, cuando exista un consumidor que pague la precisión de CAD (§2.3).
- **Declarar la unión entre piezas**, si el ejemplar del paso 7 demuestra que el
  ensamblaje por solape dispara `INTERPENETRACION` (§6.2).
- **Centrar la malla generada** y llevar el desplazamiento en la matriz, si el
  descarte por frustum llega a medirse como cuello de botella (§6.4).
- ~~**Volumen esperado por pieza en `budget`**~~ — **hecho** el 2026-08-11.
  `budget.volumes` es una lista de `{ part, volume, tolerance? }`, la única cláusula
  del presupuesto que mira **una pieza** y no el conjunto. El patrón es el de
  `--select`, así que una línea cubre las cuatro copias de un `repeat`, y una
  cláusula que no encaja con ninguna pieza **incumple igual**: un contrato que no se
  aplica a nada se cumpliría siempre, y una errata en el nombre lo desactivaría en
  silencio.

  La tolerancia es del 1 % por defecto y no puede ser cero, porque el volumen sale
  de sumar un determinante por triángulo sobre posiciones en `Float32`. Ese 1 % está
  medido, no elegido a ojo: el cilindro ideal `π·r²·h` se aparta del prisma de 32
  lados que genera el documento un **0,64 %**, así que declarar la fórmula del libro
  pasa, y con `tolerance: 0.001` no.

  El caso de uso apareció al escribir la puerta: declaré el prisma de **64** lados y
  la cláusula me corrigió con el número real —`createCylinder` usa 32 desde el
  documento y el tercer parámetro se ignora—. Es exactamente para lo que sirve.
- **Presupuesto de triángulos por defecto en los generadores nuevos.** Un `loft` de
  128×32 son ocho mil triángulos por pieza, y `PRESUPUESTO_TRIANGULOS` ya existe
  para decirlo. Las resoluciones por defecto se dejan modestas —24 estaciones, 32
  muestras— y quien quiera más lo escribe.
