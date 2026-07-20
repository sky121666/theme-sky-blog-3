import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

const API_BASE = '/apis/api.douban.moony.la/v1alpha1/doubanmovies';
const PAGE_SIZE = 20;

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
  return item?.spec || {};
}

function getFaves(item) {
  return item?.faves || {};
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

function typeLabels(type) {
  return STATUS_LABELS[type] || STATUS_LABELS.movie;
}

function scoreStars(score) {
  const value = numberValue(score);
  if (!value) return '未评星';
  const count = Math.max(0, Math.min(5, Math.round(value / 2)));
  return `${'★'.repeat(count)}${'☆'.repeat(5 - count)}`;
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
  const response = await fetch(requestUrl, {
    headers: { Accept: 'application/json' },
    signal
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.url = requestUrl;
    throw error;
  }
  return response.json();
}

export class DoubanApp {
  constructor(root) {
    this.root = root;
    this.abortController = null;
    this.paginationController = null;
    this.requestGeneration = 0;
    this.reloadPending = false;
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
      focusedId: ''
    };

    this.onClick = this.onClick.bind(this);
    this.onInput = this.onInput.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
  }

  mount() {
    if (!this.root) return () => {};

    this.root.__doubanAppDispose?.();
    this.root.__doubanAppDispose = () => this.destroy();

    this.renderProfileIcon();
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    document.addEventListener('keydown', this.onKeydown);

    this.renderTypes(FALLBACK_TYPES);
    this.renderStatuses();
    this.setViewMode(this.state.viewMode, false);
    this.loadTypes();
    this.reload();

    return () => this.destroy();
  }

  destroy() {
    this.abortController?.abort();
    this.paginationController?.abort();
    this.requestGeneration += 1;
    this.reloadPending = false;
    clearTimeout(this.searchTimer);
    this.root?.removeEventListener('click', this.onClick);
    this.root?.removeEventListener('input', this.onInput);
    document.removeEventListener('keydown', this.onKeydown);
    if (this.root?.__doubanAppDispose) {
      delete this.root.__doubanAppDispose;
    }
  }

  requestKey() {
    return JSON.stringify({
      type: this.state.type,
      status: this.state.status,
      genre: this.state.genre,
      keyword: this.state.keyword.trim()
    });
  }

  isRequestCurrent(generation, requestKey, signal) {
    return !signal?.aborted
      && generation === this.requestGeneration
      && requestKey === this.requestKey()
      && this.root?.isConnected !== false;
  }

  query(selector) {
    return this.root.querySelector(selector);
  }

  queryAll(selector) {
    return Array.from(this.root.querySelectorAll(selector));
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

    if (event.target.closest('[data-douban-load-more]')) {
      this.loadMore();
      return;
    }

    const item = event.target.closest('[data-douban-item-id]');
    if (item) {
      this.openPreview(item.dataset.doubanItemId);
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

    if (event.key === 'Escape') {
      this.closePreview();
      return;
    }

    if ((event.key === ' ' || event.key === 'Spacebar') && this.state.focusedId) {
      const quicklook = this.query('[data-douban-quicklook]');
      if (quicklook?.classList.contains('is-open')) {
        this.closePreview();
      } else {
        event.preventDefault();
        this.openPreview(this.state.focusedId);
      }
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const items = this.state.visibleItems;
    if (!items.length) return;

    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => itemId(item) === this.state.focusedId));
    const columns = window.innerWidth >= 1024 ? 5 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
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
    });

    const mobile = this.query('[data-douban-mobile-view]');
    if (mobile) mobile.textContent = this.state.viewMode === 'grid' ? '▦' : '☰';

    this.query('[data-douban-grid]')?.toggleAttribute('hidden', this.state.viewMode !== 'grid');
    this.query('[data-douban-list]')?.toggleAttribute('hidden', this.state.viewMode !== 'list');

    if (render) this.renderItems();
  }

  setLoading(isLoading) {
    const shouldShowInlineLoading = isLoading && this.state.items.length === 0 && this.state.visibleItems.length === 0;
    this.query('[data-douban-loading]')?.toggleAttribute('hidden', !shouldShowInlineLoading);
    this.root.classList.toggle('is-loading', isLoading);
  }

  setError(message = '') {
    const error = this.query('[data-douban-error]');
    const text = this.query('[data-douban-error-text]');
    if (text && message) text.textContent = message;
    error?.toggleAttribute('hidden', false);
  }

  clearError() {
    this.query('[data-douban-error]')?.toggleAttribute('hidden', true);
  }

  async loadTypes() {
    try {
      const types = await fetchJson(`${API_BASE}/-/types`);
      this.types = (Array.isArray(types) && types.length ? types : FALLBACK_TYPES)
        .map((type) => ({
          key: normalize(type.key),
          name: normalize(type.name) || normalize(type.key),
          doubanCount: Number(type.doubanCount || 0) || 0
        }))
        .filter((type) => type.key);
      this.renderTypes(this.types);
    } catch {
      this.types = FALLBACK_TYPES;
      this.renderTypes(this.types);
    }
  }

  async reload() {
    this.abortController?.abort();
    this.paginationController?.abort();
    this.paginationController = null;
    this.root?.classList?.remove('is-loading-more');
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const generation = ++this.requestGeneration;
    const requestKey = this.requestKey();

    this.reloadPending = true;
    this.setLoading(true);
    this.clearError();

    try {
      const [genres, list] = await Promise.all([
        this.fetchGenres(signal),
        this.fetchList(1, signal)
      ]);
      if (!this.isRequestCurrent(generation, requestKey, signal)) return;

      const listTotal = Number(list.total || 0) || 0;
      await this.updateStats(signal, listTotal);
      if (!this.isRequestCurrent(generation, requestKey, signal)) return;
      this.genres = genres;
      this.state.items = list.items;
      this.state.total = listTotal;
      this.state.page = 1;
      this.state.hasMore = this.state.items.length < this.state.total;
      this.renderGenres(genres);
      this.renderItems();
    } catch (error) {
      if (this.isRequestCurrent(generation, requestKey, signal)) {
        this.state.items = [];
        this.state.visibleItems = [];
        this.renderItems();
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
      }
    }
  }

  async fetchGenres(signal) {
    const result = await fetchJson(`${API_BASE}/-/genres`, { type: this.state.type }, signal);
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
      size: PAGE_SIZE,
      type: this.state.type,
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

  async updateStats(signal, fallbackTotal = this.state.total) {
    const labels = typeLabels(this.state.type);
    const labelMap = {
      done: labels.done,
      doing: labels.doing,
      mark: labels.mark
    };

    Object.entries(labelMap).forEach(([key, label]) => {
      const target = this.query(`[data-douban-stat-label="${key}"]`);
      if (target) target.textContent = label;
    });

    try {
      const [total, done, doing, mark] = await Promise.all([
        this.fetchCount({ type: this.state.type }, signal),
        this.fetchCount({ type: this.state.type, status: 'done' }, signal),
        this.fetchCount({ type: this.state.type, status: 'doing' }, signal),
        this.fetchCount({ type: this.state.type, status: 'mark' }, signal)
      ]);
      if (signal.aborted) return;
      this.setStat('total', total);
      this.setStat('done', done);
      this.setStat('doing', doing);
      this.setStat('mark', mark);
    } catch {
      if (signal.aborted) return;
      this.setStat('total', fallbackTotal);
      this.setStat('done', 0);
      this.setStat('doing', 0);
      this.setStat('mark', 0);
    }
  }

  async fetchCount(params, signal) {
    const result = await fetchJson(API_BASE, { page: 1, size: 1, ...params }, signal);
    return Number(result?.total || 0) || 0;
  }

  setStat(key, value) {
    const target = this.query(`[data-douban-stat="${key}"]`);
    if (target) target.textContent = String(value);
  }

  async loadMore() {
    if (this.reloadPending || !this.state.hasMore || this.root.classList.contains('is-loading-more')) return;
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
      this.state.total = Number(list.total || this.state.total) || 0;
      this.state.hasMore = this.state.items.length < Number(list.total || this.state.total);
      this.renderItems();
    } catch (error) {
      if (!this.isRequestCurrent(generation, requestKey, controller.signal)) return;
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
      return `<button class="douban-type-tab${active}" type="button" data-douban-type="${escapeHtml(type.key)}">${escapeHtml(type.name)}${count}</button>`;
    }).join('');

    this.query('[data-douban-types]') && (this.query('[data-douban-types]').innerHTML = html);
    this.query('[data-douban-types-mobile]') && (this.query('[data-douban-types-mobile]').innerHTML = html);
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
      `<button class="douban-status-pill${this.state.status === key ? ' is-active' : ''}" type="button" data-douban-status="${key}">${escapeHtml(label)}</button>`
    )).join('');

    const target = this.query('[data-douban-statuses]');
    if (target) target.innerHTML = html;
  }

  renderGenres(genres) {
    const all = [{ name: '全部题材', key: 'all', doubanCount: 0 }].concat(
      genres.map((genre) => ({ ...genre, key: genre.name }))
    );

    const html = all.map((genre) => {
      const active = this.state.genre === genre.key ? ' is-active' : '';
      const count = genre.doubanCount ? `<span>${genre.doubanCount}</span>` : '';
      return `<button class="douban-genre-pill${active}" type="button" data-douban-genre="${escapeHtml(genre.key)}">${escapeHtml(genre.name)}${count}</button>`;
    }).join('');

    const target = this.query('[data-douban-genres]');
    if (target) target.innerHTML = html;
  }

  renderItems() {
    this.state.visibleItems = this.state.items.slice();

    const hasItems = this.state.visibleItems.length > 0;
    this.query('[data-douban-empty]')?.toggleAttribute('hidden', hasItems);
    this.query('[data-douban-load-more]')?.toggleAttribute('hidden', !this.state.hasMore);

    const grid = this.query('[data-douban-grid]');
    const list = this.query('[data-douban-list-body]');
    if (grid) grid.innerHTML = hasItems ? this.state.visibleItems.map((item, index) => this.renderGridCard(item, index)).join('') : '';
    if (list) list.innerHTML = hasItems ? this.state.visibleItems.map((item, index) => this.renderListRow(item, index)).join('') : '';

    if (hasItems && !this.state.focusedId) {
      this.state.focusedId = itemId(this.state.visibleItems[0]);
    }
    this.highlightFocusedItem();
  }

  renderGridCard(item, index) {
    const spec = getSpec(item);
    const faves = getFaves(item);
    const id = itemId(item);
    const status = normalize(faves.status) || 'done';
    const label = typeLabels(this.state.type)[status] || '记录';
    const genres = genresOf(item).slice(0, 2).join(' · ');
    const focused = id === this.state.focusedId ? ' is-focused' : '';

    return `
      <article class="douban-card${focused}" data-douban-item-id="${escapeHtml(id)}" style="--item-index:${index}">
        <div class="douban-card-poster">
          ${spec.poster ? `<img src="${escapeHtml(spec.poster)}" alt="${escapeHtml(spec.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';" />` : ''}
          <span class="douban-poster-fallback" ${spec.poster ? 'style="display:none"' : ''}><span class="icon-[lucide--image-off]" aria-hidden="true"></span></span>
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

  renderListRow(item, index) {
    const spec = getSpec(item);
    const faves = getFaves(item);
    const id = itemId(item);
    const focused = id === this.state.focusedId ? ' is-focused' : '';
    const genres = genresOf(item).slice(0, 2).join('/');

    return `
      <tr class="douban-row${focused}" data-douban-item-id="${escapeHtml(id)}" style="--item-index:${index}">
        <td>
          <span class="douban-row-poster">
            ${spec.poster ? `<img src="${escapeHtml(spec.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
          </span>
          <span>
            <strong>${escapeHtml(spec.name || '未命名条目')}</strong>
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
    this.query(`[data-douban-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
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

  openPreview(id) {
    const item = this.findItem(id);
    if (!item) return;
    this.state.focusedId = id;
    this.highlightFocusedItem();

    const spec = getSpec(item);
    const faves = getFaves(item);
    const genres = genresOf(item);

    const poster = this.query('[data-douban-preview-poster]');
    if (poster) {
      poster.src = spec.poster || '';
      poster.alt = spec.name || '';
    }
    this.setText('[data-douban-preview-score]', spec.score ? `★ ${spec.score}` : '--');
    this.setText('[data-douban-preview-title]', spec.name || '未命名条目');
    this.setText('[data-douban-preview-meta]', [spec.year, genres.join(' / ')].filter(Boolean).join(' · ') || '暂无元信息');
    this.setText('[data-douban-preview-subtitle]', spec.cardSubtitle || '暂无详细描述。');
    this.setText('[data-douban-preview-stars]', scoreStars(faves.score));
    this.setText('[data-douban-preview-remark]', faves.remark ? `“${faves.remark}”` : '未留下简评。');

    const link = this.query('[data-douban-preview-link]');
    if (link) link.href = spec.link || '#';

    const quicklook = this.query('[data-douban-quicklook]');
    quicklook?.classList.add('is-open');
    quicklook?.setAttribute('aria-hidden', 'false');
  }

  closePreview() {
    const quicklook = this.query('[data-douban-quicklook]');
    quicklook?.classList.remove('is-open');
    quicklook?.setAttribute('aria-hidden', 'true');
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
