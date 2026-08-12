/**
 * Ingesta de un paquete de reconstrucción: esquema, sandbox e integridad.
 *
 * Es la primera mitad del recorrido de R0-A —esquema, sandbox, hashes— y para
 * cuando el paquete está admitido. Lo que viene después, leer el PLY, registrar
 * el CameraSet y auditar, tiene su propio paso y no se mezcla aquí: si la ingesta
 * decide algo sobre la geometría, deja de poder decir «este paquete es
 * consumible» sin haberla cargado.
 *
 * **Sin IO.** El acceso al disco entra por `PackageReader`, igual que el resto
 * del banco recibe buffers en vez de rutas. No es ceremonia: es lo que permite
 * probar el escape por symlink y el hash que no cuadra sin montar un sistema de
 * ficheros, y lo que deja la política —qué se rechaza y con qué código— en una
 * función pura que las dos partes de la frontera pueden leer.
 *
 * El orden importa y es el de D7: **la integridad se comprueba antes de
 * analizar**. Un artifact cuyo hash no cuadra no se abre.
 */

import { validate } from "../schema";
import { PACKAGE_CODE_TABLE, type PackageCode } from "./codes";
import { RECONSTRUCTION_PACKAGE_SCHEMA } from "./packageSchema";

/** Lo que el sistema de ficheros contesta sobre un artifact ya resuelto. */
export interface ArtifactStat {
  /** Ruta real tras resolver enlaces; con ella se detecta el escape del sandbox. */
  realPath: string;
  bytes: number;
  /** Hash del contenido, en hexadecimal minúscula. */
  sha256: string;
}

export interface PackageReader {
  /** Raíz del paquete, ya canónica: sin enlaces y sin `..`. */
  root: string;
  /** Datos del fichero, o `null` si no existe, no se puede leer o el enlace está roto. */
  stat(relativePath: string): ArtifactStat | null;
}

/**
 * Los dos ejes de D3. La ingesta no certifica nada —eso es del informe—, así que
 * solo mueve `execution`.
 */
export type ExecutionStatus = "COMPLETE" | "PARTIAL" | "ERROR" | "UNSUPPORTED";

export interface IngestIssue {
  /** Identificador neutro y estable; VideoMesh parsea esto, nunca el mensaje (D2). */
  code: string;
  /** Motivo canónico, del vocabulario del contrato cuando lo hay. */
  reason: string;
  message: string;
}

export interface IngestResult {
  execution: ExecutionStatus;
  issues: IngestIssue[];
  /** Identidad del paquete, del manifest y nunca del nombre del directorio (D7). */
  packageId: string | null;
  /** Artifacts admitidos, con su ruta real ya comprobada. */
  artifacts: Array<{ id: string; type: string; realPath: string; sha256: string; bytes: number }>;
}

/**
 * Los códigos que emite la ingesta, por su nombre en el código.
 *
 * La tabla —motivo canónico, causa y **estado**— vive en `codes.ts`, que es lo
 * que se publica y lo que la puerta comprueba. Aquí solo están los nombres, para
 * que emitir uno que no exista no compile.
 */
export const PACKAGE_CODES = {
  ESCAPES_ROOT: "SS-PKG-001",
  ABSOLUTE_PATH: "SS-PKG-002",
  SYMLINK_ESCAPE: "SS-PKG-003",
  MISSING_ARTIFACT: "SS-PKG-004",
  SCHEMA_INVALID: "SS-PKG-010",
  NOT_SEALED: "SS-PKG-011",
  SIZE_MISMATCH: "SS-PKG-012",
  HASH_MISMATCH: "SS-PKG-013",
  HASH_MALFORMED: "SS-PKG-014",
} as const satisfies Record<string, PackageCode>;

/**
 * Un problema, con su motivo sacado de la tabla y no escrito al lado.
 *
 * Escribir el `reason` en cada sitio de emisión es tener el mismo dato en nueve
 * sitios: el primero que se corrija dejará a los demás diciendo otra cosa, y el
 * otro lado parsea precisamente eso.
 */
function issue(code: PackageCode, message: string): IngestIssue {
  return { code, reason: PACKAGE_CODE_TABLE[code].reason, message };
}

/** Hexadecimal de 64 caracteres en minúscula, que es como se compara sin normalizar. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Rechaza la ruta antes de tocar el disco.
 *
 * Textual y no por resolución: una ruta absoluta o con `..` se rechaza por lo que
 * dice, aunque el fichero al que apunte esté dentro del paquete. Que un escape
 * quede dentro por casualidad no lo convierte en legal, y una regla que depende
 * de dónde apunte hoy cambia de resultado mañana.
 */
