import assert from 'node:assert/strict';
import { DoubanApp } from '../src/apps/douban/runtime.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    contains: (item) => values.has(item),
    toggle(item, enabled) {
      if (enabled) values.add(item);
      else values.delete(item);
    }
  };
}

function createRoot() {
  return {
    isConnected: true,
    classList: createClassList(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };
}

const previousDocument = globalThis.document;
globalThis.document = {
  removeEventListener() {}
};

try {
  const root = createRoot();
  const app = new DoubanApp(root);
  const stalePage = deferred();

  app.state.items = [{ metadata: { name: 'initial' } }];
  app.state.total = 3;
  app.state.page = 1;
  app.state.hasMore = true;
  app.requestGeneration = 1;
  app.fetchGenres = async () => [];
  app.updateStats = async () => {};
  app.renderGenres = () => {};
  app.renderItems = () => {};
  app.fetchList = async (page) => {
    if (page === 2) return stalePage.promise;
    return {
      items: [{ metadata: { name: 'done-filter-result' } }],
      total: 1
    };
  };

  const loadMoreJob = app.loadMore();
  assert.ok(app.paginationController, 'loadMore should retain its AbortController');

  app.state.status = 'done';
  const reloadJob = app.reload();
  await reloadJob;
  stalePage.resolve({
    items: [{ metadata: { name: 'stale-page-2' } }],
    total: 3
  });
  await loadMoreJob;

  assert.deepEqual(
    app.state.items.map((item) => item.metadata.name),
    ['done-filter-result'],
    'an old pagination response must not append after the filter request changes'
  );
  assert.equal(app.state.page, 1, 'stale page 2 must not advance the active query');
  assert.equal(root.classList.contains('is-loading-more'), false, 'stale pagination should release its loading state');

  const pendingFirstPage = deferred();
  let pageTwoCallsDuringReload = 0;
  app.state.items = [{ metadata: { name: 'previous-filter-item' } }];
  app.state.total = 3;
  app.state.page = 1;
  app.state.hasMore = true;
  app.fetchList = async (page) => {
    if (page === 1) return pendingFirstPage.promise;
    pageTwoCallsDuringReload += 1;
    return {
      items: [{ metadata: { name: 'must-not-load-during-reload' } }],
      total: 3
    };
  };

  const pendingReload = app.reload();
  assert.equal(app.reloadPending, true, 'reload should expose an exclusive main-request state');
  await app.loadMore();
  assert.equal(pageTwoCallsDuringReload, 0, 'loadMore must not start while the active filter page is reloading');
  pendingFirstPage.resolve({
    items: [{ metadata: { name: 'new-filter-page-1' } }],
    total: 2
  });
  await pendingReload;
  assert.equal(app.reloadPending, false, 'the current reload should release its exclusive state');
  assert.deepEqual(
    app.state.items.map((item) => item.metadata.name),
    ['new-filter-page-1'],
    'a blocked pagination click must not corrupt the new first page'
  );

  const fallbackStats = {};
  const statsApp = new DoubanApp(createRoot());
  statsApp.state.total = 99;
  statsApp.fetchCount = async () => {
    throw new Error('stats endpoint unavailable');
  };
  statsApp.setStat = (key, value) => {
    fallbackStats[key] = value;
  };
  await statsApp.updateStats(new AbortController().signal, 7);
  assert.deepEqual(fallbackStats, {
    total: 7,
    done: 0,
    doing: 0,
    mark: 0
  }, 'stats failure must fall back to the current list total, not the previous filter total');

  const listController = new AbortController();
  const paginationController = new AbortController();
  app.abortController = listController;
  app.paginationController = paginationController;
  const generationBeforeDestroy = app.requestGeneration;
  app.destroy();
  assert.equal(listController.signal.aborted, true, 'destroy should abort the active list request');
  assert.equal(paginationController.signal.aborted, true, 'destroy should abort the active pagination request');
  assert.equal(app.requestGeneration, generationBeforeDestroy + 1, 'destroy should invalidate unresolved responses');
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

console.log('verify-douban-adaptation passed');
