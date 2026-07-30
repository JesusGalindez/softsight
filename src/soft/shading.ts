/**
 * Shaders de píxel. Cada uno recibe los varyings ya interpolados con corrección
 * de perspectiva, el `w` del píxel (distancia de vista, útil para filtrado) y
 * escribe RGB **lineal** en [0,1]. La gamma y el dither los aplica el
 * rasterizador al cuantizar a 8 bits, en un solo sitio.
 *
 * Layout de varyings (ver clip.ts, VARYING_COUNT = 8):
 *   0..2  posición en mundo
 *   3..5  normal en mundo (sin normalizar: la interpolación acorta el vector)
 *   6..7  coordenadas UV
 *   8..10 coordenadas en espacio de luz, solo si hay mapa de sombras
 */

import type { ShadowMap } from "./shadowMap";

export interface Light {
  /** Dirección *hacia* la luz, normalizada. Constante por frame. */
  direction: [number, number, number];
  color: [number, number, number];
  intensity: number;
}

export interface Material {
  albedo: [number, number, number];
  specular: number;
  /** Exponente entero: se evalúa por elevaciones al cuadrado, no con `pow`. */
  shininess: number;
  checker: boolean;
  checkerScale: number;
  /** Lado de una casilla del tablero en unidades de mundo, para el filtrado. */
  checkerTileWorldSize: number;
}

export interface ShadingContext {
  light: Light;
  /**
   * Ambiente hemisférico: color del cielo (arriba) y del rebote del suelo (abajo).
   *
   * Un ambiente de color plano da a todas las superficies la misma luz indirecta
   * mirando donde miren, así que cualquier cara que no vea la luz directa queda
   * exactamente igual de muerta que las demás y el objeto se lee como una silueta
   * oscura. En el mundo real la luz indirecta viene sobre todo de arriba —el cielo—
   * y rebota del suelo con su color. Interpolar entre ambos según la componente Y de
   * la normal cuesta una multiplicación y tres mezclas por píxel, y es la diferencia
   * entre una cara en sombra que se ve y una que es un agujero negro.
   */
  ambient: [number, number, number];
  ambientGround: [number, number, number];
  cameraPosition: [number, number, number];
  /** Neblina por distancia: oculta el plano lejano sin más geometría. */
  fogColor: [number, number, number];
  fogDensity: number;
  /**
   * Tamaño en mundo de un píxel a distancia de vista 1. Multiplicado por `w` da
   * la huella real del píxel, que es lo que permite filtrar la textura.
   */
  pixelWorldSizePerUnitDepth: number;
  /** Mapa de sombras ya rasterizado, o null si están desactivadas. */
  shadowMap: ShadowMap | null;
}

export type ShadingMode = "lit" | "normals" | "depth" | "uv" | "albedo";

/** Media del tablero: el color al que converge cuando la casilla baja de un píxel. */
const CHECKER_MEAN = (1 + 0.42) / 2;

/**
 * Exponenciación por cuadrados. `Math.pow` con exponente arbitrario pasa por
 * exp/log; con exponente entero bastan ~log₂(n) multiplicaciones: 7 para 128.
 */
function integerPower(base: number, exponent: number): number {
  let result = 1;
  let factor = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining & 1) result *= factor;
    factor *= factor;
    remaining >>= 1;
  }
  return result;
}

/**
 * Blinn-Phong con tablero procedural filtrado.
 *
 * Tres decisiones de coste por píxel:
 *
 * - Semivector en vez del reflejado de Phong: una resta y una normalización
 *   menos.
 * - Neblina racional `f = kd/(1+kd)` en vez de `1-exp(-kd)`. Misma forma
 *   (0 en el origen, asíntota en 1, monótona), una división en vez de una
 *   exponencial. La curva no es idéntica; la densidad se retoca y ya.
 * - Filtrado del tablero por huella de píxel. Cuando la casilla proyectada baja
 *   de un píxel, muestrear da moiré: no hay una respuesta correcta porque falta
 *   información. Se mezcla hacia la media del patrón con
 *   `t = clamp(huella / ladoCasilla, 0, 1)`, que es el mismo razonamiento que un
 *   mipmap pero calculado analíticamente y sin memoria.
 *
 *   La huella no depende solo de la distancia. Sobre una superficie vista de
 *   frente el píxel cubre `w · tamañoPíxelPorUnidad`; vista a ángulo rasante ese
 *   mismo píxel se estira sobre la superficie por el factor 1/|N·V|, y en el
 *   límite del horizonte tiende a infinito. Ese término es justo el que causa el
 *   moiré del suelo, y medirlo lo confirmó: sin él el fundido no llegaba a
 *   activarse en toda la escena. Es el mismo problema que resuelve el filtrado
 *   anisótropo en una GPU, aquí con una división.
 */
