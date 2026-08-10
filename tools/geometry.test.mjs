/**
 * Puerta de la geometría declarativa.
 *
 * El juez es el volumen firmado, y el valor esperado es **el del polígono
 * discretizado, no el de la figura ideal**: un círculo de 32 puntos no encierra
 * `πr²`, encierra el área del polígono inscrito. Comparar contra la figura ideal
 * daría una prueba que pasa con una teselación y falla con otra, que es lo mismo
 * que no tener prueba.
 *
 * Lo que se comprueba es lo que un agente falla de verdad al describir una pieza:
 *
 *   1. Que cada generador produzca el área que dice, con dos resoluciones
 *      distintas, para que no cuele una fórmula que acierta por casualidad.
 *   2. Que las familias que deben coincidir coincidan **número a número**: la
 *      superelipse de exponente 2 con el círculo, y Gielis con la circunferencia.
 *   3. Que un perfil aerodinámico salga cerrado, sin degenerados y sin borde.
 *   4. Que usar un perfil por nombre sea idéntico a escribirlo en línea.
 *   5. Que cada error de escritura se rechace **por su motivo**.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPatch,
  auditGeometry,
  auditMesh,
  auditSpatial,
  createCircleProfile,
  createGielisProfile,
  createLoft,
  createNacaProfile,
  createSuperellipseProfile,
  evaluateVariation,
  modelFromScene,
  resolveScene,
  reviewScene,
  sweepStations,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Malla de una escena de un solo objeto. */
function meshOf(scene) {
  return resolveScene(scene)[0].node.mesh;
}

function extruded(geometry, scene = {}) {
  return meshOf({ ...scene, objects: [{ geometry }] });
}

/** Área del polígono regular de `n` lados inscrito en el círculo de radio `r`. */
function regularArea(sides, radius) {
  return 0.5 * sides * radius * radius * Math.sin((2 * Math.PI) / sides);
}

// 1. Círculo: el volumen extruido es el área del polígono inscrito por la altura.
//    Con dos resoluciones, porque una sola no distingue una fórmula correcta de
//    una que acierta en ese caso.
for (const [points, radius, height] of [
  [32, 1, 2],
  [7, 0.4, 0.35],
  [128, 2.5, 0.1],
]) {
  const mesh = extruded({ extrude: createCircleProfile(radius, points), height });
  const audit = auditMesh(mesh);
  const expected = regularArea(points, radius) * height;
  assert.equal(audit.vertices, points * 2 + points * 4);
  assert.ok(
    Math.abs(audit.signedVolume - expected) < 1e-6,
    `círculo de ${points} puntos: ${audit.signedVolume} frente a ${expected}`,
  );
  assert.equal(audit.watertight, true);
  assert.equal(audit.degenerateTriangles, 0);
  assert.equal(audit.inverted, false);
}
console.log(
  `geometria: ok (círculo, 3 resoluciones; 32 puntos r=1 h=2 → ${auditMesh(
    extruded({ extrude: createCircleProfile(1, 32), height: 2 }),
  ).signedVolume} frente a ${(regularArea(32, 1) * 2).toFixed(6)})`,
);

// 2. La superelipse de exponente 2 con los dos semiejes iguales **es** el
//    círculo. Número a número: si se evaluase por la fórmula general, los ceros
//    saldrían con signo distinto.
for (const points of [4, 32, 96]) {
  assert.deepEqual(
    createSuperellipseProfile(1.7, 1.7, 2, points),
    createCircleProfile(1.7, points),
  );
}
// Y con exponente alto se acerca al rectángulo: el área crece hacia `4ab`.
const cuadradoide = auditMesh(
  extruded({ extrude: createSuperellipseProfile(1, 0.5, 12, 256), height: 1 }),
).signedVolume;
assert.ok(cuadradoide > 1.9 && cuadradoide < 2, `superelipse de exponente 12: ${cuadradoide}`);
console.log(
  `geometria: ok (superelipse ≡ círculo con exponente 2, 3 resoluciones; exponente 12 → ${cuadradoide.toFixed(4)} hacia 2)`,
);

// 3. Gielis con m=4 y los tres exponentes a 2 degenera en la circunferencia.
{
  const radius = 0.75;
  const polygon = createGielisProfile(4, 2, 2, 2, { radius, points: 64 });
  assert.equal(polygon.length, 128);
  for (let point = 0; point < polygon.length / 2; point += 1) {
    const distance = Math.hypot(polygon[point * 2], polygon[point * 2 + 1]);
    assert.ok(
      Math.abs(distance - radius) < 1e-12,
      `Gielis degenerado: punto ${point} a ${distance} en vez de ${radius}`,
    );
  }
  const audit = auditMesh(extruded({ extrude: polygon, height: 1 }));
  assert.ok(Math.abs(audit.signedVolume - regularArea(64, radius)) < 1e-6);
  console.log(`geometria: ok (Gielis m=4 n=2 ≡ circunferencia de radio ${radius}, 64 puntos)`);
}

// 4. NACA: el recuento cuadra, los dos extremos salen una vez, y el borde de
//    fuga cierra —que es lo que el coeficiente −0,1036 compra—.
{
  const chord = 0.72;
  const polygon = createNacaProfile("2412", chord, 64);
  assert.equal(polygon.length, 128, "un NACA de 64 puntos son 64 pares");

  // Borde de ataque en el origen y borde de fuga en la cuerda, los dos una vez.
  assert.equal(polygon[0], 0);
  assert.equal(polygon[1], 0);
  const trailing = polygon.length / 2 - 1;
  let trailingIndex = 0;
  let trailingMax = -Infinity;
  for (let point = 0; point <= trailing; point += 1) {
    if (polygon[point * 2] > trailingMax) {
      trailingMax = polygon[point * 2];
      trailingIndex = point;
    }
  }
  assert.ok(
    Math.abs(trailingMax - chord) < 1e-12,
    `el borde de fuga debe caer en la cuerda: ${trailingMax} frente a ${chord}`,
  );
  // Y una sola vez: ningún otro punto llega a la cuerda.
  for (let point = 0; point <= trailing; point += 1) {
    if (point === trailingIndex) continue;
    assert.ok(polygon[point * 2] < chord - 1e-9, `dos puntos en el borde de fuga (${point})`);
  }

  const audit = auditMesh(extruded({ extrude: polygon, height: 0.02 }));
  assert.equal(audit.watertight, true, "un NACA extruido tiene que salir cerrado");
  assert.equal(audit.boundaryEdges, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.degenerateTriangles, 0);
  assert.equal(audit.inverted, false);
  console.log(
    `geometria: ok (NACA 2412: 64 pares, borde de fuga cerrado en x=${chord}, extruido estanco)`,
  );
}

// 5. NACA simétrico: sin curvatura, cada estación tiene su reflejo exacto.
{
  const polygon = createNacaProfile("0012", 1, 32);
  const count = polygon.length / 2;
  // La superficie inferior va de 0 a estaciones−1 y la superior vuelve; el punto
  // `i` de la ida y el `count − i` de la vuelta son la misma estación.
  for (let point = 1; point < count / 2; point += 1) {
    const mirrored = count - point;
    assert.ok(
      Math.abs(polygon[point * 2] - polygon[mirrored * 2]) < 1e-15,
      `estación ${point}: las dos superficies deben estar en la misma x`,
    );
    assert.ok(
      Math.abs(polygon[point * 2 + 1] + polygon[mirrored * 2 + 1]) < 1e-15,
      `estación ${point}: sin curvatura, z arriba y z abajo deben ser opuestas`,
    );
  }
  console.log("geometria: ok (NACA 0012 simétrico, estación a estación)");
}

// 6. Un perfil por nombre y el mismo polígono escrito en línea dan la misma malla.
{
  const inline = createNacaProfile("2412", 0.72, 64);
  const porNombre = meshOf({
    profiles: [{ name: "ala", naca: "2412", chord: 0.72, points: 64 }],
    objects: [{ name: "costilla", geometry: { extrude: "ala", height: 0.02 } }],
  });
  const aMano = extruded({ extrude: inline, height: 0.02 });
  assert.deepEqual(porNombre.positions, aMano.positions);
  assert.deepEqual(porNombre.indices, aMano.indices);
  assert.deepEqual(porNombre.normals, aMano.normals);
  assert.equal(auditMesh(porNombre).signedVolume, auditMesh(aMano).signedVolume);

  // Y usado dos veces da dos piezas idénticas.
  const dos = resolveScene({
    profiles: [{ name: "brazo", circle: 0.05, points: 24 }],
    objects: [
      { name: "izquierda", geometry: { extrude: "brazo", height: 1 } },
      { name: "derecha", geometry: { extrude: "brazo", height: 1 } },
    ],
  });
  assert.deepEqual(dos[0].node.mesh.positions, dos[1].node.mesh.positions);
  console.log("geometria: ok (perfil por nombre ≡ polígono en línea, y reutilizable)");
}

