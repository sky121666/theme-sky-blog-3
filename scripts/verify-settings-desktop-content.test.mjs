import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDesktopLayoutJsonToThemeConfig, buildDesktopLayoutJsonString } from '../src/shell/desktop-shell/runtime/widgets/persistence-write.js';
import { parseDesktopLayoutPayload } from '../src/shell/desktop-shell/runtime/widgets/persistence-read.js';
import { mergeDesktopIconLayout, readDesktopIconsBootstrap, serializeDesktopIconInstance } from '../src/shell/desktop-shell/runtime/icons/bootstrap.js';

const moduleUrl = new URL('../src/shell/desktop-shell/runtime/desktop/settings-model/desktop-content.js', import.meta.url);
const { syncDesktopSettingsToLayout: sync } = await import(moduleUrl.href).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
  throw error;
});
const config = (icons, layout) => ({ desktop: { icons }, default_layout: { layout_json: JSON.stringify(layout), future: 'keep' }, custom: { untouched: true } });
const layoutOf = (value) => JSON.parse(value.default_layout.layout_json);
const full = (icons = [], instances = []) => ({ version: 3, layoutVersion: 'v1', columns: 12, hasFullIconDefs: true, icons, instances, future: { keep: true } });

test('no layout and legacy position layouts keep their existing read semantics', () => {
  assert.equal(typeof sync, 'function');
  const icons = { custom_icons: [{ name: '新图标', href: '/new', type: 'folder', external: false }] };
  for (const layout of [undefined, '', 'broken JSON', JSON.stringify({ icons: [{ key: 'old', x: 4, y: 3 }] }), JSON.stringify({ nodes: [{ kind: 'icon', key: 'old', x: 4, y: 3 }] })]) {
    const next = { desktop: { icons }, default_layout: { layout_json: layout } };
    assert.deepEqual(sync(next, ['desktop.icons.custom_icons'], { previousConfig: { desktop: { icons: {} } } }), next);
  }
});

test('editing one custom icon preserves display titles, positions, tombstones, widgets and unknown properties', () => {
  const previous = config({ custom_icons: [
    { name: 'stable', href: '/old', type: 'folder', external: false, custom: { keep: 1 } },
    { name: 'deleted', href: '/gone', type: 'folder', external: false }
  ] }, full([
    { key: 'icon-custom-stable', title: '桌面编辑器自定义标题', href: '/old', subtype: 'folder', external: false, pjax: true, x: 5, y: 4, custom: { keep: 2 } },
    { key: 'icon-custom-deleted', deleted: true, custom: 'tombstone metadata' },
    { key: 'future-owned-icon', title: '未知图标', href: '/future', x: 8, y: 2, custom: { keep: 3 } }
  ], [{ key: 'clock', widget: 'system.clock', size: 'small', x: 1, y: 1, meta: { keep: 4 } }]));
  const next = structuredClone(previous);
  Object.assign(next.desktop.icons.custom_icons[0], { href: '/new', type: 'link', external: true });
  const saved = sync(next, ['desktop.icons.custom_icons'], { previousConfig: previous });
  const layout = layoutOf(saved);
  assert.deepEqual(layout.icons[0], { ...layoutOf(previous).icons[0], href: '/new', subtype: 'link', external: true, pjax: false });
  assert.deepEqual(layout.icons.slice(1), layoutOf(previous).icons.slice(1));
  assert.deepEqual(layout.instances, layoutOf(previous).instances);
  assert.deepEqual(layout.future, { keep: true });
  assert.equal(saved.default_layout.future, 'keep');
  assert.deepEqual(saved.desktop.icons, next.desktop.icons);
  assert.equal(layoutOf(previous).icons[0].href, '/old');
  assert.equal(layoutOf(next).icons[0].href, '/old');
});

