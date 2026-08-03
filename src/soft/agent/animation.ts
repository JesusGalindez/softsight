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

interface GltfDocument {
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

interface GltfAnimation {
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

interface NodeState {
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

interface ParsedGlb {
  document: GltfDocument;
  binary: Uint8Array;
  decodedViews: Map<number, Uint8Array>;
}

/** Inspecciona la animación y, si se entrega una referencia, certifica poses. */
export async function inspectGlbAnimation(
  buffer: ArrayBuffer,
  controlPoses: AnimationControlPoseReference | null = null,
  decoder?: MeshoptDecoderLike,
): Promise<SoftSightAnimationInspection> {
  if (decoder) await decoder.ready;
  const parsed = parseGlb(buffer, decoder);
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
  const cache = new Map<number, NumericArray>();
  const positions: number[] = [];
  const nodes = document.nodes ?? [];
  const sceneRoots = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_node, index) => index);
  const visiting = new Set<number>();

  const visit = (nodeIndex: number): void => {
    if (visiting.has(nodeIndex)) return;
    visiting.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) return;
    const mesh = node.mesh === undefined ? undefined : document.meshes?.[node.mesh];
    const skin = node.skin === undefined ? undefined : document.skins?.[node.skin];
    if (mesh) {
      for (const primitive of mesh.primitives) {
        const positionIndex = primitive.attributes.POSITION;
        if (positionIndex === undefined) continue;
        const base = readAccessor(document, binary, positionIndex, cache, decodedViews);
        const joints = primitive.attributes.JOINTS_0 === undefined
          ? null
          : readAccessor(document, binary, primitive.attributes.JOINTS_0, cache, decodedViews);
        const weights = primitive.attributes.WEIGHTS_0 === undefined
          ? null
          : readAccessor(document, binary, primitive.attributes.WEIGHTS_0, cache, decodedViews);
        const jointMatrices = skin ? buildJointMatrices(document, binary, decodedViews, skin, worlds, cache) : null;
        const morphWeights = resolveMorphWeights(mesh, states[nodeIndex]);
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
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const root of sceneRoots) visit(root);
  for (let index = 0; index < nodes.length; index += 1) visit(index);
  const bytes = new Uint8Array(positions.length * 4);
  const view = new DataView(bytes.buffer);
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function buildJointMatrices(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  skin: GltfSkin,
  worlds: Mat4[],
  cache: Map<number, NumericArray>,
): Mat4[] {
  if (skin.inverseBindMatrices === undefined) return [];
  const inverse = readAccessor(document, binary, skin.inverseBindMatrices, cache, decodedViews);
  return skin.joints.map((joint, index) => {
    const inverseBind = matrixFromColumnMajor(inverse.slice(index * 16, index * 16 + 16));
    const matrix = multiply(worlds[joint] ?? identity(), inverseBind);
    return matrix;
  });
}

function applySkin(
  local: number[],
  joints: NumericArray,
  weights: NumericArray,
  vertex: number,
  jointMatrices: Mat4[],
): number[] {
  const result = [0, 0, 0];
  let totalWeight = 0;
  for (let influence = 0; influence < 4; influence += 1) totalWeight += weights[vertex * 4 + influence] ?? 0;
  if (totalWeight === 0 || !Number.isFinite(totalWeight)) return local;
  for (let influence = 0; influence < 4; influence += 1) {
    // GLTFLoader normalizes skin weights on load and writes them back to a
    // Float32BufferAttribute. Reproduce that rounding so the checksum agrees
    // with the reference renderer even for sums just below one.
    const weight = Math.fround((weights[vertex * 4 + influence] ?? 0) / totalWeight);
    const joint = joints[vertex * 4 + influence] ?? -1;
    if (weight === 0 || joint < 0 || !jointMatrices[joint]) continue;
    const point = transformPoint(jointMatrices[joint], local);
    result[0] += point[0] * weight;
    result[1] += point[1] * weight;
    result[2] += point[2] * weight;
  }
  return result;
}

function buildNodeStates(document: GltfDocument): NodeState[] {
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

function applyMorphTargets(
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

function applyAnimation(
  document: GltfDocument,
  binary: Uint8Array,
  decodedViews: Map<number, Uint8Array>,
  animation: GltfAnimation,
  states: NodeState[],
  time: number,
): void {
  const cache = new Map<number, NumericArray>();
  for (const channel of animation.channels) {
    const nodeIndex = channel.target.node;
    const sampler = animation.samplers[channel.sampler];
    if (nodeIndex === undefined || !sampler || !states[nodeIndex]) continue;
    const input = readAccessor(document, binary, sampler.input, cache, decodedViews);
    const output = readAccessor(document, binary, sampler.output, cache, decodedViews);
    const interpolation = sampler.interpolation ?? "LINEAR";
    const outputStride = interpolation === "CUBICSPLINE" ? 3 : 1;
    const path = channel.target.path;
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

function computeWorlds(document: GltfDocument, states: NodeState[]): Mat4[] {
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

function parseGlb(buffer: ArrayBuffer, decoder?: MeshoptDecoderLike): ParsedGlb {
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
