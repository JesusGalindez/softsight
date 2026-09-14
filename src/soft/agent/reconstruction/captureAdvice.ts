/**
 * R9 — desde dónde hay que disparar la próxima foto.
 *
 * La cobertura dice «el 27 % no lo vio nadie» y ahí se acaba. Quien está en el
 * campo con el dron necesita la pregunta siguiente, que es la única accionable:
 * **¿dónde me pongo?**
 *
 * ## La propiedad que hace que esto valga algo
 *
 * La ganancia **no se estima: se mide**. Cada sugerencia trae una cámara
 * completa, y el número que la acompaña sale de meterla en el CameraSet y volver
 * a contar con la misma aritmética que juzgará el resultado. Así que no es una
 * promesa sobre el futuro, es una medida sobre una hipótesis — y una puerta la
 * comprueba añadiendo la cámara devuelta y exigiendo que el número salga
 * **idéntico**.
 *
 * Un consejo que dijera «prueba por aquí, seguramente mejore» no se puede
 * verificar ni desmentir, y eso es exactamente lo que no queremos producir.
 *
 * ## Lo que no hace, y la línea es la misma que la de R10
 *
 * **No planifica un vuelo.** No sabe de obstáculos, de alcance, de batería, de
 * espacio aéreo ni de si desde ese punto se puede estar. Dice «desde aquí verías
 * esto»; decidir si se puede ir es de quien conoce el sitio. En cuanto empezara a
 * elegir rutas dejaría de poder afirmar que sus números son exactos, que es todo
 * lo que aporta.
 *
 * Y **no inventa una lente**: los intrínsecos se copian de una cámara existente y
 * se dice de cuál. Una focal inventada daría una ganancia que ninguna cámara real
 * puede cobrar.
 *
 * La cámara que sale **no trae imagen**, y eso no es un hueco: la foto todavía no
 * existe, que es el trabajo que se está aconsejando. Quien la haga completa
 * `imageArtifactId`, su hash y el `model` del paquete —que sale de la distorsión:
 * con coeficientes es `OPENCV` y sin ellos `PINHOLE`, la misma regla que usa el
 * productor de COLMAP—.
 *
 * ## Las tres carencias piden cosas distintas
 *
 * ```text
 * SIN_EVIDENCIA     nadie la ve            una cámara sobre su normal
 * SIN_TRIANGULAR    la ve una sola          una segunda, separada de la que hay
 * PARALAJE_CORTO    la ven juntas           una separada por la base que falta
 * ```
 *
 * Las dos últimas no se arreglan poniendo otra cámara de frente: si la nueva cae
 * al lado de la que ya estaba, el paralaje sigue siendo corto y la profundidad
 * sigue sin determinarse. La base se **deriva** del ángulo que falta:
 * `b = 2·d·tan(θ/2)`.
 */

import { buildTriangleBoundsTree, type TriangleBoundsTree } from "../boundsTree";
import type { Mesh } from "../../mesh";
import type { PackageCamera } from "./camera";
import {
  COVERAGE_RAY_OFFSET,
  computeVisibility,
  seesPoint,
  type CoverageOptions,
  type SurfaceVisibility,
} from "./coverage";
import { DEFAULT_PARALLAX_DEGREES } from "./confidence";

/**
 * Radio de agrupación, en fracción de la diagonal de la pieza.
 *
 * Las muestras sueltas no son un consejo: «hay 1.842 puntos sin ver» no se puede
 * ejecutar. Se agrupan en regiones, y el radio dice qué de cerca tienen que estar
 * dos carencias para arreglarse con la misma foto. Un décimo de la diagonal es el
 * orden de lo que una vista abarca cuando está a la distancia de las demás.
 */
export const REGION_RADIUS_RATIO = 0.1;

/** Cuántas sugerencias se devuelven como mucho, de mayor a menor área. */
export const MAX_SUGGESTIONS = 8;

