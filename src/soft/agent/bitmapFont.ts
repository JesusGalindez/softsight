/**
 * Tipografía de mapa de bits 5×7, para escribir dentro de la propia imagen.
 *
 * Existe por una fricción concreta: un agente mira el pliego sin nada al lado que
 * le diga qué tile es cuál. Con el array `grid` en el informe y la imagen en otro
 * sitio, correlacionar los seis tiles es un ejercicio de memoria que sale mal —me
 * salió mal varias veces—. Un rótulo quemado en el píxel elimina el problema de
 * raíz: la respuesta viaja dentro de la pregunta.
 *
 * Cada glifo son cinco columnas y una columna es un byte con siete bits útiles,
 * el bit 0 arriba. La tabla entera cabe en una cadena hexadecimal, así que no hay
 * fichero de fuente que cargar, ni dependencia, ni activo binario que versionar.
 */

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Ancho del glifo más un píxel de separación. */
const ADVANCE = GLYPH_WIDTH + 1;

// Solo mayúsculas, dígitos y los signos que usan los rótulos. Lo que falte se
// dibuja como `?`: un hueco silencioso haría creer que el texto dice otra cosa.
const GLYPH_ORDER = " .,:-/=·%?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GLYPH_BITS =
  "0000000000" + "0060600000" + "0050300000" + "0036360000" + "0808080808" +
  "2010080402" + "1414141414" + "0000080000" + "2313086462" + "0201510906" +
  "3E5149453E" + "00427F4000" + "4261514946" + "2141454B31" + "1814127F10" +
  "2745454539" + "3C4A494930" + "0171090503" + "3649494936" + "064949291E" +
  "7E1111117E" + "7F49494936" + "3E41414122" + "7F4141221C" + "7F49494941" +
  "7F09090901" + "3E4149497A" + "7F0808087F" + "00417F4100" + "2040413F01" +
  "7F08142241" + "7F40404040" + "7F020C027F" + "7F0408107F" + "3E4141413E" +
  "7F09090906" + "3E4151215E" + "7F09192946" + "4649494931" + "01017F0101" +
  "3F4040403F" + "1F2040201F" + "3F4038403F" + "6314081463" + "0708700807" +
  "6151494543";

const FALLBACK_INDEX = GLYPH_ORDER.indexOf("?");

function glyphColumn(character: string, column: number): number {
  const found = GLYPH_ORDER.indexOf(character);
  const index = found >= 0 ? found : FALLBACK_INDEX;
  const offset = (index * GLYPH_WIDTH + column) * 2;
  return Number.parseInt(GLYPH_BITS.slice(offset, offset + 2), 16);
}

/** Ancho en píxeles del texto completo, sin la caja de fondo. */
export function measureText(text: string, scale = 1): number {
  return text.length > 0 ? (text.length * ADVANCE - 1) * scale : 0;
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
 * Rótulo con caja de fondo semiopaca, para que se lea sobre cualquier color: un
 * texto blanco sin caja desaparece contra una hélice clara.
 *
 * `maxWidth` no es un ajuste, es corrección: en un pliego los tiles son vecinos y
 * un texto largo se metería en el de al lado. Se recorta por glifos enteros.
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
  const fits = Math.floor((available / scale + 1) / ADVANCE);
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
          textX + (character * ADVANCE + column) * scale,
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
