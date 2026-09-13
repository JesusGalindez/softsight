/**
 * PLY, el formato en el que viaja la geometría reconstruida.
 *
 * Solo ASCII, y a propósito: es el que `cube-v1` necesita, cabe en unas líneas y
 * se lee con los ojos cuando una prueba falla. El binario llegará cuando llegue un
 * paquete real que lo use —COLMAP lo escribe— y entonces será un caso más de la
 * cabecera, no una reescritura: lo que cambia es cómo se leen los números, no qué
 * significan.
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

interface PlyElement {
  name: string;
  count: number;
  properties: Array<{ name: string; list: boolean }>;
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
  if (lines[0]?.trim() !== "ply") throw new Error("PLY_HEADER_MISSING: el fichero no empieza por `ply`");

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
          `PLY_HEADER_INVALID: el elemento ${parts[1]} declara ${JSON.stringify(parts[2])}, que no es un entero`,
        );
      }
      if (count > RESOURCE_LIMITS.plyElementCount.value) {
        throw new Error(
          `PLY_ELEMENT_COUNT_EXCEEDS_LIMIT: el elemento ${parts[1]} declara ${count} entradas y el tope son ${RESOURCE_LIMITS.plyElementCount.value}`,
        );
      }
      elements.push({ name: parts[1], count, properties: [] });
      continue;
    }
    if (parts[0] === "property") {
      const element = elements[elements.length - 1];
      if (element === undefined) throw new Error("PLY_HEADER_INVALID: una propiedad antes de su elemento");
      element.properties.push({ name: parts[parts.length - 1], list: parts[1] === "list" });
    }
  }

  if (!sawEndHeader) {
    throw new Error(
      `PLY_HEADER_TOO_LONG: la cabecera no termina en las primeras ${RESOURCE_LIMITS.plyHeaderLines.value} líneas`,
    );
  }

  if (format !== "ascii") {
    // Por su nombre y no con un fallo genérico: quien reciba esto tiene que poder
    // distinguir «no lo entiendo» de «está roto».
    throw new Error(`PLY_FORMAT_UNSUPPORTED: solo se lee ascii, y este declara ${format ?? "nada"}`);
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
        `PLY_TRUNCATED: el elemento ${element.name} declara ${element.count} entradas y quedan ${values.length - row} filas`,
      );
    }
    if (element.name === "vertex") {
      const names = element.properties.map((property) => property.name);
      const [x, y, z] = ["x", "y", "z"].map((axis) => names.indexOf(axis));
      if (x < 0 || y < 0 || z < 0) throw new Error("PLY_VERTEX_INVALID: faltan x, y o z");
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
