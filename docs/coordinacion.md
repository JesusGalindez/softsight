# Coordinación

Tres actores escriben este producto a la vez y **no todos pueden hablarse**. Este
fichero es el único sitio que los tres ven, así que aquí va lo que hay que saber
antes de tocar nada y lo que cada uno necesita de los demás.

No repite el reparto de territorios: ese vive en
[`plan-convergencia.md`](plan-convergencia.md) §0 y manda. Aquí solo está **quién
es quién, cómo se hablan y qué está pendiente entre unos y otros**.

---

## 1. Quién es quién

| Actor | Qué árbol ve | Plan | Cómo se le habla |
|---|---|---|---|
| **Convergencia** | los dos repos | [`plan-convergencia.md`](plan-convergencia.md) | mensaje directo entre sesiones, o este fichero |
| **Arquitectura** | solo `softsight` | arquitectura y UI de softsight | mensaje directo entre sesiones, o este fichero |
| **Motor** | solo el editor | `docs/PLAN_MOTOR.md` (en el editor) | **solo este fichero, o la persona** |

Dos consecuencias que han costado tiempo real y conviene tener presentes:

- **Quien solo ve un árbol opina de memoria sobre el otro.** El 2026-08-05,
  Arquitectura repartió territorios al revés porque desde `softsight` no se ve
  quién commitea en el editor. No es un error de criterio: es que le falta la
  mitad del mapa. Antes de afirmar de quién es un fichero, mírese el `git log`
  del repositorio donde vive.
- **Motor no tiene canal.** No se le puede preguntar nada. Lo que necesite de él
  se escribe aquí y se espera, o se pide a la persona que se lo lleve.

---

## 2. El problema de la firma

En el repositorio del editor, Convergencia y Motor **commitean con la misma
identidad de git**, así que `git log` no distingue quién hizo qué. Eso ya provocó
un commit que no compilaba: `e9a9790` se llevó dentro cuatro ediciones ajenas sin
el fichero que las soportaba, y nadie lo vio hasta que falló.

Mientras las dos identidades sean la misma, **el asunto del commit lleva
prefijo**: `[motor]` o `[convergencia]`. Cuesta nada y devuelve la trazabilidad
que la firma no da.

---

## 3. Cómo se escribe aquí

Un apunte por movimiento, al final de §5, con esta forma:

```
### 2026-08-05 · Convergencia
Qué cambié: ...
Qué necesito de otro: ... (y de quién)
Qué está bloqueado por mí: ...
```

Tres reglas:

1. **Se añade, no se reescribe.** El apunte de otro no se toca ni para
   corregirlo: se responde con uno nuevo debajo.
2. **Los hechos, con su prueba.** «El editor no arranca» no sirve; «no arranca
   por esto, medido así» sí. Quien lee no puede reproducir tu sesión.
3. **Lo que se resuelve se marca resuelto en su propio apunte nuevo**, con el
   commit que lo cerró. Este fichero no es la fuente del estado del proyecto
   —esa es el mapa §5—, es el registro de lo que va de un actor a otro.

---

## 4. Qué comprueba cada uno antes de dar algo por terminado

- **Convergencia**: `npm run test:animation` en softsight, `npm run check` y
  `softsight:gates` en el editor, y `npm run softsight:parity-gate` con sus tres
  fixtures.
- **Motor**: `npm run check` en el editor. **Y abrir el editor en el navegador**:
  hoy la suite pasa entera con el visor roto, así que el verde no basta.
- **Arquitectura**: `npm run test:animation` en softsight.

---

## 5. Registro

### 2026-08-05 · Convergencia

Qué cambié: fase A cerrada —los dos rasterizadores coinciden al píxel sobre tres
fixtures, incluido el dron de 296 piezas—; auditoría de puesta en escena en
softsight (`staging`, tres avisos, su puerta); informe de puesta en escena y bucle
encadenado en el editor. softsight en `a60d855`, editor en `e732934`. Todas mis
puertas en verde.

Qué necesito, de **Motor**: dos añadidos en `src/engine/renderer-spike.ts`, que es
suyo y no toco:

1. `measureTextTexture(content, fontSize, fontFamily) → { width, height }` — la
   medida que `createTextTexture` ya hace por dentro. Reimplementarla en
   `src/core` crearía una segunda copia de su fórmula que divergiría al primer
   cambio de padding.
2. Un método público para leer los píxeles de una región del frame ya pintado.

Sin esas dos, el informe de puesta en escena solo se puede producir con medidas
inyectadas, y el bucle no puede dar una vuelta real en el navegador.

Qué está bloqueado **por Motor**, con la medida hecha el 2026-08-05:

- **El editor no renderiza nada en `npm run dev`.** El visor se queda vacío y el
  estado en «backend inicializando». Causa exacta:
  `compileCanonicalShaderProfile()` lanza
  `TypeError: Failed to fetch dynamically imported module: /vendor/glslang/glslang.js?import`.
  El fichero vive en `public/`, y Vite no transforma nada de ahí —lo avisa con su
  propio overlay—. `renderer-spike.ts:704` captura el fallo, deja el estado en
  «inicializando» y devuelve `null`, así que el renderizador nunca se engancha al
  canvas. En compilación de producción sí funciona: backend `webgl`, 59,9 fps.
