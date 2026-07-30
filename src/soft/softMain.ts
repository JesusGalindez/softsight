/**
 * Arranque de la demo: canvas 2D, cámara orbital, panel de control y HUD.
 *
 * El canvas se pide con `getContext("2d")`. No hay contexto WebGL en ninguna
 * parte de este archivo ni de los que importa.
 */

import { parseGlb, type MeshoptDecoderLike } from "./agent/glbLoader";
import { dedupeNames, toSceneNodes, type Model } from "./agent/model";
import { parseObj } from "./agent/objLoader";
import { runBenchmark, runParallelBenchmark, type BenchResult, type ParallelBenchResult } from "./bench";
import { defaultWorkerCount, ParallelRenderer, type ParallelFrameStats } from "./parallel";
import { Presenter } from "./present";
import { CullMode } from "./raster";
import {
  SoftwareRenderer,
  type Camera,
  type FrameStats,
  type RenderOptions,
  type SceneNode,
} from "./renderer";
import { ResolutionController } from "./resolutionController";
import { identity, mat4 } from "./math";
import { createPlane } from "./mesh";
import { countTriangles, createScene, updateScene } from "./scene";
import type { ShadingMode } from "./shading";

const surface = document.querySelector<HTMLCanvasElement>("#surface");
const overlay = document.querySelector<HTMLElement>("#hud");
if (!surface || !overlay) throw new Error("soft renderer: faltan #surface o #hud en el documento");
const canvas: HTMLCanvasElement = surface;
const hud: HTMLElement = overlay;

const presenter = new Presenter(canvas);

const demoScene = createScene();

/**
 * Escena activa. O la de demostración —animada, función pura del tiempo— o un
 * modelo importado, que es estático. Se mantienen separadas porque el modo paralelo
 * depende de que los workers puedan reconstruir la escena a partir del tiempo, y un
 * modelo cargado desde un fichero del usuario no cumple eso.
 */
let activeNodes: SceneNode[] = demoScene;
let usingDemoScene = true;
let loadedModelName = "";
let sceneTriangles = countTriangles(demoScene);

const camera: Camera = {
  position: [6.5, 4.2, 11],
  target: [0, 1.2, -2],
  up: [0, 1, 0],
  fovYDegrees: 55,
  near: 0.1,
  far: 200,
  projection: "perspective",
  orthoHalfHeight: 6,
};

const options: RenderOptions = {
  shadingMode: "lit",
  wireframe: false,
  perspectiveCorrect: true,
  antialias: true,
  shadows: true,
  shadowSamples: 4,
  frustumCulling: true,
  cullMode: CullMode.Back,
  light: { direction: [0.45, 0.78, 0.44], color: [1, 0.96, 0.88], intensity: 1.15 },
  ambient: [0.18, 0.21, 0.29],
  ambientGround: [0.07, 0.07, 0.09],
  fogColor: [0.06, 0.08, 0.11],
  fogDensity: 0.012,
  clearColor: [0.055, 0.07, 0.098],
};

/**
 * Dos ambientes, porque son dos trabajos distintos.
 *
 * `ATMOSFERA` es el de la escena de demostración: ambiente bajo, neblina activa y
 * fondo oscuro. La columnata desvaneciéndose hacia el horizonte **es** el contenido
 * —enseña el punto de fuga y el divide por w—, y subir la luz indirecta la borra.
 *
 * `ESTUDIO` es el de un modelo importado: ambiente hemisférico alto y sin neblina,
 * porque ahí no se juzga una escena sino la forma de un objeto, y cualquier cara sin
 * luz directa es información perdida.
 *
 * Subí el ambiente global para arreglar que un GLB con `baseColorFactor` casi negro se
 * viera negro, y de paso le quité la atmósfera a la demo. Eran dos problemas, no uno.
 */
const ATMOSFERA = {
  ambient: [0.18, 0.21, 0.29] as [number, number, number],
  ambientGround: [0.07, 0.07, 0.09] as [number, number, number],
  fogDensity: 0.012,
  clearColor: [0.055, 0.07, 0.098] as [number, number, number],
};

const ESTUDIO = {
  ambient: [0.34, 0.37, 0.44] as [number, number, number],
  ambientGround: [0.16, 0.15, 0.14] as [number, number, number],
  fogDensity: 0,
  clearColor: [0.08, 0.09, 0.12] as [number, number, number],
};

