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
  auditSkin,
  bindModelToSkeleton,
  evaluatePose,
  loadModel,
  modelFromScene,
  parseGlbAnimation,
  resolveRig,
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

// --- La banda: la costura deja de abrirse ----------------------------------
//
// El paso 0 de docs/plan-pesos.md midió la grieta de un codo declarado como dos
// piezas rígidas que se tocan: **0,106066 unidades a 90°**, que es exactamente la
// cuerda 2·r·sin(θ/2). Aquí se afirma lo mismo por los dos lados: sin banda se
// abre esa cifra, y con banda no se abre nada. Una tolerancia generosa taparía
// justo el fallo que esto vigila, así que el cerrado se exige a cero exacto.

// La escena es la versionada, no una copia: `test:blend-contract` certifica sus
// hashes contra Three.js, y dos escenas parecidas en dos ficheros acabarían
// midiendo cosas distintas con el mismo nombre.
//
// Sus dos bandas declaran la misma costura desde cada lado: el brazo la tiene en
// t = 1 de su segmento hombro→codo, y el antebrazo en t = 0 del suyo codo→hombro.
// Las dos están centradas en ella, así que el vértice compartido sale 0,5 y 0,5.
const CODO = JSON.parse(
  await readFile(resolve(projectRoot, "artifacts/agent/codo-banda.json"), "utf8"),
);
const CON_BANDA = CODO.bindings;
assert.equal(CON_BANDA.filter((rule) => rule.blend).length, 2, "la escena versionada trae dos bandas");

/** La misma escena sin repartir: es lo que había antes de que existiera `blend`. */
const RIGIDO = CON_BANDA.map(({ part, joint }) => ({ part, joint }));

const sinBanda = aperturaDeLaCostura(CODO, RIGIDO);
assert.equal(
  Number(sinBanda.toFixed(6)),
  0.106066,
  `sin banda la costura tiene que abrirse la cuerda medida en el paso 0, y se abrió ${sinBanda}`,
);

// Con banda no se abre, y «no se abre» tiene un suelo que conviene decir: la
// costura ya trae 3,0e-8 **en reposo**, porque las dos tapas se generan por
// caminos distintos —0,2+0,2 y 0,6−0,2— y `Float32` no los redondea igual. Lo que
// se afirma es que doblar 90° no la separa más allá de ese ruido, no que dos
// números flotantes salgan idénticos.
const enReposo = aperturaDeLaCostura(CODO, CON_BANDA, 0);
const conBanda = aperturaDeLaCostura(CODO, CON_BANDA);
assert.ok(enReposo < 1e-7, `la costura en reposo ya trae ${enReposo}, que no es ruido de Float32`);
assert.ok(
  conBanda < 1e-7,
  `con banda la costura no se abre más que el ruido de Float32, y se abrió ${conBanda}`,
);

// Los pesos, uno a uno: suman 1 en todos los vértices, y en la costura el reparto
// es mitad y mitad. `linear` da la media exacta en el punto medio de la banda, que
// es lo que hace comprobable la curva sin depender de la forma de la malla.
const bandaLineal = bindModelToSkeleton(modelFromScene({ ...CODO, bindings: CON_BANDA }), resolveRig(CODO.skeleton, CODO.clips).skeleton, {
  schemaVersion: 1,
  bindings: CON_BANDA,
});
let vertices = 0;
let enLaCostura = 0;
for (const primitive of bandaLineal.scene.meshes[0].primitives) {
  const total = primitive.weights.length / 4;
  for (let vertex = 0; vertex < total; vertex += 1) {
    const suma =
      primitive.weights[vertex * 4] +
      primitive.weights[vertex * 4 + 1] +
      primitive.weights[vertex * 4 + 2] +
      primitive.weights[vertex * 4 + 3];
    assert.ok(Math.abs(suma - 1) < 1e-6, `un vértice pesa ${suma} en total, y tiene que pesar 1`);
    // Mitad y mitad, con la misma holgura que el resto: el `t` de un vértice sale
    // de restar posiciones ya redondeadas a Float32, así que un lado de la costura
    // cae en 0,5 exacto y el otro a un ulp.
    if (Math.abs(primitive.weights[vertex * 4] - 0.5) < 1e-6) enLaCostura += 1;
    vertices += 1;
  }
}
assert.equal(enLaCostura, 132, "los 66 pares de la costura reparten mitad y mitad por los dos lados");

// --- Los invariantes de la piel ---------------------------------------------
//
// Los cuatro avisos de `auditSkin`, cada uno sobre un caso construido para él. Los
// dos primeros no se pueden provocar por la vía pública —el atado escribe pesos
// válidos siempre—, así que se le da a la auditoría un resultado ya roto: es una
// función pura del atado, y romperlo a mano es la única forma de comprobar que lo
// caza. Los otros dos sí salen de una escena mal declarada.

const atado = (bindings, escena = CODO) =>
  bindModelToSkeleton(modelFromScene({ ...escena, bindings }, "codo"), resolveRig(escena.skeleton, escena.clips).skeleton, {
    schemaVersion: 1,
    bindings,
  });

