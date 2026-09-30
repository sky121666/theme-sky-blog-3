import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';

const savedWindow = globalThis.window;
const savedDocument = globalThis.document;
const savedStorage = globalThis.sessionStorage;
afterEach(() => {
  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
  globalThis.sessionStorage = savedStorage;
});
function fixture({ width = 1000, height = 600, hideOnMobile = false } = {}) {
  let factory;
  registerDesktopSurface({ data(_name, create) { factory = create; } });
  const surface = factory();
  const slots = [];
  const ready = [];
  const grid = { querySelectorAll: () => slots };
  surface.$refs = { gridShell: { clientWidth: width }, layer: { clientHeight: height }, grid };
  surface.enabled = true;
  surface.isHome = true;
  surface.hideOnMobile = hideOnMobile;
  surface.columns = 16;
  surface.gap = 16;
  surface.serverLayoutPayload = { columns: 16 };
  globalThis.window = { innerWidth: width, innerHeight: height,
    getComputedStyle: () => ({ paddingTop: '0px', display: 'block', visibility: 'visible' }),
    location: { reload() {} }, pjax: {}, __THEME_STARTUP__: { ready: (part) => ready.push(part) } };
  globalThis.document = { body: { dataset: {} }, querySelectorAll: () => slots, querySelector: () => null };
  globalThis.sessionStorage = { removeItem() {}, getItem: () => null };
  return { surface, slots, ready };
}
function icon(key, x, y) { return { key, kind: 'icon', x, y, baseX: x, baseY: y, w: 1, h: 1 }; }
function slot(key, cssText) {
  const style = Object.fromEntries(cssText.split(';').filter(Boolean).map((entry) => entry.split(':')));
  return { dataset: { desktopKey: key }, style, querySelector: () => ({}) };
}

test('one rendered node cannot complete a surface expecting two visible nodes', () => {
  const { surface, slots, ready } = fixture();
  surface.icons = [icon('a', 1, 1), icon('b', 1, 2)];
  surface.syncGridMetrics();
  slots.push(slot('a', surface.getDesktopNodeStyle(surface.icons[0])));
  assert.equal(surface.ensureDesktopNodesRendered(), false);
  assert.deepEqual(ready, []);
});

test('surface becomes ready only when every key is rendered at its projected size and position', () => {
  const { surface, slots, ready } = fixture();
  surface.icons = [icon('a', 1, 1), icon('b', 1, 2)];
  surface.syncGridMetrics();
  slots.push(slot('a', surface.getDesktopNodeStyle(surface.icons[0])), slot('b', 'left:0px;top:0px;width:68px;height:84px;'));
  assert.equal(surface.ensureDesktopNodesRendered(), false);
  slots[1] = slot('b', surface.getDesktopNodeStyle(surface.icons[1]));
  assert.equal(surface.ensureDesktopNodesRendered(), true);
  assert.deepEqual(ready, ['surface']);
});

test('an empty or mobile-hidden surface can become ready without inventing nodes or saving layout', () => {
  const { surface, ready } = fixture({ width: 390, hideOnMobile: true });
  surface.widgets = [{ key: 'clock', widget: 'system.clock', x: 1, y: 1, baseX: 1, baseY: 1, w: 2, h: 2 }];
  surface.serverLayoutMutationVersion = 7;
  surface.serverLayoutSaveState = 'dirty';
  surface.syncGridMetrics();
  assert.equal(surface.ensureDesktopNodesRendered(), true);
  assert.deepEqual(ready, ['surface']);
  assert.equal(surface.serverLayoutMutationVersion, 7);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
});

async function earlyModule() {
  return import('../src/shell/desktop-shell/runtime/desktop/surface/early-surface.js');
}
const protocol = { enabled: true, isHome: true, columns: 16, gap: 16, layoutVersion: 'v1',
  serverLayoutJson: JSON.stringify({ version: 3, layoutVersion: 'v1', columns: 16, instances: [
    { key: 'clock', widget: 'system.clock', size: 'small', x: 13, y: 1 },
    { key: 'hidden', widget: 'system.clock', size: 'small', x: 1, y: 4, hidden: true },
    { key: 'notification', widget: 'system.clock', size: 'small', x: 5, y: 4, surface: 'notification-center' }
  ], icons: [{ key: 'folder', x: 1, y: 1 }] }) };

test('early projection follows responsive anchors and omits hidden or notification widgets', async () => {
  const { projectEarlyDesktopSurface } = await earlyModule();
  const before = structuredClone(protocol);
  const result = projectEarlyDesktopSurface(protocol, [{ key: 'folder', title: '文件', href: '/' }], { width: 820, height: 500 });
  assert.deepEqual(result.nodes.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })), [
    { key: 'folder', x: 1, y: 1, w: 1, h: 1 }, { key: 'clock', x: 8, y: 1, w: 2, h: 2 }
  ]);
  assert.deepEqual(protocol, before, 'view projection never writes saved data');
});

