# 主题整体可靠性修复 Implementation Plan

> **For agentic workers:** 使用 superpowers:subagent-driven-development；仓库与用户授权要求在现有 main 执行，不创建分支或 worktree，实施阶段不执行 Git 暂存、提交、推送；用户随后授权分批本地提交。

**Goal:** 修复本轮审阅确认的设置恢复、并发图标保存、手机焦点与组件生命周期问题，并补齐常用中文图标检索词。

**Architecture:** 保留现有设置、布局与窗口模块；通过最小状态保护和三方字段合并修复数据竞争。手机内页使用 inert 隔离被覆盖桌面，桌面宽度继续允许窗口和桌面并行交互。

**Tech Stack:** Halo 2.26.1、Alpine、Node 24.21.0、pnpm 12.5.1。

**Spec:** 本文「修复约定」及当前对话上一轮审阅结论；用户已回复「修复」。

## Global Constraints

- 使用 main 和 pnpm；保留已有 Dock/滚动等未提交改动。
- 不变更 Halo Core、公共接口、权限、依赖或 CI。
- 不写入真实站点配置、删除布局图标或提交插件业务数据。
- 所有网络写入回归使用隔离 fixture；主题本地重载沿用已授权验证流程。
- 不提高资源体积预算；最终按同一构建复核 check、reload、smoke 和关键浏览器交互。

## 修复约定

- 设置冲突继续保留当前窗口中的草稿；提示在当前窗口核对，不再建议会丢稿的关闭重开。不得通过自动替换 baseline 或静默重试覆盖服务端。
- 关闭动画尚未结束时重开应撤销旧关闭任务并重新展示；destroy 也应清理延迟任务。
- 布局保存只更新实际编辑的图标字段；其他入口新值必须保留，同字段并发修改应在 PUT 前阻止。保持未知元数据与远端新增项。
- 手机内页显示时背景桌面不进入 Tab 顺序或 accessibility tree；返回首页和切换桌面断点后恢复。焦点应在可见内容内。
- 已销毁的组件宿主不接收渲染器 ready/error 回调，也不再修改宿主缓存和版本；正常加载及重试保持原有行为。
- 增加「文件夹」「天气」「壁纸」及相关常用中文别名；未知词仍原样保留，不引入翻译服务。
- 失效文章链接仅核对来源；没有可靠替代地址时保留用户布局，不自动删除。

## Review Focus

1. 设置冲突不能以重置草稿或静默覆盖服务端换取保存成功。
2. 远端新增/修改/删除 custom_icons 与布局本地仅移动位置必须兼容。
3. 手机直达、PJAX、返回首页和跨断点均需同步背景焦点隔离。
4. 销毁后 resolve/reject、同类渲染器并发加载与失败后重试需正确处理。
5. 资源预算已接近上限，不能通过提高门槛交付。

## Tasks

### Task 1: 设置恢复与常用中文检索

**Files:** theme-settings.js、settings-model/save.js、settings-assets/icon-catalog.js；相关 settings interactions/save/icons 验证脚本。

- [x] 增加关闭后立即重开、destroy 后计时器、冲突草稿保留的失败用例。
- [x] 修复关闭任务取消与冲突提示；补齐指定别名，保持未知查询。
- [x] 运行设置模型、资源和预览定向验证。

### Task 2: 布局与图标并发保存

**Files:** widgets/persistence-write.js、persistence-conflict.js、desktop/surface/index.js（仅保存调用部分）；verify-desktop-layout-conflict.test.mjs。

**Interfaces:** 现有 applyDesktopLayoutJsonToThemeConfig(config, layoutJson) 与 assertDesktopLayoutBaseline(config, expectedLayoutJson, options)；内部可增加可选旧布局参数，现有调用保持兼容。

- [x] 增加远端仅改 custom_icons、本地移动、本地同字段编辑、远端新增/删除及未知元数据的失败用例。
- [x] 实施三方字段合并，冲突在 PUT 前阻止且保留草稿。
- [x] 运行布局冲突和设置桌面内容定向验证。

### Task 3: 渲染器生命周期

**Files:** widgets/render-runtime.js；新增 verify-widget-renderer-lifecycle.test.mjs。

- [x] 建立受控加载 Promise 的实际函数回归，先确认销毁后 resolve/reject 会失败。
- [x] 增加销毁状态保护，保留正常加载、合并请求和重试。
- [x] 验证所有上述生命周期场景。

### Task 4: 手机内页背景焦点

**Files:** desktop/window-manager.js、必要的 shell/layout.html；verify-mobile-surface-focus.test.mjs。

- [x] 增加手机窗口、首页、桌面宽度、跨断点与关闭的失败用例。
- [x] 同步 inert 状态并处理焦点进入可见窗口；不引入全局桌面模态。
- [x] 真页复测 390×844 的 Shift+Tab，以及返回首页和桌面断点恢复。

