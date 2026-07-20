import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const readerPath = String(
  process.env.PLUGIN_RUNTIME_READER_PATH || '/archives/editor-feature-demo'
).trim();
const lotteryPath = String(
  process.env.PLUGIN_RUNTIME_LOTTERY_PATH || '/archives/ijhJxHtw'
).trim();
const cycleCount = 3;
const knownStaleContentUrls = new Set([
  'http://192.168.1.23:8090/upload/5BB751C4-JdQx.JPEG',
  'http://192.168.1.23:8090/upload/2E3462BD-FtZg.jpeg',
  'http://192.168.1.23:8090/upload/1D1AF973-QjDN.jpg',
  'http://192.168.1.23:8090/upload/1D3408F2-pylZ.JPEG'
]);
const normalizedReaderPath = new URL(readerPath, `${baseUrl}/`).pathname;
const normalizedLotteryPath = new URL(lotteryPath, `${baseUrl}/`).pathname;
const expectedOnlinePathSequence = [
  '/archives',
  normalizedReaderPath,
  normalizedLotteryPath,
  normalizedReaderPath,
  ...Array.from({ length: cycleCount }, () => ['/archives', normalizedReaderPath]).flat()
];

const globalPluginAssets = {
  contactForm: { selector: 'script[src*="/plugins/PluginContactForm/"]' },
  hyperlinkCard: { selector: 'script[src*="/plugins/editor-hyperlink-card/"]' },
  lottery: { selector: 'script[src*="/plugins/lottery/"]' },
  restrictedReading: { selector: 'script[src*="/plugins/restricted-reading/"]' },
  vote: { selector: 'script[src*="/plugins/vote/"]' },
  aiAssistant: {
    selector: 'script:not([src])',
    text: '/plugins/ai-assistant/assets/static/rag-ui/rag-ui.js?v=2.2.4'
  }
};

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function isKnownStaleContentResourceError(entry) {
  if (entry?.text !== 'Failed to load resource: net::ERR_CONNECTION_REFUSED') return false;
  try {
    return knownStaleContentUrls.has(new URL(entry.url || '').href);
  } catch {
    return false;
  }
}

async function navigateWithPjax(page, target) {
  await page.evaluate((targetUrl) => new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener('pjax:complete', onComplete);
      document.removeEventListener('pjax:same-variant-complete', onComplete);
      document.removeEventListener('pjax:error', onError);
    };
    const onComplete = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`PJAX navigation failed: ${targetUrl}`));
    };

    document.addEventListener('pjax:complete', onComplete);
    document.addEventListener('pjax:same-variant-complete', onComplete);
    document.addEventListener('pjax:error', onError);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`PJAX navigation timeout: ${targetUrl}`));
    }, 15_000);

    const result = window.pjax?.loadUrl?.(targetUrl);
    if (!window.pjax?.loadUrl) {
      cleanup();
      reject(new Error('window.pjax.loadUrl is unavailable'));
      return;
    }
    Promise.resolve(result).catch(onError);
  }), absoluteUrl(target));

  await page.waitForTimeout(900);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
const consoleErrors = [];
const blockedWriteRequests = [];
const failedRequests = [];

page.on('pageerror', (error) => {
  pageErrors.push(error?.message || String(error));
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push({
      text: message.text(),
      url: message.location()?.url || ''
    });
  }
});
page.on('requestfailed', (request) => {
  failedRequests.push({
    method: request.method(),
    url: request.url(),
    error: request.failure()?.errorText || ''
  });
});
await page.route('**/*', async (route) => {
  const request = route.request();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
    blockedWriteRequests.push({ method: request.method(), url: request.url() });
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});

