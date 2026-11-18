#!/usr/bin/env node
/**
 * El estado como dato (plan de mejora, fase 4).
 *
 * Hasta el 2026-11-17 el estado del proyecto vivía en prosa, y la prosa se
 * contradecía: «16 de 21 puertas» en `AGENTS.md` con 58 en la suite, «siete
 * herramientas» en el README con once, D12 «a medias» en su título y entera en la
 * tabla. Ninguno era mentira cuando se escribió; todos lo eran tres commits
 * después. Es el error que `agents-md.mjs` ya evita para `AGENTS.md`, y aquí se
 * evita igual para el resto: **lo que se puede contar, lo cuenta un script**.
 *
 * Lo que hace:
 *
 * ```text
 * docs/estado.json        la foto del repositorio en ~2 KB: versiones, decisiones,
 *                         puertas, comandos del puente, herramientas MCP. Lo
 *                         publica `agent3d --status`, y es la entrada de un agente
 *                         frío en vez de leerse 134 KB de documentos
 * bloques generados       los recuentos del README, del mapa §4 y del registro
 *                         del contrato §2, entre `<!-- generado: … -->`
 * la regla de la prosa    en esos mismos documentos, un recuento escrito a mano
 *                         fuera de un bloque pone la puerta roja
 * ```
 *
 * De dónde sale cada dato, y por qué de ahí:
 *
 * ```text
 * versiones de contrato    src/soft/agent/versions.ts, vía el paquete construido
 * decisiones               los títulos de docs/contrato-videomesh.md
 * puertas                  GATES de tools/run-tests.mjs y los test:* de package.json
 * fixture del editor       las puertas que llaman a requireFixtures()
 * comandos del puente      COMMANDS de tools/bridge.mjs
 * herramientas MCP         TOOLS de tools/mcp-server.mjs
 * banderas del CLI         la salida de --help, como agents-md.mjs
 * ```
 *
 * **El estado de una decisión es el sufijo de su título**, que es la convención
 * que el registro ya sigue: `— IMPLEMENTADA (2026-09-14)`, `— IMPLEMENTADA a
 * medias (…)`, `— REVERTIDA (…)`, `— PROPUESTA (…)`. Sin sufijo, ACORDADA: es el
 * único de los cuatro estados del §1.1 que el registro escribe sin marca. La tabla
 * del §2 se genera de los títulos, así que los dos ya no pueden decir cosas
 * distintas.
 *
 * Lo que **no** se genera, y por eso no está aquí: qué toca ahora y de quién es.
 * Eso es criterio, y vive escrito a mano en el mapa §5.
 *
 *   node tools/estado.mjs            reescribe estado.json y los bloques
 *   node tools/estado.mjs --check    sale 1 si algo no está al día
 *
 * Necesita `dist-node/agent3d.mjs` construido.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTRACT_VERSIONS } from "../dist-node/agent3d.mjs";
import { COMMANDS } from "./bridge.mjs";
import { TOOLS } from "./mcp-server.mjs";
import { GATES } from "./run-tests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const at = (path) => resolve(projectRoot, path);

export const STATUS_PATH = at("docs/estado.json");
const CONTRACT_DOC = at("docs/contrato-videomesh.md");

/** Los cuatro estados del §1.1 del contrato, y el «a medias» que el registro usa. */
const STATES = ["IMPLEMENTADA", "IMPLEMENTADA a medias", "ACORDADA", "PROPUESTA", "REVERTIDA"];

/**
 * Las decisiones, por estado, leídas de sus títulos. Un título sin sufijo de estado
 * es ACORDADA; uno con un sufijo que no es de los cuatro, un error: si no, una
 * errata de estado pasaría por ACORDADA sin que nadie lo viera.
 */
export function readDecisions(text) {
  const byState = Object.fromEntries(STATES.map((state) => [state, []]));
  for (const line of text.split("\n")) {
    const match = /^### (D\d+) — (.*)$/.exec(line);
    if (match === null) continue;
    const [, id, rest] = match;
    const suffix = / — (IMPLEMENTADA a medias|IMPLEMENTADA|PROPUESTA|REVERTIDA|ACORDADA) \(\d{4}-\d{2}-\d{2}\)$/.exec(rest);
    const looksLikeState = /— [A-ZÁÉÍÓÚ]{6,}( [a-z]+)* \(\d{4}-\d{2}-\d{2}\)$/.test(rest);
    if (suffix === null && looksLikeState) throw new Error(`${id}: estado desconocido en el título «${rest}»`);
    byState[suffix?.[1] ?? "ACORDADA"].push(id);
  }
  return byState;
}

