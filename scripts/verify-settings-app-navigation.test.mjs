import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsPanelMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/panels.js';
import { buildThemeSettingsDraft, updateThemeSettingsDraft, themeSettingsValueAt } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';

function setup() {
  const content = { scrollTop: 0, scrollTo({ top }) { this.scrollTop = top; } };
  const focused = { count: 0, focus() { this.count++; } };
  const row = { tagName: 'LABEL', parentElement: null, classList: { add() {} }, scrollIntoView() {}, querySelector: () => focused };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { querySelector: (selector) => selector === '[data-theme-settings-content]' ? content : selector.includes('data-setting-path') ? row : null, querySelectorAll: () => [] };
  globalThis.window = { requestAnimationFrame(callback) { callback(); } };
  const store = { ...createSettingsPanelMethods({ nextTick(callback) { callback(); } }), activePane: 'apps', activeApp: null, mobileSidebarOpen: false, isMobileViewport: false, query: '', dirtyPaths: [], loadResources() {}, resourceState() { return { loaded: true }; }, syncRadioGroupTabStops() {} };
  return { store, content, focused, cleanup() { globalThis.document = previousDocument; globalThis.window = previousWindow; } };
}

test('应用详情返回列表并再次进入时保留各自滚动和草稿', () => {
  const { store, content, cleanup } = setup();
  try {
    store.draft = { moments: { name: 'draft' } };
    content.scrollTop = 30;
    store.openApp('moments');
    assert.equal(store.activeApp, 'moments');
    content.scrollTop = 140;
    store.backPane();
    assert.equal(store.activeApp, null);
    assert.equal(content.scrollTop, 30);
    store.openApp('douban');
    content.scrollTop = 80;
    store.switchPane('widgets');
    store.switchPane('apps');
    assert.equal(store.activeApp, null);
    store.openApp('moments');
    assert.equal(content.scrollTop, 140);
    assert.equal(store.draft.moments.name, 'draft');
  } finally { cleanup(); }
});

test('应用字段搜索先进入详情再定位可聚焦行', () => {
  const { store, focused, cleanup } = setup();
  try {
    store.switchPane('appearance');
    store.query = 'Steam';
    store.focusSetting('steam.cover.image_url');
    assert.equal(store.activePane, 'apps');
    assert.equal(store.activeApp, 'steam');
    assert.equal(store.query, '');
    assert.equal(focused.count, 1);
    store.backPane();
    assert.equal(store.activePane, 'appearance');
  } finally { cleanup(); }
});

test('应用入口校验且 paneLabel 显示当前详情', () => {
  const { store, cleanup } = setup();
  try {
    store.openApp('missing');
    assert.equal(store.activeApp, null);
    store.openApp('links');
    assert.equal(store.paneLabel(), '友链');
    assert.equal(store.paneLabel('apps'), '应用');
  } finally { cleanup(); }
});

test('商店入口与商城搜索都进入商店详情并定位对应设置', () => {
  const { store, focused, cleanup } = setup();
  try {
    store.openApp('shop');
    assert.equal(store.activePane, 'apps');
    assert.equal(store.activeApp, 'shop');
    assert.equal(store.paneLabel(), '商店');
    for (const query of ['商店', '商城']) {
      store.query = query;
      const results = store.searchResults();
      assert.deepEqual(results.map((field) => field.path), ['shop.display.show_description', 'shop.display.dock_entry_enabled', 'shop.navigation.sidebar_categories', 'shop.navigation.category_appearances', 'shop.home.hero_product', 'shop.home.hero_image', 'shop.home.hero_title', 'shop.home.hero_description', 'shop.home.featured_products', 'shop.home.compact_products', 'shop.home.preview_products']);
      assert.ok(results.every((field) => field.app === 'shop' && field.paneLabel === '商店'));
    }
    store.switchPane('appearance');
    store.focusSetting('shop.display.show_description');
    assert.equal(store.activeApp, 'shop');
    assert.equal(store.query, '');
    assert.equal(focused.count, 1);
  } finally { cleanup(); }
});

