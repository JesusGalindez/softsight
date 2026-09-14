/**
 * R12 — la silueta, que es donde un nivel de detalle se nota o no se nota.
 *
 * ## Por qué la distancia de superficie no basta
 *
 * Un LOD que se desvía el 2 % dentro de una pared plana es invisible: la
 * superficie se mueve hacia dentro de sí misma y ningún píxel cambia. El mismo
 * 2 % en un borde contra el cielo es un temblor que se ve desde lejos. La
 * distancia de R5 no distingue los dos casos —**mide el mismo número**— porque no
 * sabe desde dónde se mira.
 *
 * Así que la fidelidad de silueta se mide donde ocurre: **en píxeles**, contando
 * qué cubre cada malla desde una misma vista.
 *
 * ## Ortográfica, y no es un atajo
 *
 * Una cámara en perspectiva obliga a elegir una distancia, y esa distancia decide
 * el resultado: lo mismo se ve peor de cerca. Un asset de producción no declara
 * desde dónde se le va a mirar, así que elegirla aquí sería inventarse el dato
 * que falta. La ortográfica ajustada a la caja **común a las dos mallas** da una
 * comparación sin distancia: el píxel mide lo mismo para las dos, que es la única
 * condición que la comparación necesita.
 *
 * ## Catorce vistas, y por qué no una
 *
 * Una vista contesta por una silueta; un LOD puede estar impecable de frente y
 * roto de perfil. Las catorce son las seis de los ejes más las ocho de las
 * esquinas del cubo: **cubren las direcciones en que una pieza alineada se mira**,
 * y salen de la geometría en vez de un muestreo, así que dos ejecuciones ven
 * exactamente lo mismo. No pretenden ser la esfera entera; pretenden no dejar una
 * cara sin mirar.
 *
 * ## Lo que se publica, y por qué son dos números
 *
 * Lo que la silueta **perdió** y lo que **ganó**, separados y nunca promediados.
 * Un LOD que se come una antena y otro que engorda un brazo tienen el mismo error
 * simétrico y se arreglan de forma distinta — es la misma razón por la que R5 no
 * promedia sus dos direcciones.
 */

import type { Mesh } from "../../mesh";

/**
 * Lado de la rejilla en píxeles.
 *
 * La silueta se compara con la resolución con la que se mide, así que el número
 * es parte del resultado y va publicado. 256 deja un píxel de ~0,4 % del ancho de
 * la pieza: por debajo de eso, un temblor de silueta no se distingue del borde
 * del propio píxel, y decir que sí sería inventar precisión.
 */
export const SILHOUETTE_RESOLUTION = 256;

/**
 * Las catorce direcciones de vista, normalizadas y en orden fijo. Seis ejes y
 * ocho esquinas; el orden es parte del informe, porque la vista peor se cita por
 * su índice.
 */
export const SILHOUETTE_VIEWS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const ejes: Array<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const esquinas: Array<[number, number, number]> = [];
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [1, -1]) {
        const largo = Math.sqrt(3);
        esquinas.push([x / largo, y / largo, z / largo]);
      }
    }
  }
  return [...ejes, ...esquinas];
})();

export interface SilhouetteView {
  /** Índice en `SILHOUETTE_VIEWS`, para poder citar la vista peor. */
  view: number;
  direction: readonly [number, number, number];
  /** Píxeles que cubre la maestra. Es el denominador de los dos ratios. */
  masterPixels: number;
  /** Fracción de la silueta maestra que el LOD **no** cubre. */
  missingRatio: number;
  /** Fracción, sobre la misma maestra, que el LOD cubre **de más**. */
  extraRatio: number;
  /** Intersección entre unión: el número clásico, para quien lo espere. */
  iou: number;
}

export interface SilhouetteComparison {
  measurementClass: "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  resolution: number;
  views: SilhouetteView[];
  /** La vista donde más silueta falta, que es la que describe el defecto. */
  worstMissing: SilhouetteView;
  /** Y donde más sobra. Pueden no ser la misma, y por eso van las dos. */
  worstExtra: SilhouetteView;
}

