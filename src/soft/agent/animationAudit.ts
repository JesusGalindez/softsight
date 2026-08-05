/**
 * Auditoría de animación: lo que ninguna imagen revela porque ocurre en un
 * fotograma que nadie miró.
 *
 * La auditoría espacial que ya existe responde «¿estas piezas se cruzan?» sobre
 * el modelo **quieto**. Un personaje animado tiene el mismo problema multiplicado
 * por la duración: el antebrazo entra en el torso en el fotograma 42, el pie se
 * hunde bajo el suelo en el 18, y en reposo todo estaba perfecto. Revisar eso
 * mirando es exactamente lo que un agente no puede hacer.
 *
 * Dos decisiones que la hacen utilizable:
 *
 * - **Solo se reportan los cruces nuevos.** Si dos piezas ya se solapaban en
 *   reposo, seguirán solapándose en todos los fotogramas y avisar de eso sería
 *   ruido que tapa la señal. Lo que importa es lo que la animación **rompió**.
 * - **Se muestrean fotogramas, no se recorren todos.** El coste es cuadrático
 *   en piezas, y un modelo de 296 piezas por 300 fotogramas no se audita en un
 *   tiempo razonable. Se toman unos pocos repartidos, y el informe dice cuáles.
 *   Es un muestreo y se declara como tal: puede perderse un cruce que solo
 *   ocurra entre dos fotogramas mirados.
 *
 * La evaluación del movimiento no se reimplementa: sale de `computeWorlds` y
 * `applyAnimation`, que son los que están certificados contra Three.js. Una
 * segunda copia de esa aritmética sería deuda desde el primer día.
 */

import { invertAffine, mat4, multiply } from "../math";
import type { Mat4 } from "../math";
import { applyAnimation, buildNodeStates, computeWorlds } from "./animation";
import type { ParsedGlb } from "./animation";
import type { Model } from "./model";
import { auditSpatial } from "./spatialAudit";
import type { PlacedPart } from "./spatialAudit";

export interface AnimationAuditOptions {
  /** Fotogramas a muestrear por clip, repartidos por su duración. 8 por defecto. */
  sampleFrames?: number;
  /** Fotogramas por segundo con los que se numeran los fotogramas. 30 por defecto. */
  fps?: number;
  /**
   * Altura del suelo. Por defecto, la Y mínima del modelo en reposo: se supone
   * que el modelo está apoyado, que es la suposición de la que parte el resto
   * del informe.
   */
  groundY?: number;
  /** Hundimiento bajo el suelo que se tolera antes de avisar. */
  groundTolerance?: number;
}

/** Un cruce que la animación provocó y que en reposo no existía. */
export interface AnimationCrossing {
  clip: string;
  frame: number;
  parts: [string, string];
  /** Fracción del volumen de la pieza menor que queda dentro de la otra. */
  overlap: number;
}

/** Una pieza que se hunde bajo el suelo en algún fotograma. */
export interface GroundBreach {
  clip: string;
  frame: number;
  part: string;
  /** Cuánto queda por debajo del suelo, en unidades del fichero. */
  depth: number;
}

export interface AnimationAudit {
  clips: Array<{
    name: string;
    /** Los fotogramas que de verdad se miraron. */
    sampled: number[];
    lastFrame: number;
  }>;
  crossings: AnimationCrossing[];
  groundBreaches: GroundBreach[];
  /** Huesos con longitud cero: no orientan nada y suelen ser un descuido. */
  zeroLengthBones: string[];
  /** Huesos que ninguna pista anima: el esqueleto los declara y nadie los usa. */
  staticBones: string[];
  groundY: number;
}

/** Caja de una pieza ya colocada, para el mínimo en Y. */
function minY(part: PlacedPart): number {
  const { positions } = part.mesh;
  const m = part.model;
  let lowest = Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const world = m[4] * x + m[5] * y + m[6] * z + m[7];
    if (world < lowest) lowest = world;
  }
  return lowest;
}

/** Clave estable de un par de piezas, para comparar contra el reposo. */
function pairKey(parts: readonly [string, string]): string {
  return parts[0] < parts[1] ? `${parts[0]}|${parts[1]}` : `${parts[1]}|${parts[0]}`;
}

/** Fotogramas repartidos por la duración, incluidos el primero y el último. */
function sampleFrames(lastFrame: number, count: number): number[] {
  if (lastFrame <= 0) return [0];
  const total = Math.max(2, Math.min(count, lastFrame + 1));
  const frames: number[] = [];
  for (let index = 0; index < total; index += 1) {
    frames.push(Math.round((index * lastFrame) / (total - 1)));
  }
  return [...new Set(frames)];
}

/**
 * Audita el movimiento de un modelo ya atado a su esqueleto.
 *
 * `rigged` es el GLB atado ya parseado; `jointOfPart` dice a qué hueso quedó
 * cada pieza, que es lo que devuelve el atado en `bound`.
 */
