/**
 * Auditoría **entre** piezas, que es donde están los errores que ninguna imagen
 * revela y que la auditoría de malla, por definición, no puede ver.
 *
 * `auditMesh` mira cada malla por separado: si está cerrada, si sus normales son
 * coherentes, si es simétrica. Todo eso puede estar perfecto y el ensamblaje seguir
 * mal —dos piezas metidas una dentro de otra, un tornillo del tamaño de un motor—,
 * porque el fallo no está en ninguna de las dos mallas sino en su relación.
 *
 * Las dos comprobaciones de aquí son de caja envolvente, y eso hay que decirlo en el
 * aviso: una caja no es la pieza. Refinar con pruebas triángulo-triángulo es posible
 * y caro; mientras no se haga, lo que se reporta son **candidatos**, no hechos.
 */

import { computeSceneAabb, type SceneAabb } from "./contactSheet";
import { familyOf, geometryKeyOf } from "./model";
import type { Mat4 } from "../math";
import type { Mesh } from "../mesh";

/** Lo mínimo que hace falta de una pieza para situarla en el mundo. */
export interface PlacedPart {
  name: string;
  /** Ruta jerárquica; su prefijo agrupa a los hermanos. */
  path: string;
  mesh: Mesh;
  model: Mat4;
}

export interface Interpenetration {
  parts: [string, string];
  /** Volumen solapado respecto al de la pieza menor, de 0 a 1. */
  overlap: number;
  /** La caja de una está entera dentro de la otra: alojamiento, no cruce. */
  contained: boolean;
}

export interface ScaleOutlier {
  part: string;
  /** Diagonal de su caja, y la mediana del grupo con el que se compara. */
  diagonal: number;
  median: number;
  factor: number;
  /** Cuántos hermanos formaron la mediana. */
  siblings: number;
}

export interface FloatingPart {
  part: string;
  /** Separación vertical hasta lo que tiene debajo, en unidades del fichero. */
  gap: number;
  /** Pieza que tiene debajo, o `null` si no hay nada: el suelo del modelo. */
  below: string | null;
  /** Pieza más próxima en cualquier dirección, y a cuánto: es lo que hay que acercar. */
  nearest: string | null;
  distance: number;
}

export interface DuplicateGroup {
  parts: string[];
  triangles: number;
}

export interface SpatialAudit {
  interpenetration: Interpenetration[];
  scaleOutliers: ScaleOutlier[];
  floating: FloatingPart[];
  duplicates: DuplicateGroup[];
}

/**
 * Fracción del volumen de la pieza menor que cae dentro de la caja de la otra.
 *
 * Se toma la menor a propósito: dos cajas que se tocan solapan poco de cualquiera de
 * las dos, pero una pieza pequeña **metida dentro** de una grande solapa casi todo su
 * propio volumen, y ese es el fallo que interesa. Referirlo a la mayor lo escondería.
 */
function overlapFraction(a: SceneAabb, b: SceneAabb): number {
  let overlap = 1;
  let volumeA = 1;
  let volumeB = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const span = Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
    if (span <= 0) return 0;
    overlap *= span;
    volumeA *= a.max[axis] - a.min[axis];
    volumeB *= b.max[axis] - b.min[axis];
  }
  const smaller = Math.min(volumeA, volumeB);
  return smaller > 0 ? overlap / smaller : 0;
}

/** Una caja dentro de la otra, sin sobresalir por ningún lado. */
function containsBox(outer: SceneAabb, inner: SceneAabb): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (inner.min[axis] < outer.min[axis] || inner.max[axis] > outer.max[axis]) return false;
  }
  return true;
}

function diagonalOf(box: SceneAabb): number {
  return Math.hypot(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
}

/** Ruta del padre: lo que tienen en común los hermanos. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Cajas que se tocan o se cruzan, con holgura: contacto, no necesariamente cruce. */
function touches(a: SceneAabb, b: SceneAabb, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (a.min[axis] - tolerance > b.max[axis]) return false;
    if (b.min[axis] - tolerance > a.max[axis]) return false;
  }
  return true;
}

/** Distancia entre dos cajas: cero si se tocan o se cruzan. */
function gapBetween(a: SceneAabb, b: SceneAabb): number {
  let squared = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const separation = Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
    squared += separation * separation;
  }
  return Math.sqrt(squared);
}

/** Solape en planta, que es lo que decide si una pieza puede estar «debajo» de otra. */
function overlapsInPlan(a: SceneAabb, b: SceneAabb): boolean {
  if (a.min[0] >= b.max[0] || b.min[0] >= a.max[0]) return false;
  if (a.min[2] >= b.max[2] || b.min[2] >= a.max[2]) return false;
  return true;
}

