import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderWidgetBodyWithHost } from '../src/shell/desktop-shell/runtime/widgets/render-runtime.js';
import { createFinderWidgetDataStore } from '../src/shell/desktop-shell/runtime/widgets/finder-data-loader.js';
import { widgetNeedsFinderData } from '../src/shell/desktop-shell/runtime/widgets/source-types.js';
import { readFileSync } from 'node:fs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const html = (sources) => `<html><body><script type="application/json" data-theme-desktop-widget-protocol>${JSON.stringify({ isHome: true, sources: { hydrated: true, ...sources } })}</script></body></html>`;

test('a hydrated home does not render a query-gated source as an empty collection', async (t) => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://preview.example.test' }, __THEME_WIDGETS__: { siteUrl: 'https://public.example.test/' } };
  t.after(() => { globalThis.window = previous; });
  let calls = 0;
  const notified = new Set();
  t.mock.method(globalThis, 'fetch', async (path) => {
    calls += 1;
    assert.equal(path, '/?widgetSource=halo.popular_posts&widgetSource=halo.site_stats');
    return new Response(html({ loaded: { 'halo.popular_posts': true, 'halo.site_stats': true }, popularPosts: [{ spec: { title: '实际热门文章' } }], siteStats: { visit: 99 } }));
  });
  const host = {
    sources: { hydrated: true, loaded: { 'halo.popular_posts': false }, popularPosts: [] },
    widgetRenderVersions: {}, widgetRendererPromises: {}, widgetRendererErrors: {},
    onWidgetDataChanged: (type) => notified.add(type),
    widgetRenderers: { 'halo.popular_posts': ({ sources }) => sources.popularPosts[0]?.spec.title || '错误的空集合',
      'halo.site_stats': ({ sources }) => `访问 ${sources.siteStats.visit}` }
  };
  const widget = { widget: 'halo.popular_posts', key: 'preview', size: 'medium' };
  const stats = { widget: 'halo.site_stats', key: 'stats', size: 'small' };
  renderWidgetBodyWithHost(host, widget, { preview: true, visible: false });
  await turn();
  assert.equal(calls, 0);
  assert.match(renderWidgetBodyWithHost(host, widget, { preview: true, visible: true }), /加载中/);
  assert.match(renderWidgetBodyWithHost(host, stats, { preview: true, visible: true }), /加载中/);
  // The store is loaded only when an unloaded visible widget needs it.
  for (let i = 0; i < 10 && calls === 0; i += 1) {
    await turn();
    renderWidgetBodyWithHost(host, widget, { preview: true, visible: true });
    renderWidgetBodyWithHost(host, stats, { preview: true, visible: true });
  }
  await turn();
  assert.equal(renderWidgetBodyWithHost(host, widget, { preview: true, visible: true }), '实际热门文章');
  assert.equal(renderWidgetBodyWithHost(host, stats, { preview: true, visible: true }), '访问 99');
  assert.deepEqual([...notified].sort(), ['halo.popular_posts', 'halo.site_stats'], 'lazy runtime completion wakes every waiting type on one host');
  assert.equal(calls, 1);
  assert.deepEqual(host.sources.popularPosts, [], 'the shared bootstrap and unsaved layout are not overwritten');
});

test('same-turn visible types coalesce, sizes share data, and true empty responses are cached', async () => {
  const requests = [];
  const target = { location: { origin: 'https://preview.test' }, __THEME_WIDGETS__: { siteUrl: 'https://public.test/blog/' } };
  const store = createFinderWidgetDataStore(target, { fetchImpl: async (path) => {
    requests.push(path);
    return new Response(html({ loaded: { 'halo.latest_posts': true, 'plugin-moments.recent': true }, latestPosts: [], momentsAvailable: true, recentMoments: [] }));
  } });
  const latest = { widget: 'halo.latest_posts', size: 'small' };
  const first = store.load(latest);
  const second = store.load({ ...latest, size: 'large' });
  const moments = store.load({ widget: 'plugin-moments.recent' });
  assert.equal(first, second);
  const [posts, , recent] = await Promise.all([first, second, moments]);
  assert.deepEqual(requests, ['/blog/?widgetSource=halo.latest_posts&widgetSource=plugin-moments.recent']);
  assert.deepEqual(posts.sources.latestPosts, []);
  assert.deepEqual(recent.sources.recentMoments, []);
  await store.load(latest);
  assert.equal(requests.length, 1, 'a known empty result is not repeatedly fetched');
});

test('failed sources show errors, retry, and never accept a missing loaded marker', async () => {
  let calls = 0;
  const store = createFinderWidgetDataStore({}, { fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 503 });
    if (calls === 2) return new Response(html({ loaded: {}, siteStats: { visit: 99 } }));
    return new Response(html({ loaded: { 'halo.site_stats': true }, siteStats: { visit: 99 } }));
  } });
  const widget = { widget: 'halo.site_stats' };
  await assert.rejects(store.load(widget), /503/);
  assert.equal(store.get(widget).status, 'error');
  await assert.rejects(store.retry(widget), /缺少/);
  assert.equal((await store.retry(widget)).sources.siteStats.visit, 99);
});

test('timeout bounds even a stalled response body and aborts its request', async () => {
  let signal;
  const store = createFinderWidgetDataStore({}, { timeoutMs: 15, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return { ok: true, text: () => new Promise(() => {}) };
  } });
  await assert.rejects(store.load({ widget: 'halo.categories' }), /超时/);
  assert.equal(signal.aborted, true);
});

