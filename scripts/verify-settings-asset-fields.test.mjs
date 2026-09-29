import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThemeSettingsDraft, updateThemeSettingsDraft, applyThemeSettingsDraftToConfig } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';

test('valid weather precision is preserved through unrelated edits', () => {
  const config = { widgets: { modules: { weather: { refresh_minutes: 31 } } } };
  const draft = buildThemeSettingsDraft(config);
  assert.equal(draft.widgets.modules.weather.refresh_minutes, 31);
  const next = updateThemeSettingsDraft(draft, 'dock.appearance.icon_size', 54);
  assert.equal(applyThemeSettingsDraftToConfig(config, next, ['dock.appearance.icon_size']).widgets.modules.weather.refresh_minutes, 31);
});

test('approved image fields are writable, reversible, and merged selectively', () => {
  const config = { desktop: { background: { image_url: '/upload/old.webp' }, icons: { custom_icons: [{ name: 'kept' }] } } };
  let draft = buildThemeSettingsDraft(config);
  draft = updateThemeSettingsDraft(draft, 'desktop.background.image_url', '/upload/new.webp');
  draft = updateThemeSettingsDraft(draft, 'widgets.behavior.fallback_cover', 'https://example.com/cover.png');
  const saved = applyThemeSettingsDraftToConfig(config, draft, ['desktop.background.image_url', 'widgets.behavior.fallback_cover']);
  assert.equal(saved.desktop.background.image_url, '/upload/new.webp');
  assert.equal(saved.widgets.behavior.fallback_cover, 'https://example.com/cover.png');
  assert.deepEqual(saved.desktop.icons, config.desktop.icons);
  assert.equal(updateThemeSettingsDraft(draft, 'desktop.background.image_url', '').desktop.background.image_url, '');
  assert.throws(() => updateThemeSettingsDraft(draft, 'desktop.background.image_url', 'javascript:alert(1)'));
  assert.throws(() => updateThemeSettingsDraft(draft, 'desktop.background.image_url', '//example.com/a.png'));
});

test('header icons retain Console metadata without changing other icons', () => {
  const icon = { value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>', name: 'lucide:search', width: '24', color: '#123456' };
  const config = { header: { icons: { auth: { ...icon, name: 'lucide:user' } } } };
  const draft = updateThemeSettingsDraft(buildThemeSettingsDraft(config), 'header.icons.search', icon);
  const saved = applyThemeSettingsDraftToConfig(config, draft, ['header.icons.search']);
  assert.deepEqual(saved.header.icons.search, icon);
  assert.deepEqual(saved.header.icons.auth, config.header.icons.auth);
  assert.equal(updateThemeSettingsDraft(draft, 'header.icons.search', '').header.icons.search, '');
  assert.throws(() => updateThemeSettingsDraft(draft, 'header.icons.unknown', icon));
});

test('valid large SVG is not truncated and oversize new input is rejected', () => {
  const value = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ${'L1 1 '.repeat(11_000)}"/></svg>`;
  const icon = { value, name: 'lucide:example', width: '24', color: '' };
  const draft = updateThemeSettingsDraft(buildThemeSettingsDraft({}), 'header.logo.icon', icon);
  assert.equal(draft.header.logo.icon.value, value);
  assert.equal(applyThemeSettingsDraftToConfig({}, draft, ['header.logo.icon']).header.logo.icon.value, value);
  assert.throws(() => updateThemeSettingsDraft(draft, 'header.logo.icon', { ...icon, value: 'x'.repeat(100_001) }));
});
