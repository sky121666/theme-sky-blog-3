import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readerTemplate = await readFile(path.join(root, 'templates/modules/browser-reader/post.html'), 'utf8');
const readerMode = readerTemplate.match(/\bpageMode\s*=\s*'([^']+)'/)?.[1];
assert.ok(readerMode, 'Use the actual Reader template protocol in the public cache fixture');
const baseline = process.argv.includes('--baseline-docs');
const output = path.resolve(root, process.env.NAVIGATION_PRELOAD_OUTPUT || 'output/navigation-preload-20261116');
const results = [];
const bundle = await build({
  stdin: { resolveDir: root, contents: baseline ? `
    import { initializeDocsSwup, fetchDocsPage } from './src/shared/docs-swup.js';
    initializeDocsSwup(); window.__fetchPage = fetchDocsPage;
  ` : `
    import { initializeNavigationPreload, fetchNavigationPage, canPreloadPage } from './src/shell-core/runtime/navigation-preload.js';
    import Alpine from 'alpinejs';
    import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
    import { markAppAssetsLoaded } from './src/shell-core/runtime/app-loader.js';
    import { registerPageAppLifecycle } from './src/shell/desktop-shell/runtime/shared/page-app.js';
    initializeNavigationPreload(); window.__configurePreload = initializeNavigationPreload; window.__fetchPage = fetchNavigationPage; window.__canPreloadPage = canPreloadPage;
    window.__startPjax = () => {
      window.Alpine = Alpine;
      Alpine.store('windowManager', { show: true, minimized: false, showDesktop() {}, revealAfterNavigation() {} });
      for (const appId of ['docsme', 'reader', 'explorer-archives', 'explorer-categories']) {
        markAppAssetsLoaded(appId);
        registerPageAppLifecycle(appId, { resolveProtocol(root) { return { root }; } });
      }
      Alpine.start(); window.__THEME_ALPINE_STARTED__ = true;
      document.addEventListener('theme:navigation-settled', event => { window.__settled = event.detail; });
      initPjax(Alpine);
    };
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent'
});

function html(url) {
  const pathname = new URL(url, 'http://fixture.test').pathname;
  const app = pathname.startsWith('/docs') ? 'docsme' : /^\/archives(?:\/\d{4})?$/.test(pathname) ? 'explorer-archives'
    : pathname.startsWith('/categories') ? 'explorer-categories' : pathname.startsWith('/shop') ? 'shop' : 'reader';
  const apps = [['docsme', 'docsme'], ['reader', 'reader'], ['explorer-archives', 'archives'], ['explorer-categories', 'categories']];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${url}</title>
    ${apps.map(([id, segment]) => `<link rel="stylesheet" data-app-css="${id}" href="/assets/css/apps/${segment}/index.css"><script type="application/json" data-app-script="${id}" data-app-script-state="ready" data-src="/assets/js/apps/${segment}/index.js"></script>`).join('')}
    </head><body data-app-id="${app}" data-page-app="${app}" data-window-variant="${app === 'docsme' ? 'docsme' : 'browser'}" data-page-mode="${app === 'docsme' ? 'browser-docsme' : app.startsWith('explorer-') ? 'browser-list' : readerMode}">
    <div id="persistent-dock">Dock</div><div id="persistent-widget">Widget</div>
    <main id="window-frame-root"><header class="window-titlebar"><span data-window-title>${url}</span></header><section data-window-content-root><div id="pjax-container" data-window-content-variant="${app === 'docsme' ? 'docsme' : 'browser'}"><article data-app-root="${app}" class="docsme-app" data-page-label="${url}">
    <nav><a id="next" class="pjax-link" href="/docs/next">next</a><a id="archives" class="pjax-link" href="/archives">archives</a>
    <a id="slow" class="pjax-link" href="/docs/slow">slow</a><a id="fast" class="pjax-link" href="/docs/fast">fast</a>
    <a id="q-one" class="pjax-link" href="/docs/query?page=1">one</a><a id="q-two" class="pjax-link" href="/docs/query?page=2">two</a>
    <a id="shop" class="pjax-link" href="/shop/products/item">shop</a><a id="archive-year" class="pjax-link" href="/archives/2026">year</a>
    <a id="category" class="pjax-link" href="/categories/example">category</a></nav>
    <main class="docsme-main"><h1>${url}</h1><p>revision document</p></main></article></div></section></main></body></html>`;
}

const browser = await chromium.launch({ headless: true });
async function fixture(name, run, { responses = {}, connection, touch = false, source = '/docs/current' } = {}) {
  if (process.env.NAVIGATION_PRELOAD_CASE && !name.includes(process.env.NAVIGATION_PRELOAD_CASE)) return;
  const counts = new Map(), requests = [], errors = [];
  const server = createServer(async (request, response) => {
    const key = request.url;
    if (key.startsWith('/assets/')) {
      const manifest = key === '/assets/asset-manifest.json';
      response.writeHead(200, { 'content-type': manifest ? 'application/json' : key.endsWith('.css') ? 'text/css' : 'text/javascript' });
      response.end(manifest ? '{}' : ''); return;
    }
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    const record = { path: key, count, at: Date.now(), priority: request.headers.priority };
    requests.push(record);
    response.on('close', () => { if (!response.writableFinished) record.cancelledAt = Date.now(); });
    const configured = responses[key];
    const item = typeof configured === 'function' ? configured(count) : configured || {};
    if (item.gate) await item.gate;
    if (item.delay) await new Promise(resolve => setTimeout(resolve, item.delay));
    if (response.destroyed) return;
    response.writeHead(item.status || 200, { 'content-type': item.contentType || 'text/html', 'cache-control': 'max-age=60', ...item.headers });
    if (item.bodyDelay) {
      response.flushHeaders();
      await new Promise(resolve => setTimeout(resolve, item.bodyDelay));
    }
    response.end(item.body ?? html(key));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  // A pass must prove our HTML reuse, not Chromium's ordinary HTTP cache.
  // Routing only continues requests to the real loopback fixture server.
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      errors.push('Unexpected external request: ' + route.request().url()); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.setDefaultTimeout(4000);
  page.on('pageerror', error => errors.push(error.message));
  const result = { name };
  try {
    await page.goto(origin + source);
    if (connection) await page.evaluate(connection => Object.defineProperty(navigator, 'connection', { configurable: true, value: connection }), connection);
    await page.evaluate(() => {
      const now = Date.now.bind(Date); window.__clockOffset = 0; Date.now = () => now() + __clockOffset;
      window.__probe = { accepted: 0, history: 0 };
      document.addEventListener('theme:navigation-accepted', () => __probe.accepted++);
      const push = history.pushState; history.pushState = function(...args) { __probe.history++; return push.apply(this, args); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await run({ page, origin, count: key => counts.get(key) || 0, requests, result });
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    result.passed = true; console.log('PASS ' + name);
  } catch (error) {
    result.passed = false; result.error = error.message; console.error('FAIL ' + name + ': ' + error.message);
  } finally {
    result.requests = requests; result.errors = errors; results.push(result);
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

try {
  if (!baseline) {
    await fixture('actual Reader template mode reuses a public article response', async ({ page, count }) => {
      await page.evaluate(async () => { await __fetchPage('/archives/story'); await __fetchPage('/archives/story'); });
      assert.equal(count('/archives/story'), 1);
    });
    await fixture('successful direct write invalidates the current HTML representation', async ({ page, count }) => {
      await page.evaluate(async () => { await __fetchPage('/archives'); await __fetchPage('/archives'); });
      assert.equal(count('/archives'), 1);
      await page.evaluate(async () => {
        document.dispatchEvent(new Event('theme:content-mutated'));
        await __fetchPage('/archives');
      });
      assert.equal(count('/archives'), 2);
    });
    for (const alias of ['/archives/2026', '/archives/story']) await fixture('canonical redirect back to the same entry preserves the site Back depth: ' + alias, async ({ page, origin, count }) => {
      await page.evaluate(() => __startPjax()); await page.waitForFunction(() => !!window.pjax);
      const initial = await page.evaluate(() => ({len:history.length, index:history.state.__browserNavIndex, back:window.__browserCanGoBackWithinSite()}));
      await page.evaluate(alias => window.pjax.loadUrl(alias), alias);
      assert.equal(page.url(), origin + '/archives');
      assert.equal(count(alias), 1);
      assert.deepEqual(await page.evaluate(() => ({len:history.length, index:history.state.__browserNavIndex, back:window.__browserCanGoBackWithinSite()})), initial);
    }, {source:'/archives', responses:{[alias]:{status:302,headers:{location:'/archives'}}}});
    await fixture('repair: read-only application query links speculate but action and unknown representations do not', async ({ page, count }) => {
      const allowed = ['/categories?p=2', '/tags?p=2', '/moments?tag=travel', '/photos?view=albums', '/photos/photo-example?group=photo-group-example'];
      const denied = ['/moments?action=like', '/moments?tag=one&tag=two', '/photos?view=delete', '/shop/products?view=categories', '/links?view=friends', '/categories?p=0'];
      assert.deepEqual(await page.evaluate(urls => urls.map(url => __canPreloadPage(url)), allowed), [true, true, true, true, true]);
      assert.deepEqual(await page.evaluate(urls => urls.map(url => __canPreloadPage(url)), denied), [false, false, false, false, false, false]);
      await page.evaluate(urls => {
        document.querySelector('nav').insertAdjacentHTML('beforeend', urls.map((url, index) => `<a class="pjax-link" id="read-query-${index}" href="${url}">query</a>`).join(''));
      }, allowed);
      for (let index = 0; index < allowed.length; index++) {
        const response = page.waitForResponse(response => new URL(response.url()).pathname + new URL(response.url()).search === allowed[index]);
        await page.focus('#read-query-' + index);
        await (await response).finished();
      }
      for (const url of allowed) assert.equal(count(url), 1);
    });
    await fixture('repair: unknown reader permalink hint warms resources without speculating HTML', async ({ page, count }) => {
      await page.evaluate(() => {
        window.__resourceHints = [];
        const observer = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node.tagName === 'LINK') __resourceHints.push(node.href);
          }
        });
        observer.observe(document.head, { childList: true });
        // No ready descriptor: unlike the other fixture apps Reader needs its CSS.
        document.querySelectorAll('[data-app-css="reader"], [data-app-script="reader"]').forEach(node => node.remove());
        document.body.insertAdjacentHTML('beforeend', '<a class="pjax-link" data-pjax-app="reader" id="reader-hint" href="/about">about</a>');
      });
      await page.focus('#reader-hint');
      await page.waitForFunction(() => __resourceHints.some(url => url.includes('/reader/')));
      assert.equal(count('/about'), 0);
    });
    for (const invalidation of ['focus', 'comment']) {
      await fixture('repair: active foreground survives ' + invalidation + ' invalidation without stale cache refill', async ({ page, count }) => {
        await page.evaluate(() => __startPjax());
        await page.waitForFunction(() => Boolean(window.pjax?.loadUrl));
        const started = page.waitForRequest(request => new URL(request.url()).pathname === '/docs/next');
        await page.evaluate(() => { window.__pendingRepair = window.pjax.loadUrl('/docs/next'); });
        await started;
        await page.evaluate(invalidation => {
          if (invalidation === 'focus') window.dispatchEvent(new Event('focus'));
          else window.dispatchEvent(new CustomEvent('halo:comment:created'));
        }, invalidation);
        assert.equal(await page.evaluate(() => __pendingRepair), true, 'Freshness invalidation must not cancel the chosen read');
        assert.equal(await page.evaluate(() => location.pathname), '/docs/next');
        assert.equal(count('/docs/next'), 1);
        await page.evaluate(() => __fetchPage('/docs/next'));
        assert.equal(count('/docs/next'), 2, 'The pre-invalidation response cannot refill reusable cache');
      }, { responses: { '/docs/next': { bodyDelay: 200 } } });
    }
    await fixture('repair: native menu attention does not issue speculative GET', async ({ page, count }) => {
      await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<nav class="menubar"><a id="plain-menu" href="/archives">native menu</a></nav>'));
      await page.focus('#plain-menu');
      await page.waitForTimeout(140);
      assert.equal(count('/archives'), 0);
      await page.click('#plain-menu');
      await page.waitForURL('**/archives');
      assert.equal(count('/archives'), 1, 'Native menu opens once without a throwaway app prefetch');
    });
    await fixture('repair: mobile deep-link home fallback uses accepted navigation', async ({ page }) => {
      await page.evaluate(() => {
        __startPjax();
        window.__sourceDocument = document;
      });
      await page.waitForFunction(() => Boolean(window.__browserBackOrHome));
      await page.evaluate(() => __browserBackOrHome('/docs/next'));
      await page.waitForFunction(() => location.pathname === '/docs/next' && window.__settled?.outcome === 'ready');
      assert.equal(await page.evaluate(() => __sourceDocument === document), true);
    });
  }
  if (!baseline) await fixture('app-local view attention skips unused HTML but keeps explicit foreground reads', async ({ page, count }) => {
    await page.evaluate(() => __configurePreload({ canNavigateLocally: key => new URL(key).pathname === '/docs/next' }));
    await page.hover('#next'); await page.waitForTimeout(160);
    assert.equal(count('/docs/next'), 0, 'A local view plan needs no speculative HTML');
    const html = await page.evaluate(async () => (await __fetchPage('/docs/next')).text());
    assert.match(html, /revision document/);
    assert.equal(count('/docs/next'), 1, 'An explicit foreground read remains possible when a local owner becomes unavailable');
  });

  if (!baseline) await fixture('app-local view gate preserves the raw destination fragment', async ({ page, count }) => {
    await page.evaluate(() => {
      __configurePreload({ canNavigateLocally: href => { const url = new URL(href); return url.pathname === '/docs/next' && !url.hash; } });
      document.getElementById('next').href = '/docs/next#section';
    });
    await page.hover('#next'); await page.waitForTimeout(160);
    assert.equal(count('/docs/next'), 1, 'A fragment rejected by the local owner keeps its HTML preload opportunity');
    const html = await page.evaluate(async () => (await __fetchPage('/docs/next#section')).text());
    assert.match(html, /revision document/); assert.equal(count('/docs/next'), 1, 'Foreground fragment navigation consumes the same cache key');
  });

  await fixture('global attention fetches a managed public app without navigating', async ({ page, count }) => {
    await page.hover('#archives'); await page.focus('#archives'); await page.waitForTimeout(180);
    assert.equal(count('/archives'), 1, 'Managed archives hover/focus must issue one real request outside the docs-only scope');
    assert.deepEqual(await page.evaluate(() => ({ path: location.pathname, ...__probe })), { path: '/docs/current', accepted: 0, history: 0 });
  });
  if (!baseline) {
    await fixture('real PJAX consumes archive sidebar attention once and retains desktop nodes', async ({ page, count, result }) => {
      await page.evaluate(() => {
        window.__persistent = { doc: document, dock: document.getElementById('persistent-dock'), widget: document.getElementById('persistent-widget') };
        __startPjax();
      });
      await page.waitForFunction(() => Boolean(window.pjax?.loadUrl));
      await page.hover('#archive-year'); await page.focus('#archive-year'); await page.waitForTimeout(160);
      assert.equal(count('/archives/2026'), 1, 'Sidebar attention starts one real HTTP request');
      await page.click('#archive-year');
      await page.waitForFunction(() => location.pathname === '/archives/2026' && __settled?.outcome === 'ready');
      assert.equal(count('/archives/2026'), 1, 'Real PJAX click must consume the preloaded HTML without a second GET');
      result.persistent = await page.evaluate(() => ({ doc: __persistent.doc === document, dock: __persistent.dock === document.getElementById('persistent-dock'), widget: __persistent.widget === document.getElementById('persistent-widget') }));
      assert.deepEqual(result.persistent, { doc: true, dock: true, widget: true });
    }, { source: '/archives', responses: { '/archives/2026': { delay: 400 } } });

    await fixture('hover and foreground share the same in-flight page', async ({ page, count }) => {
      await page.focus('#next'); await page.waitForTimeout(50);
      const response = await page.evaluate(async () => {
        const response = await __fetchPage('/docs/next#part');
        return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
      });
      assert.equal(count('/docs/next'), 1); assert.equal(response.status, 200); assert.match(response.type, /^text\/html/);
      assert.match(response.body, /revision document/);
    }, { responses: { '/docs/next': { delay: 300 } } });

    await fixture('fresh pages expire after the bounded lifetime', async ({ page, count }) => {
      await page.evaluate(async () => {
        await __fetchPage('/docs/next'); __clockOffset = 19000;
        await __fetchPage('/docs/next');
      });
      assert.equal(count('/docs/next'), 1);
      await page.evaluate(async () => { __clockOffset = 20100; await __fetchPage('/docs/next'); });
      assert.equal(count('/docs/next'), 2);
    });

    await fixture('query representations remain distinct and fragments reuse one page', async ({ page, count }) => {
      await page.focus('#q-one'); await page.focus('#q-two'); await page.waitForTimeout(120);
      await page.evaluate(async () => {
        await __fetchPage('/docs/query?page=1#one'); await __fetchPage('/docs/query?page=1#two');
        await __fetchPage('/docs/query?page=2');
      });
      assert.equal(count('/docs/query?page=1'), 1); assert.equal(count('/docs/query?page=2'), 1);
    });

    await fixture('uncacheable attention falls back to resources while foreground stays fresh', async ({ page, count }) => {
      await page.focus('#next'); await page.waitForTimeout(100);
      await page.focus('#archives'); await page.focus('#next'); await page.waitForTimeout(100);
      assert.equal(count('/docs/next'), 1, 'Completed no-store HTML must not be downloaded again on repeated attention');
      assert.equal(await page.evaluate(() => swup.cache.has('/docs/next')), false, 'No-store HTML is not retained');
      await page.evaluate(async () => { await __fetchPage('/docs/next'); await __fetchPage('/docs/next'); });
      assert.equal(count('/docs/next'), 3, 'Every explicit foreground read remains fresh');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('halo:comment:created')));
      await page.focus('#archives'); await page.focus('#next'); await page.waitForTimeout(100);
      assert.equal(count('/docs/next'), 4, 'A write invalidates the resource-only decision');
    }, { responses: { '/docs/next': { headers: { 'cache-control': 'private, no-store, max-age=60' } } } });

    for (const [label, headers, offset, expected] of [
      ['private', { 'cache-control': 'private, max-age=60' }, 0, 2],
      ['no-cache', { 'cache-control': 'no-cache, max-age=60' }, 0, 2],
      ['missing freshness', { 'cache-control': '' }, 0, 2],
      ['Vary', { vary: 'Cookie' }, 0, 2],
      ['Age', { 'cache-control': 'max-age=4', age: '3' }, 1500, 2],
      ['old Date', { 'cache-control': 'max-age=3', date: new Date(Date.now() - 10000).toUTCString() }, 0, 2],
      ['explicit short freshness', { 'cache-control': 'max-age=3, must-revalidate' }, 500, 1]
    ]) await fixture('origin freshness: ' + label, async ({ page, count }) => {
      await page.evaluate(async offset => { await __fetchPage('/docs/next'); __clockOffset = offset; await __fetchPage('/docs/next'); }, offset);
      assert.equal(count('/docs/next'), expected);
    }, { responses: { '/docs/next': { headers } } });

    await fixture('dynamic pjax menubar and dock links use delegated attention', async ({ page, count }) => {
      await page.evaluate(() => document.querySelector('nav').insertAdjacentHTML('beforeend', `
        <a id="dynamic" class="pjax-link" href="/docs/dynamic">dynamic</a>
        <span class="menubar"><a id="menu" class="pjax-link" href="/archives/2026">menu</a></span>
        <a id="dock" class="dock-icon pjax-link" href="/categories/example">dock</a>`));
      for (const id of ['dynamic', 'menu', 'dock']) { await page.focus('#' + id); await page.waitForTimeout(60); }
      assert.equal(count('/docs/dynamic'), 1); assert.equal(count('/archives/2026'), 1); assert.equal(count('/categories/example'), 1);
    });

    await fixture('two speculative jobs cannot queue or block a chosen target', async ({ page, count }) => {
      await page.focus('#slow'); await page.focus('#next'); await page.focus('#fast'); await page.waitForTimeout(60);
      assert.equal(count('/docs/slow'), 1); assert.equal(count('/docs/next'), 1); assert.equal(count('/docs/fast'), 0, 'No queue may retain a third guess');
      const started = Date.now();
      await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/fast' } }));
        await __fetchPage('/docs/fast');
      });
      assert.ok(Date.now() - started < 700, 'Foreground navigation must not await unrelated speculation');
      assert.equal(count('/docs/fast'), 1);
    }, { responses: { '/docs/slow': { delay: 1200 }, '/docs/next': { delay: 1200 } } });

    await fixture('accepted navigation retains its chosen speculative flight', async ({ page, count }) => {
      await page.focus('#next'); await page.waitForTimeout(40);
      await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } }));
        await __fetchPage('/docs/next');
      });
      assert.equal(count('/docs/next'), 1);
    }, { responses: { '/docs/next': { delay: 220 } } });

    let releaseAccepted;
    const acceptedGate = new Promise(resolve => { releaseAccepted = resolve; });
    await fixture('accepted no-store flight completing before foreground is consumed once', async ({ page, count }) => {
      const started = page.waitForRequest(request => new URL(request.url()).pathname === '/docs/next');
      await page.focus('#next'); await started;
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/docs/next');
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } })));
      releaseAccepted(); await (await completed).finished(); await page.waitForTimeout(80);
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 1, 'An already accepted navigation must consume the request that finished before its delayed foreground read');
      assert.equal(await page.evaluate(() => swup.cache.has('/docs/next')), false, 'The accepted result must not become reusable no-store HTML');
      await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 1 } }));
        await __fetchPage('/docs/next');
      });
      assert.equal(count('/docs/next'), 2, 'A later foreground read must fetch fresh after the one accepted consumption');
    }, { responses: { '/docs/next': count => ({ gate: count === 1 ? acceptedGate : null, headers: { 'cache-control': 'private, no-store' } }) } });

    for (const cleanup of ['settled', 'new intent', 'invalidated']) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await fixture(cleanup === 'invalidated' ? 'current accepted no-store lease survives freshness invalidation once'
        : 'unused accepted no-store result is discarded when ' + cleanup, async ({ page, count }) => {
        const started = page.waitForRequest(request => new URL(request.url()).pathname === '/docs/next');
        await page.focus('#next'); await started;
        const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/docs/next');
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } })));
        release(); await (await completed).finished(); await page.waitForTimeout(70);
        await page.evaluate(async cleanup => {
          if (cleanup === 'invalidated') window.dispatchEvent(new CustomEvent('halo:comment:created'));
          else document.dispatchEvent(new CustomEvent(cleanup === 'settled' ? 'theme:navigation-settled' : 'theme:navigation-accepted', {
            detail: cleanup === 'settled' ? { intentId: 1 } : { intentId: 2, url: '/docs/fast' }
          }));
          await __fetchPage('/docs/next');
        }, cleanup);
        assert.equal(count('/docs/next'), cleanup === 'invalidated' ? 1 : 2,
          'Only a still-current accepted lease survives freshness invalidation; settlement and a newer intent revoke it');
        if (cleanup === 'invalidated') {
          await page.evaluate(() => __fetchPage('/docs/next'));
          assert.equal(count('/docs/next'), 2, 'The invalidated lease is one-use and cannot become reusable cache');
        }
      }, { responses: { '/docs/next': count => ({ gate: count === 1 ? gate : null, headers: { 'cache-control': 'no-store' } }) } });
    }

    let releaseFirst, releaseSecond;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const secondGate = new Promise(resolve => { releaseSecond = resolve; });
    await fixture('old navigation settlement cannot release the newer accepted result', async ({ page, count }) => {
      await page.focus('#next'); await page.focus('#slow'); await page.waitForTimeout(40);
      let completed = page.waitForResponse(response => new URL(response.url()).pathname === '/docs/next');
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } })));
      releaseFirst(); await (await completed).finished(); await page.waitForTimeout(60);
      // The first acceptance cancels unrelated speculation. Start the second
      // target explicitly, then transfer its in-flight request to the new intent.
      await page.evaluate(() => { window.__second = __fetchPage('/docs/slow'); });
      completed = page.waitForResponse(response => new URL(response.url()).pathname === '/docs/slow');
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 2, url: '/docs/slow' } })));
      releaseSecond(); await (await completed).finished(); await page.waitForTimeout(60);
      await page.evaluate(async () => {
        await __second;
        document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 1 } }));
        await __fetchPage('/docs/slow');
      });
      assert.equal(count('/docs/slow'), 2, 'The newer accepted result must survive settlement of the old intent');
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 2, 'The abandoned first accepted result must be discarded');
    }, { responses: {
      '/docs/next': count => ({ gate: count === 1 ? firstGate : null, headers: { 'cache-control': 'no-store' } }),
      '/docs/slow': { gate: secondGate, headers: { 'cache-control': 'no-store' } }
    } });

    let releaseTransferred;
    const transferredGate = new Promise(resolve => { releaseTransferred = resolve; });
    await fixture('accepted lease survives older foreground consumer cancellation', async ({ page, count }) => {
      const started = page.waitForRequest(request => new URL(request.url()).pathname === '/docs/next');
      await page.evaluate(() => {
        window.__oldController = new AbortController();
        window.__oldRead = __fetchPage('/docs/next', { signal: __oldController.signal }).then(() => 'resolved', error => error.name);
      });
      await started;
      await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } }));
        __oldController.abort(); await __oldRead;
      });
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/docs/next');
      releaseTransferred(); await (await completed).finished(); await page.waitForTimeout(70);
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 1, 'The old consumer cleanup cannot cancel the request leased by the current accepted intent');
    }, { responses: { '/docs/next': count => ({ gate: count === 1 ? transferredGate : null, headers: { 'cache-control': 'no-store' } }) } });

    await fixture('new intent cancels an unused accepted response still in flight', async ({ page, count, requests }) => {
      const started = page.waitForRequest(request => new URL(request.url()).pathname === '/docs/next');
      await page.focus('#next'); await started;
      await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1, url: '/docs/next' } }));
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 2, url: '/docs/fast' } }));
        await __fetchPage('/docs/fast');
      });
      await page.waitForTimeout(70);
      assert.equal(count('/docs/fast'), 1);
      assert.ok(requests.find(request => request.path === '/docs/next')?.cancelledAt, 'An unconsumed old lease must release its real HTTP response');
    }, { responses: { '/docs/next': { bodyDelay: 1200, headers: { 'cache-control': 'no-store' } } } });

    await fixture('failed attention can retry and success becomes reusable', async ({ page, count }) => {
      await page.focus('#next'); await page.waitForTimeout(100);
      await page.focus('#fast'); await page.focus('#next'); await page.waitForTimeout(100);
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 2);
    }, { responses: { '/docs/next': count => count === 1 ? { status: 503 } : {} } });

    await fixture('native and unsafe links never trigger speculative HTML', async ({ page, count }) => {
      await page.evaluate(() => document.querySelector('nav').insertAdjacentHTML('beforeend', `
        <a id="external" class="pjax-link" href="https://external.invalid/docs/next">external</a>
        <a id="blank" class="pjax-link" href="/docs/blank" target="_blank">blank</a>
        <a id="download" class="pjax-link" href="/docs/download-file" download>download</a>
        <span data-no-swup><a id="native" class="pjax-link" href="/docs/native">native</a></span>
        <a id="hash" class="pjax-link" href="#part">hash</a>
        <a id="action" class="pjax-link" href="/docs/next?action=delete">action</a>
        <a id="token" class="pjax-link" href="/docs/next?accessToken=sensitive">token</a>
        <a id="unknown" class="pjax-link" href="/archives?unknown=1">unknown</a>
        <a id="cart" class="pjax-link" href="/shop/cart">cart</a>`));
      for (const id of ['external', 'blank', 'download', 'native', 'hash', 'action', 'token', 'unknown', 'cart', 'shop']) await page.focus('#' + id);
      await page.waitForTimeout(100);
      for (const key of ['/docs/blank', '/docs/download-file', '/docs/native', '/docs/next?action=delete', '/docs/next?accessToken=sensitive', '/archives?unknown=1', '/shop/cart', '/shop/products/item']) assert.equal(count(key), 0, key);
    });

    for (const connection of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: '2g' }]) {
      await fixture('connection policy suppresses speculation but permits foreground ' + JSON.stringify(connection), async ({ page, count }) => {
        await page.focus('#next'); await page.hover('#next'); await page.waitForTimeout(100);
        assert.equal(count('/docs/next'), 0);
        await page.evaluate(() => __fetchPage('/docs/next'));
        assert.equal(count('/docs/next'), 1);
      }, { connection });
    }

    await fixture('touch attention shares one request with the explicit load', async ({ page, count }) => {
      await page.dispatchEvent('#next', 'touchstart', { bubbles: true }); await page.waitForTimeout(50);
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 1);
    }, { touch: true, responses: { '/docs/next': { delay: 200 } } });

    for (const [label, options, wantStatus] of [
      ['partial', { status: 206 }, 206], ['missing', { status: 404, body: 'missing' }, 404],
      ['server error', { status: 500, body: 'failed' }, 500], ['empty response', { body: '' }, 200],
      ['non HTML', { contentType: 'application/json', body: '{}' }, 200],
      ['missing title', { body: html('/docs/next').replace(/<title>.*?<\/title>/, '') }, 200],
      ['duplicate title', { body: html('/docs/next').replace('</head>', '<title>duplicate</title></head>') }, 200],
      ['ambiguous content root', { body: html('/docs/next').replace('</body>', '<section data-window-content-root></section></body>') }, 200],
      ['truncated after app', { body: html('/docs/next').split('</article>')[0] }, 200],
      ['range marked 200', { headers: { 'content-range': 'bytes 0-127/256' } }, 200],
      ['missing page protocol', { body: html('/docs/next').replace('data-page-mode="browser-docsme"', '') }, 200],
      ['unknown page protocol', { body: html('/docs/next').replace('browser-docsme', 'unknown-mode') }, 200],
      ['missing window variant', { body: html('/docs/next').replace('data-window-variant="docsme"', '') }, 200],
      ['inconsistent app protocol', { body: html('/docs/next').replace('data-page-app="docsme"', 'data-page-app="reader"') }, 200],
      ['incomplete', { body: '<html><body>missing desktop</body></html>' }, 200]
    ]) await fixture('response semantics and no retention: ' + label, async ({ page, count }) => {
      const statuses = await page.evaluate(async () => {
        const results = [];
        for (let i = 0; i < 2; i++) { const response = await __fetchPage('/docs/next'); results.push(response.status); await response.text(); }
        return results;
      });
      assert.deepEqual(statuses, [wantStatus, wantStatus]); assert.equal(count('/docs/next'), 2);
      assert.equal(await page.evaluate(() => swup.cache.size), 0);
    }, { responses: { '/docs/next': options } });

    await fixture('incomplete attention cannot poison the following real PJAX click', async ({ page, count }) => {
      await page.evaluate(() => __startPjax());
      await page.focus('#archive-year'); await page.waitForTimeout(100);
      assert.equal(count('/archives/2026'), 1);
      assert.equal(await page.evaluate(() => swup.cache.has('/archives/2026')), false);
      await page.click('#archive-year');
      await page.waitForFunction(() => location.pathname === '/archives/2026' && __settled?.outcome === 'ready');
      assert.equal(count('/archives/2026'), 2, 'The chosen page must fetch fresh after rejecting incomplete speculative HTML');
    }, { source: '/archives', responses: { '/archives/2026': count => count === 1 ? { body: html('/archives/2026').replace(/<title>.*?<\/title>/, '') } : {} } });

    await fixture('redirect preserves final URL and is not admitted under its source', async ({ page, origin, count }) => {
      const urls = await page.evaluate(async () => {
        const urls = [];
        for (let i = 0; i < 2; i++) { const response = await __fetchPage('/docs/next'); urls.push(response.url); }
        return urls;
      });
      assert.deepEqual(urls, [origin + '/docs/redirected', origin + '/docs/redirected']);
      assert.equal(count('/docs/next'), 2); assert.equal(count('/docs/redirected'), 2);
    }, { responses: { '/docs/next': { status: 302, headers: { location: '/docs/redirected' }, body: '' } } });

    await fixture('caller abort preserves another active consumer of the same request', async ({ page, count }) => {
      const result = await page.evaluate(async () => {
        const controller = new AbortController(), reason = new DOMException('caller deadline', 'TimeoutError');
        const pending = __fetchPage('/docs/next', { signal: controller.signal }).then(() => false, error => error === reason);
        const other = __fetchPage('/docs/next');
        setTimeout(() => controller.abort(reason), 30);
        const retainedReason = await pending;
        await other;
        await __fetchPage('/docs/next'); return retainedReason;
      });
      assert.equal(result, true); assert.equal(count('/docs/next'), 1);
    }, { responses: { '/docs/next': { delay: 200 } } });

    await fixture('last foreground abort cancels the actual body before the next target', async ({ page, count, requests }) => {
      const started = Date.now();
      const result = await page.evaluate(async () => {
        const controller = new AbortController();
        const old = __fetchPage('/docs/next', { signal: controller.signal }).then(() => 'resolved', error => error.name);
        await new Promise(resolve => setTimeout(resolve, 50));
        controller.abort();
        await __fetchPage('/docs/fast');
        return old;
      });
      assert.equal(result, 'AbortError'); assert.equal(count('/docs/fast'), 1);
      assert.ok(Date.now() - started < 700, 'A new foreground target cannot wait for the abandoned body');
      await page.waitForTimeout(80);
      assert.ok(requests.find(request => request.path === '/docs/next')?.cancelledAt, 'The browser must cancel the abandoned HTTP response');
      await page.evaluate(() => __fetchPage('/docs/next'));
      assert.equal(count('/docs/next'), 2, 'An abandoned response cannot become a hidden cache hit');
    }, { responses: { '/docs/next': count => count === 1 ? { bodyDelay: 1200 } : {} } });

    await fixture('shared deadline covers response body and permits a fresh retry', async ({ page, count }) => {
      const result = await page.evaluate(async () => {
        const timer = window.setTimeout; window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 15000 ? 250 : ms, ...args);
        const first = await __fetchPage('/docs/next').then(() => 'resolved', error => error.name);
        await __fetchPage('/docs/next'); return first;
      });
      assert.equal(result, 'TimeoutError'); assert.equal(count('/docs/next'), 2);
    }, { responses: { '/docs/next': count => count === 1 ? { bodyDelay: 700 } : {} } });

    await fixture('cache bounds evict old entries and invalidations reject stale writers', async ({ page, count }) => {
      await page.evaluate(async () => {
        for (let i = 0; i < 13; i++) await __fetchPage('/docs/cache-' + i);
        await __fetchPage('/docs/cache-0');
      });
      assert.equal(count('/docs/cache-0'), 2); assert.equal(await page.evaluate(() => swup.cache.size), 12);
      const result = await page.evaluate(async () => {
        const first = __fetchPage('/docs/next').then(response => response.text(), error => error.name);
        await new Promise(resolve => setTimeout(resolve, 30));
        window.dispatchEvent(new Event('focus'));
        const old = await first;
        const current = await (await __fetchPage('/docs/next')).text();
        return { old, current };
      });
      assert.match(result.old, /stale generation/, 'An already chosen read completes without freshness revoking its ownership');
      assert.match(result.current, /fresh generation/, 'Its stale writer cannot refill the cleared cache');
      assert.equal(count('/docs/next'), 2);
    }, { responses: { '/docs/next': count => ({ delay: count === 1 ? 200 : 0, body: html('/docs/next').replace('revision document', count === 1 ? 'stale generation' : 'fresh generation') }) } });
  }
} finally {
  await browser.close(); await mkdir(output, { recursive: true });
  const passed = results.length > 0 && results.every(result => result.passed);
  await writeFile(path.join(output, `${baseline ? 'baseline-' : ''}${passed ? 'green' : 'red'}.json`), JSON.stringify({ observedAt: new Date().toISOString(), method: 'Isolated loopback HTTP server; installed Swup and official preload plugin in Chromium', results }, null, 2) + '\n');
  console.log(`${results.filter(result => result.passed).length}/${results.length} navigation preload scenarios passed`);
  if (!passed) process.exitCode = 1;
}
