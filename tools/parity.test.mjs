/**
 * Puerta de paridad — D23 contra valores dorados.
 *
 * ## Qué añade esto sobre una prueba normal
 *
 * Que **el número no lo escribe el código que lo comprueba**. Los valores viven
 * en `contracts/fixtures/package-parity-v1.json` con la fórmula al lado, así que
 * cualquiera los rehace desde los ficheros en crudo sin leer una línea nuestra.
 * Es la única forma de que `SoftSight ↔ VideoMesh` signifique algo: dos
 * implementaciones que coinciden pueden compartir el mismo error; dos que
 * coinciden **y** caen en un número derivado aparte, no.
 *
 * ## Las tres columnas, y cuál falta
 *
 * ```text
 * SoftSight ↔ dorados        las tres filas, sobre los dos paquetes
 * productor ↔ dorados        `producers/colmap`, que no importa nada nuestro
 * SoftSight ↔ productor      los dos lectores de COLMAP, escritos aparte
 * ```
 *
 * La tercera es la que de verdad juzga, y por eso el bloque 4 compara los dos
 * lectores **número a número y exacto**: los escribió el mismo repositorio pero
 * no el mismo código, y el fixture está en medio para que coincidir no baste.
 *
 * ## La trampa de la fila 2
 *
 * Sobre `cube-v1` la normalización del marco es la identidad, así que una
 * implementación que **ignore el grafo entero** acierta. Por eso el bloque 3 no
 * usa la identidad: rota treinta grados, traslada, y uno de los casos exige
 * componer dos aristas en el orden correcto. Sin eso, la fila no distingue nada.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditMesh, parseColmapModel, parsePlyAscii, resolveFrame } from "../dist-node/agent3d.mjs";
import { readCameras, readImages, readPoints } from "../producers/colmap/build.mjs";
import { writeCubePackage } from "./cubeV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const dorados = JSON.parse(
  readFileSync(join(projectRoot, "contracts/fixtures/package-parity-v1.json"), "utf8"),
);
const colmapRaiz = join(projectRoot, "contracts/fixtures/colmap-small-v1");
const textos = {
  cameras: readFileSync(join(colmapRaiz, "cameras.txt"), "utf8"),
  images: readFileSync(join(colmapRaiz, "images.txt"), "utf8"),
  points: readFileSync(join(colmapRaiz, "points3D.txt"), "utf8"),
};

const sandbox = mkdtempSync(join(tmpdir(), "softsight-paridad-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const malla = parsePlyAscii(readFileSync(join(raiz, "mesh.ply"), "utf8")).mesh;
// Una nube no trae malla: `parsePlyAscii` devuelve `mesh: null` y las posiciones
// aparte, que es lo correcto —ocho puntos sin caras no son una superficie—.
const nube = parsePlyAscii(readFileSync(join(raiz, "sparse.ply"), "utf8")).points;

/** Caja de una malla, midiendo los vértices. Redondeada como el fixture. */
function caja(positions, matrix) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    const p = [positions[index], positions[index + 1], positions[index + 2]];
    // Se transforma **el vértice**, no la caja: una caja rotada deja de estar
    // alineada con los ejes, así que rotar sus dos esquinas da otra cosa.
    const q =
      matrix === undefined
        ? p
        : [
            matrix[0] * p[0] + matrix[1] * p[1] + matrix[2] * p[2] + matrix[3],
            matrix[4] * p[0] + matrix[5] * p[1] + matrix[6] * p[2] + matrix[7],
            matrix[8] * p[0] + matrix[9] * p[1] + matrix[10] * p[2] + matrix[11],
          ];
    for (let axis = 0; axis < 3; axis += 1) {
      if (q[axis] < min[axis]) min[axis] = q[axis];
      if (q[axis] > max[axis]) max[axis] = q[axis];
    }
  }
  const round = (value) => Number(value.toFixed(6));
  return { min: min.map(round), max: max.map(round) };
}

