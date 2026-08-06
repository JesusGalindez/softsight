# Traspaso: terminar el plan de geometría (pasos 7, 8 y 9)

Documento de trabajo, autocontenido. Quien lo lea no necesita la conversación
anterior. Cuando el plan quede cerrado, este fichero se borra: lo que merezca
sobrevivir va a `plan-geometria.md`, y dos originales del mismo dato acaban
divergiendo.

---

## 0. Dónde está el trabajo

`docs/plan-geometria.md` es el plan. Seis de sus nueve pasos están hechos, en esta
rama, en siete commits:

| Commit | Qué |
|---|---|
| `4813143` | Rejilla espacial en `symmetryErrorX`: deja de apagarse por encima de 4.000 vértices |
| `582eec4` | Perfiles con nombre y cuatro generadores —círculo, superelipse, Gielis, NACA— |
| `1e66157` | `loft` de secciones cosidas |
| `f8228b7` | Nota en §9 del plan sobre por qué el `loft` se hizo sin `stations` |
| `f38bb4c` | `sweep`, con Catmull-Rom centrípeta, transporte paralelo y `geometryAudit.ts` |
| `fc9940d` | Cuatro deformadores en cadena ordenada |
| `9811d43` | `repeat` radial y espejo |

La puerta es `npm run test:geometry` (`tools/geometry.test.mjs`), y está dentro de
la cadena de `npm run test:animation`. Hoy tiene **40 bloques**.

**Falta:** paso 7 (dos avisos), paso 8 (ejemplar versionado) y paso 9 (cierre
documental). Nada más.

---

## 1. Las reglas del encargo

1. **Un paso, un commit, y el repositorio verde entre paso y paso.** Verde es
   `npm run build` y `npm run test:animation` sin fallos.
2. **Cambio quirúrgico.** Cada línea que toques se rastrea hasta un paso de este
   documento. No reformatees, no renombres, no mejores comentarios vecinos.
3. **Sigue el estilo del fichero que tocas.** Comentarios en español que explican
   *por qué*, no *qué*. El listón está en `createExtrusion` y `createRevolution`
   de `src/soft/mesh.ts`.
4. **Nada de SDF, marching cubes, booleanas, NURBS ni evaluadores de
   expresiones.** El plan explica en §2 por qué, y por qué no es una limitación
   técnica sino la condición para poder certificar.
5. **`contractVersion` y `bridgeContractVersion` no suben.** Nada de esto mueve un
   `renderHash` existente. Ver §5.4.
6. **Lo que un agente deba poder usar se exporta por `src/soft/agent/index.ts` y
   se declara en `src/soft/agent/schema.ts`.** El esquema *es* lo que valida: un
   campo que no esté ahí se rechaza.
7. **Cada cosa se verifica con un número exacto, no con una imagen.** El juez es
   `signedVolume` de `auditMesh`, y el valor esperado es el de la **geometría
   discretizada**, no el de la figura ideal.
8. Las pruebas van en `tools/geometry.test.mjs`, con `node:assert/strict`,
   importando de `../dist-node/agent3d.mjs`. **Añade bloques al final.**

---

## 2. Trampas ya pagadas. Léelas antes de escribir nada

Las seis costaron tiempo. Ninguna es evidente y todas vuelven a morder.

### 2.1 Las matrices se guardan **por filas**

`math.ts` guarda `Mat4` por filas: `translation` deja la traslación en los índices
**3, 7 y 11**, y la fila `r` empieza en `m[r*4]`. Leerlas por columnas produce
resultados plausibles y falsos.

Esto ya mordió una vez: dos comprobaciones del paso 6 estaban mal de forma que se
cancelaban, y solo lo delató la única prueba que comparaba contra un número
absoluto —la caja de cuatro palas daba 1,200 cuando tenía que dar 2,800—. Si
escribes aritmética de matrices en una prueba, **compárala contra un número que
sepas de antemano**, no solo contra otra ejecución del mismo código.

Hay un ayudante ya escrito y correcto en `tools/geometry.test.mjs`:
`worldPositions({ node })` y `linearDeterminant(m)`. Úsalos.

### 2.2 `validate` rechaza toda clave que no esté en el esquema

`src/soft/agent/schema.ts`. Consecuencias que ya cambiaron dos diseños:

- Un diccionario de claves libres es imposible. Por eso `profiles` es una lista
  con `name` obligatorio.
