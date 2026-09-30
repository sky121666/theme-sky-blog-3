import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readDockSettings,
  calculateDockGeometry,
  applyDockAppearance
} from '../src/shell/desktop-shell/runtime/desktop/dock-geometry.js';
import { registerDock } from '../src/shell/desktop-shell/runtime/desktop/dock.js';

const currentDataset = {
  dockIconSize: '46', dockPadding: '10', dockMagScale: '1.4', showLabels: 'true'
};

test('current Dock leaves 24px above glass without inheriting the old 140px inset', () => {
  const settings = readDockSettings(currentDataset);
  assert.deepEqual(calculateDockGeometry(settings, { viewportWidth: 1440, iconCount: 4 }), {
    naturalWidth: 216, fitScale: 1, desktopReserve: 102
  });
});

test('maximum icon extent raises the reserve when 24px above glass is insufficient', () => {
  assert.equal(calculateDockGeometry(readDockSettings({}), {
    viewportWidth: 1440, iconCount: 4
  }).desktopReserve, 98);
  const large = readDockSettings({ dockIconSize: '64', dockPadding: '16', dockMagScale: '2' });
  assert.equal(calculateDockGeometry(large, { viewportWidth: 1440, iconCount: 4 }).desktopReserve, 170);
});

test('disabled, unit-scale and reduced-motion settings reserve no magnified overhang', () => {
  const dataset = { dockIconSize: '64', dockPadding: '4', dockMagScale: '2' };
  for (const settings of [
    readDockSettings({ ...dataset, magnification: 'false' }),
    readDockSettings({ ...dataset, dockMagScale: '1' }),
    readDockSettings(dataset, { reduceMotion: true })
  ]) {
    assert.equal(settings.maxLift, 0);
    assert.equal(settings.maxScale, 1);
    assert.equal(calculateDockGeometry(settings, { viewportWidth: 1440, iconCount: 4 }).desktopReserve, 108);
  }
});

test('width fitting scales glass and overhang while keeping the viewport inset unscaled', () => {
  const settings = readDockSettings({ ...currentDataset, dockMagScale: '1.5' });
  const geometry = calculateDockGeometry(settings, { viewportWidth: 360, iconCount: 8, bottomInset: 30 });
  assert.equal(geometry.naturalWidth, 416);
  assert.ok(Math.abs(geometry.fitScale - 0.7196652719665272) < 1e-12);
  assert.ok(Math.abs(geometry.desktopReserve - 101.4979079497908) < 1e-10);
});

test('a minimized icon and divider contribute their base widths and both new gaps', () => {
  const settings = readDockSettings(currentDataset);
  assert.equal(calculateDockGeometry(settings, {
    viewportWidth: 1440, iconCount: 5, separatorWidths: [7]
  }).naturalWidth, 277);
  assert.equal(calculateDockGeometry(settings, {
    viewportWidth: 260, iconCount: 5, separatorWidths: [7]
  }).fitScale, 244 / 329);
});

test('invalid settings and measurements cannot publish NaN or negative geometry', () => {
  const settings = readDockSettings({
    dockIconSize: 'Infinity', dockIconGap: '-9', dockPadding: '999', dockMagScale: 'NaN',
    dockGlassBlur: 'bad', dockGlassOpacity: '-1'
  });
  assert.equal(settings.baseSize, 48);
  assert.equal(settings.iconGap, 2);
  assert.equal(settings.dockPadding, 16);
  assert.equal(settings.maxScale, 67 / 48);
  assert.equal(settings.glassBlur, 60);
  assert.equal(settings.glassOpacity, 10);
  for (const options of [
    { viewportWidth: NaN, iconCount: -1, separatorWidths: [NaN, -8, Infinity], bottomInset: Infinity },
    { viewportWidth: -1, iconCount: Infinity, separatorWidths: null, bottomInset: -10 },
    { viewportWidth: 0, iconCount: 0 }
  ]) {
    const geometry = calculateDockGeometry(settings, options);
    assert.ok(Object.values(geometry).every(Number.isFinite));
    assert.ok(geometry.naturalWidth > 0);
    assert.ok(geometry.fitScale > 0 && geometry.fitScale <= 1);
    assert.ok(geometry.desktopReserve >= 24);
  }
});