test('custom href changes invalidate the old application hint without dropping display metadata', () => {
  const previous = config({ custom_icons: [{ name: 'stable', href: '/categories/a', type: 'folder', external: false }] }, full([
    { key: 'icon-custom-stable', title: '保留桌面标题', href: '/categories/a', subtype: 'folder', external: false, pjax: true,
      pjaxApp: 'explorer-categories', x: 4, y: 5, custom: { keep: true } }
  ]));
  const changedHref = structuredClone(previous);
  changedHref.desktop.icons.custom_icons[0].href = '/moments';
  const saved = layoutOf(sync(changedHref, ['desktop.icons.custom_icons'], { previousConfig: previous }));
  assert.deepEqual(saved.icons[0], { ...layoutOf(previous).icons[0], href: '/moments', pjaxApp: '' });
  const changedType = structuredClone(previous);
  changedType.desktop.icons.custom_icons[0].type = 'link';
  const typeOnly = layoutOf(sync(changedType, ['desktop.icons.custom_icons'], { previousConfig: previous }));
  assert.equal(typeOnly.icons[0].pjaxApp, 'explorer-categories');
});

test('explicit removals leave tombstones while adding resources never revives unrelated removed icons', () => {
  const previous = config({ categories: ['remove', 'dead'], posts: ['keep'] }, full([
    { key: 'icon-category-remove', title: '移除分类', href: '/categories/remove', x: 1, y: 3, custom: 'keep' },
    { key: 'icon-category-dead', deleted: true },
    { key: 'icon-post-keep', title: '原有标题', href: '/keep', x: 2, y: 4 },
    { key: 'icon-category-unmanaged', title: '非后台选择项', href: '/unmanaged', x: 3, y: 4 }
  ]));
  const next = structuredClone(previous);
  next.desktop.icons.categories = ['dead', 'new'];
  const saved = sync(next, ['desktop.icons.categories'], { previousConfig: previous, resources: {
    categories: [{ name: 'new', label: '新分类', permalink: '/categories/new' }]
  } });
  const icons = layoutOf(saved).icons;
  assert.deepEqual(icons.find((icon) => icon.key === 'icon-category-remove'), { ...layoutOf(previous).icons[0], deleted: true });
  assert.deepEqual(icons.find((icon) => icon.key === 'icon-category-dead'), { key: 'icon-category-dead', deleted: true });
  assert.deepEqual(icons.find((icon) => icon.key === 'icon-category-unmanaged'), layoutOf(previous).icons[3]);
  assert.equal(icons.find((icon) => icon.key === 'icon-category-new').href, '/categories/new');
  assert.equal(icons.find((icon) => icon.key === 'icon-category-new').title, '新分类');
  assert.equal(icons.find((icon) => icon.key === 'icon-category-new').pjaxApp, 'explorer-categories');
});

test('new icon placement respects saved icons, widget sizes and each preceding addition', () => {
  const previous = config({ custom_icons: [] }, full([
    { key: 'existing', title: '保留位置', href: '/old', x: 1, y: 3 }
  ], [{ key: 'clock', widget: 'system.clock', size: 'small', x: 1, y: 1 }]));
  const next = structuredClone(previous);
  next.desktop.icons.custom_icons = [
    { name: 'first', href: '/first', type: 'folder', external: false },
    { name: 'second', href: 'https://example.com/second', type: 'link', external: true }
  ];
  const saved = layoutOf(sync(next, ['desktop.icons.custom_icons'], { previousConfig: previous }));
  const first = saved.icons.find((icon) => icon.key === 'icon-custom-first');
  const second = saved.icons.find((icon) => icon.key === 'icon-custom-second');
  assert.deepEqual([first.x, first.y, second.x, second.y], [1, 4, 1, 5]);
  assert.equal(first.title, 'first');
  assert.equal(second.external, true);
  assert.equal(second.pjax, false);
  assert.deepEqual(saved.icons[0], layoutOf(previous).icons[0]);
});

