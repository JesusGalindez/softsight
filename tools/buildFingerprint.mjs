/**
 * La huella de compilación: qué fuentes produjeron `dist-node/agent3d.mjs`.
 *
 * El CLI, el puente y el servidor MCP importan el paquete construido, no `src/`.
 * Un agente que edita `src/` y llama a `node tools/agent3d.mjs` sin recompilar
 * recibe el comportamiento de antes, sin aviso, y para un banco cuyo valor es que
 * sus números son ciertos ése es el peor fallo: un número plausible y falso.
 *
 * Así que el build escribe al lado del paquete la huella de los fuentes con los
 * que se hizo (`vite.node.config.ts`), y quien lo carga la compara con la de los
 * fuentes de ahora. La huella es el sha256 de cada fichero de `src/` con su ruta
 * relativa, en orden: dos árboles con el mismo contenido dan la misma huella en
 * cualquier máquina, y el `mtime` no entra —tocar un fichero sin cambiarlo no
 * es estar desfasado—.
 *
 * Coste medido el 2026-11-17 en esta máquina: ~5 ms para los ~110 ficheros de
 * `src/`. Se paga una vez por proceso, o una vez por llamada en el servidor MCP.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FINGERPRINT_FILE = "build-fingerprint.json";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Todos los ficheros bajo `root`, con ruta relativa en `/` y en orden. Los
 * ocultos (`.DS_Store`) no cuentan: no los compila nadie. */
export function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

/** La huella de un árbol de fuentes. */
export function sourceFingerprint(srcRoot) {
  const hash = createHash("sha256");
  for (const file of listFiles(srcRoot)) {
    hash.update(file).update("\0");
    hash.update(createHash("sha256").update(readFileSync(join(srcRoot, file))).digest("hex")).update("\n");
  }
  return hash.digest("hex");
}

/** La huella con la que se construyó el paquete de `distRoot`, o `null` si el
 * build es anterior a que existiera. */
export function builtFingerprint(distRoot) {
  const path = join(distRoot, FINGERPRINT_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")).sources ?? null;
}

/**
 * ¿Corresponde el paquete a los fuentes de ahora? Devuelve el mensaje listo para
 * stderr cuando no, con la orden que lo arregla.
 */
export function checkBuild(srcRoot = join(projectRoot, "src"), distRoot = join(projectRoot, "dist-node")) {
  const built = builtFingerprint(distRoot);
  const current = sourceFingerprint(srcRoot);
  const fresh = built === current;
  const message = fresh
    ? null
    : built === null
      ? "dist-node no lleva huella de compilación: no se sabe de qué fuentes salió. Recompila con `npm run build:agent3d`"
      : "dist-node está desfasado respecto a src/: lo que responde es la compilación anterior. Recompila con `npm run build:agent3d`";
  return { fresh, built, current, message };
}
