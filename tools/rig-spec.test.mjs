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
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  auditAnimation,
  bindModelToSkeleton,
  eulerToQuaternion,
  evaluatePose,
  modelFromScene,
  parseGlbAnimation,
  auditClips,
  resolveRig,
  serializeSkinnedGlb,
} from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

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

// --- 7. La escena declarativa llega hasta el puente -------------------------
// Sin esto, todo lo declarativo solo se alcanza llamando al CLI a mano: por la
// vía con sandbox —la que usa el editor— no se llegaba. El criterio vuelve a ser
// de identidad: el GLB del puente y el del CLI tienen que ser el mismo fichero.

const fixture = resolve(projectRoot, "artifacts/agent/muneco.json");
const workDir = mkdtempSync(join(tmpdir(), "softsight-scene-test-"));
try {
  const cliOut = join(workDir, "cli.glb");
  const { stdout } = await execFileAsync(process.execPath, [
    resolve(here, "agent3d.mjs"),
    "--scene",
    fixture,
    "--export",
    cliOut,
    "--inspect-only",
    "--audit-frames",
    "6",
  ]).catch((error) => {
    // El fixture trae dos avisos estáticos, así que el CLI sale con 1. Es
    // éxito con informe, no un fallo.
    if (error.code !== 1) throw error;
    return { stdout: error.stdout };
  });

  const report = JSON.parse(stdout);
  assert.equal(report.rig.joints, 7);
  assert.equal(report.rig.mode, "rigid");
  assert.equal(report.rig.clips[0].name, "saludo");
  assert.equal(report.animationAudit.crossings.length, 0, "el muñeco versionado tiene que estar limpio");
  assert.equal(report.animationAudit.groundBreaches.length, 0);
  assert.deepEqual(report.animationAudit.staticBones, []);
  assert.equal(report.animationAudit.clips[0].sampled.length, 6);

  const bridged = await runBridge({
    bridgeContractVersion: 1,
    command: "scene",
    files: { scene: { name: "muneco.json", data: readFileSync(fixture).toString("base64") } },
    options: { inspectOnly: true, auditFrames: 6 },
  });
  assert.equal(bridged.command, "scene");
  assert.equal(bridged.exitCode, 1, "el puente debe devolver el mismo código que el CLI");
  assert.deepEqual(bridged.report.rig, report.rig);
  assert.deepEqual(bridged.report.animationAudit, report.animationAudit);
  assert.equal(bridged.artifacts.length, 1);
  assert.equal(bridged.artifacts[0].name, "escena.glb");
  assert.equal(bridged.artifacts[0].mimeType, "model/gltf-binary");

  const fromBridge = Buffer.from(bridged.artifacts[0].data, "base64");
  assert.ok(
    fromBridge.equals(readFileSync(cliOut)),
    "el GLB del puente no coincide byte a byte con el del CLI",
  );

  // Una escena con esqueleto y sin vínculo no se ata a ojo: es un error.
  const sinVinculo = join(workDir, "sin-vinculo.json");
  writeFileSync(
    sinVinculo,
    JSON.stringify({
      objects: [{ name: "a", geometry: { primitive: "box", parameters: [1, 1, 1] } }],
      skeleton: { joints: [{ name: "raiz" }] },
    }),
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [resolve(here, "agent3d.mjs"), "--scene", sinVinculo]),
    (error) => {
      assert.match(String(error.stderr), /necesita `bindings`/);
      assert.equal(error.code, 2);
      return true;
    },
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log("rig e6: ok (escena declarativa por el puente, CLI == puente byte a byte)");

/** Ejecuta el puente con una petición y devuelve su respuesta ya parseada. */
async function runBridge(request) {
  const bridge = spawn(process.execPath, [resolve(here, "bridge.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
  bridge.stdin.end(JSON.stringify(request));
  const chunks = [];
  for await (const chunk of bridge.stdout) chunks.push(chunk);
  await new Promise((done) => bridge.on("close", done));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

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

// --- 6. La pista declarada como función: `value` en vez de `keys`

// Con `ease: linear` y dos entradas, hornear tiene que dar exactamente lo mismo
// que escribir las claves a mano. Si no, el atajo no es un atajo: es otra cosa.
const aMano = resolveRig({ joints: [{ name: "eje" }] }, [
  {
    name: "recto",
    fps: 30,
    tracks: [
      {
        joint: "eje",
        property: "translation",
        keys: Array.from({ length: 11 }, (_entrada, paso) => ({
          frame: paso,
          value: [paso / 10, 0, (paso / 10) * -2],
        })),
      },
    ],
  },
]);
const porFuncion = resolveRig({ joints: [{ name: "eje" }] }, [
  {
    name: "recto",
    fps: 30,
    tracks: [
      {
        joint: "eje",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [1, [1, 0, -2]]] },
        frames: 10,
      },
    ],
  },
]);
assertClose(
  Array.from(porFuncion.skeleton.animations[0].samplers[0].times),
  Array.from(aMano.skeleton.animations[0].samplers[0].times),
  "los tiempos horneados",
);
assertClose(
  Array.from(porFuncion.skeleton.animations[0].samplers[0].values),
  Array.from(aMano.skeleton.animations[0].samplers[0].values),
  "los valores horneados",
);

// `smooth` es Hermite con tangentes nulas: en el punto medio vale la media, y a un
// cuarto se queda por debajo. Es la misma curva que usa la geometría.
const suave = resolveRig({ joints: [{ name: "eje" }] }, [
  {
    name: "suave",
    fps: 30,
    tracks: [
      {
        joint: "eje",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [1, [8, 0, 0]]], ease: "smooth" },
        frames: 40,
        bake: 4,
      },
    ],
  },
]);
const suaves = Array.from(suave.skeleton.animations[0].samplers[0].values);
assert.equal(suaves.length, 15, "bake: 4 son cinco claves");
assert.ok(Math.abs(suaves[6] - 4) < 1e-6, `el punto medio de smooth vale ${suaves[6]} y debía valer 4`);
assert.ok(suaves[3] < 2, `a un cuarto, smooth va por debajo de la recta: ${suaves[3]}`);

// Y lo que de verdad sostiene el atajo: el GLB horneado, leído con el **evaluador
// certificado**, da la misma pose que la tabla evaluada a mano. Sin esto, hornear
// sería una segunda implementación del movimiento.
const brazoModelo = modelFromScene({
  objects: [{ name: "brazo", geometry: { primitive: "box", parameters: [0.2, 0.2, 0.2] }, position: [1, 0, 0] }],
});
const rigFuncion = resolveRig({ joints: [{ name: "eje" }] }, [
  {
    name: "empuje",
    fps: 30,
    tracks: [
      {
        joint: "eje",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [1, [0, 3, 0]]], ease: "smooth" },
        frames: 30,
      },
    ],
  },
]);
const atadoFuncion = bindModelToSkeleton(brazoModelo, rigFuncion.skeleton, {
  schemaVersion: 1,
  bindings: [{ part: "*", joint: "eje" }],
});
const glbFuncion = parseGlbAnimation(serializeSkinnedGlb(atadoFuncion.scene));
const reposoFuncion = evaluatePose(glbFuncion.document, glbFuncion.binary, glbFuncion.decodedViews, 0, 0, 0);
for (const frame of [0, 7, 15, 23, 30]) {
  const pose = evaluatePose(glbFuncion.document, glbFuncion.binary, glbFuncion.decodedViews, frame / 30, 0, 0);
  const t = frame / 30;
  const esperado = 3 * (t * t * (3 - 2 * t));
  const subida = pose[1] - reposoFuncion[1];
  assert.ok(
    Math.abs(subida - esperado) < 1e-4,
    `fotograma ${frame}: el evaluador certificado dice ${subida} y la tabla dice ${esperado}`,
  );
}

