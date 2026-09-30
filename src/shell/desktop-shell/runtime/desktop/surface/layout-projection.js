/** Pure viewport projection shared by the parser-time surface and Alpine. */
import { computeDefaultDesktopIconPlacement, normalizeDesktopIconInstance } from '../../icons/bootstrap.js';
import { placementMethods } from './placement.js';

export function measureDesktopGrid({ width, height, gap = 18, topInset = 0 }) {
  const cellSize = width <= 640 ? 64 : width <= 820 ? 60 : 68;
  return {
    cellSize,
    currentColumns: Math.max(4, Math.floor((width + gap) / (cellSize + gap))),
    maxVisibleRows: Math.max(1, Math.floor((Math.max(cellSize, height - topInset) + gap) / (cellSize + gap)))
  };
}

function clampBasePlacement(node, columns) {
  const maxColumns = Math.max(1, Number(columns) || 1);
  const width = Math.max(1, Number(node?.w) || 1);
  const maxX = Math.max(1, maxColumns - width + 1);
  const baseX = Math.max(1, Number(node?.baseX ?? node?.x) || 1);
  const baseY = Math.max(1, Number(node?.baseY ?? node?.y) || 1);
  return {
    x: Math.min(baseX, maxX),
    y: baseY
  };
}

const projectionMethods = {
  normalizeVisibleLayout() {
    if (this.shouldSuppressWidgetsOnMobile()) {
      this._normalizeIconsOnlyLayout();
      return;
    }

    const savedCols = this.serverLayoutPayload?.columns || this.columns || 12;
    const curCols = this.currentColumns;

    /* ── 宽屏：直接还原 ── */
    if (curCols >= savedCols) {
      this._restoreBaseCoordinates();
      return;
    }

    /* ── 窄屏：平移算法 ── */
    const offset = curCols - savedCols; // 负数，向左移

    const icons = this.placedIcons.slice().sort((a, b) => {
      const ay = a.baseY ?? a.y;
      const by = b.baseY ?? b.y;
      return ay !== by ? ay - by : (a.baseX ?? a.x) - (b.baseX ?? b.x);
    });

    const widgets = this.placedWidgets.slice().sort((a, b) => {
      const ay = a.baseY ?? a.y;
      const by = b.baseY ?? b.y;
      return ay !== by ? ay - by : (a.baseX ?? a.x) - (b.baseX ?? b.x);
    });

    const hasIcons = icons.length > 0;
    const hasWidgets = widgets.length > 0;
    const shouldReserveIconRail = hasIcons && hasWidgets && curCols <= 8;
    const iconCols = shouldReserveIconRail ? 1 : 0;
    const widgetMinX = iconCols + 1;
    const widgetAvailCols = curCols - iconCols;

    const resolved = [];

    /* ── Phase 1: 图标第 1 列堆叠 ── */
    if (iconCols > 0) {
      let row = 1;
      icons.forEach((icon) => {
        resolved.push({ key: icon.key, x: 1, y: row, w: 1, h: 1 });
        row++;
      });
    }

    /* ── Phase 2: 组件平移放置 ── */
    widgets.forEach((widget) => {
      const base = clampBasePlacement(widget, savedCols);
      const baseX = base.x;
      const baseY = base.y;

      /* 宽度钳位 */
      const w = Math.min(widget.w, widgetAvailCols);
      const h = widget.h;

      /* 平移：保持组件间相对位置 */
      let targetX = baseX + offset;
      targetX = Math.max(widgetMinX, Math.min(targetX, curCols - w + 1));

      /* Y 保持原值 */
      const targetY = Math.max(1, baseY);

      /* 碰撞解析：从目标位置附近搜索 */
      const placement = this.findNearestAvailablePlacementInPlacements(
        { ...widget, w, h }, targetX, targetY, resolved, widget.key, widgetMinX
      );

      resolved.push({
        key: widget.key,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h
      });
    });

    /* ── Phase 3: 无独占列时图标按左锚定网格混排 ── */
    if (iconCols === 0 && hasIcons) {
      icons.forEach((icon) => {
        const base = clampBasePlacement(icon, savedCols);
        const baseX = base.x;
        const baseY = base.y;
        const targetX = Math.max(1, Math.min(baseX, curCols));
        const placement = this.findNearestAvailablePlacementInPlacements(
          icon, targetX, Math.max(1, baseY), resolved, icon.key
        );
        resolved.push({
          key: icon.key,
          x: placement.x,
          y: placement.y,
          w: 1,
          h: 1
        });
      });
    }

    this.applyResolvedPlacements(resolved);
  },
  _normalizeIconsOnlyLayout() {
    const icons = this.placedIcons.slice().sort((a, b) => {
      const ay = a.baseY ?? a.y;
      const by = b.baseY ?? b.y;
      return ay !== by ? ay - by : (a.baseX ?? a.x) - (b.baseX ?? b.x);
    });

    const maxRows = Math.max(1, this.maxVisibleRows);
    const resolved = icons.map((icon, index) => {
      const placement = computeDefaultDesktopIconPlacement(index, this.currentColumns, maxRows);
      return {
        key: icon.key,
        x: placement.x,
        y: placement.y,
        w: 1,
        h: 1
      };
    });

    this.applyResolvedPlacements(resolved);
  },

  /**
   * 宽屏还原
   */
  _restoreBaseCoordinates() {
    const savedCols = this.serverLayoutPayload?.columns || this.columns || this.currentColumns || 12;
    const placements = [];
    [...this.placedIcons, ...this.placedWidgets]
      .slice()
      .sort((left, right) => {
        const leftBase = clampBasePlacement(left, savedCols);
        const rightBase = clampBasePlacement(right, savedCols);
        return leftBase.y !== rightBase.y ? leftBase.y - rightBase.y : leftBase.x - rightBase.x;
      })
      .forEach((node) => {
        const base = clampBasePlacement(node, savedCols);
        const placement = this.findNearestAvailablePlacementInPlacements(
          node,
          base.x,
          base.y,
          placements,
          node.key
        );
        placements.push({
          key: node.key,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h
        });
      });
    this.applyResolvedPlacements(placements);
  }
};

