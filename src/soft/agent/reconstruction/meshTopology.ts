/**
 * R4 — la topología con estructura, no con un contador.
 *
 * `auditMesh` ya dice **cuántas** aristas de borde hay y cuántos triángulos.
 * Eso no basta para decidir nada:
 *
 * ```text
 * 148 aristas de borde   ¿un agujero grande, o treinta y siete pequeños?
 * 84.000 triángulos      ¿una pieza, o doce islas flotando?
 * ```
 *
 * Las dos preguntas cambian la reparación entera, y el contador no las contesta.
 * Un agujero grande se tapa con una tapa; treinta y siete pequeños son ruido de
 * reconstrucción y se cierran con otra herramienta. Una malla es una pieza; doce
 * islas es una reconstrucción que falló y que ninguna imagen desmiente, porque
 * desde fuera se ve igual.
 *
 * ## Todo sobre posiciones soldadas, y por qué
 *
 * Los componentes y los bucles se calculan sobre el mapa de `weldPositions`, el
 * mismo que usa `auditMesh`, y no sobre los índices crudos. Un cubo con los
 * vértices partidos por cara tiene 24 vértices y **parece** seis piezas sueltas
 * con 24 aristas de borde, cuando está cerrado y es una. Cualquier malla que
 * venga con UVs o normales duras cae en ese caso, o sea casi todas.
 *
 * ## Lo que este módulo no promete
 *
 * Los bucles se trazan siguiendo aristas de borde. Cuando un vértice tiene más de
 * dos, **el camino es ambiguo** —dos agujeros que se tocan en un punto— y elegir
 * uno sería inventar. Ésos se cuentan aparte, en `ambiguousVertices`, y sus
 * aristas quedan fuera de los bucles trazados en vez de repartidas a ojo.
 */

import type { Mesh } from "../../mesh";
import { weldPositions } from "../inspect";

export interface BoundaryLoop {
  /** Aristas del bucle. Un triángulo agujereado da 3. */
  edges: number;
  /** Longitud total del contorno, en unidades del modelo. */
  length: number;
  /** Diagonal de la caja del bucle: cuánto ocupa el agujero. */
  extent: number;
}

export interface MeshComponent {
  triangles: number;
  vertices: number;
  area: number;
  /** Diagonal de su caja envolvente: separa una isla de una mota. */
  extent: number;
}

export interface MeshTopology {
  /**
   * Componentes conexos por arista, del mayor al menor. Ordenados para que el
   * informe sea idéntico entre dos ejecuciones: el orden de descubrimiento
   * depende del orden de los índices, que no es un dato del modelo.
   */
  components: MeshComponent[];
  /**
   * Fracción del área que se lleva el componente mayor. Es el número que separa
   * «una pieza con motas» de «una nube de trozos»: 0,999 es lo primero y 0,3 lo
   * segundo, y el recuento de componentes no distingue los dos casos.
   */
  largestComponentAreaRatio: number;
  /** Área total de la superficie. */
  area: number;
  /** Bucles de borde trazados, del mayor al menor por número de aristas. */
  boundaryLoops: BoundaryLoop[];
  /**
   * Aristas de borde que no entraron en ningún bucle porque su camino era
   * ambiguo. Se cuentan y no se reparten: `boundaryLoops` más esto tiene que dar
   * el `boundaryEdges` de la auditoría, y una puerta lo comprueba.
   */
  unresolvedBoundaryEdges: number;
  /** Vértices con más de dos aristas de borde: dos agujeros que se tocan. */
  ambiguousVertices: number;
}

/** Área del triángulo `t`, y de paso su normal sin normalizar. */
function triangleArea(mesh: Mesh, triangle: number): number {
  const { positions, indices } = mesh;
  const a = indices[triangle * 3] * 3;
  const b = indices[triangle * 3 + 1] * 3;
  const c = indices[triangle * 3 + 2] * 3;
  const abx = positions[b] - positions[a];
  const aby = positions[b + 1] - positions[a + 1];
  const abz = positions[b + 2] - positions[a + 2];
  const acx = positions[c] - positions[a];
  const acy = positions[c + 1] - positions[a + 1];
  const acz = positions[c + 2] - positions[a + 2];
  return (
    Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) / 2
  );
}

