#!/usr/bin/env node
/**
 * CLI headless para agentes: escena o modelo dentro, pliego de contactos PNG y
 * un informe JSON fuera. Sin GPU, sin navegador, sin servidor.
 *
 *   npm run agent3d -- --model dron.glb --select "rotor-*" --out revision.png
 *   npm run agent3d -- --scene mi-objeto.json --out revision.png
 *   npm run agent3d                      (usa la escena de ejemplo)
 *   npm run agent3d -- --help            (todas las opciones)
 *
 * Este fichero es solo entrada/salida: argumentos, lectura del fichero,
 * codificación y descodificación PNG, y escritura. Todo lo que decide algo está
 * en `src/soft/agent/`, tipado y comprobado por el compilador.
 *
 * El código de salida es 1 si el informe trae avisos, para poder usarlo como
 * verificación automática sin interpretar el JSON. Un error de datos —fichero
 * ilegible, patrón sin coincidencias— sale con 2.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

import {
  DEMO_SCENE,
  PATCH_SCHEMA,
  SCENE_SCHEMA,
  applyPatch,
  computeSceneAabb,
  loadModel,
  reviewModel,
  reviewScene,
  serializeObj,
  toSceneNodes,
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

/**
 * PNG RGBA de 8 bits sin entrelazar, que es exactamente lo que escribe
 * `encodePng`. Deshacer un PNG es leer los bloques, concatenar los IDAT,
 * descomprimir e invertir el filtro de cada fila.
 *
 * Los cinco filtros predicen cada byte a partir del de la izquierda (`a`), el de
 * arriba (`b`) y el de la diagonal (`c`), y solo guardan el residuo; deshacerlos
 * es sumar la predicción, en orden, porque cada fila se apoya en la ya
 * reconstruida. Paeth elige entre los tres el que menos se desvía de `a+b-c`.
 *
 * No pretende leer cualquier PNG: entrelazado, paleta o 16 bits fallan con un
 * mensaje que lo dice. Un decodificador general aquí sería código sin uso.
 */
export function decodePng(buffer) {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (buffer[index] !== SIGNATURE[index]) throw new Error("el fichero no es un PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  const parts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;

    if (type === "IHDR") {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      const bitDepth = buffer[start + 8];
      const colorType = buffer[start + 9];
      const interlace = buffer[start + 12];
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(
          `solo se leen PNG RGBA de 8 bits sin entrelazar; este es ${bitDepth} bits, tipo de color ${colorType}, entrelazado ${interlace}`,
        );
      }
    } else if (type === "IDAT") {
      parts.push(buffer.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }

    offset = start + length + 4; // los cuatro últimos son el CRC
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = new Uint8ClampedArray(stride * height);

  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? pixels[target + index - 4] : 0;
      const up = row > 0 ? pixels[target - stride + index] : 0;
      const upLeft = row > 0 && index >= 4 ? pixels[target - stride + index - 4] : 0;
      const value = raw[source + index];
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = up;
      else if (filter === 3) prediction = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpLeft = Math.abs(estimate - upLeft);
        prediction =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft;
      } else if (filter !== 0) {
        throw new Error(`filtro de fila desconocido (${filter}) en la fila ${row}`);
      }
      pixels[target + index] = (value + prediction) & 0xff;
    }
  }

  return { pixels, width, height };
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
 * Presupuesto a partir de las banderas. Solo entran las que se pasaron: un límite
 * ausente no es un límite infinito, es una cláusula que no está en el contrato.
 */
function readBudget(options) {
  const budget = {};
  const number = (flag, field) => {
    const value = options.get(flag);
    if (value !== undefined && value !== "true") budget[field] = Number(value);
  };
  number("max-triangles", "triangles");
  number("max-parts", "parts");
  number("max-boundary-edges", "boundaryEdges");
  number("max-degenerate", "degenerateTriangles");
  number("max-symmetry-error", "symmetryError");
  if (options.get("require-watertight") === "true") budget.watertight = true;
  return Object.keys(budget).length > 0 ? budget : undefined;
}

