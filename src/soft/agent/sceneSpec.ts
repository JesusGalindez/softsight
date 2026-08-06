/**
 * Formato de escena declarativo: la superficie que ve el agente.
 *
 * Es JSON plano a propósito. Un agente que tiene que llamar a una API imperativa
 * inventa métodos que no existen y encadena estado invisible; escribiendo datos
 * no puede desviarse del esquema, y el esquema entero cabe en una pantalla. Las
 * mallas se pueden dar como primitiva con parámetros o como arrays crudos de
 * posiciones e índices —lo que produce cualquier generador de geometría— y las
 * normales se calculan si no vienen.
 */

import {
  applyDeformers,
  computeNormals,
  createBox,
  createCircleProfile,
  createCylinder,
  createExtrusion,
  createGielisProfile,
  createLoft,
  createNacaProfile,
  createPlane,
  createRevolution,
  createSphere,
  createSuperellipseProfile,
  createSweep,
  createTorus,
  sweepStations,
  type Axis,
  type Deformer,
  type LoftSection,
  type Mesh,
  type SweepPath,
} from "../mesh";
import {
  identity,
  mat4,
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  translation,
  type Mat4,
} from "../math";
import { assertValid, SCENE_SCHEMA } from "./schema";
import type { Model } from "./model";
import type { ClipSpec, SkeletonSpec } from "./rigSpec";
import type { SkinBindingRule } from "./skinBinding";
import type { Material, SceneNode } from "../renderer";

export interface PrimitiveSpec {
  primitive: "box" | "sphere" | "torus" | "plane" | "cylinder" | "cone";
  /**
   * box: [ancho, alto, profundo]; sphere: [radio]; torus: [mayor, menor];
   * plane: [lado, subdivisiones]; cylinder: [radio, alto]; cone: [radio, alto].
   */
  parameters?: number[];
}

/**
 * Perfil con nombre: un polígono cerrado generado por fórmula, declarado una vez
 * y usado por nombre desde la geometría.
 *
 * Existe por el coste de turno. Un ala con ocho estaciones que repita el mismo
 * polígono de 64 puntos son cuatro mil números en el documento, y el agente
 * vuelve a leerlos en cada llamada.
 *
 * Los cuatro generadores van planos y opcionales porque `anyOf` del esquema se
 * aplica a un campo y no a los elementos de una lista. Quien exige que haya
 * exactamente uno es `buildProfile`, con un mensaje que dice cuáles encontró.
 */
export interface ProfileSpec {
  /** Identifica, así que es único dentro de la escena. */
  name: string;
  /** Círculo de este radio. */
  circle?: number;
  /** Superelipse `[a, b, exponente]`; con exponente 2 es una elipse. */
  superellipse?: number[];
  /** Superfórmula de Gielis `[m, n1, n2, n3]`, con `a` y `b` opcionales detrás. */
  gielis?: number[];
  /** Perfil aerodinámico NACA de cuatro dígitos, como `"2412"`. */
  naca?: string;
  /** Puntos del polígono. Por defecto 32, salvo Gielis (64) y NACA (64). */
  points?: number;
  /** Cuerda del NACA; 1 por defecto. */
  chord?: number;
  /** Multiplicador del radio de Gielis; 1 por defecto. */
  radius?: number;
}

export interface ExtrudeSpec {
  /**
   * Polígono en el plano XZ, pares `x,z`, o el nombre de un perfil declarado en
   * `profiles`. Puede ser cóncavo; sin agujeros.
   */
  extrude: number[] | string;
  /** Altura total; se reparte a ambos lados del origen. */
  height?: number;
}

export interface LoftSectionSpec {
  /** Dónde se coloca la sección. */
  at: [number, number, number];
  /** Polígono en el plano XZ, pares `x,z`, o el nombre de un perfil. */
  profile: number[] | string;
  /** Escala uniforme, o `[sx, sz]`; 1 por defecto. */
  scale?: number | [number, number];
  /** Grados alrededor de Y, sobre el origen local del polígono; 0 por defecto. */
  twist?: number;
}

