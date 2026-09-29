import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsAssetPicker } from '../src/shell/desktop-shell/runtime/desktop/settings-assets/picker.js';

test('搜索防抖合并输入；切换图标集或关闭重开图片时不重放旧输入', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const iconCalls = [];
  const imageCalls = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => '' }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({
      listIconCollections: async () => ({ collections: [{ prefix: 'mdi', name: 'MDI' }] }),
      searchIcons: async (options) => { iconCalls.push(options); return { icons: [], hasMore: false }; }
    }),
    loadAttachmentClient: async () => ({
      listAttachments: async (options) => { imageCalls.push(options); return { items: [{ url: '/image.png' }], totalPages: 1 }; }
    })
  });
  await picker.openIcon('header.logo.icon');
  picker.query = 'h'; picker.scheduleSearch();
  t.mock.timers.tick(200);
  picker.query = 'home'; picker.scheduleSearch();
  t.mock.timers.tick(299);
  assert.equal(iconCalls.length, 1, '输入期间不请求中间关键词');
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(iconCalls.length, 2);
  assert.equal(iconCalls.at(-1).query, 'home');

  picker.query = 'arrow'; picker.scheduleSearch();
  await picker.switchIconCollection('mdi');
  assert.equal(iconCalls.length, 3);
  t.mock.timers.tick(300);
  await new Promise(setImmediate);
  assert.equal(iconCalls.length, 3, '切换集合已立即查询，旧防抖不能再次请求');

  picker.query = 'search'; picker.scheduleSearch();
  picker.close();
  await picker.openImage('desktop.background.image_url');
  t.mock.timers.tick(300);
  await new Promise(setImmediate);
  assert.equal(iconCalls.length, 3);
  assert.equal(imageCalls.length, 1, '重开图片列表不能接收旧图标输入回调');
  assert.equal(picker.items[0].url, '/image.png');
  picker.close();
});

test('changing icon width preserves an existing three-digit hex color', async () => {
  const current = { value: '<svg/>', name: 'lucide:book', width: '24', color: '#aBc', custom: { source: 'console' } };
  let saved;
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, saving: false, value: () => current, update: (_path, value) => { saved = value; } }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) }),
    loadIconFormatter: async () => ({ makeThemeIcon: (icon, options) => ({ value: icon.svg, name: icon.name, color: options.color, width: String(options.width) }) })
  });
  await picker.openIcon('douban.profile.icon');
  assert.equal(picker.iconUseColor, true);
  assert.equal(picker.iconColor.toLowerCase(), '#aabbcc');
  picker.iconWidth = 32;
  await picker.confirm();
  assert.equal(saved.color.toLowerCase(), '#aabbcc');
  assert.equal(saved.width, '32');
  assert.deepEqual(saved.custom, current.custom);
});

function fixture(client = {}) {
  const changes = [];
  const settings = { canOpen: true, visible: true, saving: false, value: () => '', setImage: (...args) => changes.push(args), update: (...args) => changes.push(args) };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const picker = createSettingsAssetPicker({ getSettings: () => settings, getDialog: () => dialog, getActiveElement: () => null, loadAttachmentClient: async () => client });
  return { picker, settings, changes, dialog };
}

test('选择器按目标字段传递图片格式，Steam 封面与墙纸独立', async () => {
  const accepts = [];
  const f = fixture({ listAttachments: async (options) => { accepts.push(options.accepts); return { items: [], totalPages: 1 }; } });
  await f.picker.openImage('desktop.background.image_url');
  assert.ok(accepts[0]?.includes('image/svg+xml'));
  await f.picker.openImage('steam.cover.image_url');
  assert.equal(f.picker.path, 'steam.cover.image_url');
  assert.deepEqual(accepts[1], ['image/png', 'image/jpeg', 'image/webp']);
  assert.deepEqual(f.changes, []);
});

