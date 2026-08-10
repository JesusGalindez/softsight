/**
 * Paridad de encuadre, la mitad que le toca a softsight (E1 de `plan-convergencia.md`).
 *
 * La otra mitad —comparar nuestras cajas contra las del editor— vive allí, y no
 * puede significar nada si esta no se cumple: **el informe tiene que bastar**.
 * Si para reproducir una caja hiciera falta un dato que solo está en nuestros
 * internos —el aspecto, el tamaño del tile, un margen—, el editor no estaría
 * comparando dos encuadres sino adivinando el nuestro, y un FOV desalineado se
 * vería como diferencia de píxeles novecientos frames después en vez de aquí.
 *
 * Así que lo que se comprueba es exactamente eso: **cada caja publicada en
 * `partScreenBoxes` se reproduce con la cámara publicada en `views[].camera`**,
 * usando solo lo que el informe trae, y después de pasar el informe por JSON de
 * ida y vuelta, que es como lo recibe un consumidor de verdad.
 *
 * Lo que un consumidor **no puede adivinar** y por eso se comprueba aparte: la
 * cámara se usa con **aspecto 1 sobre un tile cuadrado de `sheet.tileSize`**, y
 * el pliego entero no es cuadrado. Quien tome el aspecto del pliego en vez del
 * del tile obtiene otras cajas, y es justo el fallo que E1 nombra.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con
 * `npm run test:framing`, que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  computeSceneAabb,
  loadModel,
  projectAabbToTile,
  resolveScene,
  selectParts,
} from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const CONTROL = resolve(projectRoot, "artifacts/agent/encuadre-control.json");

/** El CLI, con el informe ya pasado por JSON de ida y vuelta. */
async function runCli(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    if (error.stdout === undefined) throw error;
    stdout = error.stdout;
  }
  // La vuelta por JSON no es adorno: es como llega el informe al otro lado, y si
  // la cámara perdiera precisión al serializarse, las cajas dejarían de salir.
  return JSON.parse(JSON.stringify(JSON.parse(stdout)));
}

/**
 * Reproduce las cajas del informe **solo con lo que el informe publica**:
 * `views[].camera`, `views[].column`, `views[].row` y `sheet.tileSize`.
 */
function reproduce(report, parts) {
  const boxes = {};
  for (const view of report.views) {
    const byPart = {};
    for (const part of parts) {
      const box = projectAabbToTile(computeSceneAabb([part]), view.camera, report.sheet.tileSize);
      if (box === null) continue;
      const offsetX = view.column * report.sheet.tileSize;
      const offsetY = view.row * report.sheet.tileSize;
      byPart[part.name] = [
        box[0] + offsetX,
        box[1] + offsetY,
        box[2] + offsetX,
        box[3] + offsetY,
      ];
    }
    boxes[view.name] = byPart;
  }
  return boxes;
}

/** Las piezas de una escena declarativa, con la forma que quiere `computeSceneAabb`. */
async function scenePartsOf(scenePath) {
  const spec = JSON.parse(await readFile(scenePath, "utf8"));
  return resolveScene(spec).map((entry) => ({ name: entry.name, ...entry.node }));
}

const work = await mkdtemp(join(tmpdir(), "softsight-framing-"));
let totalBoxes = 0;

