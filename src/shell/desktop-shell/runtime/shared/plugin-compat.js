const LIGHT_GALLERY_ROOT_SELECTOR = '#article-content';
const LIGHT_GALLERY_UID_ATTRIBUTE = 'lg-uid';
const LIGHT_GALLERY_ASSET_PATTERN = /\/plugins\/PluginLightGallery\/assets\/static\//i;
const PLUGIN_COMPAT_GUARD = '__THEME_PLUGIN_COMPAT_INITIALIZED__';
const ONLINE_HISTORY_GUARD = '__THEME_ONLINE_HISTORY_BRIDGE_INITIALIZED__';
const ONLINE_PRIVATE_STATE_KEY = '__themeOnlinePrivatePage';

let refreshFrame = 0;
let cancelRefreshFrame = null;
let refreshGeneration = 0;
let lightGalleryAssetsReady = Promise.resolve();
const loadedPluginScripts = new Map();
let stagedOnlineHistoryState = null;

function collectElements(root, selector) {
  const elements = [];
  if (root?.matches?.(selector)) {
    elements.push(root);
  }
  root?.querySelectorAll?.(selector)?.forEach((element) => {
    if (!elements.includes(element)) {
      elements.push(element);
    }
  });
  return elements;
}

export function disposeLightGallery(root = document) {
  let disposed = 0;

  collectElements(
    root,
    `${LIGHT_GALLERY_ROOT_SELECTOR}[${LIGHT_GALLERY_UID_ATTRIBUTE}]`
  ).forEach((gallery) => {
    const uid = gallery.getAttribute(LIGHT_GALLERY_UID_ATTRIBUTE);
    const instance = uid ? window.lgData?.[uid] : null;

    if (typeof instance?.destroy === 'function') {
      instance.destroy(true);
      disposed += 1;
      return;
    }

    gallery.removeAttribute(LIGHT_GALLERY_UID_ATTRIBUTE);
  });

  return disposed;
}

export function mountLightGallery(root = document) {
  if (typeof window.lightGallery !== 'function') return 0;

  let mounted = 0;
  collectElements(root, LIGHT_GALLERY_ROOT_SELECTOR).forEach((gallery) => {
    if (gallery.hasAttribute(LIGHT_GALLERY_UID_ATTRIBUTE)) return;

    const images = Array.from(gallery.querySelectorAll('img'));
    if (!images.length) return;

    images.forEach((image) => {
      const source = image.currentSrc || image.src || image.getAttribute('src') || '';
      if (source) image.dataset.src = source;
    });

    window.lightGallery(gallery, { selector: 'img' });
    mounted += 1;
  });

  return mounted;
}

function normalizeAssetUrl(value) {
  if (!value) return '';
  try {
    return new URL(value, window.location.href).href;
  } catch (_error) {
    return '';
  }
}

function hasAsset(selector, assetUrl) {
  const expected = normalizeAssetUrl(assetUrl);
  if (!expected) return false;
  return Array.from(document.querySelectorAll(selector))
    .some((element) => normalizeAssetUrl(element.getAttribute('href') || element.getAttribute('src')) === expected);
}

function ensureStylesheet(href) {
  if (!href || hasAsset('link[rel~="stylesheet"][href]', href)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.themePluginCompat = 'lightgallery';
  document.head.appendChild(link);
}

function ensureScript(src) {
  const normalized = normalizeAssetUrl(src);
  if (!normalized) return Promise.resolve();
  if (loadedPluginScripts.has(normalized)) return loadedPluginScripts.get(normalized);

  const existing = Array.from(document.querySelectorAll('script[src]'))
    .find((script) => normalizeAssetUrl(script.getAttribute('src')) === normalized);
  if (existing) {
    const ready = Promise.resolve();
    loadedPluginScripts.set(normalized, ready);
    return ready;
  }

  const ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.themePluginCompat = 'lightgallery';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => {
      loadedPluginScripts.delete(normalized);
      script.remove();
      reject(new Error(`LightGallery asset failed: ${src}`));
    }, { once: true });
    document.head.appendChild(script);
  });
  loadedPluginScripts.set(normalized, ready);
  return ready;
}

