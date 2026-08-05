#!/usr/bin/env node
/**
 * El modo de comparación del pliego, y el descarte de caras en ortográfica.
 *
 * Las dos cosas nacieron para que otro rasterizador pudiera enfrentarse al
 * nuestro, y las dos se comprobaban **solo desde el otro repositorio**. Un
 * comportamiento cuya única prueba vive fuera de su propia suite es un
 * comportamiento sin prueba: aquí se cierra eso.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { modelFromScene, renderContactSheet, toSceneNodes } from "../dist-node/agent3d.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const escena = JSON.parse(
  readFileSync(join(projectRoot, "artifacts/agent/escena-paridad-planas.json"), "utf8"),
);
const nodes = toSceneNodes(modelFromScene(escena));
const TILE = 256;

const normal = renderContactSheet(nodes, TILE, undefined, undefined, nodes, undefined, false);
const paridad = renderContactSheet(nodes, TILE, undefined, undefined, nodes, undefined, true);

/** Píxeles encendidos de un tile, y su color de fondo. */
function tile(sheet, name) {
  const view = sheet.views.find((entry) => entry.name === name);
  const { pixels, width } = sheet;
  let lit = 0;
  const background = new Map();
  for (let y = 0; y < sheet.tileSize; y += 1) {
    for (let x = 0; x < sheet.tileSize; x += 1) {
      const index = ((view.row * sheet.tileSize + y) * width + view.column * sheet.tileSize + x) * 4;
      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
      background.set(key, (background.get(key) ?? 0) + 1);
      if (pixels[index] || pixels[index + 1] || pixels[index + 2]) lit += 1;
    }
  }
  const [dominant] = [...background.entries()].sort((a, b) => b[1] - a[1])[0];
  return { lit, dominant, view };
}

// --- 1. En comparación, el fondo es negro exacto y no hay rótulo
const comparacion = tile(paridad, "frontal");
assert.equal(comparacion.dominant, "0,0,0", "el fondo del modo de comparación no es negro exacto");

// El rótulo se quema arriba a la izquierda; ahí no puede haber nada encendido
// que no sea geometría, y en esta escena esa esquina está vacía.
let esquina = 0;
for (let y = 1; y < 10; y += 1) {
  for (let x = 1; x < 40; x += 1) {
    const view = comparacion.view;
    const index =
      ((view.row * paridad.tileSize + y) * paridad.width + view.column * paridad.tileSize + x) * 4;
    if (paridad.pixels[index] || paridad.pixels[index + 1] || paridad.pixels[index + 2]) esquina += 1;
  }
}
assert.equal(esquina, 0, "el modo de comparación sigue quemando el rótulo");

// --- 2. El pliego normal no cambia: sigue con su fondo y su rótulo
const revisión = tile(normal, "frontal");
assert.notEqual(revisión.dominant, "0,0,0", "el pliego normal ha perdido su fondo");
let rótulo = 0;
for (let y = 1; y < 10; y += 1) {
  for (let x = 1; x < 40; x += 1) {
    const view = revisión.view;
    const index =
      ((view.row * normal.tileSize + y) * normal.width + view.column * normal.tileSize + x) * 4;
    if (
      normal.pixels[index] !== 23 ||
      normal.pixels[index + 1] !== 26 ||
      normal.pixels[index + 2] !== 33
    ) {
      rótulo += 1;
    }
  }
}
assert.ok(rótulo > 0, "el pliego normal ha perdido el rótulo");

// --- 3. El suavizado está apagado: sin él, el tile solo tiene los colores de la
// geometría y el fondo, sin la orla de tonos intermedios que crea la pasada de
// vecindad sobre las discontinuidades de profundidad.
const tonos = (sheet, name) => {
  const view = sheet.views.find((entry) => entry.name === name);
  const distintos = new Set();
  for (let y = 0; y < sheet.tileSize; y += 1) {
    for (let x = 0; x < sheet.tileSize; x += 1) {
      const index = ((view.row * sheet.tileSize + y) * sheet.width + view.column * sheet.tileSize + x) * 4;
      distintos.add(`${sheet.pixels[index]},${sheet.pixels[index + 1]},${sheet.pixels[index + 2]}`);
    }
  }
  return distintos.size;
};
assert.ok(
  tonos(paridad, "frontal") < tonos(normal, "frontal"),
  "el modo de comparación no está reduciendo tonos: ¿sigue suavizando?",
);

console.log(
  `parity mode: ok (fondo negro, sin rótulo, ${tonos(paridad, "frontal")} tonos frente a ${tonos(normal, "frontal")})`,
);

// --- 4. Ortográfica: ninguna cara visible se descarta a incidencia rasante
//
// La vista superior mira casi a plomo (88°). Con el test de perspectiva, el
// descarte en espacio de objeto tiraba las caras laterales casi de canto de los
// objetos alejados del eje, y cada pieza salía pintada más pequeña que su propia
// caja proyectada. Para un sólido convexo esa caja **es** su silueta, así que la
// comparación es contra ella, pieza a pieza —contra la caja de toda la escena no
// valdría: entre las dos piezas hay hueco—.

import { reviewScene } from "../dist-node/agent3d.mjs";

const { review, sheet } = reviewScene(escena, { tileSize: TILE, ground: false, parity: true });
const superior = review.views.find((entry) => entry.name === "superior");
const faltantes = new Map();

for (const [nombre, cajaPliego] of Object.entries(review.partScreenBoxes["superior"])) {
  const caja = [
    cajaPliego[0] - superior.column * TILE,
    cajaPliego[1] - superior.row * TILE,
    cajaPliego[2] - superior.column * TILE,
    cajaPliego[3] - superior.row * TILE,
  ];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = Math.max(0, caja[1]); y <= Math.min(TILE - 1, caja[3]); y += 1) {
    for (let x = Math.max(0, caja[0]); x <= Math.min(TILE - 1, caja[2]); x += 1) {
      const index =
        ((superior.row * TILE + y) * sheet.width + superior.column * TILE + x) * 4;
      if (sheet.pixels[index] || sheet.pixels[index + 1] || sheet.pixels[index + 2]) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // La caja lleva un píxel de holgura por lado y el muestreo por centro no
  // enciende la punta de la silueta, así que un par de píxeles es normal.
  const abajo = caja[3] - maxY;
  assert.ok(
    minY - caja[1] <= 3 && abajo <= 3,
    `${nombre}: la vista superior pinta menos que su caja proyectada — ` +
      `arriba faltan ${minY - caja[1]} px y abajo ${abajo} px`,
  );
  faltantes.set(nombre, abajo);
}

// Y lo que de verdad delata el fallo: con el test de perspectiva lo que faltaba
// **crecía con la altura de la pieza** —cinco píxeles en la caja baja y siete en
// la alta—, porque cuanto más alta la cara lateral, más silueta se perdía al
// descartarla. Con el test correcto, las dos piezas fallan lo mismo.
const [bajaFalta, altaFalta] = [faltantes.get("caja-baja"), faltantes.get("caja-alta")];
assert.ok(
  Math.abs(bajaFalta - altaFalta) <= 1,
  `lo que falta depende de la altura de la pieza (${bajaFalta} px contra ${altaFalta} px): ` +
    `el descarte vuelve a tirar caras visibles a incidencia rasante`,
);

console.log("parity mode: ok (ortográfica sin caras visibles descartadas a incidencia rasante)");
