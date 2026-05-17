export const pluginMomentsRecentWidgetManifest = {
  widgetId: 'plugin-moments.recent',
  title: '瞬间',
  kicker: '瞬间',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'plugin',
  description: '最新动态与媒体预览',
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
      max: 3,
      step: 1,
      defaultValue: 1
    },
    {
      key: 'showMedia',
      type: 'toggle',
      label: '显示媒体预览',
      defaultValue: true
    }
  ],
  configDefaults: {
    limit: 1,
    showMedia: true
  }
};
