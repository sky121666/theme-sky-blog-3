/**
 * Pjax execution, leave admission and theme lifecycle events
 *
 * CSS routing:   ./css-router.js
 * SEO sync:      ./seo.js
 * Protocol:      ./protocol.js
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import {
  activatePageApp,
  deactivateCurrentPageApp,
  ensureCurrentPageAppActive,
  getActivePageAppDocumentState,
  prepareActivePageAppLocalNavigation
} from '../../shared/page-app.js';
import { createLogger } from '../../shared/debug.js';
import { installClickController } from './click-controller.js';
import {
  getCurrentPageApp,
  setCurrentPageApp,
  ensureAppAssetsLoaded,
  stageAppCssForNavigation,
  syncAppCss,
  parsePageAppFromResponse,
  inferPageAppForNavigation,
  inferPageAppFromUrl
} from './css-router.js';
import { inferWindowVariantFromUrl } from '../../../../../shell-core/runtime/route-manifest.js';
import {
  isContentSwitchAllowed,
  shouldUseWindowLoadingOverlay,
  supportsSameVariantContentSwitch
} from '../../../../../shell-core/runtime/app-manifests.js';
import { reconcileSeoHead, syncSeoHeadFromResponse } from './seo.js';
import {
  syncBodyDatasetFromResponse,
  parseWindowVariantFromResponse,
  parseContentFromResponse
} from './protocol.js';
import {
  createWindowLoadingController,
  hideOverlay,
  hasLoadingOverlay,
  clearBusyState
} from './loading-controller.js';
import {
  closeTransientNavigationUi,
  clearTransientNavigationUi
} from './navigation-ui.js';
import {
  discardStagedOnlineMonitorHistoryState,
  syncOnlineMonitorMetaFromHistoryState,
  disposePluginUiBeforeNavigationCommit,
  preparePluginCompatibilityFromResponse
} from '../../shared/plugin-compat.js';
import { syncHomeDesktopWidgetProtocolFromResponse } from '../../widgets/protocol.js';
import {
  cancelledPopstateRollbackDelta,
  createBrowserNavigationOwnership,
  createNavigationCoordinator,
  createTimedNavigationSignal,
  isFullNavigationCompletionCurrent,
  isCurrentNavigationIntent,
  isNavigationAbort,
  resolveNavigationHref,
  runNonFatalNavigationHook
} from './navigation-guard.js';
import { createBrowserNavStateStore } from './browser-nav-state.js';
import { prepareNavigation, commitNavigation, abandonNavigation, prepareNativeHandoff,
  revokeNativeHandoff } from './navigation-admission.js';

const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');
const NAVIGATION_INTENT_OPTION = '__themeNavigationIntent';
const FAILED_RESPONSE_OPTION = '__themeFailedResponse';
const PHOTOS_DETAIL_VIEW = 'detail';
const PHOTOS_SHARED_TRANSITION_CLASS = 'photos-shared-view-transition';
const PHOTOS_TRANSITION_OWNER_ATTR = 'data-photos-view-transition-owner';
const PHOTOS_TRANSITION_KIND_ATTR = 'data-photos-view-transition-kind';
const PHOTOS_TRANSITION_DIRECTION_ATTR = 'data-photos-view-transition-direction';
const PHOTOS_SHARED_TRANSITION_NAME = 'photos-active-photo';
const PJAX_REQUEST_TIMEOUT = 15_000;

function switchPjaxWindowFrame(oldElement, newElement) {
  deactivateCurrentPageApp();
  oldElement.outerHTML = newElement.outerHTML;
  this.onSwitch();
}
const PHOTOS_DETAIL_STEP_KIND = 'detail-step';
const PHOTOS_TRANSITION_IMAGE_TIMEOUT_MS = 200;
let photosViewTransitionSequence = 0;
let activePhotosViewTransition = null;
let photosViewTransitionSettleBarrier = Promise.resolve();

function findPhotosAppRoot(root) {
  if (!root) return null;
  if (root.matches?.('[data-app-root="photos"]')) return root;
  return root.querySelector?.('[data-app-root="photos"]') || null;
}

function findPhotoTransitionElement(photosRoot, view, photoName) {
  if (!photosRoot || !photoName) return null;

  if (view === PHOTOS_DETAIL_VIEW) {
    const detailFigure = photosRoot.querySelector('.photos-detail-figure[data-photo-name]');
    return detailFigure?.dataset.photoName === photoName ? detailFigure : null;
  }

  const card = Array.from(photosRoot.querySelectorAll('.photo-card[data-photo-name]'))
    .find((candidate) => candidate.dataset.photoName === photoName);
  return card?.querySelector('.photo-card-inner') || null;
}

function isPhotoTransitionSourceReady(element) {
  if (!element) return false;
  const image = element.querySelector('img');
  if (image && (!image.complete || image.naturalWidth <= 0)) return false;

  const clip = element.closest('.photos-grid-scroll');
  if (!clip) return true;
  const elementRect = element.getBoundingClientRect();
  const clipRect = clip.getBoundingClientRect();
  const tolerance = 1;
  return elementRect.width > 0
    && elementRect.height > 0
    && elementRect.top >= clipRect.top - tolerance
    && elementRect.left >= clipRect.left - tolerance
    && elementRect.right <= clipRect.right + tolerance
    && elementRect.bottom <= clipRect.bottom + tolerance;
}

function findDetailPhotoName(photosRoot) {
  return photosRoot
    ?.querySelector('.photos-detail-figure[data-photo-name]')
    ?.dataset.photoName || '';
}

function isPhotosDetailToDetailNavigation(contentContainer, targetContainer) {
  const currentRoot = findPhotosAppRoot(contentContainer);
  const targetRoot = findPhotosAppRoot(targetContainer);
  return currentRoot?.dataset.photosView === PHOTOS_DETAIL_VIEW
    && targetRoot?.dataset.photosView === PHOTOS_DETAIL_VIEW;
}

function resolvePhotosDetailDirection(currentRoot, targetRoot, triggerElement, sourcePhotoName, targetPhotoName) {
  const adjacentLink = triggerElement?.closest?.('.photos-detail-adjacent-btn');
  if (adjacentLink?.matches('[rel="next"]')) return 'next';
  if (adjacentLink?.matches('[rel="prev"]')) return 'previous';

  const compareFilmstripOrder = (root) => {
    const photoNames = Array.from(root?.querySelectorAll('.photos-detail-neighbor[data-photo-name]') || [])
      .map((item) => item.dataset.photoName || '');
    const sourceIndex = photoNames.indexOf(sourcePhotoName);
    const targetIndex = photoNames.indexOf(targetPhotoName);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return '';
    return targetIndex > sourceIndex ? 'next' : 'previous';
  };

  return compareFilmstripOrder(currentRoot)
    || compareFilmstripOrder(targetRoot)
    || 'neutral';
}

function centerPhotosFilmstripCurrentItem(root) {
  const filmstrip = root?.querySelector?.('.photos-detail-neighbor-list');
  const currentItem = filmstrip?.querySelector?.('.photos-detail-neighbor.is-current');
  if (!filmstrip || !currentItem) return;

  const filmstripRect = filmstrip.getBoundingClientRect();
  const currentRect = currentItem.getBoundingClientRect();
  const centerDelta = ((currentRect.left + currentRect.right) / 2)
    - ((filmstripRect.left + filmstripRect.right) / 2);
  if (Math.abs(centerDelta) <= 1) return;
  filmstrip.scrollLeft += centerDelta;
}

function preloadPhotosDetailTransitionTarget(
  descriptor,
  {
    timeoutMs = PHOTOS_TRANSITION_IMAGE_TIMEOUT_MS,
    signal = null
  } = {}
) {
  if (descriptor?.kind !== PHOTOS_DETAIL_STEP_KIND) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);

  const targetImage = descriptor.targetElement?.querySelector('img[src]');
  const source = targetImage?.getAttribute('src') || '';
  if (!source) return Promise.resolve(false);

  let sourceUrl;
  try {
    sourceUrl = new URL(source, document.baseURI).href;
  } catch (_error) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timeoutId = 0;
    const handleAbort = () => finish(false);
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', handleAbort);
      image.onload = null;
      image.onerror = null;
      resolve(Boolean(ready && image.complete && image.naturalWidth > 0));
    };
    const decodeLoadedImage = async () => {
      try {
        await image.decode?.();
      } catch (_error) {
        // A completed image can still be used when decode() is unavailable or rejects.
      }
      finish(true);
    };
    timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener?.('abort', handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
    if (settled) return;

    image.decoding = 'async';
    image.onload = decodeLoadedImage;
    image.onerror = () => finish(false);
    image.src = sourceUrl;
    if (image.complete) {
      if (image.naturalWidth > 0) void decodeLoadedImage();
      else finish(false);
    }
  });
}

function resolvePhotosSharedTransition(contentContainer, targetContainer, triggerElement) {
  const currentRoot = findPhotosAppRoot(contentContainer);
  const targetRoot = findPhotosAppRoot(targetContainer);
  if (!currentRoot || !targetRoot) return null;

  const currentView = currentRoot.dataset.photosView || '';
  const targetView = targetRoot.dataset.photosView || '';
  const isListToDetail = currentView !== PHOTOS_DETAIL_VIEW && targetView === PHOTOS_DETAIL_VIEW;
  const isDetailToDetail = currentView === PHOTOS_DETAIL_VIEW && targetView === PHOTOS_DETAIL_VIEW;
  if (!isListToDetail && !isDetailToDetail) return null;

  const triggerPhotoName = triggerElement?.closest?.('[data-photo-name]')?.dataset.photoName || '';
  const currentDetailName = findDetailPhotoName(currentRoot);
  const targetDetailName = findDetailPhotoName(targetRoot);
  const sourcePhotoName = isDetailToDetail
    ? currentDetailName
    : (triggerPhotoName || targetDetailName);
  const targetPhotoName = targetDetailName;
  if (!sourcePhotoName || !targetPhotoName) return null;
  if (isListToDetail && sourcePhotoName !== targetPhotoName) return null;
  if (isDetailToDetail && sourcePhotoName === targetPhotoName) return null;

  const currentElement = findPhotoTransitionElement(currentRoot, currentView, sourcePhotoName);
  const targetElement = findPhotoTransitionElement(targetRoot, targetView, targetPhotoName);
  if (!currentElement || !targetElement || !isPhotoTransitionSourceReady(currentElement)) return null;

  const kind = isDetailToDetail ? PHOTOS_DETAIL_STEP_KIND : 'list-to-detail';
  const direction = isDetailToDetail
    ? resolvePhotosDetailDirection(
      currentRoot,
      targetRoot,
      triggerElement,
      sourcePhotoName,
      targetPhotoName
    )
    : 'neutral';

  return {
    owner: String(++photosViewTransitionSequence),
    kind,
    direction,
    sourcePhotoName,
    targetPhotoName,
    transitionName: PHOTOS_SHARED_TRANSITION_NAME,
    currentElement,
    targetElement,
    targetView,
    elements: new Set()
  };
}

function markPhotosSharedTransitionElement(element, descriptor) {
  if (!element || !descriptor) return;
  element.setAttribute(PHOTOS_TRANSITION_OWNER_ATTR, descriptor.owner);
  element.style.viewTransitionName = descriptor.transitionName;
  descriptor.elements.add(element);
}

function beginPhotosSharedTransition(descriptor) {
  if (!descriptor) return;
  const root = document.documentElement;
  root.classList.add(PHOTOS_SHARED_TRANSITION_CLASS);
  root.setAttribute(PHOTOS_TRANSITION_OWNER_ATTR, descriptor.owner);
  root.setAttribute(PHOTOS_TRANSITION_KIND_ATTR, descriptor.kind);
  root.setAttribute(PHOTOS_TRANSITION_DIRECTION_ATTR, descriptor.direction);
  markPhotosSharedTransitionElement(descriptor.currentElement, descriptor);
}

function markPhotosSharedTransitionTarget(contentContainer, descriptor) {
  const targetRoot = findPhotosAppRoot(contentContainer);
  const targetElement = findPhotoTransitionElement(
    targetRoot,
    descriptor.targetView,
    descriptor.targetPhotoName
  );
  markPhotosSharedTransitionElement(targetElement, descriptor);
}

async function decodePhotosTransitionTarget(
  contentContainer,
  descriptor,
  {
    timeoutMs = PHOTOS_TRANSITION_IMAGE_TIMEOUT_MS,
    isCurrent = () => true,
    signal = null
  } = {}
) {
  if (!descriptor || !isCurrent() || signal?.aborted) return false;
  const targetRoot = findPhotosAppRoot(contentContainer);
  const targetElement = findPhotoTransitionElement(
    targetRoot,
    descriptor.targetView,
    descriptor.targetPhotoName
  );
  const image = targetElement?.querySelector('img');
  if (!image) return false;

  let timeoutId = 0;
  const timeout = new Promise((resolve) => {
    timeoutId = window.setTimeout(() => resolve(false), timeoutMs);
  });
  let handleAbort = null;
  const aborted = signal
    ? new Promise((resolve) => {
        handleAbort = () => resolve(false);
        signal.addEventListener('abort', handleAbort, { once: true });
        if (signal.aborted) handleAbort();
      })
    : new Promise(() => {});
  const decode = typeof image.decode === 'function'
    ? Promise.resolve()
      .then(() => image.decode())
      .then(() => true)
      .catch(() => false)
    : Promise.resolve(Boolean(image.complete && image.naturalWidth > 0));
  const decoded = await Promise.race([decode, timeout, aborted]);
  window.clearTimeout(timeoutId);
  if (handleAbort) signal.removeEventListener('abort', handleAbort);

  if (!isCurrent() || signal?.aborted) return false;
  return Boolean(decoded || (image.complete && image.naturalWidth > 0));
}

function cleanupPhotosSharedTransition(descriptor) {
  if (!descriptor) return;

  descriptor.elements.forEach((element) => {
    if (element.getAttribute(PHOTOS_TRANSITION_OWNER_ATTR) !== descriptor.owner) return;
    element.removeAttribute(PHOTOS_TRANSITION_OWNER_ATTR);
    element.style.removeProperty('view-transition-name');
    if (element.style.length === 0) element.removeAttribute('style');
  });

  const root = document.documentElement;
  if (root.getAttribute(PHOTOS_TRANSITION_OWNER_ATTR) === descriptor.owner) {
    root.removeAttribute(PHOTOS_TRANSITION_OWNER_ATTR);
    root.removeAttribute(PHOTOS_TRANSITION_KIND_ATTR);
    root.removeAttribute(PHOTOS_TRANSITION_DIRECTION_ATTR);
    root.classList.remove(PHOTOS_SHARED_TRANSITION_CLASS);
  }
}

function cancelActivePhotosViewTransition() {
  const active = activePhotosViewTransition;
  if (active) {
    activePhotosViewTransition = null;
    try {
      active.transition?.skipTransition?.();
    } catch (_error) {
      // The transition may already be finishing; DOM cleanup is still safe.
    }
    cleanupPhotosSharedTransition(active.descriptor);
  }
  return photosViewTransitionSettleBarrier;
}

function parsePageModeFromResponse(html) {
  if (!html) return '';
  const m = html.match(/data-page-mode="([^"]*)"/);
  return m ? m[1].trim() : '';
}

function syncWindowTitlebarFromDocument(targetDoc) {
  const nextTitlebar = targetDoc?.querySelector?.('[data-window-titlebar]');
  const currentTitlebar = document.querySelector('[data-window-titlebar]');
  if (!nextTitlebar || !currentTitlebar) return null;

  const importedTitlebar = document.importNode(nextTitlebar, true);
  currentTitlebar.replaceWith(importedTitlebar);
  return importedTitlebar;
}

function syncWindowTitlebarCopyFromDocument(targetDoc, overrides = {}) {
  const currentTitlebar = document.querySelector('[data-window-titlebar]');
  const targetTitlebar = targetDoc?.querySelector?.('[data-window-titlebar]');
  if (!currentTitlebar || !targetTitlebar) return false;

  const syncText = (selector, override) => {
    const current = currentTitlebar.querySelector(selector);
    const target = targetTitlebar.querySelector(selector);
    if (!current || !target) return;
    current.textContent = typeof override === 'string' ? override : target.textContent;
  };
  syncText('[data-window-title]', overrides.windowTitle);
  syncText('[data-window-subtitle]', overrides.windowSubtitle);
  return true;
}

// ── Reader mobile back-stack depth (site-internal only) ──

const BROWSER_NAV_DEPTH_KEY = 'sky_browser_nav_depth';
const BROWSER_NAV_INDEX_KEY = '__browserNavIndex';
const BROWSER_NAV_CHROME_KEY = '__browserNavChrome';
const BROWSER_NAV_WINDOW_SCROLL_KEY = '__browserWindowScroll';
const browserNavStateStore = createBrowserNavStateStore();
let pendingWindowScrollRestore = null;
let committedBrowserEntry = null;

function rememberCommittedBrowserEntry(state) {
  // Explicit states have just been sampled or written and must win over the
  // previous stored snapshot. Only a raw history.state needs recovery.
  const entry = state === undefined
    ? browserNavStateStore.recover(window.history.state)
    : state;
  if (!entry || typeof entry !== 'object' || entry.uid == null) return;
  committedBrowserEntry = { ...entry };
  browserNavStateStore.remember(entry);
}

function createBrowserNavUid() {
  return `pjax${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readBrowserNavDepth() {
  try {
    const raw = window.sessionStorage.getItem(BROWSER_NAV_DEPTH_KEY);
    const value = Number.parseInt(raw || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch (_e) {
    return null;
  }
}

function writeBrowserNavDepth(value) {
  try {
    window.sessionStorage.setItem(BROWSER_NAV_DEPTH_KEY, String(Math.max(0, value)));
  } catch (_e) {
    // Ignore sessionStorage failures; fallback button will still land on /
  }
}

function getBrowserNavDepth() {
  return readBrowserNavDepth() ?? 0;
}

function readBrowserNavIndexFromState(state = window.history.state) {
  const value = browserNavStateStore.recover(state)?.[BROWSER_NAV_INDEX_KEY];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function restoreRememberedBrowserNavState() {
  const state = window.history.state;
  const recovered = browserNavStateStore.recover(state);
  if (!recovered) return recovered;
  const restored = recovered.url === window.location.href
    ? recovered
    : { ...recovered, url: window.location.href };
  try {
    window.history.replaceState(restored, restored.title || document.title, window.location.href);
  } catch (_error) {
    // The recovered values still serve this page's back/scroll controls.
  }
  return restored;
}

function getCurrentScrollPos() {
  return [
    document.documentElement.scrollLeft || document.body.scrollLeft || window.scrollX || 0,
    document.documentElement.scrollTop || document.body.scrollTop || window.scrollY || 0
  ];
}

function getCurrentWindowScrollPos() {
  const scroller = document.querySelector('[data-window-content-root][data-window-scroll]');
  return scroller
    ? [Math.max(0, scroller.scrollLeft || 0), Math.max(0, scroller.scrollTop || 0)]
    : [0, 0];
}

function snapshotCurrentBrowserEntry() {
  const state = browserNavStateStore.recover(window.history.state);
  if (!state || typeof state !== 'object') return;
  try {
    const nextState = {
      ...state,
      // TOC and other same-page controls can update the visible hash without
      // updating state.url. Preserve that address when leaving this entry.
      url: window.location.href,
      scrollPos: getCurrentScrollPos(),
      [BROWSER_NAV_WINDOW_SCROLL_KEY]: getCurrentWindowScrollPos()
    };
    window.history.replaceState(nextState, nextState.title || document.title, window.location.href);
    rememberCommittedBrowserEntry(nextState);
  } catch (_error) {}
}

function restorePendingWindowScroll() {
  if (!pendingWindowScrollRestore) return;
  const target = pendingWindowScrollRestore;
  pendingWindowScrollRestore = null;
  requestAnimationFrame(() => {
    const scroller = document.querySelector('[data-window-content-root][data-window-scroll]');
    if (!scroller) return;
    scroller.scrollLeft = Math.max(0, Number(target[0]) || 0);
    scroller.scrollTop = Math.max(0, Number(target[1]) || 0);
  });
}

function clearPendingWindowScrollRestore() {
  pendingWindowScrollRestore = null;
}

function focusNavigatedContent(root = document) {
  const candidates = Array.from(root.querySelectorAll?.(
    '[data-window-content-variant] h1, [data-app-root] h1, [data-window-content-variant]'
  ) || []);
  const target = candidates.find((element) => (
    element.getClientRects?.().length > 0 && getComputedStyle(element).visibility !== 'hidden'
  ));
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function showNavigationStatus(message = '', tone = 'error') {
  let status = document.querySelector('[data-pjax-navigation-status]');
  if (!message) {
    status?.remove();
    return;
  }
  if (!status) {
    status = document.createElement('div');
    status.dataset.pjaxNavigationStatus = '';
    status.className = 'pjax-navigation-status';
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'assertive');
    document.body.appendChild(status);
  }
  status.dataset.tone = tone;
  status.textContent = message;
  window.clearTimeout(status._dismissTimer);
  status._dismissTimer = window.setTimeout(() => status.remove(), 5200);
}

function readBrowserNavChromeSnapshot(overrides = {}) {
  const titleEl = document.querySelector('[data-window-title]');
  const subtitleEl = document.querySelector('[data-window-subtitle]');
  return {
    windowTitle: overrides.windowTitle ?? titleEl?.textContent?.trim() ?? '',
    windowSubtitle: overrides.windowSubtitle ?? subtitleEl?.textContent?.trim() ?? ''
  };
}

function applyBrowserNavChromeState(state = window.history.state) {
  state = browserNavStateStore.recover(state);
  if (!state || typeof state !== 'object') return;

  if (state.title) {
    document.title = state.title;
  }

  const chrome = state[BROWSER_NAV_CHROME_KEY];
  if (!chrome || typeof chrome !== 'object') return;

  const titleEl = document.querySelector('[data-window-title]');
  if (titleEl && typeof chrome.windowTitle === 'string' && chrome.windowTitle) {
    titleEl.textContent = chrome.windowTitle;
  }

  const subtitleEl = document.querySelector('[data-window-subtitle]');
  if (subtitleEl && typeof chrome.windowSubtitle === 'string') {
    subtitleEl.textContent = chrome.windowSubtitle;
  }
}

function buildBrowserNavState(index, title = document.title, url = window.location.href, chromeOverrides = {}, options = {}) {
  const {
    baseState = browserNavStateStore.recover(window.history.state) || {},
    uid = baseState.uid || createBrowserNavUid(),
    scrollPos = baseState.scrollPos || getCurrentScrollPos(),
    windowScroll = baseState[BROWSER_NAV_WINDOW_SCROLL_KEY] || getCurrentWindowScrollPos()
  } = options;

  return {
    ...baseState,
    url: url || baseState.url || window.location.href,
    title: title || baseState.title || document.title,
    uid,
    scrollPos,
    [BROWSER_NAV_WINDOW_SCROLL_KEY]: windowScroll,
    [BROWSER_NAV_INDEX_KEY]: index,
    [BROWSER_NAV_CHROME_KEY]: readBrowserNavChromeSnapshot(chromeOverrides)
  };
}

function replaceBrowserNavState(index, title = document.title, url = window.location.href, chromeOverrides = {}) {
  try {
    const nextState = buildBrowserNavState(index, title, url, chromeOverrides);
    window.history.replaceState(nextState, nextState.title, nextState.url);
    rememberCommittedBrowserEntry(nextState);
  } catch (_e) {
    // Ignore replaceState failures; sessionStorage still tracks the fallback depth.
  }
}

function pushBrowserNavState(index, title, url, chromeOverrides = {}, { preserveScroll = false } = {}) {
  const uid = createBrowserNavUid();
  const nextState = buildBrowserNavState(index, title, url, chromeOverrides, {
    uid,
    scrollPos: preserveScroll ? getCurrentScrollPos() : [0, 0],
    windowScroll: preserveScroll ? getCurrentWindowScrollPos() : [0, 0]
  });
  window.history.pushState(nextState, nextState.title, nextState.url);
  rememberCommittedBrowserEntry(nextState);
  try {
    if (window.pjax) {
      window.pjax.lastUid = uid;
      window.pjax.maxUid = uid;
    }
  } catch (_error) {
    // The browser entry is already committed. Optional Pjax cursor metadata
    // must never turn that success into a fallback and a duplicate entry.
  }
}

function hardNavigate(url, { replace = false } = {}) {
  const target = String(url || window.location.href);
  window.location[replace ? 'replace' : 'assign'](target);
}

function syncBrowserNavDepth(index) {
  const safeIndex = Math.max(0, index);
  writeBrowserNavDepth(safeIndex);
  return safeIndex;
}

function initializeBrowserNavDepth() {
  const stateIndex = readBrowserNavIndexFromState();
  if (stateIndex !== null) {
    syncBrowserNavDepth(stateIndex);
    return;
  }

  const existing = readBrowserNavDepth();
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  const navType = navEntry?.type || '';

  if (navType === 'reload' && existing !== null) {
    replaceBrowserNavState(existing);
    return;
  }

  let hasSameOriginReferrer = false;
  try {
    hasSameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch (_e) {
    hasSameOriginReferrer = false;
  }

  const hasBackEntryInThisTab = window.history.length > 1;

  if (!hasSameOriginReferrer || !hasBackEntryInThisTab) {
    replaceBrowserNavState(syncBrowserNavDepth(0));
    return;
  }

  replaceBrowserNavState(syncBrowserNavDepth(Math.max(existing ?? 0, 1)));
}

function installBrowserNavHelpers() {
  window.__browserCanGoBackWithinSite = function() {
    return getBrowserNavDepth() > 0;
  };

  window.__browserBackOrHome = function(fallback = '/') {
    if (getBrowserNavDepth() > 0) {
      window.history.back();
      return;
    }
    window.location.href = fallback;
  };

  window.__browserSyncUiHistoryState = function({ url, title = document.title, mode = 'push', chrome = {} } = {}) {
    let target;
    try {
      target = new URL(String(url || window.location.href), window.location.href);
      if (target.origin !== window.location.origin) return false;
      snapshotCurrentBrowserEntry();
      const index = readBrowserNavIndexFromState() ?? getBrowserNavDepth();
      if (mode === 'replace') {
        replaceBrowserNavState(index, title, target.href, chrome);
      } else if (mode === 'push') {
        pushBrowserNavState(index + 1, title, target.href, chrome, { preserveScroll: true });
        syncBrowserNavDepth(index + 1);
      } else {
        return false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  };
}

// ── Performance instrumentation (debug mode only) ──

function perfMark(label) {
  if (!document.body?.dataset.debug) return;
  performance.mark(`pjax:${label}`);
}

function perfMeasure(name, startLabel, endLabel) {
  if (!document.body?.dataset.debug) return;
  try {
    performance.measure(`pjax:${name}`, `pjax:${startLabel}`, `pjax:${endLabel}`);
    const entry = performance.getEntriesByName(`pjax:${name}`).pop();
    if (entry) pjaxLog(`⏱ ${name}: ${entry.duration.toFixed(1)}ms`);
  } catch (_e) { /* marks may not exist */ }
}