function applyAmbience(preset: typeof ATMOSFERA): void {
  options.ambient = [...preset.ambient];
  options.ambientGround = [...preset.ambientGround];
  options.fogDensity = preset.fogDensity;
  options.clearColor = [...preset.clearColor];
}

/**
 * Reserva de renderizadores por tamaño. Cada cambio de resolución creaba antes un
 * `SoftwareRenderer` nuevo —color, profundidad y caché de vértices— y el
 * recolector lo pagaba en el frame siguiente. Al reutilizarlos, oscilar entre dos
 * escalas ya no cuesta memoria.
 */
const rendererPool = new Map<string, SoftwareRenderer>();

function acquireRenderer(width: number, height: number): SoftwareRenderer {
  const key = `${width}x${height}`;
  let pooled = rendererPool.get(key);
  if (pooled === undefined) {
    pooled = new SoftwareRenderer(width, height);
    rendererPool.set(key, pooled);
  }
  return pooled;
}

let renderer = new SoftwareRenderer(2, 2);
let maximumResolutionScale = 1.5;
let dynamicResolution = true;
const resolutionController = new ResolutionController(1, { minimumScale: 0.5 });

/**
 * REFINAMIENTO PROGRESIVO CON CACHÉ DE FRAME.
 *
 * La alternativa que descarté es la reproyección temporal por píxel: proyectar cada
 * píxel con la matriz del frame anterior y reutilizar su color si la profundidad
 * concuerda. Ahorra en torno a la mitad del sombreado **mientras la cámara se mueve**,
 * a cambio de agujeros en las zonas desocluidas y de un especular que se arrastra un
 * frame porque depende del punto de vista.
 *
 * Para este motor no es el reparto correcto. El caso dominante es mirar un objeto
 * quieto, y ahí la comparación es demoledora: si nada ha cambiado —cámara, escena,
 * opciones, resolución— el frame entero es idéntico al anterior, así que no se
 * ahorra la mitad del sombreado sino **todo**, y sin ningún error. Durante el
 * movimiento, que es cuando la reproyección ayudaría, ya está el controlador de
 * resolución bajando píxeles, y es cuando menos detalle se aprecia.
 *
 * Y el tiempo que sobra con la cámara quieta se invierte en subir la resolución por
 * pasos: al soltar el ratón la imagen se afina sola. Es como se sienten nítidos los
 * visores de CAD.
 *
 * La firma tiene que incluir **todo** lo que altera la imagen. Cualquier opción nueva
 * que se añada al renderizador debe entrar aquí, o la pantalla se quedará con una
 * imagen vieja.
 */
const REFINEMENT_STEPS = [1, 1.4, 2];
let frameSignature = Number.NaN;
let refinementLevel = 0;
let idleFrames = 0;
let reusedFrames = 0;

function computeFrameSignature(): number {
  let signature = 17;
  const fold = (value: number): void => {
    signature = (signature * 1.0000001 + value) % 1e12;
  };

  for (const value of camera.position) fold(value);
  for (const value of camera.target) fold(value);
  fold(camera.fovYDegrees);
  fold(camera.near * 1000);
  fold(camera.far);
  fold(camera.orthoHalfHeight);
  fold(camera.projection === "perspective" ? 1 : 2);

  fold(options.shadingMode.length * 31 + options.shadingMode.charCodeAt(0));
  fold(options.wireframe ? 3 : 5);
  fold(options.perspectiveCorrect ? 7 : 11);
  fold(options.antialias ? 13 : 17);
  fold(options.shadows ? 19 : 23);
  fold(options.shadowSamples);
  fold(options.frustumCulling ? 29 : 31);
  fold(options.cullMode);
  for (const value of options.light.direction) fold(value);
  for (const value of options.light.color) fold(value);
  fold(options.light.intensity);
  for (const value of options.ambient) fold(value);
  for (const value of options.ambientGround) fold(value);
  for (const value of options.fogColor) fold(value);
  fold(options.fogDensity);
  for (const value of options.clearColor) fold(value);

  fold(renderer.width);
  fold(renderer.height);
  fold(activeNodes.length);
  for (const node of activeNodes) {
    const m = node.model;
    fold(m[0] + m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] + m[8] + m[9] + m[10] + m[11]);
  }
  return signature;
}

/** Escala efectiva: la del controlador, multiplicada por el paso de refinamiento. */
function refinedScale(): number {
  return resolutionController.currentScale * REFINEMENT_STEPS[refinementLevel];
}

/** Preferencia del usuario; el supersampleo la puede anular por redundante. */
let antialiasRequested = true;

