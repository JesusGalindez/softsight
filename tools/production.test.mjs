/**
 * Puerta de R11 — un asset de producción se puede inspeccionar.
 *
 * ## El fixture tiene respuesta conocida antes de medirla
 *
 * `esfera-v1` es un cubo esferificado: **todos sus vértices caen exactamente a
 * distancia uno del centro**, así que la desviación de un nivel de detalle es la
 * flecha de su cuerda y se puede calcular a mano. Un fixture cuyo resultado solo
 * se pueda apuntar después no probaría nada.
 *
 * ## Los dos bloques que justifican el escalón
 *
 * El 3 y el 4, y la asimetría entre ellos está a propósito:
 *
 * ```text
 * colisión   tope por defecto CERO, y ese defecto se defiende: un proxy que no
 *            contiene la pieza deja que la atraviesen por ahí
 * LOD        sin tope no se juzga, porque lo que un nivel puede perder depende
 *            de a qué distancia se mira, y eso no lo sabe quien mide
 * ```
 *
 * Elegir un defecto para el LOD habría sido inventarse el criterio de otro; no
 * elegirlo para la colisión habría dejado pasar un proxy que se come la pieza.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectAsset, renderProduction } from "./production.mjs";
import { writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-produccion-"));
let contador = 0;
const escribir = (cambios = {}) => {
  const destino = join(sandbox, `asset-${(contador += 1)}`);
  writeProductionAsset(destino, cambios);
  return join(destino, "manifest.json");
};

// 1. La puerta del escalón, literal: **se puede inspeccionar**.
{
  const { report, exitCode } = inspectAsset(escribir());
  assert.equal(report.execution, "COMPLETE");
  assert.equal(report.certification, "PASS", report.certificationReason);
  assert.equal(exitCode, 0);
  assert.equal(report.documentType, "softsight.production-report");
  assert.equal(report.target.preset, "escritorio-medio");

  // Los cuatro papeles, cada uno con lo suyo. El papel **no es el tipo**: las
  // cuatro son mallas de triángulos, y lo que cambia es qué se les mide.
  assert.deepEqual(
    report.measurements.map((medida) => medida.role),
    ["MASTER", "LOD", "LOD", "COLLISION"],
  );
  assert.equal(report.measurements[0].triangles, 1728);
  assert.ok(report.measurements.every((medida) => medida.watertight), "el fixture va todo cerrado");
  assert.equal(report.lods.length, 2);
  assert.equal(report.lods[0].level, 1);

  console.log(
    `producción: ok (esfera-v1 entra y sale PASA con salida 0: ${report.measurements.length} mallas, ` +
      `${report.lods.length} niveles y un proxy, contra el destino ${report.target.preset})`,
  );
}

// 2. La desviación de un LOD, contra la respuesta que la esfera ya sabía.
{
  const { report } = inspectAsset(escribir());
  const [uno, dos] = report.lods;

  // Más basto, más se desvía. Es lo primero que rompería un diff que mide otra
  // cosa, y no hace falta saber cuánto exactamente para exigirlo.
  assert.ok(
    dos.worstRelative > uno.worstRelative * 2,
    `lod-1 desvía ${uno.worstRelative} y lod-2 ${dos.worstRelative}`,
  );
  assert.ok(dos.triangleRatio < uno.triangleRatio);

  // La flecha de la cuerda de una esfera de radio 1 con `n` divisiones por arista
  // de cubo ronda 1 − cos(θ/2) con θ el ángulo que abarca cada celda. Para n = 3
  // sale del orden de centésimas, y el máximo medido tiene que caer ahí.
  assert.ok(
    dos.deviation.aToB.maximum > 0.02 && dos.deviation.aToB.maximum < 0.2,
    `la flecha medida es ${dos.deviation.aToB.maximum} y la esfera manda que esté en centésimas`,
  );

  // **Las dos direcciones, sin promediar.** Se publican separadas porque una
  // simplificación que infla no se arregla como una que come.
  assert.ok(dos.deviation.aToB.maximum > 0 && dos.deviation.bToA.maximum > 0);
  assert.ok(["FALTA_EN_EL_LOD", "SOBRA_EN_EL_LOD"].includes(dos.worstDirection));

  console.log(
    `producción: ok (lod-1 desvía ${(uno.worstRelative * 100).toFixed(2)} % y lod-2 ` +
      `${(dos.worstRelative * 100).toFixed(2)} % de la diagonal, con las dos direcciones separadas: ` +
      "la flecha de la cuerda cae donde la esfera manda)",
  );
}

// 3. **La colisión tiene defecto, y es contener.**
{
  const sano = inspectAsset(escribir()).report;
  assert.equal(sano.collision.ran, true);
  assert.equal(sano.collision.protrudingRatio, 0, "una caja de 1,02 contiene una esfera de radio 1");
  assert.equal(sano.collision.tolerance, 0, "sin declarar nada, el tope es cero");
  assert.equal(sano.collision.verdict, "PASS");
  // Y el proxy es **más barato** que la maestra, que es para lo que existe.
  assert.ok(sano.collision.triangleRatio < 0.05);

  // Encogido por debajo del radio: la esfera asoma, y eso **suspende**.
  const encogido = inspectAsset(escribir({ collisionHalf: 0.8 }));
  assert.ok(encogido.report.collision.protrudingRatio > 0.5, "media esfera se sale de una caja de 0,8");
  assert.equal(encogido.report.collision.verdict, "FAIL");
  assert.equal(encogido.report.certification, "FAIL");
  assert.equal(encogido.report.certificationReason, "LA_MAESTRA_ASOMA_DE_LA_COLISION");
  assert.equal(encogido.exitCode, 1);

  // Con tolerancia declarada, el mismo asset pasa: asomar puede ser a propósito
  // —una alambrada, un adorno fino—, y entonces se dice.
  const conTolerancia = inspectAsset(
    escribir({
      collisionHalf: 0.8,
      target: { preset: "con-tolerancia", budgets: [], collisionTolerance: 0.9 },
    }),
  );
  assert.equal(conTolerancia.report.collision.verdict, "PASS");
  assert.equal(conTolerancia.report.certification, "PASS");

  console.log(
    `producción: ok (la caja de 1,02 contiene la esfera y pasa; encogida a 0,8 asoma el ` +
      `${(encogido.report.collision.protrudingRatio * 100).toFixed(1)} % y **suspende con salida 1**, ` +
      "salvo que el destino declare que asomar es a propósito)",
  );
}

// 4. El LOD **no** tiene defecto, y la asimetría es la decisión.
{
  const sinTope = inspectAsset(escribir()).report;
  for (const lod of sinTope.lods) {
    // **Los cuatro criterios**, no solo la superficie: ninguno tiene defecto,
    // porque lo que un LOD puede perder depende de a qué distancia se mira.
    assert.deepEqual(lod.verdicts, {
      surface: "NO_JUZGADO",
      silhouette: "NO_JUZGADO",
      normal: "NO_JUZGADO",
      bounds: "NO_JUZGADO",
    });
    assert.ok(lod.worstRelative > 0, "y el número sale igual: no juzgar no es no medir");
  }
  assert.equal(sinTope.certification, "PASS");

  const conTope = inspectAsset(
    escribir({
      target: { preset: "exigente", budgets: [], lodDeviationMax: 0.01 },
    }),
  );
  const juzgados = conTope.report.lods;
  assert.equal(juzgados[0].verdicts.surface, "PASS", "lod-1 desvía menos del 1 %");
  assert.equal(juzgados[1].verdicts.surface, "FAIL", "lod-2 desvía más");
  // El motivo **nombra el criterio**: «fuera de tolerancia» a secas obligaría a
  // buscar cuál de los cuatro falló.
  assert.equal(conTope.report.certificationReason, "LOD_FUERA_DE_TOLERANCIA_SURFACE");
  assert.equal(conTope.exitCode, 1);

  console.log(
    "producción: ok (sin tope declarado la desviación del LOD se publica y no decide; con " +
      "`lodDeviationMax` al 1 %, lod-1 pasa y lod-2 suspende)",
  );
}

// 5. Una cadena de niveles que no baja no es una cadena de niveles.
{
  const { report, exitCode } = inspectAsset(escribir({ lod2Divisions: 8 }));
  assert.equal(report.certification, "FAIL");
  assert.equal(report.certificationReason, "LOD_NO_SIMPLIFICA");
  assert.equal(exitCode, 1);
  assert.match(report.issues[0].message, /768 triángulos, y el anterior tenía 432/);

  console.log(
    "producción: ok (un lod-2 con más triángulos que el lod-1 suspende por LOD_NO_SIMPLIFICA: el " +
      "motor lo cargaría creyendo que ahorra)",
  );
}

// 6. Sin proxy cerrado, «dentro» no está definido — y eso **no es aprobar**.
{
  // Sin el presupuesto de aristas de borde: abrir el proxy también lo incumple, y
  // ese FAIL —que es correcto y gana al inconcluso— taparía lo que este bloque
  // quiere ver.
  const ruta = escribir({
    target: {
      preset: "sin-borde-presupuestado",
      budgets: [{ name: "triangulos", role: "MASTER", units: "ABSOLUTE", unit: "unidades", max: 5000 }],
    },
  });
  const raiz = ruta.slice(0, ruta.lastIndexOf("/"));
  const documento = JSON.parse(readFileSync(ruta, "utf8"));
  // Se le quita una cara al proxy, que es la forma barata de abrirlo.
  const proxy = documento.artifacts.find((artifact) => artifact.role === "COLLISION");
  const ply = readFileSync(join(raiz, proxy.path), "utf8").split("\n");
  const cabecera = ply.findIndex((linea) => linea.trim() === "end_header");
  const caras = ply.slice(cabecera + 1).filter((linea) => linea.startsWith("3 "));
  const sinUna = [
    ...ply.slice(0, cabecera + 1).map((linea) =>
      linea.startsWith("element face") ? `element face ${caras.length - 1}` : linea,
    ),
    ...ply.slice(cabecera + 1).filter((linea) => linea !== caras[0]),
  ].join("\n");
  writeFileSync(join(raiz, proxy.path), sinUna);
  const { createHash } = await import("node:crypto");
  proxy.bytes = Buffer.byteLength(sinUna);
  proxy.sha256 = createHash("sha256").update(sinUna).digest("hex");
  writeFileSync(ruta, `${JSON.stringify(documento, null, 2)}\n`);

  const { report, exitCode } = inspectAsset(ruta);
  assert.equal(report.collision.ran, false);
  assert.equal(report.collision.reason, "PROXY_NO_CERRADO");
  assert.equal(report.collision.protrudingRatio, undefined, "un número aquí parecería una respuesta");
  // **INCONCLUSIVE y no PASS**: declarar una colisión que no se puede comprobar
  // no es entregar una colisión buena.
  assert.equal(report.certification, "INCONCLUSIVE");
  assert.equal(exitCode, 11);

  console.log(
    "producción: ok (con el proxy abierto, la contención se declara no ejecutada y el asset sale " +
      "INCONCLUSIVE con salida 11: no saber no es aprobar)",
  );
}

// 7. Lo que el esquema no puede decir, lo dice el lector.
{
  const ruta = escribir();
  const documento = JSON.parse(readFileSync(ruta, "utf8"));
  // «Obligatorio solo con este `role`» no se puede expresar en el esquema, así
  // que el lector lo comprueba y lo dice por su nombre.
  delete documento.artifacts.find((artifact) => artifact.role === "LOD").level;
  writeFileSync(ruta, `${JSON.stringify(documento, null, 2)}\n`);
  const sinNivel = inspectAsset(ruta);
  assert.equal(sinNivel.report, null);
  assert.equal(sinNivel.exitCode, 20);
  assert.match(sinNivel.fatal, /un LOD tiene que declarar su nivel/);

  // Y dos maestras no son una maestra.
  const dosRuta = escribir();
  const dos = JSON.parse(readFileSync(dosRuta, "utf8"));
  dos.artifacts.find((artifact) => artifact.role === "LOD").role = "MASTER";
  delete dos.artifacts.find((artifact) => artifact.role === "MASTER" && artifact.level !== undefined).level;
  writeFileSync(dosRuta, `${JSON.stringify(dos, null, 2)}\n`);
  const dosMaestras = inspectAsset(dosRuta);
  assert.equal(dosMaestras.report.certification, "FAIL");
  assert.equal(dosMaestras.report.certificationReason, "MAESTRA_NO_UNICA");

  console.log(
    "producción: ok (un LOD sin nivel se rechaza con salida 20 y dos MASTER suspenden: son reglas que " +
      "el esquema no puede expresar y el lector sí)",
  );
}

// 8. Determinismo, y el texto derivado del mismo objeto.
{
  const ruta = escribir();
  const uno = inspectAsset(ruta).report;
  const dos = inspectAsset(ruta).report;
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos inspecciones dan informes distintos");

  const texto = renderProduction(uno);
  assert.match(texto, /esfera-v1 — PASA · destino escritorio-medio/);
  assert.match(texto, /colisión {4}0\.00 % de la maestra asoma/);
  const tocado = JSON.parse(JSON.stringify(uno));
  tocado.certification = "FAIL";
  assert.ok(!renderProduction(tocado).includes("PASA"), "el texto sale del objeto");

  console.log("producción: ok (dos inspecciones dan el mismo informe, y el texto deriva de él)");
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "producción: no ejecutada — el manifest describe **mallas y nada más**: sin materiales, sin UV, sin " +
    "texturas. R12 y R13 son las que miden eso, y meterlas aquí habría hecho un documento que " +
    "describe mal las dos cosas",
);
