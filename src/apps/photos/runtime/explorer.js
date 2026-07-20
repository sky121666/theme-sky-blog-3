/**
 * Photos Explorer — standalone Alpine component
 *
 * Layout modes:
 * - `square`: CSS Grid
 * - `aspect`: stable append-only JS masonry
 *
 * Why JS masonry again:
 * CSS columns visually reorder existing cards whenever new items are appended,
 * which makes infinite loading feel like the whole layout is being reshuffled.
 * Here we keep existing cards fixed and only append new cards to the current
 * shortest column.
 */
import { initLazyImages } from '../../../shell/desktop-shell/runtime/shared/lazy-media.js';
import { warnApiCall } from '../../../shell/desktop-shell/runtime/shared/debug.js';

const PHOTOS_PREFS_KEY = 'theme-photos-explorer-prefs';
const MIN_COL_COUNT = 2;
const MAX_COL_COUNT = 6;
const DEFAULT_COL_COUNT = 4;
const MIN_ALBUM_COL_COUNT = 2;
const MAX_ALBUM_COL_COUNT = 8;
const DEFAULT_ALBUM_COL_COUNT = 4;
const COMPACT_MIN_COL_COUNT = 1;
const COMPACT_MAX_COL_COUNT = 4;
const COMPACT_DEFAULT_COL_COUNT = 2;
const SKELETON_HEIGHTS = [164, 212, 188, 236, 176, 224, 196, 248];

function clampGridColCount(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COL_COUNT;
  return Math.min(MAX_COL_COUNT, Math.max(MIN_COL_COUNT, parsed));
}

function clampAlbumColCount(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ALBUM_COL_COUNT;
  return Math.min(MAX_ALBUM_COL_COUNT, Math.max(MIN_ALBUM_COL_COUNT, parsed));
}

function readPreferences() {
  try {
    const raw = window.localStorage.getItem(PHOTOS_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      layoutMode: parsed?.activeMode === 'aspect' || parsed?.layoutMode === 'aspect' ? 'aspect' : 'square',
      squareCols: clampGridColCount(parsed?.squareCols ?? parsed?.colCount),
      aspectCols: clampGridColCount(parsed?.aspectCols ?? parsed?.colCount),
      albumCols: clampAlbumColCount(parsed?.albumCols),
    };
  } catch (_error) {
    return null;
  }
}

function writePreferences(preferences) {
  try {
    window.localStorage.setItem(PHOTOS_PREFS_KEY, JSON.stringify(preferences));
  } catch (_error) {
    // Ignore storage failures and keep runtime behavior intact.
  }
}

function hasSavedPreferences() {
  try {
    return Boolean(window.localStorage.getItem(PHOTOS_PREFS_KEY));
  } catch (_error) {
    return false;
  }
}

function createSkeletonCard(height, index) {
  const card = document.createElement('div');
  card.className = 'photo-card photo-card--skeleton';
  card.dataset.skeleton = '1';
  card.dataset.skeletonHeight = String(height);
  card.dataset.skeletonIndex = String(index);
  card.innerHTML = `
    <div class="photo-card-inner">
      <div class="photo-card-skeleton-media" style="--photos-skeleton-height:${height}px"></div>
      <div class="photo-card-skeleton-sheen"></div>
    </div>
  `;
  return card;
}

