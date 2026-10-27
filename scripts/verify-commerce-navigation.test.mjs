import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createNavigationAdmission } from '../src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js';
import { createBrowserNavigationOwnership, isCurrentNavigationIntent, resolveNavigationHref } from '../src/shell/desktop-shell/runtime/desktop/pjax/navigation-guard.js';
import { resolveRoute, inferWindowVariantFromUrl } from '../src/shell-core/runtime/route-manifest.js';
import { getAppManifest, getAppEntryPaths, getEntryJsPath, getEntryCssPath, isContentSwitchAllowed, supportsSameVariantContentSwitch } from '../src/shell-core/runtime/app-manifests.js';
import { isAuthenticationResponse } from '../src/shared/navigation-response.js';

// A missing route boundary or same-origin check must fail these cases.
let requiresCommerceDocumentNavigation;
try {
  ({ requiresCommerceDocumentNavigation } = await import('../src/shared/commerce-navigation.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const origin = 'https://theme.test';
globalThis.window = { location: { origin } };

test('shop routes share an independent App and support same-app PJAX', () => {
  for (const pathname of ['/shop', '/shop/', '/shop/products?category=demo&page=2', '/shop/product/demo', '/shop/products/demo', '/shop/cart', '/shop/checkout/demo', '/shop/order/demo/payments', '/shop/order/demo', '/shop/future-scene']) {
    const route = resolveRoute(`${origin}${pathname}`);
    assert.equal(route?.appId, 'shop', pathname);
    assert.equal(route?.windowVariant, 'shop', pathname);
    assert.equal(route?.pjaxMode, 'same-app', pathname);
    assert.deepEqual(route?.preloadAssets, ['shop'], pathname);
  }
  assert.equal(supportsSameVariantContentSwitch('shop'), true);
  for (const mode of ['browser-shop-products', 'browser-shop-product', 'browser-shop-cart', 'browser-shop-checkout', 'browser-shop-payments', 'browser-shop-order']) {
    assert.equal(isContentSwitchAllowed('shop', mode), true, mode);
  }
  assert.equal(isContentSwitchAllowed('shop', 'browser-shop-orders'), false);
});

test('shop asset registration exposes a separate entry and output directory', () => {
  assert.equal(getAppManifest('shop')?.windowVariant, 'shop');
  assert.equal(getAppEntryPaths().shop, 'src/apps/shop/entry.js');
  assert.equal(getEntryJsPath('shop'), 'js/apps/shop/index.js');
  assert.equal(getEntryCssPath('shop'), 'css/apps/shop/index.css');
});

test('shop route boundaries leave customer center and similarly named paths outside the App', () => {
  for (const pathname of ['/shopper', '/shopping/cart', '/uc', '/uc/orders', '/Shop/products']) {
    assert.equal(resolveRoute(`${origin}${pathname}`), null, pathname);
  }
  assert.equal(resolveRoute('https://outside.test/shop/products'), null);
});

const cases = [
  ['desktop to shop root', `${origin}/`, '/shop', false],
  ['blog to product with query and hash', `${origin}/archives/example`, '/shop/products/item?sku=blue#gallery', false],
  ['shop list to cart', `${origin}/shop/products?page=2`, '/shop/cart', false],
  ['shop to desktop', `${origin}/shop/product/item`, '/', false],
  ['shop to blog through relative path', `${origin}/shop/products/`, '../../archives/example', false],
  ['desktop to customer center', `${origin}/`, '/uc', true],
  ['blog to customer orders', `${origin}/archives/example`, '/uc/orders?status=pending', true],
  ['customer center to shop', `${origin}/uc/orders`, '/shop/cart', true],
  ['customer center to desktop', `${origin}/uc`, '/', true],
  ['customer center internal navigation', `${origin}/uc`, '/uc/orders', true],
  ['same-origin http shop', 'http://theme.test/links', 'http://theme.test/shop/order/demo/payments', false],
  ['same-origin http customer center', 'http://theme.test/links', 'http://theme.test/uc/orders', true],
  ['ordinary blog navigation', `${origin}/links`, '/archives/example', false],
  ['shopper is not shop', `${origin}/shopper`, '/shopper/cart', false],
  ['customer prefix lookalike is ordinary', `${origin}/`, '/ucenter', false],
  ['customer source prefix lookalike is ordinary', `${origin}/ucenter`, '/shop', false],
  ['query alone does not mark a commerce route', `${origin}/archives/example`, '/links?next=/shop', false],
  ['external commerce target', `${origin}/shop`, 'https://other.test/shop/cart', false],
  ['external commerce source', 'https://other.test/shop', `${origin}/links`, false],
  ['external customer center target', `${origin}/uc`, 'https://other.test/uc/orders', false],
  ['external customer center source', 'https://other.test/uc', `${origin}/links`, false],
  ['different port is external', `${origin}/shop`, 'https://theme.test:8443/shop', false],
  ['different protocol is external', `${origin}/shop`, 'http://theme.test/shop', false],
  ['non-web target', `${origin}/shop`, 'javascript:void(0)', false],
  ['non-web source', 'file:///shop', 'file:///archives/example', false],
  ['invalid current URL', 'broken', '/shop', false],
  ['invalid target URL', `${origin}/shop`, 'http://[broken', false],
  ['empty target', `${origin}/shop`, '', false],
  ['null target', `${origin}/shop`, null, false],
  ['missing current URL', undefined, '/shop', false],
  ['case-sensitive route boundary', `${origin}/links`, '/Shop', false],
  ['shop URL objects', new URL(`${origin}/shop`), new URL(`${origin}/archives/example`), false],
  ['customer center URL objects', new URL(`${origin}/uc`), new URL(`${origin}/archives/example`), true]
];

for (const [name, current, target, expected] of cases) {
  test(name, () => {
    assert.equal(typeof requiresCommerceDocumentNavigation, 'function', 'commerce document navigation implementation is required');
    assert.equal(requiresCommerceDocumentNavigation(current, target), expected);
  });
}

// Execute the coordinator's actual entry functions, with only browser/network
// boundaries replaced. Shop requests must use the coordinator's normal asset
// and commit path; customer-center handoffs retain real beforeunload admission.
const coordinatorSource = await readFile(new URL('../src/shell/desktop-shell/runtime/desktop/pjax/index.js', import.meta.url), 'utf8');
function sourceBetween(start, end) {
  const from = coordinatorSource.indexOf(start);
  const to = coordinatorSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'coordinator fixture entry is available');
  return coordinatorSource.slice(from, to);
}
const beginSource = sourceBetween('    function beginNavigation(', '    function finishNavigationUi(');
const commitSource = sourceBetween('    function commitAcceptedNavigation(', '    function prepareLocalView(');
const handoffSource = sourceBetween('    function handoffNavigation(', '    const _origLoadUrl =');
const hasUnifiedNavigation = coordinatorSource.includes('    function requestNavigation(');
const fullSource = sourceBetween('    function executeFullNavigation(', hasUnifiedNavigation
  ? '    function requestNavigation(' : '    pjax.loadUrl =');
const navigationSource = hasUnifiedNavigation
  ? sourceBetween('    function requestNavigation(', '    pjax.loadUrl =') : '';
const loadSource = sourceBetween('    pjax.loadUrl =', '    initializeBrowserNavDepth(');
const responseSource = sourceBetween('    pjax.handleResponse = async function(', '    // Compatibility facade');
const sameSource = sourceBetween('    async function navigateWithinVariant(', '    // ── Pjax events ──');
// The old source remains executable for the red run; neither version replaces
// the actual click decision or public loadUrl facade with a test-only router.
const clickSource = hasUnifiedNavigation ? 'requestNavigation'
  : sourceBetween('      requestNavigation: ({ href, triggerElement, options }) => {', '\n      }\n    });')
    .replace('      requestNavigation: ', '') + '\n      }';

function coordinatorFixture({ current = '/links', source = current, allowed = true } = {}) {
  const events = new EventTarget();
  const admission = createNavigationAdmission({ eventTarget: events });
  const state = { allowed, version: 0, votes: 0, commits: 0, sameStarts: 0 };
  admission.registerNavigationGuard({
    id: 'theme-settings', capture: () => state.version,
    allow: () => { state.votes++; return state.allowed; }, isUnchanged: (snapshot) => snapshot === state.version,
    commit() { state.commits++; }
  });
  const navigations = [], failures = [], responses = [], requests = [], assets = [], localPreparations = [];
  const location = new URL(`${origin}${current}`);
  let responseApp = '';
  let sameNavigation = null;
  const context = vm.createContext({
    URL, AbortController, CustomEvent, requiresCommerceDocumentNavigation, isAuthenticationResponse,
    isCurrentNavigationIntent, resolveNavigationHref, inferWindowVariantFromUrl,
    isContentSwitchAllowed, supportsSameVariantContentSwitch,
    NAVIGATION_INTENT_OPTION: '__themeNavigationIntent', FAILED_RESPONSE_OPTION: '__themeFailedResponse',
    DOMParser: class { parseFromString() { return { body: { dataset: {} }, querySelectorAll: () => [{}] }; } },
    window: { location, history: { state: null }, clearTimeout() {} },
    document: { dispatchEvent: (event) => events.dispatchEvent(event), getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [{}],
      body: { dataset: { windowVariant: resolveRoute(`${origin}${source}`)?.windowVariant || '',
        pageMode: source.startsWith('/shop') ? 'browser-shop-products' : 'browser-links' } } },
    navigationIntentGeneration: 0, activeNavigation: null, pendingPopstateNavigation: null,
    committedBrowserEntry: { url: `${origin}${source}` },
    rollbackTimer: 0, rollbackPopstateUid: '', cancelledPopstateUid: '',
    _fullPjaxGeneration: 0, _sameVariantLoadingController: null,
    _pjaxLoadingController: null, _fullAssetGate: null,
    prepareNavigation: admission.prepareNavigation,
    commitNavigation: admission.commitNavigation,
    prepareNativeHandoff: admission.prepareNativeHandoff,
    revokeNativeHandoff: admission.revokeNativeHandoff,
    browserNavigationOwnership: createBrowserNavigationOwnership(),
    getCurrentPageApp: () => resolveRoute(`${origin}${source}`)?.appId || '',
    settleNavigation(record) { if (record) record.settled = true; },
    isNavigationCurrent: (record) => record === context.activeNavigation && !record.settled,
    finishNavigationUi() {}, showNavigationStatus() {}, snapshotCurrentBrowserEntry() {},
    clearPendingWindowScrollRestore() {}, pjaxWarn() {}, pjaxLog() {},
    _origHandleResponse: (...args) => responses.push(args),
    _origLoadUrl: (url, options) => { requests.push({ url, options }); return true; },
    hardNavigate(url, options) {
      navigations.push({ url, replace: options.replace,
        covered: admission.isCoveredNativeBeforeUnload(new Event('beforeunload'), 'theme-settings') });
    },
    failNavigation(_record, reason) { failures.push(reason); return false; },
    prepareLocalView(url) { localPreparations.push(url); return null; },
    cancelActivePhotosViewTransition() {}, sameVariantCoordinator: {
      cancel() { sameNavigation = null; },
      begin() { state.sameStarts++; sameNavigation = {}; return sameNavigation; },
      isCurrent: (navigation) => navigation === sameNavigation,
      finish() { sameNavigation = null; }
    },
    clearBusyState() {}, closeTransientNavigationUi() {},
    pjax: { abortRequest() {} }, inferPageAppForNavigation: (url) => resolveRoute(url)?.appId || '',
    browserNavStateStore: { recover: () => null },
    parsePageAppFromResponse: () => responseApp,
    startTopProgress() {}, stopTopProgress() {}, perfMark() {}, clearTransientNavigationUi() {},
    stageAppCssForNavigation() {}, syncHomeDesktopWidgetProtocolFromResponse() {},
    preparePluginCompatibilityFromResponse() {}, disposePluginUiBeforeNavigationCommit() {},
    ensureAppAssetsLoaded(app) { assets.push(app); return Promise.resolve(); }
  });
  new vm.Script(`${beginSource}\n${commitSource}\n${handoffSource}\n${fullSource}\n${navigationSource}\n${loadSource}\n${responseSource}\n${sameSource}\nglobalThis.clickNavigation = ${clickSource};`).runInContext(context);
  const click = (target) => context.clickNavigation({ href: `${origin}${target}`, triggerElement: {}, options: { triggerElement: {} } });
  const load = (target, options = {}) => context.pjax.loadUrl(`${origin}${target}`, options);
  const response = async (target, body = '<html></html>', { status = 200, requestOptions = {} } = {}) => {
    const href = `${origin}/redirect`;
    const record = context.beginNavigation(href, { requestOptions });
    responseApp = resolveRoute(`${origin}${target}`)?.appId || '';
    await context.pjax.handleResponse(body, { status, responseURL: `${origin}${target}` }, href,
      { requestOptions, __themeNavigationIntent: record.intentId });
  };
  return { context, state, navigations, failures, responses, requests, assets, localPreparations, click, load, response };
}

test('managed shop click starts PJAX and app assets with the accepted intent', () => {
  const f = coordinatorFixture();
  assert.equal(f.click('/shop').kind, 'started');
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.localPreparations, [`${origin}/shop`]);
  assert.deepEqual(f.assets, ['shop']);
  assert.equal(f.requests[0]?.url, `${origin}/shop`);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, f.context.activeNavigation.intentId);
  assert.equal(f.state.votes, 1);
  assert.equal(f.state.commits, 0, '资源下载和 HTML 请求不得提前清理草稿');
});

