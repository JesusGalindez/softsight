/**
 * Rasterizado paralelo por bandas horizontales.
 *
 * Las bandas particionan el espacio de pantalla, así que dos hilos nunca
 * escriben el mismo píxel ni necesitan ver el z-buffer del otro: es paralelismo
 * sin comunicación, sin bloqueos y sin memoria compartida. Ni siquiera hace
 * falta `SharedArrayBuffer` (que exigiría cabeceras COOP/COEP en el servidor):
 * los píxeles vuelven como `ArrayBuffer` **transferido**, que es un cambio de
 * propietario sin copia.
 *
 * REPARTO ADAPTATIVO. Bandas de igual altura reparten mal: el suelo ocupa la
 * mitad inferior de la imagen y esa banda cuesta el doble. El frame dura lo que
 * dura la banda más lenta, así que un reparto desigual desperdicia justo lo que
 * se acaba de ganar paralelizando.
 *
 * Con `t_i` el tiempo medido de la banda i y `h_i` sus filas, el coste por fila
 * es `c_i = t_i / h_i`. Igualar tiempos exige repartir filas en proporción
 * inversa al coste:
 *
 *   h_i' = H · (1/c_i) / Σ(1/c_j)
 *
 * y se aplica amortiguado, `h_i ← h_i + λ(h_i' - h_i)` con λ = 0.35, porque la
 * medida trae ruido y el reparto sin amortiguar oscila entre extremos.
 */

import type { Camera, FrameStats, RenderOptions } from "./renderer";
import type { WorkerJob, WorkerResult } from "./renderWorker";

const DAMPING = 0.35;
const MINIMUM_BAND_ROWS = 8;

export interface ParallelFrameStats {
  /** Duración del frame: la banda más lenta, no la suma. */
  criticalPathMilliseconds: number;
  totalWorkerMilliseconds: number;
  blitMilliseconds: number;
  /** 1 = reparto perfecto; 0.5 = la banda lenta tarda el doble de la media. */
  balance: number;
  bandRows: number[];
  bandMilliseconds: number[];
  stats: FrameStats;
}

function emptyStats(): FrameStats {
  return {
    trianglesSubmitted: 0,
    trianglesClipped: 0,
    trianglesRejected: 0,
    trianglesRasterized: 0,
    trianglesCulled: 0,
    nodesDrawn: 0,
    nodesCulled: 0,
    smoothedPixels: 0,
    pixelsShaded: 0,
    pixelsTested: 0,
    pixelsInBoundingBox: 0,
    vertexMilliseconds: 0,
    shadowMilliseconds: 0,
    postprocessMilliseconds: 0,
    totalMilliseconds: 0,
  };
}

function accumulate(target: FrameStats, source: FrameStats): void {
  target.trianglesSubmitted += source.trianglesSubmitted;
  target.trianglesClipped += source.trianglesClipped;
  target.trianglesRejected += source.trianglesRejected;
  target.trianglesRasterized += source.trianglesRasterized;
  target.trianglesCulled += source.trianglesCulled;
  target.nodesDrawn = Math.max(target.nodesDrawn, source.nodesDrawn);
  target.nodesCulled = Math.max(target.nodesCulled, source.nodesCulled);
  target.smoothedPixels += source.smoothedPixels;
  target.pixelsShaded += source.pixelsShaded;
  target.pixelsTested += source.pixelsTested;
  target.pixelsInBoundingBox += source.pixelsInBoundingBox;
  target.vertexMilliseconds += source.vertexMilliseconds;
  // El máximo, no la suma: cada worker construye su propio mapa de sombras con la
  // escena completa, así que el trabajo está duplicado y sumarlo mentiría sobre el
  // camino crítico. Es la parte del paralelo que queda por optimizar.
  target.shadowMilliseconds = Math.max(target.shadowMilliseconds, source.shadowMilliseconds);
  target.postprocessMilliseconds += source.postprocessMilliseconds;
}

export class ParallelRenderer {
  readonly workerCount: number;

  private readonly workers: Worker[] = [];
  private readonly resolvers: Array<((result: WorkerResult) => void) | null> = [];
  private readonly recycled: Array<ArrayBuffer | undefined> = [];
  private bandRows: number[] = [];
  private width = 0;
  private height = 0;

