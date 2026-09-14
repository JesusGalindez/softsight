/**
 * El sobre del informe de reconstrucción: `softsight.reconstruction-report`.
 *
 * Es el documento que cierra R0-A y la mitad que le faltaba a D7: **todo informe
 * apunta criptográficamente al artifact que evaluó** (P5). Aquí eso son tres
 * cosas juntas —`packageId`, `manifestSha256` y el hash de cada artifact medido—
 * y una regla: ninguna métrica se publica sin decir sobre qué corrió.
 *
 * Dos ejes, nunca uno (D3). `execution` dice si el trabajo se pudo hacer;
 * `certification` dice si lo medido cumple. Un paquete que no se puede leer no es
 * un paquete que falla: es un trabajo que no se hizo, y confundirlos convierte un
 * error de transporte en un veredicto sobre la geometría de alguien.
 *
 * **Sin reloj.** El informe no lleva la hora, y el `runId` sale del hash del
 * manifest y de la versión del informe. Un informe con marca de tiempo no se
 * puede comparar bit a bit consigo mismo, y la comparación bit a bit es lo que
 * D28 pide para todo lo que es frontera. La hora, cuando haga falta, la pone
 * quien lo archiva.
 */

import type { Mesh } from "../../mesh";
import type { MeshAudit } from "../inspect";
import type { ObjectSchema } from "../schema";
import { CONTRACT_VERSIONS, CURRENT_VERSION_PAIRS } from "../versions";
import type { PackageCamera } from "./camera";
import { resolveFrame, type Frame, type FrameTransform } from "./frameGraph";
import { CAPABILITY_POLICY, EXTENSION_POLICY, PACKAGE_CODES } from "./ingest";
import { PACKAGE_CODE_TABLE } from "./codes";
import { computeCoverage, computeVisibility, type Coverage, type SurfaceVisibility } from "./coverage";
import { analyzeMeshTopology, type MeshTopology } from "./meshTopology";
import { classifyRepairs, type RepairBoundary } from "./repair";
import { computeCaptureAdvice, type CaptureAdvice } from "./captureAdvice";
import { evaluateBudgets, type BudgetResult, type DeclaredBudget } from "./budgets";
import type { MaskSet } from "./masks";
import { computeConfidence, type Confidence } from "./confidence";
import type { IngestIssue, IngestResult } from "./ingest";
import { RESOURCE_LIMIT_LIST } from "./limits";

export type CertificationVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

/** Lo que se midió de una malla del paquete, con a qué artifact pertenece. */
export interface MeshMeasurement {
  artifactId: string;
  audit: MeshAudit;
  /** La malla misma, para cruzarla con las cámaras (R6). */
  mesh?: Mesh;
}

/**
 * Umbral por debajo del cual una fracción de superficie sin sostener no se
 * comenta.
 *
 * No es una tolerancia sobre la calidad: es el suelo del muestreo. Con veinte mil
 * muestras, una fracción del uno por mil son veinte puntos y su intervalo la
 * cruza entera, así que avisar de ella sería avisar de ruido. Por encima, el
 * aviso lleva su intervalo y quien lea decide.
 */
export const SUPPORT_WARNING_FLOOR = 0.01;

export interface ReportInput {
  manifest: Record<string, unknown>;
  /** Hash del manifest, calculado por quien lo leyó: el manifest no puede contenerlo. */
  manifestSha256: string;
  ingest: IngestResult;
  meshes: MeshMeasurement[];
  /** Versión de SoftSight que produce el informe. */
  softsightVersion: string;
  /**
   * Malla y cámaras para cruzar la superficie con la evidencia (R6). Las pasa
   * quien leyó el paquete: aquí no hay IO.
   */
  surface?: {
    mesh: Mesh;
    cameras: PackageCamera[];
    purelyReconstructed: boolean;
    samples?: number;
    /** Siluetas por identidad de cámara, si el paquete las declaró. */
    masks?: MaskSet;
    /**
     * La visibilidad ya calculada, si quien leyó el paquete la tenía guardada.
     *
     * La caché vive **fuera** de este módulo y no por gusto: aquí no hay IO, y
     * meter `node:fs` en `src/` rompería lo que hace que este código corra
     * también en el navegador. Lo que entra por aquí es el resultado, no la
     * política de cuándo vale.
     */
    visibility?: SurfaceVisibility;
  };
}

/**
 * Cuántas muestras lleva la superficie cuando nadie pide otra cosa.
 *
 * Se exporta porque **la caché tiene que poder nombrarla**: el muestreo entra en
 * la clave, y si quien la construye escribiera el número por su cuenta, el día
 * que este suba habría una clave que dice 8.000 sobre una medida de 16.000.
 */
export const DEFAULT_SURFACE_SAMPLES = 8_000;

/**
 * Qué certifica R0, que no estaba escrito en ninguna decisión.
 *
 * **Pendiente sin número**, según §1.6 del contrato: el registro está congelado y
 * esto no puede esperar porque D18 exige que `cube-v1` salga `COMPLETE + PASS`, y
 * sin criterio no hay veredicto. Va aquí, en el código que lo aplica, y en el
 * envío para que VideoMesh lo confirme o lo cambie.
 *
 * ```text
 * PASS           el paquete está íntegro, la evidencia requerida está,
 *                y toda malla declarada se lee y tiene superficie
 * INCONCLUSIVE   falta evidencia que el contrato pide, o no había nada que medir
 * FAIL           lo que se midió contradice lo que el paquete declara
 * ```
 *
 * **La calidad geométrica no decide el veredicto.** Una malla reconstruida con
 * agujeros es lo normal, no un fallo del paquete: se reporta —`boundaryEdges`,
 * `nonManifoldEdges`— y quien fije un umbral lo hará en producción, que es otro
 * documento. Certificar aquí «cerrada o FAIL» haría fallar a casi toda
 * reconstrucción real y empujaría a rellenar agujeros para pasar la puerta, que
 * es exactamente lo que `purelyReconstructed` existe para poder distinguir.
 *
 * Lo que sí es FAIL: que la malla contradiga al manifest. Un `TRIANGLE_MESH` sin
 * un solo triángulo es eso —el paquete dice que hay superficie y no la hay—, y
 * pasa por delante de cualquier métrica.
 */
export const CERTIFICATION_POLICY = "r0-integridad-y-coherencia" as const;

