/**
 * Rasterizador de triángulos con funciones de arista, z-buffer e interpolación
 * con corrección de perspectiva.
 *
 * Método: las tres funciones de arista
 *
 *   e_i(x, y) = A_i·x + B_i·y + C_i
 *
 * son afines, su signo dice a qué lado de la arista cae el punto, y normalizadas
 * por el área firmada del triángulo *son* las coordenadas baricéntricas. De ahí
 * salen las cuatro propiedades que explotan las tres optimizaciones de abajo.
 *
 * 1. SPAN EXACTO. Ser afín en x permite resolver el intervalo cubierto en lugar
 *    de buscarlo píxel a píxel: e(k) = e₀ + A·k ≥ 0 da k ≥ -e₀/A si A > 0, y
 *    k ≤ -e₀/A si A < 0. La intersección de las tres restricciones es el span
 *    [kMin, kMax]. Tres divisiones por fila sustituyen a recorrer todo el ancho
 *    del bounding box comprobando cobertura, y dentro del span no queda ni una
 *    comprobación: todos los píxeles están dentro por construcción.
 *
 * 2. GRADIENTES INCREMENTALES. Cualquier atributo interpolado es combinación
 *    lineal de baricéntricos, luego también es afín en (x, y). Su derivada es
 *    constante y se precalcula una vez por triángulo:
 *
 *      ∂v/∂x = (A₁₂·v₀ + A₂₀·v₁ + A₀₁·v₂) / área
 *
 *    Avanzar un píxel es una suma por atributo, no tres multiplicaciones y dos
 *    sumas de la combinación baricéntrica.
 *
 * 3. CORRECCIÓN DE PERSPECTIVA EXACTA. Interpolar un atributo en pantalla exige
 *    dividir por 1/w en cada píxel, porque la proyección es proyectiva y no afín
 *    (es el error que hacía temblar las texturas de la PlayStation 1). Hubo aquí
 *    un esquema que dividía solo en los extremos de segmentos de 16 píxeles e
 *    interpolaba `w` linealmente por dentro; medido, no ahorraba nada y metía
 *    hasta un 1,36 % de error. Se divide en cada píxel, y solo en los que pasan
 *    el test de profundidad.
 */

import type { Framebuffer } from "./framebuffer";
import { MAX_VARYING_COUNT } from "./clip";

/** [x_pantalla, y_pantalla, profundidad, 1/w, varyings·(1/w)] */
export const RASTER_STRIDE = 4 + MAX_VARYING_COUNT;

export type PixelShader = (varyings: Float32Array, w: number, outRgb: Float32Array) => void;

export const enum CullMode {
  None = 0,
  Back = 1,
  Front = 2,
}

export interface RasterStats {
  trianglesRasterized: number;
  trianglesCulled: number;
  pixelsShaded: number;
  pixelsTested: number;
  pixelsInBoundingBox: number;
}

const interpolatedVaryings = new Float32Array(MAX_VARYING_COUNT);
const shadedColor = new Float32Array(3);

// Acumuladores en doble precisión: sumar un gradiente hasta 2000 veces por fila
// acumula error, y en float32 se llegaría a ver como desgarros en la textura.
const rowVaryings = new Float64Array(MAX_VARYING_COUNT);
const accumulatedVaryings = new Float64Array(MAX_VARYING_COUNT);
const varyingStepX = new Float64Array(MAX_VARYING_COUNT);
const varyingStepY = new Float64Array(MAX_VARYING_COUNT);

/**
 * Cuantización a 8 bits con curva de tono y dither: el único punto del motor donde
 * el color deja de ser lineal.
 *
 * La LUT de 1.024 entradas sustituye la curva completa por un acceso a tabla, con un
 * paso menor que medio nivel de los 256 finales, así que el error de tabulación es
 * invisible.
 *
 * El dither ordenado de Bayer resuelve el otro problema: 256 niveles no bastan para
 * un degradado suave de neblina y aparecen bandas. Sumar un patrón de ±0.47 niveles
 * antes de redondear convierte el error de cuantización en un ruido regular de alta
 * frecuencia que el ojo integra como el nivel intermedio que el buffer no puede
 * representar.
 */

