import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';
import { editModeMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { selectDailyRandomTags } from '../src/widgets/shared/data.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function desktopFixture() {
  let factory;
  registerDesktopSurface({ data(_name, value) { factory = value; }, store() { return {}; } });
  const surface = factory();
  Object.assign(surface, editModeMethods, {
    isEditing: true,
    editStage: 'add',
    widgets: [],
    defaultWidgets: [],
    defaultIcons: [],
    defaultIconTombstones: [],
    findNearestAvailablePlacement: () => ({ x: 0, y: 0, w: 2, h: 2 }),
    invalidateWidgetCache() {},
    syncResponsiveVisibility() {},
    syncWidgetRuntimes() {},
    syncDesktopBodyState() {},
    syncGridMetrics() {},
    dispatchNotificationWidgetsChange() {},
    closeDesktopContextMenu() {},
    endCenterSheetDrag() {},
    endDrag() {}
  });
  globalThis.window = { confirm: () => true };
  return surface;
}

test('a pending weather request leaves the added widget immediately saveable', async () => {
  const surface = desktopFixture();
  const request = deferred();
  surface.loadWeather = () => request.promise;
  const pending = surface._doAddWidget('system.weather', 'small');
  assert.equal(surface.widgets.length, 1);
  assert.equal(surface.hasUnsavedDesktopChanges(), true);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
  assert.equal(surface.editStage, 'decorate');
  surface.canManageDefaultDesktopLayout = true;
  let savedWidgets;
  surface.saveDefaultLayoutToServer = async () => {
    savedWidgets = structuredClone(surface.widgets);
    surface.serverLayoutSavedMutationVersion = surface.serverLayoutMutationVersion;
    surface.serverLayoutSaveState = 'saved';
    return true;
  };
  assert.equal(await surface.saveDesktopEditing(), true);
  assert.equal(savedWidgets[0].widget, 'system.weather');
  request.resolve();
  await pending;
  assert.equal(surface.hasUnsavedDesktopChanges(), false);
  assert.equal(surface.isEditing, false);
});

test('discarding a weather draft during its request is not reversed on completion', async () => {
  const surface = desktopFixture();
  const request = deferred();
  surface.loadWeather = () => request.promise;
  const pending = surface._doAddWidget('system.weather', 'small');
  assert.equal(await surface.exitEditMode(), true);
  request.resolve();
  await pending;
  assert.deepEqual(surface.widgets, []);
  assert.equal(surface.hasUnsavedDesktopChanges(), false);
  assert.equal(surface.selectedDesktopKey, null);
});

test('weather loading failure retains the added layout draft and its dirty state', async () => {
  const surface = desktopFixture();
  surface.loadWeather = async () => { throw new Error('weather runtime unavailable'); };
  await assert.rejects(surface._doAddWidget('system.weather', 'small'), /weather runtime unavailable/);
  assert.equal(surface.widgets[0].widget, 'system.weather');
  assert.equal(surface.hasUnsavedDesktopChanges(), true);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
  assert.equal(surface.editStage, 'decorate');
});

// Uses the production recommendation loop, _doAddWidget, discard and exit.
// Only the external weather read remains pending; no add operation is mocked.
test('discarding recommendations during a real weather add cannot resume adding into the restored layout', async () => {
  const surface = desktopFixture();
  surface.isHome = true;
  const weather = deferred();
  surface.loadWeather = () => weather.promise;
  const applying = surface.applyRecommendedWidgetLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(surface.widgets.map(({ widget }) => widget), ['system.clock', 'system.calendar', 'system.weather']);
  assert.equal(await surface.exitEditMode(), true);
  assert.deepEqual(surface.widgets, []);
  assert.equal(surface.hasUnsavedDesktopChanges(), false);
  weather.resolve();
  await applying;
  assert.deepEqual(surface.widgets, [], 'the old batch must not add latest posts or site statistics after discard');
  assert.equal(surface.hasUnsavedDesktopChanges(), false, 'the old batch must not mark the restored layout dirty');
  assert.equal(surface.selectedDesktopKey, null);
});

