# Desktop Widgets

## Scope

桌面小组件只属于首页桌面层。

- 显示位置：首页桌面
- 不进入主窗口
- 不进入 `#pjax-container`
- 非首页路径隐藏

当前实现边界：

- 主题后台负责默认组件和默认布局
- 前端负责编辑态、拖拽吸附、渲染和本地持久化
- 未来插件只负责用户布局读取和保存

## Settings Ownership

来源：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml)

配置路径：

- `theme.config.widgets.behavior.*`
- `theme.config.widgets.persistence.*`
- `theme.config.widgets.instances`
- `theme.config.widgets.modules.*`

当前核心字段：

- `widgets.behavior.enabled`
- `widgets.behavior.edit_enabled`
- `widgets.behavior.layout_version`
- `widgets.behavior.grid_columns`
- `widgets.behavior.gap`
- `widgets.persistence.driver`
- `widgets.persistence.namespace`
- `widgets.persistence.sync_provider`
- `widgets.instances[]`
- `widgets.modules.clock.show_seconds`
- `widgets.modules.weather.enabled`
- `widgets.modules.weather.city_name`
- `widgets.modules.weather.refresh_minutes`
- `widgets.modules.latest_posts.limit`
- `widgets.modules.site_stats.enabled`
- `widgets.modules.random_tags.limit`
- `widgets.modules.moments_recent.limit`

## Runtime Bootstrap

模板会在首页桌面层输出一个 bootstrap 对象：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html)

对象名：

```js
window.__THEME_WIDGETS__
```

结构：

```json
{
  "enabled": true,
  "isHome": true,
  "editEnabled": true,
  "columns": 12,
  "gap": 18,
  "layoutVersion": "v1",
  "persistence": {
    "driver": "local",
    "storageKey": "theme-macOS-desktop-widgets",
    "syncProvider": ""
  },
  "modules": {
    "clock": { "showSeconds": false },
    "weather": {
      "enabled": true,
      "cityName": "北京",
      "refreshMinutes": 30
    },
    "latestPosts": { "limit": 5 },
    "siteStats": { "enabled": true },
    "randomTags": { "limit": 12 },
    "momentsRecent": { "limit": 4 }
  },
  "instances": [],
  "sources": {
    "latestPosts": [],
    "siteStats": null,
    "randomTags": [],
    "momentsAvailable": false,
    "recentMoments": []
  }
}
```

## Widget Instance Protocol

前端运行时统一使用下列实例结构：

```json
{
  "key": "clock-main",
  "title": "时间",
  "widget": "system.clock",
  "size": "small",
  "x": 1,
  "y": 1,
  "w": 2,
  "h": 2,
  "pinMode": "fixed",
  "hidden": false
}
```

约束：

- `key`：实例唯一键
- `widget`：组件类型
- `size`：`small | medium | large`
- `x / y`：左上角起始网格坐标
- `w / h`：吸附后的网格跨度
- `pinMode`：`fixed | default | optional`
- `hidden`：当前浏览器里是否隐藏

命名空间规则：

- `system.*`
- `halo.*`
- `plugin-<name>.*`

## Local Persistence

当前默认驱动：

- `widgets.persistence.driver = local`

本地存储 key：

- `theme-macOS-desktop-widgets`

Payload 结构：

```json
{
  "version": 1,
  "layoutVersion": "v1",
  "instances": [
    {
      "key": "clock-main",
      "title": "时间",
      "widget": "system.clock",
      "size": "small",
      "x": 1,
      "y": 1,
      "pin_mode": "fixed",
      "visible": true
    }
  ]
}
```

说明：

- `layoutVersion` 变化时，本地布局自动失效
- 当前持久化只保存实例数组
- 本地 payload 是未来插件同步 payload 的基线，不再另起一套协议

序列化实现：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js)
  - `serializeWidgetInstance()`
  - `buildDesktopWidgetLayoutPayload()`
  - `loadDesktopWidgetLayout()`
  - `saveDesktopWidgetLayout()`

## Edit Mode

当前前端支持：

- 进入编辑态
- 拖拽吸附预览
- 隐藏任意组件实例
- 添加当前未显示的组件
- 恢复默认布局
- 组件中心搜索和分类浏览
- 基于组件尺寸的降级渲染

当前规则：

- 组件实例都可以移除或重新添加
- 默认布局从左上开始排布
- 拖拽落手后写回本地
- 恢复默认会覆盖当前浏览器布局

运行时代码：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop.js)
  - `Alpine.data('desktopWidgets', ...)`

## Future Plugin Storage Interface

未来如果要把布局保存到用户侧插件，主题不改 UI，只替换存储驱动。

设置入口：

- `widgets.persistence.driver = extension`
- `widgets.persistence.sync_provider = <provider-name>`

主题会主动暴露一个桥接对象：

```js
window.ThemeSkyDesktopWidgets
```

可用方法：

```js
window.ThemeSkyDesktopWidgets.registerDriver(provider, driver)
window.ThemeSkyDesktopWidgets.unregisterDriver(provider)
window.ThemeSkyDesktopWidgets.getDriver(provider)
window.ThemeSkyDesktopWidgets.listDrivers()
```

插件也可以直接写注册表，但推荐走桥接对象：

```js
window.ThemeSkyDesktopWidgets.registerDriver('user-widget-store', {
  async load(context) {
    return null;
  },
  async save(context, payload) {},
  async reset(context) {}
});
```

`context` 建议字段：

```json
{
  "layoutVersion": "v1",
  "storageKey": "theme-macOS-desktop-widgets",
  "provider": "user-widget-store",
  "siteUrl": "https://example.com",
  "pagePath": "/"
}
```

`payload` 直接复用本地布局结构：

```json
{
  "version": 1,
  "layoutVersion": "v1",
  "instances": []
}
```

插件职责：

- 识别当前登录用户
- 读取用户布局
- 保存用户布局
- 可选支持重置

主题职责：

- 组件外观
- 编辑态
- 拖拽吸附
- 默认布局
- 本地驱动
- 组件渲染

不要把组件渲染逻辑反向塞进插件。
