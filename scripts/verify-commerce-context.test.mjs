import assert from 'node:assert/strict';
import test from 'node:test';

const context = await import('../src/apps/shop/browse-context.js').catch(() => ({}));
const origin = 'https://theme.test';

test('商店来源仅允许同源浏览目录并清除交易参数', () => {
  assert.equal(typeof context.sanitizeShopBrowseSource, 'function');
  assert.equal(context.sanitizeShopBrowseSource(`${origin}/shop/product/item`, '/shop/products?keyword=图标&categoryId=2&sort=title,asc&page=3&view=all&orderCode=private&returnTo=javascript:alert(1)#old'), `${origin}/shop/products?keyword=%E5%9B%BE%E6%A0%87&categoryId=2&sort=title%2Casc&view=all&page=3`);
  assert.equal(context.sanitizeShopBrowseSource(`${origin}/shop/product/item`, '/shop'), `${origin}/shop/products`);
  for (const source of ['https://outside.test/shop/products', 'javascript:alert(1)', '/uc/shop/orders', '/shop/cart', '/shop/checkout?contextId=private', '/shop/products/item', '/apis/shop', '//outside.test/shop']) {
    assert.equal(context.sanitizeShopBrowseSource(`${origin}/shop/product/item`, source), null, source);
  }
});

test('来源记录使用商品ID隔离，未知商品与污染记录不可读取', () => {
  assert.equal(typeof context.createShopBrowseContext, 'function');
  const record = context.createShopBrowseContext({ sourceUrl: `${origin}/shop/products?keyword=图标&page=3`, productUrl: `${origin}/shop/product/item`, scrollTop: 438, sourceEntryId: 'source-1', label: '搜索结果' });
  assert.deepEqual(record, { version: 1, productId: 'item', productPath: '/shop/product/item', href: `${origin}/shop/products?keyword=%E5%9B%BE%E6%A0%87&page=3`, scrollTop: 438, sourceEntryId: 'source-1', label: '搜索结果' });
  const storage = new Map();
  const store = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  context.saveShopBrowseContext(store, { ...record, detailEntryId: 'detail-1' });
  assert.equal(context.readShopBrowseContext(store, `${origin}/shop/product/other`), null);
  assert.deepEqual(context.readShopBrowseContext(store, `${origin}/shop/product/item`, 'detail-1'), { ...record, detailEntryId: 'detail-1' });
  storage.set(storage.keys().next().value, JSON.stringify({ ...record, detailEntryId: 'detail-1', href: 'https://outside.test/shop/products' }));
  assert.equal(context.readShopBrowseContext(store, `${origin}/shop/product/item`, 'detail-1'), null);
});

test('不可用storage与非法滚动值不破坏来源降级', () => {
  assert.equal(typeof context.createShopBrowseContext, 'function');
  for (const scrollTop of [-1, Infinity, 'bad']) {
    assert.equal(context.createShopBrowseContext({ sourceUrl: `${origin}/shop/products`, productUrl: `${origin}/shop/product/item`, scrollTop }).scrollTop, 0);
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(context.readShopBrowseContext(blocked, `${origin}/shop/product/item`), null);
  assert.equal(context.saveShopBrowseContext(blocked, {}), false);
  assert.equal(context.createShopBrowseContext({ sourceUrl: `${origin}/uc`, productUrl: `${origin}/shop/product/item` }), null);
  assert.equal(context.createShopBrowseContext({ sourceUrl: `${origin}/shop/products`, productUrl: `${origin}/shop/cart` }), null);
});

test('整页返回只恢复同源目录的已请求来源或准确历史条目', () => {
  assert.equal(typeof context.readShopBrowseSourceContext, 'function');
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), key: (index) => [...values.keys()][index], get length() { return values.size; } };
  const record = context.createShopBrowseContext({ sourceUrl: `${origin}/shop/products?view=all&page=3`, productUrl: `${origin}/shop/product/item`, scrollTop: 534, sourceEntryId: 'source-entry' });
  context.saveShopBrowseContext(storage, { ...record, detailEntryId: 'detail-entry' });
  assert.equal(context.readShopBrowseSourceContext(storage, record.href, 'direct-entry'), null);
  assert.equal(context.readShopBrowseSourceContext(storage, record.href, 'source-entry').scrollTop, 534);
  context.saveShopBrowseContext(storage, { ...record, detailEntryId: 'detail-entry', returnRequested: true });
  assert.equal(context.readShopBrowseSourceContext(storage, `${origin}/shop/cart`, 'source-entry'), null);
  assert.equal(context.readShopBrowseSourceContext(storage, `${origin}/shop/products?view=all&page=2`, 'return-entry'), null);
  assert.equal(context.readShopBrowseSourceContext(storage, record.href, 'return-entry').scrollTop, 534);
  assert.equal(context.readShopBrowseSourceContext(storage, record.href, 'direct-entry'), null, 'One return marker is consumed once');
});

test('同商品的历史来源逐条保留，后来直达不借用历史或旧格式记录', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), key: (index) => [...values.keys()][index], get length() { return values.size; } };
  const productUrl = `${origin}/shop/product/item`;
  const records = Array.from({ length: 12 }, (_, index) => ({
    ...context.createShopBrowseContext({ sourceUrl: `${origin}/shop/products?view=all&page=${index + 1}`, productUrl, scrollTop: 100 + index, sourceEntryId: `source-${index}` }),
    detailEntryId: `detail-${index}`
  }));
  for (const record of records) context.saveShopBrowseContext(storage, record);
  const firstKey = values.keys().next().value;
  values.set(firstKey, JSON.stringify({ ...records[0], sourceEntryIds: { malformed: true } }));
  for (const record of records) {
    assert.deepEqual(context.readShopBrowseContext(storage, productUrl, record.detailEntryId), record);
    assert.equal(context.readShopBrowseSourceContext(storage, record.href, record.sourceEntryId).scrollTop, record.scrollTop);
  }
  assert.equal(context.readShopBrowseContext(storage, productUrl, 'later-direct'), null);
  assert.equal(context.readShopBrowseContext(storage, productUrl), null);
  values.set(`${context.SHOP_BROWSE_CONTEXT_PREFIX}item`, JSON.stringify(records[0]));
  assert.equal(context.readShopBrowseContext(storage, productUrl, 'later-direct'), null);
  assert.equal(context.readShopBrowseContext(storage, productUrl), null);
});