/** Lo que da igual que la entrada sea un modelo o una escena. */
function commonOptions(options) {
  const expectSize = options.get("expect-size");
  return {
    tileSize: Number(options.get("tile") ?? 320),
    ground: options.get("ground") !== "false",
    inspectOnly: options.get("inspect-only") === "true",
    expectSize: expectSize !== undefined && expectSize !== "true" ? Number(expectSize) : undefined,
  };
}

/** Pliego anterior, ya descodificado. */
async function readBaselinePng(options) {
  const path = options.get("baseline");
  return path ? decodePng(await readFile(resolve(path))) : undefined;
}

/**
 * Informe anterior: de él salen los avisos con que comparar y el encuadre con que
 * se renderizó. Lo segundo es lo que permite comparar imágenes de una escena que se
 * está escribiendo desde cero, donde no hay «modelo antes del parche» al que
 * volver: la cámara se recupera del propio informe.
 *
 * Se exige el formato nuevo —avisos como objetos con `code`— porque comparar por
 * texto es justo lo que este campo viene a evitar.
 */
async function readBaselineReport(options) {
  const path = options.get("baseline-report");
  if (!path) return {};
  const previous = JSON.parse(await readFile(resolve(path), "utf8"));
  const warnings = previous.warnings ?? [];
  if (warnings.some((warning) => typeof warning === "string")) {
    throw new Error(
      `${path} trae los avisos como texto, de una versión anterior; vuelve a generarlo para poder comparar por clave`,
    );
  }
  return { warnings, frameAabb: previous.sheet?.frameAabb };
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

  const baseline = await readBaselinePng(options);
  const previous = await readBaselineReport(options);
  // Encuadre con que se hizo el pliego anterior; si no viene en el informe, el del
  // modelo **antes** del parche. Comparar exige que la cámara no se mueva, y la
  // cámara se ajusta a la caja envolvente.
  const frameAabb = previous.frameAabb ?? (baseline ? computeSceneAabb(toSceneNodes(model)) : undefined);

  let edits = null;
  const patchPath = options.get("patch");
  if (patchPath) {
    const patch = JSON.parse(await readFile(resolve(patchPath), "utf8"));
    edits = applyPatch(model, patch);
  }

  const select = options.get("select");
  const { sheet, review } = reviewModel(model, {
    ...commonOptions(options),
    budget: readBudget(options),
    baselineWarnings: previous.warnings,
    select: select ? select.split(",").map((pattern) => pattern.trim()) : [],
    isolate: options.get("isolate") === "true",
    auditLimit: Number(options.get("audit-limit") ?? 12),
    baseline,
    frameAabb,
  });

  if (sheet) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, encodePng(sheet.pixels, sheet.width, sheet.height));
  }

  let exported = null;
  const exportPath = options.get("export");
  if (exportPath) {
    exported = resolve(exportPath);
    mkdirSync(dirname(exported), { recursive: true });
    writeFileSync(exported, serializeObj(model), "utf8");
  }

  return { ...review, edits, file: sheet ? outputPath : null, exported };
}

/**
 * Ayuda por stdout. Existe porque un agente que no escribió la herramienta no
 * tiene forma de saber qué admite: hoy la única alternativa es leerse el código.
 * No sustituye a `--schema` —la forma del JSON de escena y de parche—, que es
 * otra cosa y está pendiente.
 */
