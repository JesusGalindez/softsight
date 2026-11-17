/**
 * El paquete de prueba de R8: `cube-v1` con máscaras y mapas de profundidad.
 *
 * La evidencia no se renderiza con el motor ni se mide con la malla: sale de la
 * **caja analítica** `[-0,5, 0,5]³` —la que la malla de `cube-v1` describe—, con un
 * cruce rayo-caja por planos. Es el segundo camino que hace que la puerta pruebe
 * algo: los residuos se miden cruzando cada rayo con los triángulos de la malla en
 * el árbol, y la verdad sale de seis planos. Si coinciden, los dos caminos dan la
 * misma superficie.
 *
 * Lo único que comparten es el rayo de cada píxel, `pixelRay`, y `test:residuals`
 * lo comprueba aparte contra `projectPoint`, que es la convención que todo lo
 * demás ya respeta.
 *
 * `meshScale` cambia **solo la malla** —la evidencia sigue siendo la del cubo
 * unidad—, que es como se fabrica una reconstrucción equivocada de tamaño
 * conocido.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEPTH_EXTENSION, MASK_EXTENSION, parsePly, pixelRay, serializePlyMesh } from "../dist-node/agent3d.mjs";
import { encodePng } from "./agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { writeExr } from "./exr.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Entrada del rayo en la caja `[-h, h]³`, o `null` si no la toca. Por planos: el
 * intervalo de cada eje, y su intersección.
 */
export function rayBox(origin, direction, half = 0.5) {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (direction[axis] === 0) {
      if (origin[axis] < -half || origin[axis] > half) return null;
      continue;
    }
    const a = (-half - origin[axis]) / direction[axis];
    const b = (half - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return far >= near && near > 0 ? near : null;
}

/**
 * Escribe el paquete en `destination` y devuelve su manifest.
 *
 * `depthKind` es lo que se **declara**; `writtenKind`, lo que se **escribe**. Por
 * defecto son lo mismo, y separarlos es como se fabrica un mapa mal declarado.
 */
export function writeEvidencePackage(
  destination,
  { meshScale = 1, depthKind = "OPTICAL_AXIS", writtenKind = depthKind, invalid = "CERO", compression = "ZIP" } = {},
) {
  writeCubePackage(destination);
  const manifestPath = join(destination, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  mkdirSync(join(destination, "mascaras"), { recursive: true });
  mkdirSync(join(destination, "profundidad"), { recursive: true });

  const porCamara = {};
  const porArtefacto = {};
  for (const camera of manifest.cameras) {
    const { width, height } = camera;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const depth = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const ray = pixelRay(camera, column + 0.5, row + 0.5);
        const t = rayBox(ray.origin, ray.direction);
        const slot = row * width + column;
        pixels[slot * 4 + 3] = t === null ? 0 : 255;
        depth[slot] = t === null ? (invalid === "NAN" ? Number.NaN : 0) : writtenKind === "OPTICAL_AXIS" ? t : t * ray.length;
      }
    }
    const png = encodePng(pixels, width, height);
    const maskPath = `mascaras/${camera.id}.png`;
    writeFileSync(join(destination, maskPath), png);
    manifest.artifacts.push({ id: `mascara-${camera.id}`, type: "IMAGE", path: maskPath, bytes: png.length, sha256: sha256(png) });
    porCamara[camera.id] = `mascara-${camera.id}`;

    const exr = writeExr({ width, height, channels: [{ name: "Z", type: "FLOAT", values: depth }], compression });
    const depthPath = `profundidad/${camera.id}.exr`;
    writeFileSync(join(destination, depthPath), exr);
    manifest.artifacts.push({
      id: `prof-${camera.id}`,
      type: "DEPTH_MAP",
      path: depthPath,
      bytes: exr.length,
      sha256: sha256(exr),
      cameraId: camera.id,
      depthKind,
    });
    porArtefacto[`prof-${camera.id}`] = {
      formato: "EXR",
      canal: "Z",
      semantica: "PROFUNDIDAD",
      espacio: camera.imageSpace,
      unidad: "PAQUETE",
      invalido: invalid,
    };
  }

  if (meshScale !== 1) {
    const meshArtifact = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
    const { mesh } = parsePly(new Uint8Array(readFileSync(join(destination, meshArtifact.path))));
    const scaled = { positions: mesh.positions.map((value) => value * meshScale), indices: mesh.indices };
    const text = Buffer.from(serializePlyMesh(scaled), "utf8");
    writeFileSync(join(destination, meshArtifact.path), text);
    meshArtifact.bytes = text.length;
    meshArtifact.sha256 = sha256(text);
  }

  manifest.extensions = {
    ...(manifest.extensions ?? {}),
    [MASK_EXTENSION]: { required: false, data: { porCamara } },
    [DEPTH_EXTENSION]: { required: false, data: { porArtefacto } },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