export interface LoftSpec {
  /** Secciones a coser, al menos dos. */
  loft: LoftSectionSpec[];
  /** Puntos por sección tras remuestrear; el mayor de las secciones por defecto. */
  samples?: number;
  /** Qué extremos se tapan; `both` por defecto. */
  caps?: "both" | "none" | "start" | "end";
}

/**
 * Una función escalar a lo largo de algo, como tabla de estaciones más
 * interpolación declarada.
 *
 * No hay evaluador de expresiones a propósito: traería análisis sintáctico, un
 * modo de fallo que el esquema no sabe cazar —el único que sabe cazar es «campo
 * mal escrito»— y la duda perpetua de si dos máquinas evalúan igual. Con cuatro
 * puntos se describe cualquier variación que un ala necesita, y es el mismo
 * modismo que ya usan los clips de animación: claves más interpolación.
 */
export interface VariationSpec {
  /** Pares `(u, valor)` con `u` de 0 a 1, ordenados y sin repetir. */
  at: number[][];
  /** `linear` por defecto; `smooth`; o `power:k`. */
  ease?: string;
}

export interface PathSpec {
  /** Puntos por los que pasa el recorrido; al menos dos. */
  through: number[][];
  /** `catmull-rom` por defecto, o `polyline`. */
  kind?: "catmull-rom" | "polyline";
  /** Si el recorrido se cierra sobre sí mismo. */
  closed?: boolean;
}

export interface SweepSpec {
  /** Polígono en el plano XZ, pares `x,z`, o el nombre de un perfil. */
  sweep: number[] | string;
  path: PathSpec;
  /** Multiplica el perfil en cada estación; 1 por defecto. */
  radius?: number | VariationSpec;
  /** Grados alrededor de la tangente; 0 por defecto. */
  twist?: number | VariationSpec;
  /** Estaciones a lo largo del recorrido; 24 por defecto. */
  stations?: number;
  /** Qué extremos se tapan; `both` por defecto. Un recorrido cerrado no los tiene. */
  caps?: "both" | "none" | "start" | "end";
}

export interface RevolveSpec {
  /** Perfil en pares `radio,altura`, girado alrededor del eje Y. */
  revolve: number[];
  segments?: number;
}

export interface RawMeshSpec {
  /** Posiciones intercaladas x,y,z. */
  positions: number[];
  /** Índices de triángulo. Si falta, se asume una tira secuencial. */
  indices?: number[];
  /** Normales intercaladas. Si falta, se promedian desde las caras. */
  normals?: number[];
  /** UVs intercaladas. Si falta, quedan a cero. */
  uvs?: number[];
}

export type GeometrySpec =
  | PrimitiveSpec
  | RawMeshSpec
  | ExtrudeSpec
  | RevolveSpec
  | LoftSpec
  | SweepSpec;

/**
 * Una deformación de la lista. Los cuatro van planos y opcionales, y que haya
 * exactamente uno lo exige el resolutor: `anyOf` del esquema se aplica a un campo
 * y no a los elementos de una lista.
 *
 * `degrees`, `scale` y `amplitude` admiten los tres un número o una tabla de
 * variación, que es un solo modismo para las tres cosas.
 */
export interface DeformSpec {
  /** Gira alrededor del eje, proporcionalmente al recorrido. */
  twist?: { axis: Axis; degrees: number | VariationSpec };
  /** Escala las dos coordenadas que no son la del eje. */
  taper?: { axis: Axis; scale: number | VariationSpec };
  /** Dobla el eje sobre un arco, hacia `into`. */
  bend?: { axis: Axis; into: Axis; degrees: number };
  /** Ondula desplazando a lo largo de `along`. */
  wave?: {
    axis: Axis;
    along: Axis;
    amplitude: number | VariationSpec;
    cycles?: number;
    phase?: number;
  };
}

/**
 * Copias de una pieza. Va en el objeto porque **produce piezas y no forma**, y se
 * aplica después de `deform`: se deforma la pieza y luego se repite.
 *
 * `radial` y `mirror` son excluyentes. Con cualquiera de los dos, la pieza pasa a
 * llamarse `nombre-1` … `nombre-n`, que encaja con los patrones de selección que
 * ya existen.
 */
