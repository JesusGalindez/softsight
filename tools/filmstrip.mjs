/**
 * Tira de fotogramas de una escena animada: el movimiento, mirable sin salir del
 * repositorio.
 *
 * Existe porque el informe dice que el rotor da tres vueltas y eso es cierto, pero
 * no se ve. La demo de navegador importa GLB y lo orbita, y no reproduce clips;
 * Blender sí, pero es salir fuera. Esto rasteriza unos cuantos fotogramas y los
 * pone uno al lado del otro.
 *
 * **No es un vídeo y no pretende serlo.** Codificar vídeo y montar una línea de
 * tiempo es el trabajo del editor, y hacerlo aquí sería construirlo por segunda
 * vez. Esto es una foto múltiple para mirar de reojo lo que la puerta ya afirma
 * con números.
 *
 * Ni un píxel sale de una aritmética paralela: la geometría la resuelve
 * `resolveScene`, el clip se hornea, se escribe el GLB y se vuelve a leer, y las
 * poses las da el evaluador certificado contra Three.js. Es el camino completo del
 * producto, de JSON a píxeles.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  bindModelToSkeleton,
  computeSceneAabb,
  evaluatePose,
  evaluatePoseWithNormals,
  modelFromScene,
  parseGlbAnimation,
  renderContactSheet,
  resolveRig,
  resolveScene,
  serializeSkinnedGlb,
} from "../dist-node/agent3d.mjs";
import { encodePng } from "./agent3d.mjs";

const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Las mismas vistas del pliego, por nombre, para no inventar una segunda lista. */
const VIEWS = {
  "3/4": { name: "3/4", yaw: 35, pitch: 22, projection: "perspective", shading: "lit" },
  frontal: { name: "frontal", yaw: 0, pitch: 0, projection: "orthographic", shading: "lit" },
  lateral: { name: "lateral", yaw: 90, pitch: 0, projection: "orthographic", shading: "lit" },
  superior: { name: "superior", yaw: 0, pitch: 88, projection: "orthographic", shading: "lit" },
};

const HELP = `Tira de fotogramas de una escena animada.

  node tools/filmstrip.mjs --scene <ruta.json> [opciones]

  --scene <ruta>     escena con skeleton, bindings y clips
  --frames "0,4,8"   fotogramas a rasterizar (0,1,2,3 por defecto)
  --out <ruta.png>   dónde escribirla (tira.png)
  --size <n>         lado de cada fotograma en píxeles (360)
  --view <nombre>    3/4, frontal, lateral o superior (3/4)
  --clip <n>         índice del clip, si hay varios (0)

El encuadre se fija con todos los fotogramas a la vez: si la cámara se ajustara a
cada uno, lo que se vería sería el reencuadre y no el movimiento.
`;

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    options.set(key, next === undefined || next.startsWith("--") ? "true" : next);
  }
  return options;
}

export async function filmstrip(options) {
  const scenePath = options.get("scene");
  if (scenePath === undefined || scenePath === "true") throw new Error("hace falta --scene <ruta.json>");
  const spec = JSON.parse(await readFile(resolve(scenePath), "utf8"));

  if (!spec.skeleton || !Array.isArray(spec.clips) || spec.clips.length === 0) {
    throw new Error(
      "la escena no tiene movimiento: una tira de fotogramas necesita `skeleton`, `bindings` y `clips`",
    );
  }

  const frames = (options.get("frames") ?? "0,1,2,3")
    .split(",")
    .map((entry) => Number(entry.trim()));
  if (frames.length === 0 || frames.some((frame) => !Number.isFinite(frame) || frame < 0)) {
    throw new Error(`--frames son números no negativos separados por comas, no '${options.get("frames")}'`);
  }
  const size = Number(options.get("size") ?? 360);
  if (!Number.isInteger(size) || size < 32) throw new Error(`--size es un entero de 32 en adelante, no ${size}`);
  const viewName = options.get("view") ?? "3/4";
  const view = VIEWS[viewName];
  if (view === undefined) {
    throw new Error(`--view '${viewName}' no existe; hay ${Object.keys(VIEWS).join(", ")}`);
  }
  const clipIndex = Number(options.get("clip") ?? 0);

  const resolved = resolveScene(spec);
  const model = modelFromScene(spec, scenePath);
  const rig = resolveRig(spec.skeleton, spec.clips);
  const bound = bindModelToSkeleton(model, rig.skeleton, {
    schemaVersion: 1,
    bindings: spec.bindings,
  });
  const glb = parseGlbAnimation(serializeSkinnedGlb(bound.scene));
  const fps = rig.clips[clipIndex]?.fps ?? 30;

  // Las poses salen del evaluador certificado, no de una segunda aritmética. La
  // malla llega ya en mundo, así que el nodo va con la identidad.
  const nodesAt = (frame) => {
    const positions = evaluatePose(glb.document, glb.binary, glb.decodedViews, frame / fps, 0, clipIndex);
    const normals = evaluatePoseWithNormals(glb.document, glb.binary, glb.decodedViews, frame / fps, 0, clipIndex);
    let offset = 0;
    return model.parts.map((part, index) => {
      const count = part.mesh.positions.length;
      const posed = positions.slice(offset, offset + count);
      let radius = 0;
      for (let vertex = 0; vertex < posed.length; vertex += 3) {
        radius = Math.max(radius, Math.hypot(posed[vertex], posed[vertex + 1], posed[vertex + 2]));
      }
      const node = {
        mesh: {
          positions: posed,
          normals: normals.slice(offset, offset + count),
          uvs: part.mesh.uvs,
          indices: part.mesh.indices,
          boundingRadius: radius,
        },
        model: IDENTITY,
        material: resolved[index].node.material,
      };
      offset += count;
      return node;
    });
  };

  const posed = frames.map((frame) => nodesAt(frame));
  // Encuadre común a todos: fijarlo es lo que hace que la imagen enseñe el
  // movimiento y no el reencuadre.
  const framing = computeSceneAabb(posed.flat());
  const tiles = posed.map((nodes) => renderContactSheet(nodes, size, [view], 1, undefined, framing));

  const width = size * tiles.length;
  const pixels = new Uint8ClampedArray(width * size * 4);
  tiles.forEach((tile, column) => {
    for (let row = 0; row < size; row += 1) {
      pixels.set(
        tile.pixels.subarray(row * size * 4, (row + 1) * size * 4),
        (row * width + column * size) * 4,
      );
    }
  });

  const out = resolve(options.get("out") ?? "tira.png");
  await writeFile(out, encodePng(pixels, width, size));
  return {
    file: out,
    clip: rig.clips[clipIndex]?.name ?? null,
    fps,
    frames,
    view: viewName,
    width,
    height: size,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.has("help") || process.argv.length <= 2) {
    process.stdout.write(HELP);
  } else {
    filmstrip(options)
      .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
      });
  }
}
