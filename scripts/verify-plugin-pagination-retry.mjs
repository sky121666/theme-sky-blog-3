import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const cases = [
  { name: 'bangumis', path: '/bangumis', errorClass: 'bangumis-loadmore-error' },
  { name: 'equipments', path: '/equipments', errorClass: 'equipments-loadmore-error' }
];
const manifestResponse = await fetch(new URL('/themes/theme-sky-blog-3/assets/asset-manifest.json', baseUrl));
assert.equal(manifestResponse.status, 200, 'target theme assets must be served');
const manifest = await manifestResponse.json();
const browser = await chromium.launch({ headless: true });

try {
  for (const scenario of cases) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const retryUrl = new URL(`${scenario.path}?__theme_retry_probe=1`, baseUrl);
    let requests = 0;
    await page.route((url) => url.href === retryUrl.href, async (route) => {
      requests += 1;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'retry probe' });
    });

    try {
      const response = await page.goto(new URL(scenario.path, baseUrl).href, {
        waitUntil: 'commit', timeout: 20_000
      });
      assert.equal(response?.status(), 200, `${scenario.name}: page must load`);
      await page.waitForFunction((name) => {
        const root = document.querySelector(`[data-app-root="${name}"]`);
        return document.readyState !== 'loading' && root && window.Alpine?.$data(root)?.loadNext;
      }, scenario.name, { timeout: 20_000 });

      const failure = await page.evaluate(async ({ name, url }) => {
        const root = document.querySelector(`[data-app-root="${name}"]`);
        const model = window.Alpine.$data(root);
        model.nextUrl = url;
        model.hasMore = true;
        await model.loadNext();
        return { loadError: model.loadError, hasMore: model.hasMore, loading: model.loading };
      }, { name: scenario.name, url: retryUrl.href });
      assert.deepEqual(failure, { loadError: true, hasMore: true, loading: false },
        `${scenario.name}: a failed page request must remain retryable`);

      const retry = page.locator(`[data-app-root="${scenario.name}"] button.${scenario.errorClass}`);
      assert.equal(await retry.count(), 1,
        `${scenario.name}: a failed short list needs an explicit retry control`);
      assert.equal(await retry.isVisible(), true, `${scenario.name}: retry control must be visible`);
      await page.waitForTimeout(150);
      assert.equal(requests, 1,
        `${scenario.name}: a visible sentinel must not start an automatic retry loop after failure`);
      const beforeClick = requests;
      await Promise.all([
        page.waitForResponse((candidate) => candidate.url() === retryUrl.href && candidate.status() === 503),
        retry.click()
      ]);
      await page.waitForFunction((name) => {
        const root = document.querySelector(`[data-app-root="${name}"]`);
        return window.Alpine.$data(root).loading === false;
      }, scenario.name);
      await page.waitForTimeout(150);
      assert.equal(requests, beforeClick + 1,
        `${scenario.name}: clicking retry must issue one new page request`);
      console.log(`${scenario.name}: explicit retry issued one request after HTTP 503`);
    } finally {
      await context.close();
    }
  }
  console.log(`plugin pagination retry passed on theme ${manifest.__meta.version}/${manifest.__meta.revision}`);
} finally {
  await browser.close();
}
