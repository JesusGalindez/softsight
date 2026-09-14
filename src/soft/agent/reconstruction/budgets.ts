/**
 * R9 — los presupuestos del paquete, evaluados contra lo medido.
 *
 * ## Por qué esto existía a medias
 *
 * `budgets` estaba en el esquema desde R0 y **nadie lo leía**. La ingesta
 * comprobaba que fueran coherentes con la escala —D9: un máximo en metros sobre
 * una escala que nadie fijó no es exigente, es una frase sin sentido— y ahí se
 * acababa. Un paquete podía declarar `aristas-de-borde ≤ 100`, entregar una malla
 * con cuarenta mil, y salir **PASS**.
 *
 * Es el tercer campo de este contrato que se rellenaba por educación, después del
 * FrameGraph y de la provenance. Un campo declarado que nada lee es peor que no
 * tenerlo: el productor cree que puso un límite.
 *
 * ## La lista es cerrada, y ese es el punto
 *
 * `name` es texto libre en el esquema, así que un presupuesto puede llamarse
 * `suavidad` — y contra eso no se puede evaluar nada. La alternativa a la lista
 * cerrada no es «evaluar cualquier cosa», es **callar y aprobar**, que es el
 * estado del que se viene.
 *
 * Un nombre fuera de la lista **se declara `NO_EVALUADO` con su motivo y no toca
 * el veredicto**. No es lo mismo que aprobarlo: el informe dice, término a
 * término, cuál se juzgó y cuál no. Suspender por un nombre que no entendemos
 * sería castigar a un productor por usar un vocabulario más nuevo que el nuestro
 * —la misma política que con las extensiones opcionales de D30—.
 *
 * ## Lo que cada término mide, y cómo se agrega
 *
 * Un paquete puede traer varias mallas, así que el presupuesto es **del paquete**
 * y no de una de ellas:
 *
 * ```text
 * RECUENTO   se suman     mil triángulos aquí y mil allá son dos mil
 * VOLUMEN    se suma      dos piezas ocupan lo que ocupan las dos
 * FRACCION   ya es del    la cobertura se mide sobre toda la superficie, así
 *            paquete      que no hay nada que agregar
 * ```
 *
 * ## La escala solo ata a lo que tiene escala
 *
 * D9 exige `scale.status === "ABSOLUTE"` para un máximo absoluto, y es cierto
 * **para las magnitudes que llevan escala dentro**: medio metro de arista sobre
 * una reconstrucción sin escala no significa nada. Un recuento no la lleva —mil
 * triángulos son mil en cualquier escala— y una fracción tampoco. Aplicarles la
 * regla obligaría a fijar la escala para poder presupuestar un recuento, que es
 * exigir un dato que no hace falta.
 *
 * Por eso la tabla declara la **magnitud** de cada término, y la comprobación de
 * D9 se queda con las que la tienen. Un nombre desconocido sigue tratándose como
 * si llevara escala: no sabemos qué es, y suponer que no la lleva sería suponer a
 * favor — el porqué, con el caso que lo decidió, está en `budgetCarriesScale`.
 */

import type { Coverage } from "./coverage";
import type { Confidence } from "./confidence";

/**
 * Qué clase de magnitud es un término, que es lo que decide dos cosas: si la
 * regla de escala de D9 le aplica, y qué unidades puede declarar.
 */
export type BudgetMagnitude = "RECUENTO" | "VOLUMEN" | "FRACCION";

export interface BudgetTerm {
  magnitude: BudgetMagnitude;
  /** De dónde sale el número, en una frase. Va al informe. */
  measures: string;
  /** Si la regla de escala de D9 le aplica. */
  carriesScale: boolean;
}

/**
 * El vocabulario. **Cerrado**, y en español como el resto de los motivos.
 *
 * No están aquí los números que el informe no publica —componentes conexos,
 * distancia de superficie— porque presupuestar contra una medida que no sale en
 * el informe dejaría al productor sin poder comprobar por qué suspendió.
 */
