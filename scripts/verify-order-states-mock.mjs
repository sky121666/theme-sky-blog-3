import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';

// Offline SSR + browser acceptance. No route.continue(), fetch(), or Halo writes.
// Run: SHOP_TEMPLATE_JAVA_CLASSPATH='/path/to/runtime/*' SHOP_OFFICIAL_ORDER_TEMPLATE='/path/to/order.html' node scripts/verify-order-states-mock.mjs
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/functional-mock-20261026/orders');
await mkdir(output, { recursive: true });
const classpath = process.env.SHOP_TEMPLATE_JAVA_CLASSPATH;
const official = process.env.SHOP_OFFICIAL_ORDER_TEMPLATE;
assert.ok(classpath && official, 'Explicit runtime classpath and official template path are required');
const manifest = assertCurrentBuild(root);
const officialSchemaPath = path.join(root, 'output/halo-2.27-acceptance-20261023/official-openapi-2.27.json');
const schemaSource = await readFile(officialSchemaPath);
const schemas = JSON.parse(schemaSource).components.schemas;
const classes = path.join(output, 'classes');
await mkdir(classes, { recursive: true });
const javaOptions = { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 };
const compile = execFileSync('javac', ['-cp', classpath, '-d', classes,
  'scripts/fixtures/ShopOrderTemplateFixture.java', 'scripts/fixtures/ShopOrderStatesFixture.java'], javaOptions);
