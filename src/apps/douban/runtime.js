import { withRequestDeadline } from '../../shared/request-deadline.js';
import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

const API_BASE = '/apis/api.douban.moony.la/v1alpha1/doubanmovies';
const PAGE_SIZE = 20;
const METADATA_TTL_MS = 60_000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function routeFilters() {
  const params = new URLSearchParams(globalThis.window?.location?.search || '');
  const status = params.get('status');
  return {
    type: normalize(params.get('type')) || 'movie',
    dataType: normalize(params.get('dataType')),
    status: ['mark', 'doing', 'done'].includes(status) ? status : 'all',
    genre: normalize(params.get('genre')) || 'all',
    keyword: normalize(params.get('keyword')),
    page: positiveInteger(params.get('page'), 1),
    pageSize: positiveInteger(params.get('size'), PAGE_SIZE)
  };
}

const FALLBACK_TYPES = [
  { key: 'movie', name: '电影', doubanCount: 0 },
  { key: 'book', name: '图书', doubanCount: 0 },
  { key: 'music', name: '音乐', doubanCount: 0 },
  { key: 'game', name: '游戏', doubanCount: 0 },
  { key: 'drama', name: '舞台剧', doubanCount: 0 }
];

const STATUS_LABELS = {
  movie: { mark: '想看', doing: '在看', done: '看过' },
  book: { mark: '想读', doing: '在读', done: '读过' },
  music: { mark: '想听', doing: '在听', done: '听过' },
  game: { mark: '想玩', doing: '在玩', done: '玩过' },
  drama: { mark: '想看', doing: '在看', done: '看过' }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function decodeHtml(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeIconSvg(value) {
  const raw = normalize(value);
  if (!raw) return '';

  if (raw.startsWith('<svg')) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw);
    const parsedValue = normalize(parsed?.value);
    if (parsedValue.startsWith('<svg')) {
      return parsedValue;
    }
  } catch (_error) {
    const match = raw.match(/"value"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"|})/);
    if (match?.[1]) {
      const decoded = decodeHtml(match[1].replace(/\\"/g, '"'));
      if (decoded.startsWith('<svg')) {
        return decoded;
      }
    }
  }

  return '';
}

function numberValue(value) {
  const number = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function firstNonEmpty(...values) {
  return values.find((value) => normalize(value)) || '';
}

function getSpec(item) {
  // 1.2.6 的公开 API 返回扁平 DoubanMovieData；旧版返回 spec/faves。
  return item?.spec || item || {};
}

function getFaves(item) {
  return item?.faves || {
    status: item?.favesStatus,
    score: item?.favesScore,
    createTime: item?.favesCreateTime,
    remark: item?.favesRemark
  };
}

function itemId(item) {
  const spec = getSpec(item);
  return firstNonEmpty(spec.id, item?.metadata?.name, spec.name, spec.link);
}

function genresOf(item) {
  const genres = getSpec(item).genres;
  if (!genres) return [];
  if (Array.isArray(genres)) return genres.map(normalize).filter(Boolean);
  if (genres instanceof Set) return Array.from(genres).map(normalize).filter(Boolean);
  return String(genres).split(',').map(normalize).filter(Boolean);
}

function collectionPoster(url, alt = '') {
  const image = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('is-loaded')" onerror="this.style.display='none'" />` : '';
  return `${image}<span class="douban-poster-fallback" aria-hidden="true"><span class="icon-[lucide--image-off]"></span></span>`;
}

function typeLabels(type) {
  return STATUS_LABELS[type] || STATUS_LABELS.movie;
}

function scoreStars(score) {
  const value = numberValue(score);
  if (!value) return '未评星';
  const count = Math.max(0, Math.min(5, Math.round(value)));
  return `${'★'.repeat(count)}${'☆'.repeat(5 - count)}`;
}

function isEditableKeyTarget(target) {
  if (!target || target === document || target === globalThis.window) return false;
  const tagName = String(target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tagName)) return true;
  if (target.isContentEditable === true) return true;
  return Boolean(target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

function withParams(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => url.searchParams.append(key, item));
      return;
    }
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return `${url.pathname}${url.search}`;
}

async function fetchJson(path, params = {}, signal) {
  const requestUrl = withParams(path, params);
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      signal: requestSignal
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.url = requestUrl;
      throw error;
    }
    return response.json();
  }, { signal });
}

