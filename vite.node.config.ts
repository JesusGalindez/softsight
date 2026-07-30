import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Empaquetado para Node del CLI de agentes. Va aparte de `vite.config.ts` porque
 * el objetivo es distinto: aquí no hay navegador, no hay HTML y el resultado es
 * un único `.mjs` ejecutable.
 *
 * Se usa el empaquetador que ya está en el proyecto en vez de compilar con `tsc`
 * porque los imports del motor no llevan extensión —correcto para el navegador— y
 * el resolvedor de módulos de Node exige extensión explícita. Empaquetar resuelve
 * eso sin tocar una sola línea del motor y sin añadir dependencias.
 */
export default defineConfig({
  build: {
    ssr: resolve(__dirname, "src/soft/agent/index.ts"),
    outDir: "dist-node",
    emptyOutDir: true,
    // Sin esto se copia `public/` al lado del bundle: assets del navegador en un
    // directorio que solo contiene un ejecutable de Node.
    copyPublicDir: false,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "agent3d.mjs" },
    },
  },
});
