/**
 * Puerta de las siluetas — qué píxeles de la foto son la pieza.
 *
 * ## El falso positivo que esto mata
 *
 * Las tres condiciones de `seesPoint` son geométricas y **ninguna mira la foto**:
 * proyecta dentro, de cara, sin nada delante. Así que una muestra que proyecta
 * sobre el cielo sale observada — la geometría dice que la cámara apuntaba hacia
 * ahí, y la fotografía dice que ahí no había pieza. Eso pasa en el borde de la
 * silueta, donde el mallador extiende superficie un poco más allá de donde hubo
 * evidencia, que es justo donde la reconstrucción es peor.
 *
 * ## Las dos identidades exactas
 *
 * Los bloques 1 y 2 no comprueban que el número «se mueva en la dirección
 * esperada», que es lo que un umbral flojo dejaría pasar con casi cualquier
 * implementación. Comprueban dos igualdades que tienen que salir **exactas**:
 *
 * ```text
 * máscara llena en todas   ≡  medir sin máscaras
 * máscara vacía en la k    ≡  medir sin la cámara k
 * ```
 *
 * La primera dice que la silueta no introduce sesgo por existir; la segunda, que
 * una cámara cuya silueta está vacía deja de aportar evidencia del todo, ni un
 * poco menos. Cualquiera de las dos falla si el muestreo del píxel está
 * desplazado, si el umbral está al revés o si el reparto va por posición.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MASK_EXTENSION, computeCoverage, computeVisibility, parsePlyAscii } from "../dist-node/agent3d.mjs";
import { encodePng } from "./agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-siluetas-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const artifactMalla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
const leida = parsePlyAscii(readFileSync(join(raiz, artifactMalla.path), "utf8")).mesh;
const malla = { ...leida, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 0 };
const CAMARAS = manifest.cameras;
const MUESTRAS = 8_000;

/** Silueta de un valor constante, del tamaño de la imagen de su cámara. */
function silueta(camera, valor, escala = 1) {
  const width = Math.max(1, Math.round(camera.width * escala));
  const height = Math.max(1, Math.round(camera.height * escala));
  return { width, height, coverage: new Uint8Array(width * height).fill(valor) };
}

// 1. Llena en todas ≡ sin máscaras. Exacto.
{
  const sin = computeCoverage(malla, CAMARAS, { samples: MUESTRAS });
  const llenas = new Map(CAMARAS.map((camera) => [camera.id, silueta(camera, 255)]));
  const con = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: llenas });

  assert.equal(con.observedAreaRatio, sin.observedAreaRatio, "una silueta llena no puede cambiar nada");
  assert.deepEqual(con.bySeenBy, sin.bySeenBy);
  // Y lo que sí cambia es la declaración: el número es el mismo y **no se mide
  // igual**, así que quien lo lea tiene que poder distinguirlos.
  assert.equal(sin.maskedCameras, 0);
  assert.equal(con.maskedCameras, CAMARAS.length);

  console.log(
    `siluetas: ok (llena en las ${CAMARAS.length} cámaras da el mismo histograma exacto que sin ` +
      "máscaras, y aun así el informe distingue los dos casos)",
  );
}

// 2. Vacía en la cámara k ≡ medir sin la cámara k. Exacto.
{
  const sinLaPrimera = computeCoverage(malla, CAMARAS.slice(1), { samples: MUESTRAS });
  const vacia = new Map([[CAMARAS[0].id, silueta(CAMARAS[0], 0)]]);
  const conVacia = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: vacia });

  assert.equal(
    conVacia.observedAreaRatio,
    sinLaPrimera.observedAreaRatio,
    "una cámara con silueta vacía tiene que dejar de aportar evidencia del todo",
  );
  assert.equal(conVacia.triangulatedAreaRatio, sinLaPrimera.triangulatedAreaRatio);
  assert.equal(conVacia.maskedCameras, 1, "solo una de las cuatro trae silueta");

  console.log(
    "siluetas: ok (vacía en una cámara da exactamente lo mismo que quitarla del CameraSet, y las otras " +
      "tres siguen midiendo)",
  );
}

