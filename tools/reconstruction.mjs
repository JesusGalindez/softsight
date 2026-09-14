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

/**
 * Ancho y alto de una imagen, **sin decodificarla**.
 *
 * D33 pide comparar las dimensiones que declara la cámara con la rejilla real, y
 * para eso no hacen falta los píxeles: hacen falta dos números que viven en la
 * cabecera. Antes esto llamaba a `decodePng`, que descomprime la imagen entera
 * para leer dos enteros — y además **no sabía leer JPEG**, así que cualquier
 * paquete de fotogrametría real salía UNSUPPORTED por sus propias fotos.
 *
 * PNG los pone en el IHDR, siempre en el mismo sitio. JPEG los lleva en el
 * marcador SOF, que hay que buscar saltando segmentos: es el formato el que
 * obliga, no el lector.
 */
export function imageGrid(bytes) {
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // Los SOF llevan las dimensiones. Se excluyen 0xC4, 0xC8 y 0xCC porque
      // comparten el rango y no son SOF: son tablas de Huffman y extensiones.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  throw new Error("IMAGEN_NO_SOPORTADA: no es un PNG ni un JPEG con cabecera legible");
}
import {
  PACKAGE_CODES,
  PACKAGE_CODE_TABLE,
  RESOURCE_LIMITS,
  RESOURCE_LIMIT_REASONS,
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
  // El primer fichero que se lee sin haber comprobado nada. Antes de `readFileSync`
  // y no después: después ya está en memoria, que es lo que el tope evita.
  const manifestBytes = statSync(manifestPath).size;
  if (manifestBytes > RESOURCE_LIMITS.manifestBytes.value) {
    return {
      report: null,
      exitCode: 23,
      fatal:
        `el manifest ocupa ${manifestBytes} bytes y el tope son ${RESOURCE_LIMITS.manifestBytes.value} ` +
        `(${PACKAGE_CODES.MANIFIESTO_DEMASIADO_GRANDE})`,
    };
  }
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
      //
      // El `reason` sale de la tabla y no se escribe aquí: escrito a mano decía
      // `ARTEFACTO_ILEGIBLE` con el identificador de «el hash no cuadra», que es
      // lo que el otro lado parsea. Un dato, un dueño.
      const code = plyErrorCode(String(error.message));
      ingest.issues.push({
        code,
        reason: PACKAGE_CODE_TABLE[code].reason,
        message: `artifact ${artifact.id}: ${error.message}`,
      });
      ingest.execution = code === PACKAGE_CODES.FORMATO_NO_SOPORTADO ? "UNSUPPORTED" : "ERROR";
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

  // D33: las dimensiones de la cámara describen **la rejilla real**, no una
  // rotación EXIF pendiente. Se comprueba abriendo la imagen, que es lo único
  // que lo puede desmentir, y por eso vive aquí y no en `ingest.ts`: allí no hay
  // IO. Una cámara que declare 4032×3024 sobre una imagen de 3024×4032 tiene los
  // intrínsecos girados, y el error no se ve en la miniatura.
  const imagePath = new Map(
    ingest.artifacts.filter((artifact) => artifact.type === "IMAGE").map((a) => [a.id, a.realPath]),
  );
  for (const camera of manifest.cameras ?? []) {
    const path = imagePath.get(camera.imageArtifactId);
    if (path === undefined) continue;
    let grid = null;
    try {
      grid = imageGrid(readFileSync(path));
    } catch {
      // Un formato de imagen que no sabemos abrir no es una cámara mal
      // declarada: se dice por su nombre y se sigue, igual que con el PLY.
      ingest.issues.push({
        code: PACKAGE_CODES.FORMATO_NO_SOPORTADO,
        reason: PACKAGE_CODE_TABLE[PACKAGE_CODES.FORMATO_NO_SOPORTADO].reason,
        message: `cámara ${camera.id}: ${camera.imageArtifactId} no se puede abrir para comprobar su rejilla`,
      });
      ingest.execution = "UNSUPPORTED";
      continue;
    }
    if (grid.width !== camera.width || grid.height !== camera.height) {
      ingest.issues.push({
        code: PACKAGE_CODES.REJILLA_NO_COINCIDE,
        reason: PACKAGE_CODE_TABLE[PACKAGE_CODES.REJILLA_NO_COINCIDE].reason,
        message:
          `cámara ${camera.id}: declara ${camera.width}×${camera.height} y la imagen es ` +
          `${grid.width}×${grid.height}`,
      });
      ingest.execution = "ERROR";
    }
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

/**
 * Qué identificador le toca a un fallo del lector de PLY.
 *
 * Por el prefijo del mensaje, que el lector escribe a propósito: es la única
 * información que cruza la frontera de una excepción, y convertirla en código
 * aquí deja al lector sin saber nada de la tabla de la frontera.
 */
function plyErrorCode(message) {
  if (message.startsWith("FORMATO_PLY_NO_SOPORTADO")) return PACKAGE_CODES.FORMATO_NO_SOPORTADO;
  if (message.startsWith("CABECERA_PLY_DEMASIADO_LARGA")) return PACKAGE_CODES.CABECERA_PLY_DEMASIADO_LARGA;
  if (message.startsWith("ELEMENTO_PLY_SOBRE_EL_TOPE")) return PACKAGE_CODES.ELEMENTO_PLY_SOBRE_EL_TOPE;
  if (message.startsWith("PLY_TRUNCADO")) return PACKAGE_CODES.PLY_TRUNCADO;
  return PACKAGE_CODES.ARTEFACTO_ILEGIBLE;
}

/** La proyección de D13, con los dos ejes decidiendo juntos. */
export function exitCodeForReport(report) {
  // El 23 por delante de todo lo demás: un paquete que no cabe puede ser
  // impecable, y confundirlo con uno inválido manda al productor a arreglar lo
  // que no está roto.
  if (report.warnings.some((entry) => RESOURCE_LIMIT_REASONS.includes(entry.reason))) return 23;
  if (report.execution === "UNSUPPORTED") {
    return report.warnings.some((entry) => entry.reason === "FORMATO_NO_SOPORTADO") ? 22 : 21;
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
