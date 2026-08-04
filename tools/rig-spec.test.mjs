/**
 * Puerta del esqueleto declarativo, los clips declarativos y la auditoría de
 * animación.
 *
 * Las tres piezas son para que un agente construya un personaje entero sin salir
 * del JSON, así que lo que se comprueba es lo que un agente falla de verdad:
 *
 *   1. Que la rotación declarada signifique **lo mismo** en un hueso que en una
 *      pieza. Dos convenciones en el mismo fichero es la forma más barata de que
 *      nadie confíe en ninguna, así que se compara contra la matriz que produce
 *      `modelFromScene` para la misma terna de grados.
 *   2. Que un clip declarado mueva de verdad la pieza, evaluado con el evaluador
 *      certificado y no con una aritmética paralela.
 *   3. Que la auditoría **cace un cruce que solo existe en un fotograma** y que
 *      no avise de los que ya estaban en reposo, que es lo que la haría inútil.
 */

import assert from "node:assert/strict";

import {
  auditAnimation,
  bindModelToSkeleton,
  eulerToQuaternion,
  evaluatePose,
  modelFromScene,
  parseGlbAnimation,
  resolveRig,
  serializeSkinnedGlb,
} from "../dist-node/agent3d.mjs";

// --- 1. La rotación declarada significa lo mismo en un hueso que en una pieza

const grados = [30, 45, 60];
const conObjeto = modelFromScene({
  objects: [{ name: "p", geometry: { primitive: "box", parameters: [1, 1, 1] }, rotation: grados }],
}).parts[0].matrix;
const conHueso = matrixFromQuaternion(eulerToQuaternion(grados));
for (let index = 0; index < 12; index += 1) {
  assert.ok(
    Math.abs(conObjeto[index] - conHueso[index]) < 1e-5,
    `la rotación de un hueso no coincide con la de una pieza en el componente ${index}: ` +
      `${conObjeto[index]} contra ${conHueso[index]}`,
  );
}

// --- 2. Un esqueleto y un clip declarados, evaluados por el evaluador certificado

const esqueleto = {
  joints: [
    { name: "cadera", offset: [0, 1, 0] },
    { name: "torso", parent: "cadera", offset: [0, 1, 0] },
    { name: "hombro", parent: "torso", offset: [0.9, 0.5, 0] },
  ],
};

const rig = resolveRig(esqueleto, [
  {
    name: "saludo",
    fps: 30,
    tracks: [
      // El hombro se mete dentro del torso a mitad del clip y vuelve. Es un
      // cruce que en reposo no existe: exactamente lo que la auditoría busca.
      {
        joint: "hombro",
        property: "translation",
        keys: [
          { frame: 0, value: [0.9, 0.5, 0] },
          { frame: 15, value: [0, 0.5, 0] },
          { frame: 30, value: [0.9, 0.5, 0] },
        ],
      },
      // El torso lleva una pieza y no lo anima nadie: la auditoría tiene que
      // decirlo, y por eso este clip no le pone pista.
    ],
  },
]);

assert.deepEqual(
  rig.skeleton.nodes.map((node) => node.name),
  ["cadera", "torso", "hombro"],
);
assert.deepEqual(rig.skeleton.roots, [0]);
assert.deepEqual(rig.skeleton.nodes[0].children, [1]);
assert.deepEqual(rig.skeleton.nodes[1].children, [2]);
assert.deepEqual(rig.clips, [{ name: "saludo", fps: 30, lastFrame: 30, tracks: 1 }]);
// Los tiempos salen de frame/fps, no de una duración inventada.
assert.deepEqual(Array.from(rig.skeleton.animations[0].samplers[0].times), [0, 0.5, 1]);
// Y una rotación de 90° en Y da el cuaternión que le toca.
const noventa = eulerToQuaternion([0, 90, 0]);
assertClose(noventa, [0, Math.SQRT1_2, 0, Math.SQRT1_2], "90° en Y");

// --- 3. Se ata a un modelo y se comprueba que el clip mueve lo que dice

const model = modelFromScene({
  objects: [
    { name: "torso", geometry: { primitive: "box", parameters: [1, 2, 1] }, position: [0, 2, 0] },
    { name: "brazo", geometry: { primitive: "box", parameters: [0.4, 1.4, 0.4] }, position: [0.9, 2.5, 0] },
  ],
});

const binding = {
  schemaVersion: 1,
  bindings: [
    { part: "brazo", joint: "hombro" },
    { part: "*", joint: "torso" },
  ],
};
const bound = bindModelToSkeleton(model, rig.skeleton, binding);
const rigged = parseGlbAnimation(serializeSkinnedGlb(bound.scene));

// En el fotograma 15 el brazo está 0.9 más a la izquierda que en el 0: es la
// traslación declarada, evaluada por el evaluador certificado.
const enReposo = evaluatePose(rigged.document, rigged.binary, rigged.decodedViews, 0, 0, 0);
const enQuince = evaluatePose(rigged.document, rigged.binary, rigged.decodedViews, 15 / 30, 0, 0);
const primerVerticeBrazo = (model.parts[0].mesh.positions.length / 3) * 3;
assert.ok(
  Math.abs(enReposo[primerVerticeBrazo] - enQuince[primerVerticeBrazo] - 0.9) < 1e-4,
  `el brazo debía moverse 0.9 en X y se movió ${enReposo[primerVerticeBrazo] - enQuince[primerVerticeBrazo]}`,
);

// --- 4. La auditoría caza el cruce, y solo el que la animación provocó

const jointOfPart = new Map(bound.bound.map((entry) => [entry.part, entry.joint]));
const audit = auditAnimation(model, rigged, jointOfPart, { fps: 30, sampleFrames: 7 });

