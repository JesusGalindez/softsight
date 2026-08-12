/**
 * Puerta de R0-A: del manifest al informe.
 *
 * Seis bloques, en el orden en que un paquete los atraviesa:
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
 *   4. `cube-v1` entero: se genera, se comprueba que dos generaciones dan los
 *      mismos hashes, entra por la ingesta, su malla se lee del PLY y se audita,
 *      y sus cuatro imágenes se miran para que no sean un lienzo vacío.
 *   5. El recorrido entero de D34: `cube-v1` sale COMPLETE + PASS con salida 0,
 *      su informe valida contra el esquema publicado y es idéntico byte a byte
 *      entre dos ejecuciones. Con los tres desenlaces que no son PASS: evidencia
 *      requerida ausente, paquete sin sellar, y malla declarada sin superficie.
 *   6. Lo que sigue fuera: el criterio de certificación no tiene número, y
 *      cobertura y confianza siguen bloqueadas por D34.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_CODES,
  RECONSTRUCTION_PACKAGE_SCHEMA,
  RECONSTRUCTION_REPORT_SCHEMA,
  auditMesh,
  exitCodeFor,
  projectPoint,
  ingestPackage,
  parsePlyAscii,
  validate,
} from "../dist-node/agent3d.mjs";
import { decodePng } from "./agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";

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

// 4. `cube-v1` de punta a punta: se genera, se ingiere y se audita su malla.
{
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "softsight-cube-")));
  const primero = join(sandbox, "cube-v1");
  const segundo = join(sandbox, "cube-v1-otra-vez");
  const uno = writeCubePackage(primero);
  const dos = writeCubePackage(segundo);

  // Determinismo, que es lo que permite comparar contra el cube-v1 de VideoMesh:
  // los mismos ficheros con los mismos hashes, incluidas las imágenes.
  assert.deepEqual(
    uno.manifest.artifacts.map((artifact) => [artifact.path, artifact.sha256]),
    dos.manifest.artifacts.map((artifact) => [artifact.path, artifact.sha256]),
    "dos generaciones dan paquetes distintos",
  );

  const manifest = JSON.parse(readFileSync(join(primero, "manifest.json"), "utf8"));
  const reader = {
    root: primero,
    stat: (path) => {
      try {
        const real = realpathSync(join(primero, path));
        return { realPath: real, bytes: statSync(real).size, sha256: sha256Of(real) };
      } catch {
        return null;
      }
    },
  };

  const entrada = ingestPackage(manifest, reader);
  assert.equal(entrada.execution, "COMPLETE", JSON.stringify(entrada.issues));
  assert.equal(exitCodeFor(entrada), 0);
  assert.equal(entrada.packageId, "cube-v1");
  assert.equal(entrada.artifacts.length, 6, "malla, nube y cuatro imágenes");
  assert.equal(manifest.cameras.length, 4);
  console.log(
    `reconstrucción: ok (cube-v1: ${entrada.artifacts.length} artifacts sellados y determinista, ` +
      `${manifest.cameras.length} cámaras, entra con COMPLETE)`,
  );

  // La malla del paquete, leída del PLY y auditada: es el primer número que sale
  // de un paquete en vez de de una escena de este repositorio.
  const mesh = parsePlyAscii(readFileSync(join(primero, "mesh.ply"), "utf8")).mesh;
  const audit = auditMesh({ ...mesh, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 1 });
  assert.equal(audit.triangles, 12);
  assert.equal(audit.vertices, 24, "el cubo del motor parte los vértices por cara");
  assert.equal(audit.duplicatePositions, 16, "y la soldadura los junta en ocho esquinas");
  assert.equal(audit.watertight, true, "cerrado tras soldar, que es lo que la topología mide");
  assert.equal(audit.signedVolume, 1, "lado 1");
  assert.equal(audit.inverted, false);

  // Las imágenes tienen que enseñar el cubo. Un lienzo del color de fondo pasaría
  // los hashes igual de bien y sería evidencia falsa: el CameraSet describiría
  // unas cámaras que no miraron nada.
  const fondo = [Math.round(0.09 * 255), Math.round(0.1 * 255), Math.round(0.13 * 255)];
  for (const camera of manifest.cameras) {
    const artifact = manifest.artifacts.find((entry) => entry.id === camera.imageArtifactId);
    assert.ok(artifact !== undefined, `${camera.id} apunta a un artifact que no existe`);
    const image = decodePng(readFileSync(join(primero, artifact.path)));
    let geometria = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
      const offset = pixel * 4;
      if (
        Math.abs(image.pixels[offset] - fondo[0]) > 2 ||
        Math.abs(image.pixels[offset + 1] - fondo[1]) > 2 ||
        Math.abs(image.pixels[offset + 2] - fondo[2]) > 2
      ) {
        geometria += 1;
      }
    }
    const fraccion = geometria / (image.width * image.height);
    assert.ok(fraccion > 0.05, `${camera.id}: solo ${(fraccion * 100).toFixed(1)} % de píxeles con geometría`);
    // Y los intrínsecos son los de esa imagen, no los de otra rejilla.
    assert.equal(camera.width, image.width);
    assert.equal(camera.height, image.height);
    assert.equal(camera.cx ?? camera.intrinsics.cx, image.width / 2);
  }
  console.log(
    "reconstrucción: ok (las cuatro imágenes del paquete enseñan el cubo y sus intrínsecos " +
      "describen la rejilla que se renderizó)",
  );

  rmSync(sandbox, { recursive: true, force: true });
}

// 5. R0-A entero: del manifest al informe, con su código de salida.
{
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "softsight-r0a-")));
  const root = join(sandbox, "cube-v1");
  writeCubePackage(root);
  const manifestPath = join(root, "manifest.json");

  const { report, exitCode } = inspectPackage(manifestPath);
  assert.equal(report.execution, "COMPLETE");
  assert.equal(report.certification, "PASS");
  assert.equal(exitCode, 0, "R0-A: cube-v1 sale COMPLETE + PASS con salida 0");
  assert.equal(report.certificationReason, undefined, "un PASS no lleva motivo; tampoco null");

  // El informe apunta a lo que evaluó, que es P5 y la mitad que le faltaba a D7.
  assert.equal(report.run.inputPackageId, "cube-v1");
  assert.equal(
    report.run.inputManifestSha256,
    createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
  );
  assert.equal(report.evidence.artifacts.length, 6);
  assert.equal(report.measurements[0].appliesTo.artifactId, "mesh");
  assert.equal(report.measurements[0].appliesTo.sha256, report.evidence.artifacts[0].sha256);
  assert.equal(report.measurements[0].purelyReconstructed, true);
  assert.equal(report.measurements[0].watertight, true);
  assert.equal(report.measurements[0].signedVolume, 1);
  assert.equal(report.cameras.declared, 4);
  assert.equal(report.cameras.withImage, 4, "cada cámara resuelve su imagen");

  // El informe cumple su propio contrato publicado. Si no, VideoMesh derivaría un
  // modelo de un esquema que el productor no respeta.
  assert.deepEqual(validate(report, RECONSTRUCTION_REPORT_SCHEMA), []);

  // Determinista byte a byte: sin reloj y con runId derivado del manifest. Es lo
  // que permite comparar dos ejecuciones del mismo trabajo, y lo que D28 pide.
  assert.equal(JSON.stringify(report), JSON.stringify(inspectPackage(manifestPath).report));

  console.log(
    `reconstrucción: ok (R0-A: cube-v1 recorre esquema, sandbox, hashes, PLY, CameraSet, escala y ` +
      `FrameGraph, y sale COMPLETE + PASS con salida 0, informe válido contra su esquema y determinista)`,
  );

  /** Reescribe el manifest del paquete y vuelve a inspeccionarlo. */
  const conManifest = (cambios) => {
    const manifest = { ...JSON.parse(readFileSync(manifestPath, "utf8")), ...cambios };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return inspectPackage(manifestPath);
  };

  // Falta evidencia que el contrato pide: no se puede concluir, y no es un fallo
  // de la geometría de nadie (D8, P2).
  const sinEvidencia = conManifest({ requiredEvidence: ["mesh", "depth-frontal"] });
  assert.equal(sinEvidencia.report.execution, "COMPLETE");
  assert.equal(sinEvidencia.report.certification, "INCONCLUSIVE");
  assert.equal(sinEvidencia.report.certificationReason, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(sinEvidencia.report.evidence.missingEvidence, ["depth-frontal"]);
  assert.equal(sinEvidencia.exitCode, 11);

  // Un paquete a medio escribir no se consume: el trabajo no se hizo, así que el
  // veredicto no habla de la malla.
  const sinSellar = conManifest({ state: "WRITING", requiredEvidence: ["mesh"] });
  assert.equal(sinSellar.report.execution, "ERROR");
  assert.equal(sinSellar.report.certification, "INCONCLUSIVE");
  assert.equal(sinSellar.report.certificationReason, "PACKAGE_NOT_CONSUMABLE");
  assert.equal(sinSellar.report.measurements.length, 0, "no se mide lo que no se admitió");
  assert.equal(sinSellar.exitCode, 20);

  console.log(
    "reconstrucción: ok (evidencia requerida ausente da INCONCLUSIVE y salida 11; paquete sin sellar " +
      "da ERROR y salida 20, sin medir nada)",
  );

  // Y el único FAIL de R0: el paquete declara superficie y no la hay. Se hace con
  // un PLY sin caras, que es una malla legal y vacía.
  const vacio = join(sandbox, "cube-vacio");
  writeCubePackage(vacio);
  const plyVacio = "ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nelement face 0\nproperty list uchar int vertex_index\nend_header\n";
  writeFileSync(join(vacio, "mesh.ply"), plyVacio);
  const manifestVacio = JSON.parse(readFileSync(join(vacio, "manifest.json"), "utf8"));
  const malla = manifestVacio.artifacts.find((artifact) => artifact.id === "mesh");
  malla.bytes = Buffer.byteLength(plyVacio);
  malla.sha256 = createHash("sha256").update(plyVacio).digest("hex");
  writeFileSync(join(vacio, "manifest.json"), `${JSON.stringify(manifestVacio, null, 2)}\n`);

  const roto = inspectPackage(join(vacio, "manifest.json"));
  assert.equal(roto.report.execution, "COMPLETE", "el paquete es íntegro: el problema es lo que dice");
  assert.equal(roto.report.certification, "FAIL");
  assert.equal(roto.report.certificationReason, "MESH_DECLARED_WITHOUT_SURFACE");
  assert.equal(roto.exitCode, 1);
  console.log(
    "reconstrucción: ok (una malla declarada sin un solo triángulo es FAIL con salida 1, y la " +
      "ejecución sigue siendo COMPLETE: el paquete está bien, lo que declara no)",
  );

  rmSync(sandbox, { recursive: true, force: true });
}

