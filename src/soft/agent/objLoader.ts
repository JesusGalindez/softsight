/**
 * Lector y escritor de OBJ (Wavefront), sin dependencias.
 *
 * El formato es texto y con tres trampas que rompen a los lectores ingenuos:
 * los índices empiezan en 1 y pueden ser **negativos** (relativos al final de lo
 * declarado hasta ese momento); una cara puede tener más de tres vértices; y un
 * vértice del OBJ es la *terna* posición/UV/normal, no la posición, así que dos
 * caras que comparten posición pero no normal necesitan vértices distintos.
 *
 * Se escribe también OBJ porque es el camino de vuelta más corto: un agente aplica
 * un parche, exporta y el resultado abre en cualquier herramienta. Exportar GLB
 * exige construir accesores, vistas y búferes alineados, y eso queda pendiente.
 */

import { identity, mat4 } from "../math";
import { computeNormals, type Mesh } from "../mesh";
import type { Model, ModelPart } from "./model";

interface Group {
  name: string;
  materialName: string | null;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** Terna "p/t/n" -> índice de vértice ya emitido, para no duplicar. */
  lookup: Map<string, number>;
  hasNormals: boolean;
}

function createGroup(name: string, materialName: string | null): Group {
  return {
    name,
    materialName,
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
    lookup: new Map(),
    hasNormals: false,
  };
}

/** Índice OBJ -> índice base 0. Negativo cuenta desde el final. */
function resolveIndex(raw: number, total: number): number {
  return raw > 0 ? raw - 1 : total + raw;
}

export function parseObj(text: string): { parts: ModelPart[]; notes: string[] } {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const notes: string[] = [];
  const groups: Group[] = [];

  let current = createGroup("default", null);
  let currentMaterial: string | null = null;
  groups.push(current);

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const keyword = parts[0];

    switch (keyword) {
      case "v":
        positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
        break;
      case "vn":
        normals.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
        break;
      case "vt":
        uvs.push(Number(parts[1]), Number(parts[2] ?? 0));
        break;
      case "usemtl":
        currentMaterial = parts[1] ?? null;
        // Un cambio de material dentro de un grupo crea una pieza nueva: es la
        // única forma de que el agente pueda direccionar cada material por separado.
        if (current.indices.length > 0) {
          current = createGroup(`${current.name}-${currentMaterial ?? "mat"}`, currentMaterial);
          groups.push(current);
        } else {
          current.materialName = currentMaterial;
        }
        break;
      case "o":
      case "g": {
        const name = parts.slice(1).join(" ") || `grupo${groups.length}`;
        if (current.indices.length === 0) {
          current.name = name;
        } else {
          current = createGroup(name, currentMaterial);
          groups.push(current);
        }
        break;
      }
      case "f": {
        const corners = parts.slice(1);
        const emitted: number[] = [];
        for (const corner of corners) {
          const [rawPosition, rawUv, rawNormal] = corner.split("/");
          const key = corner;
          let vertex = current.lookup.get(key);
          if (vertex === undefined) {
            vertex = current.positions.length / 3;
            const positionIndex = resolveIndex(Number(rawPosition), positions.length / 3);
            current.positions.push(
              positions[positionIndex * 3],
              positions[positionIndex * 3 + 1],
              positions[positionIndex * 3 + 2],
            );

            if (rawNormal) {
              const normalIndex = resolveIndex(Number(rawNormal), normals.length / 3);
              current.normals.push(
                normals[normalIndex * 3],
                normals[normalIndex * 3 + 1],
                normals[normalIndex * 3 + 2],
              );
              current.hasNormals = true;
            } else {
              current.normals.push(0, 0, 0);
            }

            if (rawUv) {
              const uvIndex = resolveIndex(Number(rawUv), uvs.length / 2);
              current.uvs.push(uvs[uvIndex * 2], uvs[uvIndex * 2 + 1]);
            } else {
              current.uvs.push(0, 0);
            }

            current.lookup.set(key, vertex);
          }
          emitted.push(vertex);
        }

        // Abanico desde el primer vértice: válido para cualquier polígono convexo,
        // que es lo que produce cualquier exportador razonable.
        for (let corner = 1; corner + 1 < emitted.length; corner += 1) {
          current.indices.push(emitted[0], emitted[corner], emitted[corner + 1]);
        }
        break;
      }
      default:
        break; // mtllib, s, vp… no afectan a la geometría que rasterizamos
    }
  }

  const result: ModelPart[] = [];
  for (const group of groups) {
    if (group.indices.length === 0) continue;
    const meshPositions = Float32Array.from(group.positions);
    let boundingRadius = 0;
    for (let vertex = 0; vertex < meshPositions.length; vertex += 3) {
      const distance = Math.hypot(
        meshPositions[vertex],
        meshPositions[vertex + 1],
        meshPositions[vertex + 2],
      );
      if (distance > boundingRadius) boundingRadius = distance;
    }

    const mesh: Mesh = {
      positions: meshPositions,
      normals: Float32Array.from(group.normals),
      uvs: Float32Array.from(group.uvs),
      indices: Uint32Array.from(group.indices),
      boundingRadius,
    };
    if (!group.hasNormals) {
      computeNormals(mesh);
      notes.push(`${group.name}: sin normales en el fichero, calculadas por promediado de caras`);
    }

    result.push({
      name: group.name,
      path: group.name,
      mesh,
      matrix: identity(mat4()),
      materialName: group.materialName,
      baseColor: null,
      visible: true,
    });
  }

  if (result.length === 0) notes.push("el OBJ no contiene caras");
  return { parts: result, notes };
}

/**
 * Serializa el modelo a OBJ, aplicando la matriz de cada pieza: el formato no tiene
 * jerarquía ni transformaciones, así que la geometría sale en espacio de mundo. Es
 * una exportación con pérdida —se pierde la estructura editable— y por eso el
 * fichero de origen sigue siendo la fuente de verdad.
 */
export function serializeObj(model: Model): string {
  const lines: string[] = [`# exportado por el rasterizador software`, `# origen: ${model.source}`];
  let vertexOffset = 1; // OBJ indexa desde 1

  for (const part of model.parts) {
    if (!part.visible) continue;
    const { positions, normals, uvs, indices } = part.mesh;
    const m = part.matrix;
    const vertexCount = positions.length / 3;

    lines.push(`o ${part.name}`);

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      lines.push(
        `v ${(m[0] * x + m[1] * y + m[2] * z + m[3]).toFixed(6)} ${(
          m[4] * x +
          m[5] * y +
          m[6] * z +
          m[7]
        ).toFixed(6)} ${(m[8] * x + m[9] * y + m[10] * z + m[11]).toFixed(6)}`,
      );
    }

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const nx = normals[vertex * 3];
      const ny = normals[vertex * 3 + 1];
      const nz = normals[vertex * 3 + 2];
      // Solo la parte lineal: una normal es una dirección, no un punto.
      lines.push(
        `vn ${(m[0] * nx + m[1] * ny + m[2] * nz).toFixed(6)} ${(
          m[4] * nx +
          m[5] * ny +
          m[6] * nz
        ).toFixed(6)} ${(m[8] * nx + m[9] * ny + m[10] * nz).toFixed(6)}`,
      );
    }

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      lines.push(`vt ${uvs[vertex * 2].toFixed(6)} ${uvs[vertex * 2 + 1].toFixed(6)}`);
    }

    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] + vertexOffset;
      const b = indices[index + 1] + vertexOffset;
      const c = indices[index + 2] + vertexOffset;
      lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
    }

    vertexOffset += vertexCount;
  }

  return `${lines.join("\n")}\n`;
}
