/**
 * Mapa de sombras direccional.
 *
 * Una sombra es una consulta de visibilidad: «¿ve la luz este punto?». La respuesta
 * es la misma que da un z-buffer, solo que con la cámara puesta en la luz. Así que
 * el mapa de sombras no necesita nada nuevo del motor: es un pase **solo de
 * profundidad** desde el punto de vista de la luz, y después, por cada píxel
 * sombreado, comparar su profundidad en ese espacio con la almacenada.
 *
 * Tres decisiones que son las que separan una sombra utilizable de un desastre:
 *
 * 1. PROFUNDIDAD LINEAL EN LUGAR DE NDC. La luz es direccional, luego la proyección
 *    es ortográfica y la profundidad ya es lineal. Se guarda directamente la
 *    distancia normalizada a lo largo de la dirección de la luz, sin pasar por el
 *    divide por w ni por la hipérbola de la perspectiva: precisión uniforme en todo
 *    el rango y ninguna constante mágica que ajustar.
 *
 * 2. AJUSTE A LOS EMISORES, NO A LA ESCENA. Si el volumen de la luz tuviera que
 *    cubrir el suelo de 60×60 unidades, un dron de 2 unidades ocuparía tres téxeles
 *    y su sombra serían tres cuadrados. Se ajusta a la caja de los objetos que
 *    proyectan sombra —el suelo recibe pero no proyecta— y la resolución se gasta
 *    donde hay geometría.
 *
 * 3. DESPLAZAMIENTO POR NORMAL EN VEZ DE SESGO CONSTANTE. El error clásico es que
 *    una superficie se sombree a sí misma: el téxel del mapa cubre un trozo de
 *    superficie inclinada, su profundidad representa un punto de ese trozo, y el
 *    resto queda «detrás». Un sesgo constante lo tapa a costa de despegar la sombra
 *    del objeto. Desplazar el punto de consulta a lo largo de la normal una fracción
 *    del tamaño del téxel ataca la causa: el desplazamiento crece con la inclinación
 *    porque es donde el téxel cubre más superficie.
 */

import { identity, mat4, type Mat4 } from "./math";
import type { Mesh } from "./mesh";

export interface ShadowCaster {
  mesh: Mesh;
  model: Mat4;
}

export interface ShadowMapOptions {
  size?: number;
  /** Desplazamiento a lo largo de la normal, en múltiplos del téxel en mundo. */
  normalOffsetTexels?: number;
  /** Sesgo constante en profundidad normalizada, contra el error de cuantización. */
  constantBias?: number;
  /** Muestras por píxel: 1 (borde duro) o 4 (borde suavizado). */
  samples?: 1 | 4;
}

export class ShadowMap {
  readonly size: number;
  /** Profundidad más cercana a la luz por téxel, en [0,1]. 1 = nada. */
  readonly depth: Float32Array;
  /** Mundo -> (x, y en [-1,1], profundidad en [0,1]). */
  readonly lightMatrix: Mat4 = mat4();

  /** Tamaño en unidades de mundo de un téxel del mapa. */
  texelWorldSize = 0;
  readonly normalOffsetTexels: number;
  readonly constantBias: number;
  /** Muestras por píxel. Es el parámetro que decide el coste del sombreado. */
  samples: 1 | 4;

  private transformed = new Float32Array(0);

  constructor(options: ShadowMapOptions = {}) {
    this.size = options.size ?? 1024;
    this.depth = new Float32Array(this.size * this.size);
    this.normalOffsetTexels = options.normalOffsetTexels ?? 1.5;
    this.constantBias = options.constantBias ?? 0.0015;
    this.samples = options.samples ?? 4;
  }

  /**
   * Construye el volumen de la luz y rasteriza la profundidad de los emisores.
   * `lightDirection` apunta *hacia* la luz, igual que en el sombreado.
   */
  render(casters: readonly ShadowCaster[], lightDirection: readonly number[]): void {
    this.depth.fill(1);
    if (casters.length === 0) return;

    // Caja envolvente de los emisores, en mundo.
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const caster of casters) {
      const { positions } = caster.mesh;
      const m = caster.model;
      for (let offset = 0; offset < positions.length; offset += 3) {
        const x = positions[offset];
        const y = positions[offset + 1];
        const z = positions[offset + 2];
        const wx = m[0] * x + m[1] * y + m[2] * z + m[3];
        const wy = m[4] * x + m[5] * y + m[6] * z + m[7];
        const wz = m[8] * x + m[9] * y + m[10] * z + m[11];
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wz < minZ) minZ = wz;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
        if (wz > maxZ) maxZ = wz;
      }
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Base ortonormal de la luz. El vector auxiliar se elige lejos de la dirección
    // de la luz para que el producto vectorial no degenere cuando la luz es vertical.
    const fx = lightDirection[0];
    const fy = lightDirection[1];
    const fz = lightDirection[2];
    const auxiliaryX = Math.abs(fy) > 0.9 ? 1 : 0;
    const auxiliaryY = Math.abs(fy) > 0.9 ? 0 : 1;
    let rx = auxiliaryY * fz - 0 * fy;
    let ry = 0 * fx - auxiliaryX * fz;
    let rz = auxiliaryX * fy - auxiliaryY * fx;
    const rightLength = Math.hypot(rx, ry, rz) || 1;
    rx /= rightLength;
    ry /= rightLength;
    rz /= rightLength;
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;

