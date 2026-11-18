/**
 * Puerta del encargo 05-A — separar piezas de una malla fundida, sin ojos.
 *
 * Las dos medidas del encargo (§2.1 conservación, §2.2 borde del corte) contra
 * casos cuyo resultado se sabe de antemano, como mesh-topology y mesh-diff. El
 * bloque 6 es el que decide si la medida del borde vale, y sus dos números salen
 * de la geometría, no de una ejecución:
 *
 *   el mismo objeto —un cubo con sus caras en rejilla de 8 y el anillo central
 *   de su cara superior marcado como pieza—, separado por esa costura real (el
 *   anillo de contacto: 8 aristas en curva cerrada) y cortado por la mitad (el
 *   plano z=0 atraviesa las 4 caras laterales: 32 aristas).
 *
 * El segundo tiene que dar un número mucho mayor. Si no distingue, la medida no
 * mide, y lo demás sobra.
 *
 * La rejilla de 8 hace que todo cuadre sin coma flotante: el plano z=0 cae en
 * una línea de la rejilla, cada arista mide 0,25 —potencia de dos— y los
 * recuentos son los escritos abajo, derivados a mano.
 */

import assert from "node:assert/strict";

import { auditPartition, auditPartitionDocument, partitionTriangles } from "../dist-node/agent3d.mjs";

const SEGMENTS = 8;
const H = 1; // el cuerpo va de -1 a 1 en los tres ejes

function mesh(positions, indices) {
  return {
    positions: Float32Array.from(positions),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: Uint32Array.from(indices),
    boundingRadius: 0,
  };
}

/** Cuadrícula `n`×`n` de la cara `axis` del cubo [-H,H]³, en su plano `at`, con
 * vértices compartidos —uno por cruce, (n+1)²— y winding hacia fuera. Emite los
 * cuadrados en orden de fila: el cuadrado `q` son los triángulos `2q` y `2q+1`. */
function gridFace(n, axis, at, flip) {
  const positions = [];
  const indices = [];
  const axes = [0, 1, 2].filter((a) => a !== axis);
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const point = [0, 0, 0];
      point[axis] = at;
      point[axes[0]] = -H + (2 * H * i) / n;
      point[axes[1]] = -H + (2 * H * j) / n;
      positions.push(...point);
    }
  }
  const at_ = (i, j) => i * (n + 1) + j;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = at_(i, j);
      const b = at_(i + 1, j);
      const c = at_(i + 1, j + 1);
      const d = at_(i, j + 1);
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices };
}

/** El objeto del encargo: las 6 caras del cubo en rejilla, con el anillo central
 * de la cara `ringFace` —los cuadrados i,j ∈ {3,4}— marcado como la pieza que
 * se separa por su costura. El anillo va INCLUIDO: la malla entera es cerrada,
 * y la costura son las 8 aristas por las que el anillo toca al resto. */
function bodyWithRing(ringFace) {
  const positions = [];
  const indices = [];
  let ring = [];
  let base = 0; // vértices emitidos antes de esta cara
  let triangleBase = 0; // triángulos emitidos antes de esta cara: el anillo se
  // numera en triángulos, no en vértices
  for (let face = 0; face < 6; face += 1) {
    const axis = face >> 1;
    const at = face % 2 === 0 ? -H : H;
    const flip = face % 2 === 1;
    const { positions: fp, indices: fi } = gridFace(SEGMENTS, axis, at, flip);
    if (face === ringFace) {
      ring = [];
      for (let q = 0; q < SEGMENTS * SEGMENTS; q += 1) {
        const i = Math.floor(q / SEGMENTS);
        const j = q % SEGMENTS;
        if ((i === 3 || i === 4) && (j === 3 || j === 4)) {
          ring.push(triangleBase + q * 2, triangleBase + q * 2 + 1);
        }
      }
    }
    positions.push(...fp);
    for (const t of fi) indices.push(t + base);
    base += fp.length / 3;
    triangleBase += fi.length / 3;
  }
  return { mesh: mesh(positions, indices), ring };
}

const { mesh: body, ring } = bodyWithRing(5); // el anillo, en la cara superior
const TRIANGLES = body.indices.length / 3; // 768: 6 caras × 128

const REST = [];
for (let t = 0; t < TRIANGLES; t += 1) if (!ring.includes(t)) REST.push(t);

/** z medio de un triángulo, para el corte por la mitad. */
function zOf(t) {
  return (
    (body.positions[body.indices[t * 3] * 3 + 2] +
      body.positions[body.indices[t * 3 + 1] * 3 + 2] +
      body.positions[body.indices[t * 3 + 2] * 3 + 2]) /
    3
  );
}

/* ------------------------------------------------------------------ */
/* 1. Conservación: el reparto exacto la cumple con los números vistos  */
/* ------------------------------------------------------------------ */

