/**
 * El guion como dato: escenas con un rol narrativo, no una maqueta con huecos.
 *
 * Un agente que escribe una pieza tiene dos formas de equivocarse, y solo una se
 * puede medir. Puede contar algo aburrido —eso no lo certifica ningún hash— o
 * puede entregar un guion que no cuadra: una escena sin nombre, un rol que no
 * existe, un dato que el rol necesitaba y no está. Esto último es aritmética, y
 * aquí se convierte en un error de validación en vez de en un hueco vacío en el
 * render.
 *
 * Lo que **no** hay aquí es criterio. Ni ritmo, ni legibilidad, ni estructura:
 * esas son medidas sobre un guion ya coherente y viven en la auditoría. La
 * frontera es la misma de siempre: esto comprueba que el hecho está bien
 * escrito, no si el hecho es bueno.
 *
 * La duración de la composición **se deriva** de la suma de las escenas. Un
 * total declarado a mano sería un segundo sitio donde equivocarse, y el primer
 * agente que sumara mal dejaría una pieza que nadie sabría si dura lo que dice.
 */

import { assertValid, STORY_SCHEMA, type SceneRole } from "./schema";

/**
 * Campos de `data` que exige cada rol.
 *
 * `line` en todos: una escena que no dice nada no es una escena. `headline`
 * además en las dos que anclan un momento —la que abre y la que gira—, porque
 * son las que el espectador usa para situarse.
 *
 * Esta tabla crece **cuando una pieza real lo pide**, y añadir una exigencia
 * invalida guiones que antes pasaban: eso es subir `storyVersion`, no un retoque.
 */
export const ROLE_REQUIRED_DATA: Record<SceneRole, readonly string[]> = {
  apertura: ["headline", "line"],
  desarrollo: ["line"],
  giro: ["headline", "line"],
  cierre: ["line"],
};

export interface StoryScene {
  name: string;
  role: SceneRole;
  durationFrames: number;
  /** Lo que cuenta la escena. El rol decide cómo se ve; esto es solo el dato. */
  data: Record<string, string>;
}

export interface StorySpec {
  storyVersion: number;
  title: string;
  fps: number;
  scenes: StoryScene[];
}

export interface ResolvedScene {
  index: number;
  name: string;
  role: SceneRole;
  /** Primer frame de la escena, deducido de las anteriores. */
  startFrame: number;
  durationFrames: number;
  data: Record<string, string>;
}

export interface ResolvedStory {
  title: string;
  fps: number;
  /** Suma de las escenas: la duración de la composición, derivada. */
  durationFrames: number;
  scenes: ResolvedScene[];
}

/**
 * Versión del contrato del guion. Cambiar qué se acepta —un rol nuevo, un campo
 * obligatorio más— obliga a subirla, igual que en el informe.
 */
export const STORY_VERSION = 1;

/**
 * Comprueba el guion y devuelve dónde cae cada escena.
 *
 * Los errores de forma salen todos juntos por el esquema; los de coherencia van
 * de uno en uno porque cada uno cambia lo que significa el siguiente.
 */
export function resolveStory(story: StorySpec): ResolvedStory {
  assertValid(story, STORY_SCHEMA, "el guion");

  if (story.storyVersion !== STORY_VERSION) {
    throw new Error(
      `storyVersion ${story.storyVersion} no es la de este contrato (${STORY_VERSION})`,
    );
  }
  if (story.title.trim() === "") throw new Error("el guion necesita un título");
  if (!Number.isInteger(story.fps) || story.fps <= 0) {
    throw new Error("fps debe ser un entero positivo");
  }
  if (story.scenes.length === 0) throw new Error("un guion necesita al menos una escena");

  const names = new Set<string>();
  const scenes: ResolvedScene[] = [];
  let startFrame = 0;

  story.scenes.forEach((scene, index) => {
    const where = `scenes[${index}]`;
    if (typeof scene.name !== "string" || scene.name.trim() === "") {
      throw new Error(`${where} necesita un nombre`);
    }
    if (names.has(scene.name)) {
      throw new Error(`${where}: '${scene.name}' ya es el nombre de otra escena`);
    }
    names.add(scene.name);

    // El rol no se comprueba aquí: el esquema solo admite los de `SCENE_ROLES`,
    // así que un rol inventado ya se rechazó arriba, con el nombre y la lista.
    if (!Number.isInteger(scene.durationFrames) || scene.durationFrames <= 0) {
      throw new Error(`${where}: durationFrames debe ser un entero positivo`);
    }

    for (const field of ROLE_REQUIRED_DATA[scene.role]) {
      const value = scene.data[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${where}: el rol '${scene.role}' necesita data.${field}`);
      }
    }
    for (const [field, value] of Object.entries(scene.data)) {
      if (typeof value !== "string") {
        throw new Error(`${where}: data.${field} debe ser texto`);
      }
    }

    scenes.push({
      index,
      name: scene.name,
      role: scene.role,
      startFrame,
      durationFrames: scene.durationFrames,
      data: scene.data,
    });
    startFrame += scene.durationFrames;
  });

  return { title: story.title, fps: story.fps, durationFrames: startFrame, scenes };
}