/** Tamaño en píxeles CSS del canvas, mantenido por `ResizeObserver`. */
let cssWidth = 0;
let cssHeight = 0;
let pixelRatio = window.devicePixelRatio || 1;

const workerCount = defaultWorkerCount();
const parallelRenderer = workerCount > 1 ? new ParallelRenderer(workerCount) : null;

/**
 * El paralelo por bandas se activa solo con 4 núcleos o más.
 *
 * Medido con 2 núcleos: un hilo 54,9 ms, dos workers 66,6 ms. Cruzar el límite
 * de hilo cuesta un fijo por frame (mensaje, copia de la banda, `putImageData`)
 * que solo se amortiza si el camino crítico baja de verdad, y con dos núcleos
 * los workers y el hilo principal se pelean por los mismos dos. Con 8 núcleos la
 * cuenta se invierte: el coste fijo no crece y el camino crítico va como 1/N.
 *
 * `?workers=N` fuerza el número y salta esta política, para medir en cada
 * máquina con `__softBenchParallel(N)`.
 */
const forcedWorkers = new URLSearchParams(location.search).has("workers");
let parallel =
  parallelRenderer !== null && (forcedWorkers || (navigator.hardwareConcurrency || 0) >= 4);

/**
 * Ajusta el buffer interno a la escala pedida. No toca el canvas visible: eso lo
 * hace `applyDisplaySize`, y solo cuando cambia el tamaño en pantalla de verdad.
 */
/**
 * Supersampleo adaptativo: cuando el presupuesto sobra, el controlador sube la
 * escala **por encima de 1** y el buffer interno queda más grande que la pantalla.
 * Reducirlo al presentar promedia varias muestras por píxel, que es antialiasing de
 * verdad —resuelve la geometría subpíxel— y no un suavizado posterior. En ese
 * régimen el parche de siluetas es redundante y se apaga, con lo que además se
 * recupera el 11 % de frame que costaba.
 */
function applyInternalScale(): void {
  const scale = refinedScale();
  options.antialias = antialiasRequested && scale <= 1.05;
  const width = Math.max(2, Math.round(cssWidth * pixelRatio * scale));
  const height = Math.max(2, Math.round(cssHeight * pixelRatio * scale));
  if (renderer.width === width && renderer.height === height) return;
  renderer = acquireRenderer(width, height);
  parallelRenderer?.resize(width, height);
  presenter.resizeInternal(width, height);
}

function applyDisplaySize(): void {
  pixelRatio = window.devicePixelRatio || 1;
  const changed = presenter.resizeDisplay(cssWidth, cssHeight, pixelRatio);
  // Otro tamaño de pantalla es otra carga: el modelo de coste ajustado con el
  // tamaño anterior ya no describe nada.
  if (changed) resolutionController.invalidateModel();
  applyInternalScale();
}

/**
 * `ResizeObserver` en lugar de `getBoundingClientRect()` por frame. Medir el DOM
 * dentro del bucle de render fuerza al navegador a recalcular estilo y
 * distribución en cada frame, y ese coste no aparece en ninguna estadística del
 * rasterizador: se ve solo como tirones.
 */
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  const box = entry.contentRect;
  if (box.width === cssWidth && box.height === cssHeight) return;
  cssWidth = box.width;
  cssHeight = box.height;
  applyDisplaySize();
});
resizeObserver.observe(canvas);

/**
 * Aplica la decisión del controlador de resolución. Toda la matemática vive en
 * `resolutionController.ts`; aquí solo se traduce a un cambio de buffer.
 */
function updateDynamicResolution(smoothedMilliseconds: number, now: number): void {
  if (!dynamicResolution) return;
  const decision = resolutionController.update(
    smoothedMilliseconds,
    renderer.width * renderer.height,
    maximumResolutionScale,
    now,
  );
  if (decision.changed) applyInternalScale();
}

/**
 * Importación de modelos en el navegador.
 *
 * Los lectores de GLB y OBJ no usan ninguna API de Node —solo `DataView`,
 * `TextDecoder` y aritmética—, así que el mismo código que corre en el CLI de
 * agentes corre aquí sin adaptador. Lo único que había que añadir es de dónde
 * viene el `ArrayBuffer`.
 */
let meshoptDecoder: MeshoptDecoderLike | null | undefined;