test('early mobile projection leaves only icons and fills columns without moving saved anchors', async () => {
  const { projectEarlyDesktopSurface } = await earlyModule();
  const result = projectEarlyDesktopSurface({ ...protocol, hideOnMobile: true }, [{ key: 'folder', title: '文件', href: '/' }], { width: 390, height: 180 });
  assert.deepEqual(result.nodes.map(({ key, x, y }) => ({ key, x, y })), [{ key: 'folder', x: 1, y: 1 }]);
});

test('a correct node replaces only its own placeholder while an incomplete sibling stays visible', () => {
  const { surface, slots, ready } = fixture();
  const removed = [];
  const placeholders = ['a', 'b'].map((key) => ({ dataset: { earlyDesktopKey: key }, remove: () => removed.push(key) }));
  const early = { querySelectorAll: () => placeholders.filter((item) => !removed.includes(item.dataset.earlyDesktopKey)), remove: () => removed.push('layer') };
  surface.$refs.surface = { querySelector: () => early };
  surface.icons = [icon('a', 1, 1), icon('b', 1, 2)];
  surface.syncGridMetrics();
  slots.push(slot('a', surface.getDesktopNodeStyle(surface.icons[0])));
  assert.equal(surface.ensureDesktopNodesRendered(), false);
  assert.deepEqual(removed, ['a']);
  assert.deepEqual(ready, []);
  slots.push(slot('b', surface.getDesktopNodeStyle(surface.icons[1])));
  assert.equal(surface.ensureDesktopNodesRendered(), true);
  assert.deepEqual(removed, ['a', 'b', 'layer']);
  assert.deepEqual(ready, ['surface']);
});

test('a cloaked desktop layer cannot finish startup even when all slot styles exist', () => {
  const { surface, slots, ready } = fixture();
  surface.icons = [icon('a', 1, 1)];
  surface.syncGridMetrics();
  slots.push(slot('a', surface.getDesktopNodeStyle(surface.icons[0])));
  surface.$refs.layer.hasAttribute = () => true;
  assert.equal(surface.ensureDesktopNodesRendered(), false);
  assert.deepEqual(ready, []);
});

test('wide, medium and icon-rail projections match literal saved-anchor expectations', async () => {
  const { projectEarlyDesktopSurface } = await earlyModule();
  const cases = [
    { width: 1344, cellSize: 68, columns: 16, x: 13, left: 1008, top: 0, widthPx: 152, heightPx: 152 },
    { width: 820, cellSize: 60, columns: 11, x: 8, left: 532, top: 0, widthPx: 136, heightPx: 136 },
    { width: 640, cellSize: 64, columns: 8, x: 5, left: 320, top: 0, widthPx: 144, heightPx: 144 }
  ];
  for (const c of cases) {
    const result = projectEarlyDesktopSurface(protocol, [{ key: 'folder', title: '文件', href: '/' }], { width: c.width, height: 500 });
    const clock = result.nodes.find((node) => node.key === 'clock');
    assert.equal(result.cellSize, c.cellSize);
    assert.equal(result.currentColumns, c.columns);
    assert.equal(clock.x, c.x);
    const { desktopPlacementStyle } = await import('../src/shell/desktop-shell/runtime/desktop/surface/layout-projection.js');
    assert.equal(desktopPlacementStyle(clock, result.cellSize, result.gap), `left:${c.left}px;top:${c.top}px;width:${c.widthPx}px;height:${c.heightPx}px;`);
  }
});

test('pure collision projection reserves the icon rail and never edits node anchors', async () => {
  const { projectDesktopLayout } = await import('../src/shell/desktop-shell/runtime/desktop/surface/layout-projection.js');
  const icons = [icon('a', 2, 1), icon('b', 3, 1)];
  const widgets = [
    { key: 'first', x: 13, y: 1, baseX: 13, baseY: 1, w: 2, h: 2 },
    { key: 'second', x: 13, y: 1, baseX: 13, baseY: 1, w: 2, h: 2 }
  ];
  const original = structuredClone({ icons, widgets });
  assert.deepEqual(projectDesktopLayout({ icons, widgets, savedColumns: 16, currentColumns: 8, maxVisibleRows: 4 }), [
    { key: 'a', x: 1, y: 1, w: 1, h: 1 },
    { key: 'b', x: 1, y: 2, w: 1, h: 1 },
    { key: 'first', x: 5, y: 1, w: 2, h: 2 },
    { key: 'second', x: 3, y: 1, w: 2, h: 2 }
  ]);
  assert.deepEqual({ icons, widgets }, original);
});

