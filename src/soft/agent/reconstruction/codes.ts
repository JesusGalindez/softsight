/**
 * Los identificadores neutros de la frontera, en un solo sitio y con su estado.
 *
 * D2 pide dos cosas por aviso, no una: **código legible en español**, para quien
 * lo lee, y un **identificador neutro y estable**, que es lo que el otro lado
 * parsea. Nunca el mensaje. Aquí eso se reparte así:
 *
 * ```text
 * code     SS-PKG-001      identificador neutro; esto es lo que se parsea
 * reason   ARTIFACT_MISSING  motivo canónico, el vocabulario del contrato
 * message  texto en español, con la ruta y el número concretos; nunca se parsea
 * ```
 *
 * **Por qué esta tabla y no `warningCodes.ts`.** Aquélla define los avisos del
 * informe de escena, que llevan `severity` —certeza o candidato— porque describen
 * juicios sobre geometría. Estos no juzgan nada: dicen por qué un paquete no
 * entra. Meterlos allí obligaría a inventarles una severidad que no significa
 * nada, y D28 es explícita en que los vocabularios no se contaminan.
 *
 * ## Qué está fijado y qué no
 *
 * Los cuatro del sandbox los asigna D6, con número. Los cuatro de esquema,
 * sellado e integridad **no los asigna nadie**: el contrato nombra sus motivos
 * pero no sus números, y el número es lo que VideoMesh graba en sus pruebas.
 * Están marcados `PROPUESTO` en la tabla, no en un comentario, para que la puerta
 * pueda contarlos y para que un `--schema` los publique con su estado. Cuando
 * VideoMesh conteste, cambia el estado y —si cambian los números— cambia aquí, en
 * un sitio.
 */

export type CodeStatus = "FIJADO" | "PROPUESTO";

export interface PackageCodeEntry {
  /** Motivo canónico que acompaña al identificador. */
  reason: string;
  /** Qué lo provoca, en una línea. */
  cause: string;
  status: CodeStatus;
  /** Qué decisión lo fija, o qué decisión nombra el motivo sin darle número. */
  decision: string;
}

