const WIDGET_RENDERER_LOADERS = {
  'system.clock': () => import('./system/clock/render.js'),
  'system.calendar': () => import('./system/calendar/render.js'),
  'system.weather': () => import('./system/weather/render.js'),
  'halo.latest_posts': () => import('./halo/latest-posts/render.js'),
  'halo.popular_posts': () => import('./halo/popular-posts/render.js'),
  'halo.categories': () => import('./halo/categories/render.js'),
  'halo.author_card': () => import('./halo/author-card/render.js'),
  'halo.identity_card': () => import('./halo/identity-card/render.js'),
  'halo.site_stats': () => import('./halo/site-stats/render.js'),
  'halo.random_tags': () => import('./halo/random-tags/render.js'),
  'plugin-moments.recent': () => import('./plugin/moments-recent/render.js'),
  'plugin-photos.gallery': () => import('./plugin/photos/render.js')
};

export function getWidgetRendererLoader(widgetId) {
  return WIDGET_RENDERER_LOADERS[widgetId] || null;
}

export async function loadWidgetRenderer(widgetId) {
  const loader = getWidgetRendererLoader(widgetId);
  if (!loader) return null;
  const mod = await loader();
  return typeof mod?.renderWidget === 'function' ? mod.renderWidget : null;
}
