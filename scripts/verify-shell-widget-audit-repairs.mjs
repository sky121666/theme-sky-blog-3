import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { editModeMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js';
import { createDesktopWidgetDataLoader } from '../src/shell/desktop-shell/runtime/widgets/data-loader.js';
import { createFinderWidgetDataStore } from '../src/shell/desktop-shell/runtime/widgets/finder-data-loader.js';
import { installClickController } from '../src/shell/desktop-shell/runtime/desktop/pjax/click-controller.js';

const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
afterEach(() => Object.assign(globalThis, original));
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const html = (themeName = 'theme-sky-blog-3', name = 'preview') => `<html><body><script type="application/json" data-theme-desktop-widget-protocol>${JSON.stringify({ themeName, isHome: true, sources: { hydrated: true, loaded: { 'halo.latest_posts': true }, latestPosts: [{ metadata: { name } }] } })}</script></body></html>`;
function target(search = '?preview-theme=theme-sky-blog-3') {
  const owner = new EventTarget();
  owner.location = { origin: 'https://example.test', pathname: '/docs', search, href: `https://example.test/docs${search}` };
  owner.CustomEvent = CustomEvent;
  owner.__THEME_WIDGETS__ = { themeName: 'theme-sky-blog-3', siteUrl: 'https://example.test/blog/?view=desktop', sources: { hydrated: false } };
  return owner;
}
function menuFixture() {
  globalThis.window = { location: { origin: 'https://example.test', href: 'https://example.test/docs' }, __THEME_WIDGETS__: {} };
  globalThis.document = Object.assign(new EventTarget(), { title: '测试' });
  let factory;
  registerWindowManager({ store() {}, data(name, value) { if (name === 'menuBar') factory = value; } });
  const menu = factory();
  Object.assign(menu, { $refs: {}, $nextTick: async () => {}, notificationUsername: 'reader', notificationHasMore: true, notificationTotalCount: 1 });
  return menu;
}
function galleryFixture() {
  return Object.assign({}, editModeMethods, {
    isHome: true, isEditing: true, sources: { photoGroups: [] }, widgetConfigOptionsRequestId: 0,
    widgetConfigPhotoGroups() { return this.sources.photoGroups; }, closeDesktopContextMenu() {}, endCenterSheetDrag() {}, endDrag() {}, syncDesktopBodyState() {}
  });
}
function shortDeadlines() {
  globalThis.setTimeout = (callback, delay, ...args) => original.setTimeout(callback, delay >= 1000 ? 20 : delay, ...args);
}
async function settlesWithin(promise, milliseconds = 150) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise((resolve) => { timer = original.setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

// Catches ending notification ownership at headers rather than body completion.
for (const cause of ['deadline', 'parent cancellation']) test(`notification ${cause} releases a stalled JSON body without a retry`, async () => {
  const menu = menuFixture();
  const body = deferred();
  let requestSignal;
  let calls = 0;
  globalThis.fetch = async (_url, { signal }) => { calls += 1; requestSignal = signal; return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => body.promise, text: async () => JSON.stringify(await body.promise) }; };
  if (cause === 'deadline') shortDeadlines();
  const loading = menu.loadMoreNotifications();
  await turn();
  if (cause === 'parent cancellation') menu.notificationMoreController.abort();
  const settled = await settlesWithin(loading);
  const aborted = requestSignal.aborted;
  body.resolve({ items: [], total: 0 });
  await loading;
  assert.equal(settled, true, 'loading must be bounded even when the transport ignores cancellation');
  assert.equal(aborted, true, 'body ownership must retain the request signal');
  assert.equal(menu.notificationLoadingMore, false);
  assert.equal(calls, 1, 'writes and reads must never be implicitly retried');
});

// Catches stale gallery tasks reopening configuration after the editor closes.
test('exiting editing aborts pending gallery preparation and suppresses a late modal', async () => {
  const host = galleryFixture();
  const body = deferred();
  let requestSignal;
  let opens = 0;
  globalThis.fetch = async (_url, { signal }) => { requestSignal = signal; return { ok: true, json: () => body.promise }; };
  host.openWidgetConfigForm = () => { opens += 1; };
  const adding = host.addWidgetFromCatalog('plugin-photos.gallery');
  await turn();
  host.finishDesktopEditingSync();
  body.resolve({ items: [{ metadata: { name: 'album' } }] });
  await adding;
  assert.equal(opens, 0);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(host.sources.photoGroups, []);
});
test('gallery body timeout clears the shared pending task and permits an explicit retry', async () => {
  const host = galleryFixture();
  const body = deferred();
  let calls = 0;
  let requestSignal;
  globalThis.fetch = async (_url, { signal }) => { calls += 1; requestSignal = signal; return { ok: true, json: () => body.promise }; };
  shortDeadlines();
  const preparation = host.ensureWidgetConfigOptions('plugin-photos.gallery');
  const settled = await settlesWithin(preparation);
  const aborted = requestSignal.aborted;
  body.resolve({ items: [] });
  await preparation;
  assert.equal(settled, true);
  assert.equal(aborted, true);
  assert.equal(host.widgetConfigOptionsPromise, null);
  assert.match(host.widgetConfigOptionsError, /失败|超时/);
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ items: [{ metadata: { name: 'retry-album' } }] }) }; };
  assert.equal(await host.ensureWidgetConfigOptions('plugin-photos.gallery'), true);
  assert.equal(calls, 2);
});
test('a recommended layout waiting for gallery options cannot modify an exited editor', async () => {
  const host = galleryFixture();
  host.sources.photosAvailable = true;
  host.widgets = [];
  host._doAddWidget = async (widget) => { host.widgets.push({ widget }); };
  host.markDesktopLayoutDirty = () => {};
  const body = deferred();
  globalThis.fetch = async () => ({ ok: true, json: () => body.promise });
  const applying = host.applyRecommendedWidgetLayout();
  await turn();
  host.finishDesktopEditingSync();
  body.resolve({ items: [] });
  await applying;
  assert.deepEqual(host.widgets, []);
});

