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
  // Dos triángulos por casilla salvo en los dos anillos polares, donde uno de los
  // dos tiene sus dos vértices superiores —o inferiores— en el mismo punto del polo y
  // por tanto área nula. Emitirlo costaba 64 triángulos degenerados en cada esfera,
  // que la auditoría reportaba con razón en cualquier escena que usara una.
  const indices = new Uint32Array((segments * rings - segments * 2) * 6 + segments * 2 * 3);

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
      // En el anillo del polo norte, `current` y `current + 1` son el mismo punto; en
      // el del sur lo son `next` y `next + 1`. Se emite solo el triángulo que existe.
      if (ring > 0) {
        indices[index + 0] = current;
        indices[index + 1] = current + 1;
        indices[index + 2] = next;
        index += 3;
      }
      if (ring < rings - 1) {
        indices[index + 0] = current + 1;
        indices[index + 1] = next + 1;
        indices[index + 2] = next;
        index += 3;
      }
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
 * Tronco de cono cerrado, centrado en el origen y con el eje en Y. Con los dos
 * radios iguales es un cilindro; con el de arriba a cero, un cono.
 *
 * Es una sola función porque son la misma superficie, y porque un generador que
 * distingue casos acaba con tres caminos que se rompen por separado. **Cerrado de
 * fábrica**: se añaden las tapas y sus centros, así que la auditoría lo da por
 * estanco y el contrato `watertight` no salta por una pieza que el propio programa
 * dejó abierta.
 *
 * Los vértices del costado no se comparten con los de las tapas: comparten
 * posición pero no normal, y soldarlos redondearía un canto que es vivo.
 */
export function createCylinder(
  radiusBottom = 0.5,
  radiusTop = 0.5,
  height = 1,
  segments = 32,
): Mesh {
  const half = height / 2;
  const sideVertices = (segments + 1) * 2;
  // Cada tapa: su corona de vértices más el centro. La de radio cero se omite,
  // porque un cono no tiene tapa arriba y sus triángulos serían degenerados.
  const hasBottom = radiusBottom > 0;
  const hasTop = radiusTop > 0;
  const capVertices = (hasBottom ? segments + 2 : 0) + (hasTop ? segments + 2 : 0);
  const vertexCount = sideVertices + capVertices;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const sideTriangles = (hasBottom ? segments : 0) + (hasTop ? segments : 0);
  const triangles = sideTriangles + (hasBottom ? segments : 0) + (hasTop ? segments : 0);
  const indices = new Uint32Array(triangles * 3);

  // La normal del costado se inclina con la pendiente del tronco: para un cono
  // recto, la generatriz sube `height` mientras el radio baja `radiusBottom -
  // radiusTop`, y la normal es perpendicular a ella.
  const slope = radiusBottom - radiusTop;
  const slopeLength = Math.hypot(slope, height) || 1;
  const normalY = slope / slopeLength;
  const normalRadial = height / slopeLength;

  let vertex = 0;
  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments;
    const angle = u * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const top of [false, true]) {
      const radius = top ? radiusTop : radiusBottom;
      positions[vertex * 3 + 0] = cos * radius;
      positions[vertex * 3 + 1] = top ? half : -half;
      positions[vertex * 3 + 2] = sin * radius;
      normals[vertex * 3 + 0] = cos * normalRadial;
      normals[vertex * 3 + 1] = normalY;
      normals[vertex * 3 + 2] = sin * normalRadial;
      uvs[vertex * 2 + 0] = u;
      uvs[vertex * 2 + 1] = top ? 1 : 0;
      vertex += 1;
    }
  }

  let index = 0;
  for (let segment = 0; segment < segments; segment += 1) {
    const bottom = segment * 2;
    const top = bottom + 1;
    const nextBottom = bottom + 2;
    const nextTop = bottom + 3;
    // En un cono, todo el anillo de arriba cae en el vértice: el triángulo que usa
    // dos vértices de ese anillo tendría área nula. Se emite solo el que existe, y
    // por eso cada guarda mira al anillo **contrario** al que aporta el par.
    if (hasBottom) {
      indices[index + 0] = bottom;
      indices[index + 1] = top;
      indices[index + 2] = nextBottom;
      index += 3;
    }
    if (hasTop) {
      indices[index + 0] = top;
      indices[index + 1] = nextTop;
      indices[index + 2] = nextBottom;
      index += 3;
    }
  }

  for (const top of [false, true]) {
    const radius = top ? radiusTop : radiusBottom;
    if (radius <= 0) continue;
    const y = top ? half : -half;
    const center = vertex;
    positions[vertex * 3 + 1] = y;
    normals[vertex * 3 + 1] = top ? 1 : -1;
    uvs[vertex * 2 + 0] = 0.5;
    uvs[vertex * 2 + 1] = 0.5;
    vertex += 1;

    const first = vertex;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions[vertex * 3 + 0] = cos * radius;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = sin * radius;
      normals[vertex * 3 + 1] = top ? 1 : -1;
      uvs[vertex * 2 + 0] = cos * 0.5 + 0.5;
      uvs[vertex * 2 + 1] = sin * 0.5 + 0.5;
      vertex += 1;
    }

    for (let segment = 0; segment < segments; segment += 1) {
      const current = first + segment;
      const next = first + ((segment + 1) % segments);
      // El bobinado se invierte entre tapas para que las dos miren hacia fuera.
      indices[index + 0] = center;
      indices[index + 1] = top ? next : current;
      indices[index + 2] = top ? current : next;
      index += 3;
    }
  }

  return { positions, normals, uvs, indices, boundingRadius: boundingRadiusOf(positions) };
}

