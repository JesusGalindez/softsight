/**
 * La forma del paquete de reconstrucción que produce VideoMesh, como datos.
 *
 * Es el esqueleto de R0-A, no el contrato entero: describe lo que el recorrido de
 * D34 atraviesa —identidad, artifacts, cámaras, escala y grafo de marcos— y deja
 * fuera lo que R0 se prohíbe a sí mismo, cobertura y confianza, que dependen del
 * árbol de triángulos y del muestreo.
 *
 * Vive aquí y no en `schema.ts` porque `schema.ts` es la forma de lo que **este**
 * repositorio acepta como escena; esto es la forma de lo que produce otro. Los
 * dos usan el mismo motor de validación a propósito: uno solo, y la frontera
 * pública sale generada de él (D15).
 */

import type { FieldSchema, ObjectSchema } from "../schema";

/** Campos que todo artifact declara, sea del tipo que sea (D7). */
const ARTIFACT_COMMON: ObjectSchema = {
  id: { type: "string", required: true, description: "Identidad del artifact dentro del paquete." },
  path: {
    type: "string",
    required: true,
    description: "Ruta relativa a la raíz del paquete. Absoluta o con `..` se rechaza (D6).",
  },
  bytes: { type: "number", required: true, description: "Tamaño en bytes, comprobado antes de analizar." },
  sha256: {
    type: "string",
    required: true,
    description: "Hash del contenido en hexadecimal minúscula, 64 caracteres.",
  },
};

const KIND = (values: string[], description: string): FieldSchema => ({
  type: values.map((value) => `"${value}"`).join("|"),
  required: true,
  description,
});

/**
 * Las cuatro formas de artifact, discriminadas por `type`.
 *
 * `purelyReconstructed` es obligatoria en la malla y **está prohibida** en la nube
 * de puntos: una nube no tiene superficie, así que la bandera ahí no significa
 * nada y admitirla sería aceptar un dato que nadie puede interpretar (D21). Sale
 * de la forma discriminada sin código extra: la variante de `POINT_CLOUD` no la
 * declara, y campo desconocido es error (D30).
 */
const ARTIFACT_VARIANTS: Record<string, ObjectSchema> = {
  TRIANGLE_MESH: {
    ...ARTIFACT_COMMON,
    type: KIND(["TRIANGLE_MESH"], "Malla de triángulos."),
    purelyReconstructed: {
      type: "boolean",
      required: true,
      description:
        "Cada región de superficie deriva solo de evidencia de reconstrucción. " +
        "Recalcular normales, soldar, simplificar o convertir formato la mantienen; " +
        "rellenar agujeros, completar por IA o modelar a mano la fuerzan a false. " +
        "No significa «la malla no se ha tocado nunca».",
    },
  },
  POINT_CLOUD: {
    ...ARTIFACT_COMMON,
    type: KIND(["POINT_CLOUD"], "Nube de puntos, dispersa o densa."),
  },
  IMAGE: {
    ...ARTIFACT_COMMON,
    type: KIND(["IMAGE"], "Imagen de entrada, con su orientación ya horneada en los píxeles (D33)."),
  },
  DEPTH_MAP: {
    ...ARTIFACT_COMMON,
    type: KIND(["DEPTH_MAP"], "Mapa de profundidad."),
    depthKind: {
      type: '"OPTICAL_AXIS"|"RAY_LENGTH"',
      required: true,
      description:
        "Sin valor por defecto y sin inferirlo del proveedor: confundirlos mete un error " +
        "que crece con el ángulo respecto al centro —cero en el centro, máximo en las esquinas—.",
    },
  },
};

/**
 * Intrínsecos y distorsión con nombre, nunca un vector posicional (D19): el orden
 * de un vector es una convención que cada backend escribe distinta, y documentarla
 * no impide equivocarse.
 */
const CAMERA_FIELDS: ObjectSchema = {
  id: { type: "string", required: true, description: "Identidad de la cámara dentro del CameraSet." },
  imageArtifactId: {
    type: "string",
    required: true,
    description: "Artifact IMAGE al que pertenecen estos intrínsecos; ata píxeles y calibración (D10).",
  },
  width: { type: "number", required: true, description: "Ancho de la rejilla real, en píxeles." },
  height: { type: "number", required: true, description: "Alto de la rejilla real, en píxeles." },
  pixelOrigin: {
    type: '"TOP_LEFT"|"BOTTOM_LEFT"',
    required: true,
    description: "Dónde está el píxel (0,0).",
  },
  pixelCenter: {
    type: '"CENTER"|"CORNER"',
    required: true,
    description: "Si el centro del píxel (0,0) cae en 0,5 o en 0.",
  },
  model: {
    type: '"PINHOLE"|"OPENCV"',
    required: true,
    description: "Modelo de cámara. Uno desconocido es CAMERA_MODEL_UNSUPPORTED, no un aviso.",
  },
  cameraAxes: {
    type: '"X_RIGHT_Y_DOWN_Z_FORWARD"|"X_RIGHT_Y_UP_Z_BACKWARD"',
    required: true,
    description:
      "Hacia dónde mira la cámara y hacia dónde crece la altura. El primero es el de visión por " +
      "computador —COLMAP, OpenCV—; el segundo el de gráficos —OpenGL—. Confundirlos no da una " +
      "imagen torcida: da una especular en Y con la profundidad invertida, que en un objeto " +
      "simétrico es igual de plausible. Sin valor por defecto, por eso mismo.",
  },
  worldFromCamera: {
    type: "number[16]",
    required: true,
    description:
      "Pose de la cámara en el mundo: 4×4 homogénea, por filas, traslación en 3, 7 y 11, " +
      "vectores columna (D32). Solo worldFromCamera; la inversa se calcula, no se declara.",
  },
  intrinsics: {
    type: "object",
    required: true,
    description: "Distancia focal y punto principal, en píxeles.",
    fields: {
      fx: { type: "number", required: true, description: "Focal en x." },
      fy: { type: "number", required: true, description: "Focal en y." },
      cx: { type: "number", required: true, description: "Punto principal en x." },
      cy: { type: "number", required: true, description: "Punto principal en y." },
    },
  },
  distortion: {
    type: "object",
    description: "Coeficientes con nombre; ausente es sin distorsión, no ceros implícitos.",
    fields: {
      k1: { type: "number", description: "Radial de primer orden." },
      k2: { type: "number", description: "Radial de segundo orden." },
      k3: { type: "number", description: "Radial de tercer orden." },
      p1: { type: "number", description: "Tangencial en x." },
      p2: { type: "number", description: "Tangencial en y." },
    },
  },
};

