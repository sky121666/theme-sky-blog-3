import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { getAppAssetSegment } from '../src/shell-core/runtime/app-manifests.js';

// Exercise the production registry + loader with a DOM boundary fixture. There
// is no browser/server dependency and no generated bundle is used by this test.
const executable = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const registrySource = executable('src/shell-core/runtime/resource-registry.js');
const loaderSource = executable('src/shell-core/runtime/app-loader.js');
const origin = 'https://example.test';
const query = '?v=0.9.51&r=warm-build';
const cssUrl = `/assets/css/apps/reader/index.css${query}`;
const jsUrl = `/assets/js/apps/reader/index.js${query}`;
const flush = async () => { for (let turn = 0; turn < 35; turn++) await Promise.resolve(); };

function fixture(entries = {}, { fetchManifest } = {}) {
  const elements = [];
  const appended = [];
  const timers = new Map();
  let nextTimer = 0;
  let manifestRequests = 0;
  const manifest = {
    __meta: { version: '0.9.51', revision: 'warm-build', query: query.slice(1) },
    reader: { css: ['/assets/css/apps/reader/index.css'], js: ['/assets/js/apps/reader/index.js'] },
    ...entries
  };
  const setTimer = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const matches = (node, selector) => selector.split(',').some((part) => {
    const tag = part.trim().match(/^\w+/)?.[0];
    if (tag && node.tag !== tag) return false;
    return [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) => {
      const actual = node.getAttribute(name);
      return value === undefined ? actual !== null : actual === value;
    });
  });
  const document = {
    querySelector: (selector) => elements.find((node) => matches(node, selector)) || null,
    querySelectorAll: (selector) => elements.filter((node) => matches(node, selector)),
    createElement(tag) {
      const events = new Map();
      const node = {
        tag, dataset: {}, disabled: false, sheet: null,
        getAttribute(name) {
          if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
            return node.dataset[key] ?? null;
          }
          return node[name] ?? null;
        },
        addEventListener(name, callback) {
          if (!events.has(name)) events.set(name, new Set());
          events.get(name).add(callback);
        },
        removeEventListener: (name, callback) => events.get(name)?.delete(callback),
        dispatch(name) { for (const callback of [...(events.get(name) || [])]) callback(); },
        remove() { const index = elements.indexOf(node); if (index >= 0) elements.splice(index, 1); }
      };
      return node;
    },
    head: { appendChild(node) { elements.push(node); appended.push(node); return node; } }
  };
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, DOMException, console, document,
    setTimeout: setTimer, clearTimeout: clearTimer, assetPathSegment: getAppAssetSegment,
    __THEME_BUILD_VERSION__: '0.9.51', __THEME_BUILD_REVISION__: 'warm-build',
    fetch: async (...args) => {
      manifestRequests++;
      return fetchManifest ? fetchManifest(...args) : { ok: true, json: async () => manifest };
    },
    window: {
      location: { origin }, setTimeout: setTimer, clearTimeout: clearTimer,
      __THEME_ASSET_MANIFEST__: fetchManifest ? null : manifest,
      __THEME_ASSET_IDENTITY__: { ...manifest.__meta, source: 'manifest' }
    }
  });
  vm.runInContext(registrySource, context);
  vm.runInContext(loaderSource, context);
  const call = (expression) => vm.runInContext(expression, context);
  return {
    context, elements, appended, document, call, timers,
    manifestRequests: () => manifestRequests,
    warm(appId = 'reader', options = {}) {
      context.warmOptions = options;
      return call(`warmAppAssets(${JSON.stringify(appId)}, warmOptions)`);
    },
    async expire() {
      // Browser timer callbacks have a microtask checkpoint between them.
      const nextDelay = Math.min(...[...timers.values()].map(({ delay }) => delay));
      for (const [id, { callback, delay }] of [...timers]) {
        if (delay !== nextDelay || !timers.has(id)) continue;
        timers.delete(id);
        callback();
        await flush();
      }
    }
  };
}

