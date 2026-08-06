/**
 * La tabla de variación, en su propio módulo.
 *
 * La usan las dos mitades del documento: la **forma** —el radio y la torsión de un
 * barrido, la escala de un afinado— y el **movimiento**, lo que hace una pista de
 * un clip. Vivía en `sceneSpec`, y desde ahí `rigSpec` no podía usarla sin cerrar
 * un ciclo, porque `sceneSpec` ya importa sus tipos.
 *
 * No sabe nada de escenas ni de clips: recibe una tabla y un punto, y devuelve un
 * número.
 */

/**
 * Una función escalar a lo largo de algo, como tabla de estaciones más
 * interpolación declarada.
 *
 * No hay evaluador de expresiones a propósito: traería análisis sintáctico, un
 * modo de fallo que el esquema no sabe cazar —el único que sabe cazar es «campo
 * mal escrito»— y la duda perpetua de si dos máquinas evalúan igual. Con cuatro
 * puntos se describe cualquier variación que un ala necesita, y es el mismo
 * modismo que ya usan los clips de animación: claves más interpolación.
 */
export interface VariationSpec {
  /** Pares `(u, valor)` con `u` de 0 a 1, ordenados y sin repetir. */
  at: number[][];
  /** `linear` por defecto; `smooth`; o `power:k`. */
  ease?: string;
}

/**
 * Una tabla de variación en el punto `u`. Un número suelto es una constante, que
 * es la mayoría de los casos y no debe costar seis caracteres.
 *
 * Fuera del rango declarado el valor se **sujeta** al primero o al último:
 * extrapolar daría radios negativos sin avisar de nada.
 */
export function evaluateVariation(spec: number | VariationSpec, u: number, what = "la tabla"): number {
  if (typeof spec === "number") return spec;
  const table = spec.at;
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error(`${what}: \`at\` necesita al menos un par (u, valor)`);
  }
  for (const [index, entry] of table.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${what}: la entrada ${index} de \`at\` son dos números, (u, valor)`);
    }
    if (index > 0 && entry[0] <= table[index - 1][0]) {
      throw new Error(
        `${what}: \`at\` va en orden creciente de u y sin repetir; la entrada ${index} tiene ` +
          `u=${entry[0]} después de u=${table[index - 1][0]}`,
      );
    }
  }

  if (u <= table[0][0]) return table[0][1];
  if (u >= table[table.length - 1][0]) return table[table.length - 1][1];

  let segment = 0;
  while (segment < table.length - 2 && u >= table[segment + 1][0]) segment += 1;
  const [fromU, fromValue] = table[segment];
  const [toU, toValue] = table[segment + 1];
  const t = (u - fromU) / (toU - fromU);

  const ease = spec.ease ?? "linear";
  let eased: number;
  if (ease === "linear") eased = t;
  else if (ease === "smooth") eased = t * t * (3 - 2 * t);
  else if (ease.startsWith("power:")) {
    const exponent = Number(ease.slice("power:".length));
    if (!Number.isFinite(exponent) || exponent <= 0) {
      throw new Error(`${what}: el exponente de \`${ease}\` debe ser un número positivo`);
    }
    eased = t ** exponent;
  } else {
    throw new Error(`${what}: ease desconocido "${ease}"; admitidos: linear, smooth, power:k`);
  }
  return fromValue + (toValue - fromValue) * eased;
}
