/**
 * Generador de `colmap-small-v1`: una reconstrucción sintética **en el formato de
 * COLMAP**, no en el nuestro.
 *
 * D4 pide datos reales para ejercer lo que un cubo no ejerce: modelos de cámara
 * con distorsión, poses arbitrarias y observaciones 2D. Una reconstrucción de
 * COLMAP de verdad pesa cientos de megas y va fuera del repositorio (D22); esto
 * es la parte que sí cabe versionada, y sirve para lo que importa: **comprobar la
 * conversión**, que es donde están los errores que no se ven.
 *
 * La regla que lo hace una prueba y no un espejo: **los ficheros se escriben con
 * la fórmula de COLMAP, escrita aquí**, y el adaptador los lee con la suya. Si
 * alguna de las dos conversiones —cuaternión, inversión de la pose, orden de los
 * parámetros del modelo, marco de la cámara— estuviera mal, los píxeles
 * observados no coincidirían con los proyectados. Generarlos llamando al
 * adaptador sería dibujar la diana alrededor del disparo.
 *
 *   node tools/colmapSmall.mjs            reescribe el fixture
 *   node tools/colmapSmall.mjs --out DIR  en otro sitio
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/**
 * Tres cámaras que no comparten nada: una sin distorsión, una con un radial
 * simple y una OPENCV con tangencial. Si el adaptador confundiera el orden de los
 * parámetros de un modelo con el de otro, con una sola cámara podría colar.
 */
const CAMERAS = [
  { id: 1, model: "PINHOLE", width: 640, height: 480, params: [525.5, 524.25, 320.5, 240.5] },
  { id: 2, model: "SIMPLE_RADIAL", width: 800, height: 600, params: [610.75, 400.5, 300.25, -0.021] },
  {
    id: 3,
    model: "OPENCV",
    width: 1024,
    height: 768,
    params: [812.5, 811.75, 512.5, 384.25, -0.035, 0.011, 0.0004, -0.0007],
  },
];

/**
 * Poses en la forma de COLMAP: cuaternión `(w, x, y, z)` y traslación de
 * `cameraFromWorld`. Elegidas a mano, con giros en tres ejes distintos, para que
 * una transposición o un cuaternión leído como `(x, y, z, w)` salte.
 */
const IMAGES = [
  { id: 1, cameraId: 1, name: "frame_0001.jpg", q: [0.92388, 0.38268, 0, 0], t: [0.15, -0.22, 3.4] },
  { id: 2, cameraId: 2, name: "frame_0002.jpg", q: [0.86603, 0, 0.5, 0], t: [-0.4, 0.12, 3.9] },
  { id: 3, cameraId: 3, name: "frame_0003.jpg", q: [0.97237, 0.13795, 0.16554, 0.10336], t: [0.05, 0.3, 4.2] },
];

/** Doce puntos repartidos, ninguno en un eje: un signo cruzado tiene que verse. */
const POINTS = [];
for (const x of [-0.6, 0.35]) {
  for (const y of [-0.45, 0.55]) {
    for (const z of [-0.5, 0.4, 0.9]) {
      POINTS.push([x, y, z]);
    }
  }
}

