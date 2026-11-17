/**
 * Encargo 05-A — las dos medidas de un reparto de piezas, sin ojos.
 *
 * Separar una malla fundida en piezas es fácil de hacer y más fácil aún de
 * hacer mal: el primer intento del día que lo probó dijo «0 de 90.004
 * apartados» y lo dijo un número, no un error. Estas dos medidas son las que
 * convierten «el reparto parece bueno» en datos, y van en el verificador y no
 * en el productor, por lo de siempre: quien mide no modela.
 *
 * ## Conservación (§2.1) — la barata, y la que nunca falla sola
 *
 * ```text
 * triángulos de las partes  +  triángulos que quedan  ==  triángulos del original
 * ningún índice aparece dos veces
 * ningún vértice se mueve
 * ```
 *
 * **No basta por sí sola** —un reparto que mande todo a una parte la cumple—,
 * pero es la que caza los errores de marco. La comprobación de vértices se hace
 * contra las posiciones que la pieza lleva consigo: un reparto que «aparta»
 * tocando la geometría se ve aquí, con la distancia que se movió.
 *
 * ## Longitud del borde del corte (§2.2) — la medida que faltaba
 *
 * Un corte genera aristas de borde nuevas: las que antes tenían dos triángulos
 * y ahora tienen uno a cada lado del reparto.
 *
 * ```text
 * corte por una costura real      pocas aristas nuevas, y en una curva cerrada
 * corte a través de una superficie muchas, y dentadas
 * ```
 *
 * Ese número es el que sustituye a mirar la captura: minimizarlo es el objetivo
 * de cualquier segmentador, y con él un agente puede probar cien combinaciones
 * de parámetros y quedarse con la mejor, sin ver ninguna. Se publica en bruto
 * —`edges` y `length`— y relativizado a la diagonal de la caja de la parte
 * —`relative`—, que es lo que permite comparar piezas de tamaños distintos.
 *
 * ## Todo sobre posiciones soldadas, y por qué
 *
 * Las aristas se calculan sobre el mapa de `weldPositions`, el mismo que usan
 * `auditMesh` y `analyzeMeshTopology`. Un cubo con los vértices partidos por
 * cara tiene 24 vértices y **parece** seis piezas sueltas, cuando está cerrado
 * y es una; casi toda malla con UVs o normales duras viene así.
 *
 * ## Lo que este módulo no hace
 *
 * No reparte, no decide si un corte es aceptable y no compara contra umbral
 * alguno: eso lo decide quien segmenta, con su presupuesto. Aquí solo hay
 * medidas, contra el reparto que se le pasa — bueno o mentiroso, el número sale
 * igual, y ahí está su valor.
 */

import type { Mesh } from "../../mesh";
import { weldPositions } from "../inspect";

/** Una pieza del reparto: los triángulos que reclama —índices del original— y
 * las posiciones que lleva consigo, que es lo que la auditoría de vértices
 * contrasta contra la malla. La copia es completa a propósito: la pieza de esta
 * medida viaja con el buffer del original; el día que las piezas se reindexen,
 * esta medida llevará también el mapa. */
export interface PartitionPart {
  triangles: number[];
  positions: Float32Array;
}

export interface TrianglePartition {
  /** Las piezas, en el orden en que se pidieron. */
  parts: PartitionPart[];
}

/** Reparte: cada lista de triángulos se convierte en una pieza con su copia de
 * posiciones. No valida nada —de eso va la auditoría—. */
export function partitionTriangles(mesh: Mesh, ...lists: number[][]): TrianglePartition {
  return {
    parts: lists.map((triangles) => ({
      triangles: [...triangles],
      positions: Float32Array.from(mesh.positions),
    })),
  };
}

export interface PartTriangleAudit {
  /** Entradas que reclamó la pieza, tal cual llegaron. */
  total: number;
  /** Repetidas dentro de la propia pieza: el índice ya estaba reclamado aquí. */
  duplicated: number;
  /** Entradas que no son índices de triángulo de la malla. */
  outOfRange: number;
  /** Lo que queda: entradas únicas y válidas. */
  accounted: number;
}

