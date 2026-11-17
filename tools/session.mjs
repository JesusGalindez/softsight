/**
 * Sesiones residentes y barridos — la fase 3 del plan de mejora.
 *
 * ## La sesión: la cuenta de ficheros la lleva el banco
 *
 * El principio 3 de `plan-agentes.md` —el agente «no recuerda entre llamadas»—
 * se resolvió metiendo la memoria en la respuesta: `--baseline`,
 * `--baseline-report`, `--undo`. Funciona, y deja al agente llevando la cuenta:
 * guardar el pliego de este turno para pasarlo en el siguiente, guardar el
 * informe para el `warningsDelta`, componer la lista de parches para deshacer. Por
 * MCP ni siquiera podía, porque el pliego le llegaba en línea y `--baseline` pide
 * una ruta. La sesión lleva esa cuenta:
 *
 * ```text
 * sessionOpen     modelo o escena + opciones de revisión → turno 0
 * sessionApply    parches → el turno siguiente, comparado con el anterior
 * sessionUndo     quita lo último que se aplicó → otro turno
 * sessionExport   el modelo como está, y la lista de parches que lo reproduce
 * ```
 *
 * ## Un turno **es** el CLI, por construcción
 *
 * Cada turno lanza el mismo CLI que cualquier otra petición, con la lista entera:
 *
 * ```text
 * --model M --patch p1 … --patch pk --baseline S(k-1) --baseline-report R(k-1)
 * ```
 *
 * así que lo que la sesión devuelve es lo que devolvería esa orden, byte a byte, y
 * `test:session` lo comprueba contra el CLI lanzado aparte. El encuadre se fija en
 * el turno 0 y no se mueve: `--baseline-report` lo lleva en `sheet.frameAabb`, y
 * sin eso cada diff estaría lleno de siluetas desplazadas (A1).
 *
 * **Por `argv` y no por API, y es lo correcto.** El plan pedía sacar
 * `reviewModelFile` a una función para que el residente no pasara por `argv`.
 * Mirado de cerca no compra nada: lo que un turno repite es cargar el modelo, y Ω2
 * ya midió que copiar un modelo en memoria cuesta lo mismo que leerlo de la caché
 * de disco —que la sesión acierta en cada turno, porque su fichero no cambia de
 * ruta ni de mtime—. Por `argv`, en cambio, la equivalencia con el CLI no hay que
 * mantenerla: no hay dos caminos que puedan divergir.
 *
 * ## El estado, y cómo se rehace
 *
 * El estado de una sesión es `(huella de la entrada, opciones de revisión, lista
 * de parches)`, y viaja en cada respuesta como `stateHash`. Las opciones se fijan
 * al abrir porque son estado —con otro `tile` el pliego es otro—; lo que solo
 * recorta la respuesta (`summary`, `fields`) vale en cada turno. Si el proceso
 * expulsa la sesión para dejar sitio, se rehace abriéndola otra vez y aplicando
 * los mismos parches: el `stateHash` dice si se llegó al mismo sitio.
 *
 * Un parche con un error de esquema no entra —el CLI sale con 2 y la sesión se
 * queda como estaba—. Uno con una edición fallida sí, igual que en el CLI: sale
 * con 1 y la edición dice por qué, y `sessionUndo` lo saca.
 *
 * ## El barrido: K variantes, una llamada
 *
 * `sweep` revisa la base y luego cada variante —una lista de parches sobre la
 * base— con `--baseline-report` de la base, así que cada fila trae su
 * `warningsDelta` respecto a ella. De cada informe sale la fila que se pidió
 * (`fields`, o el resumen) y el cruce por los criterios declarados
 * (`src/soft/agent/sweep.ts`). No necesita proceso residente: es una petición.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compareSweep, criterionValue, projectFields, summarize } from "../dist-node/agent3d.mjs";
import { forgetAuditCache } from "./auditCache.mjs";
import { BridgeError, decodePayload, parseOptions, readArtifact } from "./bridge.mjs";
import { forgetModelCache } from "./modelCache.mjs";

/** Las opciones que deciden cómo se revisa. Son estado: se fijan al abrir. */
const SETTINGS = new Set([
  "tile",
  "ground",
  "select",
  "selectWhere",
  "isolate",
  "materialColors",
  "auditLimit",
  "expectSize",
  "maxTriangles",
  "maxParts",
  "maxBoundaryEdges",
  "maxDegenerate",
  "maxSymmetryError",
  "requireWatertight",
  "noCache",
  "parity",
  "auditFrames",
]);