function prepareLightGalleryAssets(responseText) {
  if (!responseText || typeof DOMParser !== 'function') return Promise.resolve();

  const targetDoc = new DOMParser().parseFromString(responseText, 'text/html');
  const styles = Array.from(targetDoc.querySelectorAll('link[rel~="stylesheet"][href]'))
    .map((link) => link.getAttribute('href') || '')
    .filter((href) => LIGHT_GALLERY_ASSET_PATTERN.test(href));
  const scripts = Array.from(targetDoc.querySelectorAll('script[src]'))
    .map((script) => script.getAttribute('src') || '')
    .filter((src) => LIGHT_GALLERY_ASSET_PATTERN.test(src));

  styles.forEach(ensureStylesheet);
  return scripts.reduce(
    (pending, src) => pending.then(() => ensureScript(src)),
    Promise.resolve()
  );
}

function readOnlineMonitorPrivatePageFromResponse(responseText) {
  if (!responseText || !responseText.includes('__ONLINE_MONITOR_META__')) return null;

  let source = '';
  if (typeof DOMParser === 'function') {
    const targetDoc = new DOMParser().parseFromString(responseText, 'text/html');
    source = Array.from(targetDoc.querySelectorAll('script:not([src])'))
      .map((script) => script.textContent || '')
      .find((scriptText) => /window\.__ONLINE_MONITOR_META__\s*=\s*Object\.assign/.test(scriptText)) || '';
  } else {
    source = Array.from(responseText.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi))
      .map((match) => match[1] || '')
      .find((scriptText) => /window\.__ONLINE_MONITOR_META__\s*=\s*Object\.assign/.test(scriptText)) || '';
  }

  const privatePageMatch = source.match(/privatePage\s*:\s*(true|false)/i);
  if (!privatePageMatch) return null;

  return privatePageMatch[1].toLowerCase() === 'true';
}

export function syncOnlineMonitorMetaFromResponse(responseText) {
  const privatePage = readOnlineMonitorPrivatePageFromResponse(responseText);
  if (typeof privatePage !== 'boolean') return false;

  window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
    privatePage
  });
  return true;
}

export function stageOnlineMonitorHistoryState(responseText, targetUrl) {
  const privatePage = readOnlineMonitorPrivatePageFromResponse(responseText);
  if (typeof privatePage !== 'boolean') {
    stagedOnlineHistoryState = null;
    return false;
  }

  stagedOnlineHistoryState = {
    privatePage,
    targetUrl: normalizeHistoryUrl(targetUrl || window.location.href)
  };
  return true;
}

export function discardStagedOnlineMonitorHistoryState() {
  stagedOnlineHistoryState = null;
}

function withOnlineMonitorHistoryState(state, privatePage = window.__ONLINE_MONITOR_META__?.privatePage) {
  const baseState = state && typeof state === 'object' ? state : {};
  return {
    ...baseState,
    [ONLINE_PRIVATE_STATE_KEY]: Boolean(privatePage)
  };
}

function normalizeHistoryUrl(value) {
  try {
    const normalized = new URL(value || window.location.href, window.location.href);
    normalized.hash = '';
    return normalized.href;
  } catch (_error) {
    return '';
  }
}

function isStagedOnlineHistoryTarget(url) {
  if (!stagedOnlineHistoryState) return false;
  const normalizedTarget = normalizeHistoryUrl(url || window.location.href);
  return !stagedOnlineHistoryState.targetUrl
    || !normalizedTarget
    || normalizedTarget === stagedOnlineHistoryState.targetUrl;
}

export function syncOnlineMonitorMetaFromHistoryState(state) {
  const privatePage = state?.[ONLINE_PRIVATE_STATE_KEY];
  if (typeof privatePage !== 'boolean') return false;

  window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
    privatePage
  });
  return true;
}

