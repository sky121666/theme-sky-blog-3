import { isThemeImageUrl, cloneThemeSettingsValue, THEME_SETTINGS_ICON_FIELDS, THEME_SETTINGS_IMAGE_FIELDS } from '../theme-settings-core.js';

// The dialog owns temporary selections; the settings store owns persistence.
// Async operation identity stays outside Alpine's reactive Proxy.
export function createSettingsAssetPicker({
  getSettings,
  getDialog = () => document.getElementById('theme-asset-picker'),
  getActiveElement = () => document.activeElement,
  loadAttachmentClient = () => import('./attachment-client.js'),
  loadIconClient = () => import('./icon-catalog.js'),
  loadIconFormatter = () => import('./icon-svg.js')
}) {
  let operation = null;
  let generation = 0;
  let previewGeneration = 0;
  let collectionOperation = null;
  let collectionGeneration = 0;
  let initialIconOptions = null;
  let restoreFocus = null;
  let searchTimer = null;
  const cancelScheduledSearch = () => { clearTimeout(searchTimer); searchTimer = null; };

  return {
    visible: false, kind: 'image', path: '', title: '', tab: 'library',
    query: '', page: 1, totalPages: 1, total: 0, items: [], policies: [], policyName: '',
    busy: false, uploading: false, error: '', notice: '', selectedUrl: '', urlInput: '',
    iconCollection: '', iconCollections: [], collectionsBusy: false, collectionsError: '', iconPaging: false, iconRequestedPage: 1,
    selectedIcon: null, iconPreview: '', iconPreviewError: '', iconColor: '#ffffff', hasMore: false,
    iconUseColor: false, iconWidth: 24, accepts: [], originalIcon: null,

    imageTypeDescription() {
      const labels = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/svg+xml': 'SVG' };
      return this.accepts.map((type) => labels[type]).join('、');
    },

    beginOperation() {
      cancelScheduledSearch();
      operation?.abort();
      operation = new AbortController();
      const id = ++generation;
      this.busy = true;
      this.error = '';
      return { id, signal: operation.signal };
    },

    isCurrent(task) { return this.visible && task.id === generation && !task.signal.aborted; },

    start(kind, path, title) {
      const settings = getSettings();
      if (!settings?.canOpen || !settings.visible || settings.saving || this.uploading) return false;
      const dialog = getDialog();
      if (!dialog?.showModal) return false;
      cancelScheduledSearch();
      operation?.abort();
      collectionOperation?.abort();
      collectionGeneration++;
      generation++;
      previewGeneration++;
      initialIconOptions = null;
      restoreFocus = getActiveElement();
      Object.assign(this, {
        visible: true, kind, path, title, tab: 'library', query: '', page: 1,
        totalPages: 1, total: 0, items: [], busy: false, uploading: false,
        error: '', notice: '', selectedUrl: '', selectedIcon: null, iconPreview: '', iconPreviewError: '', hasMore: false,
        urlInput: '', iconCollection: '', iconCollections: [], collectionsBusy: false, collectionsError: '', iconPaging: false, iconRequestedPage: 1,
        iconUseColor: false, iconWidth: 24, originalIcon: null
      });
      if (!dialog.open) dialog.showModal();
      return true;
    },

    async openImage(path) {
      const field = THEME_SETTINGS_IMAGE_FIELDS.find((item) => item.path === path);
      if (!field || !this.start('image', path, field.label)) return;
      this.accepts = [...field.accepts];
      this.selectedUrl = String(getSettings().value(path, '') || '');
      this.urlInput = this.selectedUrl;
      await this.search();
    },

    async openIcon(path) {
      const field = THEME_SETTINGS_ICON_FIELDS.find((item) => item.path === path);
      if (!field || !this.start('icon', path, field.label)) return;
      const current = getSettings().value(path, '');
      this.originalIcon = current?.value ? cloneThemeSettingsValue(current) : null;
      this.iconWidth = Number(current?.width) || 24;
      const currentColor = typeof current?.color === 'string' ? current.color.trim() : '';
      const inputColor = /^#[0-9a-f]{3}$/i.test(currentColor)
        ? `#${[...currentColor.slice(1)].map((channel) => channel.repeat(2)).join('')}` : currentColor;
      this.iconUseColor = /^#[0-9a-f]{6}$/i.test(inputColor);
      this.iconColor = this.iconUseColor ? inputColor : '#ffffff';
      initialIconOptions = { width: this.iconWidth, useColor: this.iconUseColor, color: this.iconColor };
      if (current?.value) {
        this.selectedIcon = { name: current.name || '', svg: current.value };
        const prefix = /^([a-z0-9]+(?:-[a-z0-9]+)*):[a-z0-9-]+$/.exec(current.name || '')?.[1];
        this.iconCollection = prefix || '';
      }
      void this.loadIconCollections();
      await Promise.all([this.search(), this.selectedIcon ? this.updateIconPreview() : undefined]);
    },

    async loadIconCollections() {
      if (!this.visible || this.kind !== 'icon') return;
      collectionOperation?.abort();
      const controller = new AbortController();
      collectionOperation = controller;
      const id = ++collectionGeneration;
      const isCurrent = () => this.visible && this.kind === 'icon' && id === collectionGeneration && !controller.signal.aborted;
      this.collectionsBusy = true;
      this.collectionsError = '';
      try {
        const client = await loadIconClient();
        if (!isCurrent()) return;
        const result = await client.listIconCollections({ signal: controller.signal });
        if (isCurrent()) this.iconCollections = result.collections;
      } catch (_error) {
        if (isCurrent()) this.collectionsError = '图标集目录暂时无法加载，仍可搜索或使用当前图标。';
      } finally {
        if (isCurrent()) this.collectionsBusy = false;
      }
    },

    iconCollectionOptions() {
      if (!this.iconCollection || this.iconCollections.some((item) => item.prefix === this.iconCollection)) return this.iconCollections;
      return [{ prefix: this.iconCollection, name: this.iconCollection }, ...this.iconCollections];
    },

    iconResultsLabel() {
      if (this.query.trim()) return '搜索结果';
      if (!this.iconCollection) return '常用图标';
      return this.iconCollections.find((item) => item.prefix === this.iconCollection)?.name || this.iconCollection;
    },

    prepareIconSearch() {
      if (!this.visible || this.kind !== 'icon') return;
      // Invalidate on input, before the debounce starts the next network call.
      operation?.abort();
      operation = null;
      generation++;
      this.busy = true;
      this.error = '';
      this.notice = '';
      this.iconRequestedPage = 1;
    },

    scheduleSearch() {
      cancelScheduledSearch();
      if (!this.visible || this.uploading) return;
      this.prepareIconSearch();
      const id = generation;
      searchTimer = setTimeout(() => {
        searchTimer = null;
        if (this.visible && id === generation) void this.search();
      }, 300);
    },

    async search(nextPage = 1) {
      if (!this.visible || this.uploading || (this.kind === 'image' && this.tab !== 'library')) return;
      const requestedPage = Math.max(1, Number(nextPage) || 1);
      this.iconPaging = this.page > 1 || this.hasMore;
      if (this.kind === 'icon') this.iconRequestedPage = requestedPage;
      else this.page = requestedPage;
      const task = this.beginOperation();
      if (this.kind === 'image') { this.items = []; this.hasMore = false; }
      if (this.kind === 'icon') this.notice = '';
      try {
        if (this.kind === 'image') {
          const client = await loadAttachmentClient();
          if (!this.isCurrent(task)) return;
          const result = await client.listAttachments({ keyword: this.query, page: this.page, size: 24, signal: task.signal, accepts: this.accepts });
          if (!this.isCurrent(task)) return;
          this.items = result.items;
          this.totalPages = Math.max(1, result.totalPages || 1);
          this.total = result.total || 0;
        } else {
          const client = await loadIconClient();
          if (!this.isCurrent(task)) return;
          // Keep the last page stable while batches arrive; publish one complete
          // page so icons and the modal never shift underneath pointer/focus.
          const result = await client.searchIcons({
            query: this.query, collection: this.iconCollection, page: requestedPage, signal: task.signal
          });
          if (!this.isCurrent(task)) return;
          this.items = result.icons;
          this.page = requestedPage;
          this.total = result.total;
          this.hasMore = Boolean(result.hasMore);
          this.notice = result.notice || '';
          getDialog()?.querySelector?.('.theme-asset-icon-grid')?.scrollTo({ top: 0, behavior: 'instant' });
        }
      } catch (error) {
        if (this.isCurrent(task)) this.error = error.message || '加载失败，请重试。';
      } finally {
        if (this.isCurrent(task)) this.busy = false;
      }
    },

    async switchIconCollection(collection) {
      if (!this.visible || this.kind !== 'icon') return;
      if (collection && !this.iconCollectionOptions().some((item) => item.prefix === collection)) return;
      this.iconCollection = collection;
      await this.search();
    },

    async refreshIcons() {
      if (this.collectionsError) void this.loadIconCollections();
      await this.search(this.iconRequestedPage);
    },

    async searchIconSuggestion(query) {
      if (!this.visible || this.kind !== 'icon') return;
      this.query = query;
      await this.search();
    },

    async switchTab(tab) {
      if (this.uploading || !this.visible) return;
      cancelScheduledSearch();
      operation?.abort();
      generation++;
      this.tab = tab;
      this.busy = false;
      this.error = '';
      if (tab === 'library') return this.search();
      if (tab !== 'upload') return;
      this.policies = [];
      this.policyName = '';
      const task = this.beginOperation();
      try {
        const client = await loadAttachmentClient();
        if (!this.isCurrent(task)) return;
        const policies = await client.listUploadPolicies({ signal: task.signal });
        if (!this.isCurrent(task)) return;
        this.policies = policies;
        if (!policies.some((policy) => policy.name === this.policyName)) this.policyName = policies[0]?.name || '';
        if (!policies.length) this.error = '没有可用的存储策略，请先在 Halo 附件设置中配置。';
      } catch (error) {
        if (this.isCurrent(task)) this.error = error.message || '无法读取存储策略。';
      } finally {
        if (this.isCurrent(task)) this.busy = false;
      }
    },

    async upload(file) {
      if (!this.visible || !file || this.busy || !this.policyName) return;
      const task = this.beginOperation();
      this.uploading = true;
      this.notice = '正在上传到 Halo 附件库…';
      try {
        const client = await loadAttachmentClient();
        if (!this.isCurrent(task)) return;
        const attachment = await client.uploadImage(file, { policyName: this.policyName, signal: task.signal, accepts: this.accepts });
        if (!this.isCurrent(task)) return;
        this.selectImage(attachment);
        this.notice = '已上传到附件库；选择使用后，还需在设置中点击应用。';
      } catch (error) {
        if (this.isCurrent(task)) {
          this.error = error.message || '上传失败。';
          this.notice = error.uploaded || ['upload-uncertain', 'timeout'].includes(error.code)
            ? '请先刷新附件库检查结果，避免重复上传。' : '';
        }
      } finally {
        if (this.isCurrent(task)) { this.busy = false; this.uploading = false; }
      }
    },

    selectImage(image) {
      const url = String(image?.url || '');
      if (image?.mediaType && !this.accepts.includes(image.mediaType)) { this.error = '这张图片的格式不适用于当前设置。'; return; }
      if (!isThemeImageUrl(url)) { this.error = '这张图片尚无可用地址，请稍后刷新附件库。'; return; }
      this.selectedUrl = url;
      this.urlInput = url;
      this.error = '';
    },

    useUrl() {
      const url = this.urlInput.trim();
      if (!isThemeImageUrl(url)) { this.error = '请输入 HTTP、HTTPS 图片地址或站内路径。'; return; }
      const knownTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
      let extension = '';
      try { extension = decodeURIComponent(new URL(url, 'https://theme.invalid').pathname).split('.').at(-1).toLowerCase(); } catch (_error) { /* URL validity is checked above. */ }
      if (knownTypes[extension] && !this.accepts.includes(knownTypes[extension])) {
        this.selectedUrl = ''; this.error = '图片地址的格式不适用于当前设置。'; return;
      }
      this.selectImage({ url });
      if (!knownTypes[extension]) this.notice = '地址未包含图片格式，请确认资源符合当前设置支持的类型。';
    },

    async selectIcon(icon) {
      this.selectedIcon = icon;
      await this.updateIconPreview();
    },

    async updateIconPreview() {
      if (!this.visible || !this.selectedIcon) return;
      // A catalog search cannot invalidate the user's current selection preview.
      const id = ++previewGeneration;
      try {
        const formatter = await loadIconFormatter();
        if (!this.visible || id !== previewGeneration) return;
        this.iconPreview = formatter.makeThemeIcon(this.selectedIcon, {
          color: this.iconUseColor ? this.iconColor : '', width: this.iconWidth
        }).value;
        this.iconPreviewError = '';
      } catch (error) { if (this.visible && id === previewGeneration) { this.iconPreview = ''; this.iconPreviewError = error.message || '图标格式无效。'; } }
    },

    async confirm() {
      const settings = getSettings();
      if (!this.visible || (this.kind === 'image' && this.busy) || !settings?.canOpen || settings.saving) return;
      if (this.kind === 'image') {
        if (!isThemeImageUrl(this.selectedUrl)) return;
        settings.setImage(this.path, this.selectedUrl);
      } else {
        if (!this.selectedIcon) return;
        // Browsing and confirming an unchanged selection must not normalize a
        // Console value (including metadata or colors this editor cannot edit).
        if (this.originalIcon && this.selectedIcon.svg === this.originalIcon.value
          && this.selectedIcon.name === (this.originalIcon.name || '')
          && this.iconWidth === initialIconOptions?.width
          && this.iconUseColor === initialIconOptions.useColor && this.iconColor === initialIconOptions.color) {
          this.close();
          return;
        }
        const id = generation;
        try {
          const formatter = await loadIconFormatter();
          if (!this.visible || id !== generation || settings.saving || !settings.canOpen) return;
          settings.update(this.path, { ...this.originalIcon, ...formatter.makeThemeIcon(this.selectedIcon, {
            color: this.iconUseColor ? this.iconColor : '', width: this.iconWidth
          }) });
        } catch (error) {
          if (this.visible && id === generation) this.iconPreviewError = error.message || '图标格式无效。';
          return;
        }
      }
      this.close();
    },

    useDefaultIcon() {
      if (!this.visible || this.kind !== 'icon' || !getSettings()?.canOpen || getSettings().saving) return;
      getSettings().update(this.path, '');
      this.close();
    },

    close() {
      if (!this.visible) return;
      cancelScheduledSearch();
      if (this.uploading) {
        const settings = getSettings();
        settings.statusTone = 'warning';
        settings.statusMessage = '已停止等待上传；文件可能已进入附件库，再次上传前请先检查附件库。';
      }
      operation?.abort();
      operation = null;
      collectionOperation?.abort();
      collectionOperation = null;
      collectionGeneration++;
      generation++;
      previewGeneration++;
      this.visible = false;
      this.busy = false;
      this.uploading = false;
      this.collectionsBusy = false;
      this.items = [];
      getDialog()?.close();
      if (restoreFocus?.isConnected) restoreFocus.focus?.({ preventScroll: true });
      restoreFocus = null;
    },

    destroy() { this.close(); }
  };
}

export function registerThemeSettingsAssetPicker(Alpine) {
  Alpine.store('themeAssets', createSettingsAssetPicker({ getSettings: () => Alpine.store('themeSettings') }));
}
