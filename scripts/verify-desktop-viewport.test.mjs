import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

function fixture({ width = 1344, height = 600, hideOnMobile = false } = {}) {
  let factory;
  registerDesktopSurface({ data(_name, create) { factory = create; } });
  const surface = factory();
  const shell = { clientWidth: width };
  const layer = { clientHeight: height };
  surface.$refs = { gridShell: shell, layer };
  surface.columns = 16;
  surface.gap = 16;
  surface.serverLayoutPayload = { columns: 16 };
  surface.hideOnMobile = hideOnMobile;
  surface.isEditing = true;
  surface.serverLayoutMutationVersion = 7;
  surface.serverLayoutSavedMutationVersion = 6;
  surface.serverLayoutSaveState = 'dirty';
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    getComputedStyle: () => ({ paddingTop: '0px' }),
    setTimeout: () => 1,
    clearTimeout() {}
  };
  globalThis.document = { body: { dataset: {} } };
  return { surface, shell, layer };
}

function placement(node) {
  return { x: node.x, y: node.y, baseX: node.baseX, baseY: node.baseY };
}

test('height-only metrics preserve an editing placement while refreshing rows and grid height', () => {
  const { surface, layer } = fixture();
  const widget = { key: 'widget:1', kind: 'widget', widget: 'system.clock', x: 3, y: 4, baseX: 10, baseY: 1, w: 2, h: 2, hidden: false };
  surface.widgets = [widget];
  surface.cellSize = 68;
  surface.currentColumns = 16;
  surface.gridWidth = 1328;
  surface.maxVisibleRows = 7;
  const before = { placement: placement(widget), rows: surface.maxVisibleRows, gridStyle: surface.gridStyle };
  layer.clientHeight = 330;
  surface.syncGridMetrics({ normalizeLayout: false });
  assert.deepEqual(placement(widget), before.placement);
  assert.ok(surface.maxVisibleRows < before.rows);
  assert.notEqual(surface.gridStyle, before.gridStyle);
  assert.equal(surface.serverLayoutMutationVersion, 7);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
});

test('default metrics still normalize placement when width changes', () => {
  const { surface, shell } = fixture();
  const widget = { key: 'widget:1', kind: 'widget', widget: 'system.clock', x: 3, y: 4, baseX: 10, baseY: 1, w: 2, h: 2, hidden: false };
  surface.widgets = [widget];
  surface.syncGridMetrics({ normalizeLayout: false });
  shell.clientWidth = 1100;
  surface.syncGridMetrics();
  assert.equal(surface.currentColumns, 13);
  assert.notDeepEqual({ x: widget.x, y: widget.y }, { x: 3, y: 4 });
  assert.equal(widget.baseX, 10);
  assert.equal(widget.baseY, 1);
});

test('mobile height-only metrics do not repack hidden-widget desktop icons', () => {
  const { surface, layer } = fixture({ width: 390, height: 520, hideOnMobile: true });
  surface.icons = Array.from({ length: 4 }, (_, index) => ({
    key: `icon:${index}`, kind: 'icon', x: 2, y: index + 2, baseX: 2, baseY: index + 2, w: 1, h: 1
  }));
  const before = surface.icons.map(placement);
  surface.syncGridMetrics({ normalizeLayout: false });
  layer.clientHeight = 180;
  surface.syncGridMetrics({ normalizeLayout: false });
  assert.deepEqual(surface.icons.map(placement), before);
  assert.equal(surface.maxVisibleRows, 2);
});

test('repeated height measurement does not mutate layout data or save state', () => {
  const { surface } = fixture();
  surface.widgets = [{ key: 'widget:1', kind: 'widget', widget: 'system.clock', x: 3, y: 4, baseX: 10, baseY: 1, w: 2, h: 2, hidden: false }];
  const before = structuredClone({ widgets: surface.widgets, icons: surface.icons });
  surface.syncGridMetrics({ normalizeLayout: false });
  surface.syncGridMetrics({ normalizeLayout: false });
  assert.deepEqual({ widgets: surface.widgets, icons: surface.icons }, before);
  assert.equal(surface.serverLayoutMutationVersion, 7);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
});

test('viewport synchronization distinguishes actual width from height changes', () => {
  const { surface, shell, layer } = fixture();
  const widget = { key: 'widget:1', kind: 'widget', widget: 'system.clock', x: 3, y: 4, baseX: 10, baseY: 1, w: 2, h: 2, hidden: false };
  surface.widgets = [widget];
  surface.syncGridMetrics({ normalizeLayout: false });
  layer.clientHeight = 330;
  assert.deepEqual(surface.syncDesktopViewportMetrics(), { widthChanged: false, heightChanged: true });
  assert.deepEqual(placement(widget), { x: 3, y: 4, baseX: 10, baseY: 1 });
  assert.equal(surface.syncDesktopViewportMetrics(), null, 'unchanged dimensions need no second update');
  shell.clientWidth = 1100;
  assert.deepEqual(surface.syncDesktopViewportMetrics(), { widthChanged: true, heightChanged: false });
  assert.equal(surface.currentColumns, 13);
  assert.notDeepEqual({ x: widget.x, y: widget.y }, { x: 3, y: 4 });
  assert.equal(surface.serverLayoutMutationVersion, 7);
});
