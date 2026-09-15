/**
 * Puerta de D28 — los dos ejes de una medida, y el campo que tenía tres formas.
 *
 * Lo que esta puerta arregla no era un desacuerdo de opinión: el **mismo campo**
 * aparecía de tres maneras distintas dentro del esquema publicado.
 *
 * ```text
 * measurements[].measurementClass   enum con DETERMINISTIC_APPROXIMATION
 * repairBoundary.measurementClass   enum con APPROXIMATE
 * coverage / confidence / captureAdvice   string libre, sin enum
 * ```
 *
 * Los tres últimos eran lo peor y son el bloque 2: su `description` decía
 * `APPROXIMATE` y el esquema **no lo exigía**, así que `measurementClass:
 * "cualquier cosa"` pasaba la validación. Una descripción no valida nada, y quien
 * derivara modelos del esquema obtenía tres tipos para un nombre.
 *
 * El bloque 3 es la parte de D28 que se puede comprobar aquí y que nadie miraba:
 * los dos ejes son **ortogonales**, y el contrato lo dice con todas las letras —
 * ninguna métrica lleva severidad, ningún aviso lleva clase de medida—.
 *
 * Lo que **no** se puede comprobar aquí está al final, con su motivo, y son dos
 * cosas distintas por dos razones distintas.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEASUREMENT_CLASSES,
  RECONSTRUCTION_REPORT_SCHEMA,
  REPRODUCIBILITY_MODES,
  validate,
} from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const sandbox = mkdtempSync(join(tmpdir(), "softsight-d28-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifestPath = join(raiz, "manifest.json");

/** Todos los `measurementClass` del esquema publicado, con su ruta. */
function clasesPublicadas() {
  const documento = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/reconstruction-report.schema.json"), "utf8"),
  );
  const encontrados = [];
  const recorrer = (nodo, ruta) => {
    if (Array.isArray(nodo)) {
      for (const hijo of nodo) recorrer(hijo, ruta);
      return;
    }
    if (typeof nodo !== "object" || nodo === null) return;
    for (const [clave, valor] of Object.entries(nodo)) {
      if (clave === "measurementClass" && typeof valor === "object" && valor !== null) {
        encontrados.push({ path: `${ruta}.measurementClass`, node: valor });
      }
      recorrer(valor, clave === "properties" || clave === "items" ? ruta : `${ruta}.${clave}`);
    }
  };
  recorrer(documento, "");
  return encontrados;
}

// 1. Un solo vocabulario en el documento publicado.
{
  const campos = clasesPublicadas();
  assert.ok(campos.length >= 5, `esperaba al menos cinco measurementClass y hay ${campos.length}`);

  for (const campo of campos) {
    assert.deepEqual(
      campo.node.enum,
      [...MEASUREMENT_CLASSES],
      `${campo.path} publica otro vocabulario que el resto del documento`,
    );
  }

  // Y el que ya no está: si alguien lo reintroduce, el «DETERMINISTIC_» vuelve a
  // meter el segundo eje dentro del primero, que es lo que D28 existe para
  // deshacer.
  const crudo = readFileSync(resolve(projectRoot, "contracts/reconstruction-report.schema.json"), "utf8");
  assert.ok(
    !crudo.includes("DETERMINISTIC_APPROXIMATION"),
    "`DETERMINISTIC_APPROXIMATION` dice en un eje lo que el otro ya dice",
  );

  console.log(
    `d28: ok (los ${campos.length} measurementClass del informe publican el mismo vocabulario ` +
      `—${MEASUREMENT_CLASSES.join(", ")}— y ninguno vuelve a DETERMINISTIC_APPROXIMATION)`,
  );
}