test('回退封面拒绝附件库中不适用的 SVG', async () => {
  const f = fixture({ listAttachments: async () => ({ items: [], totalPages: 1 }) });
  await f.picker.openImage('widgets.behavior.fallback_cover');
  f.picker.selectImage({ url: '/image.svg', mediaType: 'image/svg+xml' });
  assert.equal(f.picker.selectedUrl, '');
  assert.ok(f.picker.error);
});

test('图片地址也拒绝当前字段不接受的可识别格式', async () => {
  const f = fixture({ listAttachments: async () => ({ items: [], totalPages: 1 }) });
  await f.picker.openImage('widgets.behavior.fallback_cover');
  f.picker.urlInput = '/uploads/cover.svg?size=100';
  f.picker.useUrl();
  assert.equal(f.picker.selectedUrl, '');
  assert.ok(f.picker.error);
});

test('图标格式化模块失败展示错误并允许重试', async () => {
  const settings = { canOpen: true, visible: true, value: () => ({ value: '<svg/>', name: '' }) };
  const picker = createSettingsAssetPicker({ getSettings: () => settings,
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconFormatter: async () => { throw new Error('图标组件加载失败'); },
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) }) });
  await assert.doesNotReject(() => picker.openIcon('header.logo.icon'));
  assert.equal(picker.iconPreviewError, '图标组件加载失败');
  assert.equal(picker.error, '');
});

test('已有图标预览成功不能覆盖搜索失败；再次搜索保留选中项', async () => {
  let fail = true;
  const current = { value: '<svg/>', name: 'lucide:house' };
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => current }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconFormatter: async () => ({ makeThemeIcon: (icon) => ({ value: icon.svg }) }),
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => {
      if (fail) throw new Error('图标库暂时无法访问');
      return { icons: [{ name: 'lucide:search', svg: '<svg/>' }], total: 1, hasMore: true, notice: '1 个图标暂时无法加载' };
    } })
  });
  await picker.openIcon('header.logo.icon');
  assert.equal(picker.error, '图标库暂时无法访问');
  assert.equal(picker.iconPreview, '<svg/>');
  assert.equal(picker.iconPreviewError, '');
  fail = false;
  await picker.search();
  assert.equal(picker.error, '');
  assert.equal(picker.selectedIcon.name, 'lucide:house');
  assert.equal(picker.hasMore, true);
  assert.equal(picker.notice, '1 个图标暂时无法加载');
});

test('切换图标集重置分页，忽略旧响应和迟到的分批结果', async () => {
  let finish;
  let progress;
  const requests = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => '' }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [{ prefix: 'mdi', name: 'Material Design' }] }), searchIcons: async ({ collection, query, page, onProgress }) => {
      requests.push({ collection, query, page });
      if (!collection) { progress = onProgress; return new Promise((resolve) => { finish = resolve; }); }
      return { icons: [{ name: 'mdi:home' }], total: 1 };
    } })
  });
  const opening = picker.openIcon('header.logo.icon');
  await new Promise((done) => setImmediate(done));
  await picker.switchIconCollection('mdi');
  assert.equal(picker.iconCollection, 'mdi');
  assert.equal(picker.busy, false);
  progress?.({ icons: [{ name: 'lucide:stale-progress' }], total: 1 });
  finish({ icons: [{ name: 'lucide:old' }], total: 1 });
  await opening;
  assert.equal(picker.items[0].name, 'mdi:home');
  await picker.search(2);
  assert.equal(requests.at(-1).page, 2);
  await picker.searchIconSuggestion('首页');
  assert.equal(picker.query, '首页');
  assert.equal(requests.at(-1).page, 1);
  assert.equal(picker.items[0].name, 'mdi:home');
  await picker.switchIconCollection('unknown');
  assert.equal(picker.iconCollection, 'mdi');
});