{
  const audit = auditPartition(body, partitionTriangles(body, REST, ring));

  assert.equal(audit.parts.length, 2);
  assert.equal(audit.coverage.total, TRIANGLES);
  // El titular del encargo: partes + lo que queda == original.
  assert.equal(audit.coverage.accounted + audit.coverage.unassigned, TRIANGLES);
  assert.equal(audit.coverage.accounted, TRIANGLES);
  assert.equal(audit.coverage.unassigned, 0);
  assert.equal(audit.coverage.duplicated, 0);
  assert.equal(audit.coverage.outOfRange, 0);
  for (const part of audit.parts) {
    assert.equal(part.triangles.duplicated, 0);
    assert.equal(part.triangles.outOfRange, 0);
    assert.equal(part.triangles.accounted, part.triangles.total);
    assert.equal(part.vertices.moved, 0);
    assert.equal(part.vertices.maxDistance, 0);
  }
  assert.equal(audit.parts[1].triangles.accounted, 8); // el anillo
  assert.equal(audit.parts[0].triangles.accounted, 760); // el resto
  console.log("partición: ok (el reparto exacto conserva los 768 triángulos: 760 + 8, sin duplicados ni vértices movidos)");
}

/* ------------------------------------------------------------------ */
/* 2. Conservación en rojo: el reparto que deja un triángulo           */
/* ------------------------------------------------------------------ */

{
  const audit = auditPartition(
    body,
    partitionTriangles(body, REST.slice(0, -1), ring),
  );
  assert.equal(audit.coverage.unassigned, 1);
  assert.equal(audit.coverage.accounted, TRIANGLES - 1);
  assert.equal(audit.parts[0].triangles.accounted, 759);
  console.log("partición: ok (el triángulo que nadie reclama sale en `unassigned`, no se pierde callando)");
}

/* ------------------------------------------------------------------ */
/* 3. Conservación en rojo: el triángulo que dos partes reclaman       */
/* ------------------------------------------------------------------ */

{
  const audit = auditPartition(
    body,
    partitionTriangles(body, REST, [...ring, REST[REST.length - 1]]),
  );
  // El mismo triángulo en las dos partes: el total ya no suma, y así se ve.
  assert.equal(audit.coverage.duplicated, 1);
  assert.equal(audit.coverage.accounted, TRIANGLES);
  assert.equal(audit.parts[0].triangles.total, 760);
  assert.equal(audit.parts[1].triangles.total, 9);
  console.log("partición: ok (el triángulo que reclaman dos partes sale en `duplicated`)");
}

/* ------------------------------------------------------------------ */
/* 4. Conservación en rojo: el índice repetido dentro de una parte,    */
/*    y el que está fuera de la malla                                  */
/* ------------------------------------------------------------------ */

{
  const audit = auditPartition(
    body,
    partitionTriangles(body, REST, [...ring, ring[0]]),
  );
  assert.equal(audit.parts[1].triangles.duplicated, 1);
  assert.equal(audit.parts[1].triangles.accounted, 8);
  assert.equal(audit.coverage.duplicated, 0); // repetir dentro de una parte no
  // reparte dos veces: el triángulo sigue en una sola.
}
{
  const audit = auditPartition(
    body,
    partitionTriangles(body, REST, [...ring, 999999]),
  );
  assert.equal(audit.parts[1].triangles.outOfRange, 1);
  assert.equal(audit.coverage.outOfRange, 1);
  console.log("partición: ok (repetir dentro de una parte no reparte dos veces, y el índice fuera de la malla se cuenta aparte)");
}

/* ------------------------------------------------------------------ */
/* 5. Conservación en rojo: el reparto que mueve un vértice            */
/* ------------------------------------------------------------------ */

{
  const partition = partitionTriangles(body, REST, ring);
  // El primer vértice del primer triángulo de la parte grande: la distancia
  // sale entera —1 unidad—, no un resto de coma flotante.
  partition.parts[0].positions[body.indices[REST[0] * 3] * 3] += 1;
  const audit = auditPartition(body, partition);
  assert.equal(audit.parts[0].vertices.moved, 1);
  assert.equal(audit.parts[0].vertices.maxDistance, 1);
  console.log("partición: ok (el reparto que mueve un vértice se delata con la distancia exacta, 1)");
}

/* ------------------------------------------------------------------ */
/* 6. EL CASO DEL ENCARGO: costura real contra corte por la mitad      */
/* ------------------------------------------------------------------ */

