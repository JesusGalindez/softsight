#!/usr/bin/env node
/**
 * Puerta del plan de cartel → títulos SDF.
 *
 * Qué se comprueba, y por qué:
 *
 *   1. **Normalización**: minúsculas y acentos llegan a la tabla 5×7 limpios
 *      (mayúsculas, diacríticos fundidos), y lo que la fuente no soporta se
 *      vuelve `?` con aviso — un hueco silencioso haría creer que el texto
 *      dice otra cosa.
 *   2. **Geometría**: `measureSdfText` cuadra con el layout real del motor
 *      (`(n·6−1)·scale` de ancho, `7·scale` de alto), y las anclas colocan la
 *      caja en el lado pedido.
 *   3. **Escala al caje**: `fit` baja la escala cuando el texto no cabe, sin
 *      pasarse del tamaño pedido.
 *   4. **Roles de color**: un rol de paleta y un hex producen el mismo RGB; un
 *      rol desconocido avisa y no rompe.
 *   5. **Integración**: `titles` (varios textos) se queman en el framebuffer
 *      del motor tras el postproceso, cada uno en su región — y `title` suelto
 *      sigue funcionando (compatibilidad).
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:text-plan`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSdfTitles,
  frameCamera,
  measureSdfText,
  modelFromScene,
  normalizeSdfCopy,
  resolveSdfColor,
  SoftwareRenderer,
  toSceneNodes,
} from "../dist-node/agent3d.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function hashPixels(pixels) {
  return createHash("sha256").update(pixels).digest("hex");
}

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

// --- 1. Normalización: mayúsculas, acentos fundidos, no soportados → "?" + aviso
{
  const clean = normalizeSdfCopy("Se mide en píxeles. Estación Nº4");
  assert.equal(clean.text, "SE MIDE EN PIXELES. ESTACION N?4");
  assert.equal(clean.warnings.length, 1);
  assert.match(clean.warnings[0], /º/);

  const broken = normalizeSdfCopy("ñandú ¶ OK");
  assert.equal(broken.text, "NANDU ? OK");
  assert.equal(broken.warnings.length, 1);
  assert.match(broken.warnings[0], /¶/);
}

// --- 2. Geometría: medidas y anclas
{
  const { width, height } = measureSdfText("HELLO", 2);
  assert.equal(width, (5 * 6 - 1) * 2);
  assert.equal(height, 7 * 2);

  const plan = {
    title: "HELLO",
    anchor: { x: 100, y: 40, side: "center" },
    scale: 2,
  };
  const { titles } = buildSdfTitles([plan]);
  assert.equal(titles[0].originX, 100 - width / 2, "el ancla central no centró");
  assert.equal(titles[0].originY, 40);
}

// --- 3. Escala al caje: baja la escala para caber, sin pasarse
{
  const tight = buildSdfTitles([
    { title: "ABCDEFGHIJ", anchor: { x: 0, y: 0 }, scale: 10, fit: { maxWidth: 100 } },
  ]).titles[0];
  const { width: wTight } = measureSdfText("ABCDEFGHIJ", tight.scale);
  assert.ok(wTight <= 100, `el texto sigue desbordando: ${wTight} > 100`);
  assert.ok(tight.scale < 10, "fit no bajó la escala");

  const roomy = buildSdfTitles([
    { title: "AB", anchor: { x: 0, y: 0 }, scale: 10, fit: { maxWidth: 1000 } },
  ]).titles[0];
  assert.equal(roomy.scale, 10, "fit redujo sin necesidad");
}

// --- 4. Roles de color: rol == hex, desconocido avisa
{
  const viaRole = buildSdfTitles([
    { title: "X", anchor: { x: 0, y: 0 }, scale: 1, color: "accent" },
  ]);
  const viaHex = buildSdfTitles([
    { title: "X", anchor: { x: 0, y: 0 }, scale: 1, color: "#C6FF3D" },
  ]);
  assert.deepEqual(viaRole.titles[0].color, viaHex.titles[0].color);

  const { rgb, warnings } = resolveSdfColor("violeta-inexistente");
  assert.deepEqual(rgb, [236, 239, 245]);
  assert.equal(warnings.length, 1);
}

// --- 5. Integración: varios títulos se queman en el framebuffer, cada uno en
// su región; el `title` suelto sigue funcionando
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
  const baseOptions = {
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
  };
  const render = (options) => {
    const renderer = new SoftwareRenderer(256, 256);
    renderer.render(nodes, camera, options);
    return renderer.framebuffer.color.slice();
  };

  const without = render(baseOptions);
  const kicker = { text: "F8", originX: 16, originY: 16, scale: 2 };
  const hero = { text: "TEST", originX: 96, originY: 48, scale: 2 };
  const withTitles = render({ ...baseOptions, titles: [kicker, hero] });
  assert.notEqual(hashPixels(withTitles), hashPixels(without), "los títulos no cambiaron el frame");

  // Cada título quema tinta en su región y nada en la esquina opuesta.
  assert.ok(countNear(withTitles, 256, 16, 16, 16 + 2 * 6 * 2, 16 + 7 * 2, [236, 239, 245], 60) >= 3, "kicker no se quemó");
  assert.ok(countNear(withTitles, 256, 96, 48, 96 + 4 * 6 * 2, 48 + 7 * 2, [236, 239, 245], 60) >= 3, "hero no se quemó");
  let differ = 0;
  for (let y = 220; y < 256; y += 1) {
    for (let x = 200; x < 256; x += 1) {
      const index = (y * 256 + x) * 4;
      if (
        without[index] !== withTitles[index] ||
        without[index + 1] !== withTitles[index + 1] ||
        without[index + 2] !== withTitles[index + 2]
      ) {
        differ += 1;
      }
    }
  }
  assert.equal(differ, 0, `los títulos cambiaron píxeles fuera de sus regiones (${differ})`);

  // Compatibilidad: `title` suelto sigue quemando el mismo rectángulo.
  const withLegacy = render({ ...baseOptions, title: kicker });
  const legacyDiff = (() => {
    let d = 0;
    for (let i = 0; i < without.length; i += 4) {
      if (
        without[i] !== withLegacy[i] ||
        without[i + 1] !== withLegacy[i + 1] ||
        without[i + 2] !== withLegacy[i + 2]
      ) {
        d += 1;
      }
    }
    return d;
  })();
  assert.ok(legacyDiff > 0, "title suelto dejó de quemar (compatibilidad rota)");
}

console.log("text-plan: ok (normalización, geometría, fit, roles, integración)");
