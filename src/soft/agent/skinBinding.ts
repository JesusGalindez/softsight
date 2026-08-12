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
import { writeMatrixFromGltf, writeMatrixFromGltfTrs, writeMatrixToGltf } from "./gltfFrame";
import type { ParsedGlb } from "./animation";
import type {
  SkinnedGlbAnimation,
  SkinnedGlbNode,
  SkinnedGlbPrimitive,
  SkinnedGlbScene,
} from "./glbWriter";
import { matchesPattern } from "./model";
import type { Model, ModelPart } from "./model";
import { evaluateVariation } from "../variation";
import type { VariationSpec } from "../variation";

/**
 * Reparto del peso entre el hueso de la regla y otro, a lo largo del segmento que
 * los une en reposo.
 *
 * El parámetro `t` es la proyección de cada vértice sobre ese segmento: **0 en el
 * hueso de la regla y 1 en `with`**, y **no se sujeta al rango**, porque la
 * costura de una pieza cae fuera de él tantas veces como dentro. En el codo de dos
 * cilindros del plan, la misma costura se declara así desde cada lado:
 *
 * - el brazo, atado a `hombro`, la tiene en `t = 1` → banda `[0.85, 1.15]`;
 * - el antebrazo, atado a `codo`, la tiene en `t = 0` → banda `[-0.15, 0.15]`.
 *
 * En los dos casos el vértice de la costura sale a mitad de camino —0,5 y 0,5— y
 * por eso no se abre al doblar. Las bandas son distintas porque la costura está a
 * distinta altura del hueso de cada pieza, no porque haya dos reglas.
 *
 * Qué es de quién: `w` es lo que se lleva **`with`**, y `1 − w` se queda en el
 * hueso de la regla.
 */
export interface BlendSpec {
  /** El otro hueso. Debe existir, y no puede ser el de la regla. */
  with: string;
  /** Dónde empieza la banda, en unidades del segmento. Antes de aquí, todo al hueso de la regla. */
  from: number;
  /** Dónde acaba. Después de aquí, todo a `with`. Tiene que ser mayor que `from`. */
  to: number;
  /** `linear` por defecto; `smooth`; o `power:k`. La misma tabla que la forma y el movimiento. */
  ease?: string;
}

/** Una regla: las piezas que encajan con `part` se atan al hueso `joint`. */
export interface SkinBindingRule {
  /** Patrón de pieza, con la misma sintaxis que `--select`: `rotor-*`, `torso`. */
  part: string;
  /** Nombre del nodo del esqueleto. Debe existir. */
  joint: string;
  /**
   * Reparto con otro hueso alrededor de la articulación, o **una lista** si la
   * pieza tiene costura por más de un sitio: el antebrazo de un brazo de tres la
   * tiene en el codo y en la muñeca, y con una sola banda solo podía soldar una.
   *
   * Sin esto el atado es rígido —peso 1 sobre `joint`—, que para una pieza rígida
   * de verdad no es una simplificación sino la respuesta exacta.
   *
   * **Tres como mucho**: glTF escribe cuatro influencias por vértice y una es
   * siempre `joint`. Y pueden solaparse —un hombro reparte hacia tres huesos a la
   * vez—; lo que no puede es que entre todas se lleven más de lo que hay, y eso se
   * comprueba vértice a vértice.
   */
  blend?: BlendSpec | BlendSpec[];
}

