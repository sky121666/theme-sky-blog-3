import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getAppAssetSegment } from '../src/shell-core/runtime/app-manifests.js';

// Execute production functions with in-memory network/DOM fixtures. No server,
// generated assets or file writes are needed for these failure-path tests.
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const executable = (source) => source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const registrySource = executable(read('src/shell-core/runtime/resource-registry.js'));
const loaderSource = executable(read('src/shell-core/runtime/app-loader.js'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const manifest = (revision = 'old') => ({
  __meta: { version: '0.9.46', revision, query: `v=0.9.46&r=${revision}` },
  reader: { css: ['/assets/css/apps/reader/index.css'], js: ['/assets/js/apps/reader/index.js'] }
});
const response = (value) => ({ ok: true, json: async () => value });

function registryFixture(fetch) {
  const elements = [];
  let reloads = 0;
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => elements.filter((node) => selector.startsWith('link') ? node.tag === 'link' : node.tag === 'script'),
    head: { appendChild: (node) => elements.push(node) },
    createElement(tag) {
      const events = new Map();
      const node = {
        tag, dataset: {},
        addEventListener: (type, fn) => events.set(type, fn),
        removeEventListener: (type) => events.delete(type),
        dispatch: (type) => events.get(type)?.(),
        getAttribute: (name) => node[name] || '',
        remove: () => { const index = elements.indexOf(node); if (index >= 0) elements.splice(index, 1); }
      };
      return node;
    }
  };
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, console,
    __THEME_BUILD_VERSION__: '0.9.46', __THEME_BUILD_REVISION__: 'old',
    fetch, document, assetPathSegment: getAppAssetSegment,
    window: {
      location: { origin: 'https://example.test', reload: () => reloads++ },
      // A Halo SSR revision must not replace the compiled build identity.
      __THEME_ASSET_IDENTITY__: { version: '0.9.46', revision: 'halo-token', source: 'server-fallback' },
      setTimeout, clearTimeout
    }
  });
  vm.runInContext(registrySource, context);
  return { context, elements, reloads: () => reloads };
}

async function verifyBuildIdentity() {
  const { context, reloads } = registryFixture(async () => response(manifest('new')));
  const entry = read('src/shell/desktop-shell/entry-main.js');
  const runtimeGuard = entry.search(/^if \(!window\.__THEME_MAIN_LOADED__/m);
  assert.ok(runtimeGuard > 0, 'Shell runtime initialization guard must exist');
  vm.runInContext(entry.slice(entry.indexOf('const CURRENT_THEME_BUILD_IDENTITY'), runtimeGuard), context);
  assert.equal(await vm.runInContext('verifyRuntimeFreshness(true)', context), true);
  assert.equal(reloads(), 1, '同版本新 revision 必须刷新');
  assert.equal(vm.runInContext("withThemeAssetVersion('/assets/app.js?v=wrong&r=new')", context), '/assets/app.js?v=0.9.46&r=old');
  await assert.rejects(vm.runInContext("getAssetsForApp('reader')", context), { name: 'ThemeAssetIdentityError' });
  assert.equal(vm.runInContext('getCurrentThemeAssetIdentity().revision', context), 'old');
}

async function verifyManifestTimeoutAndSharing() {
  const oldBody = deferred();
  let calls = 0, firstSignal;
  const { context } = registryFixture(async (_url, options) => {
    calls++;
    if (calls === 1) {
      firstSignal = options.signal;
      return { ok: true, json: () => oldBody.promise };
    }
    return response(manifest());
  });
  const first = vm.runInContext('loadAssetManifest({ timeoutMs: 5 })', context);
  const shared = vm.runInContext('loadAssetManifest({ force: true, timeoutMs: 5 })', context);
  const results = await Promise.allSettled([first, shared]);
  assert.equal(calls, 1, '并发强制刷新必须共享进行中的清单');
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason.name === 'TimeoutError'));
  assert.equal(firstSignal.aborted, true, 'body 超时也必须中止 fetch');
  await vm.runInContext('loadAssetManifest({ force: true })', context);
  oldBody.resolve(manifest('late-old-response'));
  await flush();
  await vm.runInContext("getAssetsForApp('reader')", context);
  assert.equal(calls, 2, '过期响应不能清除成功的新缓存');
  assert.equal(vm.runInContext('getCurrentThemeAssetIdentity().revision', context), 'old');

  const pending = deferred();
  const isolated = registryFixture(() => pending.promise).context;
  isolated.consumer = new AbortController();
  const cancelled = vm.runInContext('loadAssetManifest({ signal: consumer.signal })', isolated);
  const survivor = vm.runInContext('loadAssetManifest()', isolated);
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  isolated.consumer.abort();
  await rejection;
  pending.resolve(response(manifest()));
  await survivor;
}

