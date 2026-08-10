/**
 * Cada herramienta MCP contra el CLI directo, caso por caso.
 *
 * Es la misma prueba que `test:bridge` y por el mismo motivo: el servidor MCP no
 * decide nada, traduce. La forma de demostrarlo es que lo que devuelve sea, dato
 * a dato, lo que devuelve el CLI llamado a mano. El día que el servidor «mejore»
 * un informe por su cuenta, esto se pone rojo.
 *
 * Y se comprueba lo otro que lo mantiene honesto: que los esquemas de parámetros
 * salen de `SCENE_SCHEMA` y compañía en vez de estar escritos a mano.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con `npm run test:mcp`,
 * que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PATCH_SCHEMA, SCENE_SCHEMA, toJsonSchema } from "../dist-node/agent3d.mjs";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const SERVER = resolve(here, "mcp-server.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");
const SCENE = resolve(projectRoot, "artifacts/agent/ejemplo-dron.json");
const STORY = resolve(projectRoot, "artifacts/agent/guion-tawantinsuyu.json");
const BVH = resolve(projectRoot, "artifacts/agent/captura-ejemplo.bvh");

/** Abre el servidor MCP y devuelve con qué hablarle por JSON-RPC. */
function openServer() {
  const child = spawn(process.execPath, [SERVER], { cwd: projectRoot });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let id = 0;
  return {
    async call(method, params) {
      id += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const { value, done } = await iterator.next();
      if (done) throw new Error("el servidor MCP cerró stdout antes de responder");
      return JSON.parse(value);
    },
    async tool(name, args) {
      const message = await this.call("tools/call", { name, arguments: args });
      if (message.error) return { error: message.error };
      const [text, ...rest] = message.result.content;
      return { report: JSON.parse(text.text), artifacts: rest };
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

/** El CLI directo. Salida 1 son avisos y sigue trayendo informe. */
async function runCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    if (error.stdout === undefined) throw error;
    return { exitCode: error.code, report: error.stdout ? JSON.parse(error.stdout) : null };
  }
}

/**
 * Lo que no puede coincidir y no debe: la ruta del sandbox y los tiempos. Todo lo
 * demás sí, y es lo que se compara.
 */
function comparable(report) {
  const copy = {
    ...report,
    sheet: report.sheet == null ? report.sheet : { ...report.sheet, totalMilliseconds: null },
    views: (report.views ?? []).map((view) => ({ ...view, milliseconds: null })),
  };
  for (const key of ["source", "file", "export", "exported", "undo", "savedScene"]) delete copy[key];
  return copy;
}

const work = await mkdtemp(join(tmpdir(), "softsight-mcp-"));
const server = openServer();

try {
  const inicio = await server.call("initialize", {});
  assert.equal(inicio.result.protocolVersion, "2024-11-05");
  const lista = (await server.call("tools/list", {})).result.tools;
  assert.deepEqual(
    lista.map((tool) => tool.name).sort(),
    [
      "softsight_bvh",
      "softsight_inspect",
      "softsight_patch",
      "softsight_render",
      "softsight_scene",
      "softsight_schema",
      "softsight_story",
    ],
    "las siete herramientas, ni una más",
  );
  for (const tool of lista) {
    assert.ok(tool.description.length > 0, `${tool.name}: sin descripción`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name}: el esquema debe ser un objeto`);
  }
  console.log(`mcp: ok (${lista.length} herramientas anunciadas con su esquema)`);

  // Los esquemas se generan: el de la escena que publica la herramienta es
  // exactamente la traducción de SCENE_SCHEMA, no una copia que envejece.
  const escena = lista.find((tool) => tool.name === "softsight_scene");
  assert.deepEqual(escena.inputSchema.properties.scene, toJsonSchema(SCENE_SCHEMA));
  const parche = lista.find((tool) => tool.name === "softsight_patch");
  assert.deepEqual(parche.inputSchema.properties.patches.items, toJsonSchema(PATCH_SCHEMA));
  console.log("mcp: ok (los esquemas de parámetros son la traducción de SCENE_SCHEMA y PATCH_SCHEMA)");

  console.log("mcp: inspect == CLI directo");
  {
    // Por defecto trae el resumen: es lo que le ahorra el turno al agente.
    // `--no-cache` en los dos lados, como en `test:bridge`: el puente escribe el
    // modelo en un sandbox nuevo por petición, así que `cached` sería distinto
    // por el transporte y no por el resultado.
    const resumen = await server.tool("softsight_inspect", { model: MODEL, noCache: true });
    const cli = await runCli(["--model", MODEL, "--inspect-only", "--summary", "--no-cache"]);
    assert.deepEqual(comparable(resumen.report), comparable(cli.report));
    assert.ok(!("families" in resumen.report), "el resumen no debe traer families");

    const completo = await server.tool("softsight_inspect", { model: MODEL, summary: false, noCache: true });
    const cliCompleto = await runCli(["--model", MODEL, "--inspect-only", "--no-cache"]);
    assert.deepEqual(comparable(completo.report), comparable(cliCompleto.report));
  }

  console.log("mcp: render == CLI directo (informe y pliego)");
  {
    const png = join(work, "mcp.png");
    const cli = await runCli(["--model", MODEL, "--tile", "160", "--out", png, "--no-cache"]);
    const tool = await server.tool("softsight_render", { model: MODEL, tile: 160, noCache: true });
    assert.deepEqual(comparable(tool.report), comparable(cli.report));
    assert.equal(tool.artifacts.length, 1, "render devuelve el pliego");
    assert.equal(tool.artifacts[0].type, "image");
    assert.deepEqual(Buffer.from(tool.artifacts[0].data, "base64"), await readFile(png));
  }

  console.log("mcp: patch == CLI directo (diff y undo)");
  {
    const patch = { edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] };
    const patchPath = join(work, "patch.json");
    await writeFile(patchPath, `${JSON.stringify(patch)}\n`);
    const cli = await runCli([
      "--model", MODEL,
      "--patch", patchPath,
      "--tile", "160",
      "--out", join(work, "patched.png"),
      "--undo", join(work, "undo.json"),
      "--no-cache",
    ]);
    const tool = await server.tool("softsight_patch", { model: MODEL, patches: [patch], tile: 160, noCache: true });
    assert.deepEqual(comparable(tool.report), comparable(cli.report));
    assert.deepEqual(
      tool.artifacts.map((artifact) => artifact.type),
      ["image", "resource"],
      "patch devuelve el pliego y el parche que lo deshace",
    );
  }

  console.log("mcp: scene, story y bvh == CLI directo");
  {
    const scene = JSON.parse(await readFile(SCENE, "utf8"));
    const cliScene = await runCli(["--scene", SCENE, "--tile", "160", "--out", join(work, "escena.png")]);
    const toolScene = await server.tool("softsight_scene", { scene, tile: 160 });
    assert.deepEqual(comparable(toolScene.report), comparable(cliScene.report));

    const story = JSON.parse(await readFile(STORY, "utf8"));
    const cliStory = await runCli(["--story", STORY]);
    const toolStory = await server.tool("softsight_story", { story });
    assert.deepEqual(comparable(toolStory.report), comparable(cliStory.report));

    const cliBvh = await runCli(["--bvh", BVH, "--export", join(work, "cli.glb")]);
    const toolBvh = await server.tool("softsight_bvh", { bvh: BVH });
    assert.deepEqual(comparable(toolBvh.report), comparable(cliBvh.report));
    assert.equal(toolBvh.artifacts.length, 1, "bvh devuelve el GLB");
    assert.deepEqual(
      Buffer.from(toolBvh.artifacts[0].resource.blob, "base64"),
      await readFile(join(work, "cli.glb")),
      "el GLB del servidor debe ser el del CLI byte a byte",
    );
  }

  console.log("mcp: schema == CLI directo, entero y por partes");
  {
    for (const part of [undefined, "scene", "codes"]) {
      const cli = await runCli(part === undefined ? ["--schema"] : ["--schema", part]);
      const tool = await server.tool("softsight_schema", part === undefined ? {} : { part });
      assert.deepEqual(tool.report, cli.report, `--schema ${part ?? "(todo)"}`);
    }
  }

  // Un error de datos llega como error de JSON-RPC, no como un informe vacío.
  const malo = await server.tool("softsight_schema", { part: "escena" });
  assert.ok(malo.error, "una parte que no existe tiene que ser un error");
  assert.match(malo.error.message, /las partes son/);
  const desconocida = await server.tool("softsight_nada", {});
  assert.match(desconocida.error.message, /herramienta desconocida/);

  console.log("mcp: ok (siete herramientas, todas iguales al CLI directo)");
} finally {
  server.close();
  await rm(work, { recursive: true, force: true });
}
