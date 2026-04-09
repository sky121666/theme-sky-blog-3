import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const outDir = path.resolve(__dirname, "templates/assets");
const cssOutDir = path.resolve(outDir, "css");
const jsOutDir = path.resolve(outDir, "js");
const isWatchMode = process.argv.includes("--watch");

// Read theme name from theme.yaml to construct Halo's asset serving path
const themeYaml = fs.readFileSync(path.resolve(__dirname, "theme.yaml"), "utf-8");
const themeNameMatch = themeYaml.match(/^\s*name:\s*(.+)$/m);
const themeName = themeNameMatch ? themeNameMatch[1].trim() : "theme-sky-blog-3";
const themeAssetBase = `/themes/${themeName}/assets/`;

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(fullPath);
    }
    return [fullPath];
  });
}

function removeEmptyDirs(dir: string) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childPath = path.join(dir, entry.name);
    removeEmptyDirs(childPath);
    if (fs.existsSync(childPath) && fs.readdirSync(childPath).length === 0) {
      fs.rmdirSync(childPath);
    }
  }
}

function pruneBuildAssets() {
  let cleanedBeforeBuild = false;

  return {
    name: "prune-build-assets",
    buildStart() {
      if (cleanedBeforeBuild) {
        return;
      }

      cleanedBeforeBuild = true;
      fs.rmSync(cssOutDir, { recursive: true, force: true });
      fs.rmSync(jsOutDir, { recursive: true, force: true });
    },
    writeBundle(_options, bundle) {
      const expectedFiles = new Set(
        Object.values(bundle)
          .map((item) => item.fileName)
          .filter((fileName) => fileName.startsWith("css/") || fileName.startsWith("js/"))
          .map((fileName) => path.resolve(outDir, fileName))
      );

      for (const filePath of [...walkFiles(cssOutDir), ...walkFiles(jsOutDir)]) {
        if (!expectedFiles.has(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      }

      // Remove 0-byte JS files (CSS-only entries produce empty JS stubs)
      for (const chunk of Object.values(bundle) as any[]) {
        if (chunk.type === "chunk" && chunk.fileName?.startsWith("js/") && chunk.code?.trim() === "") {
          const emptyPath = path.resolve(outDir, chunk.fileName);
          if (fs.existsSync(emptyPath)) {
            fs.rmSync(emptyPath, { force: true });
          }
        }
      }

      removeEmptyDirs(cssOutDir);
      removeEmptyDirs(jsOutDir);
    }
  };
}

export default defineConfig({
  base: themeAssetBase,
  plugins: [pruneBuildAssets()],
  build: {
    outDir,
    emptyOutDir: false,
    minify: "esbuild",
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    watch: isWatchMode
        ? {
          exclude: [
            `${outDir}/**`,
            `${path.resolve(__dirname, "dist")}/**`,
          ],
        }
      : null,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "src/main.js"),
        auth: path.resolve(__dirname, "src/entries/auth.css"),
        explorer: path.resolve(__dirname, "src/entries/explorer.js"),
        reader: path.resolve(__dirname, "src/entries/reader.js"),
        "moments-app": path.resolve(__dirname, "src/entries/moments-app.js"),
      },
      output: {
        format: "es",
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/chunks/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            const baseName = path.basename(assetInfo.name, ".css");
            return `css/${baseName}.css`;
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
