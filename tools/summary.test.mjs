/**
 * `--summary` y `--fields`: que recorten el informe sin inventarse nada.
 *
 * El riesgo de un resumen no es que le falte una clave, es que **la calcule por
 * su cuenta**. Ese día habría dos orígenes del mismo dato y el agente creería el
 * barato, que es justo la avería que la regla de una fuente por dato existe para
 * evitar. Por eso la comprobación central no es «el resumen tiene estas claves»
 * sino «cada clave del resumen es idéntica a la del informe completo».
 *
 * Y el presupuesto se comprueba con un número, no a ojo: 2.000 B.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:summary`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");

/** Lanza el CLI y devuelve `{ exitCode, stdout, stderr }`. Salida 1 son avisos. */
async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    if (error.stdout === undefined) throw error;
    return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

const work = await mkdtemp(join(tmpdir(), "softsight-summary-"));

try {
  // El pliego entero, que es donde el resumen tiene algo que recortar: con
  // render hay renderHash, views, partScreenBoxes y families.
  const base = ["--model", MODEL, "--out", join(work, "dron.png")];
  const full = await runCli(base);
  const summary = await runCli([...base, "--summary"]);
  assert.equal(summary.exitCode, full.exitCode, "el recorte no cambia el código de salida");

  const complete = JSON.parse(full.stdout);
  const recortado = JSON.parse(summary.stdout);

  // 1. Cada clave del resumen, idéntica a la del completo. Si alguna se
  //    recalculara, aquí se vería.
  for (const [key, value] of Object.entries(recortado)) {
    assert.deepEqual(value, complete[key], `--summary recalculó ${key}`);
  }
  assert.ok(Object.keys(recortado).length > 0, "el resumen no puede salir vacío");
  assert.ok(
    Object.keys(recortado).length < Object.keys(complete).length,
    "el resumen tiene que recortar algo",
  );
  // Y lo caro no está: `families` es el 45 % del informe y no cambia porque
  // muevas un rotor.
  for (const gordo of ["families", "views", "partScreenBoxes", "spatial", "objects"]) {
    assert.ok(!(gordo in recortado), `${gordo} no debería estar en el resumen`);
  }
  console.log(
    `resumen: ok (${Object.keys(recortado).length} claves de ${Object.keys(complete).length}, ` +
      "todas idénticas al informe completo)",
  );

  // 2. El presupuesto, con un número. El dron trae sus avisos de escala entre
  //    hermanos, así que esto mide el caso real, no uno limpio.
  const bytes = Buffer.byteLength(summary.stdout, "utf8");
  const bytesFull = Buffer.byteLength(full.stdout, "utf8");
  assert.ok(bytes < 2000, `el resumen del dron ocupa ${bytes} B y el techo son 2.000`);
  assert.ok(complete.warnings.length > 0, "el dron tiene que traer avisos para que esto mida algo");
  console.log(
    `resumen: ok (${bytes} B frente a ${bytesFull} B del completo, ` +
      `${complete.warnings.length} avisos dentro; techo 2.000 B)`,
  );

  // 3. `--fields`: la ruta válida proyecta conservando el anidamiento, y la
  //    inválida es error de datos con sugerencia. Sin render, que aquí no hace
  //    falta y cuesta.
  const inspect = ["--model", MODEL, "--inspect-only"];
  const fields = await runCli([...inspect, "--fields", "warnings,spatial.floating"]);
  const proyectado = JSON.parse(fields.stdout);
  assert.deepEqual(Object.keys(proyectado), ["warnings", "spatial"]);
  assert.deepEqual(Object.keys(proyectado.spatial), ["floating"]);

  const entero = JSON.parse((await runCli(inspect)).stdout);
  assert.deepEqual(proyectado.warnings, entero.warnings);
  assert.deepEqual(proyectado.spatial.floating, entero.spatial.floating);

  const typo = await runCli([...inspect, "--fields", "spatial.floting"]);
  assert.equal(typo.exitCode, 2, "una ruta inexistente es error de datos");
  assert.match(typo.stderr, /spatial\.floting no existe/);
  assert.match(typo.stderr, /¿querías decir spatial\.floating\?/);

  const raiz = await runCli([...inspect, "--fields", "warnigs"]);
  assert.equal(raiz.exitCode, 2);
  assert.match(raiz.stderr, /¿querías decir warnings\?/);

  // Una ruta que no baja por ningún sitio dice por qué, en vez de callar.
  const hoja = await runCli([...inspect, "--fields", "parts.cuantas"]);
  assert.equal(hoja.exitCode, 2);
  assert.match(hoja.stderr, /no es un objeto por el que se pueda bajar/);

  console.log(
    "fields: ok (proyección con anidamiento; ruta inexistente sale 2 con sugerencia, en la raíz y dentro)",
  );

  // `--fields` manda sobre `--summary`: quien escribe las dos quiere la suya.
  const ambas = await runCli([...inspect, "--summary", "--fields", "warnings"]);
  assert.deepEqual(Object.keys(JSON.parse(ambas.stdout)), ["warnings"]);
  console.log("fields: ok (--fields manda sobre --summary)");
} finally {
  await rm(work, { recursive: true, force: true });
}