// Una pista con `keys` sigue dando el mismo GLB **byte a byte** que antes de que
// `value` existiera. La huella se midió con el `rigSpec` anterior al cambio, así
// que no es una foto de lo que hay: es la de lo que había.
assert.equal(
  createHash("sha256").update(new Uint8Array(serializeSkinnedGlb(bound.scene))).digest("hex"),
  "c43987954f101649fe113b7b8f21aa3d7916645f52ef9eccae608f22ba5359c0",
  "el camino de `keys` no puede haberse movido",
);

// Errores, cada uno por su motivo.
const conPista = (track) => () => resolveRig({ joints: [{ name: "eje" }] }, [{ tracks: [track] }]);
assertThrows(
  conPista({ joint: "eje", property: "translation" }),
  /se escribe con 'keys', 'value' o 'turns', y no trae ninguno/,
  "una pista sin claves ni función",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", keys: [{ frame: 0, value: [0, 0, 0] }], value: { at: [[0, [0, 0, 0]]] }, frames: 5 }),
  /son excluyentes/,
  "las dos formas a la vez",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", value: { at: [[0, [0, 0, 0]]] } }),
  /necesita 'frames'/,
  "una función sin duración",
);
assertThrows(
  conPista({ joint: "eje", property: "rotation", value: { at: [[0, [0, 0, 0, 1]], [1, [0, 1, 0, 0]]] }, frames: 10 }),
  /son 3 grados en orden Y·X·Z.*el cuaternión solo cabe en 'keys'/s,
  "un cuaternión en una función",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", value: { at: [[0, [0, 0]]] }, frames: 10 }),
  /pide 3 números/,
  "un vector con los componentes cambiados",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", value: { at: [[0, [0, 0, 0]], [1, [1, 0, 0]]] }, frames: 10, bake: 99999 }),
  /pasa del tope de 4096/,
  "hornear sin tope",
);

