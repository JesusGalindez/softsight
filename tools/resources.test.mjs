/**
 * Puerta de recursos de `auditMesh` — D25 del contrato con VideoMesh.
 *
 * «Terminó» no es una medida: lo que se comprueba aquí es tiempo de CPU, RSS
 * máximo, heap, buffers externos y el peso de las dos estructuras calientes, con
 * el entorno declarado al lado. Sin eso, la medida de después de reescribir
 * `weldPositions` no se puede comparar con la de antes.
 *
 * Dos escalones y dos regímenes:
 *
 *   - **100k triángulos** en cada ejecución. Barato (unos segundos) y suficiente
 *     para que un cambio que multiplique el consumo salte en el acto.
 *   - **5M triángulos**, que es el escalón que el gate de producción tiene que
 *     atravesar, solo con `SOFTSIGHT_HEAVY=1`: un minuto y casi 1 GiB de RSS no
 *     caben en una suite que corre en cada cambio. Cuando falta, la puerta se
 *     declara **no ejecutada con su motivo**, nunca verde — D22.
 *
 * Los techos son generosos a propósito. No son un objetivo de rendimiento: son
 * una alarma contra una regresión de orden de magnitud. El objetivo lo fija S2/S3
 * con el número de esta línea base delante.
 */

import assert from "node:assert/strict";

import { auditMesh } from "../dist-node/agent3d.mjs";
import { divisionsFor, expectedDuplicates, torusMesh } from "./scaleMesh.mjs";
import { environment, measureStep } from "./auditBaseline.mjs";

const MEGA = 1024 * 1024;

/**
 * Techos por escalón, sobre lo medido el 2026-08-12 en un i5-5350U **ya sin los
 * dos `Map`**: 100k a 0,16 s de CPU y 67 MiB de RSS, 5M a 0,93 s y 315 MiB. Con
 * margen ×3 en tiempo —esta máquina tiene dos núcleos y la suite compite consigo
 * misma— y ×2 en memoria, que es mucho más estable.
 *
 * Los techos de la versión con `Map` eran 1,5 s / 200 MiB y 40 s / 1800 MiB. Se
 * aprietan aquí a propósito: un techo heredado dejaría volver a la estructura
 * vieja sin que ninguna puerta se pusiera roja.
 */
const BUDGET = {
  "100k": { cpuSeconds: 0.5, peakRssMiB: 140 },
  "5M": { cpuSeconds: 3, peakRssMiB: 640 },
};

/** 1. El generador es determinista: dos llamadas, los mismos bytes. */
{
  const first = torusMesh(100000);
  const second = torusMesh(100000);
  assert.deepEqual(Buffer.from(first.positions.buffer), Buffer.from(second.positions.buffer));
  assert.deepEqual(Buffer.from(first.indices.buffer), Buffer.from(second.indices.buffer));
  const { u, v, triangles } = divisionsFor(100000);
  assert.equal(first.indices.length / 3, triangles);
  console.log(
    `recursos: ok (generador determinista: toro ${u}×${v}, ${triangles} triángulos, mismos bytes en dos llamadas)`,
  );
}

/**
 * 2. Los tres casos de topología que un toro **no** puede probar: el toro es
 * cerrado y manifold, así que un recuento de aristas que no contara nada le daría
 * los mismos ceros. Estos valores son los que daba la versión con `Map`, medidos
 * antes de quitarlo.
 */
{
  const mesh = (positions, indices) => ({
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array(0),
    indices: new Uint32Array(indices),
    boundingRadius: 2,
  });
  // Un cuadrado de dos triángulos: cuatro bordes, y la diagonal compartida no es
  // borde. Tres triángulos sobre la misma arista: no manifold. Y el cuadrado con
  // la diagonal partida en dos vértices por posición: la soldadura lo cierra igual.
  const quad = auditMesh(mesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]));
  const fan = auditMesh(
    mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1], [0, 1, 2, 0, 1, 3, 0, 1, 4]),
  );
  const split = auditMesh(
    mesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 3, 4, 5]),
  );
  assert.deepEqual(
    [quad.boundaryEdges, quad.nonManifoldEdges, quad.duplicatePositions],
    [4, 0, 0],
  );
  assert.deepEqual([fan.boundaryEdges, fan.nonManifoldEdges], [6, 1]);
  assert.deepEqual(
    [split.boundaryEdges, split.nonManifoldEdges, split.duplicatePositions],
    [4, 0, 2],
  );
  console.log(
    "recursos: ok (topología sin Map: cuadrado 4 bordes, abanico de 3 caras 1 arista no manifold, diagonal partida soldada)",
  );
}

