import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/shell/desktop-shell/runtime/desktop/search.js', import.meta.url), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function eventTarget(properties = {}) {
  const listeners = new Map();
  return Object.assign(properties, {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, data = {}) { for (const listener of [...(listeners.get(type) || [])]) listener({ type, ...data }); },
    listenerCount: () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
  });
}
function fixture({ installed = true } = {}) {
  const loads = [], events = [], warnings = [];
  const window = eventTarget({
    requestAnimationFrame() {}, setTimeout, clearTimeout,
    SearchWidget: installed ? { open() { events.push('official-open'); } } : undefined,
  });
  const document = eventTarget({
    querySelectorAll: () => [{ shadowRoot: {
      getElementById: () => ({}), querySelector: (selector) => selector === 'form' ? {} : null,
    } }],
  });
  const context = vm.createContext({
    window, document,
    console: { warn: (...args) => warnings.push(args) },
    __loadSearchRuntime() { const load = deferred(); loads.push(load); return load.promise; },
  });
  vm.runInContext(source.replace(/^export /gm, '').replace("import('./search-runtime.js')", '__loadSearchRuntime()'), context);
  const runtime = { openSearchWidget() { events.push('style-ready'); window.SearchWidget?.open?.(); } };
  return { window, document, loads, events, warnings, runtime, open: context.openSearchWidget,
    listenerCount: () => window.listenerCount() + document.listenerCount() };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('search has no first-paint import/listener and missing official plugin returns false', () => {
  const f = fixture({ installed: false });
  assert.equal(f.loads.length, 0);
  assert.equal(f.listenerCount(), 0);
  assert.equal(f.open(), false);
  assert.equal(f.loads.length, 0);
  assert.equal(f.listenerCount(), 0);
});

test('the synchronous boolean wrapper merges repeated triggers and prepares styles before official open', async () => {
  const f = fixture();
  assert.equal(f.open(), true);
  assert.equal(f.open(), true);
  assert.equal(f.loads.length, 1);
  assert.deepEqual(f.events, [], 'official search must not open before its runtime is ready');
  f.loads[0].resolve(f.runtime);
  await flush();
  assert.deepEqual(f.events, ['style-ready', 'official-open']);
  assert.equal(f.listenerCount(), 0);
  assert.equal(f.open(), true);
  await flush();
  assert.equal(f.loads.length, 1, 'a loaded runtime is reused without another network request');
  assert.equal(f.events.filter((event) => event === 'official-open').length, 2);
});

for (const [target, type, data] of [
  ['window', 'keydown', { key: 'Escape' }],
  ['document', 'theme:navigation-accepted', {}],
  ['window', 'pagehide', {}],
  ['window', 'popstate', {}],
]) {
  test(`${type} cancels a pending search without leaving listeners`, async () => {
    const f = fixture();
    f.open();
    f[target].emit(type, data);
    assert.equal(f.listenerCount(), 0);
    f.loads[0].resolve(f.runtime);
    await flush();
    assert.deepEqual(f.events, []);
    f.open();
    await flush();
    assert.deepEqual(f.events, ['style-ready', 'official-open'], 'a fresh request may open after cancellation');
  });
}

test('a fresh request during a cancelled import opens exactly once', async () => {
  const f = fixture();
  f.open();
  f.window.emit('keydown', { key: 'Escape' });
  f.open();
  assert.equal(f.loads.length, 1);
  f.loads[0].resolve(f.runtime);
  await flush();
  assert.deepEqual(f.events, ['style-ready', 'official-open']);
  assert.equal(f.listenerCount(), 0);
});

test('failed import warns, falls back to official search, and is retried next time', async () => {
  const f = fixture();
  const failure = new Error('offline chunk');
  f.open();
  f.loads[0].reject(failure);
  await flush();
  assert.deepEqual(f.events, ['official-open']);
  assert.equal(f.warnings.length, 1);
  assert.equal(f.warnings[0][1], failure);
  assert.equal(f.listenerCount(), 0);
  f.open();
  assert.equal(f.loads.length, 2);
  f.loads[1].resolve(f.runtime);
  await flush();
  assert.deepEqual(f.events, ['official-open', 'style-ready', 'official-open']);
});

test('a cancelled failed load cannot reopen the official fallback', async () => {
  const f = fixture();
  f.open();
  f.document.emit('theme:navigation-accepted');
  f.loads[0].reject(new Error('offline chunk'));
  await flush();
  assert.deepEqual(f.events, []);
  assert.equal(f.listenerCount(), 0);
});

test('removal of the official plugin while loading cancels the open', async () => {
  const f = fixture();
  f.open();
  delete f.window.SearchWidget;
  f.loads[0].resolve(f.runtime);
  await flush();
  assert.deepEqual(f.events, []);
  assert.equal(f.listenerCount(), 0);
});

test('official fallback errors remain visible and the next attempt is still usable', async () => {
  const f = fixture();
  const failure = new Error('official search failed');
  f.window.SearchWidget.open = () => { throw failure; };
  f.open();
  f.loads[0].reject(new Error('offline chunk'));
  await flush();
  assert.ok(f.warnings.some((args) => args[1] === failure));
  assert.equal(f.listenerCount(), 0);
  f.open();
  assert.equal(f.loads.length, 2);
  f.loads[1].resolve({ openSearchWidget() {} });
  await flush();
});
