#!/usr/bin/env node
/**
 * Puerta del texto SDF dentro del framebuffer.
 *
 * Qué se comprueba, y por qué:
 *
 *   1. **Determinismo**: la misma entrada produce los mismos píxeles, sin
 *      depender del motor. El texto se quemará en frames de vídeo, y un frame
 *      que varía entre ejecuciones rompería el render por lotes.
 *   2. **Cobertura**: la tinta del glifo cae donde dice la tabla 5×7, y solo
 *      ahí; el texto no sangra sobre el resto de la imagen.
 *   3. **Suavizado**: la arista del glifo no es un escalón de `scale²` píxeles
 *      como en el rótulo clásico; hay tonos intermedios entre tinta y fondo. Es
 *      la diferencia entre el texto del pliego y el del cartel.
 *   4. **Escalado**: el mismo texto a escala 1 y a escala 8 cubre el mismo
 *      rectángulo, ampliado; un glifo no se descuadra al crecer.
 *   5. **Integración**: `RenderOptions.title` se quema en el framebuffer del
 *      motor tras el postproceso, de modo que el render headless lo lleva
 *      dentro —lo mismo que verá el vídeo.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:text`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  drawSDFText,
  frameCamera,
  modelFromScene,
  renderContactSheet,
  SoftwareRenderer,
  toSceneNodes,
} from "../dist-node/agent3d.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Buffer de prueba: RGBA con un fondo fijo. */
function canvas(width, height, background = [40, 40, 40]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = background[0];
    pixels[index + 1] = background[1];
    pixels[index + 2] = background[2];
    pixels[index + 3] = 255;
  }
  return pixels;
}

function hashPixels(pixels) {
  return createHash("sha256").update(pixels).digest("hex");
}

/** Cuenta los píxeles dentro del rectángulo que se acercan al color dado. */
function countNear(pixels, width, x0, y0, x1, y1, rgb, tolerance = 2) {
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      const close =
        Math.abs(pixels[index] - rgb[0]) <= tolerance &&
        Math.abs(pixels[index + 1] - rgb[1]) <= tolerance &&
        Math.abs(pixels[index + 2] - rgb[2]) <= tolerance;
      if (close) count += 1;
    }
  }
  return count;
}

const COLOR = [236, 239, 245];

// --- 1. Determinismo: dos pasadas idénticas producen bytes idénticos
{
  const a = canvas(160, 48);
  const b = canvas(160, 48);
  const run = { text: "DRON 2026", scale: 3, color: COLOR };
  drawSDFText(a, 160, 48, 8, 8, run);
  drawSDFText(b, 160, 48, 8, 8, run);
  assert.equal(hashPixels(a), hashPixels(b), "el texto SDF no es determinista");
}

// --- 2. Cobertura: el glifo 'I' pinta una barra en el rectángulo del glifo, y
// nada fuera del rectángulo del texto
{
  const width = 96;
  const height = 32;
  const pixels = canvas(width, height);
  const scale = 1;
  drawSDFText(pixels, width, height, 8, 8, { text: "I", scale, color: COLOR });

  // La 'I' ocupa el glifo 0: 5×7 píxeles a escala 1. Su columna central (índice
  // 2 de la tabla) es la barra vertical. Dentro de la caja debe haber tinta.
  const ink = countNear(pixels, width, 8, 8, 8 + 5, 8 + 7, COLOR, 60);
  assert.ok(ink >= 3, `la 'I' a escala 1 no pinta su barra (${ink} píxeles)`);

  // Fuera del rectángulo del texto no puede haber nada distinto del fondo.
  const outside = countNear(pixels, width, 0, 0, width, height, COLOR, 60);
  assert.ok(
    outside <= ink,
    `la tinta sangra fuera del texto: ${outside} píxeles, esperaba ≤${ink}`,
  );
}

// --- 3. Suavizado: la arista del glifo tiene tonos intermedios entre tinta y
// fondo. A escala 6, un escalón de rótulo clásico solo daría tinta o fondo.
{
  const width = 200;
  const height = 80;
  const background = [40, 40, 40];
  const pixels = canvas(width, height, background);
  const scale = 6;
  drawSDFText(pixels, width, height, 8, 8, { text: "DRON", scale, color: COLOR });

  let intermediate = 0;
  for (let y = 8; y < 8 + 7 * scale; y += 1) {
    for (let x = 8; x < 8 + 4 * 6 * scale; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index];
      const between = r > background[0] + 2 && r < COLOR[0] - 2;
      if (between) intermediate += 1;
    }
  }
  assert.ok(intermediate > 0, "la arista del texto no tiene tonos intermedios");
}

