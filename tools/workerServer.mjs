#!/usr/bin/env node
/**
 * El puente local a través de la red: el mismo contrato JSON que bridge.mjs,
 * servido por HTTP para que los agentes apunten a un worker remoto (Colab detrás
 * de un túnel) sin cambiar ni la forma de la petición ni la de la respuesta.
 *
 * Una petición es el mismo JSON que iría por stdin del puente:
 *
 *   { "bridgeContractVersion": 1, "command": "render",
 *     "files": { "model": { "name": "dron.glb", "data": "<base64>" } },
 *     "options": { ... } }
 *
 * La respuesta es exactamente lo que el puente imprime en stdout. Quien hoy
 * lanza `node tools/bridge.mjs` y le escribe JSON puede apuntar a este servidor
 * cambiando el transporte y nada más: el servidor delega en bridge.mjs por job,
 * así el contrato no puede divergir.
 *
 * LA ESCALA ES POR PROCESOS, no por GPU: SoftSight renderiza por CPU y un
 * `bridge.mjs` es un sandbox de una petición (un proceso Node de un solo hilo).
 * El pool de WORKER_CONCURRENCY mide cuántos en paralelo; por defecto cabalga los
 * núcleos libres de la máquina: `min(8, núcleos - 1)`.
 *
 * LA CACHÉ DETERMINISTA: SoftSigue es determinista — misma petición, misma
 * respuesta — así que el servidor guarda la primera respuesta bajo SHA-256 de la
 * petición y las repetidas no tocan ni un proceso. La clave lleva el cuerpo
 * completo (command + files + options), con lo que no hay riesgo de cruzar
 * respuestas de configuraciones distintas. Es un LRU acotado por bytes
 * (WORKER_CACHE_MB). Los campos `file` / `exported` / `source` de los informes
 * apuntan a un sandbox efímero ya borrado: son basura también la primera vez.
 *
 *   GET  /health   estado: versión, pool, cola, métricas, caché, límites.
 *   POST /job      una petición del contrato; responde igual que el puente.
 *   POST /batch    { request: [...] } en el mismo pool, respuestas en orden.
 *
 * Si WORKER_ACCESS_TOKEN está definido, toda petición lleva `Authorization: Bearer`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(here, "bridge.mjs");
const BRIDGE_CONTRACT_VERSION = 1;

const PORT = Number(process.env.WORKER_PORT ?? 8000);
const HOST = process.env.WORKER_HOST ?? "127.0.0.1";
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(8, cpus().length - 1));
const REQUESTED_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? DEFAULT_CONCURRENCY);
const CONCURRENCY =
  Number.isInteger(REQUESTED_CONCURRENCY) && REQUESTED_CONCURRENCY >= 1
    ? Math.min(cpus().length, REQUESTED_CONCURRENCY)
    : DEFAULT_CONCURRENCY;
const ACCESS_TOKEN = process.env.WORKER_ACCESS_TOKEN ?? "";
const MAX_REQUEST_BYTES = Number(process.env.WORKER_MAX_REQUEST_MB ?? 32) * 1024 * 1024;
const MAX_RESPONSE_BYTES = Number(process.env.WORKER_MAX_RESPONSE_MB ?? 96) * 1024 * 1024;
const MAX_BATCH = Number(process.env.WORKER_MAX_BATCH ?? 100);
// El trabajo expira dentro del bridge (SOFTSIGHT_BRIDGE_TIMEOUT_MS); el colchón
// es el tope del HTTP para no dejar cliente y proceso colgados.
const BRIDGE_TIMEOUT_MS = Number(process.env.SOFTSIGHT_BRIDGE_TIMEOUT_MS ?? 120_000);
const HTTP_TIMEOUT_MS = BRIDGE_TIMEOUT_MS + 30_000;

const CACHE_ENABLED = process.env.WORKER_CACHE === undefined || process.env.WORKER_CACHE !== "0";
const CACHE_MAX_BYTES = Number(process.env.WORKER_CACHE_MB ?? 64) * 1024 * 1024;
const cache = new Map(); // clave sha256 -> { size, exitCode, body }
let cacheBytes = 0;

const pool = { pending: [], running: 0, order: 0 };
const metrics = { jobs: 0, cacheHits: 0, cacheMisses: 0, errors: 0, startedAt: Date.now() };

function poolState() {
  return { running: pool.running, queued: pool.pending.length, concurrency: CONCURRENCY };
}

function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

function sendJSON(response, status, body) {
  const serialized = `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(serialized);
}

function sendPlain(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(`${message}\n`);
}

function isAuthorized(request) {
  if (!ACCESS_TOKEN) return true;
  return (request.headers.authorization ?? "") === `Bearer ${ACCESS_TOKEN}`;
}

function wrapError(code, message) {
  return { bridgeContractVersion: BRIDGE_CONTRACT_VERSION, code, message };
}

class WorkerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Una línea por trabajo en stdout: el log del worker hace visible el coste. */
function logJob(entry) {
  process.stdout.write(`${JSON.stringify({ type: "job", ...entry, pool: poolState() })}\n`);
}