// 6. Las convenciones de cámara, contra valores dorados y contra los píxeles.
{
  const cases = fixture("camera-projection-v1");
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "softsight-cam-")));
  const root = join(sandbox, "cube-v1");
  writeCubePackage(root);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

  // El fixture guarda las cámaras enteras: si el generador cambia una pose o una
  // focal, los valores dorados dejan de describir estas imágenes y la puerta lo
  // dice aquí, en vez de dejar pasar una comparación contra otra cámara.
  assert.deepEqual(manifest.cameras, cases.cameras, "las cámaras de cube-v1 ya no son las del fixture");

  for (const camera of cases.cameras) {
    for (const [name, golden] of Object.entries(cases.expected[camera.id])) {
      const projected = projectPoint(camera, golden.point);
      assert.ok(
        Math.abs(projected.x - golden.x) < 1e-6 && Math.abs(projected.y - golden.y) < 1e-6,
        `${camera.id}/${name}: ${projected.x},${projected.y} contra ${golden.x},${golden.y}`,
      );
      assert.ok(Math.abs(projected.depth - golden.depth) < 1e-6, `${camera.id}/${name}: profundidad`);
      assert.equal(
        projected.inside,
        golden.depth > 0 && golden.x >= 0 && golden.y >= 0 && golden.x < camera.width && golden.y < camera.height,
        `${camera.id}/${name}: dentro o fuera`,
      );
    }
  }
  console.log(
    `reconstrucción: ok (proyección: ${cases.cameras.length} cámaras × ` +
      `${Object.keys(cases.points).length} puntos contra valores dorados, con centro, esquinas, fuera de eje, ` +
      `borde y un punto detrás de la cámara)`,
  );

  /**
   * Y la comprobación que no depende de ninguna fórmula escrita por nosotros: la
   * caja de los ocho vértices proyectados contra la caja de los píxeles que el
   * rasterizador pintó. Si las convenciones declaradas no fueran las del motor,
   * estas dos cajas no se parecerían —y no se parecían: las imágenes salían
   * ortográficas mientras el manifest declaraba PINHOLE—.
   */
  const fondo = [Math.round(0.09 * 255), Math.round(0.1 * 255), Math.round(0.13 * 255)];
  for (const camera of manifest.cameras) {
    const artifact = manifest.artifacts.find((entry) => entry.id === camera.imageArtifactId);
    const image = decodePng(readFileSync(join(root, artifact.path)));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const pintado =
          Math.abs(image.pixels[offset] - fondo[0]) > 2 ||
          Math.abs(image.pixels[offset + 1] - fondo[1]) > 2 ||
          Math.abs(image.pixels[offset + 2] - fondo[2]) > 2;
        if (!pintado) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    let projMinX = Infinity;
    let projMinY = Infinity;
    let projMaxX = -Infinity;
    let projMaxY = -Infinity;
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          const projected = projectPoint(camera, [x, y, z]);
          projMinX = Math.min(projMinX, projected.x);
          projMinY = Math.min(projMinY, projected.y);
          projMaxX = Math.max(projMaxX, projected.x);
          projMaxY = Math.max(projMaxY, projected.y);
        }
      }
    }

    // Un píxel y medio: la silueta se mide en píxeles enteros y la proyección es
    // continua, así que el primer píxel encendido es el primero cuyo centro cae
    // dentro. Más margen que eso dejaría pasar una convención cambiada.
    for (const [medido, previsto, que] of [
      [minX, projMinX, "borde izquierdo"],
      [minY, projMinY, "borde superior"],
      [maxX, projMaxX, "borde derecho"],
      [maxY, projMaxY, "borde inferior"],
    ]) {
      assert.ok(
        Math.abs(medido - previsto) <= 1.5,
        `${camera.id}: el ${que} pintado está en ${medido} y la proyección lo pone en ${previsto.toFixed(1)}`,
      );
    }
  }
  console.log(
    "reconstrucción: ok (la silueta que pintó el rasterizador coincide con la caja de los ocho " +
      "vértices proyectados, en las cuatro cámaras y dentro de un píxel y medio)",
  );

  // Las tres convenciones son datos, no adorno: cambiar cualquiera mueve el píxel.
  const [primera] = cases.cameras;
  const punto = [0.5, 0.5, 0.5];
  const base = projectPoint(primera, punto);
  const esquina = projectPoint({ ...primera, pixelCenter: "CORNER" }, punto);
  assert.ok(
    Math.abs(esquina.x - (base.x - 0.5)) < 1e-9 && Math.abs(esquina.y - (base.y - 0.5)) < 1e-9,
    "pixelCenter CORNER debe mover medio píxel",
  );
  const abajo = projectPoint({ ...primera, pixelOrigin: "BOTTOM_LEFT" }, punto);
  assert.ok(Math.abs(abajo.y - (primera.height - base.y)) < 1e-9, "pixelOrigin BOTTOM_LEFT debe reflejar la fila");
  const visión = projectPoint({ ...primera, cameraAxes: "X_RIGHT_Y_DOWN_Z_FORWARD" }, punto);
  assert.ok(visión.depth < 0, "con el eje contrario, lo que estaba delante queda detrás");
  console.log(
    "reconstrucción: ok (pixelCenter mueve medio píxel, pixelOrigin refleja la fila y cameraAxes " +
      "invierte la profundidad: las tres deciden, no decoran)",
  );

  rmSync(sandbox, { recursive: true, force: true });
}

// 7. Lo que sigue fuera, dicho en voz alta.
console.log(
  "reconstrucción: no ejecutada — el criterio de certificación de R0 no tiene decisión con número: " +
    "va como pendiente en el envío para que VideoMesh lo confirme. Cobertura y confianza siguen " +
    "fuera del esquema por D34, y R0-B espera a su cube-v1 y a expected.json",
);
