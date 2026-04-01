/**
 * 桌面节点放置算法 · 碰撞检测 · 位置解析
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */

import { sortByDistance } from '../../widgets/weather-api.js';

export const placementMethods = {
  placementOverlaps(x, y, w, h, placement) {
    const noOverlap =
      x + w - 1 < placement.x ||
      placement.x + placement.w - 1 < x ||
      y + h - 1 < placement.y ||
      placement.y + placement.h - 1 < y;

    return !noOverlap;
  },

  placementToAbsoluteStyle(placement) {
    const width = placement.w * this.cellSize + (placement.w - 1) * this.gap;
    const height = this.isIconNode(placement)
      ? (this.cellSize + this.gap)
      : (placement.h * this.cellSize + (placement.h - 1) * this.gap);
    const left = (placement.x - 1) * (this.cellSize + this.gap);
    const top = (placement.y - 1) * (this.cellSize + this.gap);
    return `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
  },

  canPlaceWidget(x, y, w, h, excludeKey = '') {
    if (x < 1 || y < 1) return false;
    if (x + w - 1 > this.currentColumns) return false;
    return !this.placedDesktopNodes.some((node) => {
      if (node.key === excludeKey) return false;
      return this.placementOverlaps(x, y, w, h, node);
    });
  },

  maxOccupiedRow(excludeKey = '') {
    return this.placedDesktopNodes.reduce((max, node) => {
      if (node.key === excludeKey) return max;
      return Math.max(max, node.y + node.h - 1);
    }, 0);
  },

  clampPlacement(widget, preferredX, preferredY) {
    const w = widget.w;
    const h = widget.h;
    const maxX = Math.max(1, this.currentColumns - w + 1);
    const maxY = Math.max(1, this.maxVisibleRows - h + 1);
    return {
      x: Math.min(Math.max(preferredX, 1), maxX),
      y: Math.min(Math.max(preferredY, 1), maxY),
      w,
      h
    };
  },

  canPlaceInPlacements(x, y, w, h, placements, excludeKey = '') {
    if (x < 1 || y < 1) return false;
    if (x + w - 1 > this.currentColumns) return false;
    return !placements.some((placement) => {
      if (placement.key === excludeKey) return false;
      return this.placementOverlaps(x, y, w, h, placement);
    });
  },

  maxOccupiedRowInPlacements(placements, excludeKey = '') {
    return placements.reduce((max, placement) => {
      if (placement.key === excludeKey) return max;
      return Math.max(max, placement.y + placement.h - 1);
    }, 0);
  },

  /**
   * 在已有 placements 集合中，从 (preferredX, preferredY) 开始搜索最近可用位置。
   * @param {number} minX  X 搜索下界（用于约束组件不侵入图标区），默认 1
   */
  findNearestAvailablePlacementInPlacements(widget, preferredX, preferredY, placements, excludeKey = '', minX = 1) {
    const w = widget.w;
    const h = widget.h;
    const maxX = Math.max(minX, this.currentColumns - w + 1);
    if (maxX < minX) {
      // 组件比可用区域还宽，放弃 minX 约束回退到全宽
      return this._findPlacementUnconstrained(widget, preferredX, preferredY, placements, excludeKey);
    }
    const startX = Math.min(Math.max(preferredX, minX), maxX);
    const startY = Math.max(preferredY, 1);
    const xCandidates = sortByDistance(Array.from({ length: maxX - minX + 1 }, (_, index) => index + minX), startX);
    const maxRow = Math.max(this.maxOccupiedRowInPlacements(placements, excludeKey) + 12, startY + 12);

    for (let y = startY; y <= maxRow; y += 1) {
      for (const x of xCandidates) {
        if (this.canPlaceInPlacements(x, y, w, h, placements, excludeKey)) {
          return { x, y, w, h };
        }
      }
    }

    return { x: minX, y: maxRow + 1, w, h };
  },

  /** minX 约束失败时的无约束回退 */
  _findPlacementUnconstrained(widget, preferredX, preferredY, placements, excludeKey) {
    const w = widget.w;
    const h = widget.h;
    const maxX = Math.max(1, this.currentColumns - w + 1);
    const startX = Math.min(Math.max(preferredX, 1), maxX);
    const startY = Math.max(preferredY, 1);
    const xCandidates = sortByDistance(Array.from({ length: maxX }, (_, index) => index + 1), startX);
    const maxRow = Math.max(this.maxOccupiedRowInPlacements(placements, excludeKey) + 12, startY + 12);

    for (let y = startY; y <= maxRow; y += 1) {
      for (const x of xCandidates) {
        if (this.canPlaceInPlacements(x, y, w, h, placements, excludeKey)) {
          return { x, y, w, h };
        }
      }
    }

    return { x: 1, y: maxRow + 1, w, h };
  },

  findNearestAvailablePlacement(widget, preferredX, preferredY, excludeKey = '') {
    const w = widget.w;
    const h = widget.h;
    const maxX = Math.max(1, this.currentColumns - w + 1);
    const startX = Math.min(Math.max(preferredX, 1), maxX);
    const startY = Math.max(preferredY, 1);
    const xCandidates = sortByDistance(Array.from({ length: maxX }, (_, index) => index + 1), startX);
    const maxRow = Math.max(this.maxOccupiedRow(excludeKey) + 12, startY + 12);

    for (let y = startY; y <= maxRow; y += 1) {
      for (const x of xCandidates) {
        if (this.canPlaceWidget(x, y, w, h, excludeKey)) {
          return { x, y, w, h };
        }
      }
    }

    return { x: 1, y: maxRow + 1, w, h };
  },

  resolvePlacementsForDrop(dragKey, desiredPlacement) {
    const placed = [{ key: dragKey, ...desiredPlacement }];
    const visible = this.placedDesktopNodes
      .filter((node) => node.key !== dragKey)
      .sort((left, right) => {
        if (left.y === right.y) return left.x - right.x;
        return left.y - right.y;
      });

    visible.forEach((node) => {
      const placement = this.findNearestAvailablePlacementInPlacements(node, node.x, node.y, placed, node.key);
      placed.push({ key: node.key, ...placement });
    });

    return placed;
  },

  applyResolvedPlacements(placements) {
    const placementMap = new Map(placements.map((placement) => [placement.key, placement]));
    [...this.widgets, ...this.icons].forEach((node) => {
      const placement = placementMap.get(node.key);
      if (!placement) return;
      node.x = placement.x;
      node.y = placement.y;
      node.w = placement.w;
      node.h = placement.h;
    });
  },

  syncBasePlacements(placements) {
    const placementMap = new Map(placements.map((placement) => [placement.key, placement]));
    [...this.widgets, ...this.icons].forEach((node) => {
      const placement = placementMap.get(node.key);
      if (!placement) return;
      node.baseX = placement.x;
      node.baseY = placement.y;
    });
  }
};