// 1. Fila 1 — recuentos.
{
  const esperado = dorados.recuentos["cube-v1"];
  assert.equal(manifest.artifacts.length, esperado.artifacts);
  assert.equal(malla.positions.length / 3, esperado.malla.vertices);
  assert.equal(malla.indices.length / 3, esperado.malla.triangulos);
  assert.equal(nube.positions.length / 3, esperado.nube.puntos);
  assert.equal(
    manifest.artifacts.filter((artifact) => artifact.type === "IMAGE").length,
    esperado.imagenes,
  );
  // Soldados: la otra pregunta, la que contesta `auditMesh`. 24 y 8 son los dos
  // ciertos, y por eso van los dos en el fixture.
  const auditoria = auditMesh({
    ...malla,
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    boundingRadius: 0,
  });
  assert.equal(
    auditoria.vertices - auditoria.duplicatePositions,
    esperado.malla.verticesSoldados,
    "los vértices soldados son los del PLY menos los repetidos",
  );

  const colmap = dorados.recuentos["colmap-small-v1"];
  const modelo = parseColmapModel(textos);
  assert.equal(modelo.cameras.length, colmap.calibraciones);
  assert.equal(modelo.images.length, colmap.imagenesRegistradas);
  assert.equal(modelo.points.length, colmap.puntos);
  assert.equal(
    modelo.images.reduce((total, image) => total + image.observations.length, 0),
    colmap.observaciones,
  );

  console.log(
    `paridad: ok (fila 1, recuentos: cube-v1 con ${esperado.malla.vertices} vértices ` +
      `(${esperado.malla.verticesSoldados} soldados) y ${esperado.malla.triangulos} triángulos; ` +
      `colmap-small-v1 con ${colmap.calibraciones} calibraciones, ${colmap.puntos} puntos y ` +
      `${colmap.observaciones} observaciones)`,
  );
}

// 2. Fila 2 — la caja, sobre los dos paquetes.
{
  const esperado = dorados.caja["cube-v1"];
  assert.deepEqual(caja(malla.positions), esperado.malla);
  assert.deepEqual(caja(nube.positions), esperado.nube);

  // Normalizada por el grafo **del paquete**, que aquí declara la identidad.
  const hacia = resolveFrame(manifest.frameGraph.transforms, "RECONSTRUCTION", "ASSET_CANONICAL");
  assert.ok(hacia !== null, "cube-v1 declara la arista, así que tiene que haber camino");
  assert.deepEqual(caja(malla.positions, hacia), esperado.enASSET_CANONICAL);

  const modelo = parseColmapModel(textos);
  const puntos = new Float64Array(modelo.points.length * 3);
  modelo.points.forEach((point, index) => {
    puntos[index * 3] = point.position[0];
    puntos[index * 3 + 1] = point.position[1];
    puntos[index * 3 + 2] = point.position[2];
  });
  assert.deepEqual(caja(puntos), dorados.caja["colmap-small-v1"].nube);

  console.log(
    `paridad: ok (fila 2, caja: el cubo en [${esperado.malla.min}] a [${esperado.malla.max}] y la ` +
      `nube de colmap-small-v1 en [${dorados.caja["colmap-small-v1"].nube.min}] a ` +
      `[${dorados.caja["colmap-small-v1"].nube.max}])`,
  );
}

// 3. Fila 2, la parte que de verdad juzga: normalizar **no es** la identidad.
{
  for (const escenario of dorados.caja.normalizacion) {
    const matrix = resolveFrame(escenario.transforms, escenario.de, escenario.a);
    if (escenario.caja === null) {
      // **null y no la identidad.** Es el hallazgo que este caso protege: un
      // grafo sin camino no se completa suponiendo que son el mismo marco.
      assert.equal(matrix, null, `${escenario.caso}: hay camino donde no lo hay`);
      continue;
    }
    assert.ok(matrix !== null, `${escenario.caso}: no hay camino y debería haberlo`);
    assert.deepEqual(caja(malla.positions, matrix), escenario.caja, escenario.caso);
  }

  // Y que los tres casos den cosas distintas: si dos coincidieran, uno de ellos
  // no estaría comprobando nada.
  const [unaArista, dosAristas] = dorados.caja.normalizacion;
  assert.notDeepEqual(unaArista.caja, dorados.caja["cube-v1"].malla);
  assert.notDeepEqual(dosAristas.caja, unaArista.caja);

  console.log(
    `paridad: ok (fila 2, normalización: una arista lleva el cubo a ` +
      `[${unaArista.caja.min}], dos compuestas en orden a [${dosAristas.caja.min}], y sin camino ` +
      "devuelve null en vez de la identidad)",
  );
}

