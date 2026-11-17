import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { bundleCommerceFixture } from './fixtures/commerce-source-bundle.mjs';
import './verify-commerce-reconciliation.test.mjs';
import { chromium } from 'playwright';
import { parse, compile } from 'svelte/compiler';
import { withRequestDeadline } from '../src/shared/request-deadline.js';
import { buildShopBrowseUrl } from '../src/apps/shop/model.js';
import { checkout, addresses, contextId, csrf, api } from './fixtures/commerce-data.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
// An optional read-only source snapshot proves later-added cases detect the
// pre-fix defect without mutating the working tree or any existing WIP.
const baseline = process.env.COMMERCE_AUDIT_BASELINE
  ? JSON.parse(await readFile(process.env.COMMERCE_AUDIT_BASELINE, 'utf8')) : {};
const shopSource = baseline.runtime ?? await read('src/apps/shop/runtime.js');
const subscriptionSource = baseline.subscription ?? await read('src/apps/shop/commerce-ui/components/SubscriptionBuyBox.svelte');
const checkoutSource = baseline.checkout ?? await read('src/apps/shop/commerce-ui/pages/Checkout.svelte');
const shopAst = parse(`<script>${shopSource}</script>`);
const subscriptionAst = parse(subscriptionSource);
const checkoutAst = parse(checkoutSource);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) { const hit = find(child, predicate); if (hit) return hit; } }
    else { const hit = find(value, predicate); if (hit) return hit; }
  }
}
function code(source, ast, name) {
  const node = find(ast.instance.content, (item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  return node ? source.slice(node.start, node.end) : '';
}
function functions(source, ast, names, scope) {
  vm.createContext(scope);
  vm.runInContext(names.map((name) => code(source, ast, name)).join('\n'), scope);
  return scope;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Break caught: browse/its real click, search and select handlers drop the actual trigger.
test('COM-01 browse forwards link, form and select origins to the guarded gateway', async () => {
  const calls = [];
  const scope = functions(`<script>${shopSource}</script>`, shopAst, ['browse', 'releaseBrowse'], {
    window: { location: { href: 'https://theme.test/shop/products' }, pjax: { loadUrl: (...args) => calls.push(args) } },
    buildShopBrowseUrl,
    pendingBrowse: null, committedFilters: new Map(),
    app: { querySelector: () => null },
    controller: { signal: { aborted: false } },
  });
  for (const type of ['link', 'form', 'select']) {
    const trigger = { type };
    await scope.browse({ view: 'categories' }, trigger);
    assert.equal(calls.at(-1)[1]?.triggerElement, trigger);
  }
});

for (const type of ['click', 'submit', 'change']) {
  test(`COM-01 real ${type} handler retains the originating element`, () => {
    const calls = [];
    const link = { href: 'https://theme.test/shop/products?view=categories', target: '', dataset: { shopView: 'categories' }, hasAttribute: () => false };
    const form = {};
    const field = { name: 'view', value: 'categories' };
    const window = { location: { href: 'https://theme.test/shop/products', origin: 'https://theme.test' }, pjax: { loadUrl: (...args) => calls.push(args) } };
    const scope = functions(`<script>${shopSource}</script>`, shopAst, ['browse', 'releaseBrowse', 'canHandleClick'], {
      window, win: window, doc: { querySelector: () => null }, buildShopBrowseUrl, URL,
      pendingBrowse: null, committedFilters: new Map(), controller: { signal: { aborted: false } },
      app: { dataset: { shopScene: 'home' }, querySelector: () => null }, navigationHref: (href) => href,
      FormData: class { has(name) { return name === 'view'; } get() { return 'categories'; } },
    });
    const call = find(shopAst.instance.content, (item) => item.type === 'CallExpression' && item.callee?.object?.name === 'app'
      && item.callee?.property?.name === 'addEventListener' && item.arguments[0]?.value === type);
    const callback = call.arguments[1];
    vm.runInContext(`globalThis.handler = (${`<script>${shopSource}</script>`.slice(callback.start, callback.end)})`, scope);
    const trigger = type === 'click' ? link : type === 'submit' ? form : field;
    const event = { defaultPrevented: false, button: 0, preventDefault() { this.defaultPrevented = true; },
      target: { closest: (selector) => selector === 'button' || selector === 'a[href]' ? null : trigger } };
    scope.handler(event);
    assert.equal(calls[0]?.[0], 'https://theme.test/shop/products?view=categories');
    assert.equal(calls[0]?.[1]?.triggerElement, trigger);
    if (type === 'click') {
      scope.handler({ ...event, defaultPrevented: false, ctrlKey: true });
      assert.equal(calls.length, 1, 'modifier click retains native behavior');
    }
  });
}

function subscriptionHarness(fetch) {
  let active = true;
  const controller = new AbortController();
  const navigations = [];
  const scope = functions(subscriptionSource, subscriptionAst, ['navigate', 'handleAddToCart'], {
    submitting: false, error: null, cartOutcome: 'idle', selectedPlan: { id: 1 },
    cartLines: [{ productVariantId: 101, quantity: 2 }], csrfToken: 'fixture-csrf',
    currentUrl: '/shop/product/plan', fetch, URL, URLSearchParams, Error, TypeError,
    lifecycle: { signal: controller.signal, isActive: () => active },
    withRequestDeadline: (work, options) => withRequestDeadline(work, { ...options, timeoutMs: 20 }),
    $i18n: { t: (key) => key },
    window: { location: { href: 'https://theme.test/shop/product/plan' }, pjax: { loadUrl: async (href) => navigations.push(href) } },
  });
  return { scope, navigations, dispose: () => { active = false; controller.abort(); } };
}
function response(status, text = async () => '') { return { status, ok: status >= 200 && status < 300, text }; }

// Break caught: a pending transport/body never leaves submitting or replays the POST on timeout.
for (const phase of ['transport', 'body']) {
  test(`COM-02 subscription ${phase} deadline releases busy and requires cart reconciliation without POST replay`, async () => {
    let posts = 0;
    const harness = subscriptionHarness(async () => {
      posts++;
      if (phase === 'transport') return new Promise(() => {});
      return response(200, () => new Promise(() => {}));
    });
    const pending = harness.scope.handleAddToCart();
    await delay(60);
    assert.equal(harness.scope.submitting, false, 'deadline must release the waiting state');
    assert.equal(harness.scope.cartOutcome, 'unknown', 'a timed out write must not be reported as a definite failure');
    assert.equal(harness.scope.error, 'subscription.addCartResultUnknown');
    await harness.scope.handleAddToCart();
    assert.equal(posts, 1, 'unknown outcome blocks another mutation until the cart is checked');
    assert.deepEqual(harness.navigations, []);
    harness.dispose();
    await pending;
  });
}
test('COM-02 415 compatibility fallback consumes both bodies under the same deadline', async () => {
  const calls = [], bodies = [];
  const harness = subscriptionHarness(async (_url, options) => {
    calls.push(options);
    const status = calls.length === 1 ? 415 : 200;
    return response(status, async () => { bodies.push(status); return ''; });
  });
  await harness.scope.handleAddToCart();
  assert.equal(calls.length, 2);
  assert.deepEqual(bodies, [415, 200]);
  assert.equal(calls[0].signal, calls[1].signal);
  assert.notEqual(calls[0].signal, harness.scope.lifecycle.signal);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(harness.navigations, ['/shop/cart']);
});
test('COM-02 a late 415 after timeout does not send the compatibility POST', async () => {
  let posts = 0, resolveTransport;
  const harness = subscriptionHarness(() => { posts++; return new Promise((resolve) => { resolveTransport = resolve; }); });
  const pending = harness.scope.handleAddToCart();
  await delay(60);
  resolveTransport(response(415));
  await delay(0);
  assert.equal(posts, 1);
  assert.equal(harness.scope.cartOutcome, 'unknown');
  await pending;
});
test('COM-02 leaving during a subscription write suppresses errors and navigation', async () => {
  const harness = subscriptionHarness((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Disposed'), { name: 'AbortError' })), { once: true });
  }));
  const pending = harness.scope.handleAddToCart();
  harness.dispose();
  await pending;
  assert.equal(harness.scope.error, null);
  assert.deepEqual(harness.navigations, []);
});

function checkoutHarness() {
  const mutations = [];
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const makeMutation = (name) => ({ isPending: false, mutate: (value) => mutations.push([name, structuredClone(value)]), mutateAsync: async (value) => { mutations.push([name, structuredClone(value)]); await pending; } });
  const scope = functions(checkoutSource, checkoutAst, ['runCheckoutMutation', 'applyDiscount', 'handleDiscountCodeKeydown', 'removeDiscount', 'applyCoupons', 'toggleCoupon', 'handleCheckoutSubmit'], {
    checkoutActionPending: false, checkoutSubmitting: false,
    discountCodeInput: ' SAVE5 ', isAuthenticated: true, addressSelectionInitialized: true,
    selectedCouponIds: [9], availableCoupons: [{ id: 9 }], selectedHasNonCombinableCoupon: false,
    contextQuery: { isFetching: false, isSuccess: true, isError: false, data: { isShippingRequired: true } },
    addressQuery: { isFetching: false, isSuccess: true }, myCouponsQuery: { isFetching: false },
    lifecycle: { isActive: () => true, signal: new AbortController().signal },
    applyDiscountMutation: makeMutation('discount'), removeDiscountMutation: makeMutation('remove'), applyCouponsMutation: makeMutation('coupons'),
    couponError: '', toast: { info() {} }, get: (value) => value, i18n: { t: (key) => key },
  });
  const declaration = find(checkoutAst.instance.content, (item) => item.type === 'VariableDeclarator' && item.id?.name === 'checkoutBusy');
  const expression = declaration?.init?.arguments?.[0];
  // Use the real component's derived predicate, reevaluated as Svelte would.
  if (expression) vm.runInContext(`Object.defineProperty(globalThis, 'checkoutBusy', {get(){return (${checkoutSource.slice(expression.start, expression.end)});}})`, scope);
  else scope.checkoutBusy = false;
  return { scope, mutations, finish };
}
function keyEvent() { return { key: 'Enter', preventDefault() {} }; }
// Break caught: Enter/mutation functions bypass disabled buttons or release before the authoritative refresh.
test('COM-03 repeated Enter and other promotions cannot overlap the first pending mutation', async () => {
  const harness = checkoutHarness();
  harness.scope.handleDiscountCodeKeydown(keyEvent());
  harness.scope.handleDiscountCodeKeydown(keyEvent());
  harness.scope.removeDiscount();
  harness.scope.applyCoupons();
  assert.deepEqual(harness.mutations, [['discount', 'SAVE5']]);
  harness.finish();
  await delay(0);
  harness.scope.applyCoupons();
  await delay(0);
  assert.deepEqual(harness.mutations, [['discount', 'SAVE5'], ['coupons', [9]]]);
});
for (const phase of ['context', 'address', 'coupons', 'summary-error']) {
  test(`COM-03 ${phase} read state blocks all promotion entry points and final form submission`, () => {
    const { scope, mutations } = checkoutHarness();
    if (phase === 'context') scope.contextQuery.isFetching = true;
    if (phase === 'address') scope.addressQuery.isFetching = true;
    if (phase === 'coupons') scope.myCouponsQuery.isFetching = true;
    if (phase === 'summary-error') { scope.contextQuery.isError = true; scope.contextQuery.isSuccess = false; }
    scope.applyDiscount(); scope.removeDiscount(); scope.applyCoupons();
    assert.equal(mutations.length, 0);
    assert.equal(typeof scope.handleCheckoutSubmit, 'function');
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: { addEventListener() {} } };
    scope.handleCheckoutSubmit(event);
    assert.equal(event.defaultPrevented, true);
  });
}
test('COM-03 final submit closes the shared gate until the shop runtime releases navigation', () => {
  const { scope, mutations } = checkoutHarness();
  assert.equal(typeof scope.handleCheckoutSubmit, 'function');
  const form = new EventTarget();
  const button = { disabled: true };
  const runtime = functions(`<script>${shopSource}</script>`, shopAst, ['releaseSubmission'], {
    pendingSubmission: { form, buttons: [[button, false]] }, win: { Event },
  });
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: form };
  scope.handleCheckoutSubmit(event);
  assert.equal(event.defaultPrevented, false);
  scope.applyDiscount();
  assert.equal(mutations.length, 0);
  scope.handleCheckoutSubmit(event);
  assert.equal(event.defaultPrevented, true);
  runtime.releaseSubmission();
  assert.equal(scope.checkoutSubmitting, false);
  assert.equal(button.disabled, false);
});

