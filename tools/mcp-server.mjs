#!/usr/bin/env node
/**
 * Servidor MCP: las banderas dejan de ser prosa y pasan a ser tipos.
 *
 * Softsight está diseñado para agentes y hasta aquí se exponía por una CLI con
 * treinta banderas y un puente JSON. Un agente que se encuentra el repositorio
 * tiene que leerse 10 KB de `--help`, decidir qué banderas combina, construir
 * una línea de órdenes y parsear el informe. Cada uno de esos pasos es una
 * oportunidad de equivocarse y **ninguno de esos errores lo caza el esquema**,
 * porque el esquema valida la entrada, no la invocación.
 *
 * Con MCP, cada comando es una herramienta con su esquema de parámetros, que el
 * cliente descubre y que el runtime valida **antes** de llamar.
 *
 * Cuatro reglas, y son las que impiden que esto sea un tercer contrato:
 *
 * 1. **El servidor no decide nada.** Traduce la llamada a una petición del
 *    puente —la misma que valida `handleRequest`— y devuelve lo que el puente
 *    devuelve. Igual que el puente respecto al CLI.
 * 2. **Un comando del puente, una herramienta**, o una exclusión escrita con su
 *    motivo en `EXCLUDED_COMMANDS`. `test:mcp` recorre `COMMANDS` del puente y lo
 *    comprueba: un comando nuevo sin herramienta pone la puerta roja.
 * 3. **El catálogo es ligero a propósito** (2026-11-17). Hasta entonces
 *    `tools/list` incrustaba `SCENE_SCHEMA` y `PATCH_SCHEMA` enteros: 41 KB que el
 *    cliente carga en el contexto **al abrir cada sesión**, se usen o no. Ahora la
 *    escena, el parche, el guion y la puesta en escena se declaran `object` con
 *    una descripción que remite a `softsight_schema` y su parte —o al recurso
 *    `softsight://schema/<parte>`—. No se pierde validación: **el esquema es el
 *    validador** y `validate` sigue corriendo detrás, con su sugerencia. Lo que se
 *    pierde es la prevalidación del cliente, que nunca rechazó claves
 *    desconocidas como sí hace `validate`.
 * 4. **`test:mcp` lo comprueba**, herramienta por herramienta contra el CLI
 *    directo, igual que `test:bridge`.
 *
 * Va sobre el modo residente: llama a `handleRequest` con el ejecutor en proceso,
 * así que no lanza un proceso por herramienta.
 *
 * Dos traducciones, y solo dos:
 *
 * - **Entrada**: leer del disco los ficheros que el puente quiere en base64. Un
 *   agente que llama por MCP tiene rutas, no base64. El sandbox del puente sigue
 *   entero detrás.
 * - **Salida**: con `SOFTSIGHT_OUTPUT_ROOT` declarado, los artefactos —pliego,
 *   GLB, parche inverso— se escriben ahí y vuelven como rutas, no como 220 KB de
 *   base64 en cada llamada. Es lo que cierra el bucle de A1 por MCP: el pliego de
 *   un turno es el `baseline` del siguiente. La raíz la pone la configuración y
 *   **nunca la llamada**, la misma regla que `SOFTSIGHT_PACKAGE_ROOTS` para la
 *   lectura: si la eligiera la petición, cualquiera escribiría donde quisiera. El
 *   nombre lleva el sha256 del contenido delante, así que dos llamadas iguales
 *   escriben el mismo fichero y ninguna pisa a otra distinta.
 *
 * Errores: los de **ejecución** —datos mal escritos, una opción desconocida, un
 * fichero que no existe— vuelven dentro del resultado con `isError: true`, que
 * es lo que el modelo lee para corregirse. Solo lo que es de protocolo —método o
 * herramienta desconocidos, JSON roto— sale como error de JSON-RPC.
 *
 * Transporte: JSON-RPC 2.0 por stdio, sin dependencias, que es la regla de la
 * casa.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkBuild } from "./buildFingerprint.mjs";
import { BridgeError, COMMANDS, PASSTHROUGH, errorResponse, handleRequest } from "./bridge.mjs";
import { trimDirectory } from "./lru.mjs";
import { createSessionStore } from "./session.mjs";
import { SCHEMA_PART_NAMES, runAgent } from "./agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const EXAMPLES_DIR = join(projectRoot, "artifacts/agent");

/**
 * Las revisiones del protocolo que este servidor habla, de la más nueva a la más
 * vieja. Lo que cada una añade y aquí se usa:
 *
 * ```text
 * 2025-06-18   structuredContent, resource_link
 * 2025-03-26   annotations de herramienta
 * 2024-11-05   la de partida
 * ```
 *
 * El cliente pide una; si está en la lista se contesta con ella y si no, con la
 * más nueva, que es lo que manda la especificación.
 */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Las fechas de revisión se ordenan como texto. */