test('managed click leaving shop loads the next App through PJAX', () => {
  const f = coordinatorFixture({ current: '/shop/products' });
  f.click('/links');
  assert.deepEqual(f.navigations, []);
  assert.equal(f.requests[0]?.url, `${origin}/links`);
  assert.deepEqual(f.assets, ['links']);
});

test('managed same-shop click reuses its accepted permit when content-root fallback uses full PJAX', () => {
  const f = coordinatorFixture({ current: '/shop/products' });
  f.click('/shop/cart');
  assert.equal(f.state.sameStarts, 1, '同一商城窗口应进入内容切换协调器');
  assert.equal(f.state.votes, 1, '内容根节点缺失时回退仍应复用一次离页许可');
  assert.equal(f.requests[0]?.url, `${origin}/shop/cart`);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, 1);
  assert.deepEqual(f.navigations, []);
});

test('managed customer center click uses document navigation', () => {
  const f = coordinatorFixture();
  f.click('/uc/orders');
  assert.deepEqual(f.navigations, [{ url: `${origin}/uc/orders`, replace: false, covered: true }]);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.assets, []);
});

test('leave veto blocks shop PJAX without requests or asset loading', () => {
  const f = coordinatorFixture({ allowed: false });
  assert.equal(f.click('/shop').kind, 'cancelled');
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.assets, []);
  assert.equal(f.context.activeNavigation, null);
});

