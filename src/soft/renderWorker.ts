/**
 * Hilo de rasterizado. Cada worker posee una banda horizontal del framebuffer y
 * la renderiza completa: geometría, recortado, rasterizado y sombreado.
 *
 * No hay memoria compartida ni sincronización. El worker construye su propia
 * copia de la escena y la anima con el `time` que recibe: la escena es una
 * función pura del tiempo, así que todas las copias coinciden exactamente sin
 * necesidad de transmitir matrices. Lo único que viaja son los parámetros de
 * cámara, las opciones y, de vuelta, los píxeles de la banda —transferidos, no
 * copiados.
 */

import { SoftwareRenderer, type Camera, type FrameStats, type RenderOptions } from "./renderer";
import { createScene, updateScene } from "./scene";

export interface WorkerJob {
  width: number;
  fullHeight: number;
  rowOffset: number;
  bandHeight: number;
  time: number;
  camera: Camera;
  options: RenderOptions;
  /** Buffer reciclado del frame anterior, si el hilo principal lo devolvió. */
  recycled?: ArrayBuffer;
}

export interface WorkerResult {
  rowOffset: number;
  bandHeight: number;
  width: number;
  pixels: ArrayBuffer;
  milliseconds: number;
  stats: FrameStats;
}

const scene = createScene();
let renderer: SoftwareRenderer | null = null;

self.onmessage = (event: MessageEvent<WorkerJob>) => {
  const job = event.data;
  const start = performance.now();

  if (
    renderer === null ||
    renderer.framebuffer.width !== job.width ||
    renderer.framebuffer.height !== job.bandHeight ||
    renderer.framebuffer.rowOffset !== job.rowOffset ||
    renderer.framebuffer.fullHeight !== job.fullHeight
  ) {
    renderer = new SoftwareRenderer(job.width, job.bandHeight, job.rowOffset, job.fullHeight);
  }

  updateScene(scene, job.time);
  const stats = renderer.render(scene, job.camera, job.options);

  // Copia hacia el buffer que se transfiere. El `ImageData` interno del
  // framebuffer no se puede transferir sin perderlo, y reasignarlo cada frame
  // sería peor: se copia sobre un buffer reciclado que el hilo principal
  // devuelve tras volcarlo.
  const byteLength = job.width * job.bandHeight * 4;
  const pixels =
    job.recycled && job.recycled.byteLength === byteLength
      ? job.recycled
      : new ArrayBuffer(byteLength);
  new Uint8ClampedArray(pixels).set(renderer.framebuffer.color);

  const result: WorkerResult = {
    rowOffset: job.rowOffset,
    bandHeight: job.bandHeight,
    width: job.width,
    pixels,
    milliseconds: performance.now() - start,
    stats,
  };
  (self as unknown as Worker).postMessage(result, [pixels]);
};
