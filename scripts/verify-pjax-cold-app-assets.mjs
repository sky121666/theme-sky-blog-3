import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const navigationTimeoutMs = 30_000;
const photosAssetPattern = '**/assets/js/apps/photos/index.js*';
const alpineUndefinedPattern = /(?:photosExplorer|layoutMode|effectiveColCountValue|photoCanPan|photoPanning|zoomLevel|panX|panY|commentsOpen|syncDetailChromeControls) is not defined/i;

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

async function clickHeaderRoute(page, pathname) {
  const clicked = await page.evaluate((targetPathname) => {
    const link = Array.from(document.querySelectorAll('.menubar a.pjax-link[href]'))
      .find((candidate) => {
        try {
          return new URL(candidate.href, window.location.origin).pathname === targetPathname;
        } catch (_error) {
          return false;
        }
      });
    if (!link) return false;
    link.click();
    return true;
  }, pathname);
  assert.equal(clicked, true, `header must expose a PJAX link for ${pathname}`);
}

async function verifyWarmExplorerCssHandoff(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    const response = await page.goto(absoluteUrl('/categories'), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'categories route must return 200');
    await page.waitForFunction(
      () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
      null,
      { timeout: navigationTimeoutMs }
    );

    await clickHeaderRoute(page, '/tags');
    await waitForRoute(page, '/tags', 'explorer-tags');
    await clickHeaderRoute(page, '/archives');
    await waitForRoute(page, '/archives', 'explorer-archives');

    const beforeReturn = await page.evaluate(() => {
      const categories = document.querySelector('link[data-app-css="explorer-categories"]');
      const archives = document.querySelector('link[data-app-css="explorer-archives"]');
      return {
        categoriesDisabled: categories?.disabled,
        archivesDisabled: archives?.disabled
      };
    });
    assert.equal(beforeReturn.categoriesDisabled, true, 'previously visited Categories CSS must begin inactive');
    assert.equal(beforeReturn.archivesDisabled, false, 'current Archives CSS must remain active');

    await page.evaluate(() => {
      window.__PJAX_EXPLORER_CSS_HANDOFF__ = null;
      document.addEventListener('pjax:send', () => {
        const categories = document.querySelector('link[data-app-css="explorer-categories"]');
        const archives = document.querySelector('link[data-app-css="explorer-archives"]');
        window.__PJAX_EXPLORER_CSS_HANDOFF__ = {
          categoriesDisabled: categories?.disabled,
          archivesDisabled: archives?.disabled
        };
      }, { once: true });
    });

    await clickHeaderRoute(page, '/categories');
    await waitForRoute(page, '/categories', 'explorer-categories');

    const afterReturn = await page.evaluate(() => {
      const categories = document.querySelector('link[data-app-css="explorer-categories"]');
      const archives = document.querySelector('link[data-app-css="explorer-archives"]');
      return {
        handoff: window.__PJAX_EXPLORER_CSS_HANDOFF__,
        categoriesDisabled: categories?.disabled,
        archivesDisabled: archives?.disabled,
        rootDisplay: getComputedStyle(document.querySelector('[data-app-root="explorer-categories"]')).display
      };
    });
    assert.equal(afterReturn.handoff?.categoriesDisabled, false, 'target CSS must be active before the Header PJAX request');
    assert.equal(afterReturn.handoff?.archivesDisabled, false, 'current CSS must stay active until the incoming DOM is ready');
    assert.equal(afterReturn.categoriesDisabled, false, 'Categories CSS must remain active after completion');
    assert.equal(afterReturn.archivesDisabled, true, 'old Archives CSS must be disabled after completion');
    assert.equal(afterReturn.rootDisplay, 'flex', 'returned Categories Finder must render with its app layout');
  } finally {
    await page.close();
  }
}

