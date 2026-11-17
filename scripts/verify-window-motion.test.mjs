import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';

const originalGlobals = Object.fromEntries(
  ['window', 'document', 'localStorage', 'requestAnimationFrame'].map((key) => [key, globalThis[key]])
);
afterEach(() => Object.assign(globalThis, originalGlobals));

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

// Only the browser's layout and WAAPI clock are controlled. The store and Genie
// implementation run together, including abort listeners and ghost cleanup.
function fixture({ reducedMotion = false, dockPresent = true } = {}) {
  const frames = [];
  const ghosts = new Set();
  const animations = [];
  const titlebar = { style: {} };
  const winEl = {
    isConnected: true,
    style: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
    querySelector: () => titlebar,
    getBoundingClientRect: () => ({ left: 120, top: 80, width: 900, height: 600 })
  };
  const dockIcon = {
    style: {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 700, top: 850, width: 48, height: 48 })
  };
  const persisted = [];
  globalThis.document = {
    title: '测试窗口',
    head: { querySelector: () => null },
    body: { dataset: {}, classList: { remove() {} }, appendChild: (element) => ghosts.add(element) },
    activeElement: null,
    querySelector: (selector) => selector === '[data-window-surface]' ? winEl
      : selector === '#minimized-dock-icon' && dockPresent ? dockIcon : null,
    getElementById: () => dockPresent ? dockIcon : null,
    createElement: () => ({
      style: {},
      appendChild() {},
      remove() { ghosts.delete(this); },
      animate(keyframes, options) {
        const animation = {
          element: this,
          keyframes,
          options,
          currentTime: 0,
          cancelled: false,
          effect: { getComputedTiming: () => ({ progress: animation.currentTime / options.duration }) },
          cancel() { this.cancelled = true; this.oncancel?.(); }
        };
        animations.push(animation);
        return animation;
      }
    })
  };
  globalThis.window = {
    innerWidth: 1440,
    location: { pathname: '/archives', href: 'https://example.com/archives', origin: 'https://example.com' },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: (element) => ({ ...element.style, transform: element.currentTransform || 'none' }),
    setTimeout,
    clearTimeout
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem(_key, value) { persisted.push(JSON.parse(value)); }
  };
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const stores = new Map();
  registerWindowManager({
    data() {},
    store(name, value) { if (value) stores.set(name, value); return stores.get(name); },
    nextTick(callback) { callback?.(); }
  });
  const manager = stores.get('windowManager');
  manager.show = true;
  return {
    manager, winEl, dockIcon, titlebar, ghosts, animations, persisted,
    paint() { while (frames.length) frames.shift()(); },
    sampleMotion() {
      const [wrapper, inner] = animations.slice(-2);
      wrapper.currentTime = wrapper.options.duration / 4;
      inner.currentTime = inner.options.duration / 4;
      wrapper.element.currentTransform = 'matrix(1, 0, 0, 1, 0, 160)';
      inner.element.currentTransform = 'matrix(0.8, 0, 0, 0.8, 40, 0)';
    },
    finish() { animations.at(-1).onfinish?.(); }
  };
}

async function startMinimize(f) {
  const pending = f.manager.minimize();
  f.paint();
  await settle();
  return { pending };
}

test('restore before the first minimize paint immediately restores the usable window', async () => {
  const f = fixture();
  const pending = f.manager.minimize();
  await f.manager.restore('最新窗口');
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  f.paint();
  await pending;
  assert.equal(f.ghosts.size, 0);
  assert.equal(f.animations.length, 0);
});

test('restore during minimize takes over immediately from the displayed Genie frame', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  f.sampleMotion();
  const staleFinish = f.animations[1].onfinish;
  const restoring = f.manager.restore('最新窗口');
  assert.equal(f.animations.length, 4, 'restore must start before the old minimize finishes');
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.animations[1].cancelled, true);
  assert.equal(f.ghosts.size, 1);
  assert.equal(f.animations[2].keyframes[0].transform, 'matrix(1, 0, 0, 1, 0, 160)');
  assert.equal(f.animations[3].keyframes[0].transform, 'matrix(0.8, 0, 0, 0.8, 40, 0)');
  staleFinish();
  await pending;
  assert.equal(f.manager.isAnimating, true, 'the superseded task cannot finish the new animation');
  f.finish();
  await restoring;
  assert.equal(f.manager.title, '最新窗口');
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  assert.equal(f.titlebar.style.opacity, '');
  assert.equal(f.ghosts.size, 0);
  assert.deepEqual(f.persisted.at(-1), { show: true, minimized: false });
});

test('repeated Dock opens retain the latest title without restarting restoration', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  f.manager.open('第一次');
  f.manager.open('第二次');
  f.manager.open('最后一次');
  assert.equal(f.animations.length, 4);
  f.finish();
  await pending;
  await settle();
  assert.equal(f.manager.title, '最后一次');
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.ghosts.size, 0);
});

