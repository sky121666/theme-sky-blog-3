import { assertCurrentBuild } from './lib/build-identity.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  origin, api, csrf, contextId, orderCode, sessionCode, products, variants,
  cartItems, checkout, addresses, order, methods, payment, qrPlaceholder,
} from './fixtures/commerce-data.mjs';

// This is an isolated commit-stage fixture, not a live Halo navigation test.
// The default mode reads only current repo assets/source. --baseline-sdk is an
// explicit negative control using the old public SDK, never a green dependency.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const baseline = process.argv.includes('--baseline-sdk');
const option = (name, fallback = '') => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const label = option('label', baseline ? 'baseline-sdk' : 'current-build');
assert.match(label, /^[a-z0-9-]+$/, 'Use a plain artifact label');
const output = path.join(root, 'output/playwright', `commerce-pjax-${label}`);
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
assert.ok(manifest.shop?.js?.length && manifest.shop?.css?.length, 'Build current Shop assets first');
const assetFile = (url) => {
  const pathname = new URL(url, origin).pathname;
  assert.ok(pathname.startsWith(assetPrefix), `Unexpected theme asset: ${url}`);
  const file = path.resolve(root, 'templates/assets', pathname.slice(assetPrefix.length));
  assert.ok(file.startsWith(path.join(root, 'templates/assets') + path.sep), 'Only repo assets can be served');
  return file;
};
const compiledShopUrl = manifest.shop.js[0];
const compiledShop = baseline ? null : await readFile(assetFile(compiledShopUrl), 'utf8');
const compiledShopHash = compiledShop ? createHash('sha256').update(compiledShop).digest('hex') : null;
const oldSdk = baseline ? await readFile(path.join(root, 'output/commerce-adaptation-2026-10-08/fixture-main.iife.js'), 'utf8') : null;
const withVersion = (url) => `${url}?${manifest.__meta.query}`;
const tags = ['shop-buy-box', 'shop-page-cart', 'shop-page-checkout', 'shop-page-payments'];
const scenes = ['gallery', 'product', 'cart', 'checkout', 'payments'];
const scenePath = (scene) => ({ gallery: '/shop', product: '/shop/product/901', cart: '/shop/cart', checkout: `/shop/checkout/${contextId}`, payments: `/shop/order/${orderCode}/payments`, blog: '/archives' })[scene];
const component = (scene) => ({
  gallery: '<h1 class="shop-page-title">商品画廊</h1><a data-shop-browse data-shop-view="all" href="/shop/products?view=all">所有商品</a>',
  product: `<h1 class="shop-page-title">演示商品</h1><shop-buy-box id="901" csrftoken="${csrf}"></shop-buy-box>`,
  cart: `<shop-page-cart csrftoken="${csrf}"></shop-page-cart>`,
  checkout: `<shop-page-checkout contextid="${contextId}" csrftoken="${csrf}" authenticated="true"></shop-page-checkout>`,
  payments: `<shop-page-payments ordercode="${orderCode}" csrftoken="${csrf}" authenticated="true"></shop-page-payments>`,
})[scene];
const appHtml = (scene) => scene === 'blog'
  ? '<article data-app-root="reader"><h1 id="blog-marker">隔离博客页</h1><p>离开商城后保留的内容</p></article>'
  : `<div class="shop-app" data-app-root="shop" data-menu-open="false" data-shop-scene="${scene}" data-shop-chrome-title="${scene}" data-shop-site-title="隔离演示">
    <script type="application/json" data-app-props="shop">{"version":1,"appId":"shop","data":{"scene":"${scene}"}}</script>
    <div class="shop-app-shell"><aside class="shop-sidebar" id="shop-sidebar"><nav class="shop-nav">${scenes.map((name) => `<a class="pjax-link shop-nav-link" data-pjax-app="shop" href="${scenePath(name)}">${name}</a>`).join('')}</nav></aside>
    <main class="shop-main"><div class="shop-main-header"><button type="button" data-shop-menu-toggle aria-controls="shop-sidebar" aria-expanded="false">导航</button></div>${component(scene)}</main></div></div>`;