/** Las que solo recortan la respuesta: valen en cada turno y no tocan el estado. */
const PROJECTION = new Set(["summary", "fields"]);

/** Cuántas sesiones vivas caben en un proceso. La que menos se usó sale primero. */
const SESSIONS_MAX = Number(process.env.SOFTSIGHT_SESSIONS_MAX ?? 8);

/** Un barrido más largo no cabe en una respuesta que alguien vaya a leer. */
const MAX_SWEEP_VARIANTS = 64;

const DIRECTIONS = new Set(["MENOR_MEJOR", "MAYOR_MEJOR"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message) {
  return new BridgeError("invalid-request", message);
}

/**
 * Borra un directorio de trabajo y, antes, lo que las cachés del CLI guardaron con
 * su modelo como clave: la ruta muere con el directorio, y una entrada que nadie
 * volverá a pedir solo echa antes a las que sí se piden. Un barrido es justo lo
 * que un agente repite en bucle.
 */
function removeWorkDir(workDir, modelPath) {
  if (modelPath !== null) {
    forgetModelCache(modelPath);
    forgetAuditCache(modelPath);
  }
  rmSync(workDir, { recursive: true, force: true });
}

/** JSON con las claves ordenadas: dos parches iguales escritos en otro orden son el mismo estado. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Reparte las opciones de la petición en las tres clases que la sesión distingue.
 * Una opción de revisión en un turno —`tile` al aplicar— se rechaza con su
 * motivo: aceptarla haría que el turno no se pudiera reproducir con las opciones
 * de la sesión.
 */
function splitOptions(options, { settings: settingsAllowed, local: localAllowed = [] }) {
  if (options === undefined) return { settings: {}, projection: {}, local: {} };
  if (!isPlainObject(options)) throw invalid("options debe ser un objeto");
  const settings = {};
  const projection = {};
  const local = {};
  for (const [key, value] of Object.entries(options)) {
    if (PROJECTION.has(key)) projection[key] = value;
    else if (localAllowed.includes(key)) local[key] = value;
    else if (SETTINGS.has(key) && settingsAllowed) settings[key] = value;
    else if (SETTINGS.has(key)) {
      throw invalid(`${key}: las opciones de revisión se fijan al abrir la sesión, porque son parte de su estado`);
    } else throw invalid(`opción desconocida para este comando: ${key}`);
  }
  // Los tipos los valida la misma tabla que el resto del puente.
  parseOptions(projection);
  return { settings, projection, local };
}

/** Las mismas proyecciones que `--fields` y `--summary`, sobre el informe ya hecho. */
function view(report, projection) {
  if (projection.fields !== undefined) {
    const paths = projection.fields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field.length > 0);
    try {
      return projectFields(report, paths);
    } catch (error) {
      throw new BridgeError("data-error", error instanceof Error ? error.message : String(error));
    }
  }
  return projection.summary === true ? summarize(report) : report;
}

/**
 * Dónde se guarda la entrada dentro de un directorio de trabajo: en su propia
 * carpeta, porque su nombre lo pone quien llama y al lado viven `parche-0.json`,
 * `informe-0.json` o `base.json`. Una escena que se llamara `informe-0.json`
 * quedaría pisada por el informe del turno 0.
 */
