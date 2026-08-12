/**
 * Árbol de cajas sobre los triángulos de una malla, para consultas espaciales.
 *
 * Es lo que D25 dejó desbloqueado a propósito —primero abaratar `auditMesh`, y
 * solo entonces el árbol— y lo que hace posible todo lo que viene después:
 * distancia de superficie, visibilidad desde una cámara, oclusión, candidatos a
 * autointersección y, más adelante, cobertura. Sin él, cada una de esas
 * preguntas es un recorrido de todos los triángulos.
 *
 * **No se llama `bvh.ts`**: ese nombre ya es de `bvhLoader.ts`, que es Biovision
 * Hierarchy —captura de movimiento— y no tiene nada que ver. Dos cosas distintas
 * con el mismo nombre en el mismo directorio es como se lee el fichero
 * equivocado (D24).
 *
 * ## Por qué es determinista, y qué significa
 *
 * Misma malla y misma versión del algoritmo dan **el mismo árbol**: los mismos
 * nodos, en el mismo orden, con los triángulos en la misma posición. No es una
 * elegancia: la cobertura y la distancia de superficie se van a medir sobre este
 * recorrido, y una estructura que depende del orden de inserción o de un empate
 * resuelto al azar convierte una medida exacta en una que baila entre
 * ejecuciones. D28 pide identidad de bits para lo que cruza la frontera, y eso
 * empieza aquí.
 *
 * Las dos fuentes de indeterminismo se cierran a mano:
 *
 *   - **La partición** es por el punto medio del eje mayor, no por mediana con
 *     ordenación: una ordenación con empates depende del algoritmo del motor.
 *     Cuando el punto medio deja un lado vacío —todos los centroides juntos—, se
 *     parte por la mitad del rango, que es una regla y no un azar.
 *   - **Los empates de distancia** en las consultas se resuelven por índice de
 *     triángulo ascendente, siempre.
 *
 * ## Y por qué en arrays tipados
 *
 * Un nodo por objeto son 1,2M de objetos en una malla de 5M triángulos, que es
 * exactamente el coste que `auditMesh` acaba de quitarse de encima. Aquí son
 * cuatro arrays y ni un objeto por nodo.
 */

import type { Mesh } from "../mesh";

/** Sube si cambia el árbol que se construye. La compara quien compare recorridos. */
export const BOUNDS_TREE_VERSION = 1;

export interface TriangleBoundsTree {
  version: number;
  /** Cajas por nodo, seis números: mínimo y máximo. */
  bounds: Float32Array;
  /** Primer triángulo del nodo dentro de `order`. */
  start: Int32Array;
  /** Triángulos del nodo; cero en un nodo interno. */
  count: Int32Array;
  /**
   * Hijos de un nodo interno.
   *
   * Los dos explícitos, y no «el izquierdo es el siguiente»: con una pila, entre
   * un nodo y sus hijos se crean los de otra rama, así que el truco clásico de
   * los BVH construidos en preorden **no vale aquí**. Cuatro bytes por nodo
   * contra un invariante que se rompe en silencio y devuelve la caja de otro
   * subárbol.
   */
  left: Int32Array;
  right: Int32Array;
  /** Índices de triángulo agrupados por nodo. */
  order: Int32Array;
  nodeCount: number;
  triangleCount: number;
  mesh: Mesh;
}

/**
 * Triángulos por hoja. Ocho es el punto donde dejar de bajar: por debajo, el
 * árbol crece más de lo que ahorra —cada nivel es una caja más que probar— y por
 * encima, cada hoja obliga a mirar demasiados triángulos que la caja ya había
 * descartado.
 */
const LEAF_SIZE = 8;

