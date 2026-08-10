# Plan: el movimiento se declara como se declara la forma

Estado: **cerrado**. Escrito y terminado el 2026-08-06, en seis commits de
`8c85e99` a la puerta `test:rig`, que pasa de tres comprobaciones a ocho. El
ejemplar es el mismo de la geometría, `artifacts/agent/pieza-geometria.json`, que
ahora además vuela.

Cada paso queda marcado abajo con su número.

Nace de una asimetría que se ve en cuanto se usan las dos cosas seguidas. Después
de [`plan-geometria.md`](plan-geometria.md), un agente describe **forma** así:

```json
{ "radius": { "at": [[0, 0.05], [1, 0.02]], "ease": "power:0.4" } }
```

y describe **movimiento** así:

```json
{ "joint": "rotor", "property": "rotation", "keys": [
  { "frame": 0, "value": [0, 0, 0] }, { "frame": 1, "value": [0, 3, 0] }, … ] }
```

Doscientas claves escritas a mano para decir «esto gira». El agente ya sabe
declarar una función; en movimiento no le dejamos usarla.

---

## 1. El hueco, medido

`TrackSpec` en [`rigSpec.ts`](../src/soft/agent/rigSpec.ts) acepta hoy una lista de
fotogramas clave y una interpolación `linear` o `step`. Con eso:

| Lo que se quiere decir | Lo que hay que escribir hoy |
|---|---|
| «el rotor da tres vueltas» | 13 claves como mínimo, y por el motivo de §5.2, no 4 |
| «el brazo se despliega y frena al llegar» | claves a mano aproximando la curva |
| «la pata oscila con amplitud decreciente» | una clave por fotograma |
| «esto tarda 2 segundos y arranca suave» | dos claves y una interpolación que no existe |

El vocabulario para decirlo **ya está escrito y probado**: `evaluateVariation`, con
`linear`, `smooth` y `power:k`, y sujeción fuera del rango. Lo usan el barrido y
los cuatro deformadores. Falta que lo usen las pistas.

---

## 2. Lo que este plan no hace, y por qué

### 2.1 Sacar vídeo de softsight — no

Un codificador y una línea de tiempo aquí serían construir el editor por segunda
vez. La regla de la frontera del [mapa](mapa-del-proyecto.md) no es burocracia:
softsight **produce verdad** y el editor **la consume**. Cruzarla da dos medios
productos.

### 2.2 Dirección de movimiento — tampoco

Cámaras animadas, ritmo, tipografía en movimiento: eso es
[`plan-animacion.md`](plan-animacion.md) y vive en el editor. Aquí se declara qué
se mueve y cuánto, no cómo se cuenta.

### 2.3 Una interpolación nueva en el GLB — no se puede, y está bien

glTF admite `LINEAR`, `STEP` y `CUBICSPLINE`, y nada más. `smooth` y `power:k` no
existen ahí. Así que **lo declarado se hornea en claves** al resolver, con un
número de claves declarado y determinista.

Es la misma decisión que ya toma la geometría: la receta vive en el JSON y la
malla se hornea al exportar. Aquí la receta es la curva y lo horneado son las
claves. Y tiene la misma ventaja: lo que sale es un GLB que abre cualquiera, sin
extensiones inventadas.

### 2.4 Pesos suaves — es otro plan

Quitar el atado rígido es el desbloqueo grande, pero toca una línea que el
repositorio trazó a propósito y merece su propio documento. Queda anotado en §8.

---

## 3. La mecánica: una pista dice una función

```json
{
  "joint": "rotor",
  "property": "rotation",
  "axis": "y",
  "turns": 3,
  "frames": 90
}
```

```json
{
  "joint": "brazo",
  "property": "rotation",
  "value": { "at": [[0, [0,0,0]], [1, [0,0,-95]]], "ease": "smooth" },
  "frames": 45
}
```

Tres formas de escribir una pista, y las tres conviven:

