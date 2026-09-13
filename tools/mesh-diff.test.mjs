/**
 * Puerta de R5 — comparar dos mallas con números.
 *
 * Lo que el escalón pide es que «una reparación se pueda comparar con la malla
 * cruda», y eso no se demuestra enseñando que el código corre: se demuestra
 * contra **casos cuyo resultado se sabe de antemano**. Aquí los cinco bloques son
 * eso, en el orden en que una afirmación se cae:
 *
 *   1. Una malla contra sí misma cae bajo el suelo de ruido publicado por los dos
 *      lados —no bajo cero, que no es alcanzable— y el suelo **escala con la
 *      escena**. Si esto fallara, todo lo demás mediría ruido.
 *   2. Dos planos paralelos separados `d` dan **exactamente** `d`, y no
 *      aproximadamente: el punto más próximo a un plano desde otro paralelo es la
 *      perpendicular, así que el máximo, la media y el RMS coinciden.
 *   3. **Las dos direcciones no son la misma medida.** Es la afirmación central
 *      del módulo y la que justifica que se publiquen separadas.
 *   4. La desviación de normales sale del ángulo que se puso, no de otro sitio.
 *   5. Determinismo: los mismos números bit a bit, y la semilla decide de verdad.
 */

import assert from "node:assert/strict";

import { DIFF_NOISE_FLOOR, diffMeshes } from "../dist-node/agent3d.mjs";

/** Malla mínima: el resto de campos son los que `auditMesh` necesita. */
function mesh(positions, indices) {
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    boundingRadius: 0,
  };
}

