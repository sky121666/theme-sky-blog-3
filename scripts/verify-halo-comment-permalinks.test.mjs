import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = {};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
await import('../src/apps/reader/hydrate.js');
const reader = window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.reader;
const { registerPhotosExplorer } = await import('../src/apps/photos/runtime/explorer.js');
const { setupMomentInteractions } = await import('../src/apps/moments/interactions.js');
const { parseCommentPermalink } = await import('../src/shared/comment-permalink.js');
let photosFactory;
registerPhotosExplorer({ data(_name, factory) { photosFactory = factory; } });

class Target {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, event = {}) {
    const dispatched = event.type ? event : { ...event, type };
    [...(this.listeners.get(type) || [])].forEach((handler) => handler(dispatched));
  }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
  listenerCount() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}

class Node extends Target {
  isConnected = true;
  dataset = {};
  style = {};
  hidden = false;
  nodes = new Map();
  classes = new Set();
  scrollCalls = [];
  classList = {
    add: (...names) => names.forEach((name) => this.classes.add(name)),
    remove: (...names) => names.forEach((name) => this.classes.delete(name)),
    contains: (name) => this.classes.has(name),
    toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
  };
  querySelector(selector) { return this.nodes.get(selector) || null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  closest() { return null; }
  contains(node) { return node === this || [...this.nodes.values()].includes(node); }
  removeAttribute(name) { if (name === 'data-comment-hidden') this.commentHidden = false; }
  getBoundingClientRect() { return { width: 800, height: 200, top: 400 }; }
  scrollIntoView(options) { this.scrollCalls.push(options); }
}

function environment(hash = '', pathname = '/post') {
  const win = new Target();
  win.location = { origin: 'https://theme.test', pathname, search: '', hash };
  const frames = new Map();
  let sequence = 0;
  win.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  const doc = new Node();
  doc.body = new Node();
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.Element = Node;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  return {
    win, doc, frames,
    tick() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); },
    change(nextHash, event = 'hashchange') { win.location.hash = nextHash; win.emit(event); }
  };
}

function readerFixture(hash, reason = 'initial-load', { pathname = '/post', pendingTargetUrl } = {}) {
  const env = environment(hash, pathname);
  const root = new Node();
  const pendingTarget = { dataset: { pjaxTargetUrl: pendingTargetUrl } };
  root.closest = (selector) => selector === '[data-pjax-target-url]' && pendingTarget.dataset.pjaxTargetUrl
    ? pendingTarget : null;
  const section = new Node();
  const shell = new Node();
  shell.style.display = 'none';
  shell.commentHidden = true;
  section.nodes.set('[data-comment-hidden]', shell);
  section.closest = () => ({ scrollTop: 0, clientHeight: 600 });
  root.nodes.set('#post-comments', section);
  const cleanup = reader.hydrate(root, { reason });
  return { ...env, root, section, shell, cleanup, pendingTarget };
}

test('Halo permalink reveals reader comments on cold and PJAX entry', () => {
  for (const reason of ['initial-load', 'same-variant', 'scene-change', 'history-popstate']) {
    const page = readerFixture('#halo-comment=comment-a&reply=reply-b', reason);
    try {
      assert.equal(page.shell.style.display, '', `comment shell must open for ${reason}`);
      page.tick();
      assert.equal(page.section.scrollCalls.length, 1);
    } finally { page.cleanup(); }
    assert.equal(page.win.listenerCount(), 0);
  }
});

test('reader follows same-page hashes and history without acting after disposal', () => {
  const page = readerFixture('');
  page.change('#halo-comment=comment-a');
  page.tick();
  assert.equal(page.section.scrollCalls.length, 1);
  page.change('#halo-comment=comment-b&reply=reply-b', 'popstate');
  page.tick();
  assert.equal(page.section.scrollCalls.length, 2);
  page.change('#halo-comment=comment-c');
  const pending = [...page.frames.values()];
  page.cleanup();
  pending.forEach((callback) => callback());
  page.change('#halo-comment=comment-d');
  assert.equal(page.section.scrollCalls.length, 2);
  assert.equal(page.win.listenerCount(), 0);
  assert.equal(page.doc.listenerCount(), 0);
});