export const BUDGET_TERMS = {
  triangulos: {
    magnitude: "RECUENTO",
    measures: "triángulos de todas las mallas del paquete, sumados",
    carriesScale: false,
  },
  vertices: {
    magnitude: "RECUENTO",
    measures: "vértices del fichero, sin soldar, sumados",
    carriesScale: false,
  },
  "aristas-de-borde": {
    magnitude: "RECUENTO",
    measures: "aristas con un solo triángulo, sumadas: cuánto hueco deja la superficie",
    carriesScale: false,
  },
  "aristas-no-manifold": {
    magnitude: "RECUENTO",
    measures: "aristas con tres triángulos o más, sumadas",
    carriesScale: false,
  },
  "triangulos-degenerados": {
    magnitude: "RECUENTO",
    measures: "triángulos de área nula, sumados",
    carriesScale: false,
  },
  volumen: {
    magnitude: "VOLUMEN",
    measures: "volumen firmado en valor absoluto, sumado",
    carriesScale: true,
  },
  "superficie-sin-ver": {
    magnitude: "FRACCION",
    measures: "fracción de área que no ve ninguna cámara (R6)",
    carriesScale: false,
  },
  "superficie-sin-triangular": {
    magnitude: "FRACCION",
    measures: "fracción de área que ve una sola cámara (R6)",
    carriesScale: false,
  },
  "paralaje-corto": {
    magnitude: "FRACCION",
    measures: "fracción de área que ven dos o más cámaras demasiado juntas (R6)",
    carriesScale: false,
  },
} as const satisfies Record<string, BudgetTerm>;

export type BudgetName = keyof typeof BUDGET_TERMS;

/** Los nombres, para publicarlos. Derivan de la tabla en vez de copiarse. */
export const BUDGET_NAMES = Object.keys(BUDGET_TERMS) as BudgetName[];

/**
 * Si la regla de escala de D9 ata a este término.
 *
 * Cierto para los que **llevan escala dentro**, y también **para los que no
 * conocemos**. Lo segundo se intentó al revés y una puerta que ya existía lo
 * desmintió: `test:reconstruction` presupuesta `desviación` en metros sobre una
 * escala RELATIVE y exige que se rechace — y eso es una contradicción de verdad,
 * de las que el productor quiere que le canten, con un nombre que este
 * vocabulario no tiene ni tendrá.
 *
 * El coste de ser conservador es estrecho y se puede nombrar: un productor con un
 * término más nuevo que el nuestro **no puede declararlo absoluto sobre una escala
 * que no lo es**. Puede declararlo relativo a la diagonal, o no declararlo. El
 * coste de lo contrario era dejar pasar «medio milímetro de nada», que es la frase
 * con la que D9 se escribió.
 *
 * Lo que sí se afloja, y es lo que hacía falta: un **recuento** o una **fracción**
 * de la lista no piden escala absoluta. Mil triángulos son mil en cualquier
 * escala, y exigir `scale.status` ABSOLUTE para presupuestarlos dejaría sin
 * presupuestos a todo paquete de SfM, que nunca sabe a qué escala reconstruyó.
 */
export function budgetCarriesScale(name: string): boolean {
  const term = (BUDGET_TERMS as Record<string, BudgetTerm>)[name];
  return term === undefined ? true : term.carriesScale;
}

export interface DeclaredBudget {
  name: string;
  units: "ABSOLUTE" | "RELATIVE_TO_DIAGONAL";
  unit?: string;
  max: number;
}

export interface BudgetResult {
  name: string;
  max: number;
  units: string;
  unit?: string;
  /** Lo medido, en las unidades del término. Ausente cuando no se pudo evaluar. */
  observed?: number;
  /** Qué mide el término, copiado de la tabla: el informe no obliga a buscarlo. */
  measures?: string;
  verdict: "PASS" | "FAIL" | "NO_EVALUADO";
  /** Motivo canónico cuando no se evaluó, y el que suspende cuando suspende. */
  reason?: string;
}

