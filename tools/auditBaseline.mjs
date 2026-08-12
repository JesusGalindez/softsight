/**
 * Línea base de recursos de `auditMesh`, según D25 del contrato con VideoMesh.
 *
 * Orden no negociable: **línea base → perfil → cambio → medida**. Esto es lo
 * primero, y no toca `inspect.ts`: mide lo que hay hoy para que el número de
 * después de quitar los `Map` signifique algo.
 *
 * Tres cosas que la medida hace a propósito:
 *
 *   1. **Un proceso por medida.** El pico de RSS de la soldadura y el de las
 *      aristas se pisan si comparten proceso, y un desbordamiento de heap mata al
 *      proceso entero: aislado, mata solo su medida y el informe registra el
 *      desbordamiento en vez de perderse la ejecución completa.
 *   2. **Tiempo de CPU, no de pared.** Esta máquina tiene dos núcleos físicos y
 *      el reloj de pared entre dos medidas lejanas mide también lo que hacía el
 *      resto del sistema. `process.cpuUsage()` no.
 *   3. **RSS máximo muestreado desde el hilo principal** mientras el cálculo
 *      corre en un `Worker`: `auditMesh` bloquea su hilo de principio a fin, así
 *      que un temporizador en el mismo hilo no dispararía nunca y el «pico» sería
 *      el valor final, que es justo el que no interesa.
 *
 * El peso de las dos estructuras calientes se mide **por réplica**, no
 * instrumentando `inspect.ts`: se reconstruye el `Map<string,number>` de
 * `weldPositions` y el `Map<number,number>` de `edgeUse` con las mismas claves
 * que produciría la auditoría, y se mira el heap antes y después. Aditivo: el
 * código que se va a reescribir no se toca en S1.
 *
 * Uso:
 *   node tools/auditBaseline.mjs                 100k y 1M
 *   node tools/auditBaseline.mjs --heavy         añade el escalón de 5M
 *   node tools/auditBaseline.mjs --heap 2048     con otro límite de heap viejo
 */

import { spawn } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import v8 from "node:v8";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { divisionsFor, expectedDuplicates, torusMesh } from "./scaleMesh.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const selfPath = resolve(here, "auditBaseline.mjs");
const projectRoot = resolve(here, "..");

/** Escalones de D25. El de 5M es el que el gate de producción tiene que atravesar. */
export const STEPS = [
  { name: "100k", triangles: 100000, heavy: false },
  { name: "1M", triangles: 1000000, heavy: false },
  { name: "5M", triangles: 5000000, heavy: true },
];

/** Las tres medidas de cada escalón, cada una en su propio proceso. */
const MEASURES = ["audit", "weld", "edge"];

const MEGA = 1024 * 1024;

