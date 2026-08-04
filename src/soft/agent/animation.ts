import type { MeshoptDecoderLike } from "./glbLoader";

type NumericArray = Float64Array;
type Mat4 = number[];

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
  sparse?: unknown;
}

interface MeshoptExtension {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  filter?: string;
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
  targets?: Array<Record<string, number>>;
}

interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  weights?: number[];
}

interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
  weights?: number[];
}

interface GltfSkin {
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
}

export interface GltfDocument {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ byteLength: number; uri?: string }>;
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  skins?: GltfSkin[];
  animations?: GltfAnimation[];
  extensionsRequired?: string[];
}

export interface GltfAnimation {
  name?: string;
  channels: GltfChannel[];
  samplers: GltfSampler[];
}

interface GltfChannel {
  sampler: number;
  target: { node?: number; path: string };
}

interface GltfSampler {
  input: number;
  output: number;
  interpolation?: "STEP" | "LINEAR" | "CUBICSPLINE";
}

export interface NodeState {
  translation: number[];
  rotation: number[];
  scale: number[];
  matrix: Mat4 | null;
  weights: number[] | null;
}

export interface AnimationControlPose {
  clipName: string;
  frame: number;
  positionsHash: string;
}

export interface AnimationControlPoseReference {
  schemaVersion: 1;
  fps: number;
  clips: Record<string, Array<{ frame: number; positionsHash: string }>>;
}

export interface AnimationClipSummary {
  name: string;
  channels: number;
  samplers: number;
  durationSeconds: number | null;
  targets: Array<{ nodeName: string | null; path: string | null }>;
}

export interface SoftSightAnimationInspection {
  animation: {
    contractVersion: 1;
    status: "accepted" | "pending" | "rejected";
    clips: AnimationClipSummary[];
  };
  skinning: {
    status: "accepted" | "pending" | "rejected";
    skins: Array<{
      index: number;
      joints: number;
      inverseBindMatrices: boolean;
      jointNames: Array<string | null>;
    }>;
  };
  morphTargets: {
    status: "accepted" | "pending" | "rejected";
    count: number;
  };
  controlPoses: AnimationControlPose[];
  errors: string[];
}

const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const NORMALIZE_DIVISOR: Record<number, number> = {
  5120: 127,
  5121: 255,
  5122: 32767,
  5123: 65535,
  5125: 4294967295,
};

export interface ParsedGlb {
  document: GltfDocument;
  binary: Uint8Array;
  decodedViews: Map<number, Uint8Array>;
}

/**
 * Resultado de evaluar una malla en un tiempo dado: `Float32Array` de 3
 * componentes por vértice, una por instancia de la malla en orden de escena.
 *
 * `clipIndex` elige el clip: 0 es el primero; fuera de rango devuelve la pose
 * estática (ningún clip aplicado). `time` va en segundos, como los samplers.
 */
export type EvaluatedPose = Float32Array;

/**
 * Referencia a un punto de la superficie (Fase C): malla, primitiva y triángulo
 * en el búfer de índices, con el peso baricéntrico del punto dentro del
 * triángulo. `barycentric` trae dos o tres valores no negativos que sumen 1; el
 * tercero se puede omitir.
 */
export interface SampleReference {
  mesh: string;
  primitive: number;
  triangle: number;
  barycentric: number[];
}

/**
 * Punto de una referencia evaluada en un tiempo dado. `positions` trae 3
 * componentes por **instancia** de la malla en orden de escena (el mismo punto
 * existe en cada copia de la malla); `normals` y `uvs` son nulos cuando la
 * primitiva no los declara.
 */
export interface SampleEvaluation {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
}

/** Huellas de un frame para el informe de muestreo (C2). */
export interface SampleFrameHash {
  frame: number;
  positionsHash: string;
  normalsHash: string | null;
}

/** Inspecciona la animación y, si se entrega una referencia, certifica poses. */
export async function inspectGlbAnimation(
  buffer: ArrayBuffer,
  controlPoses: AnimationControlPoseReference | null = null,
  decoder?: MeshoptDecoderLike,
): Promise<SoftSightAnimationInspection> {
  if (decoder) await decoder.ready;
  const parsed = parseGlbAnimation(buffer, decoder);
  const { document, binary, decodedViews } = parsed;
  const clips = (document.animations ?? []).map((animation, index) =>
    summarizeClip(document, animation, index),
  );
  const errors = inspectMorphTargets(document);
  const skins = (document.skins ?? []).map((skin, index) => ({
    index,
    joints: skin.joints.length,
    inverseBindMatrices: skin.inverseBindMatrices !== undefined,
    jointNames: skin.joints.map((joint) => document.nodes?.[joint]?.name ?? null),
  }));

  for (const skin of document.skins ?? []) {
    if (skin.inverseBindMatrices === undefined) {
      errors.push("Una skin no declara inverseBindMatrices; no se puede certificar la pose deformada.");
    }
  }

  let generated: AnimationControlPose[] = [];
  if (controlPoses !== null && errors.length === 0) {
    if (clips.length === 0) {
      errors.push("El GLB no declara clips de animación para las poses de control.");
    } else {
      generated = await evaluateControlPoses(document, binary, decodedViews, controlPoses);
      for (const clip of clips) {
        if (!generated.some((pose) => pose.clipName === clip.name)) {
          errors.push(`No se pudo generar una pose de control para ${clip.name}.`);
        }
      }
    }
  } else if (controlPoses !== null && clips.length > 0) {
    errors.push("No se evaluaron las poses de control porque el GLB contiene morph targets no certificables.");
  }

  const rejected = errors.some((error) =>
    error.includes("requiere") || error.includes("no se puede") || error.includes("morph target"),
  );
  const accepted = clips.length > 0 && generated.length > 0 && errors.length === 0;
  return {
    animation: {
      contractVersion: 1,
      status: rejected ? "rejected" : accepted ? "accepted" : "pending",
      clips,
    },
    skinning: {
      status: errors.some((error) => error.includes("skin") || error.includes("pose deformada"))
        ? "rejected"
        : "accepted",
      skins,
    },
    morphTargets: {
      status: errors.some((error) => error.includes("morph target")) ? "rejected" : "accepted",
      count: countMorphTargets(document),
    },
    controlPoses: generated,
    errors,
  };
}

