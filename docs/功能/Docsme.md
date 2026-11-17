# Docsme

> 当前界面为主题内的 macOS 风格文档窗口。8090 使用 Halo 2.27.3 / Docsme 1.10.2；本次实测与样本边界见[验证与审计矩阵](../验证与审计矩阵.md#docsme-文档窗口)。

## 查找与阅读

- **资料库**：`/docs` 左栏列出可访问项目。工具栏可在封面和列表间切换；从文档返回后沿用这个标签页上次的选择。输入名称或描述可即时筛选项目，点搜索框里的清除按钮或按 Esc 恢复；底部显示当前数量。此处不查询正文，项目内的「搜索」才是全文搜索。
- **目录**：在左侧章节树中选择文件夹，右边列出它的子项；文件夹和文稿使用不同图标。点击子项可继续进入下一层，面包屑可返回上一级。
- **阅读**：标题与正文放在同一张阅读纸面上。左侧保留文档树和可用的版本／语言选择，右侧是本页标题目录。窄窗口把左栏收进抽屉，本页目录按需展开。没有正文标题的文件夹页不显示本页目录按钮。
- **固定本页目录**：右侧目录标题栏的图钉将目录固定为独立一栏，正文滚动或点击章节时都保持展开；再次点击图钉恢复浮层。旁边的关闭按钮只收起目录，工具栏可重新打开。固定偏好在当前标签页的文档切换、刷新和浏览器返回后保留；窗口内容不足 1080px 时临时使用浮层并隐藏图钉，恢复宽度后沿用原偏好，避免固定列挤压正文。
- 固定偏好在首帧样式生效前恢复；即使文档脚本加载较慢，正文仍可见，不会先显示错误栏数再跳变。没有主动选择固定模式时，内容宽度达到 1080px 的窗口默认显示独立目录列。
- 本页目录支持键盘操作，浮层可用 Esc 关闭并回焦，保留 Cmd/Ctrl 等原生链接操作；定位标题只滚动正文，不滚动桌面。手机浮层打开时，正文、左栏和桌面暂时不可操作，Tab / Shift+Tab 在目录内循环；关闭后恢复，选择章节则把焦点送到对应标题。关闭按钮为 44×44px。左侧文档树与本页目录共用背景状态恢复逻辑，切换和离开文档时不会残留不可操作状态。
- 直接访问正文时不依赖 JavaScript 显示内容；读到一半从 Dock 离开再用浏览器后退，恢复的是文档正文自己的阅读位置。[文档规范地址与插件优先级](./Docsme/规范地址.md)
- 宽表格在自身区域横向滚动，不把整页撑宽。正文评论和上下篇入口继续沿用项目配置；通过 Swup 切换文档时保留桌面、小组件和 Dock。

## 搜索、切换与恢复

- 工具栏「搜索」按当前项目、版本和语言查询正文；打开本站结果走统一无刷新导航，关闭搜索后不会因同一次 Enter 再次弹出。
- 版本和语言切换保留可用的文档后缀、查询参数与锚点；读取失败恢复原选择及正文。
- 悬停、键盘聚焦或触摸文档链接时可预取。点击复用有效缓存或在途响应；服务端标记 `no-store` 的已完成响应不保留为后续缓存。
- 切换期间正文继续可见，失败可重试；浏览器后退恢复正文自己的阅读位置。图钉、窄屏目录和搜索的最新验证见[最终集中验收](../2026-11-17-最终集中验收.md)。

## 界面截图

查看[当前窗口与旧版对照图集](Docsme/截图.md)。当前的资料库、文件夹、深色正文和手机阅读均采自 8090；手机图来自 390×844 浏览器窄屏预览，并非真机拍摄。

## 当前 surface 与样本边界

主题继续消费既有 Docsme 页面模型。本轮使用安装的 `1.10.2`，实测公开项目列表、正文、目录页、子文档、版本切换与项目范围搜索；权限矩阵和多语言切换不因此视为完成验收。项目首页仍依赖插件发布的首选版本与文档树关联；删除后的历史地址 404 不由主题伪造替代页面。正文内链由 `src/apps/docsme/runtime.js` 接入现有全局 Swup；数学、图表和代码高亮的样本与插件边界见[适配契约](../插件适配契约.md)，本轮没有重新编写这些插件功能。

## 结论

Docsme 现在按独立 App 接入主题，不直接裸用插件默认页面。

- `pageApp = docsme`
- `pageMode = browser-docsme`
- `windowVariant = docsme`
- 路由覆盖 `/docs` 与 `/docs/**`

主题现在完全自定义 Docsme 前台 DOM，只消费 Docsme 注入的数据模型，不再用官方 `dm-*` 页面模块决定布局。

## 入口

| 能力 | 文件 |
| --- | --- |
| 项目大厅页面 | [/templates/docs.html](../../templates/docs.html) |
| 文档正文页面 | [/templates/doc.html](../../templates/doc.html) |
| 文档目录页面 | [/templates/doc-catalog.html](../../templates/doc-catalog.html) |
| Docsme 窗口外壳 | [/templates/modules/docsme-app/window.html](../../templates/modules/docsme-app/window.html) |
| Docsme 内容包裹 | [/templates/modules/docsme-app/content.html](../../templates/modules/docsme-app/content.html) |
| 运行时入口 | [/src/apps/docsme](../../src/apps/docsme) |
| 样式 | [/src/apps/docsme/styles/index.css](../../src/apps/docsme/styles/index.css) |

## 路由

当前主题路由协议：

- `/docs`
- `/docs/`
- `/docs/**`

`/docs/**` 下具体是正文页还是目录页，由 Docsme 插件选择 `doc.html` 或 `doc-catalog.html`，主题不在前端硬编码判断。

## 数据模型

主题直接使用这些 Docsme 模型：

- `projects`
- `project`
- `docTree`
- `docTrees`
- `crumbs`
- `versions`
- `languages`
- `currentVersion`
- `currentLanguage`
- `docInfo.content.content`
- `sonNodes`
- `linkNavigation`
- `haloCommentEnabled`

主题运行时负责：

- `/docs/**` 内链补齐 `pjax-link` 和 `data-pjax-app="docsme"`
- PJAX 加载态只作用于主内容区，不再使用整窗骨架屏
- 版本 / 语言切换
- 正文标题自动生成本页目录
- 移动端目录抽屉
- 左侧文档目录可折叠，箭头负责展开/收起，标题负责进入目录页

## 1.6.0 契约与历史 1.7.0 兼容检查

主题继续按 Docsme 1.6.0 的 `_templateId`、文档描述和页面模型契约实现。项目大厅、正文、目录、评论、SEO 与同 App PJAX 等核心 surface 曾在 1.7.0 上执行限定兼容检查；权限、多语言和多版本切换因本地没有对应样本，逐 surface 表未登记真页 `Tested version`。

主题适配规则：

1. 保留 `_templateId`，不要用主题硬编码替代插件模板身份。
2. `doc.html` 优先使用 Docsme 文档描述作为 SEO 描述。
3. 中文别名路径按插件生成的 `status.permalink` 处理，不在主题内自行拼路径。

## 验证

当前 reload 验证已覆盖：

- `/docs` 返回 200
- `data-page-mode="browser-docsme"`
- `data-window-variant="docsme"`
- `data-app-id="docsme"`
- `/docs` 输出 `.docsme-project-card`，不再输出 `.dm-project-card`
- 移动端隐藏全局 header / dock，窗口铺满视口

2026-11-17 本页目录补充验收（构建 `0.9.51 / 544a408d0f5f`）：

- 定向回归覆盖 958 / 1024 / 1079 / 1080px 的窗口边界、固定偏好、模态焦点、关闭回焦、章节定位和卸载恢复。
- 8090 在 1440 / 1024 / 390 / 320px 浏览器视口通过 25/25 项文档体验验证；390 / 320px 为移动视口模拟，未宣称手机真机验收。
- 暂缓文档应用脚本的真实刷新测试中，固定与浮动两种偏好的正文宽度在初始化前后均不变；主题相关运行错误为 0。
- 标准全站 smoke 仍记录外站 favicon 的 `ERR_BLOCKED_BY_ORB`，按本轮范围保留，不据此改动外站资源。具体证据见[排查记录](../2026-11-17-HTML生成与通知中心排查.md#本页目录第二轮修复与验收)。

历史 Docsme 1.7.0 兼容复验（对应当时构建）：

- 本地可访问文档详情页返回 200。
- 文档页输出 `data-docsme-template-id="plugin:docsme:doc"`，确认 `_templateId` 未被主题硬编码替代。
- 文档页输出 `meta description="当前主题的基本介绍"`，确认文档描述进入 SEO 描述。
- 文档页输出 `.docsme-comment`，确认评论容器接入。
- 从 `/docs` PJAX 进入文档页后，`data-page-mode="browser-docsme"`、`data-app-id="docsme"`、`data-window-variant="docsme"` 和目录链接保持正常。
- 实际加载 `plugin-katex` 3.0.0 资源，行内/块级公式、预渲染保护、失败回退与 `version=3.0.0` 客户端冷补载通过。
- 实际加载 `text-diagram` 1.5.2 Mermaid 资源，明暗主题重绘始终保持单个 SVG，`version=1.5.2` 客户端冷补载与并发重入去重通过。

2026-09-27 后续复测：用户已删除先前缺少可访问文档首页的项目。当前 `/docs` 为 200，项目卡片不再输出 `/docs/123`；已删除地址的 404 属预期。同一构建 `0.9.46 / acc35d74a2e5` 的三轮只读专项（本机 `docs/evidence/docsme-after-delete-2026-09-27/README.md`）均动态访问 22 条路由。默认 Node 22 的整套通过；指定 Node 24 的两轮一败一过，失败点是一篇有效文档等待 `DOMContentLoaded` 超时。真实 KaTeX 内容仍缺样本。原先的坏链 404 结论保留在带构建身份的历史验收记录中。

权限态、多语言和多版本的真实矩阵仍待验证；历史 1.10.0 专项已在真实文档上观察到 Shiki 宿主和 Mermaid 渲染，KaTeX 因缺少有效内容样本继续跳过。旧 1.7.0 高级 surface 的 `Tested version` 不因通用文档通过而改写。

专项复验命令：

```bash
pnpm run verify:docsme
```

如果本地还没有富内容样本，脚本会跳过对应检查。补齐样本后可显式指定：

```bash
DOCSME_DOC_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme
DOCSME_CODE_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme
DOCSME_KATEX_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme
DOCSME_MERMAID_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme
```
