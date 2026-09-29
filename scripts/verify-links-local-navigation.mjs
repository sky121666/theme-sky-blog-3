import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
const browser = await chromium.launch();
const records = [];
const errors = [];
const writes = [];
let htmlRequests = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', (route) => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    writes.push({ method: request.method(), url: request.url() });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.pjax && document.querySelector('.links-app-shell')?._x_dataStack);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/links') htmlRequests++;
  });
  await page.evaluate(() => {
    window.__linksLocalProbe = {
      root: document.querySelector('.links-app-shell'), events: [], loading: false,
      timeOrigin: performance.timeOrigin
    };
    for (const type of ['theme:navigation-accepted', 'theme:pjax-ready', 'theme:navigation-settled']) {
      document.addEventListener(type, (event) => {
        const { intentId, url, outcome, mode } = event.detail || {};
        window.__linksLocalProbe.events.push({ type, intentId, url, outcome, mode });
      });
    }
    new MutationObserver((mutations) => {
      for (const { target, oldValue } of mutations) {
        if (target.classList?.contains('pjax-loading') || String(oldValue).includes('pjax-loading')
          || target.getAttribute?.('aria-busy') === 'true') window.__linksLocalProbe.loading = true;
      }
    }).observe(document.getElementById('window-frame-root'), {
      subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-busy']
    });
  });

  async function clickHeader(path) {
    const group = page.locator('.menubar-menu-group').filter({
      has: page.locator(`a.menubar-dropdown-item[href="${path}"]`)
    });
    // Leave the previously closed dropdown before entering its hover group again.
    await page.mouse.move(0, 0);
    await group.locator('button.menubar-item--desktop').hover();
    await group.locator(`a.menubar-dropdown-item[href="${path}"]`).click();
  }

  async function expectLocal(label, path, action, { lifecycle = true } = {}) {
    const before = await page.evaluate(() => ({
      events: window.__linksLocalProbe.events.length,
      index: history.state.__browserNavIndex,
      length: history.length, path: location.pathname + location.search
    }));
    const requestsBefore = htmlRequests;
    await action();
    await page.waitForFunction(({ path, eventOffset, lifecycle }) =>
      location.pathname + location.search === path
      && document.querySelector('.links-app-shell')?.dataset.view === (path.includes('view=friends') ? 'friends' : 'links')
      && (!lifecycle || window.__linksLocalProbe.events.slice(eventOffset)
        .some((event) => event.type === 'theme:navigation-settled' && event.outcome === 'ready')),
    { path, eventOffset: before.events, lifecycle }, { timeout: 10000 });
    const state = await page.evaluate((offset) => ({
      sameRoot: window.__linksLocalProbe.root === document.querySelector('.links-app-shell'),
      sameDocument: window.__linksLocalProbe.timeOrigin === performance.timeOrigin,
      loading: window.__linksLocalProbe.loading,
      historyUrl: history.state.url, url: location.href, title: document.title,
      view: document.querySelector('.links-app-shell').dataset.view,
      events: window.__linksLocalProbe.events.slice(offset), length: history.length,
      index: history.state.__browserNavIndex
    }), before.events);
    assert.equal(state.sameRoot, true, `${label}: preserve the active Links component`);
    assert.equal(state.sameDocument, true, `${label}: preserve the document`);
    assert.equal(htmlRequests, requestsBefore, `${label}: no Links HTML request`);
    assert.equal(state.loading, false, `${label}: no window loading skeleton`);
    assert.equal(state.historyUrl, state.url);
    if (lifecycle) {
      assert.deepEqual(state.events.map((event) => event.type),
        ['theme:navigation-accepted', 'theme:pjax-ready', 'theme:navigation-settled']);
      assert.equal(state.events[1].mode, 'local');
      assert.equal(state.events[0].intentId, state.events[2].intentId);
    }
    records.push({ label, before, state });
    return { before, state };
  }

  await expectLocal('Header links to friends', '/links?view=friends', () => clickHeader('/links?view=friends'));
  await expectLocal('Header friends to links', '/links', () => clickHeader('/links'));
  const repeated = await expectLocal('Header same view', '/links', () => clickHeader('/links'));
  assert.equal(repeated.state.index, repeated.before.index, 'same view must not add history');
  await expectLocal('rail friends', '/links?view=friends', () => page.locator('.links-rail-button[title="朋友圈"]').click(), { lifecycle: false });
  await expectLocal('history back', '/links', () => page.goBack({ waitUntil: 'commit' }));
  await expectLocal('history forward', '/links?view=friends', () => page.goForward({ waitUntil: 'commit' }));

  for (const action of ['click', 'popstate']) {
    const before = await page.evaluate(() => ({ url: location.href, state: history.state }));
    const requestsBefore = htmlRequests;
    await page.evaluate(() => {
      window.__linksLocalVetoes = 0;
      window.addEventListener('theme:before-pjax-navigation', (event) => {
        window.__linksLocalVetoes++; event.preventDefault();
      }, { once: true });
    });
    if (action === 'click') await clickHeader('/links');
    else await page.evaluate(() => history.back());
    await page.waitForFunction((url) => window.__linksLocalVetoes === 1 && location.href === url, before.url);
    const after = await page.evaluate(() => ({ url: location.href, view: document.querySelector('.links-app-shell').dataset.view }));
    assert.equal(after.view, 'friends', `${action} veto: preserve the original view`);
    assert.equal(htmlRequests, requestsBefore, `${action} veto: no request`);
    records.push({ label: `${action} veto`, before, after });
  }

  // A slow ordinary PJAX response must never overwrite a later local view.
  const raceTarget = '/links?view=friends&scope=all&localRace=1';
  let releaseResponse;
  let reportHeld;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const responseHeld = new Promise((resolve) => { reportHeld = resolve; });
  await page.route(new URL(raceTarget, base).href, async (route) => {
    const response = await route.fetch();
    reportHeld();
    await responseGate;
    await route.fulfill({ response });
  });
  await page.evaluate((path) => {
    void window.pjax.loadUrl(new URL(path, location.href).href);
  }, raceTarget);
  await responseHeld;
  const failedRequest = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === new URL(raceTarget, base).href
  });
  // Pending navigation intentionally hides dropdowns. Use an exposed link
  // fixture to exercise the same delegated click owner during that request.
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'local-race-link'; link.className = 'pjax-link';
    link.href = '/links'; link.textContent = 'Return to links';
    link.style.cssText = 'position:fixed;left:0;bottom:0;z-index:100000';
    document.body.append(link);
  });
  await page.locator('#local-race-link').click();
  await page.waitForFunction(() => location.search === ''
    && window.__linksLocalProbe.events.at(-1)?.outcome === 'ready');
  await failedRequest;
  releaseResponse();
  await page.unrouteAll({ behavior: 'wait' });
  await page.locator('#local-race-link').evaluate((link) => link.remove());
  const race = await page.evaluate(() => ({
    url: location.pathname + location.search,
    view: document.querySelector('.links-app-shell').dataset.view,
    sameRoot: window.__linksLocalProbe.root === document.querySelector('.links-app-shell'),
    loading: !!document.querySelector('.pjax-loading, #window-frame-root [aria-busy="true"]'),
    events: window.__linksLocalProbe.events.slice(-5)
  }));
  assert.equal(race.url, '/links');
  assert.equal(race.view, 'links');
  assert.equal(race.sameRoot, true);
  assert.equal(race.loading, false);
  assert.equal(race.events.some((event) => event.outcome === 'superseded'), true);
  assert.equal(race.events.filter((event) => event.type === 'theme:pjax-ready').length, 1);
  records.push({ label: 'local view supersedes pending HTML', state: race });

  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(writes, [], 'no business writes');
  const liveContext = await readLiveBuildContext(base);
  const dir = 'docs/evidence/header-controls-2026-09-29';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/links-local-results.json`, JSON.stringify({ context: liveContext, records, errors, writes }, null, 2) + '\n');
  console.log(`Links local navigation passed: ${records.length} scenarios`);
} finally {
  await browser.close();
}
