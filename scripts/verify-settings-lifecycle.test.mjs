import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
import { mergeSettingsChanges } from '../src/shell/desktop-shell/runtime/desktop/settings-model/save.js';
import { createSettingsColorMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/color-controls.js';
import { createStartupSettingsMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/startup.js';

function fixture() {
  const timers = new Map();
  const classes = new Set(['theme-settings-open']);
  let timerId = 0;
  let restored = 0;
  let scrollCanceled = 0;
  const focus = { isConnected: true, focus() { this.calls = (this.calls || 0) + 1; } };
  const source = fs.readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/theme-settings.js', import.meta.url), 'utf8');
  const context = vm.createContext({ ...core, createSettingsColorMethods, createStartupSettingsMethods, captureRuntimeSnapshot: () => ({}), registerThemeSettingsAssetPicker() {}, createSettingsPanelMethods: () => ({ paneScroll: {}, resources: {}, paneScrollKey() { return this.activePane; } }),
    loadSettingsSave: async () => ({ mergeSettingsChanges }),
    loadThemeConfigClient: async () => ({ mutateThemeConfig: async (_endpoint, merge) => ({ config: merge({ header: { logo: { title: '远端' } } }) }) }),
    HTMLElement: class {}, document: { activeElement: null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x) } } },
    window: { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (fn) => fn(), removeEventListener() {} } });
  const stores = new Map();
  const register = vm.runInContext(source.slice(source.indexOf('const SETTINGS_CLOSE_DELAY')).replace('export function registerThemeSettings', 'function registerThemeSettings') + '\nregisterThemeSettings;', context);
  register({ store(name, value) { if (value) stores.set(name, value); return stores.get(name); } });
  const s = stores.get('themeSettings');
  Object.assign(s, { authenticated: true, accessStatus: 'allowed', canOpen: true, visible: true, open: true, restoreFocusElement: focus,
    restoreRuntimePreview() { restored++; }, cancelResourceRequests() {}, cancelDesktopViewportRestore() { scrollCanceled++; }, switchPane() {} });
  s.baseline = core.buildThemeSettingsDraft({ header: { logo: { title: '原值' } } });
  s.draft = core.updateThemeSettingsDraft(s.baseline, 'header.logo.title', '草稿');
  s.dirtyPaths = ['header.logo.title'];
  return { s, timers, classes, focus, restored: () => restored, scrollCanceled: () => scrollCanceled, flush() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}

test('确认关闭期间立即重开撤销旧关闭，放弃已确认草稿并重新显示', async () => {
  const f = fixture();
  f.s.close();
  assert.equal(f.s.open, true);
  assert.match(f.s.statusMessage, /再次点击关闭将放弃/);
  f.s.close();
  assert.equal(f.s.open, false);
  assert.equal(f.restored(), 1);
  assert.equal(await f.s.requestOpen(), true);
  assert.equal(f.s.open, true);
  assert.equal(f.scrollCanceled(), 0);
  f.flush();
  assert.equal(f.s.visible, true);
  assert.equal(f.classes.has('theme-settings-open'), true);
  assert.equal(f.s.draft.header.logo.title, '原值');
  assert.equal(f.s.dirtyPaths.length, 0);
  assert.equal(f.focus.calls || 0, 0);
});

test('destroy 清理关闭任务，旧回调不能再清空草稿或恢复焦点', () => {
  const f = fixture();
  f.s.close(true);
  f.s.destroy();
  assert.equal([...f.timers.values()].filter((t) => t.delay === 240).length, 0);
  f.flush();
  assert.equal(f.s.draft.header.logo.title, '草稿');
  assert.equal(f.focus.calls || 0, 0);
});

test('保存冲突保留当前草稿和基线，提示在当前窗口核对且说明关闭会放弃', async () => {
  const f = fixture();
  const draft = f.s.draft;
  const baseline = f.s.baseline;
  assert.equal(await f.s.save(), false);
  assert.equal(f.s.draft, draft);
  assert.equal(f.s.baseline, baseline);
  assert.deepEqual(Array.from(f.s.dirtyPaths), ['header.logo.title']);
  assert.equal(f.s.saving, false);
  assert.match(f.s.statusMessage, /当前窗口/);
  assert.match(f.s.statusMessage, /关闭.*放弃/);
  f.s.close();
  assert.equal(f.s.open, true);
  f.s.close();
  f.flush();
  assert.equal(f.s.visible, false);
  assert.equal(f.s.draft.header.logo.title, '原值');
  assert.equal(f.s.dirtyPaths.length, 0);
});