test('permalink values decode once and reject ambiguous root or reply values', () => {
  assert.deepEqual(parseCommentPermalink('#halo-comment=comment%2Da&reply=reply%252Db'), { comment: 'comment-a', reply: 'reply%2Db' });
  assert.equal(parseCommentPermalink('#halo-comment=a&reply=x&reply=y'), null);
  assert.equal(parseCommentPermalink('#halo-comment=a&reply=%00'), null);
});

test('reader observes settled History API navigation and deduplicates popstate/hashchange pairs', () => {
  const page = readerFixture('');
  page.win.location.hash = '#halo-comment=comment-a';
  page.doc.emit('theme:navigation-settled');
  page.tick();
  assert.equal(page.section.scrollCalls.length, 1);
  page.win.emit('popstate');
  page.win.emit('hashchange');
  page.tick();
  assert.equal(page.section.scrollCalls.length, 1);
  page.cleanup();
  assert.equal(page.doc.listenerCount(), 0);
});

test('settled History API navigation notifies the official comment component once', () => {
  const page = readerFixture('');
  const observed = [];
  const onLocationChange = () => observed.push(page.win.location.hash);
  page.win.addEventListener('hashchange', onLocationChange);
  try {
    page.win.location.hash = '#halo-comment=comment-a&reply=reply-b';
    page.doc.emit('theme:navigation-settled');
    page.tick();
    assert.deepEqual(observed, ['#halo-comment=comment-a&reply=reply-b'],
      'official widget listens to hashchange/popstate, not the theme settled event');
    assert.equal(page.section.scrollCalls.length, 1, 'the bridge must not position the theme twice');
    page.doc.emit('theme:navigation-settled');
    assert.equal(observed.length, 1, 'an unchanged address must not dispatch again');
    page.win.location.hash = '';
    page.doc.emit('theme:navigation-settled');
    assert.deepEqual(observed, ['#halo-comment=comment-a&reply=reply-b', ''],
      'leaving a detail permalink through History API must restore the official list');
  } finally {
    page.win.removeEventListener('hashchange', onLocationChange);
    page.cleanup();
  }
  assert.equal(page.win.listenerCount(), 0);
});

test('comment location bridge waits for ownership and ignores unrelated fragments or disposed roots', () => {
  const page = readerFixture('#halo-comment=old-comment', 'same-variant', {
    pathname: '/post-a', pendingTargetUrl: '/post-b#halo-comment=comment-b'
  });
  const observed = [];
  const onLocationChange = () => observed.push(page.win.location.hash);
  page.win.addEventListener('hashchange', onLocationChange);
  try {
    page.doc.emit('theme:navigation-settled');
    assert.deepEqual(observed, [], 'the old address must not be announced for a pending root');
    page.win.location.pathname = '/post-b';
    page.win.location.hash = '#halo-comment=comment-b';
    page.doc.emit('theme:navigation-settled');
    assert.deepEqual(observed, ['#halo-comment=comment-b']);
    page.win.location.hash = '#heading';
    page.doc.emit('theme:navigation-settled');
    page.win.location.hash = '#another-heading';
    page.doc.emit('theme:navigation-settled');
    assert.deepEqual(observed, ['#halo-comment=comment-b', '#heading'],
      'ordinary heading navigation is outside the comment bridge');
    page.cleanup();
    page.win.location.hash = '#halo-comment=after-disposal';
    page.doc.emit('theme:navigation-settled');
    assert.equal(observed.length, 2);
  } finally {
    page.win.removeEventListener('hashchange', onLocationChange);
    page.cleanup();
  }
});

test('same-variant hydration before URL commit follows the destination page, not its predecessor', () => {
  const page = readerFixture('', 'same-variant', {
    pathname: '/post-a',
    pendingTargetUrl: 'https://theme.test/post-b?view=full#halo-comment=comment-b'
  });
  try {
    page.tick();
    assert.equal(page.shell.style.display, 'none');
    page.win.location.pathname = '/post-b';
    page.win.location.search = '?view=full';
    page.win.location.hash = '#halo-comment=comment-b';
    delete page.pendingTarget.dataset.pjaxTargetUrl;
    page.doc.emit('theme:navigation-settled');
    page.tick();
    assert.equal(page.shell.style.display, '', 'commit must open the destination comments');
    assert.equal(page.section.scrollCalls.length, 1);
    page.win.emit('popstate');
    page.win.emit('hashchange');
    page.tick();
    assert.equal(page.section.scrollCalls.length, 1, 'commit/hash/popstate must not duplicate positioning');
    page.change('#halo-comment=comment-c');
    page.tick();
    assert.equal(page.section.scrollCalls.length, 2, 'subsequent destination hashes remain observable');
    page.win.location.pathname = '/post-c';
    page.change('#halo-comment=comment-d', 'popstate');
    page.tick();
    assert.equal(page.section.scrollCalls.length, 2, 'a connected old root must not handle a different owner page');
  } finally { page.cleanup(); }
  assert.equal(page.win.listenerCount(), 0);
  assert.equal(page.doc.listenerCount(), 0);
});