- **`anyOf` se aplica a un campo, no a los elementos de una lista.** Por eso los
  generadores de perfil, las cuatro deformaciones y `repeat` van planos y
  opcionales, y quien exige que haya exactamente uno es el resolutor, con un
  mensaje que dice cuáles encontró.
- Un campo con `fields` **no** puede admitir también un número: `validate` aplica
  el esquema de objeto al número y falla. Por eso `radius` y `twist` de `sweep` no
  llevan `fields`, y su tabla la valida `evaluateVariation`.

### 2.3 Las posiciones son `Float32Array`

Ninguna ida y vuelta por dos deformaciones inversas vuelve bit a bit: el estado
intermedio se redondea a 32 bits. Lo medido es 3,0e-8 en la torsión. Lo que **sí**
sale bit a bit es el parámetro neutro —`degrees: 0`, `amplitude: 0`—. No pidas
exactitud donde el tipo de dato no la da, y no aflojes una comparación que sí
debería ser exacta.

### 2.4 `assert.equal` distingue `-0` de `0`

Usa `Math.abs(x)` cuando el cero pueda venir con signo. Pasó midiendo la holonomía
de un recorrido cerrado plano.

### 2.5 Una prueba que pasa sin probar nada

Un lazo cerrado **plano** tiene holonomía nula, y un zigzag **simétrico** también.
La primera versión de la prueba del residuo del `sweep` pasaba con `-9e-16` sin
comprobar nada. Se cambió por un lazo asimétrico, que acumula 26,78°, dejando el
lazo plano como control de que el medidor no mide su propio ruido.

Aplica el mismo criterio a los avisos del paso 7: **el caso que no debe avisar es
tan importante como el que sí.**

### 2.6 `createCylinder` tiene dos vértices huérfanos

No los referencia ningún triángulo, y su normal es cero. No afecta a topología ni
a imagen. Hay **otra sesión** arreglándolo, y toca `src/soft/mesh.ts` y el bloque
31 de `tools/geometry.test.mjs`. Si te encuentras un conflicto, es ahí. Si ya está
arreglado, el filtro de vértices huérfanos del bloque 31 sobra.

---

## 3. Paso 7 — Los dos avisos que faltan

Van en `src/soft/agent/geometryAudit.ts`, que ya existe y ya tiene
`BARRIDO_AUTOINTERSECADO`. Está escrito para crecer: `auditGeometry(spec)` recorre
los objetos y delega por tipo de geometría.

Ese módulo audita **el documento y no la malla**, y el comentario de cabecera
explica por qué: hay geometría mal declarada que la malla ya no delata.

Necesitarás resolver polígonos por nombre. Hoy `resolveProfiles` y `polygonOf` son
privados en `sceneSpec.ts`; expórtalos —solo eso— en vez de escribir una segunda
resolución.

### 3.1 `PERFIL_AUTOINTERSECADO`

**Qué mira:** dos segmentos del polígono que se cruzan.

**Por qué importa más de lo que parece:** `earClip` (`mesh.ts`) supone polígono
simple. Con uno que se cruza produce tapas basura **sin decir nada**, y el volumen
firmado sale plausible.

**Certeza, no candidato**: es una intersección de segmentos, no una heurística.

**Alcance:** todos los polígonos que la escena declare —los de `profiles`, y los
que vayan en línea en `extrude`, en cada sección de un `loft` y en `sweep`—.

**Coste:** O(n²) sobre decenas de puntos, es decir, gratis. Salta los pares de
segmentos que comparten un extremo.

**Mensaje:** qué pieza o qué perfil, qué dos segmentos, y que es certeza.

**Aceptación:**
- Un polígono en forma de ocho —por ejemplo `[0,0, 1,1, 1,0, 0,1]`— dispara el
  aviso; el mismo cuadrado sin cruzar, no.
- Un NACA de 64 puntos, un círculo, una superelipse y un Gielis de los que ya usa
  la puerta **no** disparan nada. Este es el caso que más vale: un aviso que salta
  sobre los generadores propios sería inservible.
- Un aviso por pieza, no uno por par de segmentos.

### 3.2 `SECCIONES_INCOMPATIBLES`

**Qué mira:** dos secciones consecutivas de un `loft` cuyo emparejamiento retuerce
la superficie.

**Corrección al plan, y es importante.** El plan (§6, paso 7) decía «dos secciones
que giran en sentidos opuestos, **o** su emparejamiento retuerce la superficie más
de media vuelta». **La primera mitad no debe implementarse.** El paso 3 normaliza a
propósito el sentido de cada sección, y hay una prueba —bloque 12— que exige que
escribir una sección al derecho y otra al revés dé **la misma malla**. Avisar de
algo que la herramienta ya arregla sola es ruido, y además contradiría esa prueba.

