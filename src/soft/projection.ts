/**
 * Proyección y espacios de coordenadas.
 *
 * Cadena completa que recorre un vértice:
 *
 *   objeto --[model]--> mundo --[view]--> vista --[projection]--> clip
 *          --[/w]--> NDC --[viewport]--> pantalla (píxeles)
 *
 * El divide por w NO ocurre aquí: ocurre después del recortado (ver clip.ts).
 * Ese orden es la razón real por la que se usa una matriz en lugar de dividir
 * directamente x/z — no es que la matriz sea "más estable numéricamente" por
 * sí misma, es que retrasa la división lo suficiente para poder recortar en un
 * espacio donde el plano cercano es un plano lineal (z = -w) y la división
 * nunca ve un denominador cero.
 */

import { identity, mat4, type Mat4, type Vec3, cross, normalize, vec3 } from "./math";

/**
 * Proyección perspectiva estilo OpenGL: espacio de vista diestro (right-handed),
 * cámara mirando hacia -Z, NDC en [-1, 1] en los tres ejes.
 *
 * El factor de escala es la cotangente de la mitad del FOV vertical:
 *
 *   f = cot(fovY / 2) = 1 / tan(fovY / 2)
 *
 * Geométricamente f es la distancia al plano de proyección cuando ese plano
 * tiene media altura 1. Un FOV estrecho da f grande (teleobjetivo, poca
 * distorsión); un FOV ancho da f pequeño (gran angular).
 *
 *   | f/aspect   0        0                   0                  |
 *   | 0          f        0                   0                  |
 *   | 0          0        (near+far)/(far-near)  2·near·far/(far-near) |
 *   | 0          0       -1                   0                  |
 *
 * La última fila es la clave: copia -z_vista en w_clip. Ahí queda codificado
 * el "perspective divide" que el texto describe como x' = x/z. Al dividir
 * después por w se recupera exactamente x_vista·f / (-z_vista): la misma
 * división por profundidad, pero diferida.
 *
 * PROFUNDIDAD INVERTIDA (reversed-Z). La tercera fila lleva `near` y `far`
 * intercambiados respecto a la matriz canónica de OpenGL, así que el plano
 * cercano cae en z_ndc = +1 y el lejano en z_ndc = -1. El motivo es de
 * precisión: la profundidad proyectada es una hipérbola en 1/z_vista, y en la
 * convención canónica el mapeo apila su enorme resolución cercana justo donde
 * el float32 ya es denso (valores próximos a 0), desperdiciándola dos veces.
 * Invertir el rango hace que las dos no linealidades —la hipérbola y el
 * espaciado del float— se cancelen casi exactamente, y el error relativo de
 * profundidad pasa a ser casi uniforme en toda la escena. Cuesta cero
 * instrucciones: solo dos constantes distintas, el buffer limpiado a 0 y el
 * test de profundidad como "mayor pasa".
 */
export function perspective(
  fovYRadians: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4 = mat4(),
): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  const depthRange = far - near;

  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (near + far) / depthRange;
  out[11] = (2 * near * far) / depthRange;
  out[14] = -1;
  return out;
}

/**
 * Proyección ortográfica: el volumen de vista es una caja, no una pirámide
 * truncada. No hay divide por w porque la última fila deja w_clip = 1, así que
 * el tamaño en pantalla es independiente de la profundidad.
 *
 * Sigue siendo una proyección en el sentido geométrico estricto — es una
 * proyección paralela sobre el plano de imagen, con los rayos de proyección
 * paralelos en vez de concurrentes en el centro óptico. Llamarla "proyección"
 * no es un abuso de lenguaje; lo que desaparece es la división, no la
 * proyección.
 */
export function orthographic(
  halfHeight: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4 = mat4(),
): Mat4 {
  const halfWidth = halfHeight * aspect;
  const depthRange = far - near;

  identity(out);
  out[0] = 1 / halfWidth;
  out[5] = 1 / halfHeight;
  // Mismo rango invertido que la perspectiva: cercano en +1, lejano en -1. Aquí
  // no gana precisión (el mapeo ya es lineal) pero el rasterizador tiene que
  // poder usar un único sentido de comparación de profundidad.
  out[10] = 2 / depthRange;
  out[11] = (far + near) / depthRange;
  return out;
}

