/**
 * PLY, el formato en el que viaja la geometría reconstruida.
 *
 * ASCII y binario little-endian, y la frase que lo ordena todo es la que ya
 * estaba escrita aquí cuando solo había ASCII: **lo que cambia es cómo se leen
 * los números, no qué significan**. Por eso la cabecera se parsea una sola vez y
 * con el mismo código para los dos, y lo único que se bifurca es el cuerpo. Dos
 * cabeceras habrían sido dos verdades sobre el mismo fichero, y la que diverge
 * siempre es la que alguien lee.
 *
 * El ASCII se queda porque es el que `cube-v1` necesita: cabe en unas líneas y se
 * lee con los ojos cuando una prueba falla. El binario entra porque un paquete
 * real lo usa —COLMAP lo escribe— y porque el mismo contenido en texto no cabe:
 * un `dense.ply` de 150 MB binarios son ~400 MB de texto, y una cadena de Node se
 * acaba antes.
 *
 * **`binary_big_endian` se rechaza por su nombre.** Soportarlo cuesta un booleano
 * y no se hace: no hay ningún fichero así con el que comprobarlo, y código que
 * nadie ha ejecutado nunca es peor que una ausencia declarada — el primero
 * promete y el segundo avisa.
 *
 * Un PLY que no se sepa leer **se rechaza diciendo por qué**. Adivinar el formato
 * es como se acaba interpretando basura como geometría.
 *
 * Y no se cree lo que la cabecera declara: los topes de `limits.ts` y la cuenta
 * de filas que el fichero trae de verdad se comprueban **antes de reservar**. Un
 * `element vertex 4000000000` en un fichero de cien bytes reservaba doce
 * gigabytes y moría sin decir por qué.
 */

import { RESOURCE_LIMITS } from "./limits";

export interface PlyMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Nube de puntos: la misma cabecera sin caras. */
export interface PlyPoints {
  positions: Float32Array;
}

/**
 * Malla en PLY ASCII, con los números tal cual salen de `Number.prototype`.
 *
 * Sin redondeo cosmético: el determinismo se consigue en el cálculo, no en la
 * serialización (D17), y recortar decimales aquí cambiaría la geometría que el
 * consumidor mide sin que nadie lo hubiera decidido.
 */
