/**
 * Expulsión acotada por bytes, en memoria y en disco.
 *
 * El criterio ya estaba escrito dos veces —el LRU en memoria de
 * `workerServer.mjs` y el recorte por mtime de la caché de modelos del puente— y
 * la caché del CLI no tenía ninguno: `.cache/` llegó a 130 MB en 59 ficheros sin
 * política de expulsión. Tres copias del mismo criterio son tres sitios donde
 * arreglar el mismo fallo, así que vive aquí y los tres lo importan.
 *
 * Las dos formas son la misma idea con distinto reloj: en memoria el orden de
 * uso lo lleva el `Map` —insertar al final, tocar es borrar y reinsertar—; en
 * disco lo lleva el `mtime`, que es lo único que sobrevive entre procesos.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * LRU en memoria con techo en bytes. `sizeOf` mide cada entrada; una entrada que
 * no cabe ni sola **no se guarda**, en vez de vaciar la caché para nada.
 */
export class MemoryLru {
  constructor(maxBytes, sizeOf) {
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit); // toque LRU
    return hit.value;
  }

  set(key, value) {
    const size = this.sizeOf(value);
    if (size > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous !== undefined) this.bytes -= previous.size;
    this.entries.delete(key);
    this.entries.set(key, { value, size });
    this.bytes += size;
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).size;
      this.entries.delete(oldest);
    }
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * Deja el directorio por debajo del techo borrando los ficheros con el `mtime`
 * más viejo. No es error que falle: expulsar es una optimización, y un fichero
 * que otro proceso borró a mitad de listado no es un problema de nadie.
 */
export function trimDirectory(root, maxBytes) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      const stats = statSync(path);
      if (!stats.isFile()) continue;
      files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
      total += stats.size;
    } catch {
      // otro proceso pudo borrarlo a mitad de listado
    }
  }
  if (total <= maxBytes) return;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of files) {
    if (total <= maxBytes) break;
    try {
      unlinkSync(file.path);
      total -= file.size;
    } catch {
      // ya no existe; sigue con el siguiente
    }
  }
}