// Break caught: Svelte commits submit-busy before the real ancestor serializer
// reads FormData, dropping a disabled named address selector from the POST.
test('COM-03 real Checkout and shop serializer retain the chosen address exactly once while submit is busy', async () => {
  const script = await bundleCommerceFixture(`
    import './src/apps/shop/commerce-ui/pages/Checkout.svelte';
    import { hydrateShop } from './src/apps/shop/runtime.js';
    window.__disposeShop = hydrateShop(document);
  `, { 'src/apps/shop/commerce-ui/pages/Checkout.svelte': checkoutSource });
  const origin = 'https://commerce-checkout.test';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(() => {
    window.__checkoutPayloads = [];
    window.pjax = { loadUrl(href, options) {
      const form = options.triggerElement;
      window.__checkoutPayloads.push({ href,
        fields: options.requestOptions.requestParams.map(({ name, value }) => [decodeURIComponent(name), decodeURIComponent(value)]),
        actualFormAddresses: new FormData(form).getAll('selectedAddressId'),
        addressDisabled: form.querySelector('#address-selector').disabled,
      });
      return new Promise((resolve) => { window.__releaseCheckoutNavigation = resolve; });
    } };
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${request.url()}`); return route.abort();
    }
    if (url.pathname === `/shop/checkout/${contextId}`) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div data-app-root="shop" data-shop-scene="checkout"><main class="shop-main"><shop-page-checkout contextid="${contextId}" csrftoken="${csrf}" authenticated="true" storefrontapi="true"></shop-page-checkout></main></div><script type="module" src="/fixture.js"></script></body></html>` });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    if (url.pathname === `/shop/checkout/${contextId}/context`) return route.fulfill({ json: checkout });
    if (url.pathname === `${api}/user-addresses`) return route.fulfill({ json: [...addresses, { ...addresses[0], id: 3902, isDefault: false, firstName: '第二地址' }] });
    if (url.pathname === '/shop/coupons/mine' || url.pathname === '/apis/api.ecommerce.halo.run/v1alpha1/provinces') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/fixture/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  try {
    await page.goto(`${origin}/shop/checkout/${contextId}`);
    await page.waitForFunction(() => document.querySelector('.shop-checkout')?.getAttribute('aria-busy') === 'false');
    await page.locator('#address-selector').selectOption('3902');
    await page.locator('[name="discountCode"]').fill('SAVE5');
    assert.deepEqual(await page.locator('.shop-checkout').evaluate((form) => new FormData(form).getAll('selectedAddressId')), ['3902']);
    await page.locator('.shop-checkout button[type="submit"]').click();
    await page.waitForFunction(() => window.__checkoutPayloads.length === 1);
    const submitted = await page.evaluate(() => window.__checkoutPayloads[0]);
    assert.equal(submitted.addressDisabled, true, 'submission retains the shared UI lock');
    assert.deepEqual(submitted.fields.filter(([name]) => name === 'selectedAddressId'), [['selectedAddressId', '3902']], 'real production requestParams must include one chosen saved address');
    assert.deepEqual(submitted.actualFormAddresses, ['3902']);
    assert.deepEqual(submitted.fields.filter(([name]) => name === 'saveAsNewAddress'), [['saveAsNewAddress', 'false']]);
    assert.deepEqual(submitted.fields.filter(([name]) => name === 'discountCode'), [['discountCode', 'SAVE5']], 'busy must preserve other named form values');
    await page.locator('.shop-checkout').evaluate((form) => form.requestSubmit());
    await page.locator('[name="discountCode"]').dispatchEvent('keydown', { key: 'Enter' });
    assert.equal(await page.evaluate(() => window.__checkoutPayloads.length), 1, 'busy state still blocks duplicate submit and promotion mutation');
    await page.evaluate(() => window.__releaseCheckoutNavigation(false));
    await page.waitForFunction(() => document.querySelector('.shop-checkout')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#address-selector').inputValue(), '3902');
    assert.equal(await page.locator('#address-selector').isEnabled(), true);
    assert.deepEqual(await page.locator('.shop-checkout').evaluate((form) => new FormData(form).getAll('selectedAddressId')), ['3902']);
    await page.locator('#address-selector').selectOption('');
    assert.deepEqual(await page.locator('.shop-checkout').evaluate((form) => ({
      addresses: new FormData(form).getAll('selectedAddressId'), saveAsNew: new FormData(form).get('saveAsNewAddress'),
    })), { addresses: [''], saveAsNew: 'true' }, 'selecting a new address clears the single submitted address value');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, [], 'all traffic is fulfilled locally; no order or payment is sent');
  } finally {
    await context.close();
    await browser.close();
  }
});

