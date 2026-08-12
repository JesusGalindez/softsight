/**
 * Puerta del esqueleto de R0-A: esquema del paquete e ingesta.
 *
 * Cuatro bloques, en el orden en que un paquete los atraviesa:
 *
 *   1. La forma del manifest, con los cuatro casos de D21 y los de D19, D20 y
 *      D14. Cada rechazo se comprueba **por su motivo**, no por «falló»: la
 *      decisión pide que una nube de puntos con la bandera de malla diga qué
 *      sobra, y eso no lo distingue un booleano.
 *   2. Sandbox e integridad sobre un sistema de ficheros simulado: qué se
 *      rechaza, con qué código y con qué código de salida.
 *   3. Lo mismo sobre un paquete de verdad en disco, con su symlink saliendo de
 *      la raíz. La simulación prueba la política; esto prueba que la política
 *      encaja con lo que el sistema de ficheros contesta de verdad.
 *   4. Lo que R0 se prohíbe: cobertura y confianza no entran por el esquema.
 *
 * Lo que **no** hay todavía, y la puerta lo dice: no se lee el PLY, no se
 * registra el CameraSet ni se emite informe. R0-A no está cerrado.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, statSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_CODES,
  RECONSTRUCTION_PACKAGE_SCHEMA,
  exitCodeFor,
  ingestPackage,
  validate,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const fixture = (name) =>
  JSON.parse(readFileSync(resolve(projectRoot, "contracts/fixtures", `${name}.json`), "utf8"));

/** Copia del manifest base con el caso encima; los artifacts se sustituyen enteros. */
function documentOf(base, testCase) {
  const document = { ...base, ...(testCase.override ?? {}) };
  if (testCase.artifactPatch !== undefined) {
    document.artifacts = base.artifacts.map((artifact) => ({ ...artifact, ...testCase.artifactPatch }));
  }
  return document;
}

// 1. La forma del manifest.
{
  const cases = fixture("reconstruction-package-v1");
  for (const testCase of cases.accept) {
    const errors = validate(documentOf(cases.base, testCase), RECONSTRUCTION_PACKAGE_SCHEMA);
    assert.deepEqual(errors, [], `${testCase.name}: se rechazó un paquete válido`);
  }
  for (const testCase of cases.reject) {
    const errors = validate(documentOf(cases.base, testCase), RECONSTRUCTION_PACKAGE_SCHEMA);
    assert.ok(errors.length > 0, `${testCase.name}: se aceptó un paquete inválido`);
    assert.ok(
      errors.some((error) => error.includes(testCase.expect)),
      `${testCase.name}: ningún error dice «${testCase.expect}»: ${errors}`,
    );
  }
  console.log(
    `reconstrucción: ok (esquema del paquete: ${cases.accept.length} manifests válidos, ` +
      `${cases.reject.length} rechazados por su motivo)`,
  );
}

// 2. Sandbox e integridad, con el disco simulado.
{
  const cases = fixture("package-integrity-v1");
  const reader = {
    root: cases.root,
    stat: (path) => cases.files[path] ?? null,
  };
  for (const testCase of cases.cases) {
    const result = ingestPackage(documentOf(cases.base, testCase), reader);
    assert.equal(result.execution, testCase.execution, `${testCase.name}: ${JSON.stringify(result.issues)}`);
    assert.equal(exitCodeFor(result), testCase.exitCode, `${testCase.name}: código de salida`);
    if (testCase.code !== undefined) {
      assert.deepEqual(
        result.issues.map((issue) => issue.code),
        [testCase.code],
        `${testCase.name}: códigos emitidos`,
      );
    }
    if (testCase.artifacts !== undefined) {
      assert.equal(result.artifacts.length, testCase.artifacts, `${testCase.name}: artifacts admitidos`);
    }
  }
  console.log(
    `reconstrucción: ok (ingesta simulada: ${cases.cases.length} casos, cada uno con su código y su salida)`,
  );
}

