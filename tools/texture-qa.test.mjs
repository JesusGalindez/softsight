/**
 * Puerta de R13 — la textura y el material, con la imagen ya como fichero.
 *
 * ## El bloque 1 es una medida que se cayó y hubo que rehacer
 *
 * Un mapa de color enchufado en el canal de normales **se lee sin error**: es un
 * PNG válido, del tamaño correcto, y el motor lo usa. Lo que sale es relieve
 * absurdo, y nada lo dice hasta que alguien mira.
 *
 * La primera medida fue azul medio y norma media. Un damero corriente las pasó
 * —0,51 y 0,98, las dos por los pelos— porque promediar un canal que salta entre
 * dos extremos da justo el centro, que es donde estaba el umbral. Lo que sí
 * distingue: **una normal en espacio tangente nunca apunta hacia dentro**, así que
 * su z es siempre positivo. El damero tiene el 50 % de los píxeles por debajo.
 *
 * ## Y el bloque 3 cierra un hueco que quedó escrito
 *
 * La auditoría de UV publicaba vértices fuera del cuadrado unidad y decía que no
 * podía juzgarlos: «depende del modo de repetición del material, que este
 * documento todavía no describe». Ahora lo describe, y con `wrap: CLAMP` una UV
 * en 1,7 es una contradicción del manifest consigo mismo — **cazada sin abrir una
 * sola imagen**.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NORMAL_MAX_BELOW_HORIZON,
  auditMaterials,
  auditTexture,
  auditUvs,
} from "../dist-node/agent3d.mjs";
import { inspectAsset } from "./production.mjs";
import { writeProductionAsset } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-textura-"));
let contador = 0;
const escribir = (cambios = {}) => {
  const destino = join(sandbox, `asset-${(contador += 1)}`);
  writeProductionAsset(destino, cambios);
  return join(destino, "manifest.json");
};
const conTextura = (extra = {}) => ({
  glb: ["maestra"],
  omit: ["lod-1", "lod-2"],
  texturas: [{ id: "color", usage: "BASE_COLOR" }],
  materials: [
    { id: "piel", appliesTo: ["maestra"], textures: { baseColor: "color" }, wrap: "REPEAT" },
  ],
  ...extra,
});

/** Una imagen plana del color que se pida. */
const imagen = (width, height, color) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    pixels[pixel * 4] = color[0];
    pixels[pixel * 4 + 1] = color[1];
    pixels[pixel * 4 + 2] = color[2];
    pixels[pixel * 4 + 3] = color[3];
  }
  return { width, height, pixels };
};

// 1. **Que la imagen encaje con su papel**, y la media no bastaba.
{
  // Un mapa de normales sin perturbar: (128, 128, 255).
  const plano = auditTexture("n", "NORMAL", imagen(64, 64, [128, 128, 255, 255]));
  assert.equal(plano.reason, undefined, "un mapa de normales de verdad pasa");
  assert.equal(plano.normalLike.belowHorizonRatio, 0);
  assert.ok(plano.normalLike.meanBlue > 0.99);

  // El damero que engañó a la media: azul 0,51 y norma 0,98, y la mitad de sus
  // píxeles con z hacia dentro de la superficie.
  const damero = { width: 64, height: 64, pixels: new Uint8ClampedArray(64 * 64 * 4) };
  for (let pixel = 0; pixel < 64 * 64; pixel += 1) {
    const claro = (Math.floor(pixel / 64 / 32) + Math.floor((pixel % 64) / 32)) % 2 === 0;
    damero.pixels[pixel * 4] = claro ? 220 : 40;
    damero.pixels[pixel * 4 + 1] = claro ? 200 : 60;
    damero.pixels[pixel * 4 + 2] = claro ? 180 : 80;
    damero.pixels[pixel * 4 + 3] = 255;
  }
  const falso = auditTexture("n", "NORMAL", damero);
  assert.equal(falso.reason, "CONTENIDO_NO_PARECE_UN_MAPA_DE_NORMALES");
  // Las dos medias que **no** lo cazaban, publicadas para que se vea por qué.
  assert.ok(falso.normalLike.meanBlue > 0.5, `la media de azul es ${falso.normalLike.meanBlue}`);
  assert.ok(falso.normalLike.meanLength > 0.8, `y la de norma ${falso.normalLike.meanLength}`);
  // Y la que sí.
  assert.ok(falso.normalLike.belowHorizonRatio > NORMAL_MAX_BELOW_HORIZON * 100);

  // Sobre un canal que no es de normales, la comprobación **no se hace**: un
  // mapa de color oscuro no tiene que parecer nada.
  const color = auditTexture("c", "BASE_COLOR", damero);
  assert.equal(color.normalLike, undefined);
  assert.equal(color.reason, undefined);

  console.log(
    `textura: ok (el damero pasa las dos medias —azul ${falso.normalLike.meanBlue.toFixed(2)}, norma ` +
      `${falso.normalLike.meanLength.toFixed(2)}— y cae por tener el ` +
      `${(falso.normalLike.belowHorizonRatio * 100).toFixed(0)} % de sus píxeles apuntando hacia dentro)`,
  );
}

