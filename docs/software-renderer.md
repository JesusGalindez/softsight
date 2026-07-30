# Rasterizador software: análisis y mapa del código

Análisis del texto sobre proyección 3D y su traducción a un pipeline ejecutable
sin GPU. Página de demo: `soft.html` (`/soft.html` en el servidor de desarrollo).
Banco: `/soft.html?bench=24`. Código: `src/soft/`. Cero dependencias, 23 kB de
bundle.

## 1. Qué dice el texto y qué le falta

Lo que describe es correcto en lo esencial y no discutible: el divide por
profundidad, la base en triángulos semejantes, la generalización con cotangente
del FOV, la codificación de la división en `w`, el z-buffer, NDC, viewport y
recortado. Cinco puntos donde el texto se queda corto o induce a error:

**1. `x' = x/z` está incompleto y con el signo mal.** La fórmula completa es
`x' = d·x / (-z)` con `d` la distancia al plano de proyección. Sin `d` no hay
escala; y en un espacio de vista diestro (el estándar: cámara mirando hacia
`-Z`) lo que está delante tiene `z` negativa, así que el denominador es `-z`.
Escrita como `x/z` la imagen sale invertida en ambos ejes. En el código: la
última fila de la matriz es `[0,0,-1,0]` — ese `-1` es el signo que el texto se
come (`src/soft/projection.ts`).

**2. La ventaja de la matriz no es estabilidad numérica cerca de `z=0`.** Una
matriz no arregla nada por sí sola: `z=0` sigue dando `w=0` y la división sigue
siendo infinita. La ventaja real es de **orden de operaciones**. La matriz
produce coordenadas de clip con `w` explícito, y eso permite recortar *antes* de
dividir, en un espacio donde el plano cercano es el plano lineal `z = -w`. El
recorte elimina los vértices con `w ≤ 0` antes de que nadie los divida. La
estabilidad es consecuencia del recorte, no de la matriz.

**3. El punto de fuga no es único ni está en el centro.** Cada familia de rectas
paralelas tiene *su* punto de fuga; el centro de la imagen (punto principal) solo
recibe las rectas paralelas al eje óptico. Un cubo girado tiene dos o tres puntos
de fuga, la mayoría fuera de la pantalla. Lo que converge al centro en la demo es
la columnata, y solo porque la cámara mira a lo largo de ella.

**4. La profundidad en el z-buffer no es lineal, y el texto lo pasa por alto.**
Al mapear con la matriz de perspectiva sale
`z_ndc = (f+n)/(n-f) + 2fn/((n-f)·z_vista)`: una hipérbola. Con `near = 0.01` y
`far = 1000`, el 90 % de los valores representables se gasta en el primer 1 % de
la escena. Eso es el z-fighting lejano. Remedios reales: subir `near` todo lo
posible (el parámetro que más importa, mucho más que `far`), o *reversed-Z* con
profundidad en float, que reparte el error de forma casi uniforme. En la demo el
modo «Profundidad» reconstruye la distancia lineal precisamente porque pintar el
buffer en crudo sale casi todo blanco.

**5. Falta la pieza que rompe cualquier rasterizador escrito desde cero: la
corrección de perspectiva.** El texto llega hasta la posición del vértice y para.
Pero una vez el triángulo está en pantalla, interpolar UVs, normales o color
linealmente en el plano de imagen **está mal**: la proyección es proyectiva, no
afín. Lo que sí es afín en pantalla es `atributo/w` y `1/w`. Se interpolan esos y
se divide en el píxel. Omitirlo produce el temblor de texturas de la
PlayStation 1 — que es exactamente lo que hacía la PS1, interpolar afín. La demo
lo tiene como interruptor: quítalo y el suelo ondula.

Un matiz menor sobre la ortográfica: sí es una proyección en sentido estricto —
una proyección paralela sobre el plano de imagen. Lo que desaparece es la
división, no la proyección. Llamarla proyección no es un abuso de lenguaje.

## 2. El pipeline, etapa por etapa