const esqueletoDelCodo = resolveRig(CODO.skeleton, CODO.clips).skeleton;

assert.deepEqual(
  auditSkin(atado(CON_BANDA), esqueletoDelCodo).map((aviso) => aviso.code),
  [],
  "el codo bien declarado no puede traer ni un aviso de piel",
);
assert.deepEqual(
  auditSkin(atado(RIGIDO), esqueletoDelCodo).map((aviso) => aviso.code),
  [],
  "y el mismo codo rígido tampoco: dos piezas que comparten costura sin banda son el atado rígido de siempre",
);

// El informe no tiene que deducir del GLB si hubo reparto: el atado lo dice.
assert.deepEqual(atado(CON_BANDA).blendedParts.slice().sort(), ["antebrazo", "brazo"]);
assert.deepEqual(atado(RIGIDO).blendedParts, []);

const roto = (cambiar) => {
  const base = atado(CON_BANDA);
  const primitives = base.scene.meshes[0].primitives.map((primitive) => ({
    ...primitive,
    weights: Float32Array.from(primitive.weights),
    joints: Uint16Array.from(primitive.joints),
  }));
  cambiar(primitives);
  return { ...base, scene: { ...base.scene, meshes: [{ ...base.scene.meshes[0], primitives }] } };
};

const sinHueso = auditSkin(
  roto((primitives) => {
    for (let slot = 0; slot < 4; slot += 1) primitives[0].weights[slot] = 0;
  }),
  esqueletoDelCodo,
);
assert.deepEqual(sinHueso.map((aviso) => aviso.code), ["VERTICE_SIN_HUESO"]);
assert.match(sinHueso[0].message, /el vértice 0 no lo mueve ningún hueso/);

const sinSumar = auditSkin(
  roto((primitives) => {
    primitives[0].weights[0] = 0.25;
    primitives[0].weights[1] = 0.25;
  }),
  esqueletoDelCodo,
);
assert.deepEqual(sinSumar.map((aviso) => aviso.code), ["PESOS_SIN_SUMAR"]);
assert.match(sinSumar[0].message, /suman 0\.500000 y no 1/);

// La costura rota de verdad: las dos bandas declaradas sin centrar en el mismo
// sitio, que es el error que se comete al escribirlas de memoria.
const descentrada = auditSkin(
  atado([
    { part: "antebrazo", joint: "codo", blend: { with: "hombro", from: -0.15, to: 0.15 } },
    { part: "brazo", joint: "hombro", blend: { with: "codo", from: 0.9, to: 1.2 } },
  ]),
  esqueletoDelCodo,
);
assert.deepEqual(descentrada.map((aviso) => aviso.code), ["COSTURA_ROTA"]);
assert.match(descentrada[0].message, /comparten un vértice en reposo y lo reparten distinto/);

// Y la torsión: el eje del hueso es Y, así que girar el codo 120° sobre Y es girar
// sobre su propio eje. Doblarlo sobre Z, que es lo que hace el clip de siempre, no
// lo dispara: la mezcla lineal se porta bien flexionando.
const torcido = {
  ...CODO,
  clips: [
    {
      name: "retorcer",
      fps: 30,
      tracks: [
        {
          joint: "codo",
          property: "rotation",
          keys: [
            { frame: 0, value: [0, 0, 0] },
            { frame: 30, value: [0, 120, 0] },
          ],
        },
      ],
    },
  ],
};
const torsion = auditSkin(
  atado(CON_BANDA, torcido),
  resolveRig(torcido.skeleton, torcido.clips).skeleton,
);
assert.deepEqual(torsion.map((aviso) => aviso.code), ["TORSION_APLASTADA"]);
assert.match(torsion[0].message, /gira 120° sobre su propio eje/);

// --- Lo que hay que rechazar de una banda -----------------------------------

const conBandaMala = (blend) => () =>
  bindModelToSkeleton(
    modelFromScene({ ...CODO, bindings: RIGIDO }),
    resolveRig(CODO.skeleton, CODO.clips).skeleton,
    {
      schemaVersion: 1,
      bindings: [{ part: "*", joint: "codo", blend }],
    },
  );

assertThrows(
  conBandaMala({ with: "muñeca", from: 0, to: 1 }),
  /el esqueleto no tiene 'muñeca'/,
  "una banda hacia un hueso que no existe",
);
assertThrows(
  conBandaMala({ with: "codo", from: 0, to: 1 }),
  /reparte 'codo' consigo mismo/,
  "una banda de un hueso contra sí mismo",
);
assertThrows(
  conBandaMala({ with: "hombro", from: 1, to: 0 }),
  /`from` tiene que ser menor que `to`/,
  "una banda con el rango del revés",
);
assertThrows(
  conBandaMala({ with: "hombro", from: 0, to: 0 }),
  /`from` tiene que ser menor que `to`/,
  "una banda de ancho cero",
);
assertThrows(
  conBandaMala({ with: "hombro", from: 0, to: 1, ease: "rebote" }),
  /ease desconocido "rebote"/,
  "una banda con una curva que no existe",
);

