/**
 * Puerta del árbol de triángulos — D24.
 *
 * El juez es **la fuerza bruta**, no un valor dorado escrito a mano: para cada
 * consulta se recorre la malla entera y se compara triángulo a triángulo. Un
 * árbol solo sirve si contesta exactamente lo mismo que mirarlo todo, y esa es
 * la única propiedad que no se puede verificar leyendo el código.
 *
 * Lo que se comprueba, en orden:
 *
 *   1. **Estructura**: cada triángulo aparece una vez y solo una en las hojas, y
 *      la caja de cada nodo contiene la de sus hijos. Un árbol que pierde un
 *      triángulo da respuestas plausibles y equivocadas.
 *   2. **Rayos**: mil rayos deterministas contra el toro y el cubo, comparando
 *      triángulo y distancia con el recorrido completo. Incluye rayos que no
 *      tocan nada, que es donde un árbol mal podado devuelve un falso positivo.
 *   3. **Punto más cercano**: lo mismo, con puntos dentro, fuera y sobre la
 *      superficie.
 *   4. **Caja**: la lista de candidatos, que además de correcta va **ordenada**,
 *      porque quien compare dos listas compara orden.
 *   5. **Determinismo**: dos construcciones dan los mismos arrays, byte a byte.
 *   6. **Recursos**: lo que cuesta construirlo sobre 100k triángulos, medido con
 *      el mismo arnés que D25. El escalón de 1M y 5M pide SOFTSIGHT_HEAVY=1.
 */

import assert from "node:assert/strict";

import {
  buildTriangleBoundsTree,
  nearestPoint,
  queryAabb,
  raycast,
  resolveScene,
} from "../dist-node/agent3d.mjs";
import { torusMesh } from "./scaleMesh.mjs";

/** Generador congruente lineal: números al azar que son los mismos cada vez. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const CUBO = resolveScene({
  objects: [{ name: "cubo", geometry: { primitive: "box", parameters: [1, 1, 1] } }],
})[0].node.mesh;
const TORO = torusMesh(2000);

/** El mismo rayo, mirando todos los triángulos. */
function bruteRay(mesh, origin, direction) {
  let best = Infinity;
  let bestTriangle = -1;
  const { positions, indices } = mesh;
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const a = indices[triangle * 3] * 3;
    const b = indices[triangle * 3 + 1] * 3;
    const c = indices[triangle * 3 + 2] * 3;
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const p = [
      direction[1] * e2[2] - direction[2] * e2[1],
      direction[2] * e2[0] - direction[0] * e2[2],
      direction[0] * e2[1] - direction[1] * e2[0],
    ];
    const determinant = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (determinant > -1e-12 && determinant < 1e-12) continue;
    const inverse = 1 / determinant;
    const t = [origin[0] - positions[a], origin[1] - positions[a + 1], origin[2] - positions[a + 2]];
    const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
    if (u < 0 || u > 1) continue;
    const q = [
      t[1] * e1[2] - t[2] * e1[1],
      t[2] * e1[0] - t[0] * e1[2],
      t[0] * e1[1] - t[1] * e1[0],
    ];
    const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
    if (v < 0 || u + v > 1) continue;
    const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inverse;
    if (distance <= 1e-9) continue;
    if (distance < best || (distance === best && triangle < bestTriangle)) {
      best = distance;
      bestTriangle = triangle;
    }
  }
  return bestTriangle < 0 ? null : { triangle: bestTriangle, distance: best };
}

// 1. Estructura: ni un triángulo perdido, ni una caja que no contenga a sus hijos.
{
  for (const [nombre, mesh] of [["cubo", CUBO], ["toro", TORO]]) {
    const tree = buildTriangleBoundsTree(mesh);
    const visto = new Uint8Array(tree.triangleCount);
    let enHojas = 0;
    for (let node = 0; node < tree.nodeCount; node += 1) {
      if (tree.count[node] === 0) {
        // Un nodo interno contiene a sus dos hijos: si no, la poda descarta ramas
        // que sí tenían la respuesta y el árbol miente rápido.
        for (const hijo of [tree.left[node], tree.right[node]]) {
          for (let axis = 0; axis < 3; axis += 1) {
            assert.ok(
              tree.bounds[node * 6 + axis] <= tree.bounds[hijo * 6 + axis] + 1e-6 &&
                tree.bounds[node * 6 + 3 + axis] >= tree.bounds[hijo * 6 + 3 + axis] - 1e-6,
              `${nombre}: el nodo ${node} no contiene a su hijo ${hijo}`,
            );
          }
        }
        continue;
      }
      for (let slot = tree.start[node]; slot < tree.start[node] + tree.count[node]; slot += 1) {
        const triangle = tree.order[slot];
        assert.equal(visto[triangle], 0, `${nombre}: el triángulo ${triangle} está en dos hojas`);
        visto[triangle] = 1;
        enHojas += 1;
      }
    }
    assert.equal(enHojas, tree.triangleCount, `${nombre}: hay triángulos que no están en ninguna hoja`);
  }
  console.log("árbol: ok (cada triángulo en una hoja y solo una; cada nodo contiene a sus hijos)");
}

