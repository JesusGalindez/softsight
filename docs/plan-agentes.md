# Plan: mejores ojos y mejores manos para el agente

Estado: propuesta. Escrito el 2026-07-30 desde la experiencia de haber usado
`tools/agent3d.mjs` durante una sesión larga de trabajo real sobre el dron. Cada
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

### A1. Comparación de renders con atribución por pieza

La fricción: cada parche aplicado obligaba a mirar dos PNG y juzgar a ojo. Con renders
deterministas eso es medible.

```bash
npm run agent3d -- --model dron.glb --patch cambio.json --baseline anterior.png
```

```json
"diff": {
  "pixelesDistintos": 0.032,
  "porVista": { "3/4 iluminada": 0.081, "superior": 0.044, "frontal": 0 },
  "regiones": [{ "vista": "3/4 iluminada", "bbox": [120, 88, 210, 160],
                 "piezas": ["propeller-blade-front-left-a", "propeller-tip-front-left-a"] }]
}
```

**Cómo.** Hace falta un **decodificador PNG**, porque solo escribí el codificador:
firma, IHDR, `inflateSync` del IDAT y deshacer los filtros por fila (los cinco tipos:
None, Sub, Up, Average, Paeth). Son ~90 líneas sobre `node:zlib`, en
`tools/agent3d.mjs` con el codificador. Después, diferencia absoluta por píxel con
umbral —3 niveles de 255, para no reportar el dither—, recuento por tile, y unión de
cajas de los píxeles cambiados por región conexa aproximada.

La atribución a piezas sale gratis si A2 está hecho.

**Verificación.** Renderizar dos veces sin cambios debe dar `pixelesDistintos: 0`
exacto. Un cambio que se declara exacto y mueve píxeles es un bug — es el mismo
criterio que ya uso con los contadores deterministas, aplicado a la imagen.

**Coste**: ~150 líneas. **Riesgo**: bajo.

### A2. Caja en pantalla de cada pieza

La fricción: al ver algo raro en la imagen no había forma de saber **qué pieza** era,
ni de pedir "enséñame esa". Y sin esto, el diff de A1 dice *dónde* cambió pero no
*qué*.

```json
"partScreenBoxes": {
  "3/4 iluminada": { "rotor-hub-front-left": [148, 92, 176, 118], ... }
}
```

**Cómo.** Durante `renderContactSheet`, proyectar las ocho esquinas de la caja
envolvente en mundo de cada pieza con la cámara de esa vista y quedarse con el mínimo y
el máximo en pantalla. Ocho puntos por pieza y vista; con 296 piezas y 6 vistas son
14.208 proyecciones, del orden de un milisegundo. Es la caja, no la silueta: sirve para
atribuir y para señalar, no para medir cobertura.

**Verificación.** Que la caja de una pieza aislada con `--isolate` contenga todos sus
píxeles sombreados.

**Coste**: ~60 líneas en `agent/contactSheet.ts`.

### A3. Etiquetas quemadas en el pliego

La fricción: me equivoqué **varias veces** al correlacionar qué tile era cuál, con el
array `grid` delante. El agente mira la imagen sin contexto lateral.

**Cómo.** Tipografía de mapa de bits 5×7 para mayúsculas, dígitos y unos pocos signos:
cada glifo son 5 bytes, un byte por columna con 7 bits útiles. La tabla entera cabe en
una cadena hexadecimal de ~250 caracteres. Se dibuja tras componer el pliego, en la
esquina superior izquierda de cada tile, con un rectángulo de fondo semiopaco para que
se lea sobre cualquier color.

Conviene añadir en el mismo rótulo la escala de la vista —`3/4 · 320px · 1:2,4`— porque
la otra confusión recurrente fue comparar tamaños entre vistas con encuadres distintos.

**Coste**: ~110 líneas, nuevo `agent/bitmapFont.ts`. **Riesgo**: ninguno, es aditivo.

### A4. Huella del render

Un número por vista y uno del pliego, con FNV-1a de 32 bits sobre el búfer de color.

```json
"renderHash": { "sheet": "a3f19c04", "porVista": { "frontal": "7e21b8aa", ... } }
```

Comparar dos huellas cuesta cero y responde «¿cambió algo?» sin leer imágenes ni
guardarlas. Es el complemento barato de A1: la huella dice *si*, el diff dice *cuánto y
dónde*. Para CI, la huella sola basta como prueba de no-regresión.

**Coste**: ~25 líneas. Depende de F1 para ser comparable entre máquinas.

---

## Fase B — Que consultar sea barato

### B1. `--inspect-only`

