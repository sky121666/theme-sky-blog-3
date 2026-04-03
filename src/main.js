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
import './css/desktop/surface.css';
import './css/desktop/shell.css';
import './css/icons/index.css';
import './css/widgets/index.css';
import './css/error.css';

/* ===== JS：Alpine.js ===== */
import Alpine from 'alpinejs';
import { registerComponents } from './js/desktop.js';
import { runPageInitializers } from './js/shared/page-app.js';

if (!window.__THEME_MAIN_LOADED__) {
  window.__THEME_MAIN_LOADED__ = true;

  window.Alpine = Alpine;

  registerComponents(Alpine);

  Alpine.start();
  runPageInitializers(document);
}
