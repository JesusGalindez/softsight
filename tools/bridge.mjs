#!/usr/bin/env node
/**
 * Puente local (Fase D): JSON por stdin, JSON por stdout.
 *
 * El navegador no ejecuta el CLI; un proceso local que reciba JSON, invoque a
 * SoftSight, limite rutas y devuelva informe + artefactos. Con el contrato
 * publicado (`agent3d --schema`), la forma del puente sale de SoftSight y no
 * puede divergir.
 *
 * Petición:
 *
 *   { "bridgeContractVersion": 1,
 *     "command": "inspect"|"render"|"patch"|"sample"|"scene"|"bvh"|"story"|"staging"|"schema",
 *     "files": { "model": { "name": "drone.glb", "data": "<base64>" }, ... },
 *     "options": { ... } }
 *
 * Tres comandos no reciben `model`. `bvh` recibe una captura y devuelve el GLB
 * con esqueleto y clip; es una conversión, no una revisión, así que su informe
 * no trae ni auditoría ni pliego. `scene` recibe una escena declarativa —la
 * misma que valida `--schema`, con sus `objects` y, si los trae, su `skeleton`,
 * sus `bindings` y sus `clips`— y devuelve el informe completo, el pliego y el
 * GLB. Es la vía por la que un agente construye desde cero sin tocar el disco.
 * `story` recibe un guion y devuelve hechos medidos sobre él, sin artefactos:
 * una historia no produce fichero, y ponerla en escena es del editor. `staging`
 * recibe lo que el editor midió sobre un frame ya montado —capas, cajas,
 * colores— y dice si la escena enseña algo, si el texto cabe y si se lee.
 *
 * Respuesta:
 *
 *   { "bridgeContractVersion": 1, "command": "inspect", "exitCode": 0,
 *     "report": { ... }, "artifacts": [ { "name": "contact-sheet.png",
 *     "mimeType": "image/png", "data": "<base64>" } ] }
 *
 * Los errores de datos son JSON con `code` y salida 2, nunca volcados de pila.
 * El puente sale con el mismo código que el CLI (0 sin avisos, 1 con avisos o
 * parches fallidos) para que el consumidor no tenga que interpretar el informe.
 *
 * Sandbox: un directorio de trabajo dedicado por petición; los ficheros se
 * nombran de forma plana y validada (ni `..` ni separadores), hay límite de
 * tamaño para el JSON, los ficheros y los artefactos, timeout por petición, y
 * solo `execFile` con argumentos fijos: el puente no expande variables ni
 * patrones.
 *
 * Caché del modelo: `SOFTSIGHT_BRIDGE_MODEL_CACHE=<directorio>` persiste el
 * `model` fuera del directorio de trabajo, en un fichero plano nombrado por el
 * `sha256` de su contenido. El modelo es lo que más pesa del JSON (hasta
 * `SOFTSIGHT_BRIDGE_MAX_FILE_MB`) y no cambia entre peticiones del agente que
 * edita la escena, no el fichero; con una ruta estable el puente no lo vuelve a
 * escribir en cada turno y, además, la caché interna del motor lo encuentra por
 * ruta+mtime+tamaño. Los otros slots (`controlPoses`, `patches`, ...) siguen
 * viviendo en el directorio de trabajo. El directorio se acota por mtime con
 * `SOFTSIGHT_BRIDGE_MODEL_CACHE_MAX_MB` (por defecto 256). Como con la caché
 * del motor, la invalidación manda: una petición con `noCache: true` ignora el
 * directorio y escribe el modelo en el directorio de trabajo.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BRIDGE_CONTRACT_VERSION = 1;
const here = dirname(fileURLToPath(import.meta.url));
const AGENT3D = resolve(here, "agent3d.mjs");
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REQUEST_BYTES = Number(process.env.SOFTSIGHT_BRIDGE_MAX_REQUEST_MB ?? 32) * 1024 * 1024;
const MAX_FILE_BYTES = Number(process.env.SOFTSIGHT_BRIDGE_MAX_FILE_MB ?? 256) * 1024 * 1024;
const MAX_ARTIFACT_BYTES = Number(process.env.SOFTSIGHT_BRIDGE_MAX_ARTIFACT_MB ?? 64) * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.SOFTSIGHT_BRIDGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
// Directorio externo (no el temporal de la petición) donde persiste el `model`,
// acotado a `SOFTSIGHT_BRIDGE_MODEL_CACHE_MAX_MB` (por mtime, 256 MB por defecto);
// un tope en cero desactiva la caché, igual que omitir la variable.
const MODEL_CACHE_DIR = process.env.SOFTSIGHT_BRIDGE_MODEL_CACHE ?? "";
const MODEL_CACHE_MAX_BYTES = Number(process.env.SOFTSIGHT_BRIDGE_MODEL_CACHE_MAX_MB ?? 256) * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const COMMANDS = new Set(["inspect", "render", "patch", "sample", "scene", "bvh", "story", "staging", "schema"]);

// Opciones del CLI que el puente acepta, con su tipo. Todo lo demás se rechaza:
// el puente no expande variables ni patrones, y solo ejecuta con argumentos fijos.
const PASSTHROUGH = {
  tile: "number",
  ground: "boolean",
  select: "string",
  selectWhere: "string",
  isolate: "boolean",
  materialColors: "boolean",
  auditLimit: "number",
  expectSize: "number",
  maxTriangles: "number",
  maxParts: "number",
  maxBoundaryEdges: "number",
  maxDegenerate: "number",
  maxSymmetryError: "number",
  requireWatertight: "boolean",
  noCache: "boolean",
  frames: "string",
  fps: "number",
  bvhScale: "number",
  bvhClip: "string",
  auditFrames: "number",
  readingRate: "number",
  contrastRatio: "number",
  parity: "boolean",
};

const OPTION_TO_FLAG = {
  tile: "--tile",
  ground: "--ground",
  select: "--select",
  selectWhere: "--select-where",
  isolate: "--isolate",
  materialColors: "--material-colors",
  auditLimit: "--audit-limit",
  expectSize: "--expect-size",
  maxTriangles: "--max-triangles",
  maxParts: "--max-parts",
  maxBoundaryEdges: "--max-boundary-edges",
  maxDegenerate: "--max-degenerate",
  maxSymmetryError: "--max-symmetry-error",
  requireWatertight: "--require-watertight",
  noCache: "--no-cache",
  frames: "--frames",
  fps: "--fps",
  bvhScale: "--bvh-scale",
  bvhClip: "--bvh-clip",
  auditFrames: "--audit-frames",
  readingRate: "--reading-rate",
  contrastRatio: "--contrast-ratio",
  parity: "--parity",
};

// Ficheros que admite cada comando: los opcionales solo se escriben si vienen.
const FILE_SLOTS = {
  inspect: { model: false, controlPoses: true },
  render: { model: false, controlPoses: true },
  patch: { model: false, controlPoses: true, patches: false, baseline: true, baselineReport: true },
  sample: { model: false, controlPoses: true, references: false },
  // Los dos que no reciben `model`: uno convierte una captura, el otro parte de
  // una escena declarativa en vez de un fichero 3D.
  scene: { scene: false, patches: true },
  bvh: { bvh: false },
  // El guion no trae geometría ni produce fichero: entra texto y salen hechos.
  story: { story: false },
  // La puesta en escena tampoco: entran medidas del editor y salen hechos.
  staging: { staging: false },
  schema: {},
};

function fail(code, message) {
  process.stdout.write(`${JSON.stringify({ bridgeContractVersion: BRIDGE_CONTRACT_VERSION, code, message }, null, 2)}\n`);
  process.exitCode = 2;
}

function readStdin() {
  return new Promise((resolveResult, reject) => {
    const chunks = [];
    let total = 0;
    process.stdin.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new BridgeError("request-too-large", `la petición excede ${MAX_REQUEST_BYTES} bytes`));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolveResult(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });
}

class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Nombre plano y seguro; `..` y separadores no pasan. */
function checkFileName(name, slot) {
  if (typeof name !== "string" || !SAFE_NAME.test(name) || name === "." || name === ".." || name.includes("..")) {
    throw new BridgeError("invalid-file-name", `${slot}: '${String(name)}' no es un nombre de fichero plano seguro`);
  }
}

