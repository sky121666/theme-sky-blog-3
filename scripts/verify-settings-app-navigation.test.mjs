import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsPanelMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/panels.js';

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
    assert.equal(store.searchResults().filter((field) => field.pane === 'apps').length, 16);
  } finally { cleanup(); }
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
