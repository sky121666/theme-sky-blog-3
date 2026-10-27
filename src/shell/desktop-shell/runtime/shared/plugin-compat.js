import { installCommentEditReadiness } from '../../../../shared/comment-edit-readiness.js';

const LIGHT_GALLERY_ROOT_SELECTOR = '#article-content';
const LIGHT_GALLERY_UID_ATTRIBUTE = 'lg-uid';
const LIGHT_GALLERY_ASSET_PATTERN = /\/plugins\/PluginLightGallery\/assets\/static\//i;
const LIGHT_GALLERY_SCRIPT_DEADLINE_MS = 15000;
const PLUGIN_COMPAT_GUARD = '__THEME_PLUGIN_COMPAT_INITIALIZED__';
const ONLINE_HISTORY_GUARD = '__THEME_ONLINE_HISTORY_BRIDGE_INITIALIZED__';
const ONLINE_PRIVATE_STATE_KEY = '__themeOnlinePrivatePage';

let refreshFrame = 0;
let cancelRefreshFrame = null;
let refreshGeneration = 0;
let lightGalleryAssetsReady = Promise.resolve();
const loadedPluginScripts = new Map();
const observedPluginScripts = new WeakMap();
let stagedOnlineHistoryState = null;
const CONTACT_FORM_AUTO_SELECTOR = 'body > halo-contact-form-auto-loader, body > halo-contact-form-auto-display';
const contactFormAssets = new Map();
let contactFormIntentId = null;
let stagedContactForms = null;
let committedContactForms = null;
let contactFormGeneration = 0;

function contactFormAutoNodes() {
  return Array.from(document.querySelectorAll(CONTACT_FORM_AUTO_SELECTOR));
}

function clearAutomaticContactForms() {
  // Plugin-generated roots live directly under body. Embedded forms and their
  // answers belong to the content lifecycle and must not be removed here.
  contactFormAutoNodes().forEach((node) => node.remove());
}

function stageContactFormsFromResponse(responseText) {
  if (!responseText || typeof DOMParser !== 'function') return;
  const targetDoc = new DOMParser().parseFromString(responseText, 'text/html');
  let forms = null;
  for (const script of targetDoc.querySelectorAll('script:not([src])')) {
    // AutoContactFormWidget emits JSON, not executable theme code. Never replay
    // arbitrary inline scripts from a response to recover this page-local data.
    const match = (script.textContent || '').match(/^\s*var\s+autoContactFrom\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (!match) continue;
    try {
      const value = JSON.parse(match[1]);
      if (Array.isArray(value)) forms = value.filter((item) => item && typeof item === 'object');
    } catch (_error) { /* Invalid configuration must not execute. */ }
  }
  if (forms === null && !Array.isArray(window.autoContactFrom)) return;
  forms ??= [];
  committedContactForms ??= Array.isArray(window.autoContactFrom) ? window.autoContactFrom : [];
  stagedContactForms = { forms, intentId: contactFormIntentId };
  contactFormGeneration += 1;
  // Keep the connected source instances while the response is staged. Reconnecting
  // an official display element rebuilds its form and loses the open draft, so
  // rollback must reuse the live tree rather than recreate or reattach it.
  // The plugin's own pjax:success handler must see the target page's data.
  window.autoContactFrom = forms;
}

function ensureContactFormElement(file, tag) {
  if (window.customElements?.get(tag)) return Promise.resolve();
  const loader = document.querySelector('script[src*="/PluginContactForm/assets/static/contact-form-loader.iife.js"]');
  if (!loader?.src || !window.customElements) return Promise.reject(new Error('ContactForm loader is unavailable'));
  const url = new URL(file, loader.src);
  url.search = new URL(loader.src).search;
  const src = url.href;
  if (contactFormAssets.has(src)) return contactFormAssets.get(src);
  let script = Array.from(document.querySelectorAll('script[src]')).find((node) => {
    if (node.src !== src) return false;
    // The official loader leaves failed assets in the DOM. Such a node cannot
    // register its element, so a later navigation must request the URL again.
    if (node.dataset.contactFormScriptState === 'error') {
      node.remove();
      return false;
    }
    return true;
  });
  const created = !script;
  script ||= document.createElement('script');
  const pending = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.removeEventListener('error', onError);
      if (error) {
        contactFormAssets.delete(src);
        if (created) script.remove();
        reject(error);
      } else resolve();
    };
    const onError = () => finish(new Error(`ContactForm asset failed: ${file}`));
    const timeout = window.setTimeout(() => finish(new Error(`ContactForm asset timed out: ${file}`)), 15000);
    script.addEventListener('error', onError, { once: true });
    window.customElements.whenDefined(tag).then(() => finish());
    if (created) {
      script.src = src;
      script.dataset.themePluginCompat = 'contact-form';
      document.head.appendChild(script);
    }
  });
  contactFormAssets.set(src, pending);
  return pending;
}

