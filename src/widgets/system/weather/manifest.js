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
  loadWhen: 'desktop-visible'
};
