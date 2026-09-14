/**
 * `esfera-v1`: un asset de producción escrito a mano, para R11.
 *
 * Un cubo esferificado: la rejilla de cada cara se proyecta sobre la esfera de
 * radio uno. Tiene la propiedad que un fixture necesita — **la respuesta se sabe
 * antes de medirla**—: todos sus vértices caen exactamente a distancia uno del
 * centro, así que la desviación de un nivel de detalle es la flecha de su cuerda
 * y se puede calcular a mano.
 *
 * Y el proxy de colisión es una caja de semilado 1,02, que contiene la esfera con
 * holgura conocida. Encogerla por debajo de uno la haría asomar, que es el caso
 * que R11 existe para cazar.
 */

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Cubo esferificado con `n` divisiones por lado. Determinista. */
export function spherifiedCube(n, radius = 1) {
  const positions = [];
  const indices = [];
  const clave = new Map();
  // Las seis caras, cada una con sus dos ejes y su normal.
  const caras = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  ];

  const indiceDe = (x, y, z) => {
    // Se redondea para que dos caras que comparten una arista compartan vértice:
    // sin esto, la esfera sale con costuras y un `boundaryEdges` que no describe
    // ningún agujero.
    const id = [x, y, z].map((value) => value.toFixed(9)).join(",");
    const existente = clave.get(id);
    if (existente !== undefined) return existente;
    const nuevo = positions.length / 3;
    positions.push(x, y, z);
    clave.set(id, nuevo);
    return nuevo;
  };

  for (const [ejeU, ejeV, normal] of caras) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const esquina = (di, dj) => {
          const u = ((i + di) / n) * 2 - 1;
          const v = ((j + dj) / n) * 2 - 1;
          const p = [
            ejeU[0] * u + ejeV[0] * v + normal[0],
            ejeU[1] * u + ejeV[1] * v + normal[1],
            ejeU[2] * u + ejeV[2] * v + normal[2],
          ];
          const largo = Math.hypot(p[0], p[1], p[2]) || 1;
          return indiceDe((p[0] / largo) * radius, (p[1] / largo) * radius, (p[2] / largo) * radius);
        };
        const a = esquina(0, 0);
        const b = esquina(1, 0);
        const c = esquina(1, 1);
        const d = esquina(0, 1);
        indices.push(a, b, c, a, c, d);
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Caja cerrada de semilado `half`, el proxy de colisión. */
export function box(half) {
  const positions = new Float32Array([
    -half, -half, -half, half, -half, -half, half, half, -half, -half, half, -half,
    -half, -half, half, half, -half, half, half, half, half, -half, half, half,
  ]);
  // Bobinado hacia fuera en las seis caras.
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
  ]);
  return { positions, indices };
}

/** PLY ASCII de malla, el mismo formato que lee el verificador. */
export function writeMeshPly(mesh) {
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment generado por tools/productionAsset.mjs",
    `element vertex ${mesh.positions.length / 3}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${mesh.indices.length / 3}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    lines.push(`${mesh.positions[index]} ${mesh.positions[index + 1]} ${mesh.positions[index + 2]}`);
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    lines.push(`3 ${mesh.indices[index]} ${mesh.indices[index + 1]} ${mesh.indices[index + 2]}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Escribe el asset. `cambios` permite a la puerta torcer una pieza sin reescribir
 * el fixture entero: un proxy encogido, un LOD que no simplifica, un presupuesto
 * imposible.
 */
export function writeProductionAsset(destination, cambios = {}) {
  const piezas = [
    { id: "maestra", role: "MASTER", mesh: spherifiedCube(cambios.masterDivisions ?? 12) },
    { id: "lod-1", role: "LOD", level: 1, mesh: spherifiedCube(cambios.lod1Divisions ?? 6) },
    { id: "lod-2", role: "LOD", level: 2, mesh: spherifiedCube(cambios.lod2Divisions ?? 3) },
    { id: "colision", role: "COLLISION", mesh: box(cambios.collisionHalf ?? 1.02) },
  ].filter((pieza) => !(cambios.omit ?? []).includes(pieza.id));

  const temp = `${destination}.escribiendo`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });

  const artifacts = [];
  for (const pieza of piezas) {
    const ply = writeMeshPly(pieza.mesh);
    const nombre = `${pieza.id}.ply`;
    writeFileSync(join(temp, nombre), ply);
    artifacts.push({
      id: pieza.id,
      path: nombre,
      bytes: Buffer.byteLength(ply),
      sha256: sha256(ply),
      role: pieza.role,
      ...(pieza.level === undefined ? {} : { level: pieza.level }),
    });
  }

  const manifest = {
    documentType: "softsight.production-asset",
    contractVersion: "0.1",
    assetId: cambios.assetId ?? "esfera-v1",
    state: "SEALED",
    producer: { name: "softsight/productionAsset", version: "0.1.0" },
    artifacts,
    target: cambios.target ?? {
      preset: "escritorio-medio",
      budgets: [
        { name: "triangulos", role: "MASTER", units: "ABSOLUTE", unit: "unidades", max: 5000 },
        { name: "triangulos", role: "COLLISION", units: "ABSOLUTE", unit: "unidades", max: 50 },
        { name: "aristas-de-borde", units: "ABSOLUTE", unit: "unidades", max: 0 },
      ],
    },
  };
  writeFileSync(join(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(destination, { recursive: true, force: true });
  renameSync(temp, destination);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [destino] = process.argv.slice(2);
  if (destino === undefined) {
    process.stderr.write("uso: node tools/productionAsset.mjs <destino>\n");
    process.exit(2);
  }
  const manifest = writeProductionAsset(destino);
  process.stdout.write(`${manifest.assetId}: ${manifest.artifacts.length} artifacts en ${destino}\n`);
}
