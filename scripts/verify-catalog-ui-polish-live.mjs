import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { collectBrowserRuntimeErrors, installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

// Run only after the main agent confirms the shared build/reload. This file
// never injects scripts/styles, changes app state through evaluate, mocks data,
// or permits a non-read request. UI actions below browse public plugin data.
const outputDir = await verificationOutput('catalog-ui-polish-live');
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const origin = new URL(baseUrl).origin;
const widths = (process.env.UI_VERIFY_WIDTHS || '1440,390,320').split(',').map(Number);
assert.ok(widths.length && widths.every(width => Number.isInteger(width) && width >= 320), 'UI_VERIFY_WIDTHS requires widths >= 320');
const report = { observedAt: new Date().toISOString(), baseUrl, mode: 'real served HTML/JS/CSS; no injection; public read-only UI', identity: null, assets: [], scenarios: [], failures: [], missingSamples: [] };
const sha = content => crypto.createHash('sha256').update(content).digest('hex');
const resultsPath = path.join(outputDir, 'catalog-live-results.json');
let browser;
class SampleMissing extends Error {}
async function requireSample(locator, label) {
  try { await locator.first().waitFor({ state: 'visible' }); }
  catch (error) { if (!await locator.count()) throw new SampleMissing(label); throw error; }
}
const reads = new WeakMap();
const consumedReads = new WeakMap();
function readKey(value) { const url = new URL(value); url.hash = ''; url.searchParams.sort(); return url.href; }
function foreign(url) { try { return new URL(url).origin !== origin; } catch { return false; } }
function splitErrors(snapshot) {
  const externalUrls = new Set([...snapshot.requestFailures, ...snapshot.responseErrors]
    .filter(error => foreign(error.url) && ['image', 'media', 'font'].includes(error.resourceType)).map(error => error.url));
  const externalMedia = [], cancelledReads = [], gate = [];
  snapshot.pageErrors.forEach(error => gate.push({ kind: 'pageerror', error }));
  snapshot.consoleErrors.forEach(error => (externalUrls.has(error.url) ? externalMedia : gate).push({ kind: 'consoleerror', ...error }));
  for (const kind of ['requestFailures', 'responseErrors']) for (const error of snapshot[kind]) {
    if (externalUrls.has(error.url)) externalMedia.push({ kind, ...error });
    else if (kind === 'requestFailures' && error.method === 'GET' && error.errorText === 'net::ERR_ABORTED') cancelledReads.push({ kind, ...error });
    else gate.push({ kind, ...error });
  }
  return { gate, externalMedia, cancelledReads, warnings: snapshot.consoleWarnings, pageErrorDetails: snapshot.pageErrorDetails };
}
function phase(entry, name) { entry.phase = name; entry.phases.push({ name, at: new Date().toISOString() }); }
async function expectFocused(page, locator, entry, label) {
  try { await page.waitForFunction(el => el === document.activeElement, await locator.elementHandle(), { timeout: 5000 }); }
  catch (error) { throw new Error(`${entry.app}/${entry.width} [${entry.phase}] ${label}: exact focus did not settle; active=${await page.evaluate(() => document.activeElement?.outerHTML.slice(0,500))}`, { cause: error }); }
  assert.equal(await locator.evaluate(el => el === document.activeElement), true, `${entry.app}/${entry.width} [${entry.phase}] ${label}`);
}
async function screenshot(page, app, width, state) { await page.screenshot({ path: path.join(outputDir, `catalog-live-${app}-${width}-${state}.png`) }); }
async function noOverflow(page, root, entry, phase) {
  const geometry = await root.evaluate(el => {
    const viewport = innerWidth, box = el.getBoundingClientRect();
    return { viewport, documentWidth: document.documentElement.scrollWidth, root: { x: box.x, right: box.right, width: box.width },
      offenders: [...el.querySelectorAll('*')].filter(node => {
        if (!node.getClientRects().length || node.closest('[inert], [hidden]') || getComputedStyle(node).opacity === '0') return false;
        const r = node.getBoundingClientRect();
        return r.width > viewport + 2 && !node.closest('.steam-heatmap-panel, .douban-list-wrap');
      }).slice(0, 12).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })) };
  });
  entry.geometry.push({ phase, ...geometry });
  assert.ok(geometry.documentWidth <= geometry.viewport + 2, `${phase}: page overflow ${geometry.documentWidth}/${geometry.viewport}`);
  assert.ok(geometry.root.x >= -2 && geometry.root.right <= geometry.viewport + 2, `${phase}: app root exceeds viewport`);
}
async function visit(page, app) {
  const response = await page.goto(`${baseUrl}/${app}`, { waitUntil: 'commit', timeout: 25000 });
  assert.equal(response.status(), 200, `${app}: arrival document returns HTTP 200`);
  await page.waitForFunction(() => document.readyState !== 'loading');
  // Visible app markup can precede the startup controller releasing keyboard ownership.
  await page.waitForFunction(() => !document.querySelector('[data-theme-startup-layer]') && !window.__THEME_STARTUP__?.active, null, { timeout: 15000 });
  const root = page.locator(`[data-app-root="${app}"]`);
  await root.waitFor({ state: 'visible' });
  await page.waitForFunction(app => document.body.dataset.pageApp === app || document.body.dataset.appId === app, app);
  const current = readKey(page.url());
  consumedReads.get(page).set(current, reads.get(page).filter(url => url === current).length);
  return root;
}
async function browseLink(page, root, selector, predicate) {
  const link = root.locator(selector).first(), href = await link.getAttribute('href');
  assert.ok(href, `Browse link requires href: ${selector}`);
  await link.click();
  await page.waitForURL(predicate || new URL(href, page.url()).href);
  await root.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-animating')
    && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'));
  const key = readKey(new URL(href, baseUrl).href);
  const count = reads.get(page).filter(url => url === key).length;
  assert.equal(count - (consumedReads.get(page).get(key) || 0), 1, `Each navigation must consume exactly one destination GET, including prefetch: ${key}`);
  consumedReads.get(page).set(key, count);
}
async function assertCurrent(link) { assert.equal(await link.getAttribute('aria-current'), 'page', `Selected navigation link exposes aria-current=page: ${await link.getAttribute('href')}`); }
async function loadIfAvailable(page, root, buttonSelector, cardSelector, entry) {
  const button = root.locator(buttonSelector).first();
  if (!await button.count() || !await button.isVisible()) { entry.checks.push({ check: 'pagination', status: 'not-present', reason: 'No additional public page at this point; error recovery is covered by the isolated owner suite.' }); return; }
  const before = await root.locator(cardSelector).count();
  await button.scrollIntoViewIfNeeded();
  // Auto-loading may legitimately win the race when the button is scrolled into view.
  try { if (await button.isVisible()) await button.click({ timeout: 1800 }); }
  catch (error) { if (await root.locator(cardSelector).count() <= before) throw error; }
  await page.waitForFunction(({ appSelector, cardSelector, before }) => document.querySelector(appSelector)?.querySelectorAll(cardSelector).length > before,
    { appSelector: `[data-app-root="${entry.app}"]`, cardSelector, before }, { timeout: 12000 });
  entry.checks.push({ check: 'pagination', status: 'passed', before, after: await root.locator(cardSelector).count() });
}
async function douban(page, root, entry) {
  phase(entry, 'type-selection');
  const cards = root.locator('[data-douban-grid] [data-douban-item-id]');
  await requireSample(cards, 'No public Douban items are available for this scenario');
  const startType = await root.locator('[data-douban-type][aria-pressed="true"]:visible').first().getAttribute('data-douban-type');
  const alternatives = root.locator(`[data-douban-type]:not([data-douban-type="${startType}"]):visible`);
  if (await alternatives.count()) {
    const type = await alternatives.first().getAttribute('data-douban-type');
    await alternatives.first().click();
    await page.waitForFunction(type => document.querySelector(`[data-douban-type="${type}"][aria-pressed="true"]`) && !document.querySelector('.douban-app.is-loading'), type);
    await root.locator(`[data-douban-type="${startType}"]:visible`).click();
    await cards.first().waitFor({ state: 'visible' });
    entry.checks.push({ check: 'type-switch', status: 'passed', alternative: type });
  } else entry.checks.push({ check: 'type-switch', status: 'single-public-type', type: startType });
  phase(entry, 'status-selection');
  await root.locator('[data-douban-status="mark"]').click();
  await page.waitForFunction(() => !document.querySelector('.douban-app.is-loading'));
  assert.equal(await root.locator('[data-douban-status="mark"]').getAttribute('aria-pressed'), 'true', 'Douban wish status exposes its selected state');
  await root.locator('[data-douban-status="all"]').click(); await cards.first().waitFor({ state: 'visible' });
  phase(entry, 'genre-selection');
  const genre = root.locator('[data-douban-genre]:not([data-douban-genre="all"])');
  if (await genre.count()) { const name = await genre.first().getAttribute('data-douban-genre'); await genre.first().click(); await page.waitForFunction(() => !document.querySelector('.douban-app.is-loading')); assert.equal(await root.locator(`[data-douban-genre="${name}"]`).getAttribute('aria-pressed'), 'true', 'Douban selected genre exposes aria-pressed'); await root.locator('[data-douban-genre="all"]').click(); await cards.first().waitFor({ state: 'visible' }); }
  phase(entry, 'search-no-match-and-clear');
  const search = root.locator('[data-douban-search]:visible, [data-douban-search-mobile]:visible');
  const noMatch = `__catalog_verify_no_match_${Date.now()}__`;
  const response = page.waitForResponse(res => { const u = new URL(res.url()); return u.origin === origin && u.pathname.endsWith('/doubanmovies') && u.searchParams.get('keyword') === noMatch; });
  await search.fill(noMatch); await response; await root.locator('[data-douban-empty]').waitFor({ state: 'visible' });
  await root.getByRole('button', { name: '清除筛选', exact: true }).click(); await cards.first().waitFor({ state: 'visible' }); assert.equal(await search.inputValue(), '', 'Douban clear filters empties the keyword');
  phase(entry, 'grid-quicklook-open-and-focus');
  const first = cards.first(), firstId = await first.getAttribute('data-douban-item-id');
  await first.focus(); await page.keyboard.press('Enter');
  const preview = root.locator('[data-douban-quicklook]');
  await page.waitForFunction(() => document.querySelector('[data-douban-quicklook]')?.getAttribute('aria-hidden') === 'false');
  await expectFocused(page, preview.locator('.douban-quicklook-close'), entry, 'Quick Look focuses its close button after its scheduled animation frame');
  phase(entry, 'grid-quicklook-tab-cycle');
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await preview.evaluate(el => el.contains(document.activeElement)), true, 'Quick Look Tab/Shift+Tab stays inside the preview');
  await screenshot(page, 'douban', entry.width, 'quicklook');
  phase(entry, 'grid-quicklook-close-and-restore');
  await page.keyboard.press('Escape'); await expectFocused(page, first, entry, 'Quick Look close restores the original grid card');
  phase(entry, 'grid-arrow-navigation');
  await page.keyboard.press('ArrowRight');
  if (await cards.count() > 1) assert.notEqual(await page.evaluate(() => document.activeElement.dataset.doubanItemId), firstId, 'ArrowRight moves focus to a different grid card');
  phase(entry, 'list-quicklook-and-restore');
  const listButton = root.locator('[data-douban-view="list"]:visible');
  if (await listButton.count()) await listButton.click(); else await root.locator('[data-douban-mobile-view]').click();
  const row = root.locator('[data-douban-list-body] button').first(); await row.waitFor({ state: 'visible' }); await row.focus(); await page.keyboard.press('Enter');
  assert.equal(await preview.getAttribute('aria-hidden'), 'false', 'The table preview button opens Quick Look'); await page.keyboard.press('Escape'); await expectFocused(page, row, entry, 'Table Quick Look restores its original native button');
  await noOverflow(page, root, entry, 'list');
  const gridButton = root.locator('[data-douban-view="grid"]:visible');
  if (await gridButton.count()) await gridButton.click(); else await root.locator('[data-douban-mobile-view]').click();
  phase(entry, 'grid-pagination');
  await loadIfAvailable(page, root, '[data-douban-load-more]', '[data-douban-grid] [data-douban-item-id]', entry);
  entry.checks.push({ check: 'status/genre/search-clear/grid/list/quicklook-keyboard', status: 'passed', count: await cards.count(), summary: await root.locator('[data-douban-result-count]').innerText() });
}
async function bangumis(page, root, entry) {
  phase(entry, 'search-no-match');
  await requireSample(root.locator('[data-bangumi-card]'), 'No public Bangumi cards are available for this scenario');
  const search = root.locator('.bangumis-search');
  await search.fill('__catalog_verify_no_match__'); await root.locator('.bangumis-search-feedback').waitFor({ state: 'visible' });
  await root.locator('.bangumis-empty--inline').waitFor({ state: 'visible' });
  phase(entry, 'clear-search-and-restore-focus');
  await root.getByRole('button', { name: '清除搜索', exact: true }).click(); assert.equal(await search.inputValue(), '', 'Clear search empties the keyword'); await expectFocused(page, search, entry, 'Clear search returns focus after Alpine nextTick');
  phase(entry, 'search-escape');
  await search.fill('不存在'); await root.locator('.bangumis-empty--inline').waitFor({ state: 'visible' }); await page.keyboard.press('Escape'); await page.waitForFunction(el => el.value === '', await search.elementHandle(), { timeout: 5000 }); assert.equal(await search.inputValue(), '', 'Escape clears the search keyword after the current input state is committed');
  phase(entry, 'manual-or-auto-pagination');
  await loadIfAvailable(page, root, '.bangumis-loadmore-button', '[data-bangumi-card]', entry);
  phase(entry, 'status-wish');
  await browseLink(page, root, '.bangumis-sidebar-block:nth-child(2) a[href*="status=1"]', u => u.searchParams.get('status') === '1');
  await assertCurrent(root.locator('.bangumis-sidebar-block:nth-child(2) a[href*="status=1"]'));
  await browseLink(page, root, '.bangumis-sidebar-block:nth-child(2) a[href*="status=0"]', u => u.searchParams.get('status') === '0');
  phase(entry, 'type-drama-and-restore');
  await browseLink(page, root, '.bangumis-sidebar-block:nth-child(1) a[href*="typeNum=2"]', u => u.searchParams.get('typeNum') === '2');
  await assertCurrent(root.locator('.bangumis-sidebar-block:nth-child(1) a[href*="typeNum=2"]'));
  await browseLink(page, root, '.bangumis-sidebar-block:nth-child(1) a[href*="typeNum=1"]', u => u.searchParams.get('typeNum') === '1');
  entry.checks.push({ check: 'type/status/current/search-clear/escape/pagination', status: 'passed' });
}
async function steam(page, root, entry) {
  phase(entry, 'profile-selected-state');
  const profileButton = root.locator('.steam-main-nav').getByRole('button', { name: '资料', exact: true });
  assert.equal(await profileButton.getAttribute('aria-pressed'), 'true', 'Steam profile is the initial selected view');
  const heatmap = root.locator('.steam-heatmap-panel');
  if (await heatmap.count()) {
    phase(entry, 'heatmap-real-api');
    await page.waitForFunction(() => ['ready', 'unavailable'].includes(document.querySelector('.steam-heatmap-panel')?.dataset.steamHeatmapState), null, { timeout: 20000 });
    if (await heatmap.getAttribute('data-steam-heatmap-state') === 'unavailable') { await heatmap.getByRole('button', { name: '重新加载' }).click(); await page.waitForFunction(() => document.querySelector('.steam-heatmap-panel')?.dataset.steamHeatmapState !== 'loading', null, { timeout: 20000 }); }
    assert.equal(await heatmap.getAttribute('data-steam-heatmap-state'), 'ready', 'Real heatmap API must recover; a second failure is retained as a live gap');
    phase(entry, 'heatmap-keyboard-and-detail');
    const cell = heatmap.locator('[data-steam-heatmap-grid] [tabindex="0"]'); await cell.focus(); const label = await cell.getAttribute('aria-label'); await page.keyboard.press('ArrowLeft');
    assert.equal(await heatmap.locator('[data-steam-heatmap-grid] [tabindex="0"]').count(), 1, 'Heatmap exposes exactly one Tab stop after an arrow key');
    assert.notEqual(await heatmap.locator('[data-steam-heatmap-grid] [tabindex="0"]').getAttribute('aria-label'), label, 'Heatmap ArrowLeft selects a different date');
    assert.match(await heatmap.locator('[data-steam-heatmap-detail]').innerText(), /\d{4}-\d{2}-\d{2}/, 'Heatmap visible detail describes the focused date');
    entry.checks.push({ check: 'heatmap-real-api/roving-focus/detail', status: 'passed' });
  } else entry.checks.push({ check: 'heatmap', status: 'configuration-hidden' });
  phase(entry, 'library-sort');
  await root.locator('.steam-main-nav').getByRole('button', { name: '游戏库', exact: true }).click();
  await requireSample(root.locator('[data-steam-game-card]'), 'No Steam library games are available for this scenario');
  await root.locator('.steam-sort-wrap select').selectOption('name');
  const names = await root.locator('[data-steam-game-card]').evaluateAll(els => els.map(el => el.dataset.steamGameName));
  assert.deepEqual(names, names.slice().sort((a, b) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), 'zh-CN')), 'Steam name ordering matches DOM/keyboard ordering');
  phase(entry, 'library-search-no-match');
  const search = root.locator('.steam-search-wrap input'); await search.fill('__catalog_verify_no_match__');
  await root.locator('.steam-library-feedback').waitFor({ state: 'visible' }); await root.locator('.steam-inline-empty--library').waitFor({ state: 'visible' });
  phase(entry, 'clear-search-and-restore-focus');
  await root.getByRole('button', { name: '清除搜索', exact: true }).click(); assert.equal(await search.inputValue(), '', 'Clear search empties the keyword'); await expectFocused(page, search, entry, 'Clear search returns focus after Alpine nextTick');
  phase(entry, 'search-escape');
  await search.fill('不存在'); await root.locator('.steam-inline-empty--library').waitFor({ state: 'visible' }); await page.keyboard.press('Escape'); await page.waitForFunction(el => el.value === '', await search.elementHandle(), { timeout: 5000 }); assert.equal(await search.inputValue(), '', 'Escape clears the search keyword after the current input state is committed');
  phase(entry, 'library-pagination');
  await loadIfAvailable(page, root, '.steam-loadmore-button', '[data-steam-game-card]', entry);
  await noOverflow(page, root, entry, 'library'); await screenshot(page, 'steam', entry.width, 'library');
  phase(entry, 'badges-and-profile-restore');
  await root.locator('.steam-main-nav').getByRole('button', { name: '徽章', exact: true }).click();
  assert.equal(await root.locator('.steam-main-nav').getByRole('button', { name: '徽章', exact: true }).getAttribute('aria-pressed'), 'true', 'Steam badge view exposes selected state');
  await profileButton.click(); entry.checks.push({ check: 'profile/library/badges/sort-DOM/search-clear/pagination', status: 'passed', loaded: names.length });
}
async function equipments(page, root, entry) {
  phase(entry, 'item-navigation-initial-boundary');
  await requireSample(root.locator('[data-equipment-card]'), 'No public equipment cards are available for this scenario');
  const toolbar = root.locator('.equipments-stage-toolbar'); await toolbar.waitFor({ state: 'visible' });
  const position = toolbar.locator('.equipments-stage-position'); await page.waitForFunction(() => document.querySelector('.equipments-stage-position')?.textContent.includes('/'));
  const previous = toolbar.getByRole('button', { name: '上一件装备' }), next = toolbar.getByRole('button', { name: '下一件装备' });
  assert.equal(await previous.isDisabled(), true, 'Previous equipment is disabled at the first item');
  if (!await next.isDisabled()) {
    phase(entry, 'next-equipment-scroll-and-position');
    await next.click(); await page.waitForFunction(() => document.querySelector('.equipments-stage-position')?.textContent.trim().startsWith('2 /'));
    await page.waitForFunction(() => { const scroller = document.querySelector('.equipments-stage-scroller'); const card = scroller.querySelectorAll('[data-equipment-card]')[1]; return card && scroller.scrollTop >= card.offsetTop - 2; });
    await screenshot(page, 'equipments', entry.width, 'second');
    phase(entry, 'previous-equipment-scroll-and-position');
    await previous.click(); await page.waitForFunction(() => document.querySelector('.equipments-stage-scroller').scrollTop < 2);
    assert.equal(await previous.isDisabled(), true, 'Previous equipment is disabled at the first item');
  }
  phase(entry, 'group-selection-and-restore');
  const alternate = root.locator('.equipments-group-link:not(.is-active)').first();
  if (await alternate.count()) { const href = await alternate.getAttribute('href'); await alternate.click(); await page.waitForURL(new URL(href, page.url()).href); await assertCurrent(root.locator('.equipments-group-link.is-active')); await browseLink(page, root, '.equipments-group-link[href="/equipments"], .equipments-group-link[href="' + baseUrl + '/equipments"]'); }
  phase(entry, 'equipment-pagination');
  await loadIfAvailable(page, root, '.equipments-loadmore-button', '[data-equipment-card]', entry);
  entry.checks.push({ check: 'group/current/previous-next/bounds/scroll-position', status: 'passed', position: await root.locator('.equipments-stage-position').innerText() });
}
try {
  // Refuses stale source/build or a different active theme before UI checks.
  const identity = await readLiveBuildContext(baseUrl); report.identity = { observedAt: identity.observedAt, build: identity.build, halo: identity.halo, plugins: identity.plugins.filter(p => /douban|bangumi|steam|equipment/i.test(p.name)), sourceFingerprint: identity.sourceFingerprint, buildInputRevision: identity.buildInputRevision, verificationScope: identity.verificationScope };
  const manifest = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
  for (const app of ['douban', 'bangumis', 'steam', 'equipments']) for (const asset of [...manifest[app].js, ...manifest[app].css]) {
    const url = new URL(asset, baseUrl); url.search = manifest.__meta.query;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); assert.ok(response.ok, `App asset ${response.status}: ${asset}`);
    const local = path.join('templates/assets', url.pathname.slice(url.pathname.indexOf('/assets/') + 8));
    const digest = sha(Buffer.from(await response.arrayBuffer())); assert.equal(digest, sha(await fs.readFile(local)), `Served app bytes differ: ${local}`); report.assets.push({ app, path: local, sha256: digest });
  }
  browser = await chromium.launch({ headless: true });
  for (const width of widths) for (const app of ['douban', 'bangumis', 'steam', 'equipments']) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 960 : 844 }, locale: 'zh-CN', reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    const blockedWrites = []; await installReadOnlyGuard(context, blockedWrites);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    reads.set(page, []);
    consumedReads.set(page, new Map());
    page.on('request', request => { if (request.method() === 'GET') reads.get(page).push(readKey(request.url())); });
    const errors = collectBrowserRuntimeErrors(page);
    const entry = { app, width, reducedMotion: width === 320, checks: [], geometry: [], phases: [], phase: 'arrival', status: 'running' }; report.scenarios.push(entry);
    try {
      phase(entry, 'arrival');
      const root = await visit(page, app); await noOverflow(page, root, entry, 'arrival');
      await ({ douban, bangumis, steam, equipments })[app](page, root, entry);
      phase(entry, 'final-layout-and-screenshot');
      await noOverflow(page, root, entry, 'final'); await screenshot(page, app, width, 'final'); entry.status = 'passed'; console.log(`${app}/${width}: passed`);
    } catch (error) { entry.status = error instanceof SampleMissing ? 'sample-missing' : 'failed'; entry.error = error.stack || error.message; entry.failureDom = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0,700), inputs: [...document.querySelectorAll('[data-app-root] input')].map(el => ({class:el.className,value:el.value,focused:el===document.activeElement})), quicklook: document.querySelector('[data-douban-quicklook]')?.getAttribute('aria-hidden') })).catch(() => null); (error instanceof SampleMissing ? report.missingSamples : report.failures).push({ app, width, phase: entry.phase, error: error.message, stack: error.stack, cause: error.cause?.stack }); console.error(`${app}/${width} [${entry.phase}] ${error.stack}`); await screenshot(page, app, width, entry.status).catch(() => {}); }
    finally {
      entry.errors = splitErrors(errors.snapshot()); entry.blockedWrites = blockedWrites;
      if (entry.errors.gate.length || blockedWrites.length) { entry.status = 'failed'; report.failures.push({ app, width, runtimeErrors: entry.errors.gate, blockedWrites }); }
      entry.getRequests = reads.get(page); errors.stop(); await context.close();
    }
  }
} catch (error) { report.failures.push({ phase: 'identity/setup', error: error.stack || error.message }); }
finally { await browser?.close(); report.completedAt = new Date().toISOString(); await fs.writeFile(resultsPath, JSON.stringify(report, null, 2), { flag: 'wx' }); }
console.log(JSON.stringify({ identity: report.identity, scenarios: report.scenarios.map(({ app, width, status, checks, errors }) => ({ app, width, status, checks, externalMediaFailures: errors?.externalMedia.length || 0, cancelledReads: errors?.cancelledReads.length || 0 })), failures: report.failures, report: resultsPath }, null, 2));
assert.equal(report.failures.length, 0, 'Catalog live verification has failures; inspect the retained report and screenshots');
if (report.missingSamples.length) { console.error(`Catalog live coverage incomplete: ${report.missingSamples.length} missing samples; see ${resultsPath}`); process.exitCode = 2; }
