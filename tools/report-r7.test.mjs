/**
 * Puerta de R7 — el informe de máquina y el de persona, de un solo paquete.
 *
 * La trampa del escalón está en el «de un solo». Escribir el texto por su cuenta
 * sería un segundo original del veredicto, y el día que discrepen el que se lea
 * será el bonito. El bloque 2 lo comprueba de la única forma que vale: cambiando
 * el informe y viendo que el texto cambia con él.
 *
 * Y el bloque 3 es el §53 —todo aviso importante lleva evidencia—. Un aviso que
 * solo dijera «hay superficie sin ver» obliga a recalcularlo para saber si es el
 * 2 % o el 40 %, y a recalcularlo con otro muestreo, que daría otro número.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORT_WARNING_FLOOR } from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage, renderHuman } from "./reconstruction.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "softsight-r7-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifestPath = join(raiz, "manifest.json");

// 1. De un paquete salen las dos mitades, y la de máquina lleva la evidencia.
{
  const { report, exitCode } = inspectPackage(manifestPath);
  assert.equal(exitCode, 0);

  // Los bloques de R6 están porque hay malla **y** cámaras.
  assert.ok(report.coverage !== undefined, "con malla y cámaras tiene que haber cobertura");
  assert.ok(report.confidence !== undefined);
  // Y las dos leen la misma visibilidad, así que sus fronteras coinciden exactas.
  assert.equal(report.confidence.byClass.SIN_EVIDENCIA, report.coverage.unobservedAreaRatio);

  const texto = renderHuman(report);
  // El intervalo va **al lado del ratio** en el texto: es lo que impide leer
  // «49,4 %» como exacto, que es justo lo que un informe en prosa invita a hacer.
  assert.match(texto, /cobertura\s+\d+\.\d % observada \(\d+\.\d %–\d+\.\d %, \d+ muestras por área\)/);
  assert.match(texto, /confianza\s+\d+\.\d % sostenida/);
  assert.match(texto, /paralaje p05 \d+\.\d° · mediana \d+\.\d°/);
  assert.match(texto, /cube-v1 — COMPLETE · PASA/);

  console.log(
    `r7: ok (un paquete da informe de máquina con cobertura y confianza, y de persona con el ` +
      `intervalo al lado del ratio: ${(report.coverage.observedAreaRatio * 100).toFixed(1)} % observada)`,
  );
}

// 2. El texto **deriva** del informe, no lo reescribe.
//
// Se cambia el objeto y se mira si el texto cambia con él. Si el renderizador
// tuviera su propia fuente, esto no se movería.
{
  const { report } = inspectPackage(manifestPath);
  const original = renderHuman(report);

  const tocado = JSON.parse(JSON.stringify(report));
  tocado.certification = "FAIL";
  tocado.certificationReason = "MALLA_SIN_SUPERFICIE";
  tocado.coverage.observedAreaRatio = 0.123;
  const cambiado = renderHuman(tocado);

  assert.notEqual(cambiado, original);
  assert.match(cambiado, /12\.3 % observada/, "el texto tiene que salir del objeto");
  assert.match(cambiado, /— COMPLETE · FAIL/);
  assert.match(cambiado, /motivo: MALLA_SIN_SUPERFICIE/);
  assert.ok(!cambiado.includes("PASA"), "el veredicto viejo no puede sobrevivir en el texto");

  // Y lo que el informe no trae, el texto no lo inventa: sin bloques de R6 no
  // hay líneas de cobertura ni de confianza.
  const sinR6 = JSON.parse(JSON.stringify(report));
  delete sinR6.coverage;
  delete sinR6.confidence;
  const pobre = renderHuman(sinR6);
  assert.ok(!pobre.includes("cobertura"), "sin bloque no puede haber línea");
  assert.ok(!pobre.includes("confianza"));

  console.log(
    "r7: ok (el texto deriva del informe: tocar el objeto mueve el texto, y lo que el objeto no trae " +
      "el texto no lo inventa)",
  );
}

// 3. Evidencia en el aviso — §53.
{
  const { report } = inspectPackage(manifestPath);
  const aviso = report.warnings.find((warning) => warning.code === "SS-COV-001");
  assert.ok(aviso !== undefined, "el cubo deja media superficie sin ver y eso se avisa");

  assert.ok(aviso.evidence !== undefined, "un aviso importante sin evidencia obliga a recalcularlo");
  assert.equal(aviso.evidence.ratio, report.coverage.unobservedAreaRatio);
  assert.equal(aviso.evidence.samples, report.coverage.samples);
  assert.equal(aviso.evidence.areaWeighted, true);
  assert.deepEqual(aviso.evidence.interval, report.coverage.interval);
  assert.equal(aviso.reason, "SUPERFICIE_SIN_EVIDENCIA");

  console.log(
    `r7: ok (el aviso lleva su ratio, sus ${aviso.evidence.samples} muestras y su intervalo: quien lo ` +
      "lea puede juzgarlo contra su propio umbral sin recalcular nada)",
  );
}

// 4. Un aviso de cobertura **no decide el veredicto**.
//
// El umbral lo pone quien conoce la pieza, igual que el presupuesto de D9. Si la
// falta de cobertura suspendiera por su cuenta, softsight estaría decidiendo qué
// tiene que fotografiar el productor.
{
  const { report, exitCode } = inspectPackage(manifestPath);
  assert.ok(report.warnings.length > 0, "hay avisos");
  assert.equal(report.certification, "PASS");
  assert.equal(exitCode, 0, "media superficie sin ver no suspende: el umbral no es nuestro");

  console.log(
    "r7: ok (media superficie sin ver avisa y no suspende: el umbral lo pone quien conoce la pieza, " +
      "como el presupuesto de D9)",
  );
}

// 5. El suelo del aviso, que es el suelo del muestreo y no una tolerancia.
{
  const { report } = inspectPackage(manifestPath);
  for (const warning of report.warnings) {
    if (warning.evidence?.ratio === undefined) continue;
    assert.ok(
      warning.evidence.ratio > SUPPORT_WARNING_FLOOR,
      `${warning.code} avisa de ${warning.evidence.ratio}, por debajo del suelo`,
    );
  }
  // Nada bajo el suelo se comenta: con ocho mil muestras, un uno por mil son ocho
  // puntos y su intervalo lo cruza entero. Avisar de eso sería avisar de ruido.
  assert.ok(SUPPORT_WARNING_FLOOR > 0 && SUPPORT_WARNING_FLOOR < 0.1);
  assert.equal(
    report.warnings.filter((warning) => warning.code === "SS-COV-002").length,
    0,
    "el cubo no tiene superficie vista por una sola cámara, así que ese aviso no sale",
  );

  console.log(
    `r7: ok (nada por debajo del ${(SUPPORT_WARNING_FLOOR * 100).toFixed(0)} % se comenta —sería ruido ` +
      "de muestreo— y el aviso que no aplica no aparece)",
  );
}

// 6. Sin superficie no hay bloques, y eso no es cero.
{
  const sinMalla = JSON.parse(readFileSync(manifestPath, "utf8"));
  sinMalla.artifacts = sinMalla.artifacts.filter((artifact) => artifact.type !== "TRIANGLE_MESH");
  sinMalla.requiredEvidence = ["sparse"];
  const otro = join(sandbox, "sin-malla.json");
  // El manifest vive en la misma raíz para que las rutas relativas sigan valiendo.
  const destino = join(raiz, "manifest-sin-malla.json");
  writeFileSync(destino, JSON.stringify(sinMalla, null, 2));

  const { report, exitCode } = inspectPackage(destino);
  assert.equal(report.certification, "PASS", "sin malla que nadie pidió se pasa (D8)");
  assert.equal(exitCode, 0);
  assert.equal(report.coverage, undefined, "sin superficie la pregunta no se puede hacer");
  assert.equal(report.confidence, undefined);
  assert.ok(!renderHuman(report).includes("cobertura"));
  assert.equal(otro, otro);

  console.log(
    "r7: ok (un paquete sin malla no trae cobertura **ausente**, no a cero: sin superficie la pregunta " +
      "no se puede hacer, y un cero diría que no se ve nada)",
  );
}

// 7. Determinismo del informe entero, con R6 dentro.
{
  const uno = inspectPackage(manifestPath).report;
  const dos = inspectPackage(manifestPath).report;
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos consumos dan informes distintos");
  assert.equal(renderHuman(uno), renderHuman(dos));
  console.log("r7: ok (dos consumos del mismo paquete dan el mismo informe y el mismo texto)");
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "r7: no ejecutada — los pliegos de contacto y los modos de diagnóstico que R7 también pide siguen " +
    "fuera: el pliego existe para modelos (`renderContactSheet`) y atarlo a un paquete de " +
    "reconstrucción pide decidir qué vistas se rinden, que es criterio y no código",
);