/** Valida un payload base64 y lo convierte en bytes; los mismos límites para
 * escribir en el sandbox que para cachear el modelo. */
function decodePayload(payload, slot) {
  if (typeof payload !== "object" || payload === null || typeof payload.data !== "string" || typeof payload.name !== "string") {
    throw new BridgeError("invalid-request", `${slot}: cada fichero necesita { name, data } con data en base64`);
  }
  checkFileName(payload.name, slot);
  const data = payload.data;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new BridgeError("invalid-request", `${slot}: '${payload.name}' no tiene base64 válido`);
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 && data.length > 0) {
    throw new BridgeError("invalid-request", `${slot}: '${payload.name}' no tiene base64 válido`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new BridgeError("file-too-large", `${slot}: '${payload.name}' excede ${MAX_FILE_BYTES} bytes`);
  }
  return { name: payload.name, bytes };
}

/** Escribe un payload base64 en el directorio de trabajo y devuelve la ruta. */
function writeFilePayload(workDir, slot, payload) {
  const { name, bytes } = decodePayload(payload, slot);
  const path = join(workDir, name);
  writeFileSync(path, bytes);
  return path;
}

/**
 * Persiste un `model` en `MODEL_CACHE_DIR` bajo el nombre `<sha256>.ext` si vale,
 * y devuelve la ruta. Solo se llama con la caché activa y `noCache: false`.
 */
