# Plan de implementación del rasterizador

Estado: **fase 0 completada** el 2026-07-30, más 2.1, 2.2, 2.3, 2.4 y el refinamiento progresivo. Escrito a partir de tres
defectos observados —falta de fluidez, destellos y resolución baja— y de las medidas
que los explican. Los resultados medidos están al final de cada apartado.

## Diagnóstico medido

Banco determinista, escena de 4.966 triángulos, un hilo. Barrido de resolución con
ajuste por mínimos cuadrados de `ms = fijo + porPíxel · píxeles`:

| Píxeles | ms (mínimo de 8) |
|---|---|
| 16.000 | 6,7 |
| 64.000 | 16,2 |
| 144.000 | 29,8 |
| 256.000 | 50,1 |

    fijo     ≈ 10,5 ms por frame
    porPíxel ≈ 110 ms por megapíxel

Estado en vivo en el momento de la observación: canvas de 834×704 CSS,
`devicePixelRatio` 1, buffer interno de **250×211 = 52.750 píxeles = 9 % de los
nativos**, ampliado 3,3 veces. Escala 0,30, la mínima que permite el controlador.

De ahí se deduce lo importante: **a 0,05 MP el 64 % del frame es coste fijo.**
Bajar la resolución por debajo de ~0,1 MP no compra fluidez, solo destruye nitidez.
El controlador estaba haciendo exactamente eso.

Coste del antialiasing de siluetas, medido aparte a 480×300: 2,3 ms de 20,6 ms, el
11 % del frame.

### Las tres quejas, con su causa

| Síntoma | Causa raíz |
|---|---|
| Resolución muy baja | El controlador persigue 60 fps con suelo de escala 0,2 y se ancla en 0,30, mientras el 64 % del coste es fijo. Encima el upscale sale a bloques. |
| Destellos | Cada cambio de escala ejecuta `canvas.width = w`, que **borra el lienzo** por especificación. Con el controlador oscilando, eso son parpadeos negros repetidos. En modo paralelo se suma el hueco entre el borrado y la llegada de las bandas. |
| Falta de fluidez | Suelo fijo de 10,5 ms que ninguna bajada de resolución toca, más `getBoundingClientRect()` en cada frame (fuerza cálculo de estilo), más asignaciones por frame en el camino caliente (22 closures de shader, objeto de estadísticas, reasignación de framebuffer en cada cambio de escala). |

## Resultado de la fase 0

| Métrica | Antes | Después |
|---|---|---|
| Término fijo por frame (banco, mínimo de 8) | 10,49 ms | **3,94 ms** |
| Coste por megapíxel | 109,6 ms | 109,6 ms (sin cambio, no se tocó el bucle) |
| Píxeles internos en vivo | 250×211 = 0,05 MP | **538×338 = 0,18 MP** |
| Fracción de los píxeles nativos | 9 % | **60-85 %, decidido por medida** |
| Frame en vivo | ~38 ms (9-10 fps) | 24-42 ms (**24-40 fps**) |
| Ampliación a pantalla | 3,3× a bloques | 1,2-1,25× bilineal |

El coste por megapíxel idéntico entre ambas sesiones es lo que hace comparable el
resto: confirma que las condiciones de medida no cambiaron.

## Fase 0 — Los tres defectos. Sin esto, lo demás no se ve

**0.1 Desacoplar el buffer interno del canvas visible.** El canvas se fija una vez
a `tamañoCSS × devicePixelRatio` y no se vuelve a redimensionar nunca. El motor
rasteriza en su buffer interno y se presenta con `drawImage` escalado desde un
`OffscreenCanvas`, con `imageSmoothingEnabled = true`.
*Efecto*: desaparecen los destellos —no hay reasignación que borre el lienzo— y la
escala interna pasa a ser libre. El escalado bilineal a 1,6× se ve incomparablemente
mejor que el vecino más cercano a 3,3×. *Coste*: un blit compuesto, ~0,2 ms.
*Ficheros*: `softMain.ts`, `framebuffer.ts` (`present`), `soft.html` (quitar
`image-rendering: pixelated`).
**Hecho** en `present.ts`: el canvas visible se dimensiona solo cuando cambia el
tamaño CSS o el `devicePixelRatio`; en medio va un canvas a resolución interna y se
amplía con `drawImage`. Ningún cambio de resolución vuelve a borrar el lienzo.

