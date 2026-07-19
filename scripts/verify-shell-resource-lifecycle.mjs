import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const globalNames = [
  'window',
  'document',
  'navigator',
  'MutationObserver',
  'Element',
  'HTMLElement'
];
const previousGlobals = new Map(
  globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
);

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  });
}

function restoreGlobals() {
  previousGlobals.forEach((descriptor, name) => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  });
}

async function verifySearchObserverLifecycle() {
  const observers = [];
  const timers = new Map();
  const animationFrames = [];
  let nextTimerId = 1;
  let openCount = 0;
  let modals = [];

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observeCount = 0;
      this.disconnectCount = 0;
      this.active = false;
      observers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      this.observeCount += 1;
      this.active = true;
    }

    disconnect() {
      this.disconnectCount += 1;
      this.active = false;
    }

    trigger() {
      this.callback([]);
    }
  }

  const fakeDocument = {
    documentElement: { nodeName: 'HTML' },
    querySelectorAll(selector) {
      assert.equal(selector, 'search-modal');
      return modals;
    },
    createElement(tagName) {
      assert.equal(tagName, 'style');
      return { id: '', textContent: '' };
    }
  };
  const fakeWindow = {
    SearchWidget: {
      open() {
        openCount += 1;
      }
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };

  setGlobal('window', fakeWindow);
  setGlobal('document', fakeDocument);
  setGlobal('MutationObserver', FakeMutationObserver);

  const searchUrl = pathToFileURL(path.join(root, 'src/shell/desktop-shell/runtime/desktop/search.js'));
  const { openSearchWidget } = await import(`${searchUrl.href}?contract=search-lifecycle`);

  assert.equal(observers.length, 0, '导入搜索模块时不得启动首屏 document observer');
  assert.equal(openSearchWidget(), true);
  assert.equal(openSearchWidget(), true);
  assert.equal(openCount, 2);
  assert.equal(observers.length, 1, '重复打开期间只能存在一个 observer');
  assert.equal(observers[0].observeCount, 1);
  assert.equal(observers[0].target, fakeDocument.documentElement);
  assert.deepEqual(observers[0].options, { childList: true, subtree: true });

  const timeoutEntry = Array.from(timers.entries()).find(([, timer]) => timer.delay === 2000);
  assert.ok(timeoutEntry, '搜索 observer 必须设置短生命周期超时');
  timers.delete(timeoutEntry[0]);
  timeoutEntry[1].callback();
  assert.equal(observers[0].active, false, '超时后必须 disconnect');
  assert.equal(observers[0].disconnectCount, 1);

  assert.equal(openSearchWidget(), true);
  assert.equal(observers.length, 2, '前一个 observer 结束后允许下一次打开重新观察');
  const styleNodes = new Map();
  const shadowRoot = {
    getElementById(id) {
      return styleNodes.get(id) || null;
    },
    appendChild(style) {
      styleNodes.set(style.id, style);
    }
  };
  modals = [{ shadowRoot }];
  observers[1].trigger();

  assert.ok(styleNodes.has('mac-search-style'), '观察到 search-modal 后必须注入样式');
  assert.equal(observers[1].active, false, '样式注入成功后必须立即 disconnect');
  assert.equal(observers[1].disconnectCount, 1);
  assert.equal(Array.from(timers.values()).some((timer) => timer.delay === 2000), false, '成功后必须清理 observer timer');

  assert.equal(openSearchWidget(), true);
  assert.equal(observers.length, 2, '已有样式时不得创建新 observer');
  assert.equal(styleNodes.size, 1, '重复打开不得重复注入样式');
  assert.equal(animationFrames.length, 4, '每次成功调用仍应保留下一帧补扫');
}