Queda solo el retorcido, que es real: el `loft` empareja las secciones
remuestreándolas por longitud de arco **desde el vértice cero de cada una**. Coser
un círculo —que empieza en el ángulo 0— con un NACA —que empieza en el borde de
ataque— empareja dos sitios que no se corresponden, y la superficie sale girada.
La puerta ya cose ese caso a propósito, en el bloque 13, y comprueba solo que la
topología aguante.

**Cómo medirlo, sin heurística escondida:** para cada sección ya remuestreada,
toma el ángulo del vector que va de su centroide a su **primer** punto. La
diferencia entre secciones consecutivas, envuelta a (−π, π], es el giro del
emparejamiento. Avisa por encima de **un cuarto de vuelta**, y **di el umbral en
el propio mensaje**, como `storyAudit` declara su ritmo de lectura en el informe:
un candidato con el criterio a la vista se puede discutir; uno sin él, no.

**Candidato, no certeza**, y el mensaje lo dice: hay piezas donde ese giro es
deliberado.

**Aceptación:**
- Un `loft` de círculo a NACA dispara el aviso.
- El mismo `loft` de círculo a círculo, no.
- Un `loft` de NACA a NACA con escalas y torsiones distintas —el ala del ejemplar
  del paso 8—, **no**. Si saltara ahí, el umbral está mal y el ejemplar del paso 8
  no podría quedar limpio.

### 3.3 Cierre del paso 7

Commit: `feat: dos avisos para la geometría declarativa`

En el cuerpo: qué caza cada uno, cuál es certeza y cuál candidato, y el umbral
declarado del segundo.

---

## 4. Paso 8 — Ejemplar versionado

**La puerta ya existe** —se creó en el paso 2, no en este—, así que aquí solo
queda el ejemplar.

### 4.1 Qué se escribe

`artifacts/agent/pieza-geometria.json`, una escena con **una pieza de cada
mecánica**:

- un **ala** por `loft` de perfiles NACA con cuerda y torsión decrecientes,
- un **brazo** por `sweep` de círculo sobre una Catmull-Rom con radio variable,
- una **hélice de cuatro palas** por `repeat` radial,
- un **cuerpo** por `revolve` más un `wave`.

`artifacts/agent/*.json` **sí** se versiona; lo que está en `.gitignore` son los
`.png` y los `.obj`. Mira `guion-tawantinsuyu.json` para el tono.

### 4.2 Limpio de avisos, y qué hacer si no lo está

El ejemplar tiene que salir **sin un solo aviso**. Un ejemplar con avisos enseña
justo lo que la puerta rechaza.

**Si salta `INTERPENETRACION` en las uniones: para y dilo.** No subas el umbral.
El plan lo explica en §6.2: el aviso perdona los solapes donde una caja contiene a
la otra y solo salta por encima del diez por ciento del volumen de la caja menor,
así que una raíz de ala insertada un poco queda por debajo. Si aun así salta, no
es un ajuste: significa que el modismo de ensamblaje por solape no aguanta, y esa
es una decisión de diseño que hay que tomar con la medida delante. Anótalo en §9
del plan y para.

### 4.3 El bloque de la puerta

Al final de `tools/geometry.test.mjs`, uno que lea el fichero y compruebe:

- Que resuelve sin lanzar, y con el número de piezas esperado —recuerda que la
  hélice son cuatro—.
- Que **cada** malla es estanca, sin degenerados, sin aristas no manifold y con
  `inverted` falso.
- Que `auditGeometry(spec)` devuelve **cero avisos**.
- Que `auditSpatial` —exportado desde `index.ts`— no encuentra ningún solape
  parcial: recorre `interpenetration` y exige que todo par tenga `contained`
  verdadero.

No hace falta renderizar: la puerta de geometría no lo ha hecho hasta ahora y no
tiene por qué empezar.

Commit: `test: ejemplar de geometría, una pieza de cada mecánica`

---

## 5. Paso 9 — Cierre documental

### 5.1 `docs/plan-geometria.md`

- La cabecera dice **«Estado: escrito, sin empezar»**. Ya no es verdad.
- Marca los pasos hechos **con los números que salieron**, no con «hecho» a secas.
  Así están escritos los demás planes del repositorio. Los tienes en §6.
- Anota en §9 lo que se descubrió por el camino y no tenía sitio: las trampas 2.1
  a 2.6 de este documento que sigan siendo ciertas.
