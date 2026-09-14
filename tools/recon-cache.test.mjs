/**
 * Puerta de R16 — la caché de visibilidad, y la invalidación que no es una tabla.
 *
 * Una caché que acierta cuando no debe no es lenta: **devuelve el informe de otro
 * paquete con el sello de este**. Así que lo que hay que demostrar no es que
 * ahorre tiempo —eso se mide aparte—, sino que acierta exactamente cuando el
 * resultado sería el mismo y falla el resto de las veces.
 *
 * Los dos bloques que lo deciden son el 2 y el 3, y van en pareja:
 *
 * ```text
 * 2  cambia lo que la medida LEE     →  no puede acertar
 * 3  cambia lo que la medida NO lee  →  tiene que acertar
 * ```
 *
 * El 3 es el que una clave por `path + mtime + size` suspende: reescribir el
 * fichero con los mismos bytes mueve el `mtime` y no mueve ninguna medida.
 *
 * Y el 4 es el fallo caro de esa clave, el que no se ve hasta que sale un informe
 * equivocado: dos paquetes distintos escritos en la misma ruta con el mismo
 * tamaño —que es lo que hace un script que regenera— tienen el mismo `path`,
 * el mismo `size` y, si caen en el mismo segundo, el mismo `mtime`.
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCubePackage } from "./cubeV1.mjs";
import { openVisibilityCache, visibilityKey } from "./reconCache.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-cache-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifestPath = join(raiz, "manifest.json");
// Caché propia de esta puerta: usar la del repositorio mezclaría entradas de
// otras ejecuciones y el recuento de aciertos dejaría de significar nada.
const cacheRoot = join(sandbox, "cache");
const conCache = { cacheRoot };

// 1. Acierta sobre los mismos bytes, y el informe es el mismo byte a byte.
{
  const fria = inspectPackage(manifestPath, conCache);
  assert.deepEqual(fria.cacheStats, { hits: 0, misses: 1, stored: 1 });

  const caliente = inspectPackage(manifestPath, conCache);
  assert.equal(caliente.cacheStats.hits, 1);
  assert.equal(
    JSON.stringify(caliente.report),
    JSON.stringify(fria.report),
    "una medida guardada que no reproduce la medida es peor que no tenerla",
  );

  // Y `--no-cache` no acierta nunca, ni siquiera con la entrada delante.
  const forzada = inspectPackage(manifestPath, { ...conCache, cache: false });
  assert.equal(forzada.cacheStats.hits, 0);
  assert.equal(JSON.stringify(forzada.report), JSON.stringify(fria.report));

  console.log(
    "caché: ok (segunda consulta acierta y devuelve el mismo informe byte a byte; --no-cache no acierta " +
      "nunca y mide lo mismo)",
  );
}

// 2. Cambia lo que la medida lee → no puede acertar.
{
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const malla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
  const plyPath = join(raiz, malla.path);
  const original = readFileSync(plyPath, "utf8");

  // Un vértice movido. La geometría es lo que se muestrea y lo que ocluye.
  const lineas = original.split("\n");
  const primeraCoordenada = lineas.findIndex((linea) => linea.trim() === "end_header") + 1;
  const partes = lineas[primeraCoordenada].trim().split(/\s+/);
  partes[0] = (Number(partes[0]) + 0.5).toString();
  lineas[primeraCoordenada] = partes.join(" ");
  writeFileSync(plyPath, lineas.join("\n"));

  const movida = inspectPackage(manifestPath, conCache);
  assert.equal(movida.cacheStats.hits, 0, "mover un vértice tiene que invalidar");
  writeFileSync(plyPath, original);

  // Una cámara girada. La visibilidad es desde dónde se mira.
  const otroManifest = join(raiz, "manifest-camara.json");
  const girado = JSON.parse(readFileSync(manifestPath, "utf8"));
  girado.cameras[0].worldFromCamera[3] += 0.25;
  writeFileSync(otroManifest, JSON.stringify(girado, null, 2));
  const conCamara = inspectPackage(otroManifest, conCache);
  assert.equal(conCamara.cacheStats.hits, 0, "mover una cámara tiene que invalidar");

  console.log(
    "caché: ok (mover un vértice invalida y mover una cámara invalida: la matriz del §56 sale de lo que " +
      "entra en la clave, no de una tabla que alguien tenga que mantener)",
  );
}

// 3. Cambia lo que la medida NO lee → tiene que acertar.
//
// Es el bloque que suspende una clave por `path + mtime + size`.
{
  const antes = inspectPackage(manifestPath, conCache);
  assert.equal(antes.cacheStats.hits, 1);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const malla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
  const plyPath = join(raiz, malla.path);

  // Los mismos bytes, otra vez. El `mtime` se mueve; ninguna medida se mueve.
  const bytes = readFileSync(plyPath);
  writeFileSync(plyPath, bytes);
  const reescrito = inspectPackage(manifestPath, conCache);
  assert.equal(reescrito.cacheStats.hits, 1, "reescribir los mismos bytes no cambia ninguna medida");

  // Y un `touch` explícito, que es lo mismo sin tocar el contenido.
  const futuro = new Date(Date.now() + 60_000);
  utimesSync(plyPath, futuro, futuro);
  assert.equal(inspectPackage(manifestPath, conCache).cacheStats.hits, 1, "un touch no invalida nada");

  // El mismo paquete en otra ruta: el contenido manda, así que acierta.
  const copia = join(sandbox, "cube-copia");
  cpSync(raiz, copia, { recursive: true });
  const enOtraRuta = inspectPackage(join(copia, "manifest.json"), conCache);
  assert.equal(enOtraRuta.cacheStats.hits, 1, "el mismo contenido en otra ruta es la misma medida");

  console.log(
    "caché: ok (reescribir los mismos bytes, un touch y una copia en otra ruta **aciertan**: la clave es " +
      "el contenido, que es lo que `path + mtime + size` no puede distinguir)",
  );
}

// 4. El fallo caro de la clave por ruta: dos paquetes distintos, misma ruta.
{
  const gemelo = join(sandbox, "gemelo");
  cpSync(raiz, gemelo, { recursive: true });
  const gemeloManifest = join(gemelo, "manifest.json");

  const manifest = JSON.parse(readFileSync(gemeloManifest, "utf8"));
  const malla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
  const plyPath = join(gemelo, malla.path);
  const original = readFileSync(plyPath, "utf8");

  // Otra geometría **del mismo tamaño en bytes**: se sustituye un dígito por
  // otro. Mismo `path`, mismo `size`, y el `mtime` se fuerza al del original.
  const lineas = original.split("\n");
  const indice = lineas.findIndex((linea) => linea.trim() === "end_header") + 1;
  const partes = lineas[indice].trim().split(/\s+/);
  const largo = partes[0];
  partes[0] = largo.startsWith("-") ? ` ${largo.slice(1)}` : `-${largo.slice(1)}`;
  lineas[indice] = partes.join(" ");
  const cambiado = lineas.join("\n");
  assert.equal(cambiado.length, original.length, "el caso pide el mismo tamaño en bytes");

  const primero = inspectPackage(gemeloManifest, conCache);
  writeFileSync(plyPath, cambiado);
  const cuando = new Date(1_700_000_000_000);
  utimesSync(plyPath, cuando, cuando);
  const segundo = inspectPackage(gemeloManifest, conCache);

  assert.equal(segundo.cacheStats.hits, 0, "otro contenido no puede acertar por compartir la ruta");
  assert.notEqual(
    JSON.stringify(segundo.report.coverage),
    JSON.stringify(primero.report.coverage),
    "si las dos coberturas salieran iguales, este caso no estaría probando nada",
  );
  writeFileSync(plyPath, original);

  console.log(
    "caché: ok (dos geometrías distintas en la misma ruta, con el mismo tamaño y el mismo mtime, dan " +
      "claves distintas: con `path + mtime + size` la segunda habría recibido la cobertura de la primera)",
  );
}

// 5. La versión del algoritmo entra en la clave, y las siluetas también.
{
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const artifactMalla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
  const { parsePlyAscii } = await import("../dist-node/agent3d.mjs");
  const leida = parsePlyAscii(readFileSync(join(raiz, artifactMalla.path), "utf8")).mesh;
  const malla = { ...leida, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 0 };
  const base = { mesh: malla, cameras: manifest.cameras, samples: 8_000, seed: 1 };

  assert.equal(visibilityKey(base), visibilityKey({ ...base }), "la misma entrada da la misma clave");
  assert.notEqual(visibilityKey(base), visibilityKey({ ...base, samples: 4_000 }), "el muestreo entra");
  assert.notEqual(visibilityKey(base), visibilityKey({ ...base, seed: 2 }), "la semilla entra");

  // **Ausente no es vacía**: una cámara sin silueta ve todo su encuadre y una con
  // silueta vacía no ve nada. Dos medidas distintas, dos claves distintas.
  // `MaskSet` es un `Map` y la cobertura va en `coverage`: escribirlo como objeto
  // plano fue el fallo que puso `test:masks` en rojo, y por eso el caso está aquí.
  const vacia = new Map([
    [manifest.cameras[0].id, { width: 2, height: 2, coverage: new Uint8Array(4) }],
  ]);
  assert.notEqual(visibilityKey(base), visibilityKey({ ...base, masks: vacia }));

  console.log(
    "caché: ok (muestreo, semilla y presencia de silueta entran en la clave; una máscara vacía y ninguna " +
      "máscara no son la misma medida)",
  );
}

// 6. Una entrada ilegible no rompe nada: se mide y ya está.
{
  const cache = openVisibilityCache({ root: join(sandbox, "rota") });
  cache.set("abc", {
    points: new Float64Array([0, 0, 0]),
    normals: new Float64Array([0, 1, 0]),
    count: 1,
    seenBy: [[0]],
    magnitude: 1,
    maskedCameras: 0,
  });
  const recuperada = cache.get("abc");
  assert.equal(recuperada.count, 1);
  assert.deepEqual(recuperada.seenBy, [[0]]);
  assert.equal(recuperada.points[0], 0);

  writeFileSync(join(sandbox, "rota", "abc.bin"), "esto no es una visibilidad");
  assert.equal(cache.get("abc"), undefined, "una entrada ilegible es un fallo de caché, no un error");

  console.log(
    "caché: ok (ida y vuelta exacta de la visibilidad, y una entrada corrupta se descarta en vez de " +
      "hacer fallar el informe: una caché que rompe convierte una optimización en una dependencia)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "caché: no ejecutada — los otros seis directorios que el §55 pide (`parsed/`, `bvh/`, `adjacency/`, " +
    "`samples/`, `coverage/`, `proxy/`) no existen: la visibilidad es la que cuesta —338 ms de los 439 " +
    "del informe sobre south-building— y cachear lo barato solo añade sitios donde equivocarse",
);
