/**
 * Cómo se decide un criterio, y quién domina — escrito una vez.
 *
 * Lo usan dos cruces que no se parecen en nada más: los candidatos de
 * reconstrucción (`reconstruction/candidates.ts`, R9) y el barrido de variantes
 * (`sweep.ts`). Hasta el 2026-11-17 la regla vivía dentro del primero; el
 * segundo la habría copiado, y dos copias de «cuándo un número gana a otro»
 * acaban decidiendo distinto el mismo empate. Vive aquí, en el núcleo del banco,
 * porque D27 deja que las capas importen del núcleo y no al revés.
 *
 * ## No sale una nota
 *
 * No hay «calidad 0,87». Un número agregado necesita pesos —¿cuánto vale un punto
 * de cobertura contra mil aristas de borde?— y esos pesos no los conoce quien mide,
 * los conoce quien va a usar la pieza. Lo que sale es **dominancia**: gana quien
 * es el mejor en **todos** los criterios decididos. Si nadie lo es, se dice, y los
 * criterios cruzados quedan a la vista —el compromiso es del que elige—.
 *
 * ## Lo aproximado se compara con su intervalo
 *
 * Dos medidas de muestreo cuyos intervalos se tocan **no son distintas**:
 * ordenarlas sería ordenar ruido. Una medida exacta se compara estricta, y un
 * empate es un empate, no una victoria de quien llegó antes.
 */

export type CriterionDirection = "MAYOR_MEJOR" | "MENOR_MEJOR";

export interface CriterionValue {
  candidate: string;
  value: number;
  /** Intervalo de dos sigmas cuando la medida es de muestreo. Ausente si es exacta. */
  interval?: [number, number];
}

export interface CriterionComparison {
  name: string;
  direction: CriterionDirection;
  /** EXACT compara estricto; APPROXIMATE necesita que los intervalos no se toquen. */
  measurementClass: "EXACT" | "APPROXIMATE";
  values: CriterionValue[];
  /** Quién gana. `null` con motivo cuando no se puede decidir. */
  best: string | null;
  reason?: string;
}

/**
 * Decide un criterio a partir de sus valores.
 *
 * Con medidas exactas basta comparar; con medidas de muestreo hacen falta los
 * intervalos, y **si los del mejor y el segundo se tocan, no hay decisión**.
 */
export function decideCriterion(
  name: string,
  direction: CriterionDirection,
  measurementClass: "EXACT" | "APPROXIMATE",
  values: CriterionValue[],
): CriterionComparison {
  const base = { name, direction, measurementClass, values };
  if (values.length < 2) {
    return { ...base, best: null, reason: "MEDIDA_AUSENTE_EN_ALGUN_CANDIDATO" };
  }

  const mejorQue = (a: number, b: number) => (direction === "MAYOR_MEJOR" ? a > b : a < b);
  const ordenados = [...values].sort((a, b) =>
    mejorQue(a.value, b.value) ? -1 : mejorQue(b.value, a.value) ? 1 : a.candidate.localeCompare(b.candidate),
  );
  const [primero, segundo] = ordenados;

  if (primero.value === segundo.value) {
    return { ...base, best: null, reason: "EMPATE" };
  }
  if (measurementClass === "APPROXIMATE") {
    const [bajoA, altoA] = primero.interval ?? [primero.value, primero.value];
    const [bajoB, altoB] = segundo.interval ?? [segundo.value, segundo.value];
    // Solapan si ninguno queda entero por encima del otro. Con muestreo, dos
    // números distintos que caen dentro del error del otro no son dos números
    // distintos.
    if (bajoA <= altoB && bajoB <= altoA) {
      return { ...base, best: null, reason: "INTERVALOS_SOLAPADOS" };
    }
  }
  return { ...base, best: primero.candidate };
}

/**
 * Quién domina, con la regla de R9: el mejor en **todos** los criterios
 * decididos. Los indecidibles —empate, intervalos que se tocan, medida ausente—
 * **no cuentan a favor ni en contra**: no se sabe quién gana ahí, y darlo por
 * empate sería decidirlo.
 *
 * **Con dos candidatos es dominancia de verdad; con tres o más, no siempre.**
 * Un criterio cuyo mejor valor comparten dos candidatos se declara EMPATE y se
 * cae, y entonces puede ganar un tercero que en ese criterio es peor que los dos.
 * Anotado el 2026-11-17 al mover la regla aquí, y **sin cambiarla**: es el
 * veredicto del cruce de candidatos, que tiene consumidor fuera, y alinearlo es
 * decisión de quien lo consume. El barrido, que sí es de muchos, decide por la
 * frontera (`sweep.ts`).
 */
export function dominanceVerdict(
  candidates: readonly string[],
  criteria: readonly CriterionComparison[],
): { verdict: string | null; reason?: string } {
  const decididos = criteria.filter((criterion) => criterion.best !== null);
  if (decididos.length === 0) return { verdict: null, reason: "NINGUN_CRITERIO_DECIDIBLE" };
  for (const id of candidates) {
    if (decididos.every((criterion) => criterion.best === id)) return { verdict: id };
  }
  return { verdict: null, reason: "NINGUNO_DOMINA" };
}

/**
 * La frontera: los candidatos a los que **ningún otro** domina por pares —igual o
 * mejor en todos los criterios que los dos tienen, y estrictamente mejor en
 * alguno—.
 *
 * Con dos candidatos dice lo mismo que el veredicto; con veinte dice más. Un
 * veredicto casi nunca existe cuando hay muchas variantes —basta que dos empaten
 * en un criterio para que nadie gane «todos»—, y entonces lo útil no es «nadie
 * domina» sino **cuáles no tienen a nadie mejor en todo**: entre ellos está la
 * elección, y fuera de ellos no.
 *
 * Solo para medidas exactas: con intervalos, «mejor por pares» pide decidir qué
 * hacer cuando se solapan dos de tres, y eso es criterio de quien elige.
 */
export function paretoFrontier(
  candidates: readonly string[],
  criteria: readonly CriterionComparison[],
): string[] {
  const valueOf = (criterion: CriterionComparison, id: string) =>
    criterion.values.find((entry) => entry.candidate === id)?.value;
  const dominates = (a: string, b: string) => {
    let strictly = false;
    let compared = false;
    for (const criterion of criteria) {
      const va = valueOf(criterion, a);
      const vb = valueOf(criterion, b);
      if (va === undefined || vb === undefined) continue;
      compared = true;
      const mejor = criterion.direction === "MAYOR_MEJOR" ? va > vb : va < vb;
      const peor = criterion.direction === "MAYOR_MEJOR" ? va < vb : va > vb;
      if (peor) return false;
      if (mejor) strictly = true;
    }
    return compared && strictly;
  };
  return candidates.filter((id) => !candidates.some((other) => other !== id && dominates(other, id)));
}
