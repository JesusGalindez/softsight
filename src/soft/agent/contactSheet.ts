/**
 * Pliego de contactos: seis vistas del objeto en una sola imagen.
 *
 * Un agente paga un viaje de ida y vuelta por cada imagen que mira. Seis
 * peticiones de una vista cada una cuestan seis turnos; una imagen con las seis
 * vistas cuesta uno, y además permite comparar entre ellas en la misma mirada,
 * que es donde se ven los errores de forma. Por eso el pliego, y no un
 * renderizado suelto, es la unidad de realimentación.
 *
 * Las vistas están elegidas por lo que revela cada una:
 *   - 3/4 iluminada  : forma general, la vista que un humano pediría
 *   - frontal/lateral/superior ortográficas : proporciones y alineación, sin que
 *     la perspectiva falsee las medidas
 *   - normales       : orientación de superficie; una normal invertida salta a
 *     la vista como un parche de color complementario
 *   - wireframe      : densidad de malla y triángulos degenerados
 */

import { drawLabel } from "./bitmapFont";
import { mat4, multiply, transformPoint, vec3, type Vec4 } from "../math";
import { lookAt, ndcToScreenX, ndcToScreenY, orthographic, perspective } from "../projection";
import { CullMode } from "../raster";
import {
  cloneStats,
  SoftwareRenderer,
  type Camera,
  type FrameStats,
  type RenderOptions,
  type SceneNode,
} from "../renderer";

export interface ViewDefinition {
  name: string;
  /** Grados alrededor de Y, medidos desde el eje +Z. */
  yaw: number;
  /** Grados sobre el horizonte. */
  pitch: number;
  projection: "perspective" | "orthographic";
  shading: RenderOptions["shadingMode"];
  wireframe?: boolean;
}

export const DEFAULT_VIEWS: ViewDefinition[] = [
  { name: "3/4 iluminada", yaw: 35, pitch: 22, projection: "perspective", shading: "lit" },
  { name: "frontal", yaw: 0, pitch: 0, projection: "orthographic", shading: "lit" },
  { name: "lateral", yaw: 90, pitch: 0, projection: "orthographic", shading: "lit" },
  { name: "superior", yaw: 0, pitch: 88, projection: "orthographic", shading: "lit" },
  { name: "normales", yaw: 35, pitch: 22, projection: "perspective", shading: "normals" },
  { name: "wireframe", yaw: 35, pitch: 22, projection: "perspective", shading: "lit", wireframe: true },
];

export interface SceneBounds {
  center: [number, number, number];
  radius: number;
}

/**
 * Esfera envolvente de la escena en espacio de mundo, a partir de las esferas de
 * cada objeto: centro de la caja que las contiene, y radio como la distancia
 * máxima a cualquier superficie. No es la esfera mínima —esa es un problema de
 * optimización— pero es una cota superior ajustada, y para encuadrar sobra.
 */
