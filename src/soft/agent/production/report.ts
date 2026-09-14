/**
 * R11 — el informe de un asset de producción.
 *
 * La puerta del escalón pide poco y lo pide bien: **que un paquete de producción
 * se pueda inspeccionar**. Lo que hace falta para que eso signifique algo son las
 * tres preguntas que un asset publicable tiene y una reconstrucción no:
 *
 * ```text
 * ¿cada LOD sigue siendo la misma pieza?    desviación contra la maestra
 * ¿la colisión contiene de verdad?          cuánta maestra se sale del proxy
 * ¿cabe en el destino?                      los presupuestos del preset
 * ```
 *
 * ## Un LOD tiene que diferir, así que la desviación no es el defecto
 *
 * Es el presupuesto. El número va en **las dos direcciones y sin promediar**,
 * igual que en R5: lo que el LOD perdió de la maestra y lo que le añadió son dos
 * problemas distintos, y una simplificación que infla no se arregla como una que
 * come. Promediarlos daría un número que no describe ninguno de los dos.
 *
 * ## Y la colisión no se mide con una distancia
 *
 * Con una distancia, un proxy que envuelve la pieza holgadamente y otro que la
 * corta por la mitad pueden dar el mismo máximo. Lo que importa de un proxy es
 * **de qué lado queda la superficie**: si la maestra asoma, los objetos la
 * atraviesan por ahí. Así que se cuenta paridad de cruces —cuántas veces un rayo
 * desde la muestra sale del proxy— y se publica **qué fracción de la maestra
 * queda fuera**, que es lo que el motor va a sufrir.
 *
 * Eso exige que el proxy esté **cerrado**. Con una malla abierta, «dentro» no
 * está definido, y la comprobación se declara no ejecutada con su motivo en vez
 * de devolver un número que parecería una respuesta.
 */

import { auditMesh, type MeshAudit } from "../inspect";
import type { Mesh } from "../../mesh";
import { diffMeshes, type MeshDiff } from "../reconstruction/meshDiff";
import { evaluateBudgets, type BudgetResult, type DeclaredBudget } from "../reconstruction/budgets";
import { compareSilhouettes, type SilhouetteComparison } from "./silhouette";
import { assessCollision, type CollisionQuality } from "./collision";
import { auditUvs, type UvAudit } from "./uv";
import {
  auditMaterials,
  auditTexture,
  type DeclaredMaterial,
  type MaterialIssue,
  type TextureAudit,
  type TextureImage,
  type TextureUsage,
} from "./texture";

/** Muestras con las que se juzga la contención. */
export const CONTAINMENT_SAMPLES = 4_000;

/**
 * Cuánto se separa la muestra antes de lanzar el rayo, relativo a la coordenada.
 * El mismo suelo que la cobertura, y por el mismo motivo: por debajo de la
 * rejilla de `Float32` separar no separa.
 */
export const CONTAINMENT_OFFSET = 2.3e-7;

export type ProductionRole = "MASTER" | "LOD" | "COLLISION" | "TEXTURE";

export interface ProductionArtifact {
  id: string;
  role: ProductionRole;
  level?: number;
  /** Qué canal alimenta la imagen. Solo con `role: TEXTURE`. */
  usage?: TextureUsage;
  sha256: string;
}

export interface ProductionMeasurement extends MeshAudit {
  appliesTo: { artifactId: string; sha256: string };
  role: ProductionRole;
  level?: number;
  /** R13: las coordenadas de textura, o por qué no se pudieron auditar. */
  uv: UvAudit;
  /** Un veredicto por criterio de UV, contra lo que el destino declare. */
  uvVerdicts: { present: LodVerdict; overlap: LodVerdict; density: LodVerdict; outside: LodVerdict };
  /**
   * Densidad en **téxeles** por unidad de mundo, cuando un material ata esta
   * malla a una textura de color. Ausente si no lo hace: sin saber cuánto mide la
   * imagen, la densidad solo es relativa a sí misma.
   */
  texelDensity?: { median: number; p05: number; textureSide: number };
}