| Etapa | Archivo | Nota |
|---|---|---|
| Álgebra 4×4, matriz de normales | `math.ts` | Row-major, para que se lea como en papel |
| Proyección, viewport, planos del frustum | `projection.ts` | `f = cot(fov/2)`, NDC `[-1,1]`, profundidad invertida |
| Recortado en espacio homogéneo | `clip.ts` | Sutherland–Hodgman, solo plano cercano |
| Rasterizado, z-buffer, varyings | `raster.ts` | Span exacto + gradientes incrementales |
| Shaders de píxel | `shading.ts` | Blinn-Phong, normales, profundidad, UV |
| Antialiasing de siluetas | `postprocess.ts` | Discontinuidad de profundidad |
| Orquestación | `renderer.ts` | Las 11 etapas en un solo hilo |
| Escena de demostración | `scene.ts` | Cada objeto exhibe una propiedad concreta |
| Canvas, cámara orbital, HUD | `softMain.ts` | `getContext("2d")` + `putImageData` |
| Banco determinista | `bench.ts` | `?bench=N` o `window.__softBench()` |

Decisiones que no son obvias:

- **Solo se recorta el plano cercano.** Los laterales salen gratis con el
  bounding box del rasterizador (scissor implícito) y el lejano con el test de
  profundidad. El cercano es el único que *puede* producir `w ≤ 0`.
- **Funciones de arista en vez de scanlines clásicas.** `e(x,y)` es afín, así que
  avanzar un píxel es una suma. Y normalizadas por el área firmada *son* los
  baricéntricos: cobertura e interpolación del mismo cálculo.
- **El signo del área firmada hace el culling.** En un sólido cerrado descarta la
  mitad de los triángulos antes de tocar un píxel.
- **La etapa de vértices se cachea por malla.** Un vértice compartido por seis
  triángulos se transforma una vez, no seis.
- **Todo en arrays tipados, cero asignaciones por frame** en los bucles
  calientes. En CPU, la presión del recolector de basura se ve en el frame time.

## 3. Optimizaciones: la matemática y lo que midió cada una

Todas comparten la misma idea: aprovechar que **las funciones de arista son
afines**, y que por tanto todo lo que se deriva de ellas también lo es.

**Span exacto por scanline.** `e(k) = e₀ + A·k ≥ 0` se resuelve en lugar de
recorrerse: `k ≥ -e₀/A` si `A > 0`, `k ≤ -e₀/A` si `A < 0`, y la intersección de
las tres restricciones es el intervalo cubierto. Tres divisiones por fila
sustituyen al recorrido del bounding box entero comprobando cobertura, y dentro
del span no queda ni una comprobación. Medido: 515.898 píxeles de bounding box
→ 166.334 recorridos, **3,1× menos iteraciones**, con 97,4 % de ellas acabando
en color.

Esto absorbe casi todo el beneficio del rechazo jerárquico por bloques 8×8
(`e_max = e + max(0,A·8) + max(0,B·8) < 0` descarta 64 píxeles con 3
comparaciones), que por eso **no** está implementado: con spans exactos, una fila
entera fuera del triángulo ya cuesta solo tres divisiones. El bloque ahorraría
parte de ese coste de fila, no los píxeles, que es donde estaba el desperdicio.

**Gradientes incrementales.** Todo atributo interpolado es afín en pantalla,
luego su derivada es constante: `∂v/∂x = (A₁₂·v₀ + A₂₀·v₁ + A₀₁·v₂)/área`, una
vez por triángulo. Avanzar un píxel pasa de 3 multiplicaciones de baricéntricos
más 24 multiplicaciones-suma a 10 sumas. Los acumuladores van en `Float64Array`:
sumar el mismo gradiente 2.000 veces en float32 acumula error visible.

**Corrección de perspectiva por segmentos.** `w` se calcula exacto en los
extremos de cada segmento de 16 píxeles y se interpola lineal por dentro.
Divisiones: de 161.982 (una por píxel sombreado) a ~20.000.

**Profundidad invertida.** `near` y `far` intercambiados en la matriz, buffer
limpiado a 0, test "mayor pasa". La hipérbola de la proyección y el espaciado no
uniforme del float se cancelan casi exactamente, y el error relativo de
profundidad pasa a ser casi uniforme en toda la escena. Coste: cero
instrucciones. Obliga a cambiar el signo del recorte cercano a `w - z ≥ 0`.

**Culling por frustum con esfera envolvente.** Los seis planos salen de sumar y
restar filas de la matriz view-projection: `x + w ≥ 0` es `(fila₀ + fila₃)·v ≥ 0`,
una desigualdad lineal, es decir un plano. Seis productos escalares por objeto
deciden sobre miles de triángulos. En esta escena descarta 1 objeto de 22, pero
es el peor de todos: la caja que orbita por detrás de la cámara, que sin descartar
atraviesa el plano cercano y genera triángulos recortados a pantalla completa.

