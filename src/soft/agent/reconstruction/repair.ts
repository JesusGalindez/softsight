/**
 * R10 — frontera de reparación: qué se puede arreglar sin inventar nada.
 *
 * El escalón lo dice en su puerta: **clasificar el riesgo de una corrección sin
 * convertirse en un motor de modelado**. Esto no repara. Dice, defecto a defecto,
 * qué arriesga quien lo repare — y el día que decidiera por su cuenta dónde va un
 * vértice, dejaría de poder afirmar que sus números son exactos, que es lo único
 * que aporta.
 *
 * ## El eje, y no es «difícil o fácil»
 *
 * Es **si la reparación puede contradecir la evidencia**:
 *
 * ```text
 * SAFE     no mueve ninguna superficie: soldar, borrar un triángulo de área
 *          nula, recalcular normales. La pieza medida sigue siendo la misma
 * REVIEW   mueve o crea superficie **donde alguien miró**: hay fotos que pueden
 *          confirmarla o desmentirla, así que la decisión es revisable
 * UNSAFE   crea superficie **donde nadie miró**: nada puede desmentirla. No es
 *          que salga mal, es que salga como salga nadie podrá saberlo
 * ```
 *
 * La tercera categoría es la razón de que esto viva aquí y no en una tabla fija.
 * **Un agujero no es un defecto uniforme.** Taparlo entre puntos que tres cámaras
 * vieron es interpolar entre medidas; taparlo en la trasera que nadie fotografió
 * es dibujar. Los dos se llaman «rellenar un agujero» y valen cosas distintas, y
 * distinguirlos pide cruzar el contorno con el CameraSet — que es precisamente lo
 * que esta capa sabe hacer y ninguna herramienta de malla puede.
 *
 * ## La consecuencia es mecánica, no un consejo
 *
 * Una reparación `UNSAFE` **pasa `purelyReconstructed` a false**, y con eso D21
 * deja de certificar: la cobertura se reporta y no certifica, porque la pregunta
 * «¿lo vio una cámara?» tiene respuesta trivial y falsa sobre geometría que
 * alguien inventó. Así que esto no es una etiqueta de color: dice qué pierde el
 * paquete si la reparación se hace.
 *
 * ## Lo que no se clasifica
 *
 * Lo que no se ha medido. Sin cobertura no se puede saber si un agujero cae en lo
 * observado, y entonces el veredicto es `REVISION_REQUERIDA_SIN_EVIDENCIA` en vez
 * de un `SAFE` optimista — no saber no es estar bien.
 */

import type { MeshTopology } from "./meshTopology";
import type { SurfaceVisibility } from "./coverage";

/**
 * Radio en el que se busca superficie observada alrededor de un agujero, en
 * fracción de la diagonal de la pieza.
 *
 * Dentro del agujero **no hay muestras** —no hay superficie que muestrear—, así
 * que la pregunta que se puede contestar es la del borde: ¿se vio lo que lo
 * rodea? Un vigésimo de la diagonal es el orden de un agujero que merece la pena
 * comentar, y va declarado porque mueve la frontera entre REVIEW y UNSAFE.
 *
 * **Y el radio nunca es menor que media anchura del agujero.** El centroide de un
 * contorno está a media anchura de su borde, así que un radio fijo no alcanza el
 * borde de un agujero grande y devolvería «no hay muestras cerca» sobre una cara
 * que tres cámaras miraban. Media y no entera: con la anchura completa, la
 * vecindad de un agujero en una cara del cubo cruza la pieza y recoge muestras de
 * la cara de enfrente, que no tienen nada que decir sobre este borde.
 */
export const REPAIR_NEIGHBOURHOOD_RATIO = 0.05;

/**
 * Cuántos agujeros se publican, como mucho.
 *
 * Una malla de reconstrucción puede tener miles, y una lista de miles no es un
 * informe. El orden del recorte es **riesgo, luego lo que no se pudo juzgar, y
 * solo entonces tamaño**:
 *
 * ```text
 * UNSAFE                      crea superficie que nada puede desmentir
 * sin evidencia para juzgarlo  el informe no puede hablar de este agujero
 * el resto, por aristas
 * ```
 *
 * Los dos primeros van delante porque **el tope no puede esconder ni lo peligroso
 * ni lo que no se sabe**. Un agujero de seis aristas donde nadie miró pesa más que
 * uno de trescientas entre puntos vistos, y uno que no se pudo juzgar pesa más que
 * uno que sí. Lo que queda fuera se cuenta, nunca se calla.
 */