// Test-after coverage: the real mutation callback must retain its promise until
// the authoritative context read settles; removing await is the isolated mutation.
for (const name of ['applyDiscountMutation', 'removeDiscountMutation', 'applyCouponsMutation']) {
  test(`COM-03 ${name} keeps its success callback pending through authoritative readback`, async () => {
    const declaration = find(checkoutAst.instance.content, (item) => item.type === 'VariableDeclarator' && item.id?.name === name);
    const factory = declaration.init.arguments[0];
    const callbackSource = checkoutSource.slice(factory.start, factory.end);
    let releaseRead;
    const readback = new Promise((resolve) => { releaseRead = resolve; });
    const scope = { lifecycle: { isActive: () => true }, contextId: 'ctx-a', selectedCouponIds: [], couponError: '', discountCodeInput: 'SAVE5',
      queryClient: { setQueryData() {}, invalidateQueries: () => readback, getQueryState: () => ({ status: 'success' }) },
      toast: { success() {}, warning() {} }, get: (value) => value, i18n: { t: (key) => key } };
    functions(checkoutSource, checkoutAst, ['refreshCheckoutSummary'], scope);
    const options = vm.runInContext(`(${callbackSource})()`, scope);
    let settled = false;
    const pending = Promise.resolve(options.onSuccess({ calculateResult: { rejectedCoupons: [] } }, [9])).then(() => { settled = true; });
    await delay(0);
    assert.equal(settled, false, 'the mutation must not unlock checkout before readback');
    releaseRead();
    await pending;
    assert.equal(settled, true);
    const mutated = callbackSource.replace('await refreshCheckoutSummary()', 'refreshCheckoutSummary()');
    scope.queryClient.invalidateQueries = () => new Promise(() => {});
    const mutatedOptions = vm.runInContext(`(${mutated})()`, scope);
    let mutantSettled = false;
    Promise.resolve(mutatedOptions.onSuccess({ calculateResult: { rejectedCoupons: [] } }, [9])).then(() => { mutantSettled = true; });
    await delay(0);
    assert.equal(mutantSettled, true, 'the controlled missing-await mutation must unlock too early');
  });
}