assert.deepEqual(audit.clips.map((clip) => clip.name), ["saludo"]);
assert.equal(audit.clips[0].lastFrame, 30);
assert.ok(audit.clips[0].sampled.includes(15), `el muestreo no miró el fotograma 15: ${audit.clips[0].sampled}`);

const enElCruce = audit.crossings.filter((crossing) => crossing.frame === 15);
assert.ok(enElCruce.length > 0, "la auditoría no vio el brazo dentro del torso en el fotograma 15");
assert.deepEqual(enElCruce[0].parts.slice().sort(), ["brazo", "torso"]);
assert.ok(enElCruce[0].overlap > 0, "el cruce salió con solape cero");

// En reposo no hay cruce, así que los fotogramas de los extremos están limpios.
assert.equal(
  audit.crossings.filter((crossing) => crossing.frame === 0 || crossing.frame === 30).length,
  0,
  "avisó de un cruce en un fotograma donde las piezas están separadas",
);

// El hueso 'cadera' lleva el torso pero ninguna pista lo anima: eso se dice.
assert.deepEqual(audit.staticBones, ["torso"]);
assert.deepEqual(audit.groundBreaches, []);

// --- 5. Un cruce que ya está en reposo no se reporta -------------------------
// Dos piezas superpuestas desde el principio: la animación no las rompió, así
// que avisar de ellas en cada fotograma sería el ruido que tapa la señal.

const solapado = modelFromScene({
  objects: [
    { name: "a", geometry: { primitive: "box", parameters: [1, 1, 1] }, position: [0, 1, 0] },
    { name: "b", geometry: { primitive: "box", parameters: [1, 1, 1] }, position: [0.1, 1, 0] },
  ],
});
const rigQuieto = resolveRig({ joints: [{ name: "raiz" }] }, [
  {
    name: "quieto",
    tracks: [{ joint: "raiz", property: "translation", keys: [{ frame: 0, value: [0, 0, 0] }, { frame: 10, value: [0, 0, 0] }] }],
  },
]);
const atadoSolapado = bindModelToSkeleton(solapado, rigQuieto.skeleton, {
  schemaVersion: 1,
  bindings: [{ part: "*", joint: "raiz" }],
});
const auditSolapado = auditAnimation(
  solapado,
  parseGlbAnimation(serializeSkinnedGlb(atadoSolapado.scene)),
  new Map(atadoSolapado.bound.map((entry) => [entry.part, entry.joint])),
  { fps: 30, sampleFrames: 4 },
);
assert.deepEqual(auditSolapado.crossings, [], "reportó un cruce que ya existía en reposo");

// --- 6. Lo que hay que rechazar ---------------------------------------------

assertThrows(() => resolveRig({ joints: [] }), /lista no vacía de huesos/, "un esqueleto sin huesos");

assertThrows(
  () => resolveRig({ joints: [{ name: "a" }, { name: "a" }] }),
  /'a' está declarado dos veces/,
  "dos huesos con el mismo nombre",
);

assertThrows(
  () => resolveRig({ joints: [{ name: "a", parent: "fantasma" }] }),
  /cuelga de 'fantasma', que no está declarado/,
  "un padre que no existe",
);

assertThrows(
  () => resolveRig({ joints: [{ name: "a", parent: "b" }, { name: "b", parent: "a" }] }),
  /ciclo|ninguna raíz/,
  "un ciclo entre dos huesos",
);

assertThrows(
  () => resolveRig(esqueleto, [{ tracks: [{ joint: "codo", property: "rotation", keys: [{ frame: 0, value: [0, 0, 0] }] }] }]),
  /el hueso 'codo' no está declarado/,
  "una pista sobre un hueso inventado",
);

assertThrows(
  () =>
    resolveRig(esqueleto, [
      {
        tracks: [
          { joint: "torso", property: "rotation", keys: [{ frame: 10, value: [0, 0, 0] }, { frame: 5, value: [0, 0, 0] }] },
        ],
      },
    ]),
  /no va después del anterior/,
  "claves desordenadas",
);

assertThrows(
  () =>
    resolveRig(esqueleto, [
      { tracks: [{ joint: "torso", property: "translation", keys: [{ frame: 0, value: [1, 2] }] }] },
    ]),
  /translation pide 3 números, hay 2/,
  "un valor con los componentes equivocados",
);

assertThrows(
  () => resolveRig(esqueleto, [{ fps: 0, tracks: [{ joint: "torso", property: "scale", keys: [{ frame: 0, value: [1, 1, 1] }] }] }]),
  /fps debe ser un número positivo/,
  "un clip a cero fotogramas por segundo",
);

console.log(
  `rig spec: ok (${rig.skeleton.nodes.length} huesos, ${audit.clips[0].sampled.length} fotogramas auditados, ` +
    `${audit.crossings.length} cruce(s) cazado(s))`,
);

/** Matriz fila-mayor de un cuaternión `xyzw`, para comparar convenciones. */
function matrixFromQuaternion([x, y, z, w]) {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  return [
    1 - (y * y2 + z * z2), x * y2 - w * z2, x * z2 + w * y2, 0,
    x * y2 + w * z2, 1 - (x * x2 + z * z2), y * z2 - w * x2, 0,
    x * z2 - w * y2, y * z2 + w * x2, 1 - (x * x2 + y * y2), 0,
    0, 0, 0, 1,
  ];
}

function assertClose(actual, expected, what) {
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-6,
      `${what}: componente ${index} vale ${actual[index]} y se esperaba ${expected[index]}`,
    );
  }
}

function assertThrows(run, pattern, what) {
  assert.throws(run, pattern, `se aceptó ${what}`);
}
