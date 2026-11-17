/**
 * Cada herramienta MCP contra el CLI directo, caso por caso.
 *
 * Es la misma prueba que `test:bridge` y por el mismo motivo: el servidor MCP no
 * decide nada, traduce. La forma de demostrarlo es que lo que devuelve sea, dato
 * a dato, lo que devuelve el CLI llamado a mano. El día que el servidor «mejore»
 * un informe por su cuenta, esto se pone rojo.
 *
 * Y se comprueba lo otro que lo mantiene honesto:
 *
 * - que **cada comando del puente tiene herramienta**, o una exclusión escrita;
 * - que el catálogo **no vuelve a crecer** hasta incrustar los esquemas: un techo
 *   en bytes, medido;
 * - que un error de datos vuelve **dentro del resultado** con `isError`, que es
 *   lo que el modelo lee para corregirse;
 * - que con `SOFTSIGHT_OUTPUT_ROOT` **el bucle de A1 se cierra**: el pliego de un
 *   render, por su ruta, es el `baseline` del patch siguiente.
 *
 * Necesita `dist-node/agent3d.mjs` construido: se ejecuta con `npm run test:mcp`,
 * que hace el build antes.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { COMMANDS } from "./bridge.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { fixture } from "./fixtures.mjs";
import { EXCLUDED_COMMANDS, PROTOCOL_VERSIONS, TOOLS } from "./mcp-server.mjs";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CLI = resolve(here, "agent3d.mjs");
const SERVER = resolve(here, "mcp-server.mjs");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");
const SCENE = resolve(projectRoot, "artifacts/agent/ejemplo-dron.json");
const STORY = resolve(projectRoot, "artifacts/agent/guion-tawantinsuyu.json");
const BVH = resolve(projectRoot, "artifacts/agent/captura-ejemplo.bvh");
const LATEST = PROTOCOL_VERSIONS[0];

/**
 * El techo del catálogo, en bytes, con la revisión más nueva. Medido el
 * 2026-11-17: 11.085 B con catorce herramientas, contra 41.204 B con once cuando
 * cada una incrustaba su esquema. No llega a los 6 KB que pedía el plan porque
 * las opciones tipadas de cada herramienta —el motivo de usar MCP— son la mayor
 * parte; el techo está para que no vuelva a crecer sin que nadie lo vea.
 *
 * **Subido a propósito con la fase 3**: las cinco de sesión y barrido lo llevan a
 * 16.632 B con diecinueve. Lo que pesa son las opciones de revisión de
 * `softsight_open` y `softsight_sweep`, que son estado de la sesión y no se
 * pueden quitar sin volver a pedirlas en cada turno.
 *
 * **Y otra vez con las fases 4 y 5**: `softsight_status` y `softsight_partition`
 * lo llevan a 17.887 B con veintiuna.
 */
const CATALOG_MAX_BYTES = 18_500;

