# Desktop Widgets

## Scope

桌面小组件属于首页桌面平面的一部分，但当前默认布局已经由服务端权威配置接管。

- 组件渲染位置：桌面层，不进入主窗口
- 默认布局来源：`theme.config.default_layout.layout_json`
- 结构化 fallback：桌面图标配置仍来自 `theme.config.desktop.icons`
- 当前策略：`layout_json` 为空时只显示桌面图标，不自动补默认小组件

## Settings Ownership

来源：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/settings.yaml)

当前后端配置只保留 3 类职责：

1. `theme.config.desktop.*`
- 桌面配色、背景、图标来源

2. `theme.config.widgets.*`
- 小组件基础开关
- 小组件数据参数

3. `theme.config.default_layout.layout_json`
- 管理员从前端桌面编辑器发布的默认布局快照
- 优先级最高

当前仍有效的核心字段：

- `widgets.behavior.enabled`
- `widgets.behavior.edit_enabled`
- `widgets.modules.weather.city_name`
- `widgets.modules.weather.refresh_minutes`
- `default_layout.layout_json`

## Runtime Bootstrap

模板在桌面层输出统一 bootstrap：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html)

对象名：

```js
window.__THEME_DESKTOP_PROTOCOL__.widgets
```

关键结构：

```json
{
  "enabled": true,
  "isHome": true,
  "editEnabled": true,
  "columns": 12,
  "gap": 18,
  "layoutVersion": "v1",
  "serverLayoutJson": "{...}",
  "themeName": "theme-sky-blog-3",
  "themeJsonConfigEndpoint": "/apis/api.console.halo.run/v1alpha1/themes/theme-sky-blog-3/json-config",
  "modules": {
    "weather": {
      "cityName": "北京",
      "refreshMinutes": 30
    }
  },
  "sources": {
    "latestPosts": [],
    "popularPosts": [],
    "categories": [],
    "siteStats": null,
    "randomTags": [],
    "momentsAvailable": false,
    "recentMoments": []
  }
}
```

说明：

- 不再输出 `persistence`
- 不再输出 `widgets.instances`
- 小组件实例由 `serverLayoutJson` 解析得到

## Published Default Layout

服务端权威默认布局字段：

- `theme.config.default_layout.layout_json`

存储结构：

```json
{
  "version": 3,
  "layoutVersion": "v1",
  "instances": [
    {
      "key": "clock-main",
      "title": "时间",
      "widget": "system.clock",
      "size": "small",
      "appearance": "light",
      "x": 1,
      "y": 1
    }
  ],
  "icons": [
    {
      "key": "desktop-page-about",
      "title": "关于我",
      "x": 13,
      "y": 1
    }
  ]
}
```

当前规则：

- `instances` 中存在即显示
- 不再使用 `visible`
- 不再使用 `pinMode`
- 图标和小组件都保存到同一份已发布默认布局中

相关实现：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/widgets/persistence.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/widgets/persistence.js)

关键方法：

- `parseDesktopLayoutPayload()`
- `buildDesktopLayoutJsonString()`
- `applyDesktopLayoutJsonToThemeConfig()`

## Widget Instance Protocol

前端统一使用下列 widget instance 结构：

```json
{
  "key": "clock-main",
  "title": "时间",
  "widget": "system.clock",
  "size": "small",
  "appearance": "follow",
  "x": 1,
  "y": 1,
  "w": 2,
  "h": 2,
  "hidden": false
}
```

字段说明：

- `key`：实例唯一键
- `widget`：组件类型
- `size`：`small | medium | large`
- `appearance`：`follow | light | dark`
- `x / y`：网格左上角坐标
- `w / h`：根据 size 推导出的运行时跨度
- `hidden`：仅运行时使用，不进入服务端发布 JSON

命名空间：

- `system.*`
- `halo.*`
- `plugin-<name>.*`

相关实现：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/widgets/catalog.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/widgets/catalog.js)

## Appearance Modes

每个小组件实例都支持独立外观模式：

- `follow`
- `light`
- `dark`

规则：

- `follow`：跟随全站主题明暗切换
- `light`：始终使用浅色 widget 外观
- `dark`：始终使用深色 widget 外观

当前已接入实例级外观模式的组件：

- `system.clock`
- `system.calendar`
- `halo.latest_posts`
- `halo.popular_posts`
- `halo.categories`
- `halo.author_card`
- `halo.site_stats`
- `halo.random_tags`
- `plugin-moments.recent`

实现方式：

- 组件根节点写入 `data-widget-appearance`
- CSS 不再只依赖全局 `.dark`
- `follow` 在浅色根节点下等同于 light token，在深色下等同于 dark token

模板落点：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/templates/modules/desktop-widgets.html)

样式落点：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/base.css](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/base.css)
- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/shell.css](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/shell.css)
- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/content/index.css](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/css/widgets/content/index.css)

## Widget Center

组件中心当前负责：

- 搜索组件
- 分类浏览
- 选择尺寸
- 选择实例外观：`跟随 / 浅色 / 深色`
- 添加组件
- 替换现有组件尺寸和外观

当前动作入口：

- `添加`
- `装饰`
- `默认`
- `保存`

说明：

- `保存` 会把当前桌面实例和图标布局发布到 `default_layout.layout_json`
- 无管理员权限时，不暴露服务端发布能力

运行时代码：

- [/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop/surface/index.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/desktop/surface/index.js)

## No Local Persistence

当前桌面小组件默认布局不再写入浏览器本地缓存。

已经移除：

- 本地 `localStorage` 布局读写
- 旧的扩展持久化桥
- `widgets.persistence.*` 协议

当前唯一权威来源：

1. `default_layout.layout_json`
2. 若为空，则回退到桌面图标结构化配置

## Notes For New Widgets

新增 widget 时，需要同时满足：

1. 在 [`catalog.js`](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/js/widgets/catalog.js) 注册：
- `title`
- `category`
- `size`
- `sizes`
- `description`

2. 在对应 renderer 里支持尺寸分支：
- `small`
- `medium`
- `large`

3. 在卡片根节点体系下兼容 `data-widget-appearance`

4. 如果要支持 preview skin，需要单独处理：
- live card
- center preview

不要再依赖：

- 本地布局缓存
- `pinMode`
- `visible` 写入服务端协议
