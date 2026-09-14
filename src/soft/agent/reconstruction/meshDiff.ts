/**
 * R5 — comparar dos mallas con números, no mirándolas.
 *
 * Es lo que convierte «la reparación parece mejor» en un dato. Una malla
 * reconstruida y su versión reparada tienen **vértices distintos** —soldar,
 * simplificar y tapar los cambian todos—, así que compararlos uno a uno no dice
 * nada: lo que hay que comparar es la **superficie**.
 *
 * ## Por qué dos direcciones y no una
 *
 * No son la misma medida y confundirlas deja pasar justo lo que importa.
 * Muestrear A y buscar en B no ve lo que B tiene **de más**: si la reparación
 * rellenó un agujero con una cúpula inventada, cada punto de A sigue teniendo su
 * punto en B a distancia cero, y el informe diría que son idénticas. La dirección
 * B → A es la que la encuentra.
 *
 * Por eso las dos se publican separadas y **nunca se promedian**: un máximo de
 * 0,3 en una dirección y 0 en la otra describe una malla a la que le sobra
 * superficie, y el promedio 0,15 no describe nada.
 *
 * ## Qué clase de medida es
 *
 * **Aproximada y reproducible bit a bit**, que son los dos ejes de D28 y la razón
 * de que sean dos: el muestreo no visita toda la superficie —eso es la
 * aproximación— pero visita siempre los mismos puntos, porque la semilla es fija
 * y el recorrido es en orden de índice. Publicar solo «aproximado» haría pensar
 * que dos ejecuciones dan números distintos, y publicar solo «exacto» sería
 * mentir sobre la cobertura.
 *
 * El muestreo es **ponderado por área** y publica su `samples`, que es lo que el
 * §86.3 (k) exige: un ratio sin decir cuántas muestras lo sostienen no se puede
 * juzgar cerca de un umbral.
 *
 * ## Qué no hace
 *
 * No repara, no decide si el resultado es aceptable y **no compara contra un
 * presupuesto**: eso es R9, y necesita la escala (D9). Aquí las distancias salen
 * en unidades del paquete y acompañadas de la diagonal de la caja, para que quien
 * las lea pueda hacerlas relativas sin recalcular una caja que podría no ser la
 * misma.
 */

import { buildTriangleBoundsTree, nearestPoint } from "../boundsTree";
import type { Mesh } from "../../mesh";
import { auditMesh } from "../inspect";

/**
 * El suelo por debajo del cual una distancia de este módulo no significa nada.
 *
 * Relativo a la diagonal de la caja, porque el error de redondeo escala con la
 * magnitud de las coordenadas. **Medido**: una malla contra sí misma da 2,0e-16
 * sobre un cubo de lado 1 y 3,2e-13 sobre uno de lado 1000, o sea 1,2e-16 y
 * 1,9e-16 relativos a su diagonal. El valor deja algo más del doble de margen.
 *
 * No es cero **y no puede serlo**: el punto de muestra se construye con
 * coordenadas baricéntricas en doble, y el árbol busca sobre las posiciones en
 * `Float32`. Afirmar cero exacto sería afirmar más de lo que la aritmética
 * sostiene, que es la misma lección de `aproximacion-determinista`.
 *
 * **Es el suelo de las mallas tal y como llegan, no de una escena.** Medido sobre
 * el dron —296 piezas, cada una con su matriz, aplanadas a espacio de mundo por
 * el CLI—, comparar el modelo consigo mismo da entre **1e-14 y 1e-13 de la
 * diagonal**, dos o tres órdenes por encima de este número. Crece con el número
 * de muestras, porque más muestras encuentran peores casos: con 2.000 sale 2,8e-14
 * y con 4.000, 2,2e-13. No es un defecto — componer una transformación por pieza
 * añade su redondeo, y una malla densa da más candidatos coincidentes al buscar
 * el más próximo—, pero **el suelo de aquí no sirve de tolerancia allí**. Por eso
 * el CLI publica `worstRelative`: el consumidor compara contra lo que mide, no
 * contra una constante que se midió en otro sitio.
 */
export const DIFF_NOISE_FLOOR = 4e-16;

export interface SurfaceDistance {
  /** Muestras que sostienen estos números; sin él, el máximo no se puede juzgar. */
  samples: number;
  /** La peor distancia encontrada. Es la que describe el defecto puntual. */
  maximum: number;
  /** La media, que describe el desplazamiento global y no el pico. */
  mean: number;
  /**
   * Raíz del error cuadrático medio. Está porque separa «casi todo bien con un
   * pico» de «todo mal por poco»: con la misma media, la primera tiene RMS bajo y
   * la segunda alto.
   */
  rms: number;
  /** Desviación de normales en grados, en los mismos puntos. */
  normalDeviationDegrees: { maximum: number; mean: number };
}

