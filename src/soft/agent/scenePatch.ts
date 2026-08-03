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

import { computeSceneAabb, type SceneAabb } from "./contactSheet";
import { matchesName, type EditResult, type Patch } from "./model";
import { assertValid, PATCH_SCHEMA } from "./schema";
import { resolveObject, type ObjectSpec, type SceneSpec } from "./sceneSpec";

function nameOf(object: ObjectSpec, index: number): string {
  return object.name ?? `objeto${index}`;
}

function asTriple(value: number | [number, number, number]): [number, number, number] {
  return typeof value === "number" ? [value, value, value] : value;
}

/** Caja en mundo de un objeto del documento, resolviéndolo tal como está escrito. */
function boundsOf(object: ObjectSpec, index: number): SceneAabb {
  const { node } = resolveObject(object, index);
  return computeSceneAabb([node]);
}

function unionOf(boxes: readonly SceneAabb[]): SceneAabb {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (box.min[axis] < min[axis]) min[axis] = box.min[axis];
      if (box.max[axis] > max[axis]) max[axis] = box.max[axis];
    }
  }
  return { min, max };
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
      case "align": {
        // Es el arreglo que propone el aviso de pieza flotante, así que tiene que
        // funcionar también aquí: si no, el `fix` del informe sería inaplicable justo
        // en el camino donde el agente está creando.
        const anchors = spec.objects
          .map((object, index) => ({ object, index }))
          .filter((entry) => matchesName(nameOf(entry.object, entry.index), edit.to));
        if (anchors.length === 0) {
          result.error = `align: ningún nombre coincide con "${edit.to}"`;
          break;
        }
        const anchor = unionOf(anchors.map((entry) => boundsOf(entry.object, entry.index)));
        for (const object of targets) {
          const box = boundsOf(object, spec.objects.indexOf(object));
          let axis = edit.axis !== undefined ? "xyz".indexOf(edit.axis) : 1;
          if (edit.axis === undefined) {
            let shortest = Infinity;
            for (let candidate = 0; candidate < 3; candidate += 1) {
              const travel = Math.min(
                Math.abs(anchor.min[candidate] - box.max[candidate]),
                Math.abs(anchor.max[candidate] - box.min[candidate]),
              );
              if (travel < shortest) {
                shortest = travel;
                axis = candidate;
              }
            }
          }
          const gap = edit.gap ?? 0;
          const below = anchor.min[axis] - box.max[axis];
          const above = anchor.max[axis] - box.min[axis];
          const delta = Math.abs(below) <= Math.abs(above) ? below - gap : above + gap;
          const position = [...(object.position ?? [0, 0, 0])] as [number, number, number];
          position[axis] += delta;
          object.position = position;
        }
        break;
      }
      case "hide":
      case "show":
        result.error =
          "hide y show son de modelos cargados de fichero; en una escena, añade la pieza o bórrala";
        break;
      case "instance":
        result.error =
          "instance comparte mallas ya resueltas y una escena es un documento: aquí la repetición se evita reutilizando la misma geometría al escribirla";
        break;
      case "setPivot":
      case "mirror":
        result.error = `${edit.op} reescribe la malla y aquí solo se edita el documento; aplícalo sobre un modelo cargado de fichero`;
        break;
      default: {
        result.error = `operación desconocida: ${(edit as { op: string }).op}`;
      }
    }

    results.push(result);
  }

  return results;
}
