/**
 * `superficie-v1`: una malla a partir de una nube dispersa, **en CPU y sin GPU**.
 *
 * ## Por qué esto y no Poisson
 *
 * La reconstrucción densa —la que da superficie de verdad— exige CUDA en los dos
 * caminos que existen: `patch_match_stereo` de COLMAP y el nodo `DepthMap` de
 * Meshroom. Ninguno tiene ruta de CPU, y los desarrolladores de AliceVision han
 * dicho que no piensan escribirla. Esta máquina no tiene GPU NVIDIA.
 *
 * Y R6 —cobertura y confianza— no necesita densidad: necesita **una superficie**
 * sobre la que preguntar «¿quién vio esto?». Sin malla, la pregunta no se puede
 * ni formular, y las medidas se quedan en el cubo sintético de cuatro vistas.
 *
 * Así que esto es lo mínimo que convierte una nube orientada en superficie:
 *
 * ```text
 * normales      PCA sobre los k vecinos: el eigenvector menor de la covarianza
 *               es la dirección en la que la vecindad no se extiende, que es la
 *               normal del plano que mejor la ajusta
 * orientación   hacia la cámara más cercana. Es el truco que esta nube permite
 *               y una nube suelta no: **el paquete trae las cámaras**, así que
 *               el lado de fuera no se propaga por un árbol de expansión, se
 *               sabe. La superficie mira a quien la fotografió
 * campo         distancia con signo al plano tangente de cada punto vecino,
 *               ponderada por (1 − d²/R²)². Un nodo sin ningún punto a menos de
 *               R se queda **desconocido**, no a cero
 * malla         surface nets: un vértice por celda con cambio de signo, en el
 *               promedio de los cruces de sus aristas
 * ```
 *
 * **No es Poisson y no se llama Poisson.** Poisson resuelve un sistema sobre un
 * octree y da una superficie cerrada aunque no haya datos; esto no resuelve nada
 * y deja agujero donde no hay evidencia. Para lo que R6 mide, el agujero es la
 * respuesta honesta: ahí no se reconstruyó nada, y taparlo produciría superficie
 * que ninguna cámara vio y que la cobertura contaría como no observada sin decir
 * que nos la inventamos nosotros.
 *
 * ## Qué no importa
 *
 * Nada de `src/`, `tools/` ni `dist-node/`, igual que `producers/colmap` y por el
 * mismo motivo de D26: un productor que usa nuestros módulos no prueba que el
 * contrato sea escribible desde fuera. Lee el paquete de entrada y el esquema
 * publicado, que es lo que tendría cualquiera.
 *
 *   node producers/superficie/build.mjs <paquete-entrada> <destino> [resolución]
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = resolve(here, "../../contracts/reconstruction-package.schema.json");

/** Nodos a lo largo del eje más largo. 128 da celdas de ~14 cm en un edificio. */
const DEFAULT_RESOLUTION = 128;
/** Vecinos para la PCA. Menos de ocho y un plano ajusta el ruido. */
const NEIGHBOURS = 16;
/** Radio de soporte del campo, en celdas. */
const SUPPORT_CELLS = 2.5;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** PLY ASCII de vértices. Solo lo que este productor necesita: posiciones. */
function readPlyPositions(text) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  let header = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("element vertex")) count = Number(line.split(/\s+/)[2]);
    if (line === "end_header") {
      header = index;
      break;
    }
  }
  if (header < 0) throw new Error("el PLY no tiene end_header");
  if (!Number.isFinite(count) || count <= 0) throw new Error("el PLY no declara vértices");
  const positions = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const parts = lines[header + 1 + index].trim().split(/\s+/);
    positions[index * 3] = Number(parts[0]);
    positions[index * 3 + 1] = Number(parts[1]);
    positions[index * 3 + 2] = Number(parts[2]);
  }
  return { positions, count };
}

/**
 * Eigenvector del autovalor menor de una simétrica 3×3, por Jacobi cíclico.
 *
 * Ocho barridos y no «hasta converger»: el criterio de parada por tolerancia
 * haría que el número de iteraciones dependiera de los datos, y con eso dos
 * ejecuciones sobre entradas casi iguales darían mallas distintas por sitios
 * distintos. Ocho basta de sobra para una 3×3.
 */
