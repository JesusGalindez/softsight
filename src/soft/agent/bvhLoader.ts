/**
 * Lectura de BVH: la puerta de entrada de todo el movimiento capturado del mundo.
 *
 * BVH es texto plano y no tiene nada dentro que no sea un esqueleto y una tabla
 * de números: sin malla, sin pesos, sin materiales. Por eso no compite con el
 * cargador de GLB —lee otra cosa— y por eso se lee sin ninguna dependencia.
 *
 * Es el formato en el que sale la captura de movimiento y también lo que
 * exportan los generadores de movimiento actuales, así que leerlo es lo que
 * convierte a `serializeSkinnedGlb` en una tubería completa: BVH dentro, GLB con
 * esqueleto y clip fuera, y de ahí al contrato de animación como cualquier otro
 * modelo.
 *
 * Tres detalles del formato que no están escritos en ningún sitio y son la causa
 * habitual de que un esqueleto salga retorcido:
 *
 * - **El orden de rotación lo declara cada articulación**, en el orden en que
 *   lista sus canales. `Zrotation Xrotation Yrotation` no es lo mismo que
 *   `Xrotation Yrotation Zrotation`, y las matrices se componen en ese orden:
 *   `R = R_primero · R_segundo · R_tercero`. Ningún fichero dice cuál usa más
 *   allá del orden de esa línea.
 * - **Los ángulos van en grados.** El formato no lo declara; se da por supuesto.
 * - **Las distancias suelen ir en centímetros.** Tampoco lo declara: un esqueleto
 *   humano sale midiendo 170 unidades. Aquí no se convierte a escondidas —hay una
 *   opción `scale`— porque el proyecto ya tiene quien avise de eso: la auditoría
 *   de escala absoluta salta fuera del rango de 1 cm a 100 m y dice de qué
 *   suposición parte.
 */

import type {
  SkinnedGlbAnimation,
  SkinnedGlbNode,
  SkinnedGlbScene,
} from "./glbWriter";

/** Los seis canales que admite el formato. Cualquier otro es un error, no un aviso. */
export type BvhChannel =
  | "Xposition"
  | "Yposition"
  | "Zposition"
  | "Xrotation"
  | "Yrotation"
  | "Zrotation";

const CHANNELS: readonly string[] = [
  "Xposition",
  "Yposition",
  "Zposition",
  "Xrotation",
  "Yrotation",
  "Zrotation",
];

/**
 * Una articulación del esqueleto. `endSite` es el desplazamiento del extremo
 * terminal cuando la articulación es una hoja: no es una articulación más —no
 * tiene canales— pero sin él un hueso no tiene longitud ni dirección.
 */
export interface BvhJoint {
  name: string;
  parent: number | null;
  offset: [number, number, number];
  channels: BvhChannel[];
  children: number[];
  endSite: [number, number, number] | null;
}

/**
 * Un BVH leído. `motion` trae los valores de todos los canales, frame a frame y
 * en el orden en que los declara la jerarquía: `frameCount × channelCount`.
 */
export interface BvhDocument {
  joints: BvhJoint[];
  roots: number[];
  frameCount: number;
  /** Segundos por frame, tal como los declara `Frame Time`. */
  frameTime: number;
  channelCount: number;
  motion: Float64Array;
}

export interface BvhToSceneOptions {
  /** Nombre del clip resultante. Por defecto, `"BVH"`. */
  clipName?: string;
  /**
   * Factor sobre desplazamientos y traslaciones. Un BVH en centímetros se pasa a
   * metros —la unidad de glTF— con `0.01`. Por defecto **1**: no se convierte
   * nada sin que alguien lo pida.
   */
  scale?: number;
}

/** Error de lectura con la línea señalada, porque un BVH roto se arregla mirándolo. */
function fail(message: string, line: number): never {
  throw new Error(`BVH línea ${line}: ${message}`);
}

interface Token {
  text: string;
  line: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let start = -1;
  for (let index = 0; index <= source.length; index += 1) {
    const character = index < source.length ? source[index] : " ";
    const isSpace = character === " " || character === "\t" || character === "\n" || character === "\r";
    if (isSpace) {
      if (start >= 0) {
        tokens.push({ text: source.slice(start, index), line });
        start = -1;
      }
      if (character === "\n") line += 1;
    } else if (start < 0) {
      start = index;
    }
  }
  return tokens;
}

/**
 * Lee un BVH completo: jerarquía y movimiento.
 *
 * Falla pronto y con la línea puesta. Un BVH al que le faltan valores de
 * movimiento se lee «bien» hasta que la animación se desincroniza a mitad, y
 * entonces ya no hay forma de saber de dónde venía el desfase.
 */
