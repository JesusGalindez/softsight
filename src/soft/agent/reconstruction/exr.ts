/**
 * Lector de OpenEXR — D5, lo justo para leer mapas de profundidad.
 *
 * D5 lo acotó así: **scanline sin comprimir o ZIP, HALF o FLOAT. PIZ, DWA y B44 se
 * rechazan por código.** No es pereza: son los compresores con pérdida o con
 * transformadas propias, y leerlos bien exige reimplementar su aritmética; leerlos
 * mal daría profundidades plausibles y falsas. El rechazo lleva el nombre del
 * compresor, para que el productor sepa qué cambiar en su exportación.
 *
 * ```text
 * admitido                 rechazado, con su código
 * NO_COMPRESSION           RLE, PIZ, PXR24, B44, B44A, DWAA, DWAB    EXR_COMPRESION_NO_SOPORTADA
 * ZIPS (1 línea), ZIP (16) teselado, multiparte, profundo           EXR_DISPOSICION_NO_SOPORTADA
 * HALF, FLOAT              UINT, y canales submuestreados           EXR_CANAL_NO_SOPORTADO
 * ```
 *
 * **Sin IO**, como el resto de esta capa: ZIP es zlib, y `src/` no puede importar
 * `node:zlib` sin dejar de correr en el navegador. Quien llama pasa `inflate`, igual
 * que la ingesta recibe el sistema de ficheros. Sin él, un EXR comprimido se
 * rechaza diciendo por qué, en vez de leerse a medias.
 *
 * Lo que un canal **significa** —que es profundidad, en qué unidad, qué valor es
 * «no medido»— no está en el fichero: lo declara el manifest (extensión
 * `org.softsight.profundidad`). Aquí solo se leen los números.
 */

/** Los valores de un canal, en orden de fila desde arriba, como los guarda el fichero. */
export interface ExrImage {
  width: number;
  height: number;
  compression: "NO_COMPRESSION" | "ZIPS" | "ZIP";
  channels: Record<string, { type: "HALF" | "FLOAT"; values: Float32Array }>;
}

export interface ExrOptions {
  /** Descompresión zlib. Sin ella, solo se leen ficheros sin comprimir. */
  inflate?: (data: Uint8Array) => Uint8Array;
}

const COMPRESSIONS = ["NO_COMPRESSION", "RLE", "ZIPS", "ZIP", "PIZ", "PXR24", "B44", "B44A", "DWAA", "DWAB"];
/** Líneas por bloque de cada compresor admitido. */
const LINES_PER_BLOCK: Record<string, number> = { NO_COMPRESSION: 1, ZIPS: 1, ZIP: 16 };
const PIXEL_TYPES = ["UINT", "HALF", "FLOAT"];

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

