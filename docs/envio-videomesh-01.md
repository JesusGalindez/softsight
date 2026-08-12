# Envío 01 a VideoMesh — 2026-08-12

Disparado por §1.4 del contrato: SoftSight avisa cuando **mide la línea base de
`auditMesh`** y cuando **cambia cualquier esquema**. Han pasado las dos.

Este documento es la carta, no el contenido. Lo que rige sigue siendo
[`contrato-videomesh.md`](contrato-videomesh.md); aquí solo está qué mirar, en qué
orden, y **las dos cosas que necesitan vuestra respuesta**.

Commits: `6840970`, `0929852`, `dd2938e`, sobre `main` de
[`JesusGalindez/softsight`](https://github.com/JesusGalindez/softsight) (público).

---

## 1. Lo que necesita respuesta

### 1.1 Cuatro identificadores sin número

La ingesta necesitó cuatro códigos que el contrato **no asigna**. D2 nombra sus
motivos —`CONTRACT_SCHEMA_MISMATCH`, `PACKAGE_NOT_SEALED`— pero el número es lo
que vosotros parseáis, y eso no lo decide un lado solo.

```text
SS-PKG-010  el manifest no encaja con el esquema
SS-PKG-011  el paquete no está sellado
SS-PKG-012  el tamaño declarado no es el del fichero
SS-PKG-013  el contenido no coincide con el sha256 declarado
```

Están escritos como **propuestos** en `src/soft/agent/reconstruction/ingest.ts` y
en D2. **No los grabéis todavía en ninguna prueba vuestra.** Confirmadlos, o
cambiadlos: si los cambiáis, aquí cuesta una constante.

Los cuatro del sandbox (`SS-PKG-001..004`) sí los fija D6 y están tal cual.

### 1.2 Un campo del paquete que puede que os falte

`producer { name, version }` es **requerido** en el manifest. No sale de ninguna
decisión: lo puse porque el informe tiene que poder decir quién escribió el
paquete. Si vuestro escritor no lo emite hoy, decidlo y lo bajo a opcional antes
de que `cube-v1` choque contra ello.

---

## 2. La frontera, ya publicada

`contracts/*.schema.json`, generados de los esquemas que validan de verdad y
commiteados, como reparte D15. Nunca escritos a mano: hay una puerta que se pone
roja si el commiteado y el generado divergen.

```text
fichero                              sha256 (16)        bytes
scene.schema.json                    82477afe6d98e434   31641
patch.schema.json                    f3d574ed0581af39   23074
story.schema.json                    f90771f3d20e29de    1951
staging.schema.json                  2057546b2f5be99d    4148
sample-reference.schema.json         29bc83e9e7766b44     975
reconstruction-package.schema.json   b321f0fb966f2f91   14541
```

El sexto es el vuestro: `videomesh.reconstruction-package`. Es el **esqueleto de
R0-A**, no el contrato entero — identidad, sellado, artifacts, CameraSet, escala,
FrameGraph y `requiredEvidence`. Sin cobertura ni confianza: R0 se las prohíbe, y
el esquema las rechaza como campo desconocido.

Estos hashes **no son todavía los de D16**: son de los ficheros, para que sepáis
que miramos el mismo texto. El registro de compatibilidad por hash sigue sin
escribir.

### Fixtures

```text
fixtures/unknown-field-v1.json           5ec0eb310fae6438   D30, fila 1
fixtures/reconstruction-package-v1.json  ef8b9e44df8fa67a   D21, D20, D19, D14
fixtures/package-integrity-v1.json       909aa706f84dcdcd   D6, D7, D29, D13
```

`package-integrity-v1` absorbe `invalid-path-v1`, `hash-mismatch-v1` y
`unsealed-package-v1`: los tres preguntan lo mismo —qué paquetes entran— y
partirlos en tres ficheros era partir una tabla.

Los tres llevan casos que **deben aceptarse** además de los que deben rechazarse.
Sin ellos, un validador que rechace todo pasa la prueba.

---

## 3. D21: vuestra apuesta era correcta, y por poco

D21 daba por hecho que nuestro esquema en ejecución sabía expresar formas por tipo
de artifact. **No sabía.** `anyOf` se aplica al campo entero y no a cada elemento
de una lista, que es lo que son los artifacts.

Se disparó la condición de D15 —si el esquema no llega, se extiende el esquema— y
entró `variants`: discriminante **declarado**, no adivinado, y el literal se mira
antes que la forma, que es exactamente lo que pedía vuestra nota. Los cuatro casos
dan el mensaje que la decisión quería:

```text
TRIANGLE_MESH con true    válido
TRIANGLE_MESH con false   válido
TRIANGLE_MESH sin campo   falta artifacts[0].purelyReconstructed
POINT_CLOUD con campo     artifacts[0].purelyReconstructed no existe
```

Y uno que no habíamos escrito y hacía falta: un tipo inexistente enumera los que
hay, en vez de fallar por forma.

```text
type: "MESH"   →   no admite "MESH"; admitidos: TRIANGLE_MESH, POINT_CLOUD, IMAGE, DEPTH_MAP
```

**D6 y D21 pasan a IMPLEMENTADAS.** D7 y D29 se quedan a medias: a D7 le falta que
el informe publique los hashes, y a D29 todo lo que garantiza quien escribe
—rename atómico, mismo volumen, destino que ya existe—, que es prueba vuestra.

---

## 4. El número que este intercambio debía producir

D25, medido y publicado. Entorno: `darwin/x64`, Node v24.13.0, Intel i5-5350U
(2 físicos / 4 lógicos), 8 GiB de RAM, heap viejo por defecto 2240 MiB, 1 worker.

```text
5M triángulos      antes (dos Map)   después
CPU                11,41 s           0,93 s
RSS máximo         888,7 MiB         314,8 MiB
heap de V8         460,4 MiB           6,2 MiB
heap mínimo        entre 384 y        64 MiB o menos
para no reventar   416 MiB
```

Antes moría abortando en `OrderedHashMap`, que es la representación de `Map` en
V8. La soldadura es ahora una tabla de dispersión abierta en dos `Int32Array` y
las aristas se cuentan agrupando por conteo y prefijos.

**Para vosotros esto importa por una cosa:** `auditMesh` ya no es el techo de 5M,
así que la puerta de alto poligonaje no bloquea nada de `cube-v1`. La malla de
prueba la genera un script sin dependencias —cero bytes en git, D22— y el escalón
de 5M solo corre con `SOFTSIGHT_HEAVY=1`.

---

## 5. Dónde estamos, y qué esperamos de vosotros

```text
SoftSight   S1 S2 S3 S4 hechos      S5 cube-v1 local, en marcha
                                    S6 informe mínimo
VideoMesh   V1..V10                 sin noticias por este canal
```

Lo que desbloquea lo siguiente, por orden de lo que nos frena:

1. **Los cuatro códigos de §1.1**, que es lo único que os pedimos de verdad hoy.
2. **`allow_nan=False` y su prueba** (V1, V2): un `NaN` que llegue serializado ya
   es un paquete inválido que nadie puede rechazar bien desde este lado.
3. **Vuestro `cube-v1` y `expected.json`** (V3, V4), que es lo que convierte R0-A
   en R0-B.

R0-A lo cerramos solos, como dice D34: no os esperamos para eso.
