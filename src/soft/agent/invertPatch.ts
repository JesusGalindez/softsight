/**
 * El parche que deshace otro parche.
 *
 * Es lo que convierte la exploración en barata: probar, mirar y volver, sin recargar
 * el fichero ni rehacer el análisis. Y como el inverso es **otro parche**, se guarda,
 * se revisa a ojo y se aplica en otra máquina, igual que el original.
 *
 * Se calcula **antes** de aplicar nada, porque necesita el estado previo: el color que
 * tenía cada pieza, la geometría de la que se va a borrar, el nombre que se va a
 * cambiar. Después ya no está.
 *
 * Dos casos merecen explicación:
 *
 * - **Girar no se deshace negando los tres ángulos.** La rotación se compone como
 *   `Y·X·Z`, y la inversa de ese producto es `Z⁻¹·X⁻¹·Y⁻¹`: los mismos ángulos
 *   cambiados de signo pero **en orden contrario**, que en este formato son tres
 *   operaciones y no una. Negar los tres a la vez solo acierta cuando se giró
 *   alrededor de un único eje.
 * - **Borrar se deshace añadiendo**, con la malla en local y la matriz exacta. Por eso
 *   `add` admite `matrix`: descomponerla en traslación, giro y escala perdería el
 *   cizallamiento.
 */

import { matchesPattern, type Edit, type Model, type ModelPart, type Patch } from "./model";

function reciprocal(value: number): number {
  return value === 0 ? 0 : 1 / value;
}

/** La pieza tal cual, como operación de alta. */
function addFor(part: ModelPart): Edit {
  return {
    op: "add",
    object: {
      name: part.name,
      geometry: {
        positions: [...part.mesh.positions],
        indices: [...part.mesh.indices],
        normals: [...part.mesh.normals],
        uvs: [...part.mesh.uvs],
      },
      matrix: [...part.matrix],
      ...(part.baseColor !== null ? { color: [...part.baseColor] as [number, number, number] } : {}),
    },
  };
}

/**
 * Inverso de un parche sobre el modelo **tal como está ahora**. Las operaciones
 * salen en orden contrario al original, que es como se deshace una pila.
 */
export function invertPatch(model: Model, patch: Patch): Patch {
  const edits: Edit[] = [];
  // Se simula el efecto sobre los nombres para que cada inverso mire el estado que
  // encontrará al aplicarse, no el inicial.
  const removed = new Set<ModelPart>();
  const renamed = new Map<ModelPart, string>();
  const added: string[] = [];

  const currentName = (part: ModelPart): string => renamed.get(part) ?? part.name;
  const targetsOf = (pattern: string): ModelPart[] =>
    model.parts.filter((part) => !removed.has(part) && matchesPattern(part, pattern));

  for (const edit of patch.edits ?? []) {
    if (edit.op === "add") {
      const name = edit.object.name;
      if (name !== undefined) added.push(name);
      edits.push({ op: "delete", target: name ?? `objeto${model.parts.length + added.length - 1}` });
      continue;
    }
    if (edit.target === undefined) continue;
    const targets = targetsOf(edit.target);
    if (targets.length === 0) continue;

    switch (edit.op) {
      case "translate":
        edits.push({
          op: "translate",
          target: edit.target,
          delta: [-edit.delta[0], -edit.delta[1], -edit.delta[2]],
        });
        break;
      case "rotate": {
        const [rx, ry, rz] = edit.degrees;
        // La inversa de `Y·X·Z` es `Z⁻¹·X⁻¹·Y⁻¹`, y como cada operación multiplica por
        // la izquierda, hay que **aplicarlas** en el orden Y, X, Z. Pero al final de
        // esta función la lista entera se invierte —así se deshace una pila—, así que
        // aquí se apilan al revés para que salgan en ese orden. Emitirlas en el orden
        // «natural» las dejaba aplicándose como `Y⁻¹·X⁻¹·Z⁻¹`, que no es la inversa
        // salvo si se giró alrededor de un solo eje: el caso de un eje volvía exacto y
        // el de tres no, que fue justo lo que apareció al medirlo.
        if (rz !== 0) edits.push({ op: "rotate", target: edit.target, degrees: [0, 0, -rz] });
        if (rx !== 0) edits.push({ op: "rotate", target: edit.target, degrees: [-rx, 0, 0] });
        if (ry !== 0) edits.push({ op: "rotate", target: edit.target, degrees: [0, -ry, 0] });
        break;
      }
      case "scale": {
        const factor = edit.factor;
        edits.push({
          op: "scale",
          target: edit.target,
          factor:
            typeof factor === "number"
              ? reciprocal(factor)
              : ([reciprocal(factor[0]), reciprocal(factor[1]), reciprocal(factor[2])] as [
                  number,
                  number,
                  number,
                ]),
        });
        break;
      }
      case "color":
        // Uno por pieza: dos piezas del mismo patrón podían tener colores distintos.
        for (const part of targets) {
          edits.push({
            op: "color",
            target: currentName(part),
            rgb: part.baseColor !== null ? ([...part.baseColor] as [number, number, number]) : [0.78, 0.78, 0.8],
          });
        }
        break;
      case "hide":
        for (const part of targets) {
          if (part.visible) edits.push({ op: "show", target: currentName(part) });
        }
        break;
      case "show":
        for (const part of targets) {
          if (!part.visible) edits.push({ op: "hide", target: currentName(part) });
        }
        break;
      case "delete":
        for (const part of targets) {
          edits.push(addFor(part));
          removed.add(part);
        }
        break;
      case "rename":
        if (targets.length === 1) {
          edits.push({ op: "rename", target: edit.to, to: currentName(targets[0]) });
          renamed.set(targets[0], edit.to);
        }
        break;
      default:
        break;
    }
  }

  return { edits: edits.reverse() };
}
