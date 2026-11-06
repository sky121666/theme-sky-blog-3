import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

// Exercise the current component in a real, offline DOM. Its imported media and
// comment services are unused by this focused detail-controls installation.
const source = (await readFile(new URL('../src/apps/photos/runtime/explorer.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'Detail controls must not throw in native DOM events'));
  await page.setContent(`<!doctype html><html><body>
    <nav><a id="outside-link" href="#outside">外部链接</a><div id="menu" role="menu" tabindex="0">菜单</div></nav>
    <section id="other-panel" tabindex="0">其它面板</section><div id="desktop">桌面空白</div>
    <div data-window-surface style="width:640px;height:480px">
      <button data-photos-detail-info-btn>信息</button><button data-photos-detail-comments-btn>评论</button>
      <div data-window-content-root>
        <article class="photos-shell" data-photos-view="detail">
          <h1 tabindex="-1">图片详情</h1>
          <main class="photos-detail-main">
            <section class="photos-detail-stage" style="width:600px;height:300px">
              <img class="photos-detail-image" alt="照片" width="100" height="100"
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='navy'/%3E%3C/svg%3E">
              <a class="photos-detail-adjacent-btn" aria-label="上一张" href="#previous">上一张</a>
              <a class="photos-detail-adjacent-btn" aria-label="下一张" href="#next">下一张</a>
            </section>
            <nav class="photos-detail-filmstrip"><a class="photos-detail-neighbor" href="#thumbnail">缩略图</a></nav>
            <section class="photos-detail-popover" tabindex="-1">图片信息</section>
          </main>
          <aside class="photos-detail-comment-drawer" tabindex="-1">
            <div class="photos-detail-comment-head"><button>关闭</button></div><comment-widget></comment-widget>
          </aside>
        </article>
      </div>
    </div>
  </body></html>`);
  await page.addScriptTag({ content: `${source}\nwindow.registerPhotosExplorer = registerPhotosExplorer;` });
  await page.evaluate(() => {
    let factory;
    window.registerPhotosExplorer({ data(_name, value) { factory = value; } });
    const component = window.photos = factory();
    component.$el = document.querySelector('.photos-shell');
    component.$store = { windowManager: { show: true, minimized: false, isAnimating: false } };
    component.$nextTick = (callback) => queueMicrotask(callback);
    window.photoNavigations = [];
    document.querySelectorAll('.photos-detail-adjacent-btn').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        window.photoNavigations.push(link.getAttribute('aria-label'));
      });
    });
    document.querySelector('comment-widget').attachShadow({ mode: 'open' }).innerHTML = '<textarea aria-label="评论输入"></textarea>';
    component._installDetailViewerControls();
  });
  return page;
}

const navigations = (page) => page.evaluate(() => window.photoNavigations);

test('窗口外链接、菜单和其它面板的左右键不会切图', async (t) => {
  const page = await fixture(t);
  for (const selector of ['#outside-link', '#menu', '#other-panel']) {
    await page.locator(selector).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
  }
  assert.deepEqual(await navigations(page), []);
});

test('点击不可聚焦图片后 body 来源的方向键仍能切图，内容根焦点也能浏览', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-window-content-root]').evaluate(node => node.setAttribute('tabindex', '-1'));
  await page.locator('[data-window-content-root]').focus();
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await navigations(page), ['下一张', '上一张']);
});

test('PJAX 将焦点移到详情标题后仍能继续方向切图', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-shell > h1').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), ['上一张', '下一张']);
});

test('长按重复事件不会连续导航，松开后的下一次按键仍可用', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  assert.deepEqual(await navigations(page), ['下一张']);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), ['下一张', '下一张']);
});

test('缩略图焦点保留方向切图', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-neighbor').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await navigations(page), ['下一张', '上一张']);
});

