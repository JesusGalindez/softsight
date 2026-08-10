/**
 * Smoke test end-to-end de la Fase D: el puente local.
 *
 * Criterio de salida: cada caso del gate por el puente da los mismos resultados
 * que el CLI directo, con el mismo código de salida. El fixture vive en el
 * proyecto hermano (igual que en sample-surface.test.mjs).
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:bridge`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { fixture, requireFixtures } from "./fixtures.mjs";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(here, "bridge.mjs");
const CLI = resolve(here, "agent3d.mjs");
// El fixture de salto (jumping-jacks) vive en el proyecto hermano After effect ThreeJS.
await requireFixtures("bridge", [
  "jumping-jacks.glb",
  "jumping-jacks-control-poses.json",
  "jumping-jacks-refs.json",
]);
const modelPath = fixture("jumping-jacks.glb");
const posesPath = fixture("jumping-jacks-control-poses.json");
const refsPath = fixture("jumping-jacks-refs.json");

const modelBytes = await readFile(modelPath);
const posesBytes = await readFile(posesPath);
const refsBytes = await readFile(refsPath);

/** Lanza el puente con una petición en stdin y devuelve { exitCode, response }. */
function runBridge(request, env = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [BRIDGE], { env: { ...process.env, ...env } });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      let response;
      try {
        response = JSON.parse(Buffer.concat(out).toString("utf8"));
      } catch {
        reject(new Error(`el puente no devolvió JSON: ${Buffer.concat(err).toString("utf8")}`));
        return;
      }
      resolveResult({ exitCode, response, stderr: Buffer.concat(err).toString("utf8") });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/**
 * Abre un `agent3d --serve` y devuelve con qué hablarle. Una respuesta por
 * línea, en el mismo orden que las peticiones, que es lo que promete NDJSON.
 */
function openResident() {
  const child = spawn(process.execPath, [CLI, "--serve"]);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    async send(request) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      const { value, done } = await iterator.next();
      if (done) throw new Error("el residente cerró stdout antes de responder");
      return JSON.parse(value);
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

/** Lanza el CLI directo y devuelve { exitCode, stdout } como JSON o null. */
async function runCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    return {
      exitCode: error.code,
      report: error.stdout ? JSON.parse(error.stdout) : null,
      stderr: error.stderr ? error.stderr.toString("utf8") : null,
    };
  }
}

function filePayload(name, bytes) {
  return { name, data: Buffer.from(bytes).toString("base64") };
}

function withoutFilePaths(report, source = undefined) {
  const copy = {
    ...report,
    sheet: report.sheet === null ? null : { ...report.sheet, totalMilliseconds: null },
    views: (report.views ?? []).map((view) => ({ ...view, milliseconds: null })),
  };
  for (const key of ["file", "exported", "undo"]) delete copy[key];
  if (source !== undefined) copy.source = source;
  return copy;
}

const modelFile = filePayload("jumping-jacks.glb", modelBytes);
const posesFile = filePayload("jumping-jacks-control-poses.json", posesBytes);
const refsFile = filePayload("jumping-jacks-refs.json", refsBytes);

console.log("puente: schema publicado");
{
  const { exitCode, response } = await runBridge({ bridgeContractVersion: 1, command: "schema" });
  assert.equal(exitCode, 0);
  assert.equal(response.bridgeContractVersion, 1);
  for (const key of ["scene", "patch", "sampleReference", "reportExample"]) {
    assert.ok(response.report[key], `el esquema publicado debe traer ${key}`);
  }
  assert.equal(response.report.reportExample.contractVersion, 3);
}

console.log("puente: inspect == CLI directo (informe nativo, poses certificadas)");
{
  const direct = await runCli(["--model", modelPath, "--control-poses", posesPath, "--inspect-only", "true", "--no-cache"]);
  const { exitCode, response } = await runBridge({
    bridgeContractVersion: 1,
    command: "inspect",
    files: { model: modelFile, controlPoses: posesFile },
    options: { noCache: true },
  });
  assert.equal(exitCode, 0);
  assert.equal(response.exitCode, direct.exitCode, "el puente debe espejar el código de salida del CLI");
  assert.deepEqual(withoutFilePaths(response.report, modelPath), withoutFilePaths(direct.report));
  assert.ok(response.report.controlPoses.length > 0, "inspect debe certificar las poses de control");
  assert.deepEqual(response.report.animationErrors, []);
}

