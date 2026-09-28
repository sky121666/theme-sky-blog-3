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

  console.log('Docsme TOC unique heading IDs passed');
} finally {
  await browser.close();
}
