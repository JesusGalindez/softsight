/**
 * La auditoría 2D del movimiento, contra números que se pueden calcular a mano.
 *
 * La auditoría de aquí mide **lo que se ve**, y eso la hace fácil de engañar y
 * fácil de comprobar: con una cámara ortográfica declarada, la caja de un cubo en
 * pantalla sale de una regla de tres, y saber si dos cubos se tapan es comparar
 * dos intervalos. Así que las comprobaciones son de fotograma exacto —«se sale a
 * partir del 6», «se tapan del 10 al 29»— y no de «parece razonable».
 *
 * Las escenas se construyen aquí a propósito, colocando las piezas fotograma a
 * fotograma en vez de animando un esqueleto: lo que se prueba es la aritmética de
 * pantalla, y meter el evaluador de animación en medio probaría el evaluador, que
 * ya tiene sus propias puertas.
 *
 * El caso de integración va aparte y por el CLI, que es donde se ve si el cableado
 * está bien: el ejemplar `muneco.json`, con su esqueleto y su clip de verdad.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:screen`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createScreenAudit, screenWarnings, WARNING_CODES } from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const MUNECO = resolve(projectRoot, "artifacts/agent/muneco.json");

const TILE = 100;

/**
 * Cámara ortográfica mirando por −Z con media altura 1: el mundo x,y ∈ [−1, 1]
 * cubre el tile entero, así que una unidad de mundo son 50 píxeles y la cuenta se
 * puede hacer sin ejecutar nada.
 */
const CAMERA = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovYDegrees: 40,
  near: 1,
  far: 100,
  projection: "orthographic",
  orthoHalfHeight: 1,
};

/** Cubo de lado 0,4 centrado en su origen. */
function cube(half = 0.2) {
  const corners = [];
  for (let index = 0; index < 8; index += 1) {
    corners.push(
      index & 1 ? half : -half,
      index & 2 ? half : -half,
      index & 4 ? half : -half,
    );
  }
  return {
    positions: Float32Array.from(corners),
    normals: Float32Array.from(corners),
    uvs: new Float32Array(16),
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
    boundingRadius: Math.hypot(half, half, half),
  };
}

const CUBE = cube();

/** Una pieza colocada en (x, y, z) sin rotación ni escala. */
function at(name, x, y, z) {
  return {
    name,
    path: `/${name}`,
    mesh: CUBE,
    model: Float32Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]),
  };
}

/** Recorre un clip declarado como función de fotograma a piezas colocadas. */
function walk(rest, clip, frames, options = {}) {
  const audit = createScreenAudit(CAMERA, "prueba", { tileSize: TILE, ...options });
  audit.observeRest(rest);
  audit.startClip(clip);
  for (let frame = 0; frame < frames.length; frame += 1) audit.observe(frame, frames[frame]);
  return audit.finish();
}

// ---------------------------------------------------------------------------

// Quieto: nada que decir. Es la comprobación que hace que las demás signifiquen
// algo, porque una auditoría que avisa siempre no distingue nada.
{
  const quieto = [at("a", 0, 0, 0)];
  const audit = walk(quieto, "quieto", Array.from({ length: 30 }, () => quieto));
  assert.deepEqual(audit.offFrame, []);
  assert.deepEqual(audit.blindEntrances, []);
  assert.deepEqual(audit.occlusions, []);
  console.log("pantalla: ok (una pieza quieta y centrada no produce ni un hallazgo)");
}

