const THEME_MODE_VALUES = new Set(['system', 'light', 'dark']);
const APPEARANCE_MODE_VALUES = new Set(['preset', 'custom']);
const BACKGROUND_MODE_VALUES = new Set(['preset', 'solid', 'image']);
const HEADER_TIME_PRESET_VALUES = new Set([
  'time-only',
  'time-seconds',
  'date-time',
  'weekday-date-time',
  'month-day-weekday-time'
]);
const APPEARANCE_PRESET_VALUES = new Set([
  'blue',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'graphite'
]);
const BACKGROUND_PRESET_VALUES = new Set([
  'tahoe-dawn',
  'tahoe-blue',
  'sequoia-mist',
  'graphite-night',
  'sonoma-sunset',
  'aurora-mint',
  'alpine-lilac',
  'coral-haze',
  'arctic-pearl',
  'midnight-indigo',
  'golden-amber',
  'deep-sea'
]);

const DEFAULT_DRAFT = Object.freeze({
  header: {
    logo: {
      title: ''
    },
    theme: {
      enable_frontend_setting: true,
      default_mode: 'system'
    },
    actions: {
      search_enabled: true,
      auth_enabled: true,
      mobile_menu_enabled: true
    },
    time: {
      enabled: true,
      desktop_preset: 'month-day-weekday-time',
      mobile_preset: 'time-only',
      hour_cycle: 12
    },
    auth: {
      login_label: '登录'
    },
    dropdown: {
      light_bg: 'rgba(88, 92, 100, 0.66)',
      dark_bg: 'rgba(70, 74, 82, 0.72)'
    }
  },
  desktop: {
    appearance: {
      mode: 'preset',
      preset: 'blue',
      accent_color: '#2E5FBD',
      selection_color: '#244D9B',
      folder_color1: '#4A90E2',
      folder_color2: '#64B5F6',
      folder_color3: '#90CAF9'
    },
    background: {
      mode: 'preset',
      preset: 'tahoe-dawn',
      solid_color: '#0F172A',
      image_url: ''
    }
  },
  dock: {
    appearance: {
      show_labels: true,
      magnification: true,
      icon_size: 48,
      icon_gap: 4,
      dock_padding: 6,
      magnification_scale: 1.4,
      glass_blur: 60,
      glass_opacity: 28
    }
  },
  widgets: {
    behavior: {
      enabled: true,
      hide_on_mobile: false,
      edit_enabled: true,
      fallback_cover: ''
    },
    modules: {
      weather: {
        city_name: '北京',
        refresh_minutes: 30
      }
    }
  },
  sidebar: {
    notification_center: {
      title: '通知中心',
      guest_title: '小组件',
      default_open: false
    }
  }
});

export const THEME_SETTINGS_WRITABLE_PATHS = Object.freeze([
  'header.logo.title',
  'header.theme.enable_frontend_setting',
  'header.theme.default_mode',
  'header.actions.search_enabled',
  'header.actions.auth_enabled',
  'header.actions.mobile_menu_enabled',
  'header.time.enabled',
  'header.time.desktop_preset',
  'header.time.mobile_preset',
  'header.time.hour_cycle',
  'header.auth.login_label',
  'header.dropdown.light_bg',
  'header.dropdown.dark_bg',
  'desktop.appearance.mode',
  'desktop.appearance.preset',
  'desktop.appearance.accent_color',
  'desktop.appearance.selection_color',
  'desktop.appearance.folder_color1',
  'desktop.appearance.folder_color2',
  'desktop.appearance.folder_color3',
  'desktop.background.mode',
  'desktop.background.preset',
  'desktop.background.solid_color',
  'dock.appearance.show_labels',
  'dock.appearance.magnification',
  'dock.appearance.icon_size',
  'dock.appearance.icon_gap',
  'dock.appearance.dock_padding',
  'dock.appearance.magnification_scale',
  'dock.appearance.glass_blur',
  'dock.appearance.glass_opacity',
  'widgets.behavior.enabled',
  'widgets.behavior.hide_on_mobile',
  'widgets.behavior.edit_enabled',
  'widgets.modules.weather.city_name',
  'widgets.modules.weather.refresh_minutes',
  'sidebar.notification_center.title',
  'sidebar.notification_center.guest_title',
  'sidebar.notification_center.default_open'
]);

const WRITABLE_PATHS = new Set(THEME_SETTINGS_WRITABLE_PATHS);