test('shared appearance applies the effective bar height and label visibility', () => {
  const properties = new Map();
  const removed = [];
  const label = { hidden: false, style: { removeProperty: (name) => removed.push(name) } };
  const element = {
    style: { setProperty: (name, value) => properties.set(name, value) },
    querySelectorAll: () => [label]
  };
  applyDockAppearance(element, readDockSettings(currentDataset, { reduceMotion: true }));
  assert.equal(properties.get('--dock-glass-height'), '66px');
  assert.equal(properties.get('--dock-bar-height'), '66px');
  assert.equal(properties.get('--dock-icon-radius'), '12px');
  assert.equal(label.hidden, false);
  assert.deepEqual(removed, ['display']);
  applyDockAppearance(element, readDockSettings({ ...currentDataset, showLabels: 'false' }));
  assert.equal(label.hidden, true);
});

function createStyle() {
  const values = new Map();
  return {
    writes: [],
    setProperty(name, value, priority = '') {
      values.set(name, { value, priority });
      this.writes.push([name, value]);
    },
    getPropertyValue: (name) => values.get(name)?.value || '',
    getPropertyPriority: (name) => values.get(name)?.priority || '',
    removeProperty(name) { values.delete(name); this.writes.push([name, '']); }
  };
}

function createElement() {
  const classes = new Set();
  return Object.assign(new EventTarget(), {
    style: createStyle(), dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    }
  });
}

function createRuntime(t, { viewportWidth = 1440, bottomInset = 12 } = {}) {
  const frames = new Map();
  let nextFrame = 1;
  const observers = [];
  const root = createElement();
  const dock = createElement();
  dock.dataset = { ...currentDataset };
  const labels = [Object.assign(createElement(), { hidden: false })];
  const icons = Array.from({ length: 4 }, (_, index) => Object.assign(createElement(), {
    getBoundingClientRect: () => ({ left: 100 + index * 50, width: 46 })
  }));
  const separators = [];
  const select = (selector) => {
    if (selector === '.dock-icon') return icons;
    if (selector === '.dock-separator') return separators;
    if (selector === '.dock-tooltip') return labels;
    throw new Error(`Unexpected selector ${selector}`);
  };
  const bar = { querySelectorAll: select };
  Object.defineProperty(bar, 'scrollWidth', { get() { throw new Error('Animated widths must not be measured'); } });
  dock.querySelectorAll = select;
  const media = Object.assign(new EventTarget(), { matches: false });
  const win = Object.assign(new EventTarget(), {
    innerWidth: viewportWidth,
    matchMedia: () => media,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: (element) => element === dock
      ? { bottom: `${bottomInset}px` }
      : { width: '1px', marginLeft: '3px', marginRight: '3px' },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; this.connected = true; }
      disconnect() { this.connected = false; }
    }
  });
  const doc = { documentElement: root, defaultView: win };
  dock.ownerDocument = doc;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = win;
  globalThis.document = doc;
  let factory;
  registerDock({ data(name, value) { assert.equal(name, 'dock'); factory = value; } });
  const instance = Object.assign(factory(), { $el: dock, $refs: { dockBar: bar } });
  t.after(() => {
    instance.destroy();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  return {
    instance, dock, root, win, media, observers, icons, separators, frames,
    flush() {
      let batches = 0;
      while (frames.size > 0) {
        assert.ok(++batches <= 10, 'Dock must not schedule a perpetual animation loop');
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback());
      }
    },
    mouse(type, clientX = 123) {
      const event = new Event(type);
      Object.defineProperty(event, 'clientX', { value: clientX });
      dock.dispatchEvent(event);
    }
  };
}

test('hover and mouseleave animate icons without republishing desktop geometry', async (t) => {
  const fixture = createRuntime(t);
  await fixture.instance.init();
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '102px');
  const initialWrites = fixture.root.style.writes.length;
  fixture.mouse('mousemove');
  fixture.flush();
  assert.equal(fixture.icons[0].style.width, '64px');
  fixture.mouse('mouseleave');
  fixture.flush();
  assert.equal(fixture.icons[0].style.width, '46px');
  assert.equal(fixture.root.style.writes.length, initialWrites);
});

