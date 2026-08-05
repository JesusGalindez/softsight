/**
 * Puerta del contrato de la puesta en escena.
 *
 * Lo que se comprueba:
 *
 *   1. Los tres avisos, cada uno con su caso mínimo: escena que no enseña nada,
 *      texto que se sale del cuadro y texto que no se lee sobre su fondo.
 *   2. Que un informe mal formado se rechace por su motivo, y no se audite a
 *      medias: no se puede medir lo que no está.
 *   3. Que el esquema publicado sea el mismo que valida — y aquí una vuelta más
 *      que en el guion: **cada campo que el esquema marca como obligatorio se
 *      comprueba quitándolo**, para que publicar y validar no puedan divergir.
 *      El validador está escrito a mano, así que sin esto el esquema sería una
 *      descripción amable de lo que el código hace de verdad.
 *   4. Que API, CLI y puente digan lo mismo, y que la auditoría no deje ficheros.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEFAULT_CONTRAST_RATIO,
  STAGING_AUDIT_CONTRACT_VERSION,
  STAGING_SCHEMA,
  STAGING_VERSION,
  auditStaging,
  contrastRatio,
  resolveStaging,
} from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/** Una pieza con un caso de cada aviso, y una escena limpia para contrastar. */
const puesta = {
  stagingVersion: STAGING_VERSION,
  title: "Puesta de prueba",
  frame: { width: 1920, height: 1080 },
  scenes: [
    {
      name: "limpia",
      startFrame: 0,
      durationFrames: 90,
      sampleFrame: 45,
      layers: [
        {
          id: "titular",
          kind: "text",
          visible: true,
          box: [200, 400, 1700, 560],
          color: [1, 1, 1],
          backgroundColor: [0.05, 0.06, 0.08],
        },
        { id: "dron", kind: "model", visible: true },
      ],
    },
    {
      name: "sin-nada",
      startFrame: 90,
      durationFrames: 60,
      sampleFrame: 120,
      layers: [{ id: "modelo", kind: "model", visible: false }],
    },
    {
      name: "desbordada",
      startFrame: 150,
      durationFrames: 60,
      sampleFrame: 180,
      layers: [
        {
          id: "pie",
          kind: "text",
          visible: true,
          box: [1500, 900, 2100, 1120],
          color: [0.55, 0.55, 0.55],
          backgroundColor: [0.42, 0.42, 0.42],
        },
      ],
    },
  ],
};

// --- 1. Los tres avisos, y solo esos
const informe = auditStaging(puesta);
assert.equal(informe.contractVersion, STAGING_AUDIT_CONTRACT_VERSION);
assert.equal(informe.contrastRatio, DEFAULT_CONTRAST_RATIO);

const porCodigo = (code) => informe.warnings.filter((warning) => warning.code === code);
assert.equal(porCodigo("ESCENA_VACIA").length, 1);
assert.equal(porCodigo("ESCENA_VACIA")[0].scene, "sin-nada");
assert.equal(porCodigo("CAJA_FUERA_DE_CUADRO").length, 1);
assert.equal(porCodigo("CAJA_FUERA_DE_CUADRO")[0].layer, "pie");
assert.equal(porCodigo("CONTRASTE_INSUFICIENTE").length, 1);
assert.equal(informe.warnings.length, 3, "no deberían salir más avisos que los tres casos");

// La escena limpia no genera ninguno, y su contraste se mide igual.
assert.equal(informe.scenes[0].visibleLayers, 2);
assert.ok(informe.scenes[0].contrasts[0].ratio > 15);

// El umbral es una suposición declarada: bajarlo quita el aviso y viaja en el
// informe, como el ritmo de lectura del guion.
const permisivo = auditStaging(puesta, { contrastRatio: 1.5 });
assert.equal(permisivo.contrastRatio, 1.5);
assert.equal(permisivo.warnings.filter((w) => w.code === "CONTRASTE_INSUFICIENTE").length, 0);

// Blanco sobre negro es 21:1, el máximo de WCAG: si esto se mueve, la fórmula
// dejó de ser la de la norma.
assert.equal(Number(contrastRatio([1, 1, 1], [0, 0, 0]).toFixed(2)), 21);
assert.equal(Number(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]).toFixed(2)), 1);

console.log(
  `staging audit: ok (${informe.scenes.length} escenas medidas, 3 clases de aviso: ` +
    `ESCENA_VACIA, CAJA_FUERA_DE_CUADRO, CONTRASTE_INSUFICIENTE)`,
);

// --- 2. Informes que no se pueden auditar
const malos = [
  [{ stagingVersion: 2, frame: { width: 10, height: 10 }, scenes: [] }, /stagingVersion/],
  [{ stagingVersion: 1, scenes: [] }, /frame/],
  [{ stagingVersion: 1, frame: { width: 0, height: 10 }, scenes: [] }, /frame/],
  [{ stagingVersion: 1, frame: { width: 10, height: 10 }, scenes: [] }, /al menos una escena/],
  [conEscena({ name: "" }), /nombre/],
  [conEscena({ durationFrames: 0 }), /durationFrames/],
  [conEscena({ sampleFrame: 999 }), /sampleFrame/],
  [conEscena({ layers: undefined }), /layers/],
  [conCapa({ id: "" }), /id/],
  [conCapa({ kind: "video" }), /kind/],
  [conCapa({ visible: "sí" }), /visible/],
  [conCapa({ box: undefined }), /box/],
  [conCapa({ color: undefined }), /color/],
  [conCapa({ backgroundColor: [2, 0, 0] }), /backgroundColor/],
  // Dos escenas con el mismo nombre: los avisos dejarían de ser direccionables.
  [
    {
      stagingVersion: 1,
      frame: { width: 10, height: 10 },
      scenes: [escenaBase(), escenaBase()],
    },
    /repetida/,
  ],
];

