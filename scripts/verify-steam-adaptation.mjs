import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  formatSteamPlaytime,
  isSteamGameUnavailable,
  resolveSteamGameImage
} from '../src/apps/steam/model.js';
import { steamAppManifest } from '../src/apps/steam/manifest.js';
import { stripSteamSiteTitleSuffix } from '../src/apps/steam/title.js';
import {
  heatmapThemeColors,
  parseSteamRecent,
  registerSteamExplorer
} from '../src/apps/steam/runtime.js';

const template = fs.readFileSync(new URL('../templates/modules/steam-app/list.html', import.meta.url), 'utf8');
const pageTemplate = fs.readFileSync(new URL('../templates/steam.html', import.meta.url), 'utf8');
const hydrateSource = fs.readFileSync(new URL('../src/apps/steam/hydrate.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/apps/steam/runtime.js', import.meta.url), 'utf8');

assert.equal(
  resolveSteamGameImage({ headerImageUrl: '', realHeaderImage: 'https://cdn.example.test/real.jpg' }),
  'https://cdn.example.test/real.jpg',
  'empty accelerated header should fall back to realHeaderImage'
);
assert.equal(
  resolveSteamGameImage({ headerImageUrl: null, realHeaderImage: null }),
  '',
  'missing Steam images should keep the placeholder path'
);
assert.equal(
  resolveSteamGameImage({ headerImageUrl: 'https://cdn.example.test/hidden.jpg', delisted: true }),
  '',
  'delisted games should not expose a store cover'
);
assert.equal(isSteamGameUnavailable({ delisted: 'true' }), true, 'serialized delisted state should be supported');
assert.equal(formatSteamPlaytime('1289h 44m', 1), '1289h 44m', 'plugin formatted playtime should win');
assert.equal(formatSteamPlaytime('', 125), '2h 5m', 'raw minutes should have a stable fallback format');
assert.equal(formatSteamPlaytime('', 45), '45m', 'sub-hour playtime should not render a decimal hour');
assert.equal(formatSteamPlaytime('', null, '--'), '--', 'missing playtime should preserve the caller fallback');
assert.equal(parseSteamRecent(1_700_000_000), 1_700_000_000_000, 'Steam epoch seconds should normalize to milliseconds');
assert.equal(heatmapThemeColors('fire').at(-1), '#f5a524', 'Steam 1.0.0 fire heatmap theme should use the orange palette');
assert.equal(
  parseSteamRecent(0, '2026-07-20'),
  new Date(2026, 6, 20).getTime(),
  'formatted last-played date should remain sortable'
);
assert.equal(
  stripSteamSiteTitleSuffix('Steam 游戏库 - Sky Blog', 'Sky Blog'),
  'Steam 游戏库',
  'Steam title helper should strip one exact trailing site suffix'
);
assert.equal(
  stripSteamSiteTitleSuffix('Sky Blog 的 Steam 游戏库', 'Sky Blog'),
  'Sky Blog 的 Steam 游戏库',
  'a site title in the middle must not be mistaken for a trailing suffix'
);
assert.equal(
  stripSteamSiteTitleSuffix('Steam 游戏库 - Sky Blog Archive', 'Sky Blog'),
  'Steam 游戏库 - Sky Blog Archive',
  'a longer non-matching suffix must remain intact'
);
assert.equal(
  stripSteamSiteTitleSuffix('Steam 游戏库 - Sky Blog - Sky Blog', 'Sky Blog'),
  'Steam 游戏库',
  'duplicate exact site suffixes should be removed completely'
);
assert.equal(
  stripSteamSiteTitleSuffix('Steam 游戏库 - Sky Blog', ''),
  'Steam 游戏库 - Sky Blog',
  'an empty site title must not remove any suffix'
);

