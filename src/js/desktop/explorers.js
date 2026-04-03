/**
 * 内容浏览器 Alpine 组件集合
 * tagsExplorer / tagPostsExplorer / authorPostsExplorer
 * categoriesExplorer / categoryPostsExplorer
 */

import { escapeHtml, toPositiveInt } from '../shared/utils.js';
import { normalizeMomentRecord, renderMomentRow, renderMomentPreview } from '../shared/moments.js';

export function registerExplorers(Alpine) {

  const TAG_PAGE_SIZE = 20;
  const TAG_CACHE_TTL = 5 * 60 * 1000; // 5 min

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
      // Remember the SSR-rendered tag key so we can skip API for it
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
        // First tag: use SSR-rendered DOM
        this.dynamicLoaded = false;
        this.loading = false;
        this.showSsrPanel(true);
        this.selectFirstSsrPost();
      } else {
        // Other tags: hide SSR panel, fetch via API
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
      // Cancel previous request
      if (this.fetchController) this.fetchController.abort();
      const controller = new AbortController();
      this.fetchController = controller;

      // Check sessionStorage cache
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
      this.dynamicPosts = [];

      try {
        const url = `/apis/api.content.halo.run/v1alpha1/posts?fieldSelector=${encodeURIComponent('spec.tags=' + tagName)}&page=1&size=${TAG_PAGE_SIZE}&sort=spec.publishTime%2Cdesc`;
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const result = await resp.json();
        const items = Array.isArray(result?.items) ? result.items : [];
        const total = result?.total ?? items.length;

        // Cache
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: items,
            total
          }));
        } catch { /* quota */ }

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

      // Build dynamic post rows
      const postsHtml = items.map((post) => {
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
      }).join('');

      // Overflow link
      const overflowHtml = total > TAG_PAGE_SIZE
        ? `<div class="tags-post-overflow"><a class="tags-post-viewmore pjax-link" data-pjax-app="explorer" href="${escapeHtml(this.activeTagHref)}">查看全部 ${total} 篇文章 →</a></div>`
        : '';

      const emptyHtml = items.length === 0
        ? '<div class="tags-post-empty"><p>这个标签下还没有文章。</p></div>'
        : '';

      listEl.innerHTML = postsHtml + emptyHtml;
      listEl.style.display = '';

      // Insert overflow after list
      const existingOverflow = listEl.parentElement?.querySelector('.tags-post-overflow');
      if (existingOverflow) existingOverflow.remove();
      if (overflowHtml) listEl.insertAdjacentHTML('afterend', overflowHtml);

      // Attach pjax links
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

      // Select first post
      const firstPost = listEl.querySelector('[data-tag-post-item]');
      if (firstPost) this.selectPost(firstPost);

      // Scroll to top
      const scroll = this.$root.querySelector('.tag-posts-scroll');
      if (scroll) scroll.scrollTop = 0;
      const previewScroll = this.$root.querySelector('.tags-preview-scroll');
      if (previewScroll) previewScroll.scrollTop = 0;
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
    }
  }));

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

  Alpine.data('authorPostsExplorer', () => ({
    activeSource: 'posts',
    activePostKey: '',
    activePostTitle: '',
    activeMomentKey: '',
    activeMomentTitle: '',
    authorDisplayName: '',
    authorName: '',
    momentsEnabled: false,
    momentPage: 1,
    renderedMomentPage: 1,
    momentPageSize: 10,
    momentTotal: 0,
    momentTotalPages: 0,
    momentListEl: null,
    momentPreviewEl: null,
    momentPaginationEl: null,
    momentEmptyEl: null,
    momentFetchController: null,

    async init() {
      this.authorDisplayName = this.$root.querySelector('.author-profile-name')?.textContent?.trim() || '';
      this.authorName = this.$root.dataset.authorName || '';
      this.momentsEnabled = this.$root.dataset.momentsEnabled === 'true';
      this.momentPageSize = toPositiveInt(this.$root.dataset.momentPageSize, 10);
      this.momentTotal = toPositiveInt(this.$root.dataset.momentTotal, 0);
      this.momentTotalPages = toPositiveInt(this.$root.dataset.momentTotalPages, 0);
      this.momentPage = 1;
      this.renderedMomentPage = 1;
      this.cacheMomentElements();
      this.normalizeMomentText();
      this.bindMomentControls();

      const urlState = this.readUrlState();
      const defaultSource = this.$root.dataset.defaultSource || 'posts';
      this.activeSource = urlState.source === 'moments' && this.momentsEnabled ? 'moments' : defaultSource;
      this.momentPage = urlState.momentPage;

      if (this.activeSource === 'moments' && this.momentsEnabled && this.momentPage > 1) {
        await this.goToMomentPage(this.momentPage, { preserveSelection: false, updateUrl: false });
      } else {
        await this.syncSourceSelection({ preserveCurrent: false, updateUrl: false });
      }

      this.writeUrlState();
    },

    cacheMomentElements() {
      this.momentListEl = this.$root.querySelector('[data-author-moment-list]');
      this.momentPreviewEl = this.$root.querySelector('[data-author-moment-preview-list]');
      this.momentPaginationEl = this.$root.querySelector('[data-author-moment-pagination]');
      this.momentEmptyEl = this.$root.querySelector('[data-author-moment-empty]');
    },

    bindMomentControls() {
      if (this.momentListEl && !this.momentListEl.dataset.bound) {
        const activateMoment = (event) => {
          const optionEl = event.target.closest('[data-author-moment-option]');
          if (!optionEl || !this.momentListEl.contains(optionEl)) return;
          this.selectMoment(optionEl.dataset.momentKey, optionEl.dataset.momentTitle);
        };

        this.momentListEl.addEventListener('click', activateMoment);
        this.momentListEl.addEventListener('focusin', activateMoment);
        this.momentListEl.addEventListener('mouseover', (event) => {
          const optionEl = event.target.closest('[data-author-moment-option]');
          if (!optionEl || !this.momentListEl.contains(optionEl)) return;
          if (event.relatedTarget && optionEl.contains(event.relatedTarget)) return;
          this.selectMoment(optionEl.dataset.momentKey, optionEl.dataset.momentTitle);
        });

        this.momentListEl.dataset.bound = 'true';
      }

      if (this.momentPaginationEl && !this.momentPaginationEl.dataset.bound) {
        this.momentPaginationEl.addEventListener('click', (event) => {
          const buttonEl = event.target.closest('[data-moment-page-target]');
          if (!buttonEl || !this.momentPaginationEl.contains(buttonEl)) return;
          if (buttonEl.disabled || buttonEl.classList.contains('is-disabled')) return;

          const targetPage = buttonEl.dataset.momentPageTarget === 'next'
            ? this.momentPage + 1
            : this.momentPage - 1;
          this.goToMomentPage(targetPage, { preserveSelection: false, updateUrl: true });
        });

        this.momentPaginationEl.dataset.bound = 'true';
      }
    },

    readUrlState() {
      try {
        const params = new URLSearchParams(window.location.search);
        return {
          source: params.get('source') || '',
          momentPage: toPositiveInt(params.get('momentPage'), 1)
        };
      } catch (_error) {
        return { source: '', momentPage: 1 };
      }
    },

    writeUrlState() {
      try {
        const url = new URL(window.location.href);
        if (this.activeSource === 'moments') {
          url.searchParams.set('source', 'moments');
          if (this.momentPage > 1) {
            url.searchParams.set('momentPage', String(this.momentPage));
          } else {
            url.searchParams.delete('momentPage');
          }
        } else {
          url.searchParams.delete('source');
          url.searchParams.delete('momentPage');
        }
        window.history.replaceState(null, '', url.toString());
      } catch (_error) {}
    },

    async switchSource(source) {
      if (source === this.activeSource) return;
      this.activeSource = source;
      this.momentPage = 1;
      await this.syncSourceSelection({ preserveCurrent: false, updateUrl: true });
    },

    async syncSourceSelection({ preserveCurrent = false, updateUrl = true } = {}) {
      if (this.activeSource === 'posts') {
        if (!preserveCurrent || !this.activePostKey) {
          const firstPost = this.$root.querySelector('[data-author-post-option]');
          if (firstPost) {
            this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
          }
        }
      } else if (this.activeSource === 'moments') {
        if (!preserveCurrent || !this.activeMomentKey) {
          const firstMoment = this.$root.querySelector('[data-author-moment-option]');
          if (firstMoment) {
            this.selectMoment(firstMoment.dataset.momentKey, firstMoment.dataset.momentTitle);
          }
        }
      }

      if (updateUrl) this.writeUrlState();
    },

    selectSource(source) {
      return this.switchSource(source);
    },

    get activeSourcePath() {
      return this.activeSource === 'moments'
        ? (this.activeMomentTitle || '未选择瞬间')
        : (this.activePostTitle || '未选择文章');
    },

    get currentPreviewTitle() {
      return this.activeSource === 'moments'
        ? this.activeMomentTitle
        : this.activePostTitle;
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    },

    selectMoment(momentKey, title) {
      this.activeMomentKey = momentKey || '';
      this.activeMomentTitle = title || '';
      this.syncMomentPanelVisibility();
    },

    syncMomentPanelVisibility() {
      if (!this.momentPreviewEl) return;
      this.momentPreviewEl.querySelectorAll('[data-author-moment-panel]').forEach((panel) => {
        panel.style.display = panel.dataset.momentKey === this.activeMomentKey ? '' : 'none';
      });
    },

    normalizeMomentText() {
      this.$root.querySelectorAll('[data-moment-text-raw]').forEach((el) => {
        const raw = el.dataset.momentTextRaw || '';
        if (!raw) return;
        el.innerHTML = escapeHtml(raw).replace(/\n/g, '<br>');
        el.removeAttribute('data-moment-text-raw');
      });
    },

    async goToMomentPage(page, { preserveSelection = false, updateUrl = true } = {}) {
      const nextPage = Math.max(1, Math.min(page, this.momentTotalPages || 1));
      this.momentPage = nextPage;

      if (nextPage === this.renderedMomentPage) {
        this.renderMomentPagination();
        if (updateUrl) this.writeUrlState();
        return;
      }

      const momentItems = await this.fetchMomentPage(nextPage);
      if (!momentItems) return;

      this.renderMomentPage(momentItems);
      this.renderMomentPagination();
      this.renderedMomentPage = nextPage;

      if (!preserveSelection) {
        const firstItem = momentItems[0];
        if (firstItem) {
          this.selectMoment(firstItem.name || '', firstItem.ownerName || '');
        } else {
          this.activeMomentKey = '';
          this.activeMomentTitle = '';
        }
      }

      this.scrollListToTop();
      this.scrollPreviewToTop();

      if (updateUrl) this.writeUrlState();
    },

    async fetchMomentPage(page) {
      if (this.momentFetchController) {
        this.momentFetchController.abort();
      }

      const controller = new AbortController();
      this.momentFetchController = controller;

      const cacheKey = `author-moments-${this.authorName}-page-${page}`;
      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const entry = JSON.parse(cached);
          if (entry?.data && Date.now() - entry.timestamp < 5 * 60 * 1000) {
            return entry.data;
          }
        }
      } catch (_error) {}

      try {
        const url = `/apis/api.moment.halo.run/v1alpha1/moments?page=${page}&size=${this.momentPageSize}&sort=metadata.creationTimestamp%2Cdesc&ownerName=${encodeURIComponent(this.authorName)}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;

        const json = await response.json();
        const items = Array.isArray(json?.items) ? json.items : [];

        if (json?.total != null) {
          this.momentTotal = json.total;
          this.momentTotalPages = json.totalPages ?? Math.ceil(this.momentTotal / this.momentPageSize);
        }

        const data = items.map((item) => normalizeMomentRecord(item));

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data
          }));
        }

        return data;
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        return null;
      }
    },

    renderMomentPage(momentItems) {
      if (this.momentListEl) {
        this.momentListEl.innerHTML = momentItems.map((moment) => renderMomentRow(moment)).join('');
      }

      if (this.momentPreviewEl) {
        this.momentPreviewEl.innerHTML = momentItems.map((moment) => renderMomentPreview(moment, this.authorDisplayName)).join('');
      }

      if (this.momentEmptyEl) {
        this.momentEmptyEl.hidden = momentItems.length > 0;
      }

      this.syncMomentPanelVisibility();
    },

    renderMomentPagination() {
      if (!this.momentPaginationEl) return;

      if (this.momentTotalPages <= 1) {
        this.momentPaginationEl.hidden = true;
        return;
      }

      const prevDisabled = this.momentPage <= 1;
      const nextDisabled = this.momentPage >= this.momentTotalPages;

      this.momentPaginationEl.hidden = false;
      this.momentPaginationEl.innerHTML = `
        <button type="button"
                class="author-page-btn tag-page-btn${prevDisabled ? ' is-disabled' : ''}"
                data-moment-page-target="prev"
                ${prevDisabled ? 'disabled' : ''}>
          上一页
        </button>
        <span class="author-page-indicator tag-page-indicator">${escapeHtml(`${this.momentPage} / ${this.momentTotalPages}`)}</span>
        <button type="button"
                class="author-page-btn tag-page-btn${nextDisabled ? ' is-disabled' : ''}"
                data-moment-page-target="next"
                ${nextDisabled ? 'disabled' : ''}>
          下一页
        </button>
      `;
    },

    scrollListToTop() {
      const listScroll = this.$root.querySelector('.author-posts-scroll');
      if (listScroll) {
        listScroll.scrollTop = 0;
      }
    },

    scrollPreviewToTop() {
      const previewScroll = this.$root.querySelector('.author-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    }
  }));

  const CAT_PAGE_SIZE = 20;
  const CAT_CACHE_TTL = 5 * 60 * 1000;

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
      this.dynamicPosts = [];

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
        } catch { /* quota */ }

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

      const postsHtml = items.map((post) => {
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
      }).join('');

      const overflowHtml = total > CAT_PAGE_SIZE
        ? `<div class="categories-post-overflow"><a class="categories-post-viewmore pjax-link" data-pjax-app="explorer" href="${escapeHtml(this.activeCategoryHref)}">查看全部 ${total} 篇文章 →</a></div>`
        : '';

      const emptyHtml = items.length === 0
        ? '<div class="categories-post-empty"><p>这个分类下还没有文章。</p></div>'
        : '';

      listEl.innerHTML = postsHtml + emptyHtml;
      listEl.style.display = '';

      const existingOverflow = listEl.parentElement?.querySelector('.categories-post-overflow');
      if (existingOverflow) existingOverflow.remove();
      if (overflowHtml) listEl.insertAdjacentHTML('afterend', overflowHtml);

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

      const firstPost = listEl.querySelector('[data-category-post-item]');
      if (firstPost) this.selectPost(firstPost);

      const scroll = this.$root.querySelector('.category-posts-scroll');
      if (scroll) scroll.scrollTop = 0;
      const previewScroll = this.$root.querySelector('.categories-preview-scroll');
      if (previewScroll) previewScroll.scrollTop = 0;
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
    }
  }));

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
