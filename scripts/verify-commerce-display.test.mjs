import assert from 'node:assert/strict';
import test from 'node:test';

let display = {};
try {
  display = await import('../src/apps/shop/display-model.js');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('catalog defaults to medium cards when no valid preference exists', () => {
  assert.equal(typeof display.normalizeShopDisplay, 'function', 'Shop display normalization is implemented');
  for (const value of [undefined, null, '', false, 12, [], { layout: 'masonry', size: 'huge' }]) {
    assert.deepEqual(display.normalizeShopDisplay(value), { layout: 'cards', size: 'medium' });
  }
});

test('valid layout and density survive independently of invalid stored fields', () => {
  assert.equal(typeof display.normalizeShopDisplay, 'function', 'Shop display normalization is implemented');
  for (const [input, expected] of [
    [{ layout: 'list', size: 'small' }, { layout: 'list', size: 'small' }],
    [{ layout: 'cards', size: 'large' }, { layout: 'cards', size: 'large' }],
    [{ layout: 'invalid', size: 'large' }, { layout: 'cards', size: 'large' }],
    [{ layout: 'list', size: false }, { layout: 'list', size: 'medium' }],
    [{ layout: ' LIST ', size: ' SMALL ' }, { layout: 'list', size: 'small' }],
    [{ layout: ['list'], size: ['large'] }, { layout: 'cards', size: 'medium' }]
  ]) assert.deepEqual(display.normalizeShopDisplay(input), expected);
});

test('malformed local preferences fall back without failing hydration', () => {
  assert.equal(typeof display.parseShopDisplayPreferences, 'function', 'Persisted display preferences are parsed');
  for (const value of [undefined, null, '', '{', 'null', 'false', '[]', '"list"']) {
    assert.deepEqual(display.parseShopDisplayPreferences(value), { layout: 'cards', size: 'medium' });
  }
  assert.deepEqual(display.parseShopDisplayPreferences('{"layout":"list","size":"large","mode":"explore"}'), { layout: 'list', size: 'large' });
});