test('an old recommendation waiting for weather cannot modify a newly entered editing session', async () => {
  const surface = desktopFixture();
  surface.isHome = true;
  const weather = deferred();
  surface.loadWeather = () => weather.promise;
  const applying = surface.applyRecommendedWidgetLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await surface.exitEditMode(), true);
  surface.enterEditMode('decorate');
  await surface._doAddWidget('system.clock', 'small');
  const newDraft = structuredClone(surface.widgets);
  const newMutationVersion = surface.serverLayoutMutationVersion;
  const newSelection = surface.selectedDesktopKey;
  weather.resolve();
  await applying;
  assert.deepEqual(surface.widgets, newDraft, 'a new active edit session must not inherit the previous batch');
  assert.equal(surface.serverLayoutMutationVersion, newMutationVersion);
  assert.equal(surface.selectedDesktopKey, newSelection);
});

test('weather as the last missing recommendation cannot mark the discarded layout dirty on completion', async () => {
  const surface = desktopFixture();
  surface.isHome = true;
  surface.widgets = ['system.clock', 'system.calendar', 'halo.latest_posts', 'halo.site_stats']
    .map((widget, index) => ({ key: `saved-${index}`, widget, size: 'small', meta: {} }));
  surface.defaultWidgets = structuredClone(surface.widgets);
  const savedLayout = structuredClone(surface.defaultWidgets);
  const weather = deferred();
  surface.loadWeather = () => weather.promise;
  const applying = surface.applyRecommendedWidgetLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(surface.widgets.at(-1).widget, 'system.weather');
  assert.equal(await surface.exitEditMode(), true);
  weather.resolve();
  await applying;
  assert.deepEqual(surface.widgets, savedLayout);
  assert.equal(surface.hasUnsavedDesktopChanges(), false, 'final batch status must not overwrite the discard state');
  assert.equal(surface.serverLayoutSaveState, 'idle');
  assert.equal(surface.serverLayoutSaveMessage, '已放弃未保存更改');
});

test('an active recommendation still completes after weather and retains its saveable draft', async () => {
  const surface = desktopFixture();
  surface.isHome = true;
  surface.loadWeather = async () => {};
  await surface.applyRecommendedWidgetLayout();
  assert.deepEqual(surface.widgets.map(({ widget }) => widget), [
    'system.clock', 'system.calendar', 'system.weather', 'halo.latest_posts', 'halo.site_stats'
  ]);
  assert.equal(surface.hasUnsavedDesktopChanges(), true);
  assert.equal(surface.serverLayoutSaveState, 'dirty');
  assert.equal(surface.serverLayoutSaveMessage, '推荐布局已应用，保存后生效');
});

test('a stale batch owner cannot append through the internal add entry in a new editor', async () => {
  const surface = desktopFixture();
  surface.isHome = true;
  const oldGeneration = surface.widgetConfigAddGeneration || 0;
  surface.finishDesktopEditingSync();
  surface.enterEditMode('decorate');
  const mutationVersion = surface.serverLayoutMutationVersion;
  await surface._doAddWidget('halo.site_stats', 'small', null, {}, oldGeneration);
  assert.deepEqual(surface.widgets, []);
  assert.equal(surface.serverLayoutMutationVersion, mutationVersion);
  assert.equal(surface.selectedDesktopKey, null);
});

function tagStage() {
  const items = [true, false].map((focused) => ({
    focused,
    classList: {
      contains() { return focused; },
      toggle(_name, value) { focused = value; }
    }
  }));
  return {
    visible: true,
    items,
    checkVisibility() { return this.visible; },
    querySelectorAll() { return items; }
  };
}

async function rotationFixture() {
  const timers = [];
  const stages = [];
  globalThis.window = { setTimeout(callback) { timers.push(callback); return timers.length; } };
  globalThis.document = {
    hidden: false,
    querySelector() { return stages[0]; },
    querySelectorAll() { return stages; }
  };
  const url = new URL('../src/widgets/halo/random-tags/render.js', import.meta.url);
  url.searchParams.set('test', Math.random().toString(36));
  return { timers, stages, ...await import(url.href) };
}