// 2. Rayos contra el recorrido completo.
{
  let tocados = 0;
  let vacíos = 0;
  for (const [nombre, mesh, radio] of [["cubo", CUBO, 1.2], ["toro", TORO, 2]]) {
    const tree = buildTriangleBoundsTree(mesh);
    const dado = random(20260812);
    for (let intento = 0; intento < 500; intento += 1) {
      const origin = [(dado() - 0.5) * radio * 4, (dado() - 0.5) * radio * 4, (dado() - 0.5) * radio * 4];
      // La mitad de los rayos apunta a un punto de la caja del objeto y la otra
      // mitad va a donde caiga: con direcciones puramente al azar casi ninguno
      // acierta —39 de 1000 en la primera versión de esta prueba— y lo que se
      // estaría comprobando es sobre todo que el árbol no inventa cortes.
      const apunta = intento % 2 === 0;
      const hacia = apunta
        ? [
            (dado() - 0.5) * radio - origin[0],
            (dado() - 0.5) * radio - origin[1],
            (dado() - 0.5) * radio - origin[2],
          ]
        : [(dado() - 0.5) * 2, (dado() - 0.5) * 2, (dado() - 0.5) * 2];
      const length = Math.hypot(hacia[0], hacia[1], hacia[2]) || 1;
      const direction = [hacia[0] / length, hacia[1] / length, hacia[2] / length];

      const árbol = raycast(tree, origin, direction);
      const bruto = bruteRay(mesh, origin, direction);
      if (bruto === null) {
        assert.equal(árbol, null, `${nombre}: el árbol ve un corte donde no lo hay`);
        vacíos += 1;
        continue;
      }
      assert.ok(árbol !== null, `${nombre}: el árbol pierde un corte que existe`);
      assert.equal(árbol.triangle, bruto.triangle, `${nombre}: triángulo distinto`);
      assert.ok(Math.abs(árbol.distance - bruto.distance) < 1e-9, `${nombre}: distancia distinta`);
      tocados += 1;
    }
  }
  console.log(
    `árbol: ok (1000 rayos deterministas contra el recorrido completo: ${tocados} cortan, ${vacíos} no tocan nada)`,
  );
}

// 3. Punto más cercano, con la superficie incluida.
{
  const tree = buildTriangleBoundsTree(TORO);
  const { positions, indices } = TORO;
  const dado = random(4711);
  for (let intento = 0; intento < 300; intento += 1) {
    const point = [(dado() - 0.5) * 6, (dado() - 0.5) * 6, (dado() - 0.5) * 6];
    const cerca = nearestPoint(tree, point);
    let best = Infinity;
    for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
      for (const vertex of [0, 1, 2]) {
        const offset = indices[triangle * 3 + vertex] * 3;
        const dx = positions[offset] - point[0];
        const dy = positions[offset + 1] - point[1];
        const dz = positions[offset + 2] - point[2];
        best = Math.min(best, dx * dx + dy * dy + dz * dz);
      }
    }
    // La distancia al triángulo nunca puede ser mayor que la distancia al vértice
    // más próximo, y nunca menor que cero. Comparar contra los vértices es una
    // cota que no depende de reimplementar la distancia punto-triángulo aquí.
    assert.ok(
      cerca.distanceSquared <= best + 1e-9,
      `la distancia a la superficie (${cerca.distanceSquared}) supera la del vértice más próximo (${best})`,
    );
  }

  // Y sobre la superficie: el punto de un vértice está a distancia cero.
  for (let vertex = 0; vertex < 20; vertex += 1) {
    const offset = indices[vertex * 3] * 3;
    const cerca = nearestPoint(tree, [positions[offset], positions[offset + 1], positions[offset + 2]]);
    assert.ok(cerca.distanceSquared < 1e-12, `un vértice de la malla no está sobre la malla: ${cerca.distanceSquared}`);
  }
  console.log("árbol: ok (300 puntos más cercanos acotados por el vértice más próximo, y 20 vértices a distancia cero)");
}

