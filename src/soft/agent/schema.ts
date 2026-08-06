/**
 * La forma de lo que la herramienta acepta, como datos.
 *
 * Un agente que no escribió esto tiene hoy dos caminos: adivinar el JSON o leerse
 * `sceneSpec.ts`. Publicar el esquema es lo que abre la herramienta a otro agente.
 *
 * La tentación es escribirlo a mano en la ayuda, y entonces divergiría del código en
 * el primer campo que se añada. Aquí el esquema **es** lo que valida la entrada: si
 * alguien añade un campo al resolutor sin ponerlo aquí, el campo se rechaza y el
 * fallo sale a la primera. Una fuente, no dos.
 *
 * La validación no es exhaustiva a propósito. Comprueba lo que un agente falla de
 * verdad —campos inventados, campos que faltan, un número donde iba una lista— y no
 * rangos ni coherencia geométrica, que ya audita el informe con mucho más criterio.
 */

export interface FieldSchema {
  /** `number`, `string`, `boolean`, `number[]`, `object`, `object[]`, o una unión `"a"|"b"`. */
  type: string;
  required?: boolean;
  description: string;
  /** Esquema de cada elemento, para `object` y `object[]`. */
  fields?: Record<string, FieldSchema>;
  /** Formas alternativas admitidas; vale con que encaje una. */
  anyOf?: Array<Record<string, FieldSchema>>;
}

export type ObjectSchema = Record<string, FieldSchema>;

const VECTOR3 = "number[3]";

const GEOMETRY_PRIMITIVE: ObjectSchema = {
  primitive: {
    type: '"box"|"sphere"|"torus"|"plane"|"cylinder"|"cone"',
    required: true,
    description: "Primitiva a generar.",
  },
  parameters: {
    type: "number[]",
    description:
      "box: [ancho, alto, profundo]; sphere: [radio]; torus: [mayor, menor]; " +
      "plane: [lado, subdivisiones]; cylinder: [radio, alto]; cone: [radio, alto].",
  },
};

const GEOMETRY_RAW: ObjectSchema = {
  positions: { type: "number[]", required: true, description: "Posiciones intercaladas x,y,z." },
  indices: { type: "number[]", description: "Índices de triángulo; si falta, tira secuencial." },
  normals: { type: "number[]", description: "Normales intercaladas; si faltan, se promedian." },
  uvs: { type: "number[]", description: "UVs intercaladas; si faltan, quedan a cero." },
};

const GEOMETRY_EXTRUDE: ObjectSchema = {
  extrude: {
    type: "number[]|string",
    required: true,
    description:
      "Polígono en el plano XZ, pares x,z —cóncavo admitido y sin agujeros—, o el nombre " +
      "de un perfil declarado en `profiles`.",
  },
  height: { type: "number", description: "Altura de la extrusión; 1 por defecto." },
};

/**
 * Los cuatro generadores van planos y opcionales, no en un campo con `anyOf`,
 * porque `anyOf` se aplica a un campo y no a los elementos de una lista. Que haya
 * exactamente uno lo exige el resolutor, diciendo cuáles encontró.
 */
const PROFILE_FIELDS: ObjectSchema = {
  name: { type: "string", required: true, description: "Nombre del perfil; identifica, así que es único." },
  circle: { type: "number", description: "Círculo de este radio." },
  superellipse: { type: "number[]", description: "[a, b, exponente]; con exponente 2 es una elipse." },
  gielis: {
    type: "number[]",
    description: "Superfórmula de Gielis [m, n1, n2, n3], con a y b opcionales detrás.",
  },
  naca: { type: "string", description: 'Perfil aerodinámico de cuatro dígitos, como "2412".' },
  points: { type: "number", description: "Puntos del polígono; 32, o 64 en gielis y naca." },
  chord: { type: "number", description: "Cuerda del naca; 1 por defecto." },
  radius: { type: "number", description: "Multiplicador del radio de gielis; 1 por defecto." },
};