/**
 * Conjuntos disjuntos sobre `Int32Array`, con compresión de caminos.
 *
 * En arrays tipados y no con objetos por el motivo de D25: sobre cinco millones
 * de triángulos, una estructura por vértice es lo que mata la auditoría mucho
 * antes que el trabajo.
 */
function findRoot(parent: Int32Array, start: number): number {
  let root = start;
  while (parent[root] !== root) root = parent[root];
  // Compresión en una segunda pasada: recorre lo mismo y deja el camino plano.
  let walk = start;
  while (parent[walk] !== root) {
    const next = parent[walk];
    parent[walk] = root;
    walk = next;
  }
  return root;
}

export function analyzeMeshTopology(mesh: Mesh): MeshTopology {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  const { map, unique } = weldPositions(positions);

  // 1. Componentes: unir los tres vértices soldados de cada triángulo.
  const parent = new Int32Array(unique);
  for (let vertex = 0; vertex < unique; vertex += 1) parent[vertex] = vertex;
  // `map` apunta al primer vértice **crudo** de cada grupo, no a un índice
  // compacto, así que hace falta la traducción a [0, unique).
  const compact = new Int32Array(vertexCount).fill(-1);
  let next = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const representative = map[vertex];
    if (compact[representative] < 0) {
      compact[representative] = next;
      next += 1;
    }
    compact[vertex] = compact[representative];
  }

  const union = (a: number, b: number): void => {
    const rootA = findRoot(parent, a);
    const rootB = findRoot(parent, b);
    // El menor se queda de raíz: sin un criterio fijo, dos ejecuciones con el
    // mismo modelo podrían numerar los componentes al revés.
    if (rootA === rootB) return;
    if (rootA < rootB) parent[rootB] = rootA;
    else parent[rootA] = rootB;
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = compact[indices[triangle * 3]];
    const b = compact[indices[triangle * 3 + 1]];
    const c = compact[indices[triangle * 3 + 2]];
    union(a, b);
    union(b, c);
  }

  const componentOf = new Int32Array(next).fill(-1);
  const accumulator: MeshComponent[] = [];
  const boxes: number[][] = [];
  let totalArea = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = findRoot(parent, compact[indices[triangle * 3]]);
    if (componentOf[root] < 0) {
      componentOf[root] = accumulator.length;
      accumulator.push({ triangles: 0, vertices: 0, area: 0, extent: 0 });
      boxes.push([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    }
    const index = componentOf[root];
    const area = triangleArea(mesh, triangle);
    accumulator[index].triangles += 1;
    accumulator[index].area += area;
    totalArea += area;
    const box = boxes[index];
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = indices[triangle * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        box[axis] = Math.min(box[axis], positions[offset + axis]);
        box[axis + 3] = Math.max(box[axis + 3], positions[offset + axis]);
      }
    }
  }
  for (let vertex = 0; vertex < next; vertex += 1) {
    const index = componentOf[findRoot(parent, vertex)];
    if (index >= 0) accumulator[index].vertices += 1;
  }
  accumulator.forEach((component, index) => {
    const box = boxes[index];
    component.extent = Number.isFinite(box[0])
      ? Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2])
      : 0;
  });

  // Del mayor al menor por área, y con el recuento de triángulos de desempate:
  // dos componentes de idéntica área tienen que salir siempre en el mismo orden.
  const components = accumulator.sort(
    (a, b) => b.area - a.area || b.triangles - a.triangles || a.vertices - b.vertices,
  );

  // 2. Aristas de borde: las usadas por un solo triángulo, sobre soldado.
  const uses = new Map<number, number>();
  const key = (a: number, b: number): number => (a < b ? a * next + b : b * next + a);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = compact[indices[triangle * 3]];
    const b = compact[indices[triangle * 3 + 1]];
    const c = compact[indices[triangle * 3 + 2]];
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      if (from === to) continue;
      const id = key(from, to);
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }

  // Solo las de borde entran en la adyacencia, así que esta tabla es del tamaño
  // del contorno y no de la malla: en una reconstrucción típica son millares
  // frente a millones, y por eso aquí sí cabe un `Map`.
  const boundary: Array<[number, number]> = [];
  for (const [id, count] of uses) {
    if (count !== 1) continue;
    boundary.push([Math.floor(id / next), id % next]);
  }

  const degree = new Map<number, number[]>();
  for (let edge = 0; edge < boundary.length; edge += 1) {
    for (const vertex of boundary[edge]) {
      const list = degree.get(vertex) ?? [];
      list.push(edge);
      degree.set(vertex, list);
    }
  }
  let ambiguousVertices = 0;
  for (const list of degree.values()) if (list.length > 2) ambiguousVertices += 1;

  const visited = new Uint8Array(boundary.length);
  const loops: BoundaryLoop[] = [];
  let unresolvedBoundaryEdges = 0;

  // Un vértice crudo representante por grupo soldado, calculado **una vez**.
  // Buscarlo dentro del trazado costaría un recorrido de la malla entera por
  // arista de borde, o sea cuadrático: sobre una reconstrucción con miles de
  // aristas de contorno eso no termina.
  const representativeRaw = new Int32Array(next).fill(-1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (representativeRaw[compact[vertex]] < 0) representativeRaw[compact[vertex]] = vertex;
  }

  const lengthOf = (a: number, b: number): number => {
    const rawA = representativeRaw[a];
    const rawB = representativeRaw[b];
    return Math.hypot(
      positions[rawA * 3] - positions[rawB * 3],
      positions[rawA * 3 + 1] - positions[rawB * 3 + 1],
      positions[rawA * 3 + 2] - positions[rawB * 3 + 2],
    );
  };

  for (let seed = 0; seed < boundary.length; seed += 1) {
    if (visited[seed] === 1) continue;
    const start = boundary[seed][0];
    if ((degree.get(start)?.length ?? 0) > 2 || (degree.get(boundary[seed][1])?.length ?? 0) > 2) {
      // Ambigua: se cuenta y no se traza. Repartirla a ojo daría dos bucles
      // plausibles y ninguno comprobable.
      visited[seed] = 1;
      unresolvedBoundaryEdges += 1;
      continue;
    }
    let edges = 0;
    let length = 0;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let current = seed;
    let at = start;
    while (visited[current] === 0) {
      visited[current] = 1;
      const [from, to] = boundary[current];
      const other = at === from ? to : from;
      edges += 1;
      length += lengthOf(from, to);
      for (const vertex of [from, to]) {
        const raw = representativeRaw[vertex];
        for (let axis = 0; axis < 3; axis += 1) {
          box[axis] = Math.min(box[axis], positions[raw * 3 + axis]);
          box[axis + 3] = Math.max(box[axis + 3], positions[raw * 3 + axis]);
        }
      }
      const candidates = degree.get(other) ?? [];
      const following = candidates.find((edge) => visited[edge] === 0);
      if (following === undefined) break;
      current = following;
      at = other;
    }
    loops.push({
      edges,
      length,
      extent: Number.isFinite(box[0])
        ? Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2])
        : 0,
    });
  }

  return {
    components,
    largestComponentAreaRatio: totalArea > 0 ? (components[0]?.area ?? 0) / totalArea : 0,
    area: totalArea,
    boundaryLoops: loops.sort((a, b) => b.edges - a.edges || b.length - a.length),
    unresolvedBoundaryEdges,
    ambiguousVertices,
  };
}
