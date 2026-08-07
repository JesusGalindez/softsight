/**
 * Tabla de glifos 5×7, en el núcleo para que el texto SDF viva dentro del
 * framebuffer del motor y no en una capa de agente.
 *
 * Cada glifo son cinco columnas y una columna es un byte con siete bits útiles,
 * el bit 0 arriba. La tabla entera cabe en una cadena hexadecimal, así que no hay
 * fichero de fuente que cargar, ni dependencia, ni activo binario que versionar.
 *
 * `agent/bitmapFont.ts` reexporta lo que usaba de aquí (rótulos del pliego); los
 * píxeles que dibuja son los mismos, la fuente no cambia.
 */

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Ancho del glifo más un píxel de separación. */
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1;

// Solo mayúsculas, dígitos y los signos que usan los rótulos. Lo que falte se
// dibuja como `?`: un hueco silencioso haría creer que el texto dice otra cosa.
export const GLYPH_ORDER = " .,:-/=·%?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const GLYPH_BITS =
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

export const GLYPH_FALLBACK_INDEX = GLYPH_ORDER.indexOf("?");

/** Bits del glifo en una columna: un byte con siete bits útiles, bit 0 arriba. */
export function glyphColumn(character: string, column: number): number {
  const found = GLYPH_ORDER.indexOf(character);
  const index = found >= 0 ? found : GLYPH_FALLBACK_INDEX;
  const offset = (index * GLYPH_WIDTH + column) * 2;
  return Number.parseInt(GLYPH_BITS.slice(offset, offset + 2), 16);
}