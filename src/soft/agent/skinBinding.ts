/**
 * Atar una malla a un esqueleto: el eslabón que faltaba entre leer movimiento y
 * escribirlo.
 *
 * Hasta aquí SoftSight sabía leer un BVH y sabía escribir un GLB con skinning,
 * pero no había forma de decir «coge este esqueleto y esta malla y únelos». Lo
 * que salía eran esqueletos, que no se pueden mirar.
 *
 * **Esto no es rigging automático, y la diferencia importa.** El plan excluye a
 * propósito el rigging, la IK y el retargeting: convierten un banco de
 * verificación en un Blender para agentes. Aquí no se calcula ni un solo peso.
 * El vínculo lo declara quien llama —qué pieza va a qué hueso— y la herramienta
 * hace tres cosas que sí son suyas:
 *
 * 1. **Comprobar** que el vínculo cubre todas las piezas y que todos los huesos
 *    existen. Una pieza sin atar no se ata al hueso raíz por si acaso: es un
 *    error, porque un modelo mal atado se ve bien quieto y se rompe al animar.
 * 2. **Colocar**: llevar los vértices de cada pieza a espacio de modelo y
 *    calcular la matriz de enlace inversa de cada hueso desde su pose de reposo.
 * 3. **Ensamblar** el resultado en la escena que traga `serializeSkinnedGlb`.
 *
 * Por eso el atado es **rígido**: cada vértice pesa 1 sobre un solo hueso. No es
 * una simplificación de algo mejor, es lo único que se puede afirmar sin
 * inventar. Un modelo mecánico —el dron de pruebas, con sus 296 piezas con
 * nombre— se ata así y queda exacto, porque sus piezas son rígidas de verdad.
 * Una malla orgánica continua necesita pesos suaves, y esos los trae quien los
 * tenga: `serializeSkinnedGlb` acepta `JOINTS_0` y `WEIGHTS_0` directamente.
 */

import { invertAffine, mat4, multiply, normalMatrix, transformDirection, transformPoint } from "../math";
import type { Mat4 } from "../math";
import { readAccessorValues } from "./animation";
import type { ParsedGlb } from "./animation";
import type {
  SkinnedGlbAnimation,
  SkinnedGlbNode,
  SkinnedGlbPrimitive,
  SkinnedGlbScene,
} from "./glbWriter";
import { matchesPattern } from "./model";
import type { Model, ModelPart } from "./model";

/** Una regla: las piezas que encajan con `part` se atan al hueso `joint`. */
export interface SkinBindingRule {
  /** Patrón de pieza, con la misma sintaxis que `--select`: `rotor-*`, `torso`. */
  part: string;
  /** Nombre del nodo del esqueleto. Debe existir. */
  joint: string;
}

/**
 * Documento de vínculo. Las reglas se prueban **en orden** y gana la primera que
 * encaja, así que lo específico va antes que lo general y `{ "part": "*" }` al
 * final es el «todo lo demás», declarado a propósito y no por descuido.
 */
export interface SkinBinding {
  schemaVersion: 1;
  bindings: SkinBindingRule[];
}

/**
 * Un esqueleto, venga de donde venga.
 *
 * El atado no debe saber si los huesos salieron de un GLB o de una escena
 * declarativa. Si lo supiera habría dos caminos que mantener, y acabarían
 * divergiendo en el primer detalle que alguien arreglara solo en uno.
 */
export interface SkeletonSource {
  nodes: SkinnedGlbNode[];
  /** Nodos raíz. Vacío significa «los que nadie declara como hijos». */
  roots: number[];
  animations: SkinnedGlbAnimation[];
}

/** Raíces declaradas, o las deducidas si no hay ninguna declarada. */
function rootsOf(skeleton: SkeletonSource): number[] {
  if (skeleton.roots.length > 0) return skeleton.roots;
  const declaredAsChild = new Set(skeleton.nodes.flatMap((node) => node.children ?? []));
  return skeleton.nodes.map((_node, index) => index).filter((index) => !declaredAsChild.has(index));
}

/**
 * Levanta el esqueleto de un GLB ya parseado a la forma que entiende el atado.
 *
 * Leer aquí los muestreadores, y no dentro del atado, es lo que permite que una
 * escena declarativa entre por la misma puerta sin pasar por un fichero.
 */