function summarizeClip(document: GltfDocument, animation: GltfAnimation, index: number): AnimationClipSummary {
  const accessors = document.accessors ?? [];
  let duration = 0;
  let hasDuration = false;
  for (const sampler of animation.samplers) {
    const max = accessors[sampler.input]?.max?.[0];
    if (max !== undefined && Number.isFinite(max)) {
      duration = Math.max(duration, max);
      hasDuration = true;
    }
  }
  return {
    name: animation.name ?? `animation${index}`,
    channels: animation.channels.length,
    samplers: animation.samplers.length,
    durationSeconds: hasDuration ? Number(duration.toFixed(6)) : null,
    targets: animation.channels.map((channel) => ({
      nodeName:
        channel.target.node === undefined ? null : document.nodes?.[channel.target.node]?.name ?? null,
      path: channel.target.path ?? null,
    })),
  };
}

async function evaluateControlPoses(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  reference: AnimationControlPoseReference,
): Promise<AnimationControlPose[]> {
  const result: AnimationControlPose[] = [];
  const clips = document.animations ?? [];
  for (const animation of clips) {
    const clipName = animation.name ?? `animation${clips.indexOf(animation)}`;
    const poses = reference.clips[clipName] ?? [];
    for (const pose of poses) {
      const states = buildNodeStates(document);
      applyAnimation(document, binary, decodedViews, animation, states, pose.frame / reference.fps);
      const worlds = computeWorlds(document, states);
      const positionsHash = await hashSkinnedVertices(
        document,
        binary,
        decodedViews,
        states,
        worlds,
      );
      result.push({ clipName, frame: pose.frame, positionsHash });
    }
  }
  return result;
}

async function hashSkinnedVertices(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  states: NodeState[],
  worlds: Mat4[],
): Promise<string> {
  const positions: number[] = [];
  visitMeshNodes(document, (nodeIndex) => {
    const evaluated = evaluateMeshAtNode(document, binary, decodedViews, nodeIndex, states, worlds);
    for (let index = 0; index < evaluated.length; index += 1) positions.push(evaluated[index]);
  });
  const bytes = new Uint8Array(positions.length * 4);
  const view = new DataView(bytes.buffer);
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Nodos con malla en orden de escena: primero el recorrido desde las raíces de la
 * escena activa, después los que quedaran fuera, en orden de índice.
 *
 * Es el orden que certifican los hashes de las poses de control: el mismo modelo
 * recorre siempre los mismos nodos en el mismo orden, y evaluar una malla fuera
 * de la escena activa no la convierte en invisible para el contrato.
 */
function visitMeshNodes(document: GltfDocument, visitor: (nodeIndex: number) => void): void {
  const nodes = document.nodes ?? [];
  const sceneRoots = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_node, index) => index);
  const visiting = new Set<number>();

  const visit = (nodeIndex: number): void => {
    if (visiting.has(nodeIndex)) return;
    visiting.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) return;
    if (node.mesh !== undefined) visitor(nodeIndex);
    for (const child of node.children ?? []) visit(child);
  };

  for (const root of sceneRoots) visit(root);
  for (let index = 0; index < nodes.length; index += 1) visit(index);
}

/**
 * Posiciones deformadas de una instancia de malla: base → morph → skinning, con
 * la misma cadena y el mismo redondeo que la certificación de poses.
 */
function evaluateMeshAtNode(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  nodeIndex: number,
  states: NodeState[],
  worlds: Mat4[],
): Float32Array {
  return Float32Array.from(evaluateMeshPositionsAtNode(document, binary, decodedViews, nodeIndex, states, worlds));
}

/**
 * La misma cadena en doble precisión: base → morph → skinning, sin el redondeo
 * final a float32. Es lo que usa el evaluador de muestras (C3), que interpola
 * baricéntricamente y solo redondea al escribir la huella: redondear antes de
 * interpolar cambiaría el resultado respecto a interpolar en doble precisión.
 */
function evaluateMeshPositionsAtNode(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  nodeIndex: number,
  states: NodeState[],
  worlds: Mat4[],
): number[] {
  const cache = new Map<number, NumericArray>();
  const node = document.nodes?.[nodeIndex];
  if (!node) return [];
  const mesh = node.mesh === undefined ? undefined : document.meshes?.[node.mesh];
  if (!mesh) return [];
  const skin = node.skin === undefined ? undefined : document.skins?.[node.skin];
  const jointMatrices = skin ? buildJointMatrices(document, binary, decodedViews, skin, worlds, cache) : null;
  const morphWeights = resolveMorphWeights(mesh, states[nodeIndex]);
  const positions: number[] = [];
  for (const primitive of mesh.primitives) {
    const positionIndex = primitive.attributes.POSITION;
    if (positionIndex === undefined) continue;
    if (primitive.attributes.JOINTS_1 !== undefined || primitive.attributes.WEIGHTS_1 !== undefined) {
      throw new Error("la primitiva usa JOINTS_1/WEIGHTS_1; solo se soportan 4 influencias por vértice (JOINTS_0/WEIGHTS_0)");
    }
    const base = readAccessor(document, binary, positionIndex, cache, decodedViews);
    const joints = primitive.attributes.JOINTS_0 === undefined
      ? null
      : readAccessor(document, binary, primitive.attributes.JOINTS_0, cache, decodedViews);
    const weights = primitive.attributes.WEIGHTS_0 === undefined
      ? null
      : readAccessor(document, binary, primitive.attributes.WEIGHTS_0, cache, decodedViews);
    for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
      const offset = vertex * 3;
      const local = [base[offset], base[offset + 1], base[offset + 2]];
      applyMorphTargets(document, binary, decodedViews, primitive, local, morphWeights, vertex, cache);
      const transformed = joints && weights && jointMatrices
        ? applySkin(local, joints, weights, vertex, jointMatrices)
        : transformPoint(worlds[nodeIndex] ?? identity(), local);
      positions.push(transformed[0], transformed[1], transformed[2]);
    }
  }
  return positions;
}

/**
 * Valores de un accesor, ya decodificados y desnormalizados, en doble precisión.
 *
 * Es el lector que usan por dentro el evaluador y el muestreo, publicado para
 * que quien quiera **reescribir** un GLB no tenga que reimplementarlo: sabe de
 * `byteStride`, de tipos normalizados y de vistas descomprimidas con meshopt, y
 * cada uno de esos tres detalles es una forma distinta de leer basura sin que
 * salte ningún error.
 *
 * Los valores salen en el orden en que están en el fichero: una matriz `MAT4`
 * sale **por columnas**, como la guarda glTF, no por filas.
 */
