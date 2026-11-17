import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { verificationOutput } from './lib/verification-output.mjs';
import { collectBrowserRuntimeErrors } from './lib/browser-runtime-errors.mjs';

const base = (process.env.SMOKE_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const api = new URL('/apis/api.halo.run/v1alpha1/trackers/upvote', base).href;
const dir = await verificationOutput('post-upvote-live');
const report = { identity: await readLiveBuildContext(base), scope: '实际文章、Alpine 和 Swup；所有点赞 POST 在浏览器拦截，绝不提交到 Halo', cases: [], runtime: [] };
const browser = await chromium.launch();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function ready(page, app = 'reader') {
  await page.waitForFunction(app => window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === app
    && !document.documentElement.classList.contains('is-animating')
    && !window.__THEME_STARTUP__?.active && !document.querySelector('[data-theme-startup-layer]'), app);
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let mode = 'failed', held = deferred(), mockPosts = 0;
    const blockedWrites = [], suppressedTelemetry = [];
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url() === api && request.method() === 'POST') {
        mockPosts++;
        const payload = request.postDataJSON();
        assert.equal(payload.group, 'content.halo.run');
        assert.equal(payload.plural, 'posts');
        assert.ok(payload.name);
        if (mode === 'held') { await held.promise; await route.fulfill({ status: 204 }).catch(() => {}); return; }
        return route.fulfill({ status: mode === 'failed' ? 503 : 204, body: '' });
      }
      if (request.url() === new URL('/apis/api.halo.run/v1alpha1/trackers/counter', base).href && request.method() === 'POST') {
        suppressedTelemetry.push({ method: request.method(), url: request.url() });
        return route.fulfill({ status: 204 });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        blockedWrites.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const runtime = collectBrowserRuntimeErrors(page, { expected: (kind, value) => value.url === api && (
      kind === 'responseErrors' && value.status === 503
      || kind === 'consoleErrors' && value.text.includes('503')
      || kind === 'requestFailures' && value.errorText === 'net::ERR_ABORTED'
    ) });
    try {
      await page.goto(`${base}/archives`, { waitUntil: 'domcontentloaded' }); await ready(page, 'explorer-archives');
      const href = await page.locator('[data-archive-post-option][href]').first().getAttribute('href');
      assert.ok(href, 'A public article is required');
      await page.goto(new URL(href, base).href, { waitUntil: 'domcontentloaded' }); await ready(page);
      const button = page.locator('.post-action-chip--like'), feedback = page.locator('.post-action-feedback');
      const initial = Number((await button.innerText()).match(/\d+/)?.[0]); assert.ok(Number.isFinite(initial));
      await button.click();
      await page.waitForFunction(() => document.querySelector('.post-action-chip--like')?.textContent.includes('等待确认'));
      assert.equal(await button.isDisabled(), true);
      assert.match(await feedback.innerText(), /未确认/);
      assert.equal(mockPosts, 1);
      await page.locator('.post-actions-shell').screenshot({ path: `${dir}/uncertain-${width}.png` });
      report.cases.push({ width, name: '503 结果不确定，提示保留且禁止重复点赞', status: 'PASS' });

      mode = 'held';
      await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
      await button.click();
      await page.waitForFunction(() => document.querySelector('.post-action-chip--like')?.textContent.includes('等待确认'), null, { timeout: 20000 });
      assert.equal(await button.getAttribute('aria-busy'), 'false');
      assert.equal(await button.isDisabled(), true);
      assert.equal(mockPosts, 2);
      held.resolve(); held = deferred();
      report.cases.push({ width, name: '实际 15 秒超时结束等待，不自动重发', status: 'PASS' });

      await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
      await page.evaluate(() => {
        window.__upvoteOld = window.Alpine.$data(document.querySelector('.post-actions-shell'));
        window.__upvoteDocument = document;
      });
      await button.click();
      await page.waitForFunction(() => window.__upvoteOld.pending);
      await page.evaluate(() => window.pjax.loadUrl('/docs')); await ready(page, 'docsme');
      assert.deepEqual(await page.evaluate(() => ({ document: window.__upvoteDocument === document,
        destroyed: window.__upvoteOld._destroyed, pending: window.__upvoteOld.pending, liked: window.__upvoteOld.liked })),
      { document: true, destroyed: true, pending: false, liked: false });
      held.resolve();
      report.cases.push({ width, name: '点赞等待中离页，Swup 保留文档并销毁旧请求', status: 'PASS' });

      mode = 'success';
      await page.goto(new URL(href, base).href, { waitUntil: 'domcontentloaded' }); await ready(page);
      await button.click();
      await page.waitForFunction(() => document.querySelector('.post-action-chip--like')?.getAttribute('aria-pressed') === 'true');
      assert.equal((await button.innerText()).trim(), `${initial + 1} 点赞`);
      assert.equal(await button.isDisabled(), true);
      assert.equal(await feedback.isVisible(), false);
      assert.equal(mockPosts, 4);
      report.cases.push({ width, name: '204 明确成功只加一，本地防重正常', status: 'PASS' });
    } catch (error) {
      report.cases.push({ width, name: '点赞界面流程', status: 'FAIL', message: error.message });
      await page.screenshot({ path: `${dir}/failure-${width}.png` }).catch(() => {});
    } finally {
      held.resolve();
      const snapshot = runtime.snapshot();
      const external = value => value.url && new URL(value.url).origin !== new URL(base).origin && ['image', 'media', 'font'].includes(value.resourceType);
      const externalMedia = [...snapshot.requestFailures, ...snapshot.responseErrors].filter(external);
      const externalUrls = new Set(externalMedia.map(value => value.url));
      const cancelledReads = snapshot.requestFailures.filter(value => value.method === 'GET' && value.errorText === 'net::ERR_ABORTED');
      const failures = [...snapshot.pageErrors, ...snapshot.consoleErrors.filter(value => !externalUrls.has(value.url)),
        ...snapshot.requestFailures.filter(value => !external(value) && !cancelledReads.includes(value)),
        ...snapshot.responseErrors.filter(value => !external(value)), ...blockedWrites];
      report.runtime.push({ width, ...snapshot, failures, externalMedia, cancelledReads, blockedWrites, suppressedTelemetry, mockPosts });
      runtime.stop(); await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ report: `${dir}/report.json`, cases: report.cases,
  runtime: report.runtime.map(({ width, failures, mockPosts }) => ({ width, failures, mockPosts })) }, null, 2));
if (report.cases.some(item => item.status !== 'PASS') || report.runtime.some(item => item.failures.length)) process.exitCode = 1;
