import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectGlbAnimation,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
// El fixture de salto (jumping-jacks) vive en el proyecto hermano After effect ThreeJS.
const targetRoot = resolve(projectRoot, "../../Codex/After effect ThreeJS");
const modelPath = resolve(targetRoot, "public/fixtures/jumping-jacks.glb");
const referencePath = resolve(targetRoot, "public/fixtures/jumping-jacks-control-poses.json");

const model = await readFile(modelPath);
const reference = JSON.parse(await readFile(referencePath, "utf8"));
const actual = await inspectGlbAnimation(toArrayBuffer(model), reference);
assert.equal(actual.animation.status, "accepted");
assert.equal(actual.animation.clips.length, 1);
assert.equal(actual.skinning.status, "accepted");
assert.deepEqual(actual.controlPoses, Object.entries(reference.clips).flatMap(([clipName, poses]) =>
  poses.map((pose) => ({ clipName, ...pose })),
));
assert.deepEqual(actual.errors, []);

const morph = buildMorphGlb();
const morphReference = {
  schemaVersion: 1,
  fps: 30,
  clips: {
    Morph: [
      { frame: 0, positionsHash: hashPositions([1, 2, 3]) },
      { frame: 30, positionsHash: hashPositions([3, 2, 3]) },
    ],
  },
};
const morphInspection = await inspectGlbAnimation(morph, morphReference);
assert.equal(morphInspection.animation.status, "accepted");
assert.equal(morphInspection.morphTargets.status, "accepted");
assert.equal(morphInspection.morphTargets.count, 1);
assert.deepEqual(morphInspection.controlPoses, [
  { clipName: "Morph", frame: 0, positionsHash: hashPositions([1, 2, 3]) },
  { clipName: "Morph", frame: 30, positionsHash: hashPositions([3, 2, 3]) },
]);
assert.deepEqual(morphInspection.errors, []);

const { MeshoptDecoder, MeshoptEncoder } = await import("meshoptimizer");
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const compressed = buildMorphGlb(MeshoptEncoder);
const compressedInspection = await inspectGlbAnimation(compressed, morphReference, MeshoptDecoder);
assert.equal(compressedInspection.animation.status, "accepted");
assert.deepEqual(compressedInspection.controlPoses, morphInspection.controlPoses);
await assert.rejects(
  inspectGlbAnimation(compressed, morphReference),
  /EXT_meshopt_compression/,
);

console.log("animation contract: ok");

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function hashPositions(values) {
  const hash = createHash("sha256");
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

function buildMorphGlb(encoder = null) {
  const sources = [
    { bytes: floatBytes([1, 2, 3]), count: 1, stride: 12 },
    { bytes: floatBytes([2, 0, 0]), count: 1, stride: 12 },
    { bytes: floatBytes([0, 1]), count: 2, stride: 4 },
    { bytes: floatBytes([0, 0, 1, 0, 1, 0]), count: 6, stride: 4 },
  ];
  let payload = Buffer.alloc(0);
  const views = [];
  for (const source of sources) {
    const compressed = encoder
      ? Buffer.from(encoder.encodeGltfBuffer(source.bytes, source.count, source.stride, "ATTRIBUTES"))
      : source.bytes;
    const byteOffset = payload.length;
    payload = Buffer.concat([payload, compressed]);
    views.push({
      buffer: 0,
      byteOffset: encoder ? undefined : byteOffset,
      byteLength: compressed.length,
      ...(encoder ? {
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset,
            byteLength: compressed.length,
            byteStride: source.stride,
            count: source.count,
            mode: "ATTRIBUTES",
          },
        },
      } : {}),
    });
  }
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: payload.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 1, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 1, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 6, type: "SCALAR" },
    ],
    meshes: [{ weights: [0], primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }] }] }],
    nodes: [{ mesh: 0, weights: [0] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      name: "Morph",
      samplers: [{ input: 2, output: 3, interpolation: "CUBICSPLINE" }],
      channels: [{ sampler: 0, target: { node: 0, path: "weights" } }],
    }],
    ...(encoder ? { extensionsUsed: ["EXT_meshopt_compression"], extensionsRequired: ["EXT_meshopt_compression"] } : {}),
  };
  return makeGlb(document, payload);
}

function floatBytes(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
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
