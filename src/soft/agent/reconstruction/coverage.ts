/**
 * R6 — qué parte de la superficie vieron las cámaras, y con cuánta confianza.
 *
 * Es la pregunta para la que existe la capa de certificación: una malla
 * reconstruida puede estar impecable en topología y describir una trasera que
 * **nadie fotografió**. Ninguna imagen lo desmiente —la trasera se ve igual de
 * bien renderizada— y ninguna métrica de geometría lo detecta, porque la
 * geometría está bien. Lo único que lo dice es cruzar la superficie con las
 * cámaras.
 *
 * ## Las tres regiones, y por qué dos no bastan
 *
 * ```text
 * sin observar   ninguna cámara la ve          no hay evidencia
 * débil          la ve exactamente una         hay evidencia y no triangula
 * observada      la ven dos o más              hay evidencia suficiente
 * ```
 *
 * La región **débil** es la que justifica que sean tres. Un punto visto por una
 * sola cámara tiene evidencia —aparece en una foto— pero su profundidad no está
 * determinada: hacen falta dos vistas para triangular. Meterlo en «observada»
 * infla el número justo donde la reconstrucción es más frágil, y meterlo en «sin
 * observar» tira información que existe.
 *
 * ## Qué se publica, y por qué no basta el ratio
 *
 * El §86.3 (k) del plan es explícito: **un ratio sin decir cuántas muestras lo
 * sostienen no se puede juzgar cerca de un umbral**. Un 0,93 contra un umbral de
 * 0,92 es aprobado o suspenso según el error del estimador, y con muestreo ese
 * error existe siempre. Así que se publica `samples`, se dice que va ponderado
 * por área, y se acompaña del **error estándar y su intervalo**.
 *
 * Y el veredicto lo deriva `coverageVerdict`, que devuelve `INCONCLUSIVE` cuando
 * el intervalo cruza el umbral. No es prudencia: es que ahí la medida no
 * distingue, y decir PASS o FAIL sería echar una moneda.
 *
 * ## Qué puede certificar, que no es lo mismo que qué puede medir
 *
 * D21: coverage v1 publica `provenanceAware: false` y **solo certifica sobre
 * superficie puramente reconstruida**. Sobre una malla con agujeros rellenos o
 * regiones completadas a mano, el número se reporta y no certifica — porque la
 * pregunta «¿lo vio una cámara?» tiene una respuesta trivial y falsa sobre
 * geometría que alguien inventó.
 *
 * ## Lo que no hace
 *
 * No decide si la cobertura es suficiente: el umbral lo pone quien conoce la
 * pieza, igual que el presupuesto de D9. Y no mira color, textura ni nitidez —
 * «lo vio una cámara» es geometría, no fotometría.
 */

import { buildTriangleBoundsTree, raycast, type TriangleBoundsTree } from "../boundsTree";
import type { Mesh } from "../../mesh";
import { projectPoint, type PackageCamera } from "./camera";
import { sampleMesh } from "./surfaceSampling";

/**
 * Cuánto se separa del punto la muestra antes de lanzar el rayo, **relativo a la
 * magnitud de la coordenada**.
 *
 * Sin separarla, el rayo choca con el triángulo del que sale y todo queda
 * ocluido por sí mismo. El número sale de la misma medida que el epsilon de la
 * autointersección: la rejilla de `Float32` en la que viven las posiciones no
 * resuelve por debajo de 2,3e-8 de la coordenada, así que separar menos que eso
 * es no separar. Diez veces ese suelo deja margen sin despegar la muestra de la
 * superficie de forma apreciable.
 */
export const COVERAGE_RAY_OFFSET = 2.3e-7;

export interface CoverageRegions {
  /** Fracción del área que ve al menos una cámara. */
  observedAreaRatio: number;
  /** De ella, la que ven dos o más: la única que triangula. */
  triangulatedAreaRatio: number;
  /** La que ve exactamente una cámara: hay evidencia y no determina profundidad. */
  weakAreaRatio: number;
  /** La que no ve ninguna. */
  unobservedAreaRatio: number;
}

