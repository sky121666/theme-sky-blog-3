import assert from 'node:assert/strict';
import { renderBatch } from '../src/apps/explorer/shared/render-batch.js';
import { registerCategoriesExplorer } from '../src/apps/explorer/categories/runtime.js';
import { registerTagsExplorer } from '../src/apps/explorer/tags/runtime.js';
import { registerAuthorPostsExplorer } from '../src/apps/explorer/author/runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createContainer() {
  let chunks = [];
  const parentElement = {
    querySelector: () => null,
    insertBefore() {},
  };
  return {
    style: {},
    parentElement,
    get innerHTML() {
      return chunks.join('');
    },
    set innerHTML(value) {
      chunks = value ? [String(value)] : [];
    },
    appendChild(fragment) {
      chunks.push(String(fragment?.html || ''));
    },
    replaceChildren(...nodes) {
      this.restoredNodes = nodes;
      chunks = nodes.map((node) => String(node?.html || ''));
    },
    insertAdjacentHTML(_position, html) {
      chunks.push(String(html));
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function post(name) {
  return {
    metadata: { name },
    spec: { title: name, publishTime: '2026-07-20T00:00:00Z' },
    status: { permalink: `/archives/${name}`, excerpt: `${name}-excerpt` },
    stats: { comment: 0 },
  };
}

function captureFactory(register, expectedName) {
  let factory = null;
  register({
    data(name, candidate) {
      assert.equal(name, expectedName);
      factory = candidate;
    },
  });
  assert.equal(typeof factory, 'function', `${expectedName} should register an Alpine factory`);
  return factory;
}

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;

let nextFrameId = 1;
const frames = new Map();
const historyState = { uid: 'pjax-uid', scrollPos: [12, 34], __browserNavIndex: 4 };
const sessionEntries = new Map();
let replacedState = null;
let replacedUrl = '';

globalThis.requestAnimationFrame = (callback) => {
  const id = nextFrameId;
  nextFrameId += 1;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);

function flushFrame() {
  const entry = frames.entries().next().value;
  if (!entry) return false;
  const [id, callback] = entry;
  frames.delete(id);
  callback();
  return true;
}

function flushFrames() {
  let guard = 0;
  while (flushFrame()) {
    guard += 1;
    assert.ok(guard < 100, 'render queue should settle');
  }
}

globalThis.document = {
  body: { dataset: { pageApp: 'explorer-author' } },
  documentElement: {},
  createElement: () => ({}),
  createRange: () => ({
    selectNodeContents() {},
    createContextualFragment: (html) => ({ html }),
  }),
};
globalThis.window = {
  location: {
    href: 'http://theme.test/authors/sky?source=moments&momentPage=2',
    search: '?source=moments&momentPage=2',
  },
  history: {
    state: historyState,
    replaceState(state, _title, url) {
      replacedState = state;
      replacedUrl = String(url || '');
      this.state = state;
      if (replacedUrl) {
        const nextLocation = new URL(replacedUrl);
        window.location.href = nextLocation.toString();
        window.location.search = nextLocation.search;
      }
    },
  },
  sessionStorage: {
    getItem: (key) => sessionEntries.get(key) ?? null,
    setItem: (key, value) => sessionEntries.set(key, String(value)),
  },
  pjax: null,
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ display: 'block' }),
};

