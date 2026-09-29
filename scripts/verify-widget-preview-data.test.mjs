import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBangumiWidgetDataStore } from '../src/widgets/plugin/bangumis-recent/data.js';
import { renderWidget as renderBangumi } from '../src/widgets/plugin/bangumis-recent/render.js';
import { renderWidget as renderTags } from '../src/widgets/halo/random-tags/render.js';
import { renderWidgetBodyWithHost } from '../src/shell/desktop-shell/runtime/widgets/render-runtime.js';
import { createRandomTagsWidgetDataStore } from '../src/widgets/halo/random-tags/data.js';
import { createWidgetPreviewLifecycle } from '../src/shell/desktop-shell/runtime/widgets/preview-runtime.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function host(sources, extra = {}) {
  return {
    now: new Date(2026, 8, 29, 23, 59), sources,
    widgetRenderers: { 'plugin-bangumis.recent': renderBangumi, 'halo.random_tags': renderTags },
    widgetRendererPromises: {}, widgetRendererErrors: {}, widgetRenderVersions: {},
    ...extra
  };
}

test('visible Bangumi preview fetches real data once and shares it with a new draft', async () => {
  let calls = 0;
  const store = createBangumiWidgetDataStore({ fetchPage: async (query) => {
    calls += 1;
    return { ...query, total: 23, items: [{ metadata: { name: 'show' }, spec: { title: '实际追番条目' } }] };
  } });
  const state = host({ hydrated: true, bangumisAvailable: true }, { bangumiWidgetDataStore: store });
  const widget = { key: 'preview', widget: 'plugin-bangumis.recent', size: 'medium', meta: { typeNum: '1', status: 'watching' } };
  renderWidgetBodyWithHost(state, widget, { preview: true, visible: false });
  await settle();
  assert.equal(calls, 0, 'closed previews do not fetch');
  assert.match(renderWidgetBodyWithHost(state, widget, { preview: true, visible: true }), /加载中/);
  await settle();
  assert.equal(calls, 1, 'the visible preview starts its own data request');
  assert.match(renderWidgetBodyWithHost(state, widget, { preview: true, visible: true }), /实际追番条目/);
  assert.match(renderWidgetBodyWithHost(state, { ...widget, key: 'unsaved-draft' }), /实际追番条目/);
  assert.equal(calls, 1, 'adding a draft reuses the preview data');
});

test('random tag cache follows the host local calendar day', () => {
  let renders = 0;
  const state = host({ hydrated: true, randomTags: [{ spec: { displayName: '真实标签' }, status: { permalink: '/tags/real' } }] });
  state.widgetRenderers['halo.random_tags'] = ({ now }) => { renders += 1; return String(now.getDate()); };
  const widget = { key: 'tags', widget: 'halo.random_tags', size: 'medium' };
  assert.equal(renderWidgetBodyWithHost(state, widget), '29');
  state.now = new Date(2026, 8, 30, 0, 1);
  assert.equal(renderWidgetBodyWithHost(state, widget), '30');
  assert.equal(renders, 2);
});

test('a hydrated home with query-gated tags loads visible previews and unsaved drafts', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls += 1;
    assert.equal(url, '/apis/api.content.halo.run/v1alpha1/tags?page=1&size=100');
    return new Response(JSON.stringify({ page: 1, size: 100, total: 1, totalPages: 1, hasNext: false,
      items: [{ metadata: { name: 'real' }, spec: { displayName: '真实标签' }, status: { permalink: '/tags/real', postCount: 1 } }] }));
  });
  const state = host({ hydrated: true, randomTags: [] });
  const widget = { key: 'tags-preview', widget: 'halo.random_tags', size: 'medium' };
  renderWidgetBodyWithHost(state, widget, { preview: true, visible: false });
  await settle();
  assert.equal(calls, 0);
  assert.match(renderWidgetBodyWithHost(state, widget, { preview: true, visible: true }), /加载中/);
  renderWidgetBodyWithHost(state, { ...widget, key: 'large-preview', size: 'large' }, { preview: true, visible: true });
  for (let index = 0; index < 10 && calls === 0; index += 1) {
    await settle();
    renderWidgetBodyWithHost(state, widget, { preview: true, visible: true });
  }
  await settle();
  assert.match(renderWidgetBodyWithHost(state, widget, { preview: true, visible: true }), /真实标签/);
  assert.match(renderWidgetBodyWithHost(state, { ...widget, key: 'new-draft' }), /真实标签/);
  assert.equal(calls, 1, 'visible variants and draft share one request');
});

test('tag reads distinguish request errors from a successful empty collection and retry', async () => {
  let failing = true;
  const store = createRandomTagsWidgetDataStore({ fetchImpl: async () => {
    if (failing) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ page: 1, total: 0, items: [], hasNext: false }));
  } });
  const state = host({ hydrated: true, randomTags: [] }, { randomTagsWidgetDataStore: store });
  const widget = { widget: 'halo.random_tags', key: 'empty', size: 'medium' };
  assert.match(renderWidgetBodyWithHost(state, widget), /加载中/);
  await assert.rejects(store.load(), /503/);
  await settle();
  assert.match(renderWidgetBodyWithHost(state, widget), /role="alert"/);
  assert.doesNotMatch(renderWidgetBodyWithHost(state, widget), /当前没有可展示的标签/);
  failing = false;
  await store.retry();
  assert.match(renderWidgetBodyWithHost(state, widget), /当前没有可展示的标签/);
});

test('tag reads follow all public pages and reject malformed data', async () => {
  const urls = [];
  const store = createRandomTagsWidgetDataStore({ fetchImpl: async (url) => {
    urls.push(url);
    const page = urls.length;
    return new Response(JSON.stringify({ page, total: 2, items: [{ metadata: { name: `tag-${page}` } }], hasNext: page < 2 }));
  } });
  const loaded = await store.load();
  assert.deepEqual(loaded.sources.randomTags.map((tag) => tag.metadata.name), ['tag-1', 'tag-2']);
  assert.deepEqual(urls, ['/apis/api.content.halo.run/v1alpha1/tags?page=1&size=100', '/apis/api.content.halo.run/v1alpha1/tags?page=2&size=100']);
  const malformed = createRandomTagsWidgetDataStore({ fetchImpl: async () => new Response('{"items":[]}') });
  await assert.rejects(malformed.load(), /响应格式/);
});

test('preview lifecycle enhances visible content, cleans replaced nodes and cancels on close', () => {
  const events = [];
  const first = { __doubanShowcaseCleanup: () => events.push('first-cleanup') };
  const next = { __doubanShowcaseCleanup: () => events.push('next-cleanup') };
  let nodes = [first];
  const body = { isConnected: true, dataset: { widgetPreviewVisible: 'false' }, querySelectorAll: () => nodes };
  const lifecycle = createWidgetPreviewLifecycle(body, { enhance: () => events.push('enhance'), loadImages: () => events.push('images') });
  lifecycle.sync();
  assert.deepEqual(events, []);
  body.dataset.widgetPreviewVisible = 'true';
  lifecycle.sync();
  nodes = [next];
  lifecycle.sync();
  body.dataset.widgetPreviewVisible = 'false';
  lifecycle.sync();
  assert.deepEqual(events, ['images', 'enhance', 'first-cleanup', 'images', 'enhance', 'next-cleanup']);
  lifecycle.dispose();
  body.dataset.widgetPreviewVisible = 'true';
  lifecycle.sync();
  assert.equal(events.length, 6, 'a destroyed directive cannot restart requests');
});
