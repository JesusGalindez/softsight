/**
 * Puerta de `producers/superficie` — la nube dispersa se convierte en superficie,
 * y R6 pasa a medir sobre datos reales.
 *
 * ## Por qué existe esta puerta y no basta con la del informe
 *
 * Hasta hoy la cobertura y la confianza solo se habían medido sobre `cube-v1`:
 * un cubo que escribimos nosotros, cuatro cámaras colocadas a mano y un resultado
 * que se razona antes de medirlo. Eso prueba la aritmética y **no prueba nada
 * sobre datos reales**, donde la nube es irregular, las cámaras están donde el
 * fotógrafo pudo, y media escena no la mira nadie.
 *
 * ## El bloque de la esfera corre siempre, y es el que juzga
 *
 * El fixture pesado puede faltar —vive fuera del repositorio, D22—, así que la
 * parte que decide si el algoritmo está bien no puede depender de él. Una esfera
 * de radio uno tiene respuesta conocida en todo: las normales son radiales, los
 * vértices caen a distancia uno, el área es 4π, **la malla está cerrada** y todas
 * las caras miran hacia fuera. Cada uno de esos cinco números caza un fallo
 * distinto, y el de las caras es el que caza el orden de los quads invertido, que
 * es un error que no se ve en ninguna otra medida.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeMeshTopology } from "../dist-node/agent3d.mjs";
import { buildColmapPackage } from "../producers/colmap/build.mjs";
import { buildSurfacePackage, estimateNormals, meshFromOrientedCloud } from "../producers/superficie/build.mjs";
import { colmapRoot } from "./fixtures.mjs";
import { inspectPackage } from "./reconstruction.mjs";

/** Esfera de radio uno por espiral de Fibonacci: uniforme y determinista. */
function esfera(count) {
  const positions = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * index + 1) / count;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = index * Math.PI * (3 - Math.sqrt(5));
    positions[index * 3] = radius * Math.cos(phi);
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = radius * Math.sin(phi);
  }
  return positions;
}

const OJOS = [[5, 0, 0], [-5, 0, 0], [0, 5, 0], [0, -5, 0], [0, 0, 5], [0, 0, -5]];
const PUNTOS = 4_000;
const REJILLA = 48;

// 1. La esfera, y sus cinco respuestas conocidas.
{
  const positions = esfera(PUNTOS);
  const celda = 2 / REJILLA;
  const normals = estimateNormals(positions, PUNTOS, OJOS, celda * 2.5);

  // En la esfera la normal exacta **es la propia posición**, así que el producto
  // con ella tiene que dar uno. El mínimo sobre los 4.000 puntos es el que caza
  // una normal volteada, que un promedio escondería.
  let peorNormal = 1;
  for (let index = 0; index < PUNTOS; index += 1) {
    const facing =
      positions[index * 3] * normals[index * 3] +
      positions[index * 3 + 1] * normals[index * 3 + 1] +
      positions[index * 3 + 2] * normals[index * 3 + 2];
    if (facing < peorNormal) peorNormal = facing;
  }
  assert.ok(peorNormal > 0.99, `la peor normal se desvía: producto ${peorNormal}`);

  const malla = meshFromOrientedCloud(positions, normals, PUNTOS, REJILLA);
  assert.ok(malla.triangles.length > 10_000, "una esfera a rejilla 48 da miles de triángulos");

  let minimo = Infinity;
  let maximo = 0;
  for (let index = 0; index < malla.vertices.length; index += 3) {
    const radio = Math.hypot(malla.vertices[index], malla.vertices[index + 1], malla.vertices[index + 2]);
    if (radio < minimo) minimo = radio;
    if (radio > maximo) maximo = radio;
  }
  assert.ok(minimo > 0.99 && maximo < 1.01, `los vértices caen entre ${minimo} y ${maximo}, y deberían en 1`);

  // Orientación: la normal de cada cara contra el vector al centro. **Todas**, no
  // la mayoría: el orden de los quads es global, así que una sola invertida
  // significa que la regla está mal escrita en alguna de las tres direcciones.
  let haciaFuera = 0;
  for (let slot = 0; slot < malla.triangles.length; slot += 3) {
    const punto = (vertex) => [
      malla.vertices[vertex * 3],
      malla.vertices[vertex * 3 + 1],
      malla.vertices[vertex * 3 + 2],
    ];
    const [p, q, r] = [
      punto(malla.triangles[slot]),
      punto(malla.triangles[slot + 1]),
      punto(malla.triangles[slot + 2]),
    ];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const centro = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
    if (n[0] * centro[0] + n[1] * centro[1] + n[2] * centro[2] > 0) haciaFuera += 1;
  }
  assert.equal(
    haciaFuera,
    malla.triangles.length / 3,
    `${malla.triangles.length / 3 - haciaFuera} caras miran hacia dentro`,
  );

  // Cerrada: con evidencia en toda la esfera no hay sitio donde dejar borde, así
  // que cualquier arista suelta sería un quad que la regla no emitió.
  const topologia = analyzeMeshTopology({
    positions: new Float32Array(malla.vertices),
    indices: new Uint32Array(malla.triangles),
  });
  assert.equal(topologia.boundaryLoops.length, 0, "la esfera tiene evidencia por todas partes: va cerrada");
  assert.equal(topologia.unresolvedBoundaryEdges, 0);
  assert.equal(topologia.components.length, 1, "una esfera es una pieza");
  assert.ok(
    Math.abs(topologia.area - 4 * Math.PI) / (4 * Math.PI) < 0.01,
    `el área es ${topologia.area} y 4π son ${4 * Math.PI}`,
  );

  console.log(
    `superficie: ok (esfera de 4.000 puntos: normal peor ${peorNormal.toFixed(4)}, vértices entre ` +
      `${minimo.toFixed(4)} y ${maximo.toFixed(4)}, área ${topologia.area.toFixed(3)} contra 4π = ` +
      `${(4 * Math.PI).toFixed(3)}, cerrada, y las ${haciaFuera} caras hacia fuera)`,
  );
}