test('content additions require available API resources; removals and unchanged selections do not', () => {
  const previous = config({ single_pages: ['old'] }, full([{ key: 'icon-page-old', href: '/old', title: '原页', x: 1, y: 1 }]));
  const added = structuredClone(previous);
  added.desktop.icons.single_pages.push('new');
  for (const resources of [undefined, { singlepages: [] }, { singlepages: [{ name: 'new', label: '未发布', permalink: '/new', disabled: true }] }, { singlepages: [{ name: 'new', label: '无地址' }] }]) {
    assert.throws(() => sync(added, ['desktop.icons.single_pages'], { previousConfig: previous, resources }), /new|资源|单页/);
  }
  const saved = layoutOf(sync(added, ['desktop.icons.single_pages'], { previousConfig: previous, resources: { singlepages: [{ name: 'new', label: '新单页', permalink: '/new' }] } }));
  assert.equal(saved.icons.find((icon) => icon.key === 'icon-page-new').pjaxApp, 'reader');
  const removed = structuredClone(previous);
  removed.desktop.icons.single_pages = [];
  assert.equal(layoutOf(sync(removed, ['desktop.icons.single_pages'], { previousConfig: previous })).icons[0].deleted, true);
  assert.deepEqual(sync(previous, ['desktop.icons.single_pages'], { previousConfig: previous }), previous);
});

test('only explicitly changed groups synchronize and config envelopes retain metadata', () => {
  const previous = config({ tags: ['old'] }, full([{ key: 'icon-tag-old', href: '/tags/old', title: '旧标签', x: 1, y: 1 }]));
  const changed = structuredClone(previous);
  changed.desktop.icons.tags = [];
  assert.deepEqual(sync(changed, ['header.logo.title'], { previousConfig: previous }), changed);
  for (const key of ['data', 'spec']) {
    const wrap = (value) => key === 'data' ? { data: value, metadata: { version: 12 } } : { spec: { value }, metadata: { version: 12 } };
    const saved = sync(wrap(changed), ['desktop.icons.tags'], { previousConfig: wrap(previous) });
    assert.deepEqual(saved.metadata, { version: 12 });
    assert.equal(layoutOf(key === 'data' ? saved.data : saved.spec.value).icons[0].deleted, true);
  }
  const stringGroup = structuredClone(changed);
  stringGroup.default_layout = JSON.stringify(changed.default_layout);
  const stringSaved = sync(stringGroup, ['desktop.icons.tags'], { previousConfig: previous });
  assert.equal(typeof stringSaved.default_layout, 'string');
  assert.equal(JSON.parse(JSON.parse(stringSaved.default_layout).layout_json).icons[0].deleted, true);
});

test('desktop editor writes update existing custom link properties without changing stable names or metadata', () => {
  const previous = config({ custom_icons: [{ name: 'stable', href: '/old', type: 'folder', external: false, custom: { keep: true } }] }, full());
  const payload = full([{ key: 'icon-custom-stable', title: '用户另起的标题', href: '/new', subtype: 'link', external: true, x: 4, y: 3 }]);
  const saved = applyDesktopLayoutJsonToThemeConfig(previous, JSON.stringify(payload));
  assert.deepEqual(saved.desktop.icons.custom_icons, [{ name: 'stable', href: '/new', type: 'link', external: true, custom: { keep: true } }]);
  assert.equal(previous.desktop.icons.custom_icons[0].href, '/old');
  const stringGroup = structuredClone(previous);
  stringGroup.default_layout = JSON.stringify(previous.default_layout);
  assert.equal(applyDesktopLayoutJsonToThemeConfig(stringGroup, JSON.stringify(payload)).desktop.icons.custom_icons[0].href, '/new');
});

