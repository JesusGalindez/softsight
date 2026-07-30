/**
 * Banco determinista. Cámara fija, instante de animación fijo, buffer fijo: la
 * única variable entre dos ejecuciones es el código del pipeline, que es lo que
 * hace comparables las cifras de antes y después de una optimización.
 *
 * Se expone en `window.__softBench` para poder medir desde la consola sin
 * depender del estado de la interfaz.
 */

import type { ParallelRenderer } from "./parallel";
import { CullMode } from "./raster";
import { SoftwareRenderer, type Camera, type RenderOptions } from "./renderer";
import { updateScene, type AnimatedNode } from "./scene";

export interface BenchResult {
  millisecondsPerFrame: number;
  framesPerSecond: number;
  minMilliseconds: number;
  maxMilliseconds: number;
  vertexMilliseconds: number;
  pixelsTested: number;
  pixelsShaded: number;
  pixelsInBoundingBox: number;
  /** Sombreados / recorridos: cuánto del recorrido acaba en color. */
  coverageEfficiency: number;
  /** Recorridos / bounding box: cuánto ahorra el span exacto. */
  spanEfficiency: number;
  trianglesRasterized: number;
  trianglesCulled: number;
  nodesCulled: number;
  buffer: string;
}

const benchCamera: Camera = {
  position: [6.5, 4.2, 11],
  target: [0, 1.2, -2],
  up: [0, 1, 0],
  fovYDegrees: 55,
  near: 0.1,
  far: 200,
  projection: "perspective",
  orthoHalfHeight: 6,
};

const benchOptions: RenderOptions = {
  shadingMode: "lit",
  wireframe: false,
  perspectiveCorrect: true,
  antialias: false,
  // Sombras apagadas en el banco por omisión: las medidas anteriores se hicieron sin
  // ellas y cambiar la carga base rompería la comparación. Se miden con override.
  shadows: false,
  shadowSamples: 4,
  frustumCulling: true,
  cullMode: CullMode.Back,
  light: { direction: [0.45, 0.78, 0.44], color: [1, 0.96, 0.88], intensity: 1.15 },
  ambient: [0.16, 0.19, 0.26],
  ambientGround: [0.10, 0.10, 0.11],
  fogColor: [0.06, 0.08, 0.11],
  fogDensity: 0.012,
  clearColor: [0.055, 0.07, 0.098],
};

export interface ParallelBenchResult {
  workers: number;
  /** Pared por frame, incluye el volcado a canvas: el mínimo de N frames. */
  minWallMilliseconds: number;
  meanWallMilliseconds: number;
  /** Banda más lenta del último frame: el camino crítico real del rasterizado. */
  criticalPathMilliseconds: number;
  blitMilliseconds: number;
  balance: number;
  bandRows: number[];
  buffer: string;
}

/**
 * Banco paralelo. Mide pared por frame porque el reparto entre hilos solo se ve
 * en el tiempo total: la suma de tiempos de banda no baja al paralelizar, lo que
 * baja es el máximo.
 *
 * El pool se le pasa ya construido para no pagar el arranque de los workers
 * dentro de la medida.
 */
export async function runParallelBenchmark(
  pool: ParallelRenderer,
  context: CanvasRenderingContext2D,
  frames = 24,
  width = 640,
  height = 400,
  overrides: Partial<RenderOptions> = {},
): Promise<ParallelBenchResult> {
  const options = { ...benchOptions, ...overrides };
  pool.resize(width, height);

  // Calentamiento: compila el worker, ajusta el reparto de bandas y deja al JIT
  // en régimen antes de medir.
  for (let warmup = 0; warmup < 12; warmup += 1) {
    await pool.renderFrame(1, benchCamera, options, context);
  }

  let total = 0;
  let minimum = Infinity;
  let last = await pool.renderFrame(1, benchCamera, options, context);

  for (let frame = 0; frame < frames; frame += 1) {
    const start = performance.now();
    last = await pool.renderFrame(1, benchCamera, options, context);
    const wall = performance.now() - start;
    total += wall;
    if (wall < minimum) minimum = wall;
  }

  return {
    workers: pool.workerCount,
    minWallMilliseconds: Number(minimum.toFixed(2)),
    meanWallMilliseconds: Number((total / frames).toFixed(2)),
    criticalPathMilliseconds: Number(last.criticalPathMilliseconds.toFixed(2)),
    blitMilliseconds: Number(last.blitMilliseconds.toFixed(2)),
    balance: Number(last.balance.toFixed(3)),
    bandRows: last.bandRows,
    buffer: `${width}×${height}`,
  };
}

export function runBenchmark(
  scene: readonly AnimatedNode[],
  frames = 60,
  width = 640,
  height = 400,
  overrides: Partial<RenderOptions> = {},
): BenchResult {
  const renderer = new SoftwareRenderer(width, height);
  const options = { ...benchOptions, ...overrides };

  // Instante congelado: la escena no avanza entre frames del banco.
  updateScene(scene, 1);

  for (let warmup = 0; warmup < 12; warmup += 1) {
    renderer.render(scene, benchCamera, options);
  }

  let total = 0;
  let minimum = Infinity;
  let maximum = 0;
  let vertexTotal = 0;
  let lastStats = renderer.render(scene, benchCamera, options);

  for (let frame = 0; frame < frames; frame += 1) {
    const stats = renderer.render(scene, benchCamera, options);
    total += stats.totalMilliseconds;
    vertexTotal += stats.vertexMilliseconds;
    minimum = Math.min(minimum, stats.totalMilliseconds);
    maximum = Math.max(maximum, stats.totalMilliseconds);
    lastStats = stats;
  }

  const millisecondsPerFrame = total / frames;
  return {
    millisecondsPerFrame: Number(millisecondsPerFrame.toFixed(2)),
    framesPerSecond: Number((1000 / millisecondsPerFrame).toFixed(1)),
    minMilliseconds: Number(minimum.toFixed(2)),
    maxMilliseconds: Number(maximum.toFixed(2)),
    vertexMilliseconds: Number((vertexTotal / frames).toFixed(2)),
    pixelsTested: lastStats.pixelsTested,
    pixelsShaded: lastStats.pixelsShaded,
    pixelsInBoundingBox: lastStats.pixelsInBoundingBox,
    coverageEfficiency: Number((lastStats.pixelsShaded / Math.max(1, lastStats.pixelsTested)).toFixed(3)),
    spanEfficiency: Number((lastStats.pixelsTested / Math.max(1, lastStats.pixelsInBoundingBox)).toFixed(3)),
    trianglesRasterized: lastStats.trianglesRasterized,
    trianglesCulled: lastStats.trianglesCulled,
    nodesCulled: lastStats.nodesCulled,
    buffer: `${width}×${height}`,
  };
}