async function verifyParallelAssetsAndCancellation() {
  const { context, elements } = registryFixture(async () => response(manifest()));
  vm.runInContext(loaderSource, context);
  context.consumer = new AbortController();
  const cancelled = vm.runInContext("ensureAppAssetsLoaded('reader', { signal: consumer.signal })", context);
  let survivorReady = false;
  const survivor = vm.runInContext("ensureAppAssetsLoaded('reader')", context).then(() => { survivorReady = true; });
  await flush();
  assert.equal(elements.length, 2, 'CSS 与 JS 必须同时开始，共享消费者不能重复创建资源');
  assert.equal(elements.filter((node) => node.tag === 'script').length, 1, 'CSS 未完成时 JS 已开始');
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  context.consumer.abort();
  await rejection;
  elements.find((node) => node.tag === 'link').dispatch('load');
  await flush();
  assert.equal(survivorReady, false, '只有 CSS 完成不能越过 module registrar 门禁');
  elements.find((node) => node.tag === 'script').dispatch('load');
  await survivor;
  assert.equal(survivorReady, true, '取消一名消费者不能破坏另一导航的共享资源');
}

async function verifyExistingAssetIdentity() {
  const { context, elements } = registryFixture(async () => response(manifest()));
  for (const tag of ['link', 'script']) {
    const node = context.document.createElement(tag);
    node[tag === 'link' ? 'href' : 'src'] = `/assets/${tag === 'link' ? 'css' : 'js'}/apps/reader/index.${tag === 'link' ? 'css' : 'js'}?v=0.9.46&r=wrong`;
    node.dataset[tag === 'link' ? 'appCssState' : 'appScriptState'] = 'ready';
    context.document.head.appendChild(node);
  }
  vm.runInContext(loaderSource, context);
  vm.runInContext("markAppAssetsLoaded('reader')", context);
  let complete = false;
  const pending = vm.runInContext("ensureAppAssetsLoaded('reader')", context).then(() => { complete = true; });
  await flush();
  assert.equal(elements.length, 4, '显式错误 revision 的旧 CSS/JS 均不得复用');
  assert.equal(complete, false, '错误 revision 的 ready 标记不得越过资产门禁');
  assert.ok(elements.slice(0, 2).every((node) => !node.dataset.appCss && !node.dataset.appScript));
  for (const node of elements.slice(2)) node.dispatch('load');
  await pending;
}

function verifyWarmCssBuildIdentity() {
  const { context } = registryFixture(() => { throw new Error('staging must not fetch'); });
  vm.runInContext(loaderSource, context);
  const style = (href, appId = 'reader', disabled = true, state = 'ready') => {
    const link = context.document.createElement('link');
    Object.assign(link, { href, disabled, rel: 'stylesheet' });
    Object.assign(link.dataset, { appCss: appId, appCssState: state });
    context.document.head.appendChild(link);
    return link;
  };
  const expected = '/assets/css/apps/reader/index.css?v=0.9.46&r=old';
  const current = style('/assets/css/apps/categories/index.css?v=0.9.46&r=old', 'explorer-categories', false);
  const target = style(expected);
  const rejected = [
    style(expected.replace('r=old', 'r=wrong')),
    style(expected.replace('v=0.9.46', 'v=wrong')),
    style('/assets/css/apps/reader/index.css?v=0.9.46'),
    style('/assets/css/apps/reader/index.css?r=old'),
    style('/assets/css/apps/reader/index.css'),
    style(`https://other.test${expected}`),
    style('/assets/css/apps/photos/index.css?v=0.9.46&r=old'),
    style(expected, 'reader', true, 'error')
  ];
  assert.equal(vm.runInContext("stageAppCssForNavigation('reader')", context), 1);
  assert.equal(target.disabled, false, '当前完整构建身份的 warm CSS 必须同步启用');
  assert.equal(current.disabled, false, 'warm staging 不得禁用正在展示的旧页面 CSS');
  assert.ok(rejected.every((link) => link.disabled), '相同 appId 或路径不能绕过 v+r、origin、路径及失败状态校验');
  assert.equal(vm.runInContext("stageAppCssForNavigation('unknown-app')", context), 0);
}

