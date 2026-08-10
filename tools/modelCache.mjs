/**
 * Caché del modelo ya analizado.
 *
 * Con `--inspect-only`, lo que queda del coste es analizar el fichero: 2,1 MB de GLB,
 * 296 piezas y 100.006 vértices en **cada** llamada. En un bucle de diez parches son
 * diez análisis idénticos, y el agente paga por turno.
 *
 * Lo que se guarda son las piezas ya resueltas —posiciones, normales, UVs, índices,
 * matriz, nombre, ruta, material—, así que recuperarlas es leer arrays tipados de una
 * tirada: sin descomprimir, sin recorrer JSON, sin reconstruir la jerarquía.
 *
 * LA TRAMPA ES INVALIDAR MAL. Una caché que devuelve el modelo de antes convierte
 * cada medida posterior en mentira, y el agente no tiene forma de saberlo. Por eso la
 * clave lleva **ruta, mtime y tamaño** —el tamaño porque dos ediciones dentro del
 * mismo segundo pueden dejar el mtime igual—, y por eso existe `--no-cache`.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_VERSION = 1;

function cacheKey(path) {
  const stats = statSync(path);
  return createHash("sha256")
    .update(`${CACHE_VERSION}|${path}|${stats.mtimeMs}|${stats.size}`)
    .digest("hex")
    .slice(0, 16);
}

function cachePath(root, path) {
  return join(root, `${cacheKey(path)}.bin`);
}

/**
 * Cabecera JSON con todo lo que no son números en bruto, y detrás un único bloque
 * binario con los arrays uno tras otro. Un solo `readFileSync` y las vistas se
 * construyen sobre el búfer sin copiar nada.
 */
function serialize(model) {
  const chunks = [];
  let offset = 0;
  const push = (array) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    chunks.push(bytes);
    const entry = { offset, length: array.length };
    offset += bytes.length;
    // Los arrays tipados exigen que el desplazamiento sea múltiplo de su tamaño.
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    return entry;
  };

  const parts = model.parts.map((part) => ({
    name: part.name,
    path: part.path,
    materialName: part.materialName,
    baseColor: part.baseColor,
    visible: part.visible,
    boundingRadius: part.mesh.boundingRadius,
    matrix: [...part.matrix],
    positions: push(part.mesh.positions),
    normals: push(part.mesh.normals),
    uvs: push(part.mesh.uvs),
    indices: push(part.mesh.indices),
  }));

  // La cabecera se rellena hasta múltiplo de cuatro. Sin eso, el bloque binario
  // empieza en un desplazamiento impar y construir un `Float32Array` sobre él lanza:
  // la caché se escribía bien, no se leía nunca, y el fallo quedaba escondido tras el
  // camino de respaldo. Un `cached: false` permanente era toda la señal que daba.
  const headerBytes = Buffer.from(
    JSON.stringify({ source: model.source, notes: model.notes, parts }),
    "utf8",
  );
  const header = Buffer.concat([
    headerBytes,
    Buffer.alloc((4 - ((headerBytes.length + 4) % 4)) % 4, 0x20),
  ]);
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);
  return Buffer.concat([headerLength, header, ...chunks]);
}

function deserialize(buffer) {
  const headerLength = buffer.readUInt32LE(0);
  const header = JSON.parse(buffer.toString("utf8", 4, 4 + headerLength));
  const base = 4 + headerLength;

  const view = (entry, Type) =>
    new Type(buffer.buffer, buffer.byteOffset + base + entry.offset, entry.length);

  return {
    source: header.source,
    notes: header.notes,
    parts: header.parts.map((part) => ({
      name: part.name,
      path: part.path,
      materialName: part.materialName,
      baseColor: part.baseColor,
      visible: part.visible,
      matrix: Float32Array.from(part.matrix),
      mesh: {
        positions: view(part.positions, Float32Array),
        normals: view(part.normals, Float32Array),
        uvs: view(part.uvs, Float32Array),
        indices: view(part.indices, Uint32Array),
        boundingRadius: part.boundingRadius,
      },
    })),
  };
}

/**
 * Devuelve el modelo desde la caché si la clave coincide, y si no llama a `parse` y
 * guarda el resultado. Un fallo de caché **nunca** es un error: si el fichero está
 * corrupto o es de otra versión, se rehace el análisis y ya está.
 */
export async function loadModelCached(path, parse, { root = ".cache", enabled = true } = {}) {
  if (!enabled) return { model: await parse(), cached: false };

  let file;
  try {
    file = cachePath(root, path);
    const model = deserialize(readFileSync(file));
    return { model, cached: true };
  } catch {
    // sigue al análisis
  }

  const model = await parse();
  try {
    mkdirSync(dirname(file), { recursive: true });
    // Escribir y renombrar, no escribir encima: con la suite en paralelo hay
    // varios procesos analizando el mismo GLB a la vez, y un lector que llega a
    // medio `writeFileSync` no ve un fichero corrupto —que la caché perdona—
    // sino uno que puede deserializar a medias. El renombrado es atómico.
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, serialize(model));
    renameSync(temporary, file);
  } catch {
    // Guardar es una optimización: si el disco no deja, no pasa nada.
  }
  return { model, cached: false };
}