/** El nombre de puerta del script de un `test:*`, como aparece en GATES. */
function gateOfScript(command) {
  const match = /node tools\/(\S+)(.*)$/.exec(command);
  return match === null ? null : `${match[1]}${match[2]}`.trim();
}

function buildStatus() {
  const manifest = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const decisions = readDecisions(readFileSync(CONTRACT_DOC, "utf8"));
  const total = Object.values(decisions).reduce((sum, ids) => sum + ids.length, 0);
  const gates = new Set(GATES);
  const outsideSuite = Object.entries(manifest.scripts)
    .filter(([name]) => name.startsWith("test:") && name !== "test:animation")
    .filter(([, command]) => !gates.has(gateOfScript(command)))
    .map(([name]) => name)
    .sort();
  const editorFixture = readdirSync(here)
    .filter((name) => name.endsWith(".test.mjs"))
    .filter((name) => readFileSync(resolve(here, name), "utf8").includes("requireFixtures("))
    .map((name) => name.replace(/\.test\.mjs$/, ""))
    .sort();
  const help = execFileSync(process.execPath, [resolve(here, "agent3d.mjs"), "--help"], { cwd: projectRoot, encoding: "utf8" });
  const flags = new Set([...help.matchAll(/^ {2}(--[a-z0-9-]+)/gm)].map((match) => match[1]));

  return {
    documentType: "softsight.status",
    statusVersion: 1,
    softsight: manifest.version,
    contracts: Object.fromEntries(Object.entries(CONTRACT_VERSIONS).map(([name, entry]) => [name, entry.value])),
    decisions: { total, ...decisions },
    gates: { inSuite: GATES.length, outsideSuite, needEditorFixture: editorFixture },
    bridge: { commands: [...COMMANDS] },
    mcp: { tools: Object.keys(TOOLS) },
    cli: { flags: flags.size },
    next: "docs/mapa-del-proyecto.md §5: qué toca ahora y de quién es, escrito a mano",
  };
}

// ---------------------------------------------------------------------------
// Los bloques

const list = (items) => items.map((item) => `\`${item}\``).join(", ");

/** Cada bloque: dónde vive y qué lleva. El texto alrededor se escribe a mano. */
function blocks(status) {
  const { decisions, gates } = status;
  const row = (label, ids) => {
    const head = `${label.padEnd(23)}${String(ids.length).padStart(3)}`;
    if (ids.length === 0) return head;
    // Diez por línea, como estaba la tabla escrita a mano.
    const lines = [];
    for (let index = 0; index < ids.length; index += 10) lines.push(ids.slice(index, index + 10).join(", "));
    return `${head}   ${lines.join(`,\n${" ".repeat(29)}`)}`;
  };
  const implemented = [...decisions.IMPLEMENTADA, ...decisions["IMPLEMENTADA a medias"].map((id) => `${id} (a medias)`)]
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return [
    {
      file: "README.md",
      name: "herramientas-mcp",
      body:
        `\`tools/mcp-server.mjs\` publica ${status.mcp.tools.length} herramientas tipadas por JSON-RPC sobre stdio, ` +
        `sin dependencias, una por cada comando del puente: ${list(status.mcp.tools)}.`,
    },
    {
      file: "docs/mapa-del-proyecto.md",
      name: "puertas-ci",
      body:
        `La suite (\`npm run test:animation\`) son ${gates.inSuite} puertas. Estas ${gates.needEditorFixture.length} ` +
        `leen el fixture certificado del editor, que es un repositorio privado, y **en CI no corren**: se declaran ` +
        `«no ejecutada» con su motivo impreso — ${list(gates.needEditorFixture)}. Fuera de la suite quedan ` +
        `${list(gates.outsideSuite)}; de esas, CI corre \`test:determinism\` aparte, en dos sistemas.`,
    },
    {
      file: "docs/contrato-videomesh.md",
      name: "registro",
      body: [
        "```text",
        row("ACORDADAS", decisions.ACORDADA),
        row("PROPUESTAS", decisions.PROPUESTA),
        row("IMPLEMENTADAS", implemented),
        ...(decisions.REVERTIDA.length > 0 ? [row("REVERTIDAS", decisions.REVERTIDA)] : []),
        "```",
      ].join("\n"),
    },
  ];
}

