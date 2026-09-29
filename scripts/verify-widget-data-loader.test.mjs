import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDesktopWidgetDataLoader,
  ensureDesktopWidgetData
} from '../src/shell/desktop-shell/runtime/widgets/data-loader.js';
import {
  DESKTOP_WIDGET_PROTOCOL_EVENT,
  installDesktopWidgetProtocol
} from '../src/shell/desktop-shell/runtime/widgets/protocol.js';

const homePayload = (name = 'loaded-post') => ({
  enabled: true,
  isHome: true,
  siteUrl: 'https://public.example.test/blog/?view=desktop',
  sources: { hydrated: true, latestPosts: [{ metadata: { name } }] }
});
const responseHtml = (payload) => '<html><body><script>throw new Error("must not execute");</script>'
  + `<script type="application/json" data-theme-desktop-widget-protocol>${JSON.stringify(payload)}</script></body></html>`;
const responseFor = (payload = homePayload()) => new Response(responseHtml(payload));

function testWindow() {
  const target = new EventTarget();
  target.location = { origin: 'https://preview.example.test', pathname: '/links' };
  target.CustomEvent = CustomEvent;
  target.__THEME_DESKTOP_PROTOCOL__ = { widgets: {
    enabled: true,
    isHome: false,
    siteUrl: 'https://public.example.test/blog/?view=desktop',
    sources: { hydrated: false, latestPosts: [] }
  } };
  target.__THEME_WIDGETS__ = target.__THEME_DESKTOP_PROTOCOL__.widgets;
  return target;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const firstPost = (protocol) => protocol.sources.latestPosts[0].metadata.name;

test('concurrent callers fetch one same-origin home page and publish its inert protocol once', async () => {
  const target = testWindow();
  const pending = deferred();
  const calls = [];
  const events = [];
  target.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, (event) => events.push(event.detail.protocol));
  const load = createDesktopWidgetDataLoader(target, { fetchImpl: (url, options) => {
    calls.push({ url, options });
    return pending.promise;
  } });

  const first = load();
  const second = load();
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/blog/?view=desktop');
  assert.equal(new URL(calls[0].url, target.location.origin).origin, 'https://preview.example.test');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers.Accept, 'text/html');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  pending.resolve(responseFor());
  const protocols = await Promise.all([first, second]);
  assert.equal(firstPost(protocols[0]), 'loaded-post');
  assert.equal(protocols[1], protocols[0]);
  assert.equal(target.__THEME_WIDGETS__, protocols[0]);
  assert.equal(target.__THEME_DESKTOP_PROTOCOL__.widgets, protocols[0]);
  assert.deepEqual(events, [protocols[0]]);
});

test('already hydrated sources are reused without fetching or dispatching again', async () => {
  const target = testWindow();
  const protocol = installDesktopWidgetProtocol(homePayload('cached-post'), target);
  let calls = 0;
  let events = 0;
  target.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, () => { events += 1; });
  const load = createDesktopWidgetDataLoader(target, { fetchImpl: async () => { calls += 1; return responseFor(); } });
  assert.equal(await load(), protocol);
  assert.equal(await load(), protocol);
  assert.equal(calls, 0);
  assert.equal(events, 0);
});

test('missing, malformed, non-web and network-path home URLs safely fall back to the same-origin root', async () => {
  for (const siteUrl of ['', 'http://[invalid', 'javascript:alert(1)', 'https://public.example.test//outside.example.test/']) {
    const target = testWindow();
    target.__THEME_WIDGETS__.siteUrl = siteUrl;
    const calls = [];
    const load = createDesktopWidgetDataLoader(target, { fetchImpl: async (url) => {
      calls.push(url);
      return responseFor();
    } });
    await load();
    assert.deepEqual(calls, ['/']);
    assert.equal(new URL(calls[0], target.location.origin).origin, 'https://preview.example.test');
  }
});

test('one caller cancelling does not abort the request needed by another caller', async () => {
  const target = testWindow();
  const pending = deferred();
  let requestSignal;
  const load = createDesktopWidgetDataLoader(target, { fetchImpl: (_url, options) => {
    requestSignal = options.signal;
    return pending.promise;
  } });
  const firstController = new AbortController();
  const first = load({ signal: firstController.signal });
  const second = load();
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  await nextTurn();
  firstController.abort();
  await cancelled;
  assert.equal(requestSignal.aborted, false);
  pending.resolve(responseFor());
  assert.equal(firstPost(await second), 'loaded-post');
});

test('all callers cancelling aborts the shared request and a later call starts a fresh one', async () => {
  const target = testWindow();
  const calls = [];
  const load = createDesktopWidgetDataLoader(target, { fetchImpl: (_url, options) => {
    const pending = deferred();
    calls.push({ ...pending, signal: options.signal });
    return pending.promise;
  } });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = load({ signal: firstController.signal });
  const second = load({ signal: secondController.signal });
  const firstCancelled = assert.rejects(first, { name: 'AbortError' });
  const secondCancelled = assert.rejects(second, { name: 'AbortError' });
  await nextTurn();
  firstController.abort();
  secondController.abort();
  await Promise.all([firstCancelled, secondCancelled]);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(target.__THEME_WIDGETS__.sources.hydrated, false);

  const retry = load();
  await nextTurn();
  assert.equal(calls.length, 2);
  calls[0].resolve(responseFor(homePayload('cancelled-post')));
  await nextTurn();
  assert.equal(target.__THEME_WIDGETS__.sources.hydrated, false, 'late cancelled response must not install data');
  calls[1].resolve(responseFor(homePayload('retry-post')));
  assert.equal(firstPost(await retry), 'retry-post');
});