const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: 'fallback title' } });
  const hydrateUrl = new URL('../src/apps/steam/hydrate.js', import.meta.url);
  hydrateUrl.searchParams.set('title-contract', String(Date.now()));
  await import(hydrateUrl.href);

  const lifecycle = window.__THEME_PAGE_APP_REGISTRY__?.appLifecycles?.steam;
  assert.equal(typeof lifecycle?.getDocumentState, 'function', 'Steam hydrate should register its document-state lifecycle');
  const stateFor = (chromeTitle, siteTitle) => lifecycle.getDocumentState({
    querySelector() {
      return {
        dataset: {
          steamChromeTitle: chromeTitle,
          steamChromeSubtitle: '共 10 款游戏',
          steamSiteTitle: siteTitle
        }
      };
    }
  }, { documentTitle: 'fallback title' });

  assert.deepEqual(
    stateFor('Sky Blog 的 Steam 游戏库', 'Sky Blog'),
    {
      title: 'Sky Blog 的 Steam 游戏库 - Sky Blog',
      windowTitle: 'Sky Blog 的 Steam 游戏库',
      windowSubtitle: '共 10 款游戏',
      windowVariant: 'steam'
    },
    'hydrate must append the site suffix when the site name only appears in the title body'
  );
  assert.equal(stateFor('Steam 游戏库 - Sky Blog - Sky Blog', 'Sky Blog').title, 'Steam 游戏库 - Sky Blog');
  assert.equal(stateFor('Steam 游戏库 - Sky Blog - Sky Blog', 'Sky Blog').windowTitle, 'Steam 游戏库');
  assert.equal(stateFor('Steam 游戏库 - Sky Blog', '').title, 'Steam 游戏库 - Sky Blog');
} finally {
  if (previousWindowDescriptor) Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
  else delete globalThis.window;
  if (previousDocumentDescriptor) Object.defineProperty(globalThis, 'document', previousDocumentDescriptor);
  else delete globalThis.document;
}

