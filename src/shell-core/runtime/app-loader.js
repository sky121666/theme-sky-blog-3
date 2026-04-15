import { getAssetsForApp, getThemeAssetBase } from './resource-registry.js';

const loadedAppsCss = new Set(['']);
const loadedAppsJs = new Set(['']);

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

export function markAppAssetsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  loadedAppsCss.add(normalized);
  loadedAppsJs.add(normalized);
}

export async function ensureAppCssLoaded(appId) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsCss.has(normalized)) return;

  const assets = await getAssetsForApp(normalized);
  const cssFiles = assets.css;
  if (!cssFiles.length) {
    loadedAppsCss.add(normalized);
    return;
  }

  cssFiles.forEach((href) => {
    const normalizedHref = String(href || '');
    if (!normalizedHref) return;

    const fileName = normalizedHref.split('/').pop();
    const existing = document.querySelector(`link[data-app-css="${normalized}"], link[href*="${fileName}"], link[href*="/css/apps/${segment}/index.css"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = normalizedHref.startsWith('/') ? normalizedHref : `${getThemeAssetBase()}css/apps/${segment}/index.css`;
    link.dataset.appCss = normalized;
    document.head.appendChild(link);
  });

  loadedAppsCss.add(normalized);
}

export async function ensureAppJsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  const segment = assetPathSegment(normalized);
  if (!normalized || loadedAppsJs.has(normalized)) return;

  const assets = await getAssetsForApp(normalized);
  const jsFiles = assets.js;
  if (!jsFiles.length) {
    loadedAppsJs.add(normalized);
    return;
  }

  await Promise.all(jsFiles.map((src) => new Promise((resolve, reject) => {
    const normalizedSrc = String(src || '');
    if (!normalizedSrc) {
      resolve(null);
      return;
    }

    const fileName = normalizedSrc.split('/').pop();
    const existing = document.querySelector(`script[data-app-script="${normalized}"], script[src*="${fileName}"], script[src*="/js/apps/${segment}/index.js"]`);
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.type = 'module';
    script.src = normalizedSrc.startsWith('/') ? normalizedSrc : `${getThemeAssetBase()}js/apps/${segment}/index.js`;
    script.dataset.appScript = normalized;
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error(`load app script failed: ${normalizedSrc}`));
    document.head.appendChild(script);
  })));

  loadedAppsJs.add(normalized);
}

export async function ensureAppAssetsLoaded(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return;
  await ensureAppCssLoaded(normalized);
  await ensureAppJsLoaded(normalized);
}
