import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const targetUrl = new URL('/archives', base).href;

const fixtures = [
  {
    name: 'malformed response without shell',
    transform: () => '<!doctype html><html><head></head><body>broken response</body></html>'
  },
  {
    name: 'missing frame',
    transform: (html) => {
      assert.match(html, /id="window-frame-root"/, 'live response must contain the expected frame');
      return html.replace('id="window-frame-root"', 'id="missing-window-frame-root"');
    }
  },
  {
    name: 'duplicate frame',
    transform: (html) => html.replace('</body>', '<div id="window-frame-root"></div></body>')
  },
  {
    name: 'duplicate title',
    transform: (html) => html.replace('</head>', '<title>Duplicate title</title></head>')
  }
];

const browser = await chromium.launch();
try {
  for (const fixture of fixtures) {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      if (dialog.type() === 'beforeunload') await dialog.dismiss();
      else await dialog.accept();
    });

    try {
      await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.pjax?.loadUrl
        && window.Alpine?.store('themeSettings')
        && document.body.dataset.appId === 'links');

      let responseInjected = false;
      await page.route(targetUrl, async (route) => {
        if (route.request().headers()['x-pjax'] !== 'true') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const html = await response.text();
        responseInjected = true;
        await route.fulfill({ response, body: fixture.transform(html) });
      });

      await page.evaluate(() => {
        const desktop = window.Alpine.$data(document.querySelector('.desktop-surface'));
        const settings = window.Alpine.store('themeSettings');
        desktop.serverLayoutMutationVersion = desktop.serverLayoutSavedMutationVersion + 1;
        settings.visible = true;
        settings.dirtyPaths = ['desktop.appearance.accent'];
        settings.draftMutationVersion += 1;
        window.__navigationResponseProbe = {
          desktop,
          frame: document.getElementById('window-frame-root'),
          settled: [],
          ready: 0,
          beforeUnload: 0
        };
        document.addEventListener('theme:navigation-settled', (event) => {
          window.__navigationResponseProbe.settled.push(event.detail);
        });
        document.addEventListener('theme:pjax-ready', () => { window.__navigationResponseProbe.ready++; });
        window.addEventListener('beforeunload', (event) => {
          window.__navigationResponseProbe.beforeUnload += 1;
          event.preventDefault();
          event.returnValue = '';
        });
        const trigger = document.createElement('button');
        trigger.id = 'navigation-response-trigger';
        trigger.textContent = 'Navigate';
        trigger.style.cssText = 'position:fixed;top:60px;left:20px;z-index:2147483647';
        trigger.addEventListener('click', () => { void window.pjax.loadUrl('/archives'); });
        document.body.append(trigger);
      });

      await page.click('#navigation-response-trigger');
      await page.waitForFunction(() => window.__navigationResponseProbe?.settled.length > 0);
      await page.waitForTimeout(200);

      const actual = await page.evaluate(() => ({
        url: window.location.pathname + window.location.search,
        appId: document.body.dataset.appId,
        sameFrame: window.__navigationResponseProbe.frame === document.getElementById('window-frame-root'),
        dirty: window.Alpine.store('themeSettings').hasDirtyChanges(),
        desktopDirty: window.__navigationResponseProbe.desktop.serverLayoutMutationVersion
          !== window.__navigationResponseProbe.desktop.serverLayoutSavedMutationVersion,
        visible: window.Alpine.store('themeSettings').visible,
        ready: window.__navigationResponseProbe.ready,
        beforeUnload: window.__navigationResponseProbe.beforeUnload,
        outcomes: window.__navigationResponseProbe.settled.map(({ outcome }) => outcome)
      }));
      assert.equal(responseInjected, true, `${fixture.name}: PJAX response fixture must be used`);
      assert.deepEqual(actual.outcomes, ['native'], `${fixture.name}: invalid shell must have one managed native handoff`);
      assert.equal(actual.ready, 0, `${fixture.name}: native handoff is not theme readiness`);
      assert.ok(actual.beforeUnload > 0, `${fixture.name}: browser must attempt native navigation`);
      assert.ok(dialogs.includes('beforeunload'), `${fixture.name}: external beforeunload veto must be exercised`);
      assert.equal(actual.url, '/links', `${fixture.name}: veto must retain the source URL`);
      assert.equal(actual.appId, 'links', `${fixture.name}: veto must retain the source app`);
      assert.equal(actual.sameFrame, true, `${fixture.name}: veto must retain the source frame`);
      assert.equal(actual.dirty, true, `${fixture.name}: veto must retain the settings draft`);
      assert.equal(actual.desktopDirty, true, `${fixture.name}: veto must retain the desktop draft`);
      assert.equal(actual.visible, true, `${fixture.name}: veto must retain the settings UI`);
    } finally {
      await page.close();
    }
  }

  const context = await readLiveBuildContext(base);
  await fs.mkdir('docs/evidence/pjax-design-2026-09-28', { recursive: true });
  await fs.writeFile('docs/evidence/pjax-design-2026-09-28/response-results.json',
    JSON.stringify({ context, cases: fixtures.map(({ name }) => name) }, null, 2) + '\n');
  console.log(`navigation response handoff passed: ${fixtures.length} malformed shell cases`);
} finally {
  await browser.close();
}
