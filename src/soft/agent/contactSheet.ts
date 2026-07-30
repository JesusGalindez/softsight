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
export function computeSceneAabb(nodes: readonly SceneNode[]): SceneAabb {
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
}

export interface ContactSheet {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tileSize: number;
  views: RenderedView[];
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
): ContactSheet {
  const aabb = computeSceneAabb(framingNodes ?? nodes);
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
    });
  });

  return { pixels, width, height, columns, rows, tileSize, views: rendered };
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
