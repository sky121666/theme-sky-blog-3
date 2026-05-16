export const haloLatestPostsWidgetManifest = {
  widgetId: 'halo.latest_posts',
  title: '最新文章',
  kicker: 'Halo',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'halo',
  description: '最新发布内容',
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
    },
    {
      key: 'categoryName',
      type: 'select',
      label: '筛选分类',
      optionsSource: 'categories',
      emptyLabel: '全部分类',
      defaultValue: ''
    }
  ],
  configDefaults: {
    limit: 3,
    showSummary: false,
    categoryName: ''
  }
};