console.log(
  "rig value: ok (función ≡ claves a mano, smooth con su media, y el evaluador certificado confirma la curva en 5 fotogramas)",
);

// --- 7. `turns`, y el aviso que hace falta con él

// Una vuelta se hornea en claves de 90° como mucho, y el evaluador certificado
// confirma que la orientación es la declarada en los cuartos de vuelta.
const gira = resolveRig({ joints: [{ name: "rotor" }] }, [
  { name: "giro", fps: 30, tracks: [{ joint: "rotor", property: "rotation", turns: 1, frames: 24 }] },
]);
const muestreador = gira.skeleton.animations[0].samplers[0];
assert.equal(muestreador.times.length, 5, "una vuelta son cuatro pasos de 90° y cinco claves");
assertClose(Array.from(muestreador.times), [0, 0.2, 0.4, 0.6, 0.8].map((t) => t), "los tiempos de la vuelta");

const aspa = modelFromScene({
  objects: [{ name: "pala", geometry: { primitive: "box", parameters: [0.1, 0.1, 1] }, position: [0, 0, 0.6] }],
});
const atadoGiro = bindModelToSkeleton(aspa, gira.skeleton, {
  schemaVersion: 1,
  bindings: [{ part: "*", joint: "rotor" }],
});
const glbGiro = parseGlbAnimation(serializeSkinnedGlb(atadoGiro.scene));
const poseEn = (frame) => evaluatePose(glbGiro.document, glbGiro.binary, glbGiro.decodedViews, frame / 30, 0, 0);
const inicio = poseEn(0);
// A un cuarto de vuelta, lo que estaba en +Z está en +X: giro de 90° en Y.
const cuarto = poseEn(6);
assert.ok(
  Math.abs(cuarto[0] - inicio[2]) < 1e-4 && Math.abs(cuarto[2] + inicio[0]) < 1e-4,
  `a un cuarto de vuelta el punto tenía que rotar 90° en Y: ${inicio.slice(0, 3)} → ${cuarto.slice(0, 3)}`,
);
// Y a media vuelta está enfrente: es la comprobación de que gira de verdad y no
// se queda quieto, que es justo lo que pasaría con dos claves.
const media = poseEn(12);
assert.ok(
  Math.abs(media[0] + inicio[0]) < 1e-4 && Math.abs(media[2] + inicio[2]) < 1e-4,
  `a media vuelta el punto tenía que estar enfrente: ${inicio.slice(0, 3)} → ${media.slice(0, 3)}`,
);