const GEOMETRY_REVOLVE: ObjectSchema = {
  revolve: {
    type: "number[]",
    required: true,
    description: "Perfil en pares radio,altura, girado alrededor de Y. Radio cero cierra en polo.",
  },
  segments: { type: "number", description: "Divisiones alrededor del eje; 32 por defecto." },
};

const OBJECT_FIELDS: ObjectSchema = {
  name: { type: "string", description: "Nombre de la pieza; si falta, `objetoN`." },
  geometry: {
    type: "object",
    required: true,
    description:
      "Primitiva con parámetros, malla cruda con sus arrays, extrusión de un polígono " +
      "o revolucionado de un perfil.",
    anyOf: [GEOMETRY_PRIMITIVE, GEOMETRY_RAW, GEOMETRY_EXTRUDE, GEOMETRY_REVOLVE],
  },
  matrix: {
    type: "number[]",
    description: "Colocación exacta, 16 números en fila; manda sobre position, rotation y scale.",
  },
  position: { type: VECTOR3, description: "Traslación en unidades del fichero." },
  rotation: { type: VECTOR3, description: "Rotación en grados, orden Y·X·Z." },
  scale: { type: "number|number[3]", description: "Escala uniforme o por eje." },
  color: { type: VECTOR3, description: "Albedo en 0..1." },
  specular: { type: "number", description: "Intensidad especular; 0,3 por defecto." },
  shininess: { type: "number", description: "Exponente especular; 48 por defecto." },
};

const BUDGET_FIELDS: ObjectSchema = {
  triangles: { type: "number", description: "Triángulos como máximo." },
  parts: { type: "number", description: "Piezas como máximo." },
  boundaryEdges: { type: "number", description: "Aristas de borde sumadas, como máximo." },
  degenerateTriangles: { type: "number", description: "Triángulos de área nula, como máximo." },
  symmetryError: { type: "number", description: "Error de simetría en X, en fracción del radio." },
  watertight: { type: "boolean", description: "Exige que todas las mallas estén cerradas." },
};

const JOINT_FIELDS: ObjectSchema = {
  name: { type: "string", required: true, description: "Nombre del hueso; identifica, así que es único." },
  parent: { type: "string", description: "Nombre del hueso del que cuelga. Sin él, es raíz." },
  offset: { type: VECTOR3, description: "Desplazamiento respecto al padre. Cero por defecto." },
};

const SKELETON_FIELDS: ObjectSchema = {
  joints: {
    type: "object[]",
    required: true,
    description: "Huesos del esqueleto; se referencian por nombre, nunca por índice.",
    fields: JOINT_FIELDS,
  },
};

const BINDING_FIELDS: ObjectSchema = {
  part: { type: "string", required: true, description: "Patrón de pieza, como --select: `rotor-*`." },
  joint: { type: "string", required: true, description: "Hueso al que se ata. Debe existir." },
};

const KEY_FIELDS: ObjectSchema = {
  frame: { type: "number", required: true, description: "Fotograma; en orden creciente y sin repetir." },
  value: {
    type: "number[]",
    required: true,
    description:
      "translation y scale: 3 números. rotation: 3 grados en orden Y·X·Z, o 4 del cuaternión x,y,z,w.",
  },
};

const TRACK_FIELDS: ObjectSchema = {
  joint: { type: "string", required: true, description: "Hueso que anima esta pista." },
  property: {
    type: '"translation"|"rotation"|"scale"',
    required: true,
    description: "Qué se anima del hueso.",
  },
  interpolation: { type: '"linear"|"step"', description: "linear por defecto." },
  keys: { type: "object[]", required: true, description: "Fotogramas clave.", fields: KEY_FIELDS },
};

const CLIP_FIELDS: ObjectSchema = {
  name: { type: "string", description: "Nombre del clip; `clipN` si falta." },
  fps: { type: "number", description: "Fotogramas por segundo con los que se leen los `frame`; 30." },
  tracks: { type: "object[]", required: true, description: "Pistas del clip.", fields: TRACK_FIELDS },
};

