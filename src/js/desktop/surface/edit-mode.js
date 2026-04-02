/**
 * 编辑态 · 组件中心 · 组件增删替换 · 中心面板手势
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */

import {
  DESKTOP_WIDGET_SIZE_MAP,
  DESKTOP_WIDGET_CATALOG,
  normalizeWidgetSize,
  normalizeWidgetAppearance,
  createWidgetInstance,
  getWidgetCatalogEntry,
  generateWidgetTitle
} from '../../widgets/catalog.js';

export const editModeMethods = {
  /* ── 编辑态进出 ── */

  async saveDesktopEditing() {
    if (this.canManageDefaultDesktopLayout) {
      const saved = await this.saveDefaultLayoutToServer();
      if (!saved) return;
    }

    await this.exitEditMode();
  },

  enterEditMode(stage = 'add') {
    this.closeDesktopContextMenu();
    this.endCenterSheetDrag(true);
    this.isEditing = true;
    this.editStage = stage === 'decorate' ? 'decorate' : 'add';
    this.widgetCenterCategory = 'all';
    this.widgetCenterSearch = '';
    this.ensureWidgetCenterSelections();
    this.syncDesktopBodyState();
  },

  async exitEditMode() {
    this.closeDesktopContextMenu();
    this.endCenterSheetDrag(true);
    this.isEditing = false;
    this.editStage = 'add';
    this.previewPlacement = null;
    this.endDrag();
    this.syncDesktopBodyState();
  },

  setEditStage(stage) {
    if (!this.isEditing) return;
    this.endCenterSheetDrag(true);
    this.editStage = stage === 'decorate' ? 'decorate' : 'add';
    this.previewPlacement = null;
    if (this.editStage === 'add') {
      this.ensureWidgetCenterSelections();
    }
    this.syncDesktopBodyState();
  },

  /* ── 中心面板下拉手势 ── */

  getCenterSheetDampedOffset(delta) {
    if (delta <= 0) return 0;
    if (delta <= 108) return delta * 0.66;
    return Math.min(236, 71 + Math.pow(delta - 108, 0.9) * 6.2);
  },

  beginCenterSheetDrag(event) {
    if (!this.showWidgetCenter) return;
    if (this.centerSheetDrag.active) return;

    const isMouseEvent = event.type === 'mousedown';
    if (isMouseEvent && event.button !== 0) return;

    this.centerSheetDrag = {
      active: true,
      source: isMouseEvent ? 'mouse' : 'pointer',
      pointerId: event.pointerId ?? null,
      startY: event.clientY,
      currentY: event.clientY,
      rawOffsetY: 0,
      offsetY: 0
    };

    if (!isMouseEvent && event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore pointer capture failures and fall back to document listeners.
      }
    }

    this.centerSheetMoveHandler = (moveEvent) => this.onCenterSheetDragMove(moveEvent);
    this.centerSheetEndHandler = () => this.onCenterSheetDragEnd();

    document.addEventListener('mousemove', this.centerSheetMoveHandler);
    document.addEventListener('mouseup', this.centerSheetEndHandler);
    document.addEventListener('pointermove', this.centerSheetMoveHandler);
    document.addEventListener('pointerup', this.centerSheetEndHandler);
    document.addEventListener('pointercancel', this.centerSheetEndHandler);
  },

  onCenterSheetDragMove(event) {
    if (!this.centerSheetDrag.active) return;
    if (this.centerSheetDrag.source === 'pointer'
      && this.centerSheetDrag.pointerId !== null
      && event.pointerId !== undefined
      && event.pointerId !== this.centerSheetDrag.pointerId) return;
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const delta = Math.max(0, event.clientY - this.centerSheetDrag.startY);
    this.centerSheetDrag.currentY = event.clientY;
    this.centerSheetDrag.rawOffsetY = delta;
    this.centerSheetDrag.offsetY = this.getCenterSheetDampedOffset(delta);
  },

  onCenterSheetDragEnd() {
    if (!this.centerSheetDrag.active) return;

    const shouldClose = this.centerSheetDrag.rawOffsetY >= 144 || this.centerSheetDrag.offsetY >= 104;
    if (shouldClose) {
      this.setEditStage('decorate');
      return;
    }

    this.endCenterSheetDrag(true);
  },

  endCenterSheetDrag(resetOffset = false) {
    if (this.centerSheetMoveHandler) {
      document.removeEventListener('mousemove', this.centerSheetMoveHandler);
      document.removeEventListener('pointermove', this.centerSheetMoveHandler);
      this.centerSheetMoveHandler = null;
    }

    if (this.centerSheetEndHandler) {
      document.removeEventListener('mouseup', this.centerSheetEndHandler);
      document.removeEventListener('pointerup', this.centerSheetEndHandler);
      document.removeEventListener('pointercancel', this.centerSheetEndHandler);
      this.centerSheetEndHandler = null;
    }

    this.centerSheetDrag = {
      active: false,
      source: '',
      pointerId: null,
      startY: 0,
      currentY: 0,
      rawOffsetY: resetOffset ? 0 : this.centerSheetDrag.rawOffsetY,
      offsetY: resetOffset ? 0 : this.centerSheetDrag.offsetY
    };
  },

  /* ── 组件中心 ── */

  setWidgetCenterCategory(categoryId) {
    this.widgetCenterCategory = categoryId;
  },

  sizeLabel(size) {
    if (size === 'small') return '小';
    if (size === 'large') return '大';
    return '中';
  },

  catalogStatusText(entry) {
    if (this.isWidgetTypeVisible(entry.widget)) {
      return '已在桌面，可直接替换。';
    }

    return entry.description || (entry.category === 'plugin' ? '来自插件' : '可添加到桌面');
  },

  buildPreviewWidget(entry, size = entry.size, appearance = 'follow') {
    return createWidgetInstance(entry.widget, {
      key: `preview-${entry.widget}`,
      title: entry.title,
      size,
      appearance
    });
  },

  widgetVariantSizes(entry) {
    return entry.sizes || [entry.size || 'medium'];
  },

  ensureWidgetCenterSelections() {
    this.widgetCatalog.forEach((entry) => {
      const replaceTarget = this.findReplaceTarget(entry.widget);
      const current = this.widgetCenterSelections[entry.widget];
      this.widgetCenterSelections[entry.widget] = {
        size: normalizeWidgetSize(
          current?.size
          || replaceTarget?.size
          || entry.size
          || this.widgetVariantSizes(entry)[0]
          || 'medium'
        ),
        appearance: normalizeWidgetAppearance(
          current?.appearance
          || replaceTarget?.appearance
          || 'follow'
        )
      };
    });
  },

  selectedWidgetVariantSize(entry) {
    return normalizeWidgetSize(
      this.widgetCenterSelections[entry.widget]?.size
      || this.findReplaceTarget(entry.widget)?.size
      || entry.size
      || this.widgetVariantSizes(entry)[0]
      || 'medium'
    );
  },

  selectedWidgetVariantAppearance(entry) {
    return normalizeWidgetAppearance(
      this.widgetCenterSelections[entry.widget]?.appearance
      || this.findReplaceTarget(entry.widget)?.appearance
      || 'follow'
    );
  },

  selectWidgetVariant(widgetType, size) {
    const current = this.widgetCenterSelections[widgetType] || {};
    this.widgetCenterSelections[widgetType] = {
      size: normalizeWidgetSize(size),
      appearance: normalizeWidgetAppearance(current.appearance)
    };
  },

  selectWidgetAppearance(widgetType, appearance) {
    const current = this.widgetCenterSelections[widgetType] || {};
    this.widgetCenterSelections[widgetType] = {
      size: normalizeWidgetSize(current.size),
      appearance: normalizeWidgetAppearance(appearance)
    };
  },

  isWidgetVariantSelected(entry, size) {
    return this.selectedWidgetVariantSize(entry) === normalizeWidgetSize(size);
  },

  isWidgetAppearanceSelected(entry, appearance) {
    return this.selectedWidgetVariantAppearance(entry) === normalizeWidgetAppearance(appearance);
  },

  widgetAppearanceLabel(appearance) {
    if (appearance === 'light') return '浅色';
    if (appearance === 'dark') return '深色';
    return '跟随';
  },

  selectedWidgetVariant(entry) {
    return this.buildPreviewWidget(
      entry,
      this.selectedWidgetVariantSize(entry),
      this.selectedWidgetVariantAppearance(entry)
    );
  },




  selectedWidgetVariantStyle(entry) {
    return this.getVariantPreviewStyle(entry, this.selectedWidgetVariantSize(entry));
  },

  getVariantPreviewStyle(entry, size) {
    const span = entry.sizeOverrides?.[size] || DESKTOP_WIDGET_SIZE_MAP[size] || { w: 4, h: 2 };
    const cell = this.cellSize;
    const g = this.gap;
    const w = span.w * cell + (span.w - 1) * g;
    const h = span.h * cell + (span.h - 1) * g;
    return `--desktop-widget-preview-width: ${w}px; --desktop-widget-preview-height: ${h}px;`;
  },

  /* ── 组件 CRUD ── */

  countVisibleWidgetsByType(widgetType) {
    return this.widgets.filter((widget) => widget.widget === widgetType && !widget.hidden).length;
  },

  isWidgetTypeVisible(widgetType) {
    return this.countVisibleWidgetsByType(widgetType) > 0;
  },

  hasReplaceTarget(widgetType) {
    return !!this.findReplaceTarget(widgetType);
  },

  widgetCenterCategoryLabel() {
    return this.widgetCenterCategories.find((item) => item.id === this.widgetCenterCategory)?.label || '全部';
  },

  widgetCenterResultText() {
    const count = this.filteredWidgetCatalog.length;
    return `${count} 项`;
  },

  findReplaceTarget(widgetType) {
    return [...this.widgets].reverse().find((widget) => widget.widget === widgetType && !widget.hidden) || null;
  },

  normalizeSingleInstanceTypes() {
    const chosenByType = new Map();

    for (let index = this.widgets.length - 1; index >= 0; index -= 1) {
      const widget = this.widgets[index];
      const current = chosenByType.get(widget.widget);

      if (!current) {
        chosenByType.set(widget.widget, { index, widget });
        continue;
      }

      if (current.widget.hidden && !widget.hidden) {
        chosenByType.set(widget.widget, { index, widget });
      }
    }

    const keepIndexes = new Set([...chosenByType.values()].map((entry) => entry.index));
    const normalized = this.widgets.filter((_, index) => keepIndexes.has(index));
    const changed = normalized.length !== this.widgets.length;

    if (changed) {
      this.widgets = normalized;
    }

    return changed;
  },

  async resetLayout() {
    /* 清空所有组件和图标，向后端发送空 JSON，恢复到初始空白状态 */
    this.widgets.forEach((w) => { w.hidden = true; });
    this.previewPlacement = null;
    this.invalidateWidgetCache();
    this.syncGridMetrics();

    /* 保存空配置到服务器 */
    if (this.canManageDefaultDesktopLayout) {
      await this.saveLayoutJsonToServer('{}');
    }
  },

  async addWidgetFromCatalog(widgetType, size = null) {
    if (this.isWidgetTypeVisible(widgetType)) {
      return;
    }

    const selection = this.widgetCenterSelections[widgetType] || {};
    const nextSize = normalizeWidgetSize(size || getWidgetCatalogEntry(widgetType)?.size || 'medium');
    const nextAppearance = normalizeWidgetAppearance(selection.appearance || 'follow');
    let candidate = this.widgets.find((widget) => widget.widget === widgetType && widget.hidden);

    if (candidate) {
      candidate.hidden = false;
    } else {
      candidate = createWidgetInstance(widgetType, {
        title: generateWidgetTitle(widgetType),
        size: nextSize,
        appearance: nextAppearance
      });
      this.widgets.push(candidate);
    }

    if (candidate.size !== nextSize) {
      const catalogEntry = DESKTOP_WIDGET_CATALOG[candidate.widget] || {};
      const span = catalogEntry.sizeOverrides?.[nextSize] || DESKTOP_WIDGET_SIZE_MAP[nextSize];
      candidate.size = nextSize;
      candidate.w = span.w;
      candidate.h = span.h;
    }

    candidate.appearance = nextAppearance;

    const placement = this.findNearestAvailablePlacement(candidate, candidate.x, candidate.y, candidate.key);
    candidate.x = placement.x;
    candidate.y = placement.y;
    candidate.baseX = placement.x;
    candidate.baseY = placement.y;
    candidate.w = placement.w;
    candidate.h = placement.h;

    if (widgetType === 'system.weather') {
      this.loadWeather();
    }

    this.normalizeSingleInstanceTypes();
    this.invalidateWidgetCache();
    this.syncResponsiveVisibility();
  },

  async replaceWidgetFromCatalog(widgetType, size = null) {
    const target = this.findReplaceTarget(widgetType);
    if (!target) {
      await this.addWidgetFromCatalog(widgetType, size);
      return;
    }

    const selection = this.widgetCenterSelections[widgetType] || {};
    const nextSize = normalizeWidgetSize(size || getWidgetCatalogEntry(widgetType)?.size || target.size || 'medium');
    const nextAppearance = normalizeWidgetAppearance(selection.appearance || target.appearance || 'follow');
    const catalogEntry = DESKTOP_WIDGET_CATALOG[widgetType] || {};
    const span = catalogEntry.sizeOverrides?.[nextSize] || DESKTOP_WIDGET_SIZE_MAP[nextSize];
    target.size = nextSize;
    target.appearance = nextAppearance;
    target.w = span.w;
    target.h = span.h;

    const desiredPlacement = this.clampPlacement(target, target.x, target.y);
    const placements = this.resolvePlacementsForDrop(target.key, desiredPlacement);
    this.applyResolvedPlacements(placements);
    this.syncBasePlacements(placements);
    this.normalizeSingleInstanceTypes();
    this.invalidateWidgetCache();
    this.syncResponsiveVisibility();

    if (widgetType === 'system.weather') {
      this.loadWeather();
    }
  },

  async hideWidget(key) {
    const widget = this.widgets.find((entry) => entry.key === key);
    if (!widget) return;

    widget.hidden = true;
    if (this.dragState.key === key) {
      this.endDrag();
    }
    this.syncResponsiveVisibility();
  }
};