console.log("puente: render == CLI directo (pliego y renderHash)");
{
  const direct = await runCli(["--model", modelPath, "--tile", "320", "--out", "/tmp/softsight-bridge-direct.png", "--no-cache"]);
  const { exitCode, response } = await runBridge({
    bridgeContractVersion: 1,
    command: "render",
    files: { model: modelFile },
    options: { tile: 320, noCache: true },
  });
  assert.equal(exitCode, 0);
  assert.equal(response.exitCode, direct.exitCode);
  assert.deepEqual(withoutFilePaths(response.report, modelPath), withoutFilePaths(direct.report));
  assert.ok(response.artifacts.length === 1 && response.artifacts[0].name === "contact-sheet.png");
  const directPng = await readFile("/tmp/softsight-bridge-direct.png");
  assert.deepEqual(Buffer.from(response.artifacts[0].data, "base64"), directPng, "el pliego del puente debe ser idéntico al del CLI");
}

console.log("puente: patch == CLI directo (parches + baseline → diff, undo)");
{
  const patch = { edits: [{ op: "translate", target: "Skinned Mesh 0", delta: [0.5, 0, 0] }] };
  const patchBytes = Buffer.from(`${JSON.stringify(patch)}\n`);
  const baselineBytes = await readFile("/tmp/softsight-bridge-direct.png");
  const baselineReportBytes = Buffer.from(`${JSON.stringify((await runCli(["--model", modelPath, "--tile", "320", "--out", "/tmp/softsight-bridge-baseline.png", "--no-cache"])).report)}\n`);
  await writeFile("/tmp/softsight-bridge-baseline.png", baselineBytes);
  await writeFile("/tmp/softsight-bridge-patch.json", patchBytes);
  await writeFile("/tmp/softsight-bridge-baseline-report.json", baselineReportBytes);

  const direct = await runCli([
    "--model", modelPath,
    "--patch", "/tmp/softsight-bridge-patch.json",
    "--baseline", "/tmp/softsight-bridge-baseline.png",
    "--baseline-report", "/tmp/softsight-bridge-baseline-report.json",
    "--undo", "/tmp/softsight-bridge-undo.json",
    "--out", "/tmp/softsight-bridge-patched.png",
    "--no-cache",
  ]);

  const { exitCode, response } = await runBridge({
    bridgeContractVersion: 1,
    command: "patch",
    files: {
      model: modelFile,
      patches: [filePayload("patch.json", patchBytes)],
      baseline: filePayload("baseline.png", baselineBytes),
      baselineReport: filePayload("baseline-report.json", baselineReportBytes),
    },
    options: { noCache: true },
  });
  assert.equal(exitCode, 0);
  assert.equal(response.exitCode, direct.exitCode);
  assert.deepEqual(withoutFilePaths(response.report, modelPath), withoutFilePaths(direct.report));
  assert.ok(response.report.edits?.[0]?.op === "translate" && !response.report.edits[0].error);
  assert.ok(response.report.diff, "patch con baseline debe traer diff");
  const undoArtifact = response.artifacts.find((artifact) => artifact.name === "undo.json");
  assert.ok(undoArtifact, "patch debe devolver undo.json");
  const directUndo = JSON.parse(await readFile("/tmp/softsight-bridge-undo.json", "utf8"));
  assert.deepEqual(JSON.parse(Buffer.from(undoArtifact.data, "base64")), directUndo);
}

console.log("puente: sample == CLI directo (referencias → hashes)");
{
  const direct = await runCli([
    "--model", modelPath, "--control-poses", posesPath,
    "--sample", refsPath, "--frames", "0,15,30,37", "--fps", "30",
    "--inspect-only", "true", "--no-cache",
  ]);
  const { exitCode, response } = await runBridge({
    bridgeContractVersion: 1,
    command: "sample",
    files: { model: modelFile, controlPoses: posesFile, references: refsFile },
    options: { frames: "0,15,30,37", fps: 30, noCache: true },
  });
  assert.equal(exitCode, 0);
  assert.equal(response.exitCode, direct.exitCode);
  assert.deepEqual(response.report.sample, direct.report.sample);
  assert.ok(response.report.sample.frames.every((entry) => entry.positionsHash.startsWith("sha256:")));
}