/**
 * Generadores de perfil: familias de fórmulas que producen un polígono cerrado en
 * el mismo formato que ya acepta `createExtrusion` —pares `x,z`, antihorario—.
 *
 * Son familias fijas con parámetros y no un evaluador de expresiones a propósito.
 * Una fórmula libre dentro del JSON traería análisis sintáctico, un modo de fallo
 * que no es «campo mal escrito» —el único que el esquema sabe cazar— y la duda de
 * si dos máquinas la evalúan igual. Con cuatro familias se describe lo que hace
 * falta describir.
 */
export function createSuperellipseProfile(
  a: number,
  b: number,
  exponent: number,
  points = 32,
): number[] {
  if (points < 3) throw new Error("un perfil necesita al menos tres puntos");
  if (!(exponent > 0)) throw new Error(`el exponente de la superelipse debe ser positivo, no ${exponent}`);

  const polygon: number[] = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (exponent === 2) {
      // El caso elíptico se resuelve sin pasar por la fórmula general, y no por
      // velocidad: `Math.sign(-0)` vale `-0`, así que la forma general deja ceros
      // negativos donde esta deja ceros positivos. Con la excepción, un círculo y
      // una superelipse de exponente 2 son el mismo polígono número a número, que
      // es justo lo que la puerta comprueba.
      polygon.push(a * cos, b * sin);
      continue;
    }
    const power = 2 / exponent;
    polygon.push(
      a * Math.sign(cos) * Math.abs(cos) ** power,
      b * Math.sign(sin) * Math.abs(sin) ** power,
    );
  }
  return polygon;
}

/** Un círculo es la superelipse de exponente 2 con los dos semiejes iguales. */
export function createCircleProfile(radius = 1, points = 32): number[] {
  return createSuperellipseProfile(radius, radius, 2, points);
}

/**
 * Superfórmula de Gielis: una sola familia que recorre flores, estrellas,
 * caparazones y secciones redondeadas según cuatro números.
 */
export function createGielisProfile(
  m: number,
  n1: number,
  n2: number,
  n3: number,
  options: { a?: number; b?: number; radius?: number; points?: number } = {},
): number[] {
  const a = options.a ?? 1;
  const b = options.b ?? 1;
  const radius = options.radius ?? 1;
  const points = options.points ?? 64;
  if (points < 3) throw new Error("un perfil necesita al menos tres puntos");
  if (a === 0 || b === 0) throw new Error("los parámetros a y b de Gielis no pueden ser cero");

  const polygon: number[] = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const quarter = (m * angle) / 4;
    const sum =
      Math.abs(Math.cos(quarter) / a) ** n2 + Math.abs(Math.sin(quarter) / b) ** n3;
    if (!(sum > 0) || !Number.isFinite(sum)) {
      // Sin esto sale un infinito que revienta tres capas más abajo, en la
      // triangulación, sin decir de dónde vino.
      throw new Error(
        `los parámetros de Gielis no producen figura en el ángulo ${angle.toFixed(4)} rad`,
      );
    }
    const r = radius * sum ** (-1 / n1);
    polygon.push(r * Math.cos(angle), r * Math.sin(angle));
  }
  return polygon;
}

/**
 * Perfil aerodinámico NACA de cuatro dígitos `MPXX`: curvatura máxima en
 * centésimas de cuerda, su posición en décimas, y grosor en centésimas.
 *
 * Dos detalles que deciden si el perfil sirve:
 *
 * El último coeficiente del grosor es **−0,1036** y no el clásico −0,1015. Con el
 * clásico, `yt(1)` no es cero: el borde de fuga queda abierto por unas milésimas
 * de cuerda y cada ala arrastraría un `BORDE_ABIERTO` que no es culpa de quien la
 * escribió. Con este, los cinco coeficientes suman cero y el borde de fuga es un
 * punto, no dos.
 *
 * Y las estaciones se reparten en coseno, no uniformemente. Con reparto uniforme,
 * el borde de ataque —donde la curvatura es máxima— se queda con dos o tres puntos
 * y el perfil sale con una punta poligonal.
 */
export function createNacaProfile(digits: string, chord = 1, points = 64): number[] {
  if (!/^\d{4}$/.test(digits)) {
    throw new Error(`un perfil NACA son cuatro dígitos, no "${digits}"`);
  }
  if (points % 2 !== 0 || points < 8) {
    throw new Error(`points de un NACA debe ser par y al menos 8, no ${points}`);
  }

  const camber = Number(digits[0]) / 100;
  const camberPosition = Number(digits[1]) / 10;
  const thickness = Number(digits.slice(2)) / 100;
  const stations = points / 2 + 1;

  const surface = (station: number, upper: boolean): [number, number] => {
    const x = (1 - Math.cos((Math.PI * station) / (stations - 1))) / 2;
    const halfThickness =
      5 *
      thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

    let center = 0;
    let slope = 0;
    if (camber !== 0 && camberPosition !== 0) {
      if (x < camberPosition) {
        center = (camber / camberPosition ** 2) * (2 * camberPosition * x - x * x);
        slope = ((2 * camber) / camberPosition ** 2) * (camberPosition - x);
      } else {
        const tail = (1 - camberPosition) ** 2;
        center = (camber / tail) * (1 - 2 * camberPosition + 2 * camberPosition * x - x * x);
        slope = ((2 * camber) / tail) * (camberPosition - x);
      }
    }

    const angle = Math.atan(slope);
    return upper
      ? [chord * (x - halfThickness * Math.sin(angle)), chord * (center + halfThickness * Math.cos(angle))]
      : [chord * (x + halfThickness * Math.sin(angle)), chord * (center - halfThickness * Math.cos(angle))];
  };

  // Por debajo desde el borde de ataque hasta el de fuga, y por arriba de vuelta:
  // recorrido antihorario en el plano `x,z`. Los dos extremos se emiten una sola
  // vez —en la estación 0 las dos superficies coinciden en el origen, y en la
  // última coinciden en el borde de fuga porque `yt(1)` es cero—, así que salen
  // exactamente `points` pares.
  const polygon: number[] = [];
  for (let station = 0; station < stations; station += 1) polygon.push(...surface(station, false));
  for (let station = stations - 2; station >= 1; station -= 1) polygon.push(...surface(station, true));
  return polygon;
}

