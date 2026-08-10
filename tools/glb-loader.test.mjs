import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { fixture, requireFixtures } from "./fixtures.mjs";

import {
  evaluatePose,
  inspectGlbAnimation,
  parseGlbAnimation,
} from "../dist-node/agent3d.mjs";

// El fixture de salto (jumping-jacks) vive en el proyecto hermano After effect ThreeJS.
await requireFixtures("glb-loader", ["jumping-jacks.glb", "jumping-jacks-control-poses.json"]);
const modelPath = fixture("jumping-jacks.glb");
const referencePath = fixture("jumping-jacks-control-poses.json");

// El sano: un vértice, un joint, un clip que mueve el joint en Y. La pose a 0,5 s
// es [0, 0.5, 0] y es repetible: dos evaluaciones dan los mismos bytes.
const healthy = buildSkinnedGlb();
const healthyParsed = parseGlbAnimation(healthy);
const healthyPose = evaluatePose(healthyParsed.document, healthyParsed.binary, healthyParsed.decodedViews, 0.5, 0, 0);
assert.deepEqual(Array.from(healthyPose), [0, 0.5, 0]);
const again = evaluatePose(healthyParsed.document, healthyParsed.binary, healthyParsed.decodedViews, 0.5, 0, 0);
assert.deepEqual(Array.from(again), Array.from(healthyPose));

// Cada defecto de datos lanza un error con el nombre del defecto, no un aviso:
// el CLI traduce las excepciones a salida 2 y aquí se comprueba el mensaje.
// Los casos "parse" se cazan al leer el GLB; los "evaluate", al evaluar la pose.
const cases = [
  ["canal con nodo objetivo inexistente", (document) => {
    document.animations[0].channels[0].target.node = 99;
  }, /nodo objetivo 99 inexistente/, "evaluate"],
  ["sampler inexistente", (document) => {
    document.animations[0].channels[0].sampler = 7;
  }, /sampler 7 inexistente/, "evaluate"],
  ["path desconocido", (document) => {
    document.animations[0].channels[0].target.path = "scaleX";
  }, /path 'scaleX' desconocido/, "evaluate"],
  ["joint fuera de rango en el vértice", (document, { addAttribute }) => {
    addAttribute(document, "JOINTS_0", [2, 0, 0, 0], 5126);
  }, /joint 2 fuera de rango/, "evaluate"],
  ["joint fuera de rango en la skin", (document) => {
    document.skins[0].joints = [5];
  }, /joint 5 fuera de rango/, "evaluate"],
  ["pesos negativos", (document, { addAttribute }) => {
    addAttribute(document, "WEIGHTS_0", [-1, 0, 0, 0], 5126);
  }, /no negativos/, "evaluate"],
  ["inverseBindMatrices ausentes", (document) => {
    delete document.skins[0].inverseBindMatrices;
  }, /no declara inverseBindMatrices/, "evaluate"],
  ["inverseBindMatrices incompletas", (document) => {
    document.accessors[3].count = 0;
    document.bufferViews[3].byteLength = 0;
    document.buffers[0].byteLength -= 16 * 4;
  }, /inverseBindMatrices incompletas/, "evaluate"],
  ["inverseBindMatrices que no son MAT4", (document) => {
    document.accessors[3].type = "VEC3";
  }, /debe ser MAT4/, "evaluate"],
  ["JOINTS_1/WEIGHTS_1", (document) => {
    document.meshes[0].primitives[0].attributes.JOINTS_1 = 1;
  }, /JOINTS_1\/WEIGHTS_1/, "evaluate"],
  ["accesor sparse", (document) => {
    document.accessors[0].sparse = { count: 1 };
  }, /sparse/, "evaluate"],
  ["múltiples escenas", (document) => {
    document.scenes = [{ nodes: [0, 1] }, { nodes: [0, 1] }];
  }, /tiene 2 escenas/, "parse"],
];

for (const [name, mutate, expected, kind] of cases) {
  const glb = buildSkinnedGlb(mutate);
  if (kind === "parse") {
    assert.throws(() => parseGlbAnimation(glb), expected, name);
  } else {
    const parsed = parseGlbAnimation(glb);
    assert.throws(
      () => evaluatePose(parsed.document, parsed.binary, parsed.decodedViews, 0.5, 0, 0),
      expected,
      name,
    );
  }
}

// GLB malformado: la firma del encabezado lo delata antes de leer nada.
assert.throws(() => parseGlbAnimation(new ArrayBuffer(20)), /firma/);
assert.throws(() => parseGlbAnimation(toArrayBuffer(Buffer.from("no es un glb"))), /firma/);

// El fixture sano sigue pasando la certificación completa con poses de control,
// sin cambiar sus hashes (criterio de salida: un GLB sano no cambia su pose).
const model = await readFile(modelPath);
const reference = JSON.parse(await readFile(referencePath, "utf8"));
const fixtureParsed = parseGlbAnimation(toArrayBuffer(model));
assert.equal(fixtureParsed.document.scenes.length, 1);
const inspection = await inspectGlbAnimation(toArrayBuffer(model), reference);
assert.equal(inspection.animation.status, "accepted");
assert.deepEqual(inspection.errors, []);

console.log("glb loader robustness: ok");

function buildSkinnedGlb(mutate) {
  const positions = floatBytes([0, 0, 0]);
  const joints = floatBytes([0, 0, 0, 0]);
  const weights = floatBytes([1, 0, 0, 0]);
  const ibm = floatBytes([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const input = floatBytes([0, 1]);
  const output = floatBytes([0, 0, 0, 0, 1, 0]);
  const sources = [
    { bytes: positions, stride: 12, count: 1 },
    { bytes: joints, stride: 4, count: 1 },
    { bytes: weights, stride: 16, count: 1 },
    { bytes: ibm, stride: 64, count: 1 },
    { bytes: input, stride: 4, count: 2 },
    { bytes: output, stride: 12, count: 2 },
  ];
  let payload = Buffer.alloc(0);
  const views = [];
  for (const source of sources) {
    const byteOffset = payload.length;
    payload = Buffer.concat([payload, source.bytes]);
    views.push({ buffer: 0, byteOffset, byteLength: source.bytes.length });
  }
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: payload.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 1, type: "VEC3" },
      { bufferView: 1, componentType: 5121, count: 1, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 1, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 1, type: "MAT4" },
      { bufferView: 4, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 5, componentType: 5126, count: 2, type: "VEC3" },
    ],
    meshes: [{
      name: "Mesh",
      primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }],
    }],
    nodes: [
      { name: "Joint", translation: [0, 1, 0] },
      { name: "MeshNode", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0], inverseBindMatrices: 3, skeleton: 0 }],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
    animations: [{
      name: "Clip",
      samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    }],
  };
  if (mutate) {
    mutate(document, {
      addAttribute(document, attribute, values, componentType) {
        const bytes = floatBytes(values);
        const byteOffset = payload.length;
        payload = Buffer.concat([payload, bytes]);
        const viewIndex = document.bufferViews.length;
        document.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
        document.buffers[0].byteLength += bytes.length;
        const accessorIndex = document.accessors.length;
        document.accessors.push({
          bufferView: viewIndex,
          componentType,
          count: values.length / 4,
          type: "VEC4",
        });
        document.meshes[0].primitives[0].attributes[attribute] = accessorIndex;
      },
    });
  }
  return makeGlb(document, payload);
}

function floatBytes(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
