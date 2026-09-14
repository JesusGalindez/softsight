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
  type: '"MASTER"|"LOD"|"COLLISION"',
  required: true,
  description:
    "Qué papel juega la malla. Las tres son triángulos; lo que cambia es qué se les mide.",
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
  level: {
    type: "number",
    description:
      "Nivel del LOD, desde 1. Obligatorio con `role: LOD` y prohibido en los otros dos: un nivel " +
      "sobre la maestra no significa nada, y sin nivel dos LOD no se pueden ordenar.",
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
