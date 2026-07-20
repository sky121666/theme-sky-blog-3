import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const momentsPath = path.join(root, 'templates/modules/moments-app/list.html');
const friendsPath = path.join(root, 'templates/modules/friends-app/list.html');
const pjaxPath = path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/index.js');

const momentsSource = fs.readFileSync(momentsPath, 'utf8');
const friendsSource = fs.readFileSync(friendsPath, 'utf8');
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
    'new AbortController()',
    'signal: controller.signal',
    'if (!res.ok)',
    'generation !== this.generation',
    'requestPath !== this.currentPath()',
    'requestUrl !== this.nextUrl',
    'this.appRoot() !== appRoot',
    'this.feedList() !== targetList',
    'this.requestController?.abort()',
    "document.addEventListener('pjax:send', this._onPjaxSend)",
    "document.addEventListener('pjax:same-variant-send', this._onPjaxSend)",
    "document.addEventListener('pjax:error', this._onPjaxError)",
    "document.addEventListener('pjax:complete', this._onPjaxComplete)",
    "document.addEventListener('pjax:same-variant-complete', this._onPjaxComplete)",
    "document.removeEventListener('pjax:send', this._onPjaxSend)",
    "document.removeEventListener('pjax:same-variant-send', this._onPjaxSend)",
    "document.removeEventListener('pjax:error', this._onPjaxError)",
    "document.removeEventListener('pjax:complete', this._onPjaxComplete)",
    "document.removeEventListener('pjax:same-variant-complete', this._onPjaxComplete)",
    "this.$el.closest('[data-app-root]')",
    `root.dataset.appRoot === '${appId}'`,
    'const targetList = this.feedList()',
    "loadError = '\u52a0\u8f7d\u5931\u8d25\uff0c\u70b9\u51fb\u91cd\u8bd5'"
  ];

  required.forEach((contract) => {
    assert.ok(expression.includes(contract), `${appId} missing lifecycle contract: ${contract}`);
  });

  assert.ok(
    expression.split('this.cancelPending();').length >= 3,
    `${appId} must abort from both PJAX send and destroy`
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
    emit(type) {
      Array.from(listeners.get(type) || []).forEach((listener) => listener({ type }));
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
    assert.equal(eventDocument.listenerCount('pjax:error'), 1, `${appId} should listen for failed navigation recovery`);

    const pendingLoad = model.loadNext();
    assert.equal(model.loading, true, `${appId} should enter a loading state before navigation`);
    eventDocument.emit('pjax:send');
    assert.equal(abortedSignal?.aborted, true, `${appId} should abort pagination on PJAX send`);
    assert.equal(model.loading, false, `${appId} should release loading when navigation takes ownership`);
    await pendingLoad;

    eventDocument.emit('pjax:error');
    assert.equal(model.loadError, '加载失败，点击重试', `${appId} should expose retry after PJAX leaves the page in place`);
    assert.equal(model.hasMore, true, `${appId} navigation failure must not masquerade as end-of-list`);

    model.resumeAfterNavigationError = true;
    eventDocument.emit('pjax:complete');
    assert.equal(model.resumeAfterNavigationError, false, `${appId} successful PJAX completion should clear deferred recovery`);
    model.resumeAfterNavigationError = true;
    eventDocument.emit('pjax:same-variant-complete');
    assert.equal(model.resumeAfterNavigationError, false, `${appId} successful same-variant completion should clear deferred recovery`);

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
    assert.equal(model.loadError, '', `${appId} retry should clear the navigation error`);
    assert.equal(model.hasMore, false, `${appId} retry should accept a valid terminal page`);

    model.destroy();
    assert.equal(eventDocument.listenerCount('pjax:send'), 0, `${appId} destroy should remove the PJAX send listener`);
    assert.equal(eventDocument.listenerCount('pjax:error'), 0, `${appId} destroy should remove the PJAX error listener`);
    assert.equal(eventDocument.listenerCount('pjax:complete'), 0, `${appId} destroy should remove the PJAX complete listener`);
    assert.equal(eventDocument.listenerCount('pjax:same-variant-complete'), 0, `${appId} destroy should remove the same-variant complete listener`);
  } finally {
    previousGlobals.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
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
const friendsExpression = assertWaterfallContract(
  friendsSource,
  '<div class="friends-feed-pagination moments-feed-pagination"',
  'friends'
);

assert.ok(
  momentsExpression.includes("detail: { source: 'waterfall', root: targetList }")
    && momentsExpression.includes("detail: { source: 'cache', root: targetList }"),
  'Moments updates must identify the local root for incremental Shiki rendering'
);

const friendsCatch = friendsExpression.match(/catch \(error\) \{([\s\S]*?)\n\s*\} finally/)?.[1] || '';
assert.ok(friendsCatch.includes("this.loadError = '\u52a0\u8f7d\u5931\u8d25\uff0c\u70b9\u51fb\u91cd\u8bd5'"), 'Friends errors must expose retry state');
assert.equal(friendsCatch.includes('this.hasMore = false'), false, 'Friends errors must not masquerade as end-of-list');

[
  'readShikiRenderDescriptor(targetDoc)',
  "codeElement.closest('shiki-code')",
  "window.addEventListener('moments:feed-updated'",
  "document.querySelector('[data-app-root=\"moments\"]')",
  'currentMomentsRoot.contains(root)',
  'bridge?.configure?.(config, descriptorKey)',
  'queueShikiBridgeRender(descriptor, root)',
  'runShikiExtraPathRenderer(html, contentContainer)',
  'runShikiExtraPathRenderer(event?.request?.responseText, container)'
].forEach((contract) => {
  assert.ok(pjaxSource.includes(contract), `Shiki bridge missing contract: ${contract}`);
});
assert.doesNotMatch(pjaxSource, /github-(?:light|dark)|one-(?:light|dark)/, 'Shiki bridge must not hard-code theme choices');

verifyShikiBridgeBehavior();
await verifyWaterfallRuntime(momentsExpression, 'moments');
await verifyWaterfallRuntime(friendsExpression, 'friends');

console.log('Waterfall lifecycle and incremental Shiki contracts passed.');