export function readAccessorValues(parsed: ParsedGlb, accessorIndex: number): Float64Array {
  return readAccessor(parsed.document, parsed.binary, accessorIndex, new Map(), parsed.decodedViews);
}

/**
 * Posiciones deformadas de una malla en un tiempo dado, para todas sus instancias
 * en orden de escena. La cadena —base, morph targets, skinning— es la misma que
 * certifica las poses de control; la única diferencia es que el clip se resuelve
 * aquí en vez de precomprimirse.
 */
export function evaluatePose(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  time: number,
  meshIndex: number,
  clipIndex = 0,
): Float32Array {
  const states = buildNodeStates(document);
  const clip = (document.animations ?? [])[clipIndex];
  if (clip) applyAnimation(document, binary, decodedViews, clip, states, time);
  const worlds = computeWorlds(document, states);
  const parts: Float32Array[] = [];
  let total = 0;
  visitMeshNodes(document, (nodeIndex) => {
    if (document.nodes?.[nodeIndex]?.mesh !== meshIndex) return;
    const evaluated = evaluateMeshAtNode(document, binary, decodedViews, nodeIndex, states, worlds);
    parts.push(evaluated);
    total += evaluated.length;
  });
  const result = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Normales deformadas de una malla en un tiempo dado: base → morph → skinning
 * como direcciones (sin traslación) → normalización, la misma semántica que la
 * de los sombreadores de Three.js. Pendiente de certificación cruzada (Fase C).
 */
export function evaluatePoseWithNormals(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  time: number,
  meshIndex: number,
  clipIndex = 0,
): Float32Array {
  const states = buildNodeStates(document);
  const clip = (document.animations ?? [])[clipIndex];
  if (clip) applyAnimation(document, binary, decodedViews, clip, states, time);
  const worlds = computeWorlds(document, states);
  const normals: number[] = [];
  visitMeshNodes(document, (nodeIndex) => {
    const node = document.nodes?.[nodeIndex];
    if (!node || node.mesh !== meshIndex) return;
    normals.push(...evaluateNormalsAtNode(document, binary, decodedViews, nodeIndex, states, worlds));
  });
  return Float32Array.from(normals);
}

function evaluateNormalsAtNode(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  nodeIndex: number,
  states: NodeState[],
  worlds: Mat4[],
): number[] {
  const cache = new Map<number, NumericArray>();
  const node = document.nodes?.[nodeIndex];
  if (!node) return [];
  const mesh = node.mesh === undefined ? undefined : document.meshes?.[node.mesh];
  if (!mesh) return [];
  const skin = node.skin === undefined ? undefined : document.skins?.[node.skin];
  const jointMatrices = skin ? buildJointMatrices(document, binary, decodedViews, skin, worlds, cache) : null;
  const morphWeights = resolveMorphWeights(mesh, states[nodeIndex]);
  const normals: number[] = [];
  for (const primitive of mesh.primitives) {
    const normalIndex = primitive.attributes.NORMAL;
    if (normalIndex === undefined) continue;
    const base = readAccessor(document, binary, normalIndex, cache, decodedViews);
    const joints = primitive.attributes.JOINTS_0 === undefined
      ? null
      : readAccessor(document, binary, primitive.attributes.JOINTS_0, cache, decodedViews);
    const weights = primitive.attributes.WEIGHTS_0 === undefined
      ? null
      : readAccessor(document, binary, primitive.attributes.WEIGHTS_0, cache, decodedViews);
    for (let vertex = 0; vertex < base.length / 3; vertex += 1) {
      const offset = vertex * 3;
      const normal = [base[offset], base[offset + 1], base[offset + 2]];
      for (let targetIndex = 0; targetIndex < (primitive.targets?.length ?? 0); targetIndex += 1) {
        const deltaIndex = primitive.targets?.[targetIndex]?.NORMAL;
        const weight = morphWeights[targetIndex] ?? 0;
        if (deltaIndex === undefined || weight === 0) continue;
        const delta = readAccessor(document, binary, deltaIndex, cache, decodedViews);
        normal[0] += (delta[offset] ?? 0) * weight;
        normal[1] += (delta[offset + 1] ?? 0) * weight;
        normal[2] += (delta[offset + 2] ?? 0) * weight;
      }
      const transformed = joints && weights && jointMatrices
        ? applySkinNormal(normal, joints, weights, vertex, jointMatrices)
        : normalize(transformDirection(worlds[nodeIndex] ?? identity(), normal));
      normals.push(transformed[0], transformed[1], transformed[2]);
    }
  }
  return normals;
}

// ---------------------------------------------------------------------------
// Fase C — superficie animada: referencias, muestreo y evaluación de muestras
// ---------------------------------------------------------------------------

/**
 * Nombre por el que se identifica una malla en una referencia: el suyo, o el del
 * primer nodo que la instancia —GLTF no obliga a nombrar las mallas, y el
 * exportador del fixture deja la malla anónima y nombra su nodo—.
 */
function meshIndexByReferenceName(document: GltfDocument, name: string): number {
  const nodes = document.nodes ?? [];
  const byName = document.meshes?.findIndex((mesh) => mesh.name === name);
  if (byName !== undefined && byName >= 0) return byName;
  const viaNode = nodes.findIndex((node) => node.name === name && node.mesh !== undefined);
  if (viaNode >= 0 && nodes[viaNode]?.mesh !== undefined) return nodes[viaNode].mesh as number;
  const byFallback = document.meshes?.findIndex((mesh, index) =>
    (mesh.name === undefined || mesh.name === "") && `malla ${index}` === name,
  );
  if (byFallback !== undefined && byFallback >= 0) return byFallback;
  const candidates = [
    ...(document.meshes ?? []).flatMap((mesh, index) => (mesh.name ? [`${mesh.name} (malla ${index})`] : [`malla ${index}`])),
    ...nodes.filter((node) => node.name && node.mesh !== undefined).map((node) => `${node.name} (nodo)`),
  ];
  throw new Error(
    `no hay malla llamada '${name}'; las mallas de este GLB: ${candidates.length > 0 ? candidates.join(", ") : "ninguna"}`,
  );
}

/**
 * Validación semántica de una referencia contra el documento: malla existente,
 * primitiva en rango, triángulo dentro del búfer de índices y baricéntricas no
 * negativas que sumen ~1. Devuelve las baricéntricas completadas a tres valores.
 * La forma ya la valida `SAMPLE_REFERENCE_SCHEMA`; esto caza la referencia
 * escrita a mano que no apunta a ningún sitio.
 */
export function validateSampleReference(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  reference: SampleReference,
): number[] {
  const meshIndex = meshIndexByReferenceName(document, reference.mesh);
  const mesh = document.meshes?.[meshIndex];
  const primitive = mesh?.primitives[reference.primitive];
  if (!mesh || !primitive) {
    throw new Error(`la malla ${reference.mesh} no tiene primitiva ${reference.primitive} (tiene ${mesh?.primitives.length ?? 0})`);
  }
  if (!Number.isInteger(reference.triangle) || reference.triangle < 0) {
    throw new Error(`la referencia pide el triángulo ${reference.triangle}; debe ser un entero no negativo`);
  }
  const positionIndex = primitive.attributes.POSITION;
  if (positionIndex === undefined) {
    throw new Error(`la primitiva ${reference.primitive} de ${reference.mesh} no declara POSITION; no se puede muestrear`);
  }
  const cache = new Map<number, NumericArray>();
  const base = readAccessor(document, binary, positionIndex, cache, decodedViews);
  const triangleCount = triangleCountOf(document, binary, decodedViews, primitive, base);
  if (reference.triangle >= triangleCount) {
    throw new Error(
      `la referencia pide el triángulo ${reference.triangle}; la primitiva ${reference.primitive} tiene ${triangleCount}`,
    );
  }
  const barycentric = reference.barycentric;
  if (barycentric.length < 2 || barycentric.length > 3) {
    throw new Error("barycentric debe traer dos o tres pesos; el tercero se puede omitir");
  }
  if (barycentric.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("los pesos baricéntricos deben ser finitos y no negativos");
  }
  const sum = barycentric.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-3) {
    throw new Error(`los pesos baricéntricos suman ${sum}; deben sumar ~1`);
  }
  return [barycentric[0] ?? 0, barycentric[1] ?? 0, barycentric.length === 3 ? barycentric[2] ?? 0 : 1 - (barycentric[0] ?? 0) - (barycentric[1] ?? 0)];
}

