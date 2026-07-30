/**
 * API para agentes: escena declarativa dentro, píxeles y diagnóstico fuera.
 *
 * Aquí no hay entrada/salida a propósito. Todo lo que decide algo —resolver la
 * escena, encuadrar, rasterizar, auditar la topología, redactar los avisos— es
 * una función pura y tipada; leer ficheros, codificar el PNG y escribir en la
 * consola vive en `tools/agent3d.mjs`. Así la parte con criterio se puede
 * comprobar con el compilador y ejecutar igual en el navegador que en Node, y la
 * parte que toca el sistema operativo no arrastra dependencias de tipos.
 *
 * El informe está redactado para que un agente pueda actuar sin interpretar
 * métricas: cada aviso dice qué está mal y qué implica, no solo el número.
 */

import {
  renderContactSheet,
  computeSceneAabb,
  computeSceneBounds,
  measureObjectCoverage,
  type ContactSheet,
} from "./contactSheet";
import { parseGlb, type MeshoptDecoderLike } from "./glbLoader";
import { auditMesh, type MeshAudit } from "./inspect";
import {
  dedupeNames,
  selectParts,
  summarizeFamilies,
  toSceneNodes,
  type Model,
  type PartFamily,
} from "./model";
import { parseObj } from "./objLoader";
import { createGroundPlane, resolveScene, type SceneSpec } from "./sceneSpec";
import type { SceneNode } from "../renderer";

export {
  renderContactSheet,
  computeSceneBounds,
  measureObjectCoverage,
  frameCamera,
  DEFAULT_VIEWS,
} from "./contactSheet";
export { auditMesh } from "./inspect";
export { parseGlb } from "./glbLoader";
export type { MeshoptDecoderLike } from "./glbLoader";
export { parseObj, serializeObj } from "./objLoader";
export {
  applyPatch,
  dedupeNames,
  matchesPattern,
  selectParts,
  summarizeFamilies,
  toSceneNodes,
} from "./model";
export type { Model, ModelPart, PartFamily, Patch, Edit, EditResult } from "./model";
export { resolveScene, createGroundPlane } from "./sceneSpec";
export type { SceneSpec, ObjectSpec, PrimitiveSpec, RawMeshSpec } from "./sceneSpec";
export type { MeshAudit } from "./inspect";
export type { ContactSheet, ViewDefinition } from "./contactSheet";

export interface ObjectReport extends MeshAudit {
  name: string;
}

export interface SceneReview {
  objects: ObjectReport[];
  scene: {
    objects: number;
    triangles: number;
    vertices: number;
    boundsCenter: [number, number, number];
    boundsRadius: number;
    /** Fracción del encuadre que ocupa el objeto, medida sin el suelo. */
    objectCoverage: number;
    budgetTriangles: number | null;
    budgetExceeded: boolean;
  };
  sheet: {
    width: number;
    height: number;
    tileSize: number;
    columns: number;
    rows: number;
    /** Nombre de cada vista en orden de lectura, fila por fila. */
    grid: string[];
    totalMilliseconds: number;
  };
  views: Array<{
    name: string;
    column: number;
    row: number;
    milliseconds: number;
    shadedLoad: number;
    backfaceRatio: number;
    trianglesRasterized: number;
    pixelsShaded: number;
  }>;
  warnings: string[];
}

export interface ReviewOptions {
  tileSize?: number;
  /** Suelo de referencia: entra en el render, no en la auditoría ni el encuadre. */
  ground?: boolean;
}