export class DoubanApp {
  constructor(root) {
    this.root = root;
    this.abortController = null;
    this.paginationController = null;
    this.typesController = null;
    this.metadataRequest = null;
    this.metadataCache = new Map();
    this.destroyed = false;
    this.disposeRoot = () => this.destroy();
    this.requestGeneration = 0;
    this.reloadPending = false;
    this.loadError = false;
    this.quickLookPreviousFocus = null;
    this.quickLookInertTargets = [];
    this.searchTimer = null;
    this.state = {
      viewMode: 'grid',
      type: 'movie',
      status: 'all',
      genre: 'all',
      keyword: '',
      page: 1,
      total: 0,
      hasMore: false,
      items: [],
      visibleItems: [],
      focusedId: '',
      ...routeFilters()
    };

    this.onClick = this.onClick.bind(this);
    this.onInput = this.onInput.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
  }

  mount() {
    if (!this.root) return () => {};

    this.root.__doubanAppDispose?.();
    this.destroyed = false;
    this.root.__doubanAppDispose = this.disposeRoot;

    this.renderProfileIcon();
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    document.addEventListener('keydown', this.onKeydown);

    this.renderTypes(FALLBACK_TYPES);
    this.renderStatuses();
    this.queryAll('[data-douban-search], [data-douban-search-mobile]').forEach((input) => {
      input.value = this.state.keyword;
    });
    this.setViewMode(this.state.viewMode, false);
    this.loadTypes();
    this.reload();

    return () => this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController?.abort();
    this.paginationController?.abort();
    this.typesController?.abort();
    this.typesController = null;
    this.metadataRequest?.controller.abort();
    this.metadataRequest = null;
    this.metadataCache.clear();
    this.requestGeneration += 1;
    this.reloadPending = false;
    clearTimeout(this.searchTimer);
    this.closePreview({ restoreFocus: false });
    this.root?.removeEventListener('click', this.onClick);
    this.root?.removeEventListener('input', this.onInput);
    document.removeEventListener('keydown', this.onKeydown);
    if (this.root?.__doubanAppDispose === this.disposeRoot) {
      delete this.root.__doubanAppDispose;
    }
  }

  requestKey() {
    return JSON.stringify({
      type: this.state.type,
      dataType: this.state.dataType,
      pageSize: this.state.pageSize,
      status: this.state.status,
      genre: this.state.genre,
      keyword: this.state.keyword.trim()
    });
  }

  isRequestCurrent(generation, requestKey, signal) {
    return !this.destroyed && !signal?.aborted
      && generation === this.requestGeneration
      && requestKey === this.requestKey()
      && this.root?.isConnected !== false;
  }

  metadataKey() {
    return JSON.stringify([normalize(this.state.type), normalize(this.state.dataType)]);
  }

  prepareMetadata(refresh = false) {
    // Filtered lists share type/dataType metadata, including requests still in flight.
    const key = this.metadataKey();
    if (refresh || this.metadataRequest?.key !== key || this.metadataRequest.controller.signal.aborted) {
      this.metadataRequest?.controller.abort();
      if (refresh || !this.metadataCache.has(key)) this.metadataCache.set(key, new Map());
      this.metadataRequest = {
        key,
        type: this.state.type,
        dataType: this.state.dataType,
        root: this.root,
        controller: new AbortController(),
        values: this.metadataCache.get(key),
        pending: new Map()
      };
    }
    return this.metadataRequest;
  }

  isMetadataCurrent(metadata) {
    return !this.destroyed && !metadata.controller.signal.aborted
      && this.metadataRequest === metadata && metadata.key === this.metadataKey()
      && metadata.root === this.root && this.root?.isConnected !== false;
  }

  cachedMetadataValue(metadata, key) {
    const cached = metadata.values.get(key);
    return cached && Date.now() - cached.updatedAt < METADATA_TTL_MS ? cached : null;
  }

  getMetadataValue(metadata, key, load) {
    const cached = this.cachedMetadataValue(metadata, key);
    if (cached) return Promise.resolve(cached.value);
    if (!metadata.pending.has(key)) {
      const pending = Promise.resolve().then(load).then((value) => {
        if (this.isMetadataCurrent(metadata)) metadata.values.set(key, { value, updatedAt: Date.now() });
        return value;
      }).finally(() => metadata.pending.delete(key));
      metadata.pending.set(key, pending);
    }
    return metadata.pending.get(key);
  }

  query(selector) {
    return this.root.querySelector(selector);
  }

  queryAll(selector) {
    return Array.from(this.root.querySelectorAll(selector));
  }

