/**
 * Puerta del reparto por bandas — el hueco (m) del §86.3.
 *
 * El plan de reconstrucción pedía una regla que no estaba escrita: **la
 * reducción va en orden fijo por índice de bloque, nunca sobre resultados según
 * llegan**. Sumar sobre millones de muestras según terminan los workers da un
 * resultado distinto en cada ejecución, y es el riesgo R9 del contrato.
 *
 * ## Qué se comprueba, y qué no
 *
 * Lo que hoy existe es el **reparto del rasterizado en franjas**: cada banda
 * posee sus filas y nadie escribe en las de otro (`Framebuffer` con `rowOffset` y
 * `fullHeight`). Esta puerta renderiza la misma escena partida en 1, 2, 3 y 4
 * bandas y exige **el mismo byte**. Si alguien hace que una banda dependa de otra
 * —un acumulador compartido, una reducción por orden de llegada— el píxel cambia
 * y esto se pone rojo.
 *
 * ## Lo que la puerta destapó al escribirla, medido
 *
 * **Con el suavizado encendido el reparto sí decide el píxel**, y solo en la
 * costura: partir 240×180 en dos bandas cambia **15 píxeles, todos en las filas
 * 89 y 90**, que es justo el límite. Sin suavizado las cuatro particiones dan
 * cero diferencias.
 *
 * El motivo es que la pasada de suavizado lee filas vecinas que la banda **no
 * posee**: en el borde de su franja no las tiene, así que suaviza contra el fondo.
 * Es una costura, no un error de reducción, y por eso esta puerta la **acota en
 * vez de taparla**: exige cero diferencias sin suavizado, y con él exige que
 * ninguna diferencia salga de las dos filas del límite. Bajar el listón a
 * «parecido» dejaría de detectar el fallo que la puerta busca; subirlo a «igual
 * siempre» exigiría que el suavizado pidiera una fila de cortesía al vecino, que
 * es un cambio del rasterizador y no de esta puerta.
 *
 * Queda anotado en `plan-reconstruccion.md` §86.3 (m).
 *
 * Lo que **no** existe todavía es una reducción en coma flotante: sumar
 * distancias de cobertura sobre millones de muestras. Cuando llegue, el sitio
 * donde tiene que fallar es éste, y por eso la puerta se escribe ahora y no
 * después: escribirla después es escribirla sobre el código que ya se equivocó.
 *
 * El reparto de bandas se comprueba **en serie**: no hace falta un worker para
 * probar que el resultado no depende del reparto, y montarlos aquí mediría el
 * planificador del sistema en vez del rasterizador.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  DEMO_SCENE,
  SoftwareRenderer,
  computeSceneAabb,
  modelFromScene,
  toSceneNodes,
} from "../dist-node/agent3d.mjs";

const WIDTH = 240;
const HEIGHT = 180;

const nodes = toSceneNodes(modelFromScene(DEMO_SCENE));
const aabb = computeSceneAabb(nodes);
const radius = Math.hypot(
  aabb.max[0] - aabb.min[0],
  aabb.max[1] - aabb.min[1],
  aabb.max[2] - aabb.min[2],
);
const center = [
  (aabb.min[0] + aabb.max[0]) / 2,
  (aabb.min[1] + aabb.max[1]) / 2,
  (aabb.min[2] + aabb.max[2]) / 2,
];
const camera = {
  position: [center[0] + radius, center[1] + radius * 0.6, center[2] + radius],
  target: center,
  up: [0, 1, 0],
  fovYDegrees: 45,
  near: radius / 100,
  far: radius * 10,
  projection: "perspective",
};
// Las mismas del pliego salvo las sombras: el mapa de sombras lo construye cada
// banda con la escena entera, así que apagarlas deja la comparación sobre lo que
// de verdad se reparte —el rasterizado— y no sobre trabajo duplicado.
const options = {
  shadingMode: "lit",
  wireframe: false,
  perspectiveCorrect: true,
  antialias: true,
  shadows: false,
  shadowSamples: 4,
  frustumCulling: true,
  cullMode: 1,
  light: { direction: [0.42, 0.76, 0.5], color: [1, 0.97, 0.92], intensity: 1.2 },
  ambient: [0.34, 0.37, 0.44],
  ambientGround: [0.16, 0.15, 0.14],
  fogColor: [0.08, 0.09, 0.12],
  fogDensity: 0,
  clearColor: [0.09, 0.1, 0.13],
};

/**
 * Reparte las filas en `bands` franjas y devuelve la imagen compuesta.
 *
 * Las franjas se componen **por índice**, que es la regla: el orden en que
 * terminen no puede decidir dónde van sus píxeles. Con una sola banda esto es el
 * render de siempre, así que el primer caso es también la línea base.
 */
