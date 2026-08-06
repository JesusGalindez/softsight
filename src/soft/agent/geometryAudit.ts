/**
 * Auditoría de la geometría **declarada**, no de la malla resultante.
 *
 * Hay fallos de geometría que la malla ya no delata. Si el radio de un barrido
 * supera el radio de curvatura de su recorrido, el tubo se come a sí mismo: sale
 * cerrado, con volumen firmado plausible, y la auditoría de malla no tiene de qué
 * agarrarse. Lo que sí lo dice es la aritmética del documento, antes de generar
 * nada.
 *
 * Por eso vive aquí y no en `mesh.ts`: un generador de la capa 1 devuelve una
 * malla y no sabe qué es un aviso. Y por eso avisa en vez de lanzar: una excepción
 * impediría ver la pieza, que es justo lo que hace falta para entender qué pasó.
 */

import { resolveSweepPath, type SceneSpec, type SweepSpec } from "./sceneSpec";
// Solo el tipo, así que el `import` se borra al compilar y no hay ciclo en
// ejecución. Declarar aquí un `Warning` propio sería un segundo original del
// mismo dato, y acabarían divergiendo.
import type { Warning } from "./index";

function isSweep(geometry: unknown): geometry is SweepSpec {
  return typeof geometry === "object" && geometry !== null && "sweep" in geometry;
}

/**
 * Barrido que se corta a sí mismo. Es **certeza y no candidato**: sale de
 * comparar dos números declarados, no de una heurística.
 *
 * En una estación con curvatura `k`, el centro de curvatura está a `1/k`. Un
 * perfil de radio `r ≥ 1/k` lo rebasa, así que la superficie del lado interior se
 * pliega sobre sí misma.
 */
function sweepWarnings(name: string, spec: SweepSpec): Warning[] {
  const path = resolveSweepPath(spec);
  for (const [index, station] of path.stations.entries()) {
    const curvature = path.curvature[index];
    if (curvature <= 0) continue;
    const maximum = 1 / curvature;
    if (station.radius < maximum) continue;
    return [
      {
        code: "BARRIDO_AUTOINTERSECADO",
        part: name,
        message:
          `${name}: en la estación ${index} el radio es ${station.radius.toFixed(4)} y el radio de ` +
          `curvatura del recorrido es ${maximum.toFixed(4)}, así que el barrido se corta a sí mismo. ` +
          `Cabe hasta ${maximum.toFixed(4)}; por encima, la malla sale cerrada y con volumen ` +
          "plausible pero con la superficie plegada. Es certeza, no candidato: es aritmética del " +
          "recorrido declarado.",
      },
    ];
  }
  return [];
}

/**
 * Avisos de la geometría declarada de una escena.
 *
 * Uno por pieza como mucho: repetir el mismo aviso en veinte estaciones seguidas
 * de la misma curva no le dice al agente nada que no supiera con la primera.
 */
export function auditGeometry(spec: SceneSpec): Warning[] {
  const warnings: Warning[] = [];
  for (const [index, object] of spec.objects.entries()) {
    const name = object.name ?? `objeto${index}`;
    if (isSweep(object.geometry)) warnings.push(...sweepWarnings(name, object.geometry));
  }
  return warnings;
}
