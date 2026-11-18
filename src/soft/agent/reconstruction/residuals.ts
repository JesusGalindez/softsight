/**
 * R8 — la malla contra la evidencia de origen.
 *
 * La cobertura dice desde dónde se miró cada parte de la superficie; la confianza,
 * con qué ángulo. Ninguna de las dos contesta **si la superficie coincide con lo
 * que las fotos muestran**, que es la pregunta de R8: «mesh can be compared with
 * source evidence». Las tres comparaciones del plan (§37, §38, §39):
 *
 * ```text
 * máscaras       la silueta de la malla, vista desde cada cámara, contra la
 *                máscara de esa cámara: IoU, falsos positivos, falsos negativos
 *                y distancia entre los bordes
 * profundidad    la profundidad de la malla contra el mapa de profundidad del
 *                productor: error absoluto medio, mediano y p95, máximo, error
 *                relativo, y qué fracción no se pudo comparar
 * normales       la normal de la malla contra la del mapa de profundidad
 * ```
 *
 * ## Cómo se mira la malla: un rayo por muestra, no un render
 *
 * Cada muestra de la rejilla de la evidencia —un píxel de la máscara o del mapa—
 * lanza su rayo con `pixelRay`, la inversa exacta de `projectPoint`, y lo cruza
 * con el árbol de triángulos. Rasterizar habría dado lo mismo con un modelo de
 * cámara aproximado —el rasterizador no sabe de distorsión de OpenCV— y un
 * desplazamiento de medio píxel que nadie habría visto. Con el rayo, la muestra
 * `(c, r)` cae exactamente donde `maskAllows` la busca, y la profundidad sale del
 * propio cruce: la distancia sobre el eje óptico o, multiplicada por la norma del
 * rayo, su longitud. Las dos lecturas de `depthKind` (D20), sin trigonometría.
 *
 * ## Cuántas muestras
 *
 * Hasta `RESIDUAL_MAX_PIXELS` por cámara. Por debajo se mira cada píxel; por
 * encima, una rejilla regular con el paso que lo deja dentro, y el paso se
 * publica. La rejilla es fija, así que el número es reproducible al bit; con paso
 * mayor que uno es además una aproximación del valor a resolución completa, y eso
 * también se dice.
 *
 * ## Lo que no decide
 *
 * Ningún umbral, ningún aviso, ningún veredicto. Qué IoU es suficiente o cuántos
 * milímetros de error admite una pieza lo sabe quien la va a usar, igual que con
 * la cobertura. Aquí salen las medidas.
 *
 * ## La normal de origen sale de la profundidad
 *
 * El plan habla de la normal del MVS, y el paquete no trae mapas de normales: el
 * contrato no tiene ese tipo de artifact. Lo que sí trae es la profundidad, y de
 * ella sale la normal de la superficie que el productor midió —el producto
 * vectorial de las diferencias centrales con las muestras vecinas—. Se declara
 * así, `DERIVADA_DE_PROFUNDIDAD`, para que nadie la lea como un mapa de normales
 * entregado. En una arista de la pieza las vecinas caen en dos caras, y la normal
 * derivada queda entre las dos: eso sale en el p95 y el máximo, y es verdad.
 */

import type { Mesh } from "../../mesh";
import { buildTriangleBoundsTree, raycast, type TriangleBoundsTree } from "../boundsTree";
import { pixelRay, type PackageCamera, type PixelRay } from "./camera";
import { MASK_THRESHOLD, type MaskSet } from "./masks";

/** Muestras por cámara a partir de las cuales se pasa a una rejilla con paso. */
export const RESIDUAL_MAX_PIXELS = 65_536;

/** Un mapa de profundidad ya decodificado, con lo que el manifest declara de él. */
export interface DepthMap {
  width: number;
  height: number;
  /** Profundidad por píxel, en orden de fila. `NaN` donde la fuente no midió. */
  values: Float32Array | Float64Array;
  depthKind: "OPTICAL_AXIS" | "RAY_LENGTH";
}

/** Mapas por identidad de cámara, como las máscaras. */
export type DepthSet = ReadonlyMap<string, DepthMap>;

export interface BoundaryDistance {
  /** Media y máximo, en píxeles de la imagen, de cada punto de borde de uno al borde del otro. */
  meshToMaskMean: number;
  meshToMaskMax: number;
  maskToMeshMean: number;
  maskToMeshMax: number;
}