**0.2 Reescribir el controlador con la física correcta.** Objetivo 30 fps en vez de
60; suelo de escala 0,6; banda muerta ±25 %; exigir 3 frames consecutivos fuera de
banda y 500 ms mínimo entre cambios. Y la regla nueva: **estimar en vivo el reparto
fijo/por-píxel y no tocar la resolución cuando el término fijo domina** —en ese
régimen la palanca correcta es la geometría (fase 1), no los píxeles.
*Efecto*: a escala 0,6 de este canvas son 211.000 píxeles → 10,5 + 110·0,211 ≈ **34 ms,
30 fps con cuatro veces los píxeles de ahora, al mismo coste que los 38 ms actuales.**
*Ficheros*: `softMain.ts`.
**Hecho** en `resolutionController.ts`, y con dos añadidos que la implementación
reveló como necesarios: el modelo se invalida cuando cambia el tamaño de pantalla
(los dos puntos de operación venían de cargas distintas y la recta describía algo
que ya no existía), y si el modelo pide moverse en sentido contrario a lo que dice
la medida, se descarta y manda la medida. Un modelo obsoleto es peor que ninguno.

**0.3 Quitar el trabajo por frame que no es render.** `getBoundingClientRect()` en
cada frame fuerza recálculo de estilo: sustituir por `ResizeObserver`. Cachear los
shaders por material con un contexto mutable en vez de crear 22 closures por frame.
Reutilizar el objeto de estadísticas. Reservar los framebuffers en un pool en vez de
reasignar en cada cambio de escala.
*Efecto*: ataca directamente el suelo de 10,5 ms y la varianza por recolector de
basura, que es la parte de la falta de fluidez que se percibe como tirones.
*Ficheros*: `softMain.ts`, `renderer.ts`.
**Hecho**: `ResizeObserver`, caché de shaders por material con clave sobre lo que el
shader captura por valor, objeto de estadísticas reutilizado, reserva de
renderizadores por tamaño, y `lookAt` sin asignar vectores. Medido: **el término
fijo bajó de 10,49 ms a 3,94 ms, un 62 %.**

**0.4 Estabilidad temporal del suelo lejano.** El fundido del tablero por huella de
píxel usa un corte duro y un término rasante saturado a 0,02; al mover la cámara,
los píxeles cerca del horizonte alternan entre casilla y media, y eso se percibe como
centelleo. Cambiar a `smoothstep` y subir el suelo del término rasante.
*Ficheros*: `shading.ts`.
**Hecho**: `smoothstep` en el fundido y suelo del término rasante de 0,02 a 0,12.

**Verificación de la fase**: barrido de resolución antes y después (el banco ya lo
hace), captura del mismo encuadre a escala 0,6 frente a 0,30, y una serie de 200
frames registrando escala para comprobar que el controlador ya no oscila.

## Fase 1 — El término fijo *(reordenada a la baja por medida)*

Con el término fijo en 3,94 ms de un frame de ~25 ms a 640×400, este apartado ya no
es la palanca principal: el 88 % del coste es por píxel. La prioridad baja por debajo
de las sombras (2.3). Se mantiene el apartado porque con geometría densa —un GLB de
38.000 triángulos— el reparto vuelve a cambiar, y ahí sí manda.

**1.1 Atribuir los 10,5 ms.** ~~Hipótesis: domina la preparación por triángulo.~~
**Parcialmente resuelto y confirmado.** Al cargar un GLB real de 37.950 triángulos
apareció el término dominante: cinco `subarray` por triángulo —tres al ensamblar,
dos al recortar—, cada uno un `TypedArray` nuevo. Eran ~910.000 asignaciones por
pliego de seis vistas, y el pliego tardaba 10.293 ms; con copias explícitas bajó a
795 ms. En la demo del navegador eso eran ~20.000 asignaciones por frame, coste
independiente de la resolución, que es exactamente por qué el controlador no
compraba fluidez bajando píxeles. Queda repetir el barrido para medir cuánto del
suelo de 10,5 ms sobrevive.