/**
 * Decodificador de meshopt, cargado bajo demanda con `import()` dinámico.
 *
 * Vite lo separa en su propio fragmento, así que quien nunca abra un GLB comprimido
 * no descarga un solo byte de él: el bundle base sigue sin dependencias. Y si el
 * paquete no está instalado, el lector devuelve el error que dice qué instalar en vez
 * de geometría corrupta.
 */
async function getMeshoptDecoder(): Promise<MeshoptDecoderLike | undefined> {
  if (meshoptDecoder !== undefined) return meshoptDecoder ?? undefined;
  try {
    const { MeshoptDecoder } = await import("meshoptimizer");
    await MeshoptDecoder.ready;
    meshoptDecoder = MeshoptDecoder as unknown as MeshoptDecoderLike;
  } catch {
    meshoptDecoder = null;
  }
  return meshoptDecoder ?? undefined;
}

async function loadModelFromBuffer(
  name: string,
  data: ArrayBuffer,
  /** Texto a mostrar. Separado del nombre porque el formato se detecta por extensión. */
  label = name,
): Promise<void> {
  const lowered = name.toLowerCase();
  let model: Model;

  if (lowered.endsWith(".glb")) {
    const { parts, notes } = parseGlb(data, await getMeshoptDecoder());
    model = { source: name, parts, notes };
  } else if (lowered.endsWith(".obj")) {
    const { parts, notes } = parseObj(new TextDecoder().decode(data));
    model = { source: name, parts, notes };
  } else {
    throw new Error(`extensión no reconocida en ${name}; se admiten .glb y .obj`);
  }

  dedupeNames(model.parts);
  const nodes = toSceneNodes(model);
  if (nodes.length === 0) throw new Error(`${name} no contiene geometría visible`);

  // Suelo bajo el modelo. Sin él no hay referencia de escala, ni sombra de contacto,
  // ni horizonte: el objeto flota en negro y cuesta leer su volumen. Se dimensiona y
  // se coloca según la caja envolvente del propio modelo.
  activeNodes = [createGroundForModel(nodes), ...nodes];
  usingDemoScene = false;
  applyAmbience(ESTUDIO);
  loadedModelName = `${label.split("/").pop()} · ${model.parts.length} piezas`;
  sceneTriangles = countTriangles(nodes);

  // El modo paralelo queda inhabilitado con un modelo cargado, y no es un descuido:
  // cada worker reconstruye la escena de demostración a partir del tiempo, que es
  // una función pura, pero no tiene forma de conocer un fichero que el usuario acaba
  // de soltar. Enviarles la malla entera por mensaje en cada frame costaría más de lo
  // que el paralelismo ahorra.
  parallel = false;
  const parallelBox = document.querySelector<HTMLInputElement>("#parallel");
  if (parallelBox) {
    parallelBox.checked = false;
    parallelBox.disabled = true;
  }

  frameCameraToNodes(nodes);
  updateSceneLabel();
}

/**
 * Caja envolvente en mundo de un conjunto de nodos. Se recorre vértice a vértice
 * porque es exacta y solo se hace al importar.
 */