### Task 5: 集成与交付

- [x] 将新增必要回归纳入现有 check 门禁；独立检查各任务差异。
- [x] 执行 pnpm run check；保持现有预算。
- [x] 执行 pnpm run verify:reload 和 SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright。
- [x] 用隔离 fixture 验证设置关闭重开与冲突，真页验证手机焦点和正常桌面交互。
- [x] 更新本文执行记录，交付实际结果与明确未验证范围；提交前验证阶段不执行 Git 写操作。

## 执行记录

- 2026-09-30：CAL 完成；用户「修复」覆盖上述已审阅源码问题。现有修改不纳入本轮重做。


### 最终修复与复核

- 设置关闭计时器由 store 管理；关闭动画期间立即重开撤销旧任务，并保留正确预览恢复快照。打开后的帧回调和焦点计时器核对代次；访问检查 Promise 等待期间的关闭、导航和 destroy 也会取消打开。
- 设置字段冲突保留当前草稿与旧基线，提示在当前窗口核对，并明确关闭会放弃草稿。
- custom_icons 根据旧布局、本地编辑、最新配置进行字段合并；保留未编辑的远端字段、新增项和未知 metadata，拒绝同字段竞争及无效远端链接。
- 保存完成后的回填保留 PUT 等待期间新增、修改和删除的草稿；远端新增图标避开当前 icons/widgets。服务端实际 PUT 快照继续作为基线；同名并发新增保留本地草稿并阻止未经协调的下一次 PUT。
- 手机窗口显示时通过 inert 隔离背景桌面；Alpine 展示完成后再从背景转移焦点。关闭、最小化、跨断点和 destroy 会释放隔离或取消旧焦点任务。
- 组件宿主销毁后忽略 renderer resolve/reject 的缓存、版本和 ready/error 回调；保留正常合并请求与失败重试。
- 增加文件夹、文件、天气、壁纸、时钟和时间的中文检索别名；未知查询原样保留。
- 各任务经过独立定向复核；最终审查提出的图标重叠、同名新增和访问探测遗漏均先复现、补修后重新复核通过。

### 最终验证（同一构建）

构建身份：`0.9.46/0de8baabede4`；本地 Halo `2.26.1`、Node `24.21.0`。

| 验证 | 实际结果 | 范围 |
| --- | --- | --- |
| `pnpm run check` | exit 0；架构、协议、回归、notices、Vite、预算与构建 smoke 通过 | 当前累计工作区与新增回归；非全量 JS 静态类型检查 |
| 资源预算 | shell JS gzip 148234 / 148480 bytes；CSS gzip 65091 / 65536 bytes | 未提高现有门槛，余量仍较小 |
| `pnpm run verify:reload` | exit 0；13 个页面均 200，RSS 200，协议核对通过 | 本地已安装插件页面；无跳过 |
| `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright` | exit 0；24 场景，0 failures / 0 skips / 0 discoveryErrors | 23 项 200 与 1 项预期无效分页 404；当前 manifest 身份一致 |
| 设置真实页面隔离 fixture | exit 0；34 / 34 场景，pageErrors 0，真实写入转发 0 | 模拟授权与配置、附件、Iconify 接口；新增立即重开、中文别名、冲突提示与保稿验证；入口资源 hash 一致 |
| 匿名真页手机键盘 | 390×844 下 PJAX 打开后焦点进入内容，Shift+Tab 不进入背景；返回首页 inert 解除；1440 宽屏背景可 Tab；缩回手机焦点回到内容；内页直达也隔离背景 | 实际 DOM 属性和键盘；未提交评论或设置 |
| `/Library/Developer/CommandLineTools/usr/bin/git diff --check` | exit 0 | 无暂存、提交、推送、标签或分支操作 |

证据：`output/overall-reliability-2026-09-30/` 中的最终 check/reload/smoke 日志、`mobile-focus-report.json`、手机截图与 `settings-fixture/browser-fixture-report.json`；24 场景完整报告为 `output/playwright/smoke-report.json`。

### 剩余事项与恢复边界

- 桌面“Mac 重启之后启动 podman 上面的容器流程”仍指向 `/archives/9qAA8fCy`，已核对为失效内容地址。未找到可靠替代文章，保留图标与站点配置；需要新的目标地址或明确删除选择。
- fixture 保存、上传与冲突验证不等于真实账号配置写入或插件业务写入验收；本轮未执行这些操作。
- 保留之前 Dock/滚动等未提交改动；验证完成时本轮源码修改及生成资源尚未提交；后续本地提交状态见项目进度。修复前源码快照保存在忽略的本地任务目录，必要时可按文件恢复本轮修改，再构建并 Reload；不能用整个仓库回退覆盖已有工作。