function writeFileModelCached(slot, payload) {
  const { name, bytes } = decodePayload(payload, slot);
  const target = join(MODEL_CACHE_DIR, `${createHash("sha256").update(bytes).digest("hex")}${extname(name)}`);
  if (!existsSync(target)) {
    mkdirSync(MODEL_CACHE_DIR, { recursive: true });
    writeFileSync(target, bytes);
    trimModelCache();
  }
  return target;
}

/** Borra los ficheros más viejos del directorio hasta volver al tope. */
function trimModelCache() {
  let entries;
  try {
    entries = readdirSync(MODEL_CACHE_DIR);
  } catch {
    return;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(MODEL_CACHE_DIR, entry);
    try {
      const stats = statSync(path);
      if (stats.isFile()) files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // otro proceso pudo borrarlo a mitad de listado
    }
  }
  let total = 0;
  for (const file of files) total += file.size;
  if (total <= MODEL_CACHE_MAX_BYTES) return;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of files) {
    if (total <= MODEL_CACHE_MAX_BYTES) break;
    try {
      unlinkSync(file.path);
      total -= file.size;
    } catch {
      // ya no existe; sigue con el siguiente
    }
  }
}

function readArtifact(workDir, name, mimeType) {
  const path = join(workDir, name);
  const bytes = readFileSync(path);
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    throw new BridgeError("artifact-too-large", `el artefacto '${name}' excede ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return { name, mimeType, data: bytes.toString("base64") };
}

function parseOptions(options) {
  if (options === undefined) return [];
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new BridgeError("invalid-request", "options debe ser un objeto");
  }
  const flags = [];
  for (const [key, value] of Object.entries(options)) {
    const kind = PASSTHROUGH[key];
    if (kind === undefined) {
      throw new BridgeError("invalid-request", `opción desconocida: ${key}`);
    }
    if (kind === "boolean") {
      if (typeof value !== "boolean") throw new BridgeError("invalid-request", `${key} debe ser booleano`);
      flags.push(OPTION_TO_FLAG[key], String(value));
      continue;
    }
    if (kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new BridgeError("invalid-request", `${key} debe ser un número`);
      }
      flags.push(OPTION_TO_FLAG[key], String(value));
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new BridgeError("invalid-request", `${key} debe ser una cadena no vacía`);
    }
    flags.push(OPTION_TO_FLAG[key], value);
  }
  return flags;
}

function buildArgs(request, workDir) {
  const slots = FILE_SLOTS[request.command];
  const files = {};
  for (const [slot, optional] of Object.entries(slots)) {
    const payload = request.files?.[slot];
    if (payload === undefined) {
      if (!optional) throw new BridgeError("invalid-request", `falta el fichero '${slot}'`);
      continue;
    }
    if (slot === "patches") {
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new BridgeError("invalid-request", "patches debe ser una lista no vacía de { name, data }");
      }
      files[slot] = payload.map((entry, index) => writeFilePayload(workDir, `patches[${index}]`, entry));
      continue;
    }
    if (slot === "model" && MODEL_CACHE_DIR && MODEL_CACHE_MAX_BYTES > 0 && request.options?.noCache !== true) {
      files[slot] = writeFileModelCached(slot, payload);
      continue;
    }
    files[slot] = writeFilePayload(workDir, slot, payload);
  }

  if (request.command === "bvh") {
    // No lleva --model: el CLI distingue la conversión de la revisión por la
    // bandera de entrada, no por la extensión del fichero.
    const converted = ["--bvh", files.bvh, "--export", join(workDir, "esqueleto.glb")];
    converted.push(...parseOptions(request.options));
    return converted;
  }

  if (request.command === "story") {
    // Ni --model ni --export: una historia no produce artefacto, produce hechos
    // sobre sí misma. Quien la pone en escena es el editor.
    return ["--story", files.story, ...parseOptions(request.options)];
  }

  if (request.command === "staging") {
    // Tampoco produce artefacto: entra lo que el editor midió y salen hechos.
    return ["--staging", files.staging, ...parseOptions(request.options)];
  }

  if (request.command === "scene") {
    // Siempre exporta: una escena que un agente acaba de inventar no existe en
    // ningún fichero suyo, así que devolver solo el informe le dejaría sin lo
    // único que puede volver a cargar.
    const built = ["--scene", files.scene, "--export", join(workDir, "escena.glb")];
    if (files.patches) for (const patchPath of files.patches) built.push("--patch", patchPath);
    // `inspectOnly` no es una opción del CLI sino una forma de pedir el informe
    // sin pliego, así que se consume aquí y no se reenvía.
    const { inspectOnly, ...rest } = request.options ?? {};
    if (inspectOnly === true) built.push("--inspect-only", "true");
    else built.push("--out", join(workDir, "contact-sheet.png"));
    built.push(...parseOptions(rest));
    return built;
  }

  const flags = ["--model", files.model];
  if (files.controlPoses) flags.push("--control-poses", files.controlPoses);

  if (request.command === "inspect") {
    flags.push("--inspect-only", "true");
  } else if (request.command === "render") {
    flags.push("--out", join(workDir, "contact-sheet.png"));
  } else if (request.command === "patch") {
    flags.push("--out", join(workDir, "contact-sheet.png"));
    for (const patchPath of files.patches) flags.push("--patch", patchPath);
    if (files.baseline) flags.push("--baseline", files.baseline);
    if (files.baselineReport) flags.push("--baseline-report", files.baselineReport);
    flags.push("--undo", join(workDir, "undo.json"));
  } else if (request.command === "sample") {
    flags.push("--inspect-only", "true", "--sample", files.references);
  }
  flags.push(...parseOptions(request.options));
  return flags;
}

async function runCommand(request) {
  const workDir = mkdtempSync(join(tmpdir(), "softsight-bridge-"));
  try {
    const args = buildArgs(request, workDir);
    let stdout;
    let stderr;
    let exitCode;
    try {
      ({ stdout, stderr } = await execFileAsync(process.execPath, [AGENT3D, ...args], {
        maxBuffer: MAX_ARTIFACT_BYTES,
        timeout: TIMEOUT_MS,
        killSignal: "SIGKILL",
        shell: false,
      }));
      exitCode = 0;
    } catch (error) {
      // execFile rechaza con el código de salida del hijo: 1 son avisos del
      // informe (éxito con informe), 2 es un error de datos, y el timeout se
      // reconoce porque el hijo murió por señal o por 'ETIMEDOUT'.
      const cause = error;
      if (cause?.killed || cause?.signal === "SIGKILL" || cause?.code === "ETIMEDOUT") {
        throw new BridgeError("bridge-timeout", `la petición excedió ${TIMEOUT_MS} ms`);
      }
      stdout = cause?.stdout ?? Buffer.alloc(0);
      stderr = cause?.stderr ?? Buffer.alloc(0);
      if (cause?.code === 2) {
        throw new BridgeError("data-error", stderr.toString("utf8").trim() || "error de datos");
      }
      if (cause?.code !== 1) {
        throw new BridgeError(
          "bridge-spawn-error",
          `no se pudo invocar al CLI: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      exitCode = 1;
    }

    let report;
    try {
      report = JSON.parse(stdout.toString("utf8"));
    } catch {
      throw new BridgeError("data-error", `el CLI no devolvió JSON: ${stderr.toString("utf8").trim() || "sin stderr"}`);
    }

    const artifacts = [];
    if (request.command === "bvh") {
      artifacts.push(readArtifact(workDir, "esqueleto.glb", "model/gltf-binary"));
    }
    if (request.command === "scene") {
      artifacts.push(readArtifact(workDir, "escena.glb", "model/gltf-binary"));
      if (request.options?.inspectOnly !== true) {
        artifacts.push(readArtifact(workDir, "contact-sheet.png", "image/png"));
      }
    }
    if (request.command === "render" || request.command === "patch") {
      artifacts.push(readArtifact(workDir, "contact-sheet.png", "image/png"));
      if (request.command === "patch") {
        artifacts.push(readArtifact(workDir, "undo.json", "application/json"));
      }
    }
    process.stdout.write(
      `${JSON.stringify(
        { bridgeContractVersion: BRIDGE_CONTRACT_VERSION, command: request.command, exitCode, report, artifacts },
        null,
        2,
      )}\n`,
    );
    process.exitCode = exitCode;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const input = await readStdin();
  let request;
  try {
    request = JSON.parse(input.toString("utf8"));
  } catch {
    throw new BridgeError("invalid-request", "la petición no es JSON válido");
  }
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new BridgeError("invalid-request", "la petición debe ser un objeto");
  }
  if (request.bridgeContractVersion !== BRIDGE_CONTRACT_VERSION) {
    throw new BridgeError("invalid-request", `bridgeContractVersion ${BRIDGE_CONTRACT_VERSION} es obligatoria`);
  }
  if (typeof request.command !== "string" || !COMMANDS.has(request.command)) {
    throw new BridgeError("invalid-request", `comando desconocido: ${String(request.command)}`);
  }
  if (request.command === "schema") {
    const { stdout } = await execFileAsync(process.execPath, [AGENT3D, "--schema"], { maxBuffer: 8 * 1024 * 1024 });
    const report = JSON.parse(stdout);
    process.stdout.write(
      `${JSON.stringify({ bridgeContractVersion: BRIDGE_CONTRACT_VERSION, command: "schema", exitCode: 0, report }, null, 2)}\n`,
    );
    return;
  }
  if (request.files !== undefined && (typeof request.files !== "object" || request.files === null || Array.isArray(request.files))) {
    throw new BridgeError("invalid-request", "files debe ser un objeto");
  }
  await runCommand(request);
}

main().catch((error) => {
  if (error instanceof BridgeError) {
    fail(error.code, error.message);
    return;
  }
  fail("bridge-internal", error instanceof Error ? error.message : String(error));
});