function inputPathIn(workDir, name) {
  return join(workDir, "entrada", name);
}

/** Escribe la entrada en su carpeta. Dentro del `try` de quien la llama: si falla,
 * el directorio de trabajo se borra con todo lo demás. */
function writeInput(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/** El modelo o la escena de la petición: exactamente uno de los dos. */
function readInput(files) {
  if (!isPlainObject(files)) throw invalid("files debe ser un objeto con model o scene");
  const unknown = Object.keys(files).filter((slot) => slot !== "model" && slot !== "scene");
  if (unknown.length > 0) throw invalid(`fichero desconocido: ${unknown[0]}`);
  if (("model" in files) === ("scene" in files)) throw invalid("hace falta exactamente uno de model o scene");
  const kind = "model" in files ? "model" : "scene";
  const { name, bytes } = decodePayload(files[kind], kind);
  return { kind, name, bytes };
}

/** Un documento JSON en base64, como los de `patch` o `story`. */
function readDocument(payload, slot) {
  const { bytes } = decodePayload(payload, slot);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalid(`${slot} no es JSON`);
  }
  if (!isPlainObject(document)) throw invalid(`${slot} debe ser un objeto`);
  return document;
}

/** Parches en base64, como en `patch`: cada uno, un documento JSON. */
function readPatches(payloads, slot) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw invalid(`${slot} debe ser una lista no vacía de { name, data }`);
  }
  return payloads.map((payload, index) => readDocument(payload, `${slot}[${index}]`));
}

/** El CLI, con su código de salida: 2 es un error de datos y no deja informe. */
async function runCli(execute, args) {
  const { exitCode, stdout, stderr } = await execute(args);
  if (exitCode === 2) throw new BridgeError("data-error", stderr.trim() || "error de datos");
  try {
    return { exitCode, report: JSON.parse(stdout) };
  } catch {
    throw new BridgeError("data-error", `el CLI no devolvió JSON: ${stderr.trim() || "sin stderr"}`);
  }
}

// ---------------------------------------------------------------------------
// El almacén

/**
 * Las sesiones de un proceso. Cada una tiene su directorio de trabajo, que se
 * borra cuando sale —expulsada o al terminar el proceso—. La expulsión es por uso:
 * la que más tiempo lleva sin usarse sale primero.
 */
export function createSessionStore({ max = SESSIONS_MAX } = {}) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`SOFTSIGHT_SESSIONS_MAX tiene que ser un entero de 1 en adelante, no ${max}`);
  }
  const sessions = new Map();
  let opened = 0;
  const discard = (session) => removeWorkDir(session.workDir, session.kind === "model" ? session.input : null);
  const closeAll = () => {
    for (const session of sessions.values()) discard(session);
    sessions.clear();
  };
  process.once("exit", closeAll);
  return {
    nextId: () => `sesion-${(opened += 1)}`,
    add(session) {
      sessions.set(session.id, session);
      while (sessions.size > max) {
        const [oldest] = sessions.values();
        sessions.delete(oldest.id);
        discard(oldest);
      }
    },
    get(id) {
      const session = sessions.get(id);
      if (session === undefined) {
        throw new BridgeError(
          "session-not-found",
          `la sesión «${id}» no existe en este proceso: o no se abrió aquí o se expulsó para dejar sitio ` +
            `(caben ${max}). Ábrela otra vez con la misma entrada y las mismas opciones, y vuelve a aplicar ` +
            "tus parches en orden: si el stateHash coincide con el de tu última respuesta, estás donde estabas",
        );
      }
      // Usarla la pone al final de la cola de expulsión.
      sessions.delete(id);
      sessions.set(id, session);
      return session;
    },
    closeAll,
  };
}

// ---------------------------------------------------------------------------
// Las sesiones

function patchFile(session, index) {
  return join(session.workDir, `parche-${index}.json`);
}

