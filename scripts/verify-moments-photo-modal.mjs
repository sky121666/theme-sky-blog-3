import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Execute the current owner source, without rebuilding or touching Halo.
// Keyboard, focus, inert, layout and pointer behavior remain native Chromium.
const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const [interactions, deadline, permalink, pageUrl, styles] = await Promise.all([
  read('src/apps/moments/interactions.js'),
  read('src/shared/request-deadline.js'),
  read('src/shared/comment-permalink.js'),
  read('src/shared/comment-page-url.js'),
  read('src/apps/moments/styles/moment.css')
]);
const source = interactions
  .replace("from '../../shared/request-deadline.js'", `from '${moduleUrl(deadline)}'`)
  .replace("from '../../shared/comment-permalink.js'", `from '${moduleUrl(permalink.replace("from './comment-page-url.js'", `from '${moduleUrl(pageUrl)}'`))}'`);
const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;

async function fixture({ single = false, width = 1100 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    assert.equal(request.method(), 'GET', 'photo fixture must never write HTTP state');
    if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Moments modal fixture</title>' });
    if (new URL(request.url()).pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="blue"/></svg>' });
    if (new URL(request.url()).pathname.endsWith('.mp4')) return route.fulfill({ status: 204, body: '' });
    throw new Error(`Unexpected fixture request: ${request.url()}`);
  });
  await page.goto('http://moments-photo.test/');
  await page.setContent(`
    <button id="outside">页面背景按钮</button>
    <div id="shell"><nav id="shell-nav"><a href="#background">背景链接</a></nav>
      <div id="window-parent"><section class="moments-window">
        <div id="window-toolbar" aria-hidden="false"><button>窗口背景按钮</button></div>
        <main data-app-root="moments"><div class="moments-feed-list"><div class="moment-feed-gallery">
          <div id="photo-a" role="button" tabindex="0" data-moment-photo data-moment-photo-url="/a.svg"><img src="/a.svg" alt="图片 A"></div>
          ${single ? '' : '<div id="photo-b" role="button" tabindex="0" data-moment-photo data-moment-photo-url="/b.svg" data-moment-photo-live-url="/live.mp4"><img src="/b.svg" alt="实况图片 B"></div>'}
        </div><button id="background">列表背景按钮</button></div></main>
        <div id="authored-hidden" aria-hidden="true">已有隐藏语义</div>
        <div id="authored-inert" inert="retained" aria-hidden="false"><button>原来禁用的背景</button></div>
      </section><aside id="window-sibling"><button>旁边窗口按钮</button></aside></div>
    </div><button id="destination">下一页焦点</button>
  `);
  // The source stylesheet supplies the actual viewer layout. Tailwind's global
  // hidden utility is represented explicitly because this test skips bundles.
  await page.addStyleTag({ content: `${styles}\n[hidden] { display: none !important; } .moments-window { position: relative; width: min(800px, 100%); height: 600px; } [data-moment-photo] { display: inline-block; }` });
  await page.addScriptTag({ type: 'module', content: `${source}\nwindow.__setup = setupMomentInteractions; window.__cleanup = setupMomentInteractions(document);` });
  await page.waitForFunction(() => typeof window.__cleanup === 'function');
  return { page, errors };
}

async function active(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    return Array.from(node?.attributes || []).find((attribute) => /^data-photo-/.test(attribute.name))?.name || node?.id || node?.tagName;
  });
}

async function open(page, trigger = '#photo-a') {
  await page.locator(trigger).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.classList.contains('moment-photo-viewer-close'));
  assert.equal(await page.locator('.moment-photo-viewer').getAttribute('aria-modal'), 'true');
}

async function check(name, run, options) {
  const f = await fixture(options);
  try {
    await run(f.page);
    assert.deepEqual(f.errors, [], 'viewer must not produce browser runtime errors');
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await f.page.close();
  }
}

