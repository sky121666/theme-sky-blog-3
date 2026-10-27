import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { computeBuildRevision } from './lib/build-identity.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-release-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  const run = (command, args) => spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: '', PATH: `${path.join(repo, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` }
  });
  write('package.json', JSON.stringify({ version: '1.2.3', type: 'module', scripts: { package: scripts.package } }));
  write('theme.yaml', 'apiVersion: theme.halo.run/v1alpha1\nkind: Theme\nmetadata:\n  name: theme-package-fixture\nspec:\n  version: 1.2.3\n');
  write('settings.yaml', 'kind: Setting\n');
  write('annotation-setting.yaml', 'kind: AnnotationSetting\n');
  write('LICENSE', 'fixture license\n');
  write('THIRD_PARTY_NOTICES.md', 'fixture notices\n');
  write('templates/assets/licenses/THIRD_PARTY_NOTICES.md', 'fixture notices\n');
  write('templates/layout.html', '<main>fixture</main>\n');
  write('templates/index.html', '<main>home</main>\n');
  write('templates/assets/js/shell-core/index.js', 'export const shell = 1;\n');
  write('templates/assets/js/chunks/shared.js', 'export const shared = 1;\n');
  write('templates/assets/css/shell-core/index.css', 'body { color: black; }\n');
  write('templates/assets/images/runtime.png', 'fixture runtime bytes');
  write('src/app.js', 'export const source = 1;\n');
  for (const name of ['lib/build-identity.mjs', 'verify-current-build.mjs', 'finalize-theme-package.mjs', 'verify-release-package.mjs']) {
    write(`scripts/${name}`, fs.readFileSync(path.join(repo, 'scripts', name)));
  }
  const revision = computeBuildRevision(root);
  write('templates/assets/asset-manifest.json', JSON.stringify({
    __meta: { version: '1.2.3', revision, query: `v=1.2.3&r=${revision}` },
    'shell-core': { js: ['/themes/theme-package-fixture/assets/js/shell-core/index.js'], css: ['/themes/theme-package-fixture/assets/css/shell-core/index.css'] }
  }));
  const zip = path.join(root, 'dist/theme-package-fixture-1.2.3.zip');
  const pack = () => run(process.env.SHELL || '/bin/sh', ['-c', scripts.package]);
  const verify = () => run(process.execPath, ['scripts/verify-release-package.mjs', zip]);
  const updateZip = (entry) => run('zip', ['-q', '-X', zip, entry]);
  return { root, zip, write, run, pack, verify, updateZip };
}

function passed(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test('packages current runtime files and excludes development materials', (t) => {
  const f = fixture(t);
  f.write('docs/demo.png', 'development image');
  f.write('scripts/fixtures/images/test.png', 'test image');
  f.write('templates/assets/images/shop-demo/old.png', 'legacy development image');
  passed(f.pack());
  const listing = f.run('unzip', ['-Z1', f.zip]);
  passed(listing);
  assert.match(listing.stdout, /templates\/assets\/images\/runtime\.png/);
  assert.doesNotMatch(listing.stdout, /(?:^docs\/|^scripts\/|\/shop-demo\/)/m);
  passed(f.verify());
});

test('rejects stale source before overwriting an existing package', (t) => {
  const f = fixture(t);
  passed(f.pack());
  const previous = fs.readFileSync(f.zip);
  f.write('src/app.js', 'export const source = 2;\n');
  const result = f.pack();
  assert.notEqual(result.status, 0, 'stale source must not be packaged');
  assert.match(result.stderr + result.stdout, /stale/i);
  assert.deepEqual(fs.readFileSync(f.zip), previous, 'failed preflight preserves the previous package');
});

test('finalizer independently rejects source changes made after packaging', (t) => {
  const f = fixture(t);
  passed(f.pack());
  const previous = fs.readFileSync(f.zip);
  f.write('src/app.js', 'export const source = 2;\n');
  const result = f.run(process.execPath, ['scripts/finalize-theme-package.mjs']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /stale/i);
  assert.deepEqual(fs.readFileSync(f.zip), previous);
});

test('rejects leftover runtime files absent from the current workspace', async (t) => {
  for (const entry of ['templates/assets/js/chunks/obsolete.js', 'theme-setting.yaml']) {
    await t.test(entry, (t) => {
      const f = fixture(t);
      passed(f.pack());
      f.write(entry, 'obsolete bytes');
      passed(f.updateZip(entry));
      fs.unlinkSync(path.join(f.root, entry));
      const result = f.verify();
      assert.notEqual(result.status, 0, `an extra runtime file ${entry} must fail`);
      assert.ok((result.stderr + result.stdout).includes(entry));
    });
  }
});

test('rejects packages missing runtime entries', async (t) => {
  for (const entry of ['settings.yaml', 'annotation-setting.yaml', 'templates/index.html', 'templates/assets/asset-manifest.json', 'templates/assets/js/shell-core/index.js', 'templates/assets/js/chunks/shared.js', 'templates/assets/css/shell-core/index.css']) {
    await t.test(entry, (t) => {
      const f = fixture(t);
      passed(f.pack());
      passed(f.run('zip', ['-q', '-d', f.zip, entry]));
      const result = f.verify();
      assert.notEqual(result.status, 0, `missing ${entry} must fail`);
      assert.ok((result.stderr + result.stdout).includes(entry));
    });
  }
});

test('rejects old or altered runtime bytes even when the version is unchanged', async (t) => {
  for (const entry of ['settings.yaml', 'templates/assets/asset-manifest.json', 'templates/assets/js/shell-core/index.js', 'templates/assets/js/chunks/shared.js', 'templates/assets/css/shell-core/index.css', 'templates/assets/images/runtime.png']) {
    await t.test(entry, (t) => {
      const f = fixture(t);
      passed(f.pack());
      const original = fs.readFileSync(path.join(f.root, entry));
      f.write(entry, 'different package bytes');
      passed(f.updateZip(entry));
      f.write(entry, original);
      const result = f.verify();
      assert.notEqual(result.status, 0, `changed ${entry} must fail`);
      assert.ok((result.stderr + result.stdout).includes(entry));
    });
  }
});

test('rejects development assets injected after packaging', async (t) => {
  for (const entry of ['docs/demo.png', 'scripts/fixtures/images/test.png', 'templates/assets/images/shop-demo/old.png']) {
    await t.test(entry, (t) => {
      const f = fixture(t);
      passed(f.pack());
      f.write(entry, 'development image');
      passed(f.updateZip(entry));
      const result = f.verify();
      assert.notEqual(result.status, 0, `development asset ${entry} must fail`);
      assert.ok((result.stderr + result.stdout).includes(entry));
    });
  }
});
