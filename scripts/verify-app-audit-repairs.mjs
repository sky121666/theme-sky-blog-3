import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isCompleteHtmlDocument, isHtmlDocumentResponse } from '../src/shared/html-document.js';

// Executes the production owners with only the network and DOM boundary replaced.
// A missing deadline, a wrong response branch, gated navigation, or replacing an
// existing card makes these checks fail without inspecting implementation text.
const read = (file) => fs.readFileSync(file, 'utf8');
const strip = (source) => source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export \{[^\n]*\} from [^\n]*;\n/gm, '').replace(/\bexport /g, '');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const results = [];
const classes = () => {
  const values = new Set();
  return { add: (...xs) => xs.forEach((x) => values.add(x)), remove: (...xs) => xs.forEach((x) => values.delete(x)), contains: (x) => values.has(x), toggle: (x, on) => on ? values.add(x) : values.delete(x) };
};
function environment(extra = {}) {
  const timers = new Map();
  let sequence = 0;
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, DOMException, console, isCompleteHtmlDocument, isHtmlDocumentResponse,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, warnApiCall() {}, registerPageAppLifecycle() {}, resolveMomentsAppProtocol() {},
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    document: { body: { dataset: {} } },
    window: { location: new URL('https://audit.invalid/equipments') }, ...extra
  });
  if (fs.existsSync('src/shared/request-deadline.js')) vm.runInContext(strip(read('src/shared/request-deadline.js')), context);
  return { context, timers, expire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(({ fn }) => fn()); } };
}
function component(file, register, extra = {}) {
  const env = environment(extra);
  vm.runInContext(strip(read(file)) + `\n${register}({data(_name, factory){ globalThis.__factory = factory; }});`, env.context);
  return { ...env, app: env.context.__factory() };
}
async function check(id, work) {
  try { await work(); results.push({ id, status: 'PASS' }); }
  catch (error) { results.push({ id, status: 'FAIL', message: error.message }); }
}
function hangingResponse(env, body = 'text') {
  env.context.fetch = async (_url, options) => ({
    ok: true, status: 200, url: 'https://audit.invalid/equipments?page=2',
    headers: new Headers({ 'content-type': body === 'text' ? 'text/html' : 'application/json' }),
    [body]: () => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  });
}

for (const [id, file, register] of [
  ['equipment', 'src/apps/equipments/runtime.js', 'registerEquipmentsExplorer'],
  ['bangumi', 'src/apps/bangumis/runtime.js', 'registerBangumisExplorer'],
  ['archive', 'src/apps/explorer/archives/runtime.js', 'registerArchiveExplorer'],
  ['steam', 'src/apps/steam/runtime.js', 'registerSteamExplorer']
]) {
  await check(`${id}: stalled HTML body releases loading and preserves retry`, async () => {
    const env = component(file, register);
    const { app } = env;
    Object.assign(app, { $root: { isConnected: true, querySelector: () => null }, nextUrl: '/equipments?page=2', hasMore: true, activeView: 'library' });
    hangingResponse(env);
    const task = app.loadNext(); await flush();
    assert.ok(env.timers.size, 'response body has no finite deadline');
    env.expire(); await task;
    assert.equal(app.loading, false);
    assert.equal(app.loadError, true);
    assert.equal(app.hasMore, true);
    assert.equal(app.nextUrl, '/equipments?page=2');
  });
}

