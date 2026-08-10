/**
 * Auditoría de la piel: los invariantes de un reparto de pesos, medidos sobre el
 * resultado del atado.
 *
 * Los tres primeros son **aritmética sobre lo escrito** y no dependen de qué
 * pretendía el autor, así que son certeza: un vértice que no suma uno se ve mal
 * en cualquier reproductor, y no hay lectura en la que sea correcto. El cuarto es
 * candidato, y su párrafo dice por qué.
 *
 * No hace falta que nadie declare qué piezas llevan banda: **el dato lo dice el
 * propio resultado**. Una primitiva con banda tiene vértices con dos influencias
 * de peso no nulo, y una rígida no. Pasar además el vínculo sería pasar dos veces
 * el mismo hecho, y el día que discreparan habría que decidir cuál manda.
 *
 * ## Por qué `COSTURA_ROTA` mira el vértice y no la pieza
 *
 * Dos piezas rígidas atadas a huesos distintos que comparten vértices **tienen**
 * pesos distintos: es la definición de atado rígido, no un defecto, y en un
 * ensamblaje mecánico pasa en cada junta. Avisar ahí sería repetir el error de
 * `SIMETRIA_ROTA` —ruido en todas las piezas legítimas hasta que el agente deja
 * de leer los avisos—. La banda es lo que declara la intención de soldar.
 *
 * Pero **«la pieza lleva banda» no vale como filtro**, y se comprobó midiendo: un
 * brazo de tres piezas con banda en el codo y muñeca rígida sacaba `COSTURA_ROTA`
 * en la muñeca, donde las dos piezas son rígidas y se tocan como siempre se han
 * tocado. La banda estaba en el otro extremo de la misma pieza. Lo que decide es
 * si **el vértice compartido cae dentro de una banda** —dos influencias con peso
 * no nulo—, que es la pregunta que de verdad se quería hacer.
 */

import type { SkinnedGlbPrimitive } from "./glbWriter";
import type { BindResult, SkeletonSource } from "./skinBinding";
import { restWorldMatrices } from "./skinBinding";
import type { Finding } from "./index";

/** Cuántas influencias por vértice escribe glTF en un juego de `JOINTS_0`. */
const INFLUENCES = 4;

/** La clave con la que dos vértices se consideran el mismo punto en reposo. */
const seamKey = (positions: Float32Array, vertex: number): string =>
  `${positions[vertex * 3].toFixed(6)},${positions[vertex * 3 + 1].toFixed(6)},${positions[vertex * 3 + 2].toFixed(6)}`;

/** Los pesos de un vértice, en el orden en que los lee el reproductor. */
function influencesOf(
  primitive: SkinnedGlbPrimitive,
  vertex: number,
): Array<{ joint: number; weight: number }> {
  const out: Array<{ joint: number; weight: number }> = [];
  const weights = primitive.weights;
  const joints = primitive.joints;
  if (!weights || !joints) return out;
  for (let slot = 0; slot < INFLUENCES; slot += 1) {
    const weight = weights[vertex * INFLUENCES + slot];
    if (weight === 0) continue;
    out.push({ joint: joints[vertex * INFLUENCES + slot], weight });
  }
  return out;
}

/**
 * Giro sobre el propio eje del hueso, separado del resto.
 *
 * Un cuaternión mezcla las dos cosas —lo que el hueso se dobla y lo que se
 * retuerce—, y para el aviso solo cuenta la segunda. La descomposición es la
 * clásica: se proyecta la parte vectorial sobre el eje y lo que queda, con la
 * parte escalar, es el giro sobre él.
 */
function twistDegrees(quaternion: readonly number[], axis: readonly [number, number, number]): number {
  const projection = quaternion[0] * axis[0] + quaternion[1] * axis[1] + quaternion[2] * axis[2];
  return Math.abs((2 * Math.atan2(projection, quaternion[3]) * 180) / Math.PI);
}

/**
 * Avisos de un modelo ya atado.
 *
 * `result` trae la escena y el orden de las piezas: `bound[i]` es la pieza de
 * `primitives[i]`, porque las dos listas salen del mismo recorrido del atado.
 */
