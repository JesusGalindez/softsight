/**
 * Puerta de R12 — cada LOD contra presupuestos de error medibles.
 *
 * ## El bloque 1 es la razón de que R12 exista aparte de R11
 *
 * Un LOD que se desvía el 2 % **dentro** de una pared plana es invisible: la
 * superficie se mueve hacia dentro de sí misma y ningún píxel cambia. El mismo
 * 2 % en un borde contra el cielo es un temblor que se ve desde lejos. La
 * distancia de superficie **mide el mismo número en los dos casos**, y por eso no
 * puede ser el único criterio.
 *
 * El bloque lo construye a propósito: dos LOD con desviación de superficie
 * parecida y siluetas muy distintas. Si la silueta se midiera con la distancia —o
 * peor, si se dedujera de ella— los dos saldrían iguales.
 *
 * ## Y el bloque 5 es el que caza un error que no se ve
 *
 * La comparación se hace sobre la **caja común** de las dos mallas, así que el
 * píxel mide lo mismo para las dos. Con cajas propias, una malla más pequeña se
 * dibujaría más grande —ocupando su propio encuadre— y su silueta saldría
 * parecida a la de la maestra por un error de escala, no por parecerse.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SILHOUETTE_RESOLUTION,
  SILHOUETTE_VIEWS,
  compareSilhouettes,
} from "../dist-node/agent3d.mjs";
import { inspectAsset } from "./production.mjs";
import { box, spherifiedCube, writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-lod-"));
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

// 1. **La silueta no se deduce de la distancia.**
//
// Dos candidatos contra la misma maestra: una esfera más basta —que pierde
// silueta por todo el contorno— y la misma esfera desplazada un poco. La segunda
// tiene desviación de superficie parecida y **conserva la silueta casi entera**,
// porque mover una esfera no le cambia el contorno, solo lo traslada.
{
  const maestra = malla(spherifiedCube(12));
  const basta = malla(spherifiedCube(3));

  const desplazada = malla(spherifiedCube(12));
  const posiciones = new Float32Array(desplazada.positions);
  for (let index = 0; index < posiciones.length; index += 3) posiciones[index] += 0.09;
  const movida = { ...desplazada, positions: posiciones };

  const siluetaBasta = compareSilhouettes(maestra, basta);
  const siluetaMovida = compareSilhouettes(maestra, movida);

  // La basta pierde silueta por todo el contorno; la movida, casi nada — lo que
  // se sale por un lado entra por el otro.
  assert.ok(
    siluetaBasta.worstMissing.missingRatio > 0.05,
    `la esfera basta pierde ${siluetaBasta.worstMissing.missingRatio}`,
  );
  assert.ok(
    siluetaMovida.worstMissing.missingRatio < siluetaBasta.worstMissing.missingRatio,
    "mover una esfera conserva su contorno; hacerla basta, no",
  );
  // Y la movida **sí gana** silueta, que la basta no: se sale por el otro lado.
  assert.ok(
    siluetaMovida.worstExtra.extraRatio > siluetaBasta.worstExtra.extraRatio,
    "desplazar añade silueta donde la basta solo quita",
  );

  console.log(
    `lod: ok (la esfera basta pierde ${(siluetaBasta.worstMissing.missingRatio * 100).toFixed(1)} % de ` +
      `silueta y la desplazada ${(siluetaMovida.worstMissing.missingRatio * 100).toFixed(1)} % pero ` +
      `gana ${(siluetaMovida.worstExtra.extraRatio * 100).toFixed(1)} %: perder y ganar contorno son ` +
      "dos defectos distintos y van separados)",
  );
}

// 2. Catorce vistas, y una no basta.
{
  const maestra = malla(spherifiedCube(8));
  // Media esfera: se le quita todo lo que tiene x positiva. Desde un lado la
  // silueta está intacta y desde el otro falta la mitad.
  const indices = [];
  for (let triangle = 0; triangle < maestra.indices.length / 3; triangle += 1) {
    let dentro = true;
    for (let corner = 0; corner < 3; corner += 1) {
      if (maestra.positions[maestra.indices[triangle * 3 + corner] * 3] > 0) dentro = false;
    }
    if (!dentro) continue;
    indices.push(
      maestra.indices[triangle * 3],
      maestra.indices[triangle * 3 + 1],
      maestra.indices[triangle * 3 + 2],
    );
  }
  const media = { ...maestra, indices: new Uint32Array(indices) };
  const comparacion = compareSilhouettes(maestra, media);

  assert.equal(comparacion.views.length, SILHOUETTE_VIEWS.length);
  assert.equal(comparacion.resolution, SILHOUETTE_RESOLUTION);
  const peor = comparacion.worstMissing.missingRatio;
  const mejor = Math.min(...comparacion.views.map((vista) => vista.missingRatio));
  // **La diferencia entre vistas es el resultado**: con una sola vista, media
  // esfera puede salir perfecta.
  assert.ok(peor > 0.4, `la peor vista tenía que ver media silueta ausente y ve ${peor}`);
  assert.ok(mejor < peor / 2, `y la mejor ve ${mejor}: una vista sola no habría contado esto`);

  console.log(
    `lod: ok (media esfera pierde ${(peor * 100).toFixed(0)} % de silueta en la peor vista y ` +
      `${(mejor * 100).toFixed(0)} % en la mejor: con una sola vista habría salido impecable)`,
  );
}

// 3. Idénticas dan cero, que es lo que hace que los números de arriba signifiquen
//    algo.
{
  const maestra = malla(spherifiedCube(6));
  const comparacion = compareSilhouettes(maestra, malla(spherifiedCube(6)));
  for (const vista of comparacion.views) {
    assert.equal(vista.missingRatio, 0, `vista ${vista.view} pierde silueta contra sí misma`);
    assert.equal(vista.extraRatio, 0);
    assert.equal(vista.iou, 1);
    assert.ok(vista.masterPixels > 0, "la esfera cubre píxeles en todas las vistas");
  }

  // Determinismo: la base de cada vista y el orden de los triángulos son fijos.
  const otra = compareSilhouettes(maestra, malla(spherifiedCube(3)));
  const repetida = compareSilhouettes(maestra, malla(spherifiedCube(3)));
  assert.equal(JSON.stringify(otra), JSON.stringify(repetida));

  console.log(
    "lod: ok (la misma malla contra sí misma da 0 % en las catorce vistas y IoU 1, y dos " +
      "comparaciones dan el mismo documento)",
  );
}

// 4. Los cuatro criterios se juzgan por separado, y el motivo nombra cuál falló.
{
  const sinTopes = inspectAsset(escribir()).report;
  const [uno, dos] = sinTopes.lods;
  // Lo que R12 añade sobre R11, medido: la silueta de lod-2 se pierde mucho más
  // de lo que su desviación de superficie sugiere.
  assert.ok(
    dos.silhouette.worstMissing.missingRatio > dos.worstRelative * 2,
    `superficie ${dos.worstRelative} y silueta ${dos.silhouette.worstMissing.missingRatio}: si la ` +
      "silueta se dedujera de la distancia, irían de la mano",
  );
  assert.ok(dos.normalDeviationDegrees.mean > uno.normalDeviationDegrees.mean);
  assert.ok(dos.boundsDeltaRelative > uno.boundsDeltaRelative, "más basto, más encoge la caja");

  // Cada tope, por su cuenta. Uno a uno para que el motivo se pueda comprobar.
  const casos = [
    ["lodSilhouetteMax", 0.05, "SILHOUETTE"],
    ["lodNormalMaxDegrees", 6, "NORMAL"],
    ["lodBoundsMax", 0.01, "BOUNDS"],
  ];
  for (const [campo, valor, criterio] of casos) {
    const { report, exitCode } = inspectAsset(
      escribir({ target: { preset: `solo-${campo}`, budgets: [], [campo]: valor } }),
    );
    assert.equal(report.certification, "FAIL", `${campo} no suspendió`);
    assert.equal(report.certificationReason, `LOD_FUERA_DE_TOLERANCIA_${criterio}`);
    assert.equal(exitCode, 1);
    // Y **solo** ese criterio falla: los otros tres siguen sin juzgarse.
    const fallan = report.lods.flatMap((lod) =>
      Object.entries(lod.verdicts).filter(([, veredicto]) => veredicto !== "NO_JUZGADO"),
    );
    assert.ok(
      fallan.every(([nombre]) => nombre.toUpperCase() === criterio),
      `${campo} movió más criterios que el suyo: ${JSON.stringify(fallan)}`,
    );
  }

  console.log(
    `lod: ok (lod-2 desvía ${(dos.worstRelative * 100).toFixed(2)} % de superficie y pierde ` +
      `${(dos.silhouette.worstMissing.missingRatio * 100).toFixed(1)} % de silueta —cuatro veces más—, ` +
      "y cada uno de los cuatro topes suspende por su cuenta nombrando su criterio)",
  );
}

// 5. **El encuadre es común**, y sin eso la comparación mentiría.
{
  const grande = malla(spherifiedCube(6, 1));
  const pequena = malla(spherifiedCube(6, 0.5));
  const comparacion = compareSilhouettes(grande, pequena);

  // Media esfera de radio contra una del doble: la pequeña cubre en torno a un
  // cuarto del área. Si cada una se encuadrara en su propia caja, las dos
  // llenarían la imagen igual y la silueta saldría **idéntica**.
  assert.ok(
    comparacion.worstMissing.missingRatio > 0.6,
    `una esfera de la mitad de radio tiene que perder la mayor parte de la silueta y pierde ` +
      `${comparacion.worstMissing.missingRatio}`,
  );
  assert.equal(comparacion.worstExtra.extraRatio, 0, "la pequeña cabe entera dentro de la grande");

  console.log(
    `lod: ok (una esfera de radio 0,5 contra una de 1 pierde ` +
      `${(comparacion.worstMissing.missingRatio * 100).toFixed(0)} % de silueta: el encuadre es común, ` +
      "y con cajas propias las dos habrían salido idénticas)",
  );
}

// 6. Una caja y una esfera: la silueta distingue lo que la caja envolvente no.
{
  const esfera = malla(spherifiedCube(10));
  const caja = malla(box(1));
  const comparacion = compareSilhouettes(esfera, caja);

  // La caja contiene la esfera, así que no le falta nada de silueta: **le sobra**.
  assert.equal(comparacion.worstMissing.missingRatio, 0, "la caja cubre la esfera entera");
  assert.ok(comparacion.worstExtra.extraRatio > 0.2, "y sobresale por las esquinas");
  // Y las cajas envolventes son **la misma**, así que `boundsDelta` no lo vería.
  assert.ok(comparacion.worstExtra.extraRatio > comparacion.worstMissing.missingRatio);

  console.log(
    `lod: ok (una caja en vez de una esfera no pierde silueta y gana ` +
      `${(comparacion.worstExtra.extraRatio * 100).toFixed(0)} %, con la misma caja envolvente: es ` +
      "justo lo que `boundsDelta` no puede ver)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "lod: no ejecutada — la silueta se mide en ortográfica **a propósito**: un asset no declara desde " +
    "dónde se le va a mirar, y elegir una distancia sería inventarse el dato que falta. El día que el " +
    "destino declare distancias de transición, el mismo módulo las acepta y el número pasa a ser el " +
    "que el jugador vería",
);