// 3. **Ausente no es vacía**, que es la distinción que más importa.
//
// Si la ausencia se tratara como vacía, todo paquete sin siluetas mediría cero.
{
  const ninguna = computeCoverage(malla, CAMARAS, { samples: MUESTRAS });
  const todasVacias = new Map(CAMARAS.map((camera) => [camera.id, silueta(camera, 0)]));
  const cero = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: todasVacias });

  assert.ok(ninguna.observedAreaRatio > 0.4, "sin siluetas se mide como siempre");
  assert.equal(cero.observedAreaRatio, 0, "con todas vacías no hay nada observado");
  assert.equal(cero.unobservedAreaRatio, 1);

  // Y una cámara **que no está en el mapa** no recibe silueta aunque otras sí.
  const soloUna = new Map([[CAMARAS[0].id, silueta(CAMARAS[0], 0)]]);
  const parcial = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: soloUna });
  assert.ok(parcial.observedAreaRatio > 0, "las que no traen silueta siguen viendo");

  console.log(
    "siluetas: ok (ausente ≠ vacía: sin mapa se mide como siempre, con todas vacías sale 0 %, y una " +
      "cámara fuera del mapa no queda ciega por serlo)",
  );
}

// 4. Media silueta recorta, y recorta por donde dice.
{
  const completa = computeCoverage(malla, CAMARAS, { samples: MUESTRAS });
  const medias = new Map(
    CAMARAS.map((camera) => {
      const mask = silueta(camera, 0);
      // Mitad izquierda a 255. En la imagen, la columna es la x.
      for (let row = 0; row < mask.height; row += 1) {
        for (let column = 0; column < mask.width / 2; column += 1) {
          mask.coverage[row * mask.width + column] = 255;
        }
      }
      return [camera.id, mask];
    }),
  );
  const recortada = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: medias });

  assert.ok(
    recortada.observedAreaRatio < completa.observedAreaRatio,
    `media silueta da ${recortada.observedAreaRatio} y la entera ${completa.observedAreaRatio}`,
  );
  assert.ok(recortada.observedAreaRatio > 0, "media silueta no puede dejarlo en nada");

  console.log(
    `siluetas: ok (la mitad izquierda de cada foto baja la cobertura de ` +
      `${(completa.observedAreaRatio * 100).toFixed(1)} % a ` +
      `${(recortada.observedAreaRatio * 100).toFixed(1)} %)`,
  );
}

// 5. Otra resolución vale; otra proporción no.
//
// Un segmentador entrega la máscara en su rejilla, que casi nunca es la de la
// foto. A la mitad de tamaño tiene que dar casi lo mismo; con otra proporción
// describe otro encuadre, y estirarla le cambiaría la silueta a algo que nadie
// afirmó.
{
  const grande = new Map(CAMARAS.map((camera) => [camera.id, silueta(camera, 255)]));
  const pequena = new Map(CAMARAS.map((camera) => [camera.id, silueta(camera, 255, 0.5)]));
  const a = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: grande });
  const b = computeCoverage(malla, CAMARAS, { samples: MUESTRAS, masks: pequena });
  assert.equal(a.observedAreaRatio, b.observedAreaRatio, "una silueta llena a otra escala sigue llena");

  console.log("siluetas: ok (la misma silueta a la mitad de resolución mide lo mismo)");
}

