import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This fixture serves local modules and inert product cards only. It has no
// Commerce component, remote request, account, order or payment capability.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://theme.test';
const sourcePath = '/shop/products?keyword=%E5%9B%BE%E6%A0%87&categoryId=cat-b&sort=title%2Casc&view=all&page=3';
const content = (scene) => `<div class="shop-app" data-app-root="shop" data-shop-scene="${scene}" data-shop-chrome-title="搜索结果"><aside class="shop-sidebar"><a href="/shop/products">所有商品</a></aside><main class="shop-main" style="height:240px;overflow:auto">${scene === 'products' ? '<a id="item" href="/shop/product/item">图标</a><a id="other" href="/shop/product/other">其他商品</a>' : '<a id="return" href="/shop/products" data-shop-return>返回商店</a>'}<div style="height:2400px"></div></main></div>`;
const browser = await chromium.launch({ headless: true });
let passed = 0;
const failures = [];

async function scenario(name, action, { pathname = sourcePath } = {}) {
  const browserContext = await browser.newContext({ serviceWorkers: 'block' });
  const errors = [], requests = [];
  await browserContext.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') { requests.push(request.url()); return route.abort(); }
    if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${content(url.pathname.includes('/product/') ? 'product' : 'products')}</body></html>` });
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(root, url.pathname), 'utf8') });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    requests.push(request.url()); return route.abort();
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}${pathname}`);
    await page.evaluate(async (sourceContent) => {
      const { hydrateShop } = await import('/src/apps/shop/runtime.js');
      const { createNavigationAdmission } = await import('/src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js');
      window.__hydrate = hydrateShop;
      window.__content = sourceContent;
      history.replaceState({ uid: 'source-entry' }, '', location.href);
      window.__allowed = true; window.__navigations = [];
      const admission = createNavigationAdmission({ eventTarget: document });
      admission.registerNavigationGuard({ id: 'fixture', capture: () => 0, allow: () => window.__allowed, isUnchanged: () => true, commit() {} });
      window.__begin = (href) => {
        const result = admission.prepareNavigation({ url: href, source: 'click' });
        if (result.kind !== 'accepted') return false;
        window.__navigations.push(href);
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { url: href, intentId: window.__navigations.length, source: 'click' } }));
        return true;
      };
      window.pjax = { loadUrl: (href) => window.__begin(href) };
      document.addEventListener('click', (event) => {
        if (window.__interceptClicks === false) return;
        const link = event.target.closest('a');
        if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
        event.preventDefault(); window.__begin(link.href);
      });
      window.__mount = (href, uid, scene, popstate = false) => {
        window.__cleanup?.();
        const target = new URL(href, location.href).href;
        document.body.innerHTML = `<div data-pjax-target-url="${target}">${window.__content[scene]}</div>`;
        // Match the shell: hydrate against the declared target before history
        // commits the visible URL. Guard and component setup run first.
        window.__cleanup = window.__hydrate(document);
        if (!popstate) history.pushState({ uid }, '', href);
        delete document.querySelector('[data-pjax-target-url]').dataset.pjaxTargetUrl;
        document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { url: location.href, appId: 'shop', root: document.body } }));
      };
      window.__cleanup = window.__hydrate(document);
      window.addEventListener('popstate', () => window.__mount(location.href, history.state.uid, location.pathname.includes('/product/') ? 'product' : 'products', true));
    }, { products: content('products'), product: content('product') });
    await action(page);
    assert.deepEqual(errors, [], 'Shop has no browser errors');
    assert.deepEqual(requests, [], 'All requests are locally intercepted');
    passed++; console.log(`PASS ${name}`);
  } catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { await browserContext.close(); }
}

