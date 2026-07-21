/**
 * Pjax engine initialization — link management, Observer, event handlers
 *
 * CSS routing:   ./css-router.js
 * SEO sync:      ./seo.js
 * Protocol:      ./protocol.js
 */

import Pjax from 'pjax';
import NProgress from 'nprogress';
import {
  activateCurrentPageApp,
  activatePageApp,
  deactivateCurrentPageApp,
  getActivePageAppDocumentState
} from '../../shared/page-app.js';
import { createLogger } from '../../shared/debug.js';
import {
  isPjaxManagedLink,
  markPjaxLinks,
  attachDynamicLinks,
  PJAX_MANAGED_ATTR
} from './link-attach.js';
import {
  getCurrentPageApp,
  setCurrentPageApp,
  ensureAppAssetsLoaded,
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
  preparePluginCompatibilityFromResponse
} from '../../shared/plugin-compat.js';
import { syncHomeDesktopWidgetProtocolFromResponse } from '../../widgets/protocol.js';
import {
  createBrowserNavigationOwnership,
  createNavigationCoordinator,
  isFullNavigationCompletionCurrent,
  isCurrentNavigationIntent,
  isNavigationAbort,
  isPlainPrimaryNavigationEvent,
  resolveNavigationHref,
  runNonFatalNavigationHook
} from './navigation-guard.js';

const { log: pjaxLog, warn: pjaxWarn } = createLogger('pjax');
const NAVIGATION_INTENT_OPTION = '__themeNavigationIntent';
const PHOTOS_DETAIL_VIEW = 'detail';
const PHOTOS_SHARED_TRANSITION_CLASS = 'photos-shared-view-transition';
const PHOTOS_TRANSITION_OWNER_ATTR = 'data-photos-view-transition-owner';
const PHOTOS_SHARED_TRANSITION_NAME = 'photos-active-photo';
let photosViewTransitionSequence = 0;
let activePhotosViewTransition = null;

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

function resolvePhotosSharedTransition(contentContainer, targetContainer, triggerElement) {
  const currentRoot = findPhotosAppRoot(contentContainer);
  const targetRoot = findPhotosAppRoot(targetContainer);
  if (!currentRoot || !targetRoot) return null;

  const currentView = currentRoot.dataset.photosView || '';
  const targetView = targetRoot.dataset.photosView || '';
  const isListToDetail = currentView !== PHOTOS_DETAIL_VIEW && targetView === PHOTOS_DETAIL_VIEW;
  if (!isListToDetail) return null;

  const triggerPhotoName = triggerElement?.closest?.('[data-photo-name]')?.dataset.photoName || '';
  const targetDetailName = targetRoot
    .querySelector('.photos-detail-figure[data-photo-name]')
    ?.dataset.photoName || '';
  const photoName = triggerPhotoName || targetDetailName;
  if (!photoName || targetDetailName !== photoName) return null;

  const currentElement = findPhotoTransitionElement(currentRoot, currentView, photoName);
  const targetElement = findPhotoTransitionElement(targetRoot, targetView, photoName);
  if (!currentElement || !targetElement || !isPhotoTransitionSourceReady(currentElement)) return null;

  return {
    owner: String(++photosViewTransitionSequence),
    photoName,
    transitionName: PHOTOS_SHARED_TRANSITION_NAME,
    currentElement,
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
  markPhotosSharedTransitionElement(descriptor.currentElement, descriptor);
}

function markPhotosSharedTransitionTarget(contentContainer, descriptor) {
  const targetRoot = findPhotosAppRoot(contentContainer);
  const targetElement = findPhotoTransitionElement(targetRoot, descriptor.targetView, descriptor.photoName);
  markPhotosSharedTransitionElement(targetElement, descriptor);
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
    root.classList.remove(PHOTOS_SHARED_TRANSITION_CLASS);
  }
}

