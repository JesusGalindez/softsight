/**
 * El pipeline completo, en CPU y en un solo hilo.
 *
 *   1. Visibilidad        : frustum culling por esfera envolvente + orden de
 *                          cerca a lejos
 *   2. Etapa de vértices : objeto -> mundo -> vista -> clip (una matriz, un solo
 *                          producto por vértice, cacheado por malla)
 *   3. Ensamblado         : índices -> triángulos
 *   4. Recortado          : plano cercano en espacio homogéneo
 *   5. Divide por w       : clip -> NDC
 *   6. Viewport           : NDC -> píxeles
 *   7. Culling            : signo del área firmada en pantalla
 *   8. Rasterizado        : span exacto + gradientes + z-buffer invertido
 *   9. Sombreado          : por píxel superviviente al test de profundidad
 *  10. Postproceso        : antialiasing por discontinuidad de profundidad
 *  11. Presentación       : putImageData
 *
 * No se toca WebGL, WebGPU ni canvas 3D en ningún punto. El único servicio que
 * presta el navegador es blitear un array de bytes a la pantalla.
 */

import {
  clipTriangleNearPlane,
  SHADOW_VARYING_COUNT,
  VARYING_COUNT,
  VERTEX_STRIDE,
} from "./clip";
import { Framebuffer } from "./framebuffer";
import {
  identity,
  invertAffine,
  mat4,
  multiply,
  normalMatrix,
  transformDirection,
  transformPoint,
  type Mat4,
  type Vec3,
  vec3,
} from "./math";
import { ensureFaceNormals, type Mesh } from "./mesh";
import { applyDepthEdgeAntialias } from "./postprocess";
import { drawSDFText } from "./text";
import { ShadowMap } from "./shadowMap";
import {
  extractFrustumPlanes,
  lookAt,
  ndcDepthToBuffer,
  ndcToScreenX,
  ndcToScreenY,
  orthographic,
  perspective,
  sphereOutsideFrustum,
} from "./projection";
import {
  CullMode,
  drawLine,
  RASTER_STRIDE,
  rasterizeTriangle,
  type PixelShader,
  type RasterStats,
} from "./raster";
import {
  createShader,
  type Light,
  type Material,
  type ShadingContext,
  type ShadingMode,
} from "./shading";

export type { Light, Material, ShadingMode };

function createEmptyStats(): FrameStats {
  return {
    trianglesSubmitted: 0,
    trianglesClipped: 0,
    trianglesRejected: 0,
    trianglesRasterized: 0,
    trianglesCulled: 0,
    nodesDrawn: 0,
    nodesCulled: 0,
    smoothedPixels: 0,
    pixelsShaded: 0,
    pixelsTested: 0,
    pixelsInBoundingBox: 0,
    vertexMilliseconds: 0,
    shadowMilliseconds: 0,
    postprocessMilliseconds: 0,
    totalMilliseconds: 0,
  };
}

/** Copia independiente, para guardar estadísticas más allá del frame actual. */
export function cloneStats(stats: FrameStats): FrameStats {
  return { ...stats };
}

function resetStats(stats: FrameStats): void {
  stats.trianglesSubmitted = 0;
  stats.trianglesClipped = 0;
  stats.trianglesRejected = 0;
  stats.trianglesRasterized = 0;
  stats.trianglesCulled = 0;
  stats.nodesDrawn = 0;
  stats.nodesCulled = 0;
  stats.smoothedPixels = 0;
  stats.pixelsShaded = 0;
  stats.pixelsTested = 0;
  stats.pixelsInBoundingBox = 0;
  stats.vertexMilliseconds = 0;
  stats.shadowMilliseconds = 0;
  stats.postprocessMilliseconds = 0;
  stats.totalMilliseconds = 0;
}

export interface SceneNode {
  mesh: Mesh;
  model: Mat4;
  material: Material;
  /**
   * Si proyecta sombra. Por omisión sí. Marcar el suelo como no emisor no es
   * cosmético: el volumen de la luz se ajusta a los emisores, y un plano de 60×60
   * unidades dentro de ese ajuste dejaría al objeto en tres téxeles del mapa.
   */
  castsShadow?: boolean;
}

export interface Camera {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovYDegrees: number;
  near: number;
  far: number;
  projection: "perspective" | "orthographic";
  /** Media altura del volumen ortográfico, en unidades de mundo. */
  orthoHalfHeight: number;
}

