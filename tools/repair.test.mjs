/**
 * Puerta de R10 — la frontera de reparación.
 *
 * El escalón lo pide así: **clasificar el riesgo de una corrección sin
 * convertirse en un motor de modelado**. Así que esto no repara nada, y la puerta
 * lo comprueba de la única forma que vale: ninguna función devuelve geometría.
 *
 * ## Lo que de verdad se juzga, y está en el bloque 2
 *
 * **Un agujero no es un defecto uniforme.** Taparlo entre puntos que las cámaras
 * vieron es interpolar entre medidas; taparlo en la trasera que nadie fotografió
 * es dibujar. Los dos se llaman igual —`MALLA_ABIERTA`, tantas aristas de borde—
 * y valen cosas distintas.
 *
 * El bloque 2 pone el mismo cubo agujereado delante de dos CameraSets: uno que
 * mira el agujero y otro que no. **La malla es idéntica, byte a byte**, y el
 * veredicto cambia de REVIEW a UNSAFE. Ninguna herramienta de malla puede hacer
 * esa distinción, y es la razón de que R10 viva en esta capa.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeMeshTopology,
  auditMesh,
  classifyRepairs,
  computeVisibility,
  lookAtPose,
  parsePlyAscii,
} from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-reparacion-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const leida = parsePlyAscii(readFileSync(join(raiz, "mesh.ply"), "utf8")).mesh;
const completa = { ...leida, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 0 };

/** El mismo cubo con una cara quitada: un agujero de verdad, no simulado. */
function conAgujero(quitar) {
  const indices = [];
  for (let triangle = 0; triangle < leida.indices.length / 3; triangle += 1) {
    if (quitar.includes(triangle)) continue;
    indices.push(leida.indices[triangle * 3], leida.indices[triangle * 3 + 1], leida.indices[triangle * 3 + 2]);
  }
  return { ...completa, indices: new Uint32Array(indices) };
}

const DIAGONAL = Math.sqrt(3);

// 1. Lo que no mueve superficie es seguro, y lo es por un motivo comprobable.
{
  const audit = auditMesh(completa);
  assert.equal(audit.duplicatePositions, 16, "el cubo trae las esquinas repetidas por cara");
  assert.equal(audit.watertight, true);

  const frontera = classifyRepairs({ audit, diagonal: DIAGONAL });
  const soldar = frontera.repairs.find((entrada) => entrada.defect === "VERTICES_DUPLICADOS");
  assert.ok(soldar !== undefined);
  assert.equal(soldar.risk, "SAFE");
  assert.equal(soldar.reason, "NO_MUEVE_SUPERFICIE");
  // **La consecuencia mecánica**: una reparación segura no toca la provenance, y
  // con ella el paquete sigue pudiendo certificar (D21).
  assert.equal(soldar.breaksPurelyReconstructed, false);
  assert.equal(soldar.evidence.duplicatePositions, 16);

  // Un cubo cerrado y bien orientado no tiene nada que revisar.
  assert.equal(frontera.byRisk.UNSAFE, 0);
  assert.equal(frontera.byRisk.REVIEW, 0);
  assert.equal(frontera.measurementClass, "EXACT", "sin agujeros no hay nada que muestrear");
  assert.equal(frontera.evidenceAware, false, "no se le pasaron cámaras y lo dice");

  console.log(
    `reparación: ok (soldar 16 vértices repetidos es SAFE por NO_MUEVE_SUPERFICIE, y no toca la ` +
      "provenance: un cubo cerrado no tiene nada que revisar)",
  );
}