test('album selections use distinct bounded reads and cannot borrow another album payload', async () => {
  const paths = [];
  const store = createFinderWidgetDataStore({}, { fetchImpl: async (path) => {
    paths.push(path);
    const group = new URL(path, 'https://preview.test').searchParams.get('widgetPhotoGroup') || '';
    return new Response(html({ loaded: { 'plugin-photos.gallery': true }, photosAvailable: true, photoGroupName: group,
      photos: [{ metadata: { name: `${group}-photo` }, spec: { groupName: group } }], photoGroups: [] }));
  } });
  const album = (name) => ({ widget: 'plugin-photos.gallery', meta: { groupName: name } });
  const [first, second] = await Promise.all([store.load(album('first')), store.load(album('second'))]);
  assert.equal(first.sources.photos[0].metadata.name, 'first-photo');
  assert.equal(second.sources.photos[0].metadata.name, 'second-photo');
  assert.equal(paths.length, 2);
  assert.equal(widgetNeedsFinderData(album('second'), { loaded: { 'plugin-photos.gallery': true }, photoGroupName: 'first', photosAvailable: true }), true);
  assert.equal(widgetNeedsFinderData(album('second'), { loaded: { 'plugin-photos.gallery': true }, photoGroupName: '', photosAvailable: true,
    photoGroups: [{ metadata: { name: 'second' }, status: { photoCount: 23 } }] }), true, 'config option metadata does not prove that album photos were loaded');
  const wrongGroup = createFinderWidgetDataStore({}, { fetchImpl: async () => new Response(html({ loaded: { 'plugin-photos.gallery': true }, photoGroupName: 'wrong', photos: [] })) });
  await assert.rejects(wrongGroup.load(album('first')), /缺少/);
});

test('known unavailable plugins and resolved bootstrap sources need no background read', () => {
  for (const [widget, availability] of [
    ['plugin-moments.recent', 'momentsAvailable'], ['plugin-links.feed', 'friendsAvailable'],
    ['plugin-docsme.quick', 'docsmeAvailable'], ['plugin-photos.gallery', 'photosAvailable'], ['plugin-steam.summary', 'steamAvailable']
  ]) assert.equal(widgetNeedsFinderData({ widget }, { [availability]: false, loaded: {} }), false);
  assert.equal(widgetNeedsFinderData({ widget: 'halo.popular_posts' }, { loaded: { 'halo.popular_posts': true }, popularPosts: [] }), false);
  assert.equal(widgetNeedsFinderData({ widget: 'unknown.private' }, { loaded: {} }), false);
});

test('source cache expires and evicts settled albums at its size limit', async () => {
  let time = 0;
  let calls = 0;
  const store = createFinderWidgetDataStore({}, { now: () => time, ttlMs: 100, maxEntries: 2, fetchImpl: async (path) => {
    calls += 1;
    const group = new URL(path, 'https://preview.test').searchParams.get('widgetPhotoGroup') || '';
    return new Response(html({ loaded: { 'plugin-photos.gallery': true }, photoGroupName: group, photos: [] }));
  } });
  const album = (name) => ({ widget: 'plugin-photos.gallery', meta: { groupName: name } });
  await store.load(album('one'));
  await store.load(album('two'));
  await store.load(album('three'));
  assert.equal(store.get(album('one')), null);
  time = 101;
  assert.equal(store.get(album('three')), null);
  await store.load(album('three'));
  assert.equal(calls, 4);
});

test('template source gates execute only whitelisted requested types and preserve normal layout gates', () => {
  const template = readFileSync(new URL('../templates/modules/shell/layout.html', import.meta.url), 'utf8');
  const flags = {
    widgetsNeedsLatestPosts: 'halo.latest_posts', widgetsNeedsPopularPosts: 'halo.popular_posts', widgetsNeedsCategories: 'halo.categories',
    widgetsNeedsSiteStats: 'halo.site_stats', widgetsNeedsMoments: 'plugin-moments.recent', widgetsNeedsLinksFeed: 'plugin-links.feed',
    widgetsNeedsDocsme: 'plugin-docsme.quick', widgetsNeedsPhotos: 'plugin-photos.gallery', widgetsNeedsSteam: 'plugin-steam.summary'
  };
  for (const [flag, type] of Object.entries(flags)) {
    const expression = template.match(new RegExp(`${flag} = \\$\\{([^\\n]+)\\},`))?.[1];
    assert.ok(expression, `${flag} has a parseable decision expression`);
    const evaluate = Function('widgetsEnabled', 'isDesktopHome', 'widgetsSourceRequest', 'widgetsRequestedSources', 'desktopLayoutJson', 'widgetsCatalogOptionsNeeded', 'lists', 'strings',
      `return (${expression.replaceAll('#lists', 'lists').replaceAll('#strings', 'strings').replaceAll(' and ', ' && ').replaceAll(' or ', ' || ')})`);
    const check = (request, requested, saved, catalog = false) => evaluate(true, true, request, requested, saved, catalog,
      { contains: (items, value) => items.includes(value) }, { contains: (value, item) => value.includes(item) });
    assert.equal(check(true, [type], ''), true);
    assert.equal(check(true, ['unknown.private'], type, true), false, 'saved layout and catalog cannot expand a source request');
    assert.equal(check(false, [], type), true);
    assert.equal(check(false, [], ''), false);
  }
});
