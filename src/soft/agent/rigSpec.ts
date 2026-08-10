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

import { evaluateVariation, type VariationSpec } from "../variation";
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

/**
 * Una función vectorial declarada como tabla, con la misma forma y la misma
 * interpolación que las de la geometría: `at` son pares `(u, valor)` con `u` de 0
 * a 1, y `ease` es `linear`, `smooth` o `power:k`.
 *
 * La diferencia con `VariationSpec` es que aquí el valor es el del `property` —tres
 * números—, y se evalúa **componente a componente** con la misma curva. No hay
 * interpolación nueva: hay tres tablas escalares de las que ya existen.
 */
export interface VectorVariationSpec {
  at: Array<[number, number[]]>;
  ease?: string;
}

export interface TrackSpec {
  joint: string;
  property: "translation" | "rotation" | "scale";
  /** `linear` por defecto; `step` mantiene el valor hasta el siguiente clave. */
  interpolation?: "linear" | "step";
  /** Fotogramas clave escritos a mano. Excluyente con `value`. */
  keys?: KeySpec[];
  /**
   * La pista como función declarada, en vez de como lista de claves. Necesita
   * `frames`, y se hornea a claves al resolver.
   */
  value?: VectorVariationSpec;
  /** Cuánto dura la pista declarada con `value`, en fotogramas. */
  frames?: number;
  /**
   * Claves a emitir al hornear: `bake + 1`, repartidas de 0 a `frames`. Por
   * defecto una por fotograma, salvo en `turns`.
   */
  bake?: number;
  /**
   * Vueltas completas alrededor de `axis` en `frames` fotogramas. Negativo, al
   * revés. Solo en `rotation`, y excluyente con `keys` y `value`.
   */
  turns?: number;
  /** Eje de `turns`; `y` por defecto. */
  axis?: "x" | "y" | "z";
  /**
   * Repeticiones del contenido de la pista, una detrás de otra. Con `turns` no:
   * ahí las vueltas ya se cuentan con el propio número.
   */
  cycle?: number;
  /**
   * Desfase, en fotogramas del ciclo. **Trata la pista como periódica**: lo que
   * sale por el final vuelve a entrar por el principio, que es lo que hace que
   * cuatro patas iguales caminen desacompasadas.
   *
   * Solo con `value`, porque el desfase se aplica al **parámetro** antes de
   * hornear. Sobre claves ya escritas habría que remuestrearlas, y remuestrear una
   * rotación en cuaterniones no es interpolar tres números.
   */
  offsetFrames?: number;
}

/** Tope de claves por pista. Un GLB no se rompe por esto, pero un descuido sí. */
const MAX_BAKED_KEYS = 4096;

/**
 * Paso máximo entre claves de una rotación horneada.
 *
 * No es un ajuste de calidad: un muestreador de rotación de glTF interpola
 * cuaterniones **por el arco más corto**, así que dos claves separadas más de media
 * vuelta giran poco y al revés, y una vuelta completa escrita con dos claves no se
 * mueve nada —los dos cuaterniones son el mismo—. Con 90° el camino corto y el
 * declarado son el mismo.
 */
const MAX_DEGREES_PER_KEY = 90;

function checkCycle(track: TrackSpec, at: string): number {
  const cycles = track.cycle ?? 1;
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new Error(`${at}: 'cycle' es un entero de 1 en adelante, no ${track.cycle}`);
  }
  return cycles;
}

/**
 * Claves escritas a mano, repetidas `cycle` veces.
 *
 * La primera clave de cada repetición cae justo donde la última de la anterior, y
 * dos claves en el mismo fotograma no son un muestreador válido: se emite una sola
 * vez. Si el principio y el final de la pista no valen lo mismo, ahí se ve un
 * salto, y es el que dice el propio documento.
 */
function repeatKeys(keys: readonly KeySpec[], cycles: number, at: string): KeySpec[] {
  if (cycles === 1) return [...keys];
  const span = keys[keys.length - 1]?.frame ?? 0;
  if (!(span > 0)) throw new Error(`${at}: 'cycle' necesita que la pista dure más de un fotograma`);
  const repeated: KeySpec[] = [...keys];
  for (let round = 1; round < cycles; round += 1) {
    for (const key of keys.slice(1)) repeated.push({ frame: key.frame + span * round, value: key.value });
  }
  return repeated;
}

/** `turns` vueltas alrededor de un eje, horneadas a claves de 90° como mucho. */
function bakeTurns(track: TrackSpec, at: string): KeySpec[] {
  if (track.property !== "rotation") {
    throw new Error(`${at}: 'turns' solo tiene sentido en una pista de rotation, no de ${track.property}`);
  }
  const turns = track.turns as number;
  if (!Number.isFinite(turns) || turns === 0) {
    throw new Error(`${at}: 'turns' es un número distinto de cero, no ${track.turns}`);
  }
  const frames = track.frames;
  if (!Number.isFinite(frames) || (frames as number) <= 0) {
    throw new Error(`${at}: una pista con 'turns' necesita 'frames', y son más de cero`);
  }
  const axis = track.axis ?? "y";
  if (axis !== "x" && axis !== "y" && axis !== "z") {
    throw new Error(`${at}: 'axis' es "x", "y" o "z", no ${JSON.stringify(track.axis)}`);
  }

  const total = turns * 360;
  const minimum = Math.ceil(Math.abs(total) / MAX_DEGREES_PER_KEY);
  const steps = track.bake ?? minimum;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`${at}: 'bake' es un entero de 1 en adelante, no ${track.bake}`);
  }
  if (Math.abs(total) / steps > MAX_DEGREES_PER_KEY) {
    throw new Error(
      `${at}: con 'bake' ${steps}, cada clave saltaría ${(Math.abs(total) / steps).toFixed(1)}° y el ` +
        `muestreador de glTF interpola por el arco más corto; hacen falta al menos ${minimum} pasos`,
    );
  }
  if (steps + 1 > MAX_BAKED_KEYS) {
    throw new Error(`${at}: hornear ${steps + 1} claves pasa del tope de ${MAX_BAKED_KEYS}; baja 'turns' o sube 'frames'`);
  }

  const slot = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  return Array.from({ length: steps + 1 }, (_entry, step) => {
    const degrees = [0, 0, 0];
    degrees[slot] = (total * step) / steps;
    return { frame: ((frames as number) * step) / steps, value: degrees };
  });
}