**1.1b Atribución del coste fijo con un modelo real** (296 piezas, 37.950 triángulos,
100.006 vértices), barrido de resolución en vivo:

| Escala | Píxeles | Frame | Etapa de vértices |
|---|---|---|---|
| 25 % | 17.808 | 31,3 ms | 10,9 ms |
| 50 % | 71.107 | 39,2 ms | 8,8 ms |
| 100 % | 284.006 | 80,9 ms | 8,5 ms |

    fijo ≈ 28 ms · 186 ms por megapíxel

De esos 28 ms fijos, **8,5-10,9 son la etapa de vértices**, medidos directamente. El
resto es ensamblado, recorte, proyección y preparación por triángulo. Y el término por
píxel sube de 110 a 186 ms/MP por el muestreo de sombras.

Conclusión: con geometría densa mandan **los dos**. A 0,28 MP el 65 % es por píxel; a
0,018 MP el 90 % es fijo. Reducir triángulos ataca el fijo de forma proporcional
—0,74 µs por triángulo—, así que 1.2 sí está justificado aquí.

**1.4b Descarte en espacio de objeto, antes de la etapa de vértices.** ✅ **Hecho.**
En vez de llevar la geometría a la cámara, se lleva la cámara a la geometría: una
inversa afín por nodo y el test clásico

    dot(normalCara, camaraEnObjeto - vérticeDelTriángulo) ≤ 0  →  reverso

con las normales de cara precalculadas y **sin normalizar**, porque solo importa el
signo. Tres multiplicaciones y dos sumas por triángulo, y ningún vértice se transforma
si todos sus triángulos se descartan. Las marcas de vértice usan un contador de
generación, así que no hay que limpiar nada entre nodos.

Se desactiva cuando el determinante de la matriz del modelo es negativo: una reflexión
invierte la orientación de las caras y el test diría lo contrario; ese caso lo cubre el
descarte en pantalla, que sigue estando.

Medido sobre el GLB de 296 piezas, 37.950 triángulos y 100.006 vértices:

| | Antes | Después |
|---|---|---|
| Etapa de vértices | 8,5-10,9 ms | **3,9-6,1 ms** |
| Término fijo (ajuste de 2 puntos) | 28 ms | 25,9 ms |

La etapa de vértices es la cifra fiable —está instrumentada directamente—; el ajuste de
dos puntos en vivo tiene demasiado ruido para afirmar un 7 %. Contadores deterministas
idénticos antes y después: 2.347 triángulos rasterizados, 161.982 píxeles sombreados.

**1.5 Cachear los atributos de mundo de la etapa de vértices.** *(nuevo, sale de la
medida anterior)* La etapa transforma cada vértice cuatro veces: a clip, a mundo, la
normal a mundo, y a espacio de luz. De esas, **solo la de clip depende de la cámara**;
posición y normal en mundo dependen únicamente de la matriz del modelo. Con un modelo
importado que no se mueve, se recalculan 100.006 veces por frame para dar exactamente
el mismo resultado. Cachearlas con la misma idea que el mapa de sombras —firma de la
matriz del nodo— debería recortar buena parte de esos 8,5-10,9 ms.

**1.2 Nivel de detalle geométrico por distancia.** La esfera (1.024 triángulos) y el
toro (2.304) a veinte metros no necesitan esa densidad. Selección por radio
proyectado, `r_pantalla ≈ r / (w · tan(fov/2))`, con dos o tres niveles pregenerados.
Es el ataque correcto al término fijo.