export interface RenderOptions {
  shadingMode: ShadingMode;
  wireframe: boolean;
  perspectiveCorrect: boolean;
  antialias: boolean;
  shadows: boolean;
  /** Muestras del mapa de sombras por píxel: 1 duro, 4 suave. */
  shadowSamples: 1 | 4;
  /**
   * Volumen fijo para el mapa de sombras, en vez de ajustarlo a los emisores. Sin
   * él, mover una pieza mueve la rejilla de téxeles y cambian todas las sombras.
   */
  shadowBounds?: { min: readonly number[]; max: readonly number[] };
  frustumCulling: boolean;
  cullMode: CullMode;
  light: Light;
  /** Ambiente hemisférico: `ambient` es el cielo, `ambientGround` el rebote del suelo. */
  ambient: [number, number, number];
  ambientGround: [number, number, number];
  fogColor: [number, number, number];
  fogDensity: number;
  clearColor: [number, number, number];
  /**
   * Título de texto SDF que se quema en el framebuffer después del postproceso.
   * Vive en la propia imagen, no en una capa del navegador: el render headless
   * lo lleva dentro, así que video y pliego muestran lo mismo.
   */
  title?: SdfTitle;
  /**
   * Varios títulos en el mismo frame: una plantilla de cartel (kicker + hero +
   * pie) los declara como lista. Alternativa de compatibilidad a `title` — si
   * vienen ambos, se dibujan los dos.
   */
  titles?: readonly SdfTitle[];
}

/** Texto SDF quemado en el framebuffer: esquina superior izquierda en píxeles. */
export interface SdfTitle {
  text: string;
  originX: number;
  originY: number;
  /** Píxeles de pantalla por píxel de fuente (5×7). */
  scale: number;
  color?: readonly [number, number, number];
}

/** Unión de los títulos de `options` (compatibilidad `title` + lista `titles`). */
function listTitles(options: RenderOptions): readonly SdfTitle[] {
  if (!options.title) return options.titles ?? [];
  if (!options.titles) return [options.title];
  return [options.title, ...options.titles];
}

export interface FrameStats extends RasterStats {
  trianglesSubmitted: number;
  trianglesClipped: number;
  /** Descartados por rechazo trivial contra los planos laterales. */
  trianglesRejected: number;
  nodesDrawn: number;
  nodesCulled: number;
  smoothedPixels: number;
  vertexMilliseconds: number;
  shadowMilliseconds: number;
  postprocessMilliseconds: number;
  totalMilliseconds: number;
}

export class SoftwareRenderer {
  readonly framebuffer: Framebuffer;

  private readonly viewMatrix = mat4();
  private readonly projectionMatrix = mat4();
  private readonly viewProjectionMatrix = mat4();
  private readonly modelViewProjectionMatrix = mat4();
  private readonly nodeNormalMatrix = mat4();

  /** Caché de vértices post-transformación, redimensionada según haga falta. */
  private transformedVertices = new Float32Array(0);
  private readonly clipInput = new Float32Array(3 * VERTEX_STRIDE);
  private readonly clipOutput = new Float32Array(4 * VERTEX_STRIDE);
  private readonly rasterTriangle = new Float32Array(3 * RASTER_STRIDE);
  private readonly scratchPoint = new Float32Array(4);
  private readonly scratchNormal = vec3();

  /** 6 planos × (a, b, c, d), reextraídos cada frame de la matriz view-projection. */
  private readonly frustumPlanes = new Float32Array(24);

  /**
   * Objetos reutilizados entre frames. Cada uno era una asignación por frame en el
   * camino caliente: a 60 fps son 60 objetos por segundo por concepto, y la presión
   * del recolector se ve como varianza en el tiempo de frame, que es justo lo que se
   * percibe como falta de fluidez.
   */
  private readonly stats: FrameStats = createEmptyStats();
  private readonly eyeVector = vec3();
  private readonly targetVector = vec3();
  private readonly upVector = vec3();
  private readonly shadingContext: ShadingContext = {
    light: { direction: [0, 1, 0], color: [1, 1, 1], intensity: 1 },
    ambient: [0, 0, 0],
    ambientGround: [0, 0, 0],
    cameraPosition: [0, 0, 0],
    fogColor: [0, 0, 0],
    fogDensity: 0,
    pixelWorldSizePerUnitDepth: 0,
    shadowMap: null,
  };
  /**
   * Mapa de sombras, creado al primer uso: son 4 MB a 1024², y no se reservan si
   * nadie enciende las sombras.
   */
  private shadowMap: ShadowMap | null = null;
  private readonly shadowCasters: SceneNode[] = [];
  /**
   * Firma de lo que determina el mapa de sombras. Un modelo importado no se mueve, y
   * rasterizar sus 38.000 triángulos desde la luz en cada frame costaba 15,7 ms para
   * producir exactamente el mismo mapa. La firma suma los elementos de la matriz de
   * cada emisor más la dirección de la luz: si no cambia, el mapa vale.
   */
  private shadowSignature = Number.NaN;
  /** Varyings activos este frame: 8 sin sombras, 11 con ellas. */
  private activeVaryingCount = VARYING_COUNT;

