import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';
import * as persistenceWrite from '../src/shell/desktop-shell/runtime/widgets/persistence-write.js';

const helperUrl = new URL('../src/shell/desktop-shell/runtime/widgets/persistence-conflict.js', import.meta.url);
const helper = await import(helperUrl.href).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === helperUrl.href) return {};
  throw error;
});
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.document = originalDocument; });
const oldLayout = JSON.stringify({ version: 3, layoutVersion: 'v1', hasFullIconDefs: true, icons: [{ key: 'old', href: '/old' }], instances: [] });
const newLayout = JSON.stringify({ version: 3, layoutVersion: 'v1', hasFullIconDefs: true, icons: [{ key: 'new', href: '/new' }], instances: [] });
const config = (layout) => ({ default_layout: { layout_json: layout, future: 'keep' }, desktop: { icons: {} } });
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function fixture(latest = config(oldLayout), settings = {}) {
  let factory;
  registerDesktopSurface({ data(_name, value) { factory = value; }, store: () => settings });
  const surface = factory();
  surface.themeJsonConfigEndpoint = '/fixture/theme-config';
  surface.canManageDefaultDesktopLayout = true;
  surface.serverLayoutJson = oldLayout;
  surface.serverLayoutMutationVersion = 3;
  surface.serverLayoutSavedMutationVersion = 2;
  surface.icons = [{ key: 'local', title: '当前未保存图标', href: '/local' }];
  surface.widgets = [];
  surface.iconTombstones = [];
  surface.ensurePersistenceWriteRuntime = async () => persistenceWrite;
  surface.syncLayoutSnapshotAsDefaults = () => {};
  let reads = 0;
  const writes = [];
  globalThis.document = { cookie: '', body: { dataset: {} } };
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') { writes.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
    reads++;
    return json(latest);
  };
  return { surface, settings, writes, readCount: () => reads };
}

test('layout baseline comparison resolves every config envelope and stringified group', () => {
  assert.equal(typeof helper.assertDesktopLayoutBaseline, 'function');
  for (const wrap of [(value) => value, (value) => ({ spec: { value }, metadata: { keep: 1 } }), (data) => ({ data })]) {
    for (const group of [{ layout_json: oldLayout }, JSON.stringify({ layout_json: oldLayout, future: true })]) {
      const source = wrap({ default_layout: group });
      assert.doesNotThrow(() => helper.assertDesktopLayoutBaseline(source, oldLayout));
      assert.throws(() => helper.assertDesktopLayoutBaseline(source, newLayout), { code: 'layout-conflict' });
    }
  }
  assert.doesNotThrow(() => helper.assertDesktopLayoutBaseline({}, ''));
  assert.doesNotThrow(() => helper.assertDesktopLayoutBaseline({ default_layout: { layout_json: null } }, ''));
});

test('a stale layout editor never PUTs over a newer server layout and retains its draft', async () => {
  const f = fixture(config(newLayout));
  assert.equal(await f.surface.saveLayoutJsonToServer(oldLayout), false);
  assert.equal(f.readCount(), 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.serverLayoutSaveState, 'failed');
  assert.match(f.surface.serverLayoutSaveMessage, /刷新/);
  assert.match(f.surface.serverLayoutSaveMessage, /保留/);
  assert.equal(f.surface.serverLayoutJson, oldLayout);
  assert.equal(f.surface.serverLayoutSavedMutationVersion, 2);
  assert.equal(f.surface.icons[0].title, '当前未保存图标');
  assert.equal(f.surface.serverLayoutSaving, false);
});

test('unchanged layout baselines save successfully and advance only after PUT succeeds', async () => {
  const f = fixture();
  assert.equal(await f.surface.saveLayoutJsonToServer(newLayout), true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].default_layout.layout_json, newLayout);
  assert.equal(f.writes[0].default_layout.future, 'keep');
  assert.equal(f.surface.serverLayoutJson, newLayout);
  assert.equal(f.surface.serverLayoutSavedMutationVersion, 3);
});

test('lazy resource failures retain the layout draft and allow a successful save retry', async () => {
  const f = fixture();
  f.surface.ensurePersistenceWriteRuntime = async () => {
    throw new TypeError('Failed to fetch dynamically imported module: http://localhost/fixture.js');
  };
  assert.equal(await f.surface.saveLayoutJsonToServer(newLayout), false);
  assert.match(f.surface.serverLayoutSaveMessage, /资源加载失败.*当前编辑内容已保留/);
  assert.doesNotMatch(f.surface.serverLayoutSaveMessage, /http:|TypeError/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.serverLayoutSaving, false);
  assert.equal(f.surface.serverLayoutJson, oldLayout);
  assert.equal(f.surface.serverLayoutSavedMutationVersion, 2);
  assert.equal(f.surface.icons[0].title, '当前未保存图标');
  f.surface.ensurePersistenceWriteRuntime = async () => persistenceWrite;
  assert.equal(await f.surface.saveLayoutJsonToServer(newLayout), true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.surface.serverLayoutSaveState, 'saved');
});

