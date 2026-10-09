import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'base URL must use HTTP(S)');
assert.ok(!baseUrl.username && !baseUrl.password, 'base URL must not contain credentials');
const expectedSidebarIds = JSON.parse(process.env.SHOP_SIDEBAR_CATEGORY_IDS || '[]').map(String);

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [match[1], match[3]]));
}

function tags(html, name) {
  return (html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || []).map(attributes);
}

function sidebarCategories(html) {
  const sidebar = html.match(/<aside\b[^>]*id="shop-sidebar"[^>]*>([\s\S]*?)<\/aside>/i)?.[1];
  assert.ok(sidebar, 'Shop sidebar is rendered');
  const links = tags(sidebar, 'a');
  assert.ok(links.some((link) => link['data-shop-view'] === 'categories' && /(?:\?|&amp;|&)view=categories(?:&|$)/.test(link.href)), 'sidebar has the all-categories entry');
  return links.filter((link) => link['data-shop-category']).map((link) => link['data-shop-category']);
}

async function readPage(path) {
  const response = await fetch(new URL(path, baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `${path}: expected HTTP 200`);
  const html = await response.text();
  assert.match(html, /\bdata-app-root="shop"/, `${path}: Shop root is rendered`);
  assert.deepEqual(sidebarCategories(html), expectedSidebarIds, `${path}: only configured category links are rendered in selection order`);
  return html;
}

const exploreHtml = await readPage('/shop/products');
assert.match(exploreHtml, /data-shop-entry-view="explore"/, 'home uses the exploration view');
assert.doesNotMatch(exploreHtml, /\bdata-shop-display-controls(?:\s|=|>)/, 'home does not render catalog display controls');
assert.doesNotMatch(exploreHtml, /\bdata-shop-catalog(?:\s|=|>)/, 'home does not render a hidden duplicate catalog');

const catalogHtml = await readPage('/shop/products?view=all');
assert.match(catalogHtml, /data-shop-entry-view="catalog"/, 'all products uses the catalog view');
assert.match(catalogHtml, /\bdata-shop-display-controls(?:\s|=|>)/, 'catalog renders its display controls');
assert.match(catalogHtml, /\bdata-shop-display-layout="cards"/, 'catalog supports cards');
assert.match(catalogHtml, /\bdata-shop-display-layout="list"/, 'catalog supports a list');
const sizeSelect = catalogHtml.match(/<select\b[^>]*data-shop-display-size-select[^>]*>([\s\S]*?)<\/select>/i)?.[1];
assert.ok(sizeSelect, 'catalog has its native density selector');
for (const size of ['large', 'medium', 'small']) assert.ok(sizeSelect.includes(`value="${size}"`), `catalog supports ${size} items`);
const categorySelect = catalogHtml.match(/<select\b[^>]*id="shop-category"[^>]*>([\s\S]*?)<\/select>/i)?.[1];
assert.ok(categorySelect, 'catalog renders the full category filter');
const allCategoryIds = tags(categorySelect, 'option').filter((option) => option.value).map((option) => option.value);

for (const path of ['/shop/products?view=categories', '/shop/products?view=categories&keyword=ignored&sort=title%2Casc&page=2']) {
  const html = await readPage(path);
  assert.match(html, /data-shop-entry-view="categories"/, `${path}: categories has its own view`);
  const heading = html.match(/<h1\b[^>]*id="shop-page-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
  assert.equal(heading, '类别', `${path}: category overview title`);
  assert.doesNotMatch(html, /\bdata-shop-display-controls(?:\s|=|>)/, `${path}: no product display controls`);
  assert.doesNotMatch(html, /\bdata-shop-filter(?:\s|=|>)/, `${path}: no product filter`);
  assert.doesNotMatch(html, /\bdata-shop-catalog(?:\s|=|>)/, `${path}: no product catalog`);
  assert.doesNotMatch(html, /\bclass="[^"]*\bshop-pagination\b/, `${path}: no product pager`);
  const main = html.match(/<main\b[^>]*\bclass="[^"]*\bshop-main\b[^"]*"[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  assert.ok(main, `${path}: main content is rendered`);
  const links = tags(main, 'a').filter((link) => link['data-shop-category']);
  assert.deepEqual(links.map((link) => link['data-shop-category']), allCategoryIds, `${path}: overview includes every category in tree order`);
  for (const link of links) {
    assert.ok(link.class?.split(/\s+/).includes('pjax-link'), `${path}: category links use PJAX`);
    assert.equal(link['data-shop-view'], 'all', `${path}: category links open the catalog`);
    assert.equal(link['data-shop-keyword'], '', `${path}: category links clear a stale keyword`);
    assert.equal(link['data-shop-sort'], '', `${path}: category links clear a stale sort`);
    assert.ok(link.href?.includes('categoryId='), `${path}: category link has a category filter`);
  }
  if (allCategoryIds.length === 0) assert.match(main, /data-shop-categories-empty/, `${path}: category-specific empty state`);
}

const firstProduct = tags(catalogHtml, 'a').find((link) => link.class?.split(/\s+/).includes('shop-catalog-card'));
if (firstProduct) await readPage(firstProduct.href.replaceAll('&amp;', '&'));
console.log(JSON.stringify({ status: 'passed', scope: 'read-only Shop category SSR and display boundaries', categoryCount: allCategoryIds.length, expectedSidebarIds, coldProductChecked: Boolean(firstProduct) }, null, 2));
