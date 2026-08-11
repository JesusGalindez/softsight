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

const LOFT_SECTION_FIELDS: ObjectSchema = {
  at: { type: "number[3]", required: true, description: "Dónde se coloca la sección." },
  profile: {
    type: "number[]|string",
    required: true,
    description:
      "Polígono en el plano XZ, pares x,z, o el nombre de un perfil declarado en `profiles`.",
  },
  scale: { type: "number|number[]", description: "Escala uniforme, o [sx, sz]; 1 por defecto." },
  twist: {
    type: "number",
    description: "Grados alrededor de Y, sobre el origen local del polígono; 0 por defecto.",
  },
};

const GEOMETRY_LOFT: ObjectSchema = {
  loft: {
    type: "object[]",
    required: true,
    description:
      "Secciones cosidas, al menos dos. Las secciones quedan paralelas al plano XZ y la pieza " +
      "crece a lo largo de Y; `at` puede además desplazarse en X y en Z.",
    fields: LOFT_SECTION_FIELDS,
  },
  samples: {
    type: "number",
    description:
      "Puntos por sección tras remuestrear por longitud de arco; el mayor de las secciones por defecto.",
  },
  caps: { type: '"both"|"none"|"start"|"end"', description: "Qué extremos se tapan; both por defecto." },
};

const PATH_FIELDS: ObjectSchema = {
  through: {
    type: "object[]",
    required: true,
    description: "Puntos de tres números por los que pasa el recorrido; al menos dos.",
  },
  kind: {
    type: '"catmull-rom"|"polyline"',
    description: "catmull-rom por defecto, centrípeta; polyline une los puntos con rectas.",
  },
  closed: { type: "boolean", description: "Si el recorrido se cierra sobre sí mismo." },
};

const GEOMETRY_SWEEP: ObjectSchema = {
  sweep: {
    type: "number[]|string",
    required: true,
    description:
      "Polígono en el plano XZ, pares x,z, o el nombre de un perfil declarado en `profiles`.",
  },
  path: { type: "object", required: true, description: "Recorrido del barrido.", fields: PATH_FIELDS },
  // Sin `fields`: el valor puede ser un número, y `validate` aplicaría el esquema
  // de objeto también a él. La forma de la tabla —`at` en orden y `ease` conocido—
  // la comprueba `evaluateVariation`, que es quien la lee y quien puede decir cuál
  // de los pares rompe el orden.
  radius: {
    type: "number|object",
    description:
      "Multiplica el perfil en cada estación. Número constante, o tabla { at: [[u, valor], …], " +
      "ease: linear|smooth|power:k }. 1 por defecto.",
  },
  twist: {
    type: "number|object",
    description:
      "Grados alrededor de la tangente. Número constante o la misma tabla que radius. 0 por defecto.",
  },
  stations: { type: "number", description: "Estaciones a lo largo del recorrido; 24 por defecto." },
  caps: {
    type: '"both"|"none"|"start"|"end"',
    description: "Qué extremos se tapan; both por defecto. Un recorrido cerrado no tiene extremos.",
  },
};

const GEOMETRY_REVOLVE: ObjectSchema = {
  revolve: {
    type: "number[]",
    required: true,
    description: "Perfil en pares radio,altura, girado alrededor de Y. Radio cero cierra en polo.",
  },
  segments: { type: "number", description: "Divisiones alrededor del eje; 32 por defecto." },
};

/**
 * Las cuatro deformaciones, planas y opcionales por lo mismo que los generadores
 * de perfil: `anyOf` se aplica a un campo y no a los elementos de una lista. Que
 * haya exactamente una por entrada lo exige el resolutor.
 */
const DEFORM_FIELDS: ObjectSchema = {
  twist: {
    type: "object",
    description:
      "{ axis, degrees } — gira alrededor del eje, proporcionalmente al recorrido. " +
      "degrees admite número o tabla { at, ease }.",
  },
  taper: {
    type: "object",
    description:
      "{ axis, scale } — escala las dos coordenadas que no son la del eje. " +
      "scale admite número o tabla.",
  },
  bend: {
    type: "object",
    description: "{ axis, into, degrees } — dobla el eje sobre un arco hacia `into`, que no puede ser el eje.",
  },
  wave: {
    type: "object",
    description:
      "{ axis, along, amplitude, cycles, phase } — ondula desplazando a lo largo de `along`, " +
      "que no puede ser el eje. amplitude admite número o tabla.",
  },
};

