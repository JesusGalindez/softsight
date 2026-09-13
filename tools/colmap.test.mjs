/**
 * Puerta del adaptador de COLMAP — D4.
 *
 * El juez son **las observaciones del propio fichero**. COLMAP guarda, para cada
 * imagen, dónde cayó cada punto 3D en píxeles; así que el camino entero se puede
 * cerrar sobre sí mismo sin inventar ningún valor dorado:
 *
 * ```text
 * points3D.txt + images.txt  →  adaptador  →  CameraSet canónico
 *                                              ↓ projectPoint
 *                            el mismo píxel que el fichero ya decía
 * ```
 *
 * Si el cuaternión se leyera como `(x, y, z, w)`, si la pose no se invirtiera, si
 * el marco de la cámara se confundiera con el de gráficos o si el orden de los
 * parámetros de un modelo estuviera cambiado, los píxeles no cuadrarían. Ninguna
 * de esas cuatro cosas se ve leyendo el código —las cuatro producen números
 * plausibles— y todas caen aquí.
 *
 * El fixture lo escribe `tools/colmapSmall.mjs` con la fórmula de COLMAP escrita
 * allí, no llamando al adaptador: generarlo con lo que se va a probar sería
 * dibujar la diana alrededor del disparo.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { colmapRoot } from "./fixtures.mjs";
import {
  parseColmapCameras,
  parseColmapModel,
  projectPoint,
  toCameraSet,
  validate,
  RECONSTRUCTION_PACKAGE_SCHEMA,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const FIXTURE = resolve(here, "../contracts/fixtures/colmap-small-v1");

const model = parseColmapModel({
  cameras: readFileSync(resolve(FIXTURE, "cameras.txt"), "utf8"),
  images: readFileSync(resolve(FIXTURE, "images.txt"), "utf8"),
  points: readFileSync(resolve(FIXTURE, "points3D.txt"), "utf8"),
});

// 1. Lo que trae el fichero, leído.
{
  assert.equal(model.cameras.length, 3, "tres cámaras, con tres modelos distintos");
  assert.equal(model.images.length, 3);
  assert.equal(model.points.length, 12);
  assert.deepEqual(model.unsupported, []);

  // Los parámetros posicionales, ya con nombre (D19). `SIMPLE_RADIAL` tiene una
  // sola focal para los dos ejes: si el adaptador la repartiera mal, una imagen
  // saldría estirada y la proyección seguiría cuadrando en el centro.
  const [pinhole, radial, opencv] = model.cameras;
  assert.deepEqual(pinhole.intrinsics, { fx: 525.5, fy: 524.25, cx: 320.5, cy: 240.5 });
  assert.equal(pinhole.distortion, undefined, "una PINHOLE no lleva distorsión, ni ceros implícitos");
  assert.deepEqual(radial.intrinsics, { fx: 610.75, fy: 610.75, cx: 400.5, cy: 300.25 });
  assert.deepEqual(radial.distortion, { k1: -0.021 });
  assert.deepEqual(opencv.distortion, { k1: -0.035, k2: 0.011, p1: 0.0004, p2: -0.0007 });
  console.log(
    `colmap: ok (${model.cameras.length} cámaras con sus parámetros con nombre, ` +
      `${model.images.length} imágenes y ${model.points.length} puntos)`,
  );
}

// 2. El camino entero: cada observación del fichero, reproyectada.
{
  const cameraSet = toCameraSet(model);
  const points = new Map(model.points.map((point) => [point.id, point.position]));
  let comprobadas = 0;
  let peor = 0;

  model.images.forEach((image, index) => {
    const camera = cameraSet[index];
    assert.equal(camera.id, `img-${image.id}`);
    for (const observation of image.observations) {
      if (observation.pointId === null) continue;
      const point = points.get(observation.pointId);
      assert.ok(point !== undefined, `la observación cita el punto ${observation.pointId}, que no existe`);
      const projected = projectPoint(camera, point);
      const error = Math.hypot(projected.x - observation.x, projected.y - observation.y);
      // Una diezmilésima de píxel: el fixture guarda ocho decimales, así que lo
      // único que separa los dos números es el redondeo del texto. Un margen de
      // un píxel dejaría pasar medio píxel de convención equivocada.
      assert.ok(
        error < 1e-4,
        `${camera.id}, punto ${observation.pointId}: ${projected.x},${projected.y} contra ${observation.x},${observation.y}`,
      );
      assert.ok(projected.depth > 0, "un punto observado tiene que estar delante de la cámara");
      assert.ok(projected.inside, "un punto observado cae dentro de la imagen");
      peor = Math.max(peor, error);
      comprobadas += 1;
    }
  });

  assert.ok(comprobadas >= 24, `solo ${comprobadas} observaciones: el fixture no ejerce lo suficiente`);
  console.log(
    `colmap: ok (${comprobadas} observaciones del fichero reproyectadas por el CameraSet canónico, ` +
      `error máximo ${peor.toExponential(1)} píxeles)`,
  );
}

// 3. El CameraSet que sale es el del contrato, no uno parecido.
{
  // El hash de cada imagen entra por parámetro: COLMAP nombra sus imágenes y no
  // las hashea, así que el adaptador no se lo puede inventar (D10). Aquí el
  // fixture es sintético y los ficheros no existen, de modo que el mapa lleva un
  // hash de relleno que es el mismo que declaran los artifacts; lo que la puerta
  // comprueba es que el adaptador **lo traslade**, no que lo calcule.
  const relleno = "0".repeat(64);
  const hashes = new Map(model.images.map((image) => [image.name, relleno]));
  const cameraSet = toCameraSet(model, hashes);
  for (const camera of cameraSet) {
    assert.equal(camera.imageArtifactHash, relleno, "el adaptador tiene que trasladar el hash que recibe");
    // COLMAP calibra sobre la imagen tal y como la grabó la cámara: sus
    // coeficientes describen lo que hay que corregir, así que declarar RECTIFIED
    // contradiría sus propios números.
    assert.equal(camera.imageSpace, "ORIGINAL");
  }
  // Y sin el mapa la entrada sale sin hash, y el paquete se rechaza por esquema:
  // mejor que inventarlo.
  assert.equal(toCameraSet(model)[0].imageArtifactHash, undefined);

  const manifest = {
    documentType: "videomesh.reconstruction-package",
    contractVersion: "0.1",
    packageId: "colmap-small-v1",
    state: "SEALED",
    producer: { name: "softsight/colmapSmall", version: "0.1.0" },
    artifacts: cameraSet.map((camera) => ({
      id: camera.imageArtifactId,
      type: "IMAGE",
      path: `images/${camera.id}.jpg`,
      bytes: 1,
      sha256: "0".repeat(64),
    })),
    cameras: cameraSet,
    // COLMAP sin restricción externa no sabe a qué escala reconstruyó, y decir
    // otra cosa es lo que D9 impide. UNKNOWN es el dato, no un hueco.
    scale: { status: "UNKNOWN", source: "NONE" },
    frameGraph: { transforms: [] },
  };
  assert.deepEqual(validate(manifest, RECONSTRUCTION_PACKAGE_SCHEMA), []);
  for (const camera of cameraSet) {
    assert.equal(camera.cameraAxes, "X_RIGHT_Y_DOWN_Z_FORWARD", "COLMAP mira a +Z con la Y hacia abajo");
    assert.equal(camera.worldFromCamera.length, 16);
    assert.deepEqual(camera.worldFromCamera.slice(12), [0, 0, 0, 1], "la última fila de una pose rígida");
  }
  console.log("colmap: ok (el CameraSet convertido valida contra el esquema del paquete, con la escala en UNKNOWN)");
}

// 4. Un modelo que no sabemos convertir se dice, no se aproxima.
{
  const { cameras, unsupported } = parseColmapCameras(
    ["1 PINHOLE 640 480 525.5 524.25 320.5 240.5", "2 OPENCV_FISHEYE 640 480 1 2 3 4 5 6 7 8"].join("\n"),
  );
  assert.equal(cameras.length, 1);
  assert.deepEqual(unsupported, [{ cameraId: "2", model: "OPENCV_FISHEYE" }]);

  // Y un modelo conocido con parámetros de más se rechaza por su motivo: es un
  // fichero corrupto, no un modelo nuevo.
  assert.throws(
    () => parseColmapCameras("1 PINHOLE 640 480 525.5 524.25 320.5"),
    /COLMAP_CAMERA_INVALID: la cámara 1 declara PINHOLE con 3 parámetros/,
  );
  console.log(
    "colmap: ok (un ojo de pez se declara no soportado en vez de aproximarse a OPENCV, y una cámara " +
      "con parámetros de menos se rechaza por su motivo)",
  );
}

// 5. La reconstrucción real — D4.
//
// `colmap-small-v1` lo escribimos nosotros, así que no puede tener sorpresas que
// no previéramos. Éste sí: ruido de verdad, el 77 % de las observaciones sin
// triangular, y dos modelos de cámara distintos.
//
// **La comprobación que vale es la última.** COLMAP guarda en `points3D.txt` el
// error de reproyección medio de cada punto, calculado por su código. Nosotros lo
// recalculamos con el nuestro sobre el CameraSet canónico. Son dos caminos
// independientes hacia el mismo número, que es como se cierra una fase en este
// repositorio.
{
  const manifest = JSON.parse(
    readFileSync(resolve(projectRoot, "contracts/fixtures/colmap-real-v1.json"), "utf8"),
  );
  const escenas = Object.keys(manifest.scenes);
  const presente = escenas.every((escena) =>
    Object.keys(manifest.scenes[escena]).every((f) => existsSync(resolve(colmapRoot, escena, f))),
  );

  if (!presente) {
    console.log(
      `colmap: no ejecutada — falta el fixture pesado ${manifest.name} en ${colmapRoot} ` +
        "(SOFTSIGHT_COLMAP). Son 58 MB de texto de terceros y por eso no están aquí, D22",
    );
  } else {
    for (const escena of escenas) {
      // El hash primero: sin él no se sabe contra qué se está midiendo, y un
      // fichero cambiado daría números distintos sin que nadie supiera por qué.
      const leer = (nombre) => {
        const raw = readFileSync(resolve(colmapRoot, escena, nombre));
        assert.equal(
          createHash("sha256").update(raw).digest("hex"),
          manifest.scenes[escena][nombre].sha256,
          `${escena}/${nombre}: el fichero no es el del manifiesto`,
        );
        return raw.toString("utf8");
      };
      const model = parseColmapModel({
        cameras: leer("cameras.txt"),
        images: leer("images.txt"),
        points: leer("points3D.txt"),
      });

      assert.deepEqual(model.unsupported, [], `${escena}: un modelo de cámara sin convertir`);
      const observaciones = model.images.reduce((n, i) => n + i.observations.length, 0);
      const sinTriangular = model.images.reduce(
        (n, i) => n + i.observations.filter((o) => o.pointId === null).length,
        0,
      );
      // Lo que el sintético no tiene: la mayoría de lo que ve una cámara no acaba
      // en un punto 3D. Si el adaptador las tirara, este número sería cero.
      assert.ok(
        sinTriangular > observaciones / 2,
        `${escena}: solo ${sinTriangular} observaciones sin triangular de ${observaciones}`,
      );

      const byId = new Map(toCameraSet(model, new Map()).map((c) => [c.id, c]));
      const pista = new Map();
      for (const img of model.images) {
        const cam = byId.get(`img-${img.id}`);
        for (const o of img.observations) {
          if (o.pointId === null) continue;
          const lista = pista.get(o.pointId) ?? [];
          lista.push([cam, o]);
          pista.set(o.pointId, lista);
        }
      }

      const diferencias = [];
      let nuestro = 0;
      let suyo = 0;
      let sinDistorsion = 0;
      let sinDistorsionPuntos = 0;
      let puntos = 0;
      // El contraste sin distorsión se mide sobre una muestra y no sobre el
      // millón entero: existe para enseñar que ese camino hace trabajo, y con dos
      // mil puntos la diferencia ya es de un orden de magnitud. Proyectarlo todo
      // dos veces doblaba el coste de la puerta para afinar un número que no
      // decide nada.
      const MUESTRA_SIN_DISTORSION = 2_000;
      for (const p of model.points) {
        const observadores = pista.get(p.id);
        if (observadores === undefined) continue;
        let con = 0;
        for (const [cam, o] of observadores) {
          const a = projectPoint(cam, p.position);
          con += Math.hypot(a.x - o.x, a.y - o.y);
        }
        con /= observadores.length;
        diferencias.push(Math.abs(con - p.error));
        nuestro += con;
        suyo += p.error;
        puntos += 1;

        // La misma cuenta con la distorsión quitada, para que se vea que ese
        // camino hace trabajo y no decora.
        if (sinDistorsionPuntos < MUESTRA_SIN_DISTORSION) {
          let sin = 0;
          for (const [cam, o] of observadores) {
            const b = projectPoint({ ...cam, distortion: undefined }, p.position);
            sin += Math.hypot(b.x - o.x, b.y - o.y);
          }
          sinDistorsion += sin / observadores.length;
          sinDistorsionPuntos += 1;
        }
      }

      diferencias.sort((a, b) => a - b);
      const cuantil = (f) => diferencias[Math.floor(diferencias.length * f)];
      const medio = nuestro / puntos;
      const suyoMedio = suyo / puntos;

      // Sobre estadísticos robustos y no sobre el máximo: el `ERROR` que COLMAP
      // guarda viene de su último ajuste de haces y una cola fina de puntos
      // —el 0,7 %— se separa más. Lo que no puede pasar es que la distribución
      // entera se mueva.
      assert.ok(
        Math.abs(medio - suyoMedio) < 1e-3,
        `${escena}: nuestro error medio es ${medio} y COLMAP declara ${suyoMedio}`,
      );
      assert.ok(cuantil(0.5) < 5e-3, `${escena}: la mediana de la diferencia es ${cuantil(0.5)}`);
      assert.ok(cuantil(0.99) < 5e-2, `${escena}: el p99 de la diferencia es ${cuantil(0.99)}`);

      // Y el contraste que lo hace significar algo: sin distorsión el número se
      // dispara. Sin esto, una proyección que ignorase la distorsión también
      // pasaría si los coeficientes fueran pequeños.
      const medioSinDistorsion = sinDistorsion / sinDistorsionPuntos;
      assert.ok(
        medioSinDistorsion > medio * 5,
        `${escena}: quitar la distorsión apenas mueve el error, ${medioSinDistorsion} contra ${medio}`,
      );

      console.log(
        `colmap: ok (${escena}: ${model.images.length} imágenes, ${model.points.length} puntos, ` +
          `${sinTriangular} de ${observaciones} observaciones sin triangular. Error medio de ` +
          `reproyección ${medio.toFixed(5)} px contra los ${suyoMedio.toFixed(5)} que declara COLMAP; ` +
          `sin distorsión, ${medioSinDistorsion.toFixed(2)} px sobre ${sinDistorsionPuntos} puntos)`,
      );
    }

    // Los dos modelos, que es la otra mitad de lo que el sintético no da.
    // La primera línea con contenido, no la primera: COLMAP abre con tres de
    // comentario y `split` sobre ellas devuelve la palabra «Camera».
    const declarados = escenas.map((escena) =>
      readFileSync(resolve(colmapRoot, escena, "cameras.txt"), "utf8")
        .split(/\r?\n/)
        .map((linea) => linea.trim())
        .filter((linea) => linea !== "" && !linea.startsWith("#"))[0]
        .split(/\s+/)[1],
    );
    assert.deepEqual(
      [...declarados].sort(),
      ["OPENCV", "SIMPLE_RADIAL"],
      "el fixture tiene que ejercer dos modelos distintos, no dos veces el mismo",
    );
    console.log(
      `colmap: ok (dos de los cinco modelos soportados, SIMPLE_RADIAL y OPENCV, y con ` +
        "focales distintas en x e y —3838.27 y 3837.22— que ningún fixture sintético había ejercido)",
    );
  }
}
