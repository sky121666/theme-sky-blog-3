# 插件 App 真实页面专项回归

下述原始 JSON、日志和截图文件名只对应本机验证材料；仓库保留本页的人工结论与适用边界。

日期：2026-09-26。执行范围为主代理确认 build/reload 完成后的当前页面。未修改源码、模板、站点配置或业务数据，未运行 Git 写操作。

## 环境与结果

- 站点：`http://localhost:8090`，普通路由，当前启用 `theme-sky-blog-3`。
- Halo：`2.26.1`；主题：`0.9.46`；资源 revision：`4279f9779da0`。
- 代码/构建快照：`../environment-code-r1.json`；插件快照：`../environment-before.json`。主回归成功导航另断言实际加载 theme3 资源和正确 App 根节点。后续 R2 构建不覆盖本报告的 R1 证据。
- Node：`v24.18.0`；pnpm：`10.34.5`；Playwright Chromium：`149.0.7827.55`。
- 独立匿名浏览器上下文，1440×960；Photos 另测 390×844。服务工作线程禁用。拦截所有非 GET/HEAD/OPTIONS 请求；全部回归实际业务写请求计数为 0。
- 主脚本退出 **1**：4 项 passed、5 项 passed-with-boundaries、1 项 Bangumi 导航超时。原始结果完整保留于 `report.json`、`run.log`。
- Bangumi 唯一一次有界复跑退出 **0**，8 组合全部通过。没有增加原 30 秒导航超时阈值。
- Photos 评论补充验证最终退出 **0**，桌面和手机两项通过。早期脚本断言错误及诊断证据保留，详情见下。
- 本次未确认新的主题功能缺陷。不能将此结论扩大为所有身份、写流程、故障注入或全部滚动位置通过。

## 逐页验收

| App / 插件 | 实际动作与结果 | 边界 |
| --- | --- | --- |
| Bangumi `1.4.1` | `/bangumis?typeNum={1,2}&status={0,1,2,3}&size=2` 共 8 组合。类型 1 badge 始终 `[25,1,23,1]`，类型 2 始终 `[5,1,3,1]`；全部数量等于三状态之和，header 随当前状态正确显示。复跑所有 HTTP 200，DOMContentLoaded 717–883ms。 | 主脚本首次导航到 type2/status0 已返回 200，但 DOMContentLoaded 超过 30 秒；唯一复跑未复现。原失败未删除，也没有据此改代码。此矩阵直接导航查询路由，不等于所有侧栏点击和完整无限分页验收。 |
| Douban `1.2.6` | `/douban?type=movie&dataType=db&status=done&page=2&size=2` 的 DOM ID 与真实 API 精确一致；继续加载 page3、page4 共追加至 6 条不同 ID，末页隐藏加载更多。关键词“周处除三害”＋题材“犯罪”结果匹配 API；列表切换和 Quick Look 打开、关闭通过。直接 `type=book&status=done` 显示真实空结果，不回退为电影。 | 当前 types 接口仅返回 movie，无法真实点击切换第二类型；该项明确缺样本。文件 `douban-type-changed.png` 名称来自预置脚本，实际未发生第二类型切换，不能引用它作为切类型证据。预览截图处于入场动画，不能作为稳定视觉验收。 |
| Photos `2.1.2` | `/photos?page=2&size=6`：桌面 aspect 为 4 列、增加为 5 列、square 回到 4 列；390 下分别 2、3、2 列。点击既有 `photo-yvqae9y4` 详情，返回保留 `page=2&size=6`。桌面/390 评论图标可见且尺寸 16×16；点击后官方表单和列表渲染，Photo 评论 GET 200；关闭按钮隐藏抽屉并恢复 `aria-pressed=false`。 | 评论样本为 0 条；未填表、提交、回复、上传或管理评论。不是触屏设备测试。未真实制造旧 nextTick 回调/取消竞态，相关 mock 验证和主代理 PJAX 回归另行记录。 |
| Steam `1.0.0` | 游戏库实际滚动加载 `/steam/page/2`，卡片由 12 增至 24，appId 无重复；名称排序选项可切换；无匹配搜索隐藏卡片，清空后恢复。资料热图显示“21 天有游玩记录 · 42 小时 5 分钟”。 | 只实测一次续页；未把下拉选项切换扩大为全部排序结果正确。热图本次只检查真实渲染文本，没有另行完整独立重算服务端记录。截图封面尚未加载完，不能用来断言封面缺失是主题缺陷。 |
| Links `2.3.0` | `/links`、`?view=friends`、`?view=apply`、`?view=board` 四视图导航均成功，正确 App 标识和页面标题，无页面 JS 错误。 | 本项是四视图加载检查；未提交申请/留言、管理员 CRUD、RSS 状态写入。没有把页面加载等同于完整表单流程验收。 |
| Equipments `1.1.1` | 两个既有分组真实路由分别返回 1 条、2 条；未知分组显示空态。 | 现有集合很小，本项未进行真实多页续载；未新增设备制造样本。 |
| Moments `1.19.0` | 首屏 10 条，打开既有 `/moments/moment-f6ircurs` 详情；未知标签显示空态。 | 本项没有重复主代理的 Moments 完整脚本/评论样本检查。没有发布、投票、评论、回复、上传、通知状态写入。 |
| Docsme `1.10.0` | `/docs` 为 projects，`/docs/halo-theme-sky-blog-1/theme-settings` 为 catalog，`/docs/halo-theme-sky-blog-1` 为 document；版本选择实际导航到 `/docs/halo-theme-sky-blog-1/v1`。 | 本项未重复主代理 Docsme 专项；受保护项目拒绝态、多语言、真实 KaTeX 容器需要另外现有样本。 |

