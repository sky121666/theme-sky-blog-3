# PJAX 链接边界与 Docsme 正文验证（2026-09-28）

本记录对应本地主题构建 `0.9.46/3ffdcb99a0b4`，运行于 `http://localhost:8090`、Halo `2.26.1`；当前安装的 `plugin-docsme` 为 `1.10.0`，主题依赖的 Pjax 为 `0.2.8`。本次仅修改主题前端链接处理，不升级站点或插件。构建版本、运行版本与功能验证范围分开记录；下述结果不证明所有插件业务流程通过。

## 修复

| 范围 | 原因与改动 |
| --- | --- |
| 通用 PJAX 链接 | Pjax 0.2.8 的 `attachLink` 不检查 `target` 或 `download`。主题现在只接管无 `target` 或 `target="_self"` 且非下载的同源 `.pjax-link`；新窗口、父窗口、顶层窗口及命名窗口链接保留浏览器原生行为。 |
| Docsme 正文内链 | 正文增强此前调用 Pjax 0.2.8 不存在的 `attachLinks`，导致后加类名的内链可能未绑定。现对符合条件的 `/docs` 内链逐个调用 `attachLink`，识别初始绑定与重复增强，避免重复监听；下载及非自身窗口链接不加入。 |

模板中的 `plugin-contract` 标识与 [契约表](插件适配契约.md#pc-docsme-document)保留原实现基线 `plugin-docsme 1.6.0`；本次是对已安装 `1.10.0` 的 PJAX 链接生命周期修复，不把“契约版本”改写成“安装版本”。

## 当前构建验证

- Node `24.21.0` 下 `pnpm run check` 通过，包含通用链接筛选与真实 Pjax 0.2.8 的 Docsme 内链绑定回归；`pnpm run verify:reload` 通过，首页和 12 个关键页面为 200。
- `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`：24 个场景、0 失败，服务资源版本与本地构建一致。
- `pnpm run verify:docsme`：7 项通过、1 项跳过。有效正文、代码、Mermaid 与 PJAX 主题切换通过；扫描的 20 篇候选文档无真实 KaTeX 源容器，因此 KaTeX 真页未验。
- `node scripts/verify-interface-survey.mjs`：桌面和手机共 46 页，0 页面失败；`/about` 两端各有 2 次未播放音视频预加载取消，播放功能不在本次只读巡检范围。
- `SMOKE_BASE_URL=http://localhost:8090 pnpm run verify:pjax-lifecycle`：20 轮、42 次 PJAX 导航及 40 次同视图导航通过。

这些脚本的原始 JSON 和截图位于本机忽略的 `output/`，不作为仓库内可移植证据。隔离回归证明**创建时**带特殊属性的链接不被接管；站内没有针对这些特殊链接的真页点击样本。Pjax 已绑定后再动态改为 `target` 或 `download` 仍会保留原监听器；当前主题源码未发现这样的改写路径，若未来引入须另设点击时防护。Docsme 真实 KaTeX、权限/语言/版本矩阵及业务写链仍按各自记录待验。
