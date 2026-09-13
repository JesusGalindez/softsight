/**
 * Puerta de R4 — la topología con estructura.
 *
 * El escalón pide que «los defectos de geometría conocidos se detecten
 * exactamente», así que todos los casos de aquí son mallas **construidas con el
 * defecto dentro** y con el resultado sabido de antemano. Un cubo al que le falta
 * una cara tiene un bucle de cuatro aristas, de longitud `4·lado` y de extensión
 * `lado·√2`: los tres números salen de la geometría, no de ejecutar el código y
 * apuntar lo que dio.
 *
 * El caso que de verdad importa es el quinto. Un cubo con los vértices partidos
 * por cara —que es como viene cualquier malla con UVs o normales duras— tiene 24
 * vértices y **parece** seis piezas sueltas con 24 aristas de borde. Si el módulo
 * no soldara, diría que casi todo modelo real está roto.
 */

import assert from "node:assert/strict";

import { analyzeMeshTopology, auditMesh } from "../dist-node/agent3d.mjs";

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

/** Cubo compartiendo vértices: 8 posiciones, 12 triángulos. `drop` quita caras. */
function cube(center = [0, 0, 0], side = 1, drop = []) {
  const h = side / 2;
  const [cx, cy, cz] = center;
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz]);
  const faces = CUBE_FACES.filter((_, index) => !drop.includes(index));
  return mesh(corners.flat(), faces.flat());
}

/** El mismo cubo con los vértices partidos por triángulo: 36 posiciones sueltas. */
function splitCube(side = 1) {
  const closed = cube([0, 0, 0], side);
  const positions = [];
  const indices = [];
  for (let index = 0; index < closed.indices.length; index += 1) {
    const source = closed.indices[index] * 3;
    positions.push(
      closed.positions[source],
      closed.positions[source + 1],
      closed.positions[source + 2],
    );
    indices.push(index);
  }
  return mesh(positions, indices);
}

function merge(a, b) {
  const offset = a.positions.length / 3;
  return mesh(
    [...a.positions, ...b.positions],
    [...a.indices, ...[...b.indices].map((index) => index + offset)],
  );
}

// 1. Un cubo cerrado: una pieza, ningún bucle, y el área que dice la geometría.
{
  const side = 2;
  const topology = analyzeMeshTopology(cube([0, 0, 0], side));

  assert.equal(topology.components.length, 1, "un cubo es una pieza");
  assert.equal(topology.components[0].triangles, 12);
  assert.equal(topology.components[0].vertices, 8);
  assert.ok(
    Math.abs(topology.area - 6 * side * side) < 1e-5,
    `el área de un cubo de lado ${side} es ${6 * side * side} y da ${topology.area}`,
  );
  assert.equal(topology.largestComponentAreaRatio, 1);
  assert.deepEqual(topology.boundaryLoops, [], "cerrado no tiene contorno");
  assert.equal(topology.ambiguousVertices, 0);

  console.log(
    `topología: ok (cubo cerrado: una pieza, ${topology.area} de área exacta y ningún bucle)`,
  );
}

// 2. Un agujero con forma conocida.
//
// Quitar las dos caras del mismo lado deja un cuadrado abierto: cuatro aristas de
// perímetro, porque la diagonal que compartían desaparece con ellas.
{
  const side = 2;
  const topology = analyzeMeshTopology(cube([0, 0, 0], side, [0, 1]));

  assert.equal(topology.boundaryLoops.length, 1, "una cara quitada es un agujero");
  const [loop] = topology.boundaryLoops;
  assert.equal(loop.edges, 4, "el contorno de una cara cuadrada son cuatro aristas");
  assert.ok(Math.abs(loop.length - 4 * side) < 1e-5, `el perímetro es ${4 * side} y da ${loop.length}`);
  assert.ok(
    Math.abs(loop.extent - side * Math.SQRT2) < 1e-5,
    `la extensión es la diagonal de la cara, ${side * Math.SQRT2}, y da ${loop.extent}`,
  );
  // Y sigue siendo una sola pieza: un agujero no parte la malla.
  assert.equal(topology.components.length, 1);

  console.log(
    `topología: ok (una cara quitada: un bucle de 4 aristas, ${loop.length} de perímetro y ` +
      `${loop.extent.toFixed(4)} de extensión, los tres de la geometría)`,
  );
}

// 3. Dos agujeros, que es lo que un contador de aristas no distingue.
{
  const conUno = analyzeMeshTopology(cube([0, 0, 0], 1, [0, 1]));
  const conDos = analyzeMeshTopology(cube([0, 0, 0], 1, [0, 1, 2, 3]));

  // Ocho aristas de borde en el segundo. El contador de `auditMesh` diría «8» en
  // los dos casos si el primero tuviera un agujero del doble de perímetro, y la
  // reparación no es la misma.
  assert.equal(conUno.boundaryLoops.length, 1);
  assert.equal(conDos.boundaryLoops.length, 2, "dos caras opuestas quitadas son dos agujeros");
  assert.deepEqual(
    conDos.boundaryLoops.map((loop) => loop.edges),
    [4, 4],
  );
  assert.equal(auditMesh(cube([0, 0, 0], 1, [0, 1, 2, 3])).boundaryEdges, 8);

  console.log(
    "topología: ok (dos caras opuestas: dos bucles de 4 y no un contador de 8; el contador no " +
      "distingue un agujero grande de dos pequeños y la reparación sí)",
  );
}