function buildWarnings(
  objects: readonly ObjectReport[],
  sheet: ContactSheet,
  objectCoverage: number,
  budgetExceeded: boolean,
): string[] {
  const warnings: string[] = [];

  for (const object of objects) {
    if (object.triangles === 0) {
      warnings.push(`${object.name}: la malla no tiene triángulos.`);
      continue;
    }
    if (object.degenerateTriangles > 0) {
      warnings.push(
        `${object.name}: ${object.degenerateTriangles} triángulos de área nula; no pintan nada y cuestan preparación.`,
      );
    }
    if (object.nonManifoldEdges > 0) {
      warnings.push(
        `${object.name}: ${object.nonManifoldEdges} aristas compartidas por 3+ caras (no manifold); busca caras duplicadas o superpuestas.`,
      );
    }
    if (object.boundaryEdges > 0) {
      warnings.push(
        `${object.name}: ${object.boundaryEdges} aristas de borde, la malla no está cerrada; si debía ser un sólido, falta soldar o tapar.`,
      );
    }
    if (object.flippedNormalRatio > 0.02) {
      warnings.push(
        `${object.name}: ${(object.flippedNormalRatio * 100).toFixed(0)} % de caras con normal contraria a sus vértices; el bobinado está invertido ahí.`,
      );
    }
    // `duplicatePositions` queda como métrica, no como aviso: cualquier malla con
    // aristas duras o UVs partidas los tiene por definición —un cubo con normales
    // por cara tiene 24 vértices y 8 posiciones—, así que avisar siempre solo
    // enseña al agente a ignorar los avisos.
    const offsetMagnitude = Math.hypot(
      object.centerOffset[0],
      object.centerOffset[1],
      object.centerOffset[2],
    );
    if (object.boundingRadius > 0 && offsetMagnitude > object.boundingRadius * 0.5) {
      warnings.push(
        `${object.name}: el centro de la caja está a ${offsetMagnitude.toFixed(2)} del origen del objeto; el pivote quedará descentrado al rotar.`,
      );
    }
    if (object.symmetryErrorX !== null && object.symmetryErrorX > 0.02) {
      warnings.push(
        `${object.name}: error de simetría en X del ${(object.symmetryErrorX * 100).toFixed(1)} % del radio; si debía ser simétrico, no lo es.`,
      );
    }
  }

  if (objectCoverage < 0.005) {
    warnings.push(
      `el objeto ocupa el ${(objectCoverage * 100).toFixed(2)} % del encuadre; queda fuera de cuadro o es diminuto frente a su propia caja envolvente.`,
    );
  } else if (objectCoverage > 0.9) {
    warnings.push(
      `el objeto ocupa el ${(objectCoverage * 100).toFixed(0)} % del encuadre; puede estar recortado.`,
    );
  }

  for (const view of sheet.views) {
    if (view.wireframe) continue; // sin caras rasterizadas, las métricas no aplican
    if (view.backfaceRatio > 0.75) {
      warnings.push(
        `vista "${view.name}": ${(view.backfaceRatio * 100).toFixed(0)} % de triángulos descartados por reverso; en un sólido cerrado lo normal es ~50 %, así que el bobinado está del revés.`,
      );
    }
  }

  if (budgetExceeded) warnings.push("presupuesto de triángulos superado.");
  return warnings;
}

/** Resuelve, renderiza y audita. Devuelve el pliego en píxeles y el informe. */
export function reviewScene(
  spec: SceneSpec,
  options: ReviewOptions = {},
): { sheet: ContactSheet; review: SceneReview } {
  const tileSize = options.tileSize ?? 320;
  const withGround = options.ground ?? true;

  const resolved = resolveScene(spec);
  const objectNodes: SceneNode[] = resolved.map((entry) => entry.node);
  const bounds = computeSceneBounds(objectNodes);

  const nodes = withGround
    ? [createGroundPlane(Math.max(4, bounds.radius * 6)), ...objectNodes]
    : objectNodes;

  const objects: ObjectReport[] = resolved.map((entry) => ({
    name: entry.name,
    ...auditMesh(entry.node.mesh),
  }));

  // Encuadre sobre el objeto, no sobre la escena dibujada: el suelo es contexto.
  const sheet = renderContactSheet(nodes, tileSize, undefined, undefined, objectNodes);
  const objectCoverage = Number(measureObjectCoverage(objectNodes).toFixed(4));

  const triangles = objects.reduce((total, object) => total + object.triangles, 0);
  const vertices = objects.reduce((total, object) => total + object.vertices, 0);
  const budgetTriangles = spec.budget?.triangles ?? null;
  const budgetExceeded = budgetTriangles !== null && triangles > budgetTriangles;

  const review: SceneReview = {
    objects,
    scene: {
      objects: objects.length,
      triangles,
      vertices,
      boundsCenter: bounds.center,
      boundsRadius: Number(bounds.radius.toFixed(4)),
      objectCoverage,
      budgetTriangles,
      budgetExceeded,
    },
    sheet: {
      width: sheet.width,
      height: sheet.height,
      tileSize: sheet.tileSize,
      columns: sheet.columns,
      rows: sheet.rows,
      grid: sheet.views.map((view) => view.name),
      totalMilliseconds: Number(
        sheet.views.reduce((total, view) => total + view.milliseconds, 0).toFixed(2),
      ),
    },
    views: sheet.views.map((view) => ({
      name: view.name,
      column: view.column,
      row: view.row,
      milliseconds: view.milliseconds,
      shadedLoad: view.shadedLoad,
      backfaceRatio: view.backfaceRatio,
      trianglesRasterized: view.stats.trianglesRasterized,
      pixelsShaded: view.stats.pixelsShaded,
    })),
    warnings: buildWarnings(objects, sheet, objectCoverage, budgetExceeded),
  };

  return { sheet, review };
}

