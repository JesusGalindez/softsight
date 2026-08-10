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

import {
  polygonOf,
  resolveProfiles,
  resolveSweepPath,
  type LoftSpec,
  type SceneSpec,
  type SweepSpec,
} from "./sceneSpec";
// Solo el tipo, así que el `import` se borra al compilar y no hay ciclo en
// ejecución. Declarar aquí un `Warning` propio sería un segundo original del
// mismo dato, y acabarían divergiendo.
import type { Finding } from "./index";

function isSweep(geometry: unknown): geometry is SweepSpec {
  return typeof geometry === "object" && geometry !== null && "sweep" in geometry;
}

function isLoft(geometry: unknown): geometry is LoftSpec {
  return typeof geometry === "object" && geometry !== null && "loft" in geometry;
}

function isExtrude(geometry: unknown): geometry is { extrude: number[] | string } {
  return typeof geometry === "object" && geometry !== null && "extrude" in geometry;
}

/**
 * Cruce **propio** de dos segmentos: los cuatro puntos estrictamente a un lado y
 * al otro.
 *
 * Estricto a propósito. Admitir el caso colineal o el contacto en un extremo
 * convertiría en aviso lo que produce cualquier generador con puntos casi
 * alineados —el borde de fuga de un perfil aerodinámico, sin ir más lejos—, y un
 * aviso que salta sobre la geometría del propio repositorio no lo mira nadie.
 */
