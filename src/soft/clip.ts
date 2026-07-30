/**
 * Recortado (clipping) en espacio homogéneo, antes del divide por w.
 *
 * Solo se recorta contra el plano cercano. Los cuatro planos laterales y el
 * lejano se resuelven más barato aguas abajo: los laterales con el scissor del
 * bounding box en el rasterizador, el lejano con el test de profundidad. El
 * cercano es el único que *hay* que recortar de verdad, porque es el único que
 * puede producir un w ≤ 0 y hacer estallar la división: un triángulo que cruza
 * el plano de la cámara proyecta un vértice al infinito y, si se divide sin
 * recortar, ese vértice reaparece en el lado opuesto de la pantalla y el
 * triángulo sale doblado hacia fuera. Es el clásico artefacto de geometría
 * "estirada" al pegarse a una pared.
 *
 * En espacio de clip el plano cercano es lineal. Con el rango de profundidad
 * invertido (ver projection.ts) el plano cercano es z_ndc = +1, luego la región
 * válida es z_clip ≤ w_clip y la distancia firmada al plano es w - z. Al ser
 * lineal, la interpolación de atributos a lo largo de la arista recortada es
 * también lineal y por tanto exacta — otra razón por la que el recorte va aquí
 * y no en NDC.
 */

/**
 * Componentes por vértice: clip.xyzw + varyings.
 *
 * El número de varyings **activos** es variable: 8 en el caso base (posición en
 * mundo, normal, uv) y 11 con sombras, que añaden las coordenadas en espacio de luz.
 * Los búferes se dimensionan al máximo y cada etapa recorre solo los activos, de
 * modo que apagar las sombras no deja pagando la interpolación de tres componentes
 * que nadie lee.
 */
export const VARYING_COUNT = 8; // mundo.xyz (3) + normal.xyz (3) + uv (2)
export const SHADOW_VARYING_COUNT = 11; // + luz.xy + profundidad de luz
export const MAX_VARYING_COUNT = SHADOW_VARYING_COUNT;
export const VERTEX_STRIDE = 4 + MAX_VARYING_COUNT;

/** Distancia firmada al plano cercano en espacio de clip (rango invertido). */
function nearPlaneDistance(vertices: Float32Array, offset: number): number {
  return vertices[offset + 3] - vertices[offset + 2]; // w - z
}

/**
 * Recorta un triángulo contra el plano cercano (Sutherland–Hodgman sobre un
 * único plano). Escribe el polígono resultante en `out` y devuelve el número de
 * vértices: 0 (descartado), 3 (intacto o recortado en un vértice) o 4 (recorte
 * que produce un cuadrilátero).
 *
 * `input` contiene exactamente 3 vértices con el layout VERTEX_STRIDE.
 */
export function clipTriangleNearPlane(input: Float32Array, out: Float32Array): number {
  let insideCount = 0;
  for (let i = 0; i < 3; i += 1) {
    if (nearPlaneDistance(input, i * VERTEX_STRIDE) >= 0) insideCount += 1;
  }

  if (insideCount === 3) {
    // Camino habitual: copia directa sin asignar. `set(subarray(...))` crearía un
    // TypedArray por triángulo, y este es el caso que se ejecuta casi siempre.
    for (let component = 0; component < 3 * VERTEX_STRIDE; component += 1) {
      out[component] = input[component];
    }
    return 3;
  }
  if (insideCount === 0) return 0;

  let outCount = 0;
  for (let i = 0; i < 3; i += 1) {
    const currentOffset = i * VERTEX_STRIDE;
    const nextOffset = ((i + 1) % 3) * VERTEX_STRIDE;
    const currentDistance = nearPlaneDistance(input, currentOffset);
    const nextDistance = nearPlaneDistance(input, nextOffset);
    const currentInside = currentDistance >= 0;
    const nextInside = nextDistance >= 0;

    if (currentInside) {
      const target = outCount * VERTEX_STRIDE;
      for (let component = 0; component < VERTEX_STRIDE; component += 1) {
        out[target + component] = input[currentOffset + component];
      }
      outCount += 1;
    }

    if (currentInside !== nextInside) {
      // Punto de corte exacto: la distancia al plano es lineal en clip space.
      const t = currentDistance / (currentDistance - nextDistance);
      const target = outCount * VERTEX_STRIDE;
      for (let component = 0; component < VERTEX_STRIDE; component += 1) {
        const a = input[currentOffset + component];
        const b = input[nextOffset + component];
        out[target + component] = a + (b - a) * t;
      }
      outCount += 1;
    }
  }
  return outCount;
}
