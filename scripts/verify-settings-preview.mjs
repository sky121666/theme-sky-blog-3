import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { mergeSettingsChanges } from '../src/shell/desktop-shell/runtime/desktop/settings-model/save.js';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const core = await import(pathToFileURL(path.join(
  root, 'src/shell/desktop-shell/runtime/desktop/theme-settings-core.js'
)).href);
const source = fs.readFileSync(path.join(
  root, 'src/shell/desktop-shell/runtime/desktop/theme-settings.js'
), 'utf8');
const moduleStart = source.indexOf('const SETTINGS_CLOSE_DELAY');
assert.ok(moduleStart > 0, 'Settings runtime module body missing');
const supportingSource = ['color-controls', 'preview', 'panels'].map((name) => fs.readFileSync(path.join(root, `src/shell/desktop-shell/runtime/desktop/settings-model/${name}.js`), 'utf8').replace(/^import .*?;\n/gm, '').replace(/export function /g, 'function ')).join('\n');
const runtimeSource = (supportingSource + '\n' + source.slice(moduleStart))
  .replace('export function registerThemeSettings(Alpine)', 'function registerThemeSettings(Alpine)')
  .concat('\nregisterThemeSettings;');

function createStyle() {
  const properties = new Map();
  return {
    background: '', backgroundColor: '', backgroundImage: '',
    backgroundPosition: '', backgroundSize: '', backgroundRepeat: '',
    setProperty(name, value) { properties.set(name, String(value)); },
    getPropertyValue(name) { return properties.get(name) || ''; },
    removeProperty(name) { properties.delete(name); }
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    [Symbol.iterator]() { return values[Symbol.iterator](); }
  };
}

