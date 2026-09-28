import {
  applyThemeSettingsDraftToConfig,
  buildThemeSettingsDraft,
  cloneThemeSettingsValue,
  isValidThemeCssColor,
  rebaseThemeSettingsDraftAfterSave,
  themeSettingsValueAt,
  updateThemeSettingsDraft
} from './theme-settings-core.js';
import { loadThemeConfigClient } from '../shared/lazy-theme-config-client.js';
import { registerNavigationGuard, isCoveredNativeBeforeUnload } from './pjax/navigation-admission.js';

const SCHEME_CLASS_PREFIX = 'scheme-';
const WALLPAPER_CLASS_PREFIX = 'wallpaper-';
const SETTINGS_CLOSE_DELAY = 240;
const CLOSE_CONFIRM_TIMEOUT = 3200;
const DOCK_RUNTIME_SYNC_EVENT = 'theme:dock-settings-change';
const MENUBAR_RUNTIME_SYNC_EVENT = 'theme:menubar-settings-change';
const WIDGET_RUNTIME_SYNC_EVENT = 'theme:widget-settings-change';
const APPEARANCE_PRESET_ACCENTS = Object.freeze({
  blue: '#2e5fbd',
  purple: '#6555b5',
  pink: '#bd557c',
  red: '#b0525b',
  orange: '#ad7339',
  yellow: '#948041',
  green: '#427e59',
  graphite: '#656c75'
});

const BODY_CUSTOM_PROPERTIES = [
  '--mac-accent',
  '--theme-accent-contrast',
  '--mac-selection',
  '--mac-folder1',
  '--mac-folder2',
  '--mac-folder3'
];

const MENUBAR_CUSTOM_PROPERTIES = [
  '--mac-header-dropdown-light-bg',
  '--mac-header-dropdown-dark-bg'
];

const BODY_RUNTIME_CUSTOM_PROPERTIES = [
  ...BODY_CUSTOM_PROPERTIES,
  ...MENUBAR_CUSTOM_PROPERTIES
];

const DOCK_DATASET_FIELDS = [
  'showLabels',
  'magnification',
  'dockIconSize',
  'dockIconGap',
  'dockPadding',
  'dockMagScale',
  'dockGlassBlur',
  'dockGlassOpacity'
];

const DOCK_CUSTOM_PROPERTIES = [
  '--dock-icon-size',
  '--dock-gap',
  '--dock-padding',
  '--dock-glass-height',
  '--dock-bar-height',
  '--dock-blur',
  '--dock-opacity',
  '--dock-icon-radius'
];

const SETTINGS_NAV_ITEMS = Object.freeze([
  {
    id: 'appearance',
    label: '外观',
    detail: '显示模式、强调色与桌面背景'
  },
  {
    id: 'desktop-dock',
    label: '桌面与 Dock',
    detail: 'Dock 尺寸、间距与玻璃质感'
  },
  {
    id: 'widgets',
    label: '小组件',
    detail: '显示、编辑与天气参数'
  },
  {
    id: 'menu-control',
    label: '菜单栏与控制中心',
    detail: '名称、功能入口与时间格式'
  },
  {
    id: 'notifications',
    label: '通知',
    detail: '通知中心名称与默认状态'
  }
]);

function getProtocolElement() {
  return document.querySelector('[data-theme-settings-protocol]');
}

function classNamesWithPrefix(element, prefix) {
  if (!element) return [];
  return Array.from(element.classList).filter((className) => className.startsWith(prefix));
}

function captureBodyRuntime() {
  const body = document.body;
  if (!body) return null;

  return {
    schemeClasses: classNamesWithPrefix(body, SCHEME_CLASS_PREFIX),
    wallpaperClasses: classNamesWithPrefix(body, WALLPAPER_CLASS_PREFIX),
    background: body.style.background,
    backgroundColor: body.style.backgroundColor,
    backgroundImage: body.style.backgroundImage,
    backgroundPosition: body.style.backgroundPosition,
    backgroundSize: body.style.backgroundSize,
    backgroundRepeat: body.style.backgroundRepeat,
    customProperties: Object.fromEntries(
      BODY_RUNTIME_CUSTOM_PROPERTIES.map((property) => [property, body.style.getPropertyValue(property)])
    )
  };
}

