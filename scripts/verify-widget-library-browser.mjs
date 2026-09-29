import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

// Real served theme, public widget data, isolated layout configuration writes.
// Never logs in, reads credentials into the browser, or forwards a site mutation.
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090';
const output = path.resolve(process.env.WIDGET_LIBRARY_OUTPUT || 'output/widget-library-repair');
await fs.mkdir(output, { recursive: true });
const report = {
  environment: await readLiveBuildContext(base), checks: [], pageErrors: [],
  dataRequests: [], fixtureWrites: [], blockedWrites: [], resourceResponses: [],
  boundary: 'Actual served theme and public data; desktop layout GET/PUT and edit capability (including catalogue choices read from public sources) use an isolated fixture. No real site writes.',
};
const home = await (await fetch(new URL('/', base))).text();
const protocol = JSON.parse(home.match(/<script\b[^>]*id="theme-desktop-widget-protocol"[^>]*>([\s\S]*?)<\/script>/)?.[1] || 'null');
assert.ok(protocol?.layoutVersion, 'Home must expose the current widget protocol');
// An authenticated editor gets these catalogue choices from SSR. Read the same
// public sources without logging in, then supply only that edit capability fixture.
const catalogueHtml = await (await fetch(new URL('/?widgetSource=halo.categories&widgetSource=plugin-docsme.quick', base))).text();
const catalogueSources = JSON.parse(catalogueHtml.match(/<script\b[^>]*id="theme-desktop-widget-protocol"[^>]*>([\s\S]*?)<\/script>/)?.[1] || 'null').sources;
const emptyLayout = JSON.stringify({ version: 3, layoutVersion: protocol.layoutVersion, instances: [], icons: [], hasFullIconDefs: true });
let config = { default_layout: { layout_json: emptyLayout }, desktop: { icons: {} }, unrelated: { keep: true } };
let failSave = false;
let failTags = true;
let failDouban = true;
let revision = 1;
const browser = await chromium.launch({ headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local = url.origin === new URL(base).origin;
    const method = request.method();
    if (local && /\/api\.console\.halo\.run\/v1alpha1\/themes\/[^/]+\/json-config$/.test(url.pathname)) {
      if (method === 'GET') return route.fulfill({ json: config, headers: { etag: `"fixture-${revision}"` } });
      if (method === 'PUT') {
        report.fixtureWrites.push({ failed: failSave, body: request.postDataJSON() });
        if (failSave) return route.fulfill({ status: 503, json: { title: 'Isolated save failure' } });
        config = request.postDataJSON(); revision++;
        return route.fulfill({ json: config, headers: { etag: `"fixture-${revision}"` } });
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      report.blockedWrites.push({ method, path: url.pathname });
      return route.abort();
    }
    if (local && (url.searchParams.has('widgetSource') || /\/api\.content\.halo\.run\/v1alpha1\/tags$/.test(url.pathname) || url.pathname === '/bangumis' || url.pathname.includes('/api.douban.moony.la/'))) {
      report.dataRequests.push(url.pathname + url.search);
    }
    if (local && ((failTags && /\/api\.content\.halo\.run\/v1alpha1\/tags$/.test(url.pathname))
      || (failDouban && url.pathname.includes('/api.douban.moony.la/')))) {
      return route.fulfill({ status: 503, json: { title: 'Isolated widget read failure' } });
    }
    if (local && request.isNavigationRequest() && request.resourceType() === 'document') {
      const response = await route.fetch({ headers: { ...request.headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } });
      let html = await response.text();
      report.navigationTemplate = { url: request.url(), previewMarker: html.includes('data-widget-preview-visible'), status: response.status() };
      await fs.writeFile(path.join(output, 'served-navigation.html'), html);
      html = html.replace(/(<script\b[^>]*id="theme-desktop-widget-protocol"[^>]*>)([\s\S]*?)(<\/script>)/, (_all, before, json, after) => {
        const value = JSON.parse(json);
        value.serverLayoutJson = config.default_layout.layout_json;
        value.editEnabled = true;
        value.sources.loaded = {};
        value.sources.randomTags = [];
        value.sources.categories = catalogueSources.categories;
        value.sources.docsmeAvailable = catalogueSources.docsmeAvailable;
        return before + JSON.stringify(value).replaceAll('<', '\\u003c') + after;
      });
      return route.fulfill({ response, body: html });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/persistence-conflict.js')) report.resourceResponses.push({ url: response.url(), status: response.status() });
  });
  const surface = () => page.evaluate(() => {
    const model = window.Alpine.$data(document.querySelector('.desktop-surface'));
    return { editing: model.isEditing, state: model.serverLayoutSaveState, message: model.serverLayoutSaveMessage,
      widgets: model.widgets.map(({ widget, key }) => ({ widget, key })), dirty: model.hasUnsavedDesktopChanges() };
  });
  const center = page.locator('.desktop-widget-center');
  const previews = center.locator('.desktop-widget-center-preview:visible');
  async function check(name, action) { await action(); report.checks.push(name); console.log(`通过：${name}`); }
  async function category(name) {
    await center.locator('.desktop-widget-center-nav').getByRole('button', { name, exact: true }).click();
    await previews.first().waitFor();
  }
  async function shot(name) { await center.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' }); }
  async function openLibrary() {
    await page.locator('.desktop-surface').dispatchEvent('contextmenu', { clientX: 850, clientY: 220, bubbles: true, cancelable: true });
    await page.getByRole('button', { name: '添加小组件', exact: true }).click();
    await center.waitFor({ state: 'visible' });
  }
  await page.goto(new URL(`/?_widget_check=${Date.now()}`, base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.Alpine?.$data(document.querySelector('.desktop-surface'))?.init);
  await check('库关闭时不加载标签、追番与豆瓣预览数据', async () => {
    assert.equal(report.dataRequests.length, 0);
  });
  await openLibrary();
  await check('随机标签首次添加前可读取真实标签，多尺寸复用同一请求', async () => {
    await category('随机标签');
    const retry = previews.getByRole('button', { name: '重试', exact: true }).first();
    await retry.waitFor();
    failTags = false;
    await retry.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.desktop-widget-center-preview')].some(n => n.getClientRects().length && n.querySelector('.wg-tag-focus-item, .wg-tag-wall')));
    assert.equal(report.dataRequests.filter(url => url.includes('/api.content.halo.run/v1alpha1/tags')).length, 2, '一次隔离失败后仅一次真实重试，多尺寸共用结果');
    assert.doesNotMatch(await previews.allTextContents().then(x => x.join(' ')), /无标签|当前没有可展示的标签/);
    await shot('random-tags-light');
  });
  await check('浅色添加按钮文字清晰且添加后立即处于未保存状态', async () => {
    const button = center.locator('.desktop-widget-center-item:visible .desktop-widget-center-item-action').first();
    report.lightButton = await button.evaluate(node => { const s = getComputedStyle(node); return { color: s.color, background: s.backgroundColor }; });
    assert.notEqual(report.lightButton.color, 'rgba(255, 255, 255, 0.92)');
    await button.click();
    const state = await surface();
    assert.ok(state.widgets.some(widget => widget.widget === 'halo.random_tags'));
    assert.equal(state.dirty, true);
    await openLibrary();
  });
  await check('追番库预览显示真实记录', async () => {
    await category('追番');
    await previews.locator('.wg-bangumis-open').first().waitFor();
    assert.doesNotMatch(await previews.allTextContents().then(x => x.join(' ')), /添加后加载追番数据/);
    await shot('bangumi-preview');
  });
  await check('豆瓣名称与真实预览一致，加载终态清除骨架', async () => {
    await category('豆瓣');
    await previews.locator('[data-douban-showcase][data-douban-showcase-mounted="true"]').first().waitFor();
    const retry = previews.getByRole('button', { name: '重试', exact: true }).first();
    await retry.waitFor();
    assert.equal(await previews.locator('[data-douban-poster].is-loading').count(), 0, '错误终态不能残留加载骨架');
    failDouban = false;
    await retry.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.desktop-widget-center-preview [data-douban-showcase]')].some(n => n.getClientRects().length && !n.querySelector('[data-douban-poster].is-loading') && n.querySelector('[data-douban-title]')?.textContent !== '豆瓣收藏'));
    report.doubanTitle = await previews.locator('[data-douban-title]').first().textContent();
    const poster = previews.locator('[data-douban-poster] img').first();
    await poster.waitFor();
    await poster.scrollIntoViewIfNeeded();
    // External poster availability is evidence separate from the theme data/render
    // contract; capture its bounded result without substituting a success image.
    report.doubanPosterWait = await page.waitForFunction(() => [...document.querySelectorAll('.desktop-widget-center-preview [data-douban-poster] img')].some(img => img.getClientRects().length && img.complete && img.naturalWidth > 0), null, { timeout: 8000 })
      .then(() => 'decoded', () => 'not-decoded-within-8s');
    report.doubanPoster = await poster.evaluate(img => ({ complete: img.complete, naturalWidth: img.naturalWidth, opacity: getComputedStyle(img).opacity }));
    await shot('douban-preview');
  });
  await check('其它数据组件在未保存布局中按需加载，区分数据与空态', async () => {
    report.catalog = [];
    for (const name of ['最新文章', '热门文章', '文章分类', '站点统计', '瞬间', '朋友圈', '文档', '图库', 'Steam']) {
      await category(name);
      await page.waitForFunction(() => {
        const bodies = [...document.querySelectorAll('.desktop-widget-center [data-widget-preview-visible="true"]')];
        return bodies.length > 0 && bodies.every(body => !body.querySelector('.desktop-widget-loading'));
      });
      const bodies = center.locator('[data-widget-preview-visible="true"]');
      assert.equal(await bodies.locator('[role="alert"]').count(), 0, `${name} 不应显示读取错误`);
      report.catalog.push({ name, visiblePreviews: await bodies.count(), text: (await bodies.allTextContents()).map(text => text.trim().slice(0, 250)) });
    }
  });
  await check('深色预览与390px手机配置边界正确', async () => {
    await category('随机标签');
    await page.getByRole('button', { name: '切换外观', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    // The header control is outside the library; its click dismisses that panel.
    await center.waitFor({ state: 'hidden' });
    await openLibrary();
    await category('随机标签');
    await page.waitForFunction(() => [...document.querySelectorAll('.desktop-widget-center-preview')].some(n => n.getClientRects().length && n.querySelector('.wg-tag-focus-item, .wg-tag-wall')));
    await shot('random-tags-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    report.mobileHidesDesktop = protocol.hideOnMobile === true;
    if (report.mobileHidesDesktop) {
      await center.waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(output, 'mobile-configured-hidden.png'), animations: 'disabled' });
    } else {
      const overflow = await center.evaluate(node => node.scrollWidth - node.clientWidth);
      assert.ok(overflow <= 2, `手机组件库横向溢出 ${overflow}px`);
      report.mobileGeometry = await page.evaluate(() => ({
        frameTop: document.querySelector('.desktop-widget-center-frame').getBoundingClientRect().top,
        menuBottom: document.querySelector('.menubar').getBoundingClientRect().bottom
      }));
      assert.ok(report.mobileGeometry.frameTop >= report.mobileGeometry.menuBottom, '手机组件库标题必须避开菜单栏');
      await shot('library-mobile');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await center.waitFor({ state: 'visible' });
  });
  await check('保存失败保留编辑内容，重试通过实际构建的冲突校验模块', async () => {
    const before = await surface();
    failSave = true;
    await center.locator('.desktop-widget-center-head-action--primary').click();
    await page.waitForFunction(() => window.Alpine.$data(document.querySelector('.desktop-surface')).serverLayoutSaveState === 'failed');
    const failed = await surface();
    assert.equal(failed.editing, true);
    assert.deepEqual(failed.widgets, before.widgets);
    assert.equal(failed.dirty, true);
    failSave = false;
    await center.locator('.desktop-widget-center-head-action--primary').click();
    await page.waitForFunction(() => !window.Alpine.$data(document.querySelector('.desktop-surface')).isEditing);
    assert.ok(JSON.parse(config.default_layout.layout_json).instances.some(widget => widget.widget === 'halo.random_tags'));
    assert.deepEqual(config.unrelated, { keep: true });
    assert.ok(report.resourceResponses.some(response => response.status === 200));
    assert.ok(report.resourceResponses.every(response => response.status === 200));
  });
  await check('页面无脚本异常，没有真实站点写入，验证构建未漂移', async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.blockedWrites, []);
    const current = await readLiveBuildContext(base);
    assert.equal(current.build.revision, report.environment.build.revision);
    assert.equal(current.sourceFingerprint, report.environment.sourceFingerprint);
  });
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  report.debug = await page?.evaluate(() => ({
    previews: [...document.querySelectorAll('.desktop-widget-center-item')].filter(n => n.getClientRects().length).map(n => ({
      visible: window.Alpine?.$data(n)?.previewVisible,
      body: n.querySelector('.desktop-widget-body')?.outerHTML.slice(0, 3000)
    })),
    sources: window.Alpine?.$data(document.querySelector('.desktop-surface'))?.sources,
    versions: window.Alpine?.$data(document.querySelector('.desktop-surface'))?.widgetRenderVersions
  })).catch(() => null);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.passed ? '通过' : '失败'}：${report.checks.length}项；${output}`);
}
