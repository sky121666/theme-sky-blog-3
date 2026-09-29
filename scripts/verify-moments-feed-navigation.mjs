import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
const redOnly = process.argv.includes('--red');
const evidenceDir = 'docs/evidence/moments-feed-2026-09-29';
const evidencePath = `${evidenceDir}/${redOnly ? 'red' : 'results'}.json`;
const timeout = 15_000;
const records = [];
const failures = [];
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 960 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
];
const absolute = (url) => new URL(url, base).href;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function openCase(browser, profile, record) {
  const context = await browser.newContext({ viewport: profile.viewport,
    isMobile: profile.isMobile || false, hasTouch: profile.hasTouch || false, reducedMotion: 'reduce' });
  await context.route('**/*', (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    const url = new URL(request.url());
    const item = { method: request.method(), url: request.url() };
    if (request.method() === 'POST' && url.origin === origin
      && url.pathname === '/apis/api.halo.run/v1alpha1/trackers/counter' && !url.search) {
      record.suppressedTelemetry.push(item);
      return route.fulfill({ status: 204, body: '' });
    }
    record.blockedWrites.push(item);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    window.__momentsFeedEvents = [];
    for (const [name, type] of [['theme:navigation-accepted', 'accepted'],
      ['theme:pjax-ready', 'ready'], ['theme:navigation-settled', 'settled']]) {
      document.addEventListener(name, (event) => {
        const { intentId, url, mode, outcome, reason } = event.detail || {};
        window.__momentsFeedEvents.push({ type, intentId, url, mode, outcome, reason });
      });
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => record.browserErrors.push({ message: error.message, stack: error.stack }));
  try {
    const response = await page.goto(absolute('/moments'), { waitUntil: 'commit', timeout });
    assert.equal(response?.status(), 200, 'Moments list must return 200');
    await page.waitForFunction(() => window.pjax?.loadUrl
      && window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === 'moments'
      && document.querySelector('.moments-app--feed .moments-tag'), null, { timeout });
    const tags = await page.locator('.moments-tag').evaluateAll((anchors) => anchors.map((anchor) => ({
      url: anchor.href, label: anchor.textContent.trim()
    })).filter(({ url }) => {
      const target = new URL(url);
      return target.origin === location.origin && target.pathname === '/moments'
        && !target.hash && [...target.searchParams.keys()].every((key) => key === 'tag');
    }));
    const queries = tags.filter(({ url }) => new URL(url).searchParams.has('tag'));
    assert.ok(queries.length >= 2, 'live Moments must expose two actual tag samples');
    record.tags = tags;
    await page.evaluate(() => {
      const selectors = { frame: '#window-frame-root', cover: '.moments-cover-wrapper',
        avatar: '.moments-cover-avatar', titlebar: '.window-titlebar', tags: '.moments-tags',
        app: '.moments-app--feed' };
      window.__momentsFeedNodes = Object.fromEntries(Object.entries(selectors)
        .map(([key, selector]) => [key, document.querySelector(selector)]));
      window.__momentsWholeLoading = [];
      const body = document.querySelector('[data-window-content-root]');
      const overlay = body.querySelector(':scope > [data-window-loading-overlay]');
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if ((mutation.target === body && mutation.attributeName === 'aria-busy'
            && (mutation.oldValue === 'true' || body.getAttribute('aria-busy') === 'true'))
            || (mutation.target === overlay && mutation.attributeName === 'aria-hidden'
            && (mutation.oldValue === 'false' || overlay.getAttribute('aria-hidden') === 'false'))) {
            window.__momentsWholeLoading.push({ attribute: mutation.attributeName, previous: mutation.oldValue });
          }
        }
      });
      observer.observe(body, { subtree: true, attributes: true, attributeOldValue: true,
        attributeFilter: ['aria-busy', 'aria-hidden'] });
    });
    return { context, page, tags, queries };
  } catch (error) { await context.close(); throw error; }
}

async function gateHtml(page, url, { abort = false } = {}) {
  const arrived = deferred();
  const released = deferred();
  const finished = deferred();
  const gate = { html: '', requests: [], error: null, release: released.resolve,
    arrived: () => bounded(arrived.promise, `HTML ${url}`),
    finished: () => bounded(finished.promise, `release ${url}`) };
  await page.route(url, async (route) => {
    assert.equal(route.request().method(), 'GET', 'HTML fixture must be a read-only GET');
    gate.requests.push({ url: route.request().url(), type: route.request().resourceType() });
    arrived.resolve();
    await released.promise;
    try {
      if (abort) await route.abort('failed');
      else {
        const response = await route.fetch();
        assert.equal(response.status(), 200, `live target HTML ${url}`);
        gate.html = await response.text();
        await route.fulfill({ response, body: gate.html });
      }
    } catch (error) {
      gate.error = error.message;
    } finally { finished.resolve(); }
  }, { times: 1 });
  return gate;
}

