import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const browser = await chromium.launch();
const scenarios = [];
async function ready(page) {
  await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.pjax?.loadUrl && window.Alpine?.store('themeSettings')
    && document.body.dataset.appId === 'links');
}
try {
  const page = await browser.newPage();
  await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.pjax?.loadUrl && document.body.dataset.appId === 'links');
  await page.evaluate(() => {
    window.__navigationGuardProbe = { votes: 0, sends: 0 };
    window.addEventListener('theme:before-pjax-navigation', (event) => {
      window.__navigationGuardProbe.votes++;
      event.preventDefault();
    });
    for (const type of ['pjax:send', 'pjax:same-variant-send']) {
      document.addEventListener(type, () => window.__navigationGuardProbe.sends++);
    }
    const link = document.createElement('a');
    link.id = 'navigation-guard-probe';
    link.className = 'pjax-link';
    link.dataset.pjaxApp = 'links';
    link.href = '/links?view=friends&scope=all';
    link.textContent = 'guard fixture';
    link.style.cssText = 'position:fixed;top:80px;left:20px;z-index:2147483647;background:white;padding:10px';
    document.body.append(link);
  });
  await page.click('#navigation-guard-probe');
  const result = await page.evaluate(() => ({ ...window.__navigationGuardProbe, url: location.pathname + location.search }));
  assert.equal(result.votes, 1, 'same-variant click must consult leave guards exactly once');
  assert.equal(result.sends, 0, 'veto must not send full or same-variant request');
  assert.equal(result.url, '/links', 'veto must preserve current URL');
  scenarios.push('same-variant external veto');
  await page.close();

  for (const mode of ['full', 'same']) {
    const sample = await browser.newPage();
    await ready(sample);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let arrived;
    const requested = new Promise((resolve) => { arrived = resolve; });
    const target = mode === 'full' ? '/archives' : '/links?view=friends&scope=all';
    await sample.route(new URL(target, base).href, async (route) => {
      arrived(); await gate; await route.continue();
    });
    await sample.evaluate(({ target, mode }) => {
      window.__beforeNavigationFrame = document.getElementById('window-frame-root');
      window.__beforeNavigationTitle = document.querySelector('.window-titlebar');
      window.__navigationSettled = [];
      document.addEventListener('theme:navigation-settled', (event) => window.__navigationSettled.push(event.detail));
      if (mode === 'full') window.pjax.loadUrl(target);
      else {
        const a = document.createElement('a'); a.href = target; a.className = 'pjax-link'; a.dataset.pjaxApp = 'links';
        document.body.append(a); a.click(); a.remove();
      }
    }, { mode, target });
    await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(new Error(`${mode} request not started`)), 10000))]);
    await sample.evaluate(() => { Alpine.store('themeSettings').draftMutationVersion++; });
    release();
    await sample.waitForFunction(() => window.__navigationSettled.some((event) => event.outcome === 'cancelled'));
    const cancelled = await sample.evaluate(() => ({
      url: location.pathname + location.search,
      sameFrame: window.__beforeNavigationFrame === document.getElementById('window-frame-root'),
      sameTitle: window.__beforeNavigationTitle === document.querySelector('.window-titlebar'),
      version: Alpine.store('themeSettings').draftMutationVersion,
      outcomes: window.__navigationSettled.map((event) => event.outcome)
    }));
    assert.equal(cancelled.url, '/links', `${mode}: draft changes must retain source URL`);
    assert.equal(cancelled.sameFrame, true, `${mode}: source frame must survive`);
    assert.equal(cancelled.sameTitle, true, `${mode}: titlebar must not change before permission`);
    assert.ok(cancelled.version > 0, `${mode}: draft version must survive cancellation`);
    assert.deepEqual(cancelled.outcomes, ['cancelled'], `${mode}: one terminal outcome`);
    scenarios.push(`${mode} draft changed while fetching`);
    await sample.close();
  }

  const dirty = await browser.newPage();
  await ready(dirty);
  let dialogs = 0;
  dirty.on('dialog', async (dialog) => { if (++dialogs === 1) await dialog.accept(); else await dialog.dismiss(); });
  const dual = await dirty.evaluate(async () => {
    const desktop = Alpine.$data(document.querySelector('.desktop-surface'));
    const settings = Alpine.store('themeSettings');
    desktop.serverLayoutMutationVersion = desktop.serverLayoutSavedMutationVersion + 1;
    settings.visible = true; settings.dirtyPaths = ['desktop.appearance.accent'];
    const result = await window.pjax.loadUrl('/archives');
    return { result, desktopDirty: desktop.serverLayoutMutationVersion !== desktop.serverLayoutSavedMutationVersion,
      settingsDirty: settings.hasDirtyChanges(), url: location.pathname };
  });
  assert.equal(dialogs, 2, 'both actual guards must vote');
  assert.equal(dual.result, false);
  assert.equal(dual.desktopDirty, true, 'later veto must retain earlier desktop draft');
  assert.equal(dual.settingsDirty, true);
  assert.equal(dual.url, '/links');
  scenarios.push('actual desktop and settings guards: allow then veto');
  await dirty.close();

  const hiddenWindow = await browser.newPage();
  await ready(hiddenWindow);
  await hiddenWindow.evaluate(() => {
    Alpine.store('windowManager').showDesktop();
    window.__revealDone = false;
    document.addEventListener('theme:navigation-settled', (event) => { window.__revealDone = event.detail.outcome === 'ready'; });
    const link = document.createElement('a'); link.href = '/links?view=friends&scope=all'; link.className = 'pjax-link';
    document.body.append(link); link.click(); link.remove();
  });
  await hiddenWindow.waitForFunction(() => window.__revealDone);
  assert.equal(await hiddenWindow.evaluate(() => Alpine.store('windowManager').show), true,
    'same-variant navigation from the desktop must reveal the resulting window');
  scenarios.push('same-variant desktop navigation reveals hidden window');
  await hiddenWindow.close();

  for (const unknown of [false, true]) {
    const historyPage = await browser.newPage();
    await ready(historyPage);
    if (!unknown) {
      await historyPage.evaluate(() => {
        window.__historyReady = false;
        document.addEventListener('theme:navigation-settled', (event) => {
          if (event.detail.outcome === 'ready') window.__historyReady = true;
        });
        window.pjax.loadUrl('/archives');
      });
      await historyPage.waitForFunction(() => window.__historyReady);
      // A known popstate must be admitted once, then reach the matching DOM.
      await historyPage.evaluate(() => {
        window.__historyEvents = [];
        for (const type of ['theme:navigation-accepted', 'theme:navigation-settled']) {
          document.addEventListener(type, (event) => window.__historyEvents.push({ type, ...event.detail }));
        }
        history.back();
      });
      await historyPage.waitForFunction(() => window.__historyEvents.some((e) => e.outcome === 'ready')
        && location.pathname === '/links' && document.body.dataset.appId === 'links');
      assert.equal(await historyPage.evaluate(() => window.__historyEvents.filter((e) => e.type === 'theme:navigation-accepted').length), 1);
      await historyPage.evaluate(() => { window.__historyEvents = []; history.forward(); });
      await historyPage.waitForFunction(() => window.__historyEvents.some((e) => e.outcome === 'ready')
        && location.pathname === '/archives' && document.body.dataset.appId === 'explorer-archives');
      assert.equal(await historyPage.evaluate(() => window.__historyEvents.filter((e) => e.type === 'theme:navigation-accepted').length), 1);
      scenarios.push('known history back and forward admit once and match DOM');
    }
    const source = await historyPage.evaluate((unknown) => {
      const source = { url: location.href, length: history.length, uid: history.state?.uid,
        privateFlag: history.state?.__themeOnlinePrivatePage };
      window.__historyVotes = 0;
      window.__historyFrame = document.getElementById('window-frame-root');
      if (unknown) {
        const state = history.state;
        window.__ONLINE_MONITOR_META__.privatePage = !source.privateFlag;
        history.pushState(null, '', '/links?unknown-entry');
        window.__ONLINE_MONITOR_META__.privatePage = source.privateFlag;
        history.pushState(state, '', source.url);
        source.length = history.length;
      }
      window.addEventListener('theme:before-pjax-navigation', (event) => {
        window.__historyVotes++;
        event.preventDefault();
      });
      history.back();
      return source;
    }, unknown);
    await historyPage.waitForFunction((source) => window.__historyVotes === 1
      && location.href === source.url && history.state?.uid === source.uid, source).catch(async (error) => {
      error.message += ` (${unknown ? 'unknown' : 'known'} history: ${JSON.stringify(await historyPage.evaluate(() => ({
        votes: window.__historyVotes, url: location.href, state: history.state
      })))}, expected ${JSON.stringify(source)})`;
      throw error;
    });
    assert.deepEqual(await historyPage.evaluate(() => ({
      sameFrame: window.__historyFrame === document.getElementById('window-frame-root'), length: history.length,
      privateFlag: history.state?.__themeOnlinePrivatePage, runtimePrivateFlag: window.__ONLINE_MONITOR_META__?.privatePage
    })), { sameFrame: true, length: source.length, privateFlag: source.privateFlag, runtimePrivateFlag: source.privateFlag });
    scenarios.push(`${unknown ? 'unknown' : 'known'} history veto restores committed source`);
    await historyPage.close();
  }

  for (const mode of ['full', 'same']) {
    const offline = await browser.newPage();
    await ready(offline);
    offline.on('dialog', (dialog) => dialog.accept());
    const target = mode === 'full' ? '/archives' : '/links?view=friends&scope=all';
    await offline.route(new URL(target, base).href, (route) => route.abort('failed'));
    await offline.evaluate(({ mode, target }) => {
      const settings = Alpine.store('themeSettings');
      settings.visible = true; settings.dirtyPaths = ['desktop.appearance.accent'];
      window.__offlineFrame = document.getElementById('window-frame-root');
      window.__offlineOutcome = null;
      document.addEventListener('theme:navigation-settled', (event) => { window.__offlineOutcome = event.detail.outcome; });
      if (mode === 'full') window.pjax.loadUrl(target);
      else {
        const a = document.createElement('a'); a.className = 'pjax-link'; a.href = target;
        document.body.append(a); a.click(); a.remove();
      }
    }, { mode, target });
    await offline.waitForFunction(() => window.__offlineOutcome);
    assert.deepEqual(await offline.evaluate(() => ({
      outcome: window.__offlineOutcome, dirty: Alpine.store('themeSettings').hasDirtyChanges(),
      sameFrame: window.__offlineFrame === document.getElementById('window-frame-root'), url: location.pathname + location.search
    })), { outcome: 'failed', dirty: true, sameFrame: true, url: '/links' });
    scenarios.push(`${mode} network failure retains approved draft`);
    await offline.close();
  }

  const context = await readLiveBuildContext(base);
  await fs.mkdir('docs/evidence/pjax-design-2026-09-28', { recursive: true });
  await fs.writeFile('docs/evidence/pjax-design-2026-09-28/runtime-results.json', JSON.stringify({ context, scenarios }, null, 2) + '\n');
  console.log(`live navigation admission passed: ${scenarios.length} cases; exact build context saved locally`);
} finally {
  await browser.close();
}
