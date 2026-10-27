import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { computeBuildRevision, assertCurrentBuild } from './lib/build-identity.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-build-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  write('package.json', JSON.stringify({ version: '1.2.3' }));
  write('src/app.js', 'export const value = 1;');
  write('templates/index.html', '<main>fixture</main>');
  write('settings.yaml', 'fixture: true');
  write('vite.config.ts', '// fixture build');
  const build = () => {
    const revision = computeBuildRevision(root);
    const manifest = { __meta: { version: '1.2.3', revision, query: `v=1.2.3&r=${revision}` } };
    write('templates/assets/asset-manifest.json', JSON.stringify(manifest));
    return manifest;
  };
  return { root, write, build };
}

test('accepts the current build and rejects changed source until rebuilt', (t) => {
  const f = fixture(t);
  const first = f.build();
  assert.deepEqual(assertCurrentBuild(f.root), first);
  f.write('src/app.js', 'export const value = 2;');
  assert.throws(() => assertCurrentBuild(f.root), /stale/);
  const next = f.build();
  assert.notEqual(next.__meta.revision, first.__meta.revision);
  assert.deepEqual(assertCurrentBuild(f.root), next);
});

test('template, settings, patch and build helper changes invalidate the build', (t) => {
  const f = fixture(t);
  for (const name of ['templates/index.html', 'settings.yaml', 'patches/fixture.patch', 'scripts/lib/build-identity.mjs', 'scripts/theme-build-styles.mjs', 'scripts/theme-startup.mjs', 'scripts/theme-desktop-preview.mjs']) {
    const before = f.build().__meta.revision;
    f.write(name, `changed ${name}`);
    assert.notEqual(computeBuildRevision(f.root), before, name);
    assert.throws(() => assertCurrentBuild(f.root), /stale/, name);
  }
});

test('docs, test fixtures and generated assets do not invalidate build inputs', (t) => {
  const f = fixture(t);
  const current = f.build();
  for (const name of ['docs/商城/演示素材/sample.png', 'scripts/fixtures/images/sample.png', 'output/report.json', 'templates/assets/js/app.js']) {
    f.write(name, 'not a build input');
  }
  assert.equal(computeBuildRevision(f.root), current.__meta.revision);
  assert.deepEqual(assertCurrentBuild(f.root), current);
});

test('rejects missing, malformed and mismatched build identities before browser startup', (t) => {
  const f = fixture(t);
  assert.throws(() => assertCurrentBuild(f.root), /build.*missing/i);
  f.write('templates/assets/asset-manifest.json', '{}');
  assert.throws(() => assertCurrentBuild(f.root), /identity/i);
  const manifest = f.build();
  assert.throws(() => assertCurrentBuild(f.root, { ...manifest, __meta: { ...manifest.__meta, version: '1.2.2' } }), /version/);
  assert.throws(() => assertCurrentBuild(f.root, { ...manifest, __meta: { ...manifest.__meta, query: 'wrong' } }), /query/);
});
