/**
 * Comparación de dos pliegos: qué cambió, cuánto, dónde y de qué pieza.
 *
 * Es lo que convierte «creo que el parche funcionó» en «sé que funcionó». Con
 * renders deterministas, dos ejecuciones sin cambios dan cero píxeles distintos
 * exacto, así que cualquier cifra distinta de cero es información, no ruido —el
 * mismo criterio que ya sostiene los contadores del rasterizador, aplicado a la
 * imagen.
 *
 * Tres decisiones, cada una contra un modo de fallo concreto:
 *
 * 1. UMBRAL DE TRES NIVELES. El pliego lleva dither, y un dither que cae en otro
 *    píxel no es un cambio del modelo. Por debajo de tres niveles de 255 no se
 *    reporta nada.
 *
 * 2. REGIONES POR REJILLA, NO POR PÍXEL. Etiquetar componentes conexas exactas
 *    cuesta y no aporta: lo que el agente necesita es «mira por aquí». Se marcan
 *    celdas de 16 píxeles y se unen las vecinas, que da regiones útiles con un
 *    recorrido y sin estructuras de unión-búsqueda.
 *
 * 3. ATRIBUCIÓN CONTRA TODAS LAS PIEZAS, NO SOLO LAS AUDITADAS. El informe
 *    publica las cajas de las piezas auditadas para no gastar contexto, pero
 *    atribuir una región solo a esas diría «no sé» justo cuando el cambio está
 *    fuera de la selección, que es el caso interesante.
 */

import type { ContactSheet } from "./contactSheet";
import { familyOf } from "./model";

/** Imagen ya decodificada, RGBA de 8 bits. */
export interface RasterImage {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DiffRegion {
  view: string;
  /** `[x0, y0, x1, y1]` en píxeles del pliego. */
  bbox: [number, number, number, number];
  changedPixels: number;
  /** Piezas cuya caja en pantalla toca la región, de mayor a menor solape. */
  parts: string[];
}

export interface RenderDiff {
  /** Fracción del pliego que cambió. Cero exacto si no cambió nada. */
  changedPixels: number;
  byView: Record<string, number>;
  regions: DiffRegion[];
}

/** Diferencia por canal a partir de la cual un píxel cuenta como cambiado. */
const THRESHOLD = 3;
const CELL = 16;
const MAX_REGIONS = 12;
const MAX_PARTS_PER_REGION = 6;

type Box = readonly [number, number, number, number];

/**
 * Compara el pliego recién renderizado con uno anterior ya decodificado.
 *
 * `boxesByView` son las cajas en pantalla de las piezas —las de todas, no las que
 * se publican— para poder decir qué hay dentro de cada región.
 */
export function diffSheets(
  sheet: ContactSheet,
  baseline: RasterImage,
  boxesByView: Record<string, Record<string, Box>> = {},
): RenderDiff {
  if (baseline.width !== sheet.width || baseline.height !== sheet.height) {
    throw new Error(
      `el pliego de referencia mide ${baseline.width}×${baseline.height} y el actual ${sheet.width}×${sheet.height}; ` +
        "compara pliegos hechos con el mismo --tile y las mismas vistas",
    );
  }

  const { width, height, tileSize } = sheet;
  // La rejilla se construye por tile, no sobre el pliego entero: así el borde de un
  // tile cae siempre en el borde de una celda y una región nunca puede unir dos
  // vistas, que daría una caja sin sentido y una atribución falsa.
  const perTile = Math.ceil(tileSize / CELL);
  const cellsX = sheet.columns * perTile;
  const cellsY = sheet.rows * perTile;
  const cellCounts = new Int32Array(cellsX * cellsY);

  let changed = 0;
  const perView = new Map<string, number>();
  for (const view of sheet.views) perView.set(view.name, 0);
  // Índice inverso: qué vista ocupa cada casilla de la rejilla del pliego.
  const viewAt = (x: number, y: number): string | null => {
    const column = Math.floor(x / tileSize);
    const row = Math.floor(y / tileSize);
    const view = sheet.views.find((entry) => entry.column === column && entry.row === row);
    return view ? view.name : null;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const delta = Math.max(
        Math.abs(sheet.pixels[index] - baseline.pixels[index]),
        Math.abs(sheet.pixels[index + 1] - baseline.pixels[index + 1]),
        Math.abs(sheet.pixels[index + 2] - baseline.pixels[index + 2]),
      );
      if (delta <= THRESHOLD) continue;

      changed += 1;
      const column = Math.floor(x / tileSize);
      const row = Math.floor(y / tileSize);
      const cellX = column * perTile + Math.floor((x - column * tileSize) / CELL);
      const cellY = row * perTile + Math.floor((y - row * tileSize) / CELL);
      cellCounts[cellY * cellsX + cellX] += 1;
      const name = viewAt(x, y);
      if (name !== null) perView.set(name, (perView.get(name) ?? 0) + 1);
    }
  }

