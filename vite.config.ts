import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { gzipSync } from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { getAppAssetSegment, getAppEntryPaths, getEntryJsPath, getEntryCssPath } from "./src/shell-core/runtime/app-manifests.js";
import { renderBuildStyles } from "./scripts/theme-build-styles.mjs";

const outDir = path.resolve(import.meta.dirname, "templates/assets");
const cssOutDir = path.resolve(outDir, "css");
const jsOutDir = path.resolve(outDir, "js");
// Only these directories are fully owned by Vite and may be cleared/pruned.
const managedOutputDirs = [cssOutDir, jsOutDir];
const isWatchMode = process.argv.includes("--watch");
// Sync tools may generate duplicate "conflict copy" files inside the output tree.
const conflictCopyPatterns = [/冲突副本/i, /\bconflict(?:ed)? copy\b/i];

// Read theme name from theme.yaml to construct Halo's asset serving path
const themeYaml = fs.readFileSync(path.resolve(import.meta.dirname, "theme.yaml"), "utf-8");
const themeNameMatch = themeYaml.match(/^\s*name:\s*(.+)$/m);
const themeName = themeNameMatch ? themeNameMatch[1].trim() : "theme-sky-blog-3";
const themeAssetBase = `/themes/${themeName}/assets/`;
const buildVersion = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8")).version;
const buildRevision = computeBuildRevision();
const buildVersionQuery = `v=${encodeURIComponent(buildVersion)}&r=${encodeURIComponent(buildRevision)}`;
const entryNames = new Set(Object.keys(getAppEntryPaths()));

function entryAssetDirName(entryName: string): string {
  return getAppAssetSegment(entryName) || sanitizeChunkSegment(entryName);
}

function entryJsPath(entryName: string): string {
  return getEntryJsPath(entryName);
}

function entryCssPath(entryName: string): string {
  return getEntryCssPath(entryName);
}

function normalizeRelPath(filePath: string): string {
  return path.relative(import.meta.dirname, filePath).replace(/\\/g, "/");
}

function shouldHashBuildInput(filePath: string): boolean {
  const rel = normalizeRelPath(filePath);
  if (rel.startsWith("templates/assets/")) {
    return false;
  }
  if (rel.startsWith("node_modules/") || rel.startsWith("dist/") || rel.startsWith("output/")) {
    return false;
  }

  return [
    "src/",
    "templates/",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "patches/",
    "theme.yaml",
    "settings.yaml",
    "theme-setting.yaml",
    "vite.config.ts",
    "tsconfig.json"
  ].some((prefix) => rel === prefix || rel.startsWith(prefix));
}

function collectBuildInputFiles(): string[] {
  const roots = [
    path.resolve(import.meta.dirname, "src"),
    path.resolve(import.meta.dirname, "templates"),
    path.resolve(import.meta.dirname, "package.json"),
    path.resolve(import.meta.dirname, "pnpm-lock.yaml"),
    path.resolve(import.meta.dirname, "pnpm-workspace.yaml"),
    path.resolve(import.meta.dirname, "patches"),
    path.resolve(import.meta.dirname, "theme.yaml"),
    path.resolve(import.meta.dirname, "settings.yaml"),
    path.resolve(import.meta.dirname, "theme-setting.yaml"),
    path.resolve(import.meta.dirname, "vite.config.ts"),
    path.resolve(import.meta.dirname, "tsconfig.json")
  ];

  return roots
    .flatMap((root) => {
      if (!fs.existsSync(root)) {
        return [];
      }
      const stat = fs.statSync(root);
      return stat.isDirectory() ? walkFiles(root) : [root];
    })
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .filter(shouldHashBuildInput)
    .sort((a, b) => normalizeRelPath(a).localeCompare(normalizeRelPath(b)));
}

