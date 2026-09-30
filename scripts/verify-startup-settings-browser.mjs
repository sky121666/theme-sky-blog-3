import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

// Read the served build in an isolated browser. Only the settings authorization
// attribute and the config endpoint are fixtures; no real writes are forwarded.
const site = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090/');
const output = path.resolve(process.env.STARTUP_SETTINGS_OUTPUT || 'output/startup-2026-09-30/settings');
const documentFixture = process.env.STARTUP_SETTINGS_DOCUMENT || '';
const fixtureHtml = documentFixture ? await fs.readFile(path.resolve(documentFixture), 'utf8') : '';
const initial = {
  header: { logo: { title: '启动设置隔离验收' } },
  dock: { appearance: { settings_enabled: true }, future: 'keep-dock' },
  desktop: { startup: { future_flag: 'keep-startup' }, background: { mode: 'preset', preset: 'deep-sea' }, icons: { posts: ['keep-post'] } },
  moments: { profile: { display_name: '保留的瞬间名称' } },
  fixtureFuture: { preserved: 42 }
};
let config = structuredClone(initial);
let revision = 1;
const report = {
  fixture: true,
  boundary: '真实构建与服务端主题文档；仅设置授权 DOM 属性及配置 GET/PUT 使用隔离 fixture。除 mock PUT 外所有非 GET 请求阻断；未读取凭据，未验证真实账号权限或 Halo 持久化。',
  checks: [], screenshots: [], errors: [], fixtureWrites: [], blockedWrites: [], assets: [],
  realWriteRequestsForwarded: 0
};
if (documentFixture) report.boundary = '当前构建与服务端主题 SSR 快照；设置授权 DOM 属性及配置 GET/PUT 使用隔离 fixture。除 mock PUT 外所有非 GET 请求阻断；浏览器未接收登录凭据，未验证真实账号权限或 Halo 持久化。';
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output, { recursive: true });
let browser;
let context;
let page;
try {
  const manifest = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
  const manifestResponse = await fetch(new URL('/themes/theme-sky-blog-3/assets/asset-manifest.json', site));
  assert.equal(manifestResponse.status, 200);
  const remoteManifest = await manifestResponse.json();
  assert.deepEqual(remoteManifest.__meta, manifest.__meta, 'served and local build metadata must match');
  if (fixtureHtml) assert.ok(fixtureHtml.includes(manifest.__meta.revision), 'SSR snapshot must match the current build revision');
  report.build = manifest.__meta;
  for (const asset of [...manifest['shell-core'].js, ...manifest['shell-core'].css]) {
    const response = await fetch(new URL(asset, site));
    assert.equal(response.status, 200);
    const relative = asset.slice(asset.indexOf('/assets/') + 1).split('?')[0];
    const localBytes = await fs.readFile(path.join('templates', relative));
    const servedBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(servedBytes), digest(localBytes), `served asset differs: ${relative}`);
    report.assets.push({ path: relative, sha256: digest(servedBytes) });
  }
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local = url.origin === site.origin;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { etag: `"startup-fixture-${revision}"` }, body: JSON.stringify(body) });
    if (local && /^\/apis\/api\.console\.halo\.run\/v1alpha1\/themes\/[^/]+\/json-config$/.test(url.pathname)) {
      if (method === 'GET') return json(config);
      if (method === 'PUT') {
        const expected = `"startup-fixture-${revision}"`;
        assert.equal(request.headers()['if-match'], expected, 'save must use the current ETag');
        config = request.postDataJSON();
        revision++;
        report.fixtureWrites.push({ method, path: url.pathname, config: structuredClone(config) });
        return json(config);
      }
    }
    if (method !== 'GET') {
      report.blockedWrites.push({ method, origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (local && url.pathname === '/halo-tracker.js') {
      return route.fulfill({ contentType: 'application/javascript', body: '/* Analytics excluded from isolated startup acceptance. */' });
    }
    if (local && request.isNavigationRequest() && request.resourceType() === 'document') {
      const response = fixtureHtml ? null : await route.fetch({ headers: { ...request.headers(), 'Cache-Control': 'no-cache' } });
      let replacements = 0;
      const html = (fixtureHtml || await response.text()).replace(/<[^>]*\bdata-theme-settings-protocol\b[^>]*>/g, (tag) => {
        replacements++;
        assert.match(tag, /\bdata-authenticated\s*=/);
        return tag.replace(/\bdata-authenticated\s*=\s*(["'])[^"']*\1/, 'data-authenticated="true"');
      });
      assert.equal(replacements, 1, 'expected exactly one settings protocol');
      return route.fulfill(response ? { response, body: html } : { status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => report.errors.push({ message: error.message, stack: error.stack }));
  const settings = page.locator('[data-theme-settings-window]');
  const pane = settings.locator('[data-settings-pane="startup"]');
  const field = (name) => pane.locator(`[data-setting-path="desktop.startup.${name}"]`);
  const mode = (name) => field('mode').getByRole('radio', { name: new RegExp(`^${name}`) });
  const preview = pane.getByRole('button', { name: '演示一次', exact: true });
  const startupLayer = page.locator('[data-theme-startup-layer="preview"]');
  const draft = () => page.evaluate(() => {
    const store = window.Alpine.store('themeSettings');
    return JSON.parse(JSON.stringify({ draft: store.draft, baseline: store.baseline, dirtyPaths: store.dirtyPaths }));
  });
  const storage = () => page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)])));
  const value = (name) => page.evaluate((name) => window.Alpine.store('themeSettings').value(`desktop.startup.${name}`), name);
  const check = async (name, run) => { await run(); report.checks.push({ name, status: 'passed' }); };
  const capture = async (name, { immediate = false } = {}) => {
    if (immediate) {
      // Visibility alone allows the first transparent frame of the 120ms fade.
      // Capture the actual overlay before its independent two-second deadline.
      await page.waitForFunction(() => {
        const layer = document.querySelector('[data-theme-startup-layer="preview"]');
        return layer && Number(getComputedStyle(layer).opacity) >= 0.99;
      });
    } else await page.waitForFunction(() => document.querySelectorAll('.sky-heart').length === 0);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    report.screenshots.push(`${name}.png`);
  };
  const choose = async (label) => settings.locator('.theme-settings-navigation').getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click();
  const url = new URL(site.href);
  url.searchParams.set('_startup_settings_verify', `${manifest.__meta.revision}-${Date.now()}`);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.dock-container')?.dataset.dockReady === 'true');
  await page.locator('.dock-settings-icon').click();
  await settings.waitFor({ state: 'visible' });
  await choose('首屏加载');
  await pane.waitFor({ state: 'visible' });

  await check('new startup pane is reachable and missing values default to direct/tab_once/apple', async () => {
    assert.equal(await mode('普通显示').getAttribute('aria-checked'), 'true');
    assert.equal(await value('mode'), 'direct');
    assert.equal(await value('frequency'), 'tab_once');
    assert.equal(await value('logo_mode'), 'apple');
    assert.equal(await preview.isVisible(), false);
    assert.equal(report.fixtureWrites.length, 0);
    await capture('startup-direct-desktop');
  });
  await check('switching to boot changes only the draft and does not activate a visual layer', async () => {
    const before = await storage();
    await mode('开机启动').click();
    await preview.waitFor({ state: 'visible' });
    assert.equal(await value('mode'), 'boot');
    assert.equal(await page.locator('[data-theme-startup-layer]').count(), 0);
    assert.deepEqual(config, initial);
    assert.equal(report.fixtureWrites.length, 0);
    assert.deepEqual(await storage(), before);
    await capture('startup-boot-draft-desktop');
  });
  await check('preview uses the draft, Escape restores focus and preserves both storage and unsaved values', async () => {
    await field('frequency').locator('select').selectOption('every_reload');
    const beforeDraft = await draft();
    const beforeStorage = await storage();
    await preview.click();
    await startupLayer.waitFor({ state: 'visible' });
    await capture('startup-preview-desktop', { immediate: true });
    await page.keyboard.press('Escape');
    await startupLayer.waitFor({ state: 'detached' });
    await page.waitForFunction(() => {
      const button = document.querySelector('.theme-settings-startup-demo button');
      return button && !button.disabled && document.activeElement === button;
    });
    assert.deepEqual(await draft(), beforeDraft);
    assert.deepEqual(await storage(), beforeStorage);
    assert.deepEqual(config, initial);
    assert.equal(report.fixtureWrites.length, 0);
    assert.equal(await settings.isVisible(), true);
    await capture('startup-preview-return');
  });
  await check('Cancel restores startup defaults without a config write', async () => {
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await value('mode'), 'direct');
    assert.equal(await value('frequency'), 'tab_once');
    assert.deepEqual((await draft()).dirtyPaths, []);
    assert.deepEqual(config, initial);
    assert.equal(report.fixtureWrites.length, 0);
  });
  await check('Apply saves startup changes through mock ETag config and preserves unrelated and unknown fields', async () => {
    await mode('开机启动').click();
    await field('frequency').locator('select').selectOption('every_reload');
    await field('logo_mode').locator('select').selectOption('site');
    await settings.locator('.theme-settings-actions').getByRole('button', { name: '应用', exact: true }).click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').saving && !window.Alpine.store('themeSettings').hasDirtyChanges());
    assert.equal(report.fixtureWrites.length, 1);
    const expected = structuredClone(initial);
    Object.assign(expected.desktop.startup, { mode: 'boot', frequency: 'every_reload', logo_mode: 'site' });
    assert.deepEqual(config, expected);
    assert.equal(await page.locator('[data-theme-startup-layer]').count(), 0);
    await capture('startup-saved-desktop');
  });
  await check('375px startup pane, controls, preview and cancellation remain usable without horizontal overflow', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await settings.getByRole('button', { name: '展开设置分类', exact: true }).click();
    await choose('外观');
    await settings.getByRole('button', { name: '展开设置分类', exact: true }).click();
    await choose('首屏加载');
    await pane.waitFor({ state: 'visible' });
    assert.ok(await settings.evaluate((element) => element.scrollWidth - element.clientWidth) <= 2);
    await field('frequency').locator('select').selectOption('tab_once');
    const before = await storage();
    await preview.click();
    await startupLayer.waitFor({ state: 'visible' });
    await capture('startup-preview-mobile-375', { immediate: true });
    await startupLayer.getByRole('button', { name: '结束演示', exact: true }).click();
    await startupLayer.waitFor({ state: 'detached' });
    assert.deepEqual(await storage(), before);
    assert.equal(await value('frequency'), 'tab_once');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await value('frequency'), 'every_reload');
    assert.equal(report.fixtureWrites.length, 1);
    const footer = await settings.locator('.theme-settings-actions').boundingBox();
    assert.ok(footer && footer.x >= 0 && footer.x + footer.width <= 376 && footer.y + footer.height <= 813);
    await capture('startup-mobile-375');
  });
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack || String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await context?.close();
  await browser?.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, fixtureWrites: report.fixtureWrites.length, realWriteRequestsForwarded: report.realWriteRequestsForwarded, output, failure: report.failure }, null, 2));
}
