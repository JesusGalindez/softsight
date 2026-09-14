/**
 * Puerta de R16 — el paquete cruza por ruta, y quién puede leer qué.
 *
 * Hasta aquí el puente no podía leer nada que no le hubieran dado en base64, y
 * eso era su modelo de seguridad entero. Aceptar una ruta lo cambia, así que lo
 * que esta puerta demuestra **no es que funcione**, que es lo fácil, sino que las
 * cinco reglas del §84 aguantan las cuatro formas conocidas de salirse:
 *
 * ```text
 * sin raíz declarada           no hay lectura, y lo dice con su código
 * `..` en la ruta              se rechaza aunque resolviera dentro
 * enlace simbólico que escapa  realpath lo ve y lo para
 * raíz hermana                 /datos/x no es prefijo de /datos/x-otro
 * ```
 *
 * La cuarta es la que un `startsWith` sobre cadenas deja pasar, y por eso está.
 *
 * Y el bloque 3 es el de siempre: lo que devuelve el puente tiene que ser, dato a
 * dato, lo que devuelve el CLI. El puente transporta; el día que «mejore» un
 * informe por su cuenta, esto se pone rojo.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { BridgeError, handleRequest } from "./bridge.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { writeProductionAsset } from "./productionAsset.mjs";
import { inspectPackage, projectCoverage } from "./reconstruction.mjs";
import { inspectAsset } from "./production.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const sandbox = mkdtempSync(join(tmpdir(), "softsight-transporte-"));
// El hermano de la raíz, **fuera** de ella: es el caso que distingue comparar por
// componentes de comparar por cadenas.
const raiz = join(sandbox, "paquetes");
const hermano = join(sandbox, "paquetes-de-otro");
mkdirSync(raiz, { recursive: true });
mkdirSync(hermano, { recursive: true });
const cubo = join(raiz, "cube-v1");
writeCubePackage(cubo);
const ajeno = join(hermano, "cube-v1");
writeCubePackage(ajeno);
const asset = join(raiz, "esfera-v1");
mkdirSync(asset, { recursive: true });
writeProductionAsset(asset);

/** Una petición con la raíz declarada por **configuración**, como manda la regla 1. */
async function pide(request, roots = raiz) {
  const previo = process.env.SOFTSIGHT_PACKAGE_ROOTS;
  process.env.SOFTSIGHT_PACKAGE_ROOTS = roots;
  try {
    return { response: await handleRequest(request), error: null };
  } catch (error) {
    if (!(error instanceof BridgeError)) throw error;
    return { response: null, error };
  } finally {
    if (previo === undefined) delete process.env.SOFTSIGHT_PACKAGE_ROOTS;
    else process.env.SOFTSIGHT_PACKAGE_ROOTS = previo;
  }
}

const inspeccion = { bridgeContractVersion: 2, command: "reconstructionInspect", package: { root: cubo } };

// 1. Sin raíz declarada no se lee nada, y se distingue de «no existe».
{
  const previo = process.env.SOFTSIGHT_PACKAGE_ROOTS;
  delete process.env.SOFTSIGHT_PACKAGE_ROOTS;
  let capturado = null;
  try {
    await handleRequest(inspeccion);
  } catch (error) {
    capturado = error;
  } finally {
    if (previo !== undefined) process.env.SOFTSIGHT_PACKAGE_ROOTS = previo;
  }
  assert.ok(capturado instanceof BridgeError);
  assert.equal(capturado.code, "package-root-not-configured");
  // Y el mensaje nombra la variable: quien lo recibe tiene que poder arreglarlo
  // sin leerse el código del puente.
  assert.match(capturado.message, /SOFTSIGHT_PACKAGE_ROOTS/);

  console.log(
    "transporte: ok (sin raíz declarada no hay lectura, y el código la distingue de «no existe»: " +
      "configurar el servidor y arreglar la petición no son el mismo arreglo)",
  );
}