test('窗口内 Tab 唤醒隐藏缩略条，窗口外 Tab 不干扰图库', async (t) => {
  const page = await fixture(t);
  await page.locator('#outside-link').focus();
  await page.waitForFunction(() => document.querySelector('.photos-shell').dataset.photosFilmstripState === 'hidden', null, { timeout: 6000 });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.photos-shell').getAttribute('data-photos-filmstrip-state'), 'hidden');
  await page.locator('[data-photos-detail-info-btn]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.photos-shell').getAttribute('data-photos-filmstrip-state'), 'visible');
  assert.deepEqual(await navigations(page), []);
});

test('隐藏、最小化、动画中或 inert 的图库不处理 body 方向键', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  for (const state of ['hidden', 'minimized', 'animating', 'inert', 'display-none']) {
    await page.evaluate((state) => {
      const surface = document.querySelector('[data-window-surface]');
      Object.assign(window.photos.$store.windowManager, {
        show: state !== 'hidden', minimized: state === 'minimized', isAnimating: state === 'animating'
      });
      surface.inert = state === 'inert';
      surface.style.display = state === 'display-none' ? 'none' : '';
    }, state);
    await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual(await navigations(page), []);
});

test('信息和评论面板保留自身方向键，Escape 仍关闭并回到触发器', async (t) => {
  const page = await fixture(t);
  for (const panel of ['info', 'comments']) {
    await page.evaluate((panel) => panel === 'info' ? window.photos.setInfoOpen(true) : window.photos.setCommentsOpen(true), panel);
    const selector = panel === 'info' ? '.photos-detail-popover' : '.photos-detail-comment-drawer';
    await page.locator(selector).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate((panel) => window.photos[panel === 'info' ? 'infoOpen' : 'commentsOpen'], panel), false);
    const trigger = panel === 'info' ? '[data-photos-detail-info-btn]' : '[data-photos-detail-comments-btn]';
    assert.equal(await page.locator(trigger).evaluate(node => document.activeElement === node), true);
  }
  assert.deepEqual(await navigations(page), []);
});

test('评论 Shadow DOM 输入的方向键不切图，Escape 保持可用', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.photos.setCommentsOpen(true));
  await page.locator('comment-widget textarea').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.deepEqual(await navigations(page), []);
  assert.equal(await page.evaluate(() => window.photos.commentsOpen), false);
});

test('信息和评论并存时 Escape 关闭当前焦点所在的面板', async (t) => {
  const page = await fixture(t);
  for (const panel of ['comments', 'info']) {
    await page.evaluate(() => {
      window.photos.setCommentsOpen(true);
      window.photos.setInfoOpen(true);
    });
    await page.locator(panel === 'comments'
      ? 'comment-widget textarea' : '.photos-detail-popover').focus();
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => ({
      info: window.photos.infoOpen, comments: window.photos.commentsOpen
    })), { info: panel !== 'info', comments: panel !== 'comments' });
    assert.equal(await page.locator(panel === 'comments'
      ? '[data-photos-detail-comments-btn]' : '[data-photos-detail-info-btn]')
      .evaluate(node => document.activeElement === node), true);
  }
});

test('点击窗口外空白后 body 不再归图库，重新点击图片恢复浏览', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  await page.locator('#desktop').click();
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), []);
  await page.locator('.photos-detail-image').click();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), ['下一张']);
});

test('键盘焦点离开图库后变回 body 不会夺回方向键', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  await page.locator('#other-panel').focus();
  await page.locator('#other-panel').evaluate(node => node.blur());
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), []);
});

test('销毁详情控件移除键盘监听，重新安装只导航一次', async (t) => {
  const page = await fixture(t);
  await page.locator('.photos-detail-image').click();
  await page.evaluate(() => {
    window.photos._getEngine().detailCleanup();
    window.photos._getEngine().detailCleanup = null;
  });
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), []);
  await page.evaluate(() => window.photos._installDetailViewerControls());
  await page.locator('.photos-detail-image').click();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await navigations(page), ['下一张']);
});
