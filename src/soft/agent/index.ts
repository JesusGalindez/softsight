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
  hashSheet,
  measureObjectCoverage,
  projectAabbToTile,
  type ContactSheet,
  type SceneAabb,
} from "./contactSheet";
import { parseGlb, type MeshoptDecoderLike } from "./glbLoader";
import { auditMesh, type MeshAudit } from "./inspect";
import {
  dedupeNames,
  matchesName,
  needsAudit,
  parseWhere,
  selectParts,
  selectWhere,
  summarizeFamilies,
  toSceneNodes,
  type Model,
  type ModelPart,
  type PartFamily,
} from "./model";
import { parseObj } from "./objLoader";
import type { Edit } from "./model";
import type { Mat4 } from "../math";
import type { Mesh } from "../mesh";
import { diffSheets, type RasterImage, type RenderDiff } from "./renderDiff";
import { createGroundPlane, resolveScene, type SceneSpec } from "./sceneSpec";
import { auditSpatial, type SpatialAudit } from "./spatialAudit";
import { auditGeometry } from "./geometryAudit";
import { auditClips } from "./animationAudit";
import { withSeverity } from "./warningCodes";
import type { WarningCode, WarningSeverity } from "./warningCodes";
import type { Camera, SceneNode } from "../renderer";
import { SoftwareRenderer } from "../renderer";

export { SoftwareRenderer };
/** Texto SDF y planes de cartel → títulos quemados en el framebuffer. */
export type { SdfTitle } from "../renderer";
export {
  buildSdfTitles,
  fitSdfScale,
  measureSdfText,
  normalizeSdfCopy,
  placeSdfOrigin,
  resolveSdfColor,
  DEFAULT_INK_RGB,
  DEFAULT_ROLE_COLORS,
} from "../text-plan";
export type { SdfAnchorSide, SdfTextPlan } from "../text-plan";
export {
  renderContactSheet,
  computeSceneAabb,
  computeSceneBounds,
  hashSheet,
  measureObjectCoverage,
  projectAabb,
  projectAabbToTile,
  frameCamera,
  frameCameraFromAabb,
  DEFAULT_VIEWS,
} from "./contactSheet";
export { drawSDFText } from "../text";
export type { TextRun } from "../text";
export { auditMesh } from "./inspect";
export { parseGlb } from "./glbLoader";
export { parseBvh, bvhToSkinnedScene } from "./bvhLoader";
export { bindModelToSkeleton, restWorldMatrices, skeletonFromParsedGlb } from "./skinBinding";
export { resolveRig, eulerToQuaternion } from "./rigSpec";
export type {
  ClipSpec,
  JointSpec,
  KeySpec,
  ResolvedRig,
  SkeletonSpec,
  TrackSpec,
  VectorVariationSpec,
} from "./rigSpec";
export { auditAnimation, auditClips } from "./animationAudit";
export type {
  AnimationAudit,
  AnimationAuditOptions,
  AnimationCrossing,
  GroundBreach,
} from "./animationAudit";
export type { BindResult, SkeletonSource, SkinBinding, SkinBindingRule } from "./skinBinding";
export type { BvhChannel, BvhDocument, BvhJoint, BvhToSceneOptions } from "./bvhLoader";
export { serializeGlb, serializeSkinnedGlb } from "./glbWriter";
export type {
  SkinnedGlbAnimation,
  SkinnedGlbChannel,
  SkinnedGlbMesh,
  SkinnedGlbMorphTarget,
  SkinnedGlbNode,
  SkinnedGlbPrimitive,
  SkinnedGlbSampler,
  SkinnedGlbScene,
  SkinnedGlbSkin,
} from "./glbWriter";
export type { MeshoptDecoderLike } from "./glbLoader";
export { parseObj, serializeObj } from "./objLoader";
export {
  applyPatch,
  dedupeNames,
  geometryKeyOf,
  matchesName,
  matchesPattern,
  needsAudit,
  parseWhere,
  selectParts,
  selectWhere,
  summarizeFamilies,
  toSceneNodes,
} from "./model";
export type { Model, ModelPart, PartFamily, Patch, Edit, EditResult, PropertyQuery } from "./model";
export { diffSheets } from "./renderDiff";
export type { RasterImage, RenderDiff, DiffRegion } from "./renderDiff";
export { resolveScene, resolveObject, resolveCopies, modelFromScene, createGroundPlane } from "./sceneSpec";
export { evaluateVariation, resolveSweepPath } from "./sceneSpec";
export type {
  ProfileSpec,
  LoftSpec,
  LoftSectionSpec,
  SweepSpec,
  PathSpec,
  VariationSpec,
  DeformSpec,
  RepeatSpec,
} from "./sceneSpec";
export { auditGeometry } from "./geometryAudit";
export { createScreenAudit, screenWarnings } from "./screenAudit";
export { auditSkin } from "./skinAudit";
export type {
  BlindEntrance,
  Occlusion,
  OffFrameEvent,
  ScreenAudit,
  ScreenAuditOptions,
} from "./screenAudit";
export {
  applyDeformers,
  createCircleProfile,
  createGielisProfile,
  createLoft,
  createNacaProfile,
  createSuperellipseProfile,
  createSweep,
  sweepStations,
} from "../mesh";
export type { Axis, Deformer, LoftSection, SweepStation, SweepPath } from "../mesh";
export { applyPatchToScene } from "./scenePatch";
export { invertPatch } from "./invertPatch";
export { auditSpatial } from "./spatialAudit";
export type { SpatialAudit, Interpenetration, ScaleOutlier, PlacedPart } from "./spatialAudit";
export {
  applyAnimation,
  applyMorphTargets,
  applySkin,
  buildNodeStates,
  computeWorlds,
  evaluatePose,
  evaluatePoseWithNormals,
  evaluateSample,
  hashSamplesAtFrames,
  inspectGlbAnimation,
  parseGlbAnimation,
  readAccessorValues,
  sampleSurface,
  validateSampleReference,
} from "./animation";
export type {
  AnimationClipSummary,
  AnimationControlPose,
  AnimationControlPoseReference,
  EvaluatedPose,
  GltfAnimation,
  GltfDocument,
  NodeState,
  ParsedGlb,
  SampleEvaluation,
  SampleFrameHash,
  SampleReference,
  SoftSightAnimationInspection,
} from "./animation";
export { resolveStory, ROLE_REQUIRED_DATA, STORY_VERSION } from "./storySpec";
export type { ResolvedScene, ResolvedStory, StoryScene, StorySpec } from "./storySpec";
export {
  auditStaging,
  contrastRatio,
  resolveStaging,
  DEFAULT_CONTRAST_RATIO,
  STAGING_AUDIT_CONTRACT_VERSION,
  STAGING_VERSION,
} from "./stagingAudit";
export type {
  LayerKind,
  StagedLayer,
  StagedScene,
  StagingAudit,
  StagingAuditOptions,
  StagingSceneReading,
  StagingSpec,
  StagingWarning,
} from "./stagingAudit";
export {
  auditStory,
  DEFAULT_READING_RATE,
  REQUIRED_ROLES,
  STORY_AUDIT_CONTRACT_VERSION,
} from "./storyAudit";
export type { SceneReading, StoryAudit, StoryAuditOptions, StoryWarning } from "./storyAudit";
export { SUMMARY_KEYS, projectFields, summarize } from "./reportView";
export { WARNING_CODES, WARNING_CODE_LIST, withSeverity } from "./warningCodes";
export type { WarningCode, WarningCodeEntry, WarningSeverity } from "./warningCodes";
export {
  SCENE_SCHEMA,
  PATCH_SCHEMA,
  SAMPLE_REFERENCE_SCHEMA,
  SCENE_ROLES,
  STAGING_SCHEMA,
  STORY_SCHEMA,
  toJsonSchema,
  validate,
  assertValid,
} from "./schema";
export type { SceneRole } from "./schema";
export type { FieldSchema, ObjectSchema } from "./schema";
export type {
  SceneSpec,
  ObjectSpec,
  GeometrySpec,
  PrimitiveSpec,
  RawMeshSpec,
  ExtrudeSpec,
  RevolveSpec,
} from "./sceneSpec";
export type { MeshAudit } from "./inspect";
export type { ContactSheet, ProjectedAabb, ViewDefinition } from "./contactSheet";