  /** Apoyo del descarte en espacio de objeto. */
  private readonly inverseModelMatrix = mat4();
  private readonly cameraPosition = vec3();
  /**
   * Dirección hacia la cámara con proyección ortográfica, donde todos los rayos
   * son paralelos y no existe «posición» que reste. `null` en perspectiva.
   */
  private orthographicToCamera: Vec3 | null = null;
  private readonly orthographicToCameraObject = vec3();
  private vertexStamp = new Int32Array(0);
  private survivingTriangles = new Uint32Array(0);
  /**
   * Marca de generación. Se incrementa por nodo y por frame, de modo que comparar
   * contra ella equivale a limpiar el array de marcas sin recorrerlo.
   */
  private stampCounter = 0;
  /**
   * Shaders cacheados por material. Antes se creaba una clausura por nodo y por
   * frame —22 en la escena de demo, 296 en un GLB cargado—; ahora solo si cambia
   * algo que el shader capture por valor, que es lo que codifica la clave.
   */
  private readonly shaderCache = new WeakMap<Material, { key: string; shader: PixelShader }>();
  /** Listas de visibilidad reutilizadas: ordenar no debe asignar memoria. */
  private readonly visibleNodes: SceneNode[] = [];
  private readonly visibleKeys: number[] = [];

  constructor(width: number, height: number, rowOffset = 0, fullHeight = height) {
    this.framebuffer = new Framebuffer(width, height, rowOffset, fullHeight);
  }

  get width(): number {
    return this.framebuffer.width;
  }

  get height(): number {
    return this.framebuffer.height;
  }

