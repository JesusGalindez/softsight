/**
 * Controlador de resolución con modelo de coste medido en vivo.
 *
 * El controlador anterior perseguía 60 fps multiplicando la escala por
 * `√(objetivo/medido)`, con la suposición implícita de que el coste del frame es
 * proporcional a los píxeles. Medido, resultó falso: en esta escena hay ~10 ms de
 * coste fijo —preparación por triángulo, por objeto, por frame— y a resoluciones
 * bajas eso era el 64 % del tiempo. El resultado fue que el controlador bajaba la
 * resolución hasta el suelo persiguiendo un objetivo inalcanzable, y se quedaba en
 * el 9 % de los píxeles nativos sin haber ganado fluidez.
 *
 * Aquí el coste se modela con dos términos y se ajustan **con medidas reales**:
 *
 *     ms = fijo + porPíxel · píxeles
 *
 * Dos puntos de operación con recuentos de píxeles distintos determinan la recta:
 *
 *     porPíxel = (ms₁ - ms₂) / (p₁ - p₂)
 *     fijo     = ms₁ - porPíxel · p₁
 *
 * Con eso, la resolución objetivo sale de despejar en vez de tantear:
 *
 *     p* = (msObjetivo - fijo) / porPíxel
 *
 * Y sobre todo: si `fijo` ya supera el objetivo, **ninguna resolución lo alcanza**.
 * En ese régimen bajar píxeles solo destruye nitidez, así que el controlador se
 * detiene, lo señala (`fixedBound`) y deja la palanca correcta —reducir geometría—
 * a quien pueda accionarla.
 */

export interface ResolutionDecision {
  scale: number;
  changed: boolean;
  /** El término fijo impide alcanzar el objetivo a cualquier resolución. */
  fixedBound: boolean;
  fixedMilliseconds: number | null;
  millisecondsPerMegapixel: number | null;
}

interface Sample {
  pixels: number;
  milliseconds: number;
}

export interface ResolutionControllerOptions {
  targetMilliseconds?: number;
  minimumScale?: number;
  /** Tope de supersampleo; por encima de 2 el retorno visual no compensa. */
  maximumScaleCeiling?: number;
  /** Cambios en pasos discretos, para no reasignar buffers por ruido de medida. */
  step?: number;
  /** Frames consecutivos fuera de banda antes de mover nada. */
  patienceFrames?: number;
  minimumIntervalMilliseconds?: number;
}

export class ResolutionController {
  private readonly targetMilliseconds: number;
  private readonly minimumScale: number;
  private readonly step: number;
  private readonly patienceFrames: number;
  private readonly minimumIntervalMilliseconds: number;

  private scale: number;
  private consecutiveOutOfBand = 0;
  private lastChangeTimestamp = -Infinity;
  private previous: Sample | null = null;
  private current: Sample | null = null;
  private fixedMilliseconds: number | null = null;
  private perPixel: number | null = null;
  private fixedBound = false;

  private readonly maximumScaleCeiling: number;

  constructor(initialScale: number, options: ResolutionControllerOptions = {}) {
    this.scale = initialScale;
    // Techo absoluto por encima del cual no se supersamplea aunque sobre
    // presupuesto: a 2× lineal ya son cuatro muestras por píxel y el retorno visual
    // de seguir subiendo es despreciable frente al coste.
    this.maximumScaleCeiling = options.maximumScaleCeiling ?? 2;
    // 30 fps por defecto, no 60: a 60 esta escena obliga a tirar tres cuartas
    // partes de los píxeles, y una imagen nítida a 30 se ve mejor que una borrosa
    // a 60 cuando lo que se está mirando es un objeto, no un juego de acción.
    this.targetMilliseconds = options.targetMilliseconds ?? 1000 / 30;
    this.minimumScale = options.minimumScale ?? 0.6;
    this.step = options.step ?? 0.05;
    this.patienceFrames = options.patienceFrames ?? 3;
    this.minimumIntervalMilliseconds = options.minimumIntervalMilliseconds ?? 500;
  }

  get currentScale(): number {
    return this.scale;
  }

  get diagnostics(): {
    fixedMilliseconds: number | null;
    millisecondsPerMegapixel: number | null;
    fixedBound: boolean;
    scale: number;
    consecutiveOutOfBand: number;
    samples: number;
  } {
    return {
      fixedMilliseconds: this.fixedMilliseconds,
      millisecondsPerMegapixel: this.perPixel === null ? null : this.perPixel * 1e6,
      fixedBound: this.fixedBound,
      scale: this.scale,
      consecutiveOutOfBand: this.consecutiveOutOfBand,
      samples: (this.previous ? 1 : 0) + (this.current ? 1 : 0),
    };
  }

  /** Fuerza una escala (deslizador del usuario) y descarta el modelo, que ya no aplica. */
  setScale(scale: number): void {
    this.scale = scale;
    this.invalidateModel();
    this.consecutiveOutOfBand = 0;
  }

  /**
   * Descarta el modelo cuando cambia la carga por razones ajenas al controlador:
   * otro tamaño de ventana, otra escena, otro modo de sombreado.
   *
   * Sin esto, los dos puntos de operación pueden venir de mundos distintos —el
   * panel se redimensionó entre medias— y la recta ajustada describe algo que ya no
   * existe. Un modelo obsoleto es peor que no tener modelo.
   */
  invalidateModel(): void {
    this.previous = null;
    this.current = null;
    this.perPixel = null;
    this.fixedMilliseconds = null;
    this.fixedBound = false;
  }