export interface TopologyDelta {
  vertices: number;
  triangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  duplicatePositions: number;
  /** Volumen firmado de B menos el de A. */
  signedVolume: number;
  /** `null` si las dos coinciden; si no, qué pasó a qué. */
  watertight: { from: boolean; to: boolean } | null;
}

export interface MeshDiff {
  /** Los dos ejes de D28: qué clase de medida es, y con qué reproducibilidad. */
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  /** Semilla del muestreo. Publicada porque sin ella el número no se reproduce. */
  seed: number;
  /**
   * Suelo de ruido **ya en unidades de estas mallas**: por debajo de aquí una
   * distancia es redondeo. Se publica multiplicado y no como fracción para que
   * quien lea el informe pueda compararlo con `maximum` sin hacer cuentas.
   */
  noiseFloor: number;
  /**
   * Diagonal de la caja que contiene a las dos mallas. Es el denominador con el
   * que estas distancias se vuelven relativas, y va aquí para que nadie tenga que
   * recalcular una caja que podría no ser la misma (D9).
   */
  boundingBoxDiagonal: number;
  /** Muestreando A y buscando en B: lo que a B **le falta** de A. */
  aToB: SurfaceDistance;
  /** Muestreando B y buscando en A: lo que a B **le sobra**. */
  bToA: SurfaceDistance;
  topology: TopologyDelta;
}

/**
 * El mismo generador que usa el muestreo de superficie del banco, y no uno nuevo:
 * dos PRNG en el mismo repositorio son dos conjuntos de muestras que nadie puede
 * comparar entre sí.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleSet {
  points: Float64Array;
  normals: Float64Array;
  count: number;
}

/** Normal geométrica de un triángulo, sin normalizar, y su doble área. */
function triangleNormal(mesh: Mesh, triangle: number): [number, number, number] {
  const { positions, indices } = mesh;
  const a = indices[triangle * 3] * 3;
  const b = indices[triangle * 3 + 1] * 3;
  const c = indices[triangle * 3 + 2] * 3;
  const abx = positions[b] - positions[a];
  const aby = positions[b + 1] - positions[a + 1];
  const abz = positions[b + 2] - positions[a + 2];
  const acx = positions[c] - positions[a];
  const acy = positions[c + 1] - positions[a + 1];
  const acz = positions[c + 2] - positions[a + 2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/**
 * Muestreo de la superficie, ponderado por área.
 *
 * Ponderado y no uniforme por triángulo: sin el área, mil triángulos diminutos de
 * una esquina pesarían lo mismo que la cara entera, y el informe describiría la
 * esquina. Es la misma razón por la que el muestreo del banco pesa por √área.
 *
 * El recorrido para elegir triángulo es **lineal y no binario**, igual que allí y
 * por el mismo motivo: con una suma acumulada y búsqueda binaria el orden de las
 * sumas cambia, y en el borde entre dos triángulos eso elige el otro. Sería más
 * rápido y movería el número.
 */
function sampleMesh(mesh: Mesh, count: number, seed: number): SampleSet {
  const random = mulberry32(seed);
  const triangles = mesh.indices.length / 3;
  const areas = new Float64Array(triangles);
  let total = 0;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const [nx, ny, nz] = triangleNormal(mesh, triangle);
    areas[triangle] = Math.hypot(nx, ny, nz) / 2;
    total += areas[triangle];
  }

  const points = new Float64Array(count * 3);
  const normals = new Float64Array(count * 3);
  if (total === 0) return { points, normals, count: 0 };

  const { positions, indices } = mesh;
  for (let sample = 0; sample < count; sample += 1) {
    let pick = random() * total;
    let chosen = triangles - 1;
    for (let candidate = 0; candidate < triangles; candidate += 1) {
      pick -= areas[candidate];
      if (pick <= 0) {
        chosen = candidate;
        break;
      }
    }

    // Coordenadas baricéntricas uniformes sobre el triángulo: la raíz es lo que
    // evita que las muestras se apelotonen en una esquina.
    let u = random();
    let v = random();
    const root = Math.sqrt(u);
    u = 1 - root;
    v = v * root;
    const w = 1 - u - v;

    const a = indices[chosen * 3] * 3;
    const b = indices[chosen * 3 + 1] * 3;
    const c = indices[chosen * 3 + 2] * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      points[sample * 3 + axis] =
        u * positions[a + axis] + v * positions[b + axis] + w * positions[c + axis];
    }
    const [nx, ny, nz] = triangleNormal(mesh, chosen);
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[sample * 3] = nx / length;
    normals[sample * 3 + 1] = ny / length;
    normals[sample * 3 + 2] = nz / length;
  }

  return { points, normals, count };
}