/** Número de triángulos de una primitiva: el búfer de índices, o secuencial. */
function triangleCountOf(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  primitive: GltfPrimitive,
  base: NumericArray,
): number {
  if (primitive.indices === undefined) return Math.floor(base.length / 9);
  const cache = new Map<number, NumericArray>();
  const indices = readAccessor(document, binary, primitive.indices, cache, decodedViews);
  return Math.floor(indices.length / 3);
}

/** PRNG determinista mulberry32: el contrato de muestreo depende de su secuencia. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Referencias uniformes por área (ponderadas por raíz de área, como el
 * `findWeightedTriangle` del editor) con semilla fija: la misma semilla y el
 * mismo GLB producen siempre la misma lista, en el mismo orden. El orden es el
 * del contrato: una sola lista global de triángulos —todas las mallas distintas
 * en orden de escena, y sus primitivas en orden— y un peso por triángulo;
 * los triángulos degenerados (área nula) no se sortean jamás.
 */
export function sampleSurface(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  options: { count: number; seed: number },
): SampleReference[] {
  const random = mulberry32(options.seed);
  const cache = new Map<number, NumericArray>();
  const entries: Array<{ meshIndex: number; primitiveIndex: number; triangle: number; weight: number }> = [];
  const seenMesh = new Set<number>();
  const meshOrder: number[] = [];
  visitMeshNodes(document, (nodeIndex) => {
    const meshIndex = document.nodes?.[nodeIndex]?.mesh;
    if (meshIndex !== undefined && !seenMesh.has(meshIndex)) {
      seenMesh.add(meshIndex);
      meshOrder.push(meshIndex);
    }
  });
  for (const meshIndex of meshOrder) {
    const mesh = document.meshes?.[meshIndex];
    for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
      const positionIndex = primitive.attributes.POSITION;
      if (positionIndex === undefined) continue;
      const base = readAccessor(document, binary, positionIndex, cache, decodedViews);
      const count = triangleCountOf(document, binary, decodedViews, primitive, base);
      for (let triangle = 0; triangle < count; triangle += 1) {
        const [a, b, c] = triangleVertices(primitive, triangle, document, binary, decodedViews);
        const area = crossProductLength(base, a, b, c);
        if (area === 0) continue;
        entries.push({ meshIndex, primitiveIndex, triangle, weight: Math.sqrt(area) });
      }
    }
  }
  if (entries.length === 0) {
    throw new Error("el GLB no tiene triángulos muestreables (sin POSITION o sin área)");
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const nodes = document.nodes ?? [];
  const nameOf = (meshIndex: number): string => {
    const mesh = document.meshes?.[meshIndex];
    if (mesh?.name) return mesh.name;
    const instance = nodes.findIndex((node) => node.mesh === meshIndex);
    return instance >= 0 && nodes[instance]?.name ? nodes[instance].name as string : `malla ${meshIndex}`;
  };
  const references: SampleReference[] = [];
  for (let index = 0; index < options.count; index += 1) {
    let pick = random() * total;
    let entry = entries[entries.length - 1];
    for (const candidate of entries) {
      pick -= candidate.weight;
      if (pick <= 0) {
        entry = candidate;
        break;
      }
    }
    const u = random();
    const v = random();
    const root = Math.sqrt(u);
    references.push({
      mesh: nameOf(entry.meshIndex),
      primitive: entry.primitiveIndex,
      triangle: entry.triangle,
      barycentric: [1 - root, root * (1 - v), root * v],
    });
  }
  return references;
}

