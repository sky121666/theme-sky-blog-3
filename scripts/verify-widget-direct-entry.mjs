import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const evidence = process.env.WIDGET_DIRECT_OUTPUT || 'output/direct-widgets';
const browser = await chromium.launch();
const records = [];
try {
  for (const path of ['/links', '/archives', '/categories']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1000 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    const errors = [];
    const writes = [];
    let homeRequests = 0;
    await context.route('**/*', (route) => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      writes.push({ method: request.method(), path: new URL(request.url()).pathname });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(base).origin && url.pathname === '/') homeRequests++;
    });
    await page.goto(new URL(path, base).href, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.pjax && window.Alpine
      && document.querySelector('[x-data="desktopWidgets"]')?._x_dataStack);
    await page.waitForFunction(() => {
      const host = Alpine.$data(document.querySelector('[x-data="desktopWidgets"]'));
      return host.sources.hydrated === true;
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll('.desktop-node-slot .desktop-widget-card')]
        .filter((node) => node.getBoundingClientRect().width > 0);
      return visible.length > 0 && visible.every((node) => !node.querySelector('.desktop-widget-loading'));
    });
    assert.equal(new URL(page.url()).pathname, path, 'background hydration must not navigate');
    assert.equal(homeRequests, 1, 'one shared home data request per cold entry');
    const before = await page.evaluate(() => {
      const host = Alpine.$data(document.querySelector('[x-data="desktopWidgets"]'));
      return { layout: JSON.stringify(host.widgets), sources: {
        hydrated: host.sources.hydrated, latestPosts: host.sources.latestPosts.length,
        recentFriends: host.sources.recentFriends.length
      }, timeOrigin: performance.timeOrigin };
    });
    assert.ok(before.sources.latestPosts > 0, 'configured latest posts must receive data');
    await page.locator('button[aria-label="打开通知中心"]:visible').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[x-data]')].some((node) => {
      const host = Alpine.$data(node);
      return host.notificationCenterOpen && host.notificationWidgetDataStatus === 'ready';
    }));
    assert.equal(homeRequests, 1, 'notification center must reuse hydrated data');
    const after = await page.evaluate(() => {
      const host = Alpine.$data(document.querySelector('[x-data="desktopWidgets"]'));
      return { layout: JSON.stringify(host.widgets), timeOrigin: performance.timeOrigin };
    });
    assert.deepEqual(after, { layout: before.layout, timeOrigin: before.timeOrigin });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    records.push({ path, homeRequests, sources: before.sources, errors, writes });
    await context.close();
  }
  for (const mode of ['shared pending request', 'failed request retry']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1000 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let homeRequests = 0;
    let release;
    let reportHeld;
    const held = new Promise((resolve) => { reportHeld = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        throw new Error(`unexpected business write: ${request.method()} ${new URL(request.url()).pathname}`);
      }
      if (request.url() !== new URL('/', base).href) return route.continue();
      homeRequests++;
      if (homeRequests === 1 && mode === 'failed request retry') {
        return route.fulfill({ status: 503, contentType: 'text/html', body: '<p>test unavailable</p>' });
      }
      if (mode === 'shared pending request') {
        reportHeld();
        await gate;
      }
      return route.continue();
    });
    await page.goto(new URL('/links', base).href, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.pjax && window.Alpine);
    if (mode === 'shared pending request') {
      await held;
      await page.locator('button[aria-label="打开通知中心"]:visible').click();
      await page.waitForFunction(() => [...document.querySelectorAll('[x-data]')].some((node) =>
        Alpine.$data(node).notificationWidgetDataStatus === 'loading'));
      assert.equal(homeRequests, 1, 'desktop and notification center must share the pending request');
      release();
    } else {
      await page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="desktopWidgets"]')).widgetDataStatus === 'error');
      // The retry belongs to a background desktop card. Minimize the foreground
      // app exactly as a user would before clicking that card.
      await page.locator('.traffic-btn.minimize:visible').click();
      const retry = page.locator('.desktop-node-slot .widget--halo-latest_posts [data-widget-data-retry]').first();
      await retry.click();
    }
    await page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="desktopWidgets"]')).sources.hydrated === true);
    assert.equal(homeRequests, mode === 'shared pending request' ? 1 : 2);
    assert.equal(new URL(page.url()).pathname, '/links');
    assert.deepEqual(errors, []);
    records.push({ mode, homeRequests, errors });
    await context.close();
  }
  const context = await readLiveBuildContext(base);
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(`${evidence}/results.json`, JSON.stringify({ context, records }, null, 2) + '\n');
  console.log(`Direct widget entry passed: ${records.length} scenarios`);
} finally {
  await browser.close();
}
