/**
 * Pjax 引擎初始化与 SEO 同步
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import { runPageInitializers } from '../shared/page-app.js';
import { createLogger } from '../shared/debug.js';

// ── Debug logger (enable: 主题设置 → 开发者 → 调试模式) ──
const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');

const SEO_HEAD_SELECTORS = [
  "meta[name='description']",
  "meta[name='keywords']",
  "meta[name='robots']",
  "link[rel='canonical']",
  "link[rel='icon']",
  "link[rel='shortcut icon']",
  "link[rel='apple-touch-icon']",
  "meta[property='og:type']",
  "meta[property='og:url']",
  "meta[property='og:site_name']",
  "meta[property='og:title']",
  "meta[property='og:description']",
  "meta[property='og:image']",
  "meta[property='article:published_time']",
  "meta[property='article:modified_time']",
  "meta[property='article:author']",
  "meta[property='article:tag']",
  "meta[name='twitter:card']",
  "meta[name='twitter:creator']",
  "meta[name='twitter:title']",
  "meta[name='twitter:description']",
  "meta[name='twitter:image']"
];

const PJAX_MANAGED_ATTR = 'data-pjax-managed';
const PJAX_LINK_SELECTOR = `a.pjax-link[${PJAX_MANAGED_ATTR}="true"]:not([target='_blank'])`;

function normalizePageApp(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** In-memory tracked page app – body[data-page-app] is NEVER updated by Pjax. */
let _currentPageApp = normalizePageApp(document.body?.dataset.pageApp);

function getCurrentPageApp() {
  return _currentPageApp;
}

function setCurrentPageApp(value) {
  _currentPageApp = normalizePageApp(value);
  if (document.body) {
    document.body.dataset.pageApp = _currentPageApp;
  }
}

// ── CSS lazy-loading ──
// All Alpine.data registrations are in main.js. Only CSS needs lazy injection.
const _cssLoadedApps = new Set(['']);
const _initCssApp = normalizePageApp(document.body?.dataset.pageApp);
if (_initCssApp) _cssLoadedApps.add(_initCssApp);

// Detect Halo theme asset base from the existing main.css link tag.
const _themeAssetBase = (() => {
  const link = document.querySelector('link[href*="/main.css"]');
  if (link) {
    const href = link.getAttribute('href').split('?')[0];
    const idx = href.lastIndexOf('/css/');
    if (idx >= 0) return href.substring(0, idx + 1);
  }
  const s = document.querySelector('script[src*="/main.js"]');
  if (s) {
    const src = s.getAttribute('src').split('?')[0];
    const idx = src.lastIndexOf('/js/');
    if (idx >= 0) return src.substring(0, idx + 1);
  }
  return '/assets/';
})();

const APP_CSS_NAMES = ['explorer', 'reader', 'moments-app'];

function ensureAppCssLoaded(appName) {
  if (!appName || _cssLoadedApps.has(appName)) return;
  _cssLoadedApps.add(appName);
  if (!document.querySelector(`link[href*="/${appName}.css"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${_themeAssetBase}css/${appName}.css`;
    link.dataset.appCss = appName;
    document.head.appendChild(link);
  }
}

/** Disable CSS for page apps other than `activeApp`. */
function syncAppCss(activeApp) {
  for (const name of APP_CSS_NAMES) {
    const links = document.querySelectorAll(`link[data-app-css="${name}"], link[href*="/${name}.css"]`);
    links.forEach(link => {
      link.disabled = !!(activeApp && name !== activeApp);
    });
  }
}

function parsePageAppFromResponse(responseText) {
  if (!responseText) return '';
  try {
    const m = responseText.match(/data-page-app="([^"]*)"/);
    return m ? normalizePageApp(m[1]) : '';
  } catch (_) {
    return '';
  }
}

function isMomentsRoute(urlLike) {
  try {
    const url = urlLike instanceof URL ? urlLike : new URL(urlLike, window.location.origin);
    return url.origin === window.location.origin && (url.pathname === '/moments' || url.pathname === '/moments/');
  } catch (_error) {
    return false;
  }
}

