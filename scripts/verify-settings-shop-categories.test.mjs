import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThemeSettingsDraft, updateThemeSettingsDraft, themeSettingsValueAt, applyThemeSettingsDraftToConfig } from '../src/shell/desktop-shell/runtime/desktop/theme-settings-core.js';
import { createSettingsPanelMethods } from '../src/shell/desktop-shell/runtime/desktop/settings-model/panels.js';
import { mergeSettingsChanges } from '../src/shell/desktop-shell/runtime/desktop/settings-model/save.js';

const path = 'shop.navigation.category_appearances';
const storeFor = (config = {}) => ({
  ...createSettingsPanelMethods({}), draft: buildThemeSettingsDraft(config),
  value(key, fallback) { return themeSettingsValueAt(this.draft, key, fallback); },
  update(key, value) { this.draft = updateThemeSettingsDraft(this.draft, key, value); }
});

test('分类外观默认留空，按稳定 ID 保存并保留精选分类和未知配置', () => {
  const original = { shop: { navigation: { sidebar_categories: ['9'], future: 'keep' } } };
  let draft = buildThemeSettingsDraft(original);
  assert.deepEqual(themeSettingsValueAt(draft, path), []);
  draft = updateThemeSettingsDraft(draft, path, [{ category_id: '9', icon: 'palette', color: '#aabbcc' }]);
  const saved = applyThemeSettingsDraftToConfig(original, draft, [path]);
  assert.deepEqual(saved.shop.navigation.category_appearances, [{ category_id: '9', icon: 'palette', color: '#AABBCC' }]);
  assert.deepEqual(saved.shop.navigation.sidebar_categories, ['9']);
  assert.equal(saved.shop.navigation.future, 'keep');
  assert.deepEqual(themeSettingsValueAt(buildThemeSettingsDraft(saved), path), saved.shop.navigation.category_appearances);
});

test('分类外观拒绝可执行颜色和任意图标，旧配置无效值安全回退', () => {
  const draft = buildThemeSettingsDraft({});
  for (const row of [
    { category_id: '9', icon: 'palette', color: 'red;background:url(https://bad.test)' },
    { category_id: '9', icon: '<svg onload=alert(1)>', color: '' },
    { category_id: {}, icon: 'folder', color: '' }
  ]) assert.throws(() => updateThemeSettingsDraft(draft, path, [row]));
  assert.throws(() => updateThemeSettingsDraft(draft, path, [{ category_id: '9', icon: 'folder', color: '' }, { category_id: '9', icon: 'code', color: '' }]));
  assert.deepEqual(themeSettingsValueAt(buildThemeSettingsDraft({ shop: { navigation: { category_appearances: 'bad' } } }), path), []);
  const legacy = buildThemeSettingsDraft({ shop: { navigation: { category_appearances: [null, { category_id: 9, icon: 'invalid', color: 'url(x)' }] } } });
  assert.deepEqual(themeSettingsValueAt(legacy, path), [{ category_id: '9', icon: 'folder', color: '' }]);
});

test('分类外观编辑保留未加载 ID，防止重复选择，支持恢复主题颜色和移除', () => {
  const store = storeFor({ shop: { navigation: { category_appearances: [{ category_id: 'missing', icon: 'folder', color: '' }] } } });
  store.resources.shopCategories = { items: [{ name: '9', label: '设计', disabled: false }] };
  assert.equal(store.resourceOptions('shopCategories', false).find(({ name }) => name === 'missing').disabled, true);
  store.addCategoryAppearance();
  store.updateCategoryAppearance(1, 'category_id', '9');
  store.updateCategoryAppearance(1, 'icon', 'palette');
  store.updateCategoryAppearance(1, 'color', '#112233');
  store.updateCategoryAppearance(0, 'category_id', '9');
  assert.equal(store.value(path)[0].category_id, 'missing');
  store.updateCategoryAppearance(1, 'category_id', 'unavailable');
  assert.equal(store.value(path)[1].category_id, '9');
  store.updateCategoryAppearance(1, 'color', '');
  assert.equal(store.value(path)[1].color, '');
  store.removeCategoryAppearance(0);
  assert.deepEqual(store.value(path), [{ category_id: '9', icon: 'palette', color: '' }]);
});

test('未选分类的外观草稿不能保存，删除分类配置后能保存且不改业务数据', () => {
  const config = { shop: { navigation: { sidebar_categories: ['9'] } } };
  const store = storeFor(config);
  store.addCategoryAppearance();
  assert.throws(() => mergeSettingsChanges(config, store.draft, [path]), /选择商品分类/);
  store.removeCategoryAppearance(0);
  const saved = mergeSettingsChanges(config, store.draft, [path]);
  assert.deepEqual(saved, { shop: { navigation: { sidebar_categories: ['9'], category_appearances: [] } } });
});
