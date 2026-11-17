import { getAssetsForApp, getThemeAssetBase, withThemeAssetVersion, waitForResource } from './resource-registry.js';
import { getAppAssetSegment as assetPathSegment } from './app-manifests.js';

const loadedAppsCss = new Set(['']);
const loadedAppsJs = new Set(['']);
const pendingAppsCss = new Map();
const pendingAppsJs = new Map();
const APP_ASSET_LOAD_TIMEOUT_MS = 15_000;
const APP_ASSET_WARM_TIMEOUT_MS = 5_000;
const MAX_PENDING_WARM_HINTS = 8;
const MAX_READY_WARM_ASSETS = 32;
const pendingAssetWarmups = new Map();
const warmedAssetUrls = new Set();

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

function getWarmAssetUrl(value, kind) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const base = new URL(getThemeAssetBase(), window.location.origin);
    const parsed = new URL(value, window.location.origin);
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== window.location.origin
      || base.origin !== parsed.origin || parsed.username || parsed.password
      || !parsed.pathname.startsWith(`${base.pathname}${kind}/`)
      || !parsed.pathname.endsWith(`.${kind}`)) return '';
    // Validate before versioning: the shared version helper intentionally
    // returns path-only URLs for slash-prefixed inputs, including //host paths.
    const versioned = new URL(withThemeAssetVersion(parsed.href));
    versioned.hash = '';
    return versioned.href;
  } catch (_error) {
    return '';
  }
}

function hasRequestedWarmAsset(href, kind) {
  const selector = kind === 'css' ? 'link[rel="stylesheet"]' : 'script[type="module"], script[data-app-script]';
  return Array.from(document.querySelectorAll(selector)).some((element) => {
    if (getAssetState(element, kind) === ASSET_STATE.error) return false;
    if (kind === 'js' && element.type === 'application/json'
      && getAssetState(element, kind) !== ASSET_STATE.ready) return false;
    const actual = kind === 'css'
      ? element.href || element.getAttribute?.('href')
      : element.src || element.getAttribute?.('src') || element.dataset?.src;
    return normalizeAssetUrl(actual) === href;
  });
}

function warmAssetHint(appId, value, kind, timeoutMs) {
  const href = getWarmAssetUrl(value, kind);
  if (!href) return Promise.resolve(0);
  const key = `${kind}:${href}`;
  const loaded = kind === 'css' ? loadedAppsCss : loadedAppsJs;
  const loading = kind === 'css' ? pendingAppsCss : pendingAppsJs;
  if (loaded.has(appId) || loading.has(appId) || warmedAssetUrls.has(key) || hasRequestedWarmAsset(href, kind)) {
    return Promise.resolve(1);
  }
  if (pendingAssetWarmups.has(key)) return pendingAssetWarmups.get(key);
  // Speculation never queues behind a navigation or grows an unbounded set of
  // head elements. Skipped entries remain eligible for a later user intent.
  if (pendingAssetWarmups.size >= MAX_PENDING_WARM_HINTS) return Promise.resolve(0);

  const hint = document.createElement('link');
  hint.rel = kind === 'css' ? 'preload' : 'modulepreload';
  if (kind === 'css') hint.as = 'style';
  hint.href = href;
  hint.dataset.appAssetWarm = appId;
  hint.fetchPriority = 'low';
  const promise = new Promise((resolve) => {
    let timer;
    let settled = false;
    const settle = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      hint.removeEventListener('load', onLoad);
      hint.removeEventListener('error', onError);
      hint.remove();
      pendingAssetWarmups.delete(key);
      if (ready) {
        warmedAssetUrls.add(key);
        if (warmedAssetUrls.size > MAX_READY_WARM_ASSETS) {
          warmedAssetUrls.delete(warmedAssetUrls.values().next().value);
        }
      }
      resolve(ready ? 1 : 0);
    };
    const onLoad = () => settle(true);
    const onError = () => settle(false);
    hint.addEventListener('load', onLoad, { once: true });
    hint.addEventListener('error', onError, { once: true });
    timer = setTimeout(onError, timeoutMs);
  });
  pendingAssetWarmups.set(key, promise);
  document.head.appendChild(hint);
  return promise;
}

/**
 * Speculatively download current-build app assets without applying CSS or
 * evaluating modules. A successful warmup never marks an app as loaded:
 * navigation still goes through ensureAppAssetsLoaded and its registrar gate.
 * Returns the number of assets already requested or successfully warmed.
 * Hint errors/timeouts are retryable; manifest and consumer abort errors reject.
 */
export async function warmAppAssets(appId, options = {}) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || !segment) return 0;
  const signal = options.signal;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(APP_ASSET_WARM_TIMEOUT_MS, options.timeoutMs))
    : APP_ASSET_WARM_TIMEOUT_MS;
  const throwIfAborted = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  };
  throwIfAborted();
  const assets = await getAssetsForApp(normalized, { signal, timeoutMs });
  throwIfAborted();
  const css = assets.css.length ? assets.css : [getFallbackCssPath(normalized)];
  const js = assets.js.length ? assets.js : [getFallbackJsPath(normalized)];
  const pending = [];
  // Interleave kinds so a large CSS list cannot consume every module hint slot.
  for (let index = 0; index < Math.max(css.length, js.length); index++) {
    if (index < css.length) pending.push(warmAssetHint(normalized, css[index], 'css', timeoutMs));
    if (index < js.length) pending.push(warmAssetHint(normalized, js[index], 'js', timeoutMs));
  }
  const results = await waitForResource(Promise.all(pending), { signal, timeoutMs, label: 'app asset warmup' });
  return results.reduce((count, value) => count + value, 0);
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
