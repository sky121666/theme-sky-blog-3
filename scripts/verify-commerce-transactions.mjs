import { assertCurrentBuild } from './lib/build-identity.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { origin, api, csrf, contextId, orderCode, sessionCode, cartItems, checkout, addresses, order, methods, payment, qrPlaceholder } from './fixtures/commerce-data.mjs';

// Every browser response is fulfilled locally at theme.test. There is no live
// API fallback. JS/CSS come from the current repository build manifest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const output = path.join(root, 'output/commerce-adaptation-2026-10-08');
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
assert.ok(manifest.shop?.js?.length && manifest.shop?.css?.length, 'Build the current Shop assets first');
const assetPath = (url) => {
  const pathname = new URL(url, origin).pathname;
  assert.ok(pathname.startsWith(assetPrefix), `Unexpected theme asset: ${url}`);
  const local = path.resolve(root, 'templates/assets', pathname.slice(assetPrefix.length));
  assert.ok(local.startsWith(path.join(root, 'templates/assets') + path.sep), 'Assets must remain in templates/assets');
  return local;
};
const compiledShopUrl = manifest.shop.js[0];
const compiledShop = await readFile(assetPath(compiledShopUrl), 'utf8');
const themeCss = (await Promise.all(manifest.shop.css.map((url) => readFile(assetPath(url), 'utf8')))).join('\n');
const shellCss = await readFile(path.join(root, 'templates/assets/css/shell-core/index.css'), 'utf8');
const tags = ['shop-page-cart', 'shop-page-checkout', 'shop-page-payments'];
const transactionTemplate = await readFile(path.join(root, 'templates/modules/shop-app/transaction.html'), 'utf8');
const sidebarTemplate = await readFile(path.join(root, 'templates/modules/shop-app/sidebar.html'), 'utf8');
for (const tag of tags) {
  assert.ok(compiledShop.includes(tag), `current compiled Shop module must contain ${tag}`);
  assert.ok(transactionTemplate.includes(tag), `current transaction template must contain ${tag}`);
}
const sidebar = (scene) => sidebarTemplate.match(/<aside\b[\s\S]*?<\/aside>/)[0]
  .replace(/<th:block\b[^>]*window-controls :: trafficLights[^>]*><\/th:block>/, '<div class="traffic-lights flex items-center"><button type="button" class="traffic-btn close" aria-label="关闭"></button><button type="button" class="traffic-btn minimize" aria-label="最小化"></button><button type="button" class="traffic-btn maximize" aria-label="最大化"></button></div>')
  .replace(/\s+th:[\w:-]+="[^"]*"/g, '')
  .replace(/<\/?th:block\b[^>]*>/g, '')
  .replace(/<a class="shop-nav-link" data-shop-browse([^>]*?)>/, '<a class="shop-nav-link" href="/shop/products?view=all" data-shop-browse$1>')
  .replace('href="/shop/cart"', `href="/shop/cart" ${scene === 'cart' ? 'aria-current="page"' : ''}`);