export interface ReconstructionReport {
  documentType: "softsight.reconstruction-report";
  contractVersion: string;
  execution: IngestResult["execution"];
  certification: CertificationVerdict;
  /**
   * Motivo canónico cuando el veredicto no es PASS. **Ausente** cuando lo es, no
   * `null`: un null desnudo es ambiguo (D17), y aquí «no hay motivo» y «el motivo
   * no se pudo determinar» son cosas distintas.
   */
  certificationReason?: string;
  certificationPolicy: string;
  /**
   * Los topes de recurso que rigieron. Publicados y no implícitos: un rechazo por
   * tamaño solo se puede reproducir si el informe dice contra qué número se
   * comparó, y un PASS que dependió de que algo cupiera también.
   */
  limits: Array<{ name: string; value: number; unit: string; rationale: string }>;
  /**
   * Qué se hizo con el espacio de extensiones (D30). Una opcional desconocida se
   * preserva y se nombra aquí: ignorarla en silencio deja al productor creyendo
   * que mandó algo que se usó.
   */
  extensions: { policy: string; honoured: string[]; ignored: string[] };
  /**
   * La negociación de D31. `supports` se publica siempre, también cuando el
   * paquete no pide nada: es lo que le dice al productor qué puede pedir la
   * próxima vez sin tener que probarlo.
   */
  capabilities: {
    policy: string;
    supports: string[];
    required: string[];
    provided: string[];
    unknownProvided: string[];
  };
  run: {
    runId: string;
    /** Ausente si el manifest no llegó a validar y no hay identidad que citar. */
    inputPackageId?: string;
    inputManifestSha256: string;
    /** Estado del consumo, que pertenece al run y nunca al paquete (D29). */
    status: "COMPLETE" | "ERROR" | "UNSUPPORTED";
  };
  /**
   * El bloque de D12: **todas** las versiones de contrato que rigieron, no un
   * campo suelto. Un consumidor que comprobara `reconstructionReport === "0.1"`
   * no se enteraría de que la auditoría de puesta en escena cambió debajo, porque
   * esa lleva su propio número y nada los relaciona. Lo que se compara es la
   * combinación, y una que nadie ha declarado no se acepta.
   *
   * `softsight` no es un contrato: es la versión del binario, y va aparte para
   * que no se confunda con lo que otro repositorio fija.
   */
  versions: { softsight: string; contracts: Array<{ name: string; value: number | string }> };
  evidence: {
    artifacts: Array<{ id: string; type: string; sha256: string; bytes: number }>;
    requiredEvidence: string[];
    missingEvidence: string[];
  };
  measurements: Array<{
    appliesTo: { artifactId: string; sha256: string };
    /** Provenance de la malla medida, del artifact y no del paquete (D21). */
    purelyReconstructed: boolean;
    vertices: number;
    triangles: number;
    degenerateTriangles: number;
    duplicatePositions: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    watertight: boolean;
    signedVolume: number;
    boundingBoxMin: [number, number, number];
    boundingBoxMax: [number, number, number];
    /**
     * En qué marco están estos números (D11). Es `RECONSTRUCTION` porque salen
     * del PLY, que viene en él; decirlo es lo que permite al consumidor saber
     * que una caja de aquí y una de producción **no se pueden comparar** sin
     * pasar por el grafo.
     */
    frame: "RECONSTRUCTION";
    /** Los dos ejes de D28: qué clase de medida es y con qué reproducibilidad. */
    measurementClass: "EXACT";
    reproducibility: "BITWISE_EXACT";
  }>;
  /**
   * El grafo de marcos que rigió (D11). No es una copia del manifest: `reachable`
   * es lo que se comprobó, y publicarlo evita que el consumidor tenga que
   * recorrer el grafo otra vez para saber si podía fiarse.
   */
  frames: { measuredIn: "RECONSTRUCTION"; declared: string[]; reachable: string[]; transforms: number };
  /**
   * La escala tal y como rigió, más lo que D9 exige que el informe diga de ella.
   *
   * No es una copia del manifest: `boundingBoxDiagonal` es el **denominador del
   * fallback** —con escala no absoluta, un presupuesto va en fracción de
   * diagonal—, y publicarlo es lo que permite al otro lado reproducir el número
   * en vez de recalcular una caja que podría no ser la misma.
   */
  /**
   * Qué parte de la superficie sostiene la evidencia, y desde dónde (R6).
   * **Ausente** cuando no hay malla o no hay cámaras: no es cero, es que la
   * pregunta no se puede hacer.
   */
  coverage?: Coverage;
  confidence?: Confidence;
  /** R9: desde dónde disparar la próxima foto. Ausente por lo mismo que los dos de arriba. */
  captureAdvice?: CaptureAdvice;
  /** R9: los presupuestos del paquete contra lo medido. Vacío si no declaró ninguno. */
  budgets: BudgetResult[];
  /** R10: qué se puede reparar sin inventar nada. Ausente si no hay malla medida. */
  repairBoundary?: RepairBoundary;
  scale: {
    status: string;
    source: string;
    uncertainty?: { model: string; value: number };
    /** Diagonal de la caja de todo lo medido; `null` si no se midió nada. */
    boundingBoxDiagonal: number | null;
    /**
     * Si este informe se permite hablar en unidades absolutas. Falso con escala
     * no absoluta o con la incertidumbre en `NONE`: reportar milímetros sobre una
     * escala que nadie fijó es la precisión que D9 prohíbe.
     */
    claimsAbsolutePrecision: boolean;
  };
  cameras: { declared: number; withImage: number };
  warnings: IngestIssue[];
}

/** La del registro, no un segundo número: el `runId` la lleva dentro. */
const REPORT_VERSION = CONTRACT_VERSIONS.reconstructionReport.value;

/**
 * `runId` determinista: mismo paquete y misma versión, mismo identificador. No es
 * un UUID a propósito —un identificador aleatorio haría que dos ejecuciones del
 * mismo trabajo produjeran documentos distintos y no se pudieran comparar—, y
 * quien necesite distinguir dos consumos del mismo paquete tiene el sitio donde
 * lo archiva para eso.
 */
function runIdFor(manifestSha256: string): string {
  return `run-${REPORT_VERSION}-${manifestSha256.slice(0, 16)}`;
}

/**
 * Diagonal de la caja que contiene todo lo medido.
 *
 * De la unión y no de la primera malla: un paquete con dos mallas tiene una sola
 * pieza, y usar la caja de una de ellas daría un denominador que cambia según el
 * orden en que vengan declaradas.
 */
function diagonalOf(measurements: ReconstructionReport["measurements"]): number | null {
  if (measurements.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const measurement of measurements) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], measurement.boundingBoxMin[axis]);
      max[axis] = Math.max(max[axis], measurement.boundingBoxMax[axis]);
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

