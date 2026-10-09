import assert from 'node:assert/strict';
import test from 'node:test';

const model = await import('../src/apps/shop/model.js').catch(() => ({}));

test('商城筛选重置页码并保留其它已选条件', () => {
  assert.equal(typeof model.buildShopBrowseUrl, 'function');
  const result = new URL(model.buildShopBrowseUrl('http://localhost:8090/shop/products?categoryId=2&sort=minPrice,asc&page=3&view=all', { keyword: '图标' }));
  assert.equal(result.pathname, '/shop/products');
  assert.equal(result.searchParams.get('keyword'), '图标');
  assert.equal(result.searchParams.get('categoryId'), '2');
  assert.equal(result.searchParams.get('sort'), 'minPrice,asc');
  assert.equal(result.searchParams.get('view'), 'all');
  assert.equal(result.searchParams.has('page'), false);
});

test('分页保留筛选而不携带订单或未知参数', () => {
  assert.equal(typeof model.buildShopBrowseUrl, 'function');
  const result = new URL(model.buildShopBrowseUrl('http://localhost:8090/shop/products?keyword=图标&categoryId=2&orderCode=private&bad=1', { page: 2 }));
  assert.equal(result.searchParams.get('page'), '2');
  assert.equal(result.searchParams.get('keyword'), '图标');
  assert.equal(result.searchParams.has('orderCode'), false);
  assert.equal(result.searchParams.has('bad'), false);
});

test('空筛选和首页不留下空参数，不接受非法排序或页码', () => {
  assert.equal(typeof model.buildShopBrowseUrl, 'function');
  const result = new URL(model.buildShopBrowseUrl('http://localhost:8090/shop/products?keyword=x&page=4&sort=bad', { keyword: ' ', categoryId: '', page: -2 }));
  assert.equal(result.search, '');
});

test('探索入口清除全部浏览模式，保留同源地址', () => {
  assert.equal(typeof model.buildShopBrowseUrl, 'function');
  assert.equal(model.buildShopBrowseUrl('http://localhost:8090/shop/product/1?view=all#item', { view: '' }), 'http://localhost:8090/shop/products');
  assert.throws(() => model.buildShopBrowseUrl('javascript:alert(1)', {}));
  assert.equal(model.buildShopBrowseUrl('http://localhost:8090/shop/products?keyword=图标&categoryId=2&sort=title,asc&view=categories&page=3', { view: 'explore' }), 'http://localhost:8090/shop/products');
});

test('全部分类入口清除商品筛选和页码，保留同源地址', () => {
  const result = new URL(model.buildShopBrowseUrl('http://localhost:8090/shop/products?view=all&keyword=图标&categoryId=2&sort=minPrice,asc&page=3', { view: 'categories' }));
  assert.equal(result.pathname, '/shop/products');
  assert.deepEqual(Object.fromEntries(result.searchParams), { view: 'categories' });
});

test('从全部分类搜索或选择分类时进入商品目录', () => {
  for (const changes of [{ keyword: '图标' }, { categoryId: '2' }, { sort: 'title,asc' }]) {
    const result = new URL(model.buildShopBrowseUrl('http://localhost:8090/shop/products?view=categories&page=3', changes));
    assert.deepEqual(Object.fromEntries(result.searchParams), { ...changes, view: 'all' });
  }
  assert.equal(model.buildShopBrowseUrl('http://localhost:8090/shop/products?view=categories', {}), 'http://localhost:8090/shop/products?view=categories');
});

for (const [value, expected] of [[undefined, true], [null, true], ['', true], [true, true], ['true', true], [false, false], ['false', false], [0, false], ['0', false], ['off', false]]) {
  test(`商品简介开关解析 ${String(value)}`, () => {
    assert.equal(typeof model.isShopDescriptionVisible, 'function');
    assert.equal(model.isShopDescriptionVisible(value), expected);
  });
}
