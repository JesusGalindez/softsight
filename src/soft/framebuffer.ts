/**
 * Framebuffer en memoria: color RGBA8 + z-buffer float32.
 *
 * El color vive en un `Uint8ClampedArray` con el layout exacto que espera
 * `ImageData`, así que volcar el frame a pantalla es un único `putImageData`
 * sin copias intermedias ni conversión de formato.
 *
 * BANDAS. Un framebuffer puede cubrir solo una franja horizontal de la imagen:
 * `rowOffset` es su primera fila en coordenadas de pantalla y `fullHeight` la
 * altura de la imagen completa. La proyección sigue usando `fullHeight` —la
 * geometría no sabe nada de bandas—, y solo el indexado de filas resta
 * `rowOffset`. Es lo que permite que cada hilo posea su franja sin compartir
 * memoria ni sincronizar nada: las bandas particionan el espacio de pantalla,
 * así que dos hilos nunca escriben el mismo píxel ni necesitan ver el z-buffer
 * del otro.
 */

export class Framebuffer {
  readonly width: number;
  /** Altura de esta banda. */
  readonly height: number;
  /** Primera fila de la banda en coordenadas de pantalla. */
  readonly rowOffset: number;
  /** Altura de la imagen completa, la que usa la transformación de viewport. */
  readonly fullHeight: number;
  /**
   * El parámetro de búfer explícito no es decorativo: `ImageData` solo acepta un
   * array respaldado por `ArrayBuffer`, no por `SharedArrayBuffer`, y sin fijarlo
   * el tipo por defecto admite ambos y `present` no compila.
   */
  readonly color: Uint8ClampedArray<ArrayBuffer>;
  readonly depth: Float32Array;

  /**
   * Vista de 32 bits sobre los mismos píxeles. Limpiar escribiendo bytes cuesta
   * cuatro almacenamientos por píxel; empaquetando RGBA en una sola palabra es
   * uno, y `fill` sobre un `Uint32Array` lo hace en código nativo. A 0,26 MP son
   * un millón de escrituras menos por frame.
   */
  private readonly colorWords: Uint32Array;
  /**
   * El `ImageData` se crea al primer volcado, no en el constructor: envuelve el
   * array que ya existe, sin copia. Así el núcleo del motor no depende de
   * ninguna API de navegador y el mismo código corre en Node —donde `ImageData`
   * no existe y nunca se llama a `present`— sin adaptadores.
   */
  private imageData: ImageData | null = null;

  constructor(width: number, height: number, rowOffset = 0, fullHeight = height) {
    this.width = width;
    this.height = height;
    this.rowOffset = rowOffset;
    this.fullHeight = fullHeight;
    this.color = new Uint8ClampedArray(width * height * 4);
    this.colorWords = new Uint32Array(this.color.buffer);
    this.depth = new Float32Array(width * height);
  }

  /**
   * Profundidad invertida: se limpia a 0 (plano lejano) y el test es
   * "mayor pasa". Ver projection.ts.
   */
  clear(red: number, green: number, blue: number): void {
    // Orden de bytes: los `Uint8ClampedArray` de ImageData son R,G,B,A en
    // memoria, y las máquinas donde esto corre son little-endian, así que la
    // palabra se monta al revés: A en el byte más significativo.
    // Redondear, no truncar: `Uint8ClampedArray` redondea al asignar, y truncar
    // aquí desplazaría el color de fondo un nivel respecto al resto del motor.
    const packed =
      ((255 << 24) |
        (Math.min(255, Math.round(blue)) << 16) |
        (Math.min(255, Math.round(green)) << 8) |
        Math.min(255, Math.round(red))) >>>
      0;
    this.colorWords.fill(packed);
    this.depth.fill(0);
  }

  present(context: CanvasRenderingContext2D): void {
    if (this.imageData === null) {
      this.imageData = new ImageData(this.color, this.width, this.height);
    }
    context.putImageData(this.imageData, 0, this.rowOffset);
  }
}
