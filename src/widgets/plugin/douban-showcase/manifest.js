export const pluginDoubanShowcaseWidgetManifest = {
  widgetId: 'plugin-douban.showcase',
  title: '书影音',
  kicker: 'Douban',
  defaultSize: 'large',
  supportedSizes: ['large'],
  category: 'plugin',
  description: '展示豆瓣书影音收藏精选',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'type',
      type: 'select',
      label: '类型',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'movie', label: '电影' },
        { value: 'book', label: '图书' },
        { value: 'music', label: '音乐' },
        { value: 'game', label: '游戏' },
        { value: 'drama', label: '舞台剧' }
      ],
      defaultValue: 'auto'
    },
    {
      key: 'status',
      type: 'select',
      label: '状态',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'all', label: '全部' },
        { value: 'mark', label: '计划收藏' },
        { value: 'doing', label: '进行中' },
        { value: 'done', label: '已完成' }
      ],
      defaultValue: 'auto'
    }
  ],
  configDefaults: {
    type: 'auto',
    status: 'auto'
  }
};