// SALE_DE_CUADRO. La pieza va de x=0 a x=+1,1 en pasos de 0,1: su borde derecho
// es x + 0,2, y el cuadro acaba en x = 1. Asoma cuando x + 0,2 > 1, o sea desde
// x = 0,9, que es el fotograma 9. En el último, x = 1,1 y el borde está en 1,3:
// 0,3 de mundo por fuera, que a 50 px la unidad son 15 px.
{
  const rest = [at("volante", 0, 0, 0)];
  const frames = Array.from({ length: 12 }, (_entry, frame) => [at("volante", frame * 0.1, 0, 0)]);
  const audit = walk(rest, "vuelo", frames);

  assert.equal(audit.offFrame.length, 1, "solo una pieza se sale");
  const [salida] = audit.offFrame;
  assert.equal(salida.part, "volante");
  assert.equal(salida.frame, 9, "el primer fotograma en el que asoma");
  assert.equal(salida.worstFrame, 11, "el peor es el último");
  assert.equal(salida.overflow, 15, "0,3 de mundo a 50 px la unidad");
  assert.equal(salida.fullyOut, false, "asoma, pero no llega a salirse entera");
  assert.deepEqual(audit.blindEntrances, []);
  console.log(`pantalla: ok (SALE_DE_CUADRO en el fotograma ${salida.frame}, ${salida.overflow} px por fuera)`);
}

// Y una que se sale **entera**: en el último fotograma x = 3 y su caja queda en
// [2,8, 3,2], muy pasado el borde. `fullyOut` distingue asomarse de desaparecer.
{
  const rest = [at("fugada", 0, 0, 0)];
  const frames = Array.from({ length: 6 }, (_entry, frame) => [at("fugada", frame * 0.6, 0, 0)]);
  const audit = walk(rest, "fuga", frames);
  assert.equal(audit.offFrame[0].fullyOut, true);
  console.log("pantalla: ok (salirse entera se distingue de asomarse)");
}

// ENTRADA_A_CIEGAS. La pieza empieza fuera —x = −3— y avanza 0,8 por fotograma.
// Su borde derecho es x + 0,2 y el cuadro empieza en x = −1: en el fotograma 2
// está en −1,2 y sigue fuera; en el 3, en −0,4 y ya asoma. Como arranca su
// movimiento estando fuera, el espectador no ve el arranque. Y no se cuenta como
// que «se sale», porque nunca estuvo dentro.
{
  const rest = [at("tardona", -3, 0, 0)];
  const frames = Array.from({ length: 6 }, (_entry, frame) => [at("tardona", -3 + frame * 0.8, 0, 0)]);
  const audit = walk(rest, "entrada", frames);

  assert.deepEqual(audit.offFrame, [], "una pieza que estaba fuera en reposo no se está saliendo");
  assert.equal(audit.blindEntrances.length, 1);
  const [entrada] = audit.blindEntrances;
  assert.equal(entrada.part, "tardona");
  assert.equal(entrada.frame, 1, "se mueve desde el primer fotograma del clip");
  assert.equal(entrada.visibleFrame, 3, "y no entra en el cuadro hasta el 3");
  console.log(
    `pantalla: ok (ENTRADA_A_CIEGAS: se mueve en el ${entrada.frame} y no entra hasta el ${entrada.visibleFrame})`,
  );
}

// Una que empieza fuera y **nunca** entra: `visibleFrame` en nulo, y el mensaje
// lo dice en vez de inventarse un fotograma.
{
  const rest = [at("perdida", -3, 0, 0)];
  const frames = Array.from({ length: 6 }, (_entry, frame) => [at("perdida", -3 - frame * 0.1, 0, 0)]);
  const audit = walk(rest, "nunca", frames);
  assert.equal(audit.blindEntrances[0].visibleFrame, null);
  assert.match(screenWarnings(audit)[0].message, /no entra en el cuadro en todo el clip/);
  console.log("pantalla: ok (la que nunca entra lo dice, en vez de inventarse un fotograma)");
}

