/**
 * La suite entera, con el tiempo de cada puerta y el recuento de comprobaciones.
 *
 * Antes eran trece ficheros encadenados con `&&` en `package.json`. Nadie sabía
 * cuál costaba la mitad del total, y el «71 comprobaciones» del mapa se sacaba
 * contando líneas `ok` a mano. Esto imprime los dos números.
 *
 * ## Lo que la medida dijo, y contradice al plan
 *
 * El plan Ω7 daba por hecho que la suite eran 47,3 s con **doce compilaciones
 * redundantes** de 1,6 s y trece puertas parecidas, y que repartirlas entre
 * cuatro núcleos bajaba de 20 s. Medido el 2026-08-09, las tres premisas fallan:
 *
 * 1. **No había doce compilaciones.** `test:animation` ya compilaba una sola vez
 *    y encadenaba trece `node`. Las que compilan por su cuenta son los `test:*`
 *    sueltos, que existen para iterar sobre una puerta.
 * 2. **Una puerta es la suite.** `sample-surface` cuesta **26,2 s de CPU de los
 *    ~44 s** del total (62 %); `bridge` otros 9,5 s; las once restantes suman
 *    menos de 8 s. Es el mismo derroche que persiguen Ω6.2 y Ω6.3: 128
 *    evaluaciones completas de la malla con skin releyendo las mismas IBM.
 * 3. **Esta máquina tiene dos núcleos físicos**, no cuatro (i5-5350U;
 *    `availableParallelism()` cuenta los cuatro lógicos). Con la puerta gorda ya
 *    limitada por memoria, repartir no da nada y a partir de tres procesos
 *    resta: 61 s en serie contra 89 s y 109 s con cuatro procesos, dos vueltas.
 *
 * Así que el reparto **viene apagado** —`SOFTSIGHT_TEST_JOBS` lo enciende— y el
 * objetivo de bajar de 20 s no lo desbloquea el paralelismo, lo desbloquea
 * abaratar `sample-surface`. Se guarda el descarte con su medida, como
 * `plan-renderizador.md` guarda los suyos, en vez de dejar puesto un reparto que
 * no mejora nada.
 *
 * La salida se agrupa por fichero: un hijo escribe entera y de una vez cuando
 * termina, así que el registro se lee igual aunque no se produzca en orden.
 */

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/**
 * Las trece puertas, **de la más lenta a la más rápida**, con el tiempo de pared
 * medido en serie el 2026-08-09. El orden solo importa con reparto encendido:
 * con una cola, dejar la más larga para el final la deja corriendo sola.
 */
const GATES = [
  "sample-surface.test.mjs", // 50,4 s — 26,2 s de CPU, el 62 % de la suite
  "bridge.test.mjs", // 6,3 s — 9,5 s de CPU, porque lanza el CLI
  "staging-spec.test.mjs", // 1,8 s
  "rig-spec.test.mjs", // 1,6 s
  "story-spec.test.mjs", // 1,5 s
  "bvh-loader.test.mjs", // 1,0 s
  "animation-contract.test.mjs", // 1,0 s
  "glb-loader.test.mjs", // 0,6 s
  "skin-binding.test.mjs", // 0,6 s
  "parity-mode.test.mjs", // 0,5 s
  "glb-writer.test.mjs", // 0,3 s
  "geometry.test.mjs", // 0,3 s
  "text.test.mjs", // 0,3 s
];

/** Lanza una orden y devuelve `{ code, out }` con stdout y stderr ya juntos. */
function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: projectRoot });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => done({ code, out: Buffer.concat(chunks).toString("utf8") }));
  });
}

/** Segundos con una decimal y coma, como el resto de los documentos. */
function seconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1).replace(".", ",")} s`;
}

// La orden de compilar vive en `package.json` y aquí no se copia.
const buildStart = performance.now();
const build = await run("npm", ["run", "build:agent3d"]);
if (build.code !== 0) {
  process.stdout.write(build.out);
  console.error("suite: la compilación falló, no se ejecuta ninguna puerta");
  process.exit(1);
}
const buildMilliseconds = performance.now() - buildStart;

const requested = Number(process.env.SOFTSIGHT_TEST_JOBS);
const workers = Number.isInteger(requested) && requested > 0
  ? Math.min(requested, availableParallelism())
  : 1;
const suiteStart = performance.now();
const pending = [...GATES];
const results = [];

async function drain() {
  for (let gate = pending.shift(); gate !== undefined; gate = pending.shift()) {
    const started = performance.now();
    const { code, out } = await run(process.execPath, [resolve(here, gate)]);
    const milliseconds = performance.now() - started;
    const checks = out.split("\n").filter((line) => line.includes(": ok")).length;
    const skipped = out.includes(": no ejecutada —");
    results.push({ gate, code, milliseconds, checks, skipped });

    const mark = code === 0 ? (skipped ? "—" : "✓") : "✗";
    process.stdout.write(
      `${mark} ${gate}  ${seconds(milliseconds)}  ${checks} comprobaciones\n${out}`,
    );
  }
}

await Promise.all(Array.from({ length: workers }, drain));

const suiteMilliseconds = performance.now() - suiteStart;
const checks = results.reduce((total, result) => total + result.checks, 0);
const failed = results.filter((result) => result.code !== 0);
const skipped = results.filter((result) => result.skipped);

console.log(
  `suite: ${GATES.length} puertas, ${checks} comprobaciones, ` +
    `${seconds(buildMilliseconds + suiteMilliseconds)} ` +
    `(compilar ${seconds(buildMilliseconds)}, ${workers} ${workers === 1 ? "proceso" : "procesos"})`,
);
if (skipped.length > 0) {
  console.log(`suite: ${skipped.length} no ejecutadas — ${skipped.map((r) => r.gate).join(", ")}`);
}
if (failed.length > 0) {
  console.error(`suite: ${failed.length} en rojo — ${failed.map((r) => r.gate).join(", ")}`);
  process.exit(1);
}
