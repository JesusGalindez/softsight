/**
 * Álgebra lineal mínima para el rasterizador software.
 *
 * Convención: `Mat4` es row-major, `m[fila * 4 + columna]`, y los vectores se
 * tratan como columna, así que transformar es `v' = M · v`. Es la convención
 * opuesta a la de OpenGL/three.js (column-major) pero hace que las matrices
 * escritas literal en el código se lean igual que en papel, que es lo que
 * interesa cuando el objetivo es explicar la proyección.
 */

export type Mat4 = Float32Array;
export type Vec3 = Float32Array;
export type Vec4 = Float32Array;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return Float32Array.of(x, y, z);
}

export function mat4(): Mat4 {
  return new Float32Array(16);
}

export function identity(out: Mat4 = mat4()): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** out = a · b (row-major, ambos). */
export function multiply(a: Mat4, b: Mat4, out: Mat4 = mat4()): Mat4 {
  for (let row = 0; row < 4; row += 1) {
    const a0 = a[row * 4 + 0];
    const a1 = a[row * 4 + 1];
    const a2 = a[row * 4 + 2];
    const a3 = a[row * 4 + 3];
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        a0 * b[col] + a1 * b[4 + col] + a2 * b[8 + col] + a3 * b[12 + col];
    }
  }
  return out;
}

/** Transforma un punto (w implícito = 1) y devuelve las 4 componentes homogéneas. */
export function transformPoint(m: Mat4, x: number, y: number, z: number, out: Vec4): Vec4 {
  out[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
  out[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
  out[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  out[3] = m[12] * x + m[13] * y + m[14] * z + m[15];
  return out;
}

/** Transforma una dirección (w = 0): ignora la traslación. */
export function transformDirection(m: Mat4, x: number, y: number, z: number, out: Vec3): Vec3 {
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[4] * x + m[5] * y + m[6] * z;
  out[2] = m[8] * x + m[9] * y + m[10] * z;
  return out;
}

export function translation(x: number, y: number, z: number, out: Mat4 = mat4()): Mat4 {
  identity(out);
  out[3] = x;
  out[7] = y;
  out[11] = z;
  return out;
}

export function scaling(x: number, y: number, z: number, out: Mat4 = mat4()): Mat4 {
  identity(out);
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotationX(angle: number, out: Mat4 = mat4()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[5] = c;
  out[6] = -s;
  out[9] = s;
  out[10] = c;
  return out;
}

export function rotationY(angle: number, out: Mat4 = mat4()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[0] = c;
  out[2] = s;
  out[8] = -s;
  out[10] = c;
  return out;
}

export function rotationZ(angle: number, out: Mat4 = mat4()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[0] = c;
  out[1] = -s;
  out[4] = s;
  out[5] = c;
  return out;
}

/**
 * Inversa-transpuesta de la submatriz 3x3, que es la matriz correcta para
 * normales: con escalado no uniforme la matriz de modelo deja de preservar
 * ángulos y las normales dejan de ser perpendiculares a la superficie.
 */
export function normalMatrix(m: Mat4, out: Mat4 = mat4()): Mat4 {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[4];
  const e = m[5];
  const f = m[6];
  const g = m[8];
  const h = m[9];
  const i = m[10];

  const cof0 = e * i - f * h;
  const cof1 = f * g - d * i;
  const cof2 = d * h - e * g;
  const det = a * cof0 + b * cof1 + c * cof2;
  const inv = det === 0 ? 0 : 1 / det;

  identity(out);
  // (M⁻¹)ᵗ = cofactores / det, ya colocados transpuestos.
  out[0] = cof0 * inv;
  out[1] = cof1 * inv;
  out[2] = cof2 * inv;
  out[4] = (c * h - b * i) * inv;
  out[5] = (a * i - c * g) * inv;
  out[6] = (b * g - a * h) * inv;
  out[8] = (b * f - c * e) * inv;
  out[9] = (c * d - a * f) * inv;
  out[10] = (a * e - b * d) * inv;
  return out;
}

/**
 * Inversa de una transformación afín (rotación, escalado y traslación).
 *
 * Para `M = [R | t]` la inversa es `[R⁻¹ | -R⁻¹t]`: no hace falta invertir una 4×4
 * general porque la última fila es siempre (0,0,0,1). Se usa para llevar la cámara
 * al espacio del objeto, que es donde el descarte de caras traseras sale barato.
 *
 * Devuelve el determinante de la parte lineal, porque su **signo** importa: negativo
 * significa que la transformación refleja, y una reflexión invierte la orientación de
 * las caras.
 */
export function invertAffine(m: Mat4, out: Mat4): number {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[4];
  const e = m[5];
  const f = m[6];
  const g = m[8];
  const h = m[9];
  const i = m[10];

  const cof0 = e * i - f * h;
  const cof1 = f * g - d * i;
  const cof2 = d * h - e * g;
  const determinant = a * cof0 + b * cof1 + c * cof2;
  if (determinant === 0) {
    identity(out);
    return 0;
  }
  const inverse = 1 / determinant;

  identity(out);
  out[0] = cof0 * inverse;
  out[1] = (c * h - b * i) * inverse;
  out[2] = (b * f - c * e) * inverse;
  out[4] = cof1 * inverse;
  out[5] = (a * i - c * g) * inverse;
  out[6] = (c * d - a * f) * inverse;
  out[8] = cof2 * inverse;
  out[9] = (b * g - a * h) * inverse;
  out[10] = (a * e - b * d) * inverse;

  const tx = m[3];
  const ty = m[7];
  const tz = m[11];
  out[3] = -(out[0] * tx + out[1] * ty + out[2] * tz);
  out[7] = -(out[4] * tx + out[5] * ty + out[6] * tz);
  out[11] = -(out[8] * tx + out[9] * ty + out[10] * tz);
  return determinant;
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length > 0) {
    v[0] /= length;
    v[1] /= length;
    v[2] /= length;
  }
  return v;
}

export function cross(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