export interface LodDerivation {
  artifactId: string;
  level: number;
  /** La desviación contra la maestra, en las dos direcciones y sin promediar. */
  deviation: MeshDiff;
  /** La peor de las dos, en fracción de la diagonal: el número que se presupuesta. */
  worstRelative: number;
  /** Qué dirección manda: lo que falta o lo que sobra. */
  worstDirection: "FALTA_EN_EL_LOD" | "SOBRA_EN_EL_LOD";
  /** Cuánto se ahorra, que es para lo que existe un LOD. */
  triangleRatio: number;
  /**
   * R12: la silueta, medida en píxeles desde catorce vistas. Es lo que la
   * distancia de superficie no puede contestar — el 2 % dentro de una pared no
   * se ve y el mismo 2 % contra el cielo sí.
   */
  silhouette: SilhouetteComparison;
  /** Desviación de normales en grados, de la comparación de superficie. */
  normalDeviationDegrees: { maximum: number; mean: number };
  /**
   * Cuánto se mueve la caja envolvente, en fracción de la diagonal. Es barato y
   * dice algo que ninguna media dice: un LOD que encoge la pieza entera falla
   * aquí aunque su desviación media sea pequeña.
   */
  boundsDeltaRelative: number;
  /**
   * Un veredicto **por criterio**, contra el tope que el destino declare.
   * `NO_JUZGADO` cuando no lo declara: lo que un LOD puede perder depende de a
   * qué distancia se mira, y no hay defecto que valga para todos.
   */
  verdicts: {
    surface: LodVerdict;
    silhouette: LodVerdict;
    normal: LodVerdict;
    bounds: LodVerdict;
  };
}

export type LodVerdict = "PASS" | "FAIL" | "NO_JUZGADO";

export interface CollisionCheck {
  artifactId: string;
  /** Si se pudo comprobar. Sin proxy cerrado, «dentro» no está definido. */
  ran: boolean;
  reason?: string;
  samples?: number;
  /** Fracción de la superficie maestra que queda **fuera** del proxy. */
  protrudingRatio?: number;
  /** Cuánto asoma la peor muestra, en fracción de la diagonal. */
  worstProtrusionRelative?: number;
  /** Triángulos del proxy entre los de la maestra: un proxy más caro no es proxy. */
  triangleRatio?: number;
  /** La tolerancia que se aplicó, publicada porque el veredicto depende de ella. */
  tolerance?: number;
  verdict?: "PASS" | "FAIL";
  /** R14: lo que un proxy es además de contener. Ausente si no se pudo medir. */
  quality?: CollisionQuality;
  /** Qué criterio suspendió, cuando suspende. */
  reasonDetail?: string;
}

export interface ProductionReport {
  documentType: "softsight.production-report";
  contractVersion: string;
  assetId: string;
  execution: "COMPLETE" | "ERROR";
  certification: "PASS" | "FAIL" | "INCONCLUSIVE";
  certificationReason?: string;
  target: { preset: string };
  boundingBoxDiagonal: number;
  measurements: ProductionMeasurement[];
  lods: LodDerivation[];
  collision?: CollisionCheck;
  budgets: BudgetResult[];
  /** R13: una entrada por imagen declarada. Vacío si el asset no trae texturas. */
  textures: TextureAudit[];
  /** R13: lo que los materiales se contradicen diciendo. Sin abrir una imagen. */
  materialIssues: MaterialIssue[];
  issues: Array<{ reason: string; message: string }>;
}

export interface ProductionInput {
  manifest: {
    contractVersion?: string;
    assetId?: string;
    target?: {
      preset?: string;
      budgets?: Array<DeclaredBudget & { role?: ProductionRole }>;
      collisionTolerance?: number;
      collisionSlackMax?: number;
      collisionSlackTolerance?: number;
      collisionConvexTolerance?: number;
      collisionRequireConvex?: boolean;
      collisionVolumeRatioMax?: number;
      lodDeviationMax?: number;
      textureMaxSize?: number;
      texturePowerOfTwo?: boolean;
      texelDensityMin?: number;
      uvRequired?: boolean;
      uvOverlapMax?: number;
      uvDensitySpreadMax?: number;
      uvOutsideMax?: number;
      lodSilhouetteMax?: number;
      lodNormalMaxDegrees?: number;
      lodBoundsMax?: number;
    };
    artifacts?: ProductionArtifact[];
    materials?: DeclaredMaterial[];
  };
  /** Las mallas ya leídas, por identidad de artifact. */
  meshes: ReadonlyMap<string, Mesh>;
  /** Las imágenes ya decodificadas, por identidad de artifact. El IO vive fuera. */
  images?: ReadonlyMap<string, TextureImage>;
  /**
   * Si cada malla traía coordenadas de textura, leído de donde todavía se
   * distingue. Sin esto, «sin UV» y «todas las UV en cero» serían el mismo array.
   */
  uvPresence?: ReadonlyMap<string, boolean>;
  samples?: number;
  seed?: number;
}

