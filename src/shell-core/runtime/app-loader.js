import { getAssetsForApp, getThemeAssetBase, withThemeAssetVersion } from './resource-registry.js';

const loadedAppsCss = new Set(['']);
const loadedAppsJs = new Set(['']);
const pendingAppsCss = new Map();
const pendingAppsJs = new Map();

function normalizeAppId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assetPathSegment(appId) {
  switch (normalizeAppId(appId)) {
    case 'explorer-tags':
      return 'tags';
    case 'explorer-categories':
      return 'categories';
    case 'explorer-author':
      return 'author';
    case 'explorer-archives':
      return 'archives';
    default:
      return normalizeAppId(appId);
  }
}

function getFallbackCssPath(appId) {
  const segment = assetPathSegment(appId);
  return withThemeAssetVersion(`${getThemeAssetBase()}css/apps/${segment}/index.css`);
}

function getFallbackJsPath(appId) {
  const segment = assetPathSegment(appId);
  return withThemeAssetVersion(`${getThemeAssetBase()}js/apps/${segment}/index.js`);
}

function normalizeAssetPath(urlLike) {
  const raw = String(urlLike || '');
  if (!raw) return '';

  try {
    return new URL(raw, window.location.origin).pathname;
  } catch (_error) {
    return raw.split('?')[0];
  }
}

function findExistingCssLink(appId, href, segment) {
  const normalizedAppId = normalizeAppId(appId);
  const expectedPath = normalizeAssetPath(href);
  const fallbackPath = `${getThemeAssetBase()}css/apps/${segment}/index.css`.replace(window.location.origin, '');

  return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((link) => {
    if (link.dataset.appCss === normalizedAppId) return true;
    const linkPath = normalizeAssetPath(link.href || link.getAttribute('href') || '');
    return linkPath === expectedPath || linkPath === fallbackPath;
  }) || null;
}

function findExistingScript(appId, src, segment) {
  const normalizedAppId = normalizeAppId(appId);
  const expectedPath = normalizeAssetPath(src);
  const fallbackPath = `${getThemeAssetBase()}js/apps/${segment}/index.js`.replace(window.location.origin, '');

  return Array.from(document.querySelectorAll('script[type="module"], script[data-app-script]')).find((script) => {
    if (script.dataset.appScript === normalizedAppId) return true;
    const scriptPath = normalizeAssetPath(script.src || script.getAttribute('src') || '');
    return scriptPath === expectedPath || scriptPath === fallbackPath;
  }) || null;
}

function waitForStylesheetLink(link, href) {
  if (!link) return Promise.resolve(null);
  if (link.dataset.appCssReady === 'true' || link.sheet) {
    link.dataset.appCssReady = 'true';
    return Promise.resolve(link);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
    };

    const onLoad = () => {
      link.dataset.appCssReady = 'true';
      cleanup();
      resolve(link);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`load app css failed: ${href}`));
    };

    link.addEventListener('load', onLoad, { once: true });
    link.addEventListener('error', onError, { once: true });
  });
}

export function markAppAssetsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  loadedAppsCss.add(normalized);
  loadedAppsJs.add(normalized);
  pendingAppsCss.delete(normalized);
  pendingAppsJs.delete(normalized);
}

export async function ensureAppCssLoaded(appId) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsCss.has(normalized)) return;
  if (pendingAppsCss.has(normalized)) {
    return pendingAppsCss.get(normalized);
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
        link.href = normalizedHref.startsWith('/') ? normalizedHref : getFallbackCssPath(normalized);
        link.dataset.appCss = normalized;
        document.head.appendChild(link);
      } else if (!link.dataset.appCss) {
        link.dataset.appCss = normalized;
      }

      return waitForStylesheetLink(link, normalizedHref);
    }));

    loadedAppsCss.add(normalized);
  })().finally(() => {
    pendingAppsCss.delete(normalized);
  });

  pendingAppsCss.set(normalized, promise);
  return promise;
}

export async function ensureAppJsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsJs.has(normalized)) return;
  if (pendingAppsJs.has(normalized)) {
    return pendingAppsJs.get(normalized);
  }

  const promise = (async () => {
    const assets = await getAssetsForApp(normalized);
    const jsFiles = assets.js.length ? assets.js : [getFallbackJsPath(normalized)];

    await Promise.all(jsFiles.map((src) => new Promise((resolve, reject) => {
      const normalizedSrc = withThemeAssetVersion(String(src || ''));
      if (!normalizedSrc) {
        resolve(null);
        return;
      }

      const existing = findExistingScript(normalized, normalizedSrc, segment);
      if (existing) {
        resolve(existing);
        return;
      }

      const script = document.createElement('script');
      script.type = 'module';
      script.src = normalizedSrc.startsWith('/') ? normalizedSrc : getFallbackJsPath(normalized);
      script.dataset.appScript = normalized;
      script.onload = () => resolve(script);
      script.onerror = () => reject(new Error(`load app script failed: ${normalizedSrc}`));
      document.head.appendChild(script);
    })));

    loadedAppsJs.add(normalized);
  })().finally(() => {
    pendingAppsJs.delete(normalized);
  });

  pendingAppsJs.set(normalized, promise);
  return promise;
}

export async function ensureAppAssetsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  await ensureAppCssLoaded(normalized);
  await ensureAppJsLoaded(normalized);
}
