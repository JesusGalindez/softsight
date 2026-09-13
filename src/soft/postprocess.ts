/**
 * Antialiasing guiado por discontinuidad de profundidad.
 *
 * Por qué no la vía obvia: normalizando la función de arista por el módulo de su
 * gradiente, `d = e / √(A² + B²)`, se obtiene la distancia firmada en píxeles a
 * la arista, y de ahí una cobertura parcial `clamp(d + 0.5, 0, 1)` con la que
 * mezclar. El problema es que esa mezcla se aplicaría también a las aristas
 * *internas* de la malla: dos triángulos adyacentes cubrirían cada uno la mitad
 * del píxel, cada uno mezclaría con lo que hubiera detrás, y el fondo se
 * asomaría por todas las costuras. Hacen falta acumulación de cobertura o
 * supersampleo para resolverlo bien, y ambos cuestan mucho más.
 *
 * La discontinuidad de profundidad separa exactamente los dos casos: dentro de
 * una superficie la profundidad es continua (las aristas internas no aparecen),
 * y en una silueta salta. Detectar el salto y suavizar solo ahí da el 90 % del
 * beneficio visual con una pasada sobre el buffer y ninguna costura.
 *
 * El umbral es relativo, `|d₁-d₂| / max(d₁,d₂) > umbral`, porque la profundidad
 * invertida es aproximadamente proporcional a 1/distancia: un umbral relativo es
 * invariante a la escala de la escena, uno absoluto habría que retocarlo para
 * cada plano cercano.
 */

import type { Framebuffer } from "./framebuffer";

/**
 * La fila de cortesía que una banda necesita para suavizar su propio borde.
 *
 * El bucle de abajo recorre `y` de 1 a `height - 2` porque el píxel de la
 * primera y la última fila **no tiene vecino** arriba o abajo. Con una sola
 * banda eso es correcto: son el borde de la imagen. Partida en varias, no lo es —
 * el borde de una banda es el interior de la imagen, y esas filas se quedaban sin
 * suavizar.
 *
 * Medido antes de arreglarlo: partir 240×180 en dos bandas dejaba **15 píxeles
 * distintos, los 15 en las filas 89 y 90**, que son exactamente las dos del
 * límite. No es que se suavizaran mal: es que no se suavizaban.
 *
 * El arreglo es que cada banda **renderice una fila de más por cada lado que
 * tenga vecino** y las descarte al volcar. Con eso el bucle llega a todas sus
 * filas propias y a ninguna ajena, así que `smoothedPixels` sigue siendo exacto:
 * las filas de cortesía no se suavizan —les falta su propio vecino— y tampoco se
 * vuelcan.
 *
 * Vive aquí, al lado del bucle que lo obliga, y no en quien reparte: quien
 * reparte no tiene por qué saber que hay una pasada que mira vecinos.
 */
export function bandWithHalo(
  rowOffset: number,
  bandHeight: number,
  fullHeight: number,
): { renderOffset: number; renderHeight: number; haloTop: number } {
  const haloTop = rowOffset > 0 ? 1 : 0;
  const haloBottom = rowOffset + bandHeight < fullHeight ? 1 : 0;
  return {
    renderOffset: rowOffset - haloTop,
    renderHeight: bandHeight + haloTop + haloBottom,
    haloTop,
  };
}

let scratchColor = new Uint8ClampedArray(0);

export function applyDepthEdgeAntialias(target: Framebuffer, threshold = 0.02): number {
  const { width, height, color, depth } = target;
  if (scratchColor.length !== color.length) scratchColor = new Uint8ClampedArray(color.length);
  scratchColor.set(color);

  let smoothedPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = depth[index];

      const left = depth[index - 1];
      const right = depth[index + 1];
      const up = depth[index - width];
      const down = depth[index + width];

      const maxNeighbour = Math.max(left, right, up, down, center);
      if (maxNeighbour <= 0) continue; // fondo puro: nada que suavizar

      const difference = Math.max(
        Math.abs(center - left),
        Math.abs(center - right),
        Math.abs(center - up),
        Math.abs(center - down),
      );
      if (difference / maxNeighbour <= threshold) continue;

      // Cruz de 5 muestras, centro con peso 4: suaviza el escalón sin lavar la
      // silueta entera.
      const byteIndex = index * 4;
      const leftByte = (index - 1) * 4;
      const rightByte = (index + 1) * 4;
      const upByte = (index - width) * 4;
      const downByte = (index + width) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        color[byteIndex + channel] =
          (scratchColor[byteIndex + channel] * 4 +
            scratchColor[leftByte + channel] +
            scratchColor[rightByte + channel] +
            scratchColor[upByte + channel] +
            scratchColor[downByte + channel]) /
          8;
      }
      smoothedPixels += 1;
    }
  }

  return smoothedPixels;
}