function restoreBodyRuntime(snapshot) {
  const body = document.body;
  if (!body || !snapshot) return;

  classNamesWithPrefix(body, SCHEME_CLASS_PREFIX).forEach((className) => body.classList.remove(className));
  classNamesWithPrefix(body, WALLPAPER_CLASS_PREFIX).forEach((className) => body.classList.remove(className));
  snapshot.schemeClasses.forEach((className) => body.classList.add(className));
  snapshot.wallpaperClasses.forEach((className) => body.classList.add(className));
  body.style.background = snapshot.background;
  body.style.backgroundColor = snapshot.backgroundColor;
  body.style.backgroundImage = snapshot.backgroundImage;
  body.style.backgroundPosition = snapshot.backgroundPosition;
  body.style.backgroundSize = snapshot.backgroundSize;
  body.style.backgroundRepeat = snapshot.backgroundRepeat;
  BODY_RUNTIME_CUSTOM_PROPERTIES.forEach((property) => {
    body.style.setProperty(property, snapshot.customProperties[property] || '');
  });
}

function captureDockRuntime() {
  const dock = document.querySelector('.dock-container');
  if (!dock) return null;

  return {
    dataset: Object.fromEntries(DOCK_DATASET_FIELDS.map((field) => [field, dock.dataset[field]])),
    customProperties: Object.fromEntries(
      DOCK_CUSTOM_PROPERTIES.map((property) => [property, dock.style.getPropertyValue(property)])
    )
  };
}

function restoreDockRuntime(snapshot) {
  const dock = document.querySelector('.dock-container');
  if (!dock || !snapshot) return;

  DOCK_DATASET_FIELDS.forEach((field) => {
    const value = snapshot.dataset[field];
    if (value === undefined) {
      delete dock.dataset[field];
    } else {
      dock.dataset[field] = value;
    }
  });
  DOCK_CUSTOM_PROPERTIES.forEach((property) => {
    dock.style.setProperty(property, snapshot.customProperties[property] || '');
  });
  dock.dispatchEvent(new CustomEvent(DOCK_RUNTIME_SYNC_EVENT));
}

function captureRuntimeSnapshot() {
  return {
    body: captureBodyRuntime(),
    dock: captureDockRuntime(),
    storedTheme: localStorage.getItem('theme')
  };
}

function restoreStoredTheme(snapshot, Alpine) {
  if (!snapshot) return;
  if (snapshot.storedTheme === null) {
    localStorage.removeItem('theme');
  } else {
    localStorage.setItem('theme', snapshot.storedTheme);
  }
  Alpine.store('theme')?.refresh?.();
}

function readableTextOnColor(value) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i);
  if (!match) return '#ffffff';
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const luminance = channels
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.18 ? '#17181a' : '#ffffff';
}

