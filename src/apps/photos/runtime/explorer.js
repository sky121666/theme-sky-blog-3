import { isCompleteHtmlDocument, isHtmlDocumentResponse } from '../../../shared/html-document.js';
import { withRequestDeadline } from '../../../shared/request-deadline.js';
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
import { watchCommentPermalink } from '../../../shared/comment-permalink.js';

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
const DETAIL_FILMSTRIP_IDLE_DELAY_MS = 3_200;
const DETAIL_FILMSTRIP_ACTIVITY_THROTTLE_MS = 180;
const DETAIL_WINDOW_TRANSITION_SETTLE_MS = 360;

// A native loading=lazy strip may fetch every thumbnail within the browser's
// generous offscreen threshold. Observe the horizontal strip itself instead.
function watchFilmstripThumbnails(list) {
  if (!list) return () => {};
  const pending = list.querySelectorAll('img[data-photos-thumb]');
  const reveal = (image) => {
    image.src = image.dataset.photosThumb;
    delete image.dataset.photosThumb;
  };
  if (!pending.length) return () => {};
  if (!('IntersectionObserver' in window)) {
    pending.forEach(reveal);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !entry.target.isConnected || !entry.target.dataset.photosThumb) continue;
      observer.unobserve(entry.target);
      reveal(entry.target);
    }
  }, { root: list, rootMargin: '0px 64px' });
  pending.forEach(image => observer.observe(image));
  return () => observer.disconnect();
}

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
    _commentPermalinkCleanup: null,
    _destroyed: false,
    _lifecycleGeneration: 0,
    _engine: null,

    _queueLayoutUpdate(callback) {
      const generation = this._lifecycleGeneration;
      const root = this.$el;
      this.$nextTick(() => {
        if (this._destroyed || generation !== this._lifecycleGeneration
          || this.$el !== root || root?.isConnected === false) return;
        callback();
      });
    },

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
        if (action === 'zoom-reset') this.resetPhotoZoom();
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
        this.setCommentsOpen(false, { restoreFocus: true });
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
      this._syncPhotoTransform();
    },

    // The loaded preview and the full image inherit the same transform, even
    // when the original has no intrinsic size yet or finishes decoding mid-pan.
    _syncPhotoTransform() {
      this._getDetailStage()?.style?.setProperty('--photos-view-transform',
        `translate(calc(-50% + ${this.panX}px), calc(-50% + ${this.panY}px)) scale(${this.zoomLevel})`);
    },

    resetPhotoZoom() {
      this.zoomLevel = 1;
      this.resetPhotoPan();
      this.syncDetailChromeControls();
    },

    clampPhotoPan() {
      const { x:maxX, y:maxY } = this._photoPanBounds();
      this.panX = maxX > 0
        ? Math.max(-maxX, Math.min(maxX, Number(this.panX) || 0))
        : 0;
      this.panY = maxY > 0
        ? Math.max(-maxY, Math.min(maxY, Number(this.panY) || 0))
        : 0;
      this.photoCanPan = this.isDetailView() && (maxX > 0.5 || maxY > 0.5);
      this._syncPhotoTransform();

      if (!this.photoCanPan) {
        this._releasePhotoPanSession();
      }

      return this.photoCanPan;
    },

    _photoPanBounds() {
      const stage = this._getDetailStage();
      const preview = stage?.querySelector?.('.photos-detail-preview');
      const image = preview || this._getDetailImage();
      if (!stage || !image) return { x:0, y:0 };
      let width = image.offsetWidth;
      let height = image.offsetHeight;
      if (preview?.naturalWidth && preview.naturalHeight) {
        // object-fit: contain leaves letterbox space; only real image pixels
        // should contribute to the allowable drag distance.
        const fit = Math.min(width / preview.naturalWidth, height / preview.naturalHeight);
        width = preview.naturalWidth * fit;
        height = preview.naturalHeight * fit;
      }
      return {
        x:Math.max(0, (width * this.zoomLevel - stage.clientWidth) / 2),
        y:Math.max(0, (height * this.zoomLevel - stage.clientHeight) / 2)
      };
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
      if (event.target?.closest?.('a, button, input, select, textarea, [contenteditable="true"]')) return;

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
      const imageError = stage.querySelector('[data-photos-detail-image-error]');
      const imageRetry = imageError?.querySelector('[data-photos-image-retry]');
      let imageRetryOwnedFocus = false;

      const shell = this.$el;
      const windowSurface = this._getWindowSurface() || shell;
      const activitySurface = shell?.querySelector('.photos-detail-main') || shell;
      const filmstrip = shell?.querySelector('.photos-detail-filmstrip') || null;
      const maximizeControl = windowSurface?.querySelector('.traffic-btn.maximize') || null;
      const autoHideQuery = window.matchMedia?.('(hover: hover) and (pointer: fine)') || null;
      let filmstripHideTimer = 0;
      let filmstripFocusFrame = 0;
      let filmstripWindowTransitionTimer = 0;
      let filmstripWindowTransitionLocked = false;
      let filmstripPointerLocked = false;
      let lastFilmstripActivityAt = 0;
      let lastPointerX = null;
      let lastPointerY = null;

      const clearFilmstripHideTimer = () => {
        if (!filmstripHideTimer) return;
        window.clearTimeout(filmstripHideTimer);
        filmstripHideTimer = 0;
      };
      const clearFilmstripWindowTransition = () => {
        if (filmstripWindowTransitionTimer) {
          window.clearTimeout(filmstripWindowTransitionTimer);
          filmstripWindowTransitionTimer = 0;
        }
        filmstripWindowTransitionLocked = false;
        delete shell.dataset.photosWindowTransition;
      };
      const setFilmstripHidden = (hidden) => {
        if (!filmstrip || !shell?.isConnected) return;
        const nextState = hidden ? 'hidden' : 'visible';
        shell.dataset.photosFilmstripState = nextState;
        filmstrip.dataset.photosFilmstripState = nextState;
        if (hidden) {
          filmstrip.setAttribute('inert', '');
          filmstrip.setAttribute('aria-hidden', 'true');
        } else {
          filmstrip.removeAttribute('inert');
          filmstrip.removeAttribute('aria-hidden');
        }
      };
      const filmstripInteractionLocked = () => Boolean(
        filmstripPointerLocked
        || filmstrip?.matches?.(':hover')
        || filmstrip?.contains?.(document.activeElement)
        || this.photoPanning
      );
      const autoHideAllowed = () => autoHideQuery?.matches !== false;
      const scheduleFilmstripHide = () => {
        clearFilmstripHideTimer();
        if (!filmstrip
          || filmstripWindowTransitionLocked
          || !autoHideAllowed()
          || document.hidden
          || this._destroyed) return;

        filmstripHideTimer = window.setTimeout(() => {
          filmstripHideTimer = 0;
          if (this._destroyed || !shell?.isConnected || filmstripInteractionLocked()) return;
          setFilmstripHidden(true);
        }, DETAIL_FILMSTRIP_IDLE_DELAY_MS);
      };
      const wakeFilmstrip = ({ force = false } = {}) => {
        if (!filmstrip || filmstripWindowTransitionLocked) return;
        const now = Date.now();
        const hidden = shell?.dataset.photosFilmstripState === 'hidden';
        if (!force && !hidden && now - lastFilmstripActivityAt < DETAIL_FILMSTRIP_ACTIVITY_THROTTLE_MS) {
          return;
        }

        lastFilmstripActivityAt = now;
        setFilmstripHidden(false);
        scheduleFilmstripHide();
      };
      const holdFilmstripOpen = () => {
        if (filmstripWindowTransitionLocked) return;
        setFilmstripHidden(false);
        clearFilmstripHideTimer();
      };
      const onWindowMaximizeIntent = () => {
        if (!filmstrip || !autoHideAllowed()) return;
        clearFilmstripWindowTransition();
        filmstripWindowTransitionLocked = true;
        shell.dataset.photosWindowTransition = 'true';
        clearFilmstripHideTimer();
        setFilmstripHidden(true);
        filmstripWindowTransitionTimer = window.setTimeout(() => {
          filmstripWindowTransitionTimer = 0;
          filmstripWindowTransitionLocked = false;
          delete shell.dataset.photosWindowTransition;
        }, DETAIL_WINDOW_TRANSITION_SETTLE_MS);
      };
      const onPointerMoveActivity = (event) => {
        const pointerMovedEnough = lastPointerX == null
          || lastPointerY == null
          || Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY) >= 3;
        const hidden = shell?.dataset.photosFilmstripState === 'hidden';
        if (!hidden && !pointerMovedEnough) return;

        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        wakeFilmstrip();
      };
      const onDirectActivity = () => wakeFilmstrip({ force: true });
      const onFilmstripPointerEnter = () => {
        filmstripPointerLocked = true;
        holdFilmstripOpen();
      };
      const onFilmstripPointerLeave = () => {
        filmstripPointerLocked = false;
        scheduleFilmstripHide();
      };
      const onFilmstripFocusIn = () => holdFilmstripOpen();
      const onFilmstripFocusOut = (event) => {
        if (filmstrip?.contains?.(event.relatedTarget)) return;
        if (filmstripFocusFrame) window.cancelAnimationFrame(filmstripFocusFrame);
        filmstripFocusFrame = window.requestAnimationFrame(() => {
          filmstripFocusFrame = 0;
          if (!filmstrip?.contains?.(document.activeElement)) scheduleFilmstripHide();
        });
      };
      const onVisibilityChange = () => {
        if (document.hidden) {
          clearFilmstripHideTimer();
          return;
        }
        wakeFilmstrip({ force: true });
      };
      const onAutoHideChange = () => {
        if (autoHideAllowed()) {
          wakeFilmstrip({ force: true });
          return;
        }
        holdFilmstripOpen();
      };

      const onWheel = (event) => this.handlePhotoWheel(event);
      const onPointerDown = (event) => this.beginPhotoPan(event);
      const onMouseDown = (event) => this.beginPhotoPan(event);
      const onAuxClick = (event) => event.preventDefault();
      const onDblClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.resetPhotoZoom();
      };
      const preview = stage.querySelector('.photos-detail-preview');
      const loading = stage.querySelector('[data-photos-detail-loading]');
      const isCurrentImage = () => !this._destroyed && shell.isConnected && stage.contains(image);
      let imageAttempt = 0;
      const onImageLoad = () => {
        if (!isCurrentImage()) return;
        const attempt = ++imageAttempt;
        if (loading) loading.hidden = true;
        // The navigation and its snapshot already completed. Keep visible pixels
        // until the native image is decoded; stale completions own no live DOM.
        if (preview?.isConnected) {
          const revealOriginal = () => {
            if (attempt === imageAttempt && isCurrentImage() && image.complete && image.naturalWidth > 0) {
              preview.remove();
              this.updatePhotoPanAvailability();
            }
          };
          if (typeof image.decode === 'function') image.decode().then(revealOriginal, revealOriginal);
          else revealOriginal();
        }
        const restoreImageFocus = (imageRetryOwnedFocus && document.activeElement === document.body)
          || imageError?.contains(document.activeElement);
        imageRetryOwnedFocus = false;
        stage.classList.remove('is-image-error');
        stage.removeAttribute('aria-busy');
        imageError?.setAttribute('hidden', '');
        if (imageRetry) {
          imageRetry.disabled = false;
          imageRetry.textContent = '重新加载图片';
        }
        image.removeAttribute('aria-hidden');
        if (restoreImageFocus) stage.focus({ preventScroll: true });
        this.updatePhotoPanAvailability();
      };
      const onImageError = () => {
        if (!isCurrentImage()) return;
        ++imageAttempt;
        if (loading) loading.hidden = true;
        if (!preview?.isConnected) this.resetPhotoZoom();
        stage.removeAttribute('aria-busy');
        stage.classList.add('is-image-error');
        imageError?.removeAttribute('hidden');
        if (imageRetry) {
          imageRetry.disabled = false;
          imageRetry.textContent = '重新加载图片';
          if (imageRetryOwnedFocus && document.activeElement === document.body) {
            imageRetry.focus({ preventScroll: true });
          }
        }
        imageRetryOwnedFocus = false;
        image.setAttribute('aria-hidden', 'true');
      };
      const onImageRetry = () => {
        if (stage.getAttribute('aria-busy') === 'true') return;
        stage.setAttribute('aria-busy', 'true');
        imageRetryOwnedFocus = document.activeElement === imageRetry;
        imageRetry.disabled = true;
        imageRetry.textContent = '正在重新加载…';
        // Retry only this resource. Reloading the document discards open panels
        // and the visitor's comment draft, and repeats unrelated page requests.
        image.src = image.currentSrc || image.src;
        image.removeAttribute('srcset');
      };
      const currentFilmstripItem = this.$el?.querySelector('.photos-detail-neighbor.is-current');
      // PJAX moves focus to this heading after each detail navigation.
      const detailHeading = shell.querySelector(':scope > h1');
      const isBrowsingTarget = (target) => Boolean(
        target?.nodeType === 1 && (stage.contains(target) || filmstrip?.contains(target)
          || target === detailHeading || target === shell || target === windowSurface
          || (target.matches?.('[data-window-content-root]') && windowSurface.contains(target)))
      );
      const isDocumentTarget = (target) => target === document.body || target === document.documentElement;
      // Clicking a non-focusable photo leaves focus on body. Keep that browsing
      // intent until pointer or keyboard focus moves to another desktop region.
      let bodyNavigationOwned = isDocumentTarget(document.activeElement) || isBrowsingTarget(document.activeElement);
      const onKeyboardRegionChange = (event) => {
        bodyNavigationOwned = isBrowsingTarget(event.target);
      };
      const onKeyDown = (event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Escape' && this._getWindowSurface()?.contains(event.target)) {
          if (this.commentsOpen && (!this.infoOpen || event.target.closest('.photos-detail-comment-drawer'))) {
            this.setCommentsOpen(false, { restoreFocus: true });
          } else if (this.infoOpen) this.setInfoOpen(false, { restoreFocus: true });
          else return;
          wakeFilmstrip({ force: true });
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key !== 'Tab' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (event.repeat) return;
        const manager = this.$store?.windowManager;
        if (this._destroyed || !shell.isConnected || document.hidden
          || manager?.show === false || manager?.minimized || manager?.isAnimating
          || windowSurface.closest('[inert]') || !windowSurface.getClientRects().length
          || window.getComputedStyle(windowSurface).visibility !== 'visible') return;
        if (event.key === 'Tab') {
          if (windowSurface.contains(event.target) || (isDocumentTarget(event.target) && bodyNavigationOwned)) {
            wakeFilmstrip({ force: true });
          }
          return;
        }
        if (!isBrowsingTarget(event.target)
          && !(isDocumentTarget(event.target) && bodyNavigationOwned)) return;
        // Official comment editors live in Shadow DOM; event.target alone is
        // retargeted to the widget host and cannot identify its text controls.
        const eventPath = event.composedPath?.() || [event.target];
        if (eventPath.some((node) => node?.matches?.('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])'))) return;

        const direction = event.key === 'ArrowLeft' ? '上一张' : '下一张';
        const adjacentLink = stage.querySelector(`.photos-detail-adjacent-btn[aria-label="${direction}"]:not(.is-disabled)`);
        if (!adjacentLink) return;
        wakeFilmstrip({ force: true });
        event.preventDefault();
        adjacentLink.click();
      };

      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('mousedown', onMouseDown);
      stage.addEventListener('auxclick', onAuxClick);
      stage.addEventListener('dblclick', onDblClick);
      image.addEventListener('load', onImageLoad);
      image.addEventListener('error', onImageError);
      imageRetry?.addEventListener('click', onImageRetry);
      if (image.complete) {
        if (image.naturalWidth > 0) onImageLoad();
        else onImageError();
      } else {
        stage.setAttribute('aria-busy', 'true');
        if (loading) loading.hidden = Boolean(preview);
      }
      window.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerdown', onKeyboardRegionChange, true);
      document.addEventListener('focusin', onKeyboardRegionChange, true);
      if (filmstrip) {
        shell.dataset.photosFilmstripIdleDelay = String(DETAIL_FILMSTRIP_IDLE_DELAY_MS);
        setFilmstripHidden(false);
        activitySurface?.addEventListener('pointermove', onPointerMoveActivity, { passive: true });
        activitySurface?.addEventListener('pointerdown', onDirectActivity, { passive: true });
        activitySurface?.addEventListener('wheel', onDirectActivity, { passive: true });
        activitySurface?.addEventListener('touchstart', onDirectActivity, { passive: true });
        filmstrip.addEventListener('pointerenter', onFilmstripPointerEnter);
        filmstrip.addEventListener('pointerleave', onFilmstripPointerLeave);
        filmstrip.addEventListener('focusin', onFilmstripFocusIn);
        filmstrip.addEventListener('focusout', onFilmstripFocusOut);
        filmstrip.addEventListener('scroll', onDirectActivity, { passive: true, capture: true });
        maximizeControl?.addEventListener('pointerdown', onWindowMaximizeIntent, true);
        maximizeControl?.addEventListener('click', onWindowMaximizeIntent, true);
        document.addEventListener('visibilitychange', onVisibilityChange);
        autoHideQuery?.addEventListener?.('change', onAutoHideChange);
        scheduleFilmstripHide();
      }

      let stopThumbnailObserver = () => {};
      const positionFrame = requestAnimationFrame(() => {
        if (this._destroyed || !shell.isConnected) return;
        currentFilmstripItem?.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'center'
        });
        stopThumbnailObserver = watchFilmstripThumbnails(filmstrip?.querySelector('.photos-detail-neighbor-list'));
      });

      engine.detailCleanup = () => {
        ++imageAttempt;
        window.cancelAnimationFrame(positionFrame);
        stopThumbnailObserver();
        clearFilmstripHideTimer();
        clearFilmstripWindowTransition();
        if (filmstripFocusFrame) {
          window.cancelAnimationFrame(filmstripFocusFrame);
          filmstripFocusFrame = 0;
        }
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('pointerdown', onPointerDown);
        stage.removeEventListener('mousedown', onMouseDown);
        stage.removeEventListener('auxclick', onAuxClick);
        stage.removeEventListener('dblclick', onDblClick);
        image.removeEventListener('load', onImageLoad);
        image.removeEventListener('error', onImageError);
        imageRetry?.removeEventListener('click', onImageRetry);
        window.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onKeyboardRegionChange, true);
        document.removeEventListener('focusin', onKeyboardRegionChange, true);
        if (filmstrip) {
          activitySurface?.removeEventListener('pointermove', onPointerMoveActivity);
          activitySurface?.removeEventListener('pointerdown', onDirectActivity);
          activitySurface?.removeEventListener('wheel', onDirectActivity);
          activitySurface?.removeEventListener('touchstart', onDirectActivity);
          filmstrip.removeEventListener('pointerenter', onFilmstripPointerEnter);
          filmstrip.removeEventListener('pointerleave', onFilmstripPointerLeave);
          filmstrip.removeEventListener('focusin', onFilmstripFocusIn);
          filmstrip.removeEventListener('focusout', onFilmstripFocusOut);
          filmstrip.removeEventListener('scroll', onDirectActivity, true);
          maximizeControl?.removeEventListener('pointerdown', onWindowMaximizeIntent, true);
          maximizeControl?.removeEventListener('click', onWindowMaximizeIntent, true);
          document.removeEventListener('visibilitychange', onVisibilityChange);
          autoHideQuery?.removeEventListener?.('change', onAutoHideChange);
          filmstrip.removeAttribute('inert');
          filmstrip.removeAttribute('aria-hidden');
          delete filmstrip.dataset.photosFilmstripState;
          delete shell.dataset.photosFilmstripState;
          delete shell.dataset.photosFilmstripIdleDelay;
        }
      };

      this.updatePhotoPanAvailability();
    },

    toggleInfo() {
      this.setInfoOpen(!this.infoOpen, { restoreFocus: this.infoOpen });
    },

    setInfoOpen(open, { restoreFocus = false } = {}) {
      this.infoOpen = open;
      this.syncDetailChromeControls();
      if (open) {
        this._queueLayoutUpdate(() => {
          if (this.infoOpen) this.$el.querySelector('.photos-detail-popover')?.focus({ preventScroll: true });
        });
      } else if (restoreFocus) {
        this._getWindowSurface()?.querySelector('[data-photos-detail-info-btn]')?.focus({ preventScroll: true });
      }
    },

    toggleComments() {
      this.setCommentsOpen(!this.commentsOpen, { restoreFocus: this.commentsOpen });
    },

    setCommentsOpen(open, { restoreFocus = false } = {}) {
      this.commentsOpen = open;
      this.syncDetailChromeControls();
      if (open) {
        this._queueLayoutUpdate(() => {
          if (this.commentsOpen) this.$el.querySelector('.photos-detail-comment-head button')?.focus({ preventScroll: true });
        });
      } else if (restoreFocus) {
        this._getWindowSurface()?.querySelector('[data-photos-detail-comments-btn]')?.focus({ preventScroll: true });
      }
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
        zoomInput.setAttribute('aria-valuetext', `${Math.round(this.zoomLevel * 100)}%`);
      }
      const zoomOut = surface.querySelector('[data-photos-control="zoom-out"]');
      const zoomIn = surface.querySelector('[data-photos-control="zoom-in"]');
      if (zoomOut) zoomOut.disabled = this.zoomLevel <= 0.5;
      if (zoomIn) zoomIn.disabled = this.zoomLevel >= 2.2;
      const zoomLabel = surface.querySelector('[data-photos-zoom-label]');
      if (zoomLabel) zoomLabel.textContent = `${Math.round(this.zoomLevel * 100)}%`;

      const backLink = surface.querySelector('.photos-detail-titlebar-back');
      const listUrl = this.$el?.dataset.photosListUrl || '/photos';
      if (backLink && backLink.getAttribute('href') !== listUrl) {
        backLink.setAttribute('href', listUrl);
      }

      const infoButton = surface.querySelector('[data-photos-detail-info-btn]');
      if (infoButton) {
        infoButton.classList.toggle('is-active', this.infoOpen);
        infoButton.setAttribute('aria-pressed', this.infoOpen ? 'true' : 'false');
        infoButton.setAttribute('aria-expanded', this.infoOpen ? 'true' : 'false');
      }

      const commentsButton = surface.querySelector('[data-photos-detail-comments-btn]');
      if (commentsButton) {
        commentsButton.classList.toggle('is-active', this.commentsOpen);
        commentsButton.setAttribute('aria-pressed', this.commentsOpen ? 'true' : 'false');
        commentsButton.setAttribute('aria-expanded', this.commentsOpen ? 'true' : 'false');
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

      const hasPendingLazySource = () => Boolean(img.dataset.src || img.dataset.srcset);
      const isPlaceholder = (source) => /(?:^|\/)transparent\.svg(?:[?#]|$)/.test(source || '');
      const settle = (failed) => {
        if (img.dataset.settled) return;
        img.dataset.settled = '1';
        const stateClass = failed ? 'ph-error' : 'ph-loaded';
        const otherClass = failed ? 'ph-loaded' : 'ph-error';
        img.classList.remove(otherClass);
        img.classList.add(stateClass);
        const card = img.closest('.photo-card');
        card?.classList.remove(otherClass);
        card?.classList.add(stateClass);
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        this._scheduleHeightSync();
      };

      const onLoad = () => {
        if (hasPendingLazySource()) return;
        if (isPlaceholder(img.currentSrc || img.src)) {
          if (isPlaceholder(img.src)) settle(true);
          return;
        }
        if (img.complete && img.naturalWidth > 0) settle(false);
        else if (img.complete) settle(true);
      };
      const onError = () => {
        if (!hasPendingLazySource()) settle(true);
      };

      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      if (!hasPendingLazySource() && img.complete) onLoad();
    },

    _syncGridImageSizes(grid) {
      if (!grid) return;
      // Read one slot after layout; all cards share its width, including masonry.
      const width = Math.ceil(grid.querySelector('.photo-card:not([data-skeleton])')?.getBoundingClientRect().width || 0);
      if (!width) return;
      const sizes = `${width}px`;
      for (const image of grid.querySelectorAll('img.photo-card-img')) {
        if (image.dataset.srcset) image.dataset.sizes = sizes;
        else if (image.srcset && image.sizes !== sizes) image.sizes = sizes;
      }
    },

    hydrateGridImages(root = this.$el) {
      if (!root) return;
      this._syncGridImageSizes(this._getGrid());
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
      this._queueLayoutUpdate(() => {
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
          const html = await withRequestDeadline(async (signal) => {
            const response = await fetch(requestUrl, {
              credentials: 'same-origin',
              headers: { Accept: 'text/html' },
              signal
            });
            if (!isHtmlDocumentResponse(response) || response.redirected) throw new Error(`Unexpected photos response: HTTP ${response.status}`);
            return response.text();
          }, { signal: controller.signal });
          if (!isCurrent()) return;
          if (!isCompleteHtmlDocument(html)) throw new Error('图库分页文档不完整');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const responseRoot = doc.querySelector('[data-app-root="photos"]');
          if (!responseRoot) {
            throw new Error('图库分页响应缺少 Photos 应用根节点');
          }
          const cards = Array.from(responseRoot.querySelectorAll('.photo-card'));
          if (cards.length === 0) {
            loadedPageUrls.add(requestUrl);
            nextUrlEl.remove();
            nextUrlEl = null;
            this._observer?.disconnect();
            noMore?.classList.remove('hidden');
            return;
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
          this._syncGridImageSizes(this._getGrid());
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
      this._queueLayoutUpdate(() => {
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
      this._queueLayoutUpdate(() => {
        this.renderLayout();
        this.syncChromeControls();
      });
    },

    init() {
      this._destroyed = false;
      this._lifecycleGeneration += 1;
      const hasPreferences = hasSavedPreferences();
      this.restorePreferences();
      if (!hasPreferences && this._isCompactSurface()) {
        this.squareCols = COMPACT_DEFAULT_COL_COUNT;
        this.aspectCols = COMPACT_DEFAULT_COL_COUNT;
        this.albumCols = COMPACT_DEFAULT_COL_COUNT;
      }
      this.syncEffectiveColCount();
      this._getEngine();

      this._queueLayoutUpdate(() => {
        if (this._destroyed || !this.$el?.isConnected) return;
        this._installSurfaceControls();
        if (this.isDetailView()) {
          this._installDetailViewerControls();
          this._commentPermalinkCleanup?.();
          let permalinkOpened = false;
          let previousCommentsOpen = this.commentsOpen;
          this._commentPermalinkCleanup = watchCommentPermalink(this.$el, (target) => {
            if (target) {
              if (!permalinkOpened) previousCommentsOpen = this.commentsOpen;
              permalinkOpened = true;
              this.commentsOpen = true;
              this.syncDetailChromeControls();
            } else if (permalinkOpened) {
              permalinkOpened = false;
              this.commentsOpen = previousCommentsOpen;
              this.syncDetailChromeControls();
            }
          });
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
      this._commentPermalinkCleanup?.();
      this._commentPermalinkCleanup = null;
      this._lifecycleGeneration += 1;
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