function mib(bytes) {
  return `${(bytes / MEGA).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------
// Hilo de cálculo: genera la malla y ejecuta una de las tres medidas.
// ---------------------------------------------------------------------------

/**
 * Lo que cuesta construir el árbol de triángulos (D24), con el mismo arnés que
 * midió `auditMesh`: mismo proceso aparte, mismo muestreo de RSS y mismo tiempo
 * de CPU. Comparar dos estructuras medidas de dos maneras distintas no es
 * comparar.
 */
function measureBoundsTree(mesh, buildTriangleBoundsTree) {
  const start = process.cpuUsage();
  const tree = buildTriangleBoundsTree(mesh);
  const cpu = process.cpuUsage(start);
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    nodes: tree.nodeCount,
    treeBytes:
      tree.bounds.byteLength +
      tree.start.byteLength +
      tree.count.byteLength +
      tree.left.byteLength +
      tree.right.byteLength +
      tree.order.byteLength,
  };
}

function measureAudit(mesh, auditMesh) {
  const start = process.cpuUsage();
  const audit = auditMesh(mesh);
  const cpu = process.cpuUsage(start);
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    audit: {
      vertices: audit.vertices,
      triangles: audit.triangles,
      degenerateTriangles: audit.degenerateTriangles,
      boundaryEdges: audit.boundaryEdges,
      nonManifoldEdges: audit.nonManifoldEdges,
      watertight: audit.watertight,
      duplicatePositions: audit.duplicatePositions,
      flippedNormalRatio: audit.flippedNormalRatio,
      symmetryErrorX: audit.symmetryErrorX,
      signedVolume: audit.signedVolume,
    },
  };
}

/**
 * Réplica del índice de texto que `weldPositions` **tenía**: una clave por
 * vértice, con la misma cuantización a 1e-5. Ya no está en `inspect.ts`, y se
 * mide igual porque es la referencia contra la que se juzga lo que lo sustituyó.
 */
function measureWeld(mesh) {
  const { positions } = mesh;
  const vertexCount = positions.length / 3;
  global.gc?.();
  const before = process.memoryUsage();
  const start = process.cpuUsage();

  const lookup = new Map();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const key = `${Math.round(positions[offset] * 1e5)},${Math.round(
      positions[offset + 1] * 1e5,
    )},${Math.round(positions[offset + 2] * 1e5)}`;
    if (!lookup.has(key)) lookup.set(key, vertex);
  }

  const cpu = process.cpuUsage(start);
  const after = process.memoryUsage();
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    entries: lookup.size,
    heapDelta: after.heapUsed - before.heapUsed,
  };
}

/**
 * Réplica del `edgeUse` que **había**: una entrada de `Map` por arista soldada,
 * con la clave empaquetada que usaba `edgeKey`. Misma razón que la de arriba.
 */
function measureEdge(mesh) {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;

  // La soldadura primero, y fuera de la medida: `edgeUse` se indexa por vértice
  // soldado, así que contarla con índices crudos daría más aristas de las reales.
  const map = new Int32Array(vertexCount);
  const lookup = new Map();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const key = `${Math.round(positions[offset] * 1e5)},${Math.round(
      positions[offset + 1] * 1e5,
    )},${Math.round(positions[offset + 2] * 1e5)}`;
    const existing = lookup.get(key);
    if (existing === undefined) {
      lookup.set(key, vertex);
      map[vertex] = vertex;
    } else {
      map[vertex] = existing;
    }
  }
  lookup.clear();

  global.gc?.();
  const before = process.memoryUsage();
  const start = process.cpuUsage();

  const edgeUse = new Map();
  const triangleCount = indices.length / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const w0 = map[indices[triangle * 3]];
    const w1 = map[indices[triangle * 3 + 1]];
    const w2 = map[indices[triangle * 3 + 2]];
    for (const [from, to] of [
      [w0, w1],
      [w1, w2],
      [w2, w0],
    ]) {
      if (from === to) continue;
      const low = from < to ? from : to;
      const high = from < to ? to : from;
      const key = low * 67108864 + high;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }

  const cpu = process.cpuUsage(start);
  const after = process.memoryUsage();
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    entries: edgeUse.size,
    heapDelta: after.heapUsed - before.heapUsed,
  };
}

async function runWorker() {
  const { triangles, measure } = workerData;
  const { auditMesh, buildTriangleBoundsTree } = await import(resolve(projectRoot, "dist-node/agent3d.mjs"));

  const buildStart = process.cpuUsage();
  const mesh = torusMesh(triangles);
  const buildCpu = process.cpuUsage(buildStart);
  parentPort.postMessage({ phase: "built" });

  const result =
    measure === "audit"
      ? measureAudit(mesh, auditMesh)
      : measure === "boundsTree"
        ? measureBoundsTree(mesh, buildTriangleBoundsTree)
        : measure === "weld"
          ? measureWeld(mesh)
          : measureEdge(mesh);

  const memory = process.memoryUsage();
  parentPort.postMessage({
    phase: "done",
    result: {
      ...result,
      buildCpuMs: (buildCpu.user + buildCpu.system) / 1000,
      meshBytes: mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength + mesh.indices.byteLength,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      heapLimit: v8.getHeapStatistics().heap_size_limit,
    },
  });
}

// ---------------------------------------------------------------------------
// Proceso hijo: muestrea RSS mientras el hilo de cálculo trabaja.
// ---------------------------------------------------------------------------

function runChild(triangles, measure) {
  return new Promise((done) => {
    const worker = new Worker(selfPath, { workerData: { triangles, measure } });
    let peakRss = process.memoryUsage.rss();
    let peakAfterBuild = 0;
    let built = false;

    // 20 ms: suficiente para ver el pico de un cálculo de segundos, y el coste
    // del muestreo no entra en la medida porque el trabajo va en otro hilo.
    const sampler = setInterval(() => {
      const rss = process.memoryUsage.rss();
      if (rss > peakRss) peakRss = rss;
      if (built && rss > peakAfterBuild) peakAfterBuild = rss;
    }, 20);

    let payload = null;
    worker.on("message", (message) => {
      if (message.phase === "built") {
        built = true;
        peakAfterBuild = process.memoryUsage.rss();
      } else payload = message.result;
    });
    worker.on("error", (error) => {
      process.stdout.write(`${JSON.stringify({ failed: String(error && error.message) })}\n`);
    });
    worker.on("exit", () => {
      clearInterval(sampler);
      if (payload !== null) {
        process.stdout.write(
          `${JSON.stringify({ ...payload, peakRss, peakRssAfterBuild: peakAfterBuild })}\n`,
        );
      }
      done();
    });
  });
}

// ---------------------------------------------------------------------------
// Proceso principal: lanza un hijo por medida y compone el informe.
// ---------------------------------------------------------------------------

/** Entorno declarado. Sin esto la comparación de S2/S3 no es una comparación. */
export function environment() {
  const core = cpus()[0];
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    cpu: core ? core.model.trim() : "desconocida",
    cpuLogical: cpus().length,
    parallelism: availableParallelism(),
    ramBytes: totalmem(),
    heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    workers: 1,
  };
}

/**
 * Lanza una medida en su propio proceso. Devuelve el objeto medido, o un fallo
 * con el código y la señal: quedarse sin heap es un resultado del experimento,
 * no un error del arnés.
 */
export function measureInChild(triangles, measure, heapMb) {
  return new Promise((done) => {
    const args = ["--expose-gc"];
    if (heapMb) args.push(`--max-old-space-size=${heapMb}`);
    args.push(selfPath, "--child", String(triangles), measure);
    const child = spawn(process.execPath, args, { cwd: projectRoot });

    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code, signal) => {
      const line = out.trim().split("\n").filter(Boolean).pop();
      let parsed = null;
      try {
        parsed = line ? JSON.parse(line) : null;
      } catch {
        parsed = null;
      }
      if (parsed && parsed.failed === undefined) done({ ok: true, ...parsed });
      else
        done({
          ok: false,
          code,
          signal,
          reason: (parsed && parsed.failed) || err.trim().split("\n").slice(-3).join(" ") || "sin salida",
        });
    });
  });
}

/** Las tres medidas de un escalón. */
export async function measureStep(step, heapMb) {
  const results = {};
  for (const measure of MEASURES) {
    results[measure] = await measureInChild(step.triangles, measure, heapMb);
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const heavy = argv.includes("--heavy");
  const heapIndex = argv.indexOf("--heap");
  const heapMb = heapIndex >= 0 ? Number(argv[heapIndex + 1]) : 0;
  const env = environment();

  console.log("entorno");
  console.log(
    `  ${env.platform}/${env.arch}  node ${env.node} (v8 ${env.v8})  ${env.cpu}  ${env.cpuLogical} lógicos, paralelismo ${env.parallelism}`,
  );
  console.log(
    `  RAM ${mib(env.ramBytes)}  heap viejo por defecto ${mib(env.heapLimitBytes)}${heapMb ? `  (hijos con --max-old-space-size=${heapMb})` : ""}  workers 1`,
  );

  for (const step of STEPS) {
    if (step.heavy && !heavy) {
      console.log(`\n${step.name}: NO EJECUTADA — escalón pesado, hace falta --heavy`);
      continue;
    }
    const { u, v, triangles } = divisionsFor(step.triangles);
    console.log(`\n${step.name}: toro ${u}×${v} = ${triangles.toLocaleString("es-ES")} triángulos`);
    const results = await measureStep(step, heapMb);

    const audit = results.audit;
    if (audit.ok) {
      console.log(
        `  auditMesh   ${(audit.cpuMs / 1000).toFixed(2)} s CPU  RSS máx ${mib(audit.peakRss)}  heap ${mib(audit.heapUsed)}  externos ${mib(audit.external)}  buffers ${mib(audit.arrayBuffers)}`,
      );
      console.log(
        `              malla ${mib(audit.meshBytes)} (generar ${(audit.buildCpuMs / 1000).toFixed(2)} s CPU)  duplicados ${audit.audit.duplicatePositions} de ${expectedDuplicates(step.triangles)} esperados  watertight ${audit.audit.watertight}  simetría ${audit.audit.symmetryErrorX}`,
      );
    } else {
      console.log(`  auditMesh   REVENTÓ — código ${audit.code} señal ${audit.signal}: ${audit.reason}`);
    }

    for (const [measure, label] of [
      ["weld", "soldadura"],
      ["edge", "aristas   "],
    ]) {
      const result = results[measure];
      if (result.ok) {
        console.log(
          `  ${label}   ${(result.cpuMs / 1000).toFixed(2)} s CPU  ${result.entries.toLocaleString("es-ES")} entradas  heap +${mib(result.heapDelta)}  (${(result.heapDelta / result.entries).toFixed(0)} B/entrada)  RSS máx ${mib(result.peakRss)}`,
        );
      } else {
        console.log(`  ${label}   REVENTÓ — código ${result.code} señal ${result.signal}: ${result.reason}`);
      }
    }
  }
}

if (!isMainThread) await runWorker();
else if (process.argv[2] === "--child") await runChild(Number(process.argv[3]), process.argv[4]);
else if (import.meta.url === `file://${process.argv[1]}`) await main();