**1.3b Rechazo de reversos antes de proyectar.** ✅ **Hecho, y sin ganancia medible.**
El área firmada en NDC se obtiene sin dividir: con `n_i = (x_i/w_i, y_i/w_i)`, sacar
denominador común da `área = det[(x,y,w)₀;(x,y,w)₁;(x,y,w)₂] / (w₀w₁w₂)`, así que con
los tres `w` positivos basta el signo del determinante 3×3. Verificado bit a bit:
2.347 triángulos rasterizados, 161.982 píxeles sombreados y 166.334 recorridos,
idénticos a antes del cambio.

Pero el efecto en tiempo está **por debajo del ruido**, y mi recomendación previa
—«ataca los 20.315 triángulos que se proyectan para nada»— era optimista. Lo que se
ahorra es el recorte y tres divisiones por triángulo descartado; lo que *no* se ahorra
es la etapa de vértices, que es por vértice y ya se había ejecutado, ni el ensamblado.
Eso son ~1-2 ms de los 28 fijos. Se queda porque es correcto y gratis, no porque
resuelva nada.

**1.3 Rechazo de triángulos subpíxel** con umbral conservador de área, como red de
seguridad para malla importada sin niveles de detalle.

**1.4 Instanciación.** La columnata son 18 cajas con la misma malla y hoy cada una
repite la etapa de vértices completa. Una sola transformación por instancia.

## Fase 2 — Aspecto profesional

**2.1 Curva de tono filmic en la LUT que ya existe.** ✅ **Hecho.** Coste cero, misma
tabla de 1.024 entradas. Curva Hejl–Burgess-Dawson, que incluye la conversión a sRGB.
Un detalle que solo apareció al verlo: la curva en crudo manda el 1,0 a 0,84, así que
nada llegaba a blanco y la imagen salía lavada; normalizando por el punto de blanco se
conserva el hombro —el motivo de usarla— y se recupera el rango completo.

**2.2 Supersampleo adaptativo.** ✅ **Hecho.** El deslizador llega al 200 %, el
controlador puede subir por encima de 1,0 con tope en 2× (a partir de ahí son cuatro
muestras por píxel y el retorno visual no compensa), y por encima de 1,05 se apaga el
parche de siluetas por redundante, recuperando su 11 %.

**2.3 Mapa de sombras direccional.** ✅ **Hecho**, a 1024². Tres decisiones que son
las que separan una sombra utilizable de un desastre, en `shadowMap.ts`:

- **Profundidad lineal en vez de NDC.** La luz es direccional, luego la proyección es
  ortográfica y la profundidad ya es lineal: se guarda la distancia normalizada a lo
  largo de la dirección de la luz, sin divide por w ni hipérbola. Precisión uniforme
  y ninguna constante mágica que ajustar.
- **Ajuste a los emisores, no a la escena.** El suelo recibe sombra pero no la
  proyecta (`castsShadow: false`). Si entrara en el ajuste, sus 60×60 unidades
  dejarían a los objetos en unos pocos téxeles y la sombra serían cuadrados.
- **Desplazamiento por normal en vez de sesgo constante.** Ataca la causa del
  auto-sombreado —el téxel cubre un trozo de superficie inclinada— en vez de taparla
  despegando la sombra del objeto.

Coste medido en dos rondas:

| | pase de profundidad | sobrecoste total (4 muestras) |
|---|---|---|
| Transformación mundo→luz **por píxel** | 2,2-6,0 ms | **+32 %** |
| Coordenadas de luz como **varyings** | 2,3-6,2 ms | **+26 %** |

La primera medida decía dónde estaba el coste: una sola muestra ya costaba 17,5 ms de
los 27,6, así que mandaba la transformación repetida por píxel, no las muestras. Se
movió a la etapa de vértices —tres varyings más, interpolados por el rasterizador que
ya interpola otros ocho— junto con el desplazamiento por normal, que es la
formulación estándar de *normal offset* y allí se calcula una vez por vértice.

Para que apagar las sombras no pague la interpolación de tres componentes que nadie
lee, el número de varyings activos pasó a ser variable: 8 en el caso base, 11 con
sombras, con los búferes dimensionados al máximo y cada etapa recorriendo solo los
activos.

