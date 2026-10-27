import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';
import * as fixture from './fixtures/commerce-data.mjs';

// Reproducible, fully intercepted tests of the CURRENT compiled Shop components.
// No route continues to the network. The PJAX stand-in transports the production
// runtime's already-serialized form, then returns false to test draft/button recovery.
// It does not claim to test the shell's HTML error rendering or a real backend.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = assertCurrentBuild(root);
const addressRefetchOnly = process.env.COMMERCE_MOCK_ADDRESS_REFETCH === '1';
const runLabel = process.env.COMMERCE_MOCK_RUN_LABEL || '';
assert.ok(!runLabel || /^[a-zA-Z0-9-]+$/.test(runLabel), 'run label must be one safe directory name');
const outputRoot = path.resolve(root, process.env.COMMERCE_MOCK_OUTPUT || 'output/functional-mock-20261026/commerce');
assert.ok(outputRoot.startsWith(path.join(root, 'output') + path.sep), 'mock evidence must stay inside output/');
const caseFilter = process.env.COMMERCE_MOCK_FILTER ? new RegExp(process.env.COMMERCE_MOCK_FILTER) : null;
const output = path.join(outputRoot, ...(addressRefetchOnly ? ['address-refetch'] : []), ...(runLabel ? [runLabel] : []));
await mkdir(output, { recursive: true });
const officialPath = 'output/halo-2.27-acceptance-20261023/official-openapi-2.27.json';
const official = JSON.parse(await readFile(path.join(root, officialPath), 'utf8'));
const schemas = official.components.schemas;
const origin = fixture.origin;
const api = fixture.api;
const contextPath = `/shop/checkout/${fixture.contextId}/context`;
const submitPath = `/shop/checkout/${fixture.contextId}/submit`;
const discountPath = `/shop/checkout/${fixture.contextId}/discount`;
const couponPath = `${api}/checkout/${fixture.contextId}/coupons`;
const orderPath = `/shop/order/${fixture.orderCode}`;
const assets = '/themes/theme-sky-blog-3/assets/';
const imageData = await readFile(path.join(root, 'scripts/fixtures/images/product-physical.png'));
const clone = value => structuredClone(value);
const knownFields = (schema, value) => {
  for (const key of Object.keys(value)) assert.ok(key in schemas[schema].properties, `${schema}.${key} must exist in official 2.27 schema`);
  return value;
};
const businessAssertions = new Set(['checkout-context-address-preserved', 'discount-removal-error-feedback']);
function assertBusinessEqual(id, actual, expected, message) {
  assert.ok(businessAssertions.has(id), 'only named reviewed business assertions may classify a product issue');
  try { assert.equal(actual, expected, message); }
  catch (error) { if (error instanceof assert.AssertionError) error.businessAssertion = id; throw error; }
}
function classifyFailure(error) {
  return error instanceof assert.AssertionError && businessAssertions.has(error.businessAssertion) ? 'product-bug' : 'unlocated';
}
function auditConsoleErrors(errors, injectedFailures, observedFailures) {
  const counts = failures => failures.reduce((map, failure) => {
    const key = `${failure.url}\0${failure.status}`;
    map.set(key, (map.get(key) || 0) + 1); return map;
  }, new Map());
  const expected = counts(injectedFailures), observed = counts(observedFailures);
  return errors.map(error => {
    const match = error.text.match(/^Failed to load resource: the server responded with a status of (\d{3})(?: \([^)]*\))?$/);
    const status = match ? Number(match[1]) : null;
    const key = `${error.url}\0${status}`;
    const excluded = !!match && (expected.get(key) || 0) > 0 && (observed.get(key) || 0) > 0;
    if (excluded) { expected.set(key, expected.get(key) - 1); observed.set(key, observed.get(key) - 1); }
    return { ...error, status, expectedInjectedHttpFailure: excluded };
  });
}
// Negative controls for the gate: a familiar status at the wrong URL, a wrong
// status at the expected URL, a generic error, or an unobserved response stays red.
const gateFixture = { url: `${origin}/expected-failure`, status: 422 };
const gateResourceError = { text: 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)', url: gateFixture.url };
assert.equal(auditConsoleErrors([gateResourceError], [gateFixture], [gateFixture])[0].expectedInjectedHttpFailure, true);
for (const error of [
  { ...gateResourceError, url: `${origin}/other` },
  { ...gateResourceError, text: 'Failed to load resource: the server responded with a status of 400 (Bad Request)' },
  { ...gateResourceError, text: 'unexpected application error' },
]) assert.equal(auditConsoleErrors([error], [gateFixture], [gateFixture])[0].expectedInjectedHttpFailure, false);
assert.equal(auditConsoleErrors([gateResourceError], [gateFixture], [])[0].expectedInjectedHttpFailure, false);
assert.equal(auditConsoleErrors([gateResourceError, gateResourceError], [gateFixture], [gateFixture])[1].expectedInjectedHttpFailure, false);
assert.equal(classifyFailure(new Error('startup timeout')), 'unlocated');
assert.equal(classifyFailure(new assert.AssertionError({ message: 'unrelated assertion' })), 'unlocated');
const addressValues = {
  lastName: '模拟', firstName: '买家', contactPhone: '10000000000', postalCode: '000000',
  provinceCode: '990000', cityCode: '990100', districtCode: '990101', streetAddress: '模拟地址 & 二单元 + 601 室',
};
knownFields('UserAddressUpsertRequest', addressValues);
const secondAddress = { ...fixture.addresses[0], id: 3902, firstName: '第二收货人', isDefault: false, streetAddress: '模拟第二地址' };
const coupons = [
  { id: 7101, couponName: '可叠加甲券', status: 'AVAILABLE', calculationType: 'AMOUNT', discountValue: 3, combineWithCoupons: true, combineWithOrderDiscount: true },
  { id: 7102, couponName: '可叠加乙券', status: 'AVAILABLE', calculationType: 'AMOUNT', discountValue: 2, combineWithCoupons: true, combineWithOrderDiscount: true },
  { id: 7103, couponName: '独享券', status: 'AVAILABLE', calculationType: 'AMOUNT', discountValue: 6, combineWithCoupons: false, combineWithOrderDiscount: false },
  { id: 7104, couponName: '过期券不应出现', status: 'EXPIRED', calculationType: 'AMOUNT', discountValue: 99 },
];
coupons.forEach(value => knownFields('CustomerCouponResponse', value));
const subProduct = { ...fixture.products[1], id: 903, title: '模拟订阅服务', productType: 'SUBSCRIPTION', permalink: '/shop/product/mock-subscription' };
const subPlans = [
  { id: 5901, productId: 903, variantId: 1903, name: '月付计划最新名称', billingMode: 'SUBSCRIPTION', billingPeriod: 'MONTHLY', price: 12, minQuantity: 1, maxQuantity: 5, periodCount: 1, variantStatus: 'PUBLISHED' },
  { id: 5902, productId: 903, variantId: 1904, name: '年付计划最新名称', billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY', price: 120, minQuantity: 1, maxQuantity: 5, periodCount: 1, variantStatus: 'PUBLISHED' },
];
subPlans.forEach(value => knownFields('SubscriptionPlanResponse', value));

const report = {
  startedAt: new Date().toISOString(), build: manifest.__meta, officialSchema: { path: officialPath, version: official.info.version },
  boundaries: [
    'Synthetic official-shape data only; compiled current theme components and production form serializer run in Chromium.',
    'All HTTP requests are fulfilled or aborted by Playwright. No order/payment/address/coupon change reaches a live server.',
    'CheckoutContextResponse.source is BUY_NOW or CART. Renewal and plan changes are created by official UC endpoints before their returned orderCode enters this theme payment page.',
    'Subscription payment tests validate the stored planName/billingMode/billingPeriod projection and the official PaymentInitiateRequest fields; they do not certify official UC renewal calculation, entitlement updates, payment callbacks, or settlement.',
    'PJAX transport is a test stand-in: it sends production requestParams to a local intercepted response and returns false. Form serialization, duplicate suppression, draft preservation and button release are real theme behavior; shell/server error-page rendering is outside this test.',
    'Independent source review reports the same two behaviors in the pinned official Checkout implementation. These are issues currently carried/inherited by the theme, not regressions attributed to this adaptation.',
    'A non-default selectedAddressId is legal in CheckoutContextResponse and its display/submit mismatch is reproduced with a synthetic context. The real-backend user journey that creates that context has not been demonstrated.',
  ],
  officialBoundaryEvidence: {
    checkoutSources: schemas.CheckoutContextResponse.properties.source.enum,
    checkoutSubmitFields: Object.keys(schemas.CheckoutSubmitRequest.properties),
    paymentInitiateFields: Object.keys(schemas.PaymentInitiateRequest.properties),
    subscriptionMetadataFields: Object.keys(schemas.OrderItemSubscriptionMetadata.properties),
    renew: official.paths[`${api}/subscriptions/{id}/renew`].post.description,
    change: official.paths[`${api}/subscriptions/{id}/changes`].post.description,
  },
  assumptions: [
    'Harness correction before final run: the initial fixture lacked an explicit UTF-8 charset, causing a CSS middle-dot glyph to display as mojibake. The fixture now declares UTF-8; this was not a product bug.',
    'Screenshots wait for finite component transitions to finish; they show isolated component styling rather than the full desktop shell.',
    'A console resource error is excluded only when its full URL and parsed HTTP status match an intentionally injected response and an actually observed browser response, each consumed once. Every other console.error fails the scenario, even after a business assertion has failed.',
  ], results: [],
  gateSelfChecks: { exactUrlAndStatus: true, wrongUrlRejected: true, wrongStatusRejected: true, genericErrorRejected: true, missingObservedResponseRejected: true, duplicateConsoleErrorRejected: true, startupTimeoutUnlocated: true, unrelatedAssertionUnlocated: true },
};
const browser = await chromium.launch({ headless: true });

async function run(name, options, action) {
  if (caseFilter && !caseFilter.test(name)) return;
  const requests = [], pageErrors = [], unexpectedNetwork = [], consoleErrors = [], injectedHttpFailures = [], observedHttpFailures = [];
  const result = { name, viewport: options.width, requests, pageErrors, unexpectedNetwork, consoleErrors, injectedHttpFailures, observedHttpFailures, observations: [] };
  report.results.push(result);
  const state = { checkout: { ...clone(fixture.checkout), isShippingRequired: options.shipping ?? true, ...(options.checkout || {}) }, coupons: clone(coupons), submissions: 0 };
  knownFields('CheckoutContextResponse', state.checkout);
  const context = await browser.newContext({ viewport: { width: options.width, height: options.width === 390 ? 844 : 960 }, locale: 'zh-CN', serviceWorkers: 'block', ...(options.width === 390 ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } : {}) });
  await context.addInitScript(() => {
    window.__mockGateway = [];
    window.__mockGatewayResults = [];
    window.pjax = { async loadUrl(href, options) {
      const request = options?.requestOptions;
      window.__mockGateway.push({ href, request });
      if (request) {
        const body = new URLSearchParams((request.requestParams || []).map(({ name, value }) => [decodeURIComponent(name), decodeURIComponent(value)]));
        const response = await fetch(href, { method: request.requestMethod, body });
        window.__mockGatewayResults.push({ status: response.status, body: await response.text() });
      }
      return false;
    } };
  });
  const tag = options.tag || 'shop-page-checkout';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="${assets}css/shell-core/index.css">${manifest.shop.css.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--shop-bg);color:var(--shop-text)}main{max-width:1120px;margin:auto}</style></head><body class="shop-window"><main class="shop-app" data-app-root="shop"><${tag} csrftoken="${fixture.csrf}" authenticated="${options.authenticated === true}" storefrontapi="true" contextid="${fixture.contextId}" ordercode="${fixture.orderCode}" id="903"></${tag}></main><script type="module" src="${manifest.shop.js[0]}"></script></body></html>`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const entry = { method: request.method(), path: url.pathname, csrf: request.headers()['x-xsrf-token'] };
    if (!['GET', 'HEAD'].includes(entry.method)) {
      const text = request.postData() || '';
      try { entry.body = JSON.parse(text); } catch { entry.body = Object.fromEntries(new URLSearchParams(text)); }
    }
    requests.push(entry);
    const respond = (data, status = 200, contentType = 'application/json') => {
      if (status >= 400) injectedHttpFailures.push({ url: request.url(), status, method: request.method() });
      return route.fulfill({ status, contentType, body: typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data) });
    };
    if (url.origin !== origin) { unexpectedNetwork.push(entry); return route.abort(); }
    if (entry.method === 'GET' && url.pathname === '/fixture/functional') return respond(html, 200, 'text/html');
    if (entry.method === 'GET' && url.pathname.startsWith(assets)) {
      const local = path.resolve(root, 'templates/assets', url.pathname.slice(assets.length));
      assert.ok(local.startsWith(path.join(root, 'templates/assets') + path.sep));
      return respond(await readFile(local), 200, local.endsWith('.css') ? 'text/css' : local.endsWith('.woff2') ? 'font/woff2' : 'text/javascript');
    }
    if (entry.method === 'GET' && url.pathname.endsWith('/payment-placeholder.svg')) return respond(fixture.qrPlaceholder, 200, 'image/svg+xml');
    if (entry.method === 'GET' && url.pathname.startsWith('/fixture/images/')) return respond(imageData, 200, 'image/png');
    if (options.route && await options.route({ route, request, entry, url, respond, state, result })) return;
    if (entry.method === 'GET') {
      if (url.pathname === contextPath) return respond(state.checkout);
      if (url.pathname === `${api}/user-addresses`) return respond([fixture.addresses[0], secondAddress]);
      if (url.pathname === '/shop/coupons/mine') return respond(state.coupons);
      if (url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/provinces') return respond([{ code: '990000', name: '模拟甲省' }, { code: '980000', name: '模拟乙省' }]);
      if (url.pathname.endsWith('/provinces/990000/cities')) return respond([{ code: '990100', name: '模拟甲市' }]);
      if (url.pathname.endsWith('/provinces/980000/cities')) return respond([{ code: '980100', name: '模拟乙市' }]);
      if (url.pathname.endsWith('/cities/990100/areas')) return respond([{ code: '990101', name: '模拟甲区' }]);
      if (url.pathname.endsWith('/cities/980100/areas')) return respond([{ code: '980101', name: '模拟乙区' }]);
      if (url.pathname === `${api}/subscription-products/903`) return respond({ plans: subPlans, singleSubscription: true, subscriptions: [] });
      if (url.pathname === orderPath) return respond(options.order || fixture.order);
      if (url.pathname === `${orderPath}/payment-methods`) return respond(fixture.methods);
      if (url.pathname.endsWith(`/payment-sessions/${fixture.sessionCode}/status`)) return respond('"PENDING"');
    }
    if (entry.method === 'POST' && url.pathname === submitPath) {
      state.submissions++;
      return respond({ mock: true, attempt: state.submissions }, state.submissions === 1 ? 422 : 200);
    }
    if (entry.method === 'POST' && url.pathname === `${orderPath}/initiate-payment`) return respond(fixture.payment);
    unexpectedNetwork.push(entry); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), ...message.location() }); });
  page.on('response', response => { if (response.status() >= 400) observedHttpFailures.push({ url: response.url(), status: response.status(), method: response.request().method() }); });
  try {
    await page.goto(`${origin}/fixture/functional`);
    await page.waitForFunction(tag => document.querySelector(tag)?.children.length > 0, tag);
    await page.evaluate(() => window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.hydrate(document.querySelector('[data-app-root="shop"]')));
    await action({ page, context, requests, state, result });
    result.viewportFit = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(result.viewportFit.scrollWidth <= options.width + 1, 'no horizontal overflow');
    assert.deepEqual(pageErrors, [], 'no uncaught page errors');
    assert.deepEqual(unexpectedNetwork, [], 'no unexpected requests');
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.stack;
    result.classification = classifyFailure(error);
    if (error.businessAssertion) result.businessAssertion = error.businessAssertion;
    result.visibleText = await page.locator('body').innerText().catch(() => '');
    result.finalForm = await page.locator('form.shop-checkout').evaluate(form => Object.fromEntries(new FormData(form))).catch(() => null);
  } finally {
    result.screenshot = `${name}.png`;
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished'), null, { timeout: 2000 }).catch(() => {});
    await page.screenshot({ path: path.join(output, result.screenshot), fullPage: true, animations: 'disabled' }).catch(() => {});
    result.gatewayRequests = await page.evaluate(() => window.__mockGateway).catch(() => []);
    result.gatewayResponses = await page.evaluate(() => window.__mockGatewayResults).catch(() => []);
    await context.close();
    result.consoleAudit = auditConsoleErrors(consoleErrors, injectedHttpFailures, observedHttpFailures);
    result.unexpectedConsoleErrors = result.consoleAudit.filter(error => !error.expectedInjectedHttpFailure);
    const gateFailures = [];
    if (result.unexpectedConsoleErrors.length) gateFailures.push(`${result.unexpectedConsoleErrors.length} unexpected console error(s)`);
    if (pageErrors.length) gateFailures.push(`${pageErrors.length} uncaught page error(s)`);
    if (unexpectedNetwork.length) gateFailures.push(`${unexpectedNetwork.length} unexpected network request(s)`);
    if (gateFailures.length) {
      if (result.error) result.priorFailure = { classification: result.classification, businessAssertion: result.businessAssertion, error: result.error };
      result.passed = false;
      result.classification = 'unlocated';
      result.error = `Runtime gate failed: ${gateFailures.join('; ')}`;
    }
  }
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}${result.passed ? '' : `: ${result.error.split('\n')[0]}`}`);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}

