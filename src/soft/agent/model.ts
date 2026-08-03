/**
 * Modelo cargado y direccionable por nombre.
 *
 * Es la pieza que faltaba para que un agente itere rápido sobre un GLB u OBJ. Tres
 * decisiones, cada una contra un modo concreto de fallo:
 *
 * 1. LA MALLA SE QUEDA EN LOCAL Y LA TRANSFORMACIÓN APARTE. Girar un rotor es
 *    tocar una matriz de 16 números, no reescribir 1.584 posiciones. Un agente que
 *    tiene que reemitir geometría para mover algo gasta su presupuesto en copiar
 *    datos en vez de en decidir.
 *
 * 2. SELECCIÓN POR PATRÓN, NO POR ÍNDICE. Los índices cambian en cuanto alguien
 *    borra una pieza, y un agente que memorizó «nodo 114» acaba editando otra cosa.
 *    `rotor-*` sigue significando lo mismo después de cualquier edición.
 *
 * 3. RESUMEN AGRUPADO POR FAMILIA. El dron de prueba tiene 317 piezas y 30 de
 *    ellas se llaman `motor-knurl-front-left-0..29`. Volcarlas una por una gasta
 *    contexto sin añadir información: colapsar el sufijo numérico deja 40 filas
 *    legibles de un vistazo en vez de 317. Esto no es cosmética, es lo que decide
 *    si el agente puede razonar sobre el modelo entero a la vez.
 */

import { mat4, multiply, rotationX, rotationY, rotationZ, scaling, translation, type Mat4 } from "../math";
import type { Mesh } from "../mesh";
import { assertValid, PATCH_SCHEMA } from "./schema";
import { resolveObject, type ObjectSpec } from "./sceneSpec";
import type { Material, SceneNode } from "../renderer";

export interface ModelPart {
  /** Nombre del nodo. Único dentro del modelo tras `dedupeNames`. */
  name: string;
  /** Ruta jerárquica completa, útil para desambiguar y para seleccionar ramas. */
  path: string;
  mesh: Mesh;
  /** Transformación a espacio de mundo, con la jerarquía ya acumulada. */
  matrix: Mat4;
  materialName: string | null;
  baseColor: [number, number, number] | null;
  visible: boolean;
}

export interface Model {
  source: string;
  parts: ModelPart[];
  notes: string[];
}

/** Familia de piezas: mismo nombre salvo el sufijo numérico. */
export interface PartFamily {
  family: string;
  count: number;
  triangles: number;
  vertices: number;
  example: string;
}

const DEFAULT_MATERIAL: Material = {
  albedo: [0.74, 0.75, 0.78],
  specular: 0.32,
  shininess: 48,
  checker: false,
  checkerScale: 1,
  checkerTileWorldSize: 1,
};

const HIGHLIGHT_COLOR: [number, number, number] = [1, 0.45, 0.12];
const DIMMED_COLOR: [number, number, number] = [0.3, 0.31, 0.34];

/**
 * Nombres únicos. Un GLB puede repetir el nombre de nodo tantas veces como quiera,
 * y con nombres repetidos la selección por patrón deja de ser determinista.
 */
export function dedupeNames(parts: ModelPart[]): void {
  const seen = new Map<string, number>();
  for (const part of parts) {
    const count = seen.get(part.name) ?? 0;
    seen.set(part.name, count + 1);
    if (count > 0) part.name = `${part.name}~${count}`;
  }
}

/**
 * Patrón con comodín `*`. Se compara contra nombre y ruta, sin distinguir
 * mayúsculas: `rotor-*` coge las cuatro hélices, y un patrón con comodines a ambos
 * lados de una ruta (`* / motor-front-left / *`, sin espacios) coge una rama entera.
 * Se escapa todo lo demás para que un nombre con puntos o paréntesis —habituales
 * en modelos exportados— no se interprete como expresión regular.
 */
export function matchesName(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (character) =>
    character === "*" ? " " : `\\${character}`,
  );
  return new RegExp(`^${escaped.replace(/ /g, ".*")}$`, "i").test(name);
}

