import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const runtimePath = fileURLToPath(new URL('../src/apps/docsme/runtime.js', import.meta.url));
const runtimeSource = await readFile(runtimePath, 'utf8');
const runtimeBundle = await build({
  stdin: {
    contents: `${runtimeSource}\nwindow.__verifyDocsmeToc = renderToc;`,
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

  console.log('Docsme TOC unique IDs and 4 sticky-toolbar scroll scenarios passed');
} finally {
  await browser.close();
}
