// Frontend field registry. settings.yaml remains the persisted Halo contract;
// verify-settings-schema.test.mjs checks that every path and constraint agrees.
export const SETTINGS_PANES = Object.freeze([
  { id: 'appearance', label: '外观', detail: '选择外观模式与桌面配色', keywords: ['主题', '深色', '浅色', '强调色', '文件夹'], icon: 'icon-[lucide--palette]', color: 'purple', group: 'personalization' },
  { id: 'wallpaper', label: '墙纸', detail: '设置桌面的背景图片或颜色', keywords: ['壁纸', '背景', '图片', '纯色'], icon: 'icon-[lucide--image]', color: 'blue', group: 'personalization' },
  { id: 'desktop-dock', label: 'Dock', detail: '管理 Dock 快捷入口与外观', keywords: ['程序坞', '图标', '快捷入口', '系统设置', '放大'], icon: 'icon-[lucide--panel-bottom]', color: 'blue', group: 'personalization' },
  { id: 'menu-control', label: '菜单栏', detail: '设置品牌标识、工具按钮与时间', keywords: ['顶栏', '品牌', '搜索', '登录', '时间', '控制中心'], icon: 'icon-[lucide--panel-top]', color: 'gray', group: 'desktop' },
  { id: 'navigation', label: '导航菜单', detail: '选择菜单栏使用的后台菜单', keywords: ['导航', '菜单来源'], icon: 'icon-[lucide--navigation]', color: 'blue', group: 'desktop' },
  { id: 'widgets', label: '小组件', detail: '管理桌面小组件、图标与布局', keywords: ['组件', '天气', '城市', '封面', '桌面', '分类', '标签', '文章', '单页', '布局'], icon: 'icon-[lucide--layout-grid]', color: 'green', group: 'desktop' },
  { id: 'notifications', label: '通知中心', detail: '设置通知中心名称与展开方式', keywords: ['侧边栏', '通知', '访客'], icon: 'icon-[lucide--bell]', color: 'red', group: 'desktop' },
  { id: 'startup', label: '首屏加载', detail: '选择首屏显示方式与开机效果', keywords: ['首屏', '加载', '开机', '动画', '启动'], icon: 'icon-[lucide--power]', color: 'gray', group: 'system' },
  { id: 'apps', label: '应用', detail: '自定义瞬间、书影音、友链和装备页面', keywords: ['瞬间', '豆瓣', '书影音', '友链', 'Steam', '装备'], icon: 'icon-[lucide--app-window]', color: 'orange', group: 'system' },
  { id: 'advanced', label: '高级', detail: '管理调试选项', keywords: ['调试', '日志'], icon: 'icon-[lucide--settings-2]', color: 'gray', group: 'system' }
].map(Object.freeze));

const options = (entries) => entries.map(([value, label]) => Object.freeze({ value, label }));
const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
const TIME_OPTIONS = options([
  ['time-only', '仅时间'], ['time-seconds', '时间含秒'], ['date-time', '日期 + 时间'],
  ['weekday-date-time', '星期 + 日期 + 时间'], ['month-day-weekday-time', '月日 + 星期 + 时间']
]);
const field = (path, pane, label, type, defaultValue, extra = {}) => Object.freeze({
  path, pane, label, type, default: defaultValue, writable: true, ...extra
});