export function registerPhotosExplorer(Alpine) {
  Alpine.data('photosExplorer', () => ({
    squareCols: DEFAULT_COL_COUNT,
    aspectCols: DEFAULT_COL_COUNT,
    albumCols: DEFAULT_ALBUM_COL_COUNT,
    effectiveColCountValue: DEFAULT_COL_COUNT,
    layoutMode: 'square',
    infoOpen: false,
    commentsOpen: false,
    zoomLevel: 1,
    panX: 0,
    panY: 0,
    photoCanPan: false,
    photoPanning: false,
    _panSession: null,
    _panMoveHandler: null,
    _panEndHandler: null,
    _observer: null,
    _paginationController: null,
    _paginationGeneration: 0,
    _paginationLoadMore: null,
    _paginationRetryCleanup: null,
    _destroyed: false,
    _engine: null,

    _getEngine() {
      if (!this._engine) {
        this._engine = {
          cards: [],
          columns: [],
          columnHeights: [],
          masonryDistribution: [], // Saves the column assignments: Array of Arrays of cards
          masonryColCount: 0,
          loadingSkeletons: [],
          resizeTimer: null,
          heightSyncFrame: 0,
          resizeHandler: null,
          resizeObserver: null,
          surfaceCleanup: null,
          detailCleanup: null,
        };
      }
      return this._engine;
    },

    invalidateMasonryLayout() {
      const engine = this._getEngine();
      engine.masonryDistribution = [];
      engine.masonryColCount = 0;
      engine.columnHeights = [];
    },

    _getGrid() {
      return this.$el?.querySelector('.photos-grid') || null;
    },

    _getWindowSurface() {
      return this.$el?.closest('[data-window-surface]') || null;
    },

    _getDetailStage() {
      return this.$el?.querySelector('.photos-detail-stage') || null;
    },

    _getDetailImage() {
      return this.$el?.querySelector('.photos-detail-image') || null;
    },

    _isCompactSurface() {
      const surface = this._getWindowSurface();
      const shell = this.$el;
      const width = surface?.clientWidth || shell?.clientWidth || window.innerWidth;
      return width <= 600 || window.matchMedia?.('(max-width: 768px)').matches === true;
    },

    _minColCount() {
      return this._isCompactSurface() ? COMPACT_MIN_COL_COUNT : MIN_COL_COUNT;
    },

    _maxGridColCount() {
      return this._isCompactSurface() ? COMPACT_MAX_COL_COUNT : MAX_COL_COUNT;
    },

    _maxAlbumColCount() {
      if (this._isCompactSurface()) return COMPACT_MAX_COL_COUNT;
      return this._getAlbumViewportMaxColCount();
    },

    _installSurfaceControls() {
      const surface = this._getWindowSurface();
      const engine = this._getEngine();
      if (!surface || engine.surfaceCleanup) return;

      const dispatchSurfaceControl = (name, detail = {}) => {
        surface.dispatchEvent(new CustomEvent(`photos:${name}`, { detail, bubbles: true }));
      };
      const onControlClick = (event) => {
        const stopRegion = event.target?.closest?.('[data-photos-stop-window-drag]');
        if (stopRegion) event.stopPropagation();

        const control = event.target?.closest?.('[data-photos-control]');
        if (!control || !surface.contains(control)) return;

        const action = control.dataset.photosControl;
        if (action === 'set-mode') {
          dispatchSurfaceControl('set-mode', { mode: control.dataset.photosMode || 'square' });
          return;
        }
        if (action === 'cols-increase') dispatchSurfaceControl('cols-increase');
        if (action === 'cols-decrease') dispatchSurfaceControl('cols-decrease');
        if (action === 'zoom-in') dispatchSurfaceControl('zoom-in');
        if (action === 'zoom-out') dispatchSurfaceControl('zoom-out');
        if (action === 'info-toggle') dispatchSurfaceControl('info-toggle');
        if (action === 'comments-toggle') dispatchSurfaceControl('comments-toggle');
      };
      const onControlInput = (event) => {
        const control = event.target?.closest?.('[data-photos-control="zoom-set"]');
        if (!control || !surface.contains(control)) return;
        event.stopPropagation();
        dispatchSurfaceControl('zoom-set', { value: control.value });
      };
      const stopWindowDrag = (event) => {
        if (event.target?.closest?.('[data-photos-stop-window-drag]')) {
          event.stopPropagation();
        }
      };
      const onSetMode = (event) => {
        if (this.isDetailView()) return;
        const mode = event.detail?.mode;
        if (mode) this.setLayoutMode(mode);
      };
      const onIncrease = () => {
        if (!this.isDetailView()) this.increaseCols();
      };
      const onDecrease = () => {
        if (!this.isDetailView()) this.decreaseCols();
      };
      const onZoomSet = (event) => this.setZoomLevel(event.detail?.value);
      const onZoomIn = () => this.adjustZoom(0.1);
      const onZoomOut = () => this.adjustZoom(-0.1);
      const onInfoToggle = () => this.toggleInfo();
      const onCommentsToggle = () => this.toggleComments();
      const onCommentsClose = () => {
        this.commentsOpen = false;
        this.syncDetailChromeControls();
      };

      surface.addEventListener('click', onControlClick);
      surface.addEventListener('input', onControlInput);
      surface.addEventListener('mousedown', stopWindowDrag, true);
      surface.addEventListener('pointerdown', stopWindowDrag, true);
      surface.addEventListener('photos:set-mode', onSetMode);
      surface.addEventListener('photos:cols-increase', onIncrease);
      surface.addEventListener('photos:cols-decrease', onDecrease);
      surface.addEventListener('photos:zoom-set', onZoomSet);
      surface.addEventListener('photos:zoom-in', onZoomIn);
      surface.addEventListener('photos:zoom-out', onZoomOut);
      surface.addEventListener('photos:info-toggle', onInfoToggle);
      surface.addEventListener('photos:comments-toggle', onCommentsToggle);
      surface.addEventListener('photos:comments-close', onCommentsClose);

      engine.surfaceCleanup = () => {
        surface.removeEventListener('click', onControlClick);
        surface.removeEventListener('input', onControlInput);
        surface.removeEventListener('mousedown', stopWindowDrag, true);
        surface.removeEventListener('pointerdown', stopWindowDrag, true);
        surface.removeEventListener('photos:set-mode', onSetMode);
        surface.removeEventListener('photos:cols-increase', onIncrease);
        surface.removeEventListener('photos:cols-decrease', onDecrease);
        surface.removeEventListener('photos:zoom-set', onZoomSet);
        surface.removeEventListener('photos:zoom-in', onZoomIn);
        surface.removeEventListener('photos:zoom-out', onZoomOut);
        surface.removeEventListener('photos:info-toggle', onInfoToggle);
        surface.removeEventListener('photos:comments-toggle', onCommentsToggle);
        surface.removeEventListener('photos:comments-close', onCommentsClose);
      };
    },

    isDetailView() {
      return this.$el?.dataset.photosView === 'detail';
    },

    setZoomLevel(value) {
      const parsed = Number.parseFloat(String(value ?? '1'));
      this.applyPhotoZoom(Number.isFinite(parsed) ? parsed : 1);
    },

    applyPhotoZoom(value, origin = null) {
      const nextZoom = Math.min(2.2, Math.max(0.5, value));
      const previousZoom = this.zoomLevel || 1;
      const hadOrigin = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y);

      if (hadOrigin && previousZoom > 0) {
        const ratio = nextZoom / previousZoom;
        this.panX = origin.x - ((origin.x - this.panX) * ratio);
        this.panY = origin.y - ((origin.y - this.panY) * ratio);
      }

      this.zoomLevel = nextZoom;
      this.updatePhotoPanAvailability();
      this.syncDetailChromeControls();
    },

    adjustZoom(delta) {
      this.applyPhotoZoom(this.zoomLevel + delta);
    },

    resetPhotoPan() {
      this._releasePhotoPanSession();
      this.panX = 0;
      this.panY = 0;
      this.photoCanPan = false;
    },

    resetPhotoZoom() {
      this.zoomLevel = 1;
      this.resetPhotoPan();
      this.syncDetailChromeControls();
    },

    clampPhotoPan() {
      const maxX = this._maxPhotoPanX();
      const maxY = this._maxPhotoPanY();
      this.panX = maxX > 0
        ? Math.max(-maxX, Math.min(maxX, Number(this.panX) || 0))
        : 0;
      this.panY = maxY > 0
        ? Math.max(-maxY, Math.min(maxY, Number(this.panY) || 0))
        : 0;
      this.photoCanPan = this.isDetailView() && (maxX > 0.5 || maxY > 0.5);

      if (!this.photoCanPan) {
        this._releasePhotoPanSession();
      }

      return this.photoCanPan;
    },

    _maxPhotoPanX() {
      const stage = this._getDetailStage();
      const image = this._getDetailImage();
      if (!stage || !image) return 0;
      return Math.max(0, ((image.offsetWidth * this.zoomLevel) - stage.clientWidth) / 2);
    },

    _maxPhotoPanY() {
      const stage = this._getDetailStage();
      const image = this._getDetailImage();
      if (!stage || !image) return 0;
      return Math.max(0, ((image.offsetHeight * this.zoomLevel) - stage.clientHeight) / 2);
    },

    canPanPhoto() {
      return this.clampPhotoPan();
    },

    updatePhotoPanAvailability() {
      return this.clampPhotoPan();
    },

    _photoStageOrigin(event) {
      const stage = this._getDetailStage();
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      return {
        x: event.clientX - rect.left - (rect.width / 2),
        y: event.clientY - rect.top - (rect.height / 2),
      };
    },

    handlePhotoWheel(event) {
      if (!this.isDetailView()) return;
      event.preventDefault();
      event.stopPropagation();
      const normalized = Math.max(-0.18, Math.min(0.18, -event.deltaY * 0.002));
      this.applyPhotoZoom(this.zoomLevel + normalized, this._photoStageOrigin(event));
    },

    beginPhotoPan(event) {
      if (!this.canPanPhoto()) return;
      if (event.button != null && event.button !== 0) return;
      if (this.photoPanning) return;

      event.preventDefault();
      event.stopPropagation();
      this._removePhotoPanListeners();
      this.photoPanning = true;
      const eventKind = event.type?.startsWith('mouse') ? 'mouse' : 'pointer';
      const captureTarget = eventKind === 'pointer' ? event.currentTarget || null : null;
      this._panSession = {
        pointerId: event.pointerId ?? 'mouse',
        eventKind,
        captureTarget,
        bodyUserSelect: document.body?.style.userSelect ?? '',
        startX: event.clientX,
        startY: event.clientY,
        panX: this.panX,
        panY: this.panY,
      };
      if (document.body) document.body.style.userSelect = 'none';
      try {
        captureTarget?.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Synthetic pointer events and older browsers may not support capture for this pointer.
      }

      this._panMoveHandler = (moveEvent) => this.updatePhotoPan(moveEvent);
      this._panEndHandler = (endEvent) => this.endPhotoPan(endEvent);
      if (eventKind === 'mouse') {
        window.addEventListener('mousemove', this._panMoveHandler);
        window.addEventListener('mouseup', this._panEndHandler);
      } else {
        window.addEventListener('pointermove', this._panMoveHandler);
        window.addEventListener('pointerup', this._panEndHandler);
        window.addEventListener('pointercancel', this._panEndHandler);
      }
    },

    updatePhotoPan(event) {
      const session = this._panSession;
      if (!session) return;
      const pointerId = event.pointerId ?? 'mouse';
      if (session.eventKind !== 'mouse' && session.pointerId !== pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      this.panX = session.panX + (event.clientX - session.startX);
      this.panY = session.panY + (event.clientY - session.startY);
      this.clampPhotoPan();
    },

    endPhotoPan(event) {
      const session = this._panSession;
      const pointerId = event.pointerId ?? 'mouse';
      if (session && session.eventKind !== 'mouse' && pointerId != null && session.pointerId !== pointerId) return;

      this._releasePhotoPanSession();
      this.clampPhotoPan();
    },

    _releasePhotoPanSession() {
      const session = this._panSession;
      const wasPanning = this.photoPanning;
      if (session?.eventKind === 'pointer'
        && session.captureTarget
        && session.pointerId !== 'mouse') {
        try {
          const hasCapture = typeof session.captureTarget.hasPointerCapture !== 'function'
            || session.captureTarget.hasPointerCapture(session.pointerId);
          if (hasCapture) {
            session.captureTarget.releasePointerCapture?.(session.pointerId);
          }
        } catch (_error) {
          // The browser may release pointer capture before pointerup or during teardown.
        }
      }

      this.photoPanning = false;
      this._panSession = null;
      this._removePhotoPanListeners();
      if (document.body && (session || wasPanning)) {
        document.body.style.userSelect = session?.bodyUserSelect ?? '';
      }
    },

    _removePhotoPanListeners() {
      if (this._panMoveHandler) {
        window.removeEventListener('pointermove', this._panMoveHandler);
        window.removeEventListener('mousemove', this._panMoveHandler);
        this._panMoveHandler = null;
      }
      if (this._panEndHandler) {
        window.removeEventListener('pointerup', this._panEndHandler);
        window.removeEventListener('pointercancel', this._panEndHandler);
        window.removeEventListener('mouseup', this._panEndHandler);
        this._panEndHandler = null;
      }
    },

    _installDetailViewerControls() {
      const engine = this._getEngine();
      if (engine.detailCleanup || !this.isDetailView()) return;

      const stage = this._getDetailStage();
      const image = this._getDetailImage();
      if (!stage || !image) return;

      const onWheel = (event) => this.handlePhotoWheel(event);
      const onPointerDown = (event) => this.beginPhotoPan(event);
      const onMouseDown = (event) => this.beginPhotoPan(event);
      const onAuxClick = (event) => event.preventDefault();
      const onDblClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.resetPhotoZoom();
      };
      const onImageLoad = () => this.updatePhotoPanAvailability();

      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('mousedown', onMouseDown);
      stage.addEventListener('auxclick', onAuxClick);
      stage.addEventListener('dblclick', onDblClick);
      image.addEventListener('load', onImageLoad);

      engine.detailCleanup = () => {
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('pointerdown', onPointerDown);
        stage.removeEventListener('mousedown', onMouseDown);
        stage.removeEventListener('auxclick', onAuxClick);
        stage.removeEventListener('dblclick', onDblClick);
        image.removeEventListener('load', onImageLoad);
      };

      this.updatePhotoPanAvailability();
    },

    toggleInfo() {
      this.infoOpen = !this.infoOpen;
      this.syncDetailChromeControls();
    },

    toggleComments() {
      this.commentsOpen = !this.commentsOpen;
      this.syncDetailChromeControls();
    },

    syncDetailChromeControls() {
      const surface = this._getWindowSurface();
      if (!surface) return;

      surface.dataset.photosInfoOpen = this.infoOpen ? 'true' : 'false';
      surface.dataset.photosCommentsOpen = this.commentsOpen ? 'true' : 'false';

      const zoomInput = surface.querySelector('[data-photos-detail-zoom]');
      if (zoomInput && String(zoomInput.value) !== String(this.zoomLevel)) {
        zoomInput.value = String(this.zoomLevel);
      }
      if (zoomInput) {
        const min = Number.parseFloat(zoomInput.min || '0.5');
        const max = Number.parseFloat(zoomInput.max || '2.2');
        const value = Number.parseFloat(zoomInput.value || '1');
        const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
        zoomInput.style.setProperty('--photos-zoom-fill', `${Math.min(100, Math.max(0, fill))}%`);
      }

      const backLink = surface.querySelector('.photos-detail-titlebar-back');
      const listUrl = this.$el?.dataset.photosListUrl || '/photos';
      if (backLink && backLink.getAttribute('href') !== listUrl) {
        backLink.setAttribute('href', listUrl);
      }

      const infoButton = surface.querySelector('[data-photos-detail-info-btn]');
      if (infoButton) {
        infoButton.classList.toggle('is-active', this.infoOpen);
        infoButton.setAttribute('aria-pressed', this.infoOpen ? 'true' : 'false');
      }

      const commentsButton = surface.querySelector('[data-photos-detail-comments-btn]');
      if (commentsButton) {
        commentsButton.classList.toggle('is-active', this.commentsOpen);
        commentsButton.setAttribute('aria-pressed', this.commentsOpen ? 'true' : 'false');
      }
    },

    syncChromeControls() {
      const surface = this._getWindowSurface();
      if (!surface) return;

      const isAlbumsView = this.isAlbumsView();
      const chromeTitle = surface.querySelector('[data-window-title]');
      const chromeSubtitle = surface.querySelector('[data-window-subtitle]');
      const layoutGroup = surface.querySelector('[data-photos-layout-group]');
      const densityGroup = surface.querySelector('[data-photos-density-group]');
      const resolvedTitle = this.$el?.dataset.photosChromeTitle || '图库';

      if (chromeTitle) {
        chromeTitle.textContent = resolvedTitle;
      }
      if (chromeSubtitle) {
        chromeSubtitle.textContent = this.$el?.dataset.photosChromeSubtitle || '';
      }

      if (this.isDetailView()) {
        this.syncDetailChromeControls();
        return;
      }

      const minCount = this._minColCount();
      const maxCount = isAlbumsView ? this._maxAlbumColCount() : this._maxGridColCount();
      const densityAdjustable = maxCount > minCount;

      if (layoutGroup) {
        layoutGroup.classList.toggle('hidden', isAlbumsView);
      }
      if (densityGroup) {
        densityGroup.classList.toggle('hidden', !densityAdjustable);
      }

      surface.querySelectorAll('[data-photos-mode-btn]').forEach((button) => {
        const mode = button.getAttribute('data-photos-mode-btn');
        const isActive = mode === this.layoutMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const activeCount = isAlbumsView ? this.effectiveColCountValue : this.activeColCount();
      const decrease = surface.querySelector('[data-photos-cols="decrease"]');
      const increase = surface.querySelector('[data-photos-cols="increase"]');
      if (decrease) {
        decrease.disabled = activeCount <= minCount || !densityAdjustable;
        decrease.setAttribute('aria-disabled', decrease.disabled ? 'true' : 'false');
      }
      if (increase) {
        increase.disabled = activeCount >= maxCount || !densityAdjustable;
        increase.setAttribute('aria-disabled', increase.disabled ? 'true' : 'false');
      }
    },

    _getMasonryGapPx() {
      const grid = this._getGrid();
      if (!grid) return 14;
      const raw = window.getComputedStyle(grid).columnGap;
      const parsed = Number.parseFloat(raw || '');
      return Number.isFinite(parsed) ? parsed : 14;
    },

    activeColCount() {
      if (this.isAlbumsView()) return this.albumCols;
      return this.layoutMode === 'aspect' ? this.aspectCols : this.squareCols;
    },

    _resolveEffectiveColCount() {
      if (this.isAlbumsView()) {
        return Math.max(this._minColCount(), Math.min(this._maxAlbumColCount(), this.albumCols));
      }
      return Math.max(this._minColCount(), Math.min(this._maxGridColCount(), this.activeColCount()));
    },

    syncEffectiveColCount() {
      this.effectiveColCountValue = this._resolveEffectiveColCount();
      return this.effectiveColCountValue;
    },

    isAlbumsView() {
      return this.$el?.dataset.photosView === 'albums';
    },

    _getAlbumContainer() {
      return this.$el?.querySelector('.photos-albums-view')
        || this.$el?.querySelector('.photos-main')
        || null;
    },

    _getAlbumViewportMaxColCount() {
      const albumContainer = this._getAlbumContainer();
      const containerWidth = albumContainer?.clientWidth || this.$el?.clientWidth || window.innerWidth;
      if (containerWidth < 520) return 2;
      if (containerWidth < 840) return 3;
      return MAX_ALBUM_COL_COUNT;
    },

    persistPreferences() {
      writePreferences({
        activeMode: this.layoutMode,
        squareCols: this.squareCols,
        aspectCols: this.aspectCols,
        albumCols: this.albumCols,
      });
    },

    restorePreferences() {
      const saved = readPreferences();
      if (!saved) return;
      this.layoutMode = saved.layoutMode;
      this.squareCols = saved.squareCols;
      this.aspectCols = saved.aspectCols;
      this.albumCols = saved.albumCols;
    },

    _captureInitialCards() {
      const grid = this._getGrid();
      if (!grid) return;
      const engine = this._getEngine();
      const cards = Array.from(grid.querySelectorAll('.photo-card:not([data-skeleton="1"])'));
      if (cards.length) {
        engine.cards = cards;
      }
    },

    bindImg(img) {
      if (!img || img.dataset.photosBound === '1') return;
      img.dataset.photosBound = '1';

      const settle = () => {
        if (img.dataset.settled) return;
        img.dataset.settled = '1';
        img.classList.add('ph-loaded');
        img.closest('.photo-card')?.classList.add('ph-loaded');
        this._scheduleHeightSync();
      };

      if (img.complete && img.naturalWidth > 0) {
        settle();
        return;
      }

      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });
    },

    hydrateGridImages(root = this.$el) {
      if (!root) return;
      initLazyImages(root);
      root.querySelectorAll('.photos-grid .photo-card-img').forEach((img) => this.bindImg(img));
    },

    _estimateCardHeight(card, columnIndex = 0) {
      if (!card) return 180;

      const actualHeight = card.getBoundingClientRect().height;
      if (actualHeight > 0) return actualHeight;

      if (card.dataset.skeleton === '1') {
        return Number.parseFloat(card.dataset.skeletonHeight || '') || 180;
      }

      const engine = this._getEngine();
      const columnWidth = engine.columns[columnIndex]?.clientWidth
        || this._getGrid()?.clientWidth / Math.max(engine.columns.length || this.effectiveColCountValue, 1)
        || 220;
      const img = card.querySelector('.photo-card-img');
      if (img?.naturalWidth && img?.naturalHeight) {
        return (img.naturalHeight / img.naturalWidth) * columnWidth;
      }

      const minHeight = Number.parseFloat(window.getComputedStyle(img || card).minHeight || '');
      return Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 180;
    },

    _findShortestColumnIndex() {
      const engine = this._getEngine();
      if (!engine.columns.length) return 0;

      let minIndex = 0;
      for (let i = 1; i < engine.columnHeights.length; i += 1) {
        if (engine.columnHeights[i] < engine.columnHeights[minIndex]) {
          minIndex = i;
        }
      }
      return minIndex;
    },

    _appendCardToMasonry(card) {
      const engine = this._getEngine();
      if (!card || !engine.columns.length) return;

      const columnIndex = this._findShortestColumnIndex();
      const column = engine.columns[columnIndex];
      const gap = this._getMasonryGapPx();

      column.appendChild(card);
      card.dataset.masonryCol = String(columnIndex);

      const estimatedHeight = this._estimateCardHeight(card, columnIndex);
      engine.columnHeights[columnIndex] += estimatedHeight + (column.children.length > 1 ? gap : 0);
    },

    _renderSquareLayout() {
      const grid = this._getGrid();
      if (!grid) return;

      const engine = this._getEngine();
      grid.innerHTML = '';
      engine.columns = [];
      engine.loadingSkeletons = [];
      
      engine.cards.forEach((card) => grid.appendChild(card));
    },

    _recomputeMasonryDistribution(colCount) {
      const engine = this._getEngine();
      const gap = this._getMasonryGapPx();
      engine.columnHeights = new Array(colCount).fill(0);
      engine.masonryDistribution = Array.from({ length: colCount }, () => []);
      engine.masonryColCount = colCount;

      engine.cards.forEach((card) => {
        let minIndex = 0;
        for (let i = 1; i < colCount; i += 1) {
          if (engine.columnHeights[i] < engine.columnHeights[minIndex]) {
            minIndex = i;
          }
        }
        engine.masonryDistribution[minIndex].push(card);
        const estimatedHeight = this._estimateCardHeight(card, minIndex);
        engine.columnHeights[minIndex] += estimatedHeight + (engine.masonryDistribution[minIndex].length > 1 ? gap : 0);
      });
    },

    _renderMasonryLayout({ forceRecompute = false } = {}) {
      const grid = this._getGrid();
      if (!grid) return;

      const engine = this._getEngine();
      const colCount = this.effectiveColCountValue;

      grid.innerHTML = '';
      engine.columns = [];
      engine.loadingSkeletons = [];

      if (forceRecompute || engine.masonryColCount !== colCount || !engine.masonryDistribution.length) {
        this._recomputeMasonryDistribution(colCount);
      }

      for (let i = 0; i < colCount; i += 1) {
        const col = document.createElement('div');
        col.className = 'photos-masonry-col';
        col.dataset.colIndex = String(i);
        grid.appendChild(col);
        engine.columns.push(col);

        // Restore saved column assignments
        const colCards = engine.masonryDistribution[i] || [];
        colCards.forEach((card) => {
          col.appendChild(card);
          card.dataset.masonryCol = String(i);
        });
      }
    },

    _scheduleHeightSync() {
      if (this.layoutMode !== 'aspect') return;
      const engine = this._getEngine();
      if (engine.heightSyncFrame) cancelAnimationFrame(engine.heightSyncFrame);
      engine.heightSyncFrame = requestAnimationFrame(() => {
        engine.heightSyncFrame = 0;
        this._syncColumnHeights();
      });
    },

    _syncColumnHeights() {
      const engine = this._getEngine();
      if (this.layoutMode !== 'aspect' || !engine.columns.length) return;

      const gap = this._getMasonryGapPx();
      engine.columnHeights = engine.columns.map((column) => {
        let total = 0;
        Array.from(column.children).forEach((child, index) => {
          total += child.getBoundingClientRect().height || this._estimateCardHeight(child);
          if (index < column.children.length - 1) total += gap;
        });
        return total;
      });
    },

    _showLoadingSkeletons() {
      const engine = this._getEngine();
      if (engine.loadingSkeletons.length) return;

      const count = Math.min(Math.max(this.effectiveColCountValue * 2, 4), SKELETON_HEIGHTS.length);
      const skeletons = SKELETON_HEIGHTS.slice(0, count).map((height, index) => createSkeletonCard(height, index));
      engine.loadingSkeletons = skeletons;

      const grid = this._getGrid();
      if (!grid) return;

      if (this.layoutMode === 'aspect' && engine.columns.length) {
        skeletons.forEach((card) => this._appendCardToMasonry(card));
      } else {
        skeletons.forEach((card) => grid.appendChild(card));
      }
    },

    _clearLoadingSkeletons(skipSync = false) {
      const engine = this._getEngine();
      engine.loadingSkeletons.forEach((card) => card.remove());
      engine.loadingSkeletons = [];
      if (!skipSync) {
        this._scheduleHeightSync();
      }
    },

    renderLayout({ recapture = false, forceMasonryRecompute = false } = {}) {
      this.syncEffectiveColCount();
      if (this.isAlbumsView()) {
        this.syncChromeControls();
        return;
      }

      const grid = this._getGrid();
      if (!grid) return;

      const engine = this._getEngine();
      if (recapture || !engine.cards.length) {
        this._captureInitialCards();
      }

      this._clearLoadingSkeletons(true);

      if (this.layoutMode === 'aspect') {
        this._renderMasonryLayout({ forceRecompute: forceMasonryRecompute });
      } else {
        this._renderSquareLayout();
      }

      this.hydrateGridImages(grid);
      this.syncChromeControls();
      this._scheduleHeightSync();
    },

    setLayoutMode(mode) {
      if (mode !== 'square' && mode !== 'aspect') return;
      if (this.layoutMode === mode) return;

      this.layoutMode = mode;
      this.persistPreferences();
      this.$nextTick(() => {
        if (mode === 'aspect') {
          this.invalidateMasonryLayout();
        }
        this.renderLayout({ forceMasonryRecompute: mode === 'aspect' });
      });
    },

    _appendNewCards(cards) {
      const engine = this._getEngine();
      const grid = this._getGrid();
      if (!grid || !cards.length) return;

      engine.cards.push(...cards);
      this._clearLoadingSkeletons(true);

      if (this.layoutMode === 'aspect' && engine.columns.length) {
        cards.forEach((card) => {
          const columnIndex = this._findShortestColumnIndex();
          const column = engine.columns[columnIndex];
          const gap = this._getMasonryGapPx();
          const hadItems = column.children.length > 0;
          
          column.appendChild(card);
          card.dataset.masonryCol = String(columnIndex);
          
          const estimatedHeight = this._estimateCardHeight(card, columnIndex);
          engine.columnHeights[columnIndex] += estimatedHeight + (hadItems ? gap : 0);
          
          if (engine.masonryDistribution[columnIndex]) {
            engine.masonryDistribution[columnIndex].push(card);
          }
        });
      } else {
        cards.forEach((card) => grid.appendChild(card));
        this.invalidateMasonryLayout();
      }

      this.hydrateGridImages(grid);
      this.syncChromeControls();
      this._scheduleHeightSync();
    },

    _initInfiniteScroll() {
      this._observer?.disconnect();
      this._observer = null;
      this._paginationRetryCleanup?.();
      this._paginationRetryCleanup = null;
      this._paginationLoadMore = null;
      this._paginationController?.abort();
      this._paginationController = null;
      this._paginationGeneration += 1;
      const generation = this._paginationGeneration;
      const componentRoot = this.$el;
      let nextUrlEl = this.$el?.querySelector('#next-page-url');
      const spinner = this.$el?.querySelector('#photos-loading-spinner');
      const noMore = this.$el?.querySelector('#photos-no-more');
      const loadError = this.$el?.querySelector('#photos-load-error');
      const loadErrorText = this.$el?.querySelector('[data-photos-load-error-text]');
      const retryButton = this.$el?.querySelector('[data-photos-retry]');
      const sentinel = this.$el?.querySelector('.photos-scroll-sentinel');
      const loadedPageUrls = new Set();
      spinner?.classList.add('hidden');
      this._clearLoadingSkeletons();

      const normalizePageUrl = (value) => {
        if (!value) return '';
        const url = new URL(value, window.location.href);
        if (url.origin !== window.location.origin || !/^\/photos(?:\/|$)/.test(url.pathname)) {
          throw new Error(`非法的图库分页链接：${url.href}`);
        }
        return url.href;
      };

      const hideError = () => {
        loadError?.classList.add('hidden');
      };

      const showError = (message) => {
        if (loadErrorText) loadErrorText.textContent = message;
        loadError?.classList.remove('hidden');
      };

      if (!nextUrlEl || !sentinel) {
        noMore?.classList.remove('hidden');
        hideError();
        return;
      }

      let isLoading = false;
      const loadMore = async () => {
        if (isLoading || !nextUrlEl || this._destroyed) return;
        isLoading = true;
        hideError();
        spinner?.classList.remove('hidden');
        this._showLoadingSkeletons();
        const controller = new AbortController();
        this._paginationController?.abort();
        this._paginationController = controller;
        const requestLocation = `${window.location.pathname}${window.location.search}`;
        let requestUrl = '';
        const isCurrent = () => !controller.signal.aborted
          && !this._destroyed
          && this._paginationGeneration === generation
          && componentRoot?.isConnected !== false
          && this.$el === componentRoot
          && `${window.location.pathname}${window.location.search}` === requestLocation;

        try {
          requestUrl = normalizePageUrl(nextUrlEl.href);
          const response = await fetch(requestUrl, {
            credentials: 'same-origin',
            headers: { Accept: 'text/html' },
            signal: controller.signal
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const html = await response.text();
          if (!isCurrent()) return;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const responseRoot = doc.querySelector('[data-app-root="photos"]') || doc;
          const cards = Array.from(responseRoot.querySelectorAll('.photo-card'));
          if (cards.length === 0) {
            throw new Error('分页响应中没有可追加的 .photo-card');
          }

          const newNext = responseRoot.querySelector('#next-page-url');
          const newNextUrl = newNext?.href ? normalizePageUrl(newNext.href) : '';
          if (newNextUrl && (newNextUrl === requestUrl || loadedPageUrls.has(newNextUrl))) {
            throw new Error('分页响应返回了重复的下一页链接');
          }
          if (!isCurrent()) return;

          this._appendNewCards(cards);
          loadedPageUrls.add(requestUrl);

          if (newNextUrl) {
            nextUrlEl.href = newNextUrl;
            noMore?.classList.add('hidden');
          } else {
            nextUrlEl.remove();
            nextUrlEl = null;
            this._observer?.disconnect();
            noMore?.classList.remove('hidden');
          }
        } catch (error) {
          if (!isCurrent()) return;
          noMore?.classList.add('hidden');
          showError('下一页加载失败，请重试。');
          this._observer?.unobserve?.(sentinel);
          warnApiCall('photos', '图库下一页加载失败', {
            url: requestUrl || nextUrlEl?.href || '',
            message: error?.message || String(error || ''),
            action: 'show-retry',
            hint: '检查 Photos 分页链接、返回 HTML 中的 .photo-card 和下一页标记 #next-page-url。'
          });
        } finally {
          if (this._paginationController === controller) {
            this._paginationController = null;
            isLoading = false;
            spinner?.classList.add('hidden');
            this._clearLoadingSkeletons();
          }
        }
      };
      this._paginationLoadMore = loadMore;

      if (retryButton) {
        const retry = () => {
          hideError();
          void loadMore();
          this._observer?.observe?.(sentinel);
        };
        retryButton.addEventListener('click', retry);
        this._paginationRetryCleanup = () => retryButton.removeEventListener('click', retry);
      }

      this._observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !isLoading) {
            loadMore();
          }
        },
        { rootMargin: '400px' }
      );

      this._observer.observe(sentinel);
    },

    _installResizeHandler() {
      const engine = this._getEngine();
      if (engine.resizeHandler || engine.resizeObserver) return;

      engine.resizeHandler = () => {
        clearTimeout(engine.resizeTimer);
        engine.resizeTimer = setTimeout(() => {
          if (this.isDetailView()) {
            this.updatePhotoPanAvailability();
            return;
          }

          const nextEffectiveCount = this._resolveEffectiveColCount();
          if (nextEffectiveCount !== this.effectiveColCountValue) {
            this.renderLayout();
            return;
          }

          this.effectiveColCountValue = nextEffectiveCount;
          this._scheduleHeightSync();
        }, 120);
      };

      window.addEventListener('resize', engine.resizeHandler);

      if ('ResizeObserver' in window) {
        const observedTarget = this._getAlbumContainer() || this._getWindowSurface() || this.$el;
        if (observedTarget) {
          engine.resizeObserver = new ResizeObserver(() => {
            engine.resizeHandler();
          });
          engine.resizeObserver.observe(observedTarget);
        }
      }
    },

    increaseCols() {
      if (this.isAlbumsView()) {
        const nextAlbumCols = Math.min(this._maxAlbumColCount(), this.effectiveColCountValue + 1);
        if (nextAlbumCols === this.effectiveColCountValue) return;
        this.albumCols = nextAlbumCols;
      } else if (this.layoutMode === 'aspect') {
        const nextAspectCols = Math.min(this._maxGridColCount(), this.effectiveColCountValue + 1);
        if (nextAspectCols === this.effectiveColCountValue) return;
        this.aspectCols = nextAspectCols;
      } else {
        const nextSquareCols = Math.min(this._maxGridColCount(), this.effectiveColCountValue + 1);
        if (nextSquareCols === this.effectiveColCountValue) return;
        this.squareCols = nextSquareCols;
      }
      this.persistPreferences();
      this.$nextTick(() => {
        this.renderLayout();
        this.syncChromeControls();
      });
    },

    decreaseCols() {
      if (this.isAlbumsView()) {
        const nextAlbumCols = Math.max(this._minColCount(), this.effectiveColCountValue - 1);
        if (nextAlbumCols === this.effectiveColCountValue) return;
        this.albumCols = nextAlbumCols;
      } else if (this.layoutMode === 'aspect') {
        const nextAspectCols = Math.max(this._minColCount(), this.effectiveColCountValue - 1);
        if (nextAspectCols === this.effectiveColCountValue) return;
        this.aspectCols = nextAspectCols;
      } else {
        const nextSquareCols = Math.max(this._minColCount(), this.effectiveColCountValue - 1);
        if (nextSquareCols === this.effectiveColCountValue) return;
        this.squareCols = nextSquareCols;
      }
      this.persistPreferences();
      this.$nextTick(() => {
        this.renderLayout();
        this.syncChromeControls();
      });
    },

    init() {
      this._destroyed = false;
      const hasPreferences = hasSavedPreferences();
      this.restorePreferences();
      if (!hasPreferences && this._isCompactSurface()) {
        this.squareCols = COMPACT_DEFAULT_COL_COUNT;
        this.aspectCols = COMPACT_DEFAULT_COL_COUNT;
        this.albumCols = COMPACT_DEFAULT_COL_COUNT;
      }
      this.syncEffectiveColCount();
      this._getEngine();

      this.$nextTick(() => {
        if (this._destroyed || !this.$el?.isConnected) return;
        this._installSurfaceControls();
        if (this.isDetailView()) {
          this._installDetailViewerControls();
        }
        if (!this.isDetailView()) {
          this._captureInitialCards();
          this.renderLayout();
        }
        this.syncChromeControls();
        this._installResizeHandler();
        if (!this.isDetailView()) {
          this._initInfiniteScroll();
        }
      });
    },

    destroy() {
      const engine = this._getEngine();
      this._destroyed = true;
      this._paginationGeneration += 1;
      this._paginationController?.abort();
      this._paginationController = null;
      this._paginationLoadMore = null;
      this._paginationRetryCleanup?.();
      this._paginationRetryCleanup = null;
      this._releasePhotoPanSession();
      if (engine.surfaceCleanup) {
        engine.surfaceCleanup();
        engine.surfaceCleanup = null;
      }
      if (engine.detailCleanup) {
        engine.detailCleanup();
        engine.detailCleanup = null;
      }

      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }

      if (engine.resizeHandler) {
        window.removeEventListener('resize', engine.resizeHandler);
        engine.resizeHandler = null;
      }

      if (engine.resizeObserver) {
        engine.resizeObserver.disconnect();
        engine.resizeObserver = null;
      }

      clearTimeout(engine.resizeTimer);

      if (engine.heightSyncFrame) {
        cancelAnimationFrame(engine.heightSyncFrame);
        engine.heightSyncFrame = 0;
      }

      this._clearLoadingSkeletons(true);

    },
  }));
}
