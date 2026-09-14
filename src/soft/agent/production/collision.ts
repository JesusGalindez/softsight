/**
 * R14 — el proxy de colisión, certificable.
 *
 * R11 contestó **una** pregunta: ¿asoma la maestra del proxy? Es la que rompe un
 * juego de la forma más visible —los objetos atraviesan la pieza por donde asoma—
 * pero no es la única, y dos de las que faltan son peores de diagnosticar porque
 * no se ven en ninguna captura.
 *
 * ## La holgura, que es la asimetría de la contención
 *
 * Una caja enorme contiene la pieza **perfectamente**: cero superficie asomada,
 * veredicto impecable. Y el jugador choca con el aire a medio metro del objeto.
 * Medir solo una dirección premia al proxy más grande posible, que es justo el
 * peor. Es la misma lección que R5: las dos direcciones no se promedian, y aquí
 * ni siquiera se parecen — una dice «lo atraviesan» y la otra «choca con nada».
 *
 * ## La convexidad, que decide el coste de verdad
 *
 * El recuento de triángulos no describe lo que cuesta un proxy. Un motor de
 * física trata un casco convexo con un algoritmo y una malla cóncava con otro,
 * y la diferencia es de orden, no de porcentaje. Un proxy de treinta triángulos
 * cóncavo puede costar más que uno convexo de doscientos.
 *
 * Se mide exacto: un cuerpo es convexo cuando **ningún vértice queda del lado de
 * fuera del plano de ninguna cara**. Y cuando no lo es, lo que se publica es
 * cuánto se sale el peor — que separa «convexo salvo por el ruido de coma
 * flotante» de «esto es una herradura».
 *
 * ## Lo que no hace
 *
 * No propone un proxy. Igual que R10 no repara y R13 no despliega UV: calcular
 * un casco convexo o una descomposición en partes es modelar, y en cuanto esto
 * decidiera dónde va un vértice dejaría de poder afirmar que sus números son
 * exactos.
 */

import { buildTriangleBoundsTree, nearestPoint, raycast, type TriangleBoundsTree } from "../boundsTree";
import type { MeshAudit } from "../inspect";
import type { Mesh } from "../../mesh";
import { sampleMesh } from "../reconstruction/surfaceSampling";

/** Muestras con las que se juzgan contención y holgura. */
export const COLLISION_SAMPLES = 4_000;

/**
 * Cuánto se separa una muestra antes de lanzar el rayo, relativo a la coordenada.
 * El mismo suelo que la cobertura y por el mismo motivo: por debajo de la rejilla
 * de `Float32`, separar no separa.
 */
export const COLLISION_OFFSET = 2.3e-7;

/**
 * Tolerancia de la prueba de convexidad, en fracción de la diagonal.
 *
 * Un cuerpo convexo escrito en `Float32` tiene vértices que caen microscópicamente
 * fuera del plano de una cara vecina. Sin margen, **ninguna malla real sería
 * convexa** y la medida no distinguiría nada.
 *
 * **Y hay una concavidad que no es redondeo y sorprende.** Una esfera teselada a
 * partir de quads es convexa como conjunto de puntos y **no** como malla: los
 * cuatro vértices de un quad proyectados sobre la esfera no son coplanarios, así
 * que al partirlo en dos triángulos una de las dos diagonales queda de valle. En
 * una esfera de ocho divisiones eso son cuatro milésimas de la diagonal —mil
 * veces el redondeo— y la medida lo dice en vez de esconderlo. Quien sepa que su
 * proxy es una esfera teselada declara su tolerancia; el defecto no la supone.
 */
export const CONVEX_TOLERANCE = 1e-4;

export interface ConvexityCheck {
  convex: boolean;
  /** Cuánto se sale el peor vértice del plano de una cara, sobre la diagonal. */
  worstExcursion: number;
  tolerance: number;
}