async function clickTag(page, url) {
  const index = await page.locator('.moments-tag').evaluateAll((anchors, target) =>
    anchors.findIndex((anchor) => anchor.href === target), url);
  assert.ok(index >= 0, `actual tag anchor must exist: ${url}`);
  await page.locator('.moments-tag').nth(index).click({ timeout });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const nodes = window.__momentsFeedNodes;
    const selectors = { frame: '#window-frame-root', cover: '.moments-cover-wrapper',
      avatar: '.moments-cover-avatar', titlebar: '.window-titlebar', tags: '.moments-tags',
      app: '.moments-app--feed' };
    const visible = (node) => {
      if (!node?.isConnected || !node.getClientRects().length) return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const windowRoot = document.querySelector('[data-window-content-root]');
    const wholeOverlay = windowRoot?.querySelector(':scope > [data-window-loading-overlay]');
    const region = document.querySelector('[data-moments-feed-region]');
    const listOverlay = region?.querySelector('[data-window-loading-overlay]');
    return {
      url: location.href, historyUrl: history.state?.url, historyLength: history.length,
      activeTags: [...document.querySelectorAll('.moments-tag.is-active')].map((link) => link.href),
      preserved: Object.fromEntries(Object.entries(selectors).map(([key, selector]) =>
        [key, Boolean(nodes[key]) && document.querySelector(selector) === nodes[key]])),
      visible: Object.fromEntries(['cover', 'avatar', 'titlebar', 'tags'].map((key) => [key, visible(nodes[key])])),
      wholeOverlayVisible: wholeOverlay?.getAttribute('aria-hidden') === 'false',
      wholeBusy: windowRoot?.getAttribute('aria-busy') === 'true',
      listOverlayVisible: listOverlay?.getAttribute('aria-hidden') === 'false',
      listBusy: region?.getAttribute('aria-busy') === 'true',
      listBoundary: Boolean(region),
      listContent: Boolean(region?.querySelector('[data-moments-feed-content]')),
      wholeLoadingTransitions: window.__momentsWholeLoading,
      events: window.__momentsFeedEvents
    };
  });
}

function assertPreserved(state, label) {
  for (const [key, value] of Object.entries(state.preserved)) assert.equal(value, true, `${label}: preserve ${key} DOM`);
  for (const [key, value] of Object.entries(state.visible)) assert.equal(value, true, `${label}: keep ${key} visible`);
}

function assertIdle(state) {
  assert.equal(state.wholeOverlayVisible, false, 'whole-window skeleton must remain hidden');
  assert.equal(state.wholeBusy, false, 'whole window must remain interactive');
  assert.equal(state.listOverlayVisible, false, 'feed skeleton must clear after navigation');
  assert.equal(state.listBusy, false, 'feed busy state must clear after navigation');
  assert.deepEqual(state.wholeLoadingTransitions, [], 'whole-window loading must never flash during a tag switch');
}

async function pendingState(page, record, label) {
  await page.waitForFunction(() => document.querySelector('[data-window-loading-overlay][aria-hidden="false"]'),
    null, { timeout });
  const state = await snapshot(page);
  const screenshot = `${evidenceDir}/${redOnly ? 'red' : 'green'}-${record.name}-${label}.png`;
  record.steps.push({ label, state, screenshot });
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.equal(state.wholeOverlayVisible, false, 'tag loading must not display the whole-window skeleton');
  assert.equal(state.wholeBusy, false, 'tag loading must not mark the whole window busy');
  assert.equal(state.listBoundary, true, 'tag loading requires the feed boundary');
  assert.equal(state.listContent, true, 'feed boundary must wrap list, pagination and empty content');
  assert.equal(state.listOverlayVisible, true, 'slow tag HTML must show the feed-only skeleton');
  assert.equal(state.listBusy, true, 'only feed boundary should be busy');
  assertPreserved(state, label);
  return state;
}