function createLitShader(material: Material, context: ShadingContext) {
  const {
    light,
    ambient,
    ambientGround,
    cameraPosition,
    fogColor,
    fogDensity,
    pixelWorldSizePerUnitDepth,
    shadowMap,
  } = context;
  // La mitad del exponente, porque se evalúa sobre el coseno **al cuadrado**. Un
  // exponente impar se redondea al par más próximo; con los valores habituales
  // —12, 32, 48, 64, 96, 128, 140— la equivalencia es exacta.
  const halfShininess = Math.max(1, Math.round(material.shininess / 2));
  const checkerFadeScale = pixelWorldSizePerUnitDepth / Math.max(1e-6, material.checkerTileWorldSize);

  return (varyings: Float32Array, w: number, outRgb: Float32Array): void => {
    const worldX = varyings[0];
    const worldY = varyings[1];
    const worldZ = varyings[2];

    let nx = varyings[3];
    let ny = varyings[4];
    let nz = varyings[5];
    const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;

    const lambert = Math.max(
      0,
      nx * light.direction[0] + ny * light.direction[1] + nz * light.direction[2],
    );

    let viewX = cameraPosition[0] - worldX;
    let viewY = cameraPosition[1] - worldY;
    let viewZ = cameraPosition[2] - worldZ;
    const viewDistance = Math.sqrt(viewX * viewX + viewY * viewY + viewZ * viewZ) || 1;
    viewX /= viewDistance;
    viewY /= viewDistance;
    viewZ /= viewDistance;

    let albedoR = material.albedo[0];
    let albedoG = material.albedo[1];
    let albedoB = material.albedo[2];

    if (material.checker) {
      const u = varyings[6] * material.checkerScale;
      const v = varyings[7] * material.checkerScale;
      const tile = (Math.floor(u) + Math.floor(v)) & 1;
      let shade = tile === 0 ? 1 : 0.42;

      // Suelo del término rasante a 0.12, no a 0.02: con 0.02 la huella se
      // multiplicaba por 50 al acercarse al horizonte, y píxeles vecinos caían a
      // lados distintos del corte según el frame, lo que se percibe como centelleo.
      const grazing = Math.abs(nx * viewX + ny * viewY + nz * viewZ);
      const footprint = (w * checkerFadeScale) / (grazing < 0.12 ? 0.12 : grazing);
      // Transición suave (smoothstep) en vez de corte duro y rampa lineal: la
      // derivada se anula en los dos extremos, así que no queda ninguna arista
      // visible donde empieza o acaba el fundido.
      if (footprint > 0.25) {
        const t = footprint >= 1 ? 1 : (footprint - 0.25) / 0.75;
        const fade = t * t * (3 - 2 * t);
        shade += (CHECKER_MEAN - shade) * fade;
      }

      albedoR *= shade;
      albedoG *= shade;
      albedoB *= shade;
    }

    let specular = 0;
    if (lambert > 0 && material.specular > 0) {
      // Especular sin normalizar el semivector. `pow(dot(N,Ĥ), s)` con
      // `Ĥ = H/|H|` es igual a `pow(dot(N,H)² / |H|², s/2)`, y trabajando con la
      // cantidad al cuadrado y la mitad del exponente desaparecen una raíz y tres
      // divisiones por píxel. No es una aproximación: es la misma expresión.
      const halfX = light.direction[0] + viewX;
      const halfY = light.direction[1] + viewY;
      const halfZ = light.direction[2] + viewZ;
      const nDotH = nx * halfX + ny * halfY + nz * halfZ;
      if (nDotH > 0) {
        const halfLengthSquared = halfX * halfX + halfY * halfY + halfZ * halfZ;
        const cosineSquared = (nDotH * nDotH) / halfLengthSquared;
        specular = material.specular * integerPower(cosineSquared, halfShininess);
      }
    }

    // La sombra atenúa solo la luz directa. El ambiente representa la luz que llega
    // rebotada de todas partes, y multiplicarlo también dejaría las sombras en negro
    // absoluto, que es el error que hace que un render parezca de 1996.
    // Solo se consulta si la superficie mira a la luz: si no, ya está oscura.
    // Las coordenadas de luz llegan ya interpoladas por el rasterizador; el
    // desplazamiento por normal se aplicó en la etapa de vértices.
    const shadow = shadowMap !== null && lambert > 0
      ? shadowMap.sampleAt(varyings[8], varyings[9], varyings[10])
      : 1;
    if (shadow < 1) specular *= shadow;

    const direct = light.intensity * lambert * shadow;
    const diffuseR = light.color[0] * direct;
    const diffuseG = light.color[1] * direct;
    const diffuseB = light.color[2] * direct;

    // Mezcla hemisférica: 1 mirando al cielo, 0 mirando al suelo.
    const hemisphere = ny * 0.5 + 0.5;
    const ambientR = ambientGround[0] + (ambient[0] - ambientGround[0]) * hemisphere;
    const ambientG = ambientGround[1] + (ambient[1] - ambientGround[1]) * hemisphere;
    const ambientB = ambientGround[2] + (ambient[2] - ambientGround[2]) * hemisphere;

    let red = albedoR * (ambientR + diffuseR) + specular;
    let green = albedoG * (ambientG + diffuseG) + specular;
    let blue = albedoB * (ambientB + diffuseB) + specular;

    if (fogDensity > 0) {
      const scaled = viewDistance * fogDensity;
      const fog = scaled / (1 + scaled);
      red += (fogColor[0] - red) * fog;
      green += (fogColor[1] - green) * fog;
      blue += (fogColor[2] - blue) * fog;
    }

    outRgb[0] = red;
    outRgb[1] = green;
    outRgb[2] = blue;
  };
}

