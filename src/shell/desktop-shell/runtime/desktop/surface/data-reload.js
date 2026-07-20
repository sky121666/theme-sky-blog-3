/**
 * Finder-backed widgets receive their initial data from the server-rendered
 * desktop protocol. If an editor adds one that was absent from that initial
 * layout, a successful save must reload once so the new Finder data is present.
 */
const SERVER_DATA_WIDGET_TYPES = new Set([
  'halo.author_card',
  'halo.latest_posts',
  'halo.popular_posts',
  'halo.categories',
  'halo.site_stats',
  'halo.random_tags',
  'plugin-moments.recent',
  'plugin-bangumis.recent',
  'plugin-friends.recent',
  'plugin-docsme.quick',
  'plugin-photos.gallery',
  'plugin-steam.summary'
]);

function widgetTypeOf(instance) {
  return String(instance?.realNode?.widget || instance?.widget || '').trim();
}

export function serverLoadedWidgetTypes(serverLayout) {
  const instances = Array.isArray(serverLayout?.instances) ? serverLayout.instances : [];
  return Array.from(new Set(instances.map(widgetTypeOf).filter(Boolean)));
}

export function desktopLayoutNeedsDataReload(widgets, initiallyLoadedTypes = []) {
  const loadedTypes = new Set(Array.from(initiallyLoadedTypes || [], (value) => String(value || '').trim()));
  return (Array.isArray(widgets) ? widgets : []).some((widget) => {
    if (!widget || widget.hidden === true) return false;
    const widgetType = widgetTypeOf(widget);
    return SERVER_DATA_WIDGET_TYPES.has(widgetType) && !loadedTypes.has(widgetType);
  });
}