function replayPjaxScripts(root) {
  if (!root) return;

  root.querySelectorAll('script[data-pjax]').forEach((oldScript) => {
    const script = document.createElement('script');

    Array.from(oldScript.attributes).forEach((attr) => {
      script.setAttribute(attr.name, attr.value);
    });

    script.textContent = oldScript.textContent;
    oldScript.replaceWith(script);
  });
}

let shikiRenderDescriptor = null;
let shikiReplaySequence = 0;
let shikiMomentsListenerInstalled = false;

function createShikiIncrementalBridge() {
  return {
    version: 1,
    descriptorKey: '',
    config: null,
    configure(config, descriptorKey) {
      this.config = config && typeof config === 'object' ? config : null;
      this.descriptorKey = String(descriptorKey || '');
    },
    render(root = document) {
      if (!this.config || !root || typeof root.querySelectorAll !== 'function') return 0;
      if (root !== document && !root.isConnected) return 0;

      const excluded = Array.isArray(this.config.excludedLanguages)
        ? this.config.excludedLanguages.map((language) => String(language).toLowerCase())
        : [];
      const candidates = Array.from(root.querySelectorAll('pre > code'));
      let rendered = 0;

      candidates.forEach((codeElement) => {
        if (codeElement.closest('shiki-code')) return;

        const languageClass = Array.from(codeElement.classList)
          .find((className) => className.startsWith('language-') || className.startsWith('lang-'));
        const language = languageClass
          ? languageClass.replace(/^(?:language-|lang-)/, '').toLowerCase()
          : '';
        if (language && excluded.includes(language)) return;

        const preElement = codeElement.parentElement;
        const parent = preElement?.parentElement;
        if (!preElement || preElement.tagName !== 'PRE' || !parent) return;

        const shikiElement = document.createElement('shiki-code');
        shikiElement.setAttribute('light-theme', String(this.config.lightTheme || ''));
        shikiElement.setAttribute('dark-theme', String(this.config.darkTheme || ''));
        shikiElement.setAttribute('variant', String(this.config.variant || ''));
        shikiElement.setAttribute('font-size', String(this.config.fontSize || ''));
        parent.insertBefore(shikiElement, preElement);
        shikiElement.appendChild(preElement);
        rendered += 1;
      });

      return rendered;
    }
  };
}

