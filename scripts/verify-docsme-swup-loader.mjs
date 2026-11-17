import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { verificationOutput } from './lib/verification-output.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await verificationOutput('docsme-loader');
const loader = await readFile(path.join(root, 'src/shared/docs-swup-loader.js'), 'utf8');
const validator = await readFile(path.join(root, 'src/shared/docs-html.js'), 'utf8');
const htmlPolicy = await readFile(path.join(root, 'src/shared/html-document.js'), 'utf8');
const responsePolicy = await readFile(path.join(root, 'src/shared/navigation-response.js'), 'utf8');
const origin = 'https://docs-swup-loader.test';
const target = origin + '/docs/next';
const docHtml = '<!doctype html><html><head><title>Doc</title></head><body data-app-id="docsme" data-window-variant="docsme" data-page-mode="browser-docsme"><main id="window-frame-root"><div data-window-content-root><div data-window-content-variant="docsme"><article data-app-root="docsme"><main class="docsme-main">native-fallback</main></article></div></div></main></body></html>';
// Execute the unchanged production ESM loader. Fault injection is confined to
// its imported adapter: initialization can fail independently of an ordinary
// page request. Native fallback and adapter page requests use genuine Fetch.
const adapter = `
  export function initializeDocsSwup() {
    if (window.__fixtureBootFails) throw new Error('fixture adapter initialization failed');
  }
  export async function fetchDocsPage(url, options) {
    initializeDocsSwup();
    if (window.__fixtureAdapterPageFetch) return fetch(url, options);
    return new Response('adapter-ready', { headers: { 'Content-Type': 'text/html' } });
  }
`;
const browser = await chromium.launch({ headless: true });
const results = [];

async function fixture(name, run, { failNativeRequest = false, delay = 0, body = docHtml } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], requests = [], warnings = [];
  const result = { name };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, 'The loader fixture cannot access a real website');
    assert.equal(request.method(), 'GET', 'The loader fixture cannot write business data');
    if (url.pathname === '/loader.js') return route.fulfill({ contentType: 'text/javascript', body: loader });
    if (url.pathname === '/docs-html.js') return route.fulfill({ contentType: 'text/javascript', body: validator });
    if (url.pathname === '/html-document.js') return route.fulfill({ contentType: 'text/javascript', body: htmlPolicy });
    if (url.pathname === '/navigation-response.js') return route.fulfill({ contentType: 'text/javascript', body: responsePolicy });
    if (url.pathname === '/docs-swup.js') return route.fulfill({ contentType: 'text/javascript', body: adapter });
    if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Loader fixture</title><main>source document</main>' });
    assert.equal(url.pathname, '/docs/next');
    requests.push({ url: url.href, method: request.method(), headers: await request.allHeaders(), navigation: request.isNavigationRequest() });
    if (failNativeRequest) return route.abort('connectionfailed');
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill({ contentType: 'text/html', body }).catch(error => {
      if (!/closed|disposed|handled|cancelled/i.test(error.message)) throw error;
    });
  });
  try {
    await page.goto(origin + '/fixture');
    await page.evaluate(async () => { window.__loader = await import('/loader.js'); });
    await run({ page, result, requests });
    assert.deepEqual(errors, [], 'All bootstrap and page failures must settle without unhandled browser errors');
    assert.equal(requests.some(request => request.navigation), false, 'Fallback must fetch HTML without navigating the original document');
    result.passed = true;
    console.log(`PASS ${name}`);
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    result.requests = requests;
    result.errors = errors;
    result.warnings = warnings;
    results.push(result);
    await context.close();
  }
}

