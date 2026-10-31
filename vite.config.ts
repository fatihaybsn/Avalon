import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const { version } = createRequire(import.meta.url)("./package.json");
const buildId = new Date().toISOString();
const asset = (file: string) => path.resolve(file).replace(/\\/g, "/");

export default defineConfig(({ mode }) => ({
  root: mode === "mobile" ? "mobile" : ".",
  publicDir: path.resolve("public"),
  build: mode === "mobile" ? { outDir: "../dist-mobile", emptyOutDir: true } : undefined,
  // Single source of truth for the build badge, so releases never ship a stale
  // version string in the footer.
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(buildId) },
  // Relative base so the built index.html resolves assets when Electron loads it
  // from the filesystem (file://) in production / packaged builds.
  base: mode === "mobile" ? "/" : "./",
  plugins: [
    react(),
    { name: "avalon-build-info", generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version, buildId }) }); } },
    viteStaticCopy({
      targets: [
        {
          src: asset("node_modules/@ricky0123/vad-web/dist/{vad.worklet.bundle.min.js,silero_vad_v5.onnx}"),
          dest: "vad-assets",
          rename: { stripBase: 4 },
        },
        {
          src: asset("node_modules/onnxruntime-web/dist/{ort-wasm-simd-threaded.mjs,ort-wasm-simd-threaded.wasm}"),
          dest: "vad-assets",
          rename: { stripBase: 3 },
        },
      ],
    }),
    ...(mode === "mobile" ? [viteStaticCopy({ targets: [{ src: asset("build/mobile-icon-{192,512}.png"), dest: ".", rename: { stripBase: 1 } }] }), VitePWA({
      strategies: "injectManifest", srcDir: "../src/mobile", filename: "sw.ts", injectRegister: false,
      manifest: { name: "Avalon", short_name: "Avalon", start_url: "/", display: "standalone", background_color: "#09090b", theme_color: "#09090b", icons: [192, 512].map((size) => ({ src: `/mobile-icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" as const })) },
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest,woff2}"], globIgnores: ["vad-assets/**"], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    })] : []),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
}));
