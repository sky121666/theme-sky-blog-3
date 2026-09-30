# 启动体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 按任务执行并记录验证；用户已经批准设计并授权实施。

**Goal:** 完成默认普通首屏、可选开机效果，以及后台／前端设置和官方登录衔接。

**Architecture:** 启动视觉采用独立可选控制器，构建时将同一份受测源码生成为 Halo 首屏片段，普通模式不输出控制器。设置沿用现有配置来源；桌面占位复用现有布局计算。服务端私密策略保留，面板显示未核验并链接后台。

**Tech Stack:** Halo Thymeleaf、Alpine、原生 JavaScript、现有 Vite／Tailwind、Node 测试和 Playwright。

**Spec:** `docs/superpowers/specs/2026-09-30-startup-and-site-access-design.md`

## Global Constraints

- 默认 `direct`；可选 `boot`，频率 `tab_once`／`every_reload`，默认 `tab_once`。
- 开机标识 `apple`／`site`／`custom`，默认 `apple`；不增加依赖。
- 视觉遮挡最多 2 秒，无最低等待；减少动态效果、存储不可用和异常均直接显示。
- 预览不保存配置、不写播放记录；已有配置、用户布局与访问策略保持。
- 仅 `main`、仅 `pnpm`；实施阶段不包含 Git 写入。后续用户明确授权分批本地提交，覆盖本次改动的选择性暂存与提交，不包含推送或标签。
- 不修改服务端私密设置、许可证、数据库或认证协议。
- 本计划记录执行进度，避免因上下文切换重复工作；独立文件范围可并行，整合与全套验证顺序进行。

## Review Focus

- 认证跳转、自动恢复和用户刷新都可能产生完整导航，播放去重须区分来源。
- CSS／JS 慢或失败时，开机层必须自行退出，且键盘焦点和表单输入可恢复。
- 空桌面、隐藏组件、窄屏和自定义布局不能被占位或就绪判断误伤。
- 设置草稿切换、取消、保存失败和演示不能修改播放记录或立即覆盖工作区。
- 私密能力未知时只展示未核验；主题切换显示模式不能改变服务端访问策略。

## Task 1: 共用启动控制器（主代理）

**Files:** 新增 `src/shared/startup-controller.js`、`src/shared/startup-signals.js`、`scripts/theme-startup.mjs`、`scripts/verify-startup-controller.test.mjs`；修改 `vite.config.ts`。

**Interfaces:**
- `installStartupController(window, document, config, { preview = false } = {})`：返回 `ready(part)`、`finish(reason)`、`dispose()` 与 `finished` Promise；自动运行时挂到 `window.__THEME_STARTUP__`。
- config 使用 `mode/frequency/logoMode/logoUrl/siteLogo/scene`；scene 为 `desktop`／`app`／`login`。desktop 等待 `shell` 和 `surface`，app 等待 `shell` 和 `app`，login 等待 `auth`。
- `signalStartupReady(part)`、`signalStartupFailure()`、`markStartupRecoveryReload()`：轻量桥接；恢复标记与控制器使用同一版本化键和短寿命规则。
- `previewStartup(config)`：动态导入控制器并以 preview 模式运行，返回完成 Promise。

- [x] 写控制器行为测试：普通模式无层、两种刷新规则、登录返回、恢复标记、存储失败、减少动态效果、2 秒退出、ready 条件、跳过与预览焦点／记录。
- [x] 运行测试确认因功能缺失失败。
- [x] 实现自包含控制器；构建脚本复用同一函数生成 `templates/assets/build-startup.html`，条件输出，保持构建可追溯。
- [x] 运行控制器测试及片段序列化测试通过。

## Task 2: 后台与前端设置（独立协作任务）

**Files:** `settings.yaml`、`settings-model/schema.js`、`theme-settings.js`、必要的 settings-model 文件、`templates/modules/shell/theme-settings.html`、新增 `templates/modules/shell/settings/startup.html`、对应设置样式及设置测试。

**Interfaces:** 沿用现有字段路径和草稿；“演示一次”调用 `previewStartup({mode:'boot', frequency, logoMode, logoUrl, siteLogo, scene:'desktop'})`，来源 `src/shared/startup-signals.js`；取消/关闭不保留视觉层。本站访问状态固定诚实显示未核验，链接 `/console`。

- [x] 为四字段默认值／条件校验、草稿无自动播放和预览不保存增加行为测试，运行确认失败。
- [x] 添加四字段、启动与登录 pane、频率／标识／图片选择及演示；共享现有配置保存，不新增安全开关。
- [x] 运行 `pnpm run verify:settings-model`、必要 preview／schema 检查。

## Task 3: 普通首屏布局接管（独立协作任务）

**Files:** `templates/modules/shell/desktop-widgets.html`、`surface/index.js`／`grid.js`／`placement.js` 中必要部分、必要的新布局辅助文件及定向测试；桌面样式。

