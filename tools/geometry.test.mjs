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

import {
  auditMesh,
  createCircleProfile,
  createGielisProfile,
  createLoft,
  createNacaProfile,
  createSuperellipseProfile,
  resolveScene,
} from "../dist-node/agent3d.mjs";

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
