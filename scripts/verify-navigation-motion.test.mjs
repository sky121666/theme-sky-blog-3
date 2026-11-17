import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWindowLoadingController } from '../src/shell/desktop-shell/runtime/desktop/pjax/loading-controller.js';

function loadingFixture() {
  const attributes = new Map();
  const overlay = {
    isConnected: true, style: {},
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  };
  const scope = {
    matches: () => true, querySelector: () => overlay,
    setAttribute: (name, value) => attributes.set(name, value)
  };
  return { scope, overlay, attributes };
}

test('ready content starts releasing the default overlay immediately without a minimum hold', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = loadingFixture();
  const controller = createWindowLoadingController(f.scope, { showDelay: 0 }).start();
  const finished = controller.finish();
  assert.equal(f.attributes.get('aria-hidden'), 'true');
  assert.equal(f.attributes.has('data-fading'), true);
  t.mock.timers.tick(150);
  await finished;
  assert.equal(f.overlay.style.display, 'none');
  assert.equal(f.attributes.get('aria-busy'), 'false');
});

test('retained-content navigation sets busy without revealing its window skeleton', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = loadingFixture();
  f.overlay.setAttribute('aria-hidden', 'true');
  const controller = createWindowLoadingController(f.scope, { useOverlay: false }).start();
  t.mock.timers.tick(1000);
  assert.equal(f.attributes.get('aria-busy'), 'true');
  assert.equal(f.attributes.get('aria-hidden'), 'true');
  await controller.finish({ immediate: true });
  assert.equal(f.attributes.get('aria-busy'), 'false');
});

test('a superseding navigation releases a pending fade without leaving old timers or busy state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = loadingFixture();
  const controller = createWindowLoadingController(f.scope, { showDelay: 0, minVisible: 5000 }).start();
  const finished = controller.finish();
  await controller.finish({ immediate: true });
  await finished;
  t.mock.timers.tick(10_000);
  assert.equal(f.overlay.style.display, 'none');
  assert.equal(f.attributes.get('aria-busy'), 'false');
  assert.equal(f.attributes.has('data-fading'), false);
});

async function motionFixture() {
  const { installNavigationMotion } = await import('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-motion.js');
  const animations = [];
  const target = {
    isConnected: true,
    animate(frames, timing) {
      const animation = { frames, timing, cancelled: false, finished: new Promise(() => {}), cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    }
  };
  const doc = new EventTarget();
  doc.body = { dataset: { appId: 'shop' } };
  doc.querySelector = () => null;
  const win = { history: { state: { __browserNavIndex: 4 } }, matchMedia: () => ({ matches: false }) };
  const dispose = installNavigationMotion(doc, win);
  const emit = (name, detail) => doc.dispatchEvent(new CustomEvent(name, { detail }));
  const ready = (intentId, appId = 'shop') => emit('theme:pjax-ready', {
    intentId, appId, mode: 'same', root: { querySelector: () => target }
  });
  return { animations, target, doc, win, dispose, emit, ready };
}

test('only the accepted ready navigation animates; a new intent cancels its predecessor', async () => {
  const f = await motionFixture();
  f.emit('theme:navigation-accepted', { intentId: 1, source: 'click' });
  f.emit('theme:navigation-accepted', { intentId: 2, source: 'click' });
  f.ready(1);
  assert.equal(f.animations.length, 0);
  f.ready(2);
  assert.equal(f.animations.length, 1);
  f.emit('theme:navigation-accepted', { intentId: 3, source: 'click' });
  assert.equal(f.animations[0].cancelled, true);
  f.emit('theme:navigation-settled', { intentId: 3, outcome: 'failed' });
  f.ready(3);
  assert.equal(f.animations.length, 1);
  f.dispose();
});

test('repeated shell initialization shares one motion installation and cannot double the entry animation', async () => {
  const f = await motionFixture();
  const { installNavigationMotion } = await import('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-motion.js');
  const duplicateDispose = installNavigationMotion(f.doc, f.win);
  f.emit('theme:navigation-accepted', { intentId: 1, source: 'click' });
  f.ready(1);
  assert.equal(f.animations.length, 1);
  assert.equal(duplicateDispose, f.dispose);
  f.dispose();
});

test('a Links detail pane keeps its component visibility and does not receive a second page entrance', async () => {
  const f = await motionFixture();
  f.doc.body.dataset.appId = 'links';
  f.emit('theme:navigation-accepted', { intentId: 1, source: 'click' });
  f.ready(1, 'links');
  assert.equal(f.animations.length, 0);
  f.dispose();
});

test('history Back uses a reverse entry while specialized apps and reduced motion keep their own presentation', async () => {
  const f = await motionFixture();
  f.win.history.state.__browserNavIndex = 3;
  f.emit('theme:navigation-accepted', { intentId: 1, source: 'popstate' });
  f.ready(1);
  assert.match(f.animations[0].frames[0].transform, /translateX\(-/);
  for (const appId of ['docsme', 'photos']) {
    f.emit('theme:navigation-accepted', { intentId: 2, source: 'click' });
    f.ready(2, appId);
  }
  f.win.matchMedia = () => ({ matches: true });
  f.emit('theme:navigation-accepted', { intentId: 3, source: 'click' });
  f.ready(3);
  assert.equal(f.animations.length, 1);
  f.dispose();
});

test('a moving sidebar highlight cleans up its temporary layer when the next navigation interrupts it', async () => {
  const f = await motionFixture();
  const rowClasses = new Set();
  let currentY = 20;
  let removed = false;
  let transition = 'background-color 180ms ease';
  const row = {
    dataset: {},
    style: {
      getPropertyValue: () => transition, getPropertyPriority: () => '',
      setProperty(_name, value) { transition = value; }, removeProperty() { transition = ''; }
    },
    getBoundingClientRect: () => ({ x: 0, y: currentY, width: 180, height: 32 }),
    classList: { add: name => rowClasses.add(name), remove: name => rowClasses.delete(name) },
    prepend: () => {}
  };
  f.doc.querySelector = selector => selector.includes('shop-nav-link') ? row : null;
  f.win.getComputedStyle = () => ({ backgroundColor: 'rgb(42, 62, 82)', borderRadius: '6px' });
  f.doc.createElement = () => ({ ...f.target, style: {}, setAttribute() {}, remove() { removed = true; } });
  f.emit('theme:navigation-accepted', { intentId: 1, source: 'click' });
  currentY = 90;
  f.ready(1);
  assert.equal(rowClasses.has('theme-navigation-selected'), true);
  assert.equal(transition, 'none', 'the stationary active fill must not fade under the moving highlight');
  assert.equal(f.animations[0].frames[0].transform, 'translate(0px, -70px) scale(1, 1)');
  f.emit('theme:navigation-accepted', { intentId: 2, source: 'click' });
  assert.equal(removed, true);
  assert.equal(rowClasses.has('theme-navigation-selected'), false);
  assert.equal(transition, 'background-color 180ms ease');
  f.dispose();
});

test('reduced motion releases an already displayed loading overlay without an extra animation wait', async t => {
  const previous = globalThis.window;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  const f = loadingFixture();
  const controller = createWindowLoadingController(f.scope, { showDelay: 0, minVisible: 5000 }).start();
  await controller.finish();
  assert.equal(f.overlay.style.display, 'none');
  assert.equal(f.attributes.get('aria-busy'), 'false');
});
