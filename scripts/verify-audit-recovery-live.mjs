import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

const base = new URL(process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090');
const { halo, build, buildInputRevision, verifiedAssets } = await readLiveBuildContext(base.href);
const output = await verificationOutput('audit-recovery-live');
const report = { base: base.origin, halo, build, buildInputRevision, verifiedAssets, cases: [], blockedWrites: [], pageErrors: [] };
const browser = await chromium.launch();

async function visit(page, route, app) {
  const response = await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(app => window.pjax?.loadUrl && window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === app
    && !window.__THEME_STARTUP__?.active && !document.querySelector('[data-theme-startup-layer]'), app);
}

async function navigation(page, mode) {
  const [source, app] = mode === 'full' ? ['/links', 'links'] : mode === 'docs' ? ['/docs', 'docsme'] : ['/archives', 'explorer-archives'];
  await visit(page, source, app);
  const target = await page.evaluate(mode => {
    const matches = mode === 'full' ? /^\/archives\/?$/ : /^\/archives\/\d{4}\/?$/;
    const link = mode === 'docs' ? document.querySelector('a.docsme-project-card[href]') : Array.from(document.querySelectorAll('a[href]')).find(a =>
      a.origin === location.origin && matches.test(a.pathname) && !a.hash && !a.search);
    if (!link) throw new Error('No link matching the scenario in the served page');
    window.audit = { link, doc: document, frame: document.getElementById('window-frame-root'), dock: document.querySelector('.dock-container'),
      widgets: [...document.querySelectorAll('.desktop-widget-card')], history: history.length, source: location.href, settled: [] };
    document.addEventListener('theme:navigation-settled', e => window.audit.settled.push(e.detail.outcome));
    return link.href;
  }, mode);
  const statuses = [206, 503], requests = [];
  await page.route(target, route => {
    const r = route.request();
    requests.push({ method: r.method(), native: r.isNavigationRequest() });
    const status = statuses.shift();
    return status ? route.fulfill({ status, contentType: 'text/html', body: '<p>incomplete</p>' }) : route.continue();
  });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { void window.pjax.loadUrl(window.audit.link.href, { triggerElement: window.audit.link }); });
    await page.waitForFunction(count => window.audit?.settled.length === count, i + 1);
    const state = await page.evaluate(() => ({ outcome: window.audit.settled.at(-1), sameDoc: document === window.audit.doc,
      sameFrame: window.audit.frame === document.getElementById('window-frame-root'),
      sameDock: !!window.audit.dock && window.audit.dock === document.querySelector('.dock-container'),
      sameWidgets: window.audit.widgets.length > 0 && window.audit.widgets.every(el => el.isConnected),
      atSource: location.href === window.audit.source, depth: history.length - window.audit.history,
      busy: window.audit.link.getAttribute('aria-busy') === 'true' }));
    assert.ok(state.sameDoc && state.sameDock && state.sameWidgets);
    assert.equal(state.busy, false);
    assert.equal(state.outcome, i === 2 ? 'ready' : 'failed');
    assert.equal(state.depth, i === 2 ? 1 : 0);
    if (i < 2) assert.ok(state.sameFrame && state.atSource);
  }
  assert.equal(page.url(), target);
  assert.deepEqual(requests, Array.from({ length: 3 }, () => ({ method: 'GET', native: false })));
  return { target, injected: [206, 503], requests, retry: 'served Halo HTML' };
}

async function moments(page) {
  await visit(page, '/moments', 'moments');
  const trigger = page.locator('[data-moment-photo]').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const viewer = page.locator('.moment-photo-viewer:not([hidden])');
  const close = viewer.locator('button[data-photo-close]');
  await close.waitFor({ state: 'visible' });
  assert.ok(await close.evaluate(el => el === document.activeElement));
  await page.keyboard.press('Shift+Tab');
  assert.ok(await viewer.evaluate(el => el.contains(document.activeElement) && !document.activeElement.matches('button[data-photo-close]')));
  await page.keyboard.press('Tab');
  assert.ok(await close.evaluate(el => el === document.activeElement));
  assert.ok(await trigger.evaluate(el => !!el.closest('[inert]')));
  await page.keyboard.press('Escape');
  assert.ok(await trigger.evaluate(el => !el.closest('[inert]') && document.activeElement === el));
  return { sample: await trigger.locator('xpath=ancestor::*[@data-moment-card][1]').getAttribute('data-moment-name'), injected: [] };
}