try {
  await scenario('accepted product navigation returns to the exact directory and restores its main scroll', async (page) => {
    await page.evaluate(() => { document.querySelector('.shop-main').scrollTop = 438; window.__hydrate(document); window.__hydrate(document); });
    await page.evaluate(() => document.getElementById('item').click());
    assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'No context is committed before product hydration');
    await page.evaluate(() => window.__mount('/shop/product/item', 'detail-entry', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${sourcePath}`);
    await page.click('#return');
    assert.equal(await page.evaluate(() => window.__navigations.at(-1)), `${origin}${sourcePath}`);
    await page.evaluate((sourcePath) => window.__mount(sourcePath, 'return-entry', 'products'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
    assert.equal(await page.evaluate(() => window.__navigations.length), 2, 'Repeated hydration binds one listener');
  });

  await scenario('browser back restores its source entry after popstate', async (page) => {
    await page.evaluate(() => { document.querySelector('.shop-main').scrollTop = 612; });
    await page.evaluate(() => document.getElementById('item').click());
    await page.evaluate(() => window.__mount('/shop/product/item', 'detail-entry', 'product'));
    await page.evaluate(() => history.back());
    await page.waitForURL(`${origin}${sourcePath}`);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 612);
  });

  await scenario('vetoed navigation does not save source context or alter history', async (page) => {
    await page.evaluate(() => { window.__allowed = false; });
    await page.click('#item');
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.equal(page.url(), `${origin}${sourcePath}`);
    assert.equal(await page.evaluate(() => history.state.uid), 'source-entry');
    // A later unrelated programmatic detail mount cannot consume the vetoed click.
    await page.evaluate(() => window.__mount('/shop/product/item', 'later-direct-entry', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products');
  });

  await scenario('failed accepted navigation discards the candidate source', async (page) => {
    await page.click('#item');
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { url: '/shop/product/item', outcome: 'failed' } }));
      window.__mount('/shop/product/item', 'direct-entry', 'product');
    });
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products');
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  });

  await scenario('another product and a later direct visit never borrow a stored product source', async (page) => {
    await page.click('#item');
    await page.evaluate(() => window.__mount('/shop/product/item', 'detail-entry', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${sourcePath}`);
    await page.evaluate(() => window.__mount('/shop/product/other', 'other-entry', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products');
    await page.evaluate(() => window.__mount('/shop/product/item', 'direct-entry', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products');
  });

  await scenario('modifier and new-window clicks preserve native handling and write no context', async (page) => {
    await page.evaluate(() => {
      const link = document.getElementById('item');
      document.addEventListener('click', (event) => event.preventDefault());
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      link.target = '_blank';
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event('pagehide'));
    });
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.equal(await page.evaluate(() => window.__navigations.length), 0);
  });

  await scenario('detail without a source keeps the store fallback', async (page) => {
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products');
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  }, { pathname: '/shop/product/direct?returnTo=https://outside.test/shop/products&orderCode=private' });

  await scenario('blocked storage retains source and scroll during same-app navigation', async (page) => {
    await page.evaluate(() => {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
      document.querySelector('.shop-main').scrollTop = 382;
      document.getElementById('item').click();
      window.__mount('/shop/product/item', 'detail-entry', 'product');
    });
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${sourcePath}`);
    await page.click('#return');
    await page.evaluate((sourcePath) => window.__mount(sourcePath, 'return-entry', 'products'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 382);
  });

  await scenario('native document navigation also returns filters and source scroll', async (page) => {
    await page.evaluate(() => { window.pjax = undefined; window.__interceptClicks = false; document.querySelector('.shop-main').scrollTop = 534; });
    await Promise.all([page.waitForURL(`${origin}/shop/product/item`), page.evaluate(() => document.getElementById('item').click())]);
    await page.evaluate(async () => {
      history.replaceState({ uid: 'native-detail' }, '', location.href);
      const { hydrateShop } = await import('/src/apps/shop/runtime.js');
      window.__cleanup = hydrateShop(document);
    });
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${sourcePath}`);
    await Promise.all([page.waitForURL(`${origin}${sourcePath}`), page.click('#return')]);
    await page.evaluate(async () => {
      history.replaceState({ uid: 'native-return' }, '', location.href);
      const { hydrateShop } = await import('/src/apps/shop/runtime.js');
      window.__cleanup = hydrateShop(document);
    });
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 534);
  });

  await scenario('same product retains each history entry source across different directories', async (page) => {
    const directoryB = '/shop/products?keyword=%E6%A8%A1%E6%9D%BF&categoryId=cat-c&sort=minPrice%2Casc&view=all&page=2';
    await page.evaluate(() => {
      document.querySelector('.shop-main').scrollTop = 438;
      document.getElementById('item').click();
      window.__mount('/shop/product/item', 'P1', 'product');
    });
    await page.click('#return');
    await page.evaluate((sourcePath) => window.__mount(sourcePath, 'A2', 'products'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
    await page.evaluate((directoryB) => {
      window.__begin(new URL(directoryB, location.href).href);
      window.__mount(directoryB, 'B3', 'products');
      document.querySelector('.shop-main').scrollTop = 612;
      document.getElementById('item').click();
      window.__mount('/shop/product/item', 'P4', 'product');
    }, directoryB);
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${directoryB}`);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => history.state.uid === 'B3');
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 612);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => history.state.uid === 'A2');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => history.state.uid === 'P1');
    assert.equal(await page.locator('#return').getAttribute('href'), `${origin}${sourcePath}`, 'Older detail entry still belongs to directory A');
    await page.click('#return');
    await page.evaluate((sourcePath) => window.__mount(sourcePath, 'A5', 'products'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
    await page.evaluate(() => window.__mount('/shop/product/item', 'later-direct', 'product'));
    assert.equal(await page.locator('#return').getAttribute('href'), '/shop/products', 'A new direct detail entry does not borrow P1 or P4');
  });

  await scenario('a return-created directory history entry keeps its source scroll', async (page) => {
    await page.evaluate(() => {
      document.querySelector('.shop-main').scrollTop = 438;
      document.getElementById('item').click();
      window.__mount('/shop/product/item', 'P1', 'product');
    });
    await page.click('#return');
    await page.evaluate((sourcePath) => window.__mount(sourcePath, 'A2', 'products'), sourcePath);
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
    await page.evaluate(() => {
      const next = new URL('/shop/products?view=all&categoryId=cat-c', location.href).href;
      window.__begin(next); window.__mount(next, 'B3', 'products');
      history.back();
    });
    await page.waitForFunction(() => history.state.uid === 'A2');
    await page.waitForFunction(() => document.querySelector('.shop-main').scrollTop === 438);
  });
} finally { await browser.close(); }
console.log(`Shop browse context: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
