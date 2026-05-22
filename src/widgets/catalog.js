import { flattenCategoryTree } from './shared/data.js';
import { getWidgetManifest, getWidgetManifests } from './registry.js';

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
  const types = getWidgetManifests()
    .map((manifest) => manifest.widgetId)
    .filter((widgetId) => {
      if (widgetId === 'halo.categories') {
        return Array.isArray(sources?.categories) && flattenCategoryTree(sources.categories).length > 0;
      }
      if (widgetId === 'plugin-moments.recent') {
        return !!sources?.momentsAvailable;
      }
      if (widgetId === 'plugin-bangumis.recent') {
        return !!sources?.bangumisAvailable;
      }
      if (widgetId === 'plugin-friends.recent') {
        return !!sources?.friendsAvailable;
      }
      if (widgetId === 'plugin-docsme.quick') {
        return !!sources?.docsmeAvailable;
      }
      if (widgetId === 'plugin-douban.showcase') {
        return !!sources?.doubanAvailable;
      }
      return true;
    });

  const expanded = [];
  for (const widgetType of types) {
    const manifest = getWidgetManifest(widgetType);
    if (!manifest) continue;
    const sizes = manifest.supportedSizes || [manifest.defaultSize || 'medium'];
    for (const size of sizes) {
      expanded.push({
        title: manifest.title,
        kicker: manifest.kicker || '',
        size,
        sizes: manifest.supportedSizes,
        sizeOverrides: manifest.sizeOverrides || {},
        category: manifest.category,
        description: manifest.description || '',
        widget: widgetType,
        catalogKey: `${widgetType}:${size}`,
        sizeLabel: SIZE_LABELS[size] || size
      });
    }
  }

  return expanded;
}
