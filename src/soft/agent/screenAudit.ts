/**
 * Auditoría del movimiento en 2D: lo que de verdad se ve.
 *
 * `animationAudit.ts` audita el movimiento **en el espacio**: qué piezas se
 * cruzan, cuáles atraviesan el suelo. Son hechos sobre el mundo, y son los
 * correctos para preguntar «¿está bien montado?».
 *
 * No son los correctos para preguntar **«¿se ve?»**. Un rotor puede girar
 * perfectamente en el mundo y salirse del encuadre en el fotograma 30; una pieza
 * puede empezar a moverse cuando todavía está fuera de cuadro, y entonces el
 * espectador no ve la entrada, ve algo que ya venía en marcha; y dos piezas
 * pueden pasarse veinte fotogramas una delante de la otra sin cruzarse en el
 * espacio ni un milímetro. Ninguna de las tres las caza una auditoría 3D, y las
 * tres arruinan una pieza.
 *
 * ## Cómo se mide, y por qué no rasterizando
 *
 * Igual que el informe de puesta en escena del editor mide la caja del texto por
 * aritmética y no pintándolo: se proyectan las ocho esquinas de la caja de cada
 * pieza con la cámara del pliego y sale su caja en píxeles. Es exacto, es
 * determinista y cuesta lo que cuesta una multiplicación de matrices, mientras
 * que rasterizar cada fotograma para volver a leerlo costaría el render entero
 * por fotograma.
 *
 * El precio de esa decisión está declarado y es el mismo que paga la auditoría
 * espacial: **es la caja, no la silueta**. Dos cajas que se solapan en pantalla
 * son un candidato a oclusión, no una certeza; una hélice casi de canto tiene una
 * caja mucho más grande que lo que pinta. Por eso los tres avisos que salen de
 * aquí son `candidato` en el registro, y sus mensajes lo dicen.
 *
 * ## Solo lo que el movimiento rompió
 *
 * La misma regla que la auditoría 3D, y por el mismo motivo: en un muñeco, el
 * torso tapa a la cadera y la cabeza tapa al torso **en reposo**, y lo seguirán
 * haciendo en los sesenta fotogramas. Avisar de eso es ruido que tapa la señal.
 * Así que las oclusiones que ya existen en reposo no cuentan, y una pieza que ya
 * estaba fuera del cuadro en reposo no «se sale»: si acaso, entra.
 *
 * ## El encuadre
 *
 * Se audita contra **el encuadre del fotograma cero**, que es el que el pliego
 * enseña y el que el espectador tiene delante. Encuadrar con la caja de todo el
 * clip sería hacer que nada se saliera nunca por construcción, y la auditoría no
 * diría nada.
 */

import { computeSceneAabb, projectAabb } from "./contactSheet";
import type { SceneAabb } from "./contactSheet";
import type { Camera } from "../renderer";
import type { PlacedPart } from "./spatialAudit";
// Solo el tipo: se borra al compilar, así que no hay ciclo en ejecución. Es el
// mismo apaño que usa `animationAudit.ts` por el mismo motivo.
import type { Finding } from "./index";

export interface ScreenAuditOptions {
  /** Lado del tile en píxeles con el que se mide. El del pliego por defecto. */
  tileSize?: number;
  /**
   * Fotogramas seguidos que dos piezas tienen que taparse para que se avise.
   *
   * Un cruce de un fotograma es un adelantamiento y no le importa a nadie; lo
   * que arruina una pieza es que algo se quede tapado. Doce a 30 fps son cuatro
   * décimas, que es más o menos donde una oclusión deja de leerse como paso y
   * empieza a leerse como estorbo. Es un umbral declarado, no una medida.
   */
  occlusionFrames?: number;
  /**
   * Fracción de la caja menor que tiene que quedar tapada para contarlo.
   * Rozarse por dos píxeles no es taparse.
   */
  occlusionOverlap?: number;
}

/** Una pieza que se sale del encuadre en algún fotograma. */
export interface OffFrameEvent {
  clip: string;
  part: string;
  /** El primer fotograma en el que se sale. */
  frame: number;
  /** Píxeles que sobresalen del cuadro en el peor fotograma. */
  overflow: number;
  /** El peor fotograma, que puede no ser el primero. */
  worstFrame: number;
  /** Si llega a salirse **entera** en algún fotograma. */
  fullyOut: boolean;
}

