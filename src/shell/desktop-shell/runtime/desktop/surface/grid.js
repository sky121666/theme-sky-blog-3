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
import { measureDesktopGrid, projectDesktopLayout } from './layout-projection.js';

export const gridMethods = {
  isWidgetWithinVisibleArea(widget) {
    return widget.y + widget.h - 1 <= this.maxVisibleRows;
  },

  isResponsiveVisible(node) {
    return this.visibleDesktopNodeKeys.includes(node.key);
  },

  syncResponsiveVisibility() {
    this.visibleDesktopNodeKeys = this.placedDesktopNodes
      .filter((node) => node.kind !== 'widget' || !node.hidden)
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
    return true;
  },

  syncDesktopViewportMetrics() {
    const width = this.$refs.gridShell?.clientWidth || window.innerWidth;
    const height = this.$refs.layer?.clientHeight || window.innerHeight;
    const widthChanged = width !== this.lastGridShellWidth;
    const heightChanged = height !== this.lastGridLayerHeight;
    if (!widthChanged && !heightChanged) return null;
    this.syncGridMetrics({ normalizeLayout: widthChanged, deferVisibility: true });
    return { widthChanged, heightChanged };
  },

  syncGridMetrics(options = {}) {
    const { deferVisibility = false, normalizeLayout = true } = options;
    const shellWidth = this.$refs.gridShell?.clientWidth || window.innerWidth;
    this.syncViewportState(shellWidth);
    const shellHeight = this.$refs.layer?.clientHeight || window.innerHeight;
    const shellStyle = this.$refs.gridShell ? window.getComputedStyle(this.$refs.gridShell) : null;
    const topInset = shellStyle ? parseFloat(shellStyle.paddingTop || '0') : 0;
    this.gridTopOffset = topInset;
    Object.assign(this, measureDesktopGrid({ width: shellWidth, height: shellHeight, gap: this.gap, topInset }));
    // Dock previews and height-only resizes change the viewport, not the saved placements.
    if (normalizeLayout) this.normalizeVisibleLayout();
    this.gridWidth = this.measureGridWidth();
    this.lastGridShellWidth = shellWidth;
    this.lastGridLayerHeight = shellHeight;
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

  normalizeVisibleLayout() {
    this.applyResolvedPlacements(projectDesktopLayout({
      icons: this.placedIcons,
      widgets: this.placedWidgets,
      savedColumns: this.serverLayoutPayload?.columns || this.columns || 12,
      currentColumns: this.currentColumns,
      maxVisibleRows: this.maxVisibleRows,
      suppressWidgets: this.shouldSuppressWidgetsOnMobile()
    }));
  },

  measureGridWidth() {
    if (this.shouldSuppressWidgetsOnMobile()) {
      const maxIconColumn = this.placedIcons.reduce((max, icon) => Math.max(max, icon.x), 1);
      return maxIconColumn * this.cellSize + Math.max(0, maxIconColumn - 1) * this.gap;
    }

    return this.currentColumns * this.cellSize + (this.currentColumns - 1) * this.gap;
  }
};
