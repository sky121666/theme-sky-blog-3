import assert from 'node:assert/strict';
import test from 'node:test';
import { registerThemeSettings } from '../src/shell/desktop-shell/runtime/desktop/theme-settings.js';
import { buildThemeSettingsDraft } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
import { createSettingsPanelMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/panels.js';

function fixture(config = {}) {
  const stores = new Map();
  registerThemeSettings({ store(name, value) { if (value) stores.set(name, value); return stores.get(name); } });
  const store = stores.get('themeSettings');
  store.baseline = buildThemeSettingsDraft(config);
  store.draft = structuredClone(store.baseline);
  store.applyRuntimePreview = () => {};
  store.resetCloseArm = () => {};
  globalThis.window = { requestAnimationFrame() {}, clearTimeout() {} };
  return store;
}

test('清除未使用的墙纸引用保留纯色背景与其他字段', () => {
  const s = fixture({ desktop: { background: { mode: 'solid', solid_color: '#123456', image_url: '/old.png' } } });
  s.setImage('desktop.background.image_url', '');
  assert.equal(s.value('desktop.background.mode'), 'solid');
  assert.equal(s.value('desktop.background.solid_color'), '#123456');
  assert.deepEqual(s.dirtyPaths, ['desktop.background.image_url']);
});

test('应用瞬间封面只修改瞬间封面，不能改变桌面背景', () => {
  const s = fixture();
  s.setImage('moments.cover.image_url', '/moment.png');
  assert.equal(s.value('moments.cover.image_url'), '/moment.png');
  assert.deepEqual(s.dirtyPaths, ['moments.cover.image_url']);
});

test('明确使用墙纸同时更新图片引用与模式，保留内置选择', () => {
  const s = fixture({ desktop: { background: { mode: 'preset', preset: 'deep-sea' } } });
  s.setImage('desktop.background.image_url', '/wallpaper.png');
  assert.equal(s.value('desktop.background.mode'), 'image');
  assert.equal(s.value('desktop.background.preset'), 'deep-sea');
  assert.deepEqual(s.dirtyPaths.sort(), ['desktop.background.image_url', 'desktop.background.mode']);
});

test('无图片时切到图片模式不会打开选择器或写入无效草稿', () => {
  const s = fixture();
  s.setBackgroundMode('image');
  assert.equal(s.value('desktop.background.mode'), 'preset');
  assert.deepEqual(s.dirtyPaths, []);
});

test('搜索依据真实字段定位应用设置', () => {
  const s = fixture();
  assert.equal(typeof s.searchResults, 'function');
  s.query = 'Steam';
  assert.ok(s.searchResults().some((item) => item.path === 'steam.cover.image_url' && item.pane === 'apps'));
});

test('自定义图标字段编辑保留稳定名称和未知元数据', () => {
  const s = fixture({ desktop: { icons: { custom_icons: [{ name: 'stable', href: '/old', type: 'folder', external: false, future: 42 }] } } });
  assert.equal(typeof s.updateCustomIcon, 'function');
  s.updateCustomIcon(0, 'href', '/new');
  assert.equal(s.value('desktop.icons.custom_icons')[0].name, 'stable');
  assert.equal(s.value('desktop.icons.custom_icons')[0].future, 42);
  assert.deepEqual(s.dirtyPaths, ['desktop.icons.custom_icons']);
});

test('旧对象形式的资源选择按身份匹配，取消不会留下重复项', () => {
  const s = fixture({ desktop: { icons: { categories: [{ name: 'cat', future: 42 }] } } });
  assert.equal(s.resourceSelected('desktop.icons.categories', 'cat'), true);
  assert.equal(s.resourceOptions('categories')[0].name, 'cat');
  s.toggleResource('desktop.icons.categories', 'cat');
  assert.deepEqual(s.value('desktop.icons.categories'), []);
});

test('新图标不能改成已存在的名称，失败后仍能继续编辑', () => {
  const s = fixture({ desktop: { icons: { custom_icons: [{ name: 'stable', href: '/' }] } } });
  s.addCustomIcon();
  s.updateCustomIcon(1, 'name', 'stable');
  assert.notEqual(s.value('desktop.icons.custom_icons')[1].name, 'stable');
  assert.equal(s.customIconNameLocked(1), false);
  assert.ok(s.validationError('desktop.icons.custom_icons'));
  s.updateCustomIcon(1, 'name', 'unique');
  assert.equal(s.validationError('desktop.icons.custom_icons'), '');
});

test('布局编辑器异步加载期间的新设置草稿不能被强制关闭丢弃', async () => {
  let resolve;
  const desktop = { isEditing: false, hasUnsavedDesktopChanges: () => false,
    openWidgetEditorFromDesktopMenu: () => new Promise((done) => { resolve = () => { desktop.isEditing = true; done(); }; }),
    exitEditMode: async () => { desktop.isEditing = false; } };
  const previous = globalThis.document;
  globalThis.document = { querySelector: () => ({}) };
  try {
    let dirty = false;
    let closed = false;
    const s = { ...createSettingsPanelMethods({ $data: () => desktop }), hasDirtyChanges: () => dirty, close: () => { closed = true; } };
    const opening = s.openLayoutEditor();
    dirty = true;
    resolve();
    await opening;
    assert.equal(closed, false);
    assert.equal(desktop.isEditing, false);
    assert.equal(s.statusTone, 'warning');
  } finally { globalThis.document = previous; }
});
test('文字即时编辑保留空格，未完成的颜色输入也进入关闭保护', () => {
  const s = fixture();
  s.update('header.logo.title', 'New ');
  assert.equal(s.value('header.logo.title'), 'New ');
  s.dirtyPaths = [];
  s.updateCssColor('header.dropdown.light_bg', 'rgba(');
  assert.equal(s.hasDirtyChanges(), true);
});

test('桌面图标应用后必须刷新再进入布局编辑器', async () => {
  const s = fixture();
  s.desktopLayoutReloadRequired = true;
  assert.equal(await s.openLayoutEditor(), false);
  assert.match(s.statusMessage, /刷新/);
});
