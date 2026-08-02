# Plan: mejores ojos y mejores manos para el agente

Estado: en curso —hechos los seis primeros del orden recomendado (B1, A3, A2, A1, A4,
C1 y C2), además de F1 y la paridad del camino de escena (H1); el resto, propuesta. Escrito el 2026-07-30 desde la experiencia de haber
usado `tools/agent3d.mjs` durante una sesión larga de trabajo real sobre el dron. Cada
apartado nace de una fricción concreta que costó tiempo, no de una lista de deseos.

## Principio rector

Un agente no es un humano con prisa. Tres diferencias mandan sobre el diseño:

1. **Mira peor y cuenta mejor.** Ante dos imágenes casi iguales, un humano ve la
   diferencia y un agente no; ante dos números, al revés. Toda observación visual debe
   tener su contrapartida numérica.
2. **Paga por turno, no por milisegundo.** Una llamada que devuelve la mitad de lo que
   hace falta cuesta el doble que una que lo devuelve todo. Y una consulta barata usada
   diez veces vale más que una cara usada una.
3. **No recuerda entre llamadas.** Lo que no venga en la respuesta, no existe. Un
   informe sin memoria obliga a releer para saber si algo es nuevo.

De ahí sale el criterio para priorizar: **primero lo que convierte «creo que funcionó»
en «sé que funcionó»**, porque sin eso todo lo demás se itera a ciegas.

---

## Fase A — Ojos: que el agente pueda *verificar*, no solo mirar

### A1. Comparación de renders con atribución por pieza — hecho

La fricción: cada parche aplicado obligaba a mirar dos PNG y juzgar a ojo. Con renders
deterministas eso es medible.

```bash
npm run agent3d -- --model dron.glb --patch cambio.json --baseline anterior.png
```

```json
"diff": {
  "changedPixels": 0.000433,
  "byView": { "3/4 iluminada": 0.0004, "superior": 0.0005, "wireframe": 0.0001 },
  "regions": [{ "view": "frontal", "bbox": [368, 112, 400, 144], "changedPixels": 51,
                "parts": ["rotor-screw-front-left", "rotor-hub-front-left"] }]
}
```

**Cómo.** Decodificador PNG en `tools/agent3d.mjs`, junto al codificador: firma, IHDR,
`inflateSync` del IDAT y deshacer los cinco filtros por fila. La comparación y la
atribución viven en `agent/renderDiff.ts`, que no toca ficheros. Umbral de 3 niveles de
255 para no reportar el dither; regiones por celdas de 16 píxeles unidas entre vecinas,
**sin cruzar el borde de un tile**, porque una región a caballo entre dos vistas es una
caja sin sentido.

**Lo que costó de verdad no fue el diff, sino que el diff dijera algo.** Al probarlo con
un solo movimiento —subir un buje 6 cm— cambiaba el **3 % del pliego** y las regiones
salpicaban las cuatro esquinas del dron. Dos causas, las dos por ajustar al contenido:

1. **La cámara encuadra la caja envolvente.** Mover una pieza cambia la caja, mueve la
   cámara, y el pliego entero se desplaza un píxel: la comparación se llena de siluetas.
   Ahora, con `--baseline`, el encuadre se fija al del modelo **antes** del parche.
2. **El mapa de sombras ajusta su volumen a los emisores.** Lo mismo: se desplaza la
   rejilla de téxeles y cambian *todas* las sombras. Se fija al mismo volumen.

Con las dos cosas fijadas, el mismo cambio pasa de 3 % a **0,043 %** —setenta veces
menos— y todas las regiones caen donde tocan. El precio, dicho en el código: lo que el
parche saque fuera del volumen fijado no proyecta sombra.

**La atribución también hubo que rehacerla tres veces.** Por solape con la región
mandaban las piezas grandes —el fuselaje firmaba cualquier cambio—; por fracción de la
propia caja mandaban las diminutas —veintidós tornillos ocultos tapaban a la hélice que
se movió—; y sin colapsar familias esos mismos tornillos llenaban la lista. Queda:
fracción por cambio absoluto, una pieza por familia, seis por región.