- Anota también, en §9, **la reparametrización por longitud de arco del `sweep`**:
  hoy las estaciones se reparten uniformemente en el parámetro de la curva y `u`
  solo las *etiqueta* con la fracción de longitud recorrida. Reparametrizar de
  verdad exigiría invertir la tabla numéricamente y traer una tolerancia nueva.

### 5.2 `docs/mapa-del-proyecto.md`

- Añade `test:geometry` a la tabla de puertas de §4, con la misma forma que las
  demás.
- Actualiza el recuento de comprobaciones. Hoy dice «las diecinueve comprobaciones
  de softsight en verde (trece del banco … y seis del puente)». **Cuéntalas de
  nuevo ejecutando la cadena**, no confíes en sumar uno.
- El puntero a `plan-geometria.md` ya está en §1. No hace falta tocarlo.

### 5.3 `README.md`

Las formas de geometría nuevas, donde ya están descritas `extrude` y `revolve`:
perfiles con nombre, `loft`, `sweep`, `deform` y `repeat`. Breve y con un ejemplo
de JSON por cosa, en el tono que ya tiene.

### 5.4 Lo que **no** hay que hacer, y por qué

- **No subas `contractVersion`.** Sube cuando cambia la aritmética o un hash.
  Añadir generadores no mueve ningún `renderHash` existente, porque ninguna escena
  escrita hasta hoy los usa. Subirla obligaría al editor a mover su pin por nada.
- **No regeneres el fixture del esquema del editor.** Está comprobado: el editor
  congela el esquema del **guion** (`softsight-story-schema.json`), no el de
  escena, y `STORY_SCHEMA` no se ha tocado. Una búsqueda de `SCENE_SCHEMA` en
  `public/fixtures` y `src` del editor no da resultados.
- **No borres `docs/traspaso-geometria.md` sin vaciarlo antes** en el plan: lo que
  merezca sobrevivir va allí.

Commit: `docs: la geometría compleja, con los volúmenes medidos`

---

## 6. Los números ya medidos, para el paso 9

No hace falta volver a medirlos; salen de la puerta y están en los commits.

| Qué | Medido |
|---|---|
| `symmetryErrorX`, doce mallas antes y después | idénticas a 17 cifras significativas |
| Revolución de 50.000 vértices | de `null` a 1,3262846e-3; `auditMesh` 287 ms frente a 875 ms |
| Círculo de 32 puntos, r=1, extruido h=2 | 6,24289 frente a 6,242890 del polígono inscrito |
| Superelipse de exponente 2 | idéntica al círculo, número a número |
| Gielis m=4, n=2 | circunferencia con error < 1e-12 |
| NACA 2412, 64 puntos | 64 pares, borde de fuga cerrado, extruido estanco |
| `loft` de dos secciones iguales | 1,764 y 12 triángulos, igual que la extrusión |
| Tronco h·A·(1+k+k²)/3 | cuadra con tres `k` |
| `loft` de círculos ≡ cilindro | 2,996587 por los dos caminos |
| Barrido cerrado ≡ toro | 2,383705 y 2.304 triángulos por los dos caminos |
| Holonomía, lazo plano | 0 exacto |
| Holonomía, lazo torcido | 26,78°, repartidos lineal en `u` |
| Tramo recto | 29 estaciones sin un grado de torsión, a 1e-12 |
| Cono barrido | 2,080963, suma exacta de sus troncos |
| `twist` conserva el volumen | 0,998862 con 30°, 120° y −270° |
| Ida y vuelta de torsión / onda | 3,0e-8 / 1,8e-24 |
| `bend`, corona de radios | 134 vértices dentro de [1,128, 1,928] |
| Matrices radiales | coinciden con `rotationY(2πi/4)·M` a 1e-15 |
| Espejo | desviación 0,0 exacta; volumen 0,048 positivo; determinantes > 0 |
| Cuatro copias, caja en X | 2,800 frente a 0,1 de una pala |

---

## 7. Cuándo parar y preguntar

- El ejemplar del paso 8 dispara `INTERPENETRACION` (§4.2).
- `PERFIL_AUTOINTERSECADO` salta sobre un perfil generado por el propio
  repositorio. Significa que el test de intersección cuenta como cruce el contacto
  entre segmentos vecinos, y aflojarlo con una tolerancia escondería el fallo.
- `SECCIONES_INCOMPATIBLES` salta sobre el ala del ejemplar.
- Algo obliga a mover un `renderHash` existente.

En cualquier otro caso: construye, mide, y di qué supusiste.
