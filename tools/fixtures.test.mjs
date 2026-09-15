/**
 * Puerta de D22 — dónde viven los fixtures, y la fila que puede fallar callando.
 *
 * Las tres filas de la decisión se cumplen hoy y ninguna se comprueba:
 *
 * ```text
 * ligeros (< 1 MB, sintéticos)  →  en el repositorio, versionados
 * pesados (COLMAP real, 5M)     →  fuera, por variable de entorno, con sha256
 *                                  en un manifiesto versionado que sí está en git
 * sin fixture                   →  la puerta se declara NOT_RUN con su motivo;
 *                                  nunca PASS
 * ```
 *
 * Las dos primeras se rompen ruidosamente: alguien commitea 69 MB y se ve en el
 * diff. **La tercera se rompe en silencio**, y es la peligrosa: una puerta que
 * necesita un fixture ausente y sale verde sin decirlo deja un hueco del tamaño
 * de lo que esa puerta probaba, y el registro de la ejecución dice «ok».
 *
 * Por eso el bloque 3 no mira el código: **ejecuta** las puertas que dependen de
 * un fixture externo con la variable apuntando a un directorio vacío, y comprueba
 * las dos cosas a la vez — que salen con 0 y que lo dicen. Cualquiera de las dos
 * sola se puede fingir.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { colmapRoot } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const MEGA = 1024 * 1024;

/** Lo que git tiene versionado bajo una ruta. */
function versionados(ruta) {
  return execFileSync("git", ["ls-files", ruta], { cwd: projectRoot, encoding: "utf8" })
    .split("\n")
    .filter((linea) => linea.length > 0);
}

// 1. Los ligeros: dentro, versionados y por debajo del tope.
{
  const raiz = resolve(projectRoot, "contracts/fixtures");
  const enDisco = [];
  const recorrer = (directorio) => {
    for (const entrada of readdirSync(directorio).sort()) {
      const full = join(directorio, entrada);
      if (statSync(full).isDirectory()) recorrer(full);
      else enDisco.push(full);
    }
  };
  recorrer(raiz);

  const enGit = new Set(versionados("contracts/fixtures").map((ruta) => resolve(projectRoot, ruta)));
  const gordos = [];
  const sueltos = [];
  for (const fichero of enDisco) {
    const bytes = statSync(fichero).size;
    if (bytes >= MEGA) gordos.push(`${fichero} (${(bytes / MEGA).toFixed(1)} MiB)`);
    if (!enGit.has(fichero)) sueltos.push(fichero);
  }

  assert.deepEqual(gordos, [], `un fixture de un mega o más no va en el repositorio:\n${gordos.join("\n")}`);
  assert.deepEqual(
    sueltos,
    [],
    `un fixture sin versionar no es un fixture: mañana no está:\n${sueltos.join("\n")}`,
  );

  const mayor = enDisco.reduce((peor, f) => Math.max(peor, statSync(f).size), 0);
  console.log(
    `fixtures: ok (${enDisco.length} ficheros ligeros, todos versionados y el mayor de ` +
      `${(mayor / 1024).toFixed(0)} KiB, muy por debajo del mega de D22)`,
  );
}

