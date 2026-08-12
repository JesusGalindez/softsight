/**
 * Puerta del contrato del guion.
 *
 * Lo que se comprueba es lo que un agente falla de verdad al escribir una pieza:
 *
 *   1. Que la duración salga de la suma y cada escena sepa dónde empieza, con
 *      aritmética exacta. Es el número del que cuelga todo lo demás.
 *   2. Que un guion mal escrito se rechace por el motivo correcto: rol
 *      inventado, nombre repetido, duración imposible, y —el que importa— un
 *      campo que el rol necesitaba y no está.
 *   3. Que el esquema publicado sea **el mismo** que valida la entrada: se
 *      compara lo que sale por `--schema` contra el que usa el resolutor, y se
 *      comprueba que un campo inventado se rechaza con sugerencia.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEFAULT_READING_RATE,
  REQUIRED_ROLES,
  ROLE_REQUIRED_DATA,
  SCENE_ROLES,
  STORY_AUDIT_CONTRACT_VERSION,
  STORY_SCHEMA,
  STORY_VERSION,
  auditStory,
  resolveStory,
  validate,
} from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const guion = {
  storyVersion: 1,
  title: "Tawantinsuyu",
  fps: 30,
  scenes: [
    {
      name: "origen",
      role: "apertura",
      durationFrames: 210,
      data: {
        headline: "h. 1200",
        subject: "Manku Qhapaq",
        line: "En el valle del Qosqo nace un señorío pequeño.",
      },
    },
    {
      name: "expansión",
      role: "desarrollo",
      durationFrames: 180,
      data: { line: "Cuatro caminos salen del centro hacia los cuatro suyus." },
    },
    {
      name: "pachakutiq",
      role: "giro",
      durationFrames: 270,
      data: {
        headline: "1438",
        subject: "Pachakutiq Inka Yupanki",
        line: "Tras vencer a los chankas, el Qosqo empieza a conquistar.",
      },
    },
    {
      name: "final",
      role: "cierre",
      durationFrames: 150,
      data: { line: "En 1532 el imperio entero cabe en una emboscada." },
    },
  ],
};

// --- 1. La duración se deriva y cada escena sabe dónde empieza

const resuelto = resolveStory(guion);

assert.equal(resuelto.durationFrames, 210 + 180 + 270 + 150);
assert.deepEqual(
  resuelto.scenes.map((escena) => escena.startFrame),
  [0, 210, 390, 660],
);
assert.deepEqual(
  resuelto.scenes.map((escena) => escena.name),
  ["origen", "expansión", "pachakutiq", "final"],
);
assert.equal(resuelto.fps, 30);

// Sin huecos ni solapes: cada escena empieza donde acaba la anterior.
for (let index = 1; index < resuelto.scenes.length; index += 1) {
  const anterior = resuelto.scenes[index - 1];
  assert.equal(
    resuelto.scenes[index].startFrame,
    anterior.startFrame + anterior.durationFrames,
    `la escena ${resuelto.scenes[index].name} no empieza donde acaba la anterior`,
  );
}

// Resolver dos veces el mismo guion da lo mismo: no hay estado por medio.
assert.deepEqual(resolveStory(guion), resuelto);

console.log(
  `story spec: ok (${resuelto.scenes.length} escenas, ${resuelto.durationFrames} frames derivados)`,
);

// --- 2. Un guion mal escrito se rechaza por el motivo correcto

function conEscenas(escenas) {
  return { ...guion, scenes: escenas };
}

const rechazos = [
  [{ ...guion, storyVersion: 2 }, /storyVersion 2 no es la de este contrato/],
  [{ ...guion, title: "   " }, /necesita un título/],
  [{ ...guion, fps: 0 }, /fps debe ser un entero positivo/],
  [conEscenas([]), /al menos una escena/],
  [conEscenas([{ ...guion.scenes[0], name: "" }]), /necesita un nombre/],
  [conEscenas([guion.scenes[0], guion.scenes[0]]), /ya es el nombre de otra escena/],
  // El rol inventado lo caza el esquema, con la lista de los que valen.
  [conEscenas([{ ...guion.scenes[1], role: "clímax" }]), /role no admite "clímax"; admitidos: apertura, /],
  [conEscenas([{ ...guion.scenes[1], durationFrames: 0 }]), /entero positivo/],
  [conEscenas([{ ...guion.scenes[1], durationFrames: 12.5 }]), /entero positivo/],
];

for (const [malo, esperado] of rechazos) {
  assert.throws(() => resolveStory(malo), esperado);
}

// El que de verdad importa: el rol exige un campo y el agente no lo puso.
assert.throws(
  () =>
    resolveStory(
      conEscenas([{ name: "origen", role: "apertura", durationFrames: 60, data: { line: "algo" } }]),
    ),
  /el rol 'apertura' necesita data.headline/,
);

// Un campo vacío es igual de inútil que uno ausente, y falla igual.
assert.throws(
  () =>
    resolveStory(
      conEscenas([
        { name: "origen", role: "cierre", durationFrames: 60, data: { line: "   " } },
      ]),
    ),
  /necesita data.line/,
);

// Cada rol declarado tiene su exigencia escrita: un rol nuevo sin tabla sería un
// rol que no comprueba nada.
for (const rol of SCENE_ROLES) {
  assert.ok(
    Array.isArray(ROLE_REQUIRED_DATA[rol]) && ROLE_REQUIRED_DATA[rol].length > 0,
    `el rol ${rol} no declara qué campos de data necesita`,
  );
}

// Datos de más se admiten: son datos, no maqueta. `subject` no lo exige nadie.
assert.equal(resuelto.scenes[0].data.subject, "Manku Qhapaq");

console.log(`story spec: ok (${rechazos.length + 2} guiones malos rechazados)`);

// --- 3. El esquema publicado es el que valida la entrada

assert.deepEqual(validate(guion, STORY_SCHEMA), []);
assert.deepEqual(validate({ ...guion, storyVersion: undefined }, STORY_SCHEMA), [
  "falta storyVersion (number)",
]);
assert.deepEqual(validate({ ...guion, titel: "x" }, STORY_SCHEMA), [
  "titel no existe; ¿querías decir title?",
]);

const { stdout } = await execFileAsync("node", ["tools/agent3d.mjs", "--schema"], {
  cwd: projectRoot,
  maxBuffer: 32 * 1024 * 1024,
});
const publicado = JSON.parse(stdout);

assert.deepEqual(
  publicado.story,
  JSON.parse(JSON.stringify(STORY_SCHEMA)),
  "el esquema publicado por --schema no es el que valida la entrada",
);

// Los campos que exige cada rol también se publican: quien pone el guion en
// escena los necesita, y si los copia sin comparar acaban divergiendo.
assert.deepEqual(
  publicado.storyRoles,
  JSON.parse(JSON.stringify(ROLE_REQUIRED_DATA)),
  "--schema no publica la misma tabla de campos por rol que exige el resolutor",
);
assert.deepEqual(Object.keys(publicado.storyRoles).sort(), [...SCENE_ROLES].sort());
assert.equal(guion.storyVersion, STORY_VERSION);

console.log("story spec: ok (--schema publica el mismo esquema que valida)");

// --- 4. La auditoría mide hechos, y solo hechos

const auditoria = auditStory(guion);

assert.equal(auditoria.contractVersion, STORY_AUDIT_CONTRACT_VERSION);
assert.equal(auditoria.readingRate, DEFAULT_READING_RATE);
assert.equal(auditoria.durationFrames, resuelto.durationFrames);

// Un guion holgado no tiene nada que decir: una auditoría que siempre avisa no
// distingue nada.
assert.deepEqual(auditoria.warnings, []);

// La cuenta de caracteres y el tiempo salen exactos, no aproximados.
const origen = auditoria.scenes[0];
const caracteres = Object.values(guion.scenes[0].data).reduce(
  (total, valor) => total + valor.trim().length,
  0,
);
assert.equal(origen.characters, caracteres);
assert.equal(origen.secondsAvailable, 210 / 30);
assert.equal(origen.secondsNeeded, caracteres / DEFAULT_READING_RATE);
assert.equal(origen.framesNeeded, Math.ceil((caracteres / DEFAULT_READING_RATE) * 30));

// Texto que no se puede leer en el tiempo que dura: el aviso trae los frames
// que harían falta, no solo la queja.
const apretado = auditStory(
  conEscenas([
    { ...guion.scenes[0], durationFrames: 15 },
    guion.scenes[3],
  ]),
);
const ilegible = apretado.warnings.find((aviso) => aviso.code === "TEXTO_ILEGIBLE");
assert.ok(ilegible, "no avisó de una escena que no se puede leer");
assert.equal(ilegible.scene, "origen");
assert.match(ilegible.message, /dale \d+ frames/);
// El aviso dice de qué ritmo parte: la suposición no se esconde.
assert.match(ilegible.message, /suposición/);

// Subir el ritmo supuesto quita el aviso, y eso demuestra que es un parámetro
// declarado y no una constante escondida.
assert.deepEqual(
  auditStory(
    conEscenas([{ ...guion.scenes[0], durationFrames: 15 }, guion.scenes[3]]),
    { readingRate: 1000 },
  ).warnings,
  [],
);
assert.throws(() => auditStory(guion, { readingRate: 0 }), /caracteres por segundo/);

// Falta el rol que la pieza necesita.
const sinCierre = auditStory(conEscenas(guion.scenes.slice(0, 3)));
const ausente = sinCierre.warnings.find((aviso) => aviso.code === "ROL_AUSENTE");
assert.ok(ausente, "no avisó de una pieza sin cierre");
assert.equal(ausente.scene, null);
for (const rol of REQUIRED_ROLES) {
  assert.match(ausente.message, new RegExp(rol));
}

// Dos escenas seguidas con el mismo papel.
const repetido = auditStory(
  conEscenas([
    guion.scenes[0],
    guion.scenes[1],
    { ...guion.scenes[1], name: "expansión-2" },
    guion.scenes[3],
  ]),
);
const consecutivos = repetido.warnings.filter((aviso) => aviso.code === "ROLES_CONSECUTIVOS");
assert.equal(consecutivos.length, 1);
assert.equal(consecutivos[0].scene, "expansión-2");

// Auditar no arregla ni reordena nada: mismo guion, mismo informe.
assert.deepEqual(auditStory(guion), auditoria);

console.log(
  `story audit: ok (${auditoria.scenes.length} escenas medidas, ` +
    `3 clases de aviso: TEXTO_ILEGIBLE, ROL_AUSENTE, ROLES_CONSECUTIVOS)`,
);

// --- 5. API, CLI y puente dicen exactamente lo mismo

const trabajo = mkdtempSync(join(tmpdir(), "softsight-story-"));
try {
  const guionApretado = conEscenas([{ ...guion.scenes[0], durationFrames: 15 }, guion.scenes[3]]);
  const guionPath = join(trabajo, "guion.json");
  writeFileSync(guionPath, `${JSON.stringify(guionApretado, null, 2)}\n`);

  // Este guion solo trae TEXTO_ILEGIBLE, que es `candidato`: el aviso sale entero
  // en el informe y el CLI sale 0, porque el código 1 dice «hay un defecto» y no
  // «hay algo que mirar». Con un defecto sí sale 1, y se comprueba más abajo.
  const porCli = await execFileAsync("node", ["tools/agent3d.mjs", "--story", guionPath], {
    cwd: projectRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  const informeCli = JSON.parse(porCli.stdout);
  assert.deepEqual(
    informeCli.warnings.map((aviso) => aviso.severity),
    ["candidato"],
    "el guion apretado debería traer un solo aviso, y candidato",
  );

  const respuesta = await runBridge({ bridgeContractVersion: 1, command: "story", files: { story: { name: "guion.json", data: readFileSync(guionPath).toString("base64") } } });
  assert.equal(respuesta.exitCode, 0, "el puente debe devolver el mismo código que el CLI");
  assert.deepEqual(respuesta.artifacts, [], "un guion no produce artefactos");

  // Y el otro lado del código de salida: un guion sin el rol que la pieza exige
  // trae ROL_AUSENTE, que es `certeza`, y entonces los dos caminos salen 1.
  const guionSinCierre = join(trabajo, "sin-cierre.json");
  writeFileSync(guionSinCierre, `${JSON.stringify(conEscenas(guion.scenes.slice(0, 3)), null, 2)}\n`);
  const conDefecto = await execFileAsync("node", ["tools/agent3d.mjs", "--story", guionSinCierre], {
    cwd: projectRoot,
    maxBuffer: 32 * 1024 * 1024,
  }).catch((error) => {
    assert.equal(error.code, 1, "el CLI debería salir 1 cuando el guion tiene un defecto");
    return { stdout: error.stdout };
  });
  assert.ok(
    JSON.parse(conDefecto.stdout).warnings.some((aviso) => aviso.code === "ROL_AUSENTE"),
    "el guion sin cierre debería traer ROL_AUSENTE",
  );
  const puenteConDefecto = await runBridge({
    bridgeContractVersion: 1,
    command: "story",
    files: { story: { name: "sin-cierre.json", data: readFileSync(guionSinCierre).toString("base64") } },
  });
  assert.equal(puenteConDefecto.exitCode, 1, "el puente debe devolver el mismo código que el CLI");

  // El `source` es la única diferencia legítima: cada vía lee el fichero de un
  // sitio. Todo lo demás tiene que coincidir byte a byte.
  const { source: _cli, ...cliSinRuta } = informeCli;
  const { source: _puente, ...puenteSinRuta } = respuesta.report;
  assert.deepEqual(puenteSinRuta, cliSinRuta, "CLI y puente no dicen lo mismo del mismo guion");
  assert.deepEqual(
    cliSinRuta,
    JSON.parse(JSON.stringify(auditStory(guionApretado))),
    "el CLI decide algo que la API no",
  );

  // La opción declarada también viaja por el puente y quita el aviso.
  const holgado = await runBridge({
    bridgeContractVersion: 1,
    command: "story",
    files: { story: { name: "guion.json", data: readFileSync(guionPath).toString("base64") } },
    options: { readingRate: 1000 },
  });
  assert.equal(holgado.exitCode, 0);
  assert.deepEqual(holgado.report.warnings, []);

  // Un guion incoherente es error de datos, no una pila volcada.
  writeFileSync(guionPath, `${JSON.stringify({ ...guion, storyVersion: 2 })}\n`);
  const malo = await runBridge({
    bridgeContractVersion: 1,
    command: "story",
    files: { story: { name: "guion.json", data: readFileSync(guionPath).toString("base64") } },
  });
  assert.equal(malo.code, "data-error");
  assert.match(malo.message, /storyVersion/);
} finally {
  rmSync(trabajo, { recursive: true, force: true });
}

console.log("story bridge: ok (API == CLI == puente, y el guion no deja artefactos)");

// --- 6. Los ejemplares están limpios y no son la misma pieza dos veces
//
// Son lo que un agente lee antes de escribir, así que un ejemplar con avisos
// enseñaría justo lo que la puerta rechaza. Y dos ejemplares con la misma forma
// enseñarían una plantilla, que es lo que este plan evita a propósito.

const ejemplares = ["guion-tawantinsuyu.json", "guion-lavarse-las-manos.json"].map((nombre) => {
  const ruta = join(projectRoot, "artifacts/agent", nombre);
  const guionEjemplar = JSON.parse(readFileSync(ruta, "utf8"));
  const informe = auditStory(guionEjemplar);
  assert.deepEqual(
    informe.warnings,
    [],
    `el ejemplar ${nombre} tiene avisos: ${informe.warnings.map((aviso) => aviso.code).join(", ")}`,
  );
  assert.ok(informe.scenes.length >= 5, `${nombre} es demasiado corto para enseñar nada`);
  return { nombre, guion: guionEjemplar, informe };
});

const formas = ejemplares.map((ejemplar) => ejemplar.guion.scenes.map((escena) => escena.role).join(">"));
assert.notEqual(formas[0], formas[1], "los dos ejemplares tienen la misma secuencia de roles");
assert.notEqual(
  ejemplares[0].informe.scenes.length,
  ejemplares[1].informe.scenes.length,
  "los dos ejemplares tienen el mismo número de escenas",
);

// El ritmo tampoco es plano: una pieza en la que todas las escenas duran lo
// mismo es la que el plan llama monótona, y un ejemplar no debería serlo.
for (const { nombre, guion: guionEjemplar } of ejemplares) {
  const duraciones = new Set(guionEjemplar.scenes.map((escena) => escena.durationFrames));
  assert.ok(duraciones.size >= 3, `${nombre} reparte el tiempo casi por igual entre sus escenas`);
}

console.log(
  `story ejemplares: ok (${ejemplares.length} piezas limpias, formas ${formas.join(" y ")})`,
);

/** Una petición al puente, como la hace el editor: JSON por stdin, JSON por stdout. */
async function runBridge(request) {
  return await new Promise((resolveResponse, reject) => {
    const child = spawn("node", ["tools/bridge.mjs"], { cwd: projectRoot });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolveResponse(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
