/**
 * Auditoría de malla, para consumo de un agente.
 *
 * Una imagen no distingue una malla cerrada de una con agujeros, ni una normal
 * invertida de una superficie en sombra, ni un vértice duplicado de uno soldado.
 * Un agente que solo mira píxeles itera a ciegas sobre esos errores. Esto los
 * mide con números exactos y deterministas, que es la única realimentación sobre
 * la que un agente puede razonar de forma fiable.
 *
 * Todo aquí es geometría pura: sin IO, sin canvas, sin dependencias.
 */

import type { Mesh } from "../mesh";

export interface MeshAudit {
  vertices: number;
  triangles: number;
  /** Área nula en espacio de objeto: no aportan superficie y cuestan preparación. */
  degenerateTriangles: number;
  boundingBoxMin: [number, number, number];
  boundingBoxMax: [number, number, number];
  size: [number, number, number];
  /** Centro de la caja respecto al origen del objeto: dónde queda el pivote. */
  centerOffset: [number, number, number];
  boundingRadius: number;
  /**
   * Aristas usadas por un solo triángulo: el borde de una superficie abierta.
   * Cero significa malla cerrada (watertight).
   */
  boundaryEdges: number;
  /** Aristas usadas por tres o más triángulos: topología no manifold. */
  nonManifoldEdges: number;
  watertight: boolean;
  /** Vértices que comparten posición exacta con otro: geometría sin soldar. */
  duplicatePositions: number;
  /**
   * Fracción de caras cuya normal geométrica contradice a las normales de sus
   * vértices. Detecta bobinado invertido, que en pantalla se ve como un objeto
   * iluminado del revés o directamente invisible por el culling.
   */
  flippedNormalRatio: number;
  /** Error medio de simetría al espejar en X, o null si no se evaluó. */
  symmetryErrorX: number | null;
  /**
   * Volumen firmado por el teorema de la divergencia. Solo significa algo en una
   * malla cerrada, y ahí lo dice todo: negativo es una malla del revés.
   */
  signedVolume: number;
  /** Cerrada y con volumen negativo: las caras miran hacia dentro. */
  inverted: boolean;
}

function edgeKey(a: number, b: number): number {
  // Clave de arista sin orientación: el par ordenado en un solo entero. Soporta
  // hasta 2²⁶ vértices, de sobra para cualquier malla que este motor rasterice.
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  return low * 67108864 + high;
}

/**
 * Índice de posiciones soldadas. La topología hay que evaluarla sobre posiciones,
 * no sobre índices: un cubo con vértices partidos por cara tiene 24 vértices y
 * *parece* tener 24 aristas de borde cuando en realidad está cerrado. Sin este
 * paso, cualquier malla con UVs o normales duras se reporta como agujereada.
 */
function weldPositions(positions: Float32Array): { map: Int32Array; unique: number } {
  const vertexCount = positions.length / 3;
  const map = new Int32Array(vertexCount);
  const lookup = new Map<string, number>();
  let unique = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    // Cuantizar a 1e-5 antes de comparar: dos vértices que deberían coincidir
    // rara vez coinciden bit a bit tras pasar por una matriz.
    const key = `${Math.round(positions[offset] * 1e5)},${Math.round(
      positions[offset + 1] * 1e5,
    )},${Math.round(positions[offset + 2] * 1e5)}`;
    const existing = lookup.get(key);
    if (existing === undefined) {
      lookup.set(key, vertex);
      map[vertex] = vertex;
      unique += 1;
    } else {
      map[vertex] = existing;
    }
  }

  return { map, unique };
}