**Interfaces:** 复用 SSR 布局数据和实际响应式计算；最后一轮必要布局／节点渲染完成后调用 `signalStartupReady('surface')`。空布局和移动隐藏条件按实际期望节点判断，禁止将任意一个节点存在视为全部就绪。

- [x] 为占位与最终投影一致、空布局、窄屏隐藏、不修改保存状态增加测试并观察失败。
- [x] 实现同规则的早期布局占位及接管，避免整层空白；接入精确就绪信号。
- [x] 运行桌面 viewport／布局相关测试及新增测试。

## Task 4: Shell、Auth、导航与恢复整合（主代理）

**Files:** `templates/modules/shell/layout.html`、`templates/gateway_fragments/layout.html`、`src/shell/desktop-shell/entry-main.js`、`src/apps/auth/entry.js`、必要的 PJAX 和恢复入口；相应契约测试。

**Interfaces:** 两种布局在 body 开始处引入构建片段；Shell 在本地必要控制完成后报告 shell/app；Auth hydrate 后报告 auth；错误报告 failed；恢复重载预先写入视觉标记。

- [x] 为正常默认、仅登录场景启用、失败清层、登录 HTML 的完整导航交接增加定向回归。
- [x] 接入片段和信号，保留官方表单及未保存内容导航处理。
- [x] 运行启动、Shell bootstrap、认证及 PJAX 相关检查。

## Task 5: 整体审查与现场验证（主代理）

- [x] 新鲜独立审查本次改动，修复实质问题；保护既有无关文件。
- [x] 运行 `pnpm run check`，确认构建和体积门槛。
- [x] 运行 `pnpm run verify:reload`。
- [x] 运行 `SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright`。
- [x] 浏览器验证普通首屏、设置演示、登录页及窄屏；隔离浏览器 fixture 验证两种模式和频率，不为测试改写服务端站点配置。
- [x] 记录已验证与实际许可证／私密功能未核验的边界，交付文件和证据。

## 执行记录

- 2026-09-30：用户确认设计并明确开始实施。已有三个无关工作区项保留；新增设计稿由上一阶段产生。
- Ruling：直接在 `main` 实施，不创建 worktree、不执行 Git 写入；依据用户项目规则。
- Ruling：沿用现有 Tailwind 与主题组件，不安装 daisyUI；依据已批准设计“不新增依赖”。
- Ruling：用户已明确开始实施，计划完成后持续执行，不重复发起设计批准请求。

- 实现记录：控制器、共享配置与预览、早期桌面投影、Shell/Auth/PJAX/恢复衔接均已实现。独立审查发现 Dock 异步挂载早于 shell-ready；已调整为实际挂载后就绪，失败时立即释放，新增回归 RED→GREEN。
- 验证记录：启动与设置、布局、Dock、PJAX 定向回归通过；首次全套检查暴露 VM 测试夹具缺少新依赖，补入真实函数后通过。随后构建曾因 Shell CSS 超出现有 64 KiB 上限 460 字节失败，最终通过复用既有样式并将首屏专属样式限定到首页解决，保持原预算。

- 完整门禁：`pnpm run check` 最终 EXIT 0，构建 revision `dda35e344e8e`，Shell JS gzip 142471 B、CSS gzip 65528 B（构建阶段口径）；最终资源预算 `failures=[]`。重载 13 个实际页面均 200，页面协议验证通过。
- 首屏隔离浏览器：1280/375 px 各 19 个节点，早期与正式布局四个坐标维度最大偏差均为 0 px；两种刷新频率、慢 Shell 2 秒退出及迟到 hydrate、原生登录表单就绪和后续导航去重均通过，无 pageerror。测试仅在隔离 HTML 响应注入 boot，实际站点仍普通模式，未提交凭据。

- 设置页隔离验收：6 项组合检查通过，模拟配置保存 1 次，真实写请求 0；桌面与 375px 下模式选择、预览/Escape/焦点、取消、ETag 保存和保留未知字段均通过，页面错误 0。全站 Playwright 冒烟 24/24，无失败或跳过。
- 收尾清理：移除复用样式过程产生的无意义空行与声明次序变化，两个原有 CSS 文件恢复原状；重做完整检查与 Reload 均通过，最终构建 revision `4cd9e2e00aa6`。上述 `dda35e344e8e` 为前一验收构建，最终浏览器报告已重新核对当前 revision。
- 边界：实际站点保持普通显示；boot 使用隔离浏览器响应覆盖验证。未变更 Halo 私密策略、许可证或真实主题配置；密码/OAuth/Passkey 提交、真实后台持久化与私密资源拦截未验收。无 Git 暂存、提交、推送或标签。

- 后续提交授权：用户要求「分批提交」。按设计／实施记录、功能／对应构建与使用说明两批在 `main` 本地提交；上一条 Git 状态为实施完成时的记录，后续仍不推送或打标签。