test('保存的图标先显示；图标目录与分页独立，关闭后取消两者', async () => {
  let catalogSignal;
  let searchSignal;
  let finishCatalog;
  let finishSearch;
  const changes = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => ({ name: 'mdi:home', value: '<svg/>' }), update: (...args) => changes.push(args) }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconFormatter: async () => ({ makeThemeIcon: (icon) => ({ name: icon.name, value: icon.svg }) }),
    loadIconClient: async () => ({
      listIconCollections: ({ signal }) => { catalogSignal = signal; return new Promise((resolve) => { finishCatalog = resolve; }); },
      searchIcons: ({ collection, signal }) => { assert.equal(collection, 'mdi'); searchSignal = signal; return new Promise((resolve) => { finishSearch = resolve; }); }
    })
  });
  const opening = picker.openIcon('header.logo.icon');
  await new Promise((done) => setImmediate(done));
  assert.equal(picker.iconPreview, '<svg/>', '当前图标不等待目录网络');
  assert.equal(picker.busy, true);
  picker.close();
  assert.equal(catalogSignal.aborted, true);
  assert.equal(searchSignal.aborted, true);
  finishCatalog({ collections: [{ prefix: 'mdi', name: '迟到目录' }] });
  finishSearch({ icons: [{ name: 'mdi:late' }], total: 1 });
  await opening;
  assert.deepEqual(picker.iconCollections, []);
  assert.deepEqual(picker.items, []);
  assert.deepEqual(changes, []);
});

test('图标库加载期间可以确认当前有效图标，无编辑不改写原对象', async () => {
  let finishSearch;
  let signal;
  const changes = [];
  const current = { name: 'mdi:home', value: '<svg/>', custom: { source: 'console' } };
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => current, update: (...args) => changes.push(args) }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconFormatter: async () => ({ makeThemeIcon: (icon) => ({ name: icon.name, value: icon.svg }) }),
    loadIconClient: async () => ({
      listIconCollections: async () => ({ collections: [] }),
      searchIcons: (options) => { signal = options.signal; return new Promise((resolve) => { finishSearch = resolve; }); }
    })
  });
  const opening = picker.openIcon('header.logo.icon');
  await new Promise((done) => setImmediate(done));
  assert.equal(picker.busy, true);
  await picker.confirm();
  assert.equal(picker.visible, false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(changes, []);
  finishSearch({ icons: [], total: 0 });
  await opening;
});

test('仅打开再确认保留后台已有的非六位颜色及附加元数据', async () => {
  const changes = [];
  const original = { name: 'mdi:home', value: '<svg color="#11223344"/>', color: '#11223344', width: '32', custom: { retained: true } };
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => original, update: (...args) => changes.push(args) }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconFormatter: async () => ({ makeThemeIcon: (icon, options) => ({ name: icon.name, value: '<svg/>', color: options.color }) }),
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) })
  });
  await picker.openIcon('header.logo.icon');
  await picker.confirm();
  assert.deepEqual(changes, []);
  assert.equal(picker.visible, false);
});

test('permission denied never opens picker or requests attachments', async () => {
  let requests = 0;
  const f = fixture({ listAttachments: async () => { requests++; } });
  f.settings.canOpen = false;
  await f.picker.openImage('desktop.background.image_url');
  assert.equal(f.dialog.open, false);
  assert.equal(requests, 0);
});

test('closing a pending library ignores a late response and does not edit settings', async () => {
  let resolve;
  const f = fixture({ listAttachments: () => new Promise((done) => { resolve = done; }) });
  const opening = f.picker.openImage('desktop.background.image_url');
  await new Promise((done) => setImmediate(done));
  f.picker.close();
  resolve({ items: [{ name: 'old', url: '/upload/old.png' }], totalPages: 1 });
  await opening;
  assert.equal(f.picker.visible, false);
  assert.deepEqual(f.picker.items, []);
  assert.deepEqual(f.changes, []);
});