function computeWorldBounds(nodes: readonly SceneNode[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
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
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Suelo a la altura de la base del modelo, con casillas de tamaño legible. */
function createGroundForModel(nodes: readonly SceneNode[]): SceneNode {
  const { min, max } = computeWorldBounds(nodes);
  const footprint = Math.max(max[0] - min[0], max[2] - min[2], 1e-3);
  const size = footprint * 8;
  // Casilla de un octavo de la huella: suficientes para dar escala, pocas para no
  // convertir el suelo en ruido de alta frecuencia bajo el objeto.
  const tile = footprint / 8;

  const model = identity(mat4());
  model[3] = (min[0] + max[0]) / 2;
  model[7] = min[1];
  model[11] = (min[2] + max[2]) / 2;

  return {
    mesh: createPlane(size, 1),
    model,
    castsShadow: false,
    material: {
      albedo: [0.34, 0.36, 0.4],
      specular: 0.04,
      shininess: 12,
      checker: true,
      checkerScale: Math.max(2, Math.round(size / tile)),
      checkerTileWorldSize: tile,
    },
  };
}

/** Encuadra la cámara orbital a la caja envolvente del modelo. */
function frameCameraToNodes(nodes: readonly SceneNode[]): void {
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
  if (minX > maxX) return;

  camera.target[0] = (minX + maxX) / 2;
  camera.target[1] = (minY + maxY) / 2;
  camera.target[2] = (minZ + maxZ) / 2;

  const radius = Math.max(1e-3, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  orbitRadius = radius / Math.sin((camera.fovYDegrees * Math.PI) / 360) / 1.6;
  // Los planos de recorte tienen que seguir la escala del modelo: un objeto en
  // milímetros con `near = 0.1` se recorta entero, y uno en kilómetros con
  // `far = 200` desaparece. El z-buffer invertido tolera el rango amplio.
  camera.near = Math.max(1e-4, radius * 0.01);
  camera.far = radius * 40;
  applyOrbit();
}

function restoreDemoScene(): void {
  activeNodes = demoScene;
  usingDemoScene = true;
  applyAmbience(ATMOSFERA);
  loadedModelName = "";
  sceneTriangles = countTriangles(demoScene);
  camera.target[0] = 0;
  camera.target[1] = 1.2;
  camera.target[2] = -2;
  camera.near = 0.1;
  camera.far = 200;
  orbitRadius = 13;
  const parallelBox = document.querySelector<HTMLInputElement>("#parallel");
  if (parallelBox) parallelBox.disabled = parallelRenderer === null;
  applyOrbit();
  updateSceneLabel();
}

function updateSceneLabel(): void {
  const label = document.querySelector<HTMLElement>("#scene-label");
  if (label) label.textContent = usingDemoScene ? "escena de demostración" : loadedModelName;
}

function reportImportError(error: unknown): void {
  const label = document.querySelector<HTMLElement>("#scene-label");
  const message = error instanceof Error ? error.message : String(error);
  if (label) label.textContent = message;
  console.error(message);
}

async function handleFile(file: File): Promise<void> {
  try {
    await loadModelFromBuffer(file.name, await file.arrayBuffer());
  } catch (error) {
    reportImportError(error);
  }
}

// Cámara orbital en coordenadas esféricas alrededor de `target`.
let orbitYaw = Math.atan2(camera.position[0] - camera.target[0], camera.position[2] - camera.target[2]);
let orbitPitch = 0.32;
let orbitRadius = Math.hypot(
  camera.position[0] - camera.target[0],
  camera.position[1] - camera.target[1],
  camera.position[2] - camera.target[2],
);
let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

function applyOrbit(): void {
  const clampedPitch = Math.max(-1.35, Math.min(1.35, orbitPitch));
  orbitPitch = clampedPitch;
  const horizontal = Math.cos(clampedPitch) * orbitRadius;
  camera.position[0] = camera.target[0] + Math.sin(orbitYaw) * horizontal;
  camera.position[1] = camera.target[1] + Math.sin(clampedPitch) * orbitRadius;
  camera.position[2] = camera.target[2] + Math.cos(orbitYaw) * horizontal;
}

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  orbitYaw -= (event.clientX - lastPointerX) * 0.006;
  orbitPitch += (event.clientY - lastPointerY) * 0.005;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  applyOrbit();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    orbitRadius = Math.max(1.5, Math.min(60, orbitRadius * (1 + Math.sign(event.deltaY) * 0.08)));
    applyOrbit();
  },
  { passive: false },
);

function bindSelect<T extends string>(id: string, apply: (value: T) => void): void {
  const element = document.querySelector<HTMLSelectElement>(id);
  element?.addEventListener("change", () => apply(element.value as T));
}

function bindCheckbox(id: string, apply: (value: boolean) => void): void {
  const element = document.querySelector<HTMLInputElement>(id);
  element?.addEventListener("change", () => apply(element.checked));
}

function bindRange(id: string, apply: (value: number) => void, format?: (value: number) => string): void {
  const element = document.querySelector<HTMLInputElement>(id);
  const readout = document.querySelector<HTMLElement>(`${id}-value`);
  if (!element) return;
  const sync = () => {
    const value = Number(element.value);
    apply(value);
    if (readout) readout.textContent = format ? format(value) : String(value);
  };
  element.addEventListener("input", sync);
  sync();
}

bindSelect<ShadingMode>("#shading", (value) => {
  options.shadingMode = value;
});
bindSelect<"perspective" | "orthographic">("#projection", (value) => {
  camera.projection = value;
  document.querySelector("#fov-row")?.classList.toggle("is-disabled", value === "orthographic");
  document.querySelector("#ortho-row")?.classList.toggle("is-disabled", value === "perspective");
});
bindCheckbox("#wireframe", (value) => {
  options.wireframe = value;
});
bindCheckbox("#perspective-correct", (value) => {
  options.perspectiveCorrect = value;
});
bindCheckbox("#cull", (value) => {
  options.cullMode = value ? CullMode.Back : CullMode.None;
});
bindCheckbox("#shadows", (value) => {
  options.shadows = value;
});
bindCheckbox("#soft-shadows", (value) => {
  options.shadowSamples = value ? 4 : 1;
});
bindCheckbox("#frustum", (value) => {
  options.frustumCulling = value;
});
bindCheckbox("#antialias", (value) => {
  antialiasRequested = value;
  options.antialias = value && resolutionController.currentScale <= 1.05;
});
bindCheckbox("#parallel", (value) => {
  parallel = value && parallelRenderer !== null;
});
const parallelCheckbox = document.querySelector<HTMLInputElement>("#parallel");
if (parallelCheckbox) {
  parallelCheckbox.checked = parallel;
  parallelCheckbox.disabled = parallelRenderer === null;
}
const parallelLabel = document.querySelector<HTMLElement>("#parallel-label");
if (parallelLabel) parallelLabel.textContent = `Paralelo (${workerCount} hilos)`;
bindCheckbox("#dynamic-resolution", (value) => {
  dynamicResolution = value;
  if (!value) {
    resolutionController.setScale(maximumResolutionScale);
    applyInternalScale();
  }
});
bindRange("#fov", (value) => {
  camera.fovYDegrees = value;
}, (value) => `${value}°`);
bindRange("#ortho", (value) => {
  camera.orthoHalfHeight = value;
});
bindRange("#near", (value) => {
  camera.near = value;
}, (value) => value.toFixed(2));
bindRange("#resolution", (value) => {
  // El deslizador fija el techo; con resolución dinámica activa el controlador se
  // mueve por debajo de él, y sin ella se clava en el techo.
  maximumResolutionScale = value / 100;
  if (!dynamicResolution || resolutionController.currentScale > maximumResolutionScale) {
    resolutionController.setScale(maximumResolutionScale);
  }
  applyInternalScale();
}, (value) => `${value}%`);

// Importación: selector de fichero, arrastrar y soltar sobre el lienzo, y una URL
// para cargar el dron de ejemplo que ya vive en el repositorio.
document.querySelector<HTMLInputElement>("#model-file")?.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void handleFile(file);
});