function stateHash(session) {
  const state = {
    kind: session.kind,
    input: session.inputSha256,
    settings: session.settings,
    inspectOnly: session.inspectOnly,
    patches: session.patches,
  };
  return `sha256:${sha256(canonical(state))}`;
}

function describe(session) {
  return {
    id: session.id,
    kind: session.kind,
    turn: session.turn,
    patches: session.patches.length,
    stateHash: stateHash(session),
  };
}

/**
 * Un turno: el CLI con la lista entera y el turno anterior como referencia.
 *
 * **No toca la sesión**: devuelve el informe y `commit`, y quien llama confirma
 * cuando ya no queda nada que pueda fallar —la proyección de la respuesta
 * incluida—. Si no, una errata en `fields` dejaría la sesión un turno por delante
 * de lo que el agente cree, que es justo la cuenta que la sesión existe para
 * llevar bien.
 */
async function reviewTurn(session, patches, execute) {
  const turn = session.last === null ? 0 : session.turn + 1;
  const args = [session.kind === "model" ? "--model" : "--scene", session.input];
  patches.forEach((_, index) => args.push("--patch", patchFile(session, index)));
  if (session.last !== null) {
    args.push("--baseline-report", session.last.reportPath);
    if (session.last.sheetPath !== null) args.push("--baseline", session.last.sheetPath);
  }
  const sheetName = `pliego-${turn}.png`;
  if (session.inspectOnly) args.push("--inspect-only", "true");
  else args.push("--out", join(session.workDir, sheetName));
  args.push(...session.flags);

  const sheetPath = session.inspectOnly ? null : join(session.workDir, sheetName);
  let exitCode;
  let report;
  try {
    ({ exitCode, report } = await runCli(execute, args));
  } catch (error) {
    if (sheetPath !== null) rmSync(sheetPath, { force: true });
    throw error;
  }
  const reportPath = join(session.workDir, `informe-${turn}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report)}\n`);

  return {
    exitCode,
    report,
    /** El pliego de este turno, para la respuesta, antes de confirmar nada. */
    artifacts: () =>
      sheetPath === null ? [] : [readArtifact(session.workDir, sheetName, "image/png", "contact-sheet.png")],
    commit() {
      // El turno anterior ya no hace falta: el siguiente se compara contra éste.
      if (session.last !== null) {
        rmSync(session.last.reportPath, { force: true });
        if (session.last.sheetPath !== null) rmSync(session.last.sheetPath, { force: true });
      }
      session.turn = turn;
      session.patches = patches;
      session.last = { report, reportPath, sheetPath };
    },
    discard() {
      rmSync(reportPath, { force: true });
      if (sheetPath !== null) rmSync(sheetPath, { force: true });
    },
  };
}

/**
 * La respuesta de un turno, y solo entonces el turno cuenta. La proyección y el
 * pliego se preparan **antes** de confirmar: si algo de eso falla, la sesión se
 * queda en el turno anterior y el agente recibe el error.
 */
function finishTurn(request, session, result, projection, onCommit = () => {}) {
  let reportView;
  let artifacts;
  try {
    reportView = view(result.report, projection);
    artifacts = result.artifacts();
  } catch (error) {
    result.discard();
    throw error;
  }
  result.commit();
  onCommit();
  return {
    bridgeContractVersion: request.bridgeContractVersion,
    command: request.command,
    exitCode: result.exitCode,
    report: reportView,
    artifacts,
    session: describe(session),
  };
}

function sessionId(request) {
  if (typeof request.session !== "string" || request.session === "") {
    throw invalid("falta session: el identificador que devolvió sessionOpen");
  }
  return request.session;
}

