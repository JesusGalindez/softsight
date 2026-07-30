import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only sink for `?capture=<view>` renders. The page POSTs a data URL and the
 * frame lands in artifacts/review/, which is where the reference comparison
 * sheets are kept. Not part of the production bundle.
 */
function captureSink(): Plugin {
  return {
    name: "drone-capture-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__capture", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              name?: string;
              dataUrl?: string;
            };
            const name = (payload.name ?? "render").replace(/[^a-z0-9-]/gi, "");
            const base64 = (payload.dataUrl ?? "").split(",")[1] ?? "";
            const target = resolve(server.config.root, `artifacts/review/render-${name}.png`);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.from(base64, "base64"));
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: true, target }));
          } catch (error) {
            response.statusCode = 400;
            response.end(String(error));
          }
        });
      });
    },
  };
}

/**
 * Dev-only sink for `?export=glb`. Writes the GLTFExporter output to
 * artifacts/export/ so the articulated hierarchy can be inspected offline.
 */
function exportSink(): Plugin {
  return {
    name: "drone-export-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__export", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const target = resolve(server.config.root, "artifacts/export/drone.glb");
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, Buffer.concat(chunks));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, target }));
        });
      });
    },
  };
}

/**
 * Entradas de compilación. `soft.html` siempre; las páginas del visor Three.js solo si
 * existen en el árbol de trabajo.
 *
 * La comprobación no es un capricho: el visor del dron vive fuera de este repositorio
 * —es otro proyecto que comparte directorio en la máquina del autor—, así que
 * declararlo como entrada fija haría fallar la compilación de cualquier clon limpio.
 * Con esto, ambos casos funcionan sin tocar la configuración.
 */
function buildInputs(): Record<string, string> {
  const inputs: Record<string, string> = { soft: resolve(__dirname, "soft.html") };
  for (const [name, file] of [
    ["main", "index.html"],
    ["glb", "glb.html"],
  ] as const) {
    const path = resolve(__dirname, file);
    if (existsSync(path)) inputs[name] = path;
  }
  return inputs;
}

export default defineConfig({
  plugins: [captureSink(), exportSink()],
  build: {
    rollupOptions: { input: buildInputs() },
  },
});