  /**
   * Renderiza un frame.
   *
   * ATENCIÓN con el valor devuelto: es el **mismo objeto** en cada llamada, reutilizado
   * para no asignar por frame. Vale para leerlo antes del siguiente render; guardarlo
   * para después exige copiarlo con `cloneStats`. Reutilizarlo sin copia ya provocó
   * un fallo: el pliego de contactos guardaba la referencia de las seis vistas y la
   * última las sobrescribía todas.
   */
  render(nodes: readonly SceneNode[], camera: Camera, options: RenderOptions): FrameStats {
    const startTime = performance.now();
    const { framebuffer } = this;
    // Relación de aspecto de la imagen completa: una banda no cambia el encuadre.
    const aspect = framebuffer.width / framebuffer.fullHeight;

    framebuffer.clear(
      options.clearColor[0] * 255,
      options.clearColor[1] * 255,
      options.clearColor[2] * 255,
    );

    this.cameraPosition.set(camera.position);
    if (camera.projection === "orthographic") {
      const dx = camera.position[0] - camera.target[0];
      const dy = camera.position[1] - camera.target[1];
      const dz = camera.position[2] - camera.target[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      this.orthographicToCamera = vec3(dx / length, dy / length, dz / length);
    } else {
      this.orthographicToCamera = null;
    }
    this.eyeVector.set(camera.position);
    this.targetVector.set(camera.target);
    this.upVector.set(camera.up);
    lookAt(this.eyeVector, this.targetVector, this.upVector, this.viewMatrix);

    if (camera.projection === "perspective") {
      perspective(
        (camera.fovYDegrees * Math.PI) / 180,
        aspect,
        camera.near,
        camera.far,
        this.projectionMatrix,
      );
    } else {
      orthographic(camera.orthoHalfHeight, aspect, camera.near, camera.far, this.projectionMatrix);
    }

    multiply(this.projectionMatrix, this.viewMatrix, this.viewProjectionMatrix);

    const stats = this.stats;
    resetStats(stats);

    /**
     * Tamaño en mundo de un píxel a distancia de vista 1: la altura del plano de
     * imagen a esa distancia (2·tan(fov/2)) repartida entre las filas del
     * buffer. Multiplicado por el w del píxel da su huella real, que es lo que
     * el sombreado necesita para filtrar la textura.
     */
    const pixelWorldSizePerUnitDepth =
      camera.projection === "perspective"
        ? (2 * Math.tan(((camera.fovYDegrees * Math.PI) / 180) / 2)) / framebuffer.fullHeight
        : (2 * camera.orthoHalfHeight) / framebuffer.fullHeight;

    const shadingContext = this.shadingContext;
    shadingContext.light = options.light;
    shadingContext.ambient = options.ambient;
    shadingContext.ambientGround = options.ambientGround;
    shadingContext.cameraPosition = camera.position;
    shadingContext.fogColor = options.fogColor;
    shadingContext.fogDensity = options.fogDensity;
    shadingContext.pixelWorldSizePerUnitDepth = pixelWorldSizePerUnitDepth;

    if (options.shadows && !options.wireframe) {
      const shadowStart = performance.now();
      if (this.shadowMap === null) this.shadowMap = new ShadowMap();
      this.shadowMap.samples = options.shadowSamples;
      this.shadowCasters.length = 0;
      for (const node of nodes) {
        if (node.castsShadow !== false) this.shadowCasters.push(node);
      }
      let signature = options.light.direction[0] * 7919 + options.light.direction[1] * 6551 +
        options.light.direction[2] * 4243 + this.shadowCasters.length;
      for (const caster of this.shadowCasters) {
        const m = caster.model;
        signature =
          signature * 1.0000001 +
          m[0] + m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] +
          m[8] + m[9] + m[10] + m[11];
      }
      if (signature !== this.shadowSignature) {
        this.shadowMap.render(this.shadowCasters, options.light.direction, options.shadowBounds);
        this.shadowSignature = signature;
      }
      shadingContext.shadowMap = this.shadowMap;
      stats.shadowMilliseconds = performance.now() - shadowStart;
    } else {
      shadingContext.shadowMap = null;
    }
    this.activeVaryingCount =
      shadingContext.shadowMap !== null ? SHADOW_VARYING_COUNT : VARYING_COUNT;

    // Clave de caché: solo lo que el shader captura por valor al construirse. Las
    // referencias a arrays (luz, ambiente, posición de cámara) se leen en cada
    // píxel, así que mutarlas no invalida nada.
    const shaderKey = `${options.shadingMode}|${pixelWorldSizePerUnitDepth}|${options.fogDensity}|${shadingContext.shadowMap !== null}`;

    this.collectVisibleNodes(nodes, camera, options, stats);

    for (const node of this.visibleNodes) {
      let cached = this.shaderCache.get(node.material);
      if (cached === undefined || cached.key !== shaderKey) {
        cached = { key: shaderKey, shader: createShader(options.shadingMode, node.material, shadingContext) };
        this.shaderCache.set(node.material, cached);
      }
      this.renderNode(node, cached.shader, options, stats);
    }

    if (options.antialias && !options.wireframe) {
      const postprocessStart = performance.now();
      stats.smoothedPixels = applyDepthEdgeAntialias(framebuffer);
      stats.postprocessMilliseconds = performance.now() - postprocessStart;
    }

    for (const run of listTitles(options)) {
      drawSDFText(
        framebuffer.color,
        framebuffer.width,
        framebuffer.height,
        run.originX,
        run.originY,
        {
          text: run.text,
          scale: run.scale,
          color: run.color ?? [236, 239, 245],
        },
        framebuffer.rowOffset,
      );
    }

    stats.totalMilliseconds = performance.now() - startTime;
    return stats;
  }

