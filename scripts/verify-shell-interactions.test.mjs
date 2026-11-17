import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { registerWindowComponents } from '../src/shell/desktop-shell/runtime/desktop/window.js';
import './verify-window-motion.test.mjs';

const globals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  requestAnimationFrame: globalThis.requestAnimationFrame
};
afterEach(() => Object.assign(globalThis, globals));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const frames = [];
  const titlebar = { style: {} };
  const winEl = {
    isConnected: true,
    style: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
    querySelector: () => titlebar
  };
  const dockIcon = { style: {} };
  globalThis.document = {
    title: '测试页面',
    head: { querySelector() { return null; } },
    body: { dataset: {}, classList: { remove() {} } },
    activeElement: null,
    querySelector(selector) { return selector === '[data-window-surface]' ? winEl : null; },
    getElementById() { return dockIcon; }
  };
  globalThis.window = {
    innerWidth: 1440,
    location: { pathname: '/archives', href: 'https://example.com/archives', origin: 'https://example.com' },
    matchMedia() { return { matches: true }; },
    setTimeout,
    clearTimeout
  };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const stores = new Map();
  const components = new Map();
  registerWindowManager({
    data(name, factory) { components.set(name, factory); },
    store(name, value) { if (value) stores.set(name, value); return stores.get(name); },
    $data(element) { return element.component; },
    nextTick(callback) { callback?.(); }
  });
  const manager = stores.get('windowManager');
  manager.show = true;
  return {
    manager, components, winEl, dockIcon,
    paint() { while (frames.length) frames.shift()(); }
  };
}

test('navigation accepted before minimize paints cannot be hidden by the stale minimize task', async () => {
  const f = fixture();
  const pending = f.manager.minimize();
  f.manager.revealAfterNavigation('新的页面');
  f.paint();
  await pending;
  assert.equal(f.manager.show, true);
  assert.equal(f.manager.minimized, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
});

test('an immediate restore request is retained while the minimize animation prepares', async () => {
  const f = fixture();
  const pending = f.manager.minimize();
  await f.manager.restore();
  f.paint();
  await pending;
  await Promise.resolve();
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
});

function notificationFixture() {
  const f = fixture();
  const component = f.components.get('menuBar')();
  const closeAnimation = deferred();
  const closeButton = {};
  const trigger = {
    isConnected: true,
    focus() { document.activeElement = this; }
  };
  component.$refs = {
    notificationCenterPanel: { contains: (element) => element === closeButton }
  };
  component.$nextTick = () => Promise.resolve();
  component.notificationMotion = { close: () => closeAnimation.promise };
  component.notificationCenterOpen = true;
  component.notificationCenterVisible = true;
  component.notificationCenterRestoreFocusEl = trigger;
  document.activeElement = closeButton;
  return { component, closeAnimation, trigger };
}

test('a closed notification panel keeps the newest layout without loading its renderers or weather', async () => {
  const f = fixture();
  const menu = f.components.get('menuBar')();
  const loads = [];
  const weather = { key: 'weather', widget: 'system.weather', surface: 'notification-center' };
  const clock = { key: 'clock', widget: 'system.clock', surface: 'notification-center' };
  menu.ensureNotificationWidgetRenderer = (type) => loads.push(type);
  menu.loadNotificationWeather = () => loads.push('weather-data');
  menu.$nextTick = () => Promise.resolve();
  menu.$refs = {};
  menu.notificationCenterAuthResolved = true;
  document.body.classList.add = () => {};
  menu.syncNotificationWidgets([clock]);
  menu.syncNotificationWidgets([weather]);
  assert.deepEqual(loads, []);
  assert.deepEqual(menu.notificationWidgets, []);
  await menu.openNotificationCenter();
  assert.deepEqual(menu.notificationWidgets.map((item) => item.key), ['weather']);
  assert.deepEqual(loads, ['system.weather', 'weather-data']);
});

test('notification exit preserves a new focus selected while the panel is closing', async () => {
  const f = notificationFixture();
  const pending = f.component.closeNotificationCenter();
  await Promise.resolve();
  const searchInput = {};
  document.activeElement = searchInput;
  f.closeAnimation.resolve();
  await pending;
  assert.equal(document.activeElement, searchInput);
  assert.equal(f.component.notificationCenterVisible, false);
});

test('notification close still returns keyboard focus to its trigger when the panel owns focus', async () => {
  const f = notificationFixture();
  const pending = f.component.closeNotificationCenter();
  f.closeAnimation.resolve();
  await pending;
  assert.equal(document.activeElement, f.trigger);
});

test('notification handoff can explicitly suppress focus restoration', async () => {
  const f = notificationFixture();
  const previousFocus = document.activeElement;
  const pending = f.component.closeNotificationCenter({ restoreFocus: false });
  f.closeAnimation.resolve();
  await pending;
  assert.equal(document.activeElement, previousFocus);
});

test('opening search hands off an open notification panel without reclaiming search focus on exit', async () => {
  const f = notificationFixture();
  const searchInput = focusable('搜索');
  // A fully mounted plugin root avoids unrelated shadow-root observation work.
  document.querySelectorAll = () => [{
    shadowRoot: { addEventListener() {}, getElementById: () => ({}), querySelector: (selector) => selector === 'form' ? {} : null }
  }];
  window.requestAnimationFrame = () => 1;
  const searchOpened = deferred();
  for (const target of [window, document]) {
    const events = new EventTarget();
    target.addEventListener = events.addEventListener.bind(events);
    target.removeEventListener = events.removeEventListener.bind(events);
  }
  window.SearchWidget = { open() { searchInput.focus(); searchOpened.resolve(); } };
  assert.equal(f.component.openSearch(), true);
  assert.equal(f.component.notificationCenterOpen, false);
  f.closeAnimation.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.component.notificationCenterVisible, false);
  await searchOpened.promise;
  assert.equal(document.activeElement, searchInput);
});

