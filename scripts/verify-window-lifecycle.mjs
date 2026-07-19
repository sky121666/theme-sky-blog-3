import assert from 'node:assert/strict';

const previousGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  localStorage: globalThis.localStorage
};

const windowListeners = new Map();
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
  body: { style: {} },
  head: { querySelector() { return null; } },
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
  titlebar.shareFeedbackTimer = setTimeout(() => {}, 10_000);
  titlebar.destroy();
  assert.equal(titlebar.shareFeedbackTimer, null, 'windowTitlebar destroy 必须清理反馈 timer');

  console.log('window lifecycle contract passed');
} finally {
  globalThis.window = previousGlobals.window;
  globalThis.document = previousGlobals.document;
  globalThis.localStorage = previousGlobals.localStorage;
}
