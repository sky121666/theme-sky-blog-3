import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createNotificationCenterMotion } from '../src/shell/desktop-shell/runtime/desktop/notification-center-motion.js';

const originalWindow = globalThis.window;
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

// Exercise the production motion API. The fixture exposes WAAPI boundaries so
// a reversal can be sampled at a deterministic in-between visual state.
function fixture({ reduced = false } = {}) {
  const animations = [];
  const timers = new Map();
  let timerId = 0;
  const element = (selector, initial = {}) => ({
    selector,
    style: { opacity: '1', transform: 'none', ...initial },
    active: [],
    animate(keyframes, timing) {
      const target = this;
      const animation = {
        keyframes, timing, cancelled: false, playState: 'running',
        visualState: { ...keyframes[0] },
        effect: { target, getTiming: () => timing },
        cancel() {
          if (this.cancelled) return;
          this.cancelled = true;
          this.playState = 'idle';
          target.active = target.active.filter((entry) => entry !== this);
          this.oncancel?.();
        },
        finish() {
          if (this.cancelled) return;
          this.playState = 'finished';
          this.visualState = { ...keyframes.at(-1) };
          this.onfinish?.();
        }
      };
      target.active.push(animation);
      animations.push(animation);
      return animation;
    }
  });
  const backdrop = element('.notification-center-backdrop', { opacity: '0' });
  const items = [
    '.notification-center-header', '.notification-center-status',
    '.notification-center-group', '[data-notification-widget-card]',
    '.notification-center-widget-toolbar'
  ].map((selector) => element(selector));
  const panel = element('.notification-center', {
    opacity: '0', transform: 'translateX(38px) translateY(-2px) scale(0.986)'
  });
  panel.ownerDocument = { querySelector: () => backdrop };
  panel.querySelectorAll = (selector) => items.filter((item) => selector.split(', ').includes(item.selector));
  globalThis.window = {
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: (target) => {
      const state = { ...target.style, ...target.active.at(-1)?.visualState };
      // Browsers resolve the held identity keyframe to a matrix, rather than
      // returning the authored transform functions from effect.getKeyframes().
      if (state.transform === 'translateX(0px) scale(1)') state.transform = 'matrix(1, 0, 0, 1, 0, 0)';
      return state;
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  };
  const motion = createNotificationCenterMotion();
  const finish = () => animations.filter((animation) => !animation.cancelled).forEach((animation) => animation.finish());
  const sample = (target, state) => { target.active.at(-1).visualState = { ...state }; };
  return { motion, panel, backdrop, items, animations, timers, finish, sample };
}

test('reopening keeps settled content stable and uses the shorter panel entry', async () => {
  const f = fixture();
  const first = f.motion.open(f.panel);
  const firstDuration = f.animations.find((animation) => animation.effect.target === f.panel).timing.duration;
  assert.ok(f.animations.some((animation) => f.items.includes(animation.effect.target) && animation.timing.delay > 0));
  f.finish();
  await first;
  const close = f.motion.close(f.panel);
  f.finish();
  await close;
  const count = f.animations.length;
  const second = f.motion.open(f.panel);
  const next = f.animations.slice(count);
  assert.equal(next.filter((animation) => f.items.includes(animation.effect.target)).length, 0);
  assert.ok(next.find((animation) => animation.effect.target === f.panel).timing.duration < firstDuration);
  f.finish();
  await second;
  assert.equal(f.panel.style.opacity, '1');
  assert.equal(f.timers.size, 0);
});

test('a newly mounted card moves toward its final pose throughout the first entry, including the stagger delay', async () => {
  const base = new URL('../src/shell/desktop-shell/', import.meta.url);
  const [source, cardCss, panelCss] = await Promise.all([
    'runtime/desktop/notification-center-motion.js', 'styles/widgets/base.css', 'styles/desktop/notification-center.css'
  ].map(path => readFile(new URL(path, base), 'utf8')));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<aside class="notification-center is-opening"><div class="notification-center-widget-list"><article class="desktop-widget-card is-small notification-widget-card" data-notification-widget-card></article></div></aside>');
    await page.addStyleTag({ content: cardCss + '\n' + panelCss });
    const states = await page.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const { createNotificationCenterMotion } = await import(url);
      URL.revokeObjectURL(url);
      const panel = document.querySelector('aside'), card = panel.querySelector('article');
      const motion = createNotificationCenterMotion();
      void motion.open(panel);
      // The visible result includes both CSS transitions and WAAPI. Seek them
      // together to make the before/after comparison independent of frame rate.
      getComputedStyle(card).opacity;
      const animations = card.getAnimations();
      animations.forEach(animation => animation.pause());
      const entry = animations.find(animation => !(animation instanceof CSSTransition));
      const { delay, duration } = entry.effect.getTiming();
      const samples = [0, delay / 2, delay, delay + duration / 2, delay + duration].map(time => {
        animations.forEach(animation => { animation.currentTime = time; });
        const style = getComputedStyle(card);
        const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
        return { x: matrix.e, scale: matrix.a, opacity: Number(style.opacity) };
      });
      motion.destroy();
      return samples;
    }, source);
    for (let i = 1; i < states.length; i++) {
      assert.ok(states[i].x <= states[i - 1].x + 0.05
        && states[i].scale >= states[i - 1].scale - 0.0001
        && states[i].opacity >= states[i - 1].opacity - 0.002, JSON.stringify(states));
    }
    assert.deepEqual(states.at(-1), { x: 0, scale: 1, opacity: 1 });
  } finally { await browser.close(); }
});

