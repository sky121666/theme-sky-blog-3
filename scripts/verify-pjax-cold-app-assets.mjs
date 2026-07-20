import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const navigationTimeoutMs = 30_000;
const photosAssetPattern = '**/assets/js/apps/photos/index.js*';
const alpineUndefinedPattern = /(?:photosExplorer|layoutMode|effectiveColCountValue) is not defined/i;

function absoluteUrl(pathname) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function installDelayedRequest(page, pattern, label) {
  const requested = deferred();
  const released = deferred();
  let intercepted = false;

  await page.route(pattern, async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    requested.resolve();
    await released.promise;
    await route.continue();
  });

  return {
    waitUntilRequested() {
      return withTimeout(requested.promise, navigationTimeoutMs, label);
    },
    release() {
      released.resolve();
    }
  };
}

function installDelayedPhotosAsset(page) {
  return installDelayedRequest(page, photosAssetPattern, 'photos app asset request');
}

function collectAlpineUndefinedErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => {
    const message = error?.message || String(error || '');
    if (alpineUndefinedPattern.test(message)) errors.push(`pageerror: ${message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (alpineUndefinedPattern.test(text)) errors.push(`console: ${text}`);
  });
  return errors;
}

async function openHome(page) {
  const response = await page.goto(absoluteUrl('/'), {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs
  });
  assert.equal(response?.status(), 200, 'home route must return 200');
  await page.waitForFunction(
    () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
    null,
    { timeout: navigationTimeoutMs }
  );
}

async function waitForRoute(page, pathname, appId) {
  await page.waitForFunction(
    ({ expectedPath, expectedApp }) => {
      const frame = document.getElementById('window-frame-root');
      return window.location.pathname === expectedPath
        && document.body?.dataset?.appId === expectedApp
        && frame
        && !frame.classList.contains('pjax-loading');
    },
    { expectedPath: pathname, expectedApp: appId },
    { timeout: navigationTimeoutMs }
  );
}

async function verifyColdPhotosGate(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);
  const assetGate = await installDelayedPhotosAsset(page);

  try {
    await openHome(page);
    await page.evaluate(() => {
      window.__PJAX_COLD_ASSET_PREVIOUS_FRAME__ = document.getElementById('window-frame-root');
      window.pjax.loadUrl('/photos');
    });
    await assetGate.waitUntilRequested();
    await page.waitForTimeout(250);

    const pendingState = await page.evaluate(() => ({
      pathname: window.location.pathname,
      sameFrame: document.getElementById('window-frame-root') === window.__PJAX_COLD_ASSET_PREVIOUS_FRAME__,
      appId: document.body?.dataset?.appId || ''
    }));
    assert.equal(pendingState.pathname, '/', 'slow app asset must gate the target page request');
    assert.equal(pendingState.sameFrame, true, 'PJAX must not replace the frame before the app registrar is ready');
    assert.notEqual(pendingState.appId, 'photos', 'body app state must stay on the current page while assets are pending');

    assetGate.release();
    await waitForRoute(page, '/photos', 'photos');
    await page.waitForTimeout(250);

    const photosState = await page.evaluate(() => {
      const root = document.querySelector('[x-data="photosExplorer"]');
      const data = root && window.Alpine?.$data ? window.Alpine.$data(root) : null;
      return {
        hasRoot: Boolean(root),
        layoutMode: data?.layoutMode,
        effectiveColCountValue: data?.effectiveColCountValue
      };
    });
    assert.equal(photosState.hasRoot, true, 'photos Alpine root must exist after navigation');
    assert.equal(photosState.layoutMode, 'square', 'photosExplorer must initialize before the target DOM is scanned');
    assert.equal(Number.isFinite(photosState.effectiveColCountValue), true, 'photosExplorer state must be usable');
    assert.deepEqual(errors, [], `cold Photos PJAX emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    assetGate.release();
    await page.close();
  }
}

