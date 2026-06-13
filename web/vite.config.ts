import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pyodide runs in a Web Worker and fetches its runtime from a CDN; the pdr wheel
// is served from /wheels/. `base: "./"` keeps the build deployable on any static
// host (Vercel, GitHub Pages, a local file server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