El número de muestras sigue siendo elegible: duras (1) cuestan +7,3 ms y suaves (4)
+9,2 ms sobre una base de 25,9 ms.

**2.4 Regla de relleno top-left.** ✅ **Hecha.** Con las aristas ya orientadas para que
el interior sea e ≥ 0, la clasificación sale directa: el interior queda a la derecha
cuando A > 0 (arista izquierda, inclusiva) y debajo cuando A = 0 y B > 0 (arista
superior, inclusiva); el resto, estrictas. En términos del span, «inclusivo» es
`ceil(x)` y «estricto» es `ceil(x) - 1`, que **para x no entero son el mismo número**:
la regla cuesta cero y solo cambia el caso en que el borde cae justo sobre el centro
del píxel.

Verificación con contadores deterministas, que sí son comparables entre sesiones:
166.334 píxeles recorridos antes y después, es decir **cero diferencia en esta
escena**. Es el resultado esperado: con vértices en coma flotante, que el centro de un
píxel caiga exactamente sobre una arista compartida es un empate de probabilidad
prácticamente nula. Que el contador no baje confirma que no había doble sombreado
medible aquí, y que no suba confirma lo que de verdad había que comprobar: la regla
no abre huecos de un píxel entre triángulos adyacentes. Su valor es la garantía —cada
píxel pertenece a un solo triángulo— que hace posible la transparencia y el
antialiasing por cobertura, no un ahorro en esta escena.

**2.4b Especular sin normalizar el semivector.** ✅ **Hecho.** `pow(dot(N,Ĥ), s)` con
`Ĥ = H/|H|` es idénticamente `pow(dot(N,H)² / |H|², s/2)`: trabajando con el coseno al
cuadrado y la mitad del exponente —que ya se evalúa por elevaciones al cuadrado—
desaparecen una raíz y tres divisiones por píxel. No es una aproximación.

Micro-banco aislado, 300.000 evaluaciones: **8,0 ms → 6,1 ms, un 24 % menos**, con
resultado idéntico dentro de 1e-9. Son 6,3 ns por píxel, es decir ~1 ms por frame a
160.000 píxeles sombreados. Un exponente impar se redondea al par más próximo; con los
valores habituales —12, 32, 48, 64, 96, 128, 140— la equivalencia es exacta.

**2.4c Recíproco de la perspectiva: el segmento fuera, la división dentro.**
✅ **Hecho, y al revés de lo que yo esperaba.**

La idea era eliminar las divisiones que quedaban con una iteración de Newton-Raphson
para el recíproco, `w' = w(2 - invW·w)`, partiendo del valor del píxel anterior.
Micro-banco antes de tocar el bucle caliente, 500 píxeles × 600 repeticiones:

| Esquema | ms | Error relativo máximo en `w` |
|---|---|---|
| Segmentos de 16 (lo que había) | 2,4 | 1,36 % |
| Segmentos de 8 | 2,7 | 0,33 % |
| Segmentos de 4 | 3,3 | 0,058 % |
| **División exacta por píxel** | **2,5** | **0** |
| Newton-Raphson por píxel | 6,6 | 0 |

Newton salió **3× más lento**. La hipótesis era falsa: la división nunca fue el cuello
porque ya estaba amortizada 1/16, y añadir dos multiplicaciones, dos sumas y una rama
por píxel cuesta más que esa fracción de división.

Lo revelador es la cuarta fila. Dividir en **cada** píxel cuesta lo mismo que la
maquinaria de segmentos —2,5 contra 2,4 ms— y da resultado exacto. La contabilidad del
segmento (dos divisiones, una resta, otra división y un incremento por píxel) consume
justo lo que la división que evita. Así que se borró el esquema: menos código, error
cero, mismo tiempo. La reducción «de 161.982 divisiones a ~20.000» que documenté en su
día era cierta en el recuento y nula en el reloj.

Además ahora solo se divide en los píxeles que **pasan** el test de profundidad, no en
todos los del span.

