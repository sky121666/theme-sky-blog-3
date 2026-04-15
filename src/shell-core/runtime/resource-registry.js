let assetManifestPromise = null;
let themeAssetBaseCache = null;

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

export function loadAssetManifest() {
  if (assetManifestPromise) return assetManifestPromise;

  assetManifestPromise = fetch(`${getThemeAssetBase()}asset-manifest.json`, {
    credentials: 'same-origin'
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`asset-manifest ${response.status}`);
      }
      return response.json();
    })
    .catch(() => ({}));

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