document.querySelector<HTMLButtonElement>("#load-demo-model")?.addEventListener("click", () => {
  const label = document.querySelector<HTMLElement>("#scene-label");
  if (label) label.textContent = "cargando…";
  void fetch("/artifacts/export/drone.glb")
    .then((response) => {
      if (!response.ok) throw new Error(`no se pudo leer el modelo (${response.status})`);
      return response.arrayBuffer();
    })
    .then((data) => loadModelFromBuffer("drone.glb", data))
    .catch(reportImportError);
});

document.querySelector<HTMLButtonElement>("#load-compressed-model")?.addEventListener("click", () => {
  const label = document.querySelector<HTMLElement>("#scene-label");
  if (label) label.textContent = "cargando y descomprimiendo…";
  void fetch("/models/drone.glb")
    .then((response) => {
      if (!response.ok) throw new Error(`no se pudo leer el modelo (${response.status})`);
      return response.arrayBuffer();
    })
    .then((data) => loadModelFromBuffer("drone.glb", data, "drone.glb · meshopt"))
    .catch(reportImportError);
});

document.querySelector<HTMLButtonElement>("#restore-scene")?.addEventListener("click", restoreDemoScene);

for (const eventName of ["dragenter", "dragover"] as const) {
  canvas.addEventListener(eventName, (event) => {
    event.preventDefault();
    canvas.classList.add("is-dropping");
  });
}
canvas.addEventListener("dragleave", () => canvas.classList.remove("is-dropping"));
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  canvas.classList.remove("is-dropping");
  const file = event.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});
updateSceneLabel();

applyOrbit();
// Tamaño inicial: `ResizeObserver` dispara al observar, pero puede llegar después
// del primer frame, y arrancar con un buffer de 2×2 daría un frame en negro.
{
  const bounds = canvas.getBoundingClientRect();
  cssWidth = bounds.width;
  cssHeight = bounds.height;
  applyDisplaySize();
}
// Cambio de monitor o de zoom: el tamaño CSS puede no cambiar pero el dpr sí.
window.addEventListener("resize", applyDisplaySize);