// 2. **El mismo agujero, dos veredictos.**
//
// La malla es idéntica byte a byte; lo único que cambia es quién miró. Ninguna
// herramienta de malla puede hacer esta distinción, y es la razón de que R10 viva
// en esta capa.
{
  // Qué par de triángulos forma cada cara, y cuál mira en cada dirección. Se
  // calcula en vez de apuntarse: un índice a mano se queda viejo el día que el
  // fixture cambie el orden de las caras.
  const normalDe = (triangle) => {
    const punto = (slot) => {
      const vertex = leida.indices[triangle * 3 + slot];
      return [leida.positions[vertex * 3], leida.positions[vertex * 3 + 1], leida.positions[vertex * 3 + 2]];
    };
    const [p, q, r] = [punto(0), punto(1), punto(2)];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const largo = Math.hypot(...n) || 1;
    return n.map((value) => value / largo);
  };

  // Una sola cámara, la frontal del fixture. El agujero se abre en la cara que
  // **le da la espalda**: su normal es la más contraria a la dirección de mirada.
  const camara = manifest.cameras[0];
  const ojo = [3, 7, 11].map((slot) => camara.worldFromCamera[slot]);
  const haciaElOjo = (() => {
    const largo = Math.hypot(...ojo) || 1;
    return ojo.map((value) => value / largo);
  })();

  let peor = 0;
  let peorProducto = Infinity;
  for (let triangle = 0; triangle < leida.indices.length / 3; triangle += 1) {
    const n = normalDe(triangle);
    const producto = n[0] * haciaElOjo[0] + n[1] * haciaElOjo[1] + n[2] * haciaElOjo[2];
    if (producto < peorProducto) {
      peorProducto = producto;
      peor = triangle;
    }
  }
  // Las dos caras del cubo van en pares consecutivos, así que el par es el del
  // triángulo encontrado.
  const par = peor % 2 === 0 ? [peor, peor + 1] : [peor - 1, peor];

  const agujereado = conAgujero(par);
  const audit = auditMesh(agujereado);
  const topology = analyzeMeshTopology(agujereado);
  assert.equal(audit.watertight, false);
  assert.equal(topology.boundaryLoops.length, 1, "quitar una cara deja un solo contorno");
  assert.equal(topology.boundaryLoops[0].edges, 4);

  // (a) La cámara que **no** mira esa cara.
  const ciego = classifyRepairs({
    audit,
    topology,
    visibility: computeVisibility(agujereado, [camara], { samples: 8_000 }),
    diagonal: DIAGONAL,
  });
  const taparCiego = ciego.repairs.find((entrada) => entrada.defect === "MALLA_ABIERTA");
  assert.equal(taparCiego.risk, "UNSAFE");
  assert.equal(taparCiego.reason, "CREA_SUPERFICIE_SIN_EVIDENCIA");
  assert.equal(taparCiego.evidence.observedNearby, 0, "nadie miró el borde de este agujero");
  assert.equal(ciego.byRisk.UNSAFE, 1);

  // (b) Una cámara que **sí ve el borde**. Y no vale ponerla enfrente del
  // agujero: ahí falta la cara, así que lo que se vería es el interior de la
  // pieza, que da la espalda — no hay superficie observada, la hay ausente.
  //
  // La que sirve es la que mira las caras **contiguas** al contorno, así que se
  // coloca en la bisectriz entre la normal del agujero y la de una cara vecina.
  const normalAgujero = normalDe(par[0]);
  let normalVecina = null;
  for (let triangle = 0; triangle < leida.indices.length / 3; triangle += 2) {
    const n = normalDe(triangle);
    const producto = Math.abs(
      n[0] * normalAgujero[0] + n[1] * normalAgujero[1] + n[2] * normalAgujero[2],
    );
    if (producto < 1e-6) {
      normalVecina = n;
      break;
    }
  }
  assert.ok(normalVecina !== null, "un cubo tiene caras perpendiculares a cualquiera de las suyas");
  const bisectriz = normalAgujero.map((value, axis) => value + normalVecina[axis]);
  const largoBisectriz = Math.hypot(...bisectriz);
  const enfrente = {
    ...camara,
    id: "mirando-el-borde",
    worldFromCamera: lookAtPose(
      bisectriz.map((value) => (value / largoBisectriz) * 3),
      [0, 0, 0],
      camara.cameraAxes,
    ),
  };
  const mirando = classifyRepairs({
    audit,
    topology,
    visibility: computeVisibility(agujereado, [enfrente], { samples: 8_000 }),
    diagonal: DIAGONAL,
  });
  const tapar = mirando.repairs.find((entrada) => entrada.defect === "MALLA_ABIERTA");
  assert.equal(tapar.risk, "REVIEW");
  assert.equal(tapar.reason, "INTERPOLA_ENTRE_SUPERFICIE_OBSERVADA");
  assert.ok(tapar.evidence.observedNearby > 0);

  // Es **el mismo agujero**: mismas aristas y mismo centroide.
  assert.equal(taparCiego.evidence.edges, tapar.evidence.edges);
  assert.deepEqual(taparCiego.evidence.centroid, tapar.evidence.centroid);
  // Y los dos rompen la provenance: tapar crea superficie que no salió de ninguna
  // medida, la mire alguien o no. Lo que cambia es si alguien podrá desmentirla.
  assert.equal(taparCiego.breaksPurelyReconstructed, true);
  assert.equal(tapar.breaksPurelyReconstructed, true);

  console.log(
    `reparación: ok (el mismo agujero de ${tapar.evidence.edges} aristas, misma malla y mismo ` +
      `centroide: **UNSAFE** con la cámara que no lo mira —cero muestras observadas alrededor— y ` +
      `**REVIEW** con la que sí, con ${tapar.evidence.observedNearby})`,
  );
}