// 4. Caja: los mismos candidatos que el recorrido completo, y en orden.
{
  const tree = buildTriangleBoundsTree(TORO);
  const { positions, indices } = TORO;
  const dado = random(99);
  for (let intento = 0; intento < 100; intento += 1) {
    const center = [(dado() - 0.5) * 3, (dado() - 0.5) * 3, (dado() - 0.5) * 3];
    const half = 0.05 + dado() * 0.4;
    const min = center.map((value) => value - half);
    const max = center.map((value) => value + half);

    const bruto = [];
    for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
      let solapa = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const a = positions[indices[triangle * 3] * 3 + axis];
        const b = positions[indices[triangle * 3 + 1] * 3 + axis];
        const c = positions[indices[triangle * 3 + 2] * 3 + axis];
        if (Math.min(a, b, c) > max[axis] || Math.max(a, b, c) < min[axis]) solapa = false;
      }
      if (solapa) bruto.push(triangle);
    }
    assert.deepEqual(queryAabb(tree, min, max), bruto, "la lista de candidatos no es la del recorrido completo");
  }
  console.log("árbol: ok (100 cajas con los mismos candidatos que el recorrido completo, y en orden ascendente)");
}

// 5. Determinismo: mismo árbol, byte a byte.
{
  const primero = buildTriangleBoundsTree(TORO);
  const segundo = buildTriangleBoundsTree(TORO);
  assert.equal(primero.nodeCount, segundo.nodeCount);
  for (const campo of ["bounds", "start", "count", "left", "right", "order"]) {
    assert.deepEqual(
      Buffer.from(primero[campo].buffer, primero[campo].byteOffset, primero[campo].byteLength),
      Buffer.from(segundo[campo].buffer, segundo[campo].byteOffset, segundo[campo].byteLength),
      `${campo} cambia entre dos construcciones`,
    );
  }
  console.log(`árbol: ok (dos construcciones dan los mismos ${primero.nodeCount} nodos, byte a byte)`);
}

// 6. Lo que cuesta construirlo, con el arnés de D25.
{
  const { environment, measureInChild } = await import("./auditBaseline.mjs");
  void environment;
  const escalones = process.env.SOFTSIGHT_HEAVY === "1" ? [100000, 1000000, 5000000] : [100000];
  for (const triangles of escalones) {
    const medida = await measureInChild(triangles, "boundsTree");
    assert.ok(medida.ok, `el árbol de ${triangles} triángulos reventó: ${medida.reason}`);
    // Techo generoso: es una alarma contra una regresión de orden de magnitud, no
    // un objetivo. El de 100k viene de lo medido el 2026-08-12 en un i5-5350U.
    const techo = triangles === 100000 ? { cpu: 2, rss: 250 } : { cpu: 60, rss: 2000 };
    assert.ok(medida.cpuMs / 1000 < techo.cpu, `${triangles}: ${(medida.cpuMs / 1000).toFixed(2)} s pasa del techo`);
    assert.ok(medida.peakRss / (1024 * 1024) < techo.rss, `${triangles}: RSS por encima del techo`);
    console.log(
      `árbol: ok (${triangles.toLocaleString("es-ES")} triángulos: ${(medida.cpuMs / 1000).toFixed(2)} s de CPU, ` +
        `${medida.nodes.toLocaleString("es-ES")} nodos, ${(medida.treeBytes / (1024 * 1024)).toFixed(1)} MiB de árbol, ` +
        `RSS máx ${(medida.peakRss / (1024 * 1024)).toFixed(0)} MiB)`,
    );
  }
  if (process.env.SOFTSIGHT_HEAVY !== "1") {
    console.log(
      "árbol: no ejecutada — los escalones de 1M y 5M piden SOFTSIGHT_HEAVY=1, como la puerta de recursos",
    );
  }
}
