import { assertCurrentBuild } from './lib/build-identity.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Local sources and inert markup only. Every request is intercepted, so this
// fixture cannot read an account or contact a Commerce/Halo service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const origin = 'https://theme.test';
const optionalRead = (file) => readFile(path.join(root, file), 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const rawCss = await readFile(path.join(root, 'src/apps/shop/styles/index.css'), 'utf8');
const sourceCss = rawCss.replace(/^@import[^;]+;\s*/gm, '').replace(/^@source[^;]+;\s*/gm, '').replace(/@plugin\s+"daisyui"\s*\{[^}]*\}/, '');
const chromeCss = await optionalRead('src/apps/shop/styles/chrome.css');
const sidebar = await readFile(path.join(root, 'templates/modules/shop-app/sidebar.html'), 'utf8');
const menu = sidebar.match(/<button th:fragment="menuToggle"[\s\S]*?<\/button>/)?.[0].replace(/ th:fragment="menuToggle"/, '') || '';
const chromeSource = await optionalRead('templates/modules/shop-app/chrome.html');
const chrome = chromeSource.replace(/<th:block[^>]*th:replace="[^"]*menuToggle[^"]*"[^>]*><\/th:block>/g, menu);
const productTemplate = await readFile(path.join(root, 'templates/modules/shop-app/product.html'), 'utf8');
const returnLink = productTemplate.match(/<a\b[^>]*data-shop-return[\s\S]*?<\/a>/)?.[0] || '';
const sourcePath = '/shop/products?keyword=%E5%9B%BE%E6%A0%87&categoryId=cat-b&sort=title%2Casc&view=all&page=3';
const shellCss = await readFile(path.join(root, 'templates/assets/css/shell-core/index.css'), 'utf8');
const shellLayout = await readFile(path.join(root, 'templates/modules/shell/layout.html'), 'utf8');
const shellFrame = await readFile(path.join(root, 'templates/modules/shell/window-frame.html'), 'utf8');
const layerClasses = shellLayout.match(/<div class="(window-layer[^"]+)"/)?.[1];
const frameClasses = shellFrame.match(/<div class="(macos-window[^"]+)"/)?.[1];
assert.ok(layerClasses && frameClasses, 'Real shell layer and window classes must be available');

function content({ scene = 'products', title = '探索', heading = true } = {}) {
  return `<div class="shop-app" data-app-root="shop" data-shop-scene="${scene}" data-shop-chrome-title="${scene === 'products' ? '所有商品' : title}" data-shop-site-title="Fixture" data-menu-open="false">
    <div class="shop-app-shell">
      <aside class="shop-sidebar" id="shop-sidebar" aria-label="商店导航"><div class="shop-dragbar"></div><input id="sidebar-first" aria-label="搜索商品"><a id="sidebar-last" href="#account">账户</a></aside>
      <button class="shop-menu-backdrop" type="button" data-shop-menu-close aria-label="关闭商店导航" tabindex="-1"></button>
      ${chrome}
      <main class="shop-main">
        <div class="shop-main-header">${chrome ? '' : menu}${scene === 'product' ? returnLink : ''}${heading && scene !== 'product' ? `<h1 class="shop-page-title">${title}</h1>` : ''}</div>
        ${heading && scene === 'product' ? `<h1 class="shop-product-title">${title}</h1>` : ''}
        <a id="product-link" href="/shop/product/item">查看商品</a><div style="height:2400px"></div>
      </main>
    </div>
  </div>`;
}

