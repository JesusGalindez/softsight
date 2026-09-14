/**
 * R9 — varios candidatos, e informes que se pueden cruzar.
 *
 * El escalón lo pide así: «VideoMesh manda varios candidatos y recibe informes
 * comparables». La trampa está en **comparables**, que no es lo mismo que
 * producidos con el mismo binario.
 *
 * ## Dos informes medidos no son dos informes comparables
 *
 * Un ratio de cobertura medido con siluetas y otro medido sin ellas contestan
 * preguntas distintas —uno recorta por el contorno de la pieza y el otro cuenta
 * como visto lo que proyecta sobre el cielo—, y los dos son un número entre cero
 * y uno con el mismo nombre. Ponerlos en dos columnas invita a restarlos. Lo
 * mismo con dos versiones de contrato: el campo se llama igual y puede no medir
 * lo mismo.
 *
 * Así que **la comparabilidad se decide antes de ordenar**, criterio a criterio, y
 * lo que no se puede comparar se dice en vez de compararse igual. Es la misma
 * regla que la del umbral en la cobertura: donde la medida no distingue, la
 * respuesta es que no distingue.
 *
 * ## Y no sale una nota
 *
 * No hay «calidad 0,87». Un número agregado necesita pesos —¿cuánto vale un punto
 * de cobertura contra mil aristas de borde?— y esos pesos no los conoce quien mide,
 * los conoce quien va a usar la pieza. Lo que sale es **dominancia**: gana quien
 * es mejor o igual en **todos** los criterios comparables y estrictamente mejor en
 * alguno. Si nadie domina, el informe lo dice y enseña los criterios cruzados —el
 * compromiso es del que elige, y fabricarle una respuesta sería esconderle la
 * decisión—.
 *
 * ## Lo aproximado se compara con su intervalo
 *
 * Dos coberturas de 0,727 y 0,731 medidas con ocho mil muestras **no son
 * distintas**: sus intervalos se solapan enteros. Ordenarlas sería ordenar ruido
 * de muestreo, que es exactamente lo que el §86.3 (k) prohíbe hacer con un umbral
 * y vale igual entre dos candidatos.
 */

import type { Coverage } from "./coverage";
import type { Confidence } from "./confidence";

/** Lo que hace falta de un informe para cruzarlo. Un subconjunto a propósito. */
export interface CandidateReport {
  /** La identidad la lleva el run, no el informe: es del consumo (D29). */
  run?: { inputPackageId?: string; inputManifestSha256?: string };
  contractVersion?: string;
  execution: string;
  certification: string;
  certificationReason?: string;
  measurements: ReadonlyArray<{
    triangles: number;
    degenerateTriangles: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
  }>;
  coverage?: Coverage;
  confidence?: Confidence;
  cameras?: { declared: number; withImage: number };
}

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

export interface ExcludedCandidate {
  candidate: string;
  reason: string;
}

export interface CandidateComparison {
  /** Los que entran en la comparación, en el orden en que llegaron. */
  compared: string[];
  /** Los que no, con su motivo. Nunca se tiran en silencio. */
  excluded: ExcludedCandidate[];
  criteria: CriterionComparison[];
  /**
   * Quién domina: mejor o igual en todos los criterios decididos y estrictamente
   * mejor en alguno. `null` cuando nadie lo hace, y entonces el compromiso es de
   * quien elige.
   */
  verdict: string | null;
  reason?: string;
}

/** Dos sigmas de una proporción sobre muestreo simple, recortado a [0, 1]. */
function intervalo(ratio: number, samples: number): [number, number] {
  const error = Math.sqrt((ratio * (1 - ratio)) / (samples || 1));
  return [Math.max(0, ratio - 2 * error), Math.min(1, ratio + 2 * error)];
}

/**
 * Identidad de un candidato en el cruce.
 *
 * Sale del `packageId` del run, y **se desambigua cuando se repite**: dos
 * candidatos del mismo productor traen el mismo identificador muy a menudo —dos
 * pasadas con otra rejilla, dos ajustes del mismo pipeline— y dos filas con el
 * mismo nombre harían ilegible el veredicto. El sufijo es la posición, que es
 * estable; el hash del manifest sería más único y no se puede leer de un vistazo.
 */
function nombres(reports: readonly CandidateReport[]): string[] {
  const declarados = reports.map(
    (report, index) => report.run?.inputPackageId ?? `candidato-${index + 1}`,
  );
  const veces = new Map<string, number>();
  for (const declarado of declarados) veces.set(declarado, (veces.get(declarado) ?? 0) + 1);
  const vistos = new Map<string, number>();
  return declarados.map((declarado) => {
    if ((veces.get(declarado) ?? 0) < 2) return declarado;
    const orden = (vistos.get(declarado) ?? 0) + 1;
    vistos.set(declarado, orden);
    return `${declarado}#${orden}`;
  });
}

/**
 * Decide un criterio a partir de sus valores.
 *
 * Con medidas exactas basta comparar; con medidas de muestreo hacen falta los
 * intervalos, y **si los del mejor y el segundo se tocan, no hay decisión**.
 */
