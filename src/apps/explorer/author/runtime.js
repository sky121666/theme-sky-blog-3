import { escapeHtml, toPositiveInt } from '../../../shared/utils.js';
import { normalizeMomentRecord, renderMomentRow, renderMomentPreview } from '../../../shared/moments.js';
import { renderBatch } from '../shared/render-batch.js';

export function registerAuthorPostsExplorer(Alpine) {
  Alpine.data('authorPostsExplorer', () => ({
    activeSource: 'posts',
    activePostKey: '',
    activePostTitle: '',
    activeMomentKey: '',
    activeMomentTitle: '',
    authorDisplayName: '',
    authorName: '',
    postTotal: 0,
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
    _momentPageGeneration: 0,
    _momentListRenderGeneration: 0,
    _momentPreviewRenderGeneration: 0,
    _momentListRenderJob: null,
    _momentPreviewRenderJob: null,
    previewVisible: true,

    checkPreviewVisible() {
      const pane = this.$root.querySelector('.author-preview-pane');
      if (!pane) { this.previewVisible = false; return; }
      const wasVisible = this.previewVisible;
      this.previewVisible = pane.offsetWidth > 0 && window.getComputedStyle(pane).display !== 'none';

      if (!wasVisible && this.previewVisible) {
        this.syncSourceSelection({ preserveCurrent: true, updateUrl: false });
        if (this.activeSource === 'moments' && this.renderedMomentPage > 0) {
          this._cancelMomentFetch();
          const targetPage = this.momentPage;
          const generation = ++this._momentPageGeneration;
          this.fetchMomentPage(targetPage, generation).then((items) => {
            if (items
              && generation === this._momentPageGeneration
              && targetPage === this.momentPage
              && this.activeSource === 'moments'
              && this.momentPreviewEl) {
              const previewHtml = items.map((m) => renderMomentPreview(m, this.authorDisplayName));
              this._momentPreviewRenderJob?.cancel();
              const renderGeneration = ++this._momentPreviewRenderGeneration;
              let renderJob = null;
              renderJob = renderBatch(this.momentPreviewEl, previewHtml, {
                isCurrent: () => renderGeneration === this._momentPreviewRenderGeneration,
                onComplete: () => {
                  if (renderGeneration !== this._momentPreviewRenderGeneration) return;
                  if (this._momentPreviewRenderJob === renderJob) this._momentPreviewRenderJob = null;
                  this.syncMomentPanelVisibility();
                  if (window.pjax) {
                    this.momentPreviewEl.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((link) => {
                      link.setAttribute('data-pjax-managed', 'true');
                      window.pjax.attachLink(link);
                    });
                  }
                }
              });
              this._momentPreviewRenderJob = renderJob.completed ? null : renderJob;
            }
          });
        }
      }
    },

    async init() {
      this.authorDisplayName = this.$root.querySelector('.author-profile-name')?.textContent?.trim() || '';
      this.authorName = this.$root.dataset.authorName || '';
      this.postTotal = toPositiveInt(this.$root.dataset.postTotal, 0);
      this.momentsEnabled = this.$root.dataset.momentsEnabled === 'true';
      this.momentPageSize = toPositiveInt(this.$root.dataset.momentPageSize, 10);
      this.momentTotal = toPositiveInt(this.$root.dataset.momentTotal, 0);
      this.momentTotalPages = toPositiveInt(this.$root.dataset.momentTotalPages, 0);
      this.momentPage = 1;
      this.renderedMomentPage = 1;
      this.cacheMomentElements();
      this.normalizeMomentText();
      this.bindMomentControls();

      this.checkPreviewVisible();
      this._pvResizeHandler = () => {
        clearTimeout(this._pvResizeTimeout);
        this._pvResizeTimeout = setTimeout(() => this.checkPreviewVisible(), 120);
      };
      window.addEventListener('resize', this._pvResizeHandler);

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
        const currentState = window.history.state;
        const nextState = currentState && typeof currentState === 'object'
          ? { ...currentState, url: url.toString() }
          : { url: url.toString() };
        window.history.replaceState(nextState, '', url.toString());
      } catch (_error) {}
    },

    async switchSource(source) {
      if (source === this.activeSource) return;

      if (source === 'moments') {
        this.activeSource = source;
        await this.goToMomentPage(1, { preserveSelection: false, updateUrl: false });
        this.writeUrlState();
        return;
      }

      if (this.activeSource === 'moments') {
        this._cancelMomentFetch();
        this._momentPageGeneration += 1;
      }
      this.activeSource = source;
      this.momentPage = this.renderedMomentPage;
      await this.syncSourceSelection({ preserveCurrent: false, updateUrl: true });
    },

    async syncSourceSelection({ preserveCurrent = false, updateUrl = true } = {}) {
      if (this.previewVisible) {
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
      }

      if (updateUrl) this.writeUrlState();
    },

    selectSource(source) {
      return this.switchSource(source);
    },

    get activeSourcePath() {
      if (!this.previewVisible) {
        if (this.activeSource === 'moments') {
          const pageInfo = this.momentTotalPages > 1 ? ` · ${this.momentPage} / ${this.momentTotalPages}` : '';
          return `${this.momentTotal} 条公开瞬间${pageInfo}`;
        }
        return `${this.postTotal} 篇公开文章`;
      }
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
      this._cancelMomentFetch();
      const generation = ++this._momentPageGeneration;
      this.momentPage = nextPage;

      if (nextPage === this.renderedMomentPage) {
        if (!preserveSelection) {
          const firstMoment = this.$root?.querySelector('[data-author-moment-option]');
          if (firstMoment) {
            this.selectMoment(firstMoment.dataset.momentKey, firstMoment.dataset.momentTitle);
          } else {
            this.activeMomentKey = '';
            this.activeMomentTitle = '';
          }
        }
        this.renderMomentPagination();
        if (updateUrl) this.writeUrlState();
        return;
      }

      const momentItems = await this.fetchMomentPage(nextPage, generation);
      const requestIsCurrent = generation === this._momentPageGeneration
        && nextPage === this.momentPage
        && this.activeSource === 'moments';
      if (!momentItems || !requestIsCurrent) {
        if (!momentItems && requestIsCurrent) {
          this.momentPage = this.renderedMomentPage;
          this.renderMomentPagination();
          if (updateUrl) this.writeUrlState();
        }
        return;
      }

      this.renderMomentPage(momentItems);
      this.renderMomentPagination();
      this.renderedMomentPage = nextPage;

      if (!preserveSelection) {
        const firstItem = momentItems[0];
        if (firstItem) {
          this.selectMoment(firstItem.key || '', firstItem.title || '');
        } else {
          this.activeMomentKey = '';
          this.activeMomentTitle = '';
        }
      }

      this.scrollListToTop();
      if (this.previewVisible) this.scrollPreviewToTop();

      if (updateUrl) this.writeUrlState();
    },

    _cancelMomentFetch() {
      this.momentFetchController?.abort();
      this.momentFetchController = null;
    },

    _cancelMomentRenderJobs() {
      this._momentListRenderGeneration += 1;
      this._momentPreviewRenderGeneration += 1;
      this._momentListRenderJob?.cancel();
      this._momentPreviewRenderJob?.cancel();
      this._momentListRenderJob = null;
      this._momentPreviewRenderJob = null;
    },

    async fetchMomentPage(page, generation = ++this._momentPageGeneration) {
      this._cancelMomentFetch();

      const controller = new AbortController();
      this.momentFetchController = controller;

      const cacheKey = `author-moments-${this.authorName}-page-${page}`;
      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const entry = JSON.parse(cached);
          if (entry?.data && Date.now() - entry.timestamp < 5 * 60 * 1000) {
            const cachedData = generation === this._momentPageGeneration && !controller.signal.aborted
              ? entry.data
              : null;
            if (this.momentFetchController === controller) this.momentFetchController = null;
            return cachedData;
          }
        }
      } catch (_error) {}

      try {
        const url = `/apis/api.moment.halo.run/v1alpha1/moments?page=${page}&size=${this.momentPageSize}&sort=metadata.creationTimestamp%2Cdesc&ownerName=${encodeURIComponent(this.authorName)}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;

        const json = await response.json();
        const items = Array.isArray(json?.items) ? json.items : [];

        if (generation !== this._momentPageGeneration || controller.signal.aborted) return null;

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
      } finally {
        if (this.momentFetchController === controller) this.momentFetchController = null;
      }
    },

    renderMomentPage(momentItems) {
      this._cancelMomentRenderJobs();
      const listRenderGeneration = this._momentListRenderGeneration;
      const previewRenderGeneration = this._momentPreviewRenderGeneration;
      const listHtmlItems = momentItems.map((moment) => renderMomentRow(moment));
      const previewHtmlItems = momentItems.map((moment) => renderMomentPreview(moment, this.authorDisplayName));

      if (this.momentListEl) {
        let renderJob = null;
        renderJob = renderBatch(this.momentListEl, listHtmlItems, {
          isCurrent: () => listRenderGeneration === this._momentListRenderGeneration,
          onComplete: () => {
            if (listRenderGeneration !== this._momentListRenderGeneration) return;
            if (this._momentListRenderJob === renderJob) this._momentListRenderJob = null;
            this.syncMomentPanelVisibility();
            if (window.pjax) {
              this.momentListEl.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((link) => {
                link.setAttribute('data-pjax-managed', 'true');
                window.pjax.attachLink(link);
              });
            }
          }
        });
        this._momentListRenderJob = renderJob.completed ? null : renderJob;
      }

      if (this.previewVisible && this.momentPreviewEl) {
        let renderJob = null;
        renderJob = renderBatch(this.momentPreviewEl, previewHtmlItems, {
          isCurrent: () => previewRenderGeneration === this._momentPreviewRenderGeneration,
          onComplete: () => {
            if (previewRenderGeneration !== this._momentPreviewRenderGeneration) return;
            if (this._momentPreviewRenderJob === renderJob) this._momentPreviewRenderJob = null;
            if (window.pjax) {
              this.momentPreviewEl.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((link) => {
                link.setAttribute('data-pjax-managed', 'true');
                window.pjax.attachLink(link);
              });
            }
          }
        });
        this._momentPreviewRenderJob = renderJob.completed ? null : renderJob;
      }

      if (this.momentEmptyEl) {
        this.momentEmptyEl.hidden = momentItems.length > 0;
      }
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
    },

    destroy() {
      this._momentPageGeneration += 1;
      this._cancelMomentFetch();
      this._cancelMomentRenderJobs();
      if (this._pvResizeHandler) {
        window.removeEventListener('resize', this._pvResizeHandler);
        this._pvResizeHandler = null;
      }
      clearTimeout(this._pvResizeTimeout);
    }
  }));
}
