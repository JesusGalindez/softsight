/**
 * `colmap-v1`: un paquete de reconstrucción escrito por **un segundo productor**.
 *
 * ## Por qué existe, y por qué no importa nada de `src/`
 *
 * D26 promueve el contrato a 1.0 cuando **dos productores reales distintos** han
 * producido paquetes válidos, y D34 pone R0-B como criterio de salida. Hasta hoy
 * el único productor era `tools/cubeV1.mjs`, que es nuestro y usa nuestros
 * módulos: un paquete que valida porque lo escribió quien escribió el validador
 * no prueba que el contrato sea escribible, prueba que sabemos llamarnos.
 *
 * Así que esto **no importa ni una línea de `src/` ni de `dist-node/`**, y una
 * puerta lo comprueba. Lo único que lee de este repositorio es
 * `contracts/reconstruction-package.schema.json`, que es exactamente lo que
 * tendría un implementador de fuera. La conversión de COLMAP —cuaternión a
 * matriz, inversión de la pose, intrínsecos posicionales a campos con nombre— se
 * reescribe aquí desde la documentación de COLMAP, **no se reutiliza**. Que las
 * dos implementaciones caigan en los mismos números es la prueba; compartir
 * código la anularía.
 *
 * ## Qué empaqueta
 *
 * Un subconjunto de `south-building`: ocho vistas registradas, sus imágenes, y
 * los puntos 3D que esas ocho observan. Ocho y no las 128 porque las imágenes
 * pesan 1,8 MB cada una y el fixture vive fuera del repositorio; el paquete lo
 * dice en su `producer`, que un subconjunto declarado es un paquete honesto y un
 * subconjunto callado es otra cosa.
 *
 * **No declara malla.** Un SfM disperso entrega nube de puntos y cámaras, y no
 * promete superficie. Que eso salga PASS y no INCONCLUSIVE es la fila de D8 que
 * este paquete ejerce.
 *
 *   node producers/colmap/build.mjs <raíz-colmap> <destino>
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = resolve(here, "../../contracts/reconstruction-package.schema.json");

/**
 * Cuántas vistas entran **por defecto**. Ocho caben en catorce megas de imágenes,
 * que es lo que pedía el fixture del repositorio. Una reconstrucción de verdad
 * trae las que traiga y las declara: `--vistas todas`.
 */
const VIEWS = 8;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Líneas con contenido: COLMAP comenta con `#` y termina en CRLF a veces. */
function contentLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * `cameras.txt` → intrínsecos con nombre.
 *
 * El orden de los parámetros es el de la documentación de COLMAP y se escribe
 * aquí a propósito: es la ambigüedad que el adaptador del otro lado absorbe, y si
 * la copiara de allí las dos implementaciones dejarían de ser independientes.
 */
const MODELS = {
  SIMPLE_PINHOLE: ["f", "cx", "cy"],
  PINHOLE: ["fx", "fy", "cx", "cy"],
  SIMPLE_RADIAL: ["f", "cx", "cy", "k1"],
  RADIAL: ["f", "cx", "cy", "k1", "k2"],
  OPENCV: ["fx", "fy", "cx", "cy", "k1", "k2", "p1", "p2"],
};

export function readCameras(text) {
  const cameras = new Map();
  for (const line of contentLines(text)) {
    const parts = line.split(/\s+/);
    const [id, model, width, height] = parts;
    const names = MODELS[model];
    if (names === undefined) throw new Error(`modelo de cámara no soportado: ${model}`);
    const values = parts.slice(4).map(Number);
    if (values.length !== names.length) {
      throw new Error(`${model} declara ${values.length} parámetros y son ${names.length}`);
    }
    const named = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    const focal = named.f ?? named.fx;
    const distortion = {};
    for (const coefficient of ["k1", "k2", "p1", "p2"]) {
      if (named[coefficient] !== undefined) distortion[coefficient] = named[coefficient];
    }
    cameras.set(id, {
      width: Number(width),
      height: Number(height),
      // `SIMPLE_RADIAL` y `RADIAL` son OPENCV con menos coeficientes: el contrato
      // solo nombra dos modelos, y la distorsión viaja por campo.
      model: Object.keys(distortion).length > 0 ? "OPENCV" : "PINHOLE",
      intrinsics: { fx: focal, fy: named.fy ?? focal, cx: named.cx, cy: named.cy },
      ...(Object.keys(distortion).length > 0 ? { distortion } : {}),
    });
  }
  return cameras;
}

/**
 * `images.txt` → pose en la forma del contrato.
 *
 * COLMAP guarda `cameraFromWorld` como cuaternión `(w, x, y, z)` más traslación;
 * el contrato solo lleva `worldFromCamera`. En una transformación rígida la
 * inversa es `Rᵀ` y `−Rᵀt`, no una inversión general: hacerla general mete error
 * de redondeo donde hay respuesta exacta.
 *
 * El cuaternión se normaliza antes de nada. COLMAP los escribe redondeados, y uno
 * que mide 0,999998 da una matriz cuya traspuesta no es su inversa — y como la
 * pose se invierte justo después, el error entra en la posición de la cámara.
 */