/** Los tres índices de un triángulo en el búfer de índices de la primitiva. */
function triangleVertices(
  primitive: GltfPrimitive,
  triangle: number,
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
): [number, number, number] {
  if (primitive.indices === undefined) return [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
  const cache = new Map<number, NumericArray>();
  const indices = readAccessor(document, binary, primitive.indices, cache, decodedViews);
  return [indices[triangle * 3] ?? 0, indices[triangle * 3 + 1] ?? 0, indices[triangle * 3 + 2] ?? 0];
}

/** Doble del área (producto vectorial) de un triángulo, en doble precisión. */
function crossProductLength(base: NumericArray, a: number, b: number, c: number): number {
  const abx = base[b * 3] - base[a * 3];
  const aby = base[b * 3 + 1] - base[a * 3 + 1];
  const abz = base[b * 3 + 2] - base[a * 3 + 2];
  const acx = base[c * 3] - base[a * 3];
  const acy = base[c * 3 + 1] - base[a * 3 + 1];
  const acz = base[c * 3 + 2] - base[a * 3 + 2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  return Math.hypot(x, y, z);
}

/** Desplazamiento de vértice de una primitiva dentro de un atributo concatenado. */
function attributeOffsets(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  mesh: GltfMesh,
  primitiveIndex: number,
): { positions: number; normals: number; uvs: number } {
  const cache = new Map<number, NumericArray>();
  let positions = 0;
  let normals = 0;
  let uvs = 0;
  for (let index = 0; index < primitiveIndex; index += 1) {
    const primitive = mesh.primitives[index];
    if (primitive.attributes.POSITION !== undefined) {
      positions += readAccessor(document, binary, primitive.attributes.POSITION, cache, decodedViews).length / 3;
    }
    if (primitive.attributes.NORMAL !== undefined) {
      normals += readAccessor(document, binary, primitive.attributes.NORMAL, cache, decodedViews).length / 3;
    }
    if (primitive.attributes.TEXCOORD_0 !== undefined) {
      uvs += readAccessor(document, binary, primitive.attributes.TEXCOORD_0, cache, decodedViews).length / 2;
    }
  }
  return { positions, normals, uvs };
}

/**
 * Punto de una referencia en un tiempo dado: base → morph → skinning (y normal
 * deformada) con la misma cadena que las poses de control, interpolación
 * baricéntrica en doble precisión —`b0·P0 + b1·P1 + b2·P2`, de izquierda a
 * derecha— y redondeo a float32 solo al devolver. Los UV no se deforman: son
 * por vértice y estáticos.
 */
export function evaluateSample(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  time: number,
  reference: SampleReference,
  clipIndex = 0,
): SampleEvaluation {
  const states = buildNodeStates(document);
  const clip = (document.animations ?? [])[clipIndex];
  if (clip) applyAnimation(document, binary, decodedViews, clip, states, time);
  const worlds = computeWorlds(document, states);
  const meshIndex = meshIndexByReferenceName(document, reference.mesh);
  const mesh = document.meshes?.[meshIndex];
  if (!mesh) throw new Error(`no hay malla llamada ${reference.mesh}`);
  const primitive = mesh.primitives[reference.primitive];
  const barycentric = validateSampleReference(document, binary, decodedViews, reference);
  const offsets = attributeOffsets(document, binary, decodedViews, mesh, reference.primitive);
  const [v0, v1, v2] = triangleVertices(
    primitive,
    reference.triangle,
    document,
    binary,
    decodedViews,
  );
  const hasNormals = primitive.attributes.NORMAL !== undefined;
  const hasUvs = primitive.attributes.TEXCOORD_0 !== undefined;

  const cache = new Map<number, NumericArray>();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  visitMeshNodes(document, (nodeIndex) => {
    const node = document.nodes?.[nodeIndex];
    if (!node || node.mesh !== meshIndex) return;
    const instancePositions = evaluateMeshPositionsAtNode(document, binary, decodedViews, nodeIndex, states, worlds);
    positions.push(...samplePoint(instancePositions, v0 + offsets.positions, v1 + offsets.positions, v2 + offsets.positions, barycentric));
    if (hasNormals) {
      const instanceNormals = evaluateNormalsAtNode(document, binary, decodedViews, nodeIndex, states, worlds);
      normals.push(...samplePoint(instanceNormals, v0 + offsets.normals, v1 + offsets.normals, v2 + offsets.normals, barycentric));
    }
    if (hasUvs) {
      const baseUvs = readAccessor(document, binary, primitive.attributes.TEXCOORD_0, cache, decodedViews);
      uvs.push(...samplePoint2(baseUvs, v0 + offsets.uvs, v1 + offsets.uvs, v2 + offsets.uvs, barycentric));
    }
  });

  return {
    positions: Float32Array.from(positions),
    normals: hasNormals ? Float32Array.from(normals) : null,
    uvs: hasUvs ? Float32Array.from(uvs) : null,
  };
}

/** Baricéntrica sobre tres vértices evaluados: `b0·P0 + b1·P1 + b2·P2`, en orden. */
function samplePoint(values: number[], v0: number, v1: number, v2: number, barycentric: number[]): number[] {
  const x = barycentric[0] * (values[v0 * 3] ?? 0) + barycentric[1] * (values[v1 * 3] ?? 0) + barycentric[2] * (values[v2 * 3] ?? 0);
  const y = barycentric[0] * (values[v0 * 3 + 1] ?? 0) + barycentric[1] * (values[v1 * 3 + 1] ?? 0) + barycentric[2] * (values[v2 * 3 + 1] ?? 0);
  const z = barycentric[0] * (values[v0 * 3 + 2] ?? 0) + barycentric[1] * (values[v1 * 3 + 2] ?? 0) + barycentric[2] * (values[v2 * 3 + 2] ?? 0);
  return [x, y, z];
}

/** Baricéntrica en dos componentes (UV): la misma suma, en el mismo orden. */
function samplePoint2(values: NumericArray, v0: number, v1: number, v2: number, barycentric: number[]): number[] {
  const u = barycentric[0] * (values[v0 * 2] ?? 0) + barycentric[1] * (values[v1 * 2] ?? 0) + barycentric[2] * (values[v2 * 2] ?? 0);
  const v = barycentric[0] * (values[v0 * 2 + 1] ?? 0) + barycentric[1] * (values[v1 * 2 + 1] ?? 0) + barycentric[2] * (values[v2 * 2 + 1] ?? 0);
  return [u, v];
}

/**
 * Huellas de las referencias en unos fotogramas, como las poses de control: por
 * fotograma, las posiciones de todas las referencias —en el orden del fichero,
 * y por instancia de la malla en orden de escena— concatenadas y con SHA-256.
 * `normalsHash` es nulo cuando alguna referencia apunta a una primitiva sin
 * NORMAL: no se inventan normales.
 */
export async function hashSamplesAtFrames(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  references: SampleReference[],
  frames: number[],
  fps: number,
  clipIndex = 0,
): Promise<SampleFrameHash[]> {
  const result: SampleFrameHash[] = [];
  for (const frame of frames) {
    const positions: number[] = [];
    const normals: number[] = [];
    let allNormals = true;
    for (const reference of references) {
      const evaluation = evaluateSample(document, binary, decodedViews, frame / fps, reference, clipIndex);
      positions.push(...evaluation.positions);
      if (evaluation.normals) normals.push(...evaluation.normals);
      else allNormals = false;
    }
    result.push({
      frame,
      positionsHash: await hashFloat32Array(positions),
      normalsHash: allNormals ? await hashFloat32Array(normals) : null,
    });
  }
  return result;
}

async function hashFloat32Array(values: number[]): Promise<string> {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Valida las influencias de un vértice: pesos finitos y no negativos. Devuelve
 * la suma de pesos para la normalización que hace el skinning.
 */
function totalInfluenceWeight(joints: NumericArray, weights: NumericArray, vertex: number, jointCount: number): number {
  let totalWeight = 0;
  for (let influence = 0; influence < 4; influence += 1) {
    const rawWeight = weights[vertex * 4 + influence] ?? 0;
    if (!Number.isFinite(rawWeight) || rawWeight < 0) {
      throw new Error(`peso de influencia inválido en el vértice ${vertex}: ${rawWeight}; los pesos deben ser finitos y no negativos`);
    }
    const joint = joints[vertex * 4 + influence] ?? -1;
    if (!Number.isFinite(joint) || joint < 0 || joint >= jointCount) {
      throw new Error(`joint ${joint} fuera de rango en el vértice ${vertex}: la skin tiene ${jointCount} joints`);
    }
    totalWeight += rawWeight;
  }
  return totalWeight;
}

/** Normales deformadas con skinning: la matriz del joint como dirección, sin traslación. */
function applySkinNormal(
  local: number[],
  joints: NumericArray,
  weights: NumericArray,
  vertex: number,
  jointMatrices: Mat4[],
): number[] {
  const result = [0, 0, 0];
  const totalWeight = totalInfluenceWeight(joints, weights, vertex, jointMatrices.length);
  if (totalWeight === 0) return local;
  for (let influence = 0; influence < 4; influence += 1) {
    const weight = Math.fround((weights[vertex * 4 + influence] ?? 0) / totalWeight);
    const joint = joints[vertex * 4 + influence] ?? -1;
    if (weight === 0) continue;
    const direction = transformDirection(jointMatrices[joint], local);
    result[0] += direction[0] * weight;
    result[1] += direction[1] * weight;
    result[2] += direction[2] * weight;
  }
  return normalize(result);
}

function transformDirection(matrix: Mat4, vector: number[]): number[] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[4] * vector[0] + matrix[5] * vector[1] + matrix[6] * vector[2],
    matrix[8] * vector[0] + matrix[9] * vector[1] + matrix[10] * vector[2],
  ];
}

function normalize(vector: number[]): number[] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) return vector;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function buildJointMatrices(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  skin: GltfSkin,
  worlds: Mat4[],
  cache: Map<number, NumericArray>,
): Mat4[] {
  if (skin.inverseBindMatrices === undefined) {
    throw new Error("la skin no declara inverseBindMatrices; no se puede evaluar la pose deformada");
  }
  const accessor = document.accessors?.[skin.inverseBindMatrices];
  if (!accessor || accessor.type !== "MAT4") {
    throw new Error(`inverseBindMatrices (accesor ${skin.inverseBindMatrices}) debe ser MAT4, no ${accessor?.type ?? "ninguno"}`);
  }
  const inverse = readAccessor(document, binary, skin.inverseBindMatrices, cache, decodedViews);
  if (inverse.length < skin.joints.length * 16) {
    throw new Error(`inverseBindMatrices incompletas: ${inverse.length} componentes para ${skin.joints.length} joints (se necesitan ${skin.joints.length * 16})`);
  }
  return skin.joints.map((joint, index) => {
    if (!worlds[joint]) {
      throw new Error(`joint ${joint} fuera de rango: el documento tiene ${worlds.length} nodos`);
    }
    const inverseBind = matrixFromColumnMajor(inverse.slice(index * 16, index * 16 + 16));
    const matrix = multiply(worlds[joint] ?? identity(), inverseBind);
    return matrix;
  });
}

