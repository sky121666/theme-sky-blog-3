/**
 * 桌面拖拽引擎 · Widget / Icon 拖拽 · 预览更新
 *
 * 所有方法通过 spread 注入 Alpine.data，内部使用 this 访问组件状态。
 */
const STRIP_ALPINE_RE = /\s(x-html|x-widget-content|x-text|x-show|x-if|x-for|x-bind|x-on|x-transition[^=]*|:class|:style|:data-[^=]*|@[a-z.]+)="[^"]*"/g;
const NOTIFICATION_GRID_COLUMNS = 2;

export const dragMethods = {
  previewPlacementClass() {
    return `desktop-widget-drop-preview${this.dragState.kind === 'icon' ? ' is-icon' : ''}`;
  },

  beginWidgetDrag(widget, event) {
    if (!this.isEditing || !this.isHome) return;
    if (event.button !== undefined && event.button !== 0) return;
    
    // Allow clicking the remove button, but for everything else in decorate mode, prioritize dragging
    if (event.target.closest('.desktop-widget-remove-btn')) return;
    
    this.selectedDesktopKey = null;

    const rect = event.currentTarget.getBoundingClientRect();
    this.dragState = {
      active: true,
      kind: 'widget',
      key: widget.key,
      node: { ...widget },
      widget: { ...widget },
      widgetMarkup: event.currentTarget.innerHTML.replace(STRIP_ALPINE_RE, ''),
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
      hasMoved: false,
      notificationDropActive: false,
      notificationDropIndex: -1,
      notificationDropTop: 0,
      notificationDropLeft: 0,
      notificationDropWidth: 0,
      notificationDropHeight: 0
    };

    window.dispatchEvent(new CustomEvent('theme-widget-drag-state', {
      detail: { active: true, key: widget.key }
    }));

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

  beginWidgetDragFromNotification(widget, detail) {
    if (!this.isEditing || !this.isHome) return;

    this.selectedDesktopKey = null;
    const rect = detail.rect;

    this.dragState = {
      active: true,
      kind: 'widget',
      key: widget.key,
      node: { ...widget },
      widget: { ...widget },
      widgetMarkup: detail.markup.replace(STRIP_ALPINE_RE, ''),
      iconMarkup: '',
      startX: detail.clientX,
      startY: detail.clientY,
      pointerX: detail.clientX,
      pointerY: detail.clientY,
      offsetX: detail.clientX - rect.left,
      offsetY: detail.clientY - rect.top,
      snapOffsetX: rect.width / 2,
      snapOffsetY: rect.height / 2,
      width: rect.width,
      height: rect.height,
      hasMoved: true,
      notificationDropActive: false,
      notificationDropIndex: -1,
      notificationDropTop: 0,
      notificationDropLeft: 0,
      notificationDropWidth: 0,
      notificationDropHeight: 0
    };

    window.dispatchEvent(new CustomEvent('theme-widget-drag-state', {
      detail: { active: true, key: widget.key }
    }));

    this.previewPlacement = null;
    this.dragMoveHandler = (moveEvent) => this.onDragMove(moveEvent);
    this.dragEndHandler = () => this.onDragEnd();

    window.addEventListener('pointermove', this.dragMoveHandler);
    window.addEventListener('pointerup', this.dragEndHandler);
    document.body.style.userSelect = 'none';
  },

  beginIconDrag(key, event) {
    if (!this.isEditing || !this.isHome) return;
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
      widgetMarkup: '',
      iconMarkup: event.currentTarget.innerHTML.replace(STRIP_ALPINE_RE, ''),
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
      hasMoved: false,
      notificationDropActive: false,
      notificationDropIndex: -1,
      notificationDropTop: 0,
      notificationDropLeft: 0,
      notificationDropWidth: 0,
      notificationDropHeight: 0
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
    const panel = document.getElementById('notification-center-panel');
    const panelRect = panel?.getBoundingClientRect();
    const isOverPanel = panel
      && window.getComputedStyle(panel).display !== 'none'
      && panelRect
      && clientX >= panelRect.left
      && clientX <= panelRect.right
      && clientY >= panelRect.top
      && clientY <= panelRect.bottom;

    if (isOverPanel) {
      this.previewPlacement = null;
      const drop = this.resolveNotificationDropPlacement(clientX, clientY);
      const nextDrop = {
        index: drop.index,
        top: Math.round(drop.top),
        left: Math.round(drop.left),
        width: Math.round(drop.width),
        height: Math.round(drop.height)
      };
      const changed = !this.dragState.notificationDropActive
        || this.dragState.notificationDropIndex !== nextDrop.index
        || Math.round(this.dragState.notificationDropTop || 0) !== nextDrop.top
        || Math.round(this.dragState.notificationDropLeft || 0) !== nextDrop.left
        || Math.round(this.dragState.notificationDropWidth || 0) !== nextDrop.width
        || Math.round(this.dragState.notificationDropHeight || 0) !== nextDrop.height;
      if (!changed) return;
      this.dragState.notificationDropActive = true;
      this.dragState.notificationDropIndex = drop.index;
      this.dragState.notificationDropTop = drop.top;
      this.dragState.notificationDropLeft = drop.left;
      this.dragState.notificationDropWidth = drop.width;
      this.dragState.notificationDropHeight = drop.height;
      window.dispatchEvent(new CustomEvent('theme-notification-widget-drop-state', {
        detail: {
          active: true,
          index: drop.index,
          top: drop.top,
          left: drop.left,
          width: drop.width,
          height: drop.height
        }
      }));
      return;
    }

    if (this.dragState.notificationDropActive) {
      this.dragState.notificationDropActive = false;
      this.dragState.notificationDropIndex = -1;
      this.dragState.notificationDropTop = 0;
      this.dragState.notificationDropLeft = 0;
      this.dragState.notificationDropWidth = 0;
      this.dragState.notificationDropHeight = 0;
      window.dispatchEvent(new CustomEvent('theme-notification-widget-drop-state', { detail: { active: false } }));
    }

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

  resolveNotificationWidgetSpan(widget = null, card = null) {
    const widgetType = String(widget?.widget || card?.dataset?.notificationWidgetType || '');
    const size = String(widget?.size || '')
      || (card?.classList?.contains('is-small') ? 'small' : '')
      || (card?.classList?.contains('is-large') ? 'large' : '')
      || (card?.classList?.contains('is-extra-large') ? 'extra-large' : '')
      || 'medium';
    if (size === 'small') return { w: 1, h: 1 };
    if (widgetType === 'system.calendar' && size === 'medium') return { w: 2, h: 2 };
    if (size === 'large' || size === 'extra-large') return { w: 2, h: 2 };
    return { w: 2, h: 1 };
  },

  canPlaceNotificationGridItem(occupied, row, col, span) {
    if (col < 1 || col + span.w - 1 > NOTIFICATION_GRID_COLUMNS) return false;
    for (let rowOffset = 0; rowOffset < span.h; rowOffset += 1) {
      const targetRow = row + rowOffset;
      const cells = occupied[targetRow] || [];
      for (let colOffset = 0; colOffset < span.w; colOffset += 1) {
        if (cells[col + colOffset]) return false;
      }
    }
    return true;
  },

  occupyNotificationGridItem(occupied, row, col, span) {
    for (let rowOffset = 0; rowOffset < span.h; rowOffset += 1) {
      const targetRow = row + rowOffset;
      occupied[targetRow] = occupied[targetRow] || [];
      for (let colOffset = 0; colOffset < span.w; colOffset += 1) {
        occupied[targetRow][col + colOffset] = true;
      }
    }
  },

  simulateNotificationGrid(items) {
    const occupied = [];
    return items.map((item) => {
      const span = {
        w: Math.min(NOTIFICATION_GRID_COLUMNS, Math.max(1, item.span?.w || 2)),
        h: Math.max(1, item.span?.h || 1)
      };
      let row = 1;
      let placed = null;
      while (!placed && row < 100) {
        for (let col = 1; col <= NOTIFICATION_GRID_COLUMNS - span.w + 1; col += 1) {
          if (this.canPlaceNotificationGridItem(occupied, row, col, span)) {
            placed = { key: item.key, row, col, span };
            this.occupyNotificationGridItem(occupied, row, col, span);
            break;
          }
        }
        row += 1;
      }
      return placed || { key: item.key, row: 1, col: 1, span };
    });
  },

  notificationGridPlacementToPreview(placement, metrics) {
    const left = (placement.col - 1) * (metrics.cell + metrics.gap);
    const top = (placement.row - 1) * (metrics.cell + metrics.gap);
    const width = placement.span.w * metrics.cell + Math.max(0, placement.span.w - 1) * metrics.gap;
    const height = placement.span.h * metrics.cell + Math.max(0, placement.span.h - 1) * metrics.gap;
    return { left, top, width, height };
  },

  resolveNotificationDropPlacement(clientX, clientY) {
    const panel = document.getElementById('notification-center-panel');
    const list = panel?.querySelector('.notification-center-widget-list');
    if (!list) return { index: 0, top: 0, left: 0, width: 0, height: 0 };

    const listRect = list.getBoundingClientRect();
    const listStyle = window.getComputedStyle(list);
    const gap = Number.parseFloat(listStyle.columnGap || listStyle.gap || '16') || 16;
    const cell = Math.max(1, (listRect.width - gap) / NOTIFICATION_GRID_COLUMNS);
    const metrics = { cell, gap };
    const targetSpan = this.resolveNotificationWidgetSpan(this.dragState.node);
    const relativeX = Math.max(0, Math.min(listRect.width, clientX - listRect.left));
    const relativeY = Math.max(0, clientY - listRect.top);
    const desired = {
      row: Math.max(1, Math.floor(relativeY / (cell + gap)) + 1),
      col: targetSpan.w >= NOTIFICATION_GRID_COLUMNS || relativeX < listRect.width / 2 ? 1 : 2,
      span: targetSpan
    };
    const desiredPreview = this.notificationGridPlacementToPreview(desired, metrics);

    const cards = Array.from(list.querySelectorAll('[data-notification-widget-card]'))
      .filter((card) => card.dataset.notificationWidgetKey !== this.dragState.key)
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          key: card.dataset.notificationWidgetKey,
          card,
          span: this.resolveNotificationWidgetSpan(null, card),
          row: Math.max(1, Math.round((rect.top - listRect.top) / (cell + gap)) + 1),
          col: rect.left - listRect.left > cell / 2 ? 2 : 1
        };
      });

    if (!cards.length) {
      return {
        index: 0,
        ...this.notificationGridPlacementToPreview({ row: desired.row, col: desired.col, span: targetSpan }, metrics)
      };
    }

    const targetItem = { key: this.dragState.key, span: targetSpan };
    let best = {
      index: cards.length,
      score: Number.POSITIVE_INFINITY,
      placement: null
    };
    const previousIndex = Number.isFinite(this.dragState.notificationDropIndex)
      ? this.dragState.notificationDropIndex
      : -1;

    for (let index = 0; index <= cards.length; index += 1) {
      const sequence = cards.slice();
      sequence.splice(index, 0, targetItem);
      const placement = this.simulateNotificationGrid(sequence).find((item) => item.key === this.dragState.key);
      if (!placement) continue;
      const preview = this.notificationGridPlacementToPreview(placement, metrics);
      const distance = Math.abs(preview.top - desiredPreview.top) + Math.abs(preview.left - desiredPreview.left);
      const hysteresis = previousIndex >= 0 && index !== previousIndex ? 14 : 0;
      const score = distance + hysteresis;
      if (score < best.score) {
        best = { index, score, placement };
      }
    }

    return {
      index: best.index,
      ...this.notificationGridPlacementToPreview(best.placement || { row: desired.row, col: desired.col, span: targetSpan }, metrics)
    };
  },

  applyNotificationWidgetOrder(targetKey, index) {
    const notificationWidgets = this.widgets
      .filter((widget) => !widget.hidden && widget.surface === 'notification-center' && widget.key !== targetKey)
      .sort((left, right) => (left.order || 0) - (right.order || 0));
    const node = this.widgets.find((widget) => widget.key === targetKey);
    if (!node) return false;

    node.surface = 'notification-center';
    const nextIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : notificationWidgets.length, notificationWidgets.length));
    notificationWidgets.splice(nextIndex, 0, node);
    notificationWidgets.forEach((widget, orderIndex) => {
      widget.order = orderIndex + 1;
    });
    return true;
  },

  onDragEnd() {
    if (!this.dragState.active) return;

    const clientX = this.dragState.pointerX;
    const panel = document.getElementById('notification-center-panel');
    const panelRect = panel?.getBoundingClientRect();
    const isOverPanel = panel
      && window.getComputedStyle(panel).display !== 'none'
      && panelRect
      && clientX >= panelRect.left
      && clientX <= panelRect.right
      && this.dragState.pointerY >= panelRect.top
      && this.dragState.pointerY <= panelRect.bottom;

    window.dispatchEvent(new CustomEvent('theme-notification-widget-drop-state', { detail: { active: false } }));

    if (isOverPanel) {
      if (this.applyNotificationWidgetOrder(this.dragState.key, this.dragState.notificationDropIndex)) {
        this.markDesktopLayoutDirty('组件已拖入通知中心');
        this.dispatchNotificationWidgetsChange();
        this.syncResponsiveVisibility();
        this.syncWidgetRuntimes();
      }
    } else {
      const node = this.findDesktopNode(this.dragState.key);
      if (node) {
        node.surface = 'desktop';
        if (this.previewPlacement) {
          const placements = this.resolvePlacementsForDrop(node.key, this.previewPlacement);
          this.applyResolvedPlacements(placements);
          this.syncBasePlacements(placements);
          this.syncResponsiveVisibility();
          this.markDesktopLayoutDirty('组件已移至桌面');
        }
        this.dispatchNotificationWidgetsChange();
        this.syncWidgetRuntimes();
      }
    }

    this.endDrag();
  },

  endDrag() {
    window.dispatchEvent(new CustomEvent('theme-notification-widget-drag-end'));
    window.dispatchEvent(new CustomEvent('theme-widget-drag-state', {
      detail: { active: false, key: this.dragState.key }
    }));
    this.previewPlacement = null;
    this.dragState = {
      active: false,
      kind: '',
      key: '',
      node: null,
      widget: null,
      widgetMarkup: '',
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
      hasMoved: false,
      notificationDropActive: false,
      notificationDropIndex: -1,
      notificationDropTop: 0,
      notificationDropLeft: 0,
      notificationDropWidth: 0,
      notificationDropHeight: 0
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
