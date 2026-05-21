import assert from 'node:assert/strict';
import {
  DESKTOP_WIDGET_CATALOG,
  normalizeWidgetInstance,
  serializeWidgetInstance,
  createWidgetInstance
} from '../src/shell/desktop-shell/runtime/widgets/catalog-core.js';

const photosCatalog = DESKTOP_WIDGET_CATALOG['plugin-photos.gallery'];
assert.ok(photosCatalog, 'photos widget catalog exists');
assert.equal(photosCatalog.hasConfig, true, 'photos widget remains configurable');
assert.deepEqual(photosCatalog.configSchema, [
  {
    key: 'groupName',
    type: 'photo-group',
    label: '显示精选集',
    required: true
  }
], 'photos config schema is normalized');
assert.deepEqual(photosCatalog.configDefaults, {}, 'photos config defaults are normalized');

const categoriesCatalog = DESKTOP_WIDGET_CATALOG['halo.categories'];
assert.ok(categoriesCatalog, 'categories widget catalog exists');
assert.equal(categoriesCatalog.hasConfig, true, 'categories widget is configurable');
assert.deepEqual(categoriesCatalog.configSchema, [
  {
    key: 'categoryNames',
    type: 'category-list',
    label: '显示分类',
    optionsSource: 'categories',
    emptyLabel: '未选择时自动展示热门分类',
    maxItems: 4,
    defaultValue: []
  }
], 'categories config schema is normalized');
assert.deepEqual(categoriesCatalog.configDefaults, { categoryNames: [] }, 'categories config defaults are normalized');

const bangumisCatalog = DESKTOP_WIDGET_CATALOG['plugin-bangumis.recent'];
assert.ok(bangumisCatalog, 'bangumis widget catalog exists');
assert.equal(bangumisCatalog.hasConfig, true, 'bangumis widget is configurable');
assert.deepEqual(bangumisCatalog.configSchema, [
  {
    key: 'typeNum',
    type: 'select',
    label: '类型',
    options: [
      { value: '', label: '自动' },
      { value: '1', label: '追番' },
      { value: '2', label: '追剧' }
    ],
    defaultValue: ''
  },
  {
    key: 'status',
    type: 'select',
    label: '状态',
    options: [
      { value: 'auto', label: '自动' },
      { value: 'watching', label: '在看' },
      { value: 'wish', label: '想看' },
      { value: 'done', label: '已看' }
    ],
    defaultValue: 'auto'
  }
], 'bangumis config schema is normalized');
assert.deepEqual(
  bangumisCatalog.configDefaults,
  { typeNum: '', status: 'auto' },
  'bangumis config defaults are normalized'
);

const instance = createWidgetInstance('plugin-photos.gallery', {
  key: 'photos-test',
  size: 'medium',
  appearance: 'dark',
  x: 2,
  y: 3,
  meta: { groupName: 'album-a' }
});

const serialized = serializeWidgetInstance(instance);
assert.deepEqual(serialized.meta, { groupName: 'album-a' }, 'meta survives serialization');

const normalized = normalizeWidgetInstance(serialized);
assert.deepEqual(normalized.meta, { groupName: 'album-a' }, 'meta survives normalization');
assert.equal(normalized.size, 'medium', 'size survives normalization');
assert.equal(normalized.appearance, 'dark', 'appearance survives normalization');

const categoriesInstance = createWidgetInstance('halo.categories', {
  key: 'categories-test',
  size: 'medium',
  meta: { categoryNames: ['halo', 'theme'] }
});
const serializedCategories = serializeWidgetInstance(categoriesInstance);
assert.deepEqual(
  serializedCategories.meta,
  { categoryNames: ['halo', 'theme'] },
  'category selection survives serialization'
);

const bangumisInstance = createWidgetInstance('plugin-bangumis.recent', {
  key: 'bangumis-test',
  size: 'large',
  meta: { typeNum: '2', status: 'watching' }
});
const serializedBangumis = serializeWidgetInstance(bangumisInstance);
assert.deepEqual(
  serializedBangumis.meta,
  { typeNum: '2', status: 'watching' },
  'bangumis meta survives serialization'
);

console.log('widget config schema contract passed');