// 3. Sin cámaras, **nada se da por bueno**.
{
  const agujereado = conAgujero([10, 11]);
  const frontera = classifyRepairs({
    audit: auditMesh(agujereado),
    topology: analyzeMeshTopology(agujereado),
    diagonal: DIAGONAL,
  });
  const tapar = frontera.repairs.find((entrada) => entrada.defect === "MALLA_ABIERTA");
  assert.equal(tapar.risk, "REVIEW");
  assert.equal(tapar.reason, "REVISION_REQUERIDA_SIN_EVIDENCIA");
  assert.equal(frontera.evidenceAware, false);
  // No saber no es estar bien: sin cruzar con cámaras, ningún agujero sale SAFE.
  assert.equal(frontera.byRisk.SAFE, frontera.repairs.filter((e) => e.risk === "SAFE").length);
  assert.ok(frontera.repairs.every((entrada) => entrada.defect !== "MALLA_ABIERTA" || entrada.risk !== "SAFE"));

  console.log(
    "reparación: ok (sin cámaras, tapar un agujero es REVISION_REQUERIDA_SIN_EVIDENCIA y nunca SAFE: " +
      "no saber no es estar bien)",
  );
}

// 4. La malla entera del revés se arregla sin mover un punto; unas caras sueltas, no.
{
  const alReves = { ...completa, indices: new Uint32Array(completa.indices) };
  for (let triangle = 0; triangle < alReves.indices.length / 3; triangle += 1) {
    const b = alReves.indices[triangle * 3 + 1];
    alReves.indices[triangle * 3 + 1] = alReves.indices[triangle * 3 + 2];
    alReves.indices[triangle * 3 + 2] = b;
  }
  const audit = auditMesh(alReves);
  assert.equal(audit.inverted, true, "el cubo volteado entero tiene volumen negativo");

  const frontera = classifyRepairs({ audit, diagonal: DIAGONAL });
  const voltear = frontera.repairs.find((entrada) => entrada.defect === "MALLA_INVERTIDA");
  assert.equal(voltear.risk, "SAFE");
  assert.equal(voltear.reason, "NO_MUEVE_SUPERFICIE");
  assert.equal(voltear.breaksPurelyReconstructed, false);
  // Y **no** sale además la de normales sueltas: son dos reparaciones distintas,
  // y ofrecer las dos invitaría a hacer la que decide orientación local.
  assert.equal(frontera.repairs.filter((e) => e.defect === "NORMALES_INCONSISTENTES").length, 0);

  // Unas caras discrepando sin estar la malla del revés: eso sí decide qué lado
  // es el de fuera en una región, y es revisable.
  const sueltas = classifyRepairs({
    audit: { ...audit, inverted: false, flippedNormalRatio: 0.2 },
    diagonal: DIAGONAL,
  });
  const reorientar = sueltas.repairs.find((entrada) => entrada.defect === "NORMALES_INCONSISTENTES");
  assert.equal(reorientar.risk, "REVIEW");
  assert.equal(reorientar.reason, "DECIDE_ORIENTACION_LOCAL");

  console.log(
    "reparación: ok (voltear la malla entera es SAFE —no mueve un punto— y reorientar caras sueltas es " +
      "REVIEW, porque decide cuál es el lado de fuera en una región concreta)",
  );
}