test('an already aborted caller cannot start or join a request', async () => {
  let calls = 0;
  const load = createDesktopWidgetDataLoader(testWindow(), { fetchImpl: async () => { calls += 1; return responseFor(); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(load({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('a hung response times out for every consumer and can be retried', async () => {
  const target = testWindow();
  const calls = [];
  const pending = deferred();
  const load = createDesktopWidgetDataLoader(target, { timeoutMs: 25, fetchImpl: (_url, options) => {
    calls.push(options);
    return calls.length === 1 ? pending.promise : Promise.resolve(responseFor(homePayload('after-timeout')));
  } });
  await Promise.all([
    assert.rejects(load(), { name: 'TimeoutError' }),
    assert.rejects(load(), { name: 'TimeoutError' })
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  const protocol = await load();
  assert.equal(firstPost(protocol), 'after-timeout');
  pending.resolve(responseFor(homePayload('timed-out-post')));
  await nextTurn();
  assert.equal(target.__THEME_WIDGETS__, protocol);
});

test('timeout also covers reading the response body', async () => {
  const target = testWindow();
  const body = deferred();
  let signal;
  const load = createDesktopWidgetDataLoader(target, { timeoutMs: 25, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return { ok: true, text: () => body.promise };
  } });
  await assert.rejects(load(), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
  body.resolve(responseHtml(homePayload('late-body')));
  await nextTurn();
  assert.equal(target.__THEME_WIDGETS__.sources.hydrated, false);
});

for (const [label, fail] of [
  ['HTTP error', async () => new Response('unavailable', { status: 503 })],
  ['network error', async () => { throw new Error('offline'); }],
  ['missing protocol', async () => new Response('<html><body>no protocol</body></html>')],
  ['malformed JSON', async () => new Response('<script type="application/json" data-theme-desktop-widget-protocol>{broken}</script>')],
  ['non-home protocol', async () => responseFor({ ...homePayload(), isHome: false })],
  ['unhydrated protocol', async () => responseFor({ ...homePayload(), sources: { hydrated: false } })]
]) {
  test(`${label} rejects without changing installed data and the next call retries`, async () => {
    const target = testWindow();
    const before = target.__THEME_WIDGETS__;
    let calls = 0;
    let events = 0;
    target.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, () => { events += 1; });
    const load = createDesktopWidgetDataLoader(target, { fetchImpl: (...args) => {
      calls += 1;
      return calls === 1 ? fail(...args) : Promise.resolve(responseFor(homePayload('recovered-post')));
    } });
    await assert.rejects(load());
    assert.equal(target.__THEME_WIDGETS__, before);
    assert.equal(events, 0);
    assert.equal(firstPost(await load()), 'recovered-post');
    assert.equal(calls, 2);
    assert.equal(events, 1);
  });
}

test('a protocol hydrated by PJAX wins over an older background response', async () => {
  const target = testWindow();
  const body = deferred();
  let events = 0;
  target.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, () => { events += 1; });
  const load = createDesktopWidgetDataLoader(target, { fetchImpl: async () => ({ ok: true, text: () => body.promise }) });
  const pending = load();
  await nextTurn();
  const newer = installDesktopWidgetProtocol(homePayload('newer-pjax-post'), target);
  body.resolve(responseHtml(homePayload('old-background-post')));
  assert.equal(await pending, newer);
  assert.equal(firstPost(target.__THEME_WIDGETS__), 'newer-pjax-post');
  assert.equal(events, 0, 'the older request must not publish another hydration event');
});

test('the default entry shares one loader per window and never shares data between windows', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const firstTarget = testWindow();
  const secondTarget = testWindow();
  const pending = deferred();
  let firstCalls = 0;
  let secondCalls = 0;
  firstTarget.fetch = () => { firstCalls += 1; return pending.promise; };
  secondTarget.fetch = async () => { secondCalls += 1; return responseFor(homePayload('second-window')); };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: firstTarget });
    const first = ensureDesktopWidgetData();
    const duplicate = ensureDesktopWidgetData();
    await nextTurn();
    assert.equal(firstCalls, 1);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: secondTarget });
    assert.equal(firstPost(await ensureDesktopWidgetData()), 'second-window');
    assert.equal(secondCalls, 1);
    assert.equal(firstTarget.__THEME_WIDGETS__.sources.hydrated, false);
    pending.resolve(responseFor(homePayload('first-window')));
    const protocols = await Promise.all([first, duplicate]);
    assert.equal(protocols[0], protocols[1]);
    assert.equal(firstPost(protocols[0]), 'first-window');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
