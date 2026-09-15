#!/usr/bin/env node
/**
 * §61 y §64 — la matriz de rendimiento, y por qué no corre en cada push.
 *
 * El §61 dice algo que conviene no perder: **no fijar promesas absolutas
 * todavía**. Un «5M en menos de 30 s» escrito hoy es una promesa sobre una
 * máquina concreta —ésta tiene dos núcleos de 2015— que mañana alguien leerá como
 * un requisito del producto. Lo que sí se puede afirmar es más útil y más
 * modesto:
 *
 * ```text
 * qué cuesta cada etapa, con el entorno declarado al lado
 * cómo escala esa etapa cuando la malla se multiplica por diez
 * que el escalón de 5M se atraviesa
 * ```
 *
 * ## La comprobación que vale es la segunda
 *
 * Un número suelto no distingue «esta máquina es lenta» de «este código es
 * cuadrático», y son problemas distintos: el primero se arregla con otra máquina
 * y el segundo no se arregla nunca. Lo que lo distingue es **el coste por
 * triángulo entre dos escalones**: si de 100k a 1M el coste por triángulo se
 * mantiene, la etapa es lineal; si se multiplica por diez, es cuadrática y lo
 * dice sin ambigüedad.
 *
 * Por eso el veredicto de esta herramienta no es un tiempo sino una pendiente, y
 * por eso hace falta más de un escalón para tener veredicto: con uno solo, lo
 * único honrado es imprimir el número y callarse.
 *
 * ## Por qué no está en la suite
 *
 * El §64 lo dice y el reloj lo confirma: 1M, 5M y 10M son de noche. La suite
 * entera tarda 145 s; un escalón de 10M en `coverage` no cabe dentro de eso, y
 * meterlo haría que la gente deje de correr la suite, que es la forma de perder
 * las otras cincuenta puertas para ganar una.
 *
 * Uso:
 *   node tools/bench.mjs                100k, unos segundos
 *   node tools/bench.mjs --heavy        añade 1M y 5M
 *   node tools/bench.mjs --nightly      1M, 5M y 10M — lo del §64
 *   node tools/bench.mjs --json         la matriz en JSON, para archivarla
 */

import { environment, measureInChild } from "./auditBaseline.mjs";

const MEGA = 1024 * 1024;

/** Los cuatro escalones del §61. */
const STEPS = [
  { name: "100k", triangles: 100_000 },
  { name: "1M", triangles: 1_000_000 },
  { name: "5M", triangles: 5_000_000 },
  { name: "10M", triangles: 10_000_000 },
];

/**
 * Las cuatro etapas que §61 nombra.
 *
 * `parse` entró con el lector binario (ítem 10 del §72) y antes no se podía
 * medir: el único lector era el ASCII y el mismo contenido en texto son ~400 MB
 * en el escalón de 5M, que no caben en una cadena de Node. Se mide sobre binario
 * **a propósito** — es lo que trae un paquete real, y medir el ASCII a escala
 * habría medido el generador de texto.
 */
const MEASURES = [
  { key: "parse", label: "parseo" },
  { key: "audit", label: "auditoría" },
  { key: "boundsTree", label: "árbol" },
  { key: "coverage", label: "visibilidad" },
];

function selectedSteps(argv) {
  if (argv.includes("--nightly")) return STEPS.filter((step) => step.triangles >= 1_000_000);
  if (argv.includes("--heavy")) return STEPS.filter((step) => step.triangles <= 5_000_000);
  return STEPS.slice(0, 1);
}

/**
 * Pendiente entre dos escalones: cuánto crece el coste **por triángulo**.
 *
 * `1,0` es lineal. `10` entre 100k y 1M es cuadrático. Se devuelve `null` con un
 * solo escalón porque con un punto no hay pendiente, y devolver `1` ahí sería
 * afirmar linealidad sin haberla medido.
 */
function slope(results, key) {
  const puntos = results.filter((row) => row[key]?.ok).sort((a, b) => a.triangles - b.triangles);
  if (puntos.length < 2) return null;
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const porTriangulo = (row) => row[key].cpuMs / row.triangles;
  return porTriangulo(ultimo) / porTriangulo(primero);
}

const steps = selectedSteps(process.argv);
const results = [];

for (const step of steps) {
  const row = { step: step.name, triangles: step.triangles };
  for (const measure of MEASURES) {
    row[measure.key] = await measureInChild(step.triangles, measure.key);
  }
  results.push(row);
}

const report = {
  environment: environment(),
  // La fecha va en el documento porque una matriz sin fecha no se puede comparar
  // con la siguiente, y comparar es para lo único que sirve.
  measuredAt: new Date().toISOString().slice(0, 10),
  steps: results,
  slopes: Object.fromEntries(MEASURES.map((measure) => [measure.key, slope(results, measure.key)])),
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const env = report.environment;
  process.stdout.write(`banco: ${env.cpu}, ${env.cpuLogical} lógicos, node ${env.node}\n\n`);
  process.stdout.write("escalón   etapa         CPU        RSS pico   nota\n");
  for (const row of results) {
    for (const measure of MEASURES) {
      const medida = row[measure.key];
      if (!medida?.ok) {
        process.stdout.write(
          `${row.step.padEnd(9)} ${measure.label.padEnd(13)} no ejecutada — ${medida?.failed ?? "sin resultado"}\n`,
        );
        continue;
      }
      const nota =
        measure.key === "parse"
          ? `${(medida.fileBytes / MEGA).toFixed(1)} MiB de PLY binario`
          : measure.key === "coverage"
            ? `${(medida.observed * 100).toFixed(1)} % observado, ${(medida.cacheBytes / MEGA).toFixed(1)} MiB en caché`
            : measure.key === "boundsTree"
              ? `${medida.nodes} nodos, ${(medida.treeBytes / MEGA).toFixed(1)} MiB`
              : `${(medida.meshBytes / MEGA).toFixed(1)} MiB de malla`;
      process.stdout.write(
        `${row.step.padEnd(9)} ${measure.label.padEnd(13)} ${`${(medida.cpuMs / 1000).toFixed(2)} s`.padEnd(10)} ` +
          `${`${(medida.peakRss / MEGA).toFixed(0)} MiB`.padEnd(10)} ${nota}\n`,
      );
    }
  }

  process.stdout.write("\n");
  if (results.length < 2) {
    process.stdout.write(
      "pendiente  no se puede decir con un solo escalón: hacen falta dos para saber si el coste por\n" +
        "           triángulo se mantiene. `--heavy` añade 1M y 5M.\n",
    );
  } else {
    const desde = results[0].step;
    const hasta = results[results.length - 1].step;
    for (const measure of MEASURES) {
      const valor = report.slopes[measure.key];
      if (valor === null) continue;
      // Por debajo de 1 el coste por triángulo **baja**, y eso no es magia: en el
      // escalón pequeño pesa lo que no depende del tamaño —arrancar, reservar,
      // calentar el JIT—, y al multiplicar por cincuenta se reparte. Decirlo
      // «lineal» escondería que la medida pequeña está midiendo otra cosa.
      const lectura =
        valor < 0.5
          ? "sublineal: en el escalón pequeño domina el coste fijo"
          : valor < 1.5
            ? "lineal"
            : valor < 4
              ? "superlineal"
              : "sospechosa de cuadrática";
      process.stdout.write(
        `pendiente  ${measure.label.padEnd(13)} ×${valor.toFixed(2)} por triángulo de ${desde} a ${hasta} — ${lectura}\n`,
      );
    }
  }
}
