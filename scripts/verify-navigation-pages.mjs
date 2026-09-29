import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

// Anonymous, read-only page matrix. Dynamic destinations are selected from
// visible anchors on the live page; no fixture content or account is created.
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
const evidencePath = 'docs/evidence/pjax-design-2026-09-28/page-matrix-results.json';
const records = [];
const failures = [];
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
];

function absolute(value) { return new URL(value, base).href; }

function isReadMethod(method) { return ['GET', 'HEAD', 'OPTIONS'].includes(method); }

function classifyBrowserError(error) {
  const source = `${error.url || ''}\n${error.stack || ''}\n${error.text || ''}`;
  if (/\/themes\/theme-sky-blog-3\/|\/src\//.test(source)) return 'theme';
  if (/\/plugins\/|https?:\/\/[^\s]+/.test(source)) return 'other';
  return 'unattributed';
}

async function openCase(browser, profile, record, start) {
  const context = await browser.newContext({
    viewport: profile.viewport, isMobile: profile.isMobile || false,
    hasTouch: profile.hasTouch || false, reducedMotion: 'reduce'
  });
  try {
    await context.route('**/*', (route) => {
      const request = route.request();
      if (isReadMethod(request.method())) return route.continue();
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.origin === origin
        && url.pathname === '/apis/api.halo.run/v1alpha1/trackers/counter'
        && !url.search && !url.hash) {
        record.suppressedTelemetry.push({ method: request.method(), url: request.url(),
          resourceType: request.resourceType() });
        return route.fulfill({ status: 204, body: '' });
      }
      record.blockedWrites.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() });
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      window.__pageMatrixEvents = [];
      const events = window.__pageMatrixEvents;
      document.addEventListener('theme:navigation-accepted', (event) => {
        const { intentId, url, source } = event.detail || {};
        events.push({ type: 'accepted', intentId, url, source });
      });
      document.addEventListener('theme:pjax-ready', (event) => {
        const { intentId, url, appId, root, mode } = event.detail || {};
        const frame = document.getElementById('window-frame-root');
        const contentRoot = document.querySelector('[data-window-content-root]');
        const overlay = contentRoot?.querySelector('[data-window-loading-overlay]');
        events.push({
          type: 'ready', intentId, url, appId, mode,
          observed: {
            location: location.href, historyUrl: history.state?.url || '',
            historyIndex: history.state?.__browserNavIndex,
            bodyAppId: document.body?.dataset.appId || '',
            bodyPageApp: document.body?.dataset.pageApp || '',
            pageMode: document.body?.dataset.pageMode || '',
            rootTag: root?.tagName || '', rootId: root?.id || '',
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
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => record.browserErrors.push({
      type: 'pageerror', text: error.message, stack: error.stack || ''
    }));
    page.on('console', (message) => {
      if (message.type() === 'error') record.browserErrors.push({
        type: 'console', text: message.text(), url: message.location().url || ''
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) record.resourceFailures.push({
        status: response.status(), url: response.url(), type: response.request().resourceType(),
        source: new URL(response.url()).origin === origin && response.url().includes('/themes/theme-sky-blog-3/')
          ? 'theme' : 'other'
      });
    });
    const response = await page.goto(absolute(start), { waitUntil: 'commit', timeout: 15000 });
    record.initial = { url: page.url(), status: response?.status() ?? null };
    if (response?.status() === 404) return { context, page, unavailable: 'initial route returned 404' };
    assert.equal(response?.status(), 200, `${start}: initial route must return 200`);
    await page.waitForFunction(() => window.pjax?.loadUrl && window.Alpine
      && document.body?.dataset.pageMode, null, { timeout: 15000 });
    return { context, page, unavailable: '' };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function firstVisibleAnchor(page, selector, predicate = () => true) {
  const links = page.locator(selector);
  for (let index = 0, count = await links.count(); index < count; index += 1) {
    const link = links.nth(index);
    if (!(await link.isVisible())) continue;
    const data = await link.evaluate((anchor) => ({
      href: anchor.href, rawHref: anchor.getAttribute('href'),
      text: (anchor.textContent || '').trim().slice(0, 100),
      className: anchor.className, appHint: anchor.dataset.pjaxApp || '',
      target: anchor.getAttribute('target') || '', download: anchor.hasAttribute('download')
    }));
    if (!data.href || new URL(data.href).origin !== origin || data.download
      || (data.target && data.target !== '_self') || !predicate(data)) continue;
    return { link, data };
  }
  return null;
}

async function eventCount(page) {
  return page.evaluate(() => window.__pageMatrixEvents?.length ?? 0);
}

async function waitForReady(page, from, expectedUrl, expectedApp, label) {
  await page.waitForFunction((start) => {
    const events = window.__pageMatrixEvents?.slice(start) || [];
    const ready = events.find((event) => event.type === 'ready');
    return ready && events.some((event) => event.type === 'settled' && event.intentId === ready.intentId);
  }, from, { timeout: 15000 });
  const events = await page.evaluate((start) => window.__pageMatrixEvents.slice(start), from);
  const accepted = events.filter((event) => event.type === 'accepted');
  const ready = events.filter((event) => event.type === 'ready');
  const settled = events.filter((event) => event.type === 'settled');
  assert.equal(accepted.length, 1, `${label}: one accepted intent; ${JSON.stringify(events)}`);
  assert.equal(ready.length, 1, `${label}: one ready event; ${JSON.stringify(events)}`);
  assert.deepEqual(settled.map((event) => event.outcome), ['ready'], `${label}: settled result`);
  assert.equal(ready[0].intentId, accepted[0].intentId, `${label}: accepted/ready identity`);
  assert.equal(settled[0].intentId, ready[0].intentId, `${label}: ready/settled identity`);
  assert.ok(events.indexOf(ready[0]) < events.indexOf(settled[0]), `${label}: ready precedes settled`);
  assert.equal(ready[0].url, expectedUrl, `${label}: exact ready URL`);
  assert.equal(ready[0].appId, expectedApp, `${label}: exact ready app`);
  assert.equal(ready[0].observed.location, expectedUrl, `${label}: current URL at ready`);
  assert.equal(ready[0].observed.historyUrl, expectedUrl, `${label}: history URL at ready`);
  assert.equal(ready[0].observed.bodyAppId, expectedApp, `${label}: body app at ready`);
  assert.equal(ready[0].observed.bodyPageApp, expectedApp, `${label}: body page app at ready`);
  assert.ok(Number.isFinite(ready[0].observed.historyIndex), `${label}: indexed history at ready`);
  assert.equal(ready[0].observed.rootConnected, true, `${label}: ready root connected`);
  assert.equal(ready[0].observed.rootInFrame, true, `${label}: ready root in frame`);
  assert.equal(ready[0].observed.frameLoading, false, `${label}: loading cleared`);
  assert.equal(ready[0].observed.contentBusy, false, `${label}: content not busy`);
  assert.equal(ready[0].observed.overlayVisible, false, `${label}: overlay hidden`);
  return { expectedUrl, expectedApp, events };
}

async function clickNavigation(page, record, label, selector, expectedApp, predicate) {
  const candidate = await firstVisibleAnchor(page, selector, predicate);
  if (!candidate) {
    record.steps.push({ label, status: 'skipped', reason: `no visible eligible ${selector}` });
    return false;
  }
  const from = await eventCount(page);
  await candidate.link.click({ timeout: 10000 });
  const result = await waitForReady(page, from, candidate.data.href, expectedApp, label);
  record.steps.push({ label, status: 'passed', anchor: candidate.data, ...result });
  return true;
}

async function runCase(browser, profile, name, start, task) {
  const record = {
    profile: profile.name, name, start, status: 'pending', steps: [],
    blockedWrites: [], suppressedTelemetry: [], browserErrors: [], resourceFailures: []
  };
  records.push(record);
  let opened;
  try {
    opened = await openCase(browser, profile, record, start);
    if (opened.unavailable) {
      record.status = 'skipped'; record.reason = opened.unavailable;
      return;
    }
    await task(opened.page, record);
    assert.deepEqual(record.blockedWrites, [], `${name}: unexpected write request was blocked`);
    const themeErrors = record.browserErrors.filter((error) =>
      ['theme', 'unattributed'].includes(classifyBrowserError(error)));
    assert.deepEqual(themeErrors, [], `${name}: theme or unattributed browser error`);
    const themeResourceFailures = record.resourceFailures.filter((failure) => failure.source === 'theme');
    assert.deepEqual(themeResourceFailures, [], `${name}: theme resource failed`);
    const allStepsSkipped = record.steps.length > 0
      && record.steps.every((step) => step.status === 'skipped');
    record.status = record.skipReason || allStepsSkipped ? 'skipped' : 'passed';
  } catch (error) {
    record.status = 'failed'; record.error = error.stack || error.message;
    if (opened?.page) {
      record.final = await opened.page.evaluate(() => ({
        url: location.href, appId: document.body?.dataset.appId || '',
        events: window.__pageMatrixEvents || []
      })).catch(() => ({ url: opened.page.url(), events: 'page context unavailable' }));
    }
    failures.push(`${profile.name}/${name}: ${error.message}`);
  } finally {
    if (opened?.context) await opened.context.close();
  }
}

async function runHomeEntries(browser, profile) {
  for (const [name, selector, app] of [
    ['dock moments', '.dock-container a.dock-icon.pjax-link[href="/moments"]', 'moments'],
    ['dock categories', '.dock-container a.dock-icon.pjax-link[href="/categories"]', 'explorer-categories'],
    ['desktop icon category', 'a.desktop-icon.pjax-link[data-pjax-app="explorer-categories"]', 'explorer-categories'],
    ['desktop icon tag', 'a.desktop-icon.pjax-link[data-pjax-app="explorer-tags"]', 'explorer-tags'],
    ['desktop icon reader', 'a.desktop-icon.pjax-link[data-pjax-app="reader"]', 'reader']
  ]) {
    await runCase(browser, profile, name, '/', async (page, record) => {
      await clickNavigation(page, record, name, selector, app);
    });
  }
}

async function runHeader(browser, profile) {
  const mobile = profile.name === 'mobile';
  await runCase(browser, profile, mobile ? 'mobile header links' : 'header home',
    mobile ? '/' : '/moments', async (page, record) => {
    if (profile.name === 'mobile') {
      const trigger = page.locator('button.menubar-mobile-trigger').first();
      if (!(await trigger.isVisible().catch(() => false))) {
        record.steps.push({ label: 'open mobile menu', status: 'skipped',
          reason: 'mobile menu trigger is not visible on the home screen' });
        return;
      }
      await trigger.click();
      await page.waitForFunction(() => document.querySelector('.menubar-mobile-dropdown a.pjax-link[href="/links"]')
        ?.getClientRects().length > 0);
    }
    const selector = profile.name === 'mobile'
      ? '.menubar-mobile-dropdown a.menubar-mobile-item.pjax-link[href="/links"]'
      : 'a.menubar-item--desktop.pjax-link[href="/"]';
    await clickNavigation(page, record, mobile ? 'mobile header links' : 'header home',
      selector, mobile ? 'links' : '');
  });
}

async function runMoments(browser, profile) {
  await runCase(browser, profile, 'moments detail and titlebar back', '/moments', async (page, record) => {
    const entered = await clickNavigation(page, record, 'feed time to detail',
      'a.moment-feed-time-link.pjax-link[href^="/moments/"]', 'moments');
    if (!entered) return;
    assert.ok(await page.locator('.moments-app--detail').count(), 'moment detail root must appear');
    const back = await firstVisibleAnchor(page, 'a.moments-titlebar-back.pjax-link[href="/moments"]');
    if (!back) {
      record.steps.push({ label: 'titlebar back', status: 'skipped', reason: 'detail titlebar back absent' });
      return;
    }
    const from = await eventCount(page);
    await back.link.click({ timeout: 10000 });
    const result = await waitForReady(page, from, absolute('/moments'), 'moments', 'titlebar history back');
    assert.equal(result.events.find((event) => event.type === 'accepted')?.source, 'popstate',
      'inline onclick must own history.back before the document click controller');
    record.steps.push({ label: 'titlebar history back', status: 'passed', anchor: back.data, ...result });
  });
}

async function ensureSidebarOpen(page, record, label) {
  const state = () => page.evaluate(() => {
    const app = document.querySelector('.docsme-app');
    const sidebar = app?.querySelector('.docsme-sidebar');
    const bounds = sidebar?.getBoundingClientRect();
    return {
      open: app?.classList.contains('is-sidebar-open') === true,
      transform: sidebar ? getComputedStyle(sidebar).transform : '',
      bounds: bounds ? { left: bounds.left, right: bounds.right, width: bounds.width } : null,
      inViewport: Boolean(bounds && bounds.width > 0
        && bounds.left >= -1 && bounds.right <= innerWidth + 1)
    };
  });
  const before = await state();
  if (before.open && before.inViewport) return true;
  const toggle = page.locator('.docsme-app [data-docsme-toggle-sidebar]').first();
  if (!(await toggle.isVisible().catch(() => false))) {
    record.steps.push({ label, status: 'skipped', reason: 'no visible directory toggle in this scene', before });
    return false;
  }
  await page.waitForFunction(() => document.querySelector('.docsme-app [data-docsme-toggle-sidebar]')
    ?.dataset.docsmeSidebarBound === 'true');
  await toggle.click({ timeout: 10000 });
  await page.waitForFunction(() => {
    const app = document.querySelector('.docsme-app');
    const sidebar = app?.querySelector('.docsme-sidebar');
    const bounds = sidebar?.getBoundingClientRect();
    return app?.classList.contains('is-sidebar-open') && bounds?.width > 0
      && bounds.left >= -1 && bounds.right <= innerWidth + 1;
  });
  record.steps.push({ label, status: 'passed', before, sidebar: await state() });
  return true;
}

async function runDocsme(browser, profile) {
  await runCase(browser, profile, 'docsme project tree article breadcrumb and return', '/docs', async (page, record) => {
    const entered = await clickNavigation(page, record, 'project card',
      '.docsme-project-card.pjax-link[href^="/docs/"]', 'docsme');
    if (!entered) return;
    const scene = await page.locator('[data-docsme-scene]').first().getAttribute('data-docsme-scene');
    assert.ok(['catalog', 'document'].includes(scene), `project scene ${scene}`);
    const mobileDirectoryOpen = profile.name !== 'mobile'
      || await ensureSidebarOpen(page, record, 'open mobile document directory');
    const tree = mobileDirectoryOpen
      ? await firstVisibleAnchor(page, '.docsme-tree a.docsme-tree-link.pjax-link[href]',
        (link) => link.href !== page.url() && /\/docs\//.test(new URL(link.href).pathname))
      : null;
    if (!tree) {
      record.steps.push({ label: 'tree document', status: 'skipped', reason: 'no visible different tree document' });
    } else {
      const from = await eventCount(page);
      await tree.link.click({ timeout: 10000 });
      const result = await waitForReady(page, from, tree.data.href, 'docsme', 'tree document');
      record.steps.push({ label: 'tree document', status: 'passed', anchor: tree.data, ...result });
    }
    if (await page.locator('[data-docsme-scene="document"] .docsme-article').count()) {
      const article = await page.locator('.docsme-article').first().evaluate((element) => ({
        textLength: element.textContent.trim().length,
        internalLinks: [...element.querySelectorAll('a.pjax-link[href]')]
          .map((anchor) => anchor.href).filter((href) => new URL(href).origin === location.origin)
      }));
      assert.ok(article.textLength > 0, 'document article must contain visible content text');
      record.steps.push({ label: 'document body', status: 'passed', article });
      const tocCount = await page.locator('.docsme-toc a[href^="#"]').count();
      if (tocCount) {
        if (profile.name === 'mobile') {
          await page.locator('.docsme-toolbar .docsme-toc-reveal[data-docsme-toggle-toc]').click();
          await page.waitForFunction(() => {
            const toc = document.querySelector('[data-docsme-toc]');
            return document.querySelector('.docsme-app')?.classList.contains('is-mobile-toc-open')
              && toc?.inert === false && toc.getAttribute('aria-hidden') === 'false'
              && document.querySelector('.docsme-toolbar [data-docsme-toggle-toc]')
                ?.getAttribute('aria-expanded') === 'true';
          }, null, { timeout: 5000 });
        }
        const toc = await firstVisibleAnchor(page, '.docsme-toc a[href^="#"]');
        assert.ok(toc, 'generated TOC links must be reachable after opening the directory');
        const beforeHash = await page.evaluate(() => ({ state: history.state, length: history.length }));
        const from = await eventCount(page);
        await toc.link.click({ timeout: 10000 });
        await page.waitForFunction((hash) => location.hash === hash, new URL(toc.data.href).hash);
        const hashState = await page.evaluate(() => {
          const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
          const toolbar = document.querySelector('.docsme-main > .docsme-toolbar');
          const scroller = document.querySelector('.docsme-main');
          const toc = document.querySelector('[data-docsme-toc]');
          return {
            url: location.href, state: history.state, length: history.length,
            targetTop: target?.getBoundingClientRect().top,
            targetBottom: target?.getBoundingClientRect().bottom,
            toolbarBottom: toolbar?.getBoundingClientRect().bottom,
            scrollerBottom: scroller?.getBoundingClientRect().bottom,
            tocClosed: !document.querySelector('.docsme-app')?.classList.contains('is-mobile-toc-open')
              && toc?.inert === true && toc.getAttribute('aria-hidden') === 'true'
              && [...document.querySelectorAll('[data-docsme-toggle-toc]')]
                .every((button) => button.getAttribute('aria-expanded') === 'false')
          };
        });
        // This context uses reduced motion: the component's scroll is immediate.
        assert.ok(hashState.targetTop >= hashState.toolbarBottom - 1, 'TOC heading must clear the sticky toolbar');
        assert.ok(hashState.targetBottom <= hashState.scrollerBottom + 1, 'TOC heading must be visible');
        assert.deepEqual(hashState.state, beforeHash.state, 'TOC must preserve theme history fields');
        assert.equal(hashState.length, beforeHash.length, 'TOC must not add a history entry');
        if (profile.name === 'mobile') assert.equal(hashState.tocClosed, true, 'TOC must close after selection');
        assert.equal(await eventCount(page), from,
        'same-document hash must not start PJAX');
        record.steps.push({ label: 'TOC hash (component)', status: 'passed', anchor: toc.data, hashState });
      } else {
        const headings = await page.locator('.docsme-article h2, .docsme-article h3')
          .evaluateAll((nodes) => nodes.filter((node) => node.textContent.trim()).length);
        assert.equal(headings, 0, 'non-empty document headings must generate TOC links');
        record.steps.push({ label: 'TOC hash (component)', status: 'skipped', reason: 'document has no non-empty h2/h3 headings' });
      }
      const bodyLink = await firstVisibleAnchor(page, '.docsme-article a.pjax-link[href]',
        (link) => /\/docs\//.test(new URL(link.href).pathname)
          && new URL(link.href).pathname !== new URL(page.url()).pathname);
      if (bodyLink) {
        const from = await eventCount(page);
        await bodyLink.link.click({ timeout: 10000 });
        const result = await waitForReady(page, from, bodyLink.data.href, 'docsme', 'article internal link');
        record.steps.push({ label: 'article internal link', status: 'passed', anchor: bodyLink.data, ...result });
      } else record.steps.push({ label: 'article internal link', status: 'skipped', reason: 'no visible internal document link in article' });
    } else record.steps.push({ label: 'document body', status: 'skipped', reason: 'project has no document scene' });
    const breadcrumb = await firstVisibleAnchor(page, '.docsme-breadcrumb a.pjax-link[href]',
      (link) => new URL(link.href).pathname !== new URL(page.url()).pathname);
    if (breadcrumb) {
      const from = await eventCount(page);
      await breadcrumb.link.click({ timeout: 10000 });
      const result = await waitForReady(page, from, breadcrumb.data.href, 'docsme', 'breadcrumb');
      record.steps.push({ label: 'breadcrumb', status: 'passed', anchor: breadcrumb.data, ...result });
    } else record.steps.push({ label: 'breadcrumb', status: 'skipped', reason: 'no distinct breadcrumb destination' });
    let mobileReturnOpen = profile.name !== 'mobile'
      || await ensureSidebarOpen(page, record, 'open mobile directory for project return');
    if (mobileReturnOpen && profile.name === 'mobile') {
      const outside = await page.evaluate(() => {
        const app = document.querySelector('.docsme-app').getBoundingClientRect();
        const sidebar = document.querySelector('.docsme-sidebar').getBoundingClientRect();
        return { x: (sidebar.right + app.right) / 2, y: (app.top + app.bottom) / 2 };
      });
      await page.mouse.click(outside.x, outside.y);
      await page.waitForFunction(() => !document.querySelector('.docsme-app')?.classList.contains('is-sidebar-open'));
      record.steps.push({ label: 'mobile directory backdrop closes', status: 'passed', outside });
      mobileReturnOpen = await ensureSidebarOpen(page, record, 'reopen mobile directory for project return');
      if (mobileReturnOpen) {
        const hit = await page.evaluate(() => {
          const link = document.querySelector('.docsme-back-link');
          const bounds = link?.getBoundingClientRect();
          if (!bounds) return { reachable: false, reason: 'project return link absent' };
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const target = document.elementFromPoint(x, y);
          const sidebar = link.closest('.docsme-sidebar');
          const toolbar = document.querySelector('.docsme-toolbar');
          return {
            reachable: link.contains(target),
            center: { x, y },
            hit: { tag: target?.tagName || '', className: String(target?.className || '') },
            backlink: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
            sidebarZ: sidebar ? getComputedStyle(sidebar).zIndex : '',
            toolbarZ: toolbar ? getComputedStyle(toolbar).zIndex : ''
          };
        });
        record.steps.push({ label: 'mobile project return pointer hit',
          status: hit.reachable ? 'passed' : 'failed', hit });
        assert.equal(hit.reachable, true, 'opened mobile project return link must receive pointer at its center');
      }
    }
    if (mobileReturnOpen) {
      await clickNavigation(page, record, 'project return', '.docsme-back-link.pjax-link[href="/docs"]', 'docsme');
    } else record.steps.push({ label: 'project return', status: 'skipped',
      reason: 'mobile project directory could not be opened' });
  });
}

async function runLinks(browser, profile) {
  await runCase(browser, profile, 'links and friends local view', '/', async (page, record) => {
    if (profile.name === 'mobile') {
      const trigger = page.locator('button.menubar-mobile-trigger').first();
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
        await page.locator('.menubar-mobile-dropdown a.pjax-link[href="/links"]')
          .first().waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
      }
    }
    const visibleEntry = await firstVisibleAnchor(page, 'a.pjax-link[href]',
      (link) => {
        const url = new URL(link.href);
        return url.pathname === '/links' && !url.search && !url.hash;
      });
    if (visibleEntry) assert.equal(visibleEntry.data.href, absolute('/links'),
      'actual visible Links entry must point exactly to /links');
    const from = await eventCount(page);
    if (visibleEntry) await visibleEntry.link.click({ timeout: 10000 });
    else await page.evaluate(() => { void window.pjax.loadUrl('/links'); });
    const entry = await waitForReady(page, from, absolute('/links'), 'links', 'links entry');
    record.steps.push({
      label: 'links entry', status: 'passed',
      source: visibleEntry ? 'visible anchor' : 'programmatic fallback: no home link to /links',
      anchor: visibleEntry?.data || null, ...entry
    });
    await page.waitForFunction(() => Boolean(document.querySelector('.links-app-shell')?._x_dataStack),
      null, { timeout: 10000 });
    for (const [label, button, expected] of [
      ['friends view', '.links-rail-button[title="朋友圈"]', absolute('/links?view=friends')],
      ['links view', '.links-rail-button[title="链接"]', absolute('/links')]
    ]) {
      const locator = page.locator(button).first();
      if (!(await locator.isVisible().catch(() => false))) {
        record.steps.push({ label, status: 'skipped', reason: `no visible ${button}` });
        continue;
      }
      const from = await eventCount(page);
      await locator.click();
      await page.waitForFunction((href) => location.href === href, expected);
      const state = await page.evaluate((start) => ({
        url: location.href, active: document.querySelector('.links-rail-button[aria-pressed="true"]')?.title || '',
        readyCount: window.__pageMatrixEvents.slice(start).filter((event) => event.type === 'ready').length
      }), from);
      assert.equal(state.readyCount, 0, `${label}: local view switch must not claim a PJAX ready`);
      assert.equal(state.active, label === 'friends view' ? '朋友圈' : '链接');
      record.steps.push({ label, status: 'passed', mode: 'local-history-view', state });
    }
  });
}

async function discoverArchiveArticleWith(page, record, requiredSelector) {
  const scanned = [];
  const seenArticles = new Set();
  const visitedYears = new Set([page.url()]);
  while (scanned.length < 12) {
    const articles = page.locator('.archive-entry--file.pjax-link[href^="/archives/"]');
    for (let index = 0, count = await articles.count(); index < count && scanned.length < 12; index += 1) {
      const link = articles.nth(index);
      if (!(await link.isVisible())) continue;
      const href = await link.evaluate((anchor) => anchor.href);
      if (seenArticles.has(href) || new URL(href).origin !== origin) continue;
      seenArticles.add(href);
      const inspected = await page.evaluate(async ({ href, selector }) => {
        try {
          const response = await fetch(href, { method: 'GET', credentials: 'omit', cache: 'no-store' });
          if (!response.ok) return { status: response.status, matched: false };
          const html = await response.text();
          const documentCopy = new DOMParser().parseFromString(html, 'text/html');
          return { status: response.status, matched: Boolean(documentCopy.querySelector(selector)) };
        } catch (error) { return { status: null, matched: false, error: String(error) }; }
      }, { href, selector: requiredSelector });
      scanned.push({ href, ...inspected });
      if (inspected.matched) {
        record.steps.push({ label: 'bounded archive sample discovery', status: 'passed',
          selector: requiredSelector, scanned });
        return href;
      }
    }
    if (scanned.length >= 12) break;
    const year = await firstVisibleAnchor(page, '.archive-sidebar-item.pjax-link[href^="/archives/"]',
      (link) => !visitedYears.has(link.href) && link.href !== page.url());
    if (!year) break;
    visitedYears.add(year.data.href);
    const from = await eventCount(page);
    await year.link.click({ timeout: 10000 });
    const result = await waitForReady(page, from, year.data.href, 'explorer-archives', 'archive sample year');
    record.steps.push({ label: 'archive sample year', status: 'passed', anchor: year.data, ...result });
  }
  record.steps.push({ label: 'bounded archive sample discovery', status: 'skipped',
    reason: `no ${requiredSelector} found in ${scanned.length}/12 visible archive articles scanned`,
    selector: requiredSelector, scanned });
  return null;
}

async function runExplorer(browser, profile) {
  for (const [name, start, selector, app] of [
    ['archives year', '/archives', '.archive-sidebar-item.pjax-link[href^="/archives/"]', 'explorer-archives'],
    ['archives article', '/archives', '.archive-entry--file.pjax-link[href^="/archives/"]', 'reader'],
    ['categories facet', '/categories', '.categories-sidebar-item.pjax-link[href^="/categories/"]', 'explorer-categories'],
    ['categories article', '/categories', '.category-post-row.pjax-link[href^="/archives/"]', 'reader'],
    ['tags facet', '/tags', '.tags-sidebar-item.pjax-link[href^="/tags/"]', 'explorer-tags']
  ]) {
    await runCase(browser, profile, name, start, async (page, record) => {
      await clickNavigation(page, record, name, selector, app,
        (link) => link.href !== page.url());
    });
  }
  for (const [name, selector, app, viaAuthor] of [
    ['author article', '.author-post-row.pjax-link[href^="/archives/"]', 'reader', true],
    ['reader author', '.post-meta-link.pjax-link[href^="/authors/"]', 'explorer-author', false],
    ['reader tag', '.post-taxonomy-chip.pjax-link[href^="/tags/"]', 'explorer-tags', false],
    ['reader category', '.post-meta-link.pjax-link[href^="/categories/"]', 'explorer-categories', false]
  ]) {
    await runCase(browser, profile, name, '/archives', async (page, record) => {
      const sampleHref = name === 'reader tag' || name === 'reader category'
        ? await discoverArchiveArticleWith(page, record, selector)
        : null;
      if ((name === 'reader tag' || name === 'reader category') && !sampleHref) {
        record.skipReason = `bounded archive scan found no ${name} sample`;
        return;
      }
      const hasReader = await clickNavigation(page, record, 'actual archive article to Reader',
        '.archive-entry--file.pjax-link[href^="/archives/"]', 'reader',
        (link) => !sampleHref || link.href === sampleHref);
      if (!hasReader) {
        record.skipReason = 'archive exposes no visible article link';
        record.steps.push({ label: name, status: 'skipped', reason: 'archive exposes no visible article link' });
        return;
      }
      if (viaAuthor) {
        const hasAuthor = await clickNavigation(page, record, 'Reader author to author app',
          '.post-meta-link.pjax-link[href^="/authors/"]', 'explorer-author');
        if (!hasAuthor) {
          record.skipReason = 'sampled Reader has no visible author link';
          record.steps.push({ label: name, status: 'skipped', reason: 'sampled Reader has no visible author link' });
          return;
        }
      }
      const reached = await clickNavigation(page, record, name, selector, app,
        (link) => link.href !== page.url());
      if (!reached) record.skipReason = `sampled page exposes no visible ${name} link`;
    });
  }
}

const browser = await chromium.launch();
try {
  for (const profile of profiles) {
    await runHomeEntries(browser, profile);
    await runHeader(browser, profile);
    await runMoments(browser, profile);
    await runDocsme(browser, profile);
    await runLinks(browser, profile);
    await runExplorer(browser, profile);
  }
  if (failures.length) {
    console.error(JSON.stringify({ failures, records }, null, 2));
    throw new AggregateError(failures.map((message) => new Error(message)),
      `navigation page matrix failed: ${failures.length} scenario(s)`);
  }
  const context = await readLiveBuildContext(base);
  await fs.mkdir('docs/evidence/pjax-design-2026-09-28', { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify({ context, records }, null, 2) + '\n');
  const passed = records.filter((record) => record.status === 'passed').length;
  const skipped = records.filter((record) => record.status === 'skipped').length;
  console.log(`navigation page matrix passed: ${passed} scenarios; ${skipped} skipped; raw records saved locally`);
} finally {
  await browser.close();
}
