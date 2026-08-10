/**
 * Tipografía de mapa de bits 5×7, para escribir dentro de la propia imagen.
 *
 * Existe por una fricción concreta: un agente mira el pliego sin nada al lado que
 * le diga qué tile es cuál. Con el array `grid` en el informe y la imagen en otro
 * sitio, correlacionar los seis tiles es un ejercicio de memoria que sale mal —me
 * salió mal varias veces—. Un rótulo quemado en el píxel elimina el problema de
 * raíz: la respuesta viaja dentro de la pregunta.
 *
 * La tabla de glifos vive en `../font` (núcleo) y se hace pública además por aquí
 * porque el rótulo es la vía histórica; el texto SDF nuevo está en `../text`.
 */

export {
  GLYPH_WIDTH,
  GLYPH_HEIGHT,
  GLYPH_ADVANCE,
  GLYPH_ORDER,
  GLYPH_BITS,
  glyphColumn,
} from "../font";

import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyphColumn } from "../font";

/** Ancho en píxeles del texto completo, sin la caja de fondo. */
export function measureText(text: string, scale = 1): number {
  return text.length > 0 ? (text.length * GLYPH_ADVANCE - 1) * scale : 0;
}

const TEXT_COLOR: [number, number, number] = [236, 239, 245];
const BACKGROUND_COLOR: [number, number, number] = [8, 9, 13];
const BACKGROUND_ALPHA = 0.66;

function blend(
  pixels: Uint8ClampedArray,
  index: number,
  color: readonly [number, number, number],
  alpha: number,
): void {
  pixels[index] += (color[0] - pixels[index]) * alpha;
  pixels[index + 1] += (color[1] - pixels[index + 1]) * alpha;
  pixels[index + 2] += (color[2] - pixels[index + 2]) * alpha;
}

function fillRect(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: readonly [number, number, number],
  alpha: number,
): void {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(imageWidth, x + rectWidth);
  const bottom = Math.min(imageHeight, y + rectHeight);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      blend(pixels, (row * imageWidth + column) * 4, color, alpha);
    }
  }
}

/**
 * Rótulo con caja de fondo semitransparente, para que se lea sobre cualquier
 * color: un texto blanco sin caja desaparece contra una hélice clara.
 *
 * `maxWidth` no es un ajuste, es compensación: en un pliego los tiles son vecinos
 * y un texto largo se metería en el de al lado. Se recorta por glifos enteros.
 */
export function drawLabel(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  originX: number,
  originY: number,
  text: string,
  scale = 1,
  maxWidth = Infinity,
): void {
  const padding = 2 * scale;
  const available = Math.min(maxWidth, imageWidth - originX) - padding * 2;
  if (available < GLYPH_WIDTH * scale) return;

  const upper = text.toUpperCase();
  const fits = Math.floor((available / scale + 1) / GLYPH_ADVANCE);
  const visible = upper.slice(0, Math.min(upper.length, fits));
  if (visible.length === 0) return;

  const textWidth = measureText(visible, scale);
  fillRect(
    pixels,
    imageWidth,
    imageHeight,
    originX,
    originY,
    textWidth + padding * 2,
    GLYPH_HEIGHT * scale + padding * 2,
    BACKGROUND_COLOR,
    BACKGROUND_ALPHA,
  );

  const textX = originX + padding;
  const textY = originY + padding;
  for (let character = 0; character < visible.length; character += 1) {
    for (let column = 0; column < GLYPH_WIDTH; column += 1) {
      const bits = glyphColumn(visible[character], column);
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        if ((bits & (1 << row)) === 0) continue;
        fillRect(
          pixels,
          imageWidth,
          imageHeight,
          textX + (character * GLYPH_ADVANCE + column) * scale,
          textY + row * scale,
          scale,
          scale,
          TEXT_COLOR,
          1,
        );
      }
    }
  }
}