export function matchesPattern(part: ModelPart, pattern: string): boolean {
  return matchesName(part.name, pattern) || matchesName(part.path, pattern);
}

/**
 * Selección por propiedad: `triangles>1000`, `boundaryEdges>0`, `material=Vidrio`.
 *
 * El nombre no sirve para trabajo de optimización —«enséñame todo lo que pase de mil
 * triángulos» no es un patrón de nombre—, y para eso hace falta consultar la
 * geometría. Varias condiciones separadas por comas se cumplen todas.
 *
 * Las propiedades topológicas obligan a auditar la malla, que cuesta; por eso
 * `triangles` y `vertices`, que se leen del propio array, se resuelven sin auditar y
 * son las que se usan el 90 % de las veces.
 */
export interface PropertyQuery {
  property: string;
  operator: ">" | "<" | ">=" | "<=" | "=" | "!=";
  value: string;
}

const CHEAP_PROPERTIES = new Set(["triangles", "vertices", "name", "path", "material", "visible"]);

export function parseWhere(expression: string): PropertyQuery[] {
  return expression
    .split(",")
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .map((clause) => {
      const match = /^([A-Za-z]+)\s*(>=|<=|!=|>|<|=)\s*(.+)$/.exec(clause);
      if (match === null) {
        throw new Error(
          `no entiendo la condición "${clause}"; la forma es propiedad>valor, por ejemplo triangles>1000`,
        );
      }
      return { property: match[1], operator: match[2] as PropertyQuery["operator"], value: match[3].trim() };
    });
}

/** Si alguna condición mira la topología, hay que auditar; si no, se ahorra. */
export function needsAudit(queries: readonly PropertyQuery[]): boolean {
  return queries.some((query) => !CHEAP_PROPERTIES.has(query.property));
}

function compare(actual: number | string | boolean | null, query: PropertyQuery): boolean {
  if (typeof actual === "number") {
    const expected = Number(query.value);
    if (Number.isNaN(expected)) return false;
    switch (query.operator) {
      case ">": return actual > expected;
      case "<": return actual < expected;
      case ">=": return actual >= expected;
      case "<=": return actual <= expected;
      case "=": return actual === expected;
      case "!=": return actual !== expected;
    }
  }
  const text = actual === null ? "" : String(actual);
  const matches = matchesName(text, query.value);
  return query.operator === "!=" ? !matches : matches;
}

/**
 * Piezas que cumplen todas las condiciones. `audits` trae la auditoría por nombre
 * cuando alguna condición la necesita; sin ella, esas condiciones no encuentran la
 * propiedad y la pieza no entra.
 */
export function selectWhere(
  model: Model,
  queries: readonly PropertyQuery[],
  audits: ReadonlyMap<string, Record<string, number | boolean | null>> = new Map(),
): ModelPart[] {
  return model.parts.filter((part) =>
    queries.every((query) => {
      switch (query.property) {
        case "triangles": return compare(part.mesh.indices.length / 3, query);
        case "vertices": return compare(part.mesh.positions.length / 3, query);
        case "name": return compare(part.name, query);
        case "path": return compare(part.path, query);
        case "material": return compare(part.materialName, query);
        case "visible": return compare(String(part.visible), query);
        default: {
          const audit = audits.get(part.name);
          if (audit === undefined) return false;
          const value = audit[query.property];
          return value === undefined ? false : compare(value as number | boolean | null, query);
        }
      }
    }),
  );
}

/**
 * Huella del contenido de una malla: FNV-1a sobre las posiciones más el recuento de
 * índices. Identifica geometrías iguales aunque sean objetos distintos, que es lo
 * habitual: el cargador entrega una copia por pieza aunque el fichero la compartiera.
 */
