/**
 * La visibilidad ya calculada, con clave en lo que la determina (§55, §56).
 *
 * `computeVisibility` es **el grueso del coste** del informe: muestrea la
 * superficie por área y tira un rayo de cada muestra a cada cámara. Sobre
 * `south-building` —8.214 triángulos, 8 cámaras, 8.000 muestras— son 64.000
 * rayos contra el árbol, y de ahí cuelgan la cobertura, la confianza y el
 * consejo de captura, que son proyecciones de la misma pasada.
 *
 * ## Por qué la clave no puede ser la ruta
 *
 * `path + mtime + size` es lo que usa la caché de modelos del motor y ahí está
 * bien: el modelo es un fichero y quien lo toca lo reescribe. Un paquete no es un
 * fichero. `touch` sobre el manifest no cambia ninguna medida, y un `dense.ply`
 * regenerado con los mismos bytes tampoco. Al revés es peor: dos paquetes
 * distintos copiados a la misma ruta tienen el mismo `path`, y si el `mtime` cae
 * en el mismo segundo —cosa que pasa cuando los escribe un script— la caché
 * devuelve la medida del otro. Eso no es un fallo de rendimiento: es un informe
 * equivocado con el sello de otro paquete.
 *
 * Así que la clave es **el contenido que la medida lee**, y nada más:
 *
 * ```text
 * las posiciones y los índices de la malla   (lo que se muestrea y lo que ocluye)
 * el CameraSet, campo a campo                (desde dónde se mira)
 * las siluetas, si las hay                   (qué píxel es la pieza)
 * muestras y semilla                         (el muestreo es determinista, no fijo)
 * la versión del algoritmo                   (abajo, y no es un número a mano)
 * ```
 *
 * ## §56 sin tabla de invalidación, que es el punto
 *
 * El §56 pide una tabla: «geometry changed → invalidate BVH, adjacency,
 * coverage, confidence, diff». Una tabla es un segundo original de la
 * dependencia, y el día que alguien añada una entrada que lea las normales y no
 * actualice la tabla, la caché devolverá lo viejo **en silencio y para siempre**.
 *
 * Aquí no hay tabla. Lo que invalida cada cosa **es la lista de lo que entra en
 * su clave**, así que la matriz del §56 sale sola y no se puede desincronizar:
 *
 * ```text
 * cambia la geometría  →  cambia el hash de la malla     →  se recalcula
 * cambia una cámara    →  cambia el hash del CameraSet   →  se recalcula
 * cambia un UV         →  no entra en la clave           →  NO se recalcula
 * ```
 *
 * La tercera es la que se puede equivocar y la que la puerta comprueba: la
 * visibilidad no mira los UV, así que retexturizar no puede costar un remuestreo.
 *
 * ## La versión del algoritmo que nadie tiene que acordarse de subir
 *
 * Un `ALGORITHM_VERSION = 3` escrito a mano falla de la peor forma posible: quien
 * cambia la aritmética y no lo sube deja una caché que devuelve números de la
 * versión anterior, y no hay nada que lo delate. Así que la versión es **la huella
 * del artefacto construido**, `dist-node/agent3d.mjs`. Si el código que mide
 * cambió, la huella cambió.
 *
 * El precio se dice en voz alta: es conservador de más. Tocar el lector de PLY
 * invalida visibilidades que el lector de PLY no afecta. Se acepta a propósito —
 * el fallo caro es el contrario.
 *
 * ## Fallar no es un error
 *
 * Si el fichero no se puede leer o escribir, se mide y ya está, igual que en la
 * caché de auditorías. Una caché que hace fallar el informe convierte una
 * optimización en una dependencia.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { trimDirectory } from "./lru.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BUILT = resolve(here, "../dist-node/agent3d.mjs");
const CACHE_FORMAT = 1;
const MAX_BYTES = Number(process.env.SOFTSIGHT_RECON_CACHE_MAX_MB ?? 256) * 1024 * 1024;

let algorithmVersion = null;

/**
 * La huella del código que mide. Se calcula una vez por proceso: el artefacto no
 * cambia mientras el proceso vive, y leer 500 KB por petición en el modo
 * residente sería pagar la caché en cada consulta.
 */
export function algorithmFingerprint() {
  if (algorithmVersion === null) {
    try {
      algorithmVersion = createHash("sha256").update(readFileSync(BUILT)).digest("hex").slice(0, 16);
    } catch {
      // Sin artefacto construido no hay versión que afirmar, y una caché sin
      // versión es una caché que no se puede invalidar: mejor no tenerla.
      algorithmVersion = "";
    }
  }
  return algorithmVersion;
}

