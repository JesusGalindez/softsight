/**
 * Puerta de D18 y D34 — el criterio de salida de R0, que decía «es la prueba».
 *
 * Las dos decisiones dicen lo mismo con distinto alcance: `cube-v1` recorre ocho
 * etapas y sale `COMPLETE + PASS`. Y las dos llevaban desde el 2026-08-12 con la
 * misma nota —«falta el sobre del informe, que es S6»— describiendo un
 * repositorio que ya no existe: el sobre está, y lo que faltaba era **comprobarlo**.
 *
 * ## Qué es el sobre y por qué es la etapa que no se podía saltar
 *
 * Las siete primeras etapas producen números. El sobre es lo que dice **de qué
 * paquete son**:
 *
 * ```text
 * documentType      qué documento es esto
 * contractVersion   contra qué contrato se escribió
 * versions          la combinación entera, que es lo que D12 manda comparar
 * run               runId, inputPackageId, inputManifestSha256, status
 * ```
 *
 * Sin él, un informe es una cobertura del 49,4 % sin decir de qué. Con él, y esto
 * es el bloque 2, **el informe queda atado a su entrada por el hash**: si
 * `inputManifestSha256` no es el sha256 real del manifest que se leyó, el informe
 * habla de otro paquete y nadie lo sabría — los números saldrían igual de bien.
 *
 * ## Por qué esta puerta no repite las que ya existen
 *
 * `test:reconstruction` ya rompe etapas una a una: esquema, sandbox, hashes, PLY,
 * CameraSet, FrameGraph. Volver a romperlas aquí serían dos originales del mismo
 * caso. Lo que esta puerta comprueba es lo que ninguna miraba: que **el recorrido
 * entero dejó huella**, etapa por etapa, en el informe que sale — y el sobre, que
 * no estaba cubierto en ningún sitio.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURRENT_VERSION_PAIRS, isDeclaredVersionSet } from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-r0-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifestPath = join(raiz, "manifest.json");

/**
 * Las ocho etapas de D34, con la huella que cada una deja en el informe.
 *
 * La lista va aquí como **dato** y no como ocho asertos sueltos: es literalmente
 * la que el contrato escribe, y tenerla junta es lo que hace que añadir una etapa
 * al contrato y no al informe se note.
 */
const ETAPAS = [
  {
    etapa: "esquema",
    huella: (report) => report.documentType === "softsight.reconstruction-report",
    dice: "el manifest se validó y el informe declara qué documento es",
  },
  {
    etapa: "sandbox",
    huella: (report) => report.evidence.artifacts.length > 0,
    dice: "las rutas se resolvieron dentro de la raíz y los artifacts se abrieron",
  },
  {
    etapa: "hashes",
    huella: (report) => report.evidence.artifacts.every((a) => /^[0-9a-f]{64}$/.test(a.sha256) && a.bytes > 0),
    dice: "cada artifact trae su sha256 de 64 hex y su tamaño",
  },
  {
    etapa: "PLY",
    huella: (report) => report.measurements.length > 0,
    dice: "hay medidas, y medir exige haber leído la malla",
  },
  {
    etapa: "CameraSet",
    huella: (report) => report.cameras.declared === 4 && report.cameras.withImage === 4,
    dice: "las cuatro cámaras del fixture, las cuatro con imagen",
  },
  {
    etapa: "escala",
    huella: (report) => report.scale.status !== undefined && report.scale.boundingBoxDiagonal !== null,
    dice: "el estado de la escala y la diagonal que acompaña a toda distancia (D9)",
  },
  {
    etapa: "FrameGraph",
    huella: (report) => report.frames.reachable.includes(report.frames.measuredIn),
    dice: "el marco en el que están los números es alcanzable desde los declarados",
  },
  {
    etapa: "auditoría mínima",
    huella: (report) => report.measurements[0]?.triangles === 12 && report.measurements[0]?.vertices === 24,
    dice: "el cubo del fixture: 12 triángulos y 24 vértices partidos por cara",
  },
  {
    etapa: "sobre del informe",
    huella: (report) =>
      report.contractVersion !== undefined &&
      report.run?.runId !== undefined &&
      report.run?.inputPackageId !== undefined &&
      report.run?.inputManifestSha256 !== undefined &&
      Array.isArray(report.versions?.contracts),
    dice: "de qué paquete habla el informe y contra qué combinación de contratos",
  },
];

// 1. El recorrido entero, y el veredicto que D18 exige.
{
  const { report, exitCode } = inspectPackage(manifestPath);

  for (const { etapa, huella, dice } of ETAPAS) {
    assert.ok(huella(report), `la etapa «${etapa}» no dejó huella en el informe: ${dice}`);
  }

  assert.equal(report.execution, "COMPLETE", JSON.stringify(report.warnings));
  assert.equal(report.certification, "PASS");
  assert.equal(exitCode, 0);

  console.log(
    `r0: ok (las ${ETAPAS.length} etapas de D34 dejan huella en el informe y cube-v1 sale ` +
      "COMPLETE · PASS con salida 0)",
  );
}

