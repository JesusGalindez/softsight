/**
 * Geometría procedural para la escena de prueba. Todo en arrays tipados con
 * layout de vértices indexado, igual que un buffer de GPU: el objetivo es que
 * el coste del pipeline sea el pipeline y no la representación de los datos.
 *
 * Orientación de las caras: antihorario (CCW) visto desde fuera, que es lo que
 * espera el culling de `raster.ts`.
 */

import { cross, normalize, vec3 } from "./math";

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /**
   * Radio de la esfera envolvente centrada en el origen del objeto. Todas las
   * mallas de aquí son simétricas respecto a su origen, así que no hace falta
   * guardar el centro: el descarte por frustum solo necesita centro y radio.
   */
  boundingRadius: number;
  /**
   * Normal geométrica por triángulo, en espacio de objeto. Se calcula bajo demanda
   * y se cachea aquí: es constante mientras la malla no cambie, y es lo que permite
   * descartar caras traseras **antes** de transformar un solo vértice.
   */
  faceNormals?: Float32Array;
}

/**
 * Normales de cara en espacio de objeto, sin normalizar.
 *
 * No hace falta normalizarlas: el descarte solo mira el **signo** de un producto
 * escalar, y una escala positiva no lo cambia. Ahorra una raíz por triángulo.
 */
export function ensureFaceNormals(mesh: Mesh): Float32Array {
  if (mesh.faceNormals !== undefined) return mesh.faceNormals;
  const { positions, indices } = mesh;
  const faceNormals = new Float32Array(indices.length);

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3;
    const b = indices[triangle + 1] * 3;
    const c = indices[triangle + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    faceNormals[triangle] = e1y * e2z - e1z * e2y;
    faceNormals[triangle + 1] = e1z * e2x - e1x * e2z;
    faceNormals[triangle + 2] = e1x * e2y - e1y * e2x;
  }

  mesh.faceNormals = faceNormals;
  return faceNormals;
}

/** Radio máximo desde el origen del objeto. */
function boundingRadiusOf(positions: Float32Array): number {
  let maximum = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const squared =
      positions[i] * positions[i] +
      positions[i + 1] * positions[i + 1] +
      positions[i + 2] * positions[i + 2];
    if (squared > maximum) maximum = squared;
  }
  return Math.sqrt(maximum);
}

