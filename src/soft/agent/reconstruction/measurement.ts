/**
 * D28 — los dos ejes de una medida, en un solo sitio.
 *
 * La decisión separa dos propiedades que un solo enum colapsaba: **si la
 * cantidad medida es exacta**, y **si la implementación produce los mismos
 * bits**. Una cobertura por muestreo es una aproximación de la cobertura real y a
 * la vez puede ser bit a bit reproducible; con un enum solo, decir lo primero
 * obligaba a callar lo segundo.
 *
 * ```text
 * MeasurementClass      qué se midió      EXACT | APPROXIMATE | EXTERNAL_MEASUREMENT
 * ReproducibilityMode   cómo se midió     BITWISE_EXACT | QUANTIZED | TOLERANCE
 * ```
 *
 * ## Por qué `APPROXIMATE` y no `DETERMINISTIC_APPROXIMATION`
 *
 * El texto de D28 conservaba `DETERMINISTIC_APPROXIMATION` del vocabulario
 * anterior mientras adoptaba el nuevo, y eso se contradice consigo mismo: el
 * «DETERMINISTIC_» mete el segundo eje dentro del primero, que es exactamente lo
 * que la decisión existe para deshacer. Con los dos ejes publicados, una medida
 * aproximada y reproducible ya se dice entera:
 *
 * ```text
 * APPROXIMATE + BITWISE_EXACT     no visita toda la superficie, y siempre visita
 *                                 los mismos puntos
 * APPROXIMATE + TOLERANCE         aproximada, y además no reproducible al bit
 * ```
 *
 * Con `DETERMINISTIC_APPROXIMATION` la segunda fila no se puede escribir sin
 * decir dos cosas contradictorias en el mismo documento.
 *
 * ## Por qué esto vive aquí y no repetido en cada módulo
 *
 * Antes no vivía en ningún sitio, y el resultado estaba en el esquema publicado:
 * **el mismo campo con tres formas distintas**.
 *
 * ```text
 * measurements[].measurementClass   enum con DETERMINISTIC_APPROXIMATION
 * repairBoundary.measurementClass   enum con APPROXIMATE
 * coverage / confidence / captureAdvice   string libre, sin enum
 * ```
 *
 * Los tres últimos eran lo peor: su descripción decía `APPROXIMATE` y el esquema
 * no lo exigía, así que `measurementClass: "cualquier cosa"` pasaba la
 * validación. Quien derivara modelos del esquema obtenía tres tipos para un
 * nombre.
 *
 * Los tipos de TypeScript de cada módulo **siguen siendo literales estrechos** —
 * `Coverage.measurementClass` es `"APPROXIMATE"` y no la unión entera— y eso es a
 * propósito: la cobertura nunca es exacta, y ensanchar el tipo para unificarlo
 * perdería esa afirmación. Lo que se unifica es el **vocabulario que cruza la
 * frontera**, que es donde el desacuerdo hacía daño.
 */

/** Qué clase de cantidad es. Ordenadas de más a menos afirmable. */
export const MEASUREMENT_CLASSES = ["EXACT", "APPROXIMATE", "EXTERNAL_MEASUREMENT"] as const;

export type MeasurementClass = (typeof MEASUREMENT_CLASSES)[number];

/** Cómo de reproducible es la implementación que la produjo. */
export const REPRODUCIBILITY_MODES = ["BITWISE_EXACT", "QUANTIZED", "TOLERANCE"] as const;

export type ReproducibilityMode = (typeof REPRODUCIBILITY_MODES)[number];

/** El enum como lo escribe el descriptor del esquema publicado. */
function asSchemaType(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join("|");
}

/**
 * Los dos tipos, ya en la forma que el generador de esquemas entiende.
 *
 * Se derivan de los arrays de arriba y no se escriben a mano: escribirlos era
 * justo lo que permitió que dos campos del mismo documento dijeran cosas
 * distintas.
 */
export const MEASUREMENT_CLASS_TYPE = asSchemaType(MEASUREMENT_CLASSES);
export const REPRODUCIBILITY_TYPE = asSchemaType(REPRODUCIBILITY_MODES);