// Catches homepage/Finder reads silently dropping the active preview representation.
test('home widget hydration inherits only the current preview selector', async () => {
  const owner = target('?preview-theme=theme-sky-blog-3&token=secret&page=2');
  let requested;
  const load = createDesktopWidgetDataLoader(owner, { fetchImpl: async (path) => { requested = path; return new Response(html()); } });
  await load();
  assert.equal(requested, '/blog/?view=desktop&preview-theme=theme-sky-blog-3');
});
test('a mismatched preview theme cannot be installed as home widget data', async () => {
  const owner = target();
  const before = owner.__THEME_WIDGETS__;
  const load = createDesktopWidgetDataLoader(owner, { fetchImpl: async () => new Response(html('another-theme')) });
  await assert.rejects(load(), /主题|表示/);
  assert.equal(owner.__THEME_WIDGETS__, before);
});
test('Finder stores partition ready data by preview theme and keep query-gated fields', async () => {
  const owner = target();
  const requests = [];
  const store = createFinderWidgetDataStore(owner, { fetchImpl: async (path) => { requests.push(path); return new Response(html(requests.length === 1 ? 'theme-sky-blog-3' : 'another-preview', `post-${requests.length}`)); } });
  const widget = { widget: 'halo.latest_posts' };
  assert.equal((await store.load(widget)).sources.latestPosts[0].metadata.name, 'post-1');
  owner.location.search = '?preview-theme=another-preview';
  owner.location.href = 'https://example.test/docs?preview-theme=another-preview';
  assert.equal((await store.load(widget)).sources.latestPosts[0].metadata.name, 'post-2');
  assert.deepEqual(requests, ['/blog/?widgetSource=halo.latest_posts&preview-theme=theme-sky-blog-3', '/blog/?widgetSource=halo.latest_posts&preview-theme=another-preview']);
});
test('Finder rejects a response from a different preview theme', async () => {
  const store = createFinderWidgetDataStore(target(), { fetchImpl: async () => new Response(html('another-theme')) });
  await assert.rejects(store.load({ widget: 'halo.latest_posts' }), /主题|表示/);
});

// Catches closing UI before admission, blocking transport on animation, and losing trigger identity.
test('a real managed notification anchor delegates immediate admission with its trigger while close is pending', async () => {
  const menu = menuFixture();
  const close = deferred();
  const events = [];
  menu.markNotificationAsRead = async () => { events.push('read'); };
  menu.closeNotificationCenter = () => { events.push('close'); return close.promise; };
  const anchor = { isConnected: true, ownerDocument: document, href: 'https://example.test/post', matches: (selector) => selector === 'a[href]', getAttribute: (name) => name === 'href' ? '/post' : null, hasAttribute: () => false, classList: { contains: (name) => name === 'pjax-link' } };
  window.pjax = { loadUrl() { events.push('programmatic'); } };
  const dispose = installClickController({ document, readContext: () => ({ currentUrl: window.location.href, runtimeReady: true }), requestNavigation: ({ triggerElement }) => { assert.equal(triggerElement, anchor); events.push('request'); document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { source: 'click', url: 'https://example.test/post', intentId: 1 } })); } });
  const click = new Event('click', { cancelable: true });
  Object.assign(click, { button: 0, composedPath: () => [anchor] });
  Object.defineProperty(click, 'currentTarget', { value: anchor });
  const pending = menu.openNotificationItem({ href: '/post' }, click);
  // Real browser input performs a microtask checkpoint between listeners.
  await Promise.resolve();
  document.dispatchEvent(click);
  await turn();
  assert.deepEqual(events, ['request', 'read', 'close']);
  close.resolve();
  await pending;
  dispose();
});
test('a vetoed managed notification leaves its unread and panel context intact', async () => {
  const menu = menuFixture();
  let sideEffects = 0;
  menu.markNotificationAsRead = async () => { sideEffects += 1; };
  menu.closeNotificationCenter = () => { sideEffects += 1; return Promise.resolve(); };
  window.pjax = { loadUrl() { return Promise.resolve(false); } };
  await menu.openNotificationItem({ href: '/post' }, { button: 0, currentTarget: { tagName: 'A' }, preventDefault() {} });
  await turn();
  assert.equal(sideEffects, 0);
});
for (const gesture of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }, { defaultPrevented: true }]) test(`notification respects browser/component gesture ${JSON.stringify(gesture)}`, async () => {
  const menu = menuFixture();
  const events = [];
  menu.markNotificationAsRead = async () => { events.push('read'); };
  menu.closeNotificationCenter = async () => { events.push('close'); };
  window.pjax = { loadUrl() { events.push('navigate'); } };
  await menu.openNotificationItem({ href: '/post' }, { button: 0, ...gesture });
  assert.deepEqual(events, []);
});