const RADIAL_FIELDS: ObjectSchema = {
  count: { type: "number", required: true, description: "Copias; entero de 2 en adelante." },
  axis: { type: '"x"|"y"|"z"', description: "Eje alrededor del que se reparten; y por defecto." },
};

/** `radial` y `mirror` son excluyentes, y eso lo exige el resolutor. */
const REPEAT_FIELDS: ObjectSchema = {
  radial: {
    type: "object",
    description: "Copias alrededor de un eje, a ángulos exactos de 2πi/count.",
    fields: RADIAL_FIELDS,
  },
  mirror: { type: '"x"|"y"|"z"', description: "Una copia reflejada en este eje." },
  about: {
    type: "number[3]",
    description:
      "Punto por el que pasa el eje de giro, o el plano del espejo; el origen por defecto. " +
      "Sin él, un rotor solo se puede poner sobre el eje del mundo.",
  },
};

const OBJECT_FIELDS: ObjectSchema = {
  name: { type: "string", description: "Nombre de la pieza; si falta, `objetoN`." },
  repeat: {
    type: "object",
    description:
      "Copias de la pieza, aplicadas después de `deform`. La pieza pasa a llamarse `nombre-1` … " +
      "`nombre-n`. Solo tiene efecto por el camino de escena.",
    fields: REPEAT_FIELDS,
  },
  deform: {
    type: "object[]",
    description:
      "Deformaciones en el orden en que se aplican, sobre la malla ya generada y antes de la " +
      "matriz. El orden importa: torcer y luego doblar no es doblar y luego torcer.",
    fields: DEFORM_FIELDS,
  },
  geometry: {
    type: "object",
    required: true,
    description:
      "Primitiva con parámetros, malla cruda con sus arrays, extrusión de un polígono, " +
      "revolucionado de un perfil, loft de secciones cosidas o barrido de un perfil por un recorrido.",
    anyOf: [
      GEOMETRY_PRIMITIVE,
      GEOMETRY_RAW,
      GEOMETRY_EXTRUDE,
      GEOMETRY_REVOLVE,
      GEOMETRY_LOFT,
      GEOMETRY_SWEEP,
    ],
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

const BLEND_FIELDS: ObjectSchema = {
  with: {
    type: "string",
    required: true,
    description: "El otro hueso del reparto. Debe existir y no puede ser el de la regla.",
  },
  from: {
    type: "number",
    required: true,
    description:
      "Dónde empieza la banda, en unidades del segmento entre los dos huesos: 0 es el hueso de la " +
      "regla y 1 es `with`. Se sale del rango a propósito cuando la costura cae fuera.",
  },
  to: {
    type: "number",
    required: true,
    description: "Dónde acaba. Mayor que `from`. Después de aquí, todo el peso es de `with`.",
  },
  ease: {
    type: "string",
    description: "linear (por defecto), smooth o power:k. La misma tabla que la forma y el movimiento.",
  },
};

const BINDING_FIELDS: ObjectSchema = {
  part: { type: "string", required: true, description: "Patrón de pieza, como --select: `rotor-*`." },
  joint: { type: "string", required: true, description: "Hueso al que se ata. Debe existir." },
  blend: {
    type: "object|object[]",
    description:
      "Reparto del peso con otro hueso alrededor de la articulación, o una lista si la pieza tiene " +
      "costura por más de un sitio —el antebrazo la tiene en el codo y en la muñeca—. Tres como " +
      "mucho: glTF escribe cuatro influencias por vértice y una es siempre `joint`. Pueden " +
      "solaparse, pero entre todas no pueden llevarse más de 1. Sin esto el atado es rígido, " +
      "peso 1 sobre `joint`, que para una pieza rígida de verdad es la respuesta exacta.",
    fields: BLEND_FIELDS,
  },
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
  keys: {
    type: "object[]",
    description: "Fotogramas clave escritos a mano. Excluyente con `value`.",
    fields: KEY_FIELDS,
  },
  value: {
    type: "object",
    description:
      "La pista como función declarada: { at: [[u, [valores]], …], ease } con la misma curva que " +
      "la geometría —linear, smooth, power:k—. Necesita `frames` y se hornea a claves. " +
      "La rotación va en 3 grados Y·X·Z; el cuaternión solo cabe en `keys`.",
  },
  frames: { type: "number", description: "Cuánto dura la pista declarada con `value`, en fotogramas." },
  bake: {
    type: "number",
    description: "Claves a emitir al hornear: bake + 1. Una por fotograma por defecto.",
  },
  turns: {
    type: "number",
    description:
      "Vueltas completas alrededor de `axis` en `frames` fotogramas; negativo, al revés. Solo en " +
      "rotation, excluyente con keys y value. Hornea a 90° por clave como mucho, porque el " +
      "muestreador de glTF interpola por el arco más corto.",
  },
  axis: { type: '"x"|"y"|"z"', description: "Eje de `turns`; y por defecto." },
  cycle: {
    type: "number",
    description:
      "Repeticiones del contenido de la pista, una detrás de otra. Con `turns` sobra: las vueltas " +
      "ya se cuentan con ese número.",
  },
  offsetFrames: {
    type: "number",
    description:
      "Desfase en fotogramas del ciclo, tratando la pista como periódica: lo que sale por el final " +
      "vuelve a entrar por el principio. Solo con `value`.",
  },
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
export function closeEnough(typo: string, candidate: string): boolean {
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
 * El mismo esquema, en JSON Schema.
 *
 * Existe porque un servidor MCP publica los parámetros de cada herramienta en
 * JSON Schema y el runtime del cliente los valida **antes** de llamar. Escribir
 * esas tablas a mano sería un segundo original de la forma de la escena, del
 * parche y del guion, y divergiría en la primera bandera nueva. Se traduce.
 *
 * El vocabulario de `type` que se traduce aquí es exactamente el que reconoce
 * `typeMatches` —de ahí que las dos funciones estén una al lado de la otra—: si
 * alguien añade una forma allí y no aquí, el esquema publicado deja de describir
 * lo que se valida.
 */
export function toJsonSchema(schema: ObjectSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(schema)) {
    properties[name] = fieldToJsonSchema(field);
    if (field.required === true) required.push(name);
  }
  const object: Record<string, unknown> = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) object.required = required;
  return object;
}

function fieldToJsonSchema(field: FieldSchema): Record<string, unknown> {
  const alternatives = field.type.split("|").map((alternative) => alternative.trim());
  const literals = alternatives.filter((alternative) => alternative.startsWith('"'));
  const shapes: Record<string, unknown>[] = [];

  if (literals.length > 0) {
    shapes.push({ type: "string", enum: literals.map((literal) => literal.slice(1, -1)) });
  }
  for (const alternative of alternatives) {
    if (alternative.startsWith('"')) continue;
    if (alternative === "number" || alternative === "string" || alternative === "boolean") {
      shapes.push({ type: alternative });
    } else if (alternative === "number[]") {
      shapes.push({ type: "array", items: { type: "number" } });
    } else if (alternative === "number[3]") {
      shapes.push({ type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 });
    } else if (alternative === "object") {
      shapes.push(field.fields !== undefined ? toJsonSchema(field.fields) : { type: "object" });
    } else if (alternative === "object[]") {
      shapes.push({
        type: "array",
        items: field.fields !== undefined ? toJsonSchema(field.fields) : { type: "object" },
      });
    }
  }

  // `anyOf` del esquema son formas alternativas del mismo campo —una geometría es
  // primitiva, o cruda, o extrusión—, así que entran como alternativas más.
  for (const alternative of field.anyOf ?? []) shapes.push(toJsonSchema(alternative));

  const shape = shapes.length === 1 ? shapes[0] : { anyOf: shapes };
  return { ...shape, description: field.description };
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
      // Por el valor y no por el tipo declarado: un campo que admite las dos
      // formas —`object|object[]`, como la banda de un vínculo— llega unas veces
      // suelto y otras en lista, y decidir por la cadena del tipo le daría la
      // ruta equivocada a la mitad de los errores.
      const isList = Array.isArray(record[field]);
      const children = isList ? (record[field] as unknown[]) : [record[field]];
      children.forEach((child, index) => {
        const childPath = isList ? `${here}[${index}]` : here;
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
