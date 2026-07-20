export const DESKTOP_ICON_NODE_SPAN = {
  w: 1,
  h: 1
};

const SAFE_DESKTOP_ICON_PROTOCOLS = new Set(['http:', 'https:']);

function resolveDesktopIconBaseOrigin(baseOrigin = '') {
  const fallback = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://theme.local';

  try {
    return new URL(baseOrigin || fallback).origin;
  } catch (_error) {
    return fallback;
  }
}

/**
 * Desktop icons are persisted and rendered as anchors, so only web URLs are
 * accepted. Same-origin values are reduced to a path to avoid pinning a saved
 * layout to the current domain.
 */
export function normalizeDesktopIconHref(value, baseOrigin = '') {
  const raw = String(value || '').trim();
  const origin = resolveDesktopIconBaseOrigin(baseOrigin);

  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) {
    return { valid: false, href: '#', external: false, pjax: false };
  }

  if (raw === '#') {
    return { valid: true, href: '#', external: false, pjax: false };
  }

  try {
    const url = new URL(raw, `${origin}/`);
    if (!SAFE_DESKTOP_ICON_PROTOCOLS.has(url.protocol)) {
      return { valid: false, href: '#', external: false, pjax: false };
    }

    const external = url.origin !== origin;
    return {
      valid: true,
      href: external ? url.href : `${url.pathname}${url.search}${url.hash}`,
      external,
      pjax: !external
    };
  } catch (_error) {
    return { valid: false, href: '#', external: false, pjax: false };
  }
}

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
  const link = normalizeDesktopIconHref(icon.href);
  return {
    key: icon.key,
    title: icon.title,
    href: link.href,
    pjax: link.pjax && icon.pjax !== false,
    pjaxApp: icon.pjaxApp || '',
    external: link.external,
    subtype: icon.subtype || 'folder',
    dataId: icon.dataId || icon.key,
    x: icon.baseX ?? icon.x,
    y: icon.baseY ?? icon.y
  };
}

export function serializeDeletedIconTombstone(key) {
  return { key, deleted: true };
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
  return bootstrap.map((icon, index) => {
    const link = normalizeDesktopIconHref(icon?.href || '#');
    return {
      ...normalizeDesktopIconBootstrap(icon, index),
      href: link.href,
      pjax: link.pjax && icon?.pjax !== false,
      pjaxApp: typeof icon?.pjaxApp === 'string' ? icon.pjaxApp : '',
      external: link.external,
      subtype: normalizeDesktopIconType(icon?.subtype || icon?.type),
      dataId: icon?.dataId || icon?.title || icon?.name || `icon-${index + 1}`
    };
  });
}

/**
 * 合并桌面图标布局。
 *
 * 支持三种模式：
 *  1. 无 savedLayout → 直接返回 defaultIcons（后端定义）
 *  2. savedLayout.hasFullIconDefs = true → 以 serverLayout.icons 为完整来源（前端自管理）
 *     - 图标定义含 href/title/subtype 等全部字段
 *     - 支持 { key, deleted: true } tombstone：彻底阻止图标复活
 *  3. 普通旧格式（仅含位置）→ 以 defaultIcons 为基础，位置由 serverLayout 覆盖
 *     - 同样支持 tombstone
 *
 * @param {Array}  defaultIcons     后端注入的图标定义（首次默认值）
 * @param {object} savedLayout      从 serverLayout JSON 解析的布局对象
 * @param {Array}  resolvedWidgets  已放置的 widget 用于占格检测
 * @param {number} maxVisibleRows   实际视口可见行数（由调用方传入）
 */
