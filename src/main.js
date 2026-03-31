/**
 * macOS Desktop Theme - 主入口
 *
 * 构建产物：templates/assets/js/main.js + templates/assets/css/main.css
 */

/* ===== CSS ===== */
import './css/desktop/surface.css';
import './css/desktop/shell.css';
import './css/icons/index.css';
import './css/widgets/index.css';
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
import { registerPostComponents } from './js/post/upvote.js';

window.Alpine = Alpine;

registerComponents(Alpine);
registerPostComponents(Alpine);

Alpine.start();
