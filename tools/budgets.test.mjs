/**
 * Puerta de R9 — los presupuestos, evaluados contra lo medido.
 *
 * ## Lo que esta puerta impide que vuelva
 *
 * `budgets` estaba en el esquema desde R0 y **nadie lo leía**. La ingesta miraba
 * que fueran coherentes con la escala y ahí se acababa: un paquete podía declarar
 * `triangulos ≤ 5`, entregar doce, y salir **PASS con salida 0**. El bloque 1 es
 * literalmente ese contraste — el mismo paquete, con y sin el presupuesto — y sin
 * él una implementación que siguiera ignorando el campo aprobaría la puerta.
 *
 * Es el tercer campo del contrato que se rellenaba por educación, después del
 * FrameGraph y de la provenance, y los tres se descubrieron igual: preguntando
 * quién lee esto.
 *
 * ## Y lo que impide que se pase de frenada
 *
 * El bloque 3. Un nombre fuera del vocabulario **no puede dejar el paquete sin
 * entregar**: se declara `NO_EVALUADO`, no toca el veredicto, y los presupuestos
 * que sí se entienden se siguen juzgando. Rechazar el paquete entero castigaría a
 * un productor por usar un vocabulario más nuevo que el nuestro, que es
 * exactamente lo que D30 evita con las extensiones opcionales.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUDGET_NAMES, BUDGET_TERMS, evaluateBudgets } from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-presupuestos-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const base = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));

/** El mismo paquete con otros presupuestos, en un manifest al lado del original. */
let contador = 0;
function conPresupuestos(budgets, cambios = {}) {
  const documento = { ...JSON.parse(JSON.stringify(base)), ...cambios, budgets };
  // En la misma raíz para que las rutas relativas de los artifacts sigan valiendo.
  const destino = join(raiz, `manifest-${(contador += 1)}.json`);
  writeFileSync(destino, `${JSON.stringify(documento, null, 2)}\n`);
  return inspectPackage(destino);
}

const recuento = (name, max) => ({ name, units: "ABSOLUTE", unit: "unidades", max });

// 1. **El campo dejó de ser decoración.** El mismo paquete, con y sin el límite.
{
  const sin = inspectPackage(join(raiz, "manifest.json"));
  assert.equal(sin.report.certification, "PASS");
  assert.equal(sin.exitCode, 0);
  assert.deepEqual(sin.report.budgets, [], "sin declarar ninguno, la lista va vacía y no ausente");

  const con = conPresupuestos([recuento("triangulos", 5)]);
  assert.equal(con.report.certification, "FAIL", "doce triángulos sobre un máximo de cinco");
  assert.equal(con.report.certificationReason, "PRESUPUESTO_EXCEDIDO");
  assert.equal(con.exitCode, 1, "y suspender tiene que llegar al código de salida");

  const fila = con.report.budgets[0];
  assert.equal(fila.verdict, "FAIL");
  assert.equal(fila.observed, 12, "la malla del cubo trae doce triángulos");
  assert.equal(fila.max, 5);
  assert.equal(fila.reason, "PRESUPUESTO_EXCEDIDO");
  // Lo medido **va en el informe**: un veredicto sin el número obliga a
  // recalcularlo para saber si se pasó por poco o por diez veces.
  assert.ok(typeof fila.measures === "string" && fila.measures.length > 0);

  console.log(
    "presupuestos: ok (el mismo paquete sale PASS con salida 0 sin declarar límite y FAIL con salida 1 " +
      "declarando `triangulos ≤ 5` sobre doce: hasta hoy el campo se rellenaba por educación)",
  );
}

// 2. La frontera, exacta.
//
// `<=` y no `<`: un máximo es el mayor valor admitido, no el primero prohibido.
// Sin este par, una implementación con el signo cambiado pasaría el bloque 1.
{
  const justo = conPresupuestos([recuento("triangulos", 12)]);
  assert.equal(justo.report.budgets[0].verdict, "PASS", "doce sobre un máximo de doce cumple");
  assert.equal(justo.report.certification, "PASS");
  assert.equal(justo.exitCode, 0);
  assert.equal(justo.report.budgets[0].reason, undefined, "lo que cumple no lleva motivo");

  const porUno = conPresupuestos([recuento("triangulos", 11)]);
  assert.equal(porUno.report.budgets[0].verdict, "FAIL");

  console.log("presupuestos: ok (doce de doce cumple y doce de once no: el máximo es el mayor admitido)");
}

