import assert from 'node:assert/strict';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
globalThis.window = {};
const { initColdCommentAnchor } = await import('../src/apps/reader/hydrate.js');
const { initLazyComments, disposeLazyComments } = await import('../src/shell/desktop-shell/runtime/shared/lazy-comment.js');

function fixture({ hash = '#post-comments', visible = false, scrollTop = 0, reason = 'initial-load', hidden = true } = {}) {
  const callbacks = new Map();
  const listeners = new Map();
  let nextFrame = 0;
  const win = {
    location: { hash },
    requestAnimationFrame(callback) { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); }
  };
  globalThis.window = win;
  const scroller = { scrollTop, clientHeight: visible ? 686 : 0 };
  const shell = { style: { display: 'none' }, removeAttribute(name) { assert.equal(name, 'data-comment-hidden'); hidden = false; } };
  const section = {
    isConnected: true, calls: [],
    querySelector(selector) { return selector === '[data-comment-hidden]' && hidden ? shell : null; },
    closest(selector) { assert.equal(selector, '.window-body'); return scroller; },
    getBoundingClientRect() { return { width: visible ? 840 : 0, height: visible ? 58 : 0 }; },
    scrollIntoView(options) { this.calls.push(options); scroller.scrollTop = 3400; }
  };
  const root = {
    querySelector(selector) { assert.equal(selector, '#post-comments'); return section; },
    querySelectorAll() { return [section]; },
    contains(node) { return node === section; }
  };
  const tick = () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback()); };
  return {
    win, callbacks, listeners, section, shell, scroller, root, tick,
    show() { visible = true; scroller.clientHeight = 686; },
    start() { return initColdCommentAnchor(root, { reason }); },
    get hidden() { return hidden; }
  };
}

try {
  // Native hash resolution occurred while the cold window had zero layout.
  const cold = fixture();
  let intersect;
  globalThis.IntersectionObserver = class {
    constructor(callback) { intersect = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  initLazyComments(cold.root);
  const cleanup = cold.start();
  cold.tick();
  assert.equal(cold.section.calls.length, 0);
  assert.equal(cold.hidden, true);
  cold.show(); cold.tick();
  assert.deepEqual(cold.section.calls, [{ behavior: 'auto', block: 'start' }]);
  assert.equal(cold.hidden, true, 'Reader positioning must not bypass the lazy comment controller');
  intersect([{ target: cold.section, isIntersecting: true }]);
  assert.equal(cold.hidden, false);
  assert.equal(cold.shell.style.display, '');
  assert.equal(cold.callbacks.size, 0);
  assert.equal(cold.listeners.size, 0);
  cleanup();
  disposeLazyComments(cold.root);

  for (const hash of ['', '#not-comments', '#%E0%A4%A', '#%']) {
    const page = fixture({ hash });
    page.start()();
    assert.equal(page.callbacks.size, 0);
    assert.equal(page.section.calls.length, 0);
  }
  for (const reason of ['same-variant', 'scene-change', 'history-popstate']) {
    const page = fixture({ reason });
    page.start()();
    assert.equal(page.callbacks.size, 0);
  }
  const encoded = fixture({ hash: '#post%2Dcomments', visible: true });
  encoded.start(); encoded.tick();
  assert.equal(encoded.section.calls.length, 1);

  // Existing native/history scroll wins, including one that lands while waiting.
  const restored = fixture({ visible: true, scrollTop: 300 });
  restored.start()();
  assert.equal(restored.callbacks.size, 0);
  const native = fixture();
  native.start(); native.show(); native.scroller.scrollTop = 400; native.tick();
  assert.equal(native.section.calls.length, 0);
  assert.equal(native.listeners.size, 0);

  for (const event of ['wheel', 'touchstart', 'keydown']) {
    const page = fixture();
    page.start();
    page.listeners.get(event)({ key: 'PageDown' });
    page.show(); page.tick();
    assert.equal(page.section.calls.length, 0);
    assert.equal(page.listeners.size, 0);
  }
  const detached = fixture();
  detached.start(); detached.section.isConnected = false; detached.show(); detached.tick();
  assert.equal(detached.section.calls.length, 0);
  assert.equal(detached.callbacks.size, 0);

  const disposed = fixture();
  const dispose = disposed.start();
  const stale = [...disposed.callbacks.values()][0];
  dispose(); disposed.show(); stale();
  assert.equal(disposed.section.calls.length, 0);
  assert.equal(disposed.listeners.size, 0);

  const replaced = fixture();
  replaced.start();
  const prior = [...replaced.callbacks.values()][0];
  const newerCleanup = replaced.start();
  replaced.show(); prior();
  assert.equal(replaced.section.calls.length, 0);
  replaced.tick();
  assert.equal(replaced.section.calls.length, 1);
  newerCleanup();

  const neverVisible = fixture();
  neverVisible.start();
  for (let index = 0; index < 70; index += 1) neverVisible.tick();
  assert.equal(neverVisible.callbacks.size, 0);
  assert.equal(neverVisible.listeners.size, 0);
  assert.equal(neverVisible.section.calls.length, 0);

  // A different comment provider is already visible and has no lazy shell.
  const generic = fixture({ visible: true, hidden: false });
  generic.start(); generic.tick();
  assert.equal(generic.section.calls.length, 1);
  console.log('verify-reader-comment-anchor passed (cold layout, hash decoding, native/manual scroll, PJAX exclusion, disposal/generation, bounded retries)');
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
  if (previousObserver) Object.defineProperty(globalThis, 'IntersectionObserver', previousObserver);
  else delete globalThis.IntersectionObserver;
}
