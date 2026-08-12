/**
 * Adaptador de COLMAP: de sus tres ficheros de texto al CameraSet canónico.
 *
 * Es P9 en su forma más literal —«los adaptadores absorben la ambigüedad de cada
 * backend; el contrato canónico la elimina»— y D4: sin datos reales, el cubo
 * sintético no ejerce modelos de cámara de verdad, ni distorsión, ni el
 * comportamiento real de la escala.
 *
 * ## Las tres conversiones que hace, y que no se hacen en ningún otro sitio
 *
 * ```text
 * pose        COLMAP guarda cameraFromWorld como cuaternión + traslación;
 *             el contrato solo lleva worldFromCamera (D32), así que se invierte
 *             aquí y una sola vez
 * intrínsecos vector posicional por modelo → campos con nombre (D19)
 * marco       COLMAP mira a +Z con la Y hacia abajo: se declara, no se convierte
 * ```
 *
 * La tercera es la que más cara cuesta si se hace mal, y por eso **no se hace**:
 * el CameraSet declara `cameraAxes: X_RIGHT_Y_DOWN_Z_FORWARD` y los números
 * viajan como vinieron. Rotar aquí para «dejarlo en nuestro marco» sería una
 * conversión invisible que nadie puede comprobar; declararla la hace verificable
 * con un punto y un píxel.
 *
 * ## Qué no hace
 *
 * No lee `.bin`, no reconstruye nada y no inventa escala: una reconstrucción de
 * COLMAP sin restricción externa tiene **escala desconocida**, y decir otra cosa
 * es exactamente lo que D9 impide. La escala sale `UNKNOWN` con fuente `NONE`, y
 * quien la conozca la aporta por otro camino.
 */

/** Modelos de cámara de COLMAP que sabemos convertir, con su orden de parámetros. */
const CAMERA_MODELS: Record<string, { params: readonly string[]; model: "PINHOLE" | "OPENCV" }> = {
  // `f` sirve para las dos focales: es una cámara con píxeles cuadrados.
  SIMPLE_PINHOLE: { params: ["f", "cx", "cy"], model: "PINHOLE" },
  PINHOLE: { params: ["fx", "fy", "cx", "cy"], model: "PINHOLE" },
  SIMPLE_RADIAL: { params: ["f", "cx", "cy", "k1"], model: "OPENCV" },
  RADIAL: { params: ["f", "cx", "cy", "k1", "k2"], model: "OPENCV" },
  OPENCV: { params: ["fx", "fy", "cx", "cy", "k1", "k2", "p1", "p2"], model: "OPENCV" },
};

export interface ColmapCamera {
  id: string;
  width: number;
  height: number;
  model: "PINHOLE" | "OPENCV";
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  distortion?: { k1?: number; k2?: number; p1?: number; p2?: number };
}

export interface ColmapImage {
  id: string;
  cameraId: string;
  name: string;
  /** Pose ya invertida: la del contrato, no la de COLMAP. */
  worldFromCamera: number[];
  /** Observaciones `(x, y, point3dId)`; `point3dId` vacío si no triangula. */
  observations: Array<{ x: number; y: number; pointId: string | null }>;
}

export interface ColmapPoint {
  id: string;
  position: [number, number, number];
  color: [number, number, number];
  /** Error de reproyección que declara COLMAP, en píxeles. */
  error: number;
}

export interface ColmapModel {
  cameras: ColmapCamera[];
  images: ColmapImage[];
  points: ColmapPoint[];
  /** Modelos de cámara encontrados que no sabemos convertir. */
  unsupported: Array<{ cameraId: string; model: string }>;
}

/** Líneas con contenido: COLMAP comenta con `#` y deja líneas en blanco. */
function contentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * `cameras.txt`: `CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]`.
 *
 * Un modelo desconocido **no se aproxima**. La tentación es tratar un
 * `OPENCV_FISHEYE` como `OPENCV` ignorando los coeficientes que sobran, y el
 * resultado es una proyección que se equivoca poco en el centro y mucho en el
 * borde, que es donde la distorsión importa. Se devuelve aparte y quien llame
 * decide (`CAMERA_MODEL_UNSUPPORTED`, D19).
 */
export function parseColmapCameras(text: string): { cameras: ColmapCamera[]; unsupported: ColmapModel["unsupported"] } {
  const cameras: ColmapCamera[] = [];
  const unsupported: ColmapModel["unsupported"] = [];

  for (const line of contentLines(text)) {
    const parts = line.split(/\s+/);
    const [id, model, width, height] = parts;
    const shape = CAMERA_MODELS[model];
    if (shape === undefined) {
      unsupported.push({ cameraId: id, model });
      continue;
    }

    const values = parts.slice(4).map(Number);
    if (values.length !== shape.params.length) {
      throw new Error(
        `COLMAP_CAMERA_INVALID: la cámara ${id} declara ${model} con ${values.length} parámetros y ${model} tiene ${shape.params.length}`,
      );
    }
    const named: Record<string, number> = {};
    shape.params.forEach((name, index) => {
      named[name] = values[index];
    });

    const focal = named.f ?? named.fx;
    const distortion: ColmapCamera["distortion"] = {};
    for (const coefficient of ["k1", "k2", "p1", "p2"] as const) {
      if (named[coefficient] !== undefined) distortion[coefficient] = named[coefficient];
    }

    cameras.push({
      id,
      width: Number(width),
      height: Number(height),
      model: shape.model,
      intrinsics: { fx: focal, fy: named.fy ?? focal, cx: named.cx, cy: named.cy },
      ...(Object.keys(distortion).length > 0 ? { distortion } : {}),
    });
  }

  return { cameras, unsupported };
}

