/**
 * Puerta de R15 — `PRODUCTION_READY`.
 *
 * ## La contradicción aparente, y por qué no lo es
 *
 * Doce escalones negándose a resumir —la confianza no sale como un número entre
 * cero y uno, la comparación de candidatos no da una nota— y ahora un veredicto
 * de una palabra. La diferencia es todo: una **nota** pesa cosas incomparables y
 * los pesos los pone quien mide; una **conjunción** dice «todo lo que declaraste
 * como necesario, pasó», y los criterios los puso quien publica.
 *
 * ## Los dos bloques que sostienen el escalón
 *
 * El 2 y el 3, y los dos dicen lo mismo por caminos distintos: **la aprobación no
 * se gana con silencio**.
 *
 * ```text
 * bloque 2   el asset más vacío sería el más listo: sin LOD no hay desviación,
 *            sin proxy no hay contención, sin textura no hay tamaño que exceder
 * bloque 3   un destino que no exige nada dejaría todo en NO_JUZGADO, y un
 *            asset entero sin juzgar no puede estar listo
 * ```
 *
 * Sin ninguno de los dos, `PRODUCTION_READY` sería la respuesta por defecto a no
 * haber mirado.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assessReadiness } from "../dist-node/agent3d.mjs";
import { inspectAsset, readExternalValidation } from "./production.mjs";
import { writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-listo-"));
let contador = 0;
const escribir = (cambios = {}) => {
  const destino = join(sandbox, `asset-${(contador += 1)}`);
  writeProductionAsset(destino, cambios);
  return join(destino, "manifest.json");
};

const khronos = join(sandbox, "khronos.json");
writeFileSync(
  khronos,
  JSON.stringify({ validatorVersion: "2.0.0-dev.3.9", issues: { numErrors: 0, numWarnings: 2 } }),
);
const khronosRoto = join(sandbox, "khronos-roto.json");
writeFileSync(
  khronosRoto,
  JSON.stringify({ validatorVersion: "2.0.0-dev.3.9", issues: { numErrors: 3, numWarnings: 0 } }),
);

/** Un asset con todo lo que su contenido exige declarado. */
const completo = (extra = {}) => ({
  glb: ["maestra", "lod-1", "lod-2"],
  texturas: [{ id: "color", usage: "BASE_COLOR" }],
  materials: [
    {
      id: "piel",
      appliesTo: ["maestra", "lod-1", "lod-2"],
      textures: { baseColor: "color" },
      wrap: "REPEAT",
    },
  ],
  target: {
    preset: "escritorio-medio",
    budgets: [{ name: "triangulos", role: "MASTER", units: "ABSOLUTE", unit: "unidades", max: 5000 }],
    lodSilhouetteMax: 0.2,
    collisionSlackMax: 0.95,
    textureMaxSize: 1024,
    uvRequired: true,
    collisionConvexTolerance: 0.01,
    ...extra,
  },
});

// 1. Con todo declarado, todo medido y un validador que no encontró errores.
{
  const { report, exitCode } = inspectAsset(escribir(completo()), readExternalValidation(khronos));
  assert.equal(report.readiness.verdict, "PRODUCTION_READY");
  assert.equal(report.readiness.reason, undefined);
  assert.equal(report.readiness.byState.FAIL, 0);
  assert.equal(report.readiness.byState.NOT_RUN, 0);
  assert.equal(exitCode, 0);
  // El informe **también dice lo que pasó**, no solo lo que falla: ocho
  // comprobaciones, y las ocho con su identificador.
  assert.equal(report.readiness.byState.PASS, 8);
  assert.equal(report.externalValidation.provider, "khronos-gltf-validator");
  assert.equal(report.externalValidation.warnings, 2, "cero errores no es «sin avisos»");

  console.log(
    `listo: ok (con las cuatro exigencias declaradas, todo medido y el validador de Khronos sin ` +
      `errores: PRODUCTION_READY con las ${report.readiness.byState.PASS} comprobaciones pasadas)`,
  );
}

// 2. **El asset más vacío no es el más listo.**
{
  // Sin nada declarado y sin validador: todas las medidas pasan y **no está listo**.
  const mudo = inspectAsset(escribir()).report;
  assert.equal(mudo.certification, "PASS", "las medidas del asset pasan");
  assert.equal(mudo.readiness.verdict, "UNKNOWN", "y aun así no está listo");
  assert.ok(mudo.readiness.byState.NOT_RUN > 0);
  assert.match(mudo.readiness.reason, /EL_DESTINO_NO_LO_DECLARA|VALIDADOR/);

  // Un asset sin proxy: la contención no se le exige —no tiene qué contener— y
  // aun así no está listo, porque le faltan otras declaraciones.
  const sinProxy = inspectAsset(escribir({ omit: ["colision"] })).report;
  const contencion = sinProxy.readiness.checks.find((check) => check.id === "contencion");
  assert.equal(contencion.state, "NOT_DECLARED");
  assert.equal(contencion.reason, "EL_ASSET_NO_TRAE_PROXY");
  assert.notEqual(sinProxy.readiness.verdict, "PRODUCTION_READY");

  console.log(
    "listo: ok (un asset cuyas medidas pasan pero cuyo destino no exige nada sale UNKNOWN: la " +
      "aprobación no se gana con silencio)",
  );
}

