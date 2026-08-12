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
