/**
 * Puerta de R16 — la geometría que se mide y la que se mira (§54).
 *
 * Lo que puede salir mal aquí no es que el proxy se vea feo: es que alguien mida
 * sobre él. Una malla simplificada tiene menos triángulos, menos bordes y otra
 * silueta, y los tres son números que el informe publica. Así que los bloques
 * decisivos son el 3 y el 4:
 *
 * ```text
 * 3  con proxy activo, TODA medida sigue saliendo de la malla entera
 * 4  `renderSource` viaja también cuando no hubo proxy
 * ```
 *
 * El 4 parece redundante y es lo contrario. Si el campo solo apareciera al
 * simplificar, su ausencia significaría dos cosas —«fue entera» y «esta versión
 * no lo dice»— y quien lea una medida de un informe viejo no podría distinguirlas.
 *
 * Y el bloque 5 pone el número que impide confundir esto con un LOD: se mide con
 * la comparación de siluetas de R12, que es la que dijo que la silueta es donde
 * un nivel de detalle se nota.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PREVIEW_MAX_TRIANGLES,
  buildPreviewProxy,
  compareSilhouettes,
  describeRenderSource,
} from "../dist-node/agent3d.mjs";
import { spherifiedCube } from "./productionAsset.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const MODEL = resolve(projectRoot, "artifacts/export/drone.glb");

// Una esfera teselada fina: 64 divisiones dan 8.192 triángulos, suficientes para
// pedirle un presupuesto muy por debajo y ver qué hace.
const malla = spherifiedCube(32);
const triangulos = malla.indices.length / 3;

// 1. Por debajo del presupuesto no se toca nada, y se nota en la identidad.
{
  const igual = buildPreviewProxy(malla, triangulos);
  assert.equal(igual, malla, "sin nada que simplificar no puede haber copia");
  assert.deepEqual(describeRenderSource(triangulos, triangulos), {
    type: "full",
    sourceTriangles: triangulos,
    renderTriangles: triangulos,
  });

  console.log(
    `proxy: ok (${triangulos} triángulos con presupuesto de ${triangulos}: la misma malla por identidad, ` +
      "sin copiar; copiar para no cambiar nada duplicaría la memoria justo cuando ya es grande)",
  );
}

// 2. Por encima, simplifica y lo dice.
{
  const presupuesto = Math.floor(triangulos / 8);
  const proxy = buildPreviewProxy(malla, presupuesto);
  const salen = proxy.indices.length / 3;
  assert.ok(salen < triangulos, `el proxy tiene ${salen} y la malla ${triangulos}`);
  assert.equal(describeRenderSource(triangulos, salen).type, "proxy");

  // Determinismo: dos construcciones, los mismos bytes. Si el representante de
  // celda dependiera del orden de recorrido del mapa, esto se movería.
  const otra = buildPreviewProxy(malla, presupuesto);
  assert.deepEqual(Array.from(proxy.positions), Array.from(otra.positions));
  assert.deepEqual(Array.from(proxy.indices), Array.from(otra.indices));

  console.log(
    `proxy: ok (${triangulos} → ${salen} triángulos con presupuesto ${presupuesto}, y dos ` +
      "construcciones dan los mismos bytes)",
  );
}

// 3. Todo vértice del proxy está **en** la malla, no cerca.
//
// Es lo que distingue agrupar con representante de agrupar promediando. El
// promedio de tres vértices de una esquina cae dentro de la pieza: un proxy de
// promedios se encoge, y encogerse es exactamente lo que no puede hacer algo que
// sirve para juzgar si una pieza toca el suelo.
{
  const proxy = buildPreviewProxy(malla, Math.floor(triangulos / 8));
  const originales = new Set();
  for (let index = 0; index < malla.positions.length / 3; index += 1) {
    originales.add(
      `${malla.positions[index * 3]}|${malla.positions[index * 3 + 1]}|${malla.positions[index * 3 + 2]}`,
    );
  }
  let fuera = 0;
  for (let index = 0; index < proxy.positions.length / 3; index += 1) {
    const clave = `${proxy.positions[index * 3]}|${proxy.positions[index * 3 + 1]}|${proxy.positions[index * 3 + 2]}`;
    if (!originales.has(clave)) fuera += 1;
  }
  assert.equal(fuera, 0, `${fuera} vértices del proxy no existen en la malla`);

  console.log(
    `proxy: ok (los ${proxy.positions.length / 3} vértices del proxy son vértices de la malla, ninguno ` +
      "inventado: agrupar por representante y no por promedio es lo que impide que el proxy se encoja)",
  );
}

// 4. El informe lo publica siempre, y la auditoría no ve el proxy.
{
  const { stdout } = await execFileAsync(
    process.execPath,
    [resolve(here, "agent3d.mjs"), "--model", MODEL, "--inspect-only", "true"],
    { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 },
  ).catch((error) => ({ stdout: error.stdout }));
  const informe = JSON.parse(stdout);

  assert.ok(informe.renderSource !== undefined, "ausente no es «entera», ausente es «no se sabe»");
  assert.equal(informe.renderSource.type, "full");
  assert.equal(
    informe.renderSource.sourceTriangles,
    informe.triangles,
    "el recuento del origen tiene que cuadrar con el del propio informe, sin el suelo",
  );
  assert.equal(informe.renderSource.renderTriangles, informe.triangles);

  // Y con un presupuesto que sí muerde, el pliego se rasteriza sobre el proxy y
  // **las medidas no se mueven**: mismo recuento, mismo radio, mismas auditorías.
  const conProxy = await execFileAsync(
    process.execPath,
    [
      resolve(here, "agent3d.mjs"),
      "--model",
      MODEL,
      "--out",
      resolve(projectRoot, ".cache/proxy-prueba.png"),
      "--preview-max-triangles",
      "2000",
    ],
    { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 },
  ).catch((error) => ({ stdout: error.stdout }));
  const conProxyInforme = JSON.parse(conProxy.stdout);

  assert.equal(conProxyInforme.renderSource.type, "proxy");
  assert.ok(conProxyInforme.renderSource.renderTriangles < conProxyInforme.renderSource.sourceTriangles);
  assert.equal(conProxyInforme.triangles, informe.triangles, "la auditoría no puede ver el proxy");
  assert.equal(conProxyInforme.vertices, informe.vertices);
  assert.equal(conProxyInforme.boundsRadius, informe.boundsRadius, "el encuadre sale de la malla entera");

  console.log(
    `proxy: ok (el informe publica renderSource también cuando fue la malla entera; con presupuesto de ` +
      `2.000 se rasterizan ${conProxyInforme.renderSource.renderTriangles} de ` +
      `${conProxyInforme.renderSource.sourceTriangles} triángulos y ni el recuento ni el radio se mueven)`,
  );
}

// 5. El número que impide confundirlo con un LOD.
{
  const proxy = buildPreviewProxy(malla, Math.floor(triangulos / 8));
  const silueta = compareSilhouettes(malla, proxy, 128);
  const peor = silueta.views.reduce((maximo, vista) => Math.max(maximo, vista.missingRatio), 0);

  assert.ok(peor > 0, "un proxy que no perdiera nada de silueta no estaría simplificando");

  console.log(
    `proxy: ok (pierde hasta el ${(peor * 100).toFixed(1)} % de la silueta en la peor vista. R12 midió ` +
      "que un LOD entregable se juzga justo por ahí: esto vale para mirar y no para entregar)",
  );
}

console.log(
  `proxy: no ejecutada — el pliego de un paquete de reconstrucción sigue sin existir, así que el ` +
    `presupuesto de ${PREVIEW_MAX_TRIANGLES} solo se aplica a modelos y escenas; y los modos de ` +
    "diagnóstico del §54 —el proxy para el viewport del navegador— son del editor, no de aquí",
);
