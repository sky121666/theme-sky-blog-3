import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('transaction SSR and components distinguish an explicit authenticated session', async () => {
  const template = await source('templates/modules/shop-app/transaction.html');
  for (const [file, tag] of [['Checkout', 'checkout'], ['Payments', 'payments']]) {
    const component = await source(`src/apps/shop/commerce-ui/pages/${file}.svelte`);
    assert.match(component, /authenticated:\s*\{[^}]*type:\s*'String'/, `${file} must not treat the string false as true`);
    assert.match(template, new RegExp(`<shop-page-${tag}[^>]*th:authenticated="\\$\\{authenticated\\}"`));
    assert.match(component, /storefrontApi:\s*\{[^}]*type:\s*'String'/, `${file} must distinguish capability from authentication`);
    assert.match(template, new RegExp(`<shop-page-${tag}[^>]*th:storefrontApi="\\$\\{storefrontApi\\}"`));
  }
});

test('guest checkout collects email without querying or saving account addresses and coupons', async () => {
  const component = await source('src/apps/shop/commerce-ui/pages/Checkout.svelte');
  assert.match(component, /type="email"[\s\S]*?name="email"[\s\S]*?required/);
  assert.match(component, /isAuthenticated && contextQuery.data\?\.isShippingRequired/);
  assert.match(component, /user-addresses[\s\S]*?enabled: isAuthenticated/);
  assert.match(component, /coupons\/mine[\s\S]*?enabled: isAuthenticated/);
});

test('transaction transport chooses the version capability independently of authentication', async () => {
  const { createTransactionApi } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  for (const { authenticated, storefrontApi } of [
    { authenticated: 'true', storefrontApi: 'true' },
    { authenticated: 'false', storefrontApi: 'true' },
    { authenticated: undefined, storefrontApi: 'true' },
    { authenticated: 'true', storefrontApi: undefined },
    { authenticated: 'true', storefrontApi: 'false' },
    { authenticated: 'false', storefrontApi: 'false' },
    { authenticated: 'false', storefrontApi: undefined },
    { authenticated: 'true', storefrontApi: true }
  ]) {
    const calls = [];
    const controller = new AbortController();
    const http = Object.fromEntries(['get', 'post'].map((method) => [method, (url, options) => {
      calls.push({ method, url, options });
      return { json: async () => ({ fixture: true }) };
    }]));
    const api = createTransactionApi({ authenticated, storefrontApi, contextId: 'ctx-1', orderCode: 'order-1', csrfToken: 'fixture-csrf', http });
    await api.context(controller.signal);
    await api.order(controller.signal);
    await api.paymentMethods(controller.signal);
    await api.initiate({ paymentMethodId: 9 }, controller.signal);
    await api.status('session-1', controller.signal);
    if (storefrontApi === 'true') {
      await api.sendAccessLink('buyer@example.test', controller.signal);
    } else {
      await assert.rejects(
        async () => api.sendAccessLink('buyer@example.test', controller.signal),
        /Order access recovery is unavailable/,
        'legacy or unknown capability must reject email recovery before sending a request'
      );
    }
    const uc = '/apis/uc.api.ecommerce.halo.run/v1alpha1';
    const expected = storefrontApi !== 'true'
      ? [`${uc}/checkout/ctx-1`, `${uc}/orders/order-1`, `${uc}/orders/order-1/payment-methods`, `${uc}/orders/order-1/initiate-payment`, `${uc}/payment-sessions/session-1/status`]
      : ['/shop/checkout/ctx-1/context', '/shop/order/order-1', '/shop/order/order-1/payment-methods', '/shop/order/order-1/initiate-payment', '/shop/order/order-1/payment-sessions/session-1/status'];
    assert.deepEqual(calls.map((call) => call.url), storefrontApi === 'true' ? [...expected, '/shop/order/order-1/access-link'] : expected);
    assert.equal(api.orderUrl, authenticated === 'true' ? '/uc/shop/orders/order-1' : '/shop/order/order-1');
    for (const call of calls) {
      assert.equal(call.options.signal, controller.signal, 'every request must be cancellable on disposal');
      assert.equal(call.options.headers.Accept, 'application/json');
      if (call.method === 'post') {
        assert.equal(call.options.headers['X-XSRF-TOKEN'], 'fixture-csrf');
        assert.equal(call.options.retry, 0, 'transaction writes must not auto retry');
      }
    }
    if (storefrontApi === 'true') assert.deepEqual(calls.at(-1).options.json, { email: 'buyer@example.test' });
  }
});


