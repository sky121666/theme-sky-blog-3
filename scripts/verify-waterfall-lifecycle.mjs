import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const momentsPath = path.join(root, 'templates/modules/moments-app/list.html');
const pjaxPath = path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/index.js');

const momentsSource = fs.readFileSync(momentsPath, 'utf8');
const pjaxSource = fs.readFileSync(pjaxPath, 'utf8');

function extractAlpineData(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `missing ${marker}`);
  const dataIndex = source.indexOf('x-data="', markerIndex);
  assert.ok(dataIndex >= 0, `missing x-data after ${marker}`);
  const dataStart = dataIndex + 'x-data="'.length;
  const dataEnd = source.indexOf('"\n', dataStart);
  assert.ok(dataEnd > dataStart, `unterminated x-data after ${marker}`);
  return source.slice(dataStart, dataEnd);
}

function assertWaterfallContract(source, marker, appId) {
  const expression = extractAlpineData(source, marker);
  assert.doesNotThrow(
    () => new Function('$el', `return (${expression});`)({ dataset: { nextUrl: '/next' } }),
    `${appId} Alpine data must remain valid JavaScript`
  );

  const required = [
    'requestController: null',
    'generation: 0',
    'resumePaginationAfterNavigationError: false',
    'new AbortController()',
    'signal: controller.signal',
    'if (!res.ok)',
    'generation !== this.generation',
    'requestPath !== this.currentPath()',
    'requestUrl !== this.nextUrl',
    'this.appRoot() !== appRoot',
    'this.feedList() !== targetList',
    'this.requestController?.abort()',
    'navigationIntentId: null',
    "document.addEventListener('theme:navigation-accepted', this._onNavigationAccepted)",
    "document.addEventListener('theme:pjax-ready', this._onPjaxReady)",
    "document.addEventListener('theme:navigation-settled', this._onNavigationSettled)",
    "document.removeEventListener('theme:navigation-accepted', this._onNavigationAccepted)",
    "document.removeEventListener('theme:pjax-ready', this._onPjaxReady)",
    "document.removeEventListener('theme:navigation-settled', this._onNavigationSettled)",
    "this.$el.closest('[data-app-root]')",
    `root.dataset.appRoot === '${appId}'`,
    'const targetList = this.feedList()',
    "loadError = '\u52a0\u8f7d\u5931\u8d25\uff0c\u70b9\u51fb\u91cd\u8bd5'"
  ];

  required.forEach((contract) => {
    assert.ok(expression.includes(contract), `${appId} missing lifecycle contract: ${contract}`);
  });
  assert.ok(
    expression.includes("this.loadError = '加载已中断，点击重试'"),
    `${appId} must expose a retry only when navigation interrupted active pagination`
  );

  assert.ok(
    expression.split('this.cancelPending();').length >= 3,
    `${appId} must abort from both accepted navigation and destroy`
  );
  assert.equal(
    source.includes(`document.querySelector('.${appId}-feed-list')`),
    false,
    `${appId} waterfall must not resolve its feed list globally`
  );
  assert.match(source, /@click="loadNext\(\)" x-text="loadError"/, `${appId} must expose an explicit retry action`);

  return expression;
}

function createEventDocument() {
  const listeners = new Map();
  return {
    body: { dataset: {} },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, detail = {}) {
      Array.from(listeners.get(type) || []).forEach((listener) => listener({ type, detail }));
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    }
  };
}