function smallestEigenvector(m) {
  const a = [m[0], m[1], m[2], m[1], m[3], m[4], m[2], m[4], m[5]];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 8; sweep += 1) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (apq === 0) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let index = 1; index < 3; index += 1) {
    if (a[index * 3 + index] < a[best * 3 + best]) best = index;
  }
  return [v[best], v[3 + best], v[6 + best]];
}

/** Rejilla uniforme de celda `size`: vecindad sin árbol y sin dependencias. */
function spatialHash(positions, count, min, size) {
  const buckets = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  for (let index = 0; index < count; index += 1) {
    const i = Math.floor((positions[index * 3] - min[0]) / size);
    const j = Math.floor((positions[index * 3 + 1] - min[1]) / size);
    const k = Math.floor((positions[index * 3 + 2] - min[2]) / size);
    const id = key(i, j, k);
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, [index]);
    else bucket.push(index);
  }
  return {
    near(x, y, z, rings) {
      const ci = Math.floor((x - min[0]) / size);
      const cj = Math.floor((y - min[1]) / size);
      const ck = Math.floor((z - min[2]) / size);
      const found = [];
      for (let i = ci - rings; i <= ci + rings; i += 1) {
        for (let j = cj - rings; j <= cj + rings; j += 1) {
          for (let k = ck - rings; k <= ck + rings; k += 1) {
            const bucket = buckets.get(key(i, j, k));
            if (bucket !== undefined) found.push(...bucket);
          }
        }
      }
      return found;
    },
  };
}

/** Normales por PCA, orientadas hacia la cámara más cercana. */
export function estimateNormals(positions, count, eyes, cellSize) {
  const grid = spatialHash(positions, count, [0, 0, 0], cellSize);
  const normals = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const px = positions[index * 3];
    const py = positions[index * 3 + 1];
    const pz = positions[index * 3 + 2];

    // Se amplía el anillo hasta tener vecinos de sobra: con un anillo fijo, una
    // zona poco poblada daría una covarianza de dos puntos y una normal absurda.
    let candidates = [];
    for (let rings = 1; rings <= 4; rings += 1) {
      candidates = grid.near(px, py, pz, rings);
      if (candidates.length > NEIGHBOURS) break;
    }
    const byDistance = candidates
      .map((other) => ({
        other,
        distance:
          (positions[other * 3] - px) ** 2 +
          (positions[other * 3 + 1] - py) ** 2 +
          (positions[other * 3 + 2] - pz) ** 2,
      }))
      // Desempate por índice: dos vecinos a la misma distancia tienen que salir
      // siempre en el mismo orden o la malla deja de ser reproducible.
      .sort((a, b) => a.distance - b.distance || a.other - b.other)
      .slice(0, NEIGHBOURS);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const { other } of byDistance) {
      cx += positions[other * 3];
      cy += positions[other * 3 + 1];
      cz += positions[other * 3 + 2];
    }
    const n = byDistance.length || 1;
    cx /= n;
    cy /= n;
    cz /= n;

    let xx = 0;
    let xy = 0;
    let xz = 0;
    let yy = 0;
    let yz = 0;
    let zz = 0;
    for (const { other } of byDistance) {
      const dx = positions[other * 3] - cx;
      const dy = positions[other * 3 + 1] - cy;
      const dz = positions[other * 3 + 2] - cz;
      xx += dx * dx;
      xy += dx * dy;
      xz += dx * dz;
      yy += dy * dy;
      yz += dy * dz;
      zz += dz * dz;
    }
    let [nx, ny, nz] = smallestEigenvector([xx, xy, xz, yy, yz, zz]);
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    // **El lado de fuera no se adivina: se mira quién lo fotografió.** Una nube
    // suelta obliga a propagar la orientación por un árbol de expansión, que es
    // frágil justo donde dos superficies casi se tocan. Aquí hay cámaras.
    let bestEye = null;
    let bestDistance = Infinity;
    for (const eye of eyes) {
      const distance = (eye[0] - px) ** 2 + (eye[1] - py) ** 2 + (eye[2] - pz) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEye = eye;
      }
    }
    if (bestEye !== null) {
      const facing = nx * (bestEye[0] - px) + ny * (bestEye[1] - py) + nz * (bestEye[2] - pz);
      if (facing < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    normals[index * 3] = nx;
    normals[index * 3 + 1] = ny;
    normals[index * 3 + 2] = nz;
  }
  return normals;
}

