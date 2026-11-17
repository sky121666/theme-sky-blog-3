import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { collectBrowserRuntimeErrors } from './lib/browser-runtime-errors.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
// Keep the known out-of-scope favicon failure visible without hiding other
// external images, failed app assets or same-origin responses.
const ignoredExternalIcon = 'https://liyinwaihe.com/wp-content/uploads/2025/11/cropped-lywh-32x32.png';
const dir = await verificationOutput('search-navigation-live');
const identity = await readLiveBuildContext(base);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const scenario of [
    { name: 'global-keyboard', width: 1440, input: 'keyboard' },
    { name: 'global-pointer', width: 1440, input: 'pointer' },
    { name: 'global-touch', width: 390, input: 'touch' },
    { name: 'global-touch-narrow', width: 320, input: 'touch' },
    { name: 'project-keyboard', width: 1440, input: 'keyboard', project: true },
    { name: 'project-touch', width: 390, input: 'touch', project: true },
    { name: 'project-touch-narrow', width: 320, input: 'touch', project: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 },
      isMobile: scenario.input === 'touch', hasTouch: scenario.input === 'touch', serviceWorkers: 'block' });
    const item = { ...scenario, searches: [], blockedWrites: [] };
    results.push(item);
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST' && url.origin === origin && !url.search
        && url.pathname === '/apis/api.halo.run/v1alpha1/indices/-/search') {
        const query = request.postDataJSON();
        assert.equal(typeof query.keyword, 'string');
        item.searches.push(query);
        return route.continue(); // Official read-only search uses POST.
      }
      if (request.method() === 'POST' && url.origin === origin && !url.search
        && url.pathname === '/apis/api.halo.run/v1alpha1/trackers/counter') {
        return route.fulfill({ status: 204, body: '' });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        item.blockedWrites.push({ method: request.method(), path: url.pathname });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const runtime = collectBrowserRuntimeErrors(page);
    try {
      const start = scenario.project ? '/docs/halo-theme-sky-blog-1' : '/';
      const response = await page.goto(new URL(start, base).href, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.waitForFunction(() => Boolean(window.pjax?.loadUrl && window.swup));
      await page.evaluate(() => {
        window.__searchNavigationLive = {
          document, dock: document.querySelector('.dock-container'),
          desktop: document.querySelector('.desktop-surface'), ready: [],
        };
        document.addEventListener('theme:pjax-ready', ({ detail }) => {
          window.__searchNavigationLive.ready.push({ url: detail.url, appId: detail.appId });
        });
      });
      const trigger = page.locator(scenario.project ? '[data-docsme-search]' : '.menubar-search-btn');
      if (scenario.input === 'touch') await trigger.tap();
      else await trigger.click();
      const input = page.locator('search-modal search-form input');
      await input.waitFor({ state: 'visible' });
      const keyword = scenario.project ? (await page.locator('.docsme-doc-head h1').innerText()).trim() : 'halo';
      const searched = page.waitForResponse(response => new URL(response.url()).pathname === '/apis/api.halo.run/v1alpha1/indices/-/search'
        && response.request().postDataJSON()?.keyword === keyword);
      await input.fill(keyword);
      const searchResponse = await searched;
      assert.equal(searchResponse.status(), 200);
      const data = await searchResponse.json();
      const index = data.hits.findIndex(hit => {
        const target = new URL(hit.permalink, base);
        return target.origin === origin && target.href !== page.url();
      });
      assert.ok(index >= 0, 'A public indexed result on this site is required');
      const hit = data.hits[index], target = new URL(hit.permalink, base).href;
      if (scenario.project) {
        const filters = searchResponse.request().postDataJSON().includeCategoryNames;
        assert.ok(filters?.length);
        assert.ok(filters.every(filter => hit.categories.includes(filter)), 'project/version/language scope must be preserved');
      }
      const row = page.locator(`search-modal li[data-index="${index}"]`);
      await row.waitFor({ state: 'visible' });
      if (scenario.input === 'keyboard') {
        for (let step = 0; step < index; step++) await input.press('ArrowDown');
        await input.press('Enter');
      } else if (scenario.input === 'touch') await row.tap();
      else await row.click();
      await page.waitForFunction(target => location.href === target
        && (!window.__searchNavigationLive || window.__searchNavigationLive.ready.some(event => event.url === target)), target);
      item.navigation = await page.evaluate(() => ({
        url: location.href, sameDocument: window.__searchNavigationLive?.document === document,
        sameDock: window.__searchNavigationLive?.dock === document.querySelector('.dock-container'),
        sameDesktop: window.__searchNavigationLive?.desktop === document.querySelector('.desktop-surface'),
        ready: window.__searchNavigationLive?.ready || [],
        searchOpen: document.querySelector('search-modal')?.open === true,
        history: JSON.parse(localStorage.getItem('halo:search-widgets:history:hits') || '[]').map(hit => hit.id),
      }));
      assert.equal(item.navigation.sameDocument, true, 'Opening a search result must not reload the document');
      assert.equal(item.navigation.sameDock, true);
      assert.equal(item.navigation.sameDesktop, true);
      assert.equal(item.navigation.searchOpen, false);
      assert.equal(item.navigation.history[0], hit.id);
      assert.equal(item.navigation.ready.length, 1, 'one activation must cause one completed navigation');
      await page.goBack({ waitUntil: 'commit' });
      await page.waitForFunction(start => location.pathname === start
        && window.__searchNavigationLive?.ready.length === 2, start);
      assert.equal(await page.evaluate(() => window.__searchNavigationLive.document === document), true);
      item.back = 'same-document';
      assert.deepEqual(item.blockedWrites, []);
      item.status = 'passed';
    } catch (error) {
      item.status = 'failed';
      item.failure = String(error.stack || error);
      await page.screenshot({ path: path.join(dir, `${scenario.name}-failure.png`) }).catch(() => {});
    } finally {
      item.runtime = runtime.snapshot();
      item.externalIcons = item.runtime.requestFailures.filter(error =>
        error.url === ignoredExternalIcon && error.resourceType === 'image' && error.errorText === 'net::ERR_BLOCKED_BY_ORB');
      const externalUrls = new Set(item.externalIcons.map(error => error.url));
      item.runtimeFailures = [
        ...item.runtime.pageErrors,
        ...item.runtime.consoleErrors.filter(error => !externalUrls.has(error.url)),
        ...item.runtime.responseErrors,
        ...item.runtime.requestFailures.filter(error => !externalUrls.has(error.url) && error.errorText !== 'net::ERR_ABORTED'),
      ];
      if (item.runtimeFailures.length) item.status = 'failed';
      runtime.stop();
      await context.close();
      console.log(item.status, item.name, item.failure || '');
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ identity, results,
    scope: 'Real 8090 HTML, installed SearchWidget and indexed search results. Search POST is read-only; analytics suppressed, all other writes blocked.' }, null, 2));
}
assert.ok(results.every(item => item.status === 'passed'), 'Search navigation live acceptance failed');
