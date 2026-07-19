import { disposeLazyImages, initLazyImages } from './lazy-media.js';
import { disposeLazyComments, initLazyComments } from './lazy-comment.js';

const PAGE_APP_REGISTRY_KEY = '__THEME_PAGE_APP_REGISTRY__';

function getPageAppRegistry() {
  if (!window[PAGE_APP_REGISTRY_KEY]) {
    window[PAGE_APP_REGISTRY_KEY] = {
      appRegistrars: [],
      pageInitializers: [],
      appLifecycles: {},
      activeApp: null
    };
  }

  return window[PAGE_APP_REGISTRY_KEY];
}

export function queuePageAppRegistrar(registrar) {
  if (typeof registrar !== 'function') return;
  if (window.Alpine && window.__THEME_ALPINE_STARTED__) {
    registrar(window.Alpine);
    return;
  }
  getPageAppRegistry().appRegistrars.push(registrar);
}

export function runPageAppRegistrars(Alpine) {
  if (!Alpine) return;
  const registry = getPageAppRegistry();
  const registrars = registry.appRegistrars.splice(0, registry.appRegistrars.length);
  registrars.forEach((registrar) => {
    registrar(Alpine);
  });
}

export function queuePageInitializer(initializer) {
  if (typeof initializer !== 'function') return;
  getPageAppRegistry().pageInitializers.push(initializer);
}

export function registerPageAppLifecycle(appId, lifecycle) {
  const normalized = typeof appId === 'string' ? appId.trim() : '';
  if (!normalized || !lifecycle || typeof lifecycle !== 'object') return;
  getPageAppRegistry().appLifecycles[normalized] = lifecycle;
}

function buildPageAppContext(appId, protocol, root = document, extra = {}) {
  const pathname = window.location.pathname || '/';
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const body = document.body;
  const shellScene = body?.dataset.shellScene || '';
  const windowVariant = body?.dataset.windowVariant || '';
  const themeMode = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

  return {
    appId,
    route: {
      pathname,
      search,
      hash,
      params: {}
    },
    shell: {
      isDesktop: shellScene === 'desktop' || !!document.querySelector('.desktop-surface'),
      shellScene,
      themeMode,
      windowVariant
    },
    services: extra.services || {},
    ssrProps: protocol?.props || null,
    state: protocol?.state || null,
    documentTitle: extra.documentTitle || document.title,
    reason: extra.reason || '',
    root: protocol?.root || root
  };
}

function normalizeDocumentState(documentState, context) {
  const state = documentState && typeof documentState === 'object' ? documentState : {};
  const title = typeof state.title === 'string' && state.title.trim()
    ? state.title.trim()
    : (context.documentTitle || document.title || '');
  const windowTitle = typeof state.windowTitle === 'string' && state.windowTitle.trim()
    ? state.windowTitle.trim()
    : title;

  return {
    title,
    windowTitle,
    windowSubtitle: typeof state.windowSubtitle === 'string' ? state.windowSubtitle : '',
    windowVariant: state.windowVariant || context.shell.windowVariant || ''
  };
}

function syncDocumentStateToShell(documentState) {
  if (!documentState) return;

  if (typeof documentState.title === 'string' && documentState.title) {
    document.title = documentState.title;
  }

  const titleEl = document.querySelector('[data-window-title]');
  if (titleEl && typeof documentState.windowTitle === 'string' && documentState.windowTitle) {
    titleEl.textContent = documentState.windowTitle;
  }

  const subtitleEl = document.querySelector('[data-window-subtitle]');
  if (subtitleEl && typeof documentState.windowSubtitle === 'string') {
    subtitleEl.textContent = documentState.windowSubtitle;
  }

  if (document.body && typeof documentState.windowVariant === 'string' && documentState.windowVariant) {
    document.body.dataset.windowVariant = documentState.windowVariant;
  }
}

function runLegacyInitializers(root = document) {
  const registry = getPageAppRegistry();
  registry.pageInitializers.forEach((initializer) => {
    initializer(root);
  });
}

export function runPageInitializers(root = document) {
  runLegacyInitializers(root);
  // Built-in lazy initializers (run after user-registered ones)
  initLazyImages(root);
  initLazyComments(root);
}

export function deactivateCurrentPageApp() {
  const registry = getPageAppRegistry();
  const activeApp = registry.activeApp;
  if (!activeApp) return;

  try {
    if (typeof activeApp.cleanup === 'function') {
      activeApp.cleanup();
    }
    if (typeof activeApp.lifecycle?.dispose === 'function') {
      activeApp.lifecycle.dispose(activeApp.root, activeApp.context);
    }
  } finally {
    disposeLazyImages(activeApp.root || document);
    disposeLazyComments(activeApp.root || document);
    registry.activeApp = null;
  }
}

export function activatePageApp(appId, root = document, extra = {}) {
  const normalized = typeof appId === 'string' ? appId.trim() : '';
  const registry = getPageAppRegistry();
  const lifecycle = normalized ? registry.appLifecycles[normalized] : null;

  if (registry.activeApp) {
    deactivateCurrentPageApp();
  }

  if (!normalized || !lifecycle) {
    runPageInitializers(root);
    registry.activeApp = {
      appId: normalized,
      root,
      cleanup: null,
      context: null,
      protocol: null
    };
    return registry.activeApp;
  }

  const protocol = typeof lifecycle.resolveProtocol === 'function'
    ? lifecycle.resolveProtocol(root)
    : { appId: normalized, root };
  const appRoot = protocol?.root || root;
  const context = buildPageAppContext(normalized, protocol, root, extra);
  const cleanup = typeof lifecycle.hydrate === 'function'
    ? lifecycle.hydrate(appRoot, context) || null
    : null;
  const documentState = normalizeDocumentState(
    typeof lifecycle.getDocumentState === 'function'
      ? lifecycle.getDocumentState(appRoot, context)
      : null,
    context
  );

  runPageInitializers(appRoot);
  syncDocumentStateToShell(documentState);

  registry.activeApp = {
    appId: normalized,
    root: appRoot,
    cleanup,
    lifecycle,
    context,
    protocol,
    documentState
  };
  return registry.activeApp;
}

export function activateCurrentPageApp(root = document, extra = {}) {
  const appId = document.body?.dataset.appId || document.body?.dataset.pageApp || '';
  return activatePageApp(appId, root, extra);
}

export function getActivePageAppDocumentState() {
  return getPageAppRegistry().activeApp?.documentState || null;
}