async function formData(page) { return page.locator('form.shop-checkout').evaluate(form => Object.fromEntries(new FormData(form))); }
async function fillAddress(page) {
  for (const name of ['lastName', 'firstName', 'contactPhone', 'postalCode', 'streetAddress']) await page.locator(`[name="userAddress.${name}"]`).fill(addressValues[name]);
  await page.locator('[name="userAddress.provinceCode"]').selectOption(addressValues.provinceCode);
  await page.locator(`[name="userAddress.cityCode"] option[value="${addressValues.cityCode}"]`).waitFor({ state: 'attached' });
  await page.locator('[name="userAddress.cityCode"]').selectOption(addressValues.cityCode);
  await page.locator(`[name="userAddress.districtCode"] option[value="${addressValues.districtCode}"]`).waitFor({ state: 'attached' });
  await page.locator('[name="userAddress.districtCode"]').selectOption(addressValues.districtCode);
}
async function submitAndRecover(page, requests, result) {
  const before = await formData(page);
  const button = page.locator('form.shop-checkout button[type="submit"]');
  const count = requests.filter(r => r.path === submitPath).length;
  await button.click();
  await page.waitForFunction(count => window.__mockGatewayResults.length === count + 1, count);
  await page.waitForFunction(() => !document.querySelector('form.shop-checkout button[type="submit"]').disabled);
  const sent = requests.filter(r => r.path === submitPath).at(-1);
  assert.deepEqual(sent.body, before, 'production serialized request must exactly match current form values');
  assert.deepEqual(await formData(page), before, 'unsuccessful/cancelled PJAX navigation retains draft');
  result.observations.push({ submission: sent.body, responseStatus: (await page.evaluate(() => window.__mockGatewayResults.at(-1))).status });
  return sent.body;
}
const discountCard = page => page.locator('.shop-checkout-discount-card').filter({ has: page.locator('input[name="discountCode"]') });
const couponCard = page => page.locator('.shop-checkout-discount-card').filter({ has: page.getByRole('heading', { name: '优惠券', exact: true }) });
const couponCheck = (page, name) => page.locator('.shop-coupon-item').filter({ hasText: name }).locator('input');
const hasDiscountResult = (state, code) => { Object.assign(state.checkout.calculateResult, { discountAmount: 5, discountCode: code, discountName: '模拟折扣', totalDiscountAmount: 5, payableAmount: 79 }); };
const noDiscountResult = state => { Object.assign(state.checkout.calculateResult, { discountAmount: 0, discountCode: null, discountName: null, totalDiscountAmount: 0, payableAmount: 84 }); };

