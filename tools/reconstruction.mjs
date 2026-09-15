/**
 * `reconstruction inspect`: el recorrido de R0-A, de la ruta del manifest al
 * informe.
 *
 *   npm run reconstruction -- inspect artifacts/cube-v1/manifest.json
 *   npm run reconstruction -- inspect <ruta> --out informe.json
 *
 * Es el subcomando nuevo de D13, así que estrena su tabla de códigos de salida y
 * **no toca la de los comandos existentes**:
 *
 * ```text
 * 0   COMPLETE + PASS           20  paquete inválido
 * 1   COMPLETE + FAIL           21  contrato no soportado
 * 11  COMPLETE + INCONCLUSIVE   22  formato no soportado
 * 2   error de datos o de uso
 * ```
 *
 * El código de salida es una proyección para shell y CI: **la autoridad semántica
 * es el JSON**, con sus dos ejes. Un script que decida por el número está leyendo
 * un resumen, no el informe.
 *
 * Aquí vive todo el IO —leer el manifest, resolver rutas, hashear, abrir los
 * PLY— y ni una decisión: qué se rechaza lo dice `ingest.ts` y qué se certifica
 * lo dice `report.ts`, los dos sin tocar disco. La frontera entre este fichero y
 * esos dos es la que permite probar el escape por symlink sin un symlink.
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ancho y alto de una imagen, **sin decodificarla**.
 *
 * D33 pide comparar las dimensiones que declara la cámara con la rejilla real, y
 * para eso no hacen falta los píxeles: hacen falta dos números que viven en la
 * cabecera. Antes esto llamaba a `decodePng`, que descomprime la imagen entera
 * para leer dos enteros — y además **no sabía leer JPEG**, así que cualquier
 * paquete de fotogrametría real salía UNSUPPORTED por sus propias fotos.
 *
 * PNG los pone en el IHDR, siempre en el mismo sitio. JPEG los lleva en el
 * marcador SOF, que hay que buscar saltando segmentos: es el formato el que
 * obliga, no el lector.
 */
export function imageGrid(bytes) {
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // Los SOF llevan las dimensiones. Se excluyen 0xC4, 0xC8 y 0xCC porque
      // comparten el rango y no son SOF: son tablas de Huffman y extensiones.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  throw new Error("IMAGEN_NO_SOPORTADA: no es un PNG ni un JPEG con cabecera legible");
}
import {
  MASK_EXTENSION,
  compareCandidates,
  PACKAGE_CODES,
  PACKAGE_CODE_TABLE,
  RESOURCE_LIMITS,
  RESOURCE_LIMIT_REASONS,
  DEFAULT_SURFACE_SAMPLES,
  auditMesh,
  buildReconstructionReport,
  computeVisibility,
  ingestPackage,
  maskMismatch,
  parsePly,
} from "../dist-node/agent3d.mjs";
import { decodePng } from "./agent3d.mjs";
import { openVisibilityCache, visibilityKey } from "./reconCache.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;

