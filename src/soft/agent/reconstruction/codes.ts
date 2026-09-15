/**
 * Los identificadores neutros de la frontera, en un solo sitio y con su estado.
 *
 * D2 pide dos cosas por aviso, no una: **código legible en español**, para quien
 * lo lee, y un **identificador neutro y estable**, que es lo que el otro lado
 * parsea. Nunca el mensaje. Aquí eso se reparte así:
 *
 * ```text
 * code     SS-PKG-001      identificador neutro; esto es lo que se parsea
 * reason   ARTEFACTO_AUSENTE  motivo canónico, el vocabulario del contrato
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
 * Los cuatro del sandbox los asigna D6, con número. Los otros treinta y dos
 * estuvieron `PROPUESTO` desde el 2026-08-12: el contrato nombraba sus motivos
 * pero no sus números, y el número es lo que VideoMesh graba en sus pruebas.
 * Estaban marcados en la tabla y no en un comentario para que la puerta pudiera
 * contarlos.
 *
 * **VideoMesh contestó el 2026-09-15: los acepta tal cual, sin renumerar.** El
 * argumento no es de preferencia. Sus reglas de `SS-RECON-003`, `004` y `005`
 * —`TRANSFORMACION_MAL_FORMADA`, `TRANSFORMACION_NO_RIGIDA`,
 * `MARCO_INALCANZABLE`— se escribieron allí desde el texto de D11, sin mirar esta
 * tabla, y coinciden con estos motivos palabra por palabra. Dos implementaciones
 * que llegan al mismo vocabulario por separado dicen que el vocabulario es el
 * correcto; renumerar habría roto fixtures vivos de los dos lados a cambio de
 * nada. Una puerta de VideoMesh compara sus motivos contra esta tabla y se pone
 * roja si aquí se renombra uno.
 *
 * Ya no queda ningún `PROPUESTO`. El tipo se conserva porque el siguiente código
 * nuevo volverá a nacer así.
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
    reason: "RUTA_FUERA_DE_LA_RAIZ",
    cause: "la ruta de un artifact sale de la raíz del paquete con `..`",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-002": {
    reason: "RUTA_ABSOLUTA",
    cause: "la ruta de un artifact es absoluta en vez de relativa a la raíz",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-003": {
    reason: "RUTA_FUERA_DE_LA_RAIZ",
    cause: "la ruta es legal pero su enlace resuelve fuera de la raíz",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-004": {
    reason: "ARTEFACTO_AUSENTE",
    cause: "el artifact declarado no existe, no se puede leer o su enlace está roto",
    status: "FIJADO",
    decision: "D6",
  },
  "SS-PKG-010": {
    reason: "ESQUEMA_NO_COINCIDE",
    cause: "el manifest no encaja con el esquema del paquete",
    status: "FIJADO",
    decision: "D16 nombra el motivo, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-011": {
    reason: "PAQUETE_SIN_SELLAR",
    cause: "el paquete no está sellado y solo se consume SEALED",
    status: "FIJADO",
    decision: "D29 nombra el motivo, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-012": {
    reason: "TAMANO_NO_COINCIDE",
    cause: "el tamaño declarado no es el del fichero",
    status: "FIJADO",
    decision: "D7 nombra la comprobación, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-013": {
    reason: "HASH_NO_COINCIDE",
    cause: "el contenido no coincide con el sha256 declarado",
    status: "FIJADO",
    decision: "D7 nombra la comprobación, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-014": {
    // Aparte del anterior a propósito: «el hash no cuadra» y «el hash no es un
    // hash» se arreglan en sitios distintos —uno es el contenido, el otro el
    // escritor del manifest— y quien automatice sobre el identificador quiere
    // poder distinguirlos.
    reason: "HASH_MAL_FORMADO",
    cause: "el sha256 declarado no es hexadecimal de 64 caracteres en minúscula",
    status: "FIJADO",
    decision: "D7 nombra la comprobación, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-020": {
    reason: "VERSION_DE_CONTRATO_NO_SOPORTADA",
    cause: "el paquete declara una versión de contrato que este binario no sabe leer",
    status: "FIJADO",
    decision: "D16 nombra el motivo, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-021": {
    reason: "ESQUEMA_NO_COINCIDE",
    cause: "el hash de esquema declarado no está en el registro de versiones aceptadas",
    status: "FIJADO",
    decision: "D16 nombra el motivo, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-022": {
    reason: "FORMATO_NO_SOPORTADO",
    cause: "el artifact viene en un formato que este binario no lee, como un PLY binario",
    status: "FIJADO",
    decision: "D5 y D13 nombran el caso, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-023": {
    reason: "EXTENSION_REQUERIDA_NO_SOPORTADA",
    cause: "el paquete declara una extensión `required` que este binario no entiende",
    status: "FIJADO",
    decision: "D30 nombra el desenlace UNSUPPORTED, número fijado por D2 el 2026-09-15",
  },
  "SS-PKG-024": {
    reason: "CAPACIDAD_REQUERIDA_NO_SOPORTADA",
    cause: "el paquete requiere una capability que este binario no sabe hacer",
    status: "FIJADO",
    decision: "D31 nombra el desenlace UNSUPPORTED, número fijado por D2 el 2026-09-15",
  },

  // El espacio `SS-RECON`: lo que el paquete se contradice a sí mismo diciendo.
  // No es un fallo de lectura ni de integridad —el fichero está bien y el hash
  // cuadra—, es que dos campos suyos no pueden ser ciertos a la vez.
  "SS-RECON-001": {
    reason: "PRESUPUESTO_ABSOLUTO_SIN_ESCALA_ABSOLUTA",
    cause: "un presupuesto en unidades absolutas sobre una escala que no es ABSOLUTE",
    status: "FIJADO",
    decision: "D9 fija la regla, número fijado por D2 el 2026-09-15",
  },
  "SS-RECON-002": {
    reason: "UNIDAD_DE_PRESUPUESTO_MAL_DECLARADA",
    cause: "un presupuesto absoluto sin unidad, o uno relativo con ella",
    status: "FIJADO",
    decision: "D9 fija la regla, número fijado por D2 el 2026-09-15",
  },
  "SS-RECON-003": {
    reason: "TRANSFORMACION_MAL_FORMADA",
    cause: "una arista del FrameGraph que no son dieciséis números finitos, o que va de un marco a sí mismo, o que está declarada dos veces",
    status: "FIJADO",
    decision: "D11 exige registrar cada transformación, número fijado por D2 el 2026-09-15",
  },
  "SS-RECON-004": {
    reason: "TRANSFORMACION_NO_RIGIDA",
    cause: "una transformación entre marcos cuya última fila no es [0, 0, 0, 1]",
    status: "FIJADO",
    decision: "D11 y D32 fijan la forma, número fijado por D2 el 2026-09-15",
  },
  "SS-RECON-005": {
    reason: "MARCO_INALCANZABLE",
    cause: "un marco declarado al que no hay camino desde el marco en el que se mide",
    status: "FIJADO",
    decision: "D11 exige registrar cada transformación, número fijado por D2 el 2026-09-15",
  },
  // Los espacios `SS-COV` y `SS-CONF`: lo que la evidencia sostiene y lo que no.
  // No dicen que el paquete esté mal —un paquete puede no cubrir la base a
  // propósito— sino qué parte de lo que entrega no tiene detrás una foto.
  "SS-COV-001": {
    reason: "SUPERFICIE_SIN_EVIDENCIA",
    cause: "parte de la superficie no la ve ninguna cámara declarada",
    status: "FIJADO",
    decision: "D21 fija qué puede certificar la cobertura, número fijado por D2 el 2026-09-15",
  },
  "SS-COV-002": {
    reason: "SUPERFICIE_SIN_TRIANGULAR",
    cause: "parte de la superficie la ve una sola cámara, así que hay foto y no hay profundidad",
    status: "FIJADO",
    decision: "D21 fija qué puede certificar la cobertura, número fijado por D2 el 2026-09-15",
  },
  "SS-CONF-001": {
    reason: "PARALAJE_CORTO",
    cause: "parte de la superficie la ven dos o más cámaras demasiado juntas para determinar profundidad",
    status: "FIJADO",
    decision: "P6 y D28 fijan que la confianza no se trate como exacta, número fijado por D2 el 2026-09-15",
  },

  // El espacio `SS-CAM`: la cámara y los píxeles que dice describir.
  "SS-CAM-001": {
    reason: "HASH_DE_IMAGEN_NO_COINCIDE",
    cause: "la cámara declara un sha256 de imagen que no es el del artifact al que apunta",
    status: "FIJADO",
    decision: "D10 exige atar píxeles y calibración, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-002": {
    reason: "IMAGEN_DE_CAMARA_AUSENTE",
    cause: "la cámara apunta a un artifact que no existe o no es una imagen",
    status: "FIJADO",
    decision: "D10 exige atar píxeles y calibración, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-003": {
    reason: "RECTIFICADA_CON_DISTORSION",
    cause: "unos intrínsecos declarados sobre imagen rectificada traen coeficientes de distorsión",
    status: "FIJADO",
    decision: "D10 nombra el caso, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-006": {
    reason: "CAMARA_DE_PROFUNDIDAD_AUSENTE",
    cause: "un mapa de profundidad apunta a una cámara que el CameraSet no declara",
    status: "FIJADO",
    decision: "D20 exige que la profundidad sea interpretable, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-005": {
    reason: "POSE_NO_RIGIDA",
    cause: "una pose de cámara cuya última fila no es [0, 0, 0, 1]",
    status: "FIJADO",
    decision: "D32 fija la forma de la matriz, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-004": {
    reason: "REJILLA_NO_COINCIDE",
    cause: "las dimensiones declaradas no son las de la rejilla real de la imagen",
    status: "FIJADO",
    decision: "D33 fija que las dimensiones describen la rejilla real, número fijado por D2 el 2026-09-15",
  },
  "SS-CAM-007": {
    reason: "MASCARA_NO_APLICABLE",
    cause: "una máscara declarada no describe el encuadre de su cámara, o apunta a algo que no está, o no se puede leer; no se aplica y se dice en vez de medir con media silueta",
    status: "FIJADO",
    decision: "D30 abre el espacio de lo experimental, número fijado por D2 el 2026-09-15",
  },

  // El espacio `SS-IO`: leer ficheros de otro. Son los topes de `limits.ts` y la
  // lectura que no se puede completar, y se separan de `SS-PKG` porque no dicen
  // que el paquete esté mal: un paquete perfecto puede no caber. Por eso los
  // proyecta el código de salida 23 y no el 20.
  "SS-IO-001": {
    reason: "MANIFIESTO_DEMASIADO_GRANDE",
    cause: "el manifest pasa del tope de bytes antes de leerlo",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-002": {
    reason: "ARTEFACTO_DEMASIADO_GRANDE",
    cause: "el artifact declara más bytes que el tope",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-003": {
    reason: "DEMASIADOS_ARTEFACTOS",
    cause: "el manifest declara más artifacts que el tope",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-004": {
    reason: "CABECERA_PLY_DEMASIADO_LARGA",
    cause: "la cabecera del PLY no termina dentro del tope de líneas",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-005": {
    reason: "ELEMENTO_PLY_SOBRE_EL_TOPE",
    cause: "un elemento del PLY declara más entradas que el tope",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-006": {
    // Separado del anterior a propósito, igual que 013 y 014: «no cabe» lo
    // arregla quien produce el fichero y «declara más de lo que trae» lo arregla
    // su escritor. Y es el que de verdad ataja la cabecera mentirosa, porque se
    // decide contando filas y sin reservar nada.
    reason: "PLY_TRUNCADO",
    cause: "un elemento del PLY declara más entradas de las que el fichero trae",
    status: "FIJADO",
    decision: "D13 reserva el código de salida 23, número fijado por D2 el 2026-09-15",
  },
  "SS-IO-007": {
    reason: "ARTEFACTO_ILEGIBLE",
    cause: "el artifact está admitido pero no se puede interpretar, y no es un formato que se rechace por su nombre",
    status: "FIJADO",
    decision: "D7 nombra la lectura, número fijado por D2 el 2026-09-15",
  },
} as const satisfies Record<string, PackageCodeEntry>;

export type PackageCode = keyof typeof PACKAGE_CODE_TABLE;

/**
 * La tabla como lista, para publicarla. Deriva de la tabla en vez de escribirse
 * al lado: una copia con vida propia diverge en el primer código nuevo, y quien
 * la lea se la creerá.
 */
export const PACKAGE_CODE_LIST: Array<PackageCodeEntry & { code: string }> = Object.entries(
  PACKAGE_CODE_TABLE,
).map(([code, entry]) => ({
  code,
  ...entry,
}));

/**
 * Los que todavía no tienen número acordado: se envían, no se dan por buenos.
 *
 * Hoy está vacía, desde que VideoMesh contestó el 2026-09-15. Se conserva porque
 * el siguiente código nuevo volverá a nacer `PROPUESTO`, y porque la lista va
 * anotada con `PackageCodeEntry`: sin esa anotación, `as const` estrecha `status`
 * a los literales que hay hoy y el compilador declara imposible una comparación
 * que solo es imposible **por ahora**.
 */
export const PROPOSED_PACKAGE_CODES = PACKAGE_CODE_LIST.filter(
  (entry) => entry.status === "PROPUESTO",
).map((entry) => entry.code);
