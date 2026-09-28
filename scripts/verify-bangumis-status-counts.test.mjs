import assert from 'node:assert/strict';
import { test } from 'node:test';

const moduleFor = async (name) => import(new URL(`../src/apps/bangumis/status-counts.js?case=${name}`, import.meta.url));
const html = (payload) => `<html><body><script type="application/json" data-bangumi-widget-payload>${JSON.stringify(payload)}</script></body></html>`;
const response = (payload) => ({ ok: true, text: async () => html(payload) });

function rootWithReady(status, total) {
  const badges = [0, 1, 2, 3].map((value) => ({
    dataset: { bangumisStatusCount: String(value), countState: value === status ? 'ready' : 'pending' },
    textContent: value === status ? String(total) : '—',
    title: value === status ? '' : '数量加载中',
    isConnected: true
  }));
  return { isConnected: true, badges, querySelectorAll: () => badges };
}

const badge = (root, status) => root.badges[status];
const requestedStatus = (url) => Number(new URL(url, 'https://example.test').searchParams.get('status'));
const payloadFor = (url, total, overrides = {}) => ({
  typeNum: 2, status: requestedStatus(url), size: 1, total, items: [], ...overrides
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function completesWithin(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('fills only missing status totals with at most two same-origin requests in flight', async () => {
  const { startBangumisStatusCounts } = await moduleFor('concurrency');
  const root = rootWithReady(2, 7);
  const calls = [];
  const fetchPage = (url, options) => {
    const pending = deferred();
    calls.push({ url, options, ...pending });
    return pending.promise;
  };
  const task = startBangumisStatusCounts(root, { typeNum: 2, fetchPage });

  assert.equal(calls.length, 2, 'third request waits until one of the first two completes');
  assert.deepEqual(calls.map((call) => requestedStatus(call.url)), [0, 1]);
  for (const call of calls) {
    const url = new URL(call.url, 'https://example.test');
    assert.equal(url.origin, 'https://example.test');
    assert.equal(url.pathname, '/bangumis');
    assert.equal(url.search, `?typeNum=2&status=${requestedStatus(call.url)}&page=1&size=1`);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  calls[0].resolve(response(payloadFor(calls[0].url, 18)));
  await new Promise((done) => setImmediate(done));
  assert.equal(calls.length, 3, 'one completed request releases exactly one queued slot');
  calls[1].resolve(response(payloadFor(calls[1].url, 4)));
  calls[2].resolve(response(payloadFor(calls[2].url, 0)));
  await task.done;

  assert.deepEqual(root.badges.map((item) => item.textContent), ['18', '4', '7', '0']);
  assert.ok(root.badges.every((item) => item.dataset.countState === 'ready' && item.title === ''));
});

test('HTTP failure and mismatched page identity leave each failed badge unavailable without blocking another', async () => {
  const { startBangumisStatusCounts } = await moduleFor('failures');
  const root = rootWithReady(2, 7);
  const calls = [];
  let retry = false;
  const fetchPage = async (url) => {
    const status = requestedStatus(url);
    calls.push(status);
    if (!retry && status === 1) return { ok: false, status: 503 };
    if (!retry && status === 3) return response(payloadFor(url, 31, { status: 0 }));
    return response(payloadFor(url, 18));
  };
  await startBangumisStatusCounts(root, { typeNum: 2, fetchPage }).done;

  assert.equal(badge(root, 0).textContent, '18');
  assert.equal(badge(root, 0).dataset.countState, 'ready');
  for (const status of [1, 3]) {
    assert.equal(badge(root, status).textContent, '—');
    assert.equal(badge(root, status).dataset.countState, 'failed');
    assert.match(badge(root, status).title, /暂不可用/);
  }
  retry = true;
  const nextRoot = rootWithReady(2, 7);
  await startBangumisStatusCounts(nextRoot, { typeNum: 2, fetchPage }).done;
  assert.deepEqual(calls, [0, 1, 3, 1, 3], 'failed totals are retried while successful totals remain cached');
  assert.equal(badge(nextRoot, 1).textContent, '18');
  assert.equal(badge(nextRoot, 3).textContent, '18');
});

test('a stalled request times out without leaving its badge pending or stopping the other worker', async () => {
  const { startBangumisStatusCounts } = await moduleFor('timeout');
  const root = rootWithReady(2, 7);
  const calls = [];
  const fetchPage = (url, options) => {
    const status = requestedStatus(url);
    calls.push({ status, signal: options.signal });
    if (status === 0) return new Promise(() => {});
    return Promise.resolve(response(payloadFor(url, status + 10)));
  };
  const task = startBangumisStatusCounts(root, { typeNum: 2, fetchPage, timeoutMs: 30 });
  const completed = await completesWithin(task.done, 500);
  assert.equal(completed, true, 'one hung fetch cannot leave the survey pending forever');
  assert.deepEqual(calls.map((call) => call.status), [0, 1, 3]);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(badge(root, 0).dataset.countState, 'failed');
  assert.equal(badge(root, 0).textContent, '—');
  assert.match(badge(root, 0).title, /暂不可用/);
  assert.equal(badge(root, 1).textContent, '11');
  assert.equal(badge(root, 3).textContent, '13');
});

test('cancel aborts active requests and prevents late responses from writing to badges', async () => {
  const { startBangumisStatusCounts } = await moduleFor('cancel');
  const root = rootWithReady(2, 7);
  const calls = [];
  const fetchPage = (url, options) => {
    const pending = deferred();
    calls.push({ url, options, ...pending });
    return pending.promise;
  };
  const task = startBangumisStatusCounts(root, { typeNum: 2, fetchPage });
  assert.equal(calls.length, 2);
  task.cancel();
  assert.equal(await completesWithin(task.done, 100), true, 'cancel finishes without waiting for a stalled fetch');
  for (const call of calls) call.resolve(response(payloadFor(call.url, 99)));
  await new Promise((done) => setImmediate(done));

  assert.equal(calls.length, 2, 'cancelled queue never starts a third request');
  assert.ok(calls.every((call) => call.options.signal.aborted));
  for (const status of [0, 1, 3]) {
    assert.equal(badge(root, status).textContent, '—');
    assert.equal(badge(root, status).dataset.countState, 'pending');
    assert.equal(badge(root, status).title, '数量加载中');
  }
});

test('successful totals use a 60-second cache and the current ready badge replaces its cached value', async () => {
  const { startBangumisStatusCounts } = await moduleFor('cache');
  let time = 1_000;
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    return response(payloadFor(url, { 0: 20, 1: 4, 3: 0 }[requestedStatus(url)]));
  };
  const options = { typeNum: 2, fetchPage, clock: () => time };

  const first = rootWithReady(2, 7);
  await startBangumisStatusCounts(first, options).done;
  assert.equal(calls.length, 3);
  const second = rootWithReady(1, 99);
  await startBangumisStatusCounts(second, options).done;
  assert.equal(calls.length, 3, 'fresh cached totals avoid repeated plugin routes');
  assert.deepEqual(second.badges.map((item) => item.textContent), ['20', '99', '7', '0']);
  const third = rootWithReady(3, 1);
  await startBangumisStatusCounts(third, options).done;
  assert.equal(badge(third, 1).textContent, '99', 'known current route total overwrites old cache');

  time += 60_001;
  const fourth = rootWithReady(2, 8);
  await startBangumisStatusCounts(fourth, options).done;
  assert.equal(calls.length, 6, 'expired missing-status totals are fetched again');
  assert.equal(badge(fourth, 2).textContent, '8');
});
