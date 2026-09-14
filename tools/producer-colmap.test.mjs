/**
 * Puerta de R0-B — el segundo productor.
 *
 * D26 promueve el contrato a 1.0 cuando **dos productores reales distintos** han
 * producido paquetes válidos, y D34 lo pone como criterio de salida. Hasta hoy el
 * único era `tools/cubeV1.mjs`, que es nuestro y usa nuestros módulos: un paquete
 * que valida porque lo escribió quien escribió el validador no prueba que el
 * contrato sea escribible.
 *
 * `producers/colmap/` no importa nada de `src/` ni de `dist-node/` — el primer
 * bloque lo comprueba **por ausencia**, que es la única forma: un import de más
 * no rompe ninguna prueba, solo convierte al segundo productor en el primero
 * disfrazado.
 *
 * ## Lo que de verdad se compara
 *
 * El bloque 3. El productor reescribe la conversión de COLMAP —cuaternión a
 * matriz, inversión de la pose, intrínsecos posicionales a campos con nombre—
 * desde la documentación del formato, y `src/soft/agent/reconstruction/colmap.ts`
 * la tiene escrita por su cuenta. **Que las dos caigan en la misma matriz es la
 * prueba de que el contrato está bien especificado**; compartir código la
 * anularía.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseColmapModel, toCameraSet, projectPoint } from "../dist-node/agent3d.mjs";
import { colmapRoot } from "./fixtures.mjs";
import { buildColmapPackage } from "../producers/colmap/build.mjs";
import { inspectPackage } from "./reconstruction.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

// 1. La independencia, comprobada por ausencia.
{
  const raiz = resolve(projectRoot, "producers");
  const ficheros = [];
  const recorrer = (directorio) => {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.name.endsWith(".mjs") || entrada.name.endsWith(".ts")) ficheros.push(ruta);
    }
  };
  recorrer(raiz);
  assert.ok(ficheros.length > 0, "no hay productores que comprobar");

  for (const fichero of ficheros) {
    const texto = readFileSync(fichero, "utf8");
    const intrusos = [...texto.matchAll(/from\s+"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ruta) => /(^|\/)(src|dist-node|tools)\//.test(ruta) || ruta.includes("agent3d.mjs"));
    assert.deepEqual(
      intrusos,
      [],
      `${fichero.slice(projectRoot.length + 1)} importa del verificador: ${intrusos.join(", ")}`,
    );
  }
  console.log(
    `productor: ok (${ficheros.length} ficheros en producers/ y ninguno importa de src/, tools/ ni ` +
      "dist-node/: el segundo productor lo es de verdad)",
  );
}

const escena = join(colmapRoot, "south-building");
if (!existsSync(join(escena, "images"))) {
  console.log(
    `productor: no ejecutada — falta el fixture pesado en ${escena} (SOFTSIGHT_COLMAP), con images/. ` +
      "Sin él no hay COLMAP real que empaquetar, y un paquete sintético no probaría R0-B",
  );
} else {
  const sandbox = mkdtempSync(join(tmpdir(), "softsight-productor-"));
  const destino = join(sandbox, "colmap-v1");
  const construido = buildColmapPackage(escena, destino);

  // 2. El paquete entra y certifica.
  {
    const { report, exitCode } = inspectPackage(join(destino, "manifest.json"));
    assert.equal(report.execution, "COMPLETE", JSON.stringify(report.warnings));
    // **PASS y no INCONCLUSIVE**, que es la fila de D8 que este paquete ejerce:
    // un SfM disperso entrega nube y cámaras, y no promete superficie.
    assert.equal(report.certification, "PASS", report.certificationReason);
    assert.equal(exitCode, 0);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.measurements, [], "no declara malla, así que no hay medidas");
    assert.equal(report.cameras.declared, construido.views);
    assert.equal(report.cameras.withImage, construido.views, "las ocho cámaras resuelven su imagen");
    assert.equal(report.scale.status, "UNKNOWN");
    assert.equal(report.scale.claimsAbsolutePrecision, false, "sin escala no se promete precisión");

    console.log(
      `productor: ok (colmap-v1 entra y sale COMPLETE + PASS con salida 0: ${construido.views} vistas, ` +
        `${construido.points} puntos, ${report.evidence.artifacts.length} artifacts, escala UNKNOWN)`,
    );
  }

  // 3. Las dos conversiones, independientes, sobre los mismos ficheros.
  {
    const model = parseColmapModel({
      cameras: readFileSync(join(escena, "cameras.txt"), "utf8"),
      images: readFileSync(join(escena, "images.txt"), "utf8"),
      points: readFileSync(join(escena, "points3D.txt"), "utf8"),
    });
    const nuestras = new Map(toCameraSet(model, new Map()).map((camera) => [camera.id, camera]));
    const manifest = JSON.parse(readFileSync(join(destino, "manifest.json"), "utf8"));

    let peorPose = 0;
    for (const suya of manifest.cameras) {
      const nuestra = nuestras.get(suya.id);
      assert.ok(nuestra !== undefined, `${suya.id}: el adaptador no la conoce`);
      // La pose, número a número. Es donde un cuaternión mal ordenado o una
      // inversión general en vez de rígida se vería, y las dos la calculan por su
      // cuenta desde el mismo texto.
      for (let slot = 0; slot < 16; slot += 1) {
        peorPose = Math.max(peorPose, Math.abs(suya.worldFromCamera[slot] - nuestra.worldFromCamera[slot]));
      }
      assert.deepEqual(suya.intrinsics, nuestra.intrinsics, `${suya.id}: intrínsecos distintos`);
      assert.deepEqual(suya.distortion ?? null, nuestra.distortion ?? null, `${suya.id}: distorsión distinta`);
      assert.equal(suya.cameraAxes, nuestra.cameraAxes);
      assert.equal(suya.model, nuestra.model);
    }
    // Exacto: las dos hacen la misma aritmética en el mismo orden sobre los
    // mismos decimales. Una tolerancia aquí escondería una divergencia real.
    assert.equal(peorPose, 0, `las dos conversiones difieren en la pose hasta ${peorPose}`);

    console.log(
      `productor: ok (las ${manifest.cameras.length} cámaras del productor coinciden con las del ` +
        "adaptador: pose exacta a 0, y los mismos intrínsecos, distorsión, modelo y marco)",
    );
  }

  // 4. Y las poses del paquete reproyectan lo que el fichero observó.
  {
    const manifest = JSON.parse(readFileSync(join(destino, "manifest.json"), "utf8"));
    const model = parseColmapModel({
      cameras: readFileSync(join(escena, "cameras.txt"), "utf8"),
      images: readFileSync(join(escena, "images.txt"), "utf8"),
      points: readFileSync(join(escena, "points3D.txt"), "utf8"),
    });
    const posiciones = new Map(model.points.map((point) => [point.id, point.position]));
    const porId = new Map(manifest.cameras.map((camera) => [camera.id, camera]));

    let comprobadas = 0;
    let peor = 0;
    for (const image of model.images) {
      const camera = porId.get(`img-${image.id}`);
      if (camera === undefined) continue;
      for (const observation of image.observations) {
        if (observation.pointId === null) continue;
        const position = posiciones.get(observation.pointId);
        if (position === undefined) continue;
        const proyectado = projectPoint(camera, position);
        peor = Math.max(peor, Math.hypot(proyectado.x - observation.x, proyectado.y - observation.y));
        comprobadas += 1;
      }
    }
    // El error de reproyección de una reconstrucción real: unos píxeles como
    // mucho. Lo que se vigila no es que sea cero —sería sospechoso— sino que no
    // se dispare, que es lo que haría una convención equivocada.
    assert.ok(comprobadas > 10_000, `solo ${comprobadas} observaciones comprobadas`);
    assert.ok(peor < 25, `el peor error de reproyección es ${peor} píxeles`);

    console.log(
      `productor: ok (${comprobadas} observaciones reproyectadas con las poses del paquete, peor ` +
        `error ${peor.toFixed(2)} px sobre una rejilla de 3072×2304)`,
    );
  }

  // 5. Determinismo: dos construcciones, el mismo byte.
  {
    const otro = join(sandbox, "colmap-v1-otra-vez");
    buildColmapPackage(escena, otro);
    for (const nombre of ["manifest.json", "puntos.ply"]) {
      assert.equal(
        readFileSync(join(destino, nombre), "utf8"),
        readFileSync(join(otro, nombre), "utf8"),
        `${nombre}: dos construcciones dan ficheros distintos`,
      );
    }
    console.log("productor: ok (dos construcciones dan el mismo manifest y la misma nube, byte a byte)");
  }

  rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  "productor: no ejecutada — R0-B pide además las tres comparaciones de D23 contra valores dorados, " +
    "y el paquete de arriba no declara malla, así que las de recuentos y caja no tienen qué comparar. " +
    "Llegan con un productor que entregue superficie",
);
