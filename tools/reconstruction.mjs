/**
 * `reconstruction inspect`: el recorrido de R0-A, de la ruta del manifest al
 * informe.
 *
 *   npm run reconstruction -- inspect artifacts/cube-v1/manifest.json
 *   npm run reconstruction -- inspect <ruta> --out informe.json
 *
 * Es el subcomando nuevo de D13, así que estrena su tabla de códigos de salida y
 * **no toca la de los comandos existentes**:
 *
 * ```text
 * 0   COMPLETE + PASS           20  paquete inválido
 * 1   COMPLETE + FAIL           21  contrato no soportado
 * 11  COMPLETE + INCONCLUSIVE   22  formato no soportado
 * 2   error de datos o de uso
 * ```
 *
 * El código de salida es una proyección para shell y CI: **la autoridad semántica
 * es el JSON**, con sus dos ejes. Un script que decida por el número está leyendo
 * un resumen, no el informe.
 *
 * Aquí vive todo el IO —leer el manifest, resolver rutas, hashear, abrir los
 * PLY— y ni una decisión: qué se rechaza lo dice `ingest.ts` y qué se certifica
 * lo dice `report.ts`, los dos sin tocar disco. La frontera entre este fichero y
 * esos dos es la que permite probar el escape por symlink sin un symlink.
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditMesh,
  buildReconstructionReport,
  ingestPackage,
  parsePlyAscii,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;

/** Lector de paquete sobre el sistema de ficheros de verdad. */
export function packageReader(root) {
  return {
    root,
    stat: (path) => {
      try {
        const real = realpathSync(join(root, path));
        return {
          realPath: real,
          bytes: statSync(real).size,
          sha256: createHash("sha256").update(readFileSync(real)).digest("hex"),
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Recorre un paquete y devuelve su informe.
 *
 * Las mallas se leen **solo si la ingesta las admitió**: abrir un fichero cuyo
 * hash no cuadra es exactamente lo que D7 prohíbe, y hacerlo «para dar mejor
 * diagnóstico» es como se acaba midiendo geometría que no es la que el paquete
 * declara.
 */
/** Hashes de esquema aceptados, del registro generado (D16). */
function schemaHashes() {
  try {
    const registry = JSON.parse(readFileSync(resolve(projectRoot, "contracts/registry.json"), "utf8"));
    return registry.schemas.map((entry) => entry.sha256);
  } catch {
    // Sin registro no se comprueba nada, y se dice: callar aquí convertiría un
    // fichero que falta en una comprobación que parece hecha.
    return undefined;
  }
}

export function inspectPackage(manifestPath) {
  const raw = readFileSync(manifestPath);
  const root = realpathSync(dirname(manifestPath));
  const manifestSha256 = createHash("sha256").update(raw).digest("hex");

  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    // Un manifest que ni siquiera es JSON no llega al validador de esquema: no hay
    // documento sobre el que decir qué campo falla.
    return {
      report: null,
      exitCode: 20,
      fatal: `el manifest no es JSON válido: ${error.message}`,
    };
  }

  const ingest = ingestPackage(manifest, packageReader(root), { schemaHashes: schemaHashes() });

  const meshes = [];
  for (const artifact of ingest.artifacts) {
    if (artifact.type !== "TRIANGLE_MESH") continue;
    let mesh = null;
    try {
      mesh = parsePlyAscii(readFileSync(artifact.realPath, "utf8")).mesh;
    } catch (error) {
      // Un formato que no sabemos leer no es un paquete inválido ni una malla
      // mala: es trabajo que no se puede hacer. Se marca UNSUPPORTED y el código
      // de salida lo distingue de «el contrato no lo leo».
      const unsupported = String(error.message).startsWith("PLY_FORMAT_UNSUPPORTED");
      ingest.issues.push({
        code: unsupported ? "SS-PKG-022" : "SS-PKG-013",
        reason: unsupported ? "ARTIFACT_FORMAT_UNSUPPORTED" : "ARTIFACT_UNREADABLE",
        message: `artifact ${artifact.id}: ${error.message}`,
      });
      ingest.execution = unsupported ? "UNSUPPORTED" : "ERROR";
      continue;
    }
    if (mesh === null) continue;
    meshes.push({
      artifactId: artifact.id,
      audit: auditMesh({
        ...mesh,
        // La auditoría de normales no aplica: un PLY de posiciones y caras no las
        // trae, y promediarlas aquí sería inventar la evidencia que se mide.
        normals: new Float32Array(0),
        uvs: new Float32Array(0),
        boundingRadius: 0,
      }),
    });
  }

  const report = buildReconstructionReport({
    manifest,
    manifestSha256,
    ingest,
    meshes,
    softsightVersion: version,
  });

  return { report, exitCode: exitCodeForReport(report), fatal: null };
}

/** La proyección de D13, con los dos ejes decidiendo juntos. */
export function exitCodeForReport(report) {
  if (report.execution === "UNSUPPORTED") {
    return report.warnings.some((entry) => entry.reason === "ARTIFACT_FORMAT_UNSUPPORTED") ? 22 : 21;
  }
  if (report.execution !== "COMPLETE") return 20;
  if (report.certification === "PASS") return 0;
  if (report.certification === "FAIL") return 1;
  return 11;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, target, ...rest] = process.argv.slice(2);
  if (command !== "inspect" || target === undefined) {
    process.stderr.write("uso: node tools/reconstruction.mjs inspect <manifest.json> [--out informe.json]\n");
    process.exit(2);
  }

  const { report, exitCode, fatal } = inspectPackage(resolve(target));
  if (fatal !== null) {
    process.stderr.write(`${fatal}\n`);
    process.exit(exitCode);
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const outIndex = rest.indexOf("--out");
  if (outIndex >= 0) writeFileSync(resolve(rest[outIndex + 1]), json);
  else process.stdout.write(json);
  process.exit(exitCode);
}
