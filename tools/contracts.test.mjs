/**
 * Puerta de la frontera pública — D15 y D30 del contrato con VideoMesh.
 *
 * Cuatro cosas, y las cuatro fallan si alguien deshace la decisión:
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
 *   4. El bloque de versiones de D12: ningún número de contrato vive fuera del
 *      registro, y una combinación que nadie ha declarado se rechaza.
 *   5. La negociación de capabilities de D31: requerida desconocida para el
 *      consumo, provista desconocida se preserva y se nombra.
 *   6. Las otras dos filas de D30, que hasta el 2026-09-13 no se podían ejercer
 *      porque ningún esquema declaraba `extensions`: una extensión **requerida**
 *      desconocida deja el paquete UNSUPPORTED con salida 21, y una **opcional**
 *      desconocida se preserva y se nombra en el informe, que es la política que
 *      la decisión dejaba abierta.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_POLICY,
  CONTRACT_VERSIONS,
  CURRENT_VERSION_PAIRS,
  EXTENSION_POLICY,
  PACKAGE_CODES,
  SUPPORTED_CAPABILITIES,
  exitCodeFor,
  ingestPackage,
  isDeclaredVersionSet,
  validate,
} from "../dist-node/agent3d.mjs";
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
  // El tercero es el espacio de extensiones de D30, y su opacidad **es** la
  // decisión: la carga de una extensión es del productor, y darle forma aquí
  // sería declarar frontera un experimento. Lo que no es libre es su envoltorio
  // —`required` y `data`, y nada más— ni la clave, que el patrón obliga a ser un
  // espacio de nombres. La puerta queda cerrada donde D30 la quiere cerrada.
  "reconstruction-package.properties.extensions.patternProperties." +
    "^[a-z][a-z0-9]*(\\.[a-z0-9-]+){2,}$.properties.data",
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

// 2.5 El registro de hashes de D16: generado del artefacto, no copiado a mano.
{
  const registry = JSON.parse(readFileSync(resolve(projectRoot, "contracts/registry.json"), "utf8"));
  assert.deepEqual(
    registry.schemas.map((entry) => entry.name).sort(),
    Object.keys(SCHEMAS).sort(),
    "el registro no lista los mismos esquemas que se publican",
  );
  for (const entry of registry.schemas) {
    const contenido = readFileSync(resolve(projectRoot, "contracts", `${entry.name}.schema.json`));
    assert.equal(
      createHash("sha256").update(contenido).digest("hex"),
      entry.sha256,
      `${entry.name}: el hash del registro no es el del fichero`,
    );
    assert.equal(contenido.length, entry.bytes, `${entry.name}: el tamaño del registro no es el del fichero`);
  }
  assert.ok(registry.contractVersions.length > 0, "el registro no dice qué versiones se aceptan");
  console.log(
    `contratos: ok (registro de D16: ${registry.schemas.length} hashes que son los de los ficheros, ` +
      `versiones aceptadas ${registry.contractVersions.join(", ")})`,
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

// 4. Las otras dos filas de D30, que ya se pueden ejercer.
{
  const base = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/fixtures/package-integrity-v1.json"), "utf8"),
  ).base;
  // Ningún artifact llega a mirarse en estos casos: o el paquete se para antes,
  // o lo que se comprueba es el reparto de las extensiones. Si algo toca el
  // lector, es que la política no decidió donde tenía que decidir.
  const reader = {
    root: base.packageId,
    stat: () => {
      throw new Error("las extensiones se deciden antes de tocar un artifact");
    },
  };
  const withExtensions = (extensions) => ({ ...base, artifacts: [], extensions });

  // Fila 1: la clave tiene que ser un espacio de nombres. Sin esto, `extensions`
  // es el cajón donde acaba lo que no cabía en el esquema.
  const malaClave = validate(withExtensions({ foo: { required: false } }), SCHEMAS["reconstruction-package"]);
  assert.equal(malaClave.length, 1, `una clave sin espacio de nombres tiene que rechazarse: ${malaClave}`);
  assert.match(malaClave[0], /^extensions\["foo"\] no es una clave admitida/);

  // Y dentro del envoltorio la puerta sigue cerrada: `required` y `data`, nada más.
  const campoDeMas = validate(
    withExtensions({ "org.videomesh.experimental.foo": { required: false, niveles: 3 } }),
    SCHEMAS["reconstruction-package"],
  );
  assert.equal(campoDeMas.length, 1, `el envoltorio de una extensión no admite campos de más: ${campoDeMas}`);
  assert.match(campoDeMas[0], /niveles no existe/);

  // `required` sin valor por defecto: suponerlo `false` convertiría en silencio
  // una extensión que cambia el sentido de los datos.
  const sinRequired = validate(
    withExtensions({ "org.videomesh.experimental.foo": {} }),
    SCHEMAS["reconstruction-package"],
  );
  assert.equal(sinRequired.length, 1, `required es obligatorio: ${sinRequired}`);

  // Fila 2: extensión requerida desconocida → UNSUPPORTED, con salida 21.
  const requerida = ingestPackage(
    withExtensions({ "org.videomesh.experimental.foo": { required: true } }),
    reader,
  );
  assert.equal(requerida.execution, "UNSUPPORTED", "una extensión requerida que no se entiende no se mide");
  assert.deepEqual(
    requerida.issues.map((entry) => entry.code),
    [PACKAGE_CODES.EXTENSION_REQUERIDA_NO_SOPORTADA],
  );
  assert.equal(exitCodeFor(requerida), 21, "21 es «este contrato no lo leo», y eso es lo que pasa");

  // Fila 3: extensión opcional desconocida → se preserva y se **declara**.
  const opcional = ingestPackage(
    withExtensions({ "org.videomesh.experimental.foo": { required: false, data: { lo: "que sea" } } }),
    reader,
  );
  assert.equal(opcional.execution, "COMPLETE", "una opcional desconocida no impide consumir el paquete");
  assert.deepEqual(opcional.issues, []);
  assert.deepEqual(opcional.extensions, { honoured: [], ignored: ["org.videomesh.experimental.foo"] });
  assert.equal(EXTENSION_POLICY, "preservar-y-declarar");

  // Y la regla discrimina: la misma extensión, con el despliegue que sí la
  // entiende, entra por la otra rama. Sin este caso, un binario que declarara
  // todo desconocido también aprobaría la puerta.
  const entendida = ingestPackage(
    withExtensions({ "org.videomesh.experimental.foo": { required: true } }),
    reader,
    { supportedExtensions: ["org.videomesh.experimental.foo"] },
  );
  assert.equal(entendida.execution, "COMPLETE");
  assert.deepEqual(entendida.extensions, { honoured: ["org.videomesh.experimental.foo"], ignored: [] });

  console.log(
    "contratos: ok (D30 entera: clave fuera del espacio, envoltorio cerrado, `required` obligatorio, " +
      "requerida desconocida → UNSUPPORTED con salida 21, opcional desconocida preservada y declarada, " +
      "y la misma extensión entendida entra por la otra rama)",
  );
}

// 5. El bloque de versiones — D12 y el hueco (h) del §86.2.
//
// Eran siete números en cinco ficheros y ninguna tabla que dijera cuáles van
// juntos. Lo que la decisión pide es que el consumidor compruebe **el bloque**,
// así que aquí se comprueban las dos mitades: que no queden números sueltos, y
// que una combinación sin declarar no pase.
{
  const versions = JSON.parse(readFileSync(resolve(projectRoot, "contracts/versions.json"), "utf8"));

  // La combinación vigente es una de las declaradas —hoy es la única— y el
  // fichero publicado dice lo mismo que el registro en ejecución.
  assert.ok(
    isDeclaredVersionSet(CURRENT_VERSION_PAIRS, versions.declared),
    "la combinación vigente no está declarada en contracts/versions.json",
  );
  assert.deepEqual(
    versions.contracts.map((entry) => entry.name).sort(),
    Object.keys(CONTRACT_VERSIONS).sort(),
    "el fichero publicado no lista los mismos contratos que el registro",
  );

  // Y la puerta discrimina: subir un número sin declarar la combinación nueva es
  // justo lo que esto existe para impedir. Sin este caso, una función que
  // devolviera siempre `true` también aprobaría la puerta.
  const subida = CURRENT_VERSION_PAIRS.map((pair) =>
    pair.name === "stagingAudit" ? { ...pair, value: 2 } : { ...pair },
  );
  assert.equal(
    isDeclaredVersionSet(subida, versions.declared),
    false,
    "una combinación con una versión subida y sin declarar tiene que rechazarse",
  );
  // Y no basta con que los números existan por separado: quitar un contrato del
  // bloque deja una combinación distinta, aunque cada número siga siendo válido.
  assert.equal(
    isDeclaredVersionSet(CURRENT_VERSION_PAIRS.slice(1), versions.declared),
    false,
    "un bloque incompleto no es la combinación declarada",
  );

  // La otra mitad: ningún número de contrato escrito fuera del registro. El
  // puente es la excepción declarada —`agent3d --serve` importa `handleRequest`
  // de él, así que importar el artefacto construido cerraría un ciclo— y por eso
  // se compara aquí en vez de importarse allí.
  const bridge = readFileSync(resolve(projectRoot, "tools/bridge.mjs"), "utf8");
  const literal = /^const BRIDGE_CONTRACT_VERSION = (\d+);$/m.exec(bridge);
  assert.ok(literal !== null, "el puente ya no declara su versión como se esperaba");
  assert.equal(
    Number(literal[1]),
    CONTRACT_VERSIONS.bridge.value,
    "el número del puente y el del registro han divergido",
  );

  console.log(
    `contratos: ok (D12: ${versions.contracts.length} contratos en un bloque, la combinación vigente ` +
      "declarada, una subida sin declarar y un bloque incompleto rechazados, y el puente al día)",
  );
}

// 6. La negociación de capabilities — D31.
//
// Misma forma que las extensiones y por eso comparte la función que decide: lo
// requerido desconocido para, lo provisto desconocido se preserva. Lo que cambia
// es qué se negocia —comportamiento, no forma de los datos— y que aquí la lista
// de lo que sabemos hacer **no está vacía**: son nombres para trabajo que una
// puerta ejerce hoy.
{
  const base = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/fixtures/package-integrity-v1.json"), "utf8"),
  ).base;
  const reader = {
    root: base.packageId,
    stat: () => {
      throw new Error("las capabilities se deciden antes de tocar un artifact");
    },
  };
  const withCapabilities = (extra) => ({ ...base, artifacts: [], ...extra });

  // Requerida desconocida: no se mide nada. Y el mensaje dice qué sabemos hacer,
  // porque «no soportada» a secas manda al productor a adivinar el nombre.
  // `confidence` y no `coverage`: la segunda entró el 2026-09-13 cuando el módulo
  // existió, y el caso vivo tiene que ser una capacidad que de verdad no
  // tengamos. Usar una ya soportada convertiría la prueba en adorno.
  const pide = ingestPackage(withCapabilities({ requires: ["confidence"] }), reader);
  assert.equal(pide.execution, "UNSUPPORTED");
  assert.deepEqual(
    pide.issues.map((entry) => entry.code),
    [PACKAGE_CODES.CAPACIDAD_REQUERIDA_NO_SOPORTADA],
  );
  assert.match(pide.issues[0].message, /sabe hacer .*mesh-audit/);
  assert.equal(exitCodeFor(pide), 21);

  // `coverage` entró cuando R0-B dejó de estar pendiente y el módulo existió.
  // `confidence` sigue fuera y es el caso vivo: necesita los residuales
  // multivista de R8. Si alguien la añade sin que exista, esto se pone rojo —
  // prometer una capacidad que no se tiene es peor que no tenerla.
  assert.equal(SUPPORTED_CAPABILITIES.includes("coverage"), true);
  assert.equal(SUPPORTED_CAPABILITIES.includes("confidence"), false);

  // Requerida conocida: entra.
  const conocida = ingestPackage(withCapabilities({ requires: ["mesh-audit", "coverage"] }), reader);
  assert.equal(conocida.execution, "COMPLETE");
  assert.deepEqual(conocida.issues, []);

  // Provista desconocida: no impide consumir, pero se nombra.
  const trae = ingestPackage(withCapabilities({ provides: ["org.videomesh.densify"] }), reader);
  assert.equal(trae.execution, "COMPLETE");
  assert.deepEqual(trae.capabilities.unknownProvided, ["org.videomesh.densify"]);
  assert.equal(CAPABILITY_POLICY, "preservar-y-declarar");

  // Y `supports` viaja aunque el paquete no pida nada: es lo que le dice al
  // productor qué puede pedir la próxima vez sin probarlo.
  const mudo = ingestPackage(withCapabilities({}), reader);
  assert.deepEqual(mudo.capabilities.supports, [...SUPPORTED_CAPABILITIES]);

  console.log(
    `contratos: ok (D31: requerida desconocida → UNSUPPORTED con salida 21 y el mensaje dice qué se sabe ` +
      `hacer, requerida conocida entra, provista desconocida preservada y nombrada, y los ` +
      `${SUPPORTED_CAPABILITIES.length} supports viajan aunque nadie pida nada)`,
  );
}