/** Una pieza que arranca su movimiento estando fuera del cuadro. */
export interface BlindEntrance {
  clip: string;
  part: string;
  /** Fotograma en el que empieza a moverse. */
  frame: number;
  /** Fotograma en el que termina de entrar en el cuadro, o `null` si nunca entra. */
  visibleFrame: number | null;
}

/** Dos piezas que se tapan durante un tramo seguido de fotogramas. */
export interface Occlusion {
  clip: string;
  /** La de delante primero: es la que tapa. */
  parts: [string, string];
  from: number;
  to: number;
  frames: number;
  /** Fracción máxima de la caja tapada que queda cubierta. */
  overlap: number;
}

export interface ScreenAudit {
  /** El encuadre contra el que se midió: la vista y el tamaño del tile. */
  view: string;
  tileSize: number;
  offFrame: OffFrameEvent[];
  blindEntrances: BlindEntrance[];
  occlusions: Occlusion[];
  /** Umbrales declarados, para que el informe se pueda leer sin el código al lado. */
  occlusionFrames: number;
  occlusionOverlap: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  depth: number;
}

interface Track {
  /** Caja en reposo: la referencia para saber si la pieza se movió. */
  rest: Box | null;
  /** Si en reposo cabía entera en el cuadro. */
  restInside: boolean;
  movedFrame: number | null;
  insideFrame: number | null;
  offFirstFrame: number | null;
  offWorstFrame: number;
  offWorst: number;
  fullyOut: boolean;
}

/** Cuánto sobresale una caja del cuadro, en píxeles; cero si cabe entera. */
function overflowOf(box: Box, tileSize: number): number {
  return Math.max(0, -box.minX, -box.minY, box.maxX - tileSize, box.maxY - tileSize);
}

/** Si la caja no toca el cuadro en absoluto. */
function outside(box: Box, tileSize: number): boolean {
  return box.maxX <= 0 || box.maxY <= 0 || box.minX >= tileSize || box.minY >= tileSize;
}

/** Fracción del área de la caja menor que cubre el solape de las dos. */
function overlapFraction(a: Box, b: Box): number {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (width <= 0 || height <= 0) return 0;
  const areaA = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxY - a.minY);
  const areaB = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
  const smaller = Math.min(areaA, areaB);
  if (smaller <= 0) return 0;
  return (width * height) / smaller;
}

/** Si dos cajas están en el mismo sitio: se usa para saber si una pieza se movió. */
function samePlace(a: Box, b: Box): boolean {
  return (
    Math.abs(a.minX - b.minX) < 0.5 &&
    Math.abs(a.minY - b.minY) < 0.5 &&
    Math.abs(a.maxX - b.maxX) < 0.5 &&
    Math.abs(a.maxY - b.maxY) < 0.5
  );
}

/**
 * El recolector: se le van dando los fotogramas ya colocados y al final da los
 * tres hallazgos.
 *
 * Es un recolector y no una función que recorra el clip por su cuenta porque
 * `auditAnimation` **ya** recorre los fotogramas y coloca las piezas: hacerlo dos
 * veces costaría el doble para llegar al mismo sitio. La aritmética de aquí es
 * solo 2D; de mover el esqueleto sigue encargándose el evaluador certificado.
 */
