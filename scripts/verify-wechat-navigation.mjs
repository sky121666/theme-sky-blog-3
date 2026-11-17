import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { navigationResponseAction } from '../src/shared/navigation-response.js';

async function verifyRejectedAdapterChunk() {
  const source = await readFile('src/shell/desktop-shell/runtime/desktop/pjax/index.js', 'utf8');
  const start = source.indexOf('pjax.handleResponse = async function(');
  const end = source.indexOf('\n    };\n\n    // Compatibility facade', start);
  assert.ok(start >= 0 && end > start, 'the actual full response handler must be extractable');
  const handlerSource = source.slice(start + 'pjax.handleResponse = '.length, end + '\n    }'.length);
  const results = [];
  for (const superseded of [false, true]) {
    const current = { intentId: 1, settled: false };
    const state = { active: current, failed: [], committed: 0, unhandled: [] };
    let rejectChunk;
    const chunk = new Promise((_, reject) => { rejectChunk = reject; });
    const doc = { body: { dataset: { pageMode: 'browser-detail' } }, querySelectorAll: () => [{}] };
    const context = vm.createContext({
      URL, navigationResponseAction,
      NAVIGATION_INTENT_OPTION: 'intent', FAILED_RESPONSE_OPTION: 'failed',
      navigationIntentGeneration: 1, activeNavigation: current,
      isCurrentNavigationIntent: (intent, generation) => intent === generation,
      isNavigationCurrent: (record) => state.active === record && !record.settled,
      resolveNavigationHref: (_request, href) => href,
      requiresCommerceDocumentNavigation: () => false,
      DOMParser: class { parseFromString() { return doc; } },
      requiresWechatShareDocumentNavigation: () => chunk,
      parsePageAppFromResponse: () => 'reader', isAuthenticationResponse: () => false,
      window: { location: new URL('https://fixture.invalid/a') }, document: doc,
      pjaxLog() {}, pjaxWarn() {}, _fullAssetGate: null,
      ensureCommentDraftGuard: async () => {}, ensureAppAssetsLoaded: async () => {},
      stageAppCssForNavigation() {},
      failNavigation(record, reason) { state.failed.push({ intentId: record.intentId, reason }); record.settled = true; return false; },
      handoffNavigation() { state.committed += 1; },
      commitAcceptedNavigation() { state.committed += 1; return true; },
      syncHomeDesktopWidgetProtocolFromResponse() {}, preparePluginCompatibilityFromResponse() {},
      _origHandleResponse() { state.committed += 1; }, stopTopProgress() {}
    });
    const handler = vm.runInContext(`(${handlerSource})`, context);
    const onUnhandled = (error) => state.unhandled.push(error.message);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Invoke without a fixture-side catch: an optional adapter rejection
      // must be contained by the actual handler and preserve the active intent.
      void handler('<html><title>Target</title></html>', { status: 200 }, 'https://fixture.invalid/b', { intent: 1 });
      if (superseded) {
        state.active = { intentId: 2, settled: false };
        context.activeNavigation = state.active;
        context.navigationIntentGeneration = 2;
      }
      rejectChunk(new Error('fixture: adapter chunk download rejected'));
      await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
    const actual = { superseded, unhandled: state.unhandled, failed: state.failed,
      committed: state.committed, activeSettled: state.active.settled };
    const passed = actual.unhandled.length === 0 && actual.committed === 0
      && (superseded ? actual.failed.length === 0 && !actual.activeSettled
        : actual.failed.length === 1 && actual.failed[0].intentId === 1 && actual.activeSettled);
    results.push({ ...actual, passed });
  }
  const passed = results.every((result) => result.passed);
  await mkdir('output/plugin-pjax-20261114', { recursive: true });
  await writeFile(`output/plugin-pjax-20261114/wechat-chunk-rejection-${passed ? 'green' : 'red'}.json`,
    JSON.stringify({ observedAt: new Date().toISOString(), method: 'VM executes extracted current full-response handler; optional share import rejects', results }, null, 2) + '\n');
  assert.equal(passed, true, `full response must contain adapter-chunk rejection and preserve newer intents: ${JSON.stringify(results)}`);
  console.log('PASS 2 actual full-response adapter chunk rejection scenarios (current / superseded intent)');
}