const USAGE = `agent3d — revisión de modelos y escenas 3D, headless y determinista.

  npm run agent3d -- --model <fichero.glb|.obj> [opciones]
  npm run agent3d -- --scene <escena.json> [opciones]
  npm run agent3d                              usa la escena de ejemplo

Entrada
  --model <ruta>          modelo GLB u OBJ; manda sobre --scene
  --scene <ruta>          escena declarativa en JSON
  --patch <ruta>          parche a aplicar antes de renderizar (solo con --model)

Salida
  --out <ruta.png>        pliego de contactos; por defecto artifacts/agent/contact-sheet.png
  --export <ruta.obj>     exporta el modelo ya parcheado
  --inspect-only          solo el informe JSON, sin renderizar: ~4 veces más rápido

Selección y encuadre
  --select "a-*,b-*"      resalta las piezas que encajan; el encuadre las sigue
  --isolate true          dibuja solo lo seleccionado
  --audit-limit <n>       piezas seleccionadas a auditar en detalle (12)
  --tile <n>              lado del tile en píxeles (320)
  --ground false          sin plano de referencia

Verificación
  --baseline <ruta.png>   compara con un pliego anterior y añade "diff" al informe.
                          Fija el encuadre y la sombra al modelo previo al parche,
                          sin lo cual cualquier cambio desplaza el pliego entero.
  --baseline-report <j>   informe anterior; añade "warningsDelta" con lo nuevo,
                          lo resuelto y cuántos persisten, y hereda su encuadre
                          ("sheet.frameAabb") para que la comparación sea local

Todas estas opciones valen igual con --scene que con --model.

Escala
  --expect-size <m>       tamaño plausible del objeto en metros; sin esto solo se
                          avisa fuera del rango 1 cm - 100 m, suponiendo metros

Presupuesto (cada bandera es una cláusula; incumplirla es un aviso y salida 1)
  --max-triangles <n>     triángulos del modelo entero
  --max-parts <n>         número de piezas
  --require-watertight    todas las mallas cerradas
  --max-boundary-edges <n>  aristas de borde sumadas
  --max-degenerate <n>    triángulos de área nula sumados
  --max-symmetry-error <x>  error de simetría en X, en fracción del radio (0.02 = 2 %)

Otras
  --schema                forma aceptada de la escena y del parche, y un informe
                          de ejemplo, todo generado por el propio código
  --debug                 vuelca la pila en los errores
  --help                  esta ayuda

stdout es JSON puro. Código de salida: 0 sin avisos, 1 con avisos o parches
fallidos, 2 si hay un error de datos.`;

/**
 * Esquema de entrada y ejemplo de salida.
 *
 * Los dos salen del código: el esquema es el mismo objeto con que se valida la
 * entrada, y el ejemplo de informe se genera revisando la escena de demostración.
 * Escribir cualquiera de los dos a mano garantizaría que divergiesen.
 */
function printSchema() {
  const { review } = reviewScene(DEMO_SCENE, { inspectOnly: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        scene: SCENE_SCHEMA,
        patch: PATCH_SCHEMA,
        reportExample: review,
        notes: [
          "El esquema es el que valida la entrada: un campo que no esté aquí se rechaza.",
          "reportExample sale de revisar la escena de demostración con --inspect-only.",
          "Con pliego, el informe trae además sheet, views, renderHash y partScreenBoxes.",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.has("help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (options.has("schema")) {
    printSchema();
    return;
  }
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
  const previous = await readBaselineReport(options);

  const { sheet, review } = reviewScene(spec, {
    ...commonOptions(options),
    baseline: await readBaselinePng(options),
    frameAabb: previous.frameAabb,
    baselineWarnings: previous.warnings,
  });

  if (sheet) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, encodePng(sheet.pixels, sheet.width, sheet.height));
  }

  process.stdout.write(
    `${JSON.stringify({ ...review, file: sheet ? outputPath : null }, null, 2)}\n`,
  );
  process.exitCode = review.warnings.length > 0 ? 1 : 0;
}

// Solo se ejecuta si es el programa invocado, no si alguien lo importa: así el
// decodificador PNG se puede comprobar desde fuera sin que importarlo renderice.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Mensaje limpio, no volcado de pila: los errores de este CLI son de datos
    // —extensión no soportada, patrón sin coincidencias, fichero ilegible— y llevan
    // la corrección dentro. La pila solo estorba, y con `--debug` sigue disponible.
    const debug = process.argv.includes("--debug");
    const message = error instanceof Error ? (debug ? error.stack : error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  });
}