test('菜单资源在菜单栏和 Dock 加载，桌面内容资源在小组件加载', () => {
  const { store, cleanup } = setup();
  try {
    const loaded = [];
    store.loadResources = (kind) => loaded.push(kind);
    store.resourceState = () => ({ loaded: false });
    store.switchPane('navigation');
    assert.deepEqual(loaded, ['menus']);
    loaded.length = 0;
    store.switchPane('desktop-dock');
    assert.deepEqual(loaded, ['menus']);
    loaded.length = 0;
    store.switchPane('widgets');
    assert.deepEqual(loaded.sort(), ['categories', 'posts', 'singlepages', 'tags']);
  } finally { cleanup(); }
});

test('应用搜索仅匹配本应用别名和字段，应用泛搜覆盖全部', () => {
  const { store, cleanup } = setup();
  try {
    store.query = 'Steam';
    assert.deepEqual(store.searchResults().map((field) => field.path), ['steam.cover.image_url']);
    store.query = '书影音';
    assert.equal(store.searchResults().length, 4);
    assert.ok(store.searchResults().every((field) => field.app === 'douban'));
    store.query = '视频';
    assert.deepEqual(store.searchResults().map((field) => field.path), ['moments.publish.video_upload']);
    store.query = '应用';
    assert.equal(store.searchResults().filter((field) => field.pane === 'apps').length, 27);
  } finally { cleanup(); }
});

test('仅进入商店详情时加载商城分类，已加载分类复用', () => {
  const { store, cleanup } = setup();
  try {
    const loaded = [];
    store.loadResources = (kind) => loaded.push(kind);
    store.resourceState = () => ({ loaded: false });
    store.openApp('moments');
    assert.deepEqual(loaded, []);
    store.openApp('shop');
    assert.deepEqual(loaded, ['shopCategories']);
    store.resourceState = () => ({ loaded: true });
    store.switchPane('apps');
    store.openApp('shop');
    assert.deepEqual(loaded, ['shopCategories']);
  } finally { cleanup(); }
});

test('商店分类勾选写入 ID 数组，不可用旧项仍可取消', () => {
  const store = {
    ...createSettingsPanelMethods({}),
    draft: buildThemeSettingsDraft({ shop: { navigation: { sidebar_categories: ['missing'] } } }),
    value(path, fallback) { return themeSettingsValueAt(this.draft, path, fallback); },
    update(path, value) { this.draft = updateThemeSettingsDraft(this.draft, path, value); }
  };
  store.resources.shopCategories = { items: [{ name: '12', label: '设计', disabled: false }, { name: '24', label: '已停用', disabled: true }] };
  assert.deepEqual(store.resourceOptions('shopCategories'), [
    { name: '12', label: '设计', disabled: false },
    { name: '24', label: '已停用', disabled: true },
    { name: 'missing', label: 'missing（未加载或已不可用）', disabled: true }
  ]);
  store.toggleResource('shop.navigation.sidebar_categories', '12');
  store.toggleResource('shop.navigation.sidebar_categories', '24');
  assert.deepEqual(store.value('shop.navigation.sidebar_categories'), ['missing', '12']);
  assert.equal(store.resourceSelected('shop.navigation.sidebar_categories', '12'), true);
  store.toggleResource('shop.navigation.sidebar_categories', 'missing');
  store.toggleResource('shop.navigation.sidebar_categories', '12');
  assert.deepEqual(store.value('shop.navigation.sidebar_categories'), []);
});

test('切换详情取消开窗延迟焦点，避免覆盖搜索字段焦点', () => {
  const { store, cleanup } = setup();
  try {
    let canceled = null;
    globalThis.window.clearTimeout = (id) => { canceled = id; };
    store.focusTimer = 17;
    store.openApp('moments');
    assert.equal(canceled, 17);
    assert.equal(store.focusTimer, null);
  } finally { cleanup(); }
});
