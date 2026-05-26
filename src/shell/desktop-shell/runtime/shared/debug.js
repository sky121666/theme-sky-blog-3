/**
 * 全局调试日志工具
 * 后台 developer.debug_mode 会通过 body[data-debug="true"] 接入前端。
 * 日志只用于异常定位，不用于行为埋点。
 */

import { isDesktopDebugEnabled } from '../widgets/debug-core.js';

export function createLogger(prefix) {
  return {
    log: (...args) => { if (isDesktopDebugEnabled()) console.log(`[${prefix}]`, ...args); },
    info: (...args) => { if (isDesktopDebugEnabled()) console.info(`[${prefix}]`, ...args); },
    warn: (...args) => { if (isDesktopDebugEnabled()) console.warn(`[${prefix}]`, ...args); },
    error: (...args) => { if (isDesktopDebugEnabled()) console.error(`[${prefix}]`, ...args); },
    group: (label) => { if (isDesktopDebugEnabled()) console.group(`[${prefix}] ${label}`); },
    groupEnd: () => { if (isDesktopDebugEnabled()) console.groupEnd(); },
  };
}

export function warnApiCall(prefix, label, payload = {}) {
  if (!isDesktopDebugEnabled()) return;
  console.warn(`[${prefix}] ${label}`, payload);
}