  const byView: Record<string, number> = {};
  for (const [name, count] of perView) {
    byView[name] = Number((count / (tileSize * tileSize)).toFixed(4));
  }

  return {
    changedPixels: Number((changed / (width * height)).toFixed(6)),
    byView,
    regions:
      changed > 0
        ? buildRegions(
            { counts: cellCounts, cellsX, cellsY, perTile, tileSize, width, height },
            viewAt,
            boxesByView,
          )
        : [],
  };
}

/** Rejilla de celdas del pliego, alineada con los tiles. */
interface CellGrid {
  counts: Int32Array;
  cellsX: number;
  cellsY: number;
  perTile: number;
  tileSize: number;
  width: number;
  height: number;
}

/** Píxeles que cubre una celda, recortados al tile al que pertenece. */
function cellBounds(grid: CellGrid, cellX: number, cellY: number): Box {
  const column = Math.floor(cellX / grid.perTile);
  const row = Math.floor(cellY / grid.perTile);
  const x0 = column * grid.tileSize + (cellX % grid.perTile) * CELL;
  const y0 = row * grid.tileSize + (cellY % grid.perTile) * CELL;
  return [
    x0,
    y0,
    Math.min(x0 + CELL, (column + 1) * grid.tileSize, grid.width),
    Math.min(y0 + CELL, (row + 1) * grid.tileSize, grid.height),
  ];
}

/**
 * Une celdas marcadas vecinas —cuatro direcciones— en regiones, con un recorrido
 * en anchura sobre la propia rejilla. Devuelve las mayores primero: si hay que
 * cortar la lista, que sobre lo pequeño.
 */
function buildRegions(
  grid: CellGrid,
  viewAt: (x: number, y: number) => string | null,
  boxesByView: Record<string, Record<string, Box>>,
): DiffRegion[] {
  const { counts, cellsX, cellsY, perTile } = grid;
  const visited = new Uint8Array(counts.length);
  const regions: DiffRegion[] = [];

  for (let start = 0; start < counts.length; start += 1) {
    if (visited[start] || counts[start] === 0) continue;

    const queue = [start];
    visited[start] = 1;
    const startTileX = Math.floor((start % cellsX) / perTile);
    const startTileY = Math.floor(Math.floor(start / cellsX) / perTile);
    let bbox: [number, number, number, number] | null = null;
    let changedPixels = 0;

    while (queue.length > 0) {
      const cell = queue.pop() as number;
      const cellX = cell % cellsX;
      const cellY = Math.floor(cell / cellsX);
      changedPixels += counts[cell];
      const bounds = cellBounds(grid, cellX, cellY);
      bbox = bbox
        ? [
            Math.min(bbox[0], bounds[0]),
            Math.min(bbox[1], bounds[1]),
            Math.max(bbox[2], bounds[2]),
            Math.max(bbox[3], bounds[3]),
          ]
        : [bounds[0], bounds[1], bounds[2], bounds[3]];

      const neighbours = [
        cellX > 0 ? cell - 1 : -1,
        cellX + 1 < cellsX ? cell + 1 : -1,
        cellY > 0 ? cell - cellsX : -1,
        cellY + 1 < cellsY ? cell + cellsX : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || visited[neighbour] || counts[neighbour] === 0) continue;
        // No se cruza el borde del tile: cada región pertenece a una sola vista.
        if (Math.floor((neighbour % cellsX) / perTile) !== startTileX) continue;
        if (Math.floor(Math.floor(neighbour / cellsX) / perTile) !== startTileY) continue;
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }

    if (bbox === null) continue;
    const view = viewAt(bbox[0], bbox[1]) ?? "";
    regions.push({
      view,
      bbox,
      changedPixels,
      parts: partsInRegion(boxesByView[view] ?? {}, grid, bbox),
    });
  }

  regions.sort((a, b) => b.changedPixels - a.changedPixels);
  return regions.slice(0, MAX_REGIONS);
}