// 2. Sin soporte no hay superficie: el agujero es la respuesta, no un cero.
//
// Media esfera de puntos. Donde no hay evidencia, la malla **no cierra**, y eso
// es lo que separa esto de Poisson: Poisson taparía el hueco con una superficie
// que nadie fotografió, y la cobertura la contaría como no observada sin decir
// que nos la habíamos inventado nosotros.
{
  const completa = esfera(PUNTOS);
  const mitad = [];
  for (let index = 0; index < PUNTOS; index += 1) {
    if (completa[index * 3 + 1] < 0) continue;
    mitad.push(completa[index * 3], completa[index * 3 + 1], completa[index * 3 + 2]);
  }
  const positions = new Float64Array(mitad);
  const count = mitad.length / 3;
  const normals = estimateNormals(positions, count, OJOS, (2 / REJILLA) * 2.5);
  const malla = meshFromOrientedCloud(positions, normals, count, REJILLA);
  const topologia = analyzeMeshTopology({
    positions: new Float32Array(malla.vertices),
    indices: new Uint32Array(malla.triangles),
  });

  assert.ok(topologia.boundaryLoops.length > 0, "media esfera tiene que dejar borde donde no hay puntos");
  assert.ok(
    topologia.area < 4 * Math.PI * 0.75,
    `el área es ${topologia.area} y media esfera no puede acercarse a la entera`,
  );

  console.log(
    `superficie: ok (media esfera deja ${topologia.boundaryLoops[0].edges} aristas de borde en su bucle ` +
      `mayor y ${topologia.area.toFixed(2)} de área: donde no hay evidencia no se inventa superficie)`,
  );
}

// 3. Determinismo.
{
  const positions = esfera(1_000);
  const celda = (2 / 32) * 2.5;
  const uno = meshFromOrientedCloud(positions, estimateNormals(positions, 1_000, OJOS, celda), 1_000, 32);
  const dos = meshFromOrientedCloud(positions, estimateNormals(positions, 1_000, OJOS, celda), 1_000, 32);
  assert.deepEqual(uno.triangles, dos.triangles, "dos mallados dan triángulos distintos");
  assert.deepEqual(uno.vertices, dos.vertices);
  console.log("superficie: ok (dos mallados de la misma nube dan la misma malla, vértice a vértice)");
}