/**
 * Suelo de área de una región, en fracción del total.
 *
 * Por debajo, la propia medida no la distingue del ruido de muestreo — es el
 * mismo suelo que el de los avisos, y por el mismo motivo: mandar a alguien a
 * volar por un 0,3 % que quizá no exista es peor que callarlo.
 */
export const MIN_REGION_AREA_RATIO = 0.01;

export type CaptureReason = "SIN_EVIDENCIA" | "SIN_TRIANGULAR" | "PARALAJE_CORTO";

export interface CaptureRegion {
  /** Fracción del área total que la región ocupa. */
  areaRatio: number;
  samples: number;
  /** Centroide y normal media, en el marco en el que vino la malla. */
  centroid: [number, number, number];
  normal: [number, number, number];
  /** Diagonal de la caja de la región: cuánto ocupa lo que falta. */
  extent: number;
}

export interface CaptureSuggestion {
  reason: CaptureReason;
  region: CaptureRegion;
  /** La cámara propuesta, entera, para poder medirla en vez de creérsela. */
  camera: PackageCamera;
  /** De qué cámara se copiaron los intrínsecos. No se inventa ninguna lente. */
  intrinsicsFrom: string;
  /** Distancia a la que se propone, en unidades del paquete. */
  distance: number;
  /**
   * Qué gana el paquete si la foto se hace. **Medido** metiendo la cámara en el
   * CameraSet y volviendo a contar, no estimado.
   */
  gain: {
    /** Los tres ratios **tras esta foto y todas las anteriores del plan**. */
    observedAreaRatio: number;
    triangulatedAreaRatio: number;
    /** La que además triangula por encima del suelo de paralaje. */
    supportedAreaRatio: number;
    /** Lo que esta foto añade sobre las anteriores. Sumarlas contaría dos veces. */
    deltaObserved: number;
    deltaTriangulated: number;
    deltaSupported: number;
  };
}

export interface CaptureAdvice {
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  seed: number;
  samples: number;
  areaWeighted: true;
  /** El suelo de paralaje que se usó para decidir qué base pedir. */
  parallaxThresholdDegrees: number;
  suggestions: CaptureSuggestion[];
  /**
   * Fracción del déficit —lo no observado más lo no triangulado— que las
   * sugerencias juntas cubrirían. **No es la suma de las ganancias**: dos fotos
   * pueden recuperar la misma región, y sumarlas contaría esa región dos veces.
   */
  coversDeficit: number;
  /** Lo que quedaría fuera aunque se hicieran todas. */
  reason?: string;
}

export interface CaptureAdviceOptions extends CoverageOptions {
  parallaxThresholdDegrees?: number;
  maxSuggestions?: number;
}