export const SCENE_SCHEMA: ObjectSchema = {
  objects: {
    type: "object[]",
    required: true,
    description: "Piezas de la escena; al menos una.",
    fields: OBJECT_FIELDS,
  },
  profiles: {
    type: "object[]",
    description:
      "Catálogo de perfiles con nombre, usados desde la geometría. Uno declarado y no usado " +
      "no es error.",
    fields: PROFILE_FIELDS,
  },
  budget: {
    type: "object",
    description: "Contrato que la escena debe cumplir; cada cláusula incumplida es un aviso.",
    fields: BUDGET_FIELDS,
  },
  skeleton: {
    type: "object",
    description:
      "Huesos que animarán las piezas. Declararlo no calcula pesos: el atado es rígido y el " +
      "vínculo lo dices tú en `bindings`.",
    fields: SKELETON_FIELDS,
  },
  bindings: {
    type: "object[]",
    description:
      "Qué pieza va a qué hueso. Gana la primera regla que encaja; una pieza sin regla es un " +
      "error, no se ata a la raíz por si acaso. Obligatorio si hay `skeleton`.",
    fields: BINDING_FIELDS,
  },
  clips: {
    type: "object[]",
    description: "Animaciones sobre los huesos declarados.",
    fields: CLIP_FIELDS,
  },
};

/**
 * El vocabulario narrativo, aquí y en ningún otro sitio: de esta lista sale el
 * tipo que valida `role` y la tabla de campos que exige cada rol. Escribir la
 * unión a mano garantizaría que un rol nuevo entrase por un lado y no por el
 * otro.
 *
 * Es corta a propósito. Con roles para describir cualquier cosa, ninguno
 * significa nada y la auditoría de estructura no puede decir si falta un cierre.
 */
export const SCENE_ROLES = ["apertura", "desarrollo", "giro", "cierre"] as const;

export type SceneRole = (typeof SCENE_ROLES)[number];

const STORY_SCENE_FIELDS: ObjectSchema = {
  name: { type: "string", required: true, description: "Nombre de la escena; identifica, así que es único." },
  role: {
    type: SCENE_ROLES.map((role) => `"${role}"`).join("|"),
    required: true,
    description: "Papel narrativo. Decide qué campos de data hacen falta y cómo se pone en escena.",
  },
  durationFrames: {
    type: "number",
    required: true,
    description:
      "Frames que dura. Las escenas van seguidas desde el frame 0, así que el inicio no se declara: " +
      "se deduce, y la duración de la composición es la suma.",
  },
  data: {
    type: "object",
    required: true,
    description:
      "Lo que cuenta la escena, en texto: `line` siempre, y `headline` además en apertura y giro. " +
      "Campos de más se admiten; son datos, no maqueta.",
  },
};

export const STORY_SCHEMA: ObjectSchema = {
  storyVersion: { type: "number", required: true, description: "Versión del contrato del guion; hoy 1." },
  title: { type: "string", required: true, description: "Título de la pieza." },
  fps: { type: "number", required: true, description: "Fotogramas por segundo con los que se leen las duraciones." },
  scenes: {
    type: "object[]",
    required: true,
    description: "Escenas en el orden en que se ven; al menos una.",
    fields: STORY_SCENE_FIELDS,
  },
};

/**
 * Contrato del informe de puesta en escena: lo que el editor mide y SoftSight
 * audita. Se publica aquí para que quien lo produzca no lo escriba de oído — es
 * el mismo trato que con la escena y con el guion.
 */
const STAGED_LAYER_FIELDS: ObjectSchema = {
  id: { type: "string", required: true, description: "Identificador de la capa dentro de la escena." },
  kind: {
    type: '"text"|"model"|"image"|"shape"|"particles"',
    required: true,
    description: "Qué clase de capa es. Solo el texto se juzga por caja y contraste.",
  },
  visible: {
    type: "boolean",
    required: true,
    description:
      "Si aporta algo visible en el frame de muestra. Lo decide quien monta: «poco visible» es criterio, no medida.",
  },
  box: {
    type: "number[4]",
    description:
      "Caja en píxeles del cuadro, [x0, y0, x1, y1]. Obligatoria en un texto visible. Sale de la proyección, no de rasterizar.",
  },
  color: { type: "number[3]", description: "Color del texto en sRGB 0..1. Obligatorio en un texto visible." },
  backgroundColor: {
    type: "number[3]",
    description:
      "Color medio del fondo bajo la caja, medido sobre el frame. Obligatorio en un texto visible.",
  },
};

