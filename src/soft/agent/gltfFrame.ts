/**
 * La frontera con glTF: dónde empiezan sus convenciones y dónde acaban.
 *
 * Este repositorio tiene **dos lectores de GLB** y es a propósito: `glbLoader.ts`
 * aplana el árbol en piezas para rasterizar y `animation.ts` lo conserva para
 * evaluar poses. Unificarlos entero es B-R2 del mapa §5, aparcado con motivo: la
 * refactorización arriesga las 296 piezas del dron sin que nadie la pida.
 *
 * Lo que **no** puede estar dos veces es la conversión de convenciones, y eso es
 * lo que vive aquí. D32 lo dice con todas las letras: la conversión entre la
 * convención canónica y la de glTF ocurre **exactamente una vez**, en el
 * adaptador de frontera, y la regla es semántica, no «el cargador transpone y el
 * exportador transpone». Dos transposiciones sin dueño se cancelan o se duplican
 * sin que nada salte —el riesgo R13 del contrato—, y una malla transpuesta dos
 * veces se ve *bien*: es la misma malla.
 *
 * ```text
 * glTF          matrix por columnas, cuaternión (x, y, z, w)
 * canónico      por filas, traslación en 3, 7 y 11, vectores columna
 * ```
 *
 * ## Por qué escribe en un destino en vez de devolver una matriz
 *
 * Los dos lados trabajan con precisiones distintas y **no se tocan**: el
 * rasterizador usa `Float32Array` porque es lo que consume el pipeline, y el
 * evaluador de animación usa `number[]` —float64— porque sus hashes de pose están
 * certificados con esa precisión. Devolver un tipo obligaría a convertir en uno
 * de los dos, y convertir mueve bits. Aquí se escribe en el destino que traiga
 * cada uno y ninguna cifra cambia.
 */

/** Destino de una matriz: vale un `Float32Array` o una lista de números. */
export interface MatrixTarget {
  [index: number]: number;
}

/** `glTF` en little-endian, la firma de los cuatro primeros bytes. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export interface GlbChunks {
  /** El documento glTF del bloque JSON, sin interpretar. */
  document: unknown;
  /** El bloque BIN, o `null` si el GLB no lo trae. */
  binary: Uint8Array | null;
}

/**
 * La cáscara del contenedor: firma, versión y bloques.
 *
 * Solo el contenedor. Qué extensiones se admiten, si vale más de una escena o si
 * el búfer puede ser externo son decisiones de **cada** consumidor —el
 * rasterizador y el evaluador no admiten lo mismo— y meterlas aquí las
 * convertiría en una política única que ninguno de los dos pidió.
 */
export function readGlbChunks(buffer: ArrayBuffer): GlbChunks {
  const header = new DataView(buffer);
  if (header.byteLength < 20 || header.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("no es un GLB: falta la firma 'glTF'");
  }
  const version = header.getUint32(4, true);
  if (version !== 2) throw new Error(`versión de glTF ${version} no soportada (se espera 2)`);

  let offset = 12;
  let document: unknown = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= header.byteLength) {
    const chunkLength = header.getUint32(offset, true);
    const chunkType = header.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
    } else if (chunkType === CHUNK_BIN) {
      binary = new Uint8Array(buffer, start, chunkLength);
    }
    // Los bloques van alineados a 4 bytes.
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }

  if (document === null) throw new Error("GLB sin bloque JSON");
  return { document, binary };
}

/**
 * La matriz `matrix` de un nodo glTF, transpuesta al orden canónico.
 *
 * **Es la única transposición del repositorio.** Si aparece otra, las dos se
 * cancelan y la geometría sale bien colocada por casualidad hasta que una de las
 * dos rutas cambie.
 */
export function writeMatrixFromGltf(values: ArrayLike<number>, out: MatrixTarget): void {
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      out[row * 4 + column] = values[column * 4 + row] ?? 0;
    }
  }
}

/**
 * La vuelta: del orden canónico al de glTF, para escribir un documento.
 *
 * Va **al lado de la de ida y no en el escritor**, que es lo que la regla de D32
 * quiere decir con «semántica y no “el cargador transpone y el exportador
 * transpone”»: las dos direcciones de una misma frontera se leen juntas, y quien
 * cambie una ve la otra.
 */
export function writeMatrixToGltf(matrix: ArrayLike<number>, out: MatrixTarget, offset = 0): void {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out[offset + column * 4 + row] = matrix[row * 4 + column];
  }
}

/**
 * Traslación, rotación y escala de un nodo glTF, compuestas en la matriz
 * canónica.
 *
 * El cuaternión llega en orden `(x, y, z, w)` —glTF lo guarda así y casi todo lo
 * demás en gráficos también, salvo COLMAP, que usa `(w, x, y, z)`— y la rotación
 * se expande sin senos ni cosenos: cada término sale de productos de las
 * componentes.
 */
export function writeMatrixFromGltfTrs(
  translation: readonly number[],
  rotation: readonly number[],
  scale: readonly number[],
  out: MatrixTarget,
): void {
  const [tx, ty, tz] = translation;
  const [qx, qy, qz, qw] = rotation;
  const [sx, sy, sz] = scale;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy - wz) * sy;
  out[2] = (xz + wy) * sz;
  out[3] = tx;
  out[4] = (xy + wz) * sx;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz - wx) * sz;
  out[7] = ty;
  out[8] = (xz - wy) * sx;
  out[9] = (yz + wx) * sy;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = tz;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
}