// 7. Cada error, por su motivo. Comprobar solo que lanza dejaría pasar un mensaje
//    que manda al agente a mirar donde no es.
{
  const casos = [
    [
      { profiles: [{ name: "ala", naca: "2412" }], objects: [{ geometry: { extrude: "alas" } }] },
      /no hay ningún perfil llamado "alas".*declarados: ala/s,
    ],
    [
      { objects: [{ geometry: { extrude: "ala" } }] },
      /la escena no declara perfiles/,
    ],
    [
      { profiles: [{ name: "x", naca: "2412", circle: 1 }], objects: [{ geometry: { extrude: "x" } }] },
      /declara 2 generadores \(circle y naca\); declara uno/,
    ],
    [
      { profiles: [{ name: "x", points: 8 }], objects: [{ geometry: { extrude: "x" } }] },
      /no declara generador; admitidos: circle, superellipse, gielis, naca/,
    ],
    [
      { profiles: [{ name: "x", naca: "2412", points: 31 }], objects: [{ geometry: { extrude: "x" } }] },
      /points de un NACA debe ser par y al menos 8, no 31/,
    ],
    [
      { profiles: [{ name: "x", naca: "241" }], objects: [{ geometry: { extrude: "x" } }] },
      /un perfil NACA son cuatro dígitos, no "241"/,
    ],
    [
      {
        profiles: [
          { name: "x", circle: 1 },
          { name: "x", circle: 2 },
        ],
        objects: [{ geometry: { extrude: "x" } }],
      },
      /hay dos perfiles llamados "x"/,
    ],
    // El esquema es quien caza el campo inventado, y nombra el que falla y los
    // que admite. La sugerencia de `closeEnough` no llega hasta aquí —«circulo»
    // contra «circle» se le escapa—, así que no se le exige.
    [
      { profiles: [{ name: "x", circulo: 1 }], objects: [{ geometry: { extrude: "x" } }] },
      /profiles\[0\]\.circulo no existe; admitidos: name, circle/,
    ],
  ];
  for (const [scene, expected] of casos) {
    assert.throws(() => resolveScene(scene), expected, `no se rechazó por su motivo: ${expected}`);
  }
  console.log(`geometria: ok (${casos.length} escrituras malas rechazadas por su motivo)`);
}

// ---------------------------------------------------------------------------
// Loft: secciones cosidas.
// ---------------------------------------------------------------------------

/** Cuadrado de lado `side` centrado en el origen, antihorario en el papel x,z. */
function square(side) {
  const half = side / 2;
  return [-half, -half, half, -half, half, half, -half, half];
}

// 8. Dos secciones iguales **son** una extrusión. Con `samples: 4` el remuestreo
//    por longitud de arco devuelve las cuatro esquinas intactas, así que la
//    igualdad es exacta: si algún día deja de serlo, es que el remuestreo mueve
//    puntos que no debía tocar.
{
  const side = 1.4;
  const height = 0.9;
  const extrusion = auditMesh(extruded({ extrude: square(side), height }));
  const loft = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            loft: [
              { at: [0, -height / 2, 0], profile: square(side) },
              { at: [0, height / 2, 0], profile: square(side) },
            ],
            samples: 4,
          },
        },
      ],
    }),
  );
  assert.equal(loft.signedVolume, extrusion.signedVolume);
  assert.deepEqual(loft.boundingBoxMin, extrusion.boundingBoxMin);
  assert.deepEqual(loft.boundingBoxMax, extrusion.boundingBoxMax);
  assert.equal(loft.triangles, extrusion.triangles);
  assert.equal(loft.watertight, true);
  assert.equal(loft.degenerateTriangles, 0);
  assert.equal(loft.inverted, false);
  console.log(
    `geometria: ok (loft de dos secciones iguales ≡ extrusión: ${loft.signedVolume}, ` +
      `${loft.triangles} triángulos, misma caja)`,
  );
}

// 9. Tronco: el volumen de un prismatoide de secciones A y k²A es h·A·(1+k+k²)/3.
//    Las caras laterales son trapecios planos, así que la triangulación no
//    introduce error y la igualdad es exacta hasta la coma flotante.
for (const [k, height] of [
  [0.5, 2],
  [0.25, 1],
  [1.75, 0.6],
]) {
  const loft = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            loft: [
              { at: [0, 0, 0], profile: square(1) },
              { at: [0, height, 0], profile: square(1), scale: k },
            ],
            samples: 4,
          },
        },
      ],
    }),
  );
  const expected = (height * (1 + k + k * k)) / 3;
  assert.ok(
    Math.abs(loft.signedVolume - expected) < 1e-6,
    `tronco k=${k}: ${loft.signedVolume} frente a ${expected}`,
  );
}
console.log("geometria: ok (tronco h·A·(1+k+k²)/3, tres k distintos)");

// 10. Loft de círculos ≡ cilindro. Se comparan los volúmenes y no los arrays:
//     los dos generadores reparten sus vértices de otra forma y eso no es fallo.
{
  const points = 32;
  const radius = 0.8;
  const height = 1.5;
  const loft = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            loft: [
              { at: [0, -height / 2, 0], profile: createCircleProfile(radius, points) },
              { at: [0, height / 2, 0], profile: createCircleProfile(radius, points) },
            ],
          },
        },
      ],
    }),
  );
  const cylinder = auditMesh(
    meshOf({ objects: [{ geometry: { primitive: "cylinder", parameters: [radius, height] } }] }),
  );
  assert.equal(loft.signedVolume, cylinder.signedVolume);
  assert.ok(Math.abs(loft.signedVolume - regularArea(points, radius) * height) < 1e-6);
  console.log(
    `geometria: ok (loft de círculos ≡ cilindro: ${loft.signedVolume} por los dos caminos)`,
  );
}

// 11. Tapas: lo que se deja abierto se cuenta, y no se cierra por iniciativa propia.
{
  const samples = 12;
  const bordes = (caps) =>
    auditMesh(
      meshOf({
        objects: [
          {
            geometry: {
              loft: [
                { at: [0, 0, 0], profile: createCircleProfile(1, 24) },
                { at: [0, 1, 0], profile: createCircleProfile(1, 24) },
              ],
              samples,
              caps,
            },
          },
        ],
      }),
    );
  assert.equal(bordes("both").boundaryEdges, 0);
  assert.equal(bordes("both").watertight, true);
  assert.equal(bordes("none").boundaryEdges, samples * 2);
  assert.equal(bordes("none").watertight, false);
  assert.equal(bordes("start").boundaryEdges, samples);
  assert.equal(bordes("end").boundaryEdges, samples);
  console.log(`geometria: ok (tapas: 0, ${samples * 2}, ${samples} y ${samples} aristas de borde)`);
}

// 12. El sentido de escritura no cambia la pieza. Ni el del polígono ni el de la
//     lista de secciones: se ordena la entrada en vez de confiar en ella.
{
  const height = 0.7;
  const derecho = meshOf({
    objects: [
      {
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: square(1) },
            { at: [0, height, 0], profile: square(1), scale: 0.5 },
          ],
          samples: 4,
        },
      },
    ],
  });
  // El mismo cuadrado escrito en sentido horario, y la lista de arriba abajo.
  const alReves = meshOf({
    objects: [
      {
        geometry: {
          loft: [
            { at: [0, height, 0], profile: [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5], scale: 0.5 },
            { at: [0, 0, 0], profile: square(1) },
          ],
          samples: 4,
        },
      },
    ],
  });
  assert.deepEqual(alReves.positions, derecho.positions);
  assert.deepEqual(alReves.indices, derecho.indices);
  const audit = auditMesh(alReves);
  assert.ok(audit.signedVolume > 0, `escrito al revés el volumen sigue positivo: ${audit.signedVolume}`);
  assert.equal(audit.inverted, false);
  console.log(`geometria: ok (polígono horario y lista invertida dan la misma malla, volumen ${audit.signedVolume})`);
}

// 13. Remuestreo entre secciones de distinto número de puntos. La forma está
//     retorcida a propósito —es el caso que cazará SECCIONES_INCOMPATIBLES—; lo
//     que se juzga aquí es que la topología aguante.
{
  const audit = auditMesh(
    meshOf({
      profiles: [
        { name: "raiz", circle: 0.3, points: 24 },
        { name: "punta", naca: "2412", chord: 0.6, points: 64 },
      ],
      objects: [
        {
          geometry: {
            loft: [
              { at: [0, 0, 0], profile: "raiz" },
              { at: [0, 1.1, 0], profile: "punta" },
            ],
            samples: 48,
          },
        },
      ],
    }),
  );
  assert.equal(audit.watertight, true);
  assert.equal(audit.degenerateTriangles, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.inverted, false);
  console.log("geometria: ok (24 puntos cosidos con 64 a 48 muestras, malla estanca)");
}