const STAGED_SCENE_FIELDS: ObjectSchema = {
  name: { type: "string", required: true, description: "Nombre de la escena; único en la pieza." },
  startFrame: { type: "number", required: true, description: "Primer frame de la escena." },
  durationFrames: { type: "number", required: true, description: "Duración en frames, mayor que cero." },
  sampleFrame: {
    type: "number",
    required: true,
    description: "Frame en el que se midieron colores y cajas; tiene que caer dentro de la escena.",
  },
  layers: {
    type: "object[]",
    required: true,
    description: "Capas colocadas, aunque la lista esté vacía: una escena vacía es un aviso, no un error.",
    fields: STAGED_LAYER_FIELDS,
  },
};

export const STAGING_SCHEMA: ObjectSchema = {
  stagingVersion: { type: "number", required: true, description: "Versión del contrato de la puesta en escena; hoy 1." },
  title: { type: "string", description: "Título de la pieza, si lo trae." },
  frame: {
    type: "object",
    required: true,
    description: "Tamaño del cuadro en píxeles: es lo que define qué queda fuera.",
    fields: {
      width: { type: "number", required: true, description: "Ancho en píxeles." },
      height: { type: "number", required: true, description: "Alto en píxeles." },
    },
  },
  scenes: {
    type: "object[]",
    required: true,
    description: "Escenas montadas, en orden; al menos una.",
    fields: STAGED_SCENE_FIELDS,
  },
};

const EDIT_FIELDS: ObjectSchema = {
  op: {
    type: '"add"|"translate"|"rotate"|"scale"|"color"|"hide"|"show"|"delete"|"rename"|"align"|"setPivot"|"mirror"|"instance"',
    required: true,
    description: "Operación a aplicar.",
  },
  target: {
    type: "string",
    description:
      "Nombre o ruta, con `*` como comodín. Obligatorio salvo en `add`. Sin coincidencias es un error, no un aviso.",
  },
  object: {
    type: "object",
    description: "add: la pieza a añadir, descrita igual que en una escena.",
    fields: OBJECT_FIELDS,
  },
  delta: { type: VECTOR3, description: "translate: desplazamiento." },
  degrees: { type: VECTOR3, description: "rotate: grados por eje, alrededor del origen de la pieza." },
  factor: { type: "number|number[3]", description: "scale: factor uniforme o por eje." },
  rgb: { type: VECTOR3, description: "color: albedo en 0..1." },
  to: {
    type: 'string|number[3]',
    description:
      "rename: nombre nuevo, con el patrón coincidiendo con una sola pieza. " +
      "align: pieza contra la que pegarse. setPivot: origen nuevo en local, centro por defecto.",
  },
  axis: { type: '"x"|"y"|"z"', description: "align: eje por el que mover; mirror: plano de reflexión." },
  gap: { type: "number", description: "align: separación que se deja, cero por defecto." },
};

export const PATCH_SCHEMA: ObjectSchema = {
  edits: {
    type: "object[]",
    required: true,
    description: "Operaciones, aplicadas en orden.",
    fields: EDIT_FIELDS,
  },
};

export const SAMPLE_REFERENCE_SCHEMA: ObjectSchema = {
  mesh: {
    type: "string",
    required: true,
    description: "Nombre de la malla: el suyo o el del primer nodo que la instancia.",
  },
  primitive: {
    type: "number",
    required: true,
    description: "Índice de la primitiva dentro de la malla.",
  },
  triangle: {
    type: "number",
    required: true,
    description: "Índice del triángulo en el búfer de índices de la primitiva.",
  },
  barycentric: {
    type: "number[]",
    required: true,
    description: "Pesos del punto dentro del triángulo; dos o tres valores no negativos que sumen 1 (el tercero se puede omitir).",
  },
};