await verifyRejectedAdapterChunk();
if (process.argv.includes('--chunk-only')) process.exit(0);

// The real initPjax, Swup, admission, history, response parsing and sharing
// modules are bundled unchanged. Only app lifecycle content and the external SDK
// are fixtures; every request stays on an intercepted, isolated origin.
const bundle = await build({
  stdin: {
    contents: `
      import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
      import { markAppAssetsLoaded } from './src/shell-core/runtime/app-loader.js';
      import { registerPageAppLifecycle, activateCurrentPageApp } from './src/shell/desktop-shell/runtime/shared/page-app.js';
      window.__startWechatNavigationFixture = (local) => {
        for (const app of ['links', 'reader']) markAppAssetsLoaded(app);
        registerPageAppLifecycle('links', {
          resolveProtocol(root) { return { root: root.querySelector('[data-app-root="links"]') || root }; },
          prepareLocalNavigation(root, { url }) {
            if (!local || new URL(url, location.href).pathname !== '/links') return null;
            return () => {
              document.title = 'Local target';
              root.dataset.localTarget = url;
              return window.__browserSyncUiHistoryState({ url, title: document.title });
            };
          }
        });
        window.Alpine = {
          store: () => ({ show: true, minimized: false, showDesktop() {}, revealAfterNavigation() {} }),
          nextTick: async () => {}, initTree() {}
        };
        activateCurrentPageApp(document);
        initPjax(window.Alpine);
      };`,
    resolveDir: process.cwd()
  }, bundle: true, write: false, format: 'iife', logLevel: 'silent'
});

const origin = 'https://wechat-navigation.test';
const sdkUrl = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
const sourcePath = '/links?source=a';
const samePath = '/links?view=friends&scope=all';
const fullPath = '/archives/post-b';
const sdk = `window.__sdk = { configs: [], shares: [] }; window.wx = {
  config(data) { __sdk.configs.push({ data, href: location.href }); },
  ready(callback) { callback(); }, error() {},
  updateAppMessageShareData(data) { __sdk.shares.push({ ...data, href: location.href }); },
  updateTimelineShareData() {}
};`;

