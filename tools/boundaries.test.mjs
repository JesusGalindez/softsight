/**
 * Puerta de D27 — la frontera modular, comprobada en vez de respetada.
 *
 * Las cuatro reglas de aquí abajo se cumplen hoy, y ninguna las comprueba. Eso
 * no es que sobren: es lo que hace que sobren **hasta el primer import cómodo**.
 * Una frontera que solo vive en la cabecera de un fichero no es una frontera, es
 * una costumbre, y una costumbre se rompe sin que nadie se entere — en un
 * repositorio de cincuenta módulos, con el autocompletado ayudando.
 *
 * Lo que se comprueba, y de dónde sale cada regla:
 *
 * ```text
 * 1  src/soft/** no importa node:*        lo que permite que el mismo código
 *                                          corra en el navegador
 * 2  el núcleo no importa reconstruction/ D27: si fuera en los dos sentidos,
 *    ni production/                        no sería una frontera
 * 3  reconstruction/ no importa           producción es posterior a
 *    production/                           reconstrucción, no al revés
 * 4  producers/ no importa de src/,       R0-B: es lo que los hace productores
 *    tools/ ni dist-node/                  y no extensiones del verificador
 * ```
 *
 * La 1 me la salté yo mismo construyendo R16 y lo resolví a mano: la caché de
 * visibilidad vive en `tools/` justo por eso. Salió bien porque me acordé. Esta
 * puerta existe para las veces que no.
 *
 * La 2 es la más importante y la más fácil de romper sin querer. Hoy solo el
 * barril —`index.ts`— toca los dos módulos, que es exactamente lo que significa
 * «consumen las APIs públicas o del núcleo». Si `mesh.ts` importara de
 * `production/collision`, el núcleo pasaría a depender de la capa que lo usa y
 * la frontera desaparecería sin que nada se rompiera **todavía**.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/** Todos los ficheros de código bajo `raiz`, en orden estable. */
function sourceFiles(raiz, extensions = [".ts", ".mjs"]) {
  const out = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
    }
  };
  walk(resolve(projectRoot, raiz));
  return out;
}

/**
 * Los especificadores que un fichero importa.
 *
 * Por expresión regular y no con un parseador: lo que se busca es la cadena
 * entre comillas de un `import ... from` o un `import(...)`, que en este
 * repositorio no aparece de ninguna otra forma. Un parseador de TypeScript
 * entero sería una dependencia —y la casa no tiene ninguna— para leer una línea.
 */
function importsOf(path) {
  const text = readFileSync(path, "utf8");
  const found = [];
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    found.push(match[1]);
  }
  return found;
}

/** El especificador resuelto a ruta del repositorio, o `null` si no es relativo. */
function resolveLocal(fromPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  return relative(projectRoot, resolve(dirname(fromPath), specifier));
}

/**
 * Las cuatro reglas, cada una como función de «qué ficheros hay» y «qué importa
 * cada uno».
 *
 * No leen el disco por su cuenta y eso es el punto: el bloque 5 les pasa
 * importaciones inventadas y comprueba que las cazan. Una puerta que solo se ha
 * visto verde no ha demostrado que mire nada, y ésta nació verde.
 */
function nodeEnElNucleo(files, imports) {
  const culpables = [];
  for (const path of files) {
    for (const specifier of imports(path)) {
      if (specifier.startsWith("node:")) culpables.push(`${relative(projectRoot, path)} → ${specifier}`);
    }
  }
  return culpables;
}

function nucleoHaciaLasCapas(files, imports) {
  const culpables = [];
  for (const path of files) {
    const suyo = relative(projectRoot, path);
    // Los propios módulos de las capas, y el barril que existe para publicarlas.
    if (suyo.includes("/reconstruction/") || suyo.includes("/production/")) continue;
    if (suyo === "src/soft/agent/index.ts") continue;
    for (const specifier of imports(path)) {
      const local = resolveLocal(path, specifier);
      if (local === null) continue;
      if (local.includes("agent/reconstruction/") || local.includes("agent/production/")) {
        culpables.push(`${suyo} → ${specifier}`);
      }
    }
  }
  return culpables;
}

function reconstruccionHaciaProduccion(files, imports) {
  const culpables = [];
  for (const path of files) {
    for (const specifier of imports(path)) {
      const local = resolveLocal(path, specifier);
      if (local !== null && local.includes("/production/")) {
        culpables.push(`${relative(projectRoot, path)} → ${specifier}`);
      }
    }
  }
  return culpables;
}

function productorHaciaLaCasa(files, imports) {
  const culpables = [];
  for (const path of files) {
    for (const specifier of imports(path)) {
      if (specifier.startsWith("node:")) continue;
      const local = resolveLocal(path, specifier);
      // Un import entre ficheros del propio productor vale; salir de
      // `producers/` no.
      if (local === null || !local.startsWith("producers/")) {
        culpables.push(`${relative(projectRoot, path)} → ${specifier}`);
      }
    }
  }
  return culpables;
}

// 1. `src/soft/**` no toca `node:*`.
{
  const culpables = nodeEnElNucleo(sourceFiles("src/soft"), importsOf);
  assert.deepEqual(
    culpables,
    [],
    `el núcleo tiene que correr en el navegador y esto lo impide:\n${culpables.join("\n")}`,
  );

  console.log(
    `frontera: ok (${sourceFiles("src/soft").length} ficheros del núcleo y ninguno importa node:*, que es ` +
      "lo que permite que el mismo código corra en el navegador y en el CLI)",
  );
}

