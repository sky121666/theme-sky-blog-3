import { getAssetsForApp, getThemeAssetBase, withThemeAssetVersion, waitForResource } from './resource-registry.js';
import { getAppAssetSegment as assetPathSegment } from './app-manifests.js';

const loadedAppsCss = new Set(['']);
const loadedAppsJs = new Set(['']);
const pendingAppsCss = new Map();
const pendingAppsJs = new Map();
const APP_ASSET_LOAD_TIMEOUT_MS = 15_000;

const ASSET_STATE = Object.freeze({
  loading: 'loading',
  ready: 'ready',
  error: 'error'
});

function normalizeAppId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getFallbackCssPath(appId) {
  const segment = assetPathSegment(appId);
  return withThemeAssetVersion(`${getThemeAssetBase()}css/apps/${segment}/index.css`);
}

function getFallbackJsPath(appId) {
  const segment = assetPathSegment(appId);
  return withThemeAssetVersion(`${getThemeAssetBase()}js/apps/${segment}/index.js`);
}

function normalizeAssetUrl(urlLike) {
  const raw = String(urlLike || '');
  if (!raw) return '';

  try {
    const parsed = new URL(raw, window.location.origin);
    parsed.hash = '';
    return parsed.href;
  } catch (_error) {
    return raw.split('#')[0];
  }
}

function normalizeAssetPath(urlLike) {
  const normalized = normalizeAssetUrl(urlLike);
  if (!normalized) return '';

  try {
    return new URL(normalized, window.location.origin).pathname;
  } catch (_error) {
    return normalized.split('?')[0];
  }
}

function getAssetState(element, kind) {
  return element?.dataset?.[kind === 'css' ? 'appCssState' : 'appScriptState'] || '';
}

function setAssetState(element, kind, state) {
  if (!element?.dataset) return;
  element.dataset[kind === 'css' ? 'appCssState' : 'appScriptState'] = state;
  if (kind === 'css') {
    element.dataset.appCssReady = state === ASSET_STATE.ready ? 'true' : 'false';
  }
}

function removeFailedAsset(element, kind) {
  if (!element || getAssetState(element, kind) !== ASSET_STATE.error) return false;
  element.remove?.();
  return true;
}

function matchesAssetUrl(elementUrl, expectedUrl, fallbackPath) {
  const actual = normalizeAssetUrl(elementUrl);
  const expected = normalizeAssetUrl(expectedUrl);
  if (actual && expected && actual === expected) return true;

  const actualPath = normalizeAssetPath(actual);
  const expectedPath = normalizeAssetPath(expected);
  try {
    const params = new URL(actual, window.location.origin).searchParams;
    // Only genuinely unversioned SSR elements can use the legacy path match.
    // An explicit but different build identity must never satisfy this gate.
    if (params.has('v') || params.has('r')) return false;
  } catch (_error) {
    return false;
  }
  return actualPath === fallbackPath && expectedPath === fallbackPath;
}

function findExistingCssLink(appId, href, segment) {
  const normalizedAppId = normalizeAppId(appId);
  const fallbackPath = `${getThemeAssetBase()}css/apps/${segment}/index.css`.replace(window.location.origin, '');

  return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((link) => {
    if (removeFailedAsset(link, 'css')) return false;
    const linkUrl = link.href || link.getAttribute('href') || '';
    if (!matchesAssetUrl(linkUrl, href, fallbackPath)) return false;
    if (!link.dataset.appCss) link.dataset.appCss = normalizedAppId;
    return true;
  }) || null;
}

function findExistingScript(appId, src, segment) {
  const normalizedAppId = normalizeAppId(appId);
  const fallbackPath = `${getThemeAssetBase()}js/apps/${segment}/index.js`.replace(window.location.origin, '');

  return Array.from(document.querySelectorAll('script[type="module"], script[data-app-script]')).find((script) => {
    if (removeFailedAsset(script, 'js')) return false;
    const scriptUrl = script.src || script.getAttribute('src') || '';
    if (!matchesAssetUrl(scriptUrl, src, fallbackPath)) return false;
    if (!script.dataset.appScript) script.dataset.appScript = normalizedAppId;
    return true;
  }) || null;
}