function cancelActivePhotosViewTransition() {
  const active = activePhotosViewTransition;
  if (!active) return;
  activePhotosViewTransition = null;
  try {
    active.transition?.skipTransition?.();
  } catch (_error) {
    // The transition may already be finishing; DOM cleanup is still safe.
  }
  cleanupPhotosSharedTransition(active.descriptor);
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

// ── Reader mobile back-stack depth (site-internal only) ──

const BROWSER_NAV_DEPTH_KEY = 'sky_browser_nav_depth';
const BROWSER_NAV_INDEX_KEY = '__browserNavIndex';
const BROWSER_NAV_CHROME_KEY = '__browserNavChrome';

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
  const value = state?.[BROWSER_NAV_INDEX_KEY];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function getCurrentScrollPos() {
  return [
    document.documentElement.scrollLeft || document.body.scrollLeft || window.scrollX || 0,
    document.documentElement.scrollTop || document.body.scrollTop || window.scrollY || 0
  ];
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
    baseState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {},
    uid = baseState.uid || createBrowserNavUid(),
    scrollPos = baseState.scrollPos || getCurrentScrollPos()
  } = options;

  return {
    ...baseState,
    url: url || baseState.url || window.location.href,
    title: title || baseState.title || document.title,
    uid,
    scrollPos,
    [BROWSER_NAV_INDEX_KEY]: index,
    [BROWSER_NAV_CHROME_KEY]: readBrowserNavChromeSnapshot(chromeOverrides)
  };
}

function replaceBrowserNavState(index, title = document.title, url = window.location.href, chromeOverrides = {}) {
  try {
    const nextState = buildBrowserNavState(index, title, url, chromeOverrides);
    window.history.replaceState(nextState, nextState.title, nextState.url);
  } catch (_e) {
    // Ignore replaceState failures; sessionStorage still tracks the fallback depth.
  }
}

