/**
 * R11 — la forma de lo que se publica, que no es la forma de lo que se midió.
 *
 * ## Por qué es otro documento y no un campo más
 *
 * El paquete de reconstrucción contesta **qué vieron las cámaras**. Este contesta
 * **qué se va a publicar**, y las preguntas no se solapan: un asset de producción
 * no tiene cámaras, ni escala que estimar, ni cobertura que medir. Lo que tiene
 * son piezas **derivadas** —niveles de detalle, una malla de colisión— y la
 * pregunta que importa es si cada derivada sigue siendo fiel a su maestra.
 *
 * Meterlo en el paquete de reconstrucción habría obligado a que la mitad de sus
 * campos fueran opcionales y a que la mitad de sus comprobaciones se saltaran,
 * que es la forma de acabar con un documento que no describe bien ninguna de las
 * dos cosas.
 *
 * ## Los tres papeles, y por qué son papeles y no tipos
 *
 * ```text
 * MASTER      la malla de la que sale todo. Exactamente una
 * LOD         un nivel de detalle, con su número. Cero o más
 * COLLISION   el proxy con el que el motor calcula choques. Cero o una
 * ```
 *
 * Los tres son mallas de triángulos: el tipo no los distingue, **el papel sí**. Y
 * el papel decide qué se les mide, que es lo que importa — a un LOD se le mide
 * cuánto se desvía de su maestra, y a la colisión, si de verdad la contiene.
 *
 * ## Lo que un LOD es, y por eso no se mide como un defecto
 *
 * Un LOD **tiene que** diferir de la maestra; en eso consiste. Así que la
 * desviación no es un defecto: lo es pasarse del presupuesto. El número se
 * publica en las dos direcciones y **nunca promediado**, igual que en R5: lo que
 * el LOD perdió y lo que añadió son dos cosas distintas, y una simplificación que
 * infla es otro problema que una que come.
 */

import type { FieldSchema, ObjectSchema } from "../schema";

const ROLE: FieldSchema = {
  type: '"MASTER"|"LOD"|"COLLISION"|"TEXTURE"',
  required: true,
  description:
    "Qué papel juega el artifact. Los tres primeros son mallas de triángulos —lo que cambia es qué " +
    "se les mide— y `TEXTURE` no es una malla: es la imagen que se pinta encima, y por eso lleva " +
    "`usage` en vez de `level`.",
};

const PRODUCTION_ARTIFACT: ObjectSchema = {
  id: { type: "string", required: true, description: "Identidad dentro del asset." },
  path: {
    type: "string",
    required: true,
    description: "Ruta relativa a la raíz. Absoluta o con `..` se rechaza, como en D6.",
  },
  bytes: { type: "number", required: true, description: "Tamaño en bytes." },
  sha256: { type: "string", required: true, description: "Hash del contenido, hexadecimal minúscula." },
  role: ROLE,
  format: {
    type: '"PLY"|"GLB"',
    description:
      "En qué formato viene la malla. Ausente es `PLY`, que es lo que había. **No es un detalle de " +
      "lectura**: un PLY no puede expresar coordenadas de textura ni materiales, así que el formato " +
      "decide qué preguntas se le pueden hacer al artifact. Lo que no se puede medir se declara no " +
      "ejecutado con su motivo, nunca aprobado por ausencia.",
  },
  level: {
    type: "number",
    description:
      "Nivel del LOD, desde 1. Obligatorio con `role: LOD` y prohibido en los otros: un nivel sobre " +
      "la maestra no significa nada, y sin nivel dos LOD no se pueden ordenar.",
  },
  usage: {
    type: '"BASE_COLOR"|"NORMAL"|"METALLIC_ROUGHNESS"|"OCCLUSION"|"EMISSIVE"',
    description:
      "Qué canal del material alimenta la imagen. Obligatorio con `role: TEXTURE` y prohibido en las " +
      "mallas. **No es decorativo**: un mapa de normales y uno de color se miden distinto, y sin " +
      "saber cuál es no se puede decir si el contenido encaja con su papel.",
  },
};

/**
 * Un material: qué imagen se pinta sobre qué malla, y cómo.
 *
 * Es lo que cierra el hueco que la auditoría de UV dejó abierto. Una UV en 1,7 no
 * es un defecto por sí sola —depende del modo de repetición—, y hasta que el
 * documento no declaró ese modo, el número se publicaba sin poder juzgarse. Con
 * `wrap: CLAMP` y una UV fuera del cuadrado, el manifest **se contradice a sí
 * mismo**, que es la clase de fallo que este contrato caza sin abrir un fichero.
 */
