import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real ESM splitting preserves the asynchronous import boundary. Delay the
// emitted bridge chunk, not a replacement implementation of the loader.
const outputBase = '/virtual/shiki-loader';
const built = await build({
  entryPoints: { entry: 'src/shell/desktop-shell/runtime/desktop/pjax/shiki-bridge-loader.js' },
  outdir: outputBase, bundle: true, splitting: true, write: false, format: 'esm', logLevel: 'silent'
});
const files = new Map(built.outputFiles.map((file) => [file.path.slice(outputBase.length), file.text]));
const origin = 'https://shiki-loader.test';
const modulePath = '/plugins/shiki/assets/static/shiki-code.js?version=1.5.2';
const jar = process.env.SHIKI_PLUGIN_JAR || path.resolve('../../plugins/shiki-1.5.2.jar');
const assets = new Map();
function pluginAsset(name) {
  assert.match(name, /^[\w.-]+$/);
  if (!assets.has(name)) assets.set(name, execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 8 * 1024 * 1024 }));
  return assets.get(name);
}
function descriptor(label, official = false) {
  const config = JSON.stringify({ lightTheme: official ? 'github-light' : `light-${label}`,
    darkTheme: official ? 'github-dark' : `dark-${label}`, variant: 'simple', fontSize: '0.875em', excludedLanguages: [] });
  return `<script type="${official ? 'module' : 'application/json'}" data-pjax>
import { renderCodeBlock } from '${modulePath}';
${official ? 'document.addEventListener("DOMContentLoaded", () => {' : ''}
renderCodeBlock(${config});
${official ? '});' : ''}
</script>`;
}
function response(label) {
  return `<!doctype html><html><head>${descriptor(label)}</head><body></body></html>`;
}
const raw = (label) => `<pre><code class="language-js">const value${label} = true;</code></pre>`;
const mockModule = `if (!customElements.get('shiki-code')) customElements.define('shiki-code', class extends HTMLElement {});
export function renderCodeBlock() {}`;
const browser = await chromium.launch({ headless: true });
let passed = 0;
async function fixture(label, run, { initial = true, official = false, holdBridge = true, delayedRealPlugin = official } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  let bridgeRequests = 0;
  let releaseBridge, releasePlugin, releaseDcl;
  const bridgeGate = holdBridge ? new Promise((resolve) => { releaseBridge = resolve; }) : Promise.resolve();
  const pluginGate = delayedRealPlugin ? new Promise((resolve) => { releasePlugin = resolve; }) : Promise.resolve();
  const dclGate = official ? new Promise((resolve) => { releaseDcl = resolve; }) : Promise.resolve();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, 'loader regression must not contact a real site or external CDN');
    if (url.pathname === '/dcl-blocker.js') {
      await dclGate;
      return route.fulfill({ contentType: 'text/javascript', body: 'export const ready = true;' });
    }
    if (url.pathname.startsWith('/built/')) {
      const name = url.pathname.slice('/built'.length);
      assert.ok(files.has(name), `missing compiled fixture asset ${name}`);
      if (name !== '/entry.js') { bridgeRequests++; await bridgeGate; }
      return route.fulfill({ contentType: 'text/javascript', body: files.get(name) });
    }
    if (url.pathname.startsWith('/plugins/shiki/assets/static/')) {
      await pluginGate;
      return route.fulfill({ contentType: 'text/javascript', body: delayedRealPlugin ? pluginAsset(path.basename(url.pathname)) : mockModule });
    }
    assert.equal(url.pathname, '/fixture');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>${initial ? descriptor('A', official) : ''}
      ${official ? '<script type="module" src="/dcl-blocker.js"></script>' : ''}</head>
      <body><section data-app-root="moments"><div id="root">${raw('A')}</div></section>
      ${official ? `<script>import('/built/entry.js').then(loader => { window.__loader = loader; loader.initializeShikiBridge(); window.__loaderScheduled = true; });</script>` : ''}
      </body></html>` });
  });
  try {
    await page.goto(origin + '/fixture', { waitUntil: official ? 'commit' : 'domcontentloaded' });
    if (!official) await page.evaluate(async () => { window.__loader = await import('/built/entry.js'); });
    await run({ page, releaseBridge, releasePlugin, releaseDcl, requests: () => bridgeRequests });
    assert.deepEqual(errors, [], `${label}: no browser runtime errors`);
    passed++;
    console.log(`PASS ${label}`);
  } finally { releaseBridge?.(); releasePlugin?.(); releaseDcl?.(); await context.close(); }
}
async function wrapped(page, count) {
  await page.waitForFunction((count) => document.querySelectorAll('#root shiki-code').length === count, count);
}

try {
  await fixture('pages without Shiki do not download the bridge chunk', async ({ page, requests }) => {
    await page.evaluate(() => __loader.initializeShikiBridge());
    await page.waitForTimeout(20);
    assert.equal(requests(), 0);
  }, { initial: false });

  await fixture('late bridge reconciles an initial Moments feed event it missed', async ({ page, releaseBridge }) => {
    await page.evaluate((extra) => {
      __loader.initializeShikiBridge();
      const root = document.getElementById('root');
      root.insertAdjacentHTML('beforeend', extra);
      window.dispatchEvent(new CustomEvent('moments:feed-updated', { detail: { root } }));
    }, raw('Early'));
    releaseBridge();
    await wrapped(page, 2);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#root shiki-code'), node => node.getAttribute('light-theme'))), ['light-A', 'light-A']);
  });

  await fixture('new response wins over initial synchronization during the chunk download', async ({ page, releaseBridge }) => {
    await page.evaluate(({ html, code }) => {
      __loader.initializeShikiBridge();
      const root = document.getElementById('root'); root.innerHTML = code;
      __loader.runShikiExtraPathRenderer(html, root);
    }, { html: response('B'), code: raw('B') });
    releaseBridge();
    await wrapped(page, 1);
    assert.equal(await page.getAttribute('#root shiki-code', 'light-theme'), 'light-B');
    assert.equal(await page.evaluate(() => __themeShikiBridge.config.lightTheme), 'light-B');
  });

  await fixture('detached superseded roots cannot be wrapped by a late chunk', async ({ page, releaseBridge }) => {
    await page.evaluate(({ oldHtml, html, code }) => {
      const old = document.getElementById('root'); window.__oldRoot = old;
      __loader.runShikiExtraPathRenderer(oldHtml, old);
      const root = document.createElement('div'); root.id = 'root'; root.innerHTML = code;
      old.replaceWith(root);
      __loader.runShikiExtraPathRenderer(html, root);
    }, { oldHtml: response('A'), html: response('B'), code: raw('B') });
    releaseBridge();
    await wrapped(page, 1);
    assert.equal(await page.evaluate(() => __oldRoot.querySelectorAll('shiki-code').length), 0);
    assert.equal(await page.getAttribute('#root shiki-code', 'light-theme'), 'light-B');
  });

  await fixture('an unsigned latest response invalidates the pending initial descriptor', async ({ page, releaseBridge }) => {
    await page.evaluate(() => {
      __loader.initializeShikiBridge();
      __loader.runShikiExtraPathRenderer('<html><head></head></html>', document.getElementById('root'));
    });
    releaseBridge();
    await page.waitForFunction(() => Boolean(window.__themeShikiBridge));
    assert.equal(await page.locator('#root shiki-code').count(), 0);
  });

  // This boundary is after the bridge has loaded and inserted its module script.
  // Same-variant pages replace the contents of a still-connected root.
  for (const next of ['unsigned', 'signed', 'pending', 'cancelled', 'failed']) {
    await fixture(`late official plugin import with a ${next} navigation`, async ({ page, releasePlugin }) => {
      const signed = `<html><head>${descriptor('A', true)}</head><body></body></html>`;
      const loading = page.waitForRequest(origin + modulePath);
      await page.evaluate((html) => {
        __loader.runShikiExtraPathRenderer(html, document.getElementById('root'), new DOMParser().parseFromString(html, 'text/html'));
      }, signed);
      await loading;
      await page.evaluate(({ signed, next, code }) => {
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 2 } }));
        if (next === 'unsigned' || next === 'signed') {
          const root = document.getElementById('root');
          root.innerHTML = code;
          const html = next === 'unsigned' ? '<html><head></head><body></body></html>' : signed.replace('0.875em', '1.125em');
          __loader.runShikiExtraPathRenderer(html, root, new DOMParser().parseFromString(html, 'text/html'));
        } else if (next !== 'pending') {
          document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 2, outcome: next } }));
        }
      }, { signed, next, code: raw('B') });
      releasePlugin();
      await page.waitForFunction(() => customElements.get('shiki-code') && !document.querySelector('script[data-theme-shiki-replay]'));
      const host = page.locator('#root shiki-code');
      assert.equal(await host.count(), next === 'unsigned' ? 0 : 1, 'only the displayed page may wrap its code');
      if (next === 'unsigned') {
        assert.equal(await page.evaluate(() => __themeShikiBridge.config), null, 'a stale import must not reconfigure the shared bridge');
      } else {
        const size = next === 'signed' ? '1.125em' : '0.875em';
        assert.equal(await host.getAttribute('font-size'), size);
        await page.waitForFunction(() => document.querySelector('#root shiki-code')?.shadowRoot
          ?.querySelector('shiki-code-simple-variant')?.shadowRoot?.querySelector('.shiki'));
      }
      assert.equal(await page.evaluate(() => __themeShikiPendingRoots.size), 0);
    }, { initial: false, holdBridge: false, delayedRealPlugin: true });
  }

  await fixture('interactive initial reconciliation waits for the actual Shiki 1.5.2 DCL renderer', async ({ page, releasePlugin, releaseDcl }) => {
    await page.waitForFunction(() => window.__loaderScheduled && window.__themeShikiBridge);
    assert.equal(await page.evaluate(() => document.readyState), 'interactive');
    releasePlugin();
    await page.waitForFunction(() => Boolean(customElements.get('shiki-code')));
    await page.waitForTimeout(30);
    const early = await page.locator('#root shiki-code').count();
    releaseDcl();
    await page.waitForLoadState('load');
    await page.waitForFunction(() => {
      const host = document.querySelector('#root shiki-code');
      return host && host.loading === false && host.shadowRoot?.querySelector('shiki-code-simple-variant')?.shadowRoot?.querySelector('.shiki');
    });
    const counts = await page.evaluate(() => ({ hosts: document.querySelectorAll('#root shiki-code').length,
      nested: document.querySelectorAll('#root shiki-code shiki-code').length }));
    assert.equal(early, 0, `another deferred module can hold DCL after Shiki is available; initial compensation must not wrap code before the official pass; final=${JSON.stringify(counts)}`);
    assert.deepEqual(counts, { hosts: 1, nested: 0 }, 'theme initial reconciliation must follow the official DCL pass');
  }, { official: true, holdBridge: false });
  console.log(`PASS ${passed} split Shiki loader scenarios (including delayed official 1.5.2 JAR resources)`);
} finally { await browser.close(); }
