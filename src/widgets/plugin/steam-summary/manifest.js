export const pluginSteamSummaryWidgetManifest = {
  widgetId: 'plugin-steam.summary',
  title: 'Steam',
  kicker: 'Steam',
  defaultSize: 'medium',
  supportedSizes: ['medium'],
  category: 'plugin',
  description: '展示 Steam 玩家状态和资料摘要',
  appearanceSupport: ['dark'],
  cachePolicy: 'static',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'showStats',
      type: 'toggle',
      label: '显示统计',
      defaultValue: true
    },
    {
      key: 'showRecentGame',
      type: 'toggle',
      label: '显示最近游戏',
      defaultValue: true
    }
  ],
  configDefaults: {
    showStats: true,
    showRecentGame: true
  }
};