function parsedPagination(id, { empty = false, missingTrigger = false, wrongApp = false } = {}) {
  const steam = id === 'steam';
  const cards = [{ id: 'new-card' }];
  const trigger = { dataset: { nextUrl: '' }, querySelector: () => ({}) };
  const list = {
    querySelectorAll: () => cards,
    querySelector: () => missingTrigger ? null : trigger
  };
  const app = {
    dataset: { steamLibraryState: empty ? 'empty' : 'ready' },
    querySelector(selector) {
      if (selector === `[data-app-props="${steam ? 'steam' : 'equipments'}"]`) return {};
      if (selector === '.steam-library-grid' || selector === '.equipments-stage-scroller') return empty ? null : list;
      if (selector === '[data-steam-loadmore]') return empty || missingTrigger ? null : trigger;
      if (empty && (selector === '.steam-empty--compact' || selector.includes('lucide--archive-x'))) return {};
      return null;
    }
  };
  return {
    body: {
      dataset: { errorPage: 'false', pageMode: `browser-${steam ? 'steam' : 'equipments'}`, appId: wrongApp ? 'reader' : (steam ? 'steam' : 'equipments'), windowVariant: steam ? 'steam' : 'equipments' },
      querySelector: () => app
    },
    querySelector: () => empty || missingTrigger ? null : trigger
  };
}
for (const [id, file, register] of [
  ['equipment', 'src/apps/equipments/runtime.js', 'registerEquipmentsExplorer'],
  ['steam', 'src/apps/steam/runtime.js', 'registerSteamExplorer']
]) {
  for (const [name, options, wantError, wantCards] of [
    ['valid final cards', {}, false, 1], ['valid empty page', { empty: true }, false, 0],
    ['wrong app protocol', { wrongApp: true }, true, 0], ['missing pagination structure', { missingTrigger: true }, true, 0]
  ]) {
    await check(`${id}: ${name}`, async () => {
      const env = component(file, register); let appended = 0;
      Object.assign(env.app, { $root: { isConnected: true, querySelector: () => null }, nextUrl: `/${id}?page=2`, hasMore: true, activeView: 'library', $nextTick() {}, appendCards(cards) { appended += cards.length; } });
      env.context.fetch = async () => ({ ok: true, status: 200, url: `https://audit.invalid/${id}?page=2`, text: async () => '<html><body></body></html>' });
      env.context.DOMParser = class { parseFromString() { return parsedPagination(id, options); } };
      await env.app.loadNext();
      assert.equal(env.app.loadError, wantError);
      assert.equal(appended, wantCards);
      assert.equal(env.app.hasMore, wantError);
      assert.equal(env.app.nextUrl, wantError ? `/${id}?page=2` : '');
    });
  }
}

for (const [id, file, register] of [
  ['equipment', 'src/apps/equipments/runtime.js', 'registerEquipmentsExplorer'],
  ['steam', 'src/apps/steam/runtime.js', 'registerSteamExplorer']
]) {
  await check(`${id}: redirected 200 login HTML stays retryable`, async () => {
    const env = component(file, register);
    Object.assign(env.app, { $root: { isConnected: true, querySelector: () => null }, nextUrl: `/${id}?page=2`, hasMore: true, activeView: 'library' });
    env.context.fetch = async () => ({ ok: true, status: 200, redirected: true, url: 'https://audit.invalid/login', text: async () => '<html><body>Login</body></html>' });
    env.context.DOMParser = class { parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; } };
    await env.app.loadNext();
    assert.equal(env.app.loadError, true, 'a login response must not become end-of-list');
    assert.equal(env.app.hasMore, true);
    assert.equal(env.app.nextUrl, `/${id}?page=2`);
  });
}

await check('douban: JSON body deadline covers all list readers', async () => {
  const env = environment();
  vm.runInContext(strip(read('src/apps/douban/runtime.js')) + '\nglobalThis.__fetchJson = fetchJson;', env.context);
  hangingResponse(env, 'json');
  const task = env.context.__fetchJson('/api', {}, new AbortController().signal);
  const rejected = task.catch((error) => error); await flush();
  assert.ok(env.timers.size, 'JSON body has no deadline');
  env.expire(); assert.equal((await rejected).name, 'TimeoutError');
});

