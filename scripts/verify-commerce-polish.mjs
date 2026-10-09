import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Compiled assets and in-memory DTOs only. Every request is intercepted, so
// these layout checks cannot reach Halo, an account or a purchase endpoint.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://theme.test';
const prefix = '/themes/theme-sky-blog-3/assets/';
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
const localAsset = (pathname) => {
  assert.ok(pathname.startsWith(prefix), `Unexpected asset: ${pathname}`);
  const local = path.resolve(root, 'templates/assets', pathname.slice(prefix.length));
  assert.ok(local.startsWith(path.join(root, 'templates/assets') + path.sep));
  return local;
};
const css = (await Promise.all(manifest.shop.css.map((asset) => readFile(localAsset(asset), 'utf8')))).join('\n');
const cssHash = createHash('sha256').update(css).digest('hex').slice(0, 12);
const toolbar = await readFile(path.join(root, 'templates/modules/shop-app/toolbar.html'), 'utf8');
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#7298be"/></svg>')}`;
const hero = `<div class="shop-home"><a class="shop-hero" href="/shop/product/902"><img class="shop-hero-image" src="${image}" alt="宣传图"><div class="shop-hero-content"><h2 class="shop-hero-name">给桌面一点新灵感</h2><p class="shop-product-description">精选壁纸与图标，让工作空间更顺手。</p></div></a></div>`;
const card = (id, description) => `<a class="shop-catalog-card" href="/shop/product/${id}"><img src="${image}" alt=""><div class="shop-catalog-content"><h2 class="shop-product-name">精选商品 ${id}</h2><p class="shop-product-description">${description}</p></div><p class="shop-product-price">¥19.00</p></a>`;
const catalog = `<div class="shop-catalog-grid" data-shop-catalog>${card(1, '简短说明')}${card(2, '多行商品说明用于检验相邻价格是否共享基线，布局不能随描述行数变化。'.repeat(3))}</div>`;
const product = {
  id: 902, title: '桌面资源精选', productType: 'VIRTUAL', status: 'PUBLISHED', minPrice: 19, maxPrice: 29,
  specDefinition: [{ name: '版本', usedForSku: true, values: [{ value: '标准版' }, { value: '完整版' }] }],
  productVariants: [
    { id: 1902, productId: 902, price: 19, specValues: [{ name: '版本', value: '标准版' }], trackInventory: true, stock: 20, status: 'PUBLISHED', shippingRequired: false },
    { id: 1903, productId: 902, price: 29, specValues: [{ name: '版本', value: '完整版' }], trackInventory: true, stock: 20, status: 'PUBLISHED', shippingRequired: false },
  ],
};
const detail = `<div class="shop-product-layout"><div class="shop-product-identity"><img class="shop-product-identity-image" src="${image}" alt=""></div><div class="shop-product-purchase"><h1 class="shop-product-title">桌面资源精选</h1><p class="shop-product-description">精选壁纸与图标，适合日常工作。</p><shop-buy-box id="902" csrftoken="fixture-csrf"></shop-buy-box></div></div><section class="shop-product-previews"><div class="shop-product-preview-track"><img class="shop-product-preview-image" src="${image}" alt="商品预览"></div></section>`;

function documentHtml(view) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>html,body{margin:0;width:100%;height:100%;font-family:-apple-system,system-ui,sans-serif}.shop-window{width:100%;height:100%;--theme-accent:#bd557c;--content-body-bg:#fff}</style></head><body><section class="shop-window"><div class="shop-window-content"><div class="shop-app" data-app-root="shop" data-shop-scene="${view === 'product' ? 'product' : 'products'}" data-shop-product-kind="virtual" data-shop-entry-view="${view}" data-shop-display-view="${view}" data-shop-layout="cards" data-shop-size="medium"><div class="shop-app-shell"><aside class="shop-sidebar">商店导航</aside><main class="shop-main"><div class="shop-main-header">${view === 'product' ? '<a class="shop-back-link" href="/shop/products">返回商店</a>' : `<h1 class="shop-page-title">${view === 'explore' ? '探索' : '所有商品'}</h1>`}</div>${view === 'product' ? detail : toolbar + (view === 'explore' ? hero : catalog)}<section class="shop-home-section"><div class="shop-home-section-header"><h2 class="shop-home-section-title">更多精选</h2><a class="shop-home-section-link" href="/shop/products?view=all">查看全部</a></div></section></main></div></div></div></section>${view === 'product' ? `<script type="module" src="${manifest.shop.js[0]}"></script>` : ''}</body></html>`;
}

