/**
 * Puerta del barrido (plan de mejora, 3.2): cada fila es la de su llamada suelta,
 * y el cruce es la regla de `dominance.ts` sobre esas filas.
 *
 * Dos mitades:
 *
 * 1. **La regla, sobre informes inventados** cuyo resultado se sabe a mano:
 *    quién domina, cuándo no domina nadie, qué entra en la frontera, y el caso
 *    que hizo falta escribir aparte —dos variantes empatadas arriba en un
 *    criterio no le regalan el veredicto a una tercera que en él es peor—.
 * 2. **El barrido de verdad sobre el dron**, contra el CLI lanzado aparte: la
 *    fila de cada variante es lo que devuelve `--fields` con el informe de la base
 *    como referencia, y el cruce recalculado con esos informes independientes es
 *    el mismo.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSweep, dominanceVerdict } from "../dist-node/agent3d.mjs";
import { runAgent } from "./agent3d.mjs";
import { handleRequest } from "./bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");
const FLAGS = ["--tile", "160", "--no-cache", "true"];

const MENOS = "MENOR_MEJOR";
const MAS = "MAYOR_MEJOR";
const entry = (name, report) => ({ name, report });

// 1. La regla.
{
  const domina = compareSweep(
    [entry("a", { x: 1, y: 5 }), entry("b", { x: 2, y: 3 })],
    [{ field: "x", direction: MENOS }, { field: "y", direction: MAS }],
  );
  assert.equal(domina.verdict, "a");
  assert.deepEqual(domina.frontier, ["a"]);

  const cruzados = compareSweep(
    [entry("a", { x: 1, y: 3 }), entry("b", { x: 2, y: 5 }), entry("c", { x: 3, y: 1 })],
    [{ field: "x", direction: MENOS }, { field: "y", direction: MAS }],
  );
  assert.equal(cruzados.verdict, null);
  assert.equal(cruzados.reason, "NINGUNO_DOMINA");
  assert.deepEqual(cruzados.frontier, ["a", "b"], "c pierde contra a en los dos criterios y sale de la frontera");
  assert.deepEqual(cruzados.criteria.map((criterion) => criterion.best), ["a", "b"], "y los criterios cruzados se ven");
  console.log("barrido: ok (quien gana en todo se lleva el veredicto; con criterios cruzados no hay veredicto y la frontera dice entre cuáles elegir)");

  // Los números del dron: la base y «movido» empatan a 296 piezas. La regla de R9
  // tira ese criterio por empate y corona a «sin-bujes», que tiene 292.
  const empateArriba = [
    entry("base", { triangles: 37950, parts: 296 }),
    entry("movido", { triangles: 37950, parts: 296 }),
    entry("sin-bujes", { triangles: 35646, parts: 292 }),
  ];
  const criterios = [{ field: "triangles", direction: MENOS }, { field: "parts", direction: MAS }];
  const barrido = compareSweep(empateArriba, criterios);
  assert.equal(barrido.verdict, null, "un empate arriba no regala el veredicto a quien es peor en ese criterio");
  assert.deepEqual(barrido.frontier, ["base", "movido", "sin-bujes"]);
  assert.equal(
    dominanceVerdict(barrido.compared, barrido.criteria).verdict,
    "sin-bujes",
    "la regla de R9 sí lo coronaría: si esto cambia, R9 se alineó y hay que reescribir la nota de dominance.ts",
  );
  console.log(
    "barrido: ok (base y «movido» empatan a 296 piezas y «sin-bujes» tiene 292: el barrido no le da el veredicto, " +
      "que es justo lo que la regla de R9 haría)",
  );

  const iguales = compareSweep([entry("a", { x: 1 }), entry("b", { x: 1 })], [{ field: "x", direction: MENOS }]);
  assert.deepEqual([iguales.verdict, iguales.reason, iguales.frontier], [null, "NINGUN_CRITERIO_DECIDIBLE", ["a", "b"]]);
  const lista = compareSweep(
    [entry("a", { warnings: [1, 2, 3] }), entry("b", { warnings: [1] })],
    [{ field: "warnings", direction: MENOS }],
  );
  assert.equal(lista.verdict, "b", "una lista se compara por cuántos elementos tiene");
  assert.deepEqual(lista.criteria[0].values.map((value) => value.value), [3, 1]);
  const sinCriterios = compareSweep([entry("a", {}), entry("b", {})], []);
  assert.deepEqual([sinCriterios.reason, sinCriterios.frontier], ["SIN_CRITERIOS_DECLARADOS", []]);
  assert.throws(() => compareSweep([entry("a", { triangles: 1 })], [{ field: "triangels", direction: MENOS }]), /¿querías decir triangles\?/);
  assert.throws(() => compareSweep([entry("a", { diff: null })], [{ field: "diff", direction: MENOS }]), /vale null/);
  assert.throws(() => compareSweep([entry("a", { ok: true })], [{ field: "ok", direction: MENOS }]), /vale boolean/);
  console.log(
    "barrido: ok (todo empatado no decide; una lista cuenta por su longitud; sin criterios no hay cruce; y una errata, " +
      "un null o un booleano son errores con su motivo, no criterios vacíos)",
  );
}

// 2. El barrido de verdad, contra el CLI lanzado aparte.
const work = mkdtempSync(join(tmpdir(), "softsight-barrido-prueba-"));
const w = (name) => join(work, name);
const doc = (document) => ({ name: "parche.json", data: Buffer.from(`${JSON.stringify(document)}\n`).toString("base64") });
const model = { name: "drone.glb", data: readFileSync(MODEL).toString("base64") };

/** El CLI en su propio proceso: el informe, o el error de datos con su texto. */
function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    if (error.status === 1 && error.stdout) return { exitCode: 1, report: JSON.parse(error.stdout) };
    if (error.status === 2) return { exitCode: 2, stderr: error.stderr.trim() };
    throw error;
  }
}

