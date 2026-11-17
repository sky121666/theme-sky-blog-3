import { withRequestDeadline } from '../../shared/request-deadline.js';
import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function heatLevel(minutes, maxMinutes) {
  if (!minutes) return 0;
  if (maxMinutes <= 0) return 1;
  const ratio = minutes / maxMinutes;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

export function parseSteamRecent(value, fallback) {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1000000000000 ? numeric * 1000 : numeric;
  }

  const text = String(fallback || '').trim();
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function heatmapThemeColors(theme) {
  switch (String(theme || '').toLowerCase()) {
    case 'green':
    case 'github':
      return ['rgba(23, 26, 33, 0.5)', 'rgba(48, 209, 88, 0.28)', 'rgba(48, 209, 88, 0.52)', 'rgba(48, 209, 88, 0.76)', '#30d158'];
    case 'orange':
    case 'amber':
    case 'fire':
      return ['rgba(23, 26, 33, 0.5)', 'rgba(245, 165, 36, 0.28)', 'rgba(245, 165, 36, 0.52)', 'rgba(245, 165, 36, 0.78)', '#f5a524'];
    case 'purple':
      return ['rgba(23, 26, 33, 0.5)', 'rgba(191, 90, 242, 0.28)', 'rgba(191, 90, 242, 0.52)', 'rgba(191, 90, 242, 0.78)', '#bf5af2'];
    case 'blue':
    case 'steam':
    default:
      return ['rgba(23, 26, 33, 0.5)', 'rgba(102, 192, 244, 0.3)', 'rgba(102, 192, 244, 0.58)', 'rgba(102, 192, 244, 0.8)', '#66c0f4'];
  }
}

function applyHeatmapTheme(panel) {
  const colors = heatmapThemeColors(panel?.dataset?.steamHeatmapTheme);
  colors.forEach((color, index) => {
    panel.style.setProperty(`--steam-heatmap-${index}`, color);
  });
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cssUrl(value) {
  const escaped = String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `url("${escaped}")`;
}

function createAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function readPaginationPage(doc, html, requestUrl, response) {
  const requested = new URL(requestUrl, window.location.href);
  const received = new URL(response.url || '', window.location.href);
  requested.searchParams.sort();
  received.searchParams.sort();
  const body = doc.body;
  const app = body?.querySelector('[data-app-root="steam"]');
  const grid = app?.querySelector('.steam-library-grid');
  const trigger = app?.querySelector('[data-steam-loadmore]');
  const empty = app?.querySelector('.steam-empty--compact');
  if (response.redirected || !response.url
    || requested.origin !== received.origin || requested.pathname !== received.pathname
    || requested.search !== received.search
    || !/<\/body>\s*<\/html>\s*$/i.test(html)
    || body?.dataset.errorPage !== 'false' || body.dataset.pageMode !== 'browser-steam'
    || body.dataset.appId !== 'steam' || body.dataset.windowVariant !== 'steam'
    || !app?.querySelector('[data-app-props="steam"]')
    || !['ready', 'empty'].includes(app?.dataset.steamLibraryState)
    || (app.dataset.steamLibraryState === 'ready' && (!grid || !trigger || !trigger.querySelector('[data-steam-scroll-sentinel]')))
    || (app.dataset.steamLibraryState === 'empty' && (!empty || grid || trigger))) {
    throw new Error('Steam 分页响应与请求地址或页面协议不符');
  }
  const cards = Array.from(grid?.querySelectorAll(':scope > [data-steam-game-card]') || []);
  if (grid && !cards.length) throw new Error('Steam 游戏库分页响应缺少条目');
  return cards;
}

export function registerSteamExplorer(Alpine) {
  Alpine.data('steamExplorer', () => ({
    activeView: 'profile',
    searchQuery: '',
    sortMode: 'playtime',
    games: [],
    nextUrl: '',
    hasMore: false,
    loading: false,
    loadError: false,
    heatmapError: false,
    _observer: null,
    _fallbackScrollHandler: null,
    _heatmapLoaded: false,
    _heatmapAbortController: null,
    _paginationAbortController: null,
    _destroyed: false,
    _lifecycleGeneration: 0,

    init() {
      this._destroyed = false;
      const generation = ++this._lifecycleGeneration;
      const root = this.$root;
      this.activeView = this.$root.dataset.steamInitialView || 'profile';
      this.applyConfiguredCover();
      this.readGames();
      this.readPaginationState();
      this.$watch('sortMode', () => {
        if (this.isAlive(generation, root)) this.applyGameOrdering();
      });
      this.$nextTick(() => {
        if (!this.isAlive(generation, root)) return;
        this.applyGameOrdering();
        this.installInfiniteLoader();
        this.renderHeatmap();
      });
    },

    destroy() {
      this._destroyed = true;
      this._lifecycleGeneration += 1;
      this._observer?.disconnect();
      this._observer = null;
      this.removeScrollFallback();
      this._heatmapAbortController?.abort();
      this._heatmapAbortController = null;
      this._paginationAbortController?.abort();
      this._paginationAbortController = null;
      this._heatmapLoaded = false;
      this.loading = false;
      this.heatmapError = false;
    },

    isAlive(generation = this._lifecycleGeneration, root = this.$root) {
      return !this._destroyed && generation === this._lifecycleGeneration
        && root === this.$root && Boolean(root) && root.isConnected !== false;
    },

    applyConfiguredCover() {
      const coverImage = this.$root.dataset.steamCoverImage || '';
      if (coverImage) {
        this.$root.style.setProperty('--steam-cover-image', cssUrl(coverImage));
      }
    },

    readGames() {
      const cards = Array.from(this.$root.querySelectorAll('[data-steam-game-card]'));
      this.games = cards.map((card, index) => {
        card.dataset.steamIndex = String(index);
        return {
          el: card,
          index,
          appId: card.dataset.steamAppId || '',
          name: card.dataset.steamGameName || '',
          playtime: Number(card.dataset.steamPlaytime || 0),
          recent: parseSteamRecent(card.dataset.steamRecent, card.dataset.steamLastPlayed),
          lastPlayed: card.dataset.steamLastPlayed || ''
        };
      });
    },

    readPaginationState() {
      const trigger = this.$root.querySelector('[data-steam-loadmore]');
      this.nextUrl = trigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;
    },

    switchView(view) {
      if (!this.isAlive()) return;
      this.activeView = view || 'profile';
      this.scrollMainToTop();
      const generation = this._lifecycleGeneration;
      const root = this.$root;
      this.$nextTick(() => {
        if (!this.isAlive(generation, root)) return;
        if (this.activeView === 'library') {
          this.installInfiniteLoader();
          this.checkScrollFallback();
        } else if (this.activeView === 'profile') {
          this.renderHeatmap();
        }
      });
    },

    scrollMainToTop() {
      const scroller = this.$root.querySelector('.steam-main-scroll')
        || this.$root.closest('[data-window-scroll]')
        || this.$root;
      scroller?.scrollTo?.({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },

    isView(view) {
      return this.activeView === view;
    },

    matchesGame(game) {
      if (!game) return false;
      const keyword = normalize(this.searchQuery);
      if (!keyword) return true;
      return normalize(game.name).includes(keyword);
    },

    shouldShowGame(el) {
      return Boolean(el) && this.matchesGame({ name: el.dataset?.steamGameName || '' });
    },

    visibleCount() {
      return this.games.filter((game) => this.matchesGame(game)).length;
    },

    sortedGames() {
      const sorted = this.games.slice();
      sorted.sort((left, right) => {
        if (this.sortMode === 'name') {
          return normalize(left.name).localeCompare(normalize(right.name), 'zh-CN');
        }

        if (this.sortMode === 'recent') {
          if (right.recent !== left.recent) return right.recent - left.recent;
          return normalize(left.name).localeCompare(normalize(right.name), 'zh-CN');
        }

        return right.playtime - left.playtime;
      });
      return sorted;
    },

    applyGameOrdering() {
      const grid = this.$root.querySelector('.steam-library-grid');
      const focused = grid?.contains(document.activeElement) ? document.activeElement : null;
      this.sortedGames().forEach((game, order) => {
        if (game.el) {
          game.el.style.order = String(order);
          // Keep reading and keyboard order aligned with the visual order.
          grid?.appendChild(game.el);
        }
      });
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    },

    clearSearch() {
      this.searchQuery = '';
      this.$nextTick(() => {
        if (this.isAlive()) this.$root.querySelector('.steam-search-wrap input')?.focus({ preventScroll: true });
      });
    },

    describeHeatmapDay(event) {
      const cell = event.target.closest?.('[data-steam-heatmap-grid] > span');
      if (!cell) return;
      const detail = this.$root.querySelector('[data-steam-heatmap-detail]');
      if (detail) detail.textContent = cell.getAttribute('aria-label');
    },

    focusHeatmapDay(event) {
      const cells = Array.from(this.$root.querySelectorAll('[data-steam-heatmap-grid] > span'));
      const index = cells.indexOf(event.target);
      if (index < 0) return;
      const offsets = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? cells.length - 1 : index + offsets[event.key];
      if (!Number.isFinite(next)) return;
      event.preventDefault();
      const target = cells[Math.max(0, Math.min(cells.length - 1, next))];
      cells.forEach((cell) => { cell.tabIndex = cell === target ? 0 : -1; });
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },

    async renderHeatmap() {
      if (!this.isAlive()) return;
      const generation = this._lifecycleGeneration;
      const root = this.$root;
      const panel = this.$root.querySelector('.steam-heatmap-panel');
      const grid = panel?.querySelector('[data-steam-heatmap-grid]');
      if (!panel || !grid || this._heatmapLoaded) return;
      this._heatmapLoaded = true;
      this.heatmapError = false;
      panel.dataset.steamHeatmapState = 'loading';
      applyHeatmapTheme(panel);

      const configuredDays = Number(panel.dataset.steamHeatmapDays || 365);
      const days = Math.min(Math.max(configuredDays || 365, 28), 365);
      const today = new Date();
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const start = addDays(end, -days + 1);
      const range = panel.querySelector('[data-steam-heatmap-range]');
      if (range) {
        range.textContent = `${formatDate(start)} 至 ${formatDate(end)}`;
      }

      const cells = [];
      for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
        cells.push({
          date: formatDate(cursor),
          minutes: 0,
          games: new Set()
        });
      }

      let failed = false;
      const controller = createAbortController();
      this._heatmapAbortController = controller;
      const isCurrent = () => !controller?.signal.aborted && this.isAlive(generation, root);

      try {
        const cellMap = new Map(cells.map((cell) => [cell.date, cell]));
        const seenRecords = new Set();
        for (let page = 1; ; page += 1) {
          const api = `/apis/api.steam.timxs.com/v1alpha1/heatmap/records?startDate=${formatDate(start)}&endDate=${formatDate(end)}&page=${page}&size=${days}`;
          const data = await withRequestDeadline(async (signal) => {
            const response = await fetch(api, {
              headers: { Accept: 'application/json' },
              signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          }, { signal: controller?.signal });
          if (!isCurrent()) return;
          const pageSize = Number(data?.size ?? days);
          const total = Number(data?.total);
          if (!Array.isArray(data?.items) || !Number.isInteger(pageSize) || pageSize <= 0
            || data?.total == null || !Number.isSafeInteger(total) || total < 0
            || (data.page != null && Number(data.page) !== page)) {
            throw new Error('Steam 热力图分页响应格式无效');
          }
          const hasNext = total > page * pageSize;
          if (typeof data.hasNext === 'boolean' && data.hasNext !== hasNext) {
            throw new Error('Steam 热力图分页状态与记录总数不一致');
          }

          let added = 0;
          data.items.forEach((item) => {
            const spec = item?.spec || {};
            const key = item?.metadata?.name || `${spec.steamId || ''}:${spec.date}:${spec.appId}`;
            if (seenRecords.has(key)) return;
            seenRecords.add(key);
            added += 1;
            const cell = cellMap.get(spec.date);
            if (!cell) return;
            const minutes = Number(spec.playtimeMinutes || 0);
            if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Steam 游玩时长格式无效');
            cell.minutes += minutes;
            if (spec.gameName) cell.games.add(spec.gameName);
          });
          if (!hasNext) {
            if (seenRecords.size !== total) throw new Error('Steam 热力图分页记录不完整');
            break;
          }
          if (!added) throw new Error('Steam 热力图分页未返回后续记录');
        }
      } catch (error) {
        if (isAbortError(error) || !isCurrent()) return;
        failed = true;
        cells.forEach((cell) => { cell.minutes = 0; cell.games.clear(); });
        warnApiCall('steam', 'Steam 热力图记录加载失败', {
          message: error?.message || String(error || ''),
          action: 'show-heatmap-unavailable',
          hint: '检查 Steam 插件游玩记录 API 是否可访问，以及返回 items 是否为数组。'
        });
      } finally {
        if (this._heatmapAbortController === controller) {
          this._heatmapAbortController = null;
        }
      }

      if (!isCurrent()) return;
      this._heatmapLoaded = !failed;
      this.heatmapError = failed;

      const maxMinutes = Math.max(0, ...cells.map((cell) => cell.minutes));
      const activeDays = cells.filter((cell) => cell.minutes > 0).length;
      const totalMinutes = cells.reduce((sum, cell) => sum + cell.minutes, 0);
      const summary = panel.querySelector('[data-steam-heatmap-summary]');
      if (summary) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        summary.textContent = failed
          ? '活跃记录暂不可用，请稍后再试'
          : activeDays
          ? `${activeDays} 天有游玩记录 · ${hours} 小时 ${minutes} 分钟`
          : '暂无可展示的游玩记录';
      }

      const detail = panel.querySelector('[data-steam-heatmap-detail]');
      if (detail) detail.textContent = failed ? '日期记录暂不可用' : '聚焦日期查看游玩记录';
      grid.innerHTML = cells.map((cell, index) => {
        const level = heatLevel(cell.minutes, maxMinutes);
        const gameText = Array.from(cell.games).slice(0, 2).join('、');
        const title = failed ? `${cell.date} · 记录暂不可用` : cell.minutes
          ? `${cell.date} · ${cell.minutes} 分钟${gameText ? ` · ${gameText}` : ''}`
          : `${cell.date} · 无记录`;
        const safeTitle = escapeAttribute(title);
        return `<span class="is-${level}" role="img" tabindex="${index === cells.length - 1 ? 0 : -1}" title="${safeTitle}" aria-label="${safeTitle}"></span>`;
      }).join('');
      panel.dataset.steamHeatmapState = failed ? 'unavailable' : 'ready';
    },

    installInfiniteLoader() {
      if (!this.isAlive()) return;
      const generation = this._lifecycleGeneration;
      const root = this.$root;
      const sentinel = this.$root.querySelector('[data-steam-scroll-sentinel]');
      const scroller = this.$root.querySelector('.steam-main-scroll');
      if (!sentinel) return;

      if (!('IntersectionObserver' in window)) {
        this.installScrollFallback(scroller);
        return;
      }

      this._observer?.disconnect();
      this._observer = new IntersectionObserver((entries) => {
        if (this.isAlive(generation, root) && !this.loadError && entries[0]?.isIntersecting) {
          this.loadNext();
        }
      }, {
        root: scroller,
        rootMargin: '420px 0px'
      });

      this._observer.observe(sentinel);
      this.installScrollFallback(scroller);
    },

    installScrollFallback(scroller) {
      if (!this.isAlive() || this.loadError) return;
      this.removeScrollFallback();
      if (!scroller) return;

      const generation = this._lifecycleGeneration;
      const root = this.$root;
      this._fallbackScrollHandler = () => {
        if (this.isAlive(generation, root)) this.checkScrollFallback();
      };
      scroller.addEventListener('scroll', this._fallbackScrollHandler, { passive: true });
      this.checkScrollFallback();
    },

    checkScrollFallback() {
      if (!this.isAlive() || this.loadError) return;
      const scroller = this.$root.querySelector('.steam-main-scroll');
      if (!scroller || this.activeView !== 'library') return;

      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceToBottom < 480) {
        this.loadNext();
      }
    },

    removeScrollFallback() {
      const scroller = this.$root.querySelector('.steam-main-scroll');
      if (scroller && this._fallbackScrollHandler) {
        scroller.removeEventListener('scroll', this._fallbackScrollHandler);
      }
      this._fallbackScrollHandler = null;
    },

    appendCards(cards) {
      const grid = this.$root.querySelector('.steam-library-grid');
      if (!grid || !cards.length) return;

      cards.forEach((card) => {
        card.classList.add('steam-game-card--injected');
        grid.appendChild(card);
        window.Alpine?.initTree?.(card);
      });

      this.readGames();
      this.applyGameOrdering();
    },

    updatePaginationFrom(doc) {
      const nextTrigger = doc.querySelector('[data-steam-loadmore]');
      this.nextUrl = nextTrigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;

      const currentTrigger = this.$root.querySelector('[data-steam-loadmore]');
      if (currentTrigger) {
        currentTrigger.dataset.nextUrl = this.nextUrl;
      }

      if (!this.hasMore) {
        this._observer?.disconnect();
        this._observer = null;
        this.removeScrollFallback();
      }
    },

    async loadNext() {
      if (!this.isAlive() || this.activeView !== 'library' || this.loading || !this.hasMore || !this.nextUrl) return;
      const generation = this._lifecycleGeneration;
      const root = this.$root;

      this.loading = true;
      this.loadError = false;
      const controller = createAbortController();
      this._paginationAbortController = controller;
      const isCurrent = () => !controller?.signal.aborted && this.isAlive(generation, root);

      try {
        const requestUrl = this.nextUrl;
        const { response, html } = await withRequestDeadline(async (signal) => {
          const response = await fetch(requestUrl, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            signal
          });
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          return { response, html: await response.text() };
        }, { signal: controller?.signal });
        if (!isCurrent()) return;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = readPaginationPage(doc, html, requestUrl, response);

        this.appendCards(cards);
        this.updatePaginationFrom(doc);
        this.$nextTick(() => {
          if (this.isAlive(generation, root)) this.checkScrollFallback();
        });
      } catch (error) {
        if (isAbortError(error) || !isCurrent()) return;
        this.loadError = true;
        warnApiCall('steam', 'Steam 游戏库下一页加载失败', {
          url: this.nextUrl,
          message: error?.message || String(error || ''),
          action: 'show-load-error',
          hint: '检查 Steam 游戏库分页链接、HTML 片段中的 data-steam-game-card 和接口返回状态。'
        });
      } finally {
        if (this._paginationAbortController === controller) {
          this._paginationAbortController = null;
        }
        if (this.isAlive(generation, root)) {
          this.loading = false;
        }
      }
    }
  }));
}
