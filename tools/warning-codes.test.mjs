/**
 * El registro de códigos de aviso contra el código que los emite.
 *
 * El tipo `WarningCode` ya impide emitir un código que no esté en la tabla: eso
 * no compila. Lo que el tipo **no** puede ver es lo contrario —una entrada que
 * sobra porque nadie la emite ya— ni los códigos que aparezcan en un `.mjs`, que
 * no pasa por el compilador. Esta puerta cierra las dos direcciones recorriendo
 * `src/soft/` con una expresión regular, que es leer lo mismo que leería alguien
 * buscando de dónde sale un aviso.
 *
 * Una tabla que se mantiene a mano diverge en el segundo código nuevo, y una
 * tabla divergida es peor que ninguna: el agente se la cree.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:codes`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PACKAGE_CODES,
  PACKAGE_CODE_LIST,
  PACKAGE_CODE_TABLE,
  PROPOSED_PACKAGE_CODES,
  WARNING_CODES,
  WARNING_CODE_LIST,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "../src/soft");

/**
 * Los dos sitios donde un aviso nace: el campo de un objeto literal y el
 * ayudante `add(...)` de `buildWarnings`. Buscar el literal suelto cazaría
 * también los nombres citados en los comentarios —`MALLA_INVERTIDA` sale en tres
 * explicaciones— y esta puerta trata de emisión, no de menciones.
 */