async function open(request, execute, store) {
  const input = readInput(request.files);
  const { settings, projection, local } = splitOptions(request.options, { settings: true, local: ["inspectOnly"] });
  if (local.inspectOnly !== undefined && typeof local.inspectOnly !== "boolean") {
    throw invalid("inspectOnly debe ser booleano");
  }
  const flags = parseOptions(settings);
  const workDir = mkdtempSync(join(tmpdir(), "softsight-sesion-"));
  const session = {
    id: store.nextId(),
    kind: input.kind,
    workDir,
    input: inputPathIn(workDir, input.name),
    inputName: input.name,
    inputSha256: sha256(input.bytes),
    settings,
    flags,
    inspectOnly: local.inspectOnly === true,
    patches: [],
    // Cuántos parches entraron en cada `sessionApply`: deshacer quita los de la
    // última llamada, no el último parche suelto.
    stack: [],
    turn: 0,
    last: null,
  };
  try {
    writeInput(session.input, input.bytes);
    const result = await reviewTurn(session, [], execute);
    const response = finishTurn(request, session, result, projection);
    // Se registra cuando ya hay respuesta: una sesión cuyo turno 0 falló no
    // existe, y su identificador no se devuelve a nadie.
    store.add(session);
    return response;
  } catch (error) {
    removeWorkDir(workDir, session.kind === "model" ? session.input : null);
    throw error;
  }
}

async function apply(request, execute, store) {
  const session = store.get(sessionId(request));
  if (!isPlainObject(request.files) || Object.keys(request.files).some((slot) => slot !== "patches")) {
    throw invalid("sessionApply recibe files: { patches: [...] }");
  }
  const added = readPatches(request.files.patches, "patches");
  const { projection } = splitOptions(request.options, { settings: false });

  const before = session.patches.length;
  const next = [...session.patches, ...added];
  for (let index = before; index < next.length; index += 1) {
    writeFileSync(patchFile(session, index), `${JSON.stringify(next[index])}\n`);
  }
  try {
    const result = await reviewTurn(session, next, execute);
    return finishTurn(request, session, result, projection, () => session.stack.push(added.length));
  } catch (error) {
    for (let index = before; index < next.length; index += 1) rmSync(patchFile(session, index), { force: true });
    throw error;
  }
}

async function undo(request, execute, store) {
  const session = store.get(sessionId(request));
  if (request.files !== undefined) throw invalid("sessionUndo no recibe ficheros");
  const { projection } = splitOptions(request.options, { settings: false });
  if (session.stack.length === 0) {
    throw invalid(`no hay nada que deshacer: ${session.id} está como se abrió`);
  }
  const count = session.stack[session.stack.length - 1];
  const kept = session.patches.length - count;
  const result = await reviewTurn(session, session.patches.slice(0, kept), execute);
  return finishTurn(request, session, result, projection, () => {
    session.stack.pop();
    for (let index = kept; index < kept + count; index += 1) rmSync(patchFile(session, index), { force: true });
  });
}

const EXPORT_TYPES = { glb: "model/gltf-binary", obj: "model/obj" };

