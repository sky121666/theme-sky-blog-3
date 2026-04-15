export const systemCalendarWidgetManifest = {
  widgetId: 'system.calendar',
  title: '日历',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium'],
  sizeOverrides: { medium: { w: 4, h: 3 } },
  category: 'system',
  description: '当月概览与日期定位',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'static',
  loadWhen: 'desktop-visible'
};