function normalsShader(varyings: Float32Array, _w: number, outRgb: Float32Array): void {
  let nx = varyings[3];
  let ny = varyings[4];
  let nz = varyings[5];
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  outRgb[0] = nx * 0.5 + 0.5;
  outRgb[1] = ny * 0.5 + 0.5;
  outRgb[2] = nz * 0.5 + 0.5;
}

function uvShader(varyings: Float32Array, _w: number, outRgb: Float32Array): void {
  outRgb[0] = varyings[6] % 1;
  outRgb[1] = varyings[7] % 1;
  outRgb[2] = 0.25;
}

/**
 * Visualización de profundidad. Usa la distancia lineal reconstruida desde la
 * posición en mundo, no el valor del buffer: el buffer es hiperbólico y pintado
 * en crudo sale casi plano.
 */
function createDepthShader(context: ShadingContext) {
  const { cameraPosition } = context;
  return (varyings: Float32Array, _w: number, outRgb: Float32Array): void => {
    const dx = varyings[0] - cameraPosition[0];
    const dy = varyings[1] - cameraPosition[1];
    const dz = varyings[2] - cameraPosition[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const value = Math.max(0, Math.min(1, 1 - distance / 24));
    outRgb[0] = value;
    outRgb[1] = value * 0.85;
    outRgb[2] = value * 0.6;
  };
}

/**
 * Modo de depuración: albedo puro, sin luz. Filtra el tablero solo por
 * distancia, sin el término de ángulo rasante — la finalidad de este modo es ver
 * el patrón, no juzgar el filtrado.
 */
function createAlbedoShader(material: Material, context: ShadingContext) {
  const checkerFadeScale =
    context.pixelWorldSizePerUnitDepth / Math.max(1e-6, material.checkerTileWorldSize);
  return (varyings: Float32Array, w: number, outRgb: Float32Array): void => {
    let shade = 1;
    if (material.checker) {
      const u = varyings[6] * material.checkerScale;
      const v = varyings[7] * material.checkerScale;
      shade = ((Math.floor(u) + Math.floor(v)) & 1) === 0 ? 1 : 0.42;
      const footprint = w * checkerFadeScale;
      if (footprint > 0.25) {
        shade += (CHECKER_MEAN - shade) * (footprint > 1 ? 1 : footprint);
      }
    }
    outRgb[0] = material.albedo[0] * shade;
    outRgb[1] = material.albedo[1] * shade;
    outRgb[2] = material.albedo[2] * shade;
  };
}

export function createShader(mode: ShadingMode, material: Material, context: ShadingContext) {
  switch (mode) {
    case "normals":
      return normalsShader;
    case "uv":
      return uvShader;
    case "depth":
      return createDepthShader(context);
    case "albedo":
      return createAlbedoShader(material, context);
    default:
      return createLitShader(material, context);
  }
}
