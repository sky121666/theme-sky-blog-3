/**
 * macOS 桌面壳层 — 组件注册入口
 *
 * 所有逻辑已拆分到独立模块，此文件仅负责组装和注册顺序。
 */

import { initPjax } from './pjax/index.js';
import { initPrefetch } from './pjax/prefetch.js';
import { observeSearchWidget, openSearchWidget } from './search.js';
import { registerWindowManager } from './window-manager.js';
import { registerWindowComponents } from './window.js';

function isHeaderSearchEnabled() {
  const menubar = document.querySelector('.menubar');
  return menubar?.dataset?.searchEnabled !== 'false';
}

export function registerShellComponents(Alpine) {
  // 1. Stores 必须最先注册（其它组件依赖 $store.windowManager / $store.theme）
  registerWindowManager(Alpine);

  // 2. 窗口组件（titlebar + draggableWindow）
  registerWindowComponents(Alpine);

  // 3. Pjax 引擎（依赖 $store.windowManager）
  initPjax(Alpine);

  // 4. 搜索组件 Shadow DOM 样式
  observeSearchWidget();

  // 5. 全局快捷键
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (!isHeaderSearchEnabled()) return;
      if (openSearchWidget()) {
        event.preventDefault();
      }
    }
  });

  // 6. 轻量预取（不阻塞首屏，空闲时初始化）
  (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1500))(() => {
    initPrefetch();
  });
}