async function exportSession(request, execute, store) {
  const session = store.get(sessionId(request));
  if (request.files !== undefined) throw invalid("sessionExport no recibe ficheros");
  const { projection, local } = splitOptions(request.options, { settings: false, local: ["format"] });
  const format = local.format ?? "glb";
  if (!(format in EXPORT_TYPES)) throw invalid(`format tiene que ser ${Object.keys(EXPORT_TYPES).join(" o ")}`);

  // Con el nombre de la entrada, para que lo exportado se llame como lo que se abrió.
  const stem = session.kind === "model" ? session.inputName.replace(/\.[^.]+$/, "") : "escena";
  const exportFile = `exportado-${stem}.${format}`;
  const args = [session.kind === "model" ? "--model" : "--scene", session.input];
  session.patches.forEach((_, index) => args.push("--patch", patchFile(session, index)));
  args.push("--inspect-only", "true", "--export", join(session.workDir, exportFile));
  if (session.kind === "scene") args.push("--save-scene", join(session.workDir, "exportado-escena.json"));
  args.push(...session.flags);

  try {
    const { exitCode, report } = await runCli(execute, args);
    const artifacts = [readArtifact(session.workDir, exportFile, EXPORT_TYPES[format], `${stem}.${format}`)];
    if (session.kind === "scene") {
      artifacts.push(readArtifact(session.workDir, "exportado-escena.json", "application/json", "escena.json"));
    }
    // La lista que reproduce el estado: con ella y la entrada, cualquiera llega al
    // mismo sitio por el CLI, sin la sesión.
    const state = { stateHash: stateHash(session), patches: session.patches };
    artifacts.push({
      name: "parches.json",
      mimeType: "application/json",
      data: Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8").toString("base64"),
    });
    return {
      bridgeContractVersion: request.bridgeContractVersion,
      command: request.command,
      exitCode,
      report: view(report, projection),
      artifacts,
      session: describe(session),
    };
  } finally {
    rmSync(join(session.workDir, exportFile), { force: true });
    rmSync(join(session.workDir, "exportado-escena.json"), { force: true });
  }
}

// ---------------------------------------------------------------------------
// El barrido

/**
 * Las variantes. Cada una varía **una** cosa sobre la base: una lista de parches,
 * o un reparto de la malla en piezas (encargo 05-A). No se mezclan en un barrido:
 * un informe de revisión y uno de reparto no tienen criterios en común que cruzar.
 */
function readVariants(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw invalid("variants debe ser una lista no vacía de { name?, patches } o { name?, partition }");
  }
  if (variants.length > MAX_SWEEP_VARIANTS) {
    throw invalid(`un barrido admite como mucho ${MAX_SWEEP_VARIANTS} variantes; parte la búsqueda en varios`);
  }
  const names = new Set(["base"]);
  const parsed = variants.map((variant, index) => {
    if (!isPlainObject(variant)) throw invalid(`variants[${index}] debe ser un objeto { name?, patches | partition }`);
    const unknown = Object.keys(variant).filter((key) => !["name", "patches", "partition"].includes(key));
    if (unknown.length > 0) throw invalid(`variants[${index}]: clave desconocida ${unknown[0]}`);
    if (("patches" in variant) === ("partition" in variant)) {
      throw invalid(`variants[${index}] necesita patches o partition, uno de los dos`);
    }
    const name = variant.name ?? `variante-${index + 1}`;
    if (typeof name !== "string" || name === "") throw invalid(`variants[${index}].name debe ser una cadena no vacía`);
    if (names.has(name)) {
      throw invalid(
        `variants[${index}]: el nombre «${name}» ${name === "base" ? "es el de la base" : "está repetido"}`,
      );
    }
    names.add(name);
    return "partition" in variant
      ? { name, kind: "partition", partition: readDocument(variant.partition, `variants[${index}].partition`) }
      : { name, kind: "patches", patches: readPatches(variant.patches, `variants[${index}].patches`) };
  });
  if (new Set(parsed.map((variant) => variant.kind)).size > 1) {
    throw invalid("un barrido varía una sola cosa: todas las variantes con patches, o todas con partition");
  }
  return parsed;
}

function readCriteria(criteria) {
  if (criteria === undefined) return [];
  if (!Array.isArray(criteria)) throw invalid("criteria debe ser una lista de { field, direction }");
  return criteria.map((criterion, index) => {
    const malformed =
      !isPlainObject(criterion) ||
      typeof criterion.field !== "string" ||
      criterion.field === "" ||
      !DIRECTIONS.has(criterion.direction) ||
      Object.keys(criterion).some((key) => key !== "field" && key !== "direction");
    if (malformed) {
      throw invalid(`criteria[${index}] necesita { field, direction }, con direction ${[...DIRECTIONS].join(" o ")}`);
    }
    return { field: criterion.field, direction: criterion.direction };
  });
}

