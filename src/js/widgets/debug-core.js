/**
 * Desktop debug core helpers.
 */

export const DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION = 3;
export const DESKTOP_SHELL_VERSION = '20260328-2';

const DESKTOP_DEBUG_STORAGE_KEY = 'theme-desktop-debug';

export function setDesktopDebugAccess(enabled) {
  if (typeof window === 'undefined') return;
  window.__THEME_DESKTOP_DEBUG_ALLOWED__ = !!enabled;
}

export function isDesktopDebugEnabled() {
  if (typeof window === 'undefined') return false;

  // Theme settings toggle (主题设置 → 开发者 → 调试模式)
  if (document.body?.dataset.debug === 'true') return true;

  if (window.__THEME_DESKTOP_DEBUG_ALLOWED__ !== true) return false;

  try {
    if (window.localStorage?.getItem(DESKTOP_DEBUG_STORAGE_KEY) === '1') {
      return true;
    }
  } catch (_error) {
    // Ignore storage access errors.
  }

  const host = window.location.hostname || '';
  return host === '127.0.0.1' || host === 'localhost';
}

export function desktopDebug(label, payload) {
  if (!isDesktopDebugEnabled()) return;

  if (payload === undefined) {
    console.info(`[desktop] ${label}`);
    return;
  }

  console.info(`[desktop] ${label}`, payload);
}

export function desktopDebugWarn(label, payload) {
  if (!isDesktopDebugEnabled()) return;

  if (payload === undefined) {
    console.warn(`[desktop] ${label}`);
    return;
  }

  console.warn(`[desktop] ${label}`, payload);
}

export function enableDesktopDebugStorage() {
  localStorage.setItem(DESKTOP_DEBUG_STORAGE_KEY, '1');
}

export function disableDesktopDebugStorage() {
  localStorage.removeItem(DESKTOP_DEBUG_STORAGE_KEY);
}