function atLeast(protocol, revision) {
  return protocol >= revision;
}

/** Dónde se escriben los artefactos, o `null` para devolverlos en línea. */
const OUTPUT_ROOT = process.env.SOFTSIGHT_OUTPUT_ROOT ? resolve(process.env.SOFTSIGHT_OUTPUT_ROOT) : null;
/** Su techo, con el mismo criterio de expulsión que las tres cachés (`lru.mjs`):
 * sin él, cada render de un bucle largo deja un pliego más en el disco. */
const OUTPUT_MAX_BYTES = Number(process.env.SOFTSIGHT_OUTPUT_MAX_MB ?? 256) * 1024 * 1024;

/** Un fichero del disco con la forma que quiere el puente. */
function filePayload(path) {
  const full = resolve(path);
  return { name: basename(full), data: readFileSync(full).toString("base64") };
}

/** Un documento JSON en línea con la forma que quiere el puente. */
function documentPayload(name, document) {
  return { name, data: Buffer.from(`${JSON.stringify(document)}\n`, "utf8").toString("base64") };
}

/**
 * Las opciones del puente, en JSON Schema, generadas de su propia tabla. Se
 * pueden pedir solo algunas: una herramienta de guion no admite `--tile`.
 */
function optionProperties(names) {
  const properties = {};
  for (const name of names) {
    const kind = PASSTHROUGH[name];
    if (kind === undefined) throw new Error(`opción del puente desconocida: ${name}`);
    properties[name] = { type: kind };
  }
  return properties;
}

const COMMON_RENDER_OPTIONS = [
  "tile",
  "ground",
  "select",
  "selectWhere",
  "isolate",
  "materialColors",
  "auditLimit",
  "expectSize",
  "maxTriangles",
  "maxParts",
  "maxBoundaryEdges",
  "maxDegenerate",
  "maxSymmetryError",
  "requireWatertight",
  "noCache",
  "summary",
  "fields",
];

const MODEL_PROPERTY = {
  type: "string",
  description: "Ruta del modelo GLB u OBJ en el disco.",
};

const PACKAGE_ROOT_PROPERTY = {
  type: "string",
  description: "Directorio del paquete, con su manifest.json. Bajo una raíz de SOFTSIGHT_PACKAGE_ROOTS.",
};

/** Un documento que valida el servidor: el catálogo no lleva su forma, la nombra. */
function documentProperty(part, what) {
  return {
    type: "object",
    // Corta a propósito: va en cinco sitios del catálogo. Lo que dice es dónde
    // está la forma, no la forma.
    description: `${what} Forma: softsight_schema part=${part}. La valida el servidor.`,
  };
}

/** Solo con `SOFTSIGHT_OUTPUT_ROOT`: la imagen, además de la ruta. */
const IMAGE_PROPERTY = {
  type: "boolean",
  description: "true: el pliego también como imagen. Solo cuenta con SOFTSIGHT_OUTPUT_ROOT; sin él va siempre.",
};

/** El identificador de una sesión, tal como lo devolvió `softsight_open`. */
const SESSION_PROPERTY = { type: "string", description: "El identificador que devolvió softsight_open." };

/** Las opciones que solo recortan la respuesta: valen en cada turno. */
const PROJECTION_OPTIONS = ["summary", "fields"];

/** La entrada de una sesión o de un barrido: un modelo del disco o una escena. */
function inputFiles(model, scene) {
  const files = {};
  if (model !== undefined) files.model = filePayload(model);
  if (scene !== undefined) files.scene = documentPayload("escena.json", scene);
  return files;
}

/** Parches del agente con la forma que quiere el puente. */
function patchPayloads(patches) {
  return patches.map((patch, index) => documentPayload(`parche-${index}.json`, patch));
}

