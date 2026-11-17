/**
 * Puerta de las sesiones (plan de mejora, 3.1): N turnos por sesión dan lo mismo
 * que el CLI con la lista entera de parches, byte a byte en el pliego.
 *
 * La comparación es contra el CLI **lanzado aparte**, en otro proceso y con su
 * propia cadena de ficheros —su pliego y su informe de cada turno pasados al
 * siguiente—, no contra lo que la sesión guardó. Si la sesión compusiera los
 * parches en otro orden, encadenara mal la referencia o perdiera el encuadre, las
 * dos cadenas se separarían aquí.
 *
 * Y lo que solo tiene la sesión: deshacer vuelve al mismo estado —mismo
 * `stateHash`, mismos píxeles—, un error no la mueve de turno, otra sesión con
 * los mismos parches llega al mismo `stateHash`, y la que se expulsa se borra del
 * disco y dice cómo rehacerla.
 *
 * Opciones fijas en todas: `tile` 160 para que cada render sea barato, y
 * `--no-cache` para no dejar en `.cache/` una entrada por cada directorio
 * temporal de sesión.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { auditMesh, loadModel, summarize } from "../dist-node/agent3d.mjs";
import { runAgent } from "./agent3d.mjs";
import { forgetAuditCache, openAuditCache } from "./auditCache.mjs";
import { handleRequest } from "./bridge.mjs";
import { forgetModelCache, loadModelCached } from "./modelCache.mjs";
import { createSessionStore } from "./session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");
const SCENE = resolve(projectRoot, "artifacts/agent/ejemplo-dron.json");

const SETTINGS = { tile: 160, noCache: true };
const FLAGS = ["--tile", "160", "--no-cache", "true"];
const PATCHES = [
  { edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] },
  { edits: [{ op: "delete", target: "motor-knurl-*" }] },
  { edits: [{ op: "scale", target: "propeller-blade-*", factor: [1.2, 1, 1.2] }] },
];

const work = mkdtempSync(join(tmpdir(), "softsight-sesion-prueba-"));
const w = (name) => join(work, name);
PATCHES.forEach((patch, index) => writeFileSync(w(`p${index}.json`), `${JSON.stringify(patch)}\n`));

const filePayload = (path) => ({ name: path.split("/").pop(), data: readFileSync(path).toString("base64") });
const doc = (document, name = "parche.json") => ({
  name,
  data: Buffer.from(`${JSON.stringify(document)}\n`, "utf8").toString("base64"),
});

/** El CLI en su propio proceso. Salida 1 son avisos y sigue trayendo informe. */
function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    if (error.status === 1 && error.stdout) return { exitCode: 1, report: JSON.parse(error.stdout) };
    throw error;
  }
}

/** Lo que no puede coincidir y no debe: rutas de cada lado y tiempos. */
function comparable(report) {
  const copy = {
    ...report,
    sheet: report.sheet == null ? report.sheet : { ...report.sheet, totalMilliseconds: null },
    views: (report.views ?? []).map((view) => ({ ...view, milliseconds: null })),
  };
  for (const key of ["source", "file", "exported", "undo", "savedScene"]) delete copy[key];
  return copy;
}

const sheetOf = (response) => {
  const artifact = response.artifacts.find((entry) => entry.name === "contact-sheet.png");
  assert.ok(artifact, `${response.command}: la respuesta no trae el pliego`);
  return Buffer.from(artifact.data, "base64");
};

/** Una petición que tiene que fallar, con su código y un trozo de su motivo. */
async function rejects(promise, code, pattern) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code, `se esperaba ${code} y salió ${error.code}: ${error.message}`);
    assert.match(error.message, pattern);
    return error;
  }
  assert.fail(`se esperaba un error ${code}`);
}

const store = createSessionStore();
const call = (request, sessions = store) =>
  handleRequest({ bridgeContractVersion: 1, ...request }, runAgent, sessions);

