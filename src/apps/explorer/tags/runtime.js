import { escapeHtml } from '../../../shared/utils.js';
import { renderBatch } from '../shared/render-batch.js';

const TAG_PAGE_SIZE = 20;
const TAG_CACHE_TTL = 5 * 60 * 1000;

export function registerTagsExplorer(Alpine) {
  Alpine.data('tagsExplorer', () => ({
    activeTagKey: '',
    activeTagName: '',
    activeTagHref: '',
    activeTagCount: '',
    activeTagColor: '',
    activeTagCover: '',
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
    _ssrTagKey: '',

    init() {
      const firstTag = this.$root.querySelector('[data-tags-folder]');
      if (!firstTag) return;
      this._ssrTagKey = firstTag.dataset.tagKey || '';
      this.selectTag(
        firstTag.dataset.tagKey,
        firstTag.dataset.tagName,
        firstTag.dataset.tagHref,
        firstTag.dataset.tagCount,
        firstTag.dataset.tagColor,
        firstTag.dataset.tagCover
      );
    },

    async selectTag(key, name, href, count, color, cover) {
      this.activeTagKey = key || '';
      this.activeTagName = name || '';
      this.activeTagHref = href || '';
      this.activeTagCount = count || '';
      this.activeTagColor = color || '';
      this.activeTagCover = cover || '';
      this.clearPost();

      if (key === this._ssrTagKey) {
        this.dynamicLoaded = false;
        this.loading = false;
        this.showSsrPanel(true);
        this.selectFirstSsrPost();
      } else {
        this.showSsrPanel(false);
        await this.fetchTagPosts(key, name);
      }
    },

    showSsrPanel(visible) {
      const ssrList = this.$root.querySelector('[data-tag-posts-list]');
      if (ssrList) ssrList.style.display = visible ? '' : 'none';
      const ssrOverflow = ssrList?.parentElement?.querySelector('.tags-post-overflow');
      if (ssrOverflow) ssrOverflow.style.display = visible ? '' : 'none';
    },

    selectFirstSsrPost() {
      const firstPost = this.$root.querySelector('[data-tag-posts-list] [data-tag-post-item]');
      if (firstPost) {
        this.selectPost(firstPost);
        this.postTotal = Number(this.activeTagCount) || 0;
      }
    },

    async fetchTagPosts(tagName, displayName) {
      if (this.fetchController) this.fetchController.abort();
      const controller = new AbortController();
      this.fetchController = controller;

      const cacheKey = `tag-posts-${tagName}`;
      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.data && Date.now() - parsed.timestamp < TAG_CACHE_TTL) {
            this.renderDynamicPosts(parsed.data, parsed.total, displayName);
            return;
          }
        }
      } catch { /* ignore */ }

      this.loading = true;
      this.dynamicLoaded = false;

      try {
        const url = `/apis/api.content.halo.run/v1alpha1/posts?fieldSelector=${encodeURIComponent('spec.tags=' + tagName)}&page=1&size=${TAG_PAGE_SIZE}&sort=spec.publishTime%2Cdesc`;
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

      const listEl = this.$root.querySelector('[data-tag-posts-list]');
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

        return `<a class="tag-post-row pjax-link" data-pjax-app="reader" href="${escapeHtml(href)}"
          data-tag-post-item
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
          <div class="tag-post-row-main">
            <svg class="tag-post-file-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.75H9.25L12.5 5V12.5C12.5 13.3284 11.8284 14 11 14H4C3.17157 14 2.5 13.3284 2.5 12.5V3.25C2.5 2.42157 3.17157 1.75 4 1.75Z" stroke="currentColor" stroke-width="1.1" />
              <path d="M9 1.75V5.25H12.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
            </svg>
            <span class="tag-post-row-title">${title}</span>
          </div>
          <span class="tag-post-row-meta">
            <time>${escapeHtml(date)}</time>
            <span>${comments} 评论</span>
          </span>
        </a>`;
      });

      if (items.length === 0) {
        htmlItems.push('<div class="tags-post-empty"><p>这个标签下还没有文章。</p></div>');
      }

      const activeTagHref = this.activeTagHref;

      renderBatch(listEl, htmlItems, {
        onComplete: () => {
          listEl.style.display = '';

          const existingOverflow = listEl.parentElement?.querySelector('.tags-post-overflow');
          if (existingOverflow) existingOverflow.remove();
          if (total > TAG_PAGE_SIZE) {
            listEl.insertAdjacentHTML('afterend',
              `<div class="tags-post-overflow"><a class="tags-post-viewmore pjax-link" data-pjax-app="explorer-tags" href="${escapeHtml(activeTagHref)}">查看全部 ${total} 篇文章 →</a></div>`);
          }

          if (window.pjax) {
            listEl.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((link) => {
              link.setAttribute('data-pjax-managed', 'true');
              window.pjax.attachLink(link);
            });
            const overflowLink = listEl.parentElement?.querySelector('.tags-post-overflow a.pjax-link:not([data-pjax-attached])');
            if (overflowLink) {
              overflowLink.setAttribute('data-pjax-managed', 'true');
              window.pjax.attachLink(overflowLink);
            }
          }

          const prevEl = prevSelectedKey ? listEl.querySelector(`[data-post-key="${prevSelectedKey}"]`) : null;
          const target = prevEl || listEl.querySelector('[data-tag-post-item]');
          if (target) this.selectPost(target);

          const scroll = this.$root.querySelector('.tag-posts-scroll');
          if (scroll) scroll.scrollTop = 0;
          const previewScroll = this.$root.querySelector('.tags-preview-scroll');
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

export function registerTagPostsExplorer(Alpine) {
  Alpine.data('tagPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',

    init() {
      const firstPost = this.$root.querySelector('[data-tag-post-option]');
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
