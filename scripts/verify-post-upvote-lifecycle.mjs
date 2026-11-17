import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const strip = source => source.replace(/^import[^\n]*\n/gm, '').replace(/\bexport /g, '');
function setup(fetch) {
  const timers = new Map(), stored = new Map();
  const document = new EventTarget();
  let invalidations = 0;
  document.addEventListener('theme:content-mutated', () => invalidations++);
  let id = 0, calls = 0;
  const clock = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  const context = vm.createContext({ AbortController, DOMException, document, Event, console, ...clock, window: clock,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    fetch: (...args) => { calls++; return fetch(...args); } });
  vm.runInContext(strip(fs.readFileSync('src/shared/request-deadline.js', 'utf8')), context);
  vm.runInContext(strip(fs.readFileSync('src/apps/reader/runtime/upvote.js', 'utf8'))
    + '\nregisterPostComponents({data(_name, factory) {globalThis.model = factory("sample", 7);}});', context);
  context.model.init();
  return { model: context.model, timers, stored, calls: () => calls, invalidations: () => invalidations,
    expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

const success = setup(async () => ({ ok: true, status: 204 }));
await success.model.upvote();
assert.equal(success.model.count, 8);
assert.equal(success.model.liked, true);
assert.equal(success.model.pending, false);
assert.deepEqual(JSON.parse(success.stored.get('halo.upvoted.post.names')), ['sample']);
await success.model.upvote();
assert.equal(success.calls(), 1, 'Acknowledged likes are never posted twice');
assert.equal(success.invalidations(), 1, 'Returning to a previously cached article must fetch its confirmed count');

let signal;
const hanging = setup((_url, options) => { signal = options.signal; return new Promise(() => {}); });
const task = hanging.model.upvote();
await tick();
await hanging.model.upvote();
assert.equal(hanging.calls(), 1, 'Pending requests are deduplicated');
assert.ok(hanging.timers.size > 0, 'A stalled upvote must have a finite deadline');
hanging.expire(); await task;
assert.equal(signal.aborted, true);
assert.equal(hanging.model.pending, false);
assert.equal(hanging.model.uncertain, true);
assert.equal(hanging.model.count, 7);
assert.match(hanging.model.error, /未确认/);
assert.equal(hanging.timers.size, 0, 'Uncertain outcome stays visible until navigation or refresh');
await hanging.model.upvote();
assert.equal(hanging.calls(), 1, 'An uncertain write cannot be resent');

let release;
const leaving = setup(() => new Promise(resolve => { release = resolve; }));
const oldTask = leaving.model.upvote();
await tick();
leaving.model.destroy();
release({ ok: true, status: 200 }); await oldTask;
assert.equal(leaving.model.count, 7, 'A late response cannot mutate an unmounted reader');
assert.equal(leaving.stored.size, 0);
assert.equal(leaving.timers.size, 0);

for (const kind of ['network', 'server']) {
  const failed = setup(async () => {
    if (kind === 'network') throw new TypeError('network unavailable');
    return { ok: false, status: 503 };
  });
  await failed.model.upvote();
  assert.equal(failed.model.uncertain, true, `${kind}: do not claim the server has rejected the write`);
  await failed.model.upvote();
  assert.equal(failed.calls(), 1);
}

const rejected = setup(async () => ({ ok: false, status: 403 }));
await rejected.model.upvote();
assert.equal(rejected.model.uncertain, false);
assert.equal(rejected.model.pending, false);
assert.match(rejected.model.error, /失败/);
assert.equal(rejected.timers.size, 1);
rejected.model.destroy();
assert.equal(rejected.timers.size, 0, 'Unmount clears the delayed error callback');
for (const redirected of [true, false]) {
  const login = setup(async () => new Proxy(new Response('<html><title>登录</title></html>', {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }
  }), { get: (r, key) => key === 'redirected' ? redirected : Reflect.get(r, key, r) }));
  await login.model.upvote();
  assert.equal(login.model.count, 7, 'A login document cannot acknowledge an upvote');
  assert.equal(login.model.liked, false);
  assert.equal(login.stored.size, 0);
}
console.log('Post upvote: acknowledged success, pending deduplication, deadline, uncertain transport/server failure, unmount and error cleanup passed (mock POST only).');
