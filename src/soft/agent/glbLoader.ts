/**
 * Lector de GLB (glTF 2.0 binario) sin dependencias.
 *
 * Un GLB es una cabecera de 12 bytes seguida de bloques `[longitud, tipo, datos]`:
 * el primero es el JSON de la escena y el segundo el búfer binario. Los vértices
 * se leen a través de tres niveles de indirección —accesor, vista de búfer,
 * búfer— que es lo que permite que varios atributos compartan memoria con paso
 * (`byteStride`) distinto.
 *
 * Se conserva la malla en espacio local y la transformación del nodo aparte, en
 * lugar de aplanar todo a espacio de mundo. Es deliberado: un agente que quiere
 * girar un rotor necesita tocar una matriz, no reescribir 1.584 posiciones. La
 * jerarquía se acumula al recorrer, así que cada pieza sale con su matriz de
 * mundo ya resuelta y sigue siendo editable.
 */

import { identity, mat4, multiply, type Mat4 } from "../math";
import { computeNormals, type Mesh } from "../mesh";
import { readGlbChunks, writeMatrixFromGltf, writeMatrixFromGltfTrs } from "./gltfFrame";
import type { ModelPart } from "./model";

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
}

interface MeshoptExtension {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL";
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: MeshoptExtension };
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfDocument {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ byteLength: number; uri?: string }>;
  meshes?: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
  extensionsRequired?: string[];
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // byte
  5121: 1, // unsigned byte
  5122: 2, // short
  5123: 2, // unsigned short
  5125: 4, // unsigned int
  5126: 4, // float
};

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

/**
 * Decodificador de `EXT_meshopt_compression`, inyectado desde fuera.
 *
 * Es la única dependencia externa del proyecto y es **opcional**: el núcleo del motor
 * sigue sin ninguna, y quien no la instale recibe el mismo error accionable de antes
 * en lugar de geometría corrupta. Se pasa como parámetro en vez de importarse aquí
 * para que el empaquetado del navegador no la arrastre si nadie la usa.
 */
export interface MeshoptDecoderLike {
  supported: boolean;
  ready: Promise<void>;
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): void;
}

/**
 * Extensiones que no impiden leer la geometría, aunque el fichero las declare
 * requeridas:
 *
 * - `KHR_mesh_quantization` solo relaja qué tipos de componente valen para los
 *   atributos —enteros de 8 y 16 bits en lugar de float—, y el lector de accesores ya
 *   los cubre, incluida la desnormalización. La escala que compensa la cuantización
 *   vive en la transformación del nodo, que ya se aplica.
 * - `EXT_texture_webp` solo afecta al formato de las imágenes, y aquí no se cargan
 *   texturas.
 *
 * Declararlas soportadas no es hacer trampa: la condición real es si el resultado
 * geométrico es correcto, y en estos dos casos lo es.
 */
const HARMLESS_REQUIRED_EXTENSIONS = new Set(["KHR_mesh_quantization", "EXT_texture_webp"]);

/** Escala de desnormalización para atributos cuantizados a entero. */
const NORMALIZE_DIVISOR: Record<number, number> = {
  5120: 127,
  5121: 255,
  5122: 32767,
  5123: 65535,
};