/**
 * Los comandos del puente que no tienen herramienta, cada uno con su motivo. Lo
 * lee `test:mcp`: un comando que no esté ni aquí ni en `TOOLS` pone la puerta
 * roja. Hoy no hay ninguno.
 */
export const EXCLUDED_COMMANDS = {};

/**
 * Las herramientas. Cada una dice qué comando del puente envuelve, qué
 * parámetros admite, cómo se traducen a `files` y `options`, y si escribe algo
 * —que es lo que declaran sus `annotations`—; nada más, porque nada más le
 * corresponde.
 */
export const TOOLS = {
  softsight_inspect: {
    command: "inspect",
    readOnly: true,
    description:
      "Revisa un modelo sin renderizar: piezas, familias, auditoría topológica y avisos. " +
      "Devuelve el resumen; pon summary:false para el informe completo.",
    inputSchema: {
      type: "object",
      properties: { model: MODEL_PROPERTY, ...optionProperties(COMMON_RENDER_OPTIONS) },
      required: ["model"],
      additionalProperties: false,
    },
    build({ model, ...options }) {
      return {
        command: "inspect",
        files: { model: filePayload(model) },
        // El resumen por defecto: el informe completo del dron son 16,5 KB y el
        // 45 % no cambia entre turnos. Quien lo quiera entero lo pide.
        options: { summary: true, ...options },
      };
    },
  },

  softsight_render: {
    command: "render",
    readOnly: false,
    description: "Renderiza el pliego de contactos de un modelo y devuelve el informe y el PNG.",
    inputSchema: {
      type: "object",
      properties: { model: MODEL_PROPERTY, image: IMAGE_PROPERTY, ...optionProperties(COMMON_RENDER_OPTIONS) },
      required: ["model"],
      additionalProperties: false,
    },
    build({ model, ...options }) {
      return { command: "render", files: { model: filePayload(model) }, options };
    },
  },

  softsight_patch: {
    command: "patch",
    readOnly: false,
    description:
      "Aplica parches a un modelo, lo renderiza y devuelve el informe con el diff y el parche que lo deshace.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        patches: {
          type: "array",
          minItems: 1,
          items: documentProperty("patch", "Un parche."),
          description: "Parches a aplicar, en orden.",
        },
        baseline: {
          type: "string",
          description: "Pliego anterior en PNG, para medir el diff: la ruta que devolvió el render anterior.",
        },
        baselineReport: { type: "string", description: "Informe anterior, para warningsDelta." },
        image: IMAGE_PROPERTY,
        ...optionProperties(COMMON_RENDER_OPTIONS),
      },
      required: ["model", "patches"],
      additionalProperties: false,
    },
    build({ model, patches, baseline, baselineReport, ...options }) {
      const files = {
        model: filePayload(model),
        patches: patches.map((patch, index) => documentPayload(`patch-${index}.json`, patch)),
      };
      if (baseline !== undefined) files.baseline = filePayload(baseline);
      if (baselineReport !== undefined) files.baselineReport = filePayload(baselineReport);
      return { command: "patch", files, options };
    },
  },

  softsight_sample: {
    command: "sample",
    readOnly: true,
    description:
      "Evalúa referencias de superficie sobre un GLB animado en los fotogramas pedidos: posiciones y " +
      "normales, sin renderizar.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        references: {
          type: "string",
          description: "Ruta del JSON con las referencias. Su forma: softsight_schema con part «sample».",
        },
        ...optionProperties(["frames", "fps", "noCache", "summary", "fields"]),
      },
      required: ["model", "references", "frames"],
      additionalProperties: false,
    },
    build({ model, references, ...options }) {
      return {
        command: "sample",
        files: { model: filePayload(model), references: filePayload(references) },
        options,
      };
    },
  },

  softsight_diff: {
    command: "diff",
    readOnly: true,
    description:
      "Compara dos versiones de un modelo: cuánto se desvía cada una de la otra, en fracción de la " +
      "diagonal. Contesta «¿este pase mejoró o derivó?» sin renderizar.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        other: { type: "string", description: "Ruta de la otra versión, GLB u OBJ." },
        ...optionProperties(["diffSamples", "diffSeed", "diffMax", "summary", "fields"]),
      },
      required: ["model", "other"],
      additionalProperties: false,
    },
    build({ model, other, ...options }) {
      return { command: "diff", files: { model: filePayload(model), other: filePayload(other) }, options };
    },
  },

  softsight_scene: {
    command: "scene",
    readOnly: false,
    description:
      "Revisa una escena declarativa: geometría, esqueleto, clips. Devuelve el informe, el pliego y el GLB.",
    inputSchema: {
      type: "object",
      properties: {
        scene: documentProperty("scene", "Escena declarativa."),
        patches: {
          type: "array",
          minItems: 1,
          items: documentProperty("patch", "Un parche."),
          description: "Parches a aplicar sobre la escena, en orden, antes de revisarla.",
        },
        image: IMAGE_PROPERTY,
        ...optionProperties([...COMMON_RENDER_OPTIONS, "auditFrames"]),
      },
      required: ["scene"],
      additionalProperties: false,
    },
    build({ scene, patches, ...options }) {
      const files = { scene: documentPayload("escena.json", scene) };
      if (patches !== undefined) {
        files.patches = patches.map((patch, index) => documentPayload(`patch-${index}.json`, patch));
      }
      return { command: "scene", files, options };
    },
  },

  softsight_story: {
    command: "story",
    readOnly: true,
    description:
      "Audita un guion: roles, duraciones y si el texto se puede leer en el tiempo que tiene. No escribe nada.",
    inputSchema: {
      type: "object",
      properties: {
        story: documentProperty("story", "Guion."),
        ...optionProperties(["readingRate", "summary", "fields"]),
      },
      required: ["story"],
      additionalProperties: false,
    },
    build({ story, ...options }) {
      return { command: "story", files: { story: documentPayload("guion.json", story) }, options };
    },
  },

  softsight_staging: {
    command: "staging",
    readOnly: true,
    description:
      "Juzga la puesta en escena de un frame ya montado: si enseña algo, si el texto cabe y si se lee. " +
      "Entran las medidas, no los píxeles.",
    inputSchema: {
      type: "object",
      properties: {
        staging: documentProperty("staging", "Medidas de un frame montado."),
        ...optionProperties(["contrastRatio", "summary", "fields"]),
      },
      required: ["staging"],
      additionalProperties: false,
    },
    build({ staging, ...options }) {
      return { command: "staging", files: { staging: documentPayload("staging.json", staging) }, options };
    },
  },

  softsight_bvh: {
    command: "bvh",
    readOnly: false,
    description: "Convierte una captura BVH en un GLB con esqueleto y clip. No revisa nada.",
    inputSchema: {
      type: "object",
      properties: {
        bvh: { type: "string", description: "Ruta de la captura .bvh." },
        ...optionProperties(["bvhScale", "bvhClip"]),
      },
      required: ["bvh"],
      additionalProperties: false,
    },
    build({ bvh, ...options }) {
      return { command: "bvh", files: { bvh: filePayload(bvh) }, options };
    },
  },

  // ---------------------------------------------------------------------------
  // Las sesiones (fase 3): el banco lleva la cuenta de pliegos, informes y
  // parches entre turnos. Un turno es el CLI con la lista entera de parches y el
  // turno anterior como referencia —`session.mjs`—, así que lo que devuelve es lo
  // que devolvería esa orden. Viven en este proceso: si se reinicia, se pierden,
  // y el `stateHash` de la última respuesta dice si se rehízo la misma.
  softsight_open: {
    command: "sessionOpen",
    readOnly: false,
    idempotent: false,
    description:
      "Abre una sesión sobre un modelo o una escena y revisa el turno 0. Las opciones de revisión se fijan " +
      "aquí; después, softsight_apply compara cada turno con el anterior sin pasar ficheros.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        scene: documentProperty("scene", "Escena declarativa, en vez de model."),
        inspectOnly: { type: "boolean", description: "Sin pliego en ningún turno: más barato, y sin diff." },
        image: IMAGE_PROPERTY,
        ...optionProperties([...COMMON_RENDER_OPTIONS, "auditFrames"]),
      },
      additionalProperties: false,
    },
    build({ model, scene, ...options }) {
      return { command: "sessionOpen", files: inputFiles(model, scene), options: { summary: true, ...options } };
    },
  },

  softsight_apply: {
    command: "sessionApply",
    readOnly: false,
    idempotent: false,
    description:
      "Aplica parches a una sesión y la revisa: el informe trae el diff y el warningsDelta contra el turno " +
      "anterior. Un parche con error de esquema no entra.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION_PROPERTY,
        patches: {
          type: "array",
          minItems: 1,
          items: documentProperty("patch", "Un parche."),
          description: "Parches a aplicar, en orden.",
        },
        image: IMAGE_PROPERTY,
        ...optionProperties(PROJECTION_OPTIONS),
      },
      required: ["session", "patches"],
      additionalProperties: false,
    },
    build({ session, patches, ...options }) {
      return {
        command: "sessionApply",
        session,
        files: { patches: patchPayloads(patches) },
        options: { summary: true, ...options },
      };
    },
  },

  softsight_undo: {
    command: "sessionUndo",
    readOnly: false,
    idempotent: false,
    description: "Deshace la última llamada a softsight_apply de la sesión y revisa el estado al que vuelve.",
    inputSchema: {
      type: "object",
      properties: { session: SESSION_PROPERTY, image: IMAGE_PROPERTY, ...optionProperties(PROJECTION_OPTIONS) },
      required: ["session"],
      additionalProperties: false,
    },
    build({ session, ...options }) {
      return { command: "sessionUndo", session, options: { summary: true, ...options } };
    },
  },

  softsight_export: {
    command: "sessionExport",
    readOnly: false,
    description:
      "El modelo de la sesión tal como está, en GLB u OBJ, y la lista de parches que lo reproduce por el CLI.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION_PROPERTY,
        format: { type: "string", enum: ["glb", "obj"], description: "glb por defecto." },
        ...optionProperties(PROJECTION_OPTIONS),
      },
      required: ["session"],
      additionalProperties: false,
    },
    build({ session, ...options }) {
      return { command: "sessionExport", session, options: { summary: true, ...options } };
    },
  },

  softsight_sweep: {
    command: "sweep",
    readOnly: true,
    description:
      "Revisa K variantes —listas de parches sobre un modelo o una escena— en una llamada y las cruza por los " +
      "criterios declarados: dominancia y frontera, sin nota. Cada fila es la de su llamada suelta.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        scene: documentProperty("scene", "Escena declarativa, en vez de model."),
        variants: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              patches: { type: "array", minItems: 1, items: documentProperty("patch", "Un parche.") },
            },
            required: ["patches"],
            additionalProperties: false,
          },
          description: "Las variantes: cada una, una lista de parches sobre la base.",
        },
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "Ruta con puntos en el informe; una lista cuenta por su longitud." },
              direction: { type: "string", enum: ["MENOR_MEJOR", "MAYOR_MEJOR"] },
            },
            required: ["field", "direction"],
            additionalProperties: false,
          },
        },
        inspectOnly: { type: "boolean", description: "true por defecto: sin pliegos." },
        ...optionProperties([...COMMON_RENDER_OPTIONS, "auditFrames"]),
      },
      required: ["variants"],
      additionalProperties: false,
    },
    build({ model, scene, variants, criteria, ...options }) {
      return {
        command: "sweep",
        files: inputFiles(model, scene),
        variants: variants.map((variant) => ({
          ...(variant.name === undefined ? {} : { name: variant.name }),
          patches: patchPayloads(variant.patches),
        })),
        ...(criteria === undefined ? {} : { criteria }),
        options,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Los cuatro de paquete (§68). Reciben **rutas**, no base64, y por eso no pasan
  // por `filePayload`: un paquete de reconstrucción no cabe en un argumento.
  // Quién puede leer qué lo decide `SOFTSIGHT_PACKAGE_ROOTS` en el entorno de
  // este proceso, no la llamada.
  //
  // El §68 llamaba al tercero `softsight_geometry_compare`. Se queda en
  // `softsight_reconstruction_compare` por D31: no compara dos geometrías —eso es
  // `softsight_diff`—, compara **candidatos de reconstrucción**, criterio a
  // criterio y sin dar una nota.
  softsight_reconstruction_inspect: {
    command: "reconstructionInspect",
    readOnly: true,
    description:
      "Consume un paquete de reconstrucción por ruta y devuelve el informe entero: evidencia, escala, " +
      "cobertura, confianza y veredicto. El paquete tiene que caer bajo una raíz declarada.",
    inputSchema: {
      type: "object",
      properties: { root: PACKAGE_ROOT_PROPERTY },
      required: ["root"],
      additionalProperties: false,
    },
    build({ root }) {
      return { bridgeContractVersion: 2, command: "reconstructionInspect", package: { root } };
    },
  },

  softsight_reconstruction_coverage: {
    command: "reconstructionCoverage",
    readOnly: true,
    description:
      "El mismo informe recortado a la cobertura y la confianza. No vuelve a medir: es una proyección, " +
      "así que sus números son exactamente los de inspect.",
    inputSchema: {
      type: "object",
      properties: { root: PACKAGE_ROOT_PROPERTY },
      required: ["root"],
      additionalProperties: false,
    },
    build({ root }) {
      return { bridgeContractVersion: 2, command: "reconstructionCoverage", package: { root } };
    },
  },

  softsight_reconstruction_compare: {
    command: "reconstructionCompare",
    readOnly: true,
    description:
      "Compara dos o más candidatos criterio a criterio. No da una nota: dice qué es comparable, qué " +
      "domina a qué y qué lo impide.",
    inputSchema: {
      type: "object",
      properties: {
        roots: {
          type: "array",
          minItems: 2,
          items: { type: "string" },
          description: "Raíces de los paquetes a comparar, dos o más.",
        },
      },
      required: ["roots"],
      additionalProperties: false,
    },
    build({ roots }) {
      return {
        bridgeContractVersion: 2,
        command: "reconstructionCompare",
        packages: roots.map((root) => ({ root })),
      };
    },
  },

  softsight_production_validate: {
    command: "productionValidate",
    readOnly: true,
    description:
      "Revisa un asset de producción por ruta: LOD, UV, texturas, colisión y el veredicto " +
      "PRODUCTION_READY. El informe de un validador externo se ingiere, no se ejecuta.",
    inputSchema: {
      type: "object",
      properties: {
        root: PACKAGE_ROOT_PROPERTY,
        externalValidation: {
          type: "string",
          description:
            "Ruta del informe de un validador externo (Khronos). Sin él no hay PRODUCTION_READY: " +
            "decir «válido» sin que nadie haya validado es el sobreanuncio que D31 impide.",
        },
      },
      required: ["root"],
      additionalProperties: false,
    },
    build({ root, externalValidation }) {
      return {
        bridgeContractVersion: 2,
        command: "productionValidate",
        package: { root },
        ...(externalValidation === undefined ? {} : { externalValidation }),
      };
    },
  },

  softsight_schema: {
    command: "schema",
    readOnly: true,
    description:
      "La forma que valida la entrada. Sin parte devuelve todo (64 KB); con parte, solo esa. Es lo que " +
      "hay que leer antes de escribir una escena, un parche, un guion o una puesta en escena.",
    inputSchema: {
      type: "object",
      properties: {
        part: {
          type: "string",
          // De la tabla del CLI, no escrita aquí: una parte nueva entra sola.
          enum: SCHEMA_PART_NAMES,
          description: "Parte del esquema. Omítela para el esquema entero.",
        },
      },
      additionalProperties: false,
    },
    build({ part }) {
      return { command: "schema", options: part === undefined ? {} : { part } };
    },
  },
};

/** Una herramienta tal como la anuncia `tools/list` en la revisión pactada. */
function announce(name, tool, protocol) {
  const entry = { name, description: tool.description, inputSchema: tool.inputSchema };
  if (atLeast(protocol, "2025-03-26")) {
    entry.annotations = {
      // Las de solo lectura no tocan nada; las otras escriben sus artefactos, solo
      // en la raíz declarada, o cambian una sesión de este proceso. Ninguna
      // destruye nada.
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      // Todas menos las que cambian una sesión: aplicar dos veces el mismo parche
      // no deja el mismo estado que aplicarlo una.
      idempotentHint: tool.idempotent ?? true,
      openWorldHint: false,
    };
  }
  return entry;
}

/** El resultado de una herramienta que no pudo ejecutarse, para que el modelo lo lea. */
function toolError(error) {
  const body = errorResponse(error);
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
}

/** Escribe un artefacto bajo la raíz declarada y devuelve su ruta. */
function writeArtifact(artifact) {
  const bytes = Buffer.from(artifact.data, "base64");
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const path = join(OUTPUT_ROOT, `${digest}-${artifact.name}`);
  writeFileSync(path, bytes);
  trimDirectory(OUTPUT_ROOT, OUTPUT_MAX_BYTES);
  return path;
}

/** La huella con la que arrancó este proceso: el paquete ya está cargado en
 * memoria, así que recompilar no lo cambia. Lo que se compara en cada llamada es
 * si `src/` sigue siendo lo que se cargó. */
const STARTUP_BUILD = checkBuild();

/** Las sesiones de este proceso: viven mientras el servidor viva. */
const SESSIONS = createSessionStore();

/**
 * Ejecuta una herramienta. Lo que sale es la respuesta del puente tal cual, con
 * los artefactos como rutas o como contenido MCP en vez de base64 dentro del
 * texto.
 */
async function callTool(name, args, protocol) {
  const tool = TOOLS[name];
  // Herramienta desconocida es de protocolo: el cliente pidió algo que no se
  // anunció, y no hay nada que el modelo pueda corregir en sus argumentos.
  if (tool === undefined) throw new BridgeError("invalid-request", `herramienta desconocida: ${name}`);

  const current = checkBuild();
  if (!STARTUP_BUILD.fresh || current.current !== STARTUP_BUILD.current) {
    return toolError(
      new BridgeError(
        "stale-build",
        `${STARTUP_BUILD.fresh ? "src/ cambió desde que arrancó este servidor" : STARTUP_BUILD.message}: ` +
          "recompila con `npm run build:agent3d` y reinicia el servidor MCP.",
      ),
    );
  }

  const { image, ...rest } = args ?? {};
  let response;
  try {
    response = await handleRequest(
      // La 1 sigue siendo el defecto: los de modelo no cambiaron. Los cuatro de
      // paquete traen la suya en `build`, porque hablan otro protocolo.
      { bridgeContractVersion: 1, ...tool.build(rest) },
      runAgent,
      SESSIONS,
    );
  } catch (error) {
    // Datos mal escritos, opción desconocida, fichero que no existe: es un
    // resultado que el modelo tiene que ver para corregirse, no un fallo de
    // transporte. La salida 1 —avisos— ni siquiera llega aquí: es un informe.
    return toolError(error);
  }

  const content = [{ type: "text", text: JSON.stringify(response.report, null, 2) }];
  // La sesión, aparte del informe: el informe es el del CLI y no lleva nada que
  // el CLI no ponga.
  if (response.session !== undefined) {
    content.push({ type: "text", text: JSON.stringify({ session: response.session }, null, 2) });
  }
  const written = [];
  for (const artifact of response.artifacts ?? []) {
    const isImage = artifact.mimeType.startsWith("image/");
    if (OUTPUT_ROOT !== null) {
      const path = writeArtifact(artifact);
      written.push({ name: artifact.name, mimeType: artifact.mimeType, path });
      if (atLeast(protocol, "2025-06-18")) {
        content.push({ type: "resource_link", uri: pathToFileURL(path).href, name: artifact.name, mimeType: artifact.mimeType });
      }
      if (isImage && image === true) content.push({ type: "image", data: artifact.data, mimeType: artifact.mimeType });
      continue;
    }
    content.push(
      isImage
        ? { type: "image", data: artifact.data, mimeType: artifact.mimeType }
        : {
            type: "resource",
            resource: { uri: `softsight://${artifact.name}`, mimeType: artifact.mimeType, blob: artifact.data },
          },
    );
  }
  // Las rutas, también en texto: un cliente de antes de `resource_link` las lee
  // igual, y es lo que un agente copia al `baseline` del turno siguiente.
  if (written.length > 0) content.splice(1, 0, { type: "text", text: JSON.stringify({ artifacts: written }, null, 2) });

  const result = { content };
  if (atLeast(protocol, "2025-06-18")) {
    // El mismo contenido, como objeto. `exitCode` va aquí y no se inventa: es el
    // del CLI —1 si hay alguna certeza—, que por texto el agente no veía.
    result.structuredContent = {
      exitCode: response.exitCode,
      report: response.report,
      artifacts: written,
      ...(response.session === undefined ? {} : { session: response.session }),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Recursos: lo que un agente consulta y no ejecuta. Las partes del esquema —el
// mismo texto que `softsight_schema`, pedido al puente, no copiado— y los
// ejemplares de `artifacts/agent/`, que antes solo se encontraban listando el
// directorio.

const SCHEMA_URI = "softsight://schema";
const EXAMPLE_URI = "softsight://ejemplo/";

function exampleNames() {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function listResources() {
  const resources = [
    { uri: SCHEMA_URI, name: "esquema", mimeType: "application/json", description: "El esquema entero." },
    ...SCHEMA_PART_NAMES.map((part) => ({
      uri: `${SCHEMA_URI}/${part}`,
      name: `esquema-${part}`,
      mimeType: "application/json",
      description: `La parte «${part}» del esquema: lo mismo que softsight_schema con part «${part}».`,
    })),
    ...exampleNames().map((name) => ({
      uri: `${EXAMPLE_URI}${name}`,
      name: `ejemplo-${name.replace(/\.json$/, "")}`,
      mimeType: "application/json",
      description: `Ejemplar versionado en artifacts/agent/${name}.`,
    })),
  ];
  return { resources };
}

/** Error de recurso no encontrado, con el código que fija la especificación. */
class ResourceNotFound extends Error {}

async function readResource({ uri }) {
  if (uri === SCHEMA_URI || (typeof uri === "string" && uri.startsWith(`${SCHEMA_URI}/`))) {
    const part = uri === SCHEMA_URI ? undefined : uri.slice(SCHEMA_URI.length + 1);
    if (part !== undefined && !SCHEMA_PART_NAMES.includes(part)) throw new ResourceNotFound(`recurso desconocido: ${uri}`);
    const response = await handleRequest(
      { bridgeContractVersion: 1, command: "schema", options: part === undefined ? {} : { part } },
      runAgent,
    );
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.report, null, 2) }] };
  }
  if (typeof uri === "string" && uri.startsWith(EXAMPLE_URI)) {
    // Solo los nombres que lista el directorio: ni `..` ni rutas, por construcción.
    const name = uri.slice(EXAMPLE_URI.length);
    if (!exampleNames().includes(name)) throw new ResourceNotFound(`recurso desconocido: ${uri}`);
    return { contents: [{ uri, mimeType: "application/json", text: readFileSync(join(EXAMPLES_DIR, name), "utf8") }] };
  }
  throw new ResourceNotFound(`recurso desconocido: ${String(uri)}`);
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Una conexión: la revisión del protocolo se pacta en `initialize` y vale para
 * lo que sigue. */
function createSession() {
  let protocol = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];
  return {
    initialize: (params) => {
      const requested = params?.protocolVersion;
      protocol = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return {
        protocolVersion: protocol,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "softsight", version: packageVersion() },
      };
    },
    "tools/list": () => ({ tools: Object.entries(TOOLS).map(([name, tool]) => announce(name, tool, protocol)) }),
    "tools/call": ({ name, arguments: args }) => callTool(name, args, protocol),
    "resources/list": () => listResources(),
    "resources/read": (params) => readResource(params),
    ping: () => ({}),
  };
}