// Tres vueltas son tres vueltas: doce pasos.
const tres = resolveRig({ joints: [{ name: "r" }] }, [
  { name: "g", fps: 30, tracks: [{ joint: "r", property: "rotation", turns: 3, frames: 60 }] },
]);
assert.equal(tres.skeleton.animations[0].samplers[0].times.length, 13);
// Al revés, también.
const alReves = resolveRig({ joints: [{ name: "r" }] }, [
  { name: "g", fps: 30, tracks: [{ joint: "r", property: "rotation", turns: -1, frames: 24, axis: "x" }] },
]);
assert.ok(alReves.skeleton.animations[0].samplers[0].values[0 * 4 + 0] === 0);
assert.ok(
  alReves.skeleton.animations[0].samplers[0].values[1 * 4 + 0] < 0,
  "una vuelta negativa gira al otro lado",
);

// El aviso: dos claves a 0° y 360° no giran nada, y el fichero sale igual de válido.
const ambiguo = auditClips([
  {
    name: "malo",
    tracks: [
      {
        joint: "rotor",
        property: "rotation",
        keys: [{ frame: 0, value: [0, 0, 0] }, { frame: 24, value: [0, 360, 0] }],
      },
    ],
  },
]);
assert.equal(ambiguo.length, 1);
assert.equal(ambiguo[0].code, "GIRO_AMBIGUO");
assert.equal(ambiguo[0].part, "rotor");
assert.match(ambiguo[0].message, /salta 360\.0°/);
assert.match(ambiguo[0].message, /arco más corto/);

// El mismo giro partido en cuartos, no avisa. Ni la pista horneada por `turns`.
const enCuartos = auditClips([
  {
    name: "bueno",
    tracks: [
      {
        joint: "rotor",
        property: "rotation",
        keys: [0, 90, 180, 270, 360].map((grados, paso) => ({ frame: paso * 6, value: [0, grados, 0] })),
      },
    ],
  },
]);
assert.deepEqual(enCuartos, []);
assert.deepEqual(
  auditClips([{ name: "t", tracks: [{ joint: "rotor", property: "rotation", turns: 5, frames: 60 }] }]),
  [],
  "`turns` no puede disparar el aviso: hornea a 90°",
);
// Y una traslación grande tampoco: el aviso es de rotaciones.
assert.deepEqual(
  auditClips([
    {
      name: "t",
      tracks: [
        {
          joint: "rotor",
          property: "translation",
          keys: [{ frame: 0, value: [0, 0, 0] }, { frame: 10, value: [900, 0, 0] }],
        },
      ],
    },
  ]),
  [],
);

// Errores de `turns`, por su motivo.
assertThrows(
  conPista({ joint: "eje", property: "translation", turns: 1, frames: 10 }),
  /'turns' solo tiene sentido en una pista de rotation/,
  "turns en una traslación",
);
assertThrows(
  conPista({ joint: "eje", property: "rotation", turns: 1 }),
  /necesita 'frames'/,
  "turns sin duración",
);
assertThrows(
  conPista({ joint: "eje", property: "rotation", turns: 1, frames: 24, bake: 2 }),
  /cada clave saltaría 180\.0°.*al menos 4 pasos/s,
  "turns con menos pasos de los que caben",
);
assertThrows(
  conPista({ joint: "eje", property: "rotation", turns: 1, frames: 24, keys: [{ frame: 0, value: [0, 0, 0] }] }),
  /son excluyentes/,
  "turns y keys a la vez",
);

console.log(
  "rig turns: ok (una vuelta en cinco claves, media vuelta enfrente por el evaluador certificado, y GIRO_AMBIGUO caza el 0→360)",
);

// --- 8. Ciclo y desfase