export function applySkin(
  local: number[],
  joints: NumericArray,
  weights: NumericArray,
  vertex: number,
  jointMatrices: Mat4[],
): number[] {
  const result = [0, 0, 0];
  const totalWeight = totalInfluenceWeight(joints, weights, vertex, jointMatrices.length);
  if (totalWeight === 0) return local;
  for (let influence = 0; influence < 4; influence += 1) {
    // GLTFLoader normalizes skin weights on load and writes them back to a
    // Float32BufferAttribute. Reproduce that rounding so the checksum agrees
    // with the reference renderer even for sums just below one.
    const weight = Math.fround((weights[vertex * 4 + influence] ?? 0) / totalWeight);
    const joint = joints[vertex * 4 + influence] ?? -1;
    if (weight === 0) continue;
    const point = transformPoint(jointMatrices[joint], local);
    result[0] += point[0] * weight;
    result[1] += point[1] * weight;
    result[2] += point[2] * weight;
  }
  return result;
}

export function buildNodeStates(document: GltfDocument): NodeState[] {
  return (document.nodes ?? []).map((node) => ({
    translation: [...(node.translation ?? [0, 0, 0])],
    rotation: [...(node.rotation ?? [0, 0, 0, 1])],
    scale: [...(node.scale ?? [1, 1, 1])],
    matrix: node.matrix ? matrixFromColumnMajor(node.matrix) : null,
    weights: node.weights ? [...node.weights] : null,
  }));
}

function resolveMorphWeights(mesh: GltfMesh, state: NodeState | undefined): number[] {
  const targetCount = mesh.primitives.reduce(
    (count, primitive) => Math.max(count, primitive.targets?.length ?? 0),
    0,
  );
  const defaults = mesh.weights ?? [];
  const configured = state?.weights ?? defaults;
  return Array.from({ length: targetCount }, (_value, index) => configured[index] ?? defaults[index] ?? 0);
}