**Verificación.** Dos renders sin cambios dan `changedPixels: 0` exacto. El
decodificador se comprueba aparte con un PNG fabricado con **un filtro distinto por
fila**, porque el codificador solo escribe el filtro 0 y los otros cuatro caminos no se
ejercitarían nunca: vuelve byte a byte, 0 de 9.028 distintos.

**Coste**: ~320 líneas entre el decodificador, `renderDiff.ts` y el fijado de encuadre.

### A2. Caja en pantalla de cada pieza — hecho

La fricción: al ver algo raro en la imagen no había forma de saber **qué pieza** era,
ni de pedir "enséñame esa". Y sin esto, el diff de A1 dice *dónde* cambió pero no
*qué*.

```json
"partScreenBoxes": {
  "3/4 iluminada": { "rotor-hub-front-left": [42, 87, 268, 265] }
}
```

**Cómo.** `projectAabbToTile` proyecta las ocho esquinas de la caja envolvente en mundo
con la cámara de esa vista y se queda con el mínimo y el máximo en pantalla. Es la caja,
no la silueta: sirve para atribuir y para señalar, no para medir cobertura.

Dos decisiones que no estaban en la propuesta:

- **Coordenadas del pliego, no del tile.** El agente tiene delante la imagen compuesta;
  obligarle a sumar el desplazamiento de la rejilla es pedirle una cuenta que puede
  fallar.
- **Solo las piezas auditadas**, no las 296. Las 296 por seis vistas son ~1.800 filas
  de JSON: gastaría más contexto del que ahorra. Con doce piezas son 6,3 KB de un
  informe de 28 KB, que ya es la mitad de lo que pesa la auditoría.

**Verificación.** Hecha con la pieza aislada, sin suelo, comparando la caja proyectada
con la caja de los píxeles que difieren del color de limpieza —enmascarando el
rectángulo exacto del rótulo—. Dieciocho comprobaciones sobre tres piezas: todas
contenidas.

Y una **medida que corrigió el código**: la hélice casi de canto en la vista frontal se
salía un píxel por arriba y otro por abajo. No es un error de proyección, es el
antialiasing, que es una pasada de vecindad 3×3 sobre las discontinuidades de
profundidad y tiñe un anillo por fuera de la arista geométrica. La caja lleva ahora un
píxel de holgura, y con eso la promesa «contiene todo lo pintado» es cierta.

**Coste**: ~90 líneas entre `agent/contactSheet.ts` y `agent/index.ts`.

### A3. Etiquetas quemadas en el pliego — hecho

La fricción: me equivoqué **varias veces** al correlacionar qué tile era cuál, con el
array `grid` delante. El agente mira la imagen sin contexto lateral.

**Cómo.** Tipografía de mapa de bits 5×7 para mayúsculas, dígitos y unos pocos signos:
cada glifo son 5 bytes, un byte por columna con 7 bits útiles. La tabla entera cabe en
una cadena hexadecimal, así que no hay fichero de fuente ni activo binario que
versionar. Se dibuja tras componer el pliego, en la esquina superior izquierda de cada
tile, con un rectángulo de fondo semiopaco para que se lea sobre cualquier color.

El rótulo lleva también la escala, que era la otra confusión recurrente: comparar
tamaños entre vistas con encuadres distintos. En vez de una razón —`1:2,4`, que exige
saber respecto a qué— va la **altura de mundo que abarca el tile**:
`3/4 ILUMINADA · 380PX · 18.3U`. Dos vistas con la misma cifra están a la misma escala,
sin más cuentas. La altura sale del volumen ortográfico o, en perspectiva, del plano
que pasa por el objetivo.

**Verificación.** Los contadores deterministas de las seis vistas no se mueven —el
rótulo se dibuja sobre el pliego ya compuesto, no sobre el fotograma—, y dos
ejecuciones seguidas dan el mismo PNG byte a byte. Con `--tile 120` el texto se recorta
por glifos enteros y no invade el tile vecino.

