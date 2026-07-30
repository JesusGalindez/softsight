/**
 * Presentación: del framebuffer interno a la pantalla.
 *
 * El canvas visible se dimensiona **una sola vez** por cada cambio real de tamaño
 * en pantalla, y nunca por un cambio de resolución interna. Esa separación es la
 * que elimina los destellos: asignar `canvas.width` borra el lienzo por
 * especificación, así que con el buffer interno atado al canvas, cada ajuste del
 * controlador de resolución producía un parpadeo negro —y con el controlador
 * oscilando, parpadeos continuos.
 *
 * En medio va un canvas intermedio a resolución interna: `putImageData` no escala,
 * así que se vuelca ahí y se amplía con `drawImage`, que sí interpola. El salto de
 * calidad es grande y el coste no: `drawImage` entre canvas lo compone el navegador,
 * no JavaScript.
 */

import type { Framebuffer } from "./framebuffer";

export class Presenter {
  readonly displayContext: CanvasRenderingContext2D;

  private readonly displayCanvas: HTMLCanvasElement;
  private readonly internalCanvas: HTMLCanvasElement;
  private readonly internalContext: CanvasRenderingContext2D;

  private displayWidth = 0;
  private displayHeight = 0;
  private internalWidth = 0;
  private internalHeight = 0;
  private imageData: ImageData | null = null;

  constructor(displayCanvas: HTMLCanvasElement) {
    const displayContext = displayCanvas.getContext("2d", { alpha: false });
    const internalCanvas = document.createElement("canvas");
    const internalContext = internalCanvas.getContext("2d", { alpha: false });
    if (!displayContext || !internalContext) throw new Error("canvas 2D no disponible");

    this.displayCanvas = displayCanvas;
    this.displayContext = displayContext;
    this.internalCanvas = internalCanvas;
    this.internalContext = internalContext;

    // Suavizado activo: el buffer interno se amplía a pantalla, y a factor 1,6×
    // el vecino más cercano se ve a bloques mientras el bilineal se ve nítido.
    this.displayContext.imageSmoothingEnabled = true;
    this.displayContext.imageSmoothingQuality = "high";
    this.internalContext.imageSmoothingEnabled = false;
  }

  /** Tamaño físico del canvas visible: CSS × densidad de píxeles del dispositivo. */
  resizeDisplay(cssWidth: number, cssHeight: number, pixelRatio: number): boolean {
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (width === this.displayWidth && height === this.displayHeight) return false;
    this.displayWidth = width;
    this.displayHeight = height;
    this.displayCanvas.width = width;
    this.displayCanvas.height = height;
    this.displayContext.imageSmoothingEnabled = true;
    this.displayContext.imageSmoothingQuality = "high";
    return true;
  }

  /** Tamaño del buffer interno. No toca el canvas visible. */
  resizeInternal(width: number, height: number): void {
    if (width === this.internalWidth && height === this.internalHeight) return;
    this.internalWidth = width;
    this.internalHeight = height;
    this.internalCanvas.width = width;
    this.internalCanvas.height = height;
    this.internalContext.imageSmoothingEnabled = false;
    this.imageData = null;
  }

  get width(): number {
    return this.displayWidth;
  }

  get height(): number {
    return this.displayHeight;
  }

  /** Contexto a resolución interna, para que el camino paralelo vuelque sus bandas. */
  get bandContext(): CanvasRenderingContext2D {
    return this.internalContext;
  }

  /** Volcado de un framebuffer completo al canvas intermedio. */
  writeFramebuffer(framebuffer: Framebuffer): void {
    if (
      this.imageData === null ||
      this.imageData.width !== framebuffer.width ||
      this.imageData.height !== framebuffer.height
    ) {
      this.imageData = new ImageData(framebuffer.color, framebuffer.width, framebuffer.height);
    }
    this.internalContext.putImageData(this.imageData, 0, 0);
  }

  /** Amplía el canvas intermedio al visible. Aquí no se borra nada nunca. */
  flush(): void {
    this.displayContext.drawImage(
      this.internalCanvas,
      0,
      0,
      this.internalWidth,
      this.internalHeight,
      0,
      0,
      this.displayWidth,
      this.displayHeight,
    );
  }
}