function pushBrowserNavState(index, title, url, chromeOverrides = {}) {
  const uid = createBrowserNavUid();
  const nextState = buildBrowserNavState(index, title, url, chromeOverrides, {
    uid,
    scrollPos: [0, 0]
  });
  window.history.pushState(nextState, nextState.title, nextState.url);
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

function hardNavigate(url) {
  const target = String(url || window.location.href);
  try {
    window.location.assign(target);
  } catch (_error) {
    window.location.href = target;
  }
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

// ── Link management (shared via link-attach.js) ──

const PJAX_LINK_SELECTOR = `a.pjax-link[${PJAX_MANAGED_ATTR}="true"]:not([target='_blank'])`;

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

    markPjaxLinks(document);
    const initialLinks = document.querySelectorAll(PJAX_LINK_SELECTOR);
    pjaxLog('init: found', initialLinks.length, 'links, selector:', PJAX_LINK_SELECTOR);

    // Singleton guard — prevent duplicate Pjax in Vite dev mode
    if (window.pjax) {
      pjaxWarn('init: Pjax already exists, skipping duplicate');
      return;
    }

    const pjax = new Pjax({
      selectors: ["title", "#window-frame-root"],
      cacheBust: false,
      elements: PJAX_LINK_SELECTOR
    });

    // Non-200 responses: full-page redirect to show dedicated error page.
    const _origHandleResponse = pjax.handleResponse.bind(pjax);
    pjax.handleResponse = function(responseText, request, href, options) {
      if (!isCurrentNavigationIntent(options?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('handleResponse: ignored stale navigation response');
        return;
      }
      const fallbackHref = resolveNavigationHref(request, href);
      if (responseText === null && request && request.status >= 400) {
        pjaxWarn('handleResponse: status', request.status, '→ full redirect', fallbackHref);
        stopTopProgress();
        window.location = fallbackHref;
        return;
      }
      if (responseText === false) {
        pjaxWarn('handleResponse: failed response → full redirect', fallbackHref);
        stopTopProgress();
        window.location = fallbackHref;
        return;
      }
      // The desktop surface is persistent and lives outside Pjax's selector.
      // Install the inert home response protocol before Pjax starts switching
      // DOM so every pjax:complete listener observes fully hydrated data.
      syncHomeDesktopWidgetProtocolFromResponse(responseText);
      preparePluginCompatibilityFromResponse(responseText, {
        stageOnlineHistory: options?.history !== false,
        targetUrl: fallbackHref
      });
      _origHandleResponse(responseText, request, href, options);
    };

    // Patch attachLink to deduplicate — MoOx/pjax's attachLink never checks
    // whether a handler is already bound.
    const ATTACHED = 'data-pjax-attached';
    const _origAttachLink = pjax.attachLink.bind(pjax);
    pjax.attachLink = function(link) {
      if (link.hasAttribute(ATTACHED)) return;
      link.setAttribute(ATTACHED, '1');
      _origAttachLink(link);
    };

    window.pjax = pjax;
    pjaxLog('init: Pjax created, #window-frame-root exists:', !!document.getElementById('window-frame-root'));

    const sameVariantCoordinator = createNavigationCoordinator();
    const browserNavigationOwnership = createBrowserNavigationOwnership();
    let _sameVariantLoadingController = null;
    let _pjaxLoadingController = null;
    let _fullPjaxGeneration = 0;
    let navigationIntentGeneration = 0;

    const _origLoadUrl = pjax.loadUrl.bind(pjax);
    pjax.loadUrl = function(url, options = {}) {
      cancelActivePhotosViewTransition();
      const intentGeneration = ++navigationIntentGeneration;
      const isPopstateIntent = options?.history === false;
      browserNavigationOwnership.begin(intentGeneration, { popstate: isPopstateIntent });
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
      // A newer navigation must cancel both an in-flight XHR and an older
      // app-asset gate. Otherwise a slow app bundle can start a stale request
      // after the user has already chosen another destination.
      pjax.abortRequest(pjax.request);
      const targetApp = inferPageAppForNavigation(url, options?.triggerElement || null);
      startTopProgress();
      return ensureAppAssetsLoaded(targetApp)
        .then(() => {
          if (intentGeneration !== navigationIntentGeneration) return false;
          return _origLoadUrl(url, {
            ...options,
            requestOptions: {
              ...(options?.requestOptions || {}),
              requestUrl: options?.requestOptions?.requestUrl || String(url)
            },
            [NAVIGATION_INTENT_OPTION]: intentGeneration
          });
        })
        .catch((error) => {
          if (intentGeneration !== navigationIntentGeneration) return false;
          browserNavigationOwnership.release(intentGeneration);
          window._browserPopstatePending = false;
          window._browserForwardNavPending = false;
          pjaxWarn('app assets failed before navigation:', targetApp || '-', error?.message || error, '→ hard navigation');
          stopTopProgress();
          hardNavigate(url);
          return false;
        });
    };

    initializeBrowserNavDepth();
    installBrowserNavHelpers();

    window.addEventListener('popstate', (event) => {
      window._browserPopstatePending = browserNavigationOwnership.isPopstate(navigationIntentGeneration);
      window._browserForwardNavPending = false;
      const stateIndex = readBrowserNavIndexFromState(event.state);
      syncBrowserNavDepth(stateIndex ?? 0);
      applyBrowserNavChromeState(event.state);
    });

    // ── Dynamic link attachment (using shared link-attach.js) ──

    // ── One-time scan for desktop widget links (outside pjax-container) ──
    const desktopSurface = document.querySelector('.desktop-surface');
    if (desktopSurface) {
      attachDynamicLinks(desktopSurface);
    }

    // ── MutationObserver for pjax container only ──
    const pjaxContainer = document.getElementById('window-frame-root');
    if (pjaxContainer) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const isUnattachedLink = node.matches?.(`a.pjax-link[href]:not([${ATTACHED}])`);
            const hasUnattachedLinks = node.querySelector?.(`a.pjax-link[href]:not([${ATTACHED}])`);
            if (isUnattachedLink || hasUnattachedLinks) attachDynamicLinks(node);
          }
        }
      });
      observer.observe(pjaxContainer, { childList: true, subtree: true });
      pjaxLog('observer: watching #window-frame-root');
    }

    // ── Same-variant content-level navigation ──

    /**
     * Navigate within the same window variant — replace only the content root,
     * keep the window frame (titlebar, traffic lights, toolbar) intact.
     */
    async function navigateWithinVariant(targetUrl, triggerElement = null) {
      cancelActivePhotosViewTransition();
      const intentGeneration = ++navigationIntentGeneration;
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
      const isCurrentNavigation = () => intentGeneration === navigationIntentGeneration
        && sameVariantCoordinator.isCurrent(navigation);
      window._sameVariantJustCompleted = false;

      perfMark('navStart');

      const contentRoot = document.querySelector('[data-window-content-root]');
      if (!contentRoot) {
        sameVariantCoordinator.finish(navigation);
        stopTopProgress();
        clearTransientNavigationUi();
        return false;
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
      let finalizedCurrentNavigation = false;
      let completionDetail = null;
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
            signal: navigation.signal
          }),
          ensureAppAssetsLoaded(targetApp)
        ]);

        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const html = await resp.text();
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

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

        // Parse target's inner content (the content inside [data-window-content-variant] or #pjax-container)
        const parser = new DOMParser();
        const targetDoc = parser.parseFromString(html, 'text/html');
        const targetContentRoot = targetDoc.querySelector('[data-window-content-root]');
        const targetContainer = targetContentRoot?.querySelector('[data-window-content-variant]')
          || targetContentRoot?.querySelector('#pjax-container');

        const nextApp = parsePageAppFromResponse(html) || targetApp;
        await ensureAppAssetsLoaded(nextApp);
        if (!isCurrentNavigation()) {
          throw new DOMException('Navigation superseded', 'AbortError');
        }

        preparePluginCompatibilityFromResponse(html);
        const syncedTitlebar = syncWindowTitlebarFromDocument(targetDoc);

        const photosSharedTransition = currentApp === 'photos' && responseApp === 'photos'
          ? resolvePhotosSharedTransition(contentContainer, targetContainer, triggerElement)
          : null;
        let activePhotosTransition = null;
        let contentSwapped = false;
        const performContentSwap = () => {
          if (!isCurrentNavigation()) return;
          deactivateCurrentPageApp();
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
          document.dispatchEvent(new CustomEvent('theme:content-swapped', {
            detail: { root: contentContainer, reason: 'same-variant' }
          }));
          if (activePhotosTransition) {
            markPhotosSharedTransitionTarget(contentContainer, activePhotosTransition);
          }
          contentSwapped = true;
        };
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const canUseViewTransition = typeof document.startViewTransition === 'function'
          && !reduceMotion
          && Boolean(photosSharedTransition);
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
          Promise.resolve(transition.finished)
            .catch(() => {})
            .finally(() => {
              if (activePhotosViewTransition?.descriptor.owner === activePhotosTransition.owner) {
                activePhotosViewTransition = null;
              }
              cleanupPhotosSharedTransition(activePhotosTransition);
            });
          await transition.updateCallbackDone.catch(() => {});
        } else {
          performContentSwap();
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

        // Alpine + scripts
        replayPjaxScripts(contentContainer);
        runShikiExtraPathRenderer(html, contentContainer);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(contentContainer);
        }

        perfMark('AlpineInitDone');

        // Re-bind links
        attachDynamicLinks(contentContainer);
        if (syncedTitlebar) {
          attachDynamicLinks(syncedTitlebar);
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
        syncBrowserNavDepth(nextNavIndex);
        navigationSucceeded = true;
      } catch (err) {
        if (isNavigationAbort(err, navigation, sameVariantCoordinator)) {
          pjaxLog('same-variant navigation superseded:', targetUrl);
        } else {
          pjaxWarn('same-variant navigation failed:', err.message, '→ fallback');
          shouldFallback = true;
        }
      } finally {
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
        document.dispatchEvent(new CustomEvent('pjax:same-variant-complete', {
          detail: completionDetail
        }));

        pjaxLog('same-variant navigation complete:', targetUrl);

        const surface = document.querySelector('.desktop-surface');
        if (surface) {
          setTimeout(() => attachDynamicLinks(surface), 200);
        }
        return true;
      }

      if (shouldFallback && finalizedCurrentNavigation) {
        window._sameVariantJustCompleted = true;
        try {
          window._browserForwardNavPending = true;
          window.pjax.loadUrl(targetUrl);
        } catch (_e) {
          hardNavigate(targetUrl);
        }
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
      deactivateCurrentPageApp();
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
      const completionGeneration = _fullPjaxGeneration;
      const completionIntentValue = event?.[NAVIGATION_INTENT_OPTION];
      const completionIntent = Number(completionIntentValue) > 0
        ? Number(completionIntentValue)
        : navigationIntentGeneration;
      const isCurrentCompletion = () => isFullNavigationCompletionCurrent({
        completionGeneration,
        currentGeneration: _fullPjaxGeneration,
        completionIntent: completionIntentValue,
        currentIntent: navigationIntentGeneration
      });
      const loadingController = _pjaxLoadingController;
      const container = document.getElementById('window-frame-root');
      const responseText = event?.request?.responseText;
      const fallbackHref = resolveNavigationHref(
        event?.request,
        event?.requestOptions?.requestUrl
      );
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

          attachDynamicLinks(container);

          activatePageApp(nextApp, container, {
            reason: 'pjax-complete',
            documentTitle: document.title
          });

          // Deferred re-scan: desktop widgets re-render after pjax swap,
          // stripping data-pjax-attached. Catch them once after settle.
          const surface = document.querySelector('.desktop-surface');
          if (surface) {
            setTimeout(() => attachDynamicLinks(surface), 200);
          }
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
        hardNavigate(fallbackHref);
      }
    });

    document.addEventListener("pjax:error", (event) => {
      if (!isCurrentNavigationIntent(event?.[NAVIGATION_INTENT_OPTION], navigationIntentGeneration)) {
        pjaxLog('event:error ignored for stale navigation');
        return;
      }
      pjaxWarn('event:error', event.detail?.request?.status, event.detail?.error?.message);
      const errorIntentValue = event?.[NAVIGATION_INTENT_OPTION];
      const errorIntent = Number(errorIntentValue) > 0
        ? Number(errorIntentValue)
        : navigationIntentGeneration;
      _fullPjaxGeneration += 1;
      sameVariantCoordinator.cancel();
      discardStagedOnlineMonitorHistoryState();
      _sameVariantLoadingController?.finish({ immediate: true });
      _sameVariantLoadingController = null;
      browserNavigationOwnership.release(errorIntent);
      window._browserForwardNavPending = false;
      window._browserPopstatePending = false;
      window._sameVariantJustCompleted = false;
      stopTopProgress();
      const container = document.getElementById('window-frame-root');
      if (container) {
        container.classList.remove('pjax-loading');
      }
      _pjaxLoadingController?.finish({ immediate: true });
      _pjaxLoadingController = null;
      clearBusyState(container);
      activateCurrentPageApp(document, { reason: 'pjax-error-recover' });
      clearTransientNavigationUi();
    });

    // ── Same-variant capture handler (runs BEFORE Pjax click handler) ──
    document.addEventListener('click', (e) => {
      if (!isPlainPrimaryNavigationEvent(e)) return;
      const link = e.target.closest('a[href]');
      if (!link || link.target || link.hasAttribute('download') || link.href.startsWith('javascript:')) return;
      if (!link.classList?.contains('pjax-link')) return;

      const targetUrl = new URL(link.href, window.location.origin);
      if (targetUrl.origin !== window.location.origin) return;
      if (targetUrl.pathname === '/') return;

      const isSameDocumentRoute =
        targetUrl.pathname === window.location.pathname &&
        targetUrl.search === window.location.search;
      if (isSameDocumentRoute) return;

      const currentVariant = document.body.dataset.windowVariant || '';
      const targetVariant = inferWindowVariantFromUrl(targetUrl);
      const currentApp = getCurrentPageApp() || '';
      const currentMode = document.body.dataset.pageMode || '';
      const targetApp = inferPageAppForNavigation(targetUrl, link) || '';

      if (currentVariant && targetVariant &&
          currentVariant === targetVariant &&
          currentVariant !== 'none' &&
          isContentSwitchAllowed(currentApp, currentMode) &&
          supportsSameVariantContentSwitch(targetApp)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pjaxLog('same-variant intercept:', currentVariant, currentApp, currentMode, '→', targetApp, targetUrl.href);
        navigateWithinVariant(targetUrl.href, link);
      }
    }, true); // capture phase

    // ── Body click router (window manager integration) ──

    document.body.addEventListener('click', (e) => {
      if (!isPlainPrimaryNavigationEvent(e)) return;
      const link = e.target.closest('a[href]');
      if (link && !link.target && !link.hasAttribute('download') && !link.href.startsWith('javascript:')) {
        const targetUrl = new URL(link.href, window.location.origin);
        const windowManager = Alpine.store('windowManager');
        const isHomeLink = targetUrl.origin === window.location.origin && targetUrl.pathname === '/';
        const isLeavingDesktop = window.location.pathname === '/' && targetUrl.origin === window.location.origin && targetUrl.pathname !== '/';
        const isSameDocumentRoute =
          targetUrl.origin === window.location.origin &&
          targetUrl.pathname === window.location.pathname &&
          targetUrl.search === window.location.search;

        if (isHomeLink) {
          window.preventAutoOpen = true;
          windowManager.showDesktop();
          return;
        }

        if (isLeavingDesktop) {
          return;
        }

        if (windowManager?.minimized && !isSameDocumentRoute) {
          return;
        }

        pjaxLog('click:', link.href, 'classes:', link.className, 'pjax-managed:', link.getAttribute(PJAX_MANAGED_ATTR));
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);
}
