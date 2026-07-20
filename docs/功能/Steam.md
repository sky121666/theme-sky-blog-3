# Steam

`/steam` 现在按独立 App 设计，覆盖 `halo-plugin-steam` 插件默认页面。

- `pageApp = steam`
- `pageMode = browser-steam`
- `windowVariant = steam`
- 本地实测插件 `metadata.name = steam`，主题兼容 `steam` / `halo-plugin-steam` / `PluginSteam` / `plugin-steam` 四种可用性判断。

数据优先来自插件注入的页面模型和 `steamFinder`，主题只消费插件能力，不直接调用 Steam Web API。

## 入口

| 内容 | 文件 |
| --- | --- |
| 页面协议、标题、窗口参数 | [/templates/steam.html](/templates/steam.html) |
| 页面结构、资料、游戏库、徽章 | [/templates/modules/steam-app/list.html](/templates/modules/steam-app/list.html) |
| 独立窗口骨架和加载骨架 | [/templates/modules/steam-app/window.html](/templates/modules/steam-app/window.html) |
| 运行时搜索、排序和 App 生命周期 | [/src/apps/steam](/src/apps/steam) |
| 样式和移动端沉浸窗口 | [/src/apps/steam/styles/index.css](/src/apps/steam/styles/index.css) |

## 路由

支持插件原生路由：

- `/steam`
- `/steam/page/{page}`

## 主题设置

后台主题设置的 `Steam / 背景` 可配置 Steam App 的窗口背景和资料横幅图。留空时使用主题内置的游戏背景。

## 数据

当前主题契约和已测试版本均为最新稳定版 `halo-plugin-steam` `1.0.0`。

模板读取：

- `steamFinder.getProfile()`
- `steamFinder.getStats()`
- `steamFinder.getBadges()`
- `steamFinder.getRecentGames(limit)`
- 插件注入的 `games`

Finder 调用需要判空。插件请求失败、Steam 隐私未公开或 API Key 未配置时，页面显示“数据不可用”降级态；成功但无游戏时显示真正空状态，两者不混淆。

1.0.0 字段与异常边界：

- 头图优先 `headerImageUrl`，回退 `realHeaderImage`；图片加载失败再使用主题占位图。
- 优先使用插件格式化游玩时长；只有原始分钟时稳定格式化为 `2h 5m`、`45m`，不显示小数小时。
- `delisted` 游戏禁用跳转，输出占位图、`aria-disabled` 和不可聚焦状态。
- 热力图和分页请求均支持取消；PJAX dispose 后不保留旧请求或旧页面回调。

## 桌面小组件边界

Steam 不再混入作者或身份状态卡。桌面入口已单独落地为 `plugin-steam.summary` 中卡片小组件。

- 可显示：`profile.playing`、`profile.statusText`、`summary.personaName`、`summary.avatarFull`、`steamLevel`、统计中的游戏数量。
- 不推断：`profile.playing === true` 是唯一“正在玩”判断来源；`getRecentGames(1)` 只代表最近玩过，不代表当前正在玩。
- 插件缺失、Finder 返回空或 `playing` 为 false 时，Steam 小组件应按 Steam 自身规则降级，不影响作者卡片。

## 交互

- 顶部导航切换资料、游戏库、徽章。
- 游戏库支持当前页搜索和本地排序。
- 游戏库基于插件原生 `/steam/page/{page}` 自动滚动加载，不显示分页按钮。
- 热力图区域按插件页面设置开关显示，并读取插件公开 heatmap REST API 渲染游玩活跃度。
- 热力图失败显示静态降级态；分页失败与“没有下一页”分别处理。