export function auditSkin(result: BindResult, skeleton: SkeletonSource): Finding[] {
  const findings: Finding[] = [];
  const primitives = result.scene.meshes[0]?.primitives ?? [];
  const nameOf = (index: number): string => result.bound[index]?.part ?? `pieza${index}`;
  const jointName = (index: number): string => skeleton.nodes[index]?.name ?? `hueso${index}`;

  // Un aviso por pieza como mucho en los dos primeros: cien vértices rotos de la
  // misma malla son el mismo fallo cien veces, y el agente arregla el reparto, no
  // el vértice 47.
  for (const [index, primitive] of primitives.entries()) {
    // Una primitiva sin pesos no es un fallo del reparto: es una malla que no va
    // atada a nada, y de eso ya avisa el atado antes de llegar aquí.
    const weights = primitive.weights;
    if (!weights) continue;
    const vertices = weights.length / INFLUENCES;
    let worstSum: { vertex: number; sum: number } | null = null;
    let orphan: number | null = null;

    for (let vertex = 0; vertex < vertices; vertex += 1) {
      let sum = 0;
      for (let slot = 0; slot < INFLUENCES; slot += 1) sum += weights[vertex * INFLUENCES + slot];
      if (sum === 0) {
        if (orphan === null) orphan = vertex;
        continue;
      }
      // El umbral no es cosmético: el reparto se escribe en `Float32`, así que
      // dos pesos que suman uno exacto en doble precisión pueden sumar un ulp
      // menos aquí. Lo que este aviso caza es un reparto mal hecho, no el
      // redondeo del formato.
      if (Math.abs(sum - 1) > 1e-5 && (worstSum === null || Math.abs(sum - 1) > Math.abs(worstSum.sum - 1))) {
        worstSum = { vertex, sum };
      }
    }

    if (orphan !== null) {
      findings.push({
        code: "VERTICE_SIN_HUESO",
        part: nameOf(index),
        message:
          `${nameOf(index)}: el vértice ${orphan} no lo mueve ningún hueso —sus cuatro pesos son cero—, ` +
          "así que se queda clavado en su posición de reposo mientras el resto de la pieza se mueve. " +
          "Es certeza, no candidato: sale de sumar cuatro números escritos.",
      });
    }
    if (worstSum !== null) {
      findings.push({
        code: "PESOS_SIN_SUMAR",
        part: nameOf(index),
        message:
          `${nameOf(index)}: los pesos del vértice ${worstSum.vertex} suman ${worstSum.sum.toFixed(6)} y no 1. ` +
          "El reproductor normaliza al leer, así que la pieza no explota: se deforma con una mezcla " +
          "distinta de la declarada, que es peor de encontrar. Es certeza, no candidato.",
      });
    }
  }

  // La costura, solo donde el vértice compartido cae dentro de una banda. Ver la
  // cabecera: el filtro por pieza daba falsos defectos en el otro extremo de una
  // pieza con banda.
  const banded = primitives.map((primitive) => {
    const weights = primitive.weights;
    if (!weights) return false;
    for (let vertex = 0; vertex < weights.length / INFLUENCES; vertex += 1) {
      if (weights[vertex * INFLUENCES + 1] !== 0) return true;
    }
    return false;
  });

  if (banded.some(Boolean)) {
    const seen = new Map<string, { primitive: number; vertex: number }>();
    const reported = new Set<string>();
    for (const [index, primitive] of primitives.entries()) {
      const vertices = primitive.positions.length / 3;
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const key = seamKey(primitive.positions, vertex);
        const twin = seen.get(key);
        if (twin === undefined) {
          seen.set(key, { primitive: index, vertex });
          continue;
        }
        if (twin.primitive === index) continue;

        const here = influencesOf(primitive, vertex);
        const there = influencesOf(primitives[twin.primitive], twin.vertex);
        // Ninguno de los dos está repartido: es una costura rígida, y esas se
        // abren por definición. No hay nada declarado que incumplir.
        if (here.length < 2 && there.length < 2) continue;
        const same =
          here.length === there.length &&
          here.every((influence) =>
            there.some(
              (other) =>
                other.joint === influence.joint && Math.abs(other.weight - influence.weight) <= 1e-5,
            ),
          );
        if (same) continue;

        const pair = [nameOf(twin.primitive), nameOf(index)].sort().join("~");
        if (reported.has(pair)) continue;
        reported.add(pair);
        const describe = (list: Array<{ joint: number; weight: number }>): string =>
          list.map((influence) => `${jointName(influence.joint)} ${influence.weight.toFixed(3)}`).join(" + ");
        findings.push({
          code: "COSTURA_ROTA",
          part: nameOf(index),
          message:
            `${nameOf(twin.primitive)} y ${nameOf(index)} comparten un vértice en reposo y lo reparten ` +
            `distinto —${describe(there)} contra ${describe(here)}—, así que la costura se abrirá al ` +
            "mover el hueso. Se declaró una banda para soldarla: o no la cubre por los dos lados, o las " +
            "dos no están centradas en el mismo sitio. Es certeza, no candidato.",
        });
      }
    }

    // El precio de la mezcla lineal, cuando la banda cae donde más se nota.
    const worlds = restWorldMatrices(skeleton);
    const positionOf = (index: number): [number, number, number] => [
      worlds[index][3],
      worlds[index][7],
      worlds[index][11],
    ];
    const twisted = new Set<string>();
    for (const [index, primitive] of primitives.entries()) {
      if (!banded[index]) continue;
      const first = influencesOf(primitive, 0);
      if (first.length < 2) continue;
      const [a, b] = [first[0].joint, first[1].joint];
      const from = positionOf(a);
      const to = positionOf(b);
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (length === 0) continue;
      const axis: [number, number, number] = [
        (to[0] - from[0]) / length,
        (to[1] - from[1]) / length,
        (to[2] - from[2]) / length,
      ];

      for (const animation of skeleton.animations) {
        for (const channel of animation.channels) {
          if (channel.path !== "rotation") continue;
          if (channel.node !== a && channel.node !== b) continue;
          const values = animation.samplers[channel.sampler]?.values;
          if (!values) continue;
          let worst = 0;
          for (let key = 0; key < values.length / 4; key += 1) {
            worst = Math.max(
              worst,
              twistDegrees(
                [values[key * 4], values[key * 4 + 1], values[key * 4 + 2], values[key * 4 + 3]],
                axis,
              ),
            );
          }
          if (worst <= 90) continue;
          const clip = animation.name ?? "el clip";
          const tag = `${nameOf(index)}|${clip}`;
          if (twisted.has(tag)) continue;
          twisted.add(tag);
          findings.push({
            code: "TORSION_APLASTADA",
            part: nameOf(index),
            message:
              `${nameOf(index)}: en '${clip}', '${jointName(channel.node)}' gira ${worst.toFixed(0)}° ` +
              "sobre su propio eje, y la banda reparte justo ahí. La mezcla lineal de glTF interpola " +
              "las posiciones, no las rotaciones, así que la piel se estrangula en el centro de la banda " +
              "—el «envoltorio de caramelo»—. Es del método, no del fichero: no se arregla escribiendo " +
              "otra cosa. Candidato, no certeza: con una banda ancha o una pieza fina puede no verse.",
          });
        }
      }
    }
  }

  return findings;
}