async function findVisiblePhotoDetail(page) {
  await page.waitForFunction(() => {
    const clip = document.querySelector('.photos-grid-scroll');
    if (!clip) return false;
    const clipRect = clip.getBoundingClientRect();
    return Array.from(document.querySelectorAll('a.photo-card[data-photo-name]')).some((card) => {
      const inner = card.querySelector('.photo-card-inner');
      const image = card.querySelector('img');
      if (!inner || !image?.complete || image.naturalWidth <= 0) return false;
      const rect = inner.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.top >= clipRect.top - 1
        && rect.left >= clipRect.left - 1
        && rect.right <= clipRect.right + 1
        && rect.bottom <= clipRect.bottom + 1;
    });
  }, null, { timeout: navigationTimeoutMs });

  const cards = page.locator('a.photo-card[data-photo-name]');
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const state = await cards.nth(index).evaluate((card) => {
      const inner = card.querySelector('.photo-card-inner');
      const clip = card.closest('.photos-grid-scroll');
      const image = card.querySelector('img');
      if (!inner || !clip) return null;
      const rect = inner.getBoundingClientRect();
      const clipRect = clip.getBoundingClientRect();
      return {
        href: card.getAttribute('href') || '',
        imageReady: Boolean(image?.complete && image.naturalWidth > 0),
        fullyVisible: rect.width > 0
          && rect.height > 0
          && rect.top >= clipRect.top - 1
          && rect.left >= clipRect.left - 1
          && rect.right <= clipRect.right + 1
          && rect.bottom <= clipRect.bottom + 1
      };
    });
    if (state?.href && state.imageReady && state.fullyVisible) {
      return { index, href: state.href, url: new URL(state.href, `${baseUrl}/`) };
    }
  }

  throw new Error('photos page must expose a fully visible, loaded detail card');
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

    const detail = await findVisiblePhotoDetail(page);
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

    await page.locator('a.photo-card[data-photo-name]').nth(detail.index).click();
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
      completeCount: window.__PJAX_VIEW_TRANSITION_STATE__?.completeCount || 0,
      callCount: window.__PJAX_VIEW_TRANSITION_STATE__?.callCount || 0,
      firstReleased: window.__PJAX_VIEW_TRANSITION_STATE__?.firstReleased === true
    }));
    assert.equal(beforeRelease.activeHref, groupHref, 'newer Photos navigation must own the visible active group');
    assert.equal(beforeRelease.activeApp, 'photos', 'newer Photos lifecycle must be active before releasing the old callback');
    assert.equal(beforeRelease.callCount, 1, 'list navigation must not start a second View Transition');
    assert.equal(beforeRelease.firstReleased, true, 'newer list navigation must cancel the delayed detail transition');

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

