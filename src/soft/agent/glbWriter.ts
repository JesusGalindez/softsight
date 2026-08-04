/**
 * Escritura de GLB: lo que permite que un objeto salga de aquí sin empobrecerse.
 *
 * Hasta ahora lo único que salía era OBJ, que pierde el color, el material y la
 * jerarquía. Un agente que **crea** geometría necesita entregarla en el formato que
 * el resto del mundo lee, y ese es glTF binario.
 *
 * Es un escritor deliberadamente pequeño, no un exportador general:
 *
 * - **Una malla por pieza y un nodo por pieza**, con su matriz de mundo ya compuesta.
 *   El modelo interno no guarda la jerarquía original —la aplana al cargar—, así que
 *   reconstruir un árbol sería inventárselo.
 * - **Material por color base**, sin texturas, porque el modelo interno tampoco las
 *   tiene. Lo que no está no se escribe: un GLB con texturas vacías es peor que uno
 *   sin ellas.
 * - **Sin compresión.** El fichero sale más grande que el original comprimido con
 *   meshopt, y eso hay que decirlo en vez de esconderlo.
 * - **Una malla por geometría, no por pieza.** Dos piezas con los mismos vértices
 *   comparten la malla y solo se diferencian en la matriz de su nodo, que es lo que
 *   glTF llama instanciar. En el dron son 296 piezas y 56 geometrías —una repetida
 *   120 veces—, así que no hacerlo sería escribir el mismo tornillo ciento veinte
 *   veces.
 *
 * El resultado se puede volver a cargar con `parseGlb`, y esa ida y vuelta es la
 * prueba: mismas piezas, mismos triángulos, misma imagen.
 */

import { geometryKeyOf } from "./model";
import type { Model, ModelPart } from "./model";

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

interface Chunks {
  bytes: Uint8Array[];
  length: number;
}

/**
 * Añade un array al bloque binario y devuelve su vista, alineada a cuatro bytes.
 *
 * `target` es opcional porque glTF solo lo admite en vistas de atributos e
 * índices: ponerlo en las matrices de enlace o en los muestreadores de animación
 * produce un fichero que los validadores rechazan.
 */
function pushView(
  chunks: Chunks,
  views: Array<Record<string, number>>,
  array: Float32Array | Uint32Array | Uint16Array,
  target?: number,
): number {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  views.push({
    buffer: 0,
    byteOffset: chunks.length,
    byteLength: bytes.length,
    ...(target !== undefined ? { target } : {}),
  });
  chunks.bytes.push(bytes);
  chunks.length += bytes.length;
  const padding = (4 - (chunks.length % 4)) % 4;
  if (padding > 0) {
    chunks.bytes.push(new Uint8Array(padding));
    chunks.length += padding;
  }
  return views.length - 1;
}

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  // Una malla vacía no tiene caja; glTF exige que el accesor de posición traiga
  // mínimo y máximo, así que se escribe una degenerada en el origen antes que un
  // fichero inválido.
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/**
 * glTF guarda las matrices **por columnas**, y las de aquí están por filas. Es la
 * clase de detalle que no falla al escribir sino al abrir el fichero en otro
 * programa, semanas después.
 */
function toColumnMajor(matrix: Float32Array): number[] {
  const out: number[] = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out.push(matrix[row * 4 + column]);
  }
  return out;
}