export function buildTriangleBoundsTree(mesh: Mesh): TriangleBoundsTree {
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;

  // Caja y centroide por triángulo, calculados una vez: se consultan en cada
  // nivel del árbol y recalcularlos desde las posiciones es leer nueve números
  // para volver a obtener los mismos seis.
  const triangleBounds = new Float32Array(triangleCount * 6);
  const centroids = new Float32Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices[triangle * 3] * 3;
    const b = indices[triangle * 3 + 1] * 3;
    const c = indices[triangle * 3 + 2] * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const first = positions[a + axis];
      const second = positions[b + axis];
      const third = positions[c + axis];
      const low = Math.min(first, second, third);
      const high = Math.max(first, second, third);
      triangleBounds[triangle * 6 + axis] = low;
      triangleBounds[triangle * 6 + 3 + axis] = high;
      centroids[triangle * 3 + axis] = (first + second + third) / 3;
    }
  }

  const order = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) order[triangle] = triangle;

  /**
   * Los arrays crecen, y no se reservan de una vez.
   *
   * La cota bonita —`2·ceil(n/L) − 1`, que es la del árbol perfectamente
   * equilibrado— **no es una cota**: una partición puede dejar un triángulo a un
   * lado, esa hoja gasta un nodo para uno solo, y el total sube hasta `2n − 1` en
   * el peor caso. Reservar el peor caso son 400 MB en una malla de 5M, y
   * reservar el bonito desbordaba: escribir fuera de un `Int32Array` **no lanza,
   * se ignora**, así que el árbol salía con nodos a cero y las consultas
   * contestaban cosas plausibles. Se vio porque la caja de un padre no contenía a
   * la de su hijo; nada más lo habría delatado.
   */
  let capacity = Math.max(4, 2 * Math.ceil(triangleCount / LEAF_SIZE) + 1);
  let bounds = new Float32Array(capacity * 6);
  let start = new Int32Array(capacity);
  let count = new Int32Array(capacity);
  let left = new Int32Array(capacity);
  let right = new Int32Array(capacity);

  const grow = (needed: number): void => {
    if (needed <= capacity) return;
    while (capacity < needed) capacity *= 2;
    const grownBounds = new Float32Array(capacity * 6);
    grownBounds.set(bounds);
    bounds = grownBounds;
    const grownStart = new Int32Array(capacity);
    grownStart.set(start);
    start = grownStart;
    const grownCount = new Int32Array(capacity);
    grownCount.set(count);
    count = grownCount;
    const grownLeft = new Int32Array(capacity);
    grownLeft.set(left);
    left = grownLeft;
    const grownRight = new Int32Array(capacity);
    grownRight.set(right);
    right = grownRight;
  };

  let nodeCount = 0;
  const scratch = new Int32Array(triangleCount);

  /** Caja del rango, en el nodo. */
  const boundsOf = (node: number, from: number, to: number): void => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let slot = from; slot < to; slot += 1) {
      const triangle = order[slot] * 6;
      if (triangleBounds[triangle] < minX) minX = triangleBounds[triangle];
      if (triangleBounds[triangle + 1] < minY) minY = triangleBounds[triangle + 1];
      if (triangleBounds[triangle + 2] < minZ) minZ = triangleBounds[triangle + 2];
      if (triangleBounds[triangle + 3] > maxX) maxX = triangleBounds[triangle + 3];
      if (triangleBounds[triangle + 4] > maxY) maxY = triangleBounds[triangle + 4];
      if (triangleBounds[triangle + 5] > maxZ) maxZ = triangleBounds[triangle + 5];
    }
    bounds[node * 6] = minX;
    bounds[node * 6 + 1] = minY;
    bounds[node * 6 + 2] = minZ;
    bounds[node * 6 + 3] = maxX;
    bounds[node * 6 + 4] = maxY;
    bounds[node * 6 + 5] = maxZ;
  };

  // Pila explícita, no recursión: una malla de 5M triángulos puede dar un árbol
  // de decenas de niveles y la pila de llamadas de un motor no es un recurso que
  // convenga gastar en una estructura de datos.
  const stack: Array<{ node: number; from: number; to: number }> = [];
  const root = nodeCount;
  nodeCount += 1;
  boundsOf(root, 0, triangleCount);
  stack.push({ node: root, from: 0, to: triangleCount });

  while (stack.length > 0) {
    const { node, from, to } = stack.pop() as { node: number; from: number; to: number };
    const size = to - from;
    if (size <= LEAF_SIZE) {
      start[node] = from;
      count[node] = size;
      continue;
    }

    const extentX = bounds[node * 6 + 3] - bounds[node * 6];
    const extentY = bounds[node * 6 + 4] - bounds[node * 6 + 1];
    const extentZ = bounds[node * 6 + 5] - bounds[node * 6 + 2];
    const axis = extentX >= extentY && extentX >= extentZ ? 0 : extentY >= extentZ ? 1 : 2;
    const middle = (bounds[node * 6 + axis] + bounds[node * 6 + 3 + axis]) / 2;

    // Partición estable en dos pasadas: los de la izquierda en su orden, luego
    // los de la derecha en el suyo. Una partición en el sitio con dos punteros
    // sería más corta y **cambiaría el orden relativo**, que es justo lo que hace
    // que dos ejecuciones den árboles distintos.
    let split = from;
    let cursor = 0;
    for (let slot = from; slot < to; slot += 1) {
      const triangle = order[slot];
      if (centroids[triangle * 3 + axis] < middle) {
        order[split] = triangle;
        split += 1;
      } else {
        scratch[cursor] = triangle;
        cursor += 1;
      }
    }
    for (let index = 0; index < cursor; index += 1) order[split + index] = scratch[index];

    // Todos los centroides al mismo lado del punto medio: pasa con geometría
    // repetida y con teselados regulares. Partir por la mitad del rango es una
    // regla —determinista— y no un azar.
    if (split === from || split === to) split = from + (size >> 1);

    grow(nodeCount + 2);
    const leftNode = nodeCount;
    nodeCount += 1;
    const rightNode = nodeCount;
    nodeCount += 1;
    left[node] = leftNode;
    right[node] = rightNode;
    count[node] = 0;
    boundsOf(leftNode, from, split);
    boundsOf(rightNode, split, to);
    // El derecho primero: la pila lo saca después, así que el izquierdo se
    // procesa antes y el recorrido queda en el mismo orden que el de las cajas.
    stack.push({ node: rightNode, from: split, to });
    stack.push({ node: leftNode, from, to: split });
  }

  return {
    version: BOUNDS_TREE_VERSION,
    bounds: bounds.subarray(0, nodeCount * 6),
    start: start.subarray(0, nodeCount),
    count: count.subarray(0, nodeCount),
    left: left.subarray(0, nodeCount),
    right: right.subarray(0, nodeCount),
    order,
    nodeCount,
    triangleCount,
    mesh,
  };
}

