import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Run the current function without booting PJAX/Halo or reading built assets.
// A real HTTP cache and native Chromium Image keep candidate selection, decode
// and cancellation observable; Playwright routing would disable that cache.
const source = await readFile(new URL('../src/shell/desktop-shell/runtime/desktop/pjax/index.js', import.meta.url), 'utf8');
const start = source.indexOf('function preloadPhotosDetailTransitionTarget(');
const end = source.indexOf('\nfunction resolvePhotosSharedTransition(', start);
assert.ok(start >= 0 && end > start, 'Locate the real preload function');
const constants = ['PHOTOS_DETAIL_STEP_KIND', 'PHOTOS_TRANSITION_IMAGE_TIMEOUT_MS']
  .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))?.[0]);
assert.ok(constants.every(Boolean), 'Use the current navigation protocol and timeout');
const script = `${constants.join('\n')}\n${source.slice(start, end)}\nwindow.preloadPhoto = preloadPhotosDetailTransitionTarget;`;
const requests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.test');
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>');
    return;
  }
  if (!url.pathname.startsWith('/images/')) {
    response.writeHead(404); response.end(); return;
  }
  const entry = { path: request.url, cancelled: false };
  requests.push(entry);
  response.on('close', () => { entry.cancelled = !response.writableFinished; });
  response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  if (url.pathname.includes('pending')) {
    // An unfinished body allows the test to observe actual request cancellation.
    response.write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">');
    return;
  }
  const width = url.searchParams.get('width') || 1600;
  response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="300"><rect width="100%" height="100%" fill="steelblue"/></svg>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scenario(name, action, { width = 1000, dpr = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(2000);
  try {
    await page.goto(origin);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => {
      window.preloads = [];
      window.Image = new Proxy(window.Image, {
        construct(NativeImage, args) {
          const image = Reflect.construct(NativeImage, args);
          window.preloads.push(image);
          return image;
        }
      });
      window.photoTarget = name => new DOMParser().parseFromString(
        `<figure><img src="/images/${name}.svg" srcset="/images/${name}.svg?width=400 400w, /images/${name}.svg?width=800 800w" sizes="(max-width: 600px) 400px, 800px"></figure>`,
        'text/html'
      ).querySelector('figure');
    });
    await action(page);
    assert.deepEqual(errors, [], 'No unhandled browser exceptions');
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(error);
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

try {
  for (const fixture of [
    { name: 'wide', width: 1000, dpr: 1, candidate: 800 },
    { name: 'narrow', width: 390, dpr: 1, candidate: 400 },
    { name: 'retina', width: 390, dpr: 2, candidate: 800 }
  ]) {
    await scenario(`${fixture.name}: preload and target consume one responsive candidate`, async page => {
      const result = await page.evaluate(async name => {
        const targetElement = window.photoTarget(name);
        const ready = await window.preloadPhoto({ kind: 'detail-step', targetElement });
        const preload = window.preloads[0];
        document.body.innerHTML = targetElement.outerHTML;
        const actual = document.querySelector('img');
        await actual.decode();
        await preload.decode();
        return { ready, preloadSrc: preload.currentSrc, actualSrc: actual.currentSrc, sourceIntact: preload.hasAttribute('src'), complete: preload.complete && preload.naturalWidth > 0 };
      }, fixture.name);
      const expected = `${origin}/images/${fixture.name}.svg?width=${fixture.candidate}`;
      assert.equal(result.ready, true, 'A decoded target is eligible for the transition');
      assert.equal(result.actualSrc, expected, 'The target selects the hand-checked responsive candidate');
      assert.equal(result.preloadSrc, result.actualSrc, 'Preload must use the same cache key as the inserted target');
      assert.equal(result.sourceIntact && result.complete, true, 'Successful preload remains decodable after settlement');
      assert.deepEqual(requests.filter(entry => entry.path.startsWith(`/images/${fixture.name}.svg`)).map(entry => entry.path), [`/images/${fixture.name}.svg?width=${fixture.candidate}`], 'Exactly one candidate request, with no original or duplicate transfer');
    }, fixture);
  }

  await scenario('plain src remains usable after success and a later abort', async page => {
    const result = await page.evaluate(async () => {
      const controller = new AbortController();
      const targetElement = new DOMParser().parseFromString('<figure><img src="/images/plain.svg"></figure>', 'text/html').querySelector('figure');
      const ready = await window.preloadPhoto({ kind: 'detail-step', targetElement }, { signal: controller.signal });
      controller.abort();
      const image = window.preloads[0];
      await image.decode();
      return { ready, currentSrc: image.currentSrc, complete: image.complete && image.naturalWidth > 0 };
    });
    assert.deepEqual(result, { ready: true, currentSrc: `${origin}/images/plain.svg`, complete: true });
    assert.equal(requests.filter(entry => entry.path === '/images/plain.svg').length, 1);
  });

  for (const cancellation of ['abort', 'timeout']) {
    await scenario(`${cancellation}: unfinished image sources and request are cancelled`, async page => {
      const name = `pending-${cancellation}`;
      await page.evaluate(({ name, cancellation }) => {
        window.controller = new AbortController();
        window.preloadStarted = performance.now();
        window.preloadResult = window.preloadPhoto({ kind: 'detail-step', targetElement: window.photoTarget(name) }, { signal: window.controller.signal })
          .then(ready => ({ ready, elapsed: performance.now() - window.preloadStarted }));
      }, { name, cancellation });
      await page.waitForFunction(() => window.preloads[0]?.currentSrc);
      if (cancellation === 'abort') await page.evaluate(() => window.controller.abort());
      const result = await page.evaluate(async () => ({ ...await window.preloadResult, src: window.preloads[0].getAttribute('src'), srcset: window.preloads[0].getAttribute('srcset') }));
      assert.equal(result.ready, false);
      assert.equal(result.src, null, 'Cancelled preload must release its fallback source');
      assert.equal(result.srcset, null, 'Cancelled preload must release its responsive sources');
      if (cancellation === 'timeout') assert.ok(result.elapsed >= 170 && result.elapsed < 450, `Navigation keeps its 200ms budget (observed ${result.elapsed.toFixed(1)}ms)`);
      const deadline = Date.now() + 1000;
      while (!requests.some(entry => entry.path.startsWith(`/images/${name}.svg`) && entry.cancelled) && Date.now() < deadline) await sleep(10);
      assert.equal(requests.some(entry => entry.path.startsWith(`/images/${name}.svg`) && entry.cancelled), true, 'Chromium cancels the unfinished network transfer');
      assert.equal(requests.filter(entry => entry.path.startsWith(`/images/${name}.svg`)).length, 1, 'Cleanup does not start a fallback/original request');
    });
  }

  await scenario('pre-aborted navigation never starts an image request', async page => {
    const result = await page.evaluate(async () => {
      const controller = new AbortController(); controller.abort();
      return { ready: await window.preloadPhoto({ kind: 'detail-step', targetElement: window.photoTarget('pre-aborted') }, { signal: controller.signal }), count: window.preloads.length };
    });
    assert.deepEqual(result, { ready: false, count: 0 });
    assert.equal(requests.some(entry => entry.path.includes('pre-aborted')), false);
  });
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
if (failures.length) throw new AggregateError(failures, `${failures.length} photos preload scenarios failed`);
console.log(`PASS photos preload: ${passed} native Chromium scenarios`);
