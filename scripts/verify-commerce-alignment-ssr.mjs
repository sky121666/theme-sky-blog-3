import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL(process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090');
assert.ok(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
const records = JSON.parse(await readFile(process.env.SHOP_SSR_DEMO_RECORDS || 'output/commerce-adaptation-2026-10-08/demo-records.json', 'utf8'));
const results = [];
async function page(path) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${path}: HTTP 200`);
  const html = await response.text();
  const main = html.match(/<main\b[^>]*class="[^"]*\bshop-main\b[^"]*"[^>]*>([\s\S]*?)<\/main>/)?.[1];
  assert.ok(main, `${path}: Shop main exists`);
  return { html, main };
}
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const title = (html) => text(html.match(/<h1\b[^>]*id="shop-page-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '');

const category = records.categories.find((category) => String(category.id) === '2') || records.categories[0];
const categoryPage = await page(`/shop/products?categoryId=${encodeURIComponent(category.id)}&view=all`);
assert.equal(title(categoryPage.main), category.name, 'Selected category is the page title');
assert.doesNotMatch(categoryPage.main, /<button\b[^>]*type="submit"[^>]*>应用<\/button>/, 'Immediate filters have no duplicate Apply button');
assert.match(categoryPage.main, /data-shop-display-size-select/, 'Catalog has the compact size selector');
results.push('category title and compact toolbar');

const search = await page('/shop/products?keyword=%E5%9B%BE%E6%A0%87&view=all');
assert.ok(title(search.main).includes('图标'), 'Search heading contains the query');
results.push('search query heading');

const catalog = await page('/shop/products?view=all');
assert.equal(title(catalog.main), '商品');
const variable = records.products.map((p) => p.response).find((p) => p && p.maxPrice > p.minPrice && p.minPrice > 0);
assert.ok(variable, 'DEMO includes a price range');
const priceLabel = `¥${Number(variable.minPrice).toFixed(2)} 起`;
assert.ok(text(catalog.main).includes(priceLabel), 'Variable price is presented as a starting price');
results.push('accurate starting price');

const home = await page('/shop/products');
assert.equal(title(home.main), '探索');
assert.match(home.main, /data-shop-home/, 'Home uses the configured editorial layout');
assert.doesNotMatch(home.main, /data-shop-display-controls/, 'Explore has no layout controls');
results.push('explore display boundary');

const overview = await page('/shop/products?view=categories');
assert.equal(title(overview.main), '类别');
assert.match(overview.main, /shop-category-tree/, 'Category overview retains the complete classification');
const compactIds = (main) => Array.from((main.match(/<section\b[^>]*class="[^"]*\bshop-home-compact\b[^"]*"[^>]*>([\s\S]*?)<\/section>/)?.[1] || '').matchAll(/data-shop-home-product="([^"]+)"/g), (match) => match[1]);
assert.deepEqual(compactIds(overview.main), compactIds(home.main), 'Category overview and explore resolve the same configured merchandising products');
results.push('category overview shares configured merchandising');

for (const kind of ['VIRTUAL', 'PHYSICAL']) {
  const product = records.products.map((p) => p.response).find((p) => p?.productType === kind);
  assert.ok(product, `DEMO ${kind} exists`);
  const detail = await page(`/shop/product/${product.id}`);
  assert.ok(detail.html.includes(`data-shop-product-kind="${kind.toLowerCase()}"`), `${kind}: own detail layout`);
  assert.match(detail.main, /data-shop-return/, 'Detail exposes guarded return navigation');
  assert.ok(detail.main.includes(`<shop-buy-box id="${product.id}"`), 'Official SKU component is retained');
  results.push(`${kind} detail and return hook`);
}
console.log(JSON.stringify({ status: 'passed', scope: 'read-only DEMO storefront alignment SSR', results }, null, 2));