**Orden de cerca a lejos.** Clave de orden `|c - ojo|²`, sin raíz: la raíz es
monótona y no cambia el orden. Inserción en vez de `sort` porque n es pequeño y
la lista llega casi ordenada del frame anterior. Medido: solo un 2,6 % de los
píxeles recorridos se rechazan por profundidad, porque esta escena tiene poca
oclusión — el beneficio aparece cuando hay complejidad en profundidad, y aquí es
sobre todo un seguro barato.

**Aritmética por píxel.** `Math.pow(x, n)` con exponente entero → exponenciación
por cuadrados (7 multiplicaciones para 128). Neblina `1-exp(-kd)` → racional
`kd/(1+kd)`: misma forma, una división en vez de una exponencial. Gamma `√v` ×3 →
una LUT de 1025 entradas, cuyo paso es menor que medio nivel de los 256 finales.
Por píxel sombreado desaparecen 1 `pow`, 1 `exp` y 3 `sqrt`.

**Dither ordenado de Bayer 4×4.** 256 niveles no bastan para el degradado de
neblina y aparecen bandas. Sumar ±0,47 niveles según `bayer[y&3][x&3]` antes de
redondear convierte el error de cuantización en ruido de alta frecuencia que el
ojo integra. Verificado leyendo el framebuffer: en una franja lisa los valores
alternan `128,127,128,127…`, es decir el nivel intermedio que el buffer no puede
representar. El índice usa la x de pantalla, no la del span, o el patrón
parpadearía al moverse la geometría.

**Antialiasing por discontinuidad de profundidad.** La vía obvia —normalizar la
función de arista por el módulo de su gradiente, `d = e/√(A²+B²)`, para obtener
cobertura parcial— produce costuras en todas las aristas *internas* de la malla:
dos triángulos adyacentes cubrirían medio píxel cada uno, cada uno mezclaría con
el fondo, y el fondo se asomaría por cada arista. La profundidad separa los dos
casos exactamente: continua dentro de una superficie, discontinua en una
silueta. Umbral relativo `|d₁-d₂|/max(d₁,d₂) > 0,02`, invariante a la escala de
la escena. Cuesta ~17 ms a 0,26 MP, por eso es opcional.

**Filtrado del tablero por huella de píxel.** Cuando la casilla proyectada baja
de un píxel no hay respuesta correcta: falta información, y muestrear da moiré.
Se mezcla hacia la media del patrón con `t = clamp(huella/ladoCasilla, 0, 1)`.
La primera versión usaba solo distancia y **midiéndola no hacía nada**: el
contraste del suelo lejano seguía igual. Falta el término de ángulo rasante — un
píxel visto oblicuo se estira sobre la superficie por `1/|N·V|` — que es
precisamente el que causa el moiré del suelo. Con él el contraste del tablero
cae hacia el horizonte (49 → 42 niveles en la franja medida, creciendo cuanto
más rasante). Es el problema del filtrado anisótropo de una GPU, resuelto con
una división.

**Resolución dinámica.** El coste va con el cuadrado de la escala, así que la
corrección lleva raíz: `escala ← escala·√(msObjetivo/msMedido)`. Con un factor
lineal el mando se pasa de largo y oscila; con la raíz converge en un paso. Banda
muerta y cuantizado a pasos de 0,05 para no reasignar el framebuffer por ruido.

**Suavizado con paso de tiempo correcto.** `alpha = 1 - exp(-dt/tau)` en lugar de
un factor fijo por frame. El factor fijo mide en frames: a 20 fps suaviza tres
veces más lento que a 60, justo cuando hace falta que responda.

**Rechazo trivial por triángulo contra los planos laterales.** Un vértice está
fuera por la derecha si `x > w`, en espacio de clip. Si los tres lo están, el
triángulo entero lo está —el interior de un triángulo es la envolvente convexa de
sus vértices y un semiespacio es convexo— y se descarta con 6 comparaciones,
antes de recortar, dividir por w y montar nada. Exige `w > 0` en los tres
vértices: con uno detrás de la cámara el signo de w se invierte, el semiespacio
deja de contener al triángulo proyectado y el rechazo tiraría geometría visible;
ese caso lo resuelve el recorte cercano. Medido: 0 rechazos con el encuadre por
defecto (nada cae *entero* fuera de un lado), 37 al acercar a FOV 16°, donde
además el frustum descarta 11 de 22 objetos.

