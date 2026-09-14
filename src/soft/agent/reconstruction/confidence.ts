/**
 * R6 — con cuánta autoridad está sostenida cada región de la superficie.
 *
 * La cobertura contesta **si** alguien lo vio. Esto contesta **desde dónde**, que
 * no es lo mismo y a veces es lo contrario: dos cámaras separadas medio grado ven
 * un punto las dos, así que la cobertura lo cuenta como triangulado, y su
 * profundidad está prácticamente indeterminada. Un paquete puede salir con el
 * 99 % observado y estar sostenido por aire.
 *
 * ## Lo que no es, y es lo primero que hay que decir
 *
 * **No es una probabilidad, y por eso no sale un número entre 0 y 1.** Emitir
 * `confidence: 0.87` invita a leerlo como «87 % de posibilidades de que esté
 * bien», que es una afirmación que nadie aquí puede sostener — es literalmente el
 * riesgo R8 del contrato, «confianza tratada como exacta». Lo que sale son
 * **fracciones de área por clase** y la distribución de los ángulos, que son
 * medidas y no apuestas.
 *
 * ## De qué se deduce, y qué no hace falta para eso
 *
 * ```text
 * ángulo de triangulación   el mayor entre dos rayos de vista. Es lo que
 *                           determina la profundidad: con ángulo pequeño, un
 *                           error de un píxel mueve el punto muchísimo
 * oblicuidad                la superficie vista de canto está peor sostenida que
 *                           la vista de frente, con las mismas cámaras
 * muestreo en el suelo      distancia dividida por focal: cuánta superficie cae
 *                           en un píxel. Dos vistas buenas y lejanas ven poco
 * ```
 *
 * Las tres salen de la malla y del CameraSet. **No hacen falta ni profundidad ni
 * máscaras**: lo que necesita esas dos es la confianza por *residuales* —¿la
 * superficie coincide con lo que las fotos muestran?—, que es R8 y es otra cosa,
 * más fuerte y más cara.
 *
 * ## Por qué el umbral no vive aquí
 *
 * Cinco grados de paralaje es el valor que la fotogrametría usa como suelo, y va
 * como **defecto declarado**, no como ley: una pieza pequeña vista de cerca y un
 * edificio visto desde lejos no toleran lo mismo. Quien conoce la pieza pasa el
 * suyo, igual que el presupuesto de D9 y que el umbral de la cobertura.
 */

import type { Mesh } from "../../mesh";
import type { PackageCamera } from "./camera";
import { computeVisibility, type CoverageOptions, type SurfaceVisibility } from "./coverage";

/**
 * Suelo de paralaje por defecto, en grados.
 *
 * Cinco es el valor que la fotogrametría usa como frontera práctica: por debajo,
 * el error de profundidad crece como `1/tan(θ)` y un píxel de ruido se convierte
 * en un desplazamiento que se ve. Va **declarado y sustituible**, no fijado: es
 * un criterio sobre la pieza, no una constante de la aritmética.
 */
export const DEFAULT_PARALLAX_DEGREES = 5;

/**
 * Cómo está sostenida una región. Ordenadas de menos a más, y **sin número
 * agregado a propósito**: un «índice de confianza» medio escondería que la mitad
 * firme y la mitad sin evidencia dan el mismo promedio que todo mediocre.
 */
export type SupportClass =
  /** Ninguna cámara la ve. */
  | "SIN_EVIDENCIA"
  /** La ve una: hay foto y no hay profundidad. */
  | "SIN_TRIANGULAR"
  /** La ven dos o más, pero el mayor ángulo entre ellas no llega al suelo. */
  | "PARALAJE_CORTO"
  /** La ven dos o más con ángulo suficiente. */
  | "SOSTENIDA";

export interface SupportDistribution {
  SIN_EVIDENCIA: number;
  SIN_TRIANGULAR: number;
  PARALAJE_CORTO: number;
  SOSTENIDA: number;
}

export interface Confidence {
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  seed: number;
  samples: number;
  areaWeighted: true;
  /** El suelo que se aplicó, publicado porque las clases dependen de él. */
  parallaxThresholdDegrees: number;
  /** Fracción de área en cada clase. Suman uno. */
  byClass: SupportDistribution;
  /**
   * Percentiles del ángulo de triangulación, **solo sobre lo que triangula**.
   * Meter en la distribución lo que nadie ve la llenaría de ceros y movería la
   * mediana a un sitio que no describe nada.
   */
  parallaxDegrees: { p05: number; median: number; p95: number } | null;
  /** Percentiles de la oblicuidad, en grados desde la normal. */
  obliquityDegrees: { median: number; p95: number } | null;
  /**
   * Muestreo en el suelo de la mejor vista de cada muestra, en unidades del
   * paquete por píxel. Con escala desconocida el número es relativo, y por eso va
   * acompañado de la diagonal en el informe (D9).
   */
  groundSampling: { median: number; p95: number } | null;
  /** D21, igual que la cobertura: v1 no sabe de provenance. */
  provenanceAware: false;
  certificationEligible: boolean;
  reason?: string;
}

export interface ConfidenceOptions extends CoverageOptions {
  parallaxThresholdDegrees?: number;
}

