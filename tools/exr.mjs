/**
 * EXR del lado de los ficheros: el `inflate` que el lector de `src/` necesita, y
 * un escritor mínimo para fabricar mapas de profundidad de prueba.
 *
 * El lector (`src/soft/agent/reconstruction/exr.ts`) no importa `node:zlib`, para
 * poder correr en el navegador: recibe la descompresión por parámetro, y aquí se
 * le da la de Node.
 *
 * El escritor hace lo justo que el lector admite —scanline, NO_COMPRESSION o ZIP,
 * canales HALF o FLOAT— y la cabecera que la especificación exige, con todos sus
 * atributos obligatorios, para que el fichero sea un EXR de verdad y no solo uno
 * que nuestro lector acepta. Que los dos sean del mismo autor no prueba nada por sí
 * solo; por eso `test:residuals` comprueba además un fichero ensamblado byte a
 * byte con los valores calculados a mano.
 */

import { deflateSync, inflateSync } from "node:zlib";

/** Lo que el lector necesita para leer ZIP y ZIPS. */
export const zlibInflate = (data) => new Uint8Array(inflateSync(data));

const COMPRESSION_CODES = { NO_COMPRESSION: 0, ZIPS: 2, ZIP: 3 };
const LINES_PER_BLOCK = { NO_COMPRESSION: 1, ZIPS: 1, ZIP: 16 };

/** Número a HALF de IEEE 754, redondeando al más cercano. */
export function floatToHalf(value) {
  const f32 = new Float32Array([value]);
  const bits = new Uint32Array(f32.buffer)[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (Number.isNaN(value)) return 0x7e00;
  if (exponent >= 0x1f) return sign | 0x7c00;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const shifted = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((shifted + 0x1000) >> 13);
  }
  // Suma y no `|`: si el redondeo desborda la mantisa, el acarreo sube el
  // exponente, que es lo correcto —y en el último exponente lleva a infinito—.
  return sign | ((exponent << 10) + ((mantissa + 0x1000) >> 13));
}

function attribute(name, type, value) {
  return Buffer.concat([Buffer.from(`${name}\0${type}\0`, "latin1"), int32(value.length), value]);
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

function float32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value);
  return buffer;
}

/** El inverso del ZIP de OpenEXR: repartir en dos mitades, diferencias, zlib. */
function zip(raw) {
  const half = (raw.length + 1) >> 1;
  const split = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    if (index % 2 === 0) split[index >> 1] = raw[index];
    else split[half + (index >> 1)] = raw[index];
  }
  const predicted = new Uint8Array(split.length);
  predicted[0] = split[0];
  for (let index = 1; index < split.length; index += 1) {
    predicted[index] = (split[index] - split[index - 1] + 128 + 256) & 0xff;
  }
  return new Uint8Array(deflateSync(predicted));
}

/**
 * Escribe un EXR de una sola parte.
 *
 * `channels`: `[{ name, type: "HALF" | "FLOAT", values }]`, cada uno con
 * `width × height` valores en orden de fila. Se ordenan por nombre, que es lo que
 * la especificación pide.
 */
export function writeExr({ width, height, channels, compression = "ZIP" }) {
  const sorted = [...channels].sort((a, b) => (a.name < b.name ? -1 : 1));
  const channelList = Buffer.concat([
    ...sorted.map((channel) =>
      Buffer.concat([
        Buffer.from(`${channel.name}\0`, "latin1"),
        int32(channel.type === "HALF" ? 1 : 2),
        Buffer.from([0, 0, 0, 0]),
        int32(1),
        int32(1),
      ]),
    ),
    Buffer.from([0]),
  ]);
  const box = Buffer.concat([int32(0), int32(0), int32(width - 1), int32(height - 1)]);
  const header = Buffer.concat([
    Buffer.from([0x76, 0x2f, 0x31, 0x01]),
    int32(2),
    attribute("channels", "chlist", channelList),
    attribute("compression", "compression", Buffer.from([COMPRESSION_CODES[compression]])),
    attribute("dataWindow", "box2i", box),
    attribute("displayWindow", "box2i", box),
    attribute("lineOrder", "lineOrder", Buffer.from([0])),
    attribute("pixelAspectRatio", "float", float32(1)),
    attribute("screenWindowCenter", "v2f", Buffer.concat([float32(0), float32(0)])),
    attribute("screenWindowWidth", "float", float32(1)),
    Buffer.from([0]),
  ]);

  const linesPerBlock = LINES_PER_BLOCK[compression];
  const blocks = [];
  for (let first = 0; first < height; first += linesPerBlock) {
    const lines = Math.min(linesPerBlock, height - first);
    const parts = [];
    for (let line = 0; line < lines; line += 1) {
      for (const channel of sorted) {
        const size = channel.type === "HALF" ? 2 : 4;
        const buffer = Buffer.alloc(size * width);
        for (let column = 0; column < width; column += 1) {
          const value = channel.values[(first + line) * width + column];
          if (channel.type === "HALF") buffer.writeUInt16LE(floatToHalf(value), column * 2);
          else buffer.writeFloatLE(value, column * 4);
        }
        parts.push(buffer);
      }
    }
    const raw = Buffer.concat(parts);
    let data = raw;
    if (compression !== "NO_COMPRESSION") {
      const packed = zip(raw);
      // Como manda la especificación: si comprimido ocupa más, va tal cual.
      if (packed.length < raw.length) data = Buffer.from(packed);
    }
    blocks.push(Buffer.concat([int32(first), int32(data.length), data]));
  }

  const tableSize = blocks.length * 8;
  let position = header.length + tableSize;
  const table = Buffer.alloc(tableSize);
  blocks.forEach((block, index) => {
    table.writeBigUInt64LE(BigInt(position), index * 8);
    position += block.length;
  });
  return Buffer.concat([header, table, ...blocks]);
}