// 4. Fila 3 — cámaras registradas, **y las dos implementaciones**.
{
  for (const esperada of dorados.camaras["cube-v1"]) {
    const camera = manifest.cameras.find((entry) => entry.id === esperada.id);
    assert.ok(camera !== undefined, `${esperada.id} no está en el CameraSet`);
    for (const campo of ["imageArtifactId", "width", "height", "model", "cameraAxes", "pixelOrigin", "pixelCenter"]) {
      assert.equal(camera[campo], esperada[campo], `${esperada.id}.${campo}`);
    }
  }
  assert.equal(manifest.cameras.length, dorados.camaras["cube-v1"].length);

  // Las dos lecturas de COLMAP: la nuestra y la del productor, escritas aparte
  // desde la misma documentación del formato.
  const nuestro = parseColmapModel(textos);
  const suyoCamaras = readCameras(textos.cameras);
  const suyoImagenes = readImages(textos.images);
  const suyoPuntos = readPoints(textos.points);

  const centro = (worldFromCamera) => [worldFromCamera[3], worldFromCamera[7], worldFromCamera[11]];
  let peorCentro = 0;
  for (const esperada of dorados.camaras["colmap-small-v1"]) {
    const suya = suyoImagenes.find((image) => image.name === esperada.nombre);
    const nuestra = nuestro.images.find((image) => image.name === esperada.nombre);
    assert.ok(suya !== undefined && nuestra !== undefined, `${esperada.nombre}: falta en una lectura`);
    assert.equal(suya.id, esperada.imageId);
    assert.equal(suya.cameraId, esperada.cameraId);

    const calibracion = suyoCamaras.get(esperada.cameraId);
    assert.equal(calibracion.width, esperada.width);
    assert.equal(calibracion.height, esperada.height);
    // El modelo de COLMAP y el del contrato **no son el mismo dato**:
    // `SIMPLE_RADIAL` sale como `OPENCV` con un solo coeficiente.
    assert.equal(calibracion.model, esperada.modeloContrato, `${esperada.nombre}: modelo del contrato`);
    assert.deepEqual(calibracion.distortion ?? null, esperada.distorsion);

    // El centro contra el dorado, que se derivó aparte con C = −Rᵀt.
    const suyoCentro = centro(suya.worldFromCamera);
    for (let axis = 0; axis < 3; axis += 1) {
      peorCentro = Math.max(peorCentro, Math.abs(suyoCentro[axis] - esperada.centro[axis]));
    }
    // Y las dos implementaciones entre sí: **exacto**, sin tolerancia. Las dos
    // hacen la misma aritmética sobre los mismos decimales, y una tolerancia
    // aquí escondería una divergencia real.
    const nuestroCentro = centro(nuestra.worldFromCamera);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.equal(suyoCentro[axis], nuestroCentro[axis], `${esperada.nombre}: los dos centros difieren`);
    }
  }
  // Seis decimales es lo que el cuaternión redondeado del fichero sostiene, y
  // redondear a seis no puede desviar más de 5e-7. El tope **es** esa cota, no
  // una tolerancia elegida: cualquier número mayor sería una divergencia real.
  assert.ok(peorCentro <= 5e-7, `el peor centro se desvía ${peorCentro} del dorado`);
  assert.equal(suyoPuntos.size, nuestro.points.length, "los dos lectores cuentan puntos distintos");

  console.log(
    `paridad: ok (fila 3, cámaras: las 4 de cube-v1 campo a campo, y las 3 de colmap-small-v1 por dos ` +
      `lecturas independientes — contra el dorado a ${peorCentro.toExponential(1)} y entre ellas exactas a 0)`,
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "paridad: no ejecutada — falta la columna de un consumidor de fuera. `producers/colmap` cubre la " +
    "de `colmap-small-v1` porque tiene su propio lector, pero de `cube-v1` no hay segunda " +
    "implementación: lo escribimos nosotros y nadie más lo ha vuelto a escribir",
);
