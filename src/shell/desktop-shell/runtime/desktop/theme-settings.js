import { captureRuntimeSnapshot, restoreBodyRuntime, restoreDockRuntime, restoreHeaderIcons, restoreStoredTheme, restoreDesktopViewport, applyBodyPreview, applyDockPreview, applyMenubarPreview, applyWidgetPreview, applyHeaderIconPreview } from './settings-model/preview.js';
import {
  buildThemeSettingsDraft,
  cloneThemeSettingsValue,
  isValidThemeCssColor,
  THEME_SETTINGS_ICON_FIELDS,
  THEME_SETTINGS_IMAGE_FIELDS,
  rebaseThemeSettingsDraftAfterSave,
  themeSettingsValueAt,
  updateThemeSettingsDraft
} from './theme-settings-core.js';
import { loadThemeConfigClient } from '../shared/lazy-theme-config-client.js';
import { registerNavigationGuard, isCoveredNativeBeforeUnload } from './pjax/navigation-admission.js';
import { registerThemeSettingsAssetPicker } from './settings-assets/picker.js';
import { sanitizeIconSvg } from './settings-assets/icon-svg.js';
import { createSettingsPanelMethods } from './settings-model/panels.js';
import { loadSettingsSave } from './settings-model/lazy-save.js';

const SETTINGS_CLOSE_DELAY = 240;
const CLOSE_CONFIRM_TIMEOUT = 3200;

function getProtocolElement() {
  return document.querySelector('[data-theme-settings-protocol]');
}

function isSameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