try {
  await fixture('native fallback rejects a 200 stream cut after its visible app', async ({ page, requests }) => {
    await page.evaluate(() => { __fixtureBootFails = true; });
    await assert.rejects(page.evaluate(async url => (await __loader.fetchDocsPage(url)).text(), target), /Incomplete Docsme response/);
    assert.equal(requests.length, 1);
  }, { body: docHtml.slice(0, docHtml.indexOf('</article>')) });
  await fixture('adapter initialization failure falls back to native fetch and preserves request headers', async ({ page, result, requests }) => {
    result.actual = await page.evaluate(async target => {
      __fixtureBootFails = true;
      try {
        const response = await __loader.fetchDocsPage(target, { headers: { 'X-Fixture-Header': 'forwarded' }, credentials: 'same-origin' });
        return { status: response.status, body: await response.text(), href: location.href };
      } catch (error) { return { error: error.name, message: error.message }; }
    }, target);
    assert.equal(result.actual.body, docHtml, 'An adapter boot error must use the original HTML Fetch path');
    assert.equal(result.actual.status, 200);
    assert.equal(requests.length, 1, 'Bootstrap failure must produce exactly one foreground HTML request');
    assert.equal(requests[0].headers['x-fixture-header'], 'forwarded', 'Fallback must preserve caller headers');
    assert.equal(requests[0].headers['x-requested-with'], 'XMLHttpRequest', 'Fallback must retain the theme HTML request marker');
    assert.equal(result.actual.href, origin + '/fixture');
  });

  await fixture('native fallback retains the caller abort signal', async ({ page, result, requests }) => {
    result.actual = await page.evaluate(async target => {
      __fixtureBootFails = true;
      const controller = new AbortController();
      const pending = __loader.fetchDocsPage(target, { signal: controller.signal })
        .then(response => ({ resolved: true, status: response.status }), error => ({ resolved: false, name: error.name }));
      setTimeout(() => controller.abort(), 50);
      return pending;
    }, target);
    assert.equal(requests.length, 1, 'The caller must abort a real foreground fallback request');
    assert.deepEqual(result.actual, { resolved: false, name: 'AbortError' }, 'Abort must reach genuine native Fetch instead of being lost during fallback');
  }, { delay: 250 });

  await fixture('failed adapter bootstrap can recover on a later page request', async ({ page, result, requests }) => {
    result.actual = await page.evaluate(async target => {
      __fixtureBootFails = true;
      __loader.initializeDocsSwup();
      await new Promise(resolve => setTimeout(resolve, 30));
      const first = await __loader.fetchDocsPage(target).then(async response => await response.text(), error => ({ error: error.message }));
      __fixtureBootFails = false;
      const second = await __loader.fetchDocsPage(target).then(async response => await response.text(), error => ({ error: error.message }));
      return { first, second };
    }, target);
    assert.deepEqual(result.actual, { first: docHtml, second: 'adapter-ready' }, 'A rejected bootstrap must not poison the loader after the adapter becomes available');
    assert.equal(requests.length, 1, 'Only the failed bootstrap request should need native fallback');
  });

  await fixture('a malformed 200 during native fallback cannot replace the current window', async ({ page, requests }) => {
    await page.evaluate(() => { __fixtureBootFails = true; });
    await assert.rejects(page.evaluate(async url => (await __loader.fetchDocsPage(url)).text(), target), /Incomplete Docsme response/);
    assert.equal(requests.length, 1);
  }, { body: docHtml.replace('</body>', '<section id="window-frame-root"></section></body>') });

  await fixture('an ordinary page request failure is returned without a duplicate native request', async ({ page, result, requests }) => {
    result.actual = await page.evaluate(async target => {
      __fixtureBootFails = false;
      __fixtureAdapterPageFetch = true;
      __loader.initializeDocsSwup();
      await new Promise(resolve => setTimeout(resolve, 30));
      return __loader.fetchDocsPage(target).then(response => ({ resolved: true, status: response.status }), error => ({ resolved: false, name: error.name }));
    }, target);
    assert.deepEqual(result.actual, { resolved: false, name: 'TypeError' });
    assert.equal(requests.length, 1, 'A page transport failure after successful bootstrap must not be sent a second time');
  }, { failNativeRequest: true });
} finally {
  await browser.close();
  const passed = results.every(result => result.passed);
  await writeFile(path.join(output, `docsme-swup-loader-${passed ? 'green' : 'red'}.json`), JSON.stringify({ observedAt: new Date().toISOString(), method: 'Actual production ESM loader in isolated Chromium; imported adapter fault injection only; real HTTP and native Fetch', results }, null, 2) + '\n');
  console.log(`${results.filter(result => result.passed).length}/${results.length} Docsme loader scenarios passed`);
  if (!passed) process.exitCode = 1;
}
