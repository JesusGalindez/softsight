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
 * 2. **Una puerta era la suite.** `sample-surface` costaba **26,2 s de CPU de los
 *    ~44 s** del total (62 %). Era el derroche que Ω6.2 y Ω6.3 arreglaron —128
 *    evaluaciones releyendo las mismas IBM y tres recorridos idénticos de las
 *    áreas—: hoy son **0,8 s de pared**, y la suite entera 34,5 s con diecisiete
 *    puertas en vez de trece.
 * 3. **Esta máquina tiene dos núcleos físicos**, no cuatro (i5-5350U;
 *    `availableParallelism()` cuenta los cuatro lógicos). Con la puerta gorda ya
 *    limitada por memoria, repartir no da nada y a partir de tres procesos
 *    resta: 61 s en serie contra 89 s y 109 s con cuatro procesos, dos vueltas.
 *
 * Así que el reparto **viene apagado** —`SOFTSIGHT_TEST_JOBS` lo enciende— y el
 * objetivo de bajar de 20 s no lo desbloqueó el paralelismo sino abaratar
 * `sample-surface`. Con Ω6 hecho, dos procesos ya ganan algo —44,5 s contra 35,9,
 * y 41,5 contra 32,1 en la vuelta siguiente— pero es un **20 %, por debajo del
 * 30 % que el ruido de esta máquina permite afirmar**, así que el reparto sigue
 * apagado por defecto y el descarte se queda anotado con su medida, como los de
 * `plan-renderizador.md`.
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
 * Las puertas, **de la más lenta a la más rápida**, con el tiempo de pared
 * medido en serie el 2026-08-09. El orden solo importa con reparto encendido:
 * con una cola, dejar la más larga para el final la deja corriendo sola.
 */
const GATES = [
  "bridge.test.mjs", // 15,5 s — lanza el CLI muchas veces, y ahora también el residente
  "incremental.test.mjs", // 5,5 s — seis revisiones del dron con contrato de topología
  "mcp.test.mjs", // 5,2 s — siete herramientas, cada una contra el CLI directo
  "summary.test.mjs", // 4,3 s — renderiza el dron entero para medir el recorte
  "rig-spec.test.mjs", // 1,3 s
  "screen-audit.test.mjs", // 1,2 s
  "story-spec.test.mjs", // 1,1 s
  "staging-spec.test.mjs", // 1,0 s
  "sample-surface.test.mjs", // 0,8 s — eran 50,4 antes de Ω6.2 y Ω6.3
  "bvh-loader.test.mjs", // 0,8 s
  "text-plan.test.mjs", // 0,8 s
  "parity-mode.test.mjs", // 0,4 s
  "animation-contract.test.mjs", // 0,3 s
  "skin-binding.test.mjs", // 0,3 s
  "warning-codes.test.mjs", // 0,3 s
  "glb-loader.test.mjs", // 0,2 s
  "geometry.test.mjs", // 0,2 s
  "text.test.mjs", // 0,2 s
  "agents-md.mjs --check", // 0,2 s — no acaba en .test.mjs porque también regenera
  "glb-writer.test.mjs", // 0,1 s
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
    // Una puerta puede llevar argumentos —`agents-md.mjs --check`—, así que la
    // entrada se parte por espacios en vez de ser solo un nombre de fichero.
    const [file, ...args] = gate.split(" ");
    const { code, out } = await run(process.execPath, [resolve(here, file), ...args]);
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