test('leave veto blocks native customer-center handoff', () => {
  const f = coordinatorFixture({ allowed: false });
  assert.equal(f.click('/uc').kind, 'cancelled');
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.requests, []);
});

test('programmatic shop navigation loads app assets and preserves the intent', () => {
  const f = coordinatorFixture();
  f.load('/shop/cart');
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.assets, ['shop']);
  assert.equal(f.requests[0]?.url, `${origin}/shop/cart`);
  assert.equal(f.requests[0]?.options.requestOptions.requestUrl, `${origin}/shop/cart`);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, f.context.activeNavigation.intentId);
});

test('programmatic same-shop navigation enters the same content coordinator as a managed click', async () => {
  const programmatic = coordinatorFixture({ current: '/shop/products' });
  const clicked = coordinatorFixture({ current: '/shop/products' });
  // Existing app callers pass root-relative URLs; history and target markers
  // still need the same absolute destination produced by a managed anchor.
  await programmatic.context.pjax.loadUrl('/shop/products?view=all');
  const decision = clicked.click('/shop/products?view=all');
  await decision.completion;
  assert.equal(programmatic.state.sameStarts, 1, 'loadUrl 必须进入同应用内容协调器');
  assert.equal(clicked.state.sameStarts, 1);
  assert.equal(programmatic.state.votes, 1);
  assert.equal(clicked.state.votes, 1);
  assert.deepEqual(programmatic.navigations, []);
  assert.deepEqual(clicked.navigations, []);
  assert.equal(programmatic.requests[0]?.url, `${origin}/shop/products?view=all`);
  assert.equal(programmatic.requests[0]?.options.__themeNavigationIntent, 1);
  assert.equal(clicked.requests[0]?.options.__themeNavigationIntent, 1);
});