/**
 * Nube orientada → malla, por campo con signo y surface nets.
 *
 * Devuelve también cuántos nodos quedaron sin soporte: es la medida de cuánto
 * del volumen no tenía evidencia, y sale en el `producer` del paquete.
 */
export function meshFromOrientedCloud(positions, normals, count, resolution) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index * 3 + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const h = extent / resolution;
  const radius = SUPPORT_CELLS * h;
  // Un nodo de margen por lado: el cruce de signo en el borde exacto de la caja
  // no tendría celda donde vivir.
  const origin = [min[0] - 2 * h, min[1] - 2 * h, min[2] - 2 * h];
  const dims = [
    Math.ceil((max[0] - min[0]) / h) + 5,
    Math.ceil((max[1] - min[1]) / h) + 5,
    Math.ceil((max[2] - min[2]) / h) + 5,
  ];
  const nodes = dims[0] * dims[1] * dims[2];
  const field = new Float64Array(nodes);
  const weight = new Float64Array(nodes);
  const at = (i, j, k) => (k * dims[1] + j) * dims[0] + i;

  // Dispersión: cada punto reparte su distancia al plano tangente en los nodos
  // que tiene a menos de R. Al revés —recorrer nodos y buscar puntos— costaría
  // una consulta por nodo y hay millones.
  const reach = Math.ceil(radius / h);
  for (let index = 0; index < count; index += 1) {
    const px = positions[index * 3];
    const py = positions[index * 3 + 1];
    const pz = positions[index * 3 + 2];
    const nx = normals[index * 3];
    const ny = normals[index * 3 + 1];
    const nz = normals[index * 3 + 2];
    const ci = Math.round((px - origin[0]) / h);
    const cj = Math.round((py - origin[1]) / h);
    const ck = Math.round((pz - origin[2]) / h);
    for (let i = Math.max(0, ci - reach); i <= Math.min(dims[0] - 1, ci + reach); i += 1) {
      const x = origin[0] + i * h;
      for (let j = Math.max(0, cj - reach); j <= Math.min(dims[1] - 1, cj + reach); j += 1) {
        const y = origin[1] + j * h;
        for (let k = Math.max(0, ck - reach); k <= Math.min(dims[2] - 1, ck + reach); k += 1) {
          const z = origin[2] + k * h;
          const dx = x - px;
          const dy = y - py;
          const dz = z - pz;
          const squared = dx * dx + dy * dy + dz * dz;
          if (squared >= radius * radius) continue;
          const w = (1 - squared / (radius * radius)) ** 2;
          const node = at(i, j, k);
          field[node] += w * (dx * nx + dy * ny + dz * nz);
          weight[node] += w;
        }
      }
    }
  }

  let unsupported = 0;
  for (let node = 0; node < nodes; node += 1) {
    if (weight[node] > 0) field[node] /= weight[node];
    else unsupported += 1;
  }

  // Un vértice por celda con cambio de signo, en el promedio de los cruces.
  const cellDims = [dims[0] - 1, dims[1] - 1, dims[2] - 1];
  const cellVertex = new Int32Array(cellDims[0] * cellDims[1] * cellDims[2]).fill(-1);
  const cellAt = (i, j, k) => (k * cellDims[1] + j) * cellDims[0] + i;
  const vertices = [];
  const CORNERS = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let k = 0; k < cellDims[2]; k += 1) {
    for (let j = 0; j < cellDims[1]; j += 1) {
      for (let i = 0; i < cellDims[0]; i += 1) {
        const values = [];
        let known = true;
        for (const [di, dj, dk] of CORNERS) {
          const node = at(i + di, j + dj, k + dk);
          // **Una esquina sin soporte descarta la celda entera.** Interpolar
          // contra un nodo inventado produciría superficie donde no hay dato,
          // que es exactamente lo que esta malla no puede hacer.
          if (weight[node] === 0) {
            known = false;
            break;
          }
          values.push(field[node]);
        }
        if (!known) continue;
        let negatives = 0;
        for (const value of values) if (value < 0) negatives += 1;
        if (negatives === 0 || negatives === 8) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          const va = values[a];
          const vb = values[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ca = CORNERS[a];
          const cb = CORNERS[b];
          sx += ca[0] + t * (cb[0] - ca[0]);
          sy += ca[1] + t * (cb[1] - ca[1]);
          sz += ca[2] + t * (cb[2] - ca[2]);
          crossings += 1;
        }
        cellVertex[cellAt(i, j, k)] = vertices.length / 3;
        vertices.push(
          origin[0] + (i + sx / crossings) * h,
          origin[1] + (j + sy / crossings) * h,
          origin[2] + (k + sz / crossings) * h,
        );
      }
    }
  }

  // Un quad por arista de la rejilla que cambia de signo, entre las cuatro celdas
  // que la comparten. El orden es la regla de la mano derecha sobre el eje, y se
  // invierte cuando el signo va de fuera a dentro: así la normal sale por fuera.
  const triangles = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) triangles.push(a, c, b, a, d, c);
    else triangles.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < dims[2]; k += 1) {
    for (let j = 0; j < dims[1]; j += 1) {
      for (let i = 0; i < dims[0]; i += 1) {
        const node = at(i, j, k);
        if (weight[node] === 0) continue;
        const value = field[node];
        if (i + 1 < dims[0] && weight[at(i + 1, j, k)] > 0 && j > 0 && k > 0) {
          const other = field[at(i + 1, j, k)];
          if (value < 0 !== other < 0) {
            quad(
              cellVertex[cellAt(i, j - 1, k - 1)],
              cellVertex[cellAt(i, j, k - 1)],
              cellVertex[cellAt(i, j, k)],
              cellVertex[cellAt(i, j - 1, k)],
              value >= 0,
            );
          }
        }
        if (j + 1 < dims[1] && weight[at(i, j + 1, k)] > 0 && i > 0 && k > 0) {
          const other = field[at(i, j + 1, k)];
          if (value < 0 !== other < 0) {
            quad(
              cellVertex[cellAt(i - 1, j, k - 1)],
              cellVertex[cellAt(i - 1, j, k)],
              cellVertex[cellAt(i, j, k)],
              cellVertex[cellAt(i, j, k - 1)],
              value >= 0,
            );
          }
        }
        if (k + 1 < dims[2] && weight[at(i, j, k + 1)] > 0 && i > 0 && j > 0) {
          const other = field[at(i, j, k + 1)];
          if (value < 0 !== other < 0) {
            quad(
              cellVertex[cellAt(i - 1, j - 1, k)],
              cellVertex[cellAt(i, j - 1, k)],
              cellVertex[cellAt(i, j, k)],
              cellVertex[cellAt(i - 1, j, k)],
              value >= 0,
            );
          }
        }
      }
    }
  }

  return { vertices, triangles, cellSize: h, nodes, unsupported };
}