/**
 * Área firmada de un polígono en el plano XZ. El signo dice el sentido de giro, y
 * hace falta porque un polígono escrito al revés genera un sólido del revés.
 */
function signedArea(polygon: readonly number[]): number {
  let total = 0;
  const count = polygon.length / 2;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    total += polygon[index * 2] * polygon[next * 2 + 1] - polygon[next * 2] * polygon[index * 2 + 1];
  }
  return total / 2;
}

/**
 * El mismo polígono con `samples` puntos repartidos por longitud de arco,
 * empezando en su vértice cero.
 *
 * Es lo que elimina el fallo número uno del *loft*: dos secciones con distinto
 * número de puntos, o con el mismo número mal emparejado, cosen una superficie
 * retorcida en espiral. Remuestreando las dos al mismo número, un círculo de 24
 * puntos y un perfil de 64 se cosen sin que nadie los iguale a mano.
 *
 * Cuando un punto de destino cae exactamente sobre un vértice —un cuadrado
 * remuestreado a cuatro puntos, por ejemplo— sale el vértice **intacto**: el
 * parámetro local vale cero y la interpolación devuelve el extremo sin tocarlo.
 * De eso depende que un loft de dos secciones iguales dé exactamente lo mismo que
 * una extrusión, y no «casi».
 */
function resamplePolygon(polygon: readonly number[], samples: number): number[] {
  const count = polygon.length / 2;
  if (count < 3) throw new Error("un polígono necesita al menos tres puntos");
  if (samples < 3) throw new Error(`samples debe ser al menos 3, no ${samples}`);

  const cumulative = new Float64Array(count + 1);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    cumulative[index + 1] =
      cumulative[index] +
      Math.hypot(polygon[next * 2] - polygon[index * 2], polygon[next * 2 + 1] - polygon[index * 2 + 1]);
  }
  const perimeter = cumulative[count];
  if (!(perimeter > 0)) throw new Error("un polígono de perímetro cero no se puede remuestrear");

  const resampled: number[] = [];
  let edge = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const target = (perimeter * sample) / samples;
    while (edge < count - 1 && target >= cumulative[edge + 1]) edge += 1;
    const span = cumulative[edge + 1] - cumulative[edge];
    const t = span > 0 ? (target - cumulative[edge]) / span : 0;
    const next = (edge + 1) % count;
    resampled.push(
      polygon[edge * 2] + (polygon[next * 2] - polygon[edge * 2]) * t,
      polygon[edge * 2 + 1] + (polygon[next * 2 + 1] - polygon[edge * 2 + 1]) * t,
    );
  }
  return resampled;
}

/**
 * El polígono al revés **conservando su vértice cero**: `v0, v_{n-1}, … , v1`.
 *
 * `reversePolygon` no sirve aquí: empieza por el último vértice, así que
 * normalizar el sentido de una sección movería también el punto de partida del
 * remuestreo, y la correspondencia entre secciones giraría. La misma pieza
 * escrita en un sentido y en el otro dejaría de dar la misma malla.
 */
function flipPolygonKeepingStart(polygon: readonly number[]): number[] {
  const count = polygon.length / 2;
  const flipped = [polygon[0], polygon[1]];
  for (let index = count - 1; index >= 1; index -= 1) {
    flipped.push(polygon[index * 2], polygon[index * 2 + 1]);
  }
  return flipped;
}

function isInsideTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Triangulación por recorte de orejas.
 *
 * Es el algoritmo lento —cuadrático— y el correcto para lo que hace falta aquí: un
 * perfil escrito a mano tiene decenas de vértices, no miles, y a cambio admite
 * polígonos cóncavos, que es justo lo que distingue una pieza de verdad de una caja.
 * Espera el polígono en sentido antihorario y sin agujeros.
 */