await writeFile(path.join(output, 'javac.log'), compile);
let ssrError;
try {
  const log = execFileSync('java', ['-cp', `${classes}${path.delimiter}${classpath}`, 'ShopOrderStatesFixture', root, official, output], javaOptions);
  await writeFile(path.join(output, 'ssr.log'), log);
} catch (error) {
  ssrError = error.message;
  await writeFile(path.join(output, 'ssr.log'), `${error.stdout || ''}\n${error.stderr || ''}`);
}
const fixtures = JSON.parse(await readFile(path.join(output, 'ssr-results.json'), 'utf8'));
function validate(value, schema, at) {
  if (value === null || value === undefined) return; // Optional presentation fields may be null.
  if (schema.$ref) return validate(value, schemas[schema.$ref.split('/').at(-1)], at);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${at}: official enum ${value}`);
  if (schema.type === 'object') {
    assert.equal(typeof value, 'object', `${at}: object`);
    for (const [key, field] of Object.entries(value)) {
      assert.ok(schema.properties[key], `${at}.${key}: official property exists`);
      validate(field, schema.properties[key], `${at}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${at}: array`);
    value.forEach((item, i) => validate(item, schema.items, `${at}[${i}]`));
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), `${at}: integer`);
  else if (schema.type === 'number') assert.equal(typeof value, 'number', `${at}: number`);
  else if (schema.type === 'string') assert.equal(typeof value, 'string', `${at}: string`);
}
for (const fixture of fixtures) {
  validate(fixture.model.order, schemas.OrderResponse, `${fixture.name}.order`);
  fixture.model.fulfillments?.forEach((entry, i) => validate(entry, schemas.FulfillmentUcResponse, `${fixture.name}.fulfillments[${i}]`));
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  generatedAt: new Date().toISOString(), build: manifest.__meta,
  scope: 'Offline 2.27 OpenAPI presentation DTO subsets + real Thymeleaf SSR + current compiled Shop CSS/JS in Chromium',
  fixtureCount: fixtures.length, ssrError: ssrError || null,
  sources: {
    officialTemplate: official, officialTemplateSha256: sha256(await readFile(official)),
    officialOpenApi: path.relative(root, officialSchemaPath), officialOpenApiSha256: sha256(schemaSource),
    orderTemplateSha256: sha256(await readFile(path.join(root, 'templates/modules/shop-app/order-detail.html'))),
    compiledShopCssSha256: sha256(await readFile(path.join(root, 'templates/assets/css/apps/shop/index.css'))),
  },
  boundaries: [
    'All requests are locally fulfilled or aborted, including cancel/recovery POST; no backend order, refund, delivery or email is created.',
    'The supplied application.jar predates 2.27 and lacks permalink/subscriptionMetadata. Typed synthetic presentation subsets are checked against official 2.27 OpenAPI; this does not prove live Halo DTO binding.',
    'Real order-detail fragment is placed in a controlled Shop shell with native main/sidebar geometry. Full Halo shell, authentication, CSRF enforcement, capability computation and PJAX navigation are outside this fixture.',
    'Theme displays PARTIAL/FULL refund states and links authenticated users to /uc/shop/orders/{orderCode}; refund requests/approval/rejection and subscription management belong to official UC and are not fabricated here.',
    'Subscription metadata produces the official subscription badge; plan changes, renewal, detailed subscription history and shipping backend status changes are not exercised.',
  ],
  results: [],
};
// Chromium's native download request can bypass Playwright route interception.
// Keep that fallback on loopback and serve only the exact mock attachment route.
const downloadRequests = [];
const downloadServer = createServer((request, response) => {
  downloadRequests.push({ method: request.method, path: request.url });
  if (request.method === 'GET' && request.url === '/shop/order/fixture-order-227/digital-resources/resource-public-id/download') {
    response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="mock-resource.txt"' });
    response.end('MOCK DOWNLOAD CONTENT');
  } else { response.writeHead(410); response.end('Unexpected local fallback request'); }
});
await new Promise(resolve => downloadServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${downloadServer.address().port}`;
report.nativeDownloadRequests = downloadRequests;
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const image = await readFile(path.join(root, 'scripts/fixtures/images/product-virtual.png'));
const expectedPayment = { PENDING: '待支付', AUTHORIZING: '支付确认中', PAID: '已支付', REFUNDED: '已退款', FAILED: '支付失败', EXPIRED: '支付已过期' };
const expectedFulfillment = { PENDING: '待履约', READY: '待处理', PROCESSING: '履约中', SHIPPED: '已发货', COMPLETED: '已完成', FAILED: '履约失败', CANCELLED: '已取消' };
const browser = await chromium.launch({ headless: true });
for (const fixture of fixtures) {
  if (!fixture.passed) { report.results.push({ name: fixture.name, passed: false, error: fixture.error, phase: 'SSR' }); continue; }
  const fragment = await readFile(path.join(output, fixture.renderedFile), 'utf8');
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 1000;
    const name = `${fixture.name}-${width}`;
    const result = { name, width, height, assertions: [], errors: [], consoleErrors: [], blocked: [], requests: [], layout: null, passed: false };
    report.results.push(result);
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', serviceWorkers: 'block', acceptDownloads: true });
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模拟订单验收 ${fixture.name}</title><link rel="stylesheet" href="${assetPrefix}css/shell-core/index.css">${manifest.shop.css.map(url => `<link rel="stylesheet" href="${url}">`).join('')}<style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,sans-serif}.fixture-sidebar-label{padding:28px 18px;color:var(--shop-muted);font-size:13px}</style></head><body class="shop-window"><div class="shop-app" data-app-root="shop" data-menu-open="false" data-shop-scene="order"><script type="application/json" data-app-props="shop">{"version":1,"appId":"shop","data":{"scene":"order"}}</script><div class="shop-app-shell"><aside class="shop-sidebar" aria-label="模拟商店侧栏"><div class="fixture-sidebar-label">商城 · 模拟验收</div></aside><main class="shop-main" aria-label="订单详情">${fragment}</main></div></div><script type="module" src="${manifest.shop.js[0]}"></script></body></html>`;
    await writeFile(path.join(output, `${name}.html`), html);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const entry = { method: request.method(), url: request.url() };
      if (request.method() !== 'GET') entry.body = request.postData();
      result.requests.push(entry);
      const respond = (body, contentType = 'text/html', headers) => route.fulfill({ status: 200, contentType, body, headers });
      if (url.origin === origin && request.method() === 'GET') {
        if (url.pathname === '/fixture/order') return respond(html);
        if (url.pathname.startsWith(assetPrefix)) {
          const file = path.resolve(root, 'templates/assets', url.pathname.slice(assetPrefix.length));
          assert.ok(file.startsWith(path.join(root, 'templates/assets') + path.sep));
          return respond(await readFile(file), file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        }
        if (url.pathname === '/upload/fixture.webp') return respond(image, 'image/png');
        if (url.pathname.endsWith('/digital-resources/resource-public-id/download')) return respond('MOCK DOWNLOAD CONTENT', 'text/plain', { 'Content-Disposition': 'attachment; filename="mock-resource.txt"' });
        if (/^\/(uc\/shop\/orders|shop\/order|shop\/product)\//.test(url.pathname)) return respond('<!doctype html><title>本地模拟目标</title><p data-fixture-destination>本地模拟目标</p>');
      }
      if (url.origin === origin && request.method() === 'POST' && /\/shop\/order\/fixture-order-227\/(cancel|access-link)$/.test(url.pathname)) return respond('<!doctype html><title>本地拦截 POST</title><p data-fixture-post>POST 已在本地模拟</p>');
      if (request.method() === 'GET' && ['https://tracking.example.test', 'https://resource.example.test'].includes(url.origin)) return respond('<!doctype html><title>本地外部链接模拟</title><p>本地模拟外部目标</p>');
      result.blocked.push(entry); return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    async function check(label, action) { await action(); result.assertions.push(label); }
    try {
      await page.goto(`${origin}/fixture/order`);
      await page.waitForFunction(() => window.__THEME_PAGE_APP_REGISTRY__?.appLifecycles?.shop);
      await page.evaluate(() => window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.hydrate(document.querySelector('[data-app-root="shop"]')));
      const { order, locked, authenticated, canPay, canCancel, fulfillments } = fixture.model;
      await check('server capability and locked-state action visibility', async () => {
        assert.equal(await page.locator('.shop-order-header__actions .shop-btn-primary').count(), !locked && canPay ? 1 : 0);
        assert.equal(await page.locator('.shop-order__cancel-btn').count(), !locked && canCancel ? 1 : 0);
        assert.equal(await page.locator('.shop-order-header__actions a[href^="/uc/shop/orders/"]').count(), !locked && authenticated ? 1 : 0);
        assert.equal(await page.locator('.shop-order__grid').count(), locked ? 0 : 1);
      });
      if (!locked) {
        await check('exact payment, order and refund badges', async () => {
          const expected = [expectedPayment[order.paymentStatus], order.status === 'CANCELLED' ? '已取消' : null,
            order.status === 'ARCHIVED' ? '已完成' : null, order.refundStatus === 'PARTIAL' ? '部分退款' : order.refundStatus === 'FULL' ? '已全额退款' : null].filter(Boolean);
          assert.deepEqual(await page.locator('.shop-order-header__badges .shop-order-badge').allTextContents(), expected);
        });
        await check('exact amounts, item count, address and fulfillment labels', async () => {
          assert.equal((await page.locator('.shop-order-header__amount-value').innerText()).trim(), `¥${order.payableAmount.toFixed(2)}`);
          assert.equal((await page.locator('.shop-order-summary__row--total span').last().innerText()).trim(), `¥${order.payableAmount.toFixed(2)}`);
          assert.equal(await page.locator('.shop-order-item').count(), order.items.length);
          assert.deepEqual((await page.locator('.shop-order-item__price').allTextContents()).map(t => t.trim()), order.items.map(i => `¥${i.subtotal.toFixed(2)}`));
          assert.equal(await page.locator('.shop-order-address__line').count(), order.shippingAddress ? 1 : 0);
          if (order.shippingAddress) assert.ok((await page.locator('.shop-order-address__line').innerText()).includes(order.shippingAddress.streetAddress));
          assert.deepEqual((await page.locator('.shop-order-fulfillment__head .shop-order-badge').allTextContents()).map(t => t.trim()), fulfillments.map(f => expectedFulfillment[f.status]));
        });
        await check('subscription metadata, text escaping and backend boundary', async () => {
          assert.equal(await page.locator('.shop-order-item .shop-product-card__badge').count(), order.items.filter(i => i.subscriptionMetadata).length);
          assert.equal(await page.locator('section.shop-order script').count(), 0);
          assert.equal(await page.getByRole('button', { name: /申请退款|确认收货|修改订阅/ }).count(), 0);
          assert.equal(await page.locator('form[action*="refund"]').count(), 0);
          assert.equal((await page.locator('.shop-order').innerHTML()).includes('private-attachment-id'), false);
        });
      }
      result.layout = await page.evaluate(() => {
        const main = document.querySelector('.shop-main');
        const bounds = main.getBoundingClientRect();
        const overflow = [...document.querySelectorAll('section.shop-order *')].filter(e => {
          const s = getComputedStyle(e), r = e.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && (r.right > bounds.right + 1 || r.left < bounds.left - 1);
        }).map(e => ({ tag: e.tagName, className: e.className, text: e.textContent.trim().slice(0, 120), left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right }));
        const clippedText = [...document.querySelectorAll('.shop-order-item__name,.shop-order-address__line,.shop-order-header__amount-value,.shop-order-item__price')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'hidden').map(e => ({ className: e.className, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
        return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, overflow, clippedText };
      });
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      if (['digital-delivery', 'long-content', 'physical-shipped'].includes(fixture.name)) {
        await page.locator('.shop-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.screenshot({ path: path.join(output, `${name}-bottom.png`), fullPage: true });
        await page.locator('.shop-main').evaluate(el => { el.scrollTop = 0; });
      }
      // Keep layout failures while continuing independent functional checks.
      result.layoutPassed = result.layout.documentWidth <= width + 1 && result.layout.mainScrollWidth <= result.layout.mainWidth + 1 && result.layout.overflow.length === 0 && result.layout.clippedText.length === 0;
      if (!locked && canCancel) await check('cancel confirmation dismissal prevents POST; acceptance is locally intercepted with CSRF', async () => {
        let message;
        page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
        await page.locator('.shop-order__cancel-btn').click();
        assert.equal(message, '确定取消这笔未支付的订单吗？');
        assert.equal(result.requests.filter(r => r.method === 'POST').length, 0);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.shop-order__cancel-btn').click();
        await page.waitForURL('**/cancel');
        const sent = result.requests.find(r => r.method === 'POST');
        assert.equal(new URLSearchParams(sent.body).get('_csrf'), fixture.model._csrf.token);
        await page.goto(`${origin}/fixture/order`);
      });
      if (!locked && canPay) await check('pay link navigates to the native order payment route', async () => {
        await page.locator('.shop-order-header__actions .shop-btn-primary').click();
        await page.waitForURL(`**/shop/order/${order.orderCode}/payments`);
        await page.goto(`${origin}/fixture/order`);
      });
      if (locked) await check('locked recovery enforces email, posts locally and exposes no digital secrets', async () => {
        assert.equal(await page.locator('.shop-order').innerText().then(t => t.includes('MOCK-SECRET')), false);
        assert.equal(await page.locator('.shop-order-locked__sent').count(), fixture.name === 'locked-sent' ? 1 : 0);
        await page.locator('.shop-order-locked__form button').click();
        assert.equal(result.requests.filter(r => r.method === 'POST').length, 0);
        await page.locator('input[name=email]').fill('fixture@example.test');
        await page.locator('.shop-order-locked__form button').click();
        await page.waitForURL('**/access-link');
        const sent = new URLSearchParams(result.requests.find(r => r.method === 'POST').body);
        assert.equal(sent.get('email'), 'fixture@example.test'); assert.equal(sent.get('_csrf'), fixture.model._csrf.token);
      });
      if (fixture.name === 'digital-delivery') await check('attachment download and external resource open natively', async () => {
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('a[download]').click()]);
        assert.equal(download.suggestedFilename(), 'mock-resource.txt');
        await download.saveAs(path.join(output, `${name}-download.txt`));
        assert.equal(await readFile(path.join(output, `${name}-download.txt`), 'utf8'), 'MOCK DOWNLOAD CONTENT');
        assert.equal(page.url(), `${origin}/fixture/order`);
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('a.shop-order-fulfillment__resource[target=_blank]').click()]);
        await popup.waitForLoadState();
        assert.equal(popup.url(), 'https://resource.example.test/mock-file?a=1&b=2');
        assert.equal(await popup.evaluate(() => window.opener === null), true); await popup.close();
        assert.deepEqual((await page.locator('.shop-order-fulfillment__cdk-code').allTextContents()).map(t => t.trim()), ['MOCK-CDK-NOT-REAL', 'MOCK-CODE-ONLY']);
      });
      if (fixture.name === 'physical-shipped') await check('tracking link opens native isolated popup, no-URL tracking remains text', async () => {
        assert.equal(await page.locator('span.shop-order-fulfillment__tracking').innerText(), 'NO-TRACKING-URL');
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('a.shop-order-fulfillment__tracking').click()]);
        await popup.waitForLoadState(); assert.equal(popup.url(), 'https://tracking.example.test/mock-shipment');
        assert.equal(await popup.evaluate(() => window.opener === null), true); await popup.close();
      });
      if (!locked && order.items.some(item => item.permalink)) await check('product permalink remains a working native link', async () => {
        const item = order.items.find(item => item.permalink);
        const link = page.locator('a.shop-order-item__name').first();
        assert.equal(await link.getAttribute('href'), item.permalink);
        await link.click();
        await page.waitForURL(`${origin}${item.permalink}`);
        await page.goto(`${origin}/fixture/order`);
      });
      if (!locked && authenticated) await check('official account order handoff is a usable native route', async () => {
        await page.locator('.shop-order-header__actions a[href^="/uc/shop/orders/"]').click();
        await page.waitForURL(`**/uc/shop/orders/${order.orderCode}`);
      });
      await check('zero runtime errors, console errors and unexpected requests', async () => {
        assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.blocked, []);
      });
      assert.equal(result.layoutPassed, true, `${name}: horizontal overflow or clipped text; see layout evidence`);
      result.assertions.push('zero horizontal overflow and zero hidden text clipping');
      result.passed = true;
    } catch (error) {
      result.error = error.stack;
      await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}${result.error ? `: ${result.error.split('\n')[0]}` : ''}`);
  }
}
await browser.close();
await new Promise(resolve => downloadServer.close(resolve));
assert.ok(downloadRequests.every(request => request.method === 'GET' && request.path === '/shop/order/fixture-order-227/digital-resources/resource-public-id/download'), 'Loopback fallback handles only mock native attachment downloads');
report.summary = {
  passed: report.results.filter(r => r.passed).length,
  failed: report.results.filter(r => !r.passed).length,
  ssrPassed: fixtures.filter(f => f.passed).length,
  functionalAssertionsPassed: report.results.reduce((sum, r) => sum + (r.assertions?.length || 0), 0),
  runtimeErrors: report.results.reduce((sum, r) => sum + (r.errors?.length || 0), 0),
  consoleErrors: report.results.reduce((sum, r) => sum + (r.consoleErrors?.length || 0), 0),
  unexpectedRequests: report.results.reduce((sum, r) => sum + (r.blocked?.length || 0), 0),
};
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
if (report.summary.failed || ssrError) process.exitCode = 1;
