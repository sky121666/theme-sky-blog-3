import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'src/apps/docsme/runtime.js'), 'utf8');
const styles = await readFile(path.join(root, 'src/apps/docsme/styles/index.css'), 'utf8');
const bundle = await build({
  stdin: {
    contents: `${source}\nwindow.__verifyDocsmeTables = wrapDocsmeTables;`,
    resolveDir: path.join(root, 'src/apps/docsme'),
    sourcefile: 'docsme-tables-fixture.js',
    loader: 'js'
  },
  bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent'
});
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html><body>
    <main class="docsme-window" style="width: min(700px, calc(100vw - 32px));">
      <article class="docsme-article">
        <div class="halo-table-wrapper"><table style="min-width: 1000px">
          <thead><tr><th><p>字段</p></th><th><p>说明</p></th></tr></thead>
          <tbody><tr><td><h3>宽表格</h3><p>单元格结尾</p></td><td><p>内容</p></td></tr></tbody>
        </table></div>
      </article>
    </main>
  </body></html>`);
  await page.addStyleTag({ content: `* { box-sizing: border-box; } ${styles}` });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    window.__verifyDocsmeTables(document);
    window.__verifyDocsmeTables(document);
  });

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      const state = await page.evaluate((dark) => {
        document.documentElement.classList.toggle('dark', dark);
        const article = document.querySelector('.docsme-article');
        const wrapper = document.querySelector('.docsme-table-scroll');
        const heading = document.querySelector('td > h3');
        const paragraph = document.querySelector('td > p');
        const header = document.querySelector('th');
        wrapper.scrollLeft = wrapper.scrollWidth;
        return {
          wrappers: document.querySelectorAll('.docsme-table-scroll').length,
          wrapperWidth: wrapper.clientWidth,
          articleWidth: article.clientWidth,
          scrollWidth: wrapper.scrollWidth,
          scrollLeft: wrapper.scrollLeft,
          focusable: wrapper.tabIndex === 0,
          headingMargin: getComputedStyle(heading).marginTop,
          paragraphMargin: getComputedStyle(paragraph).marginBottom,
          headerParagraphMargin: getComputedStyle(header.firstElementChild).marginBottom,
          headerBackground: getComputedStyle(header).backgroundColor,
          cellBorder: getComputedStyle(header).borderBottomWidth
        };
      }, dark);
      const label = `${width}px ${dark ? 'dark' : 'light'}`;
      assert.equal(state.wrappers, 1, `${label}: repeated hydration must not nest table scroll regions`);
      assert.ok(state.wrapperWidth < state.articleWidth, `${label}: table must stay within the article`);
      assert.ok(state.scrollWidth > state.wrapperWidth && state.scrollLeft > 0, `${label}: wide tables must scroll horizontally`);
      assert.equal(state.focusable, true, `${label}: table scrolling must remain keyboard accessible`);
      assert.equal(state.headingMargin, '0px', `${label}: first cell child must not add outer top spacing`);
      assert.equal(state.paragraphMargin, '0px', `${label}: last cell child must not add outer bottom spacing`);
      assert.equal(state.headerParagraphMargin, '0px', `${label}: header paragraphs must not expand cell spacing`);
      assert.notEqual(state.headerBackground, 'rgba(0, 0, 0, 0)', `${label}: table headers need their background`);
      assert.equal(state.cellBorder, '1px', `${label}: table cell borders must stay visible`);
    }
  }
  assert.deepEqual(errors, [], 'Docsme table fixture must not produce runtime errors');
  console.log('Docsme table spacing and horizontal scrolling passed (mobile/desktop, light/dark)');
} finally {
  await browser.close();
}
