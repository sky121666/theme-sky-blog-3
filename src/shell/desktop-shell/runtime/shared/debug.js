/**
 * 全局调试日志工具
 * 后台开关只表示“允许调试”，真正打印需要显式开启：
 * 1. localStorage: theme-desktop-debug=1
 * 2. URL: ?desktop-debug=1
 */

import { isDesktopDebugEnabled } from '../widgets/debug-core.js';

export function createLogger(prefix) {
  return {
    log: (...args) => { if (isDesktopDebugEnabled()) console.log(`[${prefix}]`, ...args); },
    warn: (...args) => { if (isDesktopDebugEnabled()) console.warn(`[${prefix}]`, ...args); },
    error: (...args) => { if (isDesktopDebugEnabled()) console.error(`[${prefix}]`, ...args); },
    group: (label) => { if (isDesktopDebugEnabled()) console.group(`[${prefix}] ${label}`); },
    groupEnd: () => { if (isDesktopDebugEnabled()) console.groupEnd(); },
  };
}