export function createScreenAudit(
  camera: Camera,
  viewName: string,
  options: ScreenAuditOptions = {},
) {
  const tileSize = options.tileSize ?? 320;
  const occlusionFrames = options.occlusionFrames ?? 12;
  const occlusionOverlap = options.occlusionOverlap ?? 0.25;

  const tracks = new Map<string, Track>();
  /** Pares que ya se tapaban en reposo: no son cosa del movimiento. */
  const restPairs = new Set<string>();
  const running = new Map<string, { parts: [string, string]; from: number; to: number; overlap: number }>();
  const offFrame: OffFrameEvent[] = [];
  const blindEntrances: BlindEntrance[] = [];
  const occlusions: Occlusion[] = [];
  let clipName = "";

  const boxOf = (part: PlacedPart): Box | null => {
    const aabb: SceneAabb = computeSceneAabb([{ mesh: part.mesh, model: part.model }]);
    return projectAabb(aabb, camera, tileSize);
  };

  /** Cierra los tramos de oclusión que ya no siguen y apunta los que valen. */
  const closeRuns = (alive: Set<string>): void => {
    for (const [key, run] of [...running]) {
      if (alive.has(key)) continue;
      running.delete(key);
      const frames = run.to - run.from + 1;
      if (frames < occlusionFrames) continue;
      occlusions.push({
        clip: clipName,
        parts: run.parts,
        from: run.from,
        to: run.to,
        frames,
        overlap: Number(run.overlap.toFixed(4)),
      });
    }
  };

  /** Clave de un par, en el orden que sea: en reposo no hay delante ni detrás. */
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  return {
    /**
     * El reposo, antes de cualquier clip. De aquí salen las dos referencias: qué
     * pares ya se tapaban y dónde estaba cada pieza, que es contra lo que se
     * decide si se movió.
     */
    observeRest(placed: readonly PlacedPart[]): void {
      const boxes: Array<{ name: string; box: Box }> = [];
      for (const part of placed) {
        const box = boxOf(part);
        if (box === null) continue;
        boxes.push({ name: part.name, box });
        tracks.set(part.name, {
          rest: box,
          restInside: overflowOf(box, tileSize) === 0,
          movedFrame: null,
          insideFrame: null,
          offFirstFrame: null,
          offWorstFrame: 0,
          offWorst: 0,
          fullyOut: false,
        });
      }
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          if (overlapFraction(boxes[a].box, boxes[b].box) < occlusionOverlap) continue;
          restPairs.add(pairKey(boxes[a].name, boxes[b].name));
        }
      }
    },

    /** Empieza un clip: los tramos no se arrastran de uno a otro. */
    startClip(name: string): void {
      closeRuns(new Set());
      for (const track of tracks.values()) {
        track.movedFrame = null;
        track.insideFrame = null;
        track.offFirstFrame = null;
        track.offWorst = 0;
        track.fullyOut = false;
      }
      clipName = name;
    },

    observe(frame: number, placed: readonly PlacedPart[]): void {
      const boxes: Array<{ name: string; box: Box }> = [];
      for (const part of placed) {
        const box = boxOf(part);
        if (box === null) continue; // cruza el plano de la cámara: no hay respuesta
        boxes.push({ name: part.name, box });

        let track = tracks.get(part.name);
        if (track === undefined) {
          // Una pieza que no estaba en reposo: se toma su primera aparición como
          // referencia, que es lo único honesto que hay.
          track = {
            rest: box,
            restInside: overflowOf(box, tileSize) === 0,
            movedFrame: null,
            insideFrame: null,
            offFirstFrame: null,
            offWorstFrame: frame,
            offWorst: 0,
            fullyOut: false,
          };
          tracks.set(part.name, track);
        }
        if (track.movedFrame === null && track.rest !== null && !samePlace(track.rest, box)) {
          track.movedFrame = frame;
        }
        if (track.insideFrame === null && !outside(box, tileSize)) track.insideFrame = frame;

        // Una pieza que ya estaba fuera en reposo no se está saliendo: el aviso
        // que le corresponde es el de entrada, no el de salida.
        const overflow = track.restInside ? overflowOf(box, tileSize) : 0;
        if (overflow > 0) {
          if (track.offFirstFrame === null) track.offFirstFrame = frame;
          if (overflow > track.offWorst) {
            track.offWorst = overflow;
            track.offWorstFrame = frame;
          }
          if (outside(box, tileSize)) track.fullyOut = true;
        }
      }

      // Oclusiones: pares cuyas cajas se solapan lo bastante, con la de delante
      // primero. El coste es cuadrático en piezas visibles, igual que la
      // auditoría espacial, y por eso el presupuesto de fotogramas existe.
      const alive = new Set<string>();
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const overlap = overlapFraction(boxes[a].box, boxes[b].box);
          if (overlap < occlusionOverlap) continue;
          // Lo que ya se tapaba en reposo es el modelo, no la animación.
          if (restPairs.has(pairKey(boxes[a].name, boxes[b].name))) continue;
          const front = boxes[a].box.depth <= boxes[b].box.depth ? boxes[a] : boxes[b];
          const back = front === boxes[a] ? boxes[b] : boxes[a];
          const key = `${front.name}|${back.name}`;
          alive.add(key);
          const run = running.get(key);
          if (run === undefined || run.to !== frame - 1) {
            if (run !== undefined) {
              // El tramo anterior se cortó: se cierra antes de abrir el nuevo.
              running.delete(key);
              const frames = run.to - run.from + 1;
              if (frames >= occlusionFrames) {
                occlusions.push({
                  clip: clipName,
                  parts: run.parts,
                  from: run.from,
                  to: run.to,
                  frames,
                  overlap: Number(run.overlap.toFixed(4)),
                });
              }
            }
            running.set(key, { parts: [front.name, back.name], from: frame, to: frame, overlap });
          } else {
            run.to = frame;
            if (overlap > run.overlap) run.overlap = overlap;
          }
        }
      }
      closeRuns(alive);
    },

    finish(): ScreenAudit {
      closeRuns(new Set());
      for (const [name, track] of tracks) {
        if (track.offFirstFrame !== null) {
          offFrame.push({
            clip: clipName,
            part: name,
            frame: track.offFirstFrame,
            overflow: Math.round(track.offWorst),
            worstFrame: track.offWorstFrame,
            fullyOut: track.fullyOut,
          });
        }
        // Entrada a ciegas: la pieza arranca su movimiento estando entera fuera
        // del cuadro. No es que aparezca de la nada —eso lo vería cualquiera—;
        // es que el espectador se pierde el arranque y ve algo que ya venía.
        if (track.movedFrame === null) continue;
        if (track.insideFrame === null || track.insideFrame > track.movedFrame) {
          blindEntrances.push({
            clip: clipName,
            part: name,
            frame: track.movedFrame,
            visibleFrame: track.insideFrame,
          });
        }
      }
      return {
        view: viewName,
        tileSize,
        offFrame,
        blindEntrances,
        occlusions,
        occlusionFrames,
        occlusionOverlap,
      };
    },
  };
}

