/**
 * Editor-only widget catalog expansion.
 */

import { flattenCategoryTree } from './index.js';
import { DESKTOP_WIDGET_CATALOG } from './catalog-core.js';

const SIZE_LABELS = { small: '小', medium: '中', large: '大', 'extra-large': '特大' };

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

export function buildWidgetCatalog(sources) {
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
