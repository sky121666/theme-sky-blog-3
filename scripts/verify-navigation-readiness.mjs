import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const evidencePath = 'docs/evidence/pjax-design-2026-09-28/readiness-results.json';
const records = [];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function openReadyPage(browser) {
  const page = await browser.newPage();
  await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.pjax?.loadUrl
    && window.Alpine?.store('themeSettings')
    && document.body.dataset.appId === 'links');
  await page.evaluate(() => {
    window.__navigationReadinessProbe = { events: [] };
    const events = window.__navigationReadinessProbe.events;
    document.addEventListener('theme:navigation-accepted', (event) => {
      const { intentId, url, source } = event.detail || {};
      events.push({ type: 'accepted', intentId, url, source });
    });
    document.addEventListener('theme:pjax-ready', (event) => {
      const { intentId, url, appId, root, mode } = event.detail || {};
      const frame = document.getElementById('window-frame-root');
      const contentRoot = document.querySelector('[data-window-content-root]');
      const overlay = contentRoot?.querySelector('[data-window-loading-overlay]');
      let resolvedUrl = '';
      try { resolvedUrl = new URL(url, window.location.href).href; } catch (_error) {}
      events.push({
        type: 'ready', intentId, url, appId, mode,
        observed: {
          resolvedUrl,
          location: window.location.href,
          historyUrl: window.history.state?.url || '',
          historyIndex: window.history.state?.__browserNavIndex,
          bodyAppId: document.body.dataset.appId || '',
          bodyPageApp: document.body.dataset.pageApp || '',
          rootTag: root?.tagName || '',
          rootId: root?.id || '',
          rootConnected: root?.isConnected === true,
          rootInFrame: Boolean(root && frame && (root === frame || frame.contains(root))),
          frameLoading: frame?.classList.contains('pjax-loading') === true,
          contentBusy: contentRoot?.getAttribute('aria-busy') === 'true',
          overlayVisible: overlay?.getAttribute('aria-hidden') === 'false'
        }
      });
    });
    document.addEventListener('theme:navigation-settled', (event) => {
      const { intentId, url, outcome, reason } = event.detail || {};
      events.push({ type: 'settled', intentId, url, outcome, reason });
    });
    document.addEventListener('pjax:complete', () => events.push({ type: 'legacy-full-complete' }));
    document.addEventListener('pjax:same-variant-complete', () => {
      events.push({ type: 'legacy-same-complete' });
    });
  });
  return page;
}

async function gateHtml(page, pathname) {
  const arrived = deferred();
  const released = deferred();
  const requests = [];
  await page.route(new URL(pathname, base).href, async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    requests.push({ url: route.request().url(), type: route.request().resourceType() });
    arrived.resolve();
    await released.promise;
    try { await route.continue(); } catch (_error) { /* A superseded XHR may already be aborted. */ }
  });
  return { arrived: arrived.promise, release: released.resolve, requests };
}