// Reuse the preview verifier's DOM harness so capture/restore execute production code.
const previewVerifier = fs.readFileSync(new URL('./verify-settings-preview.mjs', import.meta.url), 'utf8');
const harnessSource = previewVerifier.slice(previewVerifier.indexOf('const root'), previewVerifier.indexOf("test('editing"))
  .replace(/const core = await import\([\s\S]*?\)\.href\);/, '')
  .replace('const window = {', 'const window = { removeEventListener() {},')
  .replace('  const timers = new Map();', '  let navigationGuard; const timers = new Map();')
  .replace('registerNavigationGuard: () => () => {},', 'registerNavigationGuard: (guard) => { navigationGuard = guard; return () => {}; },')
  .replace('store, body, dock, gridShell,', 'guard: () => navigationGuard, store, body, dock, gridShell,');
const { default: path } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const createRealPreviewHarness = vm.runInNewContext(harnessSource + '\ncreateHarness;', {
  fs, path, pathToFileURL, core, assert, vm, process, queueMicrotask, mergeSettingsChanges
});

test('真实预览在关闭中重开后仍还原 Dock 和桌面滚动', async () => {
  const f = createRealPreviewHarness();
  const s = f.store;
  s.authenticated = true;
  await f.open();
  const originalDock = f.dock.dataset.dockIconSize;
  s.update('dock.appearance.icon_size', 60);
  f.gridShell.scrollTop = 900;
  s.close(true);
  await s.requestOpen();
  s.update('dock.appearance.icon_size', 64);
  f.gridShell.scrollTop = 800;
  s.close(true);
  await new Promise(queueMicrotask);
  await new Promise(queueMicrotask);
  assert.equal(f.dock.dataset.dockIconSize, originalDock);
  assert.equal(f.gridShell.scrollTop, 210);
});

for (const action of ['close', 'closeForNavigationCommit', 'destroy']) {
  test(`打开动画等待期间 ${action} 使旧打开续执行失效`, async () => {
    const f = createRealPreviewHarness();
    const opening = f.store.openWindow();
    f.store[action](true);
    await opening;
    assert.equal(f.store.open, false);
    assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 0);
  });
  test(`打开后 ${action} 清理焦点延迟任务`, async () => {
    const f = createRealPreviewHarness();
    await f.open();
    f.store[action](true);
    assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 0);
  });
}

test('旧打开尚未结束时关闭再重开只保留新一代打开任务', async () => {
  const f = createRealPreviewHarness();
  f.store.authenticated = true;
  const oldOpening = f.store.openWindow();
  f.store.close(true);
  const reopening = f.store.requestOpen();
  await Promise.all([oldOpening, reopening]);
  assert.equal(f.store.visible, true);
  assert.equal(f.store.open, true);
  assert.ok(f.store.runtimeSnapshot);
  assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 1);
  assert.equal([...f.timers.values()].filter((t) => t.delay === 240).length, 0);
});

function pendingAccessFixture() {
  const f = createRealPreviewHarness();
  f.store.authenticated = true;
  let release;
  let reads = 0;
  f.store.fetchConfig = () => {
    reads++;
    return new Promise((resolve) => { release = () => resolve({}); });
  };
  return { ...f, release: () => release(), reads: () => reads };
}

for (const action of ['destroy', 'closeForNavigationCommit', 'close']) {
  test(`权限探测等待期间 ${action} 取消打开请求`, async () => {
    const f = pendingAccessFixture();
    const opening = f.store.requestOpen();
    f.store[action]();
    f.release();
    assert.equal(await opening, false);
    assert.equal(f.store.visible, false);
    assert.equal(f.store.open, false);
    assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 0);
  });
}

test('并发打开请求只探测一次且不取消首个请求', async () => {
  const f = pendingAccessFixture();
  const first = f.store.requestOpen();
  assert.equal(await f.store.requestOpen(), false);
  assert.equal(f.reads(), 1);
  f.release();
  assert.equal(await first, true);
  assert.equal(f.store.visible, true);
  assert.equal(f.store.open, true);
  assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 1);
});

test('已取消权限探测完成后可重新探测并正常打开', async () => {
  const f = pendingAccessFixture();
  const oldOpening = f.store.requestOpen();
  f.store.closeForNavigationCommit();
  f.release();
  assert.equal(await oldOpening, false);
  const reopening = f.store.requestOpen();
  f.release();
  assert.equal(await reopening, true);
  assert.equal(f.reads(), 2);
  assert.equal(f.store.open, true);
});


test('导航守卫提交即使窗口尚未可见也取消等待中的访问探测', async () => {
  const f = pendingAccessFixture();
  f.store.installNavigationGuard();
  const opening = f.store.requestOpen();
  const snapshot = f.guard().capture();
  assert.equal(snapshot.visible, false);
  f.guard().commit(snapshot);
  f.release();
  assert.equal(await opening, false);
  assert.equal(f.store.visible, false);
  assert.equal([...f.timers.values()].filter((t) => t.delay === 40).length, 0);
});
