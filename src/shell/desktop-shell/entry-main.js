/**
 * macOS Desktop Theme - 主入口
 *
 * 构建产物：templates/assets/js/shell-core.js + templates/assets/css/shell-core.css
 *
 * Guard: ES modules loaded from different URLs (e.g. with/without cache-busting
 * query) are treated as separate modules by the browser. This flag ensures
 * Alpine, Pjax, stores, and observers are only initialised once.
 */

/* ===== CSS (idempotent — safe to import multiple times) ===== */
import './styles/desktop/surface.css';
import './styles/desktop/shell.css';
import './styles/icons/index.css';
import './styles/widgets/index.css';
import './styles/error.css';

/* ===== JS：Alpine.js ===== */
import Alpine from 'alpinejs';
import morph from '@alpinejs/morph';
import intersect from '@alpinejs/intersect';
import { registerComponents } from './runtime/desktop.js';
import { activateCurrentPageApp } from './runtime/shared/page-app.js';
import { initLazyImages } from './runtime/shared/lazy-media.js';
import { getLatestThemeBuildVersion } from '../../shell-core/runtime/resource-registry.js';

const CURRENT_THEME_BUILD_VERSION = typeof __THEME_BUILD_VERSION__ === 'string'
  ? __THEME_BUILD_VERSION__
  : '';

let runtimeFreshnessCheckPromise = null;
let runtimeReloading = false;

async function verifyRuntimeFreshness(force = false) {
  if (runtimeReloading) return true;
  if (!CURRENT_THEME_BUILD_VERSION) return false;
  if (runtimeFreshnessCheckPromise && !force) return runtimeFreshnessCheckPromise;

  const promise = getLatestThemeBuildVersion({ force: true })
    .then((latestVersion) => {
      if (!latestVersion || latestVersion === CURRENT_THEME_BUILD_VERSION) {
        return false;
      }

      runtimeReloading = true;
      if (typeof window !== 'undefined') {
        window.__THEME_RUNTIME_STALE__ = latestVersion;
        window.location.reload();
      }

      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (!runtimeReloading) {
        runtimeFreshnessCheckPromise = null;
      }
    });

  runtimeFreshnessCheckPromise = promise;
  return promise;
}

if (!window.__THEME_MAIN_LOADED__) {
  window.__THEME_MAIN_LOADED__ = true;
  window.__THEME_ALPINE_STARTED__ = false;
  window.__THEME_BUILD_VERSION__ = CURRENT_THEME_BUILD_VERSION;

  window.__initLazyImages = initLazyImages;
  window.Alpine = Alpine;

  Alpine.plugin(morph);
  Alpine.plugin(intersect);

  // Custom directive for incremental widget updates
  Alpine.directive('widget-content', (el, { expression }, { evaluateLater, effect }) => {
    const getHtml = evaluateLater(expression);
    const tagName = el.tagName.toLowerCase();
    effect(() => {
      getHtml((html) => {
        const nextHtml = typeof html === 'string' ? html : '';
        const renderMode = el.dataset.widgetRenderMode || 'morph';

        if (renderMode === 'html') {
          if (el.innerHTML !== nextHtml) {
            el.innerHTML = nextHtml;
          }
          return;
        }

        const loadingRoot = el.firstElementChild?.classList?.contains('desktop-widget-loading') === true;
        if (loadingRoot && !nextHtml.includes('desktop-widget-loading')) {
          el.innerHTML = nextHtml;
          return;
        }

        if (el.innerHTML === nextHtml) return;

        Alpine.morph(el, `<${tagName}>${nextHtml}</${tagName}>`, {
          updating: (_from, _to, childrenOnly) => {
            childrenOnly();
          }
        });
      });
    });
  });

  registerComponents(Alpine);

  Alpine.start();
  window.__THEME_ALPINE_STARTED__ = true;
  activateCurrentPageApp(document, { reason: 'initial-load' });

  // Detect when this tab is still running an older shell runtime after a deploy.
  void verifyRuntimeFreshness();
  window.addEventListener('pageshow', () => {
    void verifyRuntimeFreshness(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void verifyRuntimeFreshness(true);
    }
  });
}
