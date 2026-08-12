/**
 * Puerta de la frontera pública — D15 y D30 del contrato con VideoMesh.
 *
 * Tres cosas, y las tres fallan si alguien deshace la decisión:
 *
 *   1. `contracts/*.schema.json` commiteado es idéntico al que sale del esquema
 *      en ejecución. Si divergen, el otro repositorio deriva sus modelos de una
 *      frontera que ya no es la que valida.
 *   2. Todo objeto del JSON Schema publicado lleva `additionalProperties: false`.
 *      Es la mitad de D30 que viaja al otro lado: sin eso, el validador de allí
 *      acepta lo que el de aquí rechaza.
 *   3. El fixture `unknown-field-v1`: cada documento suyo se rechaza por su
 *      motivo y por la ruta correcta, y los que deben pasar pasan. Sin los casos
 *      de `accept`, un validador que rechazara todo también aprobaría esta
 *      puerta.
 *
 * Lo que **no** cubre, y por qué la puerta lo dice en voz alta: las filas de
 * extensión requerida y opcional de D30 necesitan un espacio `extensions` que
 * ningún esquema tiene todavía. Se declaran NOT_RUN con su motivo, nunca verde,
 * como manda D22 para lo que no se puede ejecutar.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../dist-node/agent3d.mjs";
import { PUBLISHED } from "./contracts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/**
 * Los mismos que publica `contracts.mjs`, importados de allí y no copiados: una
 * segunda lista se quedaría corta en cuanto se publicara un esquema nuevo, y la
 * puerta diría que todo está bien sin haberlo mirado.
 */
const SCHEMAS = PUBLISHED;

// 1. Lo commiteado es lo generado.
{
  execFileSync(process.execPath, [resolve(here, "contracts.mjs"), "--check"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  console.log(`contratos: ok (los ${Object.keys(SCHEMAS).length} esquemas publicados están al día)`);
}

/**
 * Los dos objetos de la frontera que **no** cierran la puerta a campos
 * desconocidos, y por qué cada uno.
 *
 * Eran veinte. Dieciocho eran deuda de D30 —la forma escrita en la descripción y
 * no en el esquema— y se cerraron declarándola: las cuatro deformaciones, los
 * puntos de un recorrido, las tablas de variación y la forma genérica que `anyOf`
 * arrastraba al lado de las alternativas de verdad. Quedan dos, y los dos son
 * datos libres **a propósito**:
 *
 *   - `clips.tracks.value` es una pista declarada como función, con la tabla
 *     `{ at: [[u, [valores]], …], ease }`: el valor de cada par es una lista de
 *     longitud variable según lo que se anime, y eso el vocabulario de tipos no
 *     lo dice. La comprueba `evaluateVariation`, que es quien la lee.
 *   - `scenes.data` lo dice en su propia descripción: son datos, no maqueta, y
 *     admite campos de más porque el guion los lleva.
 *
 * La lista está aquí para que **uno nuevo ponga la puerta roja**, y para que uno
 * que deje de existir tampoco se quede.
 */
const OPAQUE = new Set([
  "scene.properties.clips.items.properties.tracks.items.properties.value",
  "story.properties.scenes.items.properties.data",
]);

// 2. `additionalProperties: false` en todos los objetos publicados, a cualquier
// profundidad, salvo los declarados opacos: es la forma que tiene D30 de cruzar
// al otro lado.
{
  let closed = 0;
  const opaque = new Set();
  const walk = (node, where) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${where}[${index}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (node.type === "object") {
      if (node.additionalProperties === false) closed += 1;
      else {
        assert.ok(OPAQUE.has(where), `${where} admite campos desconocidos y no está declarado opaco`);
        opaque.add(where);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "description") continue;
      walk(value, `${where}.${key}`);
    }
  };
  for (const name of Object.keys(SCHEMAS)) {
    const path = resolve(projectRoot, "contracts", `${name}.schema.json`);
    walk(JSON.parse(readFileSync(path, "utf8")), name);
  }
  // Una entrada que ya no corresponde a nada se limpia: si se queda, la lista
  // deja de decir cuánta deuda hay.
  const gone = [...OPAQUE].filter((path) => !opaque.has(path));
  assert.equal(gone.length, 0, `sobran en la lista de opacos: ${gone.join(", ")}`);
  console.log(
    `contratos: ok (additionalProperties: false en ${closed} objetos publicados; ` +
      `${opaque.size} opacos declarados y a propósito)`,
  );
}

// 3. El fixture. Ligero y versionado, D22: son unos kilobytes de JSON sintético.
{
  const fixture = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/fixtures/unknown-field-v1.json"), "utf8"),
  );

  for (const testCase of fixture.reject) {
    const errors = validate(testCase.document, SCHEMAS[testCase.schema]);
    assert.ok(errors.length > 0, `${testCase.name}: se aceptó un campo desconocido`);
    // Por la ruta y no por el texto entero: lo que la decisión exige es que el
    // error señale **el campo** que sobra. Comparar el mensaje literal ataría el
    // fixture a la redacción y lo rompería cada vez que mejore.
    const named = errors.filter((error) => error.startsWith(`${testCase.path} no existe`));
    assert.equal(named.length, 1, `${testCase.name}: ningún error señala ${testCase.path}: ${errors}`);
    // La calidad del mensaje es parte de la decisión, no un adorno: o sugiere el
    // campo que se quiso escribir, o enumera los admitidos. «No existe» a secas
    // deja al agente adivinando otra vez.
    if (testCase.suggests !== undefined) {
      assert.ok(
        named[0].includes(`¿querías decir ${testCase.suggests}?`),
        `${testCase.name}: no sugiere ${testCase.suggests}: ${named[0]}`,
      );
    }
    if (testCase.lists === true) {
      assert.ok(named[0].includes("admitidos:"), `${testCase.name}: no enumera los admitidos: ${named[0]}`);
    }
  }

  for (const testCase of fixture.accept) {
    const errors = validate(testCase.document, SCHEMAS[testCase.schema]);
    assert.equal(errors.length, 0, `${testCase.name}: se rechazó una entrada válida: ${errors}`);
  }

  console.log(
    `contratos: ok (unknown-field-v1: ${fixture.reject.length} documentos rechazados por su campo, ` +
      `${fixture.accept.length} aceptados)`,
  );
}

// Las otras dos filas de D30, a la vista y sin ejecutar.
console.log(
  "contratos: no ejecutada — las filas de extensión de D30 (requerida desconocida → UNSUPPORTED, " +
    "opcional desconocida → política) piden un espacio `extensions` que ningún esquema declara todavía; " +
    "D30 sigue ACORDADA",
);
