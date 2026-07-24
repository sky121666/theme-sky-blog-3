import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const core = await import(pathToFileURL(
  path.join(root, 'src/shell/desktop-shell/runtime/desktop/theme-settings-core.js')
).href);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const sourceConfig = {
  header: {
    logo: {
      title: 'Sky Desktop'
    },
    theme: {
      enable_frontend_setting: false,
      default_mode: 'dark'
    },
    actions: {
      search_enabled: false,
      auth_enabled: true,
      mobile_menu_enabled: false
    },
    time: {
      enabled: true,
      desktop_preset: 'date-time',
      mobile_preset: 'time-only',
      hour_cycle: 24
    },
    auth: {
      login_label: '账户'
    },
    dropdown: {
      light_bg: 'rgba(80, 82, 88, 0.64)',
      dark_bg: '#222326'
    }
  },
  desktop: {
    appearance: {
      mode: 'preset',
      preset: 'green',
      accent_color: '#123456'
    },
    background: {
      mode: 'preset',
      preset: 'deep-sea',
      solid_color: '#112233',
      image_url: 'https://example.com/wallpaper.webp'
    },
    icons: {
      posts: ['post-a']
    }
  },
  dock: {
    appearance: {
      show_labels: 'true',
      magnification: true,
      icon_size: '46',
      icon_gap: '12',
      dock_padding: '10',
      magnification_scale: '1.4',
      glass_blur: '100',
      glass_opacity: '10'
    }
  },
  widgets: {
    behavior: {
      enabled: true,
      hide_on_mobile: false,
      edit_enabled: true,
      fallback_cover: 'https://example.com/fallback.webp',
      grid_columns: 16
    },
    modules: {
      weather: {
        city_name: '张家港',
        refresh_minutes: '30',
        mode: 'city'
      },
      latest_posts: {
        limit: 5
      }
    }
  },
  sidebar: {
    notification_center: {
      title: '消息中心',
      guest_title: '桌面组件',
      default_open: true
    }
  },
  developer: {
    debug_mode: true
  }
};

const draft = core.buildThemeSettingsDraft(sourceConfig);
assert(draft.header.logo.title === 'Sky Desktop', '应读取 header.logo.title');
assert(draft.header.theme.default_mode === 'dark', '应读取 header.theme.default_mode');
assert(draft.header.theme.enable_frontend_setting === false, '应读取访客切换开关');
assert(draft.header.actions.search_enabled === false, '应读取搜索入口开关');
assert(draft.header.actions.mobile_menu_enabled === false, '应读取手机菜单开关');
assert(draft.header.time.desktop_preset === 'date-time', '应读取桌面时间格式');
assert(draft.header.time.hour_cycle === 24, '应读取小时制');
assert(draft.header.auth.login_label === '账户', '应读取登录文案');
assert(draft.header.dropdown.dark_bg === '#222326', '应读取并规范化二级菜单颜色');
assert(draft.desktop.appearance.preset === 'green', '应读取桌面配色预设');
assert(draft.desktop.background.preset === 'deep-sea', '应读取桌面背景预设');
assert(draft.desktop.background.image_url === 'https://example.com/wallpaper.webp', '应保留只读背景图片');
assert(draft.dock.appearance.icon_size === 46, 'Dock 数字字符串应规范化为数字');
assert(draft.widgets.modules.weather.refresh_minutes === 30, '天气刷新间隔应规范化为数字');
assert(draft.widgets.behavior.fallback_cover === 'https://example.com/fallback.webp', '应保留只读回退封面');
assert(draft.sidebar.notification_center.title === '消息中心', '应读取通知中心标题');
assert(draft.sidebar.notification_center.default_open === true, '应读取通知中心默认展开状态');
const clearedTitleDraft = core.updateThemeSettingsDraft(draft, 'header.logo.title', '');
assert(clearedTitleDraft.header.logo.title === '', '应用名称必须允许清空并回退站点标题');

let updatedDraft = core.updateThemeSettingsDraft(draft, 'dock.appearance.icon_size', 64);
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'widgets.modules.weather.city_name', ' 杭州 ');
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'desktop.background.solid_color', '#abcdef');
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'header.logo.title', ' 5ee 桌面 ');
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'header.time.hour_cycle', '12');
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'header.dropdown.light_bg', 'rgba(20,30,40,0.5)');
updatedDraft = core.updateThemeSettingsDraft(updatedDraft, 'sidebar.notification_center.guest_title', '访客组件');
assert(updatedDraft.dock.appearance.icon_size === 64, '应更新 Dock 图标大小');
assert(updatedDraft.widgets.modules.weather.city_name === '杭州', '应清理城市文本空白');
assert(updatedDraft.desktop.background.solid_color === '#ABCDEF', '应规范化颜色值');
assert(updatedDraft.header.logo.title === '5ee 桌面', '应清理应用名称空白');
assert(updatedDraft.header.time.hour_cycle === 12, '小时制应规范化为数字');
assert(updatedDraft.header.dropdown.light_bg === 'rgba(20, 30, 40, 0.5)', '应规范化菜单背景颜色');
assert(updatedDraft.sidebar.notification_center.guest_title === '访客组件', '应更新访客通知标题');

