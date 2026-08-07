/**
 * Texto SDF dentro del framebuffer del motor.
 *
 * El rótulo clásico (`agent/bitmapFont.ts`) escala glifos 5×7 con rectángulos
 * rellenos: cada píxel de fuente se convierte en un bloque de `scale²` píxeles de
 * pantalla, y las aristas quedan escalonadas —aceptable en un pliego de 320 px,
 * evidente en un cartel de la resolución de vídeo—.
 *
 * Esto es la alternativa nítida: cada glifo se convierte primero en un campo de
 * distancias firmado (SDF) por encima de la resolución de fuente, y al dibujar se
 * muestra con interpolación bilineal y un umbral suavizado. La arista del texto
 * queda suave a cualquier escala, sin supermuestrear el búfer final: se calcula
 * un campo por glifo una vez y se reutiliza en cada frame.
 *
 * Determinismo: todo el cálculo es aritmética entera más `Math.sqrt` sobre
 * distancias enteras; sin dependencia del motor, del navegador ni del tiempo.
 */

import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyphColumn } from "./font";

/** Supermuestreo del campo de distancias respecto a la malla 5×7. */
const FIELD_SCALE = 8;
/** Márgenes del campo alrededor del glifo, en píxeles de fuente. */
const FIELD_PAD = 2;
/** Distancia máxima guardada en el campo, en píxeles de fuente. */
const MAX_DISTANCE = FIELD_PAD + 1;

const CELL_WIDTH = (GLYPH_WIDTH + FIELD_PAD * 2) * FIELD_SCALE;
const CELL_HEIGHT = (GLYPH_HEIGHT + FIELD_PAD * 2) * FIELD_SCALE;

/** Campo de distancias de un glifo: valor firmado por píxel de campo. */
interface GlyphField {
  readonly distances: Float32Array;
  /** Distancia del borde al origen del campo, en píxeles de campo. */
  readonly originOffset: number;
}

/** Cache por carácter: el campo es caro (un barrido por píxel) y no cambia nunca. */
const fieldCache = new Map<string, GlyphField>();

/** Desplazamiento del origen del glifo dentro del campo, en píxeles de campo. */
const ORIGIN_OFFSET = FIELD_PAD * FIELD_SCALE;

/**
 * Construye el campo de distancias firmado de un glifo.
 *
 * Se calculan dos transformadas de distancia con el barrido clásico de dos
 * pasadas (Danielsson, máscara 3×3 con paso 1): `distToInk` mide de cada píxel a
 * la tinta más cercana y `distToPaper` a la superficie más cercana. El campo
 * firmado es `distToInk − distToPaper`: negativo dentro de la tinta con rampa
 * hacia el borde, positivo fuera, y cero exactamente en el borde del glifo.
 *
 * La cota se recorta a `MAX_DISTANCE` para que el campo sea finito y no contamine
 * píxeles lejanos con distancias de esquinas.
 */
function buildField(character: string): GlyphField {
  const rows = CELL_HEIGHT;
  const columns = CELL_WIDTH;
  const infinity = (MAX_DISTANCE + 1) * FIELD_SCALE;

  const isInk = (row: number, column: number): boolean => {
    const fontX = Math.floor((column - ORIGIN_OFFSET) / FIELD_SCALE);
    const fontY = Math.floor((row - ORIGIN_OFFSET) / FIELD_SCALE);
    return (
      fontX >= 0 &&
      fontX < GLYPH_WIDTH &&
      fontY >= 0 &&
      fontY < GLYPH_HEIGHT &&
      (glyphColumn(character, fontX) & (1 << fontY)) !== 0
    );
  };

  /** Transformada de distancia: `seed(row,column)` es 0, el resto +∞, dos pasadas. */
  const chamfer = (seed: (row: number, column: number) => boolean): Float32Array => {
    const distance = new Float32Array(rows * columns);
    for (let index = 0; index < distance.length; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      distance[index] = seed(row, column) ? 0 : infinity;
    }

    const propagate = (rowStart: number, rowEnd: number, rowStep: number, colStart: number, colEnd: number, colStep: number): void => {
      for (let row = rowStart; row !== rowEnd; row += rowStep) {
        for (let column = colStart; column !== colEnd; column += colStep) {
          const index = row * columns + column;
          if (distance[index] === 0) continue;
          let nearest = distance[index];
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dy === 0 && dx === 0) continue;
              const previousRow = row + dy;
              const previousColumn = column + dx;
              if (
                previousRow < 0 ||
                previousRow >= rows ||
                previousColumn < 0 ||
                previousColumn >= columns
              ) {
                continue;
              }
              nearest = Math.min(nearest, distance[previousRow * columns + previousColumn] + 1);
            }
          }
          distance[index] = nearest;
        }
      }
    };

    // Pasada hacia delante (arriba-izquierda) y hacia atrás (abajo-derecha).
    propagate(0, rows, 1, 0, columns, 1);
    propagate(rows - 1, -1, -1, columns - 1, -1, -1);
    return distance;
  };

  const distToInk = chamfer((row, column) => isInk(row, column));
  const distToPaper = chamfer((row, column) => !isInk(row, column));

  const signed = new Float32Array(rows * columns);
  for (let index = 0; index < signed.length; index += 1) {
    signed[index] = distToInk[index] - distToPaper[index];
  }

  return { distances: signed, originOffset: ORIGIN_OFFSET };
}

