/**
 * Puerta de R6 — con cuánta autoridad está sostenida la superficie.
 *
 * El bloque 2 es el que justifica que este módulo exista aparte de la cobertura.
 * **Dos cámaras casi juntas ven el mismo punto las dos**, así que la cobertura lo
 * cuenta como triangulado y da un número magnífico; y su profundidad está
 * prácticamente indeterminada, porque un píxel de ruido lo mueve muchísimo. Un
 * paquete puede salir con el 99 % observado y estar sostenido por aire.
 *
 * Todo lo demás cuelga de eso: si la clase no distingue ese caso, el resto es
 * decoración.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PARALLAX_DEGREES,
  computeConfidence,
  computeCoverage,
  computeVisibility,
  parsePlyAscii,
} from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-confianza-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const artifactMalla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
const leida = parsePlyAscii(readFileSync(join(raiz, artifactMalla.path), "utf8")).mesh;
const malla = { ...leida, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 0 };
const SAMPLES = 20_000;

/** La misma cámara desplazada de lado: misma orientación, base minúscula. */
function conBaseCorta(camera, fraccion) {
  const m = [...camera.worldFromCamera];
  // La primera columna de la rotación es el eje X de la cámara —hacia la derecha—
  // y vive en 0, 4 y 8 porque la matriz va por filas. Desplazar por ahí mueve el
  // ojo de lado sin girarlo, que es exactamente una base estereoscópica.
  const distancia = Math.hypot(m[3], m[7], m[11]) || 1;
  const paso = distancia * fraccion;
  m[3] += m[0] * paso;
  m[7] += m[4] * paso;
  m[11] += m[8] * paso;
  return { ...camera, id: `${camera.id}-vecina`, worldFromCamera: m };
}

// 1. El cubo y sus cuatro vistas: bien sostenido, y las clases cuadran con la
//    cobertura.
{
  const visibility = computeVisibility(malla, manifest.cameras, { samples: SAMPLES });
  const coverage = computeCoverage(malla, manifest.cameras, { visibility });
  const confidence = computeConfidence(malla, manifest.cameras, {
    visibility,
    purelyReconstructed: artifactMalla.purelyReconstructed,
  });

  const suma = Object.values(confidence.byClass).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(suma - 1) < 1e-12, `las clases tienen que repartir todo y suman ${suma}`);

  // Las dos medidas leen **la misma visibilidad**, así que sus fronteras tienen
  // que coincidir exactamente. Si divergieran, un informe con las dos sería
  // imposible de cruzar.
  assert.equal(confidence.byClass.SIN_EVIDENCIA, coverage.unobservedAreaRatio);
  assert.equal(confidence.byClass.SIN_TRIANGULAR, coverage.weakAreaRatio);
  assert.equal(
    confidence.byClass.PARALAJE_CORTO + confidence.byClass.SOSTENIDA,
    coverage.triangulatedAreaRatio,
    "lo que triangula se reparte entre corto y sostenido, sin perder nada",
  );

  // Las cuatro vistas están a 0°, 90°, cenital y tres cuartos: cualquier par que
  // comparta cara está muy separado, así que nada cae en paralaje corto.
  assert.equal(confidence.byClass.PARALAJE_CORTO, 0);
  assert.ok(
    confidence.parallaxDegrees.median > 40,
    `el paralaje mediano es ${confidence.parallaxDegrees.median}° y estas cámaras están muy separadas`,
  );
  assert.equal(confidence.parallaxThresholdDegrees, DEFAULT_PARALLAX_DEGREES);
  assert.equal(confidence.certificationEligible, true);

  console.log(
    `confianza: ok (cubo y cuatro vistas: ${(confidence.byClass.SOSTENIDA * 100).toFixed(1)} % sostenida ` +
      `con paralaje mediano de ${confidence.parallaxDegrees.median.toFixed(1)}°, y las fronteras cuadran ` +
      "exactas con las de la cobertura porque leen la misma visibilidad)",
  );
}

// 2. **El caso que justifica el módulo.**
//
// Dos cámaras casi juntas. La cobertura dice «triangulado» y el número sale
// espléndido; la confianza dice que ese par no determina profundidad.
{
  const par = [manifest.cameras[0], conBaseCorta(manifest.cameras[0], 0.01)];
  const visibility = computeVisibility(malla, par, { samples: SAMPLES });
  const coverage = computeCoverage(malla, par, { visibility });
  const confidence = computeConfidence(malla, par, { visibility });

  // La cobertura las cuenta como dos vistas y da todo lo que ven por triangulado.
  assert.ok(
    coverage.triangulatedAreaRatio > 0.1,
    `la cobertura tenía que ver triangulación y da ${coverage.triangulatedAreaRatio}`,
  );
  assert.equal(coverage.weakAreaRatio, 0, "las dos ven lo mismo, así que para la cobertura nada es débil");

  // Y la confianza dice que **nada de eso está sostenido**.
  assert.equal(
    confidence.byClass.SOSTENIDA,
    0,
    `con un grado de base nada puede estar sostenido y hay ${confidence.byClass.SOSTENIDA}`,
  );
  assert.equal(confidence.byClass.PARALAJE_CORTO, coverage.triangulatedAreaRatio);
  assert.ok(
    confidence.parallaxDegrees.p95 < DEFAULT_PARALLAX_DEGREES,
    `el paralaje peor es ${confidence.parallaxDegrees.p95}° y el suelo son ${DEFAULT_PARALLAX_DEGREES}°`,
  );

  console.log(
    `confianza: ok (dos cámaras a una base del 1 %: la cobertura da ` +
      `${(coverage.triangulatedAreaRatio * 100).toFixed(1)} % triangulado y la confianza dice que el ` +
      `100 % de eso es paralaje corto, con mediana de ${confidence.parallaxDegrees.median.toFixed(2)}°. ` +
      "Un paquete puede salir observado y estar sostenido por aire)",
  );
}

