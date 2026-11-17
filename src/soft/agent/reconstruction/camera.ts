/**
 * Proyección de un punto del mundo al píxel de una cámara del paquete.
 *
 * Es la fila 4 de D23 —«proyección de puntos 3D conocidos»— y la razón de que
 * exista es que **hasta ahora las convenciones de cámara eran una afirmación sin
 * puerta**: `cube-v1` declara `pixelOrigin: TOP_LEFT` y `pixelCenter: CENTER`
 * porque quien lo escribió creía que era lo que hacía el rasterizador. Nadie lo
 * había comprobado, y un error aquí no se ve: la imagen sale bien, los hashes
 * cuadran, y lo que está mal es lo que el manifest dice **sobre** la imagen.
 *
 * ## Las convenciones, escritas
 *
 * ```text
 * worldFromCamera   4×4 por filas, traslación en 3, 7 y 11, vectores columna (D32)
 * cameraAxes        declarado por la cámara, no supuesto por el lector
 *   X_RIGHT_Y_DOWN_Z_FORWARD    visión por computador: COLMAP, OpenCV
 *   X_RIGHT_Y_UP_Z_BACKWARD     gráficos: OpenGL, y el rasterizador de este repo
 * pixelOrigin       dónde cae el píxel (0,0)
 * pixelCenter       CENTER: el centro del píxel (0,0) está en (0,5, 0,5)
 *                   CORNER: está en (0, 0)
 * ```
 *
 * Los dos marcos existen porque el paquete lo produce un pipeline de
 * fotogrametría y lo consume un rasterizador de gráficos, y **cada uno mira hacia
 * un lado**. Confundirlos no da una imagen torcida: da una imagen especular en Y
 * con la profundidad invertida, que en un objeto simétrico —un cubo— es
 * exactamente igual de plausible. Por eso el eje se declara y no se supone.
 */

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface CameraDistortion {
  k1?: number;
  k2?: number;
  k3?: number;
  p1?: number;
  p2?: number;
}

export interface PackageCamera {
  /**
   * Identidad de la cámara en el paquete. Opcional porque la proyección no la
   * usa —es geometría pura— y obligatoria de hecho para quien reparta datos por
   * cámara, como las máscaras: sin ella, el reparto solo puede ir por posición,
   * y una posición desplazada aplica la silueta de una foto a otra sin que nada
   * falle.
   */
  id?: string;
  width: number;
  height: number;
  pixelOrigin: "TOP_LEFT" | "BOTTOM_LEFT";
  pixelCenter: "CENTER" | "CORNER";
  cameraAxes: "X_RIGHT_Y_DOWN_Z_FORWARD" | "X_RIGHT_Y_UP_Z_BACKWARD";
  intrinsics: CameraIntrinsics;
  distortion?: CameraDistortion;
  /** Pose de la cámara en el mundo, 4×4 por filas (D32). */
  worldFromCamera: number[];
}

export interface Projection {
  /** Píxel en la rejilla de la imagen, en coma flotante. */
  x: number;
  y: number;
  /** Profundidad a lo largo del eje óptico; negativa es detrás de la cámara. */
  depth: number;
  /** Si cae dentro de la imagen. Fuera no es un error: es información. */
  inside: boolean;
}

/**
 * Punto del mundo en el marco de la cámara.
 *
 * La inversa de una pose rígida no se calcula con un solvedor general: es
 * `Rᵀ(p − t)`. Hacerlo con eliminación gaussiana costaría más y metería error de
 * redondeo en una operación que es exacta salvo por la multiplicación.
 */
function cameraFromWorld(camera: PackageCamera, point: readonly number[]): [number, number, number] {
  const m = camera.worldFromCamera;
  const dx = point[0] - m[3];
  const dy = point[1] - m[7];
  const dz = point[2] - m[11];
  return [
    m[0] * dx + m[4] * dy + m[8] * dz,
    m[1] * dx + m[5] * dy + m[9] * dz,
    m[2] * dx + m[6] * dy + m[10] * dz,
  ];
}

/** Distorsión radial y tangencial de OpenCV, sobre coordenadas normalizadas. */
function distort(distortion: CameraDistortion, x: number, y: number): [number, number] {
  const { k1 = 0, k2 = 0, k3 = 0, p1 = 0, p2 = 0 } = distortion;
  const r2 = x * x + y * y;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  return [
    x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
    y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y,
  ];
}