// 4. Fragmentación: lo que ninguna imagen desmiente.
{
  const grande = cube([0, 0, 0], 2);
  const mota = cube([5, 0, 0], 0.2);
  const topology = analyzeMeshTopology(merge(grande, mota));

  assert.equal(topology.components.length, 2, "dos cubos separados son dos piezas");
  // Ordenados por área, así que el grande va primero **siempre**: sin criterio
  // fijo, dos ejecuciones podrían numerarlos al revés.
  assert.ok(topology.components[0].area > topology.components[1].area);
  assert.ok(
    Math.abs(topology.components[0].area - 24) < 1e-5 &&
      Math.abs(topology.components[1].area - 6 * 0.04) < 1e-5,
  );
  // El ratio es lo que separa «una pieza con una mota» de «una nube de trozos»:
  // aquí 0,99, y el recuento de componentes vale 2 en los dos casos.
  assert.ok(
    topology.largestComponentAreaRatio > 0.98,
    `una mota no puede bajar el ratio: ${topology.largestComponentAreaRatio}`,
  );

  const nube = [0, 1, 2, 3, 4, 5].reduce(
    (all, index) => merge(all, cube([index * 3, 0, 0], 2)),
    cube([-3, 0, 0], 2),
  );
  const fragmentada = analyzeMeshTopology(nube);
  assert.equal(fragmentada.components.length, 7);
  assert.ok(
    Math.abs(fragmentada.largestComponentAreaRatio - 1 / 7) < 1e-6,
    `siete piezas iguales dan 1/7 y da ${fragmentada.largestComponentAreaRatio}`,
  );

  console.log(
    `topología: ok (una mota deja el ratio en ${topology.largestComponentAreaRatio.toFixed(4)} y siete ` +
      "piezas iguales en 1/7: el recuento vale 2 y 7, pero solo el ratio dice cuál es una reconstrucción rota)",
  );
}

// 5. El caso que decide si esto sirve para algo.
//
// Un cubo con los vértices partidos —como viene cualquier malla con UVs o
// normales duras— tiene 36 posiciones y parece doce triángulos sueltos. Sin
// soldar, el módulo diría que casi todo modelo real está hecho pedazos.
{
  const partido = splitCube(2);
  assert.equal(partido.positions.length / 3, 36, "el fixture tiene que venir partido de verdad");

  const topology = analyzeMeshTopology(partido);
  assert.equal(topology.components.length, 1, "soldando, un cubo partido sigue siendo una pieza");
  assert.deepEqual(topology.boundaryLoops, [], "y sigue estando cerrado");
  assert.equal(topology.components[0].triangles, 12);
  // El área no depende del soldado: son los mismos triángulos.
  assert.ok(Math.abs(topology.area - 24) < 1e-5);

  console.log(
    "topología: ok (un cubo con los 36 vértices partidos sigue siendo una pieza cerrada: sin soldar, " +
      "cualquier malla con UVs se reportaría hecha pedazos)",
  );
}

// 6. Los bucles cuadran con el contador, y lo ambiguo se dice en vez de repartirse.
{
  for (const drop of [[], [0, 1], [0, 1, 2, 3], [0, 1, 4, 5, 8, 9]]) {
    const target = cube([0, 0, 0], 1, drop);
    const topology = analyzeMeshTopology(target);
    const counted = topology.boundaryLoops.reduce((total, loop) => total + loop.edges, 0);
    // La suma de los bucles más lo irresoluble tiene que dar el contador de la
    // auditoría. Si no cuadrara, el módulo estaría perdiendo aristas por el
    // camino y nadie se enteraría.
    assert.equal(
      counted + topology.unresolvedBoundaryEdges,
      auditMesh(target).boundaryEdges,
      `con ${drop.length} caras fuera, los bucles no suman lo que cuenta auditMesh`,
    );
  }

  console.log(
    "topología: ok (en cuatro cubos con distintas caras fuera, bucles + irresolubles == boundaryEdges: " +
      "no se pierde ni una arista por el camino)",
  );
}

// 7. Determinismo.
{
  const target = merge(cube([0, 0, 0], 2, [0, 1]), cube([5, 0, 0], 1, [4]));
  assert.equal(
    JSON.stringify(analyzeMeshTopology(target)),
    JSON.stringify(analyzeMeshTopology(target)),
    "dos ejecuciones dan documentos distintos",
  );
  console.log("topología: ok (dos ejecuciones sobre la misma malla dan el mismo documento)");
}

console.log(
  "topología: no ejecutada — la autointersección que R4 pide sigue fuera: en coma flotante no existe " +
    "el confirmado (§86.3 n), así que solo cabe como candidato con su epsilon, igual que el perfil 2D",
);