try {
  // 1. Tres turnos de sesión contra la cadena del CLI lanzado aparte.
  const opened = await call({ command: "sessionOpen", files: { model: filePayload(MODEL) }, options: SETTINGS });
  const c0 = cli(["--model", MODEL, "--out", w("c0.png"), ...FLAGS]);
  assert.deepEqual(comparable(opened.report), comparable(c0.report));
  assert.deepEqual(sheetOf(opened), readFileSync(w("c0.png")));
  assert.deepEqual([opened.session.turn, opened.session.patches], [0, 0]);
  writeFileSync(w("r0.json"), `${JSON.stringify(c0.report)}\n`);

  const id = opened.session.id;
  const turns = [opened];
  let previous = { png: w("c0.png"), report: w("r0.json") };
  for (let k = 1; k <= 2; k += 1) {
    const turn = await call({ command: "sessionApply", session: id, files: { patches: [doc(PATCHES[k - 1])] } });
    const args = ["--model", MODEL];
    for (let index = 0; index < k; index += 1) args.push("--patch", w(`p${index}.json`));
    args.push("--baseline", previous.png, "--baseline-report", previous.report, "--out", w(`c${k}.png`), ...FLAGS);
    const ck = cli(args);
    assert.deepEqual(comparable(turn.report), comparable(ck.report), `turno ${k}: informe`);
    assert.deepEqual(sheetOf(turn), readFileSync(w(`c${k}.png`)), `turno ${k}: pliego`);
    assert.equal(turn.exitCode, ck.exitCode);
    assert.ok(turn.report.diff.changedPixels > 0, `turno ${k}: el parche tiene que verse en el diff`);
    assert.deepEqual([turn.session.turn, turn.session.patches], [k, k]);
    writeFileSync(w(`r${k}.json`), `${JSON.stringify(ck.report)}\n`);
    previous = { png: w(`c${k}.png`), report: w(`r${k}.json`) };
    turns.push(turn);
  }
  console.log(
    "sesión: ok (turnos 0, 1 y 2 iguales al CLI lanzado aparte con la lista entera y el turno anterior: " +
      "informe, código de salida y pliego byte a byte)",
  );

  // 2. El encuadre no se mueve, y sin el informe del turno 0 sí se movería.
  {
    assert.deepEqual(turns[2].report.sheet.frameAabb, opened.report.sheet.frameAabb);
    const fixed = cli([
      "--model", MODEL, "--patch", w("p0.json"), "--patch", w("p1.json"),
      "--baseline-report", w("r0.json"), "--out", w("fijo.png"), ...FLAGS,
    ]);
    assert.equal(fixed.exitCode, turns[2].exitCode);
    assert.deepEqual(sheetOf(turns[2]), readFileSync(w("fijo.png")), "el turno 2 es el CLI desde cero con el encuadre del 0");
    cli(["--model", MODEL, "--patch", w("p0.json"), "--patch", w("p1.json"), "--out", w("libre.png"), ...FLAGS]);
    assert.notDeepEqual(
      readFileSync(w("libre.png")),
      readFileSync(w("fijo.png")),
      "sin fijar el encuadre los rotores subidos mueven la cámara: si saliera igual, fijarlo no probaría nada",
    );
    console.log(
      "sesión: ok (el encuadre del turno 0 sigue en el 2, que es el CLI desde cero con ese encuadre; " +
        "y sin fijarlo el pliego sale distinto)",
    );
  }

  // 3. Deshacer vuelve al mismo estado, y quita lo de la última llamada entera.
  {
    const undone = await call({ command: "sessionUndo", session: id });
    assert.deepEqual([undone.session.turn, undone.session.patches], [3, 1]);
    assert.equal(undone.session.stateHash, turns[1].session.stateHash);
    assert.deepEqual(sheetOf(undone), sheetOf(turns[1]), "el mismo estado con el mismo encuadre son los mismos píxeles");
    assert.deepEqual(undone.report.renderHash, turns[1].report.renderHash);
    assert.ok(undone.report.diff.changedPixels > 0, "deshacer se ve contra el turno que deshace");

    const both = await call({
      command: "sessionApply",
      session: id,
      files: { patches: [doc(PATCHES[1]), doc(PATCHES[2])] },
    });
    assert.equal(both.session.patches, 3);
    const back = await call({ command: "sessionUndo", session: id });
    assert.equal(back.session.patches, 1, "deshacer quita los dos parches que entraron juntos");
    assert.equal(back.session.stateHash, turns[1].session.stateHash);

    const empty = await call({ command: "sessionUndo", session: id });
    assert.equal(empty.session.stateHash, opened.session.stateHash);
    assert.deepEqual(sheetOf(empty), sheetOf(opened));
    await rejects(call({ command: "sessionUndo", session: id }), "invalid-request", /nada que deshacer/);
    console.log(
      "sesión: ok (deshacer devuelve el stateHash y los píxeles del estado anterior, quita juntos los parches " +
        "de una misma llamada, y sin nada que deshacer lo dice)",
    );
  }

  // 4. Lo que falla no mueve la sesión.
  {
    const before = await call({ command: "sessionExport", session: id });
    const malo = { edits: [{ op: "teletransporte", target: "rotor-*" }] };
    await rejects(
      call({ command: "sessionApply", session: id, files: { patches: [doc(malo)] } }),
      "data-error",
      /no admite "teletransporte"/,
    );
    await rejects(
      call({ command: "sessionApply", session: id, files: { patches: [doc(PATCHES[0])] }, options: { tile: 200 } }),
      "invalid-request",
      /se fijan al abrir/,
    );
    await rejects(
      call({ command: "sessionApply", session: id, files: { patches: [doc(PATCHES[0])] }, options: { fields: "trianlges" } }),
      "data-error",
      /¿querías decir triangles\?/,
    );
    const after = await call({ command: "sessionExport", session: id });
    assert.deepEqual(after.session, before.session, "ningún error tiene que mover el turno ni el estado");
    await rejects(call({ command: "sessionApply", session: "sesion-999", files: { patches: [doc(PATCHES[0])] } }),
      "session-not-found", /vuelve a aplicar/);
    await rejects(
      call({ command: "sessionOpen", files: { model: filePayload(MODEL) } }, null),
      "invalid-request",
      /proceso residente/,
    );
    console.log(
      "sesión: ok (un parche con error de esquema, una opción de revisión en un turno o una errata en fields " +
        "dejan la sesión donde estaba; sin almacén, sesiones no)",
    );
  }

  // 5. El estado se identifica por lo que es: otra sesión con el mismo parche
  // llega al mismo stateHash, y el resumen es la proyección del informe del CLI.
  {
    const other = await call({ command: "sessionOpen", files: { model: filePayload(MODEL) }, options: SETTINGS });
    writeFileSync(w("b0.png"), sheetOf(other));
    writeFileSync(w("b0.json"), `${JSON.stringify(other.report)}\n`);
    const resumida = await call({
      command: "sessionApply",
      session: other.session.id,
      files: { patches: [doc(PATCHES[0], "otro-nombre.json")] },
      options: { summary: true },
    });
    assert.equal(resumida.session.stateHash, turns[1].session.stateHash, "mismo estado, mismo stateHash");
    assert.deepEqual(sheetOf(resumida), sheetOf(turns[1]));
    const cliResumen = cli([
      "--model", MODEL, "--patch", w("p0.json"), "--baseline", w("b0.png"), "--baseline-report", w("b0.json"),
      "--out", w("b1.png"), "--summary", ...FLAGS,
    ]);
    assert.deepEqual(resumida.report, cliResumen.report);
    assert.deepEqual(resumida.report, summarize(turns[1].report));

    // Exportar: el GLB es el del CLI byte a byte, y la lista reproduce el estado.
    const glb = await call({ command: "sessionExport", session: other.session.id });
    cli(["--model", MODEL, "--patch", w("p0.json"), "--inspect-only", "true", "--export", w("e.glb"), ...FLAGS]);
    const byName = Object.fromEntries(glb.artifacts.map((entry) => [entry.name, Buffer.from(entry.data, "base64")]));
    assert.deepEqual(byName["drone.glb"], readFileSync(w("e.glb")));
    assert.deepEqual(JSON.parse(byName["parches.json"]), { stateHash: resumida.session.stateHash, patches: [PATCHES[0]] });
    const obj = await call({ command: "sessionExport", session: other.session.id, options: { format: "obj" } });
    assert.ok(obj.artifacts.some((entry) => entry.name === "drone.obj"));
    console.log(
      "sesión: ok (otra sesión con el mismo parche llega al mismo stateHash y los mismos píxeles, su resumen es " +
        "el del CLI, y el GLB exportado es el del CLI byte a byte)",
    );
  }

  // 6. Escena: el parche edita el documento, y el turno sigue siendo el CLI.
  {
    const scene = await call({ command: "sessionOpen", files: { scene: filePayload(SCENE) }, options: SETTINGS });
    const s0 = cli(["--scene", SCENE, "--out", w("s0.png"), ...FLAGS]);
    assert.deepEqual(sheetOf(scene), readFileSync(w("s0.png")));
    writeFileSync(w("sr0.json"), `${JSON.stringify(s0.report)}\n`);
    const move = { edits: [{ op: "translate", target: "*", delta: [0, 0.25, 0] }] };
    writeFileSync(w("ps.json"), `${JSON.stringify(move)}\n`);
    const turn = await call({ command: "sessionApply", session: scene.session.id, files: { patches: [doc(move)] } });
    const s1 = cli([
      "--scene", SCENE, "--patch", w("ps.json"), "--baseline", w("s0.png"), "--baseline-report", w("sr0.json"),
      "--out", w("s1.png"), ...FLAGS,
    ]);
    assert.deepEqual(comparable(turn.report), comparable(s1.report));
    assert.deepEqual(sheetOf(turn), readFileSync(w("s1.png")));
    console.log("sesión: ok (una escena: el turno con su parche es el CLI --scene con la misma cadena, byte a byte)");
  }

  // 7. La que se expulsa se borra del disco y dice cómo rehacerla.
  {
    const mine = () => readdirSync(tmpdir()).filter((name) => name.startsWith("softsight-sesion-") && !name.includes("prueba"));
    const before = mine().length;
    const tiny = createSessionStore({ max: 1 });
    const inspect = { ...SETTINGS, inspectOnly: true };
    const first = await call({ command: "sessionOpen", files: { model: filePayload(MODEL) }, options: inspect }, tiny);
    assert.deepEqual(first.artifacts, [], "sin pliego no viaja ningún artefacto");
    await call({ command: "sessionOpen", files: { model: filePayload(MODEL) }, options: inspect }, tiny);
    assert.equal(mine().length, before + 1, "la expulsada tiene que borrar su directorio");
    await rejects(
      call({ command: "sessionApply", session: first.session.id, files: { patches: [doc(PATCHES[0])] } }, tiny),
      "session-not-found",
      /se expulsó.*stateHash/s,
    );
    tiny.closeAll();
    assert.equal(mine().length, before);
    console.log("sesión: ok (con sitio para una, abrir otra expulsa la primera, borra su directorio y lo dice al pedirla)");
  }

  // 8. Por el modo residente de verdad: `agent3d --serve` atiende sesiones y el
  // puente de un disparo las rechaza.
  {
    const child = spawn(process.execPath, [CLI, "--serve"], { cwd: projectRoot });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
    const ask = async (request) => {
      child.stdin.write(`${JSON.stringify({ bridgeContractVersion: 1, ...request })}\n`);
      return JSON.parse((await lines.next()).value);
    };
    try {
      const inspect = { ...SETTINGS, inspectOnly: true, summary: true };
      const a = await ask({ command: "sessionOpen", files: { model: filePayload(MODEL) }, options: inspect });
      const b = await ask({ command: "sessionApply", session: a.session.id, files: { patches: [doc(PATCHES[0])] }, options: { summary: true } });
      assert.deepEqual([b.session.turn, b.session.patches], [1, 1]);
      assert.ok(b.report.warningsDelta, "sin pliego sigue habiendo delta de avisos contra el turno anterior");
      assert.equal(b.report.diff, null, "y sin pliego el diff es null: no hubo nada que comparar");
    } finally {
      child.stdin.end();
    }
    let oneShot;
    try {
      execFileSync(process.execPath, [resolve(here, "bridge.mjs")], {
        cwd: projectRoot,
        input: JSON.stringify({ bridgeContractVersion: 1, command: "sessionOpen", files: { model: filePayload(MODEL) } }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      assert.fail("el puente de un disparo no puede abrir una sesión");
    } catch (error) {
      assert.equal(error.status, 2, "el rechazo sale con 2, como cualquier error del puente");
      oneShot = JSON.parse(error.stdout);
    }
    assert.match(oneShot.message, /proceso residente/);
    console.log("sesión: ok (agent3d --serve lleva la sesión de una petición a la siguiente, y el puente de un disparo la rechaza con su motivo)");
  }
  // 9. Lo que una sesión o un barrido dejan en las cachés del CLI se olvida con
  // ellos: las dos cachés tienen la ruta en la clave, y la ruta muere con el
  // directorio. Con raíces propias, para no depender de lo que otras puertas
  // escriban a la vez en `.cache/`.
  {
    const modelPath = w("olvidar.glb");
    writeFileSync(modelPath, readFileSync(MODEL));
    const modelRoot = w("cache-modelo");
    const auditRoot = w("cache-auditorias");
    const bytes = readFileSync(modelPath);
    const { model } = await loadModelCached(
      modelPath,
      async () => loadModel(modelPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      { root: modelRoot },
    );
    const audits = openAuditCache(modelPath, auditMesh, { root: auditRoot });
    audits.auditMesh(model.parts[0].mesh);
    audits.flush();
    assert.equal(readdirSync(modelRoot).length, 1);
    assert.equal(readdirSync(auditRoot).length, 1);
    forgetModelCache(modelPath, { root: modelRoot });
    forgetAuditCache(modelPath, { root: auditRoot });
    assert.deepEqual([readdirSync(modelRoot).length, readdirSync(auditRoot).length], [0, 0]);
    console.log("sesión: ok (la entrada del modelo y la de sus auditorías se olvidan con la ruta que las nombraba)");
  }
} finally {
  store.closeAll();
  rmSync(work, { recursive: true, force: true });
}

console.log(
  "sesión: fuera de alcance — las sesiones viven en el proceso que las abrió: si el servidor se reinicia, se " +
    "pierden, y lo que las rehace es la lista de parches que el agente mandó, con el stateHash para comprobarlo. " +
    "Persistirlas en disco sería un segundo estado que alguien tendría que invalidar",
);