/**
 * Distancia de las muestras de una malla a la superficie de la otra.
 *
 * La reducción va **en orden de índice de muestra**, nunca según llegue nada: es
 * la regla que `test:bands` fija para el reparto, y sumar en otro orden da otro
 * último bit sobre millones de muestras.
 */
function distanceTo(samples: SampleSet, target: Mesh): SurfaceDistance {
  const tree = buildTriangleBoundsTree(target);
  let maximum = 0;
  let sum = 0;
  let squares = 0;
  let angleMaximum = 0;
  let angleSum = 0;
  let measured = 0;

  for (let sample = 0; sample < samples.count; sample += 1) {
    const point = [samples.points[sample * 3], samples.points[sample * 3 + 1], samples.points[sample * 3 + 2]];
    const hit = nearestPoint(tree, point);
    if (hit === null) continue;
    const distance = Math.sqrt(hit.distanceSquared);
    maximum = Math.max(maximum, distance);
    sum += distance;
    squares += distance * distance;

    // La desviación se mide **sin signo**: una cara con el bobinado invertido
    // tendría 180° y eso es un defecto de topología, no de forma. Lo dice
    // `MALLA_INVERTIDA`, que es quien sabe de bobinados.
    const [nx, ny, nz] = triangleNormal(target, hit.triangle);
    const length = Math.hypot(nx, ny, nz) || 1;
    const dot =
      (samples.normals[sample * 3] * nx +
        samples.normals[sample * 3 + 1] * ny +
        samples.normals[sample * 3 + 2] * nz) /
      length;
    const angle = (Math.acos(Math.min(1, Math.max(-1, Math.abs(dot)))) * 180) / Math.PI;
    angleMaximum = Math.max(angleMaximum, angle);
    angleSum += angle;
    measured += 1;
  }

  const divisor = measured || 1;
  return {
    samples: measured,
    maximum,
    mean: sum / divisor,
    rms: Math.sqrt(squares / divisor),
    normalDeviationDegrees: { maximum: angleMaximum, mean: angleSum / divisor },
  };
}

/** Caja que contiene las dos mallas, para dar el denominador relativo. */
function diagonalOf(a: Mesh, b: Mesh): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of [a, b]) {
    for (let index = 0; index < mesh.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[index + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[index + axis]);
      }
    }
  }
  if (!Number.isFinite(min[0])) return 0;
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

export interface MeshDiffOptions {
  /** Muestras por dirección. Se publica en el informe, no se supone. */
  samples?: number;
  seed?: number;
}

/**
 * Compara dos mallas. `a` es la referencia —lo reconstruido— y `b` lo que se
 * quiere juzgar —lo reparado—, y el orden importa porque las dos direcciones
 * dicen cosas distintas.
 */
export function diffMeshes(a: Mesh, b: Mesh, options: MeshDiffOptions = {}): MeshDiff {
  const samples = options.samples ?? 20_000;
  const seed = options.seed ?? 1;
  const auditA = auditMesh(a);
  const auditB = auditMesh(b);
  const diagonal = diagonalOf(a, b);

  return {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    seed,
    noiseFloor: DIFF_NOISE_FLOOR * diagonal,
    boundingBoxDiagonal: diagonal,
    // Semillas distintas por dirección: con la misma, las dos nubes caen en los
    // mismos parámetros baricéntricos y dos mallas parecidas darían muestras
    // correlacionadas, que es medir dos veces lo mismo.
    aToB: distanceTo(sampleMesh(a, samples, seed), b),
    bToA: distanceTo(sampleMesh(b, samples, seed + 1), a),
    topology: {
      vertices: auditB.vertices - auditA.vertices,
      triangles: auditB.triangles - auditA.triangles,
      boundaryEdges: auditB.boundaryEdges - auditA.boundaryEdges,
      nonManifoldEdges: auditB.nonManifoldEdges - auditA.nonManifoldEdges,
      degenerateTriangles: auditB.degenerateTriangles - auditA.degenerateTriangles,
      duplicatePositions: auditB.duplicatePositions - auditA.duplicatePositions,
      signedVolume: auditB.signedVolume - auditA.signedVolume,
      watertight:
        auditA.watertight === auditB.watertight
          ? null
          : { from: auditA.watertight, to: auditB.watertight },
    },
  };
}