**Limpieza del framebuffer en palabras de 32 bits.** Escribir el color de fondo
byte a byte son cuatro almacenamientos por píxel; empaquetando RGBA en un `Uint32`
y usando `fill` sobre una vista `Uint32Array` del mismo búfer es uno, en código
nativo. Micro-banco aislado a 640×400: **5,4 ms → por debajo de la resolución del
temporizador**. Hay que redondear cada canal al empaquetar, no truncar:
`Uint8ClampedArray` redondea al asignar, y truncar desplazaría el fondo un nivel
respecto al resto del motor.

**Contadores fuera del bucle interior.** `stats.pixelsTested += 1` sobre una
propiedad de un objeto del montón son dos accesos a memoria por píxel; en
variables locales viven en registros y se suman una vez por triángulo. Micro-banco
con 256.000 iteraciones: 0,7 → 0,5 ms.

Rechazadas tras analizarlas, con el motivo:

- **Vector de vista por triángulo** en vez de por píxel: ahorra una raíz y tres
  divisiones, pero el suelo son dos triángulos gigantes y le borraría el degradado
  especular entero.
- **Sombreado en espacio de vista** para eliminar los 3 varyings de posición en
  mundo: contando operaciones sale empate. Se ahorran 3 sumas y 3
  multiplicaciones de gradiente por píxel, pero reconstruir la posición desde las
  coordenadas de pantalla cuesta 3 multiplicaciones y 2 sumas. El ahorro real
  sería de memoria (stride 12 → 9) en una etapa que son 0,44 ms de 55.
- **Hi-Z jerárquico** (mínimo de profundidad por tile para descartar spans
  completos): con el 97,4 % de los píxeles recorridos pasando el test, no hay
  oclusión que explotar en esta escena. Mediría distinto en un interior.
- **Raíz inversa rápida** por Newton-Raphson: `Math.sqrt` compila a la
  instrucción hardware; la aproximación en JavaScript saldría más lenta.

## 4. Paralelismo por bandas

Las bandas horizontales particionan el espacio de pantalla, así que dos hilos
nunca escriben el mismo píxel ni necesitan ver el z-buffer del otro: paralelismo
sin bloqueos, sin comunicación y sin `SharedArrayBuffer` (que exigiría cabeceras
COOP/COEP). Los píxeles vuelven como `ArrayBuffer` transferido —cambio de
propietario, sin copia— y el búfer se recicla de vuelta al worker al frame
siguiente. Cada worker construye su propia copia de la escena y la anima con el
mismo `time`: la escena es función pura del tiempo, así que las copias coinciden
sin transmitir una sola matriz.

El `Framebuffer` gana `rowOffset` y `fullHeight`. La proyección sigue usando la
altura completa —la geometría no sabe nada de bandas— y solo el indexado de filas
resta el desplazamiento.

**Reparto adaptativo.** Bandas iguales reparten mal: el suelo ocupa la mitad
inferior y esa banda cuesta el doble, y el frame dura lo que la banda más lenta.
Con `t_i` el tiempo de la banda i y `h_i` sus filas, el coste por fila es
`c_i = t_i/h_i`, e igualar tiempos exige repartir en proporción inversa:

    h_i' = H · (1/c_i) / Σ(1/c_j)

amortiguado con `h_i ← h_i + λ(h_i' - h_i)`, λ = 0,35, porque la medida trae
ruido y sin amortiguar oscila. Funciona y se ve: con 4 hilos el reparto converge
a 214 · 44 · 57 · 85 filas —la banda del cielo se lleva cinco veces más filas que
las del suelo— con un equilibrio del 81 %; con 2 hilos, 270 · 130 y 89 %.

**Veredicto medido, y es negativo aquí.** En el panel del navegador
(`hardwareConcurrency` = 2):

| Configuración | Pared por frame (mínimo) |
|---|---|
| 1 hilo, sin cruzar el límite de hilo | 70,4 ms |
| 1 worker | 76,6 ms |
| 2 workers | 73,6 ms |
| 4 workers | 69,7 ms |