test('compacted Dock measures pointer influence in its unscaled coordinates', async (t) => {
  const fixture = createRuntime(t, { viewportWidth: 260 });
  await fixture.instance.init();
  fixture.flush();
  const fitScale = Number(fixture.dock.style.getPropertyValue('--dock-fit-scale'));
  fixture.mouse('mousemove', 173);
  fixture.flush();
  const settings = readDockSettings(currentDataset);
  const influence = Math.cos((50 / fitScale / settings.range) * Math.PI / 2);
  const expectedWidth = settings.baseSize * (1 + (settings.maxScale - 1) * influence ** 3);
  assert.ok(Math.abs(Number.parseFloat(fixture.icons[0].style.width) - expectedWidth) < 1e-10);
});

test('preview and cancel recompute reserve from restored settings and the actual bottom inset', async (t) => {
  const fixture = createRuntime(t, { bottomInset: 30 });
  await fixture.instance.init();
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '120px');
  fixture.dock.dataset.dockIconSize = '64';
  fixture.dock.dataset.dockPadding = '16';
  fixture.dock.dataset.dockMagScale = '2';
  fixture.dock.dispatchEvent(new Event('theme:dock-settings-change'));
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '188px');
  Object.assign(fixture.dock.dataset, currentDataset);
  fixture.dock.dispatchEvent(new Event('theme:dock-settings-change'));
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '120px');
});

test('only Dock item count mutations update fit, including display-contents minimized items', async (t) => {
  const fixture = createRuntime(t, { viewportWidth: 260 });
  await fixture.instance.init();
  fixture.flush();
  const observer = fixture.observers[0];
  assert.deepEqual(observer.options, { childList: true, subtree: true });
  observer.callback([{ type: 'childList' }]);
  assert.equal(fixture.frames.size, 0, 'tooltip text changes must not schedule geometry');
  fixture.icons.push(Object.assign(createElement(), { getBoundingClientRect: () => ({ left: 300, width: 46 }) }));
  fixture.separators.push(createElement());
  observer.callback([{ type: 'childList' }]);
  fixture.flush();
  assert.ok(Math.abs(Number(fixture.dock.style.getPropertyValue('--dock-fit-scale')) - 244 / 329) < 1e-12);
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '85px');
  fixture.icons.pop();
  fixture.separators.pop();
  observer.callback([{ type: 'childList' }]);
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '97px');
});

test('resize and live reduced-motion changes recompute effective geometry', async (t) => {
  const fixture = createRuntime(t);
  Object.assign(fixture.dock.dataset, { dockIconSize: '64', dockPadding: '16', dockMagScale: '2' });
  await fixture.instance.init();
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '170px');
  fixture.media.matches = true;
  fixture.media.dispatchEvent(new Event('change'));
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '132px');
  fixture.win.innerWidth = 260;
  fixture.win.dispatchEvent(new Event('resize'));
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '115px');
});

test('destroy cancels pending frames and detaches mutation, viewport, media and settings work', async (t) => {
  const fixture = createRuntime(t);
  fixture.root.style.setProperty('--desktop-dock-reserve', '140px');
  await fixture.instance.init();
  fixture.flush();
  fixture.mouse('mousemove');
  fixture.win.dispatchEvent(new Event('resize'));
  fixture.mouse('mouseleave');
  assert.ok(fixture.frames.size > 0);
  fixture.instance.destroy();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.observers[0].connected, false);
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '140px');
  const writesAfterDestroy = fixture.root.style.writes.length;
  fixture.win.dispatchEvent(new Event('resize'));
  fixture.media.dispatchEvent(new Event('change'));
  fixture.dock.dispatchEvent(new Event('theme:dock-settings-change'));
  fixture.observers[0].callback([{ type: 'childList' }]);
  fixture.mouse('mousemove');
  fixture.flush();
  assert.equal(fixture.root.style.writes.length, writesAfterDestroy);
});

test('destroy before the first frame prevents an initial geometry publication', async (t) => {
  const fixture = createRuntime(t);
  await fixture.instance.init();
  fixture.instance.destroy();
  fixture.flush();
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '');
});

test('destroy during module loading prevents mounting a stale Dock', async (t) => {
  const fixture = createRuntime(t);
  const loading = fixture.instance.init();
  fixture.instance.destroy();
  await loading;
  fixture.flush();
  assert.equal(fixture.observers.length, 0);
  assert.equal(fixture.root.style.getPropertyValue('--desktop-dock-reserve'), '');
});