export function computeSceneBounds(nodes: readonly SceneNode[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const centers: Array<[number, number, number, number]> = [];
  for (const node of nodes) {
    const model = node.model;
    const cx = model[3];
    const cy = model[7];
    const cz = model[11];
    const scaleX = Math.hypot(model[0], model[4], model[8]);
    const scaleY = Math.hypot(model[1], model[5], model[9]);
    const scaleZ = Math.hypot(model[2], model[6], model[10]);
    const radius = node.mesh.boundingRadius * Math.max(scaleX, scaleY, scaleZ);
    centers.push([cx, cy, cz, radius]);
    if (cx - radius < minX) minX = cx - radius;
    if (cy - radius < minY) minY = cy - radius;
    if (cz - radius < minZ) minZ = cz - radius;
    if (cx + radius > maxX) maxX = cx + radius;
    if (cy + radius > maxY) maxY = cy + radius;
    if (cz + radius > maxZ) maxZ = cz + radius;
  }

  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  let radius = 0;
  for (const [cx, cy, cz, nodeRadius] of centers) {
    const distance = Math.hypot(cx - center[0], cy - center[1], cz - center[2]) + nodeRadius;
    if (distance > radius) radius = distance;
  }

  return { center, radius: radius > 0 ? radius : 1 };
}

const DEGREES_TO_RADIANS = Math.PI / 180;

export interface SceneAabb {
  min: [number, number, number];
  max: [number, number, number];
}

/** Caja envolvente exacta en espacio de mundo, vértice a vértice. */
export function computeSceneAabb(
  nodes: readonly Pick<SceneNode, "mesh" | "model">[],
): SceneAabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const node of nodes) {
    const { positions } = node.mesh;
    const m = node.model;
    for (let offset = 0; offset < positions.length; offset += 3) {
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      const wx = m[0] * x + m[1] * y + m[2] * z + m[3];
      const wy = m[4] * x + m[5] * y + m[6] * z + m[7];
      const wz = m[8] * x + m[9] * y + m[10] * z + m[11];
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
    }
  }

  if (minX > maxX) return { min: [-1, -1, -1], max: [1, 1, 1] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Encuadre ajustado por caja proyectada.
 *
 * La esfera envolvente encuadra fatal cualquier objeto que no sea compacto: el dron
 * de prueba tiene 1,7 m de envergadura y 25 cm de alto, y su esfera de radio 6,4
 * dejaba el objeto en el 9 % del tile. La caja no tiene ese problema, pero hay que
 * medirla **en la base de la cámara**, no en los ejes del mundo: se proyectan las
 * ocho esquinas sobre los tres vectores de la cámara y se obtienen las semi-extensiones
 * reales en horizontal, vertical y profundidad. Luego
 *
 *   d = max( h_vertical / tan(fov/2), h_horizontal / (tan(fov/2) · aspecto) ) + h_profundidad
 *
 * es la distancia mínima a la que el objeto entero cabe: el máximo de las dos
 * restricciones, más la mitad de su fondo para que la parte cercana no se salga.
 */
export function frameCameraFromAabb(
  aabb: SceneAabb,
  view: ViewDefinition,
  fovYDegrees = 40,
  margin = 1.1,
  aspect = 1,
): Camera {
  const center: [number, number, number] = [
    (aabb.min[0] + aabb.max[0]) / 2,
    (aabb.min[1] + aabb.max[1]) / 2,
    (aabb.min[2] + aabb.max[2]) / 2,
  ];

  const yaw = view.yaw * DEGREES_TO_RADIANS;
  const pitch = view.pitch * DEGREES_TO_RADIANS;
  // Vector del centro hacia la cámara; coincide con el «forward» de `lookAt`.
  const forward: [number, number, number] = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ];
  const worldUp: [number, number, number] = [0, 1, 0];
  let right: [number, number, number] = [
    worldUp[1] * forward[2] - worldUp[2] * forward[1],
    worldUp[2] * forward[0] - worldUp[0] * forward[2],
    worldUp[0] * forward[1] - worldUp[1] * forward[0],
  ];
  const rightLength = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength];
  const up: [number, number, number] = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];

  let halfWidth = 0;
  let halfHeight = 0;
  let halfDepth = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const cx = (corner & 1 ? aabb.max : aabb.min)[0] - center[0];
    const cy = (corner & 2 ? aabb.max : aabb.min)[1] - center[1];
    const cz = (corner & 4 ? aabb.max : aabb.min)[2] - center[2];
    halfWidth = Math.max(halfWidth, Math.abs(cx * right[0] + cy * right[1] + cz * right[2]));
    halfHeight = Math.max(halfHeight, Math.abs(cx * up[0] + cy * up[1] + cz * up[2]));
    halfDepth = Math.max(halfDepth, Math.abs(cx * forward[0] + cy * forward[1] + cz * forward[2]));
  }

  const fovY = fovYDegrees * DEGREES_TO_RADIANS;
  const tangent = Math.tan(fovY / 2);
  const distance =
    Math.max(halfHeight / tangent, halfWidth / (tangent * aspect)) * margin + halfDepth;

  return {
    position: [
      center[0] + forward[0] * distance,
      center[1] + forward[1] * distance,
      center[2] + forward[2] * distance,
    ],
    target: center,
    up: [0, 1, 0],
    fovYDegrees,
    // Plano cercano justo delante del objeto: es el parámetro que gobierna la
    // precisión del z-buffer, y aquí se puede ajustar con exactitud.
    near: Math.max(0.01, distance - halfDepth * margin - 1e-3),
    far: distance + halfDepth * margin + 1e-3,
    projection: view.projection,
    orthoHalfHeight: Math.max(halfHeight, halfWidth / aspect) * margin,
  };
}