function fieldFor(character: string): GlyphField {
  let field = fieldCache.get(character);
  if (field === undefined) {
    field = buildField(character);
    fieldCache.set(character, field);
  }
  return field;
}

export interface TextRun {
  readonly text: string;
  /** Escala: píxeles de pantalla por píxel de fuente (5×7). */
  readonly scale: number;
  /** Color del texto en RGB 0-255. */
  readonly color: readonly [number, number, number];
}

/** Muestra el campo con interpolación bilineal en coordenadas de campo. */
function sampleField(field: GlyphField, x: number, y: number): number {
  const columns = CELL_WIDTH;
  const rows = CELL_HEIGHT;
  const clampedX = Math.min(columns - 1.001, Math.max(0, x));
  const clampedY = Math.min(rows - 1.001, Math.max(0, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(columns - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const top = field.distances[y0 * columns + x0] * (1 - fx) + field.distances[y0 * columns + x1] * fx;
  const bottom =
    field.distances[y1 * columns + x0] * (1 - fx) + field.distances[y1 * columns + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Pinta texto SDF en un búfer RGBA, escalado sin escalones.
 *
 * `originX/originY` son la esquina superior izquierda del texto en píxeles de
 * pantalla. La cobertura por píxel es el umbral suavizado del campo de
 * distancias: el borde cae en un tramo de ~1 píxel de pantalla a cualquier
 * escala, por eso el texto se ve nítido tanto a escala 1 como a escala 24.
 */
export function drawSDFText(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  originX: number,
  originY: number,
  run: TextRun,
  rowOffset = 0,
): void {
  const { scale, color } = run;
  const upper = run.text.toUpperCase();
  if (upper.length === 0) return;

  const textWidth = (upper.length * GLYPH_ADVANCE - 1) * scale;
  const textHeight = GLYPH_HEIGHT * scale;
  const bandTop = rowOffset;
  const bandBottom = rowOffset + imageHeight;
  // Recto de pantalla del texto, y su intersección con la banda. Un título que
  // cae entero por encima de la banda no debe dibujar nada.
  const screenTop = Math.max(originY, bandTop);
  const screenBottom = Math.min(originY + textHeight, bandBottom);
  if (screenTop >= screenBottom) return;
  const left = Math.max(0, originX);
  const right = Math.min(imageWidth, originX + textWidth);
  if (left >= right) return;
  const top = screenTop - bandTop;

  // La distancia viene en píxeles de fuente. Cobertura 1 dentro, 0 fuera, con la
  // rampa alrededor del borde (distancia 0) de ancho medio píxel de pantalla a
  // cada lado, sea cual sea la escala.
  const coverageScale = scale / FIELD_SCALE;

  for (let row = top; row < top + (screenBottom - screenTop); row += 1) {
    const fontY = (row + 0.5 + bandTop - originY) / scale; // coordenadas de fuente (5×7)
    const fieldY = (fontY + FIELD_PAD) * FIELD_SCALE;
    if (fieldY < 0 || fieldY >= CELL_HEIGHT) continue;
    for (let column = left; column < right; column += 1) {
      // Centro del píxel, no su esquina: muestrear la esquina desplaza la tinta
      // media píxel y un glifo de un píxel de ancho queda a media cobertura.
      const fontX = (column + 0.5 - originX) / scale; // coordenadas de fuente (5×7)
      const characterIndex = Math.floor(fontX / GLYPH_ADVANCE);
      if (characterIndex < 0 || characterIndex >= upper.length) continue;

      const localX = fontX - characterIndex * GLYPH_ADVANCE;
      const fieldX = (localX + FIELD_PAD) * FIELD_SCALE;
      if (fieldX < 0 || fieldX >= CELL_WIDTH) continue;

      const distance = sampleField(fieldFor(upper[characterIndex]), fieldX, fieldY);

      const coverage = Math.min(1, Math.max(0, 0.5 - distance * coverageScale));
      if (coverage === 0) continue;

      const index = (row * imageWidth + column) * 4;
      pixels[index] += (color[0] - pixels[index]) * coverage;
      pixels[index + 1] += (color[1] - pixels[index + 1]) * coverage;
      pixels[index + 2] += (color[2] - pixels[index + 2]) * coverage;
    }
  }
}