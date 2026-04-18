/**
 * Desktop debug core helpers.
 */

export const DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION = 3;
export const DESKTOP_SHELL_VERSION = '20260328-2';

const DESKTOP_DEBUG_STORAGE_KEY = 'theme-desktop-debug';

function hasDesktopDebugQuery() {
  if (typeof window === 'undefined') return false;

  try {
    const params = new URLSearchParams(window.location.search || '');
    const value = (params.get('desktop-debug') || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch (_error) {
    return false;
  }
}

export function setDesktopDebugAccess(enabled) {
  if (typeof window === 'undefined') return;
  window.__THEME_DESKTOP_DEBUG_ALLOWED__ = !!enabled;
}

export function isDesktopDebugEnabled() {
  if (typeof window === 'undefined') return false;
  return document.body?.dataset.debug === 'true'
    || window.__THEME_DESKTOP_DEBUG_ALLOWED__ === true;
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