export function serializeGlb(model: Model): ArrayBuffer {
  const chunks: Chunks = { bytes: [], length: 0 };
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  const materials: Array<Record<string, unknown>> = [];
  const materialByColor = new Map<string, number>();

  const addAccessor = (accessor: Record<string, unknown>): number => {
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const materialFor = (part: ModelPart): number | undefined => {
    if (part.baseColor === null) return undefined;
    const key = part.baseColor.map((value) => value.toFixed(4)).join(",");
    const existing = materialByColor.get(key);
    if (existing !== undefined) return existing;
    materials.push({
      name: part.materialName ?? `material${materials.length}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.baseColor, 1],
        metallicFactor: 0,
        roughnessFactor: 0.8,
      },
    });
    const index = materials.length - 1;
    materialByColor.set(key, index);
    return index;
  };

  // Malla ya escrita para cada geometría: la clave es el contenido, no la identidad
  // del objeto, porque el cargador entrega copias distintas de la misma geometría.
  const meshByGeometry = new Map<string, number>();

  for (const part of model.parts) {
    const geometryKey = `${geometryKeyOf(part.mesh)}|${part.baseColor?.join(",") ?? ""}`;
    const alreadyWritten = meshByGeometry.get(geometryKey);
    if (alreadyWritten !== undefined) {
      nodes.push({ name: part.name, mesh: alreadyWritten, matrix: toColumnMajor(part.matrix) });
      continue;
    }

    const { positions, normals, uvs, indices } = part.mesh;
    const vertexCount = positions.length / 3;
    const box = bounds(positions);

    const attributes: Record<string, number> = {
      POSITION: addAccessor({
        bufferView: pushView(chunks, bufferViews, positions, ARRAY_BUFFER),
        componentType: FLOAT,
        count: vertexCount,
        type: "VEC3",
        min: box.min,
        max: box.max,
      }),
    };
    if (normals.length === positions.length) {
      attributes.NORMAL = addAccessor({
        bufferView: pushView(chunks, bufferViews, normals, ARRAY_BUFFER),
        componentType: FLOAT,
        count: vertexCount,
        type: "VEC3",
      });
    }
    if (uvs.length === vertexCount * 2) {
      attributes.TEXCOORD_0 = addAccessor({
        bufferView: pushView(chunks, bufferViews, uvs, ARRAY_BUFFER),
        componentType: FLOAT,
        count: vertexCount,
        type: "VEC2",
      });
    }

    const indicesAccessor = addAccessor({
      bufferView: pushView(chunks, bufferViews, indices, ELEMENT_ARRAY_BUFFER),
      componentType: UNSIGNED_INT,
      count: indices.length,
      type: "SCALAR",
    });

    const material = materialFor(part);
    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes,
          indices: indicesAccessor,
          ...(material !== undefined ? { material } : {}),
        },
      ],
    });
    meshByGeometry.set(geometryKey, meshes.length - 1);
    nodes.push({
      name: part.name,
      mesh: meshes.length - 1,
      matrix: toColumnMajor(part.matrix),
    });
  }

  const document = {
    asset: { version: "2.0", generator: "softsight" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_node, index) => index) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: chunks.length }],
    ...(materials.length > 0 ? { materials } : {}),
  };

  return packGlb(document, chunks);
}

/** Envuelve el JSON y el bloque binario en el contenedor GLB de dos trozos. */
function packGlb(document: unknown, chunks: Chunks): ArrayBuffer {
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(document));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonLength = json.length + jsonPadding;

  const total = 12 + 8 + jsonLength + 8 + chunks.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out.set(encoder.encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonLength, true);
  out.set(encoder.encode("JSON"), 16);
  out.set(json, 20);
  // El relleno del bloque JSON son espacios, y el del binario ceros: lo dice la
  // especificación y hay lectores que lo comprueban.
  out.fill(0x20, 20 + json.length, 20 + jsonLength);

  const binOffset = 20 + jsonLength;
  view.setUint32(binOffset, chunks.length, true);
  out.set(encoder.encode("BIN "), binOffset + 4);
  let cursor = binOffset + 8;
  for (const bytes of chunks.bytes) {
    out.set(bytes, cursor);
    cursor += bytes.length;
  }

  return out.buffer;
}

/* -------------------------------------------------------------------------
 * Escritura con esqueleto y clips
 *
 * `serializeGlb` escribe el modelo interno, que está aplanado y no guarda ni
 * esqueleto ni animación: no puede escribir lo que no tiene. Este segundo
 * escritor parte de una descripción declarativa —árbol de nodos, mallas con
 * pesos de piel, pieles y clips— porque quien produce esos datos no es el
 * modelo interno sino lo que venga de fuera: un GLB releído, un BVH, o un
 * generador de movimiento.
 *
 * La prueba no es visual, como siempre aquí: escribir un fichero cuyas poses
 * evaluadas den los mismos hashes que las del original.
 * ---------------------------------------------------------------------- */

/**
 * Nodo del árbol. O bien `matrix`, o bien la terna TRS, nunca las dos: glTF lo
 * prohíbe porque no hay forma de saber cuál manda.
 *
 * `matrix` va **por columnas**, en el orden en que glTF la guarda, no por filas
 * como el resto del renderizador. Se escribe tal cual llega.
 */
export interface SkinnedGlbNode {
  name?: string;
  matrix?: number[];
  translation?: number[];
  /** Cuaternión en orden `x, y, z, w`, el de glTF. */
  rotation?: number[];
  scale?: number[];
  children?: number[];
  mesh?: number;
  skin?: number;
  weights?: number[];
}

/** Desplazamiento de un morph target respecto de la malla base. */
export interface SkinnedGlbMorphTarget {
  positions?: Float32Array;
  normals?: Float32Array;
}

/**
 * Una primitiva de malla. `joints` y `weights` van juntos o no van: cuatro
 * influencias por vértice, que es lo que el evaluador certifica.
 */
export interface SkinnedGlbPrimitive {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** Cuatro índices de joint por vértice, en el orden de `skin.joints`. */
  joints?: Uint16Array;
  /** Cuatro pesos por vértice, alineados con `joints`. */
  weights?: Float32Array;
  indices?: Uint32Array;
  targets?: SkinnedGlbMorphTarget[];
  /** Color base RGB en 0–1. Sin él, la primitiva sale sin material. */
  baseColor?: number[];
  materialName?: string;
}

export interface SkinnedGlbMesh {
  name?: string;
  primitives: SkinnedGlbPrimitive[];
  /** Pesos de morph por defecto de la malla. */
  weights?: number[];
}

/**
 * Piel: qué nodos son joints y cuál es la matriz de enlace inversa de cada uno.
 *
 * `inverseBindMatrices` son 16 valores por joint **por columnas**, igual que las
 * lee glTF. Entran y salen sin transponer: transponerlas dos veces es el error
 * clásico, y no se ve hasta que el modelo se retuerce al animar.
 */
export interface SkinnedGlbSkin {
  name?: string;
  joints: number[];
  inverseBindMatrices?: Float32Array;
  skeleton?: number;
}

/** Muestreador: tiempos en segundos y los valores que interpola. */
export interface SkinnedGlbSampler {
  times: Float32Array;
  values: Float32Array;
  interpolation?: "STEP" | "LINEAR" | "CUBICSPLINE";
}

export interface SkinnedGlbChannel {
  sampler: number;
  node: number;
  path: "translation" | "rotation" | "scale" | "weights";
}

export interface SkinnedGlbAnimation {
  name?: string;
  samplers: SkinnedGlbSampler[];
  channels: SkinnedGlbChannel[];
}

/** Escena completa que entiende el escritor con esqueleto. */
export interface SkinnedGlbScene {
  nodes: SkinnedGlbNode[];
  meshes: SkinnedGlbMesh[];
  skins?: SkinnedGlbSkin[];
  animations?: SkinnedGlbAnimation[];
  /** Nodos raíz. Por defecto, los que nadie declara como hijos. */
  roots?: number[];
}

const COMPONENTS_BY_TYPE: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const VALUE_TYPE_BY_PATH: Record<SkinnedGlbChannel["path"], string> = {
  translation: "VEC3",
  rotation: "VEC4",
  scale: "VEC3",
  weights: "SCALAR",
};

/** Mínimo y máximo por componente: glTF los exige en posiciones y en tiempos. */
function componentBounds(values: Float32Array, stride: number): { min: number[]; max: number[] } {
  const min = new Array<number>(stride).fill(Infinity);
  const max = new Array<number>(stride).fill(-Infinity);
  for (let offset = 0; offset + stride <= values.length; offset += stride) {
    for (let axis = 0; axis < stride; axis += 1) {
      const value = values[offset + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  if (min[0] === Infinity) return { min: new Array(stride).fill(0), max: new Array(stride).fill(0) };
  return { min, max };
}

/**
 * Escribe un GLB con esqueleto, pesos de piel, morph targets y clips.
 *
 * Valida antes de escribir todo lo que se puede validar —referencias a nodos,
 * número de influencias, tamaño de las matrices de enlace— porque un GLB mal
 * formado no falla al escribirlo sino al abrirlo en otro programa, y para
 * entonces ya nadie sabe qué lo produjo.
 */
export function serializeSkinnedGlb(scene: SkinnedGlbScene): ArrayBuffer {
  const chunks: Chunks = { bytes: [], length: 0 };
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const materials: Array<Record<string, unknown>> = [];
  const materialByColor = new Map<string, number>();

  const addAccessor = (accessor: Record<string, unknown>): number => {
    accessors.push(accessor);
    return accessors.length - 1;
  };

  // El mismo array escrito dos veces son los mismos bytes dos veces. Pasa de
  // verdad: un esqueleto de 77 huesos comparte un único vector de tiempos entre
  // sus 154 muestreadores, y sin esto el fichero lo repetiría 154 veces.
  const viewByArray = new Map<ArrayBufferView, Map<number, number>>();
  const viewOf = (array: Float32Array | Uint32Array | Uint16Array, target?: number): number => {
    const byTarget = viewByArray.get(array) ?? new Map<number, number>();
    const key = target ?? -1;
    const existing = byTarget.get(key);
    if (existing !== undefined) return existing;
    const view = pushView(chunks, bufferViews, array, target);
    byTarget.set(key, view);
    viewByArray.set(array, byTarget);
    return view;
  };

  const materialForColor = (color: number[] | undefined, name: string | undefined): number | undefined => {
    if (!color) return undefined;
    const key = color.map((value) => value.toFixed(4)).join(",");
    const existing = materialByColor.get(key);
    if (existing !== undefined) return existing;
    materials.push({
      name: name ?? `material${materials.length}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...color, 1],
        metallicFactor: 0,
        roughnessFactor: 0.8,
      },
    });
    const index = materials.length - 1;
    materialByColor.set(key, index);
    return index;
  };

  const vec3Accessor = (values: Float32Array, withBounds: boolean): number => {
    const box = componentBounds(values, 3);
    return addAccessor({
      bufferView: viewOf(values, ARRAY_BUFFER),
      componentType: FLOAT,
      count: values.length / 3,
      type: "VEC3",
      ...(withBounds ? { min: box.min, max: box.max } : {}),
    });
  };

  const meshes = scene.meshes.map((mesh, meshIndex) => {
    const primitives = mesh.primitives.map((primitive, primitiveIndex) => {
      const where = `malla ${meshIndex}, primitiva ${primitiveIndex}`;
      if (primitive.positions.length % 3 !== 0) {
        throw new Error(`${where}: POSITION no es múltiplo de 3`);
      }
      const vertexCount = primitive.positions.length / 3;

      const attributes: Record<string, number> = {
        POSITION: vec3Accessor(primitive.positions, true),
      };

      if (primitive.normals) {
        if (primitive.normals.length !== primitive.positions.length) {
          throw new Error(`${where}: NORMAL no cubre los ${vertexCount} vértices de POSITION`);
        }
        attributes.NORMAL = vec3Accessor(primitive.normals, false);
      }

      if (primitive.uvs) {
        if (primitive.uvs.length !== vertexCount * 2) {
          throw new Error(`${where}: TEXCOORD_0 no cubre los ${vertexCount} vértices de POSITION`);
        }
        attributes.TEXCOORD_0 = addAccessor({
          bufferView: viewOf(primitive.uvs, ARRAY_BUFFER),
          componentType: FLOAT,
          count: vertexCount,
          type: "VEC2",
        });
      }

      // Los dos atributos de piel viajan en pareja: uno sin el otro da un
      // fichero que carga y deforma mal, que es peor que uno que no carga.
      if ((primitive.joints === undefined) !== (primitive.weights === undefined)) {
        throw new Error(`${where}: JOINTS_0 y WEIGHTS_0 van juntos o no van`);
      }
      if (primitive.joints && primitive.weights) {
        if (primitive.joints.length !== vertexCount * 4) {
          throw new Error(
            `${where}: JOINTS_0 pide 4 índices por vértice (${vertexCount * 4}), trae ${primitive.joints.length}`,
          );
        }
        if (primitive.weights.length !== vertexCount * 4) {
          throw new Error(
            `${where}: WEIGHTS_0 pide 4 pesos por vértice (${vertexCount * 4}), trae ${primitive.weights.length}`,
          );
        }
        attributes.JOINTS_0 = addAccessor({
          bufferView: viewOf(primitive.joints, ARRAY_BUFFER),
          componentType: UNSIGNED_SHORT,
          count: vertexCount,
          type: "VEC4",
        });
        attributes.WEIGHTS_0 = addAccessor({
          bufferView: viewOf(primitive.weights, ARRAY_BUFFER),
          componentType: FLOAT,
          count: vertexCount,
          type: "VEC4",
        });
      }

      const targets = primitive.targets?.map((target, targetIndex) => {
        const entry: Record<string, number> = {};
        if (target.positions) {
          if (target.positions.length !== primitive.positions.length) {
            throw new Error(`${where}: el morph target ${targetIndex} no cubre los ${vertexCount} vértices`);
          }
          entry.POSITION = vec3Accessor(target.positions, true);
        }
        if (target.normals) {
          if (target.normals.length !== primitive.positions.length) {
            throw new Error(`${where}: las normales del morph target ${targetIndex} no cubren los ${vertexCount} vértices`);
          }
          entry.NORMAL = vec3Accessor(target.normals, false);
        }
        return entry;
      });

      const material = materialForColor(primitive.baseColor, primitive.materialName);

      return {
        attributes,
        ...(primitive.indices
          ? {
              indices: addAccessor({
                bufferView: viewOf(primitive.indices, ELEMENT_ARRAY_BUFFER),
                componentType: UNSIGNED_INT,
                count: primitive.indices.length,
                type: "SCALAR",
              }),
            }
          : {}),
        ...(targets && targets.length > 0 ? { targets } : {}),
        ...(material !== undefined ? { material } : {}),
      };
    });

    return {
      ...(mesh.name !== undefined ? { name: mesh.name } : {}),
      primitives,
      ...(mesh.weights ? { weights: mesh.weights } : {}),
    };
  });

  const skins = scene.skins?.map((skin, skinIndex) => {
    for (const joint of skin.joints) {
      if (joint < 0 || joint >= scene.nodes.length) {
        throw new Error(`piel ${skinIndex}: el joint ${joint} no es un nodo de la escena`);
      }
    }
    let inverseBindMatrices: number | undefined;
    if (skin.inverseBindMatrices) {
      if (skin.inverseBindMatrices.length !== skin.joints.length * 16) {
        throw new Error(
          `piel ${skinIndex}: ${skin.joints.length} joints piden ${skin.joints.length * 16} valores de matriz, hay ${skin.inverseBindMatrices.length}`,
        );
      }
      inverseBindMatrices = addAccessor({
        bufferView: viewOf(skin.inverseBindMatrices),
        componentType: FLOAT,
        count: skin.joints.length,
        type: "MAT4",
      });
    }
    return {
      ...(skin.name !== undefined ? { name: skin.name } : {}),
      joints: skin.joints,
      ...(inverseBindMatrices !== undefined ? { inverseBindMatrices } : {}),
      ...(skin.skeleton !== undefined ? { skeleton: skin.skeleton } : {}),
    };
  });

  const animations = scene.animations?.map((animation, animationIndex) => {
    // El accesor de salida no se puede crear con el muestreador: su tipo lo
    // decide la ruta del canal que lo usa, no el muestreador en sí.
    const pending = animation.samplers.map((sampler, samplerIndex) => {
      if (sampler.times.length === 0) {
        throw new Error(`clip ${animationIndex}, muestreador ${samplerIndex}: sin tiempos`);
      }
      const times = componentBounds(sampler.times, 1);
      return {
        // El accesor de entrada es el único que **obliga** a llevar min y max:
        // sin ellos, un lector no sabe la duración del clip sin recorrerlo.
        input: addAccessor({
          bufferView: viewOf(sampler.times),
          componentType: FLOAT,
          count: sampler.times.length,
          type: "SCALAR",
          min: times.min,
          max: times.max,
        }),
        output: -1,
        type: "",
        values: sampler.values,
        interpolation: sampler.interpolation,
      };
    });

    const channels = animation.channels.map((channel, channelIndex) => {
      const where = `clip ${animationIndex}, canal ${channelIndex}`;
      if (channel.sampler < 0 || channel.sampler >= pending.length) {
        throw new Error(`${where}: el muestreador ${channel.sampler} no existe`);
      }
      if (channel.node < 0 || channel.node >= scene.nodes.length) {
        throw new Error(`${where}: el nodo ${channel.node} no existe`);
      }
      const type = VALUE_TYPE_BY_PATH[channel.path];
      if (!type) throw new Error(`${where}: ruta '${channel.path}' desconocida`);
      const sampler = pending[channel.sampler];
      if (sampler.output < 0) {
        sampler.type = type;
        sampler.output = addAccessor({
          bufferView: viewOf(sampler.values),
          componentType: FLOAT,
          count: sampler.values.length / COMPONENTS_BY_TYPE[type],
          type,
        });
      } else if (sampler.type !== type) {
        // Compartir un muestreador entre rutas distintas escribiría los valores
        // con el tipo de la primera y los leería con el de la segunda. No falla
        // al escribir: falla al animar, y ahí ya no se sabe por qué.
        throw new Error(
          `${where}: el muestreador ${channel.sampler} ya sirve a una ruta de tipo ${sampler.type}, no puede servir a '${channel.path}'`,
        );
      }
      return { sampler: channel.sampler, target: { node: channel.node, path: channel.path } };
    });

    const samplers = pending.map(({ input, output, interpolation }, samplerIndex) => {
      if (output < 0) {
        throw new Error(`clip ${animationIndex}: el muestreador ${samplerIndex} no lo usa ningún canal`);
      }
      return { input, output, ...(interpolation ? { interpolation } : {}) };
    });

    return {
      ...(animation.name !== undefined ? { name: animation.name } : {}),
      samplers,
      channels,
    };
  });

  const declaredAsChild = new Set<number>();
  for (const node of scene.nodes) {
    for (const child of node.children ?? []) {
      if (child < 0 || child >= scene.nodes.length) {
        throw new Error(`el hijo ${child} no es un nodo de la escena`);
      }
      declaredAsChild.add(child);
    }
  }
  const roots =
    scene.roots ?? scene.nodes.map((_node, index) => index).filter((index) => !declaredAsChild.has(index));

  const nodes = scene.nodes.map((node, index) => {
    if (node.matrix && (node.translation || node.rotation || node.scale)) {
      throw new Error(`nodo ${index}: glTF no admite 'matrix' junto a translation/rotation/scale`);
    }
    if (node.mesh !== undefined && (node.mesh < 0 || node.mesh >= meshes.length)) {
      throw new Error(`nodo ${index}: la malla ${node.mesh} no existe`);
    }
    if (node.skin !== undefined && (node.skin < 0 || node.skin >= (skins?.length ?? 0))) {
      throw new Error(`nodo ${index}: la piel ${node.skin} no existe`);
    }
    return {
      ...(node.name !== undefined ? { name: node.name } : {}),
      ...(node.matrix ? { matrix: node.matrix } : {}),
      ...(node.translation ? { translation: node.translation } : {}),
      ...(node.rotation ? { rotation: node.rotation } : {}),
      ...(node.scale ? { scale: node.scale } : {}),
      ...(node.children && node.children.length > 0 ? { children: node.children } : {}),
      ...(node.mesh !== undefined ? { mesh: node.mesh } : {}),
      ...(node.skin !== undefined ? { skin: node.skin } : {}),
      ...(node.weights ? { weights: node.weights } : {}),
    };
  });

  const document = {
    asset: { version: "2.0", generator: "softsight" },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: chunks.length }],
    ...(materials.length > 0 ? { materials } : {}),
    ...(skins && skins.length > 0 ? { skins } : {}),
    ...(animations && animations.length > 0 ? { animations } : {}),
  };

  return packGlb(document, chunks);
}
