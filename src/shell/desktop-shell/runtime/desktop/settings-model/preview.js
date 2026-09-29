import { themeSettingsValueAt } from '../theme-settings-core.js';
import { sanitizeIconSvg } from '../settings-assets/icon-svg.js';

const SCHEME_CLASS_PREFIX = 'scheme-';
const WALLPAPER_CLASS_PREFIX = 'wallpaper-';
const DOCK_RUNTIME_SYNC_EVENT = 'theme:dock-settings-change';
const MENUBAR_RUNTIME_SYNC_EVENT = 'theme:menubar-settings-change';
const WIDGET_RUNTIME_SYNC_EVENT = 'theme:widget-settings-change';
const HEADER_ICON_SELECTORS = Object.freeze({
  'header.logo.icon': '.menubar-brand-icon',
  'header.icons.mobile_menu': '.menubar-mobile-trigger',
  'header.icons.search': '.menubar-search-btn',
  'header.icons.auth': '.menubar-auth-btn--icon',
  'header.icons.theme_light': '.menubar-theme-icon-slot:first-child',
  'header.icons.theme_dark': '.menubar-theme-icon-slot:last-child'
});

function captureHeaderIcons() {
  return Object.fromEntries(Object.entries(HEADER_ICON_SELECTORS).map(([path, selector]) => [path, document.querySelector(selector)?.innerHTML]));
}

export function restoreHeaderIcons(snapshot) {
  if (!snapshot) return;
  for (const [path, selector] of Object.entries(HEADER_ICON_SELECTORS)) {
    const target = document.querySelector(selector);
    if (target && typeof snapshot[path] === 'string') target.innerHTML = snapshot[path];
  }
}

export function applyHeaderIconPreview(draft) {
  for (const [path, selector] of Object.entries(HEADER_ICON_SELECTORS)) {
    const target = document.querySelector(selector);
    if (!target) continue;
    const value = themeSettingsValueAt(draft, path);
    const svg = sanitizeIconSvg(value?.value || '');
    const fallback = document.getElementById('theme-header-icon-defaults')?.content?.querySelector(`[data-icon-path="${path}"]`)?.innerHTML;
    if (svg) target.innerHTML = path === 'header.logo.icon' ? `<span class="menubar-brand-glyph">${svg}</span>` : svg;
    else if (fallback !== undefined) target.innerHTML = fallback;
  }
}
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

export function restoreBodyRuntime(snapshot) {
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

export function restoreDockRuntime(snapshot) {
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

export function captureRuntimeSnapshot() {
  return {
    body: captureBodyRuntime(),
    dock: captureDockRuntime(),
    icons: captureHeaderIcons(),
    storedTheme: localStorage.getItem('theme')
  };
}

export function restoreStoredTheme(snapshot, Alpine) {
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

export function applyBodyPreview(draft, { remoteImageReady = true } = {}) {
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
  } else if (background.mode === 'image') {
    body.style.backgroundColor = '#0f172a';
    if (background.image_url && remoteImageReady) {
      const escapedUrl = String(background.image_url).replaceAll('"', '%22');
      body.style.background = `url("${escapedUrl}") center / cover no-repeat`;
    }
  }
}

export function applyDockPreview(draft) {
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

export function applyMenubarPreview(draft) {
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

export function applyWidgetPreview(draft, changedPath = '') {
  const behavior = draft?.widgets?.behavior;
  const weather = draft?.widgets?.modules?.weather;
  if (!behavior || !weather) return;

  window.dispatchEvent(new CustomEvent(WIDGET_RUNTIME_SYNC_EVENT, {
    detail: {
      changedPath,
      enabled: behavior.enabled,
      hideOnMobile: behavior.hide_on_mobile,
      editEnabled: behavior.edit_enabled,
      fallbackCover: behavior.fallback_cover,
      weather: {
        cityName: weather.city_name,
        refreshMinutes: weather.refresh_minutes
      }
    }
  }));
}