export interface RepeatSpec {
  /** Copias alrededor de un eje, a ángulos exactos de `2πi/count`. */
  radial?: { count: number; axis?: Axis };
  /** Una copia reflejada en este eje. */
  mirror?: Axis;
  /**
   * Punto por el que pasa el eje de giro, o el plano del espejo. El origen por
   * defecto.
   *
   * Sin esto, un rotor solo se puede poner sobre el eje del mundo: cuatro palas en
   * la punta de un brazo orbitarían el centro de la escena en vez de su propio
   * buje.
   */
  about?: [number, number, number];
}

export interface ObjectSpec {
  name?: string;
  geometry: GeometrySpec;
  /** Copias de la pieza. Solo tiene efecto por el camino de escena. */
  repeat?: RepeatSpec;
  /**
   * Deformaciones en el orden en que se aplican, sobre la malla ya generada y
   * **antes** de la matriz de colocación.
   *
   * Va aquí y no en `geometry` porque `geometry` es una unión de seis formas:
   * meterlo dentro obligaría a repetir el campo en las seis, y el generador
   * número siete se lo dejaría.
   */
  deform?: DeformSpec[];
  /**
   * Colocación exacta, que manda sobre posición, rotación y escala.
   *
   * Existe para poder **deshacer un borrado**: la pieza que se recupera tenía una
   * matriz cualquiera, y descomponerla en traslación, giro y escala pierde el
   * cizallamiento y redondea el resto. Para escribir a mano se usan los otros tres.
   */
  matrix?: number[];
  position?: [number, number, number];
  /** Rotación en grados, orden Y·X·Z. */
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
  color?: [number, number, number];
  specular?: number;
  shininess?: number;
}

export interface SceneSpec {
  objects: ObjectSpec[];
  /**
   * Catálogo de perfiles. Uno declarado y no usado no es error: un catálogo puede
   * tener piezas de repuesto.
   */
  profiles?: ProfileSpec[];
  /**
   * Huesos que animarán las piezas. Declararlo no calcula pesos: el atado es
   * rígido y el vínculo se dice pieza a pieza en `bindings`.
   */
  skeleton?: SkeletonSpec;
  /** Qué pieza va a qué hueso. Obligatorio si hay `skeleton`. */
  bindings?: SkinBindingRule[];
  /** Animaciones sobre los huesos declarados. */
  clips?: ClipSpec[];
  /** Contrato que la escena debe cumplir; mismos campos que `--max-*` en el CLI. */
  budget?: {
    triangles?: number;
    parts?: number;
    boundaryEdges?: number;
    degenerateTriangles?: number;
    symmetryError?: number;
    watertight?: boolean;
  };
}

export interface ResolvedObject {
  name: string;
  node: SceneNode;
}

function isRawMesh(geometry: GeometrySpec): geometry is RawMeshSpec {
  return (geometry as RawMeshSpec).positions !== undefined;
}

function isExtrude(geometry: GeometrySpec): geometry is ExtrudeSpec {
  return (geometry as ExtrudeSpec).extrude !== undefined;
}

function isRevolve(geometry: GeometrySpec): geometry is RevolveSpec {
  return (geometry as RevolveSpec).revolve !== undefined;
}

function isLoft(geometry: GeometrySpec): geometry is LoftSpec {
  return (geometry as LoftSpec).loft !== undefined;
}

function isSweep(geometry: GeometrySpec): geometry is SweepSpec {
  return (geometry as SweepSpec).sweep !== undefined;
}

/**
 * Una tabla de variación en el punto `u`. Un número suelto es una constante, que
 * es la mayoría de los casos y no debe costar seis caracteres.
 *
 * Fuera del rango declarado el valor se **sujeta** al primero o al último:
 * extrapolar daría radios negativos sin avisar de nada.
 */