async function refreshAutomaticContactForms() {
  const generation = ++contactFormGeneration;
  const forms = window.autoContactFrom;
  if (!Array.isArray(forms)) return;
  if (!forms.length) {
    clearAutomaticContactForms();
    return;
  }
  try {
    await ensureContactFormElement('contact-form.iife.js', 'halo-contact-form');
    await ensureContactFormElement('contact-form-display.iife.js', 'halo-contact-form-auto-display');
  } catch (error) {
    if (generation === contactFormGeneration) console.warn('ContactForm asset load failed:', error);
    return;
  }
  if (generation !== contactFormGeneration) return;
  // Match the official display scheduler: one popup and 56px stacking per side.
  let hasPopup = false;
  const positions = new Map();
  const desired = forms.flatMap((config) => {
    const display = config.displayFormConfig;
    if (display?.displayForm === 'page_popup') {
      if (hasPopup) return [];
      hasPopup = true;
      return [{ config, offset: 0 }];
    }
    if (display?.displayForm !== 'aside_button') return [];
    const position = ['left_bottom', 'left_center', 'right_bottom', 'right_center', 'center'].includes(display.displayPosition)
      ? display.displayPosition : 'right_center';
    const index = positions.get(position) || 0;
    positions.set(position, index + 1);
    return [{ config, offset: index * 56 }];
  });
  const existing = contactFormAutoNodes();
  if (existing.length === desired.length && existing.every((node, index) =>
    node.localName === 'halo-contact-form-auto-display'
    && node.config === JSON.stringify(desired[index].config)
    && node.style.getPropertyValue('--halo-contact-form-stack-offset') === `${desired[index].offset}px`
  )) return;
  clearAutomaticContactForms();
  desired.forEach(({ config, offset }) => {
    const node = document.createElement('halo-contact-form-auto-display');
    node.style.setProperty('--halo-contact-form-stack-offset', `${offset}px`);
    node.config = config;
    document.body.appendChild(node);
  });
}

function settleContactForms(event, rollback = false) {
  if (!stagedContactForms || (stagedContactForms.intentId !== null
    && event?.detail?.intentId !== stagedContactForms.intentId)) return;
  window.autoContactFrom = rollback ? committedContactForms : stagedContactForms.forms;
  if (!rollback) {
    committedContactForms = stagedContactForms.forms;
    // A successful target owns a fresh form even when its placement is equal.
    // Only rollback may reuse the previous page's open dialog and draft.
    clearAutomaticContactForms();
  }
  stagedContactForms = null;
  void refreshAutomaticContactForms();
}

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

function observeExistingScript(script) {
  if (observedPluginScripts.has(script)) return observedPluginScripts.get(script);

  const state = {
    status: script.dataset?.themePluginCompatState === 'ready'
      || script.readyState === 'loaded'
      || script.readyState === 'complete'
      || (document.readyState === 'complete'
        && script.async === false
        && typeof window.lightGallery === 'function') ? 'ready' : 'loading',
    waiters: new Set()
  };
  observedPluginScripts.set(script, state);
  if (state.status === 'ready') return state;

  const settle = (status) => {
    state.status = status;
    script.removeEventListener('load', onLoad);
    script.removeEventListener('error', onError);
    state.waiters.forEach((waiter) => waiter(status));
    state.waiters.clear();
  };
  const onLoad = () => settle('ready');
  const onError = () => settle('error');
  script.addEventListener('load', onLoad);
  script.addEventListener('error', onError);
  return state;
}

