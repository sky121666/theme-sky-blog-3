import assert from 'node:assert/strict';
import { registerPhotosExplorer } from '../src/apps/photos/runtime/explorer.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

function button() {
  const listeners = new Set();
  return {
    addEventListener(_name, listener) { listeners.add(listener); },
    removeEventListener(_name, listener) { listeners.delete(listener); },
    click() { listeners.forEach((listener) => listener()); },
    listenerCount: () => listeners.size
  };
}

function createFixture(nextUrl = 'http://theme.test/photos/page/2') {
  const next = {
    href: nextUrl,
    removed: false,
    remove() { this.removed = true; }
  };
  const spinner = { classList: classList(['hidden']) };
  const noMore = { classList: classList(['hidden']) };
  const error = { classList: classList(['hidden']) };
  const errorText = { textContent: '' };
  const retry = button();
  const sentinel = {};
  const nodes = new Map([
    ['#next-page-url', next],
    ['#photos-loading-spinner', spinner],
    ['#photos-no-more', noMore],
    ['#photos-load-error', error],
    ['[data-photos-load-error-text]', errorText],
    ['[data-photos-retry]', retry],
    ['.photos-scroll-sentinel', sentinel]
  ]);
  const root = {
    isConnected: true,
    querySelector: (selector) => nodes.get(selector) || null
  };
  return { root, next, spinner, noMore, error, errorText, retry, sentinel };
}

let explorerFactory;
registerPhotosExplorer({
  data(name, factory) {
    assert.equal(name, 'photosExplorer');
    explorerFactory = factory;
  }
});
assert.equal(typeof explorerFactory, 'function', 'Photos explorer should register an Alpine factory');

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousFetch = globalThis.fetch;
const previousDomParser = globalThis.DOMParser;
const previousIntersectionObserver = globalThis.IntersectionObserver;

const observers = [];
globalThis.window = {
  location: {
    origin: 'http://theme.test',
    href: 'http://theme.test/photos',
    pathname: '/photos',
    search: ''
  }
};
globalThis.document = { body: { dataset: {} } };
globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    this.unobserved = new Set();
    this.disconnected = false;
    observers.push(this);
  }
  observe(node) { this.observed.add(node); }
  unobserve(node) { this.unobserved.add(node); this.observed.delete(node); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
};

function createExplorer(fixture) {
  const explorer = explorerFactory();
  explorer.$el = fixture.root;
  explorer._showLoadingSkeletons = () => {};
  explorer._clearLoadingSkeletons = () => {};
  explorer._appendNewCards = () => {};
  explorer._initInfiniteScroll();
  return explorer;
}

function installParsedPage({ cards = [{}], nextUrl = '' } = {}) {
  globalThis.DOMParser = class {
    parseFromString() {
      const responseRoot = {
        querySelectorAll: (selector) => selector === '.photo-card' ? cards : [],
        querySelector: (selector) => selector === '#next-page-url' && nextUrl
          ? { href: nextUrl }
          : null
      };
      return {
        querySelector: (selector) => selector === '[data-app-root="photos"]' ? responseRoot : null
      };
    }
  };
}