/** Las bandas de una regla, siempre como lista. */
function blendsOf(rule: SkinBindingRule): BlendSpec[] {
  if (rule.blend === undefined) return [];
  return Array.isArray(rule.blend) ? rule.blend : [rule.blend];
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

/**
 * Una banda ya resuelta contra el esqueleto: los índices de los dos huesos, el
 * segmento que los une en reposo y la tabla que reparte a lo largo de él.
 *
 * Se resuelve **una vez por regla** y no una vez por vértice: buscar el hueso por
 * nombre y restar dos posiciones dentro del bucle sería repetir por cada vértice
 * un trabajo que no depende del vértice.
 */
interface ResolvedBlend {
  other: number;
  /** Posición de reposo del hueso de la regla, en espacio de modelo. */
  origin: [number, number, number];
  /** Vector hacia el otro hueso, sin normalizar; `t` sale dividiendo por su módulo al cuadrado. */
  axis: [number, number, number];
  axisLengthSquared: number;
  /** El reparto como tabla de variación: `from` da 0 y `to` da 1. */
  band: VariationSpec;
  /** Para los mensajes de error, que salen mientras se evalúa. */
  what: string;
}

/** Cuántas influencias por vértice escribe glTF en un juego de `JOINTS_0`. */
const INFLUENCES = 4;

/**
 * Los pesos de una pieza: qué hueso mueve cada vértice y cuánto.
 *
 * Es **el único sitio donde se decide un peso**. Escrito dentro del bucle de
 * primitivas, este reparto quedaría entre la aritmética de posiciones, normales y
 * UVs, y cada una de las cuatro cosas se leería peor. Aquí entra lo medido y sale
 * lo escrito, sin tocar nada más.
 *
 * **Sin banda el atado es rígido**: cada vértice pesa 1 sobre un solo hueso. No es
 * una simplificación de algo mejor —para una pieza rígida de verdad es la
 * respuesta exacta—, y ese camino sale byte a byte igual que antes de que
 * existiera este otro. Ver [`docs/plan-pesos.md`](../../../docs/plan-pesos.md).
 *
 * **Con banda**, cada vértice se proyecta sobre el segmento entre los dos huesos
 * en reposo y el parámetro se pasa por la misma tabla de variación que describe
 * una forma o un movimiento. No hay curva nueva que mantener: `from` es donde la
 * tabla vale 0 y `to` donde vale 1, y fuera del rango `evaluateVariation` sujeta
 * al primero o al último, que es justo lo que hace falta —antes de la banda todo
 * al hueso de la regla, después todo al otro—.
 *
 * Aquí no se normaliza nada: dos pesos que salen de `w` y `1 − w` suman uno por
 * construcción, y el redondeo a `Float32` que hace el propio array lo absorbe el
 * lector, que divide por el total antes de mezclar.
 *
 * Los cuatro huecos por vértice son los de `JOINTS_0`/`WEIGHTS_0`: glTF los
 * escribe siempre en grupos de cuatro, y los que no se usan van a cero.
 */
function weightsFor(
  positions: Float32Array,
  joint: number,
  blends: readonly ResolvedBlend[],
  part: string,
): { joints: Uint16Array; weights: Float32Array } {
  const vertexCount = positions.length / 3;
  const joints = new Uint16Array(vertexCount * INFLUENCES);
  const weights = new Float32Array(vertexCount * INFLUENCES);

  if (blends.length === 0) {
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      joints[vertex * INFLUENCES] = joint;
      weights[vertex * INFLUENCES] = 1;
    }
    return { joints, weights };
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let taken = 0;
    for (const [index, blend] of blends.entries()) {
      const t =
        ((positions[vertex * 3] - blend.origin[0]) * blend.axis[0] +
          (positions[vertex * 3 + 1] - blend.origin[1]) * blend.axis[1] +
          (positions[vertex * 3 + 2] - blend.origin[2]) * blend.axis[2]) /
        blend.axisLengthSquared;
      const share = evaluateVariation(blend.band, t, blend.what);
      taken += share;
      joints[vertex * INFLUENCES + index + 1] = blend.other;
      weights[vertex * INFLUENCES + index + 1] = share;
    }
    // Solaparse está permitido —un hombro reparte hacia tres huesos a la vez—;
    // llevarse más de lo que hay, no. Sale aquí y no en un aviso porque el
    // resultado no sería «peor»: sería un peso negativo, que ningún reproductor
    // sabe interpretar. Y sale con el vértice, que es por donde se mira la banda
    // que sobra.
    if (taken > 1 + 1e-6) {
      throw new Error(
        `vínculo: las bandas de '${part}' se llevan ${taken.toFixed(3)} del vértice ${vertex}, ` +
          "más de lo que hay. Solaparse vale; pasarse de 1 dejaría al hueso de la regla con peso " +
          "negativo. Estrecha alguna banda o quita la que sobra.",
      );
    }
    joints[vertex * INFLUENCES] = joint;
    weights[vertex * INFLUENCES] = 1 - taken;
  }
  return { joints, weights };
}