/** Abre el servidor MCP y devuelve con qué hablarle por JSON-RPC. */
function openServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd: projectRoot, env: { ...process.env, ...env } });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let id = 0;
  return {
    async call(method, params) {
      id += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const { value, done } = await iterator.next();
      if (done) throw new Error("el servidor MCP cerró stdout antes de responder");
      return { message: JSON.parse(value), bytes: Buffer.byteLength(value) };
    },
    async tool(name, args) {
      const { message, bytes } = await this.call("tools/call", { name, arguments: args });
      if (message.error) return { error: message.error };
      const { content, isError, structuredContent } = message.result;
      const [text, ...rest] = content;
      return { report: JSON.parse(text.text), artifacts: rest, isError, structuredContent, bytes };
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
  // El diff nombra los dos ficheros por su ruta, y la del servidor es su sandbox.
  for (const side of ["from", "to"]) if (copy[side]?.path !== undefined) copy[side] = { ...copy[side], path: null };
  return copy;
}

const work = await mkdtemp(join(tmpdir(), "softsight-mcp-"));
const server = openServer();

try {
  // 1. Cada comando del puente tiene herramienta, o un motivo escrito para no
  // tenerla. Sin esto, `diff`, `sample` y `staging` estuvieron un mes sin
  // herramienta y la puerta contaba «once, ni una más» en verde.
  {
    const covered = new Set(Object.values(TOOLS).map((tool) => tool.command));
    for (const command of COMMANDS) {
      assert.ok(
        covered.has(command) || command in EXCLUDED_COMMANDS,
        `el comando del puente «${command}» no tiene herramienta MCP ni exclusión escrita`,
      );
    }
    for (const command of covered) assert.ok(COMMANDS.has(command), `herramienta para un comando que no existe: ${command}`);
    console.log(`mcp: ok (los ${COMMANDS.size} comandos del puente tienen herramienta: ${covered.size} de ${COMMANDS.size})`);
  }

  // 2. La revisión del protocolo se pacta, y lo que se anuncia depende de ella.
  {
    const nueva = await server.call("initialize", { protocolVersion: LATEST });
    assert.equal(nueva.message.result.protocolVersion, LATEST);
    assert.deepEqual(nueva.message.result.capabilities, { tools: {}, resources: {} });

    const { message, bytes } = await server.call("tools/list", {});
    const lista = message.result.tools;
    assert.equal(lista.length, Object.keys(TOOLS).length);
    assert.ok(bytes <= CATALOG_MAX_BYTES, `el catálogo pesa ${bytes} B, por encima del techo de ${CATALOG_MAX_BYTES}`);
    for (const tool of lista) {
      assert.ok(tool.description.length > 0, `${tool.name}: sin descripción`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name}: el esquema debe ser un objeto`);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name}: sin readOnlyHint`);
      // Declarada en todas; cuál no es idempotente lo comprueba el bloque 6.
      assert.equal(typeof tool.annotations.idempotentHint, "boolean", `${tool.name}: sin idempotentHint`);
    }
    // Ligero: la escena y el parche nombran su forma, no la copian.
    const escena = lista.find((tool) => tool.name === "softsight_scene").inputSchema.properties.scene;
    assert.equal(escena.properties, undefined, "el catálogo no debe incrustar SCENE_SCHEMA");
    assert.match(escena.description, /softsight_schema part=scene/);
    console.log(`mcp: ok (${lista.length} herramientas en ${bytes} B con anotaciones, techo ${CATALOG_MAX_BYTES}; antes 41.204 B)`);

    // Un cliente viejo recibe lo de siempre: sin anotaciones, que no conoce.
    const vieja = openServer();
    try {
      const inicio = await vieja.call("initialize", { protocolVersion: "2024-11-05" });
      assert.equal(inicio.message.result.protocolVersion, "2024-11-05");
      const herramientas = (await vieja.call("tools/list", {})).message.result.tools;
      assert.ok(herramientas.every((tool) => tool.annotations === undefined));
      const otra = openServer();
      try {
        const desconocida = await otra.call("initialize", { protocolVersion: "1999-01-01" });
        assert.equal(desconocida.message.result.protocolVersion, LATEST, "una revisión desconocida recibe la más nueva");
      } finally {
        otra.close();
      }
    } finally {
      vieja.close();
    }
    console.log(`mcp: ok (se pacta la revisión: ${PROTOCOL_VERSIONS.join(", ")}; una desconocida recibe la más nueva)`);
  }

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
    // El mismo informe, como objeto, y con el código de salida que por texto no se veía.
    assert.deepEqual(resumen.structuredContent.report, resumen.report);
    assert.equal(resumen.structuredContent.exitCode, cli.exitCode);

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

  console.log("mcp: scene (con y sin parches), story, staging y bvh == CLI directo");
  {
    const scene = JSON.parse(await readFile(SCENE, "utf8"));
    const cliScene = await runCli(["--scene", SCENE, "--tile", "160", "--out", join(work, "escena.png")]);
    const toolScene = await server.tool("softsight_scene", { scene, tile: 160 });
    assert.deepEqual(comparable(toolScene.report), comparable(cliScene.report));

    // El puente aceptaba parches sobre la escena y la herramienta no los dejaba pasar.
    const patch = { edits: [{ op: "translate", target: "*", delta: [0, 0.25, 0] }] };
    const patchPath = join(work, "escena-patch.json");
    await writeFile(patchPath, `${JSON.stringify(patch)}\n`);
    const cliPatched = await runCli([
      "--scene", SCENE, "--patch", patchPath, "--tile", "160", "--out", join(work, "escena-p.png"),
    ]);
    const toolPatched = await server.tool("softsight_scene", { scene, patches: [patch], tile: 160 });
    assert.deepEqual(comparable(toolPatched.report), comparable(cliPatched.report));
    assert.notDeepEqual(comparable(toolPatched.report), comparable(toolScene.report), "el parche no se aplicó");

    const story = JSON.parse(await readFile(STORY, "utf8"));
    const cliStory = await runCli(["--story", STORY]);
    const toolStory = await server.tool("softsight_story", { story });
    assert.deepEqual(comparable(toolStory.report), comparable(cliStory.report));

    const staging = {
      stagingVersion: 1,
      title: "Puesta de prueba",
      frame: { width: 1920, height: 1080 },
      scenes: [
        {
          name: "limpia",
          startFrame: 0,
          durationFrames: 90,
          sampleFrame: 45,
          layers: [
            { id: "titular", kind: "text", visible: true, box: [200, 400, 1700, 560], color: [1, 1, 1], backgroundColor: [0.05, 0.06, 0.08] },
            { id: "dron", kind: "model", visible: true },
          ],
        },
        { name: "sin-nada", startFrame: 90, durationFrames: 60, sampleFrame: 120, layers: [{ id: "modelo", kind: "model", visible: false }] },
      ],
    };
    const stagingPath = join(work, "staging.json");
    await writeFile(stagingPath, `${JSON.stringify(staging)}\n`);
    const cliStaging = await runCli(["--staging", stagingPath]);
    const toolStaging = await server.tool("softsight_staging", { staging });
    assert.deepEqual(comparable(toolStaging.report), comparable(cliStaging.report));
    assert.equal(toolStaging.structuredContent.exitCode, cliStaging.exitCode);

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

  console.log("mcp: diff == CLI directo");
  {
    // La otra versión se fabrica aquí: un OBJ de `artifacts/agent/` estaría
    // ignorado por git y en CI no existiría.
    const OTHER = join(work, "otra.obj");
    const movePath = join(work, "mover.json");
    await writeFile(movePath, `${JSON.stringify({ edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] })}\n`);
    await runCli(["--model", MODEL, "--patch", movePath, "--inspect-only", "true", "--export", OTHER, "--no-cache"]);
    assert.ok(existsSync(OTHER), "no se pudo fabricar la otra versión del dron");
    const cli = await runCli(["--model", MODEL, "--diff", OTHER, "--diff-samples", "2000"]);
    const tool = await server.tool("softsight_diff", { model: MODEL, other: OTHER, diffSamples: 2000 });
    assert.deepEqual(comparable(tool.report), comparable(cli.report));
    assert.equal(tool.structuredContent.exitCode, cli.exitCode);
  }

  {
    const names = ["jumping-jacks.glb", "jumping-jacks-refs.json"];
    if (names.every((name) => existsSync(fixture(name)))) {
      const args = ["--model", fixture(names[0]), "--inspect-only", "true", "--sample", fixture(names[1])];
      const cli = await runCli([...args, "--frames", "0,15,30,37", "--fps", "30", "--no-cache"]);
      const tool = await server.tool("softsight_sample", {
        model: fixture(names[0]),
        references: fixture(names[1]),
        frames: "0,15,30,37",
        fps: 30,
        noCache: true,
      });
      assert.deepEqual(tool.report.sample, cli.report.sample);
      console.log("mcp: ok (sample == CLI directo: las mismas referencias dan los mismos hashes)");
    } else {
      console.log(`mcp: no ejecutada — sample necesita el fixture certificado ${names.join(" y ")} (SOFTSIGHT_FIXTURES)`);
    }
  }

  console.log("mcp: schema == CLI directo, entero y por partes");
  {
    for (const part of [undefined, "scene", "codes"]) {
      const cli = await runCli(part === undefined ? ["--schema"] : ["--schema", part]);
      const tool = await server.tool("softsight_schema", part === undefined ? {} : { part });
      assert.deepEqual(tool.report, cli.report, `--schema ${part ?? "(todo)"}`);
    }
  }

  // 3. Los errores de datos vuelven dentro del resultado, con el mismo texto que el
  // puente: el modelo lo lee y se corrige. Hasta 2026-11-17 salían como error de
  // JSON-RPC, que hay clientes que no le enseñan.
  {
    const malo = await server.tool("softsight_schema", { part: "escena" });
    assert.equal(malo.isError, true, "una parte que no existe es un error de la herramienta");
    assert.match(malo.report.message, /las partes son/);

    const guion = await server.tool("softsight_story", { story: { titulo: "x" } });
    assert.equal(guion.isError, true);
    assert.equal(guion.report.code, "data-error");
    assert.match(guion.report.message, /titulo no existe; admitidos: .*title/, "la sugerencia tiene que llegar");

    const sinFichero = await server.tool("softsight_inspect", { model: join(work, "no-existe.glb") });
    assert.equal(sinFichero.isError, true, "un fichero que no existe es un resultado, no un fallo del servidor");

    // Lo que sí es de protocolo sigue siéndolo.
    const desconocida = await server.tool("softsight_nada", {});
    assert.match(desconocida.error.message, /herramienta desconocida/);
    const metodo = await server.call("nada/nada", {});
    assert.equal(metodo.message.error.code, -32601);
    console.log("mcp: ok (los errores de datos vuelven con isError y su sugerencia; herramienta y método desconocidos siguen siendo de protocolo)");
  }

  // 4. Recursos: el esquema por partes y los ejemplares, sin listar el directorio.
  {
    const { resources } = (await server.call("resources/list", {})).message.result;
    const uris = resources.map((resource) => resource.uri);
    assert.ok(uris.includes("softsight://schema/codes"));
    assert.ok(uris.includes("softsight://ejemplo/ejemplo-dron.json"));

    const codes = (await server.call("resources/read", { uri: "softsight://schema/codes" })).message.result;
    assert.deepEqual(JSON.parse(codes.contents[0].text), (await runCli(["--schema", "codes"])).report);
    const ejemplo = (await server.call("resources/read", { uri: "softsight://ejemplo/ejemplo-dron.json" })).message.result;
    assert.deepEqual(JSON.parse(ejemplo.contents[0].text), JSON.parse(await readFile(SCENE, "utf8")));

    const fuera = await server.call("resources/read", { uri: "softsight://ejemplo/../../package.json" });
    assert.equal(fuera.message.error.code, -32002, "solo se leen los nombres que lista el directorio");
    console.log(`mcp: ok (${resources.length} recursos; el esquema leído es el del CLI y un nombre que no está en la lista no se lee)`);
  }

  // 5. Con la raíz de salida declarada, los artefactos vuelven como rutas y el
  // bucle de A1 se cierra por MCP: el pliego del render es el baseline del patch.
  {
    const out = join(work, "salida");
    const conRaiz = openServer({ SOFTSIGHT_OUTPUT_ROOT: out });
    try {
      await conRaiz.call("initialize", { protocolVersion: LATEST });
      const render = await conRaiz.tool("softsight_render", { model: MODEL, tile: 160, noCache: true });
      const [rutas, enlace] = render.artifacts;
      const { artifacts } = JSON.parse(rutas.text);
      assert.equal(artifacts.length, 1);
      assert.ok(artifacts[0].path.startsWith(out), "el pliego se escribe bajo la raíz declarada");
      assert.equal(enlace.type, "resource_link");
      assert.ok(!render.artifacts.some((block) => block.type === "image"), "sin image:true no viaja la imagen");
      assert.deepEqual(render.structuredContent.artifacts, artifacts);

      const sueltoPng = join(work, "suelto.png");
      await runCli(["--model", MODEL, "--tile", "160", "--out", sueltoPng, "--no-cache"]);
      assert.deepEqual(await readFile(artifacts[0].path), await readFile(sueltoPng), "el pliego escrito es el del CLI");

      const patch = { edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] };
      const patchPath = join(work, "patch-a1.json");
      await writeFile(patchPath, `${JSON.stringify(patch)}\n`);
      const cli = await runCli([
        "--model", MODEL, "--patch", patchPath, "--baseline", artifacts[0].path, "--tile", "160",
        "--out", join(work, "a1.png"), "--undo", join(work, "a1-undo.json"), "--no-cache",
      ]);
      const tool = await conRaiz.tool("softsight_patch", {
        model: MODEL, patches: [patch], baseline: artifacts[0].path, tile: 160, noCache: true,
      });
      assert.ok(tool.report.diff, "con baseline el informe trae el diff");
      assert.deepEqual(tool.report.diff, cli.report.diff);
      // La misma llamada sin raíz trae el pliego en base64: la diferencia es lo que
      // el agente deja de pagar en cada turno.
      const enLinea = await server.tool("softsight_patch", { model: MODEL, patches: [patch], tile: 160, noCache: true });
      assert.ok(
        tool.bytes < enLinea.bytes,
        `por ruta (${tool.bytes} B) tiene que pesar menos que en línea (${enLinea.bytes} B)`,
      );

      const conImagen = await conRaiz.tool("softsight_render", { model: MODEL, tile: 160, noCache: true, image: true });
      assert.ok(conImagen.artifacts.some((block) => block.type === "image"), "image:true añade la imagen");
      console.log(
        `mcp: ok (con SOFTSIGHT_OUTPUT_ROOT el pliego vuelve por ruta y es el baseline del patch: el diff es el del CLI, ` +
          `y la respuesta pesa ${tool.bytes} B contra ${enLinea.bytes} B con el PNG en línea)`,
      );
    } finally {
      conRaiz.close();
    }
  }

  // 6. Sesiones y barrido por MCP: el identificador vuelve en su bloque, el turno
  // es el del CLI con el turno anterior como referencia, deshacer vuelve al
  // estado de apertura, y el barrido trae la fila de la llamada suelta. Sin
  // pliego, para que sea barato: los píxeles los cubre `test:session`.
  {
    const lista = (await server.call("tools/list", {})).message.result.tools;
    const hint = (name) => lista.find((tool) => tool.name === name).annotations.idempotentHint;
    assert.equal(hint("softsight_apply"), false, "aplicar dos veces no deja el mismo estado que aplicarlo una");
    assert.equal(hint("softsight_sweep"), true);

    const base = { model: MODEL, tile: 160, noCache: true, inspectOnly: true, summary: false };
    const abierta = await server.tool("softsight_open", base);
    const [sesion] = abierta.artifacts;
    const { session } = JSON.parse(sesion.text);
    assert.deepEqual(abierta.structuredContent.session, session);
    const r0 = await runCli(["--model", MODEL, "--inspect-only", "true", "--tile", "160", "--no-cache", "true"]);
    assert.deepEqual(comparable(abierta.report), comparable(r0.report));
    await writeFile(join(work, "s-r0.json"), `${JSON.stringify(r0.report)}\n`);

    const patch = { edits: [{ op: "translate", target: "rotor-*", delta: [0, 0.1, 0] }] };
    await writeFile(join(work, "s-p.json"), `${JSON.stringify(patch)}\n`);
    const aplicada = await server.tool("softsight_apply", { session: session.id, patches: [patch], summary: false });
    const r1 = await runCli([
      "--model", MODEL, "--patch", join(work, "s-p.json"), "--baseline-report", join(work, "s-r0.json"),
      "--inspect-only", "true", "--tile", "160", "--no-cache", "true",
    ]);
    assert.deepEqual(comparable(aplicada.report), comparable(r1.report));
    assert.equal(aplicada.structuredContent.session.patches, 1);

    const exportada = await server.tool("softsight_export", { session: session.id });
    await runCli([
      "--model", MODEL, "--patch", join(work, "s-p.json"), "--inspect-only", "true", "--export", join(work, "s.glb"),
      "--tile", "160", "--no-cache", "true",
    ]);
    const glb = exportada.artifacts.find((block) => block.resource?.uri === "softsight://drone.glb");
    assert.deepEqual(Buffer.from(glb.resource.blob, "base64"), await readFile(join(work, "s.glb")));

    const deshecha = await server.tool("softsight_undo", { session: session.id });
    assert.equal(deshecha.structuredContent.session.stateHash, session.stateHash, "deshacer vuelve al estado de apertura");
    const otra = await server.tool("softsight_undo", { session: session.id });
    assert.equal(otra.isError, true, "sin nada que deshacer es un error de la herramienta, con su motivo");

    const barrido = await server.tool("softsight_sweep", {
      model: MODEL,
      tile: 160,
      noCache: true,
      variants: [{ name: "movido", patches: [patch] }],
      criteria: [{ field: "triangles", direction: "MENOR_MEJOR" }],
      fields: "triangles,warningsDelta",
    });
    const suelta = await runCli([
      "--model", MODEL, "--patch", join(work, "s-p.json"), "--baseline-report", join(work, "s-r0.json"),
      "--inspect-only", "true", "--fields", "triangles,warningsDelta", "--tile", "160", "--no-cache", "true",
    ]);
    assert.deepEqual(barrido.report.variants[0].row, suelta.report);
    assert.equal(barrido.report.reason, "NINGUN_CRITERIO_DECIDIBLE", "mover rotores no cambia los triángulos");
    console.log(
      "mcp: ok (sesión por MCP: abrir, aplicar y exportar dan lo del CLI con el turno anterior como referencia, " +
        "deshacer vuelve al stateHash de apertura, y el barrido trae la fila de la llamada suelta)",
    );
  }

  // 7. El estado y el reparto (fases 4 y 5): los dos, lo mismo que el CLI.
  {
    const estado = await server.tool("softsight_status", {});
    assert.deepEqual(estado.report, (await runCli(["--status"])).report, "softsight_status es --status");

    writeCubePackage(join(work, "cubo"));
    const malla = join(work, "cubo/mesh.ply");
    const reparto = { partitionVersion: 1, parts: [{ name: "cara", triangles: [0, 1] }, { name: "resto", triangles: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }] };
    await writeFile(join(work, "reparto.json"), `${JSON.stringify(reparto)}\n`);
    const tool = await server.tool("softsight_partition", { model: malla, partition: reparto });
    const cli = await runCli(["--model", malla, "--partition", join(work, "reparto.json")]);
    assert.deepEqual({ ...tool.report, source: null }, { ...cli.report, source: null });
    assert.deepEqual(tool.report.cut, { edges: 4, length: 4 });
    console.log("mcp: ok (softsight_status es --status, y softsight_partition audita el reparto igual que --partition)");
  }

  console.log(`mcp: ok (${Object.keys(TOOLS).length} herramientas; las de modelo, iguales al CLI directo)`);
} finally {
  server.close();
  await rm(work, { recursive: true, force: true });
}
