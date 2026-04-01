/**
 * 桌面拖拽引擎 · Widget / Icon 拖拽 · 预览更新
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */

export const dragMethods = {
  previewPlacementClass() {
    return `desktop-widget-drop-preview${this.dragState.kind === 'icon' ? ' is-icon' : ''}`;
  },

  beginWidgetDrag(widget, event) {
    if (!this.isEditing || !this.isHome) return;
    if (this.editStage !== 'decorate') return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('.desktop-widget-hide-btn, a, button')) return;
    this.selectedDesktopKey = null;

    const rect = event.currentTarget.getBoundingClientRect();
    this.dragState = {
      active: true,
      kind: 'widget',
      key: widget.key,
      node: { ...widget },
      widget: { ...widget },
      iconMarkup: '',
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      snapOffsetX: rect.width / 2,
      snapOffsetY: rect.height / 2,
      width: rect.width,
      height: rect.height,
      hasMoved: false
    };

    this.previewPlacement = {
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h
    };
    this.dragMoveHandler = (moveEvent) => this.onDragMove(moveEvent);
    this.dragEndHandler = () => this.onDragEnd();

    window.addEventListener('pointermove', this.dragMoveHandler);
    window.addEventListener('pointerup', this.dragEndHandler);
    document.body.style.userSelect = 'none';
    event.preventDefault();
  },

  beginIconDrag(key, event) {
    if (!this.isEditing || !this.isHome) return;
    if (this.editStage !== 'decorate') return;
    if (event.button !== undefined && event.button !== 0) return;

    const icon = this.findIconByKey(key);
    if (!icon) return;

    const rect = event.currentTarget.getBoundingClientRect();
    this.selectedDesktopKey = key;

    this.dragState = {
      active: true,
      kind: 'icon',
      key,
      node: { ...icon },
      widget: null,
      iconMarkup: event.currentTarget.innerHTML,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      snapOffsetX: rect.width / 2,
      snapOffsetY: rect.height / 2,
      width: rect.width,
      height: rect.height,
      hasMoved: false
    };

    this.previewPlacement = {
      x: icon.x,
      y: icon.y,
      w: icon.w,
      h: icon.h
    };
    this.dragMoveHandler = (moveEvent) => this.onDragMove(moveEvent);
    this.dragEndHandler = () => this.onDragEnd();

    window.addEventListener('pointermove', this.dragMoveHandler);
    window.addEventListener('pointerup', this.dragEndHandler);
    document.body.style.userSelect = 'none';
    event.preventDefault();
  },

  onDragMove(event) {
    if (!this.dragState.active || !this.dragState.node) return;

    this.dragState.pointerX = event.clientX;
    this.dragState.pointerY = event.clientY;
    const moveX = event.clientX - this.dragState.startX;
    const moveY = event.clientY - this.dragState.startY;
    if (!this.dragState.hasMoved) {
      const distance = Math.hypot(moveX, moveY);
      if (distance < 6) return;
      this.dragState.hasMoved = true;
    }
    this.updatePreviewForPointer(event.clientX, event.clientY, this.dragState.node);
  },

  updatePreviewForPointer(clientX, clientY, widget) {
    const gridRect = this.$refs.grid?.getBoundingClientRect();
    if (!gridRect) return;

    const rawLeft = clientX - gridRect.left - this.dragState.offsetX;
    const rawTop = clientY - gridRect.top - this.dragState.offsetY;
    const stride = this.cellSize + this.gap;
    const guessedX = Math.round(rawLeft / stride) + 1;
    const guessedY = Math.round(rawTop / stride) + 1;

    const desired = this.clampPlacement(widget, guessedX, guessedY);
    this.previewPlacement = this.findNearestAvailablePlacement(widget, desired.x, desired.y, widget.key);
  },

  onDragEnd() {
    if (!this.dragState.active) return;

    const node = this.findDesktopNode(this.dragState.key);
    if (node && this.previewPlacement) {
      const placements = this.resolvePlacementsForDrop(node.key, this.previewPlacement);
      this.applyResolvedPlacements(placements);
      this.syncBasePlacements(placements);
      this.syncResponsiveVisibility();
    }

    this.endDrag();
  },

  endDrag() {
    this.previewPlacement = null;
    this.dragState = {
      active: false,
      kind: '',
      key: '',
      node: null,
      widget: null,
      iconMarkup: '',
      startX: 0,
      startY: 0,
      pointerX: 0,
      pointerY: 0,
      offsetX: 0,
      offsetY: 0,
      snapOffsetX: 0,
      snapOffsetY: 0,
      width: 0,
      height: 0,
      hasMoved: false
    };

    if (this.dragMoveHandler) {
      window.removeEventListener('pointermove', this.dragMoveHandler);
      this.dragMoveHandler = null;
    }

    if (this.dragEndHandler) {
      window.removeEventListener('pointerup', this.dragEndHandler);
      this.dragEndHandler = null;
    }

    document.body.style.userSelect = '';
  }
};
