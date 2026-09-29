import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as core from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';

// Read the FormKit schema independently from the frontend registry. Arrays and
// multi-selects are one persisted setting; their children are item properties.
function backendFields() {
  const lines = fs.readFileSync(new URL('../settings.yaml', import.meta.url), 'utf8').split('\n');
  const fields = [];
  const parents = [];
  let group = '';
  const scalar = (value) => {
    if (value === undefined) return undefined;
    if (/^(true|false|\[\]|-?\d+(?:\.\d+)?|".*")$/.test(value)) return JSON.parse(value);
    return value;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const root = lines[index].match(/^    - group: (.+)$/);
    if (root) { group = root[1]; parents.length = 0; }
    const start = lines[index].match(/^(\s*)- \$formkit: (.+)$/);
    if (!start) continue;
    const indent = start[1].length;
    while (parents.length && parents.at(-1).indent >= indent) parents.pop();
    const node = { indent, formkit: start[2], options: [], accepts: [] };
    let section = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() && lines[next].search(/\S/) <= indent) break;
      const property = lines[next].match(/^(\s*)([\w-]+):(?: (.*))?$/);
      if (property && property[1].length === indent + 2) {
        section = property[2];
        node[section] = scalar(property[3]);
        if (section === 'options' || section === 'accepts') node[section] = [];
      } else if (section === 'options') {
        const option = lines[next].match(/^\s+value: (.+)$/);
        if (option) node.options.push(scalar(option[1]));
      } else if (section === 'accepts') {
        const accept = lines[next].match(/^\s+- (.+)$/);
        if (accept) node.accepts.push(scalar(accept[1]));
      }
    }
    node.path = [group, ...parents.map((parent) => parent.name), node.name].join('.');
    if (node.formkit !== 'group' && parents.every((parent) => parent.formkit === 'group')) fields.push(node);
    parents.push(node);
  }
  return fields;
}

test('frontend schema covers all 72 backend paths with the same defaults and input constraints', () => {
  const backend = backendFields();
  assert.equal(backend.length, 72);
  assert.ok(Array.isArray(core.SETTINGS_FIELDS), 'core exposes the shared settings registry');
  assert.deepEqual(core.SETTINGS_PANES.map(({ id }) => id), [
    'appearance', 'wallpaper', 'desktop-dock', 'menu-control', 'navigation', 'widgets', 'notifications', 'apps', 'advanced'
  ]);
  assert.equal(new Set(core.SETTINGS_FIELDS.map(({ path }) => path)).size, 72);
  assert.deepEqual(core.SETTINGS_FIELDS.map(({ path }) => path).sort(), backend.map(({ path }) => path).sort());
  const draft = core.buildThemeSettingsDraft({});
  for (const field of backend) {
    const registered = core.SETTINGS_FIELDS.find(({ path }) => path === field.path);
    assert.ok(core.SETTINGS_PANES.some(({ id }) => id === registered.pane), field.path);
    assert.deepEqual(registered.default, field.value ?? '', `${field.path} backend default`);
    assert.deepEqual(core.themeSettingsValueAt(draft, field.path), field.value ?? '', `${field.path} draft default`);
    assert.deepEqual(registered.options?.map(({ value }) => value) ?? [], field.options, `${field.path} options`);
    assert.deepEqual(registered.accepts ?? [], field.accepts, `${field.path} attachment types`);
    for (const bound of ['min', 'max', 'step']) {
      if (field[bound] !== undefined) assert.equal(registered[bound], field[bound], `${field.path} ${bound}`);
    }
  }
  assert.equal(core.SETTINGS_FIELDS.find(({ path }) => path === 'default_layout.layout_json').type, 'external-editor');
  assert.equal(core.SETTINGS_FIELDS.find(({ path }) => path === 'default_layout.layout_json').editor, 'desktop-layout');
  assert.throws(() => core.updateThemeSettingsDraft(draft, 'default_layout.layout_json', '{}'));
});

test('previously missing application and navigation settings round-trip through every config envelope', () => {
  const updates = {
    'navigation.header.menu_name': 'site-navigation', 'navigation.dock.menu_name': 'quick-launch',
    'moments.cover.image_url': '/upload/moments.webp', 'moments.profile.display_name': '我的瞬间',
    'moments.profile.subtitle': '生活片段', 'moments.style.color_mode': 'theme',
    'moments.publish.enabled': false, 'moments.publish.image_upload': false,
    'moments.publish.video_upload': false, 'moments.publish.audio_upload': false,
    'douban.profile.display_name': '书影音', 'douban.profile.subtitle': '阅读记录', 'douban.style.color_mode': 'theme',
    'links.profile.display_name': '朋友们', 'steam.cover.image_url': 'https://example.com/steam.webp',
    'equipments.profile.display_name': '常用装备', 'equipments.profile.subtitle': '设备说明', 'developer.debug_mode': true
  };
  for (const wrap of [(value) => value, (value) => ({ spec: { value }, metadata: { resourceVersion: '7' } }), (data) => ({ data })]) {
    const config = wrap({ moments: { publish: { enabled: true, future_flag: 'kept' } }, custom: { untouched: 42 } });
    let draft = core.buildThemeSettingsDraft(config);
    for (const [path, value] of Object.entries(updates)) draft = core.updateThemeSettingsDraft(draft, path, value);
    const saved = core.applyThemeSettingsDraftToConfig(config, draft, Object.keys(updates));
    const reloaded = core.buildThemeSettingsDraft(saved);
    for (const [path, value] of Object.entries(updates)) assert.deepEqual(core.themeSettingsValueAt(reloaded, path), value, path);
    assert.equal(core.resolveThemeConfigContainer(saved).moments.publish.future_flag, 'kept');
    assert.equal(core.resolveThemeConfigContainer(saved).custom.untouched, 42);
    assert.equal(core.resolveThemeConfigContainer(config).moments.publish.enabled, true);
  }
});