/**
 * Huella de la geometría en local. Dos piezas con la misma huella **y** la misma
 * matriz son la misma pieza dibujada dos veces; con la misma huella y distinta
 * matriz son una instancia, que es legítimo. Vive en `model.ts` porque la usan tanto
 * esta auditoría como el escritor de GLB, y dos copias divergirían.
 */
const geometryKey = geometryKeyOf;

/** La matriz redondeada: dos colocaciones iguales salvo error de coma flotante. */
function placementKey(matrix: Mat4): string {
  let key = "";
  for (let index = 0; index < 16; index += 1) key += `${matrix[index].toFixed(5)},`;
  return key;
}

export interface SpatialAuditOptions {
  /** Solape mínimo, sobre la pieza menor, para considerarlo candidato. */
  minOverlap?: number;
  /** Desviación respecto a la mediana de los hermanos que se considera incoherente. */
  scaleFactor?: number;
  /** Cuántas filas devolver de cada lista. */
  limit?: number;
}

/**
 * D1 e interpenetración, D4 y escala entre hermanos, en un solo recorrido de cajas.
 *
 * Con 296 piezas son 43.660 pruebas de solape: irrelevante frente a calcular las
 * cajas, que sí recorre los vértices una vez.
 *
 * Las dos listas se **colapsan por familia** antes de devolverse. Sin eso, un modelo
 * simétrico reporta el mismo hallazgo cuatro veces —una por rotor— y llena el informe
 * de filas que dicen lo mismo. Se conserva el peor caso de cada familia, que es el que
 * el agente va a mirar.
 */
export function auditSpatial(
  parts: readonly PlacedPart[],
  options: SpatialAuditOptions = {},
): SpatialAudit {
  // Un décimo del volumen de la pieza menor. Un contacto legítimo solapa
  // prácticamente cero; dos piezas que se muerden de verdad pasan de esto de sobra.
  const minOverlap = options.minOverlap ?? 0.1;
  const scaleFactor = options.scaleFactor ?? 10;
  const limit = options.limit ?? 10;

  const boxes = parts.map((part) => computeSceneAabb([part]));

  const worstByFamilyPair = new Map<string, Interpenetration>();
  for (let a = 0; a < parts.length; a += 1) {
    for (let b = a + 1; b < parts.length; b += 1) {
      const overlap = overlapFraction(boxes[a], boxes[b]);
      if (overlap < minOverlap) continue;
      const familyA = familyOf(parts[a].name);
      const familyB = familyOf(parts[b].name);
      const key = familyA < familyB ? `${familyA}|${familyB}` : `${familyB}|${familyA}`;
      const contained =
        containsBox(boxes[a], boxes[b]) || containsBox(boxes[b], boxes[a]);
      const previous = worstByFamilyPair.get(key);
      if (previous === undefined || overlap > previous.overlap) {
        worstByFamilyPair.set(key, {
          parts: [parts[a].name, parts[b].name],
          overlap: Number(overlap.toFixed(3)),
          contained,
        });
      }
    }
  }

  const siblings = new Map<string, number[]>();
  parts.forEach((part, index) => {
    const parent = parentOf(part.path);
    const group = siblings.get(parent);
    if (group === undefined) siblings.set(parent, [index]);
    else group.push(index);
  });

  const worstByFamily = new Map<string, ScaleOutlier>();
  for (const group of siblings.values()) {
    // Con menos de cuatro hermanos, la mediana no dice nada: dos piezas de tamaños
    // muy distintos son un diseño, no una anomalía.
    if (group.length < 4) continue;
    const diagonals = group.map((index) => diagonalOf(boxes[index]));
    const reference = median(diagonals);
    if (reference <= 0) continue;

    // El grupo tiene que ser **de iguales** para que su mediana signifique algo.
    // En el dron, `upper-shell` mezcla la carcasa entera con veintisiete detalles
    // de superficie: la carcasa sale 17 veces mayor que la mediana y no le pasa
    // nada. Si el propio grupo está disperso, no hay norma que romper.
    const sorted = [...diagonals].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.25)];
    const high = sorted[Math.floor(sorted.length * 0.75)];
    if (low <= 0 || high / low > 3) continue;

    group.forEach((index, position) => {
      const diagonal = diagonals[position];
      const factor = diagonal > reference ? diagonal / reference : reference / diagonal;
      if (!Number.isFinite(factor) || factor < scaleFactor) return;

      // Una pieza mucho mayor que sus hermanos **y que los contiene** no es una
      // anomalía de escala: es la que los aloja. En el dron, `canopy-shell` sale 17
      // veces mayor que la mediana de los veintisiete detalles que lleva encima, y
      // no le pasa nada. Un tornillo con la escala mal puesta no contiene a nadie.
      if (diagonal > reference) {
        const hosted = group.filter(
          (other) => other !== index && containsBox(boxes[index], boxes[other]),
        ).length;
        if (hosted > (group.length - 1) / 2) return;
      }

      const family = familyOf(parts[index].name);
      const previous = worstByFamily.get(family);
      if (previous === undefined || factor > previous.factor) {
        worstByFamily.set(family, {
          part: parts[index].name,
          diagonal: Number(diagonal.toFixed(4)),
          median: Number(reference.toFixed(4)),
          factor: Number(factor.toFixed(1)),
          siblings: group.length,
        });
      }
    });
  }

  return {
    interpenetration: [...worstByFamilyPair.values()]
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit),
    scaleOutliers: [...worstByFamily.values()]
      .sort((a, b) => b.factor - a.factor)
      .slice(0, limit),
    floating: findFloating(parts, boxes, limit),
    duplicates: findDuplicates(parts, limit),
  };
}