{
  // Por la costura: el anillo entero se va con su pieza; solo se abren las 8
  // aristas de su anillo de contacto, que quedan en una curva cerrada.
  const seam = auditPartition(body, partitionTriangles(body, REST, ring));
  assert.equal(seam.parts[0].boundary.edges, 8);
  assert.equal(seam.parts[1].boundary.edges, 8);
  assert.equal(seam.parts[0].boundary.length, 2); // 8 × 0,25
  assert.equal(seam.parts[1].boundary.length, 2);

  // Por la mitad: el plano z=0 reparte por el signo de z; cae en la línea de
  // la rejilla, así que ningún triángulo lo cruza y el reparto es exacto.
  const arriba = [];
  const abajo = [];
  for (let t = 0; t < TRIANGLES; t += 1) (zOf(t) > 0 ? arriba : abajo).push(t);
  assert.equal(arriba.length, 384);
  assert.equal(abajo.length, 384);
  const half = auditPartition(body, partitionTriangles(body, arriba, abajo));
  assert.equal(half.parts[0].boundary.edges, 32);
  assert.equal(half.parts[1].boundary.edges, 32);
  assert.equal(half.parts[0].boundary.length, 8); // 32 × 0,25
  // El total del corte cuenta cada arista una vez: las 8 de la costura y las 32
  // del plano están en las dos partes, y el total no las suma dos veces.
  assert.deepEqual(seam.cut, { edges: 8, length: 2 });
  assert.deepEqual(half.cut, { edges: 32, length: 8 });

  assert.ok(
    half.parts[0].boundary.edges > 2 * seam.parts[0].boundary.edges,
    `el corte por la mitad (${half.parts[0].boundary.edges}) tiene que dar mucho más que la costura (${seam.parts[0].boundary.edges})`,
  );

  // Relativizadas a la escala de su parte: el anillo ocupa 0,5×0,5 en su cara
  // (diagonal √½) y cada mitad del cubo cortado mide 2×2×1 (diagonal 3).
  assert.ok(Math.abs(seam.parts[1].boundary.relative - 2 * Math.SQRT2) < 1e-6);
  assert.ok(Math.abs(half.parts[0].boundary.relative - 8 / 3) < 1e-6);

  // Y el recuento es determinista: dos pasadas, el mismo número.
  const again = auditPartition(body, partitionTriangles(body, arriba, abajo));
  assert.equal(again.parts[0].boundary.edges, half.parts[0].boundary.edges);
  assert.equal(again.parts[0].boundary.length, half.parts[0].boundary.length);
  console.log(
    `partición: ok (la costura abre ${seam.parts[0].boundary.edges} aristas y el corte por la mitad ${half.parts[0].boundary.edges}: la medida distingue, y dos pasadas dan el mismo número)`,
  );
}

/* ------------------------------------------------------------------ */
/* 7. El documento de `--partition`: lo que no encaja es un error de   */
/*    datos, no una medida rara                                        */
/* ------------------------------------------------------------------ */

{
  const doc = (parts) => ({ partitionVersion: 1, parts });
  const report = auditPartitionDocument(body, doc([
    { name: "resto", triangles: REST },
    { name: "anillo", triangles: ring },
  ]));
  assert.deepEqual(report.mesh, { triangles: TRIANGLES, vertices: body.positions.length / 3 });
  assert.deepEqual(report.cut, { edges: 8, length: 2 });
  assert.deepEqual(report.parts.map((part) => [part.name, part.positionsFrom]), [["resto", "original"], ["anillo", "original"]]);
  assert.deepEqual(report.parts[1].boundary, auditPartition(body, partitionTriangles(body, REST, ring)).parts[1].boundary);

  // Con posiciones propias, el vértice movido se ve igual que en la función.
  const movidas = Array.from(body.positions);
  movidas[body.indices[ring[0] * 3] * 3 + 1] += 0.5;
  const conPosiciones = auditPartitionDocument(body, doc([{ name: "anillo", triangles: ring, positions: movidas }]));
  assert.equal(conPosiciones.parts[0].positionsFrom, "pieza");
  assert.equal(conPosiciones.parts[0].vertices.moved, 1);

  assert.throws(() => auditPartitionDocument(body, { partitionVersion: 2, parts: [{ name: "a", triangles: [0] }] }), /lee la 1/);
  assert.throws(() => auditPartitionDocument(body, doc([{ name: "a", triangles: [0] }, { name: "a", triangles: [1] }])), /dos piezas llamadas «a»/);
  assert.throws(() => auditPartitionDocument(body, doc([{ name: "a", triangles: [0], positions: [0, 0, 0] }])), /sin el mismo largo/);
  assert.throws(() => auditPartitionDocument(body, doc([{ name: "a", triangels: [0] }])), /¿querías decir triangles\?/);
  assert.throws(() => auditPartitionDocument(body, doc([])), /no tiene piezas/);
  console.log(
    "partición: ok (el documento de --partition da las mismas medidas que la función, con posiciones propias delata " +
      "el vértice movido, y otra versión, un nombre repetido, otro largo o una errata son errores con su motivo)",
  );
}