export const MAX_REPORTED_LOOPS = 16;

export type RepairRisk = "SAFE" | "REVIEW" | "UNSAFE";

export interface RepairAssessment {
  /** Qué está mal, con el identificador con el que se avisa. */
  defect: string;
  /** Qué haría la reparación, nombrada: sin esto el riesgo no se puede juzgar. */
  repair: string;
  risk: RepairRisk;
  /** Motivo canónico del veredicto. */
  reason: string;
  /** Los números que lo sostienen, para no obligar a recalcularlos (§53). */
  evidence: Record<string, unknown>;
  /**
   * Si hacerla fuerza `purelyReconstructed` a false. Es la consecuencia
   * mecánica: con ella, D21 deja de certificar.
   */
  breaksPurelyReconstructed: boolean;
}

export interface RepairBoundary {
  measurementClass: "EXACT" | "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  /** Si se pudo cruzar con las cámaras. Sin eso, ningún agujero se clasifica. */
  evidenceAware: boolean;
  repairs: RepairAssessment[];
  /**
   * Cuántas de cada clase **en total**, incluidas las que no se publican. El
   * recuento nunca se recorta: es lo que decide si el paquete es reparable.
   */
  byRisk: { SAFE: number; REVIEW: number; UNSAFE: number };
  /** Agujeros que no entraron en la lista por el tope. Cero cuando entran todos. */
  omittedLoops: number;
}

export interface RepairInputs {
  /** La auditoría de la malla, tal y como sale al informe. */
  audit: {
    duplicatePositions: number;
    degenerateTriangles: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    inverted: boolean;
    flippedNormalRatio: number;
  };
  topology?: MeshTopology;
  /** La visibilidad de R6, la única que puede decir si un agujero se vio. */
  visibility?: SurfaceVisibility;
  /** Diagonal de la pieza: la escala en la que van los radios. */
  diagonal: number;
  /** Autointersecciones encontradas, si se buscaron. */
  selfIntersections?: number;
}

/**
 * ¿Hay superficie **observada** alrededor de este punto?
 *
 * Devuelve `null` cuando no hay ninguna muestra cerca: eso no es «no se vio», es
 * que la pregunta no se pudo hacer, y las dos cosas llevan a veredictos distintos.
 */
function observadoCerca(
  visibility: SurfaceVisibility,
  point: readonly number[],
  radius: number,
): { seen: number; total: number } | null {
  let seen = 0;
  let total = 0;
  const radioCuadrado = radius * radius;
  for (let sample = 0; sample < visibility.count; sample += 1) {
    const dx = visibility.points[sample * 3] - point[0];
    const dy = visibility.points[sample * 3 + 1] - point[1];
    const dz = visibility.points[sample * 3 + 2] - point[2];
    if (dx * dx + dy * dy + dz * dz > radioCuadrado) continue;
    total += 1;
    if (visibility.seenBy[sample].length > 0) seen += 1;
  }
  return total === 0 ? null : { seen, total };
}