function readShikiRenderDescriptor(targetDoc) {
  const shikiScript = Array.from(targetDoc?.head?.querySelectorAll?.('script[data-pjax]') || [])
    .find((script) => script.textContent?.includes('renderCodeBlock')
      && script.textContent.includes('/plugins/shiki/assets/static/shiki-code.js'));

  if (!shikiScript) return null;

  const source = shikiScript.textContent || '';
  const importMatch = source.match(/import\s+\{\s*renderCodeBlock\s*\}\s+from\s+['"]([^'"]+)['"]/);
  const configMatch = source.match(/renderCodeBlock\s*\((\{[\s\S]*?\})\s*\)/);
  const importPath = importMatch?.[1];
  const renderConfig = configMatch?.[1];

  if (!importPath || !renderConfig) return null;

  return {
    importPath,
    renderConfig,
    key: `${importPath}\n${renderConfig}`
  };
}

function queueShikiBridgeRender(descriptor, root) {
  if (!descriptor || !root || typeof root.querySelectorAll !== 'function') return;
  if (root !== document && !root.isConnected) return;

  const activeBridge = window.__themeShikiBridge;
  if (activeBridge?.descriptorKey === descriptor.key && typeof activeBridge.render === 'function') {
    activeBridge.render(root);
    return;
  }

  const script = document.createElement('script');
  const replayId = `shiki-${Date.now()}-${++shikiReplaySequence}`;
  const pendingRoots = window.__themeShikiPendingRoots instanceof Map
    ? window.__themeShikiPendingRoots
    : new Map();
  window.__themeShikiPendingRoots = pendingRoots;
  pendingRoots.set(replayId, root);

  script.type = 'module';
  script.dataset.pjax = 'true';
  script.dataset.themeShikiReplay = 'true';
  script.dataset.themeShikiReplayId = replayId;
  script.textContent = [
    `import ${JSON.stringify(descriptor.importPath)};`,
    `const pendingRoots = window.__themeShikiPendingRoots;`,
    `const renderRoot = pendingRoots?.get(${JSON.stringify(replayId)});`,
    `pendingRoots?.delete(${JSON.stringify(replayId)});`,
    `const config = ${descriptor.renderConfig};`,
    `const descriptorKey = ${JSON.stringify(descriptor.key)};`,
    `const bridge = window.__themeShikiBridge;`,
    `bridge?.configure?.(config, descriptorKey);`,
    `bridge?.render?.(renderRoot);`,
    `document.querySelector('script[data-theme-shiki-replay-id="${replayId}"]')?.remove?.();`
  ].join('\n');
  script.addEventListener('error', () => {
    pendingRoots.delete(replayId);
    script.remove();
  }, { once: true });
  document.head.appendChild(script);
}