test('selection edits only the approved draft after explicit confirmation', async () => {
  const image = { name: 'a', displayName: 'A', url: '/upload/a.png', thumbnailUrl: '/upload/a.png' };
  const f = fixture({ listAttachments: async () => ({ items: [image], totalPages: 1 }) });
  await f.picker.openImage('desktop.background.image_url');
  f.picker.selectImage(image);
  assert.deepEqual(f.changes, []);
  await f.picker.confirm();
  assert.deepEqual(f.changes, [['desktop.background.image_url', '/upload/a.png']]);
  assert.equal(f.dialog.open, false);
});

test('a newer search owns results even if previous request ignores abort', async () => {
  const resolvers = [];
  const f = fixture({ listAttachments: () => new Promise((done) => resolvers.push(done)) });
  const opening = f.picker.openImage('widgets.behavior.fallback_cover');
  await new Promise((done) => setImmediate(done));
  f.picker.query = 'new';
  const newer = f.picker.search();
  await new Promise((done) => setImmediate(done));
  resolvers[1]({ items: [{ name: 'new' }], totalPages: 1 });
  await newer;
  resolvers[0]({ items: [{ name: 'old' }], totalPages: 1 });
  await opening;
  assert.equal(f.picker.items[0].name, 'new');
});

test('picker rejects unrelated fields before side effects', async () => {
  const f = fixture();
  await f.picker.openImage('developer.debug_mode');
  assert.equal(f.dialog.open, false);
  assert.deepEqual(f.changes, []);
});

test('a delayed library search cannot cancel loading upload policies after switching tabs', async () => {
  let finishPolicies;
  let policySignal;
  const f = fixture({
    listAttachments: async () => ({ items: [], totalPages: 1 }),
    listUploadPolicies: ({ signal }) => { policySignal = signal; return new Promise((done) => { finishPolicies = done; }); }
  });
  await f.picker.openImage('desktop.background.image_url');
  const loading = f.picker.switchTab('upload');
  await new Promise((done) => setImmediate(done));
  await f.picker.search(); // The previous library input's debounce has now fired.
  assert.equal(policySignal.aborted, false);
  finishPolicies([{ name: 'local', displayName: 'Local' }]);
  await loading;
  assert.equal(f.picker.policyName, 'local');
});

test('reopening a configured icon restores the selection for a color-only edit', async () => {
  const current = { value: '<svg/>', name: 'lucide:search', color: '#123456', width: '24', custom: { source: 'console' } };
  const changes = [];
  const settings = { canOpen: true, visible: true, value: () => current, update: (...args) => changes.push(args) };
  const picker = createSettingsAssetPicker({
    getSettings: () => settings,
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) }),
    loadIconFormatter: async () => ({ makeThemeIcon: (icon, options) => ({ value: icon.svg, name: icon.name, color: options.color, width: String(options.width) }) })
  });
  await picker.openIcon('header.icons.search');
  assert.deepEqual(picker.selectedIcon, { name: current.name, svg: current.value });
  picker.iconColor = '#abcdef';
  await picker.updateIconPreview();
  await picker.confirm();
  assert.equal(changes[0][1].color, '#abcdef');
  assert.equal(changes[0][1].name, current.name);
  assert.deepEqual(changes[0][1].custom, current.custom);
});

test('搜索或切换图标库不能丢弃当前选择的迟到预览', async () => {
  const current = { name: 'lucide:house', value: '<svg id="house"/>' };
  const formatter = { makeThemeIcon: (icon) => ({ name: icon.name, value: icon.svg }) };
  let loadFormatter = async () => formatter;
  const changes = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => current, update: (...args) => changes.push(args) }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) }),
    loadIconFormatter: () => loadFormatter()
  });
  await picker.openIcon('header.logo.icon');
  let finishPreview;
  loadFormatter = () => new Promise((resolve) => { finishPreview = resolve; });
  const selecting = picker.selectIcon({ name: 'lucide:search', svg: '<svg id="search"/>' });
  await picker.switchIconCollection('');
  finishPreview(formatter);
  await selecting;
  assert.equal(picker.selectedIcon.name, 'lucide:search');
  assert.equal(picker.iconPreview, '<svg id="search"/>');
  assert.equal(picker.iconPreviewError, '');
  assert.deepEqual(changes, [], '预览和切换来源均不得修改草稿');
});