test('warmup downloads versioned styles and modules without applying or evaluating either', async () => {
  const run = fixture();
  const warming = run.warm();
  await flush();
  assert.equal(run.appended.length, 2, 'reader CSS and JS must both receive download-only hints');
  assert.deepEqual(run.appended.map((node) => [node.tag, node.rel, node.as || '', node.href]), [
    ['link', 'preload', 'style', `${origin}${cssUrl}`],
    ['link', 'modulepreload', '', `${origin}${jsUrl}`]
  ]);
  assert.equal(run.manifestRequests(), 0, 'the running build bootstrap manifest is reusable');
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await warming;
  assert.ok(run.appended.every((node) => node.tag === 'link' && node.rel !== 'stylesheet'));
  assert.equal(run.elements.length, 0, 'settled hints must not accumulate in the document');
  assert.equal(run.timers.size, 0, 'settled hints must release deadlines');
});

test('concurrent and completed warmups reuse one hint per exact build URL', async () => {
  const run = fixture();
  const first = run.warm();
  const second = run.warm(' reader ');
  await flush();
  assert.equal(run.appended.length, 2, 'in-flight warmup must be shared');
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await Promise.all([first, second]);
  await run.warm();
  assert.equal(run.appended.length, 2, 'completed hints must not be downloaded again');
});

test('prewarm never satisfies the real CSS or module registrar loading gate', async () => {
  const run = fixture();
  const warming = run.warm();
  await flush();
  assert.equal(run.appended.length, 2);
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await warming;
  let ready = false;
  const loading = run.call("ensureAppAssetsLoaded('reader')").then(() => { ready = true; });
  await flush();
  assert.deepEqual(run.elements.map((node) => [node.tag, node.rel || '', node.type || '']), [
    ['link', 'stylesheet', ''], ['script', '', 'module']
  ]);
  assert.equal(ready, false, 'actual execution and style readiness remain required');
  run.elements.find((node) => node.tag === 'link').dispatch('load');
  await flush();
  assert.equal(ready, false, 'CSS completion cannot replace module evaluation');
  run.elements.find((node) => node.tag === 'script').dispatch('load');
  await loading;
});

test('real assets already loaded or loading do not receive duplicate hints', async () => {
  const run = fixture();
  const loading = run.call("ensureAppAssetsLoaded('reader')");
  await flush();
  const warming = run.warm();
  await flush();
  assert.equal(run.appended.length, 2, 'formal in-flight resources already cover prewarm');
  for (const node of run.elements.slice()) node.dispatch('load');
  await Promise.all([loading, warming]);
  await run.warm();
  assert.equal(run.appended.length, 2, 'formal ready resources already cover prewarm');
});

test('failed and timed-out hints release state so the next intent retries', async () => {
  const run = fixture();
  const first = run.warm('reader', { timeoutMs: 20 });
  await flush();
  assert.equal(run.elements.length, 2);
  run.elements.find((node) => node.rel === 'preload').dispatch('error');
  run.elements.find((node) => node.rel === 'modulepreload').dispatch('load');
  await first;
  const retry = run.warm('reader', { timeoutMs: 20 });
  await flush();
  assert.equal(run.appended.length, 3, 'only the failed CSS hint needs retry');
  assert.equal(run.elements[0].rel, 'preload');
  await run.expire();
  await retry;
  assert.equal(run.elements.length, 0);
  const last = run.warm();
  await flush();
  assert.equal(run.appended.length, 4, 'timeout must not poison future intent');
  run.elements[0].dispatch('load');
  await last;
});

