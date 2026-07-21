/**
 * Pjax CSS lazy-loading router
 *
 * Manages per-page-app CSS injection and toggling during Pjax navigation.
 */

import { createLogger } from '../../shared/debug.js';
import { getRoutableAppIds, inferPageAppFromUrl as inferPageAppFromRouteManifest } from '../../../../../shell-core/runtime/route-manifest.js';
import {
  ensureAppAssetsLoaded as ensureShellCoreAppAssetsLoaded,
  ensureAppCssLoaded as ensureShellCoreAppCssLoaded,
  markAppAssetsLoaded,
  stageAppCssForNavigation as stageShellCoreAppCssForNavigation
} from '../../../../../shell-core/runtime/app-loader.js';

const { log: cssLog } = createLogger('pjax');

// ── Page app tracking ──

function normalizePageApp(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assetPathSegment(appId) {
  switch (normalizePageApp(appId)) {
    case 'explorer-tags':
      return 'tags';
    case 'explorer-categories':
      return 'categories';
    case 'explorer-author':
      return 'author';
    case 'explorer-archives':
      return 'archives';
    default:
      return normalizePageApp(appId);
  }
}

function getExplicitPageAppHint(triggerElement) {
  if (!triggerElement || typeof triggerElement !== 'object') return '';

  const datasetValue = normalizePageApp(triggerElement.dataset?.pjaxApp);
  if (datasetValue) return datasetValue;

  if (typeof triggerElement.getAttribute === 'function') {
    return normalizePageApp(triggerElement.getAttribute('data-pjax-app'));
  }

  return '';
}

let _currentPageApp = normalizePageApp(document.body?.dataset.pageApp);
const _initAppId = normalizePageApp(document.body?.dataset.appId || document.body?.dataset.pageApp);
if (_initAppId) {
  markAppAssetsLoaded(_initAppId);
}

export function getCurrentPageApp() {
  return _currentPageApp;
}

export function setCurrentPageApp(value) {
  _currentPageApp = normalizePageApp(value);
  if (document.body) {
    document.body.dataset.pageApp = _currentPageApp;
    document.body.dataset.appId = _currentPageApp;
  }
}

// ── CSS lazy-loading ──

const APP_CSS_NAMES = getRoutableAppIds();

export function ensureAppCssLoaded(appName) {
  return ensureShellCoreAppCssLoaded(appName).then(() => {
    if (appName) cssLog('css: ensured', appName);
  });
}

export async function ensureAppJsLoaded(appName) {
  return ensureShellCoreAppAssetsLoaded(appName);
}

export async function ensureAppAssetsLoaded(appName) {
  return ensureShellCoreAppAssetsLoaded(appName);
}

export function stageAppCssForNavigation(appName) {
  return stageShellCoreAppCssForNavigation(appName);
}

/** Disable CSS for page apps other than `activeApp`. */
export function syncAppCss(activeApp) {
  const normalizedActiveApp = normalizePageApp(activeApp);

  for (const name of APP_CSS_NAMES) {
    const segment = assetPathSegment(name);
    const links = document.querySelectorAll(`link[data-app-css="${name}"], link[href*="/css/apps/${segment}/index.css"]`);
    links.forEach(link => {
      link.disabled = normalizedActiveApp
        ? name !== normalizedActiveApp
        : true;
    });
  }
}

export function parsePageAppFromResponse(responseText) {
  if (!responseText) return '';
  try {
    const appIdMatch = responseText.match(/data-app-id="([^"]*)"/);
    if (appIdMatch) return normalizePageApp(appIdMatch[1]);
    const pageAppMatch = responseText.match(/data-page-app="([^"]*)"/);
    return pageAppMatch ? normalizePageApp(pageAppMatch[1]) : '';
  } catch (_) {
    return '';
  }
}

export function inferPageAppFromUrl(urlLike) {
  return inferPageAppFromRouteManifest(urlLike);
}

export function inferPageAppForNavigation(urlLike, triggerElement = null) {
  return getExplicitPageAppHint(triggerElement) || inferPageAppFromRouteManifest(urlLike) || '';
}