/** Bucle JSON-RPC 2.0 por stdio: una petición por línea, una respuesta por línea. */
export async function serveMcp() {
  if (!STARTUP_BUILD.fresh) process.stderr.write(`aviso: ${STARTUP_BUILD.message}\n`);
  // Salir por señal también borra los directorios de las sesiones (`session.mjs`).
  process.once("SIGTERM", () => process.exit(143));
  process.once("SIGINT", () => process.exit(130));
  const handlers = createSession();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const reply = (body) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      reply({ id: null, error: { code: -32700, message: "JSON inválido" } });
      continue;
    }
    // Las notificaciones no llevan `id` y no se contestan; es lo que dice el
    // protocolo y contestarlas rompe a los clientes estrictos.
    if (message.id === undefined) continue;

    const handler = handlers[message.method];
    if (handler === undefined) {
      reply({ id: message.id, error: { code: -32601, message: `método desconocido: ${message.method}` } });
      continue;
    }
    try {
      reply({ id: message.id, result: await handler(message.params ?? {}) });
    } catch (error) {
      if (error instanceof ResourceNotFound) {
        reply({ id: message.id, error: { code: -32002, message: error.message } });
        continue;
      }
      const { code, message: text } = errorResponse(error);
      reply({ id: message.id, error: { code: -32602, message: text, data: { code } } });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serveMcp();
}
