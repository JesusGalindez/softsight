/**
 * Muestreo determinista de una superficie, ponderado por área.
 *
 * Vive aparte porque lo usan **dos** medidas —el diff de R5 y la cobertura de
 * R6— y dos muestreadores serían dos conjuntos de puntos que nadie puede
 * comparar entre sí: un ratio de cobertura y una distancia de superficie medidos
 * sobre nubes distintas no se pueden cruzar, y cruzarlos es justo lo que un
 * informe invita a hacer.
 *
 * Ponderado por área y no uniforme por triángulo: sin el área, mil triángulos
 * diminutos de una esquina pesarían lo mismo que la cara entera, y la medida
 * describiría la esquina.
 */

import type { Mesh } from "../../mesh";

/**
 * El mismo generador que usa el muestreo de superficie del banco, y no uno nuevo:
 * dos PRNG en el mismo repositorio son dos conjuntos de muestras que nadie puede
 * comparar entre sí.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleSet {
  points: Float64Array;
  normals: Float64Array;
  count: number;
}

/** Normal geométrica de un triángulo, sin normalizar, y su doble área. */
export function triangleNormal(mesh: Mesh, triangle: number): [number, number, number] {
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
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/**
 * Muestreo de la superficie, ponderado por área.
 *
 * Ponderado y no uniforme por triángulo: sin el área, mil triángulos diminutos de
 * una esquina pesarían lo mismo que la cara entera, y el informe describiría la
 * esquina. Es la misma razón por la que el muestreo del banco pesa por √área.
 *
 * El recorrido para elegir triángulo es **lineal y no binario**, igual que allí y
 * por el mismo motivo: con una suma acumulada y búsqueda binaria el orden de las
 * sumas cambia, y en el borde entre dos triángulos eso elige el otro. Sería más
 * rápido y movería el número.
 */
export function sampleMesh(mesh: Mesh, count: number, seed: number): SampleSet {
  const random = mulberry32(seed);
  const triangles = mesh.indices.length / 3;
  const areas = new Float64Array(triangles);
  let total = 0;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const [nx, ny, nz] = triangleNormal(mesh, triangle);
    areas[triangle] = Math.hypot(nx, ny, nz) / 2;
    total += areas[triangle];
  }

  const points = new Float64Array(count * 3);
  const normals = new Float64Array(count * 3);
  if (total === 0) return { points, normals, count: 0 };

  const { positions, indices } = mesh;
  for (let sample = 0; sample < count; sample += 1) {
    let pick = random() * total;
    let chosen = triangles - 1;
    for (let candidate = 0; candidate < triangles; candidate += 1) {
      pick -= areas[candidate];
      if (pick <= 0) {
        chosen = candidate;
        break;
      }
    }

    // Coordenadas baricéntricas uniformes sobre el triángulo: la raíz es lo que
    // evita que las muestras se apelotonen en una esquina.
    let u = random();
    let v = random();
    const root = Math.sqrt(u);
    u = 1 - root;
    v = v * root;
    const w = 1 - u - v;

    const a = indices[chosen * 3] * 3;
    const b = indices[chosen * 3 + 1] * 3;
    const c = indices[chosen * 3 + 2] * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      points[sample * 3 + axis] =
        u * positions[a + axis] + v * positions[b + axis] + w * positions[c + axis];
    }
    const [nx, ny, nz] = triangleNormal(mesh, chosen);
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[sample * 3] = nx / length;
    normals[sample * 3 + 1] = ny / length;
    normals[sample * 3 + 2] = nz / length;
  }

  return { points, normals, count };
}

