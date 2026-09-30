import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getAppAssetSegment } from '../src/shell-core/runtime/app-manifests.js';
import { createNavigationAdmission } from '../src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js';
import { markStartupRecoveryReload } from '../src/shared/startup-signals.js';
import { isAuthenticationResponse } from '../src/shared/navigation-response.js';

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

function registryFixture(fetch, bootstrapManifest = null) {
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
      __THEME_ASSET_IDENTITY__: bootstrapManifest
        ? { version: '0.9.46', revision: 'old', query: 'v=0.9.46&r=old', source: 'manifest' }
        : { version: '0.9.46', revision: 'halo-token', source: 'server-fallback' },
      __THEME_ASSET_MANIFEST__: bootstrapManifest,
      setTimeout, clearTimeout
    }
  });
  vm.runInContext(registrySource, context);
  return { context, elements, reloads: () => reloads };
}

async function verifyBootstrapManifestReuse() {
  let calls = 0;
  const initial = manifest();
  const { context } = registryFixture(async () => { calls++; return response(manifest('new')); }, initial);
  const assets = await vm.runInContext("getAssetsForApp('reader')", context);
  assert.equal(assets.css[0], initial.reader.css[0]);
  assert.equal(calls, 0, '同一构建身份的启动清单不应重复下载');
  assert.equal((await vm.runInContext('getLatestThemeAssetIdentity()', context)).revision, 'old');
  assert.equal(calls, 0);
  assert.equal((await vm.runInContext('getLatestThemeAssetIdentity({ force: true })', context)).revision, 'new');
  assert.equal(calls, 1, 'force 必须从网络检查新构建');
  await assert.rejects(vm.runInContext("getAssetsForApp('reader')", context), { name: 'ThemeAssetIdentityError' });

  for (const changed of [
    { ...initial, __meta: { ...initial.__meta, query: 'v=0.9.46&r=other' } },
    { ...initial, __meta: { ...initial.__meta, revision: 'other' } },
    { ...initial, __meta: { version: '0.9.46', revision: 'old' } },
  ]) {
    let mismatchedCalls = 0;
    const mismatch = registryFixture(async () => { mismatchedCalls++; return response(initial); }, changed);
    await vm.runInContext('loadAssetManifest()', mismatch.context);
    assert.equal(mismatchedCalls, 1, '不完整或不匹配身份不得复用');
  }
}

async function verifyFreshnessEventRouting() {
  const entry = read('src/shell/desktop-shell/entry-main.js');
  const start = entry.indexOf('  void verifyRuntimeFreshness();');
  assert.ok(start > 0);
  const source = entry.slice(start, entry.lastIndexOf('\n}'));
  const calls = [];
  const listeners = new Map();
  const visibility = { visibilityState: 'hidden', addEventListener: (name, fn) => listeners.set(name, fn) };
  const browser = { addEventListener: (name, fn) => listeners.set(name, fn) };
  vm.runInNewContext(source, { document: visibility, window: browser, verifyRuntimeFreshness: (force = false) => { calls.push(force); return Promise.resolve(false); } });
  listeners.get('pageshow')({ persisted: false });
  listeners.get('pageshow')({ persisted: true });
  visibility.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  assert.deepEqual(calls, [false, false, true, true], '首次检查与首次 pageshow 复用清单，恢复检查强制下载');
}