await check('photos: stalled pagination body exposes retry and clears skeletons', async () => {
  const env = component('src/apps/photos/runtime/explorer.js', 'registerPhotosExplorer');
  env.context.window.location = new URL('https://audit.invalid/photos');
  const next = { href: '/photos/page/2' }, sentinel = {};
  const spinner = { classList: classes() }, error = { classList: classes() }, noMore = { classList: classes() };
  error.classList.add('hidden');
  const nodes = { '#next-page-url': next, '.photos-scroll-sentinel': sentinel, '#photos-loading-spinner': spinner, '#photos-load-error': error, '#photos-no-more': noMore };
  const app = env.app; let cleared = 0;
  app.$el = { isConnected: true, querySelector: (selector) => nodes[selector] || null };
  app._showLoadingSkeletons = () => {}; app._clearLoadingSkeletons = () => { cleared++; };
  app._initInfiniteScroll(); hangingResponse(env);
  const task = app._paginationLoadMore(); await flush();
  assert.ok(env.timers.size, 'photo body has no deadline'); env.expire(); await task;
  assert.equal(error.classList.contains('hidden'), false);
  assert.equal(spinner.classList.contains('hidden'), true);
  assert.ok(cleared > 0);
  assert.equal(next.href, '/photos/page/2');
});

await check('links: stalled feed JSON preserves cursor and releases loading', async () => {
  const env = component('src/apps/links/runtime.js', 'registerLinksExplorer');
  Object.assign(env.app, { $root: { querySelector: () => null }, feedHasNext: true, feedNextId: 'cursor', feedNextPublishedAt: '2026-01-01', feedItemCount: 1 });
  hangingResponse(env, 'json');
  const task = env.app.fetchFeedPage({ replace: false }); await flush();
  assert.ok(env.timers.size, 'feed body has no deadline'); env.expire(); await task;
  assert.equal(env.app.feedLoading, false);
  assert.equal(env.app.feedStatus, 'error');
  assert.equal(env.app.feedNextId, 'cursor');
  assert.equal(env.app.feedHasNext, true);
});

await check('moments waterfall: stalled HTML releases loading and preserves cursor', async () => {
  const env = environment();
  const source = read('templates/modules/moments-app/list.html').match(/x-data="(\{\s*nextUrl: \$el.dataset.nextUrl,[\s\S]*?)"\s*th:data-next-url/)[1];
  env.context.$el = { dataset: { nextUrl: '/moments?page=2' } };
  vm.runInContext('globalThis.__waterfall = (' + source + ');', env.context);
  const app = env.context.__waterfall, root = {}, list = {};
  Object.assign(app, { $el: { isConnected: true }, appRoot: () => root, feedList: () => list, currentPath: () => '/moments', routeKey: '/moments', debugLog() {} });
  hangingResponse(env);
  env.context.fetch = async (_url, { signal }) => ({ ok: true, text: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')), { once: true });
  }) });
  const task = app.loadNext(); await flush();
  assert.ok(env.timers.size, 'waterfall body has no deadline'); env.expire(); await task;
  assert.equal(app.loading, false); assert.ok(app.loadError);
  assert.equal(app.hasMore, true); assert.equal(app.nextUrl, '/moments?page=2');
});

function domContainer() {
  return {
    children: [], writes: 0,
    set innerHTML(html) { this.writes++; this.children = []; this.insertAdjacentHTML('beforeend', html); },
    insertAdjacentHTML(_position, html) {
      for (const match of html.matchAll(/<(?:article|tr)\b[^>]*data-douban-item-id="([^"]+)"[^>]*>/g)) this.children.push({ id: match[1], markup: match[0] });
    }
  };
}
await check('douban: append and view switch retain existing card identities', async () => {
  const env = environment();
  vm.runInContext(strip(read('src/apps/douban/runtime.js')) + '\nglobalThis.__DoubanApp = DoubanApp;', env.context);
  const app = new env.context.__DoubanApp({ isConnected: true, classList: classes() });
  const grid = domContainer(), list = domContainer();
  app.query = (selector) => ({ '[data-douban-grid]': grid, '[data-douban-list-body]': list })[selector] || null;
  grid.toggleAttribute = list.toggleAttribute = () => {};
  app.queryAll = () => []; app.highlightFocusedItem = () => {};
  app.state.items = [{ metadata: { name: 'old' }, spec: { name: 'Old' } }];
  Object.assign(app.state, { hasMore: true, page: 1, pageSize: 1 });
  app.renderItems(); const oldGrid = grid.children[0], oldRow = list.children[0];
  app.fetchList = async () => ({ items: [{ metadata: { name: 'new' }, spec: { name: 'New' } }], total: 2 });
  await app.loadMore();
  assert.equal(grid.children[0], oldGrid, 'append replaced the visible old card');
  assert.equal(list.children[0], oldRow, 'append replaced the old table row');
  assert.equal(grid.children.length, 2);
  app.setViewMode('list'); app.setViewMode('grid');
  assert.equal(grid.children[0], oldGrid, 'view switching recreated history');
  assert.equal(list.children[0], oldRow);
});

