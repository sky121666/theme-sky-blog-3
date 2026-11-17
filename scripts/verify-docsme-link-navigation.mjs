import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeSource = await readFile(path.join(root, 'src/apps/docsme/runtime.js'), 'utf8');
const runtimeBundle = await build({
  stdin: {
    contents: `${runtimeSource}
      import Alpine from 'alpinejs';
      import { initPjax } from '../../shell/desktop-shell/runtime/desktop/pjax/index.js';
      import { markAppAssetsLoaded } from '../../shell-core/runtime/app-loader.js';
      import { runPageAppRegistrars, activateCurrentPageApp } from '../../shell/desktop-shell/runtime/shared/page-app.js';
      import './hydrate.js';
      window.__verifyDocsmeLinks = enhanceDocsmeLinks;
      window.__verifyDocsmeRegister = registerDocsmeApp;
      window.__verifyDocsmeStart = () => {
        window.Alpine = Alpine;
        Alpine.store('windowManager', { show: true, minimized: false, showDesktop() {}, revealAfterNavigation() {} });
        markAppAssetsLoaded('docsme');
        runPageAppRegistrars(Alpine);
        Alpine.start();
        window.__THEME_ALPINE_STARTED__ = true;
        activateCurrentPageApp(document);
        initPjax(Alpine);
      };
    `,
    resolveDir: path.join(root, 'src/apps/docsme'),
    sourcefile: 'docsme-link-fixture.js',
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent'
});
const browser = await chromium.launch();
const appHtml = `
  <div class="docsme-app" data-app-root="docsme" x-data="docsmeApp" data-docsme-scene="document">
    <a id="prebound" class="pjax-link" data-pjax-state="load" data-pjax-attached="true" href="/docs/already">已缓存</a>
    <a id="fresh" href="/docs/next">下一篇</a>
    <a id="download" href="/docs/export" download>下载</a>
    <a id="top" href="/docs/top" target="_top">顶层页面</a>
    <a id="hash" href="#section">本页章节</a>
    <a id="outside" href="https://outside.test/docs/next">外部文档</a>
    <a id="other-app" href="/links">其它应用</a>
    <a id="base-inherited" href="/docs/base">继承 base target</a>
    <a id="base-empty" href="/docs/self" target="">显式覆盖 base target</a>
    <main class="docsme-main"><article class="docsme-article"><h1>Docs</h1><h2 id="section">章节</h2></article></main>
  </div>`;

function html(url) {
  return `<!doctype html><html><head><title>Docs</title>
    <link rel="stylesheet" data-app-css="docsme" href="/assets/css/apps/docsme/index.css">
    <script type="application/json" data-app-script="docsme" data-app-script-state="ready" data-src="/assets/js/apps/docsme/index.js"></script>
    </head><body data-page-app="docsme" data-app-id="docsme" data-window-variant="docsme" data-page-mode="browser-docsme">
    <main id="window-frame-root"><header class="window-titlebar"><span data-window-title>Docs</span></header>
    <section data-window-content-root><div id="pjax-container" data-window-content-variant="docsme" data-page-label="${url}">${appHtml}</div></section></main>
    </body></html>`;
}

try {
  const page = await browser.newPage();
  const pageErrors = [];
  const requests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://theme.test/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/assets/')) return route.fulfill({
      contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: ''
    });
    if (!request.isNavigationRequest()) requests.push({ url: request.url(), method: request.method() });
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html(pathname)
    });
  });
  // Bundle the real runtime and its shared policy before exposing the private
  // enhancer in this isolated browser fixture.
  await page.goto('https://theme.test/docs/current');
  await page.addScriptTag({
    content: runtimeBundle.outputFiles[0].text
  });
  await page.waitForFunction(() => typeof window.__verifyDocsmeLinks === 'function');

  const decorated = await page.evaluate(async () => {
    history.replaceState({}, '', '/docs/current');
    document.head.insertAdjacentHTML('beforeend', '<base href="https://theme.test/docs/current">');
    const app = document.querySelector('.docsme-app');
    for (const id of ['base-inherited', 'base-empty']) document.getElementById(id).remove();
    // The enhancer must work before window.pjax exists and remain idempotent.
    window.__verifyDocsmeLinks(app);
    window.__verifyDocsmeLinks(app);
    document.querySelector('base').setAttribute('target', '_blank');
    app.insertAdjacentHTML('beforeend', `
      <a id="base-inherited" href="/docs/base">继承 base target</a>
      <a id="base-empty" href="/docs/self" target="">显式覆盖 base target</a>`);
    window.__verifyDocsmeLinks(app);
    const state = (id) => {
      const link = document.getElementById(id);
      return { pjaxClass: link.classList.contains('pjax-link'), app: link.dataset.pjaxApp || null };
    };
    const links = Object.fromEntries([
      'prebound', 'fresh', 'download', 'top', 'hash', 'outside', 'other-app', 'base-inherited', 'base-empty'
    ].map((id) => [id, state(id)]));

    window.__docsmeCalls = [];
    window.__docsmeNative = [];
    window.__docsmeReady = [];
    window.__docsmeVisits = 0;
    document.addEventListener('click', event => {
      window.__docsmeTriggerId = event.target.closest('a')?.id;
    });
    document.addEventListener('theme:navigation-accepted', ({ detail }) => {
      window.__docsmeCalls.push({ href: detail.url, id: window.__docsmeTriggerId });
    });
    document.addEventListener('theme:pjax-ready', ({ detail }) => window.__docsmeReady.push(detail.intentId));
    document.addEventListener('swup:visit:end', () => window.__docsmeVisits++);
    window.__verifyDocsmeStart();
    // Observe native eligibility before preventing real fixture navigation.
    window.addEventListener('click', (event) => {
      window.__docsmeNative.push({ preventedBeforeSink: event.defaultPrevented });
      event.preventDefault();
    });
    return { links };
  });
  await page.waitForFunction(() => window.pjax?.loadUrl && window.swup);
  const client = await page.evaluate(() => ({ version: window.swup.version, linkSelector: window.swup.options.linkSelector }));
  assert.equal(client.version, '4.10.0', 'the fixture must execute the real pinned Swup client');
  assert.equal(client.linkSelector, 'a:not(*)', 'Swup must leave link ownership to the theme click controller');
  for (const id of ['prebound', 'fresh', 'base-empty']) {
    assert.deepEqual(decorated.links[id], { pjaxClass: true, app: 'docsme' }, `${id} must opt into Docsme navigation`);
  }
  for (const id of ['download', 'top', 'hash', 'outside', 'other-app', 'base-inherited']) {
    assert.deepEqual(decorated.links[id], { pjaxClass: false, app: null }, `${id} must keep native or other-app behavior`);
  }

  const click = async (id) => {
    const before = await page.evaluate(() => ({
      calls: window.__docsmeCalls.length, ready: window.__docsmeReady.length, visits: window.__docsmeVisits
    }));
    const requestCount = requests.length;
    await page.click(`#${id}`);
    const accepted = await page.evaluate(() => window.__docsmeCalls.length);
    if (accepted > before.calls) {
      await page.waitForFunction(ready => window.__docsmeReady.length === ready + 1, before.ready).catch(async error => {
        error.message += ` (${id}: ${JSON.stringify(await page.evaluate(() => ({
          url: location.href, calls: window.__docsmeCalls, ready: window.__docsmeReady
        })))}, requests: ${JSON.stringify(requests)}, errors: ${JSON.stringify(pageErrors)})`;
        throw error;
      });
      await page.waitForFunction(() => !window.swup.navigating);
    }
    const actual = await page.evaluate(({ calls, visits }) => ({
      calls: window.__docsmeCalls.length - calls,
      visits: window.__docsmeVisits - visits,
      sink: window.__docsmeNative.at(-1),
      last: window.__docsmeCalls.at(-1)
    }), before);
    return { ...actual, requests: requests.length - requestCount };
  };
  const expectManaged = async (id) => {
    const result = await click(id);
    assert.equal(result.calls, 1, `${id} must reach the delegated click owner exactly once`);
    assert.equal(result.requests, 1, `${id} must start exactly one real document request`);
    assert.equal(result.visits, 1, `${id} must complete exactly one real Swup visit`);
    assert.equal(result.sink.preventedBeforeSink, true, `${id} must be claimed synchronously`);
    assert.equal(result.last.id, id, `${id} must preserve its trigger element`);
  };
  const expectNative = async (id) => {
    const result = await click(id);
    assert.equal(result.calls, 0, `${id} must not enter the theme navigation controller`);
    assert.equal(result.requests, 0, `${id} must not start a document request`);
    assert.equal(result.visits, 0, `${id} must not start a Swup visit`);
    assert.equal(result.sink.preventedBeforeSink, false, `${id} must remain native`);
  };
  await expectManaged('base-empty');
  await expectNative('base-inherited');
  await page.evaluate(() => {
    document.querySelector('base').remove();
    window.__verifyDocsmeLinks(document.querySelector('.docsme-app'));
  });
  for (const id of ['fresh', 'prebound']) await expectManaged(id);
  for (const id of ['download', 'top', 'hash', 'outside', 'other-app']) await expectNative(id);

  const dynamic = await page.evaluate(() => {
    const app = document.querySelector('.docsme-app');
    app.insertAdjacentHTML('beforeend', '<a id="dynamic" href="/docs/later">后插入文档链接</a>');
    window.__verifyDocsmeLinks(app);
    window.__verifyDocsmeLinks(app);
    const link = document.getElementById('dynamic');
    return { pjaxClass: link.classList.contains('pjax-link'), app: link.dataset.pjaxApp };
  });
  assert.deepEqual(dynamic, { pjaxClass: true, app: 'docsme' });
  await expectManaged('dynamic');

  const lifecycle = await page.evaluate(() => {
    const app = document.querySelector('.docsme-app');
    Alpine.destroyTree(app);
    let factory = null;
    window.__verifyDocsmeRegister({ data(name, candidate) {
      if (name === 'docsmeApp') factory = candidate;
    } });
    const model = factory();
    model.$root = app;
    model.init();
    const snapshot = () => ({
      intentId: model._docsmeNavigationIntentId ?? null,
      loading: app.classList.contains('is-pjax-loading'),
      suspended: app._docsmeRichContentSuspended === true,
      generation: app._docsmeRichContentGeneration || 0,
      hasController: Boolean(app._docsmeRichContentController),
      controllerAborted: app._docsmeRichContentController?.signal.aborted === true
    });
    const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));
    const initial = snapshot();
    emit('theme:navigation-accepted', { intentId: 1, url: '/docs/next' });
    const accepted = snapshot();
    emit('theme:navigation-accepted', { intentId: 1, url: '/docs/next' });
    const duplicate = snapshot();
    emit('theme:navigation-accepted', { intentId: 2, url: '/docs/later' });
    const newer = snapshot();
    emit('theme:navigation-settled', { intentId: 1, outcome: 'failed' });
    const staleFailure = snapshot();
    emit('theme:pjax-ready', { intentId: 1, appId: 'docsme' });
    const staleReady = snapshot();
    emit('theme:navigation-settled', { intentId: 2, outcome: 'superseded' });
    const superseded = snapshot();
    emit('theme:navigation-settled', { intentId: 2, outcome: 'failed' });
    const restored = snapshot();
    emit('theme:navigation-accepted', { intentId: 3, url: '/docs/third' });
    const thirdAccepted = snapshot();
    emit('theme:pjax-ready', { intentId: 3, appId: 'docsme' });
    const ready = snapshot();
    emit('theme:navigation-settled', { intentId: 3, outcome: 'ready' });
    const readySettled = snapshot();
    emit('theme:navigation-accepted', { intentId: 4, url: '/docs/fourth' });
    emit('theme:navigation-settled', { intentId: 4, outcome: 'cancelled' });
    const cancelled = snapshot();
    emit('theme:navigation-accepted', { intentId: 5, url: '/docs/fifth' });
    emit('theme:navigation-settled', { intentId: 5, outcome: 'native' });
    const native = snapshot();
    emit('theme:navigation-accepted', { intentId: 6, url: '/archives' });
    const leavingApp = snapshot();
    emit('theme:navigation-settled', { intentId: 6, outcome: 'failed' });
    const leavingFailed = snapshot();
    model.destroy();
    const destroyed = snapshot();
    emit('theme:navigation-accepted', { intentId: 7, url: '/docs/seventh' });
    const afterDestroy = snapshot();
    return { initial, accepted, duplicate, newer, staleFailure, staleReady, superseded, restored, thirdAccepted, ready, readySettled, cancelled, native, leavingApp, leavingFailed, destroyed, afterDestroy };
  });
  assert.deepEqual(
    { intentId: lifecycle.accepted.intentId, loading: lifecycle.accepted.loading, suspended: lifecycle.accepted.suspended },
    { intentId: 1, loading: true, suspended: true },
    'accepted Docsme navigation must suspend source rendering once'
  );
  assert.equal(lifecycle.accepted.generation, lifecycle.initial.generation + 1, 'accepted intent must cancel the active rich-content generation');
  assert.equal(lifecycle.leavingApp.loading, false, 'leaving Docsme must use the global feedback without a duplicate document progress line');
  assert.equal(lifecycle.leavingApp.suspended, true, 'leaving must still suspend source rich-content work');
  assert.equal(lifecycle.leavingFailed.suspended, false, 'a failed cross-app visit must recover the original rich-content lifecycle');
  assert.equal(lifecycle.duplicate.generation, lifecycle.accepted.generation, 'duplicate accepted intent must not cancel twice');
  assert.equal(lifecycle.newer.intentId, 2, 'a newer accepted intent must own Docsme loading');
  for (const state of [lifecycle.staleFailure, lifecycle.staleReady, lifecycle.superseded]) {
    assert.equal(state.intentId, 2, 'old or superseded events must not release the current intent');
    assert.equal(state.loading, true, 'old or superseded events must not clear current loading');
    assert.equal(state.suspended, true, 'old or superseded events must not restart source rendering');
  }
  assert.deepEqual(
    { intentId: lifecycle.restored.intentId, loading: lifecycle.restored.loading, suspended: lifecycle.restored.suspended, hasController: lifecycle.restored.hasController, controllerAborted: lifecycle.restored.controllerAborted },
    { intentId: null, loading: false, suspended: false, hasController: true, controllerAborted: false },
    'current failure must restore only the still-present source page'
  );
  assert.equal(lifecycle.thirdAccepted.loading, true, 'next intent must enter loading');
  assert.deepEqual(
    { intentId: lifecycle.ready.intentId, loading: lifecycle.ready.loading, suspended: lifecycle.ready.suspended, hasController: lifecycle.ready.hasController },
    { intentId: null, loading: false, suspended: false, hasController: false },
    'ready must clear loading without re-enhancing the outgoing Docsme root'
  );
  assert.deepEqual(lifecycle.readySettled, lifecycle.ready, 'settled(ready) must not run enhancement again');
  for (const state of [lifecycle.cancelled, lifecycle.native]) {
    assert.deepEqual(
      { intentId: state.intentId, loading: state.loading, suspended: state.suspended, hasController: state.hasController },
      { intentId: null, loading: false, suspended: false, hasController: true },
      'cancelled and native handoffs must restore the still-present source page'
    );
  }
  assert.deepEqual(lifecycle.afterDestroy, lifecycle.destroyed, 'destroy must remove all theme navigation subscriptions');
  assert.deepEqual(pageErrors, [], 'Docsme fixture must not emit browser errors');
  console.log('Docsme links and intent-scoped navigation lifecycle passed');
} finally {
  await browser.close();
}