/**
 * D2: piezas que no tocan nada.
 *
 * El plan lo planteaba como «buscar la superficie más alta por debajo y reportar la
 * separación vertical», y esa es la **cifra** que se da, porque es la que se corrige.
 * Pero el **criterio** no puede ser esa separación: en un cuadricóptero las hélices
 * están legítimamente en el aire sobre sus motores, y avisar de eso sería avisar del
 * diseño. Lo que delata un ensamblaje mal montado es una pieza que no toca **nada**,
 * ni por debajo ni por ningún lado.
 *
 * La holgura es relativa al tamaño del modelo: en un objeto de cuatro unidades, dos
 * piezas a una milésima de distancia se están tocando a todos los efectos.
 */
function findFloating(
  parts: readonly PlacedPart[],
  boxes: readonly SceneAabb[],
  limit: number,
): FloatingPart[] {
  if (parts.length < 2) return [];

  let floor = Infinity;
  let extent = 0;
  for (const box of boxes) {
    if (box.min[1] < floor) floor = box.min[1];
    extent = Math.max(extent, diagonalOf(box));
    for (let axis = 0; axis < 3; axis += 1) {
      extent = Math.max(extent, box.max[axis] - box.min[axis]);
    }
  }
  const tolerance = extent * 0.001;

  const found: FloatingPart[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const box = boxes[index];
    let contacts = 0;
    for (let other = 0; other < parts.length && contacts === 0; other += 1) {
      if (other !== index && touches(box, boxes[other], tolerance)) contacts += 1;
    }
    if (contacts > 0) continue;
    // Apoyada en el suelo del propio modelo: tampoco flota.
    if (box.min[1] - floor <= tolerance) continue;

    let support = floor;
    let below: string | null = null;
    let nearest: string | null = null;
    let distance = Infinity;
    for (let other = 0; other < parts.length; other += 1) {
      if (other === index) continue;
      const separation = gapBetween(box, boxes[other]);
      if (separation < distance) {
        distance = separation;
        nearest = parts[other].name;
      }
      if (!overlapsInPlan(box, boxes[other])) continue;
      const top = boxes[other].max[1];
      if (top <= box.min[1] && top > support) {
        support = top;
        below = parts[other].name;
      }
    }

    found.push({
      part: parts[index].name,
      gap: Number((box.min[1] - support).toFixed(4)),
      below,
      nearest,
      // Lo que hay que cerrar para pegarla: la separación vertical dice dónde
      // apoyarla, pero si la pieza está suelta en el aire lo accionable es a qué
      // vecino acercarla y cuánto.
      distance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : 0,
    });
  }

  return found.sort((a, b) => b.gap - a.gap).slice(0, limit);
}

/**
 * D3: la misma geometría en la misma posición, dos veces.
 *
 * No se ven —están exactamente superpuestas— y doblan el coste de todo el camino:
 * vértices, triángulos, sombreado. Aparecen con facilidad en un modelo generado por
 * acumulación de operaciones, y en un GLB con instancias hay que distinguirlas de lo
 * legítimo: la misma malla en **distinta** matriz es una instancia, no un duplicado.
 */
function findDuplicates(parts: readonly PlacedPart[], limit: number): DuplicateGroup[] {
  const groups = new Map<string, { parts: string[]; triangles: number }>();
  for (const part of parts) {
    const key = `${geometryKey(part.mesh)}|${placementKey(part.model)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { parts: [part.name], triangles: part.mesh.indices.length / 3 });
    } else {
      group.parts.push(part.name);
    }
  }

  return [...groups.values()]
    .filter((group) => group.parts.length > 1)
    .sort((a, b) => b.triangles * b.parts.length - a.triangles * a.parts.length)
    .slice(0, limit);
}