  renderControlGroup(selector, html, attribute) {
    const target = this.query(selector);
    if (!target) return;
    const focusedKey = target.contains?.(document.activeElement)
      ? document.activeElement.getAttribute(attribute) : null;
    target.innerHTML = html;
    if (focusedKey !== null) {
      Array.from(target.querySelectorAll(`[${attribute}]`))
        .find((button) => button.getAttribute(attribute) === focusedKey)?.focus({ preventScroll: true });
    }
  }

  renderProfileIcon() {
    const iconSlot = this.query('[data-douban-profile-icon]');
    if (!iconSlot) return;

    const svg = normalizeIconSvg(iconSlot.dataset.icon);
    if (!svg) return;

    iconSlot.innerHTML = svg;
    iconSlot.hidden = false;
    this.query('[data-douban-profile-fallback-icon]')?.remove();
  }

  onClick(event) {
    const typeButton = event.target.closest('[data-douban-type]');
    if (typeButton) {
      this.setType(typeButton.dataset.doubanType);
      return;
    }

    const statusButton = event.target.closest('[data-douban-status]');
    if (statusButton) {
      this.setStatus(statusButton.dataset.doubanStatus);
      return;
    }

    const genreButton = event.target.closest('[data-douban-genre]');
    if (genreButton) {
      this.setGenre(genreButton.dataset.doubanGenre);
      return;
    }

    const viewButton = event.target.closest('[data-douban-view]');
    if (viewButton) {
      this.setViewMode(viewButton.dataset.doubanView);
      return;
    }

    if (event.target.closest('[data-douban-mobile-view]')) {
      this.setViewMode(this.state.viewMode === 'grid' ? 'list' : 'grid');
      return;
    }

    if (event.target.closest('[data-douban-retry]')) {
      if (this.state.items.length && this.state.hasMore) this.loadMore();
      else this.reload();
      return;
    }

    if (event.target.closest('[data-douban-clear-filters]')) {
      this.state.status = 'all';
      this.state.genre = 'all';
      this.state.keyword = '';
      this.state.page = 1;
      this.queryAll('[data-douban-search], [data-douban-search-mobile]').forEach((input) => { input.value = ''; });
      clearTimeout(this.searchTimer);
      this.renderStatuses();
      this.renderGenres(this.genres || []);
      this.reload();
      return;
    }

    if (event.target.closest('[data-douban-load-more]')) {
      this.loadMore();
      return;
    }

    const item = event.target.closest('[data-douban-item-id]');
    if (item) {
      this.openPreview(item.dataset.doubanItemId, item);
      return;
    }

    if (event.target.closest('[data-douban-close-preview]')) {
      this.closePreview();
    }
  }

