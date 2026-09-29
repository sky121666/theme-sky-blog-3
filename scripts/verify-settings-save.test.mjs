import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThemeSettingsDraft, updateThemeSettingsDraft } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
const api = await import('../src/shell/desktop-shell/runtime/desktop/settings-model/save.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
test('配置保存合并检查入口存在', () => assert.equal(typeof api.mergeSettingsChanges, 'function'));
test('其他页面或后台同时修改不覆盖，修改同字段时保留草稿并报告冲突', () => {
  const config = { header: { logo: { title: '原名称' } }, developer: { debug_mode: false } };
  const baseline = buildThemeSettingsDraft(config);
  const draft = updateThemeSettingsDraft(baseline, 'header.logo.title', '新名称');
  const latest = structuredClone(config);
  latest.developer.debug_mode = true;
  const result = api.mergeSettingsChanges(latest, draft, ['header.logo.title'], { baseline });
  assert.equal(result.developer.debug_mode, true);
  assert.equal(result.header.logo.title, '新名称');
  latest.header.logo.title = '后台已修改';
  assert.throws(() => api.mergeSettingsChanges(latest, draft, ['header.logo.title'], { baseline }), /其他位置修改/);
  assert.equal(latest.header.logo.title, '后台已修改');
});
test('新增桌面配置不接受空名称、重复名称或不可导航链接', () => {
  for (const icons of [[{ name: '', href: '/' }], [{ name: 'a', href: '/' }, { name: 'a', href: '/a' }], [{ name: 'a', href: 'javascript:alert(1)' }]]) {
    const draft = buildThemeSettingsDraft({ desktop: { icons: { custom_icons: icons } } });
    assert.throws(() => api.mergeSettingsChanges({}, draft, ['desktop.icons.custom_icons']));
  }
});
test('已失效菜单占位不能被另一菜单字段重新使用', () => {
  const config = { navigation: { header: { menu_name: 'missing' }, dock: { menu_name: 'valid' } } };
  const baseline = buildThemeSettingsDraft(config);
  const draft = updateThemeSettingsDraft(baseline, 'navigation.dock.menu_name', 'missing');
  assert.throws(() => api.mergeSettingsChanges(config, draft, ['navigation.dock.menu_name'], { baseline, resources: { menus: [{ name: 'valid', disabled: false }] } }), /不可用/);
  const unrelated = updateThemeSettingsDraft(baseline, 'header.logo.title', '新名称');
  assert.equal(api.mergeSettingsChanges(config, unrelated, ['header.logo.title'], { baseline }).navigation.header.menu_name, 'missing');
});