const MATERIAL_FIELDS: ObjectSchema = {
  id: { type: "string", required: true, description: "Identidad del material dentro del asset." },
  appliesTo: {
    type: "string[]",
    required: true,
    description: "Identidades de las mallas que lo usan. Vacío es un material que no pinta nada.",
  },
  textures: {
    type: "object",
    description: "Qué artifact alimenta cada canal. Lo que no se declara, no se pinta.",
    fields: {
      baseColor: { type: "string", description: "Artifact de color base." },
      normal: { type: "string", description: "Artifact de normales." },
      metallicRoughness: { type: "string", description: "Artifact de metalicidad y rugosidad." },
      occlusion: { type: "string", description: "Artifact de oclusión." },
      emissive: { type: "string", description: "Artifact de emisión." },
    },
  },
  wrap: {
    type: '"REPEAT"|"CLAMP"',
    required: true,
    description:
      "Qué pasa fuera del cuadrado unidad. **Obligatorio y sin defecto**: suponer `REPEAT` haría " +
      "pasar en silencio un despliegue que se sale, y suponer `CLAMP` suspendería a quien usa el " +
      "mosaico a propósito.",
  },
  doubleSided: {
    type: "boolean",
    description: "Si se pinta por las dos caras. Sin declarar, una sola.",
  },
  alphaMode: {
    type: '"OPAQUE"|"MASK"|"BLEND"',
    description: "Cómo se interpreta el alfa. Sin declarar, opaco.",
  },
};

const PRODUCTION_BUDGET: ObjectSchema = {
  name: { type: "string", required: true, description: "Término del vocabulario de R9." },
  role: {
    type: '"MASTER"|"LOD"|"COLLISION"',
    description:
      "A qué papel se le aplica. Ausente lo aplica **al conjunto**: `triangulos ≤ 50000` sin papel " +
      "presupuesta todo lo que se publica, que casi nunca es lo que se quiere decir.",
  },
  units: {
    type: '"ABSOLUTE"|"RELATIVE_TO_DIAGONAL"',
    required: true,
    description: "Igual que en el paquete, y con la misma regla de escala de D9.",
  },
  unit: { type: "string", description: "La unidad cuando es absoluto." },
  max: { type: "number", required: true, description: "Máximo admitido." },
};

/**
 * El asset de producción, como datos.
 *
 * `target` es lo que convierte un montón de mallas en algo publicable: **el
 * destino manda**. Un mismo maestro vale para móvil y no vale para consola, y la
 * diferencia no está en la malla sino en contra qué se la juzga. Por eso el
 * preset viaja con su nombre y con sus presupuestos: el nombre solo obligaría a
 * que este binario supiera qué significa «mobile-low», y eso es conocimiento de
 * quien publica, no nuestro.
 */
