import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const sdkUrl = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
// Literal structure from SEO Tools 1.11.1 SignatureContext.generateScript().
// Only the signed JSON below is synthetic; no real credentials are read.
function pluginScript(data) {
  return `<script>
(function () {
    if (!/MicroMessenger|QQ\\//i.test(navigator.userAgent)) return;
    var data = ${JSON.stringify(data).replaceAll('<', '\\u003c')};
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

function signature(page) {
  return {
    config: {
      appId: 'wxFixtureOnly', debug: false, timestamp: 1794624000,
      nonceStr: `fixture-${page}`, signature: page === 'A' ? 'a'.repeat(40) : 'b'.repeat(40),
      jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData']
    },
    share: {
      title: `Article ${page}`, desc: `Description ${page}`,
      link: `https://fixture.invalid/${page.toLowerCase()}?signed=1&order=2`,
      imgUrl: `https://fixture.invalid/${page}.png`
    }
  };
}

function html(data, extra = '') {
  return `<!doctype html><html><head><title>Fixture</title>${data ? pluginScript(data) : ''}${extra}</head><body></body></html>`;
}

const sdkSource = `
window.__sdk = { configs: [], messages: [], timelines: [], ready: [], errors: [] };
window.wx = {
  config(data) { __sdk.configs.push(data); },
  ready(callback) { if (window.__deferReady) __sdk.ready.push(callback); else callback(); },
  error(callback) { __sdk.errors.push(callback); },
  updateAppMessageShareData(data) { if (window.__throwShare) throw new Error('fixture SDK error'); __sdk.messages.push(data); },
  updateTimelineShareData(data) { __sdk.timelines.push(data); }
};`;

const bundle = await build({
  entryPoints: ['src/shell/desktop-shell/runtime/desktop/pjax/seo.js'],
  bundle: true, format: 'iife', globalName: 'ThemeSeoContract',
  platform: 'browser', target: 'es2022', write: false
});
const runtimeSource = bundle.outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
let passed = 0;

async function scenario(label, callback, options = {}) {
  const context = await browser.newContext({ userAgent: options.ua || 'Mozilla/5.0 MicroMessenger/8.0.0' });
  const page = await context.newPage();
  let sdkRequests = 0;
  const documentRequests = [];
  const networkRequests = [];
  page.on('request', (request) => networkRequests.push(request.url()));
  let releaseSdk;
  const gate = options.holdSdk ? new Promise((resolve) => { releaseSdk = resolve; }) : Promise.resolve();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    if (route.request().url() === sdkUrl) {
      sdkRequests += 1;
      if (options.failFirstSdk && sdkRequests === 1) return route.abort();
      await gate;
      await route.fulfill({ contentType: 'text/javascript', body: sdkSource });
    } else if (route.request().isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html', body: options.cold ? html(signature('A')) : html(null) });
    } else if (new URL(route.request().url()).origin === 'https://fixture.invalid') {
      documentRequests.push({ url: route.request().url(), method: route.request().method(), headers: await route.request().allHeaders() });
      const response = options.responses?.[new URL(route.request().url()).pathname];
      if (!response) return route.abort();
      if (response.delay) await new Promise((resolve) => setTimeout(resolve, response.delay));
      await route.fulfill({ contentType: response.contentType || 'text/html', status: response.status || 200, body: response.body });
    } else await route.abort();
  });
  try {
    await page.goto('https://fixture.invalid/a', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: runtimeSource });
    await callback({ page, releaseSdk, requests: () => sdkRequests, documentRequests, networkRequests });
    assert.deepEqual(pageErrors, [], `${label}: no uncaught browser exceptions`);
    passed += 1;
    console.log(`PASS ${label}`);
  } finally {
    releaseSdk?.();
    await context.close();
  }
}

async function startInert(page, response = html(signature('A')), deferReady = false) {
  await page.evaluate(({ response, deferReady }) => {
    window.__deferReady = deferReady;
    // innerHTML leaves these actual plugin-shaped script nodes inert. The real
    // module must extract the data without running any response JavaScript.
    document.head.insertAdjacentHTML('beforeend', new DOMParser().parseFromString(response, 'text/html').head.innerHTML);
    ThemeSeoContract.initializeWechatShare();
  }, { response, deferReady });
}

async function navigate(page, response = html(signature('B')), path = '/b') {
  await page.evaluate(({ response, path }) => {
    history.pushState({}, '', path);
    ThemeSeoContract.syncSeoHeadFromResponse(response);
  }, { response, path });
}

async function waitShare(page, title) {
  await page.waitForFunction((title) => window.__sdk?.messages.at(-1)?.title === title, title);
}

