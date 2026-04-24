/**
 * Pjax engine initialization — link management, Observer, event handlers
 *
 * CSS routing:   ./css-router.js
 * SEO sync:      ./seo.js
 * Protocol:      ./protocol.js
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import {
  activateCurrentPageApp,
  activatePageApp,
  deactivateCurrentPageApp,
  getActivePageAppDocumentState
} from '../../shared/page-app.js';
import { createLogger } from '../../shared/debug.js';
import {
  isPjaxManagedLink,
  markPjaxLinks,
  attachDynamicLinks,
  PJAX_MANAGED_ATTR
} from './link-attach.js';
import {
  getCurrentPageApp,
  setCurrentPageApp,
  ensureAppAssetsLoaded,
  syncAppCss,
  parsePageAppFromResponse,
  inferPageAppForNavigation,
  inferPageAppFromUrl
} from './css-router.js';
import { inferWindowVariantFromUrl } from '../../../../../shell-core/runtime/route-manifest.js';
import {
  isContentSwitchAllowed,
  supportsSameVariantContentSwitch
} from '../../../../../shell-core/runtime/app-manifests.js';
import { syncSeoHeadFromResponse } from './seo.js';
import {
  syncBodyDatasetFromResponse,
  parseWindowVariantFromResponse,
  parseContentFromResponse
} from './protocol.js';
import {
  createWindowLoadingController,
  showOverlay,
  hideOverlay,
  hasLoadingOverlay,
  setBusyState,
  clearBusyState
} from './loading-controller.js';
import {
  closeTransientNavigationUi,
  clearTransientNavigationUi
} from './navigation-ui.js';

const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');

function parsePageModeFromResponse(html) {
  if (!html) return '';
  const m = html.match(/data-page-mode="([^"]*)"/);
  return m ? m[1].trim() : '';
}

// ── Reader mobile back-stack depth (site-internal only) ──

const BROWSER_NAV_DEPTH_KEY = 'sky_browser_nav_depth';
const BROWSER_NAV_INDEX_KEY = '__browserNavIndex';
const BROWSER_NAV_CHROME_KEY = '__browserNavChrome';

function createBrowserNavUid() {
  return `pjax${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readBrowserNavDepth() {
  try {
    const raw = window.sessionStorage.getItem(BROWSER_NAV_DEPTH_KEY);
    const value = Number.parseInt(raw || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch (_e) {
    return null;
  }
}

function writeBrowserNavDepth(value) {
  try {
    window.sessionStorage.setItem(BROWSER_NAV_DEPTH_KEY, String(Math.max(0, value)));
  } catch (_e) {
    // Ignore sessionStorage failures; fallback button will still land on /
  }
}

function getBrowserNavDepth() {
  return readBrowserNavDepth() ?? 0;
}

function readBrowserNavIndexFromState(state = window.history.state) {
  const value = state?.[BROWSER_NAV_INDEX_KEY];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function getCurrentScrollPos() {
  return [
    document.documentElement.scrollLeft || document.body.scrollLeft || window.scrollX || 0,
    document.documentElement.scrollTop || document.body.scrollTop || window.scrollY || 0
  ];
}

function readBrowserNavChromeSnapshot(overrides = {}) {
  const titleEl = document.querySelector('[data-window-title]');
  const subtitleEl = document.querySelector('[data-window-subtitle]');
  return {
    windowTitle: overrides.windowTitle ?? titleEl?.textContent?.trim() ?? '',
    windowSubtitle: overrides.windowSubtitle ?? subtitleEl?.textContent?.trim() ?? ''
  };
}

function applyBrowserNavChromeState(state = window.history.state) {
  if (!state || typeof state !== 'object') return;

  if (state.title) {
    document.title = state.title;
  }

  const chrome = state[BROWSER_NAV_CHROME_KEY];
  if (!chrome || typeof chrome !== 'object') return;

  const titleEl = document.querySelector('[data-window-title]');
  if (titleEl && typeof chrome.windowTitle === 'string' && chrome.windowTitle) {
    titleEl.textContent = chrome.windowTitle;
  }

  const subtitleEl = document.querySelector('[data-window-subtitle]');
  if (subtitleEl && typeof chrome.windowSubtitle === 'string') {
    subtitleEl.textContent = chrome.windowSubtitle;
  }
}

function buildBrowserNavState(index, title = document.title, url = window.location.href, chromeOverrides = {}, options = {}) {
  const {
    baseState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {},
    uid = baseState.uid || createBrowserNavUid(),
    scrollPos = baseState.scrollPos || getCurrentScrollPos()
  } = options;

  return {
    ...baseState,
    url: url || baseState.url || window.location.href,
    title: title || baseState.title || document.title,
    uid,
    scrollPos,
    [BROWSER_NAV_INDEX_KEY]: index,
    [BROWSER_NAV_CHROME_KEY]: readBrowserNavChromeSnapshot(chromeOverrides)
  };
}

function replaceBrowserNavState(index, title = document.title, url = window.location.href, chromeOverrides = {}) {
  try {
    const nextState = buildBrowserNavState(index, title, url, chromeOverrides);
    window.history.replaceState(nextState, nextState.title, nextState.url);
  } catch (_e) {
    // Ignore replaceState failures; sessionStorage still tracks the fallback depth.
  }
}

function pushBrowserNavState(index, title, url, chromeOverrides = {}) {
  const uid = createBrowserNavUid();
  const nextState = buildBrowserNavState(index, title, url, chromeOverrides, {
    uid,
    scrollPos: [0, 0]
  });
  window.history.pushState(nextState, nextState.title, nextState.url);
  if (window.pjax) {
    window.pjax.lastUid = uid;
    window.pjax.maxUid = uid;
  }
}

function resolveNavigationHref(request, href) {
  if (typeof href === 'string' && href) return href;
  if (request?.responseURL) return request.responseURL;

  try {
    const pjaxUrl = request?.getResponseHeader?.('X-PJAX-URL');
    if (pjaxUrl) return pjaxUrl;
    const redirectedTo = request?.getResponseHeader?.('X-XHR-Redirected-To');
    if (redirectedTo) return redirectedTo;
  } catch (_e) {
    // Ignore header access failures and fall through to current location.
  }

  return window.location.href;
}

function syncBrowserNavDepth(index) {
  const safeIndex = Math.max(0, index);
  writeBrowserNavDepth(safeIndex);
  return safeIndex;
}

function initializeBrowserNavDepth() {
  const stateIndex = readBrowserNavIndexFromState();
  if (stateIndex !== null) {
    syncBrowserNavDepth(stateIndex);
    return;
  }

  const existing = readBrowserNavDepth();
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  const navType = navEntry?.type || '';

  if (navType === 'reload' && existing !== null) {
    replaceBrowserNavState(existing);
    return;
  }

  let hasSameOriginReferrer = false;
  try {
    hasSameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch (_e) {
    hasSameOriginReferrer = false;
  }

  const hasBackEntryInThisTab = window.history.length > 1;

  if (!hasSameOriginReferrer || !hasBackEntryInThisTab) {
    replaceBrowserNavState(syncBrowserNavDepth(0));
    return;
  }

  replaceBrowserNavState(syncBrowserNavDepth(Math.max(existing ?? 0, 1)));
}

function installBrowserNavHelpers() {
  window.__browserCanGoBackWithinSite = function() {
    return getBrowserNavDepth() > 0;
  };

  window.__browserBackOrHome = function(fallback = '/') {
    if (getBrowserNavDepth() > 0) {
      window.history.back();
      return;
    }
    window.location.href = fallback;
  };
}

// ── Performance instrumentation (debug mode only) ──

function perfMark(label) {
  if (!document.body?.dataset.debug) return;
  performance.mark(`pjax:${label}`);
}

function perfMeasure(name, startLabel, endLabel) {
  if (!document.body?.dataset.debug) return;
  try {
    performance.measure(`pjax:${name}`, `pjax:${startLabel}`, `pjax:${endLabel}`);
    const entry = performance.getEntriesByName(`pjax:${name}`).pop();
    if (entry) pjaxLog(`⏱ ${name}: ${entry.duration.toFixed(1)}ms`);
  } catch (_e) { /* marks may not exist */ }
}

