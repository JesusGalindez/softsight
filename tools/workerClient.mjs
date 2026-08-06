#!/usr/bin/env node
/**
 * Cliente del worker de SoftSight: la misma petición que iría por stdin de
 * bridge.mjs, enviada por HTTP al worker remoto (Colab tras un túnel) y
 * recibiendo exactamente la misma respuesta.
 *
 * Uso como librería (lo que un agente importaría en vez de lanzar bridge.mjs):
 *
 *   import { postJob, postBatch, workerHealth } from "./workerClient.mjs";
 *   const { statusCode, body } = await postJob(url, request, { token });
 *
 * Uso como CLI para probar y para tandas:
 *
 *   node tools/workerClient.mjs --url <base> [--token <t>] [--batch] peticion.json...
 *
 * Las peticiones pueden traer en cada fichero un campo `path` en vez de `data`:
 * el cliente lo lee, lo codifica en base64 y lo envía. Así se escribe una
 * petición a mano mirando el modelo, en vez de pegar un GLB dentro del JSON.
 *
 * Código de salida, igual que el puente local: 0 limpio, 1 con avisos, 2 error.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BRIDGE_CONTRACT_VERSION = 1;

/** Resuelve las rutas locales de una petición antes de enviarla. */
export function expandRequest(request) {
  if (typeof request !== "object" || request === null) return request;
  if (request.files && typeof request.files === "object") {
    const files = {};
    for (const [slot, payload] of Object.entries(request.files)) {
      if (Array.isArray(payload)) {
        files[slot] = payload.map((entry) => expandPayload(entry));
        continue;
      }
      files[slot] = expandPayload(payload);
    }
    return { ...request, files };
  }
  if (request.batch && Array.isArray(request.batch)) {
    return { ...request, batch: request.batch.map((entry) => expandRequest(entry)) };
  }
  return request;
}

function expandPayload(payload) {
  if (typeof payload !== "object" || payload === null) return payload;
  if (payload.data !== undefined || payload.path === undefined) return payload;
  const bytes = readFileSync(resolve(payload.path));
  return { ...payload, path: undefined, data: Buffer.from(bytes).toString("base64") };
}

/** Lanza una petición y devuelve { status, body }; body es la respuesta del puente. */
export async function postJob(baseUrl, request, { token, timeoutMs = 300_000 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/job`, {
    method: "POST",
    headers,
    body: `${JSON.stringify(expandRequest(request))}\n`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await readBody(response) };
}

/** Tanda de peticiones en el mismo pool; cada entrada responde igual que el puente. */
export async function postBatch(baseUrl, requests, { token, timeoutMs = 600_000 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/batch`, {
    method: "POST",
    headers,
    body: `${JSON.stringify({ batch: requests.map((entry) => expandRequest(entry)) })}\n`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await readBody(response) };
}

/** Estado del worker: versión, pool, cola y límites. */
export async function workerHealth(baseUrl, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, { headers });
  return { status: response.status, body: await readBody(response) };
}

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: `http-${response.status}`, message: text.trim() || "respuesta vacía" };
  }
}

function isError(body) {
  return body && typeof body === "object" && typeof body.code === "string" && body.exitCode === undefined;
}

function jobScore(body) {
  if (isError(body)) return 2;
  return typeof body?.exitCode === "number" && body.exitCode >= 1 ? 1 : 0;
}

function printResponse(result, label) {
  const { status, body } = result;
  const errored = status >= 400 || isError(body);
  const warning = !errored && body && typeof body === "object" && body.exitCode === 1;
  process.stdout.write(
    `${JSON.stringify({ label, httpStatus: status, ok: !warning && !errored, body }, null, 2)}\n`,
  );
  return warning ? 1 : errored ? 2 : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = { url: null, token: null, batch: false };
  const files = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--url") {
      args.url = argv[index + 1];
      index += 1;
    } else if (flag === "--token") {
      args.token = argv[index + 1];
      index += 1;
    } else if (flag === "--batch") args.batch = true;
    else if (flag === "--help") {
      process.stdout.write(`worker — cliente del worker de SoftSight.

  node tools/workerClient.mjs --url <base> [--token <t>] [--batch] peticion.json...
  node tools/workerClient.mjs --url <base> --health

Las peticiones son las de bridge.mjs; sus ficheros admiten "path" (se leen
localmente) en vez de "data" base64. Sin fichero, lee la petición de stdin.

Salida y código de salida como el puente: 0 limpio, 1 con avisos, 2 error.\n`);
      return;
    } else if (flag === "--health") args.health = true;
    else if (flag === "-" || !flag.startsWith("-")) {
      files.push(flag);
    }
  }
  const url = args.url ?? process.env.SOFTSIGHT_WORKER_URL;
  if (!url) {
    process.stderr.write(`falta --url (o la variable SOFTSIGHT_WORKER_URL)\n`);
    process.exitCode = 2;
    return;
  }
  const token = args.token ?? process.env.SOFTSIGHT_WORKER_TOKEN ?? "";

  if (args.health) {
    const result = await workerHealth(url, { token });
    process.stdout.write(`${JSON.stringify({ httpStatus: result.status, body: result.body }, null, 2)}\n`);
    process.exitCode = result.status === 200 ? 0 : 2;
    return;
  }

  let requests;
  const fromStdin = files.length === 0 || (files.length === 1 && files[0] === "-");
  if (fromStdin) {
    const source = readFileSync(0, "utf8");
    if (!source.trim()) {
      process.stderr.write(`no hay petición: pasa un fichero por argumento o envía JSON por stdin\n`);
      process.exitCode = 2;
      return;
    }
    requests = [JSON.parse(source)];
  } else {
    requests = files.map((path) => JSON.parse(readFileSync(resolve(path), "utf8")));
  }

  if (args.batch) {
    const result = await postBatch(url, requests, { token });
    process.stdout.write(
      `${JSON.stringify({ httpStatus: result.status, body: result.body }, null, 2)}\n`,
    );
    const errored = result.status >= 400;
    const items = Array.isArray(result.body?.results) ? result.body.results : [];
    const worst = items.reduce((acc, entry) => Math.max(acc, jobScore(entry)), errored ? 2 : 0);
    process.exitCode = worst;
    return;
  }

  let worst = 0;
  for (let index = 0; index < requests.length; index += 1) {
    const result = await postJob(url, requests[index], { token });
    const score = printResponse(result, `job-${index}`);
    worst = score > worst ? score : worst;
  }
  process.exitCode = worst;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}