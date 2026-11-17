import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verificationOutput } from './lib/verification-output.mjs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const source = (await readFile(new URL('../src/apps/photos/runtime/explorer.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
const css = await readFile(new URL('../src/apps/photos/styles/index.css', import.meta.url), 'utf8');
const template = await readFile(new URL('../templates/photo.html', import.meta.url), 'utf8');
const errorMarkup = template.match(/<div class="photos-detail-image-error"[\s\S]*?<\/div>/)?.[0];
assert.ok(errorMarkup, 'Use the actual photo error controls');
const outputDir = await verificationOutput('photos');
let imageRequests = 0;
let delayedImageRequests = 0;
const server = createServer((request, response) => {
  if (request.url === '/delayed-photo.svg') {
    delayedImageRequests++;
    response.writeHead(delayedImageRequests === 1 ? 503 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    if (delayedImageRequests === 1) response.end('');
    else setTimeout(() => response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="slateblue"/></svg>'), 180);
    return;
  }
  if (request.url === '/photo.svg') {
    imageRequests++;
    response.writeHead(imageRequests === 1 ? 503 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    response.end(imageRequests === 1 ? '' : '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="slateblue"/></svg>');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, action, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 740 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(1600);
  try {
    await page.goto(origin);
    await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}.photos-window{container-type:inline-size;container-name:windowframe;width:100vw;height:100vh}.photos-titlebar{height:48px}.fixture-body{height:calc(100% - 48px)}</style><style>${css}</style></head><body>
      <div class="photos-window" data-window-surface>
        <header class="photos-titlebar"><button data-photos-detail-info-btn data-photos-control="info-toggle">信息</button><button data-photos-detail-comments-btn data-photos-control="comments-toggle">评论</button>
        <button data-photos-control="zoom-out">缩小</button><input type="range" min="0.5" max="2.2" step="0.05" data-photos-detail-zoom value="1"><button data-photos-control="zoom-in">放大</button><button data-photos-control="zoom-reset" data-photos-zoom-label>100%</button></header>
        <div class="fixture-body"><article class="photos-shell photos-detail-shell" data-photos-view="detail">
          <h1 style="position:absolute;clip-path:inset(100%)" tabindex="-1">照片详情</h1>
          <main class="photos-main photos-detail-main"><section class="photos-detail-stage" tabindex="-1"><figure class="photos-detail-figure"><img class="photos-detail-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='600'%3E%3Crect width='400' height='600' fill='slateblue'/%3E%3C/svg%3E" alt="测试照片">${errorMarkup}</figure><div class="photos-detail-adjacent"><a class="photos-detail-adjacent-btn" href="#previous" aria-label="上一张">上一张</a><a class="photos-detail-adjacent-btn" href="#next" aria-label="下一张">下一张</a></div></section><nav class="photos-detail-filmstrip"><div class="photos-detail-neighbor-list"><a class="photos-detail-neighbor is-current" href="#current">当前</a></div></nav></main>
          <aside class="photos-detail-comment-drawer" style="display:none"><div class="photos-detail-comment-head"><strong>评论</strong><button class="photos-detail-icon-btn">关闭</button></div><section><p style="height:1400px">隔离长评论 fixture</p><button id="last-comment">末条评论操作</button></section></aside>
        </article></div>
      </div></body></html>`);
    await page.addScriptTag({ content: `${source}\nwindow.registerPhotosExplorer = registerPhotosExplorer;` });
    await page.evaluate(() => {
      let create;
      window.registerPhotosExplorer({ data(_name, factory) { create = factory; } });
      const component = window.photos = create();
      component.$el = document.querySelector('.photos-shell');
      component.$store = { windowManager: { show: true } };
      component.$nextTick = callback => queueMicrotask(callback);
      component._installSurfaceControls(); component._installDetailViewerControls();
    });
    await action(page);
    assert.deepEqual(errors, [], 'No browser runtime errors');
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await page.close(); }
}
try {
  await scenario('图片重试只重新请求图片，保留当前页面和面板', async page => {
    await page.evaluate(() => {
      window.photos.setCommentsOpen(true);
      document.querySelector('.photos-detail-image').src = '/photo.svg';
    });
    await page.waitForSelector('.photos-detail-stage.is-image-error');
    let navigations = 0;
    page.on('framenavigated', () => navigations++);
    await page.locator('.photos-detail-image-error button').click();
    await page.waitForFunction(() => document.querySelector('.photos-detail-image')?.naturalWidth > 0 && !document.querySelector('.photos-detail-stage').classList.contains('is-image-error'));
    assert.equal(navigations, 0, 'Retry must not reload the page');
    assert.equal(await page.evaluate(() => window.photos.commentsOpen), true);
    assert.equal(imageRequests, 2);
    assert.equal(await page.locator('.photos-detail-stage').evaluate(node => document.activeElement === node), true, 'Successful retry returns focus to photo browsing');
  });
  await scenario('慢速重试完成后保留访客刚移入的其他控件焦点', async page => {
    await page.evaluate(() => { document.querySelector('.photos-detail-image').src = '/delayed-photo.svg'; });
    await page.waitForSelector('.photos-detail-stage.is-image-error');
    await page.locator('.photos-detail-image-error button').click();
    await page.locator('[data-photos-detail-comments-btn]').focus();
    await page.waitForFunction(() => document.querySelector('.photos-detail-image').naturalWidth > 0 && !document.querySelector('.photos-detail-stage').classList.contains('is-image-error'));
    assert.equal(await page.locator('[data-photos-detail-comments-btn]').evaluate(node => document.activeElement === node), true, 'Image completion must not steal focus from another control');
  });
  await scenario('无原图尺寸时预览可缩放拖动，解码交接保留比例与位置', async page => {
    await page.emulateMedia({ reducedMotion:'reduce' });
    let held;
    await page.route('**/held-original.svg', route => { held = route; });
    await page.evaluate(async () => {
      const p = window.photos, engine = p._getEngine();
      engine.detailCleanup(); engine.detailCleanup = null;
      const original = document.querySelector('.photos-detail-image');
      const preview = original.cloneNode();
      preview.className = 'photos-detail-preview'; preview.alt = '';
      original.before(preview); await preview.decode();
      original.src = '/held-original.svg';
      p._installDetailViewerControls();
      p.setZoomLevel(2);
    });
    await page.waitForFunction(() => document.querySelector('.photos-detail-image').naturalWidth === 0 && window.photos.photoCanPan);
    const read = selector => page.locator(selector).evaluate(image => {
      const rect=image.getBoundingClientRect();
      return { cx:rect.x+rect.width/2, cy:rect.y+rect.height/2,
        scale:new DOMMatrixReadOnly(getComputedStyle(image).transform).a,
        natural:[image.naturalWidth,image.naturalHeight], duration:getComputedStyle(image).transitionDuration };
    });
    const start = await read('.photos-detail-preview');
    assert.equal(start.scale,2); assert.match(start.duration,/^0s(?:, 0s)*$/);
    const stage = await page.locator('.photos-detail-stage').boundingBox();
    await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
    await page.mouse.down(); await page.mouse.move(stage.x+stage.width/2+30,stage.y+stage.height/2+35,{steps:4}); await page.mouse.up();
    const dragged = await read('.photos-detail-preview');
    assert.ok(Math.abs(dragged.cy-start.cy)>15,'Visible portrait preview must follow vertical drag');
    assert.ok(held,'The original has not supplied any bytes');
    await held.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><rect width="1200" height="1800" fill="indigo"/></svg>'});
    await page.waitForFunction(() => !document.querySelector('.photos-detail-preview') && document.querySelector('.photos-detail-image').naturalWidth===1200);
    const original = await read('.photos-detail-image');
    assert.equal(original.scale,2); assert.deepEqual(original.natural,[1200,1800]);
    assert.ok(Math.abs(original.cy-dragged.cy)<2,'Decoded full image retains dragged center');
  }, 1440);
  await scenario('缩放限值正确禁用，百分比可重置为适合窗口', async page => {
    await page.evaluate(() => window.photos.setZoomLevel(2.2));
    assert.equal(await page.locator('[data-photos-control="zoom-in"]').isDisabled(), true);
    assert.equal(await page.locator('[data-photos-detail-zoom]').getAttribute('aria-valuetext'), '220%');
    await page.locator('[data-photos-control="zoom-reset"]').click();
    assert.equal(await page.evaluate(() => window.photos.zoomLevel), 1);
    assert.equal(await page.locator('[data-photos-zoom-label]').textContent(), '100%');
    await page.evaluate(() => window.photos.setZoomLevel(0.5));
    assert.equal(await page.locator('[data-photos-control="zoom-out"]').isDisabled(), true);
  });
  for (const width of [1440, 390, 320]) await scenario(`${width}px 长评论可滚动到末项，面板固定在内容区`, async page => {
    await page.evaluate(() => { document.querySelector('.photos-shell').classList.add('is-comments-open'); document.querySelector('.photos-detail-comment-drawer').style.display = 'flex'; });
    const initial = await page.evaluate(() => {
      const drawer = document.querySelector('.photos-detail-comment-drawer');
      const body = drawer.querySelector('section');
      return { top: drawer.getBoundingClientRect().top, height: drawer.getBoundingClientRect().height, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, overflow: getComputedStyle(body).overflowY };
    });
    assert.equal(initial.top, 48, 'Drawer begins below the titlebar without a second offset');
    assert.ok(initial.height <= 692, 'Drawer stays inside the content region');
    assert.ok(initial.scrollHeight > initial.clientHeight && initial.overflow === 'auto', 'Long comments have a dedicated scroll region');
    await page.locator('#last-comment').focus();
    const last = await page.locator('#last-comment').boundingBox();
    assert.ok(last.y + last.height <= 740, 'Keyboard focus reveals the final comment');
    await page.screenshot({ path: path.join(outputDir, `photos-fixture-comments-${width}.png`) });
  }, width);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(outputDir, 'photos-ui-polish-regression.json'), JSON.stringify({ scope: 'isolated native Chromium, current source/CSS, injected long comments and one failed image', results }, null, 2));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