test('the real default-layout entry handles serializer import failure before preparing a save', async () => {
  const f = fixture();
  f.surface.ensurePersistenceWriteRuntime = async () => {
    throw new TypeError('Failed to fetch dynamically imported module: http://localhost/persistence-write.js');
  };
  assert.equal(await f.surface.saveDefaultLayoutToServer(), false);
  assert.equal(f.surface.serverLayoutSaveState, 'failed');
  assert.match(f.surface.serverLayoutSaveMessage, /资源加载失败.*当前编辑内容已保留/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.icons[0].title, '当前未保存图标');
  f.surface.ensurePersistenceWriteRuntime = async () => persistenceWrite;
  assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
  assert.equal(f.writes.length, 1);
});

test('same-page icon settings invalidate legacy layouts even when layout JSON is unchanged', async () => {
  const f = fixture(config(oldLayout), { desktopLayoutReloadRequired: true });
  assert.equal(await f.surface.saveLayoutJsonToServer(newLayout), false);
  assert.equal(f.readCount(), 0);
  assert.equal(f.writes.length, 0);
  assert.match(f.surface.serverLayoutSaveMessage, /刷新/);
  assert.equal(f.surface.icons[0].title, '当前未保存图标');
});

test('icon changes while waiting for the current config also stop the pending layout PUT', async () => {
  const f = fixture();
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') { f.writes.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
    f.settings.desktopLayoutReloadRequired = true;
    return json(config(oldLayout));
  };
  assert.equal(await f.surface.saveLayoutJsonToServer(newLayout), false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.serverLayoutJson, oldLayout);
  assert.equal(f.surface.serverLayoutSavedMutationVersion, 2);
});

const customLayout = (icons) => JSON.stringify({ hasFullIconDefs: true, icons, instances: [] });
const baseIcon = { key: 'icon-custom-demo', href: '/old', subtype: 'folder', external: false, x: 1 };
const customConfig = (items) => ({ default_layout: { layout_json: customLayout([baseIcon]) }, desktop: { icons: { custom_icons: items } } });
const baseItem = { name: 'demo', href: '/old', type: 'folder', external: false };

test('moving a custom icon preserves remote fields, additions and metadata in config and layout', () => {
  const latest = customConfig([{ ...baseItem, href: '/admin', type: 'file', external: true, future: 7 }, { name: 'added', href: '/added', type: 'link' }]);
  for (const wrap of [(v) => v, (v) => ({ data: v }), (v) => ({ spec: { value: v } })]) {
    const result = persistenceWrite.applyDesktopLayoutJsonToThemeConfig(wrap(latest), customLayout([{ ...baseIcon, x: 5 }]), customLayout([baseIcon]));
    const saved = result.spec?.value ?? result.data ?? result;
    assert.deepEqual(saved.desktop.icons.custom_icons, latest.desktop.icons.custom_icons);
    const icons = JSON.parse(saved.default_layout.layout_json).icons;
    assert.equal(icons[0].href, '/admin');
    assert.equal(icons[0].subtype, 'file');
    assert.equal(icons[0].external, true);
    assert.equal(icons[0].x, 5);
    assert.equal(icons[1].key, 'icon-custom-added');
  }
});

test('same custom field edited remotely and locally prevents PUT and retains draft', async () => {
  const latest = customConfig([{ ...baseItem, href: '/admin' }]);
  const f = fixture(latest);
  f.surface.serverLayoutJson = customLayout([baseIcon]);
  assert.equal(await f.surface.saveLayoutJsonToServer(customLayout([{ ...baseIcon, href: '/local' }])), false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.icons[0].title, '当前未保存图标');
});

test('local field edits merge independent remote changes and remote deletion is never resurrected', () => {
  const baseline = customLayout([baseIcon]);
  const local = customLayout([{ ...baseIcon, href: '/local' }]);
  const saved = persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([{ ...baseItem, type: 'file' }]), local, baseline);
  assert.deepEqual(saved.desktop.icons.custom_icons, [{ ...baseItem, href: '/local', type: 'file' }]);
  const removed = persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([]), customLayout([{ ...baseIcon, x: 5 }]), baseline);
  assert.deepEqual(removed.desktop.icons.custom_icons, []);
  assert.equal(JSON.parse(removed.default_layout.layout_json).icons[0].deleted, true);
  assert.throws(() => persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([]), local, baseline), { code: 'layout-conflict' });
});