async function verifyRapidDetailViewTransitionLatestWins(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);

  try {
    const response = await page.goto(absoluteUrl('/photos'), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'photos route must return 200');
    await page.waitForFunction(
      () => Boolean(window.pjax?.loadUrl && window.__THEME_SHELL_CORE_LOADED__),
      null,
      { timeout: navigationTimeoutMs }
    );

    const detail = await findVisiblePhotoDetail(page);
    const detailResponse = await page.goto(detail.url.toString(), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs
    });
    assert.equal(detailResponse?.status(), 200, 'photo detail route must return 200');
    await page.waitForFunction(
      () => document.querySelector('[data-app-root="photos"]')?.dataset?.photosView === 'detail'
        && window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === 'photos'
        && document.querySelector('.photos-detail-neighbor.is-current[aria-current="true"]'),
      null,
      { timeout: navigationTimeoutMs }
    );

    const targets = await page.locator('.photos-detail-neighbor[data-photo-name]').evaluateAll((links) => {
      const currentIndex = links.findIndex((link) => link.matches('.is-current[aria-current="true"]'));
      const forwardIndexes = links
        .map((_link, index) => index)
        .filter((index) => index > currentIndex);
      const backwardIndexes = links
        .map((_link, index) => index)
        .filter((index) => index < currentIndex)
        .reverse();
      const candidateIndexes = (forwardIndexes.length >= 3 ? forwardIndexes : backwardIndexes)
        .slice(0, 3);
      return candidateIndexes.map((index) => ({
        href: links[index]?.getAttribute('href') || '',
        photoName: links[index]?.dataset.photoName || '',
      }));
    });
    assert.equal(targets.length, 3, 'detail filmstrip must expose three rapid-switch targets');
    assert.ok(targets.every((target) => target.href && target.photoName), 'rapid-switch targets must be addressable');

    await page.evaluate(async (hrefs) => {
      const imageSources = await Promise.all(hrefs.map(async (href) => {
        const response = await fetch(href, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await response.text();
        return new DOMParser().parseFromString(html, 'text/html')
          .querySelector('.photos-detail-figure img')
          ?.getAttribute('src') || '';
      }));
      await Promise.all(imageSources.filter(Boolean).map((src) => new Promise((resolve) => {
        const image = new Image();
        const finish = () => resolve();
        image.onload = async () => {
          try {
            await image.decode?.();
          } catch (_error) {
            // Loading is enough for this race-focused regression.
          }
          finish();
        };
        image.onerror = finish;
        image.src = src;
        if (image.complete) finish();
      })));
    }, targets.map((target) => target.href));

    await page.evaluate(() => {
      window.__PJAX_RAPID_DETAIL_STATE__ = {
        callCount: 0,
        callbackCount: 0,
        skipCount: 0,
        sameCompleteCount: 0,
        fullSendCount: 0,
        completedTargets: [],
        releaseFirstFinished: null,
      };
      document.addEventListener('pjax:same-variant-complete', (event) => {
        window.__PJAX_RAPID_DETAIL_STATE__.sameCompleteCount += 1;
        window.__PJAX_RAPID_DETAIL_STATE__.completedTargets.push(event.detail?.targetUrl || '');
      });
      document.addEventListener('pjax:send', () => {
        window.__PJAX_RAPID_DETAIL_STATE__.fullSendCount += 1;
      });

      document.startViewTransition = (callback) => {
        const state = window.__PJAX_RAPID_DETAIL_STATE__;
        state.callCount += 1;
        const updateCallbackDone = Promise.resolve().then(async () => {
          state.callbackCount += 1;
          return callback();
        });

        if (state.callCount === 1) {
          let resolveFinished;
          const finished = new Promise((resolve) => {
            resolveFinished = resolve;
          });
          state.releaseFirstFinished = resolveFinished;
          return {
            updateCallbackDone,
            ready: updateCallbackDone,
            finished,
            skipTransition() {
              state.skipCount += 1;
            }
          };
        }

        return {
          updateCallbackDone,
          ready: updateCallbackDone,
          finished: updateCallbackDone,
          skipTransition() {}
        };
      };
    });

    await page.locator(`.photos-detail-neighbor[href="${targets[0].href}"]`).click();
    const firstUrl = new URL(targets[0].href, `${baseUrl}/`);
    await page.waitForFunction(
      ({ pathname, search }) => window.location.pathname === pathname
        && window.location.search === search
        && window.__PJAX_RAPID_DETAIL_STATE__?.sameCompleteCount === 1,
      { pathname: firstUrl.pathname, search: firstUrl.search },
      { timeout: navigationTimeoutMs }
    );

    const firstState = await page.evaluate(() => ({
      callCount: window.__PJAX_RAPID_DETAIL_STATE__?.callCount || 0,
      callbackCount: window.__PJAX_RAPID_DETAIL_STATE__?.callbackCount || 0,
      skipCount: window.__PJAX_RAPID_DETAIL_STATE__?.skipCount || 0,
      owner: document.documentElement.getAttribute('data-photos-view-transition-owner') || '',
    }));
    assert.equal(firstState.callCount, 1, 'first detail step must start one transition');
    assert.equal(firstState.callbackCount, 1, 'first detail step must swap once');
    assert.equal(firstState.skipCount, 0, 'first transition must remain active before rapid input');
    assert.ok(firstState.owner, 'first transition owner must remain active until its animation settles');

    await page.locator(`.photos-detail-neighbor[href="${targets[1].href}"]`).click();
    await page.waitForFunction(
      () => window.__PJAX_RAPID_DETAIL_STATE__?.skipCount === 1,
      null,
      { timeout: navigationTimeoutMs }
    );
    await page.locator(`.photos-detail-neighbor[href="${targets[2].href}"]`).click();
    await page.waitForTimeout(300);

    const blockedState = await page.evaluate(() => ({
      callCount: window.__PJAX_RAPID_DETAIL_STATE__?.callCount || 0,
      callbackCount: window.__PJAX_RAPID_DETAIL_STATE__?.callbackCount || 0,
      sameCompleteCount: window.__PJAX_RAPID_DETAIL_STATE__?.sameCompleteCount || 0,
      photoName: document.querySelector('.photos-detail-figure')?.dataset.photoName || '',
    }));
    assert.equal(blockedState.callCount, 1, 'old finished is pending: replacement transition must not start early');
    assert.equal(blockedState.callbackCount, 1, 'old finished is pending: replacement swap must not run early');
    assert.equal(blockedState.sameCompleteCount, 1, 'old finished is pending: only the first route may be committed');
    assert.equal(blockedState.photoName, targets[0].photoName, 'old finished is pending: first committed photo must remain visible');

    await page.evaluate(() => {
      window.__PJAX_RAPID_DETAIL_STATE__?.releaseFirstFinished?.();
    });

    const finalUrl = new URL(targets[2].href, `${baseUrl}/`);
    await page.waitForFunction(
      ({ pathname, search, photoName }) => window.location.pathname === pathname
        && window.location.search === search
        && document.querySelector('.photos-detail-figure')?.dataset.photoName === photoName
        && document.querySelector('.photos-detail-neighbor.is-current[aria-current="true"]')?.dataset.photoName === photoName
        && window.__PJAX_RAPID_DETAIL_STATE__?.sameCompleteCount === 2
        && !document.documentElement.hasAttribute('data-photos-view-transition-owner'),
      { pathname: finalUrl.pathname, search: finalUrl.search, photoName: targets[2].photoName },
      { timeout: navigationTimeoutMs }
    );

    const finalState = await page.evaluate(() => ({
      callCount: window.__PJAX_RAPID_DETAIL_STATE__?.callCount || 0,
      callbackCount: window.__PJAX_RAPID_DETAIL_STATE__?.callbackCount || 0,
      skipCount: window.__PJAX_RAPID_DETAIL_STATE__?.skipCount || 0,
      sameCompleteCount: window.__PJAX_RAPID_DETAIL_STATE__?.sameCompleteCount || 0,
      fullSendCount: window.__PJAX_RAPID_DETAIL_STATE__?.fullSendCount || 0,
      completedTargets: window.__PJAX_RAPID_DETAIL_STATE__?.completedTargets || [],
      title: document.querySelector('[data-window-title]')?.textContent?.trim() || '',
      subtitle: document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '',
      shellTitle: document.querySelector('.photos-detail-shell')?.dataset.photosChromeTitle || '',
      shellSubtitle: document.querySelector('.photos-detail-shell')?.dataset.photosChromeSubtitle || '',
      rootClass: document.documentElement.classList.contains('photos-shared-view-transition'),
      rootOwner: document.documentElement.getAttribute('data-photos-view-transition-owner') || '',
      rootKind: document.documentElement.getAttribute('data-photos-view-transition-kind') || '',
      rootDirection: document.documentElement.getAttribute('data-photos-view-transition-direction') || '',
      inlineNameCount: document.querySelectorAll('[style*="view-transition-name"]').length,
    }));
    assert.equal(finalState.callCount, 2, 'three rapid intents must only start the first and latest transitions');
    assert.equal(finalState.callbackCount, 2, 'only the first and latest accepted intents may swap');
    assert.equal(finalState.skipCount, 1, 'new detail input must cancel the still-running first animation once');
    assert.equal(finalState.sameCompleteCount, 2, 'only first and latest detail routes may complete');
    assert.deepEqual(
      finalState.completedTargets.map((value) => new URL(value, `${baseUrl}/`).pathname),
      [new URL(targets[0].href, `${baseUrl}/`).pathname, finalUrl.pathname],
      'superseded middle detail route must never emit completion'
    );
    assert.equal(finalState.fullSendCount, 0, 'rapid detail input must not fall back to full PJAX');
    assert.equal(finalState.title, finalState.shellTitle, 'final titlebar must belong to the latest photo');
    assert.equal(finalState.subtitle, finalState.shellSubtitle, 'final counter must belong to the latest photo');
    assert.equal(finalState.rootClass, false, 'rapid detail completion must clean the root class');
    assert.equal(finalState.rootOwner, '', 'rapid detail completion must clean the owner');
    assert.equal(finalState.rootKind, '', 'rapid detail completion must clean the transition kind');
    assert.equal(finalState.rootDirection, '', 'rapid detail completion must clean the direction');
    assert.equal(finalState.inlineNameCount, 0, 'rapid detail completion must clean inline transition names');
    assert.deepEqual(errors, [], `rapid detail transition emitted Alpine undefined errors:\n${errors.join('\n')}`);
  } finally {
    await page.close();
  }
}

