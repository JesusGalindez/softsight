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
 * Error de simetría respecto al plano X = 0: para cada vértice se busca el
 * vecino más próximo de su reflejo y se promedia la distancia, normalizada por
 * el radio de la malla.
 *
 * Es O(n²), así que se salta por encima de 4.000 vértices: por debajo tarda
 * milisegundos y por encima no merece la pena para lo que aporta. Un agente que
 * modela un objeto que debe ser simétrico —un chasis, un dron, una cara— no
 * puede verificar eso en una imagen 3/4, y en las vistas ortográficas la
 * asimetría pequeña es invisible.
 */
function symmetryErrorX(positions: Float32Array): number | null {
  const vertexCount = positions.length / 3;
  if (vertexCount === 0 || vertexCount > 4000) return null;

  let radius = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const distance = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (distance > radius) radius = distance;
  }
  if (radius === 0) return 0;

  let total = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const targetX = -positions[offset];
    const targetY = positions[offset + 1];
    const targetZ = positions[offset + 2];

    let best = Infinity;
    for (let other = 0; other < vertexCount; other += 1) {
      const candidate = other * 3;
      const dx = positions[candidate] - targetX;
      const dy = positions[candidate + 1] - targetY;
      const dz = positions[candidate + 2] - targetZ;
      const squared = dx * dx + dy * dy + dz * dz;
      if (squared < best) best = squared;
      if (best === 0) break;
    }
    total += Math.sqrt(best);
  }

  return total / vertexCount / radius;
}
