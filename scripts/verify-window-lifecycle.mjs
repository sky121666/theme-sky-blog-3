import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const previousGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  localStorage: globalThis.localStorage
};

const windowListeners = new Map();
const documentListeners = new Map();
const mediaListeners = new Set();
let activeObservers = 0;

function addTrackedListener(type, handler) {
  if (!windowListeners.has(type)) windowListeners.set(type, new Set());
  windowListeners.get(type).add(handler);
}

function removeTrackedListener(type, handler) {
  windowListeners.get(type)?.delete(handler);
}

class FakeResizeObserver {
  active = false;

  observe() {
    if (this.active) return;
    this.active = true;
    activeObservers += 1;
  }

  disconnect() {
    if (!this.active) return;
    this.active = false;
    activeObservers -= 1;
  }
}

const storage = new Map();
const fakeWindow = {
  innerWidth: 1440,
  innerHeight: 960,
  location: {
    pathname: '/categories',
    href: 'https://example.com/categories',
    origin: 'https://example.com',
    host: 'example.com'
  },
  ResizeObserver: FakeResizeObserver,
  addEventListener: addTrackedListener,
  removeEventListener: removeTrackedListener,
  dispatchEvent(event) {
    for (const handler of windowListeners.get(event.type) || []) handler(event);
    return true;
  },
  setTimeout,
  clearTimeout,
  getComputedStyle() {
    return { minWidth: '400px', minHeight: '400px' };
  },
  matchMedia() {
    return {
      matches: true,
      addEventListener(type, handler) {
        if (type === 'change') mediaListeners.add(handler);
      },
      removeEventListener(type, handler) {
        if (type === 'change') mediaListeners.delete(handler);
      }
    };
  }
};

const fakeDocument = {
  title: '分类',
  querySelector() { return null; },
  body: { style: {} },
  head: { querySelector() { return null; } },
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set());
    documentListeners.get(type).add(handler);
  },
  removeEventListener(type, handler) {
    documentListeners.get(type)?.delete(handler);
  },
  dispatchEvent(event) {
    for (const handler of documentListeners.get(event.type) || []) handler(event);
    return true;
  },
  createElement() {
    return { style: {}, setAttribute() {}, select() {}, remove() {} };
  },
  execCommand() { return false; }
};