export interface BindResult {
  scene: SkinnedGlbScene;
  /** Qué pieza acabó en qué hueso, en el orden del modelo. Para el informe. */
  bound: Array<{ part: string; joint: string }>;
  /** Huesos del esqueleto que no recibieron ninguna pieza. No es un error. */
  unusedJoints: string[];
  /**
   * Piezas cuya regla declaró banda. El informe lo publica para que nadie tenga
   * que deducir del GLB si el atado fue rígido: una pieza que aparece aquí
   * reparte su peso entre dos huesos, y una que no, pesa 1 sobre el suyo.
   */
  blendedParts: string[];
}

/**
 * Compone la matriz de un nodo glTF en la convención del núcleo.
 *
 * La conversión la hace `gltfFrame.ts`, que es donde D32 exige que ocurra: este
 * fichero la tenía escrita otra vez, y una transposición duplicada es el riesgo
 * R13 —dos que se cancelan dejan la geometría bien colocada por casualidad—.
 */
function localMatrixOf(node: {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}): Mat4 {
  const out = mat4();
  if (node.matrix) {
    writeMatrixFromGltf(node.matrix, out);
    return out;
  }
  writeMatrixFromGltfTrs(
    node.translation ?? [0, 0, 0],
    node.rotation ?? [0, 0, 0, 1],
    node.scale ?? [1, 1, 1],
    out,
  );
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

/** Fila-mayor a columna-mayor, la vuelta de la frontera; también en `gltfFrame.ts`. */
function toColumnMajor(matrix: Mat4, out: Float32Array, offset: number): void {
  writeMatrixToGltf(matrix, out, offset);
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

  // El hueso de la regla y el de la banda se comprueban juntos: los dos tienen que
  // existir, y un `with` inventado falla igual de pronto que un `joint` inventado.
  const unknown = binding.bindings.flatMap((rule) =>
    [rule.joint, ...blendsOf(rule).map((blend) => blend.with)].filter(
      (name) => !indexByName.has(name),
    ),
  );
  if (unknown.length > 0) {
    const names = [...indexByName.keys()].slice(0, 12).join(", ");
    throw new Error(
      `vínculo: el esqueleto no tiene ${unknown.map((name) => `'${name}'`).join(", ")}; ` +
        `los huesos disponibles son ${names}${indexByName.size > 12 ? "…" : ""}`,
    );
  }

  // Resolver antes de construir nada: si falta una pieza por atar, el error sale
  // con la lista entera y no de una en una.
  const resolved: Array<{
    part: ModelPart;
    joint: number;
    jointName: string;
    rule: SkinBindingRule;
  }> = [];
  const orphans: string[] = [];
  for (const part of model.parts) {
    const rule = binding.bindings.find((candidate) => matchesPattern(part, candidate.part));
    if (!rule) {
      orphans.push(part.name);
      continue;
    }
    resolved.push({ part, joint: indexByName.get(rule.joint)!, jointName: rule.joint, rule });
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

  // Las bandas se resuelven una vez por regla, con la pose de reposo ya calculada:
  // el segmento sobre el que se mide no depende del vértice.
  const blendByRule = new Map<SkinBindingRule, ResolvedBlend[]>();
  for (const rule of binding.bindings) {
    const declared = blendsOf(rule);
    if (declared.length === 0) continue;
    // Tres como mucho: la cuarta influencia de glTF ya se la lleva `joint`.
    if (declared.length > INFLUENCES - 1) {
      throw new Error(
        `vínculo: '${rule.part}' declara ${declared.length} bandas y caben ${INFLUENCES - 1}; ` +
          `glTF escribe ${INFLUENCES} influencias por vértice y una es siempre '${rule.joint}'`,
      );
    }
    const towards = new Set<string>();
    const resolvedBlends: ResolvedBlend[] = [];
    for (const blend of declared) {
      const what =
        declared.length === 1
          ? `vínculo: la banda de '${rule.part}'`
          : `vínculo: la banda de '${rule.part}' hacia '${blend.with}'`;
      if (blend.with === rule.joint) {
        throw new Error(`${what} reparte '${rule.joint}' consigo mismo; \`with\` tiene que ser otro hueso`);
      }
      // Dos bandas hacia el mismo hueso se sumarían sin que nadie lo haya pedido,
      // y la segunda pisaría el hueco de la primera al escribir las influencias.
      if (towards.has(blend.with)) {
        throw new Error(
          `${what}: '${rule.part}' ya reparte hacia '${blend.with}'; una banda por hueso, ` +
            "y si quieres más ancho, ensancha la que hay",
        );
      }
      towards.add(blend.with);
      if (!(blend.from < blend.to)) {
        throw new Error(
          `${what} va de ${blend.from} a ${blend.to}: \`from\` tiene que ser menor que \`to\`, ` +
            "porque es donde el reparto empieza y donde acaba",
        );
      }
      const other = indexByName.get(blend.with)!;
      const own = indexByName.get(rule.joint)!;
      const from: [number, number, number] = [worlds[own][3], worlds[own][7], worlds[own][11]];
      const to: [number, number, number] = [worlds[other][3], worlds[other][7], worlds[other][11]];
      const axis: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const axisLengthSquared = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
      if (axisLengthSquared === 0) {
        throw new Error(
          `${what}: '${rule.joint}' y '${blend.with}' ocupan el mismo sitio en reposo, ` +
            "así que no hay segmento sobre el que medir el reparto",
        );
      }
      const band: VariationSpec = {
        at: [
          [blend.from, 0],
          [blend.to, 1],
        ],
        ...(blend.ease !== undefined ? { ease: blend.ease } : {}),
      };
      // Una evaluación de prueba para que un `ease` inventado falle aquí, con la
      // regla delante, y no en el primer vértice de una malla que ya se estaba
      // escribiendo. El vocabulario de curvas lo dice `evaluateVariation` y nadie
      // más: comprobarlo con una lista propia serían dos fuentes del mismo dato.
      evaluateVariation(band, (blend.from + blend.to) / 2, what);
      resolvedBlends.push({ other, origin: from, axis, axisLengthSquared, band, what });
    }
    blendByRule.set(rule, resolvedBlends);
  }

  // Los vértices van a espacio de modelo, que es donde vive la pose de reposo del
  // esqueleto. Sin este paso cada pieza quedaría en su propio espacio local y el
  // modelo saldría explotado en cuanto se aplicara la primera pose.
  const point = new Float32Array(4);
  const direction = new Float32Array(3);
  const normals = mat4();

  const primitives: SkinnedGlbPrimitive[] = resolved.map(({ part, joint, rule }) => {
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

    const { joints: jointIndices, weights: jointWeights } = weightsFor(
      positions,
      joint,
      blendByRule.get(rule) ?? [],
      part.name,
    );

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
  // El nombre no lleva `model.source` a propósito: es la ruta del fichero de
  // entrada, y meterla dentro haría que el mismo modelo diera bytes distintos
  // según en qué carpeta estuviera. La salida no depende de dónde vive la
  // entrada; lo cazó la puerta al comparar el GLB del CLI con el del puente.
  nodes.push({ name: "piel", mesh: 0, skin: 0 });

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
    blendedParts: resolved
      .filter((entry) => blendByRule.has(entry.rule))
      .map((entry) => entry.part.name),
    unusedJoints: skeletonNodes
      .map((node, index) => (used.has(index) ? null : node.name ?? `nodo${index}`))
      .filter((name): name is string => name !== null),
  };
}
