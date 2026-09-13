/**
 * Los topes de recurso de la ingesta, en un solo sitio.
 *
 * SoftSight lee ficheros que escribe otro. Hasta aquí no había un solo tope: un
 * PLY que declarase `element vertex 4000000000` reservaba la memoria **antes de
 * leer un byte de datos**, y un manifest de 100 GB se cargaba entero para
 * descubrir que no era JSON. No es una hipótesis: `parsePlyAscii` hacía
 * `new Float32Array(element.count * 3)` con el número que traía la cabecera.
 *
 * ## Por qué una tabla y no un número en cada sitio
 *
 * Un tope escrito donde se aplica es un dato sin dueño: el segundo que alguien
 * ajuste dejará al primero diciendo otra cosa, y el productor no tiene dónde
 * leer cuál rige. Aquí están los cinco, con su unidad y con **por qué ese número
 * y no otro**, y el informe los publica para que un rechazo se pueda reproducir.
 *
 * ## Qué protege cada uno, y qué no
 *
 * Los topes son el techo, no la comprobación fina. Lo que de verdad mata el caso
 * de la cabecera mentirosa es `PLY_TRUNCATED`: un elemento no puede declarar más
 * entradas de las que el fichero trae, y eso se sabe **contando filas, sin
 * reservar nada**. El tope existe para el caso contrario —un fichero enorme y
 * coherente— y para que el rechazo tenga número en vez de terminar en un
 * `RangeError` sin dueño.
 *
 * D13 ya reservaba el código de salida **23, límite de recursos**, y hasta ahora
 * no lo devolvía nadie.
 */

export interface ResourceLimit {
  /** El número que rige. */
  value: number;
  unit: "bytes" | "entradas" | "líneas";
  /** Por qué ese número: sin esto, el siguiente que lo toque lo dobla sin más. */
  rationale: string;
}

export const RESOURCE_LIMITS = {
  /**
   * El manifest se lee entero antes de poder validarlo, así que es la primera
   * lectura sin tope del recorrido. 16 MiB es dos órdenes de magnitud por encima
   * del manifest de un paquete real con cientos de imágenes.
   */
  manifestBytes: {
    value: 16 * 1024 * 1024,
    unit: "bytes",
    rationale: "un manifest real con cientos de cámaras no llega a 1 MiB; 16 MiB deja margen y acota la primera lectura",
  },
  /**
   * Por artifact y no por paquete: el que se abre de una vez es uno, y sumar el
   * total no impediría que un solo fichero no quepa en memoria.
   */
  artifactBytes: {
    value: 1024 * 1024 * 1024,
    unit: "bytes",
    rationale: "una nube densa de COLMAP anda en cientos de MiB; 1 GiB la admite y corta el fichero que no cabe en memoria",
  },
  /**
   * Cientos de imágenes es un paquete normal; decenas de miles es un error del
   * productor, y recorrerlos cuesta una llamada al sistema por cada uno.
   */
  packageArtifacts: {
    value: 10_000,
    unit: "entradas",
    rationale: "una captura real declara cientos de artifacts; 10.000 admite el caso grande y corta el manifest generado en bucle",
  },
  /**
   * Una cabecera de PLY son decenas de líneas. Sin tope, un fichero sin
   * `end_header` recorre el documento entero buscándolo.
   */
  plyHeaderLines: {
    value: 1_000,
    unit: "líneas",
    rationale: "una cabecera de PLY con todas sus propiedades no pasa de decenas de líneas; sin tope, un fichero sin end_header se recorre entero",
  },
  /**
   * Diez veces el escalón de 5M que `test:resources` ya ejerce. Por encima de
   * esto la reserva es de gigabytes y el rechazo es la respuesta honesta.
   */
  plyElementCount: {
    value: 50_000_000,
    unit: "entradas",
    rationale: "diez veces el escalón de 5M que ya se mide; por encima, reservar son gigabytes y rechazar dice la verdad antes de intentarlo",
  },
} as const satisfies Record<string, ResourceLimit>;

export type ResourceLimitName = keyof typeof RESOURCE_LIMITS;

/**
 * La tabla como lista, para publicarla en el informe. Derivada y no escrita al
 * lado: una copia con vida propia diverge en el primer tope que se ajuste, y el
 * productor se creería la copia.
 */
export const RESOURCE_LIMIT_LIST = Object.entries(RESOURCE_LIMITS).map(([name, limit]) => ({
  name,
  ...limit,
}));

/**
 * Los motivos que el código de salida 23 proyecta.
 *
 * Va aquí y no en el CLI porque los emiten dos sitios —la ingesta y el lector de
 * PLY— y la proyección tiene que decir lo mismo en los dos. Un motivo de recurso
 * que no esté en esta lista sale como paquete inválido, que es mentira: el
 * paquete puede ser perfecto y no caber.
 */
export const RESOURCE_LIMIT_REASONS: readonly string[] = [
  "MANIFEST_TOO_LARGE",
  "ARTIFACT_TOO_LARGE",
  "PACKAGE_TOO_MANY_ARTIFACTS",
  "PLY_HEADER_TOO_LONG",
  "PLY_ELEMENT_COUNT_EXCEEDS_LIMIT",
  "PLY_TRUNCATED",
];
