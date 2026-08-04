/**
 * Puerta del lector de BVH.
 *
 * El criterio tampoco es visual: la cinemática directa del esqueleto, calculada
 * aquí con matrices y calculada por el evaluador certificado a través del GLB
 * que escribimos, tiene que dar **las mismas posiciones**. Son dos caminos
 * independientes —uno con matrices 4×4 en esta prueba, otro con el árbol de
 * nodos de glTF y el skinning del núcleo— y solo coinciden si el orden de
 * rotación, los grados y la acumulación de desplazamientos son correctos.
 *
 * El truco para poder comparar: un BVH no trae malla, así que se le ata una de
 * un vértice por articulación, cada uno con peso 1 sobre su joint y colocado en
 * la posición de reposo de ese joint. Con la matriz de enlace inversa siendo la
 * inversa de esa pose de reposo, el vértice deformado **es** la posición mundial
 * de la articulación. Así el evaluador de skinning responde a una pregunta de
 * cinemática.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  bvhToSkinnedScene,
  evaluatePose,
  parseBvh,
  parseGlbAnimation,
  serializeSkinnedGlb,
} from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

// Orden de rotación deliberadamente distinto en cada articulación: si el lector
// usara uno fijo —el de la raíz, o el más común— esta prueba lo cazaría.
const source = `
HIERARCHY
ROOT Cadera
{
  OFFSET 0.0 0.0 0.0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT Pecho
  {
    OFFSET 0.0 10.0 0.0
    CHANNELS 3 Yrotation Xrotation Zrotation
    End Site
    {
      OFFSET 0.0 5.0 0.0
    }
  }
}
MOTION
Frames: 3
Frame Time: 0.5
0 0 0 0 0 0 0 0 0
1 2 3 0 0 0 0 0 0
0 0 0 90 0 0 0 0 -90
`;

const bvh = parseBvh(source);

assert.equal(bvh.joints.length, 2);
assert.deepEqual(bvh.roots, [0]);
assert.equal(bvh.frameCount, 3);
assert.equal(bvh.frameTime, 0.5);
assert.equal(bvh.channelCount, 9);
assert.deepEqual(bvh.joints[0].channels, [
  "Xposition",
  "Yposition",
  "Zposition",
  "Zrotation",
  "Xrotation",
  "Yrotation",
]);
assert.deepEqual(bvh.joints[1].channels, ["Yrotation", "Xrotation", "Zrotation"]);
assert.deepEqual(bvh.joints[1].offset, [0, 10, 0]);
assert.deepEqual(bvh.joints[1].endSite, [0, 5, 0]);
assert.equal(bvh.joints[1].parent, 0);
assert.deepEqual(bvh.joints[0].children, [1]);
assert.equal(bvh.motion.length, 27);

// El End Site es un nodo más, sin canales: sin él el último hueso no tiene ni
// longitud ni dirección.
const scene = bvhToSkinnedScene(bvh, { clipName: "Prueba" });
assert.deepEqual(
  scene.nodes.map((node) => node.name),
  ["Cadera", "Pecho", "Pecho_end"],
);
assert.deepEqual(scene.roots, [0]);
assert.equal(scene.animations.length, 1);
assert.equal(scene.animations[0].name, "Prueba");
// La cadera anima traslación y rotación; el pecho solo rotación.
assert.deepEqual(
  scene.animations[0].channels.map((channel) => `${channel.node}:${channel.path}`),
  ["0:translation", "0:rotation", "1:rotation"],
);

// --- El GLB con la malla-sonda: un vértice por articulación ------------------

const restWorlds = restWorldTranslations(bvh);
const jointNodes = [0, 1, 2];
const positions = new Float32Array(restWorlds.flat());
const joints = new Uint16Array(jointNodes.flatMap((_node, index) => [index, 0, 0, 0]));
const weights = new Float32Array(jointNodes.flatMap(() => [1, 0, 0, 0]));
const inverseBind = new Float32Array(
  restWorlds.flatMap((translation) => inverseTranslationColumnMajor(translation)),
);

const probe = {
  ...scene,
  nodes: [...scene.nodes, { name: "sonda", mesh: 0, skin: 0 }],
  meshes: [
    {
      name: "sonda",
      primitives: [
        {
          positions,
          indices: Uint32Array.from([0, 1, 2]),
          joints,
          weights,
        },
      ],
    },
  ],
  skins: [{ name: "esqueleto", joints: jointNodes, inverseBindMatrices: inverseBind }],
  roots: [...scene.roots, scene.nodes.length],
};

const parsed = parseGlbAnimation(serializeSkinnedGlb(probe));
assert.equal(parsed.document.skins.length, 1);
assert.equal(parsed.document.animations[0].name, "Prueba");
// Los tres muestreadores comparten un único vector de tiempos, y el escritor
// escribe esos bytes una sola vez: cada uno tiene su accesor —son objetos de
// JSON, baratos— pero todos apuntan a la misma vista del bloque binario. Con un
// esqueleto de 77 huesos eso es la diferencia entre escribir los tiempos una vez
// y escribirlos ciento cincuenta y cuatro.
const inputViews = new Set(
  parsed.document.animations[0].samplers.map(
    (sampler) => parsed.document.accessors[sampler.input].bufferView,
  ),
);
assert.equal(inputViews.size, 1, "el escritor duplicó los bytes del vector de tiempos");

for (let frame = 0; frame < bvh.frameCount; frame += 1) {
  const time = frame * bvh.frameTime;
  const evaluated = Array.from(
    evaluatePose(parsed.document, parsed.binary, parsed.decodedViews, time, 0, 0),
  );
  const expected = forwardKinematics(bvh, frame).flat();
  assert.equal(evaluated.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(evaluated[index] - expected[index]) < 1e-4,
      `frame ${frame}, componente ${index}: evaluador ${evaluated[index]}, cinemática ${expected[index]}`,
    );
  }
}

// Frame 2, comprobado a mano para que la prueba no dependa solo de que las dos
// implementaciones se equivoquen igual: la cadera gira 90° en Z, así que el eje
// +Y del pecho pasa a apuntar a −X y el pecho cae en (−10, 0, 0). El pecho gira
// −90° en Z sobre eso, que devuelve su propio +Y a la vertical del mundo, y el
// extremo queda 5 por encima del pecho.
const lastFrame = forwardKinematics(bvh, 2);
assertClose(lastFrame[0], [0, 0, 0], "cadera en el frame 2");
assertClose(lastFrame[1], [-10, 0, 0], "pecho en el frame 2");
assertClose(lastFrame[2], [-10, 5, 0], "extremo en el frame 2");

// --- Lo que el lector tiene que rechazar ------------------------------------

assertThrows(() => parseBvh("MOTION\nFrames: 0\nFrame Time: 0.1\n"), /se esperaba 'HIERARCHY'/, "un fichero sin jerarquía");

assertThrows(
  () => parseBvh(source.replace("Frames: 3", "Frames: 4")),
  /MOTION trae 27 valores y 4 fotogramas × 9 canales piden 36/,
  "un MOTION al que le faltan fotogramas",
);

assertThrows(
  () => parseBvh(source.replace("Xrotation Yrotation\n", "Xrotation Wrotation\n")),
  /canal 'Wrotation' desconocido/,
  "un canal que no existe en el formato",
);

assertThrows(
  () => parseBvh(source.replace("Frame Time: 0.5", "Frame Time: 0")),
  /Frame Time es 0/,
  "un fotograma de duración cero",
);

assertThrows(
  () => parseBvh(source.replace("CHANNELS 3 Yrotation", "CHANNELS x Yrotation")),
  /CHANNELS: 'x' no es un número/,
  "un CHANNELS sin número de canales",
);

// La escala no se aplica sola: es una opción, y multiplica desplazamientos y
// traslaciones por igual. Un BVH en centímetros se pasa a metros con 0.01.
const metric = bvhToSkinnedScene(bvh, { scale: 0.01 });
assert.deepEqual(metric.nodes[1].translation, [0, 0.1, 0]);
assert.deepEqual(metric.nodes[2].translation, [0, 0.05, 0]);

console.log(`bvh loader: ok (${bvh.frameCount} frames, ${bvh.joints.length} articulaciones)`);

// --- E3: la misma conversión por la API, por el CLI y por el puente ---------
// El CLI y el puente son envoltorios: si el fichero que producen no es byte a
// byte el que produce la API, alguno de los dos está decidiendo algo por su
// cuenta, y eso es exactamente lo que no debe pasar.

const fixturePath = resolve(projectRoot, "artifacts/agent/captura-ejemplo.bvh");
const fixture = await readFile(fixturePath, "utf8");
const options = { clipName: "Salto", scale: 0.01 };
const fromApi = Buffer.from(serializeSkinnedGlb(bvhToSkinnedScene(parseBvh(fixture), options)));

const workDir = mkdtempSync(join(tmpdir(), "softsight-bvh-test-"));
try {
  const cliOut = join(workDir, "cli.glb");
  const { stdout } = await execFileAsync(process.execPath, [
    resolve(here, "agent3d.mjs"),
    "--bvh",
    fixturePath,
    "--export",
    cliOut,
    "--bvh-scale",
    "0.01",
    "--bvh-clip",
    "Salto",
  ]);

  const report = JSON.parse(stdout);
  assert.equal(report.bvh.joints, 3);
  assert.equal(report.bvh.frames, 4);
  assert.equal(report.scene.clip, "Salto");
  assert.equal(report.scene.meshes, 0, "el GLB de un BVH no lleva malla: el BVH no la trae");
  assert.equal(report.scale, 0.01);
  // Tres articulaciones con tres órdenes distintos: si el informe dijera uno
  // solo, alguien acabaría suponiendo que el esqueleto entero lo comparte.
  assert.deepEqual(report.bvh.rotationOrders, ["ZXY", "YXZ", "XZY"]);

  const fromCli = readFileSync(cliOut);
  assert.ok(fromCli.equals(fromApi), "el GLB del CLI no coincide byte a byte con el de la API");

  const request = {
    bridgeContractVersion: 1,
    command: "bvh",
    files: { bvh: { name: "captura-ejemplo.bvh", data: Buffer.from(fixture).toString("base64") } },
    options: { bvhScale: 0.01, bvhClip: "Salto" },
  };
  const bridged = await runBridge(request);
  assert.equal(bridged.command, "bvh");
  assert.equal(bridged.exitCode, 0);
  assert.deepEqual(bridged.report.bvh.rotationOrders, report.bvh.rotationOrders);
  assert.equal(bridged.artifacts.length, 1);
  assert.equal(bridged.artifacts[0].name, "esqueleto.glb");
  assert.equal(bridged.artifacts[0].mimeType, "model/gltf-binary");
  const fromBridge = Buffer.from(bridged.artifacts[0].data, "base64");
  assert.ok(fromBridge.equals(fromApi), "el GLB del puente no coincide byte a byte con el de la API");

  // Y lo que el CLI tiene que rechazar: sin destino no hay conversión, y el
  // único destino que sabe escribir es un .glb.
  await assertCliFails(["--bvh", fixturePath], /--bvh necesita --export/);
  await assertCliFails(
    ["--bvh", fixturePath, "--export", join(workDir, "salida.obj")],
    /--bvh solo exporta \.glb/,
  );
  await assertCliFails(
    ["--bvh", fixturePath, "--export", join(workDir, "x.glb"), "--bvh-scale", "0"],
    /--bvh-scale inválido/,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log("bvh e3: ok (API == CLI == puente, byte a byte)");

/** Ejecuta el puente con una petición y devuelve su respuesta ya parseada. */
async function runBridge(request) {
  const bridge = spawn(process.execPath, [resolve(here, "bridge.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  bridge.stdin.end(JSON.stringify(request));
  const chunks = [];
  for await (const chunk of bridge.stdout) chunks.push(chunk);
  const code = await new Promise((done) => bridge.on("close", done));
  const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(code, 0, `el puente salió con ${code}: ${response.message ?? ""}`);
  return response;
}

async function assertCliFails(args, pattern) {
  try {
    await execFileAsync(process.execPath, [resolve(here, "agent3d.mjs"), ...args]);
  } catch (error) {
    const message = String(error.stderr ?? error.message);
    assert.match(message, pattern);
    assert.equal(error.code, 2, `un error de datos debe salir con 2, salió con ${error.code}`);
    return;
  }
  assert.fail(`el CLI aceptó ${args.join(" ")}`);
}

/* --- Cinemática directa independiente, con matrices 4×4 por columnas ------ */

/** Posición mundial de cada nodo —articulaciones y extremos— en un fotograma. */
function forwardKinematics(document, frame) {
  const out = [];
  const walk = (jointIndex, parentWorld) => {
    const joint = document.joints[jointIndex];
    const base = frame * document.channelCount + channelBaseOf(document, jointIndex);
    const values = joint.channels.map((_channel, index) => document.motion[base + index]);

    const translation = [...joint.offset];
    joint.channels.forEach((channel, index) => {
      if (channel === "Xposition") translation[0] += values[index];
      if (channel === "Yposition") translation[1] += values[index];
      if (channel === "Zposition") translation[2] += values[index];
    });

    // R = R_primero · R_segundo · R_tercero, en el orden en que la articulación
    // declara sus canales. Es la regla que hace que el mismo número signifique
    // poses distintas en dos ficheros con distinto orden.
    let rotation = identity();
    joint.channels.forEach((channel, index) => {
      if (!channel.endsWith("rotation")) return;
      rotation = multiply(rotation, axisMatrix(channel[0], (values[index] * Math.PI) / 180));
    });

    const world = multiply(multiply(parentWorld, translationMatrix(translation)), rotation);
    out.push([world[3], world[7], world[11]]);

    for (const child of joint.children) walk(child, world);
    if (joint.endSite) {
      const end = multiply(world, translationMatrix(joint.endSite));
      out.push([end[3], end[7], end[11]]);
    }
  };
  for (const root of document.roots) walk(root, identity());
  return out;
}

/** Las mismas posiciones con todos los canales a cero: la pose de reposo. */
function restWorldTranslations(document) {
  const rest = {
    ...document,
    frameCount: 1,
    motion: new Float64Array(document.channelCount),
  };
  return forwardKinematics(rest, 0);
}

function channelBaseOf(document, jointIndex) {
  let base = 0;
  for (let index = 0; index < jointIndex; index += 1) base += document.joints[index].channels.length;
  return base;
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translationMatrix([x, y, z]) {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

function axisMatrix(axis, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  if (axis.toUpperCase() === "X") {
    return [1, 0, 0, 0, 0, cosine, -sine, 0, 0, sine, cosine, 0, 0, 0, 0, 1];
  }
  if (axis.toUpperCase() === "Y") {
    return [cosine, 0, sine, 0, 0, 1, 0, 0, -sine, 0, cosine, 0, 0, 0, 0, 1];
  }
  return [cosine, -sine, 0, 0, sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + column];
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

/**
 * Inversa de una traslación pura, ya por columnas para glTF. La pose de reposo
 * de un BVH no tiene rotaciones, así que no hace falta invertir nada general.
 */
function inverseTranslationColumnMajor([x, y, z]) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
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
  assert.throws(run, pattern, `el lector aceptó ${what}`);
}