/** Rejilla plana en el plano XZ a la altura `y`, de lado `size` y `n` celdas. */
function plane(y, size = 4, n = 8, tiltDegrees = 0) {
  const positions = [];
  const indices = [];
  const radians = (tiltDegrees * Math.PI) / 180;
  for (let row = 0; row <= n; row += 1) {
    for (let column = 0; column <= n; column += 1) {
      const x = (column / n - 0.5) * size;
      const z = (row / n - 0.5) * size;
      // Giro alrededor de X: la normal se inclina ese mismo ángulo, que es lo que
      // el bloque 4 comprueba.
      positions.push(x, y + z * Math.sin(radians), z * Math.cos(radians));
    }
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const a = row * (n + 1) + column;
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  return mesh(positions, indices);
}

/** Caja cerrada centrada en `center`, de lado `side`. */
function box(center, side) {
  const h = side / 2;
  const [cx, cy, cz] = center;
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz]);
  const faces = [
    [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
    [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
    [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
  ];
  return mesh(corners.flat(), faces.flat());
}

/** Dos mallas en una, sin tocar vértices: para añadir superficie a propósito. */
function merge(a, b) {
  const offset = a.positions.length / 3;
  return mesh(
    [...a.positions, ...b.positions],
    [...a.indices, ...[...b.indices].map((index) => index + offset)],
  );
}

const SAMPLES = 4_000;

// 1. Una malla contra sí misma. El suelo de todo lo demás.
{
  const cubo = box([0, 0, 0], 1);
  const diff = diffMeshes(cubo, cubo, { samples: SAMPLES });

  // **No cero exacto, y no puede serlo**: el punto de muestra se construye con
  // baricéntricas en doble y el árbol busca sobre posiciones en `Float32`.
  // Afirmar cero sería afirmar más de lo que la aritmética sostiene, así que lo
  // que se exige es el suelo publicado.
  for (const [name, direction] of [["a→b", diff.aToB], ["b→a", diff.bToA]]) {
    assert.ok(
      direction.maximum <= diff.noiseFloor,
      `${name}: ${direction.maximum} pasa del suelo de ruido ${diff.noiseFloor}`,
    );
    assert.ok(direction.mean <= diff.noiseFloor);
    assert.ok(direction.rms <= diff.noiseFloor);
    assert.equal(direction.normalDeviationDegrees.maximum, 0, `${name}: la normal sí sale exacta`);
    assert.equal(direction.samples, SAMPLES, `${name}: no se midieron todas las muestras`);
  }
  // Y el suelo escala con la escena, porque el redondeo escala con la coordenada:
  // sobre un cubo mil veces mayor, la misma malla contra sí misma da mil veces
  // más. Sin esto, el suelo sería un número mágico que solo vale para el cubo
  // unidad.
  const grande = diffMeshes(box([0, 0, 0], 1000), box([0, 0, 0], 1000), { samples: 512 });
  assert.ok(
    grande.aToB.maximum <= grande.noiseFloor,
    `sobre lado 1000: ${grande.aToB.maximum} pasa de ${grande.noiseFloor}`,
  );
  assert.ok(grande.aToB.maximum > diff.noiseFloor, "si no creciera, el suelo no sería relativo");
  // Y el delta de topología entero a cero, incluido el volumen.
  for (const [field, value] of Object.entries(diff.topology)) {
    if (field === "watertight") {
      assert.equal(value, null, "watertight no cambió, así que no se publica un cambio");
      continue;
    }
    assert.equal(value, 0, `topology.${field} tenía que ser 0 y es ${value}`);
  }
  assert.equal(diff.measurementClass, "APPROXIMATE");
  assert.equal(diff.reproducibility, "BITWISE_EXACT");

  console.log(
    `diff: ok (una malla contra sí misma da ${diff.aToB.maximum.toExponential(1)} sobre el cubo unidad y ` +
      `${grande.aToB.maximum.toExponential(1)} sobre uno de lado 1000 —el suelo es relativo, ${DIFF_NOISE_FLOOR} ` +
      "de la diagonal—, y el delta de topología entero a cero)",
  );
}

// 2. Dos planos paralelos: el valor se sabe de antemano y tiene que salir exacto.
{
  const d = 0.25;
  const diff = diffMeshes(plane(0), plane(d), { samples: SAMPLES });

  for (const [name, direction] of [["a→b", diff.aToB], ["b→a", diff.bToA]]) {
    // Exacto y no «dentro de una tolerancia»: el punto más próximo a un plano
    // desde otro paralelo es la perpendicular, así que las tres estadísticas
    // valen lo mismo. Una tolerancia aquí escondería un error de proyección.
    assert.ok(
      Math.abs(direction.maximum - d) < 1e-6,
      `${name}: el máximo tenía que ser ${d} y es ${direction.maximum}`,
    );
    assert.ok(Math.abs(direction.mean - d) < 1e-6, `${name}: la media tenía que ser ${d}`);
    assert.ok(Math.abs(direction.rms - d) < 1e-6, `${name}: el RMS tenía que ser ${d}`);
    assert.ok(
      direction.normalDeviationDegrees.maximum < 1e-6,
      `${name}: dos planos paralelos no desvían normales`,
    );
  }
  // Y la diagonal publicada es la de la caja de las dos, no la de una.
  assert.ok(
    Math.abs(diff.boundingBoxDiagonal - Math.hypot(4, d, 4)) < 1e-6,
    `la diagonal tenía que abarcar las dos mallas y es ${diff.boundingBoxDiagonal}`,
  );

  console.log(
    `diff: ok (dos planos a ${d}: máximo, media y RMS coinciden en ${d} por los dos lados, y la ` +
      "diagonal publicada abarca las dos mallas)",
  );
}

// 3. Las dos direcciones no son la misma medida.
//
// Es la afirmación que justifica el módulo entero. B contiene toda la superficie
// de A **más** una caja aparte: cada punto de A sigue teniendo su punto exacto en
// B, así que A → B da cero y diría que son idénticas. La que encuentra lo que
// sobra es B → A.
{
  const a = box([0, 0, 0], 1);
  const b = merge(a, box([3, 0, 0], 0.4));
  const diff = diffMeshes(a, b, { samples: SAMPLES });

  assert.ok(
    diff.aToB.maximum <= diff.noiseFloor,
    `toda la superficie de A está en B, así que A → B tenía que quedarse en el ruido y da ${diff.aToB.maximum}`,
  );
  assert.ok(
    diff.bToA.maximum > 2,
    `B → A tenía que encontrar la caja que sobra y da ${diff.bToA.maximum}`,
  );
  // Y el promedio de las dos no describiría nada: por eso se publican separadas.
  assert.notEqual(diff.aToB.maximum, diff.bToA.maximum);
  // La topología lo confirma por otro camino: B trae los triángulos de más.
  assert.equal(diff.topology.triangles, 12);
  assert.equal(diff.topology.vertices, 8);

  console.log(
    `diff: ok (superficie que sobra: A → B se queda en el ruido y diría que son idénticas; B → A da ` +
      `${diff.bToA.maximum.toFixed(3)}. Las dos direcciones no son la misma medida)`,
  );
}

// 4. La desviación de normales sale del ángulo que se puso.
{
  const tilt = 30;
  const diff = diffMeshes(plane(0), plane(0, 4, 8, tilt), { samples: SAMPLES });

  // Todos los triángulos de cada plano comparten normal, así que el máximo y la
  // media tienen que valer lo mismo y ser el ángulo exacto.
  for (const [name, direction] of [["a→b", diff.aToB], ["b→a", diff.bToA]]) {
    assert.ok(
      Math.abs(direction.normalDeviationDegrees.maximum - tilt) < 1e-4,
      `${name}: la desviación tenía que ser ${tilt}° y es ${direction.normalDeviationDegrees.maximum}`,
    );
    assert.ok(Math.abs(direction.normalDeviationDegrees.mean - tilt) < 1e-4, `${name}: la media`);
  }

  // Y el bobinado no cuenta como desviación: una cara con los índices al revés
  // tiene la normal opuesta y sigue siendo la misma superficie. Eso lo juzga
  // `MALLA_INVERTIDA`, que es quien sabe de bobinados.
  const derecho = plane(0);
  const revés = mesh(
    [...derecho.positions],
    [...derecho.indices].reduce((out, _, index, all) => {
      if (index % 3 === 0) out.push(all[index], all[index + 2], all[index + 1]);
      return out;
    }, []),
  );
  const invertido = diffMeshes(derecho, revés, { samples: SAMPLES });
  assert.ok(
    invertido.aToB.normalDeviationDegrees.maximum < 1e-6,
    `el bobinado invertido no es desviación de forma y da ${invertido.aToB.normalDeviationDegrees.maximum}`,
  );

  console.log(
    `diff: ok (un plano girado ${tilt}° da ${tilt}° de desviación exactos, y el bobinado invertido da 0: ` +
      "es la misma superficie, y el bobinado lo juzga otro aviso)",
  );
}

// 5. Determinismo, y que la semilla decida de verdad.
{
  const a = box([0, 0, 0], 1);
  const b = box([0, 0.05, 0], 1.1);

  const uno = diffMeshes(a, b, { samples: SAMPLES, seed: 7 });
  const dos = diffMeshes(a, b, { samples: SAMPLES, seed: 7 });
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos ejecuciones iguales dan documentos distintos");

  const otra = diffMeshes(a, b, { samples: SAMPLES, seed: 8 });
  // Sin esto, una función que devolviera constantes también pasaría el caso de
  // arriba: el determinismo solo significa algo si la semilla mueve el número.
  assert.notEqual(otra.aToB.mean, uno.aToB.mean, "la semilla no está decidiendo nada");
  assert.equal(otra.seed, 8, "la semilla se publica, no se supone");

  // Y las dos direcciones no muestrean lo mismo: con la misma semilla las dos
  // nubes caerían en los mismos parámetros y se mediría dos veces lo mismo.
  assert.notEqual(uno.aToB.mean, uno.bToA.mean);

  console.log(
    `diff: ok (mismo documento byte a byte con la misma semilla; con otra, la media pasa de ` +
      `${uno.aToB.mean.toFixed(6)} a ${otra.aToB.mean.toFixed(6)})`,
  );
}

console.log(
  "diff: no ejecutada — comparar contra un presupuesto es R9 y necesita la escala (D9); aquí las " +
    "distancias salen en unidades del paquete con la diagonal al lado. Y el diff sobre un paquete real " +
    "espera a que exista una reparación que comparar, que es R10",
);