test('new tombstones conflict with remote edits while old tombstones preserve remote readdition', () => {
  const baseline = customLayout([baseIcon]);
  const deleted = customLayout([{ key: baseIcon.key, deleted: true }]);
  assert.throws(() => persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([{ ...baseItem, href: '/admin' }]), deleted, baseline), { code: 'layout-conflict' });
  assert.deepEqual(persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([baseItem]), deleted, baseline).desktop.icons.custom_icons, []);
  const readded = persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([baseItem]), deleted, deleted);
  assert.deepEqual(readded.desktop.icons.custom_icons, [baseItem]);
  assert.equal(JSON.parse(readded.default_layout.layout_json).icons[0].deleted, undefined);
});

test('a merged save advances to the actual saved baseline and a second move retains admin fields', async () => {
  let latest = customConfig([{ ...baseItem, href: '/admin' }]);
  const f = fixture(latest);
  f.surface.serverLayoutJson = customLayout([baseIcon]);
  f.surface.icons = [{ ...baseIcon, x: 5 }];
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') { latest = JSON.parse(options.body); f.writes.push(latest); return new Response(null, { status: 204 }); }
    return json(latest);
  };
  assert.equal(await f.surface.saveLayoutJsonToServer(customLayout(f.surface.icons)), true);
  assert.equal(f.surface.serverLayoutJson, latest.default_layout.layout_json);
  assert.equal(f.surface.icons[0].href, '/admin');
  f.surface.icons[0].x = 6;
  f.surface.serverLayoutMutationVersion++;
  assert.equal(await f.surface.saveLayoutJsonToServer(customLayout(f.surface.icons)), true);
  assert.equal(latest.desktop.icons.custom_icons[0].href, '/admin');
});

test('pending local deletions and new field edits survive reconciliation after PUT', async () => {
  const latest = customConfig([{ ...baseItem, href: '/admin' }]);
  const f = fixture(latest);
  f.surface.serverLayoutJson = customLayout([baseIcon]);
  f.surface.icons = [{ ...baseIcon, x: 5 }];
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      f.surface.icons[0].href = '/pending-edit';
      f.surface.iconTombstones.push({ key: 'icon-custom-other', deleted: true });
      f.surface.serverLayoutMutationVersion++;
      f.writes.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    return json(latest);
  };
  assert.equal(await f.surface.saveLayoutJsonToServer(customLayout(f.surface.icons)), false);
  assert.equal(f.surface.icons[0].href, '/pending-edit');
  assert.deepEqual(f.surface.iconTombstones, [{ key: 'icon-custom-other', deleted: true }]);
  assert.equal(f.surface.serverLayoutSaveState, 'dirty');
});

test('a baseline without definitions protects ambiguous custom edits but allows position saves', () => {
  const latest = customConfig([baseItem]);
  const baseline = JSON.stringify({ icons: [{ key: baseIcon.key, x: 1 }] });
  const position = JSON.stringify({ icons: [{ key: baseIcon.key, x: 3 }] });
  assert.deepEqual(persistenceWrite.applyDesktopLayoutJsonToThemeConfig(latest, position, baseline).desktop.icons.custom_icons, [baseItem]);
  assert.throws(() => persistenceWrite.applyDesktopLayoutJsonToThemeConfig(latest, customLayout([{ ...baseIcon, href: '/edit' }]), baseline), { code: 'layout-conflict' });
});

test('remote link edits clear obsolete application hints while keeping layout metadata', () => {
  const icon = { ...baseIcon, pjaxApp: 'reader', future: { keep: 1 } };
  const result = persistenceWrite.applyDesktopLayoutJsonToThemeConfig(customConfig([{ ...baseItem, href: '/admin' }]), customLayout([{ ...icon, x: 4 }]), customLayout([icon]));
  const saved = JSON.parse(result.default_layout.layout_json).icons[0];
  assert.equal(saved.pjaxApp ?? '', '');
  assert.deepEqual(saved.future, { keep: 1 });
});

function liveCustomFixture(latest, icons = [{ ...baseIcon, x: 1, y: 2, baseX: 1, baseY: 2 }], baseline = customLayout([baseIcon])) {
  const f = fixture(latest);
  f.surface.serverLayoutJson = baseline;
  f.surface.icons = icons;
  let current = latest;
  f.onPut = () => {};
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') { current = JSON.parse(options.body); f.writes.push(current); f.onPut(); return new Response(null, { status: 204 }); }
    return json(current);
  };
  return f;
}

test('actual serializer saves reject unsafe remote href before PUT and preserve the draft', async () => {
  const f = liveCustomFixture(customConfig([{ ...baseItem, href: 'javascript:alert(1)' }]));
  assert.equal(await f.surface.saveDefaultLayoutToServer(), false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.surface.icons[0].href, '/old');
});