// 2. Las cuatro formas de salirse.
{
  // `..`, aunque resolviera **dentro** de la raíz. Se rechaza igual: una petición
  // que navega se dice, no se corrige en silencio.
  const dentro = await pide({
    ...inspeccion,
    // Sin `join`: `path.join` normaliza el `..` antes de que nadie lo vea, y lo
    // que llega por JSON es la cadena tal cual la escribió el cliente.
    package: { root: `${cubo}/../cube-v1` },
  });
  assert.equal(dentro.error?.code, "package-path-escapes");

  // El hermano: `paquetes` **no** es prefijo de `paquetes-de-otro`. Un
  // `startsWith` sobre cadenas deja pasar esto.
  const vecino = await pide({ ...inspeccion, package: { root: ajeno } });
  assert.equal(vecino.error?.code, "package-path-escapes", "la raíz hermana no puede colarse por prefijo");

  // Un enlace simbólico **dentro** de la raíz que apunta fuera. El nombre cae
  // dentro y el destino no; realpath es lo que ve la diferencia.
  const tunel = join(raiz, "atajo");
  symlinkSync(ajeno, tunel);
  const enlace = await pide({ ...inspeccion, package: { root: tunel } });
  assert.equal(enlace.error?.code, "package-path-escapes", "un enlace que sale de la raíz no vale");

  // Y el manifest no lo elige el cliente: la raíz declarada es permiso para el
  // paquete, no para cualquier JSON que haya dentro.
  const sinManifest = await pide({ ...inspeccion, package: { root: raiz } });
  assert.equal(sinManifest.error?.code, "package-not-found");

  console.log(
    "transporte: ok (las cuatro salidas cerradas: `..` que resolvería dentro, raíz hermana por prefijo, " +
      "enlace simbólico hacia fuera, y un directorio sin manifest)",
  );
}

// 3. La versión, y que las dos formas de entrada no se mezclan.
{
  const vieja = await pide({ ...inspeccion, bridgeContractVersion: 1 });
  assert.equal(vieja.error?.code, "invalid-request");
  assert.match(vieja.error.message, /bridgeContractVersion 2/, "el cliente tiene que enterarse de qué habla");

  // Base64 **y** ruta en la misma petición no se contesta: de dónde sale el
  // fichero cuando vienen los dos no tiene respuesta buena.
  const mezcla = await pide({ ...inspeccion, files: { model: { name: "a.glb", data: "AAAA" } } });
  assert.equal(mezcla.error?.code, "invalid-request");
  assert.match(mezcla.error.message, /base64/);

  // Y los diez comandos de la 1 siguen hablando la 1: la respuesta hace eco de lo
  // que se pidió, no del máximo que el puente sabe.
  const uno = await pide({ bridgeContractVersion: 1, command: "schema", options: { part: "codes" } });
  assert.equal(uno.response.bridgeContractVersion, 1, "un cliente de la 1 no puede recibir un 2");

  console.log(
    "transporte: ok (la 2 es obligatoria para los cuatro nuevos, base64 y ruta no se mezclan, y la " +
      "respuesta hace eco de la versión pedida: el editor no cambia)",
  );
}

// 4. El puente transporta: dato a dato, lo que devuelve el CLI.
{
  const manifest = join(cubo, "manifest.json");
  const directo = inspectPackage(manifest);

  const puente = await pide(inspeccion);
  assert.equal(puente.response.exitCode, directo.exitCode);
  assert.deepEqual(puente.response.report, directo.report, "el puente no puede mejorar un informe");
  assert.deepEqual(puente.response.artifacts, [], "un paquete de 150 MB no vuelve por donde no cabía entrar");

  // La cobertura es una **proyección**, no otra medida: mismo número, no un
  // número parecido. Si volviera a muestrear, su semilla daría otro.
  const recorte = await pide({ ...inspeccion, command: "reconstructionCoverage" });
  assert.deepEqual(recorte.response.report, projectCoverage(directo.report));
  assert.equal(
    recorte.response.report.coverage.observedAreaRatio,
    directo.report.coverage.observedAreaRatio,
    "dos números distintos para la misma pregunta es lo que D1 prohíbe",
  );
  assert.equal(recorte.response.report.measurements, undefined, "la proyección recorta de verdad");

  console.log(
    `transporte: ok (informe idéntico al CLI, y la cobertura del recorte es **la misma**: ` +
      `${(directo.report.coverage.observedAreaRatio * 100).toFixed(1)} % en los dos, no dos muestreos)`,
  );
}