// 2. **Un valor de más se rechaza en los cinco.**
//
// Es el bloque que demuestra que el arreglo sirve. Antes, tres de los cinco eran
// `string` libre: la descripción decía `APPROXIMATE` y cualquier cosa pasaba.
{
  const { report } = inspectPackage(manifestPath);
  assert.deepEqual(validate(report, RECONSTRUCTION_REPORT_SCHEMA), [], "el informe de verdad tiene que valer");

  const rutas = ["coverage", "confidence", "captureAdvice", "repairBoundary"];
  let cazados = 0;
  for (const ruta of rutas) {
    if (report[ruta] === undefined) continue;
    const tocado = JSON.parse(JSON.stringify(report));
    tocado[ruta].measurementClass = "MAS_O_MENOS";
    const errores = validate(tocado, RECONSTRUCTION_REPORT_SCHEMA);
    assert.ok(
      errores.some((error) => error.includes(`${ruta}.measurementClass`)),
      `${ruta}.measurementClass acepta un valor inventado: ${JSON.stringify(errores)}`,
    );
    cazados += 1;
  }

  const enMedida = JSON.parse(JSON.stringify(report));
  enMedida.measurements[0].measurementClass = "MAS_O_MENOS";
  assert.ok(validate(enMedida, RECONSTRUCTION_REPORT_SCHEMA).length > 0);
  cazados += 1;

  // Lo mismo con el segundo eje: publicarlo sin enum dejaría afirmar
  // reproducibilidad con una palabra inventada, que es la afirmación más cara
  // del documento.
  const enEje = JSON.parse(JSON.stringify(report));
  enEje.coverage.reproducibility = "MAS_O_MENOS";
  assert.ok(
    validate(enEje, RECONSTRUCTION_REPORT_SCHEMA).length > 0,
    "reproducibility también tiene que estar cerrado",
  );

  console.log(
    `d28: ok (${cazados} campos rechazan un valor inventado, y el eje de reproducibilidad también: ` +
      "antes tres de ellos eran `string` libre y su descripción no validaba nada)",
  );
}

// 3. Los dos ejes son ortogonales, y el documento lo demuestra.
{
  const { report } = inspectPackage(manifestPath);

  // Ninguna métrica lleva severidad.
  for (const bloque of ["coverage", "confidence", "captureAdvice", "repairBoundary"]) {
    if (report[bloque] === undefined) continue;
    assert.equal(report[bloque].severity, undefined, `${bloque} no puede llevar severidad`);
  }
  // Ningún aviso lleva clase de medida. Lo que un aviso sí lleva es **evidencia**
  // (§53), que es otra cosa: números con los que juzgarlo, no una etiqueta sobre
  // cómo se obtuvieron.
  for (const aviso of report.warnings) {
    assert.equal(aviso.measurementClass, undefined, `${aviso.code} no puede llevar clase de medida`);
    assert.equal(aviso.reproducibility, undefined);
  }

  // Y el caso que hace que la ortogonalidad no sea trivial: una medida exacta
  // puede sostener un aviso, porque la conclusión supone una intención que la
  // medida no contiene.
  assert.equal(report.measurements[0].measurementClass, "EXACT");
  assert.ok(report.warnings.length > 0, "el cubo deja media superficie sin ver y eso se avisa");

  console.log(
    `d28: ok (ninguno de los bloques de métrica lleva severidad y ninguno de los ${report.warnings.length} avisos ` +
      "lleva clase de medida: son ejes distintos y no se contaminan)",
  );
}

// 4. Lo declarado `BITWISE_EXACT` lo es.
//
// Declararlo y no serlo es la peor de las dos mentiras posibles aquí: quien lea
// el campo deja de comparar informes porque cree que puede fiarse de que son
// iguales.
{
  const uno = inspectPackage(manifestPath, { cache: false }).report;
  const dos = inspectPackage(manifestPath, { cache: false }).report;

  for (const bloque of ["coverage", "confidence", "captureAdvice"]) {
    if (uno[bloque] === undefined) continue;
    assert.equal(uno[bloque].reproducibility, "BITWISE_EXACT");
    assert.equal(
      JSON.stringify(uno[bloque]),
      JSON.stringify(dos[bloque]),
      `${bloque} se declara BITWISE_EXACT y dos ejecuciones no coinciden`,
    );
  }
  assert.ok(REPRODUCIBILITY_MODES.includes("TOLERANCE"), "el vocabulario tiene que poder decir lo contrario");

  console.log(
    "d28: ok (los tres bloques que se declaran BITWISE_EXACT dan documentos idénticos en dos " +
      "ejecuciones sin caché: la etiqueta se comprueba en vez de creerse)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "d28: no ejecutada — faltan las dos mitades de su prueba, y **por motivos distintos**. Los «recuentos " +
    "exactos en macOS y Linux» piden una segunda plataforma que esta máquina no tiene y ningún " +
    "contenedor suple: es Darwin x86_64 y no hay docker. Y la independencia del número de workers no " +
    "se puede probar porque **no hay reducción paralela que probar**: `computeVisibility` es de un solo " +
    "hilo, y el `parallel.ts` que sí reparte es el del rasterizador del navegador, que no mide nada de " +
    "esto. Por eso D28 se queda declarada a medias en vez de pasar a IMPLEMENTADA",
);
