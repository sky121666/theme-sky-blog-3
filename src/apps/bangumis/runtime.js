import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';
import { startBangumisStatusCounts } from './status-counts.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesRequestedPage(requestUrl, responseUrl) {
  if (!responseUrl) return false;
  const requested = new URL(requestUrl, window.location.href);
  const received = new URL(responseUrl, window.location.href);
  requested.searchParams.sort();
  received.searchParams.sort();
  return requested.origin === received.origin
    && requested.pathname === received.pathname
    && requested.searchParams.toString() === received.searchParams.toString();
}

function readPaginationPage(doc, html) {
  const body = doc.body;
  const app = body?.querySelector('[data-app-root="bangumis"]');
  const scroller = app?.querySelector('.bangumis-main-scroll');
  const list = scroller?.querySelector('.bangumis-list');
  const trigger = scroller?.querySelector('[data-bangumis-loadmore]');
  const sentinel = trigger?.querySelector('[data-bangumis-scroll-sentinel]');
  const empty = scroller?.querySelector('.bangumis-empty:not(.bangumis-empty--inline)');

  if (!/<\/body>\s*<\/html>\s*$/i.test(html)
    || body?.dataset.errorPage !== 'false'
    || body.dataset.pageMode !== 'browser-bangumis'
    || body.dataset.appId !== 'bangumis'
    || body.dataset.windowVariant !== 'bangumis'
    || !app?.querySelector('[data-app-props="bangumis"]')
    || (!list && !empty)
    || (list && (!trigger || !sentinel))
    || (!list && trigger)) {
    throw new Error('追番分页响应缺少完整页面协议或加载节点');
  }

  const cards = Array.from(list?.querySelectorAll(':scope > [data-bangumi-card]') || []);
  if (list && !cards.length) {
    throw new Error('追番分页响应缺少条目');
  }
  return cards;
}

export function registerBangumisExplorer(Alpine) {
  Alpine.data('bangumisExplorer', () => ({
    searchQuery: '',
    nextUrl: '',
    hasMore: false,
    loading: false,
    loadError: false,
    _observer: null,
    _fallbackScrollHandler: null,
    _paginationController: null,
    _paginationGeneration: 0,
    _statusCounts: null,
    _destroyed: false,

    init() {
      this._destroyed = false;
      this._statusCounts?.cancel();
      this._statusCounts = startBangumisStatusCounts(this.$root, {
        typeNum: this.$root.dataset.bangumisCurrentType
      });
      this.readPaginationState();
      const generation = this._paginationGeneration;
      this.$nextTick(() => {
        if (this._destroyed || generation !== this._paginationGeneration) return;
        this.installInfiniteLoader();
      });
    },

    destroy() {
      this._destroyed = true;
      this._statusCounts?.cancel();
      this._statusCounts = null;
      this._paginationGeneration += 1;
      this._paginationController?.abort();
      this._paginationController = null;
      this.loading = false;
      this._observer?.disconnect();
      this._observer = null;
      this.removeScrollFallback();
    },

    readPaginationState() {
      const trigger = this.$root.querySelector('[data-bangumis-loadmore]');
      this.nextUrl = trigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;
    },

    shouldShowItem(item) {
      if (!item || !this.searchQuery) return true;
      const keyword = normalize(this.searchQuery);
      const haystack = [
        item.dataset.bangumiTitle,
        item.dataset.bangumiType,
        item.dataset.bangumiArea,
        item.dataset.bangumiDescription
      ].map(normalize).join(' ');
      return haystack.includes(keyword);
    },

    visibleCount() {
      const cards = Array.from(this.$root.querySelectorAll('[data-bangumi-card]'));
      if (!this.searchQuery) return cards.length;
      return cards.filter((card) => this.shouldShowItem(card)).length;
    },

    installInfiniteLoader() {
      if (this._destroyed) return;
      const sentinel = this.$root.querySelector('[data-bangumis-scroll-sentinel]');
      const scroller = this.$root.querySelector('.bangumis-main-scroll');
      if (!sentinel) return;

      if (!('IntersectionObserver' in window)) {
        this.installScrollFallback(scroller);
        return;
      }

      this._observer?.disconnect();
      this._observer = new IntersectionObserver((entries) => {
        if (!this._destroyed && !this.loadError && entries[0]?.isIntersecting) {
          this.loadNext();
        }
      }, {
        root: scroller,
        rootMargin: '360px 0px'
      });

      this._observer.observe(sentinel);
      this.installScrollFallback(scroller);
    },

    installScrollFallback(scroller) {
      if (this._destroyed) return;
      this.removeScrollFallback();
      if (!scroller) return;

      this._fallbackScrollHandler = () => this.checkScrollFallback();

      scroller.addEventListener('scroll', this._fallbackScrollHandler, { passive: true });
      this.checkScrollFallback();
    },

    checkScrollFallback() {
      if (this._destroyed || this.loadError) return;
      const scroller = this.$root.querySelector('.bangumis-main-scroll');
      if (!scroller) return;

      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceToBottom < 420) {
        this.loadNext();
      }
    },

    removeScrollFallback() {
      const scroller = this.$root.querySelector('.bangumis-main-scroll');
      if (scroller && this._fallbackScrollHandler) {
        scroller.removeEventListener('scroll', this._fallbackScrollHandler);
      }
      this._fallbackScrollHandler = null;
    },

    appendCards(cards) {
      const list = this.$root.querySelector('.bangumis-list');
      if (!list || !cards.length) return;

      cards.forEach((card) => {
        card.classList.add('bangumi-card--injected');
        list.appendChild(card);
        window.Alpine?.initTree?.(card);
      });
    },

    updatePaginationFrom(doc) {
      const nextTrigger = doc.querySelector('[data-bangumis-loadmore]');
      this.nextUrl = nextTrigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);

      const currentTrigger = this.$root.querySelector('[data-bangumis-loadmore]');
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
      if (this._destroyed || this.loading || !this.hasMore || !this.nextUrl) return;

      this.loading = true;
      this.loadError = false;
      const requestUrl = this.nextUrl;
      const requestRoot = this.$root;
      const generation = ++this._paginationGeneration;
      const controller = new AbortController();
      this._paginationController = controller;

      const isCurrentRequest = () => !this._destroyed
        && generation === this._paginationGeneration
        && this._paginationController === controller
        && this.$root === requestRoot
        && this.nextUrl === requestUrl;

      try {
        const response = await fetch(requestUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        if (!isCurrentRequest()) return;
        if (!matchesRequestedPage(requestUrl, response.url)) {
          throw new Error('追番分页响应与请求地址不符');
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = readPaginationPage(doc, html);

        this.appendCards(cards);
        this.updatePaginationFrom(doc);
        this.$nextTick(() => {
          if (this._destroyed || generation !== this._paginationGeneration) return;
          this.checkScrollFallback();
        });
      } catch (error) {
        if (error?.name === 'AbortError' || !isCurrentRequest()) return;
        this.loadError = true;
        warnApiCall('bangumis', '追番下一页加载失败', {
          url: requestUrl,
          message: error?.message || String(error || ''),
          action: 'show-load-error',
          hint: '检查追番插件页面分页链接、HTML 片段中的 data-bangumi-card 和接口返回状态。'
        });
      } finally {
        if (this._paginationController === controller) {
          this._paginationController = null;
          this.loading = false;
        }
      }
    }
  }));
}
