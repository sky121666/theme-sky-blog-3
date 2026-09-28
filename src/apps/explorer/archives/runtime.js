import { warnApiCall } from '../../../shell/desktop-shell/runtime/shared/debug.js';

function toPositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export { buildArchiveCatalog } from './catalog.js';
import { loadArchiveCatalog as loadSharedArchiveCatalog } from './catalog.js';

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
    archiveBaseUrl: '/archives',
    archiveCatalogUrl: '',
    catalogLoading: false,
    catalogError: false,
    _catalogController: null,
    _catalogGeneration: 0,
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
      this.archiveBaseUrl = this.$root.dataset.archiveBaseUrl || '/archives';
      this.archiveCatalogUrl = this.$root.dataset.archiveCatalogUrl || '';
      this.readPaginationState();

      const firstPost = this.$root.querySelector('[data-archive-post-option]');
      if (firstPost) this.selectPost(firstPost);
      if (this.archiveCatalogUrl) this.loadArchiveCatalog();
    },

    destroy() {
      this._destroyed = true;
      this._paginationGeneration += 1;
      this._paginationController?.abort();
      this._paginationController = null;
      this._catalogGeneration += 1;
      this._catalogController?.abort();
      this._catalogController = null;
      this.loading = false;
      this.catalogLoading = false;
    },

    readPaginationState() {
      const trigger = this.$root.querySelector('[data-archive-loadmore]');
      this.nextUrl = trigger?.dataset.nextUrl || trigger?.href || '';
      this.hasMore = Boolean(this.nextUrl);
      this.loadError = false;
      this.loadedCount = this.$root.querySelectorAll('[data-archive-post-option]').length;
    },

    async loadArchiveCatalog({ force = false } = {}) {
      if (!this.archiveCatalogUrl || this._destroyed) return;
      this._catalogController?.abort();
      const controller = new AbortController();
      this._catalogController = controller;
      const generation = ++this._catalogGeneration;
      this.catalogLoading = true;
      this.catalogError = false;
      this.$root.dataset.archiveIndexComplete = 'false';
      const isCurrent = () => !this._destroyed
        && generation === this._catalogGeneration
        && this._catalogController === controller
        && !controller.signal.aborted;
      try {
        const catalog = await loadSharedArchiveCatalog(this.archiveCatalogUrl, {
          force, signal: controller.signal, scope: this.$root.dataset.archiveCatalogScope || ''
        });
        if (!isCurrent()) return;
        this.renderArchiveCatalog(catalog);
      } catch (error) {
        if (!isCurrent() || error?.name === 'AbortError') return;
        this.catalogError = true;
        this.$root.dataset.archiveIndexComplete = 'false';
        warnApiCall('explorer-archives', '完整归档目录加载失败', {
          message: error?.message || String(error || ''),
          action: 'keep-ssr-catalog',
          hint: '页面会保留服务端当前范围；检查公开文章内容 API。'
        });
      } finally {
        if (this._catalogController === controller) {
          this._catalogController = null;
          this.catalogLoading = false;
        }
      }
    },

    renderArchiveCatalog(catalog) {
      const yearNav = this.$root.querySelector('.archive-sidebar-nav');
      const monthList = this.$root.querySelector('[data-archive-month-list]');
      if (!yearNav || !monthList) return;
      if (!catalog.length) {
        yearNav.replaceChildren();
        monthList.replaceChildren();
        this.$root.dataset.archiveIndexComplete = 'true';
        return;
      }

      const makeLink = ({ href, app, className, current, attributes = {}, children = [] }) => {
        const link = document.createElement('a');
        link.href = href;
        link.className = `${className} pjax-link${current ? ' is-active' : ''}`;
        link.dataset.pjaxApp = app;
        Object.entries(attributes).forEach(([name, value]) => link.setAttribute(name, value));
        if (current) link.setAttribute('aria-current', 'page');
        children.forEach((child) => link.appendChild(child));
        return link;
      };
      const makeSpan = (className, text = '') => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
      };

      const yearFragment = document.createDocumentFragment();
      catalog.forEach(({ year }) => {
        const icon = makeSpan('archive-folder-icon archive-folder-icon--sidebar icon-[lucide--folder]');
        icon.setAttribute('aria-hidden', 'true');
        yearFragment.appendChild(makeLink({
          href: `${this.archiveBaseUrl}/${year}`,
          app: 'explorer-archives',
          className: 'archive-sidebar-item',
          current: year === this.activeYear,
          attributes: {
            'data-archive-year-option': '',
            'data-year': year,
            'data-year-label': `${year} 年`
          },
          children: [icon, makeSpan('archive-sidebar-label', `${year} 年`)]
        }));
      });
      yearNav.replaceChildren(yearFragment);

      const activeYear = catalog.find((entry) => entry.year === this.activeYear) || catalog[0];
      const monthNav = document.createElement('nav');
      monthNav.dataset.archiveYearPanel = '';
      monthNav.dataset.year = activeYear.year;
      monthNav.setAttribute('aria-label', `${activeYear.year} 年归档月份`);
      activeYear.months.forEach(({ month, count }) => {
        const key = `${activeYear.year}-${month}`;
        const main = document.createElement('div');
        main.className = 'archive-entry-main';
        const icon = makeSpan('archive-folder-icon archive-folder-icon--entry icon-[lucide--folder]');
        icon.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('div');
        copy.className = 'archive-entry-copy';
        const title = document.createElement('h2');
        title.className = 'archive-entry-title';
        title.textContent = `${month} 月`;
        copy.appendChild(title);
        main.append(icon, copy);
        const trailing = makeSpan('archive-entry-trailing archive-entry-trailing--month', `${count} 篇`);
        const chevron = makeSpan('archive-entry-chevron icon-[lucide--chevron-right]');
        chevron.setAttribute('aria-hidden', 'true');
        monthNav.appendChild(makeLink({
          href: `${this.archiveBaseUrl}/${activeYear.year}/${month}`,
          app: 'explorer-archives',
          className: 'archive-entry archive-entry--folder',
          current: key === this.activeMonthKey,
          attributes: {
            'data-archive-month-option': '',
            'data-parent-year': activeYear.year,
            'data-month-key': key,
            'data-month-label': `${activeYear.year} 年 ${month} 月`,
            'data-month-count': String(count)
          },
          children: [main, trailing, chevron]
        }));
      });
      monthList.replaceChildren(monthNav);
      this.$root.dataset.archiveIndexComplete = 'true';
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
