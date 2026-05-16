export const pluginPhotosWidgetManifest = {
  widgetId: 'plugin-photos.gallery',
  title: '图库',
  kicker: '图库',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'plugin',
  description: '展示图库照片精选',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'groupName',
      type: 'photo-group',
      label: '显示精选集',
      required: true
    }
  ],
  configDefaults: {}
};