async function waitForRequest(gate, label) {
  let timeout;
  try {
    await Promise.race([
      gate.arrived,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}: HTML request not started`)), 10000);
      })
    ]);
  } finally { clearTimeout(timeout); }
}

async function navigate(page, target, mode = 'full') {
  await page.evaluate(({ target, mode }) => {
    if (mode === 'full') {
      void window.pjax.loadUrl(target);
      return;
    }
    const link = document.createElement('a');
    link.className = 'pjax-link';
    link.dataset.pjaxApp = 'links';
    link.href = target;
    document.body.append(link);
    link.click();
    link.remove();
  }, { target, mode });
}

async function waitForSettled(page, count = 1) {
  await page.waitForFunction((expected) => window.__navigationReadinessProbe.events
    .filter((event) => event.type === 'settled').length >= expected, count);
  return page.evaluate(() => window.__navigationReadinessProbe.events);
}

function assertReadySequence(events, expectedMode, expectedUrl) {
  const accepted = events.filter((event) => event.type === 'accepted');
  const ready = events.filter((event) => event.type === 'ready');
  const settled = events.filter((event) => event.type === 'settled');
  assert.equal(accepted.length, 1, `expected one accepted intent: ${JSON.stringify(events)}`);
  assert.equal(ready.length, 1, `expected one ready event: ${JSON.stringify(events)}`);
  assert.deepEqual(settled.map((event) => event.outcome), ['ready']);
  assert.equal(ready[0].intentId, accepted[0].intentId);
  assert.equal(settled[0].intentId, accepted[0].intentId);
  assert.ok(events.indexOf(ready[0]) < events.indexOf(settled[0]), 'ready must precede settled');
  assert.equal(ready[0].mode, expectedMode);
  assert.equal(ready[0].observed.resolvedUrl, new URL(expectedUrl, base).href);
  assert.equal(ready[0].observed.location, ready[0].observed.resolvedUrl);
  assert.equal(ready[0].observed.historyUrl, ready[0].observed.location);
  assert.ok(Number.isFinite(ready[0].observed.historyIndex));
  assert.equal(ready[0].appId, ready[0].observed.bodyPageApp);
  assert.equal(ready[0].appId, ready[0].observed.bodyAppId);
  assert.equal(ready[0].observed.rootConnected, true);
  assert.equal(ready[0].observed.rootInFrame, true);
  assert.equal(ready[0].observed.frameLoading, false);
  assert.equal(ready[0].observed.contentBusy, false);
  assert.equal(ready[0].observed.overlayVisible, false);
}

const browser = await chromium.launch();
try {
  for (const { name, mode, target, finalUrl } of [
    { name: 'full ready', mode: 'full', target: '/archives', finalUrl: '/archives' },
    { name: 'same ready', mode: 'same', target: '/links?view=friends', finalUrl: '/links?view=friends' },
    { name: 'same canonical ready', mode: 'same', target: '/links?group=__missing__', finalUrl: '/links' }
  ]) {
    const page = await openReadyPage(browser);
    const gate = await gateHtml(page, target);
    try {
      await navigate(page, target, mode);
      await waitForRequest(gate, name);
      gate.release();
      const events = await waitForSettled(page);
      records.push({ name, requests: gate.requests, events });
      assertReadySequence(events, mode, finalUrl);
    } finally {
      gate.release();
      await page.close();
    }
  }

  {
    const page = await openReadyPage(browser);
    try {
      await page.route(new URL('/archives', base).href, (route) => route.abort('failed'));
      await navigate(page, '/archives');
      const events = await waitForSettled(page);
      records.push({ name: 'full network failure', events });
      assert.equal(events.filter((event) => event.type === 'ready').length, 0);
      assert.deepEqual(events.filter((event) => event.type === 'settled').map((event) => event.outcome), ['failed']);
      assert.equal(events.filter((event) => event.type === 'legacy-full-complete').length, 1,
        'Pjax keeps its legacy complete event on a failed response');
      assert.equal(await page.evaluate(() => location.pathname), '/links');
    } finally { await page.close(); }
  }

  for (const mode of ['full', 'same']) {
    const name = `${mode} draft changed while fetching`;
    const target = mode === 'full' ? '/archives' : '/links?view=friends';
    const page = await openReadyPage(browser);
    const gate = await gateHtml(page, target);
    try {
      await navigate(page, target, mode);
      await waitForRequest(gate, name);
      await page.evaluate(() => { window.Alpine.store('themeSettings').draftMutationVersion += 1; });
      gate.release();
      const events = await waitForSettled(page);
      const state = await page.evaluate(() => ({
        url: location.pathname + location.search,
        mutationVersion: Alpine.store('themeSettings').draftMutationVersion
      }));
      records.push({ name, requests: gate.requests, events, state });
      assert.equal(events.filter((event) => event.type === 'ready').length, 0);
      assert.deepEqual(events.filter((event) => event.type === 'settled').map((event) => event.outcome), ['cancelled']);
      assert.equal(state.url, '/links');
      assert.ok(state.mutationVersion > 0);
    } finally {
      gate.release();
      await page.close();
    }
  }

  {
    const page = await openReadyPage(browser);
    const oldGate = await gateHtml(page, '/archives');
    const newGate = await gateHtml(page, '/links?view=friends');
    try {
      await navigate(page, '/archives');
      await waitForRequest(oldGate, 'old intent');
      await navigate(page, '/links?view=friends');
      await waitForRequest(newGate, 'new intent');
      const beforeStale = await page.evaluate(() => ({
        intents: window.__navigationReadinessProbe.events.filter((event) => event.type === 'accepted')
          .map((event) => event.intentId),
        loading: document.getElementById('window-frame-root')?.classList.contains('pjax-loading')
      }));
      assert.equal(beforeStale.intents.length, 2);
      assert.equal(beforeStale.loading, true, 'new intent must still own visible loading');
      await page.evaluate(async (oldIntentId) => {
        await window.pjax.handleResponse('<html><head><title>stale</title></head><body></body></html>',
          { status: 200, responseURL: new URL('/archives', location.origin).href },
          new URL('/archives', location.origin).href,
          { __themeNavigationIntent: oldIntentId });
      }, beforeStale.intents[0]);
      const afterStale = await page.evaluate(() => ({
        loading: document.getElementById('window-frame-root')?.classList.contains('pjax-loading'),
        events: window.__navigationReadinessProbe.events
      }));
      assert.equal(afterStale.loading, true, 'late old response must not clear new intent loading');
      assert.equal(afterStale.events.filter((event) => event.type === 'ready').length, 0);
      newGate.release();
      await waitForSettled(page, 2);
      oldGate.release();
      await page.waitForTimeout(150);
      const events = await page.evaluate(() => window.__navigationReadinessProbe.events);
      records.push({ name: 'latest intent wins', requests: {
        old: oldGate.requests, current: newGate.requests
      }, beforeStale, afterStale, events });
      const [oldIntent, currentIntent] = beforeStale.intents;
      assert.deepEqual(events.filter((event) => event.type === 'settled' && event.intentId === oldIntent)
        .map((event) => event.outcome), ['superseded']);
      assert.equal(events.filter((event) => event.type === 'ready' && event.intentId === oldIntent).length, 0);
      const currentEvents = events.filter((event) => event.intentId === currentIntent);
      assertReadySequence(currentEvents, 'full', '/links?view=friends');
    } finally {
      oldGate.release();
      newGate.release();
      await page.close();
    }
  }

  {
    const page = await openReadyPage(browser);
    const gate = await gateHtml(page, '/archives');
    page.on('dialog', (dialog) => dialog.dismiss());
    try {
      await page.evaluate(() => {
        window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });
        const button = document.createElement('button'); button.id = 'hydrate-fault-trigger';
        button.textContent = 'Navigate'; button.style.cssText = 'position:fixed;top:70px;left:15px;z-index:2147483647';
        button.onclick = () => window.pjax.loadUrl('/archives');
        document.body.append(button);
      });
      await page.click('#hydrate-fault-trigger');
      await waitForRequest(gate, 'hydrate failure');
      await page.waitForFunction(() => window.__THEME_PAGE_APP_REGISTRY__?.appLifecycles?.['explorer-archives']);
      await page.evaluate(() => {
        window.__THEME_PAGE_APP_REGISTRY__.appLifecycles['explorer-archives'].hydrate = () => {
          throw new Error('controlled hydrate fault');
        };
      });
      gate.release();
      const events = await waitForSettled(page);
      records.push({ name: 'hydrate failure after DOM commit', events });
      assert.equal(events.filter((event) => event.type === 'ready').length, 0);
      assert.deepEqual(events.filter((event) => event.type === 'settled').map((event) => event.outcome), ['native']);
      assert.equal(events.filter((event) => event.type === 'legacy-full-complete').length, 1);
    } finally { gate.release(); await page.close(); }
  }

  const context = await readLiveBuildContext(base);
  await fs.mkdir('docs/evidence/pjax-design-2026-09-28', { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify({ context, records }, null, 2) + '\n');
  console.log(`navigation readiness passed: ${records.length} scenarios; raw records saved locally`);
} finally {
  await browser.close();
}