// 2. Lo que se lee de la imagen sin interpretarla.
{
  const cuadrada = auditTexture("c", "BASE_COLOR", imagen(256, 256, [10, 20, 30, 255]));
  assert.equal(cuadrada.powerOfTwo, true);
  assert.equal(cuadrada.square, true);
  assert.equal(cuadrada.maxSide, 256);
  // Un cuarto del fichero que no dice nada: no es un error, es el ahorro más
  // barato que hay y nadie lo ve mirando la imagen.
  assert.equal(cuadrada.alphaConstant, true);

  const rara = auditTexture("c", "BASE_COLOR", imagen(300, 200, [0, 0, 0, 255]));
  assert.equal(rara.powerOfTwo, false);
  assert.equal(rara.square, false);
  assert.equal(rara.maxSide, 300, "el lado mayor es lo que un presupuesto limita");

  const conAlfa = imagen(8, 8, [0, 0, 0, 255]);
  conAlfa.pixels[3] = 0;
  assert.equal(auditTexture("c", "BASE_COLOR", conAlfa).alphaConstant, false);

  console.log(
    "textura: ok (potencia de dos, cuadrada, lado mayor y alfa constante se leen de la imagen sin " +
      "interpretarla, y un solo píxel transparente ya la hace no constante)",
  );
}

// 3. **El hueco que la auditoría de UV dejó escrito.**
{
  const fuera = inspectAsset(escribir(conTextura({ uvScale: 2, materials: [
    { id: "piel", appliesTo: ["maestra"], textures: { baseColor: "color" }, wrap: "CLAMP" },
  ] })));
  assert.equal(fuera.report.certification, "FAIL");
  assert.equal(fuera.report.certificationReason, "CLAMP_CON_UV_FUERA_DEL_CUADRADO");
  assert.equal(fuera.exitCode, 1);
  assert.match(fuera.report.materialIssues[0].message, /vértices fuera del cuadrado unidad/);

  // Las mismas UV con `REPEAT` **no son un defecto**: el mosaico es una técnica.
  const mosaico = inspectAsset(escribir(conTextura({ uvScale: 2 })));
  assert.equal(mosaico.report.materialIssues.length, 0);
  assert.ok(
    mosaico.report.measurements[0].uv.outsideUnitSquare > 0,
    "y el número se publica igual: lo que cambia es si se puede juzgar",
  );

  console.log(
    "textura: ok (las mismas UV fuera del cuadrado son contradicción con CLAMP y técnica con REPEAT: " +
      "el modo de repetición era el dato que faltaba para juzgarlas)",
  );
}

// 4. Lo que un material se contradice diciendo, sin abrir una imagen.
{
  const roles = new Map([
    ["maestra", "MASTER"],
    ["colision", "COLLISION"],
    ["color", "TEXTURE"],
  ]);
  const base = { roles, uvPresence: new Map([["maestra", true]]), outsideUnitSquare: new Map() };

  const casos = [
    [{ id: "a", appliesTo: ["fantasma"], wrap: "REPEAT" }, "MALLA_AUSENTE"],
    [{ id: "b", appliesTo: ["color"], wrap: "REPEAT" }, "MALLA_AUSENTE"],
    [{ id: "c", appliesTo: ["colision"], wrap: "REPEAT" }, "MATERIAL_SOBRE_COLISION"],
    [
      { id: "d", appliesTo: ["maestra"], textures: { baseColor: "maestra" }, wrap: "REPEAT" },
      "TEXTURA_AUSENTE",
    ],
  ];
  for (const [material, motivo] of casos) {
    const problemas = auditMaterials([material], base);
    assert.ok(
      problemas.some((problema) => problema.reason === motivo),
      `${material.id} tenía que dar ${motivo} y dio ${JSON.stringify(problemas.map((p) => p.reason))}`,
    );
  }

  // Una textura sobre una malla sin UV: no hay dónde pintarla.
  const sinUv = auditMaterials(
    [{ id: "e", appliesTo: ["maestra"], textures: { baseColor: "color" }, wrap: "REPEAT" }],
    { ...base, uvPresence: new Map([["maestra", false]]) },
  );
  assert.equal(sinUv[0].reason, "TEXTURA_SOBRE_MALLA_SIN_UV");

  // Y el material bien declarado no da ninguno.
  assert.deepEqual(
    auditMaterials(
      [{ id: "f", appliesTo: ["maestra"], textures: { baseColor: "color" }, wrap: "REPEAT" }],
      base,
    ),
    [],
  );

  console.log(
    "textura: ok (cinco contradicciones de material cazadas sin abrir una imagen —malla ausente, " +
      "textura como malla, material sobre el proxy, canal que no apunta a una textura, textura sin " +
      "UV— y el material bien declarado no da ninguna)",
  );
}