  /**
   * Descarte por frustum y orden de cerca a lejos.
   *
   * El descarte usa la esfera envolvente contra los 6 planos: 6 productos
   * escalares por objeto deciden sobre miles de triángulos.
   *
   * El orden importa por el z-buffer: dibujando de cerca a lejos, la geometría
   * lejana llega con el buffer ya ocupado por lo cercano, falla el test de
   * profundidad y **nunca se sombrea**. Sombrear es lo caro, así que ordenar por
   * distancia al cuadrado (sin raíz: la raíz es monótona y no cambia el orden)
   * convierte trabajo de sombreado en trabajo de comparación.
   *
   * Inserción en lugar de `sort`: n es pequeño y entre frames la lista ya viene
   * casi ordenada, así que la inserción es lineal en la práctica y no asigna.
   */
  private collectVisibleNodes(
    nodes: readonly SceneNode[],
    camera: Camera,
    options: RenderOptions,
    stats: FrameStats,
  ): void {
    const { visibleNodes, visibleKeys } = this;
    visibleNodes.length = 0;
    visibleKeys.length = 0;

    extractFrustumPlanes(this.viewProjectionMatrix, this.frustumPlanes);

    for (const node of nodes) {
      const model = node.model;
      const centerX = model[3];
      const centerY = model[7];
      const centerZ = model[11];

      // Cota superior del factor de escala: norma máxima de las columnas de la
      // submatriz lineal. Exacta para rotación × escalado, que es todo lo que
      // genera esta escena; para cizalladuras sobreestima, y sobreestimar solo
      // cuesta dibujar algo que no hacía falta, nunca perder algo visible.
      const scaleX = Math.hypot(model[0], model[4], model[8]);
      const scaleY = Math.hypot(model[1], model[5], model[9]);
      const scaleZ = Math.hypot(model[2], model[6], model[10]);
      const radius = node.mesh.boundingRadius * Math.max(scaleX, scaleY, scaleZ);

      if (
        options.frustumCulling &&
        sphereOutsideFrustum(this.frustumPlanes, centerX, centerY, centerZ, radius)
      ) {
        stats.nodesCulled += 1;
        continue;
      }

      const dx = centerX - camera.position[0];
      const dy = centerY - camera.position[1];
      const dz = centerZ - camera.position[2];
      const key = dx * dx + dy * dy + dz * dz;

      let insertAt = visibleNodes.length;
      while (insertAt > 0 && visibleKeys[insertAt - 1] > key) {
        visibleNodes[insertAt] = visibleNodes[insertAt - 1];
        visibleKeys[insertAt] = visibleKeys[insertAt - 1];
        insertAt -= 1;
      }
      visibleNodes[insertAt] = node;
      visibleKeys[insertAt] = key;
    }

    stats.nodesDrawn = visibleNodes.length;
  }