export function parseBvh(source: string): BvhDocument {
  const tokens = tokenize(source);
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const next = (): Token => {
    const token = tokens[cursor];
    if (!token) throw new Error("BVH: el fichero se acaba antes de tiempo");
    cursor += 1;
    return token;
  };
  const expect = (word: string): Token => {
    const token = next();
    if (token.text.toUpperCase() !== word.toUpperCase()) {
      fail(`se esperaba '${word}' y hay '${token.text}'`, token.line);
    }
    return token;
  };
  const number = (what: string): number => {
    const token = next();
    const value = Number(token.text);
    if (!Number.isFinite(value)) fail(`${what}: '${token.text}' no es un número`, token.line);
    return value;
  };

  expect("HIERARCHY");

  const joints: BvhJoint[] = [];
  const roots: number[] = [];
  let channelCount = 0;

  const readJoint = (parent: number | null): number => {
    const keyword = next();
    const kind = keyword.text.toUpperCase();
    if (kind !== "ROOT" && kind !== "JOINT") {
      fail(`se esperaba ROOT o JOINT y hay '${keyword.text}'`, keyword.line);
    }
    if (kind === "ROOT" && parent !== null) {
      fail("ROOT solo puede estar en la raíz de la jerarquía", keyword.line);
    }
    const name = next().text;
    expect("{");

    const index = joints.length;
    const joint: BvhJoint = {
      name,
      parent,
      offset: [0, 0, 0],
      channels: [],
      children: [],
      endSite: null,
    };
    joints.push(joint);

    expect("OFFSET");
    joint.offset = [number("OFFSET"), number("OFFSET"), number("OFFSET")];

    const channelsToken = expect("CHANNELS");
    const declared = number("CHANNELS");
    if (!Number.isInteger(declared) || declared < 0) {
      fail(`CHANNELS declara '${declared}', que no es un número de canales`, channelsToken.line);
    }
    for (let count = 0; count < declared; count += 1) {
      const token = next();
      const canonical = CHANNELS.find((channel) => channel.toLowerCase() === token.text.toLowerCase());
      if (!canonical) {
        fail(`canal '${token.text}' desconocido en '${name}'; los válidos son ${CHANNELS.join(", ")}`, token.line);
      }
      joint.channels.push(canonical as BvhChannel);
    }
    channelCount += joint.channels.length;

    for (;;) {
      const token = peek();
      if (!token) throw new Error(`BVH: la articulación '${name}' se queda sin cerrar`);
      const word = token.text.toUpperCase();
      if (word === "}") {
        next();
        break;
      }
      if (word === "END") {
        next();
        const site = next();
        if (site.text.toUpperCase() !== "SITE") {
          fail(`se esperaba 'End Site' y hay 'End ${site.text}'`, site.line);
        }
        expect("{");
        expect("OFFSET");
        joint.endSite = [number("OFFSET"), number("OFFSET"), number("OFFSET")];
        expect("}");
        continue;
      }
      joint.children.push(readJoint(index));
    }

    return index;
  };

  roots.push(readJoint(null));
  // Algunos exportadores escriben varios ROOT seguidos aunque el formato hable de
  // uno solo. Leerlos cuesta dos líneas; rechazarlos costaría un fichero entero.
  while (peek() && peek()!.text.toUpperCase() === "ROOT") {
    roots.push(readJoint(null));
  }

  expect("MOTION");

  const framesToken = next();
  if (framesToken.text.toUpperCase() !== "FRAMES:") {
    fail(`se esperaba 'Frames:' y hay '${framesToken.text}'`, framesToken.line);
  }
  const frameCount = number("Frames");
  if (!Number.isInteger(frameCount) || frameCount < 0) {
    fail(`Frames declara '${frameCount}', que no es un número de fotogramas`, framesToken.line);
  }

  const frameToken = expect("Frame");
  expect("Time:");
  const frameTime = number("Frame Time");
  if (!(frameTime > 0)) {
    fail(`Frame Time es ${frameTime}; sin duración de fotograma no hay tiempo que evaluar`, frameToken.line);
  }

  const expected = frameCount * channelCount;
  const available = tokens.length - cursor;
  if (available !== expected) {
    const where = tokens[cursor]?.line ?? frameToken.line;
    fail(
      `MOTION trae ${available} valores y ${frameCount} fotogramas × ${channelCount} canales piden ${expected}`,
      where,
    );
  }

  const motion = new Float64Array(expected);
  for (let index = 0; index < expected; index += 1) {
    const token = tokens[cursor + index];
    const value = Number(token.text);
    if (!Number.isFinite(value)) {
      fail(`valor de movimiento '${token.text}' no es un número`, token.line);
    }
    motion[index] = value;
  }

  return { joints, roots, frameCount, frameTime, channelCount, motion };
}

/** Cuaternión `xyzw` de un giro de `radians` alrededor de un eje canónico. */
function axisQuaternion(axis: 0 | 1 | 2, radians: number): [number, number, number, number] {
  const half = radians / 2;
  const sine = Math.sin(half);
  const quaternion: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  quaternion[axis] = sine;
  return quaternion;
}

/** Producto de Hamilton, el que corresponde a multiplicar sus matrices en el mismo orden. */
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

const AXIS_OF: Record<string, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };

/**
 * Convierte los ángulos de una articulación en un cuaternión, respetando el orden
 * en que ella declara sus canales.
 *
 * `R = R_primero · R_segundo · R_tercero`: los canales se componen en el orden en
 * que aparecen en la línea `CHANNELS`, que es lo que hace que dos ficheros con
 * los mismos números y distinto orden describan poses distintas.
 */
