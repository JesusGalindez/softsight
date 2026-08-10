/**
 * Puerta del escritor con esqueleto.
 *
 * El criterio no es que el fichero abra: es que las poses evaluadas del fichero
 * escrito den **los mismos hashes** que las del original, en los mismos frames de
 * control. Un GLB con las matrices de enlace transpuestas, con los joints
 * reordenados o con los pesos desalineados abre perfectamente y anima mal; lo
 * único que caza esos tres fallos es comparar el número.
 *
 * La ida y vuelta pasa por la representación declarativa, no por los bytes: se
 * lee el fichero con `parseGlbAnimation`, se levanta a `SkinnedGlbScene` y se
 * vuelve a escribir. Así la prueba no es «copiar un fichero» sino reconstruirlo.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { fixture, requireFixtures } from "./fixtures.mjs";

import {
  evaluatePose,
  parseGlbAnimation,
  readAccessorValues,
  serializeSkinnedGlb,
} from "../dist-node/agent3d.mjs";

// El fixture de salto (jumping-jacks) vive en el proyecto hermano After effect ThreeJS.
await requireFixtures("glb-writer", ["jumping-jacks.glb", "jumping-jacks-control-poses.json"]);
const modelPath = fixture("jumping-jacks.glb");
const referencePath = fixture("jumping-jacks-control-poses.json");

const model = await readFile(modelPath);
const reference = JSON.parse(await readFile(referencePath, "utf8"));

const original = parseGlbAnimation(toArrayBuffer(model));
assert.ok(original.document.skins?.length > 0, "el fixture no trae piel; la puerta no probaría nada");
assert.ok(original.document.animations?.length > 0, "el fixture no trae clips");

const rewritten = parseGlbAnimation(serializeSkinnedGlb(sceneFromParsed(original)));

// La forma se conserva: mismas mallas, misma piel con los mismos joints, mismos
// clips con los mismos canales.
assert.equal(rewritten.document.meshes.length, original.document.meshes.length);
assert.equal(rewritten.document.nodes.length, original.document.nodes.length);
assert.equal(rewritten.document.skins.length, original.document.skins.length);
assert.deepEqual(rewritten.document.skins[0].joints, original.document.skins[0].joints);
assert.equal(rewritten.document.animations.length, original.document.animations.length);
assert.equal(
  rewritten.document.animations[0].channels.length,
  original.document.animations[0].channels.length,
);
assert.deepEqual(
  rewritten.document.nodes.map((node) => node.name ?? null),
  original.document.nodes.map((node) => node.name ?? null),
);

// Y lo que de verdad importa: los cuatro frames de control dan el mismo hash.
const clipNames = rewritten.document.animations.map((animation) => animation.name ?? "");
const meshIndex = rewritten.document.meshes.findIndex((mesh) =>
  mesh.primitives.some((primitive) => primitive.attributes.POSITION !== undefined),
);
assert.ok(meshIndex >= 0, "el fichero reescrito no declara una malla con POSITION");

let checked = 0;
for (const [clipName, poses] of Object.entries(reference.clips)) {
  const clipIndex = clipNames.indexOf(clipName);
  assert.ok(clipIndex >= 0, `el fichero reescrito perdió el clip ${clipName}`);
  for (const pose of poses) {
    const positions = evaluatePose(
      rewritten.document,
      rewritten.binary,
      rewritten.decodedViews,
      pose.frame / reference.fps,
      meshIndex,
      clipIndex,
    );
    assert.equal(
      hashFloat32(positions),
      pose.positionsHash,
      `pose reescrita de ${clipName} frame ${pose.frame}`,
    );
    checked += 1;
  }
}
assert.ok(checked >= 4, `se esperaban al menos 4 poses de control, se comprobaron ${checked}`);

// El fichero reescrito no arrastra la compresión del original: si el fixture
// venía con meshopt, el nuestro sale plano y aun así da los mismos hashes.
assert.equal(rewritten.document.extensionsRequired ?? undefined, undefined);

// --- Lo que el escritor tiene que rechazar antes de escribir ----------------
// Cada uno de estos casos produce un GLB que abre y anima mal. Fallar aquí, con
// el mensaje puesto, es la diferencia entre un error y un misterio.

const triangle = {
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: Uint32Array.from([0, 1, 2]),
};

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "malla", mesh: 0 }],
      meshes: [{ primitives: [{ ...triangle, joints: Uint16Array.from([0, 0, 0, 0]) }] }],
    }),
  /JOINTS_0 y WEIGHTS_0 van juntos/,
  "un atributo de piel sin el otro",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "malla", mesh: 0 }],
      meshes: [
        {
          primitives: [
            {
              ...triangle,
              joints: Uint16Array.from(new Array(12).fill(0)),
              weights: Float32Array.from([1, 0, 0, 0]),
            },
          ],
        },
      ],
    }),
  /WEIGHTS_0 pide 4 pesos por vértice/,
  "pesos desalineados con los vértices",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "raiz" }],
      meshes: [],
      skins: [{ joints: [0], inverseBindMatrices: Float32Array.from([1, 0, 0, 0]) }],
    }),
  /piden 16 valores de matriz, hay 4/,
  "matrices de enlace incompletas",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "raiz" }],
      meshes: [],
      skins: [{ joints: [7] }],
    }),
  /el joint 7 no es un nodo de la escena/,
  "joint que apunta fuera de la escena",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "raiz", matrix: new Array(16).fill(0), translation: [0, 0, 0] }],
      meshes: [],
    }),
  /no admite 'matrix' junto a translation/,
  "matriz y TRS declaradas a la vez",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "raiz" }],
      meshes: [],
      animations: [
        {
          samplers: [{ times: Float32Array.from([0, 1]), values: Float32Array.from([0, 0, 0, 0, 0, 0]) }],
          channels: [
            { sampler: 0, node: 0, path: "translation" },
            { sampler: 0, node: 0, path: "rotation" },
          ],
        },
      ],
    }),
  /no puede servir a 'rotation'/,
  "un muestreador compartido entre rutas de distinto tipo",
);

assertThrows(
  () =>
    serializeSkinnedGlb({
      nodes: [{ name: "raiz" }],
      meshes: [],
      animations: [
        {
          samplers: [{ times: Float32Array.from([0]), values: Float32Array.from([0, 0, 0]) }],
          channels: [{ sampler: 0, node: 9, path: "translation" }],
        },
      ],
    }),
  /el nodo 9 no existe/,
  "canal que apunta a un nodo inexistente",
);

// --- Caso mínimo escrito desde cero, sin partir de ningún fichero -----------
// Dos joints, un triángulo pegado al segundo, y un clip que lo desplaza. Es el
// camino que recorrerá un movimiento generado fuera: nada de esto viene de un
// GLB previo.
const minimal = parseGlbAnimation(
  serializeSkinnedGlb({
    nodes: [
      { name: "raiz", children: [1, 2], translation: [0, 0, 0] },
      { name: "hueso", translation: [0, 0, 0] },
      { name: "piel", mesh: 0, skin: 0 },
    ],
    meshes: [
      {
        primitives: [
          {
            ...triangle,
            joints: Uint16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            weights: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
            baseColor: [0.8, 0.2, 0.2],
          },
        ],
      },
    ],
    skins: [{ joints: [1], inverseBindMatrices: identityColumnMajor(1) }],
    animations: [
      {
        name: "Desplazar",
        samplers: [
          { times: Float32Array.from([0, 1]), values: Float32Array.from([0, 0, 0, 0, 2, 0]) },
        ],
        channels: [{ sampler: 0, node: 1, path: "translation" }],
      },
    ],
  }),
);
assert.equal(minimal.document.skins.length, 1);
assert.equal(minimal.document.animations[0].name, "Desplazar");
// En t=0 el hueso está en su sitio; en t=1 ha subido 2 en Y y se lleva la piel
// entera con él, porque los tres vértices pesan 1 sobre ese único joint.
assert.deepEqual(
  Array.from(evaluatePose(minimal.document, minimal.binary, minimal.decodedViews, 0, 0, 0)),
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
);
assert.deepEqual(
  Array.from(evaluatePose(minimal.document, minimal.binary, minimal.decodedViews, 1, 0, 0)),
  [0, 2, 0, 1, 2, 0, 0, 3, 0],
);

console.log(`glb writer: ok (${checked} poses de control reescritas)`);

/**
 * Levanta un GLB ya parseado a la descripción declarativa del escritor.
 *
 * Es también el ejemplo de cómo se construye una escena desde fuera: quien traiga
 * un BVH o un movimiento generado rellena estas mismas estructuras.
 */