export function evaluateVariation(spec: number | VariationSpec, u: number, what = "la tabla"): number {
  if (typeof spec === "number") return spec;
  const table = spec.at;
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error(`${what}: \`at\` necesita al menos un par (u, valor)`);
  }
  for (const [index, entry] of table.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${what}: la entrada ${index} de \`at\` son dos números, (u, valor)`);
    }
    if (index > 0 && entry[0] <= table[index - 1][0]) {
      throw new Error(
        `${what}: \`at\` va en orden creciente de u y sin repetir; la entrada ${index} tiene ` +
          `u=${entry[0]} después de u=${table[index - 1][0]}`,
      );
    }
  }

  if (u <= table[0][0]) return table[0][1];
  if (u >= table[table.length - 1][0]) return table[table.length - 1][1];

  let segment = 0;
  while (segment < table.length - 2 && u >= table[segment + 1][0]) segment += 1;
  const [fromU, fromValue] = table[segment];
  const [toU, toValue] = table[segment + 1];
  const t = (u - fromU) / (toU - fromU);

  const ease = spec.ease ?? "linear";
  let eased: number;
  if (ease === "linear") eased = t;
  else if (ease === "smooth") eased = t * t * (3 - 2 * t);
  else if (ease.startsWith("power:")) {
    const exponent = Number(ease.slice("power:".length));
    if (!Number.isFinite(exponent) || exponent <= 0) {
      throw new Error(`${what}: el exponente de \`${ease}\` debe ser un número positivo`);
    }
    eased = t ** exponent;
  } else {
    throw new Error(`${what}: ease desconocido "${ease}"; admitidos: linear, smooth, power:k`);
  }
  return fromValue + (toValue - fromValue) * eased;
}

const DEFORM_KINDS = ["twist", "taper", "bend", "wave"] as const;
const AXES: readonly Axis[] = ["x", "y", "z"];
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

function checkAxis(value: unknown, what: string): Axis {
  if (typeof value !== "string" || !AXES.includes(value as Axis)) {
    throw new Error(`${what}: el eje es "x", "y" o "z", no ${JSON.stringify(value)}`);
  }
  return value as Axis;
}

/** Las deformaciones del documento a las que entiende `applyDeformers`. */
function buildDeformers(specs: readonly DeformSpec[], name: string): Deformer[] {
  return specs.map((spec, index) => {
    const what = `${name}: la deformación ${index}`;
    const declared = DEFORM_KINDS.filter((kind) => spec[kind] !== undefined);
    if (declared.length === 0) {
      throw new Error(`${what} no declara ninguna; admitidas: ${DEFORM_KINDS.join(", ")}`);
    }
    if (declared.length > 1) {
      throw new Error(`${what} declara ${declared.length} (${declared.join(" y ")}); declara una`);
    }

    if (spec.twist !== undefined) {
      const axis = checkAxis(spec.twist.axis, `${what} (twist)`);
      const degrees = spec.twist.degrees ?? 0;
      return {
        kind: "twist" as const,
        axis,
        radians: (u: number) =>
          evaluateVariation(degrees, u, `${what} (twist.degrees)`) * DEGREES_TO_RADIANS,
      };
    }
    if (spec.taper !== undefined) {
      const axis = checkAxis(spec.taper.axis, `${what} (taper)`);
      const scale = spec.taper.scale ?? 1;
      return {
        kind: "taper" as const,
        axis,
        scale: (u: number) => evaluateVariation(scale, u, `${what} (taper.scale)`),
      };
    }
    if (spec.bend !== undefined) {
      const axis = checkAxis(spec.bend.axis, `${what} (bend)`);
      const into = checkAxis(spec.bend.into, `${what} (bend.into)`);
      if (into === axis) throw new Error(`${what}: bend.into ("${into}") no puede ser el propio eje`);
      return { kind: "bend" as const, axis, into, radians: (spec.bend.degrees ?? 0) * DEGREES_TO_RADIANS };
    }

    const wave = spec.wave as NonNullable<DeformSpec["wave"]>;
    const axis = checkAxis(wave.axis, `${what} (wave)`);
    const along = checkAxis(wave.along, `${what} (wave.along)`);
    if (along === axis) throw new Error(`${what}: wave.along ("${along}") no puede ser el propio eje`);
    const amplitude = wave.amplitude ?? 0;
    return {
      kind: "wave" as const,
      axis,
      along,
      amplitude: (u: number) => evaluateVariation(amplitude, u, `${what} (wave.amplitude)`),
      cycles: wave.cycles ?? 1,
      phase: wave.phase ?? 0,
    };
  });
}

