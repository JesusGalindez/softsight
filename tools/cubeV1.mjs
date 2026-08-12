/**
 * Generador local de `cube-v1`, el paquete de reconstrucción sintético de R0-A.
 *
 * Es «un script de nuestro repositorio» en el sentido literal de D34: nadie
 * reconstruye nada aquí —eso es de VideoMesh, P1—, se **fabrica** un paquete con
 * la forma que el contrato describe para poder recorrerlo de punta a punta sin
 * esperar a nadie.
 *
 * Tres cosas que lo hacen útil como fixture y no como decorado:
 *
 *   - **La geometría es la del motor.** El cubo sale de `resolveScene`, así que
 *     el PLY lleva los 24 vértices partidos por cara que produce el generador de
 *     verdad, con su costura sin soldar. Un cubo escrito a mano con ocho vértices
 *     no ejercería `weldPositions`, que es justo la parte que la auditoría usa
 *     para decidir si la malla está cerrada.
 *   - **Las imágenes son renders de verdad**, del mismo rasterizador que
 *     certifica, y los intrínsecos del manifest son los de la cámara que las
 *     produjo: `fy = (alto/2) / tan(fovY/2)`. Un CameraSet que no corresponde a
 *     sus píxeles es evidencia falsa, y ninguna prueba de las de después lo
 *     notaría.
 *   - **Se publica sellado**, escribiendo en un directorio temporal hermano y
 *     renombrando al final (D29). El manifest se escribe el último, con los
 *     hashes ya calculados, porque un manifest no puede contener su propio
 *     sha256 (D7).
 *
 * Determinista: dos ejecuciones dan los mismos bytes en los mismos ficheros, que
 * es lo que permite comparar contra el `cube-v1` de VideoMesh (D23).
 *
 *   node tools/cubeV1.mjs                 escribe artifacts/cube-v1/
 *   node tools/cubeV1.mjs --out <ruta>    en otro sitio
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SoftwareRenderer,
  frameCameraFromAabb,
  resolveScene,
  serializePlyMesh,
  serializePlyPoints,
} from "../dist-node/agent3d.mjs";
import { encodePng } from "./agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/** Lado del cubo. Uno, para que el volumen firmado sea exactamente 1. */
const SIDE = 1;
const IMAGE_SIZE = 256;

/**
 * Las cuatro vistas del paquete. Cuatro y no seis: dos opuestas de un cubo dan la
 * misma información y el fixture engorda sin ejercer nada nuevo.
 */
const VIEWS = [
  { id: "cam-frontal", yaw: 0, pitch: 0 },
  { id: "cam-lateral", yaw: 90, pitch: 0 },
  { id: "cam-cenital", yaw: 0, pitch: 89 },
  { id: "cam-tres-cuartos", yaw: 45, pitch: 25 },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** El cubo del motor, con sus vértices partidos por cara. */
function cubeMesh() {
  const [node] = resolveScene({
    objects: [{ name: "cubo", geometry: { primitive: "box", parameters: [SIDE, SIDE, SIDE] } }],
  });
  return node.node.mesh;
}

/** Las ocho esquinas, como nube dispersa: lo que una reconstrucción real traería aparte. */
function cubeCorners() {
  const half = SIDE / 2;
  const positions = [];
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      for (const z of [-half, half]) positions.push(x, y, z);
    }
  }
  return { positions: Float32Array.from(positions) };
}

/**
 * Renderiza una vista y devuelve el PNG junto con los intrínsecos de la cámara
 * que lo produjo. Los dos salen del mismo sitio a propósito: es lo que impide que
 * el manifest describa una cámara que no es la que miró.
 */
function renderView(nodes, aabb, view) {
  const renderer = new SoftwareRenderer(IMAGE_SIZE, IMAGE_SIZE);
  const camera = frameCameraFromAabb(aabb, { name: view.id, yaw: view.yaw, pitch: view.pitch, shading: "lit" });
  renderer.render(nodes, camera, {
    shadingMode: "lit",
    wireframe: false,
    perspectiveCorrect: true,
    // Sin antialias ni sombras: las dos meten píxeles que dependen del muestreo, y
    // el paquete tiene que salir igual en cualquier máquina.
    antialias: false,
    shadows: false,
    shadowSamples: 1,
    frustumCulling: true,
    cullMode: 1, // Back: el mismo valor que usan las otras puertas al llamar al motor
    light: { direction: [0.42, 0.76, 0.5], color: [1, 0.97, 0.92], intensity: 1.2 },
    ambient: [0.34, 0.37, 0.44],
    ambientGround: [0.16, 0.15, 0.14],
    fogColor: [0.08, 0.09, 0.12],
    fogDensity: 0,
    clearColor: [0.09, 0.1, 0.13],
  });
  const focal = IMAGE_SIZE / 2 / Math.tan((camera.fovYDegrees * Math.PI) / 360);
  return {
    png: encodePng(renderer.framebuffer.color, IMAGE_SIZE, IMAGE_SIZE),
    intrinsics: { fx: focal, fy: focal, cx: IMAGE_SIZE / 2, cy: IMAGE_SIZE / 2 },
  };
}

