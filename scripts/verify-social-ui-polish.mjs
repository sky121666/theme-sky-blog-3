import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { verificationOutput } from './lib/verification-output.mjs';

const root = process.cwd();
const output = await verificationOutput('social');
const windowTemplate = await fs.readFile(path.join(root, 'templates/modules/moments-app/window.html'), 'utf8');
const publishDialog = windowTemplate.match(/<dialog\b[\s\S]*?<\/dialog>/)?.[0];
const notification = windowTemplate.match(/<div class="moments-notification"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0];
assert.ok(publishDialog, 'Use the current publish dialog markup');
const failures = [];
const records = [];
const writes = [];
const errors = [];
const fixture = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/apps/moments/styles/moment.css">
<link rel="stylesheet" href="/src/apps/links/styles/index.css">
<style>body{margin:0;padding:24px;background:#dedde5}button{cursor:pointer}.moments-window{position:relative;width:min(560px,100%);height:700px;background:var(--wc-bg);margin:0 auto}.links-app{position:relative;height:700px;width:min(1120px,100%)}.links-search-wrap{display:block}.test-section{margin-bottom:24px}</style></head><body>
<div class="moments-window test-section"><button type="button" data-moments-publish-open>发表瞬间</button>${publishDialog}${notification}
<div class="moments-app" data-app-root="moments"><div class="moments-feed-list"><article class="moment-feed-card"><div class="moment-feed-content-col"><p class="moment-feed-nickname">Sky</p><div class="moment-feed-body">保留此刻的想法，继续一次完整的互动。</div>
<section class="moment-feed-comments-panel"><div class="moment-feed-comment-line">访客：这是一段较长的评论内容，用于验证回复提示与正文之间的关系。</div>
<div class="moment-feed-reply-bar" data-test-reply><span>正在回复 访客</span><button>取消回复</button></div>
</section></div></article>
<article class="moment-feed-card" data-moment-card="fixture-loading" data-moment-name="fixture-loading" data-comment-count="1"><div class="moment-feed-content-col"><section class="moment-feed-comments-panel" data-moment-comments-panel><div data-moment-comments-status></div><div data-moment-comments-list></div></section></div></article>
</div></div></div>
<div class="links-app test-section"><div class="links-app-shell"><aside class="links-rail"></aside><section class="links-list-pane">
<header class="links-list-header"><div class="links-search-wrap"><input class="links-search" type="search" aria-label="搜索友链"><button class="links-search-clear" aria-label="清空搜索">×</button></div><button class="links-list-add">+</button></header>
<button class="links-chat-row" data-link-card data-link-key="sample"><span class="links-row-avatar"></span><span class="links-row-copy"><span class="links-row-title">示例站点</span><span class="links-row-preview">关于日常与技术的记录</span></span></button></section>
<section class="links-detail-pane"><header class="links-detail-header"><button class="links-detail-back" aria-label="返回列表">返回</button><div class="links-detail-heading"><strong>示例站点</strong></div><button class="links-detail-action links-detail-close">收起</button></header><div class="links-detail-scroll"></div></section></div></div>
<script type="module">import '/src/apps/moments/hydrate.js';
import { registerLinksExplorer } from '/src/apps/links/runtime.js';
window.cleanupMoments = window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.moments.hydrate(document);
let factory; registerLinksExplorer({data(name, value){factory=value}});
const component = factory(); component.$root = document.querySelector('.links-app-shell');
component.links = [{key:'sample',name:'示例站点',groupKey:'all'}];
component.syncUrl = () => {}; component.watchLocationPermalink = () => {}; component.syncDocumentChrome = () => {};
component.syncWindowLayout = () => {}; component.scrollActivePaneToTop = () => {};
component.$nextTick = (fn) => requestAnimationFrame(() => {
component.$root.classList.toggle('is-expanded',component.detailOpen()); component.$root.classList.toggle('is-mobile-detail',component.detailOpen()); fn(); });
document.querySelector('[data-link-card]').onclick=()=>component.selectLink('sample');
document.querySelector('.links-detail-back').onclick=()=>component.collapseDetail();
document.querySelector('.links-search-clear').onclick=()=>component.clearSearch();
window.linksComponent = component; window.fixtureReady=true;</script></body></html>`;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET') {
      writes.push({ method: request.method, path: url.pathname });
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: '隔离失败响应' }));
      return;
    }
    if (url.pathname === '/apis/api.console.halo.run/v1alpha1/users/-') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ metadata: { name: 'fixture-user' }, spec: { displayName: '隔离账号' } }));
      return;
    }
    if (url.pathname.includes('/notifications')) {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"items":[]}'); return;
    }
    if (url.pathname === '/apis/api.halo.run/v1alpha1/comments') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"items":[],"total":0,"hasNext":false}'); return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixture); return;
    }
    if (!url.pathname.startsWith('/src/')) { response.writeHead(404); response.end(); return; }
    const filename = path.resolve(root, `.${url.pathname}`);
    if (!filename.startsWith(`${root}/src/`)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': filename.endsWith('.css') ? 'text/css' : 'text/javascript' });
    response.end(await fs.readFile(filename));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base
      ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base); await page.waitForFunction(() => window.fixtureReady);
    async function check(label, run) {
      try { await run(); records.push({ viewport: viewport.width, label, status: 'passed' }); }
      catch (error) { failures.push({ viewport: viewport.width, label, message: error.message }); }
    }
    await check('首次评论请求只显示一个加载状态', async () => {
      await page.waitForFunction(() => document.querySelector('[data-moment-card="fixture-loading"] [data-moment-comments-status]')?.textContent.includes('正在加载'));
      const loadingRows = await page.locator('[data-moment-card="fixture-loading"]').evaluate((card) =>
        [...card.querySelectorAll('[data-moment-comments-status], [data-moment-comments-list] > *')]
          .filter((el) => el.getClientRects().length && el.textContent.includes('正在加载评论')).length);
      assert.equal(loadingRows, 1);
    });
    await check('回复提示显示且长内容不溢出', async () => {
      assert.equal(await page.locator('[data-test-reply]').isVisible(), true);
      const overflow = await page.locator('.moment-feed-comments-panel').first().evaluate((el) => el.scrollWidth > el.clientWidth);
      assert.equal(overflow, false);
    });
    await page.locator('[data-moments-publish-open]').click();
    await page.locator('[data-moments-publish-content]').waitFor({ state: 'visible' });
    await check('发布面板标签展开状态可读，Escape 先收起标签再关闭', async () => {
      await page.locator('[data-moments-publish-tag-toggle]').click();
      assert.equal(await page.locator('[data-moments-publish-tag-toggle]').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-moments-publish-tag-row]').isVisible(), false);
      assert.equal(await page.locator('[data-moments-publish-dialog]').isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-moments-publish-dialog]').isVisible(), false);
      assert.equal(await page.locator('[data-moments-publish-open]').evaluate((el) => document.activeElement === el), true);
    });
    // Use cancel to recover a failing baseline before the next independent case.
    if (await page.locator('[data-moments-publish-dialog]').isVisible()) await page.locator('[data-moments-publish-close]').click();
    await page.locator('[data-moments-publish-open]').click();
    await page.locator('[data-moments-publish-content]').fill('隔离失败后保留的草稿');
    await check('发布失败保留草稿，写请求不重试', async () => {
      const before = writes.length;
      await page.locator('[data-moments-publish-submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-moments-publish-status]').dataset.tone === 'error');
      assert.equal(await page.locator('[data-moments-publish-content]').inputValue(), '隔离失败后保留的草稿');
      assert.equal(await page.locator('[data-moments-publish-submit]').isEnabled(), true);
      assert.match(await page.locator('[data-moments-publish-submit]').innerText(), /核对/);
      assert.equal(await page.locator('[data-moments-publish-content]').isEditable(), false);
      assert.equal(writes.length - before, 1);
    });
    // The next focus cases start from a new, editable draft. Closing alone
    // must preserve an unacknowledged publish, including across reopens.
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-moments-publish-new]').click();
    assert.equal(await page.locator('[data-moments-publish-content]').inputValue(), '');
    await page.locator('[data-moments-publish-close]').click();
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-moments-publish-open'));
    await check('通知可由键盘进入并用 Escape 返回触发器', async () => {
      await page.locator('[data-moments-notification-toggle]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-moments-notification-panel]').evaluate((el) => document.activeElement === el), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-moments-notification-panel]').isVisible(), false);
      assert.equal(await page.locator('[data-moments-notification-toggle]').evaluate((el) => document.activeElement === el), true);
    });
    async function cancelPublishAndSettle() {
      await page.evaluate(async () => {
        const dialog = document.querySelector('[data-moments-publish-dialog]');
        if (!dialog.open) return;
        await new Promise((resolve) => {
          dialog.addEventListener('close', resolve, { once: true });
          dialog.querySelector('[data-moments-publish-close]').click();
        });
      });
    }
    for (const target of ['notification', 'search']) {
      await check(`取消发布后立即进入${target === 'notification' ? '通知' : '搜索'}，迟到 close 不抢焦点`, async () => {
        await page.locator('[data-moments-publish-open]').click();
        await page.locator('[data-moments-publish-content]').fill('关闭前的草稿');
        const result = await page.evaluate(async (target) => {
          const dialog = document.querySelector('[data-moments-publish-dialog]');
          const closed = new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
          dialog.querySelector('[data-moments-publish-close]').click();
          let destination;
          if (target === 'notification') {
            const trigger = document.querySelector('[data-moments-notification-toggle]');
            trigger.focus(); trigger.click();
            destination = document.querySelector('[data-moments-notification-panel]');
          } else {
            destination = document.querySelector('.links-search');
            destination.focus({ preventScroll: true });
          }
          const entered = document.activeElement === destination;
          await closed;
          return { entered, retained: document.activeElement === destination,
            closed: !dialog.open, draft: dialog.querySelector('[data-moments-publish-content]').value };
        }, target);
        assert.equal(result.entered, true);
        assert.equal(result.retained, true);
        assert.equal(result.closed, true);
        assert.equal(result.draft, '');
      });
      if (await page.locator('[data-moments-notification-panel]').isVisible()) {
        await page.locator('[data-moments-notification-toggle]').click();
      }
      await cancelPublishAndSettle();
    }
    for (const order of [['emoji', 'tag'], ['tag', 'emoji']]) {
      await check(`发布子面板互斥：${order.join(' → ')}，Escape 回焦且保留草稿`, async () => {
        await page.locator('[data-moments-publish-open]').click();
        await page.locator('[data-moments-publish-content]').fill('子面板关闭后保留的草稿');
        for (const panel of order) await page.locator(`[data-moments-publish-${panel}-toggle]`).click();
        const selector = (panel) => `[data-moments-publish-${panel === 'tag' ? 'tag-row' : 'emoji-panel'}]`;
        assert.equal(await page.locator(selector(order[0])).isVisible(), false);
        assert.equal(await page.locator(selector(order[1])).isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator(selector(order[1])).isVisible(), false);
        assert.equal(await page.locator(`[data-moments-publish-${order[1]}-toggle]`).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator(`[data-moments-publish-${order[1]}-toggle]`).evaluate((el) => document.activeElement === el), true);
        assert.equal(await page.locator('[data-moments-publish-dialog]').isVisible(), true);
        assert.equal(await page.locator('[data-moments-publish-content]').inputValue(), '子面板关闭后保留的草稿');
      });
      await cancelPublishAndSettle();
    }
    await check('清空搜索保留分组并返回输入框', async () => {
      await page.evaluate(() => { window.linksComponent.searchQuery='不存在'; window.linksComponent.selectedGroup='all'; });
      await page.locator('.links-search-clear').click();
      const result = await page.evaluate(() => ({query:window.linksComponent.searchQuery,group:window.linksComponent.selectedGroup,focused:document.activeElement?.className}));
      assert.equal(result.query,''); assert.equal(result.group,'all'); assert.equal(result.focused,'links-search');
    });
    if (viewport.width < 769) await check('手机详情打开与返回保持焦点连续', async () => {
      await page.locator('[data-link-card]').click();
      await page.waitForFunction(() => document.activeElement?.classList.contains('links-detail-back'));
      await page.locator('.links-detail-back').click();
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-link-card'));
    });
    await page.screenshot({ path: path.join(output, `social-isolated-${viewport.width}.png`), fullPage: true });
    await context.close();
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
await fs.writeFile(path.join(output, 'social-isolated-results.json'), JSON.stringify({ records, failures, errors, writes,
  scope: '当前源码及模板的隔离浏览器；API 为本地模拟；没有访问或写入 Halo 和外站' }, null, 2));
console.log(`Social UI polish: ${records.length} passed, ${failures.length} failed, ${errors.length} browser errors`);
for (const failure of failures) console.error(`${failure.viewport} ${failure.label}: ${failure.message}`);
assert.equal(failures.length, 0, 'Social UI interactions');
assert.deepEqual(errors, [], 'No browser runtime errors');