function pathIssue(path: string): IngestIssue | null {
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    return issue(
      PACKAGE_CODES.ABSOLUTE_PATH,
      `la ruta ${JSON.stringify(path)} es absoluta; los artifacts se declaran relativos a la raíz`,
    );
  }
  const segments = path.split(/[\\/]/);
  if (segments.includes("..")) {
    return issue(
      PACKAGE_CODES.ESCAPES_ROOT,
      `la ruta ${JSON.stringify(path)} sale de la raíz del paquete con ..`,
    );
  }
  return null;
}

/** Prefijo de directorio, con separador, para que `/a/bc` no cuente como dentro de `/a/b`. */
function insideRoot(realPath: string, root: string): boolean {
  return realPath === root || realPath.startsWith(root.endsWith("/") ? root : `${root}/`);
}

export function ingestPackage(manifest: unknown, reader: PackageReader): IngestResult {
  const issues: IngestIssue[] = [];
  const empty: IngestResult = { execution: "ERROR", issues, packageId: null, artifacts: [] };

  const schemaErrors = validate(manifest, RECONSTRUCTION_PACKAGE_SCHEMA);
  if (schemaErrors.length > 0) {
    // Todos de una vez y no el primero: cada vuelta le cuesta un ciclo entero al
    // productor, igual que en el esquema de escena.
    for (const error of schemaErrors) {
      issues.push(issue(PACKAGE_CODES.SCHEMA_INVALID, error));
    }
    return empty;
  }

  const document = manifest as {
    packageId: string;
    state: string;
    artifacts: Array<{ id: string; type: string; path: string; bytes: number; sha256: string }>;
  };

  if (document.state !== "SEALED") {
    // Un paquete a medio escribir puede tener todos los hashes correctos y aun
    // así no ser el paquete: le pueden faltar ficheros que el manifest no declara
    // todavía. No es un aviso, es un rechazo (D29).
    issues.push(
      issue(
        PACKAGE_CODES.NOT_SEALED,
        `state es ${JSON.stringify(document.state)} y solo se consume SEALED`,
      ),
    );
    return { ...empty, packageId: document.packageId };
  }

  const artifacts: IngestResult["artifacts"] = [];
  for (const artifact of document.artifacts) {
    const where = `artifact ${artifact.id}`;
    const bad = pathIssue(artifact.path);
    if (bad !== null) {
      issues.push({ ...bad, message: `${where}: ${bad.message}` });
      continue;
    }
    if (!SHA256.test(artifact.sha256)) {
      issues.push(
        issue(
          PACKAGE_CODES.HASH_MALFORMED,
          `${where}: sha256 no es hexadecimal de 64 caracteres en minúscula`,
        ),
      );
      continue;
    }

    const stat = reader.stat(artifact.path);
    if (stat === null) {
      issues.push(issue(PACKAGE_CODES.MISSING_ARTIFACT, `${where}: ${artifact.path} no existe o no se puede leer`));
      continue;
    }
    if (!insideRoot(stat.realPath, reader.root)) {
      // Aquí ya no vale mirar el texto: la ruta era legal y el enlace la ha
      // llevado fuera. Es el caso que un sandbox que solo normaliza cadenas deja
      // pasar entero.
      issues.push(
        issue(PACKAGE_CODES.SYMLINK_ESCAPE, `${where}: ${artifact.path} resuelve fuera de la raíz del paquete`),
      );
      continue;
    }
    if (stat.bytes !== artifact.bytes) {
      issues.push(
        issue(PACKAGE_CODES.SIZE_MISMATCH, `${where}: declara ${artifact.bytes} bytes y tiene ${stat.bytes}`),
      );
      continue;
    }
    if (stat.sha256 !== artifact.sha256) {
      issues.push(
        issue(PACKAGE_CODES.HASH_MISMATCH, `${where}: el contenido no coincide con el sha256 declarado`),
      );
      continue;
    }

    artifacts.push({
      id: artifact.id,
      type: artifact.type,
      realPath: stat.realPath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    });
  }

  return {
    execution: issues.length > 0 ? "ERROR" : "COMPLETE",
    issues,
    packageId: document.packageId,
    artifacts,
  };
}

/**
 * La proyección para shell y CI de D13. La autoridad semántica es el JSON: esto
 * existe para que un `if` de un script no tenga que leerlo.
 */
export function exitCodeFor(result: IngestResult): number {
  if (result.execution === "COMPLETE") return 0;
  if (result.execution === "UNSUPPORTED") return 21;
  return 20;
}