/** Percentil sobre una lista ya ordenada. Vacía devuelve `null` arriba. */
function quantile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function computeConfidence(
  mesh: Mesh,
  cameras: readonly PackageCamera[],
  options: ConfidenceOptions = {},
): Confidence {
  const visibility: SurfaceVisibility = options.visibility ?? computeVisibility(mesh, cameras, options);
  const threshold = options.parallaxThresholdDegrees ?? DEFAULT_PARALLAX_DEGREES;

  // Posición de cada cámara: la traslación de `worldFromCamera`, en 3, 7 y 11
  // porque la matriz va por filas (D32). Se saca una vez y no por muestra.
  const eyes = cameras.map((camera) => [
    camera.worldFromCamera[3],
    camera.worldFromCamera[7],
    camera.worldFromCamera[11],
  ]);
  const focals = cameras.map((camera) => camera.intrinsics.fx);

  const byClass: SupportDistribution = {
    SIN_EVIDENCIA: 0,
    SIN_TRIANGULAR: 0,
    PARALAJE_CORTO: 0,
    SOSTENIDA: 0,
  };
  const parallax: number[] = [];
  const obliquity: number[] = [];
  const sampling: number[] = [];

  for (let sample = 0; sample < visibility.count; sample += 1) {
    const visible = visibility.seenBy[sample];
    if (visible.length === 0) {
      byClass.SIN_EVIDENCIA += 1;
      continue;
    }
    const point = [
      visibility.points[sample * 3],
      visibility.points[sample * 3 + 1],
      visibility.points[sample * 3 + 2],
    ];
    const normal = [
      visibility.normals[sample * 3],
      visibility.normals[sample * 3 + 1],
      visibility.normals[sample * 3 + 2],
    ];

    // Rayo unitario hacia cada cámara que la ve, y su distancia.
    const rays = visible.map((index) => {
      const eye = eyes[index];
      const dx = eye[0] - point[0];
      const dy = eye[1] - point[1];
      const dz = eye[2] - point[2];
      const distance = Math.hypot(dx, dy, dz) || 1;
      return { index, direction: [dx / distance, dy / distance, dz / distance], distance };
    });

    // La mejor vista es la **menos oblicua**: la que mira más de frente es la que
    // mejor resuelve la superficie, y es la que describe lo que se puede afirmar.
    let best = rays[0];
    let bestFacing = -Infinity;
    for (const ray of rays) {
      const facing =
        normal[0] * ray.direction[0] + normal[1] * ray.direction[1] + normal[2] * ray.direction[2];
      if (facing > bestFacing) {
        bestFacing = facing;
        best = ray;
      }
    }
    obliquity.push((Math.acos(Math.min(1, Math.max(-1, bestFacing))) * 180) / Math.PI);
    // Distancia entre focal: cuánta superficie cae en un píxel. Con la superficie
    // de canto habría que dividir por el coseno, y no se hace: esto describe la
    // vista, y la oblicuidad ya va publicada aparte.
    sampling.push(best.distance / (focals[best.index] || 1));

    if (rays.length < 2) {
      byClass.SIN_TRIANGULAR += 1;
      continue;
    }

    // El mayor ángulo entre dos rayos: es el par que mejor triangula, y es el que
    // determina lo que se puede afirmar de la profundidad. Coger el menor
    // describiría el peor par, que no es el que se usa.
    let widest = 0;
    for (let a = 0; a < rays.length; a += 1) {
      for (let b = a + 1; b < rays.length; b += 1) {
        const dot =
          rays[a].direction[0] * rays[b].direction[0] +
          rays[a].direction[1] * rays[b].direction[1] +
          rays[a].direction[2] * rays[b].direction[2];
        widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot))));
      }
    }
    const degrees = (widest * 180) / Math.PI;
    parallax.push(degrees);
    if (degrees < threshold) byClass.PARALAJE_CORTO += 1;
    else byClass.SOSTENIDA += 1;
  }

  const total = visibility.count || 1;
  parallax.sort((a, b) => a - b);
  obliquity.sort((a, b) => a - b);
  sampling.sort((a, b) => a - b);

  const purely = options.purelyReconstructed === true;
  return {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    seed: options.seed ?? 1,
    samples: visibility.count,
    areaWeighted: true,
    parallaxThresholdDegrees: threshold,
    byClass: {
      SIN_EVIDENCIA: byClass.SIN_EVIDENCIA / total,
      SIN_TRIANGULAR: byClass.SIN_TRIANGULAR / total,
      PARALAJE_CORTO: byClass.PARALAJE_CORTO / total,
      SOSTENIDA: byClass.SOSTENIDA / total,
    },
    parallaxDegrees:
      parallax.length === 0
        ? null
        : { p05: quantile(parallax, 0.05), median: quantile(parallax, 0.5), p95: quantile(parallax, 0.95) },
    obliquityDegrees:
      obliquity.length === 0
        ? null
        : { median: quantile(obliquity, 0.5), p95: quantile(obliquity, 0.95) },
    groundSampling:
      sampling.length === 0
        ? null
        : { median: quantile(sampling, 0.5), p95: quantile(sampling, 0.95) },
    provenanceAware: false,
    certificationEligible: purely,
    ...(purely ? {} : { reason: "MALLA_NO_PURAMENTE_RECONSTRUIDA" }),
  };
}
