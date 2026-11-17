/**
 * Cómo se lee la salida de una puerta. Vive aparte de `run-tests.mjs` para que
 * `fixtures.test.mjs` lo pueda comprobar sin lanzar la suite entera.
 *
 * Tres marcas, y cada una dice una cosa distinta:
 *
 * ```text
 * ": ok"                    una comprobación hecha
 * ": no ejecutada —"        algo que la puerta promete y **no midió**: falta un
 *                           fixture, falta SOFTSIGHT_HEAVY. Se lee en CI
 * ": fuera de alcance —"    un límite declarado: la puerta corrió entera y dice
 *                           qué no mide, a propósito
 * ```
 *
 * Hasta 2026-11-17 las dos últimas eran la misma, y la suite acababa diciendo
 * «32 no ejecutadas» cuando treinta habían corrido enteras. Un resumen que
 * enseña lo mismo siempre se aprende a ignorar, y se ignora también el día que
 * una puerta deja de correr de verdad.
 *
 * Y una regla: **salir 0 sin una sola comprobación ni un motivo es rojo**. Una
 * puerta muda no dice qué probó, que es el hueco que D22 describe con esas
 * palabras. La que no corrió nada pero dice por qué —falta el fixture del
 * editor, que en CI no está nunca— no es muda: es «no ejecutada», y se lista.
 */

export const OK_MARK = ": ok";
export const SKIP_MARK = ": no ejecutada —";
export const SCOPE_MARK = ": fuera de alcance —";

/** `{ code, out }` de una puerta → lo que el corredor anota de ella. */
export function classifyGate({ code, out }) {
  const lines = out.split("\n");
  const checks = lines.filter((line) => line.includes(OK_MARK)).length;
  const skipped = lines.some((line) => line.includes(SKIP_MARK));
  const scoped = lines.some((line) => line.includes(SCOPE_MARK));
  const silent = code === 0 && checks === 0 && !skipped;
  return { checks, skipped, scoped, silent, failed: code !== 0 || silent };
}