test('minimize can retarget an in-progress restore and make its Dock thumbnail visible', async () => {
  const f = fixture();
  f.manager.minimized = true;
  const restoring = f.manager.restore();
  f.sampleMotion();
  const minimizing = f.manager.minimize();
  f.paint();
  await settle();
  assert.equal(f.animations.length, 4);
  assert.equal(f.dockIcon.style.opacity, '');
  assert.equal(f.animations[2].keyframes[0].transform, 'matrix(1, 0, 0, 1, 0, 160)');
  f.finish();
  await Promise.all([restoring, minimizing]);
  assert.equal(f.manager.minimized, true);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'hidden');
  assert.equal(f.winEl.style.pointerEvents, 'none');
  assert.equal(f.ghosts.size, 0);
});

test('several alternating intents leave only the latest restore in charge', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  f.sampleMotion();
  const firstRestore = f.manager.restore('中间标题');
  f.sampleMotion();
  const secondMinimize = f.manager.minimize();
  f.sampleMotion();
  const finalRestore = f.manager.restore('最终标题');
  const staleFinishes = f.animations.slice(0, -2).map((animation) => animation.onfinish).filter(Boolean);
  staleFinishes.forEach((finish) => finish());
  await settle();
  assert.equal(f.animations.length, 8);
  assert.equal(f.ghosts.size, 1);
  assert.equal(f.manager.isAnimating, true);
  f.finish();
  await Promise.all([pending, firstRestore, secondMinimize, finalRestore]);
  assert.equal(f.manager.title, '最终标题');
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  assert.equal(f.ghosts.size, 0);
});

test('closing a redirected animation cancels every ghost and rejects stale finish callbacks', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  const restoring = f.manager.restore();
  const staleFinishes = f.animations.map((animation) => animation.onfinish).filter(Boolean);
  f.manager.hide();
  staleFinishes.forEach((finish) => finish());
  await Promise.all([pending, restoring]);
  assert.equal(f.manager.show, false);
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.ghosts.size, 0);
  assert.equal(f.animations.every((animation) => animation.cancelled), true);
  assert.deepEqual(f.persisted.at(-1), { show: false, minimized: false });
});

test('navigation during restoration rejects the old finish and preserves the new window', async () => {
  const f = fixture();
  f.manager.minimized = true;
  const restoring = f.manager.restore('旧页面');
  const staleFinish = f.animations[1].onfinish;
  f.manager.revealAfterNavigation('新页面');
  staleFinish();
  await restoring;
  assert.equal(f.manager.title, '新页面');
  assert.equal(f.manager.show, true);
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  assert.equal(f.ghosts.size, 0);
});

test('cancelling either Genie axis settles minimize instead of leaving the window busy', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  f.animations[0].cancel();
  await settle();
  assert.equal(f.manager.isAnimating, false);
  await pending;
  assert.equal(f.manager.minimized, true);
  assert.equal(f.winEl.style.visibility, 'hidden');
  assert.equal(f.winEl.style.pointerEvents, 'none');
  assert.equal(f.ghosts.size, 0);
});

test('cancelling restoration reveals the usable window and cleans the hidden Dock thumbnail', async () => {
  const f = fixture();
  f.manager.minimized = true;
  f.winEl.style.visibility = 'hidden';
  f.winEl.style.pointerEvents = 'none';
  const restoring = f.manager.restore();
  f.animations[1].cancel();
  await restoring;
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  assert.equal(f.dockIcon.style.opacity, '');
  assert.equal(f.ghosts.size, 0);
});

test('reduced motion reaches both requested terminal states without creating a Genie ghost', async () => {
  const f = fixture({ reducedMotion: true });
  const { pending } = await startMinimize(f);
  await pending;
  assert.equal(f.manager.minimized, true);
  assert.equal(f.winEl.style.pointerEvents, 'none');
  await f.manager.restore();
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
  assert.equal(f.ghosts.size, 0);
  assert.equal(f.animations.length, 0);
});

test('enabling reduced motion during minimize cancels its ghost before restoring', async () => {
  const f = fixture();
  const { pending } = await startMinimize(f);
  window.matchMedia = () => ({ matches: true });
  await f.manager.restore();
  assert.equal(f.ghosts.size, 0);
  await pending;
  assert.equal(f.animations.length, 2);
  assert.equal(f.animations.every((animation) => animation.cancelled), true);
  assert.equal(f.manager.minimized, false);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
});

test('a missing Dock target still settles minimize and restores the surface', async () => {
  const f = fixture({ dockPresent: false });
  const { pending } = await startMinimize(f);
  await pending;
  assert.equal(f.manager.minimized, true);
  assert.equal(f.manager.isAnimating, false);
  assert.equal(f.winEl.style.pointerEvents, 'none');
  await f.manager.restore();
  assert.equal(f.manager.minimized, false);
  assert.equal(f.winEl.style.visibility, 'visible');
  assert.equal(f.winEl.style.pointerEvents, 'auto');
});
