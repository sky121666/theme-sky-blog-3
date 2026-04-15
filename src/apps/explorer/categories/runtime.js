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
    _ssrCategoryKey: '',

    init() {
      const firstCategory = this.$root.querySelector('[data-categories-folder]');
      if (!firstCategory) return;
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
        await this.fetchCategoryPosts(key, name);
      }
    },

    showSsrPanel(visible) {
      const ssrList = this.$root.querySelector('[data-category-posts-list]');
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

    async fetchCategoryPosts(categoryName, displayName) {
      if (this.fetchController) this.fetchController.abort();
      const controller = new AbortController();
      this.fetchController = controller;

      const cacheKey = `cat-posts-${categoryName}`;
      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.data && Date.now() - parsed.timestamp < CAT_CACHE_TTL) {
            this.renderDynamicPosts(parsed.data, parsed.total, displayName);
            return;
          }
        }
      } catch { /* ignore */ }

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

        if (controller.signal.aborted) return;
        this.renderDynamicPosts(items, total, displayName);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        this.loading = false;
        this.dynamicLoaded = true;
        this.dynamicPosts = [];
      }
    },

    renderDynamicPosts(items, total, parentName) {
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
            <svg class="category-post-file-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.75H9.25L12.5 5V12.5C12.5 13.3284 11.8284 14 11 14H4C3.17157 14 2.5 13.3284 2.5 12.5V3.25C2.5 2.42157 3.17157 1.75 4 1.75Z" stroke="currentColor" stroke-width="1.1" />
              <path d="M9 1.75V5.25H12.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
            </svg>
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

      renderBatch(listEl, htmlItems, {
        onComplete: () => {
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
