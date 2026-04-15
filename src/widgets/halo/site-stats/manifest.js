export const haloSiteStatsWidgetManifest = {
  widgetId: 'halo.site_stats',
  title: '站点统计',
  kicker: 'Halo',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium', 'large', 'extra-large'],
  sizeOverrides: {
    small: { w: 2, h: 2 },
    medium: { w: 2, h: 1 },
    large: { w: 2, h: 2 },
    'extra-large': { w: 2, h: 2 }
  },
  category: 'halo',
  description: '访问、文章和评论总览',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible'
};