/** Distancia de edición acotada: solo sirve para sugerir el campo que se quiso escribir. */
function closeEnough(typo: string, candidate: string): boolean {
  if (Math.abs(typo.length - candidate.length) > 2) return false;
  const a = typo.toLowerCase();
  const b = candidate.toLowerCase();
  if (a === b) return true;
  let distance = 0;
  let indexA = 0;
  let indexB = 0;
  while (indexA < a.length && indexB < b.length) {
    if (a[indexA] === b[indexB]) {
      indexA += 1;
      indexB += 1;
      continue;
    }
    distance += 1;
    if (distance > 2) return false;
    if (a.length > b.length) indexA += 1;
    else if (b.length > a.length) indexB += 1;
    else {
      indexA += 1;
      indexB += 1;
    }
  }
  return distance + (a.length - indexA) + (b.length - indexB) <= 2;
}

function typeMatches(value: unknown, type: string): boolean {
  for (const alternative of type.split("|")) {
    const expected = alternative.trim();
    if (expected.startsWith('"')) {
      if (value === expected.slice(1, -1)) return true;
      continue;
    }
    if (expected === "number" && typeof value === "number") return true;
    if (expected === "string" && typeof value === "string") return true;
    if (expected === "boolean" && typeof value === "boolean") return true;
    if (expected === "number[]" && Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
      return true;
    }
    if (expected === "number[3]") {
      if (Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number")) {
        return true;
      }
      continue;
    }
    if ((expected === "object" || expected === "object[]") && typeof value === "object" && value !== null) {
      if (expected === "object[]" && !Array.isArray(value)) continue;
      if (expected === "object" && Array.isArray(value)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Errores de forma, todos de una vez.
 *
 * De una vez y no el primero: cada llamada le cuesta un turno al agente, y devolverle
 * los fallos de uno en uno multiplica los turnos por el número de erratas.
 */
export function validate(value: unknown, schema: ObjectSchema, path = ""): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${path || "la raíz"} debe ser un objeto`];
  }
  const record = value as Record<string, unknown>;

  for (const [field, definition] of Object.entries(schema)) {
    const here = path ? `${path}.${field}` : field;
    if (record[field] === undefined) {
      if (definition.required) errors.push(`falta ${here} (${definition.type})`);
      continue;
    }
    if (!typeMatches(record[field], definition.type)) {
      errors.push(`${here} debe ser ${definition.type}`);
      continue;
    }
    if (definition.fields !== undefined) {
      const children = definition.type === "object[]" ? (record[field] as unknown[]) : [record[field]];
      children.forEach((child, index) => {
        const childPath = definition.type === "object[]" ? `${here}[${index}]` : here;
        errors.push(...validate(child, definition.fields as ObjectSchema, childPath));
      });
    }
    if (definition.anyOf !== undefined) {
      const attempts = definition.anyOf.map((alternative) => validate(record[field], alternative, here));
      if (attempts.every((attempt) => attempt.length > 0)) {
        // El menos equivocado es el que el agente estaba intentando escribir.
        const closest = attempts.reduce((best, attempt) =>
          attempt.length < best.length ? attempt : best,
        );
        errors.push(...closest);
      }
    }
  }

  for (const field of Object.keys(record)) {
    if (schema[field] !== undefined) continue;
    const here = path ? `${path}.${field}` : field;
    const suggestion = Object.keys(schema).find((candidate) => closeEnough(field, candidate));
    errors.push(
      suggestion !== undefined
        ? `${here} no existe; ¿querías decir ${suggestion}?`
        : `${here} no existe; admitidos: ${Object.keys(schema).join(", ")}`,
    );
  }

  return errors;
}

/** Lanza con todos los errores juntos, o no lanza. */
export function assertValid(value: unknown, schema: ObjectSchema, what: string): void {
  const errors = validate(value, schema);
  if (errors.length === 0) return;
  throw new Error(`${what} no encaja con el esquema:\n  - ${errors.join("\n  - ")}`);
}