export interface ObjectReport extends MeshAudit {
  name: string;
}

/**
 * Aviso con clave estable.
 *
 * El texto lleva las cifras dentro —«148 aristas de borde»— y cambia en cuanto la
 * malla cambia, así que comparar textos entre dos ejecuciones da falsos avisos
 * nuevos. `code` más `part` identifican el mismo problema aunque el número baile,
 * y es lo que hace posible responder «¿esto es nuevo o ya estaba?».
 */
export interface Warning {
  /**
   * Del registro de `warningCodes.ts`, no una cadena cualquiera: emitir un
   * código que no esté en la tabla no compila.
   */
  code: WarningCode;
  /**
   * La que declara la tabla para ese código, puesta por `withSeverity`. Viaja
   * dentro del aviso porque es lo que decide qué hacer con él —y el código de
   * salida del CLI—, y cruzarlo a mano contra `--schema codes` para averiguarlo
   * era trabajo que el informe puede ahorrar.
   */
  severity: WarningSeverity;
  /** Pieza a la que se refiere, o `null` si el aviso es del conjunto. */
  part: string | null;
  message: string;
  /**
   * Operación de parche que lo corrige, cuando existe una.
   *
   * Un diagnóstico sin acción obliga al agente a improvisar la corrección, y esa
   * improvisación es donde se cometen los errores. Los avisos **sin** `fix` no son un
   * olvido: son aquellos para los que la herramienta no tiene nada honesto que
   * ofrecer —una malla abierta se cierra de muchas maneras y ninguna es automática—.
   */
  fix?: Edit;
}

/**
 * Un aviso recién medido, antes de que la tabla le ponga la severidad. Es lo que
 * construye cada auditoría, y `withSeverity` lo convierte en `Warning` al
 * devolverlo: así ningún sitio de emisión escribe una severidad a mano.
 */
export type Finding = Omit<Warning, "severity">;

/**
 * Presupuesto como contrato: mientras solo hubo `budget.triangles`, el código de
 * salida era informativo. Con esto, el agente sabe si su cambio cumple lo pactado
 * sin interpretar el JSON —basta el código de salida— y sin negociar el criterio
 * en cada llamada.
 */
export interface Budget {
  triangles?: number;
  parts?: number;
  boundaryEdges?: number;
  degenerateTriangles?: number;
  /** Error de simetría en X admitido, como fracción del radio. */
  symmetryError?: number;
  /** Exige que todas las mallas estén cerradas. */
  watertight?: boolean;
  /**
   * Cuánto tiene que desplazar cada pieza, declarado por el agente.
   *
   * Es la única cláusula **por pieza**: las demás miran el conjunto. Sirve para
   * afirmar lo que el generador ya sabe —un cilindro de radio r y alto h desplaza
   * `π·r²·h`— y que la puerta lo compruebe contra la malla de verdad, que es donde
   * se ve si un deformador se comió el volumen o si una escala se aplicó dos veces.
   */
  volumes?: VolumeClause[];
}

/**
 * «Esta pieza debe desplazar tanto».
 *
 * `part` es un patrón con la sintaxis de `--select`, y la cláusula se exige a
 * **cada** pieza que encaje: con `rotor-*` se dice de una vez lo que las cuatro
 * copias de un `repeat` tienen que medir. Una cláusula que no encaja con ninguna
 * pieza **incumple igual**, porque un contrato que no se aplica a nada solo puede
 * ser una errata en el nombre.
 */