export function cloneThemeSettingsValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_error) {
      // Alpine stores expose reactive Proxy objects that structuredClone cannot
      // serialize. Theme settings are JSON-only, so a JSON clone is the safe
      // compatibility path for reactive drafts.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function resolveThemeConfigContainer(config) {
  if (config?.spec?.value && typeof config.spec.value === 'object' && !Array.isArray(config.spec.value)) {
    return config.spec.value;
  }
  if (config?.data && typeof config.data === 'object' && !Array.isArray(config.data)) {
    return config.data;
  }
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function getPathValue(source, path, fallback = undefined) {
  const value = String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], source);
  return value === undefined || value === null ? fallback : value;
}

function setPathValue(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (parts.length === 0) return;

  let cursor = target;
  parts.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
  cursor[parts.at(-1)] = value;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback, min, max, step = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(max, Math.max(min, numeric));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const stepped = Math.round(clamped / step) * step;
  return Number(stepped.toFixed(step < 1 ? 2 : 0));
}

function normalizeHexColor(value, fallback) {
  const candidate = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : fallback;
}

function normalizeCssColor(value, fallback) {
  const candidate = String(value || '').trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate)) {
    return candidate.toUpperCase();
  }

  const functionalMatch = candidate.match(/^(rgba?)\(([^)]+)\)$/i);
  if (!functionalMatch) return fallback;

  const channels = functionalMatch[2].split(',').map((part) => part.trim());
  const expectsAlpha = functionalMatch[1].toLowerCase() === 'rgba';
  if (channels.length !== (expectsAlpha ? 4 : 3)) return fallback;

  const colorChannelsValid = channels.slice(0, 3).every((channel) => {
    if (/^\d{1,3}%$/.test(channel)) {
      return Number(channel.slice(0, -1)) <= 100;
    }
    return /^\d{1,3}$/.test(channel) && Number(channel) <= 255;
  });
  if (!colorChannelsValid) return fallback;

  if (expectsAlpha) {
    const alpha = channels[3];
    const alphaValid = /^\d{1,3}%$/.test(alpha)
      ? Number(alpha.slice(0, -1)) <= 100
      : /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(alpha);
    if (!alphaValid) return fallback;
  }

  return `${functionalMatch[1].toLowerCase()}(${channels.join(', ')})`;
}

function normalizeEnum(value, allowed, fallback) {
  const candidate = String(value || '').trim();
  return allowed.has(candidate) ? candidate : fallback;
}

function normalizeText(value, fallback = '', maxLength = 80) {
  const candidate = String(value ?? '').trim();
  return (candidate || fallback).slice(0, maxLength);
}