export function auditMesh(mesh: Mesh): MeshAudit {
  const { positions, normals, indices } = mesh;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const { map, unique } = weldPositions(positions);
  const edgeUse = new Map<number, number>();
  let degenerateTriangles = 0;
  let flippedFaces = 0;
  /**
   * Volumen firmado, seis veces, por el teorema de la divergencia: la suma de
   * `v0 · (v1 × v2)` sobre las caras. En una malla cerrada da el volumen encerrado
   * con signo, y el signo es exactamente lo que distingue una malla del revés.
   *
   * Hacía falta porque la proporción de caras descartadas por reverso —que es lo
   * que se usaba— **no lo detecta**: invertir un sólido cerrado cambia qué mitad se
   * descarta, no cuánta. Medido con un cubo y su copia invertida: las seis vistas
   * dan la misma proporción.
   */
  let volume6 = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const i0 = indices[triangle * 3];
    const i1 = indices[triangle * 3 + 1];
    const i2 = indices[triangle * 3 + 2];

    const a = i0 * 3;
    const b = i1 * 3;
    const c = i2 * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];

    const faceX = e1y * e2z - e1z * e2y;
    const faceY = e1z * e2x - e1x * e2z;
    const faceZ = e1x * e2y - e1y * e2x;
    volume6 +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
      positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
    const faceLength = Math.sqrt(faceX * faceX + faceY * faceY + faceZ * faceZ);

    if (faceLength < 1e-12) {
      // Un triángulo sin área no participa en la topología, y contarlo la
      // falsea: en los polos de una esfera UV dos de sus vértices coinciden, así
      // que aporta su única arista real dos veces y la deja con tres usos. Eso
      // reportaba 64 aristas «no manifold» en una esfera perfectamente cerrada.
      degenerateTriangles += 1;
      continue;
    }

    if (normals.length === positions.length) {
      // Normal media de los tres vértices contra la normal geométrica de la cara.
      const averageX = normals[a] + normals[b] + normals[c];
      const averageY = normals[a + 1] + normals[b + 1] + normals[c + 1];
      const averageZ = normals[a + 2] + normals[b + 2] + normals[c + 2];
      if (faceX * averageX + faceY * averageY + faceZ * averageZ < 0) flippedFaces += 1;
    }

    const w0 = map[i0];
    const w1 = map[i1];
    const w2 = map[i2];
    for (const [from, to] of [
      [w0, w1],
      [w1, w2],
      [w2, w0],
    ] as const) {
      if (from === to) continue; // arista colapsada: ya contada como degenerada
      const key = edgeKey(from, to);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const uses of edgeUse.values()) {
    if (uses === 1) boundaryEdges += 1;
    else if (uses > 2) nonManifoldEdges += 1;
  }

  return {
    vertices: vertexCount,
    triangles: triangleCount,
    degenerateTriangles,
    boundingBoxMin: [minX, minY, minZ],
    boundingBoxMax: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    centerOffset: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    boundingRadius: mesh.boundingRadius,
    boundaryEdges,
    nonManifoldEdges,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    duplicatePositions: vertexCount - unique,
    flippedNormalRatio: triangleCount > 0 ? flippedFaces / triangleCount : 0,
    symmetryErrorX: symmetryErrorX(positions),
    signedVolume: Number((volume6 / 6).toFixed(6)),
    inverted: boundaryEdges === 0 && nonManifoldEdges === 0 && volume6 < 0,
  };
}

/**
 * Rejilla uniforme de vértices, en arrays tipados y sin `Map`: el orden de
 * recorrido es contrato, y una tabla asociativa lo haría depender del orden de
 * inserción de las claves.
 */
interface PositionGrid {
  cell: number;
  minX: number;
  minY: number;
  minZ: number;
  countX: number;
  countY: number;
  countZ: number;
  /** Índice del primer elemento de cada celda; longitud celdas + 1. */
  start: Int32Array;
  /** Índices de vértice agrupados por celda. */
  items: Int32Array;
}

function buildPositionGrid(positions: Float32Array, vertexCount: number): PositionGrid {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    if (positions[offset] < minX) minX = positions[offset];
    if (positions[offset + 1] < minY) minY = positions[offset + 1];
    if (positions[offset + 2] < minZ) minZ = positions[offset + 2];
    if (positions[offset] > maxX) maxX = positions[offset];
    if (positions[offset + 1] > maxY) maxY = positions[offset + 1];
    if (positions[offset + 2] > maxZ) maxZ = positions[offset + 2];
  }

  // Una celda por vértice de media: con celdas más grandes cada consulta mira
  // demasiados candidatos, y con celdas más pequeñas el anillo crece varias
  // vueltas sin encontrar nada. El lado mayor manda para que una malla plana
  // —una tapa, un perfil extruido— no genere una rejilla degenerada.
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const divisions = Math.max(1, Math.round(Math.cbrt(vertexCount)));
  const cell = extent > 0 ? extent / divisions : 1;

  const countX = Math.floor((maxX - minX) / cell) + 1;
  const countY = Math.floor((maxY - minY) / cell) + 1;
  const countZ = Math.floor((maxZ - minZ) / cell) + 1;
  const cells = countX * countY * countZ;

  const cellOf = new Int32Array(vertexCount);
  const start = new Int32Array(cells + 1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = Math.min(countX - 1, Math.floor((positions[offset] - minX) / cell));
    const y = Math.min(countY - 1, Math.floor((positions[offset + 1] - minY) / cell));
    const z = Math.min(countZ - 1, Math.floor((positions[offset + 2] - minZ) / cell));
    const index = (z * countY + y) * countX + x;
    cellOf[vertex] = index;
    start[index + 1] += 1;
  }
  for (let index = 0; index < cells; index += 1) start[index + 1] += start[index];

  const cursor = Int32Array.from(start.subarray(0, cells));
  const items = new Int32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    items[cursor[cellOf[vertex]]] = vertex;
    cursor[cellOf[vertex]] += 1;
  }

  return { cell, minX, minY, minZ, countX, countY, countZ, start, items };
}