function script(label, path) {
  const data = JSON.stringify({
    config: { appId: 'wxFixtureOnly', debug: false, timestamp: 1794624000,
      nonceStr: `fixture-${label}`, signature: label.toLowerCase().repeat(40),
      jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'] },
    share: { title: label, desc: `Page ${label}`, link: origin + path, imgUrl: '' }
  });
  return `<script>
(function () {
    if (!/MicroMessenger|QQ\\//i.test(navigator.userAgent)) return;
    var data = ${data};
    function configure() {
        wx.config(data.config);
        wx.ready(function () {
            wx.updateAppMessageShareData(data.share);
            wx.updateTimelineShareData(data.share);
        });
        wx.error(function (error) {
            console.error("Wechat JS-SDK config error:", error);
        });
    }
    if (window.wx) {
        configure();
    } else {
        var sdk = document.createElement("script");
        sdk.src = "${sdkUrl}";
        sdk.async = true;
        sdk.onload = configure;
        document.head.appendChild(sdk);
    }
})();
</script>`;
}

function html(label, path, { signed = true } = {}) {
  const reader = path.startsWith('/archives/');
  const app = reader ? 'reader' : 'links';
  const variant = reader ? 'browser' : 'links';
  const mode = reader ? 'browser-detail' : 'browser-links';
  return `<!doctype html><html><head><title>Page ${label}</title>
    ${['links', 'reader'].map((app) => `<link rel="stylesheet" data-app-css="${app}" href="/assets/css/apps/${app}/index.css">
    <script type="application/json" data-app-script="${app}" data-app-script-state="ready" data-src="/assets/js/apps/${app}/index.js"></script>`).join('')}
    ${signed ? script(label, path) : ''}</head>
    <body data-page-app="${app}" data-app-id="${app}" data-window-variant="${variant}" data-page-mode="${mode}">
    <main id="window-frame-root"><header class="window-titlebar"><span data-window-title>Page ${label}</span></header>
    <section data-window-content-root><div id="pjax-container" data-window-content-variant="${variant}">
    <article data-app-root="${app}" data-page-label="${label}">Page ${label}</article>
    </div></section></main></body></html>`;
}

const browser = await chromium.launch({ headless: true });
let passed = 0;
async function fixture(label, run, { local = false, responses = {} } = {}) {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0.0' });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ url: url.href, navigation: request.isNavigationRequest(), headers: await request.allHeaders() });
    if (url.href === sdkUrl) return route.fulfill({ contentType: 'text/javascript', body: sdk });
    if (url.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.origin !== origin) throw new Error(`Unexpected external request: ${url.href}`);
    const path = url.pathname + url.search;
    const response = responses[path] || {};
    if (response.delay) await new Promise((resolve) => setTimeout(resolve, response.delay));
    if (response.abort) return route.abort();
    return route.fulfill({ status: response.status || 200, contentType: 'text/html',
      body: response.body ?? html(path === sourcePath ? 'A' : 'B', path, { signed: response.signed !== false }) });
  });
  try {
    await page.goto(origin + sourcePath);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate((local) => {
      window.__probe = { id: crypto.randomUUID(), timeOrigin: performance.timeOrigin, outcomes: [], sends: [], root: document.getElementById('window-frame-root') };
      document.addEventListener('theme:navigation-settled', (event) => __probe.outcomes.push(event.detail));
      for (const type of ['pjax:send', 'pjax:same-variant-send']) document.addEventListener(type, () => __probe.sends.push(type));
      window.__startWechatNavigationFixture(local);
    }, local);
    await page.waitForFunction(() => window.pjax?.loadUrl && history.state?.__browserNavIndex === 0 && window.__sdk?.shares.at(-1)?.title === 'A');
    await run({ page, requests });
    assert.deepEqual(errors, [], `${label}: no browser runtime errors`);
    passed += 1;
    console.log(`PASS ${label}`);
  } finally { await context.close(); }
}

async function ready(page, path, share = 'B') {
  await page.waitForFunction(({ path, share }) => location.pathname + location.search === path
    && window.__probe?.outcomes.at(-1)?.outcome === 'ready'
    && window.__sdk?.shares.at(-1)?.title === share, { path, share });
  return page.evaluate(() => ({
    sameDocument: __probe.timeOrigin === performance.timeOrigin,
    sameFrame: __probe.root === document.getElementById('window-frame-root'),
    mode: __probe.outcomes.at(-1)?.mode,
    outcomes: __probe.outcomes.map((event) => event.outcome), sends: __probe.sends,
    config: __sdk.configs.at(-1), share: __sdk.shares.at(-1)
  }));
}

