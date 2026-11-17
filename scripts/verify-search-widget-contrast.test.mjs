import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';
import { build } from 'esbuild';

// Read the installed plugin, then run it with current theme source in an
// isolated document. No built assets, real search requests or server writes.
const baseUrl = process.env.HALO_BASE_URL || 'http://localhost:8090';
const sourceUrl = new URL('../src/shared/search-widget-runtime.js', import.meta.url);

function luminance(rgb) {
  const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255);
  return channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('真实 SearchWidget 的深浅强调色选中态与非选中行保持可读', async (t) => {
  const homeResponse = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) });
  assert.ok(homeResponse.ok, `Local Halo is required: ${homeResponse.status}`);
  const html = await homeResponse.text();
  const scriptPath = html.match(/<script\b[^>]*\bsrc=["']([^"']*\/plugins\/PluginSearchWidget\/assets\/static\/search-widget\.iife\.js[^"']*)["']/i)?.[1];
  assert.ok(scriptPath, 'Local Halo must expose its installed SearchWidget script');
  const pluginUrl = new URL(scriptPath, baseUrl);
  const pluginResponse = await fetch(pluginUrl, { signal: AbortSignal.timeout(15000) });
  assert.ok(pluginResponse.ok, `SearchWidget script is readable: ${pluginResponse.status}`);
  const plugin = await pluginResponse.text();
  const source = await readFile(sourceUrl, 'utf8');
  const readerBundle = await build({
    entryPoints: [new URL('../src/apps/reader/runtime/post-outline.js', import.meta.url).pathname],
    bundle: true, write: false, format: 'iife', globalName: 'ReaderOutline', logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true });
  t.diagnostic(`Installed plugin: ${pluginUrl.href}`);
  try {
    for (const palette of [
      { name: '深蓝强调色', accent: '#2e5fbd', accentRgb: 'rgb(46, 95, 189)', foreground: '#ffffff', rgb: 'rgb(255, 255, 255)' },
      { name: '浅金强调色', accent: '#f5c242', accentRgb: 'rgb(245, 194, 66)', foreground: '#17181a', rgb: 'rgb(23, 24, 26)' },
    ]) {
      await t.test(palette.name, async () => {
        const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce' });
        const errors = [], unexpected = [];
        try {
          await context.route('**/*', async route => {
            if (route.request().url() !== 'https://search-contrast.test/') {
              unexpected.push(route.request().url());
              return route.abort();
            }
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body style="
              --halo-search-widget-primary-color:${palette.accent};
              --theme-accent-contrast:${palette.foreground};
              --halo-search-widget-divider-color:#dddddd;
              --halo-search-widget-muted-color:#6b7280;
              --halo-search-widget-content-color:#111827;
              --halo-search-widget-hit-bg-color:#eeeeee;
              --halo-search-widget-kbd-border-color:#dddddd;
            "><div class="macos-window" data-window-narrow="true">
              <header><button data-post-outline-trigger>文章目录</button></header>
              <div data-post-outline-mobile-backdrop hidden></div>
              <section data-post-outline-mobile-sheet hidden role="dialog" tabindex="-1">
                <button data-post-outline-mobile-handle>关闭文章目录</button>
                <nav data-post-outline-mobile-list></nav>
              </section>
              <div class="window-body"><div class="post-reader-frame">
                <article id="article-content"><h2 id="reader-section">文章章节</h2></article>
                <aside data-post-outline><nav data-post-outline-list></nav></aside>
              </div></div>
            </div><button id="outside-search">背景操作</button></body></html>` });
          });
          const page = await context.newPage();
          page.on('pageerror', error => errors.push(error.message));
          await page.goto('https://search-contrast.test/');
          await page.evaluate(() => localStorage.setItem('halo:search-widgets:history:hits', JSON.stringify([
            { id: 'first', title: '第一项 <mark>匹配</mark>', description: '第一项摘要', permalink: '/first' },
            { id: 'second', title: '第二项 <mark>匹配</mark>', description: '第二项摘要', permalink: '/second' },
          ])));
          await page.addScriptTag({ content: readerBundle.outputFiles[0].text });
          await page.evaluate(() => ReaderOutline.initPostOutline());
          await page.locator('[data-post-outline-trigger]').click();
          assert.equal(await page.locator('[data-post-outline-mobile-handle]').evaluate(node => node === document.activeElement), true);
          await page.addScriptTag({ content: plugin });
          await page.addScriptTag({ content: `${source.replace(/^export /gm, '')}\nwindow.openSearchWidget = openSearchWidget;` });
          await page.evaluate(() => window.openSearchWidget());
          await page.waitForFunction(() => document.querySelector('search-modal')?.shadowRoot
            .querySelector('search-form')?.shadowRoot.getElementById('mac-search-form-style'));

          const readRows = () => {
            const root = document.querySelector('search-modal').shadowRoot.querySelector('search-form').shadowRoot;
            return [...root.querySelectorAll('li[data-index]')].map(row => ({
              background: getComputedStyle(row).backgroundColor,
              title: getComputedStyle(row.querySelector('h2')).color,
              description: getComputedStyle(row.querySelector('p')).color,
              icons: [...row.querySelectorAll(':scope > span')].map(icon => getComputedStyle(icon).color),
              mark: getComputedStyle(row.querySelector('mark')).color,
            }));
          };
          const verifySelected = row => {
            assert.equal(row.background, palette.accentRgb, 'Selected background retains the theme accent');
            for (const color of [row.title, row.description, row.mark, ...row.icons]) {
              assert.equal(color, palette.rgb, 'Every selected text/icon uses the existing contrast token');
              assert.ok(contrast(color, row.background) >= 4.5, `Selected foreground contrast: ${contrast(color, row.background)}`);
            }
          };
          const verifyUnselected = row => {
            assert.equal(row.title, 'rgb(17, 24, 39)', 'Unselected title retains plugin content color');
            assert.equal(row.description, 'rgb(107, 114, 128)', 'Unselected description retains plugin muted color');
            assert.equal(row.icons[0], 'rgb(107, 114, 128)', 'Unselected leading icon retains plugin muted color');
            assert.equal(row.mark, palette.accentRgb, 'Unselected marks retain their original accent color');
            assert.equal(row.background, 'rgba(0, 0, 0, 0)', 'Unselected rows do not gain the selected fill');
          };
          let rows = await page.evaluate(readRows);
          verifySelected(rows[0]); verifyUnselected(rows[1]);
          await page.keyboard.press('ArrowDown');
          await page.waitForFunction(() => document.querySelector('search-modal').shadowRoot.querySelector('search-form').selectedIndex === 1);
          rows = await page.evaluate(readRows);
          verifyUnselected(rows[0]); verifySelected(rows[1]);
          const input = page.locator('search-modal input');
          await input.focus();
          await page.keyboard.press('Tab');
          assert.equal(await input.evaluate(node => node.getRootNode().activeElement === node), true, 'single-input official search traps forward Tab before background widgets');
          await page.keyboard.press('Shift+Tab');
          assert.equal(await input.evaluate(node => node.getRootNode().activeElement === node), true, 'single-input official search traps backward Tab');
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('search-modal')?.open);
          const readerHandle = page.locator('[data-post-outline-mobile-handle]');
          assert.equal(await readerHandle.evaluate(node => node === document.activeElement), true, 'official close restores the original reader directory handle');
          assert.equal(await page.locator('[data-post-outline-mobile-sheet]').evaluate(node => node.hidden), false, 'closing search leaves the underlying reader directory open');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('[data-post-outline-mobile-sheet]').evaluate(node => node.hidden), true, 'the restored reader handle keeps its local Escape control');
          assert.equal(await page.locator('[data-post-outline-trigger]').evaluate(node => node === document.activeElement), true);

          assert.deepEqual(errors, [], 'No plugin or theme errors');
          assert.deepEqual(unexpected, [], 'Fixture does not call the real search API');
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
});


test('搜索局部 Tab 边界支持旧单层与嵌套表单，动态清除按钮可用', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const nested of [false, true]) {
      const page = await browser.newPage();
      try {
        await page.setContent('<button id="before">之前</button><search-modal></search-modal><button id="after">之后</button>');
        await page.evaluate((nested) => {
          const modal = document.querySelector('search-modal');
          const root = modal.attachShadow({ mode: 'open' });
          root.innerHTML = '<div class="modal__content"></div>';
          let formRoot = root;
          if (nested) {
            const formHost = document.createElement('search-form');
            root.querySelector('.modal__content').append(formHost);
            formRoot = formHost.attachShadow({ mode: 'open' });
          }
          const target = nested ? formRoot : root.querySelector('.modal__content');
          target.innerHTML = '<form><input id="query"><button type="button" id="disabled" disabled>禁用</button><button type="button" hidden>隐藏</button><span inert><button type="button">隔离</button></span><button type="button" style="visibility:hidden">不可见</button><button type="button" id="clear">清除</button></form>';
          formRoot.querySelector('#clear').addEventListener('click', (event) => {
            formRoot.querySelector('#query').value = '';
            formRoot.querySelector('#query').focus();
            event.currentTarget.remove();
          });
          window.SearchWidget = { open() { formRoot.querySelector('#query').focus(); } };
          window.fixtureEscapes = 0;
          modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) window.fixtureEscapes++;
          });
        }, nested);
        await page.addScriptTag({ content: `${source.replace(/^export /gm, '')}\nwindow.openSearchWidget = openSearchWidget;` });
        await page.evaluate(() => { window.openSearchWidget(); window.openSearchWidget(); });
        const input = page.locator('#query');
        const clear = page.locator('#clear');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await clear.evaluate(node => node.getRootNode().activeElement === node), true, 'first control wraps backward to the visible enabled clear button');
        await page.keyboard.press('Tab');
        assert.equal(await input.evaluate(node => node.getRootNode().activeElement === node), true, 'last control wraps forward to the input');
        await page.keyboard.press('Tab');
        assert.equal(await clear.evaluate(node => node.getRootNode().activeElement === node), true, 'native middle traversal is preserved');
        await page.keyboard.press('Enter');
        assert.equal(await clear.count(), 0);
        await page.keyboard.press('Tab');
        assert.equal(await input.evaluate(node => node.getRootNode().activeElement === node), true, 'removed clear button leaves a one-control cycle');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => window.fixtureEscapes), 1, 'Escape remains available to the official handler');
        await page.locator('#before').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => window.fixtureEscapes), 1, 'outside keyboard input does not reach the search handler');
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('真实 SearchWidget 结果接入统一导航，保留历史、取消与原生回退', async (t) => {
  const home = await (await fetch(baseUrl)).text();
  const script = home.match(/<script\b[^>]*\bsrc=["']([^"']*\/plugins\/PluginSearchWidget\/assets\/static\/search-widget\.iife\.js[^"']*)["']/i)?.[1];
  assert.ok(script);
  const plugin = await (await fetch(new URL(script, baseUrl))).text();
  const source = await readFile(sourceUrl, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const origin = 'https://search-navigation.test';
  try {
    for (const mode of ['keyboard', 'pointer', 'touch', 'cancelled', 'failed-retry', 'native', 'external', 'unknown']) {
      await t.test(mode, async () => {
        const context = await browser.newContext({ viewport: { width: mode === 'touch' ? 390 : 1440, height: 900 },
          isMobile: mode === 'touch', hasTouch: mode === 'touch', reducedMotion: 'reduce' });
        try {
          await context.route('**/*', route => route.fulfill({ contentType: 'text/html',
            body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><button id="trigger">搜索</button></body></html>' }));
          const page = await context.newPage();
          await page.goto(origin);
          await page.evaluate((mode) => {
            const hit = { id: 'target', title: '目标文章', permalink: mode === 'external' ? 'https://outside.test/destination' : '/destination' };
            localStorage.setItem('halo:search-widgets:history:hits', JSON.stringify([
              { id: 'other', title: '其他文章', permalink: '/other' }, hit]));
            window.__searchBridgeTest = { mode, calls: [], document, hit };
            if (mode !== 'native') window.pjax = { loadUrl(href) {
              const state = window.__searchBridgeTest;
              state.calls.push(href);
              if (state.mode === 'cancelled') return Promise.resolve(false);
              document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { url: href, intentId: state.calls.length } }));
              return Promise.resolve(state.mode !== 'failed-retry');
            } };
          }, mode);
          await page.addScriptTag({ content: plugin });
          if (mode === 'unknown') await page.evaluate(() => {
            const prototype = customElements.get('search-form').prototype;
            const original = prototype.handleOpenLink;
            prototype.handleOpenLink = function(hit) { return original.call(this, hit); };
          });
          await page.addScriptTag({ content: `${source.replace(/^export /gm, '')}\nwindow.openSearchWidget = openSearchWidget;` });
          await page.evaluate(() => {
            document.getElementById('trigger').addEventListener('click', () => window.openSearchWidget());
          });
          // Open from a focused trigger, as the real menubar does. Closing the
          // modal restores that focus while the same Enter event is in flight.
          await page.locator('#trigger').click();
          await page.locator('search-modal li[data-index="0"]').waitFor();
          await page.waitForFunction(() => document.querySelector('search-modal').shadowRoot
            .querySelector('search-form').shadowRoot.getElementById('mac-search-form-style'));
          const activate = async (index = 1) => {
            if (mode === 'touch') await page.locator(`search-modal li[data-index="${index}"]`).tap();
            else if (mode === 'pointer') await page.locator(`search-modal li[data-index="${index}"]`).click();
            else {
              for (let i = 0; i < index; i++) await page.locator('search-modal input').press('ArrowDown');
              await page.locator('search-modal input').press('Enter');
            }
          };
          await activate();
          if (mode === 'native' || mode === 'external' || mode === 'unknown') {
            await page.waitForURL(`${mode === 'external' ? 'https://outside.test' : origin}/destination`);
            return;
          }
          await page.waitForFunction(() => window.__searchBridgeTest?.calls.length === 1, null, { timeout: 1500 });
          const state = await page.evaluate(() => ({
            sameDocument: document === window.__searchBridgeTest.document,
            calls: window.__searchBridgeTest.calls,
            open: document.querySelector('search-modal').open,
            history: JSON.parse(localStorage.getItem('halo:search-widgets:history:hits')),
          }));
          assert.equal(state.sameDocument, true);
          assert.deepEqual(state.calls, [`${origin}/destination`]);
          assert.equal(state.open, mode === 'cancelled', 'a rejected leave must keep the search open');
          assert.deepEqual(state.history.map(hit => hit.id), mode === 'cancelled' ? ['other', 'target'] : ['target', 'other'],
            'accepted navigation promotes the hit without duplicates; a veto preserves history');
          if (mode === 'failed-retry') {
            assert.equal(page.url(), `${origin}/`, 'a failed Swup read must not fall through to a full reload');
            await page.evaluate(() => { window.__searchBridgeTest.mode = 'keyboard'; window.openSearchWidget(); });
            await page.locator('search-modal li[data-index="0"]').waitFor();
            await page.waitForFunction(() => document.querySelector('search-modal').shadowRoot
              .querySelector('search-form').shadowRoot.getElementById('mac-search-form-style'));
            await activate(0);
            await page.waitForFunction(() => window.__searchBridgeTest?.calls.length === 2);
            assert.equal(await page.evaluate(() => document === window.__searchBridgeTest.document), true);
          }
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
});
