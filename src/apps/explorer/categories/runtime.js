import { escapeHtml } from '../../../shared/utils.js';
import { renderBatch } from '../shared/render-batch.js';

const CAT_PAGE_SIZE = 20;
const CAT_CACHE_TTL = 5 * 60 * 1000;

export function registerCategoriesExplorer(Alpine) {
  Alpine.data('categoriesExplorer', () => ({
    activeCategoryKey: '',
    activeCategoryName: '',
    activeCategoryHref: '',
    activeCategoryCount: '',
    activeCategoryDescription: '',
    activeCategoryCover: '',
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',
    loading: false,
    dynamicLoaded: false,
    dynamicPosts: [],
    postTotal: 0,
    fetchController: null,
    _selectionGeneration: 0,
    _renderJob: null,
    _ssrCategoryKey: '',
    _ssrPostNodes: [],
    _ssrOverflowEl: null,
    _showingSsr: true,

    init() {
      const firstCategory = this.$root.querySelector('[data-categories-folder]');
      if (!firstCategory) return;
      const ssrList = this.$root.querySelector('[data-category-posts-list]');
      this._ssrPostNodes = ssrList ? Array.from(ssrList.childNodes) : [];
      this._ssrOverflowEl = ssrList?.parentElement?.querySelector('.categories-post-overflow') || null;
      this._ssrCategoryKey = firstCategory.dataset.categoryKey || '';
      this.selectCategory(
        firstCategory.dataset.categoryKey,
        firstCategory.dataset.categoryName,
        firstCategory.dataset.categoryHref,
        firstCategory.dataset.categoryCount,
        firstCategory.dataset.categoryDescription,
        firstCategory.dataset.categoryCover
      );
    },

    async selectCategory(key, name, href, count, description, cover) {
      this.fetchController?.abort();
      this.fetchController = null;
      this._renderJob?.cancel();
      this._renderJob = null;
      const generation = ++this._selectionGeneration;

      this.activeCategoryKey = key || '';
      this.activeCategoryName = name || '';
      this.activeCategoryHref = href || '';
      this.activeCategoryCount = count || '';
      this.activeCategoryDescription = description || '';
      this.activeCategoryCover = cover || '';
      this.clearPost();

      if (key === this._ssrCategoryKey) {
        this.dynamicLoaded = false;
        this.loading = false;
        this.showSsrPanel(true);
        this.selectFirstSsrPost();
      } else {
        this.showSsrPanel(false);
        await this.fetchCategoryPosts(key, name, generation);
      }
    },

    showSsrPanel(visible) {
      const ssrList = this.$root.querySelector('[data-category-posts-list]');
      if (visible && !this._showingSsr && ssrList && this._ssrPostNodes.length) {
        ssrList.replaceChildren(...this._ssrPostNodes);
        const currentOverflow = ssrList.parentElement?.querySelector('.categories-post-overflow');
        if (currentOverflow && currentOverflow !== this._ssrOverflowEl) currentOverflow.remove();
        if (this._ssrOverflowEl && !this._ssrOverflowEl.isConnected) {
          ssrList.parentElement?.insertBefore(this._ssrOverflowEl, ssrList.nextSibling);
        }
      }
      this._showingSsr = visible;
      if (ssrList) ssrList.style.display = visible ? '' : 'none';
      const ssrOverflow = ssrList?.parentElement?.querySelector('.categories-post-overflow');
      if (ssrOverflow) ssrOverflow.style.display = visible ? '' : 'none';
    },

    selectFirstSsrPost() {
      const firstPost = this.$root.querySelector('[data-category-posts-list] [data-category-post-item]');
      if (firstPost) {
        this.selectPost(firstPost);
        this.postTotal = Number(this.activeCategoryCount) || 0;
      }
    },

    async fetchCategoryPosts(categoryName, displayName, generation = this._selectionGeneration) {
      if (generation !== this._selectionGeneration) return;
      if (this.fetchController) this.fetchController.abort();
      const controller = new AbortController();
      this.fetchController = controller;

      const cacheKey = `cat-posts-${categoryName}`;
      let cachedEntry = null;
      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) cachedEntry = JSON.parse(cached);
      } catch { /* ignore */ }

      if (cachedEntry?.data && Date.now() - cachedEntry.timestamp < CAT_CACHE_TTL) {
        try {
          if (generation === this._selectionGeneration && !controller.signal.aborted) {
            this.renderDynamicPosts(cachedEntry.data, cachedEntry.total, displayName, generation);
          }
        } finally {
          if (this.fetchController === controller) this.fetchController = null;
        }
        return;
      }

      this.loading = true;
      this.dynamicLoaded = false;

      try {
        const url = `/apis/api.content.halo.run/v1alpha1/posts?fieldSelector=${encodeURIComponent('spec.categories=' + categoryName)}&page=1&size=${CAT_PAGE_SIZE}&sort=spec.publishTime%2Cdesc`;
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const result = await resp.json();
        const items = Array.isArray(result?.items) ? result.items : [];
        const total = result?.total ?? items.length;

        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: items,
            total
          }));
        } catch { /* ignore */ }

        if (controller.signal.aborted || generation !== this._selectionGeneration) return;
        this.renderDynamicPosts(items, total, displayName, generation);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (generation !== this._selectionGeneration) return;
        this.loading = false;
        this.dynamicLoaded = true;
        this.dynamicPosts = [];
      } finally {
        if (this.fetchController === controller) this.fetchController = null;
      }
    },

    renderDynamicPosts(items, total, parentName, generation = this._selectionGeneration) {
      if (generation !== this._selectionGeneration) return;
      this._showingSsr = false;
      this.loading = false;
      this.dynamicLoaded = true;
      this.postTotal = total;

      const listEl = this.$root.querySelector('[data-category-posts-list]');
      if (!listEl) return;

      const prevSelectedKey = this.activePostKey;
      const htmlItems = items.map((post) => {
        const key = post.metadata?.name || '';
        const title = escapeHtml(post.spec?.title || '');
        const date = post.spec?.publishTime ? new Date(post.spec.publishTime).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.') : '';
        const comments = post.stats?.comment ?? 0;
        const excerpt = escapeHtml(post.status?.excerpt || '');
        const href = post.status?.permalink || '#';
        const pName = escapeHtml(parentName || '');

        return `<a class="category-post-row pjax-link" data-pjax-app="reader" href="${escapeHtml(href)}"
          data-category-post-item
          data-post-key="${escapeHtml(key)}"
          data-post-title="${title}"
          data-post-date="${escapeHtml(date)}"
          data-post-comments="${comments}"
          data-post-excerpt="${excerpt}"
          data-post-parent-name="${pName}"
          data-post-href="${escapeHtml(href)}"
          @mouseenter="selectPost($el)"
          @focus="selectPost($el)"
          @click="selectPost($el)"
          :class="{ 'is-active': activePostKey === $el.dataset.postKey }">
          <div class="category-post-row-main">
            <span class="category-post-file-icon icon-[lucide--file-text]" aria-hidden="true"></span>
            <span class="category-post-row-title">${title}</span>
          </div>
          <span class="category-post-row-meta">
            <time>${escapeHtml(date)}</time>
            <span>${comments} 评论</span>
          </span>
        </a>`;
      });

      if (items.length === 0) {
        htmlItems.push('<div class="categories-post-empty"><p>这个分类下还没有文章。</p></div>');
      }

      const activeCategoryHref = this.activeCategoryHref;

      this._renderJob?.cancel();
      let renderJob = null;
      renderJob = renderBatch(listEl, htmlItems, {
        isCurrent: () => generation === this._selectionGeneration,
        onComplete: () => {
          if (generation !== this._selectionGeneration) return;
          if (this._renderJob === renderJob) this._renderJob = null;
          listEl.style.display = '';

          const existingOverflow = listEl.parentElement?.querySelector('.categories-post-overflow');
          if (existingOverflow) existingOverflow.remove();
          if (total > CAT_PAGE_SIZE) {
            listEl.insertAdjacentHTML('afterend',
              `<div class="categories-post-overflow"><a class="categories-post-viewmore pjax-link" data-pjax-app="explorer-categories" href="${escapeHtml(activeCategoryHref)}">查看全部 ${total} 篇文章 →</a></div>`);
          }

          if (window.pjax) {
            listEl.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((link) => {
              link.setAttribute('data-pjax-managed', 'true');
              window.pjax.attachLink(link);
            });
            const overflowLink = listEl.parentElement?.querySelector('.categories-post-overflow a.pjax-link:not([data-pjax-attached])');
            if (overflowLink) {
              overflowLink.setAttribute('data-pjax-managed', 'true');
              window.pjax.attachLink(overflowLink);
            }
          }

          const prevEl = prevSelectedKey ? listEl.querySelector(`[data-post-key="${prevSelectedKey}"]`) : null;
          const target = prevEl || listEl.querySelector('[data-category-post-item]');
          if (target) this.selectPost(target);

          const scroll = this.$root.querySelector('.category-posts-scroll');
          if (scroll) scroll.scrollTop = 0;
          const previewScroll = this.$root.querySelector('.categories-preview-scroll');
          if (previewScroll) previewScroll.scrollTop = 0;
        }
      });
      this._renderJob = renderJob.completed ? null : renderJob;
    },

    selectPost(el) {
      if (!el || !el.dataset) return;
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

    destroy() {
      this._selectionGeneration += 1;
      this._renderJob?.cancel();
      this._renderJob = null;
      if (this.fetchController) {
        this.fetchController.abort();
        this.fetchController = null;
      }
    }
  }));
}

export function registerCategoryPostsExplorer(Alpine) {
  Alpine.data('categoryPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',

    init() {
      const firstPost = this.$root.querySelector('[data-category-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost);
    },

    selectPost(el) {
      if (!el || !el.dataset) return;
      this.activePostKey = el.dataset.postKey || '';
      this.activePostTitle = el.dataset.postTitle || '';
      this.activePostDate = el.dataset.postDate || '';
      this.activePostComments = el.dataset.postComments || '0';
      this.activePostExcerpt = el.dataset.postExcerpt || '';
      this.activePostParentName = el.dataset.postParentName || '';
      this.activePostAuthor = el.dataset.postAuthor || '';
      this.activePostHref = el.href || el.dataset.postHref || '';
    }
  }));
}
