/**
 * Hechos medidos sobre una puesta en escena ya montada.
 *
 * La auditoría del guion mide el texto **antes** de que exista imagen: cuántos
 * caracteres caben en el tiempo de la escena, si falta un rol, si dos escenas
 * seguidas hacen el mismo papel. Esto mide lo otro, lo que solo se sabe cuando
 * alguien ha puesto las capas en el cuadro: si la escena enseña algo, si el
 * texto cabe dentro, y si se lee sobre lo que tiene detrás.
 *
 * Las tres comprobaciones estaban declaradas como imposibles en `storyAudit`
 * porque necesitaban datos del editor. Ya no lo son: el editor sabe medirlas y
 * las manda en un informe. **Aquí no se rasteriza nada** — la caja de un texto
 * sale de la aritmética de proyección, y el color del fondo lo mide quien tiene
 * el frame delante.
 *
 * Sigue sin haber heurísticas, por el mismo motivo que en el guion: un aviso
 * discutible enseña a discutir la puerta.
 */

export const STAGING_VERSION = 1;
export const STAGING_AUDIT_CONTRACT_VERSION = 1;

/**
 * Contraste mínimo entre el texto y su fondo.
 *
 * 4,5:1 es el AA de WCAG para texto normal. La norma admite 3:1 en texto grande,
 * y casi todo el texto de una pieza de motion graphics lo es —así que este
 * umbral avisará de casos que un diseñador aceptaría—. Se queda en uno solo a
 * propósito: distinguir «grande» obliga a que el informe traiga tamaño y peso de
 * cada capa, y a decidir cómo escala «grande» cuando el cuadro no es 1920×1080.
 * Dos discusiones a cambio de menos avisos que, además, se pueden ignorar.
 *
 * Es una suposición declarada, como el ritmo de lectura: viaja en el informe y
 * se puede sustituir.
 */
export const DEFAULT_CONTRAST_RATIO = 4.5;

export type LayerKind = "text" | "model" | "image" | "shape" | "particles";

/** Una capa colocada en el cuadro, tal como la mide quien la montó. */
export interface StagedLayer {
  id: string;
  kind: LayerKind;
  /**
   * Si la capa aporta algo visible en el frame de muestra. Lo decide el editor:
   * aquí no se adivina desde la opacidad ni desde el tamaño, porque «poco
   * visible» es criterio y no medida.
   */
  visible: boolean;
  /** Caja en píxeles del cuadro, `[x0, y0, x1, y1]`. Obligatoria en texto. */
  box?: [number, number, number, number];
  /** Color del texto en sRGB 0..1. Obligatorio en texto. */
  color?: [number, number, number];
  /** Color medio del fondo bajo la caja, medido sobre el frame. Obligatorio en texto. */
  backgroundColor?: [number, number, number];
}

export interface StagedScene {
  name: string;
  startFrame: number;
  durationFrames: number;
  /** Frame sobre el que se midieron los colores. Va en el informe para poder repetirlo. */
  sampleFrame: number;
  layers: StagedLayer[];
}

export interface StagingSpec {
  stagingVersion: number;
  title?: string;
  /** Tamaño del cuadro en píxeles: es lo que define qué queda fuera. */
  frame: { width: number; height: number };
  scenes: StagedScene[];
}

export interface StagingWarning {
  code: string;
  /** Escena a la que se refiere. */
  scene: string;
  /** Capa concreta, o `null` si el aviso es de la escena entera. */
  layer: string | null;
  message: string;
}

export interface StagingSceneReading {
  name: string;
  startFrame: number;
  durationFrames: number;
  sampleFrame: number;
  visibleLayers: number;
  /** Contraste medido por capa de texto, en orden. */
  contrasts: Array<{ layer: string; ratio: number }>;
}

export interface StagingAudit {
  contractVersion: number;
  title: string | null;
  frame: { width: number; height: number };
  /** Umbral con el que se juzgó el contraste. Declarado, no medido. */
  contrastRatio: number;
  scenes: StagingSceneReading[];
  warnings: StagingWarning[];
}

