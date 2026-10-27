import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';
import * as fixture from './fixtures/commerce-data.mjs';

// Official 2.27 DTO shapes, synthetic values. No request reaches a Halo server.
// Compiled components are mounted, interacted with, detached and mounted again.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const output = path.join(root, 'output/halo-2.27-compat');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const origin = fixture.origin;
const product = { ...fixture.products[1], id: 903, title: '隔离订阅服务', productType: 'SUBSCRIPTION', permalink: '/shop/product/fixture-subscription' };
const plans = [
  { id: 5901, productId: 903, variantId: 1903, name: '标准月付', tier: '标准', tierId: 1, billingMode: 'SUBSCRIPTION', billingPeriod: 'MONTHLY', periodCount: 1, price: 12, minQuantity: 1, maxQuantity: 3, trialEnabled: true, trialDays: 7, trialPrice: 0, variantStatus: 'PUBLISHED' },
  { id: 5902, productId: 903, variantId: 1904, name: '标准年付', tier: '标准', tierId: 1, billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY', periodCount: 1, price: 120, minQuantity: 1, maxQuantity: 3, variantStatus: 'PUBLISHED' },
];
const report = {
  source: 'shop-templates@2e03340ca650595b3f3d98a12c6b6be3cc764607 / Paid OpenAPI 2.27.0',
  build: manifest.__meta,
  limitations: ['Synthetic API responses only; not live Halo 2.27 acceptance.', 'All write requests are intercepted; no order, payment, email or address is created.'],
  results: [],
};
const browser = await chromium.launch({ headless: true });
const imageData = await readFile(path.join(root, 'scripts/fixtures/images/product-virtual.png'));

async function run(name, options, check) {
  const requests = [], errors = [], blocked = [];
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, locale: 'zh-CN', serviceWorkers: 'block', ...(options.userAgent ? { userAgent: options.userAgent } : {}) });
  const result = { name, requests, errors, blocked };
  report.results.push(result);
  await context.addInitScript(() => {
    window.__fixtureGatewayCalls = [];
    window.__fixtureGatewayRequests = [];
    window.pjax = { loadUrl(url, options) {
      window.__fixtureGatewayCalls.push(url);
      window.__fixtureGatewayRequests.push(options?.requestOptions);
      return Promise.resolve(false);
    } };
  });
  const tag = options.tag || 'shop-page-payments';
  const attributes = `csrftoken="${fixture.csrf}" authenticated="${options.authenticated === true}" storefrontapi="${options.storefrontApi !== false}" contextid="${fixture.contextId}" ordercode="${fixture.orderCode}" id="${options.productId || 903}"`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/themes/theme-sky-blog-3/assets/css/shell-core/index.css">${manifest.shop.css.map(url => `<link rel="stylesheet" href="${url}">`).join('')}<style>body{margin:0;padding:20px;box-sizing:border-box;background:var(--shop-bg);color:var(--shop-text)}main{max-width:1120px;margin:auto}*{box-sizing:border-box}</style></head><body class="shop-window"><main class="shop-app" data-app-root="shop" ${options.targetUrl ? `data-pjax-target-url="${options.targetUrl}"` : ''}><${tag} ${attributes}></${tag}></main><script type="module" src="${manifest.shop.js[0]}"></script></body></html>`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const entry = { method: request.method(), path: url.pathname, headers: { csrf: request.headers()['x-xsrf-token'] || request.headers()['x-csrf-token'], accept: request.headers().accept } };
    if (request.method() === 'POST') entry.body = request.postDataJSON();
    requests.push(entry);
    const respond = (data, status = 200, contentType = 'application/json') => route.fulfill({ status, contentType, body: typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data) });
    if (url.origin !== origin) { blocked.push(entry); return route.abort(); }
    if (request.method() === 'GET' && url.pathname === '/fixture/227') return respond(html, 200, 'text/html');
    if (request.method() === 'GET' && url.pathname.startsWith(assetPrefix)) {
      const local = path.resolve(root, 'templates/assets', url.pathname.slice(assetPrefix.length));
      assert.ok(local.startsWith(path.join(root, 'templates/assets') + path.sep));
      return respond(await readFile(local), 200, local.endsWith('.css') ? 'text/css' : 'text/javascript');
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/fixture/images/')) return respond(imageData, 200, 'image/png');
    // Scenario overrides are still fulfilled/aborted locally; there is no network fallback.
    if (options.route && await options.route({ request, entry, url, route, respond })) return;
    const api = fixture.api, orderPath = `${api}/orders/${fixture.orderCode}`, guestPath = `/shop/order/${fixture.orderCode}`;
    if (request.method() === 'GET') {
      if (url.pathname === `${api}/products/903`) return respond({ ...product, productVariants: [], specDefinition: [] });
      if (url.pathname === `${api}/products/902`) return respond({ ...fixture.products[1], productVariants: [{ ...fixture.variants[1], maxPerOrder: 2, ...options.variant }], specDefinition: [] });
      if (url.pathname === `${api}/ecommerceconfigs/shop`) return respond({ anonymousPurchaseEnabled: true });
      if (url.pathname.startsWith(`${api}/subscription-products/`)) {
        if (url.pathname.endsWith('/903')) return respond({ plans: options.plans || plans, singleSubscription: options.singleSubscription ?? true, subscriptions: options.subscriptions || [] });
        return respond({ plans: [], subscriptions: [] });
      }
      if (url.pathname === `${api}/checkout/${fixture.contextId}` || url.pathname === `/shop/checkout/${fixture.contextId}/context`) return respond({ ...fixture.checkout, isShippingRequired: options.shipping === true });
      if (url.pathname === `${api}/user-addresses`) return respond(fixture.addresses);
      if (url.pathname === '/shop/coupons/mine') return respond([]);
      if (url.pathname === orderPath || url.pathname === guestPath) return respond(options.locked ? { title: 'Unavailable' } : { ...fixture.order, ...options.order }, options.locked || 200);
      if (url.pathname === `${orderPath}/payment-methods` || url.pathname === `${guestPath}/payment-methods`) return respond(options.methods || fixture.methods);
      if (url.pathname.endsWith(`/payment-sessions/${fixture.sessionCode}/status`)) return respond(JSON.stringify(options.status || (options.success ? 'SUCCESS' : 'PENDING')));
      if (url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/provinces') return respond([{ code: '990000', name: '演示省' }]);
      if (url.pathname.endsWith('/provinces/990000/cities')) return respond([{ code: '990100', name: '演示市' }]);
      if (url.pathname.endsWith('/cities/990100/areas')) return respond([{ code: '990101', name: '演示区' }]);
    }
    if (request.method() === 'POST') {
      if (url.pathname === `${orderPath}/initiate-payment` || url.pathname === `${guestPath}/initiate-payment`) return respond(options.payment || fixture.payment);
      if (url.pathname === `${guestPath}/access-link`) return respond({});
      if (url.pathname === `${api}/cart-items` && options.addCart) return respond({}, 201);
    }
    blocked.push(entry); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (options.clock) await page.clock.install();
    await page.goto(`${origin}/fixture/227`);
    await page.waitForFunction(tag => document.querySelector(tag)?.children.length > 0, tag);
    await page.evaluate(() => window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.hydrate(document.querySelector('[data-app-root="shop"]')));
    await check({ page, requests, tag });
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${name}: browser errors`);
    assert.deepEqual(blocked, [], `${name}: unexpected network requests`);
    result.passed = true;
  } catch (error) {
    result.passed = false; result.error = error.stack;
    result.visibleText = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
    console.error(`${name}: ${error.message}`);
  }
  finally { await context.close(); }
}

try {
  await run('subscription-month-year', { tag: 'shop-buy-box', addCart: true, targetUrl: `${origin}/shop/product/fixture-subscription` }, async ({ page }) => {
    await page.getByText('标准月付', { exact: true }).first().waitFor();
    assert.equal(await page.locator('input[name="items[0].productVariantId"]').first().inputValue(), '1903');
    await page.getByRole('tab', { name: /按年|年付|年度/ }).first().click();
    await page.getByText('标准年付', { exact: true }).first().waitFor();
    assert.equal(await page.locator('input[name="items[0].productVariantId"]').first().inputValue(), '1904');
    const form = page.locator('form[action^="/shop/checkout/prepare"]').first();
    assert.equal(await form.locator('input[name="_csrf"]').inputValue(), fixture.csrf);
    assert.equal(new URL(await form.getAttribute('action'), origin).searchParams.get('redirect_uri'), `${origin}/shop/product/fixture-subscription`);
    await page.getByRole('button', { name: '加入购物车', exact: true }).click();
    await page.waitForFunction(() => window.__fixtureGatewayCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), ['/shop/cart']);
    assert.equal(new URL(page.url()).pathname, '/fixture/227');
  });
  await run('subscription-existing', { tag: 'shop-buy-box', subscriptions: [{ id: 6901, planId: 5901, status: 'ACTIVE', planName: '标准月付', paidThroughAt: '2026-12-01T00:00:00Z' }] }, async ({ page }) => {
    await page.locator('a[href*="/uc/shop/subscriptions/6901"]').first().waitFor();
    assert.equal(await page.locator('form[action^="/shop/checkout/prepare"]').count(), 0);
  });
  await run('purchase-limit', { tag: 'shop-buy-box', productId: 902 }, async ({ page }) => {
    const quantity = page.locator('.shop-quantity__input').first();
    await quantity.waitFor();
    await quantity.fill('99'); await quantity.blur();
    await page.waitForFunction(() => document.querySelector('.shop-quantity__input')?.value === '2');
    assert.equal(await quantity.getAttribute('max'), '2');
  });
  await run('purchase-out-of-stock', { tag: 'shop-buy-box', productId: 902, variant: { stock: 0 } }, async ({ page }) => {
    await page.locator('.buy-box__actions').waitFor();
    for (const button of await page.locator('.buy-box__actions button').all()) assert.equal(await button.isDisabled(), true);
    assert.equal(await page.locator('input[name="items[0].quantity"]').inputValue(), '0');
  });
  await run('subscription-quantity-plan-switch', {
    tag: 'shop-buy-box', plans: [plans[0], { ...plans[1], minQuantity: 4, maxQuantity: 5 }], addCart: true,
  }, async ({ page, requests }) => {
    const quantity = page.locator('.shop-quantity__input'); await quantity.waitFor();
    await quantity.fill('99'); await quantity.blur();
    assert.equal(await quantity.inputValue(), '3');
    await page.getByRole('tab', { name: /按年|年付|年度/ }).click();
    await page.waitForFunction(() => document.querySelector('.shop-quantity__input')?.value === '4');
    assert.equal(await page.locator('input[name="items[0].quantity"]').inputValue(), '4');
    await page.getByRole('button', { name: '加入购物车', exact: true }).click();
    await page.waitForFunction(() => window.__fixtureGatewayCalls.length === 1);
    assert.deepEqual(requests.find(r => r.path.endsWith('/cart-items')).body, { productVariantId: 1904, quantity: 4 });
  });
  for (const status of ['EXPIRED', 'CANCELLED']) {
    await run(`subscription-repurchase-${status.toLowerCase()}`, {
      tag: 'shop-buy-box', subscriptions: [{ id: 6901, planId: 5901, status }],
    }, async ({ page }) => {
      await page.locator('form[action^="/shop/checkout/prepare"]').waitFor();
      assert.equal(await page.locator('.shop-subscription__plan-trial').count(), 0, 'previous customers cannot receive the trial again');
      assert.equal(await page.locator('.shop-subscription__notice').count(), 1);
    });
  }
  await run('subscription-multiple', {
    tag: 'shop-buy-box', singleSubscription: false,
    subscriptions: [{ id: 6901, planId: 5901, status: 'ACTIVE' }, { id: 6902, planId: 5902, status: 'EXPIRED' }],
  }, async ({ page }) => {
    await page.locator('a[href="/uc/shop/subscriptions/6901"]').waitFor();
    assert.equal(await page.locator('a[href="/uc/shop/subscriptions/6902"]').count(), 1);
    assert.equal(await page.locator('form[action^="/shop/checkout/prepare"]').count(), 1);
    assert.equal(await page.locator('.shop-subscription__plan-trial').count(), 0);
  });
  await run('subscription-cart-auth-recovery', {
    tag: 'shop-buy-box', targetUrl: `${origin}/shop/product/fixture-subscription`,
    route: async ({ entry, respond }) => {
      if (entry.path.endsWith('/cart-items')) { await respond({ title: 'Login required' }, 401); return true; }
      return false;
    },
  }, async ({ page, requests }) => {
    const button = page.getByRole('button', { name: '加入购物车', exact: true }); await button.waitFor();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await button.click();
      await page.waitForFunction(count => window.__fixtureGatewayCalls.length === count, attempt);
      await page.waitForFunction(() => !document.querySelector('.shop-subscription__actions > button').disabled);
    }
    const urls = await page.evaluate(() => window.__fixtureGatewayCalls);
    assert.deepEqual(urls, Array(2).fill('/login?redirect_uri=%2Fshop%2Fproduct%2Ffixture-subscription'));
    assert.equal(requests.filter(r => r.path.endsWith('/cart-items')).length, 2, 'no automatic mutation retry');
  });
  for (const shipping of [false, true]) {
    await run(`guest-checkout-${shipping ? 'physical' : 'virtual'}`, { tag: 'shop-page-checkout', shipping, mobile: true }, async ({ page, requests }) => {
      const email = page.locator('input[type="email"]'); await email.waitFor();
      assert.equal(await email.getAttribute('required') !== null, true);
      assert.equal(await page.locator('input[name="saveAsNewAddress"]').count(), 0);
      assert.equal(requests.some(r => r.path.endsWith('/user-addresses') || r.path === '/shop/coupons/mine'), false);
      assert.equal(await page.locator('input[name="_csrf"]').inputValue(), fixture.csrf);
      assert.equal(await page.locator('[name="userAddress.streetAddress"]').count() > 0, shipping);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const form = page.locator('form[action$="/submit"]');
      await form.locator('button[type="submit"]').click();
      assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), [], 'invalid guest form must not reach navigation');
      await email.fill('fixture@example.test');
      if (shipping) {
        for (const [name, value] of Object.entries({ lastName: '演示', firstName: '买家', contactPhone: '10000000000', postalCode: '000000', streetAddress: '隔离 fixture 地址' })) {
          await page.locator(`[name="userAddress.${name}"]`).fill(value);
        }
        await page.locator('[name="userAddress.provinceCode"]').selectOption('990000');
        await page.locator('[name="userAddress.cityCode"] option[value="990100"]').waitFor({ state: 'attached' });
        await page.locator('[name="userAddress.cityCode"]').selectOption('990100');
        await page.locator('[name="userAddress.districtCode"] option[value="990101"]').waitFor({ state: 'attached' });
        await page.locator('[name="userAddress.districtCode"]').selectOption('990101');
      }
      assert.equal(await form.evaluate(form => form.checkValidity()), true);
      for (let attempt = 1; attempt <= 2; attempt++) {
        await form.locator('button[type="submit"]').click();
        await page.waitForFunction(count => window.__fixtureGatewayCalls.length === count, attempt);
        await page.waitForFunction(() => !document.querySelector('form[action$="/submit"] button[type="submit"]').disabled);
      }
      const submitted = await page.evaluate(() => Object.fromEntries(window.__fixtureGatewayRequests.at(-1).requestParams.map(({ name, value }) => [decodeURIComponent(name), decodeURIComponent(value)])));
      assert.equal(submitted.email, 'fixture@example.test');
      assert.equal(submitted._csrf, fixture.csrf);
      assert.equal('saveAsNewAddress' in submitted, false);
      assert.equal(new URL(page.url()).pathname, '/fixture/227');
    });
  }
  await run('signed-in-checkout-address-switch', {
    tag: 'shop-page-checkout', shipping: true, authenticated: true,
  }, async ({ page, requests }) => {
    const address = page.locator('[name="selectedAddressId"]'); await address.waitFor();
    await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3901');
    assert.equal(await page.locator('input[type="email"]').count(), 0);
    assert.equal(await page.locator('[name="saveAsNewAddress"]').inputValue(), 'false');
    assert.equal(await page.locator('[name="userAddress.streetAddress"]').count(), 0);
    assert.equal(requests.some(r => r.path.endsWith('/user-addresses')), true);
    assert.equal(requests.some(r => r.path === '/shop/coupons/mine'), true);
    await address.selectOption('');
    await page.locator('[name="userAddress.streetAddress"]').waitFor();
    assert.equal(await page.locator('[name="saveAsNewAddress"]').inputValue(), 'true');
    await address.selectOption('3901');
    await page.waitForFunction(() => !document.querySelector('[name="userAddress.streetAddress"]'));
    assert.equal(await page.locator('[name="saveAsNewAddress"]').inputValue(), 'false');
  });
  for (const locked of [401, 403, 404]) {
    await run(`legacy-order-access-${locked}`, { locked, authenticated: true, storefrontApi: false }, async ({ page, requests }) => {
      await page.waitForFunction(() => document.querySelector('shop-page-payments .shop-order-locked, shop-page-payments .shop-empty'));
      assert.equal(await page.locator('input[type="email"]').count(), 0, '2.26 must not offer the 2.27 email-access route');
      await page.getByText('加载订单信息失败，请刷新重试', { exact: true }).waitFor();
      const orderPath = `${fixture.api}/orders/${fixture.orderCode}`;
      const beforeRetry = requests.filter(r => r.method === 'GET' && r.path === orderPath).length;
      assert.equal(beforeRetry, 1, 'legacy errors originate from the UC order API');
      const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === orderPath && response.status() === locked);
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await retryResponse;
      assert.equal(requests.filter(r => r.method === 'GET' && r.path === orderPath).length, beforeRetry + 1, 'retry re-reads the legacy UC order');
      assert.equal(requests.some(r => r.method !== 'GET'), false, 'legacy recovery must not issue any transaction writes');
      assert.equal(requests.some(r => r.path.startsWith('/shop/order/')), false, 'legacy recovery must not call storefront order routes');
    });
    await run(`guest-order-access-${locked}`, { locked }, async ({ page, requests }) => {
      const email = page.locator('input[type="email"]'); await email.waitFor(); await email.fill('fixture@example.test');
      await page.getByRole('button', { name: /发送.*链接/ }).click();
      await page.getByRole('status').filter({ hasText: /邮件|邮箱|链接/ }).waitFor();
      const post = requests.find(r => r.path.endsWith('/access-link'));
      assert.deepEqual(post?.body, { email: 'fixture@example.test' }); assert.equal(post?.headers.csrf, fixture.csrf);
      assert.equal(requests.some(r => r.path.endsWith('/initiate-payment')), false);
    });
  }
  const mobileUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const wechatMethod = [{ id: 4903, name: '微信支付', provider: 'WECHAT_PAY' }];
  const wechatPayload = responseType => ({ ...fixture.payment, paymentProvider: 'WECHAT_PAY', payload: { success: true, responseType, payload: { wechatPay: responseType === 'REDIRECT_URL' ? { h5: { h5Url: `${origin}/fixture/provider` } } : { nativePay: { codeUrl: 'fixture-non-payable' } } } } });
  for (const scenario of [{ name: 'wechat-mobile', ua: mobileUa, type: 'REDIRECT_URL' }, { name: 'wechat-embedded', ua: mobileUa + ' MicroMessenger/8.0', type: 'QRCODE_URL' }, { name: 'wechat-desktop', type: 'QRCODE_URL' }]) {
    await run(scenario.name, { mobile: !!scenario.ua, userAgent: scenario.ua, methods: wechatMethod, payment: wechatPayload(scenario.type) }, async ({ page, requests }) => {
      await page.waitForFunction(type => type === 'REDIRECT_URL' ? !!document.querySelector('a[href$="/fixture/provider"]') : !!document.querySelector('.shop-qrcode-image'), scenario.type);
      const posts = requests.filter(r => r.path.endsWith('/initiate-payment'));
      assert.equal(posts.length, 1); assert.equal(posts[0].body.preferredResponseType, scenario.type); assert.equal(posts[0].headers.csrf, fixture.csrf);
      if (scenario.type === 'REDIRECT_URL') assert.equal(await page.locator('a[href$="/fixture/provider"]').getAttribute('target'), '_self');
    });
  }
  for (const mobile of [false, true]) {
    await run(`alipay-${mobile ? 'mobile' : 'desktop'}`, {
      mobile, userAgent: mobile ? mobileUa : undefined,
      methods: [{ id: 4904, name: '支付宝', provider: 'ALIPAY' }],
      payment: { ...fixture.payment, paymentProvider: 'ALIPAY', payload: { success: true, responseType: 'REDIRECT_URL', payload: { alipay: { redirectUrl: `${origin}/fixture/provider` } } } },
    }, async ({ page }) => {
      const link = page.locator('a[href$="/fixture/provider"]'); await link.waitFor();
      assert.equal(await link.getAttribute('target'), mobile ? '_self' : '_blank');
    });
  }
  await run('signed-in-guest-order-access', {
    authenticated: true, targetUrl: `${origin}/shop/order/${fixture.orderCode}/payments`,
  }, async ({ page, requests }) => {
    await page.locator('.shop-qrcode-image').waitFor();
    assert.equal(requests.some(r => r.path.startsWith(`${fixture.api}/orders/`)), false);
    assert.equal(requests.some(r => r.path === `/shop/order/${fixture.orderCode}`), true);
    assert.equal(await page.locator(`a[href="/shop/order/${fixture.orderCode}"]`).count(), 1);
    const post = requests.find(r => r.path.endsWith('/initiate-payment'));
    assert.equal(post.body.returnUrl, `${origin}/shop/order/${fixture.orderCode}/payments`);
  });
  await run('payment-initialize-retry', {
    methods: [fixture.methods[0]],
    route: async ({ entry, respond }) => {
      if (entry.path.endsWith('/initiate-payment')) {
        const count = report.results.at(-1).requests.filter(r => r.path.endsWith('/initiate-payment')).length;
        await respond(count === 1 ? { detail: '隔离支付暂时不可用' } : fixture.payment, count === 1 ? 503 : 200);
        return true;
      }
      return false;
    },
  }, async ({ page, requests }) => {
    await page.getByText('隔离支付暂时不可用', { exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 1, 'initialization writes must not retry automatically');
    const retry = page.getByRole('button', { name: /重试|重新.*支付/ });
    assert.equal(await retry.count(), 1, 'failed initialization needs an explicit retry without reloading the page');
    await retry.click();
    await page.locator('.shop-qrcode-image').waitFor();
    assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 2);
  });
  for (const status of ['FAILED', 'EXPIRED', 'CANCELLED']) {
    let initiations = 0;
    await run(`payment-session-${status.toLowerCase()}`, {
      clock: true, methods: [fixture.methods[0]],
      route: async ({ entry, respond }) => {
        if (entry.path.endsWith('/initiate-payment')) {
          initiations += 1;
          await respond(fixture.payment); return true;
        }
        if (entry.path.endsWith('/status')) {
          await respond(JSON.stringify(initiations === 1 ? status : 'PENDING')); return true;
        }
        return false;
      },
    }, async ({ page, requests }) => {
      await page.getByRole('status').filter({ hasText: /支付失败|支付已过期|支付已取消/ }).waitFor();
      const before = requests.filter(r => r.path.endsWith('/status')).length;
      assert.ok(before > 0);
      await page.clock.runFor(4500);
      assert.equal(requests.filter(r => r.path.endsWith('/status')).length, before, `${status} is terminal and must stop status polling`);
      assert.equal(await page.locator('.shop-qrcode-image').count(), 0, 'expired payment instructions must be hidden');
      assert.equal(await page.locator('form[action$="/callback"]').count(), 0, 'expired payment confirmation must be hidden');
      const retry = page.getByRole('button', { name: /重试|重新.*支付/ });
      assert.equal(await retry.count(), 1, 'terminal payment needs explicit recovery');
      await page.clock.fastForward(300_001);
      assert.equal(await page.getByRole('button', { name: '重新检测', exact: true }).count(), 0, 'terminal sessions must not expose poll-resume');
      await retry.click();
      await page.locator('.shop-qrcode-image').waitFor();
      await page.clock.runFor(100);
      assert.equal(initiations, 2, 'one user retry starts exactly one new initiation');
      assert.ok(requests.filter(r => r.path.endsWith('/status')).length > before, 'even a reused session code must discard the previous terminal cache');
      assert.equal(await page.locator('form[action$="/callback"]').count(), 1);
    });
  }
  // Halo cancels old sessions when an operator records payment separately.
  // The order is authoritative: a cancelled session must not invite a second payment.
  for (const status of ['CANCELLED', 'FAILED', 'EXPIRED']) {
    let orderReads = 0;
    await run(`payment-${status.toLowerCase()}-order-paid`, {
      clock: true, status,
      route: async ({ entry, respond }) => {
        if (entry.method === 'GET' && entry.path === `/shop/order/${fixture.orderCode}`) {
          orderReads += 1;
          await respond({ ...fixture.order, paymentStatus: orderReads === 1 ? 'PENDING' : 'PAID' });
          return true;
        }
        return false;
      },
    }, async ({ page, requests }) => {
      await page.getByRole('status').filter({ hasText: '支付成功' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '重试', exact: true }).count(), 0);
      assert.equal(await page.locator('.shop-qrcode-image').count(), 0);
      await page.clock.runFor(1500);
      assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), [`/shop/order/${fixture.orderCode}`]);
      await page.clock.runFor(4500);
      assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 1, 'paid order must not start another payment');
      assert.equal(orderReads, 2, 'reconcile once per terminal payment session');
      assert.equal(await page.evaluate(() => window.__fixtureGatewayCalls.length), 1, 'paid reconciliation navigates only once');
    });
  }
  for (const mobile of [false, true]) {
    for (const status of ['CANCELLED', 'FAILED', 'EXPIRED']) {
      for (const recoveredStatus of ['PAID', 'PENDING']) {
        let orderReads = 0;
        let recovering = false;
        let recovered = false;
        await run(`payment-${status.toLowerCase()}-order-read-recovery-${recoveredStatus.toLowerCase()}-${mobile ? 'mobile' : 'desktop'}`, {
          mobile, status,
          route: async ({ entry, respond }) => {
            if (entry.method === 'GET' && entry.path === `/shop/order/${fixture.orderCode}`) {
              orderReads += 1;
              if (orderReads === 1) await respond(fixture.order);
              else if (!recovering) await respond({ title: 'Order temporarily unavailable' }, 503);
              else {
                // Keep the recovery pending long enough to inspect its UI guard.
                await new Promise(resolve => setTimeout(resolve, 150));
                recovered = true;
                await respond({ ...fixture.order, paymentStatus: recoveredStatus });
              }
              return true;
            }
            return false;
          },
        }, async ({ page, requests }) => {
          const recheck = page.getByRole('button', { name: '重新查询订单状态', exact: true });
          await recheck.waitFor();
          const paymentWrites = () => requests.filter(r => r.path.endsWith('/initiate-payment')).length;
          assert.equal(paymentWrites(), 1, 'unknown order status must not create another payment');
          assert.equal(await page.getByRole('button', { name: '重试', exact: true }).count(), 0);
          for (const method of await page.locator('input[name="paymentMethod"]').all()) {
            assert.equal(await method.isDisabled(), true, 'switching methods cannot bypass the unknown order status');
          }
          // A repeated read failure must keep the same recovery path, not fall back to payment retry.
          const before = orderReads;
          const failedRead = page.waitForResponse(response => response.url().endsWith(`/shop/order/${fixture.orderCode}`) && response.status() === 503);
          await recheck.click();
          await failedRead;
          await recheck.waitFor({ state: 'visible' });
          assert.ok(orderReads > before);
          assert.equal(paymentWrites(), 1);
          recovering = true;
          await recheck.click();
          for (const method of await page.locator('input[name="paymentMethod"]').all()) {
            assert.equal(await method.isDisabled(), true, 'order recovery remains read-only while pending');
          }
          if (recoveredStatus === 'PAID') {
            await page.waitForFunction(() => window.__fixtureGatewayCalls.length === 1);
            assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), [`/shop/order/${fixture.orderCode}`]);
            assert.equal(paymentWrites(), 1, 'paid recovery must only navigate, never reinitialize');
          } else {
            const retry = page.getByRole('button', { name: '重试', exact: true });
            await retry.waitFor();
            assert.equal(paymentWrites(), 1, 'a confirmed unpaid order still requires explicit payment retry');
            const paymentResponse = page.waitForResponse(response => response.url().endsWith('/initiate-payment'));
            await retry.click();
            await paymentResponse;
            assert.equal(paymentWrites(), 2);
          }
          assert.equal(recovered, true);
        });
      }
    }
  }
  await run('payment-poll-timeout-resume', { clock: true }, async ({ page, requests }) => {
    await page.locator('.shop-qrcode-image').waitFor();
    await page.clock.runFor(100);
    assert.ok(requests.some(r => r.path.endsWith('/status')));
    await page.clock.fastForward(300_001);
    const resume = page.getByRole('button', { name: '重新检测', exact: true }); await resume.waitFor();
    const before = requests.filter(r => r.path.endsWith('/status')).length;
    await page.clock.runFor(10_000);
    assert.equal(requests.filter(r => r.path.endsWith('/status')).length, before);
    await resume.click();
    await page.clock.runFor(2100);
    assert.ok(requests.filter(r => r.path.endsWith('/status')).length > before, 'resume must restart status reads');
    assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 1, 'poll resume must not create another payment');
  });
  await run('payment-pending-leave-remount', { clock: true }, async ({ page, requests, tag }) => {
    await page.locator('.shop-qrcode-image').waitFor();
    await page.clock.runFor(100);
    await page.evaluate(tag => {
      const app = document.querySelector('[data-app-root="shop"]');
      window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.dispose(app);
      const old = document.querySelector(tag);
      window.__fixtureDetached = document.createElement(tag);
      for (const attr of old.attributes) window.__fixtureDetached.setAttribute(attr.name, attr.value);
      old.remove();
    }, tag);
    await page.clock.runFor(100);
    const before = requests.length;
    await page.clock.runFor(10_000);
    assert.equal(requests.length, before, 'detached payments must release pollers');
    await page.evaluate(() => {
      const app = document.querySelector('[data-app-root="shop"]');
      app.append(window.__fixtureDetached);
      window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.hydrate(app);
    });
    await page.locator('.shop-qrcode-image').waitFor();
    await page.clock.runFor(100);
    assert.equal(requests.filter(r => r.path === `/shop/order/${fixture.orderCode}`).length, 2);
    assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 2, 'remount initializes one fresh payment flow');
    for (let cycle = 0; cycle < 2; cycle++) {
      const polls = requests.filter(r => r.path.endsWith('/status')).length;
      // runFor dispatches browser timers, but Node's intercepted network events
      // may arrive after it resolves. Await the response we actually fulfill
      // before checking the route log, without advancing another poll period.
      const nextStatus = page.waitForResponse(response => response.url().endsWith('/status'));
      await page.clock.runFor(2100);
      await (await nextStatus).finished();
      assert.equal(requests.filter(r => r.path.endsWith('/status')).length, polls + 1, 'only the remounted component owns a poller');
    }
    assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), []);
  });
  await run('paid-order-no-payment-start', { order: { paymentStatus: 'PAID' } }, async ({ page, requests }) => {
    await page.getByRole('link', { name: '查看订单详情', exact: true }).waitFor();
    assert.equal(requests.some(r => /payment-methods|initiate-payment|\/status$/.test(r.path)), false);
  });
  await run('guest-success-leave', { success: true }, async ({ page, requests, tag }) => {
    await page.getByRole('status').filter({ hasText: '支付成功' }).waitFor();
    await page.locator(tag).evaluate(element => element.remove());
    await page.waitForTimeout(2200);
    assert.deepEqual(await page.evaluate(() => window.__fixtureGatewayCalls), []);
    const count = requests.length; await page.waitForTimeout(2100); assert.equal(requests.length, count);
  });
} finally {
  await browser.close();
  await writeFile(path.join(output, 'commerce-runtime.json'), JSON.stringify(report, null, 2));
}
assert.equal(report.results.filter(result => !result.passed).length, 0, 'See output/halo-2.27-compat/commerce-runtime.json');
console.log(`Halo 2.27 compiled commerce fixtures: ${report.results.length} passed (all network intercepted).`);