export function projectDesktopLayout({ icons = [], widgets = [], savedColumns = 12, currentColumns = 12, maxVisibleRows = 1, suppressWidgets = false }) {
  let resolved = [];
  const byPosition = (a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x;
  const context = {
    ...placementMethods,
    ...projectionMethods,
    serverLayoutPayload: { columns: savedColumns },
    columns: savedColumns, currentColumns, maxVisibleRows,
    placedIcons: icons.slice().sort(byPosition),
    placedWidgets: suppressWidgets ? [] : widgets.filter((node) => !node.hidden && node.surface !== 'notification-center').sort(byPosition),
    shouldSuppressWidgetsOnMobile: () => suppressWidgets,
    applyResolvedPlacements: (placements) => { resolved = placements; }
  };
  context.normalizeVisibleLayout();
  return resolved;
}

export function desktopPlacementStyle(node, cellSize, gap) {
  return placementMethods.placementToAbsoluteStyle.call({ cellSize, gap, isIconNode: (item) => item.kind === 'icon' }, node);
}

export function createDefaultDesktopIcons(bootstrapIcons, columns, maxVisibleRows) {
  return bootstrapIcons.map((icon, index) => {
    const defaultPlacement = computeDefaultDesktopIconPlacement(index, columns, maxVisibleRows);
    const x = icon.x ?? defaultPlacement.x;
    const y = icon.y ?? defaultPlacement.y;
    return {
      ...icon,
      ...normalizeDesktopIconInstance({ ...icon, x, y, baseX: icon.baseX ?? x, baseY: icon.baseY ?? y }, { key: icon.key, title: icon.title, x, y })
    };
  });
}