// 14. Perfil por nombre en una sección ≡ polígono en línea.
{
  const polygon = createNacaProfile("2412", 0.5, 32);
  const porNombre = meshOf({
    profiles: [{ name: "ala", naca: "2412", chord: 0.5, points: 32 }],
    objects: [
      {
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: "ala" },
            { at: [0, 1, 0], profile: "ala", scale: 0.4, twist: 12 },
          ],
        },
      },
    ],
  });
  const enLinea = meshOf({
    objects: [
      {
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: polygon },
            { at: [0, 1, 0], profile: polygon, scale: 0.4, twist: 12 },
          ],
        },
      },
    ],
  });
  assert.deepEqual(porNombre.positions, enLinea.positions);
  assert.deepEqual(porNombre.indices, enLinea.indices);
  console.log("geometria: ok (perfil por nombre en una sección ≡ polígono en línea)");
}

// 15. Errores del loft, por su motivo.
{
  const conLoft = (loft, extra = {}) => ({ objects: [{ geometry: { loft, ...extra } }] });
  const casos = [
    [conLoft([{ at: [0, 0, 0], profile: square(1) }]), /un loft necesita al menos dos secciones/],
    [
      conLoft(
        [
          { at: [0, 0, 0], profile: square(1) },
          { at: [0, 1, 0], profile: square(1) },
        ],
        { samples: 2 },
      ),
      /samples debe ser al menos 3, no 2/,
    ],
    [
      conLoft([
        { at: [0, 0, 0], profile: square(1) },
        { at: [0, 0, 0], profile: square(1) },
      ]),
      /las secciones 0 y 1 están en la misma posición/,
    ],
    [
      conLoft([
        { at: [0, 0], profile: square(1) },
        { at: [0, 1, 0], profile: square(1) },
      ]),
      /loft\[0\]\.at debe ser number\[3\]/,
    ],
    [
      conLoft([
        { at: [0, 0, 0], profile: square(1), scale: 0 },
        { at: [0, 1, 0], profile: square(1) },
      ]),
      /la escala de la sección 0 debe ser positiva/,
    ],
    [
      conLoft([
        { at: [0, 0, 0], profile: "ala" },
        { at: [0, 1, 0], profile: square(1) },
      ]),
      /no hay ningún perfil llamado "ala"/,
    ],
  ];
  for (const [scene, expected] of casos) {
    assert.throws(() => resolveScene(scene), expected, `no se rechazó por su motivo: ${expected}`);
  }
  console.log(`geometria: ok (${casos.length} loft mal escritos rechazados por su motivo)`);
}

// 16. La API pública y el documento hacen lo mismo. `createLoft` se exporta, así
//     que hay quien lo va a llamar sin pasar por una escena.
{
  const directo = createLoft(
    [
      { position: [0, 0, 0], polygon: square(1) },
      { position: [0, 1, 0], polygon: square(1), scale: [0.5, 0.5], twist: Math.PI / 6 },
    ],
    { samples: 4 },
  );
  const porEscena = meshOf({
    objects: [
      {
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: square(1) },
            { at: [0, 1, 0], profile: square(1), scale: 0.5, twist: 30 },
          ],
          samples: 4,
        },
      },
    ],
  });
  assert.deepEqual(directo.positions, porEscena.positions);
  assert.deepEqual(directo.indices, porEscena.indices);
  console.log("geometria: ok (createLoft por API ≡ por documento, con los grados convertidos)");
}

// ---------------------------------------------------------------------------
// Sweep: perfil barrido por un recorrido.
// ---------------------------------------------------------------------------

/** `count` puntos repartidos por una circunferencia de radio `radius` en el plano XZ. */
function ring(radius, count) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
  }
  return points;
}

// 17. Recorrido recto: el volumen es el área del polígono inscrito por la longitud.
for (const [points, radius, length] of [
  [24, 0.2, 2],
  [9, 0.55, 0.4],
]) {
  const audit = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            sweep: createCircleProfile(radius, points),
            path: { through: [[0, 0, 0], [0, length, 0]], kind: "polyline" },
            stations: 2,
          },
        },
      ],
    }),
  );
  const expected = regularArea(points, radius) * length;
  assert.ok(
    Math.abs(audit.signedVolume - expected) < 1e-6,
    `barrido recto de ${points} puntos: ${audit.signedVolume} frente a ${expected}`,
  );
  assert.equal(audit.watertight, true);
  assert.equal(audit.degenerateTriangles, 0);
  assert.equal(audit.inverted, false);
}
console.log("geometria: ok (barrido recto ≡ ½·n·r²·sin(2π/n)·L, dos resoluciones)");

// 18. Recorrido circular cerrado ≡ toro, a la misma teselación. Es la afirmación
//     de que el barrido generaliza el revolucionado, medida en vez de dicha.
{
  const major = 48;
  const minor = 24;
  const R = 1;
  const r = 0.35;
  const barrido = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            sweep: createCircleProfile(r, minor),
            path: { through: ring(R, major), kind: "polyline", closed: true },
            stations: major,
          },
        },
      ],
    }),
  );
  const toro = auditMesh(
    meshOf({ objects: [{ geometry: { primitive: "torus", parameters: [R, r] } }] }),
  );
  assert.equal(barrido.signedVolume, toro.signedVolume);
  assert.equal(barrido.triangles, toro.triangles);
  assert.equal(barrido.watertight, true);
  assert.equal(barrido.boundaryEdges, 0);
  assert.equal(barrido.nonManifoldEdges, 0);
  assert.equal(barrido.inverted, false);
  console.log(`geometria: ok (barrido cerrado ≡ toro: ${barrido.signedVolume} y ${barrido.triangles} triángulos por los dos caminos)`);
}

// 19. La costura de un cerrado cierra de verdad. Que `boundaryEdges` sea cero no
//     lo demuestra —la costura está soldada por posición pase lo que pase—; lo que
//     lo demuestra es que el marco vuelva alineado. Sin repartir el residuo, la
//     normal de la última estación no coincide con la de la primera.
{
  const residuoDe = (puntos) => {
    const { stations, u } = sweepStations(puntos, { closed: true, stations: 40 });
    const residuo = stations[stations.length - 1].twist / (u[u.length - 1] || 1);
    return { stations, u, residuo };
  };

  // Verdad conocida: un lazo **plano** tiene holonomía nula, así que el marco
  // vuelve solo y el residuo es cero exacto. Si saliera distinto de cero, el
  // medidor estaría midiendo su propio ruido.
  // `Math.abs` porque un cero negativo es cero: `strictEqual` distingue -0 de 0.
  assert.equal(Math.abs(residuoDe(ring(1, 8)).residuo), 0);

  // Y uno torcido de verdad sí acumula giro. Sin repartirlo, la costura del tubo
  // queda desalineada por esta cantidad.
  const torcido = residuoDe([
    [1, 0, 0],
    [0.3, 0.9, 0.6],
    [-0.7, 0.2, 1.1],
    [-1.1, -0.6, 0.1],
    [-0.2, 0.4, -0.9],
    [0.8, -0.5, -0.7],
  ]);
  assert.ok(
    Math.abs(torcido.residuo) > 0.1,
    `un lazo torcido tiene que acumular giro, y acumuló ${torcido.residuo}`,
  );
  assert.equal(Math.abs(torcido.stations[0].twist), 0, "la primera estación no lleva corrección");
  // El reparto es lineal en u, estación a estación.
  for (const index of [7, 20, 33, 39]) {
    assert.ok(
      Math.abs(torcido.stations[index].twist - torcido.residuo * torcido.u[index]) < 1e-12,
      `el residuo se reparte lineal en u; falla en la estación ${index}`,
    );
  }
  console.log(
    `geometria: ok (holonomía: lazo plano 0 exacto, lazo torcido ` +
      `${((torcido.residuo * 180) / Math.PI).toFixed(2)}° repartidos lineal en u)`,
  );
}

// 20. Un tramo recto no lleva torsión. Es lo que compra el transporte paralelo:
//     con Frenet, el marco gira donde la curvatura tiende a cero.
{
  const { stations } = sweepStations(
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
      [0, 3, 0],
      [0.8, 3.8, 0.5],
    ],
    { kind: "polyline", stations: 40 },
  );
  // Las del tramo recto, **sin la esquina**: la estación que cae justo sobre el
  // punto de quiebro tiene tangente promediada entre los dos tramos, así que gira
  // con razón. Lo que se juzga es que las anteriores no giren.
  const rectas = stations.filter(
    (station) => station.position[0] === 0 && station.position[2] === 0 && station.position[1] < 2.9,
  );
  assert.ok(rectas.length > 10, `el tramo recto tiene ${rectas.length} estaciones`);
  for (const station of rectas) {
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(
        Math.abs(station.normal[axis] - rectas[0].normal[axis]) < 1e-12,
        `el tramo recto no debe girar: ${station.normal} frente a ${rectas[0].normal}`,
      );
    }
  }
  console.log(`geometria: ok (${rectas.length} estaciones de tramo recto sin un grado de torsión)`);
}

