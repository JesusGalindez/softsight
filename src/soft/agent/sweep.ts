/**
 * El barrido: K variantes de una misma base, cruzadas sin nota (plan de mejora,
 * 3.2).
 *
 * Un agente que busca —qué ajuste del perfil deja menos aristas abiertas, qué
 * reparto de piezas corta por la costura— prueba muchas combinaciones y se queda
 * con una. Hacerlo de una en una son K llamadas y K informes en el contexto; aquí
 * son una llamada y una tabla. Lo que esta función hace es lo que queda cuando ya
 * se tienen los K informes: leer de cada uno los números que pidió quien llama y
 * cruzarlos.
 *
 * ## Los criterios los declara quien llama
 *
 * Qué campo y en qué dirección —`MENOR_MEJOR`, `MAYOR_MEJOR`—. Este módulo no
 * sabe si más triángulos es mejor o peor: depende de para qué sea la pieza. Lo
 * que sí sabe es leer el número sin inventarlo:
 *
 * ```text
 * un número                 ese número
 * una lista                 cuántos elementos tiene — `warnings` cuenta avisos
 * cualquier otra cosa       error: un criterio que no es un número no ordena nada
 * una ruta que no existe    error con sugerencia, igual que `--fields`
 * ```
 *
 * Lo segundo es la única lectura que no es copiar: contar una lista. Se dice aquí
 * para que no sorprenda, y es lo que deja usar `warnings` como criterio, que es el
 * que casi todo el mundo quiere.
 *
 * ## Y no sale una nota
 *
 * Sale lo mismo que en el cruce de candidatos —`dominance.ts`—: cada criterio
 * decidido o con su motivo, y **la frontera**: las variantes que no tienen a
 * nadie mejor en todo. Todas las medidas de un informe de revisión son exactas
 * —recuentos, cajas, píxeles—, así que todos los criterios son `EXACT`.
 *
 * ## El veredicto sale de la frontera, no de `dominanceVerdict`
 *
 * Hay ganador solo si la frontera tiene **uno**: entonces ese domina a todos los
 * demás, mejor o igual en cada criterio y estrictamente mejor en alguno. La regla
 * de R9 —el mejor de cada criterio decidido— coincide con esto entre dos, y con
 * tres o más no: si dos variantes empatan arriba en un criterio, ese criterio se
 * descarta y puede ganar una tercera que en él es **peor**. Con el dron, la base y
 * «movido» empatan a 296 piezas, el criterio se cae, y ganaría «sin-bujes», que
 * tiene 292. Un barrido es justo el caso de muchas variantes, así que no puede
 * usar esa regla.
 */

import { decideCriterion, paretoFrontier, type CriterionComparison, type CriterionDirection } from "./dominance";
import { closeEnough } from "./schema";

export interface SweepCriterion {
  /** Ruta con puntos en el informe completo, como en `--fields`. */
  field: string;
  direction: CriterionDirection;
}

/** Una variante que se pudo revisar: su nombre y su informe completo. */
export interface SweepEntry {
  name: string;
  report: Record<string, unknown>;
}

export interface SweepComparison {
  /** Las que entran, en el orden en que llegaron. */
  compared: string[];
  criteria: CriterionComparison[];
  /** La que gana todos los criterios decididos, o `null` con su motivo. */
  verdict: string | null;
  reason?: string;
  /** Las que ninguna otra domina por pares. Vacía sin criterios. */
  frontier: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * El número de un criterio en un informe. Lanza con el mismo tipo de mensaje que
 * `--fields`: un criterio con una errata que saliera «sin valor» sería un hueco
 * silencioso, y el cruce diría «empate» donde nadie midió nada.
 */
export function criterionValue(report: Record<string, unknown>, field: string, where: string): number {
  const steps = field.split(".");
  let source: unknown = report;
  for (const [index, step] of steps.entries()) {
    if (!isPlainObject(source) || !(step in source)) {
      const keys = isPlainObject(source) ? Object.keys(source) : [];
      const suggestion = keys.find((candidate) => closeEnough(step, candidate));
      throw new Error(
        `criterio ${field}: no existe en el informe de ${where}` +
          (suggestion !== undefined
            ? `; ¿querías decir ${[...steps.slice(0, index), suggestion].join(".")}?`
            : keys.length > 0
              ? `; las claves disponibles ahí son ${keys.join(", ")}`
              : `; ${steps.slice(0, index).join(".")} no es un objeto por el que se pueda bajar`),
      );
    }
    source = source[step];
  }
  if (typeof source === "number" && Number.isFinite(source)) return source;
  if (Array.isArray(source)) return source.length;
  throw new Error(
    `criterio ${field}: en el informe de ${where} vale ${source === null ? "null" : typeof source}, ` +
      "y un criterio necesita un número o una lista —que se cuenta por su longitud—",
  );
}

/** Cruza las variantes por los criterios declarados. */
export function compareSweep(entries: readonly SweepEntry[], criteria: readonly SweepCriterion[]): SweepComparison {
  const compared = entries.map((entry) => entry.name);
  if (criteria.length === 0) {
    return { compared, criteria: [], verdict: null, reason: "SIN_CRITERIOS_DECLARADOS", frontier: [] };
  }
  const decided = criteria.map((criterion) =>
    decideCriterion(
      criterion.field,
      criterion.direction,
      "EXACT",
      entries.map((entry) => ({ candidate: entry.name, value: criterionValue(entry.report, criterion.field, entry.name) })),
    ),
  );
  const frontier = paretoFrontier(compared, decided);
  if (frontier.length === 1) return { compared, criteria: decided, verdict: frontier[0], frontier };
  // Nadie distingue a nadie: todas las variantes valen lo mismo en todo.
  const distinguishes = decided.some((criterion) => new Set(criterion.values.map((entry) => entry.value)).size > 1);
  return {
    compared,
    criteria: decided,
    verdict: null,
    reason: distinguishes ? "NINGUNO_DOMINA" : "NINGUN_CRITERIO_DECIDIBLE",
    frontier,
  };
}