function renderInBands(bands, antialias) {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const boundaries = [];
  for (let index = 0; index <= bands; index += 1) {
    boundaries.push(Math.round((index * HEIGHT) / bands));
  }
  const stats = [];
  for (let index = 0; index < bands; index += 1) {
    const rowOffset = boundaries[index];
    const bandHeight = boundaries[index + 1] - rowOffset;
    if (bandHeight === 0) continue;
    const renderer = new SoftwareRenderer(WIDTH, bandHeight, rowOffset, HEIGHT);
    stats.push(renderer.render(nodes, camera, { ...options, antialias }));
    pixels.set(renderer.framebuffer.color.subarray(0, WIDTH * bandHeight * 4), rowOffset * WIDTH * 4);
  }
  return { pixels, stats };
}

const hashes = new Map();
const rasterized = new Map();
for (const bands of [1, 2, 3, 4]) {
  const { pixels, stats } = renderInBands(bands, false);
  hashes.set(bands, createHash("sha256").update(Buffer.from(pixels.buffer)).digest("hex"));
  // La suma por índice, que es lo que hace `accumulate` en `parallel.ts`.
  rasterized.set(
    bands,
    stats.reduce((total, entry) => total + entry.trianglesRasterized, 0),
  );
}

const base = hashes.get(1);
for (const [bands, hash] of hashes) {
  assert.equal(hash, base, `con ${bands} bandas la imagen cambia: el reparto decide el píxel`);
}
// Y no es que salga negro: una imagen vacía también daría cuatro hashes iguales.
assert.notEqual(
  base,
  createHash("sha256")
    .update(Buffer.from(new Uint8ClampedArray(WIDTH * HEIGHT * 4).buffer))
    .digest("hex"),
  "la escena no se está dibujando y la puerta compara cuatro lienzos vacíos",
);
// `trianglesRasterized` **no** es invariante al reparto, y conviene que esté
// escrito: un triángulo que cruza una costura lo rasterizan las dos bandas, así
// que el contador cuenta envíos por banda y no triángulos de la escena. Quien lo
// reduzca sumando obtiene un número que crece con el número de bandas, y leerlo
// como «triángulos dibujados» es el error natural.
// Y **no crece con el número de bandas**: medido, 1 → 1576, 2 → 1675, 3 → 1788,
// 4 → 1675. Depende de dónde caigan las costuras respecto a la geometría, no de
// cuántas haya, así que ni siquiera sirve como cota. Lo único que se puede
// afirmar es que nunca baja: una costura duplica, no quita.
const baseTriangles = rasterized.get(1);
for (const [bands, total] of rasterized) {
  assert.ok(
    total >= baseTriangles,
    `con ${bands} bandas salen ${total} envíos y menos que con una (${baseTriangles}) sería perder geometría`,
  );
}
const mostSubmissions = Math.max(...rasterized.values());

console.log(
  `bandas: ok (1, 2, 3 y 4 franjas dan el mismo sha256 sobre ${WIDTH}×${HEIGHT}: ` +
    `el reparto no decide el píxel. Los envíos van de ${baseTriangles} a ${mostSubmissions}: un triángulo ` +
    `que cruza una costura lo rasterizan las dos bandas)`,
);

// Y el límite conocido, acotado en vez de tapado: con suavizado la costura sí
// cambia, y lo que la puerta exige es que **no salga de ella**.
{
  const entera = renderInBands(1, true).pixels;
  const partida = renderInBands(2, true).pixels;
  const seam = Math.round(HEIGHT / 2);
  const rows = new Set();
  let differing = 0;
  for (let index = 0; index < entera.length; index += 4) {
    if (
      entera[index] !== partida[index] ||
      entera[index + 1] !== partida[index + 1] ||
      entera[index + 2] !== partida[index + 2]
    ) {
      differing += 1;
      rows.add(Math.floor(index / 4 / WIDTH));
    }
  }
  const outside = [...rows].filter((row) => row !== seam - 1 && row !== seam);
  assert.deepEqual(
    outside,
    [],
    `el suavizado cambia filas fuera de la costura ${seam - 1}/${seam}: ${outside.join(", ")}`,
  );
  console.log(
    `bandas: ok (con suavizado la costura cambia ${differing} píxeles y ninguno sale de las filas ` +
      `${seam - 1} y ${seam}: la pasada lee filas que la banda no posee, y el límite queda acotado)`,
  );
}
console.log(
  "bandas: no ejecutada — la reducción en coma flotante que el §86.3 (m) teme, sumar distancias de " +
    "cobertura sobre millones de muestras, no existe todavía: la bloquea D34. Cuando llegue, el sitio " +
    "donde tiene que fallar es éste",
);