function ensureScript(src) {
  const normalized = normalizeAssetUrl(src);
  if (!normalized) return Promise.resolve();
  if (loadedPluginScripts.has(normalized)) return loadedPluginScripts.get(normalized);

  let existingState;
  const existing = Array.from(document.querySelectorAll('script[src]'))
    .find((script) => {
      if (normalizeAssetUrl(script.getAttribute('src')) !== normalized) return false;
      const state = observeExistingScript(script);
      if (state.status === 'error') return false;
      existingState = state;
      return true;
    });
  if (existing) {
    if (existingState.status === 'ready') {
      const ready = Promise.resolve();
      loadedPluginScripts.set(normalized, ready);
      return ready;
    }
    const ready = new Promise((resolve, reject) => {
      const finish = (status) => {
        window.clearTimeout(timeoutId);
        existingState.waiters.delete(finish);
        if (status === 'ready') {
          resolve();
        } else {
          if (loadedPluginScripts.get(normalized) === ready) loadedPluginScripts.delete(normalized);
          reject(new Error(`LightGallery asset failed: ${src}`));
        }
      };
      existingState.waiters.add(finish);
      const timeoutId = window.setTimeout(() => {
        window.clearTimeout(timeoutId);
        existingState.waiters.delete(finish);
        if (loadedPluginScripts.get(normalized) === ready) loadedPluginScripts.delete(normalized);
        reject(new Error(`LightGallery asset timed out: ${src}`));
      }, LIGHT_GALLERY_SCRIPT_DEADLINE_MS);
    });
    loadedPluginScripts.set(normalized, ready);
    return ready;
  }

  const script = document.createElement('script');
  script.src = src;
  script.dataset.themePluginCompat = 'lightgallery';
  script.dataset.themePluginCompatState = 'loading';
  let finish;
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const onLoad = () => finish();
    const onError = () => finish(new Error(`LightGallery asset failed: ${src}`));
    finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) {
        script.dataset.themePluginCompatState = 'error';
        if (loadedPluginScripts.get(normalized) === ready) loadedPluginScripts.delete(normalized);
        script.remove();
        reject(error);
      } else {
        script.dataset.themePluginCompatState = 'ready';
        resolve();
      }
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    timeoutId = window.setTimeout(
      () => finish(new Error(`LightGallery asset timed out: ${src}`)),
      LIGHT_GALLERY_SCRIPT_DEADLINE_MS
    );
  });
  loadedPluginScripts.set(normalized, ready);
  try {
    document.head.appendChild(script);
  } catch (error) {
    finish(error);
  }
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
  stageContactFormsFromResponse(responseText);
  if (options.stageOnlineHistory) {
    stageOnlineMonitorHistoryState(responseText, options.targetUrl);
  } else {
    syncOnlineMonitorMetaFromResponse(responseText);
  }
  lightGalleryAssetsReady = lightGalleryAssetsReady
    .catch(() => {})
    .then(() => prepareLightGalleryAssets(responseText));
  lightGalleryAssetsReady.catch((error) => {
    console.warn('LightGallery asset load failed:', error);
  });
  return lightGalleryAssetsReady;
}

function cancelScheduledLightGalleryRefresh() {
  refreshGeneration += 1;
  if (!refreshFrame) return;
  cancelRefreshFrame?.(refreshFrame);
  refreshFrame = 0;
  cancelRefreshFrame = null;
}

export function disposePluginUiBeforeNavigationCommit() {
  cancelScheduledLightGalleryRefresh();
  return disposeLightGallery(document);
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
    try {
      await lightGalleryAssetsReady;
    } catch (_error) {
      return;
    }
    if (generation !== refreshGeneration) return;
    mountLightGallery(root?.isConnected === false ? document : root);
  });
}

export function initPluginCompatibility() {
  if (window[PLUGIN_COMPAT_GUARD]) return;
  window[PLUGIN_COMPAT_GUARD] = true;
  void installCommentEditReadiness(window);
  installOnlineMonitorHistoryBridge();

  const refreshAfterNavigation = (event) => {
    if (event?.detail?.mode === 'local') return;
    settleContactForms(event);
    scheduleLightGalleryRefresh(event?.detail?.root || document);
  };
  const recoverAfterNavigationError = (event) => {
    syncOnlineMonitorMetaFromHistoryState(window.history?.state);
    refreshAfterNavigation(event);
  };

  const recoverAfterSettledNavigation = (event) => {
    if (!['cancelled', 'failed', 'native'].includes(event?.detail?.outcome)) return;
    settleContactForms(event, true);
    recoverAfterNavigationError(event);
  };

  document.addEventListener('theme:navigation-accepted', (event) => {
    contactFormIntentId = event?.detail?.intentId ?? null;
  });
  document.addEventListener('theme:navigation-settled', recoverAfterSettledNavigation);
  document.addEventListener('theme:pjax-ready', refreshAfterNavigation);
  window.addEventListener('pageshow', refreshAfterNavigation);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleLightGalleryRefresh(document), { once: true });
  } else {
    scheduleLightGalleryRefresh(document);
  }
}