/** Cuaternión `(w, x, y, z)` a matriz de rotación por filas, normalizando primero. */
function rotation([w, x, y, z]) {
  const length = Math.hypot(w, x, y, z) || 1;
  w /= length;
  x /= length;
  y /= length;
  z /= length;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Proyección de COLMAP, tal y como la documenta: el punto al marco de la cámara
 * —que mira a +Z—, normalizado, distorsionado según el modelo, y a píxeles.
 */
function projectColmap(camera, image, point) {
  const r = rotation(image.q);
  const cameraSpace = [
    r[0] * point[0] + r[1] * point[1] + r[2] * point[2] + image.t[0],
    r[3] * point[0] + r[4] * point[1] + r[5] * point[2] + image.t[1],
    r[6] * point[0] + r[7] * point[1] + r[8] * point[2] + image.t[2],
  ];
  if (cameraSpace[2] <= 0) return null;

  let x = cameraSpace[0] / cameraSpace[2];
  let y = cameraSpace[1] / cameraSpace[2];

  let fx;
  let fy;
  let cx;
  let cy;
  if (camera.model === "PINHOLE") {
    [fx, fy, cx, cy] = camera.params;
  } else if (camera.model === "SIMPLE_RADIAL") {
    const [f, ccx, ccy, k1] = camera.params;
    fx = f;
    fy = f;
    cx = ccx;
    cy = ccy;
    const r2 = x * x + y * y;
    x *= 1 + k1 * r2;
    y *= 1 + k1 * r2;
  } else {
    const [ffx, ffy, ccx, ccy, k1, k2, p1, p2] = camera.params;
    fx = ffx;
    fy = ffy;
    cx = ccx;
    cy = ccy;
    const r2 = x * x + y * y;
    const radial = 1 + k1 * r2 + k2 * r2 * r2;
    const nx = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const ny = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = nx;
    y = ny;
  }

  return [fx * x + cx, fy * y + cy];
}

export function buildColmapSmall() {
  const cameras = [
    "# Camera list with one line of data per camera:",
    "#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]",
    `# Number of cameras: ${CAMERAS.length}`,
    ...CAMERAS.map((camera) =>
      [camera.id, camera.model, camera.width, camera.height, ...camera.params].join(" "),
    ),
  ].join("\n");

  const points3D = [
    "# 3D point list with one line of data per point:",
    "#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)",
    `# Number of points: ${POINTS.length}`,
  ];
  const observations = new Map(IMAGES.map((image) => [image.id, []]));
  POINTS.forEach((point, index) => {
    const id = index + 1;
    const track = [];
    for (const image of IMAGES) {
      const camera = CAMERAS.find((entry) => entry.id === image.cameraId);
      const pixel = projectColmap(camera, image, point);
      if (pixel === null) continue;
      // Fuera del sensor no se observa: una observación fuera de la imagen sería
      // un dato que ningún detector produce.
      if (pixel[0] < 0 || pixel[1] < 0 || pixel[0] >= camera.width || pixel[1] >= camera.height) continue;
      const list = observations.get(image.id);
      track.push(image.id, list.length);
      list.push({ x: pixel[0], y: pixel[1], pointId: id });
    }
    points3D.push(
      [id, ...point.map((value) => value.toFixed(8)), 120, 130, 140, "0.5", ...track].join(" "),
    );
  });

  const images = [
    "# Image list with two lines of data per image:",
    "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
    "#   POINTS2D[] as (X, Y, POINT3D_ID)",
    `# Number of images: ${IMAGES.length}`,
  ];
  for (const image of IMAGES) {
    images.push([image.id, ...image.q, ...image.t, image.cameraId, image.name].join(" "));
    images.push(
      observations
        .get(image.id)
        .map((entry) => `${entry.x.toFixed(8)} ${entry.y.toFixed(8)} ${entry.pointId}`)
        .join(" "),
    );
  }

  return {
    "cameras.txt": `${cameras}\n`,
    "images.txt": `${images.join("\n")}\n`,
    "points3D.txt": `${points3D.join("\n")}\n`,
  };
}

export function writeColmapSmall(destination) {
  const files = buildColmapSmall();
  mkdirSync(destination, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(resolve(destination, name), contents);
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--out");
  const destination =
    index >= 0
      ? resolve(process.argv[index + 1])
      : resolve(projectRoot, "contracts/fixtures/colmap-small-v1");
  const files = writeColmapSmall(destination);
  const bytes = Object.values(files).reduce((total, file) => total + Buffer.byteLength(file), 0);
  console.log(`colmap-small-v1: ${Object.keys(files).length} ficheros, ${bytes} bytes → ${destination}`);
}