function sceneFromParsed(parsed) {
  const document = parsed.document;
  const f32 = (index) => Float32Array.from(readAccessorValues(parsed, index));
  const u16 = (index) => Uint16Array.from(readAccessorValues(parsed, index));
  const u32 = (index) => Uint32Array.from(readAccessorValues(parsed, index));
  const optional = (index, read) => (index === undefined ? undefined : read(index));

  const meshes = (document.meshes ?? []).map((mesh) => ({
    name: mesh.name,
    weights: mesh.weights,
    primitives: mesh.primitives.map((primitive) => ({
      positions: f32(primitive.attributes.POSITION),
      normals: optional(primitive.attributes.NORMAL, f32),
      uvs: optional(primitive.attributes.TEXCOORD_0, f32),
      joints: optional(primitive.attributes.JOINTS_0, u16),
      weights: optional(primitive.attributes.WEIGHTS_0, f32),
      indices: optional(primitive.indices, u32),
      targets: primitive.targets?.map((target) => ({
        positions: optional(target.POSITION, f32),
        normals: optional(target.NORMAL, f32),
      })),
    })),
  }));

  const skins = (document.skins ?? []).map((skin) => ({
    name: skin.name,
    joints: skin.joints,
    // Las matrices de enlace salen del accesor por columnas y entran al escritor
    // por columnas: no se transponen en ningún punto del viaje.
    inverseBindMatrices: optional(skin.inverseBindMatrices, f32),
    skeleton: skin.skeleton,
  }));

  const animations = (document.animations ?? []).map((animation) => ({
    name: animation.name,
    samplers: animation.samplers.map((sampler) => ({
      times: f32(sampler.input),
      values: f32(sampler.output),
      interpolation: sampler.interpolation,
    })),
    channels: animation.channels
      .filter((channel) => channel.target.node !== undefined)
      .map((channel) => ({
        sampler: channel.sampler,
        node: channel.target.node,
        path: channel.target.path,
      })),
  }));

  const nodes = (document.nodes ?? []).map((node) => ({
    name: node.name,
    matrix: node.matrix,
    translation: node.translation,
    rotation: node.rotation,
    scale: node.scale,
    children: node.children,
    mesh: node.mesh,
    skin: node.skin,
    weights: node.weights,
  }));

  const scene = document.scenes?.[document.scene ?? 0];
  return { nodes, meshes, skins, animations, roots: scene?.nodes };
}

function identityColumnMajor(count) {
  const values = new Float32Array(count * 16);
  for (let joint = 0; joint < count; joint += 1) {
    for (let axis = 0; axis < 4; axis += 1) values[joint * 16 + axis * 5] = 1;
  }
  return values;
}

function assertThrows(run, pattern, what) {
  assert.throws(run, pattern, `el escritor aceptó ${what}`);
}

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