async function sweep(request, execute) {
  const input = readInput(request.files);
  const { settings, projection, local } = splitOptions(request.options, { settings: true, local: ["inspectOnly"] });
  if (local.inspectOnly !== undefined && typeof local.inspectOnly !== "boolean") {
    throw invalid("inspectOnly debe ser booleano");
  }
  // Por defecto sin pliego: un barrido busca números, y K renders son K veces el
  // coste de la llamada cara.
  const inspectOnly = local.inspectOnly ?? true;
  // Y por defecto las filas son el resumen: K informes enteros no los lee nadie.
  const rowProjection =
    projection.fields === undefined && projection.summary === undefined ? { summary: true } : projection;
  const flags = parseOptions(settings);
  const variants = readVariants(request.variants);
  const criteria = readCriteria(request.criteria);
  if (variants[0].kind === "partition") {
    return sweepPartitions(request, execute, { input, variants, criteria, projection, flags });
  }

  const workDir = mkdtempSync(join(tmpdir(), "softsight-barrido-"));
  const inputPath = inputPathIn(workDir, input.name);
  try {
    writeInput(inputPath, input.bytes);
    const reviewOne = async (tag, patches, reference) => {
      const args = [input.kind === "model" ? "--model" : "--scene", inputPath];
      patches.forEach((patch, index) => {
        const file = join(workDir, `${tag}-parche-${index}.json`);
        writeFileSync(file, `${JSON.stringify(patch)}\n`);
        args.push("--patch", file);
      });
      if (reference !== null) {
        args.push("--baseline-report", reference.reportPath);
        if (reference.sheetPath !== null) args.push("--baseline", reference.sheetPath);
      }
      const sheetPath = join(workDir, `${tag}.png`);
      if (inspectOnly) args.push("--inspect-only", "true");
      else args.push("--out", sheetPath);
      args.push(...flags);
      return { ...(await runCli(execute, args)), sheetPath: inspectOnly ? null : sheetPath };
    };

    const base = await reviewOne("base", [], null);
    const reference = { reportPath: join(workDir, "base.json"), sheetPath: base.sheetPath };
    writeFileSync(reference.reportPath, `${JSON.stringify(base.report)}\n`);
    // Los criterios y la proyección se comprueban contra la base **antes** de
    // gastar una sola variante: una errata se sabe en una revisión, no en sesenta.
    for (const criterion of criteria) {
      try {
        criterionValue(base.report, criterion.field, "base");
      } catch (error) {
        throw new BridgeError("data-error", error instanceof Error ? error.message : String(error));
      }
    }
    const baseRow = view(base.report, rowProjection);

    const rows = [];
    const entries = [{ name: "base", report: base.report }];
    const excluded = [];
    for (const [index, variant] of variants.entries()) {
      try {
        const result = await reviewOne(`v${index}`, variant.patches, reference);
        rows.push({ name: variant.name, exitCode: result.exitCode, row: view(result.report, rowProjection) });
        entries.push({ name: variant.name, report: result.report });
      } catch (error) {
        // Una variante que no se pudo revisar no es una variante peor: no se midió.
        // Sale con su motivo y fuera del cruce, y las demás siguen.
        if (!(error instanceof BridgeError) || error.code !== "data-error") throw error;
        rows.push({ name: variant.name, error: error.message });
        excluded.push({ candidate: variant.name, reason: "ERROR_DE_DATOS" });
      }
    }

    let comparison;
    try {
      comparison = compareSweep(entries, criteria);
    } catch (error) {
      throw new BridgeError("data-error", error instanceof Error ? error.message : String(error));
    }
    return {
      bridgeContractVersion: request.bridgeContractVersion,
      command: "sweep",
      // El barrido es una medida, no un modelo con defectos: cada fila trae el
      // código de salida de su revisión, y el del barrido es 0 si se pudo hacer.
      exitCode: 0,
      report: {
        contractVersion: base.report.contractVersion,
        documentType: "softsight.sweep",
        base: { exitCode: base.exitCode, row: baseRow },
        variants: rows,
        compared: comparison.compared,
        excluded,
        criteria: comparison.criteria,
        verdict: comparison.verdict,
        ...(comparison.reason === undefined ? {} : { reason: comparison.reason }),
        frontier: comparison.frontier,
      },
      artifacts: [],
    };
  } finally {
    removeWorkDir(workDir, input.kind === "model" ? inputPath : null);
  }
}