export function projectPoint(camera: PackageCamera, point: readonly number[]): Projection {
  const [x, y, z] = cameraFromWorld(camera, point);

  // El eje óptico y el signo de la altura salen de `cameraAxes`. En el marco de
  // gráficos la cámara mira a −Z y la Y sube, así que la profundidad es −z y la
  // altura cambia de signo al pasar a una rejilla que crece hacia abajo.
  const forward = camera.cameraAxes === "X_RIGHT_Y_DOWN_Z_FORWARD" ? z : -z;
  const up = camera.cameraAxes === "X_RIGHT_Y_DOWN_Z_FORWARD" ? y : -y;

  if (forward === 0) {
    // En el plano de la cámara no hay proyección posible, y devolver un número
    // enorme haría creer que hay un píxel donde no lo hay.
    return { x: Number.NaN, y: Number.NaN, depth: 0, inside: false };
  }

  let normalizedX = x / forward;
  let normalizedY = up / forward;
  if (camera.distortion !== undefined) {
    [normalizedX, normalizedY] = distort(camera.distortion, normalizedX, normalizedY);
  }

  const { fx, fy, cx, cy } = camera.intrinsics;
  let pixelX = fx * normalizedX + cx;
  let pixelY = fy * normalizedY + cy;

  // Con el origen abajo, la fila se cuenta desde el otro extremo. `height` y no
  // `height - 1`: lo que se refleja es el eje continuo, no el índice del píxel.
  if (camera.pixelOrigin === "BOTTOM_LEFT") pixelY = camera.height - pixelY;

  // `CORNER` significa que el centro del píxel (0,0) está en (0,0), así que el
  // punto que en `CENTER` cae en 0,5 aquí cae en 0. Medio píxel de diferencia:
  // invisible a ojo, y suficiente para que una cobertura no cuadre nunca.
  if (camera.pixelCenter === "CORNER") {
    pixelX -= 0.5;
    pixelY -= 0.5;
  }

  return {
    x: pixelX,
    y: pixelY,
    depth: forward,
    inside: forward > 0 && pixelX >= 0 && pixelY >= 0 && pixelX < camera.width && pixelY < camera.height,
  };
}

/** Un rayo del mundo: de dónde sale y hacia dónde va. */
export interface PixelRay {
  origin: [number, number, number];
  /**
   * Dirección **sin normalizar**, con componente 1 sobre el eje óptico en el marco
   * de la cámara. Así la distancia que devuelve un trazado es directamente la
   * profundidad sobre el eje óptico, y la longitud del rayo es esa distancia por
   * la norma de este vector: las dos interpretaciones de `depthKind` (D20) salen
   * del mismo cruce sin trigonometría.
   */
  direction: [number, number, number];
  /** Norma de `direction`, para pasar de eje óptico a longitud de rayo. */
  length: number;
}

/** Iteraciones de punto fijo para deshacer la distorsión, y su tolerancia. */
const UNDISTORT_ITERATIONS = 50;
const UNDISTORT_TOLERANCE = 1e-12;

/**
 * El rayo que proyecta en `(x, y)`: la inversa exacta de `projectPoint`.
 *
 * Deshace los mismos pasos en orden inverso —el medio píxel de `CORNER`, la fila
 * contada desde abajo de `BOTTOM_LEFT`, los intrínsecos, la distorsión y los ejes
 * de la cámara— y por eso vive aquí, al lado de la proyección: dos módulos con su
 * propia idea de dónde cae el centro del píxel darían siluetas desplazadas medio
 * píxel sin que nada fallara. La puerta lo comprueba en la dirección que importa:
 * cualquier punto del rayo vuelve a proyectar en `(x, y)`.
 *
 * La distorsión se deshace por punto fijo, que es lo habitual y converge para las
 * distorsiones de una cámara real. Si no converge, `null`: un píxel cuyo rayo no
 * se sabe no se compara, y fingir uno pondría superficie donde nadie la midió.
 */
export function pixelRay(camera: PackageCamera, x: number, y: number): PixelRay | null {
  let pixelX = x;
  let pixelY = y;
  if (camera.pixelCenter === "CORNER") {
    pixelX += 0.5;
    pixelY += 0.5;
  }
  if (camera.pixelOrigin === "BOTTOM_LEFT") pixelY = camera.height - pixelY;

  const { fx, fy, cx, cy } = camera.intrinsics;
  const distortedX = (pixelX - cx) / fx;
  const distortedY = (pixelY - cy) / fy;
  let normalizedX = distortedX;
  let normalizedY = distortedY;
  if (camera.distortion !== undefined) {
    let converged = false;
    for (let iteration = 0; iteration < UNDISTORT_ITERATIONS; iteration += 1) {
      const [px, py] = distort(camera.distortion, normalizedX, normalizedY);
      const errorX = distortedX - px;
      const errorY = distortedY - py;
      normalizedX += errorX;
      normalizedY += errorY;
      if (Math.abs(errorX) < UNDISTORT_TOLERANCE && Math.abs(errorY) < UNDISTORT_TOLERANCE) {
        converged = true;
        break;
      }
    }
    if (!converged) return null;
  }

  // En el marco de la cámara, con la componente sobre el eje óptico a 1.
  const yDown = camera.cameraAxes === "X_RIGHT_Y_DOWN_Z_FORWARD";
  const local = [normalizedX, yDown ? normalizedY : -normalizedY, yDown ? 1 : -1];
  const m = camera.worldFromCamera;
  const direction: [number, number, number] = [
    m[0] * local[0] + m[1] * local[1] + m[2] * local[2],
    m[4] * local[0] + m[5] * local[1] + m[6] * local[2],
    m[8] * local[0] + m[9] * local[1] + m[10] * local[2],
  ];
  return {
    origin: [m[3], m[7], m[11]],
    direction,
    length: Math.hypot(local[0], local[1], local[2]),
  };
}