async function verifyBuildIdentity() {
  const { context, reloads } = registryFixture(async () => response(manifest('new')));
  context.markStartupRecoveryReload = () => markStartupRecoveryReload(context.window);
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
  const responseStart = source.indexOf('pjax.handleResponse = async function');
  const responseEnd = source.indexOf('\n    };', responseStart) + '\n    };'.length;
  const loadStart = source.indexOf('const rollbackPopstateToCommittedEntry =');
  const loadEnd = source.indexOf('    initializeBrowserNavDepth();', loadStart);
  const sameStart = source.indexOf('async function navigateWithinVariant(');
  const sameEnd = source.indexOf('    // ── Pjax events ──', sameStart);
  assert.ok(responseStart >= 0 && responseEnd > responseStart && loadStart > responseEnd && loadEnd > loadStart,
    '必须抽取当前真实 full response、准入与 loadUrl 执行器，而不是测试脚本的复制实现');
  assert.ok(sameStart > loadEnd && sameEnd > sameStart, '必须抽取当前真实 same-variant 执行器');
  const responseCode = source.slice(responseStart, responseEnd);
  const loadCode = source.slice(loadStart, loadEnd);
  const sameCode = source.slice(sameStart, sameEnd);
  const events = [], gates = new Map(), ready = new Set(), requests = new Map();
  let requestCssState, currentApp = 'categories', aborts = 0, snapshots = 0;
  let historyWrites = 0, votes = 0, sameNavigation = null;
  const noOp = () => {};
  const draft = { version: 0, saving: false, allowed: false, cleanups: 0 };
  const admission = createNavigationAdmission({ eventTarget: new EventTarget() });
  admission.registerNavigationGuard({
    id: 'desktop-layout',
    capture: () => ({ version: draft.version, saving: draft.saving }),
    allow: () => { votes++; return draft.allowed && !draft.saving; },
    isUnchanged: (snapshot) => snapshot.version === draft.version && snapshot.saving === draft.saving,
    commit: () => { draft.cleanups++; events.push('draft-commit'); }
  });
  const { context } = registryFixture(async () => response(manifest()));
  vm.runInContext(loaderSource, context);
  const stageCss = vm.runInContext('stageAppCssForNavigation', context);
  const warmStyle = context.document.createElement('link');
  Object.assign(warmStyle, { href: '/assets/css/apps/reader/index.css?v=0.9.46&r=old', disabled: true });
  Object.assign(warmStyle.dataset, { appCss: 'reader', appCssState: 'ready' });
  context.document.head.appendChild(warmStyle);
  const currentStyle = context.document.createElement('link');
  Object.assign(currentStyle, { href: '/assets/css/apps/categories/index.css?v=0.9.46&r=old', disabled: false });
  Object.assign(currentStyle.dataset, { appCss: 'categories', appCssState: 'ready' });
  context.document.head.appendChild(currentStyle);
  context.document.getElementById = () => null;
  const queryAll = context.document.querySelectorAll;
  context.document.querySelectorAll = (selector) => ['title', '#window-frame-root'].includes(selector) ? [{}] : queryAll(selector);
  context.document.body = { dataset: {} };
  context.document.dispatchEvent = (event) => { events.push(event.type); return true; };
  context.window.location.href = 'https://example.test/categories';
  context.window.history = {
    state: null,
    pushState: () => { historyWrites++; },
    replaceState: () => { historyWrites++; }
  };
  context.window.clearTimeout = clearTimeout;
  context.window.setTimeout = setTimeout;
  context.window.pjax = null;
  const syncCss = (app) => {
    events.push(`css-restore:${app}`);
    for (const style of [warmStyle, currentStyle]) style.disabled = style.dataset.appCss !== app;
  };
  Object.assign(context, {
    AbortController, DOMException, Promise, isAuthenticationResponse,
    CustomEvent,
    DOMParser: class { parseFromString() { return { querySelectorAll: (selector) =>
      selector === '#window-frame-root' || selector === 'title' ? [{}] : [] }; } },
    pjax: {
      abortRequest: () => { aborts++; },
      loadUrl(url, options) {
        requests.set(url, options);
        events.push(`html-start:${url}`);
        if (url === '/reader') {
          requestCssState = { targetDisabled: warmStyle.disabled, currentDisabled: currentStyle.disabled };
        }
      }
    },
    navigationIntentGeneration: 0, _fullPjaxGeneration: 0, _fullAssetGate: null,
    cancelledPopstateUid: '', rollbackPopstateUid: '', rollbackTimer: 0, committedBrowserEntry: null,
    activeNavigation: null, pendingPopstateNavigation: null,
    _sameVariantLoadingController: null, _pjaxLoadingController: null,
    NAVIGATION_INTENT_OPTION: '__themeNavigationIntent',
    sameVariantCoordinator: {
      begin() { sameNavigation = {}; return sameNavigation; },
      isCurrent(navigation) { return navigation === sameNavigation; },
      finish(navigation) {
        if (navigation !== sameNavigation) return false;
        sameNavigation = null;
        return true;
      },
      cancel() { sameNavigation = null; }
    },
    browserNavigationOwnership: { begin: noOp, release: noOp },
    clearPendingWindowScrollRestore: noOp,
    snapshotCurrentBrowserEntry: () => { snapshots++; events.push('snapshot'); },
    showNavigationStatus: noOp,
    restoreRememberedBrowserNavState: noOp,
    cancelActivePhotosViewTransition: noOp, clearBusyState: noOp,
    closeTransientNavigationUi: noOp, clearTransientNavigationUi: noOp,
    startTopProgress: noOp, stopTopProgress: noOp, perfMark: noOp,
    pjaxLog: noOp, pjaxWarn: noOp, syncAppCss: syncCss,
    getCurrentPageApp: () => currentApp, inferPageAppForNavigation: (url) => url.slice(1),
    parsePageAppFromResponse: (html) => html, resolveNavigationHref: (_request, href) => href,
    isCurrentNavigationIntent: (intent, current) => intent === current,
    stageAppCssForNavigation: (app) => { stageCss(app); events.push(`css-stage:${app}`); },
    syncHomeDesktopWidgetProtocolFromResponse: () => events.push('protocol'),
    preparePluginCompatibilityFromResponse: () => events.push('plugin-stage'),
    disposePluginUiBeforeNavigationCommit: () => events.push('plugin-dispose'),
    ensureCurrentPageAppActive: noOp, discardStagedOnlineMonitorHistoryState: noOp,
    prepareNavigation: admission.prepareNavigation,
    commitNavigation: admission.commitNavigation,
    abandonNavigation: admission.abandonNavigation,
    prepareNativeHandoff: admission.prepareNativeHandoff,
    revokeNativeHandoff: admission.revokeNativeHandoff,
    hardNavigate: (url) => events.push(`hard:${url}`),
    _origHandleResponse: (html) => {
      currentApp = html;
      context.window.history.pushState({ url: `/${html}` }, '', `/${html}`);
      events.push(`swap:${html}`);
    },
    ensureAppAssetsLoaded(app, { signal } = {}) {
      events.push(`assets:${app}`);
      if (ready.has(app)) return Promise.resolve();
      const gate = deferred(); gates.set(app, gate);
      signal?.addEventListener('abort', () => gate.reject(new DOMException('Aborted', 'AbortError')), { once: true });
      return gate.promise.then(() => ready.add(app));
    }
  });
  vm.runInContext(responseCode + '\n' + loadCode + '\n' + sameCode, context);
  const vetoResult = await context.pjax.loadUrl('/reader');
  assert.equal(vetoResult, false, '离页否决应保持 loadUrl 原有的 false 返回语义');
  assert.equal(requests.size, 0, '离页否决不得发送 HTML 请求');
  assert.equal(context.navigationIntentGeneration, 0, '否决尝试不得取得导航 intent');
  assert.equal(aborts, 0, '否决尝试不得取消旧请求');
  assert.equal(snapshots, 0, '离页否决不得先改写源 history/滚动快照');
  assert.equal(historyWrites, 0, '否决尝试不得写入 history');
  assert.equal(draft.cleanups, 0, '离页否决不得丢弃草稿');

  draft.allowed = true;
  await context.pjax.loadUrl('/reader');
  const readerOptions = requests.get('/reader');
  assert.equal(readerOptions.__themeNavigationIntent, 1, 'full 请求必须携带已接受的逻辑 intent');
  assert.equal(readerOptions.requestOptions.requestUrl, '/reader');
  assert.equal(events.filter((event) => event === 'theme:navigation-accepted').length, 1,
    '通过守卫后才发送一次 accepted');
  assert.equal(requestCssState.targetDisabled, false, 'HTML 请求及同步 pjax:send 前必须启用 warm 目标 CSS');
  assert.equal(requestCssState.currentDisabled, false, '请求期间旧页面 CSS 必须保持启用');
  assert.ok(events.includes('html-start:/reader'), 'CSS/JS 未完成也必须已经开始 HTML 请求');
  assert.ok(events.indexOf('css-stage:reader') < events.indexOf('html-start:/reader'));
  const first = context.pjax.handleResponse('reader', { status: 200 }, '/reader', readerOptions);
  await flush();
  assert.ok(!events.includes('swap:reader'));
  gates.get('reader').resolve();
  await first;
  assert.equal(draft.cleanups, 1, '有效响应在首次 DOM 变更前只清理一次草稿');
  assert.equal(historyWrites, 1, '有效 full 响应才写一次 history');
  assert.ok(events.indexOf('draft-commit') < events.indexOf('plugin-dispose')
    && events.indexOf('plugin-dispose') < events.indexOf('protocol')
    && events.indexOf('protocol') < events.indexOf('plugin-stage')
    && events.indexOf('plugin-stage') < events.indexOf('swap:reader'),
  'full 提交许可必须早于插件销毁、持久协议和 DOM 切换');
  assert.equal(events.filter((event) => event === 'css-stage:reader').length, 2, '响应资源就绪后仍须在 DOM 替换前再次 staging');
  assert.ok(events.lastIndexOf('css-stage:reader') < events.indexOf('swap:reader'));
  await context.pjax.loadUrl('/photos');
  const photosOptions = requests.get('/photos');
  assert.equal(photosOptions.__themeNavigationIntent, 2);
  assert.ok(events.includes('html-start:/photos'), '没有缓存 CSS/JS 的冷页面也必须立即开始 HTML 请求');
  const stale = context.pjax.handleResponse('photos', { status: 200 }, '/photos', photosOptions);
  await flush();
  assert.ok(!events.includes('swap:photos'), '冷页面 HTML 已返回仍须等待资产后才能替换 DOM');
  await context.pjax.loadUrl('/links');
  assert.equal(requests.get('/links').__themeNavigationIntent, 3);
  await stale;
  assert.ok(!events.includes('swap:photos'), '较旧导航取消后不得替换 DOM');
  assert.ok(!events.includes('hard:/photos'), '取消不能触发旧导航的硬刷新');
  const cleanupsBeforeFailure = draft.cleanups;
  const linksGateResult = context._fullAssetGate.promise;
  gates.get('links').reject(new Error('module download failed'));
  assert.equal(await linksGateResult, false, '当前资源失败必须可控地结束 asset gate');
  assert.ok(!events.includes('hard:/links'), '尚未替换 DOM 的资源失败必须保留源页与草稿');
  assert.ok(!events.includes('swap:links'));
  assert.equal(draft.cleanups, cleanupsBeforeFailure, '资源失败不得额外清理草稿');
  assert.equal(events.at(-1), 'theme:navigation-settled', '资源失败必须结束已接受的 intent');
  assert.equal(warmStyle.disabled, false, '资源失败必须恢复当前 reader 页的 CSS');
  assert.equal(currentStyle.disabled, true, '资源失败不能重新启用旧 categories 页的 CSS');
  assert.equal(historyWrites, 1, '旧请求及当前资产失败均不得新增 history entry');

  await context.pjax.loadUrl('/docs');
  const docsOptions = requests.get('/docs');
  const waitingResponse = context.pjax.handleResponse('docs', { status: 200 }, '/docs', docsOptions);
  await flush();
  const protocolCount = events.filter((event) => event === 'protocol').length;
  const swapCount = events.filter((event) => event.startsWith('swap:')).length;
  const cleanupsBeforeChange = draft.cleanups;
  draft.version++;
  gates.get('docs').resolve();
  await waitingResponse;
  assert.equal(events.filter((event) => event === 'protocol').length, protocolCount,
    '等待资源期间草稿变化后不得覆盖持久桌面协议');
  assert.equal(events.filter((event) => event.startsWith('swap:')).length, swapCount,
    '等待资源期间草稿变化后不得切换 DOM');
  assert.equal(draft.cleanups, cleanupsBeforeChange, '等待期间新草稿不得被旧许可清理');
  assert.equal(warmStyle.disabled, false, '许可撤回后必须恢复源页 CSS');
  assert.equal(historyWrites, 1, '资源失败与许可撤回均不得写入额外 history entry');

  const sameTarget = '/photos';
  const previousSameRequest = requests.get(sameTarget);
  const votesBeforeSame = votes;
  const acceptedBeforeSame = events.filter((event) => event === 'theme:navigation-accepted').length;
  const intentBeforeSame = context.navigationIntentGeneration;
  draft.allowed = false;
  assert.equal(await vm.runInContext(`navigateWithinVariant('${sameTarget}')`, context), false,
    'same-variant 否决应保持当前内容');
  assert.equal(votes, votesBeforeSame + 1, 'same-variant 必须只投票一次');
  assert.equal(context.navigationIntentGeneration, intentBeforeSame, 'same-variant 否决不得占用 intent');
  assert.equal(events.filter((event) => event === 'theme:navigation-accepted').length, acceptedBeforeSame);
  assert.equal(requests.get(sameTarget), previousSameRequest,
    'same-variant 否决不得重发先前目标的 full 请求');

  draft.allowed = true;
  ready.add('photos');
  await vm.runInContext(`navigateWithinVariant('${sameTarget}')`, context);
  assert.equal(votes, votesBeforeSame + 2,
    'same-variant 缺少内容根节点回退 full 时不得再次投票');
  assert.equal(events.filter((event) => event === 'theme:navigation-accepted').length, acceptedBeforeSame + 1,
    'same→full 是一个逻辑导航，只能发送一次 accepted');
  assert.notEqual(requests.get(sameTarget), previousSameRequest,
    'same→full 回退仍必须发起实际 full 请求');
  assert.equal(requests.get(sameTarget).__themeNavigationIntent, context.activeNavigation.intentId,
    'same→full 必须把原 intent 注入 full 请求，不能新建第二个逻辑 intent');
  assert.equal(context.activeNavigation.mode, 'full');
  assert.equal(historyWrites, 1, '尚未收到回退 full 响应时不得提前提交 history');

  const swapsBeforeLogin = events.filter((event) => event.startsWith('swap:')).length;
  await context.pjax.handleResponse('auth', { status: 200 }, sameTarget, requests.get(sameTarget));
  assert.ok(events.includes(`hard:${sameTarget}`), '登录响应必须沿已获准的原生导航重新进入目标');
  assert.ok(!events.includes('assets:auth'), '登录响应不得在旧桌面加载 Auth 并绑定旧 body');
  assert.equal(events.filter((event) => event.startsWith('swap:')).length, swapsBeforeLogin,
    '登录表单不得作为普通应用 HTML 替换');
}

await verifyBuildIdentity();
await verifyBootstrapManifestReuse();
await verifyFreshnessEventRouting();
await verifyManifestTimeoutAndSharing();
await verifyParallelAssetsAndCancellation();
await verifyExistingAssetIdentity();
verifyWarmCssBuildIdentity();
verifyLifecycleFailures();
await verifyPrefetchFailure();
await verifyFullPjaxAssetGate();
console.log('resource/navigation hardening passed: identity, manifest deadline/sharing, parallel assets, warm CSS build identity, lifecycle recovery, prefetch, PJAX ordering/cancellation');