export interface CollisionQuality {
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  samples: number;
  /** Fracción de la maestra que queda fuera del proxy: los atraviesan por ahí. */
  protrudingRatio: number;
  worstProtrusionRelative: number;
  /**
   * Fracción del proxy que queda lejos de la maestra: **se choca con nada**. Es
   * la otra dirección, y no se promedia con la de arriba.
   */
  slackRatio: number;
  worstSlackRelative: number;
  /** Tolerancia con la que se decidió `slackRatio`, publicada porque lo decide. */
  slackTolerance: number;
  convexity: ConvexityCheck;
  /** Triángulos del proxy entre los de la maestra. */
  triangleRatio: number;
  /** Volumen del proxy entre el de la maestra, en valor absoluto. */
  volumeRatio: number;
  /** Cuánto se sale la caja del proxy de la de la maestra, sobre la diagonal. */
  boundsExcess: number;
  topology: {
    watertight: boolean;
    nonManifoldEdges: number;
    inverted: boolean;
    degenerateTriangles: number;
  };
}

/** ¿Está el punto dentro de la malla cerrada? Paridad de cruces, dirección fija. */
export function insideClosedMesh(
  tree: TriangleBoundsTree,
  point: readonly number[],
  offset: number,
): boolean {
  // Una dirección que no es paralela a ningún eje: con (1,0,0) sobre una caja
  // alineada, el rayo roza aristas y la paridad se vuelve una moneda.
  const direction = [0.577350269, 0.5773502692, 0.5773502694];
  let crossings = 0;
  let travelled = 0;
  for (let step = 0; step < 64; step += 1) {
    const origin = [
      point[0] + direction[0] * travelled,
      point[1] + direction[1] * travelled,
      point[2] + direction[2] * travelled,
    ];
    const hit = raycast(tree, origin, direction);
    if (hit === null) break;
    crossings += 1;
    travelled += hit.distance + offset;
  }
  return crossings % 2 === 1;
}

/**
 * ¿Es convexo? Cada vértice contra el plano de cada cara.
 *
 * Cuadrático en el tamaño del proxy, y eso está bien: un proxy es pequeño por
 * definición y el presupuesto de R11 lo limita. Sobre una malla que no lo sea,
 * quien la declare proxy tiene un problema antes que este.
 */
export function checkConvexity(
  mesh: Mesh,
  diagonal: number,
  relativeTolerance = CONVEX_TOLERANCE,
): ConvexityCheck {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  const tolerance = relativeTolerance * (diagonal || 1);
  let worst = 0;

  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const a = indices[triangle * 3];
    const b = indices[triangle * 3 + 1];
    const c = indices[triangle * 3 + 2];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const largo = Math.hypot(nx, ny, nz);
    // Un triángulo degenerado no define plano. Se salta: juzgar la convexidad
    // contra un plano inventado diría que cualquier cosa es cóncava.
    if (largo === 0) continue;
    nx /= largo;
    ny /= largo;
    nz /= largo;
    const d = nx * positions[a * 3] + ny * positions[a * 3 + 1] + nz * positions[a * 3 + 2];

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const distancia =
        nx * positions[vertex * 3] + ny * positions[vertex * 3 + 1] + nz * positions[vertex * 3 + 2] - d;
      if (distancia > worst) worst = distancia;
    }
  }

  return {
    convex: worst <= tolerance,
    worstExcursion: worst / (diagonal || 1),
    tolerance: relativeTolerance,
  };
}

export interface CollisionInputs {
  master: Mesh;
  proxy: Mesh;
  masterAudit: MeshAudit;
  proxyAudit: MeshAudit;
  diagonal: number;
  samples?: number;
  seed?: number;
  /**
   * A partir de qué distancia de la maestra se cuenta el proxy como holgura, en
   * fracción de la diagonal. Sin declarar, un 2 %: por debajo de eso un proxy
   * ceñido de verdad ya no se distingue del grosor de la propia superficie.
   */
  slackTolerance?: number;
  /** Tolerancia de convexidad, en fracción de la diagonal. Sin declarar, la del módulo. */
  convexTolerance?: number;
}