**Coste**: 160 líneas, nuevo `agent/bitmapFont.ts`.

### A4. Huella del render — hecho

Un número por vista y uno del pliego, con FNV-1a de 32 bits sobre el búfer de color.

```json
"renderHash": { "sheet": "5ed96496", "byView": { "frontal": "fcf027e7", "...": "..." } }
```

Comparar dos huellas cuesta cero y responde «¿cambió algo?» sin leer imágenes ni
guardarlas. Es el complemento barato de A1: la huella dice *si*, el diff dice *cuánto y
dónde*. Para CI, la huella sola basta como prueba de no-regresión.

Las dos no sobran una de la otra, y conviene tenerlo claro: la huella es **exacta** y el
diff tiene **umbral**. Un píxel de dither distinto cambia la huella y el diff sigue
diciendo cero. La huella detecta lo que sea; el diff dice si importa.

**Verificación.** Dos ejecuciones dan la misma huella. Tras un parche, cambia. Y —lo que
la hace útil en CI— es **reproducible desde el PNG por un tercero**: recalculada con una
implementación aparte, leyendo el fichero escrito, coinciden las seis vistas y el pliego.

**Coste**: 30 líneas y ~30 ms sobre 640 ms en el dron. Depende de F1 para ser comparable
entre máquinas.

---

## Fase B — Que consultar sea barato

### B1. `--inspect-only` — hecho

La fricción: pedí la lista de familias del dron cuatro o cinco veces, y **cada una me
costó entre 500 y 900 ms de render que no miré**. Las consultas son la mayoría de las
llamadas.

Salta el pliego entero y devuelve solo el JSON: piezas, familias, auditoría, cajas.
Medido sobre `drone.glb` (296 piezas, 2,1 MB), tres ejecuciones de cada: **590 ms de
media a 160 ms**. Lo que queda es leer y analizar el GLB, que es lo que ataca B2.

En el informe, `sheet` sale `null` y `views` vacío en vez de omitirse: un campo ausente
obliga a distinguir «no lo pedí» de «falló», y el nulo lo dice sin ambigüedad.

**Verificación.** Los dos informes, quitando `sheet`, `views` y `file`, son **idénticos
carácter a carácter**; el modo rápido no cambia ningún diagnóstico.

### B2. Caché del modelo analizado

Lo que queda tras B1 es el análisis: 2,1 MB de GLB, 296 piezas, 100.006 vértices en
cada llamada. En un bucle de diez parches son diez análisis idénticos.

**Cómo.** Serializar las piezas ya resueltas —posiciones, normales, UVs, índices,
matriz, nombre— a un único blob binario en `.cache/`, con clave `(ruta, mtime,
tamaño)`. Cargarlo es leer arrays tipados de una tirada, sin recorrer JSON ni
descomprimir.

**Verificación.** La revisión con caché y sin caché debe dar informes **idénticos**;
compararlos es un `diff` de JSON.

**Coste**: ~120 líneas. **Trampa**: invalidar mal la caché da resultados fantasma. La
clave debe incluir el tamaño además del mtime, y conviene un `--no-cache`.

### B3. `--schema` — hecho

Imprime la forma aceptada de la escena, del parche y del informe. Hoy, un agente sin la
documentación delante tiene que adivinar el JSON o leerse `sceneSpec.ts`. Es lo que
permite que otro agente use la herramienta sin haberla escrito.

Que salga del código, no de una constante escrita a mano, o divergirá.

**Cómo se cumple esa condición**, que era la parte difícil: el esquema de entrada no
es documentación, es **el objeto con el que se valida** la escena y el parche. Un campo
que alguien añada al resolutor sin declararlo aquí se rechaza, y el fallo sale a la
primera ejecución. Y el ejemplo de informe no está escrito: se genera revisando la
escena de demostración con `--inspect-only`.

