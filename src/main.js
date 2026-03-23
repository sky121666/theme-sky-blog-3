/**
 * macOS Desktop Theme - 主入口
 *
 * 构建产物：templates/assets/js/main.js + templates/assets/css/main.css
 */

/* ===== CSS ===== */
import './css/desktop.css';

/* ===== JS：Alpine.js ===== */
import Alpine from 'alpinejs';
import { registerComponents } from './js/desktop.js';

window.Alpine = Alpine;

registerComponents(Alpine);

Alpine.start();
