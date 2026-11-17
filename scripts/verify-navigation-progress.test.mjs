import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createNavigationProgress } from '../src/shell/desktop-shell/runtime/desktop/pjax/navigation-progress.js';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const feedback = createNavigationProgress({ configure() {}, trickle() {},
    start() { calls.push('start'); }, remove() { calls.push('clear'); } });
  return { feedback, calls };
}

test('a fast navigation completes before showing a decorative progress bar', t => {
  const { feedback, calls } = fixture(t);
  feedback.start();
  t.mock.timers.tick(80);
  feedback.finish();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, []);
});

test('executor and compatibility send share one progress start and one completion', t => {
  const { feedback, calls } = fixture(t);
  feedback.start();
  feedback.start();
  t.mock.timers.tick(200);
  feedback.start();
  assert.deepEqual(calls, ['start']);
  feedback.finish();
  feedback.finish();
  assert.deepEqual(calls, ['start', 'clear']);
});

test('a superseded delayed start cannot show over the next navigation or its local feedback', t => {
  const { feedback, calls } = fixture(t);
  feedback.start();
  t.mock.timers.tick(80);
  feedback.finish();
  feedback.start();
  t.mock.timers.tick(80);
  assert.deepEqual(calls, []);
  feedback.finish();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, []);
  feedback.start();
  t.mock.timers.tick(200);
  assert.deepEqual(calls, ['start']);
  feedback.finish();
});

// Exercise the installed library's real render/remove and completion queue.
// The clock can advance without running callbacks to reproduce a busy UI thread.
function realProgressFixture() {
  let now = 0, sequence = 0, rendered = null;
  const timers = new Map();
  const setTimer = (fn, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { fn, at: now + Number(delay) });
    return id;
  };
  function advanceTo(deadline) {
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > deadline) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
    }
    now = Math.max(now, deadline);
  }
  const body = {
    className: '', style: {},
    appendChild(node) { rendered = node; node.parentNode = this; },
    removeChild(node) { if (rendered === node) rendered = null; node.parentNode = null; }
  };
  const document = {
    body, documentElement: { className: '' },
    getElementById: id => id === 'nprogress' ? rendered : null,
    querySelector: selector => selector === 'body' ? body : null,
    createElement() {
      const bar = { style: {} };
      return { id: '', style: {}, innerHTML: '', offsetWidth: 1, parentNode: null,
        querySelector: selector => selector === '[role="bar"]' ? bar : null };
    }
  };
  const context = vm.createContext({ module: { exports: {} }, exports: {}, document,
    setTimeout: setTimer, clearTimeout: id => timers.delete(id) });
  const require = createRequire(import.meta.url);
  vm.runInContext(readFileSync(require.resolve('nprogress'), 'utf8'), context);
  const progress = context.module.exports;
  progress.configure({ speed: 0, trickle: false, positionUsing: 'translate3d', showSpinner: false });
  const source = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-progress.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace('export function', 'function') + '\nthis.createNavigationProgress = createNavigationProgress;', context);
  return { progress, feedback: context.createNavigationProgress(progress), advanceTo,
    element: () => rendered, block: duration => { now += duration; }, flush: () => advanceTo(now) };
}

test('an old NProgress completion cannot remove the next active bar after a main-thread stall', () => {
  const f = realProgressFixture();
  f.feedback.start();
  f.advanceTo(140);
  assert.ok(f.element(), 'the first navigation shows its progress');
  f.advanceTo(150);
  f.feedback.finish();
  f.feedback.start();
  f.block(200);
  f.flush();
  assert.equal(typeof f.progress.status, 'number');
  assert.ok(f.element(), 'the second active navigation must retain its progress DOM');
  f.feedback.finish();
  f.flush();
  assert.equal(f.progress.status, null);
  assert.equal(f.element(), null);
});
