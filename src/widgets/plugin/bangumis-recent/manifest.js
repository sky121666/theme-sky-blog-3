export const pluginBangumisRecentWidgetManifest = {
  widgetId: 'plugin-bangumis.recent',
  title: '追番',
  kicker: 'Bangumi',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'plugin',
  description: '最近追番追剧状态',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'typeNum',
      type: 'select',
      label: '类型',
      options: [
        { value: '', label: '自动' },
        { value: '1', label: '追番' },
        { value: '2', label: '追剧' }
      ],
      defaultValue: ''
    },
    {
      key: 'status',
      type: 'select',
      label: '状态',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'watching', label: '在看' },
        { value: 'wish', label: '想看' },
        { value: 'done', label: '已看' }
      ],
      defaultValue: 'auto'
    }
  ],
  configDefaults: {
    typeNum: '',
    status: 'auto'
  }
};