export interface RayHit {
  triangle: number;
  /** Distancia a lo largo del rayo, en unidades de la dirección dada. */
  distance: number;
  point: [number, number, number];
}

/** Distancia de entrada del rayo a la caja, o `Infinity` si no la toca. */
function slab(
  tree: TriangleBoundsTree,
  node: number,
  origin: readonly number[],
  inverse: readonly number[],
  maxDistance: number,
): number {
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const low = (tree.bounds[node * 6 + axis] - origin[axis]) * inverse[axis];
    const high = (tree.bounds[node * 6 + 3 + axis] - origin[axis]) * inverse[axis];
    const entry = low < high ? low : high;
    const exit = low < high ? high : low;
    if (entry > near) near = entry;
    if (exit < far) far = exit;
    if (near > far) return Infinity;
  }
  return near;
}

/**
 * Möller–Trumbore, sin descarte por cara: una malla reconstruida no tiene un
 * bobinado en el que confiar, y descartar por reverso escondería justo los
 * triángulos que hay que auditar.
 */
function rayTriangle(
  mesh: Mesh,
  triangle: number,
  origin: readonly number[],
  direction: readonly number[],
): number {
  const { positions, indices } = mesh;
  const a = indices[triangle * 3] * 3;
  const b = indices[triangle * 3 + 1] * 3;
  const c = indices[triangle * 3 + 2] * 3;

  const e1x = positions[b] - positions[a];
  const e1y = positions[b + 1] - positions[a + 1];
  const e1z = positions[b + 2] - positions[a + 2];
  const e2x = positions[c] - positions[a];
  const e2y = positions[c + 1] - positions[a + 1];
  const e2z = positions[c + 2] - positions[a + 2];

  const px = direction[1] * e2z - direction[2] * e2y;
  const py = direction[2] * e2x - direction[0] * e2z;
  const pz = direction[0] * e2y - direction[1] * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (determinant > -1e-12 && determinant < 1e-12) return Infinity;

  const inverse = 1 / determinant;
  const tx = origin[0] - positions[a];
  const ty = origin[1] - positions[a + 1];
  const tz = origin[2] - positions[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return Infinity;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inverse;
  if (v < 0 || u + v > 1) return Infinity;

  const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return distance > 1e-9 ? distance : Infinity;
}

/**
 * El primer triángulo que corta el rayo, o `null`.
 *
 * Ante dos cortes a la misma distancia gana el triángulo de índice menor. Pasa
 * de verdad —dos caras coincidentes de una malla mal soldada— y sin regla, el
 * ganador dependería del orden en que el árbol los visitó.
 */
export function raycast(
  tree: TriangleBoundsTree,
  origin: readonly number[],
  direction: readonly number[],
  maxDistance = Infinity,
): RayHit | null {
  const inverse = [1 / direction[0], 1 / direction[1], 1 / direction[2]];
  let best = maxDistance;
  let bestTriangle = -1;

  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    if (slab(tree, node, origin, inverse, best) === Infinity) continue;

    if (tree.count[node] > 0) {
      const from = tree.start[node];
      const to = from + tree.count[node];
      for (let slot = from; slot < to; slot += 1) {
        const triangle = tree.order[slot];
        const distance = rayTriangle(tree.mesh, triangle, origin, direction);
        if (distance < best || (distance === best && triangle < bestTriangle)) {
          best = distance;
          bestTriangle = triangle;
        }
      }
      continue;
    }

    // El hijo más cercano se visita primero: así `best` baja antes y el otro se
    // descarta por la caja sin mirar un solo triángulo.
    const left = tree.left[node];
    const rightChild = tree.right[node];
    const leftDistance = slab(tree, left, origin, inverse, best);
    const rightDistance = slab(tree, rightChild, origin, inverse, best);
    if (leftDistance <= rightDistance) {
      if (rightDistance !== Infinity) stack.push(rightChild);
      if (leftDistance !== Infinity) stack.push(left);
    } else {
      if (leftDistance !== Infinity) stack.push(left);
      if (rightDistance !== Infinity) stack.push(rightChild);
    }
  }

  if (bestTriangle < 0) return null;
  return {
    triangle: bestTriangle,
    distance: best,
    point: [
      origin[0] + direction[0] * best,
      origin[1] + direction[1] * best,
      origin[2] + direction[2] * best,
    ],
  };
}