declare global {
  interface Window {
    /** Estado del último frame del bucle vivo, para inspección externa. */
    __softLive?: {
      smoothedMilliseconds: number;
      resolutionScale: number;
      width: number;
      height: number;
      stats: FrameStats;
    };
    /** Estado del controlador de resolución, para diagnóstico. */
    __softResolution?: () => unknown;
    __softBench?: (
      frames?: number,
      width?: number,
      height?: number,
      overrides?: Partial<RenderOptions>,
    ) => BenchResult;
    __softBenchParallel?: (
      workers?: number,
      frames?: number,
      width?: number,
      height?: number,
    ) => Promise<ParallelBenchResult>;
  }
}
window.__softResolution = () => ({
  ...resolutionController.diagnostics,
  maximumResolutionScale,
  dynamicResolution,
  internal: [renderer.width, renderer.height],
  display: [presenter.width, presenter.height],
});
window.__softBench = (frames = 60, width = 640, height = 400, overrides = {}) =>
  runBenchmark(demoScene, frames, width, height, overrides);

/**
 * Mide con un pool propio del tamaño pedido y lo destruye al terminar, para que
 * comparar 1, 2, 4 hilos no arrastre workers de la medida anterior compitiendo
 * por los mismos núcleos.
 */
window.__softBenchParallel = async (workers = 2, frames = 16, width = 640, height = 400) => {
  const pool = new ParallelRenderer(workers);
  try {
    return await runParallelBenchmark(pool, presenter.bandContext, frames, width, height);
  } finally {
    pool.dispose();
  }
};

/**
 * `?bench` mide y no arranca el bucle vivo: el bucle competiría por el mismo
 * hilo y los tiempos dejarían de ser comparables entre ejecuciones.
 */
const benchParameter = new URLSearchParams(location.search).get("bench");
if (benchParameter !== null) {
  const frames = Number(benchParameter) || 24;
  const result = runBenchmark(demoScene, frames, 640, 400);
  hud.textContent = Object.entries(result)
    .map(([key, value]) => `${key.padEnd(22)} ${value}`)
    .join("\n");
  console.info("bench", result);
} else {
  requestAnimationFrame(frame);
}

let smoothedFrameTime = 16;
let hudTimer = 0;
const startTime = performance.now();
let lastFrameTimestamp = startTime;

/**
 * Constante de tiempo del suavizado, en segundos. El factor por frame se deriva
 * del paso de tiempo real:
 *
 *   alpha = 1 - exp(-dt / tau)
 *
 * Un factor fijo (el clásico `x += (objetivo - x) * 0.1`) mide en frames, no en
 * segundos: a 20 fps suaviza tres veces más lento que a 60 y la lectura se
 * vuelve pastosa justo cuando hace falta que responda. Con esta forma, el
 * suavizado tarda lo mismo en tiempo real a cualquier frame rate.
 */
const SMOOTHING_TAU_SECONDS = 0.25;

let lastParallelStats: ParallelFrameStats | null = null;


/**
 * Pinta el HUD. Recibe `null` cuando el frame se reutilizó tal cual, porque en ese
 * caso las estadísticas del renderizador son las del último dibujado y anunciarlas
 * como si fueran de este frame sería mentir.
 */