function applyBodyPreview(draft, { remoteImageReady = true } = {}) {
  const body = document.body;
  if (!body) return;

  const appearance = draft.desktop.appearance;
  const background = draft.desktop.background;

  classNamesWithPrefix(body, SCHEME_CLASS_PREFIX).forEach((className) => body.classList.remove(className));
  if (appearance.mode === 'custom') {
    body.classList.add('scheme-custom');
    body.style.setProperty('--mac-accent', appearance.accent_color);
    body.style.setProperty('--theme-accent-contrast', readableTextOnColor(appearance.accent_color));
    body.style.setProperty('--mac-selection', appearance.selection_color);
    body.style.setProperty('--mac-folder1', appearance.folder_color1);
    body.style.setProperty('--mac-folder2', appearance.folder_color2);
    body.style.setProperty('--mac-folder3', appearance.folder_color3);
  } else {
    body.classList.add(`${SCHEME_CLASS_PREFIX}${appearance.preset}`);
    BODY_CUSTOM_PROPERTIES.forEach((property) => body.style.removeProperty(property));
    body.style.setProperty(
      '--theme-accent-contrast',
      readableTextOnColor(APPEARANCE_PRESET_ACCENTS[appearance.preset] || APPEARANCE_PRESET_ACCENTS.blue)
    );
  }

  classNamesWithPrefix(body, WALLPAPER_CLASS_PREFIX).forEach((className) => body.classList.remove(className));
  body.style.background = '';
  body.style.backgroundImage = '';
  body.style.backgroundPosition = '';
  body.style.backgroundSize = '';
  body.style.backgroundRepeat = '';

  if (background.mode === 'preset') {
    body.style.backgroundColor = '';
    body.classList.add(`${WALLPAPER_CLASS_PREFIX}${background.preset}`);
  } else if (background.mode === 'solid') {
    body.style.backgroundColor = background.solid_color;
  } else if (background.image_url && remoteImageReady) {
    const escapedUrl = String(background.image_url).replaceAll('"', '%22');
    body.style.background = `url("${escapedUrl}") center / cover no-repeat`;
    body.style.backgroundColor = '#0f172a';
  }
}

function applyDockPreview(draft) {
  const dock = document.querySelector('.dock-container');
  if (!dock) return;

  const appearance = draft.dock.appearance;
  const baseSize = appearance.icon_size;
  const dockPadding = appearance.dock_padding;
  const magScale = appearance.magnification_scale;
  const maxLift = appearance.magnification ? Math.round(baseSize * 0.1) : 0;
  const glassHeight = baseSize + dockPadding * 2;
  const barHeadroom = appearance.magnification ? Math.max(14, maxLift + 8) : 0;

  dock.dataset.showLabels = String(appearance.show_labels);
  dock.dataset.magnification = String(appearance.magnification);
  dock.dataset.dockIconSize = String(baseSize);
  dock.dataset.dockIconGap = String(appearance.icon_gap);
  dock.dataset.dockPadding = String(dockPadding);
  dock.dataset.dockMagScale = String(magScale);
  dock.dataset.dockGlassBlur = String(appearance.glass_blur);
  dock.dataset.dockGlassOpacity = String(appearance.glass_opacity);
  dock.style.setProperty('--dock-icon-size', `${baseSize}px`);
  dock.style.setProperty('--dock-gap', `${appearance.icon_gap}px`);
  dock.style.setProperty('--dock-padding', `${dockPadding}px`);
  dock.style.setProperty('--dock-glass-height', `${glassHeight}px`);
  dock.style.setProperty('--dock-bar-height', `${glassHeight + barHeadroom}px`);
  dock.style.setProperty('--dock-blur', `${appearance.glass_blur}px`);
  dock.style.setProperty('--dock-opacity', `${appearance.glass_opacity / 100}`);
  dock.style.setProperty('--dock-icon-radius', `${Math.round(baseSize * 0.25)}px`);

  dock.querySelectorAll('.dock-tooltip').forEach((tooltip) => {
    tooltip.hidden = !appearance.show_labels;
    if (appearance.show_labels) {
      tooltip.style.removeProperty('display');
    }
  });
  dock.dispatchEvent(new CustomEvent(DOCK_RUNTIME_SYNC_EVENT));
}

