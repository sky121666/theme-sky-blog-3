import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

// Read-only, per-browser fault injection. No response is changed on the Halo server.
const root = process.cwd();
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const expectedRevision = process.env.SHELL_STALL_BUILD_REVISION || '';
const optionalChunk = 'js/chunks/shared/shell-theme-config-client.js';
const requiredChunk = 'js/chunks/shared/shell-page-app.js';
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(page) {
  return page.evaluate(() => ({
    mainLoaded: window.__THEME_MAIN_LOADED__ === true,
    alpineStarted: window.__THEME_ALPINE_STARTED__ === true,
    alpineInitEvents: window.__SHELL_STALL_EVENTS__?.init || 0,
    alpineInitializedEvents: window.__SHELL_STALL_EVENTS__?.initialized || 0,
    bootstrapCancelled: window.__THEME_BOOTSTRAP_CANCELLED__ === true,
    bootstrapError: window.__THEME_BOOTSTRAP_ERROR__ || '',
    recoveryCount: document.querySelectorAll('#theme-bootstrap-recovery[role="alert"]').length,
    recoveryVisible: (() => {
      const notice = document.querySelector('#theme-bootstrap-recovery[role="alert"]');
      return Boolean(notice && notice.getClientRects().length && getComputedStyle(notice).visibility !== 'hidden');
    })(),
    pageMode: document.querySelector('[data-page-mode]')?.getAttribute('data-page-mode') || '',
    windowVariant: document.querySelector('[data-window-variant]')?.getAttribute('data-window-variant') || ''
  }));
}

async function verifiedAsset(assetRoot, relativePath) {
  const url = new URL(`${assetRoot}${relativePath}`, baseUrl);
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `${relativePath}: remote asset HTTP ${response.status}`);
  const remote = Buffer.from(await response.arrayBuffer());
  const local = await fs.readFile(path.join(root, 'templates/assets', relativePath));
  assert.equal(digest(remote), digest(local), `${relativePath}: served bytes differ from the local build`);
  return { path: url.pathname, bytes: remote, sha256: digest(remote) };
}

async function runScenario(browser, { name, asset, check }) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || /Alpine has already been initialized/.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__SHELL_STALL_EVENTS__ = { init: 0, initialized: 0 };
    document.addEventListener('alpine:init', () => { window.__SHELL_STALL_EVENTS__.init += 1; });
    document.addEventListener('alpine:initialized', () => { window.__SHELL_STALL_EVENTS__.initialized += 1; });
  });

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let intercepted = 0;
  let delivered = 0;
  const injectionErrors = [];
  await page.route((url) => url.pathname === asset.path, async (route) => {
    intercepted += 1;
    await held;
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: asset.bytes });
      delivered += 1;
    } catch (error) {
      injectionErrors.push(String(error?.message || error));
    }
  });

  let result;
  try {
    const response = await page.goto(`${baseUrl}/`, { waitUntil: 'commit', timeout: 15000 });
    assert.equal(response?.status(), 200, `${name}: home HTTP ${response?.status()}`);
    result = await check({ page, release, getIntercepted: () => intercepted, getDelivered: () => delivered });
    assert.equal(injectionErrors.length, 0, `${name}: fault injection failed: ${injectionErrors.join('; ')}`);
    return { name, status: 'passed', intercepted, delivered, consoleErrors, pageErrors, ...result };
  } catch (error) {
    const state = await snapshot(page).catch(() => null);
    return { name, status: 'failed', reason: error.message, intercepted, delivered, state, consoleErrors, pageErrors, injectionErrors };
  } finally {
    release();
    await context.close();
  }
}