await page.addInitScript(() => {
  const NativeWebSocket = window.WebSocket;
  const sockets = new Set();
  const registeredPaths = [];
  const registrationPayloads = [];
  let constructed = 0;
  let maxActiveSockets = 0;

  const countActiveSockets = () => Array.from(sockets)
    .filter((socket) => socket.readyState === NativeWebSocket.CONNECTING
      || socket.readyState === NativeWebSocket.OPEN).length;

  function CountingWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    const monitored = String(url).includes('/apis/online-user.zyx2012.cn/v1alpha1/online-ws');
    if (!monitored) return socket;

    constructed += 1;
    sockets.add(socket);
    maxActiveSockets = Math.max(maxActiveSockets, countActiveSockets());
    socket.addEventListener('close', () => sockets.delete(socket), { once: true });
    const nativeSend = socket.send.bind(socket);
    socket.send = (payload) => {
      if (typeof payload === 'string') {
        try {
          const parsed = JSON.parse(payload);
          if (typeof parsed.uri === 'string' && Object.hasOwn(parsed, 'privatePage')) {
            registrationPayloads.push(parsed);
          }
        } catch (_error) {
          // Heartbeats and non-JSON frames are outside this contract.
        }
      }
      return nativeSend(payload);
    };
    return socket;
  }

  CountingWebSocket.prototype = NativeWebSocket.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => {
    Object.defineProperty(CountingWebSocket, key, { value: NativeWebSocket[key] });
  });
  window.WebSocket = CountingWebSocket;
  window.addEventListener('online-monitor:registered', (event) => {
    registeredPaths.push(event.detail?.path || '');
  });
  window.__THEME_INJECTED_PLUGIN_DEBUG__ = {
    snapshot() {
      return {
        activeSockets: countActiveSockets(),
        maxActiveSockets,
        constructed,
        registeredPaths: [...registeredPaths],
        registrationPayloads: registrationPayloads.map((payload) => ({ ...payload }))
      };
    }
  };
});