function earClip(polygon: readonly number[]): number[] {
  const remaining: number[] = [];
  for (let index = 0; index < polygon.length / 2; index += 1) remaining.push(index);
  const triangles: number[] = [];

  let guard = remaining.length * remaining.length;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let position = 0; position < remaining.length; position += 1) {
      const previous = remaining[(position + remaining.length - 1) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      const ax = polygon[previous * 2];
      const ay = polygon[previous * 2 + 1];
      const bx = polygon[current * 2];
      const by = polygon[current * 2 + 1];
      const cx = polygon[next * 2];
      const cy = polygon[next * 2 + 1];

      // Convexo en un polígono antihorario: el giro de A-B-C es a la izquierda.
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0) continue;

      // Y sin ningún otro vértice dentro, o el recorte se comería geometría.
      let contains = false;
      for (const other of remaining) {
        if (other === previous || other === current || other === next) continue;
        if (isInsideTriangle(polygon[other * 2], polygon[other * 2 + 1], ax, ay, bx, by, cx, cy)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      triangles.push(previous, current, next);
      remaining.splice(position, 1);
      clipped = true;
      break;
    }
    // Un polígono que se cruza a sí mismo no tiene orejas: se corta aquí en vez de
    // girar para siempre, y lo que salga lo dirá la auditoría.
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push(remaining[0], remaining[1], remaining[2]);
  return triangles;
}

/**
 * Extrusión de un polígono del plano XZ a lo largo de Y, cerrada por arriba y por
 * abajo.
 *
 * Es la primera forma que amplía de verdad lo que se puede describir: una caja, un
 * cilindro y una esfera no hacen una escuadra, un perfil en L ni una placa con
 * pestaña. El polígono llega como pares `x,z` y se normaliza a sentido antihorario,
 * porque escribirlo al revés es el error más fácil de cometer y produciría un sólido
 * con las caras hacia dentro.
 */
export function createExtrusion(polygon: readonly number[], height = 1): Mesh {
  const count = polygon.length / 2;
  if (count < 3) throw new Error("una extrusión necesita al menos tres puntos");

  const outline = signedArea(polygon) < 0 ? reversePolygon(polygon) : [...polygon];
  const capTriangles = earClip(outline);
  const half = height / 2;

  // Los vértices del costado no se comparten con los de las tapas: comparten
  // posición pero no normal, y soldarlos redondearía un canto vivo.
  const vertexCount = count * 2 + count * 4;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const x = outline[index * 2];
    const z = outline[index * 2 + 1];
    for (const top of [false, true]) {
      const vertex = index * 2 + (top ? 1 : 0);
      positions[vertex * 3 + 0] = x;
      positions[vertex * 3 + 1] = top ? half : -half;
      positions[vertex * 3 + 2] = z;
      normals[vertex * 3 + 1] = top ? 1 : -1;
      uvs[vertex * 2 + 0] = index / count;
      uvs[vertex * 2 + 1] = top ? 1 : 0;
    }
  }

  for (let entry = 0; entry < capTriangles.length; entry += 3) {
    const [a, b, c] = [capTriangles[entry], capTriangles[entry + 1], capTriangles[entry + 2]];
    // Arriba mira a +Y y abajo a -Y, así que una de las dos tapas va al revés.
    //
    // Y las dos al contrario de lo que parece: un polígono antihorario dibujado en
    // el papel `x,z` se ve **horario** desde +Y, porque mirar desde arriba invierte
    // el sentido de giro del plano. Escritas del otro modo, el sólido salía entero
    // hacia dentro —volumen firmado −8 en un cubo de lado 2— y la auditoría lo dijo
    // a la primera.
    indices.push(c * 2 + 1, b * 2 + 1, a * 2 + 1);
    indices.push(a * 2, b * 2, c * 2);
  }

  let sideVertex = count * 2;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const x0 = outline[index * 2];
    const z0 = outline[index * 2 + 1];
    const x1 = outline[next * 2];
    const z1 = outline[next * 2 + 1];
    // Normal del costado: perpendicular a la arista, hacia fuera del polígono
    // antihorario.
    const nx = z1 - z0;
    const nz = -(x1 - x0);
    const length = Math.hypot(nx, nz) || 1;

    const base = sideVertex;
    const corners: Array<[number, number, number]> = [
      [x0, -half, z0],
      [x1, -half, z1],
      [x1, half, z1],
      [x0, half, z0],
    ];
    corners.forEach((corner, cornerIndex) => {
      positions[sideVertex * 3 + 0] = corner[0];
      positions[sideVertex * 3 + 1] = corner[1];
      positions[sideVertex * 3 + 2] = corner[2];
      normals[sideVertex * 3 + 0] = nx / length;
      normals[sideVertex * 3 + 2] = nz / length;
      uvs[sideVertex * 2 + 0] = cornerIndex < 2 ? index / count : next / count;
      uvs[sideVertex * 2 + 1] = cornerIndex === 0 || cornerIndex === 1 ? 0 : 1;
      sideVertex += 1;
    });
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  return {
    positions,
    normals,
    uvs,
    indices: Uint32Array.from(indices),
    boundingRadius: boundingRadiusOf(positions),
  };
}

export interface LoftSection {
  position: readonly [number, number, number];
  /** Polígono cerrado en el plano XZ, pares `x,z`. */
  polygon: readonly number[];
  /** Escala en x y en z; 1 y 1 por defecto. Las dos positivas. */
  scale?: readonly [number, number];
  /** Radianes alrededor de Y. Radianes aquí; los grados son cosa del documento. */
  twist?: number;
}

/**
 * Secciones cosidas: la generalización de la extrusión a más de dos perfiles y a
 * perfiles distintos.
 *
 * Convención de planos, que no es adivinable y por eso se dice: el polígono de
 * cada sección vive en el plano XZ —igual que en `createExtrusion`— y se traslada
 * a su posición. Las secciones quedan **paralelas a XZ**, así que la pieza crece
 * a lo largo de Y, y la posición puede además desplazarse en X y en Z para
 * inclinarla o escalonarla. Un ala cuyo tramo va en horizontal se gira entera con
 * la matriz del objeto. Es la convención de la extrusión, sin inventar una segunda.
 *
 * Los vértices del costado se comparten a lo largo del anillo, así que las
 * normales salen promediadas y la superficie sombrea suave: es lo que quiere un
 * perfil aerodinámico, y lo mismo que hace el revolucionado. Un canto vivo en la
 * sección —un cuadrado— sombreará redondeado, que es el precio conocido de esa
 * decisión.
 */
