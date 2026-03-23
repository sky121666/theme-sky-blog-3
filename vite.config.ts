import path from "node:path";
import { defineConfig } from "vite";

const outDir = path.resolve(__dirname, "templates/assets");
const isWatchMode = process.argv.includes("--watch");

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: false,
    minify: "esbuild",
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.js"),
      formats: ["iife"],
      name: "ThemeMacOS",
      fileName: () => "main.js",
      cssFileName: "main",
    },
    watch: isWatchMode
        ? {
          exclude: [
            `${outDir}/**`,
            `${path.resolve(__dirname, "dist")}/**`,
          ],
        }
      : null,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "main.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