/**
 * El barrido de repartos: la misma malla partida de K maneras, y cada reparto
 * auditado por `--partition`. Es lo que pide la cabecera de `meshPartition.ts`
 * —«probar cien combinaciones de parámetros y quedarse con la mejor, sin ver
 * ninguna»—, y el criterio natural es `cut.length`, el borde total que abre el
 * corte.
 *
 * Dos diferencias con el de revisiones, y las dos salen de qué se compara. **No
 * hay base**: la malla sin repartir no tiene un informe de reparto contra el que
 * medir, así que el cruce es solo entre variantes. Y **las filas van enteras por
 * defecto**: un informe de reparto es corto, y su resumen —`contractVersion` y
 * `warnings`— no dice nada del corte.
 */
async function sweepPartitions(request, execute, { input, variants, criteria, projection, flags }) {
  if (input.kind !== "model") {
    throw invalid("un barrido de repartos necesita model: se reparte una malla, no una escena");
  }
  const workDir = mkdtempSync(join(tmpdir(), "softsight-barrido-"));
  const inputPath = inputPathIn(workDir, input.name);
  try {
    writeInput(inputPath, input.bytes);
    const rows = [];
    const entries = [];
    const excluded = [];
    for (const [index, variant] of variants.entries()) {
      const file = join(workDir, `v${index}-reparto.json`);
      writeFileSync(file, `${JSON.stringify(variant.partition)}\n`);
      try {
        const { exitCode, report } = await runCli(execute, ["--model", inputPath, "--partition", file, ...flags]);
        rows.push({ name: variant.name, exitCode, row: view(report, projection) });
        entries.push({ name: variant.name, report });
      } catch (error) {
        if (!(error instanceof BridgeError) || error.code !== "data-error") throw error;
        rows.push({ name: variant.name, error: error.message });
        excluded.push({ candidate: variant.name, reason: "ERROR_DE_DATOS" });
      }
    }
    let comparison;
    try {
      comparison = compareSweep(entries, criteria);
    } catch (error) {
      throw new BridgeError("data-error", error instanceof Error ? error.message : String(error));
    }
    return {
      bridgeContractVersion: request.bridgeContractVersion,
      command: "sweep",
      exitCode: 0,
      report: {
        contractVersion: entries[0]?.report.contractVersion ?? null,
        documentType: "softsight.sweep",
        base: null,
        variants: rows,
        compared: comparison.compared,
        excluded,
        criteria: comparison.criteria,
        verdict: comparison.verdict,
        ...(comparison.reason === undefined ? {} : { reason: comparison.reason }),
        frontier: comparison.frontier,
      },
      artifacts: [],
    };
  } finally {
    removeWorkDir(workDir, inputPath);
  }
}

/** La entrada desde el puente. */
export async function runSessionCommand(request, execute, sessions) {
  if (request.command === "sweep") return sweep(request, execute);
  if (sessions === null || sessions === undefined) {
    throw invalid(
      "las sesiones viven en un proceso residente —`agent3d --serve` o el servidor MCP—: el puente de un " +
        "disparo muere al contestar y se llevaría la sesión con él",
    );
  }
  if (request.command === "sessionOpen") return open(request, execute, sessions);
  if (request.command === "sessionApply") return apply(request, execute, sessions);
  if (request.command === "sessionUndo") return undo(request, execute, sessions);
  return exportSession(request, execute, sessions);
}
