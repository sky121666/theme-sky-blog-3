import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Isolated real-DOM checks: no Halo instance, requests, or generated assets.
async function bundle(relativePath, expose) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = await readFile(filename, 'utf8');
  const result = await build({
    stdin: { contents: `${source}\n${expose}`, resolveDir: path.dirname(filename), loader: 'js' },
    bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent'
  });
  return result.outputFiles[0].text;
}

const [readerScript, docsmeScript, readerCss, docsmeCss, browserTemplate] = await Promise.all([
  bundle('../src/apps/reader/runtime/post-outline.js', 'window.readingTest = { initPostOutline, cleanupPostOutline };'),
  bundle('../src/apps/docsme/runtime.js', 'window.docsmeTest = { bindMobileSidebar, bindTocToggles, renderToc, disposeDocsmeEnhancements };'),
  readFile(new URL('../src/apps/reader/styles/post.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/apps/docsme/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../templates/modules/shell/browser-window.html', import.meta.url), 'utf8')
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.route('http://reading-ui.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
await page.goto('http://reading-ui.test/article');

try {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion });
    const sheetMarkup = browserTemplate.slice(browserTemplate.indexOf('<div class="post-outline-mobile-backdrop"'), browserTemplate.indexOf('<div class="window-body'));
    await page.setContent(`<!doctype html><html><head><style>${readerCss}
      * { box-sizing: border-box; } body { margin: 0; } [hidden] { display: none !important; }
      .macos-window { position: relative; width: 760px; height: 700px; overflow: hidden; }
      .window-body { height: 620px; overflow: auto; } .post-reader-shell { padding-top: 20px; }
      .post-reader-frame { width: 100%; } .post-outline-trigger { display: none; }
    </style></head><body data-page-app="reader"><div class="macos-window" data-window-narrow="true">
      <header><button class="post-outline-trigger" data-post-outline-trigger>目录</button></header>
      ${sheetMarkup}
      <div class="window-body"><div class="post-reader-shell"><div class="post-reader-frame">
        <div class="post-body-layout"><article class="post-main-column" id="article-content">
          <a id="article-link" href="#second">正文链接</a><h2 id="first">第一节</h2><p>正文</p>
          <div style="height: 800px"></div><h2 id="second">第二节</h2><p>正文</p>
        </article><aside class="post-outline" data-post-outline><nav data-post-outline-list></nav></aside></div>
      </div></div></div>
    </div><halo-contact-form-floating><input value="未提交的草稿"></halo-contact-form-floating></body></html>`);
    await page.addScriptTag({ content: readerScript });
    await page.evaluate(() => window.readingTest.initPostOutline());
    const readerLayout = await page.evaluate(() => ({
      columnWidth: document.querySelector('.post-main-column').getBoundingClientRect().width,
      layoutWidth: document.querySelector('.post-body-layout').getBoundingClientRect().width,
      outlineDisplay: getComputedStyle(document.querySelector('.post-outline')).display
    }));
    assert.equal(readerLayout.outlineDisplay, 'none');
    assert.equal(readerLayout.columnWidth, readerLayout.layoutWidth, '760px window must not reserve the hidden 220px directory column');

    const trigger = page.locator('[data-post-outline-trigger]');
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-post-outline-mobile-handle]').evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator('.window-body').evaluate((node) => node.inert), true);
    assert.equal(await page.locator('halo-contact-form-floating').evaluate((node) => getComputedStyle(node).display), 'none', 'Floating plugin does not cover the open directory');
    const handleBox = await page.locator('[data-post-outline-mobile-handle]').boundingBox();
    assert.ok(handleBox.width >= 44 && handleBox.height >= 44, 'directory handle needs a usable touch target');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('[data-post-outline-mobile-list] button').last().evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-post-outline-mobile-handle]').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.window-body').evaluate((node) => node.inert), false);
    assert.equal(await page.locator('[data-post-outline-mobile-sheet]').isVisible(), false);
    assert.equal(await page.locator('halo-contact-form-floating').isVisible(), true, 'Floating form returns after directory closes');
    assert.equal(await page.locator('halo-contact-form-floating input').inputValue(), '未提交的草稿', 'Hiding does not remount or clear plugin state');

    // A close in the opening frame must revoke the pending animation and isolation.
    await page.evaluate(() => {
      document.querySelector('[data-post-outline-trigger]').click();
      document.querySelector('[data-post-outline-mobile-handle]').click();
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-post-outline-mobile-sheet]').evaluate((node) => node.hidden && !node.hasAttribute('data-open')), true, 'same-frame close must not be reopened by a stale RAF');
    assert.equal(await page.locator('.window-body').evaluate((node) => node.inert), false);

    await trigger.click();
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'search-modal';
      host.setAttribute('role', 'dialog');
      host.style.cssText = 'position:fixed;right:0;top:0;z-index:9999';
      host.attachShadow({ mode: 'open' }).innerHTML = '<input id="search-input"><button id="search-action">搜索</button>';
      document.body.append(host);
      host.shadowRoot.querySelector('input').focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#search-action').evaluate((node) => node.getRootNode().activeElement === node), true, 'an outer search keeps Tab ownership while the reader directory is open');
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'an outer search Escape must not close the underlying directory');
    assert.equal(await page.locator('#search-action').evaluate((node) => node.getRootNode().activeElement === node), true);
    await page.evaluate(() => document.querySelector('.macos-window').removeAttribute('data-window-narrow'));
    await page.waitForFunction(() => document.querySelector('[data-post-outline-mobile-sheet]').hidden);
    assert.equal(await page.locator('#search-action').evaluate((node) => node.getRootNode().activeElement === node), true, 'responsive cleanup must not take focus back from an outer overlay');
    await page.evaluate(() => {
      document.querySelector('#search-modal').remove();
      document.querySelector('.macos-window').dataset.windowNarrow = 'true';
    });
    const durations = await page.locator('.post-outline-mobile-sheet, .post-outline-mobile-backdrop').evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(getComputedStyle(node).transitionDuration)));
    assert.ok(durations.every((value) => reducedMotion === 'reduce' ? value === 0 : value > 0), 'reader transitions follow the motion preference');

    await trigger.click();
    await page.locator('[data-post-outline-mobile-list] button').last().click();
    assert.equal(await page.locator('#second').evaluate((node) => node === document.activeElement), true, 'selecting a section moves focus into the article');
    assert.equal(new URL(page.url()).hash, '#second');
    assert.equal(await page.locator('[data-post-outline-mobile-sheet]').isVisible(), false);
    await trigger.click();
    await page.evaluate(() => { document.querySelector('.macos-window').removeAttribute('data-window-narrow'); });
    await page.waitForFunction(() => document.querySelector('[data-post-outline-mobile-sheet]').hidden);
    assert.equal(await page.locator('.window-body').evaluate((node) => node.inert), false);
    assert.equal(await page.locator('.post-reader-frame').evaluate((node) => node === document.activeElement), true, 'widening restores focus to visible reading content');
    await page.evaluate(() => {
      document.querySelector('.macos-window').dataset.windowNarrow = 'true';
      document.querySelector('.window-body').inert = true;
    });
    await trigger.click();
    await page.evaluate(() => window.readingTest.cleanupPostOutline());
    assert.equal(await page.locator('.window-body').evaluate((node) => node.inert), true, 'cleanup preserves an existing inert state');
    assert.equal(await page.locator('header').evaluate((node) => node.inert), false, 'cleanup releases only owned isolation');

    await page.setContent(`<!doctype html><html><head><style>${docsmeCss}
      * { box-sizing: border-box; } body { margin: 0; }
      .docsme-window-content { width: 1200px; height: 700px; }
    </style></head><body>
      <div class="docsme-window"><div class="docsme-window-content"><div class="docsme-app docsme-app--document">
        <div class="docsme-shell docsme-shell--reading">
          <aside class="docsme-sidebar"><nav class="docsme-tree">
            <a href="#one" id="doc-one">第一篇</a><a href="#two" id="doc-two">第二篇</a>
          </nav></aside>
          <main class="docsme-main"><header class="docsme-toolbar"><div class="docsme-toolbar-actions">
            <button class="docsme-toc-reveal" data-docsme-toggle-toc>本页目录</button>
            <button class="docsme-icon-button" data-docsme-toggle-sidebar>文档目录</button>
          </div></header><article class="docsme-content" data-toc-content><a href="#body" id="doc-body-link">正文链接</a><h2 id="doc-first">第一节</h2><div style="height:800px"></div><h3 id="doc-second">第二节</h3></article></main>
          <aside class="docsme-toc" data-docsme-toc><button class="docsme-toc__collapse" data-docsme-toggle-toc>收起本页目录</button><nav data-docsme-toc-list></nav></aside>
        </div>
      </div></div></div>
    </body></html>`);
    await page.addScriptTag({ content: docsmeScript });
    await page.evaluate(() => {
      const app = document.querySelector('.docsme-app');
      window.docsmeTest.bindMobileSidebar(app);
      window.docsmeTest.bindTocToggles(app);
      window.docsmeTest.renderToc(app);
    });
    const resizeDocs = async (width) => {
      await page.locator('.docsme-window-content').evaluate((node, value) => { node.style.width = `${value}px`; }, width);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    assert.equal(await page.locator('[data-docsme-toc]').evaluate((node) => node.inert), false);
    await page.locator('#doc-two').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#doc-body-link').evaluate((node) => node === document.activeElement), true, 'desktop parallel navigation must not trap focus');
    await page.locator('[data-docsme-toc-list] a').first().focus();
    await resizeDocs(960);
    assert.equal(await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').evaluate((node) => node === document.activeElement), true, 'narrowing a focused desktop TOC returns focus to its visible reveal button');
    assert.equal(await page.locator('[data-docsme-toc]').evaluate((node) => node.inert), true);
    assert.equal(await page.locator('[data-docsme-toc]').isVisible(), false);
    const columns = await page.locator('.docsme-shell').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 2, '960px window collapses the TOC while viewport remains 1440px');
    await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').click();
    assert.equal(await page.locator('[data-docsme-toc]').isVisible(), true);
    await page.locator('[data-docsme-toc] [data-docsme-toggle-toc]').click();
    assert.equal(await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').evaluate((node) => node === document.activeElement), true, 'collapsing from inside the directory returns focus to the reveal button');
    await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').click();
    await page.locator('[data-docsme-toc-list] a').last().click();
    assert.equal(await page.locator('#doc-second').evaluate((node) => node === document.activeElement), true, 'a compact TOC selection focuses the destination heading');
    assert.equal(new URL(page.url()).hash, '#doc-second');
    assert.equal(await page.locator('[data-docsme-toc]').evaluate((node) => node.inert), true);
    await page.locator('#doc-body-link').focus();
    assert.equal(await page.locator('#doc-second').getAttribute('tabindex'), null, 'temporary heading focusability is released after leaving the heading');
    await resizeDocs(1200);
    await page.locator('[data-docsme-toc] [data-docsme-toggle-toc]').click();
    assert.equal(await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').evaluate((node) => node === document.activeElement), true, 'desktop collapse also returns focus outside the inert TOC');
    await page.locator('.docsme-toolbar [data-docsme-toggle-toc]').click();
    await resizeDocs(700);
    const sidebarDuration = await page.locator('.docsme-sidebar').evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
    assert.ok(reducedMotion === 'reduce' ? sidebarDuration === 0 : sidebarDuration > 0, 'compact Docsme sidebar follows the motion preference');
    for (const dark of [false, true]) {
      await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark);
      const color = await page.locator('.docsme-main').evaluate((node) => getComputedStyle(node).backgroundColor);
      assert.equal(color, dark ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)', 'document content keeps an opaque light/dark background');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    const sidebar = page.locator('.docsme-sidebar');
    const sidebarTrigger = page.locator('[data-docsme-toggle-sidebar]');
    assert.equal(await sidebar.evaluate((node) => node.inert), true);
    await sidebarTrigger.click();
    assert.equal(await sidebarTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await sidebar.getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#doc-one').evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator('.docsme-main').evaluate((node) => node.inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#doc-two').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#doc-one').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await sidebarTrigger.evaluate((node) => node === document.activeElement), true);
    assert.equal(await sidebar.evaluate((node) => node.inert), true);
    assert.equal(await page.locator('.docsme-main').evaluate((node) => node.inert), false);
    await sidebarTrigger.click();
    await resizeDocs(1200);
    assert.equal(await sidebar.getAttribute('role'), null);
    assert.equal(await sidebar.evaluate((node) => node.inert), false);
    assert.equal(await page.locator('.docsme-main').evaluate((node) => node.inert), false);
    await page.locator('#doc-two').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#doc-body-link').evaluate((node) => node === document.activeElement), true);
    await resizeDocs(700);
    await sidebarTrigger.click();
    await page.evaluate(() => window.docsmeTest.disposeDocsmeEnhancements(document.querySelector('.docsme-app')));
    assert.equal(await page.locator('.docsme-main').evaluate((node) => node.inert), false);
    assert.equal(await page.locator('.docsme-app').evaluate((node) => node._docsmeLayoutCleanup), null);
    await page.evaluate(() => {
      const app = document.querySelector('.docsme-app');
      for (let index = 0; index < 2; index++) {
        window.docsmeTest.bindMobileSidebar(app);
        window.docsmeTest.bindTocToggles(app);
      }
    });
    await sidebarTrigger.click();
    assert.equal(await sidebarTrigger.getAttribute('aria-expanded'), 'true', 'rehydration does not duplicate toggle listeners');
    await page.keyboard.press('Escape');
    assert.equal(await sidebarTrigger.evaluate((node) => node === document.activeElement), true);
    await resizeDocs(1200);
    assert.equal(await sidebar.evaluate((node) => node.inert), false, 'rehydration restores the resize observer');
    await resizeDocs(390);
    assert.equal(await sidebar.evaluate((node) => node.inert), true);
    await sidebarTrigger.click();
    await page.mouse.click(375, 400);
    assert.equal(await sidebar.evaluate((node) => node.inert), true, 'touch-sized outside area closes the drawer');
    assert.equal(await sidebarTrigger.evaluate((node) => node === document.activeElement), true);
    await page.evaluate(() => {
      const app = document.querySelector('.docsme-app');
      window.docsmeTest.disposeDocsmeEnhancements(app);
      app.classList.replace('docsme-app--document', 'docsme-app--projects');
      window.docsmeTest.bindMobileSidebar(app);
      window.docsmeTest.bindTocToggles(app);
    });
    assert.equal(await sidebar.evaluate((node) => node.inert), false, 'project index navigation remains visible and interactive on mobile');
  }
  assert.deepEqual(pageErrors, []);
  console.log('Reading navigation passed in normal/reduced motion: same-frame close, outer-search focus ownership, sheet keyboard/focus, heading focus, responsive inert cleanup, Docsme container transitions and opaque light/dark content.');
} finally {
  await browser.close();
}
