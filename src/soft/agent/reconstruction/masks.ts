/**
 * Máscaras: qué píxeles de una imagen son la pieza, y qué píxeles son el mundo.
 *
 * ## El falso positivo que existen para matar
 *
 * La cobertura cuenta una muestra como vista cuando proyecta dentro de la
 * imagen, de cara y sin nada delante. Las tres condiciones son geométricas, y
 * ninguna mira la foto. Así que una muestra que proyecta **sobre el cielo** sale
 * observada: la geometría dice que la cámara apuntaba hacia ahí, y la fotografía
 * dice que ahí no había pieza que ver.
 *
 * Eso no es un caso raro en reconstrucción. Es exactamente lo que pasa en el
 * borde de la silueta, donde el mallador extiende superficie un poco más allá de
 * donde hubo evidencia, y es justo el sitio donde la reconstrucción es peor. Una
 * cobertura sin máscaras infla el número **donde más engaña**.
 *
 * ## Ausente no es vacía, y es la distinción que más importa
 *
 * Una cámara sin máscara declarada significa **no hay información**, y entonces
 * la geometría manda: se cuenta como se contaba antes. Una cámara con máscara
 * vacía significa **en esta foto no aparece la pieza**, y entonces esa cámara no
 * ve nada.
 *
 * Tratar la ausencia como vacía convertiría cada paquete sin máscaras en una
 * cobertura del cero por ciento, y tratar la vacía como ausencia tiraría la única
 * afirmación que el productor se molestó en hacer. Por eso el mapa va por
 * identidad de cámara y nunca por índice: un índice desplazado aplicaría la
 * silueta de una foto a otra sin que nada fallara.
 *
 * ## Qué no deciden
 *
 * No deciden si una muestra es correcta, solo si fue **observada**. Un píxel
 * dentro de la máscara puede estar borroso, quemado o tapado por una hoja; eso
 * es fotometría y es R8. Aquí la máscara solo recorta el campo de visión al
 * contorno que el productor afirma.
 */

import type { PackageCamera } from "./camera";

/**
 * Umbral de pertenencia. Las máscaras binarias salen en 0 y 255, y las suaves
 * —las que un segmentador entrega con borde difuminado— se cortan por la mitad.
 * Declarado y no escondido: mover esta línea mueve la silueta.
 */
export const MASK_THRESHOLD = 128;

/**
 * Tolerancia de proporción entre la máscara y su imagen, en fracción.
 *
 * Una máscara a otra resolución es normal —los segmentadores trabajan en una
 * rejilla menor— y se muestrea al vecino más próximo. Lo que no es normal es que
 * tenga **otra proporción**: eso significa que describe otro encuadre, y
 * estirarla para que quepa le cambiaría la silueta a algo que nadie afirmó.
 */
export const MASK_ASPECT_TOLERANCE = 0.01;

export interface CameraMask {
  width: number;
  height: number;
  /** Un byte por píxel, en orden de fila. Por encima del umbral, es la pieza. */
  coverage: Uint8Array;
}

/** Máscaras por identidad de cámara. Nunca por índice. */
export type MaskSet = ReadonlyMap<string, CameraMask>;

/**
 * ¿Cae este píxel dentro de la silueta?
 *
 * Sin máscara devuelve `true`: es la ausencia de información, y la decisión de
 * arriba dice que entonces manda la geometría.
 */
export function maskAllows(mask: CameraMask | undefined, x: number, y: number, camera: PackageCamera): boolean {
  if (mask === undefined) return true;
  // Vecino más próximo sobre la proporción de la imagen. `floor` y no `round`:
  // el píxel de la imagen `x` cubre el intervalo [x, x+1), y redondear lo
  // desplazaría medio píxel hacia arriba en las dos direcciones.
  const column = Math.min(mask.width - 1, Math.floor((x / camera.width) * mask.width));
  const row = Math.min(mask.height - 1, Math.floor((y / camera.height) * mask.height));
  if (column < 0 || row < 0) return false;
  return mask.coverage[row * mask.width + column] >= MASK_THRESHOLD;
}

/**
 * Comprueba que una máscara describe el encuadre de su cámara.
 *
 * Devuelve el motivo canónico cuando no, y `null` cuando sí. No lanza: quien la
 * llama decide si eso es un aviso o un rechazo, y desde aquí no se sabe.
 */
export function maskMismatch(mask: CameraMask, camera: PackageCamera): string | null {
  if (mask.width <= 0 || mask.height <= 0) return "MASCARA_SIN_TAMANO";
  if (mask.coverage.length !== mask.width * mask.height) return "MASCARA_TRUNCADA";
  const suya = mask.width / mask.height;
  const dela = camera.width / camera.height;
  if (Math.abs(suya - dela) / dela > MASK_ASPECT_TOLERANCE) return "MASCARA_DE_OTRO_ENCUADRE";
  return null;
}