// 5. **La densidad en téxeles de verdad**, que es lo que el tamaño desbloquea.
{
  const conImagen = inspectAsset(escribir(conTextura())).report;
  const maestra = conImagen.measurements.find((medida) => medida.role === "MASTER");
  assert.ok(maestra.texelDensity !== undefined, "con un material que ata textura, la densidad es real");
  assert.equal(maestra.texelDensity.textureSide, 256);
  // Es la relativa multiplicada por el lado: el número sale en téxeles y ya se
  // puede comparar con un destino.
  assert.ok(
    Math.abs(maestra.texelDensity.median - maestra.uv.texelDensity.median * 256) < 1e-6,
    "la densidad real es la relativa por el lado de su textura",
  );

  // Sin material que ate una textura, **no hay densidad real**: la relativa solo
  // compara la pieza consigo misma.
  const sinMaterial = inspectAsset(escribir({ glb: ["maestra"], omit: ["lod-1", "lod-2"] })).report;
  const suelta = sinMaterial.measurements.find((medida) => medida.role === "MASTER");
  assert.equal(suelta.texelDensity, undefined);
  assert.ok(suelta.uv.texelDensity.median > 0, "y la relativa sigue estando");

  // Con un mínimo declarado, se juzga.
  const exigente = inspectAsset(
    escribir(conTextura({ target: { preset: "denso", budgets: [], texelDensityMin: 1e6 } })),
  );
  assert.equal(exigente.report.certificationReason, "UV_FUERA_DE_TOLERANCIA_DENSITY");

  console.log(
    `textura: ok (${maestra.texelDensity.median.toFixed(0)} téxeles por unidad de mundo con una ` +
      "textura de 256; sin material que la ate, la densidad real está ausente y no a cero)",
  );
}

// 6. Las islas espejadas, que es lo que se puede afirmar sin tangentes declaradas.
{
  const quad = (uvs) => ({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(12),
    boundingRadius: 1,
  });
  // Los dos triángulos con el mismo sentido: nada espejado.
  assert.equal(auditUvs(quad([0, 0, 1, 0, 1, 1, 0, 1]), true).mirroredRatio, 0);

  // El segundo triángulo con las UV volteadas en u: media pieza espejada.
  const espejado = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 4, 1, 5]),
    uvs: new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0, 1, 1, 0, 1, 1]),
    normals: new Float32Array(18),
    boundingRadius: 1,
  };
  const auditoria = auditUvs(espejado, true);
  assert.ok(
    auditoria.mirroredRatio > 0.4,
    `media pieza espejada tenía que salir y sale ${auditoria.mirroredRatio}`,
  );

  console.log(
    `textura: ok (media pieza con el bobinado UV al revés sale como ` +
      `${(auditoria.mirroredRatio * 100).toFixed(0)} % espejado: no es un defecto, pero obliga a que ` +
      "la tangente lleve signo)",
  );
}

// 7. El tamaño contra el destino, y el determinismo.
{
  const grande = inspectAsset(
    escribir(conTextura({ target: { preset: "movil", budgets: [], textureMaxSize: 128 } })),
  );
  assert.equal(grande.report.certificationReason, "TEXTURA_DEMASIADO_GRANDE");
  assert.equal(grande.exitCode, 1);

  const ruta = escribir(conTextura());
  assert.equal(
    JSON.stringify(inspectAsset(ruta).report),
    JSON.stringify(inspectAsset(ruta).report),
    "dos inspecciones dan informes distintos",
  );

  console.log(
    "textura: ok (una textura de 256 contra un destino de 128 suspende con salida 1, y dos " +
      "inspecciones dan el mismo informe)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "textura: no ejecutada — la comprobación de normales **no prueba qué es la imagen**: un degradado " +
    "azul la pasaría. Afirma que el contenido no se parece a lo que dice ser, y por eso el informe " +
    "publica los tres números y no solo el veredicto",
);