export function assessCollision(inputs: CollisionInputs): CollisionQuality {
  const { master, proxy, masterAudit, proxyAudit, diagonal } = inputs;
  const samples = inputs.samples ?? COLLISION_SAMPLES;
  const seed = inputs.seed ?? 1;
  const slackTolerance = inputs.slackTolerance ?? 0.02;

  const proxyTree = buildTriangleBoundsTree(proxy);
  const masterTree = buildTriangleBoundsTree(master);

  let magnitude = 0;
  for (let index = 0; index < master.positions.length; index += 1) {
    magnitude = Math.max(magnitude, Math.abs(master.positions[index]));
  }
  const offset = COLLISION_OFFSET * (magnitude || 1);

  // Dirección uno: cuánta maestra asoma. Lo que los objetos atraviesan.
  const desdeMaestra = sampleMesh(master, samples, seed);
  let fuera = 0;
  let peorAsomo = 0;
  for (let sample = 0; sample < desdeMaestra.count; sample += 1) {
    const point = [
      desdeMaestra.points[sample * 3],
      desdeMaestra.points[sample * 3 + 1],
      desdeMaestra.points[sample * 3 + 2],
    ];
    if (insideClosedMesh(proxyTree, point, offset)) continue;
    fuera += 1;
    const cercano = nearestPoint(proxyTree, point);
    if (cercano !== null) peorAsomo = Math.max(peorAsomo, Math.sqrt(cercano.distanceSquared));
  }

  // Dirección dos: cuánto proxy queda lejos de la maestra. Lo que se choca con
  // nada. **No se promedia con la anterior**: dicen cosas opuestas.
  const desdeProxy = sampleMesh(proxy, samples, seed);
  let holgado = 0;
  let peorHolgura = 0;
  const topeHolgura = slackTolerance * (diagonal || 1);
  for (let sample = 0; sample < desdeProxy.count; sample += 1) {
    const point = [
      desdeProxy.points[sample * 3],
      desdeProxy.points[sample * 3 + 1],
      desdeProxy.points[sample * 3 + 2],
    ];
    const cercano = nearestPoint(masterTree, point);
    if (cercano === null) continue;
    const distancia = Math.sqrt(cercano.distanceSquared);
    if (distancia > peorHolgura) peorHolgura = distancia;
    if (distancia > topeHolgura) holgado += 1;
  }

  let boundsExcess = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    boundsExcess = Math.max(
      boundsExcess,
      masterAudit.boundingBoxMin[axis] - proxyAudit.boundingBoxMin[axis],
      proxyAudit.boundingBoxMax[axis] - masterAudit.boundingBoxMax[axis],
    );
  }

  return {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    samples,
    protrudingRatio: desdeMaestra.count === 0 ? 0 : fuera / desdeMaestra.count,
    worstProtrusionRelative: peorAsomo / (diagonal || 1),
    slackRatio: desdeProxy.count === 0 ? 0 : holgado / desdeProxy.count,
    worstSlackRelative: peorHolgura / (diagonal || 1),
    slackTolerance,
    convexity: checkConvexity(proxy, diagonal, inputs.convexTolerance),
    triangleRatio: master.indices.length === 0 ? 0 : proxy.indices.length / master.indices.length,
    volumeRatio:
      masterAudit.signedVolume === 0
        ? 0
        : Math.abs(proxyAudit.signedVolume) / Math.abs(masterAudit.signedVolume),
    // Positivo es proxy que sobresale de la caja de la maestra; negativo sería
    // proxy más pequeño, y eso ya lo dice `protrudingRatio` mejor.
    boundsExcess: Math.max(0, boundsExcess) / (diagonal || 1),
    topology: {
      watertight: proxyAudit.watertight,
      nonManifoldEdges: proxyAudit.nonManifoldEdges,
      inverted: proxyAudit.inverted,
      degenerateTriangles: proxyAudit.degenerateTriangles,
    },
  };
}
