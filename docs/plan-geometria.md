# Plan: geometría compleja declarativa

Estado: **escrito, sin empezar**. Fecha 2026-08-05.

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

### Paso 1 — Perfiles con nombre y generadores de perfil

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

### Paso 2 — `loft`: secciones cosidas

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

### Paso 3 — `sweep`: perfil por un recorrido

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

### Paso 4 — Deformadores

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

### Paso 5 — `repeat`: matriz radial y espejo

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

### Paso 6 — Los avisos nuevos

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

### Paso 7 — Ejemplar versionado y puerta

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

## 7. Tabla de verificación

Nada de esto se cierra mirando el render. Cada generador tiene su número exacto.

| Qué | Comprobación | Valor esperado |
|---|---|---|
| Perfil círculo `n`, radio `r`, extruido `h` | volumen firmado | `½·n·r²·sin(2π/n)·h` |
| Superelipse exponente 2 | contra el círculo | idénticos hasta coma flotante |
| `loft` de dos secciones iguales | contra `extrude` | mismo volumen, caja y triángulos |
| `loft` tronco de secciones `A` y `k²A` | volumen firmado | `h·A·(1+k+k²)/3` |
| `loft` circular | contra `createCylinder` | idéntico a igual teselación |
| `sweep` recto | volumen firmado | `½·n·r²·sin(2π/n)·L` |
| `sweep` cerrado circular | contra `createTorus` | idéntico a igual teselación |
| `sweep` con tapas | estanqueidad | `boundaryEdges` 0 |
| `twist` | volumen firmado | **invariante** |
| `taper` rampa 1 a `k` | volumen firmado | factor `(1+k+k²)/3` |
| `bend`, `wave` | ida y vuelta | posiciones originales, tolerancia declarada |
| `repeat` radial `n` | volumen firmado | `n` veces el de una |
| `repeat` espejo | `symmetryErrorX` | cero exacto (requiere 6.3) |
| Todos | `TRIANGULOS_DEGENERADOS` | cero |
| Todos con tapas | `inverted` | falso, volumen positivo |

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

- **NURBS**, cuando exista un consumidor que pague la precisión de CAD (§2.3).
- **Declarar la unión entre piezas**, si el ejemplar del paso 7 demuestra que el
  ensamblaje por solape dispara `INTERPENETRACION` (§6.2).
- **Centrar la malla generada** y llevar el desplazamiento en la matriz, si el
  descarte por frustum llega a medirse como cuello de botella (§6.4).
- **Volumen esperado por pieza en `budget`**, para que el agente afirme «esta pieza
  debe desplazar tanto» y la puerta lo compruebe. Es barato; falta el caso de uso
  que lo pida.
- **Presupuesto de triángulos por defecto en los generadores nuevos.** Un `loft` de
  128×32 son ocho mil triángulos por pieza, y `PRESUPUESTO_TRIANGULOS` ya existe
  para decirlo. Las resoluciones por defecto se dejan modestas —24 estaciones, 32
  muestras— y quien quiera más lo escribe.