export interface VolumeClause {
  part: string;
  /** Volumen firmado esperado, en unidades del documento al cubo. */
  volume: number;
  /**
   * Desviación admitida, en fracción del volumen declarado. 0,01 por defecto.
   *
   * No es cero porque no puede serlo: las posiciones viven en `Float32` y el
   * volumen sale de sumar un determinante por triángulo, así que la igualdad
   * exacta no sobrevive ni a la aritmética. El valor usado va dentro del aviso.
   */
  tolerance?: number;
}

export interface WarningsDelta {
  new: Warning[];
  resolved: Warning[];
  persistent: number;
}

const warningKey = (warning: Warning): string => `${warning.code}|${warning.part ?? ""}`;

/**
 * Avisos nuevos, resueltos y persistentes frente a un informe anterior. Un agente
 * que repite una revisión solo necesita mirar `new`: lo demás ya lo sabía.
 */
export function compareWarnings(
  current: readonly Warning[],
  previous: readonly Warning[],
): WarningsDelta {
  const before = new Map(previous.map((warning) => [warningKey(warning), warning]));
  const now = new Set(current.map(warningKey));

  const fresh = current.filter((warning) => !before.has(warningKey(warning)));
  const resolved = [...before.values()].filter((warning) => !now.has(warningKey(warning)));
  return { new: fresh, resolved, persistent: current.length - fresh.length };
}

/** Lado mayor de una caja, que es lo que se compara contra un tamaño esperado. */
function longestSide(size: readonly [number, number, number]): number {
  return Math.max(size[0], size[1], size[2]);
}

/** Unidades cuya conversión a metros explicaría un factor así. */
const UNIT_GUESSES: Array<{ factor: number; name: string }> = [
  { factor: 1000, name: "milímetros" },
  { factor: 100, name: "centímetros" },
  { factor: 39.3701, name: "pulgadas" },
  { factor: 3.28084, name: "pies" },
];

function guessUnit(factor: number): string | null {
  for (const guess of UNIT_GUESSES) {
    if (Math.abs(factor / guess.factor - 1) < 0.05) return guess.name;
  }
  return null;
}

/**
 * Escala absoluta: la comprobación más barata del plan y la que caza el fallo más
 * común de la geometría generada.
 *
 * El informe da la caja en unidades del fichero y un agente no sabe si son metros o
 * milímetros. glTF **dice metros**, así que un dron de 4,5 unidades son 4,5 metros,
 * que es absurdo para un cuadricóptero. Con `expectSize` se compara contra lo que el
 * objeto debería medir; sin él, solo se avisa fuera de un rango muy amplio. En los dos
 * casos el aviso **dice la suposición**, porque la suposición es justo lo que puede
 * estar mal.
 */
function checkScale(size: readonly [number, number, number], expectSize?: number): Finding[] {
  const largest = longestSide(size);
  if (largest <= 0) return [];

  if (expectSize !== undefined && expectSize > 0) {
    const factor = largest / expectSize;
    if (factor > 1.5 || factor < 1 / 1.5) {
      const unit = guessUnit(factor);
      return [
        {
          code: "ESCALA_INESPERADA",
          part: null,
          message:
            `la caja mide ${largest.toFixed(3)} m en su lado mayor y esperabas ~${expectSize} m ` +
            `(factor ${factor.toFixed(1)}); ` +
            (unit !== null
              ? `el modelo parece estar en ${unit}.`
              : "revisa la unidad del fichero o la escala del nodo raíz."),
        },
      ];
    }
    return [];
  }

  // Sin tamaño esperado, solo lo insostenible: por debajo de un centímetro o por
  // encima de cien metros casi nada es lo que dice ser.
  if (largest < 0.01 || largest > 100) {
    return [
      {
        code: "ESCALA_SOSPECHOSA",
        part: null,
        message:
          `la caja mide ${largest.toFixed(3)} m en su lado mayor, suponiendo que el fichero esté ` +
          "en metros como manda glTF; fuera del rango 1 cm – 100 m casi nada es lo que dice ser. " +
          "Pasa --expect-size para comprobarlo contra el tamaño real.",
      },
    ];
  }
  return [];
}

/**
 * Avisos de la auditoría entre piezas. Se redactan diciendo **de qué son prueba y de
 * qué no**: el solape de cajas es condición necesaria y no suficiente para que dos
 * mallas se corten de verdad, y callarlo convertiría un candidato en una certeza que
 * el agente no puede comprobar.
 */
