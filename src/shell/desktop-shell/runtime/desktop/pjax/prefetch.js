/**
 * Lightweight prefetch for high-frequency navigation targets.
 *
 * On hover (150ms debounce) over menubar or dock links,
 * prefetch the target HTML + pageApp CSS.
 *
 * Does NOT do: Alpine init, media preload, comment widget mount.
 */

import { ensureAppCssLoaded, inferPageAppFromUrl } from './css-router.js';
import { createLogger } from '../../shared/debug.js';

const { log: prefetchLog } = createLogger('pjax');

const HIGH_FREQ_PATHS = new Set(['/moments', '/friends', '/links', '/categories', '/tags', '/archives']);

const _prefetchedUrls = new Set();
let _hoverTimer = null;

function shouldPrefetch(url) {
  try {
    const u = url instanceof URL ? url : new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    if (_prefetchedUrls.has(u.pathname)) return false;
    return HIGH_FREQ_PATHS.has(u.pathname) || HIGH_FREQ_PATHS.has(u.pathname.replace(/\/$/, ''));
  } catch (_e) {
    return false;
  }
}

function doPrefetch(url) {
  const u = new URL(url, window.location.origin);
  const pathname = u.pathname.replace(/\/$/, '') || '/';

  if (_prefetchedUrls.has(pathname)) return;
  _prefetchedUrls.add(pathname);

  // Prefetch HTML
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = u.href;
  document.head.appendChild(link);

  // Prefetch pageApp CSS
  const appName = inferPageAppFromUrl(u);
  if (appName) {
    ensureAppCssLoaded(appName);
  }

  prefetchLog('prefetch:', pathname, appName ? `+ ${appName}.css` : '');
}

/**
 * Initialize prefetch listeners on menubar and dock.
 * Should be called once after DOM is ready.
 */
export function initPrefetch() {
  const targets = document.querySelectorAll(
    '.menubar a[href], .dock-icon[href]'
  );

  if (!targets.length) return;

  targets.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      const href = el.getAttribute('href');
      if (!href || !shouldPrefetch(href)) return;

      _hoverTimer = setTimeout(() => {
        doPrefetch(href);
      }, 150);
    });

    el.addEventListener('mouseleave', () => {
      if (_hoverTimer) {
        clearTimeout(_hoverTimer);
        _hoverTimer = null;
      }
    });
  });

  prefetchLog('prefetch: attached to', targets.length, 'targets');
}
