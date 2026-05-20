export const haloCategoriesWidgetManifest = {
  widgetId: 'halo.categories',
  title: '文章分类',
  kicker: 'Halo',
  defaultSize: 'medium',
  supportedSizes: ['medium'],
  category: 'halo',
  description: '分类目录与内容入口',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'categoryNames',
      type: 'category-list',
      label: '显示分类',
      optionsSource: 'categories',
      emptyLabel: '未选择时自动展示热门分类',
      maxItems: 4,
      defaultValue: []
    }
  ],
  configDefaults: {
    categoryNames: []
  }
};