const tags = Array.from({ length: 40 }, (_, index) => ({
  metadata: { name: `tag-${index}` },
  spec: { displayName: `标签${index}` },
  status: { permalink: `/tags/tag-${index}`, visiblePostCount: 1 }
}));

test('random tag previews never start a rotation timer', async () => {
  const f = await rotationFixture();
  f.renderWidget({ sources: { randomTags: tags }, escapeHtml: String, mode: 'preview' }, { size: 'small' });
  assert.equal(f.timers.length, 0);
});

test('a hidden random tag stage stops rotating and can restart when visible', async () => {
  const f = await rotationFixture();
  const stage = tagStage();
  f.stages.push(stage);
  assert.equal(f.ensureTagFocusRotation(document), true);
  stage.visible = false;
  f.timers.shift()();
  assert.equal(stage.items[0].classList.contains('is-focus'), true);
  assert.equal(f.timers.length, 0);
  stage.visible = true;
  assert.equal(f.ensureTagFocusRotation(document), true);
  f.timers.shift()();
  assert.equal(stage.items[1].classList.contains('is-focus'), true);
});

test('background documents stop random tag rotation', async () => {
  const f = await rotationFixture();
  f.stages.push(tagStage());
  f.ensureTagFocusRotation(document);
  document.hidden = true;
  f.timers.shift()();
  assert.equal(f.timers.length, 0);
});

test('a hidden first random tag stage does not block another visible stage', async () => {
  const f = await rotationFixture();
  const hidden = tagStage();
  hidden.visible = false;
  const visible = tagStage();
  f.stages.push(hidden, visible);
  assert.equal(f.ensureTagFocusRotation(document), true);
  f.timers.shift()();
  assert.equal(hidden.items[0].classList.contains('is-focus'), true);
  assert.equal(visible.items[1].classList.contains('is-focus'), true);
});

test('daily tags stay stable within the local day and change after local midnight', () => {
  const evening = new Date(2026, 8, 29, 23, 59);
  const morning = new Date(2026, 8, 29, 0, 1);
  const nextDay = new Date(2026, 8, 30, 0, 1);
  assert.deepEqual(selectDailyRandomTags(tags, 8, evening), selectDailyRandomTags(tags, 8, morning));
  assert.notDeepEqual(selectDailyRandomTags(tags, 8, evening), selectDailyRandomTags(tags, 8, nextDay));
});

test('desktop day rollover invalidates cached random tags as well as the calendar', () => {
  const surface = desktopFixture();
  surface.now = new Date(2026, 8, 29, 23, 59);
  const invalidated = [];
  surface.invalidateWidgetCache = (type) => invalidated.push(type);
  assert.equal(surface.syncCalendarDate(new Date(2026, 8, 30, 0, 1)), true);
  assert.deepEqual(invalidated, ['system.calendar', 'halo.random_tags']);
});

test('notification day rollover refreshes random tags even without a calendar widget', () => {
  globalThis.document = { title: '' };
  let factory;
  registerWindowManager({ store() {}, data(name, value) { if (name === 'menuBar') factory = value; } });
  const host = factory();
  host.timeEnabled = false;
  host.notificationWidgets = [{ widget: 'halo.random_tags' }];
  host.notificationCalendarDayKey = '2000-0-1';
  host.notificationWidgetHtmlCache.set('halo.random_tags:small:tags', 'yesterday');
  host.notificationWidgetHtmlCache.set('halo.categories:small:categories', 'keep');
  const renderTick = host.notificationWidgetRenderTick;
  host.tick();
  assert.equal(host.notificationWidgetHtmlCache.has('halo.random_tags:small:tags'), false);
  assert.equal(host.notificationWidgetHtmlCache.get('halo.categories:small:categories'), 'keep');
  assert.equal(host.notificationWidgetRenderTick, renderTick + 1);
});
