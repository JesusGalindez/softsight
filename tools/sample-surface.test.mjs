import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { fixture, requireFixtures } from "./fixtures.mjs";

import {
  SAMPLE_REFERENCE_SCHEMA,
  assertValid,
  evaluatePose,
  evaluatePoseWithNormals,
  evaluateSample,
  hashSamplesAtFrames,
  parseGlbAnimation,
  sampleSurface,
  validateSampleReference,
} from "../dist-node/agent3d.mjs";

// El fixture de salto (jumping-jacks) vive en el proyecto hermano After effect ThreeJS.
await requireFixtures("sample-surface", ["jumping-jacks.glb"]);
const modelPath = fixture("jumping-jacks.glb");

const model = await readFile(modelPath);
const parsed = parseGlbAnimation(toArrayBuffer(model));

// C2: muestreo determinista. Misma semilla → mismas referencias, en el mismo
// orden; otra semilla → otras referencias. El orden y el algoritmo son contrato.
const sampleA = sampleSurface(parsed.document, parsed.binary, parsed.decodedViews, { count: 16, seed: 1234 });
const sampleB = sampleSurface(parsed.document, parsed.binary, parsed.decodedViews, { count: 16, seed: 1234 });
const sampleC = sampleSurface(parsed.document, parsed.binary, parsed.decodedViews, { count: 16, seed: 5678 });
assert.deepEqual(sampleA, sampleB);
assert.notDeepEqual(sampleA, sampleC);
assert.equal(sampleA.length, 16);
assert.ok(sampleA.every((reference) =>
  typeof reference.mesh === "string" && Number.isInteger(reference.primitive)
  && Number.isInteger(reference.triangle) && reference.barycentric.length === 3,
));

// La malla del fixture no tiene nombre: la referencia la resuelve por el nodo.
assert.equal(sampleA[0].mesh, "Skinned Mesh 0");

// C1: las referencias generadas pasan la validación semántica.
for (const reference of sampleA) {
  const weights = validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, reference);
  assert.ok(weights.every((value) => value >= 0));
}

// La forma la valida el esquema publicado, con sugerencias como en el resto.
assert.throws(() => assertValid({ primitive: 0, triangle: 1, barycentric: [1, 0, 0] }, SAMPLE_REFERENCE_SCHEMA, "r"),
  /falta mesh/);
assert.throws(() => assertValid({ ...sampleA[0], baricentric: [1, 0, 0] }, SAMPLE_REFERENCE_SCHEMA, "r"),
  /baricentric no existe/);

// C1: errores de referencia escrita a mano — malla, primitiva, triángulo y pesos.
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], mesh: "No existe" }),
  /no hay malla llamada 'No existe'/,
);
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], primitive: 3 }),
  /no tiene primitiva 3/,
);
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], triangle: 10_000_000 }),
  /el triángulo 10000000/,
);
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], barycentric: [2, 0] }),
  /suman 2/,
);
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], barycentric: [1, 0, -0.5] }),
  /no negativos/,
);
assert.throws(
  () => validateSampleReference(parsed.document, parsed.binary, parsed.decodedViews, { ...sampleA[0], barycentric: [1, 0, 0, 0] }),
  /dos o tres/,
);

// C3: una referencia sobre un vértice ([1,0,0]) evalúa exactamente la posición
// y la normal de ese vértice en cada frame: la cadena de muestreo es la misma
// que la de las poses de control. El índice del vértice sale del búfer de
// índices de la primitiva 0 (accesor 5, uint16).
const meshIndex = parsed.document.meshes.findIndex((mesh) =>
  mesh.primitives.some((primitive) => primitive.attributes.POSITION !== undefined),
);
const indices = readUint16Accessor(parsed, 5);
const clipNames = (parsed.document.animations ?? []).map((animation) => animation.name ?? "");
assert.deepEqual(clipNames, ["Jumping_Jacks"]);
for (const frame of [0, 15, 30, 37]) {
  const triangle = (frame * 791) % 13_757;
  const vertex = indices[triangle * 3];
  const reference = { mesh: "Skinned Mesh 0", primitive: 0, triangle, barycentric: [1, 0, 0] };
  const evaluated = evaluateSample(parsed.document, parsed.binary, parsed.decodedViews, frame / 30, reference, 0);
  const pose = evaluatePose(parsed.document, parsed.binary, parsed.decodedViews, frame / 30, meshIndex, 0);
  const normals = evaluatePoseWithNormals(parsed.document, parsed.binary, parsed.decodedViews, frame / 30, meshIndex, 0);
  assert.deepEqual(Array.from(evaluated.positions), [pose[vertex * 3], pose[vertex * 3 + 1], pose[vertex * 3 + 2]]);
  assert.deepEqual(Array.from(evaluated.normals), [normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]]);
  assert.ok(evaluated.uvs.length === 2);
  assert.ok(Array.from(evaluated.uvs).every((value) => Number.isFinite(value)));
}