/**
 * Aproximación ACES (Narkowicz). Probé antes la de Hejl–Burgess-Dawson: las dos
 * tienen hombro, pero aquella sube mucho los tonos medios —0,87 donde la raíz
 * cuadrada daba 0,71— y la imagen salía lavada y sin contraste. Esta tiene además
 * **pie**: oscurece las sombras, deja los medios cerca de donde estaban y solo
 * comprime los brillos altos. Es la diferencia entre «más claro» y «con rango».
 *
 * Recortar a 1 en vez de comprimir aplana los brillos en manchas de blanco uniforme,
 * que es el aspecto de render de los noventa; con hombro, un especular intenso
 * conserva forma y gradiente. Y cuesta lo mismo, porque vive en la misma tabla.
 */
function filmicCurve(value: number): number {
  const x = Math.max(0, value);
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

const GAMMA_LUT = new Float32Array(1025);
{
  // Normalización del punto de blanco. La curva en crudo manda el 1.0 a 0.84, así
  // que nada en la imagen llegaba a blanco y el resultado se veía lavado. Dividir
  // por ese valor conserva el hombro —que es el motivo de usar la curva— y
  // devuelve el rango completo.
  const whitePoint = filmicCurve(1);
  for (let i = 0; i <= 1024; i += 1) {
    GAMMA_LUT[i] = 255 * Math.min(1, filmicCurve(i / 1024) / whitePoint);
  }
}

const BAYER_4X4 = Float32Array.from(
  [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  (value) => (value + 0.5) / 16 - 0.5,
);

export function rasterizeTriangle(
  target: Framebuffer,
  triangle: Float32Array,
  shader: PixelShader,
  cullMode: CullMode,
  stats: RasterStats,
  /**
   * A false, los varyings se interpolan linealmente en pantalla (mapeado afín),
   * el artefacto de la PlayStation 1. Expuesto porque es didáctico.
   */
  perspectiveCorrect = true,
  /** Varyings activos. Interpolar los que nadie lee es coste puro. */
  varyingCount = MAX_VARYING_COUNT,
): void {
  const x0 = triangle[0];
  const y0 = triangle[1];
  const x1 = triangle[RASTER_STRIDE + 0];
  const y1 = triangle[RASTER_STRIDE + 1];
  const x2 = triangle[2 * RASTER_STRIDE + 0];
  const y2 = triangle[2 * RASTER_STRIDE + 1];

  // Área firmada × 2. El signo es la orientación en pantalla y por tanto si
  // vemos la cara delantera o el reverso: la mitad de los triángulos de un
  // sólido cerrado se descarta aquí, antes de tocar un píxel.
  const doubleArea = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (doubleArea === 0) return; // degenerado: sin superficie que rellenar

  const frontFacing = doubleArea < 0; // Y crece hacia abajo: CCW en NDC -> negativo
  if (cullMode === CullMode.Back && !frontFacing) {
    stats.trianglesCulled += 1;
    return;
  }
  if (cullMode === CullMode.Front && frontFacing) {
    stats.trianglesCulled += 1;
    return;
  }

  const orientation = doubleArea > 0 ? 1 : -1;
  const inverseArea = orientation / doubleArea;

  // El recorte lateral y el de banda salen gratis aquí, acotando el bounding
  // box: es el scissor, y sustituye a recortar contra cuatro planos.
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(target.rowOffset, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(target.rowOffset + target.height - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) return; // fuera de esta banda: nada que hacer

  // e(x,y) = A·x + B·y + C, orientadas positivas para que los baricéntricos
  // salgan en [0,1] sin casos especiales.
  const a12 = (y1 - y2) * orientation;
  const b12 = (x2 - x1) * orientation;
  const c12 = (x1 * y2 - y1 * x2) * orientation;
  const a20 = (y2 - y0) * orientation;
  const b20 = (x0 - x2) * orientation;
  const c20 = (x2 * y0 - y2 * x0) * orientation;
  const a01 = (y0 - y1) * orientation;
  const b01 = (x1 - x0) * orientation;
  const c01 = (x0 * y1 - y0 * x1) * orientation;

  const depth0 = triangle[2];
  const depth1 = triangle[RASTER_STRIDE + 2];
  const depth2 = triangle[2 * RASTER_STRIDE + 2];
  const invW0 = triangle[3];
  const invW1 = triangle[RASTER_STRIDE + 3];
  const invW2 = triangle[2 * RASTER_STRIDE + 3];

  // Derivadas constantes de cada atributo. Una vez por triángulo.
  const depthStepX = (a12 * depth0 + a20 * depth1 + a01 * depth2) * inverseArea;
  const depthStepY = (b12 * depth0 + b20 * depth1 + b01 * depth2) * inverseArea;
  const invWStepX = (a12 * invW0 + a20 * invW1 + a01 * invW2) * inverseArea;
  const invWStepY = (b12 * invW0 + b20 * invW1 + b01 * invW2) * inverseArea;

  for (let component = 0; component < varyingCount; component += 1) {
    const v0 = triangle[4 + component];
    const v1 = triangle[RASTER_STRIDE + 4 + component];
    const v2 = triangle[2 * RASTER_STRIDE + 4 + component];
    varyingStepX[component] = (a12 * v0 + a20 * v1 + a01 * v2) * inverseArea;
    varyingStepY[component] = (b12 * v0 + b20 * v1 + b01 * v2) * inverseArea;
  }

  // Valores en el centro del primer píxel del bounding box.
  const startX = minX + 0.5;
  const startY = minY + 0.5;
  let rowEdge12 = a12 * startX + b12 * startY + c12;
  let rowEdge20 = a20 * startX + b20 * startY + c20;
  let rowEdge01 = a01 * startX + b01 * startY + c01;

  const startWeight0 = rowEdge12 * inverseArea;
  const startWeight1 = rowEdge20 * inverseArea;
  const startWeight2 = rowEdge01 * inverseArea;

  let rowDepth = startWeight0 * depth0 + startWeight1 * depth1 + startWeight2 * depth2;
  let rowInvW = startWeight0 * invW0 + startWeight1 * invW1 + startWeight2 * invW2;
  for (let component = 0; component < varyingCount; component += 1) {
    rowVaryings[component] =
      startWeight0 * triangle[4 + component] +
      startWeight1 * triangle[RASTER_STRIDE + 4 + component] +
      startWeight2 * triangle[2 * RASTER_STRIDE + 4 + component];
  }

  const { color, depth } = target;
  const spanWidth = maxX - minX;
  stats.trianglesRasterized += 1;
  stats.pixelsInBoundingBox += (spanWidth + 1) * (maxY - minY + 1);

  // Contadores en variables locales. Incrementar una propiedad de un objeto del
  // montón dentro del bucle más interior son dos accesos a memoria por píxel y
  // ata las manos al compilador; en locales viven en registros y se suman una
  // vez por triángulo.
  let testedPixels = 0;
  let shadedPixels = 0;

  for (let y = minY; y <= maxY; y += 1) {
    // Span exacto con REGLA DE RELLENO TOP-LEFT.
    //
    // Un píxel que cae exactamente sobre una arista compartida pertenece a los dos
    // triángulos si la prueba es inclusiva en las tres aristas, y entonces se
    // sombrea dos veces. Con geometría opaca y z-buffer no se nota, pero duplica
    // trabajo y hace imposible la transparencia: dos mezclas del 50 % sobre el mismo
    // píxel no dan el 50 %.
    //
    // La convención estándar reparte los empates: se incluye el borde en las aristas
    // «superior» e «izquierda» y se excluye en las demás. Con las aristas ya
    // orientadas para que el interior sea e ≥ 0, la clasificación es directa: el
    // interior queda a la derecha cuando A > 0 (arista izquierda) y queda debajo
    // cuando A = 0 y B > 0 (arista superior).
    //
    // En términos del span, «inclusivo» es `ceil(x)` y «estricto» es `ceil(x) - 1`.
    // Para x no entero son el mismo número, así que el coste de la regla es cero:
    // solo cambia el caso en que el borde cae justo sobre el centro del píxel.
    let kMin = 0;
    let kMax = spanWidth;

    if (a12 > 0) {
      const bound = Math.ceil(-rowEdge12 / a12); // izquierda: inclusiva
      if (bound > kMin) kMin = bound;
    } else if (a12 < 0) {
      const bound = Math.ceil(-rowEdge12 / a12) - 1; // derecha: estricta
      if (bound < kMax) kMax = bound;
    } else if (b12 > 0 ? rowEdge12 < 0 : rowEdge12 <= 0) {
      kMax = -1;
    }

    if (a20 > 0) {
      const bound = Math.ceil(-rowEdge20 / a20);
      if (bound > kMin) kMin = bound;
    } else if (a20 < 0) {
      const bound = Math.ceil(-rowEdge20 / a20) - 1;
      if (bound < kMax) kMax = bound;
    } else if (b20 > 0 ? rowEdge20 < 0 : rowEdge20 <= 0) {
      kMax = -1;
    }

    if (a01 > 0) {
      const bound = Math.ceil(-rowEdge01 / a01);
      if (bound > kMin) kMin = bound;
    } else if (a01 < 0) {
      const bound = Math.ceil(-rowEdge01 / a01) - 1;
      if (bound < kMax) kMax = bound;
    } else if (b01 > 0 ? rowEdge01 < 0 : rowEdge01 <= 0) {
      kMax = -1;
    }

    if (kMin <= kMax) {
      const bayerRow = (y & 3) * 4;
      let pixelIndex = (y - target.rowOffset) * target.width + minX + kMin;
      let accumulatedDepth = rowDepth + depthStepX * kMin;
      for (let component = 0; component < varyingCount; component += 1) {
        accumulatedVaryings[component] = rowVaryings[component] + varyingStepX[component] * kMin;
      }

      let accumulatedInvW = rowInvW + invWStepX * kMin;

      for (let x = kMin; x <= kMax; x += 1) {
        testedPixels += 1;

        {
          if (accumulatedDepth > depth[pixelIndex]) {
            // División exacta, y solo para los píxeles que pasan el test de
            // profundidad. Antes se dividía en los extremos de segmentos de 16
            // píxeles y se interpolaba `w` linealmente por dentro, para bajar las
            // divisiones de 161.982 a ~20.000 por frame. Medido aparte, esa cuenta
            // era cierta y el ahorro nulo: 500 píxeles costaban 2,4 ms por segmentos
            // y 2,5 ms dividiendo en cada uno, porque la contabilidad del segmento
            // —dos divisiones, una resta, otra división y un incremento por píxel—
            // cuesta tanto como la división que evita. Y el segmento introducía
            // hasta un 1,36 % de error en `w`. Dividir sale exacto, igual de rápido
            // y con la mitad de código.
            const w = 1 / accumulatedInvW;
            if (perspectiveCorrect) {
              for (let component = 0; component < varyingCount; component += 1) {
                interpolatedVaryings[component] = accumulatedVaryings[component] * w;
              }
            } else {
              // Deshacer la premultiplicación con los w de los vértices en vez
              // de con el w del píxel: exactamente el error afín.
              const weight0 = (rowEdge12 + a12 * x) * inverseArea;
              const weight1 = (rowEdge20 + a20 * x) * inverseArea;
              const weight2 = (rowEdge01 + a01 * x) * inverseArea;
              for (let component = 0; component < varyingCount; component += 1) {
                interpolatedVaryings[component] =
                  weight0 * (triangle[4 + component] / invW0) +
                  weight1 * (triangle[RASTER_STRIDE + 4 + component] / invW1) +
                  weight2 * (triangle[2 * RASTER_STRIDE + 4 + component] / invW2);
              }
            }

            shader(interpolatedVaryings, w, shadedColor);

            depth[pixelIndex] = accumulatedDepth;
            const byteIndex = pixelIndex * 4;
            // Índice en x de pantalla, no del span: el patrón debe estar
            // anclado al framebuffer o parpadea al moverse la geometría.
            const dither = BAYER_4X4[bayerRow + ((minX + x) & 3)];
            const red = shadedColor[0];
            const green = shadedColor[1];
            const blue = shadedColor[2];
            color[byteIndex] =
              GAMMA_LUT[(red < 0 ? 0 : red > 1 ? 1024 : (red * 1024) | 0)] + dither;
            color[byteIndex + 1] =
              GAMMA_LUT[(green < 0 ? 0 : green > 1 ? 1024 : (green * 1024) | 0)] + dither;
            color[byteIndex + 2] =
              GAMMA_LUT[(blue < 0 ? 0 : blue > 1 ? 1024 : (blue * 1024) | 0)] + dither;
            color[byteIndex + 3] = 255;
            shadedPixels += 1;
          }

          accumulatedDepth += depthStepX;
          accumulatedInvW += invWStepX;
          for (let component = 0; component < varyingCount; component += 1) {
            accumulatedVaryings[component] += varyingStepX[component];
          }
          pixelIndex += 1;
        }
      }
    }

    rowEdge12 += b12;
    rowEdge20 += b20;
    rowEdge01 += b01;
    rowDepth += depthStepY;
    rowInvW += invWStepY;
    for (let component = 0; component < varyingCount; component += 1) {
      rowVaryings[component] += varyingStepY[component];
    }
  }

  stats.pixelsTested += testedPixels;
  stats.pixelsShaded += shadedPixels;
}

/** Línea de Bresenham con test de profundidad, para el modo wireframe. */
export function drawLine(
  target: Framebuffer,
  x0: number,
  y0: number,
  depth0: number,
  x1: number,
  y1: number,
  depth1: number,
  red: number,
  green: number,
  blue: number,
): void {
  let currentX = Math.round(x0);
  let currentY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const deltaX = Math.abs(endX - currentX);
  const deltaY = Math.abs(endY - currentY);
  const stepX = currentX < endX ? 1 : -1;
  const stepY = currentY < endY ? 1 : -1;
  let error = deltaX - deltaY;
  const totalSteps = Math.max(deltaX, deltaY) || 1;
  let step = 0;

  for (;;) {
    const bandRow = currentY - target.rowOffset;
    if (currentX >= 0 && currentX < target.width && bandRow >= 0 && bandRow < target.height) {
      const pixelIndex = bandRow * target.width + currentX;
      const lineDepth = depth0 + (depth1 - depth0) * (step / totalSteps);
      // Sesgo para que la arista gane al triángulo que la contiene. Profundidad
      // invertida: más cerca es MAYOR.
      if (lineDepth + 1e-4 > target.depth[pixelIndex]) {
        const byteIndex = pixelIndex * 4;
        target.color[byteIndex] = red;
        target.color[byteIndex + 1] = green;
        target.color[byteIndex + 2] = blue;
        target.color[byteIndex + 3] = 255;
      }
    }
    if (currentX === endX && currentY === endY) break;
    const doubleError = 2 * error;
    if (doubleError > -deltaY) {
      error -= deltaY;
      currentX += stepX;
    }
    if (doubleError < deltaX) {
      error += deltaX;
      currentY += stepY;
    }
    step += 1;
  }
}
