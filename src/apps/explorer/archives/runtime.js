import { warnApiCall } from '../../../shell/desktop-shell/runtime/shared/debug.js';

function toPositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function initArchiveSidebar() {
  return null;
}

export function registerArchiveExplorer(Alpine) {
  Alpine.data('archiveExplorer', () => ({
    activeYear: '',
    activeYearLabel: '',
    activeMonthKey: '',
    activeMonthLabel: '',
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',
    nextUrl: '',
    hasMore: false,
    loading: false,
    loadError: false,
    loadedCount: 0,
    currentPage: 1,
    pageSize: 10,
    _paginationController: null,
    _paginationGeneration: 0,
    _destroyed: false,

    init() {
      this._destroyed = false;
      this.activeYear = this.$root.dataset.activeYear || '';
      this.activeYearLabel = this.$root.dataset.activeYearLabel || '';
      this.activeMonthKey = this.$root.dataset.activeMonthKey || '';
      this.activeMonthLabel = this.$root.dataset.activeMonthLabel || '';
      this.currentPage = toPositiveInteger(this.$root.dataset.currentPage, 1);
      this.pageSize = toPositiveInteger(this.$root.dataset.pageSize, 10);
      this.readPaginationState();

      const firstPost = this.$root.querySelector('[data-archive-post-option]');
      if (firstPost) this.selectPost(firstPost);
    },

    destroy() {
      this._destroyed = true;
      this._paginationGeneration += 1;
      this._paginationController?.abort();
      this._paginationController = null;
      this.loading = false;
    },

    readPaginationState() {
      const trigger = this.$root.querySelector('[data-archive-loadmore]');
      this.nextUrl = trigger?.dataset.nextUrl || trigger?.href || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;
      this.loadedCount = this.$root.querySelectorAll('[data-archive-post-option]').length;
    },

    selectPost(el) {
      if (!el?.dataset) return;
      this.activePostKey = el.dataset.postKey || '';
      this.activePostTitle = el.dataset.postTitle || '';
      this.activePostDate = el.dataset.postDate || '';
      this.activePostComments = el.dataset.postComments || '0';
      this.activePostExcerpt = el.dataset.postExcerpt || '';
      this.activePostParentName = el.dataset.postParentName || '';
      this.activePostAuthor = el.dataset.postAuthor || '';
      this.activePostHref = el.href || el.dataset.postHref || '';
    },

    clearPost() {
      this.activePostKey = '';
      this.activePostTitle = '';
      this.activePostDate = '';
      this.activePostComments = '';
      this.activePostExcerpt = '';
      this.activePostParentName = '';
      this.activePostAuthor = '';
      this.activePostHref = '';
    },

    appendPosts(posts) {
      const list = this.$root.querySelector('[data-archive-post-list]');
      if (!list || !posts.length) return 0;

      const existingKeys = new Set(
        Array.from(list.querySelectorAll('[data-archive-post-option]'))
          .map((post) => post.dataset.postKey)
          .filter(Boolean)
      );
      let appended = 0;
      let firstAppended = null;

      posts.forEach((post) => {
        const postKey = post.dataset.postKey || '';
        if (postKey && existingKeys.has(postKey)) return;
        if (postKey) existingKeys.add(postKey);
        post.classList.add('archive-entry--injected');
        list.appendChild(post);
        window.Alpine?.initTree?.(post);
        firstAppended ||= post;
        appended += 1;
      });

      this.loadedCount = list.querySelectorAll('[data-archive-post-option]').length;
      if (firstAppended && typeof firstAppended.focus === 'function') {
        const focusFirstAppended = () => firstAppended.focus({ preventScroll: true });
        if (typeof this.$nextTick === 'function') this.$nextTick(focusFirstAppended);
        else focusFirstAppended();
      }
      return appended;
    },

    replaceVisibleUrl(url) {
      if (!url || typeof window === 'undefined' || !window.history?.replaceState) return;
      const resolved = new URL(url, window.location.href);
      const nextState = {
        ...(window.history.state || {}),
        url: resolved.href
      };
      window.history.replaceState(nextState, '', resolved.href);
    },

    updatePaginationFrom(doc, requestUrl) {
      const responseRoot = doc.querySelector('[data-app-root="explorer-archives"] .archive-workspace');
      const responseTrigger = doc.querySelector('[data-archive-loadmore]');
      const candidateNextUrl = responseTrigger?.dataset.nextUrl || responseTrigger?.href || '';
      this.currentPage = toPositiveInteger(responseRoot?.dataset.currentPage, this.currentPage + 1);
      this.$root.dataset.currentPage = String(this.currentPage);
      this.nextUrl = candidateNextUrl && candidateNextUrl !== requestUrl ? candidateNextUrl : '';
      this.hasMore = Boolean(this.nextUrl);
      this.replaceVisibleUrl(requestUrl);

      const currentTrigger = this.$root.querySelector('[data-archive-loadmore]');
      if (currentTrigger) {
        currentTrigger.dataset.nextUrl = this.nextUrl;
        if (this.nextUrl) currentTrigger.href = this.nextUrl;
      }
    },

    async loadNext() {
      if (this._destroyed || this.loading || !this.hasMore || !this.nextUrl) return;

      this.loading = true;
      this.loadError = false;
      const requestUrl = this.nextUrl;
      const requestRoot = this.$root;
      const requestMonthKey = this.activeMonthKey;
      const generation = ++this._paginationGeneration;
      const controller = new AbortController();
      this._paginationController = controller;

      const isCurrentRequest = () => !this._destroyed
        && generation === this._paginationGeneration
        && this._paginationController === controller
        && this.$root === requestRoot
        && this.activeMonthKey === requestMonthKey
        && this.nextUrl === requestUrl;

      try {
        const response = await fetch(requestUrl, {
          headers: {
            Accept: 'text/html',
            'X-Requested-With': 'XMLHttpRequest'
          },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        if (!isCurrentRequest()) return;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const responseRoot = doc.querySelector('[data-app-root="explorer-archives"] .archive-workspace');
        if (responseRoot?.dataset.activeMonthKey !== requestMonthKey) {
          throw new Error('归档分页响应月份不匹配');
        }

        const posts = Array.from(doc.querySelectorAll('[data-archive-post-list] > [data-archive-post-option]'));
        if (!posts.length) {
          this.nextUrl = '';
          this.hasMore = false;
          return;
        }

        this.appendPosts(posts);
        this.updatePaginationFrom(doc, requestUrl);
      } catch (error) {
        if (error?.name === 'AbortError' || !isCurrentRequest()) return;
        this.loadError = true;
        warnApiCall('explorer-archives', '归档月份下一页加载失败', {
          url: requestUrl,
          message: error?.message || String(error || ''),
          action: 'show-load-error',
          hint: '检查 Halo 月归档 /{year}/{month}/page/{page} 路由和归档文章 HTML 协议。'
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