export interface MaskCameraResidual {
  cameraId: string;
  /** Paso de la rejilla de muestras, en píxeles de la máscara. */
  stride: number;
  samples: number;
  /** Muestras cuyo rayo no se pudo construir (distorsión que no converge). */
  unevaluated: number;
  meshPixels: number;
  maskPixels: number;
  intersection: number;
  /** Ausentes cuando su denominador es cero: no hay silueta que comparar. */
  iou?: number;
  falsePositiveRatio?: number;
  falseNegativeRatio?: number;
  boundary?: BoundaryDistance;
}

export interface DepthCameraResidual {
  cameraId: string;
  depthKind: DepthMap["depthKind"];
  stride: number;
  samples: number;
  unevaluated: number;
  /** Donde las dos tienen superficie: la fuente midió y el rayo cruzó la malla. */
  compared: number;
  /** Fracción de muestras sin medida en la fuente. */
  sourceInvalidRatio: number;
  /** De lo que la fuente midió, la fracción donde la malla no tiene superficie. */
  meshMissRatio?: number;
  /** De lo que la fuente no midió, la fracción donde la malla sí tiene superficie. */
  meshOnlyRatio?: number;
  stats?: DepthStats;
}

export interface DepthStats {
  /** Unidades del paquete. Con escala relativa, la diagonal va en el informe (D9). */
  meanAbs: number;
  medianAbs: number;
  p95Abs: number;
  maxAbs: number;
  /** Media con signo, malla menos fuente: una escala equivocada sale aquí y no en el error absoluto. */
  meanSigned: number;
  /** Mediana del error absoluto dividido por la profundidad de la fuente. */
  medianRelative: number;
}

export interface NormalStats {
  samples: number;
  medianDegrees?: number;
  p95Degrees?: number;
  maxDegrees?: number;
}

export interface Residuals {
  measurementClass: "EXTERNAL_MEASUREMENT";
  reproducibility: "BITWISE_EXACT";
  maxPixelsPerCamera: number;
  masks?: {
    cameras: number;
    iou?: number;
    falsePositiveRatio?: number;
    falseNegativeRatio?: number;
    byCamera: MaskCameraResidual[];
  };
  depth?: {
    cameras: number;
    compared: number;
    sourceInvalidRatio: number;
    meshMissRatio?: number;
    meshOnlyRatio?: number;
    stats?: DepthStats;
    /** `stats.meanAbs` dividido por la diagonal de lo medido: comparable entre piezas de tamaño distinto. */
    meanAbsRelativeToDiagonal?: number;
    byCamera: DepthCameraResidual[];
  };
  normals?: NormalStats & {
    source: "DERIVADA_DE_PROFUNDIDAD";
    byCamera: Array<NormalStats & { cameraId: string }>;
  };
}

export interface ResidualInputs {
  mesh: Mesh;
  cameras: readonly PackageCamera[];
  masks?: MaskSet;
  depth?: DepthSet;
  /** Diagonal de lo medido, para el error relativo a la pieza. */
  diagonal?: number | null;
  tree?: TriangleBoundsTree;
  maxPixels?: number;
}

/** Paso de una rejilla para no pasar de `max` muestras. */
function strideFor(columns: number, rows: number, max: number): number {
  return Math.max(1, Math.ceil(Math.sqrt((columns * rows) / max)));
}

