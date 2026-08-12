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

import {
  PATCH_SCHEMA,
  SAMPLE_REFERENCE_SCHEMA,
  SCENE_SCHEMA,
  STAGING_SCHEMA,
  STORY_SCHEMA,
  validate,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const SCHEMAS = {
  scene: SCENE_SCHEMA,
  patch: PATCH_SCHEMA,
  story: STORY_SCHEMA,
  staging: STAGING_SCHEMA,
  "sample-reference": SAMPLE_REFERENCE_SCHEMA,
};

// 1. Lo commiteado es lo generado.
{
  execFileSync(process.execPath, [resolve(here, "contracts.mjs"), "--check"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  console.log(`contratos: ok (los ${Object.keys(SCHEMAS).length} esquemas publicados están al día)`);
}

/**
 * Los objetos que hoy **no** cierran la puerta a campos desconocidos, uno a uno.
 *
 * No es una excepción que se concede: es la deuda de D30, escrita. Un campo
 * declarado `object` sin `fields` no lo recorre `validate` ni lo cierra
 * `toJsonSchema`, así que dentro de él cabe cualquier cosa. La lista está aquí
 * para que **uno nuevo ponga la puerta roja**: aparecer en la frontera pública
 * sin declararse deja de ser gratis.
 *
 * Dos clases, y solo una es deuda:
 *
 *   - **Datos libres, a propósito**: `clips.tracks.value` es una tabla de
 *     función declarada y `scenes.data` dice en su propia descripción que admite
 *     campos de más porque son datos, no maqueta.
 *   - **Forma escrita en la descripción y no en el esquema**: las cuatro
 *     deformaciones, los puntos de un recorrido, la geometría cruda y las tablas
 *     de radius y twist. Ahí `{ axis, degrees }` está en prosa, y una errata
 *     dentro pasa. Declararlas como `fields` es lo que cierra la primera fila de
 *     D30 del todo; no entra en S3 porque toca el esquema del núcleo y sus
 *     puertas, no la frontera.
 */
const OPAQUE = new Set([
  "scene.properties.objects.items.properties.deform.items.properties.twist",
  "scene.properties.objects.items.properties.deform.items.properties.taper",
  "scene.properties.objects.items.properties.deform.items.properties.bend",
  "scene.properties.objects.items.properties.deform.items.properties.wave",
  "scene.properties.objects.items.properties.geometry.anyOf[0]",
  "scene.properties.objects.items.properties.geometry.anyOf[5].properties.path.properties.through.items",
  "scene.properties.objects.items.properties.geometry.anyOf[6].properties.path.properties.through.items",
  "scene.properties.objects.items.properties.geometry.anyOf[6].properties.radius.anyOf[1]",
  "scene.properties.objects.items.properties.geometry.anyOf[6].properties.twist.anyOf[1]",
  "scene.properties.clips.items.properties.tracks.items.properties.value",
  "patch.properties.edits.items.properties.object.properties.deform.items.properties.twist",
  "patch.properties.edits.items.properties.object.properties.deform.items.properties.taper",
  "patch.properties.edits.items.properties.object.properties.deform.items.properties.bend",
  "patch.properties.edits.items.properties.object.properties.deform.items.properties.wave",
  "patch.properties.edits.items.properties.object.properties.geometry.anyOf[0]",
  "patch.properties.edits.items.properties.object.properties.geometry.anyOf[5].properties.path.properties.through.items",
  "patch.properties.edits.items.properties.object.properties.geometry.anyOf[6].properties.path.properties.through.items",
  "patch.properties.edits.items.properties.object.properties.geometry.anyOf[6].properties.radius.anyOf[1]",
  "patch.properties.edits.items.properties.object.properties.geometry.anyOf[6].properties.twist.anyOf[1]",
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
      `${opaque.size} opacos declarados, la deuda de D30)`,
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