function installOnlineMonitorHistoryBridge() {
  if (window[ONLINE_HISTORY_GUARD] || !window.history) return;
  window[ONLINE_HISTORY_GUARD] = true;

  const rawPushState = window.history.pushState.bind(window.history);
  const rawReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = function pushOnlineAwareState(state, title, url) {
    const staged = isStagedOnlineHistoryTarget(url) ? stagedOnlineHistoryState : null;
    const result = rawPushState(
      withOnlineMonitorHistoryState(state, staged?.privatePage),
      title,
      url
    );
    if (staged) {
      window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
        privatePage: staged.privatePage
      });
      stagedOnlineHistoryState = null;
    }
    return result;
  };
  window.history.replaceState = function replaceOnlineAwareState(state, title, url) {
    return rawReplaceState(withOnlineMonitorHistoryState(state), title, url);
  };

  window.addEventListener('popstate', (event) => {
    syncOnlineMonitorMetaFromHistoryState(event.state);
  }, { capture: true });

  window.history.replaceState(
    window.history.state,
    document.title,
    window.location.href
  );
}

export function preparePluginCompatibilityFromResponse(responseText, options = {}) {
  if (options.stageOnlineHistory) {
    stageOnlineMonitorHistoryState(responseText, options.targetUrl);
  } else {
    syncOnlineMonitorMetaFromResponse(responseText);
  }
  lightGalleryAssetsReady = lightGalleryAssetsReady
    .catch(() => {})
    .then(() => prepareLightGalleryAssets(responseText));
  return lightGalleryAssetsReady;
}

function cancelScheduledLightGalleryRefresh() {
  refreshGeneration += 1;
  if (!refreshFrame) return;
  cancelRefreshFrame?.(refreshFrame);
  refreshFrame = 0;
  cancelRefreshFrame = null;
}

function scheduleLightGalleryRefresh(root = document) {
  if (refreshFrame) return;

  const useAnimationFrame = typeof window.requestAnimationFrame === 'function';
  const schedule = useAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 0);
  cancelRefreshFrame = useAnimationFrame
    ? window.cancelAnimationFrame?.bind(window)
    : window.clearTimeout?.bind(window);
  const generation = refreshGeneration;
  refreshFrame = schedule(async () => {
    refreshFrame = 0;
    cancelRefreshFrame = null;
    await lightGalleryAssetsReady.catch(() => {});
    if (generation !== refreshGeneration) return;
    mountLightGallery(root?.isConnected === false ? document : root);
  });
}

export function initPluginCompatibility() {
  if (window[PLUGIN_COMPAT_GUARD]) return;
  window[PLUGIN_COMPAT_GUARD] = true;
  installOnlineMonitorHistoryBridge();

  const disposeBeforeNavigation = () => {
    cancelScheduledLightGalleryRefresh();
    disposeLightGallery(document);
  };
  const refreshAfterNavigation = (event) => {
    scheduleLightGalleryRefresh(event?.detail?.root || document);
  };
  const recoverAfterNavigationError = (event) => {
    syncOnlineMonitorMetaFromHistoryState(window.history?.state);
    refreshAfterNavigation(event);
  };

  document.addEventListener('pjax:send', disposeBeforeNavigation);
  document.addEventListener('pjax:same-variant-send', disposeBeforeNavigation);
  document.addEventListener('theme:content-swapped', refreshAfterNavigation);
  document.addEventListener('pjax:complete', refreshAfterNavigation);
  document.addEventListener('pjax:same-variant-complete', refreshAfterNavigation);
  document.addEventListener('pjax:error', recoverAfterNavigationError);
  window.addEventListener('pageshow', refreshAfterNavigation);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleLightGalleryRefresh(document), { once: true });
  } else {
    scheduleLightGalleryRefresh(document);
  }
}