function readAccessor(
  document: GltfDocument,
  binary: Uint8Array,
  accessorIndex: number,
  decodedViews: Map<number, Uint8Array>,
): Float64Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`accesor ${accessorIndex} inexistente`);
  const componentCount = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (componentCount === undefined || componentBytes === undefined) {
    throw new Error(`accesor ${accessorIndex}: tipo ${accessor.type}/${accessor.componentType} no soportado`);
  }

  const output = new Float64Array(accessor.count * componentCount);
  if (accessor.bufferView === undefined) return output; // accesor disperso vacío: ceros

  const view = document.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`vista de búfer ${accessor.bufferView} inexistente`);

  const elementBytes = componentCount * componentBytes;
  // Sin `byteStride` los elementos van pegados; con él, un mismo búfer intercala
  // varios atributos y hay que saltar de elemento a elemento.
  const stride = view.byteStride ?? elementBytes;

  // Una vista comprimida ya se descomprimió a su propio búfer, así que su contenido
  // empieza en 0 y el desplazamiento de la vista dentro del binario no aplica.
  const decoded = decodedViews.get(accessor.bufferView);
  const source = decoded ?? binary;
  const base = (decoded ? 0 : view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const divisor = accessor.normalized ? NORMALIZE_DIVISOR[accessor.componentType] ?? 1 : 1;

  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      const offset = base + element * stride + component * componentBytes;
      let value: number;
      switch (accessor.componentType) {
        case 5120:
          value = data.getInt8(offset);
          break;
        case 5121:
          value = data.getUint8(offset);
          break;
        case 5122:
          value = data.getInt16(offset, true);
          break;
        case 5123:
          value = data.getUint16(offset, true);
          break;
        case 5125:
          value = data.getUint32(offset, true);
          break;
        default:
          value = data.getFloat32(offset, true);
      }
      output[element * componentCount + component] = divisor === 1 ? value : value / divisor;
    }
  }

  return output;
}

/**
 * Matriz local de un nodo, en la convención del motor.
 *
 * La conversión vive en `gltfFrame.ts` y no aquí: es la frontera con glTF, y D32
 * exige que ocurra **exactamente una vez** en todo el repositorio. Este fichero y
 * `animation.ts` la hacían por separado, con el mismo resultado y sin nada que lo
 * garantizase.
 */
function nodeLocalMatrix(node: GltfNode, out: Mat4): Mat4 {
  if (node.matrix) {
    writeMatrixFromGltf(node.matrix, out);
    return out;
  }
  writeMatrixFromGltfTrs(
    node.translation ?? [0, 0, 0],
    node.rotation ?? [0, 0, 0, 1],
    node.scale ?? [1, 1, 1],
    out,
  );
  return out;
}

function buildMesh(
  document: GltfDocument,
  binary: Uint8Array,
  primitive: GltfPrimitive,
  decodedViews: Map<number, Uint8Array>,
): Mesh | null {
  // Modo 4 es TRIANGLES. Tiras y abanicos existen pero casi nadie los exporta;
  // saltarlos con aviso es mejor que rasterizar basura silenciosamente.
  if ((primitive.mode ?? 4) !== 4) return null;

  const positionIndex = primitive.attributes.POSITION;
  if (positionIndex === undefined) return null;

  const positionData = readAccessor(document, binary, positionIndex, decodedViews);
  const positions = Float32Array.from(positionData);
  const vertexCount = positions.length / 3;

  const indices =
    primitive.indices !== undefined
      ? Uint32Array.from(readAccessor(document, binary, primitive.indices, decodedViews))
      : Uint32Array.from({ length: vertexCount }, (_value, index) => index);

  const normals =
    primitive.attributes.NORMAL !== undefined
      ? Float32Array.from(readAccessor(document, binary, primitive.attributes.NORMAL, decodedViews))
      : new Float32Array(positions.length);

  const uvs =
    primitive.attributes.TEXCOORD_0 !== undefined
      ? Float32Array.from(readAccessor(document, binary, primitive.attributes.TEXCOORD_0, decodedViews))
      : new Float32Array(vertexCount * 2);

  let boundingRadius = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const distance = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (distance > boundingRadius) boundingRadius = distance;
  }

  const mesh: Mesh = { positions, normals, uvs, indices, boundingRadius };
  if (primitive.attributes.NORMAL === undefined) computeNormals(mesh);
  return mesh;
}

export interface GlbLoadResult {
  parts: ModelPart[];
  /** Problemas no fatales: primitivas saltadas, atributos ausentes. */
  notes: string[];
}

