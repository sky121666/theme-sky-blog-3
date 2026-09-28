import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createPerformanceAccumulator, installPerformanceObservers, layoutStabilityFailures } from './lib/performance-metrics.mjs';

const shift = (startTime, value, hadRecentInput = false) => ({ startTime, value, hadRecentInput });
const event = (interactionId, duration, startTime = 100) => ({ interactionId, duration, startTime });

const samplePage = (cls, overrides = {}) => ({ name: 'fixture', status: 'ok', metrics: {
  cls, fcp: 100, sample: { supported: { 'layout-shift': true }, firstHiddenAt: null }, ...overrides
} });
test('CLS gate compares raw values at the budget boundary', () => {
  assert.deepEqual(layoutStabilityFailures([samplePage(0), samplePage(0.1)], 0.1), []);
  assert.equal(layoutStabilityFailures([samplePage(0.10004)], 0.1)[0].reason, 'layout shift budget exceeded');
});
test('CLS gate rejects missing and background-before-paint observations', () => {
  for (const page of [samplePage(null), samplePage(0, { fcp: null }),
    samplePage(0, { sample: { supported: { 'layout-shift': false }, firstHiddenAt: null } }),
    samplePage(0, { sample: { supported: { 'layout-shift': true }, firstHiddenAt: 0 } })]) {
    assert.equal(layoutStabilityFailures([page], 0.1)[0].reason, 'layout shift measurement unavailable');
  }
  assert.deepEqual(layoutStabilityFailures([samplePage(0, {
    sample: { supported: { 'layout-shift': true }, firstHiddenAt: 500 }
  })], 0.1), [], 'a visible painted sample clipped at later backgrounding remains a limited valid observation');
});

test('CLS reports the largest session, rather than summing separate sessions', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('layout-shift', [shift(0, 0.1), shift(500, 0.2), shift(2000, 0.4)]);
  assert.equal(metrics.snapshot(3000).cls, 0.4);
});

test('CLS starts a new session at exactly one second of inactivity', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('layout-shift', [shift(0, 0.2), shift(1000, 0.3)]);
  assert.equal(metrics.snapshot(2000).cls, 0.3);
});

test('CLS caps each session at five seconds despite continuous shifts', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('layout-shift', [0, 900, 1800, 2700, 3600, 4500, 5000].map((at) => shift(at, 0.1)));
  assert.ok(Math.abs(metrics.snapshot(6000).cls - 0.6) < 1e-9);
});

test('recent-input and hidden-page layout shifts do not inflate CLS', () => {
  const metrics = createPerformanceAccumulator();
  metrics.hide(1000);
  metrics.observe('layout-shift', [shift(100, 0.2), shift(200, 1, true), shift(1100, 2)]);
  assert.equal(metrics.snapshot(2000).cls, 0.2);
});

test('blocking statistic clips before FCP and after sample end, including crossing tasks', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('longtask', [
    { startTime: 100, duration: 200 },
    { startTime: 900, duration: 300 },
    { startTime: 1300, duration: 100 },
    { startTime: 1500, duration: 200 }
  ]);
  metrics.observe('paint', [{ name: 'first-contentful-paint', startTime: 1000 }]);
  assert.equal(metrics.snapshot(1600).blockingTimeAfterFcp, 300);
  assert.equal(metrics.snapshot(1600).sample.blockingWindow.start, 1000);
});

test('missing FCP or unsupported observers do not claim measured zero', () => {
  const metrics = createPerformanceAccumulator();
  assert.equal(metrics.snapshot(1000).blockingTimeAfterFcp, null);
  assert.equal(metrics.snapshot(1000).inp, null);
  metrics.setSupported('layout-shift', false);
  metrics.setSupported('event', false);
  assert.equal(metrics.snapshot(1000).cls, null);
  assert.equal(metrics.snapshot(1000).sample.inpStatus, 'unsupported');
});

test('INP groups events by interaction id and ignores non-interaction events', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('event', [event(1, 80), event(1, 120), event(2, 96), event(0, 900)]);
  const result = metrics.snapshot(1000, 2);
  assert.equal(result.inp, 120);
  assert.equal(result.sample.observedInteractionCount, 2);
});

test('INP excludes one longest interaction for each fifty interactions', () => {
  const metrics = createPerformanceAccumulator();
  metrics.observe('event', Array.from({ length: 50 }, (_, i) => event(i + 1, 20 + i * 4)));
  assert.equal(metrics.snapshot(1000, 50).inp, 212);
  assert.equal(metrics.snapshot(1000, 50).sample.inpStatus, 'sampled-interactions-only');
});

test('no interaction sample is explicitly unknown, not a perfect INP score', () => {
  const metrics = createPerformanceAccumulator();
  metrics.setSupported('event', true);
  const result = metrics.snapshot(1000, 0);
  assert.equal(result.inp, null);
  assert.equal(result.sample.inpStatus, 'no-observed-interactions');
});

test('serialized browser installer drains pending records before reporting', () => {
  const observers = new Map();
  class Observer {
    static supportedEntryTypes = ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask', 'event'];
    constructor(callback) { this.callback = callback; this.records = []; }
    observe(options) { this.options = options; observers.set(options.type, this); }
    takeRecords() { return this.records.splice(0); }
  }
  const context = { PerformanceObserver: Observer, window: {}, document: { visibilityState: 'visible', addEventListener() {} }, performance: { now: () => 2000, interactionCount: 1 } };
  vm.runInNewContext(`(${installPerformanceObservers.toString()})(${createPerformanceAccumulator.toString()});`, context);
  observers.get('paint').records.push({ name: 'first-contentful-paint', startTime: 200 });
  observers.get('largest-contentful-paint').records.push({ startTime: 600 });
  observers.get('layout-shift').records.push(shift(300, 0.1), shift(1500, 0.2));
  observers.get('longtask').records.push({ startTime: 400, duration: 100 });
  observers.get('event').records.push(event(1, 96));
  const result = context.window.__themeAuditMetrics.snapshot();
  assert.equal(result.lcp, 600);
  assert.equal(result.cls, 0.2);
  assert.equal(result.blockingTimeAfterFcp, 50);
  assert.equal(result.inp, 96);
  assert.equal(observers.get('event').options.durationThreshold, 16);
  assert.equal(context.window.__themeAuditMetrics.snapshot().cls, 0.2, 'drained records must not be counted twice');
});
