#!/usr/bin/env node
/**
 * CLI headless para agentes: escena JSON dentro, pliego de contactos PNG y
 * un informe JSON fuera. Sin GPU, sin navegador, sin servidor.
 *
 *   npm run agent3d -- --scene mi-objeto.json --out revision.png
 *   npm run agent3d                      (usa la escena de ejemplo)
 *
 * Este fichero es solo entrada/salida: argumentos, lectura del fichero,
 * codificación PNG y escritura. Todo lo que decide algo está en
 * `src/soft/agent/`, tipado y comprobado por el compilador.
 *
 * El código de salida es 1 si el informe trae avisos, para poder usarlo como
 * verificación automática sin interpretar el JSON.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import {
  DEMO_SCENE,
  applyPatch,
  loadModel,
  reviewModel,
  reviewScene,
  serializeObj,
} from "../dist-node/agent3d.mjs";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(data) {
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, payload) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(payload)]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, body, trailer]);
}

/**
 * PNG RGBA de 8 bits, sin entrelazado y con filtro 0 en todas las filas.
 *
 * Un PNG es firma + IHDR + IDAT + IEND, cada bloque con longitud, tipo, datos y
 * CRC-32; los datos son las filas precedidas por un byte de filtro y comprimidas
 * con zlib, que Node trae de serie. Treinta líneas y ninguna dependencia.
 */
function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // color: RGBA
  header[10] = 0; // compresión: deflate
  header[11] = 0; // filtro: adaptativo
  header[12] = 0; // entrelazado: ninguno

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function parseArguments(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    options.set(token.slice(2), next !== undefined && !next.startsWith("--") ? next : "true");
  }
  return options;
}

/**
 * Camino de modelo: cargar GLB/OBJ, seleccionar piezas por patrón, aplicar un
 * parche opcional, renderizar y exportar. El parche se aplica **antes** del render
 * para que el pliego muestre el resultado del cambio, que es el bucle que un
 * agente repite: editar, mirar, corregir.
 */
/**
 * Carga el decodificador de meshopt si está instalado. Dependencia **opcional**: sin
 * ella, un GLB comprimido falla con un mensaje que dice exactamente qué instalar, en
 * vez de producir geometría corrupta en silencio.
 */
async function loadMeshoptDecoder() {
  try {
    const { MeshoptDecoder } = await import("meshoptimizer");
    await MeshoptDecoder.ready;
    return MeshoptDecoder;
  } catch {
    return undefined;
  }
}

async function reviewModelFile(options, outputPath) {
  const modelPath = resolve(options.get("model"));
  const isBinary = modelPath.toLowerCase().endsWith(".glb");
  const raw = await readFile(modelPath);
  const data = isBinary
    ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    : raw.toString("utf8");

  const decoder = isBinary ? await loadMeshoptDecoder() : undefined;
  const model = loadModel(modelPath, data, decoder);

  let edits = null;
  const patchPath = options.get("patch");
  if (patchPath) {
    const patch = JSON.parse(await readFile(resolve(patchPath), "utf8"));
    edits = applyPatch(model, patch);
  }

  const select = options.get("select");
  const { sheet, review } = reviewModel(model, {
    tileSize: Number(options.get("tile") ?? 320),
    select: select ? select.split(",").map((pattern) => pattern.trim()) : [],
    isolate: options.get("isolate") === "true",
    auditLimit: Number(options.get("audit-limit") ?? 12),
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodePng(sheet.pixels, sheet.width, sheet.height));

  let exported = null;
  const exportPath = options.get("export");
  if (exportPath) {
    exported = resolve(exportPath);
    mkdirSync(dirname(exported), { recursive: true });
    writeFileSync(exported, serializeObj(model), "utf8");
  }

  return { ...review, edits, file: outputPath, exported };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = resolve(options.get("out") ?? "artifacts/agent/contact-sheet.png");

  if (options.has("model")) {
    const report = await reviewModelFile(options, outputPath);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const failedEdits = (report.edits ?? []).filter((edit) => edit.error);
    process.exitCode = report.warnings.length > 0 || failedEdits.length > 0 ? 1 : 0;
    return;
  }

  const scenePath = options.get("scene");
  const spec = scenePath ? JSON.parse(await readFile(resolve(scenePath), "utf8")) : DEMO_SCENE;

  const { sheet, review } = reviewScene(spec, {
    tileSize: Number(options.get("tile") ?? 320),
    ground: options.get("ground") !== "false",
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodePng(sheet.pixels, sheet.width, sheet.height));

  process.stdout.write(`${JSON.stringify({ ...review, file: outputPath }, null, 2)}\n`);
  process.exitCode = review.warnings.length > 0 ? 1 : 0;
}

main().catch((error) => {
  // Mensaje limpio, no volcado de pila: los errores de este CLI son de datos
  // —extensión no soportada, patrón sin coincidencias, fichero ilegible— y llevan
  // la corrección dentro. La pila solo estorba, y con `--debug` sigue disponible.
  const debug = process.argv.includes("--debug");
  const message = error instanceof Error ? (debug ? error.stack : error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