export interface Coverage extends CoverageRegions {
  /** Los dos ejes de D28: el muestreo aproxima, la semilla lo repite bit a bit. */
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  seed: number;
  /** Muestras que sostienen los ratios. Sin esto, ninguno se puede juzgar (§86.3 k). */
  samples: number;
  /** Siempre ponderado por área: se declara en vez de suponerse. */
  areaWeighted: true;
  /**
   * Error estándar del ratio observado, con el intervalo de dos sigmas. Es lo que
   * convierte «0,93» en «0,93 ± 0,004» y permite decir si un umbral queda dentro.
   */
  standardError: number;
  interval: [number, number];
  /** Cuántas muestras ve cada número de cámaras: `[0 cámaras, 1, 2, …]`. */
  bySeenBy: number[];
  /** D21: coverage v1 no sabe de provenance, y lo dice en vez de callarlo. */
  provenanceAware: false;
  /** Si el número puede certificar, o solo reportarse (D21). */
  certificationEligible: boolean;
  /** Motivo canónico cuando no puede certificar. Ausente cuando sí. */
  reason?: string;
}

export interface CoverageOptions {
  samples?: number;
  seed?: number;
  /**
   * Si la malla es puramente reconstruida (D21). **Sin valor por defecto a la
   * hora de certificar**: quien no lo sepa pasa `false`, que es lo que la
   * decisión manda cuando no se puede demostrar `true`.
   */
  purelyReconstructed?: boolean;
  /** Árbol ya construido, para no rehacerlo cuando quien llama ya lo tiene. */
  tree?: TriangleBoundsTree;
}

/**
 * ¿Ve esta cámara este punto de superficie?
 *
 * Tres condiciones, y las tres hacen falta:
 *
 * 1. **Cae dentro de la imagen y delante.** Lo decide `projectPoint`, que ya
 *    conoce las convenciones de píxel y de ejes (D10).
 * 2. **La superficie mira hacia la cámara.** Un punto del otro lado de la pieza
 *    proyecta dentro de la imagen igual que uno de este lado; sin esta condición,
 *    una esfera saldría observada al 100 % desde una sola cámara.
 * 3. **Nada se interpone.** Un rayo desde el punto hasta la cámara que choque
 *    antes de llegar dice que hay superficie en medio.
 */
function seesPoint(
  camera: PackageCamera,
  tree: TriangleBoundsTree,
  point: readonly number[],
  normal: readonly number[],
  offset: number,
): boolean {
  const projected = projectPoint(camera, point);
  if (projected.depth <= 0) return false;
  if (projected.x < 0 || projected.y < 0 || projected.x >= camera.width || projected.y >= camera.height) {
    return false;
  }

  // Posición de la cámara en el mundo: la traslación de `worldFromCamera`, que va
  // en 3, 7 y 11 porque la matriz es por filas (D32).
  const eye = [camera.worldFromCamera[3], camera.worldFromCamera[7], camera.worldFromCamera[11]];
  const toEye = [eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]];
  const distance = Math.hypot(toEye[0], toEye[1], toEye[2]);
  if (distance === 0) return false;
  const direction = [toEye[0] / distance, toEye[1] / distance, toEye[2] / distance];

  // La cara tiene que mirar hacia la cámara. Sin signo: una malla con el bobinado
  // invertido daría todo de espaldas, y eso lo juzga `MALLA_INVERTIDA`, no esto.
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  if (Math.abs(facing) <= 0) return false;
  if (facing < 0) return false;

  // Separar la muestra antes de lanzar: sin esto el rayo choca con su propio
  // triángulo y todo queda ocluido por sí mismo.
  const origin = [
    point[0] + direction[0] * offset,
    point[1] + direction[1] * offset,
    point[2] + direction[2] * offset,
  ];
  const hit = raycast(tree, origin, direction, distance - offset);
  return hit === null;
}