/** Distancia al cuadrado del punto a la caja de un nodo; cero si está dentro. */
function boxDistanceSquared(tree: TriangleBoundsTree, node: number, point: readonly number[]): number {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const low = tree.bounds[node * 6 + axis];
    const high = tree.bounds[node * 6 + 3 + axis];
    const value = point[axis];
    const gap = value < low ? low - value : value > high ? value - high : 0;
    total += gap * gap;
  }
  return total;
}

/** Punto más próximo dentro del triángulo, por el método de Ericson. */
function closestOnTriangle(
  mesh: Mesh,
  triangle: number,
  point: readonly number[],
): [number, number, number] {
  const { positions, indices } = mesh;
  const a = indices[triangle * 3] * 3;
  const b = indices[triangle * 3 + 1] * 3;
  const c = indices[triangle * 3 + 2] * 3;

  const ax = positions[a];
  const ay = positions[a + 1];
  const az = positions[a + 2];
  const abx = positions[b] - ax;
  const aby = positions[b + 1] - ay;
  const abz = positions[b + 2] - az;
  const acx = positions[c] - ax;
  const acy = positions[c + 1] - ay;
  const acz = positions[c + 2] - az;
  const apx = point[0] - ax;
  const apy = point[1] - ay;
  const apz = point[2] - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];

  const bpx = point[0] - positions[b];
  const bpy = point[1] - positions[b + 1];
  const bpz = point[2] - positions[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [positions[b], positions[b + 1], positions[b + 2]];

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + abx * v, ay + aby * v, az + abz * v];
  }

  const cpx = point[0] - positions[c];
  const cpy = point[1] - positions[c + 1];
  const cpz = point[2] - positions[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [positions[c], positions[c + 1], positions[c + 2]];

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + acx * w, ay + acy * w, az + acz * w];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [
      positions[b] + (positions[c] - positions[b]) * w,
      positions[b + 1] + (positions[c + 1] - positions[b + 1]) * w,
      positions[b + 2] + (positions[c + 2] - positions[b + 2]) * w,
    ];
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