export function createLoft(
  sections: readonly LoftSection[],
  options: { samples?: number; caps?: "both" | "none" | "start" | "end" } = {},
): Mesh {
  if (sections.length < 2) throw new Error("un loft necesita al menos dos secciones");

  const caps = options.caps ?? "both";
  const samples =
    options.samples ?? Math.max(...sections.map((section) => section.polygon.length / 2));
  if (samples < 3) throw new Error(`samples debe ser al menos 3, no ${samples}`);

  // El sentido del recorrido se normaliza igual que se normaliza el del polígono:
  // una lista escrita de arriba abajo produciría el sólido del revés, y ordenarla
  // cuesta menos que explicarle al agente en qué orden tenía que escribirla.
  const ordered =
    sections[sections.length - 1].position[1] >= sections[0].position[1]
      ? [...sections]
      : [...sections].reverse();

  const rings: number[][] = [];
  for (const [index, section] of ordered.entries()) {
    if (index > 0) {
      const previous = ordered[index - 1].position;
      const here = section.position;
      if (here[0] === previous[0] && here[1] === previous[1] && here[2] === previous[2]) {
        throw new Error(`las secciones ${index - 1} y ${index} están en la misma posición`);
      }
    }
    const [scaleX, scaleZ] = section.scale ?? [1, 1];
    if (!(scaleX > 0) || !(scaleZ > 0)) {
      throw new Error(`la escala de la sección ${index} debe ser positiva, no [${scaleX}, ${scaleZ}]`);
    }

    const oriented =
      signedArea(section.polygon) < 0 ? flipPolygonKeepingStart(section.polygon) : [...section.polygon];
    const resampled = resamplePolygon(oriented, samples);
    const twist = section.twist ?? 0;
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);

    const ring: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const x = resampled[sample * 2] * scaleX;
      const z = resampled[sample * 2 + 1] * scaleZ;
      // Mismo sentido de giro que `rotationY`, para que un twist en el documento y
      // una rotación del objeto no giren en direcciones contrarias.
      ring.push(cos * x - sin * z, sin * x + cos * z);
    }
    rings.push(ring);
  }

  const ringCount = rings.length;
  const capStart = caps === "both" || caps === "start";
  const capEnd = caps === "both" || caps === "end";
  const startTriangles = capStart ? earClip(rings[0]) : [];
  const endTriangles = capEnd ? earClip(rings[ringCount - 1]) : [];

  const capVertices = (capStart ? samples : 0) + (capEnd ? samples : 0);
  const vertexCount = ringCount * samples + capVertices;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  let vertex = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const y = ordered[ring].position[1];
    const offsetX = ordered[ring].position[0];
    const offsetZ = ordered[ring].position[2];
    for (let sample = 0; sample < samples; sample += 1) {
      positions[vertex * 3 + 0] = rings[ring][sample * 2] + offsetX;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = rings[ring][sample * 2 + 1] + offsetZ;
      uvs[vertex * 2 + 0] = sample / samples;
      uvs[vertex * 2 + 1] = ring / (ringCount - 1);
      vertex += 1;
    }
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let sample = 0; sample < samples; sample += 1) {
      const next = (sample + 1) % samples;
      const a = ring * samples + sample;
      const b = ring * samples + next;
      const c = (ring + 1) * samples + next;
      const d = (ring + 1) * samples + sample;
      indices.push(a, c, b, a, d, c);
    }
  }

  // Las tapas no comparten vértices con el costado: comparten posición pero no
  // normal, y soldarlas redondearía el canto.
  for (const [ring, triangles, upward] of [
    [0, startTriangles, false],
    [ringCount - 1, endTriangles, true],
  ] as const) {
    if (triangles.length === 0) continue;
    const base = vertex;
    const y = ordered[ring].position[1];
    const offsetX = ordered[ring].position[0];
    const offsetZ = ordered[ring].position[2];
    for (let sample = 0; sample < samples; sample += 1) {
      positions[vertex * 3 + 0] = rings[ring][sample * 2] + offsetX;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = rings[ring][sample * 2 + 1] + offsetZ;
      uvs[vertex * 2 + 0] = sample / samples;
      uvs[vertex * 2 + 1] = upward ? 1 : 0;
      vertex += 1;
    }
    for (let entry = 0; entry < triangles.length; entry += 3) {
      const [a, b, c] = [triangles[entry], triangles[entry + 1], triangles[entry + 2]];
      // Un polígono antihorario en el papel `x,z` se ve horario desde +Y, así que
      // la tapa de arriba va al revés que la de abajo. Es el mismo cuidado que ya
      // se tuvo en la extrusión, donde escribirlo del otro modo sacó el sólido
      // entero hacia dentro.
      if (upward) indices.push(base + c, base + b, base + a);
      else indices.push(base + a, base + b, base + c);
    }
  }

  const mesh: Mesh = {
    positions,
    normals: new Float32Array(positions.length),
    uvs,
    indices: Uint32Array.from(indices),
    boundingRadius: boundingRadiusOf(positions),
  };
  computeNormals(mesh);
  return mesh;
}

type Point3 = readonly [number, number, number];

export interface SweepStation {
  position: Point3;
  normal: Point3;
  binormal: Point3;
  /** Multiplica el perfil en esta estación. */
  radius: number;
  /** Radianes alrededor de la tangente. */
  twist: number;
}

export interface SweepPath {
  stations: SweepStation[];
  /** Fracción de longitud recorrida en cada estación, de 0 a 1. */
  u: number[];
  /** Curvatura discreta en cada estación, en 1/unidad. */
  curvature: number[];
}

/**
 * Punto de una Catmull-Rom **centrípeta** entre `p1` y `p2`, con `p0` y `p3` de
 * vecinos y `t` local de 0 a 1.
 *
 * Centrípeta —exponente 0,5 en el reparto de nudos— y no uniforme, y no es un
 * detalle de gusto: la uniforme forma bucles y cúspides en cuanto los puntos
 * están desigualmente espaciados, que es como los escribe cualquiera. La
 * centrípeta tiene demostrado que no produce ninguna de las dos dentro de un
 * segmento, así que el modo de fallo desaparece en vez de tener que avisarse.
 */
