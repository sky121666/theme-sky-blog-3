import { SETTINGS_FIELDS, SETTINGS_PANES } from './settings-model/schema.js';

export { SETTINGS_FIELDS, SETTINGS_PANES };

const FIELD_BY_PATH = new Map(SETTINGS_FIELDS.map((field) => [field.path, field]));
const DEFAULT_DRAFT = {};
SETTINGS_FIELDS.forEach((field) => setPathValue(DEFAULT_DRAFT, field.path, cloneThemeSettingsValue(field.default)));

export const THEME_SETTINGS_WRITABLE_PATHS = Object.freeze(
  SETTINGS_FIELDS.filter((field) => field.writable).map((field) => field.path)
);
export const THEME_SETTINGS_ICON_FIELDS = Object.freeze(SETTINGS_FIELDS.filter((field) => field.type === 'icon'));
export const THEME_SETTINGS_IMAGE_FIELDS = Object.freeze(SETTINGS_FIELDS.filter((field) => field.type === 'image'));
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

export function isValidThemeCssColor(value) {
  return normalizeCssColor(value, null) !== null;
}

export function isThemeImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (!/^https?:\/\//i.test(value) && !/^\/(?!\/)/.test(value)) return false;
  try {
    const url = new URL(value, 'https://theme.invalid');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch (_error) { return false; }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateThemeSettingValue(field, value) {
  if (field.type === 'image' && value && (typeof value !== 'string' || !isThemeImageUrl(value.trim()))) {
    throw new Error('请输入有效的图片地址（HTTP、HTTPS 或站内路径）');
  }
  if (field.type === 'icon') {
    if (value !== '' && (!isRecord(value) || typeof value.value !== 'string')) {
      throw new Error('请选择有效的图标');
    }
    if (value?.value?.length > 100_000) throw new Error('图标数据过大，请选择更简洁的图标');
  }
  if (field.type === 'custom-icons' || field.type === 'content-list') {
    if (!Array.isArray(value)) throw new Error('桌面图标配置必须是数组');
    const valid = value.every((item) => {
      if (field.type === 'content-list') {
        return typeof item === 'string' || (isRecord(item)
          && typeof (item.name ?? item.metadata?.name ?? item.value) === 'string');
      }
      return isRecord(item) && typeof item.name === 'string' && typeof item.href === 'string'
        && (item.type === undefined || ['folder', 'document', 'link'].includes(item.type))
        && (item.external === undefined || typeof item.external === 'boolean');
    });
    if (!valid) throw new Error('桌面图标配置包含无效的项目');
  }
}

export function normalizeThemeSettingValue(path, value, fallback = undefined) {
  const field = FIELD_BY_PATH.get(path);
  if (!field) return value;
  const defaultValue = fallback === undefined ? field.default : fallback;
  switch (field.type) {
    case 'icon':
      if (!isRecord(value) || typeof value.value !== 'string') return '';
      // Console owns the icon object. Preserve its complete metadata and SVG;
      // the shared picker sanitizes newly selected SVG before this boundary.
      return {
        ...cloneThemeSettingsValue(value),
        value: value.value,
        name: String(value.name ?? ''),
        width: String(normalizeNumber(value.width, 24, 16, 64, 1)),
        color: String(value.color ?? '')
      };
    case 'image': {
      const url = typeof value === 'string' ? value.trim() : '';
      return !url || isThemeImageUrl(url) ? url : '';
    }
    case 'boolean':
      return normalizeBoolean(value, defaultValue);
    case 'select': {
      const selected = field.options.find((option) => String(option.value) === String(value ?? '').trim());
      return selected ? selected.value : defaultValue;
    }
    case 'number':
      return normalizeNumber(value, defaultValue, field.min, field.max, field.step);
    case 'color':
      return normalizeHexColor(value, defaultValue);
    case 'css-color':
      return normalizeCssColor(value, defaultValue);
    case 'custom-icons':
    case 'content-list':
      return cloneThemeSettingsValue(Array.isArray(value) ? value : defaultValue);
    case 'text':
    case 'textarea':
    case 'external-editor':
      return String(value ?? defaultValue);
    case 'menu':
      return String(value ?? defaultValue).trim();
    default:
      return value;
  }
}

export function buildThemeSettingsDraft(config) {
  const container = resolveThemeConfigContainer(config);
  const draft = cloneThemeSettingsValue(DEFAULT_DRAFT);

  SETTINGS_FIELDS.forEach((field) => {
    const sourceValue = getPathValue(container, field.path);
    if (sourceValue === undefined) return;
    // Loading existing strings must never shorten or rewrite their contents.
    const keepText = ['text', 'textarea', 'menu', 'external-editor'].includes(field.type)
      && typeof sourceValue === 'string';
    setPathValue(draft, field.path, keepText ? sourceValue
      : normalizeThemeSettingValue(field.path, sourceValue, field.default));
  });

  return draft;
}

export function updateThemeSettingsDraft(draft, path, value) {
  if (!WRITABLE_PATHS.has(path)) {
    throw new Error(`Theme settings path is not writable: ${path}`);
  }
  validateThemeSettingValue(FIELD_BY_PATH.get(path), value);

  const next = cloneThemeSettingsValue(draft || DEFAULT_DRAFT);
  const fallback = getPathValue(next, path, getPathValue(DEFAULT_DRAFT, path));
  setPathValue(next, path, normalizeThemeSettingValue(path, value, fallback));
  return next;
}

export function rebaseThemeSettingsDraftAfterSave(savedBaseline, currentDraft, candidatePaths = []) {
  const baseline = cloneThemeSettingsValue(savedBaseline || DEFAULT_DRAFT);
  const current = cloneThemeSettingsValue(currentDraft || baseline);
  const dirtyPaths = Array.from(new Set(candidatePaths))
    .filter((path) => WRITABLE_PATHS.has(path))
    .filter((path) => JSON.stringify(getPathValue(current, path)) !== JSON.stringify(getPathValue(baseline, path)));
  let draft = cloneThemeSettingsValue(baseline);
  dirtyPaths.forEach((path) => {
    draft = updateThemeSettingsDraft(draft, path, getPathValue(current, path));
  });
  return { draft, dirtyPaths };
}

export function applyThemeSettingsDraftToConfig(config, draft, changedPaths = []) {
  const nextConfig = cloneThemeSettingsValue(config || {});
  const container = resolveThemeConfigContainer(nextConfig);
  const uniquePaths = Array.from(new Set(changedPaths)).filter((path) => WRITABLE_PATHS.has(path));

  uniquePaths.forEach((path) => {
    const fallback = getPathValue(DEFAULT_DRAFT, path);
    const value = getPathValue(draft, path, fallback);
    validateThemeSettingValue(FIELD_BY_PATH.get(path), value);
    setPathValue(container, path, normalizeThemeSettingValue(path, value, fallback));
  });

  return nextConfig;
}

export function themeSettingsValueAt(source, path, fallback = undefined) {
  return getPathValue(source, path, fallback);
}