// 4. Datos reales — y con esto R6 deja de medir solo sobre el cubo.
const escena = join(colmapRoot, "south-building");
if (!existsSync(join(escena, "images"))) {
  console.log(
    `superficie: no ejecutada — falta el fixture pesado en ${escena} (SOFTSIGHT_COLMAP). Los bloques ` +
      "de arriba juzgan el algoritmo; este juzga que la cobertura y la confianza sobreviven a una nube " +
      "real, y sin la nube no hay nada que medir",
  );
} else {
  const sandbox = mkdtempSync(join(tmpdir(), "softsight-superficie-"));
  const disperso = join(sandbox, "colmap-v1");
  const conMalla = join(sandbox, "superficie-v1");
  buildColmapPackage(escena, disperso);
  const construido = buildSurfacePackage(disperso, conMalla, 128);

  const { report, exitCode } = inspectPackage(join(conMalla, "manifest.json"));
  assert.equal(report.execution, "COMPLETE", JSON.stringify(report.warnings));
  assert.equal(report.certification, "PASS", report.certificationReason);
  assert.equal(exitCode, 0);

  // **Lo que esta puerta existe para comprobar.** El paquete disperso no tenía
  // superficie, así que estos dos bloques no se podían ni calcular; ahora sí.
  assert.ok(report.coverage !== undefined, "con malla y cámaras tiene que haber cobertura");
  assert.ok(report.confidence !== undefined);
  assert.equal(report.coverage.samples > 0, true);

  // Rangos amplios a propósito: el número exacto depende de la rejilla y del
  // muestreo, y clavarlo aquí convertiría la puerta en una copia del resultado.
  // Lo que se afirma es lo que **tiene** que pasar con ocho vistas de una fachada:
  // se ve buena parte y **no se ve todo**, que es justo lo que ninguna imagen
  // renderizada delataría.
  assert.ok(
    report.coverage.observedAreaRatio > 0.4 && report.coverage.observedAreaRatio < 0.95,
    `ocho vistas ven ${report.coverage.observedAreaRatio} de la superficie`,
  );
  assert.ok(
    report.coverage.unobservedAreaRatio > 0.05,
    "una reconstrucción de ocho vistas deja superficie que nadie miró, y eso tiene que salir",
  );
  const [bajo, alto] = report.coverage.interval;
  assert.ok(bajo < report.coverage.observedAreaRatio && report.coverage.observedAreaRatio < alto);

  // La confianza sobre cámaras reales: separadas de verdad, así que la mediana
  // del paralaje está muy por encima del suelo, y aun así queda algo corto.
  assert.ok(
    report.confidence.parallaxDegrees.median > 5,
    `el paralaje mediano es ${report.confidence.parallaxDegrees.median}° sobre cámaras reales`,
  );
  assert.ok(report.confidence.byClass.SOSTENIDA > 0.2, "buena parte tiene que estar sostenida");
  const suma = Object.values(report.confidence.byClass).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(suma - 1) < 1e-12);

  // La malla real **está abierta**, y el informe lo dice. Una fachada vista por
  // ocho cámaras no puede salir cerrada, y si saliera sería que el mallador tapó.
  const medida = report.measurements.find((entry) => entry.boundaryEdges !== undefined);
  assert.ok(medida !== undefined && medida.boundaryEdges > 0, "una fachada parcial no puede salir cerrada");

  // Determinismo del productor entero sobre datos reales.
  const otra = join(sandbox, "superficie-v1-otra-vez");
  buildSurfacePackage(disperso, otra, 128);
  for (const nombre of ["manifest.json", "malla.ply"]) {
    assert.equal(
      readFileSync(join(conMalla, nombre), "utf8"),
      readFileSync(join(otra, nombre), "utf8"),
      `${nombre}: dos construcciones dan ficheros distintos`,
    );
  }

  console.log(
    `superficie: ok (south-building, ${construido.points} puntos de ocho vistas → ` +
      `${construido.mesh.triangles.length / 3} triángulos: ` +
      `${(report.coverage.observedAreaRatio * 100).toFixed(1)} % observada, ` +
      `${(report.coverage.unobservedAreaRatio * 100).toFixed(1)} % que nadie miró, ` +
      `${(report.confidence.byClass.SOSTENIDA * 100).toFixed(1)} % sostenida con paralaje mediano de ` +
      `${report.confidence.parallaxDegrees.median.toFixed(1)}°. R6 sobre datos reales)`,
  );

  rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  "superficie: no ejecutada — la malla sale de una nube **dispersa**, así que describe la fachada con " +
    "el detalle que dan 16.000 puntos y no el de una reconstrucción densa. Para eso hace falta " +
    "profundidad, que exige CUDA en los dos caminos que existen (COLMAP y Meshroom) y no corre aquí",
);
