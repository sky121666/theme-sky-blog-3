import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

// Operates on existing output only. --report-only also permits measuring an old baseline.
const args = process.argv.slice(2);
const directoryIndex = args.indexOf('--assets-dir');
const root = path.resolve(directoryIndex >= 0 ? args[directoryIndex + 1] : 'templates/assets');
const reportOnly = args.includes('--report-only');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(path.join(root, 'js')).filter((file) => file.endsWith('.js'));
const parsed = spawnSync(process.execPath, ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
  import fs from 'node:fs';
  import vm from 'node:vm';
  const files = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(files.map(({ file, source }) => ({ file, imports: new vm.SourceTextModule(source, { identifier: file }).dependencySpecifiers }))));
`], { input: JSON.stringify(files.map((file) => ({ file: path.relative(root, file).split(path.sep).join('/'), source: fs.readFileSync(file, 'utf8') }))), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (parsed.status !== 0) throw new Error(parsed.stderr || parsed.error?.message || 'Asset parsing failed');
const modules = new Map(JSON.parse(parsed.stdout).map((item) => [item.file, item.imports]));
const rows = new Map(files.map((file) => {
  const source = fs.readFileSync(file);
  return [path.relative(root, file).split(path.sep).join('/'), { raw: source.byteLength, gzip: gzipSync(source, { level: 9 }).byteLength }];
}));
const relativeAsset = (url) => String(url).split('/assets/')[1]?.split('?')[0];
function closure(entry) {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    assert.ok(modules.has(file), `Missing static JS asset: ${file}`);
    visited.add(file);
    for (const specifier of modules.get(file)) {
      if (!specifier.startsWith('.')) continue;
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.split('?')[0])));
    }
  }
  visit(entry);
  return [...visited].sort();
}
const entries = Object.entries(manifest).filter(([name]) => name !== '__meta').map(([name, entry]) => {
  const dependencies = closure(relativeAsset(entry.js[0]));
  return { name, staticJsFiles: dependencies.length, raw: dependencies.reduce((sum, file) => sum + rows.get(file).raw, 0), gzip: dependencies.reduce((sum, file) => sum + rows.get(file).gzip, 0), dependencies };
});
const shell = entries.find((entry) => entry.name === 'shell-core');
assert.ok(shell, 'Missing Shell manifest entry');
const css = fs.readFileSync(path.join(root, 'css/shell-core/index.css'));
const cssSize = { raw: css.byteLength, gzip: gzipSync(css, { level: 9 }).byteLength };
const failures = [];
if (shell.gzip > 145 * 1024) failures.push(`Shell JS gzip ${shell.gzip} exceeds 145 KiB`);
if (cssSize.gzip > 64 * 1024) failures.push(`Shell CSS gzip ${cssSize.gzip} exceeds 64 KiB`);
for (const file of shell.dependencies) {
  if (/^js\/chunks\/apps\/(?!explorer\/shared\/)/.test(file)) failures.push(`Shell includes app runtime chunk: ${file}`);
}
for (const entry of entries.filter((entry) => entry.name !== 'shell-core')) {
  if (entry.dependencies.includes('js/shell-core/index.js')) failures.push(`App ${entry.name} imports Shell before its registrar can run`);
}
console.log(JSON.stringify({ revision: manifest.__meta, method: 'existing emitted files; static imports parsed by Node; per-file gzip level 9; excludes HTML, dynamic imports, plugins, images, HTTP framing', shell, shellCss: cssSize, entries, failures }, null, 2));
if (!reportOnly && failures.length) process.exitCode = 1;
