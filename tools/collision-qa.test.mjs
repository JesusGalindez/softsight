/**
 * Puerta de R14 — el proxy de colisión, certificable.
 *
 * ## El bloque 1 es la razón de que R14 exista aparte de R11
 *
 * R11 contestaba **una** pregunta: ¿asoma la maestra del proxy? Medida sola,
 * premia al proxy más grande posible — una caja enorme contiene perfectamente,
 * saca cero por ciento asomado y un veredicto impecable, y el jugador choca con
 * el aire a medio metro del objeto.
 *
 * El bloque lo mide sobre el fixture: la caja de semilado 1,02 alrededor de la
 * esfera de radio 1 **contiene al cien por cien y tiene el 92 % del proxy lejos
 * de la maestra**. Las dos direcciones no se promedian y ni siquiera se parecen:
 * una dice «lo atraviesan» y la otra «choca con nada».
 *
 * ## Y el bloque 2 mide lo que el recuento de triángulos no puede
 *
 * Una caja con una esquina hundida sigue teniendo **doce triángulos** y sigue
 * cerrada. Lo único que cambia es que deja de ser convexa, y eso un motor de
 * física lo paga en cada fotograma con otro algoritmo. El recuento no lo ve.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONVEX_TOLERANCE, checkConvexity } from "../dist-node/agent3d.mjs";
import { inspectAsset } from "./production.mjs";
import { box, dentedBox, spherifiedCube, writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-colision-"));
let contador = 0;
const escribir = (cambios = {}) => {
  const destino = join(sandbox, `asset-${(contador += 1)}`);
  writeProductionAsset(destino, cambios);
  return join(destino, "manifest.json");
};
const malla = (mesh) => ({
  ...mesh,
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  boundingRadius: 0,
});

// 1. **Contener no basta**, y medir solo eso premia al peor proxy.
{
  const caja = inspectAsset(escribir()).report.collision;
  assert.equal(caja.ran, true);
  assert.equal(caja.protrudingRatio, 0, "la caja contiene la esfera entera");
  assert.equal(caja.verdict, "PASS", "y con solo esa medida, impecable");
  // Y sin embargo: casi todo el proxy está lejos de la pieza.
  assert.ok(
    caja.quality.slackRatio > 0.8,
    `una caja alrededor de una esfera tiene que ser casi toda holgura y da ${caja.quality.slackRatio}`,
  );
  assert.ok(caja.quality.volumeRatio > 1.9, "y el doble de volumen");

  console.log(
    `colisión: ok (la caja contiene el 100 % de la esfera y tiene el ` +
      `${(caja.quality.slackRatio * 100).toFixed(0)} % del proxy lejos de ella, con el ` +
      `${(caja.quality.volumeRatio * 100).toFixed(0)} % del volumen: medir solo la contención premia ` +
      "al proxy más grande posible)",
  );
}

// 2. **La convexidad, que el recuento de triángulos no puede ver.**
{
  const diagonal = Math.sqrt(3) * 2;
  const recta = checkConvexity(malla(box(1)), diagonal);
  assert.equal(recta.convex, true, "una caja es convexa");
  assert.ok(recta.worstExcursion <= CONVEX_TOLERANCE);

  const hundida = checkConvexity(malla(dentedBox(1, 0.8)), diagonal);
  assert.equal(hundida.convex, false);
  assert.ok(
    hundida.worstExcursion > 0.1,
    `la esquina hundida se sale ${hundida.worstExcursion} y tiene que notarse`,
  );
  // **Los mismos doce triángulos.** El coste no está en el recuento.
  assert.equal(box(1).indices.length, dentedBox(1, 0.8).indices.length);

  // **Y una que sorprende, y la medida la dice en vez de esconderla.** Una esfera
  // teselada es convexa como conjunto de puntos y **no** como malla: los cuatro
  // vértices de un quad proyectados sobre la esfera no son coplanarios, así que
  // al partirlo en dos triángulos una diagonal queda de valle.
  const esfera = checkConvexity(malla(spherifiedCube(8)), 2);
  assert.equal(esfera.convex, false, "una esfera teselada no es convexa como malla");
  assert.ok(
    esfera.worstExcursion > CONVEX_TOLERANCE * 10 && esfera.worstExcursion < 0.01,
    `la excursión es ${esfera.worstExcursion}: mil veces el redondeo y muy por debajo de una concavidad`,
  );
  // Con la tolerancia que su dueño sabe que necesita, pasa. El defecto no la
  // supone: suponerla habría dado por convexa una herradura poco profunda.
  assert.equal(checkConvexity(malla(spherifiedCube(8)), 2, 0.01).convex, true);
  assert.equal(checkConvexity(malla(dentedBox(1, 0.8)), diagonal, 0.01).convex, false);

  console.log(
    `colisión: ok (una caja con una esquina hundida tiene los mismos 12 triángulos y se sale un ` +
      `${(hundida.worstExcursion * 100).toFixed(0)} %; y una esfera teselada se sale un ` +
      `${(esfera.worstExcursion * 100).toFixed(2)} % —los quads no son coplanarios—, que con la ` +
      "tolerancia declarada pasa y con la de por defecto no)",
  );
}

// 3. Cada criterio suspende con su nombre, y en orden de daño.
{
  // Atravesar la pieza es lo peor y gana a todo lo demás.
  const asomando = inspectAsset(
    escribir({
      collisionHalf: 0.8,
      target: { preset: "todo", budgets: [], collisionRequireConvex: true, collisionSlackMax: 0.01 },
    }),
  );
  assert.equal(asomando.report.certificationReason, "LA_MAESTRA_ASOMA_DE_LA_COLISION");

  // Con la contención tolerada, sale el siguiente: la convexidad.
  const concava = inspectAsset(
    escribir({
      collisionDent: 0.8,
      target: { preset: "convexo", budgets: [], collisionTolerance: 1, collisionRequireConvex: true },
    }),
  );
  assert.equal(concava.report.certificationReason, "PROXY_NO_CONVEXO");
  assert.equal(concava.exitCode, 1);

  // Y la holgura, sobre un proxy que contiene y es convexo.
  const holgada = inspectAsset(
    escribir({ target: { preset: "cenido", budgets: [], collisionSlackMax: 0.1 } }),
  );
  assert.equal(holgada.report.certificationReason, "PROXY_DEMASIADO_HOLGADO");

  // Y el volumen, que dice lo mismo por otro camino.
  const gorda = inspectAsset(
    escribir({ target: { preset: "fino", budgets: [], collisionVolumeRatioMax: 1.5 } }),
  );
  assert.equal(gorda.report.certificationReason, "PROXY_DEMASIADO_VOLUMINOSO");

  console.log(
    "colisión: ok (los cuatro criterios suspenden con su nombre y en orden de daño: atravesar la " +
      "pieza gana a ser cóncavo, y ser cóncavo a chocar con el aire)",
  );
}

// 4. Sin tope declarado, se mide y no se decide.
{
  const suelto = inspectAsset(escribir()).report;
  assert.equal(suelto.certification, "PASS");
  // La holgura del 92 % **se publica igual**: no juzgar no es no medir.
  assert.ok(suelto.collision.quality.slackRatio > 0.8);
  assert.equal(suelto.collision.quality.convexity.convex, true);
  // Y la tolerancia con la que se decidió, al lado del número que decide.
  assert.equal(suelto.collision.quality.slackTolerance, 0.02);

  console.log(
    "colisión: ok (sin `collisionSlackMax` ni `collisionRequireConvex` el asset pasa y los números " +
      "salen igual, con la tolerancia publicada al lado)",
  );
}

// 5. La topología del proxy, que es lo que hace que «dentro» signifique algo.
{
  const sano = inspectAsset(escribir()).report.collision;
  assert.deepEqual(sano.quality.topology, {
    watertight: true,
    nonManifoldEdges: 0,
    inverted: false,
    degenerateTriangles: 0,
  });
  // La caja envolvente del proxy sobresale un poco de la de la maestra: 1,02
  // contra 1, sobre una diagonal de 2·√3.
  assert.ok(sano.quality.boundsExcess > 0 && sano.quality.boundsExcess < 0.02);

  console.log(
    `colisión: ok (el proxy sale cerrado, manifold y del derecho, y su caja sobresale un ` +
      `${(sano.quality.boundsExcess * 100).toFixed(2)} % de la diagonal: 1,02 contra 1)`,
  );
}

// 6. Determinismo.
{
  const ruta = escribir();
  const uno = inspectAsset(ruta).report.collision;
  const dos = inspectAsset(ruta).report.collision;
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos evaluaciones dan documentos distintos");

  console.log("colisión: ok (dos evaluaciones del mismo proxy dan el mismo documento)");
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "colisión: no ejecutada — **no propone un proxy**. Calcular un casco convexo o descomponer una " +
    "pieza en partes convexas es modelar, y en cuanto esto decidiera dónde va un vértice dejaría de " +
    "poder afirmar que sus números son exactos. Dice qué tiene el proxy que hay, no cuál debería ser",
);
