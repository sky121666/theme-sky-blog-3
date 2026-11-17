import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';

const moduleUrl = new URL('../src/shared/request-deadline.js', import.meta.url);
const runtime = await import(moduleUrl).catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes(moduleUrl.pathname)) throw error;
  return {};
});
function run(work, options) {
  assert.equal(typeof runtime.withRequestDeadline, 'function', 'bounded request consumption is not implemented');
  return runtime.withRequestDeadline(work, options);
}

test('a completed read returns its data and does not later abort its signal', async () => {
  let owned;
  const result = await run(async signal => { owned = signal; return { items: [1] }; }, { timeoutMs: 20 });
  assert.deepEqual(result, { items: [1] });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(owned.aborted, false);
});

test('an already cancelled owner never starts the request', async () => {
  const owner = new AbortController();
  const reason = new DOMException('left page', 'AbortError');
  owner.abort(reason);
  let calls = 0;
  await assert.rejects(() => run(() => { calls++; }, { signal: owner.signal }), error => error === reason);
  assert.equal(calls, 0);
});

test('deadline includes consuming a real HTTP response body after headers arrive', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"items":');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let headersRead = false;
  let requestSignal;
  try {
    await assert.rejects(() => run(async signal => {
      requestSignal = signal;
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, { signal });
      headersRead = true;
      return response.json();
    }, { timeoutMs: 180 }), error => error.name === 'TimeoutError');
    assert.equal(headersRead, true, 'the failed read must reach headers before the deadline');
    assert.equal(requestSignal.aborted, true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('owner cancellation stays connected while the body is pending', async () => {
  const owner = new AbortController();
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  const reason = new DOMException('superseded', 'AbortError');
  const pending = run(signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    reading();
  }), { signal: owner.signal, timeoutMs: 500 });
  await started;
  owner.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('a consumer with an unresponsive body still reaches one bounded failure without retry', async () => {
  let calls = 0;
  await assert.rejects(() => run(() => {
    calls++;
    return new Promise(() => {});
  }, { timeoutMs: 20 }), error => error.name === 'TimeoutError');
  assert.equal(calls, 1);
});