try {
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };

  const { registerWindowComponents } = await import('../src/shell/desktop-shell/runtime/desktop/window.js');
  const require = createRequire(import.meta.url);
  assert.equal(Boolean(require.cache[require.resolve('qrcode')]), false, '二维码库应在微信分享打开时才加载');
  const factories = new Map();
  registerWindowComponents({
    data(name, factory) {
      factories.set(name, factory);
    }
  });

  const draggable = factories.get('draggableWindow')();
  draggable.$el = {
    dataset: {
      windowMetricsKey: 'contract-test',
      windowResizable: 'true',
      windowMaximizable: 'true',
      windowWidth: '',
      windowHeight: ''
    },
    style: {},
    offsetWidth: 1200,
    offsetHeight: 800
  };
  draggable.$store = {
    windowManager: {
      minimized: false,
      open() {},
      showDesktop() {},
      hide() {}
    }
  };

  draggable.init();
  assert.equal(windowListeners.get('resize')?.size, 1, '首次 init 应注册一个 resize listener');
  assert.equal(mediaListeners.size, 1, '首次 init 应注册一个 viewport media listener');
  assert.equal(activeObservers, 1, '首次 init 应注册一个 ResizeObserver');

  draggable.init();
  assert.equal(windowListeners.get('resize')?.size, 1, '重复 init 不得累积 resize listener');
  assert.equal(mediaListeners.size, 1, '重复 init 不得累积 media listener');
  assert.equal(activeObservers, 1, '重复 init 不得累积 ResizeObserver');

  fakeDocument.body.style.userSelect = 'none';
  fakeDocument.body.style.cursor = 'nwse-resize';
  draggable.destroy();
  draggable.destroy();
  assert.equal(windowListeners.get('resize')?.size || 0, 0, 'destroy 必须移除 resize listener');
  assert.equal(mediaListeners.size, 0, 'destroy 必须移除 media listener');
  assert.equal(activeObservers, 0, 'destroy 必须断开 ResizeObserver');
  assert.equal(fakeDocument.body.style.userSelect, '', 'destroy 必须恢复 user-select');
  assert.equal(fakeDocument.body.style.cursor, '', 'destroy 必须恢复 cursor');
  assert.equal(draggable._resizeSyncTimer, 0);
  assert.equal(draggable._viewportResizeTimer, 0);

  const titlebar = factories.get('windowTitlebar')();
  const originalShareUrl = fakeWindow.location.href;
  fakeWindow.location.href = `https://example.com/${'a'.repeat(10_000)}`;
  await titlebar.openWeChatShare();
  assert.equal(titlebar.wechatQrError, '二维码生成失败');
  assert.equal(titlebar.wechatQrLoading, false, '失败后必须释放加载状态以允许重试');
  fakeWindow.location.href = originalShareUrl;
  const qrReady = titlebar.openWeChatShare();
  assert.equal(titlebar.wechatQrLoading, true);
  await titlebar.openWeChatShare();
  await qrReady;
  assert.match(titlebar.wechatQrDataUrl, /^data:image\/png;base64,/);
  assert.equal(titlebar.wechatQrError, '');
  assert.equal(titlebar.wechatQrLoading, false);
  titlebar.shareFeedbackTimer = setTimeout(() => {}, 10_000);
  titlebar.destroy();
  assert.equal(titlebar.shareFeedbackTimer, null, 'windowTitlebar destroy 必须清理反馈 timer');

  const closeTimers = new Map();
  let nextCloseTimer = 0;
  fakeWindow.setTimeout = (callback, delay) => {
    assert.equal(delay, 180, 'close-to-home navigation keeps its short transition delay');
    const id = ++nextCloseTimer;
    closeTimers.set(id, () => {
      closeTimers.delete(id);
      callback();
    });
    return id;
  };
  fakeWindow.clearTimeout = (id) => closeTimers.delete(id);
  const navigations = [];
  let allowNavigation = true;
  fakeWindow.pjax = {
    loadUrl(url) {
      if (allowNavigation) {
        fakeDocument.dispatchEvent({ type: 'theme:navigation-accepted', detail: { url, intentId: navigations.length + 1 } });
      }
      navigations.push(url);
      return Promise.resolve(allowNavigation ? undefined : false);
    }
  };
  const closingWindow = factories.get('draggableWindow')();
  const closeManager = {
    show: true,
    pendingOpenRequested: false,
    hide() { this.show = false; }
  };
  closingWindow.$store = { windowManager: closeManager };

  closingWindow.closeWindow();
  const staleHomeCallback = [...closeTimers.values()][0];
  assert.equal(fakeWindow.preventAutoOpen, true);
  fakeWindow.dispatchEvent({ type: 'theme:before-pjax-navigation', detail: { url: '/photos' } });
  assert.equal(closeTimers.size, 1, 'a vetoable pre-navigation event must not cancel the pending home navigation');
  fakeWindow.pjax.loadUrl('/photos');
  assert.equal(closeTimers.size, 0, 'a new PJAX intent cancels the pending home navigation');
  assert.equal(fakeWindow.preventAutoOpen, false, 'new navigation can open its window');
  staleHomeCallback();
  assert.deepEqual(navigations, ['/photos'], 'a queued old close callback cannot overwrite new navigation');

  fakeWindow.location.pathname = '/photos';
  closeManager.show = true;
  closingWindow.closeWindow();
  const homeCallback = [...closeTimers.values()][0];
  homeCallback();
  assert.deepEqual(navigations, ['/photos', '/'], 'ordinary close still navigates home');
  assert.equal(closeTimers.size, 0);
  assert.equal(documentListeners.get('theme:navigation-accepted')?.size || 0, 0);
  fakeDocument.dispatchEvent({
    type: 'theme:navigation-settled',
    detail: { intentId: 2, outcome: 'failed' }
  });
  assert.equal(fakeWindow.preventAutoOpen, false, 'a failed accepted home navigation must restore auto-open');
  assert.equal(documentListeners.get('theme:navigation-settled')?.size || 0, 0);

  allowNavigation = false;
  fakeWindow.location.pathname = '/photos';
  closeManager.show = true;
  closingWindow.closeWindow();
  [...closeTimers.values()][0]();
  await Promise.resolve();
  assert.equal(fakeWindow.preventAutoOpen, false, 'a vetoed delayed home navigation must not leave auto-open suppressed');
  assert.equal(documentListeners.get('theme:navigation-accepted')?.size || 0, 0);
  allowNavigation = true;

  const { registerDesktopSurface } = await import('../src/shell/desktop-shell/runtime/desktop/surface/index.js');
  const { editModeMethods } = await import('../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js');
  const { registerThemeSettings } = await import('../src/shell/desktop-shell/runtime/desktop/theme-settings.js');
  const {
    prepareNavigation, commitNavigation, abandonNavigation,
    prepareNativeHandoff, revokeNativeHandoff
  } = await import('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js');
  let desktopFactory;
  registerDesktopSurface({ data(_name, factory) { desktopFactory = factory; } });
  let settingsStore;
  const settingsStores = new Map();
  registerThemeSettings({ store(name, store) {
    if (arguments.length > 1) settingsStores.set(name, store);
    if (name === 'themeSettings' && store) settingsStore = store;
    return settingsStores.get(name);
  } });
  fakeDocument.body.classList = { remove() {} };
  const surface = desktopFactory();
  Object.assign(surface, editModeMethods);
  surface.serverLayoutMutationVersion = 2;
  surface.serverLayoutSavedMutationVersion = 1;
  surface.isEditing = true;
  surface.widgets = [{ key: 'draft' }];
  surface.defaultWidgets = [{ key: 'saved' }];
  surface.icons = [];
  surface.defaultIcons = [];
  surface.iconTombstones = [];
  surface.defaultIconTombstones = [];
  surface.invalidateWidgetCache = () => {};
  surface.syncGridMetrics = () => {};
  surface.syncWidgetRuntimes = () => {};
  surface.dispatchNotificationWidgetsChange = () => {};
  surface.closeDesktopContextMenu = () => {};
  surface.endCenterSheetDrag = () => {};
  surface.endDrag = () => {};
  surface.syncDesktopBodyState = () => {};
  settingsStore.visible = true;
  settingsStore.open = true;
  settingsStore.dirtyPaths = ['desktop.appearance.mode'];
  settingsStore.draftMutationVersion = 3;
  assert.equal(typeof surface.installNavigationGuard, 'function', 'desktop surface must register its real navigation guard');
  assert.equal(typeof settingsStore.installNavigationGuard, 'function', 'settings must register its real navigation guard');
  surface.installNavigationGuard();
  settingsStore.installNavigationGuard();

  let answers = [true, false];
  fakeWindow.confirm = () => answers.shift();
  const vetoed = prepareNavigation({ url: '/photos' });
  assert.equal(vetoed.kind, 'cancelled', 'a later settings veto must reject the whole navigation');
  assert.equal(surface.widgets[0].key, 'draft', 'an earlier desktop approval must not discard its draft');
  assert.equal(surface.isEditing, true, 'an earlier desktop approval must not exit edit mode');
  assert.deepEqual(settingsStore.dirtyPaths, ['desktop.appearance.mode']);

  answers = [true, true];
  const approved = prepareNavigation({ url: '/photos' });
  assert.equal(approved.kind, 'accepted');
  assert.equal(surface.widgets[0].key, 'draft', 'accepted navigation keeps draft until response commit');
  assert.equal(settingsStore.visible, true, 'accepted navigation keeps settings open until response commit');
  assert.equal(commitNavigation(approved.permit, () => true), 'committed');
  assert.equal(surface.widgets[0].key, 'saved', 'commit restores the saved desktop layout');
  assert.equal(surface.isEditing, false, 'commit synchronously exits desktop edit mode');
  assert.equal(settingsStore.visible, false, 'commit synchronously closes dirty settings');
  assert.deepEqual(settingsStore.dirtyPaths, []);

  surface.serverLayoutMutationVersion = 3;
  surface.isEditing = true;
  answers = [true];
  const native = prepareNavigation({ url: '/missing' });
  assert.equal(native.kind, 'accepted');
  assert.equal(prepareNativeHandoff(native.permit, () => true), 'allowed');
  const coveredUnload = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  surface.handleDesktopBeforeUnload(coveredUnload);
  assert.equal(coveredUnload.defaultPrevented, false, 'approved native handoff must not ask the desktop guard twice');
  revokeNativeHandoff();
  const ordinaryUnload = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  surface.handleDesktopBeforeUnload(ordinaryUnload);
  assert.equal(ordinaryUnload.defaultPrevented, true, 'ordinary unload still protects unsaved desktop changes');
  abandonNavigation(native.permit);
  surface.destroy();
  settingsStore.destroy();

  console.log('window lifecycle contract passed');
} finally {
  globalThis.window = previousGlobals.window;
  globalThis.document = previousGlobals.document;
  globalThis.localStorage = previousGlobals.localStorage;
}
