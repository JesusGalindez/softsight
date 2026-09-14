/**
 * R13 — la auditoría de coordenadas de textura.
 *
 * ## Lo primero: ausente no es cero
 *
 * Los lectores **rellenan `uvs` con ceros** cuando el atributo no viene, así que
 * «esta malla no tiene UV» y «todas sus UV están en el mismo punto» llegan aquí
 * como el mismo array. Son dos cosas muy distintas — la primera es un asset que
 * no se puede texturizar y la segunda una malla rota— y por eso el dato viaja
 * aparte, en `hasUvs`, leído de donde todavía se distingue. Adivinarlo mirando
 * los números habría dado la respuesta correcta casi siempre y la equivocada en
 * el único caso que importa.
 *
 * ## Qué se mide, y por qué cada cosa
 *
 * ```text
 * fuera del rango    una UV en 1,7 depende del modo de repetición del material;
 *                    con `CLAMP` es un estirón en el borde de la textura
 * área nula          un triángulo con UV degeneradas no recibe textura: su
 *                    téxel es un punto, y el filtrado lo convierte en una raya
 * densidad de téxel  cuántos téxeles por unidad de mundo. Lo que importa no es
 *                    la media sino **la dispersión**: dos partes de la misma
 *                    pieza a densidades distintas se ven a resoluciones
 *                    distintas, y eso salta a la vista
 * solape             dos triángulos sobre el mismo téxel comparten pintura. En
 *                    un atlas de color es un defecto; en uno de luz, imposible
 * ```
 *
 * ## Lo que no hace
 *
 * No propone un despliegue. Igual que R10 no repara, esto no reempaqueta: decir
 * dónde están mal las UV es medir, y decidir dónde van es modelar.
 */

import type { Mesh } from "../../mesh";

/**
 * Celdas por lado de la rejilla con la que se busca solape.
 *
 * Se usa para el **área de la unión**, no para contar celdas repetidas. Contarlas
 * se intentó y no medía nada: dos triángulos vecinos comparten las celdas de su
 * arista común, así que en una malla densa **todas** las celdas salían repetidas y
 * el ratio daba 1,0000 sobre cualquier cosa. La adyacencia no es solape.
 *
 * Lo que sí lo es: la suma de las áreas UV comparada con la unión. Dos triángulos
 * que comparten una arista aportan área cero a la diferencia; dos que se pisan
 * aportan la que se pisan. La rejilla solo aproxima la unión —una celda tocada a
 * medias cuenta entera—, así que el ratio se recorta en cero y se lee como «hay
 * al menos esto», no como el área exacta.
 */
export const UV_GRID = 256;

/** Por debajo de esto, el área de un triángulo en UV es redondeo y no área. */
export const UV_DEGENERATE_AREA = 1e-12;

export interface UvAudit {
  measurementClass: "EXACT" | "APPROXIMATE";
  reproducibility: "BITWISE_EXACT";
  /** Si la malla traía UV. Sin ellas, lo demás es `null` y no cero. */
  present: boolean;
  reason?: string;
  /** Triángulos cuyo triángulo UV tiene área nula: no reciben textura. */
  degenerateTriangles?: number;
  /** Vértices con alguna coordenada fuera de [0, 1]. */
  outsideUnitSquare?: number;
  /** La caja que ocupan las UV, para ver de un vistazo si se salen y cuánto. */
  bounds?: { min: [number, number]; max: [number, number] };
  /**
   * Densidad de téxel por unidad de mundo, en percentiles. **La dispersión es el
   * dato**: la mediana sola no distingue una pieza uniforme de una con la mitad
   * al doble de resolución.
   */
  texelDensity?: { p05: number; median: number; p95: number; spread: number };
  /**
   * Cuánta área UV se pisa, sobre la que ocupan las islas. Cero es un despliegue
   * sin solape; 0,5 significa que se pinta una vez y media lo que hay sitio para
   * pintar una. **No cuenta adyacencia**: dos triángulos que comparten arista no
   * se pisan.
   */
  overlapRatio?: number;
  /** Fracción del cuadrado unidad que las islas ocupan: cuánto atlas se aprovecha. */
  utilization?: number;
  /**
   * Fracción de triángulos cuyo bobinado en UV va al revés que el de la mayoría:
   * **islas espejadas**.
   *
   * No es un defecto — espejar media pieza para ahorrar atlas es una técnica
   * corriente— pero **obliga a que la tangente lleve signo**, y un pipeline que
   * lo ignore pinta el relieve al revés en esa mitad. Es la auditoría de
   * tangentes que R13 pide, reducida a lo único que se puede afirmar sin
   * tangentes declaradas: cuánta superficie las necesita con signo.
   */
  mirroredRatio?: number;
  gridResolution?: number;
}

/** Área con signo de un triángulo en el plano UV. */
function uvArea(
  uvs: Float32Array,
  a: number,
  b: number,
  c: number,
): number {
  return (
    ((uvs[b * 2] - uvs[a * 2]) * (uvs[c * 2 + 1] - uvs[a * 2 + 1]) -
      (uvs[c * 2] - uvs[a * 2]) * (uvs[b * 2 + 1] - uvs[a * 2 + 1])) /
    2
  );
}