function runShikiExtraPathRenderer(responseText, root) {
  if (!responseText) {
    shikiRenderDescriptor = null;
    return;
  }

  const targetDoc = new DOMParser().parseFromString(responseText, 'text/html');
  shikiRenderDescriptor = readShikiRenderDescriptor(targetDoc);
  if (!shikiRenderDescriptor) return;
  queueShikiBridgeRender(shikiRenderDescriptor, root);
}

function installMomentsShikiBridge() {
  if (shikiMomentsListenerInstalled) return;
  shikiMomentsListenerInstalled = true;
  if (window.__themeShikiBridge?.version !== 1) {
    window.__themeShikiBridge = createShikiIncrementalBridge();
  }

  window.addEventListener('moments:feed-updated', (event) => {
    const root = event?.detail?.root;
    if (!root || typeof root.querySelectorAll !== 'function' || !root.isConnected) return;

    const currentMomentsRoot = document.querySelector('[data-app-root="moments"]');
    if (!currentMomentsRoot || (root !== currentMomentsRoot && !currentMomentsRoot.contains(root))) return;
    if (!shikiRenderDescriptor) return;

    const descriptor = shikiRenderDescriptor;
    const renderIncrement = () => {
      const liveMomentsRoot = document.querySelector('[data-app-root="moments"]');
      if (!root.isConnected || !liveMomentsRoot || !liveMomentsRoot.contains(root)) return;
      if (shikiRenderDescriptor?.key !== descriptor.key) return;
      queueShikiBridgeRender(descriptor, root);
    };
    if (document.readyState === 'loading') {
      // plugin-shiki's own DOMContentLoaded renderer owns the initial pass. Run
      // afterwards so restored waterfall cards cannot be wrapped twice.
      document.addEventListener('DOMContentLoaded', () => setTimeout(renderIncrement, 0), { once: true });
      return;
    }
    renderIncrement();
  });
}

function startTopProgress() {
  NProgress.start();
}

function stopTopProgress() {
  NProgress.done();
}

// ── Pjax init ──