/** HALF de IEEE 754 a número: signo, cinco de exponente y diez de mantisa. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** Cadena terminada en cero, desde `offset`. */
function readString(bytes: Uint8Array, offset: number): [string, number] {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  if (end >= bytes.length) fail("EXR_TRUNCADO", "una cadena de la cabecera no termina");
  let text = "";
  for (let index = offset; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return [text, end + 1];
}

/**
 * Deshace el ZIP de OpenEXR: zlib, luego el predictor de diferencias y luego el
 * reparto de bytes en dos mitades que el compresor hace para que los bytes altos
 * y los bajos de cada número queden juntos.
 */
function unzip(data: Uint8Array, expected: number, inflate: NonNullable<ExrOptions["inflate"]>): Uint8Array {
  const raw = inflate(data);
  if (raw.length !== expected) {
    fail("EXR_TRUNCADO", `un bloque ZIP descomprime a ${raw.length} bytes y tenían que ser ${expected}`);
  }
  const predicted = new Uint8Array(raw);
  for (let index = 1; index < predicted.length; index += 1) {
    predicted[index] = (predicted[index - 1] + predicted[index] - 128) & 0xff;
  }
  const out = new Uint8Array(expected);
  const half = (expected + 1) >> 1;
  for (let index = 0; index < expected; index += 1) {
    out[index] = index % 2 === 0 ? predicted[index >> 1] : predicted[half + (index >> 1)];
  }
  return out;
}

export function parseExr(bytes: Uint8Array, options: ExrOptions = {}): ExrImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0, true) !== 20000630) {
    fail("EXR_FIRMA_INVALIDA", "no empieza por la firma de OpenEXR");
  }
  const version = view.getUint32(4, true);
  if ((version & 0xff) !== 2) fail("EXR_VERSION_NO_SOPORTADA", `versión de formato ${version & 0xff}; se lee la 2`);
  if (version & 0x200) fail("EXR_DISPOSICION_NO_SOPORTADA", "es teselado; se leen solo líneas (scanline)");
  if (version & 0x800) fail("EXR_DISPOSICION_NO_SOPORTADA", "lleva datos profundos (deep)");
  if (version & 0x1000) fail("EXR_DISPOSICION_NO_SOPORTADA", "es multiparte");

  // La cabecera: atributos nombre, tipo, tamaño y valor, hasta un nombre vacío.
  let offset = 8;
  const attributes = new Map<string, { type: string; start: number; size: number }>();
  for (;;) {
    const [name, afterName] = readString(bytes, offset);
    if (name === "") {
      offset = afterName;
      break;
    }
    const [type, afterType] = readString(bytes, afterName);
    if (afterType + 4 > bytes.length) fail("EXR_TRUNCADO", `el atributo ${name} no cabe`);
    const size = view.getInt32(afterType, true);
    const start = afterType + 4;
    if (size < 0 || start + size > bytes.length) fail("EXR_TRUNCADO", `el atributo ${name} no cabe`);
    attributes.set(name, { type, start, size });
    offset = start + size;
  }
  for (const required of ["channels", "compression", "dataWindow"]) {
    if (!attributes.has(required)) fail("EXR_CABECERA_INCOMPLETA", `falta el atributo ${required}`);
  }

  const compressionCode = bytes[attributes.get("compression")!.start];
  const compression = COMPRESSIONS[compressionCode] ?? `código ${compressionCode}`;
  if (!(compression in LINES_PER_BLOCK)) {
    fail("EXR_COMPRESION_NO_SOPORTADA", `${compression}; se leen NO_COMPRESSION, ZIPS y ZIP (D5)`);
  }
  if (compression !== "NO_COMPRESSION" && options.inflate === undefined) {
    fail("EXR_COMPRESION_NO_SOPORTADA", `${compression} pide zlib, y quien llama no la ha pasado`);
  }

  const window = attributes.get("dataWindow")!.start;
  const xMin = view.getInt32(window, true);
  const yMin = view.getInt32(window + 4, true);
  const xMax = view.getInt32(window + 8, true);
  const yMax = view.getInt32(window + 12, true);
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  if (width <= 0 || height <= 0) fail("EXR_CABECERA_INCOMPLETA", `ventana de datos vacía: ${width}×${height}`);

  // Los canales, en el orden del fichero, que es el alfabético.
  const channelList: Array<{ name: string; type: "HALF" | "FLOAT"; size: number }> = [];
  const { start: channelStart, size: channelSize } = attributes.get("channels")!;
  let cursor = channelStart;
  while (cursor < channelStart + channelSize) {
    const [name, afterName] = readString(bytes, cursor);
    if (name === "") break;
    const typeCode = view.getInt32(afterName, true);
    const xSampling = view.getInt32(afterName + 8, true);
    const ySampling = view.getInt32(afterName + 12, true);
    cursor = afterName + 16;
    const type = PIXEL_TYPES[typeCode];
    if (type !== "HALF" && type !== "FLOAT") {
      fail("EXR_CANAL_NO_SOPORTADO", `el canal ${name} es ${type ?? `de tipo ${typeCode}`}; se leen HALF y FLOAT (D5)`);
    }
    if (xSampling !== 1 || ySampling !== 1) {
      fail("EXR_CANAL_NO_SOPORTADO", `el canal ${name} está submuestreado (${xSampling}×${ySampling})`);
    }
    channelList.push({ name, type, size: type === "HALF" ? 2 : 4 });
  }
  if (channelList.length === 0) fail("EXR_CABECERA_INCOMPLETA", "no declara ningún canal");

  const lineBytes = channelList.reduce((total, channel) => total + channel.size * width, 0);
  const linesPerBlock = LINES_PER_BLOCK[compression];
  const blocks = Math.ceil(height / linesPerBlock);
  const channels: ExrImage["channels"] = {};
  for (const channel of channelList) {
    channels[channel.name] = { type: channel.type, values: new Float32Array(width * height) };
  }

  // La tabla de desplazamientos: un entero de 64 bits por bloque, justo detrás
  // de la cabecera. Cada bloque dice además su primera línea, así que el orden de
  // las líneas (`lineOrder`) no hace falta.
  for (let block = 0; block < blocks; block += 1) {
    const entry = offset + block * 8;
    if (entry + 8 > bytes.length) fail("EXR_TRUNCADO", "la tabla de bloques no cabe");
    const position = Number(view.getBigUint64(entry, true));
    if (position + 8 > bytes.length) fail("EXR_TRUNCADO", `el bloque ${block} empieza fuera del fichero`);
    const firstLine = view.getInt32(position, true) - yMin;
    const dataSize = view.getInt32(position + 4, true);
    const data = bytes.subarray(position + 8, position + 8 + dataSize);
    if (data.length !== dataSize) fail("EXR_TRUNCADO", `el bloque ${block} está cortado`);
    const lines = Math.min(linesPerBlock, height - firstLine);
    if (firstLine < 0 || lines <= 0) fail("EXR_TRUNCADO", `el bloque ${block} declara la línea ${firstLine + yMin}`);
    const expected = lines * lineBytes;
    // Un bloque que comprimido ocupaba más que sin comprimir se guarda tal cual:
    // lo dice la especificación, y se reconoce por el tamaño.
    const raw =
      compression === "NO_COMPRESSION" || dataSize >= expected ? data : unzip(data, expected, options.inflate!);
    if (raw.length < expected) fail("EXR_TRUNCADO", `el bloque ${block} trae ${raw.length} bytes de ${expected}`);
    const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    let at = 0;
    for (let line = 0; line < lines; line += 1) {
      const row = firstLine + line;
      for (const channel of channelList) {
        const target = channels[channel.name].values;
        for (let column = 0; column < width; column += 1) {
          target[row * width + column] =
            channel.type === "HALF" ? halfToFloat(rawView.getUint16(at, true)) : rawView.getFloat32(at, true);
          at += channel.size;
        }
      }
    }
  }

  return { width, height, compression: compression as ExrImage["compression"], channels };
}