const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;
async function scenario(name, action, { mobile = false, width = mobile ? 390 : 1280, scene = 'products', title = '探索', heading = true, initialScroll = 0, pathname, shell = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, serviceWorkers: 'block' });
  const errors = [], unsafe = [], documents = [];
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') { unsafe.push(`${request.method()} ${request.url()}`); return route.abort(); }
    if (request.isNavigationRequest()) {
      documents.push(request.url());
      const app = content({ scene, title, heading });
      const body = shell
        ? `<div class="menubar"><span>Fixture</span></div><div class="${layerClasses}"><div id="window-frame-root"><div class="${frameClasses} shop-window"><div class="shop-window-content"><div id="pjax-container" class="shop-window-content">${app}</div></div></div></div></div>`
        : `<div class="shop-window">${app}</div>`;
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${shell ? shellCss : ''}\n${sourceCss}\n${chromeCss}\nhtml,body{margin:0;height:100%}${shell ? '' : '.shop-window{position:fixed;inset:0}.shop-app-shell{height:100%}'}</style></head><body>${body}</body></html>` });
    }
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const local = path.resolve(root, `.${url.pathname}`);
      if (!local.startsWith(path.join(root, 'src') + path.sep)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(local, 'utf8') });
    }
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    unsafe.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}${pathname || (scene === 'product' ? '/shop/product/item' : '/shop/products')}`);
    await page.evaluate(async ({ contentSources, initialScroll }) => {
      const { hydrateShop } = await import('/src/apps/shop/runtime.js');
      window.__hydrate = hydrateShop;
      window.__content = contentSources;
      history.replaceState({ uid: 'source' }, '', location.href);
      window.__pjaxLoads = [];
      window.pjax = { loadUrl: (href) => {
        window.__pjaxLoads.push(href);
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { url: href } }));
      } };
      document.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (!link || event.defaultPrevented || link.getAttribute('href').startsWith('#')) return;
        event.preventDefault();
        window.pjax.loadUrl(link.href);
      });
      window.__mount = (scene, href, uid) => {
        window.__dispose?.();
        const shell = document.querySelector('.shop-window');
        shell.innerHTML = window.__content[scene];
        shell.dataset.pjaxTargetUrl = new URL(href, location.href).href;
        window.__dispose = window.__hydrate(shell);
        history.pushState({ uid }, '', href);
        delete shell.dataset.pjaxTargetUrl;
        document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { appId: 'shop', url: location.href } }));
      };
      document.querySelector('.shop-main').scrollTop = initialScroll;
      window.__dispose = hydrateShop(document);
    }, { initialScroll, contentSources: { products: content({ title: '分类名称' }), product: content({ scene: 'product', title: '商品名称' }) } });
    await action(page);
    assert.deepEqual(errors, [], 'No page errors');
    assert.deepEqual(unsafe, [], 'Only local intercepted GETs are allowed');
    assert.equal(documents.length, 1, 'Chrome navigation must not load a new document');
    passed++; console.log(`PASS ${name}`);
  } catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { await context.close(); }
}