**2.5 Texturas con mipmaps y filtrado trilineal**, para materiales que no sean
procedurales.

**2.6 Oclusión de contacto** sobre el z-buffer, 4-8 muestras a media resolución.

## Refinamiento progresivo con caché de frame *(en lugar de reproyección temporal)*

La opción que estaba sobre la mesa era la reproyección temporal por píxel: proyectar
cada píxel con la matriz del frame anterior, `VP_anterior · VP_actual⁻¹`, y reutilizar
su color si la profundidad concuerda. Ahorra en torno a la mitad del sombreado
**mientras la cámara se mueve**, a cambio de agujeros en las zonas desocluidas y de un
especular que se arrastra un frame por depender del punto de vista.

Para este motor el reparto no sale. El caso dominante es mirar un objeto quieto, y ahí
la comparación es demoledora: si no ha cambiado nada —cámara, escena, opciones,
resolución— el frame entero es idéntico al anterior, así que no se ahorra la mitad del
sombreado sino **todo**, y sin ningún error. Durante el movimiento, que es cuando la
reproyección ayudaría, ya está el controlador de resolución bajando píxeles, y es
cuando menos detalle se aprecia.

Implementado así:

- **Firma de frame** sobre todo lo que altera la imagen: cámara completa, todas las
  opciones de render, la matriz de cada nodo y el tamaño del buffer. Si coincide con
  la del frame anterior, no se dibuja nada.
- **Refinamiento por pasos** con el presupuesto que sobra: ×1 → ×1,4 → ×2 sobre la
  escala interactiva. Al soltar el ratón la imagen se afina sola.

Medido con el GLB de 296 piezas: la escala interactiva daba 505×317, y con la cámara
quieta sube a **1010×634 = 0,64 MP, 1,5 veces la resolución de pantalla** —supersampleo
real, no post-proceso— y a partir de ahí **más de 800 frames sin redibujar**, con coste
cero. Al mover la cámara vuelve a dibujar de inmediato y al parar refina otra vez.

El riesgo de este diseño es olvidarse de meter algo en la firma: la pantalla se
quedaría con una imagen vieja. Cualquier opción nueva del renderizador tiene que
entrar en `computeFrameSignature`.

## Fase 4 — Acumulación progresiva: un integrador, cuatro efectos

Al construir la caché de frame con refinamiento progresivo montamos, sin darnos cuenta,
el sustrato exacto de un **integrador de Monte Carlo**: con la cámara quieta disponemos
de N pasadas gratis, porque el usuario ya no está esperando nada. Hoy esas pasadas solo
suben la resolución. Si además **variasen un parámetro de muestreo y se acumulasen**, el
mismo mecanismo resolvería cuatro problemas distintos que hoy no sabemos resolver.

Todos son la misma integral. Lo que cambia es sobre qué se integra:

| Se varía entre pasadas | Se obtiene |
|---|---|
| Desplazamiento sub-píxel de la proyección | Antialiasing exacto, no un parche posterior |
| Dirección de la luz dentro de un cono | Sombras suaves con penumbra real |
| Dirección de un rayo sobre el hemisferio | Oclusión ambiental |
| Posición de la cámara sobre un disco | Profundidad de campo |

Una sola maquinaria —acumulador y contador de pasadas— y cuatro efectos que, por
separado, serían cuatro implementaciones.

### 4.1 El estimador

Cada píxel es una integral sobre su propia superficie: `I = ∫∫ f(x,y) dx dy`. Muestrear
una vez en el centro, que es lo que hacemos, es la peor aproximación posible de esa
integral, y el resultado son los bordes dentados.

Promediando N muestras el error cae como `1/√N` si las posiciones son aleatorias. Pero
con una **secuencia de baja discrepancia** cae como `log(N)/N` —cota de Koksma-Hlawka—,
que a 16 muestras ya es una diferencia enorme. Para dos dimensiones, la secuencia R2 de
Roberts es casi óptima y son dos líneas:

    φ = 1.324717957244746        (número plástico, raíz de x³ = x + 1)
    xᵢ = frac(i / φ)
    yᵢ = frac(i / φ²)