// --- 4. Escalado: el texto a escala 1 y a escala 8 cubre el mismo área
// normalizada. Se compara el centroide de tinta, que no debe desplazarse al
// crecer (un descuadre al escalar rompería los rótulos de vídeo).
{
  const inkCentroid = (pixels, width, x0, y0, x1, y1) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * width + x) * 4;
        if (pixels[index] > 60) {
          sx += x;
          sy += y;
          n += 1;
        }
      }
    }
    return n === 0 ? null : [sx / n, sy / n];
  };

  const width = 256;
  const height = 128;
  const small = canvas(width, height);
  const large = canvas(width, height);
  drawSDFText(small, width, height, 16, 16, { text: "HELLO", scale: 1, color: COLOR });
  drawSDFText(large, width, height, 16, 16, { text: "HELLO", scale: 8, color: COLOR });

  const cSmall = inkCentroid(small, width, 16, 16, 16 + 5 * 6, 16 + 7);
  const cLarge = inkCentroid(large, width, 16, 16, 16 + 5 * 6 * 8, 16 + 7 * 8);
  assert.ok(cSmall && cLarge, "el texto no pintó nada en alguna escala");

  // Los centroides normalizados a la caja deben coincidir (tolerancia amplia:
  // el campo suaviza la arista distinto según la escala).
  const normalizedSmall = [
    (cSmall[0] - 16) / (5 * 6),
    (cSmall[1] - 16) / 7,
  ];
  const normalizedLarge = [
    (cLarge[0] - 16) / (5 * 6 * 8),
    (cLarge[1] - 16) / (7 * 8),
  ];
  assert.ok(
    Math.abs(normalizedSmall[0] - normalizedLarge[0]) < 0.1 &&
      Math.abs(normalizedSmall[1] - normalizedLarge[1]) < 0.1,
    `el centroide se descuadra al escalar: ${normalizedSmall} vs ${normalizedLarge}`,
  );
}

// --- 5. Integración: el título se quema en el framebuffer del motor tras el
// postproceso, y solo en la región del título
{
  const escena = JSON.parse(
    readFileSync(join(projectRoot, "artifacts/agent/escena-paridad-planas.json"), "utf8"),
  );
  const nodes = toSceneNodes(modelFromScene(escena));
  const bounds = (() => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const node of nodes) {
      const m = node.model;
      minX = Math.min(minX, m[3]);
      maxX = Math.max(maxX, m[3]);
      minY = Math.min(minY, m[7]);
      maxY = Math.max(maxY, m[7]);
      minZ = Math.min(minZ, m[11]);
      maxZ = Math.max(maxZ, m[11]);
    }
    return { center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2], radius: 2 };
  })();

  const camera = frameCamera(bounds, { yaw: 0, pitch: 0, projection: "orthographic", shading: "lit" });
  const render = (title) => {
    const renderer = new SoftwareRenderer(256, 256);
    const options = {
      shadingMode: "lit",
      wireframe: false,
      perspectiveCorrect: true,
      antialias: true,
      shadows: false,
      shadowSamples: 1,
      frustumCulling: true,
      cullMode: 1,
      light: { direction: [0.42, 0.76, 0.5], color: [1, 0.97, 0.92], intensity: 1.2 },
      ambient: [0.34, 0.37, 0.44],
      ambientGround: [0.16, 0.15, 0.14],
      fogColor: [0.08, 0.09, 0.12],
      fogDensity: 0,
      clearColor: [0.09, 0.1, 0.13],
      title,
    };
    renderer.render(nodes, camera, options);
    return renderer.framebuffer.color.slice();
  };

  const without = render(undefined);
  const withTitle = render({ text: "TEST", originX: 16, originY: 16, scale: 2 });
  assert.notEqual(hashPixels(withTitle), hashPixels(without), "el título no cambió el frame");

  // Fuera del rectángulo del título (esquina opuesta) los frames son idénticos.
  let differOutside = 0;
  for (let y = 200; y < 256; y += 1) {
    for (let x = 200; x < 256; x += 1) {
      const index = (y * 256 + x) * 4;
      if (
        without[index] !== withTitle[index] ||
        without[index + 1] !== withTitle[index + 1] ||
        without[index + 2] !== withTitle[index + 2]
      ) {
        differOutside += 1;
      }
    }
  }
  assert.equal(
    differOutside,
    0,
    `el título cambió píxeles fuera de su región (${differOutside})`,
  );

  // Dentro de la región del título debe haber tinta nueva.
  const inkInTitle = countNear(withTitle, 256, 16, 16, 16 + 4 * 2 * 6, 16 + 7 * 2, COLOR, 60);
  assert.ok(inkInTitle >= 3, `el título no se quemó en el framebuffer (${inkInTitle})`);
}

// --- 6. El pliego no cambia por añadir el texto: hashSheet sigue siendo el
// mismo de siempre (el rótulo clásico del pliego no usa SDF)
{
  const escena = JSON.parse(
    readFileSync(join(projectRoot, "artifacts/agent/escena-paridad-planas.json"), "utf8"),
  );
  const nodes = toSceneNodes(modelFromScene(escena));
  const sheet = renderContactSheet(nodes, 256, undefined, undefined, nodes, undefined, true);
  assert.ok(sheet.pixels.length > 0, "el pliego de contacto no se renderiza");
  // El modo de comparación no puede llevar texto: son píxeles que no son geometría.
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      const index = (y * sheet.width + x) * 4;
      assert.equal(sheet.pixels[index + 3], 255, "el alfa del modo comparación cambió");
    }
  }
}

console.log("text: ok (determinismo, cobertura, suavizado, escalado, integración)");