  constructor(workerCount: number) {
    this.workerCount = Math.max(1, workerCount);
    for (let index = 0; index < this.workerCount; index += 1) {
      const worker = new Worker(new URL("./renderWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const resolve = this.resolvers[index];
        this.resolvers[index] = null;
        resolve?.(event.data);
      };
      this.workers.push(worker);
      this.resolvers.push(null);
      this.recycled.push(undefined);
    }
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    // Reparto inicial uniforme; la primera medida ya lo corrige.
    const base = Math.floor(height / this.workerCount);
    this.bandRows = new Array(this.workerCount).fill(base);
    this.bandRows[this.workerCount - 1] = height - base * (this.workerCount - 1);
    this.recycled.fill(undefined);
  }

  async renderFrame(
    time: number,
    camera: Camera,
    options: RenderOptions,
    context: CanvasRenderingContext2D,
  ): Promise<ParallelFrameStats> {
    const promises: Array<Promise<WorkerResult>> = [];
    let rowOffset = 0;

    for (let index = 0; index < this.workerCount; index += 1) {
      const bandHeight = this.bandRows[index];
      const job: WorkerJob = {
        width: this.width,
        fullHeight: this.height,
        rowOffset,
        bandHeight,
        time,
        camera,
        options,
        recycled: this.recycled[index],
      };
      this.recycled[index] = undefined;

      promises.push(
        new Promise<WorkerResult>((resolve) => {
          this.resolvers[index] = resolve;
          const transfer = job.recycled ? [job.recycled] : [];
          this.workers[index].postMessage(job, transfer);
        }),
      );
      rowOffset += bandHeight;
    }

    const results = await Promise.all(promises);

    const blitStart = performance.now();
    const stats = emptyStats();
    const bandMilliseconds: number[] = [];
    let criticalPath = 0;
    let totalWorkerTime = 0;

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const view = new Uint8ClampedArray(result.pixels);
      context.putImageData(new ImageData(view, result.width, result.bandHeight), 0, result.rowOffset);
      this.recycled[index] = result.pixels;
      accumulate(stats, result.stats);
      bandMilliseconds.push(result.milliseconds);
      totalWorkerTime += result.milliseconds;
      if (result.milliseconds > criticalPath) criticalPath = result.milliseconds;
    }
    const blitMilliseconds = performance.now() - blitStart;

    this.rebalance(bandMilliseconds);

    const meanTime = totalWorkerTime / results.length;
    stats.totalMilliseconds = criticalPath + blitMilliseconds;

    return {
      criticalPathMilliseconds: criticalPath,
      totalWorkerMilliseconds: totalWorkerTime,
      blitMilliseconds,
      balance: criticalPath > 0 ? meanTime / criticalPath : 1,
      bandRows: [...this.bandRows],
      bandMilliseconds,
      stats,
    };
  }

  /** Reparto proporcional al inverso del coste por fila, amortiguado. */
  private rebalance(bandMilliseconds: number[]): void {
    if (this.workerCount === 1 || this.height === 0) return;

    let inverseCostSum = 0;
    const inverseCosts: number[] = [];
    for (let index = 0; index < this.workerCount; index += 1) {
      const rows = Math.max(1, this.bandRows[index]);
      const costPerRow = Math.max(1e-4, bandMilliseconds[index] / rows);
      const inverseCost = 1 / costPerRow;
      inverseCosts.push(inverseCost);
      inverseCostSum += inverseCost;
    }

    let assigned = 0;
    for (let index = 0; index < this.workerCount - 1; index += 1) {
      const ideal = (this.height * inverseCosts[index]) / inverseCostSum;
      const damped = this.bandRows[index] + DAMPING * (ideal - this.bandRows[index]);
      const rows = Math.max(MINIMUM_BAND_ROWS, Math.round(damped));
      // Reservar el mínimo para las bandas que quedan por asignar.
      const remainingBands = this.workerCount - index - 1;
      const maximum = this.height - assigned - remainingBands * MINIMUM_BAND_ROWS;
      this.bandRows[index] = Math.min(rows, Math.max(MINIMUM_BAND_ROWS, maximum));
      assigned += this.bandRows[index];
    }
    this.bandRows[this.workerCount - 1] = this.height - assigned;
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
  }
}

/**
 * Cuántos hilos usar. `cores - 1` deja un núcleo para el hilo principal, que
 * volca píxeles y atiende la interfaz, pero con dos núcleos esa regla daría un
 * solo worker y se perdería el paralelismo entero: el hilo principal pasa casi
 * todo el frame bloqueado en `await`, así que dos workers en dos núcleos siguen
 * mereciendo la pena. `?workers=N` fuerza el valor para medir.
 */
export function defaultWorkerCount(): number {
  const forced = Number(new URLSearchParams(location.search).get("workers"));
  if (Number.isFinite(forced) && forced >= 1) return Math.min(16, Math.floor(forced));
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(8, Math.max(2, cores - 1));
}