// 21. Tablas de variación.
{
  assert.equal(evaluateVariation(0.42, 0.7), 0.42);
  const tabla = { at: [[0, 10], [0.5, 20], [1, 0]] };
  assert.equal(evaluateVariation(tabla, 0), 10);
  assert.equal(evaluateVariation(tabla, 0.5), 20);
  assert.equal(evaluateVariation(tabla, 1), 0);
  assert.equal(evaluateVariation(tabla, 0.25), 15);
  // Sujeción fuera del rango, no extrapolación: extrapolar daría radios negativos.
  assert.equal(evaluateVariation(tabla, -3), 10);
  assert.equal(evaluateVariation(tabla, 7), 0);
  // `smooth` es Hermite con tangentes nulas: en el punto medio vale la media.
  assert.equal(evaluateVariation({ at: [[0, 0], [1, 8]], ease: "smooth" }, 0.5), 4);
  assert.ok(evaluateVariation({ at: [[0, 0], [1, 8]], ease: "smooth" }, 0.25) < 2);
  // `power:k` interpola en t^k.
  assert.ok(
    Math.abs(evaluateVariation({ at: [[0, 0], [1, 1]], ease: "power:0.5" }, 0.25) - 0.5) < 1e-15,
  );
  const malas = [
    [{ at: [[0, 1], [0.5, 2], [0.5, 3]] }, /va en orden creciente de u y sin repetir/],
    [{ at: [[1, 1], [0, 2]] }, /va en orden creciente de u/],
    [{ at: [] }, /necesita al menos un par/],
    [{ at: [[0, 1, 2]] }, /son dos números/],
    [{ at: [[0, 1], [1, 2]], ease: "bounce" }, /ease desconocido "bounce"/],
    [{ at: [[0, 1], [1, 2]], ease: "power:0" }, /exponente de `power:0` debe ser un número positivo/],
  ];
  for (const [spec, expected] of malas) {
    assert.throws(() => evaluateVariation(spec, 0.5), expected, `no se rechazó: ${expected}`);
  }
  console.log(`geometria: ok (tablas de variación: nudos, sujeción, tres eases, ${malas.length} malas)`);
}

// 22. Radio variable: un cono barrido. El valor esperado es la suma exacta de los
//     troncos, porque cada cuadrilátero del costado es plano.
{
  const points = 32;
  const stations = 17;
  const length = 2;
  const audit = auditMesh(
    meshOf({
      objects: [
        {
          geometry: {
            sweep: createCircleProfile(1, points),
            path: { through: [[0, 0, 0], [0, length, 0]], kind: "polyline" },
            radius: { at: [[0, 1], [1, 0]] },
            stations,
          },
        },
      ],
    }),
  );
  const area = regularArea(points, 1);
  const step = length / (stations - 1);
  let expected = 0;
  for (let index = 0; index < stations - 1; index += 1) {
    const a = 1 - index / (stations - 1);
    const b = 1 - (index + 1) / (stations - 1);
    expected += (step / 3) * area * (a * a + a * b + b * b);
  }
  assert.ok(
    Math.abs(audit.signedVolume - expected) < 1e-6,
    `cono barrido: ${audit.signedVolume} frente a ${expected}`,
  );
  // Y se acerca a ⅓·área·L, que es el cono continuo.
  assert.ok(Math.abs(expected - (area * length) / 3) < 0.01);
  console.log(
    `geometria: ok (cono barrido ${audit.signedVolume}, suma exacta de troncos, hacia ⅓·área·L)`,
  );
}

// 23. BARRIDO_AUTOINTERSECADO: el codo que se come a sí mismo.
{
  const codo = (radius) => ({
    objects: [
      {
        name: "codo",
        geometry: {
          sweep: createCircleProfile(1, 16),
          path: { through: ring(0.5, 6), kind: "polyline", closed: true },
          radius,
          stations: 24,
        },
      },
    ],
  });
  const gordo = auditGeometry(codo(0.9));
  assert.equal(gordo.length, 1, "un codo con radio mayor que su curvatura tiene que avisar");
  assert.equal(gordo[0].code, "BARRIDO_AUTOINTERSECADO");
  assert.equal(gordo[0].part, "codo");
  assert.match(gordo[0].message, /en la estación \d+ el radio es 0\.9000/);
  assert.match(gordo[0].message, /Cabe hasta \d+\.\d+/);
  assert.match(gordo[0].message, /certeza, no candidato/);
  assert.equal(auditGeometry(codo(0.05)).length, 0, "con radio pequeño no debe avisar");
  // Y un aviso por pieza, no uno por estación.
  assert.equal(auditGeometry(codo(2)).length, 1);
  console.log(`geometria: ok (BARRIDO_AUTOINTERSECADO: «${gordo[0].message.slice(0, 68)}…»)`);
}

// 24. Tapas, y que un recorrido cerrado no las tiene ni aunque se pidan.
{
  const points = 16;
  const bordes = (caps, closed) =>
    auditMesh(
      meshOf({
        objects: [
          {
            geometry: {
              sweep: createCircleProfile(0.2, points),
              path: closed
                ? { through: ring(1, 8), kind: "polyline", closed: true }
                : { through: [[0, 0, 0], [0, 1, 0]], kind: "polyline" },
              stations: closed ? 8 : 2,
              caps,
            },
          },
        ],
      }),
    );
  assert.equal(bordes("both", false).boundaryEdges, 0);
  assert.equal(bordes("none", false).boundaryEdges, points * 2);
  assert.equal(bordes("start", false).boundaryEdges, points);
  assert.equal(bordes("end", false).boundaryEdges, points);
  assert.equal(bordes("both", true).boundaryEdges, 0);
  assert.equal(bordes("none", true).boundaryEdges, 0, "un cerrado no tiene extremos que tapar");
  console.log(`geometria: ok (tapas del barrido: 0, ${points * 2}, ${points}, ${points}; y el cerrado sin extremos)`);
}

// 25. Errores del barrido, por su motivo.
{
  const casos = [
    [
      { objects: [{ geometry: { sweep: createCircleProfile(1, 8), path: { through: [[0, 0, 0]] } } }] },
      /un recorrido necesita al menos dos puntos/,
    ],
    [
      {
        objects: [
          {
            geometry: {
              sweep: createCircleProfile(1, 8),
              path: { through: [[0, 0, 0], [0, 0, 0], [1, 0, 0]], kind: "polyline" },
            },
          },
        ],
      },
      /los puntos 0 y 1 del recorrido son el mismo/,
    ],
    [
      {
        objects: [
          {
            geometry: {
              sweep: createCircleProfile(1, 8),
              path: { through: [[0, 0, 0], [0, 1, 0]] },
              stations: 1,
            },
          },
        ],
      },
      /stations debe ser al menos 2, no 1/,
    ],
    [
      {
        objects: [
          { geometry: { sweep: "brazo", path: { through: [[0, 0, 0], [0, 1, 0]] } } },
        ],
      },
      /no hay ningún perfil llamado "brazo"/,
    ],
    [
      {
        objects: [
          {
            geometry: {
              sweep: createCircleProfile(1, 8),
              path: { through: [[0, 0], [0, 1, 0]], kind: "polyline" },
            },
          },
        ],
      },
      /el punto 0 del recorrido son tres números/,
    ],
  ];
  for (const [scene, expected] of casos) {
    assert.throws(() => resolveScene(scene), expected, `no se rechazó por su motivo: ${expected}`);
  }
  console.log(`geometria: ok (${casos.length} barridos mal escritos rechazados por su motivo)`);
}

// ---------------------------------------------------------------------------
// Deformadores.
// ---------------------------------------------------------------------------

function deformed(geometry, deform) {
  return meshOf({ objects: [{ name: "pieza", geometry, deform }] });
}

const CILINDRO = { primitive: "cylinder", parameters: [0.4, 2] };

// 26. `twist` conserva el volumen firmado, **exacto**. Cada rebanada gira
//     rígidamente, así que el volumen no puede cambiar: si el número se mueve, el
//     deformador está mal.
{
  const recto = auditMesh(meshOf({ objects: [{ geometry: CILINDRO }] }));
  for (const degrees of [30, 120, -270]) {
    const torcido = auditMesh(deformed(CILINDRO, [{ twist: { axis: "y", degrees } }]));
    assert.equal(
      torcido.signedVolume,
      recto.signedVolume,
      `torcer ${degrees}° no puede cambiar el volumen`,
    );
    assert.equal(torcido.watertight, true);
    assert.equal(torcido.degenerateTriangles, 0);
    assert.equal(torcido.inverted, false);
  }
  console.log(`geometria: ok (twist conserva el volumen: ${recto.signedVolume} con 30°, 120° y −270°)`);
}