1. **`keys`**, lo de hoy. No se toca: lo escrito sigue valiendo y sigue dando el
   mismo GLB.
2. **`value`**, una tabla de variación cuyo valor es el del `property` —tres
   números o cuatro—, con `ease`. Es el modismo de la forma, aplicado al tiempo.
3. **`turns`**, atajo para el caso que aparece siempre: girar `n` vueltas
   alrededor de un eje. Con `turns` negativo, al revés.

Las tres se resuelven a lo mismo —claves— antes de tocar el GLB, así que hay **un
solo camino** desde ahí hasta el fichero y desde el fichero hasta el evaluador
certificado.

---

## 4. Dónde vive `evaluateVariation`, y por qué hay que moverlo

Hoy está en `sceneSpec.ts`. `sceneSpec` ya importa tipos de `rigSpec`, así que si
`rigSpec` importa de `sceneSpec` se cierra un ciclo —hoy sería solo de tipos, pero
esto necesita la función, no el tipo—.

Sale a un módulo propio, `src/soft/variation.ts`, del que tiran los dos. Es un
movimiento de fichero sin cambio de comportamiento, y la puerta de geometría lo
comprueba sola: sus seis tablas malas tienen que seguir rechazándose por el mismo
motivo.

---

## 5. Los pasos

### Paso 1 — `evaluateVariation` a su propio módulo — hecho

**Medido:** `test:geometry` pasa sin tocar una sola línea de prueba, y ni un fichero
de `tools/` en el diff.

Mover, reexportar desde donde ya se exportaba, y nada más. **Cero cambios de
comportamiento**: `npm run test:geometry` pasa sin tocar una sola prueba.

Commit: `refactor: la tabla de variación, a su propio módulo`

### Paso 2 — `value` en las pistas — hecho

**Medido:** con `ease: linear` y dos entradas, hornear da **exactamente** los mismos
tiempos y valores que las once claves a mano; `smooth` vale la media en el punto
medio; el GLB horneado leído con el **evaluador certificado** coincide con la tabla
evaluada directamente en cinco fotogramas; y el camino de `keys` sigue dando el
mismo GLB **byte a byte** contra una huella medida antes del cambio.

Una pista con `value` en vez de `keys`, y `frames` para decir cuánto dura. Se
hornea a `frames + 1` claves, de 0 a `frames`.

**El número de claves horneadas es declarado**, no adivinado: `frames` manda, y
quien quiera menos resolución lo dice con `bake` —claves a emitir, por defecto una
por fotograma—. Un número que la herramienta elige sola es un número que nadie
puede reproducir.

La rotación admite los dos formatos que ya admite `KeySpec`: tres grados en orden
Y·X·Z o cuatro del cuaternión. Interpolar **grados** y convertir después, no al
revés: interpolar cuaterniones componente a componente no es una rotación.

**Aceptación:**
- Una pista con `value` de dos entradas y `ease: "linear"` produce exactamente las
  mismas claves que escribir la interpolación a mano.
- `ease: "smooth"` en el punto medio da la media, y a un cuarto queda por debajo.
- El GLB escrito, leído con el **evaluador certificado** de `animation.ts`, da en
  cada fotograma la misma pose que `evaluateVariation` calculada directamente,
  dentro de la tolerancia declarada. Esta es la comprobación que vale: dice que el
  atajo y el camino certificado coinciden.
- Una pista con `keys` sigue dando **el mismo GLB byte a byte** que antes.

### Paso 3 — `turns`, y el aviso que hace falta con él — hecho

**Medido:** una vuelta son cuatro pasos y cinco claves; a un cuarto de vuelta lo que
estaba en +Z está en +X y a media vuelta está enfrente, por el evaluador
certificado —justo lo que no pasaría con dos claves—; y `GIRO_AMBIGUO` caza el
0→360 y no el mismo giro partido en cuartos.

`{ property: "rotation", axis, turns, frames }` gira `turns · 360°` en `frames`
fotogramas.

