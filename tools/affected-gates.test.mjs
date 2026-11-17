/**
 * Puerta de `verify:rapido`: que el selector elige lo que el mapa dice y, ante
 * cualquier duda, corre todo.
 *
 * Con un mapa sintético, porque la regla es lo que se prueba y no el mapa: el de
 * verdad lo hace `npm run verify:mapa` y cuesta la suite entera. Y el decodificador
 * de mapas de fuente, contra un caso calculado a mano, porque si se equivocara
 * atribuiría cada función al fichero de al lado y el selector elegiría puertas
 * que no tocan nada.
 */

import assert from "node:assert/strict";

import { selectGates } from "./affectedGates.mjs";
import { decodeMappings } from "./gateCoverage.mjs";

const GATES = ["a.test.mjs", "b.test.mjs", "c.test.mjs", "agents-md.mjs --check"];
const MAP = {
  mapVersion: 1,
  bundleSources: ["src/soft/agent/x.ts", "src/soft/agent/y.ts", "src/soft/agent/tablas.ts"],
  srcFiles: ["src/soft/agent/x.ts", "src/soft/agent/y.ts", "src/soft/agent/tablas.ts", "src/soft/softMain.ts"],
  gates: {
    "a.test.mjs": ["src/soft/agent/x.ts", "tools/bridge.mjs"],
    "b.test.mjs": ["src/soft/agent/y.ts"],
    "c.test.mjs": ["src/soft/agent/x.ts", "src/soft/agent/y.ts"],
    "agents-md.mjs --check": [],
  },
};

const elige = (changed) => selectGates(MAP, changed, GATES);

// Lo que el mapa atribuye.
assert.deepEqual(elige(["src/soft/agent/y.ts"]).gates, ["b.test.mjs", "c.test.mjs"]);
assert.deepEqual(elige(["tools/bridge.mjs"]).gates, ["a.test.mjs"]);
assert.deepEqual(elige(["tools/b.test.mjs"]).gates, ["b.test.mjs"]);
assert.deepEqual(elige(["AGENTS.md", "docs/plan-mejora.md"]).gates, ["agents-md.mjs --check"]);
assert.deepEqual(elige(["src/soft/softMain.ts"]).gates, [], "la demo del navegador no la ejecuta ninguna puerta");
console.log("rápido: ok (elige las puertas que el mapa atribuye, la propia puerta, AGENTS.md a la suya, y la demo a ninguna)");

// Y ante la duda, todas, con el motivo.
for (const [changed, motivo] of [
  [["src/soft/agent/tablas.ts"], /ninguna puerta lo ejecuta/],
  [["src/soft/agent/nuevo.ts"], /no está en el mapa/],
  [["package.json"], /suite entera/],
  [["artifacts/agent/ejemplo-dron.json"], /suite entera/],
]) {
  const { gates, reasons } = elige(changed);
  assert.deepEqual(gates, GATES, `${changed} tendría que correr todas`);
  assert.match(reasons.join("\n"), motivo);
}
assert.deepEqual(selectGates(null, ["src/soft/agent/x.ts"], GATES).gates, GATES, "sin mapa, todas");
console.log("rápido: ok (sin mapa, un fichero desconocido, uno del paquete sin atribuir o una configuración: todas, con su motivo)");

// El decodificador de mapas de fuente: «AAAA,CCAA;AAAA» son tres trozos, dos en la
// línea 0 —columna 0 de la fuente 0, y columna +1 con fuente +1— y uno en la
// línea 1: la columna vuelve a 0 con la línea, y la fuente sigue en 1 porque su
// índice es relativo y no se reinicia.
assert.deepEqual(decodeMappings("AAAA,CCAA;AAAA"), [[[0, 0], [1, 1]], [[0, 1]]]);
// «gBAAA»: un valor de dos dígitos —columna 16— para cazar el acarreo de VLQ.
assert.deepEqual(decodeMappings("gBAAA"), [[[16, 0]]]);
console.log("rápido: ok (el decodificador de mapas de fuente lee índices relativos y valores de varios dígitos)");
