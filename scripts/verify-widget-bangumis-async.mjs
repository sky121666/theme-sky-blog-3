import assert from 'node:assert/strict';
import {
  createBangumiWidgetDataStore,
  fetchBangumiPagePayload,
  parseBangumiPagePayload
} from '../src/widgets/plugin/bangumis-recent/data.js';
import { renderWidget as renderBangumiWidget } from '../src/widgets/plugin/bangumis-recent/render.js';
import {
  renderWidgetBodyWithHost,
  retryBangumiWidgetDataWithHost
} from '../src/shell/desktop-shell/runtime/widgets/render-runtime.js';

const page = (payload) => `<!doctype html><html><body>
  <script type="application/json" data-bangumi-widget-payload>${JSON.stringify(payload)}</script>
</body></html>`;

const expected = { typeNum: 2, status: 3, size: 4 };
const item = { metadata: { name: 'show-1' }, spec: { title: '已看剧集' } };
const parsed = parseBangumiPagePayload(page({ ...expected, total: 9, items: [item] }), expected);
assert.deepEqual(parsed, { ...expected, total: 9, items: [item] });

for (const mismatch of [
  { ...expected, typeNum: 1 },
  { ...expected, status: 2 },
  { ...expected, size: 2 }
]) {
  assert.throws(
    () => parseBangumiPagePayload(page({ ...mismatch, total: 9, items: [item] }), expected),
    /identity|匹配/,
    'stale or redirected route payload must not be displayed under another selection'
  );
}
assert.throws(() => parseBangumiPagePayload(page({ ...expected, total: 0, items: {} }), expected), /items/);
assert.throws(() => parseBangumiPagePayload(page({ ...expected, total: -1, items: [] }), expected), /total/);
assert.throws(() => parseBangumiPagePayload('<html><body>无数据</body></html>', expected), /payload/);
assert.throws(
  () => parseBangumiPagePayload(page({ ...expected, total: 9, items: [item] }).replace('</html>', ''), expected),
  /complete|完整/,
  'a committed response truncated after the early payload must not be treated as complete'
);

const requestedUrls = [];
const fetched = await fetchBangumiPagePayload(
  { typeNum: 2, status: 3, size: 4 },
  { fetchImpl: async (url) => {
    requestedUrls.push(url);
    return { ok: true, text: async () => page({ ...expected, total: 9, items: [item] }) };
  } }
);
assert.deepEqual(requestedUrls, ['/bangumis?typeNum=2&status=3&size=4']);
assert.equal(fetched.total, 9);

const explicitCalls = [];
let releaseExplicit;
const explicitStore = createBangumiWidgetDataStore({
  fetchPage: async (request) => {
    explicitCalls.push(request);
    await new Promise((resolve) => { releaseExplicit = resolve; });
    return { ...request, total: 1, items: [item] };
  }
});
const explicitWidget = { widget: 'plugin-bangumis.recent', size: 'medium', meta: { typeNum: '2', status: 'done' } };
const duplicateWidget = { ...explicitWidget, key: 'duplicate' };
const firstLoad = explicitStore.load(explicitWidget);
const secondLoad = explicitStore.load(duplicateWidget);
await Promise.resolve();
assert.deepEqual(explicitCalls, [{ typeNum: 2, status: 3, size: 4 }], 'same combination is fetched once');
assert.equal(explicitStore.get(explicitWidget).status, 'loading');
releaseExplicit();
await Promise.all([firstLoad, secondLoad]);
assert.equal(explicitStore.get(explicitWidget).status, 'ready');
assert.equal(explicitStore.get(duplicateWidget).sources.bangumiStatusCounts.drama.done, 1);

const autoCalls = [];
const autoStore = createBangumiWidgetDataStore({
  fetchPage: async (request) => {
    autoCalls.push(`${request.typeNum}:${request.status}`);
    return { ...request, total: request.status === 1 ? 2 : 0, items: request.status === 1 ? [item] : [] };
  }
});
const autoWidget = { widget: 'plugin-bangumis.recent', size: 'small', meta: { typeNum: '1', status: 'auto' } };
await autoStore.load(autoWidget);
assert.deepEqual(autoCalls, ['1:2', '1:1'], 'automatic small widget stops at the first populated status');
assert.equal(autoStore.get(autoWidget).sources.bangumisByStatus.anime.wish[0].spec.title, '已看剧集');