Sin estado, sin tablas, sin generador aleatorio, y determinista — que para este motor no
es un detalle: la pasada número 7 es siempre la misma pasada número 7.

### 4.2 Qué hay que tocar

- **Desplazamiento sub-píxel**: sumar `(xᵢ-0.5, yᵢ-0.5)` en píxeles a la traslación de
  la matriz de proyección. Dos términos de la matriz; el rasterizador ni se entera.
- **Acumulador**: un `Float32Array` de tres canales junto al framebuffer. Al presentar,
  dividir por el número de pasadas.
- **Firma de frame**: debe incluir el índice de pasada, o la caché detendría la
  convergencia creyendo que no ha cambiado nada. Y cualquier cambio de cámara, escena u
  opciones reinicia el contador a cero.

Es la parte delicada del diseño y conviene escribirla con cuidado: la caché y el
acumulador tiran en sentidos opuestos si no se coordinan.

### 4.3 Por qué es mejor que el supersampleo que ya tenemos

El supersampleo ×2 da 4 muestras pagando 4× en **un solo** frame, y ahí se acaba: no
puede ir más allá sin cuadruplicar otra vez. La acumulación da 4 muestras en 4 frames
pagando 1× cada uno, y **no tiene techo**: a los dos segundos quietos van 60 muestras.
Para un motor cuyo caso dominante es mirar un objeto parado, la segunda forma es
estrictamente superior.

### 4.4 Oclusión ambiental sin estructuras nuevas

La oclusión ambiental es `∫_Ω V(ω) cos θ dω`, la fracción del hemisferio que ve un
punto. Calcularla con rayos exigiría una jerarquía de volúmenes envolventes y código de
intersección nuevo.

Pero ya tenemos un mecanismo que responde «¿ve la luz este punto?» para una dirección
dada: el mapa de sombras. **Promediar el test de sombra sobre muchas direcciones
distribuidas en el hemisferio es la oclusión ambiental**, y una dirección por pasada
converge sola con el acumulador. Reutiliza entero lo que ya está escrito.

Es lo que de verdad asienta un objeto sobre el suelo, mucho más que la sombra
direccional.

## Fase 5 — Simplificación con error medible

El nivel de detalle por radio proyectado (fase 1.2) es una heurística: reduce
triángulos sin saber cuánto se aleja de la forma original.

La formulación rigurosa son las **métricas de error cuadrático** de Garland-Heckbert.
Cada vértice acumula una matriz simétrica 4×4, suma de los productos externos de los
planos de sus caras incidentes; el coste de colapsar una arista es `vᵀQv`, que es
exactamente **la suma de distancias al cuadrado a esos planos**. Minimizarlo da la
posición óptima del vértice resultante resolviendo un sistema 3×3.

Lo que aporta no es solo mejor simplificación: aporta **una cota de error en unidades de
mundo**. Eso permite dos cosas que hoy no podemos:

- Elegir el nivel de detalle por un criterio verificable —«error por debajo de medio
  píxel en pantalla»— en vez de por una constante ajustada a ojo.
- Que el informe del agente diga *«simplificado a 2.000 triángulos con una desviación
  máxima de 0,3 mm»*, que es justo el tipo de número que hemos perseguido todo el
  proyecto.

## Fase 6 — Piezas menores, pero exactas

**Derivadas de pantalla por regla del cociente.** Cuando lleguen las texturas hará falta
el nivel de mipmap, que se elige por `∂u/∂x` y `∂u/∂y`. No hace falta calcularlas por
diferencias finitas: `u = (u/w)/(1/w)` y las dos partes son afines en pantalla con
gradientes que el rasterizador **ya calcula**, así que la derivada sale exacta por la
regla del cociente. Filtrado anisótropo correcto sin muestrear vecinos.

**Ruido azul en vez de Bayer.** La matriz de Bayer tiene estructura regular y en un
degradado suave se percibe como un tramado en aspas. Una tesela de ruido azul de 64×64
—generada por «void and cluster»— concentra el error de cuantización en las frecuencias
altas, donde el ojo es menos sensible. Mismo coste: un acceso a tabla.

