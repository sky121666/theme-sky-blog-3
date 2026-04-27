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
    lightboxOpen: false,
    currentUrl: '',
    currentDesc: '',
    currentName: '',
    currentDate: '',
    squareCols: DEFAULT_COL_COUNT,
    aspectCols: DEFAULT_COL_COUNT,
    albumCols: DEFAULT_ALBUM_COL_COUNT,
    effectiveColCountValue: DEFAULT_COL_COUNT,
    layoutMode: 'square',
    _observer: null,
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

      const onSetMode = (event) => {
        const mode = event.detail?.mode;
        if (mode) this.setLayoutMode(mode);
      };
      const onIncrease = () => this.increaseCols();
      const onDecrease = () => this.decreaseCols();

      surface.addEventListener('photos:set-mode', onSetMode);
      surface.addEventListener('photos:cols-increase', onIncrease);
      surface.addEventListener('photos:cols-decrease', onDecrease);

      engine.surfaceCleanup = () => {
        surface.removeEventListener('photos:set-mode', onSetMode);
        surface.removeEventListener('photos:cols-increase', onIncrease);
        surface.removeEventListener('photos:cols-decrease', onDecrease);
      };
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
      let nextUrlEl = this.$el?.querySelector('#next-page-url');
      const spinner = this.$el?.querySelector('#photos-loading-spinner');
      const noMore = this.$el?.querySelector('#photos-no-more');
      const sentinel = this.$el?.querySelector('.photos-scroll-sentinel');

      if (!nextUrlEl || !sentinel) {
        noMore?.classList.remove('hidden');
        return;
      }

      let isLoading = false;
      const loadMore = async () => {
        if (isLoading || !nextUrlEl) return;
        isLoading = true;
        spinner?.classList.remove('hidden');
        this._showLoadingSkeletons();

        try {
          const response = await fetch(nextUrlEl.href);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const cards = Array.from(doc.querySelectorAll('.photo-card'));

          this._appendNewCards(cards);

          const newNext = doc.querySelector('#next-page-url');
          if (newNext?.href) {
            nextUrlEl.href = newNext.href;
            noMore?.classList.add('hidden');
          } else {
            nextUrlEl.remove();
            nextUrlEl = null;
            this._observer?.disconnect();
            noMore?.classList.remove('hidden');
          }
        } catch (error) {
          noMore?.classList.add('hidden');
          console.error('[photos] 无限滚动加载失败:', error);
        } finally {
          isLoading = false;
          spinner?.classList.add('hidden');
          this._clearLoadingSkeletons();
        }
      };

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

    openLightbox(event) {
      const el = event.currentTarget;
      if (!el?.dataset) return;

      this.currentUrl = el.dataset.photoUrl || '';
      this.currentDesc = el.dataset.photoDesc || '';
      this.currentName = el.dataset.photoName || '';
      this.currentDate = el.dataset.photoDate || '';
      this.lightboxOpen = true;
      document.body.style.overflow = 'hidden';
    },

    closeLightbox() {
      if (!this.lightboxOpen) return;

      this.lightboxOpen = false;
      document.body.style.overflow = '';

      setTimeout(() => {
        if (!this.lightboxOpen) {
          this.currentUrl = '';
          this.currentDesc = '';
          this.currentName = '';
          this.currentDate = '';
        }
      }, 300);
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
        this._installSurfaceControls();
        this._captureInitialCards();
        this.renderLayout();
        this.syncChromeControls();
        this._installResizeHandler();
        this._initInfiniteScroll();
      });
    },

    destroy() {
      const engine = this._getEngine();
      if (engine.surfaceCleanup) {
        engine.surfaceCleanup();
        engine.surfaceCleanup = null;
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

      if (this.lightboxOpen) {
        this.lightboxOpen = false;
        document.body.style.overflow = '';
      }
    },
  }));
}
