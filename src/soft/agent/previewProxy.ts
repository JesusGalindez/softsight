/**
 * §54 — la geometría que se mide y la geometría que se mira no son la misma.
 *
 * Un `mesh_refined.ply` de 5,7 millones de triángulos se audita entero: contar
 * bordes, buscar cruces y medir cobertura sobre una versión simplificada daría
 * números de otra pieza. Pero **rasterizarlo para un pliego de contactos de 320
 * píxeles por baldosa es tirar el 95 % del trabajo a la basura**: a esa escala,
 * un triángulo de cada veinte cae dentro de un píxel que ya estaba pintado.
 *
 * Así que hay dos geometrías y el informe dice cuál se usó para qué:
 *
 * ```text
 * AUDIT GEOMETRY     la malla entera, siempre. Toda medida sale de aquí
 * PREVIEW GEOMETRY   un proxy, cuando la malla pasa del presupuesto
 * ```
 *
 * ## Lo que este proxy NO es
 *
 * **No es un LOD.** R12 midió exactamente esto: un nivel de detalle que se desvía
 * un 2,7 % de la diagonal en superficie puede perder un 12 % de silueta, y la
 * silueta es donde se nota. Un proxy de vista vale porque nadie va a medir sobre
 * él; el día que alguien lo confunda con un LOD entregable, entregará una pieza
 * que se ve mal de canto. Por eso `renderSource` viaja **siempre** en el informe,
 * también cuando no hubo proxy: ausente no es «malla entera», ausente es «no se
 * sabe», y quien lea una medida necesita poder descartar que salga de un proxy.
 *
 * ## Agrupación por celda, y por qué el representante no es el promedio
 *
 * Se divide la caja envolvente en una rejilla y todos los vértices de una celda
 * se colapsan en uno. La alternativa habitual es promediarlos, y aquí no se hace:
 * el promedio de tres vértices de una esquina cae **dentro** de la pieza, y un
 * proxy hecho de promedios se encoge y redondea. El representante es el primer
 * vértice de la celda en orden de índice, así que:
 *
 * ```text
 * todo vértice del proxy está EN la malla original, no cerca
 * el resultado no depende de en qué orden se recorran las celdas
 * dos ejecuciones dan el mismo proxy, byte a byte
 * ```
 *
 * Un triángulo cuyos tres vértices no caen en tres celdas distintas desaparece:
 * ya no tiene área. Eso abre agujeros donde la malla era más fina que la celda, y
 * es correcto para mirar y sería inaceptable para medir — que es, otra vez, la
 * línea entera de este módulo.
 */

import type { Mesh } from "../mesh";

/**
 * Presupuesto de triángulos para la vista. El número del §54, y va como defecto
 * declarado: quien renderiza baldosas de 1.024 píxeles tiene otro criterio.
 */
export const PREVIEW_MAX_TRIANGLES = 250_000;

/** Qué geometría se rasterizó, que el informe publica siempre. */
export interface RenderSource {
  type: "full" | "proxy";
  sourceTriangles: number;
  renderTriangles: number;
}

/**
 * Divisiones de rejilla para acercarse al presupuesto.
 *
 * Es una estimación y se dice: el número final de triángulos depende de cómo
 * estén repartidos los vértices, y una pieza hueca deja celdas vacías. Se apunta
 * a la raíz cúbica del presupuesto porque una superficie ocupa del orden de
 * `n²` celdas de una rejilla de `n³`, y se acota abajo para que el proxy no se
 * convierta en una caja.
 */
function gridDivisions(budgetTriangles: number): number {
  // Una superficie cerrada dentro de una rejilla de `n³` toca del orden de `6n²`
  // celdas, y una malla triangulada tiene del orden de dos triángulos por
  // vértice: `12n²` triángulos para `n` divisiones. De ahí sale `n`.
  return Math.max(4, Math.round(Math.sqrt(budgetTriangles / 12)));
}

