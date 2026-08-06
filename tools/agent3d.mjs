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

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadModelCached } from "./modelCache.mjs";
import { deflateSync, inflateSync } from "node:zlib";

import {
  DEMO_SCENE,
  PATCH_SCHEMA,
  ROLE_REQUIRED_DATA,
  SAMPLE_REFERENCE_SCHEMA,
  SCENE_SCHEMA,
  STAGING_SCHEMA,
  STORY_SCHEMA,
  applyPatch,
  applyPatchToScene,
  assertValid,
  auditAnimation,
  auditStaging,
  auditStory,
  bindModelToSkeleton,
  bvhToSkinnedScene,
  invertPatch,
  modelFromScene,
  computeSceneAabb,
  loadModel,
  reviewModel,
  parseBvh,
  resolveRig,
  serializeGlb,
  serializeSkinnedGlb,
  skeletonFromParsedGlb,
  reviewScene,
  serializeObj,
  toSceneNodes,
  inspectGlbAnimation,
  hashSamplesAtFrames,
  parseGlbAnimation,
  validateSampleReference,
} from "../dist-node/agent3d.mjs";

/**
 * Versión del contrato del informe. Cada cambio de forma que rompe a los
 * consumidores —como los warnings de `string[]` a `{ code, part, message }`—
 * la sube: quien lee el informe compara contra esta cifra antes que contra los
 * campos, y un informe de 4925240 se distingue de uno de hoy sin mirar nada más.
 *
 * La 3 llega por un cambio de píxeles, no de forma: el descarte de caras en
 * proyección ortográfica usaba el test de perspectiva y tiraba caras visibles a
 * incidencia rasante, así que los `renderHash` de las vistas ortográficas se
 * mueven. La política del proyecto es explícita —cambiar la aritmética o el
 * hash obliga a subir la versión— para que el consumidor falle en la puerta en
 * vez de comparar contra un hash que ya no significa lo mismo.
 */
const REPORT_CONTRACT_VERSION = 3;

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

/**
 * Argumentos. `get` devuelve el último valor de cada bandera y `all` todos, porque
 * `--patch a.json --patch b.json` es una pila de cambios en orden y quedarse con el
 * último los perdería en silencio.
 */
