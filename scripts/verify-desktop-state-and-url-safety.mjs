import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeDesktopIconLayout,
  normalizeDesktopIconHref,
  serializeDesktopIconInstance
} from '../src/shell/desktop-shell/runtime/icons/bootstrap.js';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';
import { dragMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/drag.js';
import { editModeMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js';
import {
  desktopLayoutNeedsDataReload,
  serverLoadedWidgetTypes
} from '../src/shell/desktop-shell/runtime/desktop/surface/data-reload.js';
import {
  normalizeNotificationHref,
  registerWindowManager
} from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { normalizeUrl } from '../src/apps/links/runtime.js';
import * as persistenceWrite from '../src/shell/desktop-shell/runtime/widgets/persistence-write.js';

const origin = 'https://blog.example.test';
const desktopTemplate = readFileSync(new URL('../templates/modules/shell/desktop-widgets.html', import.meta.url), 'utf8');
const desktopSurfaceSource = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/index.js', import.meta.url), 'utf8');

assert.match(desktopTemplate, /:rel="node\.external \? 'noopener noreferrer' : null"/);
assert.match(
  desktopSurfaceSource,
  /const \{ widget, clientX, clientY, pointerId, rect, markup \} = event\.detail;[\s\S]*?beginWidgetDragFromNotification\(widget, \{ clientX, clientY, pointerId, rect, markup \}\);/,
  'notification widget drag relay must preserve the originating pointerId'
);

assert.deepEqual(normalizeDesktopIconHref('/posts/example?from=desktop#top', origin), {
  valid: true,
  href: '/posts/example?from=desktop#top',
  external: false,
  pjax: true
});
assert.deepEqual(normalizeDesktopIconHref('https://outside.example.test/path', origin), {
  valid: true,
  href: 'https://outside.example.test/path',
  external: true,
  pjax: false
});

for (const unsafeHref of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'ftp://outside.example.test/file'
]) {
  assert.equal(normalizeDesktopIconHref(unsafeHref, origin).valid, false, `${unsafeHref} must be rejected for desktop icons`);
  assert.equal(normalizeNotificationHref(unsafeHref, origin), '', `${unsafeHref} must be rejected for notifications`);
  assert.equal(normalizeUrl(unsafeHref), '', `${unsafeHref} must be rejected for link submissions`);
}

assert.equal(normalizeNotificationHref('/moments/example', origin), '/moments/example');
assert.equal(normalizeNotificationHref('https://outside.example.test/notice', origin), 'https://outside.example.test/notice');

assert.deepEqual(serverLoadedWidgetTypes({
  instances: [
    { widget: 'halo.latest_posts' },
    { realNode: { widget: 'plugin-photos.gallery' } },
    { widget: 'halo.latest_posts' }
  ]
}), ['halo.latest_posts', 'plugin-photos.gallery']);
assert.equal(desktopLayoutNeedsDataReload([{ widget: 'system.clock' }], []), false);
assert.equal(desktopLayoutNeedsDataReload([{ widget: 'halo.latest_posts' }], []), true);
assert.equal(desktopLayoutNeedsDataReload([{ widget: 'halo.latest_posts' }], ['halo.latest_posts']), false);
assert.equal(desktopLayoutNeedsDataReload([{ widget: 'plugin-photos.gallery', hidden: true }], []), false);

const serializedUnsafeIcon = serializeDesktopIconInstance({
  key: 'unsafe',
  title: 'Unsafe',
  href: 'javascript:alert(1)',
  x: 1,
  y: 1
});
assert.equal(serializedUnsafeIcon.href, '#');
assert.equal(serializedUnsafeIcon.pjax, false);

const mergedCustomIcons = mergeDesktopIconLayout([], {
  hasFullIconDefs: true,
  icons: [{ key: 'icon-custom-docs', title: 'Docs', href: '/docs', x: 1, y: 1 }]
});
assert.equal(mergedCustomIcons[0]?.href, '/docs', 'saved custom icon definitions must retain their safe href');

let desktopFactory = null;
registerDesktopSurface({
  data(name, factory) {
    assert.equal(name, 'desktopWidgets');
    desktopFactory = factory;
  }
});
assert.equal(typeof desktopFactory, 'function');

let menuBarFactory = null;

function response(payload = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return ''; }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const previousGlobals = new Map(
  ['window', 'document', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
);
let reloadCount = 0;
const notificationNavigations = [];

try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin,
        reload() { reloadCount += 1; },
        assign(href) { notificationNavigations.push(href); }
      },
      pjax: {
        loadUrl(href) { notificationNavigations.push(href); }
      },
      dispatchEvent() {}
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { title: 'Test', cookie: '', body: { dataset: {}, style: {} } }
  });

  registerWindowManager({
    store() {},
    data(name, factory) {
      if (name === 'menuBar') menuBarFactory = factory;
    }
  });
  assert.equal(typeof menuBarFactory, 'function');

  const firstMark = deferred();
  const secondMark = deferred();
  let notificationCloseCount = 0;
  const menuBar = menuBarFactory();
  menuBar.notificationShowRead = true;
  menuBar.markNotificationAsRead = (item) => (
    item.id === 'first' ? firstMark.promise : secondMark.promise
  );
  menuBar.closeNotificationCenter = () => { notificationCloseCount += 1; };

  const firstOpen = menuBar.openNotificationItem({ id: 'first', href: '/old', unread: true });
  const secondOpen = menuBar.openNotificationItem({ id: 'second', href: '/new', unread: true });
  secondMark.resolve(true);
  await secondOpen;
  assert.deepEqual(notificationNavigations, ['/new'], 'the latest notification click should navigate first');
  assert.equal(notificationCloseCount, 1);
  firstMark.resolve(true);
  await firstOpen;
  assert.deepEqual(notificationNavigations, ['/new'], 'a late mark-as-read response must not overwrite the latest navigation');
  assert.equal(notificationCloseCount, 1, 'a stale notification click must not close the center again');

  const desktop = desktopFactory();
  desktop.themeJsonConfigEndpoint = '/apis/theme/config';
  desktop.canManageDefaultDesktopLayout = true;
  desktop.currentColumns = 12;
  desktop.layoutVersion = 'v1';
  desktop.widgets = [{
    key: 'clock',
    title: '保存前',
    widget: 'system.clock',
    size: 'small',
    appearance: 'follow',
    x: 1,
    y: 1,
    baseX: 1,
    baseY: 1,
    w: 2,
    h: 2,
    surface: 'desktop',
    meta: {}
  }];
  desktop.icons = [];
  desktop.ensurePersistenceWriteRuntime = async () => persistenceWrite;

  const slowPut = deferred();
  let requestCount = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requestCount += 1;
    if (options.method === 'PUT') return slowPut.promise;
    return response({ spec: { value: { default_layout: {} } } });
  };

  const firstSave = desktop.saveDefaultLayoutToServer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestCount, 2, 'save should reach the PUT request');

  const concurrentSave = await desktop.saveDefaultLayoutToServer();
  assert.equal(concurrentSave, false, 'a concurrent save must be rejected');
  assert.equal(requestCount, 2, 'a rejected concurrent save must not send another request');

  desktop.widgets[0].title = '保存期间的新修改';
  desktop.markDesktopLayoutDirty();
  slowPut.resolve(response());
  assert.equal(await firstSave, false, 'a completed snapshot must not claim newer edits were saved');
  assert.equal(desktop.defaultWidgets[0].title, '保存前', 'saved defaults must come from the submitted snapshot');
  assert.equal(desktop.widgets[0].title, '保存期间的新修改', 'newer live edits must remain intact');
  assert.equal(desktop.serverLayoutSaveState, 'dirty');

  globalThis.fetch = async (_url, options = {}) => options.method === 'PUT'
    ? response()
    : response({ spec: { value: { default_layout: {} } } });
  assert.equal(await desktop.saveDefaultLayoutToServer(), true, 'a follow-up save should persist the newer snapshot');
  assert.equal(desktop.defaultWidgets[0].title, '保存期间的新修改');
  assert.equal(desktop.serverLayoutSaveState, 'saved');

  desktop.widgets.push({
    ...desktop.widgets[0],
    key: 'latest-posts',
    title: '最新文章',
    widget: 'halo.latest_posts'
  });
  desktop.markDesktopLayoutDirty();
  assert.equal(await desktop.saveDefaultLayoutToServer(), true, 'a newly added Finder-backed widget should save successfully');
  assert.equal(desktop.serverLayoutReloadRequired, true, 'a newly added Finder-backed widget should request one post-save reload');

  let exitedEditMode = 0;
  const saveEditingContext = {
    serverLayoutSaving: false,
    serverLayoutSaveState: 'dirty',
    serverLayoutSaveMessage: '',
    serverLayoutReloadRequired: false,
    canManageDefaultDesktopLayout: true,
    async saveDefaultLayoutToServer() {
      this.serverLayoutReloadRequired = true;
      return true;
    },
    async exitEditMode() {
      exitedEditMode += 1;
    }
  };
  assert.equal(await editModeMethods.saveDesktopEditing.call(saveEditingContext), true);
  assert.equal(exitedEditMode, 1, 'successful desktop save should exit edit mode');
  assert.equal(reloadCount, 1, 'successful save should reload when newly added Finder data is missing');
  assert.equal(saveEditingContext.serverLayoutReloadRequired, false, 'the reload request should be consumed exactly once');

  let dragEnded = 0;
  let reordered = 0;
  const clickOnlyDrag = {
    dragState: {
      active: true,
      pointerId: 7,
      hasMoved: false
    },
    endDrag() { dragEnded += 1; },
    applyNotificationWidgetOrder() { reordered += 1; }
  };
  dragMethods.onDragEnd.call(clickOnlyDrag, { pointerId: 8 });
  assert.equal(dragEnded, 0, 'a different pointer must not finish the active drag');
  dragMethods.onDragEnd.call(clickOnlyDrag, { pointerId: 7 });
  assert.equal(dragEnded, 1, 'a pointerup without movement should end the gesture');
  assert.equal(reordered, 0, 'a pointerup without movement must not reorder notification widgets');
} finally {
  previousGlobals.forEach((descriptor, key) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  });
}

console.log('desktop state and URL safety contracts passed');