/**
 * Reparto de un presupuesto **global** entre varias mallas.
 *
 * Aplicar el mismo tope a cada pieza no es un presupuesto: un dron de 296 piezas
 * de 130 triángulos no baja de 37.950 ni pidiendo 2.000, porque ninguna pieza
 * pasa el tope por su cuenta. Cada una recibe su parte proporcional, así que las
 * grandes se simplifican y las pequeñas se quedan como están.
 */
export function shareBudget(triangles: number, total: number, budgetTriangles: number): number {
  if (total <= 0) return budgetTriangles;
  return Math.max(1, Math.floor((budgetTriangles * triangles) / total));
}

/**
 * La malla agrupada por celdas. Devuelve la original **por identidad** si no hay
 * nada que simplificar: copiar para no cambiar nada duplicaría la memoria justo
 * en el caso en el que la malla ya es grande.
 */
export function buildPreviewProxy(mesh: Mesh, budgetTriangles = PREVIEW_MAX_TRIANGLES): Mesh {
  const triangles = mesh.indices.length / 3;
  if (triangles <= budgetTriangles) return mesh;

  const count = mesh.positions.length / 3;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const x = mesh.positions[index * 3];
    const y = mesh.positions[index * 3 + 1];
    const z = mesh.positions[index * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const divisions = gridDivisions(budgetTriangles);
  // Una arista nula —una malla plana— daría división por cero. El tamaño de celda
  // es uno solo para las tres dimensiones: uno por eje deformaría las celdas y con
  // ellas el error, que entonces dependería de la orientación de la pieza.
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cell = extent / divisions;

  const representative = new Map<number, number>();
  const remap = new Int32Array(count);
  const positions: number[] = [];
  const normals: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ix = Math.floor((mesh.positions[index * 3] - minX) / cell);
    const iy = Math.floor((mesh.positions[index * 3 + 1] - minY) / cell);
    const iz = Math.floor((mesh.positions[index * 3 + 2] - minZ) / cell);
    // Clave entera de la celda. `divisions + 1` de base porque el vértice del
    // extremo cae en la división `divisions` exacta y no en la anterior.
    const key = (ix * (divisions + 1) + iy) * (divisions + 1) + iz;
    const hit = representative.get(key);
    if (hit !== undefined) {
      remap[index] = hit;
      continue;
    }
    const slot = positions.length / 3;
    representative.set(key, slot);
    remap[index] = slot;
    positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
    // Las normales pueden faltar del todo —una malla leída de PLY no las trae— y
    // eso no es un caso raro que haya que rechazar: el proxy sale sin ellas y
    // quien rasteriza las deduce de los triángulos, como con cualquier otra.
    if ((mesh.normals?.length ?? 0) >= (index + 1) * 3) {
      normals.push(mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]);
    }
  }

  const indices: number[] = [];
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = remap[mesh.indices[triangle * 3]];
    const b = remap[mesh.indices[triangle * 3 + 1]];
    const c = remap[mesh.indices[triangle * 3 + 2]];
    // Dos vértices en la misma celda dejan el triángulo sin área: desaparece en
    // vez de dibujarse como una arista, que es ruido en un pliego pequeño.
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }

  const proxyPositions = new Float32Array(positions);
  return {
    ...mesh,
    positions: proxyPositions,
    normals: normals.length === positions.length ? new Float32Array(normals) : new Float32Array(0),
    // Las UV no se remapean: el vértice representante trae las suyas y las de los
    // que colapsó no son las mismas. Un proxy con UV inventadas invitaría a
    // texturizarlo, que es medir sobre él con otro nombre.
    uvs: new Float32Array(0),
    // Siempre 32 bits, aunque quepan en 16: `Mesh` los declara así, y estrechar
    // el tipo aquí obligaría a que todo lo que recibe una malla supiera de dos.
    indices: new Uint32Array(indices),
  };
}

/** `renderSource` para un conjunto de mallas, con sus dos recuentos. */
export function describeRenderSource(
  sourceTriangles: number,
  renderTriangles: number,
): RenderSource {
  return {
    type: renderTriangles < sourceTriangles ? "proxy" : "full",
    sourceTriangles,
    renderTriangles,
  };
}
