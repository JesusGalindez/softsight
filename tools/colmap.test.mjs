/**
 * Puerta del adaptador de COLMAP — D4.
 *
 * El juez son **las observaciones del propio fichero**. COLMAP guarda, para cada
 * imagen, dónde cayó cada punto 3D en píxeles; así que el camino entero se puede
 * cerrar sobre sí mismo sin inventar ningún valor dorado:
 *
 * ```text
 * points3D.txt + images.txt  →  adaptador  →  CameraSet canónico
 *                                              ↓ projectPoint
 *                            el mismo píxel que el fichero ya decía
 * ```
 *
 * Si el cuaternión se leyera como `(x, y, z, w)`, si la pose no se invirtiera, si
 * el marco de la cámara se confundiera con el de gráficos o si el orden de los
 * parámetros de un modelo estuviera cambiado, los píxeles no cuadrarían. Ninguna
 * de esas cuatro cosas se ve leyendo el código —las cuatro producen números
 * plausibles— y todas caen aquí.
 *
 * El fixture lo escribe `tools/colmapSmall.mjs` con la fórmula de COLMAP escrita
 * allí, no llamando al adaptador: generarlo con lo que se va a probar sería
 * dibujar la diana alrededor del disparo.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseColmapCameras,
  parseColmapModel,
  projectPoint,
  toCameraSet,
  validate,
  RECONSTRUCTION_PACKAGE_SCHEMA,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../contracts/fixtures/colmap-small-v1");

const model = parseColmapModel({
  cameras: readFileSync(resolve(FIXTURE, "cameras.txt"), "utf8"),
  images: readFileSync(resolve(FIXTURE, "images.txt"), "utf8"),
  points: readFileSync(resolve(FIXTURE, "points3D.txt"), "utf8"),
});

// 1. Lo que trae el fichero, leído.
{
  assert.equal(model.cameras.length, 3, "tres cámaras, con tres modelos distintos");
  assert.equal(model.images.length, 3);
  assert.equal(model.points.length, 12);
  assert.deepEqual(model.unsupported, []);

  // Los parámetros posicionales, ya con nombre (D19). `SIMPLE_RADIAL` tiene una
  // sola focal para los dos ejes: si el adaptador la repartiera mal, una imagen
  // saldría estirada y la proyección seguiría cuadrando en el centro.
  const [pinhole, radial, opencv] = model.cameras;
  assert.deepEqual(pinhole.intrinsics, { fx: 525.5, fy: 524.25, cx: 320.5, cy: 240.5 });
  assert.equal(pinhole.distortion, undefined, "una PINHOLE no lleva distorsión, ni ceros implícitos");
  assert.deepEqual(radial.intrinsics, { fx: 610.75, fy: 610.75, cx: 400.5, cy: 300.25 });
  assert.deepEqual(radial.distortion, { k1: -0.021 });
  assert.deepEqual(opencv.distortion, { k1: -0.035, k2: 0.011, p1: 0.0004, p2: -0.0007 });
  console.log(
    `colmap: ok (${model.cameras.length} cámaras con sus parámetros con nombre, ` +
      `${model.images.length} imágenes y ${model.points.length} puntos)`,
  );
}

// 2. El camino entero: cada observación del fichero, reproyectada.
{
  const cameraSet = toCameraSet(model);
  const points = new Map(model.points.map((point) => [point.id, point.position]));
  let comprobadas = 0;
  let peor = 0;

  model.images.forEach((image, index) => {
    const camera = cameraSet[index];
    assert.equal(camera.id, `img-${image.id}`);
    for (const observation of image.observations) {
      if (observation.pointId === null) continue;
      const point = points.get(observation.pointId);
      assert.ok(point !== undefined, `la observación cita el punto ${observation.pointId}, que no existe`);
      const projected = projectPoint(camera, point);
      const error = Math.hypot(projected.x - observation.x, projected.y - observation.y);
      // Una diezmilésima de píxel: el fixture guarda ocho decimales, así que lo
      // único que separa los dos números es el redondeo del texto. Un margen de
      // un píxel dejaría pasar medio píxel de convención equivocada.
      assert.ok(
        error < 1e-4,
        `${camera.id}, punto ${observation.pointId}: ${projected.x},${projected.y} contra ${observation.x},${observation.y}`,
      );
      assert.ok(projected.depth > 0, "un punto observado tiene que estar delante de la cámara");
      assert.ok(projected.inside, "un punto observado cae dentro de la imagen");
      peor = Math.max(peor, error);
      comprobadas += 1;
    }
  });

  assert.ok(comprobadas >= 24, `solo ${comprobadas} observaciones: el fixture no ejerce lo suficiente`);
  console.log(
    `colmap: ok (${comprobadas} observaciones del fichero reproyectadas por el CameraSet canónico, ` +
      `error máximo ${peor.toExponential(1)} píxeles)`,
  );
}

// 3. El CameraSet que sale es el del contrato, no uno parecido.
{
  const cameraSet = toCameraSet(model);
  const manifest = {
    documentType: "videomesh.reconstruction-package",
    contractVersion: "0.1",
    packageId: "colmap-small-v1",
    state: "SEALED",
    producer: { name: "softsight/colmapSmall", version: "0.1.0" },
    artifacts: cameraSet.map((camera) => ({
      id: camera.imageArtifactId,
      type: "IMAGE",
      path: `images/${camera.id}.jpg`,
      bytes: 1,
      sha256: "0".repeat(64),
    })),
    cameras: cameraSet,
    // COLMAP sin restricción externa no sabe a qué escala reconstruyó, y decir
    // otra cosa es lo que D9 impide. UNKNOWN es el dato, no un hueco.
    scale: { status: "UNKNOWN", source: "NONE" },
    frameGraph: { transforms: [] },
  };
  assert.deepEqual(validate(manifest, RECONSTRUCTION_PACKAGE_SCHEMA), []);
  for (const camera of cameraSet) {
    assert.equal(camera.cameraAxes, "X_RIGHT_Y_DOWN_Z_FORWARD", "COLMAP mira a +Z con la Y hacia abajo");
    assert.equal(camera.worldFromCamera.length, 16);
    assert.deepEqual(camera.worldFromCamera.slice(12), [0, 0, 0, 1], "la última fila de una pose rígida");
  }
  console.log("colmap: ok (el CameraSet convertido valida contra el esquema del paquete, con la escala en UNKNOWN)");
}

// 4. Un modelo que no sabemos convertir se dice, no se aproxima.
{
  const { cameras, unsupported } = parseColmapCameras(
    ["1 PINHOLE 640 480 525.5 524.25 320.5 240.5", "2 OPENCV_FISHEYE 640 480 1 2 3 4 5 6 7 8"].join("\n"),
  );
  assert.equal(cameras.length, 1);
  assert.deepEqual(unsupported, [{ cameraId: "2", model: "OPENCV_FISHEYE" }]);

  // Y un modelo conocido con parámetros de más se rechaza por su motivo: es un
  // fichero corrupto, no un modelo nuevo.
  assert.throws(
    () => parseColmapCameras("1 PINHOLE 640 480 525.5 524.25 320.5"),
    /COLMAP_CAMERA_INVALID: la cámara 1 declara PINHOLE con 3 parámetros/,
  );
  console.log(
    "colmap: ok (un ojo de pez se declara no soportado en vez de aproximarse a OPENCV, y una cámara " +
      "con parámetros de menos se rechaza por su motivo)",
  );
}

// 5. Lo que este fixture no puede probar, dicho en voz alta.
console.log(
  "colmap: no ejecutada — colmap-small-v1 es sintético: ejerce la conversión, no los datos. " +
    "Una reconstrucción real —ruido, observaciones sin triangular, cientos de imágenes— va fuera del " +
    "repositorio con su sha256 en un manifiesto, D22, y todavía no existe",
);
