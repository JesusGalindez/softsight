/**
 * El FrameGraph de D11: ninguna transformación se hornea sin registrarla.
 *
 * El grafo existía en el esquema desde R0-A y **nadie lo miraba**. Un paquete
 * podía declarar cuatro cámaras, una malla y cero aristas, y salir `COMPLETE +
 * PASS`: el campo estaba relleno por educación. Eso es exactamente lo que la
 * decisión quiere impedir, porque el riesgo R7 —«malla de producción en otro
 * marco»— no se ve en ninguna imagen: la geometría sale bien colocada respecto a
 * sí misma y mal respecto a todo lo demás.
 *
 * ## Qué se comprueba, y por qué eso y no otra cosa
 *
 * Registrar una arista es barato; lo que cuesta es que el registro **sea el
 * único camino**. Así que la comprobación no es «hay transformaciones
 * declaradas», que se cumple rellenando una lista, sino:
 *
 * ```text
 * 1  cada arista es una transformación rígida bien formada, con su motivo
 * 2  no hay dos aristas entre los mismos marcos, ni una de un marco a sí mismo
 * 3  todo marco declarado se alcanza desde aquel en el que se mide
 * ```
 *
 * La 3 es la que muerde, y el marco desde el que se mide la conectividad es
 * `RECONSTRUCTION` **porque es donde están los números**: las cajas y los
 * volúmenes del informe salen del PLY, que viene en él. Un marco que el paquete
 * nombra y al que no hay camino es un salto que alguien da sin decir cómo, y es
 * el caso que un grafo decorativo deja pasar.
 *
 * ## Por qué no se compone la matriz aquí y ya está
 *
 * Se compone —`resolveFrame`— y esa es la única vía. Lo que no se hace es
 * **inventar la arista que falta**: un grafo sin camino no se completa con la
 * identidad «porque seguramente son el mismo marco». Esa suposición es el error,
 * no el arreglo.
 */

/** Los cuatro marcos de D11. Uno que no esté aquí no es un marco, es una errata. */
export const FRAMES = ["CAMERA", "RECONSTRUCTION", "ASSET_CANONICAL", "PRODUCTION"] as const;

export type Frame = (typeof FRAMES)[number];

export interface FrameTransform {
  from: Frame;
  to: Frame;
  /** Dieciséis números, fila a fila, aplicados como columna a la derecha (D32). */
  matrix: number[];
  reason: string;
  producer: string;
}

export interface FrameGraphIssue {
  reason: string;
  message: string;
}

/** La identidad 4×4, fila a fila. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Comprueba las aristas declaradas, una por una.
 *
 * Una arista mal formada no se corrige ni se ignora: se dice cuál y por qué. Una
 * matriz con la última fila distinta de `[0, 0, 0, 1]` no es rígida —lleva
 * proyección dentro— y componerla con otra da un resultado que no es una pose,
 * aunque los dieciséis números sigan ahí.
 */
export function auditTransforms(transforms: readonly FrameTransform[]): FrameGraphIssue[] {
  const issues: FrameGraphIssue[] = [];
  const seen = new Set<string>();

  for (const transform of transforms) {
    const where = `${transform.from} → ${transform.to}`;
    if (transform.from === transform.to) {
      issues.push({
        reason: "FRAME_TRANSFORM_SELF",
        message: `${where}: una transformación de un marco a sí mismo no registra nada`,
      });
      continue;
    }
    const key = `${transform.from}>${transform.to}`;
    if (seen.has(key)) {
      // Dos aristas entre los mismos marcos hacen que el resultado dependa de
      // cuál se coja, y nadie ha dicho cuál manda.
      issues.push({
        reason: "FRAME_TRANSFORM_DUPLICATE",
        message: `${where}: declarada dos veces, y componer depende de cuál se elija`,
      });
      continue;
    }
    seen.add(key);

    if (transform.matrix.length !== 16 || !transform.matrix.every((value) => Number.isFinite(value))) {
      issues.push({
        reason: "FRAME_TRANSFORM_MALFORMED",
        message: `${where}: la matriz no son dieciséis números finitos`,
      });
      continue;
    }
    const lastRow = transform.matrix.slice(12);
    if (lastRow.some((value, index) => value !== IDENTITY.slice(12)[index])) {
      issues.push({
        reason: "FRAME_TRANSFORM_NOT_RIGID",
        message:
          `${where}: la última fila es [${lastRow.join(", ")}] y una transformación entre marcos ` +
          "es rígida, con [0, 0, 0, 1]",
      });
    }
  }

  return issues;
}

/**
 * Compone la transformación de un marco a otro, siguiendo aristas declaradas.
 *
 * Recorre el grafo en anchura para dar **el camino más corto**: con dos caminos
 * distintos entre los mismos marcos el resultado ya sería ambiguo, y eso lo caza
 * `auditTransforms` con la arista duplicada; aquí el recorrido corto solo evita
 * componer de más.
 *
 * Las aristas se recorren **en los dos sentidos**: una transformación rígida
 * tiene inversa exacta y declarar las dos direcciones sería declarar el mismo
 * dato dos veces, con el segundo esperando a dejar de cuadrar con el primero.
 *
 * Devuelve `null` cuando no hay camino. **No devuelve la identidad**: suponer que
 * dos marcos sin arista son el mismo es el error que D11 describe, no su arreglo.
 */
export function resolveFrame(
  transforms: readonly FrameTransform[],
  from: Frame,
  to: Frame,
): number[] | null {
  if (from === to) return [...IDENTITY];

  const queue: Array<{ frame: Frame; matrix: number[] }> = [{ frame: from, matrix: [...IDENTITY] }];
  const visited = new Set<Frame>([from]);

  while (queue.length > 0) {
    const current = queue.shift() as { frame: Frame; matrix: number[] };
    for (const transform of transforms) {
      let next: Frame | null = null;
      let step: number[] | null = null;
      if (transform.from === current.frame) {
        next = transform.to;
        step = transform.matrix;
      } else if (transform.to === current.frame) {
        next = transform.from;
        step = invertRigid(transform.matrix);
      }
      if (next === null || step === null || visited.has(next)) continue;
      const composed = multiply(step, current.matrix);
      if (next === to) return composed;
      visited.add(next);
      queue.push({ frame: next, matrix: composed });
    }
  }

  return null;
}

/**
 * Inversa de una transformación rígida: `Rᵀ` y `−Rᵀt`, no una inversión general.
 *
 * La misma que hace el adaptador de COLMAP con la pose, y por el mismo motivo:
 * invertir con el método general una matriz que ya se sabe rígida mete error de
 * redondeo donde había una respuesta exacta.
 */
function invertRigid(matrix: number[]): number[] {
  const t = [matrix[3], matrix[7], matrix[11]];
  const inverse = [
    matrix[0], matrix[4], matrix[8], 0,
    matrix[1], matrix[5], matrix[9], 0,
    matrix[2], matrix[6], matrix[10], 0,
    0, 0, 0, 1,
  ];
  inverse[3] = -(inverse[0] * t[0] + inverse[1] * t[1] + inverse[2] * t[2]);
  inverse[7] = -(inverse[4] * t[0] + inverse[5] * t[1] + inverse[6] * t[2]);
  inverse[11] = -(inverse[8] * t[0] + inverse[9] * t[1] + inverse[10] * t[2]);
  return inverse;
}

/** `a · b`, las dos por filas, con los vectores multiplicando por la derecha (D32). */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + column];
      out[row * 4 + column] = sum;
    }
  }
  return out;
}