  onInput(event) {
    if (!event.target.matches('[data-douban-search], [data-douban-search-mobile]')) return;

    this.state.keyword = event.target.value;
    this.queryAll('[data-douban-search], [data-douban-search-mobile]').forEach((input) => {
      if (input !== event.target) input.value = event.target.value;
    });

    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.state.page = 1;
      this.reload();
    }, 280);
  }

  onKeydown(event) {
    if (!this.root?.isConnected) return;
    if (isEditableKeyTarget(event.target)) return;

    const hiddenRoot = this.root.closest?.('[hidden], [aria-hidden="true"]');
    if (hiddenRoot) return;
    const targetInsideRoot = this.root.contains?.(event.target) === true;
    const neutralDocumentTarget = event.target === document.body
      || event.target === document.documentElement
      || event.target === document;
    if (document.body?.dataset?.pageApp !== 'douban') return;
    if (!targetInsideRoot && !neutralDocumentTarget) return;

    if (event.key === 'Escape') {
      this.closePreview();
      return;
    }

    const previewOpen = this.query('[data-douban-quicklook]')?.classList.contains('is-open');
    const cardTarget = event.target.closest?.('[data-douban-item-id]');
    if (!previewOpen && cardTarget && event.key === 'Enter') {
      event.preventDefault();
      this.openPreview(cardTarget.dataset.doubanItemId, event.target);
      return;
    }

    if ((event.key === ' ' || event.key === 'Spacebar') && this.state.focusedId && (previewOpen || cardTarget || neutralDocumentTarget)) {
      const quicklook = this.query('[data-douban-quicklook]');
      if (quicklook?.classList.contains('is-open')) {
        event.preventDefault();
        this.closePreview();
      } else {
        event.preventDefault();
        const trigger = this.queryAll('[data-douban-item-id]')
          .find((item) => item.dataset.doubanItemId === this.state.focusedId);
        this.openPreview(cardTarget?.dataset.doubanItemId || this.state.focusedId, event.target === document.body ? trigger : event.target);
      }
      return;
    }

    if (event.key === 'Tab') {
      const quicklook = this.query('[data-douban-quicklook].is-open');
      if (!quicklook) return;
      const focusScope = quicklook.querySelector('[role="dialog"]') || quicklook;
      const focusable = Array.from(focusScope.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!focusScope.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (previewOpen || (!cardTarget && !neutralDocumentTarget)) return;
    const items = this.state.visibleItems;
    if (!items.length) return;

    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => itemId(item) === (cardTarget?.dataset.doubanItemId || this.state.focusedId)));
    const grid = this.query('[data-douban-grid]');
    const columns = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
    let nextIndex = currentIndex;

    if (this.state.viewMode === 'grid') {
      if (event.key === 'ArrowUp') nextIndex -= columns;
      if (event.key === 'ArrowDown') nextIndex += columns;
      if (event.key === 'ArrowLeft') nextIndex -= 1;
      if (event.key === 'ArrowRight') nextIndex += 1;
    } else {
      if (event.key === 'ArrowUp') nextIndex -= 1;
      if (event.key === 'ArrowDown') nextIndex += 1;
    }

    if (nextIndex >= 0 && nextIndex < items.length) {
      this.focusItem(itemId(items[nextIndex]));
    }
  }

  setType(type) {
    if (!type || type === this.state.type) return;
    this.state.type = type;
    this.state.status = 'all';
    this.state.genre = 'all';
    this.state.page = 1;
    this.state.focusedId = '';
    this.renderStatuses();
    this.renderTypes(this.types || FALLBACK_TYPES);
    this.reload();
  }

  setStatus(status) {
    this.state.status = status || 'all';
    this.state.page = 1;
    this.state.focusedId = '';
    this.renderStatuses();
    this.reload();
  }

  setGenre(genre) {
    this.state.genre = genre || 'all';
    this.state.page = 1;
    this.state.focusedId = '';
    this.renderGenres(this.genres || []);
    this.reload();
  }

  setViewMode(mode, render = true) {
    this.state.viewMode = mode === 'list' ? 'list' : 'grid';

    this.queryAll('[data-douban-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.doubanView === this.state.viewMode);
      button.setAttribute('aria-pressed', String(button.dataset.doubanView === this.state.viewMode));
    });

    const mobile = this.query('[data-douban-mobile-view]');
    if (mobile) {
      mobile.innerHTML = `<span class="icon-[lucide--${this.state.viewMode === 'grid' ? 'list' : 'layout-grid'}]" aria-hidden="true"></span>`;
      mobile.setAttribute('aria-label', this.state.viewMode === 'grid' ? '切换到列表视图' : '切换到海报网格视图');
    }

    this.query('[data-douban-grid]')?.toggleAttribute('hidden', this.state.viewMode !== 'grid');
    this.query('[data-douban-list]')?.toggleAttribute('hidden', this.state.viewMode !== 'list');

    if (render) this.highlightFocusedItem();
  }

  setLoading(isLoading) {
    const shouldShowInlineLoading = isLoading && this.state.items.length === 0 && this.state.visibleItems.length === 0;
    this.query('[data-douban-loading]')?.toggleAttribute('hidden', !shouldShowInlineLoading);
    this.root.classList.toggle('is-loading', isLoading);
    this.query('[data-douban-grid]')?.setAttribute('aria-busy', String(isLoading));
    this.query('[data-douban-list]')?.setAttribute('aria-busy', String(isLoading));
  }

  setError(message = '') {
    this.loadError = true;
    const error = this.query('[data-douban-error]');
    const text = this.query('[data-douban-error-text]');
    if (text && message) text.textContent = message;
    error?.toggleAttribute('hidden', false);
  }

  clearError() {
    this.loadError = false;
    this.query('[data-douban-error]')?.toggleAttribute('hidden', true);
  }

  async loadTypes() {
    this.typesController?.abort();
    const controller = new AbortController();
    this.typesController = controller;
    const isCurrent = () => !this.destroyed && !controller.signal.aborted
      && this.typesController === controller && this.root?.isConnected !== false;
    try {
      const types = await fetchJson(`${API_BASE}/-/types`, {}, controller.signal);
      if (!isCurrent()) return;
      this.types = (Array.isArray(types) && types.length ? types : FALLBACK_TYPES)
        .map((type) => ({
          key: normalize(type.key),
          name: normalize(type.name) || normalize(type.key),
          doubanCount: Number(type.doubanCount || 0) || 0
        }))
        .filter((type) => type.key);
      this.renderTypes(this.types);
    } catch {
      if (!isCurrent()) return;
      this.types = FALLBACK_TYPES;
      this.renderTypes(this.types);
    } finally {
      if (this.typesController === controller) this.typesController = null;
    }
  }

  async reload({ refreshMetadata = false } = {}) {
    this.abortController?.abort();
    this.paginationController?.abort();
    this.paginationController = null;
    this.root?.classList?.remove('is-loading-more');
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const generation = ++this.requestGeneration;
    const requestKey = this.requestKey();
    const page = this.state.page;
    const metadata = this.prepareMetadata(refreshMetadata);

    this.reloadPending = true;
    this.state.items = [];
    this.state.visibleItems = [];
    this.state.hasMore = false;
    this.state.focusedId = '';
    this.setLoading(true);
    this.clearError();
    this.renderItems();

    try {
      const genresPromise = this.getMetadataValue(metadata, 'genres',
        () => this.fetchGenres(metadata.controller.signal, metadata.type)).then(
        (genres) => ({ genres, error: null }),
        (error) => ({ genres: [], error })
      );
      const list = await this.fetchList(page, signal);
      if (!this.isRequestCurrent(generation, requestKey, signal)) return;

      const listTotal = Number(list.total || 0) || 0;
      this.genres = this.cachedMetadataValue(metadata, 'genres')?.value || [];
      this.state.items = list.items;
      this.state.total = listTotal;
      this.state.page = page;
      this.state.hasMore = page * this.state.pageSize < this.state.total;
      this.renderGenres(this.genres);
      void this.updateStats(metadata.controller.signal, listTotal, metadata);
      void genresPromise.then((genresResult) => {
        if (!this.isRequestCurrent(generation, requestKey, signal)) return;
        this.genres = genresResult.genres;
        this.renderGenres(this.genres);
        if (genresResult.error) {
          warnApiCall('douban', '豆瓣题材筛选加载失败，已保留列表', {
            endpoint: genresResult.error?.url || `${API_BASE}/-/genres`,
            status: genresResult.error?.status || '',
            message: genresResult.error?.message || String(genresResult.error),
            action: 'show-list-without-genres',
            hint: '检查题材 API；列表仍可按类型、状态和关键词浏览。'
          });
        }
      });
    } catch (error) {
      if (this.isRequestCurrent(generation, requestKey, signal)) {
        this.state.items = [];
        this.state.visibleItems = [];
        this.setError('请确认 plugin-douban 已安装、同步完成，并允许匿名访问公开 API。');
        warnApiCall('douban', '豆瓣列表加载失败，请检查插件同步和匿名 API', {
          endpoint: error?.url || API_BASE,
          status: error?.status || '',
          message: error?.message || String(error || ''),
          action: 'show-plugin-error',
          hint: '检查 plugin-douban 是否安装、数据是否同步完成、公开匿名 API 是否放行。'
        });
      }
    } finally {
      if (this.isRequestCurrent(generation, requestKey, signal)) {
        this.reloadPending = false;
        this.setLoading(false);
        this.renderItems();
      }
    }
  }

  async fetchGenres(signal, type = this.state.type) {
    const result = await fetchJson(`${API_BASE}/-/genres`, { type }, signal);
    return (Array.isArray(result) ? result : [])
      .map((genre) => {
        if (typeof genre === 'string') return { name: genre, doubanCount: 0 };
        return {
          name: normalize(genre.name),
          doubanCount: Number(genre.doubanCount || 0) || 0
        };
      })
      .filter((genre) => genre.name);
  }

  async fetchList(page, signal) {
    const params = {
      page,
      size: this.state.pageSize,
      type: this.state.type,
      dataType: this.state.dataType,
      keyword: this.state.keyword.trim()
    };

    if (this.state.status !== 'all') params.status = this.state.status;
    if (this.state.genre !== 'all') params.genre = this.state.genre;

    const result = await fetchJson(API_BASE, params, signal);
    return {
      items: Array.isArray(result?.items) ? result.items : [],
      total: Number(result?.total || 0) || 0
    };
  }

  async updateStats(signal, fallbackTotal = this.state.total, metadata = this.prepareMetadata()) {
    const isCurrent = () => !signal?.aborted && this.isMetadataCurrent(metadata);
    if (!isCurrent()) return;
    const labels = typeLabels(metadata.type);
    const labelMap = {
      done: labels.done,
      doing: labels.doing,
      mark: labels.mark
    };

    Object.entries(labelMap).forEach(([key, label]) => {
      const target = this.query(`[data-douban-stat-label="${key}"]`);
      if (target) target.textContent = label;
    });

    ['total', 'done', 'doing', 'mark'].forEach((key) => {
      const cached = this.cachedMetadataValue(metadata, key);
      const fallback = key === 'total' ? fallbackTotal : '—';
      this.setStat(key, cached ? cached.value : fallback);
    });
    await Promise.all([
      ['total', {}],
      ['done', { status: 'done' }],
      ['doing', { status: 'doing' }],
      ['mark', { status: 'mark' }]
    ].map(async ([key, params]) => {
      try {
        const count = await this.getMetadataValue(metadata, key, () => this.fetchCount({
          type: metadata.type, dataType: metadata.dataType, ...params
        }, signal));
        if (isCurrent()) this.setStat(key, count);
      } catch {
        // An unavailable count stays unknown; the list total remains a useful fallback.
      }
    }));
  }

  async fetchCount(params, signal) {
    const result = await fetchJson(API_BASE, { page: 1, size: 1, dataType: this.state.dataType, ...params }, signal);
    return Number(result?.total || 0) || 0;
  }

  setStat(key, value) {
    const target = this.query(`[data-douban-stat="${key}"]`);
    if (target) target.textContent = String(value);
  }

  async loadMore() {
    if (this.reloadPending || !this.state.hasMore || this.root.classList.contains('is-loading-more')) return;
    this.clearError();
    this.root.classList.add('is-loading-more');
    const nextPage = this.state.page + 1;
    const generation = this.requestGeneration;
    const requestKey = this.requestKey();
    this.paginationController?.abort();
    const controller = new AbortController();
    this.paginationController = controller;

    try {
      const list = await this.fetchList(nextPage, controller.signal);
      if (!this.isRequestCurrent(generation, requestKey, controller.signal)) return;
      this.state.page = nextPage;
      this.state.items = this.state.items.concat(list.items);
      this.state.total = list.total;
      this.state.hasMore = nextPage * this.state.pageSize < this.state.total;
      this.renderItems({ append: true });
    } catch (error) {
      if (!this.isRequestCurrent(generation, requestKey, controller.signal)) return;
      this.setError('下一页加载失败，已保留当前列表，请重试。');
      warnApiCall('douban', '豆瓣下一页加载失败', {
        endpoint: error?.url || API_BASE,
        status: error?.status || '',
        page: nextPage,
        message: error?.message || String(error || ''),
        action: 'keep-current-list',
        hint: '检查分页参数、插件公开 API 响应和网络面板中的失败请求。'
      });
    } finally {
      if (this.paginationController === controller) {
        this.paginationController = null;
        this.root.classList.remove('is-loading-more');
      }
    }
  }

  renderTypes(types) {
    const html = types.map((type) => {
      const active = type.key === this.state.type ? ' is-active' : '';
      const count = type.doubanCount ? `<span>${type.doubanCount}</span>` : '';
      return `<button class="douban-type-tab${active}" type="button" aria-pressed="${type.key === this.state.type}" data-douban-type="${escapeHtml(type.key)}">${escapeHtml(type.name)}${count}</button>`;
    }).join('');

    this.renderControlGroup('[data-douban-types]', html, 'data-douban-type');
    this.renderControlGroup('[data-douban-types-mobile]', html, 'data-douban-type');
  }

  renderStatuses() {
    const labels = typeLabels(this.state.type);
    const statuses = [
      ['all', '全部'],
      ['mark', labels.mark],
      ['doing', labels.doing],
      ['done', labels.done]
    ];

    const html = statuses.map(([key, label]) => (
      `<button class="douban-status-pill${this.state.status === key ? ' is-active' : ''}" type="button" aria-pressed="${this.state.status === key}" data-douban-status="${key}">${escapeHtml(label)}</button>`
    )).join('');

    this.renderControlGroup('[data-douban-statuses]', html, 'data-douban-status');
  }

  renderGenres(genres) {
    const all = [{ name: '全部题材', key: 'all', doubanCount: 0 }].concat(
      genres.map((genre) => ({ ...genre, key: genre.name }))
    );

    const html = all.map((genre) => {
      const active = this.state.genre === genre.key ? ' is-active' : '';
      const count = genre.doubanCount ? `<span>${genre.doubanCount}</span>` : '';
      return `<button class="douban-genre-pill${active}" type="button" aria-pressed="${this.state.genre === genre.key}" data-douban-genre="${escapeHtml(genre.key)}">${escapeHtml(genre.name)}${count}</button>`;
    }).join('');

    this.renderControlGroup('[data-douban-genres]', html, 'data-douban-genre');
  }

  renderItems({ append = false } = {}) {
    const previousCount = this.state.visibleItems.length;
    this.state.visibleItems = this.state.items.slice();

    const hasItems = this.state.visibleItems.length > 0;
    this.setText('[data-douban-result-count]', this.reloadPending ? '正在加载…' : this.loadError ? '加载未完成' : `${this.state.visibleItems.length} / ${this.state.total} 项`);
    this.query('[data-douban-empty]')?.toggleAttribute('hidden', hasItems || this.reloadPending || this.loadError);
    this.query('[data-douban-load-more]')?.toggleAttribute('hidden', !this.state.hasMore || this.reloadPending || this.loadError);

    const grid = this.query('[data-douban-grid]');
    const list = this.query('[data-douban-list-body]');
    const items = append ? this.state.visibleItems.slice(previousCount) : this.state.visibleItems;
    const gridHtml = items.map((item) => this.renderGridCard(item)).join('');
    const listHtml = items.map((item) => this.renderListRow(item)).join('');
    if (grid) {
      if (append) grid.insertAdjacentHTML('beforeend', gridHtml);
      else grid.innerHTML = gridHtml;
    }
    if (list) {
      if (append) list.insertAdjacentHTML('beforeend', listHtml);
      else list.innerHTML = listHtml;
    }

    if (hasItems && !this.state.focusedId) {
      this.state.focusedId = itemId(this.state.visibleItems[0]);
    }
    this.highlightFocusedItem();
  }

  renderGridCard(item) {
    const spec = getSpec(item);
    const faves = getFaves(item);
    const id = itemId(item);
    const status = normalize(faves.status) || 'done';
    const label = typeLabels(this.state.type)[status] || '记录';
    const genres = genresOf(item).slice(0, 2).join(' · ');
    const focused = id === this.state.focusedId ? ' is-focused' : '';

    return `
      <article class="douban-card${focused}" data-douban-item-id="${escapeHtml(id)}" role="button" tabindex="0" aria-label="预览：${escapeHtml(spec.name || '未命名条目')}" aria-haspopup="dialog">
        <div class="douban-card-poster">
          ${collectionPoster(spec.poster, spec.name)}
          <span class="douban-card-status is-${escapeHtml(status)}">${escapeHtml(label)}</span>
          ${spec.score ? `<span class="douban-card-score">★ ${escapeHtml(spec.score)}</span>` : ''}
        </div>
        <div class="douban-card-copy">
          <h2>${escapeHtml(spec.name || '未命名条目')}</h2>
          <p>${escapeHtml([spec.year, genres].filter(Boolean).join(' · ') || '暂无分类')}</p>
        </div>
      </article>
    `;
  }

  renderListRow(item) {
    const spec = getSpec(item);
    const faves = getFaves(item);
    const id = itemId(item);
    const focused = id === this.state.focusedId ? ' is-focused' : '';
    const genres = genresOf(item).slice(0, 2).join('/');

    return `
      <tr class="douban-row${focused}" data-douban-item-id="${escapeHtml(id)}">
        <td>
          <span class="douban-row-poster">
            ${collectionPoster(spec.poster)}
          </span>
          <span>
            <button class="douban-row-preview" type="button" aria-label="预览：${escapeHtml(spec.name || '未命名条目')}" aria-haspopup="dialog"><strong>${escapeHtml(spec.name || '未命名条目')}</strong></button>
            <small>${escapeHtml(genres || spec.cardSubtitle || '暂无描述')}</small>
          </span>
        </td>
        <td>${escapeHtml(spec.year || '--')}</td>
        <td class="douban-row-score">${spec.score ? `★ ${escapeHtml(spec.score)}` : '--'}</td>
        <td class="douban-row-stars">${escapeHtml(scoreStars(faves.score))}</td>
        <td>${escapeHtml((faves.createTime || '').slice(0, 10) || '--')}</td>
        <td><em>${escapeHtml(faves.remark || '暂无评语')}</em></td>
      </tr>
    `;
  }

  focusItem(id) {
    this.state.focusedId = id;
    this.highlightFocusedItem();
    const selector = this.state.viewMode === 'grid' ? '[data-douban-grid]' : '[data-douban-list-body]';
    const item = this.query(`${selector} [data-douban-item-id="${CSS.escape(id)}"]`);
    (item?.querySelector('button') || item)?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'nearest' });
  }

  highlightFocusedItem() {
    this.queryAll('[data-douban-item-id]').forEach((element) => {
      element.classList.toggle('is-focused', element.dataset.doubanItemId === this.state.focusedId);
    });
  }

  findItem(id) {
    return this.state.visibleItems.find((item) => itemId(item) === id)
      || this.state.items.find((item) => itemId(item) === id);
  }

  openPreview(id, trigger = null) {
    const item = this.findItem(id);
    if (!item) return;
    this.state.focusedId = id;
    this.highlightFocusedItem();

    const spec = getSpec(item);
    const faves = getFaves(item);
    const genres = genresOf(item);

    const poster = this.query('[data-douban-preview-poster]');
    const placeholder = this.query('[data-douban-preview-placeholder]');
    if (poster) {
      const cover = String(spec.poster || '').trim();
      const showCover = (visible) => {
        poster.hidden = !visible;
        if (placeholder) placeholder.hidden = visible;
      };
      poster.onload = () => showCover(true);
      poster.onerror = () => showCover(false);
      poster.alt = cover ? (spec.name || '') : '';
      showCover(false);
      if (cover) {
        poster.src = cover;
        if (poster.complete && poster.naturalWidth) showCover(true);
      } else poster.removeAttribute('src');
    }
    this.setText('[data-douban-preview-score]', spec.score ? `★ ${spec.score}` : '--');
    this.setText('[data-douban-preview-title]', spec.name || '未命名条目');
    this.setText('[data-douban-preview-meta]', [spec.year, genres.join(' / ')].filter(Boolean).join(' · ') || '暂无元信息');
    this.setText('[data-douban-preview-subtitle]', spec.cardSubtitle || '暂无详细描述。');
    this.setText('[data-douban-preview-stars]', scoreStars(faves.score));
    this.setText('[data-douban-preview-remark]', faves.remark ? `“${faves.remark}”` : '未留下简评。');

    const link = this.query('[data-douban-preview-link]');
    if (link) {
      let href = '';
      try {
        const raw = String(spec.link || '').trim();
        const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
        if (['https:', 'http:'].includes(url.protocol)) href = url.href;
      } catch { /* A missing destination has no external action. */ }
      link.hidden = !href;
      if (href) link.href = href;
      else link.removeAttribute('href');
    }

    const quicklook = this.query('[data-douban-quicklook]');
    this.quickLookPreviousFocus = trigger instanceof HTMLElement ? (trigger.querySelector('button') || trigger) : document.activeElement;
    this.quickLookInertTargets = Array.from(this.root.children).filter((child) => child !== quicklook);
    this.quickLookInertTargets.forEach((child) => { child.inert = true; });
    quicklook?.classList.add('is-open');
    quicklook?.setAttribute('aria-hidden', 'false');
    quicklook?.removeAttribute('inert');
    requestAnimationFrame(() => {
      if (quicklook?.classList.contains('is-open') && !this.destroyed) {
        const dialog = quicklook.querySelector('[role="dialog"]');
        const close = dialog?.querySelector('.douban-quicklook-close')
          || dialog?.querySelector('[data-douban-close-preview]');
        close?.focus({ preventScroll: true });
      }
    });
  }

  closePreview({ restoreFocus = true } = {}) {
    const quicklook = this.query('[data-douban-quicklook]');
    quicklook?.classList.remove('is-open');
    quicklook?.setAttribute('aria-hidden', 'true');
    quicklook?.setAttribute('inert', '');
    this.quickLookInertTargets.forEach((child) => { child.inert = false; });
    this.quickLookInertTargets = [];
    if (restoreFocus && this.quickLookPreviousFocus?.isConnected) {
      this.quickLookPreviousFocus.focus({ preventScroll: true });
    }
    this.quickLookPreviousFocus = null;
  }

  setText(selector, value) {
    const target = this.query(selector);
    if (target) target.textContent = value;
  }
}

export function mountDoubanApp(root) {
  const appRoot = root?.matches?.('[data-app-root="douban"]')
    ? root
    : root?.querySelector?.('[data-app-root="douban"]');
  if (!appRoot) return null;

  const app = new DoubanApp(appRoot);
  return app.mount();
}
