/**
 * R11 — inspeccionar un asset de producción.
 *
 * La puerta del escalón es literalmente esto: **que un paquete de producción se
 * pueda inspeccionar**. El IO vive aquí y no en `src/`, igual que con el paquete
 * de reconstrucción: el módulo que decide no abre ficheros, y así se le puede
 * pasar cualquier cosa desde una prueba sin montar un directorio.
 *
 *   node tools/production.mjs inspect <manifest.json> [--human]
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { decodePng } from "./agent3d.mjs";
import {
  PRODUCTION_ASSET_SCHEMA,
  buildProductionReport,
  parseGlb,
  parsePlyAscii,
  validate,
} from "../dist-node/agent3d.mjs";

/**
 * Lee el asset y construye el informe.
 *
 * Las comprobaciones de integridad son las mismas ideas que D6 y D7 en el paquete
 * de reconstrucción —ruta dentro de la raíz, tamaño y hash antes de analizar—, y
 * se repiten aquí en vez de importarse porque **el otro lector está atado a la
 * forma del paquete de reconstrucción**: sus artifacts llevan `type`, estos
 * llevan `role`. Compartirlo habría obligado a que uno de los dos documentos
 * tuviera campos del otro.
 */
export function inspectAsset(manifestPath) {
  const raiz = dirname(manifestPath);
  let documento;
  try {
    documento = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { report: null, exitCode: 20, fatal: `el manifest no se pudo leer: ${error.message}` };
  }

  const problemas = validate(documento, PRODUCTION_ASSET_SCHEMA);
  if (problemas.length > 0) {
    return {
      report: null,
      exitCode: 20,
      fatal: `el manifest no encaja con el esquema: ${problemas.slice(0, 3).join("; ")}`,
    };
  }
  if (documento.state !== "SEALED") {
    return { report: null, exitCode: 20, fatal: "solo se consume un asset SEALED (D29)" };
  }

  const meshes = new Map();
  const images = new Map();
  const uvPresence = new Map();
  const fatales = [];
  for (const artifact of documento.artifacts) {
    if (artifact.path.startsWith("/") || artifact.path.split("/").includes("..")) {
      fatales.push(`${artifact.id}: la ruta sale de la raíz del asset`);
      continue;
    }
    // Un LOD sin nivel, o un nivel donde no toca, se rechaza aquí: el esquema no
    // puede expresar «obligatorio solo con este `role`».
    if (artifact.role === "LOD" && artifact.level === undefined) {
      fatales.push(`${artifact.id}: un LOD tiene que declarar su nivel`);
      continue;
    }
    if (artifact.role !== "LOD" && artifact.level !== undefined) {
      fatales.push(`${artifact.id}: solo un LOD lleva nivel`);
      continue;
    }
    // Y lo mismo con `usage`: es de la textura y de nadie más.
    if (artifact.role === "TEXTURE" && artifact.usage === undefined) {
      fatales.push(`${artifact.id}: una textura tiene que declarar qué canal alimenta`);
      continue;
    }
    if (artifact.role !== "TEXTURE" && artifact.usage !== undefined) {
      fatales.push(`${artifact.id}: solo una textura lleva usage`);
      continue;
    }

    let real;
    try {
      real = realpathSync(join(raiz, artifact.path));
    } catch {
      fatales.push(`${artifact.id}: el fichero no está`);
      continue;
    }
    if (!real.startsWith(realpathSync(raiz))) {
      fatales.push(`${artifact.id}: su enlace resuelve fuera de la raíz`);
      continue;
    }
    const bytes = readFileSync(real);
    if (bytes.length !== artifact.bytes) {
      fatales.push(`${artifact.id}: declara ${artifact.bytes} bytes y el fichero tiene ${bytes.length}`);
      continue;
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== artifact.sha256) {
      fatales.push(`${artifact.id}: el hash no coincide`);
      continue;
    }
    if (artifact.role === "TEXTURE") {
      let png = null;
      try {
        png = decodePng(bytes);
      } catch (error) {
        fatales.push(`${artifact.id}: la imagen no se pudo abrir (${error.message})`);
        continue;
      }
      images.set(artifact.id, { width: png.width, height: png.height, pixels: png.pixels });
      continue;
    }

    if ((artifact.format ?? "PLY") === "GLB") {
      let leido;
      try {
        leido = parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      } catch (error) {
        fatales.push(`${artifact.id}: el GLB no se pudo leer (${error.message})`);
        continue;
      }
      // Una pieza por artifact. Un GLB con varias mallas describe **varias
      // cosas**, y fundirlas aquí borraría de cuál son las UV de cada una —que es
      // justo lo que R13 va a preguntar—. Se rechaza con su nombre en vez de
      // medir una mezcla.
      if (leido.parts.length !== 1) {
        fatales.push(
          `${artifact.id}: el GLB trae ${leido.parts.length} piezas y un artifact describe una`,
        );
        continue;
      }
      const pieza = leido.parts[0];
      // La matriz del nodo, aplicada: un GLB puede colocar su malla con una
      // transformación, y medir las posiciones crudas mediría otra pieza.
      const m = pieza.matrix;
      const positions = new Float32Array(pieza.mesh.positions.length);
      for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
        const [x, y, z] = [
          pieza.mesh.positions[vertex * 3],
          pieza.mesh.positions[vertex * 3 + 1],
          pieza.mesh.positions[vertex * 3 + 2],
        ];
        positions[vertex * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        positions[vertex * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        positions[vertex * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      meshes.set(artifact.id, { ...pieza.mesh, positions });
      uvPresence.set(artifact.id, pieza.hasUvs);
      continue;
    }

    const leido = parsePlyAscii(bytes.toString("utf8"));
    if (leido.mesh === null) {
      fatales.push(`${artifact.id}: el PLY no trae triángulos`);
      continue;
    }
    // Un PLY no puede expresar coordenadas de textura, y eso **no es que no las
    // tenga**: es que el formato no las admite. R13 lo dice con ese motivo en
    // vez de auditar unas UV que nadie escribió.
    meshes.set(artifact.id, {
      ...leido.mesh,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      boundingRadius: 0,
    });
    uvPresence.set(artifact.id, false);
  }

  if (fatales.length > 0) {
    return { report: null, exitCode: 20, fatal: fatales.join("; ") };
  }

  const report = buildProductionReport({ manifest: documento, meshes, images, uvPresence });
  const exitCode = report.certification === "PASS" ? 0 : report.certification === "FAIL" ? 1 : 11;
  return { report, exitCode, fatal: null };
}

/** El informe para una persona, derivado del mismo objeto. */
export function renderProduction(report) {
  const lineas = [];
  const veredicto = report.certification === "PASS" ? "PASA" : report.certification;
  lineas.push(`${report.assetId} — ${veredicto} · destino ${report.target.preset}`);
  if (report.certificationReason) lineas.push(`  motivo: ${report.certificationReason}`);
  lineas.push("");

  for (const medida of report.measurements) {
    const papel = medida.level === undefined ? medida.role : `${medida.role}-${medida.level}`;
    lineas.push(
      `${papel.padEnd(11)} ${medida.appliesTo.artifactId}: ${medida.triangles} triángulos, ` +
        `${medida.watertight ? "cerrada" : `${medida.boundaryEdges} aristas de borde`}`,
    );
    const uv = medida.uv;
    lineas.push(
      uv.present
        ? `            uv: solape ${(uv.overlapRatio * 100).toFixed(1)} % · ` +
            `uso ${(uv.utilization * 100).toFixed(0)} % · dispersión ${uv.texelDensity.spread.toFixed(2)} · ` +
            `${uv.degenerateTriangles} degenerados · ${uv.outsideUnitSquare} fuera del cuadrado`
        : `            uv: ${uv.reason}`,
    );
  }

  if (report.lods.length > 0) {
    lineas.push("");
    for (const lod of report.lods) {
      // Las dos direcciones, **sin promediar**: lo que el LOD perdió y lo que
      // añadió son dos problemas distintos.
      const d = lod.deviation;
      const sil = lod.silhouette;
      lineas.push(
        `lod ${lod.level}       ${(lod.triangleRatio * 100).toFixed(1)} % de los triángulos · ` +
          `superficie ${(lod.worstRelative * 100).toFixed(2)} % (${lod.verdicts.surface})`,
      );
      lineas.push(
        `            falta ${d.aToB.maximum.toFixed(4)} máx / ${d.aToB.mean.toFixed(4)} media · ` +
          `sobra ${d.bToA.maximum.toFixed(4)} máx / ${d.bToA.mean.toFixed(4)} media`,
      );
      // La silueta con **su vista**: sin ella, un 3 % no dice desde dónde se ve.
      lineas.push(
        `            silueta pierde ${(sil.worstMissing.missingRatio * 100).toFixed(2)} % ` +
          `(vista ${sil.worstMissing.view}) y gana ` +
          `${(sil.worstExtra.extraRatio * 100).toFixed(2)} % (vista ${sil.worstExtra.view}) · ` +
          `${lod.verdicts.silhouette}`,
      );
      lineas.push(
        `            normales ${lod.normalDeviationDegrees.mean.toFixed(2)}° media / ` +
          `${lod.normalDeviationDegrees.maximum.toFixed(1)}° máx (${lod.verdicts.normal}) · ` +
          `caja ${(lod.boundsDeltaRelative * 100).toFixed(2)} % (${lod.verdicts.bounds})`,
      );
    }
  }

  if (report.collision) {
    lineas.push("");
    const c = report.collision;
    lineas.push(
      c.ran
        ? `colisión    ${(c.protrudingRatio * 100).toFixed(2)} % de la maestra asoma ` +
            `(tolerancia ${(c.tolerance * 100).toFixed(2)} %) · ${c.verdict}` +
            (c.reasonDetail ? ` · ${c.reasonDetail}` : "")
        : `colisión    no comprobada · ${c.reason}`,
    );
    if (c.quality) {
      const q = c.quality;
      // **Las dos direcciones, separadas.** Una dice «lo atraviesan» y la otra
      // «choca con nada»: promediarlas daría un número que no describe ninguna.
      lineas.push(
        `            holgura ${(q.slackRatio * 100).toFixed(1)} % del proxy a más del ` +
          `${(q.slackTolerance * 100).toFixed(0)} % de la maestra · peor ` +
          `${(q.worstSlackRelative * 100).toFixed(1)} %`,
      );
      lineas.push(
        `            ${q.convexity.convex ? "convexo" : `cóncavo (se sale ${(q.convexity.worstExcursion * 100).toFixed(2)} %)`} · ` +
          `${(q.triangleRatio * 100).toFixed(1)} % de los triángulos · ` +
          `${(q.volumeRatio * 100).toFixed(0)} % del volumen · ` +
          `caja +${(q.boundsExcess * 100).toFixed(2)} %`,
      );
      lineas.push(
        `            ${q.topology.watertight ? "cerrado" : "**abierto**"}` +
          `${q.topology.inverted ? " · **del revés**" : ""}` +
          `${q.topology.nonManifoldEdges > 0 ? ` · ${q.topology.nonManifoldEdges} aristas no manifold` : ""}`,
      );
    }
  }

  if (report.textures.length > 0) {
    lineas.push("");
    for (const textura of report.textures) {
      lineas.push(
        `textura     ${textura.artifactId} (${textura.usage}): ${textura.width}×${textura.height}` +
          `${textura.powerOfTwo ? "" : " · no potencia de dos"}` +
          `${textura.alphaConstant ? " · alfa constante" : ""}` +
          (textura.normalLike
            ? ` · azul ${textura.normalLike.meanBlue.toFixed(2)} norma ` +
              `${textura.normalLike.meanLength.toFixed(2)} bajo horizonte ` +
              `${(textura.normalLike.belowHorizonRatio * 100).toFixed(1)} %`
            : "") +
          (textura.reason ? ` · ${textura.reason}` : ""),
      );
    }
    for (const medida of report.measurements) {
      if (medida.texelDensity === undefined) continue;
      lineas.push(
        `            ${medida.appliesTo.artifactId}: ${medida.texelDensity.median.toFixed(0)} téxeles ` +
          `por unidad (p05 ${medida.texelDensity.p05.toFixed(0)}, textura de ${medida.texelDensity.textureSide})`,
      );
    }
  }

  if (report.materialIssues.length > 0) {
    lineas.push("");
    lineas.push(`materiales  ${report.materialIssues.length} contradicciones`);
    for (const problema of report.materialIssues) {
      lineas.push(`  ${problema.reason}  ${problema.message}`);
    }
  }

  if (report.budgets.length > 0) {
    lineas.push("");
    lineas.push(`presupuestos ${report.budgets.length} del destino`);
    for (const budget of report.budgets) {
      const medido = budget.observed === undefined ? "sin medir" : `${budget.observed}`;
      lineas.push(`  ${budget.name}  ${medido} de ${budget.max} · ${budget.verdict}`);
    }
  }

  if (report.issues.length > 0) {
    lineas.push("");
    lineas.push(`problemas   ${report.issues.length}`);
    for (const problema of report.issues) lineas.push(`  ${problema.reason}  ${problema.message}`);
  }
  return `${lineas.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, target, ...rest] = process.argv.slice(2);
  if (command !== "inspect" || target === undefined) {
    process.stderr.write("uso: node tools/production.mjs inspect <manifest.json> [--human]\n");
    process.exit(2);
  }
  const { report, exitCode, fatal } = inspectAsset(resolve(target));
  if (fatal !== null) {
    process.stderr.write(`${fatal}\n`);
    process.exit(exitCode);
  }
  process.stdout.write(
    rest.includes("--human") ? renderProduction(report) : `${JSON.stringify(report, null, 2)}\n`,
  );
  process.exit(exitCode);
}