test('long existing text, multiline application descriptions, and icon metadata remain intact', () => {
  const longText = `段落一\n${'完整内容'.repeat(500)}\n段落二`;
  const icon = { value: '<svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg>', name: 'lucide:book', width: '24', color: '', custom: { source: 'console' } };
  const config = {
    header: { logo: { title: longText }, auth: { login_label: longText } },
    douban: { profile: { subtitle: longText, icon } }, equipments: { profile: { subtitle: longText } },
    default_layout: { layout_json: '{"version":2,"icons":[],"custom":"kept"}' }
  };
  const draft = core.buildThemeSettingsDraft(config);
  assert.equal(draft.header.logo.title, longText);
  assert.equal(draft.header.auth.login_label, longText);
  assert.equal(draft.douban.profile.subtitle, longText);
  assert.deepEqual(draft.douban.profile.icon, icon);
  assert.equal(draft.default_layout.layout_json, config.default_layout.layout_json);
  const edited = core.updateThemeSettingsDraft(draft, 'equipments.profile.subtitle', `${longText}\n新增段落`);
  const saved = core.applyThemeSettingsDraftToConfig(config, edited, ['equipments.profile.subtitle']);
  assert.equal(saved.equipments.profile.subtitle, `${longText}\n新增段落`);
  assert.deepEqual(saved.header, config.header);
  assert.deepEqual(saved.douban, config.douban);
  assert.deepEqual(saved.default_layout, config.default_layout);
  const iconDraft = core.updateThemeSettingsDraft(draft, 'douban.profile.icon', { ...icon, name: 'lucide:film' });
  assert.deepEqual(core.applyThemeSettingsDraftToConfig(config, iconDraft, ['douban.profile.icon']).douban.profile.icon, { ...icon, name: 'lucide:film' });
});

test('desktop collections preserve typed values and unknown item metadata without layout migration', () => {
  const icons = {
    custom_icons: [{ name: '工具', href: '/tools', type: 'folder', external: false, custom: { order: 7 } }],
    categories: ['cat-1', { name: 'cat-2', label: '分类二', custom: { source: 'console' } }],
    tags: ['tag-1'], posts: ['post-1'], single_pages: ['page-1']
  };
  const layout = '{"version":2,"icons":[{"id":"keep"}]}';
  const config = { desktop: { icons }, default_layout: { layout_json: layout } };
  const draft = core.buildThemeSettingsDraft(config);
  assert.deepEqual(draft.desktop.icons, icons);
  for (const [key, value] of Object.entries(icons)) {
    const path = `desktop.icons.${key}`;
    const edited = core.updateThemeSettingsDraft(draft, path, value);
    const saved = core.applyThemeSettingsDraftToConfig(config, edited, [path]);
    assert.deepEqual(saved.desktop.icons, icons);
    assert.equal(saved.default_layout.layout_json, layout);
    assert.throws(() => core.updateThemeSettingsDraft(draft, path, 'not-an-array'));
    assert.throws(() => core.updateThemeSettingsDraft(draft, path, [null]));
  }
  assert.throws(() => core.updateThemeSettingsDraft(draft, 'desktop.icons.custom_icons', [{ name: 'Bad', href: 12 }]));
  assert.throws(() => core.updateThemeSettingsDraft(draft, 'desktop.icons.categories', [42]));
});

test('new image and icon fields validate user edits while unrelated saves preserve source values', () => {
  const draft = core.buildThemeSettingsDraft({});
  for (const path of ['moments.cover.image_url', 'steam.cover.image_url']) {
    assert.throws(() => core.updateThemeSettingsDraft(draft, path, 'javascript:alert(1)'));
    assert.throws(() => core.updateThemeSettingsDraft(draft, path, '//example.com/image.png'));
    assert.equal(core.themeSettingsValueAt(core.updateThemeSettingsDraft(draft, path, ''), path), '');
  }
  assert.throws(() => core.updateThemeSettingsDraft(draft, 'douban.profile.icon', { value: 'x'.repeat(100_001) }));
  assert.throws(() => core.updateThemeSettingsDraft(draft, 'douban.profile.icon', 'lucide:book'));
  assert.equal(core.updateThemeSettingsDraft(draft, 'douban.profile.icon', '').douban.profile.icon, '');
});
