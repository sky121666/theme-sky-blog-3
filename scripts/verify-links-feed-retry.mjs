import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const build = await readLiveBuildContext(baseUrl);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
const blockedWrites = [];
await installReadOnlyGuard(context, blockedWrites);
const page = await context.newPage();
const probeId = 'theme-feed-retry-probe';
let requests = 0;
await page.route((url) => url.pathname.endsWith('/linkfeeds') && url.searchParams.get('beforeId') === probeId, async (route) => {
  requests += 1;
  await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"retry probe"}' });
});

try {
  const response = await page.goto(`${baseUrl}/links?view=friends&scope=all`, { waitUntil: 'commit', timeout: 20_000 });
  assert.equal(response?.status(), 200);
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-app-root="links"] [x-data="linksExplorer"]');
    return document.readyState !== 'loading' && root && window.Alpine?.$data(root)?.loadNextFeed;
  }, null, { timeout: 20_000 });

  const failure = await page.evaluate(async (id) => {
    const root = document.querySelector('[data-app-root="links"] [x-data="linksExplorer"]');
    const model = window.Alpine.$data(root);
    model.activeView = 'friends';
    model.feedHasNext = true;
    model.feedNextId = id;
    model.feedNextPublishedAt = '2026-09-01T00:00:00Z';
    model.feedStatus = 'ready';
    await model.loadNextFeed();
    return { status: model.feedStatus, hasNext: model.feedHasNext, loading: model.feedLoading };
  }, probeId);
  assert.deepEqual(failure, { status: 'error', hasNext: true, loading: false });
  assert.equal(requests, 1, 'the injected page failure must issue one request');

  const pagination = page.locator('.links-feed-pagination');
  await pagination.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  assert.equal(requests, 1, 'intersection must not repeat the failed cursor automatically');
  const retry = pagination.locator('button.links-feed-more');
  assert.equal(await retry.isVisible(), true);
  await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes(`beforeId=${probeId}`) && candidate.status() === 503),
    retry.click()
  ]);
  await page.waitForTimeout(250);
  assert.equal(requests, 2, 'manual retry must issue exactly one new request');
  assert.deepEqual(blockedWrites, [], 'the read-only probe must not submit site writes');
  console.log(`Links feed retry passed on Halo ${build.halo}, theme ${build.build.version}/${build.build.revision}`);
} finally {
  await context.close();
  await browser.close();
}