export function classifyRepairs(inputs: RepairInputs): RepairBoundary {
  const repairs: RepairAssessment[] = [];
  const { audit } = inputs;

  // Las que no tocan la superficie. No son «fáciles»: es que **la pieza medida
  // sigue siendo la misma** después de hacerlas, y eso se puede afirmar sin mirar
  // una sola foto.
  if (audit.duplicatePositions > 0) {
    repairs.push({
      defect: "VERTICES_DUPLICADOS",
      repair: "soldar vértices que ya ocupan la misma posición",
      risk: "SAFE",
      reason: "NO_MUEVE_SUPERFICIE",
      evidence: { duplicatePositions: audit.duplicatePositions },
      breaksPurelyReconstructed: false,
    });
  }
  if (audit.degenerateTriangles > 0) {
    repairs.push({
      defect: "TRIANGULOS_DEGENERADOS",
      repair: "borrar triángulos de área nula",
      // Quitar área cero no quita área. La superficie que la evidencia sostiene
      // es exactamente la de antes.
      risk: "SAFE",
      reason: "NO_MUEVE_SUPERFICIE",
      evidence: { degenerateTriangles: audit.degenerateTriangles },
      breaksPurelyReconstructed: false,
    });
  }
  if (audit.inverted) {
    repairs.push({
      defect: "MALLA_INVERTIDA",
      repair: "invertir el bobinado de todos los triángulos",
      // **Todos**, que es lo que la hace segura: voltear la malla entera no mueve
      // un punto. Voltear unos cuantos para «arreglar» normales sueltas sí
      // decide qué lado es el de fuera, y eso es otra reparación.
      risk: "SAFE",
      reason: "NO_MUEVE_SUPERFICIE",
      evidence: { inverted: true, flippedNormalRatio: audit.flippedNormalRatio },
      breaksPurelyReconstructed: false,
    });
  } else if (audit.flippedNormalRatio > 0) {
    repairs.push({
      defect: "NORMALES_INCONSISTENTES",
      repair: "reorientar las caras sueltas que discrepan de sus vecinas",
      // Sin la malla del revés entera, reorientar unas cuantas **decide** cuál es
      // el lado de fuera en una región concreta, y eso puede contradecir lo que
      // las cámaras vieron desde ahí.
      risk: "REVIEW",
      reason: "DECIDE_ORIENTACION_LOCAL",
      evidence: { flippedNormalRatio: audit.flippedNormalRatio },
      breaksPurelyReconstructed: false,
    });
  }

  if (audit.nonManifoldEdges > 0) {
    repairs.push({
      defect: "ARISTAS_NO_MANIFOLD",
      repair: "separar o fundir las caras que comparten una arista de tres o más",
      // Arreglarlo obliga a elegir qué superficie se queda, y esa elección puede
      // borrar geometría que una cámara vio. Revisable, no automática.
      risk: "REVIEW",
      reason: "ELIGE_QUE_SUPERFICIE_SOBREVIVE",
      evidence: { nonManifoldEdges: audit.nonManifoldEdges },
      breaksPurelyReconstructed: false,
    });
  }

  if ((inputs.selfIntersections ?? 0) > 0) {
    repairs.push({
      defect: "AUTOINTERSECCION",
      repair: "separar las superficies que se cruzan",
      risk: "REVIEW",
      reason: "MUEVE_SUPERFICIE_MEDIDA",
      evidence: { selfIntersections: inputs.selfIntersections },
      breaksPurelyReconstructed: false,
    });
  }

  // Los agujeros, uno a uno, y **cada uno con su veredicto**. Es lo que esta
  // capa aporta: el mismo defecto vale cosas distintas según quién miró ahí.
  const radioBase = REPAIR_NEIGHBOURHOOD_RATIO * (inputs.diagonal || 1);
  const loops = inputs.topology?.boundaryLoops ?? [];
  for (const [index, loop] of loops.entries()) {
    // El borde está a media anchura del centroide, así que el radio tiene que
    // llegar hasta ahí y no más: pasarse recoge superficie del otro lado.
    const radius = Math.max(radioBase, loop.extent / 2);
    const base = {
      defect: "MALLA_ABIERTA",
      repair: `tapar el bucle de borde ${index + 1} (${loop.edges} aristas)`,
      evidence: {
        loop: index + 1,
        edges: loop.edges,
        length: loop.length,
        extent: loop.extent,
        centroid: loop.centroid,
      } as Record<string, unknown>,
    };

    if (inputs.visibility === undefined) {
      repairs.push({
        ...base,
        risk: "REVIEW",
        // **No saber no es estar bien.** Sin cámaras cruzadas, tapar un agujero
        // podría estar inventando media pieza y nada lo diría.
        reason: "REVISION_REQUERIDA_SIN_EVIDENCIA",
        breaksPurelyReconstructed: true,
      });
      continue;
    }

    const cerca = observadoCerca(inputs.visibility, loop.centroid, radius);
    if (cerca === null) {
      repairs.push({
        ...base,
        risk: "REVIEW",
        reason: "REVISION_REQUERIDA_SIN_EVIDENCIA",
        evidence: { ...base.evidence, samplesNearby: 0 },
        breaksPurelyReconstructed: true,
      });
      continue;
    }

    const observedRatio = cerca.seen / cerca.total;
    const evidence = {
      ...base.evidence,
      samplesNearby: cerca.total,
      observedNearby: cerca.seen,
      observedRatio,
      radius,
    };

    if (cerca.seen === 0) {
      // Nadie miró el borde de este agujero. Lo que se dibuje dentro **no lo
      // puede desmentir ninguna foto**, y eso no es un riesgo de que salga mal:
      // es que salga como salga, nadie podrá saberlo.
      repairs.push({
        ...base,
        risk: "UNSAFE",
        reason: "CREA_SUPERFICIE_SIN_EVIDENCIA",
        evidence,
        breaksPurelyReconstructed: true,
      });
      continue;
    }

    repairs.push({
      ...base,
      risk: "REVIEW",
      // Interpolar entre puntos medidos: puede estar mal, y **se puede
      // comprobar**, que es exactamente lo que separa REVIEW de UNSAFE.
      reason: "INTERPOLA_ENTRE_SUPERFICIE_OBSERVADA",
      evidence,
      breaksPurelyReconstructed: true,
    });
  }

  // Aristas de borde que ningún bucle recogió: se nombran igual. Callarlas
  // dejaría un `boundaryEdges` en el informe sin ninguna reparación al lado.
  const sueltas = inputs.topology?.unresolvedBoundaryEdges ?? 0;
  if (sueltas > 0) {
    repairs.push({
      defect: "BORDE_AMBIGUO",
      repair: "resolver las aristas de borde cuyo contorno no se pudo trazar",
      risk: "REVIEW",
      reason: "CONTORNO_AMBIGUO",
      evidence: { unresolvedBoundaryEdges: sueltas, ambiguousVertices: inputs.topology?.ambiguousVertices },
      breaksPurelyReconstructed: true,
    });
  }

  const byRisk = { SAFE: 0, REVIEW: 0, UNSAFE: 0 };
  for (const repair of repairs) byRisk[repair.risk] += 1;

  // El recorte, **después** de contar: el recuento describe el paquete y la lista
  // solo lo ilustra. Primero por riesgo y luego por aristas, para que un agujero
  // pequeño donde nadie miró no se caiga por detrás de uno grande entre puntos
  // vistos.
  const severidad: Record<RepairRisk, number> = { UNSAFE: 2, REVIEW: 1, SAFE: 0 };
  // Un agujero que no se pudo juzgar delante de uno que sí, dentro del mismo
  // riesgo: que el tope lo tirara dejaría el informe sin decir que no pudo hablar.
  const sinJuzgar = (repair: RepairAssessment): number =>
    repair.reason === "REVISION_REQUERIDA_SIN_EVIDENCIA" ? 1 : 0;
  const deBucle = repairs.filter((repair) => repair.defect === "MALLA_ABIERTA");
  let omittedLoops = 0;
  let publicadas = repairs;
  if (deBucle.length > MAX_REPORTED_LOOPS) {
    const ordenados = [...deBucle].sort(
      (a, b) =>
        severidad[b.risk] - severidad[a.risk] ||
        sinJuzgar(b) - sinJuzgar(a) ||
        (b.evidence.edges as number) - (a.evidence.edges as number) ||
        (a.evidence.loop as number) - (b.evidence.loop as number),
    );
    const sobreviven = new Set(ordenados.slice(0, MAX_REPORTED_LOOPS));
    omittedLoops = deBucle.length - MAX_REPORTED_LOOPS;
    publicadas = repairs.filter(
      (repair) => repair.defect !== "MALLA_ABIERTA" || sobreviven.has(repair),
    );
  }

  return {
    // La clasificación de los agujeros depende del muestreo de R6, así que el
    // conjunto entero es aproximado en cuanto hay uno. Sin agujeros, todo lo que
    // queda son recuentos exactos.
    measurementClass: loops.length > 0 && inputs.visibility !== undefined ? "APPROXIMATE" : "EXACT",
    reproducibility: "BITWISE_EXACT",
    evidenceAware: inputs.visibility !== undefined,
    repairs: publicadas,
    byRisk,
    omittedLoops,
  };
}