function verifyLifecycleFailures() {
  const calls = [];
  const context = vm.createContext({
    window: { location: { pathname: '/', search: '', hash: '' } },
    document: { title: 'test', body: { dataset: {} }, querySelector: () => null, documentElement: { classList: { contains: () => false } } },
    console: { error: () => calls.push('reported') },
    initLazyImages: () => calls.push('init-images'), initLazyComments: () => calls.push('init-comments'),
    disposeLazyImages: () => { calls.push('dispose-images'); throw new Error('image disposer'); },
    disposeLazyComments: () => calls.push('dispose-comments'), calls
  });
  vm.runInContext(executable(read('src/shell/desktop-shell/runtime/shared/page-app.js')), context);
  vm.runInContext(`registerPageAppLifecycle('reader', {
    hydrate: () => () => { calls.push('cleanup'); throw new Error('cleanup'); },
    dispose: () => calls.push('dispose'),
    getDocumentState: () => { throw new Error('document state'); }
  });`, context);
  assert.throws(() => vm.runInContext("activatePageApp('reader')", context), /document state/);
  assert.deepEqual(calls, ['cleanup', 'dispose', 'dispose-images', 'dispose-comments', 'reported']);
  assert.equal(vm.runInContext('window.__THEME_PAGE_APP_REGISTRY__.activeApp', context), null);
  vm.runInContext("registerPageAppLifecycle('next', {}); activatePageApp('next'); deactivateCurrentPageApp()", context);
  assert.equal(calls.filter((value) => value === 'cleanup').length, 1, '失败实例不能重复清理');
  vm.runInContext("queuePageAppRegistrar(() => { calls.push('first'); throw new Error('registrar'); }); queuePageAppRegistrar(() => calls.push('second'))", context);
  assert.throws(() => vm.runInContext('runPageAppRegistrars({})', context), /App registration failed/);
  assert.ok(calls.includes('second'), '前一注册失败不能丢弃后续注册回调');
}

async function verifyPrefetchFailure() {
  let warnings = 0, removed = 0, attempts = 0;
  const context = vm.createContext({
    URL, setTimeout, clearTimeout,
    window: { location: { origin: 'https://example.test' } },
    document: { createElement: () => ({ remove: () => removed++ }), head: { appendChild() {} } },
    createLogger: () => ({ log() {}, warn: () => warnings++ }),
    inferPageAppFromUrl: () => 'links',
    ensureAppCssLoaded: () => { attempts++; return Promise.reject(new Error('CSS unavailable')); }
  });
  vm.runInContext(executable(read('src/shell/desktop-shell/runtime/desktop/pjax/prefetch.js')), context);
  vm.runInContext("doPrefetch('/links')", context);
  await flush();
  vm.runInContext("doPrefetch('/links')", context);
  await flush();
  assert.equal(attempts, 2, '失败预取允许重试');
  assert.equal(warnings, 2);
  assert.equal(removed, 2);
}