/**
 * La pista declarada como función, horneada a claves.
 *
 * Se hornea porque glTF admite `LINEAR`, `STEP` y `CUBICSPLINE` y nada más:
 * `smooth` y `power:k` no existen ahí. Es la misma decisión que ya toma la
 * geometría —la receta vive en el JSON y la malla se hornea al exportar— y tiene
 * la misma ventaja: lo que sale lo abre cualquiera, sin extensiones inventadas.
 *
 * **El número de claves es declarado, no elegido por la herramienta.** Un número
 * que la herramienta escoge sola es un número que nadie puede reproducir.
 */
function bakeTrack(track: TrackSpec, at: string, components: number): KeySpec[] {
  const table = track.value as VectorVariationSpec;
  if (!Array.isArray(table.at) || table.at.length === 0) {
    throw new Error(`${at}.value: 'at' necesita al menos un par (u, valor)`);
  }
  const frames = track.frames;
  if (!Number.isFinite(frames) || (frames as number) <= 0) {
    throw new Error(`${at}: una pista con 'value' necesita 'frames', y son más de cero`);
  }

  // La rotación declarada como función va en **grados**, no en cuaternión:
  // interpolar cuaterniones componente a componente no es una rotación, es un
  // vector de cuatro números que pasa por dentro de la esfera. Los cuaterniones
  // ya escritos siguen valiendo por `keys`.
  const expected = track.property === "rotation" ? 3 : components;
  const columns: VariationSpec[] = Array.from({ length: expected }, () => ({ at: [], ease: table.ease }));
  table.at.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isFinite(entry[0])) {
      throw new Error(`${at}.value.at[${index}]: cada entrada es (u, valor), con u entre 0 y 1`);
    }
    const value = entry[1];
    if (!Array.isArray(value) || value.length !== expected) {
      throw new Error(
        track.property === "rotation"
          ? `${at}.value.at[${index}]: una rotación declarada como función son 3 grados en orden Y·X·Z, no ${Array.isArray(value) ? value.length : "otra cosa"}; el cuaternión solo cabe en 'keys'`
          : `${at}.value.at[${index}]: ${track.property} pide ${expected} números, hay ${Array.isArray(value) ? value.length : "otra cosa"}`,
      );
    }
    value.forEach((component, axis) => {
      if (!Number.isFinite(component)) {
        throw new Error(`${at}.value.at[${index}]: hay un componente que no es un número`);
      }
      columns[axis].at.push([entry[0], component]);
    });
  });

  const steps = track.bake ?? Math.max(1, Math.round(frames as number));
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`${at}: 'bake' es un entero de 1 en adelante, no ${track.bake}`);
  }
  const cycles = checkCycle(track, at);
  // El desfase se aplica al parámetro, no a las claves ya horneadas: es exacto y
  // no obliga a remuestrear nada.
  const phase = (track.offsetFrames ?? 0) / (frames as number);
  const total = steps * cycles;
  if (total + 1 > MAX_BAKED_KEYS) {
    throw new Error(`${at}: hornear ${total + 1} claves pasa del tope de ${MAX_BAKED_KEYS}; baja 'bake' o 'cycle'`);
  }

  return Array.from({ length: total + 1 }, (_entry, step) => {
    const u = (((step / steps + phase) % 1) + 1) % 1;
    // El último fotograma de un ciclo sin desfase es el final de la curva, no su
    // principio: `u` valdría 0 por el módulo y la pista se quedaría a medias.
    const at01 = step === total && phase === 0 ? 1 : u;
    return {
      frame: ((frames as number) * step) / steps,
      value: columns.map((column) => evaluateVariation(column, at01, `${at}.value`)),
    };
  });
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
      const declared = (["keys", "value", "turns"] as const).filter((kind) => track[kind] !== undefined);
      if (declared.length === 0) {
        throw new Error(`${at}: una pista se escribe con 'keys', 'value' o 'turns', y no trae ninguno`);
      }
      if (declared.length > 1) {
        throw new Error(`${at}: 'keys', 'value' y 'turns' son excluyentes; declara uno (${declared.join(" y ")})`);
      }
      if (track.offsetFrames !== undefined && track.value === undefined) {
        throw new Error(
          `${at}: 'offsetFrames' desfasa el parámetro antes de hornear, así que solo va con 'value'; ` +
            "sobre claves escritas a mano habría que remuestrearlas",
        );
      }
      if (track.cycle !== undefined && track.turns !== undefined) {
        throw new Error(`${at}: 'cycle' con 'turns' sobra; las vueltas ya se cuentan con 'turns'`);
      }
      const keys =
        track.turns !== undefined
          ? bakeTurns(track, at)
          : track.value !== undefined
            ? bakeTrack(track, at, components)
            : repeatKeys(track.keys as KeySpec[], checkCycle(track, at), at);
      if (!Array.isArray(keys) || keys.length === 0) {
        throw new Error(`${at}: 'keys' debe ser una lista no vacía`);
      }

      const times = new Float32Array(keys.length);
      const values = new Float32Array(keys.length * components);
      let previousFrame = -1;

      keys.forEach((key, keyIndex) => {
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