Un solo worker, con el mismo trabajo total, cuesta un 9-40 % más que hacerlo en
el hilo principal: el coste fijo de cruzar el límite de hilo (mensaje, copia de
la banda, `putImageData`) no se amortiza si el camino crítico no baja de verdad,
y con dos núcleos los workers y el hilo principal se pelean por los mismos dos.
Con 8 núcleos la cuenta se invierte —el coste fijo no crece y el camino crítico va
como 1/N— pero eso no lo he medido y no lo voy a afirmar.

Por eso el paralelo viene **desactivado** por debajo de 4 núcleos, activado por
encima, y siempre conmutable. Para medirlo en una máquina concreta:
`/soft.html?workers=8` y `await window.__softBenchParallel(8)`.

## 5. Rendimiento medido

Banco determinista (`?bench=N`): cámara fija, instante de animación congelado,
buffer 640×400, escena de 4.966 triángulos, un hilo. La métrica es el **mínimo**
de N frames: el navegador estrangula la pestaña cuando el panel no está visible y
la media queda dominada por ese ruido, mientras que el mínimo es estable
(tres tiradas consecutivas: 81,5 / 81,2 / 85,4 ms antes; 64,8 / 66,6 / 65,3
después).

| Métrica | Antes | Después |
|---|---|---|
| Frame (mínimo de 12, 640×400) | 81 ms | 51-65 ms |
| Iteraciones de píxel | 515.898 | 166.334 |
| Píxeles sombreados / recorridos | 0,32 | 0,97 |
| Divisiones de perspectiva | 161.982 | ~20.000 |
| `pow` + `exp` + `sqrt` por píxel | 1 + 1 + 3 | 0 + 0 + 0 |
| Etapa de vértices | 2,1 ms | 0,44 ms |

Los contadores son exactos y deterministas; los milisegundos, no. La misma
configuración medida en sesiones distintas del panel oculto varía ±25 %, así que
la ganancia real está en el rango 1,3-1,6× y la evidencia sólida son los
contadores. Las cifras absolutas son pesimistas: el mismo motor en una ventana
visible iba ~4× más rápido por píxel.

El coste sigue dominado por el sombreado, no por la geometría: la etapa de
vértices son 0,44 ms de 51. Con el shader barato (modo albedo) el frame baja a
~49 ms, o sea que el rasterizado puro y el volcado del framebuffer son el suelo
actual. Un rasterizador CPU está limitado por fill rate igual que una GPU, solo
que con tres órdenes de magnitud menos de paralelismo.

## 6. Espacio de trabajo para agentes

`src/soft/agent/` convierte el motor en un banco de creación 3D para un agente:
escena declarativa dentro, pliego de contactos PNG y diagnóstico JSON fuera.
Headless, sin GPU, sin navegador, sin servidor.

```bash
npm run agent3d -- --scene artifacts/agent/ejemplo-dron.json --out revision.png
```

Cuatro decisiones de diseño, cada una por un motivo concreto:

**La escena es JSON plano, no una API imperativa.** Un agente contra una API
inventa métodos que no existen y arrastra estado invisible entre llamadas.
Escribiendo datos no puede salirse del esquema, y el esquema entero cabe en una
pantalla: primitivas con parámetros, o `positions` e `indices` crudos —lo que
produce cualquier generador de geometría— con las normales calculadas si faltan.

**Seis vistas en una sola imagen.** Un agente paga un viaje de ida y vuelta por
cada imagen que mira. Seis peticiones cuestan seis turnos; un pliego cuesta uno y
además permite comparar entre vistas en la misma mirada. Cada vista está elegida
por lo que revela: 3/4 para la forma, tres ortográficas para proporción sin que la
perspectiva falsee medidas, normales para orientación de superficie, wireframe
para densidad de malla. El encuadre es automático, `d = r / sin(fov/2)`, así que el
agente nunca tiene que adivinar distancias de cámara.

**El diagnóstico es lo que la imagen no puede decir.** Una imagen no distingue
una malla cerrada de una con agujeros, ni una normal invertida de una superficie
en sombra. `auditMesh` mide topología con números exactos: aristas de borde,
aristas no manifold, triángulos degenerados, vértices sin soldar, desviación del
pivote, fracción de caras con normal contraria a sus vértices y error de simetría
en X. La topología se evalúa sobre posiciones soldadas, no sobre índices: un cubo
con normales duras tiene 24 vértices y 8 posiciones, y sin ese paso se reporta
agujereado.

**Los avisos son diagnósticos, no métricas.** «62 % de reversos visibles: el
bobinado está invertido» es accionable; `backfaceRatio: 0.62` no lo es. Y salida
con código 1 si hay avisos, para encadenarlo como verificación automática.

