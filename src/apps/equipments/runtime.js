import { withRequestDeadline } from '../../shared/request-deadline.js';
import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

function readPaginationPage(doc, html, requestUrl, response) {
  const requested = new URL(requestUrl, window.location.href);
  const received = new URL(response.url || '', window.location.href);
  requested.searchParams.sort();
  received.searchParams.sort();
  const body = doc.body;
  const app = body?.querySelector('[data-app-root="equipments"]');
  const scroller = app?.querySelector('.equipments-stage-scroller');
  const trigger = scroller?.querySelector('[data-equipments-loadmore]');
  const empty = app?.querySelector('.equipments-empty [class*="lucide--archive-x"]');
  if (response.redirected || !response.url
    || requested.origin !== received.origin || requested.pathname !== received.pathname
    || requested.search !== received.search
    || !/<\/body>\s*<\/html>\s*$/i.test(html)
    || body?.dataset.errorPage !== 'false'
    || body.dataset.pageMode !== 'browser-equipments'
    || body.dataset.appId !== 'equipments' || body.dataset.windowVariant !== 'equipments'
    || !app?.querySelector('[data-app-props="equipments"]')
    || (!scroller && !empty)
    || (scroller && (!trigger || !trigger.querySelector('[data-equipments-scroll-sentinel]')))) {
    throw new Error('装备分页响应与请求地址或页面协议不符');
  }
  const cards = Array.from(scroller?.querySelectorAll(':scope > [data-equipment-card]') || []);
  if (scroller && !cards.length) throw new Error('装备分页响应缺少条目');
  return cards;
}

export function registerEquipmentsExplorer(Alpine) {
  Alpine.data('equipmentsExplorer', () => ({
    nextUrl: '',
    hasMore: false,
    loading: false,
    loadError: false,
    currentIndex: 0,
    itemCount: 0,
    _stageTargetIndex: null,
    _stageInputHandler: null,
    _stageScrollHandler: null,
    _stageScrollFrame: null,
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
        this.readCards();
        this.installStageNavigation();
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
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (scroller && this._stageScrollHandler) scroller.removeEventListener('scroll', this._stageScrollHandler);
      if (scroller && this._stageInputHandler) {
        for (const event of ['wheel', 'pointerdown', 'keydown']) scroller.removeEventListener(event, this._stageInputHandler);
      }
      if (this._stageScrollFrame != null) cancelAnimationFrame(this._stageScrollFrame);
      this._stageTargetIndex = null;
      this._stageInputHandler = null;
      this._stageScrollHandler = null;
      this._stageScrollFrame = null;
    },

    readCards() {
      this.itemCount = this.$root.querySelectorAll('[data-equipment-card]').length;
      this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.itemCount - 1));
    },

    installStageNavigation() {
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (!scroller || this._stageScrollHandler) return;
      this._stageScrollHandler = () => {
        if (this._stageScrollFrame != null) return;
        this._stageScrollFrame = requestAnimationFrame(() => {
          this._stageScrollFrame = null;
          if (this._destroyed) return;
          const cards = Array.from(this.$root.querySelectorAll('[data-equipment-card]'));
          const center = scroller.scrollTop + scroller.clientHeight / 2;
          let distance = Infinity;
          let nearest = 0;
          cards.forEach((card, index) => {
            const delta = Math.abs(card.offsetTop + card.offsetHeight / 2 - center);
            if (delta < distance) { distance = delta; nearest = index; }
          });
          // A second button press starts at its previous destination, even mid-scroll.
          if (this._stageTargetIndex !== null && nearest !== this._stageTargetIndex) return;
          this._stageTargetIndex = null;
          this.currentIndex = nearest;
        });
      };
      scroller.addEventListener('scroll', this._stageScrollHandler, { passive: true });
      this._stageInputHandler = () => { this._stageTargetIndex = null; this._stageScrollHandler(); };
      for (const event of ['wheel', 'pointerdown', 'keydown']) scroller.addEventListener(event, this._stageInputHandler, { passive: true });
    },

    async stepEquipment(direction) {
      if (this._destroyed || this.loading) return;
      const next = this.currentIndex + direction;
      if (next < 0) return;
      if (next >= this.itemCount && this.hasMore) await this.loadNext();
      if (this._destroyed || next >= this.itemCount) return;
      const card = this.$root.querySelectorAll('[data-equipment-card]')[next];
      const scroller = this.$root.querySelector('.equipments-stage-scroller');
      if (!card || !scroller) return;
      this._stageTargetIndex = next;
      this.currentIndex = next;
      scroller.scrollTo({ top: card.offsetTop, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
          if (!this._destroyed && !this.loadError && entries[0]?.isIntersecting) {
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
      if (this._destroyed || this.loadError) return;
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
      this.readCards();
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
        const { response, html } = await withRequestDeadline(async (signal) => {
          const response = await fetch(requestUrl, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            signal
          });
          if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
          }

          return { response, html: await response.text() };
        }, { signal: controller.signal });
        if (!isCurrentRequest()) return;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = readPaginationPage(doc, html, requestUrl, response);

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