test('an opening panel reverses from its sampled panel and content state', async () => {
  const f = fixture();
  const first = f.motion.open(f.panel);
  const panelState = { opacity: '0.63', transform: 'matrix(0.994, 0, 0, 0.994, 15, -1)' };
  const itemState = { opacity: '0.72', transform: 'matrix(0.997, 0, 0, 0.997, 4, 0)' };
  f.sample(f.panel, panelState);
  f.sample(f.items[2], itemState);
  const count = f.animations.length;
  const close = f.motion.close(f.panel);
  const next = f.animations.slice(count);
  assert.deepEqual(next.find((animation) => animation.effect.target === f.panel).keyframes[0], panelState);
  assert.deepEqual(next.find((animation) => animation.effect.target === f.items[2]).keyframes[0], itemState);
  await first;
  f.finish();
  await close;
  assert.equal(f.panel.style.opacity, '0');
});

test('an open retarget after content settles leaves cards stable while the panel is still moving', async () => {
  const f = fixture();
  const first = f.motion.open(f.panel);
  f.animations.filter((animation) => f.items.includes(animation.effect.target)).forEach((animation) => animation.finish());
  const count = f.animations.length;
  const second = f.motion.open(f.panel);
  assert.equal(f.animations.slice(count).filter((animation) => f.items.includes(animation.effect.target)).length, 0);
  await first;
  f.finish();
  await second;
  assert.equal(f.panel.style.opacity, '1');
});

test('reversing a close has no content delay and stale close cleanup preserves its starting state', async () => {
  const f = fixture();
  const first = f.motion.open(f.panel);
  f.finish();
  await first;
  const close = f.motion.close(f.panel);
  const panelState = { opacity: '0.43', transform: 'matrix(0.992, 0, 0, 0.992, 19, -1)' };
  const itemState = { opacity: '0.57', transform: 'matrix(0.997, 0, 0, 0.997, 3, 0)' };
  f.sample(f.panel, panelState);
  f.sample(f.items[2], itemState);
  const count = f.animations.length;
  const reopen = f.motion.open(f.panel);
  const next = f.animations.slice(count);
  assert.deepEqual(next.find((animation) => animation.effect.target === f.panel).keyframes[0], panelState);
  const group = next.find((animation) => animation.effect.target === f.items[2]);
  assert.deepEqual(group.keyframes[0], itemState);
  assert.equal(group.timing.delay, 0);
  await close;
  assert.equal(f.items[2].style.opacity, itemState.opacity, 'cancelled close must not clear the current inline baseline');
  f.finish();
  await reopen;
  assert.equal(f.panel.style.opacity, '1');
  assert.equal(f.items[2].style.opacity, '1');
  assert.equal(f.timers.size, 0);
});

