import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

// Run after build-only and verify:reload. Keep Halo's rendered login and its
// official ALTCHA widget; only hold the challenge and fixture Passkey options.
// Each scene has a new anonymous context, never the user's browser profile.
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/+$/, '');
const site = new URL(baseUrl);
assert.ok(['http:', 'https:'].includes(site.protocol) && !site.username && !site.password
  && !site.search && !site.hash, 'Use an HTTP(S) base URL without credentials, query or fragment');
const output = path.resolve(process.env.AUTH_CAPTCHA_POSITION_OUTPUT || 'output/auth-captcha-position');
const reportPath = path.join(output, 'results.json');
const scenes = [
  { name: 'desktop-light', width: 1440, height: 960, colorScheme: 'light', trigger: 'click' },
  { name: 'medium-dark', width: 910, height: 800, colorScheme: 'dark', trigger: 'click' },
  { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light', trigger: 'click' },
  { name: 'short-desktop-dark', width: 1280, height: 700, colorScheme: 'dark', trigger: 'click' },
  { name: 'short-mobile-dark', width: 390, height: 600, colorScheme: 'dark', trigger: 'click' },
  { name: 'desktop-keyboard-light', width: 1440, height: 960, colorScheme: 'light', trigger: 'Enter' }
];
const report = {
  startedAt: new Date().toISOString(), baseUrl,
  scope: 'Real anonymous Halo login and official ALTCHA. Synthetic credentials only. Challenge remains pending; Passkey options are fulfilled locally; all other non-read requests are blocked.',
  scenes: []
};
await fs.mkdir(output, { recursive: true });

async function waitForPosition(page) {
  // ALTCHA first renders offscreen and positions on a later frame. Visibility
  // alone is not readiness: require initialized coordinates, full opacity and
  // four unchanged animation frames, including the anchor and floating arrow.
  await page.evaluate(() => new Promise((resolve, reject) => {
    let previous, stableFrames = 0, frame;
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error('ALTCHA did not finish floating positioning within 8 seconds'));
    }, 8000);
    const sample = () => {
      const widget = document.querySelector('altcha-widget');
      const root = widget?.shadowRoot || widget;
      const popup = root?.querySelector('.altcha');
      const arrow = root?.querySelector('.altcha-floating-arrow');
      const submit = document.querySelector('[data-auth-lockscreen-submit]');
      const style = popup && getComputedStyle(popup);
      const rects = [popup, arrow, submit].map(node => node?.getBoundingClientRect());
      const ready = style && style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) > 0.95 && Number.parseFloat(style.left) >= 0
        && Number.isFinite(Number.parseFloat(style.top))
        && rects.every(rect => rect && rect.width > 0 && rect.height > 0);
      if (ready) {
        const next = rects.flatMap(rect => [rect.x, rect.y, rect.width, rect.height]);
        stableFrames = previous && next.every((value, index) => Math.abs(value - previous[index]) < 0.1)
          ? stableFrames + 1 : 0;
        previous = next;
        if (stableFrames >= 4) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } else { previous = undefined; stableFrames = 0; }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
  }));
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = node => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    const widget = document.querySelector('altcha-widget');
    const root = widget?.shadowRoot || widget;
    const popup = root?.querySelector('.altcha');
    const arrow = root?.querySelector('.altcha-floating-arrow');
    const submit = document.querySelector('[data-auth-lockscreen-submit]');
    const style = popup && getComputedStyle(popup);
    const ancestors = [];
    for (let node = widget?.parentElement; node; node = node.parentElement) {
      const computed = getComputedStyle(node);
      ancestors.push({ tag: node.tagName, className: node.className, transform: computed.transform,
        filter: computed.filter, backdropFilter: computed.backdropFilter, rect: rect(node) });
    }
    return {
      viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
      submit: rect(submit), popup: rect(popup), arrow: rect(arrow),
      popupStyle: style && { position: style.position, left: style.left, top: style.top, opacity: style.opacity },
      // Do not serialize widget attributes, forms, HTML or request bodies: they
      // can contain CSRF tokens or captcha payloads unrelated to this test.
      widgetDisplay: widget?.getAttribute('display'),
      altchaScripts: [...document.scripts].filter(script => /altcha/i.test(script.src)).map(script => new URL(script.src).pathname),
      ancestors
    };
  });
}

