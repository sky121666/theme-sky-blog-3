import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Display-only fixture: every request is served locally, no commerce component
// or real account is loaded. Reload/real-page checks belong to integration.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCss = await readFile(path.join(root, 'src/apps/shop/styles/index.css'), 'utf8');
const css = sourceCss.replace(/@(?:import|source)\s+[^;]+;/g, '').replace(/@plugin\s+"daisyui"\s*\{[^}]*\}/g, '');
const product = await readFile(path.join(root, 'templates/modules/shop-app/product.html'), 'utf8');
const categories = await readFile(path.join(root, 'templates/modules/shop-app/categories.html'), 'utf8');
const categoryAppearance = await readFile(path.join(root, 'templates/modules/shop-app/category-appearance.html'), 'utf8');
const categoryIcon = categoryAppearance.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
assert.ok(categoryIcon, 'category fixture reuses the real theme icon');
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#7298be"/><rect x="4" y="4" width="632" height="352" fill="none" stroke="#294964" stroke-width="8"/></svg>')}`;
const description = '完整商品简介会保留更多内容，帮助用户理解商品。'.repeat(12);
const title = '商品标题包含中文与LongProductTitle';
const failures = [];
let passed = 0;
async function check(name, action) {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await check('detail classifies only declared product types and keeps official purchase inputs', () => {
  assert.match(product, /product\.productType/);
  assert.match(product, /'VIRTUAL'/);
  assert.match(product, /'PHYSICAL'/);
  assert.match(product, /data-shop-product-kind/);
  assert.match(product, /data-shop-return/);
  assert.match(product, /<shop-buy-box\s+th:id="\$\{product\.id\}"\s+th:csrfToken="\$\{_csrf\.token\}"><\/shop-buy-box>/);
  assert.match(categories, /<details\b[^>]*class="shop-category-children"/);
  assert.match(categories, /category-appearance :: icon/);
  assert.doesNotMatch(categoryAppearance, /category\.(?:imageUrl|coverImageUrl)/);
});

function frame(content, kind = 'products') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0;width:100%;height:100%}.shop-window{width:100%;height:100%}.buy-box{display:grid;gap:12px}.fixture-buy{display:block;min-height:44px}</style></head><body><section class="shop-window"><div class="shop-window-content"><div class="shop-app" data-app-root="shop" data-shop-scene="${kind === 'products' ? 'products' : 'product'}" data-shop-product-kind="${kind}"><div class="shop-app-shell"><aside class="shop-sidebar">商店导航</aside><main class="shop-main"><div class="shop-main-header"><a class="shop-back-link" href="/shop/products">返回商店</a></div>${content}</main></div></div></div></section></body></html>`;
}
const purchase = `<div class="shop-product-purchase"><h1 class="shop-product-title">${title}</h1><p class="shop-product-description">${description}</p><shop-buy-box><div class="buy-box"><div>¥19.00</div><div>版本：标准版 · 数量 1 · 库存 20</div><div class="buy-box__actions"><button class="fixture-buy">加入购物车</button><button class="fixture-buy">立即购买</button></div></div></shop-buy-box></div>`;
const identity = `<div class="shop-product-identity"><img class="shop-product-identity-image" src="${image}" alt="商品身份图片"></div>`;
const physicalGallery = `<div class="shop-product-gallery"><div class="shop-gallery-main"><img src="${image}" alt="实物图片"></div></div>`;
const previews = `<section class="shop-product-previews" aria-label="商品预览"><div class="shop-product-preview-track">${[1, 2].map((n) => `<img class="shop-product-preview-image" src="${image}" alt="商品预览${n}">`).join('')}</div></section>`;
const compact = `<div class="shop-compact-list">${[1, 2, 3, 4, 5, 6].map((n) => `<a class="shop-compact-card" href="/shop/product/${n}"><img class="shop-compact-image" src="${image}" alt="商品${n}" data-shop-media="identity"><div class="shop-compact-content"><p class="shop-product-name">${title}</p><p class="shop-product-description">${description}</p></div><div class="shop-compact-offer"><p class="shop-product-price">${n === 2 ? '免费起' : '¥19.00 起'}</p>${n === 6 ? '<small class="shop-compact-stock">暂时缺货</small>' : ''}</div></a>`).join('')}</div>`;
const gallery = `<div class="shop-gallery-carousel">${[1, 2, 3].map((n) => `<a class="shop-gallery-card" href="/shop/product/${n}"><img class="shop-gallery-image" src="${image}" alt="商品预览${n}"><div class="shop-gallery-caption"><p class="shop-product-name">${title}</p><p class="shop-product-description">商品简介</p><p class="shop-product-price">¥19.00</p></div></a>`).join('')}</div>`;
const editorial = `<div class="shop-editorial-carousel"><a class="shop-editorial-card" href="/shop/product/1"><div class="shop-editorial-content"><p class="shop-product-name">${title}</p><p class="shop-product-description">商品说明</p><p class="shop-product-price">¥19.00</p></div><img class="shop-editorial-image" data-shop-media="identity" src="${image}" alt="身份图片"></a></div>`;
const longCategoryName = '分类名称包含完整中文与LongCategoryNameAndMoreDetails，超长时保持单行';
function categoryLink(id, name, description = '') {
  return `<a class="shop-category-link" href="/shop/products?categoryId=${id}&view=all" title="${name}${description ? '：' + description : ''}"><span class="shop-category-icon" aria-hidden="true">${categoryIcon}</span><span class="shop-category-copy"><span class="shop-category-name">${name}</span></span></a>`;
}
const categoryTree = `<section class="shop-category-overview"><ul class="shop-category-tree" style="--shop-category-rows-wide:7;--shop-category-rows-medium:10">${Array.from({ length: 20 }, (_, index) => {
  const id = index + 1;
  return `<li class="shop-category-branch">${categoryLink(id, id === 5 ? longCategoryName : `分类${id}`, id % 2 ? '保留完整分类说明，包含更多使用信息。' : '')}${id === 3 ? `<details class="shop-category-children"><summary>2 个子分类</summary><ul class="shop-category-tree"><li class="shop-category-branch">${categoryLink(101, '子分类101')}<details class="shop-category-children"><summary>1 个子分类</summary><ul class="shop-category-tree"><li class="shop-category-branch">${categoryLink(103, '孙分类103')}</li></ul></details></li><li class="shop-category-branch">${categoryLink(102, '子分类102')}</li></ul></details>` : ''}</li>`;
}).join('')}</ul></section>`;

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const unexpected = [];
    await context.route('**/*', (route) => { unexpected.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    await check(`${width}px homepage separates the promotion and feature cards`, async () => {
      const features = editorial.replace('class="shop-editorial-carousel"', 'class="shop-home-featured shop-editorial-carousel"').replace('class="shop-editorial-card"', 'class="shop-editorial-card" data-shop-home-product="2"');
      await page.setContent(frame(`<div class="shop-home"><a class="shop-hero" data-shop-home-product="1"><img class="shop-hero-image" src="${image}" alt="宣传图"><div class="shop-hero-content"><p class="shop-hero-name">给桌面一点新灵感</p></div></a>${features}</div>`));
      const gap = await page.evaluate(() => document.querySelector('.shop-home-featured').getBoundingClientRect().top - document.querySelector('.shop-hero').getBoundingClientRect().bottom);
      assert.ok(Math.abs(gap - (width < 768 ? 20 : 36)) <= 1, `Promotion/card spacing is ${gap}px`);
    });
    await check(`${width}px direct homepage hero stays within the main pane while features scroll locally`, async () => {
      const featureCard = editorial.match(/<a class="shop-editorial-card"[\s\S]*?<\/a>/)[0].replace('class="shop-editorial-card"', 'class="shop-editorial-card" data-shop-home-product="2"');
      for (const mediaClass of ['shop-hero-image', 'shop-hero-identity-image']) {
        await page.setContent(frame(`<div class="shop-home" data-shop-home><a class="shop-hero" data-shop-home-product="1" href="/shop/product/1"><img class="${mediaClass}" src="${image}" alt="主推商品"><div class="shop-hero-content"><p class="shop-hero-name">给桌面一点新灵感</p><p class="shop-product-description">精选桌面资源，轻松打造自己的日常工作空间。</p><p class="shop-product-price">¥49.00</p><span class="shop-card-action">查看商品 <span aria-hidden="true">›</span></span></div></a><div class="shop-home-featured shop-editorial-carousel">${featureCard.repeat(2)}</div></div>`));
        const geometry = await page.evaluate(() => {
          const main = document.querySelector('.shop-main');
          const home = document.querySelector('.shop-home').getBoundingClientRect();
          const hero = document.querySelector('.shop-hero'); const heroRect = hero.getBoundingClientRect();
          const carousel = document.querySelector('.shop-home-featured');
          return { mainClient: main.clientWidth, mainScroll: main.scrollWidth, homeRight: home.right, heroLeft: heroRect.left, heroRight: heroRect.right, heroWidth: heroRect.width, heroMinHeight: getComputedStyle(hero).minHeight, heroAspect: getComputedStyle(hero).aspectRatio, carouselClient: carousel.clientWidth, carouselScroll: carousel.scrollWidth, carouselOverflow: getComputedStyle(carousel).overflowX };
        });
        assert.ok(geometry.mainScroll <= geometry.mainClient, `${mediaClass} must not widen the main pane: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.heroRight <= geometry.homeRight + 0.5, `${mediaClass} stays inside homepage bounds: ${JSON.stringify(geometry)}`);
        if (width < 768) {
          assert.ok(geometry.carouselScroll > geometry.carouselClient, 'featured cards retain local horizontal scrolling');
          assert.equal(geometry.carouselOverflow, 'auto');
          const carousel = page.locator('.shop-home-featured');
          await carousel.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
          assert.ok(await carousel.evaluate((node) => node.scrollLeft) > 0, 'the next feature card remains reachable');
          assert.equal(await page.locator('.shop-main').evaluate((node) => node.scrollLeft), 0, 'only the carousel scrolls sideways');
          console.log(`GEOMETRY ${width}px ${mediaClass}: ${JSON.stringify(geometry)}`);
        }
      }
    });
    await check(`${width}px media keeps the whole image and compact rows at 80–100px`, async () => {
      await page.setContent(frame(editorial + compact));
      const media = await page.locator('.shop-editorial-image').evaluate((node) => {
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        return { fit: style.objectFit, radius: parseFloat(style.borderRadius), size: Math.min(rect.width, rect.height) };
      });
      assert.equal(media.fit, 'contain', 'identity image is never clipped to fill a card');
      assert.ok(media.radius < media.size / 3, 'editorial image is not forcibly circular');
      for (const height of await page.locator('.shop-compact-card').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
        assert.ok(height >= 80 && height <= 100, `compact row height: ${height}`);
      }
    });
    await check(`${width}px compact selection uses native icon and price columns without overlap`, async () => {
      await page.setContent(frame(compact));
      const geometry = await page.locator('.shop-compact-list').evaluate((list) => {
        const cards = [...list.querySelectorAll('.shop-compact-card')];
        return { columns: getComputedStyle(list).gridTemplateColumns.split(' ').length, rows: [...new Set(cards.map((card) => card.getBoundingClientRect().top))].length, cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          const image = card.querySelector('img').getBoundingClientRect();
          const content = card.querySelector('.shop-compact-content').getBoundingClientRect();
          const price = card.querySelector('.shop-product-price').getBoundingClientRect();
          return { icon: image.width, contentLeft: content.left, contentRight: content.right, priceLeft: price.left, priceRight: price.right, cardRight: rect.right, dividerLeft: rect.left + parseFloat(getComputedStyle(card, '::after').left) };
        }) };
      });
      assert.equal(geometry.columns, width < 768 ? 1 : 2);
      assert.equal(geometry.rows, width < 768 ? 6 : 3);
      for (const row of geometry.cards) {
        assert.equal(row.icon, 52);
        assert.ok(row.contentRight <= row.priceLeft, `price stays beside text: ${JSON.stringify(row)}`);
        assert.ok(row.priceRight <= row.cardRight, 'price stays inside its row');
        assert.ok(Math.abs(row.dividerLeft - row.contentLeft) <= 0.5, 'divider begins below text');
      }
    });
    await check(`${width}px preview gallery has 16:9 media and two desktop columns with local scrolling`, async () => {
      await page.setContent(frame(gallery));
      const geometry = await page.locator('.shop-gallery-carousel').evaluate((carousel) => {
        const card = carousel.querySelector('.shop-gallery-card').getBoundingClientRect();
        const image = carousel.querySelector('img').getBoundingClientRect();
        const caption = carousel.querySelector('.shop-gallery-caption').getBoundingClientRect();
        return { ratio: image.width / image.height, cardWidth: card.width, paneWidth: carousel.clientWidth, scrollWidth: carousel.scrollWidth, captionTop: caption.top, imageBottom: image.bottom };
      });
      assert.ok(Math.abs(geometry.ratio - 16 / 9) <= 0.01, 'promotion previews use the screenshot aspect ratio');
      if (width >= 768) assert.ok(Math.abs(geometry.cardWidth - (geometry.paneWidth - 20) / 2) <= 1, 'desktop has two preview columns');
      assert.ok(geometry.scrollWidth > geometry.paneWidth, 'the third preview remains in the local horizontal track');
      assert.ok(geometry.captionTop >= geometry.imageBottom, 'title, description and price follow the preview');
    });
    await check(`${width}px digital detail keeps description and purchase ahead of previews`, async () => {
      await page.setContent(frame(`<div class="shop-product-layout">${identity}${purchase}</div>${previews}<div class="shop-product-content">完整正文</div>`, 'virtual'));
      const geometry = await page.evaluate(() => {
        const rect = (selector) => { const n = document.querySelector(selector); const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const style = getComputedStyle(document.querySelector('.shop-product-purchase > .shop-product-description'));
        return { purchase: rect('.shop-product-purchase'), preview: rect('.shop-product-previews'), identity: rect('.shop-product-identity'), clamp: style.webkitLineClamp, buyBox: rect('.buy-box'), overflow: document.querySelector('.shop-main').scrollWidth > document.querySelector('.shop-main').clientWidth };
      });
      assert.equal(geometry.clamp, 'none', 'detail description remains complete');
      assert.ok(geometry.purchase.bottom <= geometry.preview.top, 'previews follow the purchase region');
      assert.ok(geometry.buyBox.top < 700, 'price and purchase information are reachable in the first phone viewport');
      assert.equal(geometry.overflow, false, 'detail has no horizontal overflow');
    });
    await check(`${width}px physical detail gives purchase priority on a phone`, async () => {
      await page.setContent(frame(`<div class="shop-product-layout">${physicalGallery}${purchase}</div>`, 'physical'));
      const geometry = await page.evaluate(() => {
        const gallery = document.querySelector('.shop-product-gallery').getBoundingClientRect();
        const buy = document.querySelector('.shop-product-purchase').getBoundingClientRect();
        return { galleryTop: gallery.top, galleryBottom: gallery.bottom, galleryRight: gallery.right, buyTop: buy.top, buyLeft: buy.left };
      });
      if (width < 768) assert.ok(geometry.buyTop < geometry.galleryTop, 'phone purchase region is before the large physical image');
      else assert.ok(geometry.buyLeft >= geometry.galleryRight, 'desktop physical detail retains image and purchase columns');
    });
    assert.deepEqual(unexpected, [], 'all fixture requests stay local');
    await context.close();
  }
  for (const [width, columns, expectedRows, expectedCounts] of [[1280, 3, 7, [7, 7, 6]], [900, 2, 10, [10, 10]], [390, 1, 20, [20]]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const unexpected = [];
    await context.route('**/*', (route) => { unexpected.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    await check(`${width}px categories fill down columns with aligned 48px rows and nested disclosure`, async () => {
      await page.setContent(frame('<h1 class="shop-page-title">全部分类</h1>' + categoryTree));
      await page.addStyleTag({ content: 'body{font-family:-apple-system,system-ui,"SF Pro Text",sans-serif}.shop-window{max-width:1180px}.shop-main>.shop-main-header{display:none}.shop-main>.shop-page-title{margin-bottom:14px}' });
      const tree = page.locator('.shop-category-overview > .shop-category-tree');
      const geometry = () => tree.evaluate((node) => ({
        columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
        rows: [...node.children].map((branch) => {
          const link = branch.querySelector(':scope > .shop-category-link');
          const rect = link.getBoundingClientRect();
          const icon = link.querySelector('.shop-category-icon').getBoundingClientRect();
          const name = link.querySelector('.shop-category-name').getBoundingClientRect();
          const divider = getComputedStyle(link, '::after');
          return { left: rect.left, top: rect.top, height: rect.height, iconWidth: icon.width, iconMiddle: icon.top + icon.height / 2, nameLeft: name.left, nameMiddle: name.top + name.height / 2, dividerLeft: rect.left + parseFloat(divider.left), dividerTop: rect.bottom - parseFloat(divider.bottom) - parseFloat(divider.height) };
        }),
      }));
      const assertAligned = (layout) => {
        assert.equal(layout.columns, columns);
        assert.equal(new Set(layout.rows.map((row) => row.top)).size, expectedRows, 'categories share grid row positions');
        const columnLefts = [...new Set(layout.rows.map((row) => row.left))];
        assert.deepEqual(columnLefts.map((left) => layout.rows.filter((row) => row.left === left).length), expectedCounts, 'column counts preserve downward reading order');
        for (const [index, row] of layout.rows.entries()) {
          assert.equal(row.left, columnLefts[Math.floor(index / expectedRows)], `category ${index + 1} stays in its column`);
          assert.equal(row.height, 48, 'category link has a fixed row height');
          assert.equal(row.iconWidth, 28, 'category icon keeps its native size');
          assert.ok(Math.abs(row.iconMiddle - row.nameMiddle) <= 0.5, 'icon and name share a center line');
          assert.ok(Math.abs(row.dividerLeft - row.nameLeft) <= 0.5, 'divider starts below the name');
          const sameRow = layout.rows[index % expectedRows];
          assert.ok(Math.abs(row.top - sameRow.top) <= 0.5, 'matching rows across columns remain aligned');
          assert.ok(Math.abs(row.dividerTop - sameRow.dividerTop) <= 0.5, 'matching dividers across columns remain aligned');
        }
      };
      const closed = await geometry();
      assertAligned(closed);
      if (width === 1280) {
        const evidence = path.join(root, 'output/appstore-category-account-2026-10-09');
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: path.join(evidence, 'category-20-isolated.png') });
      }
      const longName = page.getByRole('link', { name: longCategoryName, exact: true });
      assert.equal(await longName.count(), 1, 'ellipsis retains the complete accessible category name');
      const nameStyle = await longName.locator('.shop-category-name').evaluate((node) => ({ whiteSpace: getComputedStyle(node).whiteSpace, overflow: getComputedStyle(node).overflow, ellipsis: getComputedStyle(node).textOverflow, clipped: node.scrollWidth > node.clientWidth }));
      assert.deepEqual(nameStyle, { whiteSpace: 'nowrap', overflow: 'hidden', ellipsis: 'ellipsis', clipped: true });
      assert.ok((await page.locator('.shop-category-link').first().getAttribute('title')).includes('保留完整分类说明'), 'category description remains in its tooltip');
      const children = tree.locator(':scope > .shop-category-branch > .shop-category-children');
      assert.equal(await children.getAttribute('open'), null);
      assert.equal(await children.locator('a').count(), 3, 'SSR retains both children and the grandchild');
      await children.locator(':scope > summary').click();
      assert.equal(await children.locator('a:visible').count(), 2, 'root disclosure opens the two immediate children');
      assertAligned(await geometry());
      await children.locator('.shop-category-children > summary').click();
      assert.equal(await children.locator('a:visible').count(), 3, 'nested disclosure keeps the grandchild reachable');
      const expanded = await geometry();
      assertAligned(expanded);
      assert.ok(expanded.rows[3].top > closed.rows[3].top, 'expanded children move subsequent shared grid rows');
      for (const height of await page.locator('.shop-category-link:visible').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) assert.equal(height, 48, 'nested category links retain the same row height');
      assert.equal(await page.locator('.shop-main').evaluate((node) => node.scrollWidth > node.clientWidth), false, 'categories do not cause horizontal overflow');
      console.log(`CATEGORY_GEOMETRY ${width}px ${JSON.stringify({ columns, expectedCounts, closed: closed.rows, expanded: expanded.rows })}`);
    });
    assert.deepEqual(unexpected, [], 'all category fixture requests stay local');
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', passed, failures, scope: 'isolated media/category/detail layout, no transaction behavior' }, null, 2));
if (failures.length) process.exitCode = 1;
