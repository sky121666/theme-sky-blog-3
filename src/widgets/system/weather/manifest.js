export const systemWeatherWidgetManifest = {
  widgetId: 'system.weather',
  title: '天气',
  kicker: '天气',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium'],
  category: 'system',
  description: '固定城市天气与体感温度',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'cityName',
      type: 'text',
      label: '城市名称',
      placeholder: '留空时跟随后台默认城市',
      defaultValue: ''
    },
    {
      key: 'refreshMinutes',
      type: 'number',
      label: '刷新间隔（分钟）',
      min: 10,
      max: 240,
      step: 5,
      defaultValue: 30
    }
  ],
  configDefaults: {
    cityName: '',
    refreshMinutes: 30
  }
};