function cachePut(key, entry) {
  const size = Buffer.byteLength(JSON.stringify(entry.body));
  if (size > CACHE_MAX_BYTES) return; // no cabe ni una vez
  cache.delete(key);
  cache.set(key, { ...entry, size });
  cacheBytes += size;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).size;
    cache.delete(oldest);
  }
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit); // toque LRU
  return hit;
}

/** La puerta única al trabajo: caché determinista primero, pool después. */
async function dispatch(requestText, command) {
  const key = createHash("sha256").update(requestText).digest("hex");
  if (CACHE_ENABLED) {
    const hit = cacheGet(key);
    if (hit && hit.exitCode !== 2 && !(hit.body && typeof hit.body.code === "string")) {
      metrics.jobs += 1;
      metrics.cacheHits += 1;
      logJob({ command, ms: 0, exitCode: hit.exitCode, cached: true, bytes: hit.size });
      return { exitCode: hit.exitCode, body: hit.body, cached: true };
    }
  }
  const result = await enqueueToPool(requestText, command);
  metrics.jobs += 1;
  metrics.cacheMisses += 1;
  const cacheable = result.exitCode !== 2 && !(result.body && typeof result.body.code === "string");
  if (CACHE_ENABLED && cacheable) {
    const size = Buffer.byteLength(JSON.stringify(result.body));
    if (size <= CACHE_MAX_BYTES) {
      cache.set(key, { exitCode: result.exitCode, body: result.body, size });
      cacheBytes += size;
    }
    while (cacheBytes > CACHE_MAX_BYTES && cache.size > 1) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).size;
      cache.delete(oldest);
    }
  }
  return result;
}

function enqueueToPool(requestText, command) {
  return new Promise((resolveResult, reject) => {
    pool.pending.push({ requestText, command, resolve: resolveResult, reject, order: pool.order++ });
    pump();
  });
}

/** El mozo del pool: arranca un trabajo por hueco libre, en orden de llegada. */
function pump() {
  while (pool.running < CONCURRENCY && pool.pending.length > 0) {
    const job = pool.pending.shift();
    pool.running += 1;
    runBridgeJob(job)
      .then((result) => {
        pool.running -= 1;
        job.resolve(result);
      })
      .catch((error) => {
        pool.running -= 1;
        metrics.errors += 1;
        job.reject(error);
      })
      .finally(() => pump());
  }
}

function runBridgeJob(job) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, SOFTSIGHT_BRIDGE_TIMEOUT_MS: String(BRIDGE_TIMEOUT_MS) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    const out = [];
    const err = [];
    let outBytes = 0;
    const started = performance.now();

    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      logJob({ command: job.command, ms: HTTP_TIMEOUT_MS, exitCode: 2, cached: false, error: "timeout" });
      reject(new WorkerError("worker-timeout", `el trabajo excedió el tope del HTTP (${HTTP_TIMEOUT_MS} ms)`));
    }, HTTP_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      outBytes += chunk.length;
      if (outBytes > MAX_RESPONSE_BYTES) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        logJob({
          command: job.command,
          ms: Math.round(performance.now() - started),
          exitCode: 2,
          cached: false,
          error: "response-too-large",
        });
        reject(new WorkerError("response-too-large", `la respuesta excede ${MAX_RESPONSE_BYTES} bytes`));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      metrics.errors += 1;
      reject(new WorkerError("worker-spawn-error", `no se pudo lanzar al puente: ${error.message}`));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Math.round(performance.now() - started);
      let body;
      try {
        body = JSON.parse(Buffer.concat(out).toString("utf8"));
      } catch {
        logJob({ command: job.command, ms, exitCode: 2, cached: false, error: "bad-response" });
        reject(new WorkerError("worker-bad-response", `el puente no devolvió JSON: ${Buffer.concat(err).toString("utf8")}`));
        return;
      }
      logJob({ command: job.command, ms, exitCode, cached: false, bytes: outBytes });
      resolveResult({ exitCode, body, ms });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(job.requestText);
  });
}

function statusForError(error) {
  return error?.code === "worker-timeout" ? 504 : 500;
}