test('early collision layout matches the final integrity projection used before the runtime renders', async () => {
  const { projectEarlyDesktopSurface } = await earlyModule();
  const colliding = { ...protocol, serverLayoutJson: JSON.stringify({ version: 3, layoutVersion: 'v1', columns: 16,
    instances: [
      { key: 'first', widget: 'system.clock', size: 'small', x: 13, y: 1 },
      { key: 'second', widget: 'system.clock', size: 'small', x: 13, y: 1 }
    ], icons: [{ key: 'folder', x: 1, y: 1 }] }) };
  const early = projectEarlyDesktopSurface(colliding, [{ key: 'folder', title: '文件', href: '/' }], { width: 640, height: 500 });
  assert.equal(early.nodes.find((node) => node.key === 'first').x, 5);
  assert.equal(early.nodes.find((node) => node.key === 'second').x, 3);
});

function earlyDockFixture({ viewportWidth = 1440, bottomInset = 12, iconCount = 4, reduceMotion = false, dataset = {} } = {}) {
  const properties = new Map([['--desktop-dock-reserve', '140px']]);
  const style = () => ({ setProperty: (name, value) => properties.set(name, value), getPropertyValue: (name) => properties.get(name) || '' });
  const makeElement = () => ({ dataset: {}, style: {}, children: [], append(...children) { this.children.push(...children); } });
  const icons = Array.from({ length: iconCount }, () => ({ hidden: false, classList: { contains: () => false } }));
  const bar = { querySelectorAll: (selector) => selector === '.dock-icon' ? icons : [] };
  const dock = { dataset: { dockIconSize: '46', dockPadding: '10', dockMagScale: '1.4', ...dataset }, style: style(), querySelector: () => bar };
  const grid = makeElement();
  const shell = { clientWidth: 1000 };
  const container = { dataset: {}, hidden: true,
    get clientHeight() { return 600 - 61 - parseFloat(properties.get('--desktop-dock-reserve')); },
    querySelector: (selector) => selector === '[data-early-desktop-grid-shell]' ? shell : grid };
  const rawIcons = Array.from({ length: 7 }, (_, index) => ({ key: `default-${index}`, title: `图标 ${index}`, href: '/' }));
  const win = { innerWidth: viewportWidth, innerHeight: 600,
    matchMedia: () => ({ matches: reduceMotion }),
    __THEME_DESKTOP_PROTOCOL__: { icons: rawIcons },
    getComputedStyle: (element) => element === dock ? { bottom: `${bottomInset}px` } : { paddingTop: '0px', display: 'block' } };
  const doc = { defaultView: win, documentElement: { style: style() }, body: { dataset: {} },
    createElement: makeElement, createDocumentFragment: makeElement,
    querySelector: (selector) => {
      if (selector === '.dock-container') return dock;
      if (selector === '[data-early-desktop-surface]') return container;
      if (selector === '#theme-desktop-widget-protocol') return { textContent: JSON.stringify({ enabled: true, isHome: true, gap: 16, columns: 16 }) };
      return null;
    } };
  container.ownerDocument = doc;
  dock.ownerDocument = doc;
  return { doc, dock, properties, container, icons };
}

test('unsaved default icons use the final Dock reserve before their first projection', async () => {
  const { renderEarlyDesktopSurface } = await earlyModule();
  const fixture = earlyDockFixture();
  const result = renderEarlyDesktopSurface(fixture.doc);
  assert.equal(fixture.properties.get('--desktop-dock-reserve'), '102px');
  assert.equal(result.maxVisibleRows, 5);
  assert.deepEqual(['default-4', 'default-5', 'default-6'].map((key) => { const node = result.nodes.find((item) => item.key === key); return { key, x: node.x, y: node.y }; }), [
    { key: 'default-4', x: 1, y: 5 }, { key: 'default-5', x: 2, y: 1 }, { key: 'default-6', x: 2, y: 2 }
  ]);
});


test('early Dock reserve honors width fitting, safe area and reduced-motion geometry', async () => {
  const { renderEarlyDesktopSurface } = await earlyModule();
  const compact = earlyDockFixture({ viewportWidth: 360, iconCount: 8, bottomInset: 30, dataset: { dockMagScale: '1.5' } });
  renderEarlyDesktopSurface(compact.doc);
  assert.equal(compact.properties.get('--desktop-dock-reserve'), '102px');
  assert.equal(compact.properties.get('--dock-fit-scale'), 344 / 478);
  const reduced = earlyDockFixture({ reduceMotion: true, dataset: { dockIconSize: '64', dockPadding: '4', dockMagScale: '2' } });
  renderEarlyDesktopSurface(reduced.doc);
  assert.equal(reduced.properties.get('--desktop-dock-reserve'), '108px');
});

test('early Dock count excludes hidden and disabled settings items before fitting', async () => {
  const { renderEarlyDesktopSurface } = await earlyModule();
  const fixture = earlyDockFixture({ viewportWidth: 260, iconCount: 5, dataset: { settingsEnabled: 'false' } });
  fixture.icons[0].classList.contains = (name) => name === 'dock-settings-icon';
  fixture.icons[1].hidden = true;
  renderEarlyDesktopSurface(fixture.doc);
  assert.equal(fixture.properties.get('--dock-fit-scale'), 1);
  assert.equal(fixture.properties.get('--desktop-dock-reserve'), '102px');
});