async function verifyLatestNavigationWins(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);
  const assetGate = await installDelayedPhotosAsset(page);

  try {
    await openHome(page);
    await page.evaluate(() => {
      window.__PJAX_COLD_ASSET_SEND_COUNT__ = 0;
      document.addEventListener('pjax:send', () => {
        window.__PJAX_COLD_ASSET_SEND_COUNT__ += 1;
      });
      window.pjax.loadUrl('/photos');
    });
    await assetGate.waitUntilRequested();

    await page.evaluate(() => {
      window.pjax.loadUrl('/archives');
    });
    await waitForRoute(page, '/archives', 'explorer-archives');
    const historyState = await page.evaluate(() => ({
      index: window.history.state?.__browserNavIndex,
      depth: window.sessionStorage.getItem('sky_browser_nav_depth'),
      canGoBack: window.__browserCanGoBackWithinSite?.()
    }));
    assert.equal(historyState.index, 1, 'programmatic full PJAX must write the next browser navigation index');
    assert.equal(historyState.depth, '1', 'programmatic full PJAX must advance the session navigation depth');
    assert.equal(historyState.canGoBack, true, 'programmatic full PJAX must preserve in-site back navigation');
    assert.equal(
      await page.evaluate(() => window.__PJAX_COLD_ASSET_SEND_COUNT__),
      1,
      'only the latest navigation may start a PJAX request while the older app asset is pending'
    );

    assetGate.release();
    await page.waitForFunction(
      () => document.querySelector('script[data-app-script="photos"]')?.dataset?.appScriptState === 'ready',
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.waitForTimeout(300);

    const finalState = await page.evaluate(() => ({
      pathname: window.location.pathname,
      appId: document.body?.dataset?.appId || '',
      sendCount: window.__PJAX_COLD_ASSET_SEND_COUNT__
    }));
    assert.equal(finalState.pathname, '/archives', 'released stale asset gate must not override the latest route');
    assert.equal(finalState.appId, 'explorer-archives', 'released stale asset gate must not overwrite the latest app state');
    assert.equal(finalState.sendCount, 1, 'stale asset completion must not start another PJAX request');
    assert.deepEqual(errors, [], `latest-navigation test emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    assetGate.release();
    await page.close();
  }
}

async function verifySameVariantNavigationWins(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);
  const photosAssetGate = await installDelayedPhotosAsset(page);
  let detailRequestGate = null;

  try {
    const response = await page.goto(absoluteUrl('/moments'), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'moments route must return 200');
    await page.waitForFunction(
      () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
      null,
      { timeout: navigationTimeoutMs }
    );

    const detailHref = await page.locator('a.pjax-link[href^="/moments/"]:not([href*="#"])')
      .first()
      .getAttribute('href');
    assert.ok(detailHref, 'moments feed must expose a same-variant detail link');
    const detailPath = new URL(detailHref, `${baseUrl}/`).pathname;
    detailRequestGate = await installDelayedRequest(
      page,
      absoluteUrl(detailPath),
      'moments same-variant detail request'
    );

    await page.evaluate(() => {
      window.__PJAX_CROSS_MODE_STATE__ = { fullSendCount: 0, sameCompleteCount: 0 };
      document.addEventListener('pjax:send', () => {
        window.__PJAX_CROSS_MODE_STATE__.fullSendCount += 1;
      });
      document.addEventListener('pjax:same-variant-complete', () => {
        window.__PJAX_CROSS_MODE_STATE__.sameCompleteCount += 1;
      });
      window.pjax.loadUrl('/photos');
    });
    await photosAssetGate.waitUntilRequested();

    await page.locator(`a.pjax-link[href="${detailHref}"]`).first().click();
    await detailRequestGate.waitUntilRequested();

    // The blocked full navigation is intent 1 in this fresh document. Deliver
    // its error late while intent 2 (same-variant) is still waiting; the stale
    // event must not cancel or clean up the newer navigation.
    await page.evaluate(() => {
      const staleError = new Event('pjax:error', { bubbles: true, cancelable: true });
      staleError.__themeNavigationIntent = 1;
      document.dispatchEvent(staleError);
    });
    detailRequestGate.release();
    await waitForRoute(page, detailPath, 'moments');
    await page.waitForFunction(
      () => window.__PJAX_CROSS_MODE_STATE__?.sameCompleteCount === 1,
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.waitForTimeout(350);

    const beforeRelease = await page.evaluate(() => ({
      pathname: window.location.pathname,
      appId: document.body?.dataset?.appId || '',
      fullSendCount: window.__PJAX_CROSS_MODE_STATE__?.fullSendCount || 0,
      sameCompleteCount: window.__PJAX_CROSS_MODE_STATE__?.sameCompleteCount || 0,
      nprogressVisible: Boolean(document.getElementById('nprogress')),
      navigationPending: document.documentElement.classList.contains('theme-navigation-pending')
    }));
    assert.equal(beforeRelease.pathname, detailPath, 'same-variant navigation must complete while the older full gate is pending');
    assert.equal(beforeRelease.appId, 'moments');
    assert.equal(beforeRelease.fullSendCount, 0, 'blocked older full gate must not start its page request');
    assert.equal(beforeRelease.sameCompleteCount, 1, 'stale pjax:error must not cancel the newer same-variant request');
    assert.equal(beforeRelease.nprogressVisible, false, 'same-variant completion must clear progress inherited from the older full gate');
    assert.equal(beforeRelease.navigationPending, false, 'same-variant completion must clear transient navigation UI state');

    photosAssetGate.release();
    await page.waitForFunction(
      () => document.querySelector('script[data-app-script="photos"]')?.dataset?.appScriptState === 'ready',
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.waitForTimeout(300);

    const finalState = await page.evaluate(() => ({
      pathname: window.location.pathname,
      appId: document.body?.dataset?.appId || '',
      fullSendCount: window.__PJAX_CROSS_MODE_STATE__?.fullSendCount || 0,
      nprogressVisible: Boolean(document.getElementById('nprogress'))
    }));
    assert.equal(finalState.pathname, detailPath, 'released older full gate must not override a completed same-variant route');
    assert.equal(finalState.appId, 'moments');
    assert.equal(finalState.fullSendCount, 0, 'released stale full gate must remain request-free');
    assert.equal(finalState.nprogressVisible, false, 'released stale gate must not restart global progress');
    assert.deepEqual(errors, [], `cross-mode navigation emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    detailRequestGate?.release();
    photosAssetGate.release();
    await page.close();
  }
}

async function verifyDelayedViewTransitionLatestWins(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);

  try {
    const response = await page.goto(absoluteUrl('/photos'), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'photos route must return 200');
    await page.waitForFunction(
      () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
      null,
      { timeout: navigationTimeoutMs }
    );

    const albumsHref = '/photos?view=albums';
    const groupHref = await page.locator('a.photos-sidebar-item.pjax-link[href*="?group="]')
      .first()
      .getAttribute('href');
    assert.ok(groupHref, 'photos page must expose a second same-variant group route');
    const groupUrl = new URL(groupHref, `${baseUrl}/`);

    await page.evaluate(() => {
      window.__PJAX_VIEW_TRANSITION_STATE__ = {
        callCount: 0,
        completeCount: 0,
        firstReleased: false,
        releaseFirst: null
      };
      document.addEventListener('pjax:same-variant-complete', () => {
        window.__PJAX_VIEW_TRANSITION_STATE__.completeCount += 1;
      });
      document.startViewTransition = (callback) => {
        const state = window.__PJAX_VIEW_TRANSITION_STATE__;
        state.callCount += 1;

        if (state.callCount === 1) {
          let resolveUpdate;
          const updateCallbackDone = new Promise((resolve) => {
            resolveUpdate = resolve;
          });
          state.releaseFirst = () => {
            if (state.firstReleased) return;
            state.firstReleased = true;
            Promise.resolve()
              .then(callback)
              .then(resolveUpdate, resolveUpdate);
          };
          return {
            updateCallbackDone,
            ready: Promise.resolve(),
            finished: updateCallbackDone,
            skipTransition: state.releaseFirst
          };
        }

        const updateCallbackDone = Promise.resolve().then(callback);
        return {
          updateCallbackDone,
          ready: Promise.resolve(),
          finished: updateCallbackDone,
          skipTransition() {}
        };
      };
    });

    await page.locator(`a.pjax-link[href="${albumsHref}"]`).first().click();
    await page.waitForFunction(
      () => window.__PJAX_VIEW_TRANSITION_STATE__?.callCount === 1,
      null,
      { timeout: navigationTimeoutMs }
    );

    await page.locator(`a.pjax-link[href="${groupHref}"]`).first().click();
    await page.waitForFunction(
      ({ pathname, search }) => window.location.pathname === pathname
        && window.location.search === search
        && window.__PJAX_VIEW_TRANSITION_STATE__?.completeCount === 1,
      { pathname: groupUrl.pathname, search: groupUrl.search },
      { timeout: navigationTimeoutMs }
    );
    await page.waitForTimeout(300);

    const beforeRelease = await page.evaluate(() => ({
      activeHref: document.querySelector('.photos-sidebar-item.is-active')?.getAttribute('href') || '',
      activeApp: window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId || '',
      completeCount: window.__PJAX_VIEW_TRANSITION_STATE__?.completeCount || 0
    }));
    assert.equal(beforeRelease.activeHref, groupHref, 'newer Photos navigation must own the visible active group');
    assert.equal(beforeRelease.activeApp, 'photos', 'newer Photos lifecycle must be active before releasing the old callback');

    await page.evaluate(() => {
      window.__PJAX_VIEW_TRANSITION_STATE__?.releaseFirst?.();
    });
    await page.waitForFunction(
      () => window.__PJAX_VIEW_TRANSITION_STATE__?.firstReleased === true,
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.waitForTimeout(300);

    const finalState = await page.evaluate(() => ({
      pathname: window.location.pathname,
      search: window.location.search,
      activeHref: document.querySelector('.photos-sidebar-item.is-active')?.getAttribute('href') || '',
      activeApp: window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId || '',
      completeCount: window.__PJAX_VIEW_TRANSITION_STATE__?.completeCount || 0
    }));
    assert.equal(finalState.pathname, groupUrl.pathname);
    assert.equal(finalState.search, groupUrl.search);
    assert.equal(finalState.activeHref, groupHref, 'released stale View Transition callback must not overwrite the newer DOM');
    assert.equal(finalState.activeApp, 'photos', 'released stale callback must not deactivate the newer Photos lifecycle');
    assert.equal(finalState.completeCount, 1, 'stale View Transition navigation must not emit a completion event');
    assert.deepEqual(errors, [], `delayed View Transition emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    await page.close();
  }
}

async function verifySkippedViewTransitionFallsBack(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);

  try {
    const response = await page.goto(absoluteUrl('/photos'), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'photos route must return 200');
    await page.waitForFunction(
      () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
      null,
      { timeout: navigationTimeoutMs }
    );

    await page.evaluate(() => {
      window.__PJAX_SKIPPED_TRANSITION_STATE__ = {
        fullSendCount: 0,
        fullCompleteCount: 0,
        sameCompleteCount: 0
      };
      document.addEventListener('pjax:send', () => {
        window.__PJAX_SKIPPED_TRANSITION_STATE__.fullSendCount += 1;
      });
      document.addEventListener('pjax:complete', () => {
        window.__PJAX_SKIPPED_TRANSITION_STATE__.fullCompleteCount += 1;
      });
      document.addEventListener('pjax:same-variant-complete', () => {
        window.__PJAX_SKIPPED_TRANSITION_STATE__.sameCompleteCount += 1;
      });
      document.startViewTransition = () => ({
        updateCallbackDone: Promise.resolve(),
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition() {}
      });
    });

    await page.locator('a.pjax-link[href="/photos?view=albums"]').first().click();
    await page.waitForFunction(
      () => window.location.pathname === '/photos'
        && window.location.search === '?view=albums'
        && document.querySelector('.photos-sidebar-item.is-active')?.getAttribute('href') === '/photos?view=albums'
        && window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullSendCount === 1
        && window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullCompleteCount === 1
        && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'),
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.waitForFunction(
      () => !document.getElementById('nprogress'),
      null,
      { timeout: navigationTimeoutMs }
    );

    const state = await page.evaluate(() => ({
      appId: document.body?.dataset?.appId || '',
      activeApp: window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId || '',
      fullSendCount: window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullSendCount || 0,
      fullCompleteCount: window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullCompleteCount || 0,
      sameCompleteCount: window.__PJAX_SKIPPED_TRANSITION_STATE__?.sameCompleteCount || 0,
      nprogressVisible: Boolean(document.getElementById('nprogress'))
    }));
    assert.equal(state.appId, 'photos');
    assert.equal(state.activeApp, 'photos', 'fallback full PJAX must activate the Photos lifecycle');
    assert.equal(state.fullSendCount, 1, 'a skipped View Transition callback must fall back exactly once');
    assert.equal(state.fullCompleteCount, 1, 'fallback full PJAX must complete exactly once');
    assert.equal(state.sameCompleteCount, 0, 'a skipped content swap must not report same-variant success');
    assert.equal(state.nprogressVisible, false, 'fallback completion must clear global progress');
    assert.deepEqual(errors, [], `skipped View Transition fallback emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyColdPhotosGate(browser);
  await verifyLatestNavigationWins(browser);
  await verifySameVariantNavigationWins(browser);
  await verifyDelayedViewTransitionLatestWins(browser);
  await verifySkippedViewTransitionFallsBack(browser);
  console.log('pjax cold app asset gate passed');
} finally {
  await browser.close();
}
