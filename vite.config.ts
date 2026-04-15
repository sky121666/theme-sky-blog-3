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
const buildVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")).version;
const entryNames = new Set([
  "shell-core",
  "auth",
  "reader",
  "moments",
  "photos",
  "explorer-tags",
  "explorer-categories",
  "explorer-author",
  "explorer-archives"
]);

function entryAssetDirName(entryName: string): string {
  switch (entryName) {
    case "explorer-tags":
      return "tags";
    case "explorer-categories":
      return "categories";
    case "explorer-author":
      return "author";
    case "explorer-archives":
      return "archives";
    default:
      return sanitizeChunkSegment(entryName);
  }
}

function entryJsPath(entryName: string): string {
  const normalized = entryAssetDirName(entryName);
  if (entryName === "shell-core") {
    return "js/shell-core/index.js";
  }
  return `js/apps/${normalized}/index.js`;
}

function entryCssPath(entryName: string): string {
  const normalized = entryAssetDirName(entryName);
  if (entryName === "shell-core") {
    return "css/shell-core/index.css";
  }
  return `css/apps/${normalized}/index.css`;
}

function normalizeRelPath(filePath: string): string {
  return path.relative(__dirname, filePath).replace(/\\/g, "/");
}

function sanitizeChunkSegment(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function deriveNamedChunk(id: string): string | null {
  const rel = normalizeRelPath(id);
  const parts = rel.split("/");

  if (parts[0] !== "src") {
    return null;
  }

  if (parts[1] === "widgets") {
    if (parts[2] === "shared") {
      return `widgets/shared/${sanitizeChunkSegment(parts[3] || "shared")}`;
    }

    if (parts.length >= 5) {
      const scope = sanitizeChunkSegment(parts[2]);
      const widgetId = sanitizeChunkSegment(parts[3]);
      const fileName = sanitizeChunkSegment(parts[4]);
      if (fileName === "render") {
        return `widgets/${scope}/${widgetId}/render`;
      }
      return `widgets/${scope}/${widgetId}/${fileName}`;
    }

    if (parts.length >= 3) {
      return `widgets/${sanitizeChunkSegment(parts.slice(2).join("-"))}`;
    }
  }

  if (parts[1] === "apps") {
    if (parts[2] === "explorer" && parts[3] === "shared") {
      return `apps/explorer/shared/${sanitizeChunkSegment(parts[4] || "shared")}`;
    }

    if (parts.includes("runtime")) {
      const appParts = parts[2] === "explorer"
        ? [entryAssetDirName(`explorer-${sanitizeChunkSegment(parts[3])}`)]
        : [entryAssetDirName(sanitizeChunkSegment(parts[2]))];
      const fileName = sanitizeChunkSegment(parts[parts.length - 1]);
      return `apps/${appParts.join("/")}/${fileName}`;
    }
  }

  if (parts[1] === "shared") {
    return `shared/${sanitizeChunkSegment(parts[2] || "shared")}`;
  }

  if (parts[1] === "shell-core") {
    return `shell-core/${sanitizeChunkSegment(parts[parts.length - 1] || "runtime")}`;
  }

  if (parts[1] === "shell" && parts[2] === "desktop-shell") {
    const tail = parts.slice(3);
    if (tail.length) {
      return `shell-runtime/${tail.map(sanitizeChunkSegment).join("/")}`;
    }
  }

  return null;
}

function deriveFacadeChunkName(id: string): string | null {
  const rel = normalizeRelPath(id);
  const parts = rel.split("/");

  if (parts[0] !== "src") {
    return null;
  }

  if (parts[1] === "widgets" && parts.length >= 5) {
    const scope = sanitizeChunkSegment(parts[2]);
    const widgetId = sanitizeChunkSegment(parts[3]);
    const fileName = sanitizeChunkSegment(parts[4]);
    return fileName === "render"
      ? `widgets/${scope}/${widgetId}/render-entry`
      : `widgets/${scope}/${widgetId}/${fileName}-entry`;
  }

  if (parts[1] === "widgets") {
    return `widgets/${sanitizeChunkSegment(parts.slice(2).join("-"))}-entry`;
  }

  if (parts[1] === "shell" && parts[2] === "desktop-shell") {
    return `shell-runtime/${parts.slice(3).map(sanitizeChunkSegment).join("/")}-entry`;
  }

  if (parts[1] === "apps") {
    const appParts = parts[2] === "explorer"
      ? [entryAssetDirName(`explorer-${sanitizeChunkSegment(parts[3])}`)]
      : [entryAssetDirName(sanitizeChunkSegment(parts[2]))];
    return `apps/${appParts.join("/")}/${sanitizeChunkSegment(parts[parts.length - 1])}-entry`;
  }

  if (parts[1] === "shared") {
    return `shared/${sanitizeChunkSegment(parts[2] || "shared")}-entry`;
  }

  return null;
}

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

function writeAssetManifest(bundle: Record<string, any>) {
  const manifest: Record<string, any> = {
    __meta: {
      version: buildVersion
    }
  };

  for (const item of Object.values(bundle) as any[]) {
    if (item.type !== "chunk" || !item.isEntry || !item.name) continue;

    const cssFiles = Array.from(item.viteMetadata?.importedCss || [])
      .filter((fileName: string) => typeof fileName === "string" && fileName.startsWith("css/"))
      .map((fileName: string) => `${themeAssetBase}${fileName}`);

    manifest[item.name] = {
      js: item.fileName ? [`${themeAssetBase}${item.fileName}`] : [],
      css: cssFiles
    };
  }

  fs.writeFileSync(
    path.resolve(outDir, "asset-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
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
      writeAssetManifest(bundle);
      removeEmptyDirs(outDir);
    }
  };
}

export default defineConfig({
  base: themeAssetBase,
  define: {
    __THEME_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
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
        "shell-core": path.resolve(__dirname, "src/shell-core/entry.js"),
        auth: path.resolve(__dirname, "src/apps/auth/entry.js"),
        reader: path.resolve(__dirname, "src/apps/reader/entry.js"),
        moments: path.resolve(__dirname, "src/apps/moments/entry.js"),
        photos: path.resolve(__dirname, "src/apps/photos/entry.js"),
        "explorer-tags": path.resolve(__dirname, "src/apps/explorer/tags/entry.js"),
        "explorer-categories": path.resolve(__dirname, "src/apps/explorer/categories/entry.js"),
        "explorer-author": path.resolve(__dirname, "src/apps/explorer/author/entry.js"),
        "explorer-archives": path.resolve(__dirname, "src/apps/explorer/archives/entry.js"),
      },
      output: {
        format: "es",
        entryFileNames(chunkInfo) {
          return entryJsPath(chunkInfo.name);
        },
        chunkFileNames(chunkInfo) {
          const facadeName = chunkInfo.facadeModuleId
            ? deriveFacadeChunkName(chunkInfo.facadeModuleId)
            : null;
          if (facadeName) {
            return `js/chunks/${facadeName}.js`;
          }
          return `js/chunks/[name].js`;
        },
        manualChunks(id) {
          if (!id.includes(`${path.sep}src${path.sep}`) && !id.includes("/src/")) {
            return null;
          }
          return deriveNamedChunk(id);
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            const baseName = path.basename(assetInfo.name, ".css");
            if (entryNames.has(baseName)) {
              return entryCssPath(baseName);
            }
            return `css/chunks/${baseName}.css`;
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