const identity = await readLiveBuildContext(baseUrl);
if (expectedRevision) {
  assert.equal(identity.build.revision, expectedRevision, 'unexpected active build; refusing to test a different revision');
}
const manifest = JSON.parse(await fs.readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
const shellPath = manifest['shell-core']?.js?.[0];
assert.ok(shellPath?.includes('/assets/'), 'shell asset root is unavailable');
const assetRoot = shellPath.slice(0, shellPath.indexOf('/assets/') + '/assets/'.length);
const [optional, required] = await Promise.all([
  verifiedAsset(assetRoot, optionalChunk), verifiedAsset(assetRoot, requiredChunk)
]);

const browser = await chromium.launch({ headless: true });
let results;
try {
  results = [];
  results.push(await runScenario(browser, {
    name: 'optional-theme-config-chunk-pending', asset: optional,
    async check({ page, getIntercepted }) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (getIntercepted() > 0 || (await snapshot(page)).alpineStarted) break;
        await delay(100);
      }
      assert.equal(getIntercepted(), 0, 'optional theme-config chunk was requested on initial page load');
      // Keep the route held long enough to catch eager requests scheduled just after Alpine.start().
      await delay(800);
      const state = await snapshot(page);
      assert.ok(state.pageMode && state.windowVariant, 'ordinary page lacks its Shell protocol');
      assert.equal(getIntercepted(), 0, 'optional theme-config chunk was requested on initial page load');
      assert.equal(state.mainLoaded, true, 'Shell did not initialize while the optional chunk was pending');
      assert.equal(state.alpineStarted, true, 'Alpine did not start while the optional chunk was pending');
      assert.equal(state.alpineInitEvents, 1, 'Alpine initialized more than once');
      assert.equal(state.alpineInitializedEvents, 1, 'Alpine completion fired more than once');
      assert.equal(state.recoveryCount, 0, 'optional chunk caused a bootstrap recovery notice');
      assert.equal(state.bootstrapError, '', 'optional chunk caused a bootstrap error');
      return { state };
    }
  }));

  results.push(await runScenario(browser, {
    name: 'required-shell-chunk-pending-and-late', asset: required,
    async check({ page, release, getIntercepted, getDelivered }) {
      await page.locator('#theme-bootstrap-recovery[role="alert"]').waitFor({ state: 'visible', timeout: 21000 });
      await page.evaluate(() => window.__THEME_BOOTSTRAP_READY__);
      const timedOut = await snapshot(page);
      assert.ok(getIntercepted() > 0, 'required Shell chunk was never requested');
      assert.equal(timedOut.recoveryCount, 1, 'required chunk timeout must show exactly one recovery notice');
      assert.equal(timedOut.recoveryVisible, true, 'recovery notice must be visible');
      assert.match(timedOut.bootstrapError, /Theme Shell module timed out:/);
      assert.equal(timedOut.bootstrapCancelled, true, 'timed-out bootstrap must fence late imports');
      assert.equal(timedOut.mainLoaded, false, 'Shell initialized before the required chunk completed');
      assert.equal(timedOut.alpineInitEvents, 0, 'Alpine initialized before the required chunk completed');

      const finished = page.waitForEvent('requestfinished', {
        predicate: (request) => new URL(request.url()).pathname === required.path,
        timeout: 7000
      });
      release();
      await finished;
      await delay(800);
      const late = await snapshot(page);
      assert.ok(getDelivered() > 0, 'fault injection did not deliver the late chunk');
      assert.equal(late.recoveryCount, 1, 'late chunk duplicated the recovery notice');
      assert.equal(late.mainLoaded, false, 'late Shell chunk initialized after cancellation');
      assert.equal(late.alpineStarted, false, 'late Shell chunk started Alpine after cancellation');
      assert.equal(late.alpineInitEvents, 0, 'late Shell chunk initialized Alpine');
      assert.equal(late.alpineInitializedEvents, 0, 'late Shell chunk completed Alpine initialization');
      return { timedOut, late };
    }
  }));
} finally {
  await browser.close();
}

const finalManifestResponse = await fetch(new URL(`${assetRoot}asset-manifest.json`, baseUrl), {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000)
});
assert.equal(finalManifestResponse.status, 200);
const finalManifest = await finalManifestResponse.json();
assert.deepEqual(finalManifest.__meta, identity.build, 'active build changed during the browser test');
const report = {
  site: baseUrl, build: identity.build, halo: identity.halo,
  chunks: { optional: { path: optional.path, sha256: optional.sha256 }, required: { path: required.path, sha256: required.sha256 } },
  results
};
console.log(JSON.stringify(report, null, 2));
if (results.some((result) => result.status !== 'passed')) process.exitCode = 1;