try {
  const batchContainer = createContainer();
  const staleBatch = renderBatch(
    batchContainer,
    Array.from({ length: 10 }, (_, index) => `<i>old-${index}</i>`),
    { batchSize: 8 },
  );
  flushFrame();
  assert.match(batchContainer.innerHTML, /old-7/, 'the first batch should render before cancellation');
  staleBatch.cancel();
  renderBatch(batchContainer, ['<b>new-only</b>'], { batchSize: 1 });
  flushFrames();
  assert.equal(batchContainer.innerHTML, '<b>new-only</b>', 'a cancelled batch must not append stale frames');
  assert.equal(staleBatch.cancelled, true, 'renderBatch should expose cancellation state');

  const explorerCases = [
    {
      factory: captureFactory(registerCategoriesExplorer, 'categoriesExplorer'),
      listSelector: '[data-category-posts-list]',
      activeHrefKey: 'activeCategoryHref',
      parentName: '分类',
      fetchMethod: 'fetchCategoryPosts',
      cacheKey: 'cat-posts-cached-scope',
    },
    {
      factory: captureFactory(registerTagsExplorer, 'tagsExplorer'),
      listSelector: '[data-tag-posts-list]',
      activeHrefKey: 'activeTagHref',
      parentName: '标签',
      fetchMethod: 'fetchTagPosts',
      cacheKey: 'tag-posts-cached-scope',
    },
  ];

  for (const {
    factory,
    listSelector,
    activeHrefKey,
    parentName,
    fetchMethod,
    cacheKey,
  } of explorerCases) {
    const list = createContainer();
    const instance = factory();
    instance.$root = {
      querySelector(selector) {
        if (selector === listSelector) return list;
        if (selector.endsWith('-posts-scroll') || selector.endsWith('-preview-scroll')) return { scrollTop: 1 };
        return null;
      },
    };
    instance[activeHrefKey] = '/current';

    instance.renderDynamicPosts(
      Array.from({ length: 10 }, (_, index) => post(`stale-${index}`)),
      10,
      parentName,
      0,
    );
    flushFrame();
    const staleJob = instance._renderJob;
    instance._selectionGeneration = 1;
    instance.renderDynamicPosts([post('current')], 1, parentName, 1);
    flushFrames();

    assert.equal(staleJob.cancelled, true, `${parentName}切换 should cancel the stale render job`);
    assert.match(list.innerHTML, /current/, `${parentName}切换 should render the current selection`);
    assert.doesNotMatch(list.innerHTML, /stale-/, `${parentName}切换 must not retain stale batch items`);

    const ssrNode = { html: '<i>ssr-original</i>' };
    instance._ssrPostNodes = [ssrNode];
    instance._showingSsr = false;
    instance.showSsrPanel(true);
    assert.deepEqual(list.restoredNodes, [ssrNode], `${parentName}切回首项 should restore the original SSR nodes`);

    instance._selectionGeneration += 1;
    sessionEntries.set(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: [post('cached-post')],
      total: 1,
    }));
    await instance[fetchMethod]('cached-scope', parentName, instance._selectionGeneration);
    assert.equal(instance.fetchController, null, `${parentName} cache hit should release its AbortController reference`);
    flushFrames();
    sessionEntries.delete(cacheKey);
  }

  const authorFactory = captureFactory(registerAuthorPostsExplorer, 'authorPostsExplorer');
  const historyAuthor = authorFactory();
  historyAuthor.activeSource = 'posts';
  historyAuthor.writeUrlState();
  assert.deepEqual(replacedState, {
    ...historyState,
    url: 'http://theme.test/authors/sky',
  }, 'author URL updates must preserve existing PJAX fields and synchronize state.url');
  assert.deepEqual(historyState, {
    uid: 'pjax-uid',
    scrollPos: [12, 34],
    __browserNavIndex: 4,
  }, 'author URL updates must not mutate the previous history state object');
  assert.equal(replacedUrl, 'http://theme.test/authors/sky', 'author URL updates should replace the visible URL');

  const cacheAuthor = authorFactory();
  cacheAuthor.authorName = 'sky';
  sessionEntries.set('author-moments-sky-page-1', JSON.stringify({
    timestamp: Date.now(),
    data: [{ key: 'cached-moment', title: 'cached-moment' }],
  }));
  const cachedMoments = await cacheAuthor.fetchMomentPage(1);
  assert.equal(cachedMoments[0]?.key, 'cached-moment', 'author should return a valid cached Moments page');
  assert.equal(cacheAuthor.momentFetchController, null, 'author cache hit should release its AbortController reference');
  sessionEntries.delete('author-moments-sky-page-1');

  const alreadyRenderedAuthor = authorFactory();
  alreadyRenderedAuthor.activeSource = 'moments';
  alreadyRenderedAuthor.momentTotalPages = 3;
  alreadyRenderedAuthor.momentPage = 2;
  alreadyRenderedAuthor.renderedMomentPage = 2;
  alreadyRenderedAuthor.renderMomentPagination = () => {};
  const staleController = new AbortController();
  alreadyRenderedAuthor.momentFetchController = staleController;
  await alreadyRenderedAuthor.goToMomentPage(2, { updateUrl: false });
  assert.equal(staleController.signal.aborted, true, 'returning to an already rendered author page must abort the in-flight request');

  window.location.href = 'http://theme.test/authors/sky?source=moments&momentPage=2';
  window.location.search = '?source=moments&momentPage=2';
  window.history.state = { ...historyState, url: window.location.href };
  const roundTripAuthor = authorFactory();
  let staleMomentOptionQueries = 0;
  roundTripAuthor.$root = {
    querySelector(selector) {
      if (selector === '[data-author-post-option]') {
        return { dataset: { postKey: 'post-1', postTitle: 'post-1' } };
      }
      if (selector === '[data-author-moment-option]') {
        staleMomentOptionQueries += 1;
        return {
          dataset: {
            momentKey: 'moment-page-2',
            momentTitle: 'moment-page-2',
          },
        };
      }
      return null;
    },
  };
  roundTripAuthor.activeSource = 'moments';
  roundTripAuthor.momentsEnabled = true;
  roundTripAuthor.momentTotalPages = 3;
  roundTripAuthor.momentPage = 2;
  roundTripAuthor.renderedMomentPage = 2;
  roundTripAuthor.activeMomentKey = 'moment-page-2';
  roundTripAuthor.activeMomentTitle = 'moment-page-2';
  roundTripAuthor.renderMomentPagination = () => {};
  roundTripAuthor.scrollListToTop = () => {};
  roundTripAuthor.scrollPreviewToTop = () => {};
  const roundTripFetches = [];
  let renderedMomentDomPage = 2;
  roundTripAuthor.fetchMomentPage = async (page) => {
    roundTripFetches.push(page);
    return [{ key: `moment-page-${page}`, title: `moment-page-${page}`, page }];
  };
  roundTripAuthor.renderMomentPage = (items) => {
    renderedMomentDomPage = items[0]?.page;
  };

  await roundTripAuthor.switchSource('posts');
  assert.equal(roundTripAuthor.momentPage, 2, 'switching away should keep the hidden Moments page marker aligned with its DOM');
  assert.equal(roundTripAuthor.renderedMomentPage, 2, 'switching away should not relabel the rendered Moments DOM');
  assert.equal(replacedUrl, 'http://theme.test/authors/sky', 'switching to posts should remove Moments query state');

  await roundTripAuthor.switchSource('moments');
  assert.deepEqual(roundTripFetches, [1], 'returning to Moments should load the reset page before selection');
  assert.equal(roundTripAuthor.momentPage, 1, 'returning to Moments should reset the page marker to page 1');
  assert.equal(roundTripAuthor.renderedMomentPage, 1, 'returning to Moments should render page 1 before exposing its state');
  assert.equal(renderedMomentDomPage, 1, 'returning to Moments should replace the stale page 2 DOM');
  assert.equal(roundTripAuthor.activeMomentKey, 'moment-page-1', 'returning to Moments should select an item from the rendered page');
  assert.equal(staleMomentOptionQueries, 0, 'returning after a page reload must not reselect from the stale pre-render DOM');
  assert.equal(replacedUrl, 'http://theme.test/authors/sky?source=moments', 'returning to Moments should write the matching page 1 URL');

  const racingAuthor = authorFactory();
  racingAuthor.activeSource = 'moments';
  racingAuthor.momentTotalPages = 3;
  racingAuthor.renderedMomentPage = 1;
  racingAuthor.renderMomentPagination = () => {};
  racingAuthor.scrollListToTop = () => {};
  racingAuthor.scrollPreviewToTop = () => {};
  const pageTwo = deferred();
  const pageThree = deferred();
  const renderedPages = [];
  racingAuthor.fetchMomentPage = (page) => (page === 2 ? pageTwo.promise : pageThree.promise);
  racingAuthor.renderMomentPage = (items) => renderedPages.push(items[0]?.page);

  const pageTwoJob = racingAuthor.goToMomentPage(2, { updateUrl: false });
  const pageThreeJob = racingAuthor.goToMomentPage(3, { updateUrl: false });
  pageThree.resolve([{ key: 'page-3', title: 'page-3', page: 3 }]);
  await pageThreeJob;
  pageTwo.resolve([{ key: 'page-2', title: 'page-2', page: 2 }]);
  await pageTwoJob;

  assert.deepEqual(renderedPages, [3], 'a late author page response must not overwrite the latest target page');
  assert.equal(racingAuthor.momentPage, 3, 'the latest author page should remain selected');
  assert.equal(racingAuthor.renderedMomentPage, 3, 'the rendered author page marker should match the latest response');
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  if (previousCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
}

console.log('verify-explorer-interactions passed');