// `cycle` repite el contenido, y la pista dura tantas veces más.
const unCiclo = resolveRig({ joints: [{ name: "pata" }] }, [
  {
    name: "paso",
    fps: 30,
    tracks: [
      {
        joint: "pata",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [0.5, [1, 0, 0]], [1, [0, 0, 0]]] },
        frames: 20,
        bake: 20,
      },
    ],
  },
]);
const tresCiclos = resolveRig({ joints: [{ name: "pata" }] }, [
  {
    name: "paso",
    fps: 30,
    tracks: [
      {
        joint: "pata",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [0.5, [1, 0, 0]], [1, [0, 0, 0]]] },
        frames: 20,
        bake: 20,
        cycle: 3,
      },
    ],
  },
]);
assert.equal(unCiclo.clips[0].lastFrame, 20);
assert.equal(tresCiclos.clips[0].lastFrame, 60, "tres ciclos de 20 fotogramas duran 60");
const uno = Array.from(unCiclo.skeleton.animations[0].samplers[0].values);
const repetido = Array.from(tresCiclos.skeleton.animations[0].samplers[0].values);
// Los tres tramos son el mismo movimiento.
for (let round = 0; round < 3; round += 1) {
  for (let key = 0; key < 20; key += 1) {
    const desde = (round * 20 + key) * 3;
    assertClose(repetido.slice(desde, desde + 3), uno.slice(key * 3, key * 3 + 3), `ciclo ${round}, clave ${key}`);
  }
}

// `offsetFrames` desfasa **el parámetro**: la pista arranca donde arrancaría a un
// cuarto de camino, que es lo que hace que cuatro patas iguales no vayan a la vez.
const desfasada = resolveRig({ joints: [{ name: "pata" }] }, [
  {
    name: "paso",
    fps: 30,
    tracks: [
      {
        joint: "pata",
        property: "translation",
        value: { at: [[0, [0, 0, 0]], [0.5, [1, 0, 0]], [1, [0, 0, 0]]] },
        frames: 20,
        bake: 20,
        offsetFrames: 5,
      },
    ],
  },
]);
const conDesfase = Array.from(desfasada.skeleton.animations[0].samplers[0].values);
for (let key = 0; key < 15; key += 1) {
  assertClose(
    conDesfase.slice(key * 3, key * 3 + 3),
    uno.slice((key + 5) * 3, (key + 5) * 3 + 3),
    `desfase de 5: la clave ${key} vale lo que valía la ${key + 5}`,
  );
}
// Y lo que sale por el final vuelve a entrar por el principio: la clave 16 vale lo
// que la 1 de la pista sin desfasar.
assertClose(conDesfase.slice(16 * 3, 16 * 3 + 3), uno.slice(1 * 3, 1 * 3 + 3), "el desfase envuelve");

// Sobre claves escritas a mano, `cycle` también repite, sin duplicar la frontera.
const clavesRepetidas = resolveRig({ joints: [{ name: "p" }] }, [
  {
    name: "r",
    fps: 30,
    tracks: [
      {
        joint: "p",
        property: "translation",
        keys: [
          { frame: 0, value: [0, 0, 0] },
          { frame: 5, value: [1, 0, 0] },
          { frame: 10, value: [0, 0, 0] },
        ],
        cycle: 3,
      },
    ],
  },
]);
assert.deepEqual(
  Array.from(clavesRepetidas.skeleton.animations[0].samplers[0].times).map((t) => Math.round(t * 30)),
  [0, 5, 10, 15, 20, 25, 30],
  "tres ciclos de tres claves son siete, no nueve: la frontera no se duplica",
);

// Errores, por su motivo.
assertThrows(
  conPista({ joint: "eje", property: "rotation", turns: 2, frames: 40, cycle: 2 }),
  /'cycle' con 'turns' sobra/,
  "ciclo sobre vueltas",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", keys: [{ frame: 0, value: [0, 0, 0] }], offsetFrames: 3 }),
  /solo va con 'value'/,
  "desfase sobre claves escritas a mano",
);
assertThrows(
  conPista({ joint: "eje", property: "translation", value: { at: [[0, [0, 0, 0]], [1, [1, 0, 0]]] }, frames: 10, cycle: 0 }),
  /'cycle' es un entero de 1 en adelante/,
  "un ciclo de cero",
);

console.log(
  "rig cycle: ok (tres ciclos idénticos y de 60 fotogramas, y el desfase de 5 envuelve por el principio)",
);

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