function applyMenubarPreview(draft) {
  const menubar = document.querySelector('.menubar');
  const body = document.body;
  if (!menubar || !draft?.header || !draft?.sidebar?.notification_center) return;

  const fallbackTitle = String(
    menubar.dataset.siteFallbackTitle
    || menubar.dataset.siteTitle
    || ''
  ).trim();
  const configuredTitle = String(draft.header.logo?.title || '').trim();
  const loginLabel = String(draft.header.auth?.login_label || '').trim() || '登录';
  const notification = draft.sidebar.notification_center;
  const effectiveTitle = configuredTitle || fallbackTitle;

  menubar.dataset.siteTitle = effectiveTitle;
  menubar.dataset.themeSettingEnabled = String(draft.header.theme.enable_frontend_setting);
  menubar.dataset.searchEnabled = String(draft.header.actions.search_enabled);
  menubar.dataset.authEnabled = String(draft.header.actions.auth_enabled);
  menubar.dataset.mobileMenuEnabled = String(draft.header.actions.mobile_menu_enabled);
  menubar.dataset.timeEnabled = String(draft.header.time.enabled);
  menubar.dataset.timeDesktopPreset = String(draft.header.time.desktop_preset);
  menubar.dataset.timeMobilePreset = String(draft.header.time.mobile_preset);
  menubar.dataset.timeHourCycle = String(draft.header.time.hour_cycle);
  menubar.dataset.loginLabel = loginLabel;
  menubar.dataset.notificationCenterTitle = String(notification.title);
  menubar.dataset.notificationCenterGuestTitle = String(notification.guest_title);
  menubar.dataset.notificationCenterDefaultOpen = String(notification.default_open);

  if (body) {
    body.style.setProperty('--mac-header-dropdown-light-bg', draft.header.dropdown.light_bg);
    body.style.setProperty('--mac-header-dropdown-dark-bg', draft.header.dropdown.dark_bg);
  }

  window.dispatchEvent(new CustomEvent(MENUBAR_RUNTIME_SYNC_EVENT, {
    detail: {
      appName: effectiveTitle,
      themeSettingEnabled: draft.header.theme.enable_frontend_setting,
      searchEnabled: draft.header.actions.search_enabled,
      authEnabled: draft.header.actions.auth_enabled,
      mobileMenuEnabled: draft.header.actions.mobile_menu_enabled,
      timeEnabled: draft.header.time.enabled,
      timeDesktopPreset: draft.header.time.desktop_preset,
      timeMobilePreset: draft.header.time.mobile_preset,
      timeHourCycle: draft.header.time.hour_cycle,
      loginLabel,
      notificationCenterTitle: notification.title,
      notificationCenterGuestTitle: notification.guest_title,
      notificationCenterDefaultOpen: notification.default_open
    }
  }));
}