// 2. El núcleo no importa las dos capas. **Solo el barril**.
{
  const culpables = nucleoHaciaLasCapas(sourceFiles("src/soft"), importsOf);
  assert.deepEqual(
    culpables,
    [],
    `la frontera de D27 va en un solo sentido y esto la cruza al revés:\n${culpables.join("\n")}`,
  );

  console.log(
    "frontera: ok (solo `index.ts` toca reconstruction/ y production/ desde fuera: el núcleo no puede " +
      "depender de la capa que lo usa, o la frontera deja de serlo)",
  );
}

// 3. Reconstrucción no sabe de producción; producción sí de reconstrucción.
{
  const alReves = reconstruccionHaciaProduccion(sourceFiles("src/soft/agent/reconstruction"), importsOf);
  assert.deepEqual(alReves, [], `reconstrucción es anterior a producción:\n${alReves.join("\n")}`);

  // Y el sentido bueno existe de verdad: si no, la regla de arriba se cumpliría
  // por no haber ninguna relación, y no probaría nada.
  const haciaAtras = sourceFiles("src/soft/agent/production").flatMap((path) =>
    importsOf(path).filter((specifier) => (resolveLocal(path, specifier) ?? "").includes("/reconstruction/")),
  );
  assert.ok(
    haciaAtras.length > 0,
    "producción tiene que leer de reconstrucción; si no, esta regla no está probando nada",
  );

  console.log(
    `frontera: ok (producción lee de reconstrucción en ${haciaAtras.length} sitios y reconstrucción no ` +
      "lee de producción en ninguno: la dependencia tiene un sentido y se comprueba que es ése)",
  );
}

// 4. Los productores no importan nada de la casa — D34 y R0-B.
//
// Es lo que los hace **segundos productores** y no extensiones del verificador:
// un productor que importara `auditMesh` estaría coincidiendo consigo mismo.
{
  const culpables = productorHaciaLaCasa(sourceFiles("producers", [".mjs"]), importsOf);
  assert.deepEqual(
    culpables,
    [],
    `un productor que importe del verificador coincide consigo mismo:\n${culpables.join("\n")}`,
  );

  console.log(
    `frontera: ok (${sourceFiles("producers", [".mjs"]).length} ficheros en producers/ y ninguno importa ` +
      "de src/, tools/ ni dist-node/: es lo que hace que su acuerdo con el adaptador signifique algo)",
  );
}

// 5. **Que las cuatro se ponen rojas.**
//
// Es el bloque que hace creíbles a los otros cuatro. Esta puerta nació verde
// —las cuatro reglas ya se cumplían— y una puerta que nunca ha fallado no ha
// demostrado que mire nada: una que devolviera siempre la lista vacía habría
// pasado exactamente igual arriba.
//
// Las violaciones son inventadas y no se escriben en el disco: lo que se
// comprueba es la regla, y tocar el árbol de verdad para probarla dejaría el
// repositorio roto si la puerta muriera a medias.
{
  const falso = (tabla) => (path) => tabla[relative(projectRoot, path)] ?? [];

  const conNode = nodeEnElNucleo(
    [resolve(projectRoot, "src/soft/agent/inspect.ts")],
    falso({ "src/soft/agent/inspect.ts": ["./mesh", "node:fs"] }),
  );
  assert.equal(conNode.length, 1, "un node:fs en el núcleo tiene que salir");
  assert.match(conNode[0], /node:fs/);

  const alReves = nucleoHaciaLasCapas(
    [resolve(projectRoot, "src/soft/mesh.ts")],
    falso({ "src/soft/mesh.ts": ["./agent/production/collision"] }),
  );
  assert.equal(alReves.length, 1, "el núcleo tirando de una capa tiene que salir");
  // Y el barril sigue pudiendo: es su trabajo, y una regla que también lo
  // cazara obligaría a no publicar las capas.
  assert.deepEqual(
    nucleoHaciaLasCapas(
      [resolve(projectRoot, "src/soft/agent/index.ts")],
      falso({ "src/soft/agent/index.ts": ["./production/collision"] }),
    ),
    [],
  );

  const cruzada = reconstruccionHaciaProduccion(
    [resolve(projectRoot, "src/soft/agent/reconstruction/coverage.ts")],
    falso({ "src/soft/agent/reconstruction/coverage.ts": ["../production/silhouette"] }),
  );
  assert.equal(cruzada.length, 1, "reconstrucción tirando de producción tiene que salir");

  const productorTramposo = productorHaciaLaCasa(
    [resolve(projectRoot, "producers/colmap/build.mjs")],
    falso({ "producers/colmap/build.mjs": ["node:fs", "./ayuda.mjs", "../../dist-node/agent3d.mjs"] }),
  );
  assert.equal(productorTramposo.length, 1, "un productor importando del verificador tiene que salir");
  assert.match(productorTramposo[0], /dist-node/);

  console.log(
    "frontera: ok (las cuatro reglas cazan su violación inventada, y el barril sigue pudiendo importar " +
      "las capas: sin este bloque, una regla que devolviera siempre la lista vacía habría pasado igual)",
  );
}

console.log(
  "frontera: no ejecutada — el sentido que D27 deja abierto sigue sin comprobarse: qué módulos del " +
    "núcleo pueden consumir las dos capas. Hoy son cinco —`mesh`, `boundsTree`, `inspect`, `schema` y " +
    "`versions`— y fijar esa lista sería convertir el estado actual en regla sin que nadie lo haya decidido",
);
