# Docsme

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
| 项目大厅页面 | [/templates/docs.html](/templates/docs.html) |
| 文档正文页面 | [/templates/doc.html](/templates/doc.html) |
| 文档目录页面 | [/templates/doc-catalog.html](/templates/doc-catalog.html) |
| Docsme 窗口外壳 | [/templates/modules/docsme-app/window.html](/templates/modules/docsme-app/window.html) |
| Docsme 内容包裹 | [/templates/modules/docsme-app/content.html](/templates/modules/docsme-app/content.html) |
| 运行时入口 | [/src/apps/docsme](/src/apps/docsme) |
| 样式 | [/src/apps/docsme/styles/index.css](/src/apps/docsme/styles/index.css) |

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

## 1.6.0 边界

Docsme 1.6.0 增加了 `_templateId` 和文档描述生成 `meta description` 的能力。

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

本轮 Docsme 1.6.0 复验补充：

- 本地可访问文档详情页返回 200。
- 文档页输出 `data-docsme-template-id="plugin:docsme:doc"`，确认 `_templateId` 未被主题硬编码替代。
- 文档页输出 `meta description="当前主题的基本介绍"`，确认文档描述进入 SEO 描述。
- 文档页输出 `.docsme-comment`，确认评论容器接入。
- 从 `/docs` PJAX 进入文档页后，`data-page-mode="browser-docsme"`、`data-app-id="docsme"`、`data-window-variant="docsme"` 和目录链接保持正常。

本地数据中 `/docs/123` 当前返回 404，原因是插件数据项目没有可访问文档首页；主题侧不把这个状态视为模板错误。

权限态、多语言多版本切换、Shiki/KaTeX/Mermaid 渲染仍需要补充真实 Docsme 内容样本后再复验。

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
