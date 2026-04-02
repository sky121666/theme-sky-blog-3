/**
 * 组件目录定义、实例规范化、创建与目录构建
 */

import { toPositiveInt } from '../shared/utils.js';
import { flattenCategoryTree } from './index.js';

export const DESKTOP_WIDGET_SIZE_MAP = {
  small: { w: 2, h: 2 },
  medium: { w: 4, h: 2 },
  large: { w: 4, h: 4 }
};

export const DESKTOP_WIDGET_APPEARANCE_OPTIONS = ['follow', 'light', 'dark'];

export const DESKTOP_WIDGET_CATALOG = {
  'system.clock': {
    title: '时间',
    kicker: '系统时间',
    size: 'small',
    sizes: ['small'],
    category: 'system',
    description: '当前时间与日期'
  },
  'system.calendar': {
    title: '日历',
    size: 'small',
    sizes: ['small', 'medium'],
    sizeOverrides: { medium: { w: 4, h: 3 } },
    category: 'system',
    description: '当月概览与日期定位'
  },
  'system.weather': {
    title: '天气',
    kicker: '天气',
    size: 'small',
    sizes: ['small', 'medium'],
    category: 'system',
    description: '固定城市天气与体感温度'
  },
  'halo.latest_posts': {
    title: '最新文章',
    kicker: 'Halo',
    size: 'medium',
    sizes: ['small', 'medium', 'large'],
    category: 'halo',
    description: '最新发布内容'
  },
  'halo.popular_posts': {
    title: '热门文章',
    kicker: 'Halo',
    size: 'medium',
    sizes: ['small', 'medium', 'large'],
    category: 'halo',
    description: '按浏览量排序的高热内容'
  },
  'halo.categories': {
    title: '文章分类',
    kicker: 'Halo',
    size: 'medium',
    sizes: ['medium'],
    category: 'halo',
    description: '分类目录与内容入口'
  },
  'halo.author_card': {
    title: '作者卡片',
    kicker: 'Halo',
    size: 'small',
    sizes: ['small', 'medium'],
    category: 'halo',
    description: '站点作者与发布概览'
  },
  'halo.site_stats': {
    title: '站点统计',
    kicker: 'Halo',
    size: 'small',
    sizes: ['small'],
    category: 'halo',
    description: '访问、文章和评论总览'
  },
  'halo.random_tags': {
    title: '随机标签',
    kicker: 'Halo',
    size: 'medium',
    sizes: ['small', 'medium'],
    category: 'halo',
    description: '按天稳定刷新的标签探索'
  },
  'plugin-moments.recent': {
    title: '瞬间',
    kicker: '瞬间',
    size: 'medium',
    sizes: ['medium', 'large'],
    category: 'plugin',
    description: '最新动态与媒体预览'
  }
};

/**
 * Widget center sidebar categories are built dynamically from the catalog.
 * 'all' is always first; then one entry per unique widget type.
 */
export function buildWidgetCenterCategories(catalog) {
  const seen = new Set();
  const items = [{ id: 'all', label: '所有小组件' }];
  for (const entry of catalog) {
    if (seen.has(entry.widget)) continue;
    seen.add(entry.widget);
    items.push({ id: entry.widget, label: entry.title });
  }
  return items;
}

export function normalizeWidgetSize(size) {
  return DESKTOP_WIDGET_SIZE_MAP[size] ? size : 'medium';
}

export function normalizeWidgetAppearance(appearance) {
  return DESKTOP_WIDGET_APPEARANCE_OPTIONS.includes(appearance) ? appearance : 'follow';
}

export function normalizeWidgetInstance(instance, index = 0) {
  const node = instance?.realNode && typeof instance.realNode === 'object'
    ? instance.realNode
    : instance;
  const catalog = DESKTOP_WIDGET_CATALOG[node?.widget] || {};
  const size = normalizeWidgetSize(node?.size);
  const span = catalog.sizeOverrides?.[size] || DESKTOP_WIDGET_SIZE_MAP[size];

  return {
    key: node?.key || `widget-${index + 1}`,
    title: node?.title || catalog.title || '未命名组件',
    widget: node?.widget || 'system.clock',
    size,
    appearance: normalizeWidgetAppearance(node?.appearance),
    baseX: toPositiveInt(node?.baseX ?? node?.x ?? node?.col, 1),
    baseY: toPositiveInt(node?.baseY ?? node?.y ?? node?.row, 1),
    x: toPositiveInt(node?.x ?? node?.baseX ?? node?.col, 1),
    y: toPositiveInt(node?.y ?? node?.baseY ?? node?.row, 1),
    w: span.w,
    h: span.h,
    hidden: node?.hidden === true
  };
}

export function serializeWidgetInstance(widget) {
  return {
    key: widget.key,
    title: widget.title,
    widget: widget.widget,
    size: widget.size,
    appearance: normalizeWidgetAppearance(widget.appearance),
    x: widget.baseX ?? widget.x,
    y: widget.baseY ?? widget.y
  };
}

export function createWidgetInstance(widgetType, overrides = {}) {
  const catalog = DESKTOP_WIDGET_CATALOG[widgetType] || {};
  const size = normalizeWidgetSize(overrides.size || catalog.size || 'medium');
  const span = catalog.sizeOverrides?.[size] || DESKTOP_WIDGET_SIZE_MAP[size];

  return {
    key: overrides.key || `${widgetType.replace(/[^\w-]+/g, '-')}-${Date.now()}`,
    title: overrides.title || catalog.title || '未命名组件',
    widget: widgetType,
    size,
    appearance: normalizeWidgetAppearance(overrides.appearance),
    baseX: toPositiveInt(overrides.baseX ?? overrides.x, 1),
    baseY: toPositiveInt(overrides.baseY ?? overrides.y, 1),
    x: toPositiveInt(overrides.x, 1),
    y: toPositiveInt(overrides.y, 1),
    w: span.w,
    h: span.h,
    hidden: overrides.hidden === true
  };
}

export function getWidgetCatalogEntry(widgetType) {
  return DESKTOP_WIDGET_CATALOG[widgetType] || null;
}

export function generateWidgetTitle(widgetType) {
  return getWidgetCatalogEntry(widgetType)?.title || '未命名组件';
}

const SIZE_LABELS = { small: '小', medium: '中', large: '大' };

export function buildWidgetCatalog(sources, modules) {
  const types = [
    'system.clock',
    'system.calendar',
    'system.weather',
    'halo.latest_posts',
    'halo.popular_posts',
    'halo.random_tags'
  ];

  if (Array.isArray(sources?.categories) && flattenCategoryTree(sources.categories).length) {
    types.push('halo.categories');
  }

  types.push('halo.author_card', 'halo.site_stats');

  if (sources?.momentsAvailable) {
    types.push('plugin-moments.recent');
  }

  const expanded = [];
  for (const widgetType of types) {
    const def = DESKTOP_WIDGET_CATALOG[widgetType];
    if (!def) continue;
    const sizes = def.sizes || [def.size || 'medium'];
    for (const size of sizes) {
      expanded.push({
        ...def,
        widget: widgetType,
        size,
        catalogKey: `${widgetType}:${size}`,
        sizeLabel: SIZE_LABELS[size] || size
      });
    }
  }

  return expanded;
}
