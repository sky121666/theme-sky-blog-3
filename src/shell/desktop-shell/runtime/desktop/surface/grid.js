/**
 * 桌面网格度量 · 可见性同步 · 布局归一化
 *
 * 核心算法: 桌面图标左锚定 + 组件组右锚定平移 + 碰撞解析
 *   - 图标保持左侧网格列，避免跨浏览器加载时坍缩为单列
 *   - 组件组作为整体平移，保持彼此间距不变
 *   - offset = curCols - savedCols
 *   - 只在组件被挤出左边界或宽度超限时才触发碰撞解析
 *   - 宽屏 (curCols >= savedCols) 直接还原原坐标
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */

import { desktopDebug } from '../../widgets/debug.js';
import { computeDefaultDesktopIconPlacement } from '../../icons/index.js';

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

export const gridMethods = {
  isWidgetWithinVisibleArea(widget) {
    return widget.y + widget.h - 1 <= this.maxVisibleRows;
  },

  isResponsiveVisible(node) {
    return this.visibleDesktopNodeKeys.includes(node.key);
  },

  syncResponsiveVisibility() {
    this.visibleDesktopNodeKeys = this.placedDesktopNodes
      .filter((node) => this.isNodeWithinVisibleArea(node))
      .map((node) => node.key);
    const signature = this.visibleDesktopNodeKeys.join('|');
    if (signature !== this.lastVisibleNodeSignature) {
      this.lastVisibleNodeSignature = signature;
      desktopDebug('responsive desktop visibility updated', {
        visibleCount: this.visibleDesktopNodeKeys.length,
        visibleKeys: this.visibleDesktopNodeKeys
      });
    }
  },

  isNodeWithinVisibleArea(node) {
    if (node.kind === 'widget' && node.hidden) return false;
    return node.y + node.h - 1 <= this.maxVisibleRows;
  },

  syncGridMetrics(options = {}) {
    const { deferVisibility = false } = options;
    const shellWidth = this.$refs.gridShell?.clientWidth || window.innerWidth;
    if (shellWidth <= 640) {
      this.cellSize = 64;
    } else if (shellWidth <= 820) {
      this.cellSize = 60;
    } else {
      this.cellSize = 68;
    }
    this.syncViewportState(shellWidth);
    const shellHeight = this.$refs.layer?.clientHeight || window.innerHeight;
    const shellStyle = this.$refs.gridShell ? window.getComputedStyle(this.$refs.gridShell) : null;
    const topInset = shellStyle ? parseFloat(shellStyle.paddingTop || '0') : 0;
    this.gridTopOffset = topInset;
    const usableHeight = Math.max(this.cellSize, shellHeight - topInset);
    const fitColumns = Math.max(4, Math.floor((shellWidth + this.gap) / (this.cellSize + this.gap)));
    this.currentColumns = fitColumns;
    this.maxVisibleRows = Math.max(1, Math.floor((usableHeight + this.gap) / (this.cellSize + this.gap)));
    this.normalizeVisibleLayout();
    this.gridWidth = this.measureGridWidth();
    if (this.previewPlacement) {
      this.previewPlacement = this.findNearestAvailablePlacement(
        this.previewPlacement,
        this.previewPlacement.x,
        this.previewPlacement.y,
        this.dragState.key || ''
      );
    }

    if (this.resizeVisibilityTimer) {
      window.clearTimeout(this.resizeVisibilityTimer);
      this.resizeVisibilityTimer = null;
    }

    if (deferVisibility) {
      this.resizeVisibilityTimer = window.setTimeout(() => {
        this.resizeVisibilityTimer = null;
        this.syncResponsiveVisibility();
      }, 180);
      return;
    }

    this.syncResponsiveVisibility();
  },

  /**
   * 组右锚定平移 + 碰撞解析
   *
   * 当屏幕缩窄时，组件整体平移 offset = curCols - savedCols。
   * 这保持了组件之间的相对位置完全不变。
   *
   * 只有在平移后组件被挤出左边界 (x < widgetMinX) 或
   * 组件宽度超过可用列数时，才通过碰撞解析重排。
   */
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

  measureGridWidth() {
    if (this.shouldSuppressWidgetsOnMobile()) {
      const maxIconColumn = this.placedIcons.reduce((max, icon) => Math.max(max, icon.x), 1);
      return maxIconColumn * this.cellSize + Math.max(0, maxIconColumn - 1) * this.gap;
    }

    return this.currentColumns * this.cellSize + (this.currentColumns - 1) * this.gap;
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
