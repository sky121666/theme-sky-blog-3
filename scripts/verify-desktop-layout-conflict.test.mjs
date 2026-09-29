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
