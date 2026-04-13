/**
 * Pjax CSS lazy-loading router
 *
 * Manages per-page-app CSS injection and toggling during Pjax navigation.
 */

import { createLogger } from '../../shared/debug.js';

const { log: cssLog } = createLogger('pjax');

// ── Page app tracking ──

function normalizePageApp(value) {
  return typeof value === 'string' ? value.trim() : '';
}

let _currentPageApp = normalizePageApp(document.body?.dataset.pageApp);

export function getCurrentPageApp() {
  return _currentPageApp;
}

export function setCurrentPageApp(value) {
  _currentPageApp = normalizePageApp(value);
  if (document.body) {
    document.body.dataset.pageApp = _currentPageApp;
  }
}

// ── CSS lazy-loading ──

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

const APP_CSS_NAMES = ['explorer', 'reader', 'moments-app', 'photos-app'];

export function ensureAppCssLoaded(appName) {
  if (!appName || _cssLoadedApps.has(appName)) return;
  _cssLoadedApps.add(appName);
  if (!document.querySelector(`link[href*="/${appName}.css"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${_themeAssetBase}css/${appName}.css`;
    link.dataset.appCss = appName;
    document.head.appendChild(link);
    cssLog('css: injected', appName);
  }
}

/** Disable CSS for page apps other than `activeApp`. */
export function syncAppCss(activeApp) {
  for (const name of APP_CSS_NAMES) {
    const links = document.querySelectorAll(`link[data-app-css="${name}"], link[href*="/${name}.css"]`);
    links.forEach(link => {
      link.disabled = !!(activeApp && name !== activeApp);
    });
  }
}

export function parsePageAppFromResponse(responseText) {
  if (!responseText) return '';
  try {
    const m = responseText.match(/data-page-app="([^"]*)"/);
    return m ? normalizePageApp(m[1]) : '';
  } catch (_) {
    return '';
  }
}

// ── URL → page app inference ──

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

export function inferPageAppFromUrl(urlLike) {
  try {
    const url = urlLike instanceof URL ? urlLike : new URL(urlLike, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const p = url.pathname;

    if (isMomentsRoute(url) || isMomentsDetailRoute(url)) return 'moments-app';
    if (p === '/photos' || p === '/photos/' || /^\/photos\/page\/[^/]+\/?$/.test(p)) return 'photos-app';
    if (p === '/') return '';

    if (p === '/archives' || p === '/archives/') return 'explorer';
    if (/^\/archives\/[^/]+\/?$/.test(p)) return 'reader';

    if (/^\/(tags|tag|categories|category|author|authors)(\/|$)/.test(p)) {
      return 'explorer';
    }
  } catch (_error) {
    return null;
  }

  return null;
}
