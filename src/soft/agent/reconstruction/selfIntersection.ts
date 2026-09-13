/**
 * La mitad de R4 que **no puede ser exacta**, y por eso se declara así.
 *
 * El §86.3 (n) del plan lo dice sin rodeos: `SELF_INTERSECTION_CONFIRMED` no
 * existe en coma flotante. Un test triángulo contra triángulo se decide con el
 * signo de unos productos escalares, y ese signo deja de distinguir por debajo
 * del redondeo. Así que lo que sale de aquí es **candidato con su epsilon**, la
 * misma categoría que el perfil 2D de `geometryAudit.ts`.
 *
 * ## Las tres decisiones que hacen que el número sirva
 *
 * **1. Los vecinos no cuentan.** Dos triángulos que comparten un vértice soldado
 * se tocan por construcción. Sin excluirlos, toda malla del mundo saldría
 * autointersecada y el aviso no lo miraría nadie —que es exactamente lo que le
 * pasó a `segmentsCross` cuando admitía el caso colineal—. Se excluyen sobre
 * **posiciones soldadas**, no sobre índices: un cubo con vértices partidos por
 * cara tiene vecinos que no comparten índice y sí comparten posición.
 *
 * **2. Lo coplanar no se reporta.** Es donde el signo vale exactamente cero y el
 * redondeo decide, así que un solape coplanar se dice «no lo sé» en vez de
 * inventárselo. Es la misma elección que ya tomó el perfil 2D al ser estricto, y
 * por el mismo motivo: dos caras coplanares que se solapan son un defecto real,
 * pero afirmarlo desde aquí sería afirmar más de lo que la aritmética sostiene.
 * Se cuentan aparte, en `coplanarPairs`.
 *
 * **3. El epsilon es relativo, y el suelo lo pone `Float32`.** La distancia al
 * plano se normaliza por el módulo de la normal, así que lo que se compara es una
 * distancia perpendicular de verdad y el epsilon puede ser relativo a la
 * coordenada. **Medido**: sobre puntos resueltos para caer exactamente en el
 * plano, con las posiciones en `Float32` como vienen en una malla, la distancia
 * calculada se aleja hasta **2,3e-8 de la magnitud de la coordenada**, y ese
 * número es estable entre 1 y 10⁶. No es redondeo de doble: es **la rejilla de
 * `Float32` en la que viven las posiciones**, así que ningún test sobre ellas
 * puede resolver por debajo de ahí por mucha precisión que se use después.
 *
 * ## Qué no hace
 *
 * No repara y no decide si el modelo es aceptable. Y **no promete encontrarlas
 * todas**: el barrido es exacto en la fase amplia —cajas del árbol— pero la fase
 * estrecha calla donde el redondeo manda, así que un cero de aquí significa «no
 * he encontrado ninguna por encima del epsilon», no «no hay».
 */

import { buildTriangleBoundsTree, queryAabb } from "../boundsTree";
import type { Mesh } from "../../mesh";
import { weldPositions } from "../inspect";

/**
 * Suelo relativo por debajo del cual la distancia al plano no distingue.
 *
 * Relativo a la magnitud de la coordenada, y su origen es **la rejilla de
 * `Float32`**: medido sobre puntos resueltos para caer exactamente en el plano, el
 * peor alejamiento es 2,3e-8 de la coordenada, estable entre 1 y 10⁶. El valor
 * deja algo más de cuatro veces de margen y se queda por debajo del epsilon de
 * `Float32` (1,19e-7), que es donde el dato deja de existir.
 */
export const SELF_INTERSECTION_EPSILON = 1e-7;

export interface SelfIntersectionPair {
  /** Índices de los dos triángulos, siempre el menor primero. */
  triangles: [number, number];
}