/** Lector de paquete sobre el sistema de ficheros de verdad. */
export function packageReader(root) {
  return {
    root,
    stat: (path) => {
      try {
        const real = realpathSync(join(root, path));
        return {
          realPath: real,
          bytes: statSync(real).size,
          sha256: createHash("sha256").update(readFileSync(real)).digest("hex"),
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Recorre un paquete y devuelve su informe.
 *
 * Las mallas se leen **solo si la ingesta las admitió**: abrir un fichero cuyo
 * hash no cuadra es exactamente lo que D7 prohíbe, y hacerlo «para dar mejor
 * diagnóstico» es como se acaba midiendo geometría que no es la que el paquete
 * declara.
 */
/** Hashes de esquema aceptados, del registro generado (D16). */
function schemaHashes() {
  try {
    const registry = JSON.parse(readFileSync(resolve(projectRoot, "contracts/registry.json"), "utf8"));
    return registry.schemas.map((entry) => entry.sha256);
  } catch {
    // Sin registro no se comprueba nada, y se dice: callar aquí convertiría un
    // fichero que falta en una comprobación que parece hecha.
    return undefined;
  }
}

export function inspectPackage(manifestPath, { samples, cache = true, cacheRoot } = {}) {
  // El primer fichero que se lee sin haber comprobado nada. Antes de `readFileSync`
  // y no después: después ya está en memoria, que es lo que el tope evita.
  const manifestBytes = statSync(manifestPath).size;
  if (manifestBytes > RESOURCE_LIMITS.manifestBytes.value) {
    return {
      report: null,
      exitCode: 23,
      fatal:
        `el manifest ocupa ${manifestBytes} bytes y el tope son ${RESOURCE_LIMITS.manifestBytes.value} ` +
        `(${PACKAGE_CODES.MANIFIESTO_DEMASIADO_GRANDE})`,
    };
  }
  const raw = readFileSync(manifestPath);
  const root = realpathSync(dirname(manifestPath));
  const manifestSha256 = createHash("sha256").update(raw).digest("hex");

  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    // Un manifest que ni siquiera es JSON no llega al validador de esquema: no hay
    // documento sobre el que decir qué campo falla.
    return {
      report: null,
      exitCode: 20,
      fatal: `el manifest no es JSON válido: ${error.message}`,
    };
  }

  const ingest = ingestPackage(manifest, packageReader(root), { schemaHashes: schemaHashes() });

  const meshes = [];
  for (const artifact of ingest.artifacts) {
    if (artifact.type !== "TRIANGLE_MESH") continue;
    let mesh = null;
    try {
      // Por bytes y no por texto: `parsePly` elige por lo que el fichero declara,
      // y decodificar un `dense.ply` binario de 150 MB como si fuera UTF-8 sería
      // pagar el coste que el lector binario existe para ahorrar — cuando no
      // desbordar la cadena directamente.
      mesh = parsePly(readFileSync(artifact.realPath)).mesh;
    } catch (error) {
      // Un formato que no sabemos leer no es un paquete inválido ni una malla
      // mala: es trabajo que no se puede hacer. Se marca UNSUPPORTED y el código
      // de salida lo distingue de «el contrato no lo leo».
      //
      // El `reason` sale de la tabla y no se escribe aquí: escrito a mano decía
      // `ARTEFACTO_ILEGIBLE` con el identificador de «el hash no cuadra», que es
      // lo que el otro lado parsea. Un dato, un dueño.
      const code = plyErrorCode(String(error.message));
      ingest.issues.push({
        code,
        reason: PACKAGE_CODE_TABLE[code].reason,
        message: `artifact ${artifact.id}: ${error.message}`,
      });
      ingest.execution = code === PACKAGE_CODES.FORMATO_NO_SOPORTADO ? "UNSUPPORTED" : "ERROR";
      continue;
    }
    if (mesh === null) continue;
    meshes.push({
      artifactId: artifact.id,
      // La malla se guarda además de su auditoría: R6 la necesita para cruzarla
      // con las cámaras, y volver a leer el PLY costaría lo mismo dos veces.
      mesh: {
        ...mesh,
        normals: new Float32Array(0),
        uvs: new Float32Array(0),
        boundingRadius: 0,
      },
      audit: auditMesh({
        ...mesh,
        // La auditoría de normales no aplica: un PLY de posiciones y caras no las
        // trae, y promediarlas aquí sería inventar la evidencia que se mide.
        normals: new Float32Array(0),
        uvs: new Float32Array(0),
        boundingRadius: 0,
      }),
    });
  }

  // D33: las dimensiones de la cámara describen **la rejilla real**, no una
  // rotación EXIF pendiente. Se comprueba abriendo la imagen, que es lo único
  // que lo puede desmentir, y por eso vive aquí y no en `ingest.ts`: allí no hay
  // IO. Una cámara que declare 4032×3024 sobre una imagen de 3024×4032 tiene los
  // intrínsecos girados, y el error no se ve en la miniatura.
  const imagePath = new Map(
    ingest.artifacts.filter((artifact) => artifact.type === "IMAGE").map((a) => [a.id, a.realPath]),
  );
  for (const camera of manifest.cameras ?? []) {
    const path = imagePath.get(camera.imageArtifactId);
    if (path === undefined) continue;
    let grid = null;
    try {
      grid = imageGrid(readFileSync(path));
    } catch {
      // Un formato de imagen que no sabemos abrir no es una cámara mal
      // declarada: se dice por su nombre y se sigue, igual que con el PLY.
      ingest.issues.push({
        code: PACKAGE_CODES.FORMATO_NO_SOPORTADO,
        reason: PACKAGE_CODE_TABLE[PACKAGE_CODES.FORMATO_NO_SOPORTADO].reason,
        message: `cámara ${camera.id}: ${camera.imageArtifactId} no se puede abrir para comprobar su rejilla`,
      });
      ingest.execution = "UNSUPPORTED";
      continue;
    }
    if (grid.width !== camera.width || grid.height !== camera.height) {
      ingest.issues.push({
        code: PACKAGE_CODES.REJILLA_NO_COINCIDE,
        reason: PACKAGE_CODE_TABLE[PACKAGE_CODES.REJILLA_NO_COINCIDE].reason,
        message:
          `cámara ${camera.id}: declara ${camera.width}×${camera.height} y la imagen es ` +
          `${grid.width}×${grid.height}`,
      });
      ingest.execution = "ERROR";
    }
  }

  // Las siluetas, que aquí sí se abren. La ingesta ya comprobó el reparto —qué
  // cámara y qué artifact—, y lo que falta es lo que exige decodificar: que la
  // máscara describa **este** encuadre. Una que no lo haga no se aplica y se
  // dice, porque medir con media silueta daría un número que nadie podría
  // interpretar y que nada delataría.
  const masks = loadMasks(manifest, ingest);

  // La superficie que se cruza con las cámaras (R6). La primera malla admitida y
  // el CameraSet: si el paquete trae varias, cruzar la primera y callar las demás
  // sería peor que no cruzar ninguna, así que se dice cuál.
  const primeraMalla = meshes[0];
  const surface =
    primeraMalla === undefined || (manifest.cameras ?? []).length === 0
      ? undefined
      : {
          mesh: primeraMalla.mesh,
          cameras: manifest.cameras,
          purelyReconstructed:
            (manifest.artifacts ?? []).find((artifact) => artifact.id === primeraMalla.artifactId)
              ?.purelyReconstructed === true,
          samples: samples,
          masks,
        };

  // La visibilidad, si ya estaba medida sobre exactamente estos bytes (§55). La
  // caché vive aquí y no en `src/`: el módulo que mide no toca disco, y lo que
  // decide si un resultado guardado vale es política de quien lee el paquete.
  const visibilityCache = openVisibilityCache({
    enabled: cache,
    // `cacheRoot` existe para las puertas: usar la del repositorio mezclaría
    // entradas de otras ejecuciones y el recuento de aciertos dejaría de
    // significar nada. Omitirlo es el caso normal.
    ...(cacheRoot === undefined ? {} : { root: cacheRoot }),
  });
  if (surface !== undefined) {
    const parametros = {
      mesh: surface.mesh,
      cameras: surface.cameras,
      masks: surface.masks,
      samples: surface.samples ?? DEFAULT_SURFACE_SAMPLES,
      seed: 1,
    };
    const key = visibilityKey(parametros);
    // Se mide **aquí** y se pasa hecha, en vez de dejar que el informe la mida y
    // pedírsela luego: publicarla en el informe para poder guardarla sería meter
    // 400 KB de muestreo en un documento que cruza una frontera, y quien lo lee
    // no tiene nada que hacer con ellos.
    surface.visibility =
      visibilityCache.get(key) ??
      computeVisibility(surface.mesh, surface.cameras, {
        samples: parametros.samples,
        masks: surface.masks,
      });
    if (visibilityCache.stats.hits === 0) visibilityCache.set(key, surface.visibility);
  }

  const report = buildReconstructionReport({
    manifest,
    manifestSha256,
    ingest,
    meshes,
    softsightVersion: version,
    surface,
  });

  return { report, exitCode: exitCodeForReport(report), fatal: null, cacheStats: visibilityCache.stats };

  return { report, exitCode: exitCodeForReport(report), fatal: null };
}

/**
 * Qué identificador le toca a un fallo del lector de PLY.
 *
 * Por el prefijo del mensaje, que el lector escribe a propósito: es la única
 * información que cruza la frontera de una excepción, y convertirla en código
 * aquí deja al lector sin saber nada de la tabla de la frontera.
 */
function plyErrorCode(message) {
  if (message.startsWith("FORMATO_PLY_NO_SOPORTADO")) return PACKAGE_CODES.FORMATO_NO_SOPORTADO;
  if (message.startsWith("CABECERA_PLY_DEMASIADO_LARGA")) return PACKAGE_CODES.CABECERA_PLY_DEMASIADO_LARGA;
  if (message.startsWith("ELEMENTO_PLY_SOBRE_EL_TOPE")) return PACKAGE_CODES.ELEMENTO_PLY_SOBRE_EL_TOPE;
  if (message.startsWith("PLY_TRUNCADO")) return PACKAGE_CODES.PLY_TRUNCADO;
  return PACKAGE_CODES.ARTEFACTO_ILEGIBLE;
}

/**
 * El informe para una persona, derivado del mismo objeto que sale por stdout.
 *
 * R7 pide «informe de máquina **y** de persona a partir de un solo paquete», y la
 * trampa está en el «a partir de un solo». Escribir el texto por su cuenta sería
 * un segundo original del veredicto: el día que los dos discrepen, el que se lea
 * será el bonito. Aquí todo sale del JSON ya construido — si un campo no está en
 * el informe, tampoco aparece abajo.
 */
/**
 * Las siluetas declaradas por la extensión, abiertas y comprobadas.
 *
 * El canal lo decide el tipo de PNG y no una heurística: **un gris es la propia
 * máscara** —lo que un segmentador escribe cuando escribe una máscara— y **un
 * RGBA es un recorte**, donde lo que dice qué es pieza es el alfa. Adivinarlo
 * mirando los datos fallaría justo en los casos raros: una máscara toda blanca y
 * un recorte todo opaco son indistinguibles por contenido.
 *
 * Lo que no se puede aplicar se cuenta como incidencia con `MASCARA_NO_APLICABLE`
 * y se deja fuera. El resto se aplica igual: una silueta rota no es motivo para
 * tirar las que sí están.
 */
function loadMasks(manifest, ingest) {
  const entry = (manifest.extensions ?? {})[MASK_EXTENSION];
  if (entry === undefined) return undefined;

  const rutas = new Map(ingest.artifacts.map((artifact) => [artifact.id, artifact.realPath]));
  const camaras = new Map((manifest.cameras ?? []).map((camera) => [camera.id, camera]));
  const masks = new Map();
  const fallo = (mensaje) => {
    ingest.issues.push({
      code: PACKAGE_CODES.MASCARA_NO_APLICABLE,
      reason: PACKAGE_CODE_TABLE[PACKAGE_CODES.MASCARA_NO_APLICABLE].reason,
      message: mensaje,
    });
  };

  for (const [cameraId, artifactId] of Object.entries(entry.data?.porCamara ?? {})) {
    const camera = camaras.get(cameraId);
    const ruta = rutas.get(artifactId);
    // La ingesta ya avisó de los dos casos: aquí solo se salta.
    if (camera === undefined || ruta === undefined) continue;

    let png = null;
    try {
      png = decodePng(readFileSync(ruta));
    } catch (error) {
      fallo(`cámara ${cameraId}: su máscara ${artifactId} no se puede abrir (${error.message})`);
      continue;
    }
    const canal = png.colorType === 0 ? 0 : 3;
    const coverage = new Uint8Array(png.width * png.height);
    for (let index = 0; index < coverage.length; index += 1) {
      coverage[index] = png.pixels[index * 4 + canal];
    }
    const mask = { width: png.width, height: png.height, coverage };

    const problema = maskMismatch(mask, camera);
    if (problema !== null) {
      fallo(
        `cámara ${cameraId}: su máscara ${artifactId} es ${png.width}×${png.height} sobre una imagen ` +
          `de ${camera.width}×${camera.height} (${problema})`,
      );
      continue;
    }
    masks.set(cameraId, mask);
  }
  return masks.size === 0 ? undefined : masks;
}

/**
 * Varios paquetes, un cruce. R9: «VideoMesh manda varios candidatos y recibe
 * informes comparables».
 *
 * Cada uno se consume por su cuenta y con el mismo camino de siempre —el cruce no
 * puede tener su propia forma de medir, o los dos informes dejarían de ser los que
 * el productor recibiría por separado—. Lo único que añade esto es la comparación.
 */
export function comparePackages(paths) {
  const informes = paths.map((path) => inspectPackage(path).report);
  const comparison = compareCandidates(informes);
  // Salida 1 cuando ninguno domina: no es un error del binario, es que la
  // pregunta «¿cuál me llevo?» no tiene respuesta desde aquí, y un cero invitaría
  // a leer el primero de la lista como el ganador.
  return { comparison, reports: informes, exitCode: comparison.verdict === null ? 1 : 0 };
}

/** El cruce para una persona, derivado del mismo objeto. */
export function renderComparison(comparison) {
  const lineas = [];
  lineas.push(
    comparison.verdict === null
      ? `sin ganador — ${comparison.reason}`
      : `gana ${comparison.verdict}: mejor en todos los criterios que se pudieron decidir`,
  );
  lineas.push("");
  lineas.push(`candidatos  ${comparison.compared.join(", ") || "ninguno"}`);
  for (const fuera of comparison.excluded) {
    lineas.push(`  fuera     ${fuera.candidate} · ${fuera.reason}`);
  }
  lineas.push("");
  for (const criterio of comparison.criteria) {
    const flecha = criterio.direction === "MAYOR_MEJOR" ? "↑" : "↓";
    lineas.push(
      `${criterio.name} ${flecha}  ${criterio.best ?? `sin decidir (${criterio.reason})`}`,
    );
    for (const valor of criterio.values) {
      // El intervalo **al lado del valor** y no en una nota: es lo que impide
      // leer 0,727 contra 0,731 como una diferencia.
      const rango =
        valor.interval === undefined
          ? ""
          : ` (${valor.interval[0].toFixed(4)}–${valor.interval[1].toFixed(4)})`;
      lineas.push(`    ${valor.candidate}  ${valor.value}${rango}`);
    }
  }
  return `${lineas.join("\n")}\n`;
}

export function renderHuman(report) {
  const pct = (value) => `${(value * 100).toFixed(1)} %`;
  const lineas = [];
  const veredicto = report.certification === "PASS" ? "PASA" : report.certification;
  lineas.push(`${report.run.inputPackageId ?? "paquete"} — ${report.execution} · ${veredicto}`);
  if (report.certificationReason) lineas.push(`  motivo: ${report.certificationReason}`);
  lineas.push("");

  lineas.push(`evidencia   ${report.evidence.artifacts.length} artifacts` +
    (report.evidence.missingEvidence.length > 0
      ? `, falta ${report.evidence.missingEvidence.join(", ")}`
      : ""));
  lineas.push(`cámaras     ${report.cameras.declared} declaradas, ${report.cameras.withImage} con imagen`);
  lineas.push(
    `escala      ${report.scale.status}` +
      (report.scale.claimsAbsolutePrecision ? " · promete precisión absoluta" : " · sin precisión absoluta") +
      (report.scale.boundingBoxDiagonal === null
        ? ""
        : ` · diagonal ${report.scale.boundingBoxDiagonal.toFixed(4)}`),
  );

  for (const measurement of report.measurements) {
    lineas.push(
      `malla       ${measurement.appliesTo.artifactId}: ${measurement.triangles} triángulos, ` +
        `${measurement.boundaryEdges} aristas de borde, ` +
        `${measurement.watertight ? "cerrada" : "abierta"}` +
        (measurement.purelyReconstructed ? "" : " · no puramente reconstruida"),
    );
  }

  if (report.coverage) {
    const c = report.coverage;
    lineas.push("");
    // El intervalo va **al lado del ratio y no en una nota**: es lo que impide
    // leer «49,4 %» como un número exacto, que es justo lo que un texto invita a
    // hacer (§86.3 k).
    lineas.push(
      `cobertura   ${pct(c.observedAreaRatio)} observada ` +
        `(${pct(c.interval[0])}–${pct(c.interval[1])}, ${c.samples} muestras por área)`,
    );
    lineas.push(`            ${pct(c.unobservedAreaRatio)} sin ver · ${pct(c.weakAreaRatio)} sin triangular`);
    // Con siluetas y sin ellas se miden cosas distintas, y el número solo no lo
    // dice. Sin ninguna se escribe también: el silencio se leería como que las
    // había.
    lineas.push(
      c.maskedCameras > 0
        ? `            siluetas aplicadas en ${c.maskedCameras} de ${report.cameras.declared} cámaras`
        : "            sin siluetas: lo que proyecta sobre el fondo cuenta como visto",
    );
    if (!c.certificationEligible) lineas.push(`            no certifica: ${c.reason}`);
  }
  if (report.confidence) {
    const f = report.confidence;
    lineas.push(
      `confianza   ${pct(f.byClass.SOSTENIDA)} sostenida · ${pct(f.byClass.PARALAJE_CORTO)} con paralaje ` +
        `corto (suelo ${f.parallaxThresholdDegrees}°)`,
    );
    if (f.parallaxDegrees) {
      lineas.push(
        `            paralaje p05 ${f.parallaxDegrees.p05.toFixed(1)}° · mediana ` +
          `${f.parallaxDegrees.median.toFixed(1)}° · p95 ${f.parallaxDegrees.p95.toFixed(1)}°`,
      );
    }
  }

  if (report.repairBoundary) {
    const r = report.repairBoundary;
    lineas.push("");
    lineas.push(
      `reparación  ${r.byRisk.SAFE} seguras · ${r.byRisk.REVIEW} a revisar · ${r.byRisk.UNSAFE} ` +
        `inseguras` + (r.evidenceAware ? "" : " · sin cruzar con cámaras"),
    );
    // **Las inseguras primero**, y no por orden de descubrimiento: son las que
    // crean superficie que ninguna foto puede desmentir, y una lista cronológica
    // las entierra entre agujeros grandes e inofensivos.
    const orden = { UNSAFE: 0, REVIEW: 1, SAFE: 2 };
    const ordenadas = [...r.repairs].sort((a, b) => orden[a.risk] - orden[b.risk]);
    for (const reparacion of ordenadas.slice(0, 8)) {
      const marca = reparacion.breaksPurelyReconstructed ? " · deja de certificar" : "";
      lineas.push(`  ${reparacion.risk}  ${reparacion.repair} · ${reparacion.reason}${marca}`);
    }
    if (ordenadas.length > 8) lineas.push(`  … y ${ordenadas.length - 8} más en el informe`);
    if (r.omittedLoops > 0) {
      lineas.push(`  … y ${r.omittedLoops} agujeros más que no caben, contados arriba`);
    }
  }

  if (report.budgets.length > 0) {
    lineas.push("");
    lineas.push(`presupuestos ${report.budgets.length} declarados`);
    for (const budget of report.budgets) {
      const limite =
        budget.units === "RELATIVE_TO_DIAGONAL"
          ? `${budget.max} de diagonal`
          : `${budget.max}${budget.unit ? ` ${budget.unit}` : ""}`;
      // Lo medido **al lado del límite**: un veredicto sin el número obliga a
      // recalcularlo para saber si se pasó por poco o por diez veces.
      const medido = budget.observed === undefined ? "sin medir" : `${budget.observed}`;
      lineas.push(
        `  ${budget.name}  ${medido} de ${limite} · ${budget.verdict}` +
          (budget.reason ? ` (${budget.reason})` : ""),
      );
    }
  }

  if (report.captureAdvice && report.captureAdvice.suggestions.length > 0) {
    const a = report.captureAdvice;
    lineas.push("");
    lineas.push(
      `próximas    ${a.suggestions.length} fotos cubren el ${pct(a.coversDeficit)} de lo que falta`,
    );
    for (const s of a.suggestions) {
      const ojo = [3, 7, 11].map((slot) => s.camera.worldFromCamera[slot].toFixed(2)).join(", ");
      // La posición, y **lo que esa foto añade sobre las anteriores**: la lista es
      // un plan en orden, y dar la ganancia contra el estado de hoy invitaría a
      // sumarlas, que contaría dos veces la región que dos fotos recuperan.
      const mas = (value) => `+${(value * 100).toFixed(1)}`;
      lineas.push(
        `  ${s.camera.id}  desde (${ojo}) · ${mas(s.gain.deltaObserved)} vista ` +
          `${mas(s.gain.deltaTriangulated)} triangulada ${mas(s.gain.deltaSupported)} sostenida ` +
          `→ ${pct(s.gain.observedAreaRatio)} vista y ${pct(s.gain.supportedAreaRatio)} sostenida`,
      );
    }
  }

  if (report.warnings.length > 0) {
    lineas.push("");
    lineas.push(`avisos      ${report.warnings.length}`);
    for (const warning of report.warnings) lineas.push(`  ${warning.code}  ${warning.message}`);
  }
  return `${lineas.join("\n")}\n`;
}

/** La proyección de D13, con los dos ejes decidiendo juntos. */
/**
 * El informe recortado a la pregunta de la cobertura — §69, proyección.
 *
 * No recalcula nada: **es el mismo informe con menos campos**. Un comando que
 * volviera a medir tendría su propia semilla y su propio muestreo, y dos números
 * distintos para la misma pregunta es exactamente lo que D1 prohíbe.
 *
 * Lo que sí lleva además de los dos bloques es la cabecera mínima para saber de
 * qué paquete habla y con qué contrato: un bloque de cobertura suelto no se
 * puede archivar ni comparar, y quien lo reciba acabaría volviendo a pedir el
 * informe entero.
 */
export function projectCoverage(report) {
  return {
    documentType: report.documentType,
    contractVersion: report.contractVersion,
    // `versions` va entero y no recortado: D12 dice que el consumidor comprueba
    // **la combinación**, así que un recorte que se llevara solo la suya dejaría
    // sin comprobar lo único que hay que comprobar.
    versions: report.versions,
    run: report.run,
    execution: report.execution,
    certification: report.certification,
    ...(report.certificationReason === undefined ? {} : { certificationReason: report.certificationReason }),
    // Ausente y no a cero cuando no hay superficie que cubrir: sin malla la
    // pregunta no se puede hacer, y un cero diría que no se ve nada.
    ...(report.coverage === undefined ? {} : { coverage: report.coverage }),
    ...(report.confidence === undefined ? {} : { confidence: report.confidence }),
    warnings: report.warnings.filter((warning) => warning.code.startsWith("SS-COV-")),
  };
}

export function exitCodeForReport(report) {
  // El 23 por delante de todo lo demás: un paquete que no cabe puede ser
  // impecable, y confundirlo con uno inválido manda al productor a arreglar lo
  // que no está roto.
  if (report.warnings.some((entry) => RESOURCE_LIMIT_REASONS.includes(entry.reason))) return 23;
  if (report.execution === "UNSUPPORTED") {
    return report.warnings.some((entry) => entry.reason === "FORMATO_NO_SOPORTADO") ? 22 : 21;
  }
  if (report.execution !== "COMPLETE") return 20;
  if (report.certification === "PASS") return 0;
  if (report.certification === "FAIL") return 1;
  return 11;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, target, ...rest] = process.argv.slice(2);
  if (command === "compare") {
    const humano = rest.includes("--human") || process.argv.includes("--human");
    const rutas = [target, ...rest].filter((entrada) => entrada !== undefined && !entrada.startsWith("--"));
    if (rutas.length < 2) {
      process.stderr.write(
        "uso: node tools/reconstruction.mjs compare <manifest.json> <manifest.json> [...] [--human]\n",
      );
      process.exit(2);
    }
    const { comparison, exitCode } = comparePackages(rutas.map((ruta) => resolve(ruta)));
    process.stdout.write(
      humano ? renderComparison(comparison) : `${JSON.stringify(comparison, null, 2)}\n`,
    );
    process.exit(exitCode);
  }
  if (command !== "inspect" || target === undefined) {
    process.stderr.write(
      "uso: node tools/reconstruction.mjs inspect <manifest.json> [--out informe.json] [--human] [--no-cache]\n" +
        "     node tools/reconstruction.mjs compare <a.json> <b.json> [...] [--human]\n" +
        "  --human     el mismo informe para una persona, derivado del JSON y no escrito aparte\n" +
        "  --no-cache  vuelve a medir la visibilidad aunque esté guardada para estos mismos bytes\n",
    );
    process.exit(2);
  }

  // `--no-cache` como en el CLI de modelos: la invalidación manda, y quien
  // sospecha de una medida guardada tiene que poder pedir que se vuelva a medir
  // sin borrar nada a mano.
  const { report, exitCode, fatal } = inspectPackage(resolve(target), {
    cache: !rest.includes("--no-cache"),
  });
  if (fatal !== null) {
    process.stderr.write(`${fatal}\n`);
    process.exit(exitCode);
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const outIndex = rest.indexOf("--out");
  if (outIndex >= 0) writeFileSync(resolve(rest[outIndex + 1]), json);
  // Con `--human` sale el texto **y nada más**: mezclarlo con el JSON obligaría a
  // quien automatiza a recortar, y quien lee no quiere el JSON.
  if (rest.includes("--human")) process.stdout.write(renderHuman(report));
  else if (outIndex < 0) process.stdout.write(json);
  process.exit(exitCode);
}