Validar la entrada no estaba en el apartado, pero sin ello el esquema sería una segunda
copia de la verdad. Además arregla un modo de fallo silencioso que un agente sufre y no
ve: `positon` en vez de `position` se ignoraba, y el render salía mal sin decir por qué.
Ahora:

```
la escena no encaja con el esquema:
  - objects[0].geometri no existe; ¿querías decir geometry?
  - objects[0].positon no existe; ¿querías decir position?
```

Los errores salen **todos juntos**: devolverlos de uno en uno multiplica los turnos del
agente por el número de erratas.

**Verificación.** Las tres escenas del repositorio y el parche de ejemplo siguen
validando; una errata de una letra se caza con sugerencia; un tipo equivocado y una
operación inventada se rechazan nombrando lo admitido.

**Coste**: ~230 líneas, nuevo `agent/schema.ts`.

---

## Fase C — Memoria entre llamadas

### C1. Avisos nuevos frente a preexistentes — hecho

La fricción: el aviso de `rotor-hub` sin cerrar reapareció en cada ejecución y hubo que
releer para saber si era nuevo.

```bash
--baseline-report informe-anterior.json
```

```json
"warningsDelta": { "new": [], "resolved": [{ "code": "BORDE_ABIERTO", "part": "rotor-hub-front-left", "message": "..." }], "persistent": 3 }
```

Comparación por clave estable `code|part`, no por el texto del mensaje, que cambia con
las cifras. El agente solo necesita mirar `new`.

Esto **cambia la forma del informe**: `warnings` deja de ser una lista de textos y pasa
a serlo de objetos `{ code, part, message }`. Es una ruptura, y vale la pena: sin clave
estable no hay comparación posible, y el texto no puede serlo porque lleva las cifras
dentro. Los códigos van en español —`BORDE_ABIERTO`, `NORMAL_INVERTIDA`,
`PIVOTE_DESCENTRADO`— como los mensajes; las claves del JSON siguen en inglés como el
resto del informe.

Un informe anterior en el formato viejo no se compara en silencio: falla diciendo que
hay que volver a generarlo.

**Verificación.** Borrar una pieza con aviso y comparar contra el informe previo da
exactamente `resolved: [BORDE_ABIERTO rotor-hub-front-left]`, `new: []`,
`persistent: 3`.

**Coste**: ~90 líneas.

### C2. Presupuestos como contrato — hecho

Hoy solo hay `budget.triangles`. Extender a `maxParts`, `maxBoundaryEdges`,
`requireWatertight`, `maxSymmetryError`, `maxDegenerate`, y exponerlos también por
línea de órdenes. Con eso el código de salida deja de ser informativo y pasa a ser una
puerta: el agente sabe si su cambio cumple el contrato sin interpretar el JSON.

Están los seis, en el modelo (`--max-triangles`, `--max-parts`,
`--require-watertight`, `--max-boundary-edges`, `--max-degenerate`,
`--max-symmetry-error`) y en la escena (mismos campos dentro de `budget`). Cada
incumplimiento es un aviso con código propio, así que entra también en el delta de C1:
un contrato que se rompe aparece en `new`.

Una bandera ausente **no** es un límite infinito: es una cláusula que no está en el
contrato. Por eso el presupuesto se construye solo con lo que se pasó.

**Lo que costó decidir fue el precio.** Las cláusulas de topología no se pueden juzgar
con la auditoría de las piezas seleccionadas: hay que auditar las 296, y eso son 1,2 s
frente a los 0,16 s de una consulta. Se paga solo si se pide alguna de esas cláusulas;
`--max-triangles` y `--max-parts` siguen costando nada.

**Verificación.** Contrato holgado: cero avisos, salida 0. Contrato estrecho: avisos con
las cifras de ambos lados —`296 piezas, 100 presupuestadas`— y salida 1. Con
`--require-watertight`, el dron delata 32 piezas abiertas; con `--max-symmetry-error
0.02`, 16 piezas, la peor al 186 %.

**Coste**: ~140 líneas.

