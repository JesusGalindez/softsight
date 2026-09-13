/**
 * Puerta de la autointersección — la mitad de R4 que no puede ser exacta.
 *
 * Lo que se comprueba aquí no es solo que encuentre cruces: es que **calle donde
 * debe**. Un detector de autointersecciones que grita con cualquier malla es
 * peor que no tenerlo, porque nadie lo mira — y ése es literalmente el error que
 * ya se cometió una vez en este repositorio con `segmentsCross` y el caso
 * colineal.
 *
 * Los dos casos que deciden si sirve son el tercero y el cuarto: un cubo cerrado
 * no puede salir autointersecado, y un cubo con los vértices partidos por cara
 * —como viene cualquier malla con UVs— tampoco. Si los vecinos se excluyeran por
 * índice en vez de por posición soldada, el cuarto saldría lleno de cruces.
 */

import assert from "node:assert/strict";

import { SELF_INTERSECTION_EPSILON, findSelfIntersections } from "../dist-node/agent3d.mjs";

function mesh(positions, indices) {
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    boundingRadius: 0,
  };
}

const CUBE_FACES = [
  [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
  [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
  [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
];

function cube(side = 1) {
  const h = side / 2;
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  return mesh(corners.flat(), CUBE_FACES.flat());
}

function splitCube(side = 1) {
  const closed = cube(side);
  const positions = [];
  const indices = [];
  for (let index = 0; index < closed.indices.length; index += 1) {
    const source = closed.indices[index] * 3;
    positions.push(closed.positions[source], closed.positions[source + 1], closed.positions[source + 2]);
    indices.push(index);
  }
  return mesh(positions, indices);
}

// 1. Una cruz: dos triángulos que se atraviesan de verdad.
{
  // Uno tumbado en z=0 y otro de pie en x=0, **sin compartir ningún vértice**:
  // con un vértice común la exclusión de vecinos se lo comería, que es
  // precisamente lo que hace el tercer bloque.
  const cruz = mesh(
    [-1, 0, 0, 1, 0, 0, 0, 1, 0, 0, -0.5, -1, 0, -0.5, 1, 0, 1.5, 0],
    [0, 1, 2, 3, 4, 5],
  );
  const report = findSelfIntersections(cruz);

  assert.equal(report.candidates.length, 1, "dos triángulos en cruz se atraviesan");
  assert.deepEqual(report.candidates[0].triangles, [0, 1], "el par sale con el menor primero");
  assert.equal(report.measurementClass, "APPROXIMATE", "no es una certeza y no se declara como tal");
  assert.equal(report.reproducibility, "BITWISE_EXACT");
  // La coordenada mayor de este fixture es 1,5, así que el epsilon publicado es
  // el relativo por ella: va en unidades de la malla, no en abstracto.
  assert.equal(report.epsilon, SELF_INTERSECTION_EPSILON * 1.5, "el epsilon escala con la coordenada");

  console.log("autointersección: ok (una cruz de dos triángulos da un candidato, y es APPROXIMATE)");
}

// 2. Separados: ni siquiera llegan a la fase estrecha.
{
  const lejos = mesh(
    [-1, 0, 0, 1, 0, 0, 0, 1, 0, -1, 5, 0, 1, 5, 0, 0, 6, 0],
    [0, 1, 2, 3, 4, 5],
  );
  const report = findSelfIntersections(lejos);

  assert.equal(report.candidates.length, 0);
  // Cero pares probados: las cajas del árbol los descartaron. Si esto subiera, la
  // fase amplia habría dejado de podar y el coste se dispararía sin avisar.
  assert.equal(report.testedPairs, 0, "la fase amplia tenía que descartarlos sin mirarlos");

  console.log("autointersección: ok (dos triángulos separados no llegan a la fase estrecha: 0 pares probados)");
}

// 3. Un cubo cerrado. El caso que decide si el aviso es mirable.
{
  const report = findSelfIntersections(cube(2));
  assert.equal(
    report.candidates.length,
    0,
    `un cubo cerrado no se autointerseca, y da ${JSON.stringify(report.candidates)}`,
  );
  assert.equal(report.coplanarPairs, 0, "sus caras no son coplanares dos a dos");

  console.log(
    `autointersección: ok (un cubo cerrado da cero candidatos tras probar ${report.testedPairs} pares: ` +
      "los vecinos se excluyen, que es lo que hace que el aviso se pueda mirar)",
  );
}

// 4. El mismo cubo con los vértices partidos.
//
// Si los vecinos se excluyeran por índice, aquí no habría ninguno que excluir
// —los 36 vértices son distintos— y saldría lleno de cruces.
{
  const partido = splitCube(2);
  assert.equal(partido.positions.length / 3, 36, "el fixture tiene que venir partido de verdad");

  const report = findSelfIntersections(partido);
  assert.equal(
    report.candidates.length,
    0,
    `partido sigue siendo un cubo cerrado, y da ${report.candidates.length} candidatos`,
  );

  console.log(
    "autointersección: ok (el mismo cubo con los 36 vértices partidos sigue dando cero: los vecinos se " +
      "excluyen por posición soldada y no por índice)",
  );
}

// 5. Lo coplanar se cuenta y no se afirma.
{
  const coplanares = mesh(
    [0, 0, 0, 2, 0, 0, 0, 2, 0, 0.5, 0.5, 0, 2.5, 0.5, 0, 0.5, 2.5, 0],
    [0, 1, 2, 3, 4, 5],
  );
  const report = findSelfIntersections(coplanares);

  // Se solapan de verdad, y aun así no se afirma: ahí el signo vale cero y quien
  // decide es el redondeo. Decirlo como candidato sería afirmar más de lo que la
  // aritmética sostiene.
  assert.equal(report.candidates.length, 0, "un solape coplanar no se afirma");
  assert.equal(report.coplanarPairs, 1, "pero se cuenta, en vez de desaparecer");

  console.log(
    "autointersección: ok (dos triángulos coplanares que se solapan salen como 1 par coplanar y 0 " +
      "candidatos: se cuenta lo que no se puede afirmar)",
  );
}

// 6. El epsilon decide, y escala con la escena.
{
  // Dos triángulos paralelos separados por menos del epsilon: por debajo de ahí
  // la posición no existe en `Float32`, así que se leen como coplanares.
  const separación = SELF_INTERSECTION_EPSILON / 10;
  const pegados = mesh(
    [0, 0, 0, 2, 0, 0, 0, 2, 0, 0.5, 0.5, separación, 2.5, 0.5, separación, 0.5, 2.5, separación],
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(findSelfIntersections(pegados).candidates.length, 0, "por debajo del epsilon no se afirma");

  // Y el epsilon crece con la malla: sobre un cubo de lado 2000 vale mil veces
  // más que sobre uno de lado 2. Un número absoluto valdría para el cubo unidad y
  // no para una reconstrucción en milímetros.
  const pequeño = findSelfIntersections(cube(2)).epsilon;
  const grande = findSelfIntersections(cube(2000)).epsilon;
  assert.ok(
    Math.abs(grande / pequeño - 1000) < 1e-6,
    `el epsilon tenía que crecer mil veces y pasa de ${pequeño} a ${grande}`,
  );

  console.log(
    `autointersección: ok (por debajo del epsilon no se afirma nada, y el epsilon pasa de ${pequeño} a ` +
      `${grande} entre un cubo de lado 2 y uno de lado 2000)`,
  );
}

// 7. Determinismo.
{
  // Uno tumbado en z=0 y otro de pie en x=0, **sin compartir ningún vértice**:
  // con un vértice común la exclusión de vecinos se lo comería, que es
  // precisamente lo que hace el tercer bloque.
  const cruz = mesh(
    [-1, 0, 0, 1, 0, 0, 0, 1, 0, 0, -0.5, -1, 0, -0.5, 1, 0, 1.5, 0],
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(
    JSON.stringify(findSelfIntersections(cruz)),
    JSON.stringify(findSelfIntersections(cruz)),
    "dos ejecuciones dan documentos distintos",
  );
  console.log("autointersección: ok (dos ejecuciones sobre la misma malla dan el mismo documento)");
}

console.log(
  "autointersección: no ejecutada — el caso coplanar sigue sin poderse afirmar y por eso se cuenta " +
    "aparte (§86.3 n). Resolverlo pide predicados exactos, que es otra decisión y otro coste",
);