export function skeletonFromParsedGlb(parsed: ParsedGlb): SkeletonSource {
  const document = parsed.document;
  return {
    nodes: (document.nodes ?? []).map((node) => ({
      ...(node.name !== undefined ? { name: node.name } : {}),
      ...(node.matrix ? { matrix: [...node.matrix] } : {}),
      ...(node.translation ? { translation: [...node.translation] } : {}),
      ...(node.rotation ? { rotation: [...node.rotation] } : {}),
      ...(node.scale ? { scale: [...node.scale] } : {}),
      ...(node.children ? { children: [...node.children] } : {}),
    })),
    roots: document.scenes?.[document.scene ?? 0]?.nodes ?? [],
    animations: (document.animations ?? []).map((animation) => ({
      ...(animation.name !== undefined ? { name: animation.name } : {}),
      samplers: animation.samplers.map((sampler) => ({
        times: Float32Array.from(readAccessorValues(parsed, sampler.input)),
        values: Float32Array.from(readAccessorValues(parsed, sampler.output)),
        ...(sampler.interpolation ? { interpolation: sampler.interpolation } : {}),
      })),
      channels: animation.channels
        .filter((channel) => channel.target.node !== undefined)
        .map((channel) => ({
          sampler: channel.sampler,
          node: channel.target.node!,
          path: channel.target.path as "translation" | "rotation" | "scale" | "weights",
        })),
    })),
  };
}

export interface BindResult {
  scene: SkinnedGlbScene;
  /** Qué pieza acabó en qué hueso, en el orden del modelo. Para el informe. */
  bound: Array<{ part: string; joint: string }>;
  /** Huesos del esqueleto que no recibieron ninguna pieza. No es un error. */
  unusedJoints: string[];
}

/** Compone la matriz de un nodo glTF en fila-mayor, la convención del núcleo. */
function localMatrixOf(node: {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}): Mat4 {
  const out = mat4();
  if (node.matrix) {
    // glTF la guarda por columnas; aquí todo va por filas.
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) out[row * 4 + column] = node.matrix[column * 4 + row];
    }
    return out;
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy - wz) * sy;
  out[2] = (xz + wy) * sz;
  out[3] = tx;
  out[4] = (xy + wz) * sx;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz - wx) * sz;
  out[7] = ty;
  out[8] = (xz - wy) * sx;
  out[9] = (yz + wx) * sy;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = tz;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

/** Matrices de mundo de la pose de reposo, con la jerarquía ya acumulada. */
export function restWorldMatrices(skeleton: SkeletonSource): Mat4[] {
  const nodes = skeleton.nodes;
  const worlds: Mat4[] = nodes.map(() => mat4());
  const seen = new Array<boolean>(nodes.length).fill(false);
  const roots = rootsOf(skeleton);

  const walk = (index: number, parent: Mat4): void => {
    if (seen[index]) throw new Error(`el esqueleto tiene un ciclo en el nodo ${index}`);
    seen[index] = true;
    worlds[index] = multiply(parent, localMatrixOf(nodes[index]), mat4());
    for (const child of nodes[index].children ?? []) walk(child, worlds[index]);
  };
  const identity = mat4();
  identity[0] = 1;
  identity[5] = 1;
  identity[10] = 1;
  identity[15] = 1;
  for (const root of roots) walk(root, identity);
  return worlds;
}

/** Fila-mayor a columna-mayor, que es como glTF guarda las matrices. */
function toColumnMajor(matrix: Mat4, out: Float32Array, offset: number): void {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out[offset + column * 4 + row] = matrix[row * 4 + column];
  }
}

/**
 * Ata las piezas de un modelo a los huesos de un esqueleto y devuelve la escena
 * lista para `serializeSkinnedGlb`.
 *
 * El esqueleto entra ya parseado (`parseGlbAnimation`), con sus nodos y sus
 * clips: los clips viajan tal cual, porque atar una malla no cambia el
 * movimiento.
 */