assert.match(template, /realHeaderImage/, 'Steam template should support the 1.0.0 realHeaderImage field');
assert.match(template, /game\.delisted == true/, 'Steam template should expose the 1.0.0 delisted state');
assert.match(template, /data-steam-delisted/, 'library cards should serialize delisted state');
assert.match(template, /data-steam-library-state/, 'pagination responses should expose library availability');
assert.match(template, /games != null and games\.hasNext\(\)/, 'pagination should remain null-safe');
assert.match(template, /data-fallback-src/, 'broken accelerated covers should have an original-image fallback');
assert.match(template, /@click="loadNext\(\)"/, 'pagination errors should offer a retry action');
assert.match(template, /playtime2WeeksFormatted/, 'recent cards should prefer plugin-formatted playtime');
assert.match(
  template,
  /\(game\.playtimeForever - \(game\.playtimeForever % 60\)\) \/ 60/,
  'template raw-minute fallback should calculate whole hours before rendering'
);
assert.match(template, /game\.playtimeForever < 60/, 'template should render sub-hour playtime as minutes only');
assert.match(
  template,
  /game\.delisted == true or !enableGameLink \? null/,
  'delisted or administratively disabled cards should remove their href'
);
assert.match(
  template,
  /tabindex=\$\{game\.delisted == true or !enableGameLink \? '-1' : null\}/,
  'non-interactive cards should leave keyboard navigation'
);
assert.match(pageTemplate, /#strings\.endsWith\(rawWindowTitle, windowTitleSuffix\)/, 'server title should only detect a trailing site suffix');
assert.match(pageTemplate, /#strings\.substring\(rawWindowTitle, 0, #strings\.length\(rawWindowTitle\) - #strings\.length\(windowTitleSuffix\)\)/, 'server title should remove only the detected trailing suffix');
assert.match(hydrateSource, /stripSteamSiteTitleSuffix\(chromeTitle, siteTitle\)/, 'PJAX title hydration should use the exact-suffix helper');

assert.equal(steamAppManifest.supportsSameAppPjax, true, 'Steam should retain same-app PJAX support');
assert.match(hydrateSource, /invokeAlpineDestroyHooks/, 'Steam PJAX disposal should invoke Alpine destroy hooks');
assert.doesNotMatch(
  runtimeSource,
  /from ['"]\.\/model\.js['"]/,
  'Steam first-load runtime should not depend on the widget-shared model chunk'
);

let explorerFactory = null;
registerSteamExplorer({
  data(name, factory) {
    assert.equal(name, 'steamExplorer');
    explorerFactory = factory;
  }
});
assert.equal(typeof explorerFactory, 'function', 'Steam explorer should register an Alpine factory');

const explorer = explorerFactory();
explorer.games = [
  { index: 0, appId: '10', name: 'Portal 2', playtime: 60, recent: 100, el: { style: {} } },
  { index: 1, appId: '20', name: 'Aperture Desk Job', playtime: 10, recent: 300, el: { style: {} } },
  { index: 2, appId: '30', name: 'Portal', playtime: 180, recent: 200, el: { style: {} } }
];
explorer.searchQuery = 'portal';
assert.equal(explorer.visibleCount(), 2, 'library search should keep filtering already-loaded cards');
explorer.sortMode = 'playtime';
assert.deepEqual(explorer.sortedGames().map((game) => game.appId), ['30', '10', '20']);
explorer.sortMode = 'recent';
assert.deepEqual(explorer.sortedGames().map((game) => game.appId), ['20', '30', '10']);
explorer.sortMode = 'name';
assert.deepEqual(explorer.sortedGames().map((game) => game.appId), ['20', '30', '10']);

const originalFetch = globalThis.fetch;
const originalDomParser = globalThis.DOMParser;
const originalWindow = globalThis.window;
const originalIntersectionObserver = globalThis.IntersectionObserver;

function createHeatmapFixture() {
  const model = explorerFactory();
  const summary = { textContent: '' };
  const grid = { innerHTML: '' };
  const panel = {
    dataset: { steamHeatmapDays: '28' },
    style: { setProperty() {} },
    querySelector(selector) {
      if (selector === '[data-steam-heatmap-summary]') return summary;
      if (selector === '[data-steam-heatmap-grid]') return grid;
      return null;
    }
  };
  model.$root = { isConnected: true, querySelector: (selector) => selector === '.steam-heatmap-panel' ? panel : null };
  return { model, panel, summary, grid };
}

function recordPage(url, { overlap = false } = {}) {
  const parsed = new URL(url, 'https://halo.test');
  const page = Number(parsed.searchParams.get('page'));
  const date = parsed.searchParams.get('endDate');
  const indexes = page === 1 ? Array.from({ length: 28 }, (_, index) => index + 1) : overlap ? [28, 29] : [29];
  return {
    page, size: 28, total: 29,
    items: indexes.map((appId) => ({
      metadata: { name: `record-${appId}` },
      spec: { date, appId, steamId: 'fixture-steam', gameName: `游戏${appId}`, playtimeMinutes: 10 }
    }))
  };
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function createLifecycleFixture() {
  const queued = [];
  const watched = [];
  const counts = { added: 0, removed: 0 };
  const scroller = {
    scrollHeight: 2000, scrollTop: 0, clientHeight: 500,
    addEventListener: () => { counts.added += 1; },
    removeEventListener: () => { counts.removed += 1; }
  };
  const model = explorerFactory();
  model.$root = {
    isConnected: true,
    dataset: {},
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === '[data-steam-scroll-sentinel]') return {};
      if (selector === '.steam-main-scroll') return scroller;
      return null;
    }
  };
  model.$watch = (_name, callback) => watched.push(callback);
  model.$nextTick = (callback) => queued.push(callback);
  return { model, queued, watched, counts };
}

try {
  const paginationExplorer = explorerFactory();
  paginationExplorer.activeView = 'library';
  paginationExplorer.hasMore = true;
  paginationExplorer.nextUrl = '/steam/page/2';
  paginationExplorer.$root = { querySelector: () => null };
  paginationExplorer.$nextTick = (callback) => callback();

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await paginationExplorer.loadNext();
  assert.equal(paginationExplorer.loadError, true, 'HTTP pagination failure should enter retryable error state');
  assert.equal(paginationExplorer.loading, false, 'pagination failure should release loading state');

  const unavailableExplorer = explorerFactory();
  unavailableExplorer.activeView = 'library';
  unavailableExplorer.hasMore = true;
  unavailableExplorer.nextUrl = '/steam/page/3';
  unavailableExplorer.$root = { querySelector: () => null };
  unavailableExplorer.$nextTick = (callback) => callback();

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html></html>'
  });
  globalThis.DOMParser = class {
    parseFromString() {
      return {
        querySelectorAll: () => [],
        querySelector(selector) {
          if (selector === '[data-app-root="steam"]') {
            return { dataset: { steamLibraryState: 'unavailable' } };
          }
          return null;
        }
      };
    }
  };
  await unavailableExplorer.loadNext();
  assert.equal(unavailableExplorer.loadError, true, 'cache/API-unavailable page should not be mistaken for end of data');
  assert.equal(unavailableExplorer.hasMore, true, 'unavailable pagination should remain retryable');

  const heatmapExplorer = explorerFactory();
  const range = { textContent: '' };
  const summary = { textContent: '' };
  const grid = { innerHTML: '' };
  const panel = {
    dataset: { steamHeatmapDays: '28', steamHeatmapTheme: 'steam' },
    style: { setProperty() {} },
    querySelector(selector) {
      if (selector === '[data-steam-heatmap-range]') return range;
      if (selector === '[data-steam-heatmap-summary]') return summary;
      if (selector === '[data-steam-heatmap-grid]') return grid;
      return null;
    }
  };
  heatmapExplorer.$root = {
    querySelector(selector) {
      return selector === '.steam-heatmap-panel' ? panel : null;
    }
  };
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await heatmapExplorer.renderHeatmap();
  assert.equal(panel.dataset.steamHeatmapState, 'unavailable');
  assert.match(summary.textContent, /暂不可用/);
  assert.match(grid.innerHTML, /class="is-0"/, 'failed heatmap should keep a stable empty-grid fallback');

  // S1: 29 game records in a 28-day window require two pages, even without hasNext.
  const pagedHeatmap = createHeatmapFixture();
  const heatmapPages = [];
  globalThis.fetch = async (url) => {
    heatmapPages.push(Number(new URL(url, 'https://halo.test').searchParams.get('page')));
    return jsonResponse(recordPage(url, { overlap: true }));
  };
  await pagedHeatmap.model.renderHeatmap();
  assert.deepEqual(heatmapPages, [1, 2]);
  assert.equal(pagedHeatmap.panel.dataset.steamHeatmapState, 'ready');
  assert.match(pagedHeatmap.summary.textContent, /1 天.*4 小时 50 分钟/);
  assert.match(pagedHeatmap.grid.innerHTML, /290 分钟/, 'records of different games on the same date must be added');

  const partialHeatmap = createHeatmapFixture();
  globalThis.fetch = async (url) => Number(new URL(url, 'https://halo.test').searchParams.get('page')) === 2
    ? { ok: false, status: 503 }
    : jsonResponse(recordPage(url));
  await partialHeatmap.model.renderHeatmap();
  assert.equal(partialHeatmap.panel.dataset.steamHeatmapState, 'unavailable');
  assert.doesNotMatch(partialHeatmap.grid.innerHTML, /class="is-[1-4]"/, 'a later-page failure must not publish partial totals');
  assert.equal(partialHeatmap.model._heatmapLoaded, false, 'a failed batch should be retryable');
  globalThis.fetch = async (url) => jsonResponse(recordPage(url));
  await partialHeatmap.model.renderHeatmap();
  assert.equal(partialHeatmap.panel.dataset.steamHeatmapState, 'ready');
  assert.match(partialHeatmap.summary.textContent, /4 小时 50 分钟/);

  const incompleteHeatmap = createHeatmapFixture();
  globalThis.fetch = async (url) => {
    const data = recordPage(url);
    if (data.page === 2) data.items = [];
    return jsonResponse(data);
  };
  await incompleteHeatmap.model.renderHeatmap();
  assert.equal(incompleteHeatmap.panel.dataset.steamHeatmapState, 'unavailable', 'an incomplete final page cannot be reported as ready');

  const inconsistentHeatmap = createHeatmapFixture();
  let inconsistentRequests = 0;
  globalThis.fetch = async (url) => {
    inconsistentRequests += 1;
    assert(inconsistentRequests <= 3, 'an inconsistent endpoint must not cause an unbounded request loop');
    const data = recordPage(url);
    return jsonResponse({
      ...data, total: 1, hasNext: true,
      items: [{ ...data.items[0], metadata: { name: `always-new-${inconsistentRequests}` } }]
    });
  };
  await inconsistentHeatmap.model.renderHeatmap();
  assert.equal(inconsistentRequests, 1, 'total=1 and hasNext=true must be rejected on the first page');
  assert.equal(inconsistentHeatmap.panel.dataset.steamHeatmapState, 'unavailable');
  assert.equal(inconsistentHeatmap.model._heatmapLoaded, false);
  assert.doesNotMatch(inconsistentHeatmap.grid.innerHTML, /class="is-[1-4]"/);

  const cancelledHeatmap = createHeatmapFixture();
  let finishSecondPage;
  let secondPageSignal;
  globalThis.fetch = async (url, options) => {
    const data = recordPage(url);
    if (data.page === 1) return jsonResponse(data);
    secondPageSignal = options.signal;
    return new Promise((resolve) => { finishSecondPage = () => resolve(jsonResponse(data)); });
  };
  const pendingHeatmap = cancelledHeatmap.model.renderHeatmap();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishSecondPage, 'function');
  cancelledHeatmap.model.destroy();
  assert.equal(secondPageSignal.aborted, true);
  finishSecondPage();
  await pendingHeatmap;
  assert.equal(cancelledHeatmap.grid.innerHTML, '', 'late page results must not update a disposed heatmap');
  assert.equal(cancelledHeatmap.summary.textContent, '');

  // S2: init/switchView/pagination callbacks must not install resources after disposal.
  let observerCount = 0;
  globalThis.IntersectionObserver = class {
    constructor() { observerCount += 1; }
    observe() {}
    disconnect() {}
  };
  globalThis.window = { IntersectionObserver: globalThis.IntersectionObserver };
  const queuedInit = createLifecycleFixture();
  queuedInit.model.init();
  queuedInit.model.destroy();
  queuedInit.queued.splice(0).forEach((callback) => callback());
  queuedInit.model.installInfiniteLoader();
  assert.equal(observerCount, 0);
  assert.equal(queuedInit.counts.added, 0, 'destroyed init callbacks must not add scroll listeners');

  const queuedView = createLifecycleFixture();
  queuedView.model.switchView('library');
  queuedView.model.destroy();
  queuedView.queued.splice(0).forEach((callback) => callback());
  assert.equal(observerCount, 0);
  assert.equal(queuedView.counts.added, 0);

  const reinitialized = createLifecycleFixture();
  reinitialized.model.init();
  const oldInit = reinitialized.queued.shift();
  reinitialized.model.destroy();
  reinitialized.model.init();
  oldInit();
  assert.equal(observerCount, 0, 'callbacks from an earlier initialization must not revive in a new generation');
  reinitialized.queued.shift()();
  assert.equal(observerCount, 1, 'the current generation must still install its loader');
  assert.equal(reinitialized.counts.added, 1);
  let orderingCount = 0;
  reinitialized.model.applyGameOrdering = () => { orderingCount += 1; };
  reinitialized.watched[0]();
  reinitialized.watched[1]();
  assert.equal(orderingCount, 1, 'only the current generation sort watcher may update cards');

  const detached = createLifecycleFixture();
  detached.model.init();
  detached.model.$root.isConnected = false;
  detached.queued.shift()();
  assert.equal(observerCount, 1, 'a detached root must not receive new observers');

  const queuedPagination = createLifecycleFixture();
  queuedPagination.model.activeView = 'library';
  queuedPagination.model.hasMore = true;
  queuedPagination.model.nextUrl = '/steam/page/2';
  queuedPagination.model.appendCards = () => {};
  globalThis.fetch = async () => ({ ok: true, text: async () => '<html></html>' });
  globalThis.DOMParser = class {
    parseFromString() { return { querySelectorAll: () => [{}], querySelector: () => null }; }
  };
  await queuedPagination.model.loadNext();
  let fallbackChecks = 0;
  queuedPagination.model.checkScrollFallback = () => { fallbackChecks += 1; };
  queuedPagination.model.destroy();
  queuedPagination.queued.splice(0).forEach((callback) => callback());
  assert.equal(fallbackChecks, 0, 'queued pagination follow-ups must check their captured lifecycle');

  const lifecycleExplorer = explorerFactory();
  const heatmapController = new AbortController();
  const paginationController = new AbortController();
  let disconnectCount = 0;
  let removeCount = 0;
  lifecycleExplorer._observer = { disconnect: () => { disconnectCount += 1; } };
  lifecycleExplorer._fallbackScrollHandler = () => {};
  lifecycleExplorer._heatmapAbortController = heatmapController;
  lifecycleExplorer._paginationAbortController = paginationController;
  lifecycleExplorer.$root = {
    querySelector() {
      return { removeEventListener: () => { removeCount += 1; } };
    }
  };
  lifecycleExplorer.destroy();
  assert.equal(heatmapController.signal.aborted, true, 'PJAX disposal should abort heatmap requests');
  assert.equal(paginationController.signal.aborted, true, 'PJAX disposal should abort pagination requests');
  assert.equal(disconnectCount, 1, 'PJAX disposal should disconnect the pagination observer');
  assert.equal(removeCount, 1, 'PJAX disposal should remove the scroll fallback listener');
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalIntersectionObserver === undefined) delete globalThis.IntersectionObserver;
  else globalThis.IntersectionObserver = originalIntersectionObserver;
  if (originalDomParser === undefined) {
    delete globalThis.DOMParser;
  } else {
    globalThis.DOMParser = originalDomParser;
  }
}

console.log('verify-steam-adaptation passed');
