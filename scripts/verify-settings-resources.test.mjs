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