test('legacy position saves cannot erase custom links, and content tombstones match object selections by identity', () => {
  const previous = config({
    custom_icons: [{ name: 'stable', href: '/old', type: 'link', external: true, custom: 'keep' }],
    categories: [{ name: 'removed', label: '旧分类', custom: 'keep' }, { metadata: { name: 'kept' }, custom: 'keep' }]
  }, full());
  const positionOnly = JSON.stringify({ icons: [{ key: 'icon-custom-stable', x: 5, y: 6 }] });
  assert.deepEqual(applyDesktopLayoutJsonToThemeConfig(previous, positionOnly).desktop.icons.custom_icons, previous.desktop.icons.custom_icons);
  const deleted = applyDesktopLayoutJsonToThemeConfig(previous, JSON.stringify(full([{ key: 'icon-category-removed', deleted: true }])));
  assert.deepEqual(deleted.desktop.icons.categories, [{ metadata: { name: 'kept' }, custom: 'keep' }]);
});

test('saving, parsing and merging full desktop definitions keeps titles, links and tombstones', () => {
  const serialized = buildDesktopLayoutJsonString('v1', [], [
    { key: 'icon-custom-stable', title: '前端标题', href: '/new', pjax: true, subtype: 'document', x: 4, y: 3 },
    { key: 'icon-custom-deleted', deleted: true }
  ], 12);
  const parsed = parseDesktopLayoutPayload(serialized, 'v1');
  assert.equal(parsed.hasFullIconDefs, true);
  assert.deepEqual(parsed.icons[1], { key: 'icon-custom-deleted', deleted: true });
  const merged = mergeDesktopIconLayout([
    { key: 'icon-custom-stable', title: '后台名称', href: '/old', subtype: 'folder' },
    { key: 'icon-custom-deleted', title: '不要复活', href: '/deleted' },
    { key: 'backend-only', title: '不要注入完整布局', href: '/backend' }
  ], parsed);
  assert.deepEqual(merged.map(({ key, title, href, subtype, x, y }) => ({ key, title, href, subtype, x, y })), [
    { key: 'icon-custom-stable', title: '前端标题', href: '/new', subtype: 'document', x: 4, y: 3 }
  ]);
  assert.equal(parseDesktopLayoutPayload(JSON.stringify({ nodes: [], hasFullIconDefs: true }), 'v1').hasFullIconDefs, undefined);
});

test('explicit new-window flags survive backend bootstrap, saving, layout reads and reserialization', () => {
  const previousWindow = globalThis.window;
  const inputs = [
    { key: 'same-new', title: '同站新窗口', href: '/same', external: true, pjax: true },
    { key: 'outside-current', title: '外站当前窗口', href: 'https://outside.example/path', external: false, pjax: true },
    { key: 'same-default', title: '同站旧默认', href: '/default' },
    { key: 'outside-default', title: '外站旧默认', href: 'https://outside.example/default' },
    { key: 'same-no-pjax', title: '停用PJAX', href: '/no-pjax', external: false, pjax: false }
  ];
  try {
    globalThis.window = { location: { origin: 'https://theme.example' }, __THEME_DESKTOP_PROTOCOL__: { icons: inputs } };
    const bootstrap = readDesktopIconsBootstrap();
    const behavior = (icons) => icons.map(({ key, external, pjax }) => ({ key, external, pjax }));
    const expected = [
      { key: 'same-new', external: true, pjax: false },
      { key: 'outside-current', external: false, pjax: false },
      { key: 'same-default', external: false, pjax: true },
      { key: 'outside-default', external: true, pjax: false },
      { key: 'same-no-pjax', external: false, pjax: false }
    ];
    assert.deepEqual(behavior(bootstrap), expected);
    const saved = buildDesktopLayoutJsonString('v1', [], inputs.map((icon, index) => ({ ...icon, x: index + 1, y: 1 })), 12);
    const read = parseDesktopLayoutPayload(saved, 'v1');
    assert.deepEqual(behavior(read.icons), expected);
    const merged = mergeDesktopIconLayout([], read);
    assert.deepEqual(behavior(merged), expected);
    assert.deepEqual(behavior(merged.map(serializeDesktopIconInstance)), expected);
  } finally { globalThis.window = previousWindow; }
});