  private renderNode(
    node: SceneNode,
    shader: PixelShader,
    options: RenderOptions,
    stats: FrameStats,
  ): void {
    const { mesh, model } = node;
    const vertexCount = mesh.positions.length / 3;
    const requiredSize = vertexCount * VERTEX_STRIDE;
    if (this.transformedVertices.length < requiredSize) {
      this.transformedVertices = new Float32Array(requiredSize);
    }

    multiply(this.viewProjectionMatrix, model, this.modelViewProjectionMatrix);
    normalMatrix(model, this.nodeNormalMatrix);

    const { indices } = mesh;
    const triangleCount = indices.length / 3;
    const cullMode = options.wireframe ? CullMode.None : options.cullMode;

    /**
     * DESCARTE EN ESPACIO DE OBJETO, ANTES DE LA ETAPA DE VÉRTICES.
     *
     * El orden natural —transformar todo y luego descartar— hace que los vértices
     * usados solo por triángulos traseros se transformen para nada. Medido sobre un
     * GLB de 38.000 triángulos: el 54 % se descartaba por reverso *después* de pagar
     * cuatro transformaciones por vértice.
     *
     * En vez de llevar la geometría a la cámara, se lleva la cámara a la geometría:
     * una inversa afín por nodo, y luego el test clásico
     *
     *     dot(normalCara, camaraEnObjeto - vérticeDelTriángulo) ≤ 0  →  reverso
     *
     * son tres multiplicaciones y dos sumas por triángulo, con las normales de cara
     * precalculadas y sin normalizar (solo importa el signo). Solo se transforma un
     * vértice si sobrevive alguno de sus triángulos.
     *
     * Se desactiva cuando el determinante de la matriz del modelo es negativo: una
     * reflexión invierte la orientación de las caras y el test diría lo contrario.
     * Ese caso lo resuelve el descarte en pantalla, que sigue estando.
     */
    let useObjectSpaceCulling = cullMode === CullMode.Back;
    if (useObjectSpaceCulling) {
      useObjectSpaceCulling = invertAffine(model, this.inverseModelMatrix) > 0;
    }

    let survivorCount = triangleCount;
    if (useObjectSpaceCulling) {
      if (this.survivingTriangles.length < triangleCount) {
        this.survivingTriangles = new Uint32Array(triangleCount);
      }
      if (this.vertexStamp.length < vertexCount) {
        this.vertexStamp = new Int32Array(vertexCount);
      }
      this.stampCounter += 1;

      const inverse = this.inverseModelMatrix;
      const camera = this.cameraPosition;
      const cameraX =
        inverse[0] * camera[0] + inverse[1] * camera[1] + inverse[2] * camera[2] + inverse[3];
      const cameraY =
        inverse[4] * camera[0] + inverse[5] * camera[1] + inverse[6] * camera[2] + inverse[7];
      const cameraZ =
        inverse[8] * camera[0] + inverse[9] * camera[1] + inverse[10] * camera[2] + inverse[11];

      const faceNormals = ensureFaceNormals(mesh);
      const positions = mesh.positions;
      const stamp = this.vertexStamp;
      const surviving = this.survivingTriangles;
      const current = this.stampCounter;
      survivorCount = 0;

      /**
       * Con proyección ortográfica no hay «posición de cámara» que restar: todos
       * los rayos son paralelos, así que el vector hacia el observador es
       * constante. Restar una posición finita inclina ese vector según lo lejos
       * del eje que esté la cara, y a incidencia rasante eso **descarta caras
       * que sí se ven**: en la vista superior del pliego faltaban 647 píxeles de
       * silueta —el 4 % del objeto—, medidos por la puerta de paridad.
       */
      const parallel = this.orthographicToCamera;
      let parallelX = 0;
      let parallelY = 0;
      let parallelZ = 0;
      if (parallel) {
        const direction = transformDirection(
          inverse,
          parallel[0],
          parallel[1],
          parallel[2],
          this.orthographicToCameraObject,
        );
        parallelX = direction[0];
        parallelY = direction[1];
        parallelZ = direction[2];
      }

      for (let i = 0; i < indices.length; i += 3) {
        const anchor = indices[i] * 3;
        const towardsCamera = parallel
          ? faceNormals[i] * parallelX +
            faceNormals[i + 1] * parallelY +
            faceNormals[i + 2] * parallelZ
          : faceNormals[i] * (cameraX - positions[anchor]) +
            faceNormals[i + 1] * (cameraY - positions[anchor + 1]) +
            faceNormals[i + 2] * (cameraZ - positions[anchor + 2]);
        if (towardsCamera <= 0) {
          stats.trianglesCulled += 1;
          continue;
        }
        surviving[survivorCount] = i;
        survivorCount += 1;
        stamp[indices[i]] = current;
        stamp[indices[i + 1]] = current;
        stamp[indices[i + 2]] = current;
      }
      stats.trianglesSubmitted += triangleCount;
    }

    const vertexStart = performance.now();
    this.transformVertices(mesh, model, vertexCount, useObjectSpaceCulling);
    stats.vertexMilliseconds += performance.now() - vertexStart;

    for (let triangle = 0; triangle < survivorCount; triangle += 1) {
      const i = useObjectSpaceCulling ? this.survivingTriangles[triangle] : triangle * 3;
      if (!useObjectSpaceCulling) stats.trianglesSubmitted += 1;

      const source0 = indices[i] * VERTEX_STRIDE;
      const source1 = indices[i + 1] * VERTEX_STRIDE;
      const source2 = indices[i + 2] * VERTEX_STRIDE;

      if (this.trianglePlanelyRejected(source0, source1, source2)) {
        stats.trianglesRejected += 1;
        continue;
      }

      if (cullMode !== CullMode.None && this.backfaceRejected(source0, source1, source2, cullMode)) {
        stats.trianglesCulled += 1;
        continue;
      }

      // Copia explícita en vez de `set(subarray(...))`. `subarray` crea un objeto
      // TypedArray nuevo, y aquí se ejecutaba tres veces por triángulo: en un
      // modelo de 38.000 triángulos son 114.000 asignaciones por vista, y el
      // recolector de basura se lleva el frame entero. Doce iteraciones sin
      // asignar cuestan menos que una asignación.
      const vertices = this.transformedVertices;
      const input = this.clipInput;
      for (let component = 0; component < VERTEX_STRIDE; component += 1) {
        input[component] = vertices[source0 + component];
        input[VERTEX_STRIDE + component] = vertices[source1 + component];
        input[2 * VERTEX_STRIDE + component] = vertices[source2 + component];
      }

      const polygonVertexCount = clipTriangleNearPlane(this.clipInput, this.clipOutput);
      if (polygonVertexCount === 0) {
        stats.trianglesClipped += 1;
        continue;
      }
      if (polygonVertexCount === 4) stats.trianglesClipped += 1;

      // Un polígono de n vértices se retriangula en abanico desde el vértice 0.
      for (let fan = 1; fan + 1 < polygonVertexCount; fan += 1) {
        this.projectVertex(0, 0);
        this.projectVertex(fan, 1);
        this.projectVertex(fan + 1, 2);

        if (options.wireframe) {
          this.drawWireframeTriangle();
        } else {
          rasterizeTriangle(
            this.framebuffer,
            this.rasterTriangle,
            shader,
            cullMode,
            stats,
            options.perspectiveCorrect,
            this.activeVaryingCount,
          );
        }
      }
    }
  }