async function verifyWaterfallRuntime(expression, appId) {
  const previousGlobals = new Map(
    ['document', 'window', 'location', 'sessionStorage', 'fetch', 'DOMParser']
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const eventDocument = createEventDocument();
  const storage = new Map();
  const feedList = {
    children: [],
    querySelectorAll() { return []; },
    insertAdjacentHTML() {}
  };
  const scroller = { scrollTop: 0 };
  const appRoot = {
    dataset: { appRoot: appId },
    querySelector(selector) {
      return selector === `.${appId}-feed-list` ? feedList : null;
    }
  };
  const trigger = {
    dataset: { nextUrl: `/${appId}?page=2` },
    isConnected: true,
    closest(selector) {
      if (selector === '[data-app-root]') return appRoot;
      if (selector === `.${appId}-body`) return scroller;
      return null;
    }
  };

  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: eventDocument });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Alpine: null, pjax: null, __initLazyImages: null, dispatchEvent() {} }
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: `/${appId}`, search: '' }
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
      }
    });

    let abortedSignal = null;
    globalThis.fetch = (_url, options = {}) => {
      abortedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        const rejectAbort = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (options.signal?.aborted) rejectAbort();
        else options.signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    };

    const model = new Function('$el', `return (${expression});`)(trigger);
    model.$el = trigger;
    model.init();
    for (const type of ['theme:navigation-accepted', 'theme:pjax-ready', 'theme:navigation-settled']) {
      assert.equal(eventDocument.listenerCount(type), 1, `${appId} must subscribe once to ${type}`);
    }
    for (const type of ['pjax:send', 'pjax:same-variant-send', 'pjax:error', 'pjax:complete', 'pjax:same-variant-complete']) {
      assert.equal(eventDocument.listenerCount(type), 0, `${appId} must not retain duplicate library event subscriptions`);
    }

    const pendingLoad = model.loadNext();
    assert.equal(model.loading, true, `${appId} should enter a loading state before navigation`);
    eventDocument.emit('theme:navigation-accepted', { intentId: 1, url: `/${appId}?next=1` });
    assert.equal(abortedSignal?.aborted, true, `${appId} should abort pagination on accepted navigation`);
    assert.equal(model.loading, false, `${appId} should release loading when navigation takes ownership`);
    const acceptedGeneration = model.generation;
    eventDocument.emit('theme:navigation-accepted', { intentId: 1, url: `/${appId}?next=1` });
    assert.equal(model.generation, acceptedGeneration, `${appId} duplicate accepted intent must not cancel twice`);
    await pendingLoad;

    eventDocument.emit('theme:navigation-accepted', { intentId: 2, url: `/${appId}?next=2` });
    eventDocument.emit('theme:navigation-settled', { intentId: 1, outcome: 'failed' });
    assert.equal(model.loadError, '', `${appId} stale failure must not change the active navigation`);
    assert.equal(model.navigationIntentId, 2, `${appId} stale failure must not clear the newer intent`);
    eventDocument.emit('theme:pjax-ready', { intentId: 1, appId });
    assert.equal(model.navigationIntentId, 2, `${appId} stale ready must not clear the newer intent`);
    eventDocument.emit('theme:navigation-settled', { intentId: 2, outcome: 'superseded' });
    assert.equal(model.navigationIntentId, 2, `${appId} superseded must not restore old pagination`);
    eventDocument.emit('theme:navigation-settled', { intentId: 2, outcome: 'failed' });
    assert.equal(model.loadError, '加载已中断，点击重试', `${appId} must make interrupted pagination retryable after navigation failure`);
    assert.equal(model.hasMore, true, `${appId} navigation failure must not masquerade as end-of-list`);
    assert.equal(model.resumePaginationAfterNavigationError, false, `${appId} must consume the recovery marker once`);
    assert.equal(model.navigationIntentId, null, `${appId} settled failure must clear its active intent`);

    model.loadError = '';
    eventDocument.emit('theme:navigation-settled', { intentId: 2, outcome: 'failed' });
    assert.equal(model.loadError, '', `${appId} must ignore unrelated navigation failures when no pagination request was interrupted`);
    eventDocument.emit('theme:navigation-accepted', { intentId: 3, url: `/${appId}?next=3` });
    eventDocument.emit('theme:pjax-ready', { intentId: 3, appId });
    eventDocument.emit('theme:navigation-settled', { intentId: 3, outcome: 'ready' });
    assert.equal(model.navigationIntentId, null, `${appId} ready must clear its current intent`);
    assert.equal(model.loadError, '', `${appId} ready must not show a retry error`);
    eventDocument.emit('theme:navigation-accepted', { intentId: 4, url: `/${appId}?next=4` });
    eventDocument.emit('theme:pjax-ready', {});
    eventDocument.emit('theme:navigation-settled', { outcome: 'failed' });
    assert.equal(model.navigationIntentId, 4, `${appId} events without an intent must not release active navigation`);
    eventDocument.emit('theme:navigation-settled', { intentId: 4, outcome: 'cancelled' });
    assert.equal(model.navigationIntentId, null, `${appId} cancelled intent must release navigation ownership`);
    eventDocument.emit('theme:navigation-accepted', { intentId: 5, url: `/${appId}?next=5` });
    eventDocument.emit('theme:navigation-settled', { intentId: 5, outcome: 'native' });
    assert.equal(model.navigationIntentId, null, `${appId} native handoff must release navigation ownership`);

    globalThis.fetch = async () => ({
      ok: true,
      async text() { return '<html></html>'; }
    });
    const responseRoot = {
      dataset: { appRoot: appId },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    };
    globalThis.DOMParser = class {
      parseFromString() {
        return {
          querySelectorAll(selector) {
            return selector === '[data-app-root]' ? [responseRoot] : [];
          }
        };
      }
    };
    await model.loadNext();
    assert.equal(model.loadError, '', `${appId} terminal pagination success should keep the error state clear`);
    assert.equal(model.hasMore, false, `${appId} retry should accept a valid terminal page`);

    model.destroy();
    for (const type of ['theme:navigation-accepted', 'theme:pjax-ready', 'theme:navigation-settled']) {
      assert.equal(eventDocument.listenerCount(type), 0, `${appId} destroy should remove ${type}`);
    }
  } finally {
    previousGlobals.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
}

