import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Vite, offline fixtures and live checks share the same build input contract.
export const buildRootFiles = [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'theme.yaml',
  'settings.yaml', 'theme-setting.yaml', 'vite.config.ts', 'tsconfig.json',
  'scripts/lib/build-identity.mjs', 'scripts/theme-build-styles.mjs',
  'scripts/theme-startup.mjs', 'scripts/theme-desktop-preview.mjs'
];

export function isBuildInput(file) {
  return file.startsWith('src/')
    || (file.startsWith('templates/') && !file.startsWith('templates/assets/'))
    || file.startsWith('patches/') || buildRootFiles.includes(file);
}

export function computeBuildRevisionFromContents(contents) {
  const hash = crypto.createHash('sha256');
  for (const name of [...contents.keys()].filter(isBuildInput).sort((a, b) => a.localeCompare(b))) {
    hash.update(name).update('\0').update(contents.get(name)).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export function computeBuildRevision(root = process.cwd()) {
  const contents = new Map();
  const walk = (name) => {
    const absolute = path.join(root, name);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute)) walk(`${name}/${child}`);
    } else if (stat.isFile() && isBuildInput(name)) {
      contents.set(name, fs.readFileSync(absolute));
    }
  };
  for (const name of ['src', 'templates', 'patches', ...buildRootFiles]) walk(name);
  return computeBuildRevisionFromContents(contents);
}

export function assertCurrentBuild(root = process.cwd(), manifest) {
  if (!manifest) {
    const file = path.join(root, 'templates/assets/asset-manifest.json');
    assert.ok(fs.existsSync(file), 'Theme build is missing; run pnpm run build-only first');
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const meta = manifest.__meta;
  assert.ok(meta && typeof meta.version === 'string' && /^[a-f0-9]{12}$/.test(meta.revision), 'Theme build identity is invalid');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.equal(meta.version, version, 'Theme build version differs from package.json');
  assert.equal(meta.revision, computeBuildRevision(root), 'Theme build is stale relative to current source/configuration; run pnpm run build-only first');
  assert.equal(meta.query, `v=${encodeURIComponent(version)}&r=${encodeURIComponent(meta.revision)}`, 'Theme build query differs from its identity');
  return manifest;
}
