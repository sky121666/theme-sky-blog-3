import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Real image selection + native HTTP cache. Neither inspection nor a PJAX
// transition may start its own request, even when the original is stalled.
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const shell = await read('../src/shell/desktop-shell/runtime/desktop/pjax/index.js');
const photos = await read('../src/apps/photos/runtime/explorer.js');
const helpers = shell.slice(shell.indexOf('function findReadyPhotosPreview('), shell.indexOf('function resolvePhotosSharedTransition('))
  + photos.slice(photos.indexOf('function watchFilmstripThumbnails('), photos.indexOf('function clampGridColCount('));
assert.ok(helpers.includes('function attachReadyPhotosPreview(') && helpers.includes('function watchFilmstripThumbnails('));
assert.doesNotMatch(shell, /preloadPhotosDetailTransitionTarget|decodePhotosTransitionTarget|PHOTOS_TRANSITION_IMAGE_TIMEOUT_MS/);
const requests = [];
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body></body>'); return;
  }
  requests.push(req.url);
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public,max-age=3600' });
  if (req.url === '/pending.svg') { res.write('<svg xmlns="http://www.w3.org/2000/svg">'); return; }
  res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="steelblue"/></svg>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
try {
  for (const { name, width, dpr, candidate } of [
    { name:'wide', width:1000, dpr:1, candidate:800 }, { name:'narrow', width:390, dpr:1, candidate:400 },
    { name:'retina', width:390, dpr:2, candidate:800 }, { name:'single', width:390, dpr:1, candidate:0 },
  ]) {
    const page = await browser.newPage({ viewport:{ width, height:800 }, deviceScaleFactor:dpr });
    await page.goto(origin);
    await page.addScriptTag({ content: helpers });
    const result = await page.evaluate(async ({ name, candidate }) => {
      const responsive = candidate ? ' sizes="(max-width:600px) 400px,800px" srcset="/' + name + '-400.svg 400w, /' + name + '-800.svg 800w"' : '';
      document.body.innerHTML = '<a class="photo-card" data-photo-name="a"><img' + responsive + ' src="/' + name + '.svg"></a>';
      const image = document.querySelector('img');
      await image.decode();
      const ready = findReadyPhotosPreview(document.body, 'a');
      const candidateURL = image.currentSrc;
      // Replacing an element after navigation has started invalidates only the old DOM.
      document.body.innerHTML = '<figure class="photos-detail-figure" data-photo-name="a"><img class="photos-detail-image" src="/pending.svg"></figure>';
      attachReadyPhotosPreview(document.body, 'wrong-photo', ready);
      const ignored = !document.querySelector('.photos-detail-preview');
      attachReadyPhotosPreview(document.body, 'a', ready);
      return { ignored, same: ready === image && document.querySelector('.photos-detail-preview') === image,
        visible: image.complete && image.naturalWidth > 0 && image.currentSrc === candidateURL,
        url: image.currentSrc };
    }, { name,candidate });
    assert.equal(result.ignored && result.same && result.visible, true, name + ': reused loaded pixels, only for matching destination');
    const filename = '/' + name + (candidate ? '-' + candidate : '') + '.svg';
    assert.equal(result.url, origin + filename);
    assert.deepEqual(requests.filter(url => url.startsWith('/' + name)), [filename], name + ': one transfer; no speculative original');
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(origin); await page.addScriptTag({ content: helpers });
  const rejected = await page.evaluate(async () => {
    document.body.innerHTML = '<a class="photos-detail-neighbor" data-photo-name="a"><img src="/pending.svg"></a>';
    const start = performance.now();
    const cold = findReadyPhotosPreview(document.body, 'a');
    const elapsed = performance.now() - start;
    const image = document.querySelector('img');
    image.src = '/transparent.svg'; await image.decode();
    const transparent = findReadyPhotosPreview(document.body, 'a');
    image.src = '/thumb.svg'; await image.decode(); image.dataset.srcset = '/real.svg 400w';
    return { cold: cold === null, elapsed, transparent: transparent === null, pending: findReadyPhotosPreview(document.body, 'a') === null };
  });
  assert.ok(rejected.cold && rejected.transparent && rejected.pending && rejected.elapsed < 50, JSON.stringify(rejected));
  assert.ok(!requests.includes('/real.svg'), 'Pending candidate is not promoted for the transition');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="strip" style="width:180px;height:72px;display:flex;overflow:auto">' +
      Array.from({length:24}, (_,i) => '<img style="flex:0 0 60px;height:60px" data-photos-thumb="/strip-' + i + '.svg">').join('') + '</div>';
    window.stopStrip = watchFilmstripThumbnails(document.getElementById('strip'));
  });
  await page.waitForFunction(() => document.querySelector('#strip img')?.naturalWidth > 0);
  assert.ok(!requests.includes('/strip-23.svg'), 'Distant thumbnail must stay unscheduled');
  await page.evaluate(() => { document.getElementById('strip').scrollLeft = 2000; });
  await page.waitForFunction(() => document.querySelector('#strip img:last-child').naturalWidth > 0);
  assert.ok(!requests.includes('/strip-12.svg'), 'Scrolling across the strip must not load skipped items');
  await page.evaluate(() => { window.stopStrip(); document.getElementById('strip').scrollLeft = 710; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(!requests.includes('/strip-12.svg'), 'Destroyed observer must stop scheduling media');
  console.log('PASS: native Chromium checks ready responsive/single images, cold/placeholder/late results, and horizontal demand loading.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
