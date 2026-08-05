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
  computeNormals,
  createBox,
  createCylinder,
  createExtrusion,
  createPlane,
  createRevolution,
  createSphere,
  createTorus,
  type Mesh,
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

export interface ExtrudeSpec {
  /** Polígono en el plano XZ, pares `x,z`. Puede ser cóncavo; sin agujeros. */
  extrude: number[];
  /** Altura total; se reparte a ambos lados del origen. */
  height?: number;
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

export type GeometrySpec = PrimitiveSpec | RawMeshSpec | ExtrudeSpec | RevolveSpec;

export interface ObjectSpec {
  name?: string;
  geometry: GeometrySpec;
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

/** Una pieza declarativa a nodo de escena. Suelta, para poder añadir de una en una. */
export function resolveObject(object: ObjectSpec, index = 0): ResolvedObject {
  const geometry = object.geometry;
  const mesh = isRawMesh(geometry)
    ? buildRawMesh(geometry)
    : isExtrude(geometry)
      ? createExtrusion(geometry.extrude, geometry.height ?? 1)
      : isRevolve(geometry)
        ? createRevolution(geometry.revolve, geometry.segments ?? 32)
        : buildPrimitive(geometry);
  return {
    name: object.name ?? `objeto${index}`,
    node: { mesh, model: buildModelMatrix(object), material: buildMaterial(object) },
  };
}

export function resolveScene(spec: SceneSpec): ResolvedObject[] {
  // Contra el esquema antes de tocar nada: un campo mal escrito se ignoraría en
  // silencio y el agente vería un render que no es el que pidió, sin saber por qué.
  assertValid(spec, SCENE_SCHEMA, "la escena");
  if (spec.objects.length === 0) {
    throw new Error("la escena necesita al menos un objeto en `objects`");
  }

  return spec.objects.map((object, index) => resolveObject(object, index));
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