async function assertTarget(page, gate, url, record, from = 0, { latestOnly = false } = {}) {
  await page.waitForFunction(({ from, url }) => location.href === url
    && window.__momentsFeedEvents.slice(from).some((event) => event.type === 'settled' && event.outcome === 'ready'),
  { from, url }, { timeout });
  const state = await snapshot(page);
  record.steps.push({ label: 'settled', state });
  assertPreserved(state, 'settled');
  assert.equal(state.historyUrl, url);
  assert.deepEqual(state.activeTags, [url], 'active tag must match the committed URL');
  assertIdle(state);
  const events = state.events.slice(from);
  const ready = events.filter((event) => event.type === 'ready');
  assert.equal(ready.length, 1, 'only one target may become ready');
  assert.equal(ready[0].url, url);
  const active = events.filter((event) => event.intentId === ready[0].intentId);
  assert.deepEqual(active.map((event) => event.type), ['accepted', 'ready', 'settled']);
  assert.equal(active.at(-1).outcome, 'ready');
  if (!latestOnly) assert.equal(events.length, 3, 'one click must own exactly one navigation lifecycle');
  assert.equal(gate.error, null, 'the committed target must receive actual HTML successfully');
  assert.ok(gate.html, 'the committed target must have an actual HTML response');
  const contents = await page.evaluate((html) => {
    const expected = new DOMParser().parseFromString(html, 'text/html');
    const extract = (doc) => ({
      cards: [...doc.querySelectorAll('.moments-feed-list > article')].map((card) => ({
        id: card.dataset.momentName,
        text: card.querySelector('.moment-feed-body')?.textContent.replace(/\s+/g, ' ').trim() || ''
      })),
      empty: Boolean(doc.querySelector('.moment-feed-empty')),
      nextUrl: doc.querySelector('.moments-feed-pagination')?.getAttribute('data-next-url') || ''
    });
    return { expected: extract(expected), actual: extract(document) };
  }, gate.html);
  record.steps.push({ label: 'target-html-content', ...contents });
  assert.deepEqual(contents.actual, contents.expected, 'rendered list must match the actual target HTML');
}

async function normalSwitch(browser, profile, record) {
  const { context, page, queries } = await openCase(browser, profile, record);
  const target = queries[0].url;
  const gate = await gateHtml(page, target);
  try {
    await clickTag(page, target);
    await gate.arrived();
    await pendingState(page, record, 'pending');
    gate.release();
    await assertTarget(page, gate, target, record);
  } finally { gate.release(); await context.close(); }
}

async function rapidSwitch(browser, profile, record) {
  const { context, page, queries, tags } = await openCase(browser, profile, record);
  const all = tags.find(({ url }) => !new URL(url).search);
  assert.ok(all, 'live feed must expose the All tag');
  const targets = [queries[0].url, queries[1].url, all.url];
  const gates = [];
  try {
    const source = await snapshot(page);
    for (const [index, target] of targets.entries()) {
      const gate = await gateHtml(page, target);
      gates.push(gate);
      await clickTag(page, target);
      await gate.arrived();
      await pendingState(page, record, `pending-${index + 1}`);
    }
    gates[2].release();
    await assertTarget(page, gates[2], targets[2], record, 0, { latestOnly: true });
    const committed = await snapshot(page);
    assert.equal(committed.historyLength, source.historyLength,
      'rapid return to the committed source tag must not add a duplicate history entry');
    const accepted = committed.events.filter((event) => event.type === 'accepted');
    assert.equal(accepted.length, 3, 'three real clicks must each get one intent');
    for (const intent of accepted.slice(0, 2)) {
      assert.deepEqual(committed.events.filter((event) => event.intentId === intent.intentId
        && event.type === 'settled').map((event) => event.outcome), ['superseded']);
    }
    // Deliver both obsolete HTML responses after the final one has committed.
    gates[0].release(); gates[1].release();
    await Promise.all(gates.map((gate) => gate.finished()));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterStale = await snapshot(page);
    record.steps.push({ label: 'after-stale-responses', state: afterStale,
      requests: gates.map((gate) => gate.requests), staleErrors: gates.slice(0, 2).map((gate) => gate.error) });
    assert.deepEqual(afterStale, committed, 'obsolete responses must not replace current DOM, URL, active tag or lifecycle');
    await assertTarget(page, gates[2], targets[2], record, 0, { latestOnly: true });
  } finally {
    for (const gate of gates) gate.release();
    await context.close();
  }
}

