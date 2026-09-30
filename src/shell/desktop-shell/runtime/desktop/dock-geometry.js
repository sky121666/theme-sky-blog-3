/** Shared Dock settings and geometry, independent of animated element sizes. */

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function settingNumber(value, fallback, minimum, maximum, integer = true) {
  const parsed = integer ? Number.parseInt(value, 10) : Number.parseFloat(value);
  return clamp(Number.isFinite(parsed) && parsed !== 0 ? parsed : fallback, minimum, maximum);
}

export function readDockSettings(dataset = {}, { reduceMotion = false } = {}) {
  const ds = dataset || {};
  const enableMagnification = ds.magnification !== 'false' && !reduceMotion;
  const baseSize = settingNumber(ds.dockIconSize, 48, 36, 64);
  const iconGap = settingNumber(ds.dockIconGap, 4, 2, 12);
  const dockPadding = settingNumber(ds.dockPadding, 6, 4, 16);
  const magScale = settingNumber(ds.dockMagScale, 1.4, 1, 2, false);
  const glassBlur = settingNumber(ds.dockGlassBlur, 60, 20, 100);
  const glassOpacity = settingNumber(ds.dockGlassOpacity, 28, 10, 80);
  const maxSize = enableMagnification ? Math.round(baseSize * magScale) : baseSize;
  const maxLift = maxSize > baseSize ? Math.round(baseSize * 0.10) : 0;
  const glassHeight = baseSize + dockPadding * 2;

  return {
    enableMagnification,
    showLabels: ds.showLabels === 'true',
    baseSize,
    iconGap,
    dockPadding,
    glassBlur,
    glassOpacity,
    range: Math.round(baseSize * 2.9),
    maxLift,
    maxScale: maxSize / baseSize,
    glassHeight,
    barHeight: glassHeight + (enableMagnification ? Math.max(14, maxLift + 8) : 0)
  };
}

export function calculateDockGeometry(settings, {
  viewportWidth,
  iconCount,
  separatorWidths = [],
  bottomInset = 12
} = {}) {
  // Settings have already been normalized by readDockSettings.
  const { baseSize, iconGap, dockPadding, maxScale, maxLift, glassHeight } = settings;
  const count = Math.max(0, Math.floor(finiteNumber(iconCount, 0)));
  const widths = Array.isArray(separatorWidths)
    ? separatorWidths.map((width) => Math.max(0, finiteNumber(width, 0)))
    : [];
  const itemCount = count + widths.length;
  const naturalWidth = count * baseSize + widths.reduce((sum, width) => sum + width, 0)
    + iconGap * Math.max(0, itemCount - 1) + 2 * dockPadding;
  const magnificationHeadroom = settings.enableMagnification
    ? baseSize * (maxScale - 1) * 2 + 16
    : 0;
  const availableWidth = Math.max(1, finiteNumber(viewportWidth, 0) - 16);
  const fitScale = Math.min(1, availableWidth / (naturalWidth + magnificationHeadroom));
  const overhang = maxScale > 1
    ? Math.max(0, Math.round(baseSize * maxScale) + maxLift - baseSize - dockPadding)
    : 0;
  const desktopReserve = Math.max(0, finiteNumber(bottomInset, 12))
    + fitScale * glassHeight + Math.max(24, fitScale * overhang + 8);

  return { naturalWidth, fitScale, desktopReserve };
}

export function applyDockAppearance(element, settings) {
  element.style.setProperty('--dock-icon-size', `${settings.baseSize}px`);
  element.style.setProperty('--dock-gap', `${settings.iconGap}px`);
  element.style.setProperty('--dock-padding', `${settings.dockPadding}px`);
  element.style.setProperty('--dock-glass-height', `${settings.glassHeight}px`);
  element.style.setProperty('--dock-bar-height', `${settings.barHeight}px`);
  element.style.setProperty('--dock-blur', `${settings.glassBlur}px`);
  element.style.setProperty('--dock-opacity', `${settings.glassOpacity / 100}`);
  element.style.setProperty('--dock-icon-radius', `${Math.round(settings.baseSize * 0.25)}px`);
  element.querySelectorAll('.dock-tooltip').forEach((tooltip) => {
    tooltip.hidden = !settings.showLabels;
    if (settings.showLabels) tooltip.style.removeProperty('display');
  });
}