export interface SelfIntersectionReport {
  /** Los dos ejes de D28: el resultado es aproximado y se repite bit a bit. */
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  /**
   * Epsilon **ya en unidades de esta malla** y como distancia perpendicular, para
   * poder compararlo con el tamaño de la pieza sin hacer cuentas.
   */
  epsilon: number;
  /** Pares que cruzan por encima del epsilon. Candidatos, nunca certezas. */
  candidates: SelfIntersectionPair[];
  /**
   * Pares coplanares que se solapan. Se cuentan y **no se afirman**: ahí el signo
   * vale cero y quien decide es el redondeo.
   */
  coplanarPairs: number;
  /** Pares que llegaron a la fase estrecha, para saber qué costó el número. */
  testedPairs: number;
}

function subtract(out: number[], a: readonly number[], b: readonly number[]): number[] {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

function cross(out: number[], a: readonly number[], b: readonly number[]): number[] {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
  return out;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Los tres vértices de un triángulo, en doble. */
function corners(mesh: Mesh, triangle: number): number[][] {
  const { positions, indices } = mesh;
  return [0, 1, 2].map((corner) => {
    const offset = indices[triangle * 3 + corner] * 3;
    return [positions[offset], positions[offset + 1], positions[offset + 2]];
  });
}

/**
 * Intervalo que el triángulo `v` ocupa sobre la recta de intersección de los dos
 * planos, proyectado sobre el eje donde esa recta es más larga.
 *
 * Se calcula **por aristas y no por «cuál vértice queda solo»**, que es la forma
 * en la que esto se escribe mal. Con los signos `(0, +, +)` —un vértice justo en
 * el plano y los otros dos del mismo lado— no hay ningún vértice solo, y la
 * versión con caso especial acaba dividiendo por cero: fue lo que hizo que un
 * cubo cerrado saliera con cuatro autointersecciones, pares de caras que solo se
 * tocan en una esquina.
 *
 * Recorriendo aristas no hay caso especial: un vértice con distancia cero aporta
 * su propia proyección, y una arista cuyos extremos quedan a distinto lado aporta
 * su corte. Con `(0, +, +)` sale un intervalo degenerado en ese punto, que es
 * exactamente lo que el triángulo ocupa sobre la recta.
 */
function interval(
  v: number[][],
  distances: number[],
  axis: number,
): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;

  for (let index = 0; index < 3; index += 1) {
    const other = (index + 1) % 3;
    if (distances[index] === 0) {
      low = Math.min(low, v[index][axis]);
      high = Math.max(high, v[index][axis]);
    }
    if (distances[index] * distances[other] < 0) {
      const t = distances[index] / (distances[index] - distances[other]);
      const cut = v[index][axis] + (v[other][axis] - v[index][axis]) * t;
      low = Math.min(low, cut);
      high = Math.max(high, cut);
    }
  }

  return low <= high ? [low, high] : null;
}

/**
 * ¿Se cruzan estos dos triángulos?
 *
 * Es el test de Möller: dos triángulos que se cortan lo hacen sobre la recta de
 * intersección de sus planos, así que basta con que los intervalos que cada uno
 * ocupa sobre esa recta se solapen. `epsilon` es la distancia al plano por debajo
 * de la cual se considera que el vértice **está** en él.
 */
function trianglesCross(
  a: number[][],
  b: number[][],
  epsilon: number,
): "cross" | "apart" | "coplanar" {
  const scratch = [0, 0, 0];
  const edge1 = subtract([0, 0, 0], b[1], b[0]);
  const edge2 = subtract([0, 0, 0], b[2], b[0]);
  const normalB = cross([0, 0, 0], edge1, edge2);
  const offsetB = -dot(normalB, b[0]);

  // Normalizada por el módulo de la normal: así lo que se compara con el epsilon
  // es una distancia perpendicular de verdad y no un número que crece con el
  // cuadrado de la escena. Los cocientes del intervalo no se enteran, porque el
  // factor se cancela.
  const lengthB = Math.hypot(normalB[0], normalB[1], normalB[2]) || 1;
  const distancesA = a.map((vertex) => {
    const value = (dot(normalB, vertex) + offsetB) / lengthB;
    return Math.abs(value) < epsilon ? 0 : value;
  });
  if (distancesA[0] !== 0 && distancesA[0] === distancesA[1] && distancesA[1] === distancesA[2]) {
    return "apart";
  }
  if (distancesA.every((value) => value > 0) || distancesA.every((value) => value < 0)) return "apart";

  const edge3 = subtract([0, 0, 0], a[1], a[0]);
  const edge4 = subtract([0, 0, 0], a[2], a[0]);
  const normalA = cross([0, 0, 0], edge3, edge4);
  const offsetA = -dot(normalA, a[0]);

  const lengthA = Math.hypot(normalA[0], normalA[1], normalA[2]) || 1;
  const distancesB = b.map((vertex) => {
    const value = (dot(normalA, vertex) + offsetA) / lengthA;
    return Math.abs(value) < epsilon ? 0 : value;
  });
  if (distancesB.every((value) => value > 0) || distancesB.every((value) => value < 0)) return "apart";

  if (distancesA.every((value) => value === 0)) return "coplanar";

  // Eje donde la recta de intersección es más larga: proyectar sobre el más corto
  // aplastaría el intervalo y lo decidiría el redondeo.
  const direction = cross(scratch, normalA, normalB);
  let axis = 0;
  for (let index = 1; index < 3; index += 1) {
    if (Math.abs(direction[index]) > Math.abs(direction[axis])) axis = index;
  }

  const intervalA = interval(a, distancesA, axis);
  const intervalB = interval(b, distancesB, axis);
  if (intervalA === null || intervalB === null) return "apart";
  return intervalA[0] <= intervalB[1] && intervalB[0] <= intervalA[1] ? "cross" : "apart";
}

export interface SelfIntersectionOptions {
  /** Tope de pares a devolver. El recuento sigue siendo el real. */
  limit?: number;
}

export function findSelfIntersections(
  mesh: Mesh,
  options: SelfIntersectionOptions = {},
): SelfIntersectionReport {
  const limit = options.limit ?? 32;
  const triangleCount = mesh.indices.length / 3;
  const { positions, indices } = mesh;

  // El epsilon va en unidades de la malla: la distancia ya viene normalizada, así
  // que basta con escalar por la magnitud de la coordenada, que es donde vive el
  // error de `Float32`.
  let magnitude = 0;
  for (let index = 0; index < positions.length; index += 1) {
    magnitude = Math.max(magnitude, Math.abs(positions[index]));
  }
  const epsilon = SELF_INTERSECTION_EPSILON * (magnitude || 1);

  const { map } = weldPositions(positions);
  const tree = buildTriangleBoundsTree(mesh);
  const candidates: SelfIntersectionPair[] = [];
  let coplanarPairs = 0;
  let testedPairs = 0;

  const min = [0, 0, 0];
  const max = [0, 0, 0];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Infinity;
      max[axis] = -Infinity;
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = indices[triangle * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[offset + axis]);
        max[axis] = Math.max(max[axis], positions[offset + axis]);
      }
    }

    const a = corners(mesh, triangle);
    const weldedA = [0, 1, 2].map((corner) => map[indices[triangle * 3 + corner]]);

    for (const other of queryAabb(tree, min, max)) {
      // Solo hacia delante: el par (i, j) se mira una vez, no dos.
      if (other <= triangle) continue;
      const weldedB = [0, 1, 2].map((corner) => map[indices[other * 3 + corner]]);
      // Vecinos fuera. Sobre soldado y no sobre índices: un cubo con los vértices
      // partidos por cara tiene vecinos que no comparten índice y sí posición, y
      // sin esto saldrían todos como cruces.
      if (weldedA.some((vertex) => weldedB.includes(vertex))) continue;

      testedPairs += 1;
      const verdict = trianglesCross(a, corners(mesh, other), epsilon);
      if (verdict === "coplanar") coplanarPairs += 1;
      else if (verdict === "cross" && candidates.length < limit) {
        candidates.push({ triangles: [triangle, other] });
      } else if (verdict === "cross") {
        // Por encima del tope se sigue contando en `testedPairs`, pero el par no
        // se guarda: un informe con cien mil pares no lo lee nadie.
      }
    }
  }

  return {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    epsilon,
    candidates,
    coplanarPairs,
    testedPairs,
  };
}