const documentHtml = (scene) => {
  const props = scene === 'checkout' ? ` contextid="${contextId}"` : scene === 'payments' ? ` ordercode="${orderCode}"` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commerce transaction fixture</title><link rel="stylesheet" href="/fixture/shell.css"><link rel="stylesheet" href="/fixture/theme.css"><style>body{background:#e9edf2}#window-frame-root{position:relative;width:min(1180px,100%);height:min(860px,100%)}</style></head><body data-page-mode="browser-shop-${scene}" data-page-app="shop"><div class="window-layer fixed inset-x-0 bottom-0 top-[28px] md:top-0 z-10 pointer-events-none p-0 md:p-8 flex items-start md:items-center justify-center" style="display:flex"><div id="window-frame-root"><div class="macos-window shop-window flex flex-col pointer-events-auto relative md:absolute w-full h-full md:w-auto md:h-auto rounded-none md:rounded-[14px] overflow-hidden origin-center" style="width:100%;height:100%;left:0;top:0" data-window-surface data-window-variant="shop" data-window-metrics-key="shop" data-window-resizable="true" data-window-maximizable="true" data-window-width="1180"><div class="shop-window-content" data-window-scroll data-window-content-root><div id="pjax-container" data-window-content-variant="shop" class="shop-window-content"><div class="shop-app" data-app-root="shop" data-menu-open="false" data-shop-scene="${scene}" data-shop-site-title="本地演示" data-shop-chrome-title="${scene}"><script type="application/json" data-app-props="shop">{"version":1,"appId":"shop","data":{"scene":"${scene}"}}</script><div class="shop-app-shell">${sidebar(scene)}<button type="button" class="shop-menu-backdrop" aria-label="关闭商店导航"></button><main class="shop-main" aria-label="${scene}"><div class="shop-main-header"><button type="button" class="shop-ui-btn shop-mobile-menu" aria-label="打开商店导航" aria-expanded="false" aria-controls="shop-sidebar">☰</button></div><shop-page-${scene} csrftoken="${csrf}" authenticated="true"${props}></shop-page-${scene}></main></div></div></div></div></div></div></div><script type="module" src="${compiledShopUrl}"></script></body></html>`;
};

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'fixture-data.json'), JSON.stringify({ cartItems, checkout, addresses, coupons: [], order, methods, payment }, null, 2));
const report = {
  kind: 'isolated-current-compiled-commerce-components', origin,
  limitations: ['Replicated current SSR shell; desktop window placement is fixed fixture geometry.', 'All business responses are local DTO fixtures, not live store acceptance.', 'Payments automatically POST initiate-payment on mount; every such request is intercepted locally.', 'No order-submit, checkout-prepare, payment callback, or payment action is clicked.', 'Synthetic payment SUCCESS invokes a gateway stub that rejects navigation; this does not verify the real UC document handoff.', 'The displayed payment image is a local non-payable SVG placeholder.'],
  sources: { upstreamCommit: '7a1fb04dd4796e412aa94fc9d19f94f45b80459b', bundleReadOnlySource: compiledShopUrl, build: manifest.__meta, bundleSha256: createHash('sha256').update(compiledShop).digest('hex'), themeCssSha256: createHash('sha256').update(themeCss).digest('hex') },
  data: { cartCount: 2, cartQuantity: 3, subtotal: 76, shipping: 8, payable: 84, address: 'synthetic local recipient', paymentProvider: 'PAYMENT_QRCODE' },
  results: [], failures: [],
};
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const caseName of ['cart-empty', 'cart-items', 'cart-inquiry-mixed', 'cart-inquiry-only', 'checkout', 'payments', 'payments-success', 'payments-success-leave'].filter((name) => !process.env.SHOP_TRANSACTION_CASE || name === process.env.SHOP_TRANSACTION_CASE)) {
      const scene = caseName.startsWith('cart') ? 'cart' : caseName.startsWith('payments') ? 'payments' : caseName;
      const scenarioCart = caseName === 'cart-empty' ? [] : structuredClone(cartItems);
      if (caseName.startsWith('cart-inquiry')) {
        scenarioCart[0].productVariant.pricingType = 'INQUIRY';
        if (caseName === 'cart-inquiry-only') scenarioCart.splice(1);
      }
      let paymentStatus = 'PENDING';
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'zh-CN', serviceWorkers: 'block' });
      const requests = [];
      const errors = [];
      const blocked = [];
      const result = { name: `${caseName}-${viewport.name}`, viewport, assertions: [], requests, errors, blocked, screenshots: [] };
      report.results.push(result);
      const check = (name, pass, details) => { result.assertions.push({ name, pass: Boolean(pass), ...(details ? { details } : {}) }); assert.ok(pass, `${result.name}: ${name}`); };
      await context.addInitScript(() => {
        window.__fixtureDocumentMarker = 'transaction-fixture-document';
        window.__fixtureGatewayCalls = [];
        window.pjax = { loadUrl(href) { window.__fixtureGatewayCalls.push(href); return Promise.resolve(false); } };
        window.__fixtureDefinitions = {};
        const originalDefine = CustomElementRegistry.prototype.define;
        CustomElementRegistry.prototype.define = function (name, constructor, options) {
          window.__fixtureDefinitions[name] = (window.__fixtureDefinitions[name] || 0) + 1;
          return originalDefine.call(this, name, constructor, options);
        };
        window.__fixtureSubmittedForms = [];
        document.addEventListener('submit', (event) => {
          event.preventDefault();
          window.__fixtureSubmittedForms.push(event.target.action);
        }, true);
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const entry = { method: request.method(), path: url.pathname + url.search, mode: 'fulfilled-local' };
        requests.push(entry);
        if (url.origin !== origin) { entry.mode = 'blocked-external'; blocked.push(entry); return route.abort(); }
        const respond = (body, contentType = 'application/json') => route.fulfill({ status: 200, contentType, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
        if (request.method() !== 'GET') {
          entry.mode = 'mock-write-local-only';
          entry.body = request.postDataJSON();
          if (scene === 'payments' && request.method() === 'POST' && url.pathname === `${api}/orders/${orderCode}/initiate-payment`) {
            entry.responseFixture = 'PaymentInitiateResponse';
            return respond(payment);
          }
          entry.mode = 'blocked-unexpected-write'; blocked.push(entry); return route.abort();
        }
        if (url.pathname === '/fixture/page') return respond(documentHtml(scene), 'text/html');
        if (url.pathname.startsWith(assetPrefix)) return respond(await readFile(assetPath(url.href)), url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        if (url.pathname === '/fixture/shell.css') return respond(shellCss, 'text/css');
        if (url.pathname === '/fixture/theme.css') return respond(themeCss, 'text/css');
        if (url.pathname === '/fixture/images/payment-placeholder.svg') return respond(qrPlaceholder, 'image/svg+xml');
        if (url.pathname === '/fixture/images/product-physical.png' || url.pathname === '/fixture/images/product-virtual.png') {
          return respond(await readFile(path.join(root, 'scripts/fixtures/images', path.basename(url.pathname))), 'image/png');
        }
        if (url.pathname === `${api}/cart-items`) return respond(scenarioCart);
        if (url.pathname === `${api}/checkout/${contextId}`) return respond(checkout);
        if (url.pathname === `${api}/user-addresses`) return respond(addresses);
        if (url.pathname === '/shop/coupons/mine') return respond([]);
        if (url.pathname === `${api}/orders/${orderCode}`) return respond(order);
        if (url.pathname === `${api}/orders/${orderCode}/payment-methods`) return respond(methods);
        if (url.pathname === `${api}/payment-sessions/${sessionCode}/status`) return respond(JSON.stringify(paymentStatus));
        if (url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/provinces') return respond([{ code: '990000', name: '演示省' }]);
        if (url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/provinces/990000/cities') return respond([{ code: '990100', name: '演示市' }]);
        if (url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/cities/990100/areas') return respond([{ code: '990101', name: '演示区' }]);
        entry.mode = 'blocked-unexpected-read'; blocked.push(entry); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${origin}/fixture/page`, { waitUntil: 'networkidle' });
        await page.waitForFunction((tag) => !!customElements.get(tag) && !!document.querySelector(`${tag} .shop-entry__title`), `shop-page-${scene}`);
        if (scene === 'cart' && caseName !== 'cart-empty') await page.locator('.shop-cart-item').first().waitFor();
        if (scene === 'checkout') await page.locator('#address-selector option').first().waitFor({ state: 'attached' });
        if (scene === 'payments') await page.locator('.shop-qrcode-image').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const mounted = await page.evaluate(({ scene, tags, csrf }) => {
          const tag = document.querySelector(`shop-page-${scene}`);
          const main = document.querySelector('.shop-main');
          const grid = document.querySelector(`.shop-${scene}`);
          const rect = (el) => { const value = el.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
          return {
            definitions: Object.fromEntries(tags.map((name) => [name, window.__fixtureDefinitions[name] || 0])),
            registered: tags.every((name) => !!customElements.get(name)),
            officialChildren: tag.children.length, heading: tag.querySelector('h1')?.textContent,
            csrfProp: tag.csrfToken === csrf, contextProp: tag.contextId, orderProp: tag.orderCode,
            main: rect(main), grid: rect(grid), columns: getComputedStyle(grid).gridTemplateColumns,
            mainScrollWidth: main.scrollWidth, mainClientWidth: main.clientWidth,
            docScrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            mountedItems: tag.querySelectorAll('.shop-cart-item,.shop-order-item').length,
            sidebarVisible: getComputedStyle(document.querySelector('.shop-sidebar')).visibility,
            submittedForms: window.__fixtureSubmittedForms,
          };
        }, { scene, tags, csrf });
        result.layout = mounted;
        check('official custom elements registered exactly once', mounted.registered && Object.values(mounted.definitions).every((count) => count === 1), mounted.definitions);
        check('current compiled Shop module requested once per document', requests.filter((entry) => new URL(entry.path, origin).pathname === compiledShopUrl).length === 1);
        check('official Svelte component mounted real children', mounted.officialChildren > 0 && !!mounted.heading);
        check('current transaction csrf attribute reaches official prop', mounted.csrfProp);
        check('no viewport horizontal overflow', mounted.docScrollWidth <= mounted.viewportWidth + 1);
        check('no transaction main horizontal overflow', mounted.mainScrollWidth <= mounted.mainClientWidth + 1);
        check('all official component images decode', await page.locator(`shop-page-${scene} img`).evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)));
        check(`${viewport.name} transaction grid columns`, mounted.columns.split(' ').length === (viewport.name === 'desktop' ? 2 : 1), mounted.columns);
        check(`${viewport.name} sidebar visibility`, mounted.sidebarVisible === (viewport.name === 'desktop' ? 'visible' : 'hidden'));
        if (caseName === 'cart-empty') {
          check('official empty cart state', await page.locator('shop-page-cart').getByText('购物车为空', { exact: true }).count() === 1);
          check('empty cart checkout is disabled', await page.getByRole('button', { name: '前往结算' }).isDisabled());
        } else if (caseName === 'cart-items') {
          check('both fixture cart items rendered', mounted.mountedItems === 2);
          check('cart amount rendered from quantities and variant prices', await page.locator('.shop-cart-summary__row--total').innerText().then((value) => value.includes('76.00')));
        } else if (caseName.startsWith('cart-inquiry')) {
          const mixed = caseName === 'cart-inquiry-mixed';
          check('inquiry price excluded from payable total', await page.locator('.shop-cart-summary__row--total span').last().innerText() === (mixed ? '¥18.00' : '¥0.00'));
          const fields = await page.locator('.shop-cart-summary form').evaluate((form) => Object.fromEntries(new FormData(form)));
          check('only eligible cart IDs and contiguous indices reach checkout', JSON.stringify(fields) === JSON.stringify(mixed
            ? { _csrf: csrf, source: 'CART', 'items[0].cartItemId': '2902', 'items[0].quantity': '1' }
            : { _csrf: csrf, source: 'CART' }), fields);
          check('checkout requires at least one eligible item', await page.getByRole('button', { name: '前往结算' }).isDisabled() === !mixed);
          const inquiryRow = page.locator('.shop-cart-item').first();
          check('inquiry row explains contact-sales path', await inquiryRow.getByText('询价商品', { exact: true }).count() === 1 && await inquiryRow.getByText('请联系客服询价下单', { exact: true }).count() === 1);
          check('inquiry row cannot change quantity or present a payable price', await inquiryRow.locator('.shop-quantity,.shop-cart-item__price,.shop-cart-item__total').count() === 0);
          check('inquiry item remains removable', await inquiryRow.getByRole('button', { name: '删除', exact: true }).isEnabled());
          check('cart explains excluded item', await page.getByText('1 件询价商品需联系客服下单，已从结算中排除', { exact: true }).count() === 1);
        } else if (scene === 'checkout') {
          check('accurate contextid reaches official prop', mounted.contextProp === contextId);
          check('shipping selector renders synthetic default address', await page.locator('#address-selector').inputValue() === '3901');
          check('checkout items and payable amount rendered', mounted.mountedItems === 2 && await page.locator('.shop-order-summary__row--total').innerText().then((value) => value.includes('84.00')));
          check('checkout form points to fixture context submit path', await page.locator('form.shop-checkout').getAttribute('action') === `/shop/checkout/${contextId}/submit`);
        } else {
          check('accurate ordercode reaches official prop', mounted.orderProp === orderCode);
          check('official payment methods and order items rendered', await page.locator('.shop-payment-method').count() === 2 && mounted.mountedItems === 2);
          const posts = requests.filter((entry) => entry.method === 'POST');
          check('automatic payment initialization intercepted locally', posts.length === 1 && posts[0].mode === 'mock-write-local-only' && posts[0].body.paymentMethodId === methods[0].id && posts[0].body.returnUrl === `${origin}/fixture/page`);
          check('local non-payable payment instructions rendered', await page.locator('.shop-qrcode-tip').innerText() === payment.payload.payload.paymentQrcode.instructions);
        }
        const screenshot = path.join(output, `fixture-${result.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        result.screenshots.push(path.relative(root, screenshot));
        if (viewport.name === 'mobile' && caseName !== 'cart-empty') {
          const lower = scene === 'payments' ? '.shop-payments__right' : scene === 'checkout' ? '.shop-checkout__actions' : '.shop-cart-summary';
          await page.locator(lower).scrollIntoViewIfNeeded();
          const lowerScreenshot = path.join(output, `fixture-${result.name}-lower.png`);
          await page.screenshot({ path: lowerScreenshot, fullPage: true });
          result.screenshots.push(path.relative(root, lowerScreenshot));
          await page.locator('.shop-main').evaluate((main) => { main.scrollTop = 0; });
        }
        if (scene === 'checkout') {
          await page.locator('#address-selector').selectOption('');
          await page.locator('#lastName').waitFor();
          await page.locator('#province option').waitFor({ state: 'attached' });
          check('official new shipping address fields render', await page.locator('[name="userAddress.lastName"]').count() === 1 && await page.locator('[name="userAddress.streetAddress"]').count() === 1);
          const formWidth = await page.evaluate(() => { const main = document.querySelector('.shop-main'); return [main.scrollWidth, main.clientWidth]; });
          check('new address form has no horizontal overflow', formWidth[0] <= formWidth[1] + 1, formWidth);
          const newAddressScreenshot = path.join(output, `fixture-checkout-new-address-${viewport.name}.png`);
          await page.screenshot({ path: newAddressScreenshot, fullPage: true });
          result.screenshots.push(path.relative(root, newAddressScreenshot));
        }
        if (caseName.startsWith('payments-success')) {
          paymentStatus = 'SUCCESS';
          await page.getByRole('status').filter({ hasText: '支付成功' }).waitFor();
          if (caseName === 'payments-success-leave') {
            await page.locator('shop-page-payments').evaluate((element) => element.remove());
            await page.waitForTimeout(1250); // Exceeds the component's real 1s success timer.
            check('SUCCESS disposal clears the scheduled order navigation', (await page.evaluate(() => window.__fixtureGatewayCalls)).length === 0);
          } else {
            await page.waitForFunction(() => window.__fixtureGatewayCalls.length > 0, null, { timeout: 2500 });
            check('SUCCESS uses the global guarded navigation gateway once', JSON.stringify(await page.evaluate(() => window.__fixtureGatewayCalls)) === JSON.stringify([`/uc/shop/orders/${orderCode}`]));
          }
          check('guard cancellation retains the original document', await page.evaluate(() => window.__fixtureDocumentMarker) === 'transaction-fixture-document' && page.url() === `${origin}/fixture/page`);
        }
        check('no order or payment form submitted', (await page.evaluate(() => window.__fixtureSubmittedForms)).length === 0);
        check('no unmocked or external browser request', blocked.length === 0, blocked);
        check('no browser exception', errors.length === 0, errors);
        console.log(`PASS ${result.name}: ${result.assertions.length} assertions; ${requests.filter((entry) => entry.method === 'POST').length} local mock POST`);
      } catch (error) {
        result.failure = error.message;
        report.failures.push(`${result.name}: ${error.message}`);
        await page.screenshot({ path: path.join(output, `fixture-${result.name}-failure.png`), fullPage: true }).catch(() => {});
        console.error(`FAIL ${result.name}: ${error.message}`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
report.passed = report.failures.length === 0;
report.assertionCount = report.results.reduce((count, result) => count + result.assertions.length, 0);
await writeFile(path.join(output, 'fixture-report.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(output, 'fixture-report.md'), `# Official commerce transaction fixture\n\nResult: ${report.passed ? 'PASS' : 'FAIL'}; ${report.results.length} cases, ${report.assertionCount} assertions.\n\n${report.limitations.map((line) => `- ${line}`).join('\n')}\n\n${report.results.map((result) => `- ${result.name}: ${result.failure || 'PASS'}; ${result.requests.filter((entry) => entry.method === 'POST').length} locally mocked POST`).join('\n')}\n\nFixture subtotal ¥76.00; shipping ¥8.00; payable ¥84.00. No live business API was requested.\n`);
assert.ok(report.passed, report.failures.join('\n'));
console.log(`Commerce transaction fixture passed: ${report.results.length} cases, ${report.assertionCount} assertions. Report: ${path.relative(root, path.join(output, 'fixture-report.json'))}`);