for (const [entrada, patron] of malos) {
  assert.throws(() => resolveStaging(entrada), patron, `debería rechazarse: ${JSON.stringify(entrada).slice(0, 80)}`);
}
assert.throws(() => auditStaging(puesta, { contrastRatio: 0.5 }), /contrastRatio/);

console.log(`staging audit: ok (${malos.length + 1} informes malos rechazados)`);

// --- 3. El esquema publicado es el que valida
const { stdout: schemaOut } = await execFileAsync("node", ["tools/agent3d.mjs", "--schema"], {
  cwd: projectRoot,
  maxBuffer: 64 * 1024 * 1024,
});
const publicado = JSON.parse(schemaOut);
assert.deepEqual(publicado.staging, JSON.parse(JSON.stringify(STAGING_SCHEMA)));

// Cada obligatorio del esquema, comprobado quitándolo de verdad.
for (const [campo, definicion] of Object.entries(STAGING_SCHEMA)) {
  if (!definicion.required) continue;
  const roto = JSON.parse(JSON.stringify(puesta));
  delete roto[campo];
  assert.throws(
    () => resolveStaging(roto),
    new RegExp(campo === "scenes" ? "escena" : campo),
    `el esquema dice que ${campo} es obligatorio, pero el validador lo acepta sin él`,
  );
}

console.log("staging audit: ok (--schema publica el mismo esquema que valida, obligatorio a obligatorio)");

// --- 4. API == CLI == puente, y sin artefactos
const temporal = mkdtempSync(join(tmpdir(), "staging-"));
const rutaPuesta = join(temporal, "puesta.json");
writeFileSync(rutaPuesta, JSON.stringify(puesta));

const { stdout: cliOut } = await execFileAsync(
  "node",
  ["tools/agent3d.mjs", "--staging", rutaPuesta],
  { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 },
).catch((error) => ({ stdout: error.stdout }));
const porCli = JSON.parse(cliOut);

const respuesta = await runBridge({
  bridgeContractVersion: 1,
  command: "staging",
  files: { staging: { name: "puesta.json", data: Buffer.from(JSON.stringify(puesta)).toString("base64") } },
});

assert.equal(respuesta.exitCode, 1, "con avisos, el puente sale con 1 como el CLI");
assert.deepEqual(respuesta.artifacts, [], "una auditoría no produce ficheros");

// `source` es lo único que puede diferir: cada vía lee el fichero de un sitio.
const sinFuente = ({ source, ...resto }) => resto;
assert.deepEqual(sinFuente(porCli), sinFuente({ ...informe, source: null }));
assert.deepEqual(sinFuente(respuesta.report), sinFuente(porCli));

// El umbral también viaja por el puente.
const permisivoPuente = await runBridge({
  bridgeContractVersion: 1,
  command: "staging",
  files: { staging: { name: "puesta.json", data: Buffer.from(JSON.stringify(puesta)).toString("base64") } },
  options: { contrastRatio: 1.5 },
});
assert.equal(permisivoPuente.report.contrastRatio, 1.5);
assert.equal(
  permisivoPuente.report.warnings.filter((w) => w.code === "CONTRASTE_INSUFICIENTE").length,
  0,
);

// Un informe de otra versión es error de datos, no volcado de pila.
const viejo = await runBridge({
  bridgeContractVersion: 1,
  command: "staging",
  files: {
    staging: {
      name: "puesta.json",
      data: Buffer.from(JSON.stringify({ ...puesta, stagingVersion: 99 })).toString("base64"),
    },
  },
});
assert.equal(viejo.code, "data-error");
assert.match(viejo.message, /stagingVersion/);

assert.equal(readdirSync(temporal).length, 1, "el CLI no debería dejar nada junto al informe");

console.log("staging bridge: ok (API == CLI == puente, y la auditoría no deja artefactos)");

function escenaBase() {
  return {
    name: "una",
    startFrame: 0,
    durationFrames: 10,
    sampleFrame: 0,
    layers: [{ id: "capa", kind: "model", visible: true }],
  };
}

function conEscena(cambios) {
  return {
    stagingVersion: 1,
    frame: { width: 1920, height: 1080 },
    scenes: [{ ...escenaBase(), ...cambios }],
  };
}

function conCapa(cambios) {
  const capa = {
    id: "titular",
    kind: "text",
    visible: true,
    box: [0, 0, 100, 50],
    color: [1, 1, 1],
    backgroundColor: [0, 0, 0],
  };
  return {
    stagingVersion: 1,
    frame: { width: 1920, height: 1080 },
    scenes: [{ ...escenaBase(), layers: [{ ...capa, ...cambios }] }],
  };
}

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
