import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const layout = readFileSync(new URL('../templates/layout.html', import.meta.url), 'utf8');
const surfaceStyle = readFileSync(new URL('../src/shell/desktop-shell/styles/desktop/surface.css', import.meta.url), 'utf8');
const bootstrap = [...layout.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((code) => code.includes("localStorage.getItem('theme')"));

assert.ok(bootstrap, 'page layout appearance bootstrap exists');
assert.match(layout, /th:fragment="html\s*\(\s*head\s*,\s*content\s*\)"/);
assert.match(layout, /<title\s+th:if="\$\{head == null\}"/);
assert.match(layout, /th:replace="\$\{head\}"/);
assert.match(layout, /th:replace="\$\{content\}"/);
assert.match(layout, /<halo:footer\s*\/>/);

const shellStyle = layout.indexOf('/assets/css/shell-core/index.css');
const scopedBase = layout.indexOf('@layer base');
const pluginHead = layout.indexOf('th:replace="${head}"');
assert.ok(shellStyle >= 0 && shellStyle < scopedBase && scopedBase < pluginHead,
  'scoped base styles follow the desktop reset and precede plugin head styles');
for (const selector of [':where(h1)', ':where(ul)', ':where(ol)', ':where(a)', ':where(pre)']) {
  assert.ok(layout.includes(selector), `plugin content restores ${selector}`);
}

const body = layout.match(/<body\b[\s\S]*?>/)?.[0];
assert.ok(body, 'page layout body exists');
assert.match(body, /legacyCustomScheme=/);
assert.match(body, /schemeMode == 'custom'/);
for (const property of [
  '--mac-accent', '--mac-selection', '--mac-folder1', '--mac-folder2',
  '--mac-folder3', '--mac-shell-light', '--mac-shell-dark'
]) {
  assert.ok(body.includes(`${property}:' +`), `custom appearance injects ${property}`);
  assert.ok(surfaceStyle.includes(`var(${property},`), `desktop surface consumes ${property}`);
}
assert.match(body, /th:styleappend="\$\{backgroundMode == 'solid'/,
  'background mode remains independent of custom appearance');

function runBootstrap({ configured = 'system', saved, osDark = false, denyStorage = false }) {
  const classes = new Set(['halo-plugin-layout']);
  const root = {
    dataset: { defaultTheme: configured },
    style: {},
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      }
    }
  };
  const listeners = new Map();
  const media = {
    matches: osDark,
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const sandbox = {
    document: { documentElement: root },
    window: { matchMedia: () => media }
  };
  if (denyStorage) {
    Object.defineProperty(sandbox, 'localStorage', {
      get() { throw new Error('SecurityError'); }
    });
  } else {
    sandbox.localStorage = { getItem: () => saved };
  }
  vm.runInNewContext(bootstrap, sandbox);
  return { root, classes, listeners, media };
}

for (const mode of ['light', 'dark', 'system']) {
  const state = runBootstrap({ saved: mode, osDark: false });
  assert.equal(state.root.dataset.colorScheme, mode === 'system' ? 'auto' : mode);
  assert.ok(state.classes.has(mode === 'system' ? 'color-scheme-auto' : `color-scheme-${mode}`));
  assert.equal(state.root.dataset.theme, mode === 'dark' ? 'dark' : 'light');
  assert.equal(state.listeners.has('change'), mode === 'system');
  state.media.matches = true;
  state.listeners.get('change')?.();
  assert.equal(state.root.dataset.theme, mode === 'light' ? 'light' : 'dark');
  assert.equal(state.classes.has('dark'), mode !== 'light');
  assert.equal(state.root.style.colorScheme, mode === 'light' ? 'light' : 'dark');
}

const denied = runBootstrap({ configured: 'dark', denyStorage: true });
assert.equal(denied.root.dataset.colorScheme, 'dark');
assert.equal(denied.root.dataset.theme, 'dark');
const invalid = runBootstrap({ configured: 'invalid', saved: 'invalid', osDark: true });
assert.equal(invalid.root.dataset.colorScheme, 'auto');
assert.equal(invalid.root.dataset.theme, 'dark');

console.log('Halo page layout contract, appearance bootstrap, custom tokens and scoped content defaults passed.');