test('valid normalized remote links survive actual serializer and consecutive saves', async () => {
  const f = liveCustomFixture(customConfig([{ ...baseItem, href: '  /admin/../new  ' }]));
  assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
  assert.equal(f.surface.icons[0].href, '/new');
  f.surface.serverLayoutMutationVersion++;
  assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
  assert.equal(f.writes[1].desktop.icons.custom_icons[0].href, '  /admin/../new  ');
});

test('remote readdition restores old tombstoned icon to UI without resurrecting a pending delete', async () => {
  for (const pendingDelete of [false, true]) {
    const deleted = { key: baseIcon.key, deleted: true };
    const latest = customConfig([baseItem]);
    latest.default_layout.layout_json = customLayout([deleted]);
    const f = liveCustomFixture(latest, [], customLayout([deleted]));
    f.surface.iconTombstones = [deleted];
    f.onPut = () => { if (pendingDelete) { f.surface.serverLayoutMutationVersion++; f.surface.iconTombstones.push({ ...deleted }); } };
    assert.equal(await f.surface.saveDefaultLayoutToServer(), !pendingDelete);
    assert.equal(f.surface.icons.some((icon) => icon.key === baseIcon.key), !pendingDelete);
  }
});

test('remote additions receive free persisted positions before UI and baseline advancement', async () => {
  const f = liveCustomFixture(customConfig([baseItem, { name: 'added', href: '/added', type: 'file' }]));
  f.surface.widgets = [{ key: 'clock', widget: 'system.clock', size: 'small', x: 1, y: 1, baseX: 1, baseY: 1 }];
  assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
  const icons = JSON.parse(f.writes[0].default_layout.layout_json).icons;
  const old = icons.find((icon) => icon.key === baseIcon.key);
  const added = icons.find((icon) => icon.key === 'icon-custom-added');
  assert.deepEqual([old.x, old.y], [1, 2]);
  assert.ok(Number.isInteger(added.x) && Number.isInteger(added.y));
  assert.notDeepEqual([added.x, added.y], [1, 2]);
  assert.ok(added.x > 2 || added.y > 2);
  f.surface.serverLayoutMutationVersion++;
  assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
  assert.equal(f.writes[1].desktop.icons.custom_icons[1].type, 'file');
  assert.deepEqual(JSON.parse(f.writes[1].default_layout.layout_json).icons.map(({ key, x, y }) => ({ key, x, y })), icons.map(({ key, x, y }) => ({ key, x, y })));
});

for (const sameName of [false, true]) test(`pending real addCustomIcon ${sameName ? 'same-name conflict blocks next PUT' : 'gets collision-free remote reconciliation'}`, async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://theme.example' } };
  try {
    const f = liveCustomFixture(customConfig([baseItem, { name: 'same', href: '/remote', type: 'folder', external: false }]));
    f.surface.normalizeVisibleLayout = () => {};
    f.surface.syncResponsiveVisibility = () => {};
    f.onPut = () => {
      f.onPut = () => {};
      assert.equal(f.surface.addCustomIcon(sameName ? 'same' : 'local', '/local'), true);
      if (!sameName) f.surface.widgets.push({ key: 'pending-clock', widget: 'system.clock', size: 'small', x: 1, y: 3, w: 2, h: 2 });
    };
    assert.equal(await f.surface.saveDefaultLayoutToServer(), false);
    const saved = JSON.parse(f.writes[0].default_layout.layout_json).icons.find((icon) => icon.key === 'icon-custom-same');
    assert.deepEqual([saved.x, saved.y], [1, 1]);
    assert.equal(f.surface.serverLayoutJson, f.writes[0].default_layout.layout_json);
    if (sameName) {
      assert.equal(f.surface.icons.find((icon) => icon.key === 'icon-custom-same').href, '/local');
      assert.equal(await f.surface.saveDefaultLayoutToServer(), false);
      assert.equal(f.writes.length, 1);
      // Explicitly adopting the saved definition resolves the conflict.
      f.surface.icons.find((icon) => icon.key === 'icon-custom-same').href = '/remote';
      assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
    } else {
      const positions = f.surface.icons.map((icon) => `${icon.baseX ?? icon.x},${icon.baseY ?? icon.y}`);
      assert.equal(new Set(positions).size, positions.length);
      const remote = f.surface.icons.find((icon) => icon.key === 'icon-custom-same');
      assert.ok(remote.x > 2 || remote.y > 4);
      assert.equal(await f.surface.saveDefaultLayoutToServer(), true);
      const persisted = JSON.parse(f.writes[1].default_layout.layout_json).icons;
      assert.equal(new Set(persisted.map((icon) => `${icon.x},${icon.y}`)).size, persisted.length);
    }
  } finally { globalThis.window = previousWindow; }
});
