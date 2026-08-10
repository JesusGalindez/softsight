/**
 * Auditorías de malla ya calculadas, con clave en la propia malla.
 *
 * `--inspect-only --require-watertight` sobre el dron cuesta 3,16 s contra los
 * 0,51 s de la consulta barata, y la diferencia es auditar **las 296 piezas
 * enteras**, aunque el parche haya tocado una.
 *
 * El plan Ω pedía heredarlo del informe anterior con `--baseline-report`. Eso no
 * se puede construir: el informe **no publica** las 296 auditorías —solo
 * `selection.audits`, recortado a `--audit-limit`—, así que no hay nada que
 * heredar, y publicarlas serían ~50 KB por informe justo después de bajarlo a
 * 1.108 B con `--summary`.
 *
 * Lo que sí se puede afirmar es más fuerte que heredar: **`auditMesh` depende
 * solo de la malla**, no de la matriz ni del nombre. Dos mallas con los mismos
 * bytes tienen la misma auditoría, y no por aproximación sino porque es la misma
 * función sobre la misma entrada. Así que la clave es la huella de la malla:
 *
 * - un `translate` o un `rotate` no tocan la malla → la huella no cambia →
 *   ninguna de las 296 se vuelve a auditar;
 * - un `setPivot` o un `mirror` **sí** la tocan → la huella cambia → esa pieza se
 *   audita y las demás no;
 * - y no hace falta una tabla de qué operación toca qué, que es donde un
 *   incremental por operaciones se equivoca en silencio.
 *
 * El fichero es uno por modelo, no uno por pieza: 296 lecturas pequeñas cuestan
 * más que el recorrido que ahorran. Se lee entero al empezar y se escribe entero
 * al acabar, y solo si algo cambió.
 *
 * Fallar nunca es un error: si el fichero no se puede leer o escribir, se audita
 * y ya está, igual que la caché del modelo.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { trimDirectory } from "./lru.mjs";

const CACHE_VERSION = 1;
const MAX_BYTES = Number(process.env.SOFTSIGHT_AUDIT_CACHE_MAX_MB ?? 64) * 1024 * 1024;

/**
 * Huella de una malla: los bytes que lee `auditMesh` y ninguno más. Las UVs no
 * entran porque la auditoría no las mira, así que cambiar un UV no invalida.
 */
function meshKey(mesh) {
  const hash = createHash("sha256");
  for (const array of [mesh.positions, mesh.normals, mesh.indices]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * Devuelve `{ auditMesh, flush }`. `auditMesh` se le pasa a `reviewModel`;
 * `flush` guarda lo nuevo, y se llama una vez, al final.
 */
export function openAuditCache(modelPath, auditMesh, { root = ".cache/audits", enabled = true } = {}) {
  if (!enabled) return { auditMesh, flush() {} };

  const file = join(root, `${createHash("sha256").update(`${CACHE_VERSION}|${modelPath}`).digest("hex").slice(0, 16)}.json`);
  let entries = {};
  try {
    const stored = JSON.parse(readFileSync(file, "utf8"));
    if (stored.cacheVersion === CACHE_VERSION) entries = stored.audits;
  } catch {
    // sin caché previa, o ilegible: se rehace
  }

  let added = 0;
  return {
    auditMesh(mesh) {
      const key = meshKey(mesh);
      const hit = entries[key];
      if (hit !== undefined) return hit;
      const audit = auditMesh(mesh);
      entries[key] = audit;
      added += 1;
      return audit;
    },
    flush() {
      if (added === 0) return;
      try {
        mkdirSync(root, { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify({ cacheVersion: CACHE_VERSION, audits: entries })}\n`);
        renameSync(temporary, file);
        trimDirectory(root, MAX_BYTES);
      } catch {
        // Guardar es una optimización: si el disco no deja, no pasa nada.
      }
    },
  };
}