function notificationFixture({ accepted = true } = {}) {
  class Element {
    constructor() { this.dataset = { notificationId: 'n-1', notificationHref: '/moments/m-1' }; this.classList = classes(); }
    closest() { return this; } getAttribute() { return null; } hasAttribute() { return false; } remove() { this.removed = true; }
  }
  let click;
  const inert = { addEventListener() {}, removeEventListener() {}, setAttribute() {}, hidden: false };
  const list = { ...inert, querySelector: () => null, addEventListener(type, fn) { if (type === 'click') click = fn; } };
  const node = { dataset: {}, classList: classes(), isConnected: true, querySelector: (selector) => ({ '[data-moments-notification-toggle]': inert, '[data-moments-notification-panel]': inert, '[data-moments-notification-list]': list })[selector] || null };
  const navigations = [], requests = [];
  const listeners = new Map();
  const doc = {
    querySelectorAll: () => [node],
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const env = environment({ Element, document: doc, window: { location: new URL('https://audit.invalid/moments'), pjax: { loadUrl(...args) {
    navigations.push(args);
    if (accepted) listeners.get('theme:navigation-accepted')?.forEach((listener) => listener({ detail: { url: new URL(args[0], 'https://audit.invalid').href } }));
  } } } });
  env.context.fetch = (...args) => { requests.push(args); return new Promise(() => {}); };
  const source = strip(read('src/apps/moments/hydrate.js')).replace("list?.addEventListener('click', onNotificationClick, true);", "list?.addEventListener('click', onNotificationClick, true); currentUsername = 'audit-user';");
  vm.runInContext(source + '\nglobalThis.__cleanup = setupMomentNotifications(document);', env.context);
  return { ...env, click: (...args) => click(...args), navigations, requests, anchor: new Element(), panel: inert };
}
await check('notification: a leave veto retains panel and does not write read state', async () => {
  const env = notificationFixture({ accepted: false });
  void env.click({ target: env.anchor, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  await flush();
  assert.equal(env.navigations.length, 1, 'the target must still be submitted to shared admission');
  assert.equal(env.requests.length, 0, 'a rejected intent must not mark the notification read');
  assert.equal(env.panel.hidden, false, 'a rejected intent must retain the notification panel');
  env.context.__cleanup();
});
await check('notification: navigation starts with trigger before pending mark-read completes', async () => {
  const env = notificationFixture();
  const event = { target: env.anchor, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  const task = env.click(event); await flush();
  assert.equal(env.navigations.length, 1, 'mark-read gated the selected navigation');
  assert.equal(env.navigations[0][0], '/moments/m-1');
  assert.equal(env.navigations[0][1]?.triggerElement, env.anchor);
  assert.ok(env.timers.size, 'mark-read has no deadline');
  env.expire(); await task;
  assert.equal(env.requests.length, 1, 'uncertain write must not be retried');
  env.context.__cleanup();
});
for (const flags of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
  await check(`notification: native click ${JSON.stringify(flags)}`, async () => {
    const env = notificationFixture(); let prevented = 0;
    void env.click({ target: env.anchor, button: 0, ...flags, preventDefault() { prevented++; }, stopPropagation() {}, stopImmediatePropagation() {} });
    await flush();
    assert.equal(prevented, 0, 'browser native action was cancelled');
    assert.equal(env.navigations.length, 0);
    env.context.__cleanup();
  });
}

await check('moments: comments JSON body has a deadline', async () => {
  const env = environment();
  vm.runInContext(strip(read('src/apps/moments/interactions.js')) + '\nglobalThis.__requestComments = requestComments;', env.context);
  hangingResponse(env, 'json');
  const task = env.context.__requestComments({ name: 'm-1' }, 1, { signal: new AbortController().signal }).catch((error) => error);
  await flush(); assert.ok(env.timers.size, 'comments body has no deadline');
  env.expire(); assert.equal((await task).name, 'TimeoutError');
});

await check('notification: current-user JSON body has a deadline', async () => {
  const env = environment();
  vm.runInContext(strip(read('src/apps/moments/hydrate.js')) + '\nglobalThis.__resolveCurrentUsername = resolveCurrentUsername;', env.context);
  hangingResponse(env, 'json');
  const task = env.context.__resolveCurrentUsername('/user', new AbortController().signal).catch((error) => error);
  await flush(); assert.ok(env.timers.size);
  env.expire(); assert.equal((await task).name, 'TimeoutError');
});

await check('steam: stalled heatmap JSON remains unavailable and retryable', async () => {
  const env = component('src/apps/steam/runtime.js', 'registerSteamExplorer');
  const grid = { innerHTML: '' };
  const panel = { dataset: { steamHeatmapDays: '28' }, style: { setProperty() {} }, querySelector: (selector) => selector === '[data-steam-heatmap-grid]' ? grid : null };
  Object.assign(env.app, { $root: { isConnected: true, querySelector: () => panel } });
  hangingResponse(env, 'json');
  const task = env.app.renderHeatmap(); await flush();
  assert.ok(env.timers.size); env.expire(); await task;
  assert.equal(panel.dataset.steamHeatmapState, 'unavailable');
  assert.equal(env.app._heatmapLoaded, false);
});

for (const operation of ['upvoteMoment', 'loadMoreReplies', 'submitComment']) {
  await check(`moments: ${operation} pending request settles without automatic resend`, async () => {
    const env = environment();
    const state = { name: 'm-1', comments: [{ name: 'c-1', replyHasMore: true, replies: [] }], replyLoading: new Set(), replyControllers: new Map(), commentsRequestGeneration: 0 };
    const input = { value: 'keep this draft', style: {} };
    const card = { isConnected: true, dataset: {}, querySelector: (selector) => selector === '[data-moment-comment-input]' ? input : null };
    Object.assign(env.context, { __state: state, __card: card });
    vm.runInContext(strip(read('src/apps/moments/interactions.js')) + `\ngetState = () => globalThis.__state; renderCard = renderComments = () => {}; readUpvoted = () => []; globalThis.__operation = ${operation};`, env.context);
    let calls = 0;
    env.context.fetch = () => { calls++; return new Promise(() => {}); };
    const task = env.context.__operation(card, 'c-1'); await flush();
    assert.ok(env.timers.size, 'pending operation has no deadline'); env.expire(); await task;
    assert.equal(calls, 1, 'write timeout must not resend');
    if (operation === 'upvoteMoment') { assert.equal(state.upvoting, false); assert.match(state.message, /待确认/); }
    if (operation === 'submitComment') { assert.equal(state.submitting, false); assert.equal(input.value, 'keep this draft'); assert.match(state.message, /待确认/); }
    if (operation === 'loadMoreReplies') { assert.equal(state.replyLoading.size, 0); assert.match(state.message, /失败|超时/); }
  });
}

console.log(JSON.stringify({ runtime: process.version, boundary: 'Production source execution with controlled network/DOM; no browser or HTTP.', results }, null, 2));
if (results.some(({ status }) => status === 'FAIL')) process.exitCode = 1;