function rotationOf(channels: BvhChannel[], values: number[]): [number, number, number, number] {
  let rotation: [number, number, number, number] = [0, 0, 0, 1];
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index];
    if (!channel.endsWith("rotation")) continue;
    const axis = AXIS_OF[channel[0].toUpperCase()];
    rotation = multiplyQuaternions(rotation, axisQuaternion(axis, (values[index] * Math.PI) / 180));
  }
  // Renormalizar: glTF exige el cuaternión unitario, y tres productos seguidos
  // dejan una deriva pequeña que algunos lectores rechazan.
  const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (length === 0) return [0, 0, 0, 1];
  return [rotation[0] / length, rotation[1] / length, rotation[2] / length, rotation[3] / length];
}

/**
 * Pasa un BVH a la escena que entiende `serializeSkinnedGlb`.
 *
 * Cada articulación es un nodo con su desplazamiento; cada `End Site`, un nodo
 * hijo sin canales, porque sin él el último hueso no tiene ni longitud ni
 * dirección. Los canales de rotación salen como un muestreador de cuaterniones y
 * los de posición como uno de traslación, **sumados a su desplazamiento**: en BVH
 * el canal de posición no sustituye al `OFFSET`, se acumula sobre él.
 *
 * El resultado no trae malla: un BVH no la tiene. Quien quiera un GLB visible le
 * añade la suya y la ata a estos joints.
 */
export function bvhToSkinnedScene(bvh: BvhDocument, options: BvhToSceneOptions = {}): SkinnedGlbScene {
  const scale = options.scale ?? 1;
  const nodes: SkinnedGlbNode[] = [];
  // Un nodo por articulación, más uno por cada `End Site`. El índice de la
  // articulación `j` es `nodeOfJoint[j]`, que no coincide con `j` en cuanto
  // aparece el primer extremo terminal.
  const nodeOfJoint: number[] = [];

  for (const joint of bvh.joints) {
    nodeOfJoint.push(nodes.length);
    nodes.push({
      name: joint.name,
      translation: [joint.offset[0] * scale, joint.offset[1] * scale, joint.offset[2] * scale],
      rotation: [0, 0, 0, 1],
      children: [],
    });
  }

  for (let index = 0; index < bvh.joints.length; index += 1) {
    const joint = bvh.joints[index];
    const node = nodes[nodeOfJoint[index]];
    for (const child of joint.children) node.children!.push(nodeOfJoint[child]);
    if (joint.endSite) {
      node.children!.push(nodes.length);
      nodes.push({
        name: `${joint.name}_end`,
        translation: [joint.endSite[0] * scale, joint.endSite[1] * scale, joint.endSite[2] * scale],
      });
    }
  }

  const times = new Float32Array(bvh.frameCount);
  for (let frame = 0; frame < bvh.frameCount; frame += 1) times[frame] = frame * bvh.frameTime;

  const animation: SkinnedGlbAnimation = { name: options.clipName ?? "BVH", samplers: [], channels: [] };

  let channelBase = 0;
  for (let index = 0; index < bvh.joints.length; index += 1) {
    const joint = bvh.joints[index];
    const node = nodeOfJoint[index];
    const count = joint.channels.length;
    const rotates = joint.channels.some((channel) => channel.endsWith("rotation"));
    const translates = joint.channels.some((channel) => channel.endsWith("position"));

    if (bvh.frameCount > 0 && (rotates || translates)) {
      const rotations = rotates ? new Float32Array(bvh.frameCount * 4) : null;
      const translations = translates ? new Float32Array(bvh.frameCount * 3) : null;
      const values: number[] = new Array(count);

      for (let frame = 0; frame < bvh.frameCount; frame += 1) {
        const base = frame * bvh.channelCount + channelBase;
        for (let channel = 0; channel < count; channel += 1) values[channel] = bvh.motion[base + channel];

        if (rotations) {
          const quaternion = rotationOf(joint.channels, values);
          rotations.set(quaternion, frame * 4);
        }
        if (translations) {
          const local: [number, number, number] = [...joint.offset];
          for (let channel = 0; channel < count; channel += 1) {
            const name = joint.channels[channel];
            if (name === "Xposition") local[0] += values[channel];
            else if (name === "Yposition") local[1] += values[channel];
            else if (name === "Zposition") local[2] += values[channel];
          }
          translations.set([local[0] * scale, local[1] * scale, local[2] * scale], frame * 3);
        }
      }

      if (translations) {
        animation.samplers.push({ times, values: translations, interpolation: "LINEAR" });
        animation.channels.push({ sampler: animation.samplers.length - 1, node, path: "translation" });
      }
      if (rotations) {
        animation.samplers.push({ times, values: rotations, interpolation: "LINEAR" });
        animation.channels.push({ sampler: animation.samplers.length - 1, node, path: "rotation" });
      }
    }

    channelBase += count;
  }

  return {
    nodes,
    meshes: [],
    roots: bvh.roots.map((root) => nodeOfJoint[root]),
    ...(animation.channels.length > 0 ? { animations: [animation] } : {}),
  };
}