### C3. Parches componibles, ensayo y deshacer

- `--patch a.json --patch b.json` en orden.
- `--dry-run`: informa de coincidencias y errores sin renderizar ni escribir.
- `--undo salida.json`: emite el **parche inverso** —toda operación de transformación
  lo tiene, y `delete` guarda lo borrado—, para revertir sin recargar el original.

Es lo que convierte la exploración en barata: probar, mirar, deshacer.

**Coste**: ~130 líneas.

---

## Fase D — Auditorías espaciales: el hueco de información más grande

La auditoría actual mira cada malla **por separado**. Los errores reales de geometría
generada o ensamblada están **entre piezas**, y no se ven en una imagen ni los detecta
nada hoy.

### D1. Interpenetración

Solape de cajas envolventes en mundo, todos contra todos. Con 296 piezas son 43.660
pruebas: irrelevante. Se reporta el par y la **fracción de volumen solapado respecto a
la pieza menor**, que es lo que distingue un contacto legítimo de una pieza metida
dentro de otra.

Honestidad en el aviso: el solape de cajas es condición **necesaria y no suficiente**
para intersección real. Se reporta como candidato. Refinarlo con pruebas
triángulo-triángulo sobre los candidatos es posible y caro; queda como opción.

### D2. Piezas flotando

Para cada pieza, buscar la superficie más alta por debajo entre las piezas cuya caja se
solapa en XZ, y reportar la separación vertical.

> `rotor-front-left está 0,8 unidades por encima de arm-front-left, sin contacto`

Es el fallo más habitual de un ensamblaje generado, y ninguna vista lo revela salvo que
mires justo desde el lado correcto.

### D3. Duplicados en la misma posición

Misma malla y misma matriz dentro de un epsilon. No se ven —están exactamente
superpuestos— y doblan el coste de todo el pipeline. En un modelo generado por
acumulación de operaciones aparecen con facilidad.

### D4. Escala incoherente entre hermanos

Agrupar por prefijo de ruta jerárquica y reportar las piezas cuya diagonal de caja se
desvía más de un factor 10 de la mediana del grupo. Es lo que detecta un tornillo del
tamaño de un motor.

### D5. Semántica de unidades y escala absoluta — hecho

El informe da la caja en unidades del fichero, y un agente no sabe si son metros o
milímetros. glTF dice metros, así que un dron de 4,5 unidades **son 4,5 metros**, que
es absurdo para un cuadricóptero.

```bash
--expect-size 0.35   # tamaño plausible del objeto, en metros
```

> `la caja mide 4,5 m en su lado mayor; esperabas ~0,35 m. Factor 12,9: el modelo
> parece estar en otra unidad, o la escala del nodo raíz está mal.`

Sin `--expect-size`, avisar solo fuera de un rango muy amplio (1 cm – 100 m) y **decir
siempre la suposición**. Es el fallo número uno de la geometría generada por IA y se
detecta con una división.

Cuando el factor coincide con una conversión conocida —1000, 100, 39,37 o 3,28— el
aviso lo dice: «parece estar en milímetros» es accionable, «factor 1000» hay que
interpretarlo.

**La comprobación destapó un error en el propio informe.** El campo `size` no era la
caja: era el diámetro de la esfera envolvente repetido tres veces. El dron salía como
un cubo de 12,9 m de lado cuando mide 9,9 × 2,4 × 8,2. Sobre eso no se podía juzgar
ninguna escala, y además contradecía a su propia documentación —«tamaño en unidades del
fichero»—. Ahora es la extensión real de la caja, y las escenas también la traen.

**Verificación.** Cuatro casos construidos: caja de 350 unidades esperando 0,35 m
—factor 1000, «parece estar en milímetros»—; la misma sin `--expect-size` —fuera del
rango, con la suposición dicha—; una de 13,78 unidades esperando 0,35 —factor 39,4,
«pulgadas»—; y una de 0,35 m, que no dispara nada y sale con 0.

**Coste**: ~70 líneas.

