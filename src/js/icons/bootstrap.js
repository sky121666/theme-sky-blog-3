export const DESKTOP_ICON_NODE_SPAN = {
  w: 1,
  h: 1
};

function toPositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeDesktopIconInstance(instance, fallback = {}) {
  return {
    key: instance?.key || fallback.key || `icon-${Date.now()}`,
    kind: 'icon',
    title: instance?.title || fallback.title || '',
    x: toPositiveInt(instance?.x ?? instance?.baseX, fallback.x || 1),
    y: toPositiveInt(instance?.y ?? instance?.baseY, fallback.y || 1),
    baseX: toPositiveInt(instance?.baseX ?? instance?.x, fallback.baseX ?? fallback.x ?? 1),
    baseY: toPositiveInt(instance?.baseY ?? instance?.y, fallback.baseY ?? fallback.y ?? 1),
    w: DESKTOP_ICON_NODE_SPAN.w,
    h: DESKTOP_ICON_NODE_SPAN.h
  };
}

export function serializeDesktopIconInstance(icon) {
  return {
    key: icon.key,
    title: icon.title,
    x: icon.baseX ?? icon.x,
    y: icon.baseY ?? icon.y
  };
}

export function normalizeDesktopIconType(type) {
  return ['folder', 'document', 'link'].includes(type) ? type : 'folder';
}

export function normalizeDesktopIconBootstrap(icon, index = 0) {
  const title = icon?.title || icon?.name || `桌面图标 ${index + 1}`;
  return {
    key: icon?.key || `icon-${index + 1}`,
    title,
    x: Number.isFinite(Number(icon?.x)) ? toPositiveInt(icon?.x, 1) : null,
    y: Number.isFinite(Number(icon?.y)) ? toPositiveInt(icon?.y, 1) : null
  };
}

/**
 * 默认图标排列：从左上角开始，从上到下、再从左到右。
 * x=1 永远是最左列，在任何分辨率下都兼容。
 */
export function computeDefaultDesktopIconPlacement(index, columns, maxVisibleRows) {
  const span = DESKTOP_ICON_NODE_SPAN;
  const safeRows = Math.max(span.h, maxVisibleRows);
  const iconsPerColumn = Math.max(1, Math.floor(safeRows / span.h));
  const columnIndex = Math.floor(index / iconsPerColumn);
  const rowIndex = index % iconsPerColumn;

  return {
    x: (columnIndex * span.w) + 1,
    y: (rowIndex * span.h) + 1
  };
}

export function readDesktopIconsBootstrap() {
  const bootstrap = window.__THEME_DESKTOP_PROTOCOL__?.icons || window.__THEME_DESKTOP_ICONS__;
  if (!Array.isArray(bootstrap)) return [];
  return bootstrap.map((icon, index) => ({
    ...normalizeDesktopIconBootstrap(icon, index),
    href: icon?.href || '#',
    pjax: icon?.pjax !== false,
    pjaxApp: typeof icon?.pjaxApp === 'string' ? icon.pjaxApp : '',
    external: icon?.external === true,
    subtype: normalizeDesktopIconType(icon?.subtype || icon?.type),
    dataId: icon?.dataId || icon?.title || icon?.name || `icon-${index + 1}`
  }));
}

export function mergeDesktopIconLayout(defaultIcons, savedLayout) {
  if (!savedLayout || !Array.isArray(savedLayout.icons)) {
    return defaultIcons;
  }

  const savedMap = new Map(
    savedLayout.icons
      .filter((icon) => icon && icon.key)
      .map((icon) => [icon.key, icon])
  );

  return defaultIcons.map((icon) => {
    const saved = savedMap.get(icon.key);
    if (!saved) return icon;
    const normalized = normalizeDesktopIconInstance(saved, icon);
    return {
      ...icon,
      x: normalized.x,
      y: normalized.y,
      baseX: normalized.baseX,
      baseY: normalized.baseY
    };
  });
}