/**
 * Escala (D9). `status` y `source` van juntos porque una escala absoluta sin
 * decir de dónde sale no se puede auditar, y una relativa con fuente
 * `EXTERNAL_MEASUREMENT` es una contradicción que conviene poder ver.
 */
const SCALE_FIELDS: ObjectSchema = {
  status: {
    type: '"UNKNOWN"|"RELATIVE"|"ABSOLUTE"',
    required: true,
    description: "Con status != ABSOLUTE, un presupuesto en unidades absolutas se rechaza.",
  },
  source: {
    type: '"NONE"|"KNOWN_DISTANCE"|"MARKER"|"CAMERA_PRIOR"|"EXTERNAL_MEASUREMENT"|"MANUAL"',
    required: true,
    description: "De dónde sale la escala.",
  },
  uncertainty: {
    type: "object",
    description: "Incertidumbre declarada; sin ella no se reporta precisión que nadie justifica.",
    fields: {
      model: {
        type: '"NONE"|"GAUSSIAN"|"INTERVAL"',
        required: true,
        description: "Qué modelo describe el valor.",
      },
      value: { type: "number", required: true, description: "Magnitud en la unidad de la escala." },
    },
  },
};

/** Una transformación del FrameGraph (D11): ninguna se hornea sin registrarla. */
const TRANSFORM_FIELDS: ObjectSchema = {
  from: {
    type: '"CAMERA"|"RECONSTRUCTION"|"ASSET_CANONICAL"|"PRODUCTION"',
    required: true,
    description: "Marco de origen.",
  },
  to: {
    type: '"CAMERA"|"RECONSTRUCTION"|"ASSET_CANONICAL"|"PRODUCTION"',
    required: true,
    description: "Marco de destino.",
  },
  matrix: {
    type: "number[]",
    required: true,
    description: "Dieciséis números, fila a fila, aplicados como columna a la derecha.",
  },
  reason: { type: "string", required: true, description: "Por qué existe esta transformación." },
  producer: { type: "string", required: true, description: "Quién la produjo." },
};

export const RECONSTRUCTION_PACKAGE_SCHEMA: ObjectSchema = {
  documentType: {
    type: '"videomesh.reconstruction-package"',
    required: true,
    description: "Qué documento es. Nunca un nombre suelto y ambiguo como `reconstruction` (D14).",
  },
  contractVersion: {
    type: "string",
    required: true,
    description: "Versión del contrato de frontera; 0.x mientras el contrato esté en DRAFT.",
  },
  contractSchemaSha256: {
    type: "string",
    description:
      "Hash del esquema con el que se escribió el paquete. Opcional mientras el contrato esté en " +
      "DRAFT; si viene y no está en el registro, el paquete no se interpreta (D16).",
  },
  packageId: {
    type: "string",
    required: true,
    description:
      "Identidad canónica del paquete. El nombre del directorio es comodidad humana " +
      "y no se usa para inferirla (D7).",
  },
  state: {
    type: '"WRITING"|"SEALED"',
    required: true,
    description: "Un paquete solo se consume SEALED; cualquier otro estado es PACKAGE_NOT_SEALED (D29).",
  },
  producer: {
    type: "object",
    required: true,
    description: "Quién escribió el paquete, para que el informe pueda decirlo.",
    fields: {
      name: { type: "string", required: true, description: "Nombre del productor." },
      version: { type: "string", required: true, description: "Versión del productor." },
    },
  },
  artifacts: {
    type: "object[]",
    required: true,
    description: "Ficheros del paquete, cada uno con su forma según el tipo.",
    variants: { on: "type", forms: ARTIFACT_VARIANTS },
  },
  cameras: {
    type: "object[]",
    description: "CameraSet canónico. Ausente es un paquete sin cámaras registradas, no un error.",
    fields: CAMERA_FIELDS,
  },
  scale: {
    type: "object",
    required: true,
    description: "Modelo de escala.",
    fields: SCALE_FIELDS,
  },
  frameGraph: {
    type: "object",
    required: true,
    description: "Transformaciones entre marcos, todas registradas.",
    fields: {
      transforms: {
        type: "object[]",
        required: true,
        description: "Cada arista del grafo, con su matriz y su motivo.",
        fields: TRANSFORM_FIELDS,
      },
    },
  },
  requiredEvidence: {
    type: "string[]",
    description:
      "Identidades de artifact que el contrato exige para certificar. " +
      "Faltar una da INCONCLUSIVE; faltar evidencia que nadie usa es irrelevante (D8).",
  },
};
