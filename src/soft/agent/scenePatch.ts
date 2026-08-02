/**
 * Parches sobre el documento de escena, no sobre la geometría resuelta.
 *
 * Un modelo cargado de fichero se parchea moviendo matrices; una escena que el
 * agente está escribiendo se parchea **editando su JSON**, y la diferencia importa:
 * lo que sale es otra vez una escena, que se guarda, se revisa, se vuelve a parchear
 * y se puede leer a ojo. Si el parche produjera geometría resuelta, el documento
 * dejaría de ser la fuente y el agente perdería lo único que sabe editar.
 *
 * Con esto, crear deja de ser reemitir el JSON entero en cada turno.
 *
 * Dos honestidades sobre la semántica:
 *
 * - **`rotate` suma grados por eje**, no compone matrices. Es lo que significa «gira
 *   quince grados más en Y» en un documento declarativo, y coincide con la
 *   composición exacta mientras se gire alrededor de un solo eje. Con dos ejes a la
 *   vez, el resultado difiere de aplicar dos rotaciones seguidas.
 * - **`hide` y `show` no existen aquí.** En un modelo ocultan una pieza que vino en
 *   el fichero; en una escena que uno escribe, la pieza o está o no está. Se
 *   rechazan con ese motivo en vez de fingir que hacen algo.
 */

import { matchesName, type EditResult, type Patch } from "./model";
import { assertValid, PATCH_SCHEMA } from "./schema";
import type { ObjectSpec, SceneSpec } from "./sceneSpec";

function nameOf(object: ObjectSpec, index: number): string {
  return object.name ?? `objeto${index}`;
}

function asTriple(value: number | [number, number, number]): [number, number, number] {
  return typeof value === "number" ? [value, value, value] : value;
}

/**
 * Aplica el parche **al documento**, que queda modificado en el sitio, y devuelve
 * qué hizo cada operación. El formato es el mismo que el de los modelos: lo que
 * escribe una persona en la interfaz lo lee el agente, y al revés.
 */
export function applyPatchToScene(spec: SceneSpec, patch: Patch): EditResult[] {
  assertValid(patch, PATCH_SCHEMA, "el parche");
  const results: EditResult[] = [];

  for (const edit of patch.edits ?? []) {
    if (edit.op === "add") {
      spec.objects.push(edit.object);
      results.push({
        op: "add",
        target: nameOf(edit.object, spec.objects.length - 1),
        matched: 1,
      });
      continue;
    }

    if (edit.target === undefined) {
      results.push({ op: edit.op, target: "", matched: 0, error: "falta target" });
      continue;
    }

    const targets = spec.objects.filter((object, index) =>
      matchesName(nameOf(object, index), edit.target as string),
    );
    const result: EditResult = { op: edit.op, target: edit.target, matched: targets.length };
    if (targets.length === 0) {
      result.error = "ningún nombre coincide con el patrón";
      results.push(result);
      continue;
    }

    switch (edit.op) {
      case "translate":
        for (const object of targets) {
          const [x, y, z] = object.position ?? [0, 0, 0];
          object.position = [x + edit.delta[0], y + edit.delta[1], z + edit.delta[2]];
        }
        break;
      case "rotate":
        for (const object of targets) {
          const [x, y, z] = object.rotation ?? [0, 0, 0];
          object.rotation = [x + edit.degrees[0], y + edit.degrees[1], z + edit.degrees[2]];
        }
        break;
      case "scale": {
        const [fx, fy, fz] = asTriple(edit.factor);
        for (const object of targets) {
          const [x, y, z] = asTriple(object.scale ?? 1);
          object.scale = [x * fx, y * fy, z * fz];
        }
        break;
      }
      case "color":
        for (const object of targets) object.color = [...edit.rgb] as [number, number, number];
        break;
      case "delete": {
        const removed = new Set(targets);
        spec.objects = spec.objects.filter((object) => !removed.has(object));
        break;
      }
      case "rename":
        if (targets.length > 1) {
          result.error = `el patrón coincide con ${targets.length} piezas; renombrar exige una sola`;
        } else {
          targets[0].name = edit.to;
        }
        break;
      case "hide":
      case "show":
        result.error =
          "hide y show son de modelos cargados de fichero; en una escena, añade la pieza o bórrala";
        break;
      default: {
        result.error = `operación desconocida: ${(edit as { op: string }).op}`;
      }
    }

    results.push(result);
  }

  return results;
}
