/**
 * R13 — la textura y el material, que es lo que necesita la imagen como fichero.
 *
 * ## Lo que el tamaño de la imagen desbloquea
 *
 * La auditoría de UV publica densidad de téxel **por unidad de mundo**, y con eso
 * solo se puede comparar una parte de la pieza con otra. Con el tamaño de la
 * imagen el número pasa a ser téxeles de verdad, y entonces sí se puede comparar
 * con un destino: «este asset tiene 180 téxeles por metro» significa algo fuera
 * de sí mismo, y «0,42 de densidad relativa» no.
 *
 * ## Que la imagen encaje con su papel, que no es lo mismo que que exista
 *
 * Un mapa de color enchufado en el canal de normales **se lee sin error**: es un
 * PNG válido, tiene el tamaño correcto y el motor lo usará. Lo que sale es una
 * superficie con relieve absurdo, y nada lo dice hasta que alguien lo mira.
 *
 * Se puede medir, y **la medida que vale no es la media**. El primer intento fue
 * azul medio y norma media, y un damero corriente lo pasó: azul 0,51 y norma 0,98,
 * las dos por los pelos y por casualidad. Promediar un canal que salta entre dos
 * extremos da justo el centro, que es donde está el umbral.
 *
 * Lo que de verdad distingue un mapa de normales en espacio tangente es que **su
 * z nunca apunta hacia dentro de la superficie**: el azul codificado está siempre
 * en 128 o por encima. Un mapa de color tiene la mitad de los píxeles por debajo,
 * y no por poco.
 *
 * ```text
 * z bajo el horizonte   0 en un mapa de normales; ~0,5 en el damero de arriba
 * azul medio            se publica igual, que describe cuán accidentado es
 * norma cerca de uno    ídem: un vector unitario mal codificado se aleja
 * ```
 *
 * Sigue sin ser una prueba —un degradado azul pasaría— y por eso el informe
 * publica los tres números y no solo el veredicto.
 *
 * ## Y el alfa que no pinta nada
 *
 * Un canal alfa constante ocupa un cuarto del fichero y no dice nada. No es un
 * error —hay pipelines que lo dejan— pero es el ahorro más barato que existe en
 * un asset, y nadie lo ve mirando la imagen.
 */

export type TextureUsage =
  | "BASE_COLOR"
  | "NORMAL"
  | "METALLIC_ROUGHNESS"
  | "OCCLUSION"
  | "EMISSIVE";

/** Una imagen ya decodificada, en RGBA de ocho bits. El IO vive fuera. */
export interface TextureImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface TextureAudit {
  measurementClass: "EXACT";
  reproducibility: "BITWISE_EXACT";
  artifactId: string;
  usage: TextureUsage;
  width: number;
  height: number;
  /** El lado mayor: es lo que un presupuesto de destino limita. */
  maxSide: number;
  powerOfTwo: boolean;
  square: boolean;
  /** Si el alfa es constante: un cuarto del fichero que no dice nada. */
  alphaConstant: boolean;
  /**
   * Solo con `usage: NORMAL`. Media del canal azul en [0,1] y media de la norma
   * del vector decodificado. Una imagen de normales de verdad da ambas altas.
   */
  normalLike?: { meanBlue: number; meanLength: number; belowHorizonRatio: number };
  /** Motivo canónico cuando el contenido no encaja con el papel declarado. */
  reason?: string;
}

/** Potencia de dos, incluidos el 1 y el 2. */
function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/**
 * Umbrales del parecido con un mapa de normales.
 *
 * Salen de la codificación: un vector `(0,0,1)` —la normal sin perturbar— se
 * guarda como `(128,128,255)`, así que el azul medio de un mapa plano es 1,0 y el
 * de uno muy accidentado baja hacia 0,7. Por debajo de 0,5 el vector apuntaría
 * hacia dentro de la superficie en promedio, que no es un mapa de normales.
 */
export const NORMAL_MIN_BLUE = 0.5;
/** Y la norma: un vector unitario mal codificado se aleja de uno enseguida. */
export const NORMAL_MIN_LENGTH = 0.8;
/**
 * Fracción de píxeles con z negativo que se tolera.
 *
 * Cero en teoría: una normal tangente no apunta hacia dentro. Se deja un uno por
 * mil para el redondeo de la compresión y para los bordes de las islas, donde un
 * filtro puede haber mezclado con el fondo.
 */
export const NORMAL_MAX_BELOW_HORIZON = 0.001;