上述主脚本所有已执行场景的 `pageErrors` 和 `consoleErrors` 均为空。Bangumi 复跑、Photos 评论补充的 `pageErrors` 为空。

## 超时及验证脚本问题

### Bangumi 首次加载超时

原始 `report.json` / `run.log` 记录 `/bangumis?typeNum=2&status=0&size=2` 的 30 秒 DOMContentLoaded 超时，响应列表包含该文档 HTTP 200。没有采到可归因的 JS 错误，失败截图也因未完成导航未生成。

`verify-bangumi-retry.mjs` 在新匿名上下文中先跑类型 2，再跑类型 1；保持同一 30 秒阈值，逐项记录响应、计数和耗时，首个失败即停止。8 项均通过，证据见 `bangumi-retry.json` / `bangumi-retry.log` 和 `bangumi-retry-*.png`。此处结论为一次未复现的加载超时，具体根因未证实。

### Photos 评论脚本断言修正

早期三次脚本均已实际打开抽屉、收到配置/验证码/Photo 评论 GET 200，但使用了错误就绪断言：依赖可选 Powered 文案，或只在单层 Shadow DOM / 官方外层容器查询输入框。官方组件实际是外层挂载 div → `comment-widget` → Shadow DOM 中的 `comment-form` / `comment-list`，表单还有自己的 Shadow DOM。

诊断文件：`photo-comment-dom-diagnostic.json`。最终脚本使用 Playwright 可访问按钮“提交评论”、官方子组件存在、当前 Photo GET 成功来确认加载，再实际点击关闭。最终结果：`photo-comments.json` / `photo-comments.log`。没有点击提交按钮。

三次错误断言的报告、日志和脚本分别保留为 `initial-*`、`intermediate-*`、`container-attempt-*`。它们的退出码均为 1，不能当成主题功能失败；也没有悄悄覆盖原始断言证据。

## 视觉证据边界

已通过 `view_image` 实际查看：

- `photos-layout-390.png`、`photos-detail-390.png`
- `bangumi-retry-2-2.png`
- `steam-library-paginated.png`
- `douban-filtered-preview.png`
- `photos-comments-open-1440.png`、`photos-comments-open-390.png`
- `photos-comments-failure-1440.png`、`photos-comments-failure-390.png`

截图只覆盖首屏。`photos-comments-open-*` 在淡入过程采集；前述 `photos-comments-failure-*` 是脚本错误断言等待结束后的稳定画面，不代表运行失败。稳定手机画面可见照片淡化背景透过评论表单区域；本轮已验证评论开关可操作，未仅凭透色宣布新的功能缺陷。Steam 封面加载、Douban Quick Look 动画未做稳定视觉结论。

## 命令与证据

三个正式运行都使用以下环境前缀；未运行安装、build、reload 或主代理负责的大套脚本。

```sh
PATH="$PWD/output/interface-fixes-2026-09-26/bin:/Users/sky/Library/pnpm/nodejs/24.18.0/bin:$PATH" \
HALO_BASE_URL=http://localhost:8090 SMOKE_BASE_URL=http://localhost:8090 \
APP_PAGES_BUILD_READY=true \
/Users/sky/Library/pnpm/nodejs/24.18.0/bin/node <script> > <log> 2>&1
```

| script（均位于本目录） | log | 退出码 |
| --- | --- | --- |
| `verify-app-pages.mjs` | `run.log` | 1，Bangumi 单次导航超时 |
| `verify-bangumi-retry.mjs` | `bangumi-retry.log` | 0 |
| `verify-photo-comments.mjs`（最终版） | `photo-comments.log` | 0 |

所有新增/修改文件仅在此 `output` 目录。需要合并理解首轮与诊断复查结果，不能简单声称“首轮全部通过”。