try {
  // Las tres escenas de paridad, que son las que el editor enfrenta contra su
  // propio rasterizador. Si el encuadre no es reproducible aquí, allí no hay nada
  // que comparar.
  for (const name of ["escena-paridad", "escena-paridad-planas", "escena-paridad-texto"]) {
    const scenePath = resolve(projectRoot, `artifacts/agent/${name}.json`);
    const report = await runCli(["--scene", scenePath, "--tile", "160", "--out", join(work, `${name}.png`)]);
    const parts = await scenePartsOf(scenePath);

    assert.deepEqual(
      reproduce(report, parts),
      report.partScreenBoxes,
      `${name}: las cajas publicadas no se reproducen con la cámara publicada`,
    );
    for (const view of Object.values(report.partScreenBoxes)) totalBoxes += Object.keys(view).length;
  }
  console.log(`encuadre: ok (${totalBoxes} cajas de tres escenas, reproducidas con la cámara publicada)`);

  // Y el camino de `--model`, que es otro: ahí las cajas salen de las piezas
  // auditadas, no de los objetos de la escena. El dron es el fixture difícil de
  // A5, así que es el que vale.
  {
    const modelPath = resolve(projectRoot, "artifacts/export/drone.glb");
    const report = await runCli([
      "--model", modelPath,
      "--select", "rotor-*",
      "--tile", "160",
      "--out", join(work, "dron.png"),
    ]);
    const model = await loadModel(modelPath, (await readFile(modelPath)).buffer);
    const audited = selectParts(model, ["rotor-*"]).slice(0, 12);
    const parts = audited.map((part) => ({ name: part.name, mesh: part.mesh, model: part.matrix }));
    assert.ok(parts.length > 0, "la selección tiene que dejar piezas auditadas");

    assert.deepEqual(
      reproduce(report, parts),
      report.partScreenBoxes,
      "dron: las cajas publicadas no se reproducen con la cámara publicada",
    );
    const dronBoxes = Object.values(report.partScreenBoxes).reduce(
      (total, view) => total + Object.keys(view).length,
      0,
    );
    totalBoxes += dronBoxes;
    console.log(`encuadre: ok (${dronBoxes} cajas del dron por --model, mismo resultado)`);

    // El dato que un consumidor no puede adivinar: el aspecto es el del **tile**,
    // que es cuadrado, y no el del pliego, que no lo es. Sin esto escrito, tomar
    // el aspecto del pliego es el error natural, y es el que E1 nombra.
    assert.equal(report.sheet.width, report.sheet.tileSize * report.sheet.columns);
    assert.equal(report.sheet.height, report.sheet.tileSize * report.sheet.rows);
    assert.notEqual(
      report.sheet.width / report.sheet.height,
      1,
      "el pliego no es cuadrado; el tile sí, y es el suyo el que manda",
    );
    console.log(
      `encuadre: ok (el tile es ${report.sheet.tileSize}×${report.sheet.tileSize} y el pliego ` +
        `${report.sheet.width}×${report.sheet.height}: el aspecto que manda es el del tile)`,
    );
  }

  // El fichero de control que el editor fija: cámaras y cajas de la escena de
  // paridad, congeladas. Es lo mismo que hace `render-hashes.json` con el pliego
  // —un valor de control, no una segunda fuente— y es lo que convierte un cambio
  // de encuadre nuestro en una puerta roja allí en vez de en una sorpresa.
  const scenePath = resolve(projectRoot, "artifacts/agent/escena-paridad.json");
  const report = await runCli(["--scene", scenePath, "--tile", "160", "--out", join(work, "control.png")]);
  const observed = {
    schemaVersion: 1,
    scene: "artifacts/agent/escena-paridad.json",
    tile: 160,
    sheet: {
      tileSize: report.sheet.tileSize,
      columns: report.sheet.columns,
      rows: report.sheet.rows,
    },
    // El aspecto con el que se proyecta, escrito y no supuesto.
    tileAspect: 1,
    views: report.views.map((view) => ({
      name: view.name,
      column: view.column,
      row: view.row,
      camera: view.camera,
    })),
    partScreenBoxes: report.partScreenBoxes,
  };

  if (process.argv.includes("--write")) {
    await writeFile(CONTROL, `${JSON.stringify(observed, null, 2)}\n`);
    console.log(`encuadre: fijado ${CONTROL}`);
  } else {
    const fixed = JSON.parse(await readFile(CONTROL, "utf8"));
    assert.equal(fixed.schemaVersion, 1, "encuadre-control.json: schemaVersion desconocida");
    assert.deepEqual(
      observed,
      fixed,
      "el encuadre cambió respecto al control; si es a propósito, refíjalo con --write y avisa al editor",
    );
    console.log(
      `encuadre: ok (${observed.views.length} cámaras y sus cajas == artifacts/agent/encuadre-control.json)`,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
