/**
 * Alpine.data 组件注册中心
 *
 * 所有 Alpine.data 必须在 Alpine.start() 之前同步注册。
 * MoOx/pjax 在 handleResponse 中同步替换 DOM，Alpine 的内部
 * MutationObserver 会立即 initTree —— 晚于此的异步注册无效。
 */

import { registerShellComponents } from './desktop/shell.js';
import { registerDesktopSurface } from './desktop/surface/index.js';
import { runPageAppRegistrars } from './shared/page-app.js';

export function registerComponents(Alpine) {
  registerShellComponents(Alpine);
  registerDesktopSurface(Alpine);
  runPageAppRegistrars(Alpine);
}