/** Construye el paquete entero en memoria: ficheros y manifest, sin tocar disco. */
export function buildCubePackage() {
  const mesh = cubeMesh();
  const resolved = resolveScene({
    objects: [{ name: "cubo", geometry: { primitive: "box", parameters: [SIDE, SIDE, SIDE] } }],
  });
  const nodes = resolved.map((entry) => entry.node);
  const half = SIDE / 2;
  const aabb = { min: [-half, -half, -half], max: [half, half, half] };

  const files = new Map();
  files.set("mesh.ply", Buffer.from(serializePlyMesh(mesh), "utf8"));
  files.set("sparse.ply", Buffer.from(serializePlyPoints(cubeCorners()), "utf8"));

  const artifacts = [
    {
      id: "mesh",
      type: "TRIANGLE_MESH",
      path: "mesh.ply",
      bytes: files.get("mesh.ply").length,
      sha256: sha256(files.get("mesh.ply")),
      // El cubo se genera entero: ninguna región viene de rellenar nada.
      purelyReconstructed: true,
    },
    {
      id: "sparse",
      type: "POINT_CLOUD",
      path: "sparse.ply",
      bytes: files.get("sparse.ply").length,
      sha256: sha256(files.get("sparse.ply")),
    },
  ];

  const cameras = [];
  for (const view of VIEWS) {
    const { png, intrinsics } = renderView(nodes, aabb, view);
    const path = `images/${view.id}.png`;
    files.set(path, png);
    artifacts.push({
      id: `img-${view.id}`,
      type: "IMAGE",
      path,
      bytes: png.length,
      sha256: sha256(png),
    });
    cameras.push({
      id: view.id,
      imageArtifactId: `img-${view.id}`,
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      pixelOrigin: "TOP_LEFT",
      pixelCenter: "CENTER",
      model: "PINHOLE",
      intrinsics,
    });
  }

  const manifest = {
    documentType: "videomesh.reconstruction-package",
    contractVersion: "0.1",
    packageId: "cube-v1",
    state: "SEALED",
    producer: { name: "softsight/cubeV1", version: "0.1.0" },
    artifacts,
    cameras,
    // Sintético y sin ninguna medida del mundo detrás: decir otra cosa sería
    // exactamente lo que D9 impide, una escala absoluta sin fuente.
    scale: { status: "RELATIVE", source: "NONE" },
    frameGraph: {
      transforms: [
        {
          from: "RECONSTRUCTION",
          to: "ASSET_CANONICAL",
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          reason: "el cubo se genera ya en el marco canónico; la identidad se registra igual",
          producer: "softsight/cubeV1",
        },
      ],
    },
    requiredEvidence: ["mesh"],
  };

  return { files, manifest };
}

/**
 * Escribe el paquete y lo publica con un rename, como pide D29: primero los
 * artifacts, el manifest el último, y el directorio final aparece entero o no
 * aparece. El temporal es hermano del destino para que los dos caigan en el mismo
 * volumen; en otro, el rename dejaría de ser atómico sin avisar.
 */
export function writeCubePackage(destination) {
  const { files, manifest } = buildCubePackage();
  const staging = `${destination}.escribiendo`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  for (const [path, contents] of files) {
    const target = join(staging, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // El destino no se reescribe: un paquete sellado es inmutable y la identidad
  // nueva se publica al lado (D29, P10). Aquí el destino es de usar y tirar, así
  // que se borra explícitamente en vez de dejar que el rename decida.
  rmSync(destination, { recursive: true, force: true });
  renameSync(staging, destination);
  return { manifest, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--out");
  const destination =
    index >= 0 ? resolve(process.argv[index + 1]) : resolve(projectRoot, "artifacts/cube-v1");
  const { manifest, files } = writeCubePackage(destination);
  const bytes = [...files.values()].reduce((total, file) => total + file.length, 0);
  console.log(
    `cube-v1: ${files.size} artifacts, ${bytes} bytes, ${manifest.cameras.length} cámaras → ${destination}`,
  );
  if (!existsSync(join(destination, "manifest.json"))) process.exit(1);
}
