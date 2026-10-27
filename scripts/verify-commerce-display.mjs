import { assertCurrentBuild } from './lib/build-identity.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Display-only fixture. Every request is intercepted; no Halo or transaction
// component is loaded. Source CSS overlays the existing build so this can run
// before the single repository build owned by the integration task.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const origin = 'https://theme.test';
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
const prefix = '/themes/theme-sky-blog-3/assets/';
let css = '';
for (const asset of manifest.shop.css) {
  assert.ok(asset.startsWith(prefix), 'Shop CSS stays inside theme assets');
  const local = path.resolve(root, 'templates/assets', asset.slice(prefix.length));
  assert.ok(local.startsWith(path.join(root, 'templates/assets') + path.sep));
  css += await readFile(local, 'utf8');
}
// The existing build supplies daisyUI. Keep it below source rules so a deleted
// or narrowed selector in source cannot survive from an older generated asset.
css = `@layer commerce-compiled {${css}}\n`;
css += (await readFile(path.join(root, 'src/apps/shop/styles/index.css'), 'utf8'))
  .replace(/@(?:import|source)\s+[^;]+;/g, '')
  .replace(/@plugin\s+"daisyui"\s*\{[^}]*\}/g, '');
const displayModule = '/src/apps/shop/display-runtime.js';
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#7298be"/></svg>')}`;

function card(id) {
  const media = id === 5 ? '<svg class="shop-image-placeholder shop-gallery-image" viewBox="0 0 160 120" role="img" aria-label="无图商品：暂无商品图片"></svg>' : `<img src="${image}" alt="商品 ${id}">`;
  return `<a class="shop-catalog-card" href="/shop/product/${id}" data-fixture-product="${id}">${media}<div class="shop-catalog-content"><h2 class="shop-product-name">${id === 6 ? '长标题' + '商品名称'.repeat(16) : `商品 ${id}`}</h2><p class="shop-product-description">${'完整商品简介含长文本与LongUnbrokenDescription123'.repeat(12)}</p></div><p class="shop-product-price">${id === 4 ? '免费' : '¥19.90'}</p></a>`;
}

function fixture({ explore, categories, empty }) {
  const view = categories ? 'categories' : explore ? 'explore' : 'catalog';
  const controls = `<div class="shop-display-toolbar" data-shop-display-controls aria-label="商品展示设置">
      <div class="shop-display-group" role="group" aria-label="商品布局">
        <button type="button" class="shop-ui-btn shop-display-button" data-shop-display-layout="cards" aria-label="卡片展示" aria-pressed="true">卡片</button><button type="button" class="shop-ui-btn shop-display-button" data-shop-display-layout="list" aria-label="列表展示" aria-pressed="false">列表</button>
      </div><label class="shop-size-control">尺寸<select class="shop-ui-select" data-shop-display-size-select aria-label="商品尺寸"><option value="large">大</option><option value="medium" selected>中</option><option value="small">小</option></select></label>
    </div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0;width:100%;height:100%}.shop-window{width:100%;height:100%}</style></head><body><section class="shop-window"><div class="shop-window-content"><div class="shop-app" data-app-root="shop" data-shop-scene="products" data-shop-entry-view="${view}" data-shop-display-view="${view}"><div class="shop-app-shell"><aside class="shop-sidebar">商店导航</aside><main class="shop-main"><div class="shop-main-header"><h1 class="shop-page-title">${categories ? '全部分类' : explore ? '探索' : '所有商品'}</h1></div>
    ${view === 'catalog' ? controls : ''}
    ${explore && !empty ? `<div data-shop-explore><div class="shop-hero-carousel"><a class="shop-hero" href="/shop/product/1"><img class="shop-hero-image" src="${image}" alt="主推商品"><div class="shop-hero-content"><h2 class="shop-hero-name">主推商品</h2></div></a></div><div class="shop-editorial-carousel">精选商品</div></div>` : ''}
    ${categories ? '<div data-shop-categories><a href="/shop/products?categoryId=1&amp;view=all">分类一</a></div>' : empty ? '<div class="shop-empty">商店暂时没有商品。</div>' : explore ? '' : `<div class="shop-catalog-grid" data-shop-catalog aria-label="商品列表">${[1,2,3,4,5,6].map(card).join('')}</div>`}
    <a class="shop-pagination" href="/shop/products?view=all&amp;categoryId=a&amp;page=3">下一页</a></main></div></div></div></section></body></html>`;
}

const browser = await chromium.launch({ headless: true });
let passed = 0;
const failures = [];