console.log("puente: errores de petición y de datos");
{
  const unknown = await runBridge({ bridgeContractVersion: 1, command: "hack" });
  assert.equal(unknown.exitCode, 2);
  assert.equal(unknown.response.code, "invalid-request");

  const unsafeName = await runBridge({
    bridgeContractVersion: 1,
    command: "inspect",
    files: { model: { name: "../etc/passwd", data: "eA==" } },
  });
  assert.equal(unsafeName.exitCode, 2);
  assert.equal(unsafeName.response.code, "invalid-file-name");

  const oversized = await runBridge(
    { bridgeContractVersion: 1, command: "inspect", files: { model: { name: "big.glb", data: "A".repeat(2_800_000) } } },
    { SOFTSIGHT_BRIDGE_MAX_FILE_MB: "1" },
  );
  assert.equal(oversized.exitCode, 2);
  assert.equal(oversized.response.code, "file-too-large");

  const badData = await runBridge({
    bridgeContractVersion: 1,
    command: "sample",
    files: { model: modelFile, references: refsFile },
    options: { frames: "0,abc", fps: 30 },
  });
  assert.equal(badData.exitCode, 2);
  assert.equal(badData.response.code, "data-error");
  assert.match(badData.response.message, /fotograma/);

  const failingEdit = await runBridge({
    bridgeContractVersion: 1,
    command: "patch",
    files: {
      model: modelFile,
      patches: [filePayload("bad.json", Buffer.from(`${JSON.stringify({ edits: [{ op: "translate", target: "NoExiste", delta: [1, 0, 0] }] })}\n`))],
    },
    options: { noCache: true },
  });
  assert.equal(failingEdit.exitCode, 1, "un parche fallido debe salir con 1, como el CLI");
  assert.equal(failingEdit.response.exitCode, 1);
  assert.equal(failingEdit.response.report.edits[0].error, "ningún nombre o ruta coincide con el patrón");
}

// La tercera columna: el mismo contrato por un proceso que no se muere. Es
// transporte y no contrato, así que la prueba de que está bien hecho es que no
// se distinga del puente de un disparo en ningún byte.
console.log("puente residente: mismo contrato, mismo informe");
{
  const resident = openResident();
  try {
    const casos = [
      { bridgeContractVersion: 1, command: "schema" },
      {
        bridgeContractVersion: 1,
        command: "inspect",
        files: { model: modelFile, controlPoses: posesFile },
        options: { noCache: true },
      },
      {
        bridgeContractVersion: 1,
        command: "render",
        files: { model: modelFile },
        options: { tile: 320, noCache: true },
      },
      // Y un error de datos, que también tiene que viajar igual por los dos.
      {
        bridgeContractVersion: 1,
        command: "sample",
        files: { model: modelFile, references: refsFile },
        options: { frames: "0,abc", fps: 30 },
      },
    ];
    // Las rutas del directorio de trabajo y los tiempos cambian en cada petición
    // por diseño —sandbox nuevo, reloj distinto—, así que se normalizan con el
    // mismo criterio que los casos de arriba. Todo lo demás tiene que coincidir
    // byte a byte, el pliego en base64 incluido.
    const comparable = (response) =>
      JSON.stringify(
        response.report?.source === undefined
          ? response
          : { ...response, report: withoutFilePaths(response.report, "<sandbox>") },
      );
    for (const caso of casos) {
      const { response: unDisparo } = await runBridge(caso);
      const enResidente = await resident.send(caso);
      assert.equal(
        comparable(enResidente),
        comparable(unDisparo),
        `${caso.command}: el residente no coincide con el puente por proceso`,
      );
    }
    console.log(`puente residente: ok (${casos.length} casos idénticos al puente por proceso)`);

    // El riesgo real de un proceso que no se muere: acumula estado, y el estado
    // es enemigo del determinismo. Veinte veces la misma petición contra el
    // mismo proceso; si algo se filtra entre peticiones, se ve aquí.
    const repetida = casos[2];
    const primera = comparable(await resident.send(repetida));
    for (let vuelta = 0; vuelta < 19; vuelta += 1) {
      assert.equal(
        comparable(await resident.send(repetida)),
        primera,
        `la petición ${vuelta + 2} no dio la misma respuesta que la primera`,
      );
    }
    const { renderHash } = JSON.parse(primera).report;
    console.log(`puente residente: ok (20 peticiones iguales, renderHash ${renderHash.sheet} quieto)`);
  } finally {
    resident.close();
  }
}

console.log("bridge: ok");
await rm("/tmp/softsight-bridge-direct.png", { force: true });
await rm("/tmp/softsight-bridge-baseline.png", { force: true });
await rm("/tmp/softsight-bridge-patch.json", { force: true });
await rm("/tmp/softsight-bridge-baseline-report.json", { force: true });
await rm("/tmp/softsight-bridge-undo.json", { force: true });
await rm("/tmp/softsight-bridge-patched.png", { force: true });