export function auditTexture(
  artifactId: string,
  usage: TextureUsage,
  image: TextureImage,
): TextureAudit {
  const total = image.width * image.height;
  let alphaFirst = -1;
  let alphaConstant = true;
  let sumaAzul = 0;
  let sumaNorma = 0;
  let bajoHorizonte = 0;

  for (let pixel = 0; pixel < total; pixel += 1) {
    const alpha = image.pixels[pixel * 4 + 3];
    if (alphaFirst < 0) alphaFirst = alpha;
    else if (alpha !== alphaFirst) alphaConstant = false;

    if (usage === "NORMAL") {
      // De [0,255] a [-1,1] en x e y, y a [0,1] en z: la codificación estándar de
      // un mapa en espacio tangente.
      const x = (image.pixels[pixel * 4] / 255) * 2 - 1;
      const y = (image.pixels[pixel * 4 + 1] / 255) * 2 - 1;
      const z = (image.pixels[pixel * 4 + 2] / 255) * 2 - 1;
      sumaAzul += image.pixels[pixel * 4 + 2] / 255;
      sumaNorma += Math.hypot(x, y, z);
      // z < 0: el vector apunta hacia dentro de la superficie, que en espacio
      // tangente no ocurre.
      if (z < 0) bajoHorizonte += 1;
    }
  }

  const base = {
    measurementClass: "EXACT" as const,
    reproducibility: "BITWISE_EXACT" as const,
    artifactId,
    usage,
    width: image.width,
    height: image.height,
    maxSide: Math.max(image.width, image.height),
    powerOfTwo: isPowerOfTwo(image.width) && isPowerOfTwo(image.height),
    square: image.width === image.height,
    alphaConstant,
  };

  if (usage !== "NORMAL") return base;

  const meanBlue = total === 0 ? 0 : sumaAzul / total;
  const meanLength = total === 0 ? 0 : sumaNorma / total;
  const belowHorizonRatio = total === 0 ? 0 : bajoHorizonte / total;
  const encaja =
    belowHorizonRatio <= NORMAL_MAX_BELOW_HORIZON &&
    meanBlue >= NORMAL_MIN_BLUE &&
    meanLength >= NORMAL_MIN_LENGTH;
  return {
    ...base,
    normalLike: { meanBlue, meanLength, belowHorizonRatio },
    // **No afirma qué es la imagen**, afirma que no se parece a lo que dice ser.
    // Un mapa de color azulado pasaría, y eso va dicho aquí y en el informe.
    ...(encaja ? {} : { reason: "CONTENIDO_NO_PARECE_UN_MAPA_DE_NORMALES" }),
  };
}

export type MaterialWrap = "REPEAT" | "CLAMP";

export interface DeclaredMaterial {
  id: string;
  appliesTo: string[];
  textures?: Partial<Record<"baseColor" | "normal" | "metallicRoughness" | "occlusion" | "emissive", string>>;
  wrap: MaterialWrap;
  doubleSided?: boolean;
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
}

export interface MaterialIssue {
  material: string;
  reason: string;
  message: string;
}

/**
 * Lo que un material se contradice a sí mismo diciendo.
 *
 * Igual que `SS-RECON` en el paquete de reconstrucción: el fichero está bien y el
 * hash cuadra, y lo que falla es que dos campos del manifest no pueden ser
 * ciertos a la vez. Se caza **sin abrir una sola imagen**.
 */
export function auditMaterials(
  materials: readonly DeclaredMaterial[],
  context: {
    /** Identidad y papel de cada artifact, para comprobar a qué apuntan. */
    roles: ReadonlyMap<string, string>;
    /** Si cada malla trae UV. Un material sin UV no puede pintar una textura. */
    uvPresence: ReadonlyMap<string, boolean>;
    /** Vértices fuera del cuadrado unidad, por malla. */
    outsideUnitSquare: ReadonlyMap<string, number>;
  },
): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const decir = (material: string, reason: string, message: string) =>
    issues.push({ material, reason, message });

  for (const material of materials) {
    for (const mallaId of material.appliesTo) {
      const papel = context.roles.get(mallaId);
      if (papel === undefined) {
        decir(material.id, "MALLA_AUSENTE", `${material.id}: pinta ${mallaId}, que no es un artifact`);
        continue;
      }
      if (papel === "TEXTURE") {
        decir(material.id, "MALLA_AUSENTE", `${material.id}: ${mallaId} es una textura, no una malla`);
        continue;
      }
      // Un material sobre la colisión: el proxy no se pinta, así que declararlo
      // es decir dos cosas incompatibles sobre para qué está esa malla.
      if (papel === "COLLISION") {
        decir(
          material.id,
          "MATERIAL_SOBRE_COLISION",
          `${material.id}: pinta ${mallaId}, que es el proxy de colisión y no se pinta`,
        );
      }
    }

    for (const [canal, artifactId] of Object.entries(material.textures ?? {})) {
      if (artifactId === undefined) continue;
      if (context.roles.get(artifactId) !== "TEXTURE") {
        decir(
          material.id,
          "TEXTURA_AUSENTE",
          `${material.id}: el canal ${canal} apunta a ${artifactId}, que no es un artifact TEXTURE`,
        );
      }
    }

    const pinta = Object.keys(material.textures ?? {}).length > 0;
    for (const mallaId of material.appliesTo) {
      if (context.roles.get(mallaId) === undefined) continue;
      // Una textura sobre una malla sin UV no se puede pintar: no hay dónde.
      if (pinta && context.uvPresence.get(mallaId) !== true) {
        decir(
          material.id,
          "TEXTURA_SOBRE_MALLA_SIN_UV",
          `${material.id}: declara textura sobre ${mallaId}, que no trae coordenadas`,
        );
      }
      // **El hueco que la auditoría de UV dejó abierto.** Una UV en 1,7 depende
      // del modo de repetición; con `CLAMP`, se estira el borde de la textura y
      // el manifest se contradice.
      if (material.wrap === "CLAMP" && (context.outsideUnitSquare.get(mallaId) ?? 0) > 0) {
        decir(
          material.id,
          "CLAMP_CON_UV_FUERA_DEL_CUADRADO",
          `${material.id}: wrap CLAMP sobre ${mallaId}, que tiene ` +
            `${context.outsideUnitSquare.get(mallaId)} vértices fuera del cuadrado unidad`,
        );
      }
    }
  }
  return issues;
}