test('programmatic leave veto starts no same navigation, request, assets or native handoff', async () => {
  const f = coordinatorFixture({ current: '/shop/products', allowed: false });
  assert.equal(await f.load('/shop/products?categoryId=2'), false);
  assert.equal(f.state.votes, 1);
  assert.equal(f.state.sameStarts, 0);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.assets, []);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.context.activeNavigation, null);
});

test('programmatic cross-app navigation preserves the full PJAX path', async () => {
  const f = coordinatorFixture({ current: '/shop/products' });
  await f.load('/links');
  assert.equal(f.state.votes, 1);
  assert.equal(f.state.sameStarts, 0);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.assets, ['links']);
  assert.equal(f.requests[0]?.url, `${origin}/links`);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, 1);
});

test('same-shop POST preserves form data through the existing full executor', async () => {
  const f = coordinatorFixture({ current: '/shop/products' });
  const formData = new FormData();
  formData.set('productId', '42');
  formData.set('_csrf', 'synthetic-test-token');
  await f.load('/shop/cart', { requestOptions: { requestMethod: 'POST', formData } });
  assert.equal(f.state.votes, 1);
  assert.equal(f.state.sameStarts, 0, 'POST 不得进入仅发送 GET 的内容协调器');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.url, `${origin}/shop/cart`);
  assert.equal(f.requests[0]?.options.requestOptions.requestMethod, 'POST');
  assert.equal(f.requests[0]?.options.requestOptions.formData, formData);
  assert.equal(f.requests[0]?.options.requestOptions.requestUrl, `${origin}/shop/cart`);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, 1);
  assert.deepEqual(f.navigations, []);
});

