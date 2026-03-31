/**
 * 布局序列化 / 反序列化 / 合并 / theme-config 写入
 */

import { toPositiveInt, cloneJsonValue } from '../shared/utils.js';
import { serializeDesktopIconInstance } from '../icons/index.js';
import { desktopDebugWarn } from './debug.js';
import { DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION } from './debug.js';
import { normalizeWidgetInstance, serializeWidgetInstance } from './catalog.js';

export function readDesktopWidgetsBootstrap() {
  const bootstrap = window.__THEME_DESKTOP_PROTOCOL__?.widgets || window.__THEME_WIDGETS__;
  if (!bootstrap || typeof bootstrap !== 'object') {
    return {
      enabled: false,
      isHome: false,
      editEnabled: false,
      columns: 12,
      gap: 18,
      layoutVersion: 'v1',
      serverLayoutJson: '',
      themeName: 'theme-sky-blog-3',
      themeJsonConfigEndpoint: '',
      siteUrl: '',
      modules: {
        weather: {
          cityName: '北京',
          refreshMinutes: 30
        }
      },
      instances: [],
      sources: {
        siteProfile: {
          title: '',
          subtitle: '',
          logo: '',
          url: ''
        },
        latestPosts: [],
        popularPosts: [],
        categories: [],
        siteStats: null,
        randomTags: [],
        momentsAvailable: false,
        recentMoments: []
      }
    };
  }

  return bootstrap;
}

function normalizeDesktopLayoutPayload(layoutVersion, rawPayload) {
  if (!rawPayload) return null;

  if (Array.isArray(rawPayload)) {
    return {
      version: DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
      layoutVersion,
      columns: rawPayload.columns || null,
      instances: rawPayload,
      icons: []
    };
  }

  if (typeof rawPayload !== 'object') {
    return null;
  }

  if (Array.isArray(rawPayload.nodes)) {
    const instances = [];
    const icons = [];

    rawPayload.nodes.forEach((node) => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'icon') {
        icons.push({
          key: node.key,
          title: node.title,
          x: node.x,
          y: node.y
        });
        return;
      }

      if (node.kind === 'widget') {
        instances.push({
          key: node.key,
          title: node.title,
          widget: node.widget,
          size: node.size,
          x: node.x,
          y: node.y
        });
      }
    });

    return {
      version: rawPayload.version ?? DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
      layoutVersion: rawPayload.layoutVersion || layoutVersion,
      columns: rawPayload.columns || null,
      instances,
      icons
    };
  }

  return {
    version: rawPayload.version ?? DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
    layoutVersion: rawPayload.layoutVersion || layoutVersion,
    columns: rawPayload.columns || null,
    instances: Array.isArray(rawPayload.instances) ? rawPayload.instances : [],
    icons: Array.isArray(rawPayload.icons) ? rawPayload.icons : []
  };
}

export function parseDesktopLayoutPayload(rawValue, layoutVersion, source = 'server') {
  if (!rawValue) return null;

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    const payload = normalizeDesktopLayoutPayload(layoutVersion, parsed);
    if (!payload) {
      return null;
    }

    if (payload.layoutVersion && payload.layoutVersion !== layoutVersion) {
      desktopDebugWarn(`ignored ${source} desktop layout`, {
        source,
        reason: 'layout-version-mismatch',
        expectedLayoutVersion: layoutVersion,
        receivedLayoutVersion: payload.layoutVersion
      });
      return null;
    }

    if (payload.version != null && payload.version !== DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION) {
      desktopDebugWarn(`ignored ${source} desktop layout`, {
        source,
        reason: 'schema-version-mismatch',
        expectedSchemaVersion: DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
        receivedSchemaVersion: payload.version
      });
      return null;
    }

    return payload;
  } catch (_error) {
    desktopDebugWarn(`ignored broken ${source} desktop layout JSON`, {
      source
    });
    return null;
  }
}

function buildDesktopWidgetLayoutPayload(layoutVersion, widgets, icons = [], columns = null) {
  return {
    version: DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
    layoutVersion,
    ...(columns ? { columns } : {}),
    instances: widgets
      .filter((widget) => !widget.hidden)
      .map((widget) => serializeWidgetInstance(widget)),
    icons: icons.map((icon) => serializeDesktopIconInstance(icon))
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

export function mergeDesktopWidgetLayout(defaultWidgets, savedLayout) {
  if (!savedLayout) return defaultWidgets;

  if (Array.isArray(savedLayout.instances)) {
    return savedLayout.instances.map((instance, index) => normalizeWidgetInstance(instance, index));
  }

  if (typeof savedLayout.placements === 'object' && savedLayout.placements) {
    return defaultWidgets.map((widget) => {
      const saved = savedLayout.placements[widget.key];
      if (!saved) return widget;

      return {
        ...widget,
        baseX: toPositiveInt(saved.x, widget.baseX ?? widget.x),
        baseY: toPositiveInt(saved.y, widget.baseY ?? widget.y),
        x: toPositiveInt(saved.x, widget.x),
        y: toPositiveInt(saved.y, widget.y),
        w: toPositiveInt(saved.w, widget.w),
        h: toPositiveInt(saved.h, widget.h),
        hidden: saved.hidden === true
      };
    });
  }

  return defaultWidgets;
}