function normalizeOptionalText(value, maxLength = 80) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeThemeSettingValue(path, value, fallback = undefined) {
  switch (path) {
    case 'header.theme.enable_frontend_setting':
    case 'header.actions.search_enabled':
    case 'header.actions.auth_enabled':
    case 'header.actions.mobile_menu_enabled':
    case 'header.time.enabled':
    case 'dock.appearance.show_labels':
    case 'dock.appearance.magnification':
    case 'widgets.behavior.enabled':
    case 'widgets.behavior.hide_on_mobile':
    case 'widgets.behavior.edit_enabled':
    case 'sidebar.notification_center.default_open':
      return normalizeBoolean(value, fallback === undefined ? false : fallback);
    case 'header.logo.title':
      return normalizeOptionalText(value, 80);
    case 'header.theme.default_mode':
      return normalizeEnum(value, THEME_MODE_VALUES, fallback || 'system');
    case 'header.time.desktop_preset':
      return normalizeEnum(value, HEADER_TIME_PRESET_VALUES, fallback || 'month-day-weekday-time');
    case 'header.time.mobile_preset':
      return normalizeEnum(value, HEADER_TIME_PRESET_VALUES, fallback || 'time-only');
    case 'header.time.hour_cycle':
      return normalizeNumber(value, fallback ?? 12, 12, 24, 12);
    case 'header.auth.login_label':
      return normalizeText(value, fallback || '登录', 20);
    case 'header.dropdown.light_bg':
      return normalizeCssColor(value, fallback || 'rgba(88, 92, 100, 0.66)');
    case 'header.dropdown.dark_bg':
      return normalizeCssColor(value, fallback || 'rgba(70, 74, 82, 0.72)');
    case 'desktop.appearance.mode':
      return normalizeEnum(value, APPEARANCE_MODE_VALUES, fallback || 'preset');
    case 'desktop.appearance.preset':
      return normalizeEnum(value, APPEARANCE_PRESET_VALUES, fallback || 'blue');
    case 'desktop.background.mode':
      return normalizeEnum(value, BACKGROUND_MODE_VALUES, fallback || 'preset');
    case 'desktop.background.preset':
      return normalizeEnum(value, BACKGROUND_PRESET_VALUES, fallback || 'tahoe-dawn');
    case 'desktop.appearance.accent_color':
      return normalizeHexColor(value, fallback || '#2E5FBD');
    case 'desktop.appearance.selection_color':
      return normalizeHexColor(value, fallback || '#244D9B');
    case 'desktop.appearance.folder_color1':
      return normalizeHexColor(value, fallback || '#4A90E2');
    case 'desktop.appearance.folder_color2':
      return normalizeHexColor(value, fallback || '#64B5F6');
    case 'desktop.appearance.folder_color3':
      return normalizeHexColor(value, fallback || '#90CAF9');
    case 'desktop.background.solid_color':
      return normalizeHexColor(value, fallback || '#0F172A');
    case 'dock.appearance.icon_size':
      return normalizeNumber(value, fallback ?? 48, 36, 64, 2);
    case 'dock.appearance.icon_gap':
      return normalizeNumber(value, fallback ?? 4, 2, 12, 1);
    case 'dock.appearance.dock_padding':
      return normalizeNumber(value, fallback ?? 6, 4, 16, 1);
    case 'dock.appearance.magnification_scale':
      return normalizeNumber(value, fallback ?? 1.4, 1, 2, 0.1);
    case 'dock.appearance.glass_blur':
      return normalizeNumber(value, fallback ?? 60, 20, 100, 5);
    case 'dock.appearance.glass_opacity':
      return normalizeNumber(value, fallback ?? 28, 10, 80, 2);
    case 'widgets.modules.weather.city_name':
      return normalizeText(value, fallback || '北京', 40);
    case 'widgets.modules.weather.refresh_minutes':
      return normalizeNumber(value, fallback ?? 30, 10, 180, 5);
    case 'sidebar.notification_center.title':
      return normalizeText(value, fallback || '通知中心', 40);
    case 'sidebar.notification_center.guest_title':
      return normalizeText(value, fallback || '小组件', 40);
    default:
      return value;
  }
}

export function buildThemeSettingsDraft(config) {
  const container = resolveThemeConfigContainer(config);
  const draft = cloneThemeSettingsValue(DEFAULT_DRAFT);

  THEME_SETTINGS_WRITABLE_PATHS.forEach((path) => {
    const fallback = getPathValue(draft, path);
    const sourceValue = getPathValue(container, path, fallback);
    setPathValue(draft, path, normalizeThemeSettingValue(path, sourceValue, fallback));
  });

  draft.desktop.background.image_url = normalizeText(
    getPathValue(container, 'desktop.background.image_url', ''),
    '',
    2048
  );
  draft.widgets.behavior.fallback_cover = normalizeText(
    getPathValue(container, 'widgets.behavior.fallback_cover', ''),
    '',
    2048
  );
  return draft;
}

export function updateThemeSettingsDraft(draft, path, value) {
  if (!WRITABLE_PATHS.has(path)) {
    throw new Error(`Theme settings path is not writable: ${path}`);
  }

  const next = cloneThemeSettingsValue(draft || DEFAULT_DRAFT);
  const fallback = getPathValue(next, path, getPathValue(DEFAULT_DRAFT, path));
  setPathValue(next, path, normalizeThemeSettingValue(path, value, fallback));
  return next;
}

export function applyThemeSettingsDraftToConfig(config, draft, changedPaths = []) {
  const nextConfig = cloneThemeSettingsValue(config || {});
  const container = resolveThemeConfigContainer(nextConfig);
  const uniquePaths = Array.from(new Set(changedPaths)).filter((path) => WRITABLE_PATHS.has(path));

  uniquePaths.forEach((path) => {
    const fallback = getPathValue(DEFAULT_DRAFT, path);
    const value = getPathValue(draft, path, fallback);
    setPathValue(container, path, normalizeThemeSettingValue(path, value, fallback));
  });

  return nextConfig;
}

export function themeSettingsValueAt(source, path, fallback = undefined) {
  return getPathValue(source, path, fallback);
}