try {
  const lifecycleFixture = createFixture();
  const lifecycleExplorer = explorerFactory();
  lifecycleExplorer.$el = lifecycleFixture.root;
  lifecycleExplorer.restorePreferences = () => {};
  lifecycleExplorer._isCompactSurface = () => false;
  lifecycleExplorer.syncEffectiveColCount = () => {};
  lifecycleExplorer.isDetailView = () => false;
  lifecycleExplorer._clearLoadingSkeletons = () => {};
  let deferredInit = null;
  let lateInstallCount = 0;
  lifecycleExplorer.$nextTick = (callback) => {
    deferredInit = callback;
  };
  lifecycleExplorer._installSurfaceControls = () => { lateInstallCount += 1; };
  lifecycleExplorer._captureInitialCards = () => { lateInstallCount += 1; };
  lifecycleExplorer.renderLayout = () => { lateInstallCount += 1; };
  lifecycleExplorer.syncChromeControls = () => { lateInstallCount += 1; };
  lifecycleExplorer._installResizeHandler = () => { lateInstallCount += 1; };
  lifecycleExplorer._initInfiniteScroll = () => { lateInstallCount += 1; };
  lifecycleExplorer.init();
  assert.equal(typeof deferredInit, 'function', 'init should schedule its DOM installation work');
  lifecycleExplorer.destroy();
  lifecycleFixture.root.isConnected = false;
  deferredInit();
  assert.equal(lateInstallCount, 0, 'a nextTick callback completed after destroy must not reinstall observers or listeners');

  const reinitFixture = createFixture();
  const reinitExplorer = createExplorer(reinitFixture);
  const firstObserver = observers.at(-1);
  assert.equal(reinitFixture.retry.listenerCount(), 1, 'initial pagination should bind one retry listener');
  const initialQuerySelector = reinitFixture.root.querySelector;
  reinitFixture.root.querySelector = (selector) => (
    selector === '#next-page-url' ? null : initialQuerySelector(selector)
  );
  reinitExplorer._initInfiniteScroll();
  assert.equal(firstObserver.disconnected, true, 'reinitialization should disconnect the previous pagination observer');
  assert.equal(reinitFixture.retry.listenerCount(), 0, 'reinitialization should remove the previous retry listener before an early return');
  assert.equal(reinitExplorer._paginationLoadMore, null, 'an early-return reinitialization must not retain the old load callback');

  const retryFixture = createFixture();
  const retryExplorer = createExplorer(retryFixture);
  let appended = 0;
  retryExplorer._appendNewCards = (cards) => { appended += cards.length; };
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200, text: async () => '<html></html>' };
  };
  installParsedPage({ cards: [{ id: 'page-2-card' }] });

  await retryExplorer._paginationLoadMore();
  assert.equal(retryFixture.error.classList.contains('hidden'), false, 'HTTP failure should expose a retryable error');
  assert.equal(retryFixture.noMore.classList.contains('hidden'), true, 'HTTP failure must not be treated as end of data');
  assert.equal(retryFixture.next.removed, false, 'failed pagination should retain the next-page URL');
  assert.ok(observers.at(-1).unobserved.has(retryFixture.sentinel), 'failure should pause automatic retries');
  assert.equal(retryFixture.retry.listenerCount(), 1, 'the visible retry action should be bound once');

  await retryExplorer._paginationLoadMore();
  assert.equal(appended, 1, 'a manual retry should append the recovered page once');
  assert.equal(retryFixture.next.removed, true, 'the final successful page should remove the next URL');
  assert.equal(retryFixture.noMore.classList.contains('hidden'), false, 'the final successful page should show the end marker');

  const repeatedFixture = createFixture();
  const repeatedExplorer = createExplorer(repeatedFixture);
  let repeatedAppend = 0;
  repeatedExplorer._appendNewCards = () => { repeatedAppend += 1; };
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html></html>' });
  installParsedPage({ cards: [{ id: 'duplicate' }], nextUrl: repeatedFixture.next.href });
  await repeatedExplorer._paginationLoadMore();
  assert.equal(repeatedAppend, 0, 'a repeated next-page URL must not append duplicate content');
  assert.equal(repeatedFixture.error.classList.contains('hidden'), false, 'a repeated next-page URL should remain retryable');

  const staleFixture = createFixture();
  const staleExplorer = createExplorer(staleFixture);
  const staleResponse = deferred();
  let staleAppend = 0;
  staleExplorer._appendNewCards = () => { staleAppend += 1; };
  globalThis.fetch = () => staleResponse.promise;
  installParsedPage({ cards: [{ id: 'stale' }] });
  const staleJob = staleExplorer._paginationLoadMore();
  const activeController = staleExplorer._paginationController;
  staleExplorer.destroy();
  staleFixture.root.isConnected = false;
  staleResponse.resolve({ ok: true, status: 200, text: async () => '<html></html>' });
  await staleJob;
  assert.equal(activeController.signal.aborted, true, 'destroy should abort the active Photos page request');
  assert.equal(staleAppend, 0, 'a response completed after destroy must not append cards');
  assert.equal(staleExplorer._paginationLoadMore, null, 'destroy should release the pagination callback');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = previousFetch;
  if (previousDomParser === undefined) delete globalThis.DOMParser;
  else globalThis.DOMParser = previousDomParser;
  if (previousIntersectionObserver === undefined) delete globalThis.IntersectionObserver;
  else globalThis.IntersectionObserver = previousIntersectionObserver;
}

console.log('verify-photos-pagination passed');
