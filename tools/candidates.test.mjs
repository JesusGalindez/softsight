/**
 * Puerta de R9 — varios candidatos, e informes que se pueden cruzar.
 *
 * ## Dónde está la trampa del escalón
 *
 * En «comparables», que no es lo mismo que «producidos con el mismo binario». Un
 * ratio de cobertura medido **con siluetas** y otro medido **sin ellas** contestan
 * preguntas distintas —uno recorta por el contorno de la pieza, el otro cuenta
 * como visto lo que proyecta sobre el cielo— y los dos son un número entre cero y
 * uno con el mismo nombre. Ponerlos en dos columnas invita a restarlos.
 *
 * El bloque 3 es ese caso, y sin él una implementación que ordenara todo lo que
 * tuviera el mismo nombre aprobaría la puerta entera.
 *
 * ## Y el bloque 2, que es el otro modo de mentir
 *
 * Dos coberturas de 0,727 y 0,731 medidas con ocho mil muestras **no son
 * distintas**: sus intervalos se solapan enteros. Ordenarlas sería ordenar ruido
 * de muestreo — lo mismo que el §86.3 (k) prohíbe contra un umbral, y vale igual
 * entre dos candidatos.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareCandidates } from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { comparePackages, renderComparison } from "./reconstruction.mjs";

/** Un informe de los de verdad, recortado a lo que el cruce mira. */
function informe(id, cambios = {}) {
  return {
    run: { inputPackageId: id, inputManifestSha256: `${id}-hash` },
    contractVersion: "0.1",
    execution: "COMPLETE",
    certification: "PASS",
    measurements: [
      { triangles: 100, degenerateTriangles: 0, boundaryEdges: 10, nonManifoldEdges: 0 },
    ],
    coverage: {
      observedAreaRatio: 0.7,
      interval: [0.69, 0.71],
      samples: 8000,
      maskedCameras: 0,
    },
    confidence: { byClass: { SOSTENIDA: 0.5 }, samples: 8000 },
    cameras: { declared: 4, withImage: 4 },
    ...cambios,
  };
}

// 1. Dominancia: gana quien es mejor en todo lo decidible, y **solo entonces**.
{
  const flojo = informe("flojo", {
    coverage: { observedAreaRatio: 0.5, interval: [0.49, 0.51], samples: 8000, maskedCameras: 0 },
    confidence: { byClass: { SOSTENIDA: 0.3 }, samples: 8000 },
    measurements: [{ triangles: 100, degenerateTriangles: 4, boundaryEdges: 40, nonManifoldEdges: 2 }],
  });
  const bueno = informe("bueno");

  const cruce = compareCandidates([flojo, bueno]);
  assert.equal(cruce.verdict, "bueno");
  assert.equal(cruce.reason, undefined, "cuando alguien domina no hay motivo que dar");
  assert.deepEqual(cruce.compared, ["flojo", "bueno"], "el orden es el de llegada");
  assert.deepEqual(cruce.excluded, []);

  const cobertura = cruce.criteria.find((criterio) => criterio.name === "cobertura-observada");
  assert.equal(cobertura.best, "bueno");
  assert.equal(cobertura.measurementClass, "APPROXIMATE");
  assert.equal(cobertura.direction, "MAYOR_MEJOR");
  const bordes = cruce.criteria.find((criterio) => criterio.name === "aristas-de-borde");
  assert.equal(bordes.direction, "MENOR_MEJOR", "menos borde es mejor, y la dirección va publicada");
  assert.equal(bordes.best, "bueno");

  console.log(
    `cruce: ok (dominancia: «bueno» gana los ${cruce.criteria.filter((c) => c.best !== null).length} ` +
      "criterios decidibles y se lleva el veredicto, con la dirección de cada uno publicada)",
  );
}

