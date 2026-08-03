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

const OBJECT_FIELDS: ObjectSchema = {
  name: { type: "string", description: "Nombre de la pieza; si falta, `objetoN`." },
  geometry: {
    type: "object",
    required: true,
    description: "Primitiva con parámetros, o malla cruda con sus arrays.",
    anyOf: [GEOMETRY_PRIMITIVE, GEOMETRY_RAW],
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

export const SCENE_SCHEMA: ObjectSchema = {
  objects: {
    type: "object[]",
    required: true,
    description: "Piezas de la escena; al menos una.",
    fields: OBJECT_FIELDS,
  },
  budget: {
    type: "object",
    description: "Contrato que la escena debe cumplir; cada cláusula incumplida es un aviso.",
    fields: BUDGET_FIELDS,
  },
};

const EDIT_FIELDS: ObjectSchema = {
  op: {
    type: '"add"|"translate"|"rotate"|"scale"|"color"|"hide"|"show"|"delete"|"rename"',
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
  to: { type: "string", description: "rename: nombre nuevo; el patrón debe coincidir con una sola pieza." },
};

export const PATCH_SCHEMA: ObjectSchema = {
  edits: {
    type: "object[]",
    required: true,
    description: "Operaciones, aplicadas en orden.",
    fields: EDIT_FIELDS,
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