test('旧确认的迟到失败不能污染重新打开的图标选择器', async () => {
  const current = { name: 'lucide:house', value: '<svg id="house"/>' };
  const formatter = { makeThemeIcon: (icon) => ({ name: icon.name, value: icon.svg }) };
  let loadFormatter = async () => formatter;
  const changes = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => current, update: (...args) => changes.push(args) }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: async () => ({ icons: [], total: 0 }) }),
    loadIconFormatter: () => loadFormatter()
  });
  await picker.openIcon('header.logo.icon');
  let rejectConfirmation;
  picker.iconUseColor = true;
  picker.iconColor = '#abcdef';
  loadFormatter = () => new Promise((_resolve, reject) => { rejectConfirmation = reject; });
  const confirming = picker.confirm();
  picker.close();
  loadFormatter = async () => formatter;
  await picker.openIcon('header.icons.search');
  rejectConfirmation(new Error('旧图标组件加载失败'));
  await confirming;
  assert.equal(picker.visible, true);
  assert.equal(picker.path, 'header.icons.search');
  assert.equal(picker.iconPreviewError, '');
  assert.equal(picker.error, '');
  assert.deepEqual(changes, [], '取消中的确认请求不得修改旧字段或新字段');
});


test('图标翻页保留上一页到最终结果，失败不清空并可重试原页', async () => {
  let finish;
  let fail;
  let request;
  let count = 0;
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => '' }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: (options) => {
      request = options;
      if (!count++) return Promise.resolve({ icons: [{ name: 'mdi:first', svg: '<svg/>' }], total: null, hasMore: true });
      return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    } })
  });
  await picker.openIcon('header.logo.icon');
  const oldItems = picker.items;
  const next = picker.search(2);
  await new Promise((done) => setImmediate(done));
  assert.equal(picker.busy, true);
  assert.equal(picker.page, 1, '结果到达前仍显示当前页');
  assert.equal(picker.items, oldItems, '加载不能清空原网格');
  request.onProgress?.({ icons: [{ name: 'mdi:partial' }], total: null, hasMore: true });
  assert.equal(picker.items, oldItems, '分批到达不能移动当前图标位置');
  fail(new Error('网络不可用'));
  await next;
  assert.equal(picker.items, oldItems);
  assert.equal(picker.page, 1);
  const retry = picker.refreshIcons();
  await new Promise((done) => setImmediate(done));
  assert.equal(request.page, 2);
  finish({ icons: [{ name: 'mdi:second', svg: '<svg/>' }], total: null, hasMore: false });
  await retry;
  assert.equal(picker.items[0].name, 'mdi:second');
  assert.equal(picker.page, 2);
  assert.equal(picker.error, '');
});

test('防抖等待期立即取消旧查询，旧结果不能恢复交互', async () => {
  const requests = [];
  const picker = createSettingsAssetPicker({
    getSettings: () => ({ canOpen: true, visible: true, value: () => '' }),
    getDialog: () => ({ showModal() {}, close() {} }), getActiveElement: () => null,
    loadIconClient: async () => ({ listIconCollections: async () => ({ collections: [] }), searchIcons: (options) => new Promise((resolve) => requests.push({ ...options, resolve })) })
  });
  const initial = picker.openIcon('header.logo.icon');
  await new Promise((done) => setImmediate(done));
  picker.query = 'new';
  picker.prepareIconSearch();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ icons: [{ name: 'mdi:old' }], total: null });
  await initial;
  assert.deepEqual(picker.items, []);
  assert.equal(picker.busy, true, '300ms防抖期间不能点选旧查询结果');
  const current = picker.search();
  await new Promise((done) => setImmediate(done));
  requests[1].resolve({ icons: [{ name: 'mdi:new' }], total: null });
  await current;
  assert.equal(picker.items[0].name, 'mdi:new');
  assert.equal(picker.busy, false);
});