// 5. Comparar y validar producción, por la misma puerta.
{
  const dosRaices = `${raiz}:${hermano}`;
  const comparacion = await pide(
    {
      bridgeContractVersion: 2,
      command: "reconstructionCompare",
      packages: [{ root: cubo }, { root: ajeno }],
    },
    dosRaices,
  );
  assert.ok(Array.isArray(comparacion.response.report.compared));
  assert.equal(comparacion.response.report.compared.length, 2);

  // Con una sola raíz, el segundo candidato no entra: declarar dos discos es una
  // decisión de configuración, y una petición no puede tomarla.
  const media = await pide({
    bridgeContractVersion: 2,
    command: "reconstructionCompare",
    packages: [{ root: cubo }, { root: ajeno }],
  });
  assert.equal(media.error?.code, "package-path-escapes");

  const produccion = await pide({
    bridgeContractVersion: 2,
    command: "productionValidate",
    package: { root: asset },
  });
  const directoAsset = inspectAsset(join(asset, "manifest.json"), undefined);
  assert.deepEqual(produccion.response.report, directoAsset.report);
  assert.equal(produccion.response.exitCode, directoAsset.exitCode);
  // Sin validador externo no hay aprobación, y eso viaja igual por el puente.
  assert.notEqual(produccion.response.report.readiness.verdict, "PRODUCTION_READY");

  console.log(
    `transporte: ok (comparar dos candidatos necesita las dos raíces declaradas, y el asset sale por el ` +
      `puente con el mismo veredicto que por el CLI: ${produccion.response.report.readiness.verdict})`,
  );
}

// 6. Y las cuatro herramientas MCP, que envuelven exactamente estas peticiones.
{
  const child = spawn(process.execPath, [resolve(here, "mcp-server.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, SOFTSIGHT_PACKAGE_ROOTS: raiz },
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let id = 0;
  const call = async (method, params) => {
    id += 1;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const { value } = await iterator.next();
    return JSON.parse(value);
  };

  try {
    await call("initialize", {});
    const nombres = (await call("tools/list", {})).result.tools.map((tool) => tool.name);
    for (const nombre of [
      "softsight_reconstruction_inspect",
      "softsight_reconstruction_coverage",
      "softsight_reconstruction_compare",
      "softsight_production_validate",
    ]) {
      assert.ok(nombres.includes(nombre), `falta la herramienta ${nombre}`);
    }

    const respuesta = await call("tools/call", {
      name: "softsight_reconstruction_coverage",
      arguments: { root: cubo },
    });
    const informe = JSON.parse(respuesta.result.content[0].text);
    assert.deepEqual(informe, projectCoverage(inspectPackage(join(cubo, "manifest.json")).report));

    // La raíz la pone el entorno del servidor, no el argumento: una herramienta
    // que pidiera un paquete de fuera falla igual que el puente.
    const fuera = await call("tools/call", {
      name: "softsight_reconstruction_inspect",
      arguments: { root: ajeno },
    });
    const texto = JSON.stringify(fuera);
    assert.match(texto, /package-path-escapes/, "el sandbox sigue entero detrás del MCP");

    console.log(
      "transporte: ok (las cuatro herramientas MCP registradas, y la de cobertura devuelve exactamente " +
        "la proyección del CLI; la raíz la sigue poniendo el entorno y no el argumento)",
    );
  } finally {
    child.stdin.end();
    child.kill();
  }
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "transporte: no ejecutada — la opción 1 del §84 queda abierta solo para **lectura**; los artefactos " +
    "siguen saliendo por el canal de siempre, así que un paquete que produjera 150 MB de salida " +
    "todavía no tiene por dónde devolverlos",
);
