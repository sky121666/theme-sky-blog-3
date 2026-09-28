import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const runtimeSource = await readFile(new URL('../src/apps/docsme/runtime.js', import.meta.url), 'utf8');
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.route('https://theme.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Docs</title></head><body><main id="app"></main></body></html>'
  }));
  await page.goto('https://theme.test/fixture');
  await page.addScriptTag({ path: new URL('../node_modules/pjax/pjax.js', import.meta.url).pathname });
  await page.addScriptTag({
    type: 'module',
    content: `${runtimeSource}\nwindow.__verifyDocsmeLinks = enhanceDocsmeLinks;`
  });
  await page.waitForFunction(() => typeof window.__verifyDocsmeLinks === 'function');

  const result = await page.evaluate(() => {
    document.querySelector('#app').innerHTML = `
      <div class="docsme-app">
        <a id="prebound" class="pjax-link" data-pjax-managed="true" href="/docs/already">已绑定</a>
        <a id="fresh" href="/docs/next">下一篇</a>
        <a id="download" href="/docs/export" download>下载</a>
        <a id="top" href="/docs/top" target="_top">顶层页面</a>
      </div>`;
    const app = document.querySelector('.docsme-app');
    window.pjax = new window.Pjax({
      elements: 'a.pjax-link[data-pjax-managed="true"]',
      selectors: ['title', '#app'],
      cacheBust: false
    });
    const originalAttachLink = window.pjax.attachLink.bind(window.pjax);
    let dynamicAttaches = 0;
    window.pjax.attachLink = (link) => {
      dynamicAttaches += 1;
      return originalAttachLink(link);
    };

    window.__verifyDocsmeLinks(app);
    window.__verifyDocsmeLinks(app);
    const state = (id) => {
      const link = document.getElementById(id);
      return {
        pjaxClass: link.classList.contains('pjax-link'),
        managed: link.getAttribute('data-pjax-managed'),
        attached: link.hasAttribute('data-pjax-state')
      };
    };
    return {
      fresh: state('fresh'),
      prebound: state('prebound'),
      download: state('download'),
      top: state('top'),
      dynamicAttaches
    };
  });

  assert.deepEqual(result.fresh, { pjaxClass: true, managed: 'true', attached: true },
    'new Docsme body link must be attached through Pjax 0.2.8');
  assert.equal(result.prebound.attached, true, 'constructor-bound link remains active');
  assert.equal(result.dynamicAttaches, 1, 'repeat enhancement must not add duplicate listeners');
  assert.deepEqual(result.download, { pjaxClass: false, managed: null, attached: false },
    'download must keep native browser behavior');
  assert.deepEqual(result.top, { pjaxClass: false, managed: null, attached: false },
    'non-self target must keep native browser behavior');

  console.log('Docsme internal link attachment and native-link exclusions passed');
} finally {
  await browser.close();
}