// 3. **Un nombre desconocido no deja el paquete sin entregar** — mientras esté
//    bien declarado.
//
// Relativo a la diagonal, que es legal para cualquier término bajo D9. Absoluto y
// con unidad sobre una escala que no lo es, **sí** se rechaza, y eso lo fija
// `test:reconstruction`: no sabemos qué es `suavidad`, así que suponer que no
// lleva escala sería suponer a favor.
{
  const mezcla = conPresupuestos([
    { name: "suavidad", units: "RELATIVE_TO_DIAGONAL", max: 0.03 },
    recuento("triangulos", 50),
  ]);
  assert.equal(mezcla.report.execution, "COMPLETE", JSON.stringify(mezcla.report.warnings));
  assert.equal(mezcla.report.certification, "PASS", "el desconocido no suspende ni deja inconcluso");
  assert.equal(mezcla.exitCode, 0);

  const [desconocido, conocido] = mezcla.report.budgets;
  assert.equal(desconocido.verdict, "NO_EVALUADO");
  assert.equal(desconocido.reason, "TERMINO_DESCONOCIDO");
  assert.equal(desconocido.observed, undefined, "no se inventa un número para lo que no se entiende");
  // Y **el que sí se entiende se sigue juzgando**: rechazar el paquete entero
  // dejaría sin medir también lo que sabemos medir.
  assert.equal(conocido.verdict, "PASS");
  assert.equal(conocido.observed, 12);
  // El orden es el del manifest: el productor tiene que poder cruzar línea a línea.
  assert.equal(desconocido.name, "suavidad");

  // Y el otro lado de la misma moneda: el mismo término desconocido, declarado
  // absoluto sobre una escala que no lo es, sigue siendo un paquete que se
  // contradice. Lo que se aflojó por R9 son los **recuentos y fracciones de la
  // lista**, no el desconocido.
  const absoluto = conPresupuestos([{ name: "suavidad", units: "ABSOLUTE", unit: "m", max: 3 }]);
  assert.equal(absoluto.report.execution, "ERROR");
  assert.ok(absoluto.report.warnings.some((aviso) => aviso.code === "SS-RECON-001"));

  console.log(
    "presupuestos: ok (un término fuera del vocabulario sale NO_EVALUADO, no toca el veredicto y **no " +
      "impide juzgar los demás**: nuestra versión no es el criterio de validez de la suya)",
  );
}

// 4. D9 ata a lo que lleva escala dentro, y solo a eso.
{
  assert.equal(base.scale.status, "RELATIVE", "el cubo no declara escala absoluta");

  // Un recuento en una escala no absoluta es perfectamente sensato: mil
  // triángulos son mil en cualquier escala.
  const contando = conPresupuestos([recuento("triangulos", 50)]);
  assert.equal(contando.report.execution, "COMPLETE");
  assert.equal(contando.report.budgets[0].verdict, "PASS");

  // Un volumen, no: medio metro cúbico sobre una reconstrucción sin escala no
  // significa nada, y eso lo rechaza la ingesta antes de medir (D9).
  const midiendo = conPresupuestos([{ name: "volumen", units: "ABSOLUTE", unit: "m3", max: 0.5 }]);
  assert.equal(midiendo.report.execution, "ERROR");
  assert.ok(
    midiendo.report.warnings.some((aviso) => aviso.code === "SS-RECON-001"),
    JSON.stringify(midiendo.report.warnings.map((aviso) => aviso.code)),
  );

  console.log(
    "presupuestos: ok (D9 sobre escala RELATIVE: un recuento absoluto pasa y un volumen absoluto se " +
      "rechaza, porque uno lleva escala dentro y el otro no)",
  );
}

// 5. Un recuento no es relativo a la diagonal.
{
  const torcido = conPresupuestos([{ name: "triangulos", units: "RELATIVE_TO_DIAGONAL", max: 0.01 }]);
  const fila = torcido.report.budgets[0];
  assert.equal(fila.verdict, "NO_EVALUADO");
  assert.equal(fila.reason, "UNIDAD_DE_PRESUPUESTO_MAL_DECLARADA");
  assert.equal(fila.observed, undefined, "evaluarlo daría un veredicto sobre otra cosa");

  console.log(
    "presupuestos: ok (un recuento declarado relativo a la diagonal no se evalúa como si la unidad " +
      "no importara: sale NO_EVALUADO con su motivo)",
  );
}

// 6. El término se entiende y la medida falta: **inconcluso**, que no es ninguna
//    de las dos cosas anteriores.
{
  const sinCamaras = conPresupuestos(
    [{ name: "superficie-sin-ver", units: "ABSOLUTE", unit: "fraccion", max: 0.4 }],
    { cameras: [], artifacts: base.artifacts.filter((a) => a.type !== "IMAGE") },
  );
  assert.equal(sinCamaras.report.coverage, undefined, "sin cámaras no hay cobertura que presupuestar");
  assert.equal(sinCamaras.report.budgets[0].verdict, "NO_EVALUADO");
  assert.equal(sinCamaras.report.budgets[0].reason, "METRICA_REQUERIDA_NO_DISPONIBLE");
  // **Y sí mueve el veredicto**, al revés que el desconocido: aquí el término se
  // entiende, el productor pidió que se juzgara, y no se pudo.
  assert.equal(sinCamaras.report.certification, "INCONCLUSIVE");
  assert.equal(sinCamaras.report.certificationReason, "METRICA_REQUERIDA_NO_DISPONIBLE");
  assert.equal(sinCamaras.exitCode, 11);

  // Y con cámaras el mismo presupuesto sí se juzga.
  const conCamaras = conPresupuestos([
    { name: "superficie-sin-ver", units: "ABSOLUTE", unit: "fraccion", max: 0.4 },
  ]);
  assert.equal(conCamaras.report.budgets[0].verdict, "FAIL", "el cubo deja media superficie sin ver");
  assert.ok(conCamaras.report.budgets[0].observed > 0.4);

  console.log(
    "presupuestos: ok (término entendido y medida ausente deja INCONCLUSIVE con salida 11 —no PASS y " +
      "no FAIL—, y con cámaras el mismo límite se juzga y suspende)",
  );
}

