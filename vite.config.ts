import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const outDir = path.resolve(__dirname, "templates/assets");
const cssOutDir = path.resolve(outDir, "css");
const jsOutDir = path.resolve(outDir, "js");
// Only these directories are fully owned by Vite and may be cleared/pruned.
const managedOutputDirs = [cssOutDir, jsOutDir];
const isWatchMode = process.argv.includes("--watch");
// Sync tools may generate duplicate "conflict copy" files inside the output tree.
const conflictCopyPatterns = [/冲突副本/i, /conflict/i];

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

function isConflictCopy(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return conflictCopyPatterns.some((pattern) => pattern.test(baseName));
}

function pruneConflictCopies(dir: string) {
  for (const filePath of walkFiles(dir)) {
    if (isConflictCopy(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function clearManagedOutputDirs() {
  for (const dir of managedOutputDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function collectExpectedManagedFiles(bundle: Record<string, any>): Set<string> {
  return new Set(
    Object.values(bundle)
      .map((item) => item.fileName)
      .filter((fileName) => fileName.startsWith("css/") || fileName.startsWith("js/"))
      .map((fileName) => path.resolve(outDir, fileName))
  );
}

function pruneUnexpectedManagedFiles(expectedFiles: Set<string>) {
  for (const dir of managedOutputDirs) {
    for (const filePath of walkFiles(dir)) {
      if (!expectedFiles.has(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }
}

function pruneEmptyJsStubs(bundle: Record<string, any>) {
  for (const chunk of Object.values(bundle) as any[]) {
    if (chunk.type === "chunk" && chunk.fileName?.startsWith("js/") && chunk.code?.trim() === "") {
      const emptyPath = path.resolve(outDir, chunk.fileName);
      if (fs.existsSync(emptyPath)) {
        fs.rmSync(emptyPath, { force: true });
      }
    }
  }
}

function maintainBuildOutputHygiene() {
  let cleanedBeforeBuild = false;

  return {
    name: "maintain-build-output-hygiene",
    buildStart() {
      if (cleanedBeforeBuild) {
        return;
      }

      cleanedBeforeBuild = true;
      // First remove sync/editor conflict copies anywhere under templates/assets,
      // then fully clear only the Vite-managed css/js directories.
      pruneConflictCopies(outDir);
      clearManagedOutputDirs();
    },
    writeBundle(_options, bundle) {
      // Conflict copies can appear again during or after bundle emission.
      pruneConflictCopies(outDir);

      const expectedFiles = collectExpectedManagedFiles(bundle);
      // Only prune inside managed output directories. Static assets such as
      // templates/assets/images and favicon.svg are intentionally preserved.
      pruneUnexpectedManagedFiles(expectedFiles);
      pruneEmptyJsStubs(bundle);
      removeEmptyDirs(outDir);
    }
  };
}

export default defineConfig({
  base: themeAssetBase,
  plugins: [maintainBuildOutputHygiene()],
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
        explorer: path.resolve(__dirname, "src/features/browser-explorer/entry.js"),
        reader: path.resolve(__dirname, "src/entries/reader.js"),
        "moments-app": path.resolve(__dirname, "src/features/moments-app/entry.js"),
        "photos-app": path.resolve(__dirname, "src/features/photos-app/entry.js"),
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