// OCLUSION_PROLONGADA. Dos cubos a distinta profundidad: el de delante (z = 1)
// cruza por encima del quieto (z = −1). Se solapan mientras sus intervalos en x
// se cortan lo bastante, y el tramo tiene que ser seguido y llegar al umbral.
{
  const quieto = at("fondo", 0, 0, -1);
  const rest = [quieto, at("frente", -2, 0, 1)];
  const frames = Array.from({ length: 41 }, (_entry, frame) => [
    quieto,
    at("frente", -2 + frame * 0.1, 0, 1),
  ]);
  const audit = walk(rest, "cruce", frames, { occlusionFrames: 3 });

  assert.equal(audit.occlusions.length, 1, "un solo tramo, no uno por fotograma");
  const [oclusion] = audit.occlusions;
  assert.deepEqual(oclusion.parts, ["frente", "fondo"], "la de delante, primero");
  assert.equal(oclusion.to - oclusion.from + 1, oclusion.frames);
  assert.ok(oclusion.frames >= 3, "el tramo llega al umbral declarado");
  assert.ok(oclusion.overlap > 0.9, "en el cruce se tapan casi enteras");
  console.log(
    `pantalla: ok (OCLUSION_PROLONGADA del ${oclusion.from} al ${oclusion.to}, ${oclusion.frames} fotogramas, ` +
      `${(oclusion.overlap * 100).toFixed(0)} % de la caja tapada)`,
  );

  // El mismo cruce con el umbral por encima de su duración no avisa: el umbral
  // es lo que separa un adelantamiento de un estorbo, y tiene que mandar.
  const alto = walk(rest, "cruce", frames, { occlusionFrames: oclusion.frames + 1 });
  assert.deepEqual(alto.occlusions, [], "por debajo del umbral no se avisa");
  console.log("pantalla: ok (el umbral de fotogramas manda: el mismo cruce deja de avisar)");
}

// Lo que ya se tapaba en reposo no cuenta. Es la regla que hace utilizable la
// auditoría: en un muñeco el torso tapa a la cadera en los sesenta fotogramas, y
// avisar de eso es ruido que tapa la señal.
{
  const encima = [at("torso", 0, 0, 1), at("cadera", 0, 0, -1)];
  const audit = walk(encima, "quieto", Array.from({ length: 40 }, () => encima), {
    occlusionFrames: 3,
  });
  assert.deepEqual(audit.occlusions, [], "lo que ya se tapaba en reposo es el modelo, no la animación");
  console.log("pantalla: ok (lo que ya se tapaba en reposo no se cuenta)");
}

// Los tres códigos están en el registro y son candidatos: son cajas, no siluetas.
for (const code of ["SALE_DE_CUADRO", "ENTRADA_A_CIEGAS", "OCLUSION_PROLONGADA"]) {
  assert.ok(WARNING_CODES[code], `${code} tiene que estar en el registro`);
  assert.equal(WARNING_CODES[code].severity, "candidato", `${code} es candidato, no certeza`);
}
console.log("pantalla: ok (los tres códigos en el registro, los tres candidatos)");

// ---------------------------------------------------------------------------
// Integración por el CLI, con el ejemplar de verdad: esqueleto, clip y todo.

{
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI, "--scene", MUNECO, "--inspect-only", "--fields", "animationAudit.screen,warnings"],
    { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 },
  ).catch((error) => {
    if (error.stdout === undefined) throw error;
    return { stdout: error.stdout };
  });
  const report = JSON.parse(stdout);
  const screen = report.animationAudit.screen;

  assert.equal(screen.view, "3/4 iluminada", "se mide contra la vista que enseña el pliego");
  assert.equal(screen.tileSize, 320);
  assert.ok(screen.occlusions.length > 0, "el saludo tapa algo; si no, el ejemplar no prueba nada");
  // Y la señal está limpia: el muñeco tiene el torso encima de la cadera en
  // reposo, y eso no aparece.
  for (const occlusion of screen.occlusions) {
    assert.equal(occlusion.to - occlusion.from + 1, occlusion.frames);
    assert.ok(occlusion.frames >= screen.occlusionFrames);
  }
  const emitidos = report.warnings.filter((warning) => warning.code === "OCLUSION_PROLONGADA");
  assert.equal(emitidos.length, screen.occlusions.length, "cada oclusión sale también como aviso");
  console.log(
    `pantalla: ok (muneco.json por el CLI: ${screen.occlusions.length} oclusión(es) del movimiento, ` +
      `y los avisos las llevan)`,
  );
}
