import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const readerPath = String(
  process.env.PLUGIN_RUNTIME_READER_PATH || '/archives/editor-feature-demo'
).trim();
const cycleCount = 3;
const normalizedReaderPath = new URL(readerPath, `${baseUrl}/`).pathname;
const expectedOnlinePathSequence = [
  '/archives',
  normalizedReaderPath,
  ...Array.from({ length: cycleCount }, () => ['/archives', normalizedReaderPath]).flat()
];

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
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

page.on('pageerror', (error) => {
  pageErrors.push(error?.message || String(error));
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

  await navigateWithPjax(page, readerPath);

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
  console.log(JSON.stringify({
    status: 'passed',
    readerPath,
    cycles: cycleCount,
    capabilities: { ...capabilities, expectsLightGallery },
    online: finalState,
    historyBridge
  }, null, 2));
} finally {
  await browser.close();
}
