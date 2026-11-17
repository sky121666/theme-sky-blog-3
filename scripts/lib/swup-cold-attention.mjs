import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { build } from 'esbuild';

// Keep the real attention vendor in flight while the foreground Swup link
// accepts, fetches and renders. All responses stay in this browser fixture.
export async function verifyColdAttention({ browser, html, entry }) {
  const origin = 'https://cold-attention.test';
  const files = await build({
    stdin: { resolveDir: process.cwd(), contents: entry },
    outdir: 'in-memory', entryNames: 'entry', bundle: true, write: false,
    format: 'esm', splitting: true, platform: 'browser', logLevel: 'silent',
    plugins: [{
      name: 'separate-attention', setup(builder) {
        builder.onResolve({ filter: /^@swup\/preload-plugin$/ }, () => ({ path: '/optional-attention.js', external: true }));
      }
    }]
  });
  const vendor = await build({
    stdin: { resolveDir: process.cwd(), contents: "export {default} from '@swup/preload-plugin'" },
    bundle: true, write: false, format: 'esm', logLevel: 'silent'
  });
  const modules = new Map(files.outputFiles.map(file => [basename(file.path), file.text]));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const page = await browser.newPage();
  const requests = [];
  try {
    const held = page.waitForRequest('**/optional-attention.js');
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin);
      assert.equal(request.method(), 'GET');
      if (url.pathname === '/optional-attention.js') {
        await gate;
        return route.fulfill({ contentType: 'text/javascript', body: vendor.outputFiles[0].text }).catch(() => {});
      }
      const code = modules.get(basename(url.pathname));
      if (code) return route.fulfill({ contentType: 'text/javascript', body: code });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ contentType: 'text/css', body: '' });
      requests.push([url.pathname, request.isNavigationRequest()]);
      await route.fulfill({
        contentType: 'text/html', body: html(url.pathname).replace('</head>', '<script type="module" src="/entry.js"></script></head>')
      });
    });
    await page.goto(origin + '/archives', { waitUntil: 'domcontentloaded' });
    await held;
    await page.waitForFunction(() => !!window.pjax?.loadUrl, null, { timeout: 3000 });
    await page.evaluate(() => { window.coldDocument = document; document.querySelector('#nav-story').click(); });
    await page.waitForFunction(() => document.querySelector('[data-page-label]')?.dataset.pageLabel === '/archives/story', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.coldDocument === document), true);
    assert.deepEqual(requests.filter(([path]) => path === '/archives/story'), [['/archives/story', false]]);
  } finally {
    release();
    await page.close();
  }
}