for (const allowed of [true, false]) {
  test(`programmatic customer-center handoff honors leave admission (${allowed ? 'allow' : 'veto'})`, async () => {
    const f = coordinatorFixture({ current: '/shop/products', allowed });
    await f.load('/uc/shop/orders');
    assert.equal(f.state.votes, 1);
    assert.equal(f.state.sameStarts, 0);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.assets, []);
    assert.deepEqual(f.navigations, allowed
      ? [{ url: `${origin}/uc/shop/orders`, replace: false, covered: true }] : []);
  });
}

test('same-shop popstate reuses its accepted permit and suppresses the same executor', async () => {
  const f = coordinatorFixture({ current: '/shop/products?view=all', source: '/shop/products' });
  const href = `${origin}/shop/products?view=all`;
  const record = f.context.beginNavigation(href, { history: false });
  const permit = record.permit;
  f.context.pendingPopstateNavigation = record;
  await f.load('/shop/products?view=all', { history: false });
  assert.equal(f.state.votes, 1, 'popstate 已投票，不得再次申请许可');
  assert.equal(f.state.sameStarts, 0, 'history:false 应保留禁止新增历史的完整 PJAX 路径');
  assert.equal(f.context.activeNavigation, record);
  assert.equal(f.context.activeNavigation.permit, permit);
  assert.equal(f.context.pendingPopstateNavigation, null);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.options.history, false);
  assert.equal(f.requests[0]?.options.__themeNavigationIntent, record.intentId);
  assert.deepEqual(f.navigations, []);
});