function replaceBlock(text, file, name, body) {
  const open = `<!-- generado: ${name} -->`;
  const close = `<!-- /generado: ${name} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < 0) throw new Error(`${file} no tiene el bloque '${name}'`);
  return `${text.slice(0, start + open.length)}\n${body}\n${text.slice(end)}`;
}

// ---------------------------------------------------------------------------
// La regla de la prosa

/**
 * Un recuento de estado escrito a mano: una cifra, o un número de siete en
 * adelante con letra, delante de `herramientas`, `puertas` o `comprobaciones`.
 *
 * Del uno al seis con letra se deja pasar a propósito: «las dos puertas cruzadas»
 * o «tres herramientas de medida» nombran cosas concretas que se pueden contar
 * leyendo la frase, no un total del repositorio que cambia con cada commit. Los
 * totales empiezan donde ya no se cuentan a ojo.
 */
const HAND_COUNT =
  /\b(\d[\d.]*|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte\w*|treinta\w*|cuarenta\w*|cincuenta\w*|sesenta\w*)\s+(herramientas|puertas|comprobaciones)\b/gi;

/** Las secciones donde se vigila, por documento: el texto entre dos títulos. */
const WATCHED = [
  { file: "README.md" },
  { file: "AGENTS.md" },
  { file: "docs/mapa-del-proyecto.md", from: "## 4.", to: "## 5." },
  { file: "docs/contrato-videomesh.md", from: "## 2.", to: "## 3." },
];

/** Los recuentos a mano de un texto, sin mirar dentro de los bloques generados. */
export function handCounts(text) {
  const outside = text.replace(/<!-- generado: ([\w-]+) -->[\s\S]*?<!-- \/generado: \1 -->/g, "");
  return [...outside.matchAll(HAND_COUNT)].map((match) => match[0]);
}

function watchedText(text, { from, to }) {
  if (from === undefined) return text;
  const start = text.indexOf(`\n${from}`);
  const end = text.indexOf(`\n${to}`, start + 1);
  if (start < 0 || end < 0) throw new Error(`no encuentro la sección ${from}`);
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------

function main() {
  const check = process.argv.includes("--check");
  const status = buildStatus();
  const json = `${JSON.stringify(status, null, 2)}\n`;
  const stale = [];

  const current = existsSync(STATUS_PATH) ? readFileSync(STATUS_PATH, "utf8") : null;
  if (current !== json) {
    if (check) stale.push("docs/estado.json");
    else writeFileSync(STATUS_PATH, json);
  }
  const byFile = new Map();
  for (const block of blocks(status)) {
    const text = byFile.get(block.file) ?? readFileSync(at(block.file), "utf8");
    byFile.set(block.file, replaceBlock(text, block.file, block.name, block.body));
  }
  for (const [file, text] of byFile) {
    if (readFileSync(at(file), "utf8") === text) continue;
    if (check) stale.push(file);
    else writeFileSync(at(file), text);
  }

  const counts = [];
  for (const watched of WATCHED) {
    const text = watchedText(readFileSync(at(watched.file), "utf8"), watched);
    for (const count of handCounts(text)) counts.push(`${watched.file}: «${count}»`);
  }

  if (stale.length > 0) {
    console.error(`estado: no está al día — ${stale.join(", ")}. Regenera con \`node tools/estado.mjs\``);
  }
  if (counts.length > 0) {
    console.error(
      `estado: recuentos escritos a mano, que se quedan viejos en el commit siguiente — ${counts.join("; ")}. ` +
        "Van en un bloque generado, o sin número",
    );
  }
  if (stale.length > 0 || counts.length > 0) process.exit(1);

  const size = Buffer.byteLength(json);
  console.log(
    check
      ? `estado: ok (estado.json en ${size} B y ${byFile.size} documentos con sus bloques al día; ningún recuento a mano en lo vigilado)`
      : `estado: reescrito (estado.json en ${size} B)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