export const SETTINGS_FIELDS = Object.freeze([
  field('navigation.header.menu_name', 'navigation', '菜单栏导航', 'menu', '', { source: 'menus' }),
  field('navigation.dock.menu_name', 'desktop-dock', 'Dock 快捷入口', 'menu', '', { source: 'menus' }),
  field('header.logo.icon', 'menu-control', '应用图标', 'icon', ''),
  field('header.logo.title', 'menu-control', '应用名称', 'text', ''),
  field('header.theme.enable_frontend_setting', 'appearance', '允许访客切换', 'boolean', true),
  field('header.theme.default_mode', 'appearance', '默认状态', 'select', 'system', {
    options: options([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])
  }),
  field('header.actions.search_enabled', 'menu-control', '搜索', 'boolean', true),
  field('header.actions.auth_enabled', 'menu-control', '登录', 'boolean', true),
  field('header.actions.mobile_menu_enabled', 'menu-control', '启用手机端菜单', 'boolean', true),
  field('header.time.enabled', 'menu-control', '显示时间', 'boolean', true),
  field('header.time.desktop_preset', 'menu-control', '桌面端时间格式', 'select', 'month-day-weekday-time', { options: TIME_OPTIONS }),
  field('header.time.mobile_preset', 'menu-control', '手机端时间格式', 'select', 'time-only', { options: TIME_OPTIONS }),
  field('header.time.hour_cycle', 'menu-control', '小时制', 'select', 12, { options: options([[12, '12 小时'], [24, '24 小时']]) }),
  field('header.auth.login_label', 'menu-control', '登录文案', 'text', '登录'),
  field('header.icons.mobile_menu', 'menu-control', '菜单按钮', 'icon', ''),
  field('header.icons.search', 'menu-control', '搜索按钮', 'icon', ''),
  field('header.icons.auth', 'menu-control', '登录按钮', 'icon', ''),
  field('header.icons.theme_light', 'menu-control', '浅色模式', 'icon', ''),
  field('header.icons.theme_dark', 'menu-control', '深色模式', 'icon', ''),
  field('header.dropdown.light_bg', 'menu-control', '二级菜单浅色背景', 'css-color', 'rgba(88, 92, 100, 0.66)'),
  field('header.dropdown.dark_bg', 'menu-control', '二级菜单深色背景', 'css-color', 'rgba(70, 74, 82, 0.72)'),
  field('desktop.appearance.mode', 'appearance', '配色模式', 'select', 'preset', { options: options([['preset', '内置'], ['custom', '自定义']]) }),
  field('desktop.appearance.preset', 'appearance', '内置配色', 'select', 'blue', { options: options([
    ['blue', '海蓝'], ['purple', '紫藤'], ['pink', '玫粉'], ['red', '樱红'],
    ['orange', '琥珀'], ['yellow', '麦黄'], ['green', '森绿'], ['graphite', '石墨']
  ]) }),
  field('desktop.appearance.accent_color', 'appearance', '全局强调色', 'color', '#2E5FBD'),
  field('desktop.appearance.selection_color', 'appearance', '选中态颜色', 'color', '#244D9B'),
  field('desktop.appearance.folder_color1', 'appearance', '文件夹主色调', 'color', '#4A90E2'),
  field('desktop.appearance.folder_color2', 'appearance', '文件夹阴影层', 'color', '#64B5F6'),
  field('desktop.appearance.folder_color3', 'appearance', '文件夹亮部层', 'color', '#90CAF9'),
  field('desktop.background.mode', 'wallpaper', '背景模式', 'select', 'preset', { options: options([['preset', '内置'], ['solid', '纯色'], ['image', '上传']]) }),
  field('desktop.background.preset', 'wallpaper', '内置背景', 'select', 'tahoe-dawn', { options: options([
    ['tahoe-dawn', '晨雾'], ['tahoe-blue', '湖蓝'], ['sequoia-mist', '松雾'], ['graphite-night', '石墨夜'],
    ['sonoma-sunset', '霞粉'], ['aurora-mint', '薄荷'], ['alpine-lilac', '淡紫'], ['coral-haze', '珊瑚'],
    ['arctic-pearl', '银霜'], ['midnight-indigo', '靛夜'], ['golden-amber', '金砂'], ['deep-sea', '深海']
  ]) }),
  field('desktop.background.image_url', 'wallpaper', '桌面背景图', 'image', '', { accepts: [...IMAGE_TYPES, 'image/gif', 'image/svg+xml'] }),
  field('desktop.background.solid_color', 'wallpaper', '桌面纯色', 'color', '#0f172a'),
  field('desktop.startup.mode', 'startup', '启动方式', 'select', 'direct', { options: options([['direct', '普通显示'], ['boot', '开机启动']]) }),
  field('desktop.startup.frequency', 'startup', '播放频率', 'select', 'tab_once', { options: options([['tab_once', '每个标签页首次'], ['every_reload', '首次及每次主动刷新']]) }),
  field('desktop.startup.logo_mode', 'startup', '启动标识', 'select', 'apple', { options: options([['apple', '苹果标识'], ['site', '站点标识'], ['custom', '自定义图片']]) }),
  field('desktop.startup.logo_url', 'startup', '自定义启动图片', 'image', '', { accepts: IMAGE_TYPES }),
  field('desktop.icons.custom_icons', 'widgets', '自定义桌面图标', 'custom-icons', []),
  field('desktop.icons.categories', 'widgets', '桌面分类', 'content-list', [], { source: 'categories' }),
  field('desktop.icons.tags', 'widgets', '桌面标签', 'content-list', [], { source: 'tags' }),
  field('desktop.icons.posts', 'widgets', '桌面文章', 'content-list', [], { source: 'posts' }),
  field('desktop.icons.single_pages', 'widgets', '桌面独立单页', 'content-list', [], { source: 'singlepages' }),
  field('widgets.behavior.enabled', 'widgets', '启用桌面小组件', 'boolean', true),
  field('widgets.behavior.hide_on_mobile', 'widgets', '手机端不显示小组件', 'boolean', false),
  field('widgets.behavior.edit_enabled', 'widgets', '允许编辑布局', 'boolean', true),
  field('widgets.behavior.fallback_cover', 'widgets', '组件回退封面', 'image', '', { accepts: IMAGE_TYPES }),
  field('widgets.modules.weather.city_name', 'widgets', '默认城市', 'text', '北京'),
  field('widgets.modules.weather.refresh_minutes', 'widgets', '天气刷新间隔（分钟）', 'number', 30, { min: 10, max: 180 }),
  field('sidebar.notification_center.title', 'notifications', '通知中心名称', 'text', '通知中心'),
  field('sidebar.notification_center.guest_title', 'notifications', '未登录名称', 'text', '小组件'),
  field('sidebar.notification_center.default_open', 'notifications', '默认展开', 'boolean', false),
  field('dock.appearance.settings_enabled', 'desktop-dock', '显示系统设置', 'boolean', true),
  field('dock.appearance.show_labels', 'desktop-dock', '显示名称标签', 'boolean', true),
  field('dock.appearance.magnification', 'desktop-dock', '启用放大效果', 'boolean', true),
  field('dock.appearance.icon_size', 'desktop-dock', '图标大小', 'number', 48, { min: 36, max: 64, step: 2 }),
  field('dock.appearance.icon_gap', 'desktop-dock', '图标间距', 'number', 4, { min: 2, max: 12, step: 1 }),
  field('dock.appearance.dock_padding', 'desktop-dock', '内边距', 'number', 6, { min: 4, max: 16, step: 1 }),
  field('dock.appearance.magnification_scale', 'desktop-dock', '放大倍率', 'number', 1.4, { min: 1, max: 2, step: 0.1 }),
  field('dock.appearance.glass_blur', 'desktop-dock', '背景模糊', 'number', 60, { min: 20, max: 100, step: 5 }),
  field('dock.appearance.glass_opacity', 'desktop-dock', '背景透明度', 'number', 28, { min: 10, max: 80, step: 2 }),
  field('moments.cover.image_url', 'apps', '瞬间封面图片', 'image', '', { accepts: IMAGE_TYPES, app: 'moments' }),
  field('moments.profile.display_name', 'apps', '瞬间封面名称', 'text', '', { app: 'moments' }),
  field('moments.profile.subtitle', 'apps', '瞬间封面副标题', 'text', '', { app: 'moments' }),
  field('moments.style.color_mode', 'apps', '瞬间配色模式', 'select', 'wechat', { app: 'moments', options: options([['wechat', '微信风格'], ['theme', '跟随主题']]) }),
  field('moments.publish.enabled', 'apps', '启用瞬间前端发布', 'boolean', true, { app: 'moments' }),
  field('moments.publish.image_upload', 'apps', '瞬间图片上传', 'boolean', true, { app: 'moments' }),
  field('moments.publish.video_upload', 'apps', '瞬间视频上传', 'boolean', true, { app: 'moments' }),
  field('moments.publish.audio_upload', 'apps', '瞬间音频上传', 'boolean', true, { app: 'moments' }),
  field('douban.profile.icon', 'apps', '书影音图标', 'icon', '', { app: 'douban' }),
  field('douban.profile.display_name', 'apps', '书影音标题', 'text', '', { app: 'douban' }),
  field('douban.profile.subtitle', 'apps', '书影音说明', 'textarea', '', { app: 'douban' }),
  field('douban.style.color_mode', 'apps', '书影音配色模式', 'select', 'douban', { app: 'douban', options: options([['douban', '豆瓣绿'], ['theme', '跟随主题']]) }),
  field('links.profile.display_name', 'apps', '全部友链标题', 'text', '', { app: 'links' }),
  field('steam.cover.image_url', 'apps', 'Steam 背景图片', 'image', '', { accepts: IMAGE_TYPES, app: 'steam' }),
  field('equipments.profile.display_name', 'apps', '全部装备标题', 'text', '', { app: 'equipments' }),
  field('equipments.profile.subtitle', 'apps', '全部装备描述', 'textarea', '', { app: 'equipments' }),
  field('default_layout.layout_json', 'widgets', '默认桌面布局', 'external-editor', '', { editor: 'desktop-layout', writable: false }),
  field('developer.debug_mode', 'advanced', '调试模式', 'boolean', false)
]);
