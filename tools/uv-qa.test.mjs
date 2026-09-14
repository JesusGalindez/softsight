/**
 * Puerta de R13 — la auditoría de coordenadas de textura.
 *
 * ## El bloque 1 es el que decide si el resto significa algo
 *
 * **Ausente no es cero.** Los lectores rellenan `uvs` con ceros cuando el
 * atributo no viene, así que «esta malla no tiene UV» y «todas sus UV están en el
 * mismo punto» llegan como el mismo array. Son dos cosas muy distintas — la
 * primera es un asset que no se puede texturizar y la segunda una malla rota— y
 * el dato viaja aparte, leído de donde todavía se distingue.
 *
 * Sin eso, un PLY —que no puede expresar UV— habría salido con densidad de téxel
 * cero y solape cero, o sea **impecable**.
 *
 * ## Y el bloque 3 es una medida que hubo que tirar y rehacer
 *
 * El solape se midió primero contando celdas tocadas por dos o más triángulos.
 * Daba **1,0000 sobre cualquier malla**: dos triángulos vecinos comparten las
 * celdas de su arista común, así que en una malla densa todas las celdas salen
 * repetidas. La adyacencia no es solape. Se mide por área —la suma de las áreas UV
 * contra la unión—, y ahí dos vecinos aportan cero.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UV_GRID, auditUvs } from "../dist-node/agent3d.mjs";
import { inspectAsset } from "./production.mjs";
import { writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-uv-"));
let contador = 0;
const escribir = (cambios = {}) => {
  const destino = join(sandbox, `asset-${(contador += 1)}`);
  writeProductionAsset(destino, cambios);
  return join(destino, "manifest.json");
};

/** Un quad con las UV que se le pasen. La respuesta se sabe a mano. */
const quad = (uvs, indices = [0, 1, 2, 0, 2, 3]) => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  indices: new Uint32Array(indices),
  uvs: new Float32Array(uvs),
  normals: new Float32Array(12),
  boundingRadius: 1,
});

// 1. **Ausente no es cero**, y es lo que hace que el resto se pueda creer.
{
  const limpio = quad([0, 0, 1, 0, 1, 1, 0, 1]);
  const ausente = auditUvs(limpio, false);
  assert.equal(ausente.present, false);
  assert.equal(ausente.reason, "SIN_COORDENADAS_DE_TEXTURA");
  // **Nada de números.** Publicar un cero invitaría a compararlo con el de una
  // malla que sí las tiene, y a que un asset sin UV saliera impecable.
  assert.equal(ausente.overlapRatio, undefined);
  assert.equal(ausente.texelDensity, undefined);
  assert.equal(ausente.utilization, undefined);

  // Y una malla cuyas UV están todas en el mismo punto **sí se mide**, y sale mal.
  const degenerado = auditUvs(quad([0, 0, 0, 0, 0, 0, 0, 0]), true);
  assert.equal(degenerado.present, true);
  assert.equal(degenerado.degenerateTriangles, 2, "los dos triángulos tienen área UV nula");
  assert.equal(degenerado.utilization, 0);

  console.log(
    "uv: ok (sin coordenadas no hay números —un cero habría hecho impecable a un asset sin UV— y " +
      "todas en el mismo punto sí se mide: los dos triángulos salen degenerados)",
  );
}

// 2. Lo que la esfera ya sabía: rango, caja y degenerados.
{
  const dentro = auditUvs(quad([0, 0, 1, 0, 1, 1, 0, 1]), true);
  assert.equal(dentro.outsideUnitSquare, 0);
  assert.deepEqual(dentro.bounds, { min: [0, 0], max: [1, 1] });
  assert.equal(dentro.degenerateTriangles, 0);
  assert.equal(dentro.utilization, 1, "un quad que llena el cuadrado lo ocupa entero");
  assert.equal(dentro.texelDensity.spread, 1, "densidad uniforme da dispersión uno");

  const fuera = auditUvs(quad([0, 0, 1.7, 0, 1.7, 1, 0, 1]), true);
  assert.equal(fuera.outsideUnitSquare, 2, "dos vértices se salen");
  assert.ok(fuera.bounds.max[0] > 1.69);

  console.log(
    "uv: ok (el quad limpio ocupa el cuadrado entero con dispersión 1, y estirado a 1,7 delata sus " +
      "dos vértices fuera con la caja al lado)",
  );
}

// 3. **El solape se mide por área, no contando celdas.**
{
  const limpio = auditUvs(quad([0, 0, 1, 0, 1, 1, 0, 1]), true);
  // Dos triángulos que comparten una arista **no se pisan**. Contando celdas,
  // este caso daba 1,0000.
  assert.equal(limpio.overlapRatio, 0, "la adyacencia no es solape");

  // Los dos triángulos sobre las mismas UV: solape de verdad, cerca del 100 %.
  const pisado = auditUvs(quad([0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 1, 2]), true);
  assert.ok(pisado.overlapRatio > 0.9, `dos caras sobre la misma UV dan ${pisado.overlapRatio}`);
  assert.ok(pisado.utilization < 0.6, "y solo ocupan media isla");
  assert.equal(pisado.gridResolution, UV_GRID, "la rejilla va publicada: el número depende de ella");

  console.log(
    `uv: ok (dos triángulos vecinos dan solape 0 y dos sobre la misma UV dan ` +
      `${(pisado.overlapRatio * 100).toFixed(0)} %: se mide por área, y por eso la adyacencia no cuenta)`,
  );
}