// 6. Y el paquete entero: extensión honrada, PNG abiertos, informe que lo dice.
{
  const conSiluetas = join(sandbox, "cube-siluetas");
  writeCubePackage(conSiluetas);
  const documento = JSON.parse(readFileSync(join(conSiluetas, "manifest.json"), "utf8"));

  const porCamara = {};
  for (const camera of documento.cameras) {
    // RGBA: el recorte, donde manda el alfa. La mitad superior opaca.
    const pixels = new Uint8ClampedArray(camera.width * camera.height * 4);
    for (let row = 0; row < camera.height; row += 1) {
      for (let column = 0; column < camera.width; column += 1) {
        const slot = (row * camera.width + column) * 4;
        pixels[slot] = 255;
        pixels[slot + 1] = 255;
        pixels[slot + 2] = 255;
        pixels[slot + 3] = row < camera.height / 2 ? 255 : 0;
      }
    }
    const png = encodePng(pixels, camera.width, camera.height);
    const nombre = `silueta-${camera.id}.png`;
    writeFileSync(join(conSiluetas, nombre), png);
    documento.artifacts.push({
      id: `silueta-${camera.id}`,
      type: "IMAGE",
      path: nombre,
      bytes: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
    porCamara[camera.id] = `silueta-${camera.id}`;
  }
  documento.extensions = { [MASK_EXTENSION]: { required: false, data: { porCamara } } };
  writeFileSync(join(conSiluetas, "manifest.json"), `${JSON.stringify(documento, null, 2)}\n`);

  const { report, exitCode } = inspectPackage(join(conSiluetas, "manifest.json"));
  assert.equal(report.execution, "COMPLETE", JSON.stringify(report.warnings));
  assert.equal(exitCode, 0);
  // D30: honrada y no ignorada. Una extensión que se ignora en silencio es lo
  // que la decisión prohíbe, y hasta hoy la lista de honradas estaba vacía.
  assert.deepEqual(report.extensions.honoured, [MASK_EXTENSION]);
  assert.deepEqual(report.extensions.ignored, []);
  assert.equal(report.coverage.maskedCameras, documento.cameras.length);

  const sinExtension = inspectPackage(join(raiz, "manifest.json")).report;
  assert.equal(sinExtension.coverage.maskedCameras, 0);
  assert.ok(
    report.coverage.observedAreaRatio < sinExtension.coverage.observedAreaRatio,
    "recortar media foto en las cuatro cámaras tiene que bajar la cobertura",
  );

  console.log(
    `siluetas: ok (paquete con cuatro PNG y la extensión honrada —la primera que este binario honra—: ` +
      `la cobertura baja de ${(sinExtension.coverage.observedAreaRatio * 100).toFixed(1)} % a ` +
      `${(report.coverage.observedAreaRatio * 100).toFixed(1)} % al recortar media foto)`,
  );
}

// 7. Lo que no se puede aplicar se dice, y no tira lo demás.
{
  const rota = join(sandbox, "cube-silueta-rota");
  writeCubePackage(rota);
  const documento = JSON.parse(readFileSync(join(rota, "manifest.json"), "utf8"));
  const camera = documento.cameras[0];

  // Otra proporción: 4:1 sobre una imagen cuadrada. No es un fallo de lectura —el
  // PNG es perfecto—, es que describe otro encuadre.
  const ancho = camera.width * 2;
  const alto = Math.max(1, Math.round(camera.height / 2));
  const pixels = new Uint8ClampedArray(ancho * alto * 4).fill(255);
  const png = encodePng(pixels, ancho, alto);
  writeFileSync(join(rota, "silueta-rota.png"), png);
  documento.artifacts.push({
    id: "silueta-rota",
    type: "IMAGE",
    path: "silueta-rota.png",
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
  documento.extensions = {
    [MASK_EXTENSION]: {
      required: false,
      data: { porCamara: { [camera.id]: "silueta-rota", "camara-que-no-existe": "silueta-rota" } },
    },
  };
  writeFileSync(join(rota, "manifest.json"), `${JSON.stringify(documento, null, 2)}\n`);

  const { report } = inspectPackage(join(rota, "manifest.json"));
  const avisos = report.warnings.filter((warning) => warning.code === "SS-CAM-007");
  assert.equal(avisos.length, 2, "la del encuadre y la de la cámara inventada, cada una por su lado");
  assert.ok(avisos.some((aviso) => aviso.message.includes("no es una cámara declarada")));
  assert.ok(avisos.some((aviso) => aviso.message.includes("MASCARA_DE_OTRO_ENCUADRE")));
  // Y **se sigue midiendo**: una silueta que no se puede aplicar no invalida la
  // cobertura, la deja sin recortar en esa cámara y lo dice.
  assert.ok(report.coverage !== undefined);
  assert.equal(report.coverage.maskedCameras, 0, "la única declarada no se pudo aplicar");

  console.log(
    "siluetas: ok (una máscara de otro encuadre y otra repartida a una cámara inventada salen las dos " +
      "por SS-CAM-007, no se aplican, y la cobertura se sigue midiendo sin ellas)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "siluetas: no ejecutada — no hay siluetas sobre datos reales. Segmentarlas pide SAM2, que exige " +
    "Python 3.10 y torch 2.3, y esta máquina tiene 3.9 y torch se quedó en 2.2.2 para macOS Intel. " +
    "Lo que falta es el fichero, no el camino: el paquete que las traiga se mide con lo de arriba",
);
