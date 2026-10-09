import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
const api = await import('../src/shell/desktop-shell/runtime/desktop/settings-model/resource-client.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const response = (items, overrides = {}) => new Response(JSON.stringify({ items, page: 1, size: 50, total: items.length, ...overrides }), { headers: { 'Content-Type': 'application/json' } });
test('资源客户端提供独立只读入口', () => assert.equal(typeof api.listSettingResources, 'function'));
test('菜单使用已核实 core endpoint；分页和会话不变成写入', async () => {
  globalThis.fetch = async (href, options) => {
    const url = new URL(href, 'https://site.test');
    assert.equal(url.pathname, '/api/v1alpha1/menus');
    assert.equal(url.searchParams.get('size'), '50');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'GET');
    return response([{ metadata: { name: 'primary' }, spec: { displayName: '主菜单' } }]);
  };
  const value = await api.listSettingResources('menus');
  assert.deepEqual(value.items.map(({name,label}) => ({name,label})), [{ name: 'primary', label: '主菜单' }]);
});
test('文章名称与永久链接使用资源真实字段，忽略删除中项', async () => {
  globalThis.fetch = async () => response([
    { metadata: { name: 'post-a' }, spec: { title: '文章', publish: true }, status: { permalink: '/archives/a' } },
    { metadata: { name: 'gone', deletionTimestamp: '2026-09-29' }, spec: { title: '已删除' } },
  ], { page: 2, total: 120 });
  const result = await api.listSettingResources('posts', { page: 2 });
  assert.equal(result.items[0].permalink, '/archives/a');
  assert.equal(result.items.length, 1);
  assert.equal(result.hasNext, true);
});
test('不支持的资源和无权限明确失败，不能成为空列表', async () => {
  await assert.rejects(() => api.listSettingResources('secrets'), /不支持/);
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(() => api.listSettingResources('tags'), /权限/);
});

test('商城分类读取完整树并展开成字符串 ID 选项，不使用文章分类分页', async () => {
  globalThis.fetch = async (href, options) => {
    assert.equal(href, '/apis/console.api.ecommerce.halo.run/v1alpha1/product-categories');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    return new Response(JSON.stringify([
      { id: 12, name: '设计', children: [{ id: '18', name: '图标', children: [] }] },
      { id: '24', name: '工具', children: [] }
    ]), { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await api.listSettingResources('shopCategories');
  assert.deepEqual(result, {
    items: [
      { name: '12', label: '设计', disabled: false },
      { name: '18', label: '设计 / 图标', disabled: false },
      { name: '24', label: '工具', disabled: false }
    ], page: 1, total: 3, hasNext: false
  });
});

test('商城空分类树可读取，错误响应不可伪装为无分类', async () => {
  globalThis.fetch = async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await api.listSettingResources('shopCategories'), { items: [], page: 1, total: 0, hasNext: false });
  for (const malformed of [{ items: [] }, [{ id: 'one', children: [] }], [{ id: 'one', name: '一级', children: {} }]]) {
    globalThis.fetch = async () => new Response(JSON.stringify(malformed), { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(() => api.listSettingResources('shopCategories'), /无效.*分类/);
  }
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(() => api.listSettingResources('shopCategories'), /权限/);
});

test('商城商品使用已发布过滤与 Spring Page 分页，下一页不会漏商品', async () => {
  globalThis.fetch = async (href, options) => {
    const url = new URL(href, 'https://site.test');
    assert.equal(url.pathname, '/apis/console.api.ecommerce.halo.run/v1alpha1/products');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('sort'), 'id,asc');
    assert.equal(url.searchParams.get('statuses'), 'PUBLISHED');
    assert.equal(options.method, 'GET');
    return new Response(JSON.stringify({ content: [
      { id: 210, title: '第二页商品', status: 'PUBLISHED' },
      { id: '211', title: '已下架', status: 'DRAFT' }
    ], number: 1, size: 50, totalElements: 151 }), { headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await api.listSettingResources('shopProducts', { page: 2 }), {
    items: [{ name: '210', label: '第二页商品', disabled: false }, { name: '211', label: '已下架', disabled: true }],
    page: 2, total: 151, hasNext: true
  });
});

test('商城商品末页和空页可读取，错误分页不能伪装为空', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [], number: 0, size: 50, totalElements: 0 }), { headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await api.listSettingResources('shopProducts'), { items: [], page: 1, total: 0, hasNext: false });
  for (const malformed of [{ items: [] }, { content: [], number: -1, size: 50, totalElements: 0 }, { content: [{ id: 1 }], number: 0, size: 50, totalElements: 1 }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(malformed), { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(() => api.listSettingResources('shopProducts'), /无效.*商品/);
  }
});