let rejected = false;
try {
  core.updateThemeSettingsDraft(updatedDraft, 'developer.debug_mode', false);
} catch (_error) {
  rejected = true;
}
assert(rejected, '不得更新白名单之外的主题字段');

const merged = core.applyThemeSettingsDraftToConfig(sourceConfig, updatedDraft, [
  'dock.appearance.icon_size',
  'widgets.modules.weather.city_name',
  'desktop.background.solid_color',
  'header.logo.title',
  'header.time.hour_cycle',
  'header.dropdown.light_bg',
  'sidebar.notification_center.guest_title',
  'developer.debug_mode'
]);
assert(merged.dock.appearance.icon_size === 64, '应合并 Dock 修改');
assert(merged.widgets.modules.weather.city_name === '杭州', '应合并天气城市修改');
assert(merged.desktop.background.solid_color === '#ABCDEF', '应合并背景颜色修改');
assert(merged.header.logo.title === '5ee 桌面', '应合并应用名称修改');
assert(merged.header.time.hour_cycle === 12, '应合并小时制修改');
assert(merged.header.dropdown.light_bg === 'rgba(20, 30, 40, 0.5)', '应合并菜单背景颜色修改');
assert(merged.sidebar.notification_center.guest_title === '访客组件', '应合并通知访客标题修改');
assert(merged.developer.debug_mode === true, '不得覆盖白名单外字段');
assert(merged.header.actions.search_enabled === false, '不得覆盖未修改的同组字段');
assert(merged.desktop.icons.posts[0] === 'post-a', '不得覆盖桌面内容选择');
assert(merged.widgets.behavior.grid_columns === 16, '不得覆盖小组件高级字段');
assert(merged.widgets.modules.latest_posts.limit === 5, '不得覆盖其他小组件模块');
assert(sourceConfig.dock.appearance.icon_size === '46', '合并过程不得修改原配置对象');

const wrappedConfig = {
  spec: {
    value: sourceConfig
  },
  metadata: {
    name: 'theme-sky-blog-3'
  }
};
const wrappedMerged = core.applyThemeSettingsDraftToConfig(wrappedConfig, updatedDraft, [
  'dock.appearance.icon_size'
]);
assert(wrappedMerged.spec.value.dock.appearance.icon_size === 64, '应兼容 spec.value 配置外壳');
assert(wrappedMerged.metadata.name === 'theme-sky-blog-3', '不得破坏配置外壳元数据');

const layoutTemplate = read('templates/modules/shell/layout.html');
const headerTemplate = read('templates/modules/shell/header.html');
const settingsTemplate = read('templates/modules/shell/theme-settings.html');
const settingsRuntime = read('src/shell/desktop-shell/runtime/desktop/theme-settings.js');
const settingsStyles = read('src/shell/desktop-shell/styles/desktop/theme-settings.css');
const dockStyles = read('src/shell/desktop-shell/styles/desktop/dock.css');
const windowManagerRuntime = read('src/shell/desktop-shell/runtime/desktop/window-manager.js');
const authStyles = read('src/entries/auth.css');
const shellRuntime = read('src/shell/desktop-shell/runtime/desktop/shell.js');