async function scenario(name, action, { width = 1280, explore = false, categories = false, empty = false, stored, storageBlocked = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion, serviceWorkers: 'block' });
  const errors = [];
  const unexpected = [];
  const documents = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    if (request.isNavigationRequest() && url.pathname === '/shop/products') {
      documents.push(request.url());
      return route.fulfill({ contentType: 'text/html', body: fixture({ explore, categories, empty }) });
    }
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const local = path.resolve(root, `.${url.pathname}`);
      assert.ok(local.startsWith(path.join(root, 'src') + path.sep));
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(local, 'utf8') });
    }
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    unexpected.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/shop/products?view=all&categoryId=a&page=2`);
    await page.evaluate(async ({ displayModule, stored, storageBlocked }) => {
      const display = await import(displayModule);
      window.__shopDisplayHydrate = display.hydrateShopDisplay;
      const key = display.SHOP_DISPLAY_PREFS_KEY;
      if (stored !== undefined) localStorage.setItem(key, stored);
      if (storageBlocked) {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Disabled', 'SecurityError'); } });
      }
      window.__displayPrefsKey = key;
      window.__shopRoot = document.querySelector('[data-app-root="shop"]');
      window.__displayCleanup = window.__shopDisplayHydrate(window.__shopRoot);
    }, { displayModule, stored, storageBlocked });
    await action(page);
    assert.deepEqual(errors, [], 'Display has no browser errors');
    assert.deepEqual(unexpected, [], 'Fixture serves every request locally');
    assert.equal(documents.length, 1, 'Display changes do not refresh the document');
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

const state = (page) => page.evaluate(() => ({ view: window.__shopRoot.dataset.shopDisplayView, layout: window.__shopRoot.dataset.shopLayout, size: window.__shopRoot.dataset.shopSize }));
const visibleProducts = (page) => page.locator('[data-shop-catalog] .shop-catalog-card:visible').count();

async function assertListContentGeometry(page, { size, withoutDescription = false } = {}) {
  const cards = await page.locator('[data-shop-catalog] .shop-catalog-card').evaluateAll((nodes) => nodes.map((node) => {
    const measure = (selector) => {
      const child = node.querySelector(selector);
      if (!child || !child.getClientRects().length) return null;
      const rect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, row: style.gridRowStart, column: style.gridColumnStart };
    };
    return { id: node.dataset.fixtureProduct, gap: Number.parseFloat(getComputedStyle(node).rowGap), content: measure('.shop-catalog-content'), title: measure('.shop-product-name'), description: measure('.shop-product-description'), price: measure('.shop-product-price') };
  }));
  for (const card of cards) {
    const { content, title, description, price } = card;
    const parts = Object.entries({ title, description, price }).filter(([, rect]) => rect);
    for (let a = 0; a < parts.length; a++) {
      for (let b = a + 1; b < parts.length; b++) {
        const [firstName, first] = parts[a];
        const [secondName, second] = parts[b];
        const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0.5 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 0.5;
        assert.equal(overlap, false, `Product ${card.id} ${firstName}/${secondName} overlap: ${JSON.stringify(card)}`);
      }
    }
    assert.equal(content.row, '1', `Product ${card.id} identity occupies the first row`);
    if (description) {
      assert.ok(title.bottom <= description.top + 0.5, `Product ${card.id} description follows its title`);
    }
    if (size === 'large') {
      assert.equal(price.row, '2', `Product ${card.id} large row places its price below the identity`);
      assert.ok(content.bottom <= price.top + 0.5, `Product ${card.id} price follows its name and description`);
      if (withoutDescription) assert.ok(price.top - title.bottom <= card.gap + 1, `Product ${card.id} omitted description leaves no blank row: ${JSON.stringify(card)}`);
    } else {
      assert.equal(price.column, '3', `Product ${card.id} compact price occupies the right column`);
      assert.ok(price.left >= content.right - 0.5, `Product ${card.id} price is to the right of the identity`);
    }
  }
}

try {
  await scenario('filtered cards keep three distinct sizes with only two products', async (page) => {
    await page.locator('[data-shop-catalog] .shop-catalog-card').evaluateAll((nodes) => nodes.slice(2).forEach((node) => node.remove()));
    const widths = [];
    for (const size of ['large', 'medium', 'small']) {
      await page.getByRole('combobox', { name: '商品尺寸' }).selectOption(size);
      widths.push(await page.locator('[data-shop-catalog] .shop-catalog-card').first().evaluate((node) => node.getBoundingClientRect().width));
    }
    assert.ok(widths[0] > widths[1] + 20 && widths[1] > widths[2] + 20, `Card sizes must stay distinct: ${widths}`);
  });
  await scenario('catalog starts as medium cards and toggles without changing filters', async (page) => {
    assert.deepEqual(await state(page), { view: 'catalog', layout: 'cards', size: 'medium' });
    const url = page.url();
    await page.getByRole('button', { name: '列表展示' }).click();
    await page.getByRole('combobox', { name: '商品尺寸' }).selectOption('small');
    assert.deepEqual(await state(page), { view: 'catalog', layout: 'list', size: 'small' });
    assert.equal(page.url(), url);
    assert.equal(await visibleProducts(page), 6);
    assert.equal(await page.getByRole('button', { name: '列表展示' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '卡片展示' }).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByRole('combobox', { name: '商品尺寸' }).inputValue(), 'small');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem(window.__displayPrefsKey))), { layout: 'list', size: 'small' });
  });
  await scenario('explore stays editorial without catalog display controls or preference hydration', async (page) => {
    assert.deepEqual(await state(page), { view: 'explore', layout: undefined, size: undefined });
    assert.equal(await page.locator('[data-shop-display-controls]').count(), 0);
    assert.equal(await visibleProducts(page), 0);
    assert.equal(await page.locator('.shop-hero:visible').count(), 1);
  }, { explore: true });
  await scenario('stored density restores on replacement roots and listeners clean up', async (page) => {
    assert.deepEqual(await state(page), { view: 'catalog', layout: 'list', size: 'large' });
    await page.evaluate(() => {
      window.__displayCleanup();
      const previous = window.__shopRoot;
      const next = previous.cloneNode(true);
      previous.replaceWith(next);
      window.__shopRoot = next;
      window.__displayCleanup = window.__shopDisplayHydrate(next);
    });
    assert.deepEqual(await state(page), { view: 'catalog', layout: 'list', size: 'large' });
    await page.evaluate(() => window.__displayCleanup());
    await page.getByRole('button', { name: '卡片展示' }).click();
    assert.equal(await state(page).then((value) => value.layout), 'list', 'Disposed listener cannot change layout');
    await page.evaluate(() => { window.__displayCleanup = window.__shopDisplayHydrate(window.__shopRoot); });
    await page.getByRole('button', { name: '卡片展示' }).click();
    assert.equal(await state(page).then((value) => value.layout), 'cards');
  }, { stored: '{"layout":"list","size":"large"}' });
  await scenario('stored catalog preferences leave explicit explore entry intact', async (page) => {
    assert.deepEqual(await state(page), { view: 'explore', layout: undefined, size: undefined });
    assert.equal(await page.locator('[data-shop-display-controls]').count(), 0);
    assert.equal(await page.locator('.shop-hero:visible').count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem(window.__displayPrefsKey)), '{"layout":"list","size":"small"}');
  }, { explore: true, stored: '{"layout":"list","size":"small"}' });
  await scenario('category overview never becomes a product catalog from stored preferences', async (page) => {
    assert.deepEqual(await state(page), { view: 'categories', layout: undefined, size: undefined });
    assert.equal(await page.locator('[data-shop-display-controls]').count(), 0);
    assert.equal(await page.locator('[data-shop-categories]:visible').count(), 1);
    assert.equal(await visibleProducts(page), 0);
  }, { categories: true, stored: '{"layout":"list","size":"large"}' });
  for (const stored of ['{', '{"layout":"invalid","size":false}']) {
    await scenario('invalid stored preferences fall back to usable catalog', async (page) => {
      assert.deepEqual(await state(page), { view: 'catalog', layout: 'cards', size: 'medium' });
    }, { stored });
  }
  await scenario('storage denied still allows keyboard layout and native size controls', async (page) => {
    const list = page.getByRole('button', { name: '列表展示' });
    await list.focus();
    await page.keyboard.press('Enter');
    const size = page.getByRole('combobox', { name: '商品尺寸' });
    await size.focus();
    await size.selectOption('small');
    assert.deepEqual(await state(page), { view: 'catalog', layout: 'list', size: 'small' });
    assert.equal(await size.evaluate((node) => node === document.activeElement), true);
  }, { storageBlocked: true, reducedMotion: 'reduce' });
  await scenario('empty catalog stays empty and display controls do not create products', async (page) => {
    await page.getByRole('button', { name: '列表展示' }).click();
    assert.equal(await visibleProducts(page), 0);
    assert.equal(await page.locator('.shop-empty:visible').count(), 1);
  }, { empty: true });
  for (const width of [390, 1280]) {
    for (const size of ['large', 'medium', 'small']) {
      await scenario(`list ${size} identity and price do not overlap at ${width}px`, async (page) => {
        await page.getByRole('button', { name: '列表展示' }).click();
        await page.getByRole('combobox', { name: '商品尺寸' }).selectOption(size);
        await assertListContentGeometry(page, { size });
        await page.locator('[data-shop-catalog] .shop-product-description').evaluateAll((nodes) => nodes.forEach((node) => { node.hidden = true; }));
        await assertListContentGeometry(page, { size, withoutDescription: true });
        await page.locator('[data-shop-catalog] .shop-product-description').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        await assertListContentGeometry(page, { size, withoutDescription: true });
      }, { width });
    }
  }
  for (const width of [390, 900, 1280]) {
    await scenario(`list has responsive columns, inset dividers and native icon sizes at ${width}px`, async (page) => {
      await page.getByRole('button', { name: '列表展示' }).click();
      for (const size of ['large', 'medium', 'small']) {
        await page.getByRole('combobox', { name: '商品尺寸' }).selectOption(size);
        const geometry = await page.locator('[data-shop-catalog]').evaluate((catalog) => {
          const card = catalog.querySelector('.shop-catalog-card');
          const image = card.querySelector('img').getBoundingClientRect();
          const content = card.querySelector('.shop-catalog-content').getBoundingClientRect();
          const price = card.querySelector('.shop-product-price');
          const divider = getComputedStyle(card, '::after');
          const bounds = card.getBoundingClientRect();
          return { columns: getComputedStyle(catalog).gridTemplateColumns.split(' ').length, image: image.width, dividerLeft: bounds.left + parseFloat(divider.left), contentLeft: content.left, radius: parseFloat(getComputedStyle(price).borderRadius), minPriceSide: Math.min(price.getBoundingClientRect().width, price.getBoundingClientRect().height) };
        });
        assert.equal(geometry.columns, width >= 1280 ? 2 : 1, 'two columns require enough content width');
        assert.equal(geometry.image, size === 'large' ? 84 : size === 'medium' ? 64 : 52);
        assert.ok(Math.abs(geometry.dividerLeft - geometry.contentLeft) <= 0.5, 'divider starts at the text column');
        assert.ok(geometry.radius >= geometry.minPriceSide / 2, 'price remains a capsule');
      }
    }, { width });
  }
  for (const width of [360, 390, 1280]) {
    await scenario(`cards and list have three distinct sizes without overflow at ${width}px`, async (page) => {
      for (const layout of ['cards', 'list']) {
        await page.locator(`[data-shop-display-layout="${layout}"]`).click();
        const measurements = [];
        for (const size of ['large', 'medium', 'small']) {
          await page.getByRole('combobox', { name: '商品尺寸' }).selectOption(size);
          assert.equal(await visibleProducts(page), 6);
          const geometry = await page.evaluate(() => {
            const root = window.__shopRoot;
            const main = root.querySelector('.shop-main');
            const catalog = root.querySelector('[data-shop-catalog]');
            const first = catalog.querySelector('.shop-catalog-card');
            const media = first.querySelector('img');
            return { media: media.getBoundingClientRect().width, cardHeight: first.getBoundingClientRect().height, mainWidth: main.clientWidth, mainScroll: main.scrollWidth, viewport: innerWidth, widest: Math.max(...[...catalog.querySelectorAll('.shop-catalog-card')].map((card) => card.getBoundingClientRect().right)), toolbar: root.querySelector('[data-shop-display-controls]').getBoundingClientRect().right };
          });
          assert.ok(geometry.mainScroll <= geometry.mainWidth + 1, `${layout}/${size} main overflows: ${JSON.stringify(geometry)}`);
          assert.ok(geometry.widest <= geometry.viewport + 1);
          assert.ok(geometry.toolbar <= geometry.viewport + 1);
          measurements.push(geometry.media);
        }
        assert.ok(measurements[0] > measurements[1] + 4 && measurements[1] > measurements[2] + 4, `${layout} sizes are distinct: ${measurements.join(',')}`);
      }
    }, { width });
  }
} finally { await browser.close(); }

console.log(`Commerce display fixture: ${passed} passed, ${failures.length} failed (source CSS overlay; no Halo requests)`);
if (failures.length) process.exitCode = 1;