// 27. `twist` y `wave` son reversibles, y el parámetro neutro es la identidad
//     **bit a bit**.
//
//     La ida y vuelta vuelve dentro de la precisión de `Float32`, no bit a bit, y
//     el motivo no es el deformador: las posiciones viven en un `Float32Array`, así
//     que el estado intermedio se redondea a 32 bits y la segunda pasada ya no
//     opera sobre el mismo número. Lo que sí es exacto —y es lo que de verdad se
//     está comprobando— es que la segunda pasada ve **la misma caja**: ni la
//     torsión ni la ondulación cambian la extensión del eje que define `u`, así que
//     el error se queda en el redondeo y no crece.
{
  const original = meshOf({ objects: [{ geometry: CILINDRO }] });
  const maximaDiferencia = (mesh) => {
    let peor = 0;
    for (let index = 0; index < mesh.positions.length; index += 1) {
      peor = Math.max(peor, Math.abs(mesh.positions[index] - original.positions[index]));
    }
    return peor;
  };

  const torsion = maximaDiferencia(
    deformed(CILINDRO, [
      { twist: { axis: "y", degrees: 140 } },
      { twist: { axis: "y", degrees: -140 } },
    ]),
  );
  assert.ok(torsion < 1e-6, `la ida y vuelta de torsión se desvía ${torsion}`);

  const onda = maximaDiferencia(
    deformed(CILINDRO, [
      { wave: { axis: "y", along: "z", amplitude: 0.15, cycles: 3 } },
      { wave: { axis: "y", along: "z", amplitude: -0.15, cycles: 3 } },
    ]),
  );
  assert.ok(onda < 1e-6, `la ida y vuelta de ondulación se desvía ${onda}`);

  // Los parámetros neutros sí salen idénticos, y esos sí bit a bit: `cos 0` es 1,
  // `sin 0` es 0, sumar cero no mueve un float, y el doblado a cero ni entra.
  assert.deepEqual(deformed(CILINDRO, [{ wave: { axis: "y", along: "z", amplitude: 0 } }]).positions, original.positions);
  assert.deepEqual(deformed(CILINDRO, [{ bend: { axis: "y", into: "x", degrees: 0 } }]).positions, original.positions);
  assert.deepEqual(deformed(CILINDRO, [{ twist: { axis: "y", degrees: 0 } }]).positions, original.positions);
  console.log(
    `geometria: ok (ida y vuelta: torsión ${torsion.toExponential(1)}, onda ${onda.toExponential(1)}; ` +
      "el parámetro neutro es la identidad bit a bit)",
  );
}

// 28. `taper` multiplica el volumen por (1+k+k²)/3 con una rampa lineal de 1 a k.
//     Es el mismo número del tronco del loft, y no es casualidad.
for (const k of [0.4, 0.75]) {
  const recto = auditMesh(meshOf({ objects: [{ geometry: CILINDRO }] }));
  const afinado = auditMesh(
    deformed(CILINDRO, [{ taper: { axis: "y", scale: { at: [[0, 1], [1, k]] } } }]),
  );
  const expected = recto.signedVolume * ((1 + k + k * k) / 3);
  assert.ok(
    Math.abs(afinado.signedVolume - expected) < 1e-6,
    `taper k=${k}: ${afinado.signedVolume} frente a ${expected}`,
  );
  // Con la rampa, el extremo ancho no se toca y el radio envolvente no tiene por
  // qué bajar. Quien lo baja es un afinado constante, que encoge toda la pieza.
  const uniforme = auditMesh(deformed(CILINDRO, [{ taper: { axis: "y", scale: k } }]));
  assert.ok(
    uniforme.boundingRadius < recto.boundingRadius,
    `al encoger entera, el radio envolvente baja: ${uniforme.boundingRadius} frente a ${recto.boundingRadius}`,
  );
  assert.ok(Math.abs(uniforme.signedVolume - recto.signedVolume * k * k) < 1e-6);
}
console.log("geometria: ok (taper multiplica el volumen por (1+k+k²)/3, dos k)");

// 29. `bend` deja el eje sobre un arco: todo vértice cae en la corona de radios
//     [R−r, R+r]. Exacto y por vértice.
{
  const radius = 0.4;
  const length = 2;
  const degrees = 75;
  const doblado = deformed({ primitive: "cylinder", parameters: [radius, length] }, [
    { bend: { axis: "y", into: "x", degrees } },
  ]);
  const R = length / (degrees * (Math.PI / 180));
  // El mínimo del eje antes de doblar: el cilindro está centrado en el origen.
  const minimum = -length / 2;
  let dentro = 0;
  for (let vertex = 0; vertex < doblado.positions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const arco = Math.hypot(doblado.positions[offset + 1] - minimum, R - doblado.positions[offset]);
    assert.ok(
      arco >= R - radius - 1e-6 && arco <= R + radius + 1e-6,
      `el vértice ${vertex} se sale del arco: ${arco} fuera de [${R - radius}, ${R + radius}]`,
    );
    dentro += 1;
  }
  const audit = auditMesh(doblado);
  assert.equal(audit.watertight, true);
  assert.equal(audit.degenerateTriangles, 0);
  console.log(`geometria: ok (bend: ${dentro} vértices en la corona [${(R - radius).toFixed(3)}, ${(R + radius).toFixed(3)}])`);
}

// 30. El orden importa, y se comprueba a propósito.
{
  const torcerDoblar = deformed(CILINDRO, [
    { twist: { axis: "y", degrees: 90 } },
    { bend: { axis: "y", into: "x", degrees: 45 } },
  ]);
  const doblarTorcer = deformed(CILINDRO, [
    { bend: { axis: "y", into: "x", degrees: 45 } },
    { twist: { axis: "y", degrees: 90 } },
  ]);
  assert.notDeepEqual(torcerDoblar.positions, doblarTorcer.positions);
  console.log("geometria: ok (torcer y doblar ≠ doblar y torcer)");
}

// 31. Coherencia de la malla después de deformar: es donde están los fallos
//     silenciosos.
{
  const cadena = [
    { twist: { axis: "y", degrees: 120 } },
    { taper: { axis: "y", scale: { at: [[0, 1], [1, 0.4]] } } },
    { bend: { axis: "y", into: "x", degrees: 30 } },
    { wave: { axis: "y", along: "z", amplitude: 0.02, cycles: 3 } },
  ];
  const mesh = deformed(CILINDRO, cadena);
  assert.equal(mesh.faceNormals, undefined, "la caché de normales de cara hay que borrarla");
  // Solo los vértices que usa algún triángulo: `createCylinder` deja dos sueltos
  // que no referencia nadie, y su normal es cero desde antes de deformar. Es
  // desperdicio suyo, no del deformador, y no se toca aquí.
  const usados = new Set(mesh.indices);
  let maximo = 0;
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    if (usados.has(vertex)) {
      const longitud = Math.hypot(mesh.normals[offset], mesh.normals[offset + 1], mesh.normals[offset + 2]);
      assert.ok(Math.abs(longitud - 1) < 1e-6, `la normal del vértice ${vertex} no es unitaria: ${longitud}`);
    }
    maximo = Math.max(maximo, Math.hypot(mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]));
  }
  assert.ok(
    Math.abs(mesh.boundingRadius - maximo) < 1e-6,
    `el radio envolvente quedó viejo: ${mesh.boundingRadius} frente a ${maximo}`,
  );
  const audit = auditMesh(mesh);
  assert.equal(audit.watertight, true, "deformar no cambia la conectividad");
  assert.equal(audit.degenerateTriangles, 0);
  console.log("geometria: ok (tras la cadena de cuatro: caché borrada, normales unitarias, radio al día, estanca)");
}

// 32. La misma cadena sobre cualquier geometría.
{
  const cadena = [
    { twist: { axis: "y", degrees: 60 } },
    { taper: { axis: "y", scale: { at: [[0, 1], [1, 0.6]] } } },
  ];
  const geometrias = [
    CILINDRO,
    {
      loft: [
        { at: [0, 0, 0], profile: createCircleProfile(0.5, 24) },
        { at: [0, 1.5, 0], profile: createCircleProfile(0.3, 24) },
      ],
    },
    {
      sweep: createCircleProfile(0.2, 16),
      path: { through: [[0, 0, 0], [0, 1.5, 0]], kind: "polyline" },
      stations: 8,
    },
  ];
  for (const [index, geometry] of geometrias.entries()) {
    const audit = auditMesh(deformed(geometry, cadena));
    assert.equal(audit.watertight, true, `la geometría ${index} dejó de ser estanca`);
    assert.equal(audit.inverted, false);
    assert.equal(audit.degenerateTriangles, 0);
  }
  console.log(`geometria: ok (la misma cadena sobre ${geometrias.length} geometrías distintas)`);
}

