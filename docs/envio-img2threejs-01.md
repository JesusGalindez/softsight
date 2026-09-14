# Envío 01 a img2threejs — 2026-09-13

Carta, no manual. Propone conectar
[`img2threejs`](https://github.com/img2threejs/img2threejs) con este repositorio
para que las puertas de su pipeline midan geometría además de mirarla.

Escrito tras leer una docena de ficheros por la API de GitHub —`ARCHITECTURE.md`,
`EMISSION_TARGET_SOCKET.md`, `forge/stage3_build/`, `forge/stage4_review/`— **sin
ejecutarlo**. Lo que aquí se afirme de su lado está sacado de esos ficheros y
puede estar desactualizado; lo que se afirme del nuestro está medido.

---

## 1. Por qué esto encaja, en dos frases

La primera línea de `src/soft/agent/inspect.ts` dice por qué existe softsight:

> Una imagen no distingue una malla cerrada de una con agujeros, ni una normal
> invertida de una superficie en sombra, ni un vértice duplicado de uno soldado.

Y el `ARCHITECTURE` de img2threejs dice que **el progreso de cada pase se
denomina en capturas de pantalla**, con el modelo juzgando fidelidad visual sobre
hojas de comparación.

Uno mide exactamente lo que el otro no puede ver.

---

## 2. La bisagra que falta, y está en vuestro lado

`emit_target.py` comprueba la precondición **`action-ready`** antes de exportar:
el GLB existe solo cuando **todas las puertas han pasado**, y solo con
`--target glb`. Durante el bucle no hay malla — hay TypeScript y capturas.

Softsight mide mallas. **Eso es lo único que hace falta para conectar:**

```text
hoy      pase → genera TS → renderiza captura → puerta mira la captura
falta    pase → genera TS → renderiza captura → exporta GLB → puerta lo mide
```

Ya renderizáis por pase, así que un runtime de Three.js ya corre. Exportar ahí es
llamar al exportador que ya tenéis **desde dentro del bucle** en vez de en
`FINAL_STEPS`. No sabemos qué cuesta eso en vuestro código; es la única pregunta
que no podemos contestar desde aquí.

**Lo que no hace falta es un protocolo nuevo.** Vosotros tenéis `gates.json` con
`blocking: true` y un contrato de plugins; nosotros tenemos un puente por JSON y
un servidor MCP. Softsight entra como **una puerta más**, no como una bifurcación.

---

## 3. Lo que ya está listo de nuestro lado

Añadido hoy, precisamente para esto:

```bash
agent3d --model pase-n.glb --diff pase-n1.glb --diff-max 0.02
```

```json
{
  "command": "diff",
  "files": { "model": {…}, "other": {…} },
  "options": { "diffSamples": 20000, "diffMax": 0.02 }
}
```

Las dos vías dan el mismo informe. La segunda es el puente: proceso residente,
0,14 s por llamada, sandbox sin shell.

**El veredicto no lo ponemos nosotros.** `--diff-max` va en **fracción de la
diagonal** y no en unidades, porque una distancia sin escala declarada no dice si
es mucho o poco. Sin la bandera sale el informe y la orden vale 0; con ella,
pasarse es salida 1. El umbral lo pone quien conoce el objeto.

---

## 4. Qué aporta, medido

Simulamos lo que hace vuestro bucle: dos versiones del mismo objeto, donde el
segundo pase engorda un sensor y alarga un brazo. Un cambio que una hoja de
comparación puede dar por bueno.

```text
                        máximo    media     rms      normal (media)
a→b  lo que falta en b  0,0398    0,0040    0,0122    2,03°
b→a  lo que sobra en b  0,1500    0,0061    0,0186    3,52°

worstRelative           0,0454 de la diagonal
volumen firmado         +0,0422
```

**La asimetría es el resultado.** `b→a` es casi cuatro veces `a→b`: el pase
**añadió** superficie. Muestrear A y buscar en B no lo ve — cada punto de A sigue
teniendo el suyo en B—, y es exactamente el caso de un pase de forma que infla, o
de un `decimate.py` que deja material de más. Por eso las dos direcciones se
publican separadas y **no se promedian**: 0,095 no describiría nada.

Control: el mismo modelo contra sí mismo da **3,4e-14** de la diagonal.

Y como puerta:

```text
--diff-max 0.02   →  salida 1, «la superficie se movió 4,54e-2 … el peor lado es
                     b→a, superficie que sobra»
--diff-max 0.20   →  salida 0
```

> El máximo de desviación de normales sale 90° en las dos direcciones y **no es
> un defecto**: con geometría de cajas, el punto más próximo a una muestra cae a
> veces en una cara perpendicular. El número que informa es la media.

---

## 5. Lo que NO proponemos, porque ya lo tenéis

`forge/stage4_review/geometry_integrity.py` ya calcula `boundaryEdges` y
`nonManifoldEdges` soldando por `round(v, 6)`. **Eso no lo repetimos.**

Lo que no tenéis es **qué significan esos números**:

```text
148 aristas de borde   ¿un agujero grande, o treinta y siete pequeños?
84.000 triángulos      ¿una pieza, o doce cáscaras sueltas?
```

Las dos preguntas cambian la reparación entera. `analyzeMeshTopology` da los
bucles con perímetro y extensión, y los componentes con área, más
`largestComponentAreaRatio` — que separa «una pieza con una mota» (0,99) de «una
nube de trozos» (0,14) cuando el recuento dice 2 y 7 en los dos casos.

**Un modelo procedural que sale en doce cáscaras desconectadas renderiza
perfecto.** No lo ve la vista ni lo ve un contador de aristas.

---

## 6. Un regalo, sin contrapartida

Cerramos hoy el test triángulo-triángulo y nos comimos un error de libro. La
versión que busca «qué vértice queda solo de su lado» **divide por cero** con los
signos `(0, +, +)` —un vértice justo en el plano, los otros dos del mismo lado—.

Con eso, **un cubo cerrado salía con cuatro autointersecciones**: pares de caras
que solo se tocan en una esquina. Si vuestro `forge/stage4_review/self_intersection.py`
sigue el Möller estándar, tiene la misma trampa. El arreglo es calcular el
intervalo recorriendo aristas, donde el caso no es especial.

Y el suelo, medido: la rejilla de `Float32` en la que viven las posiciones no
resuelve por debajo de **2,3e-8 de la magnitud de la coordenada**, estable entre 1
y 10⁶. Cualquier epsilon absoluto vale para el cubo unidad y falla en un modelo en
milímetros.

---

## 7. Lo que proponemos hacer, por orden

1. **Vosotros:** exportar un GLB en **un** pase intermedio de un objeto que ya
   tengáis, y pasarlo por `agent3d --model x.glb --summary`. Si los números no
   dicen nada útil sobre vuestros modelos, la conversación acaba ahí y ninguno ha
   gastado más de un rato.
2. **Si dicen algo:** el diff pase a pase como puerta de `stage4`, que es donde
   vuestra arquitectura ya tiene el hueco.
3. **Después, si procede:** topología y autointersección como avisos, con la
   distinción entre *certeza* —aritmética que no depende de la intención— y
   *candidato* —medida firme, conclusión abierta—. Es lo que permite a un bucle
   arreglar unas cosas solo y escalar otras, en vez de fallar en las dos.

---

## 8. Lo que no sabemos

- Si vuestro runtime de capturas puede exportar GLB sin montar nada nuevo. **Es
  la bisagra entera** y no la podemos contestar desde fuera.
- Qué cubre `self_intersection.analyze_mesh`. Solo vimos que existe.
- El coste por pase. La topología de las 296 piezas del dron cuesta 0,16 s de CPU
  y la autointersección 0,59 s sobre 71.556 pares; en un objeto suelto es ruido,
  pero multiplicado por ocho pases y un bucle de corrección **hay que medirlo, no
  suponerlo**.

Y una cosa que sí sabemos: img2threejs tiene 15.900 estrellas, 1.300 forks y un
ecosistema de plugins. Lo que entre tiene que encajar en vuestro contrato, no al
revés.
