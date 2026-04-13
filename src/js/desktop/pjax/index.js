/**
 * Pjax engine initialization — link management, Observer, event handlers
 *
 * CSS routing:   ./css-router.js
 * SEO sync:      ./seo.js
 * Protocol:      ./protocol.js
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import { runPageInitializers } from '../../shared/page-app.js';
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
  ensureAppCssLoaded,
  syncAppCss,
  parsePageAppFromResponse,
  inferPageAppFromUrl
} from './css-router.js';
import { syncSeoHeadFromResponse } from './seo.js';
import {
  syncBodyDatasetFromResponse,
  parseWindowVariantFromResponse,
  parseContentFromResponse
} from './protocol.js';

const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');

const CONTENT_SWITCH_WHITELIST = new Map([
  ['explorer', new Set(['browser-list'])],
  ['moments-app', new Set(['browser-moments'])],
  ['photos-app', new Set(['browser-list'])]
]);

function isContentSwitchAllowed(pageApp, pageMode) {
  const allowedModes = CONTENT_SWITCH_WHITELIST.get(pageApp);
  return !!(allowedModes && allowedModes.has(pageMode));
}

function parsePageModeFromResponse(html) {
  if (!html) return '';
  const m = html.match(/data-page-mode="([^"]*)"/);
  return m ? m[1].trim() : '';
}

// ── Reader mobile back-stack depth (site-internal only) ──

const BROWSER_NAV_DEPTH_KEY = 'sky_browser_nav_depth';
const BROWSER_NAV_INDEX_KEY = '__browserNavIndex';

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

function replaceBrowserNavState(index, title = document.title, url = window.location.href) {
  try {
    const baseState = (window.history.state && typeof window.history.state === 'object')
      ? window.history.state
      : {};
    window.history.replaceState({ ...baseState, [BROWSER_NAV_INDEX_KEY]: index }, title, url);
  } catch (_e) {
    // Ignore replaceState failures; sessionStorage still tracks the fallback depth.
  }
}

function pushBrowserNavState(index, title, url) {
  const baseState = (window.history.state && typeof window.history.state === 'object')
    ? window.history.state
    : {};
  window.history.pushState({ ...baseState, [BROWSER_NAV_INDEX_KEY]: index }, title, url);
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

// ── Overlay helpers ──

function showOverlay(contentRoot) {
  const overlay = contentRoot?.querySelector('[data-window-loading-overlay]');
  if (overlay) {
    overlay.removeAttribute('data-fading');
    overlay.style.display = '';
  }
  return overlay;
}

function hideOverlay(overlay) {
  if (!overlay) return;
  overlay.setAttribute('data-fading', '');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.removeAttribute('data-fading');
  }, 240);
}

// ── Variant inference from URL ──

function inferVariantFromUrl(url) {
  try {
    const u = url instanceof URL ? url : new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return '';
    const p = u.pathname;
    if (p === '/') return 'none';
    if (p === '/moments' || p === '/moments/' || /^\/moments\/[^/]+\/?$/.test(p)) return 'moments';
    if (p === '/photos' || p === '/photos/' || /^\/photos\/page\/[^/]+\/?$/.test(p)) return 'photos';
    // Everything else that's internal is 'browser'
    return 'browser';
  } catch (_e) {
    return '';
  }
}

// ── Pjax init ──

export function initPjax(Alpine) {
  setTimeout(() => {
    const isErrorPage = document.body?.dataset.errorPage === 'true';
    if (isErrorPage) { pjaxLog('skip: error page'); return; }
    
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
      if (responseText === null && request && request.status >= 400) {
        pjaxWarn('handleResponse: status', request.status, '→ full redirect', href);
        NProgress.done();
        window.location = href;
        return;
      }
      if (responseText === false) {
        pjaxWarn('handleResponse: failed response → full redirect', href);
        NProgress.done();
        window.location = href;
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

    initializeBrowserNavDepth();
    installBrowserNavHelpers();

    window.addEventListener('popstate', (event) => {
      window._browserPopstatePending = true;
      const stateIndex = readBrowserNavIndexFromState(event.state);
      syncBrowserNavDepth(stateIndex ?? 0);
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

      const overlay = showOverlay(contentRoot);
      perfMark('overlayVisible');
      NProgress.start();

      document.dispatchEvent(new CustomEvent('pjax:same-variant-send', { detail: { targetUrl: targetUrl } }));

      try {
        // Pre-load target CSS
        const targetApp = inferPageAppFromUrl(targetUrl);
        ensureAppCssLoaded(targetApp);

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
          hideOverlay(overlay);
          NProgress.done();
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
          hideOverlay(overlay);
          NProgress.done();
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

        syncBodyDatasetFromResponse(html);

        const nextApp = parsePageAppFromResponse(html);
        setCurrentPageApp(nextApp);
        ensureAppCssLoaded(nextApp);
        syncAppCss(nextApp);

        syncSeoHeadFromResponse(html);

        // Alpine + scripts
        replayPjaxScripts(contentContainer);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(contentContainer);
        }

        perfMark('AlpineInitDone');

        // Re-bind links
        attachDynamicLinks(contentContainer);

        // Page initializers
        runPageInitializers(contentContainer);

        perfMark('pageReady');

        // Update window title bar
        const titleEl = document.querySelector('[data-window-titlebar] .window-title-text');
        const isDetail = contentContainer.querySelector('.moments-app--detail');
        const photosShell = contentContainer.querySelector('.photos-shell');
        if (photosShell) {
          const photosTitle = photosShell.dataset.photosChromeTitle || '';
          const photosSubtitle = photosShell.dataset.photosChromeSubtitle || '';
          const photosSiteTitle = photosShell.dataset.photosSiteTitle || '';
          const resolvedBrowserTitle = photosTitle
            ? (photosSiteTitle ? `${photosTitle} - ${photosSiteTitle}` : photosTitle)
            : parsed.title;
          document.title = resolvedBrowserTitle;
          pushBrowserNavState(nextNavIndex, resolvedBrowserTitle, targetUrl);
          if (titleEl && photosTitle) {
            titleEl.textContent = photosTitle;
          }
          const subtitleEl = document.querySelector('[data-photos-chrome-subtitle]');
          if (subtitleEl) {
            subtitleEl.textContent = photosSubtitle;
          }
        } else if (titleEl) {
          document.title = parsed.title;
          pushBrowserNavState(nextNavIndex, parsed.title, targetUrl);
          titleEl.textContent = isDetail ? '详情' : parsed.title;
        } else {
          document.title = parsed.title;
          pushBrowserNavState(nextNavIndex, parsed.title, targetUrl);
        }
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

        NProgress.done();
        hideOverlay(overlay);

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
        hideOverlay(overlay);
        NProgress.done();
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
      NProgress.start();
      const container = document.getElementById('window-frame-root');
      if (container) container.classList.add('pjax-loading');

      const targetHref = event?.triggerElement?.href || event?.requestOptions?.requestUrl;
      if (targetHref) {
        const targetApp = inferPageAppFromUrl(targetHref);
        ensureAppCssLoaded(targetApp);
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
    
    document.addEventListener("pjax:complete", (event) => {
      NProgress.done();

      if (window._browserForwardNavPending && !window._browserPopstatePending) {
        const nextNavIndex = getBrowserNavDepth() + 1;
        syncBrowserNavDepth(nextNavIndex);
        replaceBrowserNavState(nextNavIndex);
      }
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;

      const nextApp = parsePageAppFromResponse(event?.request?.responseText);
      setCurrentPageApp(nextApp);
      ensureAppCssLoaded(nextApp);
      syncAppCss(nextApp);

      syncSeoHeadFromResponse(event?.request?.responseText);
      syncBodyDatasetFromResponse(event?.request?.responseText);

      const container = document.getElementById('window-frame-root');
      if (container) {
        replayPjaxScripts(container);

        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        attachDynamicLinks(container);

        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
        });

        runPageInitializers(container);

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
    });

    document.addEventListener("pjax:error", (event) => {
      pjaxWarn('event:error', event.detail?.request?.status, event.detail?.error?.message);
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;
      NProgress.done();
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
      const targetVariant = inferVariantFromUrl(targetUrl);
      const currentApp = getCurrentPageApp() || '';
      const currentMode = document.body.dataset.pageMode || '';
      const targetApp = inferPageAppFromUrl(targetUrl) || '';

      if (currentVariant && targetVariant &&
          currentVariant === targetVariant &&
          currentVariant !== 'none' &&
          isContentSwitchAllowed(currentApp, currentMode) &&
          CONTENT_SWITCH_WHITELIST.has(targetApp)) {
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