// 2. **El compromiso no se resuelve, se enseña.**
//
// Mejor cobertura y peor topología. Un número agregado daría un ganador, y los
// pesos que lo producirían —¿cuánto vale un punto de cobertura contra mil aristas
// de borde?— no los conoce quien mide.
{
  const amplio = informe("amplio", {
    measurements: [{ triangles: 100, degenerateTriangles: 0, boundaryEdges: 900, nonManifoldEdges: 0 }],
  });
  const limpio = informe("limpio", {
    coverage: { observedAreaRatio: 0.4, interval: [0.39, 0.41], samples: 8000, maskedCameras: 0 },
    confidence: { byClass: { SOSTENIDA: 0.2 }, samples: 8000 },
    measurements: [{ triangles: 100, degenerateTriangles: 0, boundaryEdges: 2, nonManifoldEdges: 0 }],
  });

  const cruce = compareCandidates([amplio, limpio]);
  assert.equal(cruce.verdict, null, "nadie domina y no se fabrica un ganador");
  assert.equal(cruce.reason, "NINGUNO_DOMINA");
  // Y los criterios **sí** están decididos, cada uno por su lado: lo que no hay
  // es una forma de sumarlos.
  assert.equal(cruce.criteria.find((c) => c.name === "cobertura-observada").best, "amplio");
  assert.equal(cruce.criteria.find((c) => c.name === "aristas-de-borde").best, "limpio");

  console.log(
    "cruce: ok (uno cubre más y el otro cierra mejor: sin ganador, con los dos criterios decididos y " +
      "enseñados — el compromiso es de quien elige)",
  );
}

// 3. Dos números que se llaman igual y **no contestan lo mismo**.
{
  const conSiluetas = informe("con-siluetas", {
    coverage: { observedAreaRatio: 0.62, interval: [0.61, 0.63], samples: 8000, maskedCameras: 4 },
  });
  const sinSiluetas = informe("sin-siluetas", {
    coverage: { observedAreaRatio: 0.78, interval: [0.77, 0.79], samples: 8000, maskedCameras: 0 },
  });

  const cruce = compareCandidates([conSiluetas, sinSiluetas]);
  const cobertura = cruce.criteria.find((criterio) => criterio.name === "cobertura-observada");
  assert.equal(cobertura.best, null, "0,78 contra 0,62 no es una diferencia si miden cosas distintas");
  assert.equal(cobertura.reason, "SILUETAS_DISTINTAS");
  // Los valores **se siguen enseñando**: callarlos dejaría al productor sin saber
  // cuánto midió cada uno. Lo que no se hace es ordenarlos.
  assert.equal(cobertura.values.length, 2);

  // Con las dos siluetas puestas, el mismo par se decide sin problema.
  const ambas = compareCandidates([
    conSiluetas,
    informe("otro-con-siluetas", {
      coverage: { observedAreaRatio: 0.78, interval: [0.77, 0.79], samples: 8000, maskedCameras: 4 },
    }),
  ]);
  assert.equal(
    ambas.criteria.find((criterio) => criterio.name === "cobertura-observada").best,
    "otro-con-siluetas",
  );

  console.log(
    "cruce: ok (cobertura con siluetas contra cobertura sin ellas: **sin decidir**, con los dos " +
      "valores a la vista; y con las dos puestas, el mismo par se ordena)",
  );
}

