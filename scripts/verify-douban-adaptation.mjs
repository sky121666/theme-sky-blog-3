import assert from 'node:assert/strict';
import { DoubanApp } from '../src/apps/douban/runtime.js';
import { enhanceDoubanShowcaseWidgets, itemSummary } from '../src/widgets/plugin/douban-showcase/runtime.js';

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
    contains: () => false,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };
}

function createObservedRoot() {
  const root = createRoot();
  const nodes = new Map();
  root.querySelector = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', hidden: true,
      toggleAttribute(name, value) { if (name === 'hidden') this.hidden = value; }
    });
    return nodes.get(selector);
  };
  return { root, node: (selector) => root.querySelector(selector) };
}

const previousDocument = globalThis.document;
globalThis.document = {
  body: { dataset: { pageApp: 'other' } },
  documentElement: {},
  removeEventListener() {}
};

try {
  // 与本机 plugin-douban 1.2.6 公共 API 的字段形状一致。
  const flatMovie = {
    id: 'douban-movie-nozf4aki',
    name: '周处除三害',
    poster: 'https://example.test/poster.jpg',
    year: '2023',
    score: '8.1',
    genres: ['犯罪', '动作'],
    link: 'https://movie.douban.com/subject/36151692/',
    favesStatus: 'done',
    favesScore: '5',
    favesCreateTime: '2024-03-17T18:27:16Z',
    favesRemark: '值得重看'
  };
  const flatApp = new DoubanApp(createRoot());
  assert.match(flatApp.renderGridCard(flatMovie, 0), /周处除三害/);
  assert.match(flatApp.renderGridCard(flatMovie, 0), /data-douban-item-id="douban-movie-nozf4aki"/);
  assert.match(flatApp.renderListRow(flatMovie, 0), /★★★★★/);
  assert.match(flatApp.renderListRow(flatMovie, 0), /值得重看/);
  assert.deepEqual(
    { title: itemSummary(flatMovie).title, status: itemSummary(flatMovie).status, myScore: itemSummary(flatMovie).myScore },
    { title: '周处除三害', status: 'done', myScore: 5 }
  );
  const legacyMovie = {
    metadata: { name: 'legacy' },
    spec: { name: '旧版条目', poster: 'https://example.test/old.jpg', genres: ['剧情'] },
    faves: { status: 'mark', score: '4' }
  };
  assert.match(flatApp.renderGridCard(legacyMovie, 0), /旧版条目/);
  assert.equal(itemSummary(legacyMovie).status, 'mark');

  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  try {
    globalThis.window = {
      location: {
        origin: 'http://theme.test',
        search: '?type=book&dataType=db&status=done&genre=%E6%96%87%E5%AD%A6&page=2&size=2&keyword=%E5%A4%A9%E7%A9%BA'
      }
    };
    const routeApp = new DoubanApp(createRoot());
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(new URL(url, window.location.origin));
      return { ok: true, json: async () => ({ items: [{ id: 'one' }, { id: 'two' }], total: 6 }) };
    };
    routeApp.fetchGenres = async () => [];
    routeApp.updateStats = async () => {};
    routeApp.renderItems = () => {};
    routeApp.renderGenres = () => {};
    await routeApp.reload();
    assert.deepEqual(Object.fromEntries(requests[0].searchParams), {
      page: '2', size: '2', type: 'book', dataType: 'db', keyword: '天空', status: 'done', genre: '文学'
    }, 'official Douban route filters and the requested first page must reach the public list API');
    assert.equal(routeApp.state.page, 2);
    assert.equal(routeApp.state.hasMore, true);
    await routeApp.loadMore();
    assert.equal(requests[1].searchParams.get('page'), '3');
    assert.equal(routeApp.state.hasMore, false,
      'starting on page 2 must stop at the real last page, rather than counting only locally appended items');
    routeApp.setStatus('mark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[2].searchParams.get('page'), '1', 'changing filters should reset pagination');

    window.location.search = '?page=-2&size=0&status=invalid';
    const invalidRoute = new DoubanApp(createRoot());
    assert.equal(invalidRoute.state.page, 1);
    assert.equal(invalidRoute.state.pageSize, 20);
    assert.equal(invalidRoute.state.status, 'all');

    window.location.search = '';
    const sharedRoot = createRoot();
    const oldTypes = deferred();
    let oldSignal;
    globalThis.fetch = async (_url, options) => {
      oldSignal = options.signal;
      return oldTypes.promise;
    };
    const oldApp = new DoubanApp(sharedRoot);
    const typeRenders = [];
    let oldPreviewCloses = 0;
    oldApp.closePreview = () => { oldPreviewCloses += 1; };
    oldApp.renderTypes = () => typeRenders.push('old');
    const oldTypesJob = oldApp.loadTypes();
    oldApp.destroy();
    assert.equal(oldSignal.aborted, true, 'destroy must abort the types request too');
    const newApp = new DoubanApp(sharedRoot);
    sharedRoot.__doubanAppDispose = newApp.disposeRoot;
    newApp.renderTypes = () => typeRenders.push('new');
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ key: 'book', name: '图书' }] });
    await newApp.loadTypes();
    oldTypes.resolve({ ok: true, json: async () => [{ key: 'movie', name: '过期电影' }] });
    await oldTypesJob;
    oldApp.destroy();
    assert.deepEqual(typeRenders, ['new'], 'late types must not overwrite a remounted root');
    assert.equal(oldPreviewCloses, 1, 'repeated old cleanup must not close a new app preview');
    assert.equal(sharedRoot.__doubanAppDispose, newApp.disposeRoot,
      'late cleanup from an old app must preserve the current root disposal callback');

    const observed = createObservedRoot();
    const optionalApp = new DoubanApp(observed.root);
    optionalApp.updateStats = async () => {};
    globalThis.fetch = async (url) => String(url).includes('/-/genres')
      ? { ok: false, status: 500 }
      : { ok: true, json: async () => ({ items: [{ id: 'kept', name: '保留的列表' }], total: 21 }) };
    await optionalApp.reload();
    assert.equal(optionalApp.state.items[0].name, '保留的列表', 'genres 500 must not discard list 200');
    assert.match(observed.node('[data-douban-grid]').innerHTML, /保留的列表/);
    assert.match(observed.node('[data-douban-genres]').innerHTML, /全部题材/,
      'the genre filter falls back to its all option');
    assert.equal(optionalApp.genres.length, 0, 'failed genres must not leave stale filter options');
    assert.equal(observed.node('[data-douban-error]').hidden, true);
    assert.equal(observed.node('[data-douban-load-more]').hidden, false,
      'optional filter failure must preserve list pagination');

    globalThis.fetch = async (url) => String(url).includes('/-/genres')
      ? { ok: true, json: async () => [{ name: '剧情' }] }
      : { ok: false, status: 503 };
    await optionalApp.reload();
    assert.equal(optionalApp.state.items.length, 0, 'list failure must not keep a previous result');
    assert.equal(optionalApp.loadError, true, 'list failure must retain the error state');
    assert.equal(observed.node('[data-douban-error]').hidden, false);

    const oldGenres = deferred();
    let genreCalls = 0;
    let listCalls = 0;
    let oldGenreSignal;
    globalThis.fetch = async (url, { signal }) => {
      if (String(url).includes('/-/genres')) {
        genreCalls += 1;
        if (genreCalls === 1) {
          oldGenreSignal = signal;
          return oldGenres.promise;
        }
        return { ok: true, json: async () => [{ name: '当前题材' }] };
      }
      listCalls += 1;
      return { ok: true, json: async () => ({
        items: [{ id: `item-${listCalls}`, name: listCalls === 1 ? '过期列表' : '当前列表' }],
        total: 1
      }) };
    };
    const oldReload = optionalApp.reload();
    const currentReload = optionalApp.reload();
    await currentReload;
    oldGenres.resolve({ ok: true, json: async () => [{ name: '过期题材' }] });
    await oldReload;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(oldGenreSignal.aborted, true, 'new reload aborts the old genres request');
    assert.equal(optionalApp.state.items[0].name, '当前列表', 'stale optional response cannot replace the current list');
    assert.match(observed.node('[data-douban-genres]').innerHTML, /当前题材/,
      'stale optional response cannot replace the current genre filter');
    assert.doesNotMatch(observed.node('[data-douban-genres]').innerHTML, /过期题材/);
    assert.equal(optionalApp.loadError, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }

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
    done: '—',
    doing: '—',
    mark: '—'
  }, 'unavailable status counts must not be presented as zero');

  const partialStats = {};
  const partialStatsApp = new DoubanApp(createRoot());
  partialStatsApp.fetchCount = async ({ status }) => {
    if (status === 'done') throw new Error('done count unavailable');
    return { undefined: 8, doing: 2, mark: 3 }[status];
  };
  partialStatsApp.setStat = (key, value) => { partialStats[key] = value; };
  await partialStatsApp.updateStats(new AbortController().signal, 7);
  assert.deepEqual(partialStats, {
    total: 8,
    done: '—',
    doing: 2,
    mark: 3
  }, 'one failed count must preserve the other successful counts');

  const slowStats = deferred();
  const nonBlockingRoot = createObservedRoot();
  const nonBlockingApp = new DoubanApp(nonBlockingRoot.root);
  nonBlockingApp.fetchGenres = async () => [];
  nonBlockingApp.fetchList = async () => ({
    items: [{ id: 'visible-before-stats', name: '可读列表' }],
    total: 8
  });
  nonBlockingApp.fetchCount = async ({ status }) => status === 'done'
    ? slowStats.promise
    : { undefined: 8, doing: 2, mark: 3 }[status];
  let listReloadFinished = false;
  const nonBlockingReload = nonBlockingApp.reload().then(() => { listReloadFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const finishedBeforeStats = listReloadFinished;
  const visibleBeforeStats = nonBlockingRoot.node('[data-douban-grid]').innerHTML.includes('可读列表');
  slowStats.resolve(4);
  await nonBlockingReload;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finishedBeforeStats, true, 'list reload must finish while an optional count request is pending');
  assert.equal(visibleBeforeStats, true, 'a successful list must render before optional counts finish');
  assert.equal(nonBlockingRoot.node('[data-douban-stat="done"]').textContent, '4');

  const slowGenres = deferred();
  const genreObserved = createObservedRoot();
  const nonBlockingGenresApp = new DoubanApp(genreObserved.root);
  nonBlockingGenresApp.fetchGenres = async () => slowGenres.promise;
  nonBlockingGenresApp.fetchList = async () => ({
    items: [{ id: 'visible-before-genres', name: '先显示的电影' }],
    total: 1
  });
  nonBlockingGenresApp.fetchCount = async () => 1;
  let genreReloadFinished = false;
  const genreReload = nonBlockingGenresApp.reload().then(() => { genreReloadFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const listReadyBeforeGenres = genreReloadFinished
    && genreObserved.node('[data-douban-grid]').innerHTML.includes('先显示的电影')
    && nonBlockingGenresApp.reloadPending === false;
  slowGenres.resolve([{ name: '喜剧', doubanCount: 3 }]);
  await genreReload;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(listReadyBeforeGenres, true, 'a pending genre request must not block a successful list');
  assert.match(genreObserved.node('[data-douban-genres]').innerHTML, /喜剧/,
    'late genre data should update the filter after the list appears');

  const destroyedGenres = deferred();
  const destroyedObserved = createObservedRoot();
  const destroyedApp = new DoubanApp(destroyedObserved.root);
  destroyedApp.fetchGenres = async () => destroyedGenres.promise;
  destroyedApp.fetchList = async () => ({ items: [{ id: 'kept', name: '保留电影' }], total: 1 });
  destroyedApp.fetchCount = async () => 1;
  destroyedApp.closePreview = () => {};
  await destroyedApp.reload();
  const genresBeforeDestroy = destroyedObserved.node('[data-douban-genres]').innerHTML;
  const destroyedSignal = destroyedApp.abortController.signal;
  destroyedApp.destroy();
  destroyedGenres.resolve([{ name: '销毁后题材', doubanCount: 1 }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destroyedSignal.aborted, true);
  assert.equal(destroyedObserved.node('[data-douban-genres]').innerHTML, genresBeforeDestroy,
    'a genre response after destroy must not mutate the old root');

  const listController = new AbortController();
  const paginationController = new AbortController();
  app.abortController = listController;
  app.paginationController = paginationController;
  const generationBeforeDestroy = app.requestGeneration;
  app.destroy();
  assert.equal(listController.signal.aborted, true, 'destroy should abort the active list request');
  assert.equal(paginationController.signal.aborted, true, 'destroy should abort the active pagination request');
  assert.equal(app.requestGeneration, generationBeforeDestroy + 1, 'destroy should invalidate unresolved responses');

  const keyboardRoot = createRoot();
  const keyboardApp = new DoubanApp(keyboardRoot);
  keyboardApp.state.focusedId = 'keyboard-item';
  keyboardApp.state.visibleItems = [{ metadata: { name: 'keyboard-item' } }];
  let previewOpenCount = 0;
  keyboardApp.openPreview = () => { previewOpenCount += 1; };

  let preventedCount = 0;
  const inputTarget = {
    tagName: 'INPUT',
    closest: () => null,
  };
  keyboardApp.onKeydown({
    key: ' ',
    target: inputTarget,
    preventDefault() { preventedCount += 1; },
  });
  assert.equal(previewOpenCount, 0, 'Douban shortcuts must not run while an input is active');
  assert.equal(preventedCount, 0, 'Douban shortcuts must not consume input keystrokes');

  const editableTarget = {
    tagName: 'DIV',
    isContentEditable: true,
    closest: () => null,
  };
  keyboardApp.onKeydown({ key: 'ArrowRight', target: editableTarget, preventDefault() { preventedCount += 1; } });
  assert.equal(preventedCount, 0, 'Douban shortcuts must not consume contenteditable navigation keys');

  const outsideTarget = {
    tagName: 'BUTTON',
    closest: () => null,
  };
  keyboardApp.onKeydown({
    key: ' ',
    target: outsideTarget,
    preventDefault() { preventedCount += 1; },
  });
  assert.equal(previewOpenCount, 0, 'a background Douban root must not own document-level shortcuts');

  globalThis.document.body.dataset.pageApp = 'douban';
  keyboardApp.onKeydown({
    key: ' ',
    target: globalThis.document.body,
    preventDefault() { preventedCount += 1; },
  });
  assert.equal(previewOpenCount, 1, 'the active Douban page should retain its document-level quick-look shortcut');
  assert.equal(preventedCount, 1, 'the active Douban quick-look shortcut should consume the space key');
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

// Widget tests execute the real enhancer with independent DOM/event/fetch fixtures.
// Native button Enter/Space activation dispatches click; no custom keyboard emulation is required.
function createShowcaseRoot(api, overrides = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const thumbs = [0, 1].map((index) => ({
    dataset: { doubanIndex: String(index) },
    classList: createClassList(),
    setAttribute() {}
  }));
  return {
    ...createRoot(),
    dataset: { doubanApi: api, doubanType: 'movie', doubanStatus: 'all', ...overrides },
    setAttribute() {},
    querySelector(selector) {
      if (!nodes.has(selector)) {
        const node = {
          textContent: '', innerHTML: '', dataset: {}, style: {}, classList: createClassList(), hidden: selector === '[data-douban-retry]',
          querySelector() { return /<(?:img|span)\b/.test(this.innerHTML) ? {} : null; },
          querySelectorAll() { return [...this.innerHTML.matchAll(/data-douban-index=/g)]; },
          setAttribute() {}
        };
        if (selector === '[data-douban-poster]') node.classList.add('is-loading');
        nodes.set(selector, node);
      }
      return nodes.get(selector);
    },
    querySelectorAll: () => thumbs,
    addEventListener(type, callback, { signal } = {}) {
      const list = listeners.get(type) || new Set();
      list.add(callback);
      listeners.set(type, list);
      signal?.addEventListener('abort', () => list.delete(callback), { once: true });
    },
    dispatch(type, index) {
      const event = {
        preventDefault() {}, stopPropagation() {},
        target: { closest: (selector) => selector === '[data-douban-retry]'
          ? (index === 'retry' ? this.querySelector(selector) : null)
          : thumbs[index] }
      };
      for (const callback of [...listeners.get(type) || []]) callback(event);
    }
  };
}

const widgetGlobals = { window: globalThis.window, fetch: globalThis.fetch };
const roots = [];
try {
  globalThis.window = {
    location: { origin: 'http://widget.test' },
    sessionStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: true }),
    setInterval, clearInterval, setTimeout, clearTimeout
  };
  const mount = (api, overrides) => {
    const root = createShowcaseRoot(api, overrides);
    roots.push(root);
    enhanceDoubanShowcaseWidgets({ querySelectorAll: () => [root] });
    return root;
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const title = (root) => root.querySelector('[data-douban-title]').textContent;
  const response = (first = '第一项') => ({
    ok: true,
    json: async () => ({ total: 2, items: [{ name: first, favesStatus: 'done' }, { name: '第二项', favesStatus: 'done' }] })
  });

  globalThis.fetch = async () => response();
  let previewIntervalCount = 0;
  globalThis.window.matchMedia = () => ({ matches: false });
  globalThis.window.setInterval = () => { previewIntervalCount += 1; return 1; };
  const preview = mount('/widget/preview', { doubanPreview: 'true' });
  await tick();
  assert.equal(title(preview), '第一项', 'a visible library preview loads real collection data');
  assert.equal(preview.dataset.doubanLoading, 'false', 'preview loading reaches a terminal state');
  assert.equal(previewIntervalCount, 0, 'library previews must not start background autoplay');
  globalThis.window.matchMedia = () => ({ matches: true });
  globalThis.window.setInterval = setInterval;

  const keyboard = mount('/widget/keyboard');
  await tick();
  assert.equal(title(keyboard), '第一项');
  keyboard.dispatch('focusin', 1);
  assert.equal(title(keyboard), '第二项', 'Tab focus selects the corresponding thumbnail');
  keyboard.dispatch('click', 0);
  assert.equal(title(keyboard), '第一项', 'native button keyboard/click activation selects its thumbnail');
  keyboard.dispatch('pointerover', 1);
  assert.equal(title(keyboard), '第二项', 'pointer hover remains supported');
  keyboard.__doubanShowcaseCleanup();
  keyboard.dispatch('click', 0);
  assert.equal(title(keyboard), '第二项', 'cleanup removes interactive listeners');

  const pending = deferred();
  let sharedSignal;
  let calls = 0;
  globalThis.fetch = (_url, { signal }) => { calls += 1; sharedSignal = signal; return pending.promise; };
  const first = mount('/widget/shared');
  const second = mount('/widget/shared');
  await tick();
  assert.equal(calls, 1, 'same configuration shares one request');
  first.__doubanShowcaseCleanup();
  assert.equal(sharedSignal.aborted, false, 'one cancelled consumer must not abort the remaining consumer');
  pending.resolve(response('共享数据'));
  await tick();
  assert.equal(title(first), '豆瓣收藏', 'cancelled connected host cannot receive a late write');
  assert.equal(title(second), '共享数据');
  assert.equal(second.classList.contains('is-error'), false);
  const cached = mount('/widget/shared');
  await tick();
  assert.equal(title(cached), '共享数据');
  assert.equal(calls, 1, 'the successful request remains cached');

  const cancelled = deferred();
  const replacement = deferred();
  const signals = [];
  globalThis.fetch = (_url, { signal }) => {
    signals.push(signal);
    return signals.length === 1 ? cancelled.promise : replacement.promise;
  };
  const only = mount('/widget/reentry');
  await tick();
  only.__doubanShowcaseCleanup();
  assert.equal(signals[0].aborted, true, 'last consumer cancellation aborts the shared request');
  const reentered = mount('/widget/reentry');
  await tick();
  assert.equal(signals.length, 2, 'a new mount must not reuse a cancelled pending request');
  cancelled.resolve(response('过期响应'));
  await tick();
  assert.equal(title(only), '豆瓣收藏', 'even a transport ignoring abort cannot update a cancelled host');
  const another = mount('/widget/reentry');
  await tick();
  assert.equal(signals.length, 2, 'a late cancelled result cannot replace or delete the active shared request');
  replacement.resolve(response('当前响应'));
  await tick();
  assert.equal(title(reentered), '当前响应');
  assert.equal(title(another), '当前响应');

  const failed = deferred();
  globalThis.fetch = () => failed.promise;
  const failedA = mount('/widget/failure');
  const failedB = mount('/widget/failure');
  failed.resolve({ ok: false, status: 503 });
  await tick();
  assert.equal(failedA.classList.contains('is-error'), true);
  assert.equal(failedB.classList.contains('is-error'), true);
  globalThis.fetch = async () => response('重试成功');
  const retried = mount('/widget/failure');
  await tick();
  assert.equal(title(retried), '重试成功', 'failed shared entries do not poison later mounts');

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) });
  const empty = mount('/widget/empty');
  await tick();
  assert.equal(empty.classList.contains('is-empty'), true);
  assert.equal(empty.querySelector('[data-douban-poster]').classList.contains('is-loading'), false,
    'an empty collection must stop showing a loading poster');
  assert.equal(empty.querySelector('[data-douban-count]').textContent, '0 条');
  const emptyCleanup = empty.__doubanShowcaseCleanup;
  enhanceDoubanShowcaseWidgets({ querySelectorAll: () => [empty] });
  assert.equal(empty.__doubanShowcaseCleanup, emptyCleanup, 'stable empty results must not remount on every enhance');

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const error = mount('/widget/same-root-retry');
  await tick();
  assert.equal(error.querySelector('[data-douban-poster]').classList.contains('is-loading'), false,
    'a failed collection must stop showing a loading poster');
  assert.equal(error.querySelector('[data-douban-retry]').hidden, false, 'errors provide a retry action');
  assert.equal(error.querySelector('[data-douban-score]').hidden, true, 'failed data must not show empty score badges');
  globalThis.fetch = async () => response('同一组件重试成功');
  error.dispatch('click', 'retry');
  await tick();
  assert.equal(title(error), '同一组件重试成功');
  assert.equal(error.classList.contains('is-error'), false, 'retry success must remove the error layout');
  assert.equal(error.classList.contains('is-empty'), false);
  assert.equal(error.querySelector('[data-douban-retry]').hidden, true);
  assert.equal(error.querySelector('[data-douban-score]').hidden, false, 'retry success restores score content');

  const sameNodePending = deferred();
  globalThis.fetch = () => sameNodePending.promise;
  const sameNode = mount('/widget/same-node-reentry');
  await tick();
  sameNode.__doubanShowcaseCleanup();
  globalThis.fetch = async () => response('重新进入');
  enhanceDoubanShowcaseWidgets({ querySelectorAll: () => [sameNode] });
  await tick();
  assert.equal(title(sameNode), '重新进入', 'a cancelled node can mount again when its preview becomes visible');
  sameNodePending.resolve(response('已取消旧响应'));
  await tick();
  assert.equal(title(sameNode), '重新进入', 'the cancelled request cannot overwrite the new mount');

  const requestTimers = new Map();
  let nextTimer = 0;
  globalThis.window.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    requestTimers.set(id, { callback, delay });
    return id;
  };
  globalThis.window.clearTimeout = (id) => requestTimers.delete(id);
  const stalled = deferred();
  let stalledSignal;
  let stalledCalls = 0;
  globalThis.fetch = (_url, { signal }) => { stalledCalls += 1; stalledSignal = signal; return stalled.promise; };
  const timedOut = mount('/widget/timeout', { doubanType: 'auto' });
  await tick();
  assert.equal(requestTimers.size, 1, 'a pending collection request has a bounded deadline');
  [...requestTimers.values()][0].callback();
  await tick();
  assert.equal(stalledSignal.aborted, true, 'the timeout cancels transport work');
  assert.equal(timedOut.classList.contains('is-error'), true, 'timeouts reach the recoverable error state');
  assert.equal(timedOut.dataset.doubanLoading, 'false');
  assert.equal(requestTimers.size, 0, 'settled requests release their deadline');
  assert.equal(stalledCalls, 1, 'a type lookup timeout must not silently start a second collection request');
  stalled.resolve(response('超时旧响应'));
  await tick();
  assert.equal(title(timedOut), '豆瓣数据暂时不可用', 'a late timed-out transport cannot overwrite the error state');
  globalThis.window.setTimeout = setTimeout;
  globalThis.window.clearTimeout = clearTimeout;
  globalThis.fetch = async () => response('超时后重试成功');
  timedOut.dataset.doubanType = 'movie';
  timedOut.dispatch('click', 'retry');
  await tick();
  assert.equal(title(timedOut), '超时后重试成功');
} finally {
  roots.forEach((root) => root.__doubanShowcaseCleanup?.());
  for (const [name, value] of Object.entries(widgetGlobals)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}

console.log('verify-douban-adaptation passed (app, widget preview/states/retry/timeout/shared-request lifecycle)');
