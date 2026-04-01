/**
 * 桌面组件调试工具
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

export function installDesktopDebugBridge() {
  if (typeof window === 'undefined' || window.ThemeSkyDesktopDebug) return;
  setDesktopDebugAccess(false);

  window.ThemeSkyDesktopDebug = {
    enable() {
      localStorage.setItem(DESKTOP_DEBUG_STORAGE_KEY, '1');
      if (isDesktopDebugEnabled()) {
        console.info('[desktop] debug enabled');
      }
    },
    disable() {
      localStorage.removeItem(DESKTOP_DEBUG_STORAGE_KEY);
      if (window.__THEME_DESKTOP_DEBUG_ALLOWED__ === true) {
        console.info('[desktop] debug disabled');
      }
    },
    snapshot() {
      if (window.__THEME_DESKTOP_DEBUG_ALLOWED__ !== true) {
        console.warn('[desktop] debug snapshot unavailable: admin debug access is disabled');
        return null;
      }
      const root = document.querySelector('.desktop-surface');
      const state = root?._x_dataStack?.[0];
      const slots = Array.from(document.querySelectorAll('.desktop-node-slot'));
      const inspect = (element) => {
        if (!element) return null;
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName,
          className: element.className,
          display: style.display,
          opacity: style.opacity,
          visibility: style.visibility,
          width: style.width,
          height: style.height,
          left: style.left,
          top: style.top
        };
      };
      const snapshot = {
        protocol: window.__THEME_DESKTOP_PROTOCOL__ || null,
        enabled: state?.enabled,
        isHome: state?.isHome,
        layoutVersion: state?.layoutVersion,
        icons: state?.icons?.length || 0,
        widgets: state?.widgets?.length || 0,
        visibleKeys: state?.visibleDesktopNodeKeys || [],
        selectedDesktopKey: state?.selectedDesktopKey || '',
        previewPlacement: state?.previewPlacement || null,
        domNodeCount: slots.length,
        domNodes: slots.slice(0, 8).map((slot) => ({
          key: slot.getAttribute('data-desktop-key'),
          slot: inspect(slot),
          widget: inspect(slot.querySelector('.desktop-widget-card')),
          icon: inspect(slot.querySelector('a.desktop-icon'))
        })),
        grid: inspect(document.querySelector('.desktop-widgets-grid')),
        gridShell: inspect(document.querySelector('.desktop-widgets-grid-shell')),
        layer: inspect(document.querySelector('.desktop-widgets-layer'))
      };
      console.info('[desktop] snapshot', snapshot);
      return snapshot;
    }
  };
}