/** Percentil por rango más próximo sobre una lista ya ordenada. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function depthStats(abs: number[], signed: number, relative: number[]): DepthStats | undefined {
  if (abs.length === 0) return undefined;
  const byValue = (a: number, b: number) => a - b;
  const sortedAbs = [...abs].sort(byValue);
  const sortedRelative = [...relative].sort(byValue);
  let sum = 0;
  for (const value of abs) sum += value;
  return {
    meanAbs: sum / abs.length,
    medianAbs: percentile(sortedAbs, 0.5),
    p95Abs: percentile(sortedAbs, 0.95),
    maxAbs: sortedAbs[sortedAbs.length - 1],
    meanSigned: signed / abs.length,
    medianRelative: percentile(sortedRelative, 0.5),
  };
}

function normalStats(angles: number[]): NormalStats {
  if (angles.length === 0) return { samples: 0 };
  const sorted = [...angles].sort((a, b) => a - b);
  return {
    samples: angles.length,
    medianDegrees: percentile(sorted, 0.5),
    p95Degrees: percentile(sorted, 0.95),
    maxDegrees: sorted[sorted.length - 1],
  };
}

/** Normal geométrica de un triángulo de la malla, unitaria. */
function triangleNormal(mesh: Mesh, triangle: number): [number, number, number] {
  const [a, b, c] = [0, 1, 2].map((corner) => mesh.indices[triangle * 3 + corner] * 3);
  const p = mesh.positions;
  const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
  const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
  const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Lo que una muestra ve: su rayo y, si cruza la malla, dónde. */
interface Sample {
  ray: PixelRay | null;
  /** Distancia sobre el eje óptico, o `undefined` si el rayo no cruza la malla. */
  t?: number;
  triangle?: number;
}

/**
 * Lanza un rayo por cada muestra de una rejilla de `columns × rows` sobre la
 * imagen de la cámara. La muestra `(c, r)` es el centro de la celda, en las
 * coordenadas de `projectPoint`: exactamente donde `maskAllows` la busca.
 */
function castGrid(
  camera: PackageCamera,
  tree: TriangleBoundsTree,
  columns: number,
  rows: number,
  stride: number,
): { samples: Sample[][]; gridColumns: number; gridRows: number } {
  const samples: Sample[][] = [];
  for (let row = 0; row < rows; row += stride) {
    const line: Sample[] = [];
    for (let column = 0; column < columns; column += stride) {
      const x = ((column + 0.5) * camera.width) / columns;
      const y = ((row + 0.5) * camera.height) / rows;
      const ray = pixelRay(camera, x, y);
      if (ray === null) {
        line.push({ ray: null });
        continue;
      }
      const hit = raycast(tree, ray.origin, ray.direction);
      line.push(hit === null || hit.distance <= 0 ? { ray } : { ray, t: hit.distance, triangle: hit.triangle });
    }
    samples.push(line);
  }
  return { samples, gridColumns: samples[0]?.length ?? 0, gridRows: samples.length };
}

/** Puntos de borde de una silueta en la rejilla: dentro, con algún vecino fuera o en el canto. */
function boundaryOf(inside: boolean[][]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let row = 0; row < inside.length; row += 1) {
    for (let column = 0; column < inside[row].length; column += 1) {
      if (!inside[row][column]) continue;
      const neighbour = (r: number, c: number) => inside[r]?.[c] === true;
      if (!neighbour(row - 1, column) || !neighbour(row + 1, column) || !neighbour(row, column - 1) || !neighbour(row, column + 1)) {
        points.push([column, row]);
      }
    }
  }
  return points;
}

/** Media y máximo de la distancia de cada punto de `from` al más cercano de `to`, en píxeles de imagen. */
function boundaryDistance(
  from: Array<[number, number]>,
  to: Array<[number, number]>,
  pixelX: number,
  pixelY: number,
): [number, number] {
  let sum = 0;
  let max = 0;
  for (const [ca, ra] of from) {
    let best = Infinity;
    for (const [cb, rb] of to) {
      const d = Math.hypot((ca - cb) * pixelX, (ra - rb) * pixelY);
      if (d < best) best = d;
    }
    sum += best;
    if (best > max) max = best;
  }
  return [sum / from.length, max];
}