const sweep = (request) =>
  handleRequest({ bridgeContractVersion: 1, command: "sweep", files: { model }, ...request }, runAgent);

try {
  const variants = [
    { name: "movido", patch: { edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] } },
    { name: "sin-moleteado", patch: { edits: [{ op: "delete", target: "motor-knurl-*" }] } },
    { name: "sin-bujes", patch: { edits: [{ op: "delete", target: "rotor-hub-*" }] } },
    { name: "roto", patch: { edits: [{ op: "teletransporte", target: "rotor-*" }] } },
  ];
  const FIELDS = "triangles,parts,warningsDelta";
  const criteria = [{ field: "triangles", direction: MENOS }, { field: "parts", direction: MAS }, { field: "warnings", direction: MENOS }];
  const response = await sweep({
    variants: variants.map(({ name, patch }) => ({ name, patches: [doc(patch)] })),
    criteria,
    options: { tile: 160, noCache: true, fields: FIELDS },
  });
  const { report } = response;
  assert.equal(response.exitCode, 0);
  assert.equal(report.documentType, "softsight.sweep");

  const base = cli(["--model", MODEL, "--inspect-only", "true", ...FLAGS]);
  writeFileSync(w("base.json"), `${JSON.stringify(base.report)}\n`);
  const fields = FIELDS.split(",");
  assert.deepEqual(report.base.row, cli(["--model", MODEL, "--inspect-only", "true", "--fields", FIELDS, ...FLAGS]).report);

  const independientes = [{ name: "base", report: base.report }];
  for (const [index, { name, patch }] of variants.entries()) {
    writeFileSync(w(`v${index}.json`), `${JSON.stringify(patch)}\n`);
    const args = ["--model", MODEL, "--patch", w(`v${index}.json`), "--inspect-only", "true", "--baseline-report", w("base.json"), ...FLAGS];
    const suelta = cli([...args, "--fields", FIELDS]);
    const row = report.variants[index];
    assert.equal(row.name, name);
    if (suelta.exitCode === 2) {
      assert.equal(row.error, suelta.stderr, `${name}: el error de la fila es el del CLI`);
      continue;
    }
    assert.deepEqual(row.row, suelta.report, `${name}: la fila es la de su llamada suelta`);
    assert.equal(row.exitCode, suelta.exitCode);
    independientes.push({ name, report: cli(args).report });
  }
  assert.deepEqual(report.excluded, [{ candidate: "roto", reason: "ERROR_DE_DATOS" }]);
  const recalculado = compareSweep(independientes, criteria);
  for (const key of ["compared", "criteria", "verdict", "frontier"]) assert.deepEqual(report[key], recalculado[key], key);
  assert.ok(fields.every((field) => field in report.variants[0].row));
  console.log(
    `barrido: ok (${variants.length} variantes del dron: cada fila es la de su llamada suelta al CLI con la base ` +
      `como referencia, la rota sale excluida con el error del CLI, y el cruce recalculado con informes ` +
      `independientes es el mismo — frontera ${report.frontier.join(", ")})`,
  );

  // Con pliego: la fila trae el diff contra el pliego de la base.
  const render = await sweep({
    variants: [{ name: "movido", patches: [doc(variants[0].patch)] }],
    options: { tile: 160, noCache: true, inspectOnly: false, fields: "diff,renderHash" },
  });
  writeFileSync(w("base-pliego.json"), `${JSON.stringify(cli(["--model", MODEL, "--out", w("base.png"), ...FLAGS]).report)}\n`);
  const conPliego = cli([
    "--model", MODEL, "--patch", w("v0.json"), "--baseline", w("base.png"), "--baseline-report", w("base-pliego.json"),
    "--out", w("v0.png"), "--fields", "diff,renderHash", ...FLAGS,
  ]);
  assert.deepEqual(render.report.variants[0].row, conPliego.report);
  assert.ok(conPliego.report.diff.changedPixels > 0);
  console.log("barrido: ok (con pliego, la fila trae el diff contra el pliego de la base, el mismo que el CLI con --baseline)");

  // Lo que se rechaza antes de gastar una variante.
  const rechaza = async (request, code, pattern) => {
    try {
      await sweep(request);
    } catch (error) {
      assert.equal(error.code, code, error.message);
      assert.match(error.message, pattern);
      return;
    }
    assert.fail(`se esperaba ${code}`);
  };
  const uno = [{ patches: [doc(variants[0].patch)] }];
  await rechaza({ variants: uno, criteria: [{ field: "triangels", direction: MENOS }] }, "data-error", /¿querías decir triangles\?/);
  await rechaza({ variants: [...uno, ...uno].map((variant) => ({ ...variant, name: "x" })) }, "invalid-request", /repetido/);
  await rechaza({ variants: [{ name: "base", patches: uno[0].patches }] }, "invalid-request", /el de la base/);
  await rechaza({ variants: Array.from({ length: 65 }, () => uno[0]) }, "invalid-request", /como mucho 64/);
  await rechaza({ variants: uno, criteria: [{ field: "triangles", direction: "MEJOR" }] }, "invalid-request", /MENOR_MEJOR/);
  console.log("barrido: ok (una errata en un criterio se sabe con la base, antes de revisar variantes; nombres repetidos, «base», más de 64 o una dirección inventada se rechazan)");
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(
  "barrido: fuera de alcance — los repartos del encargo 05-A no se barren todavía: `auditPartition` no se alcanza " +
    "desde el CLI hasta el 5.2, y un barrido solo varía lo que el CLI sabe revisar",
);