/**
 * Distancia al cuadrado del punto al vértice más próximo, **exacta**.
 *
 * La búsqueda crece en anillos alrededor de la celda del punto y para cuando la
 * mejor distancia encontrada ya es menor que la distancia mínima posible a lo que
 * queda sin mirar. Un anillo de tamaño fijo sería más corto de escribir y daría
 * otro número: en cuanto la malla es asimétrica de verdad, el vecino más próximo
 * del reflejo está a varias celdas —el perfil en L da 0,4236 con un radio de
 * malla de 1,6— y una búsqueda acotada lo perdería.
 */
function nearestSquared(
  grid: PositionGrid,
  positions: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  const { cell, countX, countY, countZ, start, items } = grid;
  const centerX = Math.min(countX - 1, Math.max(0, Math.floor((x - grid.minX) / cell)));
  const centerY = Math.min(countY - 1, Math.max(0, Math.floor((y - grid.minY) / cell)));
  const centerZ = Math.min(countZ - 1, Math.max(0, Math.floor((z - grid.minZ) / cell)));

  let best = Infinity;
  for (let ring = 0; ; ring += 1) {
    const lowX = centerX - ring;
    const lowY = centerY - ring;
    const lowZ = centerZ - ring;
    const highX = centerX + ring;
    const highY = centerY + ring;
    const highZ = centerZ + ring;

    for (let cz = Math.max(0, lowZ); cz <= Math.min(countZ - 1, highZ); cz += 1) {
      const edgeZ = cz === lowZ || cz === highZ;
      for (let cy = Math.max(0, lowY); cy <= Math.min(countY - 1, highY); cy += 1) {
        const edgeY = cy === lowY || cy === highY;
        for (let cx = Math.max(0, lowX); cx <= Math.min(countX - 1, highX); cx += 1) {
          // Solo la cáscara del anillo: el interior ya se miró en la vuelta anterior.
          if (!edgeZ && !edgeY && cx !== lowX && cx !== highX) continue;
          const index = (cz * countY + cy) * countX + cx;
          for (let slot = start[index]; slot < start[index + 1]; slot += 1) {
            const candidate = items[slot] * 3;
            const dx = positions[candidate] - x;
            const dy = positions[candidate + 1] - y;
            const dz = positions[candidate + 2] - z;
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared < best) best = squared;
          }
        }
      }
    }

    if (best === 0) return 0;

    // Lo que queda sin mirar está, como poco, a la distancia de la cara más
    // próxima del bloque ya recorrido. Si el bloque cubre la rejilla entera, no
    // queda nada.
    let outside = Infinity;
    if (lowX > 0) outside = Math.min(outside, x - (grid.minX + lowX * cell));
    if (lowY > 0) outside = Math.min(outside, y - (grid.minY + lowY * cell));
    if (lowZ > 0) outside = Math.min(outside, z - (grid.minZ + lowZ * cell));
    if (highX < countX - 1) outside = Math.min(outside, grid.minX + (highX + 1) * cell - x);
    if (highY < countY - 1) outside = Math.min(outside, grid.minY + (highY + 1) * cell - y);
    if (highZ < countZ - 1) outside = Math.min(outside, grid.minZ + (highZ + 1) * cell - z);
    if (outside === Infinity) return best;
    if (best <= outside * outside) return best;
  }
}

/**
 * Error de simetría respecto al plano X = 0: para cada vértice se busca el
 * vecino más próximo de su reflejo y se promedia la distancia, normalizada por
 * el radio de la malla.
 *
 * Un agente que modela un objeto que debe ser simétrico —un chasis, un dron, una
 * cara— no puede verificar eso en una imagen 3/4, y en las vistas ortográficas la
 * asimetría pequeña es invisible.
 *
 * La búsqueda era O(n²) y se rendía por encima de 4.000 vértices, lo que apagaba
 * la métrica justo en las mallas que más la necesitan: una pieza generada por
 * barrido o por *loft* pasa de ese número sin esfuerzo, y el informe devolvía
 * `null` donde el agente esperaba un cero. Con la rejilla el coste es casi lineal
 * y **el número es el mismo**, no una aproximación. El techo sigue existiendo, más
 * arriba, porque una malla de millones de vértices no es lo que esta medida sirve
 * para juzgar.
 */
function symmetryErrorX(positions: Float32Array): number | null {
  const vertexCount = positions.length / 3;
  if (vertexCount === 0 || vertexCount > 200000) return null;

  let radius = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const distance = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (distance > radius) radius = distance;
  }
  if (radius === 0) return 0;

  const grid = buildPositionGrid(positions, vertexCount);

  let total = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    total += Math.sqrt(
      nearestSquared(grid, positions, -positions[offset], positions[offset + 1], positions[offset + 2]),
    );
  }

  return total / vertexCount / radius;
}