**Coste de la fase D**: ~350 líneas en un nuevo `agent/spatialAudit.ts`. Es la fase más
larga y la de mayor valor absoluto. Merece su propio ciclo de verificación, con casos
construidos a propósito: dos cajas solapadas, una pieza flotando, un duplicado exacto.

---

## Fase E — Herramientas de cambio más rápidas

### E1. Selección por propiedad

`--select-where "triangles>1000"`, `"boundaryEdges>0"`, `"material=Vidrio"`. Hoy la
selección es solo por nombre o ruta. Para trabajo de optimización —«enséñame todo lo
que pase de mil triángulos»— el nombre no sirve.

### E2. Operaciones de parche que faltan

`align` (llevar una pieza a tocar otra, que es la corrección natural de D2),
`mirror` sobre un plano, `instance` (reemplazar geometría duplicada por referencias),
y `setPivot` (recentrar el origen sin mover la geometría, la corrección del aviso de
pivote descentrado).

Cada operación de auditoría debería tener su operación de arreglo. Un diagnóstico sin
acción correspondiente obliga al agente a improvisar.

### E3. Avisos con arreglo ejecutable

Que cada aviso lleve un campo `fix` con la orden o el fragmento de parche que lo
corrige, como ya hace el error de meshopt. Un agente actúa sobre eso directamente en
vez de deducirlo.

---

## Fase F — Determinismo, sin el cual A1 y A4 no valen en CI

### F1. Reproducibilidad entre máquinas — hecho

El render es determinista **dentro de la misma versión del motor JS**, pero no está
garantizado entre motores: `Math.sin`, `Math.cos`, `Math.tan` y `Math.hypot` no están
especificados al último bit por el estándar; `+ - * / sqrt` sí.

Dos salidas, y hay que elegir una antes de vender la comparación de imágenes como
prueba de CI:

- **Fijar la versión de Node** en el proyecto y documentarlo. Es lo normal y cuesta
  nada.
- **Sustituir esas llamadas en el camino caliente** por aproximaciones polinómicas
  propias. Sale caro y solo compensa si hace falta comparar entre máquinas distintas.

Tomada la primera: `.nvmrc` con `24.13.0` —V8 13.6— y `engines` en `package.json`
acotado a esa serie. La segunda queda documentada como salida si algún día molesta.

Conviene ser exacto sobre qué garantiza esto, porque es fácil prometer de más:

- **La huella de un PNG dado no depende del motor.** Es aritmética entera sobre bytes
  ya escritos: cualquiera puede recalcularla y le dará lo mismo.
- **Lo que puede variar entre motores es el PNG**, no la forma de resumirlo. Se fija la
  versión para que `renderHash` y `diff` comparen dos imágenes salidas del mismo
  aritmético.
- **No está medido que difieran.** No tengo dos motores a mano para provocarlo; es una
  precaución sobre lo que el estándar no garantiza, no un fallo observado.

---

## Orden recomendado

| # | Qué | Por qué ahí |
|---|---|---|
| 1 | ~~**B1** `--inspect-only`~~ **hecho** | Media hora, y abarata la llamada más frecuente |
| 2 | ~~**A3** etiquetas~~ **hecho** | Elimina un error recurrente, no toca el motor |
| 3 | ~~**A2** cajas por pieza~~ **hecho** | Barato, y es requisito de A1 |
| 4 | ~~**A1** diff de renders~~ **hecho** | El que convierte «creo» en «sé» |
| 5 | ~~**A4** huella~~ **hecho** | Veinticinco líneas encima de A1 |
| 6 | ~~**C1 + C2** avisos nuevos y presupuestos~~ **hecho** | Cierran el bucle de iteración |
| 7 | ~~**D5** escala~~ **hecho** | Una división, atrapa el error más común |
| 8 | ~~**B3** esquema~~ **hecho** | Lo que abre la herramienta a otros |
| 9 | **D1–D4** auditorías espaciales | El mayor valor, y el mayor trabajo |
| 10 | **E1–E3, B2, C3** | Comodidad y velocidad, ya con todo lo demás en pie |
| — | ~~**F1**~~ **hecho** | Antes de prometer comparación de imágenes en CI |

