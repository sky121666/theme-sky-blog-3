import { resolveRoute } from './route-manifest.js';
import { getAppManifest } from './app-manifests.js';
import { warmAppAssets } from './app-loader.js';
import {
  initializeNavigationPreload as initializeSharedPreload,
  canPreloadPage as canPreloadSharedPage,
  fetchNavigationPage as fetchSharedNavigationPage
} from '../../shared/navigation-preload.js';

// The shell supplies project policy to the shared transport. Reconfiguring an
// already-created Docsme client keeps its Swup instance, flights and listeners.
export function initializeNavigationPreload(options = {}) {
  initializeSharedPreload({ resolveRoute, getAppManifest, warmAppAssets, ...options });
}

export function canPreloadPage(url) {
  initializeNavigationPreload();
  return canPreloadSharedPage(url);
}

export function fetchNavigationPage(url, options) {
  initializeNavigationPreload();
  return fetchSharedNavigationPage(url, options);
}