/** Estaciones del recorrido declarado, con el radio y la torsión ya aplicados. */
export function resolveSweepPath(spec: SweepSpec): SweepPath {
  const through = spec.path?.through;
  if (!Array.isArray(through)) throw new Error("un barrido necesita `path.through`");
  for (const [index, point] of through.entries()) {
    if (!Array.isArray(point) || point.length !== 3) {
      throw new Error(`el punto ${index} del recorrido son tres números`);
    }
  }

  const path = sweepStations(
    through.map((point) => [point[0], point[1], point[2]] as const),
    { kind: spec.path.kind, closed: spec.path.closed, stations: spec.stations },
  );
  path.stations = path.stations.map((station, index) => ({
    ...station,
    radius: evaluateVariation(spec.radius ?? 1, path.u[index], "radius"),
    // El giro que corrige el residuo del recorrido cerrado ya viene puesto; lo
    // declarado se suma, y los grados del documento pasan a radianes aquí.
    twist:
      station.twist + evaluateVariation(spec.twist ?? 0, path.u[index], "twist") * DEGREES_TO_RADIANS,
  }));
  return path;
}

/** Las secciones del documento a las que entiende `createLoft`. */
function buildLoftSections(
  spec: LoftSpec,
  profiles: ReadonlyMap<string, number[]> | undefined,
): LoftSection[] {
  return spec.loft.map((section, index) => {
    if (section.at === undefined || section.at.length !== 3) {
      throw new Error(`la sección ${index} del loft necesita \`at\` con tres números`);
    }
    const scale = section.scale ?? 1;
    return {
      position: [section.at[0], section.at[1], section.at[2]] as const,
      polygon: polygonOf(section.profile, profiles),
      scale: (typeof scale === "number" ? [scale, scale] : scale) as readonly [number, number],
      // Los grados son cosa del documento; el generador trabaja en radianes.
      twist: (section.twist ?? 0) * DEGREES_TO_RADIANS,
    };
  });
}

const PROFILE_GENERATORS = ["circle", "superellipse", "gielis", "naca"] as const;

/** Un perfil declarado a su polígono. Exige exactamente un generador. */
function buildProfile(spec: ProfileSpec): number[] {
  const declared = PROFILE_GENERATORS.filter((key) => spec[key] !== undefined);
  if (declared.length === 0) {
    throw new Error(
      `el perfil "${spec.name}" no declara generador; admitidos: ${PROFILE_GENERATORS.join(", ")}`,
    );
  }
  if (declared.length > 1) {
    throw new Error(
      `el perfil "${spec.name}" declara ${declared.length} generadores (${declared.join(" y ")}); declara uno`,
    );
  }

  if (spec.circle !== undefined) return createCircleProfile(spec.circle, spec.points ?? 32);
  if (spec.superellipse !== undefined) {
    const [a, b, exponent] = spec.superellipse;
    if (a === undefined || b === undefined || exponent === undefined) {
      throw new Error(`el perfil "${spec.name}": superellipse son tres números, [a, b, exponente]`);
    }
    return createSuperellipseProfile(a, b, exponent, spec.points ?? 32);
  }
  if (spec.gielis !== undefined) {
    const [m, n1, n2, n3, a, b] = spec.gielis;
    if (m === undefined || n1 === undefined || n2 === undefined || n3 === undefined) {
      throw new Error(
        `el perfil "${spec.name}": gielis son al menos cuatro números, [m, n1, n2, n3]`,
      );
    }
    return createGielisProfile(m, n1, n2, n3, {
      a,
      b,
      radius: spec.radius,
      points: spec.points ?? 64,
    });
  }
  return createNacaProfile(spec.naca as string, spec.chord ?? 1, spec.points ?? 64);
}

/** El catálogo entero, resuelto una vez por escena. */
export function resolveProfiles(specs: readonly ProfileSpec[] | undefined): Map<string, number[]> {
  const profiles = new Map<string, number[]>();
  for (const spec of specs ?? []) {
    if (profiles.has(spec.name)) {
      throw new Error(`hay dos perfiles llamados "${spec.name}"; el nombre identifica`);
    }
    profiles.set(spec.name, buildProfile(spec));
  }
  return profiles;
}