test('popstate leaving shop stays in PJAX and retains history suppression', () => {
  const f = coordinatorFixture({ current: '/links', source: '/shop/order/demo/payments' });
  f.load('/links', { history: false });
  assert.deepEqual(f.navigations, []);
  assert.equal(f.requests[0]?.url, `${origin}/links`);
  assert.equal(f.requests[0]?.options.history, false);
});

test('popstate entering shop stays in PJAX and retains history suppression', () => {
  const f = coordinatorFixture({ current: '/shop/products', source: '/links' });
  f.load('/shop/products', { history: false });
  assert.deepEqual(f.navigations, []);
  assert.equal(f.requests[0]?.url, `${origin}/shop/products`);
  assert.equal(f.requests[0]?.options.history, false);
});

test('popstate leaving customer center uses the committed source URL for native replacement', () => {
  const f = coordinatorFixture({ current: '/shop/products', source: '/uc/orders' });
  f.load('/shop/products', { history: false });
  assert.deepEqual(f.navigations, [{ url: `${origin}/shop/products`, replace: true, covered: true }]);
});

test('changed draft revokes native handoff permission after acceptance', () => {
  const f = coordinatorFixture();
  const href = `${origin}/uc`;
  const record = f.context.beginNavigation(href);
  f.state.version++;
  f.context.executeFullNavigation({ href, options: {}, intentId: record.intentId, permit: record.permit });
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.failures, ['cancelled']);
});

test('redirected shop response loads its app before committing through PJAX', async () => {
  const f = coordinatorFixture();
  await f.response('/shop/product/1');
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.assets, ['shop']);
  assert.equal(f.responses.length, 1);
  assert.equal(f.state.commits, 1);
});

test('changed draft blocks redirected shop response before committing DOM', async () => {
  const f = coordinatorFixture();
  const href = `${origin}/redirect`;
  const record = f.context.beginNavigation(href);
  f.state.version++;
  await f.context.pjax.handleResponse('<html></html>', { status: 200, responseURL: `${origin}/shop/product/1` }, href,
    { __themeNavigationIntent: record.intentId });
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.responses, []);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.failures, ['cancelled']);
});

test('redirected customer center response uses the final response URL', async () => {
  const f = coordinatorFixture();
  await f.response('/uc');
  assert.deepEqual(f.navigations, [{ url: `${origin}/uc`, replace: false, covered: true }]);
  assert.deepEqual(f.assets, []);
  assert.deepEqual(f.responses, []);
});

test('failed response body still preserves the current page', async () => {
  const f = coordinatorFixture();
  await f.response('/shop/products', null);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.responses[0]?.[0], false);
  assert.equal(f.responses[0]?.[3]?.__themeFailedResponse, true);
});

test('failed POST responses preserve the form instead of reopening its action as GET', async () => {
  for (const status of [400, 500]) {
    const f = coordinatorFixture({ current: '/shop/product/42' });
    await f.response('/shop/cart', null, { status, requestOptions: { requestMethod: 'POST' } });
    assert.deepEqual(f.navigations, [], `POST ${status} 不得把提交 action 作为 GET 整页打开`);
    assert.deepEqual(f.requests, [], '失败响应不得重发提交或发起 GET');
    assert.deepEqual(f.responses, [], '失败响应不得替换当前表单所在页面');
    assert.deepEqual(f.failures, ['form-response']);
    assert.equal(f.state.commits, 0, '失败提交不得清理源页面草稿');
    assert.equal(f.context.window.location.href, `${origin}/shop/product/42`);
  }
  const get = coordinatorFixture({ current: '/shop/product/42' });
  await get.response('/shop/cart', null, { status: 500, requestOptions: { requestMethod: 'GET' } });
  assert.deepEqual(get.navigations, [{ url: `${origin}/shop/cart`, replace: false, covered: true }],
    '普通 GET 错误应继续显示服务端错误页');
});
