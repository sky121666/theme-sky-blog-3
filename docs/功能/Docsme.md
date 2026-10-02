# Docsme

> 2026-09-30 按当前源码核对。插件契约与逐项测试版本见[适配契约](../插件适配契约.md#当前逐-surface-权威表2026-09-26)，精确构建和运行边界见[项目进度](../项目进度.md)。本次文档更新未重新执行插件业务验收。

## 界面截图

查看[Docsme 截图图集](Docsme/截图.md)，按编号浏览项目大厅、文档阅读和手机正文与目录预览。

截图采集于 **2026-10-02**，主题为 **v0.9.47**；仅记录页面展示，交互与写入验收范围见本页说明。手机图来自 **390×844 浏览器窄屏预览**，真机体验仍需独立验收。

## 当前 surface 与样本边界

主题实现仍以 Docsme `1.6.0` 页面模型为契约。逐 surface 表给项目大厅与正文登记了安装插件 `1.10.0` 的限定真页记录；目录和权限/语言/版本行仍是 `—`。因此不把正文内链修复或 `/docs` 200 推断为高级权限矩阵通过。项目首页依赖插件发布的首选版本与文档树关联；历史 `/docs/123` 404 对应站点当时的数据关联，用户删除旧项目后该 URL 的 404 为预期。正文 PJAX 内链由 `src/apps/docsme/runtime.js` 处理；KaTeX 真页缺样本，Mermaid 与 Shiki 的旧专项仅覆盖列出的宿主。

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