export function buildProductionReport(input: ProductionInput): ProductionReport {
  const { manifest, meshes } = input;
  const artifacts = manifest.artifacts ?? [];
  const issues: Array<{ reason: string; message: string }> = [];

  /**
   * Un criterio de UV contra su tope. Sin medida **no se aprueba**: el término se
   * entiende y el dato falta, que es lo que deja un veredicto inconcluso y no
   * intacto — la misma distinción que los presupuestos de R9.
   */
  const juzgarUv = (valor: number | undefined, tope: number | undefined): LodVerdict => {
    if (tope === undefined) return "NO_JUZGADO";
    if (valor === undefined) return "FAIL";
    return valor <= tope ? "PASS" : "FAIL";
  };

  const measurements: ProductionMeasurement[] = [];
  for (const artifact of artifacts) {
    // Una textura no es una malla y no se mide como tal. Va aparte, abajo.
    if (artifact.role === "TEXTURE") continue;
    const mesh = meshes.get(artifact.id);
    if (mesh === undefined) continue;
    const uv = auditUvs(mesh, input.uvPresence?.get(artifact.id) === true);
    const uvVertices = mesh.uvs.length / 2;
    measurements.push({
      appliesTo: { artifactId: artifact.id, sha256: artifact.sha256 },
      role: artifact.role,
      ...(artifact.level === undefined ? {} : { level: artifact.level }),
      ...auditMesh(mesh),
      uv,
      uvVerdicts: {
        // La colisión no se pinta, así que exigirle UV sería exigirle algo que
        // no usa. Es el único sitio donde el papel cambia qué se le pide.
        present:
          manifest.target?.uvRequired !== true || artifact.role === "COLLISION"
            ? "NO_JUZGADO"
            : uv.present
              ? "PASS"
              : "FAIL",
        overlap: juzgarUv(uv.overlapRatio, manifest.target?.uvOverlapMax),
        density: juzgarUv(uv.texelDensity?.spread, manifest.target?.uvDensitySpreadMax),
        outside: juzgarUv(
          uv.outsideUnitSquare === undefined || uvVertices === 0
            ? undefined
            : uv.outsideUnitSquare / uvVertices,
          manifest.target?.uvOutsideMax,
        ),
      },
    });
  }

  // La caja de todo lo que se publica, que es el denominador de lo relativo (D9).
  let diagonal = 0;
  {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const measurement of measurements) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], measurement.boundingBoxMin[axis]);
        max[axis] = Math.max(max[axis], measurement.boundingBoxMax[axis]);
      }
    }
    if (Number.isFinite(min[0])) {
      diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    }
  }

  const masters = artifacts.filter((artifact) => artifact.role === "MASTER");
  if (masters.length !== 1) {
    issues.push({
      reason: "MAESTRA_NO_UNICA",
      message: `el asset declara ${masters.length} mallas MASTER y tiene que declarar exactamente una`,
    });
  }
  const master = masters[0] === undefined ? undefined : meshes.get(masters[0].id);

  // Los LOD, ordenados por nivel. El orden es del dato, no del manifest: dos
  // productores que los escriban al revés tienen que dar el mismo informe.
  const lodArtifacts = artifacts
    .filter((artifact) => artifact.role === "LOD")
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.id.localeCompare(b.id));

  const niveles = new Set<number>();
  for (const artifact of lodArtifacts) {
    if (artifact.level === undefined) {
      issues.push({ reason: "LOD_SIN_NIVEL", message: `${artifact.id}: un LOD sin nivel no se puede ordenar` });
      continue;
    }
    if (niveles.has(artifact.level)) {
      issues.push({
        reason: "NIVEL_DE_LOD_REPETIDO",
        message: `${artifact.id}: el nivel ${artifact.level} ya está declarado`,
      });
    }
    niveles.add(artifact.level);
  }

  const lods: LodDerivation[] = [];
  if (master !== undefined) {
    const masterTriangles = master.indices.length / 3;
    let anterior = masterTriangles;
    for (const artifact of lodArtifacts) {
      const mesh = meshes.get(artifact.id);
      if (mesh === undefined || artifact.level === undefined) continue;
      const triangles = mesh.indices.length / 3;

      // **Monotonía.** Un LOD-2 con más triángulos que el LOD-1 no es un nivel de
      // detalle: es un fichero mal etiquetado, y el motor lo cargará creyendo que
      // ahorra. Se comprueba contra el anterior y no contra la maestra, que es lo
      // que hace la cadena entera coherente.
      if (triangles >= anterior) {
        issues.push({
          reason: "LOD_NO_SIMPLIFICA",
          message:
            `${artifact.id} (nivel ${artifact.level}): ${triangles} triángulos, y el anterior tenía ` +
            `${anterior}. Un nivel de detalle que no baja no ahorra nada`,
        });
      }
      anterior = triangles;

      const deviation = diffMeshes(master, mesh, {
        samples: input.samples ?? CONTAINMENT_SAMPLES,
        seed: input.seed ?? 1,
      });
      const falta = deviation.aToB.maximum;
      const sobra = deviation.bToA.maximum;
      const worstRelative = Math.max(falta, sobra) / (deviation.boundingBoxDiagonal || 1);
      const silhouette = compareSilhouettes(master, mesh);
      const peorSilueta = Math.max(
        silhouette.worstMissing.missingRatio,
        silhouette.worstExtra.extraRatio,
      );

      // La caja, componente a componente. El máximo y no la media: encoger la
      // pieza por un lado es el defecto, y promediarlo con los cinco lados que no
      // se movieron lo escondería.
      const masterAudit = measurements.find(
        (measurement) => measurement.appliesTo.artifactId === masters[0]?.id,
      );
      const lodAudit = measurements.find(
        (measurement) => measurement.appliesTo.artifactId === artifact.id,
      );
      let boundsDelta = 0;
      if (masterAudit !== undefined && lodAudit !== undefined) {
        for (let axis = 0; axis < 3; axis += 1) {
          boundsDelta = Math.max(
            boundsDelta,
            Math.abs(masterAudit.boundingBoxMin[axis] - lodAudit.boundingBoxMin[axis]),
            Math.abs(masterAudit.boundingBoxMax[axis] - lodAudit.boundingBoxMax[axis]),
          );
        }
      }
      const boundsDeltaRelative = boundsDelta / (deviation.boundingBoxDiagonal || 1);

      const juzgar = (valor: number, tope: number | undefined): LodVerdict =>
        tope === undefined ? "NO_JUZGADO" : valor <= tope ? "PASS" : "FAIL";

      lods.push({
        artifactId: artifact.id,
        level: artifact.level,
        deviation,
        worstRelative,
        worstDirection: falta >= sobra ? "FALTA_EN_EL_LOD" : "SOBRA_EN_EL_LOD",
        triangleRatio: masterTriangles === 0 ? 0 : triangles / masterTriangles,
        silhouette,
        normalDeviationDegrees: {
          maximum: Math.max(
            deviation.aToB.normalDeviationDegrees.maximum,
            deviation.bToA.normalDeviationDegrees.maximum,
          ),
          mean: Math.max(
            deviation.aToB.normalDeviationDegrees.mean,
            deviation.bToA.normalDeviationDegrees.mean,
          ),
        },
        boundsDeltaRelative,
        verdicts: {
          surface: juzgar(worstRelative, manifest.target?.lodDeviationMax),
          silhouette: juzgar(peorSilueta, manifest.target?.lodSilhouetteMax),
          // Por la **media** y no por el máximo: con geometría de cajas, el punto
          // más próximo a una muestra cae a veces en una cara perpendicular y el
          // máximo sale 90° sin que nada esté mal. El informe publica los dos.
          normal: juzgar(
            Math.max(
              deviation.aToB.normalDeviationDegrees.mean,
              deviation.bToA.normalDeviationDegrees.mean,
            ),
            manifest.target?.lodNormalMaxDegrees,
          ),
          bounds: juzgar(boundsDeltaRelative, manifest.target?.lodBoundsMax),
        },
      });
    }
  }

  // La colisión.
  let collision: CollisionCheck | undefined;
  const collisionArtifact = artifacts.find((artifact) => artifact.role === "COLLISION");
  if (collisionArtifact !== undefined) {
    const proxy = meshes.get(collisionArtifact.id);
    const medida = measurements.find(
      (measurement) => measurement.appliesTo.artifactId === collisionArtifact.id,
    );
    if (proxy === undefined || master === undefined) {
      collision = { artifactId: collisionArtifact.id, ran: false, reason: "FALTA_MALLA_QUE_COMPARAR" };
    } else if (medida?.watertight !== true) {
      // Sin proxy cerrado **«dentro» no está definido**, y un número aquí
      // parecería una respuesta.
      collision = { artifactId: collisionArtifact.id, ran: false, reason: "PROXY_NO_CERRADO" };
    } else {
      const masterAudit = measurements.find(
        (measurement) => measurement.appliesTo.artifactId === masters[0]?.id,
      );
      const quality = assessCollision({
        master,
        proxy,
        masterAudit: masterAudit!,
        proxyAudit: medida,
        diagonal,
        samples: input.samples ?? CONTAINMENT_SAMPLES,
        seed: input.seed,
        slackTolerance: manifest.target?.collisionSlackTolerance,
        convexTolerance: manifest.target?.collisionConvexTolerance,
      });

      // **Cero por defecto, y ese defecto se puede defender**: un proxy que no
      // contiene la pieza deja que la atraviesen por ahí. La tolerancia existe
      // para cuando asomar es a propósito, y entonces se declara.
      const tolerance = manifest.target?.collisionTolerance ?? 0;
      // Los cuatro criterios, en orden de daño. Atravesar la pieza se ve y se
      // sufre; chocar con el aire se sufre y no se ve; un proxy cóncavo cuesta
      // en cada fotograma y no se nota hasta que el motor va lento.
      let detalle: string | undefined;
      if (quality.protrudingRatio > tolerance) detalle = "LA_MAESTRA_ASOMA_DE_LA_COLISION";
      else if (
        manifest.target?.collisionRequireConvex === true &&
        !quality.convexity.convex
      ) {
        detalle = "PROXY_NO_CONVEXO";
      } else if (
        manifest.target?.collisionSlackMax !== undefined &&
        quality.slackRatio > manifest.target.collisionSlackMax
      ) {
        detalle = "PROXY_DEMASIADO_HOLGADO";
      } else if (
        manifest.target?.collisionVolumeRatioMax !== undefined &&
        quality.volumeRatio > manifest.target.collisionVolumeRatioMax
      ) {
        detalle = "PROXY_DEMASIADO_VOLUMINOSO";
      }

      collision = {
        artifactId: collisionArtifact.id,
        ran: true,
        samples: quality.samples,
        protrudingRatio: quality.protrudingRatio,
        worstProtrusionRelative: quality.worstProtrusionRelative,
        triangleRatio: quality.triangleRatio,
        tolerance,
        quality,
        verdict: detalle === undefined ? "PASS" : "FAIL",
        ...(detalle === undefined ? {} : { reasonDetail: detalle }),
      };
    }
  }

  // Los presupuestos del destino, por papel. Se agrupan y se llama al mismo
  // evaluador de R9: un segundo evaluador aquí sería un segundo vocabulario, y el
  // día que discreparan el productor no sabría cuál le juzga.
  const declared = manifest.target?.budgets ?? [];
  const budgets: BudgetResult[] = [];
  for (const budget of declared) {
    const alcance =
      budget.role === undefined
        ? measurements
        : measurements.filter((measurement) => measurement.role === budget.role);
    const [resultado] = evaluateBudgets([budget], { measurements: alcance });
    budgets.push({ ...resultado, name: budget.role === undefined ? budget.name : `${budget.name}@${budget.role}` });
  }

  // R13: las imágenes declaradas, y lo que los materiales se contradicen.
  const textures: TextureAudit[] = [];
  for (const artifact of artifacts) {
    if (artifact.role !== "TEXTURE") continue;
    const image = input.images?.get(artifact.id);
    if (image === undefined || artifact.usage === undefined) continue;
    textures.push(auditTexture(artifact.id, artifact.usage as TextureUsage, image));
  }

  const materialIssues = auditMaterials(manifest.materials ?? [], {
    roles: new Map(artifacts.map((artifact) => [artifact.id, artifact.role])),
    uvPresence: new Map(
      measurements.map((medida) => [medida.appliesTo.artifactId, medida.uv.present]),
    ),
    outsideUnitSquare: new Map(
      measurements.map((medida) => [medida.appliesTo.artifactId, medida.uv.outsideUnitSquare ?? 0]),
    ),
  });

  // **La densidad de téxel de verdad**, ahora que se sabe cuánto mide la imagen.
  // La de la auditoría de UV es por unidad de mundo y solo compara una parte de
  // la pieza con otra; multiplicada por el lado de su textura, el número sale en
  // téxeles y se puede comparar con un destino.
  const texturaDe = new Map<string, TextureAudit>();
  for (const material of manifest.materials ?? []) {
    const baseColor = material.textures?.baseColor;
    if (baseColor === undefined) continue;
    const auditoria = textures.find((textura) => textura.artifactId === baseColor);
    if (auditoria === undefined) continue;
    for (const mallaId of material.appliesTo) texturaDe.set(mallaId, auditoria);
  }
  for (const medida of measurements) {
    const textura = texturaDe.get(medida.appliesTo.artifactId);
    if (textura === undefined || medida.uv.texelDensity === undefined) continue;
    medida.texelDensity = {
      median: medida.uv.texelDensity.median * textura.maxSide,
      p05: medida.uv.texelDensity.p05 * textura.maxSide,
      textureSide: textura.maxSide,
    };
    medida.uvVerdicts.density =
      manifest.target?.texelDensityMin === undefined
        ? medida.uvVerdicts.density
        : medida.texelDensity.p05 >= manifest.target.texelDensityMin
          ? medida.uvVerdicts.density === "FAIL"
            ? "FAIL"
            : "PASS"
          : "FAIL";
  }

  let certification: ProductionReport["certification"] = "PASS";
  let reason: string | undefined;
  if (issues.length > 0) {
    certification = "FAIL";
    reason = issues[0].reason;
  } else if (collision?.verdict === "FAIL") {
    certification = "FAIL";
    // El criterio que falló, no un «colisión mal» que obligue a buscarlo.
    reason = collision.reasonDetail ?? "LA_MAESTRA_ASOMA_DE_LA_COLISION";
  } else if (materialIssues.length > 0) {
    // Se contradice el manifest consigo mismo: no hace falta abrir nada.
    certification = "FAIL";
    reason = materialIssues[0].reason;
  } else if (
    manifest.target?.textureMaxSize !== undefined &&
    textures.some((textura) => textura.maxSide > manifest.target!.textureMaxSize!)
  ) {
    certification = "FAIL";
    reason = "TEXTURA_DEMASIADO_GRANDE";
  } else if (
    manifest.target?.texturePowerOfTwo === true &&
    textures.some((textura) => !textura.powerOfTwo)
  ) {
    certification = "FAIL";
    reason = "TEXTURA_NO_POTENCIA_DE_DOS";
  } else if (textures.some((textura) => textura.reason !== undefined)) {
    certification = "FAIL";
    reason = textures.find((textura) => textura.reason !== undefined)!.reason!;
  } else if (measurements.some((medida) => Object.values(medida.uvVerdicts).includes("FAIL"))) {
    certification = "FAIL";
    const culpable = measurements.find((medida) =>
      Object.values(medida.uvVerdicts).includes("FAIL"),
    )!;
    const criterio = (Object.keys(culpable.uvVerdicts) as Array<keyof typeof culpable.uvVerdicts>).find(
      (nombre) => culpable.uvVerdicts[nombre] === "FAIL",
    );
    reason = `UV_FUERA_DE_TOLERANCIA_${(criterio ?? "present").toUpperCase()}`;
  } else if (lods.some((lod) => Object.values(lod.verdicts).includes("FAIL"))) {
    certification = "FAIL";
    // El criterio que falló va en el motivo: «fuera de tolerancia» a secas
    // obligaría a buscar cuál de los cuatro.
    const culpable = lods.find((lod) => Object.values(lod.verdicts).includes("FAIL"))!;
    const criterio = (Object.keys(culpable.verdicts) as Array<keyof typeof culpable.verdicts>).find(
      (nombre) => culpable.verdicts[nombre] === "FAIL",
    );
    reason = `LOD_FUERA_DE_TOLERANCIA_${(criterio ?? "surface").toUpperCase()}`;
  } else if (budgets.some((budget) => budget.verdict === "FAIL")) {
    certification = "FAIL";
    reason = "PRESUPUESTO_EXCEDIDO";
  } else if (collision?.ran === false) {
    // Declarar una colisión que no se puede comprobar no es aprobar: es no saber.
    certification = "INCONCLUSIVE";
    reason = collision.reason;
  } else if (budgets.some((budget) => budget.reason === "METRICA_REQUERIDA_NO_DISPONIBLE")) {
    certification = "INCONCLUSIVE";
    reason = "METRICA_REQUERIDA_NO_DISPONIBLE";
  }

  return {
    documentType: "softsight.production-report",
    contractVersion: manifest.contractVersion ?? "0.0",
    assetId: manifest.assetId ?? "",
    execution: "COMPLETE",
    certification,
    ...(reason === undefined ? {} : { certificationReason: reason }),
    target: { preset: manifest.target?.preset ?? "" },
    boundingBoxDiagonal: diagonal,
    measurements,
    lods,
    ...(collision === undefined ? {} : { collision }),
    budgets,
    textures,
    materialIssues,
    issues,
  };
}