function animatedFixture() {
  const f = fixture();
  const ghosts = new Set();
  const animations = [];
  const rect = { left: 120, top: 80, width: 900, height: 600 };
  f.winEl.getBoundingClientRect = () => rect;
  f.dockIcon.querySelector = () => null;
  f.dockIcon.getBoundingClientRect = () => ({ left: 700, top: 850, width: 48, height: 48 });
  window.matchMedia = () => ({ matches: false });
  window.getComputedStyle = () => ({});
  document.body.appendChild = (element) => ghosts.add(element);
  document.createElement = () => ({
    style: {},
    appendChild() {},
    remove() { ghosts.delete(this); },
    animate() {
      const animation = {
        cancelled: false,
        cancel() { this.cancelled = true; this.oncancel?.(); }
      };
      animations.push(animation);
      return animation;
    }
  });
  return { ...f, ghosts, animations };
}

test('navigation interrupts the running genie and removes its ghost without hiding the new page', async () => {
  const f = animatedFixture();
  const pending = f.manager.minimize();
  f.paint();
  await Promise.resolve();
  assert.equal(f.ghosts.size, 1);
  f.manager.revealAfterNavigation('新页面');
  await pending;
  assert.equal(f.ghosts.size, 0);
  assert.equal(f.animations.every((animation) => animation.cancelled), true);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.manager.minimized, false);
});

test('a restore clicked during the running genie immediately replaces it without a second click', async () => {
  const f = animatedFixture();
  const pending = f.manager.minimize();
  f.paint();
  await Promise.resolve();
  const restoring = f.manager.restore();
  await pending;
  assert.equal(f.animations.length, 4);
  assert.equal(f.animations[1].cancelled, true);
  f.animations[3].onfinish();
  await restoring;
  assert.equal(f.ghosts.size, 0);
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
});

function focusable(label = '') {
  return {
    textContent: label,
    getAttribute() { return null; },
    getClientRects() { return [{}]; },
    focus() { document.activeElement = this; }
  };
}