function parseArguments(argv) {
  const options = new Map();
  const repeated = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const flag = token.slice(2);
    const next = argv[index + 1];
    const value = next !== undefined && !next.startsWith("--") ? next : "true";
    options.set(flag, value);
    repeated.set(flag, [...(repeated.get(flag) ?? []), value]);
  }
  options.all = (flag) => repeated.get(flag) ?? [];
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
    // Render para comparar con otro rasterizador, no para mirarlo: sin suavizado,
    // sin sombras, sin rótulo y sobre negro.
    parity: options.get("parity") === "true" || options.has("parity"),
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
  // `data` es el ArrayBuffer (GLB) o el texto (OBJ). Se lee a nivel de función —
  // no dentro de la closure de la caché— para que el contrato de animación lo
  // tenga disponible aunque el modelo salga de `.cache/` y la closure no corra.
  const raw = await readFile(modelPath);
  const data = isBinary
    ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    : raw.toString("utf8");
  const decoder = isBinary ? await loadMeshoptDecoder() : undefined;
  const { model, cached } = await loadModelCached(
    modelPath,
    async () => loadModel(modelPath, data, decoder),
    { enabled: options.get("no-cache") !== "true" },
  );

  // Pose de control para el contrato determinista de animación GLB: referencia de
  // fotogramas y huellas SHA-256 esperadas, que la herramienta certifica sin
  // depender del renderer de turno. Solo con modelos binarios.
  const controlPosePath = options.get("control-poses");
  const controlPoseReference = controlPosePath
    ? parseControlPoseReference(JSON.parse(await readFile(resolve(controlPosePath), "utf8")))
    : null;

  // Muestras de superficie para el contrato de Fase C: referencias de triángulos
  // evaluadas en unos fotogramas, con huella por frame. Repetible, como las poses
  // de control; el `sample-gate` del editor evalúa las mismas referencias con el
  // renderer y compara las huellas.
  let sample = null;
  const samplePath = options.get("sample");
  if (samplePath) {
    if (!isBinary) throw new Error("--sample solo vale con --model .glb (referencias a mallas animadas)");
    const framesFlag = options.get("frames");
    if (!framesFlag || framesFlag === "true") {
      throw new Error("--sample necesita --frames con los fotogramas, p. ej. \"0,15,30,37\"");
    }
    const frames = framesFlag.split(",").map((entry) => {
      const frame = Number(entry.trim());
      if (!Number.isInteger(frame) || frame < 0) {
        throw new Error(`fotograma '${entry.trim()}' inválido; deben ser enteros no negativos separados por comas`);
      }
      return frame;
    });
    const fpsFlag = options.get("fps");
    const fps = fpsFlag === undefined || fpsFlag === "true" ? 30 : Number(fpsFlag);
    if (!Number.isInteger(fps) || fps <= 0) throw new Error(`fps inválido: ${fps}`);
    const references = JSON.parse(await readFile(resolve(samplePath), "utf8"));
    if (!Array.isArray(references) || references.length === 0) {
      throw new Error("--sample: el fichero de referencias debe ser una lista no vacía");
    }
    references.forEach((reference, index) =>
      assertValid(reference, SAMPLE_REFERENCE_SCHEMA, `referencia ${index}`),
    );
    const parsed = parseGlbAnimation(data, decoder);
    references.forEach((reference, index) => {
      try {
        validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, reference);
      } catch (error) {
        throw new Error(`referencia ${index} inválida: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    sample = {
      references: references.length,
      frames: await hashSamplesAtFrames(
        parsed.document,
        parsed.binary,
        parsed.decodedViews,
        references,
        frames,
        fps,
      ),
    };
  }

  const baseline = await readBaselinePng(options);
  const previous = await readBaselineReport(options);
  // Encuadre con que se hizo el pliego anterior; si no viene en el informe, el del
  // modelo **antes** del parche. Comparar exige que la cámara no se mueva, y la
  // cámara se ajusta a la caja envolvente.
  const frameAabb = previous.frameAabb ?? (baseline ? computeSceneAabb(toSceneNodes(model)) : undefined);

  let edits = null;
  let undoPath = null;
  const patchPaths = options.all("patch");
  if (patchPaths.length > 0) {
    edits = [];
    const undo = [];
    for (const patchPath of patchPaths) {
      const patch = JSON.parse(await readFile(resolve(patchPath), "utf8"));
      // El inverso se calcula antes de aplicar: después ya no existe el estado que
      // hay que restituir. Los de varios parches se acumulan al revés.
      undo.unshift(...invertPatch(model, patch).edits);
      edits.push(...applyPatch(model, patch));
    }
    const requestedUndo = options.get("undo");
    if (requestedUndo && requestedUndo !== "true") {
      undoPath = resolve(requestedUndo);
      mkdirSync(dirname(undoPath), { recursive: true });
      writeFileSync(undoPath, `${JSON.stringify({ edits: undo }, null, 2)}\n`, "utf8");
    }
  }

  // Ensayo: se informa de coincidencias y errores, y no se renderiza ni se escribe.
  if (options.get("dry-run") === "true") {
    return {
      source: model.source,
      parts: model.parts.length,
      edits,
      dryRun: true,
      file: null,
      exported: null,
      undo: undoPath,
      warnings: [],
    };
  }

  const select = options.get("select");
  const { sheet, review } = reviewModel(model, {
    ...commonOptions(options),
    budget: readBudget(options),
    baselineWarnings: previous.warnings,
    select: select ? select.split(",").map((pattern) => pattern.trim()) : [],
    selectWhere: options.get("select-where"),
    useMaterialColors: options.get("material-colors") === "true",
    isolate: options.get("isolate") === "true",
    auditLimit: Number(options.get("audit-limit") ?? 12),
    baseline,
    frameAabb,
  });

  if (sheet) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, encodePng(sheet.pixels, sheet.width, sheet.height));
  }

  // Atar la malla a un esqueleto: no calcula pesos, aplica el vínculo declarado.
  // Se resuelve antes de exportar porque cambia lo que se escribe, no lo que se
  // revisa: el informe sigue siendo el del modelo, con su auditoría y su pliego.
  let binding = null;
  const bindPath = options.get("bind");
  if (bindPath) {
    const skeletonPath = options.get("skeleton");
    if (!skeletonPath || skeletonPath === "true") {
      throw new Error("--bind necesita --skeleton con el GLB del esqueleto");
    }
    if (!skeletonPath.toLowerCase().endsWith(".glb")) {
      throw new Error(`--skeleton solo lee .glb; '${skeletonPath}' no lo es`);
    }
    const skeletonBytes = await readFile(resolve(skeletonPath));
    const skeleton = skeletonFromParsedGlb(
      parseGlbAnimation(
        skeletonBytes.buffer.slice(skeletonBytes.byteOffset, skeletonBytes.byteOffset + skeletonBytes.byteLength),
        await loadMeshoptDecoder(),
      ),
    );
    const document = JSON.parse(await readFile(resolve(bindPath), "utf8"));
    binding = bindModelToSkeleton(model, skeleton, document);
  }

  let exported = null;
  const exportPath = options.get("export");
  if (exportPath) {
    exported = resolve(exportPath);
    mkdirSync(dirname(exported), { recursive: true });
    if (binding) {
      if (!exported.toLowerCase().endsWith(".glb")) {
        throw new Error(`--bind solo exporta .glb; '${exportPath}' no lo es (OBJ no guarda esqueleto)`);
      }
      writeFileSync(exported, Buffer.from(serializeSkinnedGlb(binding.scene)));
    } else if (exported.toLowerCase().endsWith(".glb")) {
      writeFileSync(exported, Buffer.from(serializeGlb(model)));
    } else {
      writeFileSync(exported, serializeObj(model), "utf8");
    }
  }
  if (binding && !exportPath) {
    throw new Error("--bind necesita --export: el modelo atado solo existe en el fichero de salida");
  }

  let animation;
  let skinning;
  let morphTargets;
  let controlPoses;
  let animationErrors;
  if (isBinary) {
    const inspection = await inspectGlbAnimation(data, controlPoseReference, decoder);
    ({ animation, skinning, morphTargets, controlPoses, errors: animationErrors } = inspection);
  }

  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    ...review,
    ...(binding
      ? {
          binding: {
            joints: binding.scene.skins[0].joints.length,
            boundParts: binding.bound.length,
            unusedJoints: binding.unusedJoints,
            clips: binding.scene.animations?.length ?? 0,
            // Atado rígido: un hueso por vértice. Decirlo en el informe evita que
            // alguien lo confunda con pesos calculados, que aquí no se calculan.
            mode: "rigid",
          },
        }
      : {}),
    edits,
    cached,
    file: sheet ? outputPath : null,
    exported,
    undo: undoPath,
    animation,
    skinning,
    morphTargets,
    controlPoses,
    animationErrors,
    sample,
  };
}

/**
 * Validación de la referencia de poses de control del contrato de animación.
 * `schemaVersion` 1 y `fps` entero positivo son obligatorios; `clips` es un
 * objeto indexado por nombre de clip cuyo valor es una lista de `{ frame,
 * positionsHash }`. Cualquier fallo es un error de datos (salida 2), no un
 * aviso del informe.
 */
function parseControlPoseReference(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.fps) || value.fps <= 0) {
    throw new Error("control poses: schemaVersion 1 y fps entero positivo son obligatorios");
  }
  if (!value.clips || typeof value.clips !== "object" || Array.isArray(value.clips)) {
    throw new Error("control poses: clips debe ser un objeto indexado por nombre de clip");
  }
  for (const [clipName, poses] of Object.entries(value.clips)) {
    if (!Array.isArray(poses)) throw new Error(`control poses: ${clipName} debe ser una lista`);
    for (const pose of poses) {
      if (!Number.isInteger(pose.frame) || pose.frame < 0 || typeof pose.positionsHash !== "string") {
        throw new Error(`control poses: ${clipName} contiene una pose inválida`);
      }
    }
  }
  return value;
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
  npm run agent3d -- --bvh <captura.bvh> --export <esqueleto.glb>
  npm run agent3d                              usa la escena de ejemplo

Entrada
  --model <ruta>          modelo GLB u OBJ; manda sobre --scene
  --scene <ruta>          escena declarativa en JSON
  --bvh <ruta.bvh>        captura de movimiento; solo convierte, no revisa. Manda
                          sobre --model y --scene, y exige --export .glb
  --patch <ruta>          parche a aplicar antes de renderizar. En un modelo mueve
                          matrices; en una escena edita el documento JSON.
                          Repetible: se aplican en orden
  --dry-run               informa de coincidencias y errores sin renderizar ni escribir
  --undo <ruta.json>      escribe el parche que deshace lo aplicado (solo con --model)

Contrato de animación GLB (solo --model)
  --control-poses <j>     referencia de poses: { schemaVersion:1, fps, clips } con
                          fotogramas y huellas SHA-256 esperadas; la herramienta
                          las certifica sin depender del renderer de turno
  --sample <j>            referencias de superficie (Fase C): lista de
                          { mesh, primitive, triangle, barycentric }; la
                          herramienta las evalúa en cada fotograma de --frames
  --frames "0,15,30,37"   fotogramas para --sample, en el fps del clip (--fps)
  --fps <n>               fotogramas por segundo para --sample (30)

Atar una malla a un esqueleto (solo --model)
  --skeleton <ruta.glb>   GLB con el árbol de huesos y sus clips, p. ej. el que
                          produce --bvh
  --bind <ruta.json>      vínculo declarado: { schemaVersion:1, bindings:[
                          { part:"rotor-*", joint:"Brazo" } ] }. Gana la primera
                          regla que encaja; una pieza sin regla es un error, no
                          se ata a la raíz por si acaso. Atado RÍGIDO: un hueso
                          por vértice, peso 1. Aquí no se calculan pesos, se
                          aplican los que declaras. Exige --export .glb

Esqueleto y clips declarados en la escena (solo --scene)
  La escena admite skeleton (huesos por nombre, con padre y offset),
  bindings (qué pieza a qué hueso) y clips (pistas con fotogramas clave).
  Con esqueleto, --export escribe el GLB atado y animado, y el informe trae
  rig y animationAudit. Ver --schema para la forma exacta.
  --audit-frames <n>      fotogramas a mirar por clip, como máximo (512). La
                          auditoría los recorre **todos** mientras quepan; si el
                          clip es más largo, los reparte y el informe lo dice con
                          'complete' en falso

Conversión de BVH (solo --bvh)
  --bvh-scale <n>         factor sobre desplazamientos y traslaciones (1). Un BVH
                          en centímetros pasa a metros —la unidad de glTF— con
                          0.01. No se aplica solo: el formato no declara su unidad
  --bvh-clip <nombre>     nombre del clip resultante ("BVH")

Guion (solo --story)
  --story <ruta.json>     audita un guion: { storyVersion, title, fps, scenes }
                          con el rol de cada escena y sus datos. No escribe nada
                          y no toca geometría; devuelve hechos y sale 1 si avisa
  --reading-rate <n>      caracteres por segundo que se suponen legibles (15).
                          Es una suposición declarada, no una medida

Puesta en escena (solo --staging)
  --staging <ruta.json>   audita una puesta en escena ya montada: qué se ve, si
                          el texto cabe en el cuadro y si se lee sobre su fondo.
                          El informe lo produce el editor, que es quien mide
  --contrast-ratio <n>    contraste mínimo exigido al texto (4.5, el AA de WCAG).
                          Es un umbral declarado, no una medida

  Ejemplares en artifacts/agent/guion-*.json: dos piezas completas y limpias.
  Se leen antes de escribir, para saber a qué suena esto cuando está bien; no
  se rellenan, que para eso harían falta huecos y aquí no los hay.

Salida
  --out <ruta.png>        pliego de contactos; por defecto artifacts/agent/contact-sheet.png
  --export <ruta>         exporta el modelo ya parcheado: .glb conserva color,
                          material y colocación; .obj solo la geometría
  --save-scene <ruta>     guarda la escena ya parcheada, para seguir desde ahí
  --inspect-only          solo el informe JSON, sin renderizar: ~4 veces más rápido

Selección y encuadre
  --select "a-*,b-*"      resalta las piezas que encajan; el encuadre las sigue
  --select-where <expr>   selección por propiedad: "triangles>1000",
                          "boundaryEdges>0", "material=Vidrio"; varias con comas
  --isolate true          dibuja solo lo seleccionado
  --audit-limit <n>       piezas seleccionadas a auditar en detalle (12)
  --tile <n>              lado del tile en píxeles (320)
  --ground false          sin plano de referencia
  --material-colors       pinta con el color del fichero en vez de arcilla neutra

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
  --parity                render de comparación: sin suavizado, sin sombras, sin
                          rótulo y sobre negro. Sirve para enfrentar el pliego
                          con el de otro rasterizador, no para revisarlo a ojo
  --no-cache              rehace el análisis del modelo en vez de leer .cache/
  --schema                forma aceptada de la escena y del parche, y un informe
                          de ejemplo, todo generado por el propio código
  --debug                 vuelca la pila en los errores
  --help                  esta ayuda

stdout es JSON puro. Código de salida: 0 sin avisos, 1 con avisos o parches
fallidos, 2 si hay un error de datos.

El informe declara contractVersion: 3. Los warnings son objetos
{ code, part, message, fix? }; los consumidores los comparan por code|part, no
por texto, y rechazan cualquier informe con otra contractVersion.`;

/**
 * Esquema de entrada y ejemplo de salida.
 *
 * Los dos salen del código: el esquema es el mismo objeto con que se valida la
 * entrada, y el ejemplo de informe se genera revisando la escena de demostración.
 * Escribir cualquiera de los dos a mano garantizaría que divergiesen.
 */
/**
 * Qué versión de SoftSight está respondiendo.
 *
 * El consumidor fija un commit nuestro en su repositorio —así puede avanzar
 * SoftSight sin romperle— pero hasta ahora ese pin era una cadena escrita a mano
 * en su documentación, que nadie comprobaba contra nada. Un pin que no se
 * verifica no protege: envejece en silencio y el día que importa señala a un
 * commit que ya no existe.
 *
 * `commit` sale de git y es `null` fuera de un repositorio —un tarball, un
 * paquete instalado—, que es información honesta y no un error: quien exige pin
 * decide qué hacer con la ausencia.
 */
function softsightVersion() {
  let commit = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    commit = null;
  }

  let version = null;
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    version = typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    version = null;
  }

  return { version, commit };
}

function printSchema() {
  const { review } = reviewScene(DEMO_SCENE, { inspectOnly: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        softsight: softsightVersion(),
        scene: SCENE_SCHEMA,
        staging: STAGING_SCHEMA,
        patch: PATCH_SCHEMA,
        sampleReference: SAMPLE_REFERENCE_SCHEMA,
        story: STORY_SCHEMA,
        storyRoles: ROLE_REQUIRED_DATA,
        reportExample: { contractVersion: REPORT_CONTRACT_VERSION, ...review },
        notes: [
          "El esquema es el que valida la entrada: un campo que no esté aquí se rechaza.",
          "reportExample sale de revisar la escena de demostración con --inspect-only.",
          "Con pliego, el informe trae además sheet, views, renderHash y partScreenBoxes.",
          "story es el guion: la duración de la pieza es la suma de sus escenas, no se declara.",
          "storyRoles dice qué campos de data exige cada rol; quien ponga el guion en escena los necesita.",
          "staging es lo que el editor mide sobre un frame ya montado; SoftSight solo lo juzga.",
          "softsight dice qué versión responde: el consumidor compara su pin contra este commit, no contra un texto.",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Convierte un BVH en un GLB con esqueleto y clip.
 *
 * No revisa nada: un BVH no trae malla, y fingir un informe de topología sobre
 * un esqueleto sería rellenar campos vacíos. Lo que devuelve es la cuenta de lo
 * convertido —articulaciones, nodos, fotogramas, canales— para que quien lo
 * llame sepa qué salió sin volver a abrir el fichero.
 *
 * El GLB resultante no tiene malla, y eso es correcto: lleva el árbol de huesos
 * y el clip, que es exactamente lo que traía el BVH. Quien quiera verlo le ata
 * su propia piel y lo vuelve a pasar por `--model`.
 */
/**
 * Audita un guion. No escribe nada: una historia no produce fichero, produce
 * hechos sobre sí misma, y quien la pone en escena es el editor.
 */
function auditStoryFile(options) {
  const storyPath = resolve(options.get("story"));
  const story = JSON.parse(readFileSync(storyPath, "utf8"));

  const rateFlag = options.get("reading-rate");
  const readingRate = rateFlag === undefined || rateFlag === "true" ? undefined : Number(rateFlag);
  if (rateFlag !== undefined && rateFlag !== "true" && (!Number.isFinite(readingRate) || readingRate <= 0)) {
    throw new Error(`--reading-rate inválido: '${rateFlag}'; debe ser un número positivo`);
  }

  return { source: storyPath, ...auditStory(story, readingRate === undefined ? {} : { readingRate }) };
}

/**
 * Audita una puesta en escena ya montada. Tampoco escribe nada: lo que entra son
 * medidas que hizo el editor —cajas, colores, qué se ve— y lo que sale son
 * hechos sobre ellas.
 */
function auditStagingFile(options) {
  const stagingPath = resolve(options.get("staging"));
  const staging = JSON.parse(readFileSync(stagingPath, "utf8"));

  const ratioFlag = options.get("contrast-ratio");
  const contrastRatio = ratioFlag === undefined || ratioFlag === "true" ? undefined : Number(ratioFlag);
  if (ratioFlag !== undefined && ratioFlag !== "true" && (!Number.isFinite(contrastRatio) || contrastRatio < 1)) {
    throw new Error(`--contrast-ratio inválido: '${ratioFlag}'; debe ser un número mayor o igual que 1`);
  }

  return {
    source: stagingPath,
    ...auditStaging(staging, contrastRatio === undefined ? {} : { contrastRatio }),
  };
}

async function convertBvhFile(options) {
  const bvhPath = resolve(options.get("bvh"));
  const exported = options.get("export");
  if (!exported || exported === "true") {
    throw new Error("--bvh necesita --export con la ruta del .glb de salida");
  }
  if (!exported.toLowerCase().endsWith(".glb")) {
    throw new Error(`--bvh solo exporta .glb; '${exported}' no lo es`);
  }

  const scaleFlag = options.get("bvh-scale");
  const scale = scaleFlag === undefined || scaleFlag === "true" ? 1 : Number(scaleFlag);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`--bvh-scale inválido: '${scaleFlag}'; debe ser un número positivo`);
  }
  const clipFlag = options.get("bvh-clip");
  const clipName = clipFlag === undefined || clipFlag === "true" ? "BVH" : clipFlag;

  const bvh = parseBvh(await readFile(bvhPath, "utf8"));
  const scene = bvhToSkinnedScene(bvh, { clipName, scale });
  const glb = serializeSkinnedGlb(scene);

  const exportPath = resolve(exported);
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, Buffer.from(glb));

  const clip = scene.animations?.[0];
  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    source: bvhPath,
    export: exportPath,
    bytes: glb.byteLength,
    bvh: {
      joints: bvh.joints.length,
      roots: bvh.roots.length,
      frames: bvh.frameCount,
      frameTime: bvh.frameTime,
      // El fps es derivado, no declarado: BVH solo dice el segundo por fotograma.
      fps: 1 / bvh.frameTime,
      channels: bvh.channelCount,
      // El orden de rotación es por articulación, y que varíe no es un error:
      // decirlo aquí evita que alguien suponga uno solo para todo el esqueleto.
      rotationOrders: [
        ...new Set(
          bvh.joints
            .map((joint) =>
              joint.channels
                .filter((channel) => channel.endsWith("rotation"))
                .map((channel) => channel[0])
                .join(""),
            )
            .filter((order) => order.length > 0),
        ),
      ],
    },
    scene: {
      clip: clip?.name ?? null,
      // Un nodo por articulación más uno por cada extremo terminal.
      nodes: scene.nodes.length,
      animatedChannels: clip?.channels.length ?? 0,
      // Sin malla a propósito: el BVH no la trae y aquí no se inventa.
      meshes: scene.meshes.length,
    },
    scale,
    notes: [
      "El GLB sale sin malla porque el BVH no la trae: es esqueleto y clip.",
      "Por eso --model lo rechaza con 'el modelo no tiene geometría visible', y las" +
        " poses de control tampoco aplican: evalúan vértices, y aquí no hay ninguno.",
      "Se certifica cuando alguien le ata una piel; a partir de ahí es un GLB normal.",
    ],
  };
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
  // El guion tampoco es un modelo: no hay geometría que mirar, solo texto y
  // tiempo. Va antes por el mismo motivo que el BVH.
  if (options.has("story")) {
    const report = auditStoryFile(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.warnings.length > 0 ? 1 : 0;
    return;
  }
  // La puesta en escena tampoco trae geometría: son las medidas que hizo el
  // editor sobre un frame ya montado.
  if (options.has("staging")) {
    const report = auditStagingFile(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.warnings.length > 0 ? 1 : 0;
    return;
  }
  // El BVH va antes que todo lo demás porque no es un modelo: no tiene malla, así
  // que no hay nada que encuadrar, rasterizar ni auditar. Es una conversión, y
  // lo que produce sí entra después por --model como cualquier GLB.
  if (options.has("bvh")) {
    const report = await convertBvhFile(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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

  // El parche edita el documento, no la geometría: lo que sale vuelve a ser una
  // escena, y con --save-scene se guarda para seguir a partir de ella.
  let edits = null;
  const patchPaths = options.all("patch");
  if (patchPaths.length > 0) {
    edits = [];
    for (const patchPath of patchPaths) {
      edits.push(...applyPatchToScene(spec, JSON.parse(await readFile(resolve(patchPath), "utf8"))));
    }
  }

  if (options.get("dry-run") === "true") {
    process.stdout.write(
      `${JSON.stringify({ objects: spec.objects.length, edits, dryRun: true }, null, 2)}\n`,
    );
    process.exitCode = (edits ?? []).some((edit) => edit.error) ? 1 : 0;
    return;
  }

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

  // Esqueleto y clips declarados en la propia escena: un agente construye el
  // personaje y lo anima sin salir del JSON que ya sabe escribir. El atado sigue
  // siendo rígido y el vínculo lo declara él; aquí no se calcula ningún peso.
  let rig = null;
  let riggedScene = null;
  let animationAudit = null;
  if (spec.skeleton) {
    if (!Array.isArray(spec.bindings) || spec.bindings.length === 0) {
      throw new Error("una escena con `skeleton` necesita `bindings`: qué pieza va a qué hueso");
    }
    const asModel = modelFromScene(spec, scenePath ?? "escena");
    rig = resolveRig(spec.skeleton, spec.clips ?? []);
    const bound = bindModelToSkeleton(asModel, rig.skeleton, {
      schemaVersion: 1,
      bindings: spec.bindings,
    });
    riggedScene = bound.scene;

    // La auditoría de movimiento: lo que ninguna imagen revela porque ocurre en
    // un fotograma que nadie miró. Se apoya en el evaluador certificado.
    if ((spec.clips ?? []).length > 0) {
      const framesFlag = options.get("audit-frames");
      const sampleFrames =
        framesFlag === undefined || framesFlag === "true" ? 512 : Number(framesFlag);
      if (!Number.isInteger(sampleFrames) || sampleFrames < 2) {
        throw new Error(`--audit-frames inválido: '${framesFlag}'; debe ser un entero de 2 en adelante`);
      }
      const parsedRig = parseGlbAnimation(serializeSkinnedGlb(riggedScene));
      animationAudit = auditAnimation(
        asModel,
        parsedRig,
        new Map(bound.bound.map((entry) => [entry.part, entry.joint])),
        { sampleFrames, fps: rig.clips[0]?.fps ?? 30 },
      );
    }
  }

  // Exportar lo inventado: crear y entregar dejan de ser caminos distintos.
  let exported = null;
  const exportPath = options.get("export");
  if (exportPath) {
    exported = resolve(exportPath);
    mkdirSync(dirname(exported), { recursive: true });
    const asModel = modelFromScene(spec, scenePath ?? "escena");
    if (riggedScene) {
      if (!exported.toLowerCase().endsWith(".glb")) {
        throw new Error(`una escena con esqueleto solo exporta .glb; '${exportPath}' no lo es`);
      }
      writeFileSync(exported, Buffer.from(serializeSkinnedGlb(riggedScene)));
    } else if (exported.toLowerCase().endsWith(".glb")) {
      writeFileSync(exported, Buffer.from(serializeGlb(asModel)));
    } else {
      writeFileSync(exported, serializeObj(asModel), "utf8");
    }
  }

  let savedScene = null;
  const savePath = options.get("save-scene");
  if (savePath) {
    savedScene = resolve(savePath);
    mkdirSync(dirname(savedScene), { recursive: true });
    writeFileSync(savedScene, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        contractVersion: REPORT_CONTRACT_VERSION,
        ...review,
        ...(rig ? { rig: { joints: rig.skeleton.nodes.length, clips: rig.clips, mode: "rigid" } } : {}),
        ...(animationAudit ? { animationAudit } : {}),
        edits,
        file: sheet ? outputPath : null,
        exported,
        savedScene,
      },
      null,
      2,
    )}\n`,
  );
  const failedEdits = (edits ?? []).filter((edit) => edit.error);
  process.exitCode = review.warnings.length > 0 || failedEdits.length > 0 ? 1 : 0;
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