// 2. **El sobre ata el informe a su entrada, y se comprueba con el hash.**
//
// Es lo que distingue un informe de un montón de números. Si el sha no fuera el
// del manifest leído, el informe hablaría de otro paquete y saldría igual de bien.
{
  const { report } = inspectPackage(manifestPath);
  const real = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");

  assert.equal(
    report.run.inputManifestSha256,
    real,
    "el sobre dice un sha256 que no es el del manifest que se leyó",
  );
  assert.equal(report.run.inputPackageId, "cube-v1");
  assert.equal(report.run.status, report.execution, "el estado del run y la ejecución son el mismo hecho");
  // El `runId` deriva del contenido: dos consumos del mismo paquete dan el mismo
  // identificador, que es lo que permite reconocer un informe repetido en vez de
  // archivarlo dos veces.
  assert.ok(report.run.runId.includes(real.slice(0, 16)), `el runId no deriva del manifest: ${report.run.runId}`);

  // Y la combinación de versiones es una de las declaradas (D12): el sobre no
  // puede anunciar un juego de contratos que nadie ha admitido.
  assert.ok(
    isDeclaredVersionSet(report.versions.contracts, [CURRENT_VERSION_PAIRS.map((pair) => ({ ...pair }))]),
    `el sobre declara una combinación que no está admitida: ${JSON.stringify(report.versions.contracts)}`,
  );

  console.log(
    `r0: ok (el sobre lleva el sha256 real del manifest —${real.slice(0, 12)}…—, su runId deriva de él y ` +
      `la combinación de ${report.versions.contracts.length} contratos es una de las declaradas)`,
  );
}

// 3. Otro paquete, otro sobre. Si no, el hash no estaría atando nada.
{
  const otro = join(sandbox, "cube-otro");
  writeCubePackage(otro);
  const otroManifest = join(otro, "manifest.json");
  const documento = JSON.parse(readFileSync(otroManifest, "utf8"));
  documento.packageId = "cube-v1-bis";
  writeFileSync(otroManifest, `${JSON.stringify(documento, null, 2)}\n`);

  const uno = inspectPackage(manifestPath).report;
  const dos = inspectPackage(otroManifest).report;

  assert.notEqual(uno.run.inputManifestSha256, dos.run.inputManifestSha256);
  assert.notEqual(uno.run.runId, dos.run.runId, "dos paquetes distintos no pueden compartir runId");
  assert.equal(dos.run.inputPackageId, "cube-v1-bis");
  // Y las medidas **sí** coinciden, porque la geometría es la misma: es lo que
  // demuestra que el sobre identifica la entrada y no el resultado.
  assert.equal(
    JSON.stringify(uno.measurements),
    JSON.stringify(dos.measurements),
    "la misma geometría tiene que dar las mismas medidas con otro sobre",
  );

  console.log(
    "r0: ok (cambiar el packageId cambia el sha, el runId y el sobre entero, y **no** cambia una sola " +
      "medida: el sobre identifica la entrada, no el resultado)",
  );
}

// 4. D17: dos consumos del mismo paquete dan el mismo documento entero.
{
  const uno = inspectPackage(manifestPath, { cache: false }).report;
  const dos = inspectPackage(manifestPath, { cache: false }).report;
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos consumos dan informes distintos");

  console.log("r0: ok (dos consumos del mismo paquete dan el mismo informe, sobre incluido)");
}

// 5. **Que las nueve huellas cazan su ausencia.**
//
// Sin esto, el bloque 1 no prueba nada: nueve predicados que devolvieran `true`
// sin mirar habrían pasado igual. Cada etapa recibe un informe al que le falta
// justo lo suyo, y tiene que fallar **ella y solo ella** — si una ausencia
// tumbara a dos etapas, el mensaje mandaría a arreglar la equivocada.
{
  const { report } = inspectPackage(manifestPath);

  /** El informe sin lo que delata a una etapa. */
  const mutilar = {
    esquema: (r) => delete r.documentType,
    sandbox: (r) => (r.evidence.artifacts = []),
    hashes: (r) => (r.evidence.artifacts[0].sha256 = "no-es-un-hash"),
    PLY: (r) => (r.measurements = []),
    CameraSet: (r) => (r.cameras.withImage = 0),
    escala: (r) => (r.scale.boundingBoxDiagonal = null),
    FrameGraph: (r) => (r.frames.reachable = []),
    "auditoría mínima": (r) => (r.measurements[0].triangles = 11),
    "sobre del informe": (r) => delete r.run.inputManifestSha256,
  };

  for (const { etapa, huella } of ETAPAS) {
    const roto = JSON.parse(JSON.stringify(report));
    mutilar[etapa](roto);
    assert.equal(huella(roto), false, `la huella de «${etapa}» no se entera de que su etapa falta`);

    // Y las demás siguen en pie: cada huella mira lo suyo.
    for (const otra of ETAPAS) {
      if (otra.etapa === etapa) continue;
      // `PLY` y `auditoría mínima` leen el mismo bloque a propósito —no hay
      // medidas sin haber leído la malla—, así que vaciarlo tumba a las dos y
      // eso no es un solape mal puesto sino la dependencia real.
      if (etapa === "PLY" && otra.etapa === "auditoría mínima") continue;
      assert.ok(
        otra.huella(roto),
        `romper «${etapa}» también tumba a «${otra.etapa}»: el fallo mandaría a arreglar la equivocada`,
      );
    }
  }

  console.log(
    `r0: ok (las ${ETAPAS.length} huellas cazan su ausencia y ninguna se lleva a otra por delante, salvo ` +
      "la auditoría con el PLY, que es una dependencia de verdad: sin malla leída no hay nada que auditar)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "r0: no ejecutada — R0-B con **el `cube-v1` de VideoMesh** sigue sin poderse hacer, y no por falta de " +
    "camino: lo cumple `producers/colmap/` desde el 2026-09-13 como segundo productor, pero las tres " +
    "comparaciones de D23 necesitan valores dorados de una implementación de fuera. Esta puerta cubre " +
    "R0-A entero",
);