/**
 * Encuadre automático. Un agente no debería tener que adivinar distancias de
 * cámara: la esfera de radio r se ve completa desde
 *
 *   d = r / sin(fov/2)
 *
 * porque el radio es el cateto opuesto al semiángulo de visión sobre la
 * hipotenusa que va del ojo al centro. El margen deja aire alrededor. En
 * ortográfica no hay distancia que ajustar: se fija la media altura a r·margen.
 */
export function frameCamera(
  bounds: SceneBounds,
  view: ViewDefinition,
  fovYDegrees = 40,
  margin = 1.15,
): Camera {
  const fovY = fovYDegrees * DEGREES_TO_RADIANS;
  const distance = (bounds.radius / Math.sin(fovY / 2)) * margin;

  const yaw = view.yaw * DEGREES_TO_RADIANS;
  const pitch = view.pitch * DEGREES_TO_RADIANS;
  const horizontal = Math.cos(pitch) * distance;

  return {
    position: [
      bounds.center[0] + Math.sin(yaw) * horizontal,
      bounds.center[1] + Math.sin(pitch) * distance,
      bounds.center[2] + Math.cos(yaw) * horizontal,
    ],
    target: [...bounds.center],
    up: [0, 1, 0],
    fovYDegrees,
    // El plano cercano lo más lejos posible sin cortar el objeto: es el
    // parámetro que gobierna la precisión del z-buffer.
    near: Math.max(0.01, distance - bounds.radius * margin),
    far: distance + bounds.radius * 4,
    projection: view.projection,
    orthoHalfHeight: bounds.radius * margin,
  };
}

/**
 * Caja en píxeles de una caja de mundo, **sin recortar al tile**, y a qué
 * distancia de la cámara queda.
 *
 * Es lo que hace falta para auditar movimiento en 2D: `projectAabbToTile`
 * devuelve `null` en cuanto la pieza sale del tile, y para decir «se sale por 47
 * píxeles en el fotograma 30» hace falta el número de fuera. Aquí el recorte no
 * se hace, y quien lo quiera recortado usa la de abajo.
 *
 * `depth` es la distancia del centro de la caja al plano de la cámara, medida en
 * el eje de vista. Sirve para ordenar dos cajas que se solapan en pantalla —cuál
 * tapa a cuál— y no para nada más: es la caja, no la silueta.
 *
 * Devuelve `null` cuando la caja cruza el plano de la cámara y su proyección deja
 * de estar definida; eso no es un fallo, es que no hay respuesta.
 */
export interface ProjectedAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  depth: number;
}

export function projectAabb(
  aabb: SceneAabb,
  camera: Camera,
  tileSize: number,
): ProjectedAabb | null {
  const view = lookAt(
    vec3(camera.position[0], camera.position[1], camera.position[2]),
    vec3(camera.target[0], camera.target[1], camera.target[2]),
    vec3(camera.up[0], camera.up[1], camera.up[2]),
  );
  // Aspecto 1: los tiles del pliego son cuadrados.
  const projection =
    camera.projection === "perspective"
      ? perspective(camera.fovYDegrees * DEGREES_TO_RADIANS, 1, camera.near, camera.far)
      : orthographic(camera.orthoHalfHeight, 1, camera.near, camera.far);
  const viewProjection = multiply(projection, view, mat4());

  const clip: Vec4 = new Float32Array(4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let corner = 0; corner < 8; corner += 1) {
    transformPoint(
      viewProjection,
      (corner & 1 ? aabb.max : aabb.min)[0],
      (corner & 2 ? aabb.max : aabb.min)[1],
      (corner & 4 ? aabb.max : aabb.min)[2],
      clip,
    );
    if (clip[3] <= 1e-6) return null;
    const screenX = ndcToScreenX(clip[0] / clip[3], tileSize);
    const screenY = ndcToScreenY(clip[1] / clip[3], tileSize);
    if (screenX < minX) minX = screenX;
    if (screenY < minY) minY = screenY;
    if (screenX > maxX) maxX = screenX;
    if (screenY > maxY) maxY = screenY;
  }

  // La profundidad se mide en el eje de vista y no con la `w` del recorte, que en
  // ortográfica vale uno para todo y no ordenaría nada.
  const centerView: Vec4 = new Float32Array(4);
  transformPoint(
    view,
    (aabb.min[0] + aabb.max[0]) / 2,
    (aabb.min[1] + aabb.max[1]) / 2,
    (aabb.min[2] + aabb.max[2]) / 2,
    centerView,
  );

  return { minX, minY, maxX, maxY, depth: -centerView[2] };
}