test('only known apps and same-origin theme CSS/JS assets can be warmed', async () => {
  const run = fixture({ reader: {
    css: ['https://outside.test/evil.css', '//outside.test/assets/css/apps/reader/foreign.css', 'data:text/css,body{}', '/private/account.css', '/assets/css/apps/reader/index.css'],
    js: ['https://fixture-user@example.test/assets/js/private.js', '//fixture-user@example.test/assets/js/private.js', '/assets/js/escape.txt', 'javascript:alert(1)', '/assets/js/apps/reader/index.js']
  } });
  await run.warm('unknown-app');
  await run.warm('');
  assert.equal(run.appended.length, 0, 'unknown or empty app ids cannot generate asset paths');
  const warming = run.warm();
  await flush();
  assert.deepEqual(run.appended.map((node) => node.href).sort(), [`${origin}${cssUrl}`, `${origin}${jsUrl}`]);
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await warming;
});

test('explicitly stale ready assets do not suppress warming of the running build', async () => {
  const run = fixture();
  for (const [tag, kind, path] of [['link', 'css', cssUrl], ['script', 'js', jsUrl]]) {
    const node = run.document.createElement(tag);
    if (tag === 'link') { node.rel = 'stylesheet'; node.href = path.replace('warm-build', 'stale-build'); node.sheet = {}; }
    else { node.type = 'module'; node.src = path.replace('warm-build', 'stale-build'); }
    node.dataset[kind === 'css' ? 'appCssState' : 'appScriptState'] = 'ready';
    run.document.head.appendChild(node);
  }
  const warming = run.warm();
  await flush();
  assert.equal(run.appended.length, 4, 'a different revision must not count as a warm asset');
  for (const hint of run.elements.slice(2)) hint.dispatch('load');
  await warming;
});

test('foreign unversioned assets cannot masquerade as ready theme resources', async () => {
  const run = fixture();
  for (const [tag, kind] of [['link', 'css'], ['script', 'js']]) {
    const node = run.document.createElement(tag);
    node[tag === 'link' ? 'href' : 'src'] = `https://foreign.test/assets/${kind}/apps/reader/index.${kind}`;
    if (tag === 'link') { node.rel = 'stylesheet'; node.sheet = {}; }
    else node.type = 'module';
    node.dataset[kind === 'css' ? 'appCssState' : 'appScriptState'] = 'ready';
    run.document.head.appendChild(node);
  }
  const warming = run.warm();
  await flush();
  assert.equal(run.appended.length, 4, 'URL path equality cannot cross the origin boundary');
  for (const hint of run.elements.slice(2)) hint.dispatch('load');
  await warming;
});

test('hint concurrency stays bounded and a later intent can retry skipped assets', async () => {
  const run = fixture({ reader: {
    css: Array.from({ length: 12 }, (_unused, index) => `/assets/css/chunks/${index}.css`),
    js: Array.from({ length: 12 }, (_unused, index) => `/assets/js/chunks/${index}.js`)
  } });
  const first = run.warm();
  await flush();
  assert.ok(run.elements.length > 0 && run.elements.length <= 8, 'prewarm cannot flood head with unbounded hints');
  assert.ok(run.elements.some((node) => node.rel === 'modulepreload'), 'a long CSS list must leave room for JS');
  const initialCount = run.appended.length;
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await first;
  const next = run.warm();
  await flush();
  assert.ok(run.appended.length > initialCount, 'a capacity skip must remain retryable');
  assert.ok(run.elements.length <= 8);
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await next;
});

test('cancelling a consumer does not cancel shared hints or permit late aborted setup', async () => {
  const run = fixture();
  const consumer = new AbortController();
  const cancelled = run.warm('reader', { signal: consumer.signal });
  const survivor = run.warm();
  await flush();
  assert.equal(run.elements.length, 2);
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  consumer.abort();
  await rejection;
  assert.equal(run.elements.length, 2, 'another consumer still owns the shared warmup');
  for (const hint of run.elements.slice()) hint.dispatch('load');
  await survivor;

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(run.warm('photos', { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(run.appended.length, 2, 'an already aborted intent cannot append hints');
});

test('manifest errors propagate without creating speculative fallback assets', async () => {
  const run = fixture({}, { fetchManifest: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(run.warm(), /asset-manifest 503/);
  assert.equal(run.elements.length, 0);
});
