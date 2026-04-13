/**
 * Debug bridge is only needed during admin/edit flows.
 */

import {
  enableDesktopDebugStorage,
  disableDesktopDebugStorage,
  isDesktopDebugEnabled,
  setDesktopDebugAccess
} from './debug-core.js';

export function installDesktopDebugBridge() {
  if (typeof window === 'undefined' || window.ThemeSkyDesktopDebug) return;
  setDesktopDebugAccess(false);

  window.ThemeSkyDesktopDebug = {
    enable() {
      enableDesktopDebugStorage();
      if (isDesktopDebugEnabled()) {
        console.info('[desktop] debug enabled');
      }
    },
    disable() {
      disableDesktopDebugStorage();
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