// Y lo que hay que rechazar de una **lista** de bandas.
assertThrows(
  conBandaMala([
    { with: "hombro", from: 0, to: 1 },
    { with: "hombro", from: 2, to: 3 },
  ]),
  /ya reparte hacia 'hombro'/,
  "dos bandas de la misma regla hacia el mismo hueso",
);
assertThrows(
  conBandaMala([
    { with: "hombro", from: 0, to: 1 },
    { with: "codo", from: 0, to: 1 },
    { with: "hombro", from: 0, to: 1 },
    { with: "codo", from: 0, to: 1 },
  ]),
  /declara 4 bandas y caben 3/,
  "más bandas de las que caben en las cuatro influencias de glTF",
);

// El solape: dos bandas anchas hacia dos huesos distintos se llevan más de lo que
// hay, y el hueso de la regla se quedaría con peso negativo. Solaparse vale;
// pasarse, no.
{
  const trenza = {
    ...CODO,
    skeleton: {
      joints: [
        { name: "hombro", offset: [0, 0, 0] },
        { name: "codo", parent: "hombro", offset: [0, 0.4, 0] },
        { name: "muneca", parent: "codo", offset: [0, 0.75, 0] },
      ],
    },
  };
  assertThrows(
    () =>
      bindModelToSkeleton(
        modelFromScene({ ...trenza, bindings: RIGIDO }, "codo"),
        resolveRig(trenza.skeleton, trenza.clips).skeleton,
        {
          schemaVersion: 1,
          bindings: [
            {
              part: "*",
              joint: "codo",
              blend: [
                { with: "hombro", from: -5, to: 5 },
                { with: "muneca", from: -5, to: 5 },
              ],
            },
          ],
        },
      ),
    /se llevan .* del vértice .*, más de lo que hay/,
    "dos bandas que entre las dos se llevan más de 1",
  );
}

console.log(
  `skin binding: ok (2 piezas exactas, ${drone.parts.length} del dron sin deformar; ` +
    `la costura del codo pasa de ${sinBanda.toFixed(6)} a ${conBanda.toExponential(1)} con banda ` +
    `—el reposo ya trae ${enReposo.toExponential(1)}—, ${vertices} vértices sumando 1, ` +
    `y los 4 avisos de piel saltan solo donde deben)`,
);

/**
 * Cuánto se abre la costura entre dos piezas en el fotograma más doblado.
 *
 * La costura son los vértices que en reposo ocupan la misma posición y están en
 * piezas distintas. Es la misma definición con la que se midió el paso 0, y la
 * que usará `COSTURA_ROTA`.
 */
function aperturaDeLaCostura(spec, bindings, soloFrame = null) {
  const bound = bindModelToSkeleton(
    modelFromScene({ ...spec, bindings }),
    resolveRig(spec.skeleton, spec.clips).skeleton,
    { schemaVersion: 1, bindings },
  );
  const rigged = parseGlbAnimation(serializeSkinnedGlb(bound.scene));
  const pose = (time) => evaluatePose(rigged.document, rigged.binary, rigged.decodedViews, time, 0, 0);

  const cuentas = bound.scene.meshes[0].primitives.map((primitive) => primitive.positions.length / 3);
  const arranques = [];
  let acumulado = 0;
  for (const cuenta of cuentas) {
    arranques.push(acumulado);
    acumulado += cuenta;
  }

  const reposo = pose(0);
  const punto = (posiciones, indice) => [
    posiciones[indice * 3],
    posiciones[indice * 3 + 1],
    posiciones[indice * 3 + 2],
  ];
  const clave = (p) => p.map((valor) => valor.toFixed(6)).join(",");

  const costura = [];
  for (let a = 0; a < cuentas.length; a += 1) {
    const porPosicion = new Map();
    for (let i = 0; i < cuentas[a]; i += 1) porPosicion.set(clave(punto(reposo, arranques[a] + i)), arranques[a] + i);
    for (let b = a + 1; b < cuentas.length; b += 1) {
      for (let i = 0; i < cuentas[b]; i += 1) {
        const gemelo = porPosicion.get(clave(punto(reposo, arranques[b] + i)));
        if (gemelo !== undefined) costura.push([gemelo, arranques[b] + i]);
      }
    }
  }
  assert.equal(costura.length, 66, "el codo de dos cilindros comparte 66 vértices en reposo");

  const fps = spec.clips[0].fps;
  const ultimo =
    soloFrame ?? Math.max(...spec.clips[0].tracks.flatMap((track) => track.keys.map((key) => key.frame)));
  let peor = 0;
  for (let frame = soloFrame ?? 0; frame <= ultimo; frame += 1) {
    const posiciones = pose(frame / fps);
    for (const [a, b] of costura) {
      const pa = punto(posiciones, a);
      const pb = punto(posiciones, b);
      peor = Math.max(peor, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
    }
  }
  return peor;
}

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
