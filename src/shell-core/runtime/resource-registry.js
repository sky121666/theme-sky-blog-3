let assetManifestPromise = null;
let themeAssetBaseCache = null;
let themeAssetVersionQueryCache = null;

function inferThemeAssetBase() {
  if (themeAssetBaseCache) return themeAssetBaseCache;

  const shellCoreCssLink = document.querySelector('link[href*="/css/shell-core/index.css"], link[href*="/shell-core.css"], link[href*="/main.css"]');
  if (shellCoreCssLink) {
    const href = String(shellCoreCssLink.getAttribute('href') || '').split('?')[0];
    const idx = href.lastIndexOf('/css/');
    if (idx >= 0) {
      themeAssetBaseCache = href.substring(0, idx + 1);
      return themeAssetBaseCache;
    }
  }

  const shellCoreJsScript = document.querySelector('script[src*="/js/shell-core/index.js"], script[src*="/shell-core.js"], script[src*="/main.js"]');
  if (shellCoreJsScript) {
    const src = String(shellCoreJsScript.getAttribute('src') || '').split('?')[0];
    const idx = src.lastIndexOf('/js/');
    if (idx >= 0) {
      themeAssetBaseCache = src.substring(0, idx + 1);
      return themeAssetBaseCache;
    }
  }

  themeAssetBaseCache = '/assets/';
  return themeAssetBaseCache;
}

export function getThemeAssetBase() {
  return inferThemeAssetBase();
}

function inferThemeAssetVersionQuery() {
  if (themeAssetVersionQueryCache !== null) return themeAssetVersionQueryCache;

  const candidates = [
    document.querySelector('link[href*="/css/shell-core/index.css"]'),
    document.querySelector('script[data-app-script]'),
    document.querySelector('link[data-app-css]')
  ];

  for (const element of candidates) {
    const rawUrl = String(
      element?.getAttribute?.('href')
      || element?.getAttribute?.('src')
      || ''
    );

    if (!rawUrl) continue;

    try {
      const parsed = new URL(rawUrl, window.location.origin);
      const query = parsed.search ? parsed.search.slice(1) : '';
      if (query) {
        themeAssetVersionQueryCache = query;
        return themeAssetVersionQueryCache;
      }
    } catch (_error) {
      // Ignore malformed URLs and fall through to the next candidate.
    }
  }

  themeAssetVersionQueryCache = '';
  return themeAssetVersionQueryCache;
}

export function withThemeAssetVersion(url) {
  const normalized = String(url || '');
  if (!normalized) return normalized;

  const versionQuery = inferThemeAssetVersionQuery();
  if (!versionQuery) return normalized;

  try {
    const parsed = new URL(normalized, window.location.origin);
    const incoming = new URLSearchParams(versionQuery);

    incoming.forEach((value, key) => {
      if (!parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, value);
      }
    });

    if (normalized.startsWith('/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return parsed.toString();
  } catch (_error) {
    return normalized;
  }
}

export function loadAssetManifest(options = {}) {
  const { force = false } = options;

  if (force) {
    assetManifestPromise = null;
  }

  if (assetManifestPromise) return assetManifestPromise;

  assetManifestPromise = fetch(withThemeAssetVersion(`${getThemeAssetBase()}asset-manifest.json`), {
    credentials: 'same-origin',
    cache: 'no-store'
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`asset-manifest ${response.status}`);
      }
      return response.json();
    })
    .then((manifest) => {
      const buildVersion = String(manifest?.__meta?.version || '').trim();
      if (buildVersion) {
        themeAssetVersionQueryCache = `v=${encodeURIComponent(buildVersion)}`;
      }
      return manifest;
    })
    .catch(() => {
      // Allow the next navigation to retry manifest loading instead of
      // pinning the whole session to an empty manifest after one transient failure.
      assetManifestPromise = null;
      return {};
    });

  return assetManifestPromise;
}

export async function getAssetsForApp(appId) {
  if (!appId) return { js: [], css: [] };

  const manifest = await loadAssetManifest();
  const entry = manifest?.[appId];
  return {
    js: Array.isArray(entry?.js) ? entry.js : [],
    css: Array.isArray(entry?.css) ? entry.css : []
  };
}

export async function getLatestThemeBuildVersion(options = {}) {
  const manifest = await loadAssetManifest(options);
  return String(manifest?.__meta?.version || '').trim();
}