// 3. El mismo camino contra un paquete de verdad, con un symlink que se escapa.
{
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "softsight-pkg-")));
  const root = join(sandbox, "pkg-0001");
  mkdirSync(root);
  const contenido = "ply\nformat ascii\n";
  writeFileSync(join(root, "mesh.ply"), contenido);
  writeFileSync(join(sandbox, "fuera.ply"), contenido);
  symlinkSync(join(sandbox, "fuera.ply"), join(root, "enlace.ply"));

  const reader = {
    root,
    stat: (path) => {
      try {
        const real = realpathSync(join(root, path));
        return { realPath: real, bytes: statSync(real).size, sha256: sha256Of(real) };
      } catch {
        return null;
      }
    },
  };

  const base = {
    documentType: "videomesh.reconstruction-package",
    contractVersion: "0.1",
    packageId: "pkg-0001",
    state: "SEALED",
    producer: { name: "prueba", version: "0" },
    artifacts: [
      {
        id: "mesh",
        type: "TRIANGLE_MESH",
        path: "mesh.ply",
        bytes: Buffer.byteLength(contenido),
        sha256: sha256Of(join(root, "mesh.ply")),
        purelyReconstructed: true,
      },
    ],
    scale: { status: "RELATIVE", source: "NONE" },
    frameGraph: { transforms: [] },
  };

  const bueno = ingestPackage(base, reader);
  assert.equal(bueno.execution, "COMPLETE", JSON.stringify(bueno.issues));
  assert.equal(bueno.artifacts[0].realPath, join(root, "mesh.ply"));
  assert.equal(bueno.packageId, "pkg-0001");

  // El enlace apunta a un fichero idéntico: mismo tamaño y mismo hash. Lo único
  // que lo distingue es dónde vive, que es exactamente lo que el sandbox mira.
  const escapado = ingestPackage(
    { ...base, artifacts: [{ ...base.artifacts[0], path: "enlace.ply" }] },
    reader,
  );
  assert.equal(escapado.execution, "ERROR");
  assert.deepEqual(
    escapado.issues.map((issue) => issue.code),
    [PACKAGE_CODES.SYMLINK_ESCAPE],
  );

  // D6 nombra dos casos más que un `realpath` resuelve de una vez, pero que
  // conviene ejercer porque son los que un sandbox escrito a mano se salta: el
  // enlace a otro enlace, y el enlace roto.
  symlinkSync(join(root, "enlace.ply"), join(root, "doble.ply"));
  symlinkSync(join(sandbox, "no-existe.ply"), join(root, "roto.ply"));
  const anidado = ingestPackage(
    { ...base, artifacts: [{ ...base.artifacts[0], path: "doble.ply" }] },
    reader,
  );
  assert.deepEqual(
    anidado.issues.map((issue) => issue.code),
    [PACKAGE_CODES.SYMLINK_ESCAPE],
  );
  const roto = ingestPackage(
    { ...base, artifacts: [{ ...base.artifacts[0], path: "roto.ply" }] },
    reader,
  );
  assert.deepEqual(
    roto.issues.map((issue) => issue.code),
    [PACKAGE_CODES.MISSING_ARTIFACT],
  );

  const tocado = ingestPackage(
    { ...base, artifacts: [{ ...base.artifacts[0], sha256: "c".repeat(64) }] },
    reader,
  );
  assert.deepEqual(
    tocado.issues.map((issue) => issue.code),
    [PACKAGE_CODES.HASH_MISMATCH],
  );

  console.log(
    "reconstrucción: ok (paquete real en disco: el artifact entra; el enlace que sale de la raíz no, " +
      "aunque su contenido sea idéntico; tampoco el enlace de enlace ni el roto; y el hash cambiado se rechaza)",
  );
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// 4. Lo que R0 no admite todavía, dicho en voz alta.
console.log(
  "reconstrucción: no ejecutada — R0-A no está cerrado: falta leer el PLY, registrar el CameraSet " +
    "y emitir el sobre del informe (S5 y S6). Cobertura y confianza siguen fuera del esquema por D34",
);