// C2: huellas por frame, deterministas y distintas entre frames animados.
const frames = [0, 15, 30, 37];
const hashes = await hashSamplesAtFrames(parsed.document, parsed.binary, parsed.decodedViews, sampleA, frames, 30, 0);
const hashesAgain = await hashSamplesAtFrames(parsed.document, parsed.binary, parsed.decodedViews, sampleA, frames, 30, 0);
assert.deepEqual(hashes, hashesAgain);
assert.deepEqual(hashes.map((entry) => entry.frame), frames);
assert.ok(hashes.every((entry) => entry.positionsHash.startsWith("sha256:") && typeof entry.normalsHash === "string"));
assert.notEqual(hashes[0].positionsHash, hashes[1].positionsHash, "los frames animados deben diferir");

// GLB mínimo sin índices, sin NORMAL y sin UV: la referencia es secuencial, y
// normals/uvs se quedan en nulo en vez de inventarse.
const minimal = buildMinimalGlb();
const minimalParsed = parseGlbAnimation(minimal);
const reference = { mesh: "malla 0", primitive: 0, triangle: 0, barycentric: [0.25, 0.25, 0.5] };
const weights = validateSampleReference(minimalParsed.document, minimalParsed.binary, minimalParsed.decodedViews, reference);
assert.deepEqual(weights, [0.25, 0.25, 0.5]);
const evaluated = evaluateSample(minimalParsed.document, minimalParsed.binary, minimalParsed.decodedViews, 0, reference, 0);
// Vértices [0,0,0] [1,0,0] [0,1,0] → 0.25·P0 + 0.25·P1 + 0.5·P2 = [0.25, 0.5, 0].
assert.deepEqual(Array.from(evaluated.positions), [0.25, 0.5, 0]);
assert.equal(evaluated.normals, null);
assert.equal(evaluated.uvs, null);
const minimalHashes = await hashSamplesAtFrames(minimalParsed.document, minimalParsed.binary, minimalParsed.decodedViews, [reference], [0], 30, 0);
assert.equal(minimalHashes[0].normalsHash, null);
assert.equal(minimalHashes[0].positionsHash, hashFloat32([0.25, 0.5, 0]));

console.log("sample surface: ok");

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function hashFloat32(values) {
  const hash = createHash("sha256");
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

/** Lee el accesor 5 (índices uint16) del fixture: bufferView 5 sin offset. */
function readUint16Accessor(parsed, accessorIndex) {
  const accessor = parsed.document.accessors[accessorIndex];
  const view = parsed.document.bufferViews[accessor.bufferView];
  const byteOffset = parsed.binary.byteOffset + (accessor.byteOffset ?? 0) + (view.byteOffset ?? 0);
  const values = new Uint16Array(parsed.binary.buffer, byteOffset, accessor.count);
  return Array.from(values);
}

function buildMinimalGlb() {
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 54 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 42, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 1, type: "VEC3" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      name: "Clip",
      samplers: [{ input: 2, output: 2, interpolation: "STEP" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    }],
  };
  const binary = Buffer.concat([
    floatBytes([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uint16Bytes([0, 1, 2]),
    floatBytes([0, 0, 0]),
  ]);
  return makeGlb(document, binary);
}

function floatBytes(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

function uint16Bytes(values) {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return bytes;
}

function makeGlb(document, binary) {
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return toArrayBuffer(Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]));
}
