/**
 * Esqueleto y clips declarados en JSON: lo que le faltaba a un agente para
 * construir un personaje entero sin salir del formato que ya sabe escribir.
 *
 * Hasta aquí un agente podía declarar `objects` —primitivas, extrusiones, mallas
 * crudas— y nada más. Para darle huesos a lo que construía tenía que escribir un
 * GLB a mano, con sus accesores y sus muestreadores, que es exactamente el tipo
 * de trabajo que un agente no debería estar haciendo.
 *
 * Aquí no hay ninguna heurística, y esa es la condición para que exista: un
 * esqueleto declarado es un hecho —estos huesos, colgando de estos otros, con
 * estos desplazamientos—, no una interpretación de la malla. La herramienta se
 * limita a comprobar que el hecho es coherente y a traducirlo.
 *
 * Lo que sí comprueba, porque son los fallos que se cometen de verdad:
 * nombres repetidos, un padre que no existe, un ciclo en la jerarquía, una
 * pista que apunta a un hueso inventado, fotogramas desordenados o negativos, y
 * valores con el número de componentes equivocado.
 *
 * La rotación usa **la misma convención que el resto de la escena**: grados y
 * orden Y·X·Z. Si un agente escribe `rotation: [0, 45, 0]` en un objeto y en un
 * hueso, tiene que significar lo mismo; dos convenciones en el mismo fichero es
 * la forma más barata de que nadie confíe en ninguna.
 */

import type { SkinnedGlbAnimation, SkinnedGlbNode, SkinnedGlbSampler } from "./glbWriter";
import type { SkeletonSource } from "./skinBinding";

/** Un hueso. Sin `parent` es raíz; `offset` es relativo al padre, como en BVH. */
export interface JointSpec {
  name: string;
  parent?: string;
  offset?: [number, number, number];
}

export interface SkeletonSpec {
  joints: JointSpec[];
}

/**
 * Un fotograma clave. `value` lleva tres números para traslación y escala, y
 * para rotación **tres grados en orden Y·X·Z** o cuatro si prefieres dar el
 * cuaternión `x, y, z, w` ya calculado.
 */
export interface KeySpec {
  frame: number;
  value: number[];
}

export interface TrackSpec {
  joint: string;
  property: "translation" | "rotation" | "scale";
  /** `linear` por defecto; `step` mantiene el valor hasta el siguiente clave. */
  interpolation?: "linear" | "step";
  keys: KeySpec[];
}

export interface ClipSpec {
  name?: string;
  /** Fotogramas por segundo con los que se leen los `frame`; 30 por defecto. */
  fps?: number;
  tracks: TrackSpec[];
}