// 4. La dispersión, que es el dato y no la mediana.
{
  // Mismo mundo, UV con una mitad al doble de escala: la mediana no lo ve.
  const estirado = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2]),
    // Los dos quads miden lo mismo en el mundo y el primero ocupa **un décimo**
    // del atlas: sus téxeles son tres veces más grandes.
    uvs: new Float32Array([0, 0, 0.1, 0, 0.1, 1, 0, 1, 1, 0, 1, 1]),
    normals: new Float32Array(18),
    boundingRadius: 1,
  };
  const auditoria = auditUvs(estirado, true);
  assert.ok(
    auditoria.texelDensity.spread > 2,
    `dos mitades a escalas distintas tienen que dar dispersión alta y dan ${auditoria.texelDensity.spread}`,
  );
  assert.ok(auditoria.texelDensity.median > 0);

  console.log(
    `uv: ok (dos mitades de la misma pieza a escalas distintas dan dispersión ` +
      `${auditoria.texelDensity.spread.toFixed(2)}: con la mediana sola se habrían visto iguales)`,
  );
}

// 5. **El formato decide qué preguntas admite el artifact.**
{
  // En PLY, que no puede expresar UV.
  const enPly = inspectAsset(escribir()).report;
  for (const medida of enPly.measurements) {
    assert.equal(medida.uv.present, false);
    assert.equal(medida.uv.reason, "SIN_COORDENADAS_DE_TEXTURA");
  }

  // El mismo asset en GLB: las mismas mallas, y ahora sí hay UV que auditar.
  const enGlb = inspectAsset(escribir({ glb: ["maestra", "lod-1", "lod-2"] })).report;
  const maestra = enGlb.measurements.find((medida) => medida.role === "MASTER");
  assert.equal(maestra.uv.present, true);
  assert.equal(maestra.triangles, 1728, "la malla es la misma que en PLY");
  // El proxy sigue en PLY y sigue sin UV — y no le hace falta: no se pinta.
  const proxy = enGlb.measurements.find((medida) => medida.role === "COLLISION");
  assert.equal(proxy.uv.present, false);

  console.log(
    "uv: ok (el mismo asset en PLY no admite la pregunta y en GLB sí, con las mismas 1.728 caras: el " +
      "formato decide qué se le puede preguntar al artifact)",
  );
}

// 6. Los topes, y el que tiene disparador defendible.
{
  // `uvRequired` es el único que dispara sobre una ausencia, y aun así lo declara
  // el destino. El proxy queda fuera: no se pinta.
  const exigente = inspectAsset(
    escribir({ target: { preset: "exige-uv", budgets: [], uvRequired: true } }),
  );
  assert.equal(exigente.report.certification, "FAIL");
  assert.equal(exigente.report.certificationReason, "UV_FUERA_DE_TOLERANCIA_PRESENT");
  assert.equal(exigente.exitCode, 1);
  const proxy = exigente.report.measurements.find((medida) => medida.role === "COLLISION");
  assert.equal(proxy.uvVerdicts.present, "NO_JUZGADO", "a la colisión no se le exigen UV");

  // Con las mallas en GLB, el mismo destino pasa ese criterio.
  const conUv = inspectAsset(
    escribir({
      glb: ["maestra", "lod-1", "lod-2"],
      target: { preset: "exige-uv", budgets: [], uvRequired: true },
    }),
  );
  for (const medida of conUv.report.measurements) {
    assert.notEqual(medida.uvVerdicts.present, "FAIL");
  }

  // Y un tope sobre una medida que no existe **no aprueba**: el criterio se
  // entiende y el dato falta.
  const sinDato = inspectAsset(
    escribir({ target: { preset: "solape", budgets: [], uvOverlapMax: 0.5 } }),
  );
  assert.equal(sinDato.report.certificationReason, "UV_FUERA_DE_TOLERANCIA_OVERLAP");

  console.log(
    "uv: ok (`uvRequired` suspende un asset en PLY y no toca al proxy, que no se pinta; y un tope " +
      "sobre una medida ausente suspende en vez de aprobar por no tener dato)",
  );
}

// 7. La costura de una proyección esférica, medida en vez de contada.
{
  const enGlb = inspectAsset(escribir({ glb: ["maestra"] })).report;
  const maestra = enGlb.measurements.find((medida) => medida.role === "MASTER");
  // Los triángulos que cruzan la antimeridiana van de u≈1 a u≈0, así que en UV
  // son bandas que cruzan la textura entera. **Eso es solape de verdad**, no un
  // artefacto de la rejilla, y el número lo dice.
  assert.ok(
    maestra.uv.overlapRatio > 0.5,
    `la costura esférica tenía que salir y sale ${maestra.uv.overlapRatio}`,
  );
  assert.equal(maestra.uv.outsideUnitSquare, 0, "y aun así ninguna UV se sale del cuadrado");

  console.log(
    `uv: ok (la costura de la proyección esférica sale como ` +
      `${(maestra.uv.overlapRatio * 100).toFixed(0)} % de solape con cero UV fuera del cuadrado: un ` +
      "despliegue puede estar dentro de rango y aun así pisarse entero)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "uv: no ejecutada — de R13 falta lo que necesita **la textura como fichero**: auditoría de " +
    "tangentes, de imagen y de material. El manifest de producción todavía no las declara, y medir " +
    "densidad de téxel en téxeles de verdad —no por unidad de mundo— pide saber el tamaño de la imagen",
);
