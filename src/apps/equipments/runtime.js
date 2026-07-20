import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

export function registerEquipmentsExplorer(Alpine) {
  Alpine.data('equipmentsExplorer', () => ({
    nextUrl: '',
    hasMore: false,
    loading: false,
    loadError: false,
    _observer: null,
    _fallbackScrollHandler: null,
    _paginationController: null,
    _paginationGeneration: 0,
    _destroyed: false,

    init() {
      this._destroyed = false;
      this.readPaginationState();
      const generation = this._paginationGeneration;
      this.$nextTick(() => {
        if (this._destroyed || generation !== this._paginationGeneration) return;
        this.installInfiniteLoader();
      });
    },

    destroy() {
      this._destroyed = true;
      this._paginationGeneration += 1;
      this._paginationController?.abort();
      this._paginationController = null;
      this.loading = false;
      this._observer?.disconnect();
      this._observer = null;
      this.removeScrollFallback();
    },

    readPaginationState() {
      const trigger = this.$root.querySelector('[data-equipments-loadmore]');
      this.nextUrl = trigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;
    },

    installInfiniteLoader() {
      if (this._destroyed) return;
      const sentinel = this.$root.querySelector('[data-equipments-scroll-sentinel]');
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (!sentinel) return;

      if ('IntersectionObserver' in window) {
        this._observer?.disconnect();
        this._observer = new IntersectionObserver((entries) => {
          if (!this._destroyed && entries[0]?.isIntersecting) {
            this.loadNext();
          }
        }, {
          root: scroller,
          rootMargin: '420px 0px'
        });
        this._observer.observe(sentinel);
      }

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
      if (this._destroyed) return;
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (!scroller) return;

      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceToBottom < 520) {
        this.loadNext();
      }
    },

    removeScrollFallback() {
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (scroller && this._fallbackScrollHandler) {
        scroller.removeEventListener('scroll', this._fallbackScrollHandler);
      }
      this._fallbackScrollHandler = null;
    },

    appendCards(cards) {
      const loader = this.$root.querySelector('[data-equipments-loadmore]');
      if (!loader || !cards.length) return;

      cards.forEach((card) => {
        card.classList.add('equipment-hero-card--injected');
        loader.before(card);
        window.Alpine?.initTree?.(card);
      });
    },

    updatePaginationFrom(doc) {
      const nextTrigger = doc.querySelector('[data-equipments-loadmore]');
      this.nextUrl = nextTrigger?.dataset.nextUrl || '';
      this.hasMore = Boolean(this.nextUrl);

      const currentTrigger = this.$root.querySelector('[data-equipments-loadmore]');
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
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = Array.from(doc.querySelectorAll('[data-equipment-card]'));

        if (!cards.length) {
          this.hasMore = false;
          this._observer?.disconnect();
          this._observer = null;
          this.removeScrollFallback();
          return;
        }

        this.appendCards(cards);
        this.updatePaginationFrom(doc);
        this.$nextTick(() => {
          if (this._destroyed || generation !== this._paginationGeneration) return;
          this.checkScrollFallback();
        });
      } catch (error) {
        if (error?.name === 'AbortError' || !isCurrentRequest()) return;
        this.loadError = true;
        warnApiCall('equipments', '装备下一页加载失败', {
          url: requestUrl,
          message: error?.message || String(error || ''),
          action: 'show-load-error',
          hint: '检查装备页面分页链接、HTML 片段中的 data-equipment-card 和接口返回状态。'
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
