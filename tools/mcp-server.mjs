#!/usr/bin/env node
/**
 * Servidor MCP: las banderas dejan de ser prosa y pasan a ser tipos.
 *
 * Softsight está diseñado para agentes y hasta aquí se exponía por una CLI con
 * treinta banderas y un puente JSON. Un agente que se encuentra el repositorio
 * tiene que leerse 7,4 KB de `--help`, decidir qué banderas combina, construir
 * una línea de órdenes y parsear el informe. Cada uno de esos pasos es una
 * oportunidad de equivocarse y **ninguno de esos errores lo caza el esquema**,
 * porque el esquema valida la entrada, no la invocación.
 *
 * Con MCP, cada comando es una herramienta con su esquema de parámetros, que el
 * cliente descubre y que el runtime valida **antes** de llamar.
 *
 * Tres reglas, y son las que impiden que esto sea un tercer contrato:
 *
 * 1. **El servidor no decide nada.** Traduce la llamada a una petición del
 *    puente —la misma que valida `handleRequest`— y devuelve lo que el puente
 *    devuelve. Igual que el puente respecto al CLI.
 * 2. **Los esquemas de parámetros se generan** de `SCENE_SCHEMA`, `PATCH_SCHEMA`,
 *    `STORY_SCHEMA` y compañía con `toJsonSchema`, y las opciones de `PASSTHROUGH`
 *    del propio puente. Ni una tabla a mano: una escrita a mano divergiría en la
 *    primera bandera nueva.
 * 3. **`test:mcp` lo comprueba**, herramienta por herramienta contra el CLI
 *    directo, igual que `test:bridge`.
 *
 * Va sobre el modo residente: llama a `handleRequest` con el ejecutor en proceso,
 * así que no lanza un proceso por herramienta.
 *
 * La **única** traducción que hace el servidor es leer del disco los ficheros que
 * el puente quiere en base64. Un agente que llama por MCP tiene rutas, no
 * base64; obligarle a codificar 2 MB de GLB en el argumento sería inutilizable.
 * El sandbox del puente sigue entero detrás.
 *
 * Transporte: JSON-RPC 2.0 por stdio, sin dependencias, que es la regla de la
 * casa.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { PATCH_SCHEMA, SCENE_SCHEMA, STORY_SCHEMA, toJsonSchema } from "../dist-node/agent3d.mjs";
import { BridgeError, PASSTHROUGH, errorResponse, handleRequest } from "./bridge.mjs";
import { runAgent } from "./agent3d.mjs";

const PROTOCOL_VERSION = "2024-11-05";

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

/**
 * Las siete herramientas. Cada una dice qué comando del puente envuelve, qué
 * parámetros admite y cómo se traducen a `files` y `options`; nada más, porque
 * nada más le corresponde.
 */
const TOOLS = {
  softsight_inspect: {
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
    description: "Renderiza el pliego de contactos de un modelo y devuelve el informe y el PNG.",
    inputSchema: {
      type: "object",
      properties: { model: MODEL_PROPERTY, ...optionProperties(COMMON_RENDER_OPTIONS) },
      required: ["model"],
      additionalProperties: false,
    },
    build({ model, ...options }) {
      return { command: "render", files: { model: filePayload(model) }, options };
    },
  },

  softsight_patch: {
    description:
      "Aplica parches a un modelo, lo renderiza y devuelve el informe con el diff y el parche que lo deshace.",
    inputSchema: {
      type: "object",
      properties: {
        model: MODEL_PROPERTY,
        patches: {
          type: "array",
          minItems: 1,
          items: toJsonSchema(PATCH_SCHEMA),
          description: "Parches a aplicar, en orden.",
        },
        baseline: { type: "string", description: "Pliego anterior en PNG, para medir el diff." },
        baselineReport: { type: "string", description: "Informe anterior, para warningsDelta." },
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

  softsight_scene: {
    description:
      "Revisa una escena declarativa: geometría, esqueleto, clips. Devuelve el informe, el pliego y el GLB.",
    inputSchema: {
      type: "object",
      properties: {
        scene: toJsonSchema(SCENE_SCHEMA),
        ...optionProperties([...COMMON_RENDER_OPTIONS, "auditFrames"]),
      },
      required: ["scene"],
      additionalProperties: false,
    },
    build({ scene, ...options }) {
      return { command: "scene", files: { scene: documentPayload("escena.json", scene) }, options };
    },
  },

  softsight_story: {
    description:
      "Audita un guion: roles, duraciones y si el texto se puede leer en el tiempo que tiene. No escribe nada.",
    inputSchema: {
      type: "object",
      properties: { story: toJsonSchema(STORY_SCHEMA), ...optionProperties(["readingRate", "summary", "fields"]) },
      required: ["story"],
      additionalProperties: false,
    },
    build({ story, ...options }) {
      return { command: "story", files: { story: documentPayload("guion.json", story) }, options };
    },
  },

  softsight_bvh: {
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

  softsight_schema: {
    description:
      "La forma que valida la entrada. Sin parte devuelve todo (46 KB); con parte, solo esa.",
    inputSchema: {
      type: "object",
      properties: {
        part: {
          type: "string",
          enum: ["scene", "patch", "story", "staging", "sample", "report", "codes"],
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

/**
 * Ejecuta una herramienta. Lo que sale es la respuesta del puente tal cual, con
 * los artefactos binarios como recursos MCP en vez de base64 dentro del texto.
 */
async function callTool(name, args) {
  const tool = TOOLS[name];
  if (tool === undefined) throw new BridgeError("invalid-request", `herramienta desconocida: ${name}`);
  const partial = tool.build(args ?? {});
  const response = await handleRequest(
    { bridgeContractVersion: 1, ...partial },
    runAgent,
  );

  const content = [{ type: "text", text: JSON.stringify(response.report, null, 2) }];
  for (const artifact of response.artifacts ?? []) {
    content.push(
      artifact.mimeType.startsWith("image/")
        ? { type: "image", data: artifact.data, mimeType: artifact.mimeType }
        : {
            type: "resource",
            resource: { uri: `softsight://${artifact.name}`, mimeType: artifact.mimeType, blob: artifact.data },
          },
    );
  }
  // `isError` marca los avisos, no los fallos: el CLI sale 1 con avisos y eso es
  // un resultado, no un error. Solo el 2 —error de datos— llega aquí como fallo,
  // y llega por excepción.
  return { content };
}

const HANDLERS = {
  initialize: () => ({
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: "softsight", version: packageVersion() },
  }),
  "tools/list": () => ({
    tools: Object.entries(TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }),
  "tools/call": ({ name, arguments: args }) => callTool(name, args),
  ping: () => ({}),
};

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Bucle JSON-RPC 2.0 por stdio: una petición por línea, una respuesta por línea. */
export async function serveMcp() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } })}\n`,
      );
      continue;
    }
    // Las notificaciones no llevan `id` y no se contestan; es lo que dice el
    // protocolo y contestarlas rompe a los clientes estrictos.
    if (message.id === undefined) continue;

    const handler = HANDLERS[message.method];
    if (handler === undefined) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `método desconocido: ${message.method}` },
        })}\n`,
      );
      continue;
    }
    try {
      const result = await handler(message.params ?? {});
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    } catch (error) {
      const { code, message: text } = errorResponse(error);
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: text, data: { code } } })}\n`,
      );
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serveMcp();
}