export function applyMorphTargets(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  primitive: GltfPrimitive,
  local: number[],
  weights: number[],
  vertex: number,
  cache: Map<number, NumericArray>,
): void {
  for (let targetIndex = 0; targetIndex < (primitive.targets?.length ?? 0); targetIndex += 1) {
    const positionIndex = primitive.targets?.[targetIndex]?.POSITION;
    const weight = weights[targetIndex] ?? 0;
    if (positionIndex === undefined || weight === 0) continue;
    const delta = readAccessor(document, binary, positionIndex, cache, decodedViews);
    const offset = vertex * 3;
    local[0] += (delta[offset] ?? 0) * weight;
    local[1] += (delta[offset + 1] ?? 0) * weight;
    local[2] += (delta[offset + 2] ?? 0) * weight;
  }
}

export function applyAnimation(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  animation: GltfAnimation,
  states: NodeState[],
  time: number,
): void {
  const cache = new Map<number, NumericArray>();
  for (const [channelIndex, channel] of animation.channels.entries()) {
    const nodeIndex = channel.target.node;
    const clipName = animation.name ?? "sin nombre";
    if (nodeIndex === undefined || !states[nodeIndex]) {
      throw new Error(`canal ${channelIndex} del clip ${clipName}: nodo objetivo ${String(nodeIndex)} inexistente`);
    }
    const sampler = animation.samplers[channel.sampler];
    if (!sampler) {
      throw new Error(`canal ${channelIndex} del clip ${clipName}: sampler ${channel.sampler} inexistente`);
    }
    const path = channel.target.path;
    if (path !== "translation" && path !== "rotation" && path !== "scale" && path !== "weights") {
      throw new Error(`canal ${channelIndex} del clip ${clipName}: path '${path}' desconocido; se admite translation, rotation, scale o weights`);
    }
    const input = readAccessor(document, binary, sampler.input, cache, decodedViews);
    const output = readAccessor(document, binary, sampler.output, cache, decodedViews);
    const interpolation = sampler.interpolation ?? "LINEAR";
    const outputStride = interpolation === "CUBICSPLINE" ? 3 : 1;
    const valueSize = path === "rotation"
      ? 4
      : path === "weights"
        ? Math.max(1, Math.floor(output.length / Math.max(1, input.length * outputStride)))
        : 3;
    const value = interpolate(input, output, time, valueSize, interpolation, path === "rotation");
    const state = states[nodeIndex];
    if (path === "translation") state.translation = value;
    else if (path === "rotation") state.rotation = value;
    else if (path === "scale") state.scale = value;
    else if (path === "weights") state.weights = value;
  }
}

function interpolate(
  input: NumericArray,
  output: NumericArray,
  time: number,
  size: number,
  interpolation: "STEP" | "LINEAR" | "CUBICSPLINE",
  quaternion = false,
): number[] {
  if (input.length === 0) return Array(size).fill(0);
  const stride = interpolation === "CUBICSPLINE" ? size * 3 : size;
  const valueAt = (key: number, part: number): number[] => {
    const start = key * stride + (interpolation === "CUBICSPLINE" ? part * size : 0);
    return Array.from(output.slice(start, start + size));
  };
  if (time <= input[0]) return valueAt(0, 1);
  if (time >= input[input.length - 1]) return valueAt(input.length - 1, 1);
  let index = 0;
  while (index + 1 < input.length && time >= input[index + 1]) index += 1;
  const next = Math.min(index + 1, input.length - 1);
  const t0 = input[index];
  const t1 = input[next];
  const factor = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0;
  if (interpolation === "STEP" || next === index) return valueAt(index, 1);
  if (interpolation === "LINEAR") {
    const a = valueAt(index, 1);
    const b = valueAt(next, 1);
    if (quaternion) return slerp(a, b, factor);
    const result = a.map((value, component) => value * (1 - factor) + b[component] * factor);
    return result;
  }

  const dt = t1 - t0;
  const p0 = valueAt(index, 1);
  const p1 = valueAt(next, 1);
  const m0 = valueAt(index, 2).map((value) => value * dt);
  const m1 = valueAt(next, 0).map((value) => value * dt);
  const u2 = factor * factor;
  const u3 = u2 * factor;
  return p0.map((value, component) =>
    (2 * u3 - 3 * u2 + 1) * value +
      (u3 - 2 * u2 + factor) * m0[component] +
      (-2 * u3 + 3 * u2) * p1[component] +
      (u3 - u2) * m1[component],
  );
}

function slerp(a: number[], b: number[], factor: number): number[] {
  let ax = a[0] ?? 0;
  let ay = a[1] ?? 0;
  let az = a[2] ?? 0;
  let aw = a[3] ?? 1;
  let bx = b[0] ?? 0;
  let by = b[1] ?? 0;
  let bz = b[2] ?? 0;
  let bw = b[3] ?? 1;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let first = 1 - factor;
  if (dot < 0.9995) {
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    first = Math.sin(first * theta) / sinTheta;
    factor = Math.sin(factor * theta) / sinTheta;
  }
  ax = ax * first + bx * factor;
  ay = ay * first + by * factor;
  az = az * first + bz * factor;
  aw = aw * first + bw * factor;
  if (dot >= 0.9995) {
    const scale = 1 / Math.sqrt(ax * ax + ay * ay + az * az + aw * aw);
    ax *= scale; ay *= scale; az *= scale; aw *= scale;
  }
  return [ax, ay, az, aw];
}

/**
 * Matrices de mundo de cada nodo, con la jerarquía ya acumulada, en fila-mayor.
 *
 * Publicada para que auditar movimiento no obligue a reimplementar la cadena de
 * transformaciones: la que hay aquí es la que está certificada contra Three.js,
 * y una segunda copia divergiría en el primer detalle que alguien arreglara solo
 * en una.
 */
export function computeWorlds(document: GltfDocument, states: NodeState[]): Mat4[] {
  const nodes = document.nodes ?? [];
  const worlds = nodes.map(() => identity());
  const roots = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_node, index) => index);
  const visited = new Set<number>();
  const visit = (index: number, parent: Mat4): void => {
    if (visited.has(index)) return;
    const state = states[index];
    if (!state) return;
    visited.add(index);
    const local = state.matrix ? [...state.matrix] : quaternionMatrix(state.translation, state.rotation, state.scale);
    worlds[index] = multiply(parent, local);
    for (const child of nodes[index]?.children ?? []) visit(child, worlds[index]);
  };
  for (const root of roots) visit(root, identity());
  for (let index = 0; index < nodes.length; index += 1) visit(index, identity());
  return worlds;
}