**Predicados exactos.** Las funciones de arista usan coma flotante, así que la
orientación de un triángulo casi degenerado puede evaluarse mal. Los predicados
adaptativos de Shewchuk la hacen demostrablemente correcta. Es rigor de más para
dibujar, pero es la base honesta si el render se usa como verdad de referencia en
integración continua.

## Fase 7 — Izar lo que el gradiente ya dice que es constante

El rasterizador calcula, por triángulo, el gradiente de cada varying: `∂v/∂x` y
`∂v/∂y`. Ese gradiente **es la derivada**, y una derivada nula significa que el atributo
no varía en todo el triángulo. Hoy esa información se calcula y se tira.

### El caso que importa: normal constante

En una superficie plana los tres vértices comparten normal, luego sus seis gradientes
son cero. Y sin embargo el sombreado hace, en **cada** píxel:

    normalizar N   →  3 cuadrados, 1 raíz, 3 divisiones
    lambert = N·L  →  3 multiplicaciones, 2 sumas

Es decir, se recalcula cien mil veces un número que es idéntico las cien mil. El suelo
de la escena de demostración son dos triángulos; cada cara de cada caja de la columnata,
igual. Cualquier modelo de superficie dura —justo lo que audita el banco de agentes—
está lleno de caras planas.

### La detección es gratis y exacta

No hace falta heurística ni marcar las mallas de antemano. En la preparación del
triángulo ya están `varyingStepX[3..5]` y `varyingStepY[3..5]`. Si los seis son cero, la
normal es constante: se normaliza una vez, se calcula `lambert` una vez, y ambos se izan
fuera del bucle de píxeles. Un `if` por triángulo sobre seis números ya calculados.

### La regla general

**Cualquier varying con gradiente nulo es constante, y toda operación que dependa solo
de constantes puede izarse a la preparación del triángulo.** Es la extracción de
invariantes de bucle que haría un compilador, hecha en tiempo de ejecución con
información que el rasterizador ya posee y que hoy descarta.

Ahorro estimado en un triángulo de normal constante: una raíz, tres divisiones y una
docena de multiplicaciones por píxel, entre el 30 y el 40 % del sombreado iluminado. El
especular sigue variando, porque depende del vector de vista.

### Condición de entrada

**Medir primero** qué fracción de los píxeles sombreados proviene de triángulos con
normal constante. Un contador en la preparación, sin tocar el bucle interior.

- Por encima del 50 %: se implementa.
- Por debajo del 20 %: se queda aquí como idea descartada por medida, con su cifra.

En la escena de demostración la estimación es alta —suelo y columnas dominan el
encuadre—, pero en el GLB del dron no se sabe. Este proyecto ya ha enseñado dos veces
que optimizar sin medir el reparto es apostar: el controlador de resolución peleaba
contra el término equivocado, y Newton-Raphson salió tres veces más lento de lo que
sustituía.

## Fase 3 — Producción

**3.1 Cargador GLB** hacia el formato `Mesh`. Conecta el banco de agentes con el
pipeline `img2threejs` que ya vive en el repo: modelo generado dentro, veredicto de
topología, normales, pivote y simetría fuera.

**3.2 Hojas de referencia deterministas en CI**, sustituyendo las capturas que hoy
dependen de WebGL y del driver.

**3.3 SIMD por Wasm** en el bucle interior, y medir el paralelo por bandas en una
máquina de 8 núcleos antes de darlo por bueno.

## Orden recomendado

1. **Fase 0 completa**, de una vez. Es donde están los tres defectos observados y
   se sostienen entre sí: el controlador nuevo no sirve sin el desacoplo del canvas.
2. **2.1** (curva de tono, coste cero) y **2.2** (supersampleo adaptativo), que
   reutilizan lo anterior y dan el salto visual.
3. **1.1 y 1.2**, la fluidez real.
4. **2.3**, sombras.
