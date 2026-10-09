import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_FIELDS, buildThemeSettingsDraft, updateThemeSettingsDraft, themeSettingsValueAt, applyThemeSettingsDraftToConfig } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
import { createSettingsPanelMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/panels.js';

const storeFor = (config = {}) => ({
  ...createSettingsPanelMethods({}), draft: buildThemeSettingsDraft(config),
  value(path, fallback) { return themeSettingsValueAt(this.draft, path, fallback); },
  update(path, value) { this.draft = updateThemeSettingsDraft(this.draft, path, value); }
});

test('首页运营配置按字符串商品 ID 保存顺序，清空模块时保留其他配置', () => {
  const original = { shop: { home: { future: 'keep' }, display: { show_description: false } } };
  const values = {
    'shop.home.hero_product': '210', 'shop.home.hero_image': '/upload/banner.webp',
    'shop.home.hero_title': '本周主推', 'shop.home.hero_description': '工具与灵感',
    'shop.home.featured_products': ['42', '8'], 'shop.home.compact_products': ['1199', '210'],
    'shop.home.preview_products': ['8', '42']
  };
  let draft = buildThemeSettingsDraft(original);
  for (const [path, value] of Object.entries(values)) draft = updateThemeSettingsDraft(draft, path, value);
  const saved = applyThemeSettingsDraftToConfig(original, draft, Object.keys(values));
  const reloaded = buildThemeSettingsDraft(saved);
  for (const [path, value] of Object.entries(values)) assert.deepEqual(themeSettingsValueAt(reloaded, path), value);
  assert.equal(saved.shop.home.future, 'keep');
  assert.equal(saved.shop.display.show_description, false);
  assert.equal(SETTINGS_FIELDS.find(({ path }) => path === 'shop.home.hero_product').source, 'shopProducts');
  assert.throws(() => updateThemeSettingsDraft(draft, 'shop.home.hero_image', 'javascript:alert(1)'));
  draft = updateThemeSettingsDraft(draft, 'shop.home.hero_product', '');
  draft = updateThemeSettingsDraft(draft, 'shop.home.featured_products', []);
  assert.equal(draft.shop.home.hero_product, '');
  assert.deepEqual(draft.shop.home.featured_products, []);
});

test('商品选择保留跨页已选 ID，缺失商品可清除且不能新选不可用商品', () => {
  const store = storeFor({ shop: { home: { hero_product: 'missing', featured_products: ['42'] } } });
  store.resources.shopProducts = { items: [{ name: '210', label: '第二页商品', disabled: false }, { name: '8', label: '未发布', disabled: true }] };
  assert.deepEqual(store.resourceOptions('shopProducts').map(({ name }) => name), ['210', '8', 'missing', '42']);
  store.selectResource('shop.home.hero_product', '8');
  assert.equal(store.value('shop.home.hero_product'), 'missing');
  store.selectResource('shop.home.hero_product', '210');
  assert.equal(store.value('shop.home.hero_product'), '210');
  store.selectResource('shop.home.hero_product', '');
  assert.equal(store.value('shop.home.hero_product'), '');
  store.toggleResource('shop.home.featured_products', '42');
  assert.deepEqual(store.value('shop.home.featured_products'), []);
});

test('推荐双卡最多两项，选中商品行可调整顺序且不会丢失跨页选项', () => {
  const store = storeFor({ shop: { home: { featured_products: ['42', '8'], compact_products: ['1199', '210', '42'] } } });
  store.resources.shopProducts = { items: [{ name: '210', label: '新商品', disabled: false }] };
  store.toggleResource('shop.home.featured_products', '210');
  assert.deepEqual(store.value('shop.home.featured_products'), ['42', '8']);
  store.moveResource('shop.home.compact_products', '42', -1);
  assert.deepEqual(store.value('shop.home.compact_products'), ['1199', '42', '210']);
  store.moveResource('shop.home.compact_products', '1199', -1);
  store.moveResource('shop.home.compact_products', 'absent', 1);
  assert.deepEqual(store.value('shop.home.compact_products'), ['1199', '42', '210']);
});

test('商品资源翻页合并保留首批与已选 ID，筛选不会改变单选候选', async () => {
  const store = storeFor({ shop: { home: { hero_product: '51' } } });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (href) => {
      const page = Number(new URL(href, 'https://site.test').searchParams.get('page'));
      const content = page === 1
        ? Array.from({ length: 50 }, (_, index) => ({ id: index + 1, title: `商品 ${index + 1}`, status: 'PUBLISHED' }))
        : [{ id: 51, title: '跨页主推', status: 'PUBLISHED' }];
      return new Response(JSON.stringify({ content, number: page - 1, size: 50, totalElements: 51 }), { headers: { 'Content-Type': 'application/json' } });
    };
    await store.loadResources('shopProducts');
    assert.equal(store.resourceState('shopProducts').hasNext, true);
    assert.equal(store.resourceOptions('shopProducts').find(({ name }) => name === '51').disabled, true);
    await store.loadResources('shopProducts', true);
    assert.equal(store.resourceState('shopProducts').hasNext, false);
    assert.equal(store.resourceState('shopProducts').items.length, 51);
    assert.equal(store.resourceOptions('shopProducts').find(({ name }) => name === '51').disabled, false);
    store.searchResources('shopProducts', '商品 1');
    assert.equal(store.resourceOptions('shopProducts').some(({ name }) => name === '51'), false);
    assert.equal(store.resourceOptions('shopProducts', false).some(({ name }) => name === '51'), true);
    assert.equal(store.value('shop.home.hero_product'), '51');
  } finally { globalThis.fetch = originalFetch; }
});
