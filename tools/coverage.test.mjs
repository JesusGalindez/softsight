/**
 * Puerta de R6 — la cobertura, y lo que puede afirmar sobre ella.
 *
 * Es la pregunta para la que existe la capa de certificación: una malla puede
 * estar impecable en topología y describir una trasera que **nadie fotografió**.
 * Ninguna imagen lo desmiente y ninguna métrica de geometría lo detecta, porque
 * la geometría está bien.
 *
 * El fixture es `cube-v1` — un cubo y cuatro cámaras, frontal, lateral, cenital y
 * tres cuartos— porque ahí la respuesta **se razona antes de medirla**: un cubo
 * tiene seis caras, esas cuatro vistas alcanzan unas y no otras, y cada cara que
 * alcanzan la ven desde dos sitios. Un fixture donde el resultado solo se pueda
 * apuntar después no probaría nada.
 *
 * Y el bloque del umbral es el §86.3 (k) hecho prueba: un ratio sin intervalo no
 * se puede comparar con un umbral, y cuando el umbral cae dentro del intervalo el
 * veredicto es inconcluso en vez de una moneda al aire.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeCoverage, coverageVerdict, parsePlyAscii } from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const sandbox = mkdtempSync(join(tmpdir(), "softsight-cobertura-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const artifactMalla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
const leida = parsePlyAscii(readFileSync(join(raiz, artifactMalla.path), "utf8")).mesh;
const malla = {
  ...leida,
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  boundingRadius: 0,
};
const SAMPLES = 20_000;

// 1. Las cuatro cámaras sobre el cubo.
{
  const coverage = computeCoverage(malla, manifest.cameras, {
    samples: SAMPLES,
    purelyReconstructed: artifactMalla.purelyReconstructed,
  });

  // Las cuatro vistas miran al cubo desde fuera, así que **la mitad de la
  // superficie queda de espaldas**: un cubo visto desde delante, el lado, arriba
  // y tres cuartos deja sin ver la trasera, el otro lado y la base. Que el número
  // ronde el 0,5 no es casualidad de este render.
  assert.ok(
    coverage.observedAreaRatio > 0.45 && coverage.observedAreaRatio < 0.55,
    `la mitad del cubo queda sin ver y sale ${coverage.observedAreaRatio}`,
  );
  assert.ok(
    Math.abs(coverage.observedAreaRatio + coverage.unobservedAreaRatio - 1) < 1e-12,
    "observada y sin ver tienen que sumar uno",
  );

  // **Ninguna muestra la ve exactamente una cámara.** No es un detalle: con esta
  // colocación, cada cara alcanzada cae en el campo de dos vistas. Si alguien
  // mueve una cámara, esto es lo primero que se mueve.
  assert.equal(coverage.weakAreaRatio, 0, `hay ${coverage.bySeenBy[1]} muestras vistas por una sola`);
  assert.equal(coverage.triangulatedAreaRatio, coverage.observedAreaRatio);
  assert.equal(coverage.bySeenBy[1], 0);
  assert.equal(
    coverage.bySeenBy.reduce((total, count) => total + count, 0),
    SAMPLES,
    "el histograma tiene que repartir todas las muestras",
  );

  // D21: sobre malla puramente reconstruida sí certifica, y lo dice.
  assert.equal(coverage.provenanceAware, false, "coverage v1 no sabe de provenance y no lo oculta");
  assert.equal(coverage.certificationEligible, true);
  assert.equal(coverage.reason, undefined, "cuando certifica no hay motivo que dar");
  assert.equal(coverage.areaWeighted, true);
  assert.equal(coverage.samples, SAMPLES);
  assert.equal(coverage.measurementClass, "APPROXIMATE");

  console.log(
    `cobertura: ok (cubo y cuatro vistas: ${(coverage.observedAreaRatio * 100).toFixed(1)} % observada, ` +
      `${(coverage.unobservedAreaRatio * 100).toFixed(1)} % sin ver, y **cero** superficie débil porque ` +
      "cada cara alcanzada cae en el campo de dos cámaras)",
  );
}

// 2. La región débil existe, y una sola cámara la produce entera.
//
// Es lo que justifica que sean tres regiones y no dos: un punto visto por una
// cámara tiene evidencia y no triangula. Con una sola vista, **todo lo observado
// es débil**.
{
  const una = computeCoverage(malla, [manifest.cameras[0]], { samples: SAMPLES });
  assert.ok(una.observedAreaRatio > 0, "una cámara ve algo");
  assert.equal(
    una.weakAreaRatio,
    una.observedAreaRatio,
    "con una sola cámara nada triangula, así que todo lo observado es débil",
  );
  assert.equal(una.triangulatedAreaRatio, 0);
  assert.ok(
    una.observedAreaRatio < 0.35,
    `una cámara sola no puede ver más de dos caras de seis y ve ${una.observedAreaRatio}`,
  );

  console.log(
    `cobertura: ok (con una sola cámara, el ${(una.weakAreaRatio * 100).toFixed(1)} % observado es todo ` +
      "débil y nada triangula: es lo que separa «hay evidencia» de «hay evidencia suficiente»)",
  );
}

// 3. Sin cámaras no hay evidencia, y el número lo dice en vez de fallar.
{
  const ninguna = computeCoverage(malla, [], { samples: 2_000 });
  assert.equal(ninguna.observedAreaRatio, 0);
  assert.equal(ninguna.unobservedAreaRatio, 1);
  assert.equal(ninguna.standardError, 0, "sin varianza no hay intervalo que dar");
  assert.deepEqual(ninguna.interval, [0, 0]);
  console.log("cobertura: ok (sin cámaras, todo sin observar y el intervalo colapsa a cero)");
}

// 4. El umbral, que es el §86.3 (k) hecho prueba.
{
  const coverage = computeCoverage(malla, manifest.cameras, { samples: SAMPLES });
  const [bajo, alto] = coverage.interval;

  // Lejos por debajo y lejos por encima, el veredicto es claro.
  assert.equal(coverageVerdict(coverage, bajo - 0.1), "PASS");
  assert.equal(coverageVerdict(coverage, alto + 0.1), "FAIL");

  // **Dentro del intervalo, inconcluso.** Ahí la medida no distingue, y devolver
  // PASS o FAIL sería echar una moneda con la cara del estimador. Sin este caso,
  // una función que solo comparase el ratio también pasaría la puerta.
  assert.equal(coverageVerdict(coverage, coverage.observedAreaRatio), "INCONCLUSIVE");
  assert.equal(coverageVerdict(coverage, bajo), "INCONCLUSIVE");
  assert.equal(coverageVerdict(coverage, alto), "INCONCLUSIVE");

  // Y el intervalo se estrecha con las muestras: si no lo hiciera, no sería un
  // error de muestreo sino una constante decorativa.
  const pocas = computeCoverage(malla, manifest.cameras, { samples: 1_000 });
  assert.ok(
    pocas.standardError > coverage.standardError * 2,
    `con 1.000 muestras el error es ${pocas.standardError} y con ${SAMPLES} ${coverage.standardError}`,
  );

  console.log(
    `cobertura: ok (umbral dentro del intervalo ${bajo.toFixed(4)}–${alto.toFixed(4)} → INCONCLUSIVE; ` +
      `fuera, PASS o FAIL. Y el error pasa de ${pocas.standardError.toFixed(5)} con 1.000 muestras a ` +
      `${coverage.standardError.toFixed(5)} con ${SAMPLES})`,
  );
}

// 5. D21: sobre malla que no es puramente reconstruida se reporta y no certifica.
{
  const mezclada = computeCoverage(malla, manifest.cameras, {
    samples: 2_000,
    purelyReconstructed: false,
  });
  assert.equal(mezclada.certificationEligible, false);
  assert.equal(mezclada.reason, "MALLA_NO_PURAMENTE_RECONSTRUIDA");
  // El número **sigue saliendo**: la decisión dice que se reporta, no que se
  // calle. Callarlo dejaría al productor sin saber cuánto vio.
  assert.ok(mezclada.observedAreaRatio > 0, "no certificar no es no medir");

  // Y quien no lo declare no certifica: la decisión manda emitir `false` cuando
  // no se puede demostrar `true`, así que ausente y falso pesan igual.
  assert.equal(computeCoverage(malla, manifest.cameras, { samples: 500 }).certificationEligible, false);

  console.log(
    "cobertura: ok (D21: sobre malla no puramente reconstruida el número se reporta y no certifica, " +
      "con su motivo; y no declararlo pesa como declararlo falso)",
  );
}

// 6. Determinismo.
{
  const uno = computeCoverage(malla, manifest.cameras, { samples: 3_000, seed: 9 });
  const dos = computeCoverage(malla, manifest.cameras, { samples: 3_000, seed: 9 });
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos ejecuciones dan documentos distintos");

  // Y la semilla decide: sin esto, una función que devolviera constantes también
  // pasaría el caso de arriba.
  const otra = computeCoverage(malla, manifest.cameras, { samples: 3_000, seed: 10 });
  assert.notEqual(otra.observedAreaRatio, uno.observedAreaRatio, "la semilla no está decidiendo nada");

  console.log(
    `cobertura: ok (misma semilla, mismo documento; con otra, el ratio pasa de ` +
      `${uno.observedAreaRatio.toFixed(4)} a ${otra.observedAreaRatio.toFixed(4)})`,
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "cobertura: no ejecutada — la confianza de R6 necesita además residuales multivista, que es R8 y " +
    "pide profundidad y máscaras; y sobre datos reales espera a un productor que entregue malla, " +
    "porque un SfM disperso no tiene superficie que cubrir",
);