function readBody(request) {
  return new Promise((resolveResult, reject) => {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      request.destroy();
      reject(new WorkerError("request-too-large", `Content-Length ${declared} excede ${MAX_REQUEST_BYTES} bytes`));
      return;
    }
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        request.destroy();
        reject(new WorkerError("request-too-large", `la petición excede ${MAX_REQUEST_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveResult(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleJob(response, request) {
  let text;
  try {
    text = await readBody(request);
  } catch (error) {
    sendJSON(response, statusForError(error), wrapError(error.code, error.message));
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    sendJSON(response, 400, wrapError("invalid-request", "el cuerpo no es JSON válido"));
    return;
  }
  if (parsed.bridgeContractVersion !== BRIDGE_CONTRACT_VERSION) {
    sendJSON(response, 400, wrapError("invalid-request", `bridgeContractVersion ${BRIDGE_CONTRACT_VERSION} es obligatoria`));
    return;
  }
  const command = typeof parsed.command === "string" ? parsed.command : "?";
  try {
    const result = await dispatch(text, command);
    if (result.exitCode === 2 && result.body && typeof result.body.code === "string") {
      sendJSON(response, 400, result.body);
      return;
    }
    sendJSON(response, 200, result.body);
  } catch (error) {
    sendJSON(response, statusForError(error), wrapError(error.code, error.message));
  }
}

async function handleBatch(response, request) {
  let text;
  try {
    text = await readBody(request);
  } catch (error) {
    sendJSON(response, statusForError(error), wrapError(error.code, error.message));
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    sendJSON(response, 400, wrapError("invalid-request", "el cuerpo no es JSON válido"));
    return;
  }
  if (!Array.isArray(parsed.request) || parsed.request.length === 0) {
    sendJSON(response, 400, wrapError("invalid-request", "/batch necesita request: lista no vacía de peticiones"));
    return;
  }
  if (parsed.request.length > MAX_BATCH) {
    sendJSON(response, 400, wrapError("batch-too-large", `batch excede ${MAX_BATCH} peticiones`));
    return;
  }
  const results = await Promise.all(
    parsed.request.map(async (entry) => {
      if (typeof entry !== "object" || entry === null || entry.bridgeContractVersion !== BRIDGE_CONTRACT_VERSION) {
        return wrapError("invalid-request", "cada petición del batch necesita bridgeContractVersion 1");
      }
      try {
        const result = await dispatch(`${JSON.stringify(entry)}\n`, typeof entry.command === "string" ? entry.command : "?");
        if (result.exitCode === 2 && result.body && typeof result.body.code === "string") return result.body;
        return result.body;
      } catch (error) {
        return wrapError(error.code, error.message);
      }
    }),
  );
  sendJSON(response, 200, { bridgeContractVersion: BRIDGE_CONTRACT_VERSION, request: parsed.request.length, results });
}

async function main() {
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/health" && request.method === "GET") {
      if (!isAuthorized(request)) {
        sendPlain(response, 401, "no autorizado");
        return;
      }
      sendJSON(response, 200, {
        status: "ok",
        service: "softsight-worker",
        version: packageVersion(),
        contractVersion: BRIDGE_CONTRACT_VERSION,
        pool: poolState(),
        metrics: { ...metrics, uptimeMilliseconds: Date.now() - metrics.startedAt },
        cache: { enabled: CACHE_ENABLED, entries: cache.size, maxBytes: CACHE_MAX_BYTES },
        limits: {
          maxRequestBytes: MAX_REQUEST_BYTES,
          maxResponseBytes: MAX_RESPONSE_BYTES,
          maxBatch: MAX_BATCH,
          timeoutMilliseconds: HTTP_TIMEOUT_MS,
        },
      });
      return;
    }

    if (request.method !== "POST") {
      sendPlain(response, 405, "solo GET /health y POST /job o /batch");
      return;
    }
    if (!isAuthorized(request)) {
      sendPlain(response, 401, "no autorizado");
      return;
    }
    if (request.url === "/job") {
      await handleJob(response, request);
      return;
    }
    if (request.url === "/batch") {
      await handleBatch(response, request);
      return;
    }
    sendPlain(response, 404, "no encontrado");
  });

  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "listening",
          ...poolState(),
          url: `http://${HOST}:${PORT}`,
          access: ACCESS_TOKEN ? "token requerido (Authorization: Bearer)" : "sin token",
          cache: CACHE_ENABLED ? `on, max ${CACHE_MAX_BYTES} bytes` : "off",
          bridgeTimeoutMilliseconds: BRIDGE_TIMEOUT_MS,
          endpoints: "GET /health, POST /job, POST /batch",
        },
        null,
        2,
      )}\n`,
    );
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});