/**
 * Caja en píxeles que ocupa una caja de mundo vista por una cámara.
 *
 * Es la pieza que permite señalar: sin ella, ver algo raro en el pliego no se puede
 * convertir en «esa pieza de ahí». Se proyectan las ocho esquinas y se toma el mínimo
 * y el máximo en pantalla, así que es la caja de la caja envolvente, no la silueta:
 * sirve para atribuir y para señalar, nunca para medir cobertura.
 *
 * Devuelve `null` en dos casos que no son un fallo: la pieza queda fuera del tile, o
 * cruza el plano de la cámara y su proyección deja de estar definida.
 */
export function projectAabbToTile(
  aabb: SceneAabb,
  camera: Camera,
  tileSize: number,
): [number, number, number, number] | null {
  const box = projectAabb(aabb, camera, tileSize);
  if (box === null) return null;
  const { minX, minY, maxX, maxY } = box;

  if (maxX <= 0 || maxY <= 0 || minX >= tileSize || minY >= tileSize) return null;
  // Un píxel de holgura: el antialiasing es una pasada de vecindad 3×3 sobre las
  // discontinuidades de profundidad, así que tiñe un anillo por fuera de la arista
  // geométrica. Sin la holgura, la caja de una hélice casi de canto deja fuera la
  // fila de píxeles suavizados y la promesa «contiene todo lo pintado» sería falsa.
  return [
    Math.max(0, Math.floor(minX) - 1),
    Math.max(0, Math.floor(minY) - 1),
    Math.min(tileSize, Math.ceil(maxX) + 1),
    Math.min(tileSize, Math.ceil(maxY) + 1),
  ];
}

export interface RenderedView {
  name: string;
  column: number;
  row: number;
  /** En wireframe, `coverage` y `backfaceRatio` no están definidos: no se rasterizan caras. */
  wireframe: boolean;
  milliseconds: number;
  stats: FrameStats;
  /**
   * Escrituras de color por píxel del tile. NO es cobertura: cuenta cada píxel
   * que pasó el test de profundidad, así que el sobredibujo lo lleva por encima
   * de 1. Sirve para medir coste, no encuadre; para el encuadre está
   * `measureObjectCoverage`.
   */
  shadedLoad: number;
  /** Fracción de triángulos descartados por reverso. */
  backfaceRatio: number;
  /** La cámara con que se encuadró, para poder proyectar cajas sobre este tile. */
  camera: Camera;
}

export interface ContactSheet {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tileSize: number;
  views: RenderedView[];
  /**
   * Caja que definió el encuadre. Va en el informe para que la siguiente llamada
   * pueda repetirlo: comparar dos pliegos exige la misma cámara, y quien tiene el
   * pliego anterior no tiene ya la geometría con que se encuadró.
   */
  frameAabb: SceneAabb;
}

/**
 * Altura de mundo que abarca el tile.
 *
 * Es el número que hace comparables dos vistas: cada una tiene su propio encuadre,
 * así que una pieza más grande en píxeles puede ser más pequeña en unidades. En
 * ortográfica es la altura del volumen; en perspectiva, la del plano que pasa por
 * el objetivo, que es donde está el objeto.
 */
function visibleWorldHeight(camera: Camera): number {
  if (camera.projection === "orthographic") return camera.orthoHalfHeight * 2;
  const distance = Math.hypot(
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  );
  return 2 * Math.tan((camera.fovYDegrees * DEGREES_TO_RADIANS) / 2) * distance;
}