function segmentsCross(
  polygon: readonly number[],
  first: number,
  second: number,
  count: number,
): boolean {
  const at = (index: number, axis: number): number => polygon[(index % count) * 2 + axis];
  const side = (
    ax: number, az: number, bx: number, bz: number, px: number, pz: number,
  ): number => (bx - ax) * (pz - az) - (bz - az) * (px - ax);

  const ax = at(first, 0);
  const az = at(first, 1);
  const bx = at(first + 1, 0);
  const bz = at(first + 1, 1);
  const cx = at(second, 0);
  const cz = at(second, 1);
  const dx = at(second + 1, 0);
  const dz = at(second + 1, 1);

  const d1 = side(cx, cz, dx, dz, ax, az);
  const d2 = side(cx, cz, dx, dz, bx, bz);
  const d3 = side(ax, az, bx, bz, cx, cz);
  const d4 = side(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Polígono que se cruza consigo mismo. **Certeza**: es una intersección de
 * segmentos, no una heurística.
 *
 * Importa más de lo que parece porque `earClip` supone polígono simple: con uno
 * que se cruza produce tapas basura **sin decir nada**, y el volumen firmado sale
 * plausible. Es O(n²) sobre decenas de puntos, o sea gratis.
 */
function selfIntersection(polygon: readonly number[]): [number, number] | null {
  const count = polygon.length / 2;
  for (let first = 0; first < count; first += 1) {
    // Los vecinos comparten un extremo y no son un cruce; el último y el primero
    // también se tocan, al cerrar el polígono.
    for (let second = first + 2; second < count; second += 1) {
      if (first === 0 && second === count - 1) continue;
      if (segmentsCross(polygon, first, second, count)) return [first, second];
    }
  }
  return null;
}

/** Ángulo del vector que va del centroide al primer punto del polígono. */
function startAngle(polygon: readonly number[]): number {
  const count = polygon.length / 2;
  let centerX = 0;
  let centerZ = 0;
  for (let point = 0; point < count; point += 1) {
    centerX += polygon[point * 2];
    centerZ += polygon[point * 2 + 1];
  }
  return Math.atan2(polygon[1] - centerZ / count, polygon[0] - centerX / count);
}

/** Un cuarto de vuelta. Va declarado en el mensaje, que es lo que lo hace discutible. */
const CORRESPONDENCE_LIMIT = Math.PI / 2;

/**
 * Secciones de un *loft* cuyo emparejamiento retuerce la superficie.
 *
 * El *loft* cose remuestreando cada sección por longitud de arco **desde su
 * vértice cero**. Coser un círculo —que empieza en el ángulo 0— con un perfil
 * aerodinámico —que empieza en el borde de ataque— empareja dos sitios que no se
 * corresponden, y la superficie sale girada sin que nadie lo haya pedido.
 *
 * **Candidato, no certeza**: hay piezas donde ese giro es deliberado.
 *
 * Y no avisa de secciones escritas en sentidos opuestos, aunque el plan lo
 * sugiriera: el generador las normaliza a propósito y hay una prueba que exige que
 * den la misma malla. Avisar de lo que la herramienta ya arregla sola es ruido.
 */
function loftWarnings(
  name: string,
  spec: LoftSpec,
  profiles: ReadonlyMap<string, number[]>,
): Finding[] {
  const sections = spec.loft ?? [];
  for (let index = 1; index < sections.length; index += 1) {
    const before = startAngle(polygonOf(sections[index - 1].profile, profiles));
    const here = startAngle(polygonOf(sections[index].profile, profiles));
    let turn = here - before;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    if (Math.abs(turn) <= CORRESPONDENCE_LIMIT) continue;
    return [
      {
        code: "SECCIONES_INCOMPATIBLES",
        part: name,
        message:
          `${name}: entre las secciones ${index - 1} y ${index}, el emparejamiento gira ` +
          `${((Math.abs(turn) * 180) / Math.PI).toFixed(0)}°, por encima del cuarto de vuelta que ` +
          "se admite. El loft empareja los perfiles desde el vértice cero de cada uno, así que dos " +
          "perfiles que empiezan en sitios distintos —un círculo en el ángulo 0 y un ala en el " +
          "borde de ataque— cosen la superficie girada. Candidato, no certeza: el giro puede ser " +
          "deliberado.",
      },
    ];
  }
  return [];
}

/** Todos los polígonos que una pieza declara, en el orden en que los declara. */
function polygonsOf(
  geometry: unknown,
  profiles: ReadonlyMap<string, number[]>,
): Array<{ polygon: number[]; where: string }> {
  if (isExtrude(geometry)) {
    return [{ polygon: polygonOf(geometry.extrude, profiles), where: "el polígono de la extrusión" }];
  }
  if (isSweep(geometry)) {
    return [{ polygon: polygonOf(geometry.sweep, profiles), where: "el perfil del barrido" }];
  }
  if (isLoft(geometry)) {
    return (geometry.loft ?? []).map((section, index) => ({
      polygon: polygonOf(section.profile, profiles),
      where: `el perfil de la sección ${index}`,
    }));
  }
  return [];
}

/**
 * Barrido que se corta a sí mismo. Es **certeza y no candidato**: sale de
 * comparar dos números declarados, no de una heurística.
 *
 * En una estación con curvatura `k`, el centro de curvatura está a `1/k`. Un
 * perfil de radio `r ≥ 1/k` lo rebasa, así que la superficie del lado interior se
 * pliega sobre sí misma.
 */
function sweepWarnings(name: string, spec: SweepSpec): Finding[] {
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
export function auditGeometry(spec: SceneSpec): Finding[] {
  const warnings: Finding[] = [];
  const profiles = resolveProfiles(spec.profiles);
  for (const [index, object] of spec.objects.entries()) {
    const name = object.name ?? `objeto${index}`;

    for (const { polygon, where } of polygonsOf(object.geometry, profiles)) {
      const crossing = selfIntersection(polygon);
      if (crossing === null) continue;
      warnings.push({
        code: "PERFIL_AUTOINTERSECADO",
        part: name,
        message:
          `${name}: en ${where}, los lados ${crossing[0]} y ${crossing[1]} se cruzan. El recorte de ` +
          "orejas supone un polígono simple, así que con este produce tapas basura y el volumen " +
          "firmado sale plausible sin serlo. Es certeza, no candidato: es una intersección de " +
          "segmentos.",
      });
      break; // Uno por pieza: el segundo cruce no le dice nada nuevo al agente.
    }

    if (isSweep(object.geometry)) warnings.push(...sweepWarnings(name, object.geometry));
    if (isLoft(object.geometry)) warnings.push(...loftWarnings(name, object.geometry, profiles));
  }
  return warnings;
}
