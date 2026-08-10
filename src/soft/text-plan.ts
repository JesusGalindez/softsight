/**
 * De plan de cartel a títulos SDF quemados en el framebuffer.
 *
 * Una plantilla declarativa dice qué texto, dónde y en qué rol; este módulo
 * resuelve la geometría (origins por ancla y escala), normaliza el copy al
 * alfabeto 5×7 (mayúsculas, sin acentos) y traduce los roles de color a RGB.
 * El resultado es lo único que `RenderOptions.title`/`titles` necesita, y es
 * determinista: el mismo plan produce los mismos píxeles.
 */

import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_ORDER } from "./font";
import type { SdfTitle } from "./renderer";

/** El lado de la ancla: qué posición de la caja del texto queda en el punto. */
export type SdfAnchorSide = "left" | "center" | "right";

/** Plan declarativo de un texto del cartel, tal y como lo escribe la plantilla. */
export interface SdfTextPlan {
  /** Texto libre (minúsculas y acentos aceptados; se normaliza al quemar). */
  title: string;
  /** Punto de ancla en píxeles de pantalla. */
  anchor: {
    x: number;
    y: number;
    side?: SdfAnchorSide;
  };
  /** Píxeles de pantalla por píxel de fuente (5×7). */
  scale: number;
  /** Rol de color de la paleta, o el color hex completo. */
  color?: string;
  /** Límite del caje: la escala baja si el texto no cabe. */
  fit?: {
    maxWidth?: number;
    maxHeight?: number;
  };
}

/** Roles de la paleta serie «demos-tipografia»: usados si la plantilla no mapea. */
export const DEFAULT_ROLE_COLORS: Record<string, string> = {
  bg: "#0B0B0F",
  panel: "#17171C",
  ink: "#E9EAEE",
  dim: "#6E6E7C",
  accent: "#C6FF3D",
  rail: "#3B3B44",
};

export const DEFAULT_INK_RGB: readonly [number, number, number] = [236, 239, 245];

/**
 * Normaliza el copy al alfabeto 5×7: mayúsculas, diacríticos fundidos, y todo
 * carácter que la fuente no tenga se vuelve `?` y se avisa — un hueco silencioso
 * haría creer que el texto dice otra cosa.
 */
export function normalizeSdfCopy(raw: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const upper = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let text = "";
  const missing = new Set<string>();
  for (const char of upper) {
    if (GLYPH_ORDER.includes(char)) {
      text += char;
    } else if (char !== "\n" && char !== "\r") {
      missing.add(char);
      text += "?";
    }
  }
  if (missing.size > 0) {
    warnings.push(`glifos no soportados en 5×7 (se pintan "?"): ${[...missing].join(" ")}`);
  }
  return { text, warnings };
}

/**
 * Rectángulo del texto ya normalizado, en píxeles de pantalla. Con
 * `GLYPH_ADVANCE` el texto de longitud `n` mide `(n·6−1)·scale`.
 */
export function measureSdfText(text: string, scale: number): { width: number; height: number } {
  return {
    width: (text.length * GLYPH_ADVANCE - 1) * scale,
    height: GLYPH_HEIGHT * scale,
  };
}

/**
 * Traduce un color de plan al triple RGB del motor: rol de paleta (`accent`) o
 * hexadecimal (`#C6FF3D`). Lo desconocido vuelve a la tinta por defecto y avisa.
 */
export function resolveSdfColor(
  color: string | undefined,
  roles: Record<string, string> = DEFAULT_ROLE_COLORS,
): { rgb: readonly [number, number, number]; warnings: string[] } {
  const warnings: string[] = [];
  if (!color) return { rgb: DEFAULT_INK_RGB, warnings };
  const hex = color.startsWith("#") ? color : roles[color];
  if (hex?.[0] === "#" && hex.length === 7) {
    return {
      rgb: [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ],
      warnings,
    };
  }
  warnings.push(`color de título "${color}" sin resolver; se usa la tinta por defecto`);
  return { rgb: DEFAULT_INK_RGB, warnings };
}

/** Escala que hace caber `text` en el caje, sin sobrepasar la pedida. */
export function fitSdfScale(
  text: string,
  scale: number,
  fit: SdfTextPlan["fit"],
): number {
  if (!fit) return scale;
  let fitted = scale;
  const { width, height } = measureSdfText(text, scale);
  if (fit.maxWidth && width > fit.maxWidth) {
    fitted = Math.min(fitted, (fit.maxWidth * scale) / width);
  }
  if (fit.maxHeight && height > fit.maxHeight) {
    fitted = Math.min(fitted, (fit.maxHeight * scale) / height);
  }
  return fitted;
}

/** Coloca la caja del texto según la ancla y el lado pedido. */
function originFor(
  plan: SdfTextPlan,
  width: number,
): { originX: number; originY: number } {
  let originX = plan.anchor.x;
  if (plan.anchor.side === "center") originX -= width / 2;
  else if (plan.anchor.side === "right") originX -= width;
  return { originX, originY: plan.anchor.y };
}

/** Origen tomado de la ancla: la esquina superior izquierda de la caja. */
export function placeSdfOrigin(
  plan: SdfTextPlan,
  text: string,
  scale: number,
): { originX: number; originY: number } {
  const { width } = measureSdfText(text, scale);
  return originFor(plan, width);
}

/**
 * Convierte la lista de planes de un cartel en los `SdfTitle` que el motor
 * quema. Orden estable: primero los `title`, luego `titles` (si el caller mezcla
 * ambos estilos, el título suelto va delante).
 */
export function buildSdfTitles(
  plans: readonly SdfTextPlan[],
  roles: Record<string, string> = DEFAULT_ROLE_COLORS,
): { titles: SdfTitle[]; warnings: string[] } {
  const warnings: string[] = [];
  const titles: SdfTitle[] = [];
  for (const plan of plans) {
    const { text, warnings: copyWarnings } = normalizeSdfCopy(plan.title);
    warnings.push(...copyWarnings);
    const scale = fitSdfScale(text, plan.scale, plan.fit);
    const { originX, originY } = placeSdfOrigin(plan, text, scale);
    const { rgb, warnings: colorWarnings } = resolveSdfColor(plan.color, roles);
    warnings.push(...colorWarnings);
    titles.push({ text, originX, originY, scale, color: rgb });
  }
  return { titles, warnings };
}