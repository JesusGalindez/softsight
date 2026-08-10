/**
 * Test de la caché de modelo del puente: `SOFTSIGHT_BRIDGE_MODEL_CACHE`.
 *
 * El modelo es lo único que el agente no reescribe entre "edita la escena" →
 * "vuelve a revisar": el fichero es el mismo, y la caché lo persiste en un
 * directorio propio bajo el nombre `<sha256(contenido)>.ext`. La petición no
 * cambia, así que el puente se comporta igual con y sin la caché; lo observable
 * desde fuera es qué se escribe en el directorio y que los resultados no se
 * mueven. Criterios:
 *
 *   - mismo modelo + opciones distintas   → 1 solo fichero, informes iguales
 *   - contenido distinto                  → su propio fichero, con su sha256
 *   - modelo inválido                     → sigue fallando igual, y queda su fichero
 *   - sin la variable                     → nada se escribe
 *   - `noCache: true` con variable activa → nada se escribe (`--no-cache` manda)
 *   - tope en cero                        → el guardián borra lo escrito
 *
 * Y la otra caché, la del motor —`.cache/`, con el modelo ya analizado—, que
 * hasta Ω2.2 no tenía ninguna política y llegó a 130 MB en 59 ficheros:
 *
 *   - `SOFTSIGHT_CACHE_MAX_MB` → el directorio se queda por debajo del tope
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:model-cache`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const BRIDGE = resolve(here, "bridge.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");

const modelBytes = await readFile(MODEL);
const modelFile = { name: "drone.glb", data: modelBytes.toString("base64") };

/** Lanza el CLI en un directorio de trabajo propio, para que `.cache/` sea suyo. */
function runCli(args, cwd, env = {}) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(here, "agent3d.mjs"), ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (exitCode) => done({ exitCode }));
  });
}

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
      resolveResult({ exitCode, response });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function renderRequest(files, extraOptions = {}) {
  return {
    bridgeContractVersion: 1,
    command: "render",
    files: { model: files },
    options: { noCache: false, ...extraOptions },
  };
}

console.log("model-cache: preparando directorio de prueba");
const cacheDir = await mkdtemp(join(tmpdir(), "softsight-model-cache-"));
const cacheEnv = { SOFTSIGHT_BRIDGE_MODEL_CACHE: cacheDir };

try {
  console.log("model-cache: mismo modelo, opciones distintas → un solo fichero");
  const first = await runBridge(renderRequest(modelFile, { tile: 120 }), cacheEnv);
  assert.equal(first.exitCode, 1, "el dron trae avisos y debe salir 1");
  assert.equal(first.response.exitCode, 1);

  const second = await runBridge(renderRequest(modelFile, { tile: 96 }), cacheEnv);
  assert.equal(second.exitCode, 1);
  assert.deepEqual(
    second.response.report.warnings,
    first.response.report.warnings,
    "los avisos no pueden cambiar por activar la caché",
  );

  const entries1 = await readdir(cacheDir);
  assert.equal(entries1.length, 1, "una sola huella → un solo fichero");
  const expectedName = `${createHash("sha256").update(modelBytes).digest("hex")}.glb`;
  assert.deepEqual(entries1, [expectedName], "el nombre debe ser el sha256 del contenido con la extensión");

  console.log("model-cache: contenido distinto → fichero propio, y el inválido falla igual");
  const otherBytes = Buffer.from("otro-contenido-sin-geometria-real");
  const invalid = await runBridge(renderRequest({ name: "otro.glb", data: otherBytes.toString("base64") }), cacheEnv);
  assert.equal(invalid.exitCode, 2, "un modelo que no es GLB falla igual con la caché activa");
  const entries2 = await readdir(cacheDir);
  assert.equal(entries2.length, 2, "cada contenido distinto debe tener su propio fichero");
  assert.ok(entries2.includes(`${createHash("sha256").update(otherBytes).digest("hex")}.glb`));
  assert.ok(entries2.includes(expectedName), "la huella del dron no se reescribe");

  console.log("model-cache: sin la variable → no se escribe nada");
  await runBridge(renderRequest(modelFile, { tile: 96 }), {});
  const entries3 = await readdir(cacheDir);
  assert.equal(entries3.length, 2, "la petición sin variable no toca el directorio");

  console.log("model-cache: noCache vencedor → no se escribe nada");
  await runBridge(renderRequest(modelFile, { tile: 96, noCache: true }), cacheEnv);
  const entries4 = await readdir(cacheDir);
  assert.equal(entries4.length, 2, "noCache:true manda sobre la variable");

  console.log("model-cache: la caché del motor respeta su tope");
  {
    // El modelo del dron cacheado ocupa varios MB, así que con el tope en 1 MB el
    // recorte tiene que dejar el directorio vacío: expulsar por mtime hasta
    // volver al tope, sin excepciones para el que acaba de entrar.
    const engineDir = await mkdtemp(join(tmpdir(), "softsight-engine-cache-"));
    const { exitCode } = await runCli(["--model", MODEL, "--inspect-only", "true"], engineDir, {
      SOFTSIGHT_CACHE_MAX_MB: "1",
    });
    assert.equal(exitCode, 1, "el dron trae avisos");
    const cached = join(engineDir, ".cache");
    let total = 0;
    for (const entry of await readdir(cached)) {
      total += (await stat(join(cached, entry))).size;
    }
    assert.ok(total <= 1024 * 1024, `.cache/ se quedó en ${total} B con el tope en 1 MB`);

    // Y sin tope apretado, el modelo sí se queda: el recorte expulsa, no impide.
    const roomyDir = await mkdtemp(join(tmpdir(), "softsight-engine-cache-roomy-"));
    await runCli(["--model", MODEL, "--inspect-only", "true"], roomyDir);
    assert.equal((await readdir(join(roomyDir, ".cache"))).length, 1, "con tope holgado el modelo se guarda");

    await rm(engineDir, { recursive: true, force: true });
    await rm(roomyDir, { recursive: true, force: true });
  }

  console.log("model-cache: tope en cero → la caché se desactiva");
  const tinyDir = await mkdtemp(join(tmpdir(), "softsight-model-cache-tiny-"));
  const { exitCode } = await runBridge(renderRequest(modelFile, { tile: 120 }), {
    SOFTSIGHT_BRIDGE_MODEL_CACHE: tinyDir,
    SOFTSIGHT_BRIDGE_MODEL_CACHE_MAX_MB: "0",
  });
  assert.equal(exitCode, 1, "el modelo se renderiza bien con la caché apagada");
  assert.equal((await readdir(tinyDir)).length, 0, "tope cero → no se escribe nada");
  await rm(tinyDir, { recursive: true, force: true });
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log("model-cache: ok");