export function initPjax(Alpine) {
  shikiRenderDescriptor = readShikiRenderDescriptor(document);
  installMomentsShikiBridge();
  reconcileSeoHead(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => reconcileSeoHead(document), { once: true });
  }

  setTimeout(() => {
    const isErrorPage = document.body?.dataset.errorPage === 'true';
    if (isErrorPage) { pjaxLog('skip: error page'); return; }

    NProgress.configure({
      minimum: 0.08,
      showSpinner: false,
      trickleSpeed: 120
    });

    // Singleton guard — prevent duplicate Pjax in Vite dev mode
    if (window.pjax) {
      pjaxWarn('init: Pjax already exists, skipping duplicate');
      return;
    }

    // Pjax installs its own window popstate listener in its constructor.
    // Register admission first: window is the event target, so a later capture
    // subscription cannot be relied on to precede the library's callback.
    window.addEventListener('popstate', (event) => {
      const targetState = event.state;
      const uid = String(targetState?.uid || '');
      if (rollbackPopstateUid && uid === rollbackPopstateUid) {
        window.clearTimeout(rollbackTimer);
        rollbackTimer = 0;
        rollbackPopstateUid = '';
        cancelledPopstateUid = '';
        restoreRememberedBrowserNavState();
        event.stopImmediatePropagation();
        return;
      }
      if (committedBrowserEntry) {
        rememberCommittedBrowserEntry({ ...committedBrowserEntry,
          scrollPos: getCurrentScrollPos(), [BROWSER_NAV_WINDOW_SCROLL_KEY]: getCurrentWindowScrollPos() });
      }
      const options = { history: false, scrollPos: targetState?.scrollPos };
      const record = beginNavigation(window.location.href, options);
      if (!record) {
        rollbackPopstateToCommittedEntry(options);
        event.stopImmediatePropagation();
        return;
      }
      const recovered = browserNavStateStore.recover(targetState);
      const known = uid && Number.isFinite(readBrowserNavIndexFromState(recovered))
        && typeof targetState?.url === 'string' && targetState.url === window.location.href;
      if (!known) {
        event.stopImmediatePropagation();
        handoffNavigation(record, window.location.href, { replace: true });
        return;
      }
      const local = prepareLocalView(window.location.href, {
        sourceUrl: record.sourceEntry?.url, historyMode: 'none'
      });
      if (local) {
        event.stopImmediatePropagation();
        void executeLocalNavigation(record, local);
        return;
      }
      pendingPopstateNavigation = record;
    }, true);

    const pjax = new Pjax({
      selectors: ["title", "#window-frame-root"],
      cacheBust: false,
      // Disable library per-link and keyup bindings, including refresh().
      elements: 'a:not(*)',
      timeout: PJAX_REQUEST_TIMEOUT,
      switches: {
        '#window-frame-root': switchPjaxWindowFrame
      }
    });

    // Non-200 responses: full-page redirect to show dedicated error page.
    const _origHandleResponse = pjax.handleResponse.bind(pjax);
    pjax.handleResponse = async function(responseText, request, href, options) {
      if (!isCurrentNavigationIntent(options?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('handleResponse: ignored stale navigation response');
        return;
      }
      const record = activeNavigation;
      if (!isNavigationCurrent(record)) return;
      const fallbackHref = resolveNavigationHref(request, href);
      if ((responseText === null || responseText === false) && request && request.status >= 400) {
        pjaxWarn('handleResponse: status', request.status, '→ full redirect', fallbackHref);
        handoffNavigation(record, fallbackHref);
        return;
      }
      if (responseText === false) {
        _origHandleResponse(false, request, href, { ...options, [FAILED_RESPONSE_OPTION]: true });
        return;
      }
      if (responseText === null) {
        // Pjax 0.2.8 treats null as HTML and strips the active history state.
        // Route status=0 failures through its error events without swapping DOM.
        _origHandleResponse(false, request, href, {
          ...options,
          [FAILED_RESPONSE_OPTION]: true
        });
        return;
      }
      // HTML and app downloads start together. Hold DOM replacement until
      // both the inferred and actual response app have executed registrars.
      const assetGate = _fullAssetGate;
      try {
        if (assetGate && !await assetGate.promise) return;
        if (!isNavigationCurrent(record)) return;
        const responseApp = parsePageAppFromResponse(responseText);
        await ensureAppAssetsLoaded(responseApp, { signal: assetGate?.controller.signal });
        if (!isNavigationCurrent(record)) return;
        stageAppCssForNavigation(responseApp);
      } catch (error) {
        if (!isNavigationCurrent(record)) return;
        pjaxWarn('response app assets failed:', error?.message || error);
        failNavigation(record, 'response-assets');
        return;
      }
      const responseDocument = new DOMParser().parseFromString(responseText, 'text/html');
      const validShell = ['title', '#window-frame-root'].every((selector) =>
        responseDocument.querySelectorAll(selector).length === 1 && document.querySelectorAll(selector).length === 1);
      if (!validShell) {
        handoffNavigation(record, fallbackHref);
        return;
      }
      if (!commitAcceptedNavigation(record)) return;
      // The desktop surface is persistent and lives outside Pjax's selector.
      // Install the inert home response protocol before Pjax starts switching
      // DOM so every pjax:complete listener observes fully hydrated data.
      try {
        syncHomeDesktopWidgetProtocolFromResponse(responseText);
        preparePluginCompatibilityFromResponse(responseText, {
          stageOnlineHistory: options?.history !== false,
          targetUrl: fallbackHref
        });
        _origHandleResponse(responseText, request, href, options);
      } catch (error) {
        pjaxWarn('response handling failed:', error?.message || error, '→ hard navigation');
        stopTopProgress();
        handoffNavigation(record, fallbackHref);
      }
    };

    // Compatibility facade for external callers: opt in, never bind listeners.
    pjax.attachLink = (link) => {
      if (link?.matches?.('a[href]')) link.classList.add('pjax-link');
    };
    // The library's emergency path must not bypass leave admission.
    pjax.latestChance = (url) => handoffNavigation(activeNavigation, url);

    window.pjax = pjax;
    pjaxLog('init: Pjax created, #window-frame-root exists:', !!document.getElementById('window-frame-root'));

    const sameVariantCoordinator = createNavigationCoordinator();
    const browserNavigationOwnership = createBrowserNavigationOwnership();
    let _sameVariantLoadingController = null;
    let _pjaxLoadingController = null;
    let _fullPjaxGeneration = 0;
    let navigationIntentGeneration = 0;
    let _fullAssetGate = null;
    let cancelledPopstateUid = '';
    let rollbackPopstateUid = '';
    let rollbackTimer = 0;
    let activeNavigation = null;
    let pendingPopstateNavigation = null;

    const rollbackPopstateToCommittedEntry = (options = {}, { skipCurrentPopstateListener = false } = {}) => {
      if (!committedBrowserEntry) return;
      const targetState = window.history.state;
      const sourceEntry = committedBrowserEntry;
      const targetUid = String(targetState?.uid || '');
      const sourceIndex = readBrowserNavIndexFromState(sourceEntry);
      const targetIndex = readBrowserNavIndexFromState(targetState);
      const delta = cancelledPopstateRollbackDelta(sourceIndex, targetIndex, options);
      const targetHref = window.location.href;
      const rollbackIntent = navigationIntentGeneration;
      // The synchronous guard runs before our listener for the current
      // popstate. An async XHR error has no such listener left to skip.
      cancelledPopstateUid = skipCurrentPopstateListener ? targetUid : '';
      rollbackPopstateUid = String(sourceEntry.uid);
      clearPendingWindowScrollRestore();
      window.clearTimeout(rollbackTimer);
      try {
        if (delta) window.history.go(delta);
      } catch (_error) {
        // The fallback below restores the visible URL if traversal is unavailable.
      }
      rollbackTimer = window.setTimeout(() => {
        if (rollbackPopstateUid !== String(sourceEntry.uid)) return;
        rollbackPopstateUid = '';
        if (navigationIntentGeneration !== rollbackIntent
          || String(window.history.state?.uid || '') !== targetUid
          || window.location.href !== targetHref) return;
        syncOnlineMonitorMetaFromHistoryState(sourceEntry);
        window.history.replaceState(sourceEntry, sourceEntry.title || document.title, sourceEntry.url);
        syncBrowserNavDepth(sourceIndex ?? 0);
        applyBrowserNavChromeState(sourceEntry);
      }, delta ? 1000 : 0);
    };

    // @theme-navigation-contract v1 — the existing intent owns both executors.
    const isNavigationCurrent = (record) => Boolean(record && !record.settled
      && record.intentId === navigationIntentGeneration);

    function settleNavigation(record, outcome, reason = '') {
      if (!record || record.settled) return;
      record.settled = true;
      if (outcome !== 'ready' && outcome !== 'native') abandonNavigation(record.permit);
      document.dispatchEvent(new CustomEvent('theme:navigation-settled', {
        bubbles: true,
        detail: { intentId: record.intentId, url: record.url, outcome, reason }
      }));
    }

    function readyNavigation(record, root) {
      if (!isNavigationCurrent(record) || record.ready) return;
      record.ready = true;
      record.url = window.location.href;
      document.dispatchEvent(new CustomEvent('theme:pjax-ready', {
        bubbles: true,
        detail: { intentId: record.intentId, url: record.url, appId: getCurrentPageApp() || '', root, mode: record.mode }
      }));
      settleNavigation(record, 'ready');
    }

    function beginNavigation(url, options = {}, mode = 'full') {
      const source = options.history === false ? 'popstate' : options.triggerElement ? 'click' : 'programmatic';
      const result = prepareNavigation({ url, source });
      if (result.kind !== 'accepted') {
        if (result.error) pjaxWarn('navigation guard failed:', result.error);
        return null;
      }
      // A ready listener may synchronously start another navigation.
      settleNavigation(activeNavigation, activeNavigation?.ready ? 'ready' : 'superseded');
      const record = {
        intentId: ++navigationIntentGeneration, permit: result.permit,
        url: String(url), options, source, mode, settled: false, uiCommitted: false,
        historyCommitted: false, sourceApp: getCurrentPageApp() || '', sourceEntry: committedBrowserEntry
      };
      activeNavigation = record;
      window.clearTimeout(rollbackTimer);
      rollbackTimer = 0;
      rollbackPopstateUid = '';
      cancelledPopstateUid = '';
      if (options.history !== false) {
        clearPendingWindowScrollRestore();
        snapshotCurrentBrowserEntry();
        record.sourceEntry = committedBrowserEntry;
      }
      showNavigationStatus('');
      browserNavigationOwnership.begin(record.intentId, { popstate: options.history === false });
      document.dispatchEvent(new CustomEvent('theme:navigation-accepted', {
        bubbles: true, detail: { intentId: record.intentId, url: record.url, source }
      }));
      return record;
    }

    function finishNavigationUi(record) {
      if (!isNavigationCurrent(record)) return;
      _fullPjaxGeneration += 1;
      void cancelActivePhotosViewTransition();
      pjax.abortRequest(pjax.request);
      _fullAssetGate?.controller.abort();
      _fullAssetGate = null;
      sameVariantCoordinator.cancel();
      _sameVariantLoadingController?.finish({ immediate: true });
      _sameVariantLoadingController = null;
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      const container = document.getElementById('window-frame-root');
      container?.classList.remove('pjax-loading');
      clearBusyState(container);
      clearPendingWindowScrollRestore();
      discardStagedOnlineMonitorHistoryState();
      syncAppCss(record.uiCommitted ? getCurrentPageApp() : record.sourceApp);
      browserNavigationOwnership.release(record.intentId);
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;
      window._sameVariantJustCompleted = false;
      stopTopProgress();
      clearTransientNavigationUi();
    }

    function failNavigation(record, reason, outcome = 'failed') {
      if (!isNavigationCurrent(record) || record.finishing) return false;
      record.finishing = true;
      finishNavigationUi(record);
      if (record.options.history === false) rollbackPopstateToCommittedEntry(record.options);
      ensureCurrentPageAppActive(document, { reason: 'pjax-error-recover' });
      showNavigationStatus(outcome === 'cancelled'
        ? '页面状态已变化，已取消跳转。请确认修改后重试。'
        : record.uiCommitted ? '页面初始化失败，请重试。'
          : '页面加载失败，已保留当前内容。请检查网络后重试。');
      settleNavigation(record, outcome, reason);
      return false;
    }

    function commitAcceptedNavigation(record) {
      const result = commitNavigation(record?.permit, () => isNavigationCurrent(record));
      if (result !== 'committed') {
        if (result !== 'stale') failNavigation(record, result, result === 'failed' ? 'failed' : 'cancelled');
        return false;
      }
      if (!record.uiCommitted) {
        record.uiCommitted = true;
        try { disposePluginUiBeforeNavigationCommit(); } catch (error) {
          pjaxWarn('navigation cleanup failed:', error);
          failNavigation(record, 'cleanup');
          return false;
        }
      }
      return true;
    }

    function prepareLocalView(url, options = {}) {
      try {
        return prepareActivePageAppLocalNavigation(url, {
          sourceUrl: window.location.href, ...options
        });
      } catch (error) {
        pjaxWarn('local view preparation failed; using PJAX:', error);
        return null;
      }
    }

    async function executeLocalNavigation(record, plan) {
      if (!isNavigationCurrent(record)) return false;
      record.mode = 'local';
      const permission = commitNavigation(record.permit, () => isNavigationCurrent(record));
      if (permission !== 'committed') {
        if (permission !== 'stale') failNavigation(record, permission, 'cancelled');
        return false;
      }
      // Retain app/plugin instances, but cancel every superseded HTML request.
      // A local view owns the same intent and leave permit as other navigation.
      finishNavigationUi(record);
      if (!isNavigationCurrent(record)) return false;
      try {
        if (!plan.commit()) return failNavigation(record, 'local-view-stale', 'cancelled');
        record.uiCommitted = true;
        record.historyCommitted = true;
        syncBrowserNavDepth(readBrowserNavIndexFromState() ?? 0);
        rememberCommittedBrowserEntry();
        pjax.lastUid = window.history.state?.uid || pjax.lastUid;
        await window.Alpine?.nextTick?.();
        if (!isNavigationCurrent(record)) return false;
        readyNavigation(record, plan.root);
        return true;
      } catch (error) {
        pjaxWarn('local view failed:', error);
        return failNavigation(record, 'local-view');
      }
    }

    function handoffNavigation(record, url, { replace = false } = {}) {
      if (!isNavigationCurrent(record)) return false;
      const allowed = prepareNativeHandoff(record.permit, () => record.intentId === navigationIntentGeneration);
      if (allowed !== 'allowed') return failNavigation(record, allowed, 'cancelled');
      record.finishing = true;
      finishNavigationUi(record);
      record.url = String(url || record.url);
      settleNavigation(record, 'native');
      try {
        hardNavigate(record.url, { replace: replace || record.options.history === false || record.historyCommitted });
      } catch (error) {
        revokeNativeHandoff();
        pjaxWarn('native navigation failed:', error);
        showNavigationStatus('页面跳转失败，请重试。');
      }
      return false;
    }

    const _origLoadUrl = pjax.loadUrl.bind(pjax);
    function executeFullNavigation({ href: url, options = {}, intentId, permit }) {
      const record = activeNavigation;
      if (!isNavigationCurrent(record) || record.intentId !== intentId || record.permit !== permit) return false;
      record.mode = 'full';
      const isPopstateIntent = options.history === false;
      const intentGeneration = intentId;
      void cancelActivePhotosViewTransition();
      window._browserPopstatePending = isPopstateIntent;
      window._browserForwardNavPending = false;
      _fullPjaxGeneration += 1;
      sameVariantCoordinator.cancel();
      _sameVariantLoadingController?.finish({ immediate: true });
      _sameVariantLoadingController = null;
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      const staleFullContainer = document.getElementById('window-frame-root');
      staleFullContainer?.classList.remove('pjax-loading');
      clearBusyState(staleFullContainer);
      closeTransientNavigationUi();
      pjax.abortRequest(pjax.request);
      _fullAssetGate?.controller.abort();
      const targetApp = inferPageAppForNavigation(url, options.triggerElement || null);
      startTopProgress();
      const controller = new AbortController();
      const failAssetNavigation = (error) => {
        if (!isNavigationCurrent(record) || controller.signal.aborted || record.finishing) return false;
        pjaxWarn('app assets failed during navigation:', error?.message || error);
        return failNavigation(record, 'assets');
      };
      _fullAssetGate = {
        controller,
        promise: ensureAppAssetsLoaded(targetApp, { signal: controller.signal })
          .then(() => true).catch(failAssetNavigation)
      };
      try {
        stageAppCssForNavigation(targetApp);
        return _origLoadUrl(url, {
          ...options,
          scrollPos: isPopstateIntent
            ? (browserNavStateStore.recover(window.history.state)?.scrollPos || options.scrollPos)
            : options.scrollPos,
          requestOptions: { ...(options.requestOptions || {}), requestUrl: options.requestOptions?.requestUrl || String(url) },
          [NAVIGATION_INTENT_OPTION]: intentGeneration
        });
      } catch (error) { return failAssetNavigation(error); }
    }

    pjax.loadUrl = function(url, options = {}) {
      const record = options.history === false && pendingPopstateNavigation
        ? pendingPopstateNavigation : beginNavigation(url, options);
      pendingPopstateNavigation = null;
      if (!record) return Promise.resolve(false);
      return Promise.resolve(executeFullNavigation({ href: url, options, intentId: record.intentId, permit: record.permit }));
    };

    initializeBrowserNavDepth();
    rememberCommittedBrowserEntry();
    installBrowserNavHelpers();


    window.addEventListener('popstate', (event) => {
      if (cancelledPopstateUid && String(event.state?.uid || '') === cancelledPopstateUid) {
        cancelledPopstateUid = '';
        return;
      }
      window._browserPopstatePending = browserNavigationOwnership.isPopstate(navigationIntentGeneration);
      window._browserForwardNavPending = false;
      const entryState = browserNavStateStore.recover(event.state);
      const stateIndex = readBrowserNavIndexFromState(entryState);
      syncBrowserNavDepth(stateIndex ?? 0);
      applyBrowserNavChromeState(entryState);
      pendingWindowScrollRestore = Array.isArray(entryState?.[BROWSER_NAV_WINDOW_SCROLL_KEY])
        ? entryState[BROWSER_NAV_WINDOW_SCROLL_KEY]
        : [0, 0];
    });

    // ── Same-variant content-level navigation ──

    /**
     * Navigate within the same window variant — replace only the content root,
     * keep the window frame (titlebar, traffic lights, toolbar) intact.
     */
    async function navigateWithinVariant(targetUrl, triggerElement = null, acceptedRecord = null) {
      const record = acceptedRecord || beginNavigation(targetUrl, { triggerElement }, 'same');
      if (!record) return false;
      const intentGeneration = record.intentId;
      _fullAssetGate?.controller.abort();
      _fullAssetGate = null;
      const previousPhotosTransitionSettled = cancelActivePhotosViewTransition();
      browserNavigationOwnership.begin(intentGeneration);
      _fullPjaxGeneration += 1;
      pjax.abortRequest(pjax.request);
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      const staleFullContainer = document.getElementById('window-frame-root');
      staleFullContainer?.classList.remove('pjax-loading');
      clearBusyState(staleFullContainer);
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;

      const previousLoadingController = _sameVariantLoadingController;
      previousLoadingController?.finish({ immediate: true });

      const navigation = sameVariantCoordinator.begin();
      const isCurrentNavigation = () => isNavigationCurrent(record)
        && sameVariantCoordinator.isCurrent(navigation);
      window._sameVariantJustCompleted = false;

      perfMark('navStart');

      const contentRoot = document.querySelector('[data-window-content-root]');
      if (!contentRoot) {
        sameVariantCoordinator.finish(navigation);
        stopTopProgress();
        clearTransientNavigationUi();
        return executeFullNavigation({ href: targetUrl, options: { triggerElement },
          intentId: record.intentId, permit: record.permit });
      }

      const currentApp = getCurrentPageApp() || document.body.dataset.pageApp || '';
      const targetApp = inferPageAppForNavigation(targetUrl) || '';
      const useWindowOverlay = shouldUseWindowLoadingOverlay(currentApp, targetApp);
      const loadingController = createWindowLoadingController(contentRoot, {
        useOverlay: useWindowOverlay
      }).start();
      _sameVariantLoadingController = loadingController;
      const useTopProgress = !hasLoadingOverlay(loadingController);
      let navigationSucceeded = false;
      let shouldFallback = false;
      let shouldUseNative = false;
      let responseAvailable = false;
      let finalizedCurrentNavigation = false;
      let completionDetail = null;
      let contentTargetMarker = null;
      const requestSignal = createTimedNavigationSignal(navigation.signal, PJAX_REQUEST_TIMEOUT);
      perfMark('overlayVisible');
      if (useTopProgress) {
        startTopProgress();
      } else {
        stopTopProgress();
      }

      document.dispatchEvent(new CustomEvent('pjax:same-variant-send', { detail: { targetUrl: targetUrl } }));

      try {
        const [resp] = await Promise.all([
          fetch(targetUrl, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            signal: requestSignal.signal
          }),
          ensureAppAssetsLoaded(targetApp, { signal: requestSignal.signal })
        ]);

        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        if (!resp.ok) {
          shouldUseNative = true;
          throw new Error(`HTTP ${resp.status}`);
        }

        const html = await resp.text();
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        responseAvailable = true;
        // Verify same variant — if variant changed, fall back to full PJAX
        const targetVariant = parseWindowVariantFromResponse(html);
        const currentVariant = document.body.dataset.windowVariant || '';
        if (targetVariant && targetVariant !== currentVariant) {
          throw new Error(`variant mismatch: ${currentVariant} -> ${targetVariant}`);
        }

        // Verify pageApp + pageMode compatibility via whitelist
        const responseApp = parsePageAppFromResponse(html) || '';
        const responseMode = parsePageModeFromResponse(html);
        const currentMode = document.body.dataset.pageMode || '';

        if (!isContentSwitchAllowed(currentApp, currentMode) ||
            !isContentSwitchAllowed(responseApp, responseMode)) {
          throw new Error(`content switch not allowed: ${currentApp}/${currentMode} -> ${responseApp}/${responseMode}`);
        }

        // Parse content from response
        const parsed = parseContentFromResponse(html, '[data-window-content-root]');
        if (!parsed) throw new Error('Failed to parse content root from response');

        perfMark('contentReady');

        // Find the inner content container
        // For browser: #pjax-container; for moments: [data-window-content-variant]
        const contentContainer = contentRoot.querySelector('[data-window-content-variant]')
          || contentRoot.querySelector('#pjax-container');

        if (!contentContainer) throw new Error('No content container found');

        const photosSidebarScrollTop = currentApp === 'photos'
          ? contentContainer.querySelector('[data-app-root="photos"] > .photos-sidebar')?.scrollTop
          : null;
        const photosFilmstripScrollLeft = currentApp === 'photos'
          ? contentContainer.querySelector('.photos-detail-neighbor-list')?.scrollLeft
          : null;

        // Parse target's inner content (the content inside [data-window-content-variant] or #pjax-container)
        const parser = new DOMParser();
        const targetDoc = parser.parseFromString(html, 'text/html');
        const targetContentRoot = targetDoc.querySelector('[data-window-content-root]');
        const targetContainer = targetContentRoot?.querySelector('[data-window-content-variant]')
          || targetContentRoot?.querySelector('#pjax-container');

        const nextApp = parsePageAppFromResponse(html) || targetApp;
        await ensureAppAssetsLoaded(nextApp, { signal: requestSignal.signal });
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        await previousPhotosTransitionSettled;
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        const preservePhotosDetailTitlebar = currentApp === 'photos'
          && responseApp === 'photos'
          && isPhotosDetailToDetailNavigation(contentContainer, targetContainer);
        const targetPhotosRoot = preservePhotosDetailTitlebar
          ? findPhotosAppRoot(targetContainer)
          : null;
        const targetPhotosChrome = targetPhotosRoot
          ? {
              windowTitle: targetPhotosRoot.dataset.photosChromeTitle,
              windowSubtitle: targetPhotosRoot.dataset.photosChromeSubtitle
            }
          : {};
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const photosSharedTransition = currentApp === 'photos'
          && responseApp === 'photos'
          && typeof document.startViewTransition === 'function'
          && !reduceMotion
          ? resolvePhotosSharedTransition(contentContainer, targetContainer, triggerElement)
          : null;
        const canAttemptPhotosViewTransition = Boolean(photosSharedTransition);
        const photosTransitionTargetReady = canAttemptPhotosViewTransition
          ? await preloadPhotosDetailTransitionTarget(photosSharedTransition, {
              signal: navigation.signal
            })
          : false;
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        // A warm target stylesheet can still be disabled from the previous
        // app. Keep both styles active before inserting the new app DOM.
        let syncedTitlebar = null;
        let activePhotosTransition = null;
        let contentSwapped = false;
        const performContentSwap = async () => {
          if (!isCurrentNavigation() || !commitAcceptedNavigation(record)) return;
          stageAppCssForNavigation(nextApp);
          preparePluginCompatibilityFromResponse(html);
          syncedTitlebar = preservePhotosDetailTitlebar ? null : syncWindowTitlebarFromDocument(targetDoc);
          // Alpine's mutation observer may initialize inserted nodes before
          // initTree runs below, so expose the destination before the swap.
          contentContainer.dataset.pjaxTargetUrl = targetUrl;
          contentTargetMarker = contentContainer;
          deactivateCurrentPageApp();
          if (preservePhotosDetailTitlebar) {
            syncWindowTitlebarCopyFromDocument(targetDoc, targetPhotosChrome);
          }
          if (targetContainer) {
            contentContainer.innerHTML = targetContainer.innerHTML;
          } else {
            // Fallback: use full content root innerHTML
            contentContainer.innerHTML = parsed.contentHtml;
          }
          if (Number.isFinite(photosSidebarScrollTop)) {
            const nextPhotosSidebar = contentContainer
              .querySelector('[data-app-root="photos"] > .photos-sidebar');
            if (nextPhotosSidebar) nextPhotosSidebar.scrollTop = photosSidebarScrollTop;
          }
          if (Number.isFinite(photosFilmstripScrollLeft)) {
            const nextFilmstrip = contentContainer.querySelector('.photos-detail-neighbor-list');
            if (nextFilmstrip) nextFilmstrip.scrollLeft = photosFilmstripScrollLeft;
          }
          if (activePhotosTransition) {
            centerPhotosFilmstripCurrentItem(contentContainer);
            markPhotosSharedTransitionTarget(contentContainer, activePhotosTransition);
            await decodePhotosTransitionTarget(contentContainer, activePhotosTransition, {
              isCurrent: isCurrentNavigation,
              signal: navigation.signal
            });
          }
          if (!isCurrentNavigation()) {
            return;
          }
          document.dispatchEvent(new CustomEvent('theme:content-swapped', {
            detail: { root: contentContainer, reason: 'same-variant' }
          }));
          contentSwapped = true;
        };
        const canUseViewTransition = canAttemptPhotosViewTransition
          && photosTransitionTargetReady;
        if (canUseViewTransition) {
          activePhotosTransition = photosSharedTransition;
          beginPhotosSharedTransition(activePhotosTransition);
          let transition;
          try {
            transition = document.startViewTransition(performContentSwap);
          } catch (error) {
            cleanupPhotosSharedTransition(activePhotosTransition);
            throw error;
          }
          activePhotosViewTransition = {
            descriptor: activePhotosTransition,
            transition
          };
          const transitionLifecycle = Promise.resolve(transition.finished)
            .catch(() => {})
            .then(() => {
              if (activePhotosViewTransition?.descriptor.owner === activePhotosTransition.owner) {
                activePhotosViewTransition = null;
              }
              cleanupPhotosSharedTransition(activePhotosTransition);
            });
          const previousSettleBarrier = photosViewTransitionSettleBarrier;
          photosViewTransitionSettleBarrier = Promise.all([
            previousSettleBarrier,
            transitionLifecycle
          ]).then(() => {});
          await transition.updateCallbackDone.catch(() => {});
        } else {
          await performContentSwap();
        }

        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }
        if (!contentSwapped) {
          throw new Error('Same-variant content swap did not complete');
        }

        perfMark('contentSwap');

        // Sync state
        const nextNavIndex = getBrowserNavDepth() + 1;

        syncSeoHeadFromResponse(html);
        syncBodyDatasetFromResponse(html);
        setCurrentPageApp(nextApp);
        syncAppCss(nextApp);

        // History is committed only after components have initialized.
        replayPjaxScripts(contentContainer);
        runShikiExtraPathRenderer(html, contentContainer);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(contentContainer);
        }

        perfMark('AlpineInitDone');

        if (syncedTitlebar) {
          if (window.Alpine?.initTree) {
            window.Alpine.initTree(syncedTitlebar);
          }
        }

        activatePageApp(nextApp, contentContainer, {
          reason: 'same-variant',
          documentTitle: parsed.title
        });

        perfMark('pageReady');

        const documentState = getActivePageAppDocumentState() || {};
        const isDetail = contentContainer.querySelector('.moments-app--detail');
        const resolvedTitle = documentState.title || parsed.title;
        const historyChrome = {
          windowTitle: documentState.windowTitle || (isDetail ? '详情' : resolvedTitle),
          windowSubtitle: documentState.windowSubtitle || ''
        };
        // Sync back button fallback for scene change
        const backBtn = document.querySelector('.moments-titlebar-back');
        if (backBtn) {
          backBtn.dataset.fallback = isDetail ? '/moments' : '/';
        }

        // Scroll content to top
        contentRoot.scrollTop = 0;
        focusNavigatedContent(contentContainer);

        // Reinstall moments scroll listener for feed/detail scene change
        if (typeof window.__momentsScrollSetup === 'function') {
          runNonFatalNavigationHook(window.__momentsScrollSetup, (error) => {
            pjaxWarn('same-variant moments scroll setup failed:', error?.message || error);
          });
        }

        // Performance logging
        perfMeasure('navStart→overlayVisible', 'navStart', 'overlayVisible');
        perfMeasure('overlayVisible→contentSwap', 'overlayVisible', 'contentSwap');
        perfMeasure('contentSwap→AlpineInitDone', 'contentSwap', 'AlpineInitDone');
        perfMeasure('AlpineInitDone→pageReady', 'AlpineInitDone', 'pageReady');
        perfMeasure('total', 'navStart', 'pageReady');

        completionDetail = {
          targetUrl,
          appId: nextApp,
          root: contentContainer
        };

        // Commit history last. Every hook that may throw has either completed
        // above or is explicitly isolated as non-fatal, so a committed entry
        // can never be followed by a full-PJAX fallback for the same intent.
        pushBrowserNavState(nextNavIndex, resolvedTitle, targetUrl, historyChrome);
        record.historyCommitted = true;
        syncBrowserNavDepth(nextNavIndex);
        navigationSucceeded = true;
      } catch (err) {
        if (isNavigationAbort(err, navigation, sameVariantCoordinator)) {
          pjaxLog('same-variant navigation superseded:', targetUrl);
        } else if (isNavigationCurrent(record)) {
          pjaxWarn('same-variant navigation failed:', err.message);
          if (record.uiCommitted) shouldUseNative = true;
          else if (!shouldUseNative && responseAvailable) shouldFallback = true;
          else if (!shouldUseNative) failNavigation(record, 'same-request');
        }
      } finally {
        requestSignal.cleanup();
        if (contentTargetMarker?.dataset.pjaxTargetUrl === targetUrl) {
          delete contentTargetMarker.dataset.pjaxTargetUrl;
        }
        if (isCurrentNavigation()) {
          await hideOverlay(contentRoot, loadingController, {
            immediate: !navigationSucceeded
          });

          if (isCurrentNavigation()) {
            if (useTopProgress) stopTopProgress();
            finalizedCurrentNavigation = sameVariantCoordinator.finish(navigation);
            if (_sameVariantLoadingController === loadingController) {
              _sameVariantLoadingController = null;
            }
            clearTransientNavigationUi();
          }
        }
      }

      if (navigationSucceeded && finalizedCurrentNavigation && completionDetail) {
        const windowManager = Alpine.store('windowManager');
        if (windowManager && (!windowManager.show || windowManager.minimized)) {
          window.preventAutoOpen = false;
          windowManager.revealAfterNavigation(document.title);
        }
        document.dispatchEvent(new CustomEvent('pjax:same-variant-complete', {
          detail: completionDetail
        }));

        browserNavigationOwnership.release(record.intentId);
        readyNavigation(record, completionDetail.root);
        pjaxLog('same-variant navigation complete:', targetUrl);

        return true;
      }

      if (shouldUseNative && finalizedCurrentNavigation) {
        return handoffNavigation(record, targetUrl);
      }
      if (shouldFallback && finalizedCurrentNavigation) {
        window._sameVariantJustCompleted = true;
        executeFullNavigation({ href: targetUrl, options: { triggerElement },
          intentId: record.intentId, permit: record.permit });
        return true;
      }

      return navigationSucceeded;
    }

    // ── Pjax events ──

    document.addEventListener("pjax:send", (event) => {
      if (!isCurrentNavigationIntent(event?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('event:send ignored for stale navigation');
        return;
      }
      pjaxLog('event:send', event.triggerElement?.href || '');
      const eventIntent = Number(event?.[NAVIGATION_INTENT_OPTION]) > 0
        ? Number(event[NAVIGATION_INTENT_OPTION])
        : navigationIntentGeneration;
      const currentApp = getCurrentPageApp() || document.body.dataset.pageApp || '';
      const targetHref = event?.triggerElement?.href || event?.requestOptions?.requestUrl;
      const targetApp = targetHref
        ? inferPageAppForNavigation(targetHref, event?.triggerElement) || ''
        : '';
      _fullPjaxGeneration += 1;
      sameVariantCoordinator.cancel();
      _sameVariantLoadingController?.finish({ immediate: true });
      _sameVariantLoadingController = null;
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      closeTransientNavigationUi();
      startTopProgress();
      let targetVariant = '';
      try {
        targetVariant = targetHref ? inferWindowVariantFromUrl(new URL(targetHref, window.location.origin)) : '';
      } catch (_e) {
        targetVariant = '';
      }
      const currentVariant = document.body.dataset.windowVariant || '';
      const canUseWindowOverlay =
        currentVariant &&
        targetVariant &&
        currentVariant === targetVariant &&
        currentVariant !== 'none' &&
        shouldUseWindowLoadingOverlay(currentApp, targetApp);
      const container = document.getElementById('window-frame-root');
      if (container) {
        container.classList.add('pjax-loading');
        _pjaxLoadingController = createWindowLoadingController(container, {
          useOverlay: canUseWindowOverlay
        }).start();
      }

      if (targetHref) {
        ensureAppAssetsLoaded(targetApp).catch(() => {});
        try {
          const targetUrl = new URL(targetHref, window.location.origin);
          const isSameOrigin = targetUrl.origin === window.location.origin;
          const isSameDocumentRoute =
            targetUrl.pathname === window.location.pathname &&
            targetUrl.search === window.location.search;

          if (isSameOrigin && !isSameDocumentRoute && !window._browserPopstatePending) {
            window._browserForwardNavPending = browserNavigationOwnership.markForward(eventIntent);
          }
        } catch (_e) {
          // Ignore malformed URLs from non-standard links.
        }
      }
    });
    
    document.addEventListener("pjax:complete", async (event) => {
      if (!isCurrentNavigationIntent(event?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('event:complete ignored for stale navigation');
        return;
      }
      if (event?.[FAILED_RESPONSE_OPTION]) return;
      if (window._browserPopstatePending) restoreRememberedBrowserNavState();
      const record = activeNavigation;
      if (!isNavigationCurrent(record)) return;
      const completionGeneration = _fullPjaxGeneration;
      const completionIntentValue = event?.[NAVIGATION_INTENT_OPTION];
      const completionIntent = Number(completionIntentValue) > 0
        ? Number(completionIntentValue)
        : navigationIntentGeneration;
      const isCurrentCompletion = () => isNavigationCurrent(record) && isFullNavigationCompletionCurrent({
        completionGeneration,
        currentGeneration: _fullPjaxGeneration,
        completionIntent: completionIntentValue,
        currentIntent: navigationIntentGeneration
      });
      const loadingController = _pjaxLoadingController;
      const container = document.getElementById('window-frame-root');
      const responseText = event?.request?.responseText;
      if (typeof responseText !== 'string') {
        pjaxLog('event:complete skipped for failed response');
        return;
      }
      const fallbackHref = resolveNavigationHref(
        event?.request,
        event?.requestOptions?.requestUrl
      );
      record.historyCommitted = event?.history !== false;
      record.url = fallbackHref;
      let completionFailed = false;

      try {
        const nextApp = parsePageAppFromResponse(responseText);
        await ensureAppAssetsLoaded(nextApp);
        if (!isCurrentCompletion()) return;

        syncSeoHeadFromResponse(responseText);
        syncBodyDatasetFromResponse(responseText);
        setCurrentPageApp(nextApp);
        syncAppCss(nextApp);

        if (container) {
          replayPjaxScripts(container);
          runShikiExtraPathRenderer(responseText, container);

          if (window.Alpine?.initTree) {
            window.Alpine.initTree(container);
          }


          activatePageApp(nextApp, container, {
            reason: 'pjax-complete',
            documentTitle: document.title
          });
          focusNavigatedContent(container);
          restorePendingWindowScroll();

        }

        const windowManager = Alpine.store('windowManager');
        const isHome = window.location.pathname === '/';
        const suppressAutoOpen = window._sameVariantJustCompleted === true;
        window._sameVariantJustCompleted = false;

        if (isHome) {
          window.preventAutoOpen = false;
          windowManager.showDesktop();
        } else if (windowManager.minimized) {
          window.preventAutoOpen = false;
          windowManager.revealAfterNavigation(document.title);
        } else if (window.preventAutoOpen) {
          window.preventAutoOpen = false;
        } else if (!suppressAutoOpen) {
          window.dispatchEvent(new CustomEvent('open-window'));
        }

        if (!isCurrentCompletion()) return;
        if (browserNavigationOwnership.shouldCommitForward(completionIntent)) {
          const nextNavIndex = getBrowserNavDepth() + 1;
          replaceBrowserNavState(nextNavIndex);
          syncBrowserNavDepth(nextNavIndex);
        } else if (window._browserPopstatePending) {
          rememberCommittedBrowserEntry();
        }
      } catch (error) {
        if (isCurrentCompletion()) {
          completionFailed = true;
          pjaxWarn('event:complete failed:', error?.message || error, '→ hard navigation');
        }
      } finally {
        if (isCurrentCompletion()) {
          try {
            await loadingController?.finish({ immediate: completionFailed });
          } catch (_error) {
            // Loading cleanup must not prevent the navigation fallback.
          }

          // A new intent can start while the overlay finish promise settles.
          // Only the still-current owner may clear shared DOM/transient state.
          if (isCurrentCompletion()) {
            _fullAssetGate?.controller.abort();
            _fullAssetGate = null;
            browserNavigationOwnership.release(completionIntent);
            window._browserForwardNavPending = false;
            window._browserPopstatePending = false;
            window._sameVariantJustCompleted = false;
            stopTopProgress();
            if (_pjaxLoadingController === loadingController) {
              _pjaxLoadingController = null;
            }
            container?.classList.remove('pjax-loading');
            clearBusyState(container);
            clearTransientNavigationUi();
          }
        }
      }

      if (completionFailed && isCurrentCompletion()) {
        handoffNavigation(record, fallbackHref);
      } else if (isCurrentCompletion()) {
        readyNavigation(record, container);
      }
    });

    document.addEventListener("pjax:error", (event) => {
      if (!isCurrentNavigationIntent(event?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('event:error ignored for stale navigation');
        return;
      }
      pjaxWarn('event:error', event.request?.status);
      // Null/status=0 and offline failures never discard the source page.
      clearPendingWindowScrollRestore();
      if (activeNavigation?.uiCommitted) handoffNavigation(activeNavigation, activeNavigation.url);
      else failNavigation(activeNavigation, 'request');
    });

    // @theme-navigation-contract v1 — component handlers run before this owner.
    installClickController({
      document,
      readContext: () => ({
        currentUrl: window.location.href,
        baseTarget: document.querySelector('base[target]')?.getAttribute('target') || '',
        runtimeReady: window.pjax === pjax
      }),
      requestNavigation: ({ href, triggerElement, options }) => {
        const local = prepareLocalView(href);
        if (local) {
          const record = beginNavigation(href, options, 'local');
          if (!record) return { kind: 'cancelled', reason: 'leave-veto' };
          void executeLocalNavigation(record, local);
          return { kind: 'started', intentId: record.intentId };
        }
        const url = new URL(href);
        const currentVariant = document.body.dataset.windowVariant || '';
        const targetVariant = inferWindowVariantFromUrl(url);
        const currentApp = getCurrentPageApp() || '';
        const targetApp = inferPageAppForNavigation(url, triggerElement) || '';
        const sameRoute = url.pathname === window.location.pathname && url.search === window.location.search;
        const same = url.pathname !== '/' && !sameRoute && currentVariant && currentVariant !== 'none'
          && currentVariant === targetVariant
          && isContentSwitchAllowed(currentApp, document.body.dataset.pageMode || '')
          && supportsSameVariantContentSwitch(targetApp);
        const record = beginNavigation(href, options, same ? 'same' : 'full');
        if (!record) return { kind: 'cancelled', reason: 'leave-veto' };
        if (same) {
          void navigateWithinVariant(href, triggerElement, record).catch((error) => {
            pjaxWarn('same navigation failed:', error);
            failNavigation(record, 'execution');
          });
        } else {
          executeFullNavigation({ href, options, intentId: record.intentId, permit: record.permit });
        }
        return { kind: 'started', intentId: record.intentId };
      }
    });

  }, 0);
}