async function verifyFloatingScrollbarPruneLifecycle() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const lifecycleEvents = [];
  const timers = new Map();
  let nextTimerId = 1;
  let currentContainers = [];

  function addListener(registry, type, handler) {
    if (!registry.has(type)) registry.set(type, []);
    registry.get(type).push(handler);
  }

  class FakeClassList {
    constructor(ownerName = '') {
      this.ownerName = ownerName;
      this.values = new Set();
    }

    add(value) {
      this.values.add(value);
      if (value === 'floating-scrollbar-host') {
        lifecycleEvents.push(`register:${this.ownerName}`);
      }
    }

    toggle(value, force) {
      if (force) this.values.add(value);
      else this.values.delete(value);
    }

    contains(value) {
      return this.values.has(value);
    }
  }

  class FakeStyle {
    constructor(owner) {
      this.owner = owner;
    }

    setProperty() {
      this.owner.styleWrites += 1;
    }
  }

  class FakeElement {
    closest() {
      return null;
    }

    matches() {
      return false;
    }
  }

  class FakeHTMLElement extends FakeElement {}

  function createContainer(name) {
    const container = new FakeHTMLElement();
    container.name = name;
    container.isConnected = true;
    container.dataset = {};
    container.classList = new FakeClassList(name);
    container.clientWidth = 160;
    container.clientHeight = 160;
    container.scrollWidth = 160;
    container.scrollHeight = 800;
    container.scrollLeft = 0;
    container.scrollTop = 0;
    container.styleWrites = 0;
    container.matches = (selector) => selector !== '#article-content pre';
    container.closest = () => container;

    const overlay = new FakeElement();
    overlay.clientWidth = 156;
    overlay.clientHeight = 156;
    overlay.dataset = {};
    const thumb = new FakeElement();
    thumb.style = new FakeStyle(container);
    thumb.setPointerCapture = () => {};
    thumb.closest = (selector) => (
      selector === '.window-scrollbar-thumb' ? thumb : container
    );
    overlay.querySelector = () => thumb;
    container.querySelector = () => overlay;
    container.thumb = thumb;
    return container;
  }

  const oldContainer = createContainer('old');
  const newContainer = createContainer('new');
  currentContainers = [oldContainer];

  const fakeDocument = {
    documentElement: { classList: new FakeClassList('document') },
    body: {
      dataset: { pageApp: '' },
      style: { userSelect: '', cursor: '' }
    },
    querySelectorAll() {
      return currentContainers;
    },
    addEventListener(type, handler) {
      addListener(documentListeners, type, handler);
    },
    createElement() {
      throw new Error('非 Windows 契约场景不应创建 overlay');
    }
  };
  const fakeWindow = {
    addEventListener(type, handler) {
      addListener(windowListeners, type, handler);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      lifecycleEvents.push(`clear:${id}`);
      timers.delete(id);
    }
  };

  setGlobal('Element', FakeElement);
  setGlobal('HTMLElement', FakeHTMLElement);
  setGlobal('window', fakeWindow);
  setGlobal('document', fakeDocument);
  setGlobal('navigator', { platform: 'MacIntel' });

  const shellUrl = pathToFileURL(path.join(root, 'src/shell/desktop-shell/runtime/desktop/shell.js'));
  const { initFloatingScrollbars } = await import(`${shellUrl.href}?contract=scrollbar-lifecycle`);
  initFloatingScrollbars();
  initFloatingScrollbars();

  assert.equal(documentListeners.get('pjax:complete')?.length, 1, '重复初始化不得注册第二个 PJAX handler');
  assert.equal(documentListeners.get('theme:content-swapped')?.length, 1, '重复初始化不得注册第二个内容替换 handler');
  assert.equal(oldContainer.classList.contains('floating-scrollbar-host'), true);
  assert.deepEqual(fakeWindow.__THEME_FLOATING_SCROLLBAR_DEBUG__.snapshot(), {
    initialized: 1,
    connected: 1,
    disconnected: 0
  });

  documentListeners.get('scroll')[0]({ target: oldContainer });
  assert.equal(oldContainer.dataset.scrollbarActive, 'true');

  let prevented = false;
  documentListeners.get('pointerdown')[0]({
    target: oldContainer.thumb,
    pointerId: 7,
    clientX: 20,
    clientY: 20,
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(fakeDocument.body.style.userSelect, 'none');
  assert.equal(fakeDocument.body.style.cursor, 'grabbing');
  const activeTimerId = Math.max(...timers.keys());

  oldContainer.isConnected = false;
  currentContainers = [newContainer];
  lifecycleEvents.length = 0;
  documentListeners.get('theme:content-swapped')[0]();

  assert.equal(timers.has(activeTimerId), false, '同 variant 内容替换必须清理旧容器 timer');
  assert.equal(oldContainer.dataset.scrollbarActive, undefined);
  assert.equal(fakeDocument.body.style.userSelect, '', '同 variant 内容替换必须释放旧拖拽状态');
  assert.equal(fakeDocument.body.style.cursor, '');
  assert.equal(newContainer.classList.contains('floating-scrollbar-host'), true);
  const clearIndex = lifecycleEvents.indexOf(`clear:${activeTimerId}`);
  const registerIndex = lifecycleEvents.indexOf('register:new');
  assert.ok(clearIndex >= 0 && registerIndex > clearIndex, '内容替换必须先 prune 旧资源，再扫描新容器');
  assert.deepEqual(fakeWindow.__THEME_FLOATING_SCROLLBAR_DEBUG__.snapshot(), {
    initialized: 1,
    connected: 1,
    disconnected: 0
  });

  const oldWritesBeforeResize = oldContainer.styleWrites;
  const newWritesBeforeResize = newContainer.styleWrites;
  windowListeners.get('resize')[0]();
  assert.equal(oldContainer.styleWrites, oldWritesBeforeResize, 'resize 不得再持有断连容器');
  assert.ok(newContainer.styleWrites > newWritesBeforeResize, '新容器仍需正常同步滚动条');

  lifecycleEvents.length = 0;
  documentListeners.get('pjax:complete')[0]();
  assert.equal(lifecycleEvents.some((event) => event.startsWith('clear:')), false, '重复 PJAX prune 必须幂等');
  assert.deepEqual(fakeWindow.__THEME_FLOATING_SCROLLBAR_DEBUG__.snapshot(), {
    initialized: 1,
    connected: 1,
    disconnected: 0
  });
}

try {
  await verifySearchObserverLifecycle();
  await verifyFloatingScrollbarPruneLifecycle();

  const shellSource = fs.readFileSync(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/shell.js'),
    'utf8'
  );
  assert.doesNotMatch(shellSource, /observeSearchWidget/, '首屏注册阶段不得再启动搜索 observer');
  assert.match(
    shellSource,
    /const refreshFloatingScrollbars = \(\) => \{[\s\S]*?pruneDisconnectedContainers\(\);[\s\S]*?registerAllContainers\(\);[\s\S]*?\};/,
    '浮动滚动条刷新必须先 prune 再扫描'
  );
  assert.match(
    shellSource,
    /document\.addEventListener\('theme:content-swapped', refreshFloatingScrollbars\);/,
    '同 variant 内容替换必须触发浮动滚动条刷新'
  );
  assert.match(
    shellSource,
    /document\.addEventListener\('pjax:complete', refreshFloatingScrollbars\);/,
    '完整 PJAX 仍必须触发浮动滚动条刷新'
  );

  const pjaxSource = fs.readFileSync(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/index.js'),
    'utf8'
  );
  assert.match(pjaxSource, /new CustomEvent\('theme:content-swapped'/, '内容替换后必须派发内部资源刷新事件');
  assert.match(pjaxSource, /new CustomEvent\('pjax:same-variant-complete'/, '同 variant 导航必须派发完成事件');

  console.log('shell resource lifecycle contract passed');
} finally {
  restoreGlobals();
}