Los cinco primeros son una sesión corta y ya cambian cómo se siente la herramienta: el
agente pasa de mirar imágenes a verificar cambios.

## Fase G — Manipular el modelo: a mano y por agente, con el mismo lenguaje

El objetivo es poder mover piezas del modelo tanto desde la interfaz como desde un
agente. La clave del diseño es que **no sean dos caminos**: el formato de parches ya
es un lenguaje de manipulación completo —`translate`, `rotate`, `scale`, `color`,
`hide`, `delete`, `rename`—, así que la interfaz debe limitarse a **emitir parches**,
no a mutar el modelo por su cuenta.

Si los dos caminos comparten formato, sale gratis lo demás: el agente puede leer lo que
hizo la persona, la persona puede revisar lo que hizo el agente, y el historial de
cambios es un fichero que se guarda, se revisa y se aplica en otra máquina.

### G1. Selección por identificador de pieza — donde el rasterizador software gana

Para saber qué pieza hay bajo el cursor, una aplicación de GPU normalmente lanza un rayo
contra la geometría y resuelve intersecciones. Aquí no hace falta: el rasterizador ya
recorre cada píxel y ya sabe qué nodo está dibujando.

Basta con un **búfer de identificadores** paralelo al de profundidad: un `Int32Array`
donde, en el mismo sitio donde se escribe la profundidad, se escribe el índice de la
pieza. Una escritura entera más por píxel sombreado. Después, un clic es leer un entero
de un array — selección **exacta**, sin tolerancias ni falsos positivos en siluetas
finas, y a coste prácticamente nulo.

Es un caso donde rasterizar por software es una ventaja y no una limitación.

### G2. Interacción manual que produce parches

Con la pieza seleccionada, la interfaz muestra su nombre y su auditoría, y ofrece
desplazamiento y giro. Empezar por **teclas** —flechas para desplazar, `R` más eje para
girar, con paso ajustable— antes que por manipuladores arrastrables: es una décima parte
del trabajo y cubre la mayoría de las correcciones reales, que son ajustes pequeños.

Cada acción **acumula una operación en una pila de parches**, no modifica el modelo
directamente. De ahí salen tres cosas sin esfuerzo adicional: deshacer y rehacer,
exportar lo hecho como fichero de parche, y que un agente continúe donde lo dejó la
persona.

### G3. Ciclo compartido

- La interfaz exporta su pila con **«guardar parche»**.
- El CLI la aplica con `--patch`, la audita y la vuelve a renderizar.
- El agente escribe su propio parche y la interfaz lo carga para revisarlo a ojo.

Depende de C3 (parches componibles, ensayo y deshacer), que ya está en este plan. G1 es
requisito de G2, y no depende de nada más.

## Fase H — crear un objeto desde cero, no solo revisar el de otro

Todo lo anterior nació de editar un GLB que ya existía. Pero la escena declarativa
—primitivas más mallas crudas en arrays— ya permite **inventar** geometría sin fichero
de partida, y ese camino tenía peores herramientas que el de edición, que es justo al
revés de lo que conviene: quien crea se equivoca más.

Comprobado escribiendo una torre a mano —cuatro primitivas y una pirámide de cinco
vértices—: la auditoría cazó la pirámide abierta (`BORDE_ABIERTO`, 4 aristas) y el
contrato `watertight` la rechazó. Cerrada la base, informe limpio.

### H1. Paridad del camino de escena — hecho

`--inspect-only`, `--baseline`, `--baseline-report`, `partScreenBoxes`, `renderHash` y
`diff` funcionan ya igual con `--scene` que con `--model`. Consultar una escena baja de
650 ms a 130 ms, y comparar dos versiones de lo que se está escribiendo da regiones y
piezas responsables, como con un modelo.

