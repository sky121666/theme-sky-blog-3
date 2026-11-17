import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { verificationOutput } from './lib/verification-output.mjs';
import { collectBrowserRuntimeErrors, installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';

const base = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const origin = new URL(base).origin;
const widths = (process.env.UI_VERIFY_WIDTHS || '1440,1024,390,320').split(',').map(Number);
assert.ok(widths.length && widths.every(width => Number.isInteger(width) && width >= 320));
const dir = await verificationOutput('docsme-ux-live');
const report = { identity: await readLiveBuildContext(base), cases: [], geometry: [], runtime: [], scope: '8090 实际文档；仅浏览、项目本地筛选、目录及历史操作，不修改数据' };
const browser = await chromium.launch({ headless: true });
async function ready(page) {
  await page.waitForFunction(() => window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === 'docsme'
    && !document.documentElement.classList.contains('is-animating')
    && !document.querySelector('.docsme-app.is-pjax-loading')
    && !document.querySelector('[data-theme-startup-layer]') && !window.__THEME_STARTUP__?.active);
}
async function preserved(page) {
  assert.deepEqual(await page.evaluate(() => ({
    document: window.__uxDocument === document,
    dock: !window.__uxDock || window.__uxDock === document.querySelector('.dock-container'),
    widgets: window.__uxWidgets.every(node => node.isConnected)
  })), { document: true, dock: true, widgets: true });
}

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width >= 1024 ? 960 : 844 }, reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    const blockedWrites = [];
    await installReadOnlyGuard(context, blockedWrites);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const runtime = collectBrowserRuntimeErrors(page);
    let documentUrl;
    const check = async (name, fn) => {
      try { await fn(); report.cases.push({ width, name, status: 'PASS' }); }
      catch (error) {
        report.cases.push({ width, name, status: 'FAIL', message: error.message });
        await page.screenshot({ path: `${dir}/failure-${width}-${report.cases.length}.png` }).catch(() => {});
      }
    };

    await check('资料库侧栏、封面与列表、项目筛选和清除', async () => {
      const response = await page.goto(`${base}/docs`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await ready(page);
      await page.evaluate(() => {
        window.__uxDocument = document;
        window.__uxDock = document.querySelector('.dock-container');
        window.__uxWidgets = [...document.querySelectorAll('.desktop-widget-card')];
      });
      const root = page.locator('.docsme-app');
      const cards = root.locator('.docsme-project-card');
      const count = await cards.count();
      assert.ok(count > 0, 'This live suite requires at least one public document project');
      const sidebar = root.locator('.docsme-sidebar--library');
      const emblem = cards.first().locator('.docsme-project-icon');
      assert.ok(await emblem.isVisible(), 'The project has a visible badge before remote artwork arrives');
      assert.ok(await emblem.evaluate(el => {
        const img = el.querySelector('img');
        return (img && !img.hidden && img.naturalWidth > 0)
          || getComputedStyle(el.querySelector('.docsme-project-icon__fallback')).visibility === 'visible';
      }), 'Show the configured icon or the local book mark, never an empty slot');
      assert.equal(await sidebar.locator('.docsme-source-project').count(), count, 'Each source shortcut opens a real public project');
      assert.deepEqual(await sidebar.locator('.docsme-source-project').evaluateAll(links => links.map(a => a.href)),
        await cards.evaluateAll(links => links.map(a => a.href)));
      const sideTrigger = root.locator('[data-docsme-toggle-sidebar]');
      if (await sideTrigger.isVisible()) {
        assert.equal(await sidebar.evaluate(el => el.inert), true);
        await sideTrigger.click();
        assert.equal(await sidebar.getAttribute('role'), 'dialog');
        assert.equal(await root.locator('.docsme-main').evaluate(el => el.inert), true);
        await sidebar.locator('[data-docsme-close-sidebar]').click();
        assert.equal(await sidebar.evaluate(el => el.inert), true);
        assert.equal(await sideTrigger.evaluate(el => document.activeElement === el), true);
      } else {
        assert.ok((await sidebar.boundingBox()).width >= 200);
        assert.equal(await sidebar.evaluate(el => el.inert), false);
      }
      const geometry = await root.evaluate(el => {
        const header = el.querySelector('.docsme-toolbar').getBoundingClientRect();
        const card = el.querySelector('.docsme-project-card').getBoundingClientRect();
        const input = el.querySelector('[data-docsme-project-filter]').getBoundingClientRect();
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth,
          header: { top: header.top, bottom: header.bottom }, card: { top: card.top, right: card.right },
          filter: { width: input.width, right: input.right } };
      });
      assert.ok(geometry.pageWidth <= width + 1, 'Index must not overflow horizontally');
      assert.ok(geometry.card.top - geometry.header.bottom < 64, 'Projects are immediately below the toolbar, including mobile');
      assert.ok(geometry.filter.width >= 80 && geometry.filter.right <= width + 1, 'Filter remains usable at narrow widths');
      report.geometry.push({ phase: 'projects', ...geometry });
      const filter = root.locator('[data-docsme-project-filter]');
      const projectRequests = [];
      const onRequest = request => { if (new URL(request.url()).pathname.startsWith('/docs')) projectRequests.push(request.url()); };
      page.on('request', onRequest);
      try {
        await filter.fill('__no_matching_project_ux__');
        assert.equal(await root.locator('.docsme-project-card:visible').count(), 0);
        await root.locator('[data-docsme-filter-empty]').waitFor({ state: 'visible' });
        const clear = root.locator('[data-docsme-filter-clear]');
        assert.equal((await root.locator('[data-docsme-library-status]').innerText()).trim(), `显示 0 / ${count} 个项目`);
        const rect = await clear.boundingBox();
        assert.equal(await clear.getAttribute('aria-label'), '清除筛选');
        assert.ok(rect.width >= (width <= 768 ? 44 : 24) && rect.height >= (width <= 768 ? 40 : 24), 'Inline clear has a usable target');
        await clear.click();
        assert.equal(await filter.inputValue(), '');
        assert.equal(await filter.evaluate(el => el === document.activeElement), true);
        assert.equal(await root.locator('.docsme-project-card:visible').count(), count);
        await root.getByRole('button', { name: '列表视图' }).click();
        assert.equal(await root.getAttribute('data-library-view'), 'list');
        assert.equal(await root.getByRole('button', { name: '列表视图' }).getAttribute('aria-pressed'), 'true');
        assert.ok((await cards.first().boundingBox()).height < 120, 'Rows use a different presentation of the same projects');
        await root.screenshot({ path: `${dir}/list-${width}.png` });
        await root.getByRole('button', { name: '封面视图' }).click();
        assert.equal(await root.getAttribute('data-library-view'), 'covers');
        assert.ok((await cards.first().locator('.docsme-volume').boundingBox()).height > 70);
        await preserved(page);
        const title = (await cards.first().locator('strong').innerText()).trim();
        await filter.fill(title);
        assert.ok(await cards.first().isVisible());
        await filter.press('Escape');
        assert.equal(await filter.inputValue(), '');
        assert.equal(await root.locator('.docsme-project-card:visible').count(), count);
        assert.deepEqual(projectRequests, [], 'Local project filtering does not fetch or navigate');
      } finally { page.off('request', onRequest); }
      const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      for (const dark of [false, true]) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        await root.screenshot({ path: `${dir}/projects-${width}-${dark ? 'dark' : 'light'}.png` });
      }
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), wasDark);
    });

    await check('从资料库侧栏进入项目、后退保留列表选择', async () => {
      const root = page.locator('.docsme-app');
      const source = root.locator('.docsme-source-project').first();
      const url = await source.getAttribute('href');
      const list = root.getByRole('button', { name: '列表视图' });
      await list.focus();
      await list.press('Enter');
      assert.equal(await list.getAttribute('aria-pressed'), 'true');
      const sideTrigger = root.locator('[data-docsme-toggle-sidebar]');
      if (await sideTrigger.isVisible()) await sideTrigger.click();
      await source.click();
      await page.waitForURL(new URL(url, base).href); await ready(page);
      assert.equal(await page.locator('.docsme-article').count(), 1);
      await preserved(page);
      await page.goBack(); await page.waitForURL(new URL('/docs', base).href); await ready(page);
      assert.equal(await root.getAttribute('data-library-view'), 'list');
      assert.equal(await list.getAttribute('aria-pressed'), 'true');
      await preserved(page);
    });

    await check('进入正文保留桌面、阅读空间与浅深色', async () => {
      const project = page.locator('.docsme-project-card:visible').first();
      const href = await project.getAttribute('href');
      await project.click();
      await page.waitForURL(new URL(href, base).href);
      await ready(page);
      documentUrl = page.url();
      await preserved(page);
      const article = page.locator('.docsme-article');
      await article.waitFor({ state: 'visible' });
      const geometry = await article.evaluate(el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        const title = el.closest('.docsme-app').querySelector('.docsme-sidebar-head h2');
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth,
          articleWidth: rect.width, padding: style.paddingLeft, border: style.borderLeftWidth,
          sidebarTitleSize: title ? getComputedStyle(title).fontSize : null };
      });
      assert.ok(geometry.pageWidth <= width + 1);
      assert.equal(await article.evaluate(el => Boolean(el.closest('.docsme-reading-sheet')?.querySelector('.docsme-doc-head'))), true, 'Heading and body share one reading sheet');
      assert.equal(geometry.padding, '0px', 'Do not double-inset the article inside the paper');
      assert.equal(geometry.sidebarTitleSize, '14px', 'Project identity does not overwhelm the document tree');
      assert.ok(geometry.articleWidth >= (width <= 390 ? width - 50 : 480), 'Document retains useful reading width');
      report.geometry.push({ phase: 'reading', ...geometry });
      const originalDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      for (const dark of [false, true]) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        assert.equal(await page.locator('.docsme-main').evaluate(el => getComputedStyle(el).backgroundColor), dark ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)');
        await page.locator('.docsme-app').screenshot({ path: `${dir}/reading-${width}-${dark ? 'dark' : 'light'}.png` });
      }
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), originalDark);
    });

    await check('本页目录键盘进入、Esc 返回、锚点定位', async () => {
      const trigger = page.locator('.docsme-toolbar [data-docsme-toggle-toc]');
      const toc = page.locator('[data-docsme-toc]');
      const floating = await page.locator('.docsme-app').evaluate(el => !el.classList.contains('is-toc-pinned'));
      assert.ok(await toc.locator('a').count() > 1, 'The selected real document requires multiple headings');
      if (floating) {
        await trigger.click();
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        assert.equal(await toc.evaluate(el => el.contains(document.activeElement)), true);
        if (await page.locator('.docsme-app').evaluate(el => el.clientWidth <= 768)) {
          assert.equal(await toc.getAttribute('role'), 'dialog');
          assert.equal(await toc.getAttribute('aria-modal'), 'true');
          assert.equal(await page.locator('.docsme-main').evaluate(el => el.inert), true);
          assert.equal(await page.locator('.docsme-sidebar').evaluate(el => el.inert), true);
          const close = toc.locator('[data-docsme-toggle-toc]');
          const closeBox = await close.boundingBox();
          assert.ok(closeBox.width >= 44 && closeBox.height >= 44);
          await close.focus();
          await page.keyboard.press('Shift+Tab');
          assert.equal(await toc.locator('a').last().evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Tab');
          assert.equal(await close.evaluate(el => el === document.activeElement), true);
          await page.locator('.docsme-app').screenshot({ path: `${dir}/toc-modal-${width}.png` });
        }
        await page.keyboard.press('Escape');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('.docsme-main').evaluate(el => el.inert), false);
        await trigger.click();
      }
      const anchor = toc.locator('a').nth(1), hash = await anchor.getAttribute('href');
      const before = await page.evaluate(() => ({ length: history.length, outerScroll: scrollY }));
      await anchor.click();
      await page.waitForFunction(hash => {
        const heading = document.getElementById(decodeURIComponent(hash.slice(1)));
        const bar = document.querySelector('.docsme-main > .docsme-toolbar');
        if (!heading || !bar) return false;
        const gap = heading.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
        return decodeURIComponent(location.hash) === decodeURIComponent(hash) && gap >= 0 && gap <= 24;
      }, hash);
      assert.deepEqual(await page.evaluate(() => ({ length: history.length, outerScroll: scrollY })), before, 'TOC does not add history entries or scroll the desktop');
      assert.equal(await toc.evaluate(el => el.inert), floating);
      await preserved(page);
    });

    await check('本页目录固定、关闭、Swup 切换与历史返回', async () => {
      const root = page.locator('.docsme-app');
      const trigger = root.locator('.docsme-toolbar [data-docsme-toggle-toc]');
      const toc = root.locator('[data-docsme-toc]');
      const pin = toc.locator('[data-docsme-pin-toc]');
      if (await toc.evaluate(el => el.inert)) await trigger.click();
      if (await root.evaluate(el => el.clientWidth < 1080)) {
        assert.equal(await pin.isVisible(), false);
        const close = toc.locator('[data-docsme-toggle-toc]');
        const rect = await close.boundingBox();
        const minimum = width <= 768 ? 44 : 28;
        assert.ok(rect.width >= minimum && rect.height >= minimum);
        await close.click();
        assert.equal(await toc.evaluate(el => el.inert), true);
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
        return;
      }
      if (await pin.getAttribute('aria-pressed') !== 'true') await pin.click();
      assert.equal(await pin.getAttribute('aria-pressed'), 'true');
      const geometry = await root.evaluate(el => {
        const toc = el.querySelector('[data-docsme-toc]').getBoundingClientRect();
        const main = el.querySelector('.docsme-main').getBoundingClientRect();
        return { tocLeft: toc.left, mainRight: main.right, appWidth: el.clientWidth, pageWidth: document.documentElement.scrollWidth };
      });
      assert.ok(geometry.tocLeft >= geometry.mainRight - 1, 'Pinning reserves an independent column');
      assert.ok(geometry.pageWidth <= width + 1);
      await toc.locator('a').first().click();
      assert.equal(await toc.evaluate(el => el.inert), false);
      await page.locator('.docsme-article p').first().click();
      assert.equal(await toc.evaluate(el => el.inert), false);
      await root.screenshot({ path: `${dir}/toc-pinned-${width}.png` });
      const before = page.url();
      const next = root.locator('.docsme-tree a[href$="/test"]').first();
      const href = await next.getAttribute('href');
      await next.click(); await page.waitForURL(new URL(href, base).href); await ready(page);
      assert.equal(await root.evaluate(el => el.classList.contains('is-toc-pinned')), true);
      await page.goBack(); await page.waitForURL(before); await ready(page);
      assert.equal(await pin.getAttribute('aria-pressed'), 'true');
      assert.equal(await toc.evaluate(el => el.inert), false);
      await preserved(page);
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.querySelector('.docsme-app').clientWidth < 1080
        && !document.querySelector('.docsme-app').classList.contains('is-toc-pinned'));
      assert.equal(await toc.evaluate(el => el.inert), true);
      await trigger.click();
      assert.equal(await pin.isVisible(), false);
      await toc.locator('[data-docsme-toggle-toc]').click();
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => document.querySelector('.docsme-app').classList.contains('is-toc-pinned'));
      assert.equal(await toc.evaluate(el => el.inert), false, 'Closing the mobile popover does not clear the desktop pin preference');
      const headTop = await toc.locator('.docsme-toc__head').evaluate(el => el.getBoundingClientRect().top);
      await toc.locator('a').nth(2).click();
      await page.waitForFunction(() => document.querySelector('.docsme-main').scrollTop > 200);
      assert.equal(await toc.locator('.docsme-toc__head').evaluate(el => el.getBoundingClientRect().top), headTop);
      await root.screenshot({ path: `${dir}/toc-pinned-scrolled-${width}.png` });
      await toc.locator('[data-docsme-toggle-toc]').click();
      assert.equal(await toc.evaluate(el => el.inert), true);
      await trigger.click();
      assert.equal(await pin.getAttribute('aria-pressed'), 'true');
      await pin.click();
      assert.equal(await pin.getAttribute('aria-pressed'), 'false');
      assert.equal(await toc.evaluate(el => el.inert), false);
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
      assert.equal(await toc.evaluate(el => el.inert), true);
    });

    await check('文档树、目录页、子文档与历史返回', async () => {
      const sideTrigger = page.locator('[data-docsme-toggle-sidebar]');
      if (await sideTrigger.isVisible()) {
        await sideTrigger.click();
        assert.equal(await page.locator('.docsme-main').evaluate(el => el.inert), true);
        await page.keyboard.press('Escape');
        assert.equal(await sideTrigger.evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('.docsme-main').evaluate(el => el.inert), false);
        await sideTrigger.click();
      }
      const collapse = page.locator('[data-docsme-tree-collapse-all]');
      await collapse.click();
      const expanded = await collapse.getAttribute('aria-expanded');
      await collapse.click();
      assert.notEqual(await collapse.getAttribute('aria-expanded'), expanded);
      const catalog = page.locator('.docsme-tree a[href$="/theme-settings"]').first();
      assert.equal(await catalog.count(), 1, 'Public project must expose the theme-settings catalog sample');
      await catalog.click();
      await page.waitForURL(url => url.pathname.endsWith('/theme-settings'));
      await ready(page);
      const child = page.locator('.docsme-catalog-card').first(), catalogUrl = page.url();
      assert.ok(await page.locator('.docsme-catalog-head .docsme-folder-art').isVisible());
      assert.equal(await page.locator('[data-docsme-toggle-toc]').count(), 0, 'A folder has no article headings to inspect');
      await page.locator('.docsme-app').screenshot({ path: `${dir}/catalog-${width}.png` });
      const target = await child.getAttribute('href');
      await child.click();
      await page.waitForURL(new URL(target, base).href); await ready(page);
      assert.equal(await page.locator('.docsme-article').count(), 1);
      await page.goBack(); await page.waitForURL(catalogUrl); await ready(page);
      assert.ok(await page.locator('.docsme-catalog-card').count() > 0);
      await preserved(page);
    });

    if (width === 1440) await check('刷新首帧遵循固定偏好、应用脚本延迟时正文仍可见', async () => {
      // Use the actual head/template and CSS while withholding the app runtime.
      // This detects pre-paint layout mistakes that a ready-only screenshot hides.
      assert.ok(documentUrl);
      await page.goto(documentUrl, { waitUntil: 'domcontentloaded' });
      await ready(page);
      const route = '**/assets/js/apps/docsme/index.js*';
      for (const pinned of [false, true]) {
        await page.evaluate(value => sessionStorage.setItem('docsme-toc-pinned', String(value)), pinned);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route(route, async request => { await gate; await request.continue(); });
        let initial;
        try {
          await page.reload({ waitUntil: 'commit' });
          await page.waitForFunction(() => {
            const article = document.querySelector('.docsme-article');
            return article && getComputedStyle(document.querySelector('.docsme-shell')).display === 'grid'
              && article.getBoundingClientRect().width > 0;
          });
          initial = await page.evaluate(() => ({
            articleWidth: document.querySelector('.docsme-article').getBoundingClientRect().width,
            tocVisible: document.querySelector('[data-docsme-toc]').getBoundingClientRect().width > 0,
            runtimeReady: Boolean(document.querySelector('[data-docsme-toggle-toc][data-docsme-toc-toggle-bound]')),
            preference: document.documentElement.dataset.docsmeTocPinned
          }));
          assert.equal(initial.runtimeReady, false, 'This sample must be taken before TOC initialization');
          assert.equal(initial.preference, String(pinned));
          assert.equal(initial.tocVisible, pinned);
          assert.ok(initial.articleWidth >= 480);
          await page.locator('.docsme-app').screenshot({ path: `${dir}/first-frame-${pinned ? 'pinned' : 'floating'}.png` });
        } finally {
          release();
          await page.unrouteAll({ behavior: 'wait' });
        }
        await ready(page);
        await page.waitForFunction(() => document.querySelector('[data-docsme-toggle-toc][data-docsme-toc-toggle-bound]'));
        const finalWidth = await page.locator('.docsme-article').evaluate(el => el.getBoundingClientRect().width);
        assert.ok(Math.abs(finalWidth - initial.articleWidth) <= 1, 'Runtime initialization must not move the article column');
        report.geometry.push({ phase: 'refresh-before-runtime', pinned, ...initial, finalWidth });
      }
    });

    const snapshot = runtime.snapshot();
    const external = value => value.url && new URL(value.url).origin !== origin && ['image', 'media', 'font'].includes(value.resourceType);
    const externalMedia = [...snapshot.requestFailures, ...snapshot.responseErrors].filter(external);
    const externalUrls = new Set(externalMedia.map(value => value.url));
    const cancelledReads = snapshot.requestFailures.filter(value => value.method === 'GET' && value.errorText === 'net::ERR_ABORTED');
    const failures = [...snapshot.pageErrors, ...snapshot.consoleErrors.filter(value => !externalUrls.has(value.url)),
      ...snapshot.requestFailures.filter(value => !external(value) && !cancelledReads.includes(value)),
      ...snapshot.responseErrors.filter(value => !external(value)), ...blockedWrites];
    report.runtime.push({ width, ...snapshot, failures, externalMedia, cancelledReads, blockedWrites });
    runtime.stop(); await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ report: `${dir}/report.json`, build: report.identity.build,
  cases: report.cases, runtime: report.runtime.map(({ width, failures, externalMedia }) => ({ width, failures, externalMedia })) }, null, 2));
if (report.cases.some(entry => entry.status !== 'PASS') || report.runtime.some(entry => entry.failures.length)) process.exitCode = 1;
