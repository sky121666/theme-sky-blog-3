let assetManifestPromise = null;
let assetManifestPending = false;
let assetManifestGeneration = 0;
let themeAssetBaseCache = null;
let themeAssetVersionQueryCache = null;
let themeAssetIdentityCache = null;

const RESOURCE_TIMEOUT_MS = 15_000;

// A consumer can stop waiting without cancelling a shared download used by
// another navigation. The deadline also covers response body consumption.
export function waitForResource(promise, options = {}) {
  const { signal, timeoutMs = RESOURCE_TIMEOUT_MS, label = 'resource', onTimeout } = options;
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onAbort = () => finish(reject, signal.reason || new DOMException('Aborted', 'AbortError'));
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      finish(reject, new DOMException(`${label} timed out after ${timeoutMs}ms`, 'TimeoutError'));
      onTimeout?.();
    }, timeoutMs);
  });
}

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

  // Halo's SSR resource revision is not the compiled build revision. Prefer
  // the identity embedded in this running module, including bootstrap fallback.
  const buildVersion = typeof __THEME_BUILD_VERSION__ === 'string' ? __THEME_BUILD_VERSION__ : '';
  const buildRevision = typeof __THEME_BUILD_REVISION__ === 'string' ? __THEME_BUILD_REVISION__ : '';
  const bootstrapIdentity = window.__THEME_ASSET_IDENTITY__;
  if (buildVersion && buildRevision) {
    themeAssetVersionQueryCache = new URLSearchParams({ v: buildVersion, r: buildRevision }).toString();
    return themeAssetVersionQueryCache;
  }
  if (bootstrapIdentity?.source === 'manifest' && bootstrapIdentity.version && bootstrapIdentity.revision) {
    themeAssetVersionQueryCache = new URLSearchParams({ v: bootstrapIdentity.version, r: bootstrapIdentity.revision }).toString();
    return themeAssetVersionQueryCache;
  }

  const candidates = [
    document.querySelector('link[href*="/css/shell-core/index.css"]'),
    document.querySelector('script[src*="/js/shell-core/index.js"]'),
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
      if (key === 'v' || key === 'r' || !parsed.searchParams.has(key)) {
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

export function getCurrentThemeAssetVersion() {
  const versionQuery = inferThemeAssetVersionQuery();
  if (!versionQuery) return '';

  try {
    return new URLSearchParams(versionQuery).get('v') || '';
  } catch (_error) {
    return '';
  }
}

export function getCurrentThemeAssetIdentity() {
  if (!themeAssetIdentityCache) {
    const params = new URLSearchParams(inferThemeAssetVersionQuery());
    themeAssetIdentityCache = Object.freeze({ version: params.get('v') || '', revision: params.get('r') || '' });
  }
  return themeAssetIdentityCache;
}

export function isSameThemeAssetIdentity(current, latest) {
  return current?.version === latest?.version && current?.revision === latest?.revision;
}

function normalizeManifestAssetQuery(meta = {}) {
  const explicitQuery = String(meta.query || '').trim().replace(/^\?/, '');
  if (explicitQuery) return explicitQuery;

  const buildVersion = String(meta.version || '').trim();
  const buildRevision = String(meta.revision || '').trim();
  if (!buildVersion && !buildRevision) return '';

  const params = new URLSearchParams();
  if (buildVersion) params.set('v', buildVersion);
  if (buildRevision) params.set('r', buildRevision);
  return params.toString();
}

export function loadAssetManifest(options = {}) {
  const { force = false, signal, timeoutMs = RESOURCE_TIMEOUT_MS } = options;
  if (!force && !assetManifestPromise) {
    const identity = window.__THEME_ASSET_IDENTITY__;
    const manifest = window.__THEME_ASSET_MANIFEST__;
    const meta = manifest?.__meta;
    const compiled = getCurrentThemeAssetIdentity();
    const expectedQuery = new URLSearchParams({ v: compiled.version, r: compiled.revision }).toString();
    if (identity?.source === 'manifest'
      && compiled.version && compiled.revision
      && identity.version === compiled.version && identity.revision === compiled.revision
      && identity.query === expectedQuery
      && meta && meta.version === compiled.version && meta.revision === compiled.revision
      && meta.query === expectedQuery) {
      assetManifestPromise = Promise.resolve(manifest);
    }
  }
  // Forced freshness checks share an in-flight request. They only bypass a
  // completed cache, so visibility/pageshow cannot start competing writers.
  if (!assetManifestPromise || (force && !assetManifestPending)) {
    const generation = ++assetManifestGeneration;
    const controller = new AbortController();
    assetManifestPending = true;
    const request = Promise.resolve().then(() => fetch(withThemeAssetVersion(`${getThemeAssetBase()}asset-manifest.json`), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal
    })).then((response) => {
      if (!response.ok) throw new Error(`asset-manifest ${response.status}`);
      return response.json();
    });
    assetManifestPromise = waitForResource(request, {
      timeoutMs,
      label: 'asset-manifest',
      onTimeout: () => controller.abort()
    }).catch((error) => {
      if (generation === assetManifestGeneration) assetManifestPromise = null;
      throw error;
    }).finally(() => {
      if (generation === assetManifestGeneration) assetManifestPending = false;
    });
  }
  return waitForResource(assetManifestPromise, { signal, timeoutMs, label: 'asset-manifest' });
}

export async function getAssetsForApp(appId, options = {}) {
  if (!appId) return { js: [], css: [] };

  const manifest = await loadAssetManifest(options);
  const current = getCurrentThemeAssetIdentity();
  const query = new URLSearchParams(normalizeManifestAssetQuery(manifest?.__meta));
  const latest = { version: query.get('v') || '', revision: query.get('r') || '' };
  if ((current.version || current.revision) && !isSameThemeAssetIdentity(current, latest)) {
    const error = new Error('Theme build changed; reload before loading app assets');
    error.name = 'ThemeAssetIdentityError';
    throw error;
  }
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

export async function getLatestThemeAssetIdentity(options = {}) {
  const manifest = await loadAssetManifest(options);
  const query = new URLSearchParams(normalizeManifestAssetQuery(manifest?.__meta));
  return { version: query.get('v') || '', revision: query.get('r') || '' };
}
