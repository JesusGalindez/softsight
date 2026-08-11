/**
 * Puerta del reparto de pesos contra el evaluador certificado.
 *
 * Es el paso que decide [`docs/plan-pesos.md`](../docs/plan-pesos.md), y lo que
 * afirma no es que la banda «se vea bien»: es que un GLB con **pesos declarados
 * por softsight** deforma en Three.js exactamente igual que en `evaluatePose`,
 * fotograma a fotograma y hasta el último bit de cada posición.
 *
 * Sin esto, el reparto suave sería una animación bonita que nadie puede afirmar.
 * Con esto, softsight escribe pesos que el reproductor del mundo real reproduce.
 *
 * ## De dónde sale el control, y por qué está aquí
 *
 * `artifacts/agent/codo-banda-poses.json` lo produce el **editor**, con Three.js
 * y su `GLTFLoader`, así:
 *
 * ```
 * node tools/agent3d.mjs --scene artifacts/agent/codo-banda.json --inspect-only --export codo-banda.glb
 * node scripts/create-control-pose-fixture.mjs --model codo-banda.glb \
 *   --out .../artifacts/agent/codo-banda-poses.json --fps 30 --frames 0,10,20,30
 * ```
 *
 * Es un **valor de control**, con el mismo papel que `render-hashes.json`: no es
 * una segunda fuente de la verdad, es la de otro camino congelada para que la
 * discrepancia salte aquí. Por eso la puerta corre también en CI, donde no hay ni
 * editor ni Three.js: lo que se compara es un número, no una ejecución.
 *
 * **Refijarlo es exactamente lo que esta puerta existe para impedir.** Si se pone
 * roja, la pregunta es qué movió los pesos, no cómo regenerar el fichero.
 *
 * ## Qué no comprueba `--control-poses`
 *
 * Nada. La bandera dice **qué fotogramas evaluar**, y la herramienta publica sus
 * hashes; comparar es del consumidor. Se comprobó falseando un hash de la
 * referencia: el informe sigue saliendo `accepted`. Por eso aquí la comparación
 * es explícita y no se delega en un `status`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { inspectGlbAnimation } from "../dist-node/agent3d.mjs";
import {
  auditSkin,
  bindModelToSkeleton,
  modelFromScene,
  resolveRig,
  reviewScene,
  serializeSkinnedGlb,
  withSeverity,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const spec = JSON.parse(
  await readFile(resolve(projectRoot, "artifacts/agent/codo-banda.json"), "utf8"),
);
const control = JSON.parse(
  await readFile(resolve(projectRoot, "artifacts/agent/codo-banda-poses.json"), "utf8"),
);

// La escena versionada declara banda por los dos lados: si alguien se la quita,
// esta puerta pasaría a certificar un atado rígido sin decirlo.
assert.equal(
  spec.bindings.filter((rule) => rule.blend !== undefined).length,
  2,
  "la escena de la puerta tiene que traer las dos bandas, o esto no prueba nada",
);

// El GLB se reconstruye aquí y no se lee de un fichero: lo que se certifica es lo
// que produce el código de hoy, no una copia que alguien dejó al lado.
const rig = resolveRig(spec.skeleton, spec.clips);
const bound = bindModelToSkeleton(modelFromScene(spec, "codo-banda"), rig.skeleton, {
  schemaVersion: 1,
  bindings: spec.bindings,
});
const glb = serializeSkinnedGlb(bound.scene);

// Las mallas y sus vértices, antes que los hashes: si el GLB trajera otra cosa,
// los hashes también fallarían, pero dirían menos.
assert.deepEqual(
  bound.scene.meshes[0].primitives.map((primitive) => primitive.positions.length / 3),
  control.meshes.map((mesh) => mesh.vertices),
  "el GLB de hoy no tiene los vértices que tenía cuando se fijó el control",
);

const inspection = await inspectGlbAnimation(glb, control);
assert.deepEqual(inspection.errors, [], "el GLB con pesos declarados no se lee limpio");
assert.equal(inspection.skinning.status, "accepted");

const esperados = Object.entries(control.clips).flatMap(([clipName, poses]) =>
  poses.map((pose) => ({ clipName, frame: pose.frame, positionsHash: pose.positionsHash })),
);
assert.equal(esperados.length, 4, "el control fija cuatro fotogramas: reposo, dos tramos y el doblado");

// La comparación, hash a hash y con el fotograma en el mensaje: «cuatro poses no
// coinciden» no dice si se movió el reposo —el atado— o solo el doblado —el
// reparto—, y son dos fallos distintos.
for (const [index, esperado] of esperados.entries()) {
  const propio = inspection.controlPoses[index];
  assert.equal(propio.clipName, esperado.clipName);
  assert.equal(propio.frame, esperado.frame);
  assert.equal(
    propio.positionsHash,
    esperado.positionsHash,
    `el fotograma ${esperado.frame} de '${esperado.clipName}' deforma distinto que en Three.js`,
  );
}

// Y que el control es de este GLB y no de otro parecido: sin esto, una escena
// cambiada con el control viejo pasaría mientras los hashes no se movieran.
assert.equal(
  control.model,
  "codo-banda.glb",
  "el control dice ser de otro modelo; regenerarlo es lo que esta puerta vigila",
);

// --- Los tres caminos dicen lo mismo -------------------------------------------
//
// API, CLI y puente sobre la misma escena tienen que producir **el mismo GLB byte
// a byte**: los dos últimos son envoltorios y no deben decidir nada. Es la misma
// comprobación que cerró E3 con el BVH, y aquí importa más, porque un reparto que
// se resolviera distinto por una vía se vería igual de bien en la imagen.

const trabajo = mkdtempSync(join(tmpdir(), "softsight-blend-"));
try {
  const porCli = join(trabajo, "cli.glb");
  await execFileAsync(
    process.execPath,
    [
      resolve(here, "agent3d.mjs"),
      "--scene",
      resolve(projectRoot, "artifacts/agent/codo-banda.json"),
      "--inspect-only",
      "--export",
      porCli,
    ],
    { cwd: projectRoot, maxBuffer: 32 * 1024 * 1024 },
  );
  assert.ok(
    Buffer.from(glb).equals(readFileSync(porCli)),
    "el GLB del CLI no coincide byte a byte con el de la API",
  );

  const respuesta = await runBridge({
    bridgeContractVersion: 1,
    command: "scene",
    files: {
      scene: {
        name: "codo-banda.json",
        data: readFileSync(resolve(projectRoot, "artifacts/agent/codo-banda.json")).toString("base64"),
      },
    },
    options: { inspectOnly: true },
  });
  assert.equal(respuesta.exitCode, 0, "el ejemplar no puede salir con defectos por el puente");
  const artefacto = respuesta.artifacts.find((entry) => entry.name.endsWith(".glb"));
  assert.ok(artefacto, "el puente no devolvió el GLB atado");
  assert.ok(
    Buffer.from(artefacto.data, "base64").equals(readFileSync(porCli)),
    "el GLB del puente no coincide byte a byte con el del CLI",
  );

  // Y el informe dice lo que se escribió, no lo que se suele escribir: con banda,
  // `mode` es `blended` y dice qué piezas la llevan.
  assert.equal(respuesta.report.rig.mode, "blended");
  assert.deepEqual(respuesta.report.rig.blendedParts.slice().sort(), ["antebrazo", "brazo"]);
} finally {
  rmSync(trabajo, { recursive: true, force: true });
}

// --- El ejemplar --------------------------------------------------------------
//
// La escena no es solo el fixture de esta puerta: es **lo primero que copia un
// agente** que quiere una piel que no se abra, así que se le exige lo mismo que al
// ejemplar de geometría —cero avisos de `certeza`—. Un ejemplar con defectos
// enseñaría justo lo que el banco rechaza.

const { warnings } = reviewScene(spec, { inspectOnly: true }).review;
const todos = [...warnings, ...withSeverity(auditSkin(bound, rig.skeleton))];
const defectos = todos.filter((aviso) => aviso.severity === "certeza");
assert.deepEqual(
  defectos,
  [],
  `el ejemplar trae defectos: ${defectos.map((aviso) => `${aviso.code} en ${aviso.part}`).join(", ")}`,
);

/** El puente, por su entrada de verdad: JSON por stdin y JSON por stdout. */
async function runBridge(request) {
  const bridge = spawn(process.execPath, [resolve(here, "bridge.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  bridge.stdin.end(JSON.stringify(request));
  const chunks = [];
  for await (const chunk of bridge.stdout) chunks.push(chunk);
  await new Promise((done) => bridge.on("close", done));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

console.log(
  `blend contract: ok (${esperados.length} poses de control del codo con banda, ` +
    `${control.meshes.reduce((total, mesh) => total + mesh.vertices, 0)} vértices, ` +
    `hashes idénticos a Three.js; GLB sha256:${createHash("sha256").update(new Uint8Array(glb)).digest("hex").slice(0, 8)}; ` +
    `ejemplar sin un defecto: ${todos.length} avisos entre la escena y la piel; ` +
    `API == CLI == puente byte a byte)`,
);
