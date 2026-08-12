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

import type { MeshAudit } from "../inspect";
import type { ObjectSchema } from "../schema";
import type { IngestIssue, IngestResult } from "./ingest";

export type CertificationVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

/** Lo que se midió de una malla del paquete, con a qué artifact pertenece. */
export interface MeshMeasurement {
  artifactId: string;
  audit: MeshAudit;
}

export interface ReportInput {
  manifest: Record<string, unknown>;
  /** Hash del manifest, calculado por quien lo leyó: el manifest no puede contenerlo. */
  manifestSha256: string;
  ingest: IngestResult;
  meshes: MeshMeasurement[];
  /** Versión de SoftSight que produce el informe. */
  softsightVersion: string;
}

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
  run: {
    runId: string;
    /** Ausente si el manifest no llegó a validar y no hay identidad que citar. */
    inputPackageId?: string;
    inputManifestSha256: string;
    /** Estado del consumo, que pertenece al run y nunca al paquete (D29). */
    status: "COMPLETE" | "ERROR" | "UNSUPPORTED";
  };
  versions: { softsight: string; report: string };
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
    /** Los dos ejes de D28: qué clase de medida es y con qué reproducibilidad. */
    measurementClass: "EXACT";
    reproducibility: "BITWISE_EXACT";
  }>;
  scale: Record<string, unknown>;
  cameras: { declared: number; withImage: number };
  warnings: IngestIssue[];
}

const REPORT_VERSION = "0.1";

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

export function buildReconstructionReport(input: ReportInput): ReconstructionReport {
  const { manifest, manifestSha256, ingest, meshes, softsightVersion } = input;
  const declared = (manifest.artifacts ?? []) as Array<Record<string, unknown>>;
  const required = (manifest.requiredEvidence ?? []) as string[];
  const admitted = new Set(ingest.artifacts.map((artifact) => artifact.id));
  const missing = required.filter((id) => !admitted.has(id));

  const cameras = (manifest.cameras ?? []) as Array<Record<string, unknown>>;
  const imageIds = new Set(
    declared.filter((artifact) => artifact.type === "IMAGE").map((artifact) => artifact.id as string),
  );

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
    measurementClass: "EXACT" as const,
    reproducibility: "BITWISE_EXACT" as const,
  }));

  let certification: CertificationVerdict = "PASS";
  let reason: string | null = null;
  if (ingest.execution !== "COMPLETE") {
    // Sin paquete no hay nada sobre lo que opinar. No es FAIL: FAIL diría algo
    // sobre la geometría de alguien, y aquí no se ha medido nada (P2).
    certification = "INCONCLUSIVE";
    reason = "PACKAGE_NOT_CONSUMABLE";
  } else if (missing.length > 0) {
    certification = "INCONCLUSIVE";
    reason = "INSUFFICIENT_EVIDENCE";
  } else if (measurements.length === 0) {
    certification = "INCONCLUSIVE";
    reason = "REQUIRED_METRIC_UNAVAILABLE";
  } else if (measurements.some((measurement) => measurement.triangles === 0)) {
    certification = "FAIL";
    reason = "MESH_DECLARED_WITHOUT_SURFACE";
  }

  return {
    documentType: "softsight.reconstruction-report",
    contractVersion: (manifest.contractVersion as string) ?? "0.0",
    execution: ingest.execution,
    certification,
    ...(reason === null ? {} : { certificationReason: reason }),
    certificationPolicy: CERTIFICATION_POLICY,
    run: {
      runId: runIdFor(manifestSha256),
      ...(ingest.packageId === null ? {} : { inputPackageId: ingest.packageId }),
      inputManifestSha256: manifestSha256,
      status: ingest.execution === "COMPLETE" ? "COMPLETE" : "ERROR",
    },
    versions: { softsight: softsightVersion, report: REPORT_VERSION },
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
    scale: (manifest.scale ?? {}) as Record<string, unknown>,
    cameras: {
      declared: cameras.length,
      withImage: cameras.filter((camera) => imageIds.has(camera.imageArtifactId as string)).length,
    },
    warnings: ingest.issues,
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
      softsight: { type: "string", required: true, description: "Versión del evaluador." },
      report: { type: "string", required: true, description: "Versión del documento." },
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
  scale: {
    type: "object",
    required: true,
    description: "La escala declarada por el paquete, copiada tal cual: con status != ABSOLUTE, nada absoluto se certifica.",
    fields: {
      status: { type: '"UNKNOWN"|"RELATIVE"|"ABSOLUTE"', required: true, description: "Estado de la escala." },
      source: { type: "string", required: true, description: "De dónde sale." },
      uncertainty: { type: "object", description: "Incertidumbre, si la hay." },
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
    },
  },
};
