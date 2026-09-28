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
  buildUserNotificationUrl,
  formatNotificationTime,
  isNotificationPjaxHref,
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

let widgetConfigFocusCount = 0;
const widgetConfigFixture = {
  widgetConfigForm: { meta: { count: 1 } },
  refreshWidgetConfigPreview() {},
  focusDesktopModal() { widgetConfigFocusCount += 1; }
};
editModeMethods.updateWidgetConfigMeta.call(widgetConfigFixture, 'count', 2);
assert.deepEqual(widgetConfigFixture.widgetConfigForm.meta, { count: 2 });
assert.equal(
  widgetConfigFocusCount,
  0,
  'editing a widget field must not move focus back to the modal entry control'
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
assert.equal(
  normalizeNotificationHref('https://www.5ee.net/archives/example', 'http://localhost:8090', 'https://www.5ee.net'),
  '/archives/example',
  'configured-site absolute links must stay on the active Halo instance'
);
assert.equal(
  normalizeNotificationHref('http://www.5ee.net/console/backup?tab=synchronization', 'http://localhost:8090', 'https://www.5ee.net'),
  '/console/backup?tab=synchronization',
  'historic protocol variants of the configured site must stay on the active Halo instance'
);
assert.equal(isNotificationPjaxHref('/archives/example', origin), true);
assert.equal(isNotificationPjaxHref('/console/backup', origin), false);
assert.equal(isNotificationPjaxHref('https://outside.example.test/notice', origin), false);
const notificationNow = Date.parse('2026-07-23T10:00:00+08:00');
assert.equal(
  formatNotificationTime('2026-07-23T09:55:00+08:00', notificationNow),
  '5分钟前'
);
assert.equal(
  formatNotificationTime('2025-12-30T10:00:00+08:00', notificationNow),
  '2025年12月30日',
  'notifications from another year must keep the year visible'
);

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
    redirected: false,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type'
          ? 'application/json'
          : null;
      }
    },
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

  const makeClick = (target) => {
    let prevented = 0;
    let stopped = 0;
    return {
      target,
      currentTarget: { href: `${origin}/docs` },
      get defaultPrevented() { return prevented > 0; },
      get prevented() { return prevented; },
      get stopped() { return stopped; },
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    };
  };
  const iconClicks = desktopFactory();
  iconClicks.icons = [{ key: 'docs-icon', href: '/docs', pjax: true }];
  const normalIconClick = makeClick({ tagName: 'A' });
  const navigationCountBeforeIcon = notificationNavigations.length;
  iconClicks.handleDesktopIconClick(normalIconClick, 'docs-icon');
  assert.equal(normalIconClick.prevented, 0, 'normal desktop icon clicks must remain available to the document router or browser');
  assert.equal(normalIconClick.stopped, 0);
  assert.equal(notificationNavigations.length, navigationCountBeforeIcon, 'surface must not call pjax.loadUrl for a normal icon click');
  iconClicks.isEditing = true;
  const editingIconClick = makeClick({ tagName: 'A' });
  iconClicks.handleDesktopIconClick(editingIconClick, 'docs-icon');
  assert.equal(editingIconClick.prevented, 1, 'editing must block icon navigation');
  assert.equal(editingIconClick.stopped, 1);
  assert.equal(iconClicks.selectedDesktopKey, 'docs-icon', 'editing an icon should select it');

  const widgetClicks = desktopFactory();
  const gridListeners = [];
  widgetClicks.$refs = {
    grid: {
      addEventListener(type, listener, capture) { gridListeners.push({ type, listener, capture }); }
    }
  };
  widgetClicks.installWidgetClickDelegate();
  assert.equal(gridListeners.length, 1);
  assert.equal(gridListeners[0].type, 'click');
  assert.equal(gridListeners[0].capture, true, 'editing must block widget clicks before document bubbling');
  const widgetLink = {
    href: `${origin}/docs`,
    target: '',
    classList: { contains(name) { return name === 'pjax-link'; } },
    closest() { return null; },
    hasAttribute() { return false; },
    getAttribute(name) { return name === 'href' ? '/docs' : null; }
  };
  const widgetTarget = {
    closest(selector) {
      if (selector === '.desktop-widget-card') return {};
      if (selector === '.desktop-widget-body a[href]') return widgetLink;
      return null;
    }
  };
  const normalWidgetClick = makeClick(widgetTarget);
  const navigationCountBeforeWidget = notificationNavigations.length;
  gridListeners[0].listener(normalWidgetClick);
  assert.equal(normalWidgetClick.prevented, 0, 'normal widget links must reach the document router or browser');
  assert.equal(normalWidgetClick.stopped, 0);
  assert.equal(notificationNavigations.length, navigationCountBeforeWidget, 'surface must not call pjax.loadUrl for a normal widget link');
  widgetClicks.isEditing = true;
  const editingWidgetClick = makeClick(widgetTarget);
  gridListeners[0].listener(editingWidgetClick);
  assert.equal(editingWidgetClick.prevented, 1, 'editing must block widget links');
  assert.equal(editingWidgetClick.stopped, 1);

  const notificationPageUrl = buildUserNotificationUrl('sky user', {
    unreadOnly: true,
    page: 3,
    pageSize: 25
  });
  assert.equal(notificationPageUrl.searchParams.get('page'), '3');
  assert.equal(notificationPageUrl.searchParams.get('size'), '25');
  assert.equal(notificationPageUrl.searchParams.get('fieldSelector'), 'spec.unread=true');

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
  const groupItems = Array.from({ length: 13 }, (_, index) => ({
    key: `group-item-${index}`,
    unread: index < 3,
    dismissed: false
  }));
  const notificationGroup = { key: 'comments', items: groupItems };
  menuBar.notificationShowRead = true;
  assert.equal(menuBar.notificationExpandedItems(notificationGroup).length, 10);
  assert.equal(menuBar.notificationGroupRemainingCount(notificationGroup), 3);
  menuBar.showMoreNotificationGroupItems(notificationGroup);
  assert.equal(menuBar.notificationExpandedItems(notificationGroup).length, 13);
  assert.equal(menuBar.notificationItemActionLabel(groupItems[0]), '标为已读');
  assert.equal(menuBar.notificationItemActionLabel(groupItems[4]), '删除此通知');

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

  menuBar.markNotificationAsRead = async () => true;
  await menuBar.openNotificationItem({ id: 'console', href: '/console/backup', unread: false });
  assert.deepEqual(
    notificationNavigations,
    ['/new', `${origin}/console/backup`],
    'Halo console notifications must use a full navigation instead of PJAX'
  );
  const navigationCountBeforeNoHref = notificationNavigations.length;
  await menuBar.openNotificationItem({ id: 'account', href: '', unread: true });
  assert.equal(
    notificationNavigations.length,
    navigationCountBeforeNoHref,
    'notifications without a real target must remain non-actionable'
  );

  // Deleted content still appears in the theme's raw icon bootstrap with href="#".
  // The visible desktop must omit those entries without rewriting saved layouts.
  const missingContentIcons = [
    { key: 'icon-category-deleted', title: 'Deleted category', href: '#', pjaxApp: 'explorer-categories' },
    { key: 'icon-tag-deleted', title: 'Deleted tag', href: '#', pjaxApp: 'explorer-tags' },
    { key: 'icon-post-deleted', title: 'Deleted post', href: '#', pjaxApp: 'reader' },
    { key: 'icon-page-deleted', title: 'Deleted page', href: '#', pjaxApp: 'reader' }
  ];
  const retainedIcons = [
    { key: 'icon-custom-docs', title: 'Docs', href: '/docs', pjaxApp: '', x: 5, y: 2 },
    { key: 'icon-post-live', title: 'Live post', href: '/archives/live', pjaxApp: 'reader', x: 6, y: 2 }
  ];
  window.__THEME_DESKTOP_PROTOCOL__ = { icons: [...missingContentIcons, ...retainedIcons] };
  const savedIconLayout = {
    hasFullIconDefs: true,
    icons: [...missingContentIcons, ...retainedIcons].map((icon, index) => ({
      ...icon,
      href: icon.key === 'icon-post-deleted' ? '/archives/deleted' : icon.href,
      x: icon.x || index + 1,
      y: icon.y || 1
    }))
  };
  const originalSavedLayout = structuredClone(savedIconLayout);
  const iconDesktop = desktopFactory();
  iconDesktop.widgets = [];
  iconDesktop.currentColumns = 12;
  iconDesktop.maxVisibleRows = 8;
  iconDesktop.bootstrapDesktopIcons(savedIconLayout);
  assert.deepEqual(iconDesktop.icons.map((icon) => [icon.key, icon.href, icon.x, icon.y]), [
    ['icon-custom-docs', '/docs', 5, 2],
    ['icon-post-live', '/archives/live', 6, 2]
  ], 'deleted categories, tags, posts and pages must not remain as clickable # desktop icons');
  assert.deepEqual(savedIconLayout, originalSavedLayout, 'bootstrap must not rewrite the persisted layout');

  const defaultIconDesktop = desktopFactory();
  defaultIconDesktop.widgets = [];
  defaultIconDesktop.bootstrapDesktopIcons();
  assert.deepEqual(defaultIconDesktop.icons.map((icon) => icon.key), ['icon-custom-docs', 'icon-post-live'],
    'a fresh desktop must omit deleted content without a saved layout');

  const legacyIconLayout = { icons: [{ key: 'icon-custom-docs', x: 7, y: 3 }, { key: 'icon-post-live', x: 8, y: 3 }] };
  const legacyIconDesktop = desktopFactory();
  legacyIconDesktop.widgets = [];
  legacyIconDesktop.bootstrapDesktopIcons(legacyIconLayout);
  assert.deepEqual(legacyIconDesktop.icons.map((icon) => [icon.key, icon.x, icon.y]), [
    ['icon-custom-docs', 7, 3], ['icon-post-live', 8, 3]
  ], 'legacy saved positions for valid icons must remain intact');
  delete window.__THEME_DESKTOP_PROTOCOL__;

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
