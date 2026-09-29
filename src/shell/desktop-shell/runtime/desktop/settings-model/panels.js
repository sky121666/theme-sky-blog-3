import { SETTINGS_FIELDS, SETTINGS_PANES } from './schema.js';

const CONTENT_FIELDS = { categories: 'categories', tags: 'tags', posts: 'posts', singlepages: 'single_pages' };
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('zh-CN');
const selectionName = (value) => typeof value === 'string' ? value : value?.name ?? value?.metadata?.name ?? value?.value;

// Resource requests live outside Alpine proxies; switching panes never owns config persistence.
export function createSettingsPanelMethods(Alpine) {
  const requests = new Map();
  let paneGeneration = 0;
  return {
    navItems: SETTINGS_PANES, paneHistory: [], paneScroll: {}, resources: {}, focusedSettingPath: '', layoutOpening: false,
    paneLabel(pane = this.activePane) { return SETTINGS_PANES.find((item) => item.id === pane)?.label || '设置'; },
    paneDirtyCount(pane) { return this.dirtyPaths.filter((path) => SETTINGS_FIELDS.some((field) => field.path === path && field.pane === pane)).length; },
    searchResults() {
      const words = normalize(this.query).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      return SETTINGS_FIELDS.filter((field) => {
        const pane = SETTINGS_PANES.find((item) => item.id === field.pane);
        const text = normalize(`${field.label} ${field.path} ${pane?.label} ${pane?.keywords?.join(' ')}`);
        return words.every((word) => text.includes(word));
      }).map((field) => ({ ...field, paneLabel: this.paneLabel(field.pane) }));
    },
    filteredNavItems() {
      if (!normalize(this.query)) return this.navItems;
      const matching = new Set(this.searchResults().map((field) => field.pane));
      return this.navItems.filter((item) => matching.has(item.id));
    },
    navItemVisible(item) { return this.filteredNavItems().some((visible) => visible.id === item.id); },
    canGoBack() { return this.paneHistory.length > 0; },
    backPane() {
      if (!this.canGoBack()) return;
      const previous = this.paneHistory.at(-1);
      this.paneHistory = this.paneHistory.slice(0, -1);
      this.switchPane(previous, false);
    },
    switchPane(pane, recordHistory = true) {
      if (!SETTINGS_PANES.some((item) => item.id === pane)) return;
      const content = document.querySelector('[data-theme-settings-content]');
      const changed = pane !== this.activePane;
      if (changed) {
        this.paneScroll[this.activePane] = content?.scrollTop || 0;
        if (recordHistory) this.paneHistory = [...this.paneHistory, this.activePane].slice(-30);
        this.activePane = pane;
      }
      const restoreFocus = this.mobileSidebarOpen && this.isMobileViewport;
      this.mobileSidebarOpen = false;
      const generation = ++paneGeneration;
      const afterRender = Alpine.nextTick || ((callback) => window.requestAnimationFrame(callback));
      afterRender(() => window.requestAnimationFrame(() => {
        if (generation !== paneGeneration || this.activePane !== pane) return;
        if (changed) content?.scrollTo?.({ top: this.paneScroll[pane] || 0, left: 0, behavior: 'auto' });
        this.syncRadioGroupTabStops();
        if (restoreFocus) document.querySelector('[data-theme-settings-sidebar-toggle]')?.focus?.({ preventScroll: true });
      }));
      if (pane === 'navigation' && !this.resourceState('menus').loaded) void this.loadResources('menus');
      if (pane === 'desktop-dock') {
        Object.keys(CONTENT_FIELDS).forEach((kind) => {
          if (!this.resourceState(kind).loaded) void this.loadResources(kind);
        });
      }
    },
    focusSetting(path) {
      const field = SETTINGS_FIELDS.find((item) => item.path === path);
      if (!field) return;
      this.query = '';
      this.focusedSettingPath = path;
      this.switchPane(field.pane);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const row = document.querySelector(`[data-theme-settings-window] [data-setting-path="${path}"]`);
        let parent = row;
        while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
        document.querySelectorAll('.theme-settings-pane .is-search-match').forEach((item) => item.classList.remove('is-search-match'));
        row?.classList.add('is-search-match');
        row?.scrollIntoView({ block: 'center', behavior: 'auto' });
        const input = row?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
        input?.focus({ preventScroll: true });
      }));
    },
    appAvailable(id) { return document.querySelector('[data-theme-settings-protocol]')?.dataset?.[`app${id[0].toUpperCase()}${id.slice(1)}`] === 'true'; },
    resourceState(kind) { return this.resources[kind] || { items: [], busy: false, error: '', loaded: false, hasNext: false, page: 0, query: '' }; },
    searchResources(kind, query) {
      this.resources = { ...this.resources, [kind]: { ...this.resourceState(kind), query: String(query || '') } };
    },
    resourceOptions(kind) {
      const state = this.resourceState(kind);
      const items = [...state.items];
      const selected = kind === 'menus'
        ? [this.value('navigation.header.menu_name'), this.value('navigation.dock.menu_name')]
        : this.value(`desktop.icons.${CONTENT_FIELDS[kind]}`, []);
      for (const name of selected.map(selectionName)) {
        if (name && !items.some((item) => item.name === name)) items.push({ name, label: `${name}（未加载或已不可用）`, disabled: true });
      }
      const query = normalize(state.query);
      return items.filter((item) => !query || normalize(`${item.name} ${item.label}`).includes(query));
    },
    async loadResources(kind, more = false) {
      if (this.resourceState(kind).busy) return;
      requests.get(kind)?.abort();
      const controller = new AbortController();
      requests.set(kind, controller);
      const previous = this.resourceState(kind);
      this.resources = { ...this.resources, [kind]: { ...previous, busy: true, error: '' } };
      try {
        const { listSettingResources } = await import('./resource-client.js');
        if (requests.get(kind) !== controller || controller.signal.aborted) return;
        const result = await listSettingResources(kind, { page: more ? previous.page + 1 : 1, signal: controller.signal });
        if (requests.get(kind) !== controller || controller.signal.aborted) return;
        const merged = new Map((more ? previous.items : []).map((item) => [item.name, item]));
        result.items.forEach((item) => merged.set(item.name, item));
        this.resources = { ...this.resources, [kind]: { ...this.resourceState(kind), ...result, items: [...merged.values()], loaded: true, error: '', busy: false } };
      } catch (error) {
        if (requests.get(kind) === controller && !controller.signal.aborted) this.resources = { ...this.resources, [kind]: { ...this.resourceState(kind), busy: false, error: error.message || '资源加载失败，请重试。' } };
      }
    },
    cancelResourceRequests() {
      requests.forEach((request) => request.abort());
      requests.clear();
      this.resources = {};
    },
    resourceSelected(path, name) { return (this.value(path, []) || []).some((item) => selectionName(item) === name); },
    toggleResource(path, name) {
      const field = SETTINGS_FIELDS.find((item) => item.path === path && item.type === 'content-list');
      if (!field) return;
      const current = this.value(path, []);
      const resource = this.resourceState(field.source).items.find((item) => item.name === name);
      const selected = current.some((item) => selectionName(item) === name);
      if (!selected && (!resource || resource.disabled)) return;
      this.update(path, selected ? current.filter((value) => selectionName(value) !== name) : [...current, name]);
    },
    customIconNameLocked(index) {
      const name = this.value('desktop.icons.custom_icons', [])[index]?.name;
      return (this.baseline.desktop.icons.custom_icons || []).some((item) => item.name === name);
    },
    addCustomIcon() {
      const items = this.value('desktop.icons.custom_icons', []);
      let number = 1;
      while (items.some((item) => item.name === `新图标 ${number}`)) number++;
      this.update('desktop.icons.custom_icons', [...items, { name: `新图标 ${number}`, href: '/', type: 'folder', external: false }]);
    },
    updateCustomIcon(index, field, value) {
      const items = this.value('desktop.icons.custom_icons', []);
      if (!items[index] || !['name', 'href', 'type', 'external'].includes(field)) return;
      if (field === 'name' && this.customIconNameLocked(index)) return;
      if (field === 'name' && (!String(value).trim() || items.some((item, i) => i !== index && item.name === value))) {
        this.validationErrors = { ...this.validationErrors, 'desktop.icons.custom_icons': '图标名称不能为空或重复，请使用独立名称。' };
        return;
      }
      this.update('desktop.icons.custom_icons', items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    },
    removeCustomIcon(index) { this.update('desktop.icons.custom_icons', this.value('desktop.icons.custom_icons', []).filter((_item, i) => i !== index)); },
    async openLayoutEditor() {
      if (this.layoutOpening) return false;
      if (this.desktopLayoutReloadRequired) {
        this.statusTone = 'warning';
        this.statusMessage = '桌面图标已保存，请先刷新页面，再编辑新布局。';
        return false;
      }
      if (this.hasDirtyChanges() || this.saving) {
        this.statusTone = 'warning';
        this.statusMessage = '请先应用或放弃当前设置修改，再打开桌面布局编辑器。';
        return false;
      }
      const surface = document.querySelector('.desktop-surface');
      const desktop = surface ? Alpine.$data(surface) : null;
      if (!desktop?.openWidgetEditorFromDesktopMenu) {
        this.statusTone = 'error'; this.statusMessage = '桌面布局编辑器尚未就绪，请稍后重试。'; return false;
      }
      if (desktop.hasUnsavedDesktopChanges?.()) {
        this.statusTone = 'warning'; this.statusMessage = '桌面已有未保存布局，请先在桌面编辑器中处理。'; return false;
      }
      this.layoutOpening = true;
      try {
        await desktop.openWidgetEditorFromDesktopMenu();
        if (this.hasDirtyChanges() || this.saving) {
          if (desktop.isEditing) await desktop.exitEditMode?.({ force: true });
          this.statusTone = 'warning'; this.statusMessage = '设置已发生变化，草稿已保留。请先处理修改，再打开布局编辑器。';
          return false;
        }
        if (desktop.isEditing) { this.close(true); return true; }
        this.statusTone = 'warning'; this.statusMessage = '当前账号或站点设置未允许编辑默认布局。';
      } catch (_error) {
        this.statusTone = 'error'; this.statusMessage = '桌面编辑器加载失败，请重试。';
      } finally {
        this.layoutOpening = false;
      }
      return false;
    }
  };
}