export function bindModelToSkeleton(model: Model, skeleton: SkeletonSource, binding: SkinBinding): BindResult {
  if (binding.schemaVersion !== 1) {
    throw new Error(`vínculo: schemaVersion ${binding.schemaVersion} desconocida; se espera 1`);
  }
  if (!Array.isArray(binding.bindings) || binding.bindings.length === 0) {
    throw new Error("vínculo: 'bindings' debe ser una lista no vacía de { part, joint }");
  }

  const skeletonNodes = skeleton.nodes;
  if (skeletonNodes.length === 0) throw new Error("el esqueleto no tiene nodos");

  const indexByName = new Map<string, number>();
  skeletonNodes.forEach((node, index) => {
    if (node.name !== undefined && !indexByName.has(node.name)) indexByName.set(node.name, index);
  });

  const unknown = binding.bindings.filter((rule) => !indexByName.has(rule.joint));
  if (unknown.length > 0) {
    const names = [...indexByName.keys()].slice(0, 12).join(", ");
    throw new Error(
      `vínculo: el esqueleto no tiene ${unknown.map((rule) => `'${rule.joint}'`).join(", ")}; ` +
        `los huesos disponibles son ${names}${indexByName.size > 12 ? "…" : ""}`,
    );
  }

  // Resolver antes de construir nada: si falta una pieza por atar, el error sale
  // con la lista entera y no de una en una.
  const resolved: Array<{ part: ModelPart; joint: number; jointName: string }> = [];
  const orphans: string[] = [];
  for (const part of model.parts) {
    const rule = binding.bindings.find((candidate) => matchesPattern(part, candidate.part));
    if (!rule) {
      orphans.push(part.name);
      continue;
    }
    resolved.push({ part, joint: indexByName.get(rule.joint)!, jointName: rule.joint });
  }
  if (orphans.length > 0) {
    const shown = orphans.slice(0, 8).join(", ");
    throw new Error(
      `vínculo: ${orphans.length} pieza(s) sin hueso: ${shown}${orphans.length > 8 ? "…" : ""}. ` +
        "Una pieza sin atar no se ata a la raíz por si acaso: se vería bien quieta y se rompería al animar. " +
        'Añade su regla, o `{ "part": "*", "joint": "<raíz>" }` al final si de verdad quieres un cajón de sastre.',
    );
  }

  // El esqueleto entero es la lista de joints de la piel: animar un hueso
  // intermedio tiene que arrastrar a sus hijos aunque no lleve ninguna pieza.
  const worlds = restWorldMatrices(skeleton);
  const inverseBindMatrices = new Float32Array(skeletonNodes.length * 16);
  const inverse = mat4();
  for (let index = 0; index < skeletonNodes.length; index += 1) {
    const determinant = invertAffine(worlds[index], inverse);
    if (determinant === 0) {
      throw new Error(
        `vínculo: el hueso '${skeletonNodes[index].name ?? index}' tiene una matriz de reposo sin inversa ` +
          "(escala cero); su matriz de enlace no existe",
      );
    }
    toColumnMajor(inverse, inverseBindMatrices, index * 16);
  }

  // Los vértices van a espacio de modelo, que es donde vive la pose de reposo del
  // esqueleto. Sin este paso cada pieza quedaría en su propio espacio local y el
  // modelo saldría explotado en cuanto se aplicara la primera pose.
  const point = new Float32Array(4);
  const direction = new Float32Array(3);
  const normals = mat4();

  const primitives: SkinnedGlbPrimitive[] = resolved.map(({ part, joint }) => {
    const source = part.mesh;
    const vertexCount = source.positions.length / 3;
    const positions = new Float32Array(source.positions.length);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      transformPoint(
        part.matrix,
        source.positions[vertex * 3],
        source.positions[vertex * 3 + 1],
        source.positions[vertex * 3 + 2],
        point,
      );
      positions[vertex * 3] = point[0];
      positions[vertex * 3 + 1] = point[1];
      positions[vertex * 3 + 2] = point[2];
    }

    let transformed: Float32Array | undefined;
    if (source.normals.length === source.positions.length) {
      normalMatrix(part.matrix, normals);
      transformed = new Float32Array(source.normals.length);
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        transformDirection(
          normals,
          source.normals[vertex * 3],
          source.normals[vertex * 3 + 1],
          source.normals[vertex * 3 + 2],
          direction,
        );
        const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
        transformed[vertex * 3] = direction[0] / length;
        transformed[vertex * 3 + 1] = direction[1] / length;
        transformed[vertex * 3 + 2] = direction[2] / length;
      }
    }

    // Atado rígido: un hueso por vértice, peso 1. Lo único que se puede afirmar
    // sin inventar; los pesos suaves los trae quien los tenga.
    const jointIndices = new Uint16Array(vertexCount * 4);
    const jointWeights = new Float32Array(vertexCount * 4);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      jointIndices[vertex * 4] = joint;
      jointWeights[vertex * 4] = 1;
    }

    return {
      positions,
      ...(transformed ? { normals: transformed } : {}),
      ...(source.uvs.length === vertexCount * 2 ? { uvs: source.uvs } : {}),
      indices: source.indices,
      joints: jointIndices,
      weights: jointWeights,
      ...(part.baseColor ? { baseColor: [...part.baseColor] } : {}),
      ...(part.materialName ? { materialName: part.materialName } : {}),
    };
  });

  const nodes: SkinnedGlbNode[] = skeletonNodes.map((node) => ({ ...node }));

  const meshNode = nodes.length;
  nodes.push({ name: `${model.source || "modelo"}-piel`, mesh: 0, skin: 0 });

  const animations = skeleton.animations;
  const roots = rootsOf(skeleton);
  const used = new Set(resolved.map((entry) => entry.joint));

  return {
    scene: {
      nodes,
      meshes: [{ name: "piel", primitives }],
      skins: [
        {
          name: "esqueleto",
          joints: skeletonNodes.map((_node, index) => index),
          inverseBindMatrices,
          ...(roots.length === 1 ? { skeleton: roots[0] } : {}),
        },
      ],
      ...(animations.length > 0 ? { animations } : {}),
      roots: [...roots, meshNode],
    },
    bound: resolved.map((entry) => ({ part: entry.part.name, joint: entry.jointName })),
    unusedJoints: skeletonNodes
      .map((node, index) => (used.has(index) ? null : node.name ?? `nodo${index}`))
      .filter((name): name is string => name !== null),
  };
}