export function computeResiduals(inputs: ResidualInputs): Residuals | undefined {
  const { mesh, cameras, masks, depth } = inputs;
  if ((masks === undefined || masks.size === 0) && (depth === undefined || depth.size === 0)) return undefined;
  const max = inputs.maxPixels ?? RESIDUAL_MAX_PIXELS;
  const tree = inputs.tree ?? buildTriangleBoundsTree(mesh);
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const residuals: Residuals = {
    measurementClass: "EXTERNAL_MEASUREMENT",
    reproducibility: "BITWISE_EXACT",
    maxPixelsPerCamera: max,
  };

  // Máscaras: silueta contra silueta.
  if (masks !== undefined && masks.size > 0) {
    const byCamera: MaskCameraResidual[] = [];
    let intersection = 0;
    let union = 0;
    let meshTotal = 0;
    let maskTotal = 0;
    for (const [cameraId, mask] of [...masks].sort(([a], [b]) => a.localeCompare(b))) {
      const camera = byId.get(cameraId);
      if (camera === undefined) continue;
      const stride = strideFor(mask.width, mask.height, max);
      const { samples } = castGrid(camera, tree, mask.width, mask.height, stride);
      const meshInside: boolean[][] = [];
      const maskInside: boolean[][] = [];
      const entry: MaskCameraResidual = {
        cameraId,
        stride,
        samples: 0,
        unevaluated: 0,
        meshPixels: 0,
        maskPixels: 0,
        intersection: 0,
      };
      samples.forEach((line, gridRow) => {
        meshInside.push([]);
        maskInside.push([]);
        line.forEach((sample, gridColumn) => {
          const inMask = mask.coverage[gridRow * stride * mask.width + gridColumn * stride] >= MASK_THRESHOLD;
          const inMesh = sample.t !== undefined;
          meshInside[gridRow].push(inMesh);
          maskInside[gridRow].push(inMask);
          if (sample.ray === null) {
            entry.unevaluated += 1;
            return;
          }
          entry.samples += 1;
          if (inMesh) entry.meshPixels += 1;
          if (inMask) entry.maskPixels += 1;
          if (inMesh && inMask) entry.intersection += 1;
        });
      });
      const cameraUnion = entry.meshPixels + entry.maskPixels - entry.intersection;
      if (cameraUnion > 0) entry.iou = entry.intersection / cameraUnion;
      if (entry.meshPixels > 0) entry.falsePositiveRatio = (entry.meshPixels - entry.intersection) / entry.meshPixels;
      if (entry.maskPixels > 0) entry.falseNegativeRatio = (entry.maskPixels - entry.intersection) / entry.maskPixels;
      const meshEdge = boundaryOf(meshInside);
      const maskEdge = boundaryOf(maskInside);
      if (meshEdge.length > 0 && maskEdge.length > 0) {
        // Un paso de la rejilla, en píxeles de la imagen de la cámara.
        const pixelX = (stride * camera.width) / mask.width;
        const pixelY = (stride * camera.height) / mask.height;
        const [meshToMaskMean, meshToMaskMax] = boundaryDistance(meshEdge, maskEdge, pixelX, pixelY);
        const [maskToMeshMean, maskToMeshMax] = boundaryDistance(maskEdge, meshEdge, pixelX, pixelY);
        entry.boundary = { meshToMaskMean, meshToMaskMax, maskToMeshMean, maskToMeshMax };
      }
      intersection += entry.intersection;
      union += cameraUnion;
      meshTotal += entry.meshPixels;
      maskTotal += entry.maskPixels;
      byCamera.push(entry);
    }
    residuals.masks = {
      cameras: byCamera.length,
      ...(union > 0 ? { iou: intersection / union } : {}),
      ...(meshTotal > 0 ? { falsePositiveRatio: (meshTotal - intersection) / meshTotal } : {}),
      ...(maskTotal > 0 ? { falseNegativeRatio: (maskTotal - intersection) / maskTotal } : {}),
      byCamera,
    };
  }

  // Profundidad, y de ella las normales.
  if (depth !== undefined && depth.size > 0) {
    const byCamera: DepthCameraResidual[] = [];
    const normalsByCamera: Array<NormalStats & { cameraId: string }> = [];
    const allAbs: number[] = [];
    const allRelative: number[] = [];
    const allAngles: number[] = [];
    let allSigned = 0;
    let samplesTotal = 0;
    let invalidTotal = 0;
    let sourceValidTotal = 0;
    let missTotal = 0;
    let onlyTotal = 0;
    for (const [cameraId, map] of [...depth].sort(([a], [b]) => a.localeCompare(b))) {
      const camera = byId.get(cameraId);
      if (camera === undefined) continue;
      const stride = strideFor(map.width, map.height, max);
      const { samples } = castGrid(camera, tree, map.width, map.height, stride);
      const abs: number[] = [];
      const relative: number[] = [];
      const angles: number[] = [];
      let signed = 0;
      let counted = 0;
      let unevaluated = 0;
      let invalid = 0;
      let sourceValid = 0;
      let miss = 0;
      let only = 0;

      // La profundidad de la fuente en una muestra, como distancia sobre el rayo.
      const sourceAt = (gridRow: number, gridColumn: number): number | undefined => {
        const value = map.values[gridRow * stride * map.width + gridColumn * stride];
        return Number.isFinite(value) && value > 0 ? value : undefined;
      };
      const pointAt = (gridRow: number, gridColumn: number): [number, number, number] | undefined => {
        const sample = samples[gridRow]?.[gridColumn];
        const value = sample === undefined ? undefined : sourceAt(gridRow, gridColumn);
        if (sample?.ray == null || value === undefined) return undefined;
        const t = map.depthKind === "OPTICAL_AXIS" ? value : value / sample.ray.length;
        const { origin, direction } = sample.ray;
        return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
      };

      samples.forEach((line, gridRow) => {
        line.forEach((sample, gridColumn) => {
          if (sample.ray === null) {
            unevaluated += 1;
            return;
          }
          counted += 1;
          const source = sourceAt(gridRow, gridColumn);
          const hit = sample.t !== undefined;
          if (source === undefined) {
            invalid += 1;
            if (hit) only += 1;
            return;
          }
          sourceValid += 1;
          if (!hit) {
            miss += 1;
            return;
          }
          const meshDepth = map.depthKind === "OPTICAL_AXIS" ? sample.t! : sample.t! * sample.ray.length;
          const error = meshDepth - source;
          abs.push(Math.abs(error));
          relative.push(Math.abs(error) / source);
          signed += error;

          // La normal de la fuente, por diferencias centrales con las vecinas de la rejilla.
          const left = pointAt(gridRow, gridColumn - 1);
          const right = pointAt(gridRow, gridColumn + 1);
          const up = pointAt(gridRow - 1, gridColumn);
          const down = pointAt(gridRow + 1, gridColumn);
          if (left === undefined || right === undefined || up === undefined || down === undefined) return;
          const du = [right[0] - left[0], right[1] - left[1], right[2] - left[2]];
          const dv = [down[0] - up[0], down[1] - up[1], down[2] - up[2]];
          let ns = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
          const length = Math.hypot(ns[0], ns[1], ns[2]);
          if (length === 0) return;
          ns = ns.map((component) => component / length);
          let nm = triangleNormal(mesh, sample.triangle!);
          // Las dos mirando a la cámara: el sentido del recorrido de la rejilla y
          // el bobinado de la malla son convenciones, y el ángulo no debe depender
          // de ninguna de las dos.
          const d = sample.ray.direction;
          if (ns[0] * d[0] + ns[1] * d[1] + ns[2] * d[2] > 0) ns = ns.map((component) => -component);
          if (nm[0] * d[0] + nm[1] * d[1] + nm[2] * d[2] > 0) nm = [-nm[0], -nm[1], -nm[2]];
          const dot = Math.min(1, Math.max(-1, ns[0] * nm[0] + ns[1] * nm[1] + ns[2] * nm[2]));
          angles.push((Math.acos(dot) * 180) / Math.PI);
        });
      });

      byCamera.push({
        cameraId,
        depthKind: map.depthKind,
        stride,
        samples: counted,
        unevaluated,
        compared: abs.length,
        sourceInvalidRatio: counted > 0 ? invalid / counted : 0,
        ...(sourceValid > 0 ? { meshMissRatio: miss / sourceValid } : {}),
        ...(invalid > 0 ? { meshOnlyRatio: only / invalid } : {}),
        ...(abs.length > 0 ? { stats: depthStats(abs, signed, relative) } : {}),
      });
      normalsByCamera.push({ cameraId, ...normalStats(angles) });
      allAbs.push(...abs);
      allRelative.push(...relative);
      allAngles.push(...angles);
      allSigned += signed;
      samplesTotal += counted;
      invalidTotal += invalid;
      sourceValidTotal += sourceValid;
      missTotal += miss;
      onlyTotal += only;
    }
    const stats = depthStats(allAbs, allSigned, allRelative);
    const diagonal = inputs.diagonal ?? null;
    residuals.depth = {
      cameras: byCamera.length,
      compared: allAbs.length,
      sourceInvalidRatio: samplesTotal > 0 ? invalidTotal / samplesTotal : 0,
      ...(sourceValidTotal > 0 ? { meshMissRatio: missTotal / sourceValidTotal } : {}),
      ...(invalidTotal > 0 ? { meshOnlyRatio: onlyTotal / invalidTotal } : {}),
      ...(stats === undefined ? {} : { stats }),
      ...(stats !== undefined && diagonal !== null && diagonal > 0
        ? { meanAbsRelativeToDiagonal: stats.meanAbs / diagonal }
        : {}),
      byCamera,
    };
    residuals.normals = { source: "DERIVADA_DE_PROFUNDIDAD", ...normalStats(allAngles), byCamera: normalsByCamera };
  }

  return residuals;
}