assert(layoutTemplate.includes('modules/shell/theme-settings :: window('), 'Shell 必须挂载系统设置窗口');
assert(layoutTemplate.includes('api.console.halo.run/v1alpha1/themes/{name}/json-config'), '必须使用 Halo 官方主题配置接口');
assert(headerTemplate.includes('menubar-control-center-btn'), '菜单栏右侧必须提供控制中心入口');
assert(headerTemplate.includes('$store.themeSettings.requestOpen()'), '控制中心按钮必须连接系统设置入口');
assert(headerTemplate.includes('icon-[lucide--settings]'), '系统设置入口必须使用清晰的齿轮图标');
assert(!/icon-\[lucide--toggle-(?:left|right)\]/.test(headerTemplate), '系统设置入口不得继续叠加开关图标');
assert(settingsTemplate.includes('data-theme-settings-protocol'), '系统设置模板必须声明权限与端点协议');
assert(settingsTemplate.includes('Halo 配置是唯一数据源'), '设置窗口必须明确唯一配置源');
assert(settingsTemplate.includes('theme-settings-sidebar-toggle'), '手机端必须提供侧栏展开按钮');
assert(settingsTemplate.includes('theme-settings-sidebar-backdrop'), '手机端侧栏必须提供可关闭遮罩');
assert(settingsTemplate.includes("activePane === 'menu-control'"), '系统设置必须提供菜单栏与控制中心页面');
assert(settingsTemplate.includes("activePane === 'notifications'"), '系统设置必须提供通知页面');
assert(settingsTemplate.includes("header.actions.search_enabled"), '菜单栏页面必须接入后台搜索开关');
assert(settingsTemplate.includes("sidebar.notification_center.default_open"), '通知页面必须接入默认展开设置');
assert(!settingsTemplate.includes('Dock 预览'), 'Dock 设置不得保留重复的静态预览块');
assert(!settingsTemplate.includes('theme-settings-dock-preview'), 'Dock 设置必须直接联动桌面 Dock');
assert(!settingsTemplate.includes('<small>显示与背景</small>'), '侧栏项目不得重复显示说明文本');
assert(!settingsTemplate.includes('<small>图标与显示</small>'), '侧栏项目不得重复显示说明文本');
assert(!settingsTemplate.includes('<small>显示与天气</small>'), '侧栏项目不得重复显示说明文本');
assert(!settingsStyles.includes('linear-gradient'), '系统设置界面不得使用泛白渐变材质');
assert(settingsStyles.includes('.theme-settings-window'), '系统设置样式必须定义窗口表面');
assert(settingsStyles.includes('-webkit-backdrop-filter: none;'), '系统设置窗口与遮罩不得依赖背景虚化');
assert(settingsStyles.includes('--ts-accent: var(--theme-accent'), '系统设置交互色必须继承主题强调色');
assert(!/#(?:0a84ff|007aff|0077ed|409cff)/i.test(settingsStyles), '系统设置不得写死 macOS 蓝色交互色');
assert(authStyles.includes('--auth-theme-accent: var(--theme-accent'), '登录注册页交互色必须继承主题强调色');
assert(!/#(?:0a66ff|0a84ff|4f46e5|ff4d79)/i.test(authStyles), '登录注册页不得混入固定蓝紫或粉色装饰色');
assert(settingsStyles.includes('.theme-settings-sidebar.is-open'), '手机端侧栏必须具备展开状态');
assert(settingsStyles.includes('transform: translate3d(-102%, 0, 0);'), '手机端侧栏默认必须隐藏在视口外');
assert(settingsRuntime.includes('if (!this.authenticated || !this.endpoint)'), '访客不得探测受保护配置接口');
assert(settingsRuntime.includes('mobileSidebarOpen: false'), '系统设置 Store 必须维护手机侧栏状态');
assert(settingsRuntime.includes('this.mobileSidebarOpen = false;'), '切换分类与关闭窗口必须收起手机侧栏');
assert(settingsRuntime.includes('applyThemeSettingsDraftToConfig(latestConfig, saveDraft, savePaths)'), '保存前必须重新读取并增量合并');
assert(settingsRuntime.includes("headers['X-XSRF-TOKEN'] = csrfToken"), '写入配置必须回传 Halo CSRF 令牌');
assert(settingsRuntime.includes("document.querySelector('.dock-container')"), 'Dock 草稿必须应用到真实桌面 Dock');
assert(settingsRuntime.includes("new CustomEvent(DOCK_RUNTIME_SYNC_EVENT)"), 'Dock 草稿与恢复必须通知运行时重新同步');
assert(settingsRuntime.includes("new CustomEvent(MENUBAR_RUNTIME_SYNC_EVENT"), '菜单栏草稿必须通知运行时同步');
assert(windowManagerRuntime.includes("runtimeSyncEvent = 'theme:dock-settings-change'"), 'Dock 引擎必须监听设置同步事件');
assert(windowManagerRuntime.includes("MENUBAR_RUNTIME_SYNC_EVENT = 'theme:menubar-settings-change'"), '菜单栏必须监听设置同步事件');
assert(headerTemplate.includes('menubar-notification-trigger'), '隐藏时间后必须保留独立通知中心入口');
assert(headerTemplate.includes('x-show="timeEnabled"'), '时间入口必须支持运行时显示切换');
assert(headerTemplate.includes('x-show="authEnabled"'), '登录入口必须支持运行时显示切换');
assert(windowManagerRuntime.includes('let settings = applySettings()'), 'Dock 引擎必须支持运行时重读当前参数');
assert(windowManagerRuntime.includes('tooltip.hidden = !nextSettings.showLabels'), 'Dock 引擎必须同步恢复名称标签状态');
assert(dockStyles.includes('blur(var(--dock-blur'), '真实 Dock 必须使用可调玻璃模糊参数');
assert(dockStyles.includes('var(--dock-opacity'), '真实 Dock 必须使用可调玻璃透明度参数');
assert(shellRuntime.includes('registerThemeSettings(Alpine)'), '系统设置 Store 必须在 Alpine 启动前注册');

console.log('前端主题设置契约验证通过');
