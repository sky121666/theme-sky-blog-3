export const haloAuthorCardWidgetManifest = {
  widgetId: 'halo.author_card',
  title: '作者卡片',
  kicker: 'Halo',
  defaultSize: 'small',
  supportedSizes: ['small'],
  sizeOverrides: { small: { w: 2, h: 1 } },
  category: 'halo',
  description: '站点作者与快捷入口',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible'
};