function waitForAssetElement(element, assetUrl, kind) {
  if (!element) return Promise.resolve(null);

  const currentState = getAssetState(element, kind);
  const isReady = currentState === ASSET_STATE.ready
    || (kind === 'css' && Boolean(element.sheet));
  if (isReady) {
    setAssetState(element, kind, ASSET_STATE.ready);
    return Promise.resolve(element);
  }

  if (currentState === ASSET_STATE.error) {
    element.remove?.();
    return Promise.reject(new Error(`load app ${kind} failed: ${assetUrl}`));
  }

  return new Promise((resolve, reject) => {
    const setTimer = window.setTimeout?.bind(window) || setTimeout;
    const clearTimer = window.clearTimeout?.bind(window) || clearTimeout;
    let timeoutId = 0;

    const cleanup = () => {
      element.removeEventListener('load', onLoad);
      element.removeEventListener('error', onError);
      if (timeoutId) clearTimer(timeoutId);
    };

    const onLoad = () => {
      setAssetState(element, kind, ASSET_STATE.ready);
      cleanup();
      resolve(element);
    };

    const onError = () => {
      setAssetState(element, kind, ASSET_STATE.error);
      cleanup();
      element.remove?.();
      reject(new Error(`load app ${kind} failed: ${assetUrl}`));
    };

    element.addEventListener('load', onLoad, { once: true });
    element.addEventListener('error', onError, { once: true });
    timeoutId = setTimer(() => {
      setAssetState(element, kind, ASSET_STATE.error);
      cleanup();
      element.remove?.();
      reject(new Error(`load app ${kind} timed out after ${APP_ASSET_LOAD_TIMEOUT_MS}ms: ${assetUrl}`));
    }, APP_ASSET_LOAD_TIMEOUT_MS);
  });
}

export function markAppAssetsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  let cssReady = false;
  let jsReady = false;
  const segment = assetPathSegment(normalized);
  document.querySelectorAll?.(`link[data-app-css="${normalized}"]`)?.forEach((link) => {
    if (!matchesAssetUrl(link.href || link.getAttribute?.('href'), getFallbackCssPath(normalized),
      `${getThemeAssetBase()}css/apps/${segment}/index.css`.replace(window.location.origin, ''))) return;
    setAssetState(link, 'css', ASSET_STATE.ready);
    cssReady = true;
  });
  document.querySelectorAll?.(`script[data-app-script="${normalized}"]`)?.forEach((script) => {
    let actual = script.src || script.getAttribute?.('src') || script.dataset?.src || '';
    // The inert startup marker records the SSR URL, while bootstrap imports
    // its manifest-versioned equivalent before importing the shell.
    const bootstrap = window.__THEME_ASSET_IDENTITY__;
    if (script.type === 'application/json' && script.dataset?.appScriptState === ASSET_STATE.ready
      && bootstrap?.source === 'manifest' && actual) {
      const imported = new URL(actual, window.location.origin);
      imported.search = bootstrap.query;
      actual = imported.href;
    }
    if (!matchesAssetUrl(actual, getFallbackJsPath(normalized),
      `${getThemeAssetBase()}js/apps/${segment}/index.js`.replace(window.location.origin, ''))) return;
    setAssetState(script, 'js', ASSET_STATE.ready);
    jsReady = true;
  });
  if (cssReady) { loadedAppsCss.add(normalized); pendingAppsCss.delete(normalized); }
  if (jsReady) { loadedAppsJs.add(normalized); pendingAppsJs.delete(normalized); }
}

