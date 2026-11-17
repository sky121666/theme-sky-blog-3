import { initializeNavigationPreload, fetchNavigationPage } from './navigation-preload.js';
import { validateDocsFallback } from './docs-html.js';

let initialized = false;

function activeDocs() {
  return (document.body.dataset.appId || document.body.dataset.pageApp) === 'docsme';
}

function docsUrl(value) {
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && /^\/docs(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

export function initializeDocsSwup() {
  initializeNavigationPreload();
  if (initialized) return;
  initialized = true;
  let accepted = null, animation = null;
  document.addEventListener('theme:navigation-accepted', ({ detail }) => {
    animation?.cancel(); animation = null;
    accepted = activeDocs() && docsUrl(detail.url) ? detail.intentId : null;
  });
  document.addEventListener('theme:pjax-ready', ({ detail }) => {
    if (detail.intentId !== accepted || detail.appId !== 'docsme' || detail.mode !== 'same') return;
    accepted = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = detail.root?.querySelector('.docsme-main');
    if (!root?.isConnected || typeof root.animate !== 'function') return;
    animation = root.animate([{ opacity: 0.72, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)' });
    void animation.finished.catch(() => {});
  });
  document.addEventListener('theme:navigation-settled', ({ detail }) => {
    if (detail.intentId === accepted) accepted = null;
  });
}

export async function fetchDocsPage(url, options) {
  initializeDocsSwup();
  if (!docsUrl(url)) throw new TypeError('Not a document route');
  const response = await fetchNavigationPage(url, options);
  return validateDocsFallback(response);
}