/**
 * 3. La malla de prueba es la que dice ser. Si el generador dejara agujeros o
 * degenerados, `auditMesh` recorrería otro camino y la medida no sería la del
 * caso que importa.
 */
async function measure(step, triangles) {
  const results = await measureStep({ triangles });
  for (const [measure, result] of Object.entries(results)) {
    assert.ok(result.ok, `la medida "${measure}" de ${step} reventó: ${result.reason}`);
  }
  return results;
}

const environmentLine = (() => {
  const env = environment();
  return `${env.platform}/${env.arch} node ${env.node} ${env.cpu} ${env.cpuLogical} lógicos, RAM ${(env.ramBytes / MEGA).toFixed(0)} MiB, heap ${(env.heapLimitBytes / MEGA).toFixed(0)} MiB, workers ${env.workers}`;
})();

async function gate(step, triangles) {
  const results = await measure(step, triangles);
  const { audit, weld, edge } = results;
  const budget = BUDGET[step];

  assert.equal(audit.audit.triangles, divisionsFor(triangles).triangles);
  assert.equal(audit.audit.degenerateTriangles, 0, "el toro no tiene triángulos de área nula");
  assert.equal(audit.audit.boundaryEdges, 0, "cerrado: sin bordes");
  assert.equal(audit.audit.nonManifoldEdges, 0, "manifold");
  assert.ok(audit.audit.signedVolume > 0, "bobinado hacia fuera");
  assert.equal(
    audit.audit.duplicatePositions,
    expectedDuplicates(triangles),
    "la costura es lo que weldPositions tiene que soldar",
  );
  console.log(
    `recursos: ok (${step}: cerrada, sin degenerados, ${audit.audit.duplicatePositions} duplicados de costura, volumen ${audit.audit.signedVolume})`,
  );

  const cpuSeconds = audit.cpuMs / 1000;
  const peakRssMiB = audit.peakRss / MEGA;
  assert.ok(cpuSeconds < budget.cpuSeconds, `${step}: ${cpuSeconds.toFixed(2)} s de CPU pasa del techo ${budget.cpuSeconds}`);
  assert.ok(peakRssMiB < budget.peakRssMiB, `${step}: ${peakRssMiB.toFixed(0)} MiB de RSS pasa del techo ${budget.peakRssMiB}`);
  console.log(
    `recursos: ok (${step}: ${cpuSeconds.toFixed(2)} s CPU, RSS máx ${peakRssMiB.toFixed(0)} MiB, ` +
      `heap ${(audit.heapUsed / MEGA).toFixed(0)} MiB, externos ${(audit.external / MEGA).toFixed(0)} MiB, ` +
      `buffers ${(audit.arrayBuffers / MEGA).toFixed(0)} MiB — ${environmentLine})`,
  );
  // Las dos réplicas ya no están dentro de `auditMesh`: son la estructura que se
  // quitó, medida al lado para que la línea impresa siga diciendo de dónde se
  // viene. Si vuelven al código, este número es contra el que compararlo.
  console.log(
    `recursos: ok (${step}: los Map retirados pesaban — soldadura ${weld.entries} entradas y ${(weld.heapDelta / MEGA).toFixed(0)} MiB de heap; ` +
      `aristas ${edge.entries} entradas y ${(edge.heapDelta / MEGA).toFixed(0)} MiB)`,
  );
}

await gate("100k", 100000);

if (process.env.SOFTSIGHT_HEAVY === "1") {
  await gate("5M", 5000000);
} else {
  // Un cero silencioso sería peor que el rojo: la línea impresa deja el hueco a
  // la vista en el registro de la ejecución, como hace `requireFixtures`.
  console.log(
    "recursos: no ejecutada — el escalón de 5M pide SOFTSIGHT_HEAVY=1 (≈2 s de CPU y ≈315 MiB de RSS)",
  );
}