async function links(page, failure = 'disconnect') {
  const readPath = '/apis/console.api.link.halo.run/v1alpha1/rss/items';
  const sample = { id: 'local-check', title: '本地状态核对', url: base.href, linkName: 'verification', read: true, readLater: false, favorite: false };
  let reads = 0, writes = 0;
  await page.route(url => url.origin === base.origin && (
    url.pathname.startsWith(readPath) || url.pathname === '/apis/api.console.halo.run/v1alpha1/users/-'
    || url.pathname === '/apis/api.console.halo.run/v1alpha1/users/local-check/permissions'), route => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (pathname === readPath) { reads++; return route.fulfill({ json: { items: [sample], hasNext: false } }); }
      if (pathname.endsWith('/permissions')) return route.fulfill({ json: { uiPermissions: ['plugin:links:view'] } });
      if (pathname.endsWith('/unread-summary')) return route.fulfill({ json: { totalUnreadCount: 0 } });
      return route.fulfill({ json: { metadata: { name: 'local-check' }, spec: { displayName: '本地验收' } } });
    }
    if (route.request().method() === 'POST' && pathname === readPath + '/local-check/favorite') {
      writes++;
      sample.favorite = new URL(route.request().url()).searchParams.get('favorite') === 'true';
      if (writes === 1) return failure === 'gateway' ? route.fulfill({ status: 504, json: { detail: 'Gateway timeout' } }) : route.abort('failed');
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await visit(page, '/links?view=friends&scope=all', 'links');
  await page.locator('[data-feed-id="local-check"] .links-feed-title-button').click();
  const reader = page.locator('.links-feed-reader');
  const favorite = reader.getByRole('button', { name: '收藏', exact: true });
  await page.evaluate(() => { window.auditDoc = document; });
  await favorite.click();
  await page.locator('.links-feed-action-message').filter({ hasText: '待确认' }).waitFor({ state: 'visible' });
  assert.ok(await favorite.isDisabled());
  const before = reads;
  await page.getByRole('button', { name: '刷新动态' }).click();
  const undo = reader.getByRole('button', { name: '取消收藏', exact: true });
  await undo.waitFor({ state: 'visible' });
  assert.ok(await undo.isEnabled());
  assert.equal(reads, before + 1);
  assert.equal(writes, 1, 'reading back must not replay the POST');
  await undo.click();
  await favorite.waitFor({ state: 'visible' });
  assert.equal(writes, 2);
  assert.ok(await page.evaluate(() => window.auditDoc === document));
  return { simulated: 'identity, permissions, feed, unread count and both POSTs intercepted; no server writes',
    failure, readbackGets: reads - before, simulatedPosts: writes };
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
      if (url.origin === base.origin && url.pathname === '/apis/api.halo.run/v1alpha1/trackers/counter') return route.fulfill({ status: 204 });
      report.blockedWrites.push({ method: req.method(), path: url.pathname }); return route.abort('blockedbyclient');
    });
    for (const [name, run] of [
      ['full', page => navigation(page, 'full')], ['same', page => navigation(page, 'same')], ['docs', page => navigation(page, 'docs')],
      ['moments', moments], ['links', links], ['links-gateway', page => links(page, 'gateway')]
    ]) {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.pageErrors.push({ width, name, error: error.message }));
      try { report.cases.push({ width, name, passed: true, details: await run(page) }); }
      catch (error) { report.cases.push({ width, name, passed: false, error: error.message }); console.error(width, name, error.message); }
      finally { await page.close(); }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'recovery.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(report.cases.map(c => `${c.width} ${c.name}: ${c.passed ? 'PASS' : 'FAIL'}`).join('\n'));
assert.ok(report.cases.every(c => c.passed));
assert.deepEqual(report.pageErrors, []);
assert.deepEqual(report.blockedWrites, []);
