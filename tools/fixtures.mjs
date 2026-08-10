/**
 * Dónde viven los fixtures certificados, en un solo sitio.
 *
 * El dueño del dato es el editor —`public/fixtures/` de
 * `softsight-motion-editor`, mapa §3—, no este repositorio: copiarlos aquí sería
 * un segundo original del mismo dato. Cinco puertas los leen y hasta ahora cada
 * una escribía la ruta relativa por su cuenta, que son cinco originales de la
 * ruta.
 *
 * `SOFTSIGHT_FIXTURES` la sustituye, para quien tenga los dos repositorios en
 * otra disposición.
 *
 * En CI **no están**: `softsight` es público y el editor es privado, así que la
 * puerta que los necesita se declara no ejecutada en voz alta con `skipGate` y
 * sale 0. Un cero silencioso sería peor que el rojo; la línea impresa deja el
 * hueco a la vista en el registro de la ejecución.
 */

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

/** Raíz de los fixtures certificados del editor. */
export const fixturesRoot =
  process.env.SOFTSIGHT_FIXTURES ??
  resolve(projectRoot, "../../Codex/After effect ThreeJS/public/fixtures");

/** Ruta de un fixture por nombre de fichero. */
export function fixture(name) {
  return resolve(fixturesRoot, name);
}

/**
 * Sale con 0 y un motivo impreso si falta alguno de los fixtures pedidos.
 * Devuelve el control solo cuando están todos, así que quien la llama puede
 * seguir leyéndolos sin comprobar nada más.
 */
export async function requireFixtures(gate, names) {
  for (const name of names) {
    try {
      await access(fixture(name));
    } catch {
      console.log(
        `${gate}: no ejecutada — falta el fixture certificado ${name} en ${fixturesRoot} (SOFTSIGHT_FIXTURES)`,
      );
      process.exit(0);
    }
  }
}
