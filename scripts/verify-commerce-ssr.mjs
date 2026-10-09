import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  assert.ok(value && !value.startsWith('--'), `${name} needs a value`);
  return value;
}

const recordsPath = argument('--demo-records') || process.env.SHOP_SSR_DEMO_RECORDS;
if (!recordsPath) {
  console.log('SKIP commerce SSR: no DEMO records provided; live rendering was not verified.');
  process.exit(0);
}

const baseUrl = new URL(argument('--base-url') || process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'base URL must use HTTP(S)');
assert.ok(!baseUrl.username && !baseUrl.password, 'base URL must not contain credentials');
const records = JSON.parse(await readFile(recordsPath, 'utf8'));
const products = records.products.map((entry) => ({ ...entry.payload, ...entry.response, id: entry.response?.id ?? entry.id }));
const hasImage = (product) => Boolean(product.coverImageUrl || product.images?.length);
const imageProduct = products.find(hasImage);
const noImageProduct = products.find((product) => !hasImage(product));
const imageCategory = records.categories.find((category) => {
  const members = products.filter((product) => product.categoryId === category.id);
  return members.length > 0 && members.every(hasImage);
});
assert.ok(imageProduct && noImageProduct && imageCategory, 'DEMO records must include image, no-image and image-only category samples');

function countClass(html, tagName, className) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) || [];
  return tags.filter((tag) => {
    const attribute = tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2];
    return attribute?.split(/\s+/).includes(className);
  }).length;
}

async function readPage(path, expectedScene) {
  const response = await fetch(new URL(path, baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `${path}: expected HTTP 200`);
  const html = await response.text();
  assert.match(html, /\bdata-app-root="shop"/, `${path}: shop root missing`);
  assert.ok(html.includes(`data-shop-scene="${expectedScene}"`), `${path}: scene mismatch`);
  return html;
}

const results = [];
const categoryPath = `/shop/products?categoryId=${encodeURIComponent(imageCategory.id)}&view=all`;
const categoryHtml = await readPage(categoryPath, 'products');
const categoryCards = countClass(categoryHtml, 'a', 'shop-catalog-card');
const categoryPlaceholders = countClass(categoryHtml, 'svg', 'shop-image-placeholder');
assert.ok(categoryCards > 0, 'image-only category must render catalog cards');
assert.equal(categoryPlaceholders, 0, 'image-only category must not render placeholders');
results.push({ path: categoryPath, cards: categoryCards, placeholders: categoryPlaceholders });

for (const [product, expectedPlaceholder] of [[imageProduct, 0], [noImageProduct, 1]]) {
  const path = `/shop/product/${encodeURIComponent(product.id)}`;
  const html = await readPage(path, 'product');
  const placeholders = countClass(html, 'svg', 'shop-image-placeholder');
  const galleryImages = (html.match(/<img\b[^>]*\bdata-shop-gallery-main(?:\s|=|>)/gi) || []).length;
  const identityImages = countClass(html, 'img', 'shop-product-identity-image');
  assert.equal(placeholders, expectedPlaceholder, `${path}: placeholder count`);
  assert.equal(galleryImages + identityImages, expectedPlaceholder ? 0 : 1, `${path}: render one identity or gallery main image`);
  if (product.productType === 'VIRTUAL') assert.equal(galleryImages, 0, `${path}: virtual identity and preview media are separate`);
  results.push({ path, placeholders, galleryImages, identityImages });
}

const catalogHtml = await readPage('/shop/products?view=all', 'products');
const catalogCards = [...catalogHtml.matchAll(/<a\b[^>]*class="[^"]*\bshop-catalog-card\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
assert.ok(catalogCards.length > 0, 'all-products catalog must render cards');
let catalogPlaceholders = 0;
for (const [index, card] of catalogCards.entries()) {
  const placeholders = countClass(card[1], 'svg', 'shop-image-placeholder');
  const images = (card[1].match(/<img\b[^>]*>/gi) || []).length;
  assert.equal(images + placeholders, 1, `catalog card ${index + 1}: render exactly one image or placeholder`);
  catalogPlaceholders += placeholders;
}
results.push({ path: '/shop/products?view=all', cards: catalogCards.length, placeholders: catalogPlaceholders });
console.log(JSON.stringify({ status: 'passed', scope: 'read-only DEMO storefront SSR image fallback', results }, null, 2));