// 33. Errores de los deformadores, por su motivo, y con el nombre de la pieza.
{
  const conDeform = (deform) => ({ objects: [{ name: "pala", geometry: CILINDRO, deform }] });
  const casos = [
    [conDeform([{ bend: { axis: "y", into: "y", degrees: 30 } }]), /pala: la deformación 0: bend\.into \("y"\) no puede ser el propio eje/],
    [conDeform([{ wave: { axis: "y", along: "y", amplitude: 1 } }]), /wave\.along \("y"\) no puede ser el propio eje/],
    [conDeform([{ twist: { axis: "w", degrees: 30 } }]), /el eje es "x", "y" o "z", no "w"/],
    [conDeform([{ twist: { axis: "y", degrees: 1 }, taper: { axis: "y", scale: 1 } }]), /declara 2 \(twist y taper\); declara una/],
    [conDeform([{}]), /no declara ninguna; admitidas: twist, taper, bend, wave/],
    [
      conDeform([{ taper: { axis: "y", scale: { at: [[1, 1], [0, 2]] } } }]),
      /pala: la deformación 0 \(taper\.scale\): `at` va en orden creciente de u/,
    ],
  ];
  for (const [scene, expected] of casos) {
    assert.throws(() => resolveScene(scene), expected, `no se rechazó por su motivo: ${expected}`);
  }
  console.log(`geometria: ok (${casos.length} deformadores mal escritos rechazados por su motivo)`);
}

// ---------------------------------------------------------------------------
// Repetición: radial y espejo.
// ---------------------------------------------------------------------------

/**
 * Posiciones en mundo de una pieza resuelta: matriz por malla.
 *
 * `math.ts` guarda las matrices **por filas** —`translation` deja la traslación en
 * 3, 7 y 11—, así que la fila `r` empieza en `m[r*4]`. Leerlas por columnas da un
 * resultado que parece plausible y no lo es.
 */
function worldPositions({ node }) {
  const { mesh, model: m } = node;
  const out = new Float64Array(mesh.positions.length);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const [x, y, z] = [mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]];
    out[offset + 0] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[offset + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[offset + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/** Determinante 3×3 de la parte lineal, con la matriz leída por filas. */
function linearDeterminant(m) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

const PALA = { primitive: "box", parameters: [0.1, 0.4, 1.2] };

// 34. Cuenta, nombres y orden.
{
  const radial = resolveScene({
    objects: [{ name: "pala", geometry: PALA, position: [0, 0, 0.8], repeat: { radial: { count: 4 } } }],
  });
  assert.deepEqual(radial.map((copy) => copy.name), ["pala-1", "pala-2", "pala-3", "pala-4"]);

  const espejo = resolveScene({
    objects: [{ name: "ala", geometry: PALA, position: [1.2, 0, 0], repeat: { mirror: "x" } }],
  });
  assert.deepEqual(espejo.map((copy) => copy.name), ["ala-1", "ala-2"]);

  const suelta = resolveScene({ objects: [{ name: "ala", geometry: PALA }] });
  assert.deepEqual(suelta.map((copy) => copy.name), ["ala"], "sin repeat el nombre no se toca");
  console.log("geometria: ok (repeat numera pala-1…pala-4 y ala-1/ala-2; sin repeat no numera)");
}

// 35. Las cuatro matrices son exactas, y la malla se comparte.
{
  const escena = {
    objects: [{ name: "pala", geometry: PALA, position: [0, 0, 0.8], repeat: { radial: { count: 4 } } }],
  };
  const copias = resolveScene(escena);
  const base = resolveScene({ objects: [{ name: "pala", geometry: PALA, position: [0, 0, 0.8] }] })[0];

  for (const [copy, resuelta] of copias.entries()) {
    const angle = (copy * 2 * Math.PI) / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // `rotationY(2πi/4) · M`, calculada aparte y a mano, por filas: la fila 0 del
    // producto es `cos·fila0 + sin·fila2` y la fila 2 es `−sin·fila0 + cos·fila2`.
    // Es lo que distingue calcular el ángulo de acumularlo copia a copia.
    const m = base.node.model;
    for (let column = 0; column < 4; column += 1) {
      const first = m[column];
      const middle = m[4 + column];
      const third = m[8 + column];
      assert.ok(Math.abs(resuelta.node.model[column] - (cos * first + sin * third)) < 1e-15);
      assert.ok(Math.abs(resuelta.node.model[4 + column] - middle) < 1e-15);
      assert.ok(Math.abs(resuelta.node.model[8 + column] - (-sin * first + cos * third)) < 1e-15);
    }
    // La misma malla, por identidad: clonarla cuatro veces sería tirar memoria y
    // romper el agrupado de mallas repetidas del exportador.
    assert.equal(resuelta.node.mesh, copias[0].node.mesh);
  }
  console.log("geometria: ok (4 matrices radiales exactas a 2πi/4, y una sola malla compartida)");
}

// 36. El espejo refleja de verdad, y sin disparar avisos falsos.
{
  const [izquierda, derecha] = resolveScene({
    objects: [
      {
        name: "ala",
        geometry: PALA,
        position: [1.2, 0.3, 0],
        rotation: [0, 25, 0],
        repeat: { mirror: "x" },
      },
    ],
  });
  const original = worldPositions(izquierda);
  const reflejada = worldPositions(derecha);
  let peor = 0;
  for (let vertex = 0; vertex < original.length / 3; vertex += 1) {
    const offset = vertex * 3;
    peor = Math.max(
      peor,
      Math.abs(reflejada[offset] + original[offset]),
      Math.abs(reflejada[offset + 1] - original[offset + 1]),
      Math.abs(reflejada[offset + 2] - original[offset + 2]),
    );
  }
  assert.ok(peor < 1e-6, `el espejo no refleja: desviación ${peor}`);

  const auditoriaOriginal = auditMesh(izquierda.node.mesh);
  const auditoriaCopia = auditMesh(derecha.node.mesh);
  assert.equal(auditoriaCopia.signedVolume, auditoriaOriginal.signedVolume);
  assert.ok(auditoriaCopia.signedVolume > 0, "la copia no puede tener volumen negativo");
  assert.equal(auditoriaCopia.inverted, false, "un espejo bien hecho no es una malla del revés");
  assert.equal(auditoriaCopia.watertight, auditoriaOriginal.watertight);
  // Determinante positivo en las dos: es lo que mantiene vivo el descarte barato.
  assert.ok(linearDeterminant(izquierda.node.model) > 0);
  assert.ok(linearDeterminant(derecha.node.model) > 0, "la matriz va conjugada, no reflejada");
  console.log(
    `geometria: ok (espejo exacto a ${peor.toExponential(1)}, volumen ${auditoriaCopia.signedVolume} positivo, determinantes > 0)`,
  );
}

// 37. `repeat` va después de `deform`: las copias salen ya deformadas.
{
  const cadena = [{ twist: { axis: "y", degrees: 90 } }];
  const [copia] = resolveScene({
    objects: [{ name: "pala", geometry: CILINDRO, deform: cadena, repeat: { radial: { count: 3 } } }],
  });
  const sola = resolveScene({ objects: [{ name: "pala", geometry: CILINDRO, deform: cadena }] })[0];
  assert.deepEqual(copia.node.mesh.positions, sola.node.mesh.positions);
  console.log("geometria: ok (las copias salen ya deformadas: deform primero, repeat después)");
}

// 38. `repeat` equivale a escribirlo a mano. No hace falta renderizar para
//     saberlo: matrices y posiciones **son** lo que se rasteriza.
{
  const conRepeat = resolveScene({
    objects: [{ name: "pala", geometry: PALA, position: [0, 0, 0.8], repeat: { radial: { count: 4 } } }],
  });
  const aMano = resolveScene({
    objects: [0, 1, 2, 3].map((copy) => ({
      name: `pala-${copy + 1}`,
      geometry: PALA,
      position: [0.8 * Math.sin((copy * Math.PI) / 2), 0, 0.8 * Math.cos((copy * Math.PI) / 2)],
      rotation: [0, (copy * 360) / 4, 0],
    })),
  });
  assert.equal(conRepeat.length, aMano.length);
  for (const [copy, resuelta] of conRepeat.entries()) {
    assert.equal(resuelta.name, aMano[copy].name);
    const uno = worldPositions(resuelta);
    const otro = worldPositions(aMano[copy]);
    let peor = 0;
    for (let index = 0; index < uno.length; index += 1) peor = Math.max(peor, Math.abs(uno[index] - otro[index]));
    assert.ok(peor < 1e-6, `la copia ${copy + 1} no coincide con la escrita a mano: ${peor}`);
  }
  console.log("geometria: ok (repeat ≡ las cuatro piezas escritas una a una, vértice a vértice)");
}

// 39. La caja del parche cubre todas las copias.
{
  const conRepeat = resolveScene({
    objects: [{ name: "pala", geometry: PALA, position: [0, 0, 0.8], repeat: { radial: { count: 4 } } }],
  });
  let minimo = Infinity;
  let maximo = -Infinity;
  for (const copia of conRepeat) {
    const mundo = worldPositions(copia);
    for (let vertex = 0; vertex < mundo.length / 3; vertex += 1) {
      minimo = Math.min(minimo, mundo[vertex * 3]);
      maximo = Math.max(maximo, mundo[vertex * 3]);
    }
  }
  // Con cuatro palas a 90°, dos quedan a los lados: la caja se ensancha en X hasta
  // donde llega el radio, no hasta el ancho de una pala sola.
  assert.ok(maximo - minimo > 1.6, `las cuatro copias tienen que ensanchar la caja: ${maximo - minimo}`);
  console.log(`geometria: ok (las 4 copias ensanchan la caja a ${(maximo - minimo).toFixed(3)} en X)`);
}

// 40. Errores por su motivo.
{
  const casos = [
    [
      { objects: [{ name: "p", geometry: PALA, repeat: { radial: { count: 4 }, mirror: "x" } }] },
      /repeat declara radial y mirror; son excluyentes/,
    ],
    [{ objects: [{ name: "p", geometry: PALA, repeat: {} }] }, /repeat no declara ni radial ni mirror/],
    [
      { objects: [{ name: "p", geometry: PALA, repeat: { radial: { count: 1 } } }] },
      /repeat\.radial\.count es un entero de 2 en adelante, no 1/,
    ],
    // Estos dos los caza el esquema antes de llegar al resolutor, porque el eje es
    // una unión cerrada de tres literales. Mejor así: el mensaje llega con la ruta
    // del campo dentro.
    [
      { objects: [{ name: "p", geometry: PALA, repeat: { radial: { count: 4, axis: "w" } } }] },
      /repeat\.radial\.axis debe ser/,
    ],
    [
      { objects: [{ name: "p", geometry: PALA, repeat: { mirror: "w" } }] },
      /repeat\.mirror debe ser/,
    ],
  ];
  for (const [scene, expected] of casos) {
    assert.throws(() => resolveScene(scene), expected, `no se rechazó por su motivo: ${expected}`);
  }

  // Y por el camino de modelo se rechaza en vez de ignorarse.
  assert.throws(
    () =>
      applyPatch(modelFromScene({ objects: [{ name: "base", geometry: PALA }] }), {
        edits: [{ op: "add", object: { name: "copia", geometry: PALA, repeat: { mirror: "x" } } }],
      }),
    /`repeat` es del documento de escena/,
  );
  console.log(`geometria: ok (${casos.length + 1} repeticiones mal escritas rechazadas por su motivo)`);
}

// ---------------------------------------------------------------------------
// Los dos avisos que faltaban.
// ---------------------------------------------------------------------------

// 41. PERFIL_AUTOINTERSECADO. El caso que **no** debe avisar vale tanto como el
//     que sí: un aviso que salta sobre los generadores del propio repositorio no
//     lo mira nadie.
{
  const ocho = [0, 0, 1, 1, 1, 0, 0, 1];
  const cuadrado = [0, 0, 1, 0, 1, 1, 0, 1];

  const cruzado = auditGeometry({ objects: [{ name: "tapa", geometry: { extrude: ocho } }] });
  assert.equal(cruzado.length, 1);
  assert.equal(cruzado[0].code, "PERFIL_AUTOINTERSECADO");
  assert.equal(cruzado[0].part, "tapa");
  assert.match(cruzado[0].message, /los lados \d+ y \d+ se cruzan/);
  assert.match(cruzado[0].message, /certeza, no candidato/);
  assert.equal(auditGeometry({ objects: [{ geometry: { extrude: cuadrado } }] }).length, 0);

  // Ninguno de los cuatro generadores se cruza consigo mismo, a varias
  // resoluciones. Aquí es donde un test de intersección demasiado permisivo con
  // los colineales se caería.
  const sanos = [
    { name: "circulo", circle: 1, points: 24 },
    { name: "circulo-fino", circle: 0.05, points: 96 },
    { name: "ala", naca: "2412", chord: 0.72, points: 64 },
    { name: "ala-simetrica", naca: "0012", points: 128 },
    { name: "chasis", superellipse: [1, 0.4, 4], points: 48 },
    { name: "chasis-caja", superellipse: [1, 0.5, 12], points: 200 },
    { name: "petalo", gielis: [5, 0.3, 1.7, 1.7], radius: 0.4, points: 96 },
  ];
  const limpia = auditGeometry({
    profiles: sanos,
    objects: sanos.map((perfil) => ({ name: perfil.name, geometry: { extrude: perfil.name } })),
  });
  assert.deepEqual(limpia, [], `los generadores propios no pueden avisar: ${JSON.stringify(limpia)}`);

  // Y lo caza también dentro de un loft y de un barrido, no solo en la extrusión.
  const enLoft = auditGeometry({
    objects: [
      {
        name: "torre",
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: cuadrado },
            { at: [0, 1, 0], profile: ocho },
          ],
        },
      },
    ],
  });
  assert.equal(enLoft[0].code, "PERFIL_AUTOINTERSECADO");
  assert.match(enLoft[0].message, /el perfil de la sección 1/);
  const enBarrido = auditGeometry({
    objects: [
      {
        name: "tubo",
        geometry: { sweep: ocho, path: { through: [[0, 0, 0], [0, 1, 0]], kind: "polyline" } },
      },
    ],
  });
  assert.equal(enBarrido[0].code, "PERFIL_AUTOINTERSECADO");
  assert.match(enBarrido[0].message, /el perfil del barrido/);
  console.log(
    `geometria: ok (PERFIL_AUTOINTERSECADO: caza el ocho en extrusión, loft y barrido; ${sanos.length} perfiles propios limpios)`,
  );
}