export function geometryKeyOf(mesh: Mesh): string {
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${mesh.indices.length}`;
}

export function selectParts(model: Model, patterns: readonly string[]): ModelPart[] {
  if (patterns.length === 0) return [];
  return model.parts.filter((part) => patterns.some((pattern) => matchesPattern(part, pattern)));
}

/**
 * Normaliza un nombre a su familia. Tres colapsos, en orden:
 *
 *   1. sufijo de desduplicado `~n`
 *   2. sufijo numérico (`-0`, `_12`, `-3.5`) y sufijo de letra suelta (`-a`, `-b`)
 *   3. palabras de posición: `front-left`, `rear-right`… a `{lado}`
 *
 * El tercero es el que hace el trabajo en modelos mecánicos, donde la mitad de las
 * piezas existen cuatro veces por simetría. Sin él el dron daba 118 familias para
 * 296 piezas, que sigue siendo ilegible de un vistazo.
 */
export function familyOf(name: string): string {
  return name
    .replace(/~\d+$/, "")
    .replace(/([-_])-?\d+(\.\d+)?$/, "$1N")
    .replace(/([-_])[a-z]$/i, "$1N")
    .replace(/(front|rear|back)[-_](left|right)/gi, "{lado}")
    .replace(/[-_](left|right|front|rear|back)(?=[-_]|$)/gi, "-{lado}");
}

export function summarizeFamilies(parts: readonly ModelPart[]): PartFamily[] {
  const families = new Map<string, PartFamily>();
  for (const part of parts) {
    const family = familyOf(part.name);
    const existing = families.get(family);
    const triangles = part.mesh.indices.length / 3;
    const vertices = part.mesh.positions.length / 3;
    if (existing) {
      existing.count += 1;
      existing.triangles += triangles;
      existing.vertices += vertices;
    } else {
      families.set(family, { family, count: 1, triangles, vertices, example: part.name });
    }
  }
  return [...families.values()].sort((a, b) => b.triangles - a.triangles);
}

export interface SceneNodeOptions {
  /** Piezas a destacar en naranja; el resto se apaga. Vacío = todas normales. */
  highlight?: ReadonlySet<ModelPart>;
  /** Dibujar solo las piezas destacadas. */
  isolate?: boolean;
  /**
   * Usar el color del material del fichero en vez del gris neutro.
   *
   * Por defecto **no**, y es deliberado: el dron de prueba viene con un
   * `baseColorFactor` casi negro y el pliego salía en negro sobre negro, sin
   * información de forma. Un render de arcilla neutra es lo que usa cualquier
   * herramienta de revisión de modelado por la misma razón: separa la geometría,
   * que es lo que se está juzgando, del acabado, que no.
   */
  useMaterialColors?: boolean;
}

export function toSceneNodes(model: Model, options: SceneNodeOptions = {}): SceneNode[] {
  const { highlight, isolate } = options;
  const nodes: SceneNode[] = [];

  for (const part of model.parts) {
    if (!part.visible) continue;
    const isHighlighted = highlight?.has(part) ?? false;
    if (isolate && !isHighlighted) continue;

    let albedo = (options.useMaterialColors ? part.baseColor : null) ?? DEFAULT_MATERIAL.albedo;
    if (highlight && highlight.size > 0 && !isolate) {
      albedo = isHighlighted ? HIGHLIGHT_COLOR : DIMMED_COLOR;
    }

    nodes.push({
      mesh: part.mesh,
      model: part.matrix,
      material: { ...DEFAULT_MATERIAL, albedo: [...albedo] as [number, number, number] },
    });
  }

  return nodes;
}

export type Edit =
  /**
   * Añade una pieza descrita igual que en una escena. Es lo que convierte el parche
   * en un lenguaje para **crear** y no solo para retocar: sin esto, un agente que
   * inventa geometría tiene que reemitir el documento entero en cada turno.
   */
  | { op: "add"; object: ObjectSpec; target?: string }
  | { op: "translate"; target: string; delta: [number, number, number] }
  | { op: "rotate"; target: string; degrees: [number, number, number] }
  | { op: "scale"; target: string; factor: number | [number, number, number] }
  | { op: "color"; target: string; rgb: [number, number, number] }
  | { op: "hide"; target: string }
  | { op: "show"; target: string }
  | { op: "delete"; target: string }
  | { op: "rename"; target: string; to: string }
  /**
   * Lleva una pieza a tocar otra. Es la corrección natural del aviso de pieza
   * flotante: la auditoría dice a cuánto está y de quién, y esto lo cierra.
   */
  | { op: "align"; target: string; to: string; axis?: "x" | "y" | "z"; gap?: number }
  /**
   * Recentra el origen de la pieza sin mover la geometría: las posiciones se
   * desplazan y la matriz compensa. Corrige el aviso de pivote descentrado, que es
   * el que hace que girar una pieza la mande a dar una vuelta ancha.
   */
  | { op: "setPivot"; target: string; to?: [number, number, number] }
  /**
   * Espeja en un plano del propio objeto. Reflejar invierte el bobinado, así que
   * además se da la vuelta a cada triángulo: si no, la pieza espejada queda del
   * revés y `MALLA_INVERTIDA` lo cantaría.
   */
  | { op: "mirror"; target: string; axis: "x" | "y" | "z" }
  /**
   * Hace que las piezas con la misma geometría **compartan** la malla en vez de
   * llevar cada una su copia. No cambia ni un píxel: cambia cuánto ocupa el modelo
   * en memoria, en la caché y sobre todo en el GLB exportado.
   */
  | { op: "instance"; target?: string };

export interface Patch {
  edits: Edit[];
}

export interface EditResult {
  op: string;
  target: string;
  matched: number;
  error?: string;
  /** `instance`: bytes de malla que dejan de estar duplicados. */
  savedBytes?: number;
}

/**
 * Separa la malla de una pieza si otra la comparte, para poder mutarla sin efectos a
 * distancia. Si nadie más la usa, no copia nada.
 */
function detachMesh(model: Model, part: ModelPart): void {
  const shared = model.parts.some((other) => other !== part && other.mesh === part.mesh);
  if (!shared) return;
  const source = part.mesh;
  part.mesh = {
    positions: Float32Array.from(source.positions),
    normals: Float32Array.from(source.normals),
    uvs: Float32Array.from(source.uvs),
    indices: Uint32Array.from(source.indices),
    boundingRadius: source.boundingRadius,
  };
}

/** Caja envolvente en mundo de un puñado de piezas. */
function worldBounds(parts: readonly ModelPart[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const { positions } = part.mesh;
    const m = part.matrix;
    for (let offset = 0; offset < positions.length; offset += 3) {
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      const world = [
        m[0] * x + m[1] * y + m[2] * z + m[3],
        m[4] * x + m[5] * y + m[6] * z + m[7],
        m[8] * x + m[9] * y + m[10] * z + m[11],
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        if (world[axis] < min[axis]) min[axis] = world[axis];
        if (world[axis] > max[axis]) max[axis] = world[axis];
      }
    }
  }
  return { min, max };
}

/** Eje por el que menos hay que mover para juntar dos cajas. */
function closestAxis(box: { min: number[]; max: number[] }, anchor: { min: number[]; max: number[] }): number {
  let best = 1;
  let shortest = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const travel = Math.min(
      Math.abs(anchor.min[axis] - box.max[axis]),
      Math.abs(anchor.max[axis] - box.min[axis]),
    );
    if (travel < shortest) {
      shortest = travel;
      best = axis;
    }
  }
  return best;
}

function localCenter(mesh: Mesh): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[offset + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

function radiusOf(positions: Float32Array): number {
  let radius = 0;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const distance = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (distance > radius) radius = distance;
  }
  return radius;
}

/** Pieza nueva a partir de su descripción declarativa, ya colocada en el mundo. */
function partFromSpec(object: ObjectSpec, index: number): ModelPart {
  const resolved = resolveObject(object, index);
  return {
    name: resolved.name,
    path: resolved.name,
    mesh: resolved.node.mesh,
    matrix: resolved.node.model,
    materialName: null,
    baseColor: object.color !== undefined ? ([...object.color] as [number, number, number]) : null,
    visible: true,
  };
}

const DEGREES_TO_RADIANS = Math.PI / 180;
const scratchA = mat4();
const scratchB = mat4();
const scratchC = mat4();
const scratchD = mat4();

/**
 * Compone una transformación **alrededor del origen de la pieza**, no del origen
 * del mundo: `M' = T(p) · X · T(-p) · M` con p la traslación de la propia pieza.
 *
 * Es la única regla que se comporta como un agente espera. Girar 15° en Y con la
 * transformación aplicada en el mundo mandaría un rotor situado a 1,4 m del centro
 * a dar una vuelta de 1,4 m de radio; alrededor de su propio origen, gira sobre su
 * eje, que es lo que significa «gira el rotor».
 */
function transformAroundOwnOrigin(part: ModelPart, transform: Mat4): void {
  const px = part.matrix[3];
  const py = part.matrix[7];
  const pz = part.matrix[11];

  multiply(transform, translation(-px, -py, -pz, scratchA), scratchB);
  multiply(translation(px, py, pz, scratchA), scratchB, scratchC);
  multiply(scratchC, part.matrix, scratchD);
  part.matrix.set(scratchD);
}

export function applyPatch(model: Model, patch: Patch): EditResult[] {
  assertValid(patch, PATCH_SCHEMA, "el parche");
  const results: EditResult[] = [];

  for (const edit of patch.edits ?? []) {
    if (edit.op === "add") {
      const part = partFromSpec(edit.object, model.parts.length);
      model.parts.push(part);
      dedupeNames(model.parts);
      results.push({ op: "add", target: part.name, matched: 1 });
      continue;
    }

    // `instance` sin objetivo se aplica al modelo entero, que es lo que se quiere el
    // 99 % de las veces; las demás operaciones exigen decir sobre qué actúan.
    if (edit.target === undefined && edit.op !== "instance") {
      results.push({ op: edit.op, target: "", matched: 0, error: "falta target" });
      continue;
    }

    const pattern = edit.target ?? "*";
    const targets = model.parts.filter((part) => matchesPattern(part, pattern));
    const result: EditResult = { op: edit.op, target: pattern, matched: targets.length };

    // Un patrón que no encaja con nada es casi siempre un nombre mal escrito. Un
    // agente no puede corregirlo si la operación falla en silencio.
    if (targets.length === 0) {
      result.error = "ningún nombre o ruta coincide con el patrón";
      results.push(result);
      continue;
    }

    switch (edit.op) {
      case "translate": {
        const [dx, dy, dz] = edit.delta;
        for (const part of targets) {
          multiply(translation(dx, dy, dz, scratchA), part.matrix, scratchD);
          part.matrix.set(scratchD);
        }
        break;
      }
      case "rotate": {
        const [rx, ry, rz] = edit.degrees;
        multiply(
          rotationY(ry * DEGREES_TO_RADIANS, scratchA),
          rotationX(rx * DEGREES_TO_RADIANS, scratchB),
          scratchC,
        );
        const rotation = mat4();
        multiply(scratchC, rotationZ(rz * DEGREES_TO_RADIANS, scratchA), rotation);
        for (const part of targets) transformAroundOwnOrigin(part, rotation);
        break;
      }
      case "scale": {
        const [sx, sy, sz] =
          typeof edit.factor === "number" ? [edit.factor, edit.factor, edit.factor] : edit.factor;
        const scale = scaling(sx, sy, sz, mat4());
        for (const part of targets) transformAroundOwnOrigin(part, scale);
        break;
      }
      case "color":
        for (const part of targets) part.baseColor = [...edit.rgb] as [number, number, number];
        break;
      case "hide":
        for (const part of targets) part.visible = false;
        break;
      case "show":
        for (const part of targets) part.visible = true;
        break;
      case "delete": {
        const removed = new Set(targets);
        model.parts = model.parts.filter((part) => !removed.has(part));
        break;
      }
      case "instance": {
        // Se agrupa por contenido, no por identidad: el cargador entrega una copia
        // por pieza aunque el fichero compartiera la geometría.
        const canonical = new Map<string, Mesh>();
        let shared = 0;
        let saved = 0;
        for (const part of targets) {
          const key = geometryKeyOf(part.mesh);
          const existing = canonical.get(key);
          if (existing === undefined) {
            canonical.set(key, part.mesh);
            continue;
          }
          if (existing === part.mesh) continue;
          saved +=
            part.mesh.positions.byteLength +
            part.mesh.normals.byteLength +
            part.mesh.uvs.byteLength +
            part.mesh.indices.byteLength;
          part.mesh = existing;
          shared += 1;
        }
        result.matched = shared;
        if (shared === 0) result.error = "no hay geometría repetida que compartir";
        else result.savedBytes = saved;
        break;
      }
      case "align": {
        const reference = model.parts.filter((part) => matchesPattern(part, edit.to));
        if (reference.length === 0) {
          result.error = `align: ningún nombre coincide con "${edit.to}"`;
          break;
        }
        const anchor = worldBounds(reference);
        for (const part of targets) {
          const box = worldBounds([part]);
          const axis = edit.axis !== undefined ? "xyz".indexOf(edit.axis) : closestAxis(box, anchor);
          const gap = edit.gap ?? 0;
          // Se mueve por el lado que ya está más cerca: acercar una pieza suelta es
          // cerrar el hueco que hay, no cruzarla al otro lado del vecino.
          const below = anchor.min[axis] - box.max[axis];
          const above = anchor.max[axis] - box.min[axis];
          const delta = Math.abs(below) <= Math.abs(above) ? below - gap : above + gap;
          const move = [0, 0, 0];
          move[axis] = delta;
          multiply(translation(move[0], move[1], move[2], scratchA), part.matrix, scratchD);
          part.matrix.set(scratchD);
        }
        break;
      }
      case "setPivot":
        for (const part of targets) {
          // Copia al escribir. Tras un `instance`, varias piezas comparten la misma
          // malla, y recentrar el pivote de una movería la geometría de todas sus
          // gemelas sin que nadie lo pidiera. Se separa antes de tocarla.
          detachMesh(model, part);
          const local = localCenter(part.mesh);
          const to = edit.to ?? [0, 0, 0];
          const shift = [local[0] - to[0], local[1] - to[1], local[2] - to[2]];
          const { positions } = part.mesh;
          for (let offset = 0; offset < positions.length; offset += 3) {
            positions[offset] -= shift[0];
            positions[offset + 1] -= shift[1];
            positions[offset + 2] -= shift[2];
          }
          part.mesh.boundingRadius = radiusOf(positions);
          // La matriz compensa el desplazamiento para que la pieza no se mueva.
          multiply(part.matrix, translation(shift[0], shift[1], shift[2], scratchA), scratchD);
          part.matrix.set(scratchD);
        }
        break;
      case "mirror": {
        const axis = "xyz".indexOf(edit.axis);
        for (const part of targets) {
          detachMesh(model, part);
          const { positions, normals, indices } = part.mesh;
          for (let offset = axis; offset < positions.length; offset += 3) {
            positions[offset] = -positions[offset];
            normals[offset] = -normals[offset];
          }
          for (let triangle = 0; triangle < indices.length; triangle += 3) {
            const swap = indices[triangle + 1];
            indices[triangle + 1] = indices[triangle + 2];
            indices[triangle + 2] = swap;
          }
        }
        break;
      }
      case "rename":
        if (targets.length > 1) {
          result.error = `el patrón coincide con ${targets.length} piezas; renombrar exige una sola`;
        } else {
          targets[0].name = edit.to;
        }
        break;
      default: {
        result.error = `operación desconocida: ${(edit as { op: string }).op}`;
      }
    }

    results.push(result);
  }

  return results;
}
