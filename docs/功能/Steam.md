# Steam

`/steam` 现在按独立 App 设计，覆盖 `halo-plugin-steam` 插件默认页面。

- `pageApp = steam`
- `pageMode = browser-steam`
- `windowVariant = steam`

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

模板读取：

- `steamFinder.getProfile()`
- `steamFinder.getStats()`
- `steamFinder.getBadges()`
- `steamFinder.getRecentGames(limit)`
- 插件注入的 `games`

Finder 调用需要判空。插件请求失败、Steam 隐私未公开或 API Key 未配置时，页面显示降级空状态。

## 交互

- 顶部导航切换资料、游戏库、徽章。
- 游戏库支持当前页搜索和本地排序。
- 游戏库基于插件原生 `/steam/page/{page}` 自动滚动加载，不显示分页按钮。
- 热力图区域按插件页面设置开关显示，并读取插件公开 heatmap REST API 渲染游玩活跃度。