// 42. SECCIONES_INCOMPATIBLES. Candidato, con el umbral dicho en el mensaje.
{
  const circulo = createCircleProfile(0.3, 32);
  const ala = createNacaProfile("2412", 0.6, 32);

  const mezcla = auditGeometry({
    objects: [
      {
        name: "transicion",
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: circulo },
            { at: [0, 1, 0], profile: ala },
          ],
        },
      },
    ],
  });
  assert.equal(mezcla.length, 1);
  assert.equal(mezcla[0].code, "SECCIONES_INCOMPATIBLES");
  assert.match(mezcla[0].message, /gira \d+°, por encima del cuarto de vuelta/);
  assert.match(mezcla[0].message, /Candidato, no certeza/);

  // Círculo con círculo, no. Y un ala de verdad —NACA a NACA con cuerdas y
  // torsiones distintas— tampoco: si saltara ahí, el ejemplar no podría quedar
  // limpio y el umbral estaría mal.
  const limpios = [
    [
      { at: [0, 0, 0], profile: circulo },
      { at: [0, 1, 0], profile: createCircleProfile(0.15, 32) },
    ],
    [
      { at: [0, 0, 0], profile: createNacaProfile("2412", 1, 64), scale: 0.72, twist: 18 },
      { at: [0, 1.2, 0.05], profile: createNacaProfile("2412", 1, 64), scale: 0.4, twist: 11 },
      { at: [0, 2.4, 0.09], profile: createNacaProfile("2412", 1, 64), scale: 0.18, twist: 4 },
    ],
  ];
  for (const [index, loft] of limpios.entries()) {
    const avisos = auditGeometry({ objects: [{ name: `limpio${index}`, geometry: { loft } }] });
    assert.deepEqual(avisos, [], `el loft ${index} no debía avisar: ${JSON.stringify(avisos)}`);
  }

  // Y no avisa por escribir una sección en sentido contrario: el generador lo
  // normaliza a propósito, y hay una prueba que exige que dé la misma malla.
  const alReves = auditGeometry({
    objects: [
      {
        name: "sentidos",
        geometry: {
          loft: [
            { at: [0, 0, 0], profile: [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5] },
            { at: [0, 1, 0], profile: [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5] },
          ],
        },
      },
    ],
  });
  assert.deepEqual(alReves, [], "el sentido de escritura ya lo normaliza el generador");
  console.log(
    `geometria: ok (SECCIONES_INCOMPATIBLES: círculo→ala avisa, ala→ala y círculo→círculo no, y el sentido no cuenta)`,
  );
}

// ---------------------------------------------------------------------------
// El ejemplar versionado.
// ---------------------------------------------------------------------------