/** Las medidas de las que sale cada término. */
export interface BudgetInputs {
  measurements: ReadonlyArray<{
    vertices: number;
    triangles: number;
    degenerateTriangles: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    signedVolume: number;
  }>;
  coverage?: Coverage;
  confidence?: Confidence;
}

/** El número del paquete para un término, o `null` si la medida no está. */
function observar(name: BudgetName, inputs: BudgetInputs): number | null {
  const suma = (pick: (m: BudgetInputs["measurements"][number]) => number): number | null =>
    inputs.measurements.length === 0
      ? null
      : inputs.measurements.reduce((total, measurement) => total + pick(measurement), 0);

  switch (name) {
    case "triangulos":
      return suma((m) => m.triangles);
    case "vertices":
      return suma((m) => m.vertices);
    case "aristas-de-borde":
      return suma((m) => m.boundaryEdges);
    case "aristas-no-manifold":
      return suma((m) => m.nonManifoldEdges);
    case "triangulos-degenerados":
      return suma((m) => m.degenerateTriangles);
    case "volumen":
      // En valor absoluto: una malla del revés tiene volumen negativo, y eso lo
      // juzga `MALLA_INVERTIDA`, no el presupuesto. Presupuestar el firmado haría
      // que voltear una pieza la metiera en presupuesto.
      return suma((m) => Math.abs(m.signedVolume));
    case "superficie-sin-ver":
      return inputs.coverage?.unobservedAreaRatio ?? null;
    case "superficie-sin-triangular":
      return inputs.coverage?.weakAreaRatio ?? null;
    case "paralaje-corto":
      return inputs.confidence?.byClass.PARALAJE_CORTO ?? null;
  }
}

/**
 * Evalúa los presupuestos declarados contra lo medido.
 *
 * Devuelve una fila por presupuesto, siempre, y en el orden en que el paquete los
 * escribió: el productor tiene que poder cruzar su manifest con el informe línea
 * a línea sin buscar.
 */
export function evaluateBudgets(
  budgets: readonly DeclaredBudget[],
  inputs: BudgetInputs,
): BudgetResult[] {
  return budgets.map((budget) => {
    const base = { name: budget.name, max: budget.max, units: budget.units, unit: budget.unit };
    const term = (BUDGET_TERMS as Record<string, BudgetTerm>)[budget.name];

    if (term === undefined) {
      return { ...base, verdict: "NO_EVALUADO" as const, reason: "TERMINO_DESCONOCIDO" };
    }

    // Un recuento o una fracción **no son relativos a la diagonal**. Declararlo
    // así no es un término que no entendamos: es este término mal declarado, y
    // evaluarlo como si la unidad no importara daría un veredicto sobre otra cosa.
    if (budget.units === "RELATIVE_TO_DIAGONAL" && !term.carriesScale) {
      return {
        ...base,
        measures: term.measures,
        verdict: "NO_EVALUADO" as const,
        reason: "UNIDAD_DE_PRESUPUESTO_MAL_DECLARADA",
      };
    }

    const observed = observar(budget.name as BudgetName, inputs);
    if (observed === null) {
      // Sin la medida no se aprueba ni se suspende. Y **no es lo mismo que un
      // término desconocido**: aquí el término se entiende y el dato falta, que es
      // exactamente lo que deja un veredicto inconcluso en vez de intacto.
      return {
        ...base,
        measures: term.measures,
        verdict: "NO_EVALUADO" as const,
        reason: "METRICA_REQUERIDA_NO_DISPONIBLE",
      };
    }

    return {
      ...base,
      measures: term.measures,
      observed,
      verdict: observed <= budget.max ? ("PASS" as const) : ("FAIL" as const),
      ...(observed <= budget.max ? {} : { reason: "PRESUPUESTO_EXCEDIDO" }),
    };
  });
}
