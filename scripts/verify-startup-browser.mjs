import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Exercise served theme assets. Boot configuration is injected only into this
// browser's HTML response; every real write is blocked before forwarding.
const site = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090/');
const output = path.resolve('output/startup-2026-09-30/browser');
await fs.mkdir(output, { recursive: true });
const manifest = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
const remote = await (await fetch(new URL('/themes/theme-sky-blog-3/assets/asset-manifest.json', site))).json();
assert.deepEqual(remote.__meta, manifest.__meta, 'served and local builds must match');
const startup = (await fs.readFile('templates/assets/build-startup.html', 'utf8')).match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(startup);
const shellPath = new URL(manifest['shell-core'].js[0], site).pathname;
const report = { build: manifest.__meta, boundary: 'Served theme with isolated boot HTML overrides; no server configuration or authentication writes.', checks: [], screenshots: [], blockedWrites: [], errors: [] };
const browser = await chromium.launch({ headless: true });

async function fixture({ width = 1280, height = 900, mode = 'direct', frequency = 'tab_once', holdShell = false, motion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, serviceWorkers: 'block' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  if (!holdShell) release();
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      report.blockedWrites.push({ method: req.method(), path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (url.origin === site.origin && url.pathname === '/halo-tracker.js') {
      return route.fulfill({ contentType: 'application/javascript', body: '/* isolated acceptance */' });
    }
    if (url.origin === site.origin && url.pathname === shellPath) await gate;
    if (url.origin === site.origin && req.isNavigationRequest() && req.resourceType() === 'document') {
      const response = await route.fetch({ headers: { ...req.headers(), 'Cache-Control': 'no-cache' } });
      assert.equal(response.status(), 200, `${url.pathname} must render successfully`);
      let html = await response.text();
      assert.ok(!html.includes('data-theme-startup data-mode="boot"'), 'site must retain its normal-display setting during isolated acceptance');
      if (mode === 'boot') {
        const scene = url.pathname === '/login' ? 'login' : url.pathname === '/' ? 'desktop' : 'app';
        html = html.replace(/<body\b[^>]*>/, (tag) => `${tag}<script data-theme-startup data-mode="boot" data-scene="${scene}" data-frequency="${frequency}" data-logo-mode="apple">${startup}</script>`);
      }
      return route.fulfill({ response, body: html });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  return { context, page, release };
}
const capture = async (page, name) => {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
};
const ready = (page) => page.waitForFunction(() => document.querySelector('.dock-container')?.dataset.dockReady === 'true'
  && !document.querySelector('[data-early-desktop-surface]'));
const slots = (page, early) => page.evaluate((early) => [...document.querySelectorAll(early ? '[data-early-desktop-key]' : '.desktop-node-slot')].map((el) => {
  const rect = el.getBoundingClientRect();
  return { key: early ? el.dataset.earlyDesktopKey : el.dataset.desktopKey, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}), early);

try {
  for (const width of [1280, 375]) {
    const f = await fixture({ width, height: width === 375 ? 812 : 900, holdShell: true });
    try {
      await f.page.goto(site.href, { waitUntil: 'domcontentloaded' });
      await f.page.locator('[data-early-desktop-key]').first().waitFor({ state: 'visible' });
      const early = await slots(f.page, true);
      assert.ok(early.length > 0);
      assert.equal(await f.page.locator('[data-theme-startup-layer]').count(), 0);
      await capture(f.page, `direct-${width}-early`);
      f.release();
      await ready(f.page);
      const final = await slots(f.page, false);
      assert.deepEqual(early.map((node) => node.key).sort(), final.map((node) => node.key).sort());
      let largestDelta = 0;
      for (const node of early) {
        const actual = final.find((item) => item.key === node.key);
        for (const dimension of ['x', 'y', 'width', 'height']) {
          const delta = Math.abs(actual[dimension] - node[dimension]);
          largestDelta = Math.max(largestDelta, delta);
          assert.ok(delta <= 1, `${width}: ${node.key} ${dimension} shifted ${delta}px`);
        }
      }
      await capture(f.page, `direct-${width}-ready`);
      report.checks.push({ name: `normal ${width}px early geometry takeover`, nodes: final.length, largestDelta });
    } finally { f.release(); await f.context.close(); }
  }

  for (const frequency of ['tab_once', 'every_reload']) {
    const f = await fixture({ mode: 'boot', frequency, holdShell: true });
    try {
      await f.page.goto(site.href, { waitUntil: 'domcontentloaded' });
      await f.page.locator('[data-theme-startup-layer]').waitFor({ state: 'visible' });
      await capture(f.page, `boot-${frequency}`);
      f.release();
      assert.equal(await f.page.evaluate(() => window.__THEME_STARTUP__.finished), 'interactive');
      await ready(f.page);
      await f.page.reload({ waitUntil: 'domcontentloaded' });
      await ready(f.page);
      assert.equal(await f.page.evaluate(() => Boolean(window.__THEME_STARTUP__)), frequency === 'every_reload');
      if (frequency === 'every_reload') assert.equal(await f.page.evaluate(() => window.__THEME_STARTUP__.finished), 'interactive');
      report.checks.push({ name: `${frequency}: first visit and manual reload` });
    } finally { f.release(); await f.context.close(); }
  }

  const slow = await fixture({ mode: 'boot', holdShell: true });
  try {
    await slow.page.goto(site.href, { waitUntil: 'domcontentloaded' });
    assert.equal(await slow.page.evaluate(() => window.__THEME_STARTUP__.finished), 'timeout');
    assert.equal(await slow.page.locator('[data-theme-startup-layer]').count(), 0);
    assert.equal(await slow.page.locator('[inert]').count(), 0);
    await capture(slow.page, 'boot-timeout-released');
    slow.release();
    await ready(slow.page);
    report.checks.push({ name: 'slow Shell releases overlay at the deadline and still hydrates afterward' });
  } finally { slow.release(); await slow.context.close(); }

  const login = await fixture({ mode: 'boot' });
  try {
    await login.page.goto(new URL('/login', site).href, { waitUntil: 'domcontentloaded' });
    assert.equal(await login.page.evaluate(() => window.__THEME_STARTUP__.finished), 'interactive');
    await login.page.locator('.halo-form').waitFor({ state: 'visible' });
    assert.ok(await login.page.locator('.halo-form input:not([type="hidden"])').count());
    await capture(login.page, 'login-ready');
    await login.page.goto(site.href, { waitUntil: 'domcontentloaded' });
    await ready(login.page);
    assert.equal(await login.page.evaluate(() => Boolean(window.__THEME_STARTUP__)), false);
    report.checks.push({ name: 'official login form becomes ready, next navigation does not replay; credentials were not submitted' });
  } finally { await login.context.close(); }
  assert.deepEqual(report.errors, [], 'startup paths must not introduce page errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