function assertPosition(state) {
  const { popup, arrow, submit, viewport } = state;
  assert.ok(popup && arrow && submit, 'Floating popup, its arrow and visible login button must exist');
  const tolerance = 1; // Allow subpixel browser rounding, not visible clipping.
  for (const [name, box] of [['popup', popup], ['arrow', arrow], ['submit', submit]]) {
    assert.ok(box.x >= -tolerance && box.y >= -tolerance && box.right <= viewport.width + tolerance
      && box.bottom <= viewport.height + tolerance, `${name} must remain inside the viewport`);
  }
  const below = popup.y >= submit.bottom - tolerance;
  const above = popup.bottom <= submit.y + tolerance;
  assert.ok(below || above, 'Captcha must sit above or below the login button without overlapping it');
  const verticalGap = below ? popup.y - submit.bottom : submit.y - popup.bottom;
  assert.ok(verticalGap <= 24, `Captcha must anchor beside the login button; gap ${verticalGap.toFixed(2)}px`);
  const arrowCenterX = arrow.x + arrow.width / 2;
  assert.ok(arrowCenterX >= submit.x - tolerance && arrowCenterX <= submit.right + tolerance,
    `Captcha arrow must point horizontally at the login button; center x=${arrowCenterX.toFixed(2)}`);
  assert.ok(below ? arrow.y < popup.y && arrow.bottom >= popup.y - tolerance
    : arrow.y <= popup.bottom + tolerance && arrow.bottom > popup.bottom,
  'Floating arrow must be on the popup edge facing the login button');
  return { placement: below ? 'below' : 'above', verticalGap, arrowCenterX,
    arrowOffsetFromSubmitCenter: arrowCenterX - (submit.x + submit.width / 2) };
}

async function runScene(browser, scene) {
  const result = { ...scene, status: 'running', pageErrors: [], blockedWrites: [], passkeyFixtures: 0,
    challengeRequests: 0, positionSettled: false };
  report.scenes.push(result);
  const context = await browser.newContext({ viewport: { width: scene.width, height: scene.height },
    colorScheme: scene.colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let releasePending;
  const contextClosed = new Promise(resolve => { releasePending = resolve; });
  context.once('close', releasePending);
  const pendingRoutes = new Set();
  const routeHandler = async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === site.origin && url.pathname === '/captcha/altcha' && method === 'GET') {
      result.challengeRequests++;
      // No fixed sleep and no response fixture: observe the real widget's
      // pending state until this disposable context closes.
      const pending = contextClosed.then(() => route.abort('blockedbyclient').catch(() => {}));
      pendingRoutes.add(pending);
      try { await pending; } finally { pendingRoutes.delete(pending); }
      return;
    }
    if (url.origin === site.origin && url.pathname === '/apis/api.passkey.halo.run/v1alpha1/authentication/options'
      && !url.search && method === 'POST') {
      result.passkeyFixtures++;
      return route.fulfill({ json: { challenge: 'AQID', rpId: site.hostname, timeout: 60000,
        userVerification: 'preferred', sessionId: 'fixture-session', allowCredentials: [] } });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      result.blockedWrites.push({ method, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  };
  await context.route('**/*', routeHandler);
  await context.addInitScript(mode => localStorage.setItem('theme', mode), scene.colorScheme);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  try {
    const response = await page.goto(new URL('/login', site).href, { waitUntil: 'domcontentloaded', timeout: 25000 });
    assert.equal(response?.status(), 200, 'The real Halo login must return 200');
    assert.equal(new URL(page.url()).pathname, '/login', 'The anonymous context must stay on login');
    await page.waitForFunction(() => window.__THEME_APP_AUTH_LOADED__ === true
      && document.body.dataset.appId === 'auth' && document.fonts.status === 'loaded');
    await page.locator('altcha-widget').waitFor({ state: 'attached' });
    assert.equal(await page.locator('altcha-widget').getAttribute('display'), 'floating');
    await page.locator('#username').fill('demo-layout-user');
    if (scene.trigger === 'Enter') await page.locator('#username').press('Enter');
    else await page.locator('[data-auth-lockscreen-advance]').click();
    await page.locator('#password').fill('layout-demo-password');
    if (scene.trigger === 'Enter') await page.locator('#password').press('Enter');
    else await page.locator('[data-auth-lockscreen-submit]').click();
    await waitForPosition(page);
    result.positionSettled = true;
    result.geometry = await geometry(page);
    assert.equal(result.geometry.theme, scene.colorScheme, 'The requested light/dark mode must be active');
    result.alignment = assertPosition(result.geometry);
    assert.ok(result.challengeRequests > 0, 'The real widget must request its held challenge');
    assert.deepEqual(result.pageErrors, [], 'No uncaught browser errors');
    assert.deepEqual(result.blockedWrites, [], 'Captcha must prevent an actual login submission');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.message;
    result.geometry ||= await geometry(page).catch(() => null);
  } finally {
    result.screenshot = path.join(output, `${scene.name}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: false }).catch(error => {
      result.screenshotError = error.message;
      result.status = 'failed';
    });
    try { await context.close(); } finally {
      releasePending();
      await Promise.allSettled([...pendingRoutes]);
    }
    // Include errors or blocked writes arriving during the final screenshot.
    if (result.pageErrors.length || result.blockedWrites.length) {
      result.status = 'failed';
      result.failure ||= 'Browser errors or blocked write attempts were observed';
    }
  }
  console.log(`${result.status.toUpperCase()} ${scene.name}${result.failure ? `: ${result.failure}` : ''}`);
}

let browser;
try {
  report.buildContext = await readLiveBuildContext(baseUrl);
  browser = await chromium.launch({ headless: true });
  for (const scene of scenes) await runScene(browser, scene);
} catch (error) {
  report.failure = error.message;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  report.passed = !report.failure && report.scenes.length === scenes.length
    && report.scenes.every(scene => scene.status === 'passed');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Captcha position report: ${reportPath}`);
if (!report.passed) process.exitCode = 1;