export interface ResolvedRig {
  skeleton: SkeletonSource;
  /** Índice de nodo por nombre de hueso, para atar sin volver a buscar. */
  jointIndex: Map<string, number>;
  /** Fotogramas por segundo y último fotograma de cada clip, para el informe. */
  clips: Array<{ name: string; fps: number; lastFrame: number; tracks: number }>;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Cuaternión `xyzw` de un giro alrededor de un eje canónico. */
function axisQuaternion(axis: 0 | 1 | 2, radians: number): [number, number, number, number] {
  const half = radians / 2;
  const quaternion: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  quaternion[axis] = Math.sin(half);
  return quaternion;
}

function multiplyQuaternions(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Grados en orden Y·X·Z a cuaternión `xyzw`, la misma composición que usa
 * `resolveObject` para la rotación de una pieza.
 */
export function eulerToQuaternion(degrees: readonly number[]): [number, number, number, number] {
  const [rx, ry, rz] = degrees;
  const rotation = multiplyQuaternions(
    multiplyQuaternions(
      axisQuaternion(1, ry * DEGREES_TO_RADIANS),
      axisQuaternion(0, rx * DEGREES_TO_RADIANS),
    ),
    axisQuaternion(2, rz * DEGREES_TO_RADIANS),
  );
  const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (length === 0) return [0, 0, 0, 1];
  return [rotation[0] / length, rotation[1] / length, rotation[2] / length, rotation[3] / length];
}

const COMPONENTS: Record<TrackSpec["property"], number> = {
  translation: 3,
  rotation: 4,
  scale: 3,
};

/**
 * Comprueba y traduce un esqueleto declarado, con sus clips, a la forma que
 * entienden el atado y el escritor.
 *
 * Los huesos se referencian **por nombre** en todo el documento —padre, vínculo,
 * pista— y nunca por índice: un agente que reordena la lista no debe romper su
 * propio fichero, y un índice suelto en un JSON escrito a mano es un error que
 * no se ve hasta que el modelo se retuerce.
 */
export function resolveRig(skeleton: SkeletonSpec, clips: readonly ClipSpec[] = []): ResolvedRig {
  const joints = skeleton?.joints;
  if (!Array.isArray(joints) || joints.length === 0) {
    throw new Error("skeleton.joints debe ser una lista no vacía de huesos");
  }

  const jointIndex = new Map<string, number>();
  joints.forEach((joint, index) => {
    if (typeof joint.name !== "string" || joint.name.length === 0) {
      throw new Error(`skeleton.joints[${index}] necesita un nombre`);
    }
    if (jointIndex.has(joint.name)) {
      throw new Error(
        `skeleton: el hueso '${joint.name}' está declarado dos veces; los nombres identifican, así que tienen que ser únicos`,
      );
    }
    jointIndex.set(joint.name, index);
  });

  const nodes: SkinnedGlbNode[] = joints.map((joint) => {
    const offset = joint.offset ?? [0, 0, 0];
    if (!Array.isArray(offset) || offset.length !== 3 || offset.some((value) => !Number.isFinite(value))) {
      throw new Error(`skeleton: el offset de '${joint.name}' debe ser tres números`);
    }
    return {
      name: joint.name,
      translation: [offset[0], offset[1], offset[2]],
      rotation: [0, 0, 0, 1],
      children: [],
    };
  });

  const roots: number[] = [];
  joints.forEach((joint, index) => {
    if (joint.parent === undefined) {
      roots.push(index);
      return;
    }
    const parent = jointIndex.get(joint.parent);
    if (parent === undefined) {
      throw new Error(`skeleton: '${joint.name}' cuelga de '${joint.parent}', que no está declarado`);
    }
    if (parent === index) throw new Error(`skeleton: '${joint.name}' se declara padre de sí mismo`);
    nodes[parent].children!.push(index);
  });
  if (roots.length === 0) {
    throw new Error("skeleton: todos los huesos tienen padre, así que hay un ciclo y ninguna raíz");
  }

  // Un ciclo que no toca a la raíz no se detecta con lo anterior: `a` padre de
  // `b` y `b` padre de `a` deja a los dos fuera de `roots` sin más aviso.
  const reached = new Set<number>();
  const walk = (index: number, path: string[]): void => {
    if (reached.has(index)) {
      throw new Error(`skeleton: '${joints[index].name}' aparece dos veces en la rama ${path.join(" > ")}`);
    }
    reached.add(index);
    for (const child of nodes[index].children!) walk(child, [...path, joints[index].name]);
  };
  for (const root of roots) walk(root, []);
  if (reached.size !== joints.length) {
    const sueltos = joints.filter((_joint, index) => !reached.has(index)).map((joint) => joint.name);
    throw new Error(
      `skeleton: ${sueltos.length} hueso(s) no cuelgan de ninguna raíz: ${sueltos.slice(0, 6).join(", ")}. Hay un ciclo entre ellos.`,
    );
  }

  const animations: SkinnedGlbAnimation[] = [];
  const summaries: ResolvedRig["clips"] = [];

  clips.forEach((clip, clipIndex) => {
    const where = `clips[${clipIndex}]`;
    const fps = clip.fps ?? 30;
    if (!Number.isFinite(fps) || fps <= 0) throw new Error(`${where}: fps debe ser un número positivo`);
    if (!Array.isArray(clip.tracks) || clip.tracks.length === 0) {
      throw new Error(`${where}: 'tracks' debe ser una lista no vacía`);
    }

    const samplers: SkinnedGlbSampler[] = [];
    const channels: SkinnedGlbAnimation["channels"] = [];
    let lastFrame = 0;

    clip.tracks.forEach((track, trackIndex) => {
      const at = `${where}.tracks[${trackIndex}]`;
      const node = jointIndex.get(track.joint);
      if (node === undefined) throw new Error(`${at}: el hueso '${track.joint}' no está declarado`);
      const components = COMPONENTS[track.property];
      if (components === undefined) {
        throw new Error(`${at}: property '${track.property}' no existe; usa translation, rotation o scale`);
      }
      if (!Array.isArray(track.keys) || track.keys.length === 0) {
        throw new Error(`${at}: 'keys' debe ser una lista no vacía`);
      }

      const times = new Float32Array(track.keys.length);
      const values = new Float32Array(track.keys.length * components);
      let previousFrame = -1;

      track.keys.forEach((key, keyIndex) => {
        const here = `${at}.keys[${keyIndex}]`;
        if (!Number.isFinite(key.frame) || key.frame < 0) {
          throw new Error(`${here}: 'frame' debe ser un número no negativo`);
        }
        // Ordenados y sin repetir: un muestreador con los tiempos desordenados
        // no falla al escribirse, interpola hacia atrás y nadie sabe por qué.
        if (key.frame <= previousFrame) {
          throw new Error(
            `${here}: el fotograma ${key.frame} no va después del anterior (${previousFrame}); las claves van en orden`,
          );
        }
        previousFrame = key.frame;
        lastFrame = Math.max(lastFrame, key.frame);
        times[keyIndex] = key.frame / fps;

        if (!Array.isArray(key.value)) throw new Error(`${here}: 'value' debe ser una lista de números`);
        let value = key.value;
        if (track.property === "rotation") {
          if (value.length !== 3 && value.length !== 4) {
            throw new Error(`${here}: una rotación son 3 grados (orden Y·X·Z) o 4 del cuaternión, no ${value.length}`);
          }
          value = value.length === 3 ? eulerToQuaternion(value) : value;
        } else if (value.length !== components) {
          throw new Error(`${here}: ${track.property} pide ${components} números, hay ${value.length}`);
        }
        if (value.some((component) => !Number.isFinite(component))) {
          throw new Error(`${here}: 'value' tiene algún componente que no es un número`);
        }
        values.set(value, keyIndex * components);
      });

      samplers.push({
        times,
        values,
        interpolation: track.interpolation === "step" ? "STEP" : "LINEAR",
      });
      channels.push({ sampler: samplers.length - 1, node, path: track.property });
    });

    const name = clip.name ?? `clip${clipIndex}`;
    animations.push({ name, samplers, channels });
    summaries.push({ name, fps, lastFrame, tracks: clip.tracks.length });
  });

  return {
    skeleton: { nodes, roots, animations },
    jointIndex,
    clips: summaries,
  };
}