async function abortedSwitchCanRetry(browser, profile, record) {
  const { context, page, queries } = await openCase(browser, profile, record);
  const target = queries[0].url;
  const aborted = await gateHtml(page, target, { abort: true });
  let retry;
  try {
    await clickTag(page, target);
    await aborted.arrived();
    await pendingState(page, record, 'before-abort');
    aborted.release();
    await page.waitForFunction(() => window.__momentsFeedEvents.some((event) =>
      event.type === 'settled' && event.outcome === 'failed'), null, { timeout });
    const failed = await snapshot(page);
    record.steps.push({ label: 'network-aborted', state: failed });
    assertPreserved(failed, 'network abort');
    assertIdle(failed);
    assert.equal(failed.url, absolute('/moments'), 'failure must keep the committed source URL');
    assert.deepEqual(failed.activeTags, [absolute('/moments')]);
    assert.deepEqual(failed.events.filter((event) => event.type === 'ready'), []);
    assert.deepEqual(failed.events.filter((event) => event.type === 'settled').map((event) => event.outcome), ['failed']);
    retry = await gateHtml(page, target);
    const from = failed.events.length;
    await clickTag(page, target);
    await retry.arrived();
    await pendingState(page, record, 'retry-pending');
    retry.release();
    await assertTarget(page, retry, target, record, from);
  } finally {
    aborted.release(); retry?.release(); await context.close();
  }
}

async function existingEmptyTag(browser, profile, record) {
  const { context, page, queries } = await openCase(browser, profile, record);
  let gate;
  try {
    let target = '';
    for (const candidate of queries) {
      const response = await page.request.get(candidate.url);
      assert.equal(response.status(), 200, 'discovered real tag must return HTML');
      const html = await response.text();
      const empty = await page.evaluate((html) => Boolean(new DOMParser().parseFromString(html, 'text/html')
        .querySelector('.moments-app--feed .moment-feed-empty')), html);
      record.steps.push({ label: 'empty-discovery', url: candidate.url, empty });
      if (empty) { target = candidate.url; break; }
    }
    if (!target) {
      record.status = 'skipped';
      record.reason = 'No actual live tag has an empty feed; no fixture or business data was created.';
      return;
    }
    gate = await gateHtml(page, target);
    await clickTag(page, target);
    await gate.arrived();
    await pendingState(page, record, 'empty-pending');
    gate.release();
    await assertTarget(page, gate, target, record);
    assert.equal(await page.locator('[data-moments-feed-content] .moment-feed-empty').isVisible(), true);
  } finally { gate?.release(); await context.close(); }
}

await fs.mkdir(evidenceDir, { recursive: true });
const buildContext = await readLiveBuildContext(base);
const browser = await chromium.launch();
try {
  const scenarios = (redOnly ? profiles.slice(0, 1) : profiles)
    .map((profile) => ({ name: `${profile.name}-normal`, profile, run: normalSwitch }));
  if (!redOnly) scenarios.push(
    { name: 'desktop-rapid-three-tags', profile: profiles[0], run: rapidSwitch },
    { name: 'desktop-abort-and-retry', profile: profiles[0], run: abortedSwitchCanRetry },
    { name: 'desktop-existing-empty-tag', profile: profiles[0], run: existingEmptyTag }
  );
  for (const scenario of scenarios) {
    const record = { name: scenario.name, steps: [], blockedWrites: [], suppressedTelemetry: [], browserErrors: [] };
    records.push(record);
    try {
      await scenario.run(browser, scenario.profile, record);
      assert.deepEqual(record.blockedWrites, [], 'read-only navigation must not attempt business writes');
      assert.deepEqual(record.browserErrors, [], 'tag navigation must not emit uncaught browser errors');
      record.status ||= 'passed';
    } catch (error) {
      record.status = 'failed'; record.error = { message: error.message, stack: error.stack };
      failures.push(record.name);
    }
    console.log(`${record.status}: ${record.name}${record.error ? `: ${record.error.message}` : ''}`);
  }
} finally {
  await browser.close();
  await fs.writeFile(evidencePath, JSON.stringify({ buildContext, records, failures }, null, 2) + '\n');
}
assert.deepEqual(failures, [], `Moments feed navigation failed; evidence: ${evidencePath}`);
console.log(`Moments feed navigation passed: ${records.filter((record) => record.status === 'passed').length} scenarios; `
  + `${records.filter((record) => record.status === 'skipped').length} skipped`);
