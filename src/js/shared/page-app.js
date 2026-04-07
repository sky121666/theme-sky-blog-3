import { initLazyImages } from './lazy-media.js';
import { initLazyComments } from './lazy-comment.js';

const PAGE_APP_REGISTRY_KEY = '__THEME_PAGE_APP_REGISTRY__';

function getPageAppRegistry() {
  if (!window[PAGE_APP_REGISTRY_KEY]) {
    window[PAGE_APP_REGISTRY_KEY] = {
      pageInitializers: []
    };
  }

  return window[PAGE_APP_REGISTRY_KEY];
}

export function queuePageInitializer(initializer) {
  if (typeof initializer !== 'function') return;
  getPageAppRegistry().pageInitializers.push(initializer);
}

export function runPageInitializers(root = document) {
  const registry = getPageAppRegistry();
  registry.pageInitializers.forEach((initializer) => {
    initializer(root);
  });

  // Built-in lazy initializers (run after user-registered ones)
  initLazyImages(root);
  initLazyComments(root);
}