export function polygonOf(
  extrude: number[] | string,
  profiles: ReadonlyMap<string, number[]> | undefined,
): number[] {
  if (typeof extrude !== "string") return extrude;
  const polygon = profiles?.get(extrude);
  if (polygon === undefined) {
    const declared = profiles === undefined ? [] : [...profiles.keys()];
    throw new Error(
      `no hay ningún perfil llamado "${extrude}"; ` +
        (declared.length > 0 ? `declarados: ${declared.join(", ")}` : "la escena no declara perfiles"),
    );
  }
  return polygon;
}

function buildPrimitive(spec: PrimitiveSpec): Mesh {
  const p = spec.parameters ?? [];
  switch (spec.primitive) {
    case "box":
      return createBox(p[0] ?? 1, p[1] ?? p[0] ?? 1, p[2] ?? p[0] ?? 1);
    case "sphere":
      return createSphere(p[0] ?? 1, 32, 16);
    case "torus":
      return createTorus(p[0] ?? 1, p[1] ?? 0.35, 48, 24);
    case "plane":
      return createPlane(p[0] ?? 10, p[1] ?? 1);
    case "cylinder":
      return createCylinder(p[0] ?? 0.5, p[0] ?? 0.5, p[1] ?? 1, 32);
    case "cone":
      return createCylinder(p[0] ?? 0.5, 0, p[1] ?? 1, 32);
    default: {
      const exhaustive: never = spec.primitive;
      throw new Error(`primitiva desconocida: ${String(exhaustive)}`);
    }
  }
}

function buildRawMesh(spec: RawMeshSpec): Mesh {
  const positions = Float32Array.from(spec.positions);
  const vertexCount = positions.length / 3;
  if (!Number.isInteger(vertexCount)) {
    throw new Error("positions debe tener un múltiplo de 3 componentes");
  }

  const indices =
    spec.indices !== undefined
      ? Uint32Array.from(spec.indices)
      : Uint32Array.from({ length: vertexCount }, (_value, index) => index);

  for (const index of indices) {
    if (index >= vertexCount) {
      throw new Error(`índice ${index} fuera de rango (${vertexCount} vértices)`);
    }
  }

  const normals =
    spec.normals !== undefined ? Float32Array.from(spec.normals) : new Float32Array(positions.length);
  const uvs = spec.uvs !== undefined ? Float32Array.from(spec.uvs) : new Float32Array(vertexCount * 2);

  let boundingRadius = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const distance = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    if (distance > boundingRadius) boundingRadius = distance;
  }

  const mesh: Mesh = { positions, normals, uvs, indices, boundingRadius };
  if (spec.normals === undefined) computeNormals(mesh);
  return mesh;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

function buildModelMatrix(spec: ObjectSpec): Mat4 {
  if (spec.matrix !== undefined) {
    if (spec.matrix.length !== 16) throw new Error("matrix debe tener 16 números");
    return Float32Array.from(spec.matrix);
  }
  const out = mat4();
  const scratchA = mat4();
  const scratchB = mat4();
  const scratchC = mat4();

  const [rx, ry, rz] = spec.rotation ?? [0, 0, 0];
  multiply(
    rotationY(ry * DEGREES_TO_RADIANS, scratchA),
    rotationX(rx * DEGREES_TO_RADIANS, scratchB),
    scratchC,
  );
  multiply(scratchC, rotationZ(rz * DEGREES_TO_RADIANS, scratchA), out);

  const scale = spec.scale ?? 1;
  const [sx, sy, sz] = typeof scale === "number" ? [scale, scale, scale] : scale;
  multiply(out, scaling(sx, sy, sz, scratchA), scratchB);

  const [tx, ty, tz] = spec.position ?? [0, 0, 0];
  multiply(translation(tx, ty, tz, scratchA), scratchB, out);
  return out;
}

function buildMaterial(spec: ObjectSpec): Material {
  return {
    albedo: spec.color ?? [0.78, 0.78, 0.8],
    specular: spec.specular ?? 0.3,
    shininess: spec.shininess ?? 48,
    checker: false,
    checkerScale: 1,
    checkerTileWorldSize: 1,
  };
}

/**
 * Una pieza declarativa a nodo de escena. Suelta, para poder añadir de una en una.
 *
 * La tabla de perfiles es opcional porque esta función es pública y el parche la
 * llama pieza a pieza, fuera de una escena entera.
 */