La fricción: pedí la lista de familias del dron cuatro o cinco veces, y **cada una me
costó entre 500 y 900 ms de render que no miré**. Las consultas son la mayoría de las
llamadas.

Salta el pliego entero y devuelve solo el JSON: piezas, familias, auditoría, cajas.
Debería bajar de ~700 ms a ~150 ms, que es lo que cuesta leer y analizar el GLB.

**Coste**: trivial, un `if` en `reviewModel`. **Hacer primero**: es la mejor relación
valor/esfuerzo de todo el plan.

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

### B3. `--schema`

Imprime la forma aceptada de la escena, del parche y del informe. Hoy, un agente sin la
documentación delante tiene que adivinar el JSON o leerse `sceneSpec.ts`. Es lo que
permite que otro agente use la herramienta sin haberla escrito.

Que salga del código, no de una constante escrita a mano, o divergirá.

**Coste**: ~80 líneas.

---

## Fase C — Memoria entre llamadas

### C1. Avisos nuevos frente a preexistentes

La fricción: el aviso de `rotor-hub` sin cerrar reapareció en cada ejecución y hubo que
releer para saber si era nuevo.

```bash
--baseline-report informe-anterior.json
```

```json
"warningsDelta": { "nuevos": [...], "resueltos": [...], "persistentes": 4 }
```

Comparación por clave estable `pieza+tipo`, no por el texto del mensaje, que cambia con
las cifras. El agente solo necesita mirar `nuevos`.

**Coste**: ~70 líneas, exige dar a cada aviso un `code` estable —`BORDE_ABIERTO`,
`NORMAL_INVERTIDA`— además del texto.

### C2. Presupuestos como contrato

Hoy solo hay `budget.triangles`. Extender a `maxParts`, `maxBoundaryEdges`,
`requireWatertight`, `maxSymmetryError`, `maxDegenerate`, y exponerlos también por
línea de órdenes. Con eso el código de salida deja de ser informativo y pasa a ser una
puerta: el agente sabe si su cambio cumple el contrato sin interpretar el JSON.

**Coste**: ~60 líneas.

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

### D5. Semántica de unidades y escala absoluta

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

### F1. Reproducibilidad entre máquinas

El render es determinista **dentro de la misma versión del motor JS**, pero no está
garantizado entre motores: `Math.sin`, `Math.cos`, `Math.tan` y `Math.hypot` no están
especificados al último bit por el estándar; `+ - * / sqrt` sí.

Dos salidas, y hay que elegir una antes de vender la comparación de imágenes como
prueba de CI:

- **Fijar la versión de Node** en el proyecto y documentarlo. Es lo normal y cuesta
  nada.
- **Sustituir esas llamadas en el camino caliente** por aproximaciones polinómicas
  propias. Sale caro y solo compensa si hace falta comparar entre máquinas distintas.

Recomiendo la primera, con la segunda documentada como salida si algún día molesta.

---

## Orden recomendado

| # | Qué | Por qué ahí |
|---|---|---|
| 1 | **B1** `--inspect-only` | Media hora, y abarata la llamada más frecuente |
| 2 | **A3** etiquetas | Elimina un error recurrente, no toca el motor |
| 3 | **A2** cajas por pieza | Barato, y es requisito de A1 |
| 4 | **A1** diff de renders | El que convierte «creo» en «sé» |
| 5 | **A4** huella | Veinticinco líneas encima de A1 |
| 6 | **C1 + C2** avisos nuevos y presupuestos | Cierran el bucle de iteración |
| 7 | **D5** escala | Una división, atrapa el error más común |
| 8 | **B3** esquema | Lo que abre la herramienta a otros |
| 9 | **D1–D4** auditorías espaciales | El mayor valor, y el mayor trabajo |
| 10 | **E1–E3, B2, C3** | Comodidad y velocidad, ya con todo lo demás en pie |
| — | **F1** | Antes de prometer comparación de imágenes en CI |

Los cinco primeros son una sesión corta y ya cambian cómo se siente la herramienta: el
agente pasa de mirar imágenes a verificar cambios.

## Cómo verificar cada cosa

El mismo método que sostuvo todo el trabajo del rasterizador:

1. **Contadores deterministas** antes y después. Si un cambio se declara exacto, no
   deben moverse.
2. **Micro-banco aislado** para atribuir coste; el ruido del entorno es de ±25 % y se
   come cualquier mejora menor del 30 %.
3. **Casos construidos a propósito** para las auditorías nuevas: dos cajas solapadas,
   una pieza flotando, un duplicado exacto, un hermano fuera de escala. Una auditoría
   que no se ha probado con un fallo real no está probada.