/** Base ortonormal de una vista. Determinista: el «arriba» no se elige al azar. */
function basis(
  direction: readonly number[],
): { right: number[]; up: number[] } {
  // Con la vista casi vertical, +Y no orienta nada; se cambia a +Z. El umbral va
  // fijo para que dos ejecuciones elijan siempre la misma base.
  const mundo = Math.abs(direction[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const right = [
    mundo[1] * direction[2] - mundo[2] * direction[1],
    mundo[2] * direction[0] - mundo[0] * direction[2],
    mundo[0] * direction[1] - mundo[1] * direction[0],
  ];
  const largo = Math.hypot(right[0], right[1], right[2]) || 1;
  const r = [right[0] / largo, right[1] / largo, right[2] / largo];
  const up = [
    direction[1] * r[2] - direction[2] * r[1],
    direction[2] * r[0] - direction[0] * r[2],
    direction[0] * r[1] - direction[1] * r[0],
  ];
  return { right: r, up };
}

/**
 * Cobertura de una malla en una vista, como bits.
 *
 * Se rellenan **todos** los triángulos, de frente y de espaldas: la silueta es la
 * unión de lo que la malla ocupa en la imagen, y descartar las caras traseras
 * dejaría agujeros en una malla abierta —justo la que más falta hace medir—.
 */
function coverage(
  mesh: Mesh,
  right: readonly number[],
  up: readonly number[],
  box: { min: number[]; max: number[] },
  resolution: number,
): Uint8Array {
  // La caja se proyecta con la misma base que los triángulos, así que las dos
  // mallas caen en la misma rejilla y sus píxeles son comparables.
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const u = x * right[0] + y * right[1] + z * right[2];
        const v = x * up[0] + y * up[1] + z * up[2];
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }
  }
  // Un margen de un píxel por lado: sin él, la silueta toca el borde y un
  // desbordamiento de medio píxel se recorta en vez de contarse.
  const ancho = (maxU - minU) || 1;
  const alto = (maxV - minV) || 1;
  const escala = (resolution - 2) / Math.max(ancho, alto);
  const centroU = (minU + maxU) / 2;
  const centroV = (minV + maxV) / 2;

  const bits = new Uint8Array(resolution * resolution);
  const { positions, indices } = mesh;
  const aPixel = (index: number): [number, number] => {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const u = x * right[0] + y * right[1] + z * right[2];
    const v = x * up[0] + y * up[1] + z * up[2];
    return [
      (u - centroU) * escala + resolution / 2,
      (v - centroV) * escala + resolution / 2,
    ];
  };

  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const a = aPixel(indices[triangle * 3]);
    const b = aPixel(indices[triangle * 3 + 1]);
    const c = aPixel(indices[triangle * 3 + 2]);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    // Un triángulo de canto no cubre nada. Descartarlo no pierde silueta: sus
    // vecinos la cubren, y sin este corte la división de abajo estalla.
    if (area === 0) continue;

    const izquierda = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const derecha = Math.min(resolution - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const arriba = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const abajo = Math.min(resolution - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let fila = arriba; fila <= abajo; fila += 1) {
      for (let columna = izquierda; columna <= derecha; columna += 1) {
        // Centro del píxel, que es donde se decide si está cubierto.
        const px = columna + 0.5;
        const py = fila + 0.5;
        const w0 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
        const w1 = ((c[0] - b[0]) * (py - b[1]) - (px - b[0]) * (c[1] - b[1])) / area;
        const w2 = ((a[0] - c[0]) * (py - c[1]) - (px - c[0]) * (a[1] - c[1])) / area;
        // Sin signo: el bobinado no decide la silueta.
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
          bits[fila * resolution + columna] = 1;
        }
      }
    }
  }
  return bits;
}

/** Caja que contiene a las dos mallas: el encuadre común de la comparación. */
function sharedBox(a: Mesh, b: Mesh): { min: number[]; max: number[] } {
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
  return { min, max };
}

export function compareSilhouettes(
  master: Mesh,
  lod: Mesh,
  resolution = SILHOUETTE_RESOLUTION,
): SilhouetteComparison {
  const box = sharedBox(master, lod);
  const views: SilhouetteView[] = [];

  for (const [index, direction] of SILHOUETTE_VIEWS.entries()) {
    const { right, up } = basis(direction);
    const uno = coverage(master, right, up, box, resolution);
    const otro = coverage(lod, right, up, box, resolution);

    let maestra = 0;
    let falta = 0;
    let sobra = 0;
    let interseccion = 0;
    let union = 0;
    for (let pixel = 0; pixel < uno.length; pixel += 1) {
      const a = uno[pixel];
      const b = otro[pixel];
      if (a === 1) maestra += 1;
      if (a === 1 && b === 0) falta += 1;
      if (a === 0 && b === 1) sobra += 1;
      if (a === 1 && b === 1) interseccion += 1;
      if (a === 1 || b === 1) union += 1;
    }

    views.push({
      view: index,
      direction,
      masterPixels: maestra,
      // Los dos sobre la **misma** maestra: con denominadores distintos, un ratio
      // no se podría comparar con el otro ni sumar al total.
      missingRatio: maestra === 0 ? 0 : falta / maestra,
      extraRatio: maestra === 0 ? 0 : sobra / maestra,
      iou: union === 0 ? 1 : interseccion / union,
    });
  }

  // Las dos peores, y **pueden no ser la misma vista**: una simplificación que
  // come de frente puede engordar de perfil.
  const peorFalta = views.reduce((peor, vista) =>
    vista.missingRatio > peor.missingRatio ? vista : peor,
  );
  const peorSobra = views.reduce((peor, vista) => (vista.extraRatio > peor.extraRatio ? vista : peor));

  return {
    // El píxel discretiza, así que esto aproxima: con otra resolución sale otro
    // número, y por eso la resolución va publicada al lado.
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    resolution,
    views,
    worstMissing: peorFalta,
    worstExtra: peorSobra,
  };
}