export function buildReconstructionReport(input: ReportInput): ReconstructionReport {
  const { manifest, manifestSha256, ingest, meshes, softsightVersion } = input;
  const declared = (manifest.artifacts ?? []) as Array<Record<string, unknown>>;
  const required = (manifest.requiredEvidence ?? []) as string[];
  const admitted = new Set(ingest.artifacts.map((artifact) => artifact.id));
  const missing = required.filter((id) => !admitted.has(id));

  const transforms = ((manifest.frameGraph ?? {}) as { transforms?: FrameTransform[] }).transforms ?? [];
  // Ordenados para que el informe sea idéntico byte a byte entre dos ejecuciones:
  // el orden de un `Set` es el de inserción, y ése es el de escritura del grafo.
  const declaredFrames = [...new Set(transforms.flatMap((t) => [t.from, t.to]))].sort();
  const declaredScale = (manifest.scale ?? {}) as {
    status?: string;
    source?: string;
    uncertainty?: { model: string; value: number };
  };
  const cameras = (manifest.cameras ?? []) as Array<Record<string, unknown>>;
  const imageIds = new Set(
    declared.filter((artifact) => artifact.type === "IMAGE").map((artifact) => artifact.id as string),
  );

  // Mallas que el paquete **declara**, admitidas o no: es lo que separa «no había
  // nada que medir» de «no se pudo medir lo que había».
  const declaredMeshes = declared.filter((artifact) => artifact.type === "TRIANGLE_MESH").length;

  const provenanceOf = (artifactId: string): boolean =>
    declared.find((artifact) => artifact.id === artifactId)?.purelyReconstructed === true;

  const measurements = meshes.map((mesh) => ({
    appliesTo: {
      artifactId: mesh.artifactId,
      sha256: ingest.artifacts.find((artifact) => artifact.id === mesh.artifactId)?.sha256 ?? "",
    },
    purelyReconstructed: provenanceOf(mesh.artifactId),
    vertices: mesh.audit.vertices,
    triangles: mesh.audit.triangles,
    degenerateTriangles: mesh.audit.degenerateTriangles,
    duplicatePositions: mesh.audit.duplicatePositions,
    boundaryEdges: mesh.audit.boundaryEdges,
    nonManifoldEdges: mesh.audit.nonManifoldEdges,
    watertight: mesh.audit.watertight,
    signedVolume: mesh.audit.signedVolume,
    boundingBoxMin: mesh.audit.boundingBoxMin,
    boundingBoxMax: mesh.audit.boundingBoxMax,
    frame: "RECONSTRUCTION" as const,
    measurementClass: "EXACT" as const,
    reproducibility: "BITWISE_EXACT" as const,
  }));

  let certification: CertificationVerdict = "PASS";
  let reason: string | null = null;
  if (ingest.execution !== "COMPLETE") {
    // Sin paquete no hay nada sobre lo que opinar. No es FAIL: FAIL diría algo
    // sobre la geometría de alguien, y aquí no se ha medido nada (P2).
    certification = "INCONCLUSIVE";
    reason = "PAQUETE_NO_CONSUMIBLE";
  } else if (missing.length > 0) {
    certification = "INCONCLUSIVE";
    reason = "EVIDENCIA_INSUFICIENTE";
  } else if (declaredMeshes > 0 && measurements.length === 0) {
    // **Solo si el paquete declaraba una malla.** Antes bastaba con que no
    // hubiera medidas, y eso confunde las dos filas de D8: «falta evidencia que
    // el contrato pide» no es lo mismo que «el contrato no pidió nada que
    // medir». Una reconstrucción de SfM entrega nube de puntos y cámaras y no
    // promete superficie; declararla inconclusa por no tener malla es reprocharle
    // algo que nunca dijo.
    certification = "INCONCLUSIVE";
    reason = "METRICA_REQUERIDA_NO_DISPONIBLE";
  } else if (measurements.some((measurement) => measurement.triangles === 0)) {
    certification = "FAIL";
    reason = "MALLA_SIN_SUPERFICIE";
  }

  // R6 cruzado con R7: la superficie contra las cámaras. Solo cuando hay las dos
  // cosas — sin malla no hay qué cubrir y sin cámaras no hay con qué, y en los dos
  // casos el bloque se **omite** en vez de salir a cero, que diría otra cosa.
  let coverage: Coverage | undefined;
  let confidence: Confidence | undefined;
  let captureAdvice: CaptureAdvice | undefined;
  // La visibilidad y la topología se guardan para R10, que las necesita para
  // decir si un agujero cae donde alguien miró. **Solo de la malla que se cruzó
  // con las cámaras**: recorrer la topología de todas duplicaría la soldadura de
  // `auditMesh` sobre mallas que nadie va a cruzar con nada.
  let visibility: SurfaceVisibility | undefined;
  let topology: MeshTopology | undefined;
  const surfaceWarnings: IngestIssue[] = [];
  if (input.surface !== undefined && input.surface.cameras.length > 0) {
    const { mesh, cameras, purelyReconstructed } = input.surface;
    const samples = input.surface.samples ?? DEFAULT_SURFACE_SAMPLES;
    // Una sola pasada de visibilidad para las dos medidas: es el grueso del coste
    // y, sobre todo, dos recorridos darían dos fronteras que no se pueden cruzar.
    visibility =
      input.surface.visibility ??
      computeVisibility(mesh, cameras, { samples, masks: input.surface.masks });
    topology = analyzeMeshTopology(mesh);
    coverage = computeCoverage(mesh, cameras, { visibility, purelyReconstructed, samples });
    confidence = computeConfidence(mesh, cameras, { visibility, purelyReconstructed, samples });
    // R9 lee la misma visibilidad que las otras dos. No podría ser de otro modo:
    // un consejo calculado sobre otro muestreo aconsejaría cubrir una carencia
    // que el informe no publica.
    captureAdvice = computeCaptureAdvice(mesh, cameras, { visibility, samples });

    // Los avisos llevan sus números (§53). Uno que solo dijera «hay superficie sin
    // ver» obliga a recalcularlo para saber si es el 2 % o el 40 %, y a
    // recalcularlo con otro muestreo, que daría otro número.
    const avisar = (code: string, ratio: number, extra: Record<string, unknown>, texto: string) => {
      if (ratio <= SUPPORT_WARNING_FLOOR) return;
      surfaceWarnings.push({
        code,
        reason: PACKAGE_CODE_TABLE[code as keyof typeof PACKAGE_CODE_TABLE].reason,
        message: texto,
        evidence: { ratio, samples: coverage?.samples ?? samples, areaWeighted: true, ...extra },
      });
    };

    avisar(
      PACKAGE_CODES.SUPERFICIE_SIN_EVIDENCIA,
      coverage.unobservedAreaRatio,
      { interval: coverage.interval, certificationEligible: coverage.certificationEligible },
      `el ${(coverage.unobservedAreaRatio * 100).toFixed(1)} % de la superficie no la ve ninguna de ` +
        `las ${cameras.length} cámaras declaradas`,
    );
    avisar(
      PACKAGE_CODES.SUPERFICIE_SIN_TRIANGULAR,
      coverage.weakAreaRatio,
      { interval: coverage.interval },
      `el ${(coverage.weakAreaRatio * 100).toFixed(1)} % la ve una sola cámara: hay foto y no hay ` +
        "profundidad, porque triangular pide dos",
    );
    avisar(
      PACKAGE_CODES.PARALAJE_CORTO,
      confidence.byClass.PARALAJE_CORTO,
      {
        parallaxThresholdDegrees: confidence.parallaxThresholdDegrees,
        parallaxDegrees: confidence.parallaxDegrees,
      },
      `el ${(confidence.byClass.PARALAJE_CORTO * 100).toFixed(1)} % lo ven dos o más cámaras demasiado ` +
        `juntas: por debajo de ${confidence.parallaxThresholdDegrees}° un píxel de ruido mueve la ` +
        "profundidad mucho más que la superficie",
    );
  }

  // R10: la frontera de reparación, sobre la primera malla medida — la misma que
  // se cruzó con las cámaras. Ausente sin malla: sin superficie no hay defecto
  // que reparar, y una lista vacía diría que no hay ninguno.
  const repairBoundary =
    measurements.length === 0
      ? undefined
      : classifyRepairs({
          // La auditoría **cruda** y no la fila del informe: `inverted` y
          // `flippedNormalRatio` no se publican en `measurements`, y R10 los
          // necesita para separar «la malla entera está del revés» —que se
          // arregla sin mover un punto— de «unas caras discrepan», que decide
          // orientación en una región concreta.
          audit: meshes[0].audit,
          topology,
          visibility,
          diagonal: diagonalOf(measurements) ?? 1,
        });

  // R9: los presupuestos, ya con todo medido. Van **después** de la cobertura
  // porque tres de los términos salen de ella, y antes del veredicto porque lo
  // pueden mover.
  const budgets = evaluateBudgets((manifest.budgets ?? []) as DeclaredBudget[], {
    measurements,
    coverage,
    confidence,
  });

  // Un presupuesto excedido **suspende**: es el productor quien puso el límite, y
  // aprobar por encima de él convertiría el campo en decoración — que es lo que
  // era hasta hoy. Va al final y no antes: los INCONCLUSIVE de arriba ganan,
  // porque juzgar un presupuesto sobre un paquete que no se pudo leer sería
  // afirmar algo de una geometría que nadie ha medido.
  if (certification === "PASS") {
    if (budgets.some((budget) => budget.verdict === "FAIL")) {
      certification = "FAIL";
      reason = "PRESUPUESTO_EXCEDIDO";
    } else if (
      // El término se entiende y la medida falta: ni se aprueba ni se suspende.
      // Un término **desconocido** no llega aquí a propósito — suspender o dejar
      // inconcluso a quien usa un vocabulario más nuevo que el nuestro sería
      // castigarle por nuestra versión, la misma política que D30 elige para las
      // extensiones opcionales.
      budgets.some((budget) => budget.reason === "METRICA_REQUERIDA_NO_DISPONIBLE")
    ) {
      certification = "INCONCLUSIVE";
      reason = "METRICA_REQUERIDA_NO_DISPONIBLE";
    }
  }

  return {
    documentType: "softsight.reconstruction-report",
    contractVersion: (manifest.contractVersion as string) ?? "0.0",
    execution: ingest.execution,
    certification,
    ...(reason === null ? {} : { certificationReason: reason }),
    certificationPolicy: CERTIFICATION_POLICY,
    limits: RESOURCE_LIMIT_LIST.map((limit) => ({ ...limit })),
    extensions: {
      policy: EXTENSION_POLICY,
      honoured: [...ingest.extensions.honoured],
      ignored: [...ingest.extensions.ignored],
    },
    capabilities: {
      policy: CAPABILITY_POLICY,
      supports: [...ingest.capabilities.supports],
      required: [...ingest.capabilities.required],
      provided: [...ingest.capabilities.provided],
      unknownProvided: [...ingest.capabilities.unknownProvided],
    },
    run: {
      runId: runIdFor(manifestSha256),
      ...(ingest.packageId === null ? {} : { inputPackageId: ingest.packageId }),
      inputManifestSha256: manifestSha256,
      status: ingest.execution === "COMPLETE" ? "COMPLETE" : "ERROR",
    },
    versions: { softsight: softsightVersion, contracts: CURRENT_VERSION_PAIRS.map((pair) => ({ ...pair })) },
    evidence: {
      artifacts: ingest.artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
      })),
      requiredEvidence: required,
      missingEvidence: missing,
    },
    measurements,
    frames: {
      measuredIn: "RECONSTRUCTION",
      declared: declaredFrames,
      reachable: declaredFrames.filter(
        (frame) => resolveFrame(transforms, "RECONSTRUCTION", frame as Frame) !== null,
      ),
      transforms: transforms.length,
    },
    scale: {
      status: declaredScale.status ?? "UNKNOWN",
      source: declaredScale.source ?? "NONE",
      ...(declaredScale.uncertainty === undefined ? {} : { uncertainty: declaredScale.uncertainty }),
      boundingBoxDiagonal: diagonalOf(measurements),
      claimsAbsolutePrecision:
        declaredScale.status === "ABSOLUTE" &&
        declaredScale.uncertainty !== undefined &&
        declaredScale.uncertainty.model !== "NONE",
    },
    cameras: {
      declared: cameras.length,
      withImage: cameras.filter((camera) => imageIds.has(camera.imageArtifactId as string)).length,
    },
    ...(coverage === undefined ? {} : { coverage, confidence, captureAdvice }),
    budgets,
    ...(repairBoundary === undefined ? {} : { repairBoundary }),
    // Los de la superficie **detrás** de los de la ingesta: primero por qué el
    // paquete no se pudo leer, y solo después qué le falta a lo que sí se leyó.
    warnings: [...ingest.issues, ...surfaceWarnings],
  };
}