  /**
   * @param smoothedMilliseconds tiempo de frame suavizado
   * @param pixels píxeles del buffer interno actual
   * @param maximumScale techo impuesto por el usuario
   * @param now marca de tiempo, para el intervalo mínimo entre cambios
   */
  update(
    smoothedMilliseconds: number,
    pixels: number,
    maximumScale: number,
    now: number,
  ): ResolutionDecision {
    this.recordSample(pixels, smoothedMilliseconds);

    // Un término fijo mayor que el frame actual es imposible por definición: el
    // ajuste viene de un régimen que ya no existe. Se descarta en vez de mostrarse.
    if (this.fixedMilliseconds !== null && this.fixedMilliseconds > smoothedMilliseconds) {
      this.invalidateModel();
    }

    const ratio = this.targetMilliseconds / smoothedMilliseconds;
    // Banda muerta ancha: dentro de ±25 % del objetivo no se toca nada. Estrecharla
    // es lo que hacía oscilar al controlador anterior, y cada oscilación era un
    // cambio de buffer y un parpadeo.
    const withinBand = ratio > 0.75 && ratio < 1.25;
    const ceiling = Math.min(maximumScale, this.maximumScaleCeiling);
    const clampedScale = Math.min(ceiling, Math.max(this.minimumScale, this.scale));

    if (withinBand) {
      this.consecutiveOutOfBand = 0;
      return this.decision(clampedScale, clampedScale !== this.scale);
    }

    this.consecutiveOutOfBand += 1;
    if (this.consecutiveOutOfBand < this.patienceFrames) {
      return this.decision(clampedScale, clampedScale !== this.scale);
    }
    if (now - this.lastChangeTimestamp < this.minimumIntervalMilliseconds) {
      return this.decision(clampedScale, clampedScale !== this.scale);
    }

    const target = this.solveScale(pixels, smoothedMilliseconds);
    const quantized = Math.round(target / this.step) * this.step;
    const next = Math.min(ceiling, Math.max(this.minimumScale, Number(quantized.toFixed(3))));

    if (Math.abs(next - this.scale) < this.step / 2) {
      this.consecutiveOutOfBand = 0;
      return this.decision(this.scale, false);
    }

    this.scale = next;
    this.consecutiveOutOfBand = 0;
    this.lastChangeTimestamp = now;
    return this.decision(next, true);
  }

  /**
   * Guarda dos puntos de operación con recuentos de píxeles suficientemente
   * distintos. Sin esa separación el sistema de dos ecuaciones está mal
   * condicionado y el ajuste devuelve cualquier cosa.
   */
  private recordSample(pixels: number, milliseconds: number): void {
    if (this.current === null) {
      this.current = { pixels, milliseconds };
      return;
    }
    if (Math.abs(pixels - this.current.pixels) < this.current.pixels * 0.15) {
      this.current = { pixels, milliseconds }; // mismo régimen: solo refresca
      return;
    }
    this.previous = this.current;
    this.current = { pixels, milliseconds };
    this.fitCostModel();
  }

  private fitCostModel(): void {
    const a = this.previous;
    const b = this.current;
    if (!a || !b || a.pixels === b.pixels) return;

    const perPixel = (a.milliseconds - b.milliseconds) / (a.pixels - b.pixels);
    const fixed = a.milliseconds - perPixel * a.pixels;

    // El ruido de medida puede dar pendientes negativas o un término fijo mayor que
    // el propio frame. Un ajuste imposible se descarta en vez de creerse.
    if (!Number.isFinite(perPixel) || perPixel <= 0) return;
    if (!Number.isFinite(fixed) || fixed < 0 || fixed > Math.min(a.milliseconds, b.milliseconds)) {
      return;
    }
    this.perPixel = perPixel;
    this.fixedMilliseconds = fixed;
  }

  private solveScale(pixels: number, milliseconds: number): number {
    // Regla de la raíz: correcta si todo el coste fuera por píxel. No acierta la
    // magnitud cuando hay término fijo, pero **el sentido nunca lo falla**: si el
    // frame va lento pide bajar y si va sobrado pide subir. Sirve de referencia
    // contra la que validar el modelo.
    const naive = this.scale * Math.sqrt(this.targetMilliseconds / milliseconds);

    if (this.perPixel === null || this.fixedMilliseconds === null) {
      this.fixedBound = false;
      return naive;
    }

    const budget = this.targetMilliseconds - this.fixedMilliseconds;
    if (budget <= 0) {
      // Ninguna resolución alcanza el objetivo: el coste fijo ya lo consume. Solo
      // se declara si además la medida confirma que vamos lentos; si el frame va
      // sobrado, el que se equivoca es el modelo.
      if (naive < this.scale) {
        this.fixedBound = true;
        return this.minimumScale;
      }
      this.invalidateModel();
      return naive;
    }

    const targetPixels = budget / this.perPixel;
    // pixels = base · escala², así que la escala va con la raíz del cociente.
    const modelled = this.scale * Math.sqrt(targetPixels / pixels);

    // Si el modelo pide moverse en sentido contrario a lo que dice la medida, el
    // modelo está viciado: se descarta y se sigue la medida.
    const modelWantsUp = modelled > this.scale;
    const measurementWantsUp = naive > this.scale;
    if (modelWantsUp !== measurementWantsUp) {
      this.invalidateModel();
      return naive;
    }

    this.fixedBound = false;
    return modelled;
  }

  private decision(scale: number, changed: boolean): ResolutionDecision {
    if (changed) this.scale = scale;
    return {
      scale,
      changed,
      fixedBound: this.fixedBound,
      fixedMilliseconds: this.fixedMilliseconds,
      millisecondsPerMegapixel: this.perPixel === null ? null : this.perPixel * 1e6,
    };
  }
}