test('reopening after cards finish closing resumes their held end state while the panel is still closing', async () => {
  const f = fixture();
  const opened = f.motion.open(f.panel);
  f.finish();
  await opened;
  const close = f.motion.close(f.panel);
  const held = { opacity: 0.18, transform: 'translateX(7px) scale(0.996)' };
  f.animations.filter((animation) => !animation.cancelled && f.items.includes(animation.effect.target))
    .forEach((animation) => animation.finish());
  f.sample(f.panel, { opacity: '0.2', transform: 'matrix(0.99, 0, 0, 0.99, 28, -1)' });
  const count = f.animations.length;
  const reopened = f.motion.open(f.panel);
  const resumed = f.animations.slice(count).filter((animation) => f.items.includes(animation.effect.target));
  assert.equal(resumed.length, f.items.length, 'held close frames must not jump to fully visible');
  for (const animation of resumed) {
    assert.deepEqual(animation.keyframes[0], held);
    assert.equal(animation.timing.delay, 0);
  }
  await close;
  f.finish();
  await reopened;
  assert.equal(f.panel.style.opacity, '1');
  assert.ok(f.items.every((item) => item.style.opacity === '1'));
  assert.equal(f.timers.size, 0);
});

test('native WAAPI preserves the last close frame when reopening before the panel finishes', async () => {
  const base = new URL('../src/shell/desktop-shell/', import.meta.url);
  const [source, cardCss, panelCss] = await Promise.all([
    'runtime/desktop/notification-center-motion.js', 'styles/widgets/base.css', 'styles/desktop/notification-center.css'
  ].map(path => readFile(new URL(path, base), 'utf8')));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<aside class="notification-center"><article class="desktop-widget-card notification-widget-card" data-notification-widget-card></article></aside>');
    await page.addStyleTag({ content: cardCss + '\n' + panelCss });
    const result = await page.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const { createNotificationCenterMotion } = await import(url);
      URL.revokeObjectURL(url);
      const panel = document.querySelector('aside'), card = panel.querySelector('article');
      const motion = createNotificationCenterMotion();
      const state = () => {
        const style = getComputedStyle(card);
        return { opacity: Number(style.opacity), transform: style.transform };
      };
      const open = motion.open(panel);
      panel.getAnimations({ subtree: true }).forEach(animation => animation.finish());
      await open;
      const close = motion.close(panel);
      card.getAnimations().forEach(animation => animation.finish());
      panel.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 220; });
      await new Promise(requestAnimationFrame);
      const before = state();
      const reopen = motion.open(panel);
      const after = state();
      const resumed = card.getAnimations().filter(animation => !(animation instanceof CSSTransition)).length;
      panel.getAnimations({ subtree: true }).forEach(animation => animation.finish());
      await Promise.all([close, reopen]);
      const final = state();
      motion.destroy();
      return { before, after, final, resumed };
    }, source);
    assert.equal(result.before.opacity, 0.18);
    assert.deepEqual(result.after, result.before, 'no instantaneous opacity/position jump at reopen');
    assert.equal(result.resumed, 1);
    assert.equal(result.final.opacity, 1);
  } finally { await browser.close(); }
});

test('notification refresh leaves widget cards and stable panel chrome untouched', () => {
  const f = fixture();
  f.motion.refreshContent(f.panel);
  assert.ok(f.animations.some((animation) => animation.effect.target === f.items[2]));
  for (const index of [0, 3, 4]) {
    assert.equal(f.animations.filter((animation) => animation.effect.target === f.items[index]).length, 0);
  }
  f.motion.destroy();
});

test('notification refresh during first entry does not cancel or strand widget and chrome motion', async () => {
  const f = fixture();
  const open = f.motion.open(f.panel);
  const widgetEntry = f.animations.find((animation) => animation.effect.target === f.items[3]);
  const headerEntry = f.animations.find((animation) => animation.effect.target === f.items[0]);
  f.motion.refreshContent(f.panel);
  assert.equal(widgetEntry.cancelled, false);
  assert.equal(headerEntry.cancelled, false);
  f.finish();
  await open;
  assert.equal(f.items[3].style.opacity, '1');
  assert.equal(f.items[0].style.opacity, '1');
  f.motion.destroy();
});

test('reduced motion opens and closes immediately without creating WAAPI animations', async () => {
  const f = fixture({ reduced: true });
  await f.motion.open(f.panel);
  assert.equal(f.panel.style.opacity, '1');
  assert.equal(f.panel.style.transform, 'none');
  await f.motion.close(f.panel);
  f.motion.refreshContent(f.panel);
  assert.equal(f.panel.style.opacity, '0');
  assert.equal(f.animations.length, 0);
});

test('destroying a closing motion prevents its queued cleanup from changing the next owner', async () => {
  const f = fixture();
  const close = f.motion.close(f.panel);
  f.motion.destroy();
  f.items[2].style.opacity = '0.85';
  await close;
  assert.equal(f.items[2].style.opacity, '0.85');
  assert.equal(f.timers.size, 0);
});
