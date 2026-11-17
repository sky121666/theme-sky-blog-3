import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { verifyHttpNavigation } from './lib/swup-http-cases.mjs';
import { verifySwupReaderImages } from './lib/swup-reader-images.mjs';
import { verifyColdAttention } from './lib/swup-cold-attention.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

const root = process.cwd();
const output = await verificationOutput('swup-global');
const origin = 'https://global-swup.test';
const entry = `
      import Alpine from 'alpinejs';
      import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
      import { markAppAssetsLoaded } from './src/shell-core/runtime/app-loader.js';
      import { registerPageAppLifecycle } from './src/shell/desktop-shell/runtime/shared/page-app.js';
      window.Alpine = Alpine;
      Alpine.store('windowManager', { show: true, minimized: false,
        showDesktop() {}, revealAfterNavigation() {} });
      for (const app of ['explorer-archives', 'reader', 'photos']) {
        markAppAssetsLoaded(app);
        registerPageAppLifecycle(app, { resolveProtocol(root) { return { root }; } });
      }
      Alpine.start();
      window.__THEME_ALPINE_STARTED__ = true;
      initPjax(Alpine);
    `;
const bundle = await build({
  stdin: { resolveDir: root, contents: entry },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent'
});

function html(pathname) {
  const app = pathname.startsWith('/photos') ? 'photos'
    : pathname.startsWith('/archives') && pathname !== '/archives/story' ? 'explorer-archives' : 'reader';
  const variant = app === 'photos' ? 'photos' : 'browser';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${pathname}</title>
    ${['explorer-archives', 'reader', 'photos'].map(name => `<link rel="stylesheet" data-app-css="${name}" href="/assets/css/apps/${name.replace('explorer-', '')}/index.css">
      <script type="application/json" data-app-script="${name}" data-app-script-state="ready" data-src="/assets/js/apps/${name.replace('explorer-', '')}/index.js"></script>`).join('')}
    </head><body data-page-app="${app}" data-app-id="${app}" data-window-variant="${variant}" data-page-mode="${app === 'reader' ? 'browser-reader' : 'browser-list'}">
    <aside id="desktop-fixture">桌面小组件</aside>
    <nav class="menubar"><a id="nav-story" class="pjax-link" href="/archives/story">文章</a></nav><main id="window-frame-root">
    <header class="window-titlebar"><span data-window-title>${pathname}</span></header>
    <section data-window-content-root><div data-window-loading-overlay aria-hidden="true" style="display:none">加载中</div><div id="pjax-container" data-window-content-variant="${variant}">
    <article data-app-root="${app}" data-page-label="${pathname}"><h1>${pathname}</h1>
    <a class="pjax-link" href="/posts/next">下一篇</a></article></div></section></main></body></html>`;
}

const browser = await chromium.launch({ headless: true });
const results = [];

async function scenario(name, run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const requests = [];
  const errors = [];
  const diagnostics = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text());
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, origin);
    if (url.pathname.startsWith('/assets/')) {
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
    }
    requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
    await route.fulfill({ contentType: 'text/html', body: html(url.pathname) });
  });
  try {
    await page.goto(origin + '/archives');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.pjax?.loadUrl);
    await page.evaluate(() => {
      window.probe = { desktop: document.getElementById('desktop-fixture'), swup: 0, ready: [], settled: [], failedComplete: 0 };
      document.addEventListener('pjax:complete', event => {
        if (event.__themeFailedResponse) window.probe.failedComplete++;
      });
      document.addEventListener('swup:visit:end', () => window.probe.swup++);
      document.addEventListener('theme:pjax-ready', event => window.probe.ready.push(event.detail));
      document.addEventListener('theme:navigation-settled', event => window.probe.settled.push(event.detail));
    });
    await run(page, requests);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const state = await page.evaluate(() => ({ url: location.href, settled: window.probe?.settled }));
    results.push({ name, passed: false, error: error.stack, errors, diagnostics, state, requests });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await page.close();
  }
}

try {
  try {
    await verifyColdAttention({browser, html, entry});
    results.push({name:'foreground navigation with attention still downloading',passed:true});
    console.log('PASS foreground navigation with attention still downloading');
  } catch (error) {
    results.push({name:'foreground navigation with attention still downloading',passed:false,error:String(error)});
    console.error('FAIL foreground navigation with attention still downloading:',error.message);
  }
  await verifyHttpNavigation({ scenario, html, origin });
  await verifySwupReaderImages({ scenario, html });
  for (const check of ['immediate-feedback', 'retained-content']) {
    await scenario(`pending cross-app navigation: ${check}`, async page => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const arrived = page.waitForRequest(request => new URL(request.url()).pathname === '/archives/story');
      await page.route('**/archives/story', async route => { await gate; await route.abort('failed'); });
      try {
        await page.evaluate(() => document.getElementById('nav-story').click());
        await arrived;
        if (check === 'immediate-feedback') {
          assert.deepEqual(await page.evaluate(() => ({
            pending: document.getElementById('nav-story').classList.contains('theme-navigation-pending'),
            busy: document.getElementById('nav-story').getAttribute('aria-busy')
          })), { pending: true, busy: 'true' }, 'an accepted click must acknowledge its target before the response');
        } else {
          await page.waitForTimeout(180);
          assert.equal(await page.locator('[data-window-loading-overlay]').getAttribute('aria-hidden'), 'true',
            'old content must remain visible instead of being covered by a full-window skeleton');
        }
        assert.equal(await page.locator('[data-page-label]').getAttribute('data-page-label'), '/archives');
        release();
        await page.waitForFunction(() => window.probe.settled.at(-1)?.outcome === 'failed');
        assert.equal(await page.locator('#nav-story').getAttribute('aria-busy'), null);
        assert.equal(await page.locator('#nav-story').evaluate(el => el.classList.contains('theme-navigation-pending')), false);
        assert.equal(await page.evaluate(() => location.pathname), '/archives');
      } finally { release(); }
    });
  }
  for (const target of ['/archives/page/2', '/posts/next', '/photos']) {
    await scenario(`real Swup navigation to ${target}`, async page => {
      const length = await page.evaluate(() => history.length);
      await page.evaluate(target => window.pjax.loadUrl(target), target);
      await page.waitForFunction(target => window.probe.ready.some(event => new URL(event.url).pathname === target), target);
      await page.waitForTimeout(30);
      const state = await page.evaluate(() => ({
        swup: window.probe.swup, ready: window.probe.ready.length,
        desktop: window.probe.desktop === document.getElementById('desktop-fixture'),
        label: document.querySelector('[data-page-label]').dataset.pageLabel,
        source: history.state?.source, length: history.length
      }));
      assert.equal(state.swup, 1, 'navigation must run the real Swup visit, not just fetch through Swup');
      assert.equal(state.ready, 1);
      assert.equal(state.desktop, true);
      assert.equal(state.label, target);
      assert.equal(state.source, 'swup');
      assert.equal(state.length, length + 1);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('[data-page-label]')?.dataset.pageLabel === '/archives');
      assert.equal(await page.evaluate(() => location.pathname), '/archives');
      assert.equal(await page.evaluate(() => history.length), length + 1);
    });
  }

  await scenario('failed foreground request keeps source and history', async page => {
    const length = await page.evaluate(() => history.length);
    await page.route('**/posts/broken', route => route.abort('failed'));
    await page.evaluate(() => window.pjax.loadUrl('/posts/broken'));
    await page.waitForFunction(() => window.probe.settled.some(event => event.outcome === 'failed'));
    assert.equal(await page.evaluate(() => location.pathname), '/archives');
    assert.equal(await page.evaluate(() => history.length), length);
    assert.equal(await page.locator('[data-page-label]').getAttribute('data-page-label'), '/archives');
    assert.equal(await page.evaluate(() => window.probe.failedComplete), 1);
    assert.equal(await page.evaluate(() => window.probe.ready.length), 0);
  });

  await scenario('cross-app navigation retains its requested fragment', async page => {
    await page.evaluate(() => window.pjax.loadUrl('/photos#comment-fixture'));
    await page.waitForFunction(() => window.probe.ready.length === 1);
    assert.equal(await page.evaluate(() => location.pathname + location.hash), '/photos#comment-fixture');
    assert.equal(await page.evaluate(() => new URL(history.state.url).hash), '#comment-fixture');
  });

  await scenario('local history followed by HTML navigation retains both Back entries', async page => {
    const length = await page.evaluate(() => history.length);
    assert.equal(await page.evaluate(() => window.__browserSyncUiHistoryState({ url: '/archives?view=local' })), true);
    await page.evaluate(() => window.pjax.loadUrl('/archives'));
    await page.waitForFunction(() => window.probe.ready.length === 1);
    assert.equal(await page.evaluate(() => history.length), length + 2);
    await page.goBack();
    await page.waitForFunction(() => window.probe.ready.length === 2);
    assert.equal(await page.evaluate(() => location.pathname + location.search), '/archives?view=local');
  });

  await scenario('later accepted visit wins without stale history', async page => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let arrived;
    const requested = new Promise(resolve => { arrived = resolve; });
    await page.route('**/posts/slow', async route => {
      arrived();
      await gate;
      await route.fulfill({ contentType: 'text/html', body: html('/posts/slow') }).catch(() => {});
    });
    const length = await page.evaluate(() => history.length);
    await page.evaluate(() => { void window.pjax.loadUrl('/posts/slow'); });
    await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(new Error('slow request never started')), 6000))]);
    await page.evaluate(() => { void window.pjax.loadUrl('/photos'); });
    release();
    await page.waitForFunction(() => window.probe.ready.some(event => new URL(event.url).pathname === '/photos'));
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => location.pathname), '/photos');
    assert.equal(await page.evaluate(() => history.length), length + 1);
    assert.deepEqual(await page.evaluate(() => window.probe.ready.map(event => new URL(event.url).pathname)), ['/photos']);
  });

  await scenario('POST keeps payload and is sent once', async (page, requests) => {
    await page.evaluate(() => window.pjax.loadUrl('/posts/posted', {
      requestOptions: { requestMethod: 'POST', requestParams: [
        { name: 'message', value: 'hello' }, { name: 'count', value: '2' }
      ] }
    }));
    await page.waitForFunction(() => window.probe.ready.some(event => new URL(event.url).pathname === '/posts/posted'));
    const writes = requests.filter(request => request.path === '/posts/posted');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].body, 'message=hello&count=2');
  });
} finally {
  await browser.close();
  await writeFile(`${output}/fixture-results.json`, JSON.stringify(results, null, 2));
}

if (results.some(result => !result.passed)) process.exitCode = 1;
