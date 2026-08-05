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