function isMomentsDetailRoute(urlLike) {
  try {
    const url = urlLike instanceof URL ? urlLike : new URL(urlLike, window.location.origin);
    return url.origin === window.location.origin && /^\/moments\/[^/]+\/?$/.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function inferPageAppFromUrl(urlLike) {
  try {
    const url = urlLike instanceof URL ? urlLike : new URL(urlLike, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const p = url.pathname;

    if (isMomentsRoute(url) || isMomentsDetailRoute(url)) return 'moments-app';
    if (p === '/') return '';

    // /archives (list page) → explorer
    // /archives/slug (post detail) → reader
    if (p === '/archives' || p === '/archives/') return 'explorer';
    if (/^\/archives\/[^/]+\/?$/.test(p)) return 'reader';

    // Explorer list & detail pages
    if (/^\/(tags|tag|categories|category|author|authors)(\/|$)/.test(p)) {
      return 'explorer';
    }
  } catch (_error) {
    return null;
  }

  return null;
}

// resolveTargetPageApp / shouldBypassPjax removed –
// cross-app transitions are handled by dynamic loading in pjax:complete.

function isPjaxManagedLink(link) {
  if (!link || link.target === '_blank' || !link.classList?.contains('pjax-link')) {
    return false;
  }

  try {
    const url = new URL(link.href, window.location.origin);
    if (url.protocol !== window.location.protocol) return false;
    if (url.host !== window.location.host) return false;
    if (link.href.startsWith('javascript:')) return false;
    // bypass removed — all same-origin pjax-links are managed
    return true;
  } catch (_error) {
    return false;
  }
}

function shouldAllowNativeModifiedClick(event) {
  return Boolean(
    event?.defaultPrevented ||
    event?.button > 0 ||
    event?.metaKey ||
    event?.ctrlKey ||
    event?.shiftKey ||
    event?.altKey
  );
}

function markPjaxLink(link) {
  if (!link?.classList?.contains('pjax-link')) return;

  if (isPjaxManagedLink(link)) {
    link.setAttribute(PJAX_MANAGED_ATTR, 'true');
    pjaxLog('mark', link.href, link.className);
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

function syncSeoHeadFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return;

  const parser = new DOMParser();
  const nextDoc = parser.parseFromString(responseText, 'text/html');
  const currentHead = document.head;
  const nextHead = nextDoc.head;

  if (!currentHead || !nextHead) return;

  SEO_HEAD_SELECTORS.forEach((selector) => {
    currentHead.querySelectorAll(selector).forEach((node) => node.remove());
    nextHead.querySelectorAll(selector).forEach((node) => {
      currentHead.appendChild(node.cloneNode(true));
    });
  });
}

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
      selectors: ["title", "#pjax-container"],
      cacheBust: false,
      elements: PJAX_LINK_SELECTOR
    });

    // Non-200 responses: full-page redirect to show dedicated error page.
    // Override handleResponse to intercept errors BEFORE loadContent/latestChance.
    const _origHandleResponse = pjax.handleResponse.bind(pjax);
    pjax.handleResponse = function(responseText, request, href, options) {
      if (responseText === null && request && request.status >= 400) {
        pjaxWarn('handleResponse: status', request.status, '→ full redirect', href);
        NProgress.done();
        window.location = href;
        return;
      }
      // For responseText === false (which pjax treats as error and passes to
      // latestChance), also redirect cleanly.
      if (responseText === false) {
        pjaxWarn('handleResponse: failed response → full redirect', href);
        NProgress.done();
        window.location = href;
        return;
      }
      _origHandleResponse(responseText, request, href, options);
    };

    // Patch attachLink to deduplicate — MoOx/pjax doesn't check data-pjax-state.
    const _origAttachLink = pjax.attachLink.bind(pjax);
    pjax.attachLink = function(link) {
      if (link.hasAttribute('data-pjax-state')) return;
      _origAttachLink(link);
    };

    window.pjax = pjax;
    pjaxLog('init: Pjax created, #pjax-container exists:', !!document.getElementById('pjax-container'));

    // MoOx/pjax binds click handlers per-element via parseDOM/attachLink.
    // Dynamic links (from Alpine x-html, widget renderers, etc.) are never
    // bound. We use a MutationObserver to catch newly inserted <a> elements
    // and attach pjax to them automatically.
    const pjaxAttr = 'data-pjax-state';

    function attachDynamicLinks(root) {
      if (!root || !window.pjax) return;
      markPjaxLinks(root);
      const links = root.querySelectorAll(`${PJAX_LINK_SELECTOR}:not([${pjaxAttr}])`);
      if (links.length > 0) pjaxLog('attach:', links.length, 'new links in', root.className || root.tagName);
      links.forEach((link) => {
        if (!isPjaxManagedLink(link)) return;
        pjaxLog('attach-link:', link.href);
        window.pjax.attachLink(link);
      });
    }

    // Observe the desktop surface for dynamically inserted links
    const desktopSurface = document.querySelector('.desktop-surface');
    if (desktopSurface) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Skip clock/weather ticker updates — they never contain links
            if (node.classList?.contains('desktop-widget-clock')) continue;
            if (node.tagName === 'A' && !node.hasAttribute(pjaxAttr)) {
              pjaxLog('observer: new <a>', node.href);
              attachDynamicLinks(node.parentElement);
            } else if (node.querySelectorAll) {
              // Only process if this subtree might contain links
              if (node.querySelector('a.pjax-link')) {
                pjaxLog('observer: subtree with links', node.className || node.tagName);
                attachDynamicLinks(node);
              }
            }
          }
        }
      });
      observer.observe(desktopSurface, { childList: true, subtree: true });
      pjaxLog('observer: watching .desktop-surface');
    }

    // Note: NO initial requestAnimationFrame sweep here.
    // The MutationObserver handles all dynamically inserted links;
    // a redundant sweep would double-attach handlers since MoOx/pjax's
    // attachLink does NOT deduplicate.

    document.addEventListener("pjax:send", (event) => {
      pjaxLog('event:send', event.triggerElement?.href || '');
      NProgress.start();
      const container = document.getElementById('pjax-container');
      if (container) container.classList.add('pjax-loading');

      // Pre-inject CSS for target app to minimise FOUC
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

      const container = document.getElementById('pjax-container');
      if (container) {
        replayPjaxScripts(container);

        // Alpine.data is globally registered — just init the new tree
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        // Attach pjax to new links in the container.
        // Do NOT call pjax.refresh() — it triggers parseDOM on ALL links
        // which re-adds click handlers (MoOx/pjax doesn't deduplicate).
        attachDynamicLinks(container);

        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
        });

        runPageInitializers(container);
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
