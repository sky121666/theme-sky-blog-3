import { applyDockAppearance, calculateDockGeometry, readDockSettings } from './dock-geometry.js';

const DOCK_RUNTIME_SYNC_EVENT = 'theme:dock-settings-change';
const DESKTOP_RESERVE_PROPERTY = '--desktop-dock-reserve';

function pixels(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Mount one Dock and return its complete cleanup. */
export function mountDock(component) {
  const dockBar = component.$refs.dockBar;
  if (!dockBar) return;
  const el = component.$el;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const rootStyle = doc.documentElement.style;
  const previousReserve = rootStyle.getPropertyValue(DESKTOP_RESERVE_PROPERTY);
  const previousReservePriority = rootStyle.getPropertyPriority(DESKTOP_RESERVE_PROPERTY);
  const motionPreference = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  let disposed = false;
  let animationFrame = null;
  let geometryFrame = null;
  let lastPublishedReserve = null;
  let fitScale = 1;

  const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));
  const getSeparators = () => Array.from(dockBar.querySelectorAll('.dock-separator'));
  const itemSignature = () => `${getIcons().length}:${getSeparators().length}`;
  let signature = itemSignature();

  const applySettings = () => {
    const nextSettings = readDockSettings(el.dataset, { reduceMotion: motionPreference?.matches });
    applyDockAppearance(el, nextSettings);
    return nextSettings;
  };
  let settings = applySettings();

  const resetIcons = () => {
    getIcons().forEach((icon) => {
      icon.classList.add('dock-animating');
      icon.classList.remove('dock-tooltip-visible');
      icon.style.width = icon.style.height = `${settings.baseSize}px`;
      icon.style.transform = 'translateY(0px)';
      icon.style.zIndex = '';
    });
  };

  const syncGeometry = () => {
    const separatorWidths = getSeparators().map((separator) => {
      const style = win.getComputedStyle(separator);
      return pixels(style.width) + pixels(style.marginLeft) + pixels(style.marginRight);
    });
    const geometry = calculateDockGeometry(settings, {
      viewportWidth: win.innerWidth,
      iconCount: getIcons().length,
      separatorWidths,
      bottomInset: pixels(win.getComputedStyle(el).bottom, 12)
    });
    fitScale = geometry.fitScale;
    if (Number(el.style.getPropertyValue('--dock-fit-scale')) !== fitScale) {
      el.style.setProperty('--dock-fit-scale', fitScale);
    }
    const reserve = `${Math.ceil(geometry.desktopReserve)}px`;
    if (rootStyle.getPropertyValue(DESKTOP_RESERVE_PROPERTY) !== reserve) {
      rootStyle.setProperty(DESKTOP_RESERVE_PROPERTY, reserve);
    }
    lastPublishedReserve = reserve;
  };

  const queueAnimation = (callback) => {
    if (disposed) return;
    win.cancelAnimationFrame(animationFrame);
    animationFrame = win.requestAnimationFrame(() => {
      animationFrame = null;
      callback();
    });
  };

  const queueGeometry = () => {
    if (disposed || geometryFrame !== null) return;
    geometryFrame = win.requestAnimationFrame(() => {
      geometryFrame = null;
      syncGeometry();
    });
  };

  const refreshGeometry = () => {
    queueAnimation(resetIcons);
    queueGeometry();
  };

  const updateDock = (mouseX) => {
    const { baseSize, range, maxScale, maxLift, showLabels } = settings;
    let tooltipTarget = null;
    let nearestDistance = Infinity;
    const iconMeasurements = getIcons().map((icon) => {
      const rect = icon.getBoundingClientRect();
      return [icon, rect.left + rect.width / 2];
    });

    iconMeasurements.forEach(([icon, centerX]) => {
      icon.classList.remove('dock-animating', 'dock-tooltip-visible');
      const distance = Math.abs(mouseX - centerX) / fitScale;
      let scale = 1;
      if (distance < range) {
        const influence = Math.cos((distance / range) * Math.PI / 2);
        scale = 1 + (maxScale - 1) * influence * influence * influence;
      }
      const lift = (scale - 1) * maxLift / (maxScale - 1 || 1);
      icon.style.width = icon.style.height = `${baseSize * scale}px`;
      icon.style.transform = `translateY(-${lift}px)`;
      icon.style.zIndex = 10 + Math.round(scale * 10);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        tooltipTarget = icon;
      }
    });
    if (showLabels && tooltipTarget && nearestDistance < range * 0.65) {
      tooltipTarget.classList.add('dock-tooltip-visible');
    }
  };

  el.addEventListener('mousemove', (event) => {
    if (!settings.enableMagnification) return;
    queueAnimation(() => updateDock(event.clientX));
  }, { signal });

  el.addEventListener('mouseleave', () => queueAnimation(resetIcons), { signal });

  const refreshSettings = () => {
    if (disposed) return;
    settings = applySettings();
    refreshGeometry();
  };
  el.addEventListener(DOCK_RUNTIME_SYNC_EVENT, refreshSettings, { signal });
  win.addEventListener('resize', refreshGeometry, { signal });

  motionPreference?.addEventListener('change', refreshSettings, { signal });

  const observer = new win.MutationObserver(() => {
    const nextSignature = itemSignature();
    if (nextSignature === signature) return;
    signature = nextSignature;
    refreshGeometry();
  });
  observer.observe(dockBar, { childList: true, subtree: true });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    win.cancelAnimationFrame(animationFrame);
    win.cancelAnimationFrame(geometryFrame);
    controller.abort();
    observer.disconnect();
    if (lastPublishedReserve
      && rootStyle.getPropertyValue(DESKTOP_RESERVE_PROPERTY) === lastPublishedReserve) {
      if (previousReserve) {
        rootStyle.setProperty(DESKTOP_RESERVE_PROPERTY, previousReserve, previousReservePriority);
      } else {
        rootStyle.removeProperty(DESKTOP_RESERVE_PROPERTY);
      }
    }
  };

  refreshGeometry();
  return cleanup;
}