export function createBox(width = 1, height = 1, depth = 1): Mesh {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfDepth = depth / 2;

  const faces: Array<{ normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
    {
      normal: [0, 0, 1],
      corners: [
        [-halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [-halfWidth, halfHeight, halfDepth],
      ],
    },
    {
      normal: [0, 0, -1],
      corners: [
        [halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
      ],
    },
    {
      normal: [1, 0, 0],
      corners: [
        [halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
        [halfWidth, halfHeight, halfDepth],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
        [-halfWidth, halfHeight, halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
      ],
    },
    {
      normal: [0, 1, 0],
      corners: [
        [-halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, -halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, -halfHeight, halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
      ],
    },
  ];

  const positions = new Float32Array(faces.length * 4 * 3);
  const normals = new Float32Array(faces.length * 4 * 3);
  const uvs = new Float32Array(faces.length * 4 * 2);
  const indices = new Uint32Array(faces.length * 6);
  const cornerUvs: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  faces.forEach((face, faceIndex) => {
    face.corners.forEach((corner, cornerIndex) => {
      const vertex = faceIndex * 4 + cornerIndex;
      positions[vertex * 3 + 0] = corner[0];
      positions[vertex * 3 + 1] = corner[1];
      positions[vertex * 3 + 2] = corner[2];
      normals[vertex * 3 + 0] = face.normal[0];
      normals[vertex * 3 + 1] = face.normal[1];
      normals[vertex * 3 + 2] = face.normal[2];
      uvs[vertex * 2 + 0] = cornerUvs[cornerIndex][0];
      uvs[vertex * 2 + 1] = cornerUvs[cornerIndex][1];
    });
    const base = faceIndex * 4;
    const target = faceIndex * 6;
    indices[target + 0] = base + 0;
    indices[target + 1] = base + 1;
    indices[target + 2] = base + 2;
    indices[target + 3] = base + 0;
    indices[target + 4] = base + 2;
    indices[target + 5] = base + 3;
  });

  return { positions, normals, uvs, indices, boundingRadius: boundingRadiusOf(positions) };
}

export function createSphere(radius = 1, segments = 32, rings = 16): Mesh {
  const vertexCount = (segments + 1) * (rings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(segments * rings * 6);

  let vertex = 0;
  for (let ring = 0; ring <= rings; ring += 1) {
    const v = ring / rings;
    const polar = v * Math.PI;
    const sinPolar = Math.sin(polar);
    const cosPolar = Math.cos(polar);
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const azimuth = u * Math.PI * 2;
      const nx = sinPolar * Math.cos(azimuth);
      const ny = cosPolar;
      const nz = sinPolar * Math.sin(azimuth);
      positions[vertex * 3 + 0] = nx * radius;
      positions[vertex * 3 + 1] = ny * radius;
      positions[vertex * 3 + 2] = nz * radius;
      normals[vertex * 3 + 0] = nx;
      normals[vertex * 3 + 1] = ny;
      normals[vertex * 3 + 2] = nz;
      uvs[vertex * 2 + 0] = u;
      uvs[vertex * 2 + 1] = v;
      vertex += 1;
    }
  }

  let index = 0;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const current = ring * (segments + 1) + segment;
      const next = current + segments + 1;
      // Bobinado antihorario visto desde fuera. El orden anterior producía la
      // normal geométrica hacia dentro: comprobado en el ecuador,
      // dot(cross(B-A, C-A), normalSaliente) = -0.038. Con el culling activo eso
      // descartaba el hemisferio cercano y dejaba ver el interior del lejano,
      // iluminado por normales que apuntan al lado opuesto de la luz — la esfera
      // se veía plana y apagada. Lo detectó `auditMesh` con un 94 % de caras
      // contradiciendo a sus propios vértices.
      indices[index + 0] = current;
      indices[index + 1] = current + 1;
      indices[index + 2] = next;
      indices[index + 3] = current + 1;
      indices[index + 4] = next + 1;
      indices[index + 5] = next;
      index += 6;
    }
  }

  return { positions, normals, uvs, indices, boundingRadius: boundingRadiusOf(positions) };
}

export function createTorus(
  majorRadius = 1,
  minorRadius = 0.35,
  majorSegments = 48,
  minorSegments = 24,
): Mesh {
  const vertexCount = (majorSegments + 1) * (minorSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(majorSegments * minorSegments * 6);

  let vertex = 0;
  for (let major = 0; major <= majorSegments; major += 1) {
    const u = major / majorSegments;
    const theta = u * Math.PI * 2;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    for (let minor = 0; minor <= minorSegments; minor += 1) {
      const v = minor / minorSegments;
      const phi = v * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const ringRadius = majorRadius + minorRadius * cosPhi;
      positions[vertex * 3 + 0] = ringRadius * cosTheta;
      positions[vertex * 3 + 1] = minorRadius * sinPhi;
      positions[vertex * 3 + 2] = ringRadius * sinTheta;
      normals[vertex * 3 + 0] = cosPhi * cosTheta;
      normals[vertex * 3 + 1] = sinPhi;
      normals[vertex * 3 + 2] = cosPhi * sinTheta;
      uvs[vertex * 2 + 0] = u;
      uvs[vertex * 2 + 1] = v;
      vertex += 1;
    }
  }

  let index = 0;
  for (let major = 0; major < majorSegments; major += 1) {
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const current = major * (minorSegments + 1) + minor;
      const next = current + minorSegments + 1;
      indices[index + 0] = current;
      indices[index + 1] = current + 1;
      indices[index + 2] = next;
      indices[index + 3] = current + 1;
      indices[index + 4] = next + 1;
      indices[index + 5] = next;
      index += 6;
    }
  }

  return { positions, normals, uvs, indices, boundingRadius: boundingRadiusOf(positions) };
}

/**
 * Plano subdividido. Las subdivisiones importan: un plano de 2 triángulos
 * gigantes es el caso donde más se nota la corrección de perspectiva, porque el
 * error de interpolación crece con el tamaño del triángulo en pantalla.
 */
export function createPlane(size = 10, subdivisions = 1): Mesh {
  const half = size / 2;
  const step = size / subdivisions;
  const vertexCount = (subdivisions + 1) * (subdivisions + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(subdivisions * subdivisions * 6);

  let vertex = 0;
  for (let row = 0; row <= subdivisions; row += 1) {
    for (let column = 0; column <= subdivisions; column += 1) {
      positions[vertex * 3 + 0] = -half + column * step;
      positions[vertex * 3 + 1] = 0;
      positions[vertex * 3 + 2] = -half + row * step;
      normals[vertex * 3 + 1] = 1;
      uvs[vertex * 2 + 0] = column / subdivisions;
      uvs[vertex * 2 + 1] = row / subdivisions;
      vertex += 1;
    }
  }

  let index = 0;
  for (let row = 0; row < subdivisions; row += 1) {
    for (let column = 0; column < subdivisions; column += 1) {
      const current = row * (subdivisions + 1) + column;
      const next = current + subdivisions + 1;
      indices[index + 0] = current;
      indices[index + 1] = next;
      indices[index + 2] = current + 1;
      indices[index + 3] = current + 1;
      indices[index + 4] = next;
      indices[index + 5] = next + 1;
      index += 6;
    }
  }

  return { positions, normals, uvs, indices, boundingRadius: boundingRadiusOf(positions) };
}

/** Normales por promediado de caras, para malla importada sin normales. */
export function computeNormals(mesh: Mesh): void {
  const { positions, normals, indices } = mesh;
  normals.fill(0);
  const edge1 = vec3();
  const edge2 = vec3();
  const faceNormal = vec3();

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    edge1[0] = positions[b] - positions[a];
    edge1[1] = positions[b + 1] - positions[a + 1];
    edge1[2] = positions[b + 2] - positions[a + 2];
    edge2[0] = positions[c] - positions[a];
    edge2[1] = positions[c + 1] - positions[a + 1];
    edge2[2] = positions[c + 2] - positions[a + 2];
    cross(edge1, edge2, faceNormal);
    for (const offset of [a, b, c]) {
      normals[offset] += faceNormal[0];
      normals[offset + 1] += faceNormal[1];
      normals[offset + 2] += faceNormal[2];
    }
  }

  const scratch = vec3();
  for (let i = 0; i < normals.length; i += 3) {
    scratch[0] = normals[i];
    scratch[1] = normals[i + 1];
    scratch[2] = normals[i + 2];
    normalize(scratch);
    normals[i] = scratch[0];
    normals[i + 1] = scratch[1];
    normals[i + 2] = scratch[2];
  }
}
