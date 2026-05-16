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

console.log('widget config schema contract passed');