function formatUnits(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function baseOptions(): RenderOptions {
  return {
    shadingMode: "lit",
    wireframe: false,
    perspectiveCorrect: true,
    antialias: true,
    // Encendidas en el pliego: una sombra de contacto es lo que permite juzgar si una
    // pieza toca el suelo o flota, y eso en un render sin sombras es indistinguible.
    shadows: true,
    shadowSamples: 4,
    frustumCulling: true,
    cullMode: CullMode.Back,
    light: { direction: [0.42, 0.76, 0.5], color: [1, 0.97, 0.92], intensity: 1.2 },
    ambient: [0.34, 0.37, 0.44],
    ambientGround: [0.16, 0.15, 0.14],
    fogColor: [0.08, 0.09, 0.12],
    fogDensity: 0,
    clearColor: [0.09, 0.1, 0.13],
  };
}

export function renderContactSheet(
  nodes: readonly SceneNode[],
  tileSize = 320,
  views: readonly ViewDefinition[] = DEFAULT_VIEWS,
  columns = 3,
  /**
   * Nodos que definen el encuadre. Se pasan explícitos porque no coinciden con los
   * que se dibujan: el suelo de referencia mide varias veces el objeto y lo
   * encogería, y con una selección activa el encuadre debe seguir a la selección.
   * Por defecto, todo lo que se dibuja.
   */
  framingNodes?: readonly SceneNode[],
  /**
   * Encuadre impuesto, que gana a `framingNodes`.
   *
   * Existe para poder comparar dos pliegos. La cámara se ajusta al contenido, así que
   * mover una pieza un milímetro hacia arriba mueve la caja envolvente, mueve la
   * cámara, y el pliego entero se desplaza un píxel: la comparación se llena de
   * siluetas y el cambio real se pierde entre ellas. Fijando el encuadre, lo que
   * cambia en la imagen es lo que cambió en el modelo.
   */
  frameAabb?: SceneAabb,
  /**
   * Modo de comparación: el pliego deja de estar hecho para que lo mire una
   * persona y pasa a estar hecho para compararlo con otro rasterizador.
   *
   * Apaga el suavizado, las sombras y el rótulo, y limpia a negro. No es
   * cosmética: el suavizado tiñe un anillo alrededor de cada arista, la sombra
   * pinta el fondo, y el rótulo son píxeles encendidos que no son geometría —los
   * tres convierten «qué píxeles cubre el objeto» en una pregunta sin respuesta.
   * Con el ambiente encendido ninguna superficie sale negra pura, así que el
   * fondo se distingue de la geometría por igualdad exacta.
   */
  parityMode = false,
): ContactSheet {
  const aabb = frameAabb ?? computeSceneAabb(framingNodes ?? nodes);
  const rows = Math.ceil(views.length / columns);
  const width = columns * tileSize;
  const height = rows * tileSize;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const renderer = new SoftwareRenderer(tileSize, tileSize);
  const rendered: RenderedView[] = [];

  views.forEach((view, index) => {
    const options = baseOptions();
    options.shadingMode = view.shading;
    options.wireframe = view.wireframe ?? false;
    if (view.wireframe) options.antialias = false;
    // Con el encuadre fijado se fija también el volumen de la sombra: si no, mover
    // una pieza desplaza la rejilla del mapa y cambian las sombras de todas.
    if (frameAabb) options.shadowBounds = frameAabb;
    if (parityMode) {
      options.antialias = false;
      options.shadows = false;
      options.clearColor = [0, 0, 0];
    }

    const camera = frameCameraFromAabb(aabb, view);
    const start = performance.now();
    const stats = renderer.render(nodes, camera, options);
    const milliseconds = performance.now() - start;

    const column = index % columns;
    const row = Math.floor(index / columns);
    const tileStride = tileSize * 4;
    for (let y = 0; y < tileSize; y += 1) {
      const source = y * tileStride;
      const target = ((row * tileSize + y) * width + column * tileSize) * 4;
      pixels.set(renderer.framebuffer.color.subarray(source, source + tileStride), target);
    }

    // Rótulo quemado: nombre de la vista y altura de mundo del tile, para que la
    // imagen se explique sola sin el informe al lado. En comparación no se
    // dibuja: son píxeles encendidos que no son geometría.
    if (!parityMode) {
      const labelScale = Math.max(1, Math.round(tileSize / 320));
      const margin = 4 * labelScale;
      drawLabel(
        pixels,
        width,
        height,
        column * tileSize + margin,
        row * tileSize + margin,
        `${view.name} · ${tileSize}PX · ${formatUnits(visibleWorldHeight(camera))}U`,
        labelScale,
        tileSize - margin * 2,
      );
    }

    const drawn = stats.trianglesRasterized + stats.trianglesCulled;
    rendered.push({
      name: view.name,
      column,
      row,
      wireframe: options.wireframe,
      milliseconds: Number(milliseconds.toFixed(2)),
      // Copia: el renderizador reutiliza su objeto de estadísticas entre frames, y
      // guardar la referencia haría que la última vista sobrescribiera a las cinco
      // anteriores.
      stats: cloneStats(stats),
      shadedLoad: Number((stats.pixelsShaded / (tileSize * tileSize)).toFixed(4)),
      backfaceRatio: drawn > 0 ? Number((stats.trianglesCulled / drawn).toFixed(3)) : 0,
      camera,
    });
  });

  return { pixels, width, height, columns, rows, tileSize, views: rendered, frameAabb: aabb };
}

/**
 * Huella del pliego y de cada vista: FNV-1a de 32 bits sobre el búfer de color.
 *
 * Responde «¿cambió algo?» sin guardar imágenes ni compararlas. Es el complemento
 * barato del diff: la huella dice *si*, el diff dice *cuánto y dónde*, y para una
 * prueba de no regresión en integración continua la huella sola basta.
 *
 * Es exacta, no tolerante: un píxel de dither distinto ya cambia la huella, donde
 * el diff —que tiene umbral— diría cero. Por eso las dos cosas, y no una.
 *
 * Solo es comparable entre máquinas si el motor de JavaScript es el mismo: el
 * rasterizador usa `sin`, `cos` y `tan`, que el estándar no fija al último bit.
 */
export function hashSheet(sheet: ContactSheet): { sheet: string; byView: Record<string, string> } {
  const byView: Record<string, string> = {};
  for (const view of sheet.views) {
    let hash = 0x811c9dc5;
    for (let y = 0; y < sheet.tileSize; y += 1) {
      const start = ((view.row * sheet.tileSize + y) * sheet.width + view.column * sheet.tileSize) * 4;
      for (let index = start; index < start + sheet.tileSize * 4; index += 1) {
        hash = Math.imul(hash ^ sheet.pixels[index], 0x01000193);
      }
    }
    byView[view.name] = (hash >>> 0).toString(16).padStart(8, "0");
  }

  let whole = 0x811c9dc5;
  for (let index = 0; index < sheet.pixels.length; index += 1) {
    whole = Math.imul(whole ^ sheet.pixels[index], 0x01000193);
  }
  return { sheet: (whole >>> 0).toString(16).padStart(8, "0"), byView };
}

/**
 * Cobertura real del objeto en el encuadre, en un render aparte y pequeño.
 *
 * Aparte porque el suelo de referencia llena el fotograma y haría inútil la
 * medida; y contando píxeles con profundidad distinta del valor de limpieza en
 * vez de escrituras de color, porque el sobredibujo cuenta un píxel varias veces
 * y eso no es cobertura. Es la señal con la que un agente sabe si su objeto se ve
 * demasiado pequeño, se sale del cuadro, o está vacío.
 *
 * 96×96 basta: es una fracción, y a esa resolución cuesta ~1 ms.
 */
export function measureObjectCoverage(objectNodes: readonly SceneNode[], size = 96): number {
  const renderer = new SoftwareRenderer(size, size);
  const options = baseOptions();
  options.antialias = false;
  const aabb = computeSceneAabb(objectNodes);
  renderer.render(objectNodes, frameCameraFromAabb(aabb, DEFAULT_VIEWS[0]), options);

  const { depth } = renderer.framebuffer;
  let covered = 0;
  for (let index = 0; index < depth.length; index += 1) {
    if (depth[index] > 0) covered += 1;
  }
  return covered / (size * size);
}