// 7. Los presupuestos no pueden **rescatar** un paquete que ya estaba mal.
{
  const roto = conPresupuestos([recuento("triangulos", 50)], { state: "DRAFT" });
  assert.notEqual(roto.report.execution, "COMPLETE");
  assert.equal(roto.report.certification, "INCONCLUSIVE");
  assert.equal(roto.report.certificationReason, "PAQUETE_NO_CONSUMIBLE");
  // El presupuesto cumpliría, y da igual: juzgar un límite sobre un paquete que
  // no se pudo leer sería afirmar algo de una geometría que nadie ha medido.
  assert.ok(roto.report.budgets.every((fila) => fila.verdict === "NO_EVALUADO"));

  console.log(
    "presupuestos: ok (sobre un paquete sin sellar, el veredicto sigue siendo PAQUETE_NO_CONSUMIBLE: " +
      "un presupuesto que cumple no rescata lo que no se pudo leer)",
  );
}

// 8. La agregación es del **paquete**, no de una malla.
{
  const dos = [
    { vertices: 10, triangles: 4, degenerateTriangles: 1, boundaryEdges: 3, nonManifoldEdges: 0, signedVolume: -2 },
    { vertices: 20, triangles: 6, degenerateTriangles: 0, boundaryEdges: 5, nonManifoldEdges: 2, signedVolume: 3 },
  ];
  const resultados = evaluateBudgets(
    [recuento("triangulos", 9), recuento("aristas-de-borde", 8), recuento("vertices", 100)],
    { measurements: dos },
  );
  assert.equal(resultados[0].observed, 10, "cuatro y seis triángulos son diez");
  assert.equal(resultados[0].verdict, "FAIL");
  assert.equal(resultados[1].observed, 8);
  assert.equal(resultados[1].verdict, "PASS");
  assert.equal(resultados[2].observed, 30);

  // El volumen va en valor absoluto: una malla del revés tiene volumen negativo,
  // y eso lo juzga `MALLA_INVERTIDA`. Presupuestar el firmado haría que voltear
  // una pieza la metiera en presupuesto.
  const volumen = evaluateBudgets([{ name: "volumen", units: "ABSOLUTE", unit: "m3", max: 4 }], {
    measurements: dos,
  });
  assert.equal(volumen[0].observed, 5, "|−2| más |3| son cinco, no uno");
  assert.equal(volumen[0].verdict, "FAIL");

  console.log(
    "presupuestos: ok (dos mallas suman: diez triángulos y ocho aristas de borde; y el volumen va en " +
      "valor absoluto, así que voltear una pieza no la mete en presupuesto)",
  );
}

// 9. Todo nombre del vocabulario se puede medir.
//
// Sin esto, añadir una fila a la tabla y olvidarse de cablearla daría un
// `NO_EVALUADO` permanente que nadie notaría: el informe diría que el término se
// conoce y el veredicto no se movería nunca.
{
  const medida = {
    vertices: 1, triangles: 1, degenerateTriangles: 0,
    boundaryEdges: 0, nonManifoldEdges: 0, signedVolume: 1,
  };
  const inputs = {
    measurements: [medida],
    coverage: { unobservedAreaRatio: 0.1, weakAreaRatio: 0.2 },
    confidence: { byClass: { PARALAJE_CORTO: 0.3 } },
  };
  assert.ok(BUDGET_NAMES.length >= 9, `el vocabulario tiene ${BUDGET_NAMES.length} términos`);
  for (const name of BUDGET_NAMES) {
    const [fila] = evaluateBudgets([{ name, units: "ABSOLUTE", unit: "x", max: 1e9 }], inputs);
    assert.equal(fila.verdict, "PASS", `${name} no se sabe medir: sale ${fila.reason}`);
    assert.equal(typeof fila.observed, "number");
    assert.equal(fila.measures, BUDGET_TERMS[name].measures, `${name}: el informe copia lo que mide`);
  }

  console.log(
    `presupuestos: ok (los ${BUDGET_NAMES.length} términos del vocabulario se miden de verdad, y cada ` +
      "uno publica qué mide: una fila nueva sin cablear pondría esto rojo)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "presupuestos: no ejecutada — el vocabulario deja fuera lo que el informe no publica —componentes " +
    "conexos, distancia de superficie—, porque presupuestar contra una medida que no sale en el " +
    "informe dejaría al productor sin poder comprobar por qué suspendió. Y `RELATIVE_TO_DIAGONAL` no " +
    "tiene todavía ningún término: el único que llevaría escala es el volumen, y una fracción de " +
    "diagonal al cubo no es algo que nadie haya pedido",
);