export function readImages(text) {
  const lines = contentLines(text);
  const images = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = lines[index].split(/\s+/);
    const [id, qw, qx, qy, qz, tx, ty, tz, cameraId] = header;
    const name = header.slice(9).join(" ");

    let [w, x, y, z] = [Number(qw), Number(qx), Number(qy), Number(qz)];
    const length = Math.hypot(w, x, y, z) || 1;
    w /= length;
    x /= length;
    y /= length;
    z /= length;
    const r = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
    const t = [Number(tx), Number(ty), Number(tz)];
    const position = [
      -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]),
      -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]),
      -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]),
    ];
    // Row-major, traslación en 3, 7 y 11: es lo que dice el esquema publicado.
    const worldFromCamera = [
      r[0], r[3], r[6], position[0],
      r[1], r[4], r[7], position[1],
      r[2], r[5], r[8], position[2],
      0, 0, 0, 1,
    ];

    const observations = lines[index + 1].split(/\s+/);
    const points = new Set();
    for (let slot = 2; slot < observations.length; slot += 3) {
      if (observations[slot] !== "-1") points.add(observations[slot]);
    }
    images.push({ id, cameraId, name, worldFromCamera, points });
  }
  return images;
}

/** `points3D.txt` → posición y color, por identidad. */
export function readPoints(text) {
  const points = new Map();
  for (const line of contentLines(text)) {
    const parts = line.split(/\s+/);
    points.set(parts[0], {
      position: [Number(parts[1]), Number(parts[2]), Number(parts[3])],
      color: [Number(parts[4]), Number(parts[5]), Number(parts[6])],
    });
  }
  return points;
}