**El encuadre se hereda del informe anterior.** En el camino de modelo bastaba con
guardar la caja envolvente de antes del parche, pero quien escribe una escena desde cero
no tiene «antes»: solo el JSON nuevo. Por eso el informe publica ahora
`sheet.frameAabb`, y `--baseline-report` la reutiliza. Medido subiendo la cubierta de la
torre: **12,2 % del pliego cambiado sin heredar el encuadre, 8,2 % heredándolo**, y con
la pieza que de verdad se movió —`cubierta`— la primera de la lista en vez de la cuarta.

### H2. Lo que falta para que crear sea cómodo

- **No hay operación `add`.** Los parches mueven, giran, escalan, ocultan, borran y
  renombran lo que ya existe; no añaden geometría. Sin eso, crear es reemitir el JSON
  entero en cada turno, que es exactamente lo que el formato de parches evita al editar.
- **Los parches no se aplican a escenas**, solo a modelos. Con `add` y esto, C3
  —componer, ensayar, deshacer— sirve igual para crear.
- **El vocabulario son cuatro primitivas** —caja, esfera, toro, plano— y arrays crudos.
  Faltan cilindro y cono para empezar, extrusión de polígono y revolucionado después.
  Booleanas quedan lejos y probablemente no compensen.
- **Solo se exporta OBJ**, que pierde color, material y jerarquía.

### H3. Dos defectos que salieron al probarlo

- **Una malla del revés no se detecta.** La primera pirámide tenía las caras bobinadas
  hacia dentro: renderizaba oscura y ninguna comprobación saltó, porque las normales
  eran coherentes *entre sí*. Se caza con el volumen firmado de una malla cerrada:
  negativo significa invertida. Encaja con las auditorías espaciales de la fase D.
- **`createSphere` emite 64 triángulos de área nula** en los polos, así que cualquier
  escena con una esfera arrastra un aviso que no es culpa de quien la escribió.

## Cabos sueltos de infraestructura

No son del motor ni del banco de agentes, pero no están anotados en ningún otro sitio
y se olvidan con facilidad.

**Publicación del repositorio.** Falta poner en GitHub la **descripción** y los
**temas**. Sin temas, el proyecto no aparece en las búsquedas de la plataforma, que es
la mitad de la razón de haberlo publicado. La descripción está en `package.json`, y los
temas sugeridos son `software-rendering`, `rasterizer`, `ai-agents`, `no-gpu`, `gltf`,
`typescript`, `headless`, `deterministic`.

**Repositorio padre huérfano.** `Documents/Dron` es todavía un repositorio git con un
commit antiguo en el que todo el proyecto colgaba de un subdirectorio con espacios en
el nombre. Se creó antes de decidir que softsight iría en su propio repositorio con el
contenido en la raíz. Sobra: o se borra su `.git`, o se reconvierte en el repositorio
privado del dron —el visor Three.js, `img2threejs` y el material de referencia siguen
ahí, fuera del historial público.

**Empuje con activos binarios.** El primer `git push` falló con **HTTP 400** porque el
búfer de POST por defecto es de 1 MB y los GLB del espécimen suman 2,5. Ya quedó
resuelto en la configuración local del repositorio:

```
http.postBuffer = 524288000
http.version = HTTP/1.1
```

Queda anotado porque esa configuración **no viaja con el clon**: quien clone el
repositorio y añada activos binarios grandes se encontrará el mismo error, y el mensaje
de git no sugiere la causa.

## Cómo verificar cada cosa

El mismo método que sostuvo todo el trabajo del rasterizador:

1. **Contadores deterministas** antes y después. Si un cambio se declara exacto, no
   deben moverse.
2. **Micro-banco aislado** para atribuir coste; el ruido del entorno es de ±25 % y se
   come cualquier mejora menor del 30 %.
3. **Casos construidos a propósito** para las auditorías nuevas: dos cajas solapadas,
   una pieza flotando, un duplicado exacto, un hermano fuera de escala. Una auditoría
   que no se ha probado con un fallo real no está probada.