// 4. Ruido de muestreo no es diferencia.
{
  const a = informe("a", {
    coverage: { observedAreaRatio: 0.727, interval: [0.717, 0.737], samples: 8000, maskedCameras: 0 },
  });
  const b = informe("b", {
    coverage: { observedAreaRatio: 0.731, interval: [0.721, 0.741], samples: 8000, maskedCameras: 0 },
  });
  const rozando = compareCandidates([a, b]);
  const cobertura = rozando.criteria.find((criterio) => criterio.name === "cobertura-observada");
  assert.equal(cobertura.best, null, "0,731 contra 0,727 con esos intervalos no distingue nada");
  assert.equal(cobertura.reason, "INTERVALOS_SOLAPADOS");

  // Separados de verdad, sí decide. Sin este caso, una función que nunca
  // decidiera nada también pasaría el de arriba.
  const lejos = compareCandidates([
    a,
    informe("lejos", {
      coverage: { observedAreaRatio: 0.9, interval: [0.89, 0.91], samples: 8000, maskedCameras: 0 },
    }),
  ]);
  assert.equal(
    lejos.criteria.find((criterio) => criterio.name === "cobertura-observada").best,
    "lejos",
  );

  // Y los recuentos son **exactos**: ahí uno de diferencia sí es una diferencia.
  const porUno = compareCandidates([
    informe("uno", {
      measurements: [{ triangles: 100, degenerateTriangles: 0, boundaryEdges: 11, nonManifoldEdges: 0 }],
    }),
    informe("otro"),
  ]);
  const bordes = porUno.criteria.find((criterio) => criterio.name === "aristas-de-borde");
  assert.equal(bordes.measurementClass, "EXACT");
  assert.equal(bordes.best, "otro", "diez contra once son diez contra once");

  console.log(
    "cruce: ok (0,727 contra 0,731 con ocho mil muestras no se ordena; 0,727 contra 0,90 sí; y una " +
      "arista de borde de diferencia sí decide, porque el recuento es exacto)",
  );
}

// 5. Lo que no se puede cruzar sale **con su motivo**, no se tira.
{
  const roto = informe("roto", { execution: "ERROR", certification: "INCONCLUSIVE" });
  const nuevo = informe("nuevo", { contractVersion: "0.2" });
  const cruce = compareCandidates([informe("sano"), roto, nuevo, informe("sano-2")]);

  assert.deepEqual(cruce.compared, ["sano", "sano-2"]);
  assert.deepEqual(cruce.excluded, [
    // **No es un candidato peor**: no dice nada de su geometría, porque no se
    // midió ninguna. Ordenarlo por debajo afirmaría algo que nadie comprobó.
    { candidate: "roto", reason: "PAQUETE_NO_CONSUMIBLE" },
    // El mismo campo puede no medir lo mismo entre dos versiones, y comparar dos
    // números que se llaman igual es lo que ninguna prueba de aritmética caza.
    { candidate: "nuevo", reason: "CONTRATO_DISTINTO" },
  ]);

  // Con menos de dos que se puedan cruzar, no hay cruce y se dice.
  const solo = compareCandidates([informe("sano"), roto]);
  assert.equal(solo.verdict, null);
  assert.equal(solo.reason, "MENOS_DE_DOS_CANDIDATOS_COMPARABLES");
  assert.deepEqual(solo.criteria, [], "sin con quién comparar no se publican criterios vacíos");

  console.log(
    "cruce: ok (un paquete ilegible y otro de otra versión salen excluidos con su motivo, y con menos " +
      "de dos comparables el cruce lo dice en vez de coronar al único)",
  );
}

// 6. Dos candidatos del mismo productor no pueden llamarse igual.
{
  const cruce = compareCandidates([informe("superficie-v1"), informe("superficie-v1")]);
  assert.deepEqual(cruce.compared, ["superficie-v1#1", "superficie-v1#2"]);
  // Es el caso normal, no el raro: dos pasadas del mismo pipeline con otra
  // rejilla traen el mismo `packageId`, y dos filas con el mismo nombre harían
  // ilegible el veredicto.
  for (const criterio of cruce.criteria) {
    const nombres = criterio.values.map((valor) => valor.candidate);
    assert.equal(new Set(nombres).size, nombres.length, `${criterio.name} repite nombre`);
  }

  console.log("cruce: ok (dos candidatos con el mismo packageId se desambiguan con su posición)");
}

