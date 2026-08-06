#!/usr/bin/env node
/**
 * Smoke test end-to-end del worker HTTP (Fase D remoto).
 *
 * El worker debe servir el mismo contrato que el CLI: petición JSON igual por
 * stdin, respuesta igual por stdout, misma semántica de códigos. Este test lo
 * comprueba como caja negra —levanta el servidor en un puerto libre, llama por
 * HTTP, y confronta la respuesta contra lo que dan el CLI y el puente con el
 * mismo modelo y las mismas opciones—, así que el test no puede necesitar
 * refactorizar el server para pasar.
 *
 * Se ejecuta con `npm run test:worker`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const WORKER = resolve(here, "workerServer.mjs");
const CLI = resolve(here, "agent3d.mjs");
const BRIDGE = resolve(here, "bridge.mjs");
// Fixture autónomo del repo: el GLB del dron que usa la tubería interna.
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");

const TOKEN = "clave-de-prueba";

/** Un puerto libre para el worker. */
function freePort() {
  return new Promise((resolveResult) => {
    const server = createTcpServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolveResult(port));
    });
  });
}

function spawnWorker(port) {
  return spawn(process.execPath, [WORKER], {
    env: {
      ...process.env,
      WORKER_PORT: String(port),
      WORKER_HOST: "127.0.0.1",
      WORKER_ACCESS_TOKEN: TOKEN,
      WORKER_CONCURRENCY: "2",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (response.status === 200) return;
    } catch {
      // el worker aún no escucha
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 200));
  }
  throw new Error("el worker no respondió a /health a tiempo");
}

/** POST /job y devuelve { status, body }; el body es el JSON exacto del puente. */
async function postJob(baseUrl, request, token) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/job`, {
    method: "POST",
    headers,
    body: `${JSON.stringify(request)}\n`,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { code: `http-${response.status}`, message: text.trim() };
  }
  return { status: response.status, body };
}

async function health(baseUrl) {
  const response = await fetch(`${baseUrl}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: response.status, body: await response.json() };
}

/** POST /batch y devuelve { status, body }. */
async function postBatch(baseUrl, requests, token) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/batch`, {
    method: "POST",
    headers,
    body: `${JSON.stringify({ request: requests })}\n`,
  });
  return { status: response.status, body: await response.json() };
}

/** Lanza el CLI directo y devuelve { exitCode, report }. */
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

/** Lanza el puente con una petición en stdin, como bridge.test.mjs. */
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
      resolveResult({ exitCode, response });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function filePayload(bytes) {
  return { name: "drone.glb", data: Buffer.from(bytes).toString("base64") };
}

console.log("worker: arrancando servidor de prueba");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const worker = spawnWorker(port);
await waitHealth(baseUrl);

try {
  console.log("worker: contrato publicado");
  {
    const { status, body } = await postJob(baseUrl, { bridgeContractVersion: 1, command: "schema" }, TOKEN);
    assert.equal(status, 200);
    assert.equal(body.bridgeContractVersion, 1);
    assert.equal(body.report.reportExample.contractVersion, 3);
  }

  console.log("worker: render del modelo vs CLI directo");
  const modelFile = filePayload(await readFile(MODEL));
  const renderRequest = {
    bridgeContractVersion: 1,
    command: "render",
    files: { model: modelFile },
    options: { tile: 120, ground: false },
  };
  const workDir = await mkdtemp(join(tmpdir(), "softsight-worker-test-"));
  const { status, body } = await postJob(baseUrl, renderRequest, TOKEN);
  assert.equal(status, 200);
  assert.equal(body.bridgeContractVersion, 1);
  assert.equal(body.command, "render");
  assert.ok(body.report, "el informe debe venir");
  assert.ok(body.artifacts.length === 1 && body.artifacts[0].name === "contact-sheet.png");

  const byView = body.report.renderHash?.byView ?? {};
  const hashes = Object.values(byView).filter((value) => typeof value === "string");
  assert.ok(hashes.length >= 2, "debe haber más de una vista");
  assert.equal(new Set(hashes).size, hashes.length, "cada vista debe tener huella distinta");

  const referencePng = join(workDir, "referencia.png");
  const cli = await runCli(["--model", MODEL, "--tile", "120", "--ground", "false", "--out", referencePng]);
  assert.equal(cli.exitCode, body.exitCode, "código de salida debe coincidir con el CLI");
  assert.deepEqual(body.report.warnings, cli.report.warnings, "avisos deben coincidir con el CLI");

  const referenceBytes = await readFile(referencePng);
  assert.equal(
    body.artifacts[0].data,
    Buffer.from(referenceBytes).toString("base64"),
    "el PNG del worker debe ser idéntico al del CLI",
  );

  console.log("worker: error de datos");
  {
    const { status, body: errorBody } = await postJob(baseUrl, { bridgeContractVersion: 1, command: "hack" }, TOKEN);
    assert.equal(status, 400);
    assert.equal(errorBody.code, "invalid-request");
  }

  console.log("worker: autenticación");
  {
    const { status } = await postJob(baseUrl, { bridgeContractVersion: 1, command: "schema" }, null);
    assert.equal(status, 401);
  }

  console.log("worker: caché determinista");
  {
    // Una petición nueva para esta sección: la anterior ya está en caché, así
    // que con elle no se podría distinguir miss de hit.
    const cacheRequest = {
      bridgeContractVersion: 1,
      command: "render",
      files: { model: modelFile },
      options: { tile: 96, ground: false },
    };
    const first = await postJob(baseUrl, cacheRequest, TOKEN);
    assert.equal(first.status, 200);
    const beforeSecond = await health(baseUrl);
    assert.equal(beforeSecond.body.metrics.cacheHits, 0, "la 1ª petición aún no puede ser un hit");

    const second = await postJob(baseUrl, cacheRequest, TOKEN);
    assert.equal(second.status, 200);
    assert.equal(JSON.stringify(second.body), JSON.stringify(first.body), "caché debe dar exactamente el mismo informe");
    const h = await health(baseUrl);
    assert.equal(h.body.metrics.cacheHits, 1, "la 2ª petición idéntica debe ser el único hit");
  }

  console.log("worker: puente, mismo request por stdin (transporte equivalente)");
  {
    const { exitCode, response } = await runBridge(renderRequest);
    assert.equal(exitCode, body.exitCode, "el puente local debe salir igual que el worker");
    assert.deepEqual(response.report.warnings, body.report.warnings);
  }

  console.log("worker: tanda (POST /batch con request: lista)");
  {
    const { status, body: batchBody } = await postBatch(
      baseUrl,
      [renderRequest, { ...renderRequest, options: { ...renderRequest.options, tile: 140 } }],
      TOKEN,
    );
    assert.equal(status, 200);
    assert.equal(batchBody.bridgeContractVersion, 1);
    assert.equal(batchBody.request, 2);
    assert.ok(Array.isArray(batchBody.results) && batchBody.results.length === 2);
    for (const entry of batchBody.results) {
      assert.equal(entry.command, "render");
      assert.ok(entry.report, "cada entrada del lote debe traer su informe");
    }
  }
} finally {
  worker.kill("SIGKILL");
}

console.log("worker: test completo en verde");