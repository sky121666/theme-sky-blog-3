import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { registerAuthorPostsExplorer } from '../src/apps/explorer/author/runtime.js';
import { initPostOutline, cleanupPostOutline } from '../src/apps/reader/runtime/post-outline.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function withGlobals(values, run) {
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    await run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

let authorFactory;
registerAuthorPostsExplorer({ data: (_name, factory) => { authorFactory = factory; } });

// A1: A successful public API response must survive quota/security failures in optional storage.
for (const storageFailure of ['QuotaExceededError', 'SecurityError']) {
  let fetchCount = 0;
  const storage = {
    getItem: () => null,
    setItem() { throw new DOMException('storage unavailable', storageFailure); },
  };
  const author = authorFactory();
  author.authorName = 'sample-author';
  await withGlobals({
    window: { sessionStorage: storage },
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          items: [{ metadata: { name: 'moment-11' }, spec: { content: { raw: '成功的瞬间' } } }],
          total: 11,
          totalPages: 2,
        }),
      };
    },
  }, async () => {
    const items = await author.fetchMomentPage(2);
    assert.equal(items?.[0]?.key, 'moment-11', `${storageFailure}: successful content must remain usable`);
    assert.equal(items?.[0]?.title, '成功的瞬间');
    assert.equal(author.momentTotal, 11);
    assert.equal(author.momentTotalPages, 2);
    assert.equal(author.momentLoadError, '', `${storageFailure}: cache writes are not request errors`);
    assert.equal(author.momentFetchController, null, 'completed requests must release their controller');
    assert.equal(fetchCount, 1);
  });
}

await withGlobals({
  window: { sessionStorage: { getItem: () => null } },
  fetch: async () => ({ ok: false, status: 503 }),
}, async () => {
  const author = authorFactory();
  assert.equal(await author.fetchMomentPage(2), null);
  assert.match(author.momentLoadError, /无法加载/, 'real HTTP failures must still show a retryable error');
});

// A2: Exercise the real Alpine initialization and URL persistence, including an empty author's
// explicit posts recovery link. The template contracts below still require Halo render verification.
const authorTemplate = read('templates/modules/browser-explorer/author.html');
assert.match(authorTemplate, /defaultSource=\$\{posts != null and \(posts\.total > 0 or posts\.page > 1\)/,
  'an empty out-of-range items array must not select Moments by default');
assert.match(authorTemplate, /data-author-return-first[\s\S]*?\?source=posts/,
  'first-page recovery must retain the article source for an author with no articles');
assert.match(authorTemplate, /data-author-return-last[\s\S]*?posts\.totalPages/,
  'last-page recovery must use the known final page rather than decrementing page 999');
assert.match(authorTemplate, /th:if="\$\{posts != null and !#lists\.isEmpty\(posts\.items\) and \(posts\.hasPrevious\(\) or posts\.hasNext\(\)\)\}"/,
  'ordinary pagination must not offer page 998 from an empty page 999');

for (const scenario of [
  { name: 'overflow with articles', defaultSource: 'posts', postTotal: 51, search: '', expected: 'posts', pathname: '/authors/sample/page/999' },
  { name: 'overflow without articles', defaultSource: 'posts', postTotal: 0, search: '', expected: 'posts', pathname: '/authors/sample/page/999' },
  { name: 'empty author with Moments', defaultSource: 'moments', postTotal: 0, search: '', expected: 'moments', pathname: '/authors/sample' },
  { name: 'explicit first-page article recovery', defaultSource: 'moments', postTotal: 0, search: '?source=posts', expected: 'posts', pathname: '/authors/sample' },
  { name: 'explicit Moments selection', defaultSource: 'posts', postTotal: 51, search: '?source=moments', expected: 'moments', pathname: '/authors/sample/page/999' },
]) {
  const location = new URL(`https://theme.test${scenario.pathname}${scenario.search}`);
  const windowMock = {
    location,
    addEventListener() {},
    removeEventListener() {},
    history: {
      state: { uid: 'existing-pjax-state' },
      replaceState(state, _title, nextUrl) {
        this.state = state;
        windowMock.location = new URL(nextUrl);
      },
    },
  };
  await withGlobals({ window: windowMock }, async () => {
    const author = authorFactory();
    author.$root = {
      dataset: { defaultSource: scenario.defaultSource, postTotal: String(scenario.postTotal), momentsEnabled: 'true' },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    await author.init();
    assert.equal(author.activeSource, scenario.expected, scenario.name);
    assert.equal(windowMock.location.pathname, scenario.pathname, 'initialization must not silently change the article page');
    assert.equal(windowMock.history.state.uid, 'existing-pjax-state');
    if (scenario.name === 'explicit first-page article recovery') {
      assert.equal(windowMock.location.searchParams.get('source'), 'posts', 'reloading recovery must stay on articles');
    }
    author.destroy();
  });
}

// A3: Run the actual shared gateway script against each password control.
const common = read('templates/gateway_fragments/common.html');
const gatewayScript = common.match(/<script th:inline="javascript">([\s\S]*?)<\/script>/)?.[1];
assert.ok(gatewayScript, 'shared gateway helper script must be present');
for (const [path, expectedCount] of [
  ['templates/login_local.html', 1],
  ['templates/gateway_fragments/signup.html', 2],
  ['templates/gateway_fragments/password_reset_email_reset.html', 2]
]) {
  const template = read(path);
  const buttonMarkup = [...template.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((markup) => /\bclass="[^"]*\bauth-toggle-password\b/.test(markup));
  assert.equal(buttonMarkup.length, expectedCount, `${path}: every password field needs a visibility control`);
  const buttons = buttonMarkup.map((markup) => {
    const attributes = new Map([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    assert.equal(attributes.get('type'), 'button');
    assert.ok(!attributes.has('tabindex') || Number(attributes.get('tabindex')) >= 0, 'password toggle must be in the native keyboard tab order');
    assert.ok(attributes.get('aria-label'), 'password toggle needs an accessible name');
    assert.equal(attributes.get('aria-pressed'), 'false');
    const input = { type: 'password', id: attributes.get('aria-controls'), name: attributes.get('aria-controls'), value: 'unchanged-value' };
    assert.ok(template.includes(`id="${input.id}"`), 'aria-controls must reference the corresponding password field');
    const showIcon = { style: {} };
    const hideIcon = { style: {} };
    const button = new EventTarget();
    button.setAttribute = (name, value) => attributes.set(name, String(value));
    button.closest = () => ({ querySelector: (selector) => ({ input, '.auth-icon-eye-show': showIcon, '.auth-icon-eye-hide': hideIcon })[selector] });
    return { button, attributes, input, showIcon, hideIcon };
  });
  const documentMock = new EventTarget();
  documentMock.querySelectorAll = () => buttons.map(({ button }) => button);
  vm.runInNewContext(gatewayScript, { document: documentMock, window: {} });
  documentMock.dispatchEvent(new Event('DOMContentLoaded'));
  for (const { button, attributes, input, showIcon, hideIcon } of buttons) {
    const label = attributes.get('aria-label');
    const name = input.name;
    button.dispatchEvent(new Event('click'));
    assert.equal(input.type, 'text');
    assert.equal(attributes.get('aria-pressed'), 'true', 'screen readers must receive the revealed state');
    assert.equal(showIcon.style.display, 'none');
    assert.equal(hideIcon.style.display, 'block');
    button.dispatchEvent(new Event('click'));
    assert.equal(input.type, 'password');
    assert.equal(attributes.get('aria-pressed'), 'false');
    assert.equal(attributes.get('aria-label'), label, 'toggle names stay stable while pressed state changes');
    assert.equal(input.name, name, 'visibility must not alter the authentication field name');
    assert.equal(input.value, 'unchanged-value', 'visibility must not alter the password value');
  }
}

// A4: Minimal DOM objects track actual listener attachment/removal, active headings and observers.
class OutlineNode {
  constructor() {
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.style = { removeProperty() {} };
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  setAttribute() {}
  removeAttribute() {}
  appendChild(child) { this.children.push(child); }
  set innerHTML(_value) { this.children = []; }
  querySelectorAll() { return this.children; }
  listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

async function verifyOutline({ hash, observerFails = false, scrollRestore = false, cancelBeforeRestore = false }) {
  const encodedId = '%E5%9B%9B%E7%BA%A7%E6%A0%87%E9%A2%98';
  const headings = ['first', '中文', encodedId]
    .map((id) => Object.assign(new OutlineNode(), { id, textContent: id, tagName: 'H2' }));
  const scroller = Object.assign(new OutlineNode(), { scrollTop: 0, clientHeight: 500, isConnected: true });
  let scrollIntoViewCount = 0;
  if (scrollRestore) {
    headings.forEach((heading) => {
      heading.isConnected = true;
      heading.closest = (selector) => selector === '[data-window-scroll]' ? scroller : null;
      heading.getBoundingClientRect = () => ({ width: 200, height: 24 });
      heading.scrollIntoView = () => { scrollIntoViewCount += 1; scroller.scrollTop = 1644; };
    });
  }
  const frame = new OutlineNode();
  const article = new OutlineNode();
  article.children = headings;
  article.querySelector = (selector) => headings.find((heading) => selector === `#${heading.id}`);
  const outline = new OutlineNode();
  const list = new OutlineNode();
  const mobileNodes = new Map(['trigger', 'mobile-sheet', 'mobile-backdrop', 'mobile-list', 'mobile-handle']
    .map((name) => [`[data-post-outline-${name}]`, new OutlineNode()]));
  const windowMock = new OutlineNode();
  windowMock.location = { hash };
  const pendingFrames = new Map();
  let frameId = 0;
  windowMock.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    pendingFrames.set(id, callback);
    return id;
  };
  windowMock.cancelAnimationFrame = (id) => pendingFrames.delete(id);
  let disconnectCount = 0;
  class ObserverMock {
    observe() { if (observerFails) throw new Error('observer setup failed'); }
    disconnect() { disconnectCount += 1; }
  }
  windowMock.IntersectionObserver = ObserverMock;
  const root = { querySelector: (selector) => ({ '.post-reader-frame': frame, '#article-content': article, '[data-post-outline]': outline, '[data-post-outline-list]': list })[selector] ?? null };
  const documentMock = {
    body: new OutlineNode(),
    querySelector: (selector) => mobileNodes.get(selector) ?? null,
    querySelectorAll: () => [],
    createElement: () => new OutlineNode(),
  };
  const eventTargets = [list, windowMock, ...mobileNodes.values()];
  await withGlobals({ window: windowMock, document: documentMock, CSS: { escape: (value) => value }, IntersectionObserver: ObserverMock }, async () => {
    try {
      if (observerFails) {
        assert.throws(() => initPostOutline(root), /observer setup failed/);
        assert.equal(eventTargets.reduce((total, target) => total + target.listenerCount(), 0), 0,
          'partial initialization must immediately remove desktop and mobile listeners');
      } else {
        assert.doesNotThrow(() => initPostOutline(root), 'malformed hashes must not abort outline initialization');
        const active = list.children.filter((button) => button.classes.has('is-active'));
        const expected = hash === '#%E4%B8%AD%E6%96%87' ? '中文'
          : hash.toUpperCase() === `#${encodedId}` ? encodedId : 'first';
        assert.deepEqual(active.map((button) => button.dataset.targetId), [expected]);
        if (scrollRestore) {
          assert.equal(pendingFrames.size, 1, 'a cold anchor must schedule internal scroll restoration');
          if (cancelBeforeRestore) {
            for (const listener of windowMock.listeners.get('wheel') || []) listener();
            assert.equal(pendingFrames.size, 0, 'user wheel input must cancel pending restoration');
          } else {
            const [[id, callback]] = pendingFrames;
            pendingFrames.delete(id);
            callback();
            assert.equal(scrollIntoViewCount, 1, 'restoration must scroll the matched heading exactly once');
            assert.equal(scroller.scrollTop, 1644);
          }
          assert.equal(scrollIntoViewCount, cancelBeforeRestore ? 0 : 1);
        }
        assert.ok(eventTargets.reduce((total, target) => total + target.listenerCount(), 0) > 0);
      }
      cleanupPostOutline();
      assert.equal(eventTargets.reduce((total, target) => total + target.listenerCount(), 0), 0,
        'cleanup must remove all desktop and mobile event listeners');
      assert.equal(disconnectCount, 1, 'observer must disconnect once after either success or setup failure');
      cleanupPostOutline();
      assert.equal(disconnectCount, 1, 'cleanup must be idempotent');
    } finally {
      cleanupPostOutline();
    }
  });
}

await verifyOutline({ hash: '#%' });
await verifyOutline({ hash: '#%E4%B8%AD%E6%96%87' });
await verifyOutline({ hash: '#%E5%9B%9B%E7%BA%A7%E6%A0%87%E9%A2%98', scrollRestore: true });
await verifyOutline({ hash: '#%e5%9b%9b%e7%ba%a7%e6%a0%87%e9%a2%98', scrollRestore: true });
await verifyOutline({ hash: '#%e5%9b%9b%e7%ba%a7%e6%a0%87%e9%a2%98', scrollRestore: true, cancelBeforeRestore: true });
await verifyOutline({ hash: '#missing' });
await verifyOutline({ hash: '#first', observerFails: true });

// A5: Generated Reader anchors must not steal an existing article target.
async function verifyOutlineIds({ headings, otherIds = [], expectedIds }) {
  const nodes = [
    ...headings.map(({ id = '', text }) => Object.assign(new OutlineNode(), { id, textContent: text, tagName: 'H2' })),
    ...otherIds.map((id) => Object.assign(new OutlineNode(), { id, tagName: 'DIV' })),
  ];
  const article = new OutlineNode();
  article.children = nodes.filter((node) => node.tagName === 'H2');
  const list = new OutlineNode();
  const frame = new OutlineNode();
  const outline = new OutlineNode();
  const root = {
    querySelector: (selector) => ({
      '.post-reader-frame': frame,
      '#article-content': article,
      '[data-post-outline]': outline,
      '[data-post-outline-list]': list,
    })[selector] ?? null,
  };
  const documentMock = {
    body: new OutlineNode(),
    querySelector: () => null,
    querySelectorAll: (selector) => selector === '[id]'
      ? nodes.filter((node) => node.id)
      : selector.startsWith('#') ? nodes.filter((node) => node.id === selector.slice(1)) : [],
    createElement: () => new OutlineNode(),
  };
  const windowMock = Object.assign(new OutlineNode(), { location: { hash: '' } });

  await withGlobals({ window: windowMock, document: documentMock, CSS: { escape: (value) => value } }, async () => {
    try {
      initPostOutline(root);
      assert.deepEqual(article.children.map((heading) => heading.id), expectedIds,
        'the Reader outline must assign unique IDs without changing an existing anchor target');
      assert.deepEqual(list.children.map((button) => button.dataset.targetId), expectedIds,
        'outline buttons must point at the corresponding headings');
    } finally {
      cleanupPostOutline();
    }
  });
}

await verifyOutlineIds({
  headings: [{ text: 'Shared' }],
  otherIds: ['shared'],
  expectedIds: ['shared-1'],
});
await verifyOutlineIds({
  headings: [{ text: 'Shared' }, { id: 'shared', text: 'Later explicit target' }],
  expectedIds: ['shared-1', 'shared'],
});
await verifyOutlineIds({
  headings: [{ id: 'chapter', text: 'Chapter' }],
  otherIds: ['chapter'],
  expectedIds: ['chapter-1'],
});
await verifyOutlineIds({
  headings: [{ id: 'chapter', text: 'First' }, { id: 'chapter', text: 'Second' }],
  expectedIds: ['chapter-1', 'chapter-2'],
});

console.log('verify-core-page-regressions passed (A1 storage/HTTP, A2 source recovery, A3 password visibility, A4 hash/scroll/cleanup, A5 outline ID reservation)');
