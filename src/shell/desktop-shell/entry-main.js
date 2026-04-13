/**
 * macOS Desktop Theme - 主入口
 *
 * 构建产物：templates/assets/js/main.js + templates/assets/css/main.css
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
import { runPageInitializers } from './runtime/shared/page-app.js';
import { initLazyImages } from './runtime/shared/lazy-media.js';

if (!window.__THEME_MAIN_LOADED__) {
  window.__THEME_MAIN_LOADED__ = true;

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
  runPageInitializers(document);
}
