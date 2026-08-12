/**
 * Malla de prueba a escala, determinista y generada al vuelo.
 *
 * La línea base de `auditMesh` necesita mallas de 100k, 1M y 5M triángulos. En
 * git no caben —5M triángulos son ~90 MB de arrays— y D22 lo prohíbe: fixture
 * ligero versionado o fixture pesado fuera del repositorio. Un generador es la
 * tercera vía: cero bytes en git y el mismo resultado en cualquier máquina, que
 * es lo que hace comparables la medida de hoy y la de después de reescribir
 * `weldPositions`.
 *
 * Es un toro teselado con la rejilla partida en la costura, y las tres cosas
 * importan:
 *
 *   - **Cerrado y manifold**: `boundaryEdges` y `nonManifoldEdges` salen cero, así
 *     que si la reescritura de S2/S3 rompe la topología, el número lo canta.
 *   - **Costura duplicada**: la última fila y la última columna repiten la
 *     posición de la primera. Sin eso `weldPositions` no soldaría nada y la
 *     medida no tocaría el caso que motiva el trabajo. Duplicados esperados:
 *     `u + v + 1`.
 *   - **Sin degenerados**: el radio menor nunca alcanza al mayor, así que ningún
 *     triángulo tiene área nula y el recuento de aristas es el real, no el que
 *     deja el atajo de `inspect.ts:157`.
 *
 * Todo en `Float32Array`/`Uint32Array`, como `mesh.ts`: la medida debe ver el
 * coste de `auditMesh`, no el de una representación de juguete.
 */

const MAJOR_RADIUS = 1;
const MINOR_RADIUS = 0.35;

/**
 * Divisiones `(u, v)` cuyo producto por dos da el recuento de triángulos pedido.
 *
 * Se reparten con proporción fija 2:1 —el toro es más largo por fuera que por su
 * sección— y `u` se redondea a par para que el reparto no dependa del orden de
 * las operaciones en coma flotante.
 */
export function divisionsFor(triangles) {
  const quads = Math.round(triangles / 2);
  let u = Math.max(2, 2 * Math.round(Math.sqrt(quads * 2) / 2));
  let v = Math.max(2, Math.round(quads / u));
  return { u, v, triangles: 2 * u * v };
}

/**
 * Toro de `2 · u · v` triángulos. Devuelve un `Mesh` del núcleo: mismos campos y
 * mismo layout indexado, para que `auditMesh` no distinga esto de una malla
 * cargada de un GLB.
 */
export function torusMesh(triangles) {
  const { u, v } = divisionsFor(triangles);
  const columns = u + 1;
  const rows = v + 1;
  const vertexCount = columns * rows;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row < rows; row += 1) {
    const phi = (2 * Math.PI * row) / v;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let column = 0; column < columns; column += 1) {
      const theta = (2 * Math.PI * column) / u;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const ring = MAJOR_RADIUS + MINOR_RADIUS * cosPhi;
      const vertex = row * columns + column;
      positions[vertex * 3] = ring * cosTheta;
      positions[vertex * 3 + 1] = MINOR_RADIUS * sinPhi;
      positions[vertex * 3 + 2] = ring * sinTheta;
      normals[vertex * 3] = cosPhi * cosTheta;
      normals[vertex * 3 + 1] = sinPhi;
      normals[vertex * 3 + 2] = cosPhi * sinTheta;
      uvs[vertex * 2] = column / u;
      uvs[vertex * 2 + 1] = row / v;
    }
  }

  const indices = new Uint32Array(u * v * 6);
  let cursor = 0;
  for (let row = 0; row < v; row += 1) {
    for (let column = 0; column < u; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      // Antihorario visto desde fuera, como el resto del motor: un bobinado al
      // revés dejaría `flippedNormalRatio` a 1 y `signedVolume` negativo, y la
      // línea base mediría una malla rota en vez de una sana.
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    boundingRadius: MAJOR_RADIUS + MINOR_RADIUS,
  };
}

/** Vértices que la costura repite, que es lo que `weldPositions` debe soldar. */
export function expectedDuplicates(triangles) {
  const { u, v } = divisionsFor(triangles);
  return u + v + 1;
}
