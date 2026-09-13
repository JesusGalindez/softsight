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
import { auditTransforms, resolveFrame, type Frame, type FrameTransform } from "./frameGraph";
import { RESOURCE_LIMITS, RESOURCE_LIMIT_REASONS } from "./limits";
import { RECONSTRUCTION_PACKAGE_SCHEMA } from "./packageSchema";

/** Lo que el sistema de ficheros contesta sobre un artifact ya resuelto. */
export interface ArtifactStat {
  /** Ruta real tras resolver enlaces; con ella se detecta el escape del sandbox. */
  realPath: string;
  bytes: number;
  /** Hash del contenido, en hexadecimal minúscula. */
  sha256: string;
}

/**
 * Qué versiones de contrato sabe leer este binario.
 *
 * La decisión de qué se acepta es del contrato (D16); esto es su reflejo en
 * código, y por eso es una lista y no una comparación con la última: en DRAFT una
 * versión puede admitir más de una, y aceptar «cualquier 0.x» sería no comprobar
 * nada.
 */
export const SUPPORTED_CONTRACT_VERSIONS = ["0.1"] as const;

/**
 * Qué extensiones entiende este binario. **Hoy ninguna**, y decirlo así es la
 * respuesta honesta: una lista con nombres inventados para que la prueba
 * discrimine sería declarar frontera un experimento que nadie ha escrito.
 *
 * Se puede sustituir por parámetro, igual que `schemaHashes`, porque quien sabe
 * qué entiende un despliegue concreto no es este módulo.
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = [];

/**
 * La política de D30 para la extensión **opcional** desconocida, que la decisión
 * deja abierta entre preservar e ignorar.
 *
 * Se elige preservar **y declararla en el informe**. Ignorar en silencio tiene el
 * mismo problema que aceptar un campo desconocido: el productor cree que mandó
 * algo que se usó. Preservarla y nombrarla convierte «no lo entendí» en un dato
 * que se puede leer, que es lo que separa esto de adivinar.
 */
export const EXTENSION_POLICY = "preservar-y-declarar" as const;

/**
 * Qué sabe hacer este binario, publicado como `supports` (D31).
 *
 * A diferencia de las extensiones, aquí la lista **no** está vacía: son nombres
 * para trabajo que existe y que una puerta ejerce hoy. Poner uno que todavía no
 * se hace sería prometerlo, y un productor que lo pidiera recibiría un PASS sobre
 * algo que nadie midió.
 *
 * `coverage` y `confidence` **no están** a propósito: siguen bloqueadas por D34,
 * y es justo el caso que la negociación existe para contestar bien.
 */
export const SUPPORTED_CAPABILITIES: readonly string[] = [
  "mesh-audit",
  "camera-projection",
  "ply-ascii",
];

/**
 * Qué se hace con una capability **provista** que no conocemos.
 *
 * La misma elección que con las extensiones opcionales, y por el mismo motivo:
 * se preserva y se nombra. «Continuar si el contrato lo permite» deja al
 * productor sin saber si su capability se usó o se tiró.
 */
export const CAPABILITY_POLICY = "preservar-y-declarar" as const;

/**
 * Qué nombres de una lista no conocemos.
 *
 * Una función y no dos bucles: extensiones y capabilities negocian igual —lo
 * requerido desconocido para, lo opcional desconocido se preserva— y escribirlo
 * dos veces es garantizar que la segunda se quede sin el arreglo de la primera.
 */
function unknownOf(names: readonly string[], supported: ReadonlySet<string>): string[] {
  return names.filter((name) => !supported.has(name));
}