**Y aquí está la trampa que justifica el paso.** Un muestreador de rotación de
glTF interpola cuaterniones **por el arco más corto**. Dos claves separadas más de
media vuelta no giran mucho: giran poco y al revés. Una vuelta completa escrita
con dos claves —0° y 360°— **no se mueve nada**, porque los dos cuaterniones son el
mismo.

Así que `turns` hornea con paso de **90° como máximo** —cuatro claves por vuelta,
más la final—, y se añade el aviso:

> `GIRO_AMBIGUO` — dos claves consecutivas de rotación separadas más de media
> vuelta. El reproductor tomará el camino corto y el movimiento no será el
> declarado. Certeza, no candidato: sale de comparar dos cuaterniones.

El aviso vale para las pistas escritas a mano, que es donde la gente se estrella
hoy sin enterarse.

**Aceptación:**
- `turns: 1` con `frames: 24` produce claves cada 90° o menos, y el evaluador
  certificado devuelve la orientación esperada en los cuartos de vuelta.
- `turns: 3` da tres vueltas de verdad: la orientación acumulada en el último
  fotograma no es la identidad por casualidad, se comprueba a media vuelta.
- `turns: -1` gira al contrario.
- Una pista **a mano** con claves a 0° y 360° dispara `GIRO_AMBIGUO`; la misma con
  claves cada 90°, no.

### Paso 4 — Ciclo y desfase — hecho

**Medido:** tres ciclos de 20 fotogramas duran 60 y los tres tramos son el mismo
movimiento clave a clave; un desfase de 5 hace que cada clave valga lo que valía
cinco más adelante y la 16 vuelva a valer lo que la 1. El desfase se aplica al
**parámetro** antes de hornear, así que solo va con `value`.

`cycle: n` repite el contenido de la pista `n` veces dentro del clip, y
`offsetFrames` lo desplaza. Con eso, cuatro patas que caminan desfasadas son
cuatro pistas iguales con cuatro desfases, no cuatro tablas escritas a mano.

Es el mismo modismo que el editor ya usa —`timeOffsetFrames`—, y usar la misma
palabra en los dos lados no es cosmético: quien aprende uno sabe el otro.

**Aceptación:** `cycle: 3` sobre una tabla de 30 fotogramas da 90 fotogramas cuyo
contenido coincide con el original en los tres tramos, y `offsetFrames` mueve el
resultado sin cambiar la forma.

### Paso 5 — La auditoría recorre en vez de muestrear — hecho

**Medido con el caso que lo justifica**: un cruce que dura **un solo fotograma**, el
7. Muestreando ocho de treinta no cae en la rejilla y la auditoría dice que todo
está bien; recorriendo los 31, sale. El presupuesto pasa de 8 a 512 y el informe
dice con `complete` si miró entero.

`animationAudit` mira hoy ocho fotogramas por clip y lo dice a la cara: puede
perderse un cruce que solo ocurra entre dos. Con las piezas de este tamaño,
recorrerlos todos es barato.

Pasa a recorrer **todos** los fotogramas del clip, con un presupuesto declarado
—`--audit-frames` deja de ser «cuántos muestreo» y pasa a ser «cuántos como
máximo»—, y el informe dice si recorrió entero o se quedó en el tope. Un número
que no dice si es completo no sirve para afirmar nada.

**Aceptación:** un clip con un cruce que ocurre en un solo fotograma —construido a
propósito— se caza ahora y no antes, y el informe dice `recorridoCompleto: true`.

### Paso 6 — Ejemplar y puerta — hecho

El ejemplar de geometría gana esqueleto y movimiento sin dejar de ser el mismo
fichero: dos huesos, un clip, el rotor con `turns` y el cuerpo flotando con
`value` más `cycle`.

