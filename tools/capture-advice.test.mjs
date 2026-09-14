/**
 * Puerta de R9 — desde dónde disparar la próxima foto.
 *
 * ## El bloque 1 es la puerta entera
 *
 * Todo lo demás es contexto. Lo que hace que un consejo valga algo es que su
 * ganancia **no es una estimación**: se mete la cámara devuelta en el CameraSet,
 * se vuelve a contar con la misma aritmética que juzgará el resultado, y el
 * número tiene que salir **idéntico**. Y no solo al final: aplicando las `k`
 * primeras sugerencias, el ratio tiene que ser el que la `k`-ésima publicó,
 * porque la lista es un plan en orden y no un catálogo de alternativas.
 *
 * Un consejo que dijera «prueba por aquí, seguramente mejore» no se puede
 * verificar ni desmentir. Este se desmiente en una línea, y por eso se puede
 * creer.
 *
 * ## Y el bloque 6, que es el que caza el error silencioso
 *
 * Una cámara sugerida **no tiene imagen**: la foto todavía no existe. Copiar la
 * cámara de referencia entera arrastraba su `imageArtifactId` y su hash, y la
 * sugerencia decía ser la foto que ya estaba. El paquete habría validado y la
 * cobertura habría contado dos veces la misma vista.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PARALLAX_DEGREES,
  computeCaptureAdvice,
  computeConfidence,
  computeCoverage,
  computeVisibility,
  lookAtPose,
  parsePlyAscii,
  projectPoint,
} from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-consejo-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const leida = parsePlyAscii(readFileSync(join(raiz, "mesh.ply"), "utf8")).mesh;
const malla = { ...leida, normals: new Float32Array(0), uvs: new Float32Array(0), boundingRadius: 0 };
const CAMARAS = manifest.cameras;
const MUESTRAS = 8_000;

// 1. **La promesa se cumple, exacta y en cada paso.**
{
  const consejo = computeCaptureAdvice(malla, CAMARAS, { samples: MUESTRAS });
  assert.ok(consejo.suggestions.length > 0, "el cubo con cuatro vistas tiene carencias que cubrir");

  for (let k = 1; k <= consejo.suggestions.length; k += 1) {
    const conLasPrimeras = [...CAMARAS, ...consejo.suggestions.slice(0, k).map((s) => s.camera)];
    const medido = computeCoverage(malla, conLasPrimeras, { samples: MUESTRAS });
    const prometido = consejo.suggestions[k - 1].gain;
    // Exacto, sin tolerancia: son cocientes de enteros contados sobre las mismas
    // muestras. Una tolerancia aquí escondería que el consejo promete de más.
    assert.equal(
      medido.observedAreaRatio,
      prometido.observedAreaRatio,
      `con las ${k} primeras, medido ${medido.observedAreaRatio} y prometido ${prometido.observedAreaRatio}`,
    );
    assert.equal(medido.triangulatedAreaRatio, prometido.triangulatedAreaRatio, `triangulada tras ${k}`);
    // Y la tercera contra **otro módulo**: lo que el consejo llama sostenido
    // tiene que ser lo que la confianza llama SOSTENIDA. Son dos cuentas del
    // mismo ángulo escritas en sitios distintos, y cruzarlas es lo que impide que
    // una derive de la otra sin que nadie lo note.
    const confianza = computeConfidence(malla, conLasPrimeras, { samples: MUESTRAS });
    assert.equal(
      confianza.byClass.SOSTENIDA,
      prometido.supportedAreaRatio,
      `sostenida tras ${k}: la confianza dice ${confianza.byClass.SOSTENIDA} y el consejo ${prometido.supportedAreaRatio}`,
    );
  }

  const total = consejo.suggestions.at(-1).gain.observedAreaRatio;
  const hoy = computeCoverage(malla, CAMARAS, { samples: MUESTRAS }).observedAreaRatio;
  console.log(
    `consejo: ok (las ${consejo.suggestions.length} fotos llevan la cobertura de ` +
      `${(hoy * 100).toFixed(1)} % a ${(total * 100).toFixed(1)} %, y **cada prefijo del plan** mide ` +
      "exactamente lo que prometió)",
  );
}

// 2. La primera es la que más gana, y el orden es el de la ganancia medida.
//
// Sobre el cubo la respuesta se razona antes de medirla: cuatro vistas dejan tres
// caras sin ver, y **una sola vista desde la esquina opuesta las alcanza las
// tres**. Si el orden saliera del área de la región, esa vista no iría primera.
{
  const consejo = computeCaptureAdvice(malla, CAMARAS, { samples: MUESTRAS });
  const primera = consejo.suggestions[0];
  assert.ok(
    primera.gain.deltaObserved > 0.4,
    `la vista de la esquina opuesta tenía que ganar media superficie y gana ${primera.gain.deltaObserved}`,
  );
  assert.ok(
    primera.region.areaRatio < 0.1,
    "y su región es pequeña: por área no habría salido primera, que es lo que prueba que el orden es la ganancia",
  );
  for (let index = 1; index < consejo.suggestions.length; index += 1) {
    const antes = consejo.suggestions[index - 1].gain;
    const ahora = consejo.suggestions[index].gain;
    assert.ok(
      antes.deltaObserved > ahora.deltaObserved ||
        (antes.deltaObserved === ahora.deltaObserved && antes.deltaTriangulated >= ahora.deltaTriangulated),
      `la sugerencia ${index + 1} gana más que la ${index}`,
    );
    // Acumulado monótono: un plan que retrocediera no sería un plan.
    assert.ok(ahora.observedAreaRatio >= antes.observedAreaRatio);
  }
  // Y ninguna se cuela sin ganar nada.
  for (const sugerencia of consejo.suggestions) {
    assert.ok(
      sugerencia.gain.deltaObserved > 0 || sugerencia.gain.deltaTriangulated > 0,
      `${sugerencia.camera.id} no añade nada y aun así se propone`,
    );
  }

  console.log(
    `consejo: ok (la primera gana ${(primera.gain.deltaObserved * 100).toFixed(1)} % desde una región ` +
      `de solo ${(primera.region.areaRatio * 100).toFixed(1)} %: el orden lo pone la ganancia medida, ` +
      "no el tamaño de la carencia)",
  );
}

// 3. La pose mira de verdad a la región, en las dos convenciones.
//
// Se comprueba proyectando el centroide: tiene que caer en el punto principal y
// **delante**. Es lo que caza un eje invertido, que produce una pose que parece
// razonable y mira al lado contrario.
{
  const consejo = computeCaptureAdvice(malla, CAMARAS, { samples: MUESTRAS });
  for (const sugerencia of consejo.suggestions) {
    const proyectado = projectPoint(sugerencia.camera, sugerencia.region.centroid);
    assert.ok(proyectado.depth > 0, `${sugerencia.camera.id}: la región le queda detrás`);
    assert.ok(
      Math.abs(proyectado.x - sugerencia.camera.intrinsics.cx) < 1e-6 &&
        Math.abs(proyectado.y - sugerencia.camera.intrinsics.cy) < 1e-6,
      `${sugerencia.camera.id}: el centroide cae en (${proyectado.x}, ${proyectado.y}) y no en el centro`,
    );
  }

  // Y la otra convención, a mano: el mismo ojo y el mismo objetivo con los ejes
  // de visión tienen que dar también el centro. Sin esto, solo estaría probado el
  // marco que el cubo usa.
  const ojo = [3, -2, 5];
  const objetivo = [0, 0, 0];
  for (const axes of ["X_RIGHT_Y_UP_Z_BACKWARD", "X_RIGHT_Y_DOWN_Z_FORWARD"]) {
    const camera = {
      id: `prueba-${axes}`,
      width: 640,
      height: 480,
      pixelOrigin: "TOP_LEFT",
      pixelCenter: "CENTER",
      cameraAxes: axes,
      intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
      worldFromCamera: lookAtPose(ojo, objetivo, axes),
    };
    const proyectado = projectPoint(camera, objetivo);
    assert.ok(proyectado.depth > 0, `${axes}: el objetivo queda detrás`);
    assert.ok(Math.abs(proyectado.x - 320) < 1e-6 && Math.abs(proyectado.y - 240) < 1e-6, axes);
  }

  console.log(
    "consejo: ok (el centroide de cada región cae en el punto principal de su cámara y delante, y " +
      "`lookAtPose` acierta en las dos convenciones de ejes)",
  );
}

// 4. Lo que falta es **base**, y la base se deriva del ángulo que falta.
//
// El escenario tiene que ser uno donde **no falte evidencia**, porque si falta,
// el consejo correcto es ir a fotografiar lo que nadie vio, no separarse un poco
// en lo que ya se ve. Seis pares de cámaras casi gemelas, uno por cara: el cubo
// entero está observado, la cobertura da el 100 % triangulado, y **cada cara la
// ven solo dos cámaras a un grado de distancia**, así que su profundidad está
// prácticamente indeterminada.
{
  const pares = [];
  const direcciones = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  ];
  for (const [index, direccion] of direcciones.entries()) {
    const ojo = direccion.map((value) => value * 2.2);
    const base = {
      ...CAMARAS[0],
      id: `par-${index}-a`,
      imageArtifactId: undefined,
      worldFromCamera: lookAtPose(ojo, [0, 0, 0], CAMARAS[0].cameraAxes),
    };
    // La gemela: desplazada el 1 % de la distancia **de lado**, que es la primera
    // columna de la rotación —en 0, 4 y 8 porque la matriz va por filas—.
    const m = [...base.worldFromCamera];
    const paso = 2.2 * 0.01;
    m[3] += m[0] * paso;
    m[7] += m[4] * paso;
    m[11] += m[8] * paso;
    pares.push(base, { ...base, id: `par-${index}-b`, worldFromCamera: m });
  }

  const visibility = computeVisibility(malla, pares, { samples: MUESTRAS });
  const cobertura = computeCoverage(malla, pares, { visibility });
  assert.ok(
    cobertura.observedAreaRatio > 0.99,
    `seis caras con su par delante tenían que verse enteras y se ve ${cobertura.observedAreaRatio}`,
  );
  assert.ok(cobertura.triangulatedAreaRatio > 0.99, "y la cobertura las da todas por trianguladas");

  const consejo = computeCaptureAdvice(malla, pares, { visibility });
  assert.ok(consejo.suggestions.length > 0, "con todo a un grado de base tiene que pedirse separación");
  // **Ninguna de evidencia**: no falta ninguna. Es lo que separa este consejo de
  // «pon más cámaras».
  for (const sugerencia of consejo.suggestions) {
    assert.equal(
      sugerencia.reason,
      "PARALAJE_CORTO",
      `${sugerencia.camera.id} pide ${sugerencia.reason} y aquí no falta evidencia`,
    );
  }

  for (const sugerencia of consejo.suggestions) {
    // Ángulo entre la cámara propuesta y la que ya ve la región, desde la región.
    const ojoNuevo = [3, 7, 11].map((slot) => sugerencia.camera.worldFromCamera[slot]);
    const unitario = (a, b) => {
      const v = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const length = Math.hypot(...v) || 1;
      return v.map((value) => value / length);
    };
    const uno = unitario(ojoNuevo, sugerencia.region.centroid);
    let mejor = 0;
    for (const camera of pares) {
      const dos = unitario(
        [3, 7, 11].map((slot) => camera.worldFromCamera[slot]),
        sugerencia.region.centroid,
      );
      const grados =
        (Math.acos(Math.min(1, Math.max(-1, uno[0] * dos[0] + uno[1] * dos[1] + uno[2] * dos[2]))) *
          180) /
        Math.PI;
      mejor = Math.max(mejor, grados);
    }
    assert.ok(
      mejor >= DEFAULT_PARALLAX_DEGREES - 1e-9,
      `${sugerencia.camera.id} se separa ${mejor.toFixed(2)}° de la mejor y el suelo son ${DEFAULT_PARALLAX_DEGREES}°`,
    );
  }

  console.log(
    `consejo: ok (cubo observado al ${(cobertura.observedAreaRatio * 100).toFixed(1)} % por seis pares ` +
      `a un grado: las ${consejo.suggestions.length} sugerencias son **todas de base** y se separan ` +
      `hasta pasar los ${DEFAULT_PARALLAX_DEGREES}°, derivados de b = 2·d·tan(θ/2))`,
  );
}

// 5. Los extremos dicen su motivo en vez de devolver una lista vacía.
{
  const sinCamaras = computeCaptureAdvice(malla, [], { samples: 2_000 });
  assert.deepEqual(sinCamaras.suggestions, []);
  // Sin lente que copiar no hay consejo, y callarlo se leería como «no hace falta
  // nada», que es lo contrario de la verdad.
  assert.equal(sinCamaras.reason, "SIN_CAMARA_DE_REFERENCIA");

  // Con el plan ya ejecutado no queda carencia, y eso es otro motivo distinto.
  const primero = computeCaptureAdvice(malla, CAMARAS, { samples: MUESTRAS });
  const completo = [...CAMARAS, ...primero.suggestions.map((sugerencia) => sugerencia.camera)];
  const despues = computeCaptureAdvice(malla, completo, { samples: MUESTRAS });
  assert.equal(despues.suggestions.length, 0, JSON.stringify(despues.suggestions.map((s) => s.reason)));
  assert.equal(despues.reason, "SIN_CARENCIA_QUE_CUBRIR");

  console.log(
    "consejo: ok (sin cámaras dice SIN_CAMARA_DE_REFERENCIA y con el plan hecho dice " +
      "SIN_CARENCIA_QUE_CUBRIR: dos listas vacías que significan cosas opuestas)",
  );
}

// 6. **La cámara sugerida no tiene imagen.**
{
  const consejo = computeCaptureAdvice(malla, CAMARAS, { samples: 4_000 });
  for (const sugerencia of consejo.suggestions) {
    assert.equal(
      sugerencia.camera.imageArtifactId,
      undefined,
      `${sugerencia.camera.id} dice tener imagen, y la foto todavía no existe`,
    );
    assert.equal(sugerencia.camera.imageArtifactHash, undefined);
    // Y sí trae la lente, que es lo que la hace una cámara real y no un deseo.
    assert.deepEqual(sugerencia.camera.intrinsics, CAMARAS[0].intrinsics);
    assert.ok(CAMARAS.some((camera) => camera.id === sugerencia.intrinsicsFrom));
    assert.ok(sugerencia.distance > 0);
  }
  console.log(
    `consejo: ok (ninguna sugerencia se atribuye una imagen; los intrínsecos vienen de ` +
      `${consejo.suggestions[0].intrinsicsFrom} y se dice de dónde)`,
  );
}

// 7. Determinismo, y que la semilla decida.
{
  const uno = computeCaptureAdvice(malla, CAMARAS, { samples: 3_000, seed: 7 });
  const dos = computeCaptureAdvice(malla, CAMARAS, { samples: 3_000, seed: 7 });
  assert.equal(JSON.stringify(uno), JSON.stringify(dos), "dos consejos del mismo paquete difieren");
  const otro = computeCaptureAdvice(malla, CAMARAS, { samples: 3_000, seed: 8 });
  assert.notEqual(
    JSON.stringify(otro.suggestions[0].camera.worldFromCamera),
    JSON.stringify(uno.suggestions[0].camera.worldFromCamera),
    "la semilla no está decidiendo nada",
  );
  // **Lo que no cambia con la semilla es dónde acaba el plan.** Las sugerencias
  // sueltas sí se mueven, y tienen que hacerlo: las regiones salen del muestreo,
  // así que otro muestreo las agrupa por otro sitio y reparte la misma ganancia
  // entre fotos distintas. Exigir que cada foto valiera lo mismo sería exigir que
  // el muestreo no muestreara.
  assert.equal(
    otro.suggestions.at(-1).gain.observedAreaRatio,
    uno.suggestions.at(-1).gain.observedAreaRatio,
    "dos planos de la misma pieza tienen que dejarla igual de vista",
  );

  console.log(
    `consejo: ok (misma semilla, mismo plan carácter a carácter; con otra, otras poses y otro reparto ` +
      `—${(uno.suggestions[0].gain.deltaObserved * 100).toFixed(1)} % la primera contra ` +
      `${(otro.suggestions[0].gain.deltaObserved * 100).toFixed(1)} %— y el mismo destino: ` +
      `${(uno.suggestions.at(-1).gain.observedAreaRatio * 100).toFixed(1)} %)`,
  );
}

// 8. Y el consejo lee **la misma visibilidad** que la cobertura.
{
  const visibility = computeVisibility(malla, CAMARAS, { samples: MUESTRAS });
  const cobertura = computeCoverage(malla, CAMARAS, { visibility });
  const consejo = computeCaptureAdvice(malla, CAMARAS, { visibility });
  assert.equal(consejo.samples, cobertura.samples);
  // El punto de partida del plan **es** el número que el informe publica. Si el
  // consejo se calculara sobre otro muestreo, aconsejaría cubrir una carencia que
  // el informe no dice tener.
  // Se comparan **muestras y no ratios**: restar dos cocientes exactos no da un
  // cociente exacto en binario —0,493625 menos su delta sale 0,49362500000000004—
  // y por eso el informe publica el acumulado y el delta en vez de dejar que
  // quien lea los reste. La cuenta de muestras sí es entera.
  const primera = consejo.suggestions[0].gain;
  assert.equal(
    Math.round((primera.observedAreaRatio - primera.deltaObserved) * consejo.samples),
    Math.round(cobertura.observedAreaRatio * cobertura.samples),
  );

  console.log(
    "consejo: ok (el plan parte exactamente del ratio que publica la cobertura: las dos leen la " +
      "misma visibilidad)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "consejo: no ejecutada — **no planifica un vuelo**: no sabe de obstáculos, alcance, batería ni " +
    "espacio aéreo, y dos sugerencias pueden salir del mismo punto mirando a sitios distintos sin que " +
    "nada las funda. Dice «desde aquí verías esto»; decidir si se puede ir es de quien conoce el sitio",
);