export function registerThemeSettings(Alpine) {
  Alpine.store('themeSettings', {
    authenticated: false,
    endpoint: '',
    themeName: '',
    accessStatus: 'idle',
    canOpen: false,
    visible: false,
    open: false,
    loading: false,
    saving: false,
    activePane: 'appearance',
    mobileSidebarOpen: false,
    isMobileViewport: false,
    mobileViewportQuery: null,
    query: '',
    serverConfig: null,
    baseline: buildThemeSettingsDraft({}),
    draft: buildThemeSettingsDraft({}),
    dirtyPaths: [],
    validationErrors: {},
    draftMutationVersion: 0,
    statusMessage: '',
    statusTone: 'muted',
    entryStatusMessage: '',
    entryStatusTimer: null,
    statusResetTimer: null,
    closeArmed: false,
    closeArmTimer: null,
    closeArmGeneration: 0,
    runtimeSnapshot: null,
    desktopViewportRestoreCancel: null,
    reloadRequired: false,
    desktopLayoutReloadRequired: false,
    wallpaperPreviewGeneration: 0,
    readyWallpaperUrl: '',
    restoreFocusElement: null,
    searchAvailable: false,
    mobileMenuAvailable: false,
    ...createSettingsPanelMethods(Alpine),
    iconFields: THEME_SETTINGS_ICON_FIELDS,

    init() {
      const protocol = getProtocolElement();
      const menubar = document.querySelector('.menubar');
      this.authenticated = protocol?.dataset?.authenticated === 'true';
      this.endpoint = String(protocol?.dataset?.configEndpoint || '').trim();
      this.themeName = String(protocol?.dataset?.themeName || '').trim();
      this.searchAvailable = menubar?.dataset?.searchAvailable === 'true';
      this.mobileMenuAvailable = menubar?.dataset?.hasMenu === 'true';
      this.mobileViewportQuery = window.matchMedia('(max-width: 680px)');
      this.handleMobileViewportChange = (event) => {
        this.isMobileViewport = event.matches;
        if (!event.matches) {
          this.mobileSidebarOpen = false;
        }
      };
      this.handleMobileViewportChange(this.mobileViewportQuery);
      this.mobileViewportQuery.addEventListener?.('change', this.handleMobileViewportChange);
      this.accessStatus = this.authenticated && this.endpoint ? 'idle' : 'denied';
      this.canOpen = false;

      this.handleOpenRequest = () => {
        void this.requestOpen();
      };
      this.handleBeforeUnload = (event) => {
        if (isCoveredNativeBeforeUnload(event, 'theme-settings')) return;
        if (!this.hasDirtyChanges() && !this.saving && !Alpine.store('themeAssets')?.uploading) return;
        event.preventDefault();
        event.returnValue = '';
      };
      this.handleEscape = (event) => {
        if (event.key === 'Escape' && this.visible) {
          event.preventDefault();
          if (Alpine.store('themeAssets')?.visible) {
            event.stopImmediatePropagation();
            Alpine.store('themeAssets').close();
            return;
          }
          if (this.mobileSidebarOpen) {
            this.closeMobileSidebar();
            return;
          }
          this.close();
        }
      };
      this.handleSettingsRadioKeydown = (event) => {
        const option = event.target.closest?.('[role="radio"]');
        const group = option?.closest?.('[role="radiogroup"]');
        if (!group || !this.visible || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const options = Array.from(group.querySelectorAll('[role="radio"]')).filter((item) => !item.disabled && !item.hidden);
        if (!options.length) return;
        const currentIndex = Math.max(0, options.indexOf(option));
        let nextIndex = currentIndex;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = options.length - 1;
        else nextIndex = (currentIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
        event.preventDefault();
        options[nextIndex].focus({ preventScroll: true });
        options[nextIndex].click();
      };
      window.addEventListener('theme-settings-open', this.handleOpenRequest);
      window.addEventListener('keydown', this.handleEscape, true);
      window.addEventListener('keydown', this.handleSettingsRadioKeydown, true);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      this.installNavigationGuard();
    },

    destroy() {
      this.cancelDesktopViewportRestore();
      Alpine.store('themeAssets')?.destroy();
      this.cancelResourceRequests();
      window.removeEventListener('theme-settings-open', this.handleOpenRequest);
      window.removeEventListener('keydown', this.handleEscape, true);
      window.removeEventListener('keydown', this.handleSettingsRadioKeydown, true);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      this.unregisterNavigationGuard?.();
      this.unregisterNavigationGuard = null;
      this.mobileViewportQuery?.removeEventListener?.('change', this.handleMobileViewportChange);
      this.resetCloseArm();
      if (this.entryStatusTimer) window.clearTimeout(this.entryStatusTimer);
      if (this.statusResetTimer) window.clearTimeout(this.statusResetTimer);
    },

    setEntryFeedback(message) {
      this.entryStatusMessage = message;
      if (this.entryStatusTimer) window.clearTimeout(this.entryStatusTimer);
      this.entryStatusTimer = window.setTimeout(() => {
        this.entryStatusMessage = '';
        this.entryStatusTimer = null;
      }, 4200);
    },

    resetCloseArm() {
      this.closeArmGeneration += 1;
      if (this.closeArmTimer) window.clearTimeout(this.closeArmTimer);
      this.closeArmTimer = null;
      this.closeArmed = false;
    },

    async fetchConfig() {
      const { readThemeConfig } = await loadThemeConfigClient();
      const { config } = await readThemeConfig(this.endpoint);
      return config;
    },

    async probeAccess() {
      if (!this.authenticated || !this.endpoint) {
        this.accessStatus = 'denied';
        this.canOpen = false;
        return false;
      }
      if (this.loading) return false;

      this.loading = true;
      this.accessStatus = 'checking';
      try {
        const config = await this.fetchConfig();
        this.serverConfig = config;
        this.baseline = buildThemeSettingsDraft(config);
        this.draft = cloneThemeSettingsValue(this.baseline);
        this.dirtyPaths = [];
        this.validationErrors = {};
        this.draftMutationVersion = 0;
        this.accessStatus = 'allowed';
        this.canOpen = true;
        return true;
      } catch (error) {
        const denied = error?.response?.redirected
          || [401, 403, 404].includes(error?.response?.status);
        this.accessStatus = denied ? 'denied' : 'idle';
        this.canOpen = false;
        this.statusTone = 'error';
        this.statusMessage = error.message || '无法访问主题设置';
        this.setEntryFeedback(String(error?.code ?? '').startsWith('module-load-')
          ? error.message
          : (denied ? '当前账号没有主题设置权限。' : '主题设置暂时无法连接，请稍后重试。'));
        return false;
      } finally {
        this.loading = false;
      }
    },

    async requestOpen() {
      if (!this.authenticated) {
        this.setEntryFeedback('登录后才能使用主题设置。');
        return false;
      }
      if (this.accessStatus === 'denied') {
        this.setEntryFeedback('当前账号没有主题设置权限。');
        return false;
      }
      if (this.visible) return true;
      const allowed = await this.probeAccess();
      if (!allowed) return false;
      await this.openWindow();
      return true;
    },

    async openWindow() {
      if (this.visible || !this.canOpen) return;
      this.cancelDesktopViewportRestore();
      this.restoreFocusElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      this.runtimeSnapshot = captureRuntimeSnapshot();
      this.draft = cloneThemeSettingsValue(this.baseline);
      this.dirtyPaths = [];
      this.validationErrors = {};
      this.draftMutationVersion = 0;
      this.resetCloseArm();
      this.mobileSidebarOpen = false;
      this.statusTone = this.reloadRequired ? 'warning' : 'muted';
      this.statusMessage = this.reloadRequired
        ? '上次保存的服务端渲染内容尚未刷新；可直接刷新页面使其完整生效。'
        : '';
      this.visible = true;
      document.body.classList.add('theme-settings-open');
      await nextFrame();
      this.syncRadioGroupTabStops();
      this.switchPane(this.activePane, false);
      const content = document.querySelector('[data-theme-settings-content]');
      if (content) content.scrollTop = this.paneScroll[this.activePane] || 0;
      this.open = true;
      window.setTimeout(() => {
        document.querySelector('[data-theme-settings-window]')?.focus?.({ preventScroll: true });
      }, 40);
    },

    close(force = false) {
      if (!this.visible) return;
      if (Alpine.store('themeAssets')?.visible) { Alpine.store('themeAssets').close(); return; }
      if (this.saving) {
        this.statusTone = 'warning';
        this.statusMessage = '主题设置正在保存，请等待完成后再关闭。';
        return;
      }
      if (this.hasDirtyChanges() && !force && !this.closeArmed) {
        this.resetCloseArm();
        this.closeArmed = true;
        this.statusTone = 'warning';
        this.statusMessage = '存在未应用的修改；再次点击关闭将放弃这些修改。';
        const generation = this.closeArmGeneration;
        this.closeArmTimer = window.setTimeout(() => {
          if (generation !== this.closeArmGeneration || !this.visible || !this.closeArmed) return;
          this.closeArmTimer = null;
          this.closeArmed = false;
          this.statusTone = 'muted';
          this.statusMessage = '修改尚未应用。';
        }, CLOSE_CONFIRM_TIMEOUT);
        return;
      }
      this.resetCloseArm();
      this.paneScroll[this.activePane] = document.querySelector('[data-theme-settings-content]')?.scrollTop || 0;
      this.cancelResourceRequests();
      this.restoreRuntimePreview();
      this.open = false;
      document.body.classList.remove('theme-settings-open');
      window.setTimeout(() => {
        this.visible = false;
        this.query = '';
        this.mobileSidebarOpen = false;
        this.draft = cloneThemeSettingsValue(this.baseline);
        this.dirtyPaths = [];
        this.validationErrors = {};
        this.draftMutationVersion = 0;
        const focusTarget = this.restoreFocusElement;
        this.restoreFocusElement = null;
        if (focusTarget?.isConnected) {
          focusTarget.focus?.({ preventScroll: true });
        }
      }, SETTINGS_CLOSE_DELAY);
    },

    mobileSidebarFocusableElements() {
      const sidebar = document.getElementById('theme-settings-sidebar');
      if (!sidebar || !this.mobileSidebarOpen) return [];
      return Array.from(sidebar.querySelectorAll([
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[href]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(','))).filter((element) => {
        const style = window.getComputedStyle(element);
        return element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && element.getClientRects().length > 0;
      });
    },

    handleMobileSidebarFocusTrap(event) {
      if (event.key !== 'Tab' || !this.mobileSidebarOpen || !this.isMobileViewport) return;
      const focusable = this.mobileSidebarFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        document.getElementById('theme-settings-sidebar')?.focus?.({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      const sidebar = document.getElementById('theme-settings-sidebar');
      if (event.shiftKey && (active === first || !sidebar?.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !sidebar?.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },

    hasDirtyChanges() {
      return this.dirtyPaths.length > 0 || this.hasValidationErrors();
    },

    captureNavigationGuardState() {
      return {
        draftMutationVersion: this.draftMutationVersion,
        dirty: this.hasDirtyChanges(),
        saving: this.saving === true || Alpine.store('themeAssets')?.uploading === true,
        visible: this.visible === true
      };
    },

    installNavigationGuard() {
      this.unregisterNavigationGuard?.();
      this.unregisterNavigationGuard = registerNavigationGuard({
        id: 'theme-settings',
        capture: () => this.captureNavigationGuardState(),
        allow: (snapshot) => {
          if (snapshot.saving) return false;
          if (!snapshot.visible || !snapshot.dirty) return true;
          return window.confirm('系统设置有未应用的修改。确定放弃并继续离开吗？');
        },
        isUnchanged: (snapshot) => {
          const current = this.captureNavigationGuardState();
          return Object.keys(snapshot).every((key) => current[key] === snapshot[key]);
        },
        commit: (snapshot) => {
          if (snapshot.visible) this.closeForNavigationCommit();
        }
      });
    },

    closeForNavigationCommit() {
      if (!this.visible || this.saving) return;
      Alpine.store('themeAssets')?.close();
      this.resetCloseArm();
      this.paneScroll[this.activePane] = document.querySelector('[data-theme-settings-content]')?.scrollTop || 0;
      this.cancelResourceRequests();
      this.restoreRuntimePreview();
      this.open = false;
      this.visible = false;
      document.body.classList.remove('theme-settings-open');
      this.query = '';
      this.activePane = 'appearance';
      this.mobileSidebarOpen = false;
      this.draft = cloneThemeSettingsValue(this.baseline);
      this.dirtyPaths = [];
      this.validationErrors = {};
      this.draftMutationVersion = 0;
      this.restoreFocusElement = null;
    },

    hasValidationErrors() {
      return Object.keys(this.validationErrors).length > 0;
    },

    validationError(path) {
      return this.validationErrors[path] || '';
    },

    value(path, fallback = undefined) {
      return themeSettingsValueAt(this.draft, path, fallback);
    },

    iconPreview(path) {
      if (!THEME_SETTINGS_ICON_FIELDS.some((field) => field.path === path)) return '';
      const configured = sanitizeIconSvg(this.value(path)?.value || '');
      if (configured) return configured;
      if (path === 'douban.profile.icon') return '<span class="icon-[lucide--clapperboard]" aria-hidden="true"></span>';
      // Reuse the same theme-owned default markup as the rendered menu bar.
      return document.getElementById('theme-header-icon-defaults')?.content?.querySelector(`[data-icon-path="${path}"]`)?.innerHTML || '';
    },

    setImage(path, value) {
      if (!THEME_SETTINGS_IMAGE_FIELDS.some((field) => field.path === path)) return;
      this.update(path, value);
      if (path === 'desktop.background.image_url' && (value || this.value('desktop.background.mode') === 'image')) {
        this.update('desktop.background.mode', value ? 'image' : 'preset');
      }
    },

    clearImage(path) { this.setImage(path, ''); },

    selectWallpaperPreset(preset) { this.setBackgroundPreset(preset); },

    update(path, value, preview = true) {
      if (this.validationErrors[path]) {
        const validationErrors = { ...this.validationErrors };
        delete validationErrors[path];
        this.validationErrors = validationErrors;
      }
      if (this.statusResetTimer) {
        window.clearTimeout(this.statusResetTimer);
        this.statusResetTimer = null;
      }
      let nextDraft;
      try { nextDraft = updateThemeSettingsDraft(this.draft, path, value); } catch (error) {
        this.validationErrors = { ...this.validationErrors, [path]: error.message };
        this.statusTone = 'error';
        this.statusMessage = error.message;
        return false;
      }
      const nextValue = themeSettingsValueAt(nextDraft, path);
      const baselineValue = themeSettingsValueAt(this.baseline, path);
      const dirty = new Set(this.dirtyPaths);
      if (isSameValue(nextValue, baselineValue)) {
        dirty.delete(path);
      } else {
        dirty.add(path);
      }
      this.draft = nextDraft;
      this.dirtyPaths = Array.from(dirty);
      this.draftMutationVersion += 1;
      this.resetCloseArm();
      this.statusTone = 'muted';
      this.statusMessage = this.hasDirtyChanges()
        ? '设置已修改，尚未应用。'
        : '已恢复到当前主题配置。';
      if (preview) this.applyRuntimePreview(path);
      window.requestAnimationFrame(() => this.syncRadioGroupTabStops());
    },

    updateCssColor(path, value) {
      if (!isValidThemeCssColor(value)) {
        this.validationErrors = {
          ...this.validationErrors,
          [path]: '请输入十六进制颜色或 rgb()/rgba() 颜色值。'
        };
        this.statusTone = 'error';
        this.statusMessage = '颜色格式不正确，请修正后再应用。';
        return false;
      }
      this.update(path, value);
      return true;
    },

    previewWeatherCity(value) {
      const previewDraft = updateThemeSettingsDraft(
        this.draft,
        'widgets.modules.weather.city_name',
        value
      );
      applyWidgetPreview(previewDraft, 'widgets.modules.weather.city_name');
    },

    syncRadioGroupTabStops() {
      document.querySelectorAll('[data-theme-settings-window] [role="radiogroup"]').forEach((group) => {
        const options = Array.from(group.querySelectorAll('[role="radio"]')).filter((option) => !option.disabled && !option.hidden);
        const selected = options.find((option) => option.getAttribute('aria-checked') === 'true') || options[0];
        options.forEach((option) => { option.tabIndex = option === selected ? 0 : -1; });
      });
    },

    setThemeMode(mode) {
      this.update('header.theme.default_mode', mode);
    },

    setAppearancePreset(preset) {
      this.update('desktop.appearance.mode', 'preset');
      this.update('desktop.appearance.preset', preset);
    },

    useCustomAppearance() {
      this.update('desktop.appearance.mode', 'custom');
    },

    setBackgroundMode(mode) {
      if (mode === 'image' && !this.value('desktop.background.image_url')) return false;
      this.update('desktop.background.mode', mode);
    },

    setBackgroundPreset(preset) {
      this.update('desktop.background.mode', 'preset');
      this.update('desktop.background.preset', preset);
    },

    restoreDraft() {
      this.draft = cloneThemeSettingsValue(this.baseline);
      this.dirtyPaths = [];
      this.draftMutationVersion += 1;
      this.resetCloseArm();
      this.validationErrors = {};
      this.statusTone = 'success';
      this.statusMessage = '已撤销本次未应用的修改。';
      this.applyRuntimePreview();
      this.restoreDesktopViewportContext();
      if (this.statusResetTimer) window.clearTimeout(this.statusResetTimer);
      this.statusResetTimer = window.setTimeout(() => {
        if (!this.hasDirtyChanges() && !this.reloadRequired) {
          this.statusTone = 'muted';
          this.statusMessage = '';
        }
        this.statusResetTimer = null;
      }, 1800);
    },

    applyRuntimePreview(changedPath = '') {
      this.cancelDesktopViewportRestore();
      if (!changedPath || changedPath.startsWith('desktop.')) {
        const wallpaperUrl = this.draft.desktop.background.mode === 'image'
          ? String(this.draft.desktop.background.image_url || '')
          : '';
        if (wallpaperUrl && wallpaperUrl !== this.readyWallpaperUrl) {
          const generation = ++this.wallpaperPreviewGeneration;
          applyBodyPreview(this.draft, { remoteImageReady: false });
          const image = new Image();
          image.onload = () => {
            if (!this.visible || generation !== this.wallpaperPreviewGeneration
              || this.draft.desktop.background.mode !== 'image'
              || String(this.draft.desktop.background.image_url || '') !== wallpaperUrl) return;
            this.readyWallpaperUrl = wallpaperUrl;
            applyBodyPreview(this.draft);
          };
          image.onerror = () => {
            if (!this.visible || generation !== this.wallpaperPreviewGeneration
              || this.draft.desktop.background.mode !== 'image'
              || String(this.draft.desktop.background.image_url || '') !== wallpaperUrl) return;
            this.statusTone = 'error';
            this.statusMessage = '后台桌面图片无法加载，当前预览已保留纯色背景。';
          };
          image.src = wallpaperUrl;
        } else {
          this.wallpaperPreviewGeneration += 1;
          applyBodyPreview(this.draft);
        }
      }
      if (!changedPath || changedPath.startsWith('dock.')) applyDockPreview(this.draft);
      if (!changedPath || changedPath.startsWith('header.') || changedPath.startsWith('sidebar.notification_center.')) {
        applyMenubarPreview(this.draft);
      }
      if (!changedPath || THEME_SETTINGS_ICON_FIELDS.some((field) => field.path === changedPath)) applyHeaderIconPreview(this.draft);
      if (!changedPath || changedPath.startsWith('widgets.')) applyWidgetPreview(this.draft, changedPath);
      if (!changedPath || changedPath === 'header.theme.default_mode') {
        Alpine.store('theme')?.setMode?.(this.draft.header.theme.default_mode);
      }
    },

    restoreRuntimePreview() {
      this.wallpaperPreviewGeneration += 1;
      if (!this.runtimeSnapshot) return;
      restoreBodyRuntime(this.runtimeSnapshot.body);
      restoreDockRuntime(this.runtimeSnapshot.dock);
      restoreHeaderIcons(this.runtimeSnapshot.icons);
      restoreStoredTheme(this.runtimeSnapshot, Alpine);
      applyMenubarPreview(this.baseline);
      applyWidgetPreview(this.baseline);
      this.restoreDesktopViewportContext();
      this.runtimeSnapshot = null;
    },

    cancelDesktopViewportRestore() {
      this.desktopViewportRestoreCancel?.();
      this.desktopViewportRestoreCancel = null;
    },

    restoreDesktopViewportContext() {
      this.cancelDesktopViewportRestore();
      this.desktopViewportRestoreCancel = restoreDesktopViewport(this.runtimeSnapshot?.desktopViewport);
    },

    async save() {
      if (this.saving || !this.hasDirtyChanges() || !this.canOpen || this.hasValidationErrors() || Alpine.store('themeAssets')?.visible) return false;
      const surface = document.querySelector('.desktop-surface');
      if (this.dirtyPaths.some((path) => path.startsWith('desktop.icons.')) && surface && Alpine.$data?.(surface)?.hasUnsavedDesktopChanges?.()) {
        this.statusTone = 'warning';
        this.statusMessage = '桌面布局有未保存修改，请先处理布局后再应用桌面图标设置。';
        return false;
      }
      this.resetCloseArm();
      const savePaths = [...this.dirtyPaths];
      const saveDraft = cloneThemeSettingsValue(this.draft);
      const saveMutationVersion = this.draftMutationVersion;
      this.saving = true;
      this.statusTone = 'muted';
      this.statusMessage = '正在读取最新配置并合并修改…';

      try {
        const { mutateThemeConfig } = await loadThemeConfigClient();
        const { mergeSettingsChanges } = await loadSettingsSave();
        const result = await mutateThemeConfig(
          this.endpoint,
          (latestConfig) => mergeSettingsChanges(latestConfig, saveDraft, savePaths, {
            baseline: this.baseline,
            resources: Object.fromEntries(Object.entries(this.resources).map(([kind, state]) => [kind, state.items]))
          })
        );
        const savedConfig = result.config;
        const savedBaseline = buildThemeSettingsDraft(savedConfig);
        const draftAtCompletion = cloneThemeSettingsValue(this.draft);
        const changedDuringSave = this.draftMutationVersion !== saveMutationVersion;
        const rebased = changedDuringSave
          ? rebaseThemeSettingsDraftAfterSave(
            savedBaseline,
            draftAtCompletion,
            [...savePaths, ...this.dirtyPaths]
          )
          : { draft: cloneThemeSettingsValue(savedBaseline), dirtyPaths: [] };
        const nextDraft = rebased.draft;
        const pendingPaths = rebased.dirtyPaths;

        this.serverConfig = savedConfig;
        this.baseline = savedBaseline;
        this.draft = nextDraft;
        this.dirtyPaths = pendingPaths;
        this.reloadRequired = true;
        this.desktopLayoutReloadRequired ||= savePaths.some((path) => path.startsWith('desktop.icons.'));
        this.statusTone = pendingPaths.length > 0 ? 'warning' : 'success';
        this.statusMessage = pendingPaths.length > 0
          ? `本次修改已保存；保存期间又产生 ${pendingPaths.length} 项新修改，请再次应用。`
          : '主题设置已保存；刷新页面后所有服务端渲染内容会同步生效。';

        const pendingDraft = this.draft;
        this.draft = cloneThemeSettingsValue(savedBaseline);
        this.applyRuntimePreview();
        restoreStoredTheme(this.runtimeSnapshot, Alpine);
        applyBodyPreview(savedBaseline);
        this.runtimeSnapshot = captureRuntimeSnapshot();
        this.draft = pendingDraft;
        if (pendingPaths.length > 0) {
          pendingPaths.forEach((path) => this.applyRuntimePreview(path));
        }
        window.dispatchEvent(new CustomEvent('theme-settings-saved', {
          detail: {
            paths: savePaths,
            pendingPaths,
            themeName: this.themeName
          }
        }));
        return true;
      } catch (error) {
        if (error?.response?.redirected || [401, 403].includes(error?.response?.status)) {
          this.accessStatus = 'denied';
          this.canOpen = false;
        }
        this.statusTone = 'error';
        this.statusMessage = error.message || '保存失败，请检查账号权限和网络状态。';
        return false;
      } finally {
        this.saving = false;
      }
    },

    reloadPage() {
      if (this.hasDirtyChanges() || this.saving) return;
      window.location.reload();
    },

    toggleMobileSidebar() {
      if (this.mobileSidebarOpen) {
        this.closeMobileSidebar();
        return;
      }
      if (!this.isMobileViewport) return;
      this.mobileSidebarOpen = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const sidebar = document.getElementById('theme-settings-sidebar');
          const activeItem = sidebar?.querySelector('button.is-active');
          (activeItem || this.mobileSidebarFocusableElements()[0])?.focus?.({ preventScroll: true });
        });
      });
    },

    closeMobileSidebar(restoreFocus = true) {
      const wasOpen = this.mobileSidebarOpen;
      this.mobileSidebarOpen = false;
      if (wasOpen && restoreFocus && this.isMobileViewport) {
        window.requestAnimationFrame(() => {
          document.querySelector('[data-theme-settings-sidebar-toggle]')?.focus?.({ preventScroll: true });
        });
      }
    },


  });
  registerThemeSettingsAssetPicker(Alpine);
}