// 2. Los pesados: fuera, con su sha256 en un manifiesto que sí está en git.
{
  const manifiesto = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/fixtures/colmap-real-v1.json"), "utf8"),
  );
  assert.ok(versionados("contracts/fixtures/colmap-real-v1.json").length === 1, "el manifiesto sí va en git");

  const declarados = [];
  for (const [escena, ficheros] of Object.entries(manifiesto.scenes)) {
    for (const [nombre, entrada] of Object.entries(ficheros)) {
      assert.match(entrada.sha256, /^[0-9a-f]{64}$/, `${escena}/${nombre}: el sha256 no es un sha256`);
      assert.ok(entrada.bytes > 0);
      declarados.push({ escena, nombre, ...entrada });
    }
  }

  // Y ninguno de ellos está en el repositorio. Si alguien los commiteara, el
  // manifiesto seguiría siendo correcto y D22 estaría rota igual.
  //
  // Por **ruta** y no por nombre: `cameras.txt` existe en el fixture sintético
  // `colmap-small-v1`, que sí va versionado, y en las dos escenas pesadas, que no.
  // Comparar por nombre suelto daba un falso positivo — el nombre de un fichero
  // no lo identifica.
  const enGit = new Set(versionados("contracts/fixtures"));
  for (const fichero of declarados) {
    assert.ok(
      !enGit.has(`contracts/fixtures/${fichero.escena}/${fichero.nombre}`),
      `${fichero.escena}/${fichero.nombre} se declara pesado y está versionado`,
    );
  }

  // Si están en disco, el hash cuadra. Si no, esa mitad se dice y no se finge.
  let comprobados = 0;
  for (const fichero of declarados) {
    const ruta = join(colmapRoot, fichero.escena, fichero.nombre);
    if (!existsSync(ruta)) continue;
    const real = createHash("sha256").update(readFileSync(ruta)).digest("hex");
    assert.equal(real, fichero.sha256, `${fichero.escena}/${fichero.nombre}: el contenido no es el declarado`);
    comprobados += 1;
  }

  console.log(
    `fixtures: ok (${declarados.length} ficheros pesados declarados por sha256 y ninguno versionado` +
      (comprobados > 0
        ? `; ${comprobados} presentes en ${colmapRoot} y sus hashes cuadran)`
        : `; ninguno presente, así que sus hashes no se comprueban en esta ejecución)`),
  );
}

// 3. **Sin fixture, NOT_RUN con su motivo. Nunca verde callando.**
//
// Se ejecutan de verdad, con la raíz apuntando a un directorio vacío. Comprobar
// solo la salida 0 dejaría pasar una puerta que se salta su trabajo; comprobar
// solo el texto dejaría pasar una que lo dice y luego falla.
{
  const vacio = mkdtempSync(join(tmpdir(), "softsight-sin-fixture-"));
  const dependientes = ["colmap.test.mjs", "producer-colmap.test.mjs", "producer-superficie.test.mjs"];

  for (const puerta of dependientes) {
    let salida = "";
    let codigo = 0;
    try {
      salida = execFileSync(process.execPath, [resolve(here, puerta)], {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, SOFTSIGHT_COLMAP: vacio },
      });
    } catch (error) {
      codigo = error.status ?? 1;
      salida = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    assert.equal(codigo, 0, `${puerta}: sin fixture tiene que salir con 0, y sale con ${codigo}`);
    const linea = salida.split("\n").find((entrada) => entrada.includes(": no ejecutada —"));
    assert.ok(linea !== undefined, `${puerta}: sin fixture no se declara no ejecutada:\n${salida.slice(-400)}`);
    // «Con su motivo», que es la mitad que importa: una línea que solo dijera
    // «no ejecutada» obliga a ir al código a averiguar qué falta.
    assert.ok(
      linea.split("no ejecutada —")[1].trim().length > 20,
      `${puerta}: se declara no ejecutada sin decir por qué: ${linea}`,
    );
  }

  rmSync(vacio, { recursive: true, force: true });

  console.log(
    `fixtures: ok (las ${dependientes.length} puertas que dependen del COLMAP real salen con 0 y se ` +
      "declaran no ejecutadas **con su motivo** cuando la raíz está vacía: ejecutadas de verdad, no leídas)",
  );
}

// 4. Y que el corredor de la suite reconoce esa línea.
//
// El mecanismo entero cuelga de una subcadena. Si alguien cambiara la redacción
// en una puerta, esa puerta pasaría a contarse como verde sin que nadie lo viera:
// el hueco no se notaría hasta necesitar lo que probaba.
{
  const corredor = readFileSync(resolve(here, "run-tests.mjs"), "utf8");
  assert.ok(
    corredor.includes('": no ejecutada —"'),
    "el corredor ya no busca la misma marca que las puertas escriben",
  );

  console.log(
    "fixtures: ok (el corredor busca la misma marca que las puertas escriben: el mecanismo entero cuelga " +
      "de esa subcadena, y una redacción distinta convertiría un hueco en un verde)",
  );
}

console.log(
  "fixtures: no ejecutada — la fila de los ligeros comprueba el tope y el versionado, no que sean " +
    "**sintéticos**: eso es un juicio sobre el origen del dato y no se deduce de los bytes. Y las puertas " +
    "que dependen de los fixtures del editor (SOFTSIGHT_FIXTURES) no entran en el bloque 3 porque su " +
    "raíz por defecto apunta fuera del repositorio y aquí no está",
);