try {
  const readerContractResponse = await page.request.get(absoluteUrl(readerPath), {
    failOnStatusCode: false
  });
  assert.equal(readerContractResponse.status(), 200, `reader fixture should return 200: ${readerPath}`);
  const readerContractHtml = await readerContractResponse.text();
  const expectsLightGallery = readerContractHtml.includes('/plugins/PluginLightGallery/assets/static/');
  const lotteryContractResponse = await page.request.get(absoluteUrl(lotteryPath), {
    failOnStatusCode: false
  });
  assert.equal(lotteryContractResponse.status(), 200, `lottery fixture should return 200: ${lotteryPath}`);

  const response = await page.goto(absoluteUrl('/archives'), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(response?.status(), 200, 'archives fixture should return 200');
  await page.waitForFunction(() => Boolean(window.__THEME_MAIN_LOADED__), null, { timeout: 10_000 });
  await page.waitForTimeout(1200);

  const capabilities = await page.evaluate(() => ({
    online: Boolean(window.__ONLINE_MONITOR_META__)
  }));

  const inspectGlobalAssets = () => page.evaluate((descriptors) => Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => {
      const elements = Array.from(document.querySelectorAll(descriptor.selector));
      const matches = descriptor.text
        ? elements.filter((element) => element.textContent.includes(descriptor.text))
        : elements;
      return [key, matches.length];
    })
  ), globalPluginAssets);
  const assertSingleGlobalAssets = (snapshot, label) => {
    Object.entries(snapshot).forEach(([key, count]) => {
      assert.equal(count, 1, `${label}: ${key} should keep exactly one injected runtime`);
    });
  };

  assertSingleGlobalAssets(await inspectGlobalAssets(), 'archives');

  await navigateWithPjax(page, readerPath);

  await page.waitForFunction(() => [
    'vote-block',
    'hyperlink-card',
    'hyperlink-inline-card'
  ].every((name) => Boolean(customElements.get(name))), null, { timeout: 10_000 });
  const editorPluginState = await page.evaluate(() => ({
    voteBlocks: document.querySelectorAll('vote-block').length,
    hyperlinkCards: document.querySelectorAll('hyperlink-card').length,
    inlineCards: document.querySelectorAll('hyperlink-inline-card').length,
    upgraded: ['vote-block', 'hyperlink-card', 'hyperlink-inline-card']
      .every((name) => Boolean(customElements.get(name)))
  }));
  assert.equal(editorPluginState.voteBlocks, 2, 'editor fixture should expose two vote blocks');
  assert.equal(editorPluginState.hyperlinkCards, 3, 'editor fixture should expose three hyperlink cards');
  assert.equal(editorPluginState.inlineCards, 1, 'editor fixture should expose one inline hyperlink card');
  assert.equal(editorPluginState.upgraded, true, 'editor plugin elements should be upgraded after cold PJAX');
  assertSingleGlobalAssets(await inspectGlobalAssets(), 'editor fixture');

  if (expectsLightGallery) {
    const coldPjaxState = await page.evaluate(() => ({
      runtime: typeof window.lightGallery === 'function',
      images: document.querySelectorAll('#article-content img').length,
      uid: document.querySelector('#article-content')?.getAttribute('lg-uid') || '',
      instances: Object.keys(window.lgData || {}).filter((key) => /^lg\d+$/.test(key)).length
    }));
    assert.equal(coldPjaxState.runtime, true, 'cold PJAX reader should load the LightGallery runtime');
    assert.ok(coldPjaxState.images > 0, 'reader fixture should contain images');
    assert.ok(coldPjaxState.uid, 'cold PJAX reader should mount LightGallery');
    assert.equal(coldPjaxState.instances, 1, 'cold PJAX reader should keep one LightGallery instance');
  }


  await navigateWithPjax(page, lotteryPath);
  await page.waitForFunction(() => Boolean(customElements.get('lottery-card')), null, { timeout: 10_000 });
  const lotteryPluginState = await page.evaluate(() => ({
    cards: document.querySelectorAll('lottery-card').length,
    upgraded: Boolean(customElements.get('lottery-card'))
  }));
  assert.equal(lotteryPluginState.cards, 1, 'lottery fixture should expose one lottery card');
  assert.equal(lotteryPluginState.upgraded, true, 'lottery custom element should be upgraded');
  assertSingleGlobalAssets(await inspectGlobalAssets(), 'lottery fixture');

  await navigateWithPjax(page, readerPath);

  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    await navigateWithPjax(page, '/archives');

    if (expectsLightGallery) {
      const listState = await page.evaluate(() => ({
        article: Boolean(document.querySelector('#article-content')),
        instances: Object.keys(window.lgData || {}).filter((key) => /^lg\d+$/.test(key)).length
      }));
      assert.equal(listState.article, false, 'archives route should remove the reader article');
      assert.equal(listState.instances, 0, 'leaving reader should destroy the LightGallery instance');
    }

    await navigateWithPjax(page, readerPath);

    if (expectsLightGallery) {
      const readerState = await page.evaluate(() => ({
        uid: document.querySelector('#article-content')?.getAttribute('lg-uid') || '',
        instances: Object.keys(window.lgData || {}).filter((key) => /^lg\d+$/.test(key)).length
      }));
      assert.ok(readerState.uid, `cycle ${cycle + 1}: PJAX reader should remount LightGallery`);
      assert.equal(readerState.instances, 1, `cycle ${cycle + 1}: LightGallery instances should not leak`);
    }

    if (capabilities.online) {
      const onlineState = await page.evaluate(() => window.__THEME_INJECTED_PLUGIN_DEBUG__.snapshot());
      assert.ok(onlineState.activeSockets <= 1, `cycle ${cycle + 1}: Online should keep at most one active WebSocket`);
    }
  }

  await page.waitForTimeout(1800);
  const finalState = await page.evaluate(() => window.__THEME_INJECTED_PLUGIN_DEBUG__.snapshot());
  const finalGlobalAssets = await inspectGlobalAssets();
  assertSingleGlobalAssets(finalGlobalAssets, 'final PJAX state');
  if (capabilities.online) {
    assert.ok(finalState.registeredPaths.includes('/archives'), 'Online should report the PJAX list route');
    assert.ok(finalState.registeredPaths.includes(normalizedReaderPath), 'Online should report the PJAX reader route');
    assert.ok(finalState.activeSockets <= 1, 'Online should finish with at most one active WebSocket');
    assert.ok(finalState.maxActiveSockets <= 1, 'Online should never keep concurrent active WebSockets');
    assert.ok(
      finalState.constructed <= expectedOnlinePathSequence.length + 2,
      `Online should not reconnect in a storm: ${finalState.constructed} sockets / ${expectedOnlinePathSequence.length} expected navigations`
    );
    let sequenceCursor = 0;
    finalState.registeredPaths.forEach((path) => {
      if (path === expectedOnlinePathSequence[sequenceCursor]) sequenceCursor += 1;
    });
    assert.equal(
      sequenceCursor,
      expectedOnlinePathSequence.length,
      `Online registration sequence mismatch: ${finalState.registeredPaths.join(' -> ')}`
    );
    const relevantRegistrations = finalState.registrationPayloads
      .filter((payload) => payload.uri === '/archives'
        || payload.uri === normalizedReaderPath);
    assert.ok(relevantRegistrations.length >= 2, 'Online should send registration payloads for both routes');
    assert.ok(
      relevantRegistrations.every((payload) => payload.privatePage === false),
      'public route registration payloads should keep privatePage=false'
    );
  }

  const historyBridge = await page.evaluate(async () => {
    const originalState = window.history.state || {};
    const observePopstate = (state) => new Promise((resolve) => {
      window.addEventListener('popstate', () => {
        resolve(Boolean(window.__ONLINE_MONITOR_META__?.privatePage));
      }, { once: true });
      window.dispatchEvent(new PopStateEvent('popstate', { state }));
    });

    const privateObserved = await observePopstate({
      ...originalState,
      __themeOnlinePrivatePage: true
    });
    const publicObserved = await observePopstate({
      ...originalState,
      __themeOnlinePrivatePage: false
    });
    return { privateObserved, publicObserved };
  });
  assert.deepEqual(historyBridge, {
    privateObserved: true,
    publicObserved: false
  }, 'popstate capture should restore Online privatePage before bubble listeners run');

  assert.deepEqual(pageErrors, [], 'injected plugin lifecycle should not raise page errors');
  const pluginRequestFailures = failedRequests.filter((request) => request.url.includes('/plugins/'));
  const runtimeConsoleErrors = consoleErrors.filter((entry) => !isKnownStaleContentResourceError(entry));
  const contentResourceWarnings = failedRequests.filter((request) => (
    request.error === 'net::ERR_CONNECTION_REFUSED'
    && request.url.includes('/upload/')
  ));
  if (runtimeConsoleErrors.length > 0 || blockedWriteRequests.length > 0 || pluginRequestFailures.length > 0) {
    console.error(JSON.stringify({ runtimeConsoleErrors, blockedWriteRequests, pluginRequestFailures }, null, 2));
  }
  assert.deepEqual(runtimeConsoleErrors, [], 'injected plugin lifecycle should not raise actionable console errors');
  assert.deepEqual(pluginRequestFailures, [], 'injected plugin assets should not fail to load');
  assert.deepEqual(blockedWriteRequests, [], 'read-only plugin verification must not attempt mutating HTTP requests');
  console.log(JSON.stringify({
    status: 'passed',
    readerPath,
    lotteryPath,
    cycles: cycleCount,
    capabilities: { ...capabilities, expectsLightGallery },
    editorPluginState,
    lotteryPluginState,
    globalPluginAssets: finalGlobalAssets,
    contentResourceWarnings: Array.from(new Set(contentResourceWarnings.map((request) => request.url))),
    online: finalState,
    historyBridge
  }, null, 2));
} finally {
  await browser.close();
}