function decidir(
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

/** Orden del veredicto: certificar es mejor que no saber, y no saber que fallar. */
const CERTIFICATION_ORDER: Record<string, number> = { PASS: 2, INCONCLUSIVE: 1, FAIL: 0 };

export function compareCandidates(reports: readonly CandidateReport[]): CandidateComparison {
  const excluded: ExcludedCandidate[] = [];
  const entrantes: Array<{ id: string; report: CandidateReport }> = [];
  const ids = nombres(reports);

  for (const [index, report] of reports.entries()) {
    const id = ids[index];
    // Un paquete que no se pudo leer **no es un candidato peor**: no dice nada de
    // su geometría, porque no se midió ninguna. Ordenarlo por debajo afirmaría
    // algo que nadie ha comprobado.
    if (report.execution !== "COMPLETE") {
      excluded.push({ candidate: id, reason: "PAQUETE_NO_CONSUMIBLE" });
      continue;
    }
    entrantes.push({ id, report });
  }

  // Versión de contrato: el mismo campo puede no medir lo mismo entre dos
  // versiones, y comparar dos números que se llaman igual es el error que ninguna
  // prueba de aritmética caza. Se compara contra la del primero que entró.
  const referencia = entrantes[0]?.report.contractVersion;
  const compatibles = entrantes.filter(({ id, report }) => {
    if (report.contractVersion === referencia) return true;
    excluded.push({ candidate: id, reason: "CONTRATO_DISTINTO" });
    return false;
  });

  if (compatibles.length < 2) {
    return {
      compared: compatibles.map((entrada) => entrada.id),
      excluded,
      criteria: [],
      verdict: null,
      reason: "MENOS_DE_DOS_CANDIDATOS_COMPARABLES",
    };
  }

  const criteria: CriterionComparison[] = [];
  const recuento = (
    name: string,
    pick: (m: CandidateReport["measurements"][number]) => number,
  ) => {
    const values: CriterionValue[] = [];
    for (const { id, report } of compatibles) {
      if (report.measurements.length === 0) continue;
      values.push({
        candidate: id,
        value: report.measurements.reduce((total, measurement) => total + pick(measurement), 0),
      });
    }
    criteria.push(decidir(name, "MENOR_MEJOR", "EXACT", values));
  };

  criteria.push(
    decidir(
      "certificacion",
      "MAYOR_MEJOR",
      "EXACT",
      compatibles.map(({ id, report }) => ({
        candidate: id,
        value: CERTIFICATION_ORDER[report.certification] ?? 0,
      })),
    ),
  );

  // **Las siluetas cambian la pregunta, no solo el número.** Con máscaras la
  // cobertura recorta por el contorno de la pieza; sin ellas cuenta como visto lo
  // que proyecta sobre el fondo. Comparar las dos sería restar respuestas a
  // preguntas distintas, así que el criterio se declara indecidible en vez de
  // resolverse.
  const conCobertura = compatibles.filter(({ report }) => report.coverage !== undefined);
  const siluetas = new Set(conCobertura.map(({ report }) => report.coverage!.maskedCameras > 0));
  if (conCobertura.length >= 2 && siluetas.size > 1) {
    criteria.push({
      name: "cobertura-observada",
      direction: "MAYOR_MEJOR",
      measurementClass: "APPROXIMATE",
      values: conCobertura.map(({ id, report }) => ({
        candidate: id,
        value: report.coverage!.observedAreaRatio,
        interval: report.coverage!.interval,
      })),
      best: null,
      reason: "SILUETAS_DISTINTAS",
    });
  } else {
    criteria.push(
      decidir(
        "cobertura-observada",
        "MAYOR_MEJOR",
        "APPROXIMATE",
        conCobertura.map(({ id, report }) => ({
          candidate: id,
          value: report.coverage!.observedAreaRatio,
          // El intervalo ya lo publica la cobertura: recalcularlo aquí sería un
          // segundo original del mismo número.
          interval: report.coverage!.interval,
        })),
      ),
    );
    criteria.push(
      decidir(
        "superficie-sostenida",
        "MAYOR_MEJOR",
        "APPROXIMATE",
        compatibles
          .filter(({ report }) => report.confidence !== undefined)
          .map(({ id, report }) => ({
            candidate: id,
            value: report.confidence!.byClass.SOSTENIDA,
            // La confianza no publica intervalo, y es la misma clase de medida:
            // una proporción de área sobre las mismas muestras. Se deriva con el
            // mismo estimador en vez de compararla como si fuera exacta.
            interval: intervalo(report.confidence!.byClass.SOSTENIDA, report.confidence!.samples),
          })),
      ),
    );
  }

  recuento("aristas-de-borde", (m) => m.boundaryEdges);
  recuento("aristas-no-manifold", (m) => m.nonManifoldEdges);
  recuento("triangulos-degenerados", (m) => m.degenerateTriangles);

  // Dominancia: mejor o igual en todos los criterios decididos, y estrictamente
  // mejor en alguno. Los indecidibles **no cuentan a favor ni en contra** — no se
  // sabe quién gana ahí, y darlo por empate sería decidirlo.
  const decididos = criteria.filter((criterion) => criterion.best !== null);
  let verdict: string | null = null;
  let reason: string | undefined = "NINGUNO_DOMINA";
  if (decididos.length === 0) {
    reason = "NINGUN_CRITERIO_DECIDIBLE";
  } else {
    for (const { id } of compatibles) {
      const ganaTodos = decididos.every((criterion) => criterion.best === id);
      if (ganaTodos) {
        verdict = id;
        reason = undefined;
        break;
      }
    }
  }

  return {
    compared: compatibles.map((entrada) => entrada.id),
    excluded,
    criteria,
    verdict,
    ...(reason === undefined ? {} : { reason }),
  };
}