/** Área de un triángulo en el mundo. */
function worldArea(positions: Float32Array, a: number, b: number, c: number): number {
  const ux = positions[b * 3] - positions[a * 3];
  const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
  const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const vx = positions[c * 3] - positions[a * 3];
  const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
  const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function quantile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function auditUvs(mesh: Mesh, hasUvs: boolean, grid = UV_GRID): UvAudit {
  if (!hasUvs) {
    // **Ausente y no cero.** Un asset sin UV no tiene densidad de téxel «cero»:
    // no tiene densidad de téxel, y publicar un cero invitaría a compararlo.
    return {
      measurementClass: "EXACT",
      reproducibility: "BITWISE_EXACT",
      present: false,
      reason: "SIN_COORDENADAS_DE_TEXTURA",
    };
  }

  const { positions, indices, uvs } = mesh;
  const triangleCount = indices.length / 3;

  let degenerate = 0;
  let positivos = 0;
  let negativos = 0;
  const densities: number[] = [];
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  const tocadas = new Uint8Array(grid * grid);
  /** Suma de las áreas UV de los triángulos, en unidades del cuadrado unidad. */
  let areaSumada = 0;

  for (let vertex = 0; vertex < uvs.length / 2; vertex += 1) {
    min[0] = Math.min(min[0], uvs[vertex * 2]);
    min[1] = Math.min(min[1], uvs[vertex * 2 + 1]);
    max[0] = Math.max(max[0], uvs[vertex * 2]);
    max[1] = Math.max(max[1], uvs[vertex * 2 + 1]);
  }
  let fuera = 0;
  for (let vertex = 0; vertex < uvs.length / 2; vertex += 1) {
    const u = uvs[vertex * 2];
    const v = uvs[vertex * 2 + 1];
    if (u < 0 || u > 1 || v < 0 || v > 1) fuera += 1;
  }

  const celda = (fila: number, columna: number): number => fila * grid + columna;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices[triangle * 3];
    const b = indices[triangle * 3 + 1];
    const c = indices[triangle * 3 + 2];
    const firmada = uvArea(uvs, a, b, c);
    const area = Math.abs(firmada);
    if (area <= UV_DEGENERATE_AREA) {
      degenerate += 1;
      continue;
    }
    if (firmada > 0) positivos += 1;
    else negativos += 1;
    areaSumada += area;
    const mundo = worldArea(positions, a, b, c);
    // Téxeles por unidad de mundo: la raíz porque las dos áreas son cuadradas y
    // lo que se compara es una longitud. Un triángulo de área nula en el mundo no
    // aporta densidad —no es que sea infinita, es que no hay superficie—.
    if (mundo > 0) densities.push(Math.sqrt(area / mundo));

    // Rejilla: se marca **el triángulo**, no su caja.
    //
    // Con la caja, un triángulo de la costura —de los que cruzan de u≈1 a u≈0 en
    // una proyección esférica— abarca la textura entera y marca todas las celdas.
    // Medido así, cualquier esfera daba el 100 % de solape y el número no
    // distinguía nada. Se rellena por el centro de la celda, como una silueta.
    const ax = uvs[a * 2] * grid;
    const ay = uvs[a * 2 + 1] * grid;
    const bx = uvs[b * 2] * grid;
    const by = uvs[b * 2 + 1] * grid;
    const cx = uvs[c * 2] * grid;
    const cy = uvs[c * 2 + 1] * grid;
    const doble = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (doble === 0) continue;
    const izquierda = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const derecha = Math.min(grid - 1, Math.ceil(Math.max(ax, bx, cx)));
    const arriba = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const abajo = Math.min(grid - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let fila = arriba; fila <= abajo; fila += 1) {
      for (let columna = izquierda; columna <= derecha; columna += 1) {
        const px = columna + 0.5;
        const py = fila + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / doble;
        const w1 = ((cx - bx) * (py - by) - (px - bx) * (cy - by)) / doble;
        const w2 = ((ax - cx) * (py - cy) - (px - cx) * (ay - cy)) / doble;
        // Sin signo: el bobinado en UV no decide qué celda se pinta.
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        tocadas[celda(fila, columna)] = 1;
      }
    }
  }

  let ocupadas = 0;
  for (let indice = 0; indice < tocadas.length; indice += 1) {
    if (tocadas[indice] === 1) ocupadas += 1;
  }
  const areaUnion = ocupadas / (grid * grid);
  // Recortado en cero: la rejilla cuenta entera una celda tocada a medias, así
  // que la unión sale algo mayor que la de verdad y la resta puede ser negativa
  // sin que haya nada solapado.
  const solape = areaUnion === 0 ? 0 : Math.max(0, (areaSumada - areaUnion) / areaUnion);

  densities.sort((a, b) => a - b);
  const mediana = densities.length === 0 ? 0 : quantile(densities, 0.5);

  return {
    // La rejilla discretiza el solape y la ocupación, así que el conjunto
    // aproxima. Los recuentos de arriba son exactos y van igual.
    measurementClass: "APPROXIMATE",
    reproducibility: "BITWISE_EXACT",
    present: true,
    degenerateTriangles: degenerate,
    outsideUnitSquare: fuera,
    bounds: { min, max },
    texelDensity:
      densities.length === 0
        ? { p05: 0, median: 0, p95: 0, spread: 0 }
        : {
            p05: quantile(densities, 0.05),
            median: mediana,
            p95: quantile(densities, 0.95),
            // **La dispersión es el dato**: p95 entre p05. Una pieza uniforme da
            // 1 y una con la mitad al doble de resolución da 2, con la misma
            // mediana en los dos casos.
            spread: quantile(densities, 0.05) === 0 ? 0 : quantile(densities, 0.95) / quantile(densities, 0.05),
          },
    overlapRatio: solape,
    // Contra la mayoría y no contra un signo fijo: qué sentido es «el derecho»
    // depende del bobinado de la malla, y fijarlo aquí llamaría espejada a una
    // pieza entera que simplemente se desplegó al revés.
    mirroredRatio:
      positivos + negativos === 0 ? 0 : Math.min(positivos, negativos) / (positivos + negativos),
    utilization: ocupadas / (grid * grid),
    gridResolution: grid,
  };
}