/**
 * Revisión de un modelo cargado de fichero (GLB u OBJ).
 *
 * Se separa de `reviewScene` porque el problema es distinto: una escena escrita por
 * el agente tiene tres objetos y se puede detallar entera, mientras que un modelo
 * real trae cientos de piezas y el informe tiene que **resumir por familias** o el
 * agente se queda sin contexto antes de razonar. El detalle por pieza se reserva
 * para lo seleccionado, que es donde el agente está trabajando.
 */
export interface ModelReview {
  source: string;
  parts: number;
  triangles: number;
  vertices: number;
  boundsCenter: [number, number, number];
  boundsRadius: number;
  /** Tamaño en unidades del fichero: delata modelos en centímetros o pulgadas. */
  size: [number, number, number];
  families: PartFamily[];
  selection: {
    patterns: string[];
    matched: string[];
    audits: ObjectReport[];
  };
  sheet: SceneReview["sheet"];
  views: SceneReview["views"];
  loaderNotes: string[];
  warnings: string[];
}

export interface ModelReviewOptions extends ReviewOptions {
  select?: string[];
  isolate?: boolean;
  /** Cuántas piezas seleccionadas auditar en detalle. */
  auditLimit?: number;
  /** Colorear con el material del fichero en vez de arcilla neutra. */
  useMaterialColors?: boolean;
}

export function reviewModel(model: Model, options: ModelReviewOptions = {}): {
  sheet: ContactSheet;
  review: ModelReview;
} {
  const tileSize = options.tileSize ?? 320;
  const patterns = options.select ?? [];
  const selected = selectParts(model, patterns);
  const highlight = new Set(selected);

  const modelNodes = toSceneNodes(model, {
    highlight,
    isolate: options.isolate ?? false,
    useMaterialColors: options.useMaterialColors ?? false,
  });
  // Suelo bajo el modelo, dimensionado y colocado según su caja envolvente. No es
  // decoración: la sombra de contacto es lo que hace responder «esta pieza toca el
  // suelo o flota», que en un render sin suelo es literalmente indistinguible.
  const nodes =
    (options.ground ?? true) && modelNodes.length > 0
      ? [createGroundUnder(modelNodes), ...modelNodes]
      : modelNodes;
  if (nodes.length === 0) {
    throw new Error(
      patterns.length > 0
        ? `la selección (${patterns.join(", ")}) no deja nada visible que renderizar`
        : "el modelo no tiene geometría visible",
    );
  }

  // El encuadre sigue a la selección cuando la hay: si el agente está trabajando en
  // un rotor, quiere ver el rotor, no el dron entero con el rotor de 12 píxeles.
  const framingNodes =
    selected.length > 0 ? toSceneNodes(model, { highlight, isolate: true }) : modelNodes;
  const sheet = renderContactSheet(nodes, tileSize, undefined, undefined, framingNodes);

  const wholeBounds = computeSceneBounds(modelNodes);
  const auditLimit = options.auditLimit ?? 12;
  const audits: ObjectReport[] = selected.slice(0, auditLimit).map((part) => ({
    name: part.name,
    ...auditMesh(part.mesh),
  }));

  const triangles = model.parts.reduce((total, part) => total + part.mesh.indices.length / 3, 0);
  const vertices = model.parts.reduce((total, part) => total + part.mesh.positions.length / 3, 0);

  const warnings: string[] = [];
  for (const audit of audits) {
    if (audit.boundaryEdges > 0) {
      warnings.push(
        `${audit.name}: ${audit.boundaryEdges} aristas de borde, la malla no está cerrada.`,
      );
    }
    if (audit.flippedNormalRatio > 0.02) {
      warnings.push(
        `${audit.name}: ${(audit.flippedNormalRatio * 100).toFixed(0)} % de caras con normal contraria a sus vértices; bobinado invertido.`,
      );
    }
    if (audit.degenerateTriangles > 0) {
      warnings.push(`${audit.name}: ${audit.degenerateTriangles} triángulos de área nula.`);
    }
  }
  if (patterns.length > 0 && selected.length === 0) {
    warnings.push(`la selección (${patterns.join(", ")}) no coincide con ninguna pieza.`);
  }

  const size: [number, number, number] = [
    wholeBounds.radius * 2,
    wholeBounds.radius * 2,
    wholeBounds.radius * 2,
  ];

  return {
    sheet,
    review: {
      source: model.source,
      parts: model.parts.length,
      triangles,
      vertices,
      boundsCenter: wholeBounds.center,
      boundsRadius: Number(wholeBounds.radius.toFixed(4)),
      size: size.map((value) => Number(value.toFixed(3))) as [number, number, number],
      families: summarizeFamilies(model.parts),
      selection: {
        patterns,
        matched: selected.map((part) => part.name),
        audits,
      },
      sheet: {
        width: sheet.width,
        height: sheet.height,
        tileSize: sheet.tileSize,
        columns: sheet.columns,
        rows: sheet.rows,
        grid: sheet.views.map((view) => view.name),
        totalMilliseconds: Number(
          sheet.views.reduce((total, view) => total + view.milliseconds, 0).toFixed(2),
        ),
      },
      views: sheet.views.map((view) => ({
        name: view.name,
        column: view.column,
        row: view.row,
        milliseconds: view.milliseconds,
        shadedLoad: view.shadedLoad,
        backfaceRatio: view.backfaceRatio,
        trianglesRasterized: view.stats.trianglesRasterized,
        pixelsShaded: view.stats.pixelsShaded,
      })),
      loaderNotes: model.notes,
      warnings,
    },
  };
}

