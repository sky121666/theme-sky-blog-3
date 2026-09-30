import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { installStartupController } from '../src/shared/startup-controller.js';
import { markStartupRecoveryReload } from '../src/shared/startup-signals.js';
import { renderStartupTemplate } from './theme-startup.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { navigation = 'navigate', motion = 'no-preference' } = {}) {
  const page = await browser.newPage({ reducedMotion: motion });
  t.after(() => page.close());
  await page.route('https://startup.test/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="origin">原操作</button><main><input id="input" value="保留输入" /></main></body></html>'
  }));
  await page.goto('https://startup.test/');
  await page.evaluate((type) => {
    window.navigationType = type;
    Object.defineProperty(performance, 'getEntriesByType', { value: () => [{ type: window.navigationType }] });
  }, navigation);
  await page.addScriptTag({ content: `window.installStartup = ${installStartupController.toString()}; window.markRecovery = ${markStartupRecoveryReload.toString()};` });
  return page;
}

async function start(page, config = {}, preview = false) {
  return page.evaluate(({ config, preview }) => {
    window.startup = window.installStartup(window, document, {
      mode: 'boot', frequency: 'tab_once', logoMode: 'apple', scene: 'desktop', ...config
    }, { preview });
    return Boolean(document.querySelector('[data-theme-startup-layer]'));
  }, { config, preview });
}

test('ordinary mode and reduced motion never cover the page or write a playback record', async (t) => {
  const page = await fixture(t);
  assert.equal(await start(page, { mode: 'direct' }), false);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await start(page), false);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
});

test('tab once skips repeats; every reload only replays on reload, never history or login return', async (t) => {
  const page = await fixture(t);
  assert.equal(await start(page), true);
  await page.evaluate(() => window.startup.dispose());
  assert.equal(await start(page), false);
  await page.evaluate(() => { window.navigationType = 'reload'; });
  assert.equal(await start(page, { frequency: 'every_reload' }), true);
  await page.evaluate(() => window.startup.dispose());
  await page.evaluate(() => { window.navigationType = 'back_forward'; });
  assert.equal(await start(page, { frequency: 'every_reload' }), false);
  await page.evaluate(() => { window.navigationType = 'navigate'; });
  assert.equal(await start(page, { frequency: 'every_reload', scene: 'app' }), false);
});

test('a recovery reload consumes its marker and the following manual reload can play', async (t) => {
  const page = await fixture(t, { navigation: 'reload' });
  await page.evaluate(() => window.markRecovery(window));
  assert.equal(await start(page, { frequency: 'every_reload' }), false);
  assert.equal(await start(page, { frequency: 'every_reload' }), true);
});

test('storage failure and unsupported scenes safely show the page', async (t) => {
  const page = await fixture(t);
  assert.equal(await start(page, { scene: 'gateway' }), false);
  await page.evaluate(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } }); });
  assert.equal(await start(page), false);
});

test('desktop waits for both shell and the complete surface, then releases focus', async (t) => {
  const page = await fixture(t);
  await page.locator('#origin').focus();
  assert.equal(await start(page), true);
  await page.evaluate(() => window.startup.ready('shell'));
  assert.equal(await page.locator('[data-theme-startup-layer]').count(), 1);
  const result = await page.evaluate(async () => {
    window.startup.ready('surface');
    return window.startup.finished;
  });
  assert.equal(result, 'interactive');
  assert.equal(await page.locator('[data-theme-startup-layer]').count(), 0);
  assert.equal(await page.locator('#input').inputValue(), '保留输入');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'origin');
});

test('startup exits by deadline without claiming that the page finished loading', async (t) => {
  const page = await fixture(t);
  await start(page);
  const result = await page.evaluate(() => window.startup.finished);
  assert.equal(result, 'timeout');
  assert.equal(await page.locator('[data-theme-startup-layer]').count(), 0);
  assert.equal(await page.locator('[inert]').count(), 0);
});

test('preview skips storage and ready signals, supports Escape and restores its invoker', async (t) => {
  const page = await fixture(t);
  await page.locator('#origin').focus();
  const before = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  assert.equal(await start(page, {}, true), true);
  await page.evaluate(() => window.startup.ready('shell'));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.startup.finished), 'skipped');
  assert.equal(await page.evaluate(() => JSON.stringify({ ...sessionStorage })), before);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'origin');
});

test('a failing custom image retains a visible fallback and a failure signal clears the layer', async (t) => {
  const page = await fixture(t);
  await page.route('https://startup.test/missing.png', (route) => route.fulfill({ status: 404, body: '' }));
  await start(page, { logoMode: 'custom', logoUrl: '/missing.png' });
  await page.waitForFunction(() => !document.querySelector('[data-theme-startup-layer] img'));
  assert.equal(await page.locator('[data-theme-startup-layer] svg').isVisible(), true);
  const result = await page.evaluate(async () => { window.startup.finish('failed'); return window.startup.finished; });
  assert.equal(result, 'failed');
  assert.equal(await page.locator('[data-theme-startup-layer]').count(), 0);
});

test('the generated SSR controller uses its script dataset and the login readiness contract', async (t) => {
  const page = await fixture(t);
  await page.goto('https://startup.test/login');
  const template = renderStartupTemplate(`export ${installStartupController.toString()}`);
  assert.match(template, /theme\.config\.desktop\?\.startup\?\.mode == 'boot'/);
  const script = template.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  await page.evaluate((code) => {
    const script = document.createElement('script');
    Object.assign(script.dataset, { mode: 'boot', frequency: 'tab_once', logoMode: 'apple', scene: 'login' });
    script.textContent = code;
    document.body.append(script);
  }, script);
  const result = await page.evaluate(async () => {
    window.__THEME_STARTUP__.ready('auth');
    return window.__THEME_STARTUP__.finished;
  });
  assert.equal(result, 'interactive');
});

test('authentication callbacks and login errors remain directly visible', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => history.replaceState(null, '', '/login/callback'));
  assert.equal(await start(page, { scene: 'login' }), false);
  await page.evaluate(() => history.replaceState(null, '', '/login?error'));
  assert.equal(await start(page, { scene: 'login' }), false);
});

test('enabling reduced motion while startup is active releases the keyboard immediately', async (t) => {
  const page = await fixture(t);
  await start(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('[data-theme-startup-layer]'), null, { timeout: 500 });
  assert.equal(await page.evaluate(() => window.startup.finished), 'reduced-motion');
});