/** PLY ASCII de malla. Sin normales: se recalculan, no se afirman. */
function writeMeshPly(vertices, triangles) {
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment generado por producers/superficie",
    `element vertex ${vertices.length / 3}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${triangles.length / 3}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];
  for (let index = 0; index < vertices.length; index += 3) {
    lines.push(`${vertices[index]} ${vertices[index + 1]} ${vertices[index + 2]}`);
  }
  for (let index = 0; index < triangles.length; index += 3) {
    lines.push(`3 ${triangles[index]} ${triangles[index + 1]} ${triangles[index + 2]}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildSurfacePackage(source, destination, resolution = DEFAULT_RESOLUTION) {
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  const cloud = manifest.artifacts.find((artifact) => artifact.type === "POINT_CLOUD");
  if (cloud === undefined) throw new Error("el paquete de entrada no trae nube de puntos");

  const { positions, count } = readPlyPositions(readFileSync(join(source, cloud.path), "utf8"));
  // Centro de cada cámara: la traslación de `worldFromCamera`, en 3, 7 y 11
  // porque el esquema publica la matriz por filas.
  const eyes = manifest.cameras.map((camera) => [
    camera.worldFromCamera[3],
    camera.worldFromCamera[7],
    camera.worldFromCamera[11],
  ]);

  // La celda de la vecindad es la de la rejilla: buscar vecinos a otra escala
  // que la del campo daría normales que describen otra superficie.
  const span = (axis) => {
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index < count; index += 1) {
      const value = positions[index * 3 + axis];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return high - low;
  };
  const cellSize = Math.max(span(0), span(1), span(2)) / resolution;
  const normals = estimateNormals(positions, count, eyes, cellSize * SUPPORT_CELLS);
  const mesh = meshFromOrientedCloud(positions, normals, count, resolution);
  if (mesh.triangles.length === 0) throw new Error("el campo no cruzó cero en ninguna celda");

  const temp = `${destination}.escribiendo`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(join(temp, "images"), { recursive: true });

  const artifacts = [];
  for (const artifact of manifest.artifacts) {
    copyFileSync(join(source, artifact.path), join(temp, artifact.path));
    artifacts.push(artifact);
  }
  const ply = writeMeshPly(mesh.vertices, mesh.triangles);
  writeFileSync(join(temp, "malla.ply"), ply);
  artifacts.push({
    id: "malla",
    type: "TRIANGLE_MESH",
    path: "malla.ply",
    bytes: Buffer.byteLength(ply),
    sha256: sha256(ply),
    // **Cierto, y es lo que hay que mirar con lupa.** Cada región sale de puntos
    // triangulados y de nada más: no se rellena ningún agujero, no interviene
    // ningún modelo generativo y nadie ha modelado a mano. El suavizado del
    // campo es un promedio de evidencia, no evidencia nueva.
    purelyReconstructed: true,
  });

  const salida = {
    ...manifest,
    packageId: "superficie-v1",
    producer: {
      name:
        `producers/superficie · surface nets sobre ${count} puntos, rejilla ${resolution}, ` +
        `${((mesh.unsupported / mesh.nodes) * 100).toFixed(1)} % del volumen sin soporte`,
      version: "0.1.0",
    },
    artifacts,
    // La malla entra en lo que hay que certificar: es la superficie de la que
    // habla el paquete, y dejarla fuera sería entregarla sin responder por ella.
    requiredEvidence: [...(manifest.requiredEvidence ?? []), "malla"],
  };

  writeFileSync(join(temp, "manifest.json"), `${JSON.stringify(salida, null, 2)}\n`);
  rmSync(destination, { recursive: true, force: true });
  renameSync(temp, destination);

  return { manifest: salida, mesh, points: count };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [source, destination, resolution] = process.argv.slice(2);
  if (source === undefined || destination === undefined) {
    process.stderr.write(
      "uso: node producers/superficie/build.mjs <paquete-entrada> <destino> [resolución]\n" +
        "  el paquete de entrada lleva manifest.json con un artifact POINT_CLOUD\n",
    );
    process.exit(2);
  }
  JSON.parse(readFileSync(CONTRACT, "utf8"));
  const { mesh, points } = buildSurfacePackage(
    resolve(source),
    resolve(destination),
    resolution === undefined ? DEFAULT_RESOLUTION : Number(resolution),
  );
  process.stdout.write(
    `superficie-v1: ${points} puntos → ${mesh.vertices.length / 3} vértices y ` +
      `${mesh.triangles.length / 3} triángulos, celda ${mesh.cellSize.toFixed(4)}, ` +
      `${((mesh.unsupported / mesh.nodes) * 100).toFixed(1)} % del volumen sin soporte\n`,
  );
}