test('SSR rejects the unknown development version when enabling storefront API', async () => {
  const template = await source('templates/modules/shop-app/transaction.html');
  assert.match(template, /storefrontApi=\$\{#halo != null and !#strings.equals\(site.version,'0.0.0'\) and #halo.matchVersion\('>=2.27.0'\)\}/);
});

test('authenticated visitors retain the frontend order access path after a guest-order payment', async () => {
  const { createTransactionApi } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  const options = { authenticated: 'true', storefrontApi: 'true', orderCode: 'order-1' };
  for (const currentPath of ['/shop/order/order-1/payments', '/shop/order/order-1']) {
    assert.equal(createTransactionApi({ ...options, currentPath }).orderUrl, '/shop/order/order-1');
  }
  assert.equal(createTransactionApi({ ...options, currentPath: '/shop/payments/order-1' }).orderUrl, '/uc/shop/orders/order-1');
  assert.equal(createTransactionApi({ ...options, authenticated: 'false' }).orderUrl, '/shop/order/order-1');
});

test('phone H5 is selected only outside the WeChat webview; EasyPay stays QR', async () => {
  const { preferredPaymentResponse, paymentRedirectTarget } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  for (const mobile of ['Mozilla/5.0 iPhone', 'Mozilla/5.0 Android Mobile', 'Mozilla/5.0 iPad']) {
    assert.equal(preferredPaymentResponse('WECHAT_PAY', mobile), 'REDIRECT_URL');
    assert.equal(preferredPaymentResponse('WECHAT_PAY', `${mobile} MicroMessenger`), 'QRCODE_URL');
    assert.equal(preferredPaymentResponse('EASY_PAY', mobile), 'QRCODE_URL');
    assert.equal(paymentRedirectTarget(mobile), '_self');
  }
  assert.equal(preferredPaymentResponse('WECHAT_PAY', 'Mozilla/5.0 Macintosh'), 'QRCODE_URL');
  assert.equal(preferredPaymentResponse('ALIPAY', 'Mozilla/5.0 Macintosh'), 'REDIRECT_URL');
  assert.equal(paymentRedirectTarget('Mozilla/5.0 Macintosh'), '_blank');
});

test('order access errors give one recovery path and bounded polling stops on success or deadline', async () => {
  const { isOrderAccessLocked, paymentPollingInterval, PAYMENT_POLL_TIMEOUT_MS } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  for (const status of [401, 403, 404]) assert.equal(isOrderAccessLocked({ response: { status } }), true);
  for (const status of [400, 500, 503]) assert.equal(isOrderAccessLocked({ response: { status } }), false);
  assert.equal(paymentPollingInterval({ startedAt: 1000, now: 1000 + PAYMENT_POLL_TIMEOUT_MS - 1, status: 'PENDING' }), 2000);
  assert.equal(paymentPollingInterval({ startedAt: 1000, now: 1000 + PAYMENT_POLL_TIMEOUT_MS, status: 'PENDING' }), false);
  assert.equal(paymentPollingInterval({ startedAt: 1000, now: 2000, status: 'SUCCESS' }), false);
  assert.equal(paymentPollingInterval({ startedAt: 1000, now: 2000, active: false }), false);
});

// The pinned Paid OpenAPI 2.27 response enum distinguishes pending/authorized
// from failed, expired and cancelled sessions; those sessions cannot succeed.
for (const status of ['FAILED', 'EXPIRED', 'CANCELLED']) {
  test(`terminal ${status} payment session stops polling before the five-minute deadline`, async () => {
    const { paymentPollingInterval } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
    assert.equal(paymentPollingInterval({ startedAt: 1000, now: 2000, status }), false);
  });
}

test('only the official terminal session states stop polling; authorized remains pending settlement', async () => {
  const { isPaymentSessionTerminal, paymentPollingInterval } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  for (const status of ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED']) assert.equal(isPaymentSessionTerminal(status), true);
  for (const status of ['PENDING', 'AUTHORIZED', undefined]) {
    assert.equal(isPaymentSessionTerminal(status), false);
    assert.equal(paymentPollingInterval({ startedAt: 1000, now: 2000, status }), 2000);
  }
});

test('payment initialization maps the official reentry code without masking cancellation', async () => {
  const { paymentInitiateError } = await import('../src/apps/shop/commerce-ui/utils/transactions.js');
  const t = (key) => key;
  const reentry = await paymentInitiateError({ response: { json: async () => ({ code: 'WECHAT_PAY_REENTRY' }) } }, t);
  assert.equal(reentry.message, 'payments.wechatPayReentry');
  const detailed = await paymentInitiateError({ response: { json: async () => ({ detail: 'Unavailable fixture' }) } }, t);
  assert.equal(detailed.message, 'Unavailable fixture');
  const abort = new DOMException('Disposed', 'AbortError');
  assert.equal(await paymentInitiateError(abort, t), abort);
});


test('guest order SSR keeps access recovery, CSRF, fulfillment and native attachment downloads', async () => {
  const shell = await source('templates/shop/order.html');
  const detail = await source('templates/modules/shop-app/order-detail.html');
  assert.match(shell, /pageMode='browser-shop-order'/);
  assert.match(shell, /robots='noindex,nofollow'/);
  assert.match(detail, /th:if="\$\{locked\}"/);
  assert.match(detail, /th:unless="\$\{locked\}"/);
  assert.match(detail, /access-link/);
  assert.match(detail, /name="_csrf" th:value="\$\{_csrf.token\}"/);
  assert.match(detail, /th:if="\$\{canCancel\}"/);
  assert.match(detail, /th:each="fulfillment : \$\{fulfillments\}"/);
  assert.match(detail, /digital-resources[\s\S]*?download/);
  assert.equal(/<script[\s>]/.test(detail), false, 'SSR order must not install unmanaged page scripts');
});
