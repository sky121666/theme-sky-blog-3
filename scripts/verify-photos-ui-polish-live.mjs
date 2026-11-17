// Shared build + Halo reload verification. No interception, fixture injection,
// server mutation or comment submission; all interactions target actual 8090 UI.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { collectBrowserRuntimeErrors, installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';
import { verificationOutput } from './lib/verification-output.mjs';
const base = process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090';
const origin = new URL(base).origin;
const widths = (process.env.UI_VERIFY_WIDTHS || '1440,390,320').split(',').map(Number);
assert.ok(widths.length && widths.every(width => Number.isInteger(width) && width >= 320), 'UI_VERIFY_WIDTHS requires widths >= 320');
const dir = await verificationOutput('photos-ui-polish-live');
const identity = await readLiveBuildContext(base);
const browser = await chromium.launch({ headless: true });
const results = [];
class SampleMissing extends Error {}
function key(value) { const url = new URL(value, base); url.hash = ''; url.searchParams.sort(); return url.href; }
const waitView = (page, view) => page.waitForFunction(view =>
  document.querySelector('.photos-shell')?.dataset.photosView === view
  && !document.documentElement.classList.contains('is-animating')
  && !document.documentElement.hasAttribute('data-photos-view-transition-owner')
  && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'), view);
const waitPhoto = (page, name) => page.waitForFunction(name =>
  document.querySelector('.photos-detail-figure')?.dataset.photoName === name
  && !document.documentElement.hasAttribute('data-photos-view-transition-owner')
  && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'), name);
function listContext(value) {
  const url = new URL(value);
  return {
    origin: url.origin, pathname: url.pathname,
    group: url.searchParams.get('group') || '',
    page: Number(url.searchParams.get('page') || 1),
    size: Number(url.searchParams.get('size') || 20)
  };
}
try {
  for (const width of widths) {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 960 }, hasTouch: mobile, isMobile: mobile });
    const blockedWrites = [];
    await installReadOnlyGuard(context, blockedWrites);
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__photosAcceptanceVisits = [];
      document.addEventListener('theme:navigation-accepted', ({ detail }) => {
        const url = new URL(detail.url, location.href);
        url.hash = '';
        url.searchParams.sort();
        window.__photosAcceptanceVisits.push({ url: url.href, acceptedAt: performance.timeOrigin + performance.now() });
      });
    });
    page.setDefaultTimeout(12000);
    const runtime = collectBrowserRuntimeErrors(page);
    const errors = [], checkpoints = [], getRequests = [], consumedReads = new Map();
    const requestRecords = [];
    page.on('request', request => {
      if (request.method() === 'GET') {
        getRequests.push(key(request.url()));
        requestRecords.push(request);
      }
    });
    const exactlyOneGet = async (url, label) => {
      const target = key(url);
      const navigation = await page.evaluate(target =>
        window.__photosAcceptanceVisits.findLast(visit => visit.url === target), target);
      assert.ok(navigation, `${label}: the real navigation acceptance event must be observed`);
      const requests = requestRecords.filter(request => key(request.url()) === target);
      const reads = await Promise.all(requests.slice(consumedReads.get(target) || 0).map(async request => {
        const response = await request.response();
        const timing = request.timing();
        return { startedAt: timing.startTime,
          finishedAt: timing.responseEnd >= 0 ? timing.startTime + timing.responseEnd : null,
          cacheControl: response?.headers()['cache-control'] || '' };
      }));
      // Keyboard focus can finish a no-store prefetch before Enter. It cannot
      // supply that later navigation; retain it as evidence, not as a duplicate
      // foreground GET. In-flight adoption and cacheable prefetch still count.
      const completedNoStoreReads = reads.filter(read => read.finishedAt !== null
        && read.finishedAt <= navigation.acceptedAt && /(?:^|,)\s*no-store\s*(?:,|$)/i.test(read.cacheControl));
      const actionReads = reads.filter(read => !completedNoStoreReads.includes(read));
      assert.equal(actionReads.length, 1, `${label}: each navigation must consume exactly one destination GET or eligible prefetch`);
      consumedReads.set(target, requests.length);
      checkpoints.push({ action: label, url: target, getCount: actionReads.length,
        totalVisits: requests.length, acceptedAt: navigation.acceptedAt, completedNoStoreReads, actionReads });
    };
    let phase = 'library';
    page.on('pageerror', error => errors.push(error.message));
    const activate = locator => mobile ? locator.tap() : locator.click();
    try {
      await page.goto(`${base}/photos`);
      await waitView(page, 'library');
      await activate(page.locator('a[href="/photos?view=albums"]'));
      await waitView(page, 'albums');
      await page.screenshot({ path: `${dir}/photos-live-albums-${width}.png` });
      phase = 'album to group';
      const albums = await page.locator('.photos-album-card').evaluateAll((nodes, configured) => nodes.map((node, index) => ({
        index, href: node.href, count: Number.parseInt(node.querySelector('.photos-album-overlay-count')?.textContent || '0', 10)
      })).filter(album => configured ? album.href === new URL(configured, location.href).href : album.count >= 2), process.env.PHOTOS_GROUP_URL || '');
      if (!albums.length) throw new SampleMissing(process.env.PHOTOS_GROUP_URL
        ? 'PHOTOS_GROUP_URL is not a public album on this site' : 'No public album with two photos is available for adjacent-photo coverage');
      await activate(page.locator('.photos-album-card').nth(albums[0].index));
      await waitView(page, 'group');
      const groupUrl = page.url();
      const firstCard = page.locator('.photo-card').first();
      const selectedName = await firstCard.getAttribute('data-photo-name');
      if (!selectedName) throw new SampleMissing('The selected public album contains no photo cards');
      const selectedHref = await firstCard.getAttribute('href');
      phase = mobile ? 'touch photo opening' : 'keyboard photo opening';
      if (mobile) {
        assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
        // A touch visitor opens the photo directly; hover/focus-visible copy is
        // intentionally not required by the mobile interaction contract.
        await firstCard.tap();
        checkpoints.push({ action: 'tap first photo', photo: selectedName });
      } else {
        // Traverse native Tab order, then require the actual keyboard name cue.
        let tabs = 0;
        const tabBudget = await page.evaluate(() => [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
          .filter(node => node.tabIndex >= 0 && !node.disabled && !node.closest('[inert]') && node.getClientRects().length).length + 2);
        const focusTrail = [];
        while (!await firstCard.evaluate(node => node === document.activeElement) && tabs < tabBudget) {
          await page.keyboard.press('Tab'); tabs++;
          focusTrail.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName,
            className: document.activeElement?.className, photo: document.activeElement?.dataset?.photoName || '' })));
        }
        checkpoints.push({ action: 'native Tab traversal', tabs, tabBudget, focusTrail });
        assert.equal(await firstCard.evaluate(node => node === document.activeElement), true, 'First photo is reachable in native Tab order');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.photo-card .photo-card-overlay')).opacity === '1');
        await page.keyboard.press('Enter');
        checkpoints.push({ action: 'Tab then Enter first photo', tabs, photo: selectedName });
      }
      await waitView(page, 'detail');
      await page.locator('[data-photos-zoom-label]').waitFor();
      await waitPhoto(page, selectedName);
      assert.equal(await page.locator('.photos-detail-figure').getAttribute('data-photo-name'), selectedName);
      const detailUrl = page.url();
      await exactlyOneGet(selectedHref, 'open original photo');
      phase = 'zoom';
      await activate(page.locator('[data-photos-control="zoom-in"]'));
      assert.equal(await page.locator('[data-photos-zoom-label]').textContent(), '110%');
      await activate(page.locator('[data-photos-control="zoom-reset"]'));
      assert.equal(await page.locator('[data-photos-zoom-label]').textContent(), '100%');
      checkpoints.push({ action: 'zoom in and fit to window', label: '100%' });
      phase = 'info';
      await activate(page.locator('[data-photos-control="info-toggle"]'));
      await activate(page.locator('[aria-label="关闭图片详情"]'));
      assert.equal(await page.locator('[data-photos-detail-info-btn]').evaluate(node => document.activeElement === node), true);
      checkpoints.push({ action: 'info open/close', focusRestored: true });
      phase = 'comments';
      await activate(page.locator('[data-photos-control="comments-toggle"]'));
      await page.waitForFunction(() => document.querySelector('[data-photos-detail-comments-btn]')?.getAttribute('aria-expanded') === 'true');
      await page.locator('.photos-detail-comment-drawer').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const panel = document.querySelector('.photos-detail-comment-drawer');
        const drawer = panel?.getBoundingClientRect();
        const shell = document.querySelector('.photos-shell')?.getBoundingClientRect();
        return drawer && shell && drawer.width >= 200 && drawer.height > 0
          && !panel.classList.contains('photos-drawer-enter')
          && getComputedStyle(panel).opacity === '1'
          && Math.abs(drawer.y - shell.y) < 2 && drawer.bottom <= shell.bottom + 2
          && drawer.left >= shell.left - 2 && drawer.right <= shell.right + 2;
      });
      // A one-pixel entering panel is already "visible" to Playwright. Verify
      // the actual editor after both its lazy initialization and motion finish.
      const editor = page.locator('.photos-detail-comment-drawer comment-form [contenteditable="true"]');
      await editor.waitFor({ state: 'visible' });
      const drawer = await page.locator('.photos-detail-comment-drawer').boundingBox();
      const shell = await page.locator('.photos-shell').boundingBox();
      assert.ok(Math.abs(drawer.y - shell.y) < 2 && drawer.y + drawer.height <= shell.y + shell.height + 2, 'Comment drawer stays in content region');
      const editorBox = await editor.boundingBox();
      assert.ok(editorBox.width > 100 && editorBox.height > 0
        && editorBox.x >= drawer.x && editorBox.x + editorBox.width <= drawer.x + drawer.width + 2,
      `The initialized comment editor fits inside the settled drawer: ${JSON.stringify({ drawer, editorBox })}`);
      await activate(editor);
      assert.equal(await editor.evaluate(node => node.getRootNode().activeElement === node), true,
        'The visible comment editor can receive focus');
      checkpoints.push({ action: 'settled comment drawer and initialized editor', drawer, editor: editorBox });
      await page.screenshot({ path: `${dir}/photos-live-comments-${width}.png` });
      if (mobile) await page.locator('[aria-label="关闭评论"]').tap();
      else {
        // The embedded editor owns Escape while editing. Test the photo
        // panel's Escape behavior from its own close control.
        await page.locator('[aria-label="关闭评论"]').focus();
        await page.keyboard.press('Escape');
      }
      await page.waitForFunction(() => document.querySelector('[data-photos-detail-comments-btn]')?.getAttribute('aria-expanded') === 'false');
      assert.equal(await page.locator('[data-photos-detail-comments-btn]').getAttribute('aria-expanded'), 'false');
      checkpoints.push({ action: mobile ? 'comments tap open/close' : 'comments open/Escape', closed: true });
      phase = 'adjacent photo';
      if (!await page.locator('.photos-detail-adjacent-btn[aria-label="下一张"]').count()) throw new SampleMissing('The selected album has no next-photo control');
      const nextHref = await page.locator('.photos-detail-adjacent-btn[aria-label="下一张"]').getAttribute('href');
      if (!nextHref) throw new SampleMissing('The selected album has no adjacent photo');
      const nextPhotoName = await page.locator('.photos-detail-neighbor').evaluateAll((nodes, href) => nodes.find(node => node.href === new URL(href, location.href).href)?.dataset.photoName, nextHref);
      assert.ok(nextPhotoName && nextPhotoName !== selectedName, 'Next link identifies a different photo in the current group');
      if (mobile) await page.locator('.photos-detail-adjacent-btn[aria-label="下一张"]').tap();
      else {
        await page.locator('.photos-detail-stage').focus();
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForURL(url => url.href !== detailUrl);
      await waitView(page, 'detail');
      const immediatePhotoAfterUrl = await page.locator('.photos-detail-figure').getAttribute('data-photo-name');
      await waitPhoto(page, nextPhotoName);
      const secondUrl = page.url();
      await exactlyOneGet(nextHref, 'open adjacent photo');
      assert.notEqual(await page.locator('.photos-detail-figure').getAttribute('data-photo-name'), selectedName);
      checkpoints.push({ action: mobile ? 'tap next photo' : 'ArrowRight next photo', url: secondUrl, targetPhoto: nextPhotoName, immediatePhotoAfterUrl, settledPhoto: await page.locator('.photos-detail-figure').getAttribute('data-photo-name') });
      phase = 'filmstrip';
      const firstNeighbor = page.locator('.photos-detail-neighbor').first();
      assert.equal(await firstNeighbor.getAttribute('data-photo-name'), selectedName);
      if (mobile) await firstNeighbor.tap();
      else { await firstNeighbor.focus(); await page.keyboard.press('Enter'); }
      await page.waitForURL(url => url.href !== secondUrl);
      await waitView(page, 'detail');
      await waitPhoto(page, selectedName);
      await exactlyOneGet(selectedHref, 'return through filmstrip');
      assert.equal(await page.locator('.photos-detail-figure').getAttribute('data-photo-name'), selectedName);
      checkpoints.push({ action: mobile ? 'tap first filmstrip photo' : 'filmstrip Enter', photo: selectedName });
      await page.screenshot({ path: `${dir}/photos-live-detail-${width}.png` });
      phase = 'return to group';
      await activate(page.locator('.photos-detail-titlebar-back'));
      await waitView(page, 'group');
      const returnedUrl = page.url();
      // The official detail back URL may materialize default page=1&size=20.
      // Verify the same actual group/page and selected photo position instead.
      assert.deepEqual(listContext(returnedUrl), listContext(groupUrl), 'Return preserves original group and paging context');
      const returnedCards = await page.locator('.photo-card').evaluateAll(nodes => nodes.map(node => node.dataset.photoName));
      assert.equal(returnedCards.indexOf(selectedName), 0, 'Original selected photo remains at its original list position');
      const returnedPhoto = page.locator('.photo-card').first();
      const visible = await returnedPhoto.evaluate(node => {
        const photo = node.getBoundingClientRect();
        const pane = node.closest('.photos-grid-scroll').getBoundingClientRect();
        return photo.top >= pane.top - 1 && photo.bottom <= pane.bottom + 1;
      });
      assert.equal(visible, true, 'Return shows the original selected photo in the list viewport');
      assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      checkpoints.push({ action: 'return to original group', context: listContext(returnedUrl), photoPosition: 0, photoVisible: visible });
      results.push({ width, status: 'passed', passed: true, input: mobile ? 'touch' : 'keyboard + pointer', groupUrl, returnedUrl, detailUrl, adjacent: secondUrl, drawer, checkpoints, errors, getRequests, scope: 'actual served UI; no injection or business write' });
    } catch (error) {
      await page.screenshot({ path: `${dir}/photos-live-failure-${width}.png` }).catch(() => {});
      results.push({ width, status: error instanceof SampleMissing ? 'sample-missing' : 'failed', passed: false, phase, error: error.message, checkpoints, errors, getRequests });
    } finally {
      const entry = results.at(-1), snapshot = runtime.snapshot();
      const externalMedia = value => new URL(value.url || base).origin !== origin && ['image', 'media', 'font'].includes(value.resourceType);
      entry.runtime = snapshot;
      entry.externalMediaFailures = [...snapshot.requestFailures, ...snapshot.responseErrors].filter(externalMedia);
      entry.cancelledReads = snapshot.requestFailures.filter(value => value.method === 'GET' && value.errorText === 'net::ERR_ABORTED');
      const externalUrls = new Set(entry.externalMediaFailures.map(value => value.url));
      entry.runtimeFailures = [
        ...snapshot.pageErrors, ...snapshot.consoleErrors.filter(value => !externalUrls.has(value.url)),
        ...snapshot.requestFailures.filter(value => !externalMedia(value) && !entry.cancelledReads.includes(value)),
        ...snapshot.responseErrors.filter(value => !externalMedia(value)), ...blockedWrites
      ];
      entry.blockedWrites = blockedWrites;
      if (entry.runtimeFailures.length) { entry.status = 'failed'; entry.passed = false; }
      runtime.stop(); await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(dir, 'photos-live-report.json'), JSON.stringify({ base, identity, results }, null, 2), { flag: 'wx' });
}
console.log(JSON.stringify({ report: path.join(dir, 'photos-live-report.json'), build: identity.build,
  results: results.map(({ width, status, phase, error, checkpoints, runtimeFailures, blockedWrites }) => ({ width, status, phase, error, checkpoints, runtimeFailures, blockedWrites })) }, null, 2));
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
else if (results.some(result => result.status === 'sample-missing')) process.exitCode = 2;