// ── Link management (shared via link-attach.js) ──

const PJAX_LINK_SELECTOR = `a.pjax-link[${PJAX_MANAGED_ATTR}="true"]:not([target='_blank'])`;

function replayPjaxScripts(root) {
  if (!root) return;

  root.querySelectorAll('script[data-pjax]').forEach((oldScript) => {
    const script = document.createElement('script');

    Array.from(oldScript.attributes).forEach((attr) => {
      script.setAttribute(attr.name, attr.value);
    });

    script.textContent = oldScript.textContent;
    oldScript.replaceWith(script);
  });
}

function startTopProgress() {
  NProgress.start();
}

function stopTopProgress() {
  NProgress.done();
}

// ── Pjax init ──

export function initPjax(Alpine) {
  setTimeout(() => {
    const isErrorPage = document.body?.dataset.errorPage === 'true';
    if (isErrorPage) { pjaxLog('skip: error page'); return; }

    NProgress.configure({
      minimum: 0.08,
      showSpinner: false,
      trickleSpeed: 120
    });

    markPjaxLinks(document);
    const initialLinks = document.querySelectorAll(PJAX_LINK_SELECTOR);
    pjaxLog('init: found', initialLinks.length, 'links, selector:', PJAX_LINK_SELECTOR);

    // Singleton guard — prevent duplicate Pjax in Vite dev mode
    if (window.pjax) {
      pjaxWarn('init: Pjax already exists, skipping duplicate');
      return;
    }

    const pjax = new Pjax({
      selectors: ["title", "#window-frame-root"],
      cacheBust: false,
      elements: PJAX_LINK_SELECTOR
    });

    // Non-200 responses: full-page redirect to show dedicated error page.
    const _origHandleResponse = pjax.handleResponse.bind(pjax);
    pjax.handleResponse = function(responseText, request, href, options) {
      const fallbackHref = resolveNavigationHref(request, href);
      if (responseText === null && request && request.status >= 400) {
        pjaxWarn('handleResponse: status', request.status, '→ full redirect', fallbackHref);
        stopTopProgress();
        window.location = fallbackHref;
        return;
      }
      if (responseText === false) {
        pjaxWarn('handleResponse: failed response → full redirect', fallbackHref);
        stopTopProgress();
        window.location = fallbackHref;
        return;
      }
      _origHandleResponse(responseText, request, href, options);
    };

    // Patch attachLink to deduplicate — MoOx/pjax's attachLink never checks
    // whether a handler is already bound.
    const ATTACHED = 'data-pjax-attached';
    const _origAttachLink = pjax.attachLink.bind(pjax);
    pjax.attachLink = function(link) {
      if (link.hasAttribute(ATTACHED)) return;
      link.setAttribute(ATTACHED, '1');
      _origAttachLink(link);
    };

    window.pjax = pjax;
    pjaxLog('init: Pjax created, #window-frame-root exists:', !!document.getElementById('window-frame-root'));

    const _origLoadUrl = pjax.loadUrl.bind(pjax);
    pjax.loadUrl = function(url, options = {}) {
      closeTransientNavigationUi();
      const targetApp = inferPageAppForNavigation(url, options?.triggerElement || null);
      return ensureAppAssetsLoaded(targetApp)
        .catch(() => {})
        .then(() => _origLoadUrl(url, options));
    };

    initializeBrowserNavDepth();
    installBrowserNavHelpers();

    window.addEventListener('popstate', (event) => {
      window._browserPopstatePending = true;
      const stateIndex = readBrowserNavIndexFromState(event.state);
      syncBrowserNavDepth(stateIndex ?? 0);
      applyBrowserNavChromeState(event.state);
    });

    // ── Dynamic link attachment (using shared link-attach.js) ──

    // ── One-time scan for desktop widget links (outside pjax-container) ──
    const desktopSurface = document.querySelector('.desktop-surface');
    if (desktopSurface) {
      attachDynamicLinks(desktopSurface);
    }

    // ── MutationObserver for pjax container only ──
    const pjaxContainer = document.getElementById('window-frame-root');
    if (pjaxContainer) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.querySelectorAll) {
              const unattached = node.querySelectorAll(`a.pjax-link[href]:not([${ATTACHED}])`);
              if (!unattached.length) continue;
              attachDynamicLinks(node);
            } else if (node.tagName === 'A' && !node.hasAttribute(ATTACHED)) {
              attachDynamicLinks(node.parentElement);
            }
          }
        }
      });
      observer.observe(pjaxContainer, { childList: true, subtree: true });
      pjaxLog('observer: watching #window-frame-root');
    }

    // ── Same-variant content-level navigation ──

    let _sameVariantPending = false;
    let _pjaxLoadingController = null;

    /**
     * Navigate within the same window variant — replace only the content root,
     * keep the window frame (titlebar, traffic lights, toolbar) intact.
     */
    async function navigateWithinVariant(targetUrl) {
      if (_sameVariantPending) return false;
      _sameVariantPending = true;

      perfMark('navStart');

      const contentRoot = document.querySelector('[data-window-content-root]');
      if (!contentRoot) {
        _sameVariantPending = false;
        return false;
      }

      const loadingController = showOverlay(contentRoot);
      const useTopProgress = !hasLoadingOverlay(loadingController);
      perfMark('overlayVisible');
      if (useTopProgress) {
        startTopProgress();
      }

      document.dispatchEvent(new CustomEvent('pjax:same-variant-send', { detail: { targetUrl: targetUrl } }));

      try {
        // Start loading the target app assets as early as possible.
        const targetApp = inferPageAppForNavigation(targetUrl);
        await ensureAppAssetsLoaded(targetApp);

        const resp = await fetch(targetUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const html = await resp.text();

        // Verify same variant — if variant changed, fall back to full PJAX
        const targetVariant = parseWindowVariantFromResponse(html);
        const currentVariant = document.body.dataset.windowVariant || '';
        if (targetVariant && targetVariant !== currentVariant) {
          pjaxLog('variant mismatch:', currentVariant, '->', targetVariant, '→ fallback');
          await hideOverlay(contentRoot, loadingController, { immediate: true });
          if (useTopProgress) {
            stopTopProgress();
          }
          _sameVariantPending = false;
          window.pjax.loadUrl(targetUrl);
          return true;
        }

        // Verify pageApp + pageMode compatibility via whitelist
        const responseApp = parsePageAppFromResponse(html) || '';
        const responseMode = parsePageModeFromResponse(html);
        const currentApp = getCurrentPageApp() || '';
        const currentMode = document.body.dataset.pageMode || '';

        if (!isContentSwitchAllowed(currentApp, currentMode) ||
            !isContentSwitchAllowed(responseApp, responseMode)) {
          pjaxLog('content switch not allowed:', currentApp, currentMode, '→', responseApp, responseMode, '→ fallback');
          await hideOverlay(contentRoot, loadingController, { immediate: true });
          if (useTopProgress) {
            stopTopProgress();
          }
          _sameVariantPending = false;
          window.pjax.loadUrl(targetUrl);
          return true;
        }

        // Parse content from response
        const parsed = parseContentFromResponse(html, '[data-window-content-root]');
        if (!parsed) throw new Error('Failed to parse content root from response');

        perfMark('contentReady');

        // Find the inner content container
        // For browser: #pjax-container; for moments: [data-window-content-variant]
        const contentContainer = contentRoot.querySelector('[data-window-content-variant]')
          || contentRoot.querySelector('#pjax-container');

        if (!contentContainer) throw new Error('No content container found');

        // Parse target's inner content (the content inside [data-window-content-variant] or #pjax-container)
        const parser = new DOMParser();
        const targetDoc = parser.parseFromString(html, 'text/html');
        const targetContentRoot = targetDoc.querySelector('[data-window-content-root]');
        const targetContainer = targetContentRoot?.querySelector('[data-window-content-variant]')
          || targetContentRoot?.querySelector('#pjax-container');

        deactivateCurrentPageApp();

        if (targetContainer) {
          contentContainer.innerHTML = targetContainer.innerHTML;
        } else {
          // Fallback: use full content root innerHTML
          contentContainer.innerHTML = parsed.contentHtml;
        }

        perfMark('contentSwap');

        // Sync state
        const nextNavIndex = getBrowserNavDepth() + 1;
        syncBrowserNavDepth(nextNavIndex);

        const nextApp = parsePageAppFromResponse(html) || targetApp;
        await ensureAppAssetsLoaded(nextApp);

        syncSeoHeadFromResponse(html);
        syncBodyDatasetFromResponse(html);
        setCurrentPageApp(nextApp);
        syncAppCss(nextApp);

        // Alpine + scripts
        replayPjaxScripts(contentContainer);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(contentContainer);
        }

        perfMark('AlpineInitDone');

        // Re-bind links
        attachDynamicLinks(contentContainer);

        activatePageApp(nextApp, contentContainer, {
          reason: 'same-variant',
          documentTitle: parsed.title
        });

        perfMark('pageReady');

        const documentState = getActivePageAppDocumentState() || {};
        const isDetail = contentContainer.querySelector('.moments-app--detail');
        const resolvedTitle = documentState.title || parsed.title;
        const historyChrome = {
          windowTitle: documentState.windowTitle || (isDetail ? '详情' : resolvedTitle),
          windowSubtitle: documentState.windowSubtitle || ''
        };
        pushBrowserNavState(nextNavIndex, resolvedTitle, targetUrl, historyChrome);
        syncBrowserNavDepth(nextNavIndex);

        // Sync back button fallback for scene change
        const backBtn = document.querySelector('.moments-titlebar-back');
        if (backBtn) {
          backBtn.dataset.fallback = isDetail ? '/moments' : '/';
        }

        // Scroll content to top
        contentRoot.scrollTop = 0;

        // Reinstall moments scroll listener for feed/detail scene change
        if (typeof window.__momentsScrollSetup === 'function') {
          window.__momentsScrollSetup();
        }

        // Performance logging
        perfMeasure('navStart→overlayVisible', 'navStart', 'overlayVisible');
        perfMeasure('overlayVisible→contentSwap', 'overlayVisible', 'contentSwap');
        perfMeasure('contentSwap→AlpineInitDone', 'contentSwap', 'AlpineInitDone');
        perfMeasure('AlpineInitDone→pageReady', 'AlpineInitDone', 'pageReady');
        perfMeasure('total', 'navStart', 'pageReady');

        if (useTopProgress) {
          stopTopProgress();
        }
        await hideOverlay(contentRoot, loadingController);

        pjaxLog('same-variant navigation complete:', targetUrl);

        // Deferred re-scan: desktop widgets
        const surface = document.querySelector('.desktop-surface');
        if (surface) {
          setTimeout(() => attachDynamicLinks(surface), 200);
        }

        _sameVariantPending = false;
        return true;
      } catch (err) {
        pjaxWarn('same-variant navigation failed:', err.message, '→ fallback');
        await hideOverlay(contentRoot, loadingController, { immediate: true });
        if (useTopProgress) {
          stopTopProgress();
        }
        _sameVariantPending = false;
        // Fallback to full PJAX
        try {
          window._browserForwardNavPending = true;
          window.pjax.loadUrl(targetUrl);
        } catch (_e) {
          window.location = targetUrl;
        }
        return true;
      }
    }

    // ── Pjax events ──

    document.addEventListener("pjax:send", (event) => {
      pjaxLog('event:send', event.triggerElement?.href || '');
      closeTransientNavigationUi();
      deactivateCurrentPageApp();
      startTopProgress();
      const targetHref = event?.triggerElement?.href || event?.requestOptions?.requestUrl;
      let targetVariant = '';
      try {
        targetVariant = targetHref ? inferWindowVariantFromUrl(new URL(targetHref, window.location.origin)) : '';
      } catch (_e) {
        targetVariant = '';
      }
      const currentVariant = document.body.dataset.windowVariant || '';
      const canUseWindowOverlay =
        currentVariant &&
        targetVariant &&
        currentVariant === targetVariant &&
        currentVariant !== 'none';
      const container = document.getElementById('window-frame-root');
      if (container) {
        container.classList.add('pjax-loading');
        _pjaxLoadingController = canUseWindowOverlay
          ? createWindowLoadingController(container).start()
          : null;
        if (!_pjaxLoadingController) {
          setBusyState(container, true);
        }
      }

      if (targetHref) {
        const targetApp = inferPageAppForNavigation(targetHref, event?.triggerElement);
        ensureAppAssetsLoaded(targetApp).catch(() => {});
        try {
          const targetUrl = new URL(targetHref, window.location.origin);
          const isSameOrigin = targetUrl.origin === window.location.origin;
          const isSameDocumentRoute =
            targetUrl.pathname === window.location.pathname &&
            targetUrl.search === window.location.search;

          if (isSameOrigin && !isSameDocumentRoute && !window._browserPopstatePending) {
            window._browserForwardNavPending = true;
          }
        } catch (_e) {
          // Ignore malformed URLs from non-standard links.
        }
      }
    });
    
    document.addEventListener("pjax:complete", async (event) => {
      stopTopProgress();

      if (window._browserForwardNavPending && !window._browserPopstatePending) {
        const nextNavIndex = getBrowserNavDepth() + 1;
        syncBrowserNavDepth(nextNavIndex);
        replaceBrowserNavState(nextNavIndex);
      }
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;

      const nextApp = parsePageAppFromResponse(event?.request?.responseText);
      await ensureAppAssetsLoaded(nextApp);
      syncSeoHeadFromResponse(event?.request?.responseText);
      syncBodyDatasetFromResponse(event?.request?.responseText);
      setCurrentPageApp(nextApp);
      syncAppCss(nextApp);

      const container = document.getElementById('window-frame-root');
      if (container) {
        replayPjaxScripts(container);

        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        attachDynamicLinks(container);

        activatePageApp(nextApp, container, {
          reason: 'pjax-complete',
          documentTitle: document.title
        });

        await _pjaxLoadingController?.finish();
        _pjaxLoadingController = null;
        container.classList.remove('pjax-loading');
        clearBusyState(container);

        // Deferred re-scan: desktop widgets re-render after pjax swap,
        // stripping data-pjax-attached. Catch them once after settle.
        const surface = document.querySelector('.desktop-surface');
        if (surface) {
          setTimeout(() => attachDynamicLinks(surface), 200);
        }
      }
      
      const windowManager = Alpine.store('windowManager');
      const isHome = window.location.pathname === '/';

      if (isHome) {
        window.preventAutoOpen = false;
        windowManager.showDesktop();
      } else if (windowManager.minimized) {
        window.preventAutoOpen = false;
        windowManager.revealAfterNavigation(document.title);
      } else if (window.preventAutoOpen) {
        window.preventAutoOpen = false;
      } else if (window._sameVariantJustCompleted) {
        window._sameVariantJustCompleted = false;
      } else {
        window.dispatchEvent(new CustomEvent('open-window'));
      }

      clearTransientNavigationUi();
    });

    document.addEventListener("pjax:error", (event) => {
      pjaxWarn('event:error', event.detail?.request?.status, event.detail?.error?.message);
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;
      stopTopProgress();
      const container = document.getElementById('window-frame-root');
      if (container) {
        container.classList.remove('pjax-loading');
      }
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      clearBusyState(container);
      activateCurrentPageApp(document, { reason: 'pjax-error-recover' });
      clearTransientNavigationUi();
    });

    // ── Same-variant capture handler (runs BEFORE Pjax click handler) ──
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link || link.target || link.hasAttribute('download') || link.href.startsWith('javascript:')) return;
      if (!link.classList?.contains('pjax-link')) return;

      const targetUrl = new URL(link.href, window.location.origin);
      if (targetUrl.origin !== window.location.origin) return;
      if (targetUrl.pathname === '/') return;

      const isSameDocumentRoute =
        targetUrl.pathname === window.location.pathname &&
        targetUrl.search === window.location.search;
      if (isSameDocumentRoute) return;

      const currentVariant = document.body.dataset.windowVariant || '';
      const targetVariant = inferWindowVariantFromUrl(targetUrl);
      const currentApp = getCurrentPageApp() || '';
      const currentMode = document.body.dataset.pageMode || '';
      const targetApp = inferPageAppForNavigation(targetUrl, link) || '';

      if (currentVariant && targetVariant &&
          currentVariant === targetVariant &&
          currentVariant !== 'none' &&
          isContentSwitchAllowed(currentApp, currentMode) &&
          supportsSameVariantContentSwitch(targetApp)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pjaxLog('same-variant intercept:', currentVariant, currentApp, currentMode, '→', targetApp, targetUrl.href);
        window._sameVariantJustCompleted = true;
        navigateWithinVariant(targetUrl.href);
      }
    }, true); // capture phase

    // ── Body click router (window manager integration) ──

    document.body.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && !link.target && !link.hasAttribute('download') && !link.href.startsWith('javascript:')) {
        const targetUrl = new URL(link.href, window.location.origin);
        const windowManager = Alpine.store('windowManager');
        const isHomeLink = targetUrl.origin === window.location.origin && targetUrl.pathname === '/';
        const isLeavingDesktop = window.location.pathname === '/' && targetUrl.origin === window.location.origin && targetUrl.pathname !== '/';
        const isSameDocumentRoute =
          targetUrl.origin === window.location.origin &&
          targetUrl.pathname === window.location.pathname &&
          targetUrl.search === window.location.search;

        if (isHomeLink) {
          window.preventAutoOpen = true;
          windowManager.showDesktop();
          return;
        }

        if (isLeavingDesktop) {
          return;
        }

        if (windowManager?.minimized && !isSameDocumentRoute) {
          return;
        }

        pjaxLog('click:', link.href, 'classes:', link.className, 'pjax-managed:', link.getAttribute(PJAX_MANAGED_ATTR));
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);
}
