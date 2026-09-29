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

function selectedContentName(value) {
  return typeof value === 'string' ? value : value?.name ?? value?.metadata?.name ?? value?.value;
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
  } else {
    const desktopGroup = currentDesktopGroup && typeof currentDesktopGroup === 'object' && !Array.isArray(currentDesktopGroup)
      ? currentDesktopGroup
      : {};
    container.default_layout = { ...desktopGroup, layout_json: layoutJson };
  }

  // 同步：当前端删除了后端设定的图标时，通过 tombstone 将其从后台主题设置中真实抹除
  const payload = parseJsonObject(layoutJson);
  if (payload && Array.isArray(payload.icons) && container.desktop?.icons) {
    const backendIcons = container.desktop.icons;
    const tombstoneKeys = payload.icons.filter((i) => i && i.deleted === true && i.key).map((i) => i.key);
    if (tombstoneKeys.length > 0) {
      if (Array.isArray(backendIcons.custom_icons)) {
        backendIcons.custom_icons = backendIcons.custom_icons.filter(
          (item) => item && !tombstoneKeys.includes(`icon-custom-${item.name}`)
        );
      }
      if (Array.isArray(backendIcons.categories)) {
        backendIcons.categories = backendIcons.categories.filter(
          (item) => !tombstoneKeys.includes(`icon-category-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.tags)) {
        backendIcons.tags = backendIcons.tags.filter(
          (item) => !tombstoneKeys.includes(`icon-tag-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.posts)) {
        backendIcons.posts = backendIcons.posts.filter(
          (item) => !tombstoneKeys.includes(`icon-post-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.single_pages)) {
        backendIcons.single_pages = backendIcons.single_pages.filter(
          (item) => !tombstoneKeys.includes(`icon-page-${selectedContentName(item)}`)
        );
      }
    }

    // 将前端新增的图标推送到后端的 custom_icons 配置供管理
    const activeCustomIcons = payload.icons.filter(
      (i) => payload.hasFullIconDefs === true && i && i.deleted !== true
        && typeof i.key === 'string' && i.key.startsWith('icon-custom-')
    );
    if (activeCustomIcons.length > 0) {
      if (!Array.isArray(backendIcons.custom_icons)) {
        backendIcons.custom_icons = [];
      }
      const existingByName = new Map(backendIcons.custom_icons.map((item) => [item?.name, item]));
      for (const icon of activeCustomIcons) {
        // The key owns identity; the desktop display title can be edited
        // independently and must never rename the backend entry.
        const newName = icon.key.replace('icon-custom-', '');
        const properties = { href: icon.href || '#', type: icon.subtype || 'folder', external: icon.external === true };
        const existing = existingByName.get(newName);
        if (existing) {
          Object.assign(existing, properties);
        } else {
          const item = { name: newName, ...properties };
          existingByName.set(newName, item);
          backendIcons.custom_icons.push(item);
        }
      }
    }
  }

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