function applyWidgetPreview(draft, changedPath = '') {
  const behavior = draft?.widgets?.behavior;
  const weather = draft?.widgets?.modules?.weather;
  if (!behavior || !weather) return;

  window.dispatchEvent(new CustomEvent(WIDGET_RUNTIME_SYNC_EVENT, {
    detail: {
      changedPath,
      enabled: behavior.enabled,
      hideOnMobile: behavior.hide_on_mobile,
      editEnabled: behavior.edit_enabled,
      weather: {
        cityName: weather.city_name,
        refreshMinutes: weather.refresh_minutes
      }
    }
  }));
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
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
    runtimeSnapshot: null,
    reloadRequired: false,
    wallpaperPreviewGeneration: 0,
    readyWallpaperUrl: '',
    restoreFocusElement: null,
    searchAvailable: false,
    mobileMenuAvailable: false,
    navItems: SETTINGS_NAV_ITEMS,

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
        if (!this.hasDirtyChanges() && !this.saving) return;
        event.preventDefault();
        event.returnValue = '';
      };
      this.handleEscape = (event) => {
        if (event.key === 'Escape' && this.visible) {
          event.preventDefault();
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
      window.removeEventListener('theme-settings-open', this.handleOpenRequest);
      window.removeEventListener('keydown', this.handleEscape, true);
      window.removeEventListener('keydown', this.handleSettingsRadioKeydown, true);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      this.unregisterNavigationGuard?.();
      this.unregisterNavigationGuard = null;
      this.mobileViewportQuery?.removeEventListener?.('change', this.handleMobileViewportChange);
      if (this.closeArmTimer) {
        window.clearTimeout(this.closeArmTimer);
      }
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
      this.restoreFocusElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      this.runtimeSnapshot = captureRuntimeSnapshot();
      this.draft = cloneThemeSettingsValue(this.baseline);
      this.dirtyPaths = [];
      this.validationErrors = {};
      this.draftMutationVersion = 0;
      this.closeArmed = false;
      this.mobileSidebarOpen = false;
      this.statusTone = this.reloadRequired ? 'warning' : 'muted';
      this.statusMessage = this.reloadRequired
        ? '上次保存的服务端渲染内容尚未刷新；可直接刷新页面使其完整生效。'
        : '更改会先在当前桌面预览，应用后写入 Halo 主题配置。';
      this.visible = true;
      document.body.classList.add('theme-settings-open');
      await nextFrame();
      this.syncRadioGroupTabStops();
      this.open = true;
      window.setTimeout(() => {
        document.querySelector('[data-theme-settings-window]')?.focus?.({ preventScroll: true });
      }, 40);
    },

    close(force = false) {
      if (!this.visible) return;
      if (this.saving) {
        this.statusTone = 'warning';
        this.statusMessage = '主题设置正在保存，请等待完成后再关闭。';
        return;
      }
      if (this.hasDirtyChanges() && !force && !this.closeArmed) {
        this.closeArmed = true;
        this.statusTone = 'warning';
        this.statusMessage = '存在未应用的修改；再次点击关闭将放弃这些修改。';
        if (this.closeArmTimer) {
          window.clearTimeout(this.closeArmTimer);
        }
        this.closeArmTimer = window.setTimeout(() => {
          this.closeArmed = false;
          this.statusTone = 'muted';
          this.statusMessage = '修改尚未应用。';
        }, CLOSE_CONFIRM_TIMEOUT);
        return;
      }
      this.closeArmed = false;
      this.restoreRuntimePreview();
      this.open = false;
      document.body.classList.remove('theme-settings-open');
      window.setTimeout(() => {
        this.visible = false;
        this.query = '';
        this.activePane = 'appearance';
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
      return this.dirtyPaths.length > 0;
    },

    captureNavigationGuardState() {
      return {
        draftMutationVersion: this.draftMutationVersion,
        dirty: this.hasDirtyChanges(),
        saving: this.saving === true,
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
      if (this.closeArmTimer) window.clearTimeout(this.closeArmTimer);
      this.closeArmTimer = null;
      this.closeArmed = false;
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

    update(path, value) {
      if (this.validationErrors[path]) {
        const validationErrors = { ...this.validationErrors };
        delete validationErrors[path];
        this.validationErrors = validationErrors;
      }
      if (this.statusResetTimer) {
        window.clearTimeout(this.statusResetTimer);
        this.statusResetTimer = null;
      }
      const nextDraft = updateThemeSettingsDraft(this.draft, path, value);
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
      this.closeArmed = false;
      this.statusTone = 'muted';
      this.statusMessage = this.hasDirtyChanges()
        ? '设置已修改，尚未应用。'
        : '已恢复到当前主题配置。';
      this.applyRuntimePreview(path);
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
      this.closeArmed = false;
      this.validationErrors = {};
      this.statusTone = 'success';
      this.statusMessage = '已撤销本次未应用的修改。';
      this.applyRuntimePreview();
      if (this.statusResetTimer) window.clearTimeout(this.statusResetTimer);
      this.statusResetTimer = window.setTimeout(() => {
        if (!this.hasDirtyChanges() && !this.reloadRequired) {
          this.statusTone = 'muted';
          this.statusMessage = '更改会先在当前桌面预览，应用后写入 Halo 主题配置。';
        }
        this.statusResetTimer = null;
      }, 1800);
    },

    applyRuntimePreview(changedPath = '') {
      const wallpaperUrl = this.draft.desktop.background.mode === 'image'
        ? String(this.draft.desktop.background.image_url || '')
        : '';
      if (wallpaperUrl && wallpaperUrl !== this.readyWallpaperUrl) {
        const generation = ++this.wallpaperPreviewGeneration;
        applyBodyPreview(this.draft, { remoteImageReady: false });
        const image = new Image();
        image.onload = () => {
          if (generation !== this.wallpaperPreviewGeneration || this.draft.desktop.background.mode !== 'image') return;
          this.readyWallpaperUrl = wallpaperUrl;
          applyBodyPreview(this.draft);
        };
        image.onerror = () => {
          if (generation !== this.wallpaperPreviewGeneration) return;
          this.statusTone = 'error';
          this.statusMessage = '后台桌面图片无法加载，当前预览已保留纯色背景。';
        };
        image.src = wallpaperUrl;
      } else {
        this.wallpaperPreviewGeneration += 1;
        applyBodyPreview(this.draft);
      }
      applyDockPreview(this.draft);
      applyMenubarPreview(this.draft);
      applyWidgetPreview(this.draft, changedPath);
      if (!changedPath || changedPath === 'header.theme.default_mode') {
        Alpine.store('theme')?.setMode?.(this.draft.header.theme.default_mode);
      }
    },

    restoreRuntimePreview() {
      this.wallpaperPreviewGeneration += 1;
      if (!this.runtimeSnapshot) return;
      restoreBodyRuntime(this.runtimeSnapshot.body);
      restoreDockRuntime(this.runtimeSnapshot.dock);
      restoreStoredTheme(this.runtimeSnapshot, Alpine);
      applyMenubarPreview(this.baseline);
      applyWidgetPreview(this.baseline);
      this.runtimeSnapshot = null;
    },

    async save() {
      if (this.saving || !this.hasDirtyChanges() || !this.canOpen || this.hasValidationErrors()) return false;
      const savePaths = [...this.dirtyPaths];
      const saveDraft = cloneThemeSettingsValue(this.draft);
      const saveMutationVersion = this.draftMutationVersion;
      this.saving = true;
      this.statusTone = 'muted';
      this.statusMessage = '正在读取最新配置并合并修改…';

      try {
        const { mutateThemeConfig } = await loadThemeConfigClient();
        const result = await mutateThemeConfig(
          this.endpoint,
          (latestConfig) => applyThemeSettingsDraftToConfig(latestConfig, saveDraft, savePaths)
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
        this.statusTone = pendingPaths.length > 0 ? 'warning' : 'success';
        this.statusMessage = pendingPaths.length > 0
          ? `本次修改已保存；保存期间又产生 ${pendingPaths.length} 项新修改，请再次应用。`
          : '主题设置已保存；刷新页面后所有服务端渲染内容会同步生效。';

        const pendingDraft = this.draft;
        this.draft = cloneThemeSettingsValue(savedBaseline);
        this.applyRuntimePreview();
        restoreStoredTheme(this.runtimeSnapshot, Alpine);
        this.runtimeSnapshot = captureRuntimeSnapshot();
        this.draft = pendingDraft;
        if (pendingPaths.length > 0) {
          this.applyRuntimePreview();
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

    switchPane(pane) {
      if (!SETTINGS_NAV_ITEMS.some((item) => item.id === pane)) return;
      const restoreMobileToggleFocus = this.mobileSidebarOpen && this.isMobileViewport;
      const content = document.querySelector('[data-theme-settings-content]');
      if (content) {
        content.scrollTop = 0;
        content.scrollLeft = 0;
      }
      this.activePane = pane;
      this.mobileSidebarOpen = false;
      window.requestAnimationFrame(() => {
        content?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
        if (restoreMobileToggleFocus) {
          document.querySelector('[data-theme-settings-sidebar-toggle]')?.focus?.({ preventScroll: true });
        }
      });
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

    navItemVisible(item) {
      const query = normalizeSearchValue(this.query);
      if (!query) return true;
      return normalizeSearchValue(`${item.label} ${item.detail}`).includes(query);
    }
  });
}