/** Los bytes de la malla que la visibilidad **lee**. Las UV y las normales no. */
function hashMesh(hash, mesh) {
  for (const array of [mesh.positions, mesh.indices]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
}

/**
 * El CameraSet campo a campo y en orden. No se serializa el objeto entero con
 * `JSON.stringify` porque el orden de las claves de un objeto leído de disco
 * depende de cómo se escribió el fichero, y dos manifests equivalentes darían
 * dos claves distintas — una caché que nunca acierta es una caché que no está.
 */
function hashCameras(hash, cameras) {
  for (const camera of cameras) {
    hash.update(`|${camera.id ?? ""}|${camera.width}|${camera.height}`);
    for (const value of camera.worldFromCamera) hash.update(`|${value}`);
    const { fx, fy, cx, cy } = camera.intrinsics;
    hash.update(`|${fx}|${fy}|${cx}|${cy}`);
  }
}

/** La clave: exactamente lo que entra en la medida, y nada más. */
export function visibilityKey({ mesh, cameras, masks, samples, seed }) {
  const hash = createHash("sha256");
  hash.update(`softsight-visibility|${CACHE_FORMAT}|${algorithmFingerprint()}|${samples}|${seed ?? 1}`);
  hashMesh(hash, mesh);
  hashCameras(hash, cameras);
  // Las siluetas por id de cámara y ordenadas: **ausente no es vacía** (una
  // cámara sin máscara ve todo su encuadre; una con máscara vacía no ve nada),
  // así que la presencia entra en la clave aunque los bytes sean los mismos.
  //
  // `MaskSet` es un `Map`, y esto costó un rojo: con `Object.keys` sobre un `Map`
  // salen cero claves, la máscara no entraba en la huella, y un paquete **con**
  // siluetas recibía la visibilidad medida sin ellas. Es exactamente el fallo por
  // el que esta caché no se clava en la ruta: acertar de más no se nota, sale un
  // informe equivocado con el sello del bueno.
  const entries = [...(masks ?? new Map()).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  hash.update(`|masks:${entries.length}`);
  for (const [id, mask] of entries) {
    hash.update(`|${id}|${mask.width}|${mask.height}`);
    hash.update(Buffer.from(mask.coverage.buffer, mask.coverage.byteOffset, mask.coverage.byteLength));
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * Un `SurfaceVisibility` en bytes. Los dos arrays grandes van crudos y `seenBy`
 * —listas de longitud variable— va aplanado en desplazamientos y valores, que es
 * lo que evita escribir 8.000 arrays de JSON.
 */
function encode(visibility) {
  const offsets = new Int32Array(visibility.count + 1);
  let total = 0;
  for (let index = 0; index < visibility.count; index += 1) {
    offsets[index] = total;
    total += visibility.seenBy[index].length;
  }
  offsets[visibility.count] = total;
  const values = new Int32Array(total);
  let cursor = 0;
  for (const list of visibility.seenBy) for (const value of list) values[cursor++] = value;

  const header = Buffer.from(
    JSON.stringify({
      format: CACHE_FORMAT,
      count: visibility.count,
      magnitude: visibility.magnitude,
      maskedCameras: visibility.maskedCameras,
      values: total,
    }),
    "utf8",
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  return Buffer.concat([
    length,
    header,
    Buffer.from(visibility.points.buffer, visibility.points.byteOffset, visibility.points.byteLength),
    Buffer.from(visibility.normals.buffer, visibility.normals.byteOffset, visibility.normals.byteLength),
    Buffer.from(offsets.buffer, offsets.byteOffset, offsets.byteLength),
    Buffer.from(values.buffer, values.byteOffset, values.byteLength),
  ]);
}

function decode(bytes) {
  const headerLength = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.subarray(4, 4 + headerLength).toString("utf8"));
  if (header.format !== CACHE_FORMAT) return undefined;
  let cursor = 4 + headerLength;
  const take = (Type, items) => {
    const slice = bytes.subarray(cursor, cursor + items * Type.BYTES_PER_ELEMENT);
    cursor += slice.length;
    // Copia y no vista: el `Buffer` de Node comparte el pool, así que una vista
    // sobre él sobreviviría al fichero y traería bytes de otra lectura.
    return new Type(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
  };
  const points = take(Float64Array, header.count * 3);
  const normals = take(Float64Array, header.count * 3);
  const offsets = take(Int32Array, header.count + 1);
  const values = take(Int32Array, header.values);
  const seenBy = [];
  for (let index = 0; index < header.count; index += 1) {
    seenBy.push(Array.from(values.subarray(offsets[index], offsets[index + 1])));
  }
  return {
    points,
    normals,
    count: header.count,
    seenBy,
    magnitude: header.magnitude,
    maskedCameras: header.maskedCameras,
  };
}

/**
 * Abre la caché. `enabled: false` —o `--no-cache`— devuelve una que no acierta
 * nunca y no escribe: la invalidación manda, como en las otras dos cachés de la
 * casa.
 */
export function openVisibilityCache({ root = ".cache/reconstruction/visibility", enabled = true } = {}) {
  const stats = { hits: 0, misses: 0, stored: 0 };
  if (!enabled || algorithmFingerprint() === "") {
    return { stats, get: () => undefined, set: () => {} };
  }
  return {
    stats,
    get(key) {
      const file = join(root, `${key}.bin`);
      if (!existsSync(file)) {
        stats.misses += 1;
        return undefined;
      }
      try {
        const value = decode(readFileSync(file));
        if (value === undefined) {
          stats.misses += 1;
          return undefined;
        }
        stats.hits += 1;
        return value;
      } catch {
        stats.misses += 1;
        return undefined;
      }
    },
    set(key, visibility) {
      try {
        mkdirSync(root, { recursive: true });
        const file = join(root, `${key}.bin`);
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, encode(visibility));
        renameSync(temporary, file);
        stats.stored += 1;
        trimDirectory(root, MAX_BYTES);
      } catch {
        // Guardar es una optimización; si el disco no deja, no pasa nada.
      }
    },
  };
}