  /**
   * Rechazo trivial de un triángulo contra los cuatro planos laterales, en
   * espacio de clip y antes de recortar, proyectar o ensamblar nada.
   *
   * Un vértice está fuera por la derecha si `x > w`. Si **los tres** lo están,
   * el triángulo entero cae a la derecha de la pantalla —el interior de un
   * triángulo es la envolvente convexa de sus vértices, y un semiespacio es
   * convexo, así que si los tres vértices están en él, todo el triángulo lo
   * está— y se descarta con 6 comparaciones. Lo mismo por izquierda, arriba y
   * abajo.
   *
   * No es lo mismo que el scissor del bounding box: éste actúa antes del divide
   * por w, así que ahorra también el recortado, las tres divisiones de
   * proyección y el montaje del triángulo. Y es solo *rechazo*, nunca acepta ni
   * recorta: un triángulo que cruza el borde pasa de largo y lo resuelve el
   * scissor.
   */
  private trianglePlanelyRejected(source0: number, source1: number, source2: number): boolean {
    const vertices = this.transformedVertices;
    const x0 = vertices[source0];
    const y0 = vertices[source0 + 1];
    const w0 = vertices[source0 + 3];
    const x1 = vertices[source1];
    const y1 = vertices[source1 + 1];
    const w1 = vertices[source1 + 3];
    const x2 = vertices[source2];
    const y2 = vertices[source2 + 1];
    const w2 = vertices[source2 + 3];

    // Exigir w > 0 en los tres no es opcional. Con un vértice detrás de la
    // cámara el signo de w se invierte, el semiespacio deja de contener al
    // triángulo proyectado y el rechazo podría tirar geometría visible. Ese caso
    // lo resuelve el recorte cercano, que va justo después.
    if (w0 <= 0 || w1 <= 0 || w2 <= 0) return false;

    if (x0 > w0 && x1 > w1 && x2 > w2) return true;
    if (-x0 > w0 && -x1 > w1 && -x2 > w2) return true;
    if (y0 > w0 && y1 > w1 && y2 > w2) return true;
    if (-y0 > w0 && -y1 > w1 && -y2 > w2) return true;
    return false;
  }

  /**
   * Rechazo de caras traseras **en espacio de clip**, antes de recortar y proyectar.
   *
   * El rasterizador ya descarta reversos por el signo del área en pantalla, pero para
   * entonces el triángulo ya pagó el recorte, tres divisiones de proyección y el
   * montaje. Medido sobre un GLB de 38.000 triángulos: 20.315 descartados de 37.950,
   * es decir más de la mitad del trabajo de esas etapas era para tirarlo.
   *
   * El área firmada en NDC se puede obtener sin dividir. Con `n_i = (x_i/w_i,
   * y_i/w_i)`, desarrollar el producto vectorial y sacar denominador común da
   *
   *     área_ndc = det[(x₀,y₀,w₀); (x₁,y₁,w₁); (x₂,y₂,w₂)] / (w₀·w₁·w₂)
   *
   * así que con los tres `w` positivos el **signo** del determinante 3×3 decide la
   * orientación, sin una sola división. La transformación de viewport invierte Y, lo
   * que cambia el signo una vez: cara delantera es determinante positivo.
   *
   * Igual que en el rechazo lateral, exigir `w > 0` en los tres no es opcional: con
   * un vértice detrás de la cámara el producto de los `w` cambia de signo y la
   * conclusión se invierte. Ese caso pasa de largo y lo resuelve el rasterizador tras
   * el recorte.
   */
  private backfaceRejected(
    source0: number,
    source1: number,
    source2: number,
    cullMode: CullMode,
  ): boolean {
    const vertices = this.transformedVertices;
    const w0 = vertices[source0 + 3];
    const w1 = vertices[source1 + 3];
    const w2 = vertices[source2 + 3];
    if (w0 <= 0 || w1 <= 0 || w2 <= 0) return false;

    const x0 = vertices[source0];
    const y0 = vertices[source0 + 1];
    const x1 = vertices[source1];
    const y1 = vertices[source1 + 1];
    const x2 = vertices[source2];
    const y2 = vertices[source2 + 1];

    const determinant =
      x0 * (y1 * w2 - y2 * w1) - y0 * (x1 * w2 - x2 * w1) + w0 * (x1 * y2 - x2 * y1);

    return cullMode === CullMode.Back ? determinant <= 0 : determinant >= 0;
  }