async function verifySupersededLiveDecodeDoesNotDispatch(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = collectAlpineUndefinedErrors(page);

  try {
    const response = await page.goto(absoluteUrl('/photos'), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs
    });
    assert.equal(response?.status(), 200, 'photos route must return 200');
    const detail = await findVisiblePhotoDetail(page);
    const detailResponse = await page.goto(detail.url.toString(), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs
    });
    assert.equal(detailResponse?.status(), 200, 'photo detail route must return 200');
    await page.waitForFunction(
      () => document.querySelector('[data-app-root="photos"]')?.dataset.photosView === 'detail'
        && window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === 'photos',
      null,
      { timeout: navigationTimeoutMs }
    );

    const targets = await page.locator('.photos-detail-neighbor[data-photo-name]').evaluateAll((links) => {
      const currentIndex = links.findIndex((link) => link.matches('.is-current[aria-current="true"]'));
      const forward = links.filter((_link, index) => index > currentIndex);
      const backward = links.filter((_link, index) => index < currentIndex).reverse();
      return (forward.length >= 2 ? forward : backward).slice(0, 2).map((link) => ({
        href: link.getAttribute('href') || '',
        photoName: link.dataset.photoName || '',
      }));
    });
    assert.equal(targets.length, 2, 'live decode race needs two detail targets');
    assert.ok(targets.every((target) => target.href && target.photoName), 'live decode race targets must be addressable');
    const backHref = await page.locator('.photos-detail-titlebar-back').getAttribute('href');
    assert.ok(backHref, 'live decode race needs the persistent detail back link');

    await page.evaluate(async (hrefs) => {
      const sources = await Promise.all(hrefs.map(async (href) => {
        const response = await fetch(href, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await response.text();
        return new DOMParser().parseFromString(html, 'text/html')
          .querySelector('.photos-detail-figure img')
          ?.getAttribute('src') || '';
      }));
      await Promise.all(sources.filter(Boolean).map((src) => new Promise((resolve) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = resolve;
        image.src = src;
        if (image.complete) resolve();
      })));
    }, targets.map((target) => target.href));

    await page.evaluate(() => {
      const state = {
        callCount: 0,
        liveDecodeStarted: 0,
        sameCompleteTargets: [],
        contentSwappedPhotos: [],
        fullSendCount: 0,
        titlebar: document.querySelector('[data-window-titlebar]'),
      };
      window.__PJAX_LIVE_DECODE_RACE__ = state;
      const nativeStartViewTransition = document.startViewTransition.bind(document);
      const nativeDecode = HTMLImageElement.prototype.decode;

      document.startViewTransition = (callback) => {
        state.callCount += 1;
        return nativeStartViewTransition(callback);
      };
      HTMLImageElement.prototype.decode = function (...args) {
        if (this.isConnected
          && this.closest?.('.photos-detail-figure')
          && state.liveDecodeStarted === 0) {
          state.liveDecodeStarted += 1;
          queueMicrotask(() => {
            document.querySelector('.photos-detail-titlebar-back')?.click();
          });
          return new Promise(() => {});
        }
        return nativeDecode.apply(this, args);
      };
      document.addEventListener('theme:content-swapped', () => {
        state.contentSwappedPhotos.push(
          document.querySelector('.photos-detail-figure')?.dataset.photoName || ''
        );
      });
      document.addEventListener('pjax:same-variant-complete', (event) => {
        state.sameCompleteTargets.push(event.detail?.targetUrl || '');
      });
      document.addEventListener('pjax:send', () => {
        state.fullSendCount += 1;
      });
    });

    await page.locator(`.photos-detail-neighbor[href="${targets[0].href}"]`).click();

    const finalUrl = new URL(backHref, `${baseUrl}/`);
    try {
      await page.waitForFunction(
        ({ pathname, search }) => window.location.pathname === pathname
          && window.location.search === search
          && document.querySelector('[data-app-root="photos"]')?.dataset.photosView !== 'detail'
          && window.__PJAX_LIVE_DECODE_RACE__?.sameCompleteTargets.length === 1
          && !document.documentElement.hasAttribute('data-photos-view-transition-owner'),
        { pathname: finalUrl.pathname, search: finalUrl.search },
        { timeout: navigationTimeoutMs }
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        path: `${window.location.pathname}${window.location.search}`,
        photosView: document.querySelector('[data-app-root="photos"]')?.dataset.photosView || '',
        state: window.__PJAX_LIVE_DECODE_RACE__ || null,
        rootOwner: document.documentElement.getAttribute('data-photos-view-transition-owner') || '',
      })).catch(() => ({ pageClosed: true }));
      throw new Error(`superseded live decode timed out: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      callCount: window.__PJAX_LIVE_DECODE_RACE__?.callCount || 0,
      sameCompleteTargets: window.__PJAX_LIVE_DECODE_RACE__?.sameCompleteTargets || [],
      contentSwappedPhotos: window.__PJAX_LIVE_DECODE_RACE__?.contentSwappedPhotos || [],
      fullSendCount: window.__PJAX_LIVE_DECODE_RACE__?.fullSendCount || 0,
      title: document.querySelector('[data-window-title]')?.textContent?.trim() || '',
      subtitle: document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '',
      shellTitle: document.querySelector('[data-app-root="photos"]')?.dataset.photosChromeTitle || '',
      shellSubtitle: document.querySelector('[data-app-root="photos"]')?.dataset.photosChromeSubtitle || '',
      rootClass: document.documentElement.classList.contains('photos-shared-view-transition'),
      inlineNameCount: document.querySelectorAll('[style*="view-transition-name"]').length,
    }));
    assert.equal(state.callCount, 1, 'detail back navigation must cancel the stale transition without starting a reverse animation');
    assert.deepEqual(
      state.sameCompleteTargets.map((value) => new URL(value, `${baseUrl}/`).pathname),
      [finalUrl.pathname],
      'stale live decode callback must not emit same-variant completion'
    );
    assert.deepEqual(state.contentSwappedPhotos, [''], 'stale live decode callback must not dispatch content-swapped');
    assert.equal(state.fullSendCount, 0, 'superseded live decode must remain inside same-variant PJAX');
    assert.equal(state.title, state.shellTitle, 'latest Photos list title must win after superseding live decode');
    assert.equal(state.subtitle, state.shellSubtitle, 'latest Photos list subtitle must win after superseding live decode');
    assert.equal(state.rootClass, false, 'superseded live decode must clean the root transition class');
    assert.equal(state.inlineNameCount, 0, 'superseded live decode must clean inline transition names');
    assert.deepEqual(errors, [], `superseded live decode emitted Alpine undefined errors:\n${errors.join('\n')}`);
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
    const detail = await findVisiblePhotoDetail(page);

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

    await page.locator('a.photo-card[data-photo-name]').nth(detail.index).click();
    await page.waitForFunction(
      ({ pathname, search }) => window.location.pathname === pathname
        && window.location.search === search
        && document.querySelector('[data-app-root="photos"]')?.dataset?.photosView === 'detail'
        && window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullSendCount === 1
        && window.__PJAX_SKIPPED_TRANSITION_STATE__?.fullCompleteCount === 1
        && !document.getElementById('window-frame-root')?.classList.contains('pjax-loading'),
      { pathname: detail.url.pathname, search: detail.url.search },
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
  await verifyWarmExplorerCssHandoff(browser);
  await verifyColdPhotosGate(browser);
  await verifyLatestNavigationWins(browser);
  await verifySameVariantNavigationWins(browser);
  await verifyDelayedViewTransitionLatestWins(browser);
  await verifyRapidDetailViewTransitionLatestWins(browser);
  await verifySupersededLiveDecodeDoesNotDispatch(browser);
  await verifySkippedViewTransitionFallsBack(browser);
  console.log('pjax cold app asset gate passed');
} finally {
  await browser.close();
}
