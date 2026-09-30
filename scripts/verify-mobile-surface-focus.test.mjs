import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';

const original = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
afterEach(() => Object.assign(globalThis, original));

function fixture({ width = 390, path = '/archives/test', state, deferredPaint = false } = {}) {
  const listeners = new Map();
  const storage = new Map(state ? [['theme-macOS-window-state', JSON.stringify(state)]] : []);
  const desktopLink = {};
  let inert = false;
  const surface = {
    contains: (element) => element === desktopLink,
    get inert() { return inert; },
    set inert(value) {
      inert = value;
      if (value && document.activeElement === desktopLink) document.activeElement = document.body;
    }
  };
  const nextTicks = [];
  const content = {
    attributes: new Map(),
    visible: true,
    focusAttempts: 0,
    hasAttribute(name) { return this.attributes.has(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    focus(options) {
      this.focusAttempts++;
      if (!this.visible) return;
      this.focusOptions = options;
      document.activeElement = this;
    }
  };
  globalThis.document = {
    title: '测试',
    body: { dataset: {} },
    activeElement: {},
    querySelector(selector) {
      if (selector === '.desktop-surface') return surface;
      if (selector === '[data-window-content-root]') return content;
      return null;
    }
  };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  globalThis.window = {
    innerWidth: width,
    location: { pathname: path },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  };
  const stores = new Map();
  registerWindowManager({
    data() {},
    store(name, value) { if (value) stores.set(name, value); return stores.get(name); },
    nextTick(callback) { if (deferredPaint) nextTicks.push(callback); else callback(); }
  });
  const manager = stores.get('windowManager');
  return { manager, surface, content, desktopLink, listeners,
    paint() { for (const callback of nextTicks.splice(0)) callback(); },
    resize(nextWidth) {
      window.innerWidth = nextWidth;
      for (const callback of listeners.get('resize') || []) callback();
    } };
}

test('visible mobile content removes covered desktop links from keyboard and accessibility navigation', () => {
  const f = fixture();
  f.manager.show = true;
  f.manager.sync();
  assert.equal(f.surface.inert, true);
});

test('a mobile direct entry synchronizes the restored window state on init', () => {
  const f = fixture({ state: { show: true, minimized: false } });
  f.manager.init();
  assert.equal(f.surface.inert, true);
});

test('desktop windows leave the background interactive and returning home removes mobile isolation', () => {
  const desktop = fixture({ width: 1024 });
  desktop.manager.show = true;
  desktop.surface.inert = true;
  desktop.manager.sync();
  assert.equal(desktop.surface.inert, false);
  const mobile = fixture();
  mobile.manager.show = true;
  mobile.manager.sync();
  mobile.manager.showDesktop();
  assert.equal(mobile.surface.inert, false);
});

test('resizing across the full-screen breakpoint updates isolation without changing the window state', () => {
  const f = fixture({ width: 1024, state: { show: true, minimized: false } });
  f.manager.init();
  f.resize(767);
  assert.equal(f.surface.inert, true);
  assert.equal(f.manager.show, true);
  f.resize(768);
  assert.equal(f.surface.inert, false);
  f.resize(390);
  assert.equal(f.surface.inert, true);
});

test('focus on the covered desktop moves into visible mobile content during a viewport transition', () => {
  const f = fixture({ width: 1024, state: { show: true, minimized: false } });
  f.manager.init();
  document.activeElement = f.desktopLink;
  f.resize(390);
  assert.equal(document.activeElement, f.content);
  assert.equal(f.content.attributes.get('tabindex'), '-1');
  assert.deepEqual(f.content.focusOptions, { preventScroll: true });
});

test('hidden or minimized windows restore desktop interaction and preserve an existing content focus', () => {
  const f = fixture();
  f.manager.show = true;
  document.activeElement = f.content;
  f.manager.sync();
  assert.equal(document.activeElement, f.content);
  f.manager.hide();
  assert.equal(f.surface.inert, false);
  f.manager.show = true;
  f.manager.minimized = true;
  f.manager.sync();
  assert.equal(f.surface.inert, false);
});

test('repeated initialization owns only one resize listener and destroy releases its isolation', () => {
  const f = fixture({ state: { show: true, minimized: false } });
  f.manager.init();
  f.manager.init();
  assert.equal(f.listeners.get('resize')?.size, 1);
  assert.equal(typeof f.manager.destroy, 'function');
  f.manager.destroy();
  f.manager.destroy();
  assert.equal(f.listeners.get('resize')?.size, 0);
  assert.equal(f.surface.inert, false);
});

test('opening from a mobile desktop waits for the window to become visible before focusing content', () => {
  const f = fixture({ deferredPaint: true });
  f.content.visible = false;
  document.activeElement = f.desktopLink;
  f.manager.show = true;
  f.manager.sync();
  assert.equal(f.surface.inert, true);
  assert.equal(f.content.focusAttempts, 0);
  f.content.visible = true;
  f.paint();
  assert.equal(document.activeElement, f.content);
  assert.equal(f.content.focusAttempts, 1);
});

test('a closed window does not accept a focus transfer queued before its display update', () => {
  const f = fixture({ deferredPaint: true });
  document.activeElement = f.desktopLink;
  f.manager.show = true;
  f.manager.sync();
  f.manager.hide();
  f.paint();
  assert.equal(f.surface.inert, false);
  assert.equal(f.content.focusAttempts, 0);
});

test('a delayed focus transfer preserves a new user focus and is revoked on destroy', () => {
  const f = fixture({ deferredPaint: true });
  document.activeElement = f.desktopLink;
  f.manager.show = true;
  f.manager.sync();
  const newerFocus = {};
  document.activeElement = newerFocus;
  f.paint();
  assert.equal(document.activeElement, newerFocus);
  assert.equal(f.content.focusAttempts, 0);
  document.activeElement = f.desktopLink;
  f.manager.sync();
  f.manager.destroy();
  f.paint();
  assert.equal(f.content.focusAttempts, 0);
});