### Lo que encontró al primer uso

El auditor detectó un fallo real en el propio motor: `createSphere` generaba el
bobinado invertido, con la normal geométrica apuntando hacia dentro
(`dot(cross(B-A, C-A), normalSaliente) = -0.038` en el ecuador). Con el culling
activo eso descartaba el hemisferio cercano y dejaba ver el interior del lejano,
iluminado por normales que miran al lado opuesto de la luz: la esfera del demo
llevaba desde el principio viéndose plana y apagada, y en una revisión visual
pasaba por sombreado pobre. El aviso fue «94 % de caras con normal contraria a sus
vértices». Corregido en `mesh.ts`.

Usarlo también destapó dos defectos del propio auditor, ambos corregidos: contaba
dos veces la arista colapsada de los triángulos degenerados —lo que reportaba 64
aristas «no manifold» falsas en los polos de una esfera perfectamente cerrada— y
el encuadre lo calculaba incluyendo el suelo de referencia, que mide varias veces
el objeto y lo encogía hasta hacerlo irreconocible.

### Modelos reales: GLB y OBJ

```bash
npm run agent3d -- --model modelo.glb --select "rotor-*" --patch cambios.json --export salida.obj
```

Lectores propios, sin dependencias: `glbLoader.ts` (contenedor binario, accesores con
`byteStride`, jerarquía de nodos con matriz o TRS y cuaternión, atributos cuantizados)
y `objLoader.ts` (índices negativos, polígonos de más de tres lados, ternas
posición/UV/normal, grupos y materiales como piezas). GLB con extensiones
*requeridas* —meshopt, Draco— se rechaza con la orden concreta de conversión: leerlo
sin el decodificador produciría geometría basura.

Tres decisiones que son las que hacen rápida la iteración de un agente:

**La malla se queda en local y la transformación aparte.** Girar un rotor es tocar
16 números, no reescribir 1.584 posiciones.

**Selección por patrón, no por índice.** `rotor-*` sigue significando lo mismo tras
cualquier edición; «nodo 114» no. Un patrón que no coincide con nada devuelve
`matched: 0` con error explícito, porque el fallo silencioso es lo que hace que un
agente itere a ciegas.

**Resumen por familias.** El dron de prueba tiene 296 piezas con malla; colapsando
sufijos numéricos, letras sueltas y palabras de lado (`front-left`, `rear-right`)
quedan **45 familias**, que sí caben en una mirada. Sin eso el informe consume el
contexto antes de que el agente pueda razonar.

Verificado sobre `artifacts/export/drone.glb`: 296 piezas, 37.950 triángulos,
100.006 vértices, pliego completo en ~560 ms. Un parche de cuatro operaciones rotó
8 hélices, coloreó 7 piezas de cámara, ocultó 120 tuercas y reportó el error del
patrón inexistente. La exportación a OBJ y su relectura dan 176 piezas y 36.510
triángulos, exactamente el modelo menos las 120 piezas ocultas.

Hallazgo real del auditor sobre el modelo: `rotor-hub-*` tiene 64 aristas de borde en
las cuatro instancias, es decir no está cerrado.

### Un fallo de rendimiento que solo apareció con geometría real

El primer pliego del GLB tardó **10.293 ms**. La causa no era el volumen: eran cinco
llamadas a `subarray` por triángulo —tres al ensamblar y dos al recortar—, cada una
un objeto `TypedArray` nuevo. A 37.950 triángulos por 6 vistas son ~910.000
asignaciones por pliego, y el recolector de basura se llevaba el frame. Sustituidas
por copias explícitas de doce componentes: **795 ms, trece veces más rápido.**

Eso confirma de paso la hipótesis del plan (fase 1.1) sobre el suelo de 10,5 ms por
frame en la demo del navegador: con 4.966 triángulos eran ~20.000 asignaciones por
frame, y ese coste no depende de la resolución. Por eso bajar resolución no compraba
fluidez.

### Importar desde el navegador, y qué formato elegir

Los lectores no usan ninguna API de Node —solo `DataView`, `TextDecoder` y
aritmética—, así que el mismo código corre en el CLI y en `soft.html`. La demo acepta
un fichero por selector o soltándolo sobre el visor, encuadra la cámara a la caja
envolvente del modelo y ajusta los planos de recorte a su escala (un objeto en
milímetros con `near = 0,1` se recortaría entero).

