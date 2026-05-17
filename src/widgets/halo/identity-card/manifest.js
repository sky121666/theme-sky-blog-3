export const haloIdentityCardWidgetManifest = {
  widgetId: 'halo.identity_card',
  title: '身份状态',
  kicker: 'Halo',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'halo',
  description: '作者身份与当前状态',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    { key: 'showSteam', type: 'toggle', label: '显示 Steam 状态', defaultValue: true },
    { key: 'showMoments', type: 'toggle', label: '显示瞬间状态', defaultValue: true },
    { key: 'showPosts', type: 'toggle', label: '显示文章状态', defaultValue: true },
    { key: 'showPhotos', type: 'toggle', label: '显示图库状态', defaultValue: true }
  ],
  configDefaults: {
    showSteam: true,
    showMoments: true,
    showPosts: true,
    showPhotos: true
  }
};