function spatialWarnings(audit: SpatialAudit): Finding[] {
  const warnings: Finding[] = [];
  for (const pair of audit.interpenetration) {
    // Una caja entera dentro de otra es un alojamiento —un motor dentro de su
    // carcasa, una tira sobre una cubierta— y en un ensamblaje real es la mayoría
    // de los solapes. Lo que delata un cruce es el solape **parcial**: dos piezas
    // que se muerden sin que ninguna contenga a la otra. Los alojamientos siguen en
    // `spatial.interpenetration` por si el agente los quiere, pero no avisan.
    if (pair.contained) continue;
    warnings.push({
      code: "INTERPENETRACION",
      part: pair.parts[0],
      message: `${pair.parts[0]} y ${pair.parts[1]}: sus cajas se cruzan y solapan el ${(pair.overlap * 100).toFixed(0)} % del volumen de la menor, sin que ninguna contenga a la otra; candidato a interpenetración, no comprobado malla contra malla.`,
    });
  }
  for (const floating of audit.floating) {
    warnings.push({
      code: "PIEZA_FLOTANTE",
      part: floating.part,
      fix:
        floating.nearest !== null
          ? { op: "align", target: floating.part, to: floating.nearest }
          : undefined,
      message:
        `${floating.part}: no toca ninguna otra pieza. ` +
        (floating.below !== null
          ? `Está ${floating.gap} por encima de ${floating.below}`
          : `Está ${floating.gap} por encima del suelo del modelo, sin nada debajo`) +
        (floating.nearest !== null
          ? `, y a ${floating.distance} de ${floating.nearest}, que es la pieza más próxima.`
          : "."),
    });
  }
  for (const group of audit.duplicates) {
    warnings.push({
      code: "DUPLICADO_EXACTO",
      part: group.parts[0],
      fix: { op: "delete", target: group.parts[1] },
      message: `${group.parts.length} piezas con la misma geometría en la misma posición —${nameList(group.parts)}—, ${group.triangles} triángulos cada una; no se ven y multiplican el coste.`,
    });
  }
  for (const outlier of audit.scaleOutliers) {
    warnings.push({
      code: "ESCALA_HERMANOS",
      part: outlier.part,
      fix: {
        op: "scale",
        target: outlier.part,
        factor: Number((outlier.median / outlier.diagonal).toFixed(4)),
      },
      message: `${outlier.part}: su caja mide ${outlier.diagonal} de diagonal y la mediana de sus ${outlier.siblings} hermanos es ${outlier.median}, un factor ${outlier.factor}; o le sobra escala, o está en el grupo equivocado.`,
    });
  }
  return warnings;
}