// 7. Empate y determinismo.
{
  const cruce = compareCandidates([informe("igual-a"), informe("igual-b")]);
  assert.equal(cruce.verdict, null);
  for (const criterio of cruce.criteria) {
    assert.equal(criterio.best, null, `${criterio.name} decide entre dos informes idénticos`);
    assert.equal(criterio.reason, "EMPATE");
  }
  assert.equal(cruce.reason, "NINGUN_CRITERIO_DECIDIBLE");

  const uno = compareCandidates([informe("a"), informe("b", { certification: "FAIL" })]);
  const dos = compareCandidates([informe("a"), informe("b", { certification: "FAIL" })]);
  assert.equal(JSON.stringify(uno), JSON.stringify(dos));
  assert.equal(uno.criteria.find((criterio) => criterio.name === "certificacion").best, "a");

  console.log(
    "cruce: ok (dos informes idénticos no tienen ganador y cada criterio dice EMPATE; y certificar " +
      "gana a suspender)",
  );
}

// 8. Y el camino entero, con paquetes de verdad.
//
// El cruce no puede tener su propia forma de medir: cada candidato se consume por
// el mismo camino que si llegara solo, y lo único que añade esto es la
// comparación. Si el CLI midiera aparte, dos informes dejarían de ser los que el
// productor recibiría por separado.
{
  const sandbox = mkdtempSync(join(tmpdir(), "softsight-cruce-"));
  const bueno = join(sandbox, "bueno");
  const malo = join(sandbox, "malo");
  writeCubePackage(bueno);
  writeCubePackage(malo);

  // El segundo se declara un presupuesto que incumple: misma geometría, peor
  // veredicto. Es el criterio que ordena sin mirar un solo triángulo.
  const documento = JSON.parse(readFileSync(join(malo, "manifest.json"), "utf8"));
  documento.packageId = "cube-suspendido";
  documento.budgets = [{ name: "triangulos", units: "ABSOLUTE", unit: "unidades", max: 5 }];
  writeFileSync(join(malo, "manifest.json"), `${JSON.stringify(documento, null, 2)}\n`);

  const { comparison, reports, exitCode } = comparePackages([
    join(bueno, "manifest.json"),
    join(malo, "manifest.json"),
  ]);
  assert.equal(reports.length, 2);
  assert.equal(reports[1].certification, "FAIL", "el presupuesto lo suspende");
  assert.equal(comparison.verdict, "cube-v1");
  assert.equal(exitCode, 0, "con ganador, salida 0");

  const certificacion = comparison.criteria.find((criterio) => criterio.name === "certificacion");
  assert.equal(certificacion.best, "cube-v1");
  // La geometría es la misma, así que los recuentos empatan: el veredicto sale
  // **solo** del criterio que sí distingue.
  assert.equal(comparison.criteria.find((criterio) => criterio.name === "aristas-de-borde").reason, "EMPATE");

  const texto = renderComparison(comparison);
  assert.match(texto, /gana cube-v1/);
  assert.match(texto, /certificacion ↑ {2}cube-v1/);
  assert.match(texto, /aristas-de-borde ↓ {2}sin decidir \(EMPATE\)/);

  // Sin ganador, salida 1: la pregunta «¿cuál me llevo?» no tiene respuesta desde
  // aquí, y un cero invitaría a leer el primero de la lista como el que gana.
  const empatados = comparePackages([join(bueno, "manifest.json"), join(bueno, "manifest.json")]);
  assert.equal(empatados.comparison.verdict, null);
  assert.equal(empatados.exitCode, 1);

  rmSync(sandbox, { recursive: true, force: true });

  console.log(
    "cruce: ok (dos paquetes de verdad por el CLI: misma geometría y un presupuesto incumplido, así " +
      "que gana el que certifica con salida 0; dos idénticos salen sin ganador con salida 1)",
  );
}

console.log(
  "cruce: no ejecutada — no compara **geometría**: dos candidatos pueden ser dos reconstrucciones de " +
    "piezas distintas y el cruce los ordenaría igual. Eso lo contesta el diff de R5, que existe y se " +
    "alcanza desde el CLI, y atarlo aquí pide decidir a partir de qué distancia dos candidatos dejan " +
    "de ser el mismo objeto — criterio, no código",
);
