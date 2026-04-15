const PAGE_APP_REGISTRY_KEY = '__THEME_PAGE_APP_REGISTRY__';

function getRegistry() {
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
  getRegistry().appRegistrars.push(registrar);
}

export function registerPageAppLifecycle(appId, lifecycle) {
  const normalized = typeof appId === 'string' ? appId.trim() : '';
  if (!normalized || !lifecycle || typeof lifecycle !== 'object') return;
  getRegistry().appLifecycles[normalized] = lifecycle;
}

export function queuePageInitializer(initializer) {
  if (typeof initializer !== 'function') return;
  getRegistry().pageInitializers.push(initializer);
}
