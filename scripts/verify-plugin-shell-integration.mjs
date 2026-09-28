import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { initAuthThemeToggle } from '../src/entries/auth.js';
import {
  applyRootThemeState,
  persistThemeMode,
  resolveThemeMode
} from '../src/shell/desktop-shell/runtime/shared/theme.js';

function root(defaultTheme = 'system') {
  const classes = new Set();
  const attributes = new Map([['data-default-theme', defaultTheme]]);
  return {
    dataset: { defaultTheme }, style: {}, classes, attributes,
    classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)) },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name)
  };
}

const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
globalThis.document = { documentElement: root('dark') };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: denied });
assert.equal(resolveThemeMode(), 'dark', 'storage denial must preserve the configured default');
assert.equal(persistThemeMode('light'), 'light');
assert.equal(resolveThemeMode(), 'light', 'PJAX refresh must preserve the in-memory selection when storage is denied');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'light', setItem: denied.setItem } });
persistThemeMode('dark');
assert.equal(resolveThemeMode(), 'dark', 'failed writes must not restore an older readable preference');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'invalid mode', setItem() {} } });
persistThemeMode('system');
assert.equal(resolveThemeMode(), 'dark', 'invalid persisted values must use the configured default');

for (const mode of ['light', 'dark', 'system']) {
  for (const osDark of [false, true]) {
    const element = root(); document.documentElement = element;
    const expectedDark = mode === 'dark' || (mode === 'system' && osDark);
    assert.equal(applyRootThemeState(mode, { matches: osDark }), expectedDark);
    assert.equal(element.classes.has(mode === 'system' ? 'color-scheme-auto' : `color-scheme-${mode}`), true);
    assert.equal(element.classes.has('dark'), expectedDark);
    assert.equal(element.attributes.get('data-theme'), expectedDark ? 'dark' : 'light');
    assert.equal(element.style.colorScheme, expectedDark ? 'dark' : 'light');
  }
}

// Execute both actual SSR bootstrap scripts; an inaccessible storage getter is
// different from a getItem method throwing and used to abort the whole script.
for (const file of ['templates/modules/shell/layout.html', 'templates/gateway_fragments/layout.html']) {
  const template = await fs.readFile(file, 'utf8');
  const source = [...template.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(code => code.includes("localStorage.getItem('theme')"));
  assert.ok(source, `${file}: missing appearance bootstrap`);
  for (const defaultTheme of ['light', 'dark', 'system', 'invalid']) {
    const element = root(defaultTheme);
    const sandbox = { document: { documentElement: element }, window: { matchMedia: () => ({ matches: true }) } };
    Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('SecurityError'); } });
    vm.runInNewContext(source, sandbox);
    const mode = defaultTheme === 'invalid' ? 'system' : defaultTheme;
    assert.ok(element.classes.has(mode === 'system' ? 'color-scheme-auto' : `color-scheme-${mode}`), `${file}: official plugin color marker`);
    assert.equal(element.classes.has('dark'), mode !== 'light', `${file}: resolved system appearance`);
    assert.equal(element.attributes.get('data-theme'), mode === 'light' ? 'light' : 'dark');
  }
}

const authRoot = root('system');
const handlers = new Map();
const button = {
  dataset: {},
  setAttribute() {},
  querySelector() { return null; },
  addEventListener(type, callback) { handlers.set(type, callback); },
  removeEventListener(type, callback) { if (handlers.get(type) === callback) handlers.delete(type); }
};
globalThis.document = { documentElement: authRoot, querySelectorAll: () => [button] };
const mediaHandlers = new Map();
globalThis.window = { matchMedia: () => ({
  matches: true,
  addEventListener: (type, callback) => mediaHandlers.set(type, callback),
  removeEventListener: type => mediaHandlers.delete(type)
}) };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: denied });
const disposeAuth = initAuthThemeToggle();
assert.ok(authRoot.classes.has('dark'), 'auth runtime must preserve system-dark styling after SSR bootstrap');
handlers.get('click')();
assert.equal(authRoot.attributes.get('data-theme'), 'light', 'blocked storage must not prevent auth appearance toggling');
handlers.get('click')();
assert.equal(authRoot.attributes.get('data-theme'), 'dark', 'auth must retain the failed-write preference between clicks');
disposeAuth();
assert.equal(handlers.size, 0);
assert.equal(mediaHandlers.size, 0);

console.log('Plugin shell integration passed: blocked storage, failed writes, PJAX preference, both SSR bootstraps and auth system-dark/toggle cleanup.');
