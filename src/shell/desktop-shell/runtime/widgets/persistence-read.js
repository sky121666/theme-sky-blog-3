/**
 * Bootstrap and read-path desktop layout helpers.
 */

import { toPositiveInt } from '../shared/utils.js';
import { desktopDebugWarn, DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION } from './debug-core.js';
import { normalizeWidgetInstance } from './catalog-core.js';

export function readDesktopWidgetsBootstrap() {
  const bootstrap = window.__THEME_DESKTOP_PROTOCOL__?.widgets || window.__THEME_WIDGETS__;
  if (!bootstrap || typeof bootstrap !== 'object') {
    return {
      enabled: false,
      isHome: false,
      hideOnMobile: false,
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
        recentMoments: [],
        photosAvailable: false,
        photos: [],
        photoGroups: [],
        photosUrl: '/photos'
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
          appearance: node.appearance,
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