try {
  if (addressRefetchOnly) {
    report.boundaries.push('Follow-up probes test context invalidation and natural focus/reconnect triggers. No private QueryClient is injected or manually mounted; if address data does not refetch, no actual background-refetch conclusion is claimed.');
    for (const width of [1440, 390]) for (const choice of ['existing', 'new']) {
      await run(`address-${choice}-context-refresh-natural-events-${width}`, {
        width, authenticated: true,
        route: async ({ entry, respond, state }) => {
          if (entry.path === `${api}/user-addresses`) {
            state.addressReads = (state.addressReads || 0) + 1;
            await respond([{ ...fixture.addresses[0], streetAddress: state.addressReads > 1 ? '模拟后台已变更的默认地址' : fixture.addresses[0].streetAddress }, secondAddress]);
            return true;
          }
          if (entry.path === discountPath && entry.method === 'POST') {
            hasDiscountResult(state, entry.body.code); await respond(state.checkout); return true;
          }
          return false;
        },
      }, async ({ page, context, requests, state, result }) => {
        const selector = page.locator('[name="selectedAddressId"]');
        await selector.waitFor();
        await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3901');
        await selector.selectOption(choice === 'existing' ? '3902' : '');
        if (choice === 'new') await fillAddress(page);
        await page.locator('[name="customerNotes"]').fill('地址选择与草稿应保留');
        const before = await formData(page);
        const contextReadsBefore = requests.filter(request => request.path === contextPath).length;
        const input = discountCard(page).locator('input');
        await input.fill('SAVE5'); await input.press('Enter');
        await page.locator('.shop-order-summary__row--discount').filter({ hasText: 'SAVE5' }).waitFor();
        assert.ok(requests.filter(request => request.path === contextPath).length > contextReadsBefore, 'real context refetch must occur');
        const afterContext = await formData(page);
        assert.deepEqual(afterContext, before, 'context invalidation must preserve address choice and entered draft');
        result.observations.push({ phase: 'context-refetch', choice, before, after: afterContext, addressReads: state.addressReads, contextReads: requests.filter(request => request.path === contextPath).length });
        // Exercise normal event paths without gaining access to a private query client.
        const possibleAddressRequest = page.waitForRequest(request => new URL(request.url()).pathname === `${api}/user-addresses`, { timeout: 1500 }).then(() => true, () => false);
        await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
        await context.setOffline(true); await context.setOffline(false);
        const addressRefetched = await possibleAddressRequest;
        if (addressRefetched) await page.waitForLoadState('networkidle');
        const afterEvents = await formData(page);
        result.observations.push({ phase: 'natural-focus-reconnect', addressRefetched, addressReads: state.addressReads, before, after: afterEvents, interpretation: addressRefetched ? 'An actual address request occurred; form comparison covers the returned changed address list.' : 'No address request occurred in the bounded probe. This proves selection survived the events, not that it survives an actual address-list refetch.' });
        assert.deepEqual(afterEvents, before, 'focus/reconnect path must preserve the user selection and address draft');
      });
    }
  } else for (const width of [1440, 390]) {
    await run(`guest-physical-fields-recovery-${width}`, { width }, async ({ page, requests, result }) => {
      await page.locator('input[name="email"]').waitFor();
      await page.getByRole('button', { name: '去支付', exact: true }).click();
      assert.equal(requests.some(r => r.path === submitPath), false, 'required email/address prevents submit');
      await page.locator('input[name="email"]').fill('invalid-email');
      await fillAddress(page);
      assert.equal(await page.locator('form.shop-checkout').evaluate(form => form.checkValidity()), false, 'invalid email prevents submit');
      await page.locator('input[name="email"]').fill('mock.buyer+delivery@example.test');
      await page.locator('[name="customerNotes"]').fill('中文 & + = % 特殊字符备注');
      const data = await submitAndRecover(page, requests, result);
      for (const [name, value] of Object.entries(addressValues)) assert.equal(data[`userAddress.${name}`], value);
      assert.equal(data.email, 'mock.buyer+delivery@example.test');
      assert.equal(data._csrf, fixture.csrf);
      assert.equal(data['items[0].productVariantId'], '1901');
      assert.equal(data['items[0].quantity'], '2');
      assert.equal('saveAsNewAddress' in data, false);
      assert.equal('selectedAddressId' in data, false);
      await submitAndRecover(page, requests, result);
      assert.equal(requests.some(r => r.path === `${api}/user-addresses` || r.path === '/shop/coupons/mine'), false);
      await page.locator('[name="userAddress.provinceCode"]').selectOption('980000');
      await page.locator('[name="userAddress.cityCode"] option[value="980100"]').waitFor({ state: 'attached' });
      assert.notEqual((await formData(page))['userAddress.districtCode'], '990101', 'changing province removes previous district');
      await page.locator('[name="userAddress.cityCode"]').selectOption('980100');
      await page.locator('[name="userAddress.districtCode"] option[value="980101"]').waitFor({ state: 'attached' });
      await page.locator('[name="userAddress.districtCode"]').selectOption('980101');
      const changed = await submitAndRecover(page, requests, result);
      assert.equal(changed['userAddress.provinceCode'], '980000');
      assert.equal(changed['userAddress.cityCode'], '980100');
      assert.equal(changed['userAddress.districtCode'], '980101');
    });
    await run(`member-address-existing-new-existing-${width}`, { width, authenticated: true }, async ({ page, requests, result }) => {
      const selector = page.locator('[name="selectedAddressId"]'); await selector.waitFor();
      await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3901');
      assert.equal(await page.locator('input[name="email"]').count(), 0);
      let sent = await submitAndRecover(page, requests, result);
      assert.equal(sent.selectedAddressId, '3901'); assert.equal(sent.saveAsNewAddress, 'false');
      assert.equal(Object.keys(sent).some(name => name.startsWith('userAddress.')), false);
      await selector.selectOption('');
      await page.locator('[name="userAddress.streetAddress"]').waitFor();
      const beforeInvalid = requests.filter(r => r.path === submitPath).length;
      await page.getByRole('button', { name: '去支付', exact: true }).click();
      assert.equal(requests.filter(r => r.path === submitPath).length, beforeInvalid);
      await fillAddress(page);
      sent = await submitAndRecover(page, requests, result);
      assert.equal(sent.selectedAddressId, ''); assert.equal(sent.saveAsNewAddress, 'true');
      for (const [name, value] of Object.entries(addressValues)) assert.equal(sent[`userAddress.${name}`], value);
      await selector.selectOption('3902');
      sent = await submitAndRecover(page, requests, result);
      assert.equal(sent.selectedAddressId, '3902'); assert.equal(sent.saveAsNewAddress, 'false');
      assert.equal(Object.keys(sent).some(name => name.startsWith('userAddress.')), false, 'new-address fields cannot leak when switching to saved address');
    });
    await run(`checkout-selected-address-context-${width}`, { width, authenticated: true, checkout: { selectedAddressId: 3902 } }, async ({ page, requests, result }) => {
      await page.locator('[name="selectedAddressId"] option[value="3902"]').waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value);
      result.observations.push({ contextSelectedAddressId: 3902, defaultAddressId: 3901, renderedAddressId: await page.locator('[name="selectedAddressId"]').inputValue() });
      const sent = await submitAndRecover(page, requests, result);
      result.observations[0].submittedAddressId = sent.selectedAddressId;
      const renderedAddressId = await page.locator('[name="selectedAddressId"]').inputValue();
      assertBusinessEqual('checkout-context-address-preserved', renderedAddressId, '3902', 'explicit server checkout selectedAddressId must not be replaced by account default');
    });
    for (const first of ['context', 'addresses']) {
      const firstResponse = Promise.withResolvers();
      const releaseSecond = Promise.withResolvers();
      await run(`checkout-address-loading-${first}-first-${width}`, {
        width, authenticated: true, checkout: { selectedAddressId: 3902 },
        route: async ({ entry, respond, state, result }) => {
          const kind = entry.path === contextPath ? 'context' : entry.path === `${api}/user-addresses` ? 'addresses' : null;
          if (!kind) return false;
          if (kind !== first) await releaseSecond.promise;
          await respond(kind === 'context' ? state.checkout : [fixture.addresses[0], secondAddress]);
          result.observations.push({ loaded: kind });
          if (kind === first) firstResponse.resolve();
          return true;
        },
      }, async ({ page, requests, result }) => {
        await firstResponse.promise;
        assert.deepEqual(result.observations, [{ loaded: first }], 'second response remains held until the first completed');
        releaseSecond.resolve();
        await page.locator('[name="selectedAddressId"] option[value="3902"]').waitFor({ state: 'attached' });
        await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3902');
        const sent = await submitAndRecover(page, requests, result);
        assert.equal(sent.selectedAddressId, '3902', 'both response orders must submit the context-selected address');
      });
    }
    for (const [fallback, addresses, expected] of [
      ['default', [secondAddress, fixture.addresses[0]], '3901'],
      ['first', [{ ...secondAddress, isDefault: false }], '3902'],
      ['new', [], ''],
    ]) {
      await run(`checkout-address-invalid-fallback-${fallback}-${width}`, {
        width, authenticated: true, checkout: { selectedAddressId: 9999 },
        route: async ({ entry, respond }) => {
          if (entry.path !== `${api}/user-addresses`) return false;
          await respond(addresses); return true;
        },
      }, async ({ page, result }) => {
        await page.locator('[name="selectedAddressId"]').waitFor();
        await page.waitForFunction(expected => document.querySelector('[name="selectedAddressId"]')?.value === expected, expected);
        const data = await formData(page);
        assert.equal(data.selectedAddressId, expected);
        assert.equal(data.saveAsNewAddress, expected === '' ? 'true' : 'false');
        result.observations.push({ invalidContextAddressId: 9999, fallback, selectedAddressId: data.selectedAddressId });
      });
    }
    await run(`checkout-address-new-choice-refresh-context-switch-${width}`, {
      width, authenticated: true, checkout: { selectedAddressId: 3902 },
      route: async ({ entry, respond, state }) => {
        if (entry.path === discountPath && entry.method === 'POST') {
          hasDiscountResult(state, entry.body.code); await respond(state.checkout); return true;
        }
        if (entry.path === `/shop/checkout/${fixture.contextId}-next/context`) {
          await respond({ ...state.checkout, id: `${fixture.contextId}-next`, selectedAddressId: 3901 }); return true;
        }
        return false;
      },
    }, async ({ page, requests, result }) => {
      const selector = page.locator('[name="selectedAddressId"]');
      await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3902');
      await selector.selectOption('');
      await fillAddress(page);
      const draft = await formData(page);
      const contextReads = requests.filter(request => request.path === contextPath).length;
      const input = discountCard(page).locator('input');
      await input.fill('SAVE5'); await input.press('Enter');
      await page.locator('.shop-order-summary__row--discount').filter({ hasText: 'SAVE5' }).waitFor();
      assert.ok(requests.filter(request => request.path === contextPath).length > contextReads, 'context refresh really occurred');
      assert.deepEqual(await formData(page), draft, 'refresh must preserve explicit new-address choice and its draft');
      await page.locator('shop-page-checkout').evaluate((element, id) => element.setAttribute('contextid', id), `${fixture.contextId}-next`);
      await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3901');
      assert.equal((await formData(page)).selectedAddressId, '3901', 'new context initializes from its own saved address');
      assert.equal(await page.locator('[name="userAddress.streetAddress"]').count(), 0);
      await page.locator('shop-page-checkout').evaluate((element, id) => element.setAttribute('contextid', id), fixture.contextId);
      await page.waitForFunction(() => document.querySelector('[name="selectedAddressId"]')?.value === '3902');
      assert.equal((await formData(page)).selectedAddressId, '3902', 'returning to the original context initializes it afresh');
      result.observations.push({ newAddressDraftSurvivedRefresh: true, contextSwitchSelections: ['3901', '3902'] });
    });
    await run(`checkout-load-error-retry-${width}`, { width, shipping: false,
      route: async ({ entry, respond, state }) => {
        if (entry.path !== contextPath) return false;
        state.contextReads = (state.contextReads || 0) + 1;
        await respond(state.contextReads <= 4 ? { detail: '模拟结算读取失败' } : state.checkout, state.contextReads <= 4 ? 400 : 200);
        return true;
      },
    }, async ({ page, state, result }) => {
      await page.getByText('结算信息加载失败，请重试', { exact: true }).waitFor();
      assert.equal(await page.locator('form.shop-checkout').count(), 0);
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.locator('input[name="email"]').waitFor();
      result.observations.push({ contextReads: state.contextReads, recovered: true });
    });
    await run(`discount-enter-failure-apply-remove-${width}`, { width, shipping: false,
      route: async ({ entry, respond, state }) => {
        if (entry.path !== discountPath) return false;
        if (entry.method === 'POST') {
          if (entry.body.code === 'BAD') { await respond({ detail: '模拟无效折扣码' }, 422); return true; }
          hasDiscountResult(state, entry.body.code); await respond(state.checkout); return true;
        }
        if (entry.method === 'DELETE') { noDiscountResult(state); await respond(state.checkout); return true; }
        return false;
      },
    }, async ({ page, requests, result }) => {
      const card = discountCard(page), input = card.locator('input'); await input.waitFor();
      await input.fill('BAD'); await input.press('Enter');
      await page.getByText('折扣码无效或已过期', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), 'BAD', 'bad code remains editable');
      assert.equal(requests.some(r => r.path === submitPath), false, 'Enter on discount must not submit the order');
      await input.fill('  SAVE5  '); await input.press('Enter');
      await page.locator('.shop-order-summary__row--discount').filter({ hasText: 'SAVE5' }).waitFor();
      assert.equal(await input.inputValue(), '');
      assert.equal(requests.filter(r => r.path === discountPath && r.method === 'POST').length, 2);
      assert.deepEqual(requests.filter(r => r.path === discountPath).at(-1).body, { code: 'SAVE5' });
      assert.equal(requests.filter(r => r.path === discountPath).at(-1).csrf, fixture.csrf);
      await card.getByRole('button', { name: '移除', exact: true }).click();
      await page.locator('.shop-order-summary__row--discount').waitFor({ state: 'detached' });
      result.observations.push({ finalTotal: await page.locator('.shop-order-summary__row--total').innerText(), mutations: requests.filter(r => r.path === discountPath) });
    });
    await run(`discount-remove-error-feedback-${width}`, { width, shipping: false,
      checkout: { calculateResult: { ...fixture.checkout.calculateResult, discountAmount: 5, discountCode: 'SAVE5', discountName: '模拟折扣', payableAmount: 79 } },
      route: async ({ entry, respond, state }) => {
        if (entry.path === discountPath && entry.method === 'DELETE') {
          state.removeAttempts = (state.removeAttempts || 0) + 1;
          if (state.removeAttempts === 1) await respond({ detail: '模拟移除失败，请稍后重试' }, 422);
          else { noDiscountResult(state); await respond(state.checkout); }
          return true;
        }
        return false;
      },
    }, async ({ page, requests, result }) => {
      const card = discountCard(page), input = card.locator('input'); await card.getByRole('button', { name: '移除', exact: true }).waitFor();
      await input.fill('MY-NEXT-CODE');
      const response = page.waitForResponse(response => response.url().endsWith('/discount') && response.request().method() === 'DELETE');
      await card.getByRole('button', { name: '移除', exact: true }).click();
      await response;
      await page.waitForFunction(() => [...document.querySelectorAll('.shop-checkout-discount-card button')].some(button => button.textContent.trim() === '移除' && !button.disabled));
      assert.equal(requests.filter(r => r.path === discountPath && r.method === 'DELETE').length, 1);
      assert.match(await page.locator('.shop-order-summary__row--discount').innerText(), /SAVE5/);
      result.observations.push({ alerts: await page.locator('[role="alert"], [data-sonner-toast], .shop-checkout-discount-card__error').allTextContents(), retainedDiscount: await page.locator('.shop-order-summary__row--discount').innerText() });
      assertBusinessEqual('discount-removal-error-feedback', result.observations[0].alerts.some(text => /失败|重试|错误/.test(text)), true, 'removal failure must show an error/retry explanation');
      assert.equal(await input.inputValue(), 'MY-NEXT-CODE', 'failed removal retains the editable code draft');
      result.failureScreenshot = `discount-remove-error-feedback-${width}-failure.png`;
      await page.screenshot({ path: path.join(output, result.failureScreenshot), fullPage: true, animations: 'disabled' });
      await card.getByRole('button', { name: '移除', exact: true }).click();
      await page.locator('.shop-order-summary__row--discount').waitFor({ state: 'detached' });
      assert.equal(requests.filter(r => r.path === discountPath && r.method === 'DELETE').length, 2, 'only the explicit retry issues a second delete');
      assert.equal(await input.inputValue(), '', 'successful removal clears the code draft');
      result.observations.push({ retainedInputAfterFailure: 'MY-NEXT-CODE', explicitRetrySucceeded: true, finalTotal: await page.locator('.shop-order-summary__row--total').innerText() });
    });
    await run(`coupons-combination-partial-rejection-retry-${width}`, { width, shipping: false, authenticated: true,
      checkout: { calculateResult: { ...fixture.checkout.calculateResult, discountAmount: 5, discountCode: 'SAVE5', discountName: '模拟折扣', payableAmount: 79 } },
      route: async ({ entry, respond, state }) => {
        if (entry.path !== couponPath || entry.method !== 'PUT') return false;
        const ids = entry.body.customerCouponIds; knownFields('ApplyCouponsRequest', entry.body);
        if (!state.couponFirstFailed) { state.couponFirstFailed = true; await respond({ detail: '模拟优惠券临时验证失败' }, 422); return true; }
        const rejected = ids.includes(7103);
        Object.assign(state.checkout.calculateResult, {
          appliedCoupons: ids.filter(id => id !== 7103).map(id => ({ customerCouponId: id, couponName: coupons.find(c => c.id === id).couponName, discountAmount: id === 7101 ? 3 : 2 })),
          rejectedCoupons: rejected ? [{ customerCouponId: 7103, couponName: '独享券', reasonCode: 'DISCOUNT_NOT_COMBINABLE', reasonMessage: '模拟不可与当前折扣叠加' }] : [],
          couponDiscountAmount: ids.filter(id => id !== 7103).reduce((sum, id) => sum + (id === 7101 ? 3 : 2), 0),
        });
        state.checkout.calculateResult.payableAmount = 79 - state.checkout.calculateResult.couponDiscountAmount;
        await respond(state.checkout); return true;
      },
    }, async ({ page, requests, result }) => {
      const card = couponCard(page), apply = card.getByRole('button', { name: '应用', exact: true });
      await couponCheck(page, '可叠加甲券').waitFor();
      assert.equal(await page.getByText('过期券不应出现').count(), 0);
      await couponCheck(page, '可叠加甲券').check(); await couponCheck(page, '可叠加乙券').check();
      await couponCheck(page, '独享券').check();
      assert.equal(await couponCheck(page, '可叠加甲券').isChecked(), false);
      assert.equal(await couponCheck(page, '可叠加乙券').isChecked(), false);
      await card.getByText('该券不可与当前折扣叠加使用', { exact: true }).waitFor();
      await apply.click();
      await card.getByText('模拟优惠券临时验证失败', { exact: true }).waitFor();
      assert.equal(await couponCheck(page, '独享券').isChecked(), true, 'failed coupon application retains selection');
      await apply.click();
      await page.locator('.shop-coupon-item__error').getByText('模拟不可与当前折扣叠加', { exact: true }).waitFor();
      assert.equal(await couponCheck(page, '独享券').isChecked(), true, 'rejected coupon stays selected for explicit correction');
      await couponCheck(page, '可叠加甲券').check(); await couponCheck(page, '可叠加乙券').check();
      assert.equal(await couponCheck(page, '独享券').isChecked(), false);
      await apply.click();
      await page.locator('.shop-order-summary__row--discount').filter({ hasText: '可叠加乙券' }).waitFor();
      assert.equal(await page.locator('.shop-coupon-item__error').count(), 0);
      assert.equal(await apply.isDisabled(), true, 'applied selection no longer has pending changes');
      const mutations = requests.filter(r => r.path === couponPath);
      assert.deepEqual(mutations.map(r => r.body), [{ customerCouponIds: [7103] }, { customerCouponIds: [7103] }, { customerCouponIds: [7101, 7102] }]);
      assert.ok(mutations.every(r => r.csrf === fixture.csrf));
      result.observations.push({ mutations, finalTotal: await page.locator('.shop-order-summary__row--total').innerText() });
    });
    await run(`coupon-list-error-retry-${width}`, { width, shipping: false, authenticated: true,
      route: async ({ entry, respond, state }) => {
        if (entry.path !== '/shop/coupons/mine') return false;
        state.couponReads = (state.couponReads || 0) + 1;
        await respond(state.couponReads <= 4 ? { detail: '模拟优惠券读取失败' } : state.coupons, state.couponReads <= 4 ? 400 : 200);
        return true;
      },
    }, async ({ page, state, result }) => {
      const card = couponCard(page);
      await card.getByText('优惠券加载失败，请重试。', { exact: true }).waitFor();
      await card.getByRole('button', { name: '重试', exact: true }).click();
      await couponCheck(page, '可叠加甲券').waitFor();
      result.observations.push({ couponReads: state.couponReads, recovered: true });
    });
    await run(`subscription-purchase-checkout-${width}`, { width, shipping: false, authenticated: true,
      checkout: { source: 'BUY_NOW', items: [{ product: subProduct, productVariant: { ...fixture.variants[1], id: 1904, productId: 903 }, quantity: 2, price: 120 }], calculateResult: { ...fixture.checkout.calculateResult, originalTotalAmount: 240, saleTotalAmount: 240, shippingFeeAmount: 0, payableAmount: 240 } },
    }, async ({ page, requests, result }) => {
      await page.locator('.shop-subscription-line').filter({ hasText: '年付计划最新名称' }).waitFor();
      const sent = await submitAndRecover(page, requests, result);
      assert.equal(sent['items[0].productVariantId'], '1904'); assert.equal(sent['items[0].quantity'], '2');
      assert.equal(Object.keys(sent).some(key => /renew|planId|subscriptionId|changeId/i.test(key)), false, 'purchase checkout must not invent renewal or change DTO fields');
      result.observations.push({ displayedPlan: await page.locator('.shop-subscription-line').innerText() });
    });
    for (const type of ['RENEWAL', 'PLAN_CHANGE', 'QUANTITY_CHANGE']) {
      const metadata = knownFields('OrderItemSubscriptionMetadata', { type, planId: 5901, planName: `${type} 下单时计划快照`, billingMode: 'SUBSCRIPTION', billingPeriod: 'MONTHLY', changeId: 8801, feeType: 'FIXED_FEE', periodDelta: type === 'RENEWAL' ? 1 : 0, fromQuantity: 1, toQuantity: type === 'QUANTITY_CHANGE' ? 3 : 1 });
      const order = { ...fixture.order, subtotalAmount: 18, shippingAmount: 0, payableAmount: 18, totalAmount: 18, items: [{ ...fixture.order.items[1], productId: 903, productVariantId: 1903, itemTitle: '模拟订阅订单', subscriptionMetadata: metadata }] };
      await run(`subscription-${type.toLowerCase()}-payment-retry-${width}`, { width, tag: 'shop-page-payments', authenticated: true, order,
        route: async ({ entry, respond, state }) => {
          if (entry.path !== `${orderPath}/initiate-payment` || entry.method !== 'POST') return false;
          if (!state.paymentFailed) { state.paymentFailed = true; await respond({ detail: '模拟支付初始化失败，可重试' }, 422); return true; }
          await respond(fixture.payment); return true;
        },
      }, async ({ page, requests, result }) => {
        await page.getByRole('alert').getByText('模拟支付初始化失败，可重试', { exact: true }).waitFor();
        assert.equal(requests.filter(r => r.path.endsWith('/initiate-payment')).length, 1, 'no automatic payment POST replay');
        assert.match(await page.locator('.shop-subscription-line').innerText(), new RegExp(metadata.planName));
        assert.equal(requests.some(r => r.path === `${api}/subscription-products/903`), false, 'stored plan snapshot must not be replaced by current catalog plan');
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.locator('.shop-payment-qrcode, img[src*="payment-placeholder"]').first().waitFor();
        const mutations = requests.filter(r => r.path.endsWith('/initiate-payment'));
        assert.equal(mutations.length, 2);
        for (const mutation of mutations) {
          knownFields('PaymentInitiateRequest', mutation.body);
          assert.deepEqual(Object.keys(mutation.body).sort(), ['paymentMethodId', 'preferredResponseType', 'returnUrl']);
          assert.equal(mutation.body.paymentMethodId, 4901);
          assert.equal(mutation.body.preferredResponseType, 'REDIRECT_URL');
          assert.equal(mutation.body.returnUrl, `${origin}/fixture/functional`);
          assert.equal(mutation.csrf, fixture.csrf);
        }
        result.observations.push({ metadataInput: metadata, renderedLine: await page.locator('.shop-subscription-line').innerText(), mutations, projectionBoundary: 'The theme renders planName and billing period. It does not render type/changeId/periodDelta/fromQuantity/toQuantity; renewal/change execution and detailed change preview belong to official UC.' });
      });
    }
  }
} finally {
  await browser.close();
  assertCurrentBuild(root);
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.results.length, passed: report.results.filter(r => r.passed).length, failed: report.results.filter(r => !r.passed).length, pageErrors: report.results.flatMap(r => r.pageErrors).length, unexpectedNetwork: report.results.flatMap(r => r.unexpectedNetwork).length, expectedConsoleErrors: report.results.flatMap(r => r.consoleAudit || []).filter(error => error.expectedInjectedHttpFailure).length, unexpectedConsoleErrors: report.results.flatMap(r => r.unexpectedConsoleErrors || []).length };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  assert.ok(report.summary.total > 0, 'case filter must match at least one scenario');
  if (report.summary.failed) process.exitCode = 1;
}