/**
 * Enable an already-loaded app stylesheet before Pjax replaces the current DOM.
 *
 * `syncAppCss()` disables inactive app styles after each navigation. When a
 * previously visited app is opened again, the loader can resolve immediately,
 * but the cached link is still disabled until `pjax:complete`. Enabling only the
 * target link here keeps the current page styled while guaranteeing that the
 * incoming DOM never paints without its app CSS.
 */
export function stageAppCssForNavigation(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return 0;

  const segment = assetPathSegment(normalized);
  if (!segment) return 0;
  const expectedUrl = normalizeAssetUrl(getFallbackCssPath(normalized));
  let staged = 0;

  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    if (getAssetState(link, 'css') === ASSET_STATE.error) return;

    // A matching app id/path alone can belong to an older build. Staging is
    // synchronous, so use the running build's complete URL, including v + r.
    const linkUrl = normalizeAssetUrl(link.href || link.getAttribute?.('href') || '');
    if (linkUrl !== expectedUrl) return;

    link.disabled = false;
    staged += 1;
  });

  return staged;
}

export async function ensureAppCssLoaded(appId, options = {}) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsCss.has(normalized)) return;
  if (!segment) throw new Error(`Unknown app asset entry: ${normalized}`);
  if (pendingAppsCss.has(normalized)) {
    return waitForResource(pendingAppsCss.get(normalized), options);
  }

  const promise = (async () => {
    const assets = await getAssetsForApp(normalized);
    const cssFiles = assets.css.length ? assets.css : [getFallbackCssPath(normalized)];

    await Promise.all(cssFiles.map((href) => {
      const normalizedHref = withThemeAssetVersion(String(href || ''));
      if (!normalizedHref) return Promise.resolve(null);

      let link = findExistingCssLink(normalized, normalizedHref, segment);

      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = normalizedHref || getFallbackCssPath(normalized);
        link.dataset.appCss = normalized;
        setAssetState(link, 'css', ASSET_STATE.loading);
        document.head.appendChild(link);
      }

      return waitForAssetElement(link, normalizedHref, 'css');
    }));

    loadedAppsCss.add(normalized);
  })().finally(() => {
    pendingAppsCss.delete(normalized);
  });

  pendingAppsCss.set(normalized, promise);
  return waitForResource(promise, options);
}

export async function ensureAppJsLoaded(appId, options = {}) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsJs.has(normalized)) return;
  if (!segment) throw new Error(`Unknown app asset entry: ${normalized}`);
  if (pendingAppsJs.has(normalized)) {
    return waitForResource(pendingAppsJs.get(normalized), options);
  }

  const promise = (async () => {
    const assets = await getAssetsForApp(normalized);
    const jsFiles = assets.js.length ? assets.js : [getFallbackJsPath(normalized)];

    await Promise.all(jsFiles.map((src) => {
      const normalizedSrc = withThemeAssetVersion(String(src || ''));
      if (!normalizedSrc) {
        return Promise.resolve(null);
      }

      let script = findExistingScript(normalized, normalizedSrc, segment);
      if (!script) {
        script = document.createElement('script');
        script.type = 'module';
        script.src = normalizedSrc || getFallbackJsPath(normalized);
        script.dataset.appScript = normalized;
        setAssetState(script, 'js', ASSET_STATE.loading);
        document.head.appendChild(script);
      }

      return waitForAssetElement(script, normalizedSrc, 'js');
    }));

    loadedAppsJs.add(normalized);
  })().finally(() => {
    pendingAppsJs.delete(normalized);
  });

  pendingAppsJs.set(normalized, promise);
  return waitForResource(promise, options);
}

export async function ensureAppAssetsLoaded(appId, options = {}) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  // Both requests start together. Navigation still waits for CSS and module
  // execution/registrars before it replaces the live page.
  await waitForResource(Promise.all([
    ensureAppCssLoaded(normalized, options),
    ensureAppJsLoaded(normalized, options)
  ]), options);
}