let failed = true;
const retryCalls = [];
const retryStore = createBangumiWidgetDataStore({
  fetchPage: async (request) => {
    retryCalls.push(request);
    if (failed) throw new Error('HTTP 503');
    return { ...request, total: 0, items: [] };
  }
});
await assert.rejects(retryStore.load(explicitWidget), /503/);
assert.equal(retryStore.get(explicitWidget).status, 'error');
failed = false;
await retryStore.retry(explicitWidget);
assert.equal(retryStore.get(explicitWidget).status, 'ready');
assert.equal(retryCalls.length, 2, 'retry refetches a failed combination');
assert.equal(retryStore.get(explicitWidget).sources.bangumiStatusCounts.drama.done, 0, 'only a successful empty response becomes zero');

let timeoutSignal;
await assert.rejects(
  fetchBangumiPagePayload({ typeNum: 1, status: 2, size: 4 }, {
    timeoutMs: 10,
    fetchImpl: (_url, options) => {
      timeoutSignal = options.signal;
      return new Promise(() => {});
    }
  }),
  /timed out|超时/
);
assert.equal(timeoutSignal.aborted, true, 'timeout aborts the abandoned fetch');

let visibleCalls = 0;
const visibleStore = createBangumiWidgetDataStore({
  fetchPage: async (request) => {
    visibleCalls += 1;
    return { ...request, total: 1, items: [item] };
  }
});
let changed = 0;
const host = {
  sources: { hydrated: true, bangumisAvailable: true },
  bangumiWidgetDataStore: visibleStore,
  widgetRenderers: { 'plugin-bangumis.recent': renderBangumiWidget },
  widgetRendererPromises: {},
  widgetRendererErrors: {},
  widgetRenderVersions: {},
  _widgetHtmlCache: new Map(),
  onWidgetDataChanged: () => { changed += 1; }
};
assert.match(renderWidgetBodyWithHost(host, explicitWidget, { mode: 'preview' }), /预览|加载/);
assert.equal(visibleCalls, 0, 'catalog preview does not request Bilibili data');
assert.match(renderWidgetBodyWithHost(host, explicitWidget), /加载中/);
await visibleStore.load(explicitWidget);
await new Promise((resolve) => setImmediate(resolve));
const readyHtml = renderWidgetBodyWithHost(host, explicitWidget);
assert.match(readyHtml, /已看剧集/, 'ready widget renders the fetched route payload');
assert.equal(visibleCalls, 1);
assert.equal(changed, 1, 'async completion invalidates the host render');

const brokenStore = createBangumiWidgetDataStore({ fetchPage: async () => { throw new Error('HTTP 503'); } });
const brokenHost = { ...host, bangumiWidgetDataStore: brokenStore, _widgetHtmlCache: new Map(), _bangumiWidgetPending: new Map() };
assert.match(renderWidgetBodyWithHost(brokenHost, explicitWidget), /加载中/);
await assert.rejects(brokenStore.load(explicitWidget), /503/);
await new Promise((resolve) => setImmediate(resolve));
const errorHtml = renderWidgetBodyWithHost(brokenHost, explicitWidget);
assert.match(errorHtml, /重试/);
assert.doesNotMatch(errorHtml, /还没有追番记录|共追了 0/);
const invisibleStore = createBangumiWidgetDataStore({ fetchPage: async () => { throw new Error('unexpected fetch'); } });
const invisibleHost = { ...host, bangumiWidgetDataStore: invisibleStore, _widgetHtmlCache: new Map() };
assert.match(renderWidgetBodyWithHost(invisibleHost, explicitWidget, { visible: false }), /加载中/);
assert.equal(invisibleStore.get(explicitWidget), null, 'hidden notification widget must not start a request');

let retryShouldFail = true;
const interactiveStore = createBangumiWidgetDataStore({
  fetchPage: async (request) => {
    if (retryShouldFail) throw new Error('HTTP 503');
    return { ...request, total: 1, items: [item] };
  }
});
const interactiveHost = { ...host, bangumiWidgetDataStore: interactiveStore, _widgetHtmlCache: new Map(), _bangumiWidgetPending: new Map(), widgetRenderVersions: {} };
await assert.rejects(interactiveStore.load(explicitWidget), /503/);
assert.match(renderWidgetBodyWithHost(interactiveHost, explicitWidget), /重试/);
retryShouldFail = false;
await retryBangumiWidgetDataWithHost(interactiveHost, explicitWidget);
await new Promise((resolve) => setImmediate(resolve));
assert.match(renderWidgetBodyWithHost(interactiveHost, explicitWidget), /已看剧集/);
const missingDataHtml = renderBangumiWidget(
  { sources: { bangumisAvailable: true }, escapeHtml: String, mode: 'live' },
  explicitWidget
);
assert.match(missingDataHtml, /加载中/, 'missing data is pending, not a known empty collection');
assert.doesNotMatch(missingDataHtml, /还没有追番记录/);

console.log('bangumis async payload contract passed');