// 3. El umbral es un criterio, no una constante: moverlo mueve la frontera.
{
  const visibility = computeVisibility(malla, manifest.cameras, { samples: SAMPLES });
  const suelo = computeConfidence(malla, manifest.cameras, { visibility });
  // Por encima de la mediana del paralaje, la mitad larga pasa a corta.
  const exigente = computeConfidence(malla, manifest.cameras, {
    visibility,
    parallaxThresholdDegrees: suelo.parallaxDegrees.median,
  });

  assert.ok(
    exigente.byClass.PARALAJE_CORTO > 0.2 * suelo.byClass.SOSTENIDA,
    "subir el suelo hasta la mediana tiene que mover buena parte a paralaje corto",
  );
  assert.equal(exigente.parallaxThresholdDegrees, suelo.parallaxDegrees.median);
  // Lo que no se mueve es lo que no depende del umbral: sin evidencia es sin
  // evidencia por muy exigente que uno sea.
  assert.equal(exigente.byClass.SIN_EVIDENCIA, suelo.byClass.SIN_EVIDENCIA);

  console.log(
    `confianza: ok (subir el suelo de ${DEFAULT_PARALLAX_DEGREES}° a la mediana ` +
      `(${suelo.parallaxDegrees.median.toFixed(1)}°) mueve ` +
      `${(exigente.byClass.PARALAJE_CORTO * 100).toFixed(1)} % a paralaje corto, y no toca lo que no ` +
      "tiene evidencia)",
  );
}

// 4. Los extremos, y que las distribuciones digan «nada» en vez de cero.
{
  const una = computeConfidence(malla, [manifest.cameras[0]], { samples: 4_000 });
  assert.equal(una.byClass.SOSTENIDA, 0);
  assert.equal(una.byClass.PARALAJE_CORTO, 0);
  assert.ok(una.byClass.SIN_TRIANGULAR > 0);
  // **`null` y no cero**: con una sola cámara no hay ángulo de triangulación que
  // medir, y un cero se leería como «están alineadas», que es otra afirmación.
  assert.equal(una.parallaxDegrees, null, "sin pares no hay paralaje, y eso no es cero");
  assert.ok(una.obliquityDegrees !== null, "la oblicuidad sí existe con una sola vista");

  const ninguna = computeConfidence(malla, [], { samples: 1_000 });
  assert.equal(ninguna.byClass.SIN_EVIDENCIA, 1);
  assert.equal(ninguna.parallaxDegrees, null);
  assert.equal(ninguna.obliquityDegrees, null);
  assert.equal(ninguna.groundSampling, null);

  console.log(
    "confianza: ok (una sola cámara deja el paralaje en null y no en cero —no es lo mismo «no hay " +
      "ángulo» que «el ángulo es cero»—, y sin cámaras las tres distribuciones son null)",
  );
}

// 5. D21 y determinismo.
{
  const visibility = computeVisibility(malla, manifest.cameras, { samples: 3_000, seed: 4 });
  const mezclada = computeConfidence(malla, manifest.cameras, { visibility, purelyReconstructed: false });
  assert.equal(mezclada.certificationEligible, false);
  assert.equal(mezclada.reason, "MALLA_NO_PURAMENTE_RECONSTRUIDA");
  assert.ok(mezclada.byClass.SOSTENIDA > 0, "no certificar no es no medir");
  assert.equal(mezclada.provenanceAware, false);

  const uno = computeConfidence(malla, manifest.cameras, { samples: 3_000, seed: 4 });
  const dos = computeConfidence(malla, manifest.cameras, { samples: 3_000, seed: 4 });
  assert.equal(JSON.stringify(uno), JSON.stringify(dos));
  const otra = computeConfidence(malla, manifest.cameras, { samples: 3_000, seed: 5 });
  assert.notEqual(otra.byClass.SOSTENIDA, uno.byClass.SOSTENIDA, "la semilla no está decidiendo nada");

  console.log(
    "confianza: ok (D21: no certifica sobre malla mezclada y lo dice con su motivo; misma semilla, " +
      "mismo documento, y otra semilla mueve el número)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "confianza: no ejecutada — la confianza por **residuales** —¿la superficie coincide con lo que las " +
    "fotos muestran?— es R8 y pide profundidad y máscaras. Esta es geométrica: dice desde dónde se " +
    "miró, no si lo que se ve encaja",
);