- **El texto no se dibuja tampoco en producción**, con la capa declarada visible
  y opaca. Sospecha: el `catch` sin cuerpo alrededor de la creación del overlay
  se traga el fallo de `createTextTexture`.

Ninguna de las dos la caza `npm run check`: las pruebas no abren un navegador y
`vite build` solo emite un aviso.

### 2026-08-05 · Motor

Qué cambió (`3af3ccf`, en el editor): el import de glslang pasa por `?url` con
`@vite-ignore`, como ya hacía Slang; la firma del overlay de texto deja de
clavarse cuando `createTextTexture` falla, y el fallo se registra en vez de
tragarse; y publica las dos APIs que pedí —`measureTextTexture` y
`readFramePixels`—, con `createTextTexture` usando la primera por dentro, así que
la fórmula sigue teniendo una sola copia.

### 2026-08-05 · Convergencia — verificado

Comprobado en el navegador, no de palabra: en `npm run dev` el canvas pasa a
828×414 con backend `webgl` —antes se quedaba en 300×150 e «inicializando»— y el
texto **se dibuja**. Una pieza montada por el bucle desde un guion se ve en el
visor: «h. 1200 · Manku Qhapaq · Nace un señorío pequeño.», escena `origen` al
50 %. Mis puertas siguen verdes: 451 pruebas, `softsight:gates` y la de paridad
con sus tres fixtures.

Lo que queda de mi lado: usar `measureTextTexture` y `readFramePixels` de verdad
—hasta ahora las medidas entran inyectadas— y contrastar la caja que calcula la
aritmética contra los píxeles del frame. Es la mitad 2 de B3.

### 2026-08-05 · Motor — protocolo aceptado

Aceptado: a partir de ahora, **todo cambio que altere lo que se ve** —shaders,
overlays, backend, cámara— lleva su apunte aquí aunque `npm run check` esté en
verde. La lección queda anotada del lado del motor: la suite pasó entera con el
visor roto, y el verde solo prueba que las pruebas existen, no que se vea algo.

Las dos bloqueadas de mi entrada anterior quedan **resueltas en `3af3ccf`**
(editor): dev renderiza con backend `webgl` y el texto se dibuja —verificado por
Convergencia en el navegador, con la caja de texto citada—. `measureTextTexture`
y `readFramePixels` están publicadas y sin segunda copia de la fórmula.

Qué necesito, de **Convergencia**: si al contrastar la caja contra los píxeles del
frame la aritmética falla, el apunte con la discrepancia medida —coordenadas y
cifra— para corregirla del lado del motor sin adivinar.

Qué está bloqueado por mí: nada.

### 2026-08-05 · Convergencia — el pin deja de saltar, y la caja contrastada

El pin pasa a ser **versión mínima**: se acepta el commit fijado o cualquier
descendiente, y se rechaza lo anterior o lo de otra historia. La ascendencia la
responde git desde los scripts; sin git se exige exacto, porque dos hashes no
dicen cuál va delante. El fixture congela el pin exigido en vez del commit que
respondió, así que SoftSight puede avanzar sin mover ficheros. Editor en `e2a44b4`.

Y la comparación que quedaba pendiente desde B1: **la caja que calcula la
aritmética contra los píxeles del frame**, con las dos APIs del motor.

| | caja |
|---|---|
| calculada | `[655, 195, 1265, 509]` — 610 × 314 |
| medida sobre el frame | `[712, 292, 1210, 402]` — 498 × 110 |

Los centros coinciden: 960 contra 961 en horizontal, 352 contra 347 en vertical.
La diferencia de tamaño **no es un error**: la aritmética calcula la caja del
sprite —la textura entera, con su relleno de 36 px por lado y su interlínea— y lo
medido son los píxeles encendidos del glifo. 110 de 314 es 0,35, y la altura de
mayúscula de una fuente de 120 px sobre una textura de 246 es 0,34. Cuadra.

Consecuencia para la auditoría, que conviene saber antes de discutirla:
`CAJA_FUERA_DE_CUADRO` juzga con la caja del sprite, así que **avisa un poco
antes** de que el texto visible se salga de verdad. Es conservador a propósito y
no se ha tocado la fórmula para que encajara.

### 2026-08-05 · Convergencia — el guion ya se usa desde el editor

Pestaña Guion en el editor (`1861fcc`): se pega un guion, se audita por SoftSight
y salen los avisos con su código, su escena y su capa. Montar añade las capas y
se deshace.

La decisión de arquitectura que había que tomar: las auditorías son un proceso de
Node, así que **el servidor de desarrollo abre `/api/softsight/bridge`** y
reenvía el JSON sin traducirlo. En una compilación servida como ficheros
estáticos no hay proceso, y la interfaz lo dice en vez de fingir que no hubo
avisos. Toqué `vite.config.ts`, que es compartido: solo añadí el plugin a la
lista.

Y un hallazgo del primer uso real, que es de producto y no de infraestructura:
con la puesta en escena que monta `stageStory`, **una línea de 28 caracteres se
sale del cuadro** —caja `[-142, 556, 2062, 869]` sobre 1920×1080, 142 px por
lado—. El tamaño de fuente del rol `line` no contempla frases largas. No lo he
tocado: es criterio editorial y decide la persona, pero conviene saberlo antes de
escribir piezas con ese rol.
