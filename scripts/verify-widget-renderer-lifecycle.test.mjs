import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Keep the production runtime intact; control only its renderer loading boundary.
const loaderUrl = new URL('../src/widgets/loaders.js', import.meta.url).href;
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
  export const requests = [];
  export function loadWidgetRenderer(type) {
    return new Promise((resolve, reject) => requests.push({ type, resolve, reject }));
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (new URL(specifier, context.parentURL).href === loaderUrl) {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
const { ensureWidgetRendererRuntime } = await import('../src/shell/desktop-shell/runtime/widgets/render-runtime.js');
const { requests } = await import(fixtureUrl);
hooks.deregister();

function host() {
  const events = [];
  return {
    widgetsDisposed: false,
    widgetRenderers: {}, widgetRendererPromises: {},
    widgetRendererErrors: { clock: 'previous error' }, widgetRenderVersions: { clock: 4 },
    _widgetHtmlCache: new Map([['existing', '<p>cached</p>']]), events,
    onWidgetRendererReady: (type) => events.push(['ready', type]),
    onWidgetRendererError: (type, error) => events.push(['error', type, error.message])
  };
}

function assertDisposedState(state) {
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.widgetRenderers, {});
  assert.deepEqual(state.widgetRendererErrors, { clock: 'previous error' });
  assert.deepEqual(state.widgetRenderVersions, { clock: 4 });
  assert.deepEqual([...state._widgetHtmlCache], [['existing', '<p>cached</p>']]);
  assert.deepEqual(state.widgetRendererPromises, {});
}

test('disposed host ignores a renderer that resolves after destruction', async () => {
  const state = host();
  const result = ensureWidgetRendererRuntime(state, 'clock');
  state.widgetsDisposed = true;
  requests.at(-1).resolve(() => '<p>clock</p>');
  assert.equal(await result, null);
  assertDisposedState(state);
});

test('disposed host ignores a renderer that rejects after destruction', async () => {
  const state = host();
  const result = ensureWidgetRendererRuntime(state, 'clock');
  state.widgetsDisposed = true;
  requests.at(-1).reject(new Error('late failure'));
  assert.equal(await result, null);
  assertDisposedState(state);
});

test('already disposed host returns null before reading a cached renderer or starting a load', async () => {
  const state = host();
  const renderer = () => 'cached';
  state.widgetRenderers.clock = renderer;
  state.widgetsDisposed = true;
  const count = requests.length;
  assert.equal(await ensureWidgetRendererRuntime(state, 'clock'), null);
  assert.equal(await ensureWidgetRendererRuntime(state, 'weather'), null);
  assert.equal(requests.length, count);
  assert.deepEqual(state.widgetRendererPromises, {});
  assert.deepEqual(state.events, []);
});

test('live host merges same-type requests, caches success and keeps different types independent', async () => {
  const state = host();
  const count = requests.length;
  const first = ensureWidgetRendererRuntime(state, ' clock ');
  const second = ensureWidgetRendererRuntime(state, 'clock');
  const weather = ensureWidgetRendererRuntime(state, 'weather');
  assert.equal(requests.length, count + 2);
  assert.deepEqual(requests.slice(count).map((request) => request.type), ['clock', 'weather']);
  const clockRenderer = () => 'clock';
  const weatherRenderer = () => 'weather';
  requests[count + 1].resolve(weatherRenderer);
  assert.equal(await weather, weatherRenderer);
  assert.equal(state.widgetRenderers.clock, undefined);
  requests[count].resolve(clockRenderer);
  assert.deepEqual(await Promise.all([first, second]), [clockRenderer, clockRenderer]);
  assert.equal(state.widgetRenderVersions.clock, 5);
  assert.equal(state.widgetRenderVersions.weather, 1);
  assert.deepEqual(state.widgetRendererErrors, {});
  assert.deepEqual(state.events, [['ready', 'weather'], ['ready', 'clock']]);
  assert.deepEqual(state.widgetRendererPromises, {});
  assert.equal(await ensureWidgetRendererRuntime(state, 'clock'), clockRenderer);
  assert.equal(requests.length, count + 2);
});

test('live host reports load failure and permits a successful retry', async () => {
  const state = host();
  const failed = ensureWidgetRendererRuntime(state, 'clock');
  requests.at(-1).reject(new Error('resource unavailable'));
  assert.equal(await failed, null);
  assert.equal(state.widgetRendererErrors.clock, 'resource unavailable');
  assert.equal(state.widgetRenderVersions.clock, 5);
  assert.deepEqual(state.events, [['error', 'clock', 'resource unavailable']]);
  assert.deepEqual(state.widgetRendererPromises, {});
  const retry = ensureWidgetRendererRuntime(state, 'clock');
  const renderer = () => 'recovered';
  requests.at(-1).resolve(renderer);
  assert.equal(await retry, renderer);
  assert.deepEqual(state.widgetRendererErrors, {});
  assert.equal(state.widgetRenderVersions.clock, 6);
  assert.deepEqual(state.events, [['error', 'clock', 'resource unavailable'], ['ready', 'clock']]);
  assert.deepEqual(state.widgetRendererPromises, {});
});