let passed = 0;
const failures = [];
const browser = await chromium.launch({ headless: true });
async function scenario(name, { width = 1280, view = 'catalog' } = {}, action) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN', serviceWorkers: 'block' });
  const unexpected = [];
  const errors = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.origin === origin && url.pathname === '/fixture') {
      return route.fulfill({ contentType: 'text/html', body: documentHtml(view) });
    }
    if (request.method() === 'GET' && url.origin === origin && url.pathname.startsWith(prefix)) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(localAsset(url.pathname)) });
    if (request.method() === 'GET' && url.origin === origin && url.pathname === '/apis/uc.api.ecommerce.halo.run/v1alpha1/products/902') return route.fulfill({ json: product });
    if (request.method() === 'GET' && url.origin === origin && url.pathname === '/apis/uc.api.ecommerce.halo.run/v1alpha1/ecommerceconfigs/shop') return route.fulfill({ json: {} });
    if (request.method() === 'GET' && url.origin === origin && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(4000);
  try {
    await page.goto(`${origin}/fixture`);
    // Resolve only the two toolbar SSR branches needed by this fixture. The
    // actual template supplies the hierarchy, labels and class names.
    await page.evaluate((view) => {
      for (const node of document.querySelectorAll('[th\\:if]')) {
        if (node.getAttribute('th:if') === '${isCatalog}' && view !== 'catalog') node.remove();
      }
      const toolbar = document.querySelector('.shop-catalog-toolbar');
      if (toolbar && view !== 'catalog' && toolbar.getAttribute('th:classappend') === "${!isCatalog} ? 'shop-explore-toolbar' : ''") toolbar.classList.add('shop-explore-toolbar');
      document.querySelectorAll('th\\:block').forEach((node) => node.remove());
    }, view);
    await action(page);
    assert.deepEqual(errors, [], 'No fixture browser errors');
    assert.deepEqual(unexpected, [], 'All fixture traffic is served in memory');
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

try {
  await scenario('desktop explore has only the heading spacing before its hero', { view: 'explore' }, async (page) => {
    const geometry = await page.evaluate(() => ({
      headerBottom: document.querySelector('.shop-main-header').getBoundingClientRect().bottom,
      heroTop: document.querySelector('.shop-hero').getBoundingClientRect().top,
      searchVisible: document.querySelector('.shop-mobile-search').getClientRects().length > 0,
    }));
    assert.ok(geometry.heroTop - geometry.headerBottom <= 15, `Header-to-hero gap: ${geometry.heroTop - geometry.headerBottom}px; expected <= 15px`);
    assert.equal(geometry.searchVisible, false);
  });
  await scenario('desktop catalog controls share a 32px outer height', {}, async (page) => {
    const heights = await page.locator('#shop-category,#shop-sort,.shop-display-group,.shop-size-control select').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    assert.equal(heights.length, 4);
    assert.ok(heights.every((height) => Math.abs(height - 32) <= 1), `Control outer heights: ${heights.join(', ')}px`);
  });
  await scenario('390px filters and display controls form separate complete rows', { width: 390 }, async (page) => {
    const geometry = await page.evaluate(() => {
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
      const main = document.querySelector('.shop-main');
      return { filter: rect('.shop-filterbar'), display: rect('.shop-display-toolbar'), category: rect('#shop-category'), sort: rect('#shop-sort'), toolbar: rect('.shop-catalog-toolbar'), mainClient: main.clientWidth, mainScroll: main.scrollWidth };
    });
    assert.ok(Math.abs(geometry.category.top - geometry.sort.top) <= 1, `Filter fields must share a row: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.display.top >= geometry.filter.bottom, `Display row must follow filters: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.filter.width - geometry.toolbar.width) <= 1 && Math.abs(geometry.display.width - geometry.toolbar.width) <= 1, `Both control rows span the toolbar: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.mainScroll <= geometry.mainClient + 1, 'No horizontal overflow');
    assert.equal(await page.locator('.shop-mobile-search').isVisible(), true, 'Phone search remains available');
  });
  for (const width of [1280, 390]) {
    await scenario(`${width}px promotion image covers its hero behind readable text`, { width, view: 'explore' }, async (page) => {
      const geometry = await page.evaluate(() => {
        const hero = document.querySelector('.shop-hero');
        const image = document.querySelector('.shop-hero-image');
        const content = document.querySelector('.shop-hero-content');
        const h = hero.getBoundingClientRect(), i = image.getBoundingClientRect(), c = content.getBoundingClientRect();
        return { hero: { left: h.left, top: h.top, width: h.width, height: h.height }, image: { left: i.left, top: i.top, width: i.width, height: i.height }, contentRight: c.right, heroRight: h.right, gradients: [getComputedStyle(content).backgroundImage, getComputedStyle(hero, '::before').backgroundImage, getComputedStyle(hero, '::after').backgroundImage] };
      });
      assert.ok(['left', 'top', 'width', 'height'].every((key) => Math.abs(geometry.hero[key] - geometry.image[key]) <= 1), `Hero and image bounds: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.gradients.some((value) => value.includes('gradient')), 'Text retains a gradient contrast layer');
      assert.ok(geometry.contentRight <= geometry.heroRight + 1, 'Hero copy remains inside its card');
    });
  }
  await scenario('card prices align despite different description lengths', {}, async (page) => {
    const positions = await page.locator('[data-shop-catalog] .shop-product-price').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
    assert.ok(Math.abs(positions[0] - positions[1]) <= 1, `Adjacent price baselines: ${positions.join(', ')}px`);
  });
  for (const width of [1280, 390]) {
    await scenario(`${width}px virtual purchase stays compact with real SKU and quantity controls`, { width, view: 'product' }, async (page) => {
      await page.locator('.buy-box__spec-option').first().waitFor();
      await page.locator('.shop-quantity__input').waitFor();
      assert.equal(await page.locator('.buy-box__spec-option:visible').count(), 2, 'Both specifications remain visible');
      assert.equal(await page.locator('.buy-box__quantity:visible').count(), 1, 'Quantity remains visible');
      assert.equal(await page.locator('.buy-box__stock:visible').count(), 1, 'Stock remains visible');
      const quantity = page.getByRole('spinbutton', { name: '数量', exact: true });
      const increase = page.getByRole('button', { name: '增加数量', exact: true });
      const decrease = page.getByRole('button', { name: '减少数量', exact: true });
      assert.equal(await quantity.count(), 1, 'Quantity input has an accessible name');
      assert.equal(await increase.count(), 1, 'Increment button has an accessible name');
      assert.equal(await decrease.count(), 1, 'Decrement button has an accessible name');
      assert.equal(await decrease.isDisabled(), true, 'Minimum quantity is respected');
      await page.locator('.buy-box__spec-option').filter({ hasText: '完整版' }).click();
      assert.match(await page.locator('.buy-box__price-value').innerText(), /29\.00/, 'Changing SKU updates the real price');
      await increase.click();
      assert.equal(await quantity.inputValue(), '2', 'Increment remains operational');
      await decrease.click();
      assert.equal(await quantity.inputValue(), '1', 'Decrement remains operational');
      const geometry = await page.evaluate(() => {
        const box = document.querySelector('.buy-box').getBoundingClientRect();
        const main = document.querySelector('.shop-main');
        return { buyBoxHeight: box.height, previewTop: document.querySelector('.shop-product-previews').getBoundingClientRect().top, mainScroll: main.scrollWidth, mainClient: main.clientWidth, buttons: [...document.querySelectorAll('.buy-box__actions button')].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) };
      });
      assert.equal(geometry.buttons.length, 2, 'Both purchase actions remain available');
      assert.ok(geometry.mainScroll <= geometry.mainClient + 1, `No detail overflow: ${JSON.stringify(geometry)}`);
      if (width >= 768) {
        assert.ok(geometry.buyBoxHeight <= 245, `Compact desktop purchase region: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.buttons.every((button) => button.width <= 220), `Desktop actions should fit their labels: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.previewTop <= 450, `Preview enters the initial desktop viewport: ${JSON.stringify(geometry)}`);
      } else {
        assert.ok(geometry.buttons.every((button) => button.height >= 44), 'Phone purchase actions retain 44px touch height');
      }
    });
  }
  await scenario('section link has at least 4.5:1 contrast with the audited theme accent', {}, async (page) => {
    const ratio = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const luminance = (color) => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n) => { n /= 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(document.querySelector('.shop-home-section-link')).color);
      let parent = document.querySelector('.shop-home-section-link');
      let backdrop = 'rgb(255, 255, 255)';
      while (parent) {
        const color = getComputedStyle(parent).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { backdrop = color; break; }
        parent = parent.parentElement;
      }
      const background = luminance(backdrop);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(ratio >= 4.5, `Section link contrast: ${ratio.toFixed(3)}:1`);
  });
} finally { await browser.close(); }

console.log(`Commerce polish fixture (compiled ${manifest.__meta?.revision || 'unknown'}, CSS sha256 ${cssHash}): ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