test('pending navigation never applies the previous URL fragment to the new root', () => {
  for (const pathname of ['/post-a', '/post-b']) {
    const page = readerFixture('#halo-comment=old-comment', 'same-variant', {
      pathname, pendingTargetUrl: '/post-b#halo-comment=new-comment'
    });
    try {
      page.tick();
      assert.equal(page.shell.style.display, 'none', 'wait for commit even when only the fragment changes');
      assert.equal(page.section.scrollCalls.length, 0);
      page.win.location.pathname = '/post-b';
      page.win.location.hash = '#halo-comment=new-comment';
      delete page.pendingTarget.dataset.pjaxTargetUrl;
      page.doc.emit('theme:navigation-settled');
      page.tick();
      assert.equal(page.shell.style.display, '');
      assert.equal(page.section.scrollCalls.length, 1);
    } finally { page.cleanup(); }
  }
});

test('ordinary and malformed fragments never open the reader comment shell', () => {
  for (const hash of ['#heading', '#reply=r', '#halo-comment=', '#halo-comment=%20', '#halo-comment=%', '#halo-comment=%E0%A4%A', '#halo-comment=a&halo-comment=b', '#halo-comment=a&reply=']) {
    const page = readerFixture(hash);
    try {
      page.tick();
      assert.equal(page.shell.style.display, 'none', hash);
      assert.equal(page.section.scrollCalls.length, 0, hash);
    } finally { page.cleanup(); }
  }
});

test('changed address, manual scroll and detached pages cancel queued comment scrolling', () => {
  for (const cancel of [
    (page) => page.change('#heading'),
    (page) => page.win.emit('wheel'),
    (page) => { page.root.isConnected = false; },
    (page) => { page.win.location.pathname = '/different-post'; page.win.emit('popstate'); }
  ]) {
    const page = readerFixture('#halo-comment=comment-a');
    cancel(page);
    page.tick();
    assert.equal(page.section.scrollCalls.length, 0);
    page.cleanup();
  }
});

function momentFixture(hash, { pathname = '/moments/moment-a', pendingTargetUrl } = {}) {
  const env = environment(hash, pathname);
  const card = new Node();
  const pendingTarget = { dataset: { pjaxTargetUrl: pendingTargetUrl } };
  card.closest = (selector) => selector === '[data-pjax-target-url]' && pendingTarget.dataset.pjaxTargetUrl
    ? pendingTarget : null;
  card.dataset = { momentName: 'moment-a', commentCount: '0', upvoteCount: '0' };
  card.matches = (selector) => ['[data-moment-card]', '.moment-comments--custom'].includes(selector);
  card.hasAttribute = (name) => name === 'data-moment-detail-comments';
  card.ownerDocument = env.doc;
  const custom = new Node();
  const official = new Node();
  official.hidden = true;
  official.style.display = 'none';
  card.nodes.set('[data-moment-comments-panel]', custom);
  card.nodes.set('[data-moment-official-comments]', official);
  const root = new Node();
  root.matches = (selector) => selector === '[data-app-root="moments"]';
  root.nodes.set('.moment-comments--custom', card);
  const requests = [];
  globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ resolve, signal: options.signal }));
  const cleanup = setupMomentInteractions(root);
  return { ...env, root, card, custom, official, requests, cleanup, pendingTarget };
}

test('moment permalink delegates precision to the visible official component without fetching list pages', () => {
  const page = momentFixture('#halo-comment=comment-a&reply=reply-b');
  try {
    assert.equal(page.official.hidden, false);
    assert.equal(page.official.style.display, '');
    assert.equal(page.custom.hidden, true);
    assert.equal(page.requests.length, 0);
    page.change('#moment-comments');
    assert.equal(page.official.hidden, true);
    assert.equal(page.custom.hidden, false);
    assert.equal(page.requests.length, 1);
  } finally { page.cleanup(); }
  assert.equal(page.win.listenerCount(), 0);
});

