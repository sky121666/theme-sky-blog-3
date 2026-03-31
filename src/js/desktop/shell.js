/**
 * macOS 桌面壳层 — 组件注册入口
 *
 * 所有逻辑已拆分到独立模块，此文件仅负责组装和注册顺序。
 */

import { initPjax } from './pjax.js';
import { observeSearchWidget, openSearchWidget } from './search.js';
import { registerWindowManager } from './window-manager.js';
import { registerWindowComponents } from './window.js';
import { registerArchiveExplorer, initArchiveSidebar } from './archive-sidebar.js';
import { registerExplorers } from './explorers.js';
import { initPostOutline } from './post-outline.js';

export function registerShellComponents(Alpine) {
  // 1. Stores 必须最先注册（其它组件依赖 $store.windowManager / $store.theme）
  registerWindowManager(Alpine);

  // 2. 窗口组件（titlebar + draggableWindow）
  registerWindowComponents(Alpine);

  // 3. 内容浏览器
  registerArchiveExplorer(Alpine);
  registerExplorers(Alpine);

  // 4. Pjax 引擎（依赖 $store.windowManager）
  initPjax(Alpine);

  // 5. 搜索组件 Shadow DOM 样式
  observeSearchWidget();

  // 6. 初始化页面级功能
  initArchiveSidebar(document);
  initPostOutline(document);

  // 7. 全局快捷键
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (openSearchWidget()) {
        event.preventDefault();
      }
    }
  });
}