/** Sufijo «y N más» para no volcar 200 nombres en un aviso. */
function nameList(names: readonly string[], limit = 4): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} y ${names.length - limit} más`;
}

/**
 * Incumplimientos del presupuesto. `audits` puede venir vacío: sin auditoría no se
 * puede juzgar la topología, y callar sería peor que no ofrecer la comprobación.
 */
function checkBudget(
  budget: Budget,
  totals: { parts: number; triangles: number },
  audits: readonly ObjectReport[],
): Finding[] {
  const warnings: Finding[] = [];

  if (budget.triangles !== undefined && totals.triangles > budget.triangles) {
    warnings.push({
      code: "PRESUPUESTO_TRIANGULOS",
      part: null,
      message: `${totals.triangles} triángulos, ${budget.triangles} presupuestados: ${(
        (totals.triangles / budget.triangles - 1) *
        100
      ).toFixed(0)} % por encima.`,
    });
  }
  if (budget.parts !== undefined && totals.parts > budget.parts) {
    warnings.push({
      code: "PRESUPUESTO_PIEZAS",
      part: null,
      message: `${totals.parts} piezas, ${budget.parts} presupuestadas.`,
    });
  }

  if (budget.watertight === true) {
    const open = audits.filter((audit) => !audit.watertight).map((audit) => audit.name);
    if (open.length > 0) {
      warnings.push({
        code: "PRESUPUESTO_ESTANQUEIDAD",
        part: null,
        message: `se exigen mallas cerradas y ${open.length} ${
          open.length === 1 ? "no lo está" : "no lo están"
        }: ${nameList(open)}.`,
      });
    }
  }
  if (budget.boundaryEdges !== undefined) {
    const total = audits.reduce((sum, audit) => sum + audit.boundaryEdges, 0);
    if (total > budget.boundaryEdges) {
      warnings.push({
        code: "PRESUPUESTO_BORDES",
        part: null,
        message: `${total} aristas de borde en total, ${budget.boundaryEdges} presupuestadas.`,
      });
    }
  }
  if (budget.degenerateTriangles !== undefined) {
    const total = audits.reduce((sum, audit) => sum + audit.degenerateTriangles, 0);
    if (total > budget.degenerateTriangles) {
      warnings.push({
        code: "PRESUPUESTO_DEGENERADOS",
        part: null,
        message: `${total} triángulos de área nula, ${budget.degenerateTriangles} presupuestados.`,
      });
    }
  }
  for (const [index, clause] of (budget.volumes ?? []).entries()) {
    const where = `budget.volumes[${index}]`;
    if (!(clause.tolerance === undefined || clause.tolerance >= 0)) {
      throw new Error(`${where}: la tolerancia es una fracción no negativa, no ${clause.tolerance}`);
    }
    const tolerance = clause.tolerance ?? 0.01;
    const matched = audits.filter((audit) => matchesName(audit.name, clause.part));
    if (matched.length === 0) {
      warnings.push({
        code: "PRESUPUESTO_VOLUMEN",
        part: null,
        message:
          `${where} declara el volumen de '${clause.part}' y no hay ninguna pieza que encaje. ` +
          "Un contrato que no se aplica a nada se cumple siempre, así que se cuenta como incumplido: " +
          "casi siempre es el nombre.",
      });
      continue;
    }
    const admitted = Math.abs(clause.volume) * tolerance;
    for (const audit of matched) {
      const off = audit.signedVolume - clause.volume;
      if (Math.abs(off) <= admitted) continue;
      warnings.push({
        code: "PRESUPUESTO_VOLUMEN",
        part: audit.name,
        message:
          `${audit.name} desplaza ${audit.signedVolume} y se declararon ${clause.volume} ` +
          `±${(tolerance * 100).toFixed(2)} %: se sale por ${Math.abs(off).toPrecision(3)}, ` +
          `un ${((Math.abs(off) / Math.abs(clause.volume || 1)) * 100).toFixed(1)} %.`,
      });
    }
  }

  if (budget.symmetryError !== undefined) {
    const worst = audits
      .filter((audit) => audit.symmetryErrorX !== null)
      .map((audit) => ({ name: audit.name, error: audit.symmetryErrorX as number }))
      .filter((entry) => entry.error > (budget.symmetryError as number))
      .sort((a, b) => b.error - a.error);
    if (worst.length > 0) {
      warnings.push({
        code: "PRESUPUESTO_SIMETRIA",
        part: null,
        message: `${worst.length} ${
          worst.length === 1 ? "pieza supera" : "piezas superan"
        } el ${((budget.symmetryError as number) * 100).toFixed(
          1,
        )} % de error de simetría; la peor es ${worst[0].name} con ${(worst[0].error * 100).toFixed(1)} %.`,
      });
    }
  }

  return warnings;
}

export interface SheetReport {
  width: number;
  height: number;
  tileSize: number;
  columns: number;
  rows: number;
  /** Nombre de cada vista en orden de lectura, fila por fila. */
  grid: string[];
  totalMilliseconds: number;
  /** Caja que definió el encuadre; devuélvela para repetir la misma cámara. */
  frameAabb: SceneAabb;
}

export interface ViewReport {
  name: string;
  column: number;
  row: number;
  milliseconds: number;
  shadedLoad: number;
  backfaceRatio: number;
  trianglesRasterized: number;
  pixelsShaded: number;
  /**
   * La cámara con que se encuadró este tile.
   *
   * Sin ella, cualquiera que quiera rasterizar la misma escena por otra vía
   * —el editor, otra herramienta— tiene que **adivinar el encuadre o copiar
   * nuestros internos**, y entonces no está comparando dos renders sino dos
   * copias del mismo código. Publicarla es lo que convierte el pliego en algo
   * reproducible desde fuera.
   *
   * **Se usa con aspecto 1 sobre un tile cuadrado de `sheet.tileSize`**, y el
   * pliego entero **no** es cuadrado: son `columns × rows` tiles. Es el único
   * dato del encuadre que la cámara no lleva dentro, así que va escrito aquí:
   * tomar el aspecto del pliego en vez del del tile es el error natural, y da
   * cajas distintas sin que nada falle. `test:framing` lo comprueba
   * reproduciendo cada caja de `partScreenBoxes` con esta cámara.
   */
  camera: Camera;
}

export type RenderHash = { sheet: string; byView: Record<string, string> };

/** Caja `[x0, y0, x1, y1]` por vista y por pieza, en píxeles del pliego entero. */
export type ScreenBoxes = Record<string, Record<string, [number, number, number, number]>>;

export interface SceneReview {
  objects: ObjectReport[];
  scene: {
    objects: number;
    triangles: number;
    vertices: number;
    boundsCenter: [number, number, number];
    boundsRadius: number;
    /** Extensión de la caja envolvente en unidades del fichero. */
    size: [number, number, number];
    /** Fracción del encuadre que ocupa el objeto, medida sin el suelo. */
    objectCoverage: number | null;
    budgetTriangles: number | null;
    budgetExceeded: boolean;
  };
  /** Nulo con `inspectOnly`: no se ha renderizado nada que describir. */
  sheet: SheetReport | null;
  views: ViewReport[];
  renderHash: RenderHash | null;
  partScreenBoxes: ScreenBoxes | null;
  /** Auditoría entre piezas: solapes y hermanos fuera de escala. */
  spatial: SpatialAudit;
  diff: RenderDiff | null;
  warnings: Warning[];
  warningsDelta: WarningsDelta | null;
}

export interface ReviewOptions {
  tileSize?: number;
  /** Suelo de referencia: entra en el render, no en la auditoría ni el encuadre. */
  ground?: boolean;
  /**
   * Devolver solo el diagnóstico, sin renderizar el pliego.
   *
   * La mayoría de las llamadas de un agente son consultas —qué hay, cómo se llama,
   * qué dice la auditoría— y en ellas el render es el grueso del coste y nadie mira
   * la imagen.
   */
  inspectOnly?: boolean;
  /** Pliego anterior ya decodificado, para comparar contra el que se va a renderizar. */
  baseline?: RasterImage;
  /**
   * Encuadre impuesto. Comparar dos pliegos exige la misma cámara, y la cámara se
   * ajusta al contenido: sin fijarla, cualquier cambio desplaza el pliego entero.
   */
  frameAabb?: SceneAabb;
  /** Avisos de una revisión anterior, para separar lo nuevo de lo que ya estaba. */
  baselineWarnings?: readonly Warning[];
  /**
   * Render de comparación en vez de render para mirar: sin suavizado, sin
   * sombras, sin rótulo y sobre negro. Es lo que hace comparable el pliego con
   * el de otro rasterizador; para revisar una escena no sirve, porque quita
   * justo lo que ayuda a un humano a juzgarla.
   */
  parity?: boolean;
  /**
   * Tamaño plausible del objeto en metros, para juzgar la escala. glTF mide en
   * metros, así que sin esto solo se puede avisar de lo insostenible.
   */
  expectSize?: number;
}

function sheetReport(sheet: ContactSheet): SheetReport {
  return {
    width: sheet.width,
    height: sheet.height,
    tileSize: sheet.tileSize,
    columns: sheet.columns,
    rows: sheet.rows,
    grid: sheet.views.map((view) => view.name),
    totalMilliseconds: Number(
      sheet.views.reduce((total, view) => total + view.milliseconds, 0).toFixed(2),
    ),
    frameAabb: sheet.frameAabb,
  };
}

function viewReports(sheet: ContactSheet): ViewReport[] {
  return sheet.views.map((view) => ({
    name: view.name,
    column: view.column,
    row: view.row,
    milliseconds: view.milliseconds,
    shadedLoad: view.shadedLoad,
    backfaceRatio: view.backfaceRatio,
    trianglesRasterized: view.stats.trianglesRasterized,
    pixelsShaded: view.stats.pixelsShaded,
    camera: view.camera,
  }));
}

function buildWarnings(
  objects: readonly ObjectReport[],
  /** `null` cuando no se ha renderizado: sin imagen no hay encuadre que juzgar. */
  objectCoverage: number | null,
): Finding[] {
  const warnings: Finding[] = [];
  const add = (code: WarningCode, part: string | null, message: string, fix?: Edit): void => {
    warnings.push(fix !== undefined ? { code, part, message, fix } : { code, part, message });
  };

  for (const object of objects) {
    if (object.triangles === 0) {
      add("MALLA_VACIA", object.name, `${object.name}: la malla no tiene triángulos.`);
      continue;
    }
    if (object.degenerateTriangles > 0) {
      add(
        "TRIANGULOS_DEGENERADOS",
        object.name,
        `${object.name}: ${object.degenerateTriangles} triángulos de área nula; no pintan nada y cuestan preparación.`,
      );
    }
    if (object.nonManifoldEdges > 0) {
      add(
        "NO_MANIFOLD",
        object.name,
        `${object.name}: ${object.nonManifoldEdges} aristas compartidas por 3+ caras (no manifold); busca caras duplicadas o superpuestas.`,
      );
    }
    if (object.boundaryEdges > 0) {
      add(
        "BORDE_ABIERTO",
        object.name,
        `${object.name}: ${object.boundaryEdges} aristas de borde, la malla no está cerrada; si debía ser un sólido, falta soldar o tapar.`,
      );
    }
    if (object.flippedNormalRatio > 0.02) {
      add(
        "NORMAL_INVERTIDA",
        object.name,
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
      add(
        "PIVOTE_DESCENTRADO",
        object.name,
        `${object.name}: el centro de la caja está a ${offsetMagnitude.toFixed(2)} del origen del objeto; el pivote quedará descentrado al rotar.`,
        { op: "setPivot", target: object.name },
      );
    }
    if (object.inverted) {
      add(
        "MALLA_INVERTIDA",
        object.name,
        `${object.name}: la malla está cerrada pero su volumen firmado es negativo (${object.signedVolume}); las caras miran hacia dentro, así que se ve oscura o desaparece.`,
      );
    }
    if (object.symmetryErrorX !== null && object.symmetryErrorX > 0.02) {
      add(
        "SIMETRIA_ROTA",
        object.name,
        `${object.name}: error de simetría en X del ${(object.symmetryErrorX * 100).toFixed(1)} % del radio; si debía ser simétrico, no lo es.`,
      );
    }
  }

  if (objectCoverage === null) {
    // sin encuadre que juzgar
  } else if (objectCoverage < 0.005) {
    add(
      "ENCUADRE_DIMINUTO",
      null,
      `el objeto ocupa el ${(objectCoverage * 100).toFixed(2)} % del encuadre; queda fuera de cuadro o es diminuto frente a su propia caja envolvente.`,
    );
  } else if (objectCoverage > 0.9) {
    add(
      "ENCUADRE_RECORTADO",
      null,
      `el objeto ocupa el ${(objectCoverage * 100).toFixed(0)} % del encuadre; puede estar recortado.`,
    );
  }

  // La proporción de caras descartadas por reverso **no** avisa de nada, y por eso
  // ya no se usa: invertir un sólido cerrado cambia qué mitad se descarta, no
  // cuánta —un cubo y su copia invertida dan las mismas seis cifras—, mientras que
  // un cubo correcto visto de canto llega al 86 % sin tener nada malo. Lo que sí
  // detecta la inversión es el signo del volumen, y va por pieza, arriba.

  return warnings;
}

/**
 * Resuelve, renderiza y audita una escena escrita por el agente.
 *
 * Lleva las mismas herramientas de verificación que el camino de modelo —consulta
 * barata, comparación con el pliego anterior, avisos nuevos, cajas en pantalla—,
 * porque quien **crea** desde cero las necesita al menos tanto como quien edita un
 * fichero existente.
 */
export function reviewScene(
  spec: SceneSpec,
  options: ReviewOptions = {},
): { sheet: ContactSheet | null; review: SceneReview } {
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
  const sheet = options.inspectOnly
    ? null
    : renderContactSheet(
        nodes,
        tileSize,
        undefined,
        undefined,
        objectNodes,
        options.frameAabb,
        options.parity ?? false,
      );
  const objectCoverage = options.inspectOnly
    ? null
    : Number(measureObjectCoverage(objectNodes).toFixed(4));

  const triangles = objects.reduce((total, object) => total + object.triangles, 0);
  const vertices = objects.reduce((total, object) => total + object.vertices, 0);
  const budget = spec.budget ?? {};
  const budgetTriangles = budget.triangles ?? null;
  const budgetWarnings = checkBudget(budget, { parts: objects.length, triangles }, objects);

  const boxed = resolved.map((entry) => ({
    name: entry.name,
    mesh: entry.node.mesh,
    model: entry.node.model,
  }));
  const aabb = computeSceneAabb(objectNodes);
  const size: [number, number, number] = [
    Number((aabb.max[0] - aabb.min[0]).toFixed(4)),
    Number((aabb.max[1] - aabb.min[1]).toFixed(4)),
    Number((aabb.max[2] - aabb.min[2]).toFixed(4)),
  ];
  const spatial = auditSpatial(
    resolved.map((entry) => ({
      name: entry.name,
      path: entry.name,
      mesh: entry.node.mesh,
      model: entry.node.model,
    })),
  );
  const warnings = withSeverity([
    ...buildWarnings(objects, objectCoverage),
    ...budgetWarnings,
    ...checkScale(size, options.expectSize),
    ...spatialWarnings(spatial),
    // Sobre el documento, no sobre la malla: hay geometría mal declarada que la
    // malla ya no delata, como un barrido que se corta a sí mismo. Y lo mismo con
    // el movimiento: una vuelta entera escrita con dos claves no se mueve, y el
    // fichero sale igual de válido.
    ...auditGeometry(spec),
    ...auditClips(spec.clips),
  ]);

  const review: SceneReview = {
    objects,
    scene: {
      objects: objects.length,
      triangles,
      vertices,
      boundsCenter: bounds.center,
      boundsRadius: Number(bounds.radius.toFixed(4)),
      size,
      objectCoverage: objectCoverage ?? null,
      budgetTriangles,
      budgetExceeded: budgetWarnings.length > 0,
    },
    sheet: sheet ? sheetReport(sheet) : null,
    views: sheet ? viewReports(sheet) : [],
    renderHash: sheet ? hashSheet(sheet) : null,
    partScreenBoxes: sheet ? screenBoxes(boxed, sheet) : null,
    spatial,
    diff: sheet && options.baseline ? diffSheets(sheet, options.baseline, screenBoxes(boxed, sheet)) : null,
    warnings,
    warningsDelta: options.baselineWarnings
      ? compareWarnings(warnings, options.baselineWarnings)
      : null,
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
    /** Condición por propiedad, si se pasó. */
    where: string | null;
    matched: string[];
    audits: ObjectReport[];
  };
  /** Nulo con `inspectOnly`: no se ha renderizado nada que describir. */
  sheet: SheetReport | null;
  views: ViewReport[];
  /**
   * Caja `[x0, y0, x1, y1]` de cada pieza auditada en cada vista, **en píxeles del
   * pliego entero**, que es la imagen que el agente tiene delante.
   *
   * Solo de las piezas auditadas, no de las 296: la lista completa por seis vistas
   * gastaría más contexto del que ahorra. Una pieza ausente en una vista es una que
   * queda fuera del tile o que cruza el plano de la cámara.
   */
  partScreenBoxes: ScreenBoxes | null;
  /** Auditoría entre piezas: solapes y hermanos fuera de escala. */
  spatial: SpatialAudit;
  /**
   * Comparación con un pliego anterior, si se pasó uno. `null` cuando no lo hay.
   *
   * Las claves van en inglés como el resto del informe, no como en el boceto del
   * plan: un informe con dos idiomas de clave obliga a recordar cuál toca en cada
   * campo.
   */
  diff: RenderDiff | null;
  /**
   * Huella exacta del pliego y de cada vista. Comparar dos huellas cuesta cero y
   * responde «¿cambió algo?» sin guardar imágenes; el `diff` dice cuánto y dónde.
   */
  renderHash: RenderHash | null;
  loaderNotes: string[];
  warnings: Warning[];
  /** Avisos nuevos, resueltos y persistentes frente al informe anterior, si se pasó. */
  warningsDelta: WarningsDelta | null;
}

export interface ModelReviewOptions extends ReviewOptions {
  select?: string[];
  /** Selección por propiedad: `triangles>1000`, `boundaryEdges>0`, `material=Vidrio`. */
  selectWhere?: string;
  isolate?: boolean;
  /** Cuántas piezas seleccionadas auditar en detalle. */
  auditLimit?: number;
  /** Colorear con el material del fichero en vez de arcilla neutra. */
  useMaterialColors?: boolean;
  /**
   * Contrato que el modelo debe cumplir. Las cláusulas de topología —cerrado,
   * bordes, degenerados, simetría— obligan a auditar **todas** las piezas, no solo
   * las seleccionadas: 1,2 s en el dron, frente a 0,16 s de una consulta. Solo se
   * paga si se pide alguna de ellas.
   */
  budget?: Budget;
  /**
   * Quién audita una malla. Por defecto `auditMesh`, que es la función pura de
   * siempre; el CLI le pone delante una caché en disco.
   *
   * Existe porque el coste de las cláusulas de topología es real —auditar las 296
   * piezas del dron— y **`auditMesh` depende solo de la malla**, no de la matriz:
   * la pieza que un parche movió pero no deformó tiene la misma auditoría. Quien
   * pueda reconocer que la malla es la misma se ahorra el recorrido, y como lo
   * que devuelve es la misma función sobre la misma entrada, el informe no puede
   * salir distinto.
   *
   * La caché no vive aquí porque esta capa no toca el sistema de ficheros: la
   * inyecta `tools/agent3d.mjs`, que sí.
   */
  auditMesh?: (mesh: Mesh) => MeshAudit;
}

export function reviewModel(model: Model, options: ModelReviewOptions = {}): {
  sheet: ContactSheet | null;
  review: ModelReview;
} {
  const audit = options.auditMesh ?? auditMesh;
  const tileSize = options.tileSize ?? 320;
  const patterns = options.select ?? [];
  // Por nombre y por propiedad se suman: quien pide las dos cosas quiere las dos.
  const queries = options.selectWhere !== undefined ? parseWhere(options.selectWhere) : [];
  let byProperty: ModelPart[] = [];
  if (queries.length > 0) {
    // Auditar las 296 piezas solo si alguna condición mira la topología.
    const audits = new Map<string, Record<string, number | boolean | null>>();
    if (needsAudit(queries)) {
      for (const part of model.parts) {
        audits.set(part.name, audit(part.mesh) as unknown as Record<string, number | boolean | null>);
      }
    }
    byProperty = selectWhere(model, queries, audits);
  }
  const selected = [...new Set([...selectParts(model, patterns), ...byProperty])];
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
  let sheet: ContactSheet | null = null;
  if (!options.inspectOnly) {
    const framingNodes =
      selected.length > 0 ? toSceneNodes(model, { highlight, isolate: true }) : modelNodes;
    sheet = renderContactSheet(
      nodes,
      tileSize,
      undefined,
      undefined,
      framingNodes,
      options.frameAabb,
      options.parity ?? false,
    );
  }

  const wholeBounds = computeSceneBounds(modelNodes);
  const auditLimit = options.auditLimit ?? 12;
  const audited = selected.slice(0, auditLimit);
  const audits: ObjectReport[] = audited.map((part) => ({
    name: part.name,
    ...audit(part.mesh),
  }));

  const triangles = model.parts.reduce((total, part) => total + part.mesh.indices.length / 3, 0);
  const vertices = model.parts.reduce((total, part) => total + part.mesh.positions.length / 3, 0);

  const findings: Finding[] = [];
  for (const audit of audits) {
    if (audit.boundaryEdges > 0) {
      findings.push({
        code: "BORDE_ABIERTO",
        part: audit.name,
        message: `${audit.name}: ${audit.boundaryEdges} aristas de borde, la malla no está cerrada.`,
      });
    }
    if (audit.flippedNormalRatio > 0.02) {
      findings.push({
        code: "NORMAL_INVERTIDA",
        part: audit.name,
        message: `${audit.name}: ${(audit.flippedNormalRatio * 100).toFixed(0)} % de caras con normal contraria a sus vértices; bobinado invertido.`,
      });
    }
    if (audit.inverted) {
      findings.push({
        code: "MALLA_INVERTIDA",
        part: audit.name,
        message: `${audit.name}: malla cerrada con volumen firmado negativo (${audit.signedVolume}); las caras miran hacia dentro.`,
      });
    }
    if (audit.degenerateTriangles > 0) {
      findings.push({
        code: "TRIANGULOS_DEGENERADOS",
        part: audit.name,
        message: `${audit.name}: ${audit.degenerateTriangles} triángulos de área nula.`,
      });
    }
  }
  if (patterns.length > 0 && selected.length === 0) {
    findings.push({
      code: "SELECCION_VACIA",
      part: null,
      message: `la selección (${patterns.join(", ")}) no coincide con ninguna pieza.`,
    });
  }

  // El presupuesto se comprueba contra el modelo entero. Las cláusulas de topología
  // exigen auditar las 296 piezas, que en el dron son 1,2 s frente a los 0,16 s de
  // una consulta, así que ese recorrido solo se hace si alguna está en el contrato.
  const budget = options.budget;
  if (budget) {
    const needsFullAudit =
      budget.watertight === true ||
      budget.boundaryEdges !== undefined ||
      budget.degenerateTriangles !== undefined ||
      budget.symmetryError !== undefined ||
      (budget.volumes?.length ?? 0) > 0;
    const contractAudits: ObjectReport[] = needsFullAudit
      ? model.parts.map((part) => ({ name: part.name, ...audit(part.mesh) }))
      : [];
    findings.push(
      ...checkBudget(budget, { parts: model.parts.length, triangles }, contractAudits),
    );
  }

  // La auditoría entre piezas mira el modelo entero, no la selección: una pieza
  // metida dentro de otra lo está aunque el agente esté trabajando en otra rama.
  const spatial = auditSpatial(
    model.parts.map((part) => ({
      name: part.name,
      path: part.path,
      mesh: part.mesh,
      model: part.matrix,
    })),
  );
  findings.push(...spatialWarnings(spatial));

  // Extensión real de la caja, no el diámetro de la esfera envolvente repetido tres
  // veces, que es lo que decía antes: un dron de 1,7 m de envergadura y 25 cm de alto
  // salía como un cubo de 12,9 m de lado, y sobre eso no se puede juzgar una escala.
  const aabb = computeSceneAabb(modelNodes);
  const size: [number, number, number] = [
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  ];
  findings.push(...checkScale(size, options.expectSize));
  const warnings = withSeverity(findings);

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
        where: options.selectWhere ?? null,
        matched: selected.map((part) => part.name),
        audits,
      },
      sheet: sheet ? sheetReport(sheet) : null,
      partScreenBoxes: sheet ? screenBoxes(boxSources(audited), sheet) : null,
      spatial,
      renderHash: sheet ? hashSheet(sheet) : null,
      // La atribución mira todas las piezas aunque solo se publiquen las auditadas:
      // el cambio interesante suele estar justo fuera de la selección.
      diff:
        sheet && options.baseline
          ? diffSheets(sheet, options.baseline, screenBoxes(boxSources(model.parts), sheet))
          : null,
      views: sheet ? viewReports(sheet) : [],
      loaderNotes: model.notes,
      warnings,
      warningsDelta: options.baselineWarnings
        ? compareWarnings(warnings, options.baselineWarnings)
        : null,
    },
  };
}

/** Una pieza del modelo vista como fuente de caja: el nombre y su malla colocada. */
function boxSources(parts: readonly ModelPart[]): Array<{ name: string; mesh: Mesh; model: Mat4 }> {
  return parts.map((part) => ({ name: part.name, mesh: part.mesh, model: part.matrix }));
}

/**
 * Cajas en pantalla de cada pieza, vista por vista, ya trasladadas a la rejilla del
 * pliego. Ocho proyecciones por pieza y vista: con doce piezas auditadas son 576
 * multiplicaciones de matriz, ruido frente al render.
 */
function screenBoxes(
  parts: readonly (Pick<SceneNode, "mesh" | "model"> & { name: string })[],
  sheet: ContactSheet,
): ScreenBoxes {
  const boxes: ScreenBoxes = {};
  for (const view of sheet.views) {
    const byPart: Record<string, [number, number, number, number]> = {};
    for (const part of parts) {
      const box = projectAabbToTile(
        computeSceneAabb([part]),
        view.camera,
        sheet.tileSize,
      );
      if (!box) continue;
      const offsetX = view.column * sheet.tileSize;
      const offsetY = view.row * sheet.tileSize;
      byPart[part.name] = [
        box[0] + offsetX,
        box[1] + offsetY,
        box[2] + offsetX,
        box[3] + offsetY,
      ];
    }
    boxes[view.name] = byPart;
  }
  return boxes;
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