export function mergeDesktopIconLayout(defaultIcons, savedLayout, resolvedWidgets = [], maxVisibleRows = 8) {
  if (!savedLayout || !Array.isArray(savedLayout.icons)) {
    return defaultIcons;
  }

  // ── 模式 2：前端完全自管理（hasFullIconDefs = true）──
  if (savedLayout.hasFullIconDefs) {
    const validIcons = savedLayout.icons.filter((icon) => icon && icon.key && !icon.deleted);
    return validIcons.map((icon, index) => {
      const fallback = computeDefaultDesktopIconPlacement(index, 12, Math.max(4, maxVisibleRows));
      const link = normalizeDesktopIconHref(icon.href || '#');
      return {
        key: icon.key,
        kind: 'icon',
        title: icon.title || '',
        href: link.href,
        pjax: link.pjax && icon.pjax !== false,
        pjaxApp: typeof icon.pjaxApp === 'string' ? icon.pjaxApp : '',
        external: link.external,
        subtype: normalizeDesktopIconType(icon.subtype || 'folder'),
        dataId: icon.dataId || icon.key,
        x: toPositiveInt(icon.x ?? icon.baseX, fallback.x),
        y: toPositiveInt(icon.y ?? icon.baseY, fallback.y),
        baseX: toPositiveInt(icon.baseX ?? icon.x, fallback.x),
        baseY: toPositiveInt(icon.baseY ?? icon.y, fallback.y),
        w: DESKTOP_ICON_NODE_SPAN.w,
        h: DESKTOP_ICON_NODE_SPAN.h
      };
    });
  }

  // ── 模式 3：旧格式（位置覆盖 + tombstone）──
  const savedMap = new Map(
    savedLayout.icons
      .filter((icon) => icon && icon.key)
      .map((icon) => [icon.key, icon])
  );

  // 收集 tombstone key：被标记为 deleted 的图标不再出现
  const tombstoneKeys = new Set(
    savedLayout.icons
      .filter((icon) => icon && icon.key && icon.deleted === true)
      .map((icon) => icon.key)
  );

  // Collect all occupied cells from saved (non-deleted) icons
  const occupiedCells = new Set();
  for (const saved of savedMap.values()) {
    if (saved.deleted) continue;
    const sx = toPositiveInt(saved.x ?? saved.baseX, 0);
    const sy = toPositiveInt(saved.y ?? saved.baseY, 0);
    if (sx > 0 && sy > 0) occupiedCells.add(`${sx},${sy}`);
  }

  // Also mark cells occupied by widgets (use resolved widgets with actual w/h)
  for (const widget of resolvedWidgets) {
    const wx = toPositiveInt(widget.x, 0);
    const wy = toPositiveInt(widget.y, 0);
    const ww = toPositiveInt(widget.w, 1);
    const wh = toPositiveInt(widget.h, 1);
    if (wx > 0 && wy > 0) {
      for (let dx = 0; dx < ww; dx++) {
        for (let dy = 0; dy < wh; dy++) {
          occupiedCells.add(`${wx + dx},${wy + dy}`);
        }
      }
    }
  }

  // Find next free cell (column-major: top-to-bottom, then left-to-right)
  // maxVisibleRows is now passed from the caller's actual viewport state
  const safeMaxRows = Math.max(4, maxVisibleRows);
  function findFreeCell() {
    for (let col = 1; col <= 100; col++) {
      for (let row = 1; row <= safeMaxRows; row++) {
        const key = `${col},${row}`;
        if (!occupiedCells.has(key)) {
          occupiedCells.add(key);
          return { x: col, y: row };
        }
      }
    }
    const fallbackX = occupiedCells.size + 1;
    return { x: fallbackX, y: 1 };
  }

  // Filter tombstoned icons before mapping
  return defaultIcons
    .filter((icon) => !tombstoneKeys.has(icon.key))
    .map((icon) => {
      const saved = savedMap.get(icon.key);
      if (saved && !saved.deleted) {
        const normalized = normalizeDesktopIconInstance(saved, icon);
        return {
          ...icon,
          x: normalized.x,
          y: normalized.y,
          baseX: normalized.baseX,
          baseY: normalized.baseY
        };
      }

      // New icon not in saved layout → place in first available slot
      const freePos = findFreeCell();
      return {
        ...icon,
        x: freePos.x,
        y: freePos.y,
        baseX: freePos.x,
        baseY: freePos.y
      };
    });
}