/** Plano de referencia a la altura de la base del modelo. */
function createGroundUnder(nodes: readonly SceneNode[]): SceneNode {
  const aabb = computeSceneAabb(nodes);
  const footprint = Math.max(aabb.max[0] - aabb.min[0], aabb.max[2] - aabb.min[2], 1e-3);
  const ground = createGroundPlane(footprint * 8);
  ground.model[3] = (aabb.min[0] + aabb.max[0]) / 2;
  ground.model[7] = aabb.min[1];
  ground.model[11] = (aabb.min[2] + aabb.max[2]) / 2;
  ground.material.checkerTileWorldSize = footprint / 8;
  ground.material.checkerScale = 64;
  return ground;
}

/** Carga por extensión: `.glb` binario, `.obj` texto. */
export function loadModel(
  source: string,
  data: ArrayBuffer | string,
  decoder?: MeshoptDecoderLike,
): Model {
  const lowered = source.toLowerCase();
  if (lowered.endsWith(".glb")) {
    if (typeof data === "string") throw new Error("un GLB debe leerse como binario, no como texto");
    const { parts, notes } = parseGlb(data, decoder);
    const model: Model = { source, parts, notes };
    dedupeNames(model.parts);
    return model;
  }
  if (lowered.endsWith(".obj")) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const { parts, notes } = parseObj(text);
    const model: Model = { source, parts, notes };
    dedupeNames(model.parts);
    return model;
  }
  throw new Error(`extensión no reconocida en ${source}; se admiten .glb y .obj`);
}

/** Escena de ejemplo, para poder ejecutar el CLI sin escribir un fichero. */
export const DEMO_SCENE: SceneSpec = {
  objects: [
    {
      name: "cuerpo",
      geometry: { primitive: "box", parameters: [1.6, 0.4, 1.6] },
      position: [0, 0.6, 0],
      color: [0.55, 0.6, 0.7],
    },
    {
      name: "cupula",
      geometry: { primitive: "sphere", parameters: [0.42] },
      position: [0, 0.95, 0],
      color: [0.3, 0.72, 0.95],
    },
    {
      name: "anillo",
      geometry: { primitive: "torus", parameters: [0.95, 0.09] },
      position: [0, 0.6, 0],
      rotation: [90, 0, 0],
      color: [0.95, 0.5, 0.2],
    },
  ],
  budget: { triangles: 20000 },
};