export interface StagingAuditOptions {
  contrastRatio?: number;
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isColor = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((channel) => isNumber(channel) && channel >= 0 && channel <= 1);

const isBox = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) && value.length === 4 && value.every(isNumber);

/**
 * Valida la forma del informe. Igual que con el guion, un informe mal formado es
 * un error de datos —salida 2— y no un aviso: no se puede medir lo que no está.
 */
export function resolveStaging(spec: unknown): StagingSpec {
  if (typeof spec !== "object" || spec === null) {
    throw new Error("la puesta en escena debe ser un objeto");
  }
  const value = spec as Record<string, unknown>;

  if (value.stagingVersion !== STAGING_VERSION) {
    throw new Error(
      `stagingVersion debe ser ${STAGING_VERSION}; llega ${JSON.stringify(value.stagingVersion)}`,
    );
  }

  const frame = value.frame as Record<string, unknown> | undefined;
  if (
    typeof frame !== "object" ||
    frame === null ||
    !isNumber(frame.width) ||
    !isNumber(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new Error("frame debe traer width y height positivos, en píxeles");
  }

  if (!Array.isArray(value.scenes) || value.scenes.length === 0) {
    throw new Error("la puesta en escena necesita al menos una escena");
  }

  const scenes = value.scenes.map((entry, index) => resolveScene(entry, index));
  const names = new Set<string>();
  for (const scene of scenes) {
    if (names.has(scene.name)) throw new Error(`escena repetida: '${scene.name}'`);
    names.add(scene.name);
  }

  return {
    stagingVersion: STAGING_VERSION,
    title: typeof value.title === "string" ? value.title : undefined,
    frame: { width: frame.width, height: frame.height },
    scenes,
  };
}

function resolveScene(entry: unknown, index: number): StagedScene {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`la escena ${index} debe ser un objeto`);
  }
  const scene = entry as Record<string, unknown>;
  const name = typeof scene.name === "string" && scene.name.length > 0 ? scene.name : null;
  if (name === null) throw new Error(`la escena ${index} necesita un nombre`);

  if (!isNumber(scene.startFrame) || scene.startFrame < 0) {
    throw new Error(`'${name}': startFrame debe ser un entero no negativo`);
  }
  if (!isNumber(scene.durationFrames) || scene.durationFrames <= 0) {
    throw new Error(`'${name}': durationFrames debe ser mayor que cero`);
  }
  if (!isNumber(scene.sampleFrame)) {
    throw new Error(`'${name}': sampleFrame debe decir en qué frame se midieron los colores`);
  }
  if (
    scene.sampleFrame < scene.startFrame ||
    scene.sampleFrame >= scene.startFrame + scene.durationFrames
  ) {
    throw new Error(
      `'${name}': sampleFrame ${scene.sampleFrame} cae fuera de la escena ` +
        `[${scene.startFrame}, ${scene.startFrame + scene.durationFrames})`,
    );
  }
  if (!Array.isArray(scene.layers)) {
    throw new Error(`'${name}': layers debe ser una lista, aunque esté vacía`);
  }

  const layers = scene.layers.map((layer, position) => resolveLayer(layer, name, position));
  return {
    name,
    startFrame: scene.startFrame,
    durationFrames: scene.durationFrames,
    sampleFrame: scene.sampleFrame,
    layers,
  };
}

const LAYER_KINDS: readonly LayerKind[] = ["text", "model", "image", "shape", "particles"];