export function resolveObject(
  object: ObjectSpec,
  index = 0,
  profiles?: ReadonlyMap<string, number[]>,
): ResolvedObject {
  const geometry = object.geometry;
  const mesh = isRawMesh(geometry)
    ? buildRawMesh(geometry)
    : isExtrude(geometry)
      ? createExtrusion(polygonOf(geometry.extrude, profiles), geometry.height ?? 1)
      : isRevolve(geometry)
        ? createRevolution(geometry.revolve, geometry.segments ?? 32)
        : isLoft(geometry)
          ? createLoft(buildLoftSections(geometry, profiles), {
              samples: geometry.samples,
              caps: geometry.caps,
            })
          : isSweep(geometry)
            ? createSweep(
                polygonOf(geometry.sweep, profiles),
                resolveSweepPath(geometry).stations,
                { closed: geometry.path?.closed, caps: geometry.caps },
              )
            : buildPrimitive(geometry);
  const name = object.name ?? `objeto${index}`;
  if (object.deform !== undefined) applyDeformers(mesh, buildDeformers(object.deform, name));
  return {
    name,
    node: { mesh, model: buildModelMatrix(object), material: buildMaterial(object) },
  };
}

/**
 * La malla reflejada en un eje, horneada.
 *
 * Negar una coordenada invierte la orientación del espacio, así que el bobinado de
 * cada triángulo se invierte también; sin eso la copia saldría con todas las caras
 * hacia dentro. Las normales llevan negada la misma coordenada, y el radio
 * envolvente no cambia porque reflejar no mueve ningún punto respecto al origen.
 */
function mirrorMesh(mesh: Mesh, axis: number): Mesh {
  const positions = Float32Array.from(mesh.positions);
  const normals = Float32Array.from(mesh.normals);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    positions[vertex * 3 + axis] = -positions[vertex * 3 + axis];
    normals[vertex * 3 + axis] = -normals[vertex * 3 + axis];
  }
  const indices = Uint32Array.from(mesh.indices);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const swap = indices[triangle + 1];
    indices[triangle + 1] = indices[triangle + 2];
    indices[triangle + 2] = swap;
  }
  return {
    positions,
    normals,
    uvs: Float32Array.from(mesh.uvs),
    indices,
    boundingRadius: mesh.boundingRadius,
  };
}

function reflectionMatrix(axis: Axis): Mat4 {
  return scaling(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1, axis === "z" ? -1 : 1);
}

/**
 * La transformación `t` llevada al punto `about`: `T(a)·t·T(−a)`.
 *
 * Es la misma idea que ya usa el espejo con la reflexión, aplicada al sitio: girar
 * o reflejar «alrededor de aquí» es hacerlo en el origen con el mundo trasladado.
 * Con `about` en el origen devuelve `t` intacta, así que lo escrito antes de que
 * existiera el campo sigue dando exactamente lo mismo.
 */
function around(transform: Mat4, about: readonly [number, number, number] | undefined): Mat4 {
  if (about === undefined || (about[0] === 0 && about[1] === 0 && about[2] === 0)) return transform;
  return multiply(
    multiply(translation(about[0], about[1], about[2]), transform),
    translation(-about[0], -about[1], -about[2]),
  );
}

function axisRotation(axis: Axis, angle: number): Mat4 {
  if (axis === "x") return rotationX(angle);
  if (axis === "z") return rotationZ(angle);
  return rotationY(angle);
}

/**
 * Una pieza y sus copias. Existe aparte de `resolveObject` porque aquella es
 * pública y hay dos sitios que la llaman esperando **una** pieza.
 */
