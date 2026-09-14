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

import { buildTriangleBoundsTree, raycast, type TriangleBoundsTree } from "../boundsTree";
import { auditMesh, type MeshAudit } from "../inspect";
import type { Mesh } from "../../mesh";
import { diffMeshes, type MeshDiff } from "../reconstruction/meshDiff";
import { evaluateBudgets, type BudgetResult, type DeclaredBudget } from "../reconstruction/budgets";
import { sampleMesh } from "../reconstruction/surfaceSampling";

/** Muestras con las que se juzga la contención. */
export const CONTAINMENT_SAMPLES = 4_000;

/**
 * Cuánto se separa la muestra antes de lanzar el rayo, relativo a la coordenada.
 * El mismo suelo que la cobertura, y por el mismo motivo: por debajo de la
 * rejilla de `Float32` separar no separa.
 */
export const CONTAINMENT_OFFSET = 2.3e-7;

export type ProductionRole = "MASTER" | "LOD" | "COLLISION";

export interface ProductionArtifact {
  id: string;
  role: ProductionRole;
  level?: number;
  sha256: string;
}

export interface ProductionMeasurement extends MeshAudit {
  appliesTo: { artifactId: string; sha256: string };
  role: ProductionRole;
  level?: number;
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
   * Contra el tope del destino, si lo declaró. `NO_JUZGADO` cuando no: lo que un
   * LOD puede perder depende de a qué distancia se mira, y no hay defecto que
   * valga para todos.
   */
  verdict: "PASS" | "FAIL" | "NO_JUZGADO";
}

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
      lodDeviationMax?: number;
    };
    artifacts?: ProductionArtifact[];
  };
  /** Las mallas ya leídas, por identidad de artifact. */
  meshes: ReadonlyMap<string, Mesh>;
  samples?: number;
  seed?: number;
}

/**
 * ¿Está el punto dentro de la malla cerrada?
 *
 * Paridad de cruces a lo largo de un rayo fijo. **Fijo y no aleatorio**: la
 * dirección tiene que ser la misma en dos ejecuciones, o el mismo asset daría dos
 * informes. Se avanza un pelo más allá de cada choque para no volver a contar el
 * mismo triángulo.
 */
function inside(tree: TriangleBoundsTree, point: readonly number[], offset: number): boolean {
  // Una dirección que no es paralela a ningún eje: con (1,0,0) sobre una caja
  // alineada, el rayo roza aristas y la paridad se vuelve una moneda.
  const direction = [0.577350269, 0.5773502692, 0.5773502694];
  let crossings = 0;
  let travelled = 0;
  for (let step = 0; step < 64; step += 1) {
    const origin = [
      point[0] + direction[0] * travelled,
      point[1] + direction[1] * travelled,
      point[2] + direction[2] * travelled,
    ];
    const hit = raycast(tree, origin, direction);
    if (hit === null) break;
    crossings += 1;
    travelled += hit.distance + offset;
  }
  return crossings % 2 === 1;
}

export function buildProductionReport(input: ProductionInput): ProductionReport {
  const { manifest, meshes } = input;
  const artifacts = manifest.artifacts ?? [];
  const issues: Array<{ reason: string; message: string }> = [];

  const measurements: ProductionMeasurement[] = [];
  for (const artifact of artifacts) {
    const mesh = meshes.get(artifact.id);
    if (mesh === undefined) continue;
    measurements.push({
      appliesTo: { artifactId: artifact.id, sha256: artifact.sha256 },
      role: artifact.role,
      ...(artifact.level === undefined ? {} : { level: artifact.level }),
      ...auditMesh(mesh),
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
      const tope = manifest.target?.lodDeviationMax;
      lods.push({
        artifactId: artifact.id,
        level: artifact.level,
        deviation,
        worstRelative,
        worstDirection: falta >= sobra ? "FALTA_EN_EL_LOD" : "SOBRA_EN_EL_LOD",
        triangleRatio: masterTriangles === 0 ? 0 : triangles / masterTriangles,
        verdict: tope === undefined ? "NO_JUZGADO" : worstRelative <= tope ? "PASS" : "FAIL",
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
      const tree = buildTriangleBoundsTree(proxy);
      const samples = input.samples ?? CONTAINMENT_SAMPLES;
      const set = sampleMesh(master, samples, input.seed ?? 1);
      let magnitude = 0;
      for (let index = 0; index < master.positions.length; index += 1) {
        magnitude = Math.max(magnitude, Math.abs(master.positions[index]));
      }
      const offset = CONTAINMENT_OFFSET * (magnitude || 1);

      let fuera = 0;
      let peor = 0;
      for (let sample = 0; sample < set.count; sample += 1) {
        const point = [set.points[sample * 3], set.points[sample * 3 + 1], set.points[sample * 3 + 2]];
        if (inside(tree, point, offset)) continue;
        fuera += 1;
        // Cuánto asoma: la distancia al proxy más cercano. Sale de un rayo hacia
        // dentro por la normal, que es la dirección en la que el proxy debería
        // estar si estuviera donde toca.
        const normal = [
          set.normals[sample * 3],
          set.normals[sample * 3 + 1],
          set.normals[sample * 3 + 2],
        ];
        const hit = raycast(tree, point, [-normal[0], -normal[1], -normal[2]]);
        if (hit !== null) peor = Math.max(peor, hit.distance);
      }

      const protrudingRatio = set.count === 0 ? 0 : fuera / set.count;
      // **Cero por defecto, y ese defecto se puede defender**: un proxy que no
      // contiene la pieza deja que la atraviesen por ahí. La tolerancia existe
      // para cuando asomar es a propósito, y entonces se declara.
      const tolerance = manifest.target?.collisionTolerance ?? 0;
      collision = {
        artifactId: collisionArtifact.id,
        ran: true,
        samples: set.count,
        protrudingRatio,
        worstProtrusionRelative: diagonal === 0 ? 0 : peor / diagonal,
        triangleRatio:
          master.indices.length === 0 ? 0 : proxy.indices.length / master.indices.length,
        tolerance,
        verdict: protrudingRatio <= tolerance ? "PASS" : "FAIL",
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

  let certification: ProductionReport["certification"] = "PASS";
  let reason: string | undefined;
  if (issues.length > 0) {
    certification = "FAIL";
    reason = issues[0].reason;
  } else if (collision?.verdict === "FAIL") {
    certification = "FAIL";
    reason = "LA_MAESTRA_ASOMA_DE_LA_COLISION";
  } else if (lods.some((lod) => lod.verdict === "FAIL")) {
    certification = "FAIL";
    reason = "LOD_FUERA_DE_TOLERANCIA";
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
    issues,
  };
}