**Medido:** 10 piezas animadas, 61 fotogramas recorridos enteros, **cero cruces**,
cero hundimientos, ningún hueso quieto y ningún giro ambiguo. Y el rotor gira de
verdad: un vértice de pala mantiene su radio al eje dentro de 1e-4 en seis
fotogramas y avanza un cuarto de vuelta cada cinco, que son las tres vueltas en
sesenta que declara el documento.

`offsetFrames` no aparece en el ejemplar y es a propósito: con dos patas simétricas,
un desfase entre ellas sería un defecto y no una demostración.

El ejemplar de geometría gana esqueleto y movimiento: el rotor gira, las patas se
pliegan. Un documento, una orden, y sale un GLB animado y auditado.

La puerta nueva —o el bloque nuevo en `test:animation`— comprueba lo de §7.

---

## 6. Hallazgos que ya se conocen y condicionan el diseño

1. **El arco más corto de los cuaterniones** (§5.2). Es la razón de que `turns`
   exista como atajo en vez de dejarlo a mano.
2. **La rotación se declara en grados Y·X·Z en todo el repositorio** —objetos,
   huesos y claves—. Dos convenciones en el mismo fichero es la forma más barata
   de que nadie confíe en ninguna. Lo horneado respeta eso.
3. **El atado es rígido**, un hueso por vértice y peso 1. Lo que se mueve aquí son
   piezas enteras. Para un dron o un brazo articulado es lo correcto; para piel
   suave hace falta §8.
4. **`contractVersion` sube en este plan**, y a diferencia del de geometría hay que
   decirlo: hornear claves **cambia el GLB** de cualquier escena que use las formas
   nuevas. Las escenas escritas con `keys` no se mueven —y eso se comprueba byte a
   byte—, pero el contrato del informe gana campos y eso es un número nuevo.

---

## 7. Tabla de verificación

| Qué | Comprobación | Valor esperado |
|---|---|---|
| Mover `evaluateVariation` | `test:geometry` | pasa sin tocar una prueba |
| `value` con `ease: linear` | contra las claves a mano | idénticas |
| `value` con `ease: smooth` | punto medio y cuarto | media exacta; el cuarto por debajo |
| Cualquier pista horneada | evaluador certificado contra `evaluateVariation` | misma pose en cada fotograma |
| Pista con `keys` | GLB antes y después | **byte a byte** |
| `turns: 1` | paso entre claves | ≤ 90°, y la pose en los cuartos |
| `turns: 3` | orientación a media vuelta | tres vueltas de verdad |
| Claves a 0° y 360° | `GIRO_AMBIGUO` | salta; cada 90°, no |
| `cycle: 3` | los tres tramos | coinciden con el original |
| `offsetFrames` | forma del movimiento | igual, desplazada |
| Cruce en un solo fotograma | auditoría | se caza, y `recorridoCompleto` verdadero |

---

## 8. Anotado, sin fase asignada

- **Pesos declarados por fórmula.** Es el desbloqueo grande —piel suave, piezas
  orgánicas— y **no cruza la línea del repositorio si se hace bien**: que la
  herramienta *adivine* a qué hueso va un vértice rompe la exactitud; que el agente
  *declare* una caída alrededor de una articulación, con su radio y su curva, es una
  función determinista cuyos invariantes son comprobables —que los pesos sumen uno,
  que ningún vértice quede huérfano, que no haya salto entre piezas—. Merece su
  propio plan, y esa distinción es su primer párrafo.
- **Muelles y ruido determinista.** El editor ya tiene `wiggle.ts` —ruido puro en
  `(semilla, tiempo)`— e interpolación `spring` en forma cerrada. Si el mismo
  movimiento se quiere describir en el documento certificado, la fuente es esa y
  no una segunda implementación.
- **Interpolación `CUBICSPLINE` al exportar.** Hornear con una clave por fotograma
  es simple y exacto, pero engorda el GLB. Con tangentes calculadas se dirían las
  mismas curvas con muchas menos claves. Espera a que un tamaño de fichero lo
  justifique.
