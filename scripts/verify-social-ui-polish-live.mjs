import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
const output = await verificationOutput('social-live');
const identity = await readLiveBuildContext(base);
const records = [], failures = [], errors = [], writes = [], simulated = [], consoleErrors = [];
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort('blockedbyclient');
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      if (url.pathname === '/apis/api.halo.run/v1alpha1/trackers/counter') return route.fulfill({ status: 204, body: '' });
      writes.push({ width, method: request.method(), url: request.url() });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push({ width, message: error.message }));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ width, message: message.text() }); });
    const visit = async (path, app) => {
      const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.waitForFunction((app) => window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === app, app);
    };
    const check = async (label, run) => {
      try { await run(); records.push({ width, label, status: 'passed' }); }
      catch (error) { failures.push({ width, label, message: error.message }); }
    };
    await visit('/moments', 'moments');
    await check('瞬间标签实际导航', async () => {
      const tag = page.locator('.moments-tag:not(.is-active)').first();
      if (!await tag.count()) return;
      const href = await tag.getAttribute('href');
      await tag.click();
      await page.waitForFunction((href) => location.href === new URL(href, location.origin).href, href);
      await page.waitForFunction(() => document.querySelector('.moments-feed-region')?.getAttribute('aria-busy') !== 'true');
      await page.locator('.moments-tag').first().click();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('tag'));
    });
    await check('评论展开／选择回复／取消回复，未提交', async () => {
      const card = page.locator('[data-moment-card]').filter({ has: page.locator('[data-moment-comments-toggle]') }).first();
      await card.locator('[data-moment-action-toggle]').click();
      await card.locator('[data-moment-comments-toggle]').click();
      await card.locator('[data-moment-comment-input]').waitFor({ state: 'visible' });
      const reply = card.locator('[data-moment-reply-to]').first();
      if (Number(await card.getAttribute('data-comment-count')) > 0) await reply.waitFor({ state: 'visible' });
      if (await reply.count()) {
        await reply.click(); await card.locator('[data-moment-reply-bar]').waitFor({ state: 'visible' });
        await card.locator('[data-moment-reply-cancel]').click();
        assert.equal(await card.locator('[data-moment-reply-bar]').isVisible(), false);
      }
      assert.equal(await card.locator('[data-moment-comment-input]').inputValue(), '');
    });
    await check('通知键盘打开与 Escape 返回', async () => {
      const toggle = page.locator('[data-moments-notification-toggle]');
      await toggle.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-moments-notification-panel]').evaluate((el) => document.activeElement === el), true);
      await page.keyboard.press('Escape');
      assert.equal(await toggle.evaluate((el) => document.activeElement === el), true);
    });
    await page.screenshot({ path: `${output}/social-live-moments-${width}.png` });
    await check('瞬间详情与返回', async () => {
      await page.locator('[data-moment-card] .moment-feed-time-link').first().click();
      await page.locator('.moments-app--detail').waitFor();
      await page.locator('.moments-titlebar-back').filter({ visible: true }).first().click();
      await page.locator('.moments-app--feed').waitFor();
    });
    await visit('/links', 'links');
    await check('友链搜索无结果与一键清空', async () => {
      await page.locator('.links-search').fill('social-ui-no-result-20261116');
      await page.locator('.links-list-empty').filter({ has: page.locator('button.links-secondary-action') }).filter({ visible: true }).waitFor();
      await page.locator('.links-search-clear').click();
      assert.equal(await page.locator('.links-search').inputValue(), '');
      assert.equal(await page.locator('.links-search').evaluate((el) => document.activeElement === el), true);
    });
    await check('友链详情与返回焦点', async () => {
      const row = page.locator('[data-link-card]').first();
      // clearSearch commits Alpine state before x-show has revealed its rows.
      // focus() itself does not wait for visibility, unlike a real click.
      await row.waitFor({ state: 'visible' });
      await row.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.links-app-shell').classList.contains('is-expanded'));
      const close = width === 390 ? page.locator('.links-detail-back') : page.locator('.links-detail-close');
      await close.click();
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-link-card'));
    });
    await page.locator('.links-rail-button[title="朋友圈"]').click();
    await check('朋友圈来源筛选与恢复', async () => {
      await page.locator('.links-search').fill('social-ui-no-source-20261116');
      await page.locator('.links-list-empty').filter({ hasText: '没有匹配的来源' }).waitFor({ state: 'visible' });
      await page.locator('.links-search-clear').click();
      assert.equal(await page.locator('.links-search').inputValue(), '');
    });
    await page.screenshot({ path: `${output}/social-live-links-${width}.png` });
    await page.locator('.links-rail-button[title="添加友链"]').click();
    await check('添加助手与留言板只读切换', async () => {
      await page.locator('#view-apply').waitFor({ state: 'visible' });
      await page.locator('#links-apply-site-url').fill('https://example.invalid');
      await page.locator('[data-link-meta-action="manual"]').click();
      await page.screenshot({ path: `${output}/social-live-apply-${width}.png` });
      await page.locator('#nav-board').click(); await page.locator('#view-board').waitFor({ state: 'visible' });
    });
    // Only the user-read response is simulated. All UI, CSS and JS come from
    // the actual 8090 build; no source or markup is injected and no POST occurs.
    await context.route('**/apis/api.console.halo.run/v1alpha1/users/-', (route) => {
      simulated.push({ width, path: new URL(route.request().url()).pathname, purpose: '发布面板身份读取' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ metadata: { name: 'social-ui-fixture' }, spec: { displayName: '隔离界面验收' } }) });
    });
    await visit('/moments', 'moments');
    await check('发布面板标签／表情／取消；仅身份 GET 模拟', async () => {
      await page.locator('[data-moments-publish-open]').waitFor({ state: 'visible' });
      await page.locator('[data-moments-publish-open]').click();
      await page.locator('[data-moments-publish-content]').fill('仅用于浏览器草稿，未发表');
      await page.locator('[data-moments-publish-tag-toggle]').click();
      await page.locator('[data-moments-publish-tag-input]').fill('界面验收');
      await page.locator('[data-moments-publish-tag-add]').click();
      await page.locator('[data-moments-publish-emoji-toggle]').click();
      await page.screenshot({ path: `${output}/social-live-publish-${width}.png` });
      await page.locator('[data-moments-publish-close]').click();
      // close() removes open synchronously; native close listeners reset the
      // draft and return focus in a later task. Observe completed cancellation.
      await page.waitForFunction(() => !document.querySelector('[data-moments-publish-dialog]').open
        && document.querySelector('[data-moments-publish-content]').value === ''
        && document.activeElement?.hasAttribute('data-moments-publish-open'));
      assert.equal(await page.locator('[data-moments-publish-content]').inputValue(), '');
    });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(`${output}/social-live-results.json`, JSON.stringify({
  identity: { build: identity.build, halo: identity.halo, sourceFingerprint: identity.sourceFingerprint },
  records, failures, errors, blockedWrites: writes, simulated, consoleErrors,
  scope: 'Actual served UI with no source/markup/style injection. Non-read requests blocked; publish identity GET simulated and identified above.'
}, null, 2));
console.log(`Social live UI: ${records.length} passed, ${failures.length} failed, ${errors.length} runtime errors, ${writes.length} blocked writes`);
failures.forEach((failure) => console.error(JSON.stringify(failure)));
assert.equal(failures.length, 0); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