try {
  await check('Enter focuses close; single static photo loops Tab and Shift+Tab inside visible controls', async (page) => {
    await open(page);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(page), 'data-photo-reset', 'Shift+Tab from close must wrap to the final visible control');
    await page.keyboard.press('Tab');
    assert.equal(await active(page), 'data-photo-close');
    for (const expected of ['data-photo-zoom-out', 'data-photo-zoom-in', 'data-photo-reset', 'data-photo-close']) {
      await page.keyboard.press('Tab');
      assert.equal(await active(page), expected, 'hidden previous/next/live controls must not receive Tab');
    }
  }, { single: true });

  await check('Tab uses currently enabled and visible controls, including conditional LivePhoto', async (page) => {
    await open(page);
    await page.evaluate(() => {
      document.querySelector('[data-photo-zoom-in]').disabled = true;
      document.querySelector('[data-photo-zoom-out]').style.display = 'none';
    });
    for (const expected of ['data-photo-prev', 'data-photo-next', 'data-photo-reset', 'data-photo-close']) {
      await page.keyboard.press('Tab');
      assert.equal(await active(page), expected);
    }
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(page), 'data-photo-live-toggle', 'LivePhoto control enters the cycle only for a live image');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Tab');
    assert.equal(await active(page), 'data-photo-close', 'hiding the currently focused LivePhoto control must recover into the modal');
    await page.evaluate(() => document.querySelectorAll('.moment-photo-viewer button').forEach((button) => { button.hidden = true; }));
    await page.keyboard.press('Tab');
    assert.equal(await active(page), 'DIV', 'a modal without available controls keeps focus on the dialog');
    assert.equal(await page.evaluate(() => document.activeElement.matches('.moment-photo-viewer')), true);
  });

  await check('modal isolates every background branch and restores authored inert and aria-hidden exactly', async (page) => {
    await open(page);
    const ids = ['outside', 'shell-nav', 'window-sibling', 'window-toolbar', 'authored-hidden', 'authored-inert', 'destination'];
    const isolation = await page.evaluate((names) => names.map((name) => {
      const node = document.getElementById(name);
      return { id: name, inert: node.inert, hidden: node.getAttribute('aria-hidden') };
    }), ids);
    assert.deepEqual(isolation, ids.map((id) => ({ id, inert: true, hidden: 'true' })));
    assert.doesNotMatch(await page.locator('body').ariaSnapshot(), /背景链接|页面背景按钮|列表背景按钮/);
    await page.evaluate(() => document.querySelector('#background').focus());
    assert.equal(await active(page), 'data-photo-close', 'programmatic focus must not enter inert background');
    await page.keyboard.press('Escape');
    assert.equal(await active(page), 'photo-a');
    assert.deepEqual(await page.evaluate((names) => names.map((name) => {
      const node = document.getElementById(name);
      return { id: name, inert: node.getAttribute('inert'), hidden: node.getAttribute('aria-hidden') };
    }), ids), [
      { id: 'outside', inert: null, hidden: null },
      { id: 'shell-nav', inert: null, hidden: null },
      { id: 'window-sibling', inert: null, hidden: null },
      { id: 'window-toolbar', inert: null, hidden: 'false' },
      { id: 'authored-hidden', inert: null, hidden: 'true' },
      { id: 'authored-inert', inert: 'retained', hidden: 'false' },
      { id: 'destination', inert: null, hidden: null }
    ]);
    assert.match(await page.locator('body').ariaSnapshot(), /背景链接|页面背景按钮|列表背景按钮/);
  });

  await check('close button and Escape each restore their original image trigger on repeated opens', async (page) => {
    for (const [trigger, method] of [['#photo-a', 'button'], ['#photo-b', 'Escape'], ['#photo-a', 'Escape']]) {
      await open(page, trigger);
      if (method === 'button') await page.locator('.moment-photo-viewer-close').click();
      else await page.keyboard.press(method);
      assert.equal(await active(page), trigger.slice(1));
      assert.equal(await page.locator('.moment-photo-viewer').isHidden(), true);
    }
  });

  await check('page cleanup releases background without restoring stale trigger focus or leaving key handlers', async (page) => {
    await open(page);
    const triggerFocusCount = await page.evaluate(async () => {
      let focuses = 0;
      document.querySelector('#photo-a').addEventListener('focus', () => { focuses += 1; });
      window.__cleanup();
      document.querySelector('#destination').focus();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return focuses;
    });
    assert.equal(triggerFocusCount, 0, 'leaving Moments must not return focus to the previous page trigger');
    assert.equal(await active(page), 'destination', 'late focus work must not steal the new page focus');
    assert.equal(await page.locator('.moment-photo-viewer').count(), 0);
    assert.equal(await page.locator('#outside').getAttribute('inert'), null);
    assert.equal(await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))), true);
  });

  await check('existing image navigation, zoom, reset, LivePhoto and touch gestures remain functional', async (page) => {
    await open(page);
    await page.locator('[data-photo-zoom-in]').click();
    assert.equal(await page.locator('.moment-photo-viewer').getAttribute('data-scale'), '120');
    await page.locator('[data-photo-reset]').click();
    assert.equal(await page.locator('.moment-photo-viewer').getAttribute('data-scale'), '100');
    await page.locator('[data-photo-stage]').dispatchEvent('wheel', { deltaY: -20, clientX: 150, clientY: 150 });
    assert.equal(await page.locator('.moment-photo-viewer').getAttribute('data-scale'), '112');
    await page.locator('[data-photo-reset]').click();
    const stage = page.locator('[data-photo-stage]');
    await stage.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 200, button: 0 });
    await stage.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 200, button: 0 });
    assert.equal(await page.locator('[data-photo-counter]').textContent(), '2 / 2');
    await page.locator('[data-photo-live-toggle]').click();
    assert.equal(await page.locator('[data-photo-live]').isVisible(), true);
    await page.locator('[data-photo-live-toggle]').click();
    assert.equal(await page.locator('[data-photo-live]').isHidden(), true);
    await stage.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 150, button: 0 });
    await stage.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 150, button: 0 });
    await stage.dispatchEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 150, button: 0 });
    assert.equal(await page.locator('.moment-photo-viewer').getAttribute('data-scale'), '200');
    await stage.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 150, button: 0 });
    await stage.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 150, button: 0 });
  }, { width: 390 });
} finally {
  await browser.close();
}

console.log(`Moments photo modal: ${passed} passed, ${failures.length} failed; current source: ${fileURLToPath(new URL('src/apps/moments/interactions.js', root))}`);
if (failures.length) throw new AggregateError(failures.map(({ name, error }) => new Error(`${name}: ${error.message}`)), 'Moments photo modal regression failed');
