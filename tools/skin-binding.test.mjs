/**
 * Puerta del atado de malla a esqueleto.
 *
 * El atado es rígido, así que su resultado es exacto y se puede afirmar en
 * cerrado: en reposo, un vértice atado tiene que quedar **donde estaba**, y con
 * el hueso movido, exactamente donde lo lleve el hueso. Nada de tolerancias
 * generosas ni de «se parece»: si la matriz de enlace está transpuesta o si
 * alguien se olvidó de llevar los vértices a espacio de modelo, la diferencia
 * salta en el primer decimal.
 *
 * Tres cosas se comprueban, en este orden:
 *
 *   1. La pose de reposo devuelve el modelo intacto.
 *   2. Mover un hueso mueve su pieza y **solo** su pieza.
 *   3. Lo que hay que rechazar: piezas sin atar, huesos que no existen.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bindModelToSkeleton,
  evaluatePose,
  loadModel,
  modelFromScene,
  parseGlbAnimation,
  serializeSkinnedGlb,
  skeletonFromParsedGlb,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

// --- Un modelo de dos piezas y un esqueleto de dos huesos -------------------

const model = modelFromScene({
  objects: [
    { name: "torso", geometry: { primitive: "box", parameters: [1, 1, 1] }, position: [0, 0, 0] },
    { name: "brazo", geometry: { primitive: "box", parameters: [1, 1, 1] }, position: [2, 0, 0] },
  ],
});
assert.equal(model.parts.length, 2);

// El hueso «Brazo» cuelga de «Raiz» y está en (2,0,0), justo donde la pieza que
// va a llevar. El clip lo sube 3 en Y entre t=0 y t=1.
const skeleton = skeletonFromParsedGlb(
  parseGlbAnimation(
    serializeSkinnedGlb({
      nodes: [
        { name: "Raiz", translation: [0, 0, 0], rotation: [0, 0, 0, 1], children: [1] },
        { name: "Brazo", translation: [2, 0, 0], rotation: [0, 0, 0, 1] },
      ],
      meshes: [],
      animations: [
        {
          name: "Subir",
          samplers: [{ times: Float32Array.from([0, 1]), values: Float32Array.from([2, 0, 0, 2, 3, 0]) }],
          channels: [{ sampler: 0, node: 1, path: "translation" }],
        },
      ],
      roots: [0],
    }),
  ),
);

const { scene, bound, unusedJoints } = bindModelToSkeleton(model, skeleton, {
  schemaVersion: 1,
  bindings: [
    { part: "brazo", joint: "Brazo" },
    { part: "*", joint: "Raiz" },
  ],
});

assert.deepEqual(bound, [
  { part: "torso", joint: "Raiz" },
  { part: "brazo", joint: "Brazo" },
]);
assert.deepEqual(unusedJoints, []);
// Una malla con una primitiva por pieza: comparten piel y cada una conserva su
// material, que es lo que se perdería fundiéndolas en una sola.
assert.equal(scene.meshes.length, 1);
assert.equal(scene.meshes[0].primitives.length, 2);
assert.equal(scene.skins.length, 1);
assert.deepEqual(scene.skins[0].joints, [0, 1]);
assert.equal(scene.animations[0].name, "Subir");

const rigged = parseGlbAnimation(serializeSkinnedGlb(scene));

// 1. En reposo, el modelo intacto. Las posiciones esperadas son las de cada
// pieza ya llevadas a espacio de mundo, que es lo que se ve sin animar.
const expectedRest = modelSpacePositions(model);
const atRest = Array.from(evaluatePose(rigged.document, rigged.binary, rigged.decodedViews, 0, 0, 0));
assertAllClose(atRest, expectedRest, "la pose de reposo devuelve el modelo intacto");

// 2. Con el hueso arriba, su pieza sube y la otra no se mueve ni un decimal.
const moved = Array.from(evaluatePose(rigged.document, rigged.binary, rigged.decodedViews, 1, 0, 0));
const torsoVertices = model.parts[0].mesh.positions.length / 3;
const expectedMoved = expectedRest.map((value, index) => {
  const vertex = Math.floor(index / 3);
  const isArm = vertex >= torsoVertices;
  return isArm && index % 3 === 1 ? value + 3 : value;
});
assertAllClose(moved, expectedMoved, "mover un hueso mueve su pieza y solo su pieza");

// --- El dron real: 296 piezas atadas a un solo hueso ------------------------
// Con un único hueso en el origen y sin animar, el modelo entero tiene que
// sobrevivir bit a bit. Es la prueba de que el atado no deforma nada por su
// cuenta cuando no se lo pide nadie.

const dronePath = resolve(projectRoot, "artifacts/export/drone.glb");
const droneBytes = await readFile(dronePath);
const drone = await loadModel(
  dronePath,
  droneBytes.buffer.slice(droneBytes.byteOffset, droneBytes.byteOffset + droneBytes.byteLength),
);
assert.ok(drone.parts.length > 100, `el dron trae ${drone.parts.length} piezas`);

const quieto = skeletonFromParsedGlb(
  parseGlbAnimation(
    serializeSkinnedGlb({
      nodes: [{ name: "Raiz", translation: [0, 0, 0], rotation: [0, 0, 0, 1] }],
      meshes: [],
      roots: [0],
    }),
  ),
);
const droneBound = bindModelToSkeleton(drone, quieto, {
  schemaVersion: 1,
  bindings: [{ part: "*", joint: "Raiz" }],
});
assert.equal(droneBound.scene.meshes[0].primitives.length, drone.parts.length);

const droneRigged = parseGlbAnimation(serializeSkinnedGlb(droneBound.scene));
const droneRest = evaluatePose(droneRigged.document, droneRigged.binary, droneRigged.decodedViews, 0, 0, 0);
const droneExpected = modelSpacePositions(drone);
assert.equal(droneRest.length, droneExpected.length);
assertAllClose(Array.from(droneRest), droneExpected, `el dron de ${drone.parts.length} piezas sobrevive al atado`);

// --- Lo que hay que rechazar ------------------------------------------------

assertThrows(
  () => bindModelToSkeleton(model, skeleton, { schemaVersion: 1, bindings: [{ part: "brazo", joint: "Brazo" }] }),
  /1 pieza\(s\) sin hueso: torso/,
  "una pieza sin regla que la ate",
);

assertThrows(
  () => bindModelToSkeleton(model, skeleton, { schemaVersion: 1, bindings: [{ part: "*", joint: "Codo" }] }),
  /el esqueleto no tiene 'Codo'/,
  "un hueso que el esqueleto no declara",
);

assertThrows(
  () => bindModelToSkeleton(model, skeleton, { schemaVersion: 2, bindings: [{ part: "*", joint: "Raiz" }] }),
  /schemaVersion 2 desconocida/,
  "un documento de vínculo de otra versión",
);

assertThrows(
  () => bindModelToSkeleton(model, skeleton, { schemaVersion: 1, bindings: [] }),
  /'bindings' debe ser una lista no vacía/,
  "un vínculo sin reglas",
);

// El orden manda: la primera regla que encaja gana, así que el cajón de sastre
// puesto delante se lo lleva todo. No es un fallo, es la regla; pero tiene que
// comportarse igual siempre.
const primeraGana = bindModelToSkeleton(model, skeleton, {
  schemaVersion: 1,
  bindings: [
    { part: "*", joint: "Raiz" },
    { part: "brazo", joint: "Brazo" },
  ],
});
assert.deepEqual(
  primeraGana.bound.map((entry) => entry.joint),
  ["Raiz", "Raiz"],
);
assert.deepEqual(primeraGana.unusedJoints, ["Brazo"]);

console.log(`skin binding: ok (2 piezas exactas, ${drone.parts.length} del dron sin deformar)`);

/** Posiciones de cada pieza ya en espacio de modelo, en el orden del modelo. */
function modelSpacePositions(source) {
  const out = [];
  for (const part of source.parts) {
    const { positions } = part.mesh;
    const m = part.matrix;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      out.push(
        m[0] * x + m[1] * y + m[2] * z + m[3],
        m[4] * x + m[5] * y + m[6] * z + m[7],
        m[8] * x + m[9] * y + m[10] * z + m[11],
      );
    }
  }
  return out;
}

function assertAllClose(actual, expected, what) {
  assert.equal(actual.length, expected.length, `${what}: longitudes distintas`);
  let worst = 0;
  let worstIndex = -1;
  for (let index = 0; index < expected.length; index += 1) {
    const delta = Math.abs(actual[index] - expected[index]);
    if (delta > worst) {
      worst = delta;
      worstIndex = index;
    }
  }
  assert.ok(
    worst < 1e-4,
    `${what}: la mayor diferencia es ${worst} en el componente ${worstIndex} ` +
      `(${actual[worstIndex]} contra ${expected[worstIndex]})`,
  );
}

function assertThrows(run, pattern, what) {
  assert.throws(run, pattern, `el atado aceptó ${what}`);
}
