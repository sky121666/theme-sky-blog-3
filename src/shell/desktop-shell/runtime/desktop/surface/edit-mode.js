/**
 * 编辑态 · 组件中心 · 组件增删替换 · 中心面板手势
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */

import {
  DESKTOP_WIDGET_SIZE_MAP,
  normalizeWidgetSize,
  normalizeWidgetAppearance,
  createWidgetInstance,
  getWidgetCatalogEntry,
  generateWidgetTitle
} from '../../widgets/catalog-core.js';

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
    this._widgetCenterOpenedAt = Date.now();
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
      this._widgetCenterOpenedAt = Date.now();
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

  catalogStatusText(entry) {
    const count = this.countVisibleWidgetsByType(entry.widget);
    if (count > 0) {
      return `桌面已有 ${count} 个`;
    }
    return entry.description || (entry.category === 'plugin' ? '来自插件' : '可添加到桌面');
  },

  buildPreviewWidget(entry, appearance = 'follow') {
    return createWidgetInstance(entry.widget, {
      key: `preview-${entry.catalogKey}`,
      title: entry.title,
      size: entry.size,
      appearance
    });
  },

  ensureWidgetCenterSelections() {
    this.widgetCatalog.forEach((entry) => {
      if (!this.widgetCenterSelections[entry.catalogKey]) {
        this.widgetCenterSelections[entry.catalogKey] = {
          appearance: 'follow'
        };
      }
    });
  },

  selectedCatalogAppearance(entry) {
    return normalizeWidgetAppearance(
      this.widgetCenterSelections[entry.catalogKey]?.appearance || 'follow'
    );
  },

  selectCatalogAppearance(catalogKey, appearance) {
    this.widgetCenterSelections[catalogKey] = {
      appearance: normalizeWidgetAppearance(appearance)
    };
  },

  isCatalogAppearanceSelected(entry, appearance) {
    return this.selectedCatalogAppearance(entry) === normalizeWidgetAppearance(appearance);
  },

  widgetAppearanceLabel(appearance) {
    if (appearance === 'light') return '浅色';
    if (appearance === 'dark') return '深色';
    return '跟随';
  },

  selectedWidgetVariant(entry) {
    return this.buildPreviewWidget(entry, this.selectedCatalogAppearance(entry));
  },

  selectedWidgetVariantStyle(entry) {
    return this.getVariantPreviewStyle(entry, entry.size);
  },

  widgetConfigPreviewStyle() {
    const widget = this.widgetConfigForm?.previewWidget;
    if (!widget) return '';
    const catalog = getWidgetCatalogEntry(widget.widget) || {};
    return this.getVariantPreviewStyle({
      sizeOverrides: catalog.sizeOverrides || {},
      size: widget.size
    }, widget.size);
  },

  getVariantPreviewStyle(entry, size) {
    const span = entry.sizeOverrides?.[size] || DESKTOP_WIDGET_SIZE_MAP[size] || { w: 4, h: 2 };
    const cell = this.cellSize;
    const g = this.gap;
    const w = span.w * cell + (span.w - 1) * g;
    const h = span.h * cell + (span.h - 1) * g;
    return `--desktop-widget-preview-width:${w}px;--desktop-widget-preview-height:${h}px;`;
  },

  /* ── 组件 CRUD ── */

  countVisibleWidgetsByType(widgetType) {
    return this.widgets.filter((widget) => widget.widget === widgetType && !widget.hidden).length;
  },

  widgetCenterCategoryLabel() {
    return this.widgetCenterCategories.find((item) => item.id === this.widgetCenterCategory)?.label || '全部';
  },

  widgetCenterResultText() {
    const count = this.filteredWidgetCatalog.length;
    return `${count} 项`;
  },

  resetLayout() {
    /* 清空所有组件（仅修改本地状态，需点击「保存」持久化） */
    this.widgets.forEach((w) => { w.hidden = true; });
    this.previewPlacement = null;
    this.invalidateWidgetCache();
    this.syncGridMetrics();
    this.syncWidgetRuntimes();
  },

  clearAllIcons() {
    this.icons.forEach((icon) => {
      if (!this.iconTombstones.some(i => i.key === icon.key)) {
        this.iconTombstones.push({ key: icon.key, deleted: true });
      }
    });
    this.icons = [];
    this.dragState.active = false;
    this.selectedDesktopKey = null;
    this.syncResponsiveVisibility();
  },

  async addWidgetFromCatalog(widgetType, size = null, catalogKey = null) {
    const catalogEntry = getWidgetCatalogEntry(widgetType);

    // 有配置需求的组件先弹配置弹窗
    if (catalogEntry?.hasConfig) {
      this.openWidgetConfigForm(widgetType, size, catalogKey);
      return;
    }

    await this._doAddWidget(widgetType, size, catalogKey, {});
  },

  createWidgetConfigDefaultMeta(catalogEntry) {
    const schema = Array.isArray(catalogEntry?.configSchema) ? catalogEntry.configSchema : [];
    const meta = {
      ...((catalogEntry?.configDefaults && typeof catalogEntry.configDefaults === 'object') ? catalogEntry.configDefaults : {})
    };

    schema.forEach((field) => {
      if (!field?.key || meta[field.key] !== undefined) return;
      meta[field.key] = this.resolveWidgetConfigFieldDefault(field);
    });

    return meta;
  },

  resolveWidgetConfigFieldDefault(field) {
    if (field.defaultValue !== undefined) return field.defaultValue;

    if (field.type === 'photo-group') {
      const groups = Array.isArray(this.sources?.photoGroups) ? this.sources.photoGroups : [];
      return groups[0]?.metadata?.name || '';
    }

    if (field.type === 'select') {
      const options = this.widgetConfigSelectOptions(field);
      return options[0]?.value || '';
    }

    if (field.type === 'number') {
      return Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
    }

    if (field.type === 'toggle') {
      return false;
    }

    return '';
  },

  widgetConfigSelectOptions(field) {
    const rawOptions = Array.isArray(field?.options) ? field.options : [];
    return rawOptions.map((option) => {
      if (option && typeof option === 'object') {
        return {
          value: String(option.value ?? ''),
          label: String(option.label ?? option.value ?? '')
        };
      }
      return {
        value: String(option ?? ''),
        label: String(option ?? '')
      };
    }).filter((option) => option.value);
  },

  widgetConfigPhotoGroups() {
    return Array.isArray(this.sources?.photoGroups) ? this.sources.photoGroups : [];
  },

  widgetConfigPhotoGroupCount(group) {
    const groupName = group?.metadata?.name || '';
    const photos = Array.isArray(this.sources?.photos) ? this.sources.photos : [];
    return photos.filter((photo) => photo?.spec?.groupName === groupName).length;
  },

  updateWidgetConfigMeta(key, value) {
    this.widgetConfigForm.meta = {
      ...(this.widgetConfigForm.meta || {}),
      [key]: value
    };
    this.refreshWidgetConfigPreview();
  },

  refreshWidgetConfigPreview() {
    const form = this.widgetConfigForm;
    if (!form?.open || !form.widgetType) return;
    const selection = this.widgetCenterSelections[form.catalogKey] || {};
    const appearance = normalizeWidgetAppearance(selection.appearance || 'follow');
    form.previewWidget = createWidgetInstance(form.widgetType, {
      key: `config-preview-${form.catalogKey}`,
      title: generateWidgetTitle(form.widgetType),
      size: form.size,
      appearance,
      meta: { ...(form.meta || {}) }
    });
  },

  isWidgetConfigFormValid() {
    if (!this.widgetConfigForm.open) return false;
    const schema = Array.isArray(this.widgetConfigForm.configSchema) ? this.widgetConfigForm.configSchema : [];
    const meta = this.widgetConfigForm.meta || {};

    return schema.every((field) => {
      if (!field?.required) return true;
      const value = meta[field.key];
      if (field.type === 'photo-group') {
        return this.widgetConfigPhotoGroups().length > 0 && !!value;
      }
      if (field.type === 'number') {
        return Number.isFinite(Number(value));
      }
      if (field.type === 'toggle') {
        return true;
      }
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
  },

  openWidgetConfigForm(widgetType, size, catalogKey) {
    const catalogEntry = getWidgetCatalogEntry(widgetType) || {};
    const resolvedSize = normalizeWidgetSize(size || catalogEntry.size || 'medium');
    const resolvedCatalogKey = catalogKey || `${widgetType}:${resolvedSize}`;
    this.widgetConfigForm = {
      open: true,
      widgetId: widgetType,
      widgetType,
      size: resolvedSize,
      catalogKey: resolvedCatalogKey,
      title: catalogEntry.title || generateWidgetTitle(widgetType),
      configSchema: Array.isArray(catalogEntry.configSchema) ? catalogEntry.configSchema.map((field) => ({ ...field })) : [],
      meta: this.createWidgetConfigDefaultMeta(catalogEntry),
      previewWidget: null
    };
    this.refreshWidgetConfigPreview();
  },

  closeWidgetConfigForm() {
    this.widgetConfigForm = {
      open: false,
      widgetId: '',
      widgetType: '',
      size: '',
      catalogKey: '',
      title: '',
      configSchema: [],
      meta: {},
      previewWidget: null
    };
  },

  async submitWidgetConfigForm() {
    if (!this.isWidgetConfigFormValid()) return;
    const { widgetType, size, catalogKey, meta } = this.widgetConfigForm;
    this.closeWidgetConfigForm();
    await this._doAddWidget(widgetType, size, catalogKey, { ...(meta || {}) });
  },

  async _doAddWidget(widgetType, size = null, catalogKey = null, meta = {}) {
    const selKey = catalogKey || `${widgetType}:${size || 'medium'}`;
    const selection = this.widgetCenterSelections[selKey] || {};
    const nextSize = normalizeWidgetSize(size || getWidgetCatalogEntry(widgetType)?.size || 'medium');
    const nextAppearance = normalizeWidgetAppearance(selection.appearance || 'follow');

    const candidate = createWidgetInstance(widgetType, {
      title: generateWidgetTitle(widgetType),
      size: nextSize,
      appearance: nextAppearance,
      meta
    });
    this.widgets.push(candidate);

    const placement = this.findNearestAvailablePlacement(candidate, candidate.x, candidate.y, candidate.key);
    candidate.x = placement.x;
    candidate.y = placement.y;
    candidate.baseX = placement.x;
    candidate.baseY = placement.y;
    candidate.w = placement.w;
    candidate.h = placement.h;

    if (widgetType === 'system.weather') {
      await this.loadWeather();
    }

    this.invalidateWidgetCache();
    this.syncResponsiveVisibility();
    this.syncWidgetRuntimes();
  },

  async hideWidget(key) {
    const widget = this.widgets.find((entry) => entry.key === key);
    if (!widget) return;

    widget.hidden = true;
    if (this.dragState.key === key) {
      this.endDrag();
    }
    this.syncResponsiveVisibility();
    this.syncWidgetRuntimes();
  }
};