function catmullRom(p0: Point3, p1: Point3, p2: Point3, p3: Point3, t: number): Point3 {
  const knot = (a: Point3, b: Point3, start: number): number =>
    start + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const at = t1 + t * (t2 - t1);

  const mix = (a: Point3, b: Point3, from: number, to: number): Point3 => {
    const span = to - from;
    if (span === 0) return a;
    const weight = (at - from) / span;
    return [
      a[0] + (b[0] - a[0]) * weight,
      a[1] + (b[1] - a[1]) * weight,
      a[2] + (b[2] - a[2]) * weight,
    ];
  };

  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/**
 * Estaciones de un recorrido, con sus marcos por **transporte paralelo**.
 *
 * Va aparte de `createSweep` porque la auditoría necesita las estaciones y la
 * curvatura sin construir la malla, y calcularlas dos veces con dos códigos
 * distintos sería la divergencia servida.
 *
 * **Transporte paralelo y no Frenet.** El marco de Frenet sale de la derivada
 * segunda: gira de golpe media vuelta al pasar por un punto de inflexión y queda
 * indefinido donde la curvatura tiende a cero, es decir, en cualquier tramo recto.
 * Un brazo recto con una curva al final saldría retorcido por la mitad. El
 * transporte paralelo arrastra el marco anterior girándolo lo mínimo, así que en
 * un tramo recto no gira nada.
 */
export function sweepStations(
  through: readonly Point3[],
  options: { kind?: "catmull-rom" | "polyline"; closed?: boolean; stations?: number } = {},
): SweepPath {
  const kind = options.kind ?? "catmull-rom";
  const closed = options.closed ?? false;
  const count = options.stations ?? 24;
  if (through.length < 2) throw new Error("un recorrido necesita al menos dos puntos");
  if (count < 2) throw new Error(`stations debe ser al menos 2, no ${count}`);
  for (let index = 1; index < through.length; index += 1) {
    const a = through[index - 1];
    const b = through[index];
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
      throw new Error(`los puntos ${index - 1} y ${index} del recorrido son el mismo`);
    }
  }

  const last = through.length - 1;
  // Los extremos de una curva abierta se completan por reflexión; en una cerrada,
  // los vecinos se toman dando la vuelta.
  const at = (index: number): Point3 => {
    if (closed) return through[((index % through.length) + through.length) % through.length];
    if (index < 0) {
      return [
        2 * through[0][0] - through[1][0],
        2 * through[0][1] - through[1][1],
        2 * through[0][2] - through[1][2],
      ];
    }
    if (index > last) {
      return [
        2 * through[last][0] - through[last - 1][0],
        2 * through[last][1] - through[last - 1][1],
        2 * through[last][2] - through[last - 1][2],
      ];
    }
    return through[index];
  };

  const segments = closed ? through.length : through.length - 1;
  const positions: Point3[] = [];
  for (let index = 0; index < count; index += 1) {
    // Reparto uniforme en el parámetro, con el mismo número de estaciones por
    // segmento. Una curva abierta llega al último punto; una cerrada no repite el
    // primero.
    const global = closed ? (index / count) * segments : (index / (count - 1)) * segments;
    const segment = Math.min(segments - 1, Math.floor(global));
    const local = global - segment;
    positions.push(
      kind === "polyline"
        ? mixPoints(at(segment), at(segment + 1), local)
        : catmullRom(at(segment - 1), at(segment), at(segment + 1), at(segment + 2), local),
    );
  }

  // `u` no es el parámetro de la curva sino la **fracción de longitud recorrida**:
  // quien escribe una tabla de radio quiere decir «de la raíz a la punta», y con el
  // parámetro crudo de una centrípeta eso no coincide. Solo se etiquetan las
  // estaciones ya colocadas; reparametrizar de verdad exigiría invertir la tabla
  // numéricamente y traer una tolerancia nueva.
  const steps: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = positions[(index + 1) % count];
    const here = positions[index];
    steps.push(Math.hypot(next[0] - here[0], next[1] - here[1], next[2] - here[2]));
  }
  const total = steps.slice(0, closed ? count : count - 1).reduce((sum, step) => sum + step, 0);
  const u: number[] = [];
  let travelled = 0;
  for (let index = 0; index < count; index += 1) {
    u.push(total > 0 ? travelled / total : 0);
    travelled += steps[index];
  }

  const tangents: Point3[] = [];
  for (let index = 0; index < count; index += 1) {
    const previous = positions[(index - 1 + count) % count];
    const next = positions[(index + 1) % count];
    const from = closed || index > 0 ? previous : positions[index];
    const to = closed || index < count - 1 ? next : positions[index];
    tangents.push(unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]));
  }

  // Normal inicial determinista: el eje del mundo menos alineado con la tangente.
  // Con una elección arbitraria, dos ejecuciones darían mallas distintas y el
  // `renderHash` dejaría de significar nada.
  const axes: Point3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let chosen = axes[0];
  let smallest = Infinity;
  for (const axis of axes) {
    const alignment = Math.abs(dotPoints(tangents[0], axis));
    if (alignment < smallest) {
      smallest = alignment;
      chosen = axis;
    }
  }
  const normals: Point3[] = [orthogonalize(chosen, tangents[0])];
  for (let index = 1; index < count; index += 1) {
    normals.push(transportNormal(normals[index - 1], tangents[index - 1], tangents[index]));
  }

  // Un recorrido cerrado no cierra solo: el marco vuelve al punto de partida con un
  // giro residual que casi nunca es cero, y la costura queda desalineada. Se mide y
  // se reparte a lo largo del recorrido.
  let residual = 0;
  if (closed) {
    const returned = transportNormal(normals[count - 1], tangents[count - 1], tangents[0]);
    const start = normals[0];
    const startBinormal = crossPoints(tangents[0], start);
    residual = Math.atan2(dotPoints(returned, startBinormal), dotPoints(returned, start));
  }

  const stations: SweepStation[] = [];
  for (let index = 0; index < count; index += 1) {
    stations.push({
      position: positions[index],
      normal: normals[index],
      // La binormal se recalcula siempre, nunca se transporta aparte: transportar
      // las dos deja el marco no ortogonal por acumulación.
      binormal: crossPoints(tangents[index], normals[index]),
      radius: 1,
      twist: -residual * u[index],
    });
  }

  const curvature: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!closed && (index === 0 || index === count - 1)) {
      curvature.push(0);
      continue;
    }
    const previous = positions[(index - 1 + count) % count];
    const here = positions[index];
    const next = positions[(index + 1) % count];
    const first: Point3 = [here[0] - previous[0], here[1] - previous[1], here[2] - previous[2]];
    const second: Point3 = [next[0] - here[0], next[1] - here[1], next[2] - here[2]];
    const lengthFirst = Math.hypot(first[0], first[1], first[2]);
    const lengthSecond = Math.hypot(second[0], second[1], second[2]);
    const axis = crossPoints(first, second);
    const angle = Math.atan2(Math.hypot(axis[0], axis[1], axis[2]), dotPoints(first, second));
    const span = (lengthFirst + lengthSecond) / 2;
    curvature.push(span > 0 ? angle / span : 0);
  }

  return { stations, u, curvature };
}