  /** Etapa de vértices: una pasada por la malla, resultados reutilizados por todos los triángulos que comparten el vértice. */
  private transformVertices(
    mesh: Mesh,
    model: Mat4,
    vertexCount: number,
    onlyStamped: boolean,
  ): void {
    const { positions, normals, uvs } = mesh;
    const output = this.transformedVertices;
    const shadowMap = this.shadingContext.shadowMap;
    const point = this.scratchPoint;
    const normal = this.scratchNormal;
    const stamp = this.vertexStamp;
    const current = this.stampCounter;

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      // Un vértice cuyos triángulos se descartaron todos no se transforma: es el
      // ahorro que persigue el descarte en espacio de objeto.
      if (onlyStamped && stamp[vertex] !== current) continue;
      const positionOffset = vertex * 3;
      const x = positions[positionOffset];
      const y = positions[positionOffset + 1];
      const z = positions[positionOffset + 2];
      const target = vertex * VERTEX_STRIDE;

      transformPoint(this.modelViewProjectionMatrix, x, y, z, point);
      output[target] = point[0];
      output[target + 1] = point[1];
      output[target + 2] = point[2];
      output[target + 3] = point[3];

      transformPoint(model, x, y, z, point);
      output[target + 4] = point[0];
      output[target + 5] = point[1];
      output[target + 6] = point[2];

      transformDirection(
        this.nodeNormalMatrix,
        normals[positionOffset],
        normals[positionOffset + 1],
        normals[positionOffset + 2],
        normal,
      );
      output[target + 7] = normal[0];
      output[target + 8] = normal[1];
      output[target + 9] = normal[2];

      output[target + 10] = uvs[vertex * 2];
      output[target + 11] = uvs[vertex * 2 + 1];

      if (shadowMap !== null) {
        // Coordenadas en espacio de luz calculadas **aquí**, una vez por vértice, en
        // lugar de por píxel. Medido: la consulta de sombra costaba 17,5 ms por
        // frame incluso con una sola muestra, y la mayor parte era esta
        // transformación repetida por cada píxel sombreado. Interpoladas como
        // varyings salen prácticamente gratis, porque el rasterizador ya interpola.
        //
        // El desplazamiento por normal también sube aquí: aplicarlo al vértice es la
        // formulación estándar de normal-offset y evita recalcularlo por píxel.
        const offset = shadowMap.texelWorldSize * shadowMap.normalOffsetTexels;
        const ox = output[target + 4] + normal[0] * offset;
        const oy = output[target + 5] + normal[1] * offset;
        const oz = output[target + 6] + normal[2] * offset;
        const light = shadowMap.lightMatrix;
        output[target + 12] = light[0] * ox + light[1] * oy + light[2] * oz + light[3];
        output[target + 13] = light[4] * ox + light[5] * oy + light[6] * oz + light[7];
        output[target + 14] = light[8] * ox + light[9] * oy + light[10] * oz + light[11];
      }
    }
  }

  /**
   * Divide por w + viewport. Aquí es donde se materializa x' = x/z del texto:
   * w_clip vale -z_vista, así que dividir por w *es* dividir por profundidad.
   * Se guarda 1/w porque el rasterizador lo necesita para la corrección de
   * perspectiva, y porque una división aquí ahorra una por píxel después.
   */
  private projectVertex(sourceIndex: number, targetIndex: number): void {
    const source = sourceIndex * VERTEX_STRIDE;
    const target = targetIndex * RASTER_STRIDE;
    const clip = this.clipOutput;

    const w = clip[source + 3];
    const invW = 1 / w;

    this.rasterTriangle[target] = ndcToScreenX(clip[source] * invW, this.framebuffer.width);
    // Altura completa, no la de la banda: la proyección no sabe nada de bandas.
    this.rasterTriangle[target + 1] = ndcToScreenY(
      clip[source + 1] * invW,
      this.framebuffer.fullHeight,
    );
    this.rasterTriangle[target + 2] = ndcDepthToBuffer(clip[source + 2] * invW);
    this.rasterTriangle[target + 3] = invW;

    for (let component = 0; component < this.activeVaryingCount; component += 1) {
      this.rasterTriangle[target + 4 + component] = clip[source + 4 + component] * invW;
    }
  }

  private drawWireframeTriangle(): void {
    const t = this.rasterTriangle;
    for (let edge = 0; edge < 3; edge += 1) {
      const a = edge * RASTER_STRIDE;
      const b = ((edge + 1) % 3) * RASTER_STRIDE;
      drawLine(
        this.framebuffer,
        t[a],
        t[a + 1],
        t[a + 2],
        t[b],
        t[b + 1],
        t[b + 2],
        130,
        238,
        255,
      );
    }
  }

  present(context: CanvasRenderingContext2D): void {
    this.framebuffer.present(context);
  }
}

export { CullMode, identity };