function updateHud(stats: FrameStats | null): void {
  const megapixels = (renderer.width * renderer.height) / 1e6;
  const refinement = refinementLevel > 0 ? `  ·  refinado ×${REFINEMENT_STEPS[refinementLevel]}` : "";
  const lines = [
    stats === null
      ? `${smoothedFrameTime.toFixed(1)} ms  ·  imagen reutilizada (${reusedFrames} frames sin redibujar)`
      : `${smoothedFrameTime.toFixed(1)} ms  ·  ${(1000 / Math.max(smoothedFrameTime, 0.01)).toFixed(0)} fps`,
    `buffer ${renderer.width}×${renderer.height} (${megapixels.toFixed(2)} MP)  ·  pantalla ${presenter.width}×${presenter.height}  ·  escala ${(resolutionController.currentScale * 100).toFixed(0)}%${dynamicResolution ? " auto" : ""}${refinement}`,
    (() => {
      const model = resolutionController.diagnostics;
      if (model.fixedMilliseconds === null) return "modelo de coste  midiendo…";
      return `modelo de coste  fijo ${model.fixedMilliseconds.toFixed(1)} ms  ·  ${model.millisecondsPerMegapixel?.toFixed(0)} ms/MP${model.fixedBound ? "  ·  LIMITADO POR COSTE FIJO: bajar resolución no ayuda" : ""}`;
    })(),
  ];

  if (stats !== null) {
    const skipped = stats.pixelsInBoundingBox - stats.pixelsTested;
    lines.push(
      `objetos  dibujados ${stats.nodesDrawn}  ·  frustum ${stats.nodesCulled}`,
      `triángulos  escena ${sceneTriangles}  ·  rasterizados ${stats.trianglesRasterized}  ·  culling ${stats.trianglesCulled}  ·  rechazo trivial ${stats.trianglesRejected}  ·  recortados ${stats.trianglesClipped}`,
      `píxeles  recorridos ${stats.pixelsTested.toLocaleString("es")}  ·  sombreados ${stats.pixelsShaded.toLocaleString("es")}  ·  saltados por span ${skipped.toLocaleString("es")}`,
      lastParallelStats
        ? `${workerCount} hilos  ·  banda lenta ${lastParallelStats.criticalPathMilliseconds.toFixed(1)} ms  ·  suma ${lastParallelStats.totalWorkerMilliseconds.toFixed(1)} ms  ·  equilibrio ${(lastParallelStats.balance * 100).toFixed(0)}%  ·  volcado ${lastParallelStats.blitMilliseconds.toFixed(1)} ms`
        : `1 hilo  ·  vértices ${stats.vertexMilliseconds.toFixed(2)} ms  ·  sombras ${stats.shadowMilliseconds.toFixed(2)} ms  ·  rasterizado ${(stats.totalMilliseconds - stats.vertexMilliseconds - stats.postprocessMilliseconds - stats.shadowMilliseconds).toFixed(2)} ms  ·  antialias ${stats.postprocessMilliseconds.toFixed(2)} ms`,
    );
    if (lastParallelStats) lines.push(`filas por banda  ${lastParallelStats.bandRows.join(" · ")}`);
  }

  hud.textContent = lines.join("\n");
}

async function frame(): Promise<void> {
  const now = performance.now();
  const deltaSeconds = Math.min(0.25, (now - lastFrameTimestamp) / 1000) || 1 / 60;
  lastFrameTimestamp = now;

  const time = (now - startTime) / 1000;
  if (usingDemoScene && !parallel) updateScene(demoScene, time);

  // ¿Cambió algo? Si no, o se refina o no se dibuja nada en absoluto.
  const signature = computeFrameSignature();
  if (signature === frameSignature) {
    idleFrames += 1;
    if (refinementLevel < REFINEMENT_STEPS.length - 1 && idleFrames >= 2) {
      refinementLevel += 1;
      idleFrames = 0;
      applyInternalScale();
      // Cae al render de abajo con la resolución ya subida.
    } else {
      // Nada que redibujar: el lienzo ya contiene exactamente esta imagen.
      reusedFrames += 1;
      hudTimer += 1;
      if (hudTimer % 6 === 0) updateHud(null);
      requestAnimationFrame(frame);
      return;
    }
  } else {
    idleFrames = 0;
    if (refinementLevel !== 0) {
      refinementLevel = 0;
      applyInternalScale();
    }
  }

  let stats: FrameStats;
  if (parallel && parallelRenderer) {
    // La escena la anima cada worker con el mismo `time`: es función pura del
    // tiempo, así que las copias coinciden sin transmitir matrices. Las bandas se
    // vuelcan al canvas intermedio, no al visible.
    lastParallelStats = await parallelRenderer.renderFrame(
      time,
      camera,
      options,
      presenter.bandContext,
    );
    stats = lastParallelStats.stats;
  } else {
    lastParallelStats = null;
    stats = renderer.render(activeNodes, camera, options);
    presenter.writeFramebuffer(renderer.framebuffer);
  }
  presenter.flush();
  // La firma se toma **después** de renderizar: `applyInternalScale` pudo cambiar el
  // tamaño del buffer, y la firma incluye ese tamaño.
  frameSignature = computeFrameSignature();

  const alpha = 1 - Math.exp(-deltaSeconds / SMOOTHING_TAU_SECONDS);
  smoothedFrameTime += (stats.totalMilliseconds - smoothedFrameTime) * alpha;

  hudTimer += 1;
  window.__softLive = {
    smoothedMilliseconds: smoothedFrameTime,
    resolutionScale: resolutionController.currentScale,
    width: renderer.width,
    height: renderer.height,
    stats,
  };
  if (hudTimer % 6 === 0 || hudTimer === 2) {
    updateDynamicResolution(smoothedFrameTime, now);
    updateHud(stats);
  }

  requestAnimationFrame(frame);
}
