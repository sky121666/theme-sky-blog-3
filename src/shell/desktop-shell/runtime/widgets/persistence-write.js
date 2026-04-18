/**
 * Save-path desktop layout helpers.
 */

import { cloneJsonValue } from '../shared/utils.js';
import { serializeDesktopIconInstance } from '../icons/index.js';
import { DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION } from './debug-core.js';
import { serializeWidgetInstance } from './catalog-core.js';

function buildDesktopWidgetLayoutPayload(layoutVersion, widgets, icons = [], columns = null) {
  return {
    version: DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
    layoutVersion,
    ...(columns ? { columns } : {}),
    instances: widgets
      .filter((widget) => !widget.hidden)
      .map((widget) => serializeWidgetInstance(widget)),
    // hasFullIconDefs = true 启用前端自管理模式：
    // icon 含完整定义（href/title/subtype…），deleted:true 为 tombstone
    hasFullIconDefs: true,
    icons: icons.map((icon) =>
      // tombstone 对象直接透传，普通图标走全字段序列化
      icon.deleted === true ? { key: icon.key, deleted: true } : serializeDesktopIconInstance(icon)
    )
  };
}

export function buildDesktopLayoutJsonString(layoutVersion, widgets, icons = [], columns = null) {
  return JSON.stringify(buildDesktopWidgetLayoutPayload(layoutVersion, widgets, icons, columns), null, 2);
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function applyDesktopLayoutJsonToGroup(container, layoutJson) {
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    return false;
  }

  const currentDesktopGroup = container.default_layout;

  if (typeof currentDesktopGroup === 'string') {
    const desktopGroup = parseJsonObject(currentDesktopGroup) || {};
    desktopGroup.layout_json = layoutJson;
    container.default_layout = JSON.stringify(desktopGroup);
    return true;
  }

  const desktopGroup = currentDesktopGroup && typeof currentDesktopGroup === 'object' && !Array.isArray(currentDesktopGroup)
    ? currentDesktopGroup
    : {};

  container.default_layout = {
    ...desktopGroup,
    layout_json: layoutJson
  };
  return true;
}

export function applyDesktopLayoutJsonToThemeConfig(config, layoutJson) {
  const nextConfig = cloneJsonValue(config) || {};

  if (nextConfig.spec?.value && applyDesktopLayoutJsonToGroup(nextConfig.spec.value, layoutJson)) {
    return nextConfig;
  }

  if (nextConfig.data && applyDesktopLayoutJsonToGroup(nextConfig.data, layoutJson)) {
    return nextConfig;
  }

  applyDesktopLayoutJsonToGroup(nextConfig, layoutJson);
  return nextConfig;
}
