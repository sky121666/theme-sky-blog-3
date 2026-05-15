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

function parseSteamRecent(value, fallback) {
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

function heatmapThemeColors(theme) {
  switch (String(theme || '').toLowerCase()) {
    case 'green':
    case 'github':
      return ['rgba(23, 26, 33, 0.5)', 'rgba(48, 209, 88, 0.28)', 'rgba(48, 209, 88, 0.52)', 'rgba(48, 209, 88, 0.76)', '#30d158'];
    case 'orange':
    case 'amber':
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
    _observer: null,
    _fallbackScrollHandler: null,
    _heatmapLoaded: false,

    init() {
      this.activeView = this.$root.dataset.steamInitialView || 'profile';
      this.applyConfiguredCover();
      this.readGames();
      this.readPaginationState();
      this.$watch('sortMode', () => this.applyGameOrdering());
      this.$nextTick(() => {
        this.applyGameOrdering();
        this.installInfiniteLoader();
        this.renderHeatmap();
      });
    },

    destroy() {
      this._observer?.disconnect();
      this._observer = null;
      this.removeScrollFallback();
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
      this.activeView = view || 'profile';
      this.scrollMainToTop();
      if (this.activeView === 'library') {
        this.$nextTick(() => {
          this.installInfiniteLoader();
          this.checkScrollFallback();
        });
      }
    },

    scrollMainToTop() {
      const scroller = this.$root.querySelector('.steam-main-scroll')
        || this.$root.closest('[data-window-scroll]')
        || this.$root;
      scroller?.scrollTo?.({ top: 0, behavior: 'smooth' });
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
      const appId = el?.dataset?.steamAppId || '';
      const index = Number(el?.dataset?.steamIndex || 0);
      const game = this.games.find((item) => item.appId === appId && item.index === index)
        || this.games.find((item) => item.index === index);
      return this.matchesGame(game);
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
      this.sortedGames().forEach((game, order) => {
        if (game.el) {
          game.el.style.order = String(order);
        }
      });
    },

    gameOrder(el) {
      const appId = el?.dataset?.steamAppId || '';
      const index = Number(el?.dataset?.steamIndex || 0);
      const order = this.sortedGames().findIndex((game) => game.appId === appId && game.index === index);
      return order >= 0 ? order : index;
    },

    async renderHeatmap() {
      const panel = this.$root.querySelector('.steam-heatmap-panel');
      const grid = panel?.querySelector('[data-steam-heatmap-grid]');
      if (!panel || !grid || this._heatmapLoaded) return;
      this._heatmapLoaded = true;
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

      try {
        const api = `/apis/api.steam.timxs.com/v1alpha1/heatmap/records?startDate=${formatDate(start)}&endDate=${formatDate(end)}&page=1&size=${days}`;
        const response = await fetch(api, {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const cellMap = new Map(cells.map((cell) => [cell.date, cell]));
        (data?.items || []).forEach((item) => {
          const spec = item?.spec || {};
          const cell = cellMap.get(spec.date);
          if (!cell) return;
          cell.minutes += Number(spec.playtimeMinutes || 0);
          if (spec.gameName) cell.games.add(spec.gameName);
        });
      } catch (error) {
        if (document.body?.dataset.debug === 'true') {
          console.error('[steam] heatmap load failed:', error);
        }
      }

      const maxMinutes = Math.max(0, ...cells.map((cell) => cell.minutes));
      const activeDays = cells.filter((cell) => cell.minutes > 0).length;
      const totalMinutes = cells.reduce((sum, cell) => sum + cell.minutes, 0);
      const summary = panel.querySelector('[data-steam-heatmap-summary]');
      if (summary) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        summary.textContent = activeDays
          ? `${activeDays} 天有游玩记录 · ${hours} 小时 ${minutes} 分钟`
          : '暂无可展示的游玩记录';
      }

      grid.innerHTML = cells.map((cell) => {
        const level = heatLevel(cell.minutes, maxMinutes);
        const gameText = Array.from(cell.games).slice(0, 2).join('、');
        const title = cell.minutes
          ? `${cell.date} · ${cell.minutes} 分钟${gameText ? ` · ${gameText}` : ''}`
          : `${cell.date} · 无记录`;
        const safeTitle = escapeAttribute(title);
        return `<span class="is-${level}" title="${safeTitle}" aria-label="${safeTitle}"></span>`;
      }).join('');
    },

    installInfiniteLoader() {
      const sentinel = this.$root.querySelector('[data-steam-scroll-sentinel]');
      const scroller = this.$root.querySelector('.steam-main-scroll');
      if (!sentinel) return;

      if (!('IntersectionObserver' in window)) {
        this.installScrollFallback(scroller);
        return;
      }

      this._observer?.disconnect();
      this._observer = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
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
      this.removeScrollFallback();
      if (!scroller) return;

      this._fallbackScrollHandler = () => this.checkScrollFallback();
      scroller.addEventListener('scroll', this._fallbackScrollHandler, { passive: true });
      this.checkScrollFallback();
    },

    checkScrollFallback() {
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
      if (this.activeView !== 'library' || this.loading || !this.hasMore || !this.nextUrl) return;

      this.loading = true;
      this.loadError = false;

      try {
        const response = await fetch(this.nextUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = Array.from(doc.querySelectorAll('.steam-library-grid > [data-steam-game-card]'));

        if (!cards.length) {
          this.hasMore = false;
          this._observer?.disconnect();
          this._observer = null;
          this.removeScrollFallback();
          return;
        }

        this.appendCards(cards);
        this.updatePaginationFrom(doc);
        this.$nextTick(() => this.checkScrollFallback());
      } catch (error) {
        this.loadError = true;
        if (document.body?.dataset.debug === 'true') {
          console.error('[steam] load more failed:', error);
        }
      } finally {
        this.loading = false;
      }
    }
  }));
}