/**
 * Píxeles cambiados dentro de una caja, contados con la resolución de la rejilla:
 * una celda que asome por el borde cuenta entera. La caja es de una pieza y las
 * piezas viven dentro de un tile, así que el rango de celdas sale de una división.
 */
function changeInBox(grid: CellGrid, box: Box): number {
  const column = Math.floor(box[0] / grid.tileSize);
  const row = Math.floor(box[1] / grid.tileSize);
  const cellX0 = column * grid.perTile + Math.floor((box[0] - column * grid.tileSize) / CELL);
  const cellY0 = row * grid.perTile + Math.floor((box[1] - row * grid.tileSize) / CELL);
  const cellX1 =
    column * grid.perTile +
    Math.ceil((Math.min(box[2], (column + 1) * grid.tileSize) - column * grid.tileSize) / CELL);
  const cellY1 =
    row * grid.perTile +
    Math.ceil((Math.min(box[3], (row + 1) * grid.tileSize) - row * grid.tileSize) / CELL);

  let total = 0;
  for (let cellY = Math.max(0, cellY0); cellY < Math.min(grid.cellsY, cellY1); cellY += 1) {
    for (let cellX = Math.max(0, cellX0); cellX < Math.min(grid.cellsX, cellX1); cellX += 1) {
      total += grid.counts[cellY * grid.cellsX + cellX];
    }
  }
  return total;
}

/**
 * Piezas responsables de una región, **una por familia** y ordenadas por fracción de
 * su propia caja que ha cambiado, multiplicada por lo que ha cambiado.
 *
 * Tres correcciones, cada una contra una lista inútil que salió al probarlo:
 *
 * - Por **solape** con la región mandaban las piezas grandes: el fuselaje firmaba
 *   cualquier cambio porque su caja cubre media vista.
 * - Por **fracción** sola mandaban las diminutas: veintidós tornillos ocultos con
 *   la caja entera cambiada tapaban a la hélice que se movió.
 * - Sin **colapsar familias**, esos mismos veintidós tornillos —que para el agente
 *   son un solo hecho— llenaban los seis huecos de la lista.
 */
function partsInRegion(boxes: Record<string, Box>, grid: CellGrid, region: Box): string[] {
  const best = new Map<string, { name: string; score: number }>();
  for (const [name, box] of Object.entries(boxes)) {
    if (box[2] <= region[0] || box[0] >= region[2]) continue;
    if (box[3] <= region[1] || box[1] >= region[3]) continue;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (area <= 0) continue;
    const inside = changeInBox(grid, box);
    // Por debajo de este umbral la pieza solo estaba cerca del cambio.
    if (inside / area < 0.05) continue;

    const family = familyOf(name);
    const score = (inside * inside) / area;
    const previous = best.get(family);
    if (previous === undefined || score > previous.score) best.set(family, { name, score });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PARTS_PER_REGION)
    .map((entry) => entry.name);
}
