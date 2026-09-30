# Sky Blog 3

Sky Blog 3 是面向 Halo 2.x 的 macOS 桌面风格博客主题，以桌面、Dock、菜单栏、窗口和小组件组织文章及插件内容。

- 仓库：[sky121666/theme-sky-blog-3](https://github.com/sky121666/theme-sky-blog-3)
- 当前正式版本：[v0.9.47](https://github.com/sky121666/theme-sky-blog-3/releases/tag/v0.9.47)；要求 Halo `>=2.26.0`
- 开发环境：Node `>=24.21.0 <25`，pnpm `12.5.1`
- 从这里开始：[文档索引](docs/文档索引.md) · [后台配置](docs/设置/后台设置协助说明.md) · [前端系统设置](docs/设置/前端系统设置.md)

> `v0.9.47` 已于 2026-09-30 发布至 GitHub 与 [Halo 应用市场](https://www.halo.run/store/apps/app-gqnoxtpt)。全部变更见[发布说明](docs/发布说明.md#v0947)，现行实现、制品与验证范围见[项目进度](docs/项目进度.md)。

## 预览

| 桌面 | 文章详情 |
| :---: | :---: |
| ![桌面](screenshots/desktop.png) | ![文章详情](screenshots/post-detail.png) |

| 归档 Finder | 瞬间列表 | 瞬间详情 |
| :---: | :---: | :---: |
| ![归档](screenshots/archives-finder.png) | ![瞬间列表](screenshots/moments-feed.png) | ![瞬间详情](screenshots/moments-detail.png) |

## 功能与使用

下表描述源码已实现的能力；各构建的真实运行范围见[验证与审计矩阵](docs/验证与审计矩阵.md)。

| 模块 | 当前能力 | 详细说明 |
| --- | --- | --- |
| 桌面壳层 | 桌面图标、Dock、菜单栏、窗口缩放与恢复、移动端内页焦点隔离 | [桌面壳层](docs/功能/桌面壳层.md) |
| 首屏加载 | 默认普通显示；提前投影桌面布局。可选开机效果、两种播放频率、三种标识及草稿演示 | [前端系统设置](docs/设置/前端系统设置.md#首屏加载) |
| 系统设置 | 十分类、77 个共享配置路径；草稿预览、应用、取消、权限检查与冲突提示 | [设置指南](docs/设置/前端系统设置.md) |
| 图片与图标 | 5 个图片字段、7 个图标字段；Halo 附件库、图片地址、上传及 Iconify 图标选择 | [素材操作](docs/设置/前端图片与图标设置.md) |
| 桌面小组件 | 时钟、日历、天气，Halo 内容和插件数据；组件中心、尺寸与默认布局编辑 | [小组件](docs/桌面小组件.md) |
| 浏览列表 | 归档、分类、标签、作者，Finder 导航与分页 | [浏览列表](docs/功能/浏览列表.md) |
| 阅读页 | 文章和独立页面、目录、代码块、点赞与评论容器 | [阅读页](docs/功能/阅读页.md) |
| 瞬间 | 列表、详情、标签、媒体预览、发布入口、点赞与评论 | [瞬间](docs/功能/瞬间.md) |
| 图库 | 分组、分页、单图详情、胶片条、EXIF、键盘切换与评论抽屉 | [图库](docs/功能/图库.md) |
| 友链与朋友圈 | 分组、RSS 续载、收藏、稍后阅读、已读状态、留言板与添加助手 | [链接页](docs/功能/链接页.md) |
| 追番 | 追番／追剧、状态筛选与续载 | [追番](docs/功能/追番.md) |
| 豆瓣 | 书影音归档、筛选、搜索、分页与 Quick Look | [豆瓣](docs/功能/豆瓣.md) |
| Steam | 资料、最近游玩、游戏库、徽章与热力图 | [Steam](docs/功能/Steam.md) |
| 装备 | 分组、装备展示、外链与 HTML 分页续载 | [装备](docs/功能/装备.md) |
| Docsme | 项目大厅、文档正文、目录页与同窗口导航 | [Docsme](docs/功能/Docsme.md) |
| 登录 | macOS 锁屏式用户名／密码两步界面，保留 Halo 第三方登录、Passkey 和账号入口 | [桌面壳层与登录边界](docs/功能/桌面壳层.md) |

### 配置入口

1. 在 Halo 后台完成主题基础配置及所需插件安装，见[后台设置协助说明](docs/设置/后台设置协助说明.md)。
2. 登录具有主题配置权限的账号，从 Dock 或菜单栏打开「系统设置」。后台可关闭 Dock 的内置设置入口。
3. 在分类中修改草稿，查看预览，再点击「应用」。取消会丢弃本窗口未保存的草稿；附件上传会立即创建附件，使用图片与应用配置是后续步骤。
4. 在「首屏加载」选择普通显示或开机启动。演示不保存；应用后的启动设置在后续完整页面加载时按频率生效。减少动态效果时直接显示页面。
5. 需要编辑站点默认桌面布局时，进入「小组件」中的桌面管理入口，按[小组件说明](docs/桌面小组件.md)操作。

通知中心、首屏加载和登录展示由主题实现；访问保护、账号权限和认证结果由 Halo 及对应插件决定。系统设置没有独立的站点访问策略开关。

## 插件兼容

内容 App 按需依赖 Moments、Photos、Links、追番、Douban、Steam、Equipment 和 Docsme 插件；搜索、评论、代码高亮等由相应插件提供。未安装插件时，关联入口和小组件会按能力降级；手动配置的失效链接需要管理员核对。

- [插件适配状态](docs/插件适配状态.md)：当前支持范围与剩余工作。
- [插件适配契约](docs/插件适配契约.md)：逐功能范围的契约版本、测试版本及证据。
- [插件更新跟进计划](docs/插件更新跟进计划.md)：已知升级差异和补验安排。

`contractVersion` 表示主题采用的契约，`testedVersion` 表示记录中的测试版本。插件已安装、源码已适配、真实交互已验收各有不同证据；更新插件前请核对对应记录。插件默认前台布局还需要实际调用主题的 `html(head, content)` 页面验收。

## 安装与升级

1. 从 [GitHub Releases](https://github.com/sky121666/theme-sky-blog-3/releases) 下载目标版本的主题 ZIP。
2. 在 Halo 后台「外观 → 主题」上传并启用。
3. 根据该发布包的最低 Halo 要求配置菜单、桌面图标、小组件和插件页面。
4. 升级前备份主题配置和上一稳定 ZIP；升级后复查首页、阅读页、登录入口及启用的插件页面。

正式 `v0.9.47` 要求 Halo `>=2.26.0`。`v0.9.46` 的兼容声明保留在[历史发布说明](docs/发布说明.md#v0946)，不能用当前版本声明代替旧 ZIP 的原始信息。完整发布与恢复步骤见[发布与回滚](docs/发布与回滚.md)。

## 开发与验证

固定使用 pnpm，在符合 `package.json` 的 Node 环境中执行：

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run check
```

`check` 会执行静态与隔离契约、许可证声明核对、Vite 构建、资源预算和构建 smoke，并改写 `templates/assets/**`。修改运行时代码后，提交范围需要包含对应构建资源。

| 任务 | 命令／说明 |
| --- | --- |
| 监听构建／只构建 | `pnpm run dev`／`pnpm run build-only` |
| 设置模型与素材 | `pnpm run verify:settings-model`、`pnpm run verify:settings-assets` |
| 首屏与 Dock 契约 | `pnpm run verify:startup`、`pnpm run verify:desktop-dock` |
| 首屏隔离浏览器场景 | `pnpm run verify:startup:browser`；配置与播放模式使用 fixture，真实写入不作为通过证据 |
| Halo 主题重载 | `pnpm run verify:reload`；需要本地 `FIVEEE_PAT`，会调用 reload 接口 |
| 真实页面与 PJAX | `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright` |
| 性能／生命周期 | `pnpm run verify:performance`、`pnpm run verify:pjax-lifecycle` |
| 本地主题包 | `pnpm run build`，再运行 `pnpm run verify:release-package <zip>` |
| 依赖审计 | `audit:licenses` 本地核对；`audit:security` 会向 npm 漏洞接口发送依赖树，需明确授权 |

文档修改只验证文档链接与事实一致性；运行时变更再按[开发约束](docs/开发约束.md)和[验证矩阵](docs/验证与审计矩阵.md)选择适用门禁。真实环境需核对活动主题、精确构建、访问策略及样本；登录页重定向不能记作目标页面验收通过。

CI 仅通过 `workflow_dispatch` 手动运行，普通推送不自动执行。公开 GitHub Release 后，CD 调用 Halo 官方工作流打包并同步应用市场；推送代码、运行 CI 和发布版本是独立动作。

## 当前验证边界

- 当前正式构建为 `0.9.47 / 79c9ed2a8831`：完整 `check`、构建及资源预算通过；CI、CD、正式 ZIP 和应用市场版本均已核验。CI 的线上 smoke 因未配置 `SMOKE_BASE_URL` 被跳过；本地匿名全站 Reload／smoke 受首页登录保护阻断，认证只读页面与服务端资源身份一致。
- 历史 `0.9.46 / f4cc217c2418` 的设置及 6 组隔离浏览器结果保留其原始范围，不外推至新版本。
- `4cd9e2e00aa6` 的完整检查、13 路由 Reload、24 场景 smoke 是前一检查点的证据。
- 最新改动的真实账号配置持久化、密码／OAuth／Passkey 提交、私密资源权限和真机触摸仍需专项验收；局部或历史记录不能替代这些步骤。
- Photos 公共 REST、tag、ungrouped 和详情预取尚未接入；Equipment 小组件尚未实现；`plugin-forum` 不在适配范围。

详细风险和缺样本列表统一维护在[项目进度](docs/项目进度.md)与[插件契约](docs/插件适配契约.md)。

## 反馈

- GitHub Issues：[提交问题或建议](https://github.com/sky121666/theme-sky-blog-3/issues)
- Release 下载：[版本发布页](https://github.com/sky121666/theme-sky-blog-3/releases)
- 加入社群：通过下方二维码交流使用问题和功能建议

| 企业微信（备注进群） | QQ 群 |
| :---: | :---: |
| <img width="200" src="https://api.minio.yyds.pink/kunkunyu/files/2025/02/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20250212142105-pbceif.jpg" /> | <img width="200" src="https://api.minio.yyds.pink/kunkunyu/files/2025/05/qq-708998089-iqowsh.webp" /> |

> 卖服务器的广告人，就不要加了。
