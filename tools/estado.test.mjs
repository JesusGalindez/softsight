/**
 * Puerta del estado como dato (plan de mejora, fase 4).
 *
 * Tres cosas:
 *
 * 1. `docs/estado.json` y los bloques generados están al día con sus fuentes
 *    —lo que comprueba `tools/estado.mjs --check`—, y `--status` publica ese
 *    fichero tal cual.
 * 2. **La regla de la prosa caza lo que existe para cazar.** El caso del plan:
 *    volver a escribir «siete herramientas» en el README pone esto rojo. Y no
 *    caza lo que no debe: «las dos puertas cruzadas» nombra dos cosas concretas.
 * 3. **El estado de una decisión sale de su título**, sin sufijo es ACORDADA, y un
 *    sufijo que no es de los cuatro estados es un error y no una ACORDADA más.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STATUS_PATH, handCounts, readDecisions } from "./estado.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

// 1. Al día, y lo que publica `--status` es el fichero.
{
  execFileSync(process.execPath, [resolve(here, "estado.mjs"), "--check"], { cwd: projectRoot, stdio: "pipe" });
  const published = execFileSync(process.execPath, [resolve(here, "agent3d.mjs"), "--status"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const file = readFileSync(STATUS_PATH, "utf8");
  assert.equal(published, file, "--status tiene que ser docs/estado.json, no otra cuenta");
  const status = JSON.parse(file);
  assert.ok(Buffer.byteLength(file) < 3000, `estado.json pesa ${Buffer.byteLength(file)} B: es la entrada de un agente frío`);
  const contadas = Object.entries(status.decisions).filter(([key]) => key !== "total").flatMap(([, ids]) => ids);
  assert.equal(status.decisions.total, contadas.length, "el total es la suma de los estados, no un número aparte");
  console.log(
    `estado: ok (estado.json al día con sus fuentes, ${Buffer.byteLength(file)} B, y --status lo publica tal cual)`,
  );
}

// 2. La regla de la prosa.
{
  const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
  assert.deepEqual(handCounts(readme), [], "el README de hoy no lleva recuentos a mano");
  const conLaErrata = readme.replace("`softsight_inspect` devuelve el resumen", "Son siete herramientas. `softsight_inspect` devuelve el resumen");
  assert.notEqual(conLaErrata, readme);
  assert.deepEqual(handCounts(conLaErrata), ["siete herramientas"], "«siete herramientas» escrito a mano tiene que cazarse");
  assert.deepEqual(handCounts("el verde son 23 de las 28 puertas y 143 comprobaciones"), ["28 puertas", "143 comprobaciones"]);
  assert.deepEqual(handCounts("las dos puertas cruzadas y tres herramientas de medida"), [], "lo que se cuenta leyendo no es un total");
  assert.deepEqual(
    handCounts("<!-- generado: x -->\n29 puertas\n<!-- /generado: x -->"),
    [],
    "dentro de un bloque generado el número lo pone el script",
  );
  console.log("estado: ok (volver a escribir «siete herramientas» en el README se caza; «las dos puertas cruzadas» y lo generado, no)");
}

// 3. Las decisiones, de sus títulos.
{
  const doc = [
    "### D1 — Algo — IMPLEMENTADA (2026-09-14)",
    "### D2 — Otra cosa",
    "### D3 — Versiones — IMPLEMENTADA a medias (2026-09-13)",
    "### D4 — El contrato está en DRAFT — el segundo productor ya existe (2026-09-13)",
    "### D5 — Retirada — REVERTIDA (2026-10-01)",
    "texto que no es un título — IMPLEMENTADA (2026-09-14)",
  ].join("\n");
  const byState = readDecisions(doc);
  assert.deepEqual(byState.IMPLEMENTADA, ["D1"]);
  assert.deepEqual(byState.ACORDADA, ["D2", "D4"], "sin sufijo de estado es ACORDADA, aunque el título lleve fecha");
  assert.deepEqual(byState["IMPLEMENTADA a medias"], ["D3"]);
  assert.deepEqual(byState.REVERTIDA, ["D5"]);
  assert.throws(() => readDecisions("### D9 — Algo — IMPLEMENTADO (2026-09-14)"), /estado desconocido/);
  const real = readDecisions(readFileSync(resolve(projectRoot, "docs/contrato-videomesh.md"), "utf8"));
  assert.deepEqual(real["IMPLEMENTADA a medias"], ["D12"], "D12 dice «a medias» en su título y ahora también en la tabla");
  console.log("estado: ok (el estado de cada decisión sale de su título; sin sufijo es ACORDADA y un sufijo inventado es un error)");
}

console.log(
  "estado: fuera de alcance — qué toca ahora y de quién es no se genera: es criterio, y vive escrito a mano " +
    "en el mapa §5. Tampoco las medidas con fecha de los documentos, que son historia y no estado",
);
