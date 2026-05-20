export const pluginDocsmeQuickWidgetManifest = {
  widgetId: 'plugin-docsme.quick',
  title: '文档',
  kicker: 'Docsme',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'plugin',
  description: '文档项目与知识库入口',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    {
      key: 'projectTitle',
      type: 'select',
      label: '指定文档项目 (仅2x2生效)',
      optionsSource: 'docsme-projects',
      emptyLabel: '默认首个项目',
      defaultValue: ''
    }
  ],
  configDefaults: {
    projectTitle: ''
  }
};
