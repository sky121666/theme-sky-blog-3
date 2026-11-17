// Public Halo documents + normal PJAX, with only two genuine detail-image
// requests held/released by Playwright. No site data or settings are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';
import { verificationOutput } from './lib/verification-output.mjs';

const base = process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
process.env.VERIFICATION_OUTPUT_DIR ||= 'output/window-delivery-20261117/photos';
// A second change may be in progress locally while the reviewer explicitly
// measures an already-built candidate. Pin its remote/local bytes, without
// claiming the current worktree was used or weakening the default check.
async function pinnedCandidate(revision) {
  const local = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
  assert.equal(local.__meta.revision, revision);
  const prefix = local['shell-core'].js[0].split('/assets/')[0] + '/assets/';
  const remote = await fetch(new URL(prefix + 'asset-manifest.json', origin), { cache:'no-store' }).then(r=>r.json());
  assert.deepEqual(remote.__meta, local.__meta);
  const bytes = [];
  const paths = [...local.photos.js, ...local.photos.css, ...local['shell-core'].js, ...local['shell-core'].css,
    prefix+'js/chunks/apps/photos/explorer.js'];
  for (const path of paths) {
    const response = await fetch(new URL(path+'?'+local.__meta.query, origin), {cache:'no-store'});
    assert.equal(response.status, 200);
    const digest = value => createHash('sha256').update(value).digest('hex');
    const hash = digest(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, digest(await fs.readFile('templates/assets/'+path.slice(prefix.length))));
    bytes.push({ path, sha256:hash });
  }
  return { build:local.__meta, verifiedAssets:bytes, scope:'pinned served build; current worktree may be newer' };
}
const identity = process.env.PHOTOS_CANDIDATE_REVISION ? await pinnedCandidate(process.env.PHOTOS_CANDIDATE_REVISION) : await readLiveBuildContext(base);
const dir = await verificationOutput('photos-switch-live', { servedRevision:identity.build.revision });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control':'no-cache' } });
const blockedWrites = [];
await installReadOnlyGuard(context, blockedWrites);
// Exercise the preload plugin's actual Save-Data opt-out. Only click/keyboard
// navigation should issue HTML, so each responseEnd belongs to a foreground GET.
await context.addInitScript(() => {
  Object.defineProperty(navigator.connection, 'saveData', { configurable:true, value:true });
  performance.setResourceTimingBufferSize(4096);
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const samples = [], waits = [], checkpoints = [];
const quantile75 = arr => [...arr].sort((a,b) => a-b)[Math.ceil(arr.length * .75) - 1];
const held = new Map(), requestStarted = new Map();
const makeImage = (route, outcome) => outcome === 'fail' ? route.abort('failed') : route.fulfill({
  status: 200, contentType: 'image/svg+xml', headers: { 'Cache-Control':'no-store' },
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="steelblue"/></svg>'
});
async function release(src, outcome = 'ok') {
  const route = held.get(src);
  if (!route) return;
  held.delete(src);
  await makeImage(route, outcome);
}
async function waitHeld(src) {
  const deadline = Date.now() + 5000;
  while (!held.has(src) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(held.has(src), 'A real, distinct original image must still be pending: ' + src);
}
const waitReady = () => page.waitForFunction(() => !document.documentElement.hasAttribute('data-photos-view-transition-owner')
  && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'));
const mediaState = () => page.locator('.photos-detail-stage').evaluate(stage => {
    const read = image => {
      if (!image) return null;
      const box = image.getBoundingClientRect();
      return { src:image.currentSrc || image.src, complete:image.complete, naturalWidth:image.naturalWidth,
        naturalHeight:image.naturalHeight, renderedWidth:box.width, renderedHeight:box.height,
        centerX:box.x+box.width/2, centerY:box.y+box.height/2,
        scale:new DOMMatrixReadOnly(getComputedStyle(image).transform).a,
        transform:getComputedStyle(image).transform, visible:getComputedStyle(image).opacity !== '0' };
    };
    return { original:read(stage.querySelector('.photos-detail-image')), preview:read(stage.querySelector('.photos-detail-preview')),
      zoom:document.querySelector('[data-photos-zoom-label]')?.textContent.trim() };
  });
async function zoomAndDragPreview() {
  const initial = await mediaState();
  const input = page.locator('[data-photos-detail-zoom]');
  await input.focus(); await input.press('End');
  await page.waitForFunction(() => Number.parseInt(document.querySelector('[data-photos-zoom-label]').textContent) >= 200
    && new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.photos-detail-preview')).transform).a > 2.1);
  const zoomed = await mediaState();
  const stage = await page.locator('.photos-detail-stage').boundingBox();
  const x=stage.x+stage.width/2, y=stage.y+stage.height/2;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+35,y+40,{steps:5}); await page.mouse.up();
  const dragged = await mediaState();
  assert.ok(Math.abs(dragged.preview.centerX-zoomed.preview.centerX)>5
    || Math.abs(dragged.preview.centerY-zoomed.preview.centerY)>5, 'The actual visible preview must move on at least one pannable axis');
  return { initial, zoomed, dragged };
}
try {
  await page.goto(origin + '/photos', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.pjax && document.querySelectorAll('.photo-card[data-photo-name]').length >= 2);
  const photos = await page.locator('.photo-card[data-photo-name]').evaluateAll(async nodes => {
    const result = [];
    for (const node of nodes.slice(0, 3)) {
      const response = await fetch(node.href, { headers: { Accept:'text/html', 'Cache-Control':'no-cache' } });
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const img = doc.querySelector('.photos-detail-image');
      if (!doc.querySelector('[data-photos-detail-loading]') || !doc.querySelector('[data-photos-thumb]')) throw Error('Stale public detail HTML: candidate template missing');
      if (!response.ok || !img?.getAttribute('src')) throw Error('Missing actual detail image');
      result.push({ href:node.href, name:node.dataset.photoName, src:new URL(img.getAttribute('src'), node.href).href });
    }
    return result;
  });
  assert.ok(photos[0].src !== photos[1].src, 'Need two different real source URLs');
  const targetURLs = new Set(photos.map(p => p.src));
  await context.route(url => targetURLs.has(url.href), route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    assert.ok(!held.has(route.request().url()), 'Only one primary image request may be active per target');
    held.set(route.request().url(), route);
    requestStarted.set(route.request().url(), performance.now());
  });
  await page.evaluate(() => {
    window.__photoSwaps = [];
    document.addEventListener('theme:content-swapped', () => {
      const fig = document.querySelector('.photos-detail-figure');
      if (!fig || !window.__photoAction) return;
      const now = performance.now(), marks = label => performance.getEntriesByName('pjax:' + label).at(-1)?.startTime;
      const { href, actionStart } = window.__photoAction;
      const entries = performance.getEntriesByName(href, 'resource').filter(r =>
        r.initiatorType === 'fetch' && r.startTime >= actionStart && r.responseEnd <= now);
      const resource = entries.length === 1 ? entries[0] : null;
      window.__photoSwaps.push({ name:fig.dataset.photoName, href, actionStart, swap:now, matched:entries.length,
        resourceStart:resource?.startTime, responseEnd:resource?.responseEnd,
        encodedBodySize:resource?.encodedBodySize, responseEndToSwapMs:resource ? now-resource.responseEnd : null,
        contentReadyToSwapMs:now-marks('contentReady'),
        navigationStartToSwapMs:now-marks('navStart'), preview:!!fig.querySelector('.photos-detail-preview')?.naturalWidth,
        originalPending:!fig.querySelector('.photos-detail-image').complete });
    });
  });
  let previous = null;
  for (let i=0; i<21; i++) {
    const target = photos[i%2];
    await page.evaluate(() => { document.body.dataset.debug = 'true'; });
    await waitReady();
    const link = page.locator((i ? '.photos-detail-neighbor' : '.photo-card') + '[data-photo-name="' + target.name + '"]');
    await page.waitForFunction(({ name, fromList }) => {
      const selector = fromList ? '.photo-card' : '.photos-detail-neighbor';
      const img = document.querySelector(selector + '[data-photo-name="' + name + '"] img');
      return img?.complete && img.naturalWidth > 0 && !img.dataset.src && !img.dataset.srcset;
    }, { name:target.name, fromList:i===0 });
    await page.evaluate(href => { window.__photoAction = { href, actionStart:performance.now() }; }, target.href);
    if (!i) { await link.click(); }
    else if (i%3 === 0) {
      await page.locator('.photos-detail-main').hover({position:{x:20,y:20}});
      await link.click();
    } else {
      const rel = i%2 ? 'next' : 'prev';
      const control = page.locator('.photos-detail-adjacent-btn[rel="' + rel + '"]');
      assert.equal(new URL(await control.getAttribute('href'), origin).href, target.href, 'Adjacent real sample order');
      if (i%3 === 1) await control.click();
      else { await page.locator('.photos-detail-stage').focus(); await page.keyboard.press(rel==='next'?'ArrowRight':'ArrowLeft'); }
    }
    await page.waitForFunction(({ name, count }) => window.__photoSwaps.length === count
      && window.__photoSwaps.at(-1).name === name && window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === 'photos',
    { name:target.name, count:i+1 });
    await waitHeld(target.src);
    const snapshot = await page.evaluate(() => window.__photoSwaps.at(-1));
    assert.equal(snapshot.matched, 1, 'Each DOM exchange must match exactly one real target GET after input: ' + JSON.stringify(snapshot));
    assert.ok(snapshot.encodedBodySize > 0, 'Destination must actually transfer HTML');
    assert.ok(snapshot.preview && snapshot.originalPending, 'Each exchange must expose the right loaded thumbnail while its original is held');
    assert.ok(Number.isFinite(snapshot.contentReadyToSwapMs) && snapshot.contentReadyToSwapMs >= 0, 'Current navigation timing marks required');
    if (i) samples.push(snapshot);
    else checkpoints.push({ listToDetail:snapshot });
    if (previous) {
      await release(previous.src, 'fail');
      const stillCurrent = await page.locator('.photos-detail-figure').getAttribute('data-photo-name');
      assert.equal(stillCurrent, target.name, 'Late old response cannot replace the current photo');
    }
    previous = target;
  }

  await waitReady();
  const upgradeView = await zoomAndDragPreview();
  await release(previous.src, 'fail');
  await page.locator('.photos-detail-image-error button').waitFor({state:'visible'});
  assert.ok(await page.locator('.photos-detail-preview').evaluate(img => img.naturalWidth > 0), 'Error preserves available preview');
  await page.locator('.photos-detail-image-error button').click();
  await waitHeld(previous.src);
  // For this upgrade use the actual upstream bytes (never a synthetic SVG).
  const retryRoute = held.get(previous.src);
  const upstream = await retryRoute.fetch();
  assert.ok(upstream.ok() && upstream.headers()['content-type']?.startsWith('image/'));
  const bytes = await upstream.body();
  held.delete(previous.src);
  await retryRoute.fulfill({ response:upstream });
  await page.waitForFunction(() => !document.querySelector('.photos-detail-preview') && document.querySelector('.photos-detail-image').naturalWidth > 0
    && document.querySelector('.photos-detail-image-error').hidden);
  const decoded = await page.locator('.photos-detail-image').evaluate(async image => {
    const start = performance.now(); await image.decode();
    return { src:image.currentSrc, naturalWidth:image.naturalWidth, naturalHeight:image.naturalHeight,
      decodeCheckMs:performance.now()-start, alreadyDisplayed:true };
  });
  assert.equal(decoded.src, previous.src);
  const clearView = await mediaState();
  assert.equal(clearView.zoom, upgradeView.dragged.zoom, 'Displayed zoom must survive error/retry/decode');
  assert.equal(clearView.original.scale, upgradeView.dragged.preview.scale, 'Scale must survive preview upgrade');
  assert.ok(Math.abs(clearView.original.centerX-upgradeView.dragged.preview.centerX)<3
    && Math.abs(clearView.original.centerY-upgradeView.dragged.preview.centerY)<3, 'Center must survive upgrade with equivalent bounds');
  checkpoints.push({ retry:'failed original → real upstream bytes → displayed original, preview removed',
    contentType:upstream.headers()['content-type'], bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), decoded, upgradeView, clearView });
  await upstream.dispose();
  // Supersede B before its actual document is delivered, then traverse browser
  // history while C's original is still in flight. Neither late response owns A.
  await page.evaluate(() => { window.__photoAction = null; });
  await waitReady();
  const [a, b, c] = photos;
  let heldDocument = null;
  const holdB = route => {
    if (route.request().resourceType() !== 'fetch') return route.fallback();
    heldDocument = route;
  };
  await page.route(b.href, holdB);
  async function clickNeighbor(target) {
    await page.locator('.photos-detail-main').hover({position:{x:20,y:20}});
    await page.locator('.photos-detail-neighbor[data-photo-name="' + target.name + '"]').click();
  }
  await clickNeighbor(b);
  const deadline = Date.now() + 3000;
  while (!heldDocument && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(heldDocument, 'First click must be a real in-flight document');
  await clickNeighbor(c);
  await page.waitForFunction(name => document.querySelector('.photos-detail-figure')?.dataset.photoName === name, c.name);
  await waitHeld(c.src); await waitReady();
  // This interval starts at interception of the actual original-image request,
  // never at click, preload, timeout creation, or DOM readiness.
  const observedAt = requestStarted.get(c.src);
  const before = await mediaState();
  assert.ok(!before.original.complete && before.original.naturalWidth === 0 && before.preview?.naturalWidth > 0 && before.preview.visible);
  const info = page.locator('[data-photos-detail-info-btn]');
  await info.click();
  await page.locator('#photos-detail-info-panel').waitFor({state:'visible'});
  assert.equal(await info.getAttribute('aria-expanded'), 'true');
  const infoMs = performance.now() - observedAt;
  await page.locator('#photos-detail-info-panel button').click();
  await page.locator('#photos-detail-info-panel').waitFor({state:'hidden'});
  const { zoomed:afterZoom, dragged } = await zoomAndDragPreview();
  const zoomMs = performance.now() - observedAt;
  // Keep the actual resource suspended for >= 2 s even on a fast local system.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 2050 - (performance.now()-observedAt))));
  const heldAtBackMs = performance.now() - observedAt;
  const beforeBack = await mediaState();
  const previewZoomed = beforeBack.preview?.renderedWidth > before.preview.renderedWidth * 1.03
    || beforeBack.preview?.renderedHeight > before.preview.renderedHeight * 1.03;
  assert.ok(held.has(c.src) && heldAtBackMs >= 2000 && !beforeBack.original.complete);
  checkpoints.push({ slowOriginal:c.src, heldAtBackMs, infoPanelOpenedAndClosedMs:infoMs,
    zoomStateUpdatedMs:zoomMs, previewZoomed, before, afterZoom, dragged, beforeBack });
  // The superseded transport may already be aborted by the browser.
  await heldDocument.continue().catch(error => { if (!/aborted|handled|closed|canceled/i.test(error.message)) throw error; });
  await page.unroute(b.href, holdB);
  await page.evaluate(() => history.back());
  await page.waitForFunction(name => document.querySelector('.photos-detail-figure')?.dataset.photoName === name, a.name);
  const heldAtRestoredViewMs = performance.now()-observedAt;
  assert.ok(held.has(c.src) && heldAtRestoredViewMs >= 2000);
  await release(c.src); await waitReady();
  const restored = await page.evaluate(() => ({ href:location.href, name:document.querySelector('.photos-detail-figure')?.dataset.photoName,
    selected:document.querySelector('.photos-detail-neighbor[aria-current="true"]')?.dataset.photoName }));
  assert.deepEqual(restored, { href:a.href, name:a.name, selected:a.name });
  checkpoints.push({ rapidClicks:'B held before response, C won; browser Back restored A while original C was pending', heldAtRestoredViewMs, restored });
  assert.deepEqual(errors, []);
  assert.deepEqual(blockedWrites, []);
  const p75 = quantile75(samples.map(x=>x.responseEndToSwapMs));
  waits.push({metric:'actual foreground target HTML resource.responseEnd → live content-swapped event (same browser clock, exact URL, one GET)', samples:samples.length, p75Ms:p75,
    contentReadyToSwapP75Ms:quantile75(samples.map(x=>x.contentReadyToSwapMs)), navigationStartToSwapP75Ms:quantile75(samples.map(x=>x.navigationStartToSwapMs))});
  assert.equal(samples.length,20);
  assert.ok(previewZoomed, 'Zoom changed its control value but did not visibly enlarge the held preview; see slowOriginal checkpoint');
  assert.ok(p75<=50, '20 detail swaps: P75 ' + p75.toFixed(1) + ' ms exceeds 50 ms');
  console.log('PASS: 20 controlled original-image holds; target HTML responseEnd→swap P75 ' + p75.toFixed(1) + ' ms; separate navigationStart→swap P75 ' + waits[0].navigationStartToSwapP75Ms.toFixed(1) + ' ms.');
} finally {
  await fs.writeFile(dir + '/result.json', JSON.stringify({ build:identity.build, verifiedAssets:identity.verifiedAssets, identityScope:identity.scope || identity.verificationScope, samples, waits, checkpoints, errors, blockedWrites }, null,2));
  await context.close(); await browser.close();
}