export function parseGlb(buffer: ArrayBuffer, decoder?: MeshoptDecoderLike): GlbLoadResult {
  const chunks = readGlbChunks(buffer);
  const document = chunks.document as GltfDocument;
  const binary = chunks.binary;
  const notes: string[] = [];

  // Las extensiones *requeridas* no se pueden ignorar por definición: si el GLB
  // dice que hacen falta para leerlo, leerlo sin ellas produce geometría basura.
  // Mejor fallar con la salida concreta que el usuario tiene que ejecutar.
  const required = document.extensionsRequired ?? [];
  const blocking = required.filter((name) => {
    if (HARMLESS_REQUIRED_EXTENSIONS.has(name)) return false;
    if (name === "EXT_meshopt_compression") return decoder === undefined || !decoder.supported;
    return true;
  });
  if (blocking.length > 0) {
    const needsDecoder = blocking.includes("EXT_meshopt_compression");
    throw new Error(
      `este GLB requiere extensiones no soportadas (${blocking.join(", ")}). ` +
        (needsDecoder
          ? "Instala el decodificador con `npm i meshoptimizer`, o conviértelo: "
          : "Reexporta sin comprimir, o conviértelo: ") +
        "npx @gltf-transform/cli optimize entrada.glb salida.glb --compress false",
    );
  }

  const externalBuffer = (document.buffers ?? []).find((entry) => entry.uri !== undefined);
  if (externalBuffer) throw new Error("GLB con búfer externo (.bin aparte); solo se admite autocontenido");
  if (!binary) throw new Error("GLB sin bloque BIN");

  /**
   * Descompresión de las vistas con `EXT_meshopt_compression`.
   *
   * La extensión sustituye el contenido de una vista de búfer por un bloque
   * comprimido; el decodificador lo expande a su tamaño real —`count · byteStride`—
   * y a partir de ahí todo sigue igual, porque los accesores no saben nada de esto.
   * Cada vista se descomprime una sola vez aunque la usen varios accesores.
   */
  const decodedViews = new Map<number, Uint8Array>();
  if (decoder !== undefined) {
    (document.bufferViews ?? []).forEach((view, index) => {
      const compressed = view.extensions?.EXT_meshopt_compression;
      if (!compressed) return;
      const source = new Uint8Array(
        binary!.buffer,
        binary!.byteOffset + (compressed.byteOffset ?? 0),
        compressed.byteLength,
      );
      const target = new Uint8Array(compressed.count * compressed.byteStride);
      decoder.decodeGltfBuffer(
        target,
        compressed.count,
        compressed.byteStride,
        source,
        compressed.mode,
        compressed.filter ?? "NONE",
      );
      decodedViews.set(index, target);
    });
    if (decodedViews.size > 0) {
      notes.push(`${decodedViews.size} vistas descomprimidas con EXT_meshopt_compression`);
    }
  }

  const parts: ModelPart[] = [];
  const scratchLocal = mat4();
  const nodes = document.nodes ?? [];
  const rootNodes = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_node, index) => index);

  const visit = (nodeIndex: number, parentMatrix: Mat4, path: string[]): void => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const name = node.name ?? `nodo${nodeIndex}`;
    const currentPath = [...path, name];

    const worldMatrix = mat4();
    multiply(parentMatrix, nodeLocalMatrix(node, scratchLocal), worldMatrix);

    if (node.mesh !== undefined) {
      const gltfMesh = document.meshes?.[node.mesh];
      (gltfMesh?.primitives ?? []).forEach((primitive, primitiveIndex) => {
        const mesh = buildMesh(document, binary as Uint8Array, primitive, decodedViews);
        if (!mesh) {
          notes.push(`${name}: primitiva ${primitiveIndex} saltada (modo no triangular o sin POSITION)`);
          return;
        }
        const materialName =
          primitive.material !== undefined
            ? document.materials?.[primitive.material]?.name ?? `material${primitive.material}`
            : null;
        const baseColor =
          primitive.material !== undefined
            ? document.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor
            : undefined;

        parts.push({
          name: gltfMesh?.primitives.length && gltfMesh.primitives.length > 1
            ? `${name}#${primitiveIndex}`
            : name,
          path: currentPath.join("/"),
          mesh,
          matrix: worldMatrix,
          materialName,
          baseColor: baseColor ? [baseColor[0], baseColor[1], baseColor[2]] : null,
          visible: true,
        });
      });
    }

    for (const child of node.children ?? []) visit(child, worldMatrix, currentPath);
  };

  const rootMatrix = identity(mat4());
  for (const rootIndex of rootNodes) visit(rootIndex, rootMatrix, []);

  return { parts, notes };
}