// Break caught: ?width after existing query/hash corrupts image parameters or leaks a foreign origin into local handling.
test('COM-04 thumbnails preserve existing query and fragment while replacing width', async () => {
  const source = baseline.thumbnail ?? await read('src/apps/shop/commerce-ui/utils/thumbnail.js');
  const scope = { location: { origin: 'https://theme.test', href: 'https://theme.test/shop/cart' }, URL };
  vm.createContext(scope);
  vm.runInContext(source.replace('export function', 'function'), scope);
  for (const [input, expected] of [
    ['/upload/a.png?version=abc', '/upload/a.png?version=abc' + '&width=800'],
    ['/upload/a.png#preview', '/upload/a.png?width=800#preview'],
    ['/upload/a.png?width=99&version=abc#preview', '/upload/a.png?width=800&version=abc#preview'],
    ['https://theme.test/upload/a.png?version=abc#preview', 'https://theme.test/upload/a.png?version=abc' + '&width=800#preview'],
    ['https://theme.test.evil.test/a.png', '/apis/api.storage.halo.run/v1alpha1/thumbnails/-/via-uri?uri=https%3A%2F%2Ftheme.test.evil.test%2Fa.png&width=800'],
    ['http://[broken', '/apis/api.storage.halo.run/v1alpha1/thumbnails/-/via-uri?uri=http%3A%2F%2F%5Bbroken&width=800'],
  ]) assert.equal(scope.getThumbnailUrl(input, 'M'), expected);
  assert.equal(scope.getThumbnailUrl('/upload/a.png?version=abc#preview', 'UNKNOWN'), '/upload/a.png?version=abc#preview');
});
test('changed Svelte components compile directly from source without generated assets', () => {
  for (const [source, filename] of [[subscriptionSource, 'SubscriptionBuyBox.svelte'], [checkoutSource, 'Checkout.svelte']]) {
    const result = compile(source, { filename, generate: 'client', customElement: filename === 'Checkout.svelte' });
    assert.ok(result.js.code.length > 0);
    assert.deepEqual(result.warnings, []);
  }
});