// 3. **Qué declaraciones hacen falta lo decide el propio asset.**
{
  const conNiveles = inspectAsset(escribir(completo())).report;
  const silueta = conNiveles.readiness.checks.find((check) => check.id === "tope-de-silueta");
  assert.equal(silueta.state, "PASS", "trae niveles, así que se le exige su tolerancia y la declara");

  // Sin niveles, la misma exigencia **no aplica** — y eso no es un hueco. El
  // material se declara solo sobre la maestra: dejarlo apuntando a los niveles
  // que ya no están sería otra cosa la que falla, y no la que se quiere ver.
  const soloMaestra = () => ({
    ...completo(),
    omit: ["lod-1", "lod-2"],
    glb: ["maestra"],
    materials: [
      { id: "piel", appliesTo: ["maestra"], textures: { baseColor: "color" }, wrap: "REPEAT" },
    ],
  });
  const sinNiveles = inspectAsset(escribir(soloMaestra())).report;
  const suSilueta = sinNiveles.readiness.checks.find((check) => check.id === "tope-de-silueta");
  assert.equal(suSilueta.state, "NOT_DECLARED");
  assert.equal(suSilueta.reason, "NO_APLICA_A_ESTE_ASSET");
  // Y **NOT_DECLARED no bloquea**: lo que no se tiene no se exige.
  assert.equal(
    inspectAsset(escribir(soloMaestra()), readExternalValidation(khronos)).report.readiness.verdict,
    "PRODUCTION_READY",
  );

  // Pero quitarle la declaración a un asset que sí trae niveles, sí bloquea.
  const sinTope = completo();
  delete sinTope.target.lodSilhouetteMax;
  const cojo = inspectAsset(escribir(sinTope), readExternalValidation(khronos)).report;
  assert.equal(cojo.readiness.verdict, "UNKNOWN");
  assert.match(cojo.readiness.reason, /tope-de-silueta/);

  console.log(
    "listo: ok (a quien no trae niveles no se le exige su tolerancia —NOT_DECLARED no bloquea— y a " +
      "quien los trae y no la declara, sí)",
  );
}

// 4. El validador externo, que no ejecutamos.
{
  const sinValidador = inspectAsset(escribir(completo())).report;
  const check = sinValidador.readiness.checks.find((entrada) => entrada.id === "validador-externo");
  assert.equal(check.state, "NOT_RUN");
  assert.equal(check.reason, "NINGUN_VALIDADOR_EXTERNO_APORTADO");
  assert.equal(sinValidador.readiness.verdict, "UNKNOWN");
  assert.equal(sinValidador.externalValidation, undefined, "no se inventa un validador que no corrió");

  // Con errores, **suspende** — y un fallo manda sobre un hueco.
  const conErrores = inspectAsset(escribir(completo()), readExternalValidation(khronosRoto));
  assert.equal(conErrores.report.readiness.verdict, "NOT_PRODUCTION_READY");
  assert.match(conErrores.report.readiness.reason, /3 errores/);

  console.log(
    "listo: ok (sin validador externo el veredicto es UNKNOWN y no se inventa uno; con tres errores " +
      "suyos, NOT_PRODUCTION_READY)",
  );
}

// 5. Un fallo manda sobre un hueco.
//
// Si algo está mal, decir «no se sabe» sería más suave de lo que la evidencia
// sostiene.
{
  const base = {
    has: { lods: false, collision: false, textures: false, uvCapableMeshes: false },
    declared: {},
    results: { certification: "PASS", budgetsUnevaluated: [] },
  };
  const soloHueco = assessReadiness(base);
  assert.equal(soloHueco.verdict, "UNKNOWN", "falta el validador");

  const conFallo = assessReadiness({
    ...base,
    results: { certification: "FAIL", certificationReason: "MALLA_SIN_SUPERFICIE", budgetsUnevaluated: [] },
  });
  assert.equal(conFallo.verdict, "NOT_PRODUCTION_READY");
  assert.match(conFallo.reason, /MALLA_SIN_SUPERFICIE/);

  // Y todo en orden con validador: listo.
  const todo = assessReadiness({
    ...base,
    external: { provider: "khronos-gltf-validator", errors: 0, warnings: 0 },
  });
  assert.equal(todo.verdict, "PRODUCTION_READY");

  console.log(
    "listo: ok (un fallo manda sobre un hueco: con algo roto el veredicto no se suaviza a «no se sabe»)",
  );
}

// 6. Las dos formas del informe de Khronos, y el determinismo.
{
  const suelto = join(sandbox, "suelto.json");
  writeFileSync(suelto, JSON.stringify({ provider: "otro", errors: 0, warnings: 1 }));
  const leido = readExternalValidation(suelto);
  assert.equal(leido.provider, "otro");
  assert.equal(leido.errors, 0);
  assert.equal(leido.warnings, 1);
  // Su CLI y su librería no escriben lo mismo, y obligar al usuario a
  // transformarlo sería trasladarle nuestro problema.
  assert.equal(readExternalValidation(khronos).version, "2.0.0-dev.3.9");

  const ruta = escribir(completo());
  assert.equal(
    JSON.stringify(inspectAsset(ruta, readExternalValidation(khronos)).report.readiness),
    JSON.stringify(inspectAsset(ruta, readExternalValidation(khronos)).report.readiness),
  );

  console.log(
    "listo: ok (se aceptan las dos formas del informe del validador, y dos lecturas dan el mismo " +
      "veredicto)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "listo: no ejecutada — **no ejecutamos el validador de Khronos**, lo ingerimos. Es la autoridad " +
    "sobre si un GLB es un GLB y envolverlo aquí sería reimplementar lo que ya existe; lo que este " +
    "escalón aporta es la ranura y la regla de que sin ella no hay aprobación",
);
