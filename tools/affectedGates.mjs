#!/usr/bin/env node
/**
 * `verify:rapido`: los tipos y solo las puertas que tocan lo que cambió.
 *
 * **Nunca cierra una fase.** Acorta el bucle interno de quien está editando;
 * `npm run verify` sigue siendo la única orden que vale, y CI la corre entera.
 * Por eso cada duda se resuelve hacia correr más, no menos:
 *
 * ```text
 * sin mapa                                     todas
 * package.json, tsconfig, configs de vite,
 * run-tests, gateResult, artifacts/, contracts/  todas
 * un fuente del paquete que ninguna puerta
 *   ejecuta como función (tablas, versiones)   todas: el mapa no lo sabe
 * un fichero que el mapa no conoce             todas: el mapa es más viejo
 * la propia puerta                             esa puerta
 * un fichero que el mapa atribuye              las puertas que lo ejecutan
 * un fuente de src/ fuera del paquete          ninguna puerta: solo tipos
 *   (la demo del navegador)
 * documentación                                ninguna, salvo AGENTS.md
 * ```
 *
 * El mapa lo hace `npm run verify:mapa` (`gateCoverage.mjs`).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/** Lo que cambia la suite entera, por definición. */
const EVERYTHING = [
  /^package(-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^vite(\.node)?\.config\.ts$/,
  /^tools\/(run-tests|gateResult|buildFingerprint)\.mjs$/,
  /^\.nvmrc$/,
  /^artifacts\//,
  /^contracts\//,
];

/** El nombre de puerta que corresponde a un fichero de `tools/`, si es una. */
function gateOf(file, gates) {
  return gates.find((gate) => `tools/${gate.split(" ")[0]}` === file);
}

/**
 * Qué puertas correr para unos ficheros cambiados. Devuelve las puertas y, para
 * cada decisión que amplía a todas, el motivo: quien lo lee sabe por qué tarda.
 */
export function selectGates(map, changed, gates) {
  if (map === null) return { gates: [...gates], reasons: ["no hay mapa: `npm run verify:mapa` lo hace"] };
  const known = new Set(Object.values(map.gates).flat());
  const bundle = new Set(map.bundleSources);
  const existed = new Set(map.srcFiles);
  const selected = new Set();
  const reasons = [];
  for (const file of changed) {
    if (EVERYTHING.some((pattern) => pattern.test(file))) {
      reasons.push(`${file} afecta a la suite entera`);
      continue;
    }
    const own = gateOf(file, gates);
    if (own !== undefined) {
      selected.add(own);
      continue;
    }
    if (file === "AGENTS.md") {
      const check = gates.find((gate) => gate.startsWith("agents-md.mjs"));
      if (check) selected.add(check);
      continue;
    }
    if (file.endsWith(".md")) continue;
    // Existía al hacer el mapa y no entraba en el paquete: la demo del navegador.
    // Uno nuevo no se sabe dónde acaba, y cae en «no está en el mapa».
    if (existed.has(file) && !bundle.has(file)) continue;
    if (!known.has(file)) {
      reasons.push(
        bundle.has(file)
          ? `${file} está en el paquete pero ninguna puerta lo ejecuta como función`
          : `${file} no está en el mapa`,
      );
      continue;
    }
    for (const [gate, files] of Object.entries(map.gates)) if (files.includes(file)) selected.add(gate);
  }
  if (reasons.length > 0) return { gates: [...gates], reasons };
  return { gates: gates.filter((gate) => selected.has(gate)), reasons };
}

/** Lo cambiado respecto a HEAD, seguido o no. */
function changedFiles() {
  const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  return [...new Set([...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
}

async function main() {
  const { GATES } = await import("./run-tests.mjs");
  const { MAP_PATH } = await import("./gateCoverage.mjs");
  const map = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf8")) : null;
  const changed = changedFiles();
  const { gates, reasons } = selectGates(map, changed, GATES);
  for (const reason of reasons) console.log(`rápido: todas — ${reason}`);

  const types = spawnSync("npx", ["tsc", "--noEmit"], { cwd: projectRoot, stdio: "inherit" });
  if (types.status !== 0) process.exit(types.status ?? 1);
  if (gates.length === 0) {
    console.log(`rápido: ${changed.length} ficheros cambiados y ninguna puerta los ejecuta: solo tipos, en verde`);
    return;
  }
  console.log(`rápido: ${gates.length} de ${GATES.length} puertas para ${changed.length} ficheros cambiados`);
  const suite = spawnSync(process.execPath, [resolve(here, "run-tests.mjs"), "--only", gates.join(",")], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  console.log("rápido: esto no cierra nada — `npm run verify` es la orden que vale");
  process.exit(suite.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
