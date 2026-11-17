import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';

assertCurrentBuild(process.cwd());
const require = createRequire(import.meta.url);
const [css, library, adapter] = await Promise.all([
  readFile('templates/assets/css/shell-core/index.css', 'utf8'),
  readFile(require.resolve('nprogress'), 'utf8'),
  readFile('src/shell/desktop-shell/runtime/desktop/pjax/navigation-progress.js', 'utf8')
]);
const browser = await chromium.launch({ headless: true });
let passed = 0;
try {
  for (const width of [1440, 390]) for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>${css}
      html,body{margin:0;min-height:100%;--mac-accent:#b14e76}
      #fixture-action{position:fixed;top:0;left:0;width:120px;height:40px;z-index:60}
      </style><header class="menubar"><button id="fixture-action">可操作内容</button></header>`);
    await page.addScriptTag({ content: library });
    await page.addScriptTag({ type: 'module', content: `${adapter}\nwindow.feedback = createNavigationProgress(window.NProgress);` });
    await page.waitForFunction(() => typeof window.feedback?.start === 'function');
    await page.evaluate(() => { window.feedback.start(); window.feedback.start(); });
    await page.waitForSelector('#nprogress .bar');
    const state = await page.evaluate(() => {
      const bar = document.querySelector('#nprogress .bar');
      const style = getComputedStyle(bar);
      const rect = bar.getBoundingClientRect();
      return { position: style.position, zIndex: Number(style.zIndex), chromeZIndex: Number(getComputedStyle(document.querySelector('.menubar')).zIndex), height: rect.height,
        top: rect.top, right: rect.right, width: rect.width,
        pointerEvents: style.pointerEvents, activeBars: document.querySelectorAll('#nprogress').length,
        actionAccessible: document.elementFromPoint(10, 1) === document.getElementById('fixture-action') };
    });
    assert.equal(state.position, 'fixed', 'progress must stay at the viewport edge');
    assert.ok(state.zIndex > state.chromeZIndex, 'progress must remain visible above desktop chrome');
    assert.equal(state.top, 0);
    assert.equal(state.width, width);
    assert.ok(state.height > 0 && state.height <= 3);
    assert.ok(state.right > 0 && state.right <= width);
    assert.equal(state.pointerEvents, 'none');
    assert.equal(state.actionAccessible, true);
    assert.equal(state.activeBars, 1);
    await page.evaluate(() => window.feedback.finish());
    assert.equal(await page.locator('#nprogress').count(), 0, 'completion removes feedback synchronously');
    assert.deepEqual(errors, []);
    console.log(`PASS navigation progress ${width}px ${reducedMotion}`);
    passed++;
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Navigation progress browser fixture: ${passed} passed; no live requests`);