export function auditAnimation(
  model: Model,
  rigged: ParsedGlb,
  jointOfPart: ReadonlyMap<string, string>,
  options: AnimationAuditOptions = {},
): AnimationAudit {
  const document = rigged.document;
  const nodes = document.nodes ?? [];
  const fps = options.fps ?? 30;
  const perClip = options.sampleFrames ?? 8;
  const tolerance = options.groundTolerance ?? 1e-4;

  const nodeByName = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (node.name !== undefined && !nodeByName.has(node.name)) nodeByName.set(node.name, index);
  });

  // Reposo: sin clip aplicado. Es la referencia contra la que se comparan los
  // cruces, y de donde sale el suelo si nadie lo declara.
  const restWorlds = computeWorlds(document, buildNodeStates(document)).map((matrix) =>
    Float32Array.from(matrix),
  );
  const inverseRest = restWorlds.map((matrix) => {
    const inverse = mat4();
    return invertAffine(matrix, inverse) === 0 ? null : inverse;
  });

  const place = (worlds: readonly Mat4[]): PlacedPart[] =>
    model.parts.map((part) => {
      const jointName = jointOfPart.get(part.name);
      const joint = jointName === undefined ? undefined : nodeByName.get(jointName);
      const rest = joint === undefined ? null : inverseRest[joint];
      if (joint === undefined || rest === null) {
        return { name: part.name, path: part.path, mesh: part.mesh, model: part.matrix };
      }
      const delta = multiply(worlds[joint], rest, mat4());
      return { name: part.name, path: part.path, mesh: part.mesh, model: multiply(delta, part.matrix, mat4()) };
    });

  const restPlaced = place(restWorlds);
  const restCrossings = new Set(auditSpatial(restPlaced).interpenetration.map((entry) => pairKey(entry.parts)));
  const groundY = options.groundY ?? Math.min(...restPlaced.map(minY));

  const crossings: AnimationCrossing[] = [];
  const groundBreaches: GroundBreach[] = [];
  const clips: AnimationAudit["clips"] = [];
  const animatedNodes = new Set<number>();

  (document.animations ?? []).forEach((animation, clipIndex) => {
    for (const channel of animation.channels) {
      if (channel.target.node !== undefined) animatedNodes.add(channel.target.node);
    }

    // La duración sale de los tiempos del propio clip, no de una suposición.
    let duration = 0;
    for (const sampler of animation.samplers) {
      const input = document.accessors?.[sampler.input];
      const max = input?.max?.[0];
      if (typeof max === "number" && max > duration) duration = max;
    }
    const lastFrame = Math.round(duration * fps);
    const frames = sampleFrames(lastFrame, perClip);
    const name = animation.name ?? `clip${clipIndex}`;
    clips.push({ name, sampled: frames, lastFrame });

    for (const frame of frames) {
      const states = buildNodeStates(document);
      applyAnimation(document, rigged.binary, rigged.decodedViews, animation, states, frame / fps);
      const worlds = computeWorlds(document, states).map((matrix) => Float32Array.from(matrix));
      const placed = place(worlds);

      for (const entry of auditSpatial(placed).interpenetration) {
        // Solo lo que la animación rompió: lo que ya se cruzaba en reposo no es
        // culpa del movimiento y taparía la señal.
        if (restCrossings.has(pairKey(entry.parts))) continue;
        crossings.push({ clip: name, frame, parts: entry.parts, overlap: entry.overlap });
      }

      for (const part of placed) {
        const lowest = minY(part);
        if (lowest < groundY - tolerance) {
          groundBreaches.push({ clip: name, frame, part: part.name, depth: groundY - lowest });
        }
      }
    }
  });

  // Un hueso sin longitud no orienta nada: su hijo nace en el mismo punto. Casi
  // siempre es un offset que se quedó a cero por descuido.
  const zeroLengthBones: string[] = [];
  nodes.forEach((node, index) => {
    if (node.mesh !== undefined) return;
    for (const child of node.children ?? []) {
      const offset = nodes[child]?.translation ?? [0, 0, 0];
      if (Math.hypot(offset[0], offset[1], offset[2]) < 1e-6) {
        zeroLengthBones.push(nodes[child]?.name ?? `nodo${child}`);
      }
    }
    void index;
  });

  const usedJoints = new Set([...jointOfPart.values()]);
  const staticBones = nodes
    .filter(
      (node, index) =>
        node.mesh === undefined &&
        node.name !== undefined &&
        usedJoints.has(node.name) &&
        !animatedNodes.has(index),
    )
    .map((node) => node.name!);

  return {
    clips,
    crossings,
    groundBreaches,
    zeroLengthBones: [...new Set(zeroLengthBones)],
    staticBones,
    groundY,
  };
}
