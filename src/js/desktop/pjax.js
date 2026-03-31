/**
 * Pjax 引擎初始化与 SEO 同步
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import { initPostOutline } from './post-outline.js';
import { initArchiveSidebar } from './archive-sidebar.js';

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
    if (isErrorPage) return;
    
    const pjax = new Pjax({
      selectors: ["title", "#pjax-container"],
      cacheBust: false,
      elements: "a:not([target='_blank'])" 
    });
    
    window.pjax = pjax;

    // MoOx/pjax binds click handlers per-element via parseDOM/attachLink.
    // Dynamic links (from Alpine x-html, widget renderers, etc.) are never
    // bound. We use a MutationObserver to catch newly inserted <a> elements
    // and attach pjax to them automatically.
    const pjaxAttr = 'data-pjax-state';

    function attachDynamicLinks(root) {
      if (!root || !window.pjax) return;
      const links = root.querySelectorAll(`a:not([target='_blank']):not([${pjaxAttr}])`);
      links.forEach((link) => {
        // Skip external, anchor-only, and javascript: links
        if (link.protocol !== window.location.protocol) return;
        if (link.host !== window.location.host) return;
        if (link.href.startsWith('javascript:')) return;
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
            if (node.tagName === 'A' && !node.hasAttribute(pjaxAttr)) {
              attachDynamicLinks(node.parentElement);
            } else if (node.querySelectorAll) {
              attachDynamicLinks(node);
            }
          }
        }
      });
      observer.observe(desktopSurface, { childList: true, subtree: true });
    }

    // Initial sweep after Alpine has rendered (covers first-load widget links)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        attachDynamicLinks(document.querySelector('.desktop-surface'));
      });
    });

    document.addEventListener("pjax:send", () => {
      NProgress.start();
      const container = document.getElementById('pjax-container');
      if (container) container.classList.add('pjax-loading');
    });
    
    document.addEventListener("pjax:complete", (event) => {
      const requestStatus = event?.request?.status;
      if (requestStatus && requestStatus >= 400) {
        NProgress.done();
        return;
      }

      NProgress.done();
      syncSeoHeadFromResponse(event?.request?.responseText);
      const container = document.getElementById('pjax-container');
      if (container) {
        replayPjaxScripts(container);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
          requestAnimationFrame(() => {
            if (window.pjax?.refresh) {
              window.pjax.refresh();
            }
          });
        });

        initArchiveSidebar(container);
        initPostOutline(container);
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
      NProgress.done();

      const requestStatus = event?.request?.status;
      if (!requestStatus || requestStatus < 400) {
        return;
      }

      const fallbackUrl =
        event?.request?.responseURL ||
        event?.triggerElement?.href ||
        event?.requestOptions?.requestUrl;

      if (fallbackUrl) {
        window.location.assign(fallbackUrl);
      }
    });

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

        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);
}