export const PACKAGE_CODE_TABLE = {
  "SS-PKG-001": {
    reason: "ARTIFACT_PATH_ESCAPES_ROOT",
    cause: "la ruta de un artifact sale de la raíz del paquete con `..`",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-002": {
    reason: "ARTIFACT_PATH_ABSOLUTE",
    cause: "la ruta de un artifact es absoluta en vez de relativa a la raíz",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-003": {
    reason: "ARTIFACT_PATH_ESCAPES_ROOT",
    cause: "la ruta es legal pero su enlace resuelve fuera de la raíz",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-004": {
    reason: "ARTIFACT_MISSING",
    cause: "el artifact declarado no existe, no se puede leer o su enlace está roto",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-010": {
    reason: "CONTRACT_SCHEMA_MISMATCH",
    cause: "el manifest no encaja con el esquema del paquete",
    status: "PROPUESTO",
    decision: "D16 nombra el motivo, sin número",
  },
  "SS-PKG-011": {
    reason: "PACKAGE_NOT_SEALED",
    cause: "el paquete no está sellado y solo se consume SEALED",
    status: "PROPUESTO",
    decision: "D29 nombra el motivo, sin número",
  },
  "SS-PKG-012": {
    reason: "ARTIFACT_SIZE_MISMATCH",
    cause: "el tamaño declarado no es el del fichero",
    status: "PROPUESTO",
    decision: "D7 nombra la comprobación, sin número",
  },
  "SS-PKG-013": {
    reason: "ARTIFACT_HASH_MISMATCH",
    cause: "el contenido no coincide con el sha256 declarado",
    status: "PROPUESTO",
    decision: "D7 nombra la comprobación, sin número",
  },
  "SS-PKG-014": {
    // Aparte del anterior a propósito: «el hash no cuadra» y «el hash no es un
    // hash» se arreglan en sitios distintos —uno es el contenido, el otro el
    // escritor del manifest— y quien automatice sobre el identificador quiere
    // poder distinguirlos.
    reason: "ARTIFACT_HASH_MALFORMED",
    cause: "el sha256 declarado no es hexadecimal de 64 caracteres en minúscula",
    status: "PROPUESTO",
    decision: "D7 nombra la comprobación, sin número",
  },
  "SS-PKG-020": {
    reason: "CONTRACT_VERSION_UNSUPPORTED",
    cause: "el paquete declara una versión de contrato que este binario no sabe leer",
    status: "PROPUESTO",
    decision: "D16 nombra el motivo, sin número",
  },
  "SS-PKG-021": {
    reason: "CONTRACT_SCHEMA_MISMATCH",
    cause: "el hash de esquema declarado no está en el registro de versiones aceptadas",
    status: "PROPUESTO",
    decision: "D16 nombra el motivo, sin número",
  },
  "SS-PKG-022": {
    reason: "ARTIFACT_FORMAT_UNSUPPORTED",
    cause: "el artifact viene en un formato que este binario no lee, como un PLY binario",
    status: "PROPUESTO",
    decision: "D5 y D13 nombran el caso, sin número",
  },
  "SS-PKG-023": {
    reason: "EXTENSION_REQUIRED_UNSUPPORTED",
    cause: "el paquete declara una extensión `required` que este binario no entiende",
    status: "PROPUESTO",
    decision: "D30 nombra el desenlace UNSUPPORTED, sin número",
  },
  "SS-PKG-024": {
    reason: "CAPABILITY_REQUIRED_UNSUPPORTED",
    cause: "el paquete requiere una capability que este binario no sabe hacer",
    status: "PROPUESTO",
    decision: "D31 nombra el desenlace UNSUPPORTED, sin número",
  },

  // El espacio `SS-RECON`: lo que el paquete se contradice a sí mismo diciendo.
  // No es un fallo de lectura ni de integridad —el fichero está bien y el hash
  // cuadra—, es que dos campos suyos no pueden ser ciertos a la vez.
  "SS-RECON-001": {
    reason: "ABSOLUTE_BUDGET_WITHOUT_ABSOLUTE_SCALE",
    cause: "un presupuesto en unidades absolutas sobre una escala que no es ABSOLUTE",
    status: "PROPUESTO",
    decision: "D9 fija la regla, sin número",
  },
  "SS-RECON-002": {
    reason: "BUDGET_UNIT_MISDECLARED",
    cause: "un presupuesto absoluto sin unidad, o uno relativo con ella",
    status: "PROPUESTO",
    decision: "D9 fija la regla, sin número",
  },
  "SS-RECON-003": {
    reason: "FRAME_TRANSFORM_MALFORMED",
    cause: "una arista del FrameGraph que no son dieciséis números finitos, o que va de un marco a sí mismo, o que está declarada dos veces",
    status: "PROPUESTO",
    decision: "D11 exige registrar cada transformación, sin número",
  },
  "SS-RECON-004": {
    reason: "FRAME_TRANSFORM_NOT_RIGID",
    cause: "una transformación entre marcos cuya última fila no es [0, 0, 0, 1]",
    status: "PROPUESTO",
    decision: "D11 y D32 fijan la forma, sin número",
  },
  "SS-RECON-005": {
    reason: "FRAME_UNREACHABLE",
    cause: "un marco declarado al que no hay camino desde el marco en el que se mide",
    status: "PROPUESTO",
    decision: "D11 exige registrar cada transformación, sin número",
  },

  // El espacio `SS-CAM`: la cámara y los píxeles que dice describir.
  "SS-CAM-001": {
    reason: "CAMERA_IMAGE_HASH_MISMATCH",
    cause: "la cámara declara un sha256 de imagen que no es el del artifact al que apunta",
    status: "PROPUESTO",
    decision: "D10 exige atar píxeles y calibración, sin número",
  },
  "SS-CAM-002": {
    reason: "CAMERA_IMAGE_MISSING",
    cause: "la cámara apunta a un artifact que no existe o no es una imagen",
    status: "PROPUESTO",
    decision: "D10 exige atar píxeles y calibración, sin número",
  },
  "SS-CAM-003": {
    reason: "RECTIFIED_WITH_DISTORTION",
    cause: "unos intrínsecos declarados sobre imagen rectificada traen coeficientes de distorsión",
    status: "PROPUESTO",
    decision: "D10 nombra el caso, sin número",
  },
  "SS-CAM-006": {
    reason: "DEPTH_CAMERA_MISSING",
    cause: "un mapa de profundidad apunta a una cámara que el CameraSet no declara",
    status: "PROPUESTO",
    decision: "D20 exige que la profundidad sea interpretable, sin número",
  },
  "SS-CAM-005": {
    reason: "CAMERA_POSE_NOT_RIGID",
    cause: "una pose de cámara cuya última fila no es [0, 0, 0, 1]",
    status: "PROPUESTO",
    decision: "D32 fija la forma de la matriz, sin número",
  },
  "SS-CAM-004": {
    reason: "CAMERA_GRID_MISMATCH",
    cause: "las dimensiones declaradas no son las de la rejilla real de la imagen",
    status: "PROPUESTO",
    decision: "D33 fija que las dimensiones describen la rejilla real, sin número",
  },

  // El espacio `SS-IO`: leer ficheros de otro. Son los topes de `limits.ts` y la
  // lectura que no se puede completar, y se separan de `SS-PKG` porque no dicen
  // que el paquete esté mal: un paquete perfecto puede no caber. Por eso los
  // proyecta el código de salida 23 y no el 20.
  "SS-IO-001": {
    reason: "MANIFEST_TOO_LARGE",
    cause: "el manifest pasa del tope de bytes antes de leerlo",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-002": {
    reason: "ARTIFACT_TOO_LARGE",
    cause: "el artifact declara más bytes que el tope",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-003": {
    reason: "PACKAGE_TOO_MANY_ARTIFACTS",
    cause: "el manifest declara más artifacts que el tope",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-004": {
    reason: "PLY_HEADER_TOO_LONG",
    cause: "la cabecera del PLY no termina dentro del tope de líneas",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-005": {
    reason: "PLY_ELEMENT_COUNT_EXCEEDS_LIMIT",
    cause: "un elemento del PLY declara más entradas que el tope",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-006": {
    // Separado del anterior a propósito, igual que 013 y 014: «no cabe» lo
    // arregla quien produce el fichero y «declara más de lo que trae» lo arregla
    // su escritor. Y es el que de verdad ataja la cabecera mentirosa, porque se
    // decide contando filas y sin reservar nada.
    reason: "PLY_TRUNCATED",
    cause: "un elemento del PLY declara más entradas de las que el fichero trae",
    status: "PROPUESTO",
    decision: "D13 reserva el código de salida 23, sin número de identificador",
  },
  "SS-IO-007": {
    reason: "ARTIFACT_UNREADABLE",
    cause: "el artifact está admitido pero no se puede interpretar, y no es un formato que se rechace por su nombre",
    status: "PROPUESTO",
    decision: "D7 nombra la lectura, sin número",
  },
} as const satisfies Record<string, PackageCodeEntry>;

export type PackageCode = keyof typeof PACKAGE_CODE_TABLE;

/**
 * La tabla como lista, para publicarla. Deriva de la tabla en vez de escribirse
 * al lado: una copia con vida propia diverge en el primer código nuevo, y quien
 * la lea se la creerá.
 */
export const PACKAGE_CODE_LIST = Object.entries(PACKAGE_CODE_TABLE).map(([code, entry]) => ({
  code,
  ...entry,
}));

/** Los que todavía no tienen número acordado: se envían, no se dan por buenos. */
export const PROPOSED_PACKAGE_CODES = PACKAGE_CODE_LIST.filter(
  (entry) => entry.status === "PROPUESTO",
).map((entry) => entry.code);