async function verifyCacheQuotaFailureInBrowser(expression) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://moments.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <main data-app-root="moments"><div class="moments-body">
          <div class="moments-feed-list"><article class="waterfall-injected">cached card</article></div>
          <div class="moments-feed-pagination" data-next-url="/moments?page=2"></div>
        </div></main></body></html>`
    }));
    await page.goto('https://moments.test/moments');
    const result = await page.evaluate((realExpression) => {
      const trigger = document.querySelector('.moments-feed-pagination');
      const model = new Function('$el', `return (${realExpression});`)(trigger);
      model.$el = trigger;
      model.init();
      const scroller = document.querySelector('.moments-body');
      scroller.scrollTop = 100;
      const pending = new AbortController();
      model.requestController = pending;
      model.loading = true;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new DOMException('fixture quota full', 'QuotaExceededError'); };
      try {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', {
          detail: { intentId: 91, url: '/links' }
        }));
      } finally {
        Storage.prototype.setItem = originalSetItem;
      }
      const snapshot = {
        aborted: pending.signal.aborted,
        loading: model.loading,
        intentId: model.navigationIntentId,
        retryFlag: model.resumePaginationAfterNavigationError
      };
      model.destroy();
      return snapshot;
    }, expression);
    await page.waitForTimeout(0);
    assert.deepEqual(result, { aborted: true, loading: false, intentId: 91, retryFlag: true },
      'a failed optional cache write must still cancel the in-flight pagination request');
    assert.deepEqual(errors, [], 'optional cache failure must not escape as a browser page error');
  } finally {
    await browser.close();
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function createCodeFixture(language, alreadyRendered = false) {
  const code = {
    classList: language ? [`language-${language}`] : [],
    rendered: alreadyRendered,
    parentElement: null,
    closest(selector) {
      return selector === 'shiki-code' && this.rendered ? {} : null;
    }
  };
  const container = {
    insertBefore(host) {
      host.parentElement = this;
    }
  };
  const pre = { tagName: 'PRE', parentElement: container };
  code.parentElement = pre;
  return { code, pre };
}

function verifyShikiBridgeBehavior() {
  const raw = createCodeFixture('js');
  const excluded = createCodeFixture('text');
  const rendered = createCodeFixture('js', true);
  const hosts = [];
  const fakeDocument = {
    createElement(tagName) {
      assert.equal(tagName, 'shiki-code');
      const host = {
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        appendChild(pre) {
          pre.parentElement = this;
          raw.code.parentElement === pre && (raw.code.rendered = true);
          excluded.code.parentElement === pre && (excluded.code.rendered = true);
          rendered.code.parentElement === pre && (rendered.code.rendered = true);
        }
      };
      hosts.push(host);
      return host;
    }
  };
  const fixtureRoot = {
    isConnected: true,
    querySelectorAll(selector) {
      assert.equal(selector, 'pre > code');
      return [raw.code, excluded.code, rendered.code];
    }
  };

  const functionSource = extractFunction(pjaxSource, 'createShikiIncrementalBridge');
  const bridge = new Function('document', `return (${functionSource})();`)(fakeDocument);
  bridge.configure({
    lightTheme: 'configured-light',
    darkTheme: 'configured-dark',
    variant: 'configured-variant',
    fontSize: 'configured-size',
    excludedLanguages: ['text']
  }, 'fixture-config');

  assert.equal(bridge.render(fixtureRoot), 1, 'bridge should render only the new non-excluded raw block');
  assert.equal(bridge.render(fixtureRoot), 0, 'bridge must be idempotent for an already rendered root');
  assert.equal(hosts.length, 1, 'repeat rendering must not create nested shiki-code hosts');
  assert.deepEqual(hosts[0].attributes, {
    'light-theme': 'configured-light',
    'dark-theme': 'configured-dark',
    variant: 'configured-variant',
    'font-size': 'configured-size'
  }, 'bridge must forward the plugin-provided configuration unchanged');
}

const momentsExpression = assertWaterfallContract(
  momentsSource,
  '<div class="moments-feed-pagination"',
  'moments'
);
assert.ok(
  momentsExpression.includes("detail: { source: 'waterfall', root: targetList }")
    && momentsExpression.includes("detail: { source: 'cache', root: targetList }"),
  'Moments updates must identify the local root for incremental Shiki rendering'
);

[
  'readShikiRenderDescriptor(targetDoc)',
  "codeElement.closest('shiki-code')",
  "window.addEventListener('moments:feed-updated'",
  "document.querySelector('[data-app-root=\"moments\"]')",
  'currentMomentsRoot.contains(root)',
  'bridge?.configure?.(config, descriptorKey)',
  'queueShikiBridgeRender(descriptor, root)',
  'runShikiExtraPathRenderer(html, contentContainer)',
  'runShikiExtraPathRenderer(responseText, container)'
].forEach((contract) => {
  assert.ok(pjaxSource.includes(contract), `Shiki bridge missing contract: ${contract}`);
});
assert.doesNotMatch(pjaxSource, /github-(?:light|dark)|one-(?:light|dark)/, 'Shiki bridge must not hard-code theme choices');

verifyShikiBridgeBehavior();
await verifyWaterfallRuntime(momentsExpression, 'moments');
await verifyCacheQuotaFailureInBrowser(momentsExpression);
console.log('Moments waterfall lifecycle and incremental Shiki contracts passed.');
