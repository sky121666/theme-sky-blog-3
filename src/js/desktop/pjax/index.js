/**
 * Pjax engine initialization — link management, Observer, event handlers
 *
 * CSS routing:   ./css-router.js
 * SEO sync:      ./seo.js
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import { runPageInitializers } from '../../shared/page-app.js';
import { createLogger } from '../../shared/debug.js';
import {
  setCurrentPageApp,
  ensureAppCssLoaded,
  syncAppCss,
  parsePageAppFromResponse,
  inferPageAppFromUrl
} from './css-router.js';
import { syncSeoHeadFromResponse } from './seo.js';
import { syncBodyDatasetFromResponse } from './protocol.js';

const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');

// ── Link management ──

const PJAX_MANAGED_ATTR = 'data-pjax-managed';
const PJAX_LINK_SELECTOR = `a.pjax-link[${PJAX_MANAGED_ATTR}="true"]:not([target='_blank'])`;

function isPjaxManagedLink(link) {
  if (!link || link.target === '_blank' || !link.classList?.contains('pjax-link')) {
    return false;
  }

  try {
    const url = new URL(link.href, window.location.origin);
    if (url.protocol !== window.location.protocol) return false;
    if (url.host !== window.location.host) return false;
    if (link.href.startsWith('javascript:')) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function markPjaxLink(link) {
  if (!link?.classList?.contains('pjax-link')) return;

  if (isPjaxManagedLink(link)) {
    if (!link.hasAttribute(PJAX_MANAGED_ATTR)) {
      link.setAttribute(PJAX_MANAGED_ATTR, 'true');
    }
    return;
  }

  link.removeAttribute(PJAX_MANAGED_ATTR);
  link.removeAttribute('data-pjax-state');
}

function markPjaxLinks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('a.pjax-link[href]').forEach((link) => {
    markPjaxLink(link);
  });
}

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

    // ── Dynamic link attachment ──

    function attachDynamicLinks(root) {
      if (!root || !window.pjax) return;
      markPjaxLinks(root);
      const links = root.querySelectorAll(`${PJAX_LINK_SELECTOR}:not([${ATTACHED}])`);
      if (!links.length) return;
      pjaxLog('attach:', links.length, 'links in', root.className?.split(' ')[0] || root.tagName);
      links.forEach((link) => {
        if (!isPjaxManagedLink(link)) return;
        window.pjax.attachLink(link);
      });
    }

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
      }
    });
    
    document.addEventListener("pjax:complete", (event) => {
      NProgress.done();

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
      } else {
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

    document.addEventListener("pjax:error", (event) => {
      pjaxWarn('event:error', event.detail?.request?.status, event.detail?.error?.message);
      NProgress.done();
    });

    // ── Body click router (window manager integration) ──

    document.body.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && !link.target && !link.hasAttribute('download') && !link.href.startsWith('javascript:')) {
        pjaxLog('click:', link.href, 'classes:', link.className, 'pjax-managed:', link.getAttribute(PJAX_MANAGED_ATTR));
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

        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);
}