function mixPoints(a: Point3, b: Point3, t: number): Point3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function dotPoints(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossPoints(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: Point3): Point3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** La componente de `v` perpendicular a `axis`, normalizada. */
function orthogonalize(v: Point3, axis: Point3): Point3 {
  const projection = dotPoints(v, axis);
  return unit([v[0] - axis[0] * projection, v[1] - axis[1] * projection, v[2] - axis[2] * projection]);
}

/**
 * La normal girada por la rotación **mínima** que lleva una tangente a la otra.
 *
 * Con las dos tangentes paralelas —un tramo recto— el eje sale de longitud nula y
 * la normal se conserva **tal cual**, sin pasar por ninguna fórmula: de eso
 * depende que un brazo recto salga sin un grado de torsión.
 */
function transportNormal(normal: Point3, from: Point3, to: Point3): Point3 {
  const axis = crossPoints(from, to);
  const sine = Math.hypot(axis[0], axis[1], axis[2]);
  if (sine < 1e-12) return normal;
  const unitAxis: Point3 = [axis[0] / sine, axis[1] / sine, axis[2] / sine];
  const angle = Math.atan2(sine, dotPoints(from, to));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cross = crossPoints(unitAxis, normal);
  const projection = dotPoints(unitAxis, normal) * (1 - cos);
  return unit([
    normal[0] * cos + cross[0] * sin + unitAxis[0] * projection,
    normal[1] * cos + cross[1] * sin + unitAxis[1] * projection,
    normal[2] * cos + cross[2] * sin + unitAxis[2] * projection,
  ]);
}

/**
 * Perfil barrido por un recorrido. Generaliza el revolucionado: un círculo
 * barrido alrededor de un eje **es** un revolucionado.
 *
 * El polígono se interpreta en el plano del marco —su `x` sobre la normal y su
 * `z` sobre la binormal—, y el bobinado va al revés que en el *loft*: la terna
 * `(normal, binormal, tangente)` es dextrógira, mientras que la del *loft*
 * —`(X, Z, Y)`— es levógira. Con el mismo bobinado en los dos, uno de los dos
 * saldría con todas las caras hacia dentro.
 */
export function createSweep(
  polygon: readonly number[],
  stations: readonly SweepStation[],
  options: { closed?: boolean; caps?: "both" | "none" | "start" | "end" } = {},
): Mesh {
  const points = polygon.length / 2;
  if (points < 3) throw new Error("un barrido necesita un perfil de al menos tres puntos");
  if (stations.length < 2) throw new Error("un barrido necesita al menos dos estaciones");

  const closed = options.closed ?? false;
  // Un recorrido cerrado no tiene extremos que tapar, así que `caps` no se aplica.
  const caps = closed ? "none" : options.caps ?? "both";
  const oriented = signedArea(polygon) < 0 ? flipPolygonKeepingStart(polygon) : [...polygon];
  const capStart = caps === "both" || caps === "start";
  const capEnd = caps === "both" || caps === "end";
  const startTriangles = capStart ? earClip(oriented) : [];
  const endTriangles = capEnd ? earClip(oriented) : [];

  const ringCount = stations.length;
  const capVertices = (capStart ? points : 0) + (capEnd ? points : 0);
  const vertexCount = ringCount * points + capVertices;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  const place = (station: SweepStation, point: number): [number, number, number] => {
    const cos = Math.cos(station.twist);
    const sin = Math.sin(station.twist);
    const x = oriented[point * 2] * station.radius;
    const z = oriented[point * 2 + 1] * station.radius;
    const alongNormal = cos * x - sin * z;
    const alongBinormal = sin * x + cos * z;
    return [
      station.position[0] + station.normal[0] * alongNormal + station.binormal[0] * alongBinormal,
      station.position[1] + station.normal[1] * alongNormal + station.binormal[1] * alongBinormal,
      station.position[2] + station.normal[2] * alongNormal + station.binormal[2] * alongBinormal,
    ];
  };

  let vertex = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let point = 0; point < points; point += 1) {
      const world = place(stations[ring], point);
      positions[vertex * 3 + 0] = world[0];
      positions[vertex * 3 + 1] = world[1];
      positions[vertex * 3 + 2] = world[2];
      uvs[vertex * 2 + 0] = point / points;
      uvs[vertex * 2 + 1] = ring / (ringCount - 1);
      vertex += 1;
    }
  }

  const gaps = closed ? ringCount : ringCount - 1;
  for (let ring = 0; ring < gaps; ring += 1) {
    const following = (ring + 1) % ringCount;
    for (let point = 0; point < points; point += 1) {
      const next = (point + 1) % points;
      const a = ring * points + point;
      const b = ring * points + next;
      const c = following * points + next;
      const d = following * points + point;
      indices.push(a, b, c, a, c, d);
    }
  }

  for (const [ring, triangles, atEnd] of [
    [0, startTriangles, false],
    [ringCount - 1, endTriangles, true],
  ] as const) {
    if (triangles.length === 0) continue;
    const base = vertex;
    for (let point = 0; point < points; point += 1) {
      const world = place(stations[ring], point);
      positions[vertex * 3 + 0] = world[0];
      positions[vertex * 3 + 1] = world[1];
      positions[vertex * 3 + 2] = world[2];
      uvs[vertex * 2 + 0] = point / points;
      uvs[vertex * 2 + 1] = atEnd ? 1 : 0;
      vertex += 1;
    }
    for (let entry = 0; entry < triangles.length; entry += 3) {
      const [a, b, c] = [triangles[entry], triangles[entry + 1], triangles[entry + 2]];
      if (atEnd) indices.push(base + a, base + b, base + c);
      else indices.push(base + c, base + b, base + a);
    }
  }

  const mesh: Mesh = {
    positions,
    normals: new Float32Array(positions.length),
    uvs,
    indices: Uint32Array.from(indices),
    boundingRadius: boundingRadiusOf(positions),
  };
  computeNormals(mesh);
  return mesh;
}

