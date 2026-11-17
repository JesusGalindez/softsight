/**
 * Puerta de la huella de compilación: que el CLI no sirva una compilación vieja
 * sin decirlo.
 *
 * Tres cosas, y la segunda es la que importa:
 *
 * 1. Recién compilado, el paquete corresponde a `src/` y nadie avisa.
 * 2. **Un cambio de contenido cambia la huella**; tocar un fichero sin cambiarlo,
 *    o dejar un `.DS_Store`, no. Si fuera por `mtime`, el aviso saltaría al
 *    hacer `git checkout` y se aprendería a ignorar.
 * 3. Un paquete sin huella —compilado antes de que existiera— no se da por
 *    bueno: no se sabe de qué fuentes salió.
 *
 * Se prueba sobre una copia de `src/` en un directorio temporal: tocar el `src/`
 * de verdad desde una puerta sería escribir en el árbol de quien la ejecuta.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { builtFingerprint, checkBuild, sourceFingerprint } from "./buildFingerprint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

// 1. Recién compilado: fresco, y el CLI no avisa.
{
  const build = checkBuild();
  assert.ok(build.fresh, `recién compilado tendría que estar fresco: ${build.message}`);
  const salida = execFileSync(process.execPath, [resolve(here, "agent3d.mjs"), "--schema", "codes"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(salida.length > 0);
  console.log(`huella: ok (recién compilado, dist-node corresponde a src/: ${build.current.slice(0, 12)})`);
}

// 2. Contenido sí, mtime y ocultos no.
const copia = mkdtempSync(join(tmpdir(), "softsight-huella-"));
try {
  const src = join(copia, "src");
  cpSync(resolve(projectRoot, "src"), src, { recursive: true });
  const original = sourceFingerprint(src);
  assert.equal(original, checkBuild().current, "la copia tiene que dar la huella del original");

  const fichero = join(src, "soft/font.ts");
  utimesSync(fichero, new Date(0), new Date(0));
  writeFileSync(join(src, ".DS_Store"), "basura");
  assert.equal(sourceFingerprint(src), original, "ni el mtime ni un fichero oculto son un cambio");

  appendFileSync(fichero, "\n// cambio\n");
  const cambiada = sourceFingerprint(src);
  assert.notEqual(cambiada, original, "un cambio de contenido tiene que cambiar la huella");

  const dist = join(copia, "dist-node");
  cpSync(resolve(projectRoot, "dist-node"), dist, { recursive: true });
  const desfasado = checkBuild(src, dist);
  assert.equal(desfasado.fresh, false);
  assert.match(desfasado.message, /desfasado.*npm run build:agent3d/);
  console.log("huella: ok (un cambio de contenido la mueve y se avisa con la orden que lo arregla; el mtime y un .DS_Store no)");

  // 3. Sin huella no hay frescura que afirmar.
  rmSync(join(dist, "build-fingerprint.json"));
  assert.equal(builtFingerprint(dist), null);
  const sinHuella = checkBuild(src, dist);
  assert.equal(sinHuella.fresh, false);
  assert.match(sinHuella.message, /no lleva huella/);
  console.log("huella: ok (un paquete sin huella no se da por bueno: no se sabe de qué fuentes salió)");
} finally {
  rmSync(copia, { recursive: true, force: true });
}

console.log(
  "huella: fuera de alcance — el servidor MCP compara en cada llamada contra la huella con la que arrancó, " +
    "pero esa rama no se ejerce aquí: hacerlo pediría cambiar el src/ de verdad mientras el servidor corre",
);