function createHarness(config = {}) {
  const timers = new Map();
  const images = [];
  const events = [];
  const dockEvents = [];
  const animationFrames = new Map();
  let nextAnimationFrame = 0;
  const stored = new Map([['theme', 'dark']]);
  let nextTimer = 0;
  let mutationGate = Promise.resolve();
  let latestConfig = config;

  class FixtureImage {
    constructor() { images.push(this); }
    set src(value) { this.url = value; }
    get src() { return this.url; }
    load() { this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  class FixtureElement {}
  class FixtureCustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const body = { classList: createClassList(), style: createStyle() };
  const dock = {
    dataset: {}, style: createStyle(),
    querySelectorAll() { return []; },
    dispatchEvent(event) { dockEvents.push(event); }
  };
  const menubar = { dataset: { siteTitle: 'Fixture Site', siteFallbackTitle: 'Fixture Site' } };
  const gridShell = { isConnected: true, scrollTop: 210, scrollLeft: 12 };
  const document = {
    body,
    activeElement: new FixtureElement(),
    querySelector(selector) {
      if (selector === '.dock-container') return dock;
      if (selector === '.menubar') return menubar;
      if (selector === '.desktop-surface .desktop-widgets-grid-shell') return gridShell;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const window = {
    requestAnimationFrame(callback) {
      const id = ++nextAnimationFrame;
      animationFrames.set(id, callback);
      queueMicrotask(() => {
        if (!animationFrames.has(id)) return;
        animationFrames.delete(id);
        callback();
      });
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    dispatchEvent(event) { events.push(event); }
  };
  const localStorage = {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, String(value)); },
    removeItem(key) { stored.delete(key); }
  };
  const themeStore = {
    setMode(mode) { stored.set('theme', mode); },
    refresh() {}
  };
  const stores = new Map([['theme', themeStore]]);
  const Alpine = {
    store(name, value) {
      if (arguments.length > 1) stores.set(name, value);
      return stores.get(name);
    }
  };
  const registerThemeSettings = vm.runInNewContext(runtimeSource, {
    ...core, loadSettingsSave: async () => ({ mergeSettingsChanges }),
    document, window, localStorage,
    Image: FixtureImage,
    HTMLElement: FixtureElement,
    CustomEvent: FixtureCustomEvent,
    loadThemeConfigClient: async () => ({
      mutateThemeConfig: async (endpoint, mutate) => {
        assert.equal(endpoint, '/fixture');
        await mutationGate;
        latestConfig = mutate(latestConfig);
        return { config: latestConfig };
      }
    }),
    registerNavigationGuard: () => () => {},
    registerThemeSettingsAssetPicker: () => {},
    sanitizeIconSvg: () => '',
    isCoveredNativeBeforeUnload: () => false
  }, { filename: 'theme-settings.js' });
  registerThemeSettings(Alpine);
  const store = Alpine.store('themeSettings');
  store.endpoint = '/fixture';
  store.themeName = 'fixture';
  store.canOpen = true;
  store.baseline = core.buildThemeSettingsDraft(config);
  store.draft = core.cloneThemeSettingsValue(store.baseline);

  return {
    store, body, dock, gridShell, images, events, dockEvents, stored, timers,
    async open() { await store.openWindow(); },
    timer(delay) {
      const entry = [...timers.values()].find((item) => item.delay === delay);
      assert.ok(entry, `Missing ${delay} ms timer`);
      return entry.callback;
    },
    fire(delay) {
      const [id, entry] = [...timers.entries()].find(([, item]) => item.delay === delay) || [];
      assert.ok(entry, `Missing ${delay} ms timer`);
      timers.delete(id);
      entry.callback();
    },
    holdMutation() {
      let release;
      mutationGate = new Promise((resolve) => { release = resolve; });
      return release;
    }
  };
}

test('editing and restoring cancel an armed close callback', async () => {
  const fixture = createHarness();
  const { store } = fixture;
  await fixture.open();
  store.update('dock.appearance.icon_size', 60);
  store.close();
  const staleAfterEdit = fixture.timer(3200);
  store.update('dock.appearance.icon_size', 64);
  staleAfterEdit();
  assert.equal(store.statusMessage, '设置已修改，尚未应用。');

  store.close();
  const staleAfterRestore = fixture.timer(3200);
  store.restoreDraft();
  staleAfterRestore();
  assert.equal(store.statusTone, 'success');
  assert.equal(store.statusMessage, '已撤销本次未应用的修改。');
});

test('saving or closing cancels an armed close callback', async () => {
  const fixture = createHarness();
  const { store } = fixture;
  await fixture.open();
  store.update('dock.appearance.icon_size', 60);
  store.close();
  const staleAfterSave = fixture.timer(3200);
  assert.equal(await store.save(), true);
  staleAfterSave();
  assert.equal(store.statusTone, 'success');
  assert.match(store.statusMessage, /主题设置已保存/);

  store.update('dock.appearance.icon_size', 62);
  store.close();
  const staleAfterClose = fixture.timer(3200);
  store.close();
  fixture.fire(240);
  const messageAfterClose = store.statusMessage;
  staleAfterClose();
  assert.equal(store.statusMessage, messageAfterClose);
  assert.equal(store.visible, false);
});

test('slow saved wallpaper has a stable restore snapshot and keeps a newer draft', async () => {
  const url = 'https://example.test/saved-wallpaper.webp';
  const fixture = createHarness({ desktop: { background: { mode: 'preset', image_url: url } } });
  const { store, body } = fixture;
  await fixture.open();
  store.update('desktop.background.mode', 'image');
  assert.equal(body.style.backgroundColor, '#0f172a', 'pending image needs a usable fallback');
  const release = fixture.holdMutation();
  const saving = store.save();
  await Promise.resolve();
  store.update('dock.appearance.icon_size', 64);
  release();
  assert.equal(await saving, true);
  assert.match(store.runtimeSnapshot.body.background, /saved-wallpaper\.webp/);
  assert.equal(store.draft.dock.appearance.icon_size, 64);
  assert.ok(store.dirtyPaths.includes('dock.appearance.icon_size'));
  assert.equal(fixture.stored.get('theme'), 'dark', 'save should preserve user theme preference');

  store.close(true);
  fixture.fire(240);
  assert.match(body.style.background, /saved-wallpaper\.webp/, 'cancel should restore saved wallpaper');
  for (const image of fixture.images) image.load();
  assert.match(body.style.background, /saved-wallpaper\.webp/, 'late callbacks must not alter closed settings');
  assert.equal(store.readyWallpaperUrl, '', 'late callbacks must not mark a closed preview ready');
});

test('stale wallpaper URL and failed loading cannot replace the current preview', async () => {
  const fixture = createHarness();
  const { store, body } = fixture;
  await fixture.open();
  store.draft.desktop.background.mode = 'image';
  store.draft.desktop.background.image_url = 'https://example.test/old.webp';
  store.applyRuntimePreview('desktop.background.image_url');
  const oldImage = fixture.images.at(-1);
  store.draft.desktop.background.image_url = 'https://example.test/new.webp';
  oldImage.load();
  assert.equal(store.readyWallpaperUrl, '');
  assert.doesNotMatch(body.style.background, /new\.webp/, 'new URL must wait for its own load');

  store.applyRuntimePreview('desktop.background.image_url');
  fixture.images.at(-1).fail();
  assert.equal(body.style.backgroundColor, '#0f172a');
  assert.equal(store.statusTone, 'error');
  store.close(true);
  fixture.fire(240);
  assert.equal(body.style.background, '');
});

test('Dock preview does not broadcast widget or menubar changes', async () => {
  const fixture = createHarness();
  const { store } = fixture;
  await fixture.open();
  store.update('dock.appearance.icon_size', 60);
  assert.equal(fixture.dockEvents.length, 1);
  assert.equal(fixture.events.filter((event) => event.type === 'theme:widget-settings-change').length, 0);
  assert.equal(fixture.events.filter((event) => event.type === 'theme:menubar-settings-change').length, 0);

  store.update('widgets.modules.weather.city_name', '上海');
  assert.equal(fixture.dockEvents.length, 1, 'weather edit must not resync Dock');
  assert.equal(fixture.events.filter((event) => event.type === 'theme:widget-settings-change').length, 1);
  store.applyRuntimePreview();
  assert.equal(fixture.dockEvents.length, 2, 'empty path should refresh all groups');
  assert.equal(fixture.events.filter((event) => event.type === 'theme:menubar-settings-change').length, 1);
  store.close(true);
  fixture.fire(240);
  assert.equal(fixture.dockEvents.length, 3, 'cancel should restore Dock completely');
  assert.equal(fixture.events.filter((event) => event.type === 'theme:widget-settings-change').length, 3,
    'full preview and cancel should both update widgets');
});

test('cancel restores the desktop scroll context captured before Dock preview', async () => {
  const { store, gridShell } = createHarness();
  await store.openWindow();
  store.update('dock.appearance.icon_size', 64);
  gridShell.scrollTop = 20;
  gridShell.scrollLeft = 0;
  store.restoreDraft();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gridShell.scrollTop, 210);
  assert.equal(gridShell.scrollLeft, 12);
  assert.equal(store.hasDirtyChanges(), false);
});

test('菜单背景预览计算前景色，取消后同时恢复背景和前景变量', async () => {
  const fixture = createHarness({ header: { dropdown: { light_bg: 'rgba(20, 30, 40, 0.8)' } } });
  const { store, body } = fixture;
  body.style.setProperty('--mac-header-dropdown-light-bg', 'rgba(20, 30, 40, 0.8)');
  body.style.setProperty('--mac-header-dropdown-light-fg', '#FFFFFF');
  await fixture.open();
  store.update('header.dropdown.light_bg', '#ffffff');
  assert.equal(body.style.getPropertyValue('--mac-header-dropdown-light-bg'), '#FFFFFF');
  assert.equal(body.style.getPropertyValue('--mac-header-dropdown-light-fg'), '#17212F');
  store.close(true);
  fixture.fire(240);
  assert.equal(body.style.getPropertyValue('--mac-header-dropdown-light-bg'), 'rgba(20, 30, 40, 0.8)');
  assert.equal(body.style.getPropertyValue('--mac-header-dropdown-light-fg'), '#FFFFFF');
});

test('discarding on close restores the same connected desktop viewport', async () => {
  const { store, gridShell } = createHarness();
  await store.openWindow();
  store.update('dock.appearance.icon_size', 64);
  gridShell.scrollTop = 20;
  store.close(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gridShell.scrollTop, 210);
});

test('a new preview cancels a queued scroll restoration', async () => {
  const { store, gridShell } = createHarness();
  await store.openWindow();
  store.update('dock.appearance.icon_size', 64);
  store.restoreDraft();
  store.update('dock.appearance.icon_size', 60);
  gridShell.scrollTop = 10;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gridShell.scrollTop, 10);
});

test('scroll restoration never writes to a detached desktop', async () => {
  const { store, gridShell } = createHarness();
  await store.openWindow();
  store.update('dock.appearance.icon_size', 64);
  gridShell.scrollTop = 20;
  gridShell.isConnected = false;
  store.restoreDraft();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gridShell.scrollTop, 20);
});