    // Semi-extensiones en la base de la luz, proyectando las ocho esquinas.
    let halfWidth = 0;
    let halfHeight = 0;
    let halfDepth = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const cx = (corner & 1 ? maxX : minX) - centerX;
      const cy = (corner & 2 ? maxY : minY) - centerY;
      const cz = (corner & 4 ? maxZ : minZ) - centerZ;
      halfWidth = Math.max(halfWidth, Math.abs(cx * rx + cy * ry + cz * rz));
      halfHeight = Math.max(halfHeight, Math.abs(cx * ux + cy * uy + cz * uz));
      halfDepth = Math.max(halfDepth, Math.abs(cx * fx + cy * fy + cz * fz));
    }
    halfWidth = Math.max(halfWidth, 1e-4) * 1.05;
    halfHeight = Math.max(halfHeight, 1e-4) * 1.05;
    halfDepth = Math.max(halfDepth, 1e-4) * 1.05;

    this.texelWorldSize = (2 * Math.max(halfWidth, halfHeight)) / this.size;

    // Matriz mundo -> espacio de luz normalizado. Las dos primeras filas dan x, y en
    // [-1,1]; la tercera, la profundidad en [0,1] creciendo al alejarse de la luz.
    const m = this.lightMatrix;
    identity(m);
    m[0] = rx / halfWidth;
    m[1] = ry / halfWidth;
    m[2] = rz / halfWidth;
    m[3] = -(rx * centerX + ry * centerY + rz * centerZ) / halfWidth;
    m[4] = ux / halfHeight;
    m[5] = uy / halfHeight;
    m[6] = uz / halfHeight;
    m[7] = -(ux * centerX + uy * centerY + uz * centerZ) / halfHeight;
    // La luz mira en -dirección, así que la profundidad crece con -dot(p, f).
    const depthScale = -1 / (2 * halfDepth);
    m[8] = fx * depthScale;
    m[9] = fy * depthScale;
    m[10] = fz * depthScale;
    m[11] = -(fx * centerX + fy * centerY + fz * centerZ) * depthScale + 0.5;

    for (const caster of casters) this.rasterizeCaster(caster);
  }

  /** Pase solo de profundidad: sin varyings, sin shader, sin color. */
  private rasterizeCaster(caster: ShadowCaster): void {
    const { positions, indices } = caster.mesh;
    const vertexCount = positions.length / 3;
    if (this.transformed.length < vertexCount * 3) {
      this.transformed = new Float32Array(vertexCount * 3);
    }

    const model = caster.model;
    const light = this.lightMatrix;
    const transformed = this.transformed;
    const half = this.size / 2;

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      const wx = model[0] * x + model[1] * y + model[2] * z + model[3];
      const wy = model[4] * x + model[5] * y + model[6] * z + model[7];
      const wz = model[8] * x + model[9] * y + model[10] * z + model[11];
      // Espacio de luz y directamente a téxeles, que es donde se rasteriza.
      transformed[offset] = (light[0] * wx + light[1] * wy + light[2] * wz + light[3] + 1) * half;
      transformed[offset + 1] =
        (light[4] * wx + light[5] * wy + light[6] * wz + light[7] + 1) * half;
      transformed[offset + 2] = light[8] * wx + light[9] * wy + light[10] * wz + light[11];
    }

    const { depth, size } = this;

    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] * 3;
      const b = indices[index + 1] * 3;
      const c = indices[index + 2] * 3;

      const x0 = transformed[a];
      const y0 = transformed[a + 1];
      const z0 = transformed[a + 2];
      const x1 = transformed[b];
      const y1 = transformed[b + 1];
      const z1 = transformed[b + 2];
      const x2 = transformed[c];
      const y2 = transformed[c + 1];
      const z2 = transformed[c + 2];

      const doubleArea = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (doubleArea === 0) continue;
      // Sin culling de caras: en un mapa de sombras interesa la superficie más
      // cercana a la luz, venga de la cara delantera o de la trasera.
      const orientation = doubleArea > 0 ? 1 : -1;
      const inverseArea = orientation / doubleArea;

      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;

      const a12 = (y1 - y2) * orientation;
      const b12 = (x2 - x1) * orientation;
      const a20 = (y2 - y0) * orientation;
      const b20 = (x0 - x2) * orientation;
      const a01 = (y0 - y1) * orientation;
      const b01 = (x1 - x0) * orientation;

      const startX = minX + 0.5;
      const startY = minY + 0.5;
      let rowEdge12 = a12 * startX + b12 * startY + (x1 * y2 - y1 * x2) * orientation;
      let rowEdge20 = a20 * startX + b20 * startY + (x2 * y0 - y2 * x0) * orientation;
      let rowEdge01 = a01 * startX + b01 * startY + (x0 * y1 - y0 * x1) * orientation;

      const depthStepX = (a12 * z0 + a20 * z1 + a01 * z2) * inverseArea;
      const depthStepY = (b12 * z0 + b20 * z1 + b01 * z2) * inverseArea;
      let rowDepth =
        (rowEdge12 * z0 + rowEdge20 * z1 + rowEdge01 * z2) * inverseArea;

      for (let y = minY; y <= maxY; y += 1) {
        // Mismo span exacto que el rasterizador principal.
        let kMin = 0;
        let kMax = maxX - minX;
        if (a12 > 0) kMin = Math.max(kMin, Math.ceil(-rowEdge12 / a12));
        else if (a12 < 0) kMax = Math.min(kMax, Math.floor(-rowEdge12 / a12));
        else if (rowEdge12 < 0) kMax = -1;
        if (a20 > 0) kMin = Math.max(kMin, Math.ceil(-rowEdge20 / a20));
        else if (a20 < 0) kMax = Math.min(kMax, Math.floor(-rowEdge20 / a20));
        else if (rowEdge20 < 0) kMax = -1;
        if (a01 > 0) kMin = Math.max(kMin, Math.ceil(-rowEdge01 / a01));
        else if (a01 < 0) kMax = Math.min(kMax, Math.floor(-rowEdge01 / a01));
        else if (rowEdge01 < 0) kMax = -1;

        if (kMin <= kMax) {
          let texel = y * size + minX + kMin;
          let value = rowDepth + depthStepX * kMin;
          for (let k = kMin; k <= kMax; k += 1) {
            if (value < depth[texel]) depth[texel] = value;
            value += depthStepX;
            texel += 1;
          }
        }

        rowEdge12 += b12;
        rowEdge20 += b20;
        rowEdge01 += b01;
        rowDepth += depthStepY;
      }
    }
  }

  /**
   * Fracción de luz que llega a un punto: 0 en sombra plena, 1 iluminado.
   *
   * Cuatro muestras en cruz diagonal en vez de una: una sola da un borde escalonado
   * del tamaño del téxel, y cuatro lo convierten en cinco niveles, suficiente para
   * que el ojo lo lea como suave. Nueve muestras costarían más del doble y la
   * diferencia ya no se ve.
   */
  sampleAt(ndcX: number, ndcY: number, depthValue: number): number {
    // Fuera del volumen de la luz no hay información: se considera iluminado, que es
    // el fallo menos visible —lo contrario pinta de negro media escena.
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || depthValue < 0 || depthValue > 1) {
      return 1;
    }

    const half = this.size / 2;
    const texelX = (ndcX + 1) * half;
    const texelY = (ndcY + 1) * half;
    const limit = this.size - 1;
    const threshold = depthValue - this.constantBias;

    // Una muestra: borde del tamaño del téxel, y **la mitad del coste medido** del
    // sombreado con sombras. La diferencia visual solo se aprecia en el borde de la
    // penumbra, así que se deja elegir en vez de imponerla.
    if (this.samples === 1) {
      const sx = Math.min(limit, Math.max(0, texelX | 0));
      const sy = Math.min(limit, Math.max(0, texelY | 0));
      return threshold <= this.depth[sy * this.size + sx] ? 1 : 0;
    }

    let lit = 0;
    for (let sample = 0; sample < 4; sample += 1) {
      const dx = sample === 0 || sample === 3 ? -0.5 : 0.5;
      const dy = sample < 2 ? -0.5 : 0.5;
      const sx = Math.min(limit, Math.max(0, (texelX + dx) | 0));
      const sy = Math.min(limit, Math.max(0, (texelY + dy) | 0));
      if (threshold <= this.depth[sy * this.size + sx]) lit += 0.25;
    }
    return lit;
  }
}
