/** Fixed theme-owned source selections; request parameters never name a Finder. */
export const FINDER_WIDGET_SOURCES = Object.freeze({
  'halo.latest_posts': '',
  'halo.popular_posts': '',
  'halo.categories': '',
  'halo.site_stats': '',
  'plugin-moments.recent': 'momentsAvailable',
  'plugin-links.feed': 'friendsAvailable',
  'plugin-docsme.quick': 'docsmeAvailable',
  'plugin-photos.gallery': 'photosAvailable',
  'plugin-steam.summary': 'steamAvailable'
});

export function widgetNeedsFinderData(widget, sources = {}) {
  const type = widget?.widget;
  if (!Object.hasOwn(FINDER_WIDGET_SOURCES, type)) return false;
  const availability = FINDER_WIDGET_SOURCES[type];
  if (availability && sources[availability] === false) return false;
  // Category selection already owns a bounded category-specific post read.
  if (type === 'halo.latest_posts' && String(widget?.meta?.categoryName || '').trim()) return false;
  if (type === 'plugin-photos.gallery') {
    const group = String(widget?.meta?.groupName || '').trim();
    if (group && sources.photoGroups?.some?.((item) => item?.metadata?.name === group && Array.isArray(item.photos))) return false;
    if (group !== String(sources.photoGroupName || '')) return true;
  }
  return sources.loaded?.[type] !== true;
}