export function resolveCopies(
  object: ObjectSpec,
  index = 0,
  profiles?: ReadonlyMap<string, number[]>,
): ResolvedObject[] {
  const base = resolveObject(object, index, profiles);
  const repeat = object.repeat;
  if (repeat === undefined) return [base];

  const declared = (["radial", "mirror"] as const).filter((kind) => repeat[kind] !== undefined);
  if (declared.length === 0) {
    throw new Error(`${base.name}: repeat no declara ni radial ni mirror`);
  }
  if (declared.length > 1) {
    throw new Error(`${base.name}: repeat declara radial y mirror; son excluyentes`);
  }

  if (repeat.radial !== undefined) {
    const count = repeat.radial.count;
    if (!Number.isInteger(count) || count < 2) {
      throw new Error(`${base.name}: repeat.radial.count es un entero de 2 en adelante, no ${count}`);
    }
    const axis = checkAxis(repeat.radial.axis ?? "y", `${base.name}: repeat.radial`);
    return Array.from({ length: count }, (_value, copy) => ({
      name: `${base.name}-${copy + 1}`,
      node: {
        ...base.node,
        // El ángulo se **calcula**, nunca se acumula sumando el paso a la copia
        // anterior: acumular arrastra error y la última pala deja de estar donde
        // dice. Y la malla se comparte: son la misma geometría en sitios
        // distintos, y clonarla sería tirar memoria y romper el agrupado de
        // mallas repetidas del exportador de GLB.
        model: multiply(
          around(axisRotation(axis, (copy * 2 * Math.PI) / count), repeat.about),
          base.node.model,
        ),
      },
    }));
  }

  const axis = checkAxis(repeat.mirror as Axis, `${base.name}: repeat.mirror`);
  const reflection = reflectionMatrix(axis);
  // La matriz va **conjugada**, `S·M·S`, y el espejo horneado en la malla. Con la
  // matriz reflejada a secas el determinante sería negativo: el rasterizador
  // apagaría el descarte en espacio de objeto, y la copia daría volumen firmado
  // negativo, o sea un `MALLA_INVERTIDA` falso sobre una pieza correcta. Conjugar
  // deja el determinante como estaba —`det(S)·det(M)·det(S)`— y sigue siendo el
  // reflejo exacto, porque `S·S` es la identidad.
  //
  // Con el plano desplazado, la de la izquierda es la reflexión llevada al punto y
  // la de la derecha sigue siendo la pura: el espejo horneado en la malla es el de
  // siempre —negar una coordenada— y así la geometría no se aleja de su origen. El
  // determinante sigue saliendo positivo, porque las dos son reflexiones.
  const mirrored = multiply(
    multiply(around(reflection, repeat.about), base.node.model),
    reflection,
  );
  return [
    { name: `${base.name}-1`, node: base.node },
    {
      name: `${base.name}-2`,
      node: { ...base.node, mesh: mirrorMesh(base.node.mesh, AXIS_INDEX[axis]), model: mirrored },
    },
  ];
}

export function resolveScene(spec: SceneSpec): ResolvedObject[] {
  // Contra el esquema antes de tocar nada: un campo mal escrito se ignoraría en
  // silencio y el agente vería un render que no es el que pidió, sin saber por qué.
  assertValid(spec, SCENE_SCHEMA, "la escena");
  if (spec.objects.length === 0) {
    throw new Error("la escena necesita al menos un objeto en `objects`");
  }

  const profiles = resolveProfiles(spec.profiles);
  return spec.objects.flatMap((object, index) => resolveCopies(object, index, profiles));
}

/**
 * La escena como modelo direccionable, que es lo que hace falta para exportarla.
 *
 * Sin esto, un objeto inventado desde cero solo podía salir como imagen: crear y
 * entregar eran caminos distintos, y el segundo no existía.
 */
export function modelFromScene(spec: SceneSpec, source = "escena"): Model {
  return {
    source,
    notes: [],
    parts: resolveScene(spec).map((entry) => ({
      name: entry.name,
      path: entry.name,
      mesh: entry.node.mesh,
      matrix: entry.node.model,
      materialName: null,
      baseColor: [...entry.node.material.albedo] as [number, number, number],
      visible: true,
    })),
  };
}

/** Suelo de referencia: sin él no hay escala visible ni sombra de contacto. */
export function createGroundPlane(size: number): SceneNode {
  return {
    mesh: createPlane(size, 1),
    model: identity(mat4()),
    castsShadow: false,
    material: {
      albedo: [0.3, 0.32, 0.36],
      specular: 0.05,
      shininess: 12,
      checker: true,
      checkerScale: Math.max(2, Math.round(size / 2)),
      checkerTileWorldSize: 2,
    },
  };
}