function readAccessor(
  document: GltfDocument,
  binary: Uint8Array,
  accessorIndex: number,
  cache: Map<number, NumericArray>,
  decodedViews: Map<number, Uint8Array>,
): NumericArray {
  const cached = cache.get(accessorIndex);
  if (cached) return cached;
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`accesor ${accessorIndex} inexistente`);
  if (accessor.sparse) {
    throw new Error(`accesor ${accessorIndex} es sparse; los accesors sparse no se soportan`);
  }
  const componentCount = COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!componentCount || !componentBytes) {
    throw new Error(`accesor ${accessorIndex}: tipo ${accessor.type}/${accessor.componentType} no soportado`);
  }
  const result = new Float64Array(accessor.count * componentCount);
  if (accessor.bufferView === undefined) {
    cache.set(accessorIndex, result);
    return result;
  }
  const bufferView = document.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`vista de búfer ${accessor.bufferView} inexistente`);
  const decoded = decodedViews.get(accessor.bufferView);
  const source = decoded ?? binary;
  const base = (decoded ? 0 : bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? componentCount * componentBytes;
  const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const divisor = accessor.normalized ? NORMALIZE_DIVISOR[accessor.componentType] ?? 1 : 1;
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      const offset = base + element * stride + component * componentBytes;
      const value = readComponent(data, offset, accessor.componentType);
      result[element * componentCount + component] = divisor === 1 ? value : normalizeComponent(value, accessor.componentType);
    }
  }
  cache.set(accessorIndex, result);
  return result;
}

function readComponent(data: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return data.getInt8(offset);
    case 5121: return data.getUint8(offset);
    case 5122: return data.getInt16(offset, true);
    case 5123: return data.getUint16(offset, true);
    case 5125: return data.getUint32(offset, true);
    case 5126: return data.getFloat32(offset, true);
    default: throw new Error(`componentType ${componentType} no soportado`);
  }
}

function normalizeComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    case 5125: return value / 4294967295;
    default: return value;
  }
}

/**
 * Parsea un GLB para la evaluación de animación, con las vistas meshopt ya
 * decodificadas. Se distingue de `parseGlb` (glbLoader) porque devuelve el árbol
 * de nodos tal cual —necesario para resolver el skinning— en vez de aplastarlo a
 * piezas de modelo.
 */
export function parseGlbAnimation(buffer: ArrayBuffer, decoder?: MeshoptDecoderLike): ParsedGlb {
  const header = new DataView(buffer);
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67) {
    throw new Error("no es un GLB: falta la firma 'glTF'");
  }
  if (header.getUint32(4, true) !== 2) throw new Error("versión de glTF no soportada (se espera 2)");
  let offset = 12;
  let document: GltfDocument | null = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= header.byteLength) {
    const length = header.getUint32(offset, true);
    const type = header.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    if (type === 0x004e4942) binary = new Uint8Array(buffer, start, length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!document) throw new Error("GLB sin bloque JSON");
  const sceneCount = document.scenes?.length ?? 0;
  if (sceneCount > 1) {
    throw new Error(`el GLB tiene ${sceneCount} escenas; el contrato solo evalúa la activa (${document.scene ?? 0})`);
  }
  if ((document.buffers ?? []).some((entry) => entry.uri !== undefined)) {
    throw new Error("GLB con búfer externo (.bin aparte); solo se admite autocontenido");
  }
  if (!binary) throw new Error("GLB sin bloque BIN");
  const decodedViews = new Map<number, Uint8Array>();
  let compressedCount = 0;
  for (const view of document.bufferViews ?? []) if (view.extensions?.EXT_meshopt_compression) compressedCount += 1;
  if (compressedCount > 0 && (!decoder || !decoder.supported)) {
    throw new Error("este GLB requiere EXT_meshopt_compression; instala `meshoptimizer` para evaluar sus poses");
  }
  if ((document.extensionsRequired ?? []).includes("EXT_meshopt_compression") && compressedCount === 0) {
    throw new Error("GLB declara EXT_meshopt_compression pero no contiene vistas comprimidas");
  }
  for (const [index, view] of (document.bufferViews ?? []).entries()) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (!compressed) continue;
    const source = new Uint8Array(
      binary.buffer,
      binary.byteOffset + (compressed.byteOffset ?? 0),
      compressed.byteLength,
    );
    const target = new Uint8Array(compressed.count * compressed.byteStride);
    decoder!.decodeGltfBuffer(target, compressed.count, compressed.byteStride, source, compressed.mode, compressed.filter ?? "NONE");
    decodedViews.set(index, target);
  }
  return { document, binary, decodedViews };
}

function countMorphTargets(document: GltfDocument): number {
  return (document.meshes ?? []).reduce(
    (total, mesh) => total + mesh.primitives.reduce((count, primitive) => count + (primitive.targets?.length ?? 0), 0),
    0,
  );
}

function inspectMorphTargets(document: GltfDocument): string[] {
  const errors: string[] = [];
  (document.meshes ?? []).forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      (primitive.targets ?? []).forEach((target, targetIndex) => {
        const positionIndex = target.POSITION;
        if (positionIndex === undefined) return;
        const accessor = document.accessors?.[positionIndex];
        if (!accessor || accessor.type !== "VEC3") {
          errors.push(`El morph target ${meshIndex}/${primitiveIndex}/${targetIndex} no se puede evaluar: POSITION debe ser VEC3.`);
        }
      });
    });
  });
  return errors;
}

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let inner = 0; inner < 4; inner += 1) result[row * 4 + column] += a[row * 4 + inner] * b[inner * 4 + column];
    }
  }
  return result;
}

function transformPoint(matrix: Mat4, point: number[]): number[] {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

function matrixFromColumnMajor(values: NumericArray | number[]): Mat4 {
  const matrix = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) matrix[row * 4 + column] = values[column * 4 + row] ?? 0;
  return matrix;
}

function quaternionMatrix(translation: number[], rotation: number[], scale: number[]): Mat4 {
  const [x, y, z, w] = rotation;
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  const [sx, sy, sz] = scale;
  return [
    (1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, translation[0],
    (xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, translation[1],
    (xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, translation[2],
    0, 0, 0, 1,
  ];
}
