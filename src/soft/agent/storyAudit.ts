/**
 * Hechos medidos sobre un guion ya coherente.
 *
 * `resolveStory` dice si el guion está bien escrito; esto dice si **funciona**, y
 * solo con lo que se puede calcular: cuántos caracteres caben en el tiempo que
 * la escena dura, si falta un rol que la pieza necesita, si dos escenas seguidas
 * hacen el mismo papel. Nada de gusto: una pieza puede pasar esto entera y ser
 * aburrida, y eso lo dicen los ejemplares, no un número.
 *
 * **Aquí no hay heurísticas y es una decisión, no una carencia.** Ritmo monótono
 * o apertura larga son candidatos —se declaran como tales cuando entren, con el
 * precedente de la auditoría espacial—. Mezclarlos con las medidas convertiría
 * cada aviso en algo discutible, y un agente que aprende a discutir la puerta
 * aprende a mentirle.
 *
 * Lo que **no** se puede medir todavía: escena sin ninguna capa visible, texto
 * que se sale de su caja y contraste sobre el fondo. Las tres necesitan la
 * puesta en escena —capas, cajas medidas, colores—, que vive en el editor. Van
 * en una puerta posterior, no en esta, y fingirlas aquí sería inventarse datos
 * que no existen.
 */

import { resolveStory, type StorySpec } from "./storySpec";
import { SCENE_ROLES, type SceneRole } from "./schema";

/**
 * Caracteres por segundo que se suponen legibles en pantalla.
 *
 * Es **una suposición declarada, no una ley**, y por eso viaja en el informe y
 * se puede sustituir: quince caracteres por segundo es lectura cómoda de texto
 * corto sobre imagen. El aviso dice de qué ritmo parte, igual que el aviso de
 * escala dice de qué unidad parte.
 */
export const DEFAULT_READING_RATE = 15;

/**
 * Roles sin los que una pieza no está terminada.
 *
 * Solo `cierre`: una historia que no cierra se nota siempre. Que abra lo hace ya
 * la primera escena, sea cual sea su rol, así que exigir `apertura` sería
 * exigir una etiqueta, no una propiedad. La lista crece cuando una pieza real
 * demuestre que falta algo.
 */
export const REQUIRED_ROLES: readonly SceneRole[] = ["cierre"];

export const STORY_AUDIT_CONTRACT_VERSION = 1;

export interface StoryWarning {
  code: string;
  /** Escena a la que se refiere, o `null` si el aviso es de la pieza entera. */
  scene: string | null;
  message: string;
}

export interface SceneReading {
  name: string;
  role: SceneRole;
  startFrame: number;
  durationFrames: number;
  /** Caracteres de todos los campos de `data`, que es lo que puede acabar en pantalla. */
  characters: number;
  secondsAvailable: number;
  secondsNeeded: number;
  /** Frames que pediría esta escena al ritmo supuesto, redondeando hacia arriba. */
  framesNeeded: number;
}

export interface StoryAudit {
  contractVersion: number;
  title: string;
  fps: number;
  durationFrames: number;
  /** El ritmo con el que se midió; va en el informe porque es la suposición. */
  readingRate: number;
  scenes: SceneReading[];
  warnings: StoryWarning[];
}

export interface StoryAuditOptions {
  /** Caracteres por segundo; `DEFAULT_READING_RATE` si no se dice. */
  readingRate?: number;
}

/**
 * Cuenta lo que la escena pone en pantalla.
 *
 * Todos los campos de `data` cuentan, no solo los que el rol exige: si un campo
 * está en `data` es porque la escena lo cuenta, y un rol puede sacarlo. Un dato
 * que no se ve no es un dato de la escena y no debería estar ahí.
 */
function countCharacters(data: Record<string, string>): number {
  return Object.values(data).reduce((total, value) => total + value.trim().length, 0);
}

/** Avisos ordenados como se leen: primero los de la pieza, luego escena a escena. */
export function auditStory(story: StorySpec, options: StoryAuditOptions = {}): StoryAudit {
  const resolved = resolveStory(story);
  const readingRate = options.readingRate ?? DEFAULT_READING_RATE;
  if (!Number.isFinite(readingRate) || readingRate <= 0) {
    throw new Error("readingRate debe ser un número positivo de caracteres por segundo");
  }

  const warnings: StoryWarning[] = [];
  const roles = resolved.scenes.map((scene) => scene.role);

  for (const role of REQUIRED_ROLES) {
    if (roles.includes(role)) continue;
    warnings.push({
      code: "ROL_AUSENTE",
      scene: null,
      message:
        `la pieza no tiene ninguna escena con rol '${role}'; los roles usados son ` +
        `${[...new Set(roles)].join(", ")} de ${SCENE_ROLES.join(", ")}.`,
    });
  }

  for (let index = 1; index < resolved.scenes.length; index += 1) {
    const previous = resolved.scenes[index - 1];
    const current = resolved.scenes[index];
    if (previous.role !== current.role) continue;
    warnings.push({
      code: "ROLES_CONSECUTIVOS",
      scene: current.name,
      message:
        `'${current.name}' repite el rol '${current.role}' de '${previous.name}'; ` +
        "dos escenas seguidas haciendo el mismo papel se leen como una sola larga.",
    });
  }

  const scenes: SceneReading[] = resolved.scenes.map((scene) => {
    const characters = countCharacters(scene.data);
    const secondsAvailable = scene.durationFrames / resolved.fps;
    const secondsNeeded = characters / readingRate;
    return {
      name: scene.name,
      role: scene.role,
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      characters,
      secondsAvailable,
      secondsNeeded,
      framesNeeded: Math.ceil(secondsNeeded * resolved.fps),
    };
  });

  for (const scene of scenes) {
    if (scene.secondsNeeded <= scene.secondsAvailable) continue;
    warnings.push({
      code: "TEXTO_ILEGIBLE",
      scene: scene.name,
      message:
        `'${scene.name}' pone ${scene.characters} caracteres en ${scene.durationFrames} frames ` +
        `(${scene.secondsAvailable.toFixed(2)} s) y a ${readingRate} caracteres por segundo hacen ` +
        `falta ${scene.secondsNeeded.toFixed(2)} s: dale ${scene.framesNeeded} frames o corta texto. ` +
        "El ritmo de lectura es una suposición, no una medida; cámbialo con readingRate si tu " +
        "puesta en escena lee más rápido.",
    });
  }

  return {
    contractVersion: STORY_AUDIT_CONTRACT_VERSION,
    title: resolved.title,
    fps: resolved.fps,
    durationFrames: resolved.durationFrames,
    readingRate,
    scenes,
    warnings,
  };
}