/** Los avisos que salen de la auditoría 2D, con su cifra dentro. */
export function screenWarnings(audit: ScreenAudit): Finding[] {
  const warnings: Finding[] = [];

  for (const event of audit.offFrame) {
    warnings.push({
      code: "SALE_DE_CUADRO",
      part: event.part,
      message:
        `${event.part}: en '${event.clip}' se sale del encuadre a partir del fotograma ${event.frame}, ` +
        `${event.overflow} px por fuera en el peor (${event.worstFrame}) sobre un tile de ${audit.tileSize}` +
        (event.fullyOut ? ", y llega a salirse entera." : ".") +
        " Medido sobre la vista '" + audit.view + "' con el encuadre del fotograma cero, que es el que " +
        "enseña el pliego. Candidato, no certeza: es la caja de la pieza, no su silueta.",
    });
  }

  for (const entrance of audit.blindEntrances) {
    warnings.push({
      code: "ENTRADA_A_CIEGAS",
      part: entrance.part,
      message:
        `${entrance.part}: en '${entrance.clip}' empieza a moverse en el fotograma ${entrance.frame} ` +
        (entrance.visibleFrame === null
          ? "y no entra en el cuadro en todo el clip"
          : `y no entra en el cuadro hasta el ${entrance.visibleFrame}`) +
        ", así que el arranque no se ve: lo que llega ya viene en marcha. Candidato, no certeza: " +
        "puede ser deliberado.",
    });
  }

  for (const occlusion of audit.occlusions) {
    warnings.push({
      code: "OCLUSION_PROLONGADA",
      part: occlusion.parts[1],
      message:
        `${occlusion.parts[0]} tapa a ${occlusion.parts[1]} en '${occlusion.clip}' desde el fotograma ` +
        `${occlusion.from} hasta el ${occlusion.to} —${occlusion.frames} seguidos, por encima de los ` +
        `${audit.occlusionFrames} declarados— cubriendo hasta el ${(occlusion.overlap * 100).toFixed(0)} % ` +
        "de la caja tapada. Candidato, no certeza: son las cajas y no las siluetas, así que dos piezas " +
        "delgadas pueden solaparse de caja sin taparse de verdad.",
    });
  }

  return warnings;
}