export interface IngestOptions {
  /**
   * Hashes de esquema registrados como compatibles. Se pasan desde fuera porque
   * salen de `contracts/`, que es un directorio, y aquí no hay IO. Sin registro no
   * se comprueba el hash: no tenerlo es no saber, y no saber no es rechazar.
   */
  schemaHashes?: readonly string[];
  /**
   * Extensiones que este despliegue entiende. Sin pasarla rige
   * `SUPPORTED_EXTENSIONS`, que hoy está vacía.
   */
  supportedExtensions?: readonly string[];
  /**
   * Capabilities que este despliegue sabe hacer. Sin pasarla rige
   * `SUPPORTED_CAPABILITIES`.
   */
  supportedCapabilities?: readonly string[];
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
  /** Qué extensiones se entendieron y cuáles se preservaron sin entender (D30). */
  extensions: { honoured: string[]; ignored: string[] };
  /** La negociación de D31: qué pedía el paquete, qué traía, y qué sabemos hacer. */
  capabilities: { required: string[]; provided: string[]; supports: string[]; unknownProvided: string[] };
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
  CONTRACT_UNSUPPORTED: "SS-PKG-020",
  SCHEMA_HASH_UNKNOWN: "SS-PKG-021",
  FORMAT_UNSUPPORTED: "SS-PKG-022",
  NOT_SEALED: "SS-PKG-011",
  SIZE_MISMATCH: "SS-PKG-012",
  HASH_MISMATCH: "SS-PKG-013",
  HASH_MALFORMED: "SS-PKG-014",
  EXTENSION_REQUIRED_UNSUPPORTED: "SS-PKG-023",
  CAPABILITY_REQUIRED_UNSUPPORTED: "SS-PKG-024",
  ABSOLUTE_BUDGET_WITHOUT_SCALE: "SS-RECON-001",
  BUDGET_UNIT_MISDECLARED: "SS-RECON-002",
  FRAME_TRANSFORM_MALFORMED: "SS-RECON-003",
  FRAME_TRANSFORM_NOT_RIGID: "SS-RECON-004",
  FRAME_UNREACHABLE: "SS-RECON-005",
  CAMERA_POSE_NOT_RIGID: "SS-CAM-005",
  DEPTH_CAMERA_MISSING: "SS-CAM-006",
  CAMERA_IMAGE_HASH_MISMATCH: "SS-CAM-001",
  CAMERA_IMAGE_MISSING: "SS-CAM-002",
  RECTIFIED_WITH_DISTORTION: "SS-CAM-003",
  // Lo emite el CLI y no este módulo: comprobarlo exige **decodificar la
  // imagen**, y aquí no hay IO a propósito. El identificador vive igual en la
  // tabla, que es lo que el otro lado parsea.
  CAMERA_GRID_MISMATCH: "SS-CAM-004",
  // El espacio de lectura: topes de recurso y ficheros que no se pueden
  // interpretar. Los cinco primeros los proyecta el código de salida 23, que D13
  // reservaba y hasta ahora no devolvía nadie.
  MANIFEST_TOO_LARGE: "SS-IO-001",
  ARTIFACT_TOO_LARGE: "SS-IO-002",
  TOO_MANY_ARTIFACTS: "SS-IO-003",
  PLY_HEADER_TOO_LONG: "SS-IO-004",
  PLY_COUNT_EXCEEDS_LIMIT: "SS-IO-005",
  PLY_TRUNCATED: "SS-IO-006",
  UNREADABLE: "SS-IO-007",
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

export function ingestPackage(
  manifest: unknown,
  reader: PackageReader,
  options: IngestOptions = {},
): IngestResult {
  const issues: IngestIssue[] = [];
  const extensions = { honoured: [] as string[], ignored: [] as string[] };
  const capabilities = {
    required: [] as string[],
    provided: [] as string[],
    supports: [...(options.supportedCapabilities ?? SUPPORTED_CAPABILITIES)],
    unknownProvided: [] as string[],
  };
  const empty: IngestResult = {
    execution: "ERROR",
    issues,
    packageId: null,
    artifacts: [],
    extensions,
    capabilities,
  };

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
    contractVersion: string;
    contractSchemaSha256?: string;
    requires?: string[];
    provides?: string[];
    scale?: { status?: string };
    cameras?: Array<{
      id: string;
      imageArtifactId: string;
      imageArtifactHash: string;
      imageSpace: string;
      worldFromCamera: number[];
      distortion?: Record<string, number>;
    }>;
    frameGraph?: { transforms: FrameTransform[] };
    budgets?: Array<{ name: string; units: string; unit?: string; max: number }>;
    extensions?: Record<string, { required?: boolean }>;
    state: string;
    artifacts: Array<{
      id: string;
      type: string;
      path: string;
      bytes: number;
      sha256: string;
      cameraId?: string;
    }>;
  };

