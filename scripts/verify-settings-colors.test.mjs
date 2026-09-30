import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThemeSettingsDraft, updateThemeSettingsDraft, themeSettingsValueAt, isValidThemeCssColor } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
import { parseSettingsColor, chooseMenuForeground, applyMenubarForegroundFromBody, createSettingsColorMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/color-controls.js';

test('旧 HEX 和百分比 RGBA 能反解颜色与不透明度', () => {
  const cases = [
    ['#abc', '#AABBCC', 100], ['#abcd', '#AABBCC', 87],
    ['#123456', '#123456', 100], ['#12345680', '#123456', 50],
    ['rgb(20%, 40%, 60%)', '#336699', 100],
    ['rgba(20%, 40%, 60%, 25%)', '#336699', 25],
    ['rgba(0, 0, 0, 0)', '#000000', 0]
  ];
  for (const [source, hex, opacity] of cases) {
    const parsed = parseSettingsColor(source);
    assert.equal(parsed.hex, hex, source);
    assert.equal(parsed.opacity, opacity, source);
  }
});

function colorStore(value) {
  const path = 'header.dropdown.light_bg';
  const baseline = buildThemeSettingsDraft({ header: { dropdown: { light_bg: value } } });
  return {
    baseline, draft: baseline, validationErrors: {},
    value(target) { return themeSettingsValueAt(this.draft, target); },
    updateCssColor(target, next) {
      if (!isValidThemeCssColor(next)) {
        this.validationErrors[target] = '颜色格式不正确';
        return false;
      }
      this.draft = updateThemeSettingsDraft(this.draft, target, next);
      delete this.validationErrors[target];
      return true;
    },
    ...createSettingsColorMethods()
  };
}

test('色块更新只改变 RGB 并保留旧 alpha', () => {
  const store = colorStore('rgba(40, 50, 60, 0.35)');
  assert.equal(store.updateColorHex('header.dropdown.light_bg', '#AABBCC'), true);
  assert.equal(store.value('header.dropdown.light_bg'), 'rgba(170, 187, 204, 0.35)');
});

test('不透明度更新保留 RGB 且 0% 是有效值', () => {
  const store = colorStore('#abc8');
  assert.equal(store.updateColorOpacity('header.dropdown.light_bg', 0), true);
  assert.equal(store.value('header.dropdown.light_bg'), 'rgba(170, 187, 204, 0)');
  assert.equal(store.colorParts('header.dropdown.light_bg').opacity, 0);
});

test('清空百分比输入不会把不透明度误写为 0%', () => {
  const store = colorStore('rgba(10, 20, 30, 0.6)');
  assert.equal(store.updateColorOpacity('header.dropdown.light_bg', ''), false);
  assert.equal(store.value('header.dropdown.light_bg'), 'rgba(10, 20, 30, 0.6)');
});

test('非法颜色输入保留草稿和报错，不执行后续颜色改写', () => {
  const store = colorStore('#123456');
  assert.equal(store.updateCssColor('header.dropdown.light_bg', 'not-a-color'), false);
  assert.equal(store.updateColorOpacity('header.dropdown.light_bg', 50), false);
  assert.equal(store.value('header.dropdown.light_bg'), '#123456');
  assert.ok(store.validationErrors['header.dropdown.light_bg']);
});

test('浅背景选深色前景，深背景选浅色前景', () => {
  assert.equal(chooseMenuForeground('#ffffff'), '#17212F');
  assert.equal(chooseMenuForeground('#101820'), '#FFFFFF');
});

test('透明菜单按实际底色选择前景，而非未显示的 RGB', () => {
  assert.equal(chooseMenuForeground('rgba(255, 255, 255, 0)', '#101820'), '#FFFFFF');
  assert.equal(chooseMenuForeground('rgba(0, 0, 0, 0)', '#ffffff'), '#17212F');
  assert.equal(chooseMenuForeground('rgba(255, 255, 255, 0.2)', '#101820'), '#FFFFFF');
});

test('纯色墙纸参与透明菜单对比，低透明度提供反色文字描边', () => {
  const properties = new Map([
    ['--mac-header-dropdown-light-bg', 'rgba(0, 0, 0, 0)'],
    ['--mac-header-dropdown-dark-bg', 'rgba(255, 255, 255, 0)']
  ]);
  const body = { style: {
    backgroundColor: '#ffffff', backgroundImage: '',
    getPropertyValue(name) { return properties.get(name) || ''; },
    setProperty(name, value) { properties.set(name, value); }
  } };
  applyMenubarForegroundFromBody(body);
  assert.equal(properties.get('--mac-header-dropdown-light-fg'), '#17212F');
  assert.equal(properties.get('--mac-header-dropdown-dark-fg'), '#17212F');
  assert.equal(properties.get('--mac-header-dropdown-light-outline'), 'rgba(255,255,255,0.9)');
});