/**
 * Matriz de vista: mundo -> espacio de cámara. Base ortonormal diestra con la
 * cámara en el origen mirando hacia -Z, que es lo que asume `perspective`.
 */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3, out: Mat4 = mat4()): Mat4 {
  const forward = normalize(vec3(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]));
  const right = normalize(cross(up, forward));
  const trueUp = cross(forward, right);

  identity(out);
  out[0] = right[0];
  out[1] = right[1];
  out[2] = right[2];
  out[3] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);

  out[4] = trueUp[0];
  out[5] = trueUp[1];
  out[6] = trueUp[2];
  out[7] = -(trueUp[0] * eye[0] + trueUp[1] * eye[1] + trueUp[2] * eye[2]);

  out[8] = forward[0];
  out[9] = forward[1];
  out[10] = forward[2];
  out[11] = -(forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2]);
  return out;
}

/**
 * Transformación de viewport: NDC [-1,1] -> píxeles [0, width] × [0, height].
 * Y se invierte porque en NDC crece hacia arriba y en un framebuffer crece
 * hacia abajo.
 *
 * El +0.5 en el centro del píxel no va aquí: lo aplica el rasterizador al
 * muestrear, no la transformación de coordenadas.
 */
export function ndcToScreenX(ndcX: number, width: number): number {
  return (ndcX * 0.5 + 0.5) * width;
}

export function ndcToScreenY(ndcY: number, height: number): number {
  return (1 - (ndcY * 0.5 + 0.5)) * height;
}

/**
 * Profundidad NDC -> [0,1] para el z-buffer. Con el rango invertido de
 * `perspective`, el plano cercano cae en 1 y el lejano en 0: el buffer se
 * limpia a 0 y pasa el valor MAYOR.
 */
export function ndcDepthToBuffer(ndcZ: number): number {
  return ndcZ * 0.5 + 0.5;
}

/**
 * Los seis planos del frustum salen de sumar y restar filas de la matriz
 * view-projection, sin invertirla ni resolver nada.
 *
 * Un punto está dentro del volumen de clip si -w ≤ x ≤ w (y análogo en y, z).
 * Escribiendo x = fila₀·v y w = fila₃·v, la condición x + w ≥ 0 es
 * (fila₀ + fila₃)·v ≥ 0: una desigualdad lineal, es decir un plano. Los seis
 * salen de las seis combinaciones. Se normalizan por el módulo de la normal
 * para que el valor devuelto sea distancia firmada en unidades de mundo y se
 * pueda comparar directo contra el radio de una esfera envolvente.
 *
 * Escribe 6 planos × 4 componentes (a, b, c, d) en `out`.
 */
export function extractFrustumPlanes(viewProjection: Mat4, out: Float32Array): void {
  const m = viewProjection;
  let plane = 0;
  for (let row = 0; row < 3; row += 1) {
    for (const sign of [1, -1] as const) {
      const target = plane * 4;
      let a = m[12] + sign * m[row * 4 + 0];
      let b = m[13] + sign * m[row * 4 + 1];
      let c = m[14] + sign * m[row * 4 + 2];
      let d = m[15] + sign * m[row * 4 + 3];
      const length = Math.hypot(a, b, c);
      if (length > 0) {
        a /= length;
        b /= length;
        c /= length;
        d /= length;
      }
      out[target] = a;
      out[target + 1] = b;
      out[target + 2] = c;
      out[target + 3] = d;
      plane += 1;
    }
  }
}

/**
 * Rechazo de esfera envolvente contra los 6 planos: si el centro está más lejos
 * del plano que el radio, hacia el lado de fuera, no hay nada que dibujar.
 * Seis productos escalares por objeto contra miles de triángulos.
 */
export function sphereOutsideFrustum(
  planes: Float32Array,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
): boolean {
  for (let plane = 0; plane < 6; plane += 1) {
    const offset = plane * 4;
    const distance =
      planes[offset] * centerX +
      planes[offset + 1] * centerY +
      planes[offset + 2] * centerZ +
      planes[offset + 3];
    if (distance < -radius) return true;
  }
  return false;
}