/**
 * La forma del informe, publicada como frontera igual que la del paquete: es el
 * documento que VideoMesh lee para saber si su paquete pasó, y leerlo a ojo no es
 * un contrato.
 */
export const RECONSTRUCTION_REPORT_SCHEMA: ObjectSchema = {
  documentType: {
    type: '"softsight.reconstruction-report"',
    required: true,
    description: "Qué documento es. El informe de producción es otro distinto (D14).",
  },
  contractVersion: {
    type: "string",
    required: true,
    description: "Versión del contrato del paquete que se evaluó.",
  },
  execution: {
    type: '"COMPLETE"|"PARTIAL"|"ERROR"|"UNSUPPORTED"',
    required: true,
    description: "Si el trabajo se pudo hacer. No dice nada sobre la geometría.",
  },
  certification: {
    type: '"PASS"|"FAIL"|"INCONCLUSIVE"',
    required: true,
    description: "Si lo medido cumple. Un eje aparte de la ejecución.",
  },
  certificationReason: {
    type: "string",
    description: "Motivo canónico cuando no es PASS; ausente cuando lo es.",
  },
  certificationPolicy: {
    type: "string",
    required: true,
    description: "Qué criterio se aplicó, para que un PASS de hoy y uno de mañana se puedan comparar.",
  },
  limits: {
    type: "object[]",
    required: true,
    description: "Topes de recurso aplicados, para que un rechazo por tamaño se pueda reproducir.",
    fields: {
      name: { type: "string", required: true, description: "Qué tope es." },
      value: { type: "number", required: true, description: "El número que rigió." },
      unit: { type: '"bytes"|"entradas"|"líneas"', required: true, description: "En qué se cuenta." },
      rationale: { type: "string", required: true, description: "Por qué ese número y no otro." },
    },
  },
  extensions: {
    type: "object",
    required: true,
    description: "Qué se hizo con el espacio de extensiones de D30, y con qué política.",
    fields: {
      policy: { type: "string", required: true, description: "Qué se hace con una opcional desconocida." },
      honoured: { type: "string[]", required: true, description: "Extensiones que este binario entiende." },
      ignored: {
        type: "string[]",
        required: true,
        description: "Opcionales desconocidas: preservadas en el paquete y nombradas aquí.",
      },
    },
  },
  capabilities: {
    type: "object",
    required: true,
    description: "La negociación de D31: qué sabe hacer este binario, qué pedía el paquete y qué traía.",
    fields: {
      policy: { type: "string", required: true, description: "Qué se hace con una provista desconocida." },
      supports: {
        type: "string[]",
        required: true,
        description: "Lo que este binario sabe hacer; se publica aunque el paquete no pida nada.",
      },
      required: { type: "string[]", required: true, description: "Lo que el paquete exigía." },
      provided: { type: "string[]", required: true, description: "Lo que el paquete traía." },
      unknownProvided: {
        type: "string[]",
        required: true,
        description: "De lo que traía, lo que no conocemos: preservado y nombrado, nunca tirado en silencio.",
      },
    },
  },
  run: {
    type: "object",
    required: true,
    description: "El consumo, que pertenece al run y nunca al paquete: leerlo no lo modifica (D29).",
    fields: {
      runId: { type: "string", required: true, description: "Determinista: sale del manifest, no de un reloj." },
      inputPackageId: { type: "string", description: "Identidad del paquete consumido." },
      inputManifestSha256: { type: "string", required: true, description: "Hash del manifest evaluado." },
      status: {
        type: '"COMPLETE"|"ERROR"|"UNSUPPORTED"',
        required: true,
        description: "Estado del consumo.",
      },
    },
  },
  versions: {
    type: "object",
    required: true,
    description: "Bloque de versiones; el consumidor comprueba el bloque, no un campo (D12).",
    fields: {
      softsight: { type: "string", required: true, description: "Versión del binario; no es un contrato." },
      contracts: {
        type: "object[]",
        required: true,
        description:
          "Todas las versiones de contrato que rigieron, ordenadas por nombre. El consumidor comprueba " +
          "la combinación y no un campo: dos versiones que por separado existen pueden no haberse " +
          "visto nunca juntas, y es ahí donde se rompe sin que nadie sepa por qué (D12).",
        fields: {
          name: { type: "string", required: true, description: "Qué contrato." },
          value: { type: "number|string", required: true, description: "Su versión." },
        },
      },
    },
  },
  evidence: {
    type: "object",
    required: true,
    description: "A qué apunta este informe, con hash por artifact (P5).",
    fields: {
      artifacts: {
        type: "object[]",
        required: true,
        description: "Artifacts admitidos y medidos.",
        fields: {
          id: { type: "string", required: true, description: "Identidad del artifact." },
          type: { type: "string", required: true, description: "Tipo declarado en el paquete." },
          sha256: { type: "string", required: true, description: "Hash comprobado, no copiado." },
          bytes: { type: "number", required: true, description: "Tamaño comprobado." },
        },
      },
      requiredEvidence: {
        type: "string[]",
        required: true,
        description: "Lo que el paquete declaró como imprescindible.",
      },
      missingEvidence: {
        type: "string[]",
        required: true,
        description: "De lo anterior, lo que no llegó. Con algo aquí, el veredicto es INCONCLUSIVE (D8).",
      },
    },
  },
  measurements: {
    type: "object[]",
    required: true,
    description: "Una entrada por malla medida, cada una atada a su artifact.",
    fields: {
      appliesTo: {
        type: "object",
        required: true,
        description: "Sobre qué corrió la medida.",
        fields: {
          artifactId: { type: "string", required: true, description: "Artifact medido." },
          sha256: { type: "string", required: true, description: "Su hash, el comprobado en la ingesta." },
        },
      },
      purelyReconstructed: {
        type: "boolean",
        required: true,
        description: "Provenance de esa malla, copiada de su artifact (D21).",
      },
      vertices: { type: "number", required: true, description: "Vértices del fichero, sin soldar." },
      triangles: { type: "number", required: true, description: "Triángulos del fichero." },
      degenerateTriangles: { type: "number", required: true, description: "De área nula." },
      duplicatePositions: { type: "number", required: true, description: "Vértices que la soldadura junta." },
      boundaryEdges: { type: "number", required: true, description: "Aristas con un solo triángulo." },
      nonManifoldEdges: { type: "number", required: true, description: "Aristas con tres o más." },
      watertight: { type: "boolean", required: true, description: "Cerrada tras soldar." },
      signedVolume: { type: "number", required: true, description: "Volumen firmado; negativo es del revés." },
      boundingBoxMin: { type: "number[3]", required: true, description: "Esquina mínima de la caja." },
      boundingBoxMax: { type: "number[3]", required: true, description: "Esquina máxima." },
      frame: { type: "string", required: true, description: "Marco en el que están estos números (D11)." },
      measurementClass: {
        type: '"EXACT"|"DETERMINISTIC_APPROXIMATION"|"EXTERNAL_MEASUREMENT"',
        required: true,
        description: "Qué clase de medida es (D28). Recuentos y caja son exactos.",
      },
      reproducibility: {
        type: '"BITWISE_EXACT"|"QUANTIZED"|"TOLERANCE"',
        required: true,
        description: "Con qué reproducibilidad. Nace BITWISE_EXACT y moverla exige medida.",
      },
    },
  },
  frames: {
    type: "object",
    required: true,
    description:
      "El grafo de marcos que rigió (D11): dónde se midió, qué marcos declara el paquete y a cuáles " +
      "hay camino. Un declarado que no esté en `reachable` es un salto que nadie registró.",
    fields: {
      measuredIn: { type: "string", required: true, description: "Marco de los números de `measurements`." },
      declared: { type: "string[]", required: true, description: "Marcos que nombra el grafo." },
      reachable: { type: "string[]", required: true, description: "De ellos, a los que hay camino." },
      transforms: { type: "number", required: true, description: "Aristas declaradas." },
    },
  },
  coverage: {
    type: "object",
    description:
      "Qué parte de la superficie sostiene la evidencia (R6). **Ausente** cuando no hay malla o no " +
      "hay cámaras: no es cero, es que la pregunta no se puede hacer.",
    fields: {
      measurementClass: { type: "string", required: true, description: "APPROXIMATE: el muestreo no visita toda la superficie." },
      reproducibility: { type: "string", required: true, description: "BITWISE_EXACT: visita siempre los mismos puntos." },
      seed: { type: "number", required: true, description: "Semilla del muestreo; sin ella no se reproduce." },
      samples: { type: "number", required: true, description: "Muestras que sostienen los ratios (§86.3 k)." },
      areaWeighted: { type: "boolean", required: true, description: "Siempre cierto; se declara en vez de suponerse." },
      observedAreaRatio: { type: "number", required: true, description: "Área que ve al menos una cámara." },
      triangulatedAreaRatio: { type: "number", required: true, description: "La que ven dos o más." },
      weakAreaRatio: { type: "number", required: true, description: "La que ve exactamente una: hay foto y no hay profundidad." },
      unobservedAreaRatio: { type: "number", required: true, description: "La que no ve ninguna." },
      standardError: { type: "number", required: true, description: "Error estándar del ratio observado." },
      interval: { type: "number[2]", required: true, description: "Dos sigmas, recortado a [0,1]." },
      bySeenBy: { type: "number[]", required: true, description: "Muestras por número de cámaras que las ven." },
      maskedCameras: { type: "number", required: true, description: "De cuántas cámaras se aplicó la silueta. Cero significa que el número es puramente geométrico y **cuenta como observada la superficie que proyecta sobre el fondo**; no significa que no hubiera fondo." },
      provenanceAware: { type: "boolean", required: true, description: "Falso en v1, y se dice (D21)." },
      certificationEligible: { type: "boolean", required: true, description: "Si el número certifica o solo se reporta." },
      reason: { type: "string", description: "Motivo cuando no certifica; ausente cuando sí." },
    },
  },
  confidence: {
    type: "object",
    description: "Desde dónde se miró cada región (R6). Ausente por lo mismo que `coverage`.",
    fields: {
      measurementClass: { type: "string", required: true, description: "APPROXIMATE." },
      reproducibility: { type: "string", required: true, description: "BITWISE_EXACT." },
      seed: { type: "number", required: true, description: "Semilla del muestreo." },
      samples: { type: "number", required: true, description: "Muestras que sostienen las clases." },
      areaWeighted: { type: "boolean", required: true, description: "Siempre cierto." },
      parallaxThresholdDegrees: { type: "number", required: true, description: "El suelo que se aplicó; las clases dependen de él." },
      byClass: {
        type: "object",
        required: true,
        description: "Fracción de área por clase. Suman uno. **No hay número agregado**: un índice medio escondería que la mitad firme y la mitad sin evidencia dan lo mismo que todo mediocre.",
        fields: {
          SIN_EVIDENCIA: { type: "number", required: true, description: "Ninguna cámara la ve." },
          SIN_TRIANGULAR: { type: "number", required: true, description: "La ve una." },
          PARALAJE_CORTO: { type: "number", required: true, description: "Dos o más demasiado juntas." },
          SOSTENIDA: { type: "number", required: true, description: "Dos o más con ángulo suficiente." },
        },
      },
      parallaxDegrees: {
        type: "object",
        description: "Percentiles del ángulo de triangulación, solo sobre lo que triangula. Nulo si nada triangula: «no hay ángulo» no es «el ángulo es cero».",
        fields: {
          p05: { type: "number", required: true, description: "Percentil 5." },
          median: { type: "number", required: true, description: "Mediana." },
          p95: { type: "number", required: true, description: "Percentil 95." },
        },
      },
      obliquityDegrees: {
        type: "object",
        description: "Percentiles de la oblicuidad de la mejor vista, en grados desde la normal.",
        fields: {
          median: { type: "number", required: true, description: "Mediana." },
          p95: { type: "number", required: true, description: "Percentil 95." },
        },
      },
      groundSampling: {
        type: "object",
        description: "Unidades del paquete por píxel en la mejor vista. Con escala desconocida es relativo, y por eso va la diagonal al lado (D9).",
        fields: {
          median: { type: "number", required: true, description: "Mediana." },
          p95: { type: "number", required: true, description: "Percentil 95." },
        },
      },
      provenanceAware: { type: "boolean", required: true, description: "Falso en v1 (D21)." },
      certificationEligible: { type: "boolean", required: true, description: "Si certifica o solo se reporta." },
      reason: { type: "string", description: "Motivo cuando no certifica." },
    },
  },
  repairBoundary: {
    type: "object",
    description:
      "Qué se puede reparar sin inventar nada (R10). **No repara**: dice, defecto a defecto, qué " +
      "arriesga quien lo repare. Ausente cuando no hay malla medida — sin superficie no hay defecto " +
      "que reparar, y una lista vacía diría que no hay ninguno.",
    fields: {
      measurementClass: {
        type: '"EXACT"|"APPROXIMATE"',
        required: true,
        description: "APPROXIMATE en cuanto hay un agujero que clasificar: eso cuelga del muestreo de R6.",
      },
      reproducibility: { type: "string", required: true, description: "BITWISE_EXACT." },
      evidenceAware: {
        type: "boolean",
        required: true,
        description:
          "Si se pudo cruzar con las cámaras. Falso deja todos los agujeros en REVIEW: **no saber no " +
          "es estar bien**.",
      },
      omittedLoops: {
        type: "number",
        required: true,
        description:
          "Agujeros que no entraron en la lista por el tope. El recorte va por riesgo primero y por " +
          "tamaño después, así que lo inseguro nunca se cae por pequeño; y `byRisk` los cuenta igual.",
      },
      byRisk: {
        type: "object",
        required: true,
        description: "Cuántas de cada clase **en total**, incluidas las que no se publican.",
        fields: {
          SAFE: { type: "number", required: true, description: "No mueven ninguna superficie." },
          REVIEW: { type: "number", required: true, description: "Mueven o crean superficie donde alguien miró." },
          UNSAFE: { type: "number", required: true, description: "Crean superficie donde nadie miró." },
        },
      },
      repairs: {
        type: "object[]",
        required: true,
        description: "Una entrada por defecto, y **una por agujero**: el mismo defecto vale cosas distintas según quién miró ahí.",
        fields: {
          defect: { type: "string", required: true, description: "Qué está mal." },
          repair: { type: "string", required: true, description: "Qué haría la reparación, nombrada: sin esto el riesgo no se puede juzgar." },
          risk: {
            type: '"SAFE"|"REVIEW"|"UNSAFE"',
            required: true,
            description:
              "SAFE no mueve superficie; REVIEW la mueve o la crea donde hay fotos que pueden " +
              "desmentirla; UNSAFE la crea donde no las hay, y entonces salga como salga nadie podrá saberlo.",
          },
          reason: { type: "string", required: true, description: "Motivo canónico del veredicto." },
          breaksPurelyReconstructed: {
            type: "boolean",
            required: true,
            description:
              "Si hacerla fuerza `purelyReconstructed` a false. Es la consecuencia mecánica: con ella, " +
              "D21 deja de certificar. No es una etiqueta de color — dice qué pierde el paquete.",
          },
          evidence: {
            type: "object",
            required: true,
            description: "Los números que sostienen el veredicto, para no obligar a recalcularlos (§53).",
          },
        },
      },
    },
  },
  budgets: {
    type: "object[]",
    required: true,
    description:
      "Los presupuestos que el paquete declaró, evaluados contra lo medido (R9), en el orden en que " +
      "los escribió. **Uno excedido suspende**: el límite lo puso el productor, y aprobar por encima " +
      "de él convertiría el campo en decoración. Vacío cuando el paquete no declaró ninguno.",
    fields: {
      name: { type: "string", required: true, description: "El nombre declarado, tal cual." },
      max: { type: "number", required: true, description: "El máximo declarado." },
      units: { type: '"ABSOLUTE"|"RELATIVE_TO_DIAGONAL"', required: true, description: "Cómo se expresa el máximo." },
      unit: { type: "string", description: "La unidad, cuando es absoluto." },
      observed: { type: "number", description: "Lo medido en el paquete. Ausente cuando no se pudo evaluar." },
      measures: { type: "string", description: "Qué mide el término, copiado del vocabulario: leer el informe no obliga a buscarlo." },
      verdict: {
        type: '"PASS"|"FAIL"|"NO_EVALUADO"',
        required: true,
        description:
          "`NO_EVALUADO` **no es aprobado**: el informe dice término a término cuál se juzgó y cuál no.",
      },
      reason: {
        type: "string",
        required: false,
        description:
          "`PRESUPUESTO_EXCEDIDO` cuando suspende. `TERMINO_DESCONOCIDO` cuando el nombre no está en " +
          "el vocabulario cerrado — y ese **no toca el veredicto**, porque suspender a quien usa un " +
          "vocabulario más nuevo que el nuestro sería castigarle por nuestra versión. " +
          "`METRICA_REQUERIDA_NO_DISPONIBLE` cuando el término se entiende y el dato falta, y ese sí " +
          "deja el paquete inconcluso. `UNIDAD_DE_PRESUPUESTO_MAL_DECLARADA` cuando un recuento o una " +
          "fracción se declaran relativos a la diagonal.",
      },
    },
  },
  captureAdvice: {
    type: "object",
    description:
      "Desde dónde disparar la próxima foto (R9). Ausente por lo mismo que `coverage`. **La ganancia " +
      "está medida, no estimada**: cada sugerencia trae la cámara entera, y el número sale de meterla " +
      "en el CameraSet y volver a contar con la misma aritmética que juzgará el resultado.",
    fields: {
      measurementClass: { type: "string", required: true, description: "APPROXIMATE." },
      reproducibility: { type: "string", required: true, description: "BITWISE_EXACT." },
      seed: { type: "number", required: true, description: "Semilla del muestreo, la misma que la cobertura." },
      samples: { type: "number", required: true, description: "Muestras que sostienen las ganancias." },
      areaWeighted: { type: "boolean", required: true, description: "Siempre cierto." },
      parallaxThresholdDegrees: { type: "number", required: true, description: "El suelo con el que se derivó la base que falta." },
      coversDeficit: {
        type: "number",
        required: true,
        description:
          "Fracción del déficit que las sugerencias cubren **juntas**. No es la suma de las ganancias: " +
          "dos fotos pueden recuperar la misma región, y sumarlas la contaría dos veces.",
      },
      suggestions: {
        type: "object[]",
        required: true,
        description:
          "En orden de plan, no de catálogo: la mejor primero, y cada ganancia es lo que **esa foto " +
          "añade sobre las anteriores**. Hacerlas en orden da exactamente los ratios publicados.",
        fields: {
          reason: { type: '"SIN_EVIDENCIA"|"SIN_TRIANGULAR"|"PARALAJE_CORTO"', required: true, description: "Qué carencia cubre. Las dos últimas piden base, no otra vista de frente." },
          intrinsicsFrom: { type: "string", required: true, description: "De qué cámara se copiaron los intrínsecos. No se inventa ninguna lente." },
          distance: { type: "number", required: true, description: "A qué distancia de la región se propone, en unidades del paquete." },
          region: {
            type: "object",
            required: true,
            description: "La carencia que la foto cubre, agrupada: «hay 1.842 puntos sin ver» no se puede ejecutar.",
            fields: {
              areaRatio: { type: "number", required: true, description: "Fracción del área total." },
              samples: { type: "number", required: true, description: "Muestras que la componen." },
              centroid: { type: "number[3]", required: true, description: "Centroide, en el marco de la malla." },
              normal: { type: "number[3]", required: true, description: "Normal media, unitaria." },
              extent: { type: "number", required: true, description: "Diagonal de su caja: cuánto ocupa lo que falta." },
            },
          },
          camera: {
            type: "object",
            required: true,
            description:
              "La cámara propuesta, entera, para poder medirla en vez de creérsela. **No trae imagen**: " +
              "la foto todavía no existe, que es el trabajo que se aconseja. Quien la haga completa " +
              "`imageArtifactId`, su hash y el `model` —que sale de la distorsión—.",
            fields: {
              id: { type: "string", required: true, description: "`sugerida-N`, en el orden del plan." },
              width: { type: "number", required: true, description: "Rejilla copiada de la lente de referencia." },
              height: { type: "number", required: true, description: "Ídem." },
              pixelOrigin: { type: '"TOP_LEFT"|"BOTTOM_LEFT"', required: true, description: "Convención copiada." },
              pixelCenter: { type: '"CENTER"|"CORNER"', required: true, description: "Convención copiada." },
              cameraAxes: { type: '"X_RIGHT_Y_DOWN_Z_FORWARD"|"X_RIGHT_Y_UP_Z_BACKWARD"', required: true, description: "Marco copiado." },
              intrinsics: {
                type: "object",
                required: true,
                description: "Los de la lente de referencia, sin tocar.",
                fields: {
                  fx: { type: "number", required: true, description: "Focal en x." },
                  fy: { type: "number", required: true, description: "Focal en y." },
                  cx: { type: "number", required: true, description: "Punto principal en x." },
                  cy: { type: "number", required: true, description: "Punto principal en y." },
                },
              },
              distortion: {
                type: "object",
                description: "Copiada de la lente si la tenía; ausente si no.",
                fields: {
                  k1: { type: "number", description: "Radial de primer orden." },
                  k2: { type: "number", description: "Radial de segundo orden." },
                  p1: { type: "number", description: "Tangencial." },
                  p2: { type: "number", description: "Tangencial." },
                },
              },
              worldFromCamera: { type: "number[16]", required: true, description: "Pose 4×4 por filas, traslación en 3, 7 y 11 (D32)." },
            },
          },
          gain: {
            type: "object",
            required: true,
            description:
              "Lo que el paquete gana si la foto se hace. Medido, no prometido. **Las tres ganancias " +
              "van en orden de fuerza de la evidencia**: que haya foto, que triangule, que triangule " +
              "con ángulo suficiente. Una sugerencia de base no gana ninguna de las dos primeras, y " +
              "sin la tercera no ganaría nada: el consejo no sabría decir «sepárate».",
            fields: {
              observedAreaRatio: { type: "number", required: true, description: "Área observada tras esta foto **y las anteriores**." },
              triangulatedAreaRatio: { type: "number", required: true, description: "Ídem, la que triangula." },
              supportedAreaRatio: { type: "number", required: true, description: "Ídem, la que triangula por encima del suelo de paralaje. Es el `SOSTENIDA` de `confidence` tras ejecutar el plan." },
              deltaObserved: { type: "number", required: true, description: "Lo que esta foto añade sobre las anteriores." },
              deltaTriangulated: { type: "number", required: true, description: "Ídem, en triangulación." },
              deltaSupported: { type: "number", required: true, description: "Ídem, en superficie sostenida." },
            },
          },
        },
      },
      reason: { type: "string", description: "Por qué no hay sugerencias, cuando no las hay. Ausente cuando sí." },
    },
  },
  scale: {
    type: "object",
    required: true,
    description:
      "La escala que rigió, con lo que D9 exige decir de ella: con status != ABSOLUTE nada absoluto " +
      "se certifica, y el informe publica el denominador del fallback relativo.",
    fields: {
      status: { type: '"UNKNOWN"|"RELATIVE"|"ABSOLUTE"', required: true, description: "Estado de la escala." },
      source: { type: "string", required: true, description: "De dónde sale." },
      uncertainty: {
        type: "object",
        description: "Incertidumbre, si la hay; copiada del paquete con su modelo.",
        fields: {
          model: { type: "string", required: true, description: "Qué modelo describe el valor." },
          value: { type: "number", required: true, description: "Magnitud en la unidad de la escala." },
        },
      },
      boundingBoxDiagonal: {
        type: "number",
        required: true,
        description:
          "Diagonal de la caja de todo lo medido, y denominador de un presupuesto relativo (D9). " +
          "Se publica para que el otro lado reproduzca el número en vez de recalcular una caja " +
          "que podría no ser la misma. Nulo si no se midió nada.",
      },
      claimsAbsolutePrecision: {
        type: "boolean",
        required: true,
        description:
          "Si este informe se permite hablar en unidades absolutas. Falso con escala no absoluta o " +
          "con la incertidumbre en NONE: reportar milímetros sobre una escala que nadie fijó es la " +
          "precisión que D9 prohíbe.",
      },
    },
  },
  cameras: {
    type: "object",
    required: true,
    description: "Cuántas cámaras declaró el paquete y cuántas apuntan a una imagen que existe.",
    fields: {
      declared: { type: "number", required: true, description: "Cámaras del CameraSet." },
      withImage: { type: "number", required: true, description: "De ellas, las que resuelven su imagen." },
    },
  },
  warnings: {
    type: "object[]",
    required: true,
    description: "Lo que impidió consumir el paquete, con identificador estable (D2).",
    fields: {
      code: { type: "string", required: true, description: "Identificador neutro; esto es lo que se parsea." },
      reason: { type: "string", required: true, description: "Motivo canónico." },
      message: { type: "string", required: true, description: "Texto para humanos; nunca se parsea." },
      evidence: {
        type: "object",
        description:
          "Los números que produjeron el aviso (§53). **Opaco a propósito**: cada aviso lleva lo que " +
          "hace falta para juzgarlo —un ratio con su intervalo y sus muestras, un ángulo con su " +
          "umbral— y darle una forma fija obligaría a rellenar campos que no aplican o a inventar un " +
          "campo por aviso. Lo que sí es fijo es que esté: sin él, quien lea tiene que recalcular, y " +
          "recalcular con otro muestreo da otro número.",
      },
    },
  },
};
