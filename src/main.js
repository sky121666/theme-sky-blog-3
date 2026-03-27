/**
 * macOS Desktop Theme - 主入口
 *
 * 构建产物：templates/assets/js/main.js + templates/assets/css/main.css
 */

/* ===== CSS ===== */
import './css/desktop.css';
import './css/post.css';
import './css/moment.css';
import './css/archives.css';
import './css/tags.css';
import './css/categories.css';
import './css/author.css';
import './css/error.css';

/* ===== JS：Alpine.js ===== */
import Alpine from 'alpinejs';
import { registerComponents } from './js/desktop.js';

window.Alpine = Alpine;

registerComponents(Alpine);

Alpine.start();