function key(keyName) {
  return {
    key: keyName,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

function menuFixture() {
  const f = fixture();
  const menu = f.components.get('desktopMenu')();
  const trigger = focusable('菜单');
  const items = ['文章', '相册', '链接'].map(focusable);
  const ticks = [];
  menu.$refs = { trigger };
  menu.$el = {
    querySelectorAll() { return items; },
    contains(element) { return element === trigger || items.includes(element); }
  };
  menu.$nextTick = (callback) => ticks.push(callback);
  return { menu, trigger, items, tick() { for (const callback of ticks.splice(0)) callback(); } };
}

test('click confirms a hovered menu instead of reversing its open state', () => {
  const f = menuFixture();
  f.menu.openOnHover({ pointerType: 'mouse' });
  assert.equal(f.menu.open, true);
  f.menu.toggleMenu({ detail: 1 });
  assert.equal(f.menu.open, true);
  f.menu.toggleMenu({ detail: 1 });
  assert.equal(f.menu.open, false);
});

test('menu arrows wrap, Home and End choose endpoints, and Escape returns focus to the trigger', () => {
  const f = menuFixture();
  f.trigger.focus();
  f.menu.handleMenuKeydown(key('ArrowDown'));
  f.tick();
  assert.equal(document.activeElement, f.items[0]);
  f.menu.handleMenuKeydown(key('ArrowUp'));
  assert.equal(document.activeElement, f.items[2]);
  f.menu.handleMenuKeydown(key('Home'));
  assert.equal(document.activeElement, f.items[0]);
  f.menu.handleMenuKeydown(key('End'));
  assert.equal(document.activeElement, f.items[2]);
  f.menu.closeOnLeave();
  assert.equal(f.menu.open, true);
  const escape = key('Escape');
  f.menu.handleMenuKeydown(escape);
  assert.equal(escape.stopped, true);
  assert.equal(f.menu.open, false);
  assert.equal(document.activeElement, f.trigger);
});

test('a closed menu cannot steal focus from a queued keyboard-open callback', () => {
  const f = menuFixture();
  f.menu.openMenu({ focus: 'first' });
  f.menu.closeMenu();
  const otherInput = focusable();
  otherInput.focus();
  f.tick();
  assert.equal(document.activeElement, otherInput);
});

test('horizontal menu navigation opens the adjacent dropdown and Tab leaves without trapping focus', () => {
  const first = menuFixture();
  const second = menuFixture();
  const groups = [first.menu.$el, second.menu.$el];
  for (const f of [first, second]) {
    f.menu.$el.component = f.menu;
    f.menu.$el.querySelector = () => f.trigger;
    f.menu.$el.parentElement = { querySelectorAll: () => groups };
  }
  first.menu.openMenu({ focus: 'first' });
  first.tick();
  first.menu.handleMenuKeydown(key('ArrowRight'));
  second.tick();
  assert.equal(first.menu.open, false);
  assert.equal(second.menu.open, true);
  assert.equal(document.activeElement, second.items[0]);
  const tab = key('Tab');
  second.menu.handleMenuKeydown(tab);
  assert.equal(second.menu.open, false);
  assert.equal(tab.prevented, false);
  assert.equal(document.activeElement, second.trigger);
});

test('hovering a sibling closes the clicked dropdown even while its trigger retains focus', () => {
  const first = menuFixture();
  const second = menuFixture();
  const groups = [first.menu.$el, second.menu.$el];
  for (const f of [first, second]) {
    f.menu.$el.component = f.menu;
    f.menu.$el.parentElement = { querySelectorAll: () => groups };
  }
  first.trigger.focus();
  first.menu.openOnHover({ pointerType: 'mouse' });
  first.menu.toggleMenu({ detail: 1 });
  first.menu.closeOnLeave();
  second.menu.openOnHover({ pointerType: 'mouse' });
  assert.equal(first.menu.open, false);
  assert.equal(second.menu.open, true);
});

test('mobile menu keyboard opening and Escape return focus through the trigger', () => {
  const f = fixture();
  const menu = f.components.get('menuBar')();
  const trigger = focusable('菜单');
  const item = focusable('文章');
  const ticks = [];
  menu.$refs = {
    mobileMenuTrigger: trigger,
    mobileMenuPanel: { querySelector: () => item, contains: (element) => element === item }
  };
  menu.$nextTick = (callback) => ticks.push(callback);
  trigger.focus();
  menu.toggleMobileMenu({ detail: 0 });
  ticks.shift()();
  assert.equal(document.activeElement, item);
  menu.handleMobileMenuKeydown(key('Escape'));
  assert.equal(menu.mobileMenuOpen, false);
  assert.equal(document.activeElement, trigger);
});

function shareFixture() {
  fixture();
  let factory;
  registerWindowComponents({ data(name, create) { if (name === 'windowTitlebar') factory = create; } });
  const share = factory();
  const trigger = focusable('分享');
  const firstAction = focusable('复制链接');
  const ticks = [];
  share.$refs = {
    shareTrigger: trigger,
    sharePanel: {
      querySelectorAll() { return [firstAction]; },
      contains(element) { return element === firstAction; }
    }
  };
  share.$nextTick = (callback) => ticks.push(callback);
  return { share, trigger, firstAction, tick() { for (const callback of ticks.splice(0)) callback(); } };
}

test('share popover focuses its action and Escape restores its trigger without bubbling', () => {
  const f = shareFixture();
  f.trigger.focus();
  f.share.openSharePanel();
  f.tick();
  assert.equal(document.activeElement, f.firstAction);
  const escape = key('Escape');
  f.share.handleShareEscape(escape);
  assert.equal(f.share.shareOpen, false);
  assert.equal(document.activeElement, f.trigger);
  assert.equal(escape.stopped, true);
});

test('closing a share popover revokes queued focus and respects a new outside focus', () => {
  const f = shareFixture();
  f.share.openSharePanel();
  const outside = focusable();
  outside.focus();
  f.share.closeSharePanel({ restoreFocus: false });
  f.tick();
  assert.equal(document.activeElement, outside);
});
