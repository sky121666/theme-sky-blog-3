import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { verificationOutput } from './lib/verification-output.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { verifyDocsmePreloadRepair } from './lib/docsme-preload-cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await verificationOutput('docsme-swup');
const origin = 'https://docs-swup.test';
const source = '/docs/current';
const timeoutProof = process.argv.includes('--timeout-proof');
const partialProof = process.argv.includes('--partial-proof');
const saveDataResponseProof = process.argv.includes('--save-data-response-proof');
const repairOnly = process.argv.includes('--repair-only');
const caseFilter = process.env.DOCS_SWUP_CASE || (timeoutProof ? 'a caller timeout' : partialProof ? 'a partial 206' : saveDataResponseProof ? 'Save-Data foreground' : '');
const supplementOnly = process.argv.includes('--supplement-only') || timeoutProof || partialProof || saveDataResponseProof;
// This is the actual theme coordinator, Docsme runtime, lifecycle and Alpine.
// HTTP documents and the comment form's external component are the fixture
// boundary. Swup and its official PreloadPlugin are never replaced.
const bundle = await build({
  stdin: { resolveDir: root, contents: `
    import Alpine from 'alpinejs';
    import { fetchDocsPage } from './src/shared/docs-swup.js';
    import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
    import { markAppAssetsLoaded } from './src/shell-core/runtime/app-loader.js';
    import { runPageAppRegistrars, activateCurrentPageApp, registerPageAppLifecycle } from './src/shell/desktop-shell/runtime/shared/page-app.js';
    import './src/apps/docsme/hydrate.js';
    window.__startDocs = async () => {
      window.Alpine = Alpine;
      Alpine.store('windowManager', { show: true, minimized: false, showDesktop() {}, revealAfterNavigation() {} });
      for (const app of ['docsme', 'reader']) markAppAssetsLoaded(app);
      registerPageAppLifecycle('reader', { resolveProtocol(root) { return { root }; } });
      runPageAppRegistrars(Alpine);
      Alpine.start();
      window.__THEME_ALPINE_STARTED__ = true;
      activateCurrentPageApp(document);
      await Alpine.nextTick();
    };
    window.__startPjax = () => initPjax(Alpine);
    window.__fetchDocsPage = fetchDocsPage;
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent'
});

function html(urlPath) {
  const app = urlPath.startsWith('/docs/') ? 'docsme' : 'reader';
  const variant = app === 'docsme' ? 'docsme' : 'browser';
  const article = app === 'docsme' ? `
    <article class="docsme-app" data-app-root="docsme" x-data="docsmeApp" data-docsme-scene="document" data-page-label="${urlPath}">
      <nav class="docsme-tree"><a id="next" href="/docs/next">下一篇</a>
      <a id="q-one" href="/docs/query?edition=one">版本一</a><a id="q-two" href="/docs/query?edition=two">版本二</a>
      <a id="retry" href="/docs/retry">重试</a><a id="slow" href="/docs/slow">慢页面</a>
      <a id="fast" href="/docs/fast">快页面</a><a id="other" class="pjax-link" data-pjax-app="reader" href="/archives/post">文章</a>
      <a id="hash" href="#section">本页章节</a></nav>
      <main class="docsme-main"><div class="docsme-article"><h1>${urlPath}</h1><h2 id="section">章节</h2><p>真实 Docsme 内容生命周期。</p></div></main>
      <div data-lazy-comment><base-form id="fixture-draft"></base-form></div>
    </article>` : `<article data-app-root="reader" data-page-label="${urlPath}"><h1>文章</h1><a class="pjax-link" data-pjax-app="docsme" href="/docs/current">文档</a></article>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${urlPath}</title>
    <style>.docsme-main{min-height:400px}a{display:inline-block;padding:8px}</style>
    ${['docsme', 'reader'].map(id => `<link rel="stylesheet" data-app-css="${id}" href="/assets/css/apps/${id}/index.css"><script type="application/json" data-app-script="${id}" data-app-script-state="ready" data-src="/assets/js/apps/${id}/index.js"></script>`).join('')}
    </head><body data-page-app="${app}" data-app-id="${app}" data-window-variant="${variant}" data-page-mode="${app === 'docsme' ? 'browser-docsme' : 'browser-reader'}">
    <main id="window-frame-root"><header class="window-titlebar"><span data-window-title>${urlPath}</span></header><section data-window-content-root><div id="pjax-container" data-window-content-variant="${variant}">${article}</div></section></main></body></html>`;
}

const browser = await chromium.launch({ headless: true });
const results = [];

async function fixture(name, run, { reducedMotion = 'no-preference', responses = {}, touch = false, saveData = false, httpRedirect = false, documents = 1 } = {}) {
  if (caseFilter && !name.includes(caseFilter)) return;
  const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, reducedMotion, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const requests = [], errors = [], counts = new Map();
  const result = { name };
  page.on('pageerror', error => errors.push(error.message));
  // Playwright only routes the first URL in a redirect chain. Exercise real
  // browser redirects on a loopback server rather than mocking response.url.
  let server, fixtureOrigin = origin;
  if (httpRedirect) {
    server = createServer((req, res) => {
      const key = req.url;
      const item = responses[key] || {};
      const asset = key.startsWith('/assets/');
      if (!asset) requests.push({ path: key, navigation: req.headers['sec-fetch-mode'] === 'navigate' });
      res.writeHead(item.status || 200, { 'content-type': asset ? (key.endsWith('.css') ? 'text/css' : 'text/javascript') : 'text/html',
        'cache-control': 'max-age=60', ...item.headers });
      res.end(asset ? '' : item.body ?? html(key));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    fixtureOrigin = 'http://127.0.0.1:' + server.address().port;
  } else await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, 'All requests must stay on the isolated fixture origin');
    assert.equal(request.method(), 'GET', 'The fixture must never write business data');
    if (url.pathname.startsWith('/assets/')) return route.fulfill({
      contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: ''
    });
    const key = url.pathname + url.search;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    requests.push({ path: key, navigation: request.isNavigationRequest(), count, at: Date.now() });
    const configured = responses[key];
    const response = typeof configured === 'function' ? configured(count) : configured || {};
    if (response.delay) await new Promise(resolve => setTimeout(resolve, response.delay));
    if (response.abort) return route.abort();
    await route.fulfill({ status: response.status || 200, contentType: response.contentType || 'text/html',
      headers: { 'cache-control': 'max-age=60', ...response.headers }, body: response.body ?? html(key) }).catch(error => {
      if (!/closed|disposed|handled|cancelled/i.test(error.message)) throw error;
    });
  });
  try {
    await page.goto(fixtureOrigin + source);
    // Playwright installs its own window click interceptor when its injected
    // selector engine is first used. Initialize that before measuring theme
    // listeners rather than misattributing it to Alpine or Swup.
    await page.locator('#next').count();
    await page.addScriptTag({ content: 'void 0;' });
    if (saveData) await page.evaluate(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } }));
    await page.evaluate(() => {
      window.__probe = { id: crypto.randomUUID(), frame: document.getElementById('window-frame-root'), docsRoot: document.querySelector('.docsme-app'), accepted: [], ready: [], settled: [], sends: [], history: [], listeners: [], animations: [] };
      const now = Date.now.bind(Date);
      window.__clockOffset = 0;
      Date.now = () => now() + window.__clockOffset;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if ((this === window || this === document) && ['click', 'popstate'].includes(type)) __probe.listeners.push({ type, target: this === window ? 'window' : 'document', name: listener.name, stack: new Error().stack, listener: String(listener).slice(0, 800) });
        return add.call(this, type, listener, options);
      };
      for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function(...args) { __probe.history.push({ method, url: args[2] }); return original.apply(this, args); };
      }
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.docsme-main')) {
          const record = { target: this.closest('[data-page-label]')?.dataset.pageLabel, duration: animation.effect.getTiming().duration, cancelled: false, finished: false, animation };
          animation.finished.then(() => { record.finished = true; }, () => { record.cancelled = true; });
          __probe.animations.push(record);
        }
        return animation;
      };
      customElements.define('base-form', class extends HTMLElement {
        content = '';
        getDraftSnapshot() { return { key: 'isolated-doc-draft', storedDraft: this.content, revision: 1, content: this.content, hidden: false }; }
      });
      window.confirm = () => { __probe.confirms = (__probe.confirms || 0) + 1; return false; };
      for (const [type, key] of [['theme:navigation-accepted', 'accepted'], ['theme:pjax-ready', 'ready'], ['theme:navigation-settled', 'settled']]) document.addEventListener(type, event => __probe[key].push(event.detail));
      for (const type of ['pjax:same-variant-send', 'pjax:send']) document.addEventListener(type, () => __probe.sends.push(type));
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.__startDocs());
    await page.waitForTimeout(120);
    result.docsStartup = await page.evaluate(() => {
      __probe.docsSwup = window.swup;
      return { history: __probe.history.slice(), listeners: __probe.listeners.slice() };
    });
    await page.evaluate(() => window.__startPjax());
    await page.waitForFunction(() => Boolean(window.pjax?.loadUrl && history.state?.__browserNavIndex === 0));
    await run({ page, requests, result, count: key => counts.get(key) || 0 });
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert.equal(requests.filter(request => request.navigation).length, documents, 'Only an expected native handoff may load a new document');
    result.passed = true;
    console.log(`PASS ${name}`);
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    result.requests = requests;
    result.errors = errors;
    result.observed = await page.evaluate(() => ({ href: location.href, labels: [...document.querySelectorAll('[data-page-label]')].map(node => node.dataset.pageLabel), accepted: window.__probe?.accepted, settled: window.__probe?.settled, animations: window.__probe?.animations.map(({ animation, ...record }) => ({ ...record, playState: animation.playState })) })).catch(() => null);
    results.push(result);
    await context.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

async function ready(page, pathname) {
  await page.waitForFunction(pathname => location.pathname + location.search === pathname
    && __probe.settled.at(-1)?.outcome === 'ready'
    && document.querySelector('[data-page-label]')?.dataset.pageLabel === pathname, pathname);
}

try {
  if (repairOnly) await verifyDocsmePreloadRepair({ fixture, html, ready, origin, source });
  if (!supplementOnly && !repairOnly) {
  // Missing preload registration, URL de-duplication or shared in-flight
  // consumption must fail on actual HTTP count, before and after the click.
  await fixture('hover and focus preload once; click consumes the in-flight document', async ({ page, count }) => {
    await page.hover('#next');
    await page.focus('#next');
    await page.waitForTimeout(220);
    assert.equal(count('/docs/next'), 1, 'Hover/focus must issue exactly one real Docsme prefetch before click');
    await page.click('#next');
    await ready(page, '/docs/next');
    assert.equal(count('/docs/next'), 1, 'Click must reuse the in-flight Swup request');
    assert.equal(await page.evaluate(() => __probe.accepted.length), 1, 'One click must produce one accepted navigation');
  }, { responses: { '/docs/next': { delay: 500 } } });

  // Removing the committed-page transition must fail even while navigation
  // itself remains functional. Observe native WAAPI, never a fake animation.
  await fixture('committed Docsme page enters through native WAAPI', async ({ page }) => {
    await page.click('#next');
    await ready(page, '/docs/next');
    const animations = await page.evaluate(() => __probe.animations.map(({ target, duration }) => ({ target, duration })));
    assert.ok(animations.some(animation => animation.target === '/docs/next' && animation.duration === 160), 'Committed Docsme main must run its 160ms native enter transition');
  });

  if (!process.argv.includes('--red-proof')) {
    await fixture('Docsme preloading shares the global engine and never navigates on attention', async ({ page, result }) => {
      assert.equal(result.docsStartup.history.filter(entry => entry.method === 'pushState').length, 0,
        'Swup bootstrap must never create a forward history entry');
      assert.equal(await page.evaluate(() => __probe.docsSwup === window.swup), true,
        'Docsme and desktop navigation must use the same Swup instance');
      await page.evaluate(() => { __probe.history.length = 0; });
      await page.hover('#next');
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => __probe.history), [], 'Preloading must not write history');
      assert.equal(await page.evaluate(() => __probe.accepted.length), 0, 'Preloading must not start a visit');
      await page.click('#next');
      await ready(page, '/docs/next');
      assert.deepEqual(await page.evaluate(() => __probe.sends), ['pjax:same-variant-send']);
      assert.equal(await page.evaluate(() => __probe.accepted.length), 1);
    });

    await fixture('query variants keep separate cached documents', async ({ page, count }) => {
      await page.hover('#q-one');
      await page.waitForTimeout(220);
      await page.focus('#q-two');
      await page.waitForTimeout(220);
      assert.equal(count('/docs/query?edition=one'), 1);
      assert.equal(count('/docs/query?edition=two'), 1);
      await page.click('#q-one');
      await ready(page, '/docs/query?edition=one');
      await page.click('#q-two');
      await ready(page, '/docs/query?edition=two');
      assert.equal(count('/docs/query?edition=one'), 1, 'First query must reuse only its own cached page');
      assert.equal(count('/docs/query?edition=two'), 1, 'Second query must reuse only its own cached page');
    });

    await fixture('a draft guard veto retains its draft, DOM and URL after successful prefetch', async ({ page, count }) => {
      await page.evaluate(() => { document.querySelector('base-form').content = '未提交草稿'; });
      await page.hover('#next');
      await page.waitForTimeout(220);
      assert.equal(count('/docs/next'), 1);
      await page.click('#next');
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(() => ({ path: location.pathname, draft: document.querySelector('base-form')?.content, accepted: __probe.accepted.length, confirms: __probe.confirms })), { path: '/docs/current', draft: '未提交草稿', accepted: 0, confirms: 1 });
      assert.equal(count('/docs/next'), 1, 'Guard veto must not submit a second navigation request');
    });

    await fixture('failed prefetch can be retried and consumed by navigation', async ({ page, count }) => {
      await page.hover('#retry');
      await page.waitForTimeout(220);
      assert.equal(count('/docs/retry'), 1);
      await page.hover('h1');
      await page.focus('#retry');
      await page.waitForTimeout(220);
      assert.equal(count('/docs/retry'), 2, 'A failed preload must not poison future attempts');
      await page.click('#retry');
      await ready(page, '/docs/retry');
      assert.equal(count('/docs/retry'), 2, 'Successful retry must be reusable');
    }, { responses: { '/docs/retry': count => count === 1 ? { status: 503 } : {} } });

    await fixture('cross-app link retains the full PJAX executor', async ({ page, count }) => {
      await page.hover('#other');
      await page.waitForTimeout(220);
      assert.equal(count('/archives/post'), 1, 'Unified attention may preload the known public reader route');
      await page.click('#other');
      await ready(page, '/archives/post');
      assert.equal(count('/archives/post'), 1, 'The full cross-app executor must consume the same preloaded document');
      assert.deepEqual(await page.evaluate(() => __probe.sends), ['pjax:send']);
      assert.equal(await page.evaluate(() => __probe.animations.length), 0, 'Non-Docsme commit must not animate Docsme main');
    });

    await fixture('a superseded slow preload result cannot overwrite a newer commit', async ({ page }) => {
      await page.hover('#slow');
      await page.waitForTimeout(220);
      await page.click('#slow');
      await page.click('#fast');
      await ready(page, '/docs/fast');
      await page.waitForTimeout(650);
      assert.equal(await page.evaluate(() => document.querySelector('[data-page-label]')?.dataset.pageLabel), '/docs/fast');
      assert.equal(await page.evaluate(() => location.pathname), '/docs/fast');
      assert.equal(await page.evaluate(() => __probe.settled.at(-1)?.outcome), 'ready');
    }, { responses: { '/docs/slow': { delay: 700 } } });

    await fixture('native same-page hash and Back preserve the original document', async ({ page, count, result }) => {
      const hashBefore = await page.evaluate(() => ({ href: document.querySelector('#hash').getAttribute('href'), resolved: document.querySelector('#hash').href, accepted: __probe.accepted.slice() }));
      await page.click('#hash');
      await page.waitForFunction(() => location.hash === '#section');
      result.hash = { before: hashBefore, after: await page.evaluate(() => ({ accepted: __probe.accepted, settled: __probe.settled, sends: __probe.sends })) };
      assert.equal(result.hash.after.accepted.some(event => event.source === 'click'), false, 'Same-page fragment click must not be intercepted by a navigation click owner');
      assert.deepEqual(result.hash.after.sends, [], 'Native fragment state synchronization must not start an HTML executor');
      assert.equal(count('/docs/current'), 1, 'Native fragment navigation must not request its HTML again');
      assert.equal(await page.evaluate(() => __probe.docsRoot === document.querySelector('.docsme-app')), true, 'Native fragment navigation must retain the current Docsme root');
      await page.goBack();
      await page.waitForFunction(() => location.hash === '');
      await page.click('#next');
      await ready(page, '/docs/next');
      assert.equal(await page.evaluate(() => __probe.frame === document.getElementById('window-frame-root')), true, 'The forward same-app navigation must retain its shell frame');
      await page.goBack();
      await ready(page, '/docs/current');
      assert.equal(count('/docs/next'), 1);
      assert.equal(count('/docs/current'), 2, 'Back must perform exactly one request through the existing full PJAX history executor');
      assert.deepEqual(await page.evaluate(() => __probe.sends), ['pjax:same-variant-send', 'pjax:send']);
    });

    await fixture('reduced motion skips the Docsme enter transition', async ({ page }) => {
      await page.click('#next');
      await ready(page, '/docs/next');
      assert.equal(await page.evaluate(() => __probe.animations.length), 0);
    }, { reducedMotion: 'reduce' });

    await fixture('a newer accepted navigation cancels an active native enter transition', async ({ page }) => {
      // Freeze the genuine browser Animation after the ready event so its
      // cancellation remains deterministic even on a busy test machine.
      await page.evaluate(() => document.addEventListener('theme:pjax-ready', () => {
        queueMicrotask(() => __probe.animations.at(-1)?.animation.pause());
      }));
      await page.click('#next');
      await ready(page, '/docs/next');
      assert.equal(await page.evaluate(() => __probe.animations.length), 1, 'The first committed page must create a native animation');
      await page.click('#fast');
      await ready(page, '/docs/fast');
      assert.equal(await page.evaluate(() => __probe.animations[0].cancelled), true, 'The next accepted intent must cancel the previous animation');
      assert.equal(await page.evaluate(() => __probe.animations.length), 2);
    });
  }
  }

  if (supplementOnly) {
    await fixture('touch attention preloads once and tap consumes its in-flight document', async ({ page, count }) => {
      assert.equal(await page.evaluate(() => matchMedia('(hover: hover)').matches), false, 'Touch fixture must exercise the official plugin touch branch');
      await page.dispatchEvent('#next', 'touchstart', { bubbles: true, cancelable: true });
      await page.waitForTimeout(120);
      assert.equal(count('/docs/next'), 1, 'Touch attention must start a genuine preload request');
      await page.tap('#next');
      await ready(page, '/docs/next');
      assert.equal(count('/docs/next'), 1, 'Tap must consume the touch-started request');
    }, { touch: true, responses: { '/docs/next': { delay: 400 } } });

    await fixture('Save-Data suppresses speculation while click performs one foreground request', async ({ page, count }) => {
      await page.hover('#next');
      await page.focus('#next');
      await page.waitForTimeout(180);
      assert.equal(count('/docs/next'), 0, 'The real official plugin must honor Save-Data');
      await page.click('#next');
      await ready(page, '/docs/next');
      assert.equal(count('/docs/next'), 1, 'Explicit Save-Data navigation must fetch once');
    }, { saveData: true });

    await fixture('a cached document remains reusable before 20s and expires afterward', async ({ page, count }) => {
      await page.evaluate(async () => {
        await __fetchDocsPage('/docs/next');
        __clockOffset = 19_000;
        await __fetchDocsPage('/docs/next');
      });
      assert.equal(count('/docs/next'), 1, 'A fresh cache entry must be reused within 20 seconds');
      await page.evaluate(async () => { __clockOffset = 20_100; await __fetchDocsPage('/docs/next'); });
      assert.equal(count('/docs/next'), 2, 'The same URL must fetch again after its cache lifetime');
    });

    await fixture('an invalidated in-flight document cannot write stale content back to cache', async ({ page, count, result }) => {
      const actual = await page.evaluate(async () => {
        const old = __fetchDocsPage('/docs/next').then(response => response.text(), error => ({ error: error.name }));
        await new Promise(resolve => setTimeout(resolve, 50));
        window.dispatchEvent(new CustomEvent('halo:comment:created'));
        const oldResult = await old;
        await new Promise(resolve => setTimeout(resolve, 300));
        const freshResult = await (await __fetchDocsPage('/docs/next')).text();
        const cachedResult = await (await __fetchDocsPage('/docs/next')).text();
        return { oldResult, freshResult, cachedResult };
      });
      result.invalidated = actual;
      assert.match(actual.oldResult, /stale-generation-one/, 'Freshness invalidation must not abort an existing foreground read');
      assert.match(actual.freshResult, /fresh-generation-two/, 'A new fetch must supply the current document');
      assert.equal(actual.cachedResult, actual.freshResult, 'Only the fresh generation may enter the cache');
      assert.equal(count('/docs/next'), 2, 'A late invalidated request must not satisfy the next consumer');
    }, { responses: { '/docs/next': count => ({ delay: count === 1 ? 250 : 0, body: html('/docs/next').replace('真实 Docsme', count === 1 ? 'stale-generation-one' : 'fresh-generation-two') }) } });

    await fixture('window focus invalidates a previously cached document', async ({ page, count }) => {
      await page.evaluate(async () => {
        await __fetchDocsPage('/docs/next');
        await __fetchDocsPage('/docs/next');
      });
      assert.equal(count('/docs/next'), 1);
      await page.evaluate(async () => { window.dispatchEvent(new Event('focus')); await __fetchDocsPage('/docs/next'); });
      assert.equal(count('/docs/next'), 2, 'Returning focus must obtain a fresh document');
    });

    await fixture('non-HTML preload response is rejected and never cached', async ({ page, count }) => {
      const actual = await page.evaluate(async () => {
        const responses = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          responses.push(await __fetchDocsPage('/docs/next').then(response => ({ ok: response.ok }), error => ({ error: error.message })));
        }
        return responses;
      });
      assert.equal(count('/docs/next'), 2, 'A non-HTML response must not satisfy the second consumer from cache');
      assert.ok(actual.every(response => response.error === 'Expected Docsme HTML'), 'Both non-HTML consumers must receive the actual rejection');
    }, { responses: { '/docs/next': { contentType: 'application/json', body: '{"fixture":true}' } } });

    await fixture('404 preload response is returned to its caller and never cached', async ({ page, count }) => {
      const actual = await page.evaluate(async () => {
        const responses = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await __fetchDocsPage('/docs/next');
          responses.push({ ok: response.ok, status: response.status, body: await response.text() });
        }
        return responses;
      });
      assert.equal(count('/docs/next'), 2, 'An HTTP failure must not enter the document cache');
      assert.deepEqual(actual, [{ ok: false, status: 404, body: 'fixture document missing' }, { ok: false, status: 404, body: 'fixture document missing' }]);
    }, { responses: { '/docs/next': { status: 404, body: 'fixture document missing' } } });

    await fixture('a caller timeout preserves TimeoutError and never commits its target page', async ({ page, count, result }) => {
      result.timeout = await page.evaluate(async () => {
        const controller = new AbortController();
        const error = new DOMException('Isolated caller deadline exceeded', 'TimeoutError');
        const pending = __fetchDocsPage('/docs/next', { signal: controller.signal })
          .then(response => ({ resolved: true, status: response.status }), reason => ({ resolved: false, name: reason.name, message: reason.message, sameReason: reason === error }));
        await new Promise(resolve => setTimeout(resolve, 30));
        controller.abort(error);
        const settled = await pending;
        return { ...settled, path: location.pathname, currentLabel: document.querySelector('[data-page-label]')?.dataset.pageLabel,
          sameFrame: __probe.frame === document.getElementById('window-frame-root'), accepted: __probe.accepted.length };
      });
      assert.equal(count('/docs/next'), 1, 'The timeout must interrupt a genuine in-flight Swup load');
      assert.equal(result.timeout.resolved, false);
      assert.equal(result.timeout.name, 'TimeoutError', 'A caller deadline must remain TimeoutError so the coordinator fails instead of classifying it as superseded');
      assert.equal(result.timeout.sameReason, true, 'The caller must receive its original timeout reason');
      assert.equal(result.timeout.path, '/docs/current');
      assert.equal(result.timeout.currentLabel, '/docs/current');
      assert.equal(result.timeout.sameFrame, true);
      assert.equal(result.timeout.accepted, 0, 'The fetch/cache adapter must not take over navigation ownership');
    }, { responses: { '/docs/next': { delay: 400 } } });

    await fixture('a partial 206 document preserves its status and never enters the cache', async ({ page, count, result }) => {
      // Keep every normal document marker in the body. Status, rather than a
      // missing frame or wrong app id, must prevent caching partial content.
      result.partial = await page.evaluate(async () => {
        const responses = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await __fetchDocsPage('/docs/next');
          const html = await response.text();
          const document = new DOMParser().parseFromString(html, 'text/html');
          responses.push({ status: response.status, ok: response.ok, appId: document.body.dataset.appId,
            frames: document.querySelectorAll('#window-frame-root').length });
        }
        return responses;
      });
      assert.deepEqual(result.partial.map(response => response.status), [206, 206], 'Partial HTTP responses must retain 206 instead of being promoted to successful 200 pages');
      assert.deepEqual(result.partial.map(response => ({ appId: response.appId, frames: response.frames })), [{ appId: 'docsme', frames: 1 }, { appId: 'docsme', frames: 1 }], 'The fixture must contain a fully recognizable Docsme document');
      assert.equal(count('/docs/next'), 2, 'A 206 response must not satisfy the second load from cache');
    }, { responses: { '/docs/next': { status: 206 } } });

    for (const status of [206, 404]) {
      const body = status === 206 ? html('/docs/next') : 'Save-Data foreground document missing';
      await fixture(`Save-Data foreground ${status} preserves the original response and is never cached`, async ({ page, count, result }) => {
        result.foreground = await page.evaluate(async () => {
          const responses = [];
          for (let attempt = 0; attempt < 2; attempt++) {
            responses.push(await __fetchDocsPage('/docs/next').then(async response => ({
              status: response.status, ok: response.ok, body: await response.text()
            }), error => ({ error: error.name, message: error.message })));
          }
          return { saveData: navigator.connection.saveData, responses };
        });
        assert.equal(result.foreground.saveData, true, 'This case must exercise the real official plugin Save-Data foreground branch');
        assert.deepEqual(result.foreground.responses.map(response => response.status), [status, status], 'Foreground loads must return each original HTTP status rather than reject with an adapter error');
        assert.deepEqual(result.foreground.responses.map(response => ({ ok: response.ok, body: response.body })), [{ ok: status === 206, body }, { ok: status === 206, body }], 'Foreground loads must preserve the original response semantics and HTML/body');
        assert.equal(count('/docs/next'), 2, 'A non-200 foreground response must trigger a new request for the second load');
      }, { saveData: true, responses: { '/docs/next': { status, body } } });
    }
  }
} finally {
  await browser.close();
  const passed = results.length > 0 && results.every(result => result.passed);
  const label = saveDataResponseProof ? `save-data-response-${passed ? 'green' : 'red'}` : partialProof ? `partial-${passed ? 'green' : 'red'}` : timeoutProof ? `timeout-${passed ? 'green' : 'red'}` : supplementOnly ? `supplement-${passed ? 'green' : 'red'}` : caseFilter ? `diagnostic-${caseFilter.startsWith('Docsme') ? 'owner' : 'hash'}` : process.argv.includes('--red-proof') ? 'red-proof' : passed ? 'green' : 'red';
  await writeFile(path.join(output, `docsme-swup-${repairOnly ? 'repair-' : ''}${label}.json`), JSON.stringify({ observedAt: new Date().toISOString(), method: 'Isolated Chromium; real initPjax, Docsme runtime/lifecycle, Alpine, installed Swup and official PreloadPlugin; intercepted GET-only HTTP fixtures', results }, null, 2) + '\n');
  console.log(`${results.filter(result => result.passed).length}/${results.length} Docsme Swup scenarios passed`);
  if (!passed) process.exitCode = 1;
}
