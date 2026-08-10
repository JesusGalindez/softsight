/**
 * Recortes del informe: `--summary` y `--fields`.
 *
 * Un agente en bucle paga 16,5 KB por turno y el 45 % es `families`, que no
 * cambia porque muevas un rotor. En veinte turnos son ~80.000 tokens, casi la
 * mitad del mismo bloque repetido veinte veces.
 *
 * Las dos funciones de aquí son **proyecciones sobre el informe ya construido**,
 * y eso no es un detalle de implementación: un resumen que recalculara algo por
 * su cuenta sería un segundo origen del mismo dato, y el día que las dos rutas
 * discrepen el agente creerá la barata. Aquí no hay aritmética, solo claves que
 * se copian o no.
 *
 * `summarize` es una opinión sobre qué necesita el agente; `projectFields` deja
 * que la declare él.
 */

import { closeEnough } from "./schema";

/**
 * Las claves del resumen: lo que cambia entre turnos y lo que decide el paso
 * siguiente. Fuera quedan `families` —el bloque más grande y prácticamente
 * constante—, `views`, `partScreenBoxes`, `objects` y `spatial` entero, del que
 * lo accionable ya está resumido en `warnings`.
 *
 * Dos de la lista **no aparecen hoy en ningún informe, y es correcto que no
 * aparezcan**: `exitCode` lo lleva el CLI en su código de salida y el puente en
 * el sobre de la respuesta, y `budget` lo declaró el propio agente en la
 * llamada. Duplicarlos dentro del informe sería un segundo original de cada uno.
 * Se quedan en la lista porque el día que un informe los traiga, el resumen los
 * pasa sin tocar nada.
 */
export const SUMMARY_KEYS: readonly string[] = [
  "contractVersion",
  "exitCode",
  "renderHash",
  "warnings",
  "warningsDelta",
  "diff",
  "budget",
];

/** Objeto plano, que es lo único por lo que baja una ruta con puntos. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * El informe con solo las claves de `SUMMARY_KEYS` que traiga. Las que no
 * estén no se inventan: un `diff` vale cuando hubo `--baseline` y no antes.
 */
export function summarize(report: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) {
    if (key in report) summary[key] = report[key];
  }
  return summary;
}

/**
 * Proyecta rutas separadas por puntos —`warnings`, `spatial.floating`— y
 * conserva la forma: el resultado usa los mismos nombres y el mismo anidamiento
 * que el informe completo, para que el consumidor no tenga que aprender otra
 * cosa.
 *
 * Una ruta que no existe es **un error de datos**, no un hueco silencioso: pedir
 * `spatial.floting` y recibir un objeto vacío es indistinguible de que no haya
 * piezas flotantes, y esa confusión se paga en la decisión siguiente. El mensaje
 * trae sugerencia con el mismo criterio que ya usa `validate` con `positon`.
 *
 * Lo que se comprueba es **este** informe, no una forma declarada: el informe no
 * tiene esquema propio —lo que publica `--schema` es un ejemplo— y las claves que
 * trae dependen de lo que se pidiera. Así que una ruta ausente puede ser una
 * errata o una clave que esta llamada no produce, y el mensaje dice cuál de las
 * dos parece.
 */
export function projectFields(
  report: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};

  for (const path of paths) {
    const steps = path.split(".");
    let source: Record<string, unknown> = report;
    let target = projected;

    for (const [index, step] of steps.entries()) {
      if (!(step in source)) {
        const suggestion = Object.keys(source).find((candidate) => closeEnough(step, candidate));
        const where = steps.slice(0, index).join(".");
        throw new Error(
          `--fields: ${path} no existe en el informe` +
            (where === "" ? "" : ` (dentro de ${where})`) +
            (suggestion !== undefined
              ? `; ¿querías decir ${[...steps.slice(0, index), suggestion].join(".")}?`
              : `; las claves disponibles ahí son ${Object.keys(source).join(", ")}`),
        );
      }
      const value = source[step];
      if (index === steps.length - 1) {
        target[step] = value;
        break;
      }
      if (!isPlainObject(value)) {
        throw new Error(
          `--fields: ${path} no existe en el informe; ` +
            `${steps.slice(0, index + 1).join(".")} no es un objeto por el que se pueda bajar`,
        );
      }
      if (!isPlainObject(target[step])) target[step] = {};
      target = target[step] as Record<string, unknown>;
      source = value;
    }
  }

  return projected;
}