export function computeCoverage(
  mesh: Mesh,
  cameras: readonly PackageCamera[],
  options: CoverageOptions = {},
): Coverage {
  const samples = options.samples ?? 20_000;
  const seed = options.seed ?? 1;
  const tree = options.tree ?? buildTriangleBoundsTree(mesh);
  const set = sampleMesh(mesh, samples, seed);

  let magnitude = 0;
  for (let index = 0; index < mesh.positions.length; index += 1) {
    magnitude = Math.max(magnitude, Math.abs(mesh.positions[index]));
  }
  const offset = COVERAGE_RAY_OFFSET * (magnitude || 1);

  // Histograma por número de cámaras que ven la muestra. Se publica entero: el
  // reparto dice si la cobertura viene de muchas vistas flojas o de pocas buenas,
  // y los tres ratios solos no lo distinguen.
  const bySeenBy = new Array<number>(cameras.length + 1).fill(0);
  for (let sample = 0; sample < set.count; sample += 1) {
    const point = [set.points[sample * 3], set.points[sample * 3 + 1], set.points[sample * 3 + 2]];
    const normal = [set.normals[sample * 3], set.normals[sample * 3 + 1], set.normals[sample * 3 + 2]];
    let seen = 0;
    // En orden de cámara y no según convenga: la suma tiene que ser la misma en
    // dos ejecuciones, que es la regla del reparto (§86.3 m).
    for (const camera of cameras) {
      if (seesPoint(camera, tree, point, normal, offset)) seen += 1;
    }
    bySeenBy[seen] += 1;
  }

  // Cada ratio se cuenta del histograma y **ninguno se deriva de otro**: con
  // `observada = 1 − sin ver` las identidades dejan de ser exactas por el último
  // bit, y entonces «lo débil es todo lo observado» —que con una sola cámara es
  // cierto por construcción— sale falso por 4e-17. Son cocientes de enteros; que
  // cuadren es gratis si se calculan así.
  const total = set.count || 1;
  const unobserved = bySeenBy[0] / total;
  const weak = (bySeenBy[1] ?? 0) / total;
  const observed = (total - bySeenBy[0]) / total;
  const triangulated = (total - bySeenBy[0] - (bySeenBy[1] ?? 0)) / total;

  // Error estándar de una proporción sobre muestreo simple: √(p(1−p)/n). Va sobre
  // el ratio observado porque es el que se compara con un umbral.
  const standardError = Math.sqrt((observed * (1 - observed)) / total);

  const purely = options.purelyReconstructed === true;
  return {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    seed,
    samples: set.count,
    areaWeighted: true,
    observedAreaRatio: observed,
    triangulatedAreaRatio: triangulated,
    weakAreaRatio: weak,
    unobservedAreaRatio: unobserved,
    standardError,
    // Dos sigmas, recortado a [0, 1]: un intervalo que se sale del rango sería
    // una fracción imposible, y publicarlo invitaría a compararlo igual.
    interval: [
      Math.max(0, observed - 2 * standardError),
      Math.min(1, observed + 2 * standardError),
    ],
    bySeenBy,
    provenanceAware: false,
    certificationEligible: purely,
    ...(purely ? {} : { reason: "MALLA_NO_PURAMENTE_RECONSTRUIDA" }),
  };
}

/**
 * Veredicto contra un umbral, con el intervalo decidiendo.
 *
 * `INCONCLUSIVE` cuando el umbral cae **dentro** del intervalo: ahí la medida no
 * distingue, y devolver PASS o FAIL sería echar una moneda con la cara del
 * estimador. Es literalmente lo que pide el §86.3 (k).
 *
 * El umbral no lo pone este módulo. Lo pone quien conoce la pieza, igual que el
 * presupuesto de D9.
 */
export function coverageVerdict(
  coverage: Coverage,
  threshold: number,
): "PASS" | "FAIL" | "INCONCLUSIVE" {
  const [low, high] = coverage.interval;
  if (threshold >= low && threshold <= high) return "INCONCLUSIVE";
  return coverage.observedAreaRatio >= threshold ? "PASS" : "FAIL";
}
