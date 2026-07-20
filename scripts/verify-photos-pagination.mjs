import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const windowListeners = new Map();
globalThis.window = {
  location: {
    origin: 'http://theme.test',
    href: 'http://theme.test/photos',
    pathname: '/photos',
    search: ''
  },
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(listener);
  },
  removeEventListener(type, listener) {
    windowListeners.get(type)?.delete(listener);
  },
};
globalThis.document = { body: { dataset: {}, style: {} } };
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

  const detailStage = {
    clientWidth: 400,
    clientHeight: 300,
  };
  const detailImage = {
    offsetWidth: 700,
    offsetHeight: 200,
  };
  const detailRoot = {
    dataset: { photosView: 'detail' },
    querySelector(selector) {
      if (selector === '.photos-detail-stage') return detailStage;
      if (selector === '.photos-detail-image') return detailImage;
      return null;
    },
  };
  const detailExplorer = explorerFactory();
  detailExplorer.$el = detailRoot;
  detailExplorer.panX = 999;
  detailExplorer.panY = -999;
  detailExplorer.updatePhotoPanAvailability();
  assert.equal(detailExplorer.photoCanPan, true, 'an overflowing detail image should enable panning');
  assert.equal(detailExplorer.panX, 150, 'horizontal pan should clamp to the rendered overflow');
  assert.equal(detailExplorer.panY, 0, 'a non-overflowing axis should remain centered');

  detailImage.offsetWidth = 300;
  detailImage.offsetHeight = 200;
  detailExplorer.panX = 42;
  detailExplorer.panY = -42;
  detailExplorer.updatePhotoPanAvailability();
  assert.equal(detailExplorer.photoCanPan, false, 'a contained detail image should not be draggable');
  assert.equal(detailExplorer.panX, 0, 'contained images should reset horizontal pan');
  assert.equal(detailExplorer.panY, 0, 'contained images should reset vertical pan');

  let preventedPanStart = 0;
  detailExplorer.beginPhotoPan({
    type: 'pointerdown',
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    preventDefault() { preventedPanStart += 1; },
    stopPropagation() {},
  });
  assert.equal(preventedPanStart, 0, 'a contained image should not consume pointer input for dragging');
  assert.equal(detailExplorer.photoPanning, false, 'a contained image should not enter panning state');

  detailImage.offsetWidth = 700;
  detailImage.offsetHeight = 400;
  const capturedPointers = new Set();
  const releasedPointers = [];
  const captureTarget = {
    setPointerCapture(pointerId) { capturedPointers.add(pointerId); },
    hasPointerCapture(pointerId) { return capturedPointers.has(pointerId); },
    releasePointerCapture(pointerId) {
      releasedPointers.push(pointerId);
      capturedPointers.delete(pointerId);
    },
  };
  document.body.style.userSelect = 'text';
  detailExplorer.beginPhotoPan({
    type: 'pointerdown',
    button: 0,
    pointerId: 7,
    clientX: 20,
    clientY: 20,
    currentTarget: captureTarget,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(detailExplorer.photoPanning, true, 'an overflowing detail image should enter panning state');
  assert.ok(detailExplorer._panSession, 'active panning should retain its session until completion');
  assert.equal(document.body.style.userSelect, 'none', 'active panning should suppress body text selection');
  assert.equal(windowListeners.get('pointermove')?.size, 1, 'active panning should install one pointer move listener');
  assert.deepEqual([...capturedPointers], [7], 'active panning should capture its pointer');

  detailExplorer.destroy();
  assert.equal(detailExplorer.photoPanning, false, 'destroy should exit active panning state');
  assert.equal(detailExplorer._panSession, null, 'destroy should clear the active pan session');
  assert.equal(document.body.style.userSelect, 'text', 'destroy should restore the previous body text-selection style');
  assert.deepEqual(releasedPointers, [7], 'destroy should release the captured pointer');
  assert.equal(windowListeners.get('pointermove')?.size, 0, 'destroy should remove the pointer move listener');
  assert.equal(windowListeners.get('pointerup')?.size, 0, 'destroy should remove the pointer end listener');
  assert.equal(windowListeners.get('pointercancel')?.size, 0, 'destroy should remove the pointer cancel listener');

  const photoTemplate = fs.readFileSync(new URL('../templates/photo.html', import.meta.url), 'utf8');
  assert.doesNotMatch(photoTemplate, /@wheel\.stop\.prevent="handlePhotoWheel/, 'detail wheel handling should have only one runtime owner');
  assert.doesNotMatch(photoTemplate, /@pointerdown="beginPhotoPan/, 'detail pointer handling should have only one runtime owner');
  assert.doesNotMatch(photoTemplate, /@mousedown="beginPhotoPan/, 'detail mouse fallback should have only one runtime owner');
  assert.doesNotMatch(photoTemplate, /@dblclick="resetPhotoZoom/, 'detail reset handling should have only one runtime owner');
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
