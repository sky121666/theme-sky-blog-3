/**
 * 内容浏览器 Alpine 组件集合
 * tagsExplorer / tagPostsExplorer / authorPostsExplorer
 * categoriesExplorer / categoryPostsExplorer
 */

import { escapeHtml, toPositiveInt } from '../shared/utils.js';
import { normalizeMomentRecord, renderMomentRow, renderMomentPreview } from '../shared/moments.js';

export function registerExplorers(Alpine) {

  Alpine.data('tagsExplorer', () => ({
    activeTagKey: '',
    activeTagPage: 1,
    activeTagName: '',
    activeTagHref: '',
    activeTagCount: '',
    activeTagColor: '',
    activeTagCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstTag = this.$root.querySelector('[data-tags-folder]');
      if (!firstTag) return;
      this.selectTag(firstTag.dataset.tagKey, firstTag.dataset.tagName, firstTag.dataset.tagHref, firstTag.dataset.tagCount, firstTag.dataset.tagColor, firstTag.dataset.tagCover);
    },

    selectTag(key, name, href, count, color, cover) {
      this.activeTagKey = key || '';
      this.activeTagPage = 1;
      this.activeTagName = name || '';
      this.activeTagHref = href || '';
      this.activeTagCount = count || '';
      this.activeTagColor = color || '';
      this.activeTagCover = cover || '';
      this.syncTagPosts();
    },

    selectTagPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeTagPage = nextPage;
      this.syncTagPosts();
    },

    syncTagPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-tags-post-option]'))
        .find((el) => (
          el.dataset.parentTagKey === this.activeTagKey &&
          Number(el.dataset.tagPage || '1') === this.activeTagPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.tag-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.tags-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('tagPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-tag-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
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
        const url = `/apis/api.plugin.halo.run/v1alpha1/plugins/PluginMoments/moments?page=${page}&size=${this.momentPageSize}&sort=metadata.creationTimestamp%2Cdesc&contributor=${encodeURIComponent(this.authorName)}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;

        const json = await response.json();
        const items = Array.isArray(json?.items) ? json.items : [];

        if (json?.total != null) {
          this.momentTotal = json.total;
          this.momentTotalPages = Math.ceil(this.momentTotal / this.momentPageSize);
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

  Alpine.data('categoriesExplorer', () => ({
    activeCategoryKey: '',
    activeCategoryPage: 1,
    activeCategoryName: '',
    activeCategoryHref: '',
    activeCategoryCount: '',
    activeCategoryDescription: '',
    activeCategoryCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstCategory = this.$root.querySelector('[data-categories-folder]');
      if (!firstCategory) return;
      this.selectCategory(
        firstCategory.dataset.categoryKey,
        firstCategory.dataset.categoryName,
        firstCategory.dataset.categoryHref,
        firstCategory.dataset.categoryCount,
        firstCategory.dataset.categoryDescription,
        firstCategory.dataset.categoryCover
      );
    },

    selectCategory(key, name, href, count, description, cover) {
      this.activeCategoryKey = key || '';
      this.activeCategoryPage = 1;
      this.activeCategoryName = name || '';
      this.activeCategoryHref = href || '';
      this.activeCategoryCount = count || '';
      this.activeCategoryDescription = description || '';
      this.activeCategoryCover = cover || '';
      this.syncCategoryPosts();
    },

    selectCategoryPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeCategoryPage = nextPage;
      this.syncCategoryPosts();
    },

    syncCategoryPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-categories-post-option]'))
        .find((el) => (
          el.dataset.parentCategoryKey === this.activeCategoryKey &&
          Number(el.dataset.categoryPage || '1') === this.activeCategoryPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.category-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.categories-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('categoryPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-category-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));
}
