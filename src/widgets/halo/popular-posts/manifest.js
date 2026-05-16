export const haloPopularPostsWidgetManifest = {
  widgetId: 'halo.popular_posts',
  title: '热门文章',
  kicker: 'Halo',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'halo',
  description: '按浏览量排序的高热内容',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'limit',
      type: 'number',
      label: '显示数量',
      min: 1,
      max: 8,
      step: 1,
      defaultValue: 3
    },
    {
      key: 'showSummary',
      type: 'toggle',
      label: '显示摘要',
      defaultValue: false
    }
  ],
  configDefaults: {
    limit: 3,
    showSummary: false
  }
};
