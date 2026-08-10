/**
 * La auditoría cacheada contra la auditoría entera.
 *
 * La regla del plan Ω6.1 es la que manda: *una auditoría más rápida que a veces
 * miente vale menos que ninguna*. Así que lo que se comprueba no es que vaya
 * rápido, es que el informe sea **el mismo**, campo a campo, con la caché fría,
 * con la caché caliente y sin caché.
 *
 * Se puede afirmar porque no es un incremental que deduzca qué cambió: la clave
 * es la huella de la malla, y `auditMesh` depende solo de la malla. Lo que
 * devuelve la caché es la misma función sobre la misma entrada. Lo que esta
 * puerta cierra es que esa afirmación siga siendo cierta —que la huella no se
 * quede corta— y lo hace con el caso que la rompería si lo fuera: un parche que
 * **sí** cambia la malla.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:incremental`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");

/**
 * El CLI en un directorio de trabajo propio, para que `.cache/` sea suyo y la
 * caché de auditoría empiece fría cuando esta prueba lo quiere.
 */
async function runCli(args, cwd) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    if (error.stdout === undefined) throw error;
    return { exitCode: error.code, report: JSON.parse(error.stdout) };
  }
}

/** `source` y `cached` cuentan de dónde salió el modelo, no qué se auditó. */
function comparable(report) {
  const copy = { ...report };
  for (const key of ["source", "file", "cached"]) delete copy[key];
  return copy;
}

const work = await mkdtemp(join(tmpdir(), "softsight-incremental-"));

try {
  // El contrato de topología entero: es el que obliga a auditar las 296 piezas.
  const contrato = ["--model", MODEL, "--inspect-only", "--require-watertight", "--max-boundary-edges", "0"];

  const fria = await runCli(contrato, work);
  const caliente = await runCli(contrato, work);
  const sinCache = await runCli([...contrato, "--no-cache"], work);

  assert.deepEqual(comparable(caliente.report), comparable(fria.report), "caliente != fría");
  assert.deepEqual(comparable(sinCache.report), comparable(fria.report), "sin caché != fría");
  assert.equal(caliente.exitCode, fria.exitCode);
  assert.equal(sinCache.exitCode, fria.exitCode);
  assert.ok(fria.report.warnings.length > 0, "el dron incumple el contrato y tiene que avisar");
  console.log(
    `incremental: ok (informe idéntico con caché fría, caliente y sin caché; ${fria.report.warnings.length} avisos)`,
  );

  // El caso que rompería la huella si se quedara corta: `setPivot` **mueve las
  // posiciones** de la pieza y compensa con la matriz, así que la malla cambia y
  // su auditoría también —el centro de la caja pasa a estar en el origen—. Si la
  // huella no lo viera, la caché serviría la auditoría de antes y `centerOffset`
  // saldría con el valor viejo.
  const mirada = ["--select", "canopy-hatch-panel", "--audit-limit", "1"];
  const patch = { edits: [{ op: "setPivot", target: "canopy-hatch-panel" }] };
  const patchPath = join(work, "pivote.json");
  await writeFile(patchPath, `${JSON.stringify(patch)}\n`);

  const antes = await runCli([...contrato, ...mirada], work);
  const despuesCaliente = await runCli([...contrato, ...mirada, "--patch", patchPath], work);
  const despuesSinCache = await runCli([...contrato, ...mirada, "--patch", patchPath, "--no-cache"], work);

  assert.deepEqual(
    comparable(despuesCaliente.report),
    comparable(despuesSinCache.report),
    "tras mover el pivote, la caché caliente no coincide con la auditoría entera",
  );

  const offsetAntes = antes.report.selection.audits[0].centerOffset;
  const offsetDespues = despuesCaliente.report.selection.audits[0].centerOffset;
  assert.notDeepEqual(
    offsetDespues,
    offsetAntes,
    "setPivot tiene que cambiar el centro de la caja; si no, este caso no prueba nada",
  );
  assert.deepEqual(offsetDespues, [0, 0, 0], "tras setPivot el centro queda en el origen");
  console.log(
    "incremental: ok (setPivot cambia la malla, la huella lo ve, y el informe sigue siendo el entero)",
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