try {
  await scenario('signed A → B PJAX replaces message, timeline and config', async ({ page }) => {
    await page.waitForFunction(() => window.__sdk?.messages.length > 0);
    await navigate(page);
    await waitShare(page, 'Article B');
    const last = await page.evaluate(() => ({ message: __sdk.messages.at(-1), timeline: __sdk.timelines.at(-1), config: __sdk.configs.at(-1) }));
    assert.equal(last.message.title, 'Article B', 'A → B PJAX must replace the native WeChat share title');
    assert.equal(last.message.link, 'https://fixture.invalid/b?signed=1&order=2');
    assert.equal(last.timeline.title, 'Article B');
    assert.equal(last.config.signature, 'b'.repeat(40));
  }, { cold: true });

  await scenario('cold bootstrap adopts the pending official SDK once', async ({ page, releaseSdk, requests }) => {
    await page.evaluate(() => ThemeSeoContract.initializeWechatShare());
    releaseSdk();
    await waitShare(page, 'Article A');
    assert.equal(requests(), 1, 'adopting an existing SDK must not duplicate its download');
    assert.equal(await page.evaluate(() => __sdk.configs.length), 1);
  }, { cold: true, holdSdk: true });

  await scenario('late SDK configures only the latest committed page', async ({ page, releaseSdk, requests }) => {
    await startInert(page);
    await navigate(page);
    releaseSdk();
    await waitShare(page, 'Article B');
    assert.deepEqual(await page.evaluate(() => __sdk.messages.map((item) => item.title)), ['Article B']);
    assert.equal(requests(), 1);
  }, { holdSdk: true });

  await scenario('late ready for A cannot overwrite B', async ({ page }) => {
    await startInert(page, html(signature('A')), true);
    await page.waitForFunction(() => window.__sdk?.configs.length === 1);
    await navigate(page);
    await page.waitForFunction(() => __sdk.configs.length === 2);
    await page.evaluate(() => { __sdk.ready[1](); __sdk.ready[0](); });
    assert.deepEqual(await page.evaluate(() => __sdk.messages.map((item) => item.title)), ['Article B']);
  });

  await scenario('a failed SDK download retries after online recovery', async ({ page, requests }) => {
    await startInert(page);
    await page.waitForFunction(() => !document.querySelector('script[src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"]'));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitShare(page, 'Article A');
    assert.equal(requests(), 2);
  }, { failFirstSdk: true });

  await scenario('stale config errors cannot poison a successful retry', async ({ page }) => {
    await startInert(page, html(signature('A')), true);
    await page.waitForFunction(() => window.__sdk?.configs.length === 1);
    await page.evaluate(() => { __sdk.errors[0]({ errMsg: 'fixture failure' }); window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => __sdk.configs.length === 2);
    await page.evaluate(() => { __sdk.errors[0]({ errMsg: 'late old failure' }); __sdk.ready[1](); __sdk.ready[0](); });
    assert.deepEqual(await page.evaluate(() => __sdk.messages.map((item) => item.title)), ['Article A']);
  });

  await scenario('repeated responses and recovery events are idempotent after ready', async ({ page, requests }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    await navigate(page, html(signature('A')), '/a');
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); });
    assert.equal(await page.evaluate(() => __sdk.configs.length), 1);
    assert.equal(requests(), 1);
  });

  await scenario('leaving a share page cancels pending SDK work', async ({ page, releaseSdk }) => {
    await startInert(page);
    await navigate(page, html(null), '/no-share');
    releaseSdk();
    await page.waitForFunction(() => window.__sdk);
    assert.deepEqual(await page.evaluate(() => __sdk.configs), []);
    assert.deepEqual(await page.evaluate(() => __sdk.messages), []);
  }, { holdSdk: true });

  await scenario('leaving before ready blocks stale updates; a later signed response recovers', async ({ page }) => {
    await startInert(page, html(signature('A')), true);
    await page.waitForFunction(() => window.__sdk?.configs.length === 1);
    await navigate(page, html(null), '/no-share');
    await page.evaluate(() => __sdk.ready[0]());
    assert.deepEqual(await page.evaluate(() => __sdk.messages), []);
    await navigate(page);
    await page.waitForFunction(() => __sdk.configs.length === 2);
    await page.evaluate(() => __sdk.ready[1]());
    await waitShare(page, 'Article B');
  });

  await scenario('leaving a configured share page requires a document navigation', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const decisions = await page.evaluate(async (response) => {
      const target = new DOMParser().parseFromString(response, 'text/html');
      return await ThemeSeoContract.requiresWechatShareDocumentNavigation(target);
    }, html(null));
    assert.equal(decisions, true, 'a target without signed data must reset the old native share context');
    await page.goto('https://fixture.invalid/no-share');
    assert.equal(await page.evaluate(() => Boolean(window.wx)), false);
  });

  await scenario('deferred SDK callback exceptions remain recoverable', async ({ page }) => {
    await startInert(page, html(signature('A')), true);
    await page.waitForFunction(() => window.__sdk?.configs.length === 1);
    const escaped = await page.evaluate(() => {
      window.__throwShare = true;
      try { __sdk.ready[0](); return false; } catch (_error) { return true; }
    });
    assert.equal(escaped, false, 'SDK update errors must not escape a delayed callback into the application');
    await page.evaluate(() => { window.__throwShare = false; window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => __sdk.configs.length === 2);
    await page.evaluate(() => __sdk.ready[1]());
    await waitShare(page, 'Article A');
  });

  await scenario('missing credentials do not invent config and later server data recovers', async ({ page, requests }) => {
    await startInert(page, html(null));
    assert.equal(requests(), 0);
    await navigate(page);
    await waitShare(page, 'Article B');
  });

  for (const [name, status, body] of [
    ['no-content', 204, ''],
    ['partial-signed', 206, html(signature('B')).split('</head>')[0]],
    ['truncated-signed', 200, html(signature('B')).split('</head>')[0]]
  ]) {
    await scenario('local signature rejects '+name, async ({ page }) => {
      await startInert(page); await waitShare(page, 'Article A');
      const unchanged = await page.evaluate(async () => {
        try { await ThemeSeoContract.prepareWechatShareLocalNavigation('/local'); return false; }
        catch { return __sdk.messages.at(-1)?.title === 'Article A'; }
      });
      assert.equal(unchanged, true, 'Incomplete responses cannot replace the current signature');
    }, { responses: { '/local': { status, body } } });
  }

  await scenario('QQ UA uses signed data', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    await navigate(page);
    await waitShare(page, 'Article B');
  }, { ua: 'Mozilla/5.0 QQ/9.0.0' });

  await scenario('ordinary browsers do not fetch SDK or configure sharing', async ({ page, requests }) => {
    await startInert(page);
    await navigate(page);
    assert.equal(requests(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.wx)), false);
  }, { ua: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' });

  await scenario('unrecognized JavaScript and malformed signed data never execute', async ({ page, requests }) => {
    await startInert(page, html(null));
    const valid = signature('B');
    const variants = [
      html(valid).replace('    function configure()', '    window.__injected = true;\n    function configure()'),
      html(valid).replace(sdkUrl, 'https://evil.invalid/sdk.js'),
      html({ ...valid, config: { ...valid.config, signature: 'invalid' } }),
      html({ ...valid, share: { ...valid.share, link: 'javascript:alert(1)' } }),
      html({ ...valid, config: { ...valid.config, jsApiList: ['updateAppMessageShareData', 'getLocation'] } }),
      html(valid, pluginScript(signature('A'))),
      html(null, '<script>window.__injected = true</script>')
    ];
    for (const response of variants) await navigate(page, response);
    assert.equal(requests(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
  });

  await scenario('escaped content and signed query ordering remain unchanged', async ({ page }) => {
    const data = signature('A');
    data.share.title = '</script> & 中文';
    data.share.link = 'https://configured.example/a?z=%2f&x=1&x=2';
    await startInert(page, html(data));
    await waitShare(page, '</script> & 中文');
    assert.equal(await page.evaluate(() => __sdk.messages.at(-1).link), 'https://configured.example/a?z=%2f&x=1&x=2');
  });

  const localHtml = html(signature('B')).replace('<title>Fixture</title>', '<title>Local B</title>');
  await scenario('local query navigation prefetches a signature and preserves the document', async ({ page, documentRequests }) => {
    await page.evaluate(() => { document.cookie = 'share-fixture=local-only; SameSite=Lax; path=/'; });
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      const timeOrigin = performance.timeOrigin;
      const doc = await ThemeSeoContract.prepareWechatShareLocalNavigation?.('/local?p=2&sort=asc');
      const before = __sdk.messages.at(-1).title;
      const title = doc?.title;
      const fallback = doc ? await ThemeSeoContract.requiresWechatShareDocumentNavigation(doc) : true;
      if (doc && !fallback) {
        history.pushState({}, '', '/local?p=2&sort=asc');
        ThemeSeoContract.syncWechatShareFromDocument(doc);
      }
      return { before, title, fallback, timeOrigin, afterTimeOrigin: performance.timeOrigin };
    });
    assert.equal(result.title, 'Local B', 'local navigation needs a server-signed target document');
    assert.equal(result.before, 'Article A', 'prefetch must not change the currently committed share');
    assert.equal(result.fallback, false, 'a valid target signature must retain local navigation');
    assert.equal(result.timeOrigin, result.afterTimeOrigin);
    await waitShare(page, 'Article B');
    assert.equal(documentRequests.length, 1);
    assert.equal(documentRequests[0].method, 'GET');
    assert.match(documentRequests[0].headers.accept, /text\/html/);
    assert.match(documentRequests[0].headers.cookie, /share-fixture=local-only/);
  }, { responses: { '/local': { body: localHtml } } });

  await scenario('local target without signature requests fallback without altering the source', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      const doc = await ThemeSeoContract.prepareWechatShareLocalNavigation('/no-config?p=2');
      return { fallback: await ThemeSeoContract.requiresWechatShareDocumentNavigation(doc), title: __sdk.messages.at(-1).title, path: location.pathname };
    });
    assert.deepEqual(result, { fallback: true, title: 'Article A', path: '/a' });
  }, { responses: { '/no-config': { body: html(null) } } });

  await scenario('failed local prefetch leaves the committed share untouched', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      let rejected = false;
      try { await ThemeSeoContract.prepareWechatShareLocalNavigation('/failure'); } catch (_error) { rejected = true; }
      return { rejected, title: __sdk.messages.at(-1).title, path: location.pathname };
    });
    assert.deepEqual(result, { rejected: true, title: 'Article A', path: '/a' });
  }, { responses: { '/failure': { body: 'temporarily unavailable', status: 503 } } });

  await scenario('aborted local prefetch cannot update the current signature', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      const controller = new AbortController();
      const pending = ThemeSeoContract.prepareWechatShareLocalNavigation('/slow', { signal: controller.signal });
      controller.abort();
      let error;
      try { await pending; } catch (caught) { error = caught.name; }
      return { error, title: __sdk.messages.at(-1).title };
    });
    assert.deepEqual(result, { error: 'AbortError', title: 'Article A' });
  }, { responses: { '/slow': { body: localHtml, delay: 50 } } });

  await scenario('a newer local prefetch invalidates an older response', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      const old = ThemeSeoContract.prepareWechatShareLocalNavigation('/slow').then(() => 'accepted', (error) => error.name);
      const next = await ThemeSeoContract.prepareWechatShareLocalNavigation('/local');
      return { old: await old, nextTitle: next.title, current: __sdk.messages.at(-1).title };
    });
    assert.deepEqual(result, { old: 'AbortError', nextTitle: 'Local B', current: 'Article A' });
  }, { responses: { '/slow': { body: html(signature('A')), delay: 50 }, '/local': { body: localHtml } } });

  await scenario('a newly committed page invalidates an older local prefetch', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async (response) => {
      const old = ThemeSeoContract.prepareWechatShareLocalNavigation('/slow').then(() => 'accepted', (error) => error.name);
      ThemeSeoContract.syncSeoHeadFromResponse(response);
      return { old: await old, current: __sdk.messages.at(-1).title };
    }, html(signature('B')));
    assert.deepEqual(result, { old: 'AbortError', current: 'Article B' });
  }, { responses: { '/slow': { body: html(signature('A')), delay: 50 } } });

  await scenario('non-HTML local responses cannot become signature documents', async ({ page }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const result = await page.evaluate(async () => {
      try { await ThemeSeoContract.prepareWechatShareLocalNavigation('/json'); return false; } catch (_error) { return __sdk.messages.at(-1).title === 'Article A'; }
    });
    assert.equal(result, true);
  }, { responses: { '/json': { body: '{}', contentType: 'application/json' } } });

  await scenario('cross-origin local targets are rejected before a request', async ({ page, documentRequests, networkRequests }) => {
    await startInert(page);
    await waitShare(page, 'Article A');
    const rejected = await page.evaluate(async () => {
      try { await ThemeSeoContract.prepareWechatShareLocalNavigation('https://evil.invalid/target'); return false; } catch (_error) { return true; }
    });
    assert.equal(rejected, true);
    assert.equal(documentRequests.length, 0);
    assert.equal(networkRequests.some((url) => url.startsWith('https://evil.invalid/')), false);
    assert.equal(await page.evaluate(() => __sdk.messages.at(-1).title), 'Article A');
  });

  for (const ordinary of [false, true]) {
    await scenario(`local prefetch skips ${ordinary ? 'ordinary UA' : 'pages without managed signatures'}`, async ({ page, documentRequests }) => {
      await startInert(page, ordinary ? html(signature('A')) : html(null));
      const result = await page.evaluate(() => ThemeSeoContract.prepareWechatShareLocalNavigation('/local'));
      assert.equal(result, null);
      assert.equal(documentRequests.length, 0);
    }, { ua: ordinary ? 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' : undefined });
  }
  console.log(`PASS ${passed} WeChat/PJAX scenarios (synthetic signatures; official SDK requests intercepted locally)`);
} finally {
  await browser.close();
}