Con un modelo cargado el modo paralelo se desactiva, y no es un descuido: cada worker
reconstruye la escena a partir del tiempo, que es una función pura, pero no tiene
forma de conocer un fichero que el usuario acaba de soltar. Enviarles la malla por
mensaje en cada frame costaría más de lo que el paralelismo ahorra.

**GLB es el formato de entrada recomendado**, medido sobre el mismo dron:

| | GLB | OBJ | GLB + meshopt |
|---|---|---|---|
| Tamaño | 2,17 MB | 10,0 MB (**4,6×**) | 0,33 MB (**6,5× menor**) |
| Descarga medida | 219 ms | 394 ms | — |
| Jerarquía y transformaciones | sí | no, todo aplanado a mundo | sí |
| Materiales | PBR | por `.mtl` aparte | PBR |
| Análisis | reinterpretar binario | parsear 328.000 líneas de texto | + descompresión |

El tamaño no es el argumento principal. El decisivo es la **jerarquía con
transformaciones**: es lo que permite que girar un rotor sea escribir una matriz de
16 números en vez de reescribir 1.584 posiciones, y sin eso la edición por piezas
—la razón de ser del banco de agentes— deja de tener sentido. OBJ aplana todo a
espacio de mundo por diseño.

OBJ se queda como **salida y vía de escape**: es legible, diffable, trivial de
escribir y lo abre cualquier herramienta antigua. Por eso la exportación es OBJ
mientras no exista la de GLB.

La carencia que más importa cerrar es **EXT_meshopt_compression**: el propio
`public/models/drone.glb` del repositorio lo requiere, y es lo que hace desplegable
un GLB —30 veces menor que el OBJ equivalente—. Son unos 25 kB de decodificador, la
primera dependencia externa que merecería la pena.

### Reparto de responsabilidades

Todo lo que decide algo está en TypeScript comprobado por el compilador
(`src/soft/agent/`); leer ficheros, codificar el PNG y escribir en consola vive en
`tools/agent3d.mjs`, sin tipos y sin dependencias. Así el motor no adquiere
`@types/node` y la parte con criterio corre igual en el navegador que en Node. El
codificador PNG son treinta líneas sobre `node:zlib`.

## 7. Hasta dónde llega y cómo escalaría

Implementado: perspectiva y ortográfica, FOV y plano cercano en vivo, recortado
homogéneo, profundidad invertida, culling de caras, por frustum y rechazo trivial
por triángulo, orden de cerca a lejos, span exacto con gradientes incrementales,
corrección de perspectiva por segmentos (con interruptor para ver el artefacto
afín), Blinn-Phong por píxel con exponenciación por cuadrados, neblina racional,
gamma por LUT, dither de Bayer, filtrado del tablero por huella con término
rasante, antialiasing de siluetas, limpieza en palabras de 32 bits, resolución
dinámica, paralelismo por bandas con reparto adaptativo, wireframe con Bresenham,
cuatro modos de depuración y dos bancos deterministas.

Con esto el motor está terminado como pieza cerrada: no queda nada a medias ni
ningún camino que dependa de código sin escribir. Lo que sigue son direcciones
nuevas, no deudas.

Por orden de retorno si hiciera falta más:

1. **SIMD por `Wasm`** con `v128`: cuatro píxeles por iteración en el bucle
   interior. Es la única vía que queda para bajar el coste por píxel de forma
   sustancial, y la que más trabajo cuesta.
2. **Medir el paralelo en una máquina con 8 núcleos** y, si confirma la escala
   1/N, eliminar la copia de la banda construyendo el `ImageData` del worker
   directamente sobre el búfer reciclado.
3. **Regla de relleno top-left.** La cobertura es inclusiva en las tres aristas:
   un píxel sobre una arista compartida se sombrea dos veces. Con geometría opaca
   y z-buffer no se nota; con transparencias sí.
4. **Rechazo jerárquico por bloques 8×8**, si el perfil llegara a mostrar que
   preparar filas vacías pesa (con spans exactos, hoy no pesa).
5. **Texturas reales con mipmaps** y filtrado trilineal; la procedural filtrada
   analíticamente cubre el caso actual.
6. **Pre-pase solo de profundidad** para escenas con mucha oclusión, donde el
   orden de cerca a lejos deja de bastar (aquí no: pasa el 97,4 %).