/**
 * Cuaternión de COLMAP —`(w, x, y, z)`, en ese orden— a matriz de rotación por
 * filas. El orden de las componentes es la primera trampa del formato: casi todo
 * lo demás en gráficos guarda `(x, y, z, w)`.
 */
function rotationFromQuaternion(w: number, x: number, y: number, z: number): number[] {
  // Normalizado antes de nada. COLMAP los emite unitarios, pero los escribe
  // redondeados a unos pocos decimales, y un cuaternión que mide 0,999998 da una
  // matriz que **no es ortogonal**: su traspuesta deja de ser su inversa, y como
  // la pose se invierte justo después, el error entra en la posición de la cámara.
  // Se ve como una décima de milésima de píxel al reproyectar, que es
  // exactamente el tamaño de error que se acepta como «redondeo» sin mirarlo.
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
 * `images.txt`: dos líneas por imagen, la primera con la pose y la segunda con
 * las observaciones.
 *
 * COLMAP guarda `cameraFromWorld`: `p_cámara = R·p_mundo + t`. El contrato lleva
 * la inversa (D32), que en una transformación rígida es `Rᵀ` y `−Rᵀt`, no una
 * inversión general. Invertir aquí, una vez y con nombre, es lo que evita las dos
 * transposiciones sin dueño que D32 advierte.
 */
export function parseColmapImages(text: string): ColmapImage[] {
  const lines = contentLines(text);
  const images: ColmapImage[] = [];

  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = lines[index].split(/\s+/);
    const [id, qw, qx, qy, qz, tx, ty, tz, cameraId] = header;
    const name = header.slice(9).join(" ");

    const rotation = rotationFromQuaternion(Number(qw), Number(qx), Number(qy), Number(qz));
    const translation = [Number(tx), Number(ty), Number(tz)];
    // Rᵀ en las tres columnas, y la posición de la cámara en el mundo, −Rᵀt.
    const position = [
      -(rotation[0] * translation[0] + rotation[3] * translation[1] + rotation[6] * translation[2]),
      -(rotation[1] * translation[0] + rotation[4] * translation[1] + rotation[7] * translation[2]),
      -(rotation[2] * translation[0] + rotation[5] * translation[1] + rotation[8] * translation[2]),
    ];

    const observations: ColmapImage["observations"] = [];
    const flat = lines[index + 1].split(/\s+/);
    for (let cursor = 0; cursor + 2 < flat.length; cursor += 3) {
      const pointId = flat[cursor + 2];
      observations.push({
        x: Number(flat[cursor]),
        y: Number(flat[cursor + 1]),
        // `-1` significa que ese punto de la imagen no llegó a triangularse. No es
        // un punto en el origen ni un error: es una observación sin punto 3D.
        pointId: pointId === "-1" ? null : pointId,
      });
    }

    images.push({
      id,
      cameraId,
      name,
      worldFromCamera: [
        rotation[0], rotation[3], rotation[6], position[0],
        rotation[1], rotation[4], rotation[7], position[1],
        rotation[2], rotation[5], rotation[8], position[2],
        0, 0, 0, 1,
      ],
      observations,
    });
  }

  return images;
}

/** `points3D.txt`: `POINT3D_ID X Y Z R G B ERROR TRACK[]`. */
export function parseColmapPoints(text: string): ColmapPoint[] {
  return contentLines(text).map((line) => {
    const parts = line.split(/\s+/);
    return {
      id: parts[0],
      position: [Number(parts[1]), Number(parts[2]), Number(parts[3])],
      color: [Number(parts[4]), Number(parts[5]), Number(parts[6])],
      error: Number(parts[7]),
    };
  });
}

export function parseColmapModel(files: {
  cameras: string;
  images: string;
  points: string;
}): ColmapModel {
  const { cameras, unsupported } = parseColmapCameras(files.cameras);
  return {
    cameras,
    images: parseColmapImages(files.images),
    points: parseColmapPoints(files.points),
    unsupported,
  };
}

/**
 * El CameraSet del contrato, una entrada por imagen registrada.
 *
 * Una entrada por **imagen** y no por cámara: en COLMAP una cámara es una
 * calibración, que muchas imágenes comparten, y lo que el contrato describe es
 * «esta imagen se tomó desde aquí con estos intrínsecos». Colapsarlo perdería las
 * poses, que es casi todo lo que COLMAP produce.
 */
export function toCameraSet(model: ColmapModel): Array<Record<string, unknown>> {
  const byId = new Map(model.cameras.map((camera) => [camera.id, camera]));
  const cameraSet: Array<Record<string, unknown>> = [];

  for (const image of model.images) {
    const camera = byId.get(image.cameraId);
    if (camera === undefined) continue;
    cameraSet.push({
      id: `img-${image.id}`,
      imageArtifactId: `img-${image.id}`,
      width: camera.width,
      height: camera.height,
      // COLMAP pone el origen del píxel arriba a la izquierda y el centro del
      // píxel (0,0) en (0,5, 0,5), que es la convención de OpenCV.
      pixelOrigin: "TOP_LEFT",
      pixelCenter: "CENTER",
      model: camera.model,
      cameraAxes: "X_RIGHT_Y_DOWN_Z_FORWARD",
      intrinsics: camera.intrinsics,
      ...(camera.distortion !== undefined ? { distortion: camera.distortion } : {}),
      worldFromCamera: image.worldFromCamera,
    });
  }

  return cameraSet;
}
