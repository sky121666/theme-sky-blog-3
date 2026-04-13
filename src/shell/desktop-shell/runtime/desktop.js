/**
 * Alpine.data 组件注册中心
 *
 * 所有 Alpine.data 必须在 Alpine.start() 之前同步注册。
 * MoOx/pjax 在 handleResponse 中同步替换 DOM，Alpine 的内部
 * MutationObserver 会立即 initTree —— 晚于此的异步注册无效。
 */

import { registerShellComponents } from './desktop/shell.js';
import { registerDesktopSurface } from './desktop/surface/index.js';
import { registerArchiveExplorer, initArchiveSidebar } from '../../../features/browser-explorer/runtime/archive-sidebar.js';
import { registerExplorers } from '../../../features/browser-explorer/runtime/explorers.js';
import { registerPostComponents } from '../../../features/browser-reader/runtime/upvote.js';
import { initPostOutline } from '../../../features/browser-reader/runtime/post-outline.js';
import { queuePageInitializer } from './shared/page-app.js';
import { registerPhotosExplorer } from '../../../features/photos-app/runtime/explorer.js';

export function registerComponents(Alpine) {
  registerShellComponents(Alpine);
  registerDesktopSurface(Alpine);
  registerArchiveExplorer(Alpine);
  registerExplorers(Alpine);
  registerPostComponents(Alpine);
  registerPhotosExplorer(Alpine);

  queuePageInitializer((root) => {
    initArchiveSidebar(root);
    initPostOutline(root);
  });
}
