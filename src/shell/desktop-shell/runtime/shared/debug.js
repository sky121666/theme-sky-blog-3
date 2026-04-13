/**
 * 全局调试日志工具
 * 由主题设置 → 开发者 → 调试模式 控制（body[data-debug="true"]）
 */

const isDebug = () => document.body?.dataset.debug === 'true';

export function createLogger(prefix) {
  return {
    log: (...args) => { if (isDebug()) console.log(`[${prefix}]`, ...args); },
    warn: (...args) => { if (isDebug()) console.warn(`[${prefix}]`, ...args); },
    error: (...args) => { if (isDebug()) console.error(`[${prefix}]`, ...args); },
    group: (label) => { if (isDebug()) console.group(`[${prefix}] ${label}`); },
    groupEnd: () => { if (isDebug()) console.groupEnd(); },
  };
}