async function verifyFullPjaxAssetGate() {
  const source = read('src/shell/desktop-shell/runtime/desktop/pjax/index.js');
  const responseCode = source.slice(source.indexOf('pjax.handleResponse = async function'), source.indexOf('// Patch attachLink'));
  const loadCode = source.slice(source.indexOf('pjax.loadUrl = function'), source.indexOf('    initializeBrowserNavDepth();'));
  const events = [], gates = new Map(), ready = new Set();
  let requestCssState;
  const noOp = () => {};
  const { context } = registryFixture(async () => response(manifest()));
  vm.runInContext(loaderSource, context);
  const stageCss = vm.runInContext('stageAppCssForNavigation', context);
  const warmStyle = context.document.createElement('link');
  Object.assign(warmStyle, { href: '/assets/css/apps/reader/index.css?v=0.9.46&r=old', disabled: true });
  Object.assign(warmStyle.dataset, { appCss: 'reader', appCssState: 'ready' });
  context.document.head.appendChild(warmStyle);
  const currentStyle = context.document.createElement('link');
  Object.assign(currentStyle, { href: '/assets/css/apps/categories/index.css?v=0.9.46&r=old', disabled: false });
  context.document.head.appendChild(currentStyle);
  context.document.getElementById = () => null;
  context.document.body = { dataset: {} };
  context.window.dispatchEvent = () => true;
  context.window.history = { state: null };
  Object.assign(context, {
    AbortController, DOMException, Promise,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    pjax: { abortRequest: noOp },
    navigationIntentGeneration: 0, _fullPjaxGeneration: 0, _fullAssetGate: null,
    cancelledPopstateUid: '', rollbackPopstateUid: '', rollbackTimer: 0, committedBrowserEntry: null,
    _sameVariantLoadingController: null, _pjaxLoadingController: null,
    NAVIGATION_INTENT_OPTION: '__themeNavigationIntent', BEFORE_PJAX_NAVIGATION_EVENT: 'before',
    sameVariantCoordinator: { cancel: noOp }, browserNavigationOwnership: { begin: noOp, release: noOp },
    clearPendingWindowScrollRestore: noOp, snapshotCurrentBrowserEntry: noOp, showNavigationStatus: noOp,
    restoreRememberedBrowserNavState: noOp,
    cancelActivePhotosViewTransition: noOp, clearBusyState: noOp, closeTransientNavigationUi: noOp,
    startTopProgress: noOp, stopTopProgress: noOp, pjaxLog: noOp, pjaxWarn: noOp, syncAppCss: noOp,
    getCurrentPageApp: () => 'reader', inferPageAppForNavigation: (url) => url.slice(1),
    parsePageAppFromResponse: (html) => html, resolveNavigationHref: (_request, href) => href,
    isCurrentNavigationIntent: (intent, current) => intent === current,
    stageAppCssForNavigation: (app) => { stageCss(app); events.push(`css-stage:${app}`); },
    syncHomeDesktopWidgetProtocolFromResponse: noOp, preparePluginCompatibilityFromResponse: noOp,
    hardNavigate: (url) => events.push(`hard:${url}`),
    _origLoadUrl: (url) => {
      if (url === '/reader') {
        requestCssState = { targetDisabled: warmStyle.disabled, currentDisabled: currentStyle.disabled };
      }
      events.push(`html-start:${url}`);
    },
    _origHandleResponse: (html) => events.push(`swap:${html}`),
    ensureAppAssetsLoaded(app, { signal } = {}) {
      events.push(`assets:${app}`);
      if (ready.has(app)) return Promise.resolve();
      const gate = deferred(); gates.set(app, gate);
      signal?.addEventListener('abort', () => gate.reject(new DOMException('Aborted', 'AbortError')), { once: true });
      return gate.promise.then(() => ready.add(app));
    }
  });
  vm.runInContext(responseCode + '\n' + loadCode, context);
  await context.pjax.loadUrl('/reader');
  assert.equal(requestCssState.targetDisabled, false, 'HTML 请求及同步 pjax:send 前必须启用 warm 目标 CSS');
  assert.equal(requestCssState.currentDisabled, false, '请求期间旧页面 CSS 必须保持启用');
  assert.ok(events.includes('html-start:/reader'), 'CSS/JS 未完成也必须已经开始 HTML 请求');
  assert.ok(events.indexOf('css-stage:reader') < events.indexOf('html-start:/reader'));
  const first = context.pjax.handleResponse('reader', { status: 200 }, '/reader', { __themeNavigationIntent: 1 });
  await flush();
  assert.ok(!events.includes('swap:reader'));
  gates.get('reader').resolve();
  await first;
  assert.equal(events.filter((event) => event === 'css-stage:reader').length, 2, '响应资源就绪后仍须在 DOM 替换前再次 staging');
  assert.ok(events.lastIndexOf('css-stage:reader') < events.indexOf('swap:reader'));
  await context.pjax.loadUrl('/photos');
  assert.ok(events.includes('html-start:/photos'), '没有缓存 CSS/JS 的冷页面也必须立即开始 HTML 请求');
  const stale = context.pjax.handleResponse('photos', { status: 200 }, '/photos', { __themeNavigationIntent: 2 });
  await flush();
  assert.ok(!events.includes('swap:photos'), '冷页面 HTML 已返回仍须等待资产后才能替换 DOM');
  await context.pjax.loadUrl('/links');
  await stale;
  assert.ok(!events.includes('swap:photos'), '较旧导航取消后不得替换 DOM');
  assert.ok(!events.includes('hard:/photos'), '取消不能触发旧导航的硬刷新');
  gates.get('links').reject(new Error('module download failed'));
  await flush();
  assert.ok(events.includes('hard:/links'), '当前资产失败必须回退且不能替换 DOM');
  assert.ok(!events.includes('swap:links'));
}

await verifyBuildIdentity();
await verifyManifestTimeoutAndSharing();
await verifyParallelAssetsAndCancellation();
await verifyExistingAssetIdentity();
verifyWarmCssBuildIdentity();
verifyLifecycleFailures();
await verifyPrefetchFailure();
await verifyFullPjaxAssetGate();
console.log('resource/navigation hardening passed: identity, manifest deadline/sharing, parallel assets, warm CSS build identity, lifecycle recovery, prefetch, PJAX ordering/cancellation');