function resolveLayer(entry: unknown, scene: string, position: number): StagedLayer {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`'${scene}': la capa ${position} debe ser un objeto`);
  }
  const layer = entry as Record<string, unknown>;
  const id = typeof layer.id === "string" && layer.id.length > 0 ? layer.id : null;
  if (id === null) throw new Error(`'${scene}': la capa ${position} necesita un id`);

  if (!LAYER_KINDS.includes(layer.kind as LayerKind)) {
    throw new Error(
      `'${scene}' / '${id}': kind debe ser uno de ${LAYER_KINDS.join(", ")}; ` +
        `llega ${JSON.stringify(layer.kind)}`,
    );
  }
  if (typeof layer.visible !== "boolean") {
    throw new Error(`'${scene}' / '${id}': visible debe ser true o false`);
  }

  // El texto es el único que se juzga por caja y color, así que es el único al
  // que se le exigen. Pedírselos a un modelo sería inventar datos.
  if (layer.kind === "text" && layer.visible) {
    if (!isBox(layer.box)) {
      throw new Error(`'${scene}' / '${id}': un texto visible necesita box [x0, y0, x1, y1]`);
    }
    if (!isColor(layer.color)) {
      throw new Error(`'${scene}' / '${id}': un texto visible necesita color [r, g, b] en 0..1`);
    }
    if (!isColor(layer.backgroundColor)) {
      throw new Error(
        `'${scene}' / '${id}': un texto visible necesita backgroundColor [r, g, b] en 0..1`,
      );
    }
  }

  return {
    id,
    kind: layer.kind as LayerKind,
    visible: layer.visible,
    box: isBox(layer.box) ? layer.box : undefined,
    color: isColor(layer.color) ? layer.color : undefined,
    backgroundColor: isColor(layer.backgroundColor) ? layer.backgroundColor : undefined,
  };
}

/**
 * Luminancia relativa de WCAG. El canal se linealiza antes de pesarlo: sRGB no
 * es lineal, y hacer la media sobre los valores codificados da un contraste que
 * no se parece al que ve nadie.
 */
function relativeLuminance([red, green, blue]: readonly number[]): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** Razón de contraste de WCAG, siempre ≥ 1. */
export function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function auditStaging(spec: unknown, options: StagingAuditOptions = {}): StagingAudit {
  const staging = resolveStaging(spec);
  const threshold = options.contrastRatio ?? DEFAULT_CONTRAST_RATIO;
  if (!isNumber(threshold) || threshold < 1) {
    throw new Error("contrastRatio debe ser un número mayor o igual que 1");
  }

  const warnings: StagingWarning[] = [];
  const scenes: StagingSceneReading[] = [];

  for (const scene of staging.scenes) {
    const visibles = scene.layers.filter((layer) => layer.visible);
    const contrasts: Array<{ layer: string; ratio: number }> = [];

    if (visibles.length === 0) {
      warnings.push({
        code: "ESCENA_VACIA",
        scene: scene.name,
        layer: null,
        message:
          `'${scene.name}' no enseña nada en el frame ${scene.sampleFrame}: ` +
          `${scene.layers.length} capa(s) y ninguna visible`,
      });
    }

    for (const layer of visibles) {
      if (layer.box) {
        const [x0, y0, x1, y1] = layer.box;
        const fuera =
          x0 < 0 || y0 < 0 || x1 > staging.frame.width || y1 > staging.frame.height;
        if (fuera) {
          const desborde = Math.max(
            -x0,
            -y0,
            x1 - staging.frame.width,
            y1 - staging.frame.height,
          );
          warnings.push({
            code: "CAJA_FUERA_DE_CUADRO",
            scene: scene.name,
            layer: layer.id,
            message:
              `'${layer.id}' se sale del cuadro por ${Math.ceil(desborde)} px: ` +
              `caja [${layer.box.join(", ")}] sobre ${staging.frame.width}×${staging.frame.height}`,
          });
        }
      }

      if (layer.kind === "text" && layer.color && layer.backgroundColor) {
        const ratio = Number(contrastRatio(layer.color, layer.backgroundColor).toFixed(2));
        contrasts.push({ layer: layer.id, ratio });
        if (ratio < threshold) {
          warnings.push({
            code: "CONTRASTE_INSUFICIENTE",
            scene: scene.name,
            layer: layer.id,
            message:
              `'${layer.id}' tiene ${ratio}:1 contra su fondo y el umbral declarado es ` +
              `${threshold}:1; medido en el frame ${scene.sampleFrame}`,
          });
        }
      }
    }

    scenes.push({
      name: scene.name,
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sampleFrame: scene.sampleFrame,
      visibleLayers: visibles.length,
      contrasts,
    });
  }

  return {
    contractVersion: STAGING_AUDIT_CONTRACT_VERSION,
    title: staging.title ?? null,
    frame: staging.frame,
    contrastRatio: threshold,
    scenes,
    warnings,
  };
}