const documentHtml = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commerce PJAX fixture</title>
  <link rel="stylesheet" href="${withVersion(`${assetPrefix}css/shell-core/index.css`)}">
  ${manifest.shop.css.map((url) => `<link rel="stylesheet" data-app-css="shop" href="${withVersion(url)}">`).join('')}
  <style>body{background:#eef1f5;margin:0;padding:24px}.shop-app{height:900px;min-height:600px}#pjax-container{max-width:1180px;margin:auto}#blog-marker{padding:48px}</style>
  </head><body data-app-id="shop" data-page-app="shop" data-page-mode="browser-shop" data-window-variant="shop"><div id="pjax-container">${appHtml('gallery')}</div></body></html>`;

await mkdir(output, { recursive: true });
const report = {
  kind: 'isolated-commerce-pjax-commit-lifecycle', origin, baseline,
  sources: { shopModule: compiledShopUrl, shopSha256: compiledShopHash, build: manifest.__meta, negativeControlSha256: oldSdk ? createHash('sha256').update(oldSdk).digest('hex') : null },
  limitations: [
    'Fixture replaces SSR app roots to exercise the real page-app and CSS-router commit lifecycle; it does not test the Pjax network/admission pipeline.',
    'Default mode loads the actual current compiled Shop module. Shell page-app and css-router modules are served from current source.',
    'All browser requests are fulfilled or rejected at theme.test. Synthetic local payment initialization and one quantity PUT are the only permitted writes.',
    'This fixture is not live store, checkout submission, payment callback, or account acceptance.',
  ], results: [], failures: [],
};
const browser = await chromium.launch({ headless: true });

async function test(name, action, { hold = '', status = 'PENDING' } = {}) {
  if (option('case') && option('case') !== name) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', serviceWorkers: 'block' });
  const result = { name, assertions: [], requests: [], blocked: [], errors: [], failedRequests: [], screenshots: [] };
  report.results.push(result);
  const check = (name, pass, details) => {
    result.assertions.push({ name, pass: Boolean(pass), ...(details !== undefined ? { details } : {}) });
    assert.ok(pass, `${result.name}: ${name}${details !== undefined ? ` (${JSON.stringify(details)})` : ''}`);
  };
  let heldRoute;
  let releaseHeld;
  const heldReleased = new Promise((resolve) => { releaseHeld = resolve; });
  const respond = (route, body, contentType = 'application/json') => route.fulfill({ status: 200, contentType, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  await context.addInitScript(({ identity, apiPrefix }) => {
    window.__THEME_ASSET_IDENTITY__ = { ...identity, source: 'manifest' };
    window.__fixtureDefinitions = {};
    const define = CustomElementRegistry.prototype.define;
    CustomElementRegistry.prototype.define = function (name, constructor, options) {
      window.__fixtureDefinitions[name] = (window.__fixtureDefinitions[name] || 0) + 1;
      return define.call(this, name, constructor, options);
    };
    window.__fixtureFetches = [];
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const signal = options.signal || (input instanceof Request ? input.signal : undefined);
      const entry = { path: url.pathname, method: options.method || (input instanceof Request ? input.method : 'GET'), aborted: Boolean(signal?.aborted), settled: false };
      if (url.pathname.startsWith(apiPrefix) || url.pathname === '/shop/coupons/mine') {
        window.__fixtureFetches.push(entry);
        signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
      }
      try { const response = await fetch(input, options); entry.settled = true; return response; }
      catch (error) { entry.settled = true; entry.error = error.name; throw error; }
    };
    window.__fixtureTimers = [];
    const timeout = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const entry = { delay, cancelled: false, fired: false };
      entry.id = timeout(() => { entry.fired = true; callback(...args); }, delay);
      window.__fixtureTimers.push(entry);
      return entry.id;
    };
    window.clearTimeout = (id) => {
      const entry = window.__fixtureTimers.find((timer) => timer.id === id);
      if (entry) entry.cancelled = true;
      return clear(id);
    };
    window.__fixtureSubmits = [];
    document.addEventListener('submit', (event) => { event.preventDefault(); window.__fixtureSubmits.push(event.target.action); }, true);
  }, { identity: manifest.__meta, apiPrefix: api });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = { method: request.method(), path: url.pathname + url.search, mode: 'fulfilled-local' };
    result.requests.push(entry);
    if (url.origin !== origin) { entry.mode = 'blocked-external'; result.blocked.push(entry); return route.abort(); }
    const maybeHold = async (body) => {
      if (`${request.method()} ${url.pathname}` === hold) {
        heldRoute = entry;
        entry.held = true;
        await heldReleased;
        try { await respond(route, body); entry.released = true; }
        catch (error) { entry.releaseError = error.message; }
        return;
      }
      return respond(route, body);
    };
    if (request.method() !== 'GET') {
      entry.mode = 'mock-write-local-only';
      entry.body = request.postDataJSON();
      if (request.method() === 'POST' && url.pathname === `${api}/orders/${orderCode}/initiate-payment`) return maybeHold(payment);
      if (hold === `PUT ${api}/cart-items/2901` && request.method() === 'PUT' && url.pathname === `${api}/cart-items/2901`) return maybeHold({ ...cartItems[0], quantity: 3 });
      entry.mode = 'blocked-unexpected-write'; result.blocked.push(entry); return route.abort();
    }
    if (url.pathname.startsWith(assetPrefix)) {
      const ext = path.extname(url.pathname);
      // The old SDK control tests disposal only; it can run while current Vite
      // assets are being rebuilt. No old CSS/cache is needed for that control.
      if (baseline && ext === '.css') return respond(route, '/* baseline lifecycle control */', 'text/css');
      return respond(route, await readFile(assetFile(url.href)), ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : 'text/javascript');
    }
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const local = path.resolve(root, `.${url.pathname}`);
      assert.ok(local.startsWith(path.join(root, 'src') + path.sep), 'Only current source modules can be served');
      return respond(route, await readFile(local, 'utf8'), 'text/javascript');
    }
    if (url.pathname === '/fixture/baseline-sdk.js' && baseline) return respond(route, oldSdk, 'text/javascript');
    if (request.isNavigationRequest() && !url.pathname.startsWith('/uc/')) return respond(route, documentHtml(), 'text/html');
    if (request.isNavigationRequest()) { entry.mode = 'stale-navigation'; return respond(route, '<h1>Unexpected stale order navigation</h1>', 'text/html'); }
    if (url.pathname === '/fixture/images/payment-placeholder.svg') return respond(route, qrPlaceholder, 'image/svg+xml');
    if (url.pathname.startsWith('/fixture/images/')) return respond(route, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#dce8f4"/></svg>', 'image/svg+xml');
    if (url.pathname === `${api}/cart-items`) return maybeHold(cartItems);
    if (url.pathname === `${api}/products/901`) return maybeHold({ ...products[0], productVariants: [variants[0]], specDefinition: [] });
    if (url.pathname === `${api}/ecommerceconfigs/shop`) return respond(route, { contacts: [] });
    if (url.pathname === `${api}/checkout/${contextId}`) return maybeHold(checkout);
    if (url.pathname === `${api}/user-addresses`) return respond(route, addresses);
    if (url.pathname === '/shop/coupons/mine') return respond(route, []);
    if (url.pathname === `${api}/orders/${orderCode}`) return maybeHold(order);
    if (url.pathname === `${api}/orders/${orderCode}/payment-methods`) return respond(route, methods);
    if (url.pathname === `${api}/payment-sessions/${sessionCode}/status`) return respond(route, JSON.stringify(status));
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    entry.mode = 'blocked-unexpected-read'; result.blocked.push(entry); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('requestfailed', (request) => result.failedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  try {
    await page.goto(`${origin}/shop`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async ({ shopUrl, baseline }) => {
      window.__fixtureDocumentMarker = crypto.randomUUID();
      window.__fixturePageApp = await import('/src/shell/desktop-shell/runtime/shared/page-app.js');
      window.__fixtureCssRouter = await import('/src/shell/desktop-shell/runtime/desktop/pjax/css-router.js');
      if (baseline) {
        await import('/src/apps/shop/hydrate.js');
        await import('/fixture/baseline-sdk.js');
      } else await import(shopUrl);
      window.__fixtureDetached = [];
      window.__fixturePageApp.activateCurrentPageApp(document.querySelector('#pjax-container'), { reason: 'fixture-initial' });
      window.__fixtureCommit = async ({ html, scene, pathname }) => {
        const appId = scene === 'blog' ? 'reader' : 'shop';
        const staged = appId === 'shop' ? window.__fixtureCssRouter.stageAppCssForNavigation('shop') : 0;
        window.__fixturePageApp.deactivateCurrentPageApp();
        const container = document.querySelector('#pjax-container');
        const previous = container.firstElementChild;
        if (previous) window.__fixtureDetached.push(previous);
        container.innerHTML = html;
        history.pushState({}, '', pathname);
        document.body.dataset.pageMode = scene === 'blog' ? 'browser-archive' : scene === 'gallery' ? 'browser-shop' : `browser-shop-${scene}`;
        document.body.dataset.windowVariant = scene === 'blog' ? 'browser' : 'shop';
        window.__fixtureCssRouter.setCurrentPageApp(appId);
        window.__fixtureCssRouter.syncAppCss(appId);
        window.__fixturePageApp.activateCurrentPageApp(container.firstElementChild, { reason: 'fixture-pjax-commit' });
        // Svelte custom elements dispose after disconnectedCallback's microtask.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { staged, marker: window.__fixtureDocumentMarker, active: window.__THEME_PAGE_APP_REGISTRY__.activeApp.appId, root: window.__THEME_PAGE_APP_REGISTRY__.activeApp.root.dataset.appRoot, shopCssDisabled: [...document.querySelectorAll('link[data-app-css="shop"]')].every((link) => link.disabled) };
      };
    }, { shopUrl: withVersion(compiledShopUrl), baseline });
    const marker = await page.evaluate(() => window.__fixtureDocumentMarker);
    const commit = async (scene) => {
      const state = await page.evaluate((data) => window.__fixtureCommit(data), { html: appHtml(scene), scene, pathname: scenePath(scene) });
      check(`${scene} keeps the document and activates the incoming root`, state.marker === marker && state.active === (scene === 'blog' ? 'reader' : 'shop') && state.root === (scene === 'blog' ? 'reader' : 'shop'), state);
      check(`${scene} synchronizes real CSS-router state`, state.shopCssDisabled === (scene === 'blog'), state);
      if (scene !== 'blog') check(`${scene} stages cached Shop CSS before replacement`, state.staged === manifest.shop.css.length, state.staged);
      return state;
    };
    const mounted = async (scene) => {
      if (scene === 'cart') await page.locator('.shop-cart-item').first().waitFor();
      if (scene === 'checkout') await page.locator('#address-selector').waitFor();
      if (scene === 'payments') {
        if (status === 'SUCCESS') await page.getByRole('status').filter({ hasText: '支付成功' }).waitFor();
        else await page.locator('.shop-qrcode-image').waitFor();
      }
      if (scene === 'product') await page.locator('shop-buy-box .shop-quantity').waitFor();
    };
    const screenshot = async (suffix) => {
      const file = path.join(output, `${name}-${suffix}.png`);
      await page.screenshot({ path: file, fullPage: true });
      result.screenshots.push(path.relative(root, file));
    };
    await action({ page, check, commit, mounted, screenshot, result, marker, held: () => heldRoute, release: () => releaseHeld() });
    check('all four commerce custom elements defined exactly once', await page.evaluate((tags) => tags.every((tag) => !!customElements.get(tag) && window.__fixtureDefinitions[tag] === 1), tags), await page.evaluate(() => window.__fixtureDefinitions));
    check('no unexpected request or live API fallback', result.blocked.length === 0, result.blocked);
    check('no browser exception', result.errors.length === 0, result.errors);
    check('no checkout or payment form submitted', await page.evaluate(() => window.__fixtureSubmits.length === 0));
    if (!baseline) {
      check('compiled Shop entry fetched once per document', result.requests.filter((entry) => new URL(entry.path, origin).pathname === compiledShopUrl).length === 1);
      check('old public shop-dist SDK never requested', result.requests.every((entry) => !entry.path.startsWith('/shop-dist/')));
    }
    console.log(`PASS ${name}: ${result.assertions.length} assertions`);
  } catch (error) {
    result.failure = error.message;
    report.failures.push(`${name}: ${error.message}`);
    const file = path.join(output, `${name}-failure.png`);
    await page.screenshot({ path: file, fullPage: true }).then(() => result.screenshots.push(path.relative(root, file))).catch(() => {});
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    releaseHeld();
    await context.close();
  }
}

try {
  await test('roundtrip', async ({ page, check, commit, mounted, screenshot }) => {
    for (const scene of [...scenes, ...scenes.slice(0, -1).reverse(), 'blog', 'gallery', 'cart']) {
      await commit(scene);
      await mounted(scene);
      if (scene === 'blog') await screenshot('blog');
    }
    await screenshot('returned-cart');
    check('returning cart rendered fresh real component children', await page.locator('shop-page-cart .shop-cart-item').count() === 2);
    check('all replaced Shop roots are disconnected', await page.evaluate(() => window.__fixtureDetached.every((node) => !node.isConnected)));
  });
  await test('pending-leave', async ({ page, check, commit, mounted, screenshot, result }) => {
    await commit('payments');
    await mounted('payments');
    await page.waitForFunction((path) => window.__fixtureFetches.some((entry) => entry.path === path && entry.settled), `${api}/payment-sessions/${sessionCode}/status`);
    await screenshot('mounted-payment');
    await commit('blog');
    const count = result.requests.filter((entry) => entry.path.startsWith(`${api}/payment-sessions/`)).length;
    await page.waitForTimeout(4100); // Two real 2s poll intervals after disposal.
    check('pending payment has no status polling after 4s away', result.requests.filter((entry) => entry.path.startsWith(`${api}/payment-sessions/`)).length === count, result.requests.filter((entry) => entry.path.startsWith(`${api}/payment-sessions/`)));
    check('pending leave preserves blog URL', new URL(page.url()).pathname === scenePath('blog'));
  });
  await test('success-leave', async ({ page, check, commit, mounted, screenshot, result, marker }) => {
    await commit('payments');
    await mounted('payments');
    await page.getByRole('status').filter({ hasText: '支付成功' }).waitFor();
    check('payment success scheduled a real 1s redirect', await page.evaluate(() => window.__fixtureTimers.some((timer) => timer.delay === 1000 && !timer.fired && !timer.cancelled)));
    await commit('blog');
    await page.waitForTimeout(1250); // Exceeds the actual payment success timer.
    check('leaving SUCCESS before 1s prevents stale order navigation', new URL(page.url()).pathname === scenePath('blog') && result.requests.every((entry) => entry.mode !== 'stale-navigation'), { url: page.url(), stale: result.requests.filter((entry) => entry.mode === 'stale-navigation') });
    check('SUCCESS leave retains the same document marker', await page.evaluate(() => window.__fixtureDocumentMarker) === marker);
    await screenshot('blog-after-deadline');
  }, { status: 'SUCCESS' });
  for (const [scene, delayedPath] of [['product', `${api}/products/901`], ['cart', `${api}/cart-items`], ['checkout', `${api}/checkout/${contextId}`], ['payments', `${api}/orders/${orderCode}`]]) {
    await test(`${scene}-query-abort`, async ({ page, check, commit, held, release, screenshot }) => {
      await commit(scene);
      await page.waitForFunction((path) => window.__fixtureFetches.some((entry) => entry.path === path && !entry.settled), delayedPath);
      await commit('blog');
      const aborted = await page.waitForFunction((path) => window.__fixtureFetches.some((entry) => entry.path === path && entry.aborted), delayedPath, { timeout: 1500 }).then(() => true, () => false);
      check('removing the real custom element aborts its delayed GET transport', aborted, await page.evaluate((path) => window.__fixtureFetches.filter((entry) => entry.path === path), delayedPath));
      const detachedText = await page.evaluate(() => window.__fixtureDetached.at(-1).textContent);
      const blogText = await page.locator('[data-app-root="reader"]').textContent();
      release();
      await page.waitForFunction((path) => window.__fixtureFetches.filter((entry) => entry.path === path).every((entry) => entry.settled), delayedPath);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check('released late GET cannot change replacement blog or removed component', await page.locator('[data-app-root="reader"]').textContent() === blogText && await page.evaluate(() => window.__fixtureDetached.at(-1).textContent) === detachedText);
      check('only one delayed GET was attempted', await page.evaluate((path) => window.__fixtureFetches.filter((entry) => entry.path === path).length, delayedPath) === 1);
      await screenshot('late-response-blog');
    }, { hold: `GET ${delayedPath}` });
  }
  await test('cart-mutation-abort', async ({ page, check, commit, mounted, release, result, screenshot }) => {
    await commit('cart');
    await mounted('cart');
    await page.locator('.shop-cart-item').first().locator('.shop-quantity__btn').last().click();
    await page.waitForFunction((path) => window.__fixtureFetches.some((entry) => entry.path === path && entry.method === 'PUT' && !entry.settled), `${api}/cart-items/2901`);
    check('quantity PUT is explicitly intercepted with synthetic quantity', result.requests.some((entry) => entry.method === 'PUT' && entry.mode === 'mock-write-local-only' && entry.body?.quantity === 3));
    await commit('blog');
    const aborted = await page.waitForFunction((path) => window.__fixtureFetches.some((entry) => entry.path === path && entry.method === 'PUT' && entry.aborted), `${api}/cart-items/2901`, { timeout: 1500 }).then(() => true, () => false);
    check('leaving cancels the already-issued local mutation transport', aborted, await page.evaluate(() => window.__fixtureFetches.filter((entry) => entry.method === 'PUT')));
    const reads = result.requests.filter((entry) => entry.path === `${api}/cart-items`).length;
    release();
    await page.waitForFunction(() => window.__fixtureFetches.filter((entry) => entry.method === 'PUT').every((entry) => entry.settled));
    await page.waitForTimeout(250);
    check('late mutation cannot refetch the cart or toast into the blog', result.requests.filter((entry) => entry.path === `${api}/cart-items`).length === reads && await page.locator('#blog-marker').count() === 1 && await page.locator('[data-sonner-toast]').count() === 0);
    await screenshot('late-mutation-blog');
  }, { hold: `PUT ${api}/cart-items/2901` });
} finally { await browser.close(); }

report.passed = report.failures.length === 0;
report.assertionCount = report.results.reduce((count, result) => count + result.assertions.length, 0);
assert.ok(report.results.length > 0, 'The selected commerce PJAX case must exist');
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Commerce PJAX fixture: ${report.passed ? 'PASS' : 'FAIL'}; ${report.results.length} cases, ${report.assertionCount} assertions. ${path.relative(root, output)}/report.json`);
assert.ok(report.passed, report.failures.join('\n'));