export interface NearestHit {
  triangle: number;
  /** Distancia **al cuadrado**: la raíz se saca fuera si hace falta. */
  distanceSquared: number;
  point: [number, number, number];
}

/**
 * El punto de la superficie más próximo, exacto.
 *
 * La poda es por la caja del nodo: si su distancia mínima ya supera a la mejor
 * encontrada, dentro no hay nada mejor. Igual que `nearestSquared` de
 * `inspect.ts`, y por el mismo motivo: un recorrido acotado daría otro número, no
 * el mismo más rápido.
 */
export function nearestPoint(tree: TriangleBoundsTree, point: readonly number[]): NearestHit | null {
  let best = Infinity;
  let bestTriangle = -1;
  let bestPoint: [number, number, number] = [0, 0, 0];

  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    if (boxDistanceSquared(tree, node, point) >= best) continue;

    if (tree.count[node] > 0) {
      const from = tree.start[node];
      const to = from + tree.count[node];
      for (let slot = from; slot < to; slot += 1) {
        const triangle = tree.order[slot];
        const candidate = closestOnTriangle(tree.mesh, triangle, point);
        const dx = candidate[0] - point[0];
        const dy = candidate[1] - point[1];
        const dz = candidate[2] - point[2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < best || (distance === best && triangle < bestTriangle)) {
          best = distance;
          bestTriangle = triangle;
          bestPoint = candidate;
        }
      }
      continue;
    }

    const left = tree.left[node];
    const rightChild = tree.right[node];
    const leftDistance = boxDistanceSquared(tree, left, point);
    const rightDistance = boxDistanceSquared(tree, rightChild, point);
    if (leftDistance <= rightDistance) {
      if (rightDistance < best) stack.push(rightChild);
      if (leftDistance < best) stack.push(left);
    } else {
      if (leftDistance < best) stack.push(left);
      if (rightDistance < best) stack.push(rightChild);
    }
  }

  if (bestTriangle < 0) return null;
  return { triangle: bestTriangle, distanceSquared: best, point: bestPoint };
}

/**
 * Los triángulos cuya caja solapa la dada, **en orden ascendente de índice**.
 *
 * El orden es contrato: quien compare dos listas de candidatos —dos revisiones de
 * la misma pieza, dos lados de la frontera— compara listas, y dos listas con los
 * mismos elementos en otro orden se leen como un cambio.
 */
function triangleOverlaps(
  mesh: Mesh,
  triangle: number,
  min: readonly number[],
  max: readonly number[],
): boolean {
  const { positions, indices } = mesh;
  const a = indices[triangle * 3] * 3;
  const b = indices[triangle * 3 + 1] * 3;
  const c = indices[triangle * 3 + 2] * 3;
  for (let axis = 0; axis < 3; axis += 1) {
    const low = Math.min(positions[a + axis], positions[b + axis], positions[c + axis]);
    const high = Math.max(positions[a + axis], positions[b + axis], positions[c + axis]);
    if (low > max[axis] || high < min[axis]) return false;
  }
  return true;
}

export function queryAabb(
  tree: TriangleBoundsTree,
  min: readonly number[],
  max: readonly number[],
): number[] {
  const found: number[] = [];
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    if (
      tree.bounds[node * 6] > max[0] ||
      tree.bounds[node * 6 + 1] > max[1] ||
      tree.bounds[node * 6 + 2] > max[2] ||
      tree.bounds[node * 6 + 3] < min[0] ||
      tree.bounds[node * 6 + 4] < min[1] ||
      tree.bounds[node * 6 + 5] < min[2]
    ) {
      continue;
    }

    if (tree.count[node] > 0) {
      const from = tree.start[node];
      const to = from + tree.count[node];
      for (let slot = from; slot < to; slot += 1) {
        const triangle = tree.order[slot];
        // La caja de la hoja solapa, pero un triángulo suyo puede no hacerlo: sin
        // esta comprobación la lista devolvería vecinos de la hoja como si
        // tocaran, y quien la use para buscar autointersecciones los perseguiría.
        if (triangleOverlaps(tree.mesh, triangle, min, max)) found.push(triangle);
      }
      continue;
    }
    stack.push(tree.right[node]);
    stack.push(tree.left[node]);
  }
  return found.sort((a, b) => a - b);
}