async function scroll(page, top) {
  await page.evaluate((top) => { document.querySelector('.shop-main').scrollTop = top; }, top);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const titleVisible = (page) => page.locator('[data-shop-titlebar]').getAttribute('data-title-visible');

try {
  await scenario('inner main scroll retains a centered title and a stationary sidebar', async (page) => {
    assert.equal(await page.locator('[data-shop-titlebar]').count(), 1, 'Shop needs one fixed titlebar outside the scrolling main');
    assert.equal(await titleVisible(page), 'false');
    const sidebarTop = await page.locator('.shop-sidebar').evaluate((node) => node.getBoundingClientRect().top);
    await scroll(page, 320);
    assert.equal(await titleVisible(page), 'true');
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '探索');
    const geometry = await page.evaluate(() => {
      const bar = document.querySelector('[data-shop-titlebar]').getBoundingClientRect(), title = document.querySelector('[data-shop-titlebar-title]').getBoundingClientRect(), main = document.querySelector('.shop-main').getBoundingClientRect();
      return { barLeft: bar.left, mainLeft: main.left, barTop: bar.top, mainTop: main.top, height: bar.height, delta: Math.abs((title.left + title.right) / 2 - (bar.left + bar.right) / 2), scroll: window.scrollY };
    });
    assert.equal(geometry.barLeft, geometry.mainLeft);
    assert.equal(geometry.barTop, geometry.mainTop);
    assert.equal(geometry.height, 52);
    assert.ok(geometry.delta < 1, 'The compact title stays at the content center');
    assert.equal(geometry.scroll, 0, 'Only main scrolls');
    assert.equal(await page.locator('.shop-sidebar').evaluate((node) => node.getBoundingClientRect().top), sidebarTop);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('[data-shop-titlebar-title]').getAttribute('aria-hidden'), 'true');
    await scroll(page, 0);
    assert.equal(await titleVisible(page), 'false');
  });

  await scenario('title changes exactly as the real h1 leaves the bar area', async (page) => {
    const threshold = await page.evaluate(() => {
      const title = document.querySelector('h1').getBoundingClientRect(), main = document.querySelector('.shop-main').getBoundingClientRect();
      return title.bottom - main.top - 52;
    });
    await scroll(page, Math.max(0, Math.floor(threshold) - 1));
    assert.equal(await titleVisible(page), 'false');
    await scroll(page, Math.ceil(threshold) + 1);
    assert.equal(await titleVisible(page), 'true');
  });

  for (const title of ['全部分类', '分类名称', '“图标”的搜索结果']) {
    await scenario(`compact title reads actual h1: ${title}`, async (page) => {
      await scroll(page, 180);
      assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), title);
    }, { title });
  }

  await scenario('already scrolled hydration initializes the compact title', async (page) => {
    assert.equal(await titleVisible(page), 'true');
  }, { initialScroll: 320 });

  await scenario('product uses its existing title', async (page) => {
    await scroll(page, 320);
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '商品名称');
    assert.equal(await titleVisible(page), 'true');
  }, { scene: 'product', title: '商品名称' });

  await scenario('transaction fallback appears after scrolling without adding h1', async (page) => {
    assert.equal(await titleVisible(page), 'false');
    await scroll(page, 120);
    assert.equal(await titleVisible(page), 'true');
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '购物车');
    assert.equal(await page.locator('h1').count(), 0);
  }, { scene: 'cart', title: '购物车', heading: false });

  await scenario('late transaction component heading waits for its actual h1 to leave', async (page) => {
    await page.evaluate(() => {
      const entry = document.createElement('div');
      entry.className = 'shop-entry';
      entry.innerHTML = '<div class="shop-entry__header"><h1 class="shop-entry__title">购物车</h1></div>';
      document.querySelector('.shop-main-header').after(entry);
    });
    const partialScroll = await page.evaluate(() => {
      const main = document.querySelector('.shop-main').getBoundingClientRect();
      const barHeight = document.querySelector('[data-shop-titlebar]').getBoundingClientRect().height;
      const threshold = document.querySelector('.shop-entry__title').getBoundingClientRect().bottom - main.top - barHeight;
      if (threshold <= barHeight + 2) throw new Error('Fixture needs an actual heading still visible past the fallback scroll threshold');
      return Math.round((barHeight + threshold) / 2);
    });
    await scroll(page, partialScroll);
    assert.equal(await titleVisible(page), 'false', 'The official component h1 still occupies the page; do not duplicate it');
    await scroll(page, 320);
    assert.equal(await titleVisible(page), 'true');
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '购物车');
  }, { scene: 'cart', title: '购物车', heading: false });

  await scenario('phone menu remains reachable after title scroll and restores focus', async (page) => {
    const headingTop = await page.locator('h1').evaluate((node) => node.getBoundingClientRect().top);
    assert.ok(headingTop >= 44, 'Mobile content clears the fixed titlebar');
    await scroll(page, 240);
    assert.equal(await titleVisible(page), 'true');
    assert.equal(await page.locator('[data-shop-titlebar]').evaluate((node) => node.getBoundingClientRect().height), 44);
    await page.click('[data-shop-menu-toggle]');
    await page.waitForFunction(() => document.activeElement.id === 'sidebar-first');
    assert.equal(await page.locator('.shop-sidebar').evaluate((node) => node.inert), false);
    await page.locator('#sidebar-last').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-first');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-shop-menu-toggle]').evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator('.shop-sidebar').evaluate((node) => node.inert), true);
  }, { mobile: true });

  await scenario('resize recomputes h1 threshold against the mobile bar', async (page) => {
    await scroll(page, 10);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('[data-shop-titlebar]').getBoundingClientRect().height === 44);
    await scroll(page, 160);
    assert.equal(await titleVisible(page), 'true');
    await scroll(page, 0);
    assert.equal(await titleVisible(page), 'false');
  });

  await scenario('phone product return stays in the fixed bar alongside its menu', async (page) => {
    assert.equal(await page.locator('[data-shop-return]').count(), 1, 'One return entry serves both the first screen and scrolled detail');
    assert.equal(await page.locator('[data-shop-titlebar] [data-shop-return]').count(), 1, 'Return belongs in the fixed titlebar');
    const initial = await page.locator('[data-shop-return]').boundingBox();
    const menu = await page.locator('[data-shop-menu-toggle]').boundingBox();
    assert.ok(initial.height >= 40, 'Return has a comfortable phone touch target');
    assert.ok(initial.x >= menu.x + menu.width, 'Return does not overlap the navigation toggle');
    await scroll(page, 240);
    const scrolled = await page.locator('[data-shop-return]').boundingBox();
    assert.equal(scrolled.y, initial.y, 'Return remains stationary when the product scrolls');
    await page.click('[data-shop-menu-toggle]');
    await page.waitForFunction(() => document.activeElement.id === 'sidebar-first');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-shop-menu-toggle]').evaluate((node) => node === document.activeElement), true);
  }, { mobile: true, scene: 'product', title: '商品名称' });

  for (const width of [320, 360, 390]) {
    await scenario(`${width}px detail title uses the remaining space beside a long return`, async (page) => {
      await page.locator('[data-shop-return]').evaluate((node) => { node.textContent = '‹ 返回一个包含搜索条件的很长来源分类名称'; });
      await scroll(page, 490);
      assert.equal(await titleVisible(page), 'true');
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector('[data-shop-titlebar]').getBoundingClientRect();
        const title = document.querySelector('[data-shop-titlebar-title]').getBoundingClientRect();
        const back = document.querySelector('[data-shop-return]');
        const link = back.getBoundingClientRect();
        const menu = document.querySelector('[data-shop-menu-toggle]').getBoundingClientRect();
        return { titleWidth: title.width, titleLeft: title.left, titleRight: title.right, barRight: bar.right, backRight: link.right, backLeft: link.left, backHeight: link.height, menuRight: menu.right, returnTruncated: back.scrollWidth > back.clientWidth, remainingCenter: (link.right + 8 + bar.right - 12) / 2, titleCenter: (title.left + title.right) / 2 };
      });
      assert.ok(geometry.titleWidth >= 140, `The fixed title remains identifiable: ${geometry.titleWidth}px available at ${width}px`);
      assert.ok(geometry.backHeight >= 40 && geometry.backLeft >= geometry.menuRight, 'Return retains its touch target beside the menu');
      assert.ok(geometry.returnTruncated, 'Long return text truncates within its allocated width');
      assert.ok(geometry.titleLeft >= geometry.backRight + 6 && geometry.titleRight <= geometry.barRight - 8, 'Title stays between the return and the right inset');
      assert.ok(Math.abs(geometry.titleCenter - geometry.remainingCenter) < 1, 'Title is centered within the remaining space');
    }, { mobile: true, width, scene: 'product', title: '桌面资源精选与个性化图标套装' });
  }

  for (const width of [320, 390, 640, 641]) {
    await scenario(`${width}px real shell leaves the Shop controls below the site menubar`, async (page) => {
      await scroll(page, 490);
      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const value = document.querySelector(selector).getBoundingClientRect();
          return { top: value.top, bottom: value.bottom, left: value.left, right: value.right };
        };
        return { menubar: rect('.menubar'), layer: rect('.window-layer'), window: rect('.shop-window'), bar: rect('[data-shop-titlebar]'), title: rect('[data-shop-titlebar-title]'), menu: rect('[data-shop-menu-toggle]'), back: rect('[data-shop-return]'), height: innerHeight, pageScroll: document.documentElement.scrollHeight };
      });
      const expectedTop = width <= 640 ? 44 : 28;
      assert.equal(geometry.layer.top, expectedTop, `Shop layer must follow the real menubar breakpoint: ${JSON.stringify(geometry)}`);
      for (const key of ['window', 'bar', 'title', 'menu', 'back']) {
        assert.ok(geometry[key].top >= geometry.menubar.bottom, `${key} must not be covered by the site menubar`);
      }
      assert.equal(geometry.layer.bottom, geometry.height, 'The layer still reaches the viewport bottom');
      assert.ok(geometry.window.bottom <= geometry.height + 1 && geometry.pageScroll <= geometry.height + 1, 'The adjusted frame must not introduce document overflow');
      await page.click('[data-shop-menu-toggle]');
      await page.waitForFunction(() => document.activeElement.id === 'sidebar-first');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-shop-menu-toggle]').evaluate((node) => node === document.activeElement), true, 'Menu remains reachable and restores focus');
      await page.locator('.shop-window').evaluate((node) => node.classList.remove('shop-window'));
      assert.equal(await page.locator('.window-layer').evaluate((node) => node.getBoundingClientRect().top), 28, 'The scoped adjustment ends when another app replaces Shop');
    }, { mobile: true, width, scene: 'product', title: '桌面资源精选与个性化图标套装', shell: true });
  }

  await scenario('long product title keeps the fixed return visible and distinct', async (page) => {
    await scroll(page, 490);
    const link = page.locator('[data-shop-titlebar] [data-shop-return]');
    assert.equal(await link.count(), 1);
    const back = await link.boundingBox();
    const title = await page.locator('[data-shop-titlebar-title]').boundingBox();
    assert.ok(back.y >= 0 && back.y + back.height <= 52, 'Return remains entirely inside the fixed bar');
    assert.ok(title.x >= back.x + back.width, 'The product title does not cover the return entry');
    await link.click();
    assert.deepEqual(await page.evaluate(() => window.__pjaxLoads), [`${origin}/shop/products`], 'Direct detail entry falls back to the catalog with one navigation');
  }, { scene: 'product', title: '一个需要验证截断并且不能覆盖返回入口的很长商品名称'.repeat(5) });

  await scenario('stale product cleanup cannot remove the current fixed return', async (page) => {
    const result = await page.evaluate(async () => {
      const { hydrateShopChrome } = await import('/src/apps/shop/chrome.js');
      window.__dispose();
      const app = document.querySelector('[data-app-root="shop"]');
      const first = hydrateShopChrome(app);
      const second = hydrateShopChrome(app);
      first();
      const active = app.querySelectorAll('[data-shop-titlebar] [data-shop-return]').length;
      second();
      return { active, restored: app.querySelectorAll('.shop-main-header [data-shop-return]').length, total: app.querySelectorAll('[data-shop-return]').length };
    });
    assert.deepEqual(result, { active: 1, restored: 1, total: 1 }, 'Stale cleanup preserves active ownership; current cleanup restores the original fallback');
  }, { scene: 'product', title: '商品名称' });

  await scenario('repeated hydrate and disposal cancel stale frames and listeners', async (page) => {
    const result = await page.evaluate(async () => {
      const { hydrateShopChrome } = await import('/src/apps/shop/chrome.js');
      window.__dispose();
      const NativeObserver = window.ResizeObserver;
      const activeObservers = new Set();
      window.ResizeObserver = class extends NativeObserver {
        constructor(callback) { super(callback); activeObservers.add(this); }
        disconnect() { activeObservers.delete(this); super.disconnect(); }
      };
      const app = document.querySelector('[data-app-root="shop"]'), bar = app.querySelector('[data-shop-titlebar]'), main = app.querySelector('.shop-main');
      const cleanup = hydrateShopChrome(app);
      main.scrollTop = 320;
      main.dispatchEvent(new Event('scroll'));
      cleanup();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const disposedTitle = bar.dataset.titleVisible;
      const cleanup2 = hydrateShopChrome(app);
      const cleanup3 = hydrateShopChrome(app);
      const currentObservers = activeObservers.size;
      cleanup2();
      main.scrollTop = 0;
      main.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const liveTitle = bar.dataset.titleVisible;
      cleanup3();
      main.scrollTop = 320;
      main.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.ResizeObserver = NativeObserver;
      return { disposedTitle, liveTitle, finalTitle: bar.dataset.titleVisible, currentObservers, remainingObservers: activeObservers.size };
    });
    assert.equal(result.disposedTitle, 'false', 'Pending old RAF cannot write after cleanup');
    assert.equal(result.liveTitle, 'false', 'Rehydrated main has exactly the current state');
    assert.equal(result.finalTitle, 'false', 'Scroll and resize callbacks cannot write after disposal');
    assert.equal(result.currentObservers, 1, 'Repeated hydration retains only the live resize observer');
    assert.equal(result.remainingObservers, 0, 'Disposal releases the real resize observer');
  });

  await scenario('fast PJAX replacement cannot carry the previous title', async (page) => {
    await page.evaluate(() => {
      document.querySelector('.shop-main').scrollTop = 320;
      document.querySelector('.shop-main').dispatchEvent(new Event('scroll'));
      window.__mount('product', '/shop/product/item', 'product');
    });
    await scroll(page, 200);
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '商品名称');
    assert.equal(await titleVisible(page), 'true');
    assert.equal(await page.locator('[data-shop-titlebar]').count(), 1);
  });

  await scenario('browse return restores scroll and its compact category title', async (page) => {
    await scroll(page, 438);
    await page.evaluate(() => document.getElementById('product-link').click());
    await page.evaluate(() => window.__mount('product', '/shop/product/item', 'product'));
    const link = page.locator('[data-shop-titlebar] [data-shop-return]');
    assert.equal(await link.getAttribute('href'), `${origin}${sourcePath}`, 'Return preserves keyword, category, sorting, view, and page');
    assert.match(await link.textContent(), /返回探索/);
    await scroll(page, 490);
    await page.evaluate(() => { window.__pjaxLoads = []; });
    await link.click();
    assert.deepEqual(await page.evaluate(() => window.__pjaxLoads), [`${origin}${sourcePath}`], 'Return hands off exactly once to existing PJAX');
    await page.evaluate((href) => window.__mount('products', href, 'return'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
    await page.waitForFunction(() => document.querySelector('[data-shop-titlebar]').dataset.titleVisible === 'true');
    assert.equal(await page.locator('[data-shop-titlebar-title]').textContent(), '分类名称');
  }, { pathname: sourcePath });
} finally { await browser.close(); }

console.log(`Shop chrome fixture: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
