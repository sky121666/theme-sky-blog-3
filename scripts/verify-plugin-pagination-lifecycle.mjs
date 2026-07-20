import assert from 'node:assert/strict';
import { registerBangumisExplorer } from '../src/apps/bangumis/runtime.js';
import { registerEquipmentsExplorer } from '../src/apps/equipments/runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function captureFactory(register, expectedName) {
  let factory = null;
  register({
    data(name, componentFactory) {
      assert.equal(name, expectedName);
      factory = componentFactory;
    }
  });
  assert.equal(typeof factory, 'function');
  return factory;
}

const fixtures = [
  {
    id: 'bangumis',
    factory: captureFactory(registerBangumisExplorer, 'bangumisExplorer'),
    cardSelector: '.bangumis-list > [data-bangumi-card]',
    loadMoreSelector: '[data-bangumis-loadmore]',
    sentinelSelector: '[data-bangumis-scroll-sentinel]',
    scrollerSelector: '.bangumis-main-scroll'
  },
  {
    id: 'equipments',
    factory: captureFactory(registerEquipmentsExplorer, 'equipmentsExplorer'),
    cardSelector: '[data-equipment-card]',
    loadMoreSelector: '[data-equipments-loadmore]',
    sentinelSelector: '[data-equipments-scroll-sentinel]',
    scrollerSelector: '.equipments-stage-scroller'
  }
];

const originalFetch = globalThis.fetch;
const originalDomParser = globalThis.DOMParser;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

try {
  for (const fixture of fixtures) {
    const request = deferred();
    let requestSignal = null;
    let appendCount = 0;
    let paginationUpdateCount = 0;
    const root = { querySelector: () => null };
    const model = fixture.factory();
    model.$root = root;
    model.nextUrl = `/${fixture.id}?page=2`;
    model.hasMore = true;
    model.appendCards = () => { appendCount += 1; };
    model.updatePaginationFrom = () => { paginationUpdateCount += 1; };
    model.$nextTick = (callback) => callback();

    globalThis.fetch = (_url, options = {}) => {
      requestSignal = options.signal;
      return request.promise;
    };
    globalThis.DOMParser = class {
      parseFromString() {
        return {
          querySelectorAll(selector) {
            assert.equal(selector, fixture.cardSelector);
            return [{ dataset: {} }];
          }
        };
      }
    };

    const pending = model.loadNext();
    assert.equal(model.loading, true, `${fixture.id} should enter loading state`);
    model.destroy();
    assert.equal(requestSignal?.aborted, true, `${fixture.id} destroy should abort its pagination request`);
    assert.equal(model.loading, false, `${fixture.id} destroy should release loading state`);

    request.resolve({
      ok: true,
      status: 200,
      async text() { return '<html></html>'; }
    });
    await pending;
    assert.equal(appendCount, 0, `${fixture.id} late response must not append into a disposed root`);
    assert.equal(paginationUpdateCount, 0, `${fixture.id} late response must not update pagination state`);

    const retryModel = fixture.factory();
    retryModel.$root = root;
    retryModel.nextUrl = `/${fixture.id}?page=3`;
    retryModel.hasMore = true;
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await retryModel.loadNext();
    assert.equal(retryModel.loadError, true, `${fixture.id} HTTP errors should stay retryable`);
    assert.equal(retryModel.hasMore, true, `${fixture.id} HTTP errors must not masquerade as end-of-list`);
    assert.equal(retryModel.loading, false, `${fixture.id} HTTP errors should release loading state`);

    let listenerAdds = 0;
    let lifecycleFetches = 0;
    const queuedInitTicks = [];
    const trigger = { dataset: { nextUrl: `/${fixture.id}?page=2` } };
    const sentinel = {};
    const scroller = {
      scrollHeight: 100,
      scrollTop: 0,
      clientHeight: 100,
      addEventListener() { listenerAdds += 1; },
      removeEventListener() {}
    };
    const lifecycleRoot = {
      querySelector(selector) {
        if (selector === fixture.loadMoreSelector) return trigger;
        if (selector === fixture.sentinelSelector) return sentinel;
        if (selector === fixture.scrollerSelector) return scroller;
        return null;
      }
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body: { dataset: {} } }
    });
    globalThis.fetch = async () => {
      lifecycleFetches += 1;
      return {
        ok: true,
        status: 200,
        async text() { return '<html></html>'; }
      };
    };

    const deferredInitModel = fixture.factory();
    deferredInitModel.$root = lifecycleRoot;
    deferredInitModel.$nextTick = (callback) => queuedInitTicks.push(callback);
    deferredInitModel.init();
    assert.equal(queuedInitTicks.length, 1, `${fixture.id} init should defer loader installation`);
    deferredInitModel.destroy();
    queuedInitTicks.splice(0).forEach((callback) => callback());
    assert.equal(listenerAdds, 0, `${fixture.id} disposed init must not install a scroll listener`);
    assert.equal(lifecycleFetches, 0, `${fixture.id} disposed init must not trigger pagination fetches`);

    const queuedLoadTicks = [];
    const deferredLoadModel = fixture.factory();
    deferredLoadModel.$root = lifecycleRoot;
    deferredLoadModel.$nextTick = (callback) => queuedLoadTicks.push(callback);
    deferredLoadModel.nextUrl = `/${fixture.id}?page=2`;
    deferredLoadModel.hasMore = true;
    deferredLoadModel.appendCards = () => {};
    deferredLoadModel.updatePaginationFrom = () => {};
    await deferredLoadModel.loadNext();
    assert.equal(lifecycleFetches, 1, `${fixture.id} active pagination should fetch once`);
    assert.equal(queuedLoadTicks.length, 1, `${fixture.id} pagination should defer its follow-up scroll check`);
    deferredLoadModel.destroy();
    queuedLoadTicks.splice(0).forEach((callback) => callback());
    deferredLoadModel.installInfiniteLoader();
    deferredLoadModel.installScrollFallback(scroller);
    deferredLoadModel.checkScrollFallback();
    await deferredLoadModel.loadNext();
    assert.equal(listenerAdds, 0, `${fixture.id} disposed loader entry points must not install listeners`);
    assert.equal(lifecycleFetches, 1, `${fixture.id} disposed loader entry points must not fetch again`);
  }
} finally {
  globalThis.fetch = originalFetch;
  if (originalDomParser === undefined) delete globalThis.DOMParser;
  else globalThis.DOMParser = originalDomParser;
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  else delete globalThis.window;
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  else delete globalThis.document;
}

console.log('plugin pagination lifecycle contracts passed');
