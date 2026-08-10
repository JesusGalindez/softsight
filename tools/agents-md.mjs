/**
 * Regenera las secciones automáticas de `AGENTS.md`.
 *
 * Un `AGENTS.md` escrito entero a mano es un documento que miente tres commits
 * después: alguien añade una puerta, no la apunta, y el agente frío que llega el
 * mes siguiente ejecuta una lista incompleta creyéndola completa. Es el mismo
 * error que el esquema evita —el esquema **es** el validador— y aquí se evita
 * igual: la lista de comandos y la de puertas salen de `package.json` y las
 * banderas del CLI de la salida de `--help`, y una prueba comprueba que el
 * fichero commiteado es idéntico al regenerado.
 *
 * Lo que **no** se genera es lo que un script no puede saber: dónde va un
 * cambio, qué se rompe si lo tocas y a qué documento ir. Eso se escribe a mano y
 * vive fuera de los delimitadores.
 *
 *   node tools/agents-md.mjs            reescribe AGENTS.md
 *   node tools/agents-md.mjs --check    sale 1 si el fichero no está al día
 *
 * Necesita `dist-node/agent3d.mjs` construido, porque lee `--help` del CLI de
 * verdad en vez de una copia.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const TARGET = resolve(projectRoot, "AGENTS.md");

const manifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
const scripts = manifest.scripts ?? {};

/** Delimitadores: lo de dentro se regenera, lo de fuera se escribe a mano. */
function replaceBlock(text, name, body) {
  const open = `<!-- generado: ${name} -->`;
  const close = `<!-- /generado: ${name} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < 0) throw new Error(`AGENTS.md no tiene el bloque '${name}'`);
  return `${text.slice(0, start + open.length)}\n${body}\n${text.slice(end)}`;
}

/**
 * Las puertas son los `test:*` de `package.json`, menos `test:animation`, que
 * es la suite entera y va aparte: listarla al lado de las demás haría creer que
 * es una más.
 */
function gatesBlock() {
  const gates = Object.keys(scripts)
    .filter((name) => name.startsWith("test:") && name !== "test:animation")
    .sort();
  // En una línea, no en tabla: qué ejecuta cada una ya está en `package.json`, y
  // una tabla de veinte filas se come el techo de 120 líneas sin decir más.
  return gates.map((name) => `\`npm run ${name}\``).join(" · ");
}

/**
 * Los comandos que no son puertas: lo que se usa para trabajar. `build`, `dev` y
 * `preview` quedan fuera porque son de la demo de navegador, que no es el
 * producto.
 */
function commandsBlock() {
  const skip = new Set(["dev", "build", "preview", "build:agent3d"]);
  const commands = Object.keys(scripts)
    .filter((name) => !name.startsWith("test:") && !skip.has(name))
    .sort();
  return [
    "| Orden | Para qué |",
    "|---|---|",
    "| `npm run verify` | **Lo primero y lo último.** Tipos y las puertas, la misma orden que ejecuta CI |",
    ...commands
      .filter((name) => name !== "verify")
      .map((name) => `| \`npm run ${name}\` | \`${scripts[name]}\` |`),
  ].join("\n");
}

/**
 * Las banderas del CLI, sacadas de `--help`. Solo los nombres: la explicación ya
 * está ahí y repetirla aquí sería el segundo original que este script existe
 * para evitar.
 */
function flagsBlock() {
  const help = execFileSync(process.execPath, [resolve(here, "agent3d.mjs"), "--help"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const flags = [...new Set([...help.matchAll(/^ {2}(--[a-z0-9-]+)/gm)].map((m) => m[1]))];
  return flags.map((flag) => `\`${flag}\``).join(" · ");
}

const original = readFileSync(TARGET, "utf8");
let generated = original;
generated = replaceBlock(generated, "comandos", commandsBlock());
generated = replaceBlock(generated, "puertas", gatesBlock());
generated = replaceBlock(generated, "banderas", flagsBlock());

if (process.argv.includes("--check")) {
  if (generated !== original) {
    process.stderr.write(
      "AGENTS.md no está al día: regenéralo con `node tools/agents-md.mjs`.\n",
    );
    process.exit(1);
  }
  const lines = original.split("\n").length;
  if (lines > 120) {
    process.stderr.write(`AGENTS.md tiene ${lines} líneas y el techo son 120.\n`);
    process.exit(1);
  }
  console.log(`agents-md: ok (${lines} líneas de 120, tres bloques generados al día)`);
} else {
  writeFileSync(TARGET, generated);
  console.log(`agents-md: reescrito (${generated.split("\n").length} líneas)`);
}