// 5. El tope no esconde lo peligroso.
//
// Se recorta por riesgo primero y por tamaño después: un agujero de seis aristas
// donde nadie miró pesa más que uno de trescientas entre puntos vistos.
{
  const bucles = [];
  // Veinte agujeros grandes en sitio observado y dos pequeños en sitio ciego.
  for (let index = 0; index < 20; index += 1) {
    bucles.push({ edges: 100 + index, length: 1, extent: 0.1, centroid: [0, 0, 0.5] });
  }
  bucles.push({ edges: 6, length: 0.1, extent: 0.01, centroid: [0, 0, -50] });
  bucles.push({ edges: 5, length: 0.1, extent: 0.01, centroid: [0, 0, -60] });

  const visibility = computeVisibility(completa, manifest.cameras, { samples: 4_000 });
  const frontera = classifyRepairs({
    audit: auditMesh(completa),
    topology: { boundaryLoops: bucles, unresolvedBoundaryEdges: 0, ambiguousVertices: 0 },
    visibility,
    diagonal: DIAGONAL,
  });

  assert.ok(frontera.omittedLoops > 0, "veintidós agujeros no caben en el tope");
  // Los recuentos **no se recortan**: describen el paquete, y la lista solo lo
  // ilustra.
  assert.equal(
    frontera.byRisk.SAFE + frontera.byRisk.REVIEW + frontera.byRisk.UNSAFE,
    frontera.repairs.length + frontera.omittedLoops,
  );
  // Los dos lejanos no tienen ninguna muestra cerca: la pregunta no se pudo
  // hacer, y eso es REVIEW con su motivo, no un SAFE optimista.
  const lejanos = frontera.repairs.filter(
    (entrada) => entrada.reason === "REVISION_REQUERIDA_SIN_EVIDENCIA",
  );
  assert.equal(lejanos.length, 2, "los dos agujeros fuera de la pieza se publican pese al tope");
  assert.ok(lejanos.every((entrada) => entrada.evidence.samplesNearby === 0));

  console.log(
    `reparación: ok (con 22 agujeros y tope de 16, los ${lejanos.length} sin evidencia sobreviven al ` +
      `recorte pese a ser los más pequeños, y ${frontera.omittedLoops} omitidos se siguen contando)`,
  );
}

// 6. Y por el informe entero, sobre el paquete de verdad.
{
  const { report } = inspectPackage(join(raiz, "manifest.json"));
  assert.ok(report.repairBoundary !== undefined, "con malla medida tiene que haber frontera");
  assert.equal(report.repairBoundary.evidenceAware, true, "cube-v1 trae cámaras");
  assert.equal(report.repairBoundary.byRisk.UNSAFE, 0, "el cubo está cerrado");
  const soldar = report.repairBoundary.repairs.find((e) => e.defect === "VERTICES_DUPLICADOS");
  assert.equal(soldar.risk, "SAFE");

  // Determinismo: dos consumos, la misma frontera.
  const otra = inspectPackage(join(raiz, "manifest.json")).report;
  assert.equal(JSON.stringify(otra.repairBoundary), JSON.stringify(report.repairBoundary));

  console.log(
    "reparación: ok (el informe trae la frontera con las cámaras cruzadas, y dos consumos dan la " +
      "misma byte a byte)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "reparación: no ejecutada — **no repara nada, y no va a hacerlo**: la puerta del escalón dice «sin " +
    "convertirse en un motor de modelado». En cuanto decidiera dónde va un vértice dejaría de poder " +
    "afirmar que sus números son exactos, que es lo único que aporta. Lo que falta es que alguien " +
    "repare y vuelva a medir, y eso es de quien tenga la herramienta",
);