export const PRODUCTION_ASSET_SCHEMA: ObjectSchema = {
  documentType: {
    type: '"softsight.production-asset"',
    required: true,
    description: "Qué documento es. Nunca un nombre suelto y ambiguo como `asset` (D14).",
  },
  contractVersion: {
    type: "string",
    required: true,
    description: "Versión del contrato de frontera; 0.x mientras esté en DRAFT.",
  },
  assetId: { type: "string", required: true, description: "Identidad del asset." },
  state: {
    type: '"DRAFT"|"SEALED"',
    required: true,
    description:
      "Solo se consume SEALED, por lo mismo que D29: un asset a medio escribir con el manifest ya " +
      "puesto describe ficheros que todavía están cambiando.",
  },
  producer: {
    type: "object",
    required: true,
    description: "Quién lo escribió y con qué versión.",
    fields: {
      name: { type: "string", required: true, description: "Nombre del productor." },
      version: { type: "string", required: true, description: "Su versión." },
    },
  },
  artifacts: {
    type: "object[]",
    required: true,
    description: "Las mallas que se publican, cada una con su papel.",
    fields: PRODUCTION_ARTIFACT,
  },
  target: {
    type: "object",
    required: true,
    description:
      "El destino contra el que se juzga. **El preset viaja con sus presupuestos**: solo con el " +
      "nombre, este binario tendría que saber qué significa «mobile-low», y eso lo sabe quien publica.",
    fields: {
      preset: { type: "string", required: true, description: "Nombre del destino, para citarlo." },
      budgets: {
        type: "object[]",
        required: true,
        description: "Los límites del destino, con el vocabulario cerrado de R9.",
        fields: PRODUCTION_BUDGET,
      },
      collisionTolerance: {
        type: "number",
        description:
          "Fracción de la superficie maestra que puede asomar del proxy. **Sin declarar es cero**, y " +
          "ese defecto se puede defender: un proxy que no contiene la pieza deja que la atraviesen " +
          "por ahí. Se declara para los casos en que asomar es a propósito — una alambrada, un " +
          "adorno fino que nadie quiere en la colisión.",
      },
      uvRequired: {
        type: "boolean",
        description:
          "Si el destino exige coordenadas de textura en las mallas que se pintan —maestra y niveles, " +
          "nunca el proxy de colisión—. **Es el único criterio de UV con disparador defendible**, y " +
          "aun así lo declara el destino: un asset de color plano no las necesita.",
      },
      uvOverlapMax: {
        type: "number",
        description:
          "Cuánta área UV puede pisarse, sobre la que ocupan las islas. Sin declarar no se juzga: en " +
          "un atlas de color, solapar dos mitades simétricas es una técnica; en uno de luz, imposible.",
      },
      uvDensitySpreadMax: {
        type: "number",
        description:
          "Dispersión de densidad de téxel admitida, p95 entre p05. Una pieza uniforme da 1. **La " +
          "dispersión y no la mediana**: dos partes a densidades distintas se ven a resoluciones " +
          "distintas y eso salta a la vista, con la misma mediana.",
      },
      textureMaxSize: {
        type: "number",
        description:
          "Lado mayor admitido de una imagen, en píxeles. Es el presupuesto de destino más común y " +
          "el que decide si un asset cabe en memoria de textura.",
      },
      texturePowerOfTwo: {
        type: "boolean",
        description:
          "Si el destino exige lados potencia de dos. Sin declarar no se juzga: en WebGL2 y en las " +
          "consolas modernas ya no hace falta, y exigirlo por defecto sería imponer un destino viejo.",
      },
      texelDensityMin: {
        type: "number",
        description:
          "Téxeles por unidad de mundo admitidos como mínimo, **con el tamaño de la imagen dentro**. " +
          "Es el número que la auditoría de UV no podía dar: sin saber cuánto mide la textura, la " +
          "densidad solo era relativa.",
      },
      uvOutsideMax: {
        type: "number",
        description:
          "Fracción de vértices con UV fuera del cuadrado unidad. Sin declarar no se juzga: depende " +
          "del modo de repetición del material, que este documento todavía no describe.",
      },
      lodSilhouetteMax: {
        type: "number",
        description:
          "Cuánta silueta puede perder o ganar un LOD, en fracción de la silueta maestra y en la peor " +
          "de las catorce vistas. Es el tope que de verdad describe lo que se ve: la desviación de " +
          "superficie no distingue un 2 % dentro de una pared de un 2 % contra el cielo.",
      },
      lodNormalMaxDegrees: {
        type: "number",
        description:
          "Desviación **media** de normales admitida, en grados. Media y no máxima: con geometría de " +
          "cajas, el punto más próximo a una muestra cae a veces en una cara perpendicular y el " +
          "máximo sale 90° sin que nada esté mal.",
      },
      lodBoundsMax: {
        type: "number",
        description:
          "Cuánto puede moverse la caja envolvente, en fracción de la diagonal. Barato y dice algo " +
          "que ninguna media dice: un LOD que encoge la pieza entera falla aquí con una desviación " +
          "media pequeña.",
      },
      lodDeviationMax: {
        type: "number",
        description:
          "Cuánto puede desviarse un LOD de la maestra, en fracción de la diagonal. **Sin declarar " +
          "no se juzga**: la desviación se publica y no decide. No hay defecto defendible — lo que " +
          "un LOD puede perder depende de a qué distancia se mira, y eso lo sabe quien publica. Es " +
          "la asimetría con `collisionTolerance`, y está a propósito.",
      },
    },
  },
  materials: {
    type: "object[]",
    description:
      "Los materiales del asset. Ausente es un asset sin material declarado, y entonces las " +
      "auditorías que dependen de uno se declaran no ejecutadas en vez de aprobarse.",
    fields: MATERIAL_FIELDS,
  },
  derivation: {
    type: "object",
    description:
      "Lo que el productor afirma sobre cómo salió cada derivada de la maestra. Opcional y **no se " +
      "cree**: se mide. Está para que el informe pueda decir en qué discrepa de lo declarado.",
    fields: {
      tool: { type: "string", description: "Con qué se simplificó." },
      note: { type: "string", description: "Lo que el productor quiera dejar dicho." },
    },
  },
};