const EMISSION = /(?:code:\s*|add\(\s*)"([A-Z][A-Z0-9_]{3,})"/g;

/** Todos los ficheros `.ts` bajo `src/soft/`, sin seguir enlaces. */
function sources(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

const emitted = new Map();
for (const file of sources(sourceRoot)) {
  if (file.endsWith("warningCodes.ts")) continue; // la tabla no es una emisión
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(EMISSION)) {
    const list = emitted.get(match[1]) ?? [];
    list.push(file.slice(sourceRoot.length + 1));
    emitted.set(match[1], list);
  }
}

const inCode = [...emitted.keys()].sort();
const inTable = Object.keys(WARNING_CODES).sort();

const missing = inCode.filter((code) => !inTable.includes(code));
assert.deepEqual(
  missing,
  [],
  `códigos emitidos que no están en warningCodes.ts: ${missing
    .map((code) => `${code} (${emitted.get(code).join(", ")})`)
    .join("; ")}`,
);

const stale = inTable.filter((code) => !inCode.includes(code));
assert.deepEqual(stale, [], `entradas de warningCodes.ts que ya no emite nadie: ${stale.join(", ")}`);

console.log(`códigos: ok (${inTable.length} códigos, tabla y src/ coinciden en las dos direcciones)`);

// La lista publicada es la tabla, no una copia con vida propia: mismo conjunto,
// mismo orden, y `hasFix` derivado de `fixOp` en vez de escrito aparte.
assert.deepEqual(
  WARNING_CODE_LIST.map((entry) => entry.code),
  Object.keys(WARNING_CODES),
);
for (const entry of WARNING_CODE_LIST) {
  const table = WARNING_CODES[entry.code];
  assert.equal(entry.severity, table.severity);
  assert.equal(entry.cause, table.cause);
  assert.equal(entry.fixOp, table.fixOp);
  assert.equal(entry.hasFix, table.fixOp !== undefined, `${entry.code}: hasFix contradice a fixOp`);
  assert.ok(
    entry.severity === "certeza" || entry.severity === "candidato",
    `${entry.code}: severity fuera del vocabulario`,
  );
  assert.ok(entry.cause.length > 0 && !entry.cause.endsWith("."), `${entry.code}: cause de una línea`);
}

console.log(
  `códigos: ok (WARNING_CODE_LIST deriva de la tabla; ${
    WARNING_CODE_LIST.filter((entry) => entry.hasFix).length
  } con arreglo, ${WARNING_CODE_LIST.filter((entry) => entry.severity === "candidato").length} candidatos)`,
);

// Y lo que el agente ve de verdad: el registro sale por `--schema`, entero. Si
// se publicara una copia recortada, el agente creería una tabla que no es la que
// manda en la emisión.
const { stdout } = await promisify(execFile)(process.execPath, [resolve(here, "agent3d.mjs"), "--schema"], {
  maxBuffer: 64 * 1024 * 1024,
});
assert.deepEqual(JSON.parse(stdout).warningCodes, JSON.parse(JSON.stringify(WARNING_CODE_LIST)));
console.log("códigos: ok (--schema publica el registro igual que la biblioteca)");

// ---------------------------------------------------------------------------
// Los identificadores neutros de la frontera — D2, «test:codes extendida a
// identificadores únicos y estables».
// ---------------------------------------------------------------------------

// Únicos y con la forma del espacio. El identificador es lo que el otro lado
// parsea: uno repetido convierte dos causas en una sola rama de su código.
{
  const codes = PACKAGE_CODE_LIST.map((entry) => entry.code);
  assert.equal(new Set(codes).size, codes.length, "hay identificadores repetidos");
  for (const code of codes) {
    assert.match(code, /^SS-[A-Z]{2,6}-\d{3}$/, `${code}: fuera del formato del espacio`);
  }
  // El motivo canónico sí puede repetirse —dos causas distintas comparten
  // `ARTIFACT_PATH_ESCAPES_ROOT`, la ruta textual y el enlace— y por eso el
  // contrato dice que se parsea el identificador y no el motivo.
  for (const entry of PACKAGE_CODE_LIST) {
    assert.match(entry.reason, /^[A-Z][A-Z0-9_]+$/, `${entry.code}: motivo fuera de vocabulario`);
    assert.ok(entry.cause.length > 0 && !entry.cause.endsWith("."), `${entry.code}: causa de una línea`);
    assert.ok(
      entry.status === "FIJADO" || entry.status === "PROPUESTO",
      `${entry.code}: estado fuera del vocabulario`,
    );
  }
  console.log(
    `códigos: ok (${codes.length} identificadores de frontera, únicos y con formato; ` +
      `${PROPOSED_PACKAGE_CODES.length} propuestos a la espera de VideoMesh)`,
  );
}

// La tabla y lo que se emite coinciden en las dos direcciones, igual que arriba:
// un identificador que nadie emite es una promesa vacía, y uno emitido que no
// está en la tabla no se puede publicar.
{
  const emittedCodes = new Set(Object.values(PACKAGE_CODES));
  const tabled = new Set(Object.keys(PACKAGE_CODE_TABLE));
  assert.deepEqual(
    [...emittedCodes].filter((code) => !tabled.has(code)),
    [],
    "identificadores emitidos que no están en la tabla",
  );
  assert.deepEqual(
    [...tabled].filter((code) => !emittedCodes.has(code)),
    [],
    "entradas de la tabla que no emite nadie",
  );

  // Y los cuatro que fija D6 están fijados, no propuestos: si alguien los mueve a
  // PROPUESTO, es que ha cambiado una decisión sin tocar el registro.
  for (const code of ["SS-PKG-001", "SS-PKG-002", "SS-PKG-003", "SS-PKG-004"]) {
    assert.equal(PACKAGE_CODE_TABLE[code].status, "FIJADO", `${code}: D6 lo fija`);
    assert.equal(PACKAGE_CODE_TABLE[code].decision, "D6");
  }
  // Lo simétrico: ninguno sin decisión que lo fije puede estar como FIJADO.
  for (const entry of PACKAGE_CODE_LIST) {
    if (entry.status === "FIJADO") continue;
    assert.match(entry.decision, /sin número/, `${entry.code}: propuesto sin decir qué le falta`);
  }
  console.log(
    "códigos: ok (tabla y emisión coinciden; los cuatro de D6 fijados y el resto propuesto con su motivo)",
  );
}