export interface PartVertexAudit {
  /** Grupos soldados de vértice cuyas posiciones no cuadran con la malla. */
  moved: number;
  /** La peor distancia movida, en unidades del paquete. */
  maxDistance: number;
}

export interface PartBoundaryAudit {
  /** Aristas que la pieza abrió al repartir: su segundo triángulo quedó fuera. */
  edges: number;
  /** Longitud del contorno abierto, en unidades del paquete. */
  length: number;
  /** `length` relativizado a la diagonal de la caja de la parte: lo que permite
   * comparar piezas de tamaños distintos (§2.2). */
  relative: number;
}

export interface PartAudit {
  triangles: PartTriangleAudit;
  vertices: PartVertexAudit;
  boundary: PartBoundaryAudit;
}

export interface PartitionCoverage {
  /** Triángulos de la malla original. */
  total: number;
  /** Triángulos válidos reclamados por exactamente… alguna parte, contados una vez. */
  accounted: number;
  /** Triángulos válidos que ninguna parte reclamó. */
  unassigned: number;
  /** Triángulos válidos reclamados por dos partes o más. Repetir un índice
   * dentro de una misma parte no cuenta aquí: el triángulo sigue en una sola. */
  duplicated: number;
  /** Entradas inválidas, contadas como llegaron. */
  outOfRange: number;
}

export interface PartitionAudit {
  /** La auditoría de cada pieza, en el orden del reparto. */
  parts: PartAudit[];
  /** El recuento sobre la malla entera, que es el titular de §2.1:
   * `accounted + unassigned == total`. */
  coverage: PartitionCoverage;
}

/**
 * Audita un reparto contra la malla original. Acepta cualquiera —completo, con
 * huecos, con duplicados, con vértices movidos— y devuelve números, no veredictos.
 */
