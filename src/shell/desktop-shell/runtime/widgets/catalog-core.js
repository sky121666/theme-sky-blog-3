/**
 * Widget core definitions and instance normalization.
 */

import { toPositiveInt } from '../shared/utils.js';
import { WIDGET_MANIFEST_MAP } from '../../../../widgets/registry.js';

export const DESKTOP_WIDGET_SIZE_MAP = {
  small: { w: 2, h: 2 },
  medium: { w: 4, h: 2 },
  large: { w: 4, h: 4 },
  'extra-large': { w: 4, h: 4 }
};

export const DESKTOP_WIDGET_APPEARANCE_OPTIONS = ['follow', 'light', 'dark'];

export const DESKTOP_WIDGET_CATALOG = Object.fromEntries(
  Object.values(WIDGET_MANIFEST_MAP).map((manifest) => [manifest.widgetId, {
    title: manifest.title,
    kicker: manifest.kicker || '',
    size: manifest.defaultSize,
    sizes: manifest.supportedSizes,
    sizeOverrides: manifest.sizeOverrides || {},
    category: manifest.category,
    description: manifest.description || '',
    hasConfig: manifest.hasConfig || false,
    configSchema: Array.isArray(manifest.configSchema)
      ? manifest.configSchema.map((field) => ({ ...field }))
      : [],
    configDefaults: (manifest.configDefaults && typeof manifest.configDefaults === 'object')
      ? { ...manifest.configDefaults }
      : {}
  }])
);

export function normalizeWidgetSize(size) {
  return DESKTOP_WIDGET_SIZE_MAP[size] ? size : 'medium';
}

export function normalizeWidgetAppearance(appearance) {
  return DESKTOP_WIDGET_APPEARANCE_OPTIONS.includes(appearance) ? appearance : 'follow';
}

export function isKnownWidgetType(widgetType) {
  return !!DESKTOP_WIDGET_CATALOG[String(widgetType || '')];
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
    hidden: node?.hidden === true,
    surface: node?.surface || 'desktop',
    order: Number.isFinite(Number(node?.order)) ? Number(node.order) : index + 1,
    meta: (node?.meta && typeof node.meta === 'object') ? { ...node.meta } : {}
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
    y: widget.baseY ?? widget.y,
    surface: widget.surface || 'desktop',
    order: Number.isFinite(Number(widget.order)) ? Number(widget.order) : undefined,
    meta: (widget.meta && typeof widget.meta === 'object') ? { ...widget.meta } : {}
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
    hidden: overrides.hidden === true,
    surface: overrides.surface || 'desktop',
    order: Number.isFinite(Number(overrides.order)) ? Number(overrides.order) : 0,
    meta: (overrides.meta && typeof overrides.meta === 'object') ? { ...overrides.meta } : {}
  };
}

export function getWidgetCatalogEntry(widgetType) {
  return DESKTOP_WIDGET_CATALOG[widgetType] || null;
}

export function generateWidgetTitle(widgetType) {
  return getWidgetCatalogEntry(widgetType)?.title || '未命名组件';
}
