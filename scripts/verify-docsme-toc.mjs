import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const runtimePath = fileURLToPath(new URL('../src/apps/docsme/runtime.js', import.meta.url));
const runtimeSource = await readFile(runtimePath, 'utf8');
const template = await readFile(new URL('../templates/modules/docsme-app/content.html', import.meta.url), 'utf8');
const tocMarkup = template.match(/<aside class="docsme-toc"[\s\S]*?<\/aside>/)?.[0];
const layout = await readFile(new URL('../templates/modules/shell/layout.html', import.meta.url), 'utf8');
const preferenceScript = layout.match(/<script data-docsme-layout-preference>([\s\S]*?)<\/script>/)?.[1] || '';
const styles = (await readFile(new URL('../src/apps/docsme/styles/index.css', import.meta.url), 'utf8')).replace(/^@import.*;$/gm, '');
const runtimeBundle = await build({
  stdin: {
    contents: `${runtimeSource}
      window.__verifyDocsmeToc = renderToc;
      window.__bindDocsmeToc = root => { bindMobileSidebar(root); bindTocToggles(root); renderToc(root); };
      window.__disposeDocsmeToc = disposeDocsmeEnhancements;`,
    resolveDir: path.dirname(runtimePath),
    sourcefile: 'docsme-toc-fixture.js',
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent'
});
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: runtimeBundle.outputFiles[0].text });
  await page.waitForFunction(() => typeof window.__verifyDocsmeToc === 'function');

  async function verifyCase(label, markup, expectedIds, outsideMarkup = '') {
    const result = await page.evaluate(({ markup, outsideMarkup }) => {
      document.body.innerHTML = `${outsideMarkup}
        <main class="docsme-app">
          <aside data-docsme-toc><nav data-docsme-toc-list></nav></aside>
          <div class="docsme-main"><article data-toc-content>${markup}</article></div>
        </main>`;
      const app = document.querySelector('.docsme-app');
      const snapshot = () => ({
        headingIds: Array.from(app.querySelectorAll('[data-toc-content] h2, [data-toc-content] h3'), (heading) => heading.id),
        links: Array.from(app.querySelectorAll('[data-docsme-toc-list] a'), (link) => link.getAttribute('href')),
        pageIds: Array.from(document.querySelectorAll('[id]'), (node) => node.id)
      });

      window.__verifyDocsmeToc(app);
      const first = snapshot();
      window.__verifyDocsmeToc(app);
      const repeated = snapshot();
      app._docsmeTocObserver?.disconnect();
      return { first, repeated };
    }, { markup, outsideMarkup });

    assert.deepEqual(result.first.headingIds, expectedIds, `${label}: heading IDs`);
    assert.deepEqual(result.first.links, expectedIds.map((id) => `#${id}`), `${label}: TOC links`);
    assert.equal(new Set(result.first.pageIds).size, result.first.pageIds.length, `${label}: page IDs must be unique`);
    assert.deepEqual(result.repeated, result.first, `${label}: repeated rendering must preserve IDs`);
  }

  await verifyCase(
    'overlapping generated slugs',
    '<h2>Intro</h2><h2>Intro</h2><h3>Intro 2</h3>',
    ['intro', 'intro-2', 'intro-2-2']
  );
  await verifyCase(
    'later explicit IDs take priority',
    '<h2>Intro</h2><h2 id="intro">Pinned</h2><h3 id="intro-2">Also pinned</h3>',
    ['intro-3', 'intro', 'intro-2']
  );
  await verifyCase(
    'existing page ID and duplicate explicit heading ID',
    '<h2 id="chapter">First</h2><h3 id="chapter">Second</h3><h2>Intro</h2>',
    ['chapter', 'second', 'intro-2'],
    '<div id="intro"></div>'
  );

  // A real scrolling container catches headings hidden under the sticky toolbar,
  // including a toolbar that changes height after the TOC has been initialized.
  for (const width of [390, 1440]) {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
      try {
        await context.route('http://docsme.test/**', (route) => route.fulfill({
          contentType: 'text/html', body: '<!doctype html><html><body></body></html>'
        }));
        const scrollPage = await context.newPage();
        await scrollPage.goto('http://docsme.test/docs/current');
        await scrollPage.addScriptTag({ content: runtimeBundle.outputFiles[0].text });
        const before = await scrollPage.evaluate(() => {
          document.body.innerHTML = `
            <style>
              body { margin: 0; min-height: 2000px; }
              .docsme-app { margin-top: 180px; }
              .docsme-main { height: 340px; overflow: auto; border: 2px solid; }
              .docsme-toolbar { position: sticky; top: 0; height: 55px; background: white; }
              article { padding: 20px; }
              aside { position: fixed; top: 0; }
            </style>
            <main class="docsme-app is-mobile-toc-open">
              <aside data-docsme-toc><nav data-docsme-toc-list></nav></aside>
              <div class="docsme-main">
                <div class="docsme-toolbar"><button data-docsme-toggle-toc aria-expanded="true">目录</button></div>
                <article data-toc-content>
                  <div style="height: 500px"></div><h2 id="target">Target heading</h2>
                  <div style="height: 800px"></div>
                </article>
              </div>
            </main>`;
          const app = document.querySelector('.docsme-app');
          window.__verifyDocsmeToc(app);
          document.querySelector('.docsme-toolbar').style.height = '96px';
          history.replaceState({ uid: 'docsme-test', __browserNavIndex: 4, scrollPos: [0, 17] }, '');
          window.__tocScrollFinished = false;
          document.querySelector('.docsme-main').addEventListener('scrollend', () => {
            window.__tocScrollFinished = true;
          }, { once: true });
          return { history: history.state, length: history.length, outerScroll: window.scrollY };
        });
        await scrollPage.locator('.docsme-toc__link').click();
        await scrollPage.waitForFunction(() => window.__tocScrollFinished, null, { timeout: 5000 });
        const after = await scrollPage.evaluate(() => {
          const target = document.getElementById('target').getBoundingClientRect();
          const toolbar = document.querySelector('.docsme-toolbar').getBoundingClientRect();
          const main = document.querySelector('.docsme-main').getBoundingClientRect();
          return {
            targetTop: target.top, targetBottom: target.bottom, toolbarBottom: toolbar.bottom,
            mainBottom: main.bottom, outerScroll: window.scrollY, hash: location.hash,
            history: history.state, length: history.length,
            tocInert: document.querySelector('[data-docsme-toc]').inert
          };
        });
        const label = `${width}px / ${reducedMotion}`;
        assert.ok(after.targetTop >= after.toolbarBottom, `${label}: target heading must clear the sticky toolbar`);
        assert.ok(after.targetBottom <= after.mainBottom, `${label}: target heading must remain visible`);
        assert.equal(after.outerScroll, before.outerScroll, `${label}: only the document container should scroll`);
        assert.equal(after.hash, '#target');
        assert.deepEqual(after.history, before.history);
        assert.equal(after.length, before.length);
        assert.equal(after.tocInert, width <= 1080);
      } finally {
        await context.close();
      }
    }
  }

  const nativeGesture = await page.evaluate(() => {
    document.body.innerHTML = '<main class="docsme-app"><aside data-docsme-toc><nav data-docsme-toc-list></nav></aside><div class="docsme-main"><article data-toc-content><h2 id="intro">Intro</h2></article></div></main>';
    const app = document.querySelector('.docsme-app');
    window.__verifyDocsmeToc(app);
    const outcomes = [];
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [modifier]: true });
      app.querySelector('.docsme-toc__link').dispatchEvent(event);
      outcomes.push({ modifier, prevented: event.defaultPrevented });
    }
    app._docsmeTocObserver?.disconnect();
    return outcomes;
  });
  assert.ok(nativeGesture.every(row => !row.prevented), 'TOC modifier clicks must retain native browser navigation');

  // Use the real panel markup and stylesheet: the reported control used to
  // share the close action, so a runtime-only pin stub would miss the defect.
  assert.ok(tocMarkup?.includes('data-docsme-pin-toc'), 'The TOC header must expose a pin action separate from close');
  const pinContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await pinContext.route('http://docsme.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><body></body></html>'
    }));
    const pinPage = await pinContext.newPage();
    await pinPage.goto('http://docsme.test/docs/current');
    await pinPage.addScriptTag({ content: runtimeBundle.outputFiles[0].text });
    const mount = async (width = 1080, headings = true, initialize = true) => pinPage.evaluate(({ width, headings, initialize, tocMarkup, styles }) => {
      const previous = document.querySelector('.docsme-app');
      if (previous) window.__disposeDocsmeToc(previous);
      document.body.innerHTML = `<style>${styles}
        * { box-sizing: border-box; } body { margin: 0; }
        .docsme-window { width: ${width}px; height: 600px; min-width: 0; min-height: 0; }
        article section { height: 420px; }
      </style>
      <div class="docsme-window"><div class="docsme-window-content">
        <div class="docsme-app docsme-app--document"><div class="docsme-shell docsme-shell--reading">
          <aside class="docsme-sidebar"><button data-docsme-close-sidebar>关闭文档树</button><a href="#tree">文档树</a></aside>
          <main class="docsme-main">
            <header class="docsme-toolbar"><button class="docsme-icon-button" data-docsme-toggle-sidebar>文档树</button><div class="docsme-toolbar-actions"><button class="docsme-toc-reveal" data-docsme-toggle-toc>目录</button></div></header>
            <section class="docsme-content"><div class="docsme-reading-sheet">
              <article data-toc-content>${headings ? Array.from({ length: 12 }, (_, i) => `<section><h2 id="part-${i}">第 ${i + 1} 节</h2><p>正文</p></section>`).join('') : '<p>无标题正文</p>'}</article>
            </div></section>
          </main>${tocMarkup}
        </div></div>
      </div></div><button id="outside-control">桌面</button>`;
      if (initialize) window.__bindDocsmeToc(document.querySelector('.docsme-app'));
    }, { width, headings, initialize, tocMarkup, styles });
    const pin = pinPage.locator('[data-docsme-pin-toc]');
    const toc = pinPage.locator('[data-docsme-toc]');
    const trigger = pinPage.locator('.docsme-toolbar [data-docsme-toggle-toc]');
    const snapshot = () => pinPage.evaluate(() => {
      const app = document.querySelector('.docsme-app'), toc = app.querySelector('[data-docsme-toc]');
      const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      return { pinned: app.classList.contains('is-toc-pinned'), hidden: toc.inert,
        main: rect(app.querySelector('.docsme-main')), toc: rect(toc),
        heading: rect(toc.querySelector('.docsme-toc__head')), article: rect(app.querySelector('article')),
        overflow: app.scrollWidth > app.clientWidth, scrollTop: app.querySelector('.docsme-main').scrollTop };
    });

    // A saved preference must never squeeze the article in a medium window.
    await pinPage.evaluate(() => sessionStorage.setItem('docsme-toc-pinned', 'true'));
    for (const width of [958, 1024, 1079]) {
      await mount(width);
      assert.equal((await snapshot()).pinned, false, `${width}px: use a popover even with a saved pin`);
      assert.ok((await snapshot()).article.width >= 480, `${width}px: retain reading space`);
      await trigger.click();
      assert.equal(await pin.isVisible(), false);
      await pinPage.keyboard.press('Escape');
    }

    await mount();
    const pinned = await snapshot();
    assert.equal(pinned.pinned, true, 'A 1080px window can reserve a fixed column');
    assert.equal(pinned.hidden, false);
    assert.ok(pinned.toc.left >= pinned.main.right - 1, 'A pinned panel reserves space instead of covering the article');
    assert.ok(pinned.article.width >= 480, 'Pinning preserves a readable article width');
    assert.equal(pinned.overflow, false);
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    await pinPage.locator('article p').first().click();
    assert.equal((await snapshot()).hidden, false, 'Reading the article must not dismiss a pinned TOC');
    await toc.locator('a').nth(2).click();
    assert.equal((await snapshot()).hidden, false, 'Choosing a heading keeps the pinned TOC open');
    await pinPage.waitForFunction(() => document.querySelector('.docsme-main').scrollTop > 600);
    await pinPage.evaluate(() => { document.querySelector('.docsme-toc__list').scrollTop = 220; });
    assert.equal((await snapshot()).heading.top, pinned.heading.top, 'Neither article nor TOC scrolling moves the panel header');
    await toc.locator('[data-docsme-toggle-toc]').click();
    assert.equal((await snapshot()).hidden, true);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await trigger.click();
    assert.equal((await snapshot()).pinned, true, 'Closing does not forget the chosen pin mode');
    await pin.click();
    assert.equal((await snapshot()).pinned, false);
    assert.equal((await snapshot()).hidden, false, 'Unpin keeps the floating TOC open');
    await pinPage.keyboard.press('Escape');
    assert.equal((await snapshot()).hidden, true);
    await trigger.click();
    await pin.click();
    await mount();
    assert.equal((await snapshot()).pinned, true, 'A newly mounted chapter restores the same-tab pin preference');
    await pinPage.evaluate(() => { document.querySelector('.docsme-window').style.width = '390px'; });
    await pinPage.waitForFunction(() => !document.querySelector('.docsme-app').classList.contains('is-toc-pinned'));
    assert.equal((await snapshot()).hidden, true, 'Narrowing the window does not open a modal over reading content');
    await trigger.click();
    assert.equal(await pin.isVisible(), false, 'Narrow windows do not offer an unusable fixed column');
    assert.equal(await toc.getAttribute('role'), 'dialog');
    assert.equal(await toc.getAttribute('aria-modal'), 'true');
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), true);
    assert.equal(await pinPage.locator('.docsme-sidebar').evaluate(el => el.inert), true);
    assert.equal(await pinPage.locator('#outside-control').evaluate(el => el.inert), true);
    const close = toc.locator('[data-docsme-toggle-toc]');
    const closeBox = await close.boundingBox();
    assert.ok(closeBox.width >= 44 && closeBox.height >= 44, 'Mobile close has a 44px touch target');
    await close.focus();
    await pinPage.keyboard.press('Shift+Tab');
    assert.equal(await toc.locator('a').last().evaluate(el => document.activeElement === el), true);
    await pinPage.keyboard.press('Tab');
    assert.equal(await close.evaluate(el => document.activeElement === el), true);
    await pinPage.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), false);
    assert.equal(await pinPage.locator('#outside-control').evaluate(el => el.inert), false);
    await trigger.click();
    await pinPage.mouse.click(10, 300);
    assert.equal((await snapshot()).hidden, true, 'The mobile backdrop dismisses the TOC after the article becomes inert');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await pinPage.locator('#outside-control').evaluate(el => { el.inert = true; });
    await trigger.click();
    await pinPage.keyboard.press('Escape');
    assert.equal(await pinPage.locator('#outside-control').evaluate(el => el.inert), true, 'Closing restores an existing background lock');
    await pinPage.locator('#outside-control').evaluate(el => { el.inert = false; });
    await pinPage.locator('[data-docsme-toggle-sidebar]').click();
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), true);
    await pinPage.keyboard.press('Escape');
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), false, 'TOC and tree must not leave stale inert state');
    await trigger.click();
    await toc.locator('a').first().click();
    assert.equal((await snapshot()).hidden, true, 'Mobile heading selection closes the floating panel');
    assert.equal(await pinPage.locator('h2').first().evaluate(el => document.activeElement === el), true);
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), false);
    await trigger.click();
    await pinPage.evaluate(() => { document.querySelector('.docsme-window').style.width = '1080px'; });
    await pinPage.waitForFunction(() => document.querySelector('.docsme-app').classList.contains('is-toc-pinned'));
    assert.equal((await snapshot()).hidden, false, 'Widening restores the pinned column');
    assert.equal(await toc.getAttribute('aria-modal'), null);
    assert.equal(await pinPage.locator('.docsme-main').evaluate(el => el.inert), false);
    assert.equal(await pinPage.locator('#outside-control').evaluate(el => el.inert), false);
    await pin.click();
    await mount(1200);
    assert.equal((await snapshot()).pinned, false, 'Explicit unpin also applies to wide windows');
    await trigger.click();
    const floating = await snapshot();
    await pinPage.mouse.click(floating.main.left + 20, floating.toc.top + 30);
    assert.equal((await snapshot()).hidden, true, 'Clicking outside dismisses an unpinned panel');
    await mount(958, false);
    assert.equal(await trigger.isVisible(), false, 'Documents without headings do not leave an empty TOC control');
    assert.equal((await snapshot()).hidden, true);
    await pinPage.evaluate(() => window.__disposeDocsmeToc(document.querySelector('.docsme-app')));

    assert.ok(preferenceScript, 'Restore the pin preference in head before the first layout');
    for (const preference of ['true', 'false']) {
      await pinPage.evaluate(value => sessionStorage.setItem('docsme-toc-pinned', value), preference);
      await pinPage.addScriptTag({ content: preferenceScript });
      await mount(1200, true, false);
      const before = await snapshot();
      assert.equal(before.toc.width > 0, preference === 'true', 'Pre-runtime TOC layout follows the stored preference');
      await pinPage.evaluate(() => window.__bindDocsmeToc(document.querySelector('.docsme-app')));
      const after = await snapshot();
      assert.equal(after.article.width, before.article.width, 'Initialization does not change the reading column width');
    }
    await mount(390);
    await trigger.click();
    await pinPage.evaluate(() => {
      const outside = document.getElementById('outside-control');
      window.__disposeDocsmeToc(document.querySelector('.docsme-app'));
      window.__outsideInertAfterDispose = outside.inert;
    });
    assert.equal(await pinPage.evaluate(() => window.__outsideInertAfterDispose), false, 'Unmounting an open modal releases the desktop');
  } finally {
    await pinContext.close();
  }
  console.log('Docsme TOC IDs, native gestures, sticky-toolbar scrolling and pin/close/resize/remount scenarios passed');
} finally {
  await browser.close();
}