  // El contrato antes que el contenido: un paquete de una versión que no sabemos
  // leer no es un paquete inválido, es uno que no nos toca juzgar. La diferencia
  // la ve quien automatiza —21 y no 20— y evita que un productor «arregle» un
  // paquete correcto para una versión futura.
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(document.contractVersion as "0.1")) {
    issues.push(
      issue(
        PACKAGE_CODES.CONTRACT_UNSUPPORTED,
        `contractVersion ${JSON.stringify(document.contractVersion)}; este binario lee ${SUPPORTED_CONTRACT_VERSIONS.join(", ")}`,
      ),
    );
    return { ...empty, execution: "UNSUPPORTED", packageId: document.packageId };
  }

  if (document.contractSchemaSha256 !== undefined && options.schemaHashes !== undefined) {
    if (!options.schemaHashes.includes(document.contractSchemaSha256)) {
      // Nunca aviso y continuar (D16): si el esquema con el que se escribió no es
      // ninguno de los que conocemos, lo que viene detrás no se puede interpretar.
      issues.push(
        issue(
          PACKAGE_CODES.SCHEMA_HASH_UNKNOWN,
          `el hash de esquema ${document.contractSchemaSha256.slice(0, 16)}… no está registrado`,
        ),
      );
      return { ...empty, execution: "UNSUPPORTED", packageId: document.packageId };
    }
  }

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

  // La negociación de D31, antes que las extensiones y antes que cualquier
  // artifact: una capability requerida que no sabemos hacer significa que el
  // trabajo que el paquete pide no lo podemos hacer, y seguir produciría un
  // informe sobre otra cosa.
  const supportedCapabilities = new Set(options.supportedCapabilities ?? SUPPORTED_CAPABILITIES);
  capabilities.required = [...(document.requires ?? [])];
  capabilities.provided = [...(document.provides ?? [])];
  capabilities.unknownProvided = unknownOf(capabilities.provided, supportedCapabilities);
  const unknownRequiredCapabilities = unknownOf(capabilities.required, supportedCapabilities);
  if (unknownRequiredCapabilities.length > 0) {
    issues.push(
      issue(
        PACKAGE_CODES.CAPABILITY_REQUIRED_UNSUPPORTED,
        `capabilities requeridas que este binario no sabe hacer: ${unknownRequiredCapabilities.join(", ")}; ` +
          `sabe hacer ${[...supportedCapabilities].join(", ")}`,
      ),
    );
    return { ...empty, execution: "UNSUPPORTED", packageId: document.packageId };
  }

  // Las extensiones antes de tocar un artifact: si el paquete exige una que no
  // entendemos, lo que venga detrás **no se puede interpretar**, y medirlo sería
  // producir números sobre unos datos cuyo sentido nos falta (D30).
  const supported = new Set(options.supportedExtensions ?? SUPPORTED_EXTENSIONS);
  const unknownRequired: string[] = [];
  for (const [name, entry] of Object.entries(
    (document.extensions ?? {}) as Record<string, { required?: boolean }>,
  )) {
    if (supported.has(name)) {
      extensions.honoured.push(name);
      continue;
    }
    if (entry.required === true) unknownRequired.push(name);
    else extensions.ignored.push(name);
  }
  if (unknownRequired.length > 0) {
    issues.push(
      issue(
        PACKAGE_CODES.EXTENSION_REQUIRED_UNSUPPORTED,
        `extensiones requeridas que este binario no entiende: ${unknownRequired.join(", ")}`,
      ),
    );
    return { ...empty, execution: "UNSUPPORTED", packageId: document.packageId };
  }

  // D9: un presupuesto en metros sobre una escala que nadie ha fijado no es un
  // presupuesto exigente, es una afirmación sin sentido. Se comprueba aquí y no
  // al evaluarlo —eso es R9— porque la contradicción está en el propio manifest y
  // no depende de haber medido nada.
  const absoluteScale = document.scale?.status === "ABSOLUTE";
  for (const budget of document.budgets ?? []) {
    const where = `presupuesto ${budget.name}`;
    if (budget.units === "ABSOLUTE") {
      if (budget.unit === undefined) {
        issues.push(issue(PACKAGE_CODES.BUDGET_UNIT_MISDECLARED, `${where}: absoluto y sin unidad`));
        continue;
      }
      if (!absoluteScale) {
        issues.push(
          issue(
            PACKAGE_CODES.ABSOLUTE_BUDGET_WITHOUT_SCALE,
            `${where}: ${budget.max} ${budget.unit} con scale.status ` +
              `${JSON.stringify(document.scale?.status ?? "ausente")}; con escala no absoluta el ` +
              `presupuesto va en RELATIVE_TO_DIAGONAL`,
          ),
        );
      }
      continue;
    }
    if (budget.unit !== undefined) {
      // Una fracción de diagonal no tiene unidad, y ponerle una es declarar una
      // escala por la puerta de atrás: el consumidor leería «0,01 m» donde el
      // productor quiso decir «el 1 % de la pieza».
      issues.push(
        issue(
          PACKAGE_CODES.BUDGET_UNIT_MISDECLARED,
          `${where}: relativo a la diagonal y con unidad ${JSON.stringify(budget.unit)}`,
        ),
      );
    }
  }
  if (issues.length > 0) return { ...empty, packageId: document.packageId };

  // D20: un mapa de profundidad sin su cámara no se puede interpretar. El número
  // de cada píxel solo significa algo con unos intrínsecos y una pose detrás, y
  // `depthKind` decide **cuál** de las dos cosas es ese número —la coordenada
  // sobre el eje óptico o la longitud del rayo—, una distinción que solo tiene
  // sentido respecto a una cámara concreta.
  const cameraIds = new Set((document.cameras ?? []).map((camera) => camera.id));
  for (const artifact of document.artifacts) {
    if (artifact.type !== "DEPTH_MAP") continue;
    if (!cameraIds.has(artifact.cameraId ?? "")) {
      issues.push(
        issue(
          PACKAGE_CODES.DEPTH_CAMERA_MISSING,
          `artifact ${artifact.id}: cameraId ${JSON.stringify(artifact.cameraId)} no está en el CameraSet`,
        ),
      );
    }
  }
  // Como con los presupuestos: un manifest que se contradice se para antes de
  // abrir nada. Seguir daría además los errores de leer un paquete cuya
  // descripción ya se sabe mal, y el productor tendría que separarlos.
  if (issues.length > 0) return { ...empty, packageId: document.packageId };

  // El recuento antes del recorrido: cada artifact cuesta una resolución de
  // enlace y una lectura entera para hashear, así que un manifest generado en
  // bucle se para aquí y no tras cien mil llamadas al sistema.
  if (document.artifacts.length > RESOURCE_LIMITS.packageArtifacts.value) {
    issues.push(
      issue(
        PACKAGE_CODES.TOO_MANY_ARTIFACTS,
        `el manifest declara ${document.artifacts.length} artifacts y el tope son ${RESOURCE_LIMITS.packageArtifacts.value}`,
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

    // Sobre lo **declarado** y antes de `stat`, que abre el fichero entero para
    // hashearlo: comprobarlo después sería haberlo leído ya, que es justo lo que
    // el tope existe para evitar. Lo declarado y lo real no pueden separarse,
    // porque el tamaño se compara unas líneas más abajo.
    if (artifact.bytes > RESOURCE_LIMITS.artifactBytes.value) {
      issues.push(
        issue(
          PACKAGE_CODES.ARTIFACT_TOO_LARGE,
          `${where}: declara ${artifact.bytes} bytes y el tope son ${RESOURCE_LIMITS.artifactBytes.value}`,
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

  // D10: la cámara se ata a **los píxeles**, no a un nombre. El id se puede
  // reapuntar a otro fichero sin que nada chille —y entonces los intrínsecos
  // describen una imagen que no es la suya—; el hash no. Se comprueba con los
  // artifacts ya admitidos, así que un hash que no cuadraba se rechazó antes y
  // aquí la cámara sale por «su imagen no está», que es la verdad.
  const imageBy = new Map(
    artifacts.filter((artifact) => artifact.type === "IMAGE").map((artifact) => [artifact.id, artifact]),
  );
  for (const camera of document.cameras ?? []) {
    const where = `cámara ${camera.id}`;
    const image = imageBy.get(camera.imageArtifactId);
    if (image === undefined) {
      issues.push(
        issue(
          PACKAGE_CODES.CAMERA_IMAGE_MISSING,
          `${where}: ${camera.imageArtifactId} no es un artifact IMAGE admitido`,
        ),
      );
      continue;
    }
    if (image.sha256 !== camera.imageArtifactHash) {
      issues.push(
        issue(
          PACKAGE_CODES.CAMERA_IMAGE_HASH_MISMATCH,
          `${where}: declara ${camera.imageArtifactHash.slice(0, 16)}… y ${camera.imageArtifactId} ` +
            `es ${image.sha256.slice(0, 16)}…`,
        ),
      );
      continue;
    }
    // Unos intrínsecos rectificados con coeficientes de distorsión se contradicen
    // a sí mismos: si la imagen ya está rectificada, no queda distorsión que
    // corregir. Es el caso que D10 nombra, y no se ve mirando la imagen porque
    // tiene el mismo tamaño y el mismo aspecto que la original.
    // La pose de una cámara **es** una transformación entre marcos, así que se le
    // aplica la misma regla que a una arista del grafo en vez de una segunda
    // parecida: una matriz con la última fila distinta de [0, 0, 0, 1] lleva
    // proyección dentro y no es una pose, aunque los dieciséis números sigan ahí.
    const poseProblem = auditTransforms([
      {
        from: "RECONSTRUCTION",
        to: "CAMERA",
        matrix: camera.worldFromCamera,
        reason: "pose declarada por la cámara",
        producer: camera.id,
      },
    ]);
    if (poseProblem.length > 0) {
      issues.push(
        issue(PACKAGE_CODES.CAMERA_POSE_NOT_RIGID, `${where}: ${poseProblem[0].message.split(": ")[1]}`),
      );
      continue;
    }
    if (camera.imageSpace === "RECTIFIED" && Object.keys(camera.distortion ?? {}).length > 0) {
      issues.push(
        issue(
          PACKAGE_CODES.RECTIFIED_WITH_DISTORTION,
          `${where}: imageSpace RECTIFIED con ${Object.keys(camera.distortion ?? {}).join(", ")}`,
        ),
      );
    }
  }

  // D11. El grafo estaba en el esquema desde R0-A y **nadie lo miraba**: un
  // paquete podía declarar cero aristas y salir PASS, porque el campo se rellenaba
  // por educación. Las dos comprobaciones que lo convierten en registro de verdad:
  // que cada arista sea una transformación rígida bien formada, y que **todo marco
  // declarado se alcance desde aquel en el que se mide**.
  const transforms = document.frameGraph?.transforms ?? [];
  for (const problem of auditTransforms(transforms)) {
    issues.push(
      issue(
        problem.reason === "FRAME_TRANSFORM_NOT_RIGID"
          ? PACKAGE_CODES.FRAME_TRANSFORM_NOT_RIGID
          : PACKAGE_CODES.FRAME_TRANSFORM_MALFORMED,
        problem.message,
      ),
    );
  }
  // Desde `RECONSTRUCTION` porque es el marco en el que se mide: las cajas y los
  // volúmenes del informe salen del PLY, que viene en él. Un marco declarado al
  // que no hay camino es un salto que alguien da sin decir cómo, y es justo lo
  // que el riesgo R7 describe —malla en otro marco— y lo que ninguna imagen
  // desmiente.
  const declaredFrames = new Set<Frame>();
  for (const transform of transforms) {
    declaredFrames.add(transform.from);
    declaredFrames.add(transform.to);
  }
  for (const frame of declaredFrames) {
    if (resolveFrame(transforms, "RECONSTRUCTION", frame) === null) {
      issues.push(
        issue(
          PACKAGE_CODES.FRAME_UNREACHABLE,
          `${frame} se declara en el grafo y no hay camino desde RECONSTRUCTION, que es donde se mide`,
        ),
      );
    }
  }

  return {
    execution: issues.length > 0 ? "ERROR" : "COMPLETE",
    issues,
    packageId: document.packageId,
    artifacts,
    extensions,
    capabilities,
  };
}

/**
 * La proyección para shell y CI de D13. La autoridad semántica es el JSON: esto
 * existe para que un `if` de un script no tenga que leerlo.
 */
export function exitCodeFor(result: IngestResult): number {
  if (result.execution === "COMPLETE") return 0;
  // Antes que el 20: un paquete que no cabe **no es un paquete inválido**. Puede
  // estar perfecto y no caber, y quien automatiza reacciona distinto —dar más
  // memoria, partir la entrega— que ante un manifest mal escrito.
  if (result.issues.some((entry) => RESOURCE_LIMIT_REASONS.includes(entry.reason))) return 23;
  if (result.execution !== "UNSUPPORTED") return 20;
  // 21 y 22 son cosas distintas: una es «este contrato no lo leo» y la otra «este
  // fichero no lo leo». Quien automatiza reacciona distinto —actualizar el
  // consumidor, o convertir el artifact— y un único código las mezclaría.
  return result.issues.some((entry) => entry.reason === "ARTIFACT_FORMAT_UNSUPPORTED") ? 22 : 21;
}