test('moment permalink cancels stale custom-list work and disposal cancels pending scrolling', async () => {
  const page = momentFixture('');
  assert.equal(page.requests.length, 1);
  page.change('#halo-comment=comment-a');
  assert.equal(page.requests[0].signal.aborted, true);
  page.requests[0].resolve({ ok: true, json: async () => ({ items: [], page: 1, total: 0, hasNext: false }) });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(page.custom.hidden, true);
  assert.equal(page.official.hidden, false);
  const pending = [...page.frames.values()];
  page.cleanup();
  pending.forEach((callback) => callback());
  assert.equal(page.official.scrollCalls.length, 0);
  assert.equal(page.win.listenerCount(), 0);
});

test('switching from a legacy moment anchor cancels its queued positioning', () => {
  const page = momentFixture('#moment-comments');
  const oldFrames = [...page.frames.values()];
  assert.ok(oldFrames.length > 0);
  page.change('#halo-comment=comment-a');
  oldFrames.forEach((callback) => callback());
  assert.equal(page.custom.scrollCalls.length, 0, 'legacy scroll must not override the selected permalink');
  page.cleanup();
});

function photosFixture(hash, { pathname = '/photos/photo-a', pendingTargetUrl, commentsOpen = false } = {}) {
  const env = environment(hash, pathname);
  const explorer = photosFactory();
  explorer.$el = new Node();
  const pendingTarget = { dataset: { pjaxTargetUrl: pendingTargetUrl } };
  explorer.$el.closest = (selector) => selector === '[data-pjax-target-url]' && pendingTarget.dataset.pjaxTargetUrl
    ? pendingTarget : null;
  explorer.commentsOpen = commentsOpen;
  explorer.$nextTick = (callback) => callback();
  for (const method of ['restorePreferences', 'syncEffectiveColCount', '_installSurfaceControls', '_installDetailViewerControls', 'syncChromeControls', 'syncDetailChromeControls', '_installResizeHandler', '_clearLoadingSkeletons', '_releasePhotoPanSession']) explorer[method] = () => {};
  explorer._isCompactSurface = () => false;
  explorer.isDetailView = () => true;
  explorer.init();
  return { ...env, explorer, pendingTarget };
}

test('photo permalink opens the drawer initially and on same-page history; destroy removes listeners', () => {
  const page = photosFixture('#halo-comment=comment-a');
  assert.equal(page.explorer.commentsOpen, true);
  page.change('#heading');
  assert.equal(page.explorer.commentsOpen, false);
  page.change('#halo-comment=comment-b&reply=reply-b', 'popstate');
  assert.equal(page.explorer.commentsOpen, true);
  page.explorer.destroy();
  page.explorer.commentsOpen = false;
  page.change('#halo-comment=comment-c');
  assert.equal(page.explorer.commentsOpen, false);
  assert.equal(page.win.listenerCount(), 0);
});

test('reader preserves the legacy cold comment anchor and cancels it when the fragment changes', () => {
  for (const cancel of [false, true]) {
    const page = readerFixture('#post-comments');
    try {
      if (cancel) page.change('#heading');
      page.tick();
      assert.equal(page.section.scrollCalls.length, cancel ? 0 : 1);
    } finally { page.cleanup(); }
    assert.equal(page.win.listenerCount(), 0);
  }
});

test('comment container positioning waits for visibility and remains bounded when hidden', () => {
  for (const becomesVisible of [false, true]) {
    const page = readerFixture('#halo-comment=comment-a');
    let visible = false;
    page.section.getBoundingClientRect = () => ({ width: visible ? 800 : 0, height: visible ? 200 : 0 });
    try {
      for (let index = 0; index < 5; index += 1) page.tick();
      assert.equal(page.section.scrollCalls.length, 0);
      visible = becomesVisible;
      for (let index = 0; index < 70; index += 1) page.tick();
      assert.equal(page.section.scrollCalls.length, becomesVisible ? 1 : 0);
      assert.equal(page.frames.size, 0, 'hidden containers must not retry indefinitely');
      assert.equal(page.win.listeners.get('wheel')?.size, 0);
      assert.equal(page.win.listeners.get('touchstart')?.size, 0);
      assert.equal(page.win.listeners.get('keydown')?.size, 0);
    } finally { page.cleanup(); }
  }
});

