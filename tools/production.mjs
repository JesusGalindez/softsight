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

import {
  PRODUCTION_ASSET_SCHEMA,
  buildProductionReport,
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
    const leido = parsePlyAscii(bytes.toString("utf8"));
    if (leido.mesh === null) {
      fatales.push(`${artifact.id}: el PLY no trae triángulos`);
      continue;
    }
    meshes.set(artifact.id, {
      ...leido.mesh,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      boundingRadius: 0,
    });
  }

  if (fatales.length > 0) {
    return { report: null, exitCode: 20, fatal: fatales.join("; ") };
  }

  const report = buildProductionReport({ manifest: documento, meshes });
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
  }

  if (report.lods.length > 0) {
    lineas.push("");
    for (const lod of report.lods) {
      // Las dos direcciones, **sin promediar**: lo que el LOD perdió y lo que
      // añadió son dos problemas distintos.
      const d = lod.deviation;
      lineas.push(
        `lod ${lod.level}       ${(lod.triangleRatio * 100).toFixed(1)} % de los triángulos · ` +
          `desvía ${(lod.worstRelative * 100).toFixed(2)} % de la diagonal (${lod.worstDirection}) · ` +
          lod.verdict,
      );
      lineas.push(
        `            falta ${d.aToB.maximum.toFixed(4)} máx / ${d.aToB.mean.toFixed(4)} media · ` +
          `sobra ${d.bToA.maximum.toFixed(4)} máx / ${d.bToA.mean.toFixed(4)} media`,
      );
    }
  }

  if (report.collision) {
    lineas.push("");
    const c = report.collision;
    lineas.push(
      c.ran
        ? `colisión    ${(c.protrudingRatio * 100).toFixed(2)} % de la maestra asoma del proxy ` +
            `(tolerancia ${(c.tolerance * 100).toFixed(2)} %) · ${c.verdict} · peor ` +
            `${(c.worstProtrusionRelative * 100).toFixed(2)} % de la diagonal · ` +
            `${(c.triangleRatio * 100).toFixed(1)} % de sus triángulos`
        : `colisión    no comprobada · ${c.reason}`,
    );
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
