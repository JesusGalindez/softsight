/**
 * Puerta de determinismo: el pliego del dron, dos veces, contra el hash fijado.
 *
 * El proyecto afirma que el render es reproducible. Esta puerta convierte esa
 * afirmación en dos números que tienen que coincidir tres veces:
 *
 * 1. **Dos ejecuciones en la misma máquina** dan el mismo `renderHash`. Caza el
 *    estado que se cuela entre llamadas —cachés, orden de recorrido, tiempo—.
 * 2. **Contra `artifacts/agent/render-hashes.json`**, fijado en el repositorio.
 *    Caza la deriva entre versiones de Node, que es exactamente lo que `.nvmrc`
 *    intenta cubrir y lo que nadie comprobaba.
 *
 * En CI corre además en `ubuntu-latest` y `macos-latest`, así que el tercer
 * cotejo es entre dos aritméticas distintas. Si divergen, eso es un hallazgo que
 * se documenta con sus dos hashes, no un fallo que se tapa: `Math.sin`, `cos`,
 * `tan` y `hypot` no están especificados al último bit por el estándar.
 *
 *   node tools/render-hashes.mjs            comprueba (sale 1 si no cuadra)
 *   node tools/render-hashes.mjs --write    refija el fichero desde esta máquina
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:determinism`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const FIXED = resolve(projectRoot, "artifacts/agent/render-hashes.json");

/**
 * Los casos que se fijan. Cada uno son los argumentos del CLI **sin** `--out`,
 * que lo pone el ejecutor en un directorio temporal: el pliego en disco no es el
 * dato, el hash sí.
 */
const CASES = [
  {
    name: "dron",
    args: ["--model", "artifacts/export/drone.glb"],
  },
];

/** Ejecuta un caso y devuelve su `renderHash` y el `contractVersion` del informe. */
async function runCase(testCase, outDir) {
  const args = [
    CLI,
    ...testCase.args,
    "--out",
    join(outDir, `${testCase.name}.png`),
  ];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, args, {
      cwd: projectRoot,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    // Salida 1 es «hay avisos», y el dron los tiene. Solo el resto es fallo.
    if (error.code !== 1 || !error.stdout) throw error;
    stdout = error.stdout;
  }
  const report = JSON.parse(stdout);
  return { contractVersion: report.contractVersion, renderHash: report.renderHash };
}

const write = process.argv.includes("--write");
const outDir = await mkdtemp(join(tmpdir(), "softsight-hashes-"));
const observed = [];

try {
  for (const testCase of CASES) {
    const first = await runCase(testCase, outDir);
    const second = await runCase(testCase, outDir);
    assert.deepEqual(
      second,
      first,
      `${testCase.name}: dos ejecuciones seguidas dieron hashes distintos`,
    );
    console.log(
      `determinismo: ok (${testCase.name}: ${first.renderHash.sheet} dos veces, contrato ${first.contractVersion})`,
    );
    observed.push({ name: testCase.name, args: testCase.args, ...first });
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

if (write) {
  await writeFile(FIXED, `${JSON.stringify({ schemaVersion: 1, cases: observed }, null, 2)}\n`);
  console.log(`determinismo: fijados ${observed.length} casos en ${FIXED}`);
} else {
  const fixed = JSON.parse(await readFile(FIXED, "utf8"));
  assert.equal(fixed.schemaVersion, 1, "render-hashes.json: schemaVersion desconocida");
  assert.deepEqual(
    observed,
    fixed.cases,
    "el pliego no coincide con el hash fijado en artifacts/agent/render-hashes.json",
  );
  console.log(`determinismo: ok (${observed.length} casos == artifacts/agent/render-hashes.json)`);
}