try {
  await fixture('full initPjax navigation updates signed sharing without a document reload', async ({ page, requests }) => {
    await page.evaluate((path) => { void pjax.loadUrl(path); }, fullPath);
    const state = await ready(page, fullPath);
    assert.equal(state.sameDocument, true);
    assert.equal(state.sameFrame, false, 'full Pjax must replace its real frame');
    assert.ok(state.sends.includes('pjax:send'));
    assert.equal(state.config.href, origin + fullPath, 'signature configuration must follow the committed URL');
    assert.equal(state.share.link, origin + fullPath);
    assert.equal(requests.filter((request) => request.navigation).length, 1);
  });

  await fixture('same-App initPjax navigation updates signed sharing and retains its frame', async ({ page, requests }) => {
    await page.evaluate((path) => { void pjax.loadUrl(path); }, samePath);
    const state = await ready(page, samePath);
    assert.equal(state.sameDocument, true);
    assert.equal(state.sameFrame, true);
    assert.deepEqual(state.sends, ['pjax:same-variant-send']);
    assert.equal(state.config.href, origin + samePath);
    assert.equal(state.share.link, origin + samePath);
    assert.equal(requests.filter((request) => request.navigation).length, 1);
  });

  await fixture('local initPjax query navigation prefetches and then commits signed sharing', async ({ page, requests }) => {
    await page.evaluate((path) => { void pjax.loadUrl(path); }, samePath);
    const state = await ready(page, samePath);
    assert.equal(state.sameDocument, true);
    assert.equal(state.sameFrame, true);
    assert.deepEqual(state.sends, [], 'the actual local owner must run without a full/same HTML executor');
    assert.equal(state.config.href, origin + samePath);
    assert.equal(state.share.link, origin + samePath);
    assert.equal(requests.filter((request) => request.url === origin + samePath && !request.navigation).length, 1);
    assert.equal(requests.filter((request) => request.navigation).length, 1);
  }, { local: true });

  await fixture('failed local signature preparation retains the committed page and share', async ({ page, requests }) => {
    await page.evaluate((path) => { void pjax.loadUrl(path); }, samePath);
    await page.waitForFunction(() => __probe.outcomes.at(-1)?.outcome === 'failed');
    const state = await page.evaluate(() => ({ path: location.pathname + location.search, share: __sdk.shares.at(-1).title,
      sameFrame: __probe.root === document.getElementById('window-frame-root'), outcomes: __probe.outcomes.map((event) => event.outcome) }));
    assert.deepEqual(state, { path: sourcePath, share: 'A', sameFrame: true, outcomes: ['failed'] });
    assert.equal(requests.filter((request) => request.navigation).length, 1);
  }, { local: true, responses: { [samePath]: { status: 503 } } });

  await fixture('superseded local signature preparation cannot overwrite a newer navigation', async ({ page, requests }) => {
    await page.evaluate(({ slow, fast }) => {
      void pjax.loadUrl(slow);
      setTimeout(() => { void pjax.loadUrl(fast); }, 10);
    }, { slow: '/links?p=slow', fast: '/links?p=fast' });
    const state = await ready(page, '/links?p=fast', 'C');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => __sdk.shares.at(-1).title), 'C');
    assert.equal(state.sameDocument, true);
    assert.ok(state.outcomes.includes('superseded'));
    assert.equal(requests.filter((request) => request.navigation).length, 1);
  }, { local: true, responses: {
    '/links?p=slow': { body: html('B', '/links?p=slow'), delay: 80 },
    '/links?p=fast': { body: html('C', '/links?p=fast') }
  } });

  for (const [mode, target] of [['full', fullPath], ['local', samePath], ['same', samePath]]) {
    await fixture(`missing target signature alone triggers necessary ${mode} document fallback`, async ({ page, requests }) => {
      await page.evaluate((target) => { sessionStorage.setItem('wechat-navigation-source', __probe.id); void pjax.loadUrl(target); }, target);
      try {
        await page.waitForFunction(() => !window.__probe && location.pathname + location.search !== '/links?source=a', undefined, { timeout: 3000 });
      } catch (_error) {
        const observed = await page.evaluate(() => ({ path: location.pathname + location.search,
          outcomes: window.__probe?.outcomes, sends: window.__probe?.sends, share: window.__sdk?.shares.at(-1)?.title }));
        assert.fail(`${mode}: unsigned target did not reach native fallback: ${JSON.stringify(observed)}`);
      }
      assert.equal(await page.evaluate(() => location.pathname + location.search), target);
      assert.equal(requests.filter((request) => request.navigation).length, 2);
      assert.equal(await page.evaluate(() => Boolean(window.wx)), false, 'a fresh unsigned document must not inherit old SDK share state');
    }, { local: mode === 'local', responses: { [target]: { signed: false } } });
  }
  console.log(`PASS ${passed} real initPjax WeChat navigation scenarios (fixture app lifecycles and SDK only)`);
} finally { await browser.close(); }
