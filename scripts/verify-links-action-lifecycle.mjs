import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Exercise the real Links owner and its card renderer in a native DOM. Modules
// are fulfilled from disk; every API, including writes, stays in page memory.
const root = path.resolve(new URL('..', import.meta.url).pathname);
const origin = 'https://links-action-lifecycle.test';
const browser = await chromium.launch();
const context = await browser.newContext();
const errors = [];
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort('blockedbyclient');
  if (url.pathname === '/') {
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
  }
  if (route.request().method() !== 'GET' || !url.pathname.startsWith('/src/')) {
    throw new Error(`Unexpected network access: ${route.request().method()} ${url.href}`);
  }
  const filename = path.resolve(root, `.${url.pathname}`);
  assert.ok(filename.startsWith(`${root}/src/`));
  return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(filename, 'utf8') });
});
try {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const results = await page.evaluate(async () => {
    const { registerLinksExplorer } = await import('/src/apps/links/runtime.js');
    let factory;
    registerLinksExplorer({ data(_name, value) { factory = value; } });
    const nativeTimeout = window.setTimeout.bind(window);
    // Keep production's deadline policy, advancing long waits to a bounded
    // real timer so stalled transport and response bodies are practical to test.
    window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, Math.min(delay, 100), ...args);
    const pause = (delay = 0) => new Promise((resolve) => nativeTimeout(resolve, delay));
    const defer = () => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    };
    const check = (value, message) => { if (!value) throw new Error(message); };
    const bounded = (promise) => Promise.race([
      promise,
      new Promise((_resolve, reject) => nativeTimeout(() => reject(new Error('operation never settled within its deadline')), 500))
    ]);
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
      status, headers: { 'Content-Type': 'application/json' }
    });
    const fixture = (id = 'feed-1', overrides = {}) => ({
      id, linkName: 'link-a', url: 'https://source.test/post', title: '原始动态', summary: '正文',
      author: '来源', authorUrl: 'https://source.test/', authorLogo: '',
      publishedAt: '2026-11-16T00:00:00Z', fetchedAt: '', updatedAt: '',
      read: false, favorite: false, readLater: true, ...overrides
    });
    let active;
    async function mount(overrides = {}) {
      const state = { writes: [], items: [fixture('feed-1', overrides)], handleWrite: () => json({}) };
      window.fetch = async (input, options = {}) => {
        const url = new URL(input, location.origin);
        if (url.pathname.endsWith('/users/-')) return json({}, 401);
        if (url.pathname.endsWith('/-/unread-summary')) return state.handleSummary(options.signal);
        if (options.method === 'POST') {
          state.writes.push({ url: url.href, signal: options.signal });
          return state.handleWrite(url, options);
        }
        if (url.pathname.endsWith('/rss/items')) return state.handleRead?.() || json({
          items: state.items, hasNext: false, nextBeforePublishedAt: '', nextBeforeId: ''
        });
        throw new Error(`Unmocked API: ${options.method || 'GET'} ${url.href}`);
      };
      history.replaceState({}, '', '/');
      const rootNode = document.createElement('div');
      rootNode.innerHTML = '<section data-feed-list></section>';
      document.body.replaceChildren(rootNode);
      const owner = factory();
      owner.$root = rootNode;
      owner.$nextTick = (callback) => callback();
      owner.init();
      for (let attempt = 0; owner.capabilityStatus === 'checking' && attempt < 20; attempt++) await pause();
      check(owner.capabilityStatus === 'guest', 'real init must complete with the isolated anonymous response');
      owner.canReadFeed = true;
      owner.activeView = 'friends';
      owner.feedScope = 'all';
      owner.unreadCount = 2;
      check(await owner.replaceFeed(), 'real feed renderer must load the memory fixture');
      state.owner = owner;
      active = owner;
      return state;
    }
    const records = [];
    async function test(label, run) {
      try { await run(); records.push({ label, passed: true }); }
      catch (error) { records.push({ label, passed: false, message: error.message }); }
      finally { active?.destroy(); active = null; }
    }

    await test('pending transport is bounded, aborts, and never retries an uncertain write', async () => {
      const state = await mount();
      const held = defer();
      state.handleWrite = () => held.promise;
      const operation = state.owner.toggleFeedFavorite('feed-1');
      await pause();
      check(await state.owner.toggleFeedFavorite('feed-1') === false, 'pending favorite must reject reentry');
      check(await bounded(operation) === false, 'timeout must return false');
      check(state.owner.isFeedStateBusy('feed-1', 'favorite') === false, 'timeout must clear busy');
      check(state.writes[0].signal?.aborted, 'deadline must abort the real write signal');
      check(/超时/.test(state.owner.feedActionMessage) && /确认/.test(state.owner.feedActionMessage)
        && /刷新/.test(state.owner.feedActionMessage), 'timeout must describe an unconfirmed result and refresh recovery');
      const message = state.owner.feedActionMessage;
      held.resolve(json({}));
      await pause();
      check(state.owner.feedItems[0].favorite === false, 'late success must not change local state');
      check(state.owner.feedActionMessage === message, 'late completion must not overwrite recovery feedback');
      check(await state.owner.toggleFeedFavorite('feed-1') === false, 'uncertain item must require refresh before another write');
      check(state.writes.length === 1, 'timeout must not cause a second POST');
    });

    await test('refresh verifies the affected field without replaying a write or reloading the desktop', async () => {
      const state = await mount();
      state.owner.selectedFeedItemId = 'feed-1';
      state.owner.restoreSelectedFeedItem(false);
      state.handleWrite = () => { throw new TypeError('network interrupted'); };
      await state.owner.toggleFeedFavorite();
      state.items[0].favorite = true;
      check(await state.owner.refreshFeed(), 'an explicit in-window readback must settle');
      check(state.owner.selectedFeedItem.favorite === true, 'show the value received from the server');
      check(state.writes.length === 1, 'readback must not auto-mark as read or remove read-later');
      state.handleWrite = () => json({});
      check(await state.owner.toggleFeedFavorite(), 'accept a new explicit action after verification');
      check(state.writes.length === 2, 'only the user can initiate the next write');
    });

    await test('older, failed, or incomplete readbacks cannot unlock an uncertain action', async () => {
      const state = await mount(), held = defer();
      state.handleRead = () => held.promise;
      const older = state.owner.refreshFeed();
      await pause();
      state.handleWrite = () => { throw new TypeError('offline'); };
      await state.owner.toggleFeedFavorite('feed-1');
      held.resolve(json({ items: state.items }));
      await older;
      for (const read of [null, () => json({}, 503), () => json({ items: [fixture('feed-1', { favorite: undefined })] })]) {
        if (read) { state.handleRead = read; await state.owner.refreshFeed(); }
        check(!await state.owner.toggleFeedFavorite('feed-1'), 'uncertain item stays locked');
        check(state.writes.length === 1, 'never replay an uncertain action');
      }
    });

    await test('refresh finishing before a write disconnects cannot unlock a second POST', async () => {
      const state = await mount();
      let disconnect;
      state.handleWrite = () => new Promise((_resolve, reject) => { disconnect = reject; });
      const pending = state.owner.toggleFeedFavorite('feed-1');
      await pause();
      await state.owner.refreshFeed();
      disconnect(new TypeError('connection lost'));
      await bounded(pending);
      state.handleWrite = () => json({});
      check(!await state.owner.toggleFeedFavorite('feed-1') && state.writes.length === 1,
        'only a read started after the unknown result can authorize the next user write');
    });

    await test('readback on a later page can confirm an item missing from the first refreshed page', async () => {
      const state = await mount();
      state.handleWrite = () => { throw new TypeError('offline'); };
      await state.owner.toggleFeedFavorite('feed-1');
      state.handleRead = () => json({ items: [fixture('feed-2')], hasNext: true, nextBeforeId: 'feed-2' });
      await state.owner.refreshFeed();
      state.handleRead = () => json({ items: [fixture('feed-1', { favorite: true })], hasNext: false });
      await state.owner.loadNextFeed();
      state.handleWrite = () => json({});
      check(await state.owner.toggleFeedFavorite('feed-1'), 'authenticated read of the later page confirms its item');
      check(state.writes.length === 2, 'the sole new write is the explicit action');
    });

    await test('a vanished action target cannot mutate a different selected feed item', async () => {
      const state = await mount();
      state.owner.selectedFeedItemId = 'feed-1';
      state.owner.restoreSelectedFeedItem(false);
      check(!await state.owner.toggleFeedFavorite('removed-item'), 'ignore an action for a stale card');
      check(!await state.owner.setFeedItemState('removed-item', 'read', true), 'require the specific item');
      check(state.writes.length === 0, 'no request for a stale card');
    });

    await test('an older or disposed unread counter cannot replace a newer count or revoke the next view', async () => {
      const state = await mount(), older = defer(), late = defer(), signals = [];
      const replies = [older.promise, json({ totalUnreadCount: 4 }), late.promise];
      state.handleSummary = signal => { signals.push(signal); return replies.shift(); };
      const first = state.owner.refreshUnreadSummary();
      await pause();
      await state.owner.refreshUnreadSummary();
      older.resolve(json({ totalUnreadCount: 99 }));
      await first;
      check(signals[0]?.aborted && state.owner.unreadCount === 4, 'a later count owns the UI');
      const last = state.owner.refreshUnreadSummary();
      await pause();
      state.owner.destroy();
      late.resolve(json({}, 403));
      await last;
      check(signals[2]?.aborted && state.owner.unreadCount === 4 && state.owner.canReadFeed,
        'late permission failure cannot change a disposed view');
    });

    await test('a stalled unread summary releases the request and retains the last count', async () => {
      const state = await mount();
      let signal;
      state.handleSummary = owner => { signal = owner; return defer().promise; };
      await bounded(state.owner.refreshUnreadSummary());
      check(signal?.aborted && state.owner.unreadCount === 2, 'timeout preserves previous unread count');
    });

    await test('a stalled error body is bounded and its late text cannot alter feedback', async () => {
      const state = await mount();
      let body;
      state.handleWrite = () => new Response(new ReadableStream({ start(controller) { body = controller; } }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
      check(await bounded(state.owner.toggleFeedFavorite('feed-1')) === false, 'body deadline must return false');
      check(state.owner.isFeedStateBusy('feed-1', 'favorite') === false, 'body deadline must release busy');
      check(/确认/.test(state.owner.feedActionMessage), 'a body timeout must not claim the mutation failed');
      const message = state.owner.feedActionMessage;
      body.enqueue(new TextEncoder().encode('{"detail":"late server detail"}'));
      body.close();
      await pause();
      check(state.owner.feedActionMessage === message, 'late body must not change the current message');
      check(state.owner.feedItems[0].favorite === false, 'late body must not mutate the item');
    });

    await test('destroy cancels the write and rejects late success without changing the next owner', async () => {
      const state = await mount();
      const held = defer();
      state.handleWrite = () => held.promise;
      const operation = state.owner.toggleFeedRead('feed-1');
      await pause();
      state.owner.destroy();
      check(state.writes[0].signal?.aborted, 'destroy must abort pending write transport');
      check(await bounded(operation) === false, 'destroy must settle the pending action');
      check(!state.owner.isFeedStateBusy('feed-1'), 'destroy must release all busy states');
      const next = await mount();
      const before = next.owner.$root.innerHTML;
      held.resolve(json({}));
      await pause();
      check(state.owner.feedItems[0].read === false && state.owner.unreadCount === 2, 'destroyed owner must retain its prior model');
      check(next.owner.$root.innerHTML === before && next.owner.feedActionMessage === '', 'late old write must not touch the new owner');
    });

    await test('destroy during error-body consumption leaves messages and DOM untouched', async () => {
      const state = await mount();
      let body;
      state.handleWrite = () => new Response(new ReadableStream({ start(controller) { body = controller; } }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      });
      const operation = state.owner.toggleFeedFavorite('feed-1');
      await pause();
      const before = state.owner.$root.innerHTML;
      state.owner.destroy();
      check(await bounded(operation) === false, 'destroy must settle body consumption');
      body.enqueue(new TextEncoder().encode('{"detail":"late permission error"}'));
      body.close();
      await pause();
      check(state.owner.feedActionMessage === '', 'disposed body error must not replace message');
      check(state.owner.$root.innerHTML === before, 'disposed body error must not touch DOM');
      check(!state.owner.isFeedStateBusy('feed-1'), 'disposed body error must not restore busy');
    });

    await test('one item serializes different fields while independent items can proceed', async () => {
      const state = await mount();
      state.items.push(fixture('feed-2'));
      await state.owner.replaceFeed();
      const held = defer();
      state.handleWrite = (url) => url.pathname.includes('/feed-1/') ? held.promise : json({});
      const read = state.owner.toggleFeedRead('feed-1');
      await pause();
      check(state.owner.isFeedStateBusy('feed-1', 'favorite'), 'other fields must expose the same item busy state');
      check(await state.owner.toggleFeedFavorite('feed-1') === false, 'same item must not race fields');
      check(await state.owner.toggleFeedFavorite('feed-2') === true, 'different item must remain available');
      held.resolve(json({}));
      check(await bounded(read) === true, 'original read must commit after success');
      check(state.writes.length === 2, 'only the independent item and original request may write');
      check(state.owner.feedItems[0].read && state.owner.feedItems[1].favorite, 'both accepted actions must commit');
    });

    await test('successful actions update real card semantics, selection, and unread count', async () => {
      const state = await mount();
      state.owner.selectedFeedItemId = 'feed-1';
      state.owner.selectedFeedItem = state.owner.feedItems[0];
      check(await state.owner.toggleFeedFavorite() === true, 'favorite success must return true');
      check(state.owner.selectedFeedItem.favorite === true, 'selection must reflect favorite');
      check(state.owner.$root.querySelector('[data-feed-action="favorite"]').getAttribute('aria-checked') === 'true', 'native card must reflect favorite');
      check(await state.owner.toggleFeedRead() === true, 'read success must return true');
      check(state.owner.unreadCount === 1, 'read transition must decrement unread exactly once');
      check(!state.owner.$root.querySelector('[data-feed-id="feed-1"]').classList.contains('is-unread'), 'native card must reflect read');
      check(await state.owner.toggleFeedReadLater() === true, 'later success must return true');
      check(state.owner.selectedFeedItem.readLater === false, 'selection must reflect later state');
      check(state.writes.every(({ url }) => new URL(url).origin === location.origin), 'writes must retain the same-origin API contract');
      check(state.writes[0].url.endsWith('/feed-1/favorite?favorite=true'), 'favorite must retain its existing endpoint');
      check(state.writes[2].url.endsWith('/feed-1/read-later?readLater=false'), 'later must retain its existing endpoint');
    });

    await test('consume stops after an unconfirmed read and sends no later-field write', async () => {
      const state = await mount();
      state.handleWrite = () => new Promise(() => {});
      await bounded(state.owner.consumeFeedItem(state.owner.feedItems[0]));
      check(state.writes.length === 1, 'a failed or timed-out read must not start the next mutation');
      check(state.owner.feedItems[0].read === false && state.owner.feedItems[0].readLater === true, 'uncertain first step must not change either flag');
    });

    await test('consume preserves the confirmed first field when its second field times out', async () => {
      const state = await mount();
      state.handleWrite = (url) => url.pathname.endsWith('/read') ? json({}) : new Promise(() => {});
      await bounded(state.owner.consumeFeedItem(state.owner.feedItems[0]));
      check(state.writes.length === 2, 'read and later must each be sent once');
      check(state.owner.feedItems[0].read === true && state.owner.feedItems[0].readLater === true, 'confirmed read must remain and uncertain later state must remain unchanged');
      check(state.owner.unreadCount === 1, 'partial success must update unread once');
      check(/确认/.test(state.owner.feedActionMessage), 'partial uncertain result must offer confirmation recovery');
    });

    await test('a gateway error after an applied write requires a protected read before another action', async () => {
      const state = await mount();
      state.handleWrite = () => {
        state.items[0].favorite = true;
        return json({ detail: 'Gateway timeout' }, 504);
      };
      check(!await state.owner.toggleFeedFavorite('feed-1'), 'an error response cannot confirm the write');
      check(/待确认/.test(state.owner.feedActionMessage), 'a gateway cannot attest that the origin did not apply the change');
      check(!await state.owner.toggleFeedFavorite('feed-1') && state.writes.length === 1, 'do not submit the old value again');
      check(await state.owner.refreshFeed() && state.owner.feedItems[0].favorite, 'show the value committed at the origin');
      state.handleWrite = () => json({});
      check(await state.owner.toggleFeedFavorite('feed-1') && state.writes.length === 2, 'allow the opposite action after verification');
      check(new URL(state.writes[1].url).searchParams.get('favorite') === 'false', 'verified action must send the new intent');
    });

    await test('known HTTP failure clears busy and prevents the follow-up consume mutation', async () => {
      const state = await mount();
      state.handleWrite = () => json({ detail: 'Permission denied' }, 403);
      await bounded(state.owner.consumeFeedItem(state.owner.feedItems[0]));
      check(state.writes.length === 1, 'known first-step failure must stop consume');
      check(/HTTP 403/.test(state.owner.feedActionMessage), 'known rejection must retain actionable HTTP feedback');
      check(!state.owner.isFeedStateBusy('feed-1'), 'known failure must release busy');
      state.handleWrite = () => json({});
      check(await state.owner.toggleFeedFavorite('feed-1') === true, 'known rejection must allow a deliberate later action');
    });

    await test('a replacement feed item is not overwritten by an older pending action', async () => {
      const state = await mount();
      const held = defer();
      state.handleWrite = () => held.promise;
      const operation = state.owner.toggleFeedFavorite('feed-1');
      await pause();
      await state.owner.replaceFeed();
      const before = state.owner.$root.innerHTML;
      held.resolve(json({}));
      await bounded(operation);
      check(state.owner.feedItems[0].favorite === false, 'newly loaded item must keep its authoritative state');
      check(state.owner.$root.innerHTML === before, 'old item action must not rewrite replacement card');
      check(!state.owner.isFeedStateBusy('feed-1'), 'superseded action must release its own busy state');
    });
    return records;
  });
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.label}${result.message ? `: ${result.message}` : ''}`);
  assert.deepEqual(errors, [], 'native browser must have no runtime errors');
  assert.equal(results.filter((result) => !result.passed).length, 0, `${results.filter((result) => !result.passed).length} lifecycle checks failed`);
  console.log(`Links action lifecycle: ${results.length}/${results.length} passed; all HTTP mocked, no Halo writes.`);
} finally {
  await context.close();
  await browser.close();
}