test('malformed reply parameters do not reveal Moments or photo permalink containers', () => {
  for (const hash of ['#halo-comment=a&reply=', '#halo-comment=a&reply=%00', '#halo-comment=a&reply=r&reply=s']) {
    const moment = momentFixture(hash);
    try {
      assert.equal(moment.official.hidden, true, hash);
      assert.equal(moment.custom.hidden, false, hash);
      assert.equal(moment.requests.length, 1, 'invalid permalink retains ordinary comment list');
    } finally { moment.cleanup(); }
    const photo = photosFixture(hash);
    try { assert.equal(photo.explorer.commentsOpen, false, hash); }
    finally { photo.explorer.destroy(); }
  }
});

test('Moments and photos wait for destination URL commit and restore their regular views', () => {
  const moment = momentFixture('#halo-comment=old-comment', {
    pathname: '/moments/old', pendingTargetUrl: '/moments/moment-a#halo-comment=new-comment&reply=new-reply'
  });
  try {
    moment.tick();
    assert.equal(moment.official.hidden, true, 'outgoing target must not open new root');
    moment.win.location.pathname = '/moments/moment-a';
    moment.win.location.hash = '#halo-comment=new-comment&reply=new-reply';
    delete moment.pendingTarget.dataset.pjaxTargetUrl;
    moment.doc.emit('theme:navigation-settled');
    moment.tick();
    assert.equal(moment.official.hidden, false);
    assert.equal(moment.custom.hidden, true);
    assert.equal(moment.official.scrollCalls.length, 1);
    assert.equal(moment.requests.length, 0);
    moment.win.emit('popstate'); moment.win.emit('hashchange'); moment.tick();
    assert.equal(moment.official.scrollCalls.length, 1);
    moment.change('', 'popstate');
    assert.equal(moment.official.hidden, true);
    assert.equal(moment.custom.hidden, false);
    assert.equal(moment.requests.length, 1);
  } finally { moment.cleanup(); }
  const photo = photosFixture('#halo-comment=old-comment', {
    pathname: '/photos/old', pendingTargetUrl: '/photos/photo-a#halo-comment=new-comment'
  });
  try {
    assert.equal(photo.explorer.commentsOpen, false);
    photo.win.location.pathname = '/photos/photo-a';
    photo.win.location.hash = '#halo-comment=new-comment';
    delete photo.pendingTarget.dataset.pjaxTargetUrl;
    photo.doc.emit('theme:navigation-settled');
    assert.equal(photo.explorer.commentsOpen, true);
    photo.change('', 'popstate');
    assert.equal(photo.explorer.commentsOpen, false);
  } finally { photo.explorer.destroy(); }
});

test('photo permalink restores a drawer that was already open and disposal prevents pending commit', () => {
  const open = photosFixture('', { commentsOpen: true });
  try {
    open.change('#halo-comment=comment-a');
    open.change('#heading');
    assert.equal(open.explorer.commentsOpen, true, 'leaving a permalink preserves the prior user choice');
  } finally { open.explorer.destroy(); }
  const pending = photosFixture('', { pendingTargetUrl: '/photos/photo-b#halo-comment=comment-b' });
  pending.explorer.destroy();
  pending.win.location.pathname = '/photos/photo-b';
  pending.win.location.hash = '#halo-comment=comment-b';
  pending.doc.emit('theme:navigation-settled');
  assert.equal(pending.explorer.commentsOpen, false);
  assert.equal(pending.win.listenerCount(), 0);
  assert.equal(pending.doc.listenerCount(), 0);
});

test('legacy Moments positioning follows full address ownership and preserves same-page behavior', () => {
  for (const [locationChange, expectedScrolls] of [
    [{}, 1],
    [{ pathname: '/moments/another-moment' }, 0],
    [{ search: '?view=another' }, 0],
    [{ hash: '#heading' }, 0]
  ]) {
    const page = momentFixture('#moment-comments');
    try {
      Object.assign(page.win.location, locationChange);
      page.win.emit('popstate');
      page.tick();
      assert.equal(page.custom.scrollCalls.length, expectedScrolls,
        `legacy positioning must respect the current page address: ${JSON.stringify(locationChange)}`);
    } finally { page.cleanup(); }
    assert.equal(page.win.listenerCount(), 0);
    assert.equal(page.doc.listenerCount(), 0);
  }
});