export function auditPartition(mesh: Mesh, partition: TrianglePartition): PartitionAudit {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  const { map } = weldPositions(positions);

  // Compacta los grupos soldados a [0, unique), igual que `analyzeMeshTopology`:
  // `map` apunta al primer vértice crudo de cada grupo, no a un índice compacto.
  // El -1 inicial es lo que distingue «aún sin grupo» del grupo 0, que existe
  // siempre que haya algún vértice.
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

  // Un representante crudo por grupo, para las longitudes (una vez, no por arista).
  const representativeRaw = new Int32Array(next).fill(-1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (representativeRaw[compact[vertex]] < 0) representativeRaw[compact[vertex]] = vertex;
  }

  // 1. Las reclamaciones. `owner[t]` es la primera parte que reclamó el
  // triángulo t, y `claims[t]` cuántas partes distintas lo reclamaron.
  const owner = new Int32Array(triangleCount).fill(-1);
  const claims = new Int32Array(triangleCount);
  let outOfRangeClaims = 0;
  let crossDuplicated = 0;

  const perPart = partition.parts.map((part, partIndex) => {
    const audit: PartAudit = {
      triangles: { total: part.triangles.length, duplicated: 0, outOfRange: 0, accounted: 0 },
      vertices: { moved: 0, maxDistance: 0 },
      boundary: { edges: 0, length: 0, relative: 0 },
    };
    for (const entry of part.triangles) {
      if (!Number.isInteger(entry) || entry < 0 || entry >= triangleCount) {
        audit.triangles.outOfRange += 1;
        outOfRangeClaims += 1;
        continue;
      }
      if (owner[entry] === partIndex) {
        // Repetido dentro de la propia pieza: en el recuento global no cambia
        // nada —el triángulo sigue en una sola parte—, y así se ve.
        audit.triangles.duplicated += 1;
        continue;
      }
      audit.triangles.accounted += 1;
      claims[entry] += 1;
      if (claims[entry] === 1) owner[entry] = partIndex;
      else crossDuplicated += 1;
    }
    return audit;
  });

  // 2. Vértices y caja de cada parte, sobre sus triángulos válidos únicos. El
  // recuento es por grupo soldado —lo que se mueve es la posición— y la peor
  // distancia se lleva sobre las comparaciones crudas.
  const sameLength = partition.parts.every(
    (part) => part.positions.length === positions.length,
  );
  const seenGroup: Array<Uint8Array> = [];
  const boxes: Array<[number, number, number, number, number, number]> = [];
  partition.parts.forEach((part, partIndex) => {
    seenGroup.push(new Uint8Array(next));
    boxes.push([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    const audit = perPart[partIndex];
    const claimed = new Uint8Array(triangleCount);
    for (const entry of part.triangles) {
      if (
        Number.isInteger(entry) &&
        entry >= 0 &&
        entry < triangleCount &&
        owner[entry] === partIndex &&
        !claimed[entry]
      ) {
        claimed[entry] = 1;
        for (let corner = 0; corner < 3; corner += 1) {
          const raw = indices[entry * 3 + corner];
          const group = compact[raw];
          const box = boxes[partIndex];
          for (let axis = 0; axis < 3; axis += 1) {
            const original = positions[raw * 3 + axis];
            // Un buffer que no es el del original no se puede contrastar: cada
            // vértice referenciado cuenta como movido y la peor distancia no
            // tiene sentido finito que publicar.
            const travelled = sameLength ? part.positions[raw * 3 + axis] : NaN;
            const distance = Number.isNaN(travelled)
              ? Infinity
              : Math.abs(travelled - original);
            if (!seenGroup[partIndex][group] && distance !== 0) {
              seenGroup[partIndex][group] = 1;
              audit.vertices.moved += 1;
            }
            audit.vertices.maxDistance = Math.max(audit.vertices.maxDistance, distance);
            box[axis] = Math.min(box[axis], travelled);
            box[axis + 3] = Math.max(box[axis + 3], travelled);
          }
        }
      }
    }
  });

  // 3. Las aristas del corte. Una arista soldada con exactamente dos triángulos
  // que acaban en partes distintas —o con el segundo sin reclamar— es la que
  // perdió su segundo triángulo. Las que ya eran de borde en el original no
  // cuentan: el corte no las abrió. Las no-variedad (3+ triángulos) se quedan
  // fuera: «su segundo triángulo» no está definido ahí.
  const edgeTriangles = new Map<number, [number, number]>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * next + b : b * next + a);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = compact[indices[triangle * 3]];
    const b = compact[indices[triangle * 3 + 1]];
    const c = compact[indices[triangle * 3 + 2]];
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      if (from === to) continue;
      const id = edgeKey(from, to);
      const found = edgeTriangles.get(id);
      if (found === undefined) edgeTriangles.set(id, [triangle, -1]);
      else if (found[1] < 0) found[1] = triangle;
      else found[1] = -2; // no-variedad: tres triángulos o más
    }
  }

  for (const [id, pair] of edgeTriangles) {
    const [t0, t1] = pair;
    if (t1 < 0) continue; // borde del original o arista no-variedad
    const p0 = owner[t0];
    const p1 = owner[t1];
    if (p0 === p1) continue; // sigue entera dentro de una parte
    const a = Math.floor(id / next);
    const b = id % next;
    const rawA = representativeRaw[a];
    const rawB = representativeRaw[b];
    const length = Math.hypot(
      positions[rawA * 3] - positions[rawB * 3],
      positions[rawA * 3 + 1] - positions[rawB * 3 + 1],
      positions[rawA * 3 + 2] - positions[rawB * 3 + 2],
    );
    for (const partIndex of [p0, p1]) {
      if (partIndex < 0) continue;
      const audit = perPart[partIndex];
      audit.boundary.edges += 1;
      // La suma va en el orden de descubrimiento de las aristas, que solo
      // depende de la malla y no del reparto: dos ejecuciones dan el mismo
      // número hasta el último bit.
      audit.boundary.length += length;
    }
  }

  partition.parts.forEach((_, partIndex) => {
    const audit = perPart[partIndex];
    const box = boxes[partIndex];
    const extent = Number.isFinite(box[0])
      ? Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2])
      : 0;
    audit.boundary.relative = extent > 0 ? audit.boundary.length / extent : 0;
  });

  let assigned = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (owner[triangle] >= 0) assigned += 1;
  }

  return {
    parts: perPart,
    coverage: {
      total: triangleCount,
      accounted: assigned,
      unassigned: triangleCount - assigned,
      duplicated: crossDuplicated,
      outOfRange: outOfRangeClaims,
    },
  };
}
