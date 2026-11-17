/**
 * Puerta de R8: la malla contra la evidencia de origen.
 *
 * Tres piezas, y cada una contra algo que no es ella misma:
 *
 * 1. **El rayo de un píxel** (`pixelRay`) contra `projectPoint`, que es la
 *    convención que la cobertura y las máscaras ya respetan: cualquier punto del
 *    rayo tiene que volver a proyectar en su píxel, con cada combinación de origen,
 *    centro de píxel, ejes y distorsión.
 * 2. **El lector EXR** (D5) contra un fichero ensamblado aquí byte a byte, con los
 *    valores calculados a mano; contra el escritor de `tools/exr.mjs` en todas las
 *    combinaciones que admite; y rechazando por su código lo que D5 excluye.
 * 3. **Los residuos** contra la caja analítica. La evidencia de `residualFixture`
 *    sale de seis planos y los residuos de los triángulos de la malla en el árbol:
 *    con la malla correcta tienen que coincidir, y con una malla un 10 % más grande
 *    los recuentos de silueta y las estadísticas de profundidad se recalculan aquí
 *    por la caja y tienen que salir **los mismos números**.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RECONSTRUCTION_REPORT_SCHEMA,
  halfToFloat,
  parseExr,
  pixelRay,
  projectPoint,
  validate,
} from "../dist-node/agent3d.mjs";
import { writeExr, zlibInflate } from "./exr.mjs";
import { inspectPackage, renderHuman } from "./reconstruction.mjs";
import { rayBox, writeEvidencePackage } from "./residualFixture.mjs";

const work = mkdtempSync(join(tmpdir(), "softsight-r8-"));
const w = (name) => join(work, name);

try {
  // 1. El rayo de un píxel es la inversa de la proyección.
  {
    let checks = 0;
    for (const pixelOrigin of ["TOP_LEFT", "BOTTOM_LEFT"]) {
      for (const pixelCenter of ["CENTER", "CORNER"]) {
        for (const cameraAxes of ["X_RIGHT_Y_DOWN_Z_FORWARD", "X_RIGHT_Y_UP_Z_BACKWARD"]) {
          for (const distortion of [undefined, { k1: -0.12, k2: 0.03, p1: 0.001, p2: -0.0007 }]) {
            // Una pose girada y desplazada, para que ningún eje coincida con el del mundo.
            const c = Math.cos(0.4);
            const s = Math.sin(0.4);
            const camera = {
              width: 640,
              height: 480,
              pixelOrigin,
              pixelCenter,
              cameraAxes,
              intrinsics: { fx: 500, fy: 510, cx: 321.5, cy: 238.25 },
              ...(distortion === undefined ? {} : { distortion }),
              worldFromCamera: [c, 0, s, 0.3, 0, 1, 0, -0.2, -s, 0, c, 4, 0, 0, 0, 1],
            };
            for (const [x, y] of [[0.5, 0.5], [320, 240], [639.5, 10.25], [12.75, 470.5], [500.125, 333.875]]) {
              const ray = pixelRay(camera, x, y);
              assert.ok(ray !== null, `sin rayo en (${x}, ${y})`);
              const t = 2.5;
              const point = ray.direction.map((component, axis) => ray.origin[axis] + component * t);
              const back = projectPoint(camera, point);
              assert.ok(Math.abs(back.x - x) < 1e-8 && Math.abs(back.y - y) < 1e-8, `${pixelOrigin}/${pixelCenter}/${cameraAxes}: (${x}, ${y}) vuelve a (${back.x}, ${back.y})`);
              assert.ok(Math.abs(back.depth - t) < 1e-9, "la distancia sobre la dirección del rayo es la profundidad sobre el eje óptico");
              assert.ok(Math.abs(Math.hypot(...ray.direction) - ray.length) < 1e-12);
              checks += 1;
            }
          }
        }
      }
    }
    console.log(`r8: ok (el rayo de ${checks} píxeles vuelve a proyectar en su píxel con las 16 combinaciones de origen, centro, ejes y distorsión)`);
  }

  // 2. El lector EXR.
  {
    // HALF a mano: 1, -2, el menor subnormal, el mayor finito, infinito.
    assert.equal(halfToFloat(0x3c00), 1);
    assert.equal(halfToFloat(0xc000), -2);
    assert.equal(halfToFloat(0x0001), 2 ** -24);
    assert.equal(halfToFloat(0x7bff), 65504);
    assert.equal(halfToFloat(0x7c00), Infinity);
    assert.ok(Number.isNaN(halfToFloat(0x7e00)));

    // Un EXR de 2×1 ensamblado aquí, sin el escritor: canal FLOAT «Z» y canal HALF
    // «A», sin compresión. Los bytes salen de la especificación, no de nuestro código.
    const bytes = [];
    const u8 = (...values) => bytes.push(...values);
    const i32 = (value) => { const b = Buffer.alloc(4); b.writeInt32LE(value); bytes.push(...b); };
    const f32 = (value) => { const b = Buffer.alloc(4); b.writeFloatLE(value); bytes.push(...b); };
    const text = (value) => bytes.push(...Buffer.from(`${value}\0`, "latin1"));
    u8(0x76, 0x2f, 0x31, 0x01); i32(2);
    text("channels"); text("chlist"); i32(2 + 16 + 2 + 16 + 1);
    text("A"); i32(1); u8(0, 0, 0, 0); i32(1); i32(1);
    text("Z"); i32(2); u8(0, 0, 0, 0); i32(1); i32(1); u8(0);
    text("compression"); text("compression"); i32(1); u8(0);
    text("dataWindow"); text("box2i"); i32(16); i32(0); i32(0); i32(1); i32(0);
    u8(0); // fin de la cabecera
    const tableAt = bytes.length;
    i32(0); i32(0); // un bloque; su desplazamiento se rellena abajo
    const blockAt = bytes.length;
    i32(0); i32(2 * 2 + 2 * 4); // línea 0 y tamaño: dos HALF y dos FLOAT
    u8(0x00, 0x3c, 0x00, 0xc0); // A = 1, -2
    f32(1.5); f32(-0.25);       // Z
    const file = Buffer.from(bytes);
    file.writeBigUInt64LE(BigInt(blockAt), tableAt);
    const hecho = parseExr(new Uint8Array(file));
    assert.deepEqual([hecho.width, hecho.height, hecho.compression], [2, 1, "NO_COMPRESSION"]);
    assert.deepEqual([...hecho.channels.Z.values], [1.5, -0.25]);
    assert.deepEqual([...hecho.channels.A.values], [1, -2]);

    // El escritor, en todas las combinaciones, con una última tanda ZIP incompleta.
    const width = 23;
    const height = 37;
    const z = Float32Array.from({ length: width * height }, (_, index) => Math.fround(0.5 + index * 0.0137));
    for (const compression of ["NO_COMPRESSION", "ZIPS", "ZIP"]) {
      for (const type of ["FLOAT", "HALF"]) {
        const exr = writeExr({ width, height, channels: [{ name: "Z", type, values: z }], compression });
        const leido = parseExr(new Uint8Array(exr), { inflate: zlibInflate });
        assert.equal(leido.compression, compression);
        if (type === "FLOAT") assert.deepEqual(leido.channels.Z.values, z);
        else assert.ok(leido.channels.Z.values.every((value, index) => Math.abs(value - z[index]) <= Math.abs(z[index]) * 2 ** -11), "HALF a media unidad de su último bit");
      }
    }

    // Lo que D5 rechaza, por su código.
    const base = writeExr({ width: 4, height: 4, channels: [{ name: "Z", type: "FLOAT", values: new Float32Array(16) }], compression: "ZIP" });
    const conByte = (patch) => { const copy = Buffer.from(base); patch(copy); return new Uint8Array(copy); };
    const compressionAt = base.indexOf(Buffer.from("compression\0compression\0", "latin1")) + 24 + 4;
    for (const [code, name] of [[4, "PIZ"], [6, "B44"], [8, "DWAA"], [1, "RLE"]]) {
      assert.throws(() => parseExr(conByte((copy) => { copy[compressionAt] = code; }), { inflate: zlibInflate }), new RegExp(`EXR_COMPRESION_NO_SOPORTADA: ${name}`));
    }
    assert.throws(() => parseExr(conByte((copy) => { copy.writeUInt32LE(2 | 0x200, 4); })), /EXR_DISPOSICION_NO_SOPORTADA: es teselado/);
    assert.throws(() => parseExr(conByte((copy) => { copy[0] = 0; })), /EXR_FIRMA_INVALIDA/);
    assert.throws(() => parseExr(new Uint8Array(base)), /pide zlib/);
    const uint = Buffer.from(base);
    uint.writeInt32LE(0, uint.indexOf(Buffer.from("Z\0", "latin1"), uint.indexOf("chlist")) + 2);
    assert.throws(() => parseExr(new Uint8Array(uint), { inflate: zlibInflate }), /EXR_CANAL_NO_SOPORTADO: el canal Z es UINT/);
    console.log(
      "r8: ok (EXR: un fichero ensamblado byte a byte se lee con sus valores; NO_COMPRESSION, ZIPS y ZIP en FLOAT y HALF " +
        "vuelven del escritor; PIZ, B44, DWA, RLE, teselado, UINT y sin zlib se rechazan con su código, D5)",
    );
  }

  // 3. Los residuos contra la caja analítica.
  const inspect = (name, options) => {
    writeEvidencePackage(w(name), options);
    const manifest = JSON.parse(readFileSync(w(`${name}/manifest.json`), "utf8"));
    return { manifest, ...inspectPackage(w(`${name}/manifest.json`), { cache: false }) };
  };

  // La malla correcta: las dos superficies son la misma.
  const exacta = inspect("exacta", {});
  {
    const { residuals } = exacta.report;
    assert.ok(residuals, "con máscaras y profundidad el informe trae residuals");
    assert.deepEqual([residuals.masks.iou, residuals.masks.falsePositiveRatio, residuals.masks.falseNegativeRatio], [1, 0, 0]);
    for (const camera of residuals.masks.byCamera) {
      assert.equal(camera.stride, 1, "256×256 cabe sin paso");
      assert.deepEqual(camera.boundary, { meshToMaskMean: 0, meshToMaskMax: 0, maskToMeshMean: 0, maskToMeshMax: 0 });
    }
    assert.equal(residuals.depth.meshMissRatio, 0);
    assert.equal(residuals.depth.meshOnlyRatio, 0);
    // El único error es el de guardar la profundidad en FLOAT de 32 bits.
    assert.ok(residuals.depth.stats.maxAbs < 2e-7, `error máximo ${residuals.depth.stats.maxAbs}`);
    assert.ok(residuals.normals.medianDegrees < 1e-3, `ángulo mediano ${residuals.normals.medianDegrees}`);
    assert.deepEqual(validate(exacta.report, RECONSTRUCTION_REPORT_SCHEMA), [], "el informe valida contra su esquema publicado");
    assert.deepEqual(inspectPackage(w("exacta/manifest.json"), { cache: false }).report.residuals, residuals, "dos inspecciones, el mismo bloque");
    console.log(
      `r8: ok (malla correcta: IoU 1 y bordes a 0 px en las ${residuals.masks.cameras} cámaras, profundidad a ` +
        `${residuals.depth.stats.maxAbs.toExponential(1)} —el redondeo de FLOAT— y normales a ` +
        `${residuals.normals.medianDegrees}° de mediana; valida contra el esquema publicado)`,
    );
  }

  // La malla un 10 % más grande: la caja recalcula aquí lo que los triángulos midieron.
  {
    const grande = inspect("grande", { meshScale: 1.1 });
    const { masks, depth } = grande.report.residuals;
    const abs = [];
    let signed = 0;
    for (const camera of grande.manifest.cameras) {
      let mesh = 0;
      let mask = 0;
      let both = 0;
      for (let row = 0; row < camera.height; row += 1) {
        for (let column = 0; column < camera.width; column += 1) {
          const ray = pixelRay(camera, column + 0.5, row + 0.5);
          const enMalla = rayBox(ray.origin, ray.direction, 0.55);
          const enFuente = rayBox(ray.origin, ray.direction, 0.5);
          if (enMalla !== null) mesh += 1;
          if (enFuente !== null) mask += 1;
          if (enMalla !== null && enFuente !== null) {
            both += 1;
            const error = enMalla - Math.fround(enFuente);
            abs.push(Math.abs(error));
            signed += error;
          }
        }
      }
      const medido = masks.byCamera.find((entry) => entry.cameraId === camera.id);
      assert.deepEqual([medido.meshPixels, medido.maskPixels, medido.intersection], [mesh, mask, both], `${camera.id}: la silueta de los triángulos es la de la caja`);
    }
    abs.sort((a, b) => a - b);
    const at = (p) => abs[Math.max(0, Math.ceil(p * abs.length) - 1)];
    assert.equal(depth.compared, abs.length);
    assert.ok(Math.abs(depth.stats.medianAbs - at(0.5)) < 1e-6 && Math.abs(depth.stats.p95Abs - at(0.95)) < 1e-6, "mediana y p95 de la caja");
    assert.ok(Math.abs(depth.stats.meanSigned - signed / abs.length) < 1e-6, "sesgo de la caja");
    assert.ok(depth.stats.meanSigned < 0, "más grande es más cerca de la cámara: el sesgo es negativo");
    assert.equal(masks.falseNegativeRatio, 0, "una malla que contiene a la pieza no deja máscara sin cubrir");
    assert.ok(masks.falsePositiveRatio > 0.1);
    console.log(
      `r8: ok (malla un 10 % más grande: los recuentos de silueta de las cuatro cámaras y la mediana, el p95 y el sesgo de ` +
        `la profundidad son los de la caja analítica; IoU ${masks.iou.toFixed(4)}, sesgo ${depth.stats.meanSigned.toFixed(4)})`,
    );
  }

  // Lo que se declara mal se ve, y lo que no se puede leer se dice.
  {
    const mal = inspect("mal-declarada", { depthKind: "OPTICAL_AXIS", writtenKind: "RAY_LENGTH" });
    assert.equal(mal.report.residuals.masks.iou, 1, "la silueta no depende de depthKind");
    assert.ok(mal.report.residuals.depth.stats.medianRelative > 0.01, "longitud de rayo leída como eje óptico deja error");
    assert.ok(mal.report.residuals.normals.medianDegrees > 1, "y tuerce la superficie que se deriva de ella");

    const conNan = inspect("con-nan", { invalid: "NAN" });
    assert.deepEqual(conNan.report.residuals.depth, exacta.report.residuals.depth, "NAN o CERO como inválido: las mismas medidas");

    writeEvidencePackage(w("rota"));
    const manifest = JSON.parse(readFileSync(w("rota/manifest.json"), "utf8"));
    const codificacion = manifest.extensions["org.softsight.profundidad"].data.porArtefacto;
    const [primera, segunda, tercera] = Object.keys(codificacion);
    codificacion[primera].espacio = "RECTIFIED";
    codificacion[segunda].unidad = "METRO";
    codificacion[tercera].canal = "Y";
    writeFileSync(w("rota/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const rota = inspectPackage(w("rota/manifest.json"), { cache: false }).report;
    const avisos = rota.warnings.filter((warning) => warning.code === "SS-CAM-008").map((warning) => warning.message).join("\n");
    assert.match(avisos, /espacio "RECTIFIED" sobre una cámara ORIGINAL/);
    assert.match(avisos, /unidad "METRO"/);
    assert.match(avisos, /no tiene el canal Y/);
    assert.equal(rota.residuals.depth.cameras, 1, "los tres que no encajan no se comparan; el cuarto sí");
    assert.equal(rota.residuals.masks.cameras, 4, "las máscaras no dependen de la profundidad");
    console.log(
      "r8: ok (longitud de rayo declarada como eje óptico deja error y tuerce las normales; NAN y CERO como inválido miden " +
        "lo mismo; espacio, unidad o canal que no encajan se avisan con SS-CAM-008 y ese mapa no se compara)",
    );
  }

  // Sin evidencia, no hay bloque; y el texto para personas sale del mismo objeto.
  {
    writeEvidencePackage(w("solo-cubo"));
    const manifest = JSON.parse(readFileSync(w("solo-cubo/manifest.json"), "utf8"));
    delete manifest.extensions;
    writeFileSync(w("solo-cubo/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal(inspectPackage(w("solo-cubo/manifest.json"), { cache: false }).report.residuals, undefined, "sin máscaras ni profundidad, ausente y no a cero");
    const texto = renderHuman(exacta.report);
    assert.match(texto, /siluetas {4}4 cámaras · IoU 1\.000/);
    assert.match(texto, /profundidad 4 mapas/);
    console.log("r8: ok (sin máscaras ni profundidad no hay bloque —ausente, no a cero—, y el texto para personas lleva los mismos números)");
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(
  "r8: fuera de alcance — la normal de origen sale de la profundidad porque el contrato no tiene mapas de normales; el " +
    "color no se compara (§37: «no depender de color bruto para V1»); y no hay avisos de residuo alto, porque qué error " +
    "basta lo decide quien usa la pieza. Sobre datos reales falta un productor que entregue máscaras y profundidad",
);