/** Vector unitario. Longitud cero devuelve el mismo vector, no NaN. */
function normalize(v: number[]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Pose de una cámara que mira desde `eye` hacia `target`, en la convención que se
 * le pida.
 *
 * El **alabeo** —girar sobre el eje óptico— no lo determina nada de lo que aquí
 * se pide, así que se fija: mundo +Y como arriba, y +Z cuando la vista es casi
 * vertical y +Y no sirve para orientar. Elegirlo de otra forma daría otra pose
 * igual de válida, y la sugerencia dejaría de ser reproducible. En una imagen que
 * no sea cuadrada, además, mueve un poco lo que entra por las esquinas.
 */
export function lookAtPose(
  eye: readonly number[],
  target: readonly number[],
  axes: PackageCamera["cameraAxes"],
): number[] {
  const forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const worldUp = Math.abs(forward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(forward, worldUp));
  const up = cross(right, forward);

  // Los ejes del contrato, tal cual D10 los nombra: en el marco de gráficos la
  // cámara mira a −Z con la Y hacia arriba; en el de visión, a +Z con la Y hacia
  // abajo. La matriz lleva los ejes **en columnas**, que es lo que convierte del
  // marco de la cámara al del mundo.
  const grafico = axes === "X_RIGHT_Y_UP_Z_BACKWARD";
  const x = right;
  const y = grafico ? up : [-up[0], -up[1], -up[2]];
  const z = grafico ? [-forward[0], -forward[1], -forward[2]] : forward;

  return [
    x[0], y[0], z[0], eye[0],
    x[1], y[1], z[1], eye[1],
    x[2], y[2], z[2], eye[2],
    0, 0, 0, 1,
  ];
}

/** Centro de una cámara: la traslación de la pose, en 3, 7 y 11 (D32). */
function eyeOf(camera: PackageCamera): [number, number, number] {
  return [camera.worldFromCamera[3], camera.worldFromCamera[7], camera.worldFromCamera[11]];
}

/**
 * Agrupa muestras deficientes en regiones, por cercanía y de forma determinista.
 *
 * Siembra con la primera muestra libre **en orden de índice** y se lleva todas
 * las que caen a menos del radio. No es agrupamiento óptimo y no pretende serlo:
 * lo que hace falta es que dos ejecuciones den las mismas regiones, y un método
 * con centroides móviles depende de por dónde empieza.
 */
function agrupar(
  visibility: SurfaceVisibility,
  indices: number[],
  radius: number,
): CaptureRegion[] {
  const tomadas = new Set<number>();
  const regiones: CaptureRegion[] = [];

  for (const seed of indices) {
    if (tomadas.has(seed)) continue;
    const centro = [
      visibility.points[seed * 3],
      visibility.points[seed * 3 + 1],
      visibility.points[seed * 3 + 2],
    ];
    const miembros: number[] = [];
    for (const other of indices) {
      if (tomadas.has(other)) continue;
      const dx = visibility.points[other * 3] - centro[0];
      const dy = visibility.points[other * 3 + 1] - centro[1];
      const dz = visibility.points[other * 3 + 2] - centro[2];
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      miembros.push(other);
      tomadas.add(other);
    }

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const member of miembros) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = visibility.points[member * 3 + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
      cx += visibility.points[member * 3];
      cy += visibility.points[member * 3 + 1];
      cz += visibility.points[member * 3 + 2];
      nx += visibility.normals[member * 3];
      ny += visibility.normals[member * 3 + 1];
      nz += visibility.normals[member * 3 + 2];
    }
    const count = miembros.length;
    regiones.push({
      areaRatio: count / visibility.count,
      samples: count,
      centroid: [cx / count, cy / count, cz / count],
      // La normal media de una región muy curvada es corta, y entonces no
      // describe una dirección de mirada. `normalize` la deja unitaria igual; lo
      // que la región no puede es arreglarse con una sola foto, y eso lo dice su
      // `extent` comparado con el radio.
      normal: normalize([nx, ny, nz]),
      extent: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
    });
  }
  return regiones;
}