// 43. Una pieza de cada mecánica, montada y sin defectos.
//
//     Se lee el fichero de verdad para que un ejemplar roto rompa la puerta: es lo
//     primero que copia un agente que llega nuevo, y con defectos enseñaría justo
//     lo que la puerta rechaza.
//
//     Lo que se afirma aquí es **la topología, la geometría declarada, el
//     ensamblaje y el informe entero**: ni un aviso de severidad `certeza`, que es
//     lo que separa un defecto de una observación. `SIMETRIA_ROTA` y
//     `PIVOTE_DESCENTRADO` sí salen, y por eso el ejemplar no exige cero avisos:
//     saltan sobre cualquier pieza legítimamente asimétrica —un ala, una pata, una
//     pala— o cuya geometría no esté centrada en su propio origen, que es como se
//     declara una pieza colocada. Los dos son `candidato`, así que se dicen sin
//     tumbar la orden, y exigirlos cero obligaría a torcer la pieza hasta que
//     dejara de enseñar nada.
{
  const ejemplar = JSON.parse(
    readFileSync(resolve(here, "..", "artifacts/agent/pieza-geometria.json"), "utf8"),
  );
  const piezas = resolveScene(ejemplar);
  assert.deepEqual(
    piezas.map((pieza) => pieza.name),
    [
      "cuerpo",
      "ala-1",
      "ala-2",
      "pata-1",
      "pata-2",
      "buje",
      "pala-1",
      "pala-2",
      "pala-3",
      "pala-4",
    ],
    "diez piezas: el documento declara cinco objetos, y repeat expande tres de ellos",
  );

  let triangulos = 0;
  let volumen = 0;
  for (const pieza of piezas) {
    const audit = auditMesh(pieza.node.mesh);
    assert.equal(audit.watertight, true, `${pieza.name} no está cerrada`);
    assert.equal(audit.boundaryEdges, 0, `${pieza.name} tiene aristas de borde`);
    assert.equal(audit.nonManifoldEdges, 0, `${pieza.name} tiene aristas no manifold`);
    assert.equal(audit.degenerateTriangles, 0, `${pieza.name} tiene triángulos de área nula`);
    assert.equal(audit.inverted, false, `${pieza.name} está del revés`);
    assert.ok(audit.signedVolume > 0, `${pieza.name} tiene volumen ${audit.signedVolume}`);
    triangulos += audit.triangles;
    volumen += audit.signedVolume;
  }

  assert.deepEqual(auditGeometry(ejemplar), [], "la geometría declarada tiene que estar limpia");

  // El informe entero, no solo la geometría declarada: un defecto es un aviso de
  // severidad `certeza`, y el ejemplar no puede traer ninguno. Los candidatos que
  // sí trae se cuentan aparte para que el número quede en la salida de la puerta y
  // un cambio de clasificación se vea aquí antes que en el editor.
  const { warnings } = reviewScene(ejemplar, { inspectOnly: true }).review;
  const defectos = warnings.filter((aviso) => aviso.severity === "certeza");
  assert.deepEqual(
    defectos,
    [],
    `el ejemplar trae defectos: ${defectos.map((aviso) => `${aviso.code} en ${aviso.part}`).join(", ")}`,
  );

  // El ensamblaje: sin booleanas, con sólidos cerrados que **se tocan sin
  // morderse**. Es la respuesta medida a la pregunta abierta en §6.2 del plan.
  const spatial = auditSpatial(
    piezas.map((pieza) => ({
      name: pieza.name,
      path: pieza.name,
      mesh: pieza.node.mesh,
      model: pieza.node.model,
    })),
  );
  const parciales = spatial.interpenetration.filter((par) => !par.contained);
  assert.deepEqual(
    parciales,
    [],
    `solape parcial: ${parciales.map((par) => `${par.parts[0]}~${par.parts[1]} ${(par.overlap * 100).toFixed(1)}%`).join(", ")}`,
  );
  assert.deepEqual(
    spatial.floating,
    [],
    `piezas sueltas: ${spatial.floating.map((suelta) => suelta.part).join(", ")}`,
  );

  // Y la escala: fuera del rango de un metro largo, casi nada es lo que dice ser.
  let minimo = [Infinity, Infinity, Infinity];
  let maximo = [-Infinity, -Infinity, -Infinity];
  for (const pieza of piezas) {
    const mundo = worldPositions(pieza);
    for (let vertex = 0; vertex < mundo.length / 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimo[axis] = Math.min(minimo[axis], mundo[vertex * 3 + axis]);
        maximo[axis] = Math.max(maximo[axis], mundo[vertex * 3 + axis]);
      }
    }
  }
  const lado = Math.max(...[0, 1, 2].map((axis) => maximo[axis] - minimo[axis]));
  assert.ok(lado > 0.01 && lado < 100, `la pieza mide ${lado} en su lado mayor`);

  console.log(
    `geometria: ok (ejemplar: ${piezas.length} piezas, ${triangulos} triángulos, ` +
      `volumen ${volumen.toFixed(6)}, ${lado.toFixed(3)} de lado mayor; sin solape parcial, ` +
      `sin piezas sueltas y sin un defecto: ${warnings.length} avisos, los ${warnings.length} candidatos)`,
  );
}

// 44. `repeat.about`: girar y reflejar alrededor de un punto declarado.
//
//     Sin él, un rotor solo se puede poner sobre el eje del mundo: cuatro palas en
//     la punta de un brazo orbitarían el centro de la escena.
{
  const centro = [0.9, 1.2, -0.4];
  const conCentro = resolveScene({
    objects: [
      {
        name: "pala",
        geometry: PALA,
        position: [centro[0] + 0.3, centro[1], centro[2]],
        repeat: { radial: { count: 4, axis: "y" }, about: centro },
      },
    ],
  });

  // Cada copia es la anterior girada alrededor de la recta vertical que pasa por
  // el punto: la distancia al eje se conserva y la altura no cambia.
  const radioDe = (pieza) => {
    const mundo = worldPositions(pieza);
    let dentro = Infinity;
    let fuera = 0;
    for (let vertex = 0; vertex < mundo.length / 3; vertex += 1) {
      const distancia = Math.hypot(mundo[vertex * 3] - centro[0], mundo[vertex * 3 + 2] - centro[2]);
      dentro = Math.min(dentro, distancia);
      fuera = Math.max(fuera, distancia);
    }
    return [dentro, fuera];
  };
  const [dentro, fuera] = radioDe(conCentro[0]);
  for (const copia of conCentro.slice(1)) {
    const [otroDentro, otroFuera] = radioDe(copia);
    assert.ok(Math.abs(otroDentro - dentro) < 1e-6, `${copia.name}: radio interior ${otroDentro} frente a ${dentro}`);
    assert.ok(Math.abs(otroFuera - fuera) < 1e-6, `${copia.name}: radio exterior ${otroFuera} frente a ${fuera}`);
  }
  // Y giran de verdad: la copia opuesta cae al otro lado del punto.
  const primera = worldPositions(conCentro[0]);
  const opuesta = worldPositions(conCentro[2]);
  let peor = 0;
  for (let vertex = 0; vertex < primera.length / 3; vertex += 1) {
    const offset = vertex * 3;
    peor = Math.max(
      peor,
      Math.abs(opuesta[offset] - (2 * centro[0] - primera[offset])),
      Math.abs(opuesta[offset + 1] - primera[offset + 1]),
      Math.abs(opuesta[offset + 2] - (2 * centro[2] - primera[offset + 2])),
    );
  }
  assert.ok(peor < 1e-6, `la copia a 180° tiene que caer al otro lado del punto: ${peor}`);

  // El espejo también: el plano pasa por el punto.
  const [izquierda, derecha] = resolveScene({
    objects: [
      { name: "ala", geometry: PALA, position: [1.5, 0, 0], repeat: { mirror: "x", about: [1, 0, 0] } },
    ],
  });
  const original = worldPositions(izquierda);
  const reflejada = worldPositions(derecha);
  let peorEspejo = 0;
  for (let vertex = 0; vertex < original.length / 3; vertex += 1) {
    const offset = vertex * 3;
    peorEspejo = Math.max(
      peorEspejo,
      Math.abs(reflejada[offset] - (2 * 1 - original[offset])),
      Math.abs(reflejada[offset + 1] - original[offset + 1]),
      Math.abs(reflejada[offset + 2] - original[offset + 2]),
    );
  }
  assert.ok(peorEspejo < 1e-6, `el espejo desplazado se desvía ${peorEspejo}`);
  const copia = auditMesh(derecha.node.mesh);
  assert.ok(copia.signedVolume > 0, "la copia reflejada sigue con volumen positivo");
  assert.equal(copia.inverted, false);
  assert.ok(linearDeterminant(derecha.node.model) > 0, "la matriz sigue conjugada");

  // Y sin `about`, o con el origen, todo sale **exactamente** como antes: lo
  // escrito antes de que el campo existiera no se mueve un bit.
  const sinCampo = resolveScene({
    objects: [{ name: "p", geometry: PALA, position: [0, 0, 0.8], repeat: { radial: { count: 4 } } }],
  });
  const conOrigen = resolveScene({
    objects: [
      {
        name: "p",
        geometry: PALA,
        position: [0, 0, 0.8],
        repeat: { radial: { count: 4 }, about: [0, 0, 0] },
      },
    ],
  });
  for (const [index, copiaSin] of sinCampo.entries()) {
    assert.deepEqual(conOrigen[index].node.model, copiaSin.node.model);
  }
  console.log(
    `geometria: ok (repeat.about: 4 copias en órbita del punto a ${peor.toExponential(1)}, espejo desplazado a ${peorEspejo.toExponential(1)}, y el origen no mueve nada)`,
  );
}