export function serializePlyMesh(mesh: PlyMesh): string {
  const vertexCount = mesh.positions.length / 3;
  const faceCount = mesh.indices.length / 3;
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment generado por softsight",
    `element vertex ${vertexCount}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${faceCount}`,
    "property list uchar int vertex_index",
    "end_header",
  ];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    lines.push(`${mesh.positions[offset]} ${mesh.positions[offset + 1]} ${mesh.positions[offset + 2]}`);
  }
  for (let face = 0; face < faceCount; face += 1) {
    const offset = face * 3;
    lines.push(`3 ${mesh.indices[offset]} ${mesh.indices[offset + 1]} ${mesh.indices[offset + 2]}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Nube de puntos en PLY ASCII. */
export function serializePlyPoints(points: PlyPoints): string {
  const count = points.positions.length / 3;
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment generado por softsight",
    `element vertex ${count}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
  ];
  for (let point = 0; point < count; point += 1) {
    const offset = point * 3;
    lines.push(
      `${points.positions[offset]} ${points.positions[offset + 1]} ${points.positions[offset + 2]}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Tipos escalares del formato, con su tamaño en bytes.
 *
 * El ASCII no los necesita —`Number("1.5")` no pregunta si el fichero decía
 * `float` o `double`— y se leen igual para los dos: la cabecera es una sola, y
 * una cabecera que solo guardase lo que el ASCII usa obligaría al binario a
 * volver a parsearla.
 */
const SCALAR_BYTES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

interface PlyProperty {
  name: string;
  list: boolean;
  /** Tipo del valor. En una lista, el de cada elemento. */
  type: string;
  /** Tipo del contador, solo en listas. */
  countType?: string;
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

interface PlyHeader {
  elements: PlyElement[];
  format: string | null;
  /** Primera línea del cuerpo, para el ASCII. */
  bodyLine: number;
}

/**
 * La cabecera, que es lo único que los dos formatos comparten entero.
 *
 * Recibe las líneas ya partidas porque el binario las saca de decodificar los
 * primeros bytes y el ASCII de partir el documento: de dónde vienen no le
 * incumbe, y pasarle el fichero entero obligaría a decodificar 150 MB de bytes
 * crudos como si fueran texto.
 */
function parseHeaderLines(lines: readonly string[]): PlyHeader {
  if (lines[0]?.trim() !== "ply") throw new Error("CABECERA_PLY_AUSENTE: el fichero no empieza por `ply`");

  const elements: PlyElement[] = [];
  let cursor = 1;
  let format: string | null = null;
  let sawEndHeader = false;
  // El tope se mira sobre el cursor y no sobre las líneas consumidas: un fichero
  // sin `end_header` recorría el documento entero buscándolo, y un PLY de un giga
  // es un documento entero.
  const headerCeiling = Math.min(lines.length, 1 + RESOURCE_LIMITS.plyHeaderLines.value);
  for (; cursor < headerCeiling; cursor += 1) {
    const line = lines[cursor].trim();
    if (line === "" || line.startsWith("comment")) continue;
    if (line === "end_header") {
      cursor += 1;
      sawEndHeader = true;
      break;
    }
    const parts = line.split(/\s+/);
    if (parts[0] === "format") {
      format = parts[1];
      continue;
    }
    if (parts[0] === "element") {
      const count = Number(parts[2]);
      // Entero, finito y no negativo. `Number("1e999")` es `Infinity` sin que
      // nadie escriba la palabra, y con él la reserva es `NaN` y el bucle no
      // termina nunca (D17).
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(
          `CABECERA_PLY_INVALIDA: el elemento ${parts[1]} declara ${JSON.stringify(parts[2])}, que no es un entero`,
        );
      }
      if (count > RESOURCE_LIMITS.plyElementCount.value) {
        throw new Error(
          `ELEMENTO_PLY_SOBRE_EL_TOPE: el elemento ${parts[1]} declara ${count} entradas y el tope son ${RESOURCE_LIMITS.plyElementCount.value}`,
        );
      }
      elements.push({ name: parts[1], count, properties: [] });
      continue;
    }
    if (parts[0] === "property") {
      const element = elements[elements.length - 1];
      if (element === undefined) throw new Error("CABECERA_PLY_INVALIDA: una propiedad antes de su elemento");
      const list = parts[1] === "list";
      element.properties.push(
        list
          ? { name: parts[parts.length - 1], list, countType: parts[2], type: parts[3] }
          : { name: parts[parts.length - 1], list, type: parts[1] },
      );
    }
  }

  if (!sawEndHeader) {
    throw new Error(
      `CABECERA_PLY_DEMASIADO_LARGA: la cabecera no termina en las primeras ${RESOURCE_LIMITS.plyHeaderLines.value} líneas`,
    );
  }

  return { elements, format, bodyLine: cursor };
}

/**
 * Lee un PLY ASCII con posiciones y, si el fichero declara el elemento, caras
 * trianguladas.
 *
 * Las caras de más de tres lados se abanican desde su primer vértice, que es la
 * triangulación que no inventa vértices ni cambia el borde. Un polígono cóncavo
 * saldría mal de ahí; cuando aparezca uno de verdad, se verá en la auditoría como
 * triángulo degenerado o normal invertida, que es mejor que rechazar el fichero
 * entero por un caso que aún no existe.
 */
export function parsePlyAscii(text: string): { mesh: PlyMesh | null; points: PlyPoints } {
  const lines = text.split(/\r?\n/);
  const { elements, format, bodyLine } = parseHeaderLines(lines);
  let cursor = bodyLine;

  if (format !== "ascii") {
    // Por su nombre y no con un fallo genérico: quien reciba esto tiene que poder
    // distinguir «no lo entiendo» de «está roto». Y quien llame aquí con un
    // binario tiene que enterarse de que se equivocó de puerta, no de que el
    // fichero está mal: la puerta única es `parsePly`.
    throw new Error(
      `FORMATO_PLY_NO_SOPORTADO: parsePlyAscii solo lee ascii y este declara ${format ?? "nada"}; ` +
        "el binario entra por parsePly",
    );
  }

  const values: string[] = [];
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor].trim();
    if (line !== "") values.push(line);
  }

  let row = 0;
  let positions: Float32Array = new Float32Array(0);
  const faces: number[] = [];
  // Declarar `element face 0` no es lo mismo que no declararlo: el primero dice
  // «esto es una malla y no tiene superficie», que es un paquete que se contradice
  // a sí mismo, y el segundo dice «esto es una nube de puntos». Distinguirlos es lo
  // que permite que el informe conteste FAIL en vez de encogerse de hombros.
  let declaresFaces = false;
  for (const element of elements) {
    // Antes de reservar y antes de indexar: el fichero dice cuántas filas trae, y
    // una cabecera que promete más de las que hay es el caso que reservaba
    // gigabytes para morir en la primera. Se decide contando, sin tocar memoria.
    if (element.count > values.length - row) {
      throw new Error(
        `PLY_TRUNCADO: el elemento ${element.name} declara ${element.count} entradas y quedan ${values.length - row} filas`,
      );
    }
    if (element.name === "vertex") {
      const names = element.properties.map((property) => property.name);
      const [x, y, z] = ["x", "y", "z"].map((axis) => names.indexOf(axis));
      if (x < 0 || y < 0 || z < 0) throw new Error("VERTICE_PLY_INVALIDO: faltan x, y o z");
      positions = new Float32Array(element.count * 3);
      for (let index = 0; index < element.count; index += 1, row += 1) {
        const parts = values[row].split(/\s+/);
        positions[index * 3] = Number(parts[x]);
        positions[index * 3 + 1] = Number(parts[y]);
        positions[index * 3 + 2] = Number(parts[z]);
      }
      continue;
    }
    if (element.name === "face") {
      declaresFaces = true;
      for (let index = 0; index < element.count; index += 1, row += 1) {
        const parts = values[row].split(/\s+/).map(Number);
        const sides = parts[0];
        for (let corner = 2; corner < sides; corner += 1) {
          faces.push(parts[1], parts[corner], parts[corner + 1]);
        }
      }
      continue;
    }
    row += element.count;
  }

  return {
    mesh: declaresFaces ? { positions, indices: Uint32Array.from(faces) } : null,
    points: { positions },
  };
}

/** Bytes de un escalar, o el fallo con su nombre. Un tipo que no se conoce no se supone. */
function scalarBytes(type: string, where: string): number {
  const bytes = SCALAR_BYTES[type];
  if (bytes === undefined) {
    throw new Error(`FORMATO_PLY_NO_SOPORTADO: ${where} declara el tipo '${type}', que no se sabe leer`);
  }
  return bytes;
}

/** Lee un escalar de `view` en `offset`. Devuelve número, que es lo que el resto usa. */
function readScalar(view: DataView, offset: number, type: string): number {
  switch (type) {
    case "char":
    case "int8":
      return view.getInt8(offset);
    case "uchar":
    case "uint8":
      return view.getUint8(offset);
    case "short":
    case "int16":
      return view.getInt16(offset, true);
    case "ushort":
    case "uint16":
      return view.getUint16(offset, true);
    case "int":
    case "int32":
      return view.getInt32(offset, true);
    case "uint":
    case "uint32":
      return view.getUint32(offset, true);
    case "float":
    case "float32":
      return view.getFloat32(offset, true);
    default:
      return view.getFloat64(offset, true);
  }
}

/** Dónde acaba la cabecera, en bytes. `-1` si no acaba dentro de lo mirado. */
function findHeaderEnd(bytes: Uint8Array): number {
  // `end_header` seguido de fin de línea. Se busca sobre bytes y no sobre texto
  // decodificado porque decodificar 150 MB de cuerpo binario como si fueran
  // caracteres es exactamente el coste que este lector existe para no pagar.
  const needle = [0x65, 0x6e, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72]; // "end_header"
  // Un techo generoso sobre la cabecera: es ASCII y son unas pocas líneas. Sin
  // techo, un fichero sin `end_header` se recorrería entero.
  const ceiling = Math.min(bytes.length, RESOURCE_LIMITS.plyHeaderLines.value * 128);
  for (let index = 0; index + needle.length < ceiling; index += 1) {
    let hit = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    let after = index + needle.length;
    if (bytes[after] === 0x0d) after += 1; // CR de un fichero escrito en Windows
    if (bytes[after] === 0x0a) return after + 1;
  }
  return -1;
}

/**
 * Lee un PLY binario little-endian.
 *
 * La diferencia real con el ASCII no es el `DataView`: es que **el ASCII sabe
 * cuántas filas hay contándolas y el binario no**. Un fichero de texto truncado
 * se detecta comparando filas prometidas con filas presentes, sin tocar memoria;
 * uno binario truncado solo se nota al llegar al final, así que cada lectura
 * comprueba que le quedan bytes. Sin eso, un `dense.ply` cortado por una copia a
 * medias devolvería vértices en cero y nadie lo sabría.
 */
export function parsePlyBinary(bytes: Uint8Array): { mesh: PlyMesh | null; points: PlyPoints } {
  const headerEnd = findHeaderEnd(bytes);
  if (headerEnd < 0) {
    throw new Error(
      `CABECERA_PLY_DEMASIADO_LARGA: no aparece end_header en los primeros ${RESOURCE_LIMITS.plyHeaderLines.value * 128} bytes`,
    );
  }
  // La cabecera es ASCII por definición del formato, así que `latin1` la decodifica
  // byte a byte sin inventar: un `comment` con acentos no rompe el parseo porque
  // los comentarios se descartan por su primera palabra.
  let header = "";
  for (let index = 0; index < headerEnd; index += 1) header += String.fromCharCode(bytes[index]);
  const { elements, format } = parseHeaderLines(header.split(/\r?\n/));

  if (format !== "binary_little_endian") {
    throw new Error(
      `FORMATO_PLY_NO_SOPORTADO: parsePlyBinary solo lee binary_little_endian y este declara ${format ?? "nada"}`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = headerEnd;
  const need = (howMany: number, where: string): void => {
    if (cursor + howMany > bytes.length) {
      throw new Error(
        `PLY_TRUNCADO: ${where} necesita ${howMany} bytes en la posición ${cursor} y el fichero tiene ${bytes.length}`,
      );
    }
  };

  let positions: Float32Array = new Float32Array(0);
  const faces: number[] = [];
  let declaresFaces = false;

  for (const element of elements) {
    const fixed = element.properties.every((property) => !property.list);
    if (fixed) {
      // Con todas las propiedades de tamaño fijo, la longitud del elemento se
      // sabe de antemano: se comprueba entera antes de reservar, igual que el
      // ASCII cuenta filas antes de tocar memoria.
      const sizes = element.properties.map((property) => scalarBytes(property.type, element.name));
      const stride = sizes.reduce((total, size) => total + size, 0);
      need(element.count * stride, `el elemento ${element.name}`);
    }

    if (element.name === "vertex") {
      const names = element.properties.map((property) => property.name);
      const [x, y, z] = ["x", "y", "z"].map((axis) => names.indexOf(axis));
      if (x < 0 || y < 0 || z < 0) throw new Error("VERTICE_PLY_INVALIDO: faltan x, y o z");
      // Desplazamiento de cada propiedad dentro de la fila. Se calcula una vez y
      // no por vértice: un `dense.ply` trae millones de filas y el color, la
      // normal y la confianza que COLMAP escribe se saltan sin leerlos.
      const offsets: number[] = [];
      let running = 0;
      for (const property of element.properties) {
        offsets.push(running);
        running += scalarBytes(property.type, element.name);
      }
      positions = new Float32Array(element.count * 3);
      for (let index = 0; index < element.count; index += 1) {
        positions[index * 3] = readScalar(view, cursor + offsets[x], element.properties[x].type);
        positions[index * 3 + 1] = readScalar(view, cursor + offsets[y], element.properties[y].type);
        positions[index * 3 + 2] = readScalar(view, cursor + offsets[z], element.properties[z].type);
        cursor += running;
      }
      continue;
    }

    if (element.name === "face") {
      declaresFaces = true;
      const property = element.properties.find((candidate) => candidate.list);
      if (property === undefined) throw new Error("CABECERA_PLY_INVALIDA: el elemento face no declara una lista");
      const countBytes = scalarBytes(property.countType ?? "uchar", "face");
      const valueBytes = scalarBytes(property.type, "face");
      for (let index = 0; index < element.count; index += 1) {
        need(countBytes, "el contador de una cara");
        const sides = readScalar(view, cursor, property.countType ?? "uchar");
        cursor += countBytes;
        need(sides * valueBytes, `una cara de ${sides} lados`);
        const corners: number[] = [];
        for (let corner = 0; corner < sides; corner += 1) {
          corners.push(readScalar(view, cursor, property.type));
          cursor += valueBytes;
        }
        // Abanico desde el primer vértice, igual que el ASCII: la misma
        // triangulación tiene que dar la misma malla, y ésa es la comparación que
        // la puerta hace bit a bit.
        for (let corner = 2; corner < sides; corner += 1) {
          faces.push(corners[0], corners[corner - 1], corners[corner]);
        }
      }
      continue;
    }

    // Un elemento que no interesa se salta, y solo se puede saltar si mide algo
    // conocido: uno con listas obligaría a recorrerlo entrada a entrada, y
    // recorrer lo que no se entiende es como se acaba leyendo basura como
    // geometría.
    if (!fixed) {
      throw new Error(
        `FORMATO_PLY_NO_SOPORTADO: el elemento ${element.name} trae listas y no se sabe qué tamaño ocupa`,
      );
    }
    const stride = element.properties.reduce(
      (total, property) => total + scalarBytes(property.type, element.name),
      0,
    );
    cursor += element.count * stride;
  }

  return {
    mesh: declaresFaces ? { positions, indices: Uint32Array.from(faces) } : null,
    points: { positions },
  };
}

/**
 * La puerta única: decide por lo que el fichero declara, no por su extensión.
 *
 * Un `.ply` no dice en su nombre cómo está escrito, y COLMAP escribe los dos.
 * Elegir por extensión sería adivinar, que es justo lo que este módulo lleva
 * desde el principio negándose a hacer.
 */
export function parsePly(bytes: Uint8Array): { mesh: PlyMesh | null; points: PlyPoints } {
  const headerEnd = findHeaderEnd(bytes);
  const upTo = headerEnd < 0 ? Math.min(bytes.length, 4096) : headerEnd;
  let header = "";
  for (let index = 0; index < upTo; index += 1) header += String.fromCharCode(bytes[index]);
  const { format } = parseHeaderLines(header.split(/\r?\n/));

  if (format === "ascii") {
    // El ASCII se decodifica entero y como UTF-8: un `comment` puede traer
    // acentos, y `latin1` los partiría por la mitad.
    return parsePlyAscii(new TextDecoder().decode(bytes));
  }
  if (format === "binary_little_endian") return parsePlyBinary(bytes);
  throw new Error(
    `FORMATO_PLY_NO_SOPORTADO: se leen ascii y binary_little_endian, y este declara ${format ?? "nada"}`,
  );
}

/**
 * Malla en PLY binario little-endian.
 *
 * Existe por la misma razón que el lector: sin él, la puerta que compara los dos
 * caminos no tendría con qué construir el fichero binario, y comparar contra un
 * fichero que trajera otro no probaría que los dos lectores coinciden — probaría
 * que coinciden dos ficheros.
 */
export function serializePlyMeshBinary(mesh: PlyMesh): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  const faceCount = mesh.indices.length / 3;
  const header =
    "ply\n" +
    "format binary_little_endian 1.0\n" +
    "comment generado por softsight\n" +
    `element vertex ${vertexCount}\n` +
    "property float x\n" +
    "property float y\n" +
    "property float z\n" +
    `element face ${faceCount}\n` +
    "property list uchar int vertex_index\n" +
    "end_header\n";

  const headerBytes = new Uint8Array(header.length);
  for (let index = 0; index < header.length; index += 1) headerBytes[index] = header.charCodeAt(index);

  const body = new Uint8Array(vertexCount * 12 + faceCount * 13);
  const view = new DataView(body.buffer);
  let cursor = 0;
  for (let index = 0; index < vertexCount * 3; index += 1, cursor += 4) {
    view.setFloat32(cursor, mesh.positions[index], true);
  }
  for (let face = 0; face < faceCount; face += 1) {
    view.setUint8(cursor, 3);
    cursor += 1;
    for (let corner = 0; corner < 3; corner += 1, cursor += 4) {
      view.setInt32(cursor, mesh.indices[face * 3 + corner], true);
    }
  }

  const out = new Uint8Array(headerBytes.length + body.length);
  out.set(headerBytes, 0);
  out.set(body, headerBytes.length);
  return out;
}