export function computeCaptureAdvice(
  mesh: Mesh,
  cameras: readonly PackageCamera[],
  options: CaptureAdviceOptions = {},
): CaptureAdvice {
  const visibility: SurfaceVisibility = options.visibility ?? computeVisibility(mesh, cameras, options);
  const threshold = options.parallaxThresholdDegrees ?? DEFAULT_PARALLAX_DEGREES;
  const limite = options.maxSuggestions ?? MAX_SUGGESTIONS;
  const seed = options.seed ?? 1;

  const base: CaptureAdvice = {
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    seed,
    samples: visibility.count,
    areaWeighted: true,
    parallaxThresholdDegrees: threshold,
    suggestions: [],
    coversDeficit: 0,
  };

  // Sin cámaras no hay lente que copiar, y por tanto no hay consejo que dar. Se
  // dice con su motivo: un consejo vacío se leería como «no hace falta nada».
  if (cameras.length === 0) {
    return { ...base, reason: "SIN_CAMARA_DE_REFERENCIA" };
  }

  const tree: TriangleBoundsTree = options.tree ?? buildTriangleBoundsTree(mesh);
  const offset = COVERAGE_RAY_OFFSET * (visibility.magnitude || 1);

  // Diagonal de la pieza, que fija el radio de agrupación y la escala de todo.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const radius = REGION_RADIUS_RATIO * diagonal;

  // Las tres carencias, separadas porque piden fotos distintas.
  const sinEvidencia: number[] = [];
  const sinTriangular: number[] = [];
  const paralajeCorto: number[] = [];
  // El ángulo de triangulación que cada muestra tiene **hoy**, en grados. Cero
  // cuando no hay par que lo forme. Se guarda porque el consejo tiene que saber
  // no solo si una muestra triangula, sino si lo hace con autoridad — y esa es la
  // tercera cosa que una foto puede ganar.
  const anchoActual = new Float64Array(visibility.count);
  for (let sample = 0; sample < visibility.count; sample += 1) {
    const visible = visibility.seenBy[sample];
    if (visible.length === 0) {
      sinEvidencia.push(sample);
      continue;
    }
    if (visible.length === 1) {
      sinTriangular.push(sample);
      continue;
    }
    // El mayor ángulo entre dos rayos, igual que en la confianza: es el par que
    // mejor triangula, y es el que decide qué se puede afirmar.
    const point = [
      visibility.points[sample * 3],
      visibility.points[sample * 3 + 1],
      visibility.points[sample * 3 + 2],
    ];
    const rays = visible.map((index) => {
      const eye = eyeOf(cameras[index]);
      return normalize([eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]]);
    });
    let widest = 0;
    for (let a = 0; a < rays.length; a += 1) {
      for (let b = a + 1; b < rays.length; b += 1) {
        const dot = rays[a][0] * rays[b][0] + rays[a][1] * rays[b][1] + rays[a][2] * rays[b][2];
        widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot))));
      }
    }
    anchoActual[sample] = (widest * 180) / Math.PI;
    if (anchoActual[sample] < threshold) paralajeCorto.push(sample);
  }

  const deficit = sinEvidencia.length + sinTriangular.length + paralajeCorto.length;
  if (deficit === 0) {
    return { ...base, reason: "SIN_CARENCIA_QUE_CUBRIR" };
  }

  // La lente de referencia: la mediana por focal, para no copiar la más rara.
  // Se ordena por focal y se desempata por identidad, que no depende del orden en
  // que el paquete las escribió.
  const porFocal = [...cameras].sort(
    (a, b) => a.intrinsics.fx - b.intrinsics.fx || (a.id ?? "").localeCompare(b.id ?? ""),
  );
  const lente = porFocal[Math.floor(porFocal.length / 2)];

  /** Distancia típica de las cámaras que sí ven algo, para no cambiar de escala. */
  let distanciaTipica = 0;
  let vistas = 0;
  for (let sample = 0; sample < visibility.count; sample += 1) {
    const visible = visibility.seenBy[sample];
    if (visible.length === 0) continue;
    const eye = eyeOf(cameras[visible[0]]);
    distanciaTipica += Math.hypot(
      eye[0] - visibility.points[sample * 3],
      eye[1] - visibility.points[sample * 3 + 1],
      eye[2] - visibility.points[sample * 3 + 2],
    );
    vistas += 1;
  }
  // Sin ninguna vista de referencia —nadie ve nada— la distancia sale de la
  // pieza: media diagonal es lo que encuadra un objeto con una lente normal.
  const distancia = vistas > 0 ? distanciaTipica / vistas : diagonal;

  // **Cada carencia compite dentro de la suya, y solo después entre ellas.**
  //
  // Sin esto, la más extendida se queda con todas las plazas de candidata: en un
  // paquete donde falta media superficie, `SIN_EVIDENCIA` cubre cien veces más
  // área que el paralaje corto, así que las de base no llegarían nunca a medirse
  // — y el consejo no diría jamás «sepárate», que es la mitad de lo que R9 sabe.
  // Medir cuesta un rayo por muestra, así que el cupo por carencia es lo que hace
  // falta reservar; la competición de verdad es la de la ganancia, y esa ya pasa
  // después con todas medidas.
  const candidatas: Array<{ reason: CaptureReason; region: CaptureRegion; indices: number[] }> = [];
  const acumular = (reason: CaptureReason, indices: number[]) => {
    if (indices.length === 0) return;
    const suyas = agrupar(visibility, indices, radius)
      .filter((region) => region.areaRatio >= MIN_REGION_AREA_RATIO)
      // Por área y con desempate por centroide: dentro de una carencia, lo único
      // que se sabe antes de medir es cuánta superficie hay.
      .sort((a, b) => b.areaRatio - a.areaRatio || a.centroid[0] - b.centroid[0])
      // El doble del cupo: con tantas candidatas como plazas, el reparto no
      // elegiría nada —solo ordenaría—, y el orden por ganancia medida dejaría de
      // decidir. Medir cuesta un rayo por muestra, así que el doble es lo que se
      // puede pagar para que elija de verdad.
      .slice(0, limite * 2);
    for (const region of suyas) candidatas.push({ reason, region, indices });
  };
  acumular("SIN_EVIDENCIA", sinEvidencia);
  acumular("SIN_TRIANGULAR", sinTriangular);
  acumular("PARALAJE_CORTO", paralajeCorto);

  const medidas = candidatas.map((candidata, orden) => {
    const { region, reason } = candidata;

    // Dónde ponerla. Sobre la normal si no la ve nadie; desplazada de la vista
    // que ya existe cuando lo que falta es base.
    let eye: number[];
    if (reason === "SIN_EVIDENCIA") {
      eye = [
        region.centroid[0] + region.normal[0] * distancia,
        region.centroid[1] + region.normal[1] * distancia,
        region.centroid[2] + region.normal[2] * distancia,
      ];
    } else {
      // La base que falta para llegar al umbral, desde la cámara que ya ve la
      // región. `b = 2·d·tan(θ/2)` es el lado de un triángulo isósceles con el
      // ángulo pedido en el vértice, que es exactamente la geometría del par.
      const referencia = eyeOf(cameras[visibility.seenBy[candidata.indices[0]][0]]);
      const haciaCamara = normalize([
        referencia[0] - region.centroid[0],
        referencia[1] - region.centroid[1],
        referencia[2] - region.centroid[2],
      ]);
      // Perpendicular a la vista y lo más horizontal posible: desplazarse de lado
      // es lo que un operador puede hacer, y subir no siempre.
      const lateral = normalize(
        cross(haciaCamara, Math.abs(haciaCamara[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0]),
      );
      const distanciaReferencia = Math.hypot(
        referencia[0] - region.centroid[0],
        referencia[1] - region.centroid[1],
        referencia[2] - region.centroid[2],
      );
      const baseline = 2 * distanciaReferencia * Math.tan((threshold * Math.PI) / 360);
      eye = [
        referencia[0] + lateral[0] * baseline,
        referencia[1] + lateral[1] * baseline,
        referencia[2] + lateral[2] * baseline,
      ];
    }

    // Se copian **los campos de la lente y nada más**. Extender la cámara de
    // referencia entera arrastraría su `imageArtifactId` y su hash, y la
    // sugerencia diría ser la foto que ya existe. Una cámara propuesta **no
    // tiene imagen**: ese es justo el trabajo que queda por hacer.
    const camera: PackageCamera = {
      // El número definitivo se pone al aceptarla: el orden del plan lo decide
      // la ganancia medida, no el del recorrido de candidatas.
      id: `candidata-${orden + 1}`,
      width: lente.width,
      height: lente.height,
      pixelOrigin: lente.pixelOrigin,
      pixelCenter: lente.pixelCenter,
      cameraAxes: lente.cameraAxes,
      intrinsics: { ...lente.intrinsics },
      ...(lente.distortion === undefined ? {} : { distortion: { ...lente.distortion } }),
      worldFromCamera: lookAtPose(eye, region.centroid, lente.cameraAxes),
    };

    // **Qué ve, medido.** Una pasada de un rayo por muestra. Lo que ven las otras
    // cámaras ya está calculado y no cambia porque se añada una, así que este
    // conjunto es todo lo que hace falta y se calcula **una sola vez**: el
    // reparto de abajo lo reutiliza sin lanzar un rayo más.
    const ve: boolean[] = new Array(visibility.count).fill(false);
    for (let sample = 0; sample < visibility.count; sample += 1) {
      const point = [
        visibility.points[sample * 3],
        visibility.points[sample * 3 + 1],
        visibility.points[sample * 3 + 2],
      ];
      const normal = [
        visibility.normals[sample * 3],
        visibility.normals[sample * 3 + 1],
        visibility.normals[sample * 3 + 2],
      ];
      ve[sample] = seesPoint(camera, tree, point, normal, offset);
    }

    return {
      reason,
      region,
      camera,
      ve,
      distance: Math.hypot(
        eye[0] - region.centroid[0],
        eye[1] - region.centroid[1],
        eye[2] - region.centroid[2],
      ),
    };
  });

  // **El reparto es codicioso, y por eso la lista es un plan y no un catálogo.**
  //
  // Varias vistas recuperan la misma cara, así que dar la ganancia de cada una
  // contra el estado de hoy invita a sumarlas — y sumarlas cuenta esa cara dos
  // veces. Lo que sale es: la mejor primero, y cada número es lo que **esa foto
  // añade sobre las anteriores**. Hacerlas en orden da exactamente los ratios
  // publicados.
  const suggestions: CaptureSuggestion[] = [];
  // Quién ve cada muestra, incluidas las sugerencias ya aceptadas. Por índice
  // sobre `activos`, que crece con el plan: una sugerencia aceptada es una cámara
  // más a todos los efectos, y la siguiente tiene que contar con ella.
  const activos: PackageCamera[] = [...cameras];
  const vistaPor: number[][] = visibility.seenBy.map((visible) => [...visible]);
  const pendientes = new Set(medidas.keys());
  let observadas = visibility.count - sinEvidencia.length;
  let trianguladas = visibility.count - sinEvidencia.length - sinTriangular.length;
  let sostenidas = 0;
  for (let sample = 0; sample < visibility.count; sample += 1) {
    if (anchoActual[sample] >= threshold) sostenidas += 1;
  }
  const cubiertas = new Set<number>();

  /** Rayo unitario de una cámara a una muestra, que es como se mide el ángulo. */
  const rayo = (eye: readonly number[], sample: number): [number, number, number] =>
    normalize([
      eye[0] - visibility.points[sample * 3],
      eye[1] - visibility.points[sample * 3 + 1],
      eye[2] - visibility.points[sample * 3 + 2],
    ]);

  /** El mayor ángulo, en grados, entre un rayo nuevo y los que ya ven la muestra. */
  const anchoCon = (nuevo: readonly number[], sample: number): number => {
    let mayor = 0;
    for (const index of vistaPor[sample]) {
      const otro = rayo(eyeOf(activos[index]), sample);
      const dot = nuevo[0] * otro[0] + nuevo[1] * otro[1] + nuevo[2] * otro[2];
      mayor = Math.max(mayor, Math.acos(Math.min(1, Math.max(-1, dot))));
    }
    return (mayor * 180) / Math.PI;
  };

  while (suggestions.length < limite && pendientes.size > 0) {
    let mejor = -1;
    let mejorObservadas = 0;
    let mejorTrianguladas = 0;
    let mejorSostenidas = 0;
    for (const index of pendientes) {
      const medida = medidas[index];
      const eye = eyeOf(medida.camera);
      let ganaObservadas = 0;
      let ganaTrianguladas = 0;
      let ganaSostenidas = 0;
      for (let sample = 0; sample < visibility.count; sample += 1) {
        if (!medida.ve[sample]) continue;
        const total = vistaPor[sample].length;
        if (total === 0) {
          // Sola no forma par, así que no puede sostener nada todavía.
          ganaObservadas += 1;
          continue;
        }
        if (total === 1) ganaTrianguladas += 1;
        // **La tercera ganancia**, y la que faltaba: llevar una región que ya
        // triangulaba de mala manera a un ángulo que determina la profundidad.
        // Sin contarla, una sugerencia de base no ganaba nunca nada y el consejo
        // no sabía decir «sepárate» aunque el paquete entero fuera paralaje
        // corto.
        if (anchoActual[sample] < threshold && anchoCon(rayo(eye, sample), sample) >= threshold) {
          ganaSostenidas += 1;
        }
      }
      // Lexicográfico, y el orden es el de la fuerza de la evidencia: primero que
      // haya foto, luego que triangule, luego que triangule con autoridad. Cambiar
      // el orden mandaría a afinar lo que ya se ve antes de ir a lo que nadie vio.
      if (
        ganaObservadas > mejorObservadas ||
        (ganaObservadas === mejorObservadas &&
          (ganaTrianguladas > mejorTrianguladas ||
            (ganaTrianguladas === mejorTrianguladas && ganaSostenidas > mejorSostenidas)))
      ) {
        mejor = index;
        mejorObservadas = ganaObservadas;
        mejorTrianguladas = ganaTrianguladas;
        mejorSostenidas = ganaSostenidas;
      }
    }
    if (mejor < 0 || (mejorObservadas === 0 && mejorTrianguladas === 0 && mejorSostenidas === 0)) break;

    const medida = medidas[mejor];
    pendientes.delete(mejor);
    const eye = eyeOf(medida.camera);
    const indiceNuevo = activos.length;
    activos.push(medida.camera);
    for (let sample = 0; sample < visibility.count; sample += 1) {
      if (!medida.ve[sample]) continue;
      if (vistaPor[sample].length < 2) cubiertas.add(sample);
      else if (anchoActual[sample] < threshold) cubiertas.add(sample);
      if (vistaPor[sample].length > 0) {
        anchoActual[sample] = Math.max(anchoActual[sample], anchoCon(rayo(eye, sample), sample));
      }
      vistaPor[sample].push(indiceNuevo);
    }
    observadas += mejorObservadas;
    trianguladas += mejorTrianguladas;
    sostenidas += mejorSostenidas;

    suggestions.push({
      reason: medida.reason,
      region: medida.region,
      camera: { ...medida.camera, id: `sugerida-${suggestions.length + 1}` },
      intrinsicsFrom: lente.id ?? "sin-identidad",
      distance: medida.distance,
      gain: {
        observedAreaRatio: observadas / visibility.count,
        triangulatedAreaRatio: trianguladas / visibility.count,
        supportedAreaRatio: sostenidas / visibility.count,
        deltaObserved: mejorObservadas / visibility.count,
        deltaTriangulated: mejorTrianguladas / visibility.count,
        deltaSupported: mejorSostenidas / visibility.count,
      },
    });
  }

  // Lo que cubren **juntas**, contando cada muestra una vez. Sumar las ganancias
  // contaría dos veces la región que dos fotos recuperan.
  const coversDeficit = cubiertas.size / deficit;
  return {
    ...base,
    suggestions,
    coversDeficit,
    ...(suggestions.length === 0 ? { reason: "NINGUNA_VISTA_DERIVABLE_GANA_SUPERFICIE" } : {}),
  };
}
