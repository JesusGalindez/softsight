#!/usr/bin/env node
/**
 * El mapa de qué ficheros ejecuta cada puerta, para `verify:rapido`.
 *
 * Todas las puertas importan el mismo paquete, `dist-node/agent3d.mjs`, así que
 * el grafo de imports no dice qué puerta toca qué fuente: las toca todas. Lo dice
 * la **cobertura**. Esto compila el paquete con mapas de fuente, corre cada
 * puerta con `NODE_V8_COVERAGE` y traduce cada función ejecutada a su fichero de
 * `src/` por el mapa. Los hijos que lance una puerta —el CLI que lanza el puente,
 * el servidor MCP— heredan la variable y cuentan también.
 *
 * Granularidad: fichero. Una función de `inspect.ts` que corrió hace a la puerta
 * dependiente de `inspect.ts` entero.
 *
 * Lo que este mapa **no ve**, y por eso `affectedGates.mjs` es conservador con
 * ello: el código de nivel de módulo de cada fuente —una tabla de constantes,
 * `versions.ts`— corre al importar el paquete y no es una función, así que no se
 * atribuye. Un fichero del paquete que ninguna puerta ejecuta como función no
 * significa que nadie dependa de él: significa que el mapa no lo sabe, y entonces
 * se corren todas.
 *
 * Salida: `.cache/mapa-puertas.json`, con la huella de los fuentes de los que
 * salió. Al acabar recompila sin mapas, para dejar `dist-node/` como estaba.
 *
 * Uso: `npm run verify:mapa` (unos minutos: es la suite entera, más lenta).
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { listFiles, sourceFingerprint } from "./buildFingerprint.mjs";
import { GATES } from "./run-tests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const BUNDLE = resolve(projectRoot, "dist-node/agent3d.mjs");
export const MAP_PATH = resolve(projectRoot, ".cache/mapa-puertas.json");

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodifica `mappings` de un mapa de fuente v3: por cada línea generada, la
 * lista de `[columna, índiceDeFuente]` en orden. Solo hace falta saber de qué
 * fuente viene cada trozo, así que la línea y columna originales se descartan.
 */
export function decodeMappings(mappings) {
  const lines = [];
  let source = 0;
  const decode = (segment) => {
    const values = [];
    let value = 0;
    let shift = 0;
    for (const char of segment) {
      const digit = BASE64.indexOf(char);
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        values.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
    return values;
  };
  for (const line of mappings.split(";")) {
    const segments = [];
    let column = 0;
    if (line !== "") {
      for (const segment of line.split(",")) {
        const values = decode(segment);
        column += values[0];
        if (values.length >= 4) {
          source += values[1];
          segments.push([column, source]);
        }
      }
    }
    lines.push(segments);
  }
  return lines;
}

/** El fichero de origen de una posición del paquete: el último trozo que empieza
 * en o antes de ella, en su línea o en las anteriores. */
function sourceAt(lines, line, column) {
  for (let current = line; current >= 0; current -= 1) {
    const segments = lines[current] ?? [];
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (current < line || segments[index][0] <= column) return segments[index][1];
    }
  }
  return -1;
}

/** Offsets de inicio de línea, para pasar de offset a (línea, columna). */
function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}

function locate(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return [low, offset - starts[low]];
}

/** Relativa al repositorio, con `/`. */
function repoPath(absolute) {
  return relative(projectRoot, absolute).split(sep).join("/");
}

/** Lee el directorio de cobertura de una puerta y devuelve los ficheros que ejecutó. */
export function filesFromCoverage(directory, bundle) {
  const files = new Set();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const { result } = JSON.parse(readFileSync(join(directory, name), "utf8"));
    for (const script of result ?? []) {
      if (!script.url.startsWith("file://")) continue;
      const path = fileURLToPath(script.url);
      if (path === BUNDLE) {
        for (const fn of script.functions) {
          const range = fn.ranges[0];
          if (range === undefined || range.count === 0) continue;
          const [line, column] = locate(bundle.starts, range.startOffset);
          const source = sourceAt(bundle.lines, line, column);
          if (source >= 0) files.add(bundle.sources[source]);
        }
        continue;
      }
      // Los ficheros de fuera del paquete —el CLI, el puente, la propia puerta—
      // cuentan enteros: cargarlos ya ejecuta su nivel de módulo.
      const inRepo = repoPath(path);
      if (!inRepo.startsWith("..") && !inRepo.startsWith("node_modules/")) files.add(inRepo);
    }
  }
  return files;
}

function run(command, args, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: projectRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => done({ code, out: Buffer.concat(chunks).toString("utf8") }));
  });
}

async function main() {
  const build = await run("npx", ["vite", "build", "--config", "vite.node.config.ts", "--sourcemap", "--logLevel", "error"]);
  if (build.code !== 0) {
    process.stdout.write(build.out);
    process.exit(1);
  }
  const map = JSON.parse(readFileSync(`${BUNDLE}.map`, "utf8"));
  const bundle = {
    starts: lineStarts(readFileSync(BUNDLE, "utf8")),
    lines: decodeMappings(map.mappings),
    sources: map.sources.map((source) => repoPath(resolve(dirname(BUNDLE), source))),
  };

  const work = mkdtempSync(join(tmpdir(), "softsight-cobertura-"));
  const gates = {};
  const failed = [];
  try {
    for (const gate of GATES) {
      const [file, ...args] = gate.split(" ");
      const directory = join(work, file);
      mkdirSync(directory);
      const started = performance.now();
      const { code } = await run(process.execPath, [resolve(here, file), ...args], { NODE_V8_COVERAGE: directory });
      if (code !== 0) failed.push(gate);
      gates[gate] = [...filesFromCoverage(directory, bundle)].sort();
      const seconds = ((performance.now() - started) / 1000).toFixed(1).replace(".", ",");
      process.stdout.write(`${code === 0 ? "✓" : "✗"} ${gate}  ${seconds} s  ${gates[gate].length} ficheros\n`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    // Deja dist-node como lo deja el build de siempre, sin el mapa al lado.
    await run("npm", ["run", "build:agent3d"]);
  }

  if (failed.length > 0) {
    // Un mapa sacado de una suite en rojo atribuye lo que corrió hasta el fallo,
    // no lo que la puerta prueba: no se escribe.
    console.error(`mapa: no se escribe, ${failed.length} puertas en rojo — ${failed.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(dirname(MAP_PATH), { recursive: true });
  const document = {
    mapVersion: 1,
    sources: sourceFingerprint(resolve(projectRoot, "src")),
    bundleSources: bundle.sources,
    // Todo `src/` cuando se hizo el mapa: distingue un fichero de la demo —fuera
    // del paquete a propósito— de uno nuevo que el mapa todavía no conoce.
    srcFiles: listFiles(resolve(projectRoot, "src")).map((file) => `src/${file}`),
    gates,
  };
  writeFileSync(MAP_PATH, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`mapa: ${Object.keys(gates).length} puertas, ${bundle.sources.length} fuentes del paquete → ${repoPath(MAP_PATH)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