/** PLY ASCII con color, que es lo que una nube de SfM trae. */
function writePly(points) {
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment generado por producers/colmap",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
  ];
  for (const point of points) {
    lines.push(`${point.position.join(" ")} ${point.color.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Ancho y alto de un JPEG, del marcador SOF. Sin decodificar. */
function jpegGrid(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("el JPEG no declara sus dimensiones donde se esperaba");
}

/**
 * Empaqueta una reconstrucción de COLMAP.
 *
 * `opciones.malla` añade la superficie densa como `TRIANGLE_MESH`. Sin ella el
 * paquete sigue siendo lo que era —cámaras y nube— y no promete superficie.
 *
 * `opciones.interpolada` es la honestidad de esa malla, y no es un detalle
 * administrativo: `poisson_mesher` **cierra agujeros por construcción**, así que
 * una región de su superficie puede no derivar de ninguna evidencia. Eso es
 * exactamente lo que `purelyReconstructed: false` declara. `delaunay_mesher` no
 * interpola, y por eso el que la escribe decide, no este fichero.
 */
export function buildColmapPackage(source, destination, opciones = {}) {
  const { vistas = VIEWS, malla = null, interpolada = true, packageId = "colmap-v1" } = opciones;
  const cameras = readCameras(readFileSync(join(source, "cameras.txt"), "utf8"));
  const images = readImages(readFileSync(join(source, "images.txt"), "utf8"));
  const points = readPoints(readFileSync(join(source, "points3D.txt"), "utf8"));

  // Las vistas cuyas imágenes están: el fixture trae ocho de las 128.
  const disponibles = new Set(readdirSync(join(source, "images")));
  const registradas = images.filter((image) => disponibles.has(image.name));
  const elegidas = vistas === "todas" ? registradas : registradas.slice(0, vistas);
  if (elegidas.length === 0) throw new Error("ninguna de las imágenes registradas está en images/");

  // Solo los puntos que esas vistas observan: empaquetar la nube entera diría que
  // el paquete la sostiene con ocho cámaras, y no es verdad.
  const vistos = new Set();
  for (const image of elegidas) for (const id of image.points) vistos.add(id);
  const nube = [...vistos]
    .filter((id) => points.has(id))
    // Por identidad y no por orden de descubrimiento: dos ejecuciones tienen que
    // dar el mismo fichero byte a byte.
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => points.get(id));

  // Se escribe en un directorio temporal y se renombra al final: un paquete a
  // medio escribir con el manifest ya puesto es lo que D29 llama no sellado.
  const temp = `${destination}.escribiendo`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(join(temp, "images"), { recursive: true });

  const artifacts = [];
  const ply = writePly(nube);
  writeFileSync(join(temp, "puntos.ply"), ply);
  artifacts.push({
    id: "puntos",
    type: "POINT_CLOUD",
    path: "puntos.ply",
    bytes: Buffer.byteLength(ply),
    sha256: sha256(ply),
  });

  // La malla, si la hay. Se copia tal cual: reescribirla aquí la convertiría en
  // otra malla, y el hash dejaría de ser el de lo que salió del reconstructor.
  if (malla !== null) {
    const bytes = readFileSync(malla);
    writeFileSync(join(temp, "malla.ply"), bytes);
    artifacts.push({
      id: "malla",
      type: "TRIANGLE_MESH",
      path: "malla.ply",
      bytes: bytes.length,
      sha256: sha256(bytes),
      purelyReconstructed: !interpolada,
    });
  }

  const cameraSet = [];
  for (const image of elegidas) {
    const bytes = readFileSync(join(source, "images", image.name));
    const destinoRelativo = `images/${image.name}`;
    copyFileSync(join(source, "images", image.name), join(temp, destinoRelativo));
    const hash = sha256(bytes);
    artifacts.push({
      id: `img-${image.id}`,
      type: "IMAGE",
      path: destinoRelativo,
      bytes: bytes.length,
      sha256: hash,
    });

    const camera = cameras.get(image.cameraId);
    const grid = jpegGrid(bytes);
    if (grid.width !== camera.width || grid.height !== camera.height) {
      throw new Error(
        `${image.name}: la cámara declara ${camera.width}×${camera.height} y el fichero es ` +
          `${grid.width}×${grid.height}`,
      );
    }

    cameraSet.push({
      id: `img-${image.id}`,
      imageArtifactId: `img-${image.id}`,
      imageArtifactHash: hash,
      // COLMAP calibra sobre la imagen tal y como salió de la cámara: los
      // coeficientes describen lo que hay que corregir, así que no está
      // rectificada.
      imageSpace: "ORIGINAL",
      width: camera.width,
      height: camera.height,
      pixelOrigin: "TOP_LEFT",
      pixelCenter: "CENTER",
      model: camera.model,
      // COLMAP mira a +Z con la Y hacia abajo. Se **declara**, no se convierte:
      // rotar aquí sería una conversión que nadie puede comprobar.
      cameraAxes: "X_RIGHT_Y_DOWN_Z_FORWARD",
      intrinsics: camera.intrinsics,
      ...(camera.distortion ? { distortion: camera.distortion } : {}),
      worldFromCamera: image.worldFromCamera,
    });
  }

  const manifest = {
    documentType: "videomesh.reconstruction-package",
    contractVersion: "0.1",
    packageId,
    state: "SEALED",
    producer: {
      name:
        elegidas.length === images.length
          ? `producers/colmap · las ${images.length} vistas registradas`
          : `producers/colmap · subconjunto de ${elegidas.length} de ${images.length} vistas`,
      version: "0.1.0",
    },
    artifacts,
    cameras: cameraSet,
    // COLMAP sin restricción externa no sabe a qué escala reconstruyó, y decir
    // otra cosa es lo que D9 impide. UNKNOWN es el dato, no un hueco.
    scale: { status: "UNKNOWN", source: "NONE" },
    // Vacío y a propósito: este paquete no afirma ninguna relación entre marcos.
    // Declarar una identidad hacia ASSET_CANONICAL sería inventarse que su marco
    // es el canónico de algo.
    frameGraph: { transforms: [] },
    // Lo que el contrato necesita para certificar. Sin malla es la nube y nada
    // más: un SfM disperso no promete superficie, y pedirla dejaría el paquete
    // en INCONCLUSIVE por algo que nunca iba a traer.
    requiredEvidence: malla === null ? ["puntos"] : ["puntos", "malla"],
  };

  // El manifest **el último**, que es el orden de D29: escribir artifacts,
  // hashearlos, construir el manifest con los hashes, y sellar.
  writeFileSync(join(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(destination, { recursive: true, force: true });
  renameSync(temp, destination);

  return { manifest, points: nube.length, views: elegidas.length, mesh: malla !== null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const bandera = (nombre) => {
    const i = argv.indexOf(nombre);
    return i === -1 ? undefined : argv[i + 1];
  };
  const posicionales = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const [source, destination] = posicionales;
  if (source === undefined || destination === undefined) {
    process.stderr.write(
      "uso: node producers/colmap/build.mjs <raíz-colmap> <destino> [opciones]\n" +
        "  la raíz lleva cameras.txt, images.txt, points3D.txt e images/\n" +
        "\n" +
        "  --vistas N|todas   cuántas vistas entran (por defecto 8)\n" +
        "  --malla <ruta>     añade la superficie densa como TRIANGLE_MESH\n" +
        "  --sin-interpolar   la malla no rellena agujeros (delaunay, no poisson)\n" +
        "  --id <nombre>      packageId; por defecto colmap-v1\n",
    );
    process.exit(2);
  }
  const vistasPedidas = bandera("--vistas");
  const opciones = {
    vistas: vistasPedidas === undefined ? VIEWS : vistasPedidas === "todas" ? "todas" : Number(vistasPedidas),
    malla: bandera("--malla") ? resolve(bandera("--malla")) : null,
    interpolada: !argv.includes("--sin-interpolar"),
    packageId: bandera("--id") ?? "colmap-v1",
  };
  // Se lee para comprobar que existe: un productor que no encuentra el contrato
  // publicado no debería inventarse la forma del paquete.
  JSON.parse(readFileSync(CONTRACT, "utf8"));
  const { manifest, points, views, mesh } = buildColmapPackage(
    resolve(source),
    resolve(destination),
    opciones,
  );
  process.stdout.write(
    `${manifest.packageId}: ${views} vistas, ${points} puntos, ${mesh ? "malla" : "sin malla"}, ` +
      `${manifest.artifacts.length} artifacts en ${destination}\n`,
  );
}