/** El perfil recorrido en sentido contrario, conservando los pares radio,altura. */
function reverseProfile(profile: readonly number[]): number[] {
  const out: number[] = [];
  for (let ring = profile.length / 2 - 1; ring >= 0; ring -= 1) {
    out.push(profile[ring * 2], profile[ring * 2 + 1]);
  }
  return out;
}

function reversePolygon(polygon: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = polygon.length / 2 - 1; index >= 0; index -= 1) {
    out.push(polygon[index * 2], polygon[index * 2 + 1]);
  }
  return out;
}

/**
 * Revolucionado de un perfil alrededor del eje Y.
 *
 * El perfil llega como pares `radio,altura`. Si sus extremos tocan el eje —radio
 * cero— la superficie se cierra en polos, como una esfera o un jarrón; si no, queda
 * abierta por arriba, por abajo o por los dos lados, y la auditoría lo dirá con
 * `BORDE_ABIERTO`. No se tapa por iniciativa propia: un perfil abierto puede ser
 * exactamente lo que se quería, y cerrar sin permiso es cambiar el diseño.
 *
 * Los triángulos que degenerarían en un polo no se emiten, por lo mismo que en la
 * esfera y el cono.
 */
export function createRevolution(profile: readonly number[], segments = 32): Mesh {
  const rings = profile.length / 2;
  if (rings < 2) throw new Error("un revolucionado necesita al menos dos puntos de perfil");

  // El perfil se normaliza a ascendente. La normal de la superficie sale de girar la
  // tangente del perfil, así que un perfil escrito de arriba abajo la produce hacia
  // dentro y el sólido entero queda del revés: medido con media circunferencia, el
  // volumen daba −3,98 en vez de +4,19. Es el mismo error que el polígono al revés en
  // la extrusión, y se corrige igual: ordenando la entrada en vez de confiar en ella.
  const ascending =
    profile[(rings - 1) * 2 + 1] >= profile[1] ? [...profile] : reverseProfile(profile);
  profile = ascending;

  // Un polo es radio cero, pero `Math.sin(Math.PI)` vale 1,2·10⁻¹⁶ y no cero: con una
  // comparación estricta, el anillo del polo sur emitía un triángulo de área nula por
  // segmento. El umbral es relativo al radio mayor del propio perfil.
  let maxRadius = 0;
  for (let ring = 0; ring < rings; ring += 1) maxRadius = Math.max(maxRadius, profile[ring * 2]);
  const axisEpsilon = Math.max(maxRadius, 1) * 1e-9;

  const vertexCount = (segments + 1) * rings;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  let vertex = 0;
  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments;
    const angle = u * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let ring = 0; ring < rings; ring += 1) {
      const radius = profile[ring * 2];
      const y = profile[ring * 2 + 1];
      // Normal: perpendicular a la tangente del perfil, girada con el segmento.
      const previous = Math.max(0, ring - 1);
      const following = Math.min(rings - 1, ring + 1);
      const dr = profile[following * 2] - profile[previous * 2];
      const dy = profile[following * 2 + 1] - profile[previous * 2 + 1];
      const length = Math.hypot(dr, dy) || 1;
      const nr = dy / length;
      const ny = -dr / length;

      positions[vertex * 3 + 0] = cos * radius;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = sin * radius;
      normals[vertex * 3 + 0] = cos * nr;
      normals[vertex * 3 + 1] = ny;
      normals[vertex * 3 + 2] = sin * nr;
      uvs[vertex * 2 + 0] = u;
      uvs[vertex * 2 + 1] = ring / (rings - 1);
      vertex += 1;
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    for (let ring = 0; ring < rings - 1; ring += 1) {
      const current = segment * rings + ring;
      const next = current + rings;
      const radiusLow = profile[ring * 2];
      const radiusHigh = profile[(ring + 1) * 2];
      if (radiusLow > axisEpsilon) indices.push(current, current + 1, next);
      if (radiusHigh > axisEpsilon) indices.push(current + 1, next + 1, next);
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices: Uint32Array.from(indices),
    boundingRadius: boundingRadiusOf(positions),
  };
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
