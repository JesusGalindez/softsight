/**
 * Puerta de la frontera con glTF — D32, riesgo R13 del contrato.
 *
 * El repositorio tiene dos lectores de GLB a propósito: uno aplana el árbol para
 * rasterizar y el otro lo conserva para evaluar poses. Unificarlos enteros es
 * B-R2 del mapa §5 y sigue aparcado. Lo que **no** puede estar dos veces es la
 * conversión de convenciones, y eso es lo que se comprueba aquí.
 *
 * ```text
 * D32   la conversión canónico ↔ glTF ocurre exactamente una vez,
 *       en el adaptador de frontera
 * R13   doble transposición entre los dos parsers
 * ```
 *
 * Dos transposiciones sin dueño **se cancelan**, y una malla transpuesta dos
 * veces se ve bien: es la misma malla. Por eso no basta con que los hashes no se
 * muevan; hace falta que nadie pueda escribir la segunda.
 *
 * Tres comprobaciones:
 *
 *   1. Las dos rutas dan la misma matriz para el mismo nodo, con `matrix` y con
 *      traslación, rotación y escala sueltas.
 *   2. `column * 4 + row` no aparece en `src/` fuera de `gltfFrame.ts`. Es la
 *      forma que tiene una transposición de escribirse, y buscarla en el texto es
 *      leer lo mismo que leería alguien preguntándose dónde ocurre.
 *   3. El cuaternión se expande en un solo sitio.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseGlb, parseGlbAnimation } from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "../src/soft");

/** GLB mínimo con un triángulo, con el nodo colocado como diga `node`. */
function glbWithNode(node) {
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = Uint16Array.from([0, 1, 2, 0]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "pieza", ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: 6 },
    ],
    buffers: [{ byteLength: binary.length }],
  };

  const json = Buffer.from(JSON.stringify(document));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const bytes = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// 1. Las dos rutas, la misma matriz.
{
  const casos = [
    [
      "matrix por columnas",
      // Escala 2 en X, traslación (5, 6, 7): por columnas, la traslación va en
      // 12, 13 y 14 y no en 3, 7 y 11.
      { matrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] },
    ],
    [
      "traslación, rotación y escala sueltas",
      { translation: [1.5, -2.25, 0.75], rotation: [0.2, 0.3, 0.1, 0.9273618495495704], scale: [1, 2, 3] },
    ],
    ["nodo sin colocar", {}],
  ];

  for (const [nombre, node] of casos) {
    const buffer = glbWithNode(node);
    const rasterizador = parseGlb(buffer).parts[0].matrix;
    const evaluador = parseGlbAnimation(buffer);
    const nodo = evaluador.document.nodes[0];

    // La ruta del evaluador compone la matriz del nodo por su cuenta al evaluar
    // poses; aquí se reconstruye igual que ella lo hace, desde el documento.
    const esperada = Array.from(rasterizador);
    const desdeDocumento = nodo.matrix
      ? transpose(nodo.matrix)
      : compose(nodo.translation ?? [0, 0, 0], nodo.rotation ?? [0, 0, 0, 1], nodo.scale ?? [1, 1, 1]);

    for (let index = 0; index < 16; index += 1) {
      assert.ok(
        Math.abs(esperada[index] - desdeDocumento[index]) < 1e-6,
        `${nombre}: las dos rutas discrepan en el componente ${index}: ${esperada[index]} contra ${desdeDocumento[index]}`,
      );
    }
    // Y la traslación acaba donde manda D32, no donde la deja glTF.
    if (node.matrix) {
      assert.deepEqual([esperada[3], esperada[7], esperada[11]], [5, 6, 7], "traslación en 3, 7 y 11");
    }
  }
  console.log(
    `glTF: ok (${casos.length} nodos con la misma matriz por las dos rutas, y la traslación en 3, 7 y 11)`,
  );
}

/** La transposición, escrita aquí para comparar contra la del repositorio. */
function transpose(values) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) out[row * 4 + column] = values[column * 4 + row];
  }
  return out;
}

function compose([tx, ty, tz], [qx, qy, qz, qw], [sx, sy, sz]) {
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
  return [
    (1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, tx,
    (xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, ty,
    (xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, tz,
    0, 0, 0, 1,
  ];
}

/** Todos los `.ts` bajo `src/soft/`. */
function sources(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

// 2 y 3. Una sola transposición y un solo cuaternión expandido, en todo `src/`.
{
  const transposiciones = [];
  const cuaterniones = [];
  for (const file of sources(sourceRoot)) {
    const relative = file.slice(sourceRoot.length + 1);
    if (relative === "agent/gltfFrame.ts") continue; // el adaptador de frontera, que es donde toca
    const text = readFileSync(file, "utf8");
    // La transposición se escribe así: leer la columna para escribir la fila.
    if (/\[\s*column\s*\*\s*4\s*\+\s*row\s*\]/.test(text)) transposiciones.push(relative);
    // Y el cuaternión expandido, por su término más característico.
    if (/\bwz\s*=\s*q?w\s*\*\s*[xq]2\b/.test(text)) cuaterniones.push(relative);
  }

  assert.deepEqual(
    transposiciones,
    [],
    `hay más de una transposición glTF↔canónico, que es el riesgo R13: ${transposiciones.join(", ")}`,
  );
  assert.deepEqual(
    cuaterniones,
    [],
    `el cuaternión de glTF se expande en más de un sitio: ${cuaterniones.join(", ")}`,
  );
  console.log(
    "glTF: ok (la transposición y la expansión del cuaternión existen en un solo fichero, gltfFrame.ts)",
  );
}