function computeBuildRevision(): string {
  const hash = crypto.createHash("sha256");
  for (const filePath of collectBuildInputFiles()) {
    hash.update(normalizeRelPath(filePath));
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
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

function pruneConflictCopies(dir: string, expectedFiles: Set<string> = new Set()) {
  for (const filePath of walkFiles(dir)) {
    if (!expectedFiles.has(filePath) && isConflictCopy(filePath)) {
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

function appendBuildVersionToStaticImports() {
  const versionSuffix = `?${buildVersionQuery}`;

  for (const filePath of walkFiles(jsOutDir)) {
    if (!filePath.endsWith(".js")) {
      continue;
    }

    const source = fs.readFileSync(filePath, "utf-8");
    const appendVersion = (_match: string, prefix: string, specifier: string, quote: string) => (
      specifier.includes("?")
        ? `${prefix}${specifier}${quote}`
        : `${prefix}${specifier}${versionSuffix}${quote}`
    );
    const next = source
      .replace(
        /((?:import|export)[^"']*?from["'])(\.{1,2}\/[^"']+\.js)(["'])/g,
        appendVersion
      )
      .replace(
        /((?:import|export)["'])(\.{1,2}\/[^"']+\.js)(["'])/g,
        appendVersion
      )
      .replace(
        /(import\(["'])(\.{1,2}\/[^"']+\.js)(["']\))/g,
        appendVersion
      )
      .replace(
        /(["'])((?:js|css)\/chunks\/[^"']+\.(?:js|css))(["'])/g,
        appendVersion
      )
      .replace(
        /\.endsWith\("\.css"\)/g,
        '.split("?")[0].endsWith(".css")'
      )
      .replace(
        /\.endsWith\('\.css'\)/g,
        ".split('?')[0].endsWith('.css')"
      );

    if (next !== source) {
      fs.writeFileSync(filePath, next, "utf-8");
    }
  }
}

function writeAssetManifest(bundle: Record<string, any>) {
  const manifest: Record<string, any> = {
    __meta: {
      version: buildVersion,
      revision: buildRevision,
      query: buildVersionQuery
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
  fs.writeFileSync(path.resolve(outDir, "build-styles.html"), renderBuildStyles(manifest), "utf-8");
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
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((item: any) => item.type === "chunk" && item.isEntry && item.name === "shell-core") as any;
      if (!entry) throw new Error("Shell entry missing from generated bundle");
      const closure = new Set<string>();
      const visit = (fileName: string) => {
        if (closure.has(fileName)) return;
        const chunk = bundle[fileName];
        if (chunk?.type !== "chunk") return;
        closure.add(fileName);
        chunk.imports.forEach(visit);
      };
      visit(entry.fileName);
      let raw = 0;
      let gzip = 0;
      for (const fileName of closure) {
        const chunk = bundle[fileName] as any;
        const appModules = Object.keys(chunk.modules).map(normalizeRelPath)
          .filter((id) => /^src\/apps\/.*\.js$/.test(id) && !id.endsWith("/manifest.js"));
        if (appModules.length) {
          throw new Error(`Shell statically includes app runtime: ${appModules.join(", ")}`);
        }
        raw += Buffer.byteLength(chunk.code);
        gzip += gzipSync(chunk.code, { level: 9 }).byteLength;
      }
      // These are compressed source budgets, not browser transfer or Web Vitals measurements.
      if (gzip > 145 * 1024) throw new Error(`Shell JS gzip budget exceeded: ${gzip} bytes`);
      const shellCss = bundle["css/shell-core/index.css"] as any;
      const cssSource = shellCss?.source;
      const cssGzip = cssSource == null ? 0 : gzipSync(cssSource, { level: 9 }).byteLength;
      if (cssGzip > 64 * 1024) throw new Error(`Shell CSS gzip budget exceeded: ${cssGzip} bytes`);
      console.log(`[asset-budget] shell static JS: ${closure.size} files, ${raw} raw / ${gzip} gzip bytes; CSS gzip: ${cssGzip} bytes (before URL revision suffixes)`);
    },
    writeBundle(_options, bundle) {
      const expectedFiles = collectExpectedManagedFiles(bundle);
      // Generated filenames are authoritative, including legitimate names such
      // as persistence-conflict.js. Never classify them as sync copies.
      pruneConflictCopies(outDir, expectedFiles);
      // Only prune inside managed output directories. Static assets such as
      // templates/assets/images and favicon.svg are intentionally preserved.
      pruneUnexpectedManagedFiles(expectedFiles);
      pruneEmptyJsStubs(bundle);
      for (const chunk of Object.values(bundle) as any[]) {
        if (chunk.type !== "chunk") continue;
        for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
          if (bundle[dependency] && !fs.existsSync(path.resolve(outDir, dependency))) {
            throw new Error(`Built dependency missing after cleanup: ${chunk.fileName} -> ${dependency}`);
          }
        }
      }
      appendBuildVersionToStaticImports();
      writeAssetManifest(bundle);
      removeEmptyDirs(outDir);
    }
  };
}

export default defineConfig({
  base: themeAssetBase,
  define: {
    __THEME_BUILD_VERSION__: JSON.stringify(buildVersion),
    __THEME_BUILD_REVISION__: JSON.stringify(buildRevision),
  },
  plugins: [tailwindcss(), maintainBuildOutputHygiene()],
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
            `${path.resolve(import.meta.dirname, "dist")}/**`,
          ],
        }
      : null,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(getAppEntryPaths()).map(([name, source]) => [name, path.resolve(import.meta.dirname, source)])),
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
        codeSplitting: {
          groups: [
            {
              // Shared helpers must win over an application's recursive dependency group.
              // Otherwise lazy-media enters Photos and text helpers enter Reader, pulling
              // those complete application chunks into every cold Shell page.
              priority: 100,
              includeDependenciesRecursively: false,
              name(id: string) {
                const rel = normalizeRelPath(id);
                if (rel.startsWith("src/shared/")) return deriveNamedChunk(id);
                if (rel === "src/shell/desktop-shell/runtime/widgets/debug-core.js") return "shared/shell-debug";
                if (rel.startsWith("src/shell/desktop-shell/runtime/shared/")) {
                  return `shared/shell-${sanitizeChunkSegment(path.basename(id))}`;
                }
                return null;
              }
            },
            { name: deriveNamedChunk }
          ]